#!/bin/bash
# Soak test of the hosted offline server (bin/soak.js): private server on 127.0.0.1:8931, bots, two browsers, monitors.
# Usage: bin/soak.sh [--port 8931] [--minutes 20] [--bots 8] [--no-browsers]   env: NODE
# Output: logs/soak_<ts>/ (report.md, metrics.jsonl, server/, proof_N/); exit 0 only if every condition passes.
set -u
PKG="$(cd "$(dirname "$0")/.." && pwd)"
for c in "${NODE:-}" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/node-v*/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE_BIN="$c"; break; }
done
[ -n "${NODE_BIN:-}" ] || { echo "node not found (set NODE=/path/to/node)" >&2; exit 2; }
OUT="$PKG/logs/soak_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT"
exec "$NODE_BIN" "$PKG/bin/soak.js" --out "$OUT" "$@"
