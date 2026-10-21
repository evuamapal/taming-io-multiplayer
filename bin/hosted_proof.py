#!/usr/bin/env python3
# Two-browser proof for the hosted offline server (mimic/hosted_server.js): launches two headless Chromes
# on loopback, records every request each one attempts (CDP Network, auto-attached workers/frames) plus a
# socket watch, joins both to the same room, walks A, checks B sees A, brings B next to A, A hits B, checks
# B's HP drops (from B's decoded WS frames and the server log), then fetches every mirrored path through the
# server and greps the served text for third-party hosts. Writes logs/hosted_proof_<ts>/report.{json,md}.
# Usage: hosted_proof.py [--url http://127.0.0.1:8920/] [--room NAME] [--chrome system|playwright]
#        hosted_proof.py --dry     harness self test against a local http.server in work/
import argparse, base64, codecs, glob, json, os, re, shutil, signal, socket, subprocess, sys, threading, time, urllib.parse, urllib.request
import websocket

PKG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PKG, "decoder"))
import tio_proto as TP

ap = argparse.ArgumentParser()
ap.add_argument("--url", default=None, help="default http://127.0.0.1:<port>/")
ap.add_argument("--port", type=int, default=8920)
ap.add_argument("--server-pid", type=int, default=None, help="server pid for the socket watch (default: logs/hosted/server.pid, else the LISTEN pid on the port)")
ap.add_argument("--room", default=None, help="room name substring to pick (default: first room listed)")
ap.add_argument("--chrome", default="system", choices=["system", "playwright"])
ap.add_argument("--server-log", default=os.path.join(PKG, "logs", "hosted", "server.jsonl"))
ap.add_argument("--out", default=None)
ap.add_argument("--dry", action="store_true")
ap.add_argument("--milestone", type=int, default=2, choices=[1, 2], help="1: each browser alone (menu, Play, walk); 2: shared room, see + hit")
ap.add_argument("--no-grep", action="store_true")
ap.add_argument("--v01", action="store_true", help="rehearsal: own v0.1 mimic_server.js instance through its loopback proxy")
ap.add_argument("--reference", action="store_true", help="reference frames from the Saopaulo#5 human capture via offline_proxy.py (original bundle) -> logs/reference_frames/")
ap.add_argument("--ref-port", type=int, default=8935)
ap.add_argument("--ref-speed", type=float, default=2.0)
ap.add_argument("--ref-until", type=float, default=None, help="stop after this capture time (smoke runs)")
ap.add_argument("--capture", default=os.path.expanduser("/path/to/captures/human.jsonl.gz"))
ap.add_argument("--keep-profiles", action="store_true")
ap.add_argument("--no-sweep", action="store_true", help="skip the menu click sweep")
ap.add_argument("--webgl", action="store_true", help="browser A: turn on the WebGL setting, play 20 s, list unmirrored assets (default in milestone 2)")
ap.add_argument("--no-webgl", action="store_true")
ap.add_argument("--social", action="store_true", help="clan create/join/accept/chat through the client UI, then age-up pick, hotbar and placement (default in milestone 2)")
ap.add_argument("--no-social", action="store_true")
ap.add_argument("--visual", action="store_true", help="clone frames of the reference features -> visual/<feature>_ref.png / _clone.png (needs --own-server: test hooks)")
ap.add_argument("--own-server", type=int, default=None, metavar="PORT", help="start a private mimic/hosted_server.js on PORT for this run and stop it after")
A = ap.parse_args()
if A.visual and not A.own_server: raise SystemExit("--visual needs --own-server (it turns on the server test hooks)")
if A.reference and A.ref_port in (8920, 8921, 8923): raise SystemExit("--ref-port must be a private port")
A.social = (A.social or (A.milestone == 2 and not A.dry and not A.v01)) and not A.no_social
A.webgl = (A.webgl or (A.milestone == 2 and not A.dry and not A.v01)) and not A.no_webgl
if A.own_server:
    if A.own_server in (8920, 8921): raise SystemExit("--own-server must not use a shared port")
    A.port = A.own_server; A.url = None
if not A.url: A.url = "http://127.0.0.1:%d/" % A.port

TS = time.strftime("%Y%m%d_%H%M%S")
OUT = A.out or os.path.join(PKG, "logs", ("hosted_proof_dry_" if A.dry else "hosted_proof_v01_" if A.v01 else "reference_run_" if A.reference else "hosted_proof_") + TS)
PROF = os.path.join(PKG, "work", "proof_profiles", TS)
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
LOG = open(os.path.join(OUT, "proof.jsonl"), "w")
NOPROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))
LOCK = threading.Lock()

