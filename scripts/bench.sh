#!/usr/bin/env bash
# Process one recording N times through a fresh privmeet-server and report, per run, the peak
# RSS of the server and its children and the wall time, then the server's memory afterwards.
#
#   scripts/bench.sh <audio file> [runs] [settings.json]
#
# Uses native/server/target/release/privmeet-server (cargo build --release first) on port 8099
# with a temporary DATA_DIR; settings.json (optional) picks the provider and models. Run it
# alone: nothing else heavy on the machine, or the numbers mean little.
set -euo pipefail
AUDIO=${1:?usage: scripts/bench.sh <audio file> [runs] [settings.json]}
RUNS=${2:-3}
SETTINGS=${3:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=$ROOT/native/server/target/release/privmeet-server
DATA=$(mktemp -d)
B=http://127.0.0.1:8099
trap 'kill "$SERVER" 2>/dev/null; rm -rf "$DATA"' EXIT
[ -n "$SETTINGS" ] && cp "$SETTINGS" "$DATA/settings.json"

DATA_DIR=$DATA PORT=8099 "$BIN" >"$DATA/server.log" 2>&1 &
SERVER=$!
until curl -fs -o /dev/null "$B/api/system/"; do sleep 0.5; done
echo "fresh: $(python3 -I "$ROOT/scripts/mem.py" now "$SERVER")"
curl -s -c "$DATA/jar" -o /dev/null "$B/api/system/"
TOKEN=$(awk '/csrftoken/{print $7}' "$DATA/jar")
for i in $(seq 1 "$RUNS"); do
  rm -f "$DATA/stop"
  python3 -I "$ROOT/scripts/mem.py" until "$SERVER" "$DATA/stop" >"$DATA/peak" &
  SAMPLER=$!
  ID=$(curl -s -b "$DATA/jar" -H "X-CSRFToken: $TOKEN" -H "Referer: $B/" -F "file=@$AUDIO" -F title=Bench "$B/api/meetings/" |
    python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  until curl -s "$B/api/meetings/$ID/" | grep -qE '"status":"(done|failed)"'; do sleep 0.5; done
  touch "$DATA/stop"; wait "$SAMPLER"
  echo "run $i: $(cat "$DATA/peak") status=$(curl -s "$B/api/meetings/$ID/" | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])")"
done
sleep 3
echo "after $RUNS runs: $(python3 -I "$ROOT/scripts/mem.py" now "$SERVER")"
