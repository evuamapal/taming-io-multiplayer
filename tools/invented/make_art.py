#!/usr/bin/env python3
# Invented boss pets: original cartoon art (dark outline, flat colors) for the invented species (own client slots), drawn offline with a
# small pure-Python rasterizer and PNG writer (no network, no PIL). Writes mimic/invented/png/*.png and
# mimic/invented/override.json ({"/img/h/<hash>.png": "invented/png/<file>.png"}) that hosted_server.js serves in place
# of the client's own sprite files for those species, and the ground fields of their ultimates (--only fx).
# Usage: make_art.py [--table work/creature_images_pinned.json] [--only NAME|icons|fx]
import argparse, json, math, os, random, struct, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import new_slots

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "mimic", "invented")
SS = 3   # supersampling per axis


# ---------------------------------------------------------------- png
def write_png(path, w, h, rgba):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * w * 4:(y + 1) * w * 4]
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(data)


def hexc(s, a=255):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


# ---------------------------------------------------------------- shapes (normalized 0..1 coordinates, e = outline grow)
class Ellipse:
    def __init__(s, cx, cy, rx, ry, rot=0.0):
        s.cx, s.cy, s.rx, s.ry, s.c, s.s = cx, cy, rx, ry, math.cos(rot), math.sin(rot)
    def bbox(s, e):
        r = max(s.rx, s.ry) + e
        return s.cx - r, s.cy - r, s.cx + r, s.cy + r
    def inside(s, x, y, e):
        dx, dy = x - s.cx, y - s.cy
        u, v = dx * s.c + dy * s.s, -dx * s.s + dy * s.c
        return (u / (s.rx + e)) ** 2 + (v / (s.ry + e)) ** 2 <= 1.0