def mark(k, **kw):
    kw.update({"k": k, "t": round(time.time() - T0, 2)})
    with LOCK:
        LOG.write(json.dumps(kw, ensure_ascii=False, default=str) + "\n"); LOG.flush()
    print("[%6.1f] %s %s" % (kw["t"], k, json.dumps(kw, ensure_ascii=False, default=str)[:240]), flush=True)

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def chrome_bin():
    if A.chrome == "system":
        return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    c = sorted(glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/*")))
    if not c: raise SystemExit("playwright chromium not found")
    return c[-1]

FLAGS = [
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--no-proxy-server", "--headless=new",
    "--remote-debugging-address=127.0.0.1", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--disable-default-apps", "--no-first-run", "--no-default-browser-check",
    "--disable-domain-reliability", "--no-pings", "--disable-features=OptimizationHints,MediaRouter,Translate",
    "--metrics-recording-only", "--use-mock-keychain", "--password-store=basic", "--window-size=1280,800",
    "--disable-client-side-phishing-detection", "--disable-breakpad",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
]

# client game-loop errors: the patched bundle reports caught update-loop exceptions to window.__mimErr
ERR_HOOK = "window.__errs=[];window.__mimErr=function(s){if(window.__errs.length<50)window.__errs.push(String(s).slice(0,1500));};"
WEBGL_FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
# records every canvas context the page asks for (type, size, WebGL renderer)
CTX_HOOK = """(function(){if(window.__proofCtx)return;window.__proofCtx=[];function wrap(P){if(!P||!P.getContext)return;var g=P.getContext;
P.getContext=function(t){var c=g.apply(this,arguments);try{var r={type:String(t),w:this.width,h:this.height,ok:!!c,t:Date.now()};
if(c&&/webgl/i.test(t)){try{var d=c.getExtension('WEBGL_debug_renderer_info');r.renderer=String(c.getParameter(d?d.UNMASKED_RENDERER_WEBGL:c.RENDERER));r.version=String(c.getParameter(c.VERSION));}catch(e){}}
var L=window.__proofCtx;if(L.length<200&&!L.some(function(x){return x.type===r.type&&x.w===r.w&&x.h===r.h&&x.ok===r.ok}))L.push(r);}catch(e){}return c;};}
wrap(window.HTMLCanvasElement&&HTMLCanvasElement.prototype);wrap(window.OffscreenCanvas&&OffscreenCanvas.prototype);})();"""

# ---------------------------------------------------------------- CDP (one browser-level socket, flat sessions)
class Browser:
    def __init__(self, tag):
        self.tag = tag
        self.prof = os.path.join(PROF, tag)
        os.makedirs(self.prof, exist_ok=True)
        self.port = free_port()
        self.clog = open(os.path.join(OUT, "chrome_%s.log" % tag), "w")
        fl = FLAGS + (WEBGL_FLAGS if A.webgl else [])
        if V01:
            fl = [f for f in FLAGS if f != "--no-proxy-server"] + ["--proxy-server=http://127.0.0.1:%d" % V01, "--proxy-bypass-list=<-loopback>",
                  "--ignore-certificate-errors-spki-list=" + open(os.path.join(PKG, "tls", "spki.txt")).read().strip()]
        self.proc = subprocess.Popen([chrome_bin()] + fl + ["--remote-debugging-port=%d" % self.port, "--user-data-dir=" + self.prof, "about:blank"],
                                     stdout=self.clog, stderr=subprocess.STDOUT, start_new_session=True)
        self.id, self.wait, self.sessions = 0, {}, {}
        self.reqs = {}          # requestId -> record
        self.order = []         # records in order
        self.skipped = {"data": 0, "blob": 0, "other": 0}
        self.console = []
        self.ws_frames = []     # decoded server->client records: (t, requestId, rec)
        self.rx = {}            # requestId -> TP.RxStream
        self.frame_err = 0
        self.page_sid = None
        self.sent = []          # client -> server JSON messages (decoded)
        self.tx = {}            # requestId -> client xor state
        self.tids = set()
        self.navs = []          # top-frame navigations (t, url)
        self.popups = []        # targets created after start (t, type, url)
        self.popup_tids = []
        self.page_tid = None
        self.sw = []            # service worker registrations seen
        self.started = False
        self.cb = []            # per-message callbacks for decoded records
        ver = None
        for _ in range(150):
            try: ver = json.load(NOPROXY.open("http://127.0.0.1:%d/json/version" % self.port, timeout=1)); break
            except Exception: time.sleep(0.2)
        if not ver: raise SystemExit("chrome %s: no DevTools on 127.0.0.1:%d" % (tag, self.port))
        self.version = ver.get("Browser")
        self.ws = websocket.create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=None)
        threading.Thread(target=self.loop, daemon=True).start()
        self.call("Target.setDiscoverTargets", {"discover": True})
        self.call("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True})
        for _ in range(100):
            if self.page_sid and self.sessions[self.page_sid].get("ready"): break
            time.sleep(0.1)
        if not self.page_sid: raise SystemExit("chrome %s: no page target" % tag)
        self.started = True
        mark("browser_up", tag=tag, pid=self.proc.pid, port=self.port, version=self.version)

    def send(self, m, p=None, sid=None):
        with LOCK:
            self.id += 1; i = self.id
            ev = self.wait[i] = [threading.Event(), None]
        msg = {"id": i, "method": m, "params": p or {}}
        if sid: msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        return ev
    def call(self, m, p=None, sid=None, timeout=20):
        ev = self.send(m, p, sid)
        ev[0].wait(timeout)
        return ev[1]
    def pcall(self, m, p=None, timeout=20):
        return self.call(m, p, self.page_sid, timeout)
    def js(self, expr):
        r = self.pcall("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}) or {}
        return (r.get("result") or {}).get("value")

    def setup_session(self, sid, info):
        # runs on its own thread: the reader thread must stay free to deliver the replies
        with LOCK:
            dup = info.get("targetId") in self.tids
            self.tids.add(info.get("targetId"))
        if dup:   # same target reached through a second auto-attach path: the first session records it
            self.call("Runtime.runIfWaitingForDebugger", {}, sid, timeout=5)
            self.send("Target.detachFromTarget", {"sessionId": sid})
            return
        self.sessions[sid] = {"type": info.get("type"), "url": info.get("url"), "ready": False}
        for m, p in (("Network.enable", {"maxPostDataSize": 0}), ("Runtime.enable", {}), ("Log.enable", {}),
                     ("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True})):
            self.call(m, p, sid, timeout=10)
        if info.get("type") == "page":
            self.call("Page.enable", {}, sid, timeout=10)
            self.call("Emulation.setFocusEmulationEnabled", {"enabled": True}, sid, timeout=10)
            self.call("ServiceWorker.enable", {}, sid, timeout=10)
            if A.webgl: self.call("Page.addScriptToEvaluateOnNewDocument", {"source": CTX_HOOK}, sid, timeout=10)
            if not A.reference: self.call("Page.addScriptToEvaluateOnNewDocument", {"source": ERR_HOOK}, sid, timeout=10)
        self.call("Runtime.runIfWaitingForDebugger", {}, sid, timeout=10)
        self.sessions[sid]["ready"] = True
        if info.get("type") == "page" and not self.page_sid: self.page_sid = sid; self.page_tid = info.get("targetId")
        mark("attached", tag=self.tag, type=info.get("type"), url=(info.get("url") or "")[:200])

    def rec_url(self, url, rid, kind, sid):
        sch = url.split(":", 1)[0].lower()
        if sch in ("data", "blob"):
            self.skipped[sch] += 1; return
        r = {"url": url, "kind": kind, "status": None, "fail": None, "t": round(time.time() - T0, 2),
             "target": self.sessions.get(sid, {}).get("type", "browser") if sid else "browser"}
        self.reqs[(sid, rid)] = r; self.order.append(r)

    def loop(self):
        while True:
            try: raw = self.ws.recv()
            except Exception: break
            try: m = json.loads(raw)
            except Exception: continue
            if "id" in m and m["id"] in self.wait:
                w = self.wait.pop(m["id"]); w[1] = m.get("result", m.get("error")); w[0].set(); continue
            meth, p, sid = m.get("method"), m.get("params", {}), m.get("sessionId")
            try: self.event(meth, p, sid)
            except Exception as e: mark("event_err", tag=self.tag, meth=meth, err=str(e)[:200])

    def event(self, meth, p, sid):
        if meth == "Target.attachedToTarget":
            threading.Thread(target=self.setup_session, args=(p["sessionId"], p.get("targetInfo", {})), daemon=True).start()
        elif meth == "Network.requestWillBeSent":
            rid = p.get("requestId"); url = p.get("request", {}).get("url", "")
            old = self.reqs.get((sid, rid))
            if old and p.get("redirectResponse"):
                old["status"] = p["redirectResponse"].get("status")
            self.rec_url(url, rid, p.get("type") or "req", sid)
        elif meth == "Network.responseReceived":
            r = self.reqs.get((sid, p.get("requestId")))
            if r:
                rs = p.get("response", {})
                r["status"] = rs.get("status"); r["mime"] = rs.get("mimeType")
                h = {k.lower(): v for k, v in (rs.get("headers") or {}).items()}
                r["clen"] = h.get("content-length")
                r["hdr"] = {k: h.get(k) for k in ("referrer-policy", "x-dns-prefetch-control", "permissions-policy")}
                r["csp"] = h.get("content-security-policy")
                if r["csp"] is None and h.get("content-security-policy-report-only"): r["csp"] = "report-only: " + h["content-security-policy-report-only"]
        elif meth == "Network.loadingFailed":
            r = self.reqs.get((sid, p.get("requestId")))
            if r: r["fail"] = p.get("errorText") + ((" blocked:" + p["blockedReason"]) if p.get("blockedReason") else "") + ((" cors:" + str(p["corsErrorStatus"])) if p.get("corsErrorStatus") else "")
        elif meth == "Network.webSocketCreated":
            self.rec_url(p.get("url", ""), p.get("requestId"), "WebSocket", sid)
            self.rx[p.get("requestId")] = TP.RxStream()
        elif meth == "Network.webSocketHandshakeResponseReceived":
            r = self.reqs.get((sid, p.get("requestId")))
            if r: r["status"] = p.get("response", {}).get("status")
        elif meth == "Network.webSocketClosed":
            r = self.reqs.get((sid, p.get("requestId")))
            if r: r["closed_t"] = round(time.time() - T0, 2)
        elif meth == "Network.webSocketFrameError":
            r = self.reqs.get((sid, p.get("requestId")))
            if r: r["fail"] = "frame error: " + str(p.get("errorMessage"))
        elif meth == "Network.webSocketFrameSent":
            # client -> server: every byte XOR (1 + s%254), s starts at 0 per socket (mimic/codec.js); JSON when it starts with [ or {
            fr = p.get("response", {}); rid = p.get("requestId")
            if len(self.sent) >= 20000: return
            try:
                if fr.get("opcode") == 1: msg = json.loads(fr.get("payloadData", ""))
                else:
                    raw = base64.b64decode(fr.get("payloadData", ""))
                    plain, self.tx[rid] = TP.tx_unxor(raw, self.tx.get(rid, 0))
                    msg = json.loads(plain.decode("utf-8")) if plain[:1] in (b"[", b"{") else None
                if msg is not None:
                    for m in (msg if isinstance(msg, list) else [msg]): self.sent.append((round(time.time() - T0, 2), m))
            except Exception: pass
        elif meth == "Network.webSocketFrameReceived":
            fr = p.get("response", {})
            rid = p.get("requestId")
            if fr.get("opcode") != 2: return
            st = self.rx.setdefault(rid, TP.RxStream())
            try:
                plain = st.unxor(base64.b64decode(fr.get("payloadData", "")))
                recs = TP.parse_frame(plain)
            except Exception as e:
                self.frame_err += 1; return
            t = time.time() - T0
            for rec in recs:
                self.ws_frames.append((t, rid, rec))
                for f in self.cb: f(t, rec)
        elif meth == "Runtime.consoleAPICalled":
            if p.get("type") in ("error", "warning", "assert"):
                txt = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
                self.console.append({"src": "console." + p.get("type"), "text": txt[:400], "t": round(time.time() - T0, 2)})
        elif meth == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            self.console.append({"src": "exception", "text": str((d.get("exception") or {}).get("description", d.get("text")))[:400], "t": round(time.time() - T0, 2)})
        elif meth == "Log.entryAdded":
            e = p.get("entry", {})
            if e.get("source") == "security" and "Content Security Policy" in str(e.get("text")):
                for u in re.findall(r"'((?:https?|wss?)://[^']+)'", str(e.get("text"))):
                    now = time.time() - T0
                    if any(q["url"] == u and now - q["t"] < 2 for q in self.order[-50:]): continue   # already seen as a Network request
                    r = {"url": u, "kind": "csp_blocked", "status": None, "fail": "blocked by CSP", "t": round(time.time() - T0, 2),
                         "target": self.sessions.get(sid, {}).get("type", "browser") if sid else "browser"}
                    self.order.append(r)
            if e.get("level") in ("error", "warning") or e.get("source") in ("security", "network", "violation"):
                self.console.append({"src": "log." + str(e.get("source")) + "." + str(e.get("level")), "text": str(e.get("text"))[:400], "url": e.get("url"), "t": round(time.time() - T0, 2)})
        elif meth == "Page.frameNavigated":
            fr = p.get("frame", {})
            if not fr.get("parentId"): self.navs.append((round(time.time() - T0, 2), fr.get("url", "") + (fr.get("urlFragment") or "")))
        elif meth == "Page.windowOpen":
            self.popups.append((round(time.time() - T0, 2), "windowOpen", p.get("url")))
        elif meth in ("Target.targetCreated", "Target.targetInfoChanged"):
            ti = p.get("targetInfo", {})
            if self.started and ti.get("type") in ("page", "iframe", "other") and meth == "Target.targetCreated":
                self.popups.append((round(time.time() - T0, 2), ti.get("type"), ti.get("url")))
                if ti.get("type") == "page": self.popup_tids.append(ti.get("targetId"))
        elif meth == "ServiceWorker.workerRegistrationUpdated":
            for r in p.get("registrations", []):
                if not r.get("isDeleted"): self.sw.append(r.get("scopeURL"))

    # ---- input
    KEYS = {"w": ("KeyW", 87), "a": ("KeyA", 65), "s": ("KeyS", 83), "d": ("KeyD", 68), " ": ("Space", 32), "Enter": ("Enter", 13), "Escape": ("Escape", 27)}
    KEYS.update({str(i): ("Digit%d" % i, 48 + i) for i in range(10)})
    def key(self, typ, k):
        code, vk = self.KEYS.get(k, ("Key" + k.upper(), ord(k.upper()[0])))
        p = {"type": typ, "key": k, "code": code, "windowsVirtualKeyCode": vk}
        if len(k) == 1: p["nativeVirtualKeyCode"] = vk
        if typ == "keyDown" and len(k) == 1: p["text"] = k
        if typ == "keyDown" and k == "Enter": p["text"] = "\r"
        self.pcall("Input.dispatchKeyEvent", p)
    def mouse(self, typ, x, y):
        p = {"type": typ, "x": x, "y": y}
        if typ != "mouseMoved": p.update({"button": "left", "clickCount": 1})
        else: p["button"] = "none"
        self.pcall("Input.dispatchMouseEvent", p)
    def click(self, x, y):
        self.mouse("mouseMoved", x, y); self.mouse("mousePressed", x, y); self.mouse("mouseReleased", x, y)
    def shot(self, name):
        r = self.pcall("Page.captureScreenshot", {"format": "png"}, timeout=30) or {}
        ok = bool(r.get("data"))
        if ok: open(os.path.join(OUT, "%s_%s.png" % (name, self.tag)), "wb").write(base64.b64decode(r["data"]))
        return ok

    def pids(self):
        out = {self.proc.pid}
        try: out |= {int(x) for x in subprocess.run(["pgrep", "-f", "--", "--user-data-dir=" + self.prof], capture_output=True, text=True).stdout.split()}
        except Exception: pass
        todo = list(out)
        while todo:
            p = todo.pop()
            for c in subprocess.run(["pgrep", "-P", str(p)], capture_output=True, text=True).stdout.split():
                c = int(c)
                if c not in out: out.add(c); todo.append(c)
        return out
    def close(self):
        try: self.call("Browser.close", timeout=5)
        except Exception: pass
        try: self.proc.wait(5)
        except Exception: pass
        for p in self.pids():
            try: os.kill(p, signal.SIGKILL)
            except Exception: pass
        try: self.ws.close()
        except Exception: pass

    def hosts(self):
        out = {}
        for r in self.order:
            u = urllib.parse.urlsplit(r["url"])
            if u.scheme in ("http", "https", "ws", "wss"):
                port = u.port or {"http": 80, "ws": 80, "https": 443, "wss": 443}[u.scheme]
                hp = "%s:%d" % (u.hostname, port)
            else:
                continue
            out[hp] = out.get(hp, 0) + 1
        return out
    def internal(self):
        # chrome:// and chrome-extension:// loads of Chrome's own UI targets (no network)
        out = {}
        for r in self.order:
            sch = urllib.parse.urlsplit(r["url"]).scheme
            if sch not in ("http", "https", "ws", "wss"): out[sch + ":"] = out.get(sch + ":", 0) + 1
        return out

# ---------------------------------------------------------------- socket watch (lsof every second)
class SockWatch:
    def __init__(self, pidfn):
        self.pidfn = pidfn; self.samples = 0; self.max = 0; self.bad = []; self.stop = False; self.pids_seen = set()
        threading.Thread(target=self.run, daemon=True).start()
    def run(self):
        while not self.stop:
            try: pids = set(self.pidfn())
            except Exception: pids = set()
            self.pids_seen |= pids
            if pids:
                out = subprocess.run(["lsof", "-nP", "-i", "-a", "-p", ",".join(map(str, sorted(pids)))], capture_output=True, text=True).stdout.splitlines()[1:]
                self.samples += 1; self.max = max(self.max, len(out))
                for line in out:
                    m = re.search(r"(TCP|UDP) (\S+)", line)
                    if not m: self.bad.append(line); continue
                    for ep in m.group(2).split("->"):
                        h = ep.rsplit(":", 1)[0]
                        if not (re.match(r"^127\.\d+\.\d+\.\d+$", h) or h == "[::1]"):
                            self.bad.append(line); break
            time.sleep(1)

def server_pids(port):
    if A.server_pid: return {A.server_pid}
    pids = set()
    try:
        if A.port != 8920 or A.url != "http://127.0.0.1:8920/": raise ValueError("pid file is for the default instance")
        p = int(open(os.path.join(PKG, "logs", "hosted", "server.pid")).read().split()[0]); os.kill(p, 0); pids.add(p)
    except Exception: pass
    if not pids:
        pids = {int(x) for x in subprocess.run(["lsof", "-nP", "-t", "-iTCP:%d" % port, "-sTCP:LISTEN"], capture_output=True, text=True).stdout.split()}
    return pids

# ---------------------------------------------------------------- menu click sweep
MARK_JS = """(function(){var out=[];var all=document.querySelectorAll('[data-proof-i]');for(var j=0;j<all.length;j++)all[j].removeAttribute('data-proof-i');
all=document.querySelectorAll('body *');var n=0;
for(var i=0;i<all.length;i++){var e=all[i];var cs=getComputedStyle(e);
 var c=e.tagName=='A'||e.tagName=='BUTTON'||e.hasAttribute('onclick')||e.getAttribute('role')=='button'||(e.tagName=='INPUT'&&/^(submit|button|image|reset)$/i.test(e.type))||cs.cursor=='pointer'||/(^|[ -])(button|clickable)/i.test(String(e.className))||/-button$/.test(e.id);
 if(!c)continue;
 if(cs.cursor=='pointer'&&e.tagName!='A'&&e.tagName!='BUTTON'&&!e.hasAttribute('onclick')&&e.parentElement&&getComputedStyle(e.parentElement).cursor=='pointer')continue;
 if(cs.visibility=='hidden'||cs.display=='none')continue;
 var b=e.getBoundingClientRect();if(!b.width||!b.height)continue;
 if(b.right<=0||b.bottom<=0||b.left>=innerWidth||b.top>=innerHeight)continue;
 e.setAttribute('data-proof-i',n);out.push({i:n,tag:e.tagName,id:e.id,cls:String(e.className).slice(0,40),txt:(e.innerText||e.alt||e.title||e.value||'').trim().replace(/\\s+/g,' ').slice(0,40),href:e.getAttribute('href')});n++;}
return out;})()"""
HIT_JS = """(function(i){var e=document.querySelector('[data-proof-i="'+i+'"]');if(!e)return null;var b=e.getBoundingClientRect();if(!b.width)return null;
var x=Math.min(Math.max(b.x+b.width/2,1),innerWidth-1),y=Math.min(Math.max(b.y+b.height/2,1),innerHeight-1);var h=document.elementFromPoint(x,y);
return {x:x,y:y,top:!!h&&(h===e||e.contains(h)||h.contains(e))};})(%d)"""

POPUP_CONTINUE = ("#update-continue-button", "#popup-offer-continue-button", "#scoreboard-continue-button", "#quit-blo-box")
def dismiss_popups(b):
    # menu splash popups (update news, offers) cover the menu buttons
    n = 0
    for _ in range(3):
        hit = False
        for sel in POPUP_CONTINUE:
            r = b.js(VISIBLE % json.dumps(sel))
            if r: b.click(r[0], r[1]); time.sleep(0.6); hit = True; n += 1
        if not hit: break
    return n

def load_menu(b, base):
    b.pcall("Page.navigate", {"url": base})
    ok = wait_for(lambda: b.js(VISIBLE % json.dumps("#play-box")), 45)
    time.sleep(0.8); dismiss_popups(b)
    return ok

def sweep(b, base, res):
    origin = urllib.parse.urlsplit(base).netloc
    n0, nav0, pop0 = len(b.order), len(b.navs), len(b.popups)
    items = b.js(MARK_JS) or []
    done = []
    for it in items:
        h = b.js(HIT_JS % it["i"])
        if not h or not h.get("top"):
            load_menu(b, base); time.sleep(0.5); b.js(MARK_JS)
            h = b.js(HIT_JS % it["i"])
        if not h or not h.get("top"):
            done.append(dict(it, result="not_clickable_after_reload")); continue
        url0 = b.js("location.href")
        b.click(h["x"], h["y"]); time.sleep(0.7)
        for tid in b.popup_tids:   # popups can load the game and hold a server socket: close them right away
            if tid and tid != b.page_tid:
                try: b.call("Target.closeTarget", {"targetId": tid}, timeout=5)
                except Exception: pass
        b.popup_tids = []
        url1 = b.js("location.href")
        r = dict(it, result="clicked")
        if url1 != url0:
            r["navigated_to"] = url1
            load_menu(b, base); time.sleep(0.5); b.js(MARK_JS)
        done.append(r)
    for tid in b.popup_tids:
        if tid and tid != b.page_tid:
            try: b.call("Target.closeTarget", {"targetId": tid}, timeout=5)
            except Exception: pass
    b.popup_tids = []
    hosts = {}
    for q in b.order[n0:]:
        u = urllib.parse.urlsplit(q["url"])
        if u.scheme in ("http", "https", "ws", "wss") and u.netloc != origin: hosts[u.netloc] = hosts.get(u.netloc, 0) + 1
    off_nav = [u for t, u in b.navs[nav0:] if urllib.parse.urlsplit(u).netloc != origin]
    off_pop = [(typ, u) for t, typ, u in b.popups[pop0:] if u and urllib.parse.urlsplit(u).netloc not in (origin, "")]
    res[b.tag] = {"found": len(items), "clicked": sum(1 for d in done if d["result"] == "clicked"), "navigations": [d for d in done if d.get("navigated_to")],
                  "offorigin_requests": hosts, "offorigin_navs": off_nav, "popups": b.popups[pop0:], "offorigin_popups": off_pop,
                  "requests_during": len(b.order) - n0, "items": done}

# ---------------------------------------------------------------- game state from decoded frames
MISC_TYPES = {27, 36, 37, 39, 68}
T_REMOVE = 87

class View:
    # what one browser learned from its own WS frames
    def __init__(self, b):
        self.b = b; self.ents = {}; self.creates = []; self.own = []; self.lock = threading.Lock()
        self.misc = []   # (t, msg) for xp 27, item_count 36, counters 37, chat 39, clan 68, placed list
        b.cb.append(self.on)
    def on(self, t, rec):
        with self.lock:
            if rec.get("kind") == "c0":
                e = self.ents.setdefault(rec["id"], {"id": rec["id"], "pos": [], "hp": []})
                if "3" in rec and "4" in rec: e["pos"].append((round(t, 2), rec["3"], rec["4"]))
                return
            if rec.get("kind") != "mp": return
            m = rec["msg"]
            ms = m if isinstance(m, list) else [m]
            for x in ms:
                if not isinstance(x, dict): continue
                if "id" in x and "s" in x and "0" not in x:
                    self.own.append((round(t, 2), x.get("1"), x["id"], x["s"]))
                if "0" not in x:
                    if x.get("1") in MISC_TYPES and len(self.misc) < 20000: self.misc.append((round(t, 2), x))
                    continue
                i = x["0"]
                e = self.ents.setdefault(i, {"id": i, "pos": [], "hp": []})
                if x.get("1") == T_REMOVE: e["removed_t"] = round(t, 2)
                if "14" in x: e.setdefault("f14", []).append((round(t, 2), x["14"]))
                if "8" in x and x.get("1") != T_REMOVE: e.setdefault("f8", []).append((round(t, 2), x["8"]))
                if "2" in x:
                    e.pop("removed_t", None)
                    e["create"] = {k: v for k, v in x.items() if k in ("1", "2", "3", "4", "12", "13", "14", "16", "18")}
                    e["create_t"] = round(t, 2)
                    self.creates.append((round(t, 2), i, x.get("1"), x.get("2"), x.get("18")))
                if "3" in x and "4" in x: e["pos"].append((round(t, 2), x["3"], x["4"]))
                if "12" in x: e["hp"].append((round(t, 2), x["12"]))
    def by_name(self, name):
        with self.lock:
            for e in self.ents.values():
                c = e.get("create") or {}
                if c.get("2") == 1 and str(c.get("18", "")).strip() == name: return dict(e)
        return None
    def self_id(self):
        with self.lock:
            for t, typ, v, s in reversed(self.own):
                if s is False: return v // 256
        return None
    def ent(self, i):
        with self.lock:
            e = self.ents.get(i); return dict(e, pos=list(e["pos"]), hp=list(e["hp"]), f14=list(e.get("f14", [])), f8=list(e.get("f8", []))) if e else None
    def msgs(self, typ, since=0):
        with self.lock:
            return [(t, m) for t, m in self.misc if m.get("1") == typ and t >= since]
    def xp(self):
        x = self.msgs(27)
        return x[-1][1].get("i", 0) if x else 0
    def statics(self):
        with self.lock:
            return [dict(e) for e in self.ents.values() if (e.get("create") or {}).get("2") == 3 and "removed_t" not in e]
    def pos(self, i):
        e = self.ent(i)
        return e["pos"][-1][1:] if e and e["pos"] else None

# ---------------------------------------------------------------- server log tail
class ServerLog:
    def __init__(self, path):
        self.path = path
        try: self.off = os.path.getsize(path)
        except Exception: self.off = 0
    def read(self):
        out = []
        try:
            with open(self.path, "rb") as f:
                f.seek(self.off)
                for line in f.read().decode("utf-8", "replace").splitlines():
                    try: out.append(json.loads(line))
                    except Exception: pass
        except Exception: pass
        return out

# ---------------------------------------------------------------- report
STEPS = []
def step(name, ok, **ev):
    STEPS.append({"step": name, "ok": bool(ok), "evidence": ev})
    mark("STEP", step=name, ok=bool(ok), **{k: v for k, v in ev.items() if k != "big"})

VISIBLE = "(function(s){var e=document.querySelector(s);if(!e||e.offsetParent===null)return null;var b=e.getBoundingClientRect();if(!b.width)return null;return [b.x+b.width/2,b.y+b.height/2];})(%s)"

def wait_for(fn, secs, every=0.25):
    end = time.time() + secs
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(every)
    return None

OPEN_LIST_JS = "(function(){var e=document.querySelector('#server-name');if(!e||!e.parentElement)return null;var p=e.parentElement.parentElement||e.parentElement;var b=p.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2];})()"
def pick_room(x, room):
    # open the server list, click the row naming the room, until #server-name shows it
    for i in range(5):
        if (x.js("(document.querySelector('#server-name')||{}).innerText") or "").strip() == room and i: return i
        if not x.js(VISIBLE % json.dumps("#server-list-container")):
            r = x.js(OPEN_LIST_JS)
            if r: x.click(r[0], r[1]); time.sleep(1.2)
        r = x.js("""(function(name){var c=document.querySelector('#server-list-container');if(!c)return null;var n=c.children;
          for(var i=0;i<n.length;i++){var t=(n[i].innerText||'').replace(/\\s+/g,' ');if(t.indexOf(name)>=0&&n[i].offsetParent!==null){var b=n[i].getBoundingClientRect();if(b.width)return [b.x+b.width/2,b.y+b.height/2];}}return null;})(%s)""" % json.dumps(room))
        if r: x.click(r[0], r[1]); time.sleep(1.2)
        q = x.js(VISIBLE % json.dumps("#quit-server-info-box"))
        if q: x.click(q[0], q[1]); time.sleep(0.6)
        if (x.js("(document.querySelector('#server-name')||{}).innerText") or "").strip() == room: return i + 1
    return 0

def menu_rooms(b):
    return b.js("""(function(){var c=document.querySelector('#server-list-container');var rows=[];
      if(c){var n=c.children;for(var i=0;i<n.length;i++){var t=(n[i].innerText||'').trim();if(t&&t.length<300)rows.push(t.replace(/\\s+/g,' '));}}
      var sel=document.querySelectorAll('select');var opts=[];for(var j=0;j<sel.length;j++)for(var k=0;k<sel[j].options.length;k++)opts.push({sel:sel[j].id,v:sel[j].options[k].value,t:sel[j].options[k].text});
      return {container:!!c,rows:rows.slice(0,60),selects:opts.slice(0,60),text:(document.body&&document.body.innerText||'').slice(0,3000)};})()""")

def walk_to(b, vb, me, target, near=90, secs=40):
    # closed loop on b's own decoded positions: press the w/a/s/d combination that points at the target;
    # when no progress for ~1 s (blocked by a tree or rock), sidestep perpendicular for a moment
    held, end, last, hist, detour, side = set(), time.time() + secs, None, [], 0, 0
    def press(want):
        nonlocal held
        for k in held - want: b.key("keyUp", k)
        for k in want - held: b.key("keyDown", k)
        held = set(want)
    try:
        while time.time() < end:
            p, q = vb.pos(me), vb.pos(target)
            if not p or not q: time.sleep(0.2); continue
            dx, dy = q[0] - p[0], q[1] - p[1]
            last = (round((dx * dx + dy * dy) ** 0.5), p, q)
            if last[0] <= near: break
            now = time.time()
            hist = [h for h in hist if now - h[0] < 1.2] + [(now, p)]
            if detour > now:
                time.sleep(0.12); continue
            if len(hist) > 6 and now - hist[0][0] > 1.0 and abs(hist[0][1][0] - p[0]) + abs(hist[0][1][1] - p[1]) < 25:
                side += 1
                if abs(dx) > abs(dy): want = {"w" if side % 2 else "s"}
                else: want = {"a" if side % 2 else "d"}
                press(want); detour = now + 0.5 + 0.25 * min(side, 6); hist = []
                continue
            want = set()
            if dx > 30: want.add("d")
            elif dx < -30: want.add("a")
            if dy > 30: want.add("s")
            elif dy < -30: want.add("w")
            press(want)
            time.sleep(0.12)
    finally:
        for k in held: b.key("keyUp", k)
    return last

def screen_center(b):
    return b.js("[window.innerWidth/2, window.innerHeight/2]") or [640, 400]

# ---------------------------------------------------------------- static grep of served files
REAL = codecs.decode("gnzvat.vb", "rot13")   # the real game host, kept out of the source text
TLDS = "com|net|org|io|gg|co|uk|de|ru|fr|me|app|dev|xyz|info|tv|ly|be|us|cn|jp|br|it|es|nl|pl|in|ca|au|eu|ai|cloud|site|online|biz|ws|to|fm|am|cc|su|ir|tr|kr|ch|se|no|fi|dk|cz|at|pt|gr|ro|hu|ua|by|kz|vn|id|th|my|sg|hk|tw|nz|za|mx|ar|cl|pe|ve|edu|gov|mil|int|google|amazon|invalid"
HOST_RE = re.compile(r"(?<![A-Za-z0-9_\-.@/\\])((?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+(?:%s))(?![A-Za-z0-9_\-])" % TLDS, re.I)
TEXTY = re.compile(r"text/|javascript|json|xml|css|svg|html", re.I)

def static_grep(base):
    idx = os.path.join(PKG, "mirror", "index.jsonl")
    paths, seen = [], set()
    for line in open(idx):
        try: r = json.loads(line)
        except Exception: continue
        u = urllib.parse.urlsplit(r["url"])
        p = (u.path or "/") + (("?" + u.query) if u.query else "")
        key = (u.hostname, p)
        if key in seen: continue
        seen.add(key); paths.append((r["url"], p, r.get("mime", "")))
    res = {"fetched": 0, "status": {}, "text_files": 0, "bytes": 0, "real_host": 0, "invalid_host": 0,
           "hosts": {}, "examples": {"real_host": [], "invalid_host": []}}
    for orig, p, mime in paths:
        url = base.rstrip("/") + p
        try:
            r = NOPROXY.open(url, timeout=10); code = r.status; body = r.read(); ct = r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            code, body, ct = e.code, b"", ""
        except Exception as e:
            code, body, ct = "err:" + type(e).__name__, b"", ""
        res["fetched"] += 1; res["status"][str(code)] = res["status"].get(str(code), 0) + 1
        if not body or not (TEXTY.search(ct) or TEXTY.search(mime or "")): continue
        res["text_files"] += 1; res["bytes"] += len(body)
        s = body.decode("utf-8", "replace")
        for pat, k in ((REAL, "real_host"), ("taming.invalid", "invalid_host")):
            n = len(re.findall(re.escape(pat) + r"(?![A-Za-z0-9])", s, re.I))
            res[k] += n
            if n and len(res["examples"][k]) < 8:
                i = s.lower().find(pat)
                res["examples"][k].append({"path": p[:120], "n": n, "ctx": s[max(0, i - 60):i + 60].replace("\n", " ")})
        for h in set(x.lower() for x in HOST_RE.findall(s)):
            if h in ("127.0.0.1",): continue
            e = res["hosts"].setdefault(h, {"files": 0, "example": p[:120]})
            e["files"] += 1
    res["hosts_n"] = len(res["hosts"])
    res["hosts"] = dict(sorted(res["hosts"].items(), key=lambda kv: -kv[1]["files"]))
    return res

# ---------------------------------------------------------------- dry run page
DRY_HTML = """<!doctype html><html><head><meta charset=utf-8><title>dry</title>
<meta http-equiv="Content-Security-Policy" content="img-src 'self' data:">
<link rel=stylesheet href="/s.css"></head><body><div id=menu>dry run page</div>
<img src="/a.png"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<img src="http://cdn.thirdparty.invalid/x.png">
<iframe src="/frame.html"></iframe>
<script src="/a.js"></script></body></html>"""
DRY_JS = """fetch('/data.json');fetch('http://api.thirdparty.invalid/q').catch(function(){});
new Worker('/w.js');try{var w=new WebSocket('ws://'+location.host+'/ws');}catch(e){}
var b=URL.createObjectURL(new Blob(['x']));fetch(b);console.error('dry console error');"""

def dry_server():
    d = os.path.join(PKG, "work", "proof_dry")
    os.makedirs(d, exist_ok=True)
    for n, s in (("index.html", DRY_HTML), ("a.js", DRY_JS), ("s.css", "body{background:#eee}"), ("frame.html", "<p>frame<script>fetch('/f.json')</script>"),
                 ("w.js", "fetch('/w.json');"), ("data.json", "{}"), ("f.json", "{}"), ("w.json", "{}")):
        open(os.path.join(d, n), "w").write(s)
    port = free_port()
    p = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", d],
                         stdout=open(os.path.join(OUT, "dry_http.log"), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(50):
        try: NOPROXY.open("http://127.0.0.1:%d/" % port, timeout=1); break
        except Exception: time.sleep(0.1)
    return p, "http://127.0.0.1:%d/" % port

# ---------------------------------------------------------------- main
def run_game(bs, base):
    a, b = bs
    va, vb = View(a), View(b)
    slog = ServerLog(A.server_log)
    for x in bs: x.pcall("Page.navigate", {"url": base})
    up = [wait_for(lambda x=x: x.js(VISIBLE % json.dumps("#play-box")), 45) for x in bs]
    time.sleep(0.8)
    for x in bs: dismiss_popups(x)
    for x in bs: x.shot("01_menu")
    step("menu_loaded", all(up), A=bool(up[0]), B=bool(up[1]))
    TITLES.append(title_check(a, "menu"))
    if not A.no_sweep:
        sw_res = {}
        ths = [threading.Thread(target=sweep, args=(x, base, sw_res)) for x in bs]
        for t in ths: t.start()
        for t in ths: t.join(900)
        open(os.path.join(OUT, "click_sweep.json"), "w").write(json.dumps(sw_res, indent=1, ensure_ascii=False))
        ok = all(k in sw_res and sw_res[k]["clicked"] > 0 and not sw_res[k]["offorigin_requests"] and not sw_res[k]["offorigin_navs"] and not sw_res[k]["offorigin_popups"] for k in ("A", "B"))
        step("menu_click_sweep", ok, **{k: {kk: v[kk] for kk in ("found", "clicked", "offorigin_requests", "offorigin_navs", "offorigin_popups", "requests_during")} | {"navigations": [(d.get("txt"), d["navigated_to"]) for d in v["navigations"]][:10]} for k, v in sw_res.items()})
        up = [load_menu(x, base) for x in bs]
        time.sleep(1.0)
    wg = webgl_on(a, base) if A.webgl else None
    for x in bs:
        r = x.js(OPEN_LIST_JS)
        if r: x.click(r[0], r[1])
    time.sleep(1.5)
    rooms = [menu_rooms(x) or {} for x in bs]
    open(os.path.join(OUT, "menu_dom.json"), "w").write(json.dumps(rooms, indent=1, ensure_ascii=False))
    # room pick: hosted server marks rooms in the list; click the row whose text contains the room name
    pick = A.room
    rows = rooms[0].get("rows") or []
    step("server_list_has_rooms", bool(rows), rows=rows[:12], selects=rooms[0].get("selects", [])[:12])
    if not pick and rows: pick = rows[0]
    m = re.search(r"([A-Z][A-Za-z]*#\d+)", pick or "")
    room = m.group(1) if m else (pick or "")
    picked = [pick_room(x, room) for x in bs]
    shown = [x.js("(document.querySelector('#server-name')||{}).innerText") for x in bs]
    step("same_room_picked", bool(room) and all(picked) and shown[0] == shown[1] == room, room=room, tries=picked, server_name_shown=shown)
    for x, nm in ((a, "ProofA"), (b, "ProofB")):
        x.js("(function(){var e=document.querySelector('#name');if(e){e.value=%s;e.dispatchEvent(new Event('input',{bubbles:true}));}})()" % json.dumps(nm))
    joined = []
    JOIN_T[0] = time.time() - T0
    for x in bs:
        ok = False
        for _ in range(8):
            r = x.js(VISIBLE % json.dumps("#play-box"))
            if not r: ok = True; break
            x.click(r[0], r[1])
            if wait_for(lambda: not x.js(VISIBLE % json.dumps("#play-box")), 5): ok = True; break
        joined.append(ok)
    time.sleep(2.5)
    for x in bs: x.shot("02_joined")
    ida, idb = va.self_id(), vb.self_id()
    ev = slog.read()
    joins = [e for e in ev if "join" in str(e.get("k", ""))]
    TITLES.append(title_check(a, "after_play"))
    step("title_version", all(t["ok"] for t in TITLES), checks=TITLES)
    step("both_joined", all(joined) and ida and idb and (ida != idb or A.milestone == 1), menu_gone=joined, A_self_id=ida, B_self_id=idb, server_joins=joins[:6])
    ws_urls = [[r["url"] + " -> " + str(r["status"]) for r in x.order if r["kind"] == "WebSocket"] for x in bs]
    rooms_ws = [sorted(set(urllib.parse.urlsplit(r["url"]).path for r in x.order if r["kind"] == "WebSocket")) for x in bs]
    step("same_room_ws", bool(rooms_ws[0]) and rooms_ws[0] == rooms_ws[1], A=ws_urls[0], B=ws_urls[1])

    if A.milestone == 1:
        t_walk = time.time() - T0
        for k, secs in (("d", 2.0), ("s", 1.5)):
            for x in bs: x.key("keyDown", k)
            time.sleep(secs)
            for x in bs: x.key("keyUp", k)
        time.sleep(0.8)
        for x in bs: x.shot("03_walked")
        for x, v, me in ((a, va, ida), (b, vb, idb)):
            pos = [p for p in (v.ent(me) or {}).get("pos", []) if p[0] >= t_walk] if me else []
            xs, ys = sorted(set(p[1] for p in pos)), sorted(set(p[2] for p in pos))
            step("%s_own_move" % x.tag, len(xs) > 2 and len(ys) > 2 and xs[-1] - xs[0] > 40 and ys[-1] - ys[0] > 20, self_id=me, n_moves=len(pos),
                 x_range=[xs[0], xs[-1]] if xs else None, y_range=[ys[0], ys[-1]] if ys else None, first=pos[:2], last=pos[-2:])
        ev2 = slog.read()
        keys = [e for e in ev2 if "key" in str(e.get("k", "")) or "move" in str(e.get("k", ""))]
        step("server_log_saw_input", bool(keys) or not os.path.exists(A.server_log), log=A.server_log, exists=os.path.exists(A.server_log), lines=len(ev2), sample=keys[:6])
        wext = webgl_play(a, va, ida, wg, base) if wg else None
        kinds = {}
        for e in ev2: kinds[str(e.get("k"))] = kinds.get(str(e.get("k")), 0) + 1
        return {"webgl": wext, "server_log_kinds": kinds, "server_log_lines": len(ev2)}

    # A walks: hold d 2 s, then s 1.5 s; B must see A's create (category 1) then moving x/y
    t_walk = time.time() - T0
    a.key("keyDown", "d"); time.sleep(2.0); a.key("keyUp", "d")
    a.key("keyDown", "s"); time.sleep(1.5); a.key("keyUp", "s")
    time.sleep(0.8)
    for x in bs: x.shot("03_A_walked")
    ea = vb.ent(ida) if ida else None
    by_name = vb.by_name("ProofA")
    if not ea and by_name: ea = by_name
    cr = (ea or {}).get("create") or {}
    mv = [p for p in (ea or {}).get("pos", []) if p[0] >= t_walk]
    xs, ys = sorted(set(p[1] for p in mv)), sorted(set(p[2] for p in mv))
    step("B_sees_A_create", bool(cr) and cr.get("2") == 1, A_id=ida, create=cr, create_t=(ea or {}).get("create_t"), name_match=bool(by_name))
    step("B_sees_A_move", len(xs) > 2 and len(ys) > 2 and xs[-1] - xs[0] > 40 and ys[-1] - ys[0] > 20,
         n_moves=len(mv), x_range=[xs[0], xs[-1]] if xs else None, y_range=[ys[0], ys[-1]] if ys else None, first=mv[:3], last=mv[-3:])
    own_a = va.ent(ida) if ida else None
    step("A_sees_self_move", bool(own_a and len(set(p[1] for p in own_a["pos"] if p[0] >= t_walk)) > 2), n=len(own_a["pos"]) if own_a else 0)

    # B walks next to A
    last = walk_to(b, vb, idb, ida) if ida and idb else None
    time.sleep(0.6)
    for x in bs: x.shot("04_B_next_to_A")
    step("B_next_to_A", bool(last and last[0] <= 120), dist_B_view=last and last[0], B=last and last[1], A=last and last[2], A_view_of_B=va.pos(idb) if idb else None)

    # A aims at B and swings
    hp0 = [h for h in (vb.ent(idb) or {}).get("hp", [])]
    pa, pb = va.pos(ida), va.pos(idb)
    cx, cy = screen_center(a)
    if pa and pb:
        dx, dy = pb[0] - pa[0], pb[1] - pa[1]; d = max(1.0, (dx * dx + dy * dy) ** 0.5)
        mx, my = cx + dx / d * 150, cy + dy / d * 150
    else:
        mx, my = cx + 150, cy
    t_hit = time.time() - T0
    a.mouse("mouseMoved", mx, my); time.sleep(0.3)
    a.mouse("mousePressed", mx, my); time.sleep(1.2)
    for x in bs: x.shot("05_A_swinging")
    time.sleep(1.8)
    a.mouse("mouseReleased", mx, my); time.sleep(0.8)
    for x in bs: x.shot("06_after_hit")
    eb = vb.ent(idb) or {}
    hp_after = [h for h in eb.get("hp", []) if h[0] >= t_hit]
    hp_before = ([h[1] for h in eb.get("hp", []) if h[0] < t_hit] or [(eb.get("create") or {}).get("12", 100)])[-1]
    ev2 = slog.read()
    hits = [e for e in ev2 if re.search(r"hit|hurt|damage|hp|attack|pvp", str(e.get("k", "")))][-12:]
    dropped = bool(hp_after) and min(h[1] for h in hp_after) < hp_before
    a_sees_b_hp = [h for h in (va.ent(idb) or {}).get("hp", []) if h[0] >= t_hit]
    step("B_hp_drops", dropped, aim=[round(mx), round(my)], A_pos=pa, B_pos=pb, hp_before=hp_before, hp_after_B_frames=hp_after[:10],
         hp_seen_by_A=a_sees_b_hp[:6], server_log=hits)
    # bonus: a non-create message (leaderboard) in B's frames naming both players; informational, not a gate
    boards = []
    for t, rid, rec in list(b.ws_frames):
        if rec.get("kind") != "mp": continue
        for mm in (rec["msg"] if isinstance(rec["msg"], list) else [rec["msg"]]):
            if isinstance(mm, dict) and "2" not in mm:
                js = json.dumps(mm, ensure_ascii=False)
                if "ProofA" in js and "ProofB" in js: boards.append((round(t, 2), js[:300]))
    mark("leaderboard_bonus", found=len(boards), last=boards[-1] if boards else None)
    wext = webgl_play(a, va, ida, wg, base) if wg else None
    sext = run_social(a, b, va, vb, ida, idb, slog) if A.social else None
    vext = run_visual(a, b, va, vb, ida, idb, slog, (sext or {}).get("picks")) if A.visual else None
    # server log digest
    kinds = {}
    for e in ev2: kinds[str(e.get("k"))] = kinds.get(str(e.get("k")), 0) + 1
    return {"webgl": wext, "social": sext, "visual": vext, "server_log_kinds": kinds, "server_log_lines": len(ev2), "leaderboard_with_both_names": {"n": len(boards), "last": boards[-1] if boards else None},
            "creates_seen_by_B": vb.creates[-40:], "players_seen_by_B": [c for c in vb.creates if c[3] == 1],
            "players_seen_by_A": [c for c in va.creates if c[3] == 1]}

HIT_SEL_JS = """(function(s){var e=document.querySelector(s);if(!e||e.offsetParent===null)return null;var b=e.getBoundingClientRect();if(!b.width)return null;
var x=b.x+b.width/2,y=b.y+b.height/2,h=document.elementFromPoint(x,y);return [x,y,!!h&&(h===e||e.contains(h)||h.contains(e)||(e.parentElement&&e.parentElement.contains(h)))];})(%s)"""
SETTINGS_OPEN_JS = "(function(){var e=document.querySelector('#controls');if(!e||e.offsetParent===null)return null;var b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2];})()"
WEBGL_STATE_JS = """(function(){var c=document.querySelector('#webglButton1');var ls={};try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);ls[k]=String(localStorage.getItem(k)).slice(0,120);}}catch(e){}
var cv=[].slice.call(document.querySelectorAll('canvas')).map(function(x){return [x.id,x.width,x.height]});
return {circle_on:!!c&&/activate-circle-on/.test(c.className),circle_cls:c?c.className:null,device_webgl:(document.querySelector('#settings-device-webgl')||{}).innerText||null,
ctx:window.__proofCtx||null,canvases:cv,ls:ls};})()"""

def click_sel(x, sel, wait=0.6):
    x.js("(function(){var e=document.querySelector(%s);if(e&&e.scrollIntoView)e.scrollIntoView({block:'center'});})()" % json.dumps(sel)); time.sleep(0.3)
    r = x.js(HIT_SEL_JS % json.dumps(sel))
    if r and not r[2]: r = None
    if r: x.click(r[0], r[1]); time.sleep(wait)
    return bool(r)

def webgl_on(a, base):
    # menu gear -> SETTINGS -> Graphics tab -> "Enable WebGL" switch; reload so the client starts in WebGL mode
    before = a.js(WEBGL_STATE_JS) or {}
    ev = {"before": {k: before.get(k) for k in ("circle_on", "device_webgl", "ctx")}}
    ev["popups_dismissed"] = dismiss_popups(a)
    ev["gear"] = bool(a.js(SETTINGS_OPEN_JS))
    r = a.js(SETTINGS_OPEN_JS)
    if r: a.click(r[0], r[1]); time.sleep(1.0)
    ev["settings_open"] = bool(a.js(VISIBLE % json.dumps("#rebind-key")))
    ev["graphics_tab"] = click_sel(a, "#settings-tab-graphics", 0.8)
    a.shot("w1_settings_graphics")
    if not before.get("circle_on"):
        ev["switch_clicked"] = click_sel(a, "#webglButton1", 0.8) or click_sel(a, "#webglButton2", 0.8)
    mid = a.js(WEBGL_STATE_JS) or {}
    ev["after_click"] = {"circle_on": mid.get("circle_on"), "device_webgl": mid.get("device_webgl"), "ctx": mid.get("ctx")}
    ev["ls_changed"] = {k: v for k, v in (mid.get("ls") or {}).items() if (before.get("ls") or {}).get(k) != v}
    a.shot("w2_webgl_switched")
    click_sel(a, "#controls-quit", 0.5)
    load_menu(a, base); time.sleep(1.5)
    after = a.js(WEBGL_STATE_JS) or {}
    ev["after_reload"] = {"circle_on": after.get("circle_on"), "ctx": after.get("ctx"), "canvases": after.get("canvases")}
    ctx = after.get("ctx") or []
    gl = [c for c in ctx if "webgl" in c["type"].lower() and c["ok"]]
    step("webgl_setting_on", bool(mid.get("circle_on") or after.get("circle_on")) and bool(ev["ls_changed"] or after.get("circle_on")), **ev)
    step("webgl_context_created", bool(gl), contexts=ctx[:12])
    return {"t_on": time.time() - T0}

def play_a(a, va, ida, secs=20):
    # walk a square and keep swinging, A's camera is centred on A
    cx, cy = screen_center(a)
    end = time.time() + secs; i = 0
    while time.time() < end:
        k = "dwsa"[i % 4]; i += 1
        mx, my = cx + {"d": 150, "a": -150}.get(k, 0), cy + {"s": 150, "w": -150}.get(k, 0)
        a.mouse("mouseMoved", mx, my); a.key("keyDown", k); a.mouse("mousePressed", mx, my)
        time.sleep(2.2)
        a.mouse("mouseReleased", mx, my); a.key("keyUp", k)
        time.sleep(0.3)
        if i == 4: a.shot("w3_webgl_playing")
    a.shot("w4_webgl_after_play")

def missing_assets(b, t0, base):
    # local 404s plus PNGs answered by the server's blank 1x1 fallback, from t0 on
    try: blank = NOPROXY.open(base.rstrip("/") + "/__proof_missing_%s.png" % TS, timeout=5).read()
    except Exception: blank = None
    miss, cnt = {}, {}
    for q in b.order:
        if q["t"] < t0 or urllib.parse.urlsplit(q["url"]).scheme not in ("http", "https"): continue
        u = urllib.parse.urlsplit(q["url"]); path = u.path + (("?" + u.query) if u.query else "")
        why = None
        if q.get("status") == 404: why = "404"
        elif blank and q.get("mime") == "image/png" and str(q.get("clen")) == str(len(blank)):
            try:
                if NOPROXY.open(q["url"], timeout=5).read() == blank: why = "blank_png"
            except Exception: pass
        if why:
            k = (why, path); cnt[k] = cnt.get(k, 0) + 1
    for (why, path), n in sorted(cnt.items(), key=lambda kv: -kv[1]):
        miss.setdefault(why, []).append({"path": path, "count": n})
    return miss

V01 = None
ssw = None
JOIN_T = [None]
TITLES = []
def title_check(x, when):
    # the page title must be "Taming Offline <version>" with the server's /version text (the client must not overwrite it)
    title = x.js("document.title") or ""
    ver = (x.js("fetch('/version',{cache:'no-store'}).then(function(r){return r.ok?r.text():''}).catch(function(){return ''})") or "").strip()
    return {"when": when, "title": title, "version": ver, "ok": title.startswith("Taming Offline ") and bool(ver) and ver in title}
OWN = None
def webgl_play(a, va, ida, wg, base):
    n_con = len(a.console)
    play_a(a, va, ida, 20)
    st = a.js(WEBGL_STATE_JS) or {}
    pos = [p for p in (va.ent(ida) or {}).get("pos", []) if p[0] >= wg["t_on"]] if ida else []
    miss = missing_assets(a, wg["t_on"], base)
    errs = [c for c in a.console if c["t"] >= wg["t_on"] and c["src"] in ("exception", "console.error") or (c["t"] >= wg["t_on"] and "webgl" in c["text"].lower())]
    origin = urllib.parse.urlsplit(base).netloc
    off = {}
    for q in a.order:
        if q["t"] >= wg["t_on"]:
            u = urllib.parse.urlsplit(q["url"])
            if u.scheme in ("http", "https", "ws", "wss") and u.netloc != origin: off[u.netloc] = off.get(u.netloc, 0) + 1
    step("webgl_play_20s", len(set((p[1], p[2]) for p in pos)) > 5, moves=len(pos), contexts=(st.get("ctx") or [])[:12], screenshot="w3_webgl_playing_A.png")
    step("webgl_same_origin", not off, offorigin=off)
    res = {"missing": miss, "missing_total": sum(m["count"] for v in miss.values() for m in v), "console_since_on": errs[:40], "contexts": st.get("ctx"), "offorigin": off}
    json.dump(res, open(os.path.join(OUT, "webgl.json"), "w"), indent=1, ensure_ascii=False)
    mark("webgl_missing", n404=len(miss.get("404", [])), nblank=len(miss.get("blank_png", [])), total=res["missing_total"])
    return res

# ---------------------------------------------------------------- social: clans, clan chat, age-up picks
def dump(x, sel, name):
    h = x.js("(function(){var e=document.querySelector(%s);return e?e.outerHTML:null})()" % json.dumps(sel))
    if h: open(os.path.join(OUT, "dom_%s_%s.html" % (name, x.tag)), "w").write(h)
    return h

DEATHS = []
def ensure_alive(x, v, name):
    # dead players land on the scoreboard/menu: dismiss it and press Play again (same name)
    if not x.js(VISIBLE % json.dumps("#play-box")):
        dismiss_popups(x)
        if not x.js(VISIBLE % json.dumps("#play-box")): return v.self_id()
    DEATHS.append((round(time.time() - T0, 2), x.tag))
    mark("respawn", tag=x.tag)
    dismiss_popups(x)
    x.js("(function(){var e=document.querySelector('#name');if(e){e.value=%s;e.dispatchEvent(new Event('input',{bubbles:true}));}})()" % json.dumps(name))
    for _ in range(6):
        r = x.js(VISIBLE % json.dumps("#play-box"))
        if not r: break
        x.click(r[0], r[1])
        if wait_for(lambda: not x.js(VISIBLE % json.dumps("#play-box")), 5): break
        dismiss_popups(x)
    time.sleep(1.5)
    return v.self_id()

def type_keys(x, text):
    for ch in text:
        code = "Space" if ch == " " else ("Key" + ch.upper() if ch.isalpha() else ("Digit" + ch if ch.isdigit() else ""))
        vk = 32 if ch == " " else ord(ch.upper())
        x.pcall("Input.dispatchKeyEvent", {"type": "keyDown", "key": ch, "code": code, "text": ch, "windowsVirtualKeyCode": vk})
        x.pcall("Input.dispatchKeyEvent", {"type": "keyUp", "key": ch, "code": code, "windowsVirtualKeyCode": vk})
        time.sleep(0.03)

def press(x, k, hold=0.12):
    x.key("keyDown", k); time.sleep(hold); x.key("keyUp", k)

def type_text(x, text):
    x.pcall("Input.insertText", {"text": text})

def vis_text(x, sel):
    return x.js("(function(){var e=document.querySelector(%s);return e&&e.offsetParent!==null?e.innerText:null})()" % json.dumps(sel))

def click_text(x, scope, rx):
    # click the innermost visible element under scope whose text matches rx
    r = x.js("""(function(sc,rx){var root=document.querySelector(sc);if(!root)return null;var re=new RegExp(rx,'i');var all=root.querySelectorAll('*');var best=null;
      for(var i=0;i<all.length;i++){var e=all[i];if(e.offsetParent===null)continue;var t=(e.innerText||e.value||e.getAttribute('content')||'').trim();if(!re.test(t))continue;
        var b=e.getBoundingClientRect();if(!b.width)continue;if(!best||e.contains(best)===false&&best.contains(e))best=e;else if(!best)best=e;}
      if(!best)return null;best.scrollIntoView({block:'center'});var b=best.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2,best.tagName+'#'+best.id+'.'+String(best.className).slice(0,30)+' '+(best.innerText||'').trim().slice(0,30)];})(%s,%s)""" % (json.dumps(scope), json.dumps(rx)))
    if r: x.click(r[0], r[1]); time.sleep(0.6)
    return r and r[2]

def open_team(x):
    if vis_text(x, "#team-box") is not None: return True
    press(x, "r"); time.sleep(0.8)
    return vis_text(x, "#team-box") is not None

def close_team(x):
    if vis_text(x, "#team-box") is not None:
        if not click_sel(x, "#quit-team-box", 0.5): press(x, "r")

def run_social(a, b, va, vb, ida, idb, slog):
    res = {}
    ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
    t0 = time.time() - T0
    # ---- A creates the clan
    ok = open_team(a); time.sleep(0.5)
    dump(a, "#team-box", "s1_team_open"); a.shot("s1_team_box")
    inp = a.js("(function(){var e=document.querySelector('#team-box input');if(!e)return null;e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2,e.id,e.placeholder||'']})()")
    if inp: a.click(inp[0], inp[1]); time.sleep(0.2); type_text(a, "ProofClan"); time.sleep(0.3)
    btn = click_text(a, "#team-box", "^(create|ok|\\+)$") or click_text(a, "#team-box-footer", "create")
    time.sleep(1.5)
    dump(a, "#team-box", "s2_after_create"); a.shot("s2_clan_created")
    info = [m for t, m in va.msgs(68, t0) if m.get("m") == 74]
    sent = [m for t, m in a.sent if t >= t0 and isinstance(m, dict) and m.get("type") == 68]
    step("social_clan_create", bool(info) and (info[-1].get("o") or {}).get("n") == "ProofClan" and (info[-1].get("o") or {}).get("l") == 1,
         team_box_open=ok, input=inp, button=btn, sent=sent[:6], info=info[-1:] if info else None)
    team = (info[-1].get("o") or {}).get("x") if info else None
    close_team(a)
    # ---- B asks to join through the team box, A accepts on the invitation box (retried: creatures can kill either)
    req, binfo, tries = [], [], []
    for attempt in range(3):
        ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
        t1 = time.time() - T0
        ok = open_team(b); time.sleep(0.8)
        dump(b, "#team-box", "s3_team_open"); b.shot("s3_team_list")
        jb = click_text(b, "#team-box", "^ProofClan$"); time.sleep(0.5)
        jb2 = click_sel(b, "#join-team0", 0.6) or click_text(b, "#team-box", "^(join|ask|request)")
        req = wait_for(lambda: [m for t, m in va.msgs(68, t1) if m.get("m") == 3], 4) or []
        close_team(b)
        t2 = time.time() - T0
        inv_vis = wait_for(lambda: a.js(VISIBLE % json.dumps("#invitation-box")), 5)
        dump(a, "#invitation-box", "s5_invitation"); a.shot("s5_invitation")
        acc = click_sel(a, "#accept", 1.0)
        binfo = wait_for(lambda: [m for t, m in vb.msgs(68, t2) if m.get("m") == 74], 5) or []
        tries.append({"team_box_open": ok, "clicked": [jb, jb2], "req": bool(req), "invitation_visible": bool(inv_vis), "accept_clicked": acc, "joined": bool(binfo)})
        if binfo: break
    ev = slog.read()
    asks = [e for e in ev if e.get("k") == "clan_ask" and e.get("id") == team]
    accs = [e for e in ev if e.get("k") == "clan_accept" and e.get("id") == team]
    step("social_join_request", bool(req) and req[-1].get("o") == "ProofB" and bool(asks), leader_got=req[-1:], server_log=asks[-1:], tries=tries)
    step("social_accept", bool(binfo) and (binfo[-1].get("o") or {}).get("n") == "ProofClan" and bool(accs), joiner_info=binfo[-1:], server_log=accs[-1:], tries=len(tries))
    # ---- field 14 on both players, both views
    ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
    want = {"A": team * 2 + 1 if team else None, "B": team * 2 if team else None}
    def f14():
        f = {}
        for vn, v in (("A_view", va), ("B_view", vb)):
            for pn, pid in (("A", ida), ("B", idb)):
                e = v.ent(pid) or {}
                f["%s_%s" % (vn, pn)] = (e.get("f14") or [[None, (e.get("create") or {}).get("14")]])[-1][1]
        return f
    f = wait_for(lambda: (lambda g: g if all(g["%s_%s" % (vn, pn)] == want[pn] for vn in ("A_view", "B_view") for pn in ("A", "B")) else None)(f14()), 8) or f14()
    eb = va.ent(idb) or {}
    step("social_field14", bool(team) and all(f["%s_%s" % (vn, pn)] == want[pn] for vn in ("A_view", "B_view") for pn in ("A", "B")), team_id=team, want=want, got=f, ids=[ida, idb],
         A_view_of_B={"known": bool(eb), "create": eb.get("create"), "f14": (eb.get("f14") or [])[-3:], "pos": (eb.get("pos") or [])[-1:], "removed": eb.get("removed_t")},
         A_view_players=[c for c in va.creates if c[3] == 1][-6:])
    # ---- B's client shows the clan
    open_team(b); time.sleep(1.0)
    txt = vis_text(b, "#team-box") or ""
    dump(b, "#team-box", "s6_member_view"); b.shot("s6_clan_panel")
    step("social_B_shows_clan", "ProofA" in txt or "ProofClan" in txt, text=txt[:300])
    close_team(b)
    # ---- clan chat: A switches the chat to team mode and sends; B gets the bubble (mt 1) and the log line
    ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
    near = walk_to(b, vb, idb, ida, near=250, secs=20)   # bubbles only reach members in view
    t3 = time.time() - T0
    mark("chat_dbg", s="focus_before", el=a.js("document.activeElement&&(document.activeElement.tagName+'#'+document.activeElement.id)"))
    a.js("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
    mark("chat_dbg", s="enter1"); press(a, "Enter"); time.sleep(0.5); mark("chat_dbg", s="enter1_done", pops=len(a.popups))
    mode = a.js("(function(){var t=document.querySelector('#chat-team-button'),l=document.querySelector('#chat-all-button');return [t&&t.offsetParent!==null,l&&l.offsetParent!==null]})()")
    if mode and mode[1] and not mode[0]: click_sel(a, "#chat-all-button", 0.4)
    mark("chat_dbg", s="mode_clicked", pops=len(a.popups))
    mode2 = a.js("(function(){var t=document.querySelector('#chat-team-button'),l=document.querySelector('#chat-all-button');return [t&&t.offsetParent!==null,l&&l.offsetParent!==null]})()")
    if a.js("document.activeElement&&document.activeElement.id") != "chat-input": click_sel(a, "#chat-input", 0.2)
    focus = a.js("document.activeElement&&document.activeElement.id")
    if focus == "chat-input":
        type_keys(a, "proof clan hi"); time.sleep(0.2); mark("chat_dbg", s="typed", pops=len(a.popups)); press(a, "Enter")
    time.sleep(1.5); mark("chat_dbg", s="sent", pops=len(a.popups))
    a.shot("s7_chat_sent"); b.shot("s7_chat_received")
    csent = [m for t, m in a.sent if t >= t3 and isinstance(m, dict) and m.get("type") == 39]
    got = [m for t, m in vb.msgs(39, t3)]
    bub = [m for m in got if m.get("mt") == 1 and "proof clan hi" in str(m.get("m"))]
    log = [m for m in got if m.get("tm") == 62 and "proof clan hi" in str(m.get("m"))]
    a_bub = [m for t, m in va.msgs(39, t3) if m.get("mt") == 1]
    step("social_clan_chat", bool(bub) and bool(log), A_own_bubble=a_bub[:1], B_frame_errors=b.frame_err, B_dist=near and near[0], focus=focus, mode_before=mode, mode_after=mode2, sent=csent[:3], B_bubble=bub[:1], B_log=log[:1], B_all=got[:4])
    # ---- minimap member markers (every 5.3 to 9.9 s while 2+ members)
    pos = wait_for(lambda: [m for t, m in vb.msgs(68, t2) if m.get("m") == 63] and [m for t, m in va.msgs(68, t2) if m.get("m") == 63], 14) and [m for t, m in vb.msgs(68, t2) if m.get("m") == 63]
    step("social_minimap_members", bool(pos), B_pos_msgs=len(pos or []), last=(pos or [None])[-1])
    res["team"] = team
    res["admin"] = clan_admin(a, b, va, vb, ida, idb, team, slog)
    res["picks"] = run_picks(a, va, ida, slog)
    res["deaths"] = list(DEATHS)
    res["clan_sent"] = {x.tag: [(t, m) for t, m in x.sent if isinstance(m, dict) and m.get("type") in (68, 39)][:60] for x in (a, b)}
    return res

def log_since(slog, k, t_abs, **match):
    return [e for e in slog.read() if e.get("k") == k and e.get("t", 0) >= t_abs and all(e.get(kk) == vv for kk, vv in match.items())]

def b_ask(b, vb):
    open_team(b); time.sleep(0.8)
    jb = click_text(b, "#team-box", "^ProofClan$"); time.sleep(0.4)
    jb2 = click_sel(b, "#join-team0", 0.6) or click_text(b, "#team-box", "^(join|ask|request)")
    close_team(b)
    return [jb, jb2]

def clan_admin(a, b, va, vb, ida, idb, team, slog):
    # kick, decline, the three locks; each checked in the server log and in B's frames/panel
    out = {}
    # ---- kick: A removes B from the leader panel
    ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
    tw, t0 = time.time(), time.time() - T0
    open_team(a); time.sleep(0.8)
    dump(a, "#team-box", "k1_leader_panel"); a.shot("k1_leader_panel")
    kc = a.js("""(function(){var box=document.querySelector('#team-box');if(!box)return null;var all=box.querySelectorAll('*');var c=[];
      for(var i=0;i<all.length;i++){var e=all[i];if(e.offsetParent===null)continue;var s=(e.id+' '+e.className+' '+(e.getAttribute('src')||'')).toLowerCase();if(/kick|remove|expel|ban/.test(s))c.push(e);}
      if(!c.length)return null;var e=c[c.length-1];e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2,e.tagName+'#'+e.id+'.'+e.className];})()""")
    if not kc:
        click_text(a, "#team-list", "^ProofB$"); time.sleep(0.6)
        dump(a, "#team-box", "k2_after_member_click"); a.shot("k2_after_member_click")
        kc = a.js("""(function(){var all=document.querySelectorAll('body *');var c=[];
          for(var i=0;i<all.length;i++){var e=all[i];if(e.offsetParent===null)continue;var s=(e.id+' '+e.className+' '+(e.getAttribute('src')||'')+' '+((e.children.length?'':e.innerText)||'')).toLowerCase();if(/kick|remove|expel/.test(s))c.push(e);}
          if(!c.length)return null;var e=c[c.length-1];var b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2,e.tagName+'#'+e.id+'.'+e.className];})()""")
    if kc: a.click(kc[0], kc[1]); time.sleep(1.2)
    for _ in range(2):   # a confirmation dialog, if the client asks
        if not click_text(a, "body", "^(yes|confirm|ok|kick)$"): break
    left = wait_for(lambda: [m for t, m in vb.msgs(68, t0) if m.get("m") == 10], 4) or []
    kl = log_since(slog, "clan_kick", tw - 1, id=team)
    close_team(a)
    idb = ensure_alive(b, vb, "ProofB") or idb
    def b14():
        e = vb.ent(idb) or {}
        return (e.get("f14") or [[None, (e.get("create") or {}).get("14")]])[-1][1]
    f14b = wait_for(lambda: b14() == 0 and "zero", 5) and 0
    if f14b is None or f14b is False: f14b = b14()
    open_team(b); time.sleep(0.8); btxt = vis_text(b, "#team-box") or ""; b.shot("k3_B_after_kick"); dump(b, "#team-box", "k3_B_after_kick"); close_team(b)
    step("social_kick", bool(kl) and bool(left) and f14b == 0 and "LEAVE TEAM" not in btxt, kick_button=kc, server_log=kl[-1:], B_left_msg=left[-1:], B_field14=f14b, B_panel=btxt[:120])
    # ---- decline: B asks again, A declines on the invitation box
    tw, t0 = time.time(), time.time() - T0
    ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
    cl = b_ask(b, vb)
    inv = wait_for(lambda: a.js(VISIBLE % json.dumps("#invitation-box")), 5)
    dec = click_sel(a, "#decline", 1.2)
    dl = log_since(slog, "clan_decline", tw - 1, id=team)
    al = log_since(slog, "clan_ask", tw - 1, id=team)
    joined = [m for t, m in vb.msgs(68, t0) if m.get("m") == 74]
    asent = [m for t, m in a.sent if t >= t0 and isinstance(m, dict) and m.get("type") == 68]
    step("social_decline", bool(dl) and bool(al) and not joined and bool(inv), A_sent=asent[-4:], clicked=cl, invitation_visible=bool(inv), decline_clicked=dec, server_log=al[-1:] + dl[-1:], B_joined=joined[-1:])
    # ---- locks: each pair of buttons in A's panel, the visible one toggles
    ida = ensure_alive(a, va, "ProofA") or ida
    locks = {}
    for what, on_sel, off_sel in (("hide_leader", "#no-hide-leader-button", "#hide-leader-button"), ("join", "#lock-join-button", "#unlock-join-button"), ("team", "#lock-team-button", "#unlock-team-button")):
        tw = time.time()
        open_team(a); time.sleep(0.6)
        c1 = click_sel(a, on_sel, 0.8)
        l1 = log_since(slog, "clan_lock", tw - 1, id=team, what=what)
        locks[what] = {"clicked": c1, "log": l1[-1:], "panel_after": a.js("(function(){var a=document.querySelector(%s),b=document.querySelector(%s);return [a&&a.offsetParent!==null,b&&b.offsetParent!==null]})()" % (json.dumps(on_sel), json.dumps(off_sel)))}
    a.shot("l1_locks_on"); dump(a, "#team-box", "l1_locks_on")
    step("social_locks", all(v["log"] and v["log"][-1].get("v") == 1 for v in locks.values()), **locks)
    # ---- a locked team refuses B: no request reaches A, no clan_ask line
    tw, t0 = time.time(), time.time() - T0
    idb = ensure_alive(b, vb, "ProofB") or idb
    cl = b_ask(b, vb); time.sleep(2.0)
    req = [m for t, m in va.msgs(68, t0) if m.get("m") == 3]
    al = log_since(slog, "clan_ask", tw - 1, id=team)
    inv = a.js(VISIBLE % json.dumps("#invitation-box"))
    step("social_locked_refuses", not req and not al and not inv, clicked=cl, A_got_request=req[-1:], server_ask=al[-1:], invitation_visible=bool(inv))
    # unlock again (keeps later steps and the room clean)
    for what, on_sel, off_sel in (("hide_leader", "#no-hide-leader-button", "#hide-leader-button"), ("join", "#lock-join-button", "#unlock-join-button"), ("team", "#lock-team-button", "#unlock-team-button")):
        open_team(a); time.sleep(0.4); click_sel(a, off_sel, 0.6)
    close_team(a)
    out["locks"] = locks
    out["handover"] = clan_handover(a, b, va, vb, ida, idb, team, slog)
    return out

def confirm_any(x):
    for _ in range(2):
        if not click_text(x, "body", "^(yes|confirm|ok|leave|delete)$"): break

def sent_since(x, t0, o):
    return [m for t, m in x.sent if t >= t0 and isinstance(m, dict) and m.get("type") == 68 and m.get("o") == o]

def f14_of(v, pid):
    e = v.ent(pid) or {}
    return (e.get("f14") or [[None, (e.get("create") or {}).get("14")]])[-1][1]

def clan_handover(a, b, va, vb, ida, idb, team, slog):
    # B joins again, A marks B next leader, A hands leadership to B, A (now member) leaves, B (leader, alone) leaves
    out = {}
    binfo = []
    for _ in range(3):
        ida = ensure_alive(a, va, "ProofA") or ida; idb = ensure_alive(b, vb, "ProofB") or idb
        t0 = time.time() - T0
        b_ask(b, vb)
        wait_for(lambda: a.js(VISIBLE % json.dumps("#invitation-box")), 5); click_sel(a, "#accept", 1.0)
        binfo = wait_for(lambda: [m for t, m in vb.msgs(68, t0) if m.get("m") == 74], 5) or []
        if binfo: break
    step("social_rejoin", bool(binfo), joiner_info=binfo[-1:])
    # next leader
    tw, t0 = time.time(), time.time() - T0
    open_team(a); time.sleep(0.8)
    c = click_sel(a, "#next-leader1", 1.0)
    rows = [m for t, m in va.msgs(68, t0) if m.get("m") == 83]
    nl = [r for r in ((rows[-1].get("o") or []) if rows else []) if isinstance(r, list) and len(r) > 3 and r[0] == "ProofB"]
    s85 = sent_since(a, t0, 85)
    step("social_next_leader", c and bool(s85) and bool(nl) and nl[0][3] == 1, clicked=c, A_sent=s85[-1:], members_row_B=nl[:1])
    a.shot("h1_next_leader"); dump(a, "#team-box", "h1_next_leader")
    # leader transfer
    tw, t0 = time.time(), time.time() - T0
    c = click_sel(a, "#change-leader1", 1.0); confirm_any(a); time.sleep(1.0)
    cl = log_since(slog, "clan_leader", tw - 1, id=team)
    s24 = sent_since(a, t0, 24)
    b46 = wait_for(lambda: [m for t, m in vb.msgs(68, t0) if m.get("m") == 46], 4) or []
    a16 = [m for t, m in va.msgs(68, t0) if m.get("m") == 16]
    f = wait_for(lambda: (lambda x: x if x["A"] == team * 2 and x["B"] == team * 2 + 1 else None)({"A": f14_of(vb, ida), "B": f14_of(vb, idb)}), 4) or {"A": f14_of(vb, ida), "B": f14_of(vb, idb)}
    close_team(a)
    step("social_leader_transfer", bool(c) and bool(cl) and bool(b46) and bool(a16) and f["A"] == team * 2 and f["B"] == team * 2 + 1,
         clicked=c, A_sent=s24[-1:], server_log=cl[-1:], B_got_leader=b46[-1:], A_got_member=a16[-1:], field14_B_view=f)
    open_team(b); time.sleep(0.8); b.shot("h2_B_is_leader"); dump(b, "#team-box", "h2_B_is_leader"); close_team(b)
    # A (member) leaves
    tw, t0 = time.time(), time.time() - T0
    ida = ensure_alive(a, va, "ProofA") or ida
    open_team(a); time.sleep(0.8)
    c = click_sel(a, "#leave-team-button", 1.0); confirm_any(a); time.sleep(1.0)
    ll = log_since(slog, "clan_leave", tw - 1, id=team)
    s33 = sent_since(a, t0, 33)
    a10 = wait_for(lambda: [m for t, m in va.msgs(68, t0) if m.get("m") == 10], 4) or []
    fa = wait_for(lambda: f14_of(va, ida) == 0 and "z", 4)
    close_team(a)
    step("social_member_leave", bool(c) and bool(ll) and ll[-1].get("leader") is False and bool(a10) and bool(fa), clicked=c, A_sent=s33[-1:], server_log=ll[-1:], A_got_left=a10[-1:], A_field14=f14_of(va, ida))
    # B (leader, alone) leaves: the team is removed
    tw, t0 = time.time(), time.time() - T0
    idb = ensure_alive(b, vb, "ProofB") or idb
    open_team(b); time.sleep(0.8)
    c = click_sel(b, "#leave-team-button", 1.0); confirm_any(b); time.sleep(1.2)
    ll = log_since(slog, "clan_leave", tw - 1, id=team)
    dl = log_since(slog, "clan_delete", tw - 1, id=team)
    s33 = sent_since(b, t0, 33)
    close_team(b)
    a26 = [m for t, m in va.msgs(68, t0) if m.get("m") == 26]
    step("social_leader_leave", bool(c) and bool(ll) and bool(dl), clicked=c, B_sent=s33[-1:], server_log=ll[-1:] + dl[-1:], A_got_team_deleted=a26[-1:])
    # close: every panel close sends o 30 (no reply, no log line by design)
    s30 = [m for x in (a, b) for t, m in x.sent if isinstance(m, dict) and m.get("type") == 68 and m.get("o") == 30]
    step("social_close_sent", len(s30) >= 2, close_msgs=len(s30))
    return out

T_CREATE_ATL = 79
def nearest_resource(va, me, skip=()):
    names = NAMES()
    p = va.pos(me)
    if not p: return None
    best, bd = None, 1e18
    for e in va.statics():
        c = e.get("create") or {}
        n = names[c["13"]] if isinstance(c.get("13"), int) and c["13"] < len(names) else ""
        if not re.search(r"tree|stone|rock", n or "") or e["id"] in skip: continue
        q = e["pos"][-1][1:] if e["pos"] else (c.get("3"), c.get("4"))
        d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
        if d < bd: bd, best = d, (e["id"], n, q)
    return best

_NAMES = []
def NAMES():
    if not _NAMES:
        try: _NAMES.extend(json.load(open(os.path.join(PKG, "decoder", "names.json"))))
        except Exception: pass
    return _NAMES

def wild_near(va, me, q, r=600):
    # wild creatures (category 0, not owned by me) within r of point q
    n = 0
    with va.lock:
        for e in va.ents.values():
            c = e.get("create") or {}
            if c.get("2") != 0 or "removed_t" in e or c.get("13") == me: continue
            pos = e["pos"][-1][1:] if e["pos"] else (c.get("3"), c.get("4"))
            if pos[0] is None: continue
            if (pos[0] - q[0]) ** 2 + (pos[1] - q[1]) ** 2 < r * r: n += 1
    return n

def own_hp(va, me):
    e = va.ent(me) or {}
    return (e.get("hp") or [[0, (e.get("create") or {}).get("12", 100)]])[-1][1]

def gather_to_age1(a, va, ida, secs=90):
    end = time.time() + secs; hits = 0; target = None; skipped = set()
    cx, cy = screen_center(a)
    while time.time() < end and va.xp() < 43:
        if a.js(VISIBLE % json.dumps("#play-box")) or a.js(VISIBLE % json.dumps("#scoreboard-continue-button")):
            ida = ensure_alive(a, va, "ProofA") or ida; target = None
        if own_hp(va, ida) < 50:   # back off and let HP regen before more gathering
            time.sleep(1.5); continue
        r = None
        for _ in range(6):   # nearest resource with no wild creature around it
            r = nearest_resource(va, ida, skip=skipped)
            if not r or not wild_near(va, ida, r[2]): break
            skipped.add(r[0]); r = None
        if not r: r = nearest_resource(va, ida)
        if not r: time.sleep(0.5); continue
        if not target or target[0] != r[0]:
            target = r
            walk_to_point(a, va, ida, r[2], near=150, secs=12)
        p = va.pos(ida); q = target[2]
        if not p: continue
        dx, dy = q[0] - p[0], q[1] - p[1]; d = max(1.0, (dx * dx + dy * dy) ** 0.5)
        mx, my = cx + dx / d * 150, cy + dy / d * 150
        a.mouse("mouseMoved", mx, my); a.mouse("mousePressed", mx, my); time.sleep(2.0); a.mouse("mouseReleased", mx, my); hits += 1
    return ida, hits, target

def run_picks(a, va, ida, slog):
    out = {}
    xp0 = va.xp()
    cx, cy = screen_center(a)
    got, tried, attempts, item, xp1, hits, target = None, [], [], None, 0, 0, None
    for attempt in range(2):   # a death before or during the clicks resets the picks: respawn, gather again, retry
        ida, h, target = gather_to_age1(a, va, ida)
        hits += h; xp1 = va.xp()
        ida = ensure_alive(a, va, "ProofA") or ida
        alive = not a.js(VISIBLE % json.dumps("#play-box")) and own_hp(va, ida) > 0
        if attempt == 0: a.shot("p1_age_up")
        t1 = time.time() - T0; tw = time.time()
        for x in (490, 550, 610, 670, 730, 790, 430, 370):
            if a.js(VISIBLE % json.dumps("#play-box")): break   # died mid-way
            a.mouse("mouseMoved", x, 37); time.sleep(0.15); a.mouse("mousePressed", x, 37); time.sleep(0.15); a.mouse("mouseReleased", x, 37); time.sleep(0.8)
            tried.append(x)
            ic = va.msgs(36, t1)
            if ic: got = ic[-1][1]; break
        srv = [e for e in slog.read() if e.get("k") in ("pick", "pick_refused") and e.get("t", 0) >= tw - 1]
        attempts.append({"xp": xp1, "alive_before_clicks": alive, "hp": own_hp(va, ida), "got": got, "server": srv[-4:]})
        if got: break
    step("pick_age_1", xp1 >= 43, xp_before=xp0, xp_after=xp1, swings=hits, target=target and target[1], attempts=len(attempts))
    a.shot("p2_item_picked")
    picks = [e for e in slog.read() if e.get("k") in ("pick", "pick_refused")]
    item = (got.get("B") or [0])[0] // 256 if got else None
    step("pick_item_count", bool(got), clicked=tried, item_count=got, item=item, server=picks[-4:], attempts=attempts)
    # hotbar: key 1 selects the picked weapon (server echoes held item in field 8); then key 3 (wall) and place it
    t2 = time.time() - T0
    press(a, "1"); time.sleep(1.0)
    f8 = [v for t, v in ((va.ent(ida) or {}).get("f8") or []) if t >= t2]
    a.shot("p_held_picked")
    step("hotbar_select_picked", item is not None and item in f8, item=item, held_seen=f8[-5:])
    t3 = time.time() - T0
    tried = []
    for dx, dy in ((-200, 0), (200, 0), (0, -200), (0, 200), (-150, -150), (150, 150)):   # a tree or rock next to A blocks some sides
        press(a, "3"); time.sleep(0.6)
        a.mouse("mouseMoved", cx + dx, cy + dy); time.sleep(0.3)
        a.mouse("mousePressed", cx + dx, cy + dy); time.sleep(0.15); a.mouse("mouseReleased", cx + dx, cy + dy); time.sleep(1.2)
        tried.append((dx, dy))
        if [e for e in va.statics() if (e.get("create") or {}).get("16") and e.get("create_t", 0) >= t3]: break
    a.shot("p3_placed")
    placed = [e for e in va.statics() if (e.get("create") or {}).get("16") and e.get("create_t", 0) >= t3]
    ic2 = va.msgs(36, t3)
    srv = [e for e in slog.read() if e.get("k") in ("place", "place_blocked", "place_limit", "place_no_res")]
    step("place_wall", bool(placed) and any(e.get("k") == "place" for e in srv), directions=tried, placed=[(e["id"], (e.get("create") or {}).get("16")) for e in placed][:3], item_count=[m for t, m in ic2][:3], server=srv[-3:])
    out.update({"item": item, "xp": xp1})
    return out

def walk_to_point(b, vb, me, q, near=120, secs=12):
    held, end = set(), time.time() + secs
    try:
        while time.time() < end:
            p = vb.pos(me)
            if not p: time.sleep(0.2); continue
            dx, dy = q[0] - p[0], q[1] - p[1]
            if (dx * dx + dy * dy) ** 0.5 <= near: break
            want = set()
            if dx > 30: want.add("d")
            elif dx < -30: want.add("a")
            if dy > 30: want.add("s")
            elif dy < -30: want.add("w")
            for k in held - want: b.key("keyUp", k)
            for k in want - held: b.key("keyDown", k)
            held = want; time.sleep(0.12)
    finally:
        for k in held: b.key("keyUp", k)

# ---------------------------------------------------------------- age-up picker targeting
_TREE = {}
def TREE():
    if not _TREE:
        src = open(os.path.join(PKG, "mimic", "hosted", "social.js")).read()
        m = re.search(r"const TREE = (\{.*?\});", src)
        _TREE.update({int(k): v for k, v in json.loads(re.sub(r"(\d+):\[", r'"\1":[', m.group(1))).items()})
    return _TREE

def pick_options(level, picks):
    return sorted(i for i, (lv, prev, g) in TREE().items() if lv == level and i not in picks and (prev is None or prev in picks))

ORDER_FILE = os.path.join(PKG, "work", "picker_order.json")
def load_order():
    try: return json.load(open(ORDER_FILE))
    except Exception: return {"1:1,9,27,42,57,72": [57, 27, 1, 9, 42, 72]}   # seen in run 20261017_165730

def pick_targets(x, v, me, name, slog, targets, top_level, tries=8):
    # picks one item per level 1..top_level; targets {level: item}; the picker draws n cards at x = 640 + 60*(i - (n-1)/2), y 37
    # (1280x800 viewport). A wrong pick at a target level is recorded in the learned order and the player dies (picks reset)
    order = load_order(); log = []; idx_try = {}
    for attempt in range(tries):
        me = ensure_alive(x, v, name) or me
        need = 20 * top_level * (top_level + 1) + 10 - v.xp()
        if need > 0: send_chat(x, "/testxp %d" % need); time.sleep(1.2)
        picks = set([0, 166, 206, 249, 266, 307]); ok = True
        for level in range(1, top_level + 1):
            opts = pick_options(level, picks)
            if not opts: continue
            key = "%d:%s" % (level, ",".join(map(str, opts)))
            known = order.get(key) or []
            want = targets.get(level)
            if want is not None and want in known: i = known.index(want)
            elif want is not None:
                cand = [j for j in range(len(opts)) if j >= len(known) or known[j] is None]
                i = cand[idx_try.get(level, 0) % len(cand)] if cand else 0
            else: i = 0
            n = len(opts); px = int(640 + 60 * (i - (n - 1) / 2))
            tw = time.time()
            x.mouse("mouseMoved", px, 37); time.sleep(0.2); x.mouse("mousePressed", px, 37); time.sleep(0.15); x.mouse("mouseReleased", px, 37)
            got = wait_for(lambda: [e for e in slog.read() if e.get("k") == "pick" and e.get("t", 0) >= tw - 0.5], 2.5)
            item = got[-1].get("item") if got else None
            log.append({"attempt": attempt, "level": level, "n": n, "i": i, "x": px, "want": want, "got": item})
            if item is None: ok = False; break
            known = (order.get(key) or [None] * n) + [None] * n; known = known[:n]; known[i] = item; order[key] = known
            picks.add(item)
            if want is not None and item != want:
                idx_try[level] = idx_try.get(level, 0) + 1; ok = False; break
            time.sleep(0.5)
        try: json.dump(order, open(ORDER_FILE, "w"), indent=0)
        except Exception: pass
        if ok: return me, True, log
        time.sleep(5.5); send_chat(x, "/testdie"); time.sleep(2.0)   # picks reset on respawn
    return me, False, log

def hold_item(x, v, me, item):
    for k in "123456789":
        t0 = time.time() - T0
        press(x, k); time.sleep(0.7)
        if item in [vv for t, vv in ((v.ent(me) or {}).get("f8") or []) if t >= t0]: return k
    return None

# ---------------------------------------------------------------- visual pairs: the reference features, seen on the clone

def send_chat(x, text):
    x.js("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
    press(x, "Enter"); time.sleep(0.5)
    if x.js("document.activeElement&&document.activeElement.id") != "chat-input": click_sel(x, "#chat-input", 0.2)
    ok = x.js("document.activeElement&&document.activeElement.id") == "chat-input"
    if ok: type_keys(x, text); time.sleep(0.15)
    press(x, "Enter"); time.sleep(0.6)
    return ok

def node_hook(msgs, port):
    # loopback helper player in room offline1 sends dev JSON (creatures test hook), e.g. {type: 990, phase: 2}
    node = sorted(glob.glob(os.path.expanduser("~/node-v*/bin/node")))[-1]
    js = """const net=require('net'),path=require('path');const R=process.argv[1];
const {TestClient}=require(path.join(R,'mimic','hosted','testclient.js'));const {encodeJoin}=require(path.join(R,'mimic','hosted','joincodec.js'));
const P=+process.argv[2];(async()=>{const c=new TestClient(()=>net.connect(P,'127.0.0.1'),{host:'127.0.0.1:'+P,path:'/_h/offline1/offline1?1_2',origin:'http://127.0.0.1:'+P});
await c.until((x)=>x.status,3000);await new Promise(r=>setTimeout(r,300));c.json({type:1,c:encodeJoin(JSON.stringify({name:'vishelper'}),243)});
await c.until((x)=>x.msgs.find((q)=>q['1']===19&&q.s===false),3000);for(const m of JSON.parse(process.argv[3])){c.json(m);await new Promise(r=>setTimeout(r,400));}
await new Promise(r=>setTimeout(r,800));console.log('hook sent');process.exit(0);})().catch(e=>{console.log('hook err '+e);process.exit(1)});"""
    r = subprocess.run([node, "-e", js, PKG, str(port), json.dumps(msgs)], capture_output=True, text=True, timeout=30, cwd=PKG)
    return (r.stdout + r.stderr).strip()[-200:]

VIS_VIEW = {}
def vshot(x, feature, notes, note):
    # same viewport as the reference frame (the player's window), only for the screenshot
    d = os.path.join(OUT, "visual"); os.makedirs(d, exist_ok=True)
    vp = VIS_VIEW.get(feature) or VIS_VIEW.get("_default") or [1920, 936]
    x.pcall("Emulation.setDeviceMetricsOverride", {"width": int(vp[0]), "height": int(vp[1]), "deviceScaleFactor": 1, "mobile": False})
    time.sleep(0.8)
    ok = x.shot("vis_" + feature)
    x.pcall("Emulation.clearDeviceMetricsOverride"); time.sleep(0.4)
    if ok: shutil.copy(os.path.join(OUT, "vis_%s_%s.png" % (feature, x.tag)), os.path.join(d, feature + "_clone.png"))
    notes[feature] = {"clone": ok, "who": x.tag, "note": note, "t": round(time.time() - T0, 2)}
    return ok

def vcopy(src, feature, notes, note):
    d = os.path.join(OUT, "visual"); os.makedirs(d, exist_ok=True)
    ok = os.path.exists(src)
    if ok: shutil.copy(src, os.path.join(d, feature + "_clone.png"))
    notes[feature] = {"clone": ok, "who": "A", "note": note, "from": os.path.basename(src)}

def run_visual(a, b, va, vb, ida, idb, slog, picks):
    notes = {}
    port = A.own_server
    try:
        rm = json.load(open(os.path.join(PKG, "logs", "reference_frames", "frames.json")))
        for k, v in rm.get("frames", {}).items():
            if v.get("viewport"): VIS_VIEW[k] = v["viewport"]
    except Exception: pass
    # hammer: A's level-1 pick from the social step (Stone Hammer 57)
    ida = ensure_alive(a, va, "ProofA") or ida
    press(a, "1"); time.sleep(0.8)
    vshot(a, "hammer_held", notes, "A holds its level-1 pick (item %s)" % ((picks or {}).get("item")))
    # clan panel: A (not in a team after the social step) creates another clan; shot with the leader panel open
    open_team(a); time.sleep(0.6)
    inp = a.js("(function(){var e=document.querySelector('#team-box input');if(!e)return null;e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()")
    if inp: a.click(inp[0], inp[1]); time.sleep(0.2); type_text(a, "AI"); time.sleep(0.3)
    cb = click_text(a, "#team-box", "^(create|ok|\\+)$"); time.sleep(1.2)
    vshot(a, "clan_panel", notes, "A's team panel right after creating clan AI (create clicked: %s)" % bool(cb))
    close_team(a)
    # pet following: A walks, its pet (create category 0 with 13 = A) follows
    ida = ensure_alive(a, va, "ProofA") or ida
    pet = [e for e in va.ents.values() if (e.get("create") or {}).get("2") == 0 and (e.get("create") or {}).get("13") == ida] if False else None
    a.key("keyDown", "a"); time.sleep(1.4); vshot(a, "pet_following", notes, "A walking left; own pet expected to follow"); a.key("keyUp", "a")
    # deflagration: pet ultimate button (last icon of the pet bar), then wait for the pet's category-4 skill create (7 = 0)
    t0 = time.time() - T0
    tw = time.time()
    a.click(22, 14); time.sleep(0.8)   # swirl icon on the pet card = pet ultimate {type 48, S 4}; it also opens the pet info panel
    a.js("""(function(){var q=document.querySelectorAll('.popup-box');for(var i=0;i<q.length;i++){var p=q[i];if(p.offsetParent===null||p.id==='team-box')continue;var x=p.querySelector('.button-quit');if(x&&x.offsetParent!==null){x.click();return p.id;}}return null;})()""")
    time.sleep(0.4)
    cx, cy = screen_center(a)
    def proj():
        with va.lock:
            return [e for e in va.ents.values() if (e.get("create") or {}).get("2") == 4 and e.get("create_t", 0) >= t0]
    hit = wait_for(proj, 2.5)
    for _ in range(0 if hit else 3):   # no cast: swing at B nearby so the pet engages
        walk_to(a, va, ida, idb, near=120, secs=8)
        pa, pb = va.pos(ida), va.pos(idb)
        if pa and pb:
            dx, dy = pb[0] - pa[0], pb[1] - pa[1]; d = max(1.0, (dx * dx + dy * dy) ** 0.5)
            a.mouse("mouseMoved", cx + dx / d * 150, cy + dy / d * 150); a.mouse("mousePressed", cx + dx / d * 150, cy + dy / d * 150)
        hit = wait_for(proj, 5); a.mouse("mouseReleased", cx, cy)
        if hit: break
    ps = [e for e in slog.read() if e.get("k") == "pet_skill" and e.get("t", 0) >= tw - 0.5]
    vshot(a, "deflagration", notes, "pet_skill %s, projectile %s" % (ps[-1:], [(e.get("create") or {}) for e in (hit or [])][:2]))
    # chest: nearest gift object, walk, hit until it opens (removed or loot)
    ida = ensure_alive(a, va, "ProofA") or ida
    names = NAMES(); gift = None; p = va.pos(ida)
    if p:
        best = 1e18
        for e in va.statics():
            c = e.get("create") or {}; n = names[c["13"]] if isinstance(c.get("13"), int) and c["13"] < len(names) else ""
            if not str(n).startswith("gift"): continue
            q = e["pos"][-1][1:] if e["pos"] else (c.get("3"), c.get("4")); d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
            if d < best: best, gift = d, (e["id"], n, q)
    opened = False
    if gift and best ** 0.5 < 2500:
        walk_to_point(a, va, ida, gift[2], near=140, secs=20)
        for _ in range(10):
            pa = va.pos(ida)
            if not pa: break
            dx, dy = gift[2][0] - pa[0], gift[2][1] - pa[1]; d = max(1.0, (dx * dx + dy * dy) ** 0.5)
            mx, my = cx + dx / d * 150, cy + dy / d * 150
            a.mouse("mouseMoved", mx, my); a.mouse("mousePressed", mx, my); time.sleep(0.9); a.mouse("mouseReleased", mx, my)
            e = va.ent(gift[0]) or {}
            if e.get("removed_t") or (e.get("f14") is None and any((v.get("7") == 0) for v in [])): opened = True; break
        time.sleep(0.2)
    vshot(a, "chest_opening", notes, "gift %s at distance %s, opened=%s" % (gift and gift[1], gift and round(best ** 0.5), opened))
    # biome: before, then the creatures test hook switches the room to dark (phase 2)
    vshot(a, "biome_before", notes, "before the switch")
    out = node_hook([{"type": 990, "phase": 2}], port); time.sleep(2.5)
    bl = [e for e in slog.read() if e.get("k") == "biome"][-1:]
    vshot(a, "biome_switch", notes, "test hook phase 2 (dark): %s %s" % (out, bl))
    # knight helm: /testgold, hat shop (key C), Knight's Helmet (hat 25), buy, equip
    ida = ensure_alive(a, va, "ProofA") or ida
    tw = time.time()
    send_chat(a, "/testgold"); time.sleep(0.8)
    press(a, "c"); time.sleep(1.2)
    dump(a, "#items-box", "v_shop"); a.shot("v_shop")
    click_sel(a, "#hats-button", 0.5)
    k = a.js("""(function(){var e=document.querySelector('#items-game-list #item25');if(!e)return null;e.scrollIntoView({block:'center'});
      var b=e.getBoundingClientRect();if(!b.width)return null;return [b.x+b.width/2,b.y+b.height/2,e.className];})()""")
    if k: a.click(k[0], k[1]); time.sleep(0.6)
    bu = click_sel(a, "#buy-item", 0.8); eq = click_sel(a, "#equip-button", 0.8)
    click_sel(a, "#quit-items", 0.5)
    sl = [e for e in slog.read() if e.get("k") in ("test_gold", "shop_buy", "shop_equip", "shop_refused") and e.get("t", 0) >= tw - 1]
    time.sleep(0.6)
    vshot(a, "knight_helm", notes, "shop entry %s, buy %s, equip %s, server %s" % (k and k[2], bu, eq, sl[-3:]))
    # axe on B: /testxp to age 1, then pick; the picker cards are invisible (unmirrored images), so try positions
    tried = []
    for x in (550, 610, 670, 730, 430, 790):
        idb = ensure_alive(b, vb, "ProofB") or idb
        tw = time.time()
        send_chat(b, "/testxp 50"); time.sleep(1.2)
        if "age_up_picker" not in notes: vshot(b, "age_up_picker", notes, "B at age 1 via /testxp, picker showing")
        b.mouse("mouseMoved", x, 37); time.sleep(0.15); b.mouse("mousePressed", x, 37); time.sleep(0.15); b.mouse("mouseReleased", x, 37); time.sleep(0.8)
        pk = [e for e in slog.read() if e.get("k") == "pick" and e.get("t", 0) >= tw - 1]
        tried.append((x, pk[-1].get("item") if pk else None))
        if pk and pk[-1].get("item") == 72: break
        if pk:
            time.sleep(5.5); send_chat(b, "/testdie"); time.sleep(1.5)   # picks reset on respawn
    press(b, "1"); time.sleep(0.8)
    vshot(b, "axe_held", notes, "B level-1 picks tried (x, item): %s" % tried)
    # pickaxe (L6 Golden Pickaxe after L1 Stone Hammer), riding (L5 Saddle), boost pad (L8): one pick chain on B
    idb, okp, plog = pick_targets(b, vb, idb, "ProofB", slog, {1: 57, 5: 160, 6: 65, 8: 193}, 8)
    notes["_pick_chain"] = {"ok": okp, "log": plog[-24:]}
    k = hold_item(b, vb, idb, 65)
    vshot(b, "pickaxe_held", notes, "B holds Golden Pickaxe 65 (key %s, chain ok %s)" % (k, okp))
    k = hold_item(b, vb, idb, 193)
    bcx, bcy = screen_center(b); placed = None; tw = time.time()
    for dx, dy in ((0, -200), (200, 0), (-200, 0), (0, 200)):
        b.mouse("mouseMoved", bcx + dx, bcy + dy); time.sleep(0.3); b.mouse("mousePressed", bcx + dx, bcy + dy); time.sleep(0.15); b.mouse("mouseReleased", bcx + dx, bcy + dy); time.sleep(1.0)
        placed = [e for e in slog.read() if e.get("k") == "place" and e.get("t", 0) >= tw - 0.5]
        if placed: break
        hold_item(b, vb, idb, 193)
    vshot(b, "boost_pad", notes, "B placed a boost pad (key %s): %s" % (k, placed[-1:] if placed else None))
    k = hold_item(b, vb, idb, 160)
    pet = None
    with vb.lock:
        for e in vb.ents.values():
            c = e.get("create") or {}
            if c.get("2") == 0 and c.get("13") == idb and "removed_t" not in e: pet = e["id"]
    tw = time.time()
    if pet:
        walk_to(b, vb, idb, pet, near=90, secs=8)
        pb, pp = vb.pos(idb), vb.pos(pet)
        if pb and pp:
            dx, dy = pp[0] - pb[0], pp[1] - pb[1]; d = max(1.0, (dx * dx + dy * dy) ** 0.5)
            b.mouse("mouseMoved", bcx + dx / d * 120, bcy + dy / d * 120); time.sleep(0.2)
            b.mouse("mousePressed", bcx + dx / d * 120, bcy + dy / d * 120); time.sleep(0.6); b.mouse("mouseReleased", bcx, bcy); time.sleep(1.2)
    ride = [e for e in slog.read() if re.search(r"mount|ride|saddle", str(e.get("k"))) and e.get("t", 0) >= tw - 0.5]
    vshot(b, "riding", notes, "B with Saddle (key %s) swings at own pet %s: %s" % (k, pet, ride[-2:]))
    # pairs: copy the reference frames next to the clone frames, write an HTML page
    d = os.path.join(OUT, "visual"); refdir = os.path.join(PKG, "logs", "reference_frames")
    try: refmeta = json.load(open(os.path.join(refdir, "frames.json")))
    except Exception: refmeta = {"frames": {}}
    rows = []
    for name, T, note in REF_FEATURES:
        src = os.path.join(refdir, name + ".png")
        if os.path.exists(src): shutil.copy(src, os.path.join(d, name + "_ref.png"))
        n = notes.get(name, {})
        rows.append("<tr><td><b>%s</b><br>capture t %s<br>%s<br><i>%s</i></td><td>%s</td><td>%s</td></tr>" % (
            name, T, note, n.get("note", ""), "<img src='%s_ref.png' width=560>" % name if os.path.exists(src) else "no reference",
            "<img src='%s_clone.png' width=560>" % name if n.get("clone") else "not reproduced"))
    open(os.path.join(d, "index.html"), "w").write("<!doctype html><meta charset=utf-8><title>Visual pairs</title><style>body{font:14px sans-serif;background:#fff;color:#111}td{vertical-align:top;padding:6px;border-bottom:1px solid #ccc}</style><table><tr><th>feature</th><th>reference (capture replay)</th><th>clone</th></tr>%s</table>" % "".join(rows))
    json.dump(notes, open(os.path.join(d, "notes.json"), "w"), indent=1, ensure_ascii=False, default=str)
    step("visual_pairs", sum(1 for v in notes.values() if v.get("clone")) >= 8, made=sorted(k for k, v in notes.items() if v.get("clone")), missing=sorted(k for k, v in notes.items() if not v.get("clone")))
    return notes

def own_server():
    node = sorted(glob.glob(os.path.expanduser("~/node-v*/bin/node")))[-1]
    ld = os.path.join(OUT, "server")
    os.makedirs(ld, exist_ok=True)
    env = dict(os.environ)
    if A.visual: env.update({"TIO_SOCIAL_TEST": "1", "TIO_CREATURES_TEST": "1"})   # private instance only: /testxp, /testgold, biome hook
    p = subprocess.Popen([node, os.path.join(PKG, "mimic", "hosted_server.js"), "--port", str(A.own_server), "--logdir", ld],
                         stdout=open(os.path.join(OUT, "server.out"), "w"), stderr=subprocess.STDOUT, start_new_session=True, env=env)
    A.server_pid = p.pid; A.server_log = os.path.join(ld, "server.jsonl")
    ok = False
    for _ in range(150):
        try: NOPROXY.open(A.url, timeout=1); ok = True; break
        except Exception: time.sleep(0.2)
        if p.poll() is not None: break
    mark("own_server", port=A.own_server, pid=p.pid, up=ok, logdir=ld)
    return p
def v01_server():
    global V01
    V01 = free_port()
    node = sorted(glob.glob(os.path.expanduser("~/node-v*/bin/node")))[-1]
    p = subprocess.Popen([node, os.path.join(PKG, "mimic", "mimic_server.js"), "--port", str(V01), "--config", os.path.join(PKG, "mimic", "mimic_config.json"),
                          "--log", os.path.join(OUT, "v01_server.jsonl")], stdout=open(os.path.join(OUT, "v01_server.out"), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    A.server_log = os.path.join(OUT, "v01_server.jsonl")
    for _ in range(100):
        try: socket.create_connection(("127.0.0.1", V01), 0.5).close(); break
        except Exception: time.sleep(0.1)
    return p, "https://taming.invalid/?r=atlanta&i=4"

# ---------------------------------------------------------------- reference frames from the human capture
# capture time t = seconds since the capture's ws_open (the convention of mimic/data/sp5_action_timeline.md)
REF_FEATURES = [   # name, capture t, note
    ("pet_following", 30.0, "own wolf pet follows while the player walks (t 19.5-35.8)"),
    ("age_up_picker", 59.0, "age 0 -> 1 at t 57.42, picker until the Stone Axe pick at t 63.01"),
    ("deflagration", 71.2, "pet ultimate Deflagration at t 70.59, effect created t 70.86"),
    ("clan_panel", 152.6, "clan AI created at t 151.61 (panel opened t 146.85, closed t 153.32)"),
    ("chest_opening_early", 202.97, "gift52 opened at t 202.93 (hit to hp 0 + type 75 gift info)"),
    ("biome_before", 341.0, "snow, just before the switch"),
    ("biome_switch", 343.5, "biome snow -> dark at t 342.11"),
    ("axe_held", 386.5, "Stone Axe selected at t 380.38"),
    ("boost_pad", 826.5, "boost pad placed at t 825.49"),
    ("riding", 866.0, "Saddle selected at t 862.50"),
    ("knight_helm", 958.0, "Knight's Helmet bought + equipped t 955.49-955.70"),
    ("hammer_held", 1660.0, "Stone Hammer selected t 1656.94-1657.31"),
    ("pickaxe_held", 1715.0, "Golden Pickaxe selected t 1712.51"),
    ("chest_opening", 2182.55, "gift48 (pumpkin) opened at t 2182.5: hp 106 -> 0, gift info gi=48, loot food 216, xp 16"),
]
REF_T_OFFSET = 1.23    # timeline t of the first recorded frame (row 493)
REF_WS_OPEN_WALL = None   # wall clock of the capture's ws_open (t = 0)

def ref_inputs():
    # the player's own inputs from the capture (input records: kd/ku keys, mm/md/mu mouse, dims window size), as capture t
    out = os.path.join(PKG, "work", "ref_sp5_inputs.json")
    if os.path.exists(out): return json.load(open(out))
    import gzip
    t_open, evs = None, []
    with gzip.open(A.capture, "rt") as f:
        for line in f:
            try: r = json.loads(line)
            except Exception: continue
            if r.get("k") == "ws_open" and t_open is None: t_open = r.get("wall")
            if r.get("k") == "input":
                for e in r.get("ev", []):
                    if e[2] in ("kd", "ku", "mm", "md", "mu", "dims"): evs.append([e[1] / 1000.0] + e[2:])
    evs.sort(key=lambda e: e[0])
    res = [[round(e[0] - t_open, 3)] + e[1:] for e in evs]
    json.dump(res, open(out, "w"))
    return res

class InputReplay:
    # dispatches the player's inputs at their capture time (mapped through the replay anchor); modifier keys and anything
    # pressed while a modifier is down are skipped (browser shortcuts), key autorepeat is collapsed
    MODS = ("Meta", "Control", "Alt", "OS")
    def __init__(self, b, evs, wall, t_from):
        self.b, self.evs, self.wall, self.t_from = b, evs, wall, t_from
        self.stop = False; self.sent = 0; self.skipped = 0; self.down = set(); self.mod = False; self.dims = None
        threading.Thread(target=self.run, daemon=True).start()
    def set_dims(self, w, h):
        self.dims = (w, h)
        self.b.pcall("Emulation.setDeviceMetricsOverride", {"width": int(w), "height": int(h), "deviceScaleFactor": 1, "mobile": False})
    def run(self):
        last = [e for e in self.evs if e[1] == "dims" and e[0] <= self.t_from]
        if last: self.set_dims(last[-1][2], last[-1][3])
        for e in self.evs:
            if self.stop: break
            T, kind = e[0], e[1]
            if T < self.t_from: continue
            dt = self.wall(T) - time.time()
            if dt > 0: time.sleep(dt)
            try:
                if kind == "dims": self.set_dims(e[2], e[3]); continue
                if kind in ("kd", "ku"):
                    code, key = e[2], e[3]
                    if key in self.MODS:
                        self.mod = kind == "kd"; self.skipped += 1; continue
                    if self.mod: self.skipped += 1; continue
                    if kind == "kd" and code in self.down: continue
                    if kind == "kd": self.down.add(code)
                    else: self.down.discard(code)
                    p = {"type": "keyDown" if kind == "kd" else "keyUp", "key": key, "code": code}
                    vk = {"Enter": 13, "Escape": 27, "Space": 32, "Backspace": 8, "Tab": 9, "ShiftLeft": 16, "ShiftRight": 16}.get(code)
                    if vk is None and len(key) == 1: vk = ord(key.upper())
                    if vk: p["windowsVirtualKeyCode"] = vk
                    if kind == "kd" and len(key) == 1: p["text"] = key
                    if kind == "kd" and key == "Enter": p["text"] = "\r"
                    self.b.send("Input.dispatchKeyEvent", p, self.b.page_sid)
                elif kind == "mm":
                    self.b.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": e[2], "y": e[3], "button": "none"}, self.b.page_sid)
                else:
                    btn = {0: "left", 1: "middle", 2: "right"}.get(e[2], "left")
                    self.b.send("Input.dispatchMouseEvent", {"type": "mousePressed" if kind == "md" else "mouseReleased", "x": e[3], "y": e[4], "button": btn, "clickCount": 1}, self.b.page_sid)
                self.sent += 1
            except Exception:
                self.skipped += 1
REF_TOKEN_T = 19.91    # timeline t of the TOKEN text frame (2nd anchor)

def ref_capture():
    # offline_proxy.py anchors the replay on every recorded client text frame; a live client sends only the join
    # and the token by itself, so later text frames (pet skills, clan, chat) are relabelled binary (not anchors)
    out = os.path.join(PKG, "work", "ref_sp5_capture.jsonl")
    if os.path.exists(out) and os.path.getsize(out) > 1000: return out
    import gzip
    n_text = 0
    with gzip.open(A.capture, "rt") as f, open(out + ".tmp", "w") as g:
        for line in f:
            try: r = json.loads(line)
            except Exception: continue
            if r.get("k") not in ("ws_open", "rx", "tx"): continue
            if r.get("k") == "tx" and r.get("op", 2) == 1:
                n_text += 1
                if n_text > 2: r["op"] = 2
            g.write(json.dumps(r) + "\n")
    os.rename(out + ".tmp", out)
    return out

def ref_run():
    global V01
    V01 = A.ref_port
    cap = ref_capture()
    plog = os.path.join(OUT, "replay_proxy.jsonl")
    p = subprocess.Popen([sys.executable, "-I", "-u", os.path.join(PKG, "offline_proxy.py"), "--cap", cap, "--port", str(A.ref_port),
                          "--speed", str(A.ref_speed), "--gate", "0", "--log", plog],
                         stdout=open(os.path.join(OUT, "replay_proxy.out"), "w"), stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(300):
        try: socket.create_connection(("127.0.0.1", A.ref_port), 0.5).close(); break
        except Exception: time.sleep(0.2)
        if p.poll() is not None: break
    mark("replay_proxy", pid=p.pid, port=A.ref_port, cap=cap, speed=A.ref_speed)
    refdir = os.path.join(PKG, "logs", "reference_frames"); os.makedirs(refdir, exist_ok=True)
    meta = {"capture": A.capture, "speed": A.ref_speed, "url": None, "frames": {}}
    b, sw = None, None
    try:
        b = Browser("R")
        sw = SockWatch(lambda: b.pids() | {p.pid})
        v = View(b)
        url = "https://taming.invalid/?r=saopaulo&i=5"
        meta["url"] = url
        b.pcall("Page.navigate", {"url": url})
        wait_for(lambda: b.js(VISIBLE % json.dumps("#play-box")), 60); time.sleep(1.0); dismiss_popups(b)
        b.shot("ref_menu")
        b.js("(function(){var e=document.querySelector('#name');if(e){e.value='Player';e.dispatchEvent(new Event('input',{bubbles:true}));}})()")
        anchor = None
        for _ in range(40):   # Play only works once the spectate frames arrived
            r = b.js(VISIBLE % json.dumps("#play-box"))
            if not r: break
            dismiss_popups(b); b.click(r[0], r[1])
            if wait_for(lambda: not b.js(VISIBLE % json.dumps("#play-box")), 3): break
        mark("replay_play", menu_gone=not b.js(VISIBLE % json.dumps("#play-box")))
        for _ in range(300):
            for line in open(plog):
                try: e = json.loads(line)
                except Exception: continue
                if e.get("k") == "ws_anchor_ok" and e.get("n") == 2: anchor = e["t"]
            if anchor: break
            time.sleep(0.2)
        ws = [q["url"] for q in b.order if q["kind"] == "WebSocket"]
        mark("replay_anchor", wall=anchor, ws=ws)
        meta["ws"] = ws
        if not anchor: raise RuntimeError("replay never anchored on the token frame")
        wall = lambda T: anchor + (T - REF_TOKEN_T) / A.ref_speed
        ir = InputReplay(b, ref_inputs(), wall, REF_TOKEN_T + 0.3)   # the player's clicks and keys drive the UI (picks, panels, shop)
        for name, T, note in REF_FEATURES:
            if A.ref_until and T > A.ref_until: break
            dt = wall(T) - time.time() - 0.4
            if dt > 0: time.sleep(dt)
            blo = b.js(VISIBLE % json.dumps("#quit-blo-box"))   # offline artifact: dead ad scripts trigger the adblock popup
            if blo: b.click(blo[0], blo[1])
            dt = wall(T) - time.time()
            if dt > 0: time.sleep(dt)
            ok = b.shot("ref_" + name)
            src = os.path.join(OUT, "ref_%s_R.png" % name)
            if ok: shutil.copy(src, os.path.join(refdir, name + ".png"))
            meta["frames"][name] = {"capture_t": T, "late_s": round(time.time() - wall(T), 2), "note": note, "file": "logs/reference_frames/%s.png" % name, "ok": ok,
                                    "frames_decoded": len(b.ws_frames), "decode_errors": b.frame_err}
            meta["frames"][name]["viewport"] = ir.dims
            mark("ref_frame", name=name, T=T, ok=ok, viewport=ir.dims)
        meta["console_errors"] = [c for c in b.console if c["src"] in ("exception", "console.error")][:30]
        ir.stop = True; meta["inputs"] = {"sent": ir.sent, "skipped": ir.skipped}
    finally:
        if sw: sw.stop = True
        if b:
            meta["hosts"] = b.hosts(); b.close()
        try: os.killpg(p.pid, signal.SIGKILL)
        except Exception: pass
        meta["socket_watch"] = sw and {"samples": sw.samples, "max": sw.max, "nonloopback": sw.bad[:10]}
        json.dump(meta, open(os.path.join(refdir, "frames.json"), "w"), indent=1, ensure_ascii=False, default=str)
        json.dump(meta, open(os.path.join(OUT, "frames.json"), "w"), indent=1, ensure_ascii=False, default=str)
        shutil.rmtree(PROF, ignore_errors=True)
        mark("reference_done", out=refdir, frames=len(meta["frames"]))

def main():
    if A.reference:
        return ref_run()
    dry_p, base = (None, A.url)
    if A.dry:
        dry_p, base = dry_server()
    elif A.v01:
        dry_p, base = v01_server()
    elif A.own_server:
        dry_p = own_server()
    else:
        try:
            code = NOPROXY.open(base, timeout=5).status
        except Exception as e:
            code = str(e)
        mark("server_check", url=base, status=code)
    bs, sw, extra = [], None, {}
    global ssw
    try:
        bs = [Browser("A"), Browser("B")]
        sw = SockWatch(lambda: set().union(*[x.pids() for x in bs]))
        if not (A.dry or A.v01):
            srv_port = urllib.parse.urlsplit(base).port or 80
            ssw = SockWatch(lambda: server_pids(srv_port))
        if A.dry:
            for x in bs: x.pcall("Page.navigate", {"url": base})
            ok = wait_for(lambda: bs[0].js("document.readyState") == "complete" and bs[1].js("document.readyState") == "complete", 15)
            time.sleep(2.5)
            for x in bs: x.shot("01_dry")
            step("dry_page_loaded", ok, title=bs[0].js("document.title"))
            step("dry_worker_iframe_recorded", all(any(r["target"] == "worker" for r in x.order) and any(r["url"].endswith("/f.json") for r in x.order) for x in bs),
                 targets=sorted(set(r["target"] for r in bs[0].order)))
            step("dry_thirdparty_attempts_recorded", all(sum(1 for r in x.order if "thirdparty.invalid" in r["url"]) >= 2 for x in bs),
                 fails=[(r["url"], r["fail"]) for r in bs[0].order if r["fail"]][:8])
        else:
            extra = run_game(bs, base)
    except Exception as e:
        import traceback
        step("harness_exception", False, err=traceback.format_exc()[-1500:])
    finally:
        time.sleep(1.0)
        if sw: sw.stop = True
        report = {"ts": TS, "url": base, "milestone": A.milestone, "dry": A.dry, "chrome": chrome_bin(), "flags": FLAGS, "browsers": {}, "steps": STEPS, "extra": extra}
        for x in bs:
            report["browsers"][x.tag] = {"version": x.version, "pid": x.proc.pid, "devtools_port": x.port, "hosts": x.hosts(), "internal_schemes": x.internal(), "skipped_schemes": x.skipped,
                                         "n_requests": len(x.order), "failed": [{"url": r["url"][:200], "fail": r["fail"]} for r in x.order if r["fail"]][:60],
                                         "requests": [{k: (v[:300] if isinstance(v, str) else v) for k, v in r.items()} for r in x.order],
                                         "console": x.console[:200], "ws_records": len(x.ws_frames), "ws_decode_errors": x.frame_err,
                                         "targets": sorted(set(s.get("type") or "?" for s in x.sessions.values()))}
        if bs and not (A.dry or A.v01):
            errs = {}
            for x in bs:
                try: errs[x.tag] = x.js("window.__errs") or []
                except Exception as e: errs[x.tag] = ["read failed: %s" % e]
            jt = JOIN_T[0]
            unc = {x.tag: [c["text"][:300] for c in x.console if c["src"] == "exception" and jt and c["t"] >= jt and "NnukiuqQ" in c["text"]] for x in bs}
            step("no_client_exceptions", not any(errs.values()) and not any(unc.values()), loop_errors={k: v[:5] for k, v in errs.items()}, uncaught_after_join={k: v[:5] for k, v in unc.items()})
        for x in bs:
            try:
                report["browsers"][x.tag]["sw_registrations_js"] = x.js("navigator.serviceWorker?navigator.serviceWorker.getRegistrations().then(function(r){return r.map(function(x){return x.scope})}):'no navigator.serviceWorker'")
            except Exception as e:
                report["browsers"][x.tag]["sw_registrations_js"] = "err " + str(e)
            report["browsers"][x.tag]["sw_events"] = [u for u in x.sw if u and not u.startswith("chrome")]
            report["browsers"][x.tag]["navigations"] = x.navs
            report["browsers"][x.tag]["popups"] = x.popups
        for x in bs: x.close()
        if ssw: ssw.stop = True
        if dry_p and not A.own_server:
            try: os.killpg(dry_p.pid, signal.SIGKILL)
            except Exception: pass
        if sw:
            report["socket_watch"] = {"samples": sw.samples, "max_sockets": sw.max, "nonloopback_total": len(sw.bad), "nonloopback": sw.bad[:40]}
        if not A.keep_profiles:
            shutil.rmtree(PROF, ignore_errors=True)
            try: os.rmdir(os.path.dirname(PROF))
            except Exception: pass
        want = urllib.parse.urlsplit(base)
        allowed = {"%s:%d" % (want.hostname, want.port or 80)}
        host_ok = bool(bs) and all(set(report["browsers"][x.tag]["hosts"]) <= allowed for x in bs)
        step("only_allowed_hosts", host_ok, allowed=sorted(allowed), A=report["browsers"].get("A", {}).get("hosts"), B=report["browsers"].get("B", {}).get("hosts"))
        if not A.dry:
            miss, n = [], 0
            for x in bs:
                for q in x.order:
                    if urllib.parse.urlsplit(q["url"]).scheme in ("http", "https") and q.get("status") is not None:
                        n += 1
                        if not q.get("csp"): miss.append("%s %s %s" % (x.tag, q["status"], q["url"][:160]))
            csps = sorted(set(q.get("csp") for x in bs for q in x.order if q.get("csp") and urllib.parse.urlsplit(q["url"]).scheme in ("http", "https")))
            step("csp_on_every_response", n > 0 and not miss, responses=n, missing=len(miss), missing_examples=miss[:10], policies=[c[:300] for c in csps[:3]])
            for hk, want in (("referrer-policy", "no-referrer"), ("x-dns-prefetch-control", "off"), ("permissions-policy", None)):
                bad = ["%s %s %s=%s" % (x.tag, q["status"], q["url"][:140], (q.get("hdr") or {}).get(hk)) for x in bs for q in x.order
                       if urllib.parse.urlsplit(q["url"]).scheme in ("http", "https") and q.get("status") is not None
                       and (not (q.get("hdr") or {}).get(hk) or (want and (q.get("hdr") or {}).get(hk, "").strip().lower() != want))]
                step("header_%s" % hk, n > 0 and not bad, responses=n, bad=len(bad), examples=bad[:6])
        step("no_nonloopback_sockets_chrome", sw is not None and not sw.bad and sw.samples > 0, samples=sw and sw.samples, max_sockets=sw and sw.max, nonloopback_total=sw and len(sw.bad), bad=sw and sw.bad[:5])
        if ssw:
            report["server_socket_watch"] = {"pids": sorted(ssw.pids_seen), "samples": ssw.samples, "max_sockets": ssw.max, "nonloopback_total": len(ssw.bad), "nonloopback": ssw.bad[:40]}
            step("no_nonloopback_sockets_server", not ssw.bad and ssw.samples > 0, pids=sorted(ssw.pids_seen), samples=ssw.samples, max_sockets=ssw.max, nonloopback_total=len(ssw.bad), bad=ssw.bad[:5])
        if bs and not A.dry:
            origin = urllib.parse.urlsplit(base).netloc
            offn = {x.tag: [u for t, u in x.navs if urllib.parse.urlsplit(u).netloc != origin and u != "about:blank"] for x in bs}
            step("no_offorigin_navigation_or_popup", not any(offn.values()) and not any(u and urllib.parse.urlsplit(u).netloc not in (origin, "") for x in bs for t, typ, u in x.popups),
                 navs=offn, popups={x.tag: x.popups[:10] for x in bs})
            swr = {x.tag: (report["browsers"][x.tag]["sw_events"], report["browsers"][x.tag].get("sw_registrations_js")) for x in bs}
            step("no_service_worker", all(not e and r == [] for e, r in swr.values()), **swr)
        if not A.no_grep:
            try:
                g = static_grep(base) if not (A.dry or A.v01) else None
                report["static_grep"] = g
                if g: step("static_grep_no_real_host", g["real_host"] == 0, real_host=g["real_host"], invalid_host=g["invalid_host"], hosts_n=g["hosts_n"], fetched=g["fetched"], status=g["status"])
            except Exception as e:
                step("static_grep", False, err=str(e)[:300])
        if dry_p and A.own_server:
            try: os.killpg(dry_p.pid, signal.SIGKILL); dry_p.wait(5)
            except Exception: pass
            mark("own_server_stopped", pid=dry_p.pid)
        report["steps"] = STEPS
        if A.dry: report["pass"] = all(s["ok"] for s in STEPS if s["step"].startswith("dry_") or s["step"] == "no_nonloopback_sockets")
        else: report["pass"] = all(s["ok"] for s in STEPS)
        json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1, ensure_ascii=False, default=str)
        write_md(report)
        mark("done", pass_=report["pass"], out=OUT)
        print("REPORT", os.path.join(OUT, "report.md"))
        sys.exit(0 if report["pass"] else 1)

def write_md(r):
    L = ["# Hosted proof %s" % r["ts"], "", "Result: **%s**  (url %s, milestone %s%s)" % ("PASS" if r["pass"] else "FAIL", r["url"], A.milestone, ", dry run" if r["dry"] else ""), ""]
    for t, b in r["browsers"].items():
        L.append("- Browser %s: %s, pid %s, %d requests, targets %s, internal %s, skipped %s, WS records %d, console/log entries %d" % (
            t, b["version"], b["pid"], b["n_requests"], ",".join(b["targets"]), b["internal_schemes"], b["skipped_schemes"], b["ws_records"], len(b["console"])))
    L += ["", "## Steps", "", "| step | result | evidence |", "|---|---|---|"]
    for s in r["steps"]:
        L.append("| %s | %s | `%s` |" % (s["step"], "pass" if s["ok"] else "FAIL", json.dumps(s["evidence"], ensure_ascii=False, default=str)[:600].replace("|", "/")))
    L += ["", "## Request hosts per browser", ""]
    for t, b in r["browsers"].items():
        L.append("- %s: " % t + ", ".join("%s -> %d" % kv for kv in sorted(b["hosts"].items(), key=lambda kv: -kv[1])))
    for t, b in r["browsers"].items():
        if b["failed"]:
            L += ["", "Failed requests %s (first 15):" % t, ""] + ["- %s: %s" % (f["url"], f["fail"]) for f in b["failed"][:15]]
    for t, b in r["browsers"].items():
        if b["console"]:
            L += ["", "Console/log %s (first 15):" % t, ""] + ["- [%s] %s" % (c["src"], c["text"][:200].replace("\n", " ")) for c in b["console"][:15]]
    sw = r.get("socket_watch")
    if sw: L += ["", "Chrome socket watch: %d samples, max %d sockets, %d non-loopback" % (sw["samples"], sw["max_sockets"], sw["nonloopback_total"])]
    ss = r.get("server_socket_watch")
    if ss: L += ["", "Server socket watch (pids %s): %d samples, max %d sockets, %d non-loopback" % (ss["pids"], ss["samples"], ss["max_sockets"], ss["nonloopback_total"])]
    g = r.get("static_grep")
    if g:
        L += ["", "## Static grep of served files", "",
              "Fetched %d mirror paths (status %s), %d text files, %d bytes. real game host: %d, `taming.invalid`: %d, other hostname-like strings: %d distinct." % (
                  g["fetched"], g["status"], g["text_files"], g["bytes"], g["real_host"], g["invalid_host"], g["hosts_n"]), ""]
        for k in ("real_host", "invalid_host"):
            for e in g["examples"][k][:4]: L.append("- %s in %s (x%d): `%s`" % (k, e["path"], e["n"], e["ctx"].replace("`", "'")))
        L += ["", "Top hosts (files):", ""] + ["- %s: %d (e.g. %s)" % (h, v["files"], v["example"]) for h, v in list(g["hosts"].items())[:40]]
    vis = (r.get("extra") or {}).get("visual")
    if vis:
        L += ["", "## Visual pairs (reference = Saopaulo#5 capture replay, clone = this run)", "", "Side by side: visual/index.html", "", "| feature | reference | clone | note |", "|---|---|---|---|"]
        for name, T, note in REF_FEATURES:
            n = vis.get(name, {})
            L.append("| %s (t %s) | ![](visual/%s_ref.png) | %s | %s |" % (name, T, name, "![](visual/%s_clone.png)" % name if n.get("clone") else "not reproduced", str(n.get("note", "")).replace("|", "/")[:300]))
    wg = (r.get("extra") or {}).get("webgl")
    if wg:
        L += ["", "## WebGL (browser A)", "", "Contexts: " + ", ".join("%s %sx%s %s" % (c["type"], c["w"], c["h"], c.get("renderer", "")) for c in (wg.get("contexts") or [])),
              "", "Off-origin while on: %s. Console errors while on: %d." % (wg["offorigin"] or "none", len(wg["console_since_on"])), "",
              "Unmirrored assets requested while on (%d):" % wg["missing_total"], ""]
        for why, items in wg["missing"].items():
            L += ["- %s %s x%d" % (why, m["path"], m["count"]) for m in items]
    if r.get("extra"):
        L += ["", "## Extra", "", "```", json.dumps({k: v for k, v in r["extra"].items()}, ensure_ascii=False, default=str)[:3000], "```"]
    open(os.path.join(OUT, "report.md"), "w").write("\n".join(L) + "\n")

if __name__ == "__main__":
    main()
