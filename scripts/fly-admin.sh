#!/usr/bin/env bash
# Run the admin CLI on the Fly machine. This is the only way to grant admin.
#
#   scripts/fly-admin.sh <app-name> list
#   scripts/fly-admin.sh <app-name> grant <username>
#   scripts/fly-admin.sh <app-name> revoke <username>
set -euo pipefail
APP="${1:?usage: $0 <app-name> <list | grant <username> | revoke <username>>}"
shift
FLY="$(command -v fly || command -v flyctl)"
"$FLY" ssh console --app "$APP" --command "node /app/scripts/admin.js $*"
