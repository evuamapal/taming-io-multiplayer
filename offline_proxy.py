#!/usr/bin/env python3
# Offline taming.invalid: a local proxy that never connects outward.
#  - HTTPS (CONNECT) is terminated locally with a self-signed cert; plain HTTP proxy requests too.
#  - Every HTTP request is answered from the mirror (mirror/index.jsonl + mirror/files/<sha1(url)>), else 404.
#  - Every WebSocket is answered by a fake game server that replays the recorded server->client frames
#    of the matching captured socket, timing-aware and gated on the client's own frames (in order).
# Usage: offline_proxy.py --cap captures/<ts>.jsonl [--port 8790] [--speed 1.0] [--log offline_run/proxy.jsonl]
import argparse, base64, hashlib, json, os, socket, ssl, struct, sys, threading, time, urllib.parse
from socketserver import ThreadingTCPServer, StreamRequestHandler

BASE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--cap", required=True)
ap.add_argument("--mirror", default=os.path.join(BASE, "mirror"))
ap.add_argument("--port", type=int, default=8790)
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--gate", type=float, default=2.0, help="max secs to wait for the client's k-th frame before sending")
ap.add_argument("--log", default=os.path.join(BASE, "offline_run", "proxy.jsonl"))
ap.add_argument("--cert", default=os.path.join(BASE, "tls", "cert.pem"))
ap.add_argument("--key", default=os.path.join(BASE, "tls", "key.pem"))
ap.add_argument("--override", action="append", default=[], help="URL=localfile: serve a local (e.g. instrumented) file for that URL")
ap.add_argument("--inject", help="JSON file: [{after_s, msg}] world objects to add after the join (offline tests)")
A = ap.parse_args()
sys.path.insert(0, os.path.join(BASE, "decoder"))
import tio_proto as TP
INJ = json.load(open(A.inject)) if A.inject else []
FMAP = json.load(open(os.path.join(BASE, "decoder", "fieldmap.json"))) if INJ else {}
os.makedirs(os.path.dirname(A.log), exist_ok=True)
LOGF = open(A.log, "a")
LLOCK = threading.Lock()

def L(**kw):
    kw["t"] = round(time.time(), 3)
    with LLOCK:
        LOGF.write(json.dumps(kw, ensure_ascii=False) + "\n"); LOGF.flush()

# ---------------- mirror ----------------
MIR, MIR_NOQ, MIR_PATH = {}, {}, {}
def norm_noq(u):
    p = urllib.parse.urlsplit(u)
    return "%s://%s%s" % (p.scheme, p.netloc, p.path)
for line in open(os.path.join(A.mirror, "index.jsonl")):
    try:
        r = json.loads(line)
    except Exception:
        continue
    MIR[r["url"]] = r
    MIR_NOQ.setdefault(norm_noq(r["url"]), r)
    MIR_PATH.setdefault(urllib.parse.urlsplit(r["url"]).path, r)

def ctype_of(r):
    for k, v in (r.get("headers") or {}).items():
        if k.lower() == "content-type":
            return v
    m = r.get("mime") or "application/octet-stream"
    return m + ("; charset=UTF-8" if m.startswith("text/") or "javascript" in m or "json" in m else "")

OVR = dict(o.split("=", 1) for o in A.override)

def lookup(url):
    if norm_noq(url) in OVR:
        return {"file": os.path.abspath(OVR[norm_noq(url)]), "mime": "application/javascript", "headers": {"content-type": "application/javascript; charset=UTF-8"}}, "override"
    r = MIR.get(url) or MIR_NOQ.get(norm_noq(url))
    how = "exact" if url in MIR else ("noquery" if r else None)
    if not r:
        p = urllib.parse.urlsplit(url)
        if p.netloc.endswith("taming.invalid"):
            r = MIR_PATH.get(p.path); how = "path" if r else None
    return r, how

# ---------------- capture ----------------
WS_STREAMS = {}   # rid -> {"url":..., "ev":[(ts, dir, bytes, op)]}
ORDER = []
import gzip
for line in (gzip.open(A.cap, "rt") if A.cap.endswith(".gz") else open(A.cap)):
    try:
        r = json.loads(line)
    except Exception:
        continue
    k = r.get("k")
    if k == "ws_open":
        WS_STREAMS[r["rid"]] = {"url": r["url"], "ev": []}; ORDER.append(r["rid"])
    elif k in ("rx", "tx") and r.get("rid") not in WS_STREAMS and r.get("rid"):
        # recording started after the socket opened: keep it, url unknown (matched by order)
        WS_STREAMS[r["rid"]] = {"url": "wss://unknown.taming.invalid/unknown", "ev": []}; ORDER.append(r["rid"])
        WS_STREAMS[r["rid"]]["ev"].append((r["ts"], k, base64.b64decode(r["b64"]), r.get("op", 2)))
    elif k in ("rx", "tx") and r.get("rid") in WS_STREAMS:
        WS_STREAMS[r["rid"]]["ev"].append((r["ts"], k, base64.b64decode(r["b64"]), r.get("op", 2)))