class Poly:
    def __init__(s, pts):
        s.p = pts
    def bbox(s, e):
        xs = [p[0] for p in s.p]; ys = [p[1] for p in s.p]
        return min(xs) - e, min(ys) - e, max(xs) + e, max(ys) + e
    def inside(s, x, y, e):
        p, n, c = s.p, len(s.p), False
        j = n - 1
        for i in range(n):
            xi, yi = p[i]; xj, yj = p[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi: c = not c
            j = i
        if c or e <= 0: return c
        j = n - 1
        for i in range(n):   # within e of an edge
            ax, ay = p[j]; bx, by = p[i]; j = i
            dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy or 1e-12
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L))
            if (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= e * e: return True
        return False


class Stroke:   # thick polyline
    def __init__(s, pts, w):
        s.p, s.w = pts, w
    def bbox(s, e):
        xs = [p[0] for p in s.p]; ys = [p[1] for p in s.p]; r = s.w + e
        return min(xs) - r, min(ys) - r, max(xs) + r, max(ys) + r
    def inside(s, x, y, e):
        r2 = (s.w + e) ** 2
        for (ax, ay), (bx, by) in zip(s.p, s.p[1:]):
            dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy or 1e-12
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L))
            if (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r2: return True
        return False


def rrect(x0, y0, x1, y1, r, n=6):
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return Poly(pts)


def bolt(x, y, w, h, flip=False):
    s = -1 if flip else 1
    pts = [(0.15, 0.0), (0.75, 0.0), (0.5, 0.38), (0.85, 0.38), (0.2, 1.0), (0.38, 0.52), (0.05, 0.52)]
    return Poly([(x + (px - 0.5) * w * s, y + py * h) for px, py in pts])


# ---------------------------------------------------------------- renderer
def render(w, h, layers, outline_px, line=(40, 32, 30, 255)):
    """layers: list of (shapes, color, outline) drawn in order; outline True draws a dark ring of outline_px first."""
    acc = [0.0] * (w * h * 4)
    ox, oy = 1.0 / w, 1.0 / h
    e_out = outline_px / max(w, h)
    ops = []
    for shapes, color, outline in layers:
        if outline:
            ops.append((shapes, line, e_out))
        ops.append((shapes, color, 0.0))
    for shapes, color, e in ops:
        r, g, b, a = color
        a /= 255.0
        for sh in shapes:
            x0, y0, x1, y1 = sh.bbox(e)
            px0, py0 = max(0, int(x0 * w) - 1), max(0, int(y0 * h) - 1)
            px1, py1 = min(w, int(x1 * w) + 2), min(h, int(y1 * h) + 2)
            for py in range(py0, py1):
                for px in range(px0, px1):
                    cov = 0
                    for sy in range(SS):
                        yy = (py + (sy + 0.5) / SS) * oy
                        for sx in range(SS):
                            if sh.inside((px + (sx + 0.5) / SS) * ox, yy, e): cov += 1
                    if not cov: continue
                    al = a * cov / (SS * SS)
                    i = (py * w + px) * 4
                    da = acc[i + 3]
                    na = al + da * (1 - al)
                    if na <= 0: continue
                    for k, cval in enumerate((r, g, b)):
                        acc[i + k] = (cval * al + acc[i + k] * da * (1 - al)) / na
                    acc[i + 3] = na
    out = bytearray(w * h * 4)
    for i in range(0, w * h * 4, 4):
        out[i] = int(acc[i]); out[i + 1] = int(acc[i + 1]); out[i + 2] = int(acc[i + 2]); out[i + 3] = int(acc[i + 3] * 255 + 0.5)
    return out


# ---------------------------------------------------------------- designs
PETS = {
    "stormhorn": {
        "fur": "#79b4e6", "shade": "#4f86c4", "belly": "#d6ecff", "accent": "#ffd84a", "accent2": "#e3a514", "line": "#2a2a3d",
        "eye": "#2a2a3d", "card_top": "#3b4f8f", "card_bot": "#7aa7e8", "symbol": "bolt",
    },
    "grove": {   # invented forest world boss (Grove Colossus, mammoth slot 41)
        "fur": "#6b8f3a", "shade": "#4a6a28", "belly": "#a9c86a", "accent": "#8a5a2b", "accent2": "#c8e070", "line": "#26301a",
        "eye": "#1d2410", "card_top": "#2f4a1a", "card_bot": "#7fae45", "symbol": "leaf",
    },
    "cinder": {
        "fur": "#ec7a3c", "shade": "#c4512a", "belly": "#ffd6ab", "accent": "#ffd84a", "accent2": "#e5402a", "line": "#3a2420",
        "eye": "#3a2420", "card_top": "#7a2418", "card_bot": "#f08a3a", "symbol": "flame",
    },
}


def head_layers(pal, kind, attack=False, closed=False):
    C = lambda k, a=255: hexc(pal[k], a)
    L = []
    if kind == "stormhorn":
        L.append(([bolt(0.31, 0.06, 0.20, 0.36, flip=True), bolt(0.69, 0.06, 0.20, 0.36)], C("accent"), True))
        L.append(([Ellipse(0.17, 0.42, 0.13, 0.08, -0.6), Ellipse(0.83, 0.42, 0.13, 0.08, 0.6)], C("fur"), True))
        L.append(([Ellipse(0.5, 0.60, 0.38, 0.33)], C("fur"), True))
        L.append(([Ellipse(0.5, 0.50, 0.24, 0.12)], C("shade"), False))
        L.append(([Ellipse(0.5, 0.78, 0.18, 0.12)], C("belly"), False))
    else:
        L.append(([Poly([(0.10, 0.10), (0.36, 0.30), (0.16, 0.50)]), Poly([(0.90, 0.10), (0.64, 0.30), (0.84, 0.50)])], C("fur"), True))
        L.append(([Poly([(0.10, 0.10), (0.20, 0.19), (0.13, 0.25)]), Poly([(0.90, 0.10), (0.80, 0.19), (0.87, 0.25)])], C("line"), False))
        L.append(([Ellipse(0.5, 0.60, 0.38, 0.33)], C("fur"), True))
        L.append(([Poly([(0.14, 0.66), (0.04, 0.80), (0.24, 0.78)]), Poly([(0.86, 0.66), (0.96, 0.80), (0.76, 0.78)])], C("fur"), True))
        L.append(([Stroke([(0.44, 0.30), (0.48, 0.40), (0.44, 0.48)], 0.012), Stroke([(0.56, 0.30), (0.52, 0.40), (0.56, 0.48)], 0.012)], C("accent"), False))
        L.append(([Ellipse(0.5, 0.79, 0.18, 0.12)], C("belly"), False))
    if closed:
        L.append(([Stroke([(0.29, 0.62), (0.36, 0.65), (0.43, 0.62)], 0.018), Stroke([(0.57, 0.62), (0.64, 0.65), (0.71, 0.62)], 0.018)], C("eye"), False))
    else:
        L.append(([Ellipse(0.36, 0.62, 0.075, 0.085), Ellipse(0.64, 0.62, 0.075, 0.085)], C("eye"), False))
        if kind == "cinder":
            L.append(([Ellipse(0.36, 0.63, 0.04, 0.05), Ellipse(0.64, 0.63, 0.04, 0.05)], C("accent"), False))
        L.append(([Ellipse(0.38, 0.59, 0.028, 0.028), Ellipse(0.66, 0.59, 0.028, 0.028)], (255, 255, 255, 255), False))
    L.append(([Ellipse(0.5, 0.74, 0.055, 0.04)], C("eye"), False))
    if attack:
        L.append(([Ellipse(0.5, 0.84, 0.08, 0.05)], (150, 30, 40, 255), True))
    return L


def body_layers(pal, kind):
    C = lambda k, a=255: hexc(pal[k], a)
    L = [([Ellipse(0.5, 0.5, 0.42, 0.45)], C("fur"), True), ([Ellipse(0.5, 0.42, 0.27, 0.30)], C("shade"), False)]
    if kind == "stormhorn":
        L.append(([Stroke([(0.5, 0.12), (0.42, 0.30), (0.58, 0.45), (0.42, 0.62), (0.56, 0.82)], 0.035)], C("accent"), False))
    else:
        L.append(([Ellipse(0.32, 0.36, 0.05, 0.04), Ellipse(0.66, 0.30, 0.05, 0.04), Ellipse(0.62, 0.62, 0.06, 0.045),
                   Ellipse(0.36, 0.68, 0.05, 0.04), Ellipse(0.50, 0.50, 0.04, 0.035)], C("line"), False))
        L.append(([Stroke([(0.30, 0.50), (0.38, 0.56), (0.34, 0.62)], 0.012), Stroke([(0.70, 0.44), (0.62, 0.50), (0.68, 0.56)], 0.012)], C("accent"), False))
    return L


def tail_layers(pal, kind):
    C = lambda k, a=255: hexc(pal[k], a)
    if kind == "stormhorn":
        return [([bolt(0.5, 0.06, 0.62, 0.80)], C("accent"), True), ([Ellipse(0.5, 0.86, 0.22, 0.12)], C("fur"), True)]
    return [([Stroke([(0.5, 0.92), (0.46, 0.65), (0.54, 0.42), (0.5, 0.30)], 0.11)], C("fur"), True),
            ([Poly([(0.5, 0.02), (0.72, 0.30), (0.62, 0.40), (0.5, 0.33), (0.38, 0.40), (0.28, 0.30)])], C("accent2"), True),
            ([Poly([(0.5, 0.12), (0.62, 0.30), (0.5, 0.27), (0.38, 0.30)])], C("accent"), False)]


def attack_layers(pal, kind):
    col = hexc(pal["accent"]) if kind == "stormhorn" else hexc(pal["accent2"])
    return [([Stroke([(0.04, 0.20), (0.20, 0.60), (0.36, 0.80)], 0.035), Stroke([(0.96, 0.20), (0.80, 0.60), (0.64, 0.80)], 0.035)], col, True)]


def sleep_layers(pal, kind):
    C = lambda k, a=255: hexc(pal[k], a)
    L = [([Ellipse(0.58, 0.55, 0.38, 0.32)], C("fur"), True), ([Ellipse(0.62, 0.52, 0.22, 0.18)], C("shade"), False)]
    L += [([Ellipse(0.30, 0.52, 0.24, 0.22)], C("fur"), True)]
    L += [([Stroke([(0.20, 0.52), (0.25, 0.55), (0.30, 0.52)], 0.015), Stroke([(0.33, 0.52), (0.38, 0.55), (0.43, 0.52)], 0.015)], C("eye"), False)]
    return L


def card_layers(pal, kind, stage, variant):
    C = lambda k, a=255: hexc(pal[k], a)
    dy = 0.02 if variant == "click" else 0.0
    shade = {"out": 0, "in": 25, "click": -20}[variant]
    tint = lambda c: tuple(max(0, min(255, v + shade)) if i < 3 else v for i, v in enumerate(c))
    L = [([rrect(0.05, 0.03 + dy, 0.95, 0.97, 0.12)], tint(C("card_bot")), True),
         ([rrect(0.12, 0.06 + dy, 0.88, 0.40 + dy, 0.08)], tint(C("card_top")), False),
         ([Ellipse(0.5, 0.20 + dy, 0.24, 0.14)], C("line"), False),
         ([Ellipse(0.5, 0.20 + dy, 0.20, 0.115)], tint(C("belly")), False)]
    if pal["symbol"] == "bolt":
        L.append(([bolt(0.5, 0.11 + dy, 0.20, 0.18)], C("accent"), True))
    else:
        L.append(([Poly([(0.5, 0.09 + dy), (0.60, 0.20 + dy), (0.56, 0.28 + dy), (0.44, 0.28 + dy), (0.40, 0.20 + dy)])], C("accent2"), True))
        L.append(([Poly([(0.5, 0.15 + dy), (0.55, 0.22 + dy), (0.5, 0.26 + dy), (0.45, 0.22 + dy)])], C("accent"), False))
    # portrait: the head layers scaled into the lower card area
    for shapes, col, ol in head_layers(pal, kind):
        L.append(([_scaled(sh, 0.5, 0.66 + dy, 0.72, 0.42) for sh in shapes], col, ol))
    for k in range(stage + 1):
        x = 0.5 + (k - stage / 2) * 0.16
        L.append(([Poly([(x + 0.06 * math.cos(a), 0.92 + dy + 0.035 * math.sin(a)) for a in [math.radians(-90 + 72 * i) for i in (0, 2, 4, 1, 3)]])], C("accent"), True))
    return L


class _Scaled:
    def __init__(s, sh, cx, cy, sx, sy):
        s.sh, s.cx, s.cy, s.sx, s.sy = sh, cx, cy, sx, sy
    def _m(s, x, y):
        return (x - s.cx) / s.sx + 0.5, (y - s.cy) / s.sy + 0.5
    def bbox(s, e):
        x0, y0, x1, y1 = s.sh.bbox(e / min(s.sx, s.sy))
        return s.cx + (x0 - 0.5) * s.sx, s.cy + (y0 - 0.5) * s.sy, s.cx + (x1 - 0.5) * s.sx, s.cy + (y1 - 0.5) * s.sy
    def inside(s, x, y, e):
        u, v = s._m(x, y)
        return s.sh.inside(u, v, e / min(s.sx, s.sy))


def _scaled(sh, cx, cy, sx, sy):
    return _Scaled(sh, cx, cy, sx, sy)


# ---------------------------------------------------------------- skill icons (200x200, served as ./img/interface/skill-<id>.png)
def _ring(bg, rim):
    return [([Ellipse(0.5, 0.5, 0.44, 0.44)], hexc(rim), True), ([Ellipse(0.5, 0.5, 0.38, 0.38)], hexc(bg), False)]



def icon_layers(sid):
    Y, Y2, B, B2, R, R2, G, K = "#ffd84a", "#e3a514", "#79b4e6", "#3b4f8f", "#ec7a3c", "#7a2418", "#9aa0a8", "#2a2a3d"
    if sid == "tempest-crown":
        return _ring(B2, B) + [([Poly([(0.24, 0.66), (0.24, 0.36), (0.36, 0.50), (0.50, 0.28), (0.64, 0.50), (0.76, 0.36), (0.76, 0.66)])], hexc(Y), True),
                               ([bolt(0.5, 0.56, 0.16, 0.30)], hexc(B), True)]
    if sid == "static-shell":
        return _ring(B2, B) + [([Poly([(0.5, 0.20), (0.76, 0.30), (0.72, 0.58), (0.5, 0.80), (0.28, 0.58), (0.24, 0.30)])], hexc(B), True), ([bolt(0.5, 0.30, 0.20, 0.40)], hexc(Y), True)]
    if sid == "overcharge":
        return _ring(B2, B) + [([bolt(0.38, 0.22, 0.20, 0.52), bolt(0.62, 0.26, 0.20, 0.52)], hexc(Y), True)]
    if sid == "magnet-pull":
        return _ring(B2, B) + [([Stroke([(0.32, 0.30), (0.32, 0.56), (0.42, 0.70), (0.58, 0.70), (0.68, 0.56), (0.68, 0.30)], 0.07)], hexc("#e5402a"), True),
                               ([Ellipse(0.32, 0.27, 0.07, 0.04), Ellipse(0.68, 0.27, 0.07, 0.04)], hexc(G), True)]
    if sid == "thunder-step":
        return _ring(B2, B) + [([Ellipse(0.40, 0.62, 0.10, 0.13), Ellipse(0.60, 0.42, 0.10, 0.13)], hexc(B), True), ([bolt(0.5, 0.20, 0.14, 0.28)], hexc(Y), True)]
    if sid == "chain-zap":
        return _ring(B2, B) + [([Stroke([(0.24, 0.62), (0.40, 0.40), (0.52, 0.58), (0.70, 0.34)], 0.025)], hexc(Y), True),
                               ([Ellipse(0.24, 0.62, 0.06, 0.06), Ellipse(0.52, 0.58, 0.06, 0.06), Ellipse(0.70, 0.34, 0.06, 0.06)], hexc(B), True)]
    if sid == "ashen-snare":
        return _ring(R2, R) + [([Ellipse(0.5, 0.56, 0.28, 0.16)], hexc(G), True), ([Ellipse(0.5, 0.56, 0.18, 0.09)], hexc("#5b5f66"), False),
                               ([Ellipse(0.36, 0.40, 0.04, 0.04), Ellipse(0.60, 0.34, 0.04, 0.04), Ellipse(0.66, 0.46, 0.03, 0.03)], hexc(Y), True)]
    if sid == "ember-trail":
        return _ring(R2, R) + [([Ellipse(0.34, 0.66, 0.07, 0.06), Ellipse(0.50, 0.52, 0.07, 0.06), Ellipse(0.66, 0.38, 0.07, 0.06)], hexc(R), True),
                               ([Poly([(0.66, 0.18), (0.74, 0.32), (0.66, 0.30), (0.58, 0.32)])], hexc(Y), True)]
    if sid == "molten-hide":
        return _ring(R2, R) + [([Poly([(0.5, 0.20), (0.76, 0.30), (0.72, 0.58), (0.5, 0.80), (0.28, 0.58), (0.24, 0.30)])], hexc(R), True),
                               ([Stroke([(0.42, 0.32), (0.50, 0.46), (0.44, 0.60)], 0.02), Stroke([(0.60, 0.36), (0.54, 0.50)], 0.02)], hexc(Y), False)]
    if sid == "pounce-chain":
        return _ring(R2, R) + [([Stroke([(0.30, 0.30), (0.44, 0.70)], 0.035), Stroke([(0.46, 0.26), (0.58, 0.70)], 0.035), Stroke([(0.62, 0.30), (0.72, 0.66)], 0.035)], hexc("#e5402a"), True)]
    if sid == "smoke-veil":
        return _ring(R2, R) + [([Ellipse(0.38, 0.56, 0.16, 0.12), Ellipse(0.56, 0.48, 0.18, 0.14), Ellipse(0.66, 0.60, 0.14, 0.10)], hexc(G), True),
                               ([Ellipse(0.50, 0.50, 0.03, 0.04), Ellipse(0.60, 0.50, 0.03, 0.04)], hexc(Y), False)]
    if sid == "dash-bite":
        return _ring(R2, R) + [([Poly([(0.26, 0.36), (0.74, 0.36), (0.66, 0.64), (0.34, 0.64)])], hexc("#7a1f20"), True),
                               ([Poly([(0.34, 0.36), (0.40, 0.50), (0.46, 0.36)]), Poly([(0.54, 0.36), (0.60, 0.50), (0.66, 0.36)])], (255, 255, 255, 255), False)]
    raise KeyError(sid)


ICONS = ["tempest-crown", "static-shell", "overcharge", "magnet-pull", "thunder-step", "chain-zap",
         "ashen-snare", "ember-trail", "molten-hide", "pounce-chain", "smoke-veil", "dash-bite"]

# ---------------------------------------------------------------- ultimate ground fields
# The client draws a category-4 entity from its kind (field 7 = client skill id). These kinds are client skills nothing in
# the clone casts, each drawn as two static single-layer anims centered on the entity (base = _12550 underneath, top =
# _12548), never mirrored (the server answers a blank pixel), so their frames carry the art. Hashes from work/fx/kinds.js
# (vm harness); the kind audit is work/effect_ids.md. The client draws these frames at a third of their pixel size in
# world units, so size * 0.47 / 3 is the field radius (Ashen Snare 300, Tempest Crown 380).
FX = {
    "ashen-snare": {"kind": 86, "size": 1920, "base": "4e050418599e347208619bcc", "top": "67e701d0e7587bae1639699c"},
    "tempest-crown": {"kind": 545, "size": 2400, "base": "1eb2c2f1858819dfefe1a6a5", "top": "656acdc3e20946612c61a06f"},
}


def _vnoise(seed, g=64):
    rnd = random.Random(seed)
    tab = [rnd.random() for _ in range(g * g)]
    def f(x, y):
        xi, yi = int(math.floor(x)), int(math.floor(y)); fx, fy = x - xi, y - yi
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        r0, r1 = (yi % g) * g, ((yi + 1) % g) * g
        a, b, c, d = tab[r0 + xi % g], tab[r0 + (xi + 1) % g], tab[r1 + xi % g], tab[r1 + (xi + 1) % g]
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
    return f


def _fbm(f, x, y, n=3):
    s, a, t = 0.0, 0.5, 0.0
    for _ in range(n):
        s += a * f(x, y); t += a; x *= 2.03; y *= 2.03; a *= 0.5
    return s / t


def _mix(c0, c1, t):
    t = max(0.0, min(1.0, t))
    return tuple(c0[i] + (c1[i] - c0[i]) * t for i in range(3))


def _pixels(S, fn):
    out = bytearray(S * S * 4)
    for y in range(S):
        for x in range(S):
            p = fn(x + 0.5, y + 0.5)
            if p:
                i = (y * S + x) * 4
                out[i:i + 4] = bytes((int(p[0]), int(p[1]), int(p[2]), int(max(0.0, min(1.0, p[3])) * 255 + 0.5)))
    return out


def ash_base(S, seed=7):
    """smouldering ash field: wobbly charcoal rim with a dark outline, mottled grey ash spiralling inward, glowing cracks"""
    N1, N2, N3 = _vnoise(seed), _vnoise(seed + 1), _vnoise(seed + 2)
    c, R = S / 2, S * 0.47
    def px(x, y):
        dx, dy = x - c, y - c
        d = math.hypot(dx, dy) / R
        if d > 1.1: return None
        u, v = x / S * 6, y / S * 6
        edge = 1.0 + 0.09 * (_fbm(N1, u, v) - 0.5) * 2
        if d > edge + 0.01: return None
        ang = math.atan2(dy, dx)
        k = round(_fbm(N2, u * 1.6, v * 1.6) * 6) / 6.0   # flat cartoon tones (and a smaller PNG)
        if d > edge - 0.03:
            col, a = (34, 26, 24), 0.96
        elif d > edge - 0.2:
            col, a = _mix((50, 44, 42), (84, 76, 72), k * 1.4 - 0.2), 0.92
            col = _mix(col, (34, 26, 24), (d - (edge - 0.2)) / 0.17 * 0.35)
        else:
            swirl = round(1.5 + 1.5 * math.sin(d * 24 - ang * 3 + k * 5)) / 3.0
            col = _mix(_mix((92, 88, 86), (146, 140, 134), k * 1.5 - 0.25), (60, 56, 54), 0.22 * swirl)
            a = 0.66 + 0.22 * d
        cr = abs(_fbm(N3, u * 1.3 + 9, v * 1.3 + 3) - 0.5)
        if d < edge - 0.05 and cr < 0.009:
            heat = 1 - cr / 0.009
            col = _mix(col, (236, 112, 40) if heat < 0.6 else (255, 190, 70), heat * 1.3); a = max(a, 0.97)
        a *= max(0.0, min(1.0, (edge + 0.01 - d) * R + 0.5))
        return col + (a,)
    return _pixels(S, px)


def ash_top(seed=11):
    """embers glowing on the ash: orange halo, outlined ember, hot core; a few pale ash flecks"""
    rnd = random.Random(seed)
    halo, emb, core, fleck = [], [], [], []
    for _ in range(46):
        r, a = 0.43 * math.sqrt(rnd.uniform(0.02, 0.92)), rnd.uniform(0, 2 * math.pi)
        x, y, s = 0.5 + r * math.cos(a), 0.5 + r * math.sin(a), rnd.uniform(0.011, 0.022)
        halo.append(Ellipse(x, y, s * 2.4, s * 2.4)); emb.append(Ellipse(x, y, s, s * 0.85, rnd.uniform(0, 3)))
        core.append(Ellipse(x - s * 0.2, y - s * 0.2, s * 0.45, s * 0.4))
    for _ in range(30):
        r, a = 0.44 * math.sqrt(rnd.uniform(0, 1)), rnd.uniform(0, 2 * math.pi)
        fleck.append(Ellipse(0.5 + r * math.cos(a), 0.5 + r * math.sin(a), 0.006, 0.0045, rnd.uniform(0, 3)))
    return [(halo, (240, 110, 40, 105), False), (fleck, (200, 194, 186, 200), False), (emb, hexc("#ec7a3c"), True),
            (core, hexc("#ffd84a"), False)]


def crown_base(S):
    """lightning crown on the ground: a 12-point blue crown rim with dark outlines around a faint electric aura"""
    c, R = S / 2, S * 0.475
    def one(x, y):
        dx, dy = x - c, y - c
        d = math.hypot(dx, dy) / R
        if d > 1.0: return None
        ang = math.atan2(dy, dx)
        tri = abs(((ang / (2 * math.pi)) * 12 + 0.25) % 1.0 - 0.5) * 2
        edge = 0.84 + 0.14 * (1 - tri)
        band = 0.80
        if d > edge: return None
        if d > edge - 0.022 or band - 0.02 < d <= band: return (42, 42, 61, 0.95)
        if d > band:
            hi = (d - band) / max(0.01, edge - 0.022 - band)
            return _mix((214, 236, 255), (121, 180, 230), hi * 1.6) + (0.92,)
        a = 0.08 + round(0.22 * (d / band) ** 4 * 8) / 8.0
        if abs(d - 0.52) < 0.009 and math.sin(ang * 30) > -0.2: return (214, 236, 255, 0.55)
        return (121, 180, 230, a)
    def px(x, y):   # 2x2 supersampling
        acc, n = [0.0, 0.0, 0.0, 0.0], 0
        for sy in (-0.25, 0.25):
            for sx in (-0.25, 0.25):
                p = one(x + sx, y + sy)
                if p:
                    for i in range(3): acc[i] += p[i] * p[3]
                    acc[3] += p[3]
        if acc[3] <= 0: return None
        return (acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], acc[3] / 4)
    return _pixels(S, px)


