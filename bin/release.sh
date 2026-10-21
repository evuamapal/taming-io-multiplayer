#!/bin/bash
[ -x "${WAIT_IDLE:-}" ] && bash "$WAIT_IDLE"  # never build during a leaderboard cycle (load hurts the scans)
# One command per release: bin/release.sh X.Y.Z
# Builds tio_offline_server_vX.Y.Z.zip (hosting) and tio_offline_vX.Y.Z.zip (single computer) from the
# committed tree, runs every zero-outside-calls gate on the exact files that go into the zips, and only
# when all pass: tags vX.Y.Z, writes both zips + .sha256 + release notes to the downloads folder and
# refreshes the unversioned tio_offline.zip / tio_offline_server.zip copies.
# Env: DOWNLOADS (default ~/Downloads), NODE, PYTHON, SKIP_PROOF=1 (dry runs only; never tags or copies)
set -u
V="${1:-}"; [[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 X.Y.Z"; exit 2; }
PKG="$(cd "$(dirname "$0")/.." && pwd)"
DL="${DOWNLOADS:-$HOME/Downloads}"
OUT="$PKG/work/release/v$V"
GL="$OUT/gates.log"
fail() { echo "RELEASE ABORTED: $*" | tee -a "$GL" >&2; [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; exit 1; }
gate() { echo "== GATE $1: $2" | tee -a "$GL"; }
ok() { echo "   PASS $*" | tee -a "$GL"; }

cd "$PKG"
if [ "${SKIP_PROOF:-0}" != 1 ]; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files have uncommitted changes; commit first"; exit 1; }
  grep -q "^## v$V " CHANGELOG.md || { echo "CHANGELOG.md has no '## v$V ' entry"; exit 1; }
  grep -q "v$V" BUGS.md || { echo "BUGS.md does not mention v$V"; exit 1; }
fi
if git rev-parse -q --verify "refs/tags/v$V" >/dev/null && [ "$(git rev-list -n1 "v$V")" != "$(git rev-parse HEAD)" ]; then
  echo "tag v$V exists on another commit"; exit 1
fi
NODE_BIN=""; for c in "${NODE:-}" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/node-v*/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE_BIN="$c"; break; }; done
[ -n "$NODE_BIN" ] || { echo "node not found"; exit 1; }
PY=""; for c in "${PYTHON:-}" /opt/homebrew/anaconda3/bin/python3 "$(command -v python3 2>/dev/null)" /usr/bin/python3; do
  [ -n "$c" ] && [ -x "$c" ] && "$c" -c "import websocket" 2>/dev/null && { PY="$c"; break; }; done
[ -n "$PY" ] || { echo "python3 with websocket-client not found"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT/tree" "$OUT/stage"
: > "$GL"
COMMIT=$(git rev-parse --short HEAD)
echo "release v$V from commit $COMMIT ($(date '+%F %T %Z'))" | tee -a "$GL"
if [ "${SKIP_PROOF:-0}" = 1 ]; then
  git ls-files -co --exclude-standard | tar -cf - -T - | tar -x -C "$OUT/tree"
else
  git archive HEAD | tar -x -C "$OUT/tree"
fi

# ---------------------------------------------------------------- stage both packages
LAP="$OUT/stage/tio_offline"; SRV="$OUT/stage/tio_offline_server"
mkdir -p "$LAP" "$SRV"
( cd "$OUT/tree" && tar -cf - --exclude ./tools --exclude ./work --exclude ./logs --exclude ./deploy --exclude ./README_SERVER.md --exclude ./mimic/data/wiki/raw . ) | tar -x -C "$LAP"
mkdir -p "$LAP/logs"
( cd "$OUT/tree" && tar -cf - --exclude mimic/data/wiki/raw mimic/hosted_server.js mimic/hosted mimic/hosted_config.json mimic/mimic_server.js \
    mimic/codec.js mimic/codec_mmgsa.js mimic/game_mimic.js mimic/world_atl4.json mimic/world_sp5.json mimic/mimic_config.json mimic/data \
    decoder/names.json decoder/tio_proto.py mirror bin/hosted.sh bin/hosted_proof.py bin/hosted_proof.sh bin/hosted_selftest.js \
    deploy CHANGELOG.md BUGS.md ) | tar -x -C "$SRV"
cp "$OUT/tree/README_SERVER.md" "$SRV/README.md"
cp "$OUT/tree/.gitignore" "$SRV/.gitignore"
mkdir -p "$SRV/logs/hosted"
echo "$V $COMMIT" > "$LAP/VERSION"; echo "$V $COMMIT" > "$SRV/VERSION"

# ---------------------------------------------------------------- gates
gate 1 "no real game host in any packaged file (plain, any case, split, escaped, hex, base64, UTF-16, char codes)"
"$PY" -I "$PKG/tools/release/gate_scan.py" "$LAP" "$SRV" 2>&1 | tee -a "$GL"; [ "${PIPESTATUS[0]}" = 0 ] || fail "gate 1 scan"
for f in "$SRV/mimic/hosted_server.js" "$SRV/mimic/mimic_server.js" "$LAP/mimic/hosted_server.js" "$LAP/mimic/mimic_server.js"; do
  grep -q "require(\"./hosted/no_outbound\")" "$f" || fail "gate 1: $f does not load no_outbound first"
done
ok "both packages clean"

gate 2 "every outbound network API throws OUTBOUND BLOCKED (both servers, both packages)"
for f in "$SRV/mimic/hosted_server.js" "$SRV/mimic/mimic_server.js" "$LAP/mimic/hosted_server.js" "$LAP/mimic/mimic_server.js"; do
  "$NODE_BIN" "$f" --selftest-outbound > "$OUT/selftest.out" 2>&1; rc=$?
  tail -1 "$OUT/selftest.out" | sed "s|^|   ${f#$OUT/stage/}: |" | tee -a "$GL"
  [ $rc = 0 ] || { cat "$OUT/selftest.out" >> "$GL"; fail "gate 2 selftest $f"; }
done
ok "all outbound APIs blocked"

# start the staged SERVER package exactly as a host would run it
PORT=8930; while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
SLOG="$OUT/server_logs"
PORT=$PORT BIND=127.0.0.1 MODE=multi LOG_DIR="$SLOG" "$NODE_BIN" "$SRV/mimic/hosted_server.js" > "$OUT/server.out" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 100); do lsof -nP -a -p $SRV_PID -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 0.2; done
lsof -nP -a -p $SRV_PID -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || fail "staged server did not start (see $OUT/server.out)"
echo "   staged server pid $SRV_PID on 127.0.0.1:$PORT (mode multi)" | tee -a "$GL"

gate 3 "account and token calls answered locally, never forwarded; served content has no real host"
for p in /list /_h/account/try /_h/account/check?region=offline\&id=1 /_h/token/accept /_h/token/get; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT$p"); echo "   $p -> $code (local)" | tee -a "$GL"
  [ "$code" = 200 ] || fail "gate 3: $p answered $code"
done
"$PY" -I "$PKG/tools/release/gate_scan.py" --serve "http://127.0.0.1:$PORT" "$SRV/mirror/index.jsonl" 2>&1 | tee "$OUT/served_scan.txt" | head -1 | tee -a "$GL"
grep -q "^scanned .* 0 hits, 0 fetch errors" "$OUT/served_scan.txt" || { cat "$OUT/served_scan.txt" >> "$GL"; fail "gate 3 served scan"; }
grep "^hostnames in served text" "$OUT/served_scan.txt" | sed 's/^/   (info) /' | tee -a "$GL"
ok "local answers, served content clean"

if [ "${SKIP_PROOF:-0}" = 1 ]; then
  echo "== GATES 4-6 SKIPPED (SKIP_PROOF=1): dry run, nothing tagged or copied" | tee -a "$GL"; kill $SRV_PID; exit 0
fi

gate 4 "two-browser proof against the staged server package: only the server contacted, see + hit, menu sweep"
gate 5 "lsof on the server process during the proof: no non-loopback socket"
PROOF="$OUT/proof_server"
"$PY" "$SRV/bin/hosted_proof.py" --port $PORT --server-pid $SRV_PID --milestone 2 --server-log "$SLOG/server.jsonl" --out "$PROOF" > "$OUT/proof_server.out" 2>&1
rc=$?
grep -E "^\| |^- [AB]: |Result" "$PROOF/report.md" 2>/dev/null | sed 's/^/   /' | cut -c1-240 | tee -a "$GL"
[ $rc = 0 ] || fail "gates 4/5: proof failed (see $PROOF/report.md)"
n=$(grep -c '"outbound_blocked"' "$SLOG"/*.jsonl 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')
echo "   outbound_blocked events in server log: $n" | tee -a "$GL"; [ "$n" = 0 ] || fail "gate 5: the server tried to reach out"
ok "server package proven"
kill $SRV_PID; SRV_PID=""

gate 6 "single-computer package: ./play.sh demo (local server + two browsers, socket watchdog)"
( cd "$LAP" && ./play.sh demo ) > "$OUT/play_demo.out" 2>&1; rc=$?
tail -5 "$OUT/play_demo.out" | sed 's/^/   /' | tee -a "$GL"
WD=$(ls -d "$LAP"/logs/play_demo_* 2>/dev/null | tail -1)
grep "watchdog end" "$WD/watchdog.log" 2>/dev/null | sed 's/^/   /' | tee -a "$GL"
[ $rc = 0 ] || fail "gate 6: play.sh demo failed (see $OUT/play_demo.out)"
grep -q "nonloopback_total=0" "$WD/watchdog.log" || fail "gate 6: watchdog saw a non-loopback socket"
mkdir -p "$OUT/proof_laptop"; cp -R "$WD"/. "$OUT/proof_laptop/"; rm -rf "$LAP"/logs/*
ok "laptop package proven"

# ---------------------------------------------------------------- notes, zips
rm -rf "$LAP/work" "$SRV/work" "$LAP"/logs/* "$SRV"/logs/*; mkdir -p "$SRV/logs/hosted"
rm -rf "$LAP/mimic/data/wiki/raw" "$SRV/mimic/data/wiki/raw"
find "$OUT/stage" -name __pycache__ -type d -prune -exec rm -rf {} +
"$PY" -I "$PKG/tools/release/redact.py" --fix "$LAP" "$SRV" | tee -a "$GL"; [ "${PIPESTATUS[0]}" = 0 ] || fail "redact: binary file with user name or home path"
NOTES="$OUT/RELEASE_NOTES_v$V.md"
{
  echo "# tio_offline v$V release notes"; echo
  echo "Commit $COMMIT, built $(date '+%F %T %Z'). Two packages, same version:"
  echo "- tio_offline_server_v$V.zip: host the game for everyone (see README.md inside)."
  echo "- tio_offline_v$V.zip: play on one computer (RUN_ON_LAPTOP.md inside)."; echo
  sed -n "/^## v$V /,/^## v/p" CHANGELOG.md | sed '$d'; echo
  echo "## Zero-outside-calls gates (all must pass, the release aborts otherwise)"; echo; echo '```'; cat "$GL"; echo '```'
} | sed -e "s|$OUT/stage/||g" -e "s|$OUT/|<release>/|g" -e "s|$PKG|<repo>|g" -e "s|$HOME|~|g" -e "s|$(id -un)|<user>|g" > "$NOTES"
cp "$NOTES" "$LAP/RELEASE_NOTES.md"; cp "$NOTES" "$SRV/RELEASE_NOTES.md"
( cd "$OUT/stage" && rm -f ../*.zip && zip -qrX "../tio_offline_v$V.zip" tio_offline && zip -qrX "../tio_offline_server_v$V.zip" tio_offline_server ) || fail "zip"

gate 7 "the finished zips themselves (real host, user name, home path)"
"$PY" -I "$PKG/tools/release/gate_scan.py" "$OUT/tio_offline_v$V.zip" "$OUT/tio_offline_server_v$V.zip" 2>&1 | tee -a "$GL"
[ "${PIPESTATUS[0]}" = 0 ] || fail "gate 7 zip scan"
"$PY" -I "$PKG/tools/release/redact.py" --check "$OUT/tio_offline_v$V.zip" "$OUT/tio_offline_server_v$V.zip" | tee -a "$GL"
[ "${PIPESTATUS[0]}" = 0 ] || fail "gate 7: user name or home path inside a zip"
ok "zips clean"

# ---------------------------------------------------------------- publish
git rev-parse -q --verify "refs/tags/v$V" >/dev/null || git tag -a "v$V" -m "v$V" || fail "tag"
mkdir -p "$DL"
for z in "tio_offline_v$V.zip" "tio_offline_server_v$V.zip"; do
  cp "$OUT/$z" "$DL/$z"; ( cd "$DL" && shasum -a 256 "$z" > "$z.sha256" )
done
cp "$NOTES" "$DL/tio_offline_v$V.release_notes.md"
cp "$DL/tio_offline_v$V.zip" "$DL/tio_offline.zip"; ( cd "$DL" && shasum -a 256 tio_offline.zip > tio_offline.zip.sha256 )
cp "$DL/tio_offline_server_v$V.zip" "$DL/tio_offline_server.zip"; ( cd "$DL" && shasum -a 256 tio_offline_server.zip > tio_offline_server.zip.sha256 )
echo "released v$V:"; ( cd "$DL" && ls -la tio_offline*"$V"* tio_offline.zip tio_offline_server.zip && cat tio_offline*"$V".zip.sha256 )