USED = set()
ULOCK = threading.Lock()

def pick_socket(host, path):
    want = "%s%s" % (host, path)
    with ULOCK:
        for exact in (True, False):
            for rid in ORDER:
                if rid in USED:
                    continue
                p = urllib.parse.urlsplit(WS_STREAMS[rid]["url"])
                if (exact and p.netloc + p.path == want) or (not exact and p.path == path):
                    USED.add(rid); return rid
        for rid in ORDER:  # any unused socket, in recorded order
            if rid not in USED:
                USED.add(rid); return rid
        for rid in ORDER:  # all used: replay again (a replay is stateless)
            p = urllib.parse.urlsplit(WS_STREAMS[rid]["url"])
            if p.path == path:
                return rid
        return ORDER[0] if ORDER else None

# ---------------- websocket framing ----------------
def ws_send(f, payload, op=2):
    n = len(payload)
    hdr = bytes([0x80 | op])
    if n < 126:
        hdr += bytes([n])
    elif n < 65536:
        hdr += bytes([126]) + struct.pack(">H", n)
    else:
        hdr += bytes([127]) + struct.pack(">Q", n)
    f.write(hdr + payload); f.flush()

def ws_recv(f):
    h = f.read(2)
    if len(h) < 2:
        return None, None
    op, n = h[0] & 0x0F, h[1] & 0x7F
    masked = h[1] & 0x80
    if n == 126:
        n = struct.unpack(">H", f.read(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", f.read(8))[0]
    mask = f.read(4) if masked else b"\0\0\0\0"
    data = bytearray(f.read(n))
    for i in range(len(data)):
        data[i] ^= mask[i % 4]
    return op, bytes(data)

def serve_ws(rf, wf, host, path, query, headers):
    key = headers.get("sec-websocket-key", "")
    acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
    wf.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
              "Sec-WebSocket-Accept: %s\r\n\r\n" % acc).encode()); wf.flush()
    rid = pick_socket(host, path)
    L(k="ws_open", host=host, path=path, query=query, replay=rid, rec_url=WS_STREAMS.get(rid, {}).get("url"))
    if not rid:
        return
    ev = WS_STREAMS[rid]["ev"]
    rec_tx = [b for (_, d, b, _) in ev if d == "tx"]
    got = []
    got_text = [0]
    cond = threading.Condition()
    alive = [True]

    def reader():
        while alive[0]:
            try:
                op, data = ws_recv(rf)
            except Exception:
                break
            if op is None or op == 8:
                break
            if op == 9:
                continue
            with cond:
                i = len(got)
                got.append(data)
                if op == 1:
                    got_text[0] += 1
                cond.notify_all()
            exp = rec_tx[i] if i < len(rec_tx) else None
            L(k="ws_tx", rid=rid, i=i, n=len(data), same=(exp == data), head=data[:24].hex(),
              exp_head=(exp[:24].hex() if exp else None))
        alive[0] = False
        with cond:
            cond.notify_all()
    threading.Thread(target=reader, daemon=True).start()

    t0_rec = ev[0][0] if ev else 0
    t0 = time.time()
    ntx_before = 0
    ntext_before = 0
    sent = 0
    dec_s, enc_s, anchor_t = [TP.RX_SEED], [TP.RX_SEED], [time.time()]
    for ts, d, b, op in ev:
        if not alive[0]:
            break
        if d == "tx":
            ntx_before += 1
            if op == 1:
                # anchor: a client text frame (join request, token). Hold the replay until the live client
                # sends its own, then re-base the clock on that moment.
                ntext_before += 1
                L(k="ws_anchor_wait", rid=rid, n=ntext_before, head=b[:60].decode("utf-8", "replace"))
                with cond:
                    while alive[0] and got_text[0] < ntext_before:
                        cond.wait(0.1)
                t0 = time.time() - (ts - t0_rec) / A.speed
                anchor_t[0] = time.time()
                L(k="ws_anchor_ok", rid=rid, n=ntext_before)
            continue
        # gate: the recorded client had sent ntx_before frames before this server frame
        deadline = time.time() + A.gate
        with cond:
            while alive[0] and len(got) < ntx_before and time.time() < deadline:
                cond.wait(0.05)
        wait = t0 + (ts - t0_rec) / A.speed - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            if INJ and op == 2:
                # re-key: decrypt with the recorded stream, re-encrypt with ours, so frames can be added
                plain, dec_s[0] = TP.rx_xor(b, dec_s[0])
                if ntext_before >= 1:
                    for inj in INJ:
                        if not inj.get("_sent") and time.time() - anchor_t[0] >= inj.get("after_s", 2):
                            rec_ = TP.encode_fields(inj["msg"], FMAP)
                            out_, enc_s[0] = TP.rx_xor(rec_, enc_s[0])
                            ws_send(wf, out_, 2); inj["_sent"] = True
                            L(k="ws_inject", rid=rid, msg=inj["msg"], hex=rec_.hex())
                # keep injected objects alive: the client drops objects the server stops refreshing,
                # real ones get an empty type-84 compact record (case 0) in every update frame
                ka = b""
                for inj in INJ:
                    if inj.get("_sent"):
                        ka += TP.keepalive(inj["msg"]["0"])
                b, enc_s[0] = TP.rx_xor(plain + ka, enc_s[0])
            ws_send(wf, b, op if op in (1, 2) else 2)
        except Exception as e:
            L(k="ws_send_err", err=str(e)[:120])
            break
        sent += 1
        if sent % 200 == 0:
            L(k="ws_progress", rid=rid, sent=sent, client_frames=len(got))
    L(k="ws_replay_done", rid=rid, sent=sent, client_frames=len(got), rec_tx=len(rec_tx))
    # keep the socket open (idle) so the client does not reconnect-loop immediately
    while alive[0]:
        time.sleep(0.5)

