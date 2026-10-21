#!/bin/bash
# Hosted offline taming server (mimic/hosted_server.js) as a background process.
# Usage: bin/hosted.sh start|stop|status|restart   env: PORT (8920), BIND (127.0.0.1), LOG_DIR, MIRROR, NODE, MODE
set -u
PKG="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8920}"; BIND="${BIND:-127.0.0.1}"
LOG_DIR="${LOG_DIR:-$PKG/logs/hosted}"
PIDF="$LOG_DIR/server.pid"
mkdir -p "$LOG_DIR"
find_node() {
  for c in "${NODE:-}" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/node-v*/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done; return 1
}
running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && ps -p "$(cat "$PIDF")" -o command= | grep -q hosted_server.js; }
listening() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }
start() {
  if running; then echo "already running, pid $(cat "$PIDF")"; return 0; fi
  if listening; then echo "port $PORT is busy (not ours), not starting"; return 1; fi
  NODE_BIN=$(find_node) || { echo "node not found (set NODE=/path/to/node)"; return 1; }
  "$NODE_BIN" "$PKG/mimic/hosted_server.js" --selftest-outbound > "$LOG_DIR/selftest.out" 2>&1 || { echo "outbound selftest failed, see $LOG_DIR/selftest.out"; return 1; }
  PORT="$PORT" BIND="$BIND" LOG_DIR="$LOG_DIR" nohup "$NODE_BIN" "$PKG/mimic/hosted_server.js" --port "$PORT" --bind "$BIND" --logdir "$LOG_DIR" ${MODE:+--mode "$MODE"} >> "$LOG_DIR/server.out" 2>&1 &
  echo $! > "$PIDF"
  for _ in $(seq 1 100); do listening && break; kill -0 "$(cat "$PIDF")" 2>/dev/null || break; sleep 0.2; done
  if running && listening; then echo "started pid $(cat "$PIDF") on $BIND:$PORT"; else echo "failed to start, see $LOG_DIR/server.out"; rm -f "$PIDF"; return 1; fi
}
stop() {
  if running; then kill "$(cat "$PIDF")"; for _ in $(seq 1 25); do running || break; sleep 0.2; done; running && kill -9 "$(cat "$PIDF")"; echo "stopped"; else echo "not running"; fi
  rm -f "$PIDF"
}
status() { if running; then echo "running pid $(cat "$PIDF") on $BIND:$PORT"; else echo "not running"; return 1; fi; }
case "${1:-status}" in
  start) start ;; stop) stop ;; status) status ;; restart) stop; start ;;
  *) echo "usage: $0 start|stop|status|restart"; exit 2 ;;
esac
