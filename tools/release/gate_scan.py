#!/usr/bin/env python3
# Release gate: no real game host anywhere. Scans every file under the given dirs and zips, and with
# --serve BASE every mirrored URL as served by a running server. Exit 1 on any hit.
# Catches: plain/any case, split by quotes/plus/whitespace, \xHH \uHHHH \u{H} %HH &#N; &#xH; escapes,
# char-code lists, hex, reversed, UTF-16, base64 (all 3 alignments), inside zips.
import base64, codecs, io, json, os, re, sys, urllib.parse, urllib.request, zipfile

NEEDLE = codecs.decode("gnzvat.vb", "rot13").encode()
SEP = rb"(?:[\s'\"`+,\\]|\.|\[\.\]|\(\.\)|dot)*?"
PLAIN = re.compile(rb"taming" + SEP + rb"(?:\.|\[\.\]|\(\.\)|dot)" + SEP + rb"io(?![a-z0-9])", re.I)
HEX = re.compile(re.escape(NEEDLE.hex().encode()), re.I)
REV = re.compile(re.escape(NEEDLE[::-1]), re.I)
U16 = re.compile(re.escape(NEEDLE.decode().encode("utf-16-le")), re.I)
ESC = re.compile(rb"\\x([0-9a-f]{2})|\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|%([0-9a-f]{2})|&#x([0-9a-f]+);?|&#([0-9]+);?|\\([0-7]{3})", re.I)
CODES = re.compile(rb"(?:(?:0x[0-9a-f]+|\d{2,3})\s*,\s*){8,}(?:0x[0-9a-f]+|\d{2,3})", re.I)


B64RUN = re.compile(rb"[A-Za-z0-9+/_-]{12,}")


def b64_hits(b):
    for m in B64RUN.finditer(b):
        run = m.group(0).replace(b"-", b"+").replace(b"_", b"/")
        for off in range(4):
            chunk = run[off:]; chunk = chunk[:len(chunk) // 4 * 4]
            try: d = base64.b64decode(chunk)
            except Exception: continue
            if re.search(re.escape(NEEDLE) + rb"(?![a-z0-9])", d, re.I): yield m.start(); break


def unescape(b):
    def f(m):
        g = m.groups()
        try:
            if g[0] or g[3] or g[4]: n = int(g[0] or g[3] or g[4], 16)
            elif g[1] or g[2]: n = int(g[1] or g[2], 16)
            elif g[5]: n = int(g[5])
            else: n = int(g[6], 8)
            return bytes([n]) if n < 128 else b"?"
        except ValueError:
            return m.group(0)
    prev = None
    for _ in range(3):
        if b == prev: break
        prev, b = b, ESC.sub(f, b)
    return b


def codes(b):
    for m in CODES.finditer(b):
        try:
            nums = [int(x, 0) for x in re.split(rb"\s*,\s*", m.group(0))]
        except ValueError:
            continue
        s = bytes(n for n in nums if 0 < n < 128)
        if PLAIN.search(s): yield m.start()


def scan_bytes(b, where, hits):
    def hit(kind, pos, src):
        hits.append({"where": where, "kind": kind, "at": pos, "ctx": src[max(0, pos - 40):pos + 50].decode("latin1")})
    for m in PLAIN.finditer(b): hit("plain", m.start(), b)
    u = unescape(b)
    if u != b:
        for m in PLAIN.finditer(u): hit("escaped", m.start(), u)
    for rx, k in ((HEX, "hex"), (REV, "reversed"), (U16, "utf16")):
        for m in rx.finditer(b): hit(k, m.start(), b)
    for p in b64_hits(b): hit("base64", p, b)
    for p in codes(b): hit("charcodes", p, b)


def scan_file(data, where, hits, n):
    n[0] += 1
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for zi in z.infolist():
                    if not zi.is_dir(): scan_file(z.read(zi), where + "!" + zi.filename, hits, n)
            return
        except zipfile.BadZipFile:
            pass
    scan_bytes(data, where, hits)


def scan_path(p, hits, n):
    if os.path.isdir(p):
        for d, _, fs in os.walk(p):
            for f in fs:
                fp = os.path.join(d, f)
                if os.path.islink(fp): continue
                scan_file(open(fp, "rb").read(), fp, hits, n)
    else:
        scan_file(open(p, "rb").read(), p, hits, n)


def served_paths(index):
    seen = set()
    for line in open(index):
        try: u = urllib.parse.urlsplit(json.loads(line)["url"])
        except Exception: continue
        h = (u.hostname or "").lower()
        if h == "taming.invalid": p = u.path or "/"
        elif h.endswith(".taming.invalid"): p = "/_h/" + h[:-len(".taming.invalid")] + (u.path or "/")
        else: continue
        if u.query: p += "?" + u.query
        if p not in seen:
            seen.add(p); yield p


def scan_served(base, index, hits, n, hosts):
    host_re = re.compile(rb"(?:https?:|wss?:)?//([a-z0-9-]+(?:\.[a-z0-9-]+)+)", re.I)
    for p in ["/", "/blocked", "/manifest.json"] + list(served_paths(index)):
        try:
            r = urllib.request.urlopen(urllib.request.Request(base.rstrip("/") + p, headers={"Host": "play.example.test"}), timeout=20)
            data = r.read(); ct = r.headers.get("content-type", "")
        except urllib.error.HTTPError as e:
            data = e.read(); ct = e.headers.get("content-type", "")
        except Exception as e:
            hits.append({"where": p, "kind": "fetch_error", "at": 0, "ctx": str(e)}); continue
        scan_file(data, "served:" + p, hits, n)
        if re.search(r"text|javascript|json|css|xml|html", ct):
            for m in host_re.finditer(data):
                h = m.group(1).decode().lower()
                if not re.search(r"[a-z]", h.split(".")[-1]): continue
                hosts.setdefault(h, set()).add(p)


def main():
    args = sys.argv[1:]
    base = None
    if "--serve" in args:
        i = args.index("--serve"); base = args[i + 1]; index = args[i + 2]; del args[i:i + 3]
    hits, n, hosts = [], [0], {}
    for p in args: scan_path(p, hits, n)
    if base: scan_served(base, index, hits, n, hosts)
    real = [h for h in hits if h["kind"] != "fetch_error"]
    errs = [h for h in hits if h["kind"] == "fetch_error"]
    print("scanned %d files/bodies, %d hits, %d fetch errors" % (n[0], len(real), len(errs)))
    for h in real[:int(os.environ.get("SCAN_SHOW", "40"))]: print("HIT %s %s @%d: %r" % (h["kind"], h["where"], h["at"], h["ctx"]))
    for h in errs[:10]: print("FETCH_ERROR %s: %s" % (h["where"], h["ctx"]))
    if base:
        bad = {h: v for h, v in hosts.items() if h not in ("play.example.test",)}
        print("hostnames in served text other than the request host: %d" % len(bad))
        for h in sorted(bad)[:40]: print("  HOST %s (%d bodies, e.g. %s)" % (h, len(bad[h]), sorted(bad[h])[0]))
        if bad: real.append(None)
    sys.exit(1 if real or errs else 0)


if __name__ == "__main__":
    main()
