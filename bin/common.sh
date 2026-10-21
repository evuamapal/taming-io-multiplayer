# Shared launcher logic for play.sh / replay.sh. Sourced, not run.
# Offline guarantees: local servers on 127.0.0.1 only, Chrome forced through them with every other
# name unresolvable, fresh temp profile, and a socket watchdog that kills everything on any
# non-loopback socket.
set -u
PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
LOGDIR="$PKG/logs/${RUNNAME}_$TS"
mkdir -p "$LOGDIR"
RUNTMP="$(mktemp -d "${TMPDIR:-/tmp}/tio_offline.XXXXXX")"
PROFILE="$RUNTMP/profile"
SERVER_PID=""; CHROME_PID=""; WATCH_PID=""
WLOG="$LOGDIR/watchdog.log"

say() { echo "[tio] $*"; }
die() { echo "[tio] ERROR: $*" >&2; exit 1; }

find_node() {
  for c in "${NODE:-}" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/node-v*/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done; return 1
}
find_python() {  # $1=1: needs websocket-client
  for c in "${PYTHON:-}" /opt/homebrew/anaconda3/bin/python3 "$(command -v python3 2>/dev/null)" /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if [ "${1:-0}" = 1 ]; then "$c" -c "import websocket" 2>/dev/null || continue; fi
    echo "$c"; return 0
  done; return 1
}
find_chrome() {
  for c in "${CHROME:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done; return 1
}
free_port() {  # first port from $1 with nothing listening
  local p=$1
  while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p+1)); done
  echo "$p"
}

# pids to watch: the server and every process of this run's Chrome (matched by the temp profile path)
descendants() { local k; for k in $(pgrep -P "$1" 2>/dev/null); do echo "$k"; descendants "$k"; done; }
watched_pids() {
  local all="$SERVER_PID" cp=""
  [ -f "$RUNTMP/chrome.pid" ] && cp=$(cat "$RUNTMP/chrome.pid")
  all="$all $(pgrep -f -- "--user-data-dir=$PROFILE" 2>/dev/null | tr '\n' ' ')"
  [ -n "$cp" ] && kill -0 "$cp" 2>/dev/null && all="$all $cp $(descendants "$cp" | tr '\n' ' ')"
  echo $all | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u | tr '\n' ',' | sed 's/,$//'
}

kill_all() {
  local cp="$CHROME_PID"; [ -z "$cp" ] && [ -f "$RUNTMP/chrome.pid" ] && cp=$(cat "$RUNTMP/chrome.pid")
  if [ -n "$cp" ]; then local d; d=$(descendants "$cp"); kill -9 "$cp" $d 2>/dev/null; fi
  pkill -9 -f -- "--user-data-dir=$PROFILE" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill -9 "$SERVER_PID" 2>/dev/null
  return 0
}

# Every second: list all inet sockets of the watched pids. A socket is allowed only when every
# endpoint is 127.0.0.0/8 or [::1]. Anything else (including wildcard binds) kills the run.
watchdog() {
  local n=0 total=0 bad=0
  echo "# watchdog start $(date '+%F %T') profile=$PROFILE" >> "$WLOG"
  while :; do
    local P; P=$(watched_pids)
    if [ -n "$P" ]; then
      local out; out=$(lsof -nP -i -a -p "$P" 2>/dev/null | awk 'NR>1')
      local cnt=0 viol=""
      if [ -n "$out" ]; then
        cnt=$(printf "%s\n" "$out" | wc -l | tr -d ' ')
        viol=$(printf "%s\n" "$out" | awk '{
          name=""; for(i=1;i<NF;i++) if ($i=="TCP"||$i=="UDP") { name=$(i+1); break }
          if (name=="") { print; next }
          n=split(name, ep, "->"); ok=1
          for (j=1;j<=n;j++) { e=ep[j]; sub(/ .*/, "", e); h=e; sub(/:[^:]*$/, "", h)
            if (h !~ /^127\.[0-9]+\.[0-9]+\.[0-9]+$/ && h != "[::1]") ok=0 }
          if (!ok) print }')
      fi
      n=$((n+1)); total=$((total+cnt))
      echo "$(date +%T) sample=$n sockets=$cnt nonloopback=$( [ -n "$viol" ] && printf "%s\n" "$viol" | wc -l | tr -d ' ' || echo 0)" >> "$WLOG"
      if [ -n "$viol" ]; then
        { echo "!!! VIOLATION $(date '+%F %T'): non-loopback socket, killing everything"; printf "%s\n" "$viol"; } >> "$WLOG"
        kill_all; echo "VIOLATION" > "$LOGDIR/VIOLATION"; bad=1
        break
      fi
    fi
    sleep 1
  done
}