def crown_top(seed=5):
    """yellow bolts standing on the 12 crown points, short blue arcs crackling between them"""
    rnd = random.Random(seed)
    R, bolts, arcs, sparks = 0.475, [], [], []
    pat = [(0.15, 0.0), (0.75, 0.0), (0.5, 0.38), (0.85, 0.38), (0.2, 1.0), (0.38, 0.52), (0.05, 0.52)]
    for i in range(12):
        a = 2 * math.pi * (i + 0.25) / 12.0   # crown_base peak angles
        ux, uy = math.cos(a), math.sin(a)
        bx, by = 0.5 + ux * R * 0.90, 0.5 + uy * R * 0.90
        w, h = 0.045, 0.085
        pts = []
        for px_, py_ in pat:   # bolt drawn outward from the crown point
            lx, ly = (px_ - 0.5) * w, py_ * h
            pts.append((bx + ux * ly - uy * lx, by + uy * ly + ux * lx))
        bolts.append(Poly(pts))
        zz = []
        for k in range(7):   # zigzag arc from this point toward the next one, inside the rim
            t = a + 0.1 + (2 * math.pi / 12 - 0.2) * k / 6.0
            rr = R * (0.68 + (0.03 if k % 2 else -0.03))
            zz.append((0.5 + math.cos(t) * rr, 0.5 + math.sin(t) * rr))
        if i % 2 == 0: arcs.append(Stroke(zz, 0.004))
        for _ in range(2):
            t, rr = rnd.uniform(0, 2 * math.pi), R * rnd.uniform(0.2, 0.7)
            sparks.append(Ellipse(0.5 + math.cos(t) * rr, 0.5 + math.sin(t) * rr, 0.005, 0.005))
    return [(arcs, hexc("#d6ecff"), True), (sparks, hexc("#ffd84a"), True), (bolts, hexc("#ffd84a"), True)]


