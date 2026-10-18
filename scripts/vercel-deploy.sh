#!/usr/bin/env bash
# Deploy Mellon to Vercel. Safe to re-run: it only adds what is missing.
#
#   scripts/vercel-deploy.sh <project-name>
#
# Vercel runs the API as serverless functions with no persistent disk, so Mellon
# needs Redis there. On first run this installs Upstash Redis from the Vercel
# Marketplace (interactive), unless you pass an existing database.
#
# Optional environment:
#   VERCEL_TOKEN, VERCEL_SCOPE     non-interactive auth / team
#   TYPESAFE_API_KEY               set or update the Jev key (otherwise the mock judge runs)
#   MELLON_SECRET_KEY              use this encryption key on first deploy instead of generating one
#   UPSTASH_REDIS_REST_URL/_TOKEN  use an existing Upstash database instead of the Marketplace
#   ALLOW_EPHEMERAL=1              deploy without Redis (data vanishes between requests; demo only)
set -euo pipefail

PROJECT="${1:-${VERCEL_PROJECT:-}}"
cd "$(dirname "$0")/.."
[ -n "$PROJECT" ] || { echo "usage: $0 <project-name>" >&2; exit 1; }

if command -v vercel >/dev/null 2>&1; then VC=(vercel); else VC=(npx --yes vercel@64); fi
EXTRA=()
[ -n "${VERCEL_TOKEN:-}" ] && EXTRA+=(--token "$VERCEL_TOKEN")
[ -n "${VERCEL_SCOPE:-}" ] && EXTRA+=(--scope "$VERCEL_SCOPE")
vc() { "${VC[@]}" "$@" "${EXTRA[@]}"; }

vc whoami >/dev/null 2>&1 || { echo "Not logged in. Run: vercel login (or set VERCEL_TOKEN)" >&2; exit 1; }

echo "==> Linking project $PROJECT"
vc link --yes --project "$PROJECT" >/dev/null

env_json() { vc env ls production --json 2>/dev/null || echo '{}'; }
has_env() { grep -q "\"key\": *\"$1\"" <<<"$ENV_JSON"; }
# add_env NAME VALUE [extra flags]; the value goes through stdin, never argv.
add_env() { local name="$1" value="$2"; shift 2; printf '%s' "$value" | vc env add "$name" production --force --yes "$@" >/dev/null; }
redis_ready() { has_env KV_REST_API_URL || has_env UPSTASH_REDIS_REST_URL; }
ENV_JSON="$(env_json)"

if redis_ready; then
  echo "==> Redis: already configured"
elif [ -n "${UPSTASH_REDIS_REST_URL:-}" ] && [ -n "${UPSTASH_REDIS_REST_TOKEN:-}" ]; then
  echo "==> Redis: using the Upstash database from UPSTASH_REDIS_REST_URL"
  add_env UPSTASH_REDIS_REST_URL "$UPSTASH_REDIS_REST_URL" --no-sensitive
  add_env UPSTASH_REDIS_REST_TOKEN "$UPSTASH_REDIS_REST_TOKEN" --no-sensitive
elif [ -t 0 ] && [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "==> Redis: installing Upstash Redis from the Vercel Marketplace"
  echo "    Pick a database name and region, and connect it to project $PROJECT."
  vc integration add upstash
  ENV_JSON="$(env_json)"
  redis_ready || { echo "Redis credentials not found on the project. Connect the Upstash database to $PROJECT in the Vercel dashboard, then re-run." >&2; exit 1; }
elif [ "${ALLOW_EPHEMERAL:-}" = "1" ]; then
  echo "==> Redis: none (ALLOW_EPHEMERAL=1). Data will NOT persist between requests."
else
  cat >&2 <<MSG
Mellon needs Redis on Vercel (serverless functions have no persistent disk). Either:
  - run this script in an interactive terminal to install Upstash from the Marketplace,
  - add Upstash Redis to the project in the Vercel dashboard (Storage tab), or
  - pass an existing database: UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... $0 $PROJECT
Set ALLOW_EPHEMERAL=1 to deploy a throwaway demo without storage.
MSG
  exit 1
fi

if ! has_env MELLON_SECRET_KEY; then
  KEY="${MELLON_SECRET_KEY:-$(openssl rand -base64 32)}"
  echo "==> Setting MELLON_SECRET_KEY"
  add_env MELLON_SECRET_KEY "$KEY" --sensitive
  if [ -z "${MELLON_SECRET_KEY:-}" ]; then
    echo
    echo "    Generated MELLON_SECRET_KEY. It is stored as a sensitive variable and can't be read back, so save it now:"
    echo "    $KEY"
    echo "    Losing it makes every stored secret and identity rule unreadable."
    echo
  fi
fi

if [ -n "${TYPESAFE_API_KEY:-}" ]; then
  echo "==> Setting TYPESAFE_API_KEY"
  add_env TYPESAFE_API_KEY "$TYPESAFE_API_KEY" --sensitive
fi

echo "==> Deploying to production"
URL="$(vc deploy --prod --yes)"

echo
echo "Mellon is live at $URL"
echo "Make yourself an administrator after signing up:"
echo "  scripts/vercel-admin.sh $PROJECT grant <username>"