summary() {
  local s; s=$(grep -c '^[0-9].*sample=' "$WLOG" 2>/dev/null || echo 0)
  local v; v=$(awk -F'nonloopback=' '/sample=/{t+=$2} END{print t+0}' "$WLOG" 2>/dev/null)
  local mx; mx=$(awk -F'sockets=' '/sample=/{split($2,a," "); if(a[1]>m)m=a[1]} END{print m+0}' "$WLOG" 2>/dev/null)
  echo "# watchdog end $(date '+%F %T') samples=$s max_sockets=$mx nonloopback_total=$v" >> "$WLOG"
  say "watchdog: $s samples, max $mx sockets, $v non-loopback (log: $WLOG)"
}

cleanup() {
  trap - EXIT INT TERM
  [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null
  kill_all
  sleep 0.5
  summary
  rm -rf "$RUNTMP"
  say "stopped; logs in $LOGDIR"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

REQUIRED_FLAGS=(
  "--proxy-server=http://127.0.0.1:"
  "--proxy-bypass-list=<-loopback>"
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"
  "--user-data-dir=$PROFILE"
  "--no-first-run" "--no-default-browser-check" "--disable-background-networking"
  "--disable-component-update" "--disable-sync" "--disable-default-apps"
  "--disable-features=OptimizationHints,MediaRouter,Translate" "--metrics-recording-only"
)

# start_chrome PORT URL [extra flags...]
# DIRECT=1: the page itself is served from 127.0.0.1:PORT (play.sh); only that address bypasses the proxy,
# and the proxy is the same local server, so any other request still lands on it and nowhere else.
start_chrome() {
  local port=$1 url=$2; shift 2
  local bypass="<-loopback>"; [ "${DIRECT:-0}" = 1 ] && bypass="127.0.0.1:$port"
  local chrome; chrome=$(find_chrome) || die "Google Chrome not found (set CHROME=/path/to/binary)"
  local spki; spki=$(cat "$PKG/tls/spki.txt")
  local ARGS=(
    "--proxy-server=http://127.0.0.1:$port"
    "--proxy-bypass-list=$bypass"
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"
    "--user-data-dir=$PROFILE"
    "--no-first-run" "--no-default-browser-check" "--disable-background-networking"
    "--disable-component-update" "--disable-sync" "--disable-default-apps"
    "--disable-features=OptimizationHints,MediaRouter,Translate" "--metrics-recording-only"
    "--ignore-certificate-errors-spki-list=$spki"
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp" "--no-pings" "--disable-domain-reliability"
    "--disable-client-side-phishing-detection" "--disable-breakpad" "--use-mock-keychain" "--password-store=basic"
    "--window-size=1280,800" "--new-window"
    "$@"
  )
  # refuse to start unless every mandatory flag is present verbatim (proxy port prefix for the proxy flag)
  local f a found
  for f in "${REQUIRED_FLAGS[@]}"; do
    found=0
    for a in "${ARGS[@]}"; do
      if [ "$f" = "--proxy-server=http://127.0.0.1:" ]; then
        [[ "$a" =~ ^--proxy-server=http://127\.0\.0\.1:[0-9]+$ ]] && found=1
      elif [ "$f" = "--proxy-bypass-list=<-loopback>" ]; then
        [ "$a" = "--proxy-bypass-list=<-loopback>" ] && found=1
        [ "${DIRECT:-0}" = 1 ] && [ "$a" = "--proxy-bypass-list=127.0.0.1:$port" ] && found=1
      else
        [ "$a" = "$f" ] && found=1
      fi
    done
    [ $found = 1 ] || die "refusing to start Chrome: mandatory flag missing: $f"
  done
  for a in "${ARGS[@]}"; do
    case "$a" in --proxy-server=*) [[ "$a" =~ ^--proxy-server=http://127\.0\.0\.1:[0-9]+$ ]] || die "refusing: bad proxy flag $a";; esac
  done
  printf "%s\n" "$chrome" "${ARGS[@]}" "$url" > "$LOGDIR/chrome_cmdline.txt"
  mkdir -p "$PROFILE"
  "$chrome" "${ARGS[@]}" "$url" > "$LOGDIR/chrome.out" 2>&1 &
  CHROME_PID=$!; disown
  echo "$CHROME_PID" > "$RUNTMP/chrome.pid"
  say "Chrome pid $CHROME_PID (temp profile $PROFILE)"
}

start_watchdog() { watchdog & WATCH_PID=$!; disown; }

wait_listen() {  # port pid
  for i in $(seq 1 100); do
    lsof -nP -a -p "$2" -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | grep -q "127.0.0.1:$1" && return 0
    kill -0 "$2" 2>/dev/null || return 1
    sleep 0.1
  done; return 1
}

# block until Chrome exits, the watchdog fires, or the user hits Ctrl+C
wait_chrome() {
  while kill -0 "$CHROME_PID" 2>/dev/null; do
    [ -f "$LOGDIR/VIOLATION" ] && die "network violation, everything killed (see $WLOG)"
    kill -0 "$SERVER_PID" 2>/dev/null || { say "server exited"; break; }
    sleep 1
  done
  [ -f "$LOGDIR/VIOLATION" ] && die "network violation, everything killed (see $WLOG)"
  return 0
}