def make_fx(override):
    for name, F in FX.items():
        S = F["size"]
        if name == "ashen-snare":
            base, top = ash_base(S), render(S, S, ash_top(), max(3, S // 200), hexc("#3a2420"))
        else:
            base, top = crown_base(S), render(S, S, crown_top(), max(3, S // 200), hexc("#2a2a3d"))
        for part, px in (("base", base), ("top", top)):
            png = "fx-%s-%s.png" % (name, part)
            write_png(os.path.join(OUT, "png", png), S, S, px)
            override["/img/h/%s.png" % F[part]] = "invented/png/" + png
            print("wrote", png, S, S, "for kind", F["kind"], flush=True)


# ---------------------------------------------------------------- jobs
SIZES = {   # wolf part sizes per stage (the replaced species' own files are not mirrored, so they are unknown)
    ("head", 0): (228, 214), ("body", 0): (183, 216), ("tail", 0): (100, 135), ("sleep", 0): (260, 220),
    ("head", 1): (317, 296), ("body", 1): (229, 271), ("tail", 1): (185, 193), ("attack", 1): (143, 49),
    ("head", 2): (357, 348), ("body", 2): (264, 335), ("tail", 2): (186, 275), ("attack", 2): (143, 49),
}
SLOTS = {"stormhorn": 13, "cinder": 39, "grove": 20}   # grove: the dragon's world-boss stage art only (st 2 = boss / giant)


def slot_url(name, base_name, path, url):
    # stormhorn / cinder are their own client species (156 / 157, tools/invented/client_patch.js) drawn on the reindeer /
    # rat shapes: their art goes under the new species' image names (new_slots.py), the real species keep their own
    if name not in new_slots.NEW: return url
    return new_slots.hashed(new_slots.new_path(name, base_name, path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", default=os.path.join(REPO, "work", "creature_images_pinned.json"))
    ap.add_argument("--only")
    A = ap.parse_args()
    tab = json.load(open(A.table))
    cards = {}
    for line in open(os.path.join(REPO, "mirror", "index.jsonl")):
        r = json.loads(line)
        cards[r["url"].split("?")[0].split("img/h/")[-1]] = r["file"]
    os.makedirs(os.path.join(OUT, "png"), exist_ok=True)
    ovr_path = os.path.join(OUT, "override.json")
    override = json.load(open(ovr_path)) if os.path.exists(ovr_path) and A.only else {}
    for name, sp in SLOTS.items():
        if A.only and A.only != name: continue
        pal = PETS[name]; v = tab[str(sp)]; done = set()
        for st, part, fname, url in v["parts"]:
            if not url or url in done: continue
            if name == "grove" and st != 2: continue
            done.add(url)
            size = SIZES.get((part, st)) or SIZES.get((part, 2 if name == "grove" else 1)) or (240, 240)
            if name == "grove": size = (round(size[0] * 1.6), round(size[1] * 1.6))   # a world boss: big
            lay = {"head": head_layers(pal, name), "body": body_layers(pal, name), "tail": tail_layers(pal, name),
                   "attack": attack_layers(pal, name), "sleep": sleep_layers(pal, name),
                   "wing-left": tail_layers(pal, name), "wing-right": tail_layers(pal, name)}.get(part)
            if lay is None: continue
            w, h = size
            png = "%s-st%d-%s.png" % (name, st, part)
            write_png(os.path.join(OUT, "png", png), w, h, render(w, h, lay, max(6, round(min(w, h) * 0.045)), hexc(pal["line"])))
            override["/" + slot_url(name, v["name"], fname, url)] = "invented/png/" + png
            print("wrote", png, w, h, "for", fname, flush=True)
        for key, url in ([] if name == "grove" else v["cards"]):
            base, variant = key.rsplit("-", 1)
            stage = int(base[-1])
            f = cards.get(url.split("img/h/")[-1])
            w, h = struct.unpack(">II", open(os.path.join(REPO, "mirror", "files", f), "rb").read(24)[16:24]) if f else (130, 219)
            png = "%s-%s.png" % (name, key.replace("card-" + v["name"], "card"))
            write_png(os.path.join(OUT, "png", png), w, h, render(w, h, card_layers(pal, name, stage, variant), 6, hexc(pal["line"])))
            override["/" + slot_url(name, v["name"], "img/interface/%s.png" % key, url)] = "invented/png/" + png
            print("wrote", png, w, h, "for", key, flush=True)
    if not A.only or A.only == "icons":
        for sid in ICONS:
            png = "icon-%s.png" % sid
            write_png(os.path.join(OUT, "png", png), 200, 200, render(200, 200, icon_layers(sid), 9, hexc("#2a2420")))
            override["/img/interface/skill-%s.png" % sid] = "invented/png/" + png
            print("wrote", png, flush=True)
    if not A.only or A.only == "fx":
        make_fx(override)
    for lv in range(61, 68):   # invented pet levels 61..67: badges from tools/invented/make_level_badges.py
        png = "hero-level%d.png" % lv
        if os.path.exists(os.path.join(OUT, "png", png)): override["/" + new_slots.hashed("img/interface/" + png)] = "invented/png/" + png
    json.dump(override, open(ovr_path, "w"), indent=1, sort_keys=True)
    print("override entries", len(override))


if __name__ == "__main__":
    main()
