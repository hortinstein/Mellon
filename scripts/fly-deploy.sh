#!/usr/bin/env bash
# Deploy Mellon to Fly.io. Safe to re-run: it only creates what is missing.
#
#   scripts/fly-deploy.sh <app-name> [region]
#
# Optional environment:
#   TYPESAFE_API_KEY   set/update the Jev key (otherwise the mock judge runs)
#   MELLON_SECRET_KEY  use this encryption key on first deploy instead of generating one
# Secrets go to flyctl on stdin (secrets import), never as command-line arguments.
set -euo pipefail

APP="${1:-${FLY_APP:-}}"
REGION="${2:-${FLY_REGION:-iad}}"
VOLUME="mellon_data"
cd "$(dirname "$0")/.."

FLY="$(command -v fly || command -v flyctl || true)"
[ -n "$FLY" ] || { echo "flyctl not found. Install it: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
[ -n "$APP" ] || { echo "usage: $0 <app-name> [region]" >&2; exit 1; }
"$FLY" auth whoami >/dev/null 2>&1 || { echo "Not logged in. Run: $FLY auth login" >&2; exit 1; }

if ! "$FLY" status --app "$APP" >/dev/null 2>&1; then
  echo "==> Creating app $APP"
  "$FLY" apps create "$APP"
fi

if ! "$FLY" volumes list --app "$APP" --json | grep -q "\"$VOLUME\""; then
  echo "==> Creating 1 GB volume $VOLUME in $REGION"
  "$FLY" volumes create "$VOLUME" --app "$APP" --region "$REGION" --size 1 --yes
fi

if ! "$FLY" secrets list --app "$APP" --json | grep -q '"MELLON_SECRET_KEY"'; then
  KEY="${MELLON_SECRET_KEY:-$(openssl rand -base64 32)}"
  echo "==> Setting MELLON_SECRET_KEY"
  printf 'MELLON_SECRET_KEY=%s\n' "$KEY" | "$FLY" secrets import --app "$APP" --stage >/dev/null
  if [ -z "${MELLON_SECRET_KEY:-}" ]; then
    echo
    echo "    Generated MELLON_SECRET_KEY. Fly secrets can't be read back, so save it now:"
    echo "    $KEY"
    echo "    Losing it makes every stored secret and identity rule unreadable."
    echo
  fi
fi

if [ -n "${TYPESAFE_API_KEY:-}" ]; then
  echo "==> Setting TYPESAFE_API_KEY"
  printf 'TYPESAFE_API_KEY=%s\n' "$TYPESAFE_API_KEY" | "$FLY" secrets import --app "$APP" --stage >/dev/null
fi

echo "==> Deploying"
"$FLY" deploy --app "$APP" --primary-region "$REGION" --ha=false

echo
echo "Mellon is live at https://$APP.fly.dev"
echo "Make yourself an administrator after signing up:"
echo "  scripts/fly-admin.sh $APP grant <username>"
