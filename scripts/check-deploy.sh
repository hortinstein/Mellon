#!/usr/bin/env bash
# Check a live deployment after it ships: the site and API answer, storage is
# the expected kind and persistent, and secrets are encrypted. /api/status loads
# from storage like every API request, so a Redis deployment that can't reach
# Upstash fails here. Read-only: it writes nothing to the deployment.
#
#   scripts/check-deploy.sh <url> <redis|file>
set -euo pipefail
URL="${1:?usage: $0 <url> <redis|file>}"
URL="${URL%/}"
EXPECT="${2:?usage: $0 <url> <redis|file>}"
fail() { echo "FAIL: $*" >&2; exit 1; }

STATUS=""
DELAY="${CHECK_DELAY:-5}" # seconds, growing per retry while a fresh deploy warms up
for attempt in 1 2 3 4 5 6; do
  CODE=$(curl -s -o /tmp/mellon-status.$$ -w '%{http_code}' "$URL/api/status" || true)
  if [ "$CODE" = "200" ]; then STATUS=$(cat /tmp/mellon-status.$$); break; fi
  [ "$CODE" = "401" ] || [ "$CODE" = "403" ] && break # protected; retrying won't help
  sleep $((attempt * DELAY))
done
rm -f /tmp/mellon-status.$$
if [ -z "$STATUS" ]; then
  [ "$CODE" = "401" ] || [ "$CODE" = "403" ] && fail "$URL/api/status returned $CODE. The URL is behind deployment protection; set the MELLON_URL repository variable to the public production domain."
  fail "$URL/api/status returned ${CODE:-no response}"
fi

field() { node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]] ?? "")' "$STATUS" "$1"; }
[ "$(field storage)" = "$EXPECT" ] || fail "storage is '$(field storage)', expected '$EXPECT'"
[ "$(field persistent)" = "true" ] || fail "storage is not persistent"
[ "$(field encrypted)" = "true" ] || fail "secrets are not encrypted (MELLON_SECRET_KEY missing?)"
echo "ok  $URL/api/status: storage=$EXPECT, persistent, encrypted"

curl -fs "$URL/" | grep -q '<title>Mellon</title>' || fail "site not served at $URL/"
curl -fs "$URL/api" | grep -q '<title>Mellon API</title>' || fail "API docs not served at $URL/api"
echo "ok  site and API docs served"

if [ "$(field mode)" = "live" ]; then
  echo "ok  judging with the real Jev API ($(field model))"
else
  echo "::warning::$URL is running the stand-in judge; set TYPESAFE_API_KEY on the deployment to use the real Jev API."
fi
