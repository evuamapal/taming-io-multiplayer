#!/bin/bash
# Two-browser proof of the hosted offline server. Usage: bin/hosted_proof.sh [--dry] [--room NAME] [--url URL]
PKG="$(cd "$(dirname "$0")/.." && pwd)"
for c in "${PYTHON:-}" /opt/homebrew/anaconda3/bin/python3 "$(command -v python3 2>/dev/null)" /usr/bin/python3; do
  [ -n "$c" ] && [ -x "$c" ] && "$c" -c "import websocket" 2>/dev/null && { PY="$c"; break; }
done
[ -n "${PY:-}" ] || { echo "python3 with websocket-client not found" >&2; exit 2; }
exec "$PY" "$PKG/bin/hosted_proof.py" "$@"