# ---------------- http ----------------
def read_headers(rf):
    line = rf.readline(65537)
    if not line:
        return None, None
    hs = {}
    while True:
        l = rf.readline(65537)
        if not l or l in (b"\r\n", b"\n"):
            break
        k, _, v = l.decode("latin-1").partition(":")
        hs[k.strip().lower()] = v.strip()
    return line.decode("latin-1").strip(), hs

def respond(wf, code, body=b"", ctype="text/plain", extra=None):
    reason = {200: "OK", 404: "Not Found", 403: "Forbidden", 204: "No Content"}.get(code, "OK")
    h = "HTTP/1.1 %d %s\r\nContent-Length: %d\r\nContent-Type: %s\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n" % (code, reason, len(body), ctype)
    for k, v in (extra or {}).items():
        h += "%s: %s\r\n" % (k, v)
    wf.write((h + "\r\n").encode("latin-1") + body); wf.flush()

def serve_stream(rf, wf, scheme, default_host):
    while True:
        req, hs = read_headers(rf)
        if not req:
            return
        try:
            method, target, _ = req.split(" ", 2)
        except ValueError:
            return
        if "content-length" in hs:
            rf.read(int(hs["content-length"]))
        if target.startswith("http://") or target.startswith("https://"):
            url = target
        else:
            url = "%s://%s%s" % (scheme, hs.get("host", default_host), target)
        p = urllib.parse.urlsplit(url)
        if hs.get("upgrade", "").lower() == "websocket":
            serve_ws(rf, wf, p.netloc, p.path, p.query, hs)
            return
        if method == "OPTIONS":
            respond(wf, 204, extra={"Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "*"})
            continue
        r, how = lookup(url)
        if r:
            try:
                body = open(r["file"] if os.path.isabs(r["file"]) else os.path.join(A.mirror, "files", r["file"]), "rb").read()
            except Exception:
                body = None
            if body is not None:
                L(k="http", url=url[:300], hit=how, n=len(body))
                respond(wf, 200, body, ctype_of(r))
                continue
        L(k="http", url=url[:300], hit=None)
        respond(wf, 404, b"offline: not mirrored")

CTX = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
CTX.load_cert_chain(A.cert, A.key)

class H(StreamRequestHandler):
    def handle(self):
        req, hs = read_headers(self.rfile)
        if not req:
            return
        method, target, _ = req.split(" ", 2)
        if method == "CONNECT":
            host = target.split(":")[0]
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n"); self.wfile.flush()
            try:
                tls = CTX.wrap_socket(self.connection, server_side=True)
            except Exception as e:
                L(k="tls_fail", host=host, err=str(e)[:100]); return
            rf, wf = tls.makefile("rb"), tls.makefile("wb")
            try:
                serve_stream(rf, wf, "https", host)
            except Exception as e:
                L(k="stream_err", host=host, err=str(e)[:120])
            return
        # plain http proxy: re-inject the already-read request line
        p = urllib.parse.urlsplit(target)
        if hs.get("upgrade", "").lower() == "websocket":
            serve_ws(self.rfile, self.wfile, p.netloc, p.path, p.query, hs); return
        r, how = lookup(target)
        if r:
            body = open(r["file"] if os.path.isabs(r["file"]) else os.path.join(A.mirror, "files", r["file"]), "rb").read()
            L(k="http", url=target[:300], hit=how, n=len(body))
            respond(self.wfile, 200, body, ctype_of(r))
        else:
            L(k="http", url=target[:300], hit=None)
            respond(self.wfile, 404, b"offline: not mirrored")

class S(ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    L(k="start", cap=A.cap, sockets={rid: WS_STREAMS[rid]["url"] for rid in ORDER},
      frames={rid: len(WS_STREAMS[rid]["ev"]) for rid in ORDER}, mirror=len(MIR))
    print("offline proxy on 127.0.0.1:%d, %d mirrored urls, %d recorded sockets" % (A.port, len(MIR), len(ORDER)), flush=True)
    S(("127.0.0.1", A.port), H).serve_forever()
