#!/bin/bash
# Offline taming on this computer: the same multiplayer server as the hosted version, local only. Never online.
# Usage: ./play.sh          start the local server and open the game; quit Chrome (Cmd+Q) or Ctrl+C here to stop
#        ./play.sh demo     scripted check: two headless browsers join, see each other, one hits the other
#        ./play.sh server   only the server (other browsers on this computer: http://127.0.0.1:<port>/)
RUNNAME="play${1:+_$1}"
source "$(cd "$(dirname "$0")" && pwd)/bin/common.sh"
MODE="${1:-play}"
NODE_BIN=$(find_node) || die "node not found (set NODE=/path/to/node)"
PORT=$(free_port 8899)
"$NODE_BIN" "$PKG/mimic/hosted_server.js" --selftest-outbound > "$LOGDIR/selftest.out" 2>&1 || die "outbound selftest failed (see $LOGDIR/selftest.out)"
PORT="$PORT" BIND=127.0.0.1 MODE=multi LOG_DIR="$LOGDIR/hosted" "$NODE_BIN" "$PKG/mimic/hosted_server.js" > "$LOGDIR/server.out" 2>&1 &
SERVER_PID=$!; disown
wait_listen "$PORT" "$SERVER_PID" || die "server did not start (see $LOGDIR/server.out)"
say "server on http://127.0.0.1:$PORT/ (pid $SERVER_PID)"
start_watchdog
URL="http://127.0.0.1:$PORT/"
if [ "$MODE" = demo ]; then
  PY=$(find_python 1) || die "python3 with websocket-client not found (needed for demo only)"
  "$PY" "$PKG/bin/hosted_proof.py" --port "$PORT" --server-pid "$SERVER_PID" --milestone 2 \
    --server-log "$LOGDIR/hosted/server.jsonl" --out "$LOGDIR/proof" 2>&1 | tee "$LOGDIR/demo.log"
  RC=${PIPESTATUS[0]}
  [ -f "$LOGDIR/VIOLATION" ] && die "network violation, everything killed (see $WLOG)"
  [ "$RC" = 0 ] || die "demo failed (see $LOGDIR/proof/report.md)"
  say "demo passed (report: $LOGDIR/proof/report.md)"
elif [ "$MODE" = server ]; then
  say "serving. Open $URL in Chrome on this computer. Ctrl+C here to stop."
  while kill -0 "$SERVER_PID" 2>/dev/null && [ ! -f "$LOGDIR/VIOLATION" ]; do sleep 1; done
  [ -f "$LOGDIR/VIOLATION" ] && die "network violation, everything killed (see $WLOG)"
else
  DIRECT=1 start_chrome "$PORT" "$URL"
  say "playing. Quit Chrome (Cmd+Q) or press Ctrl+C here to stop."
  wait_chrome
fi
