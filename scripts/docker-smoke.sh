#!/usr/bin/env bash
# Build the image and check it end to end: health, accounts, the admin CLI,
# running unprivileged, encryption at rest, persistence across restarts.
#
#   scripts/docker-smoke.sh [image-tag]
#
# With SMOKE_REDIS_URL and SMOKE_REDIS_TOKEN (an Upstash REST endpoint as seen
# from inside the container) it also runs the image on Redis instead of a
# volume, as on Cloud Run or any other host without a disk, and checks that
# data survives replacing the container.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${1:-mellon:smoke}"
NAME="mellon-smoke-$$"
VOLUME="mellon-smoke-$$"
PORT="${SMOKE_PORT:-18080}"
URL="http://127.0.0.1:$PORT"

cleanup() { docker rm -f "$NAME" "$NAME-redis" >/dev/null 2>&1 || true; docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; docker logs "$NAME" >&2 || true; exit 1; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));console.log(v??"")})' "$1"; }
wait_up() { for _ in $(seq 1 30); do curl -fs "$URL/api/status" >/dev/null && return 0; sleep 1; done; fail "server did not start"; }

docker build -q -t "$IMAGE" . >/dev/null
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" -e MELLON_SECRET_KEY=smoke -v "$VOLUME:/data" "$IMAGE" >/dev/null
wait_up
echo "ok  server is up"

[ "$(curl -fs "$URL/api/status" | json encrypted)" = "true" ] || fail "secrets not encrypted"
curl -fs "$URL/" | grep -q '<title>Mellon</title>' || fail "site not served"
curl -fs "$URL/api" | grep -q '<title>Mellon API</title>' || fail "API docs not served"
echo "ok  site, docs and status"

TOKEN=$(curl -fs -X POST "$URL/api/accounts" -H 'Content-Type: application/json' \
  -d '{"username":"root","rules":"The requester must say the passphrase osprey lantern."}' | json token)
[ -n "$TOKEN" ] || fail "sign-up returned no token"
code() { curl -s -o /dev/null -w '%{http_code}' "$URL/api/admin/overview" -H "Authorization: Bearer $TOKEN"; }
[ "$(code)" = "403" ] || fail "new account should not be admin"
docker exec "$NAME" node scripts/admin.js grant root >/dev/null
[ "$(code)" = "200" ] || fail "admin CLI grant was not picked up"
echo "ok  admin flag only via the CLI"

[ "$(docker exec "$NAME" ps -o pid,user | awk '$1 == 1 { print $2 }')" = "node" ] || fail "server is not running as node"
[ "$(docker exec "$NAME" stat -c %U /data/mellon.json)" = "node" ] || fail "data file not owned by node"
docker exec "$NAME" grep -q osprey /data/mellon.json && fail "identity rules stored in plaintext"
echo "ok  unprivileged, data encrypted at rest"

LOCK=$(curl -fs -X POST "$URL/api/locks" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Smoke","rules":"Requester must say the password mellon","secret":"s"}' | json lock.id)
curl -fs -X POST "$URL/api/locks/$LOCK/attempt" -H 'Content-Type: application/json' -d '{"input":"Requester says: password mellon"}' >/dev/null
[ "$(docker exec "$NAME" stat -c %U "/data/attempts/$LOCK.jsonl")" = "node" ] || fail "attempt log not owned by node"
echo "ok  attempt log written"

docker restart "$NAME" >/dev/null
wait_up
[ "$(code)" = "200" ] || fail "data or session lost on restart"
[ "$(curl -fs "$URL/api/locks/$LOCK/attempts" -H "Authorization: Bearer $TOKEN" | json total)" = "1" ] || fail "attempt log lost on restart"
echo "ok  data persists across restarts"

docker stop -t 10 "$NAME" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0" ] || fail "unclean shutdown"
echo "ok  clean shutdown"

if [ -n "${SMOKE_REDIS_URL:-}" ]; then
  NAME="$NAME-redis"
  PREFIX="mellon-test-smoke-${GITHUB_RUN_ID:-local}-$$"
  start_redis() {
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" --add-host host.docker.internal:host-gateway \
      -e MELLON_SECRET_KEY=smoke -e UPSTASH_REDIS_REST_URL="$SMOKE_REDIS_URL" -e UPSTASH_REDIS_REST_TOKEN="$SMOKE_REDIS_TOKEN" \
      -e MELLON_REDIS_PREFIX="$PREFIX" "$IMAGE" >/dev/null
    wait_up
  }
  # Leaves nothing behind in a shared database: delete the run's keys on exit.
  wipe_redis() {
    docker run --rm --add-host host.docker.internal:host-gateway -e U="$SMOKE_REDIS_URL" -e T="$SMOKE_REDIS_TOKEN" -e P="$PREFIX" --entrypoint node "$IMAGE" -e '
      const call = async (c) => (await (await fetch(process.env.U + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + process.env.T, "Content-Type": "application/json" }, body: JSON.stringify(c) })).json());
      (async () => { let cur = "0", keys = []; do { const [r] = await call([["SCAN", cur, "MATCH", process.env.P + ":*", "COUNT", 500]]); cur = String(r.result[0]); keys.push(...r.result[1]); } while (cur !== "0");
        if (keys.length) await call([["DEL", ...keys]]); })();' >/dev/null 2>&1 || true
  }
  trap 'wipe_redis; cleanup' EXIT

  start_redis
  [ "$(curl -fs "$URL/api/status" | json storage)" = "redis" ] || fail "image did not pick up the Redis variables"
  echo "ok  image runs on Redis"
  TOKEN=$(curl -fs -X POST "$URL/api/accounts" -H 'Content-Type: application/json' \
    -d '{"username":"root","rules":"The requester must say the passphrase osprey lantern."}' | json token)
  [ -n "$TOKEN" ] || fail "sign-up on Redis returned no token"
  docker exec "$NAME" node scripts/admin.js grant root >/dev/null
  [ "$(code)" = "200" ] || fail "admin CLI grant on Redis was not picked up"
  start_redis # a brand-new container: nothing local survives, only Redis
  [ "$(code)" = "200" ] || fail "account or session lost when the container was replaced"
  echo "ok  data lives in Redis across container replacement"
fi

echo "Docker smoke test passed"
