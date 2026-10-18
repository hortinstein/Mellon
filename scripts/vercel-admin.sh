#!/usr/bin/env bash
# Run the admin CLI against a Vercel deployment's Redis from your machine.
# This is the only way to grant admin; no API endpoint can.
#
#   scripts/vercel-admin.sh <project-name> list
#   scripts/vercel-admin.sh <project-name> grant <username>
#   scripts/vercel-admin.sh <project-name> revoke <username>
#
# It pulls the project's production variables into a temporary file for the
# Redis credentials and deletes it afterwards. If your Redis token is stored as
# a sensitive variable it can't be pulled; export UPSTASH_REDIS_REST_URL and
# UPSTASH_REDIS_REST_TOKEN yourself and run: node scripts/admin.js grant <username>
set -euo pipefail
PROJECT="${1:?usage: $0 <project-name> <list | grant <username> | revoke <username>>}"
shift
cd "$(dirname "$0")/.."

if command -v vercel >/dev/null 2>&1; then VC=(vercel); else VC=(npx --yes vercel@64); fi
EXTRA=()
[ -n "${VERCEL_TOKEN:-}" ] && EXTRA+=(--token "$VERCEL_TOKEN")
[ -n "${VERCEL_SCOPE:-}" ] && EXTRA+=(--scope "$VERCEL_SCOPE")

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
"${VC[@]}" link --yes --project "$PROJECT" "${EXTRA[@]}" >/dev/null
"${VC[@]}" env pull "$ENV_FILE" --environment=production --yes "${EXTRA[@]}" >/dev/null

if ! grep -qE '^(KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN)="?[^"]' "$ENV_FILE"; then
  echo "No readable Redis credentials on $PROJECT (missing, or stored as sensitive)." >&2
  echo "Export UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, then run: node scripts/admin.js $*" >&2
  exit 1
fi
node --env-file="$ENV_FILE" scripts/admin.js "$@"
