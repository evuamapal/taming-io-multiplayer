#!/bin/bash
# Offline taming replay: the client re-lives one recorded Atlanta#4 session (your inputs do not
# change what you see). Never online.
# Usage: ./replay.sh        open the game, press Play; quit Chrome (Cmd+Q) or Ctrl+C here to stop
#        ./replay.sh demo   scripted check: menu, Play, screenshots -> logs/
RUNNAME="replay${1:+_$1}"
source "$(cd "$(dirname "$0")" && pwd)/bin/common.sh"
MODE="${1:-play}"
PY=$(find_python 0) || die "python3 not found (set PYTHON=/path/to/python3)"
PORT=$(free_port 8790)
"$PY" -I -u "$PKG/offline_proxy.py" --cap "$PKG/captures/atl4_replay.jsonl" --port "$PORT" --log "$LOGDIR/server.jsonl" > "$LOGDIR/server.out" 2>&1 &
SERVER_PID=$!; disown
wait_listen "$PORT" "$SERVER_PID" || die "replay server did not start (see $LOGDIR/server.out)"
say "$(head -1 "$LOGDIR/server.out")"
start_watchdog
URL="https://taming.invalid/?r=atlanta&i=4"
if [ "$MODE" = demo ]; then
  PYW=$(find_python 1) || die "python3 with websocket-client not found (needed for demo only)"
  DBG=$(free_port 9333)
  start_chrome "$PORT" "about:blank" "--remote-debugging-port=$DBG" "--remote-debugging-address=127.0.0.1"
  "$PYW" "$PKG/bin/demo.py" --port "$DBG" --url "$URL" --steps "$PKG/bin/replay_steps.json" --out "$LOGDIR" 2>&1 | tee "$LOGDIR/demo.log"
  [ -f "$LOGDIR/VIOLATION" ] && die "network violation, everything killed (see $WLOG)"
else
  start_chrome "$PORT" "$URL"
  say "replaying. Press Play in the game. Quit Chrome (Cmd+Q) or press Ctrl+C here to stop."
  wait_chrome
fi
