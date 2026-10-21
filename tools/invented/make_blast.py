#!/usr/bin/env python3
# Air Blast Gun (invented weapon): original purple art for client item slot 17 (Enchanted Spear Level 1, never given in this
# clone) and the air wave. Drawn with the pure-Python rasterizer of make_art.py (no PIL):
#   held sprite      img/item/enchanted-spear0.png (495 x 101, the slot's own size; the client draws it 220 x 40 like a spear)
#   hotbar / picker  img/interface/[colored/]inv-enchanted-spear0-{out,hover,active}.png (160 x 180, the inventory card size)
#   air wave         img/creature/spell-water-dash-slash5.png, the only frame of effect 434 (no creature or boss in the clone
#                    casts 434)
# The client loads every image through its path hash (img/h/<hash>.png); the hashes below come from the client's own image
# loader run in the inert vm harness (direct_scan/node/harness.js, the way work/spell_hashes.txt was made).
# Writes mimic/invented/png/blast-*.png and adds them to mimic/invented/override.json. Usage: make_blast.py
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from make_art import Ellipse, Poly, Stroke, render, write_png, hexc

REPO = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(REPO, "mimic", "invented")
HASH = {
    "img/item/enchanted-spear0.png": "ced4b616280dcc50f1082f2a",
    "img/interface/inv-enchanted-spear0-out.png": "1e447caf2577ba913d51b653",
    "img/interface/inv-enchanted-spear0-hover.png": "7ade2551a99bbc534e52de65",
    "img/interface/inv-enchanted-spear0-active.png": "307934b151e36a6b975746cd",
    "img/interface/colored/inv-enchanted-spear0-out.png": "6c55d6e4dc8d6ac2b03688e8",
    "img/interface/colored/inv-enchanted-spear0-hover.png": "0f14b046a5a7188436897e1a",
    "img/interface/colored/inv-enchanted-spear0-active.png": "2cf61cd4e10555aac64e6190",
    "img/creature/spell-water-dash-slash5.png": "5e2c980050e19a3eb41321a4",
}
LINE = "#2a1838"
DARK, MID, LIGHT, GLOW, PALE = "#4a1f6e", "#8a3fc4", "#c08ae8", "#e2b8ff", "#f4e4ff"


# ---------------------------------------------------------------- the gun in its own pixel frame (495 x 101, muzzle right)
def rr(x0, y0, x1, y1, r, n=5):
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return ("poly", pts)


def gun_parts():
    """(shape, color, outline) in gun pixels; shape = ("poly", pts) | ("ell", cx, cy, rx, ry)"""
    return [
        (rr(10, 33, 152, 69, 14), DARK, True),                                        # stock
        (rr(22, 40, 70, 62, 8), MID, False),                                          # grip wrap
        (("poly", [(368, 36), (368, 66), (482, 94), (482, 8)]), MID, True),           # flared muzzle bell
        (("poly", [(372, 40), (372, 46), (476, 22), (476, 14)]), LIGHT, False),       # bell shine
        (rr(120, 30, 384, 72, 12), MID, True),                                        # barrel
        (rr(132, 36, 372, 45, 4), LIGHT, False),                                      # barrel shine
        (rr(282, 26, 296, 76, 4), DARK, True), (rr(322, 26, 336, 76, 4), DARK, True),  # barrel rings
        (("ell", 210, 51, 33, 33), "#6c2fa3", True),                                  # air chamber
        (("ell", 210, 51, 20, 20), GLOW, False),
        (("ell", 203, 44, 7, 7), PALE, False),
        (("ell", 479, 51, 9, 39), LINE, False),                                       # muzzle mouth
        (("ell", 481, 51, 4, 30), "#7a3cb4", False),
    ]


def place_gun(S, ox, oy, sc, rot):
    """gun pixels -> canvas normalized (square canvas side S): scale sc, rotate rot around the gun center, center at (ox, oy)"""
    c, s = math.cos(rot), math.sin(rot)
    def P(x, y):
        x, y = (x - 247.5) * sc, (y - 50.5) * sc
        return ((ox + x * c - y * s) / S, (oy + x * s + y * c) / S)
    layers = []
    for sh, col, ol in gun_parts():
        if sh[0] == "poly": shape = Poly([P(x, y) for x, y in sh[1]])
        else:
            cx, cy = P(sh[1], sh[2])
            shape = Ellipse(cx, cy, sh[3] * sc / S, sh[4] * sc / S, rot)
        layers.append(([shape], hexc(col), ol))
    return layers


def crop(px, S, x0, y0, w, h):
    out = bytearray(w * h * 4)
    for y in range(h):
        out[y * w * 4:(y + 1) * w * 4] = px[((y0 + y) * S + x0) * 4:((y0 + y) * S + x0 + w) * 4]
    return bytes(out)


def held():   # square canvas so the outline is even, then the 101 rows around the gun
    S = 495
    px = render(S, S, place_gun(S, 247.5, 247.5, 1.0, 0.0), 5, hexc(LINE))
    return crop(px, S, 0, 197, 495, 101)


CARD = {   # inventory card: [body, bottom edge]; colored = the client's colored-icons option
    "out": ("#3d3532", "#2b2523"), "hover": ("#4b423e", "#332c29"), "active": ("#5a4a63", "#3a2f40"),
    "colored-out": ("#43305a", "#2e2140"), "colored-hover": ("#523a6d", "#37284a"), "colored-active": ("#67468a", "#45305c"),
}


def icon(variant):
    S = 180; body, edge = CARD[variant]
    N = lambda pts: [(x / S, y / S) for x, y in pts]
    L = [([Poly(N(rr(10, 0, 170, 180, 22)[1]))], hexc(edge), False), ([Poly(N(rr(10, 0, 170, 166, 22)[1]))], hexc(body), False)]
    if variant.endswith("active"):
        ring = N(rr(14, 4, 166, 162, 19)[1])
        L.append(([Stroke(ring + ring[:1], 3.5 / S)], hexc(GLOW), False))
    L += place_gun(S, 90, 84, 0.33, -math.radians(42))
    px = render(S, S, L, 3, hexc(LINE))
    return crop(px, S, 10, 0, 160, 180)


# ---------------------------------------------------------------- air wave: crescents bulging toward +x (the travel direction)
def crescent(x0, out_r, in_r, half, cy, W, H):
    n = 28; pts = []
    for k in range(n + 1):
        t = -1 + 2 * k / n; pts.append(((x0 + out_r * math.sqrt(1 - t * t)) / W, (cy + half * t) / H))
    for k in range(n, -1, -1):
        t = -1 + 2 * k / n; pts.append(((x0 + in_r * math.sqrt(1 - t * t)) / W, (cy + half * t) / H))
    return Poly(pts)


def wave():
    W, H = 380, 380   # square: rx / ry and the outline stay even
    cy = H / 2
    L = [([crescent(10, 95, 80, 95, cy, W, H)], hexc("#a35ee0", 90), False),
         ([crescent(55, 140, 116, 135, cy, W, H)], hexc("#a35ee0", 150), False),
         ([crescent(110, 190, 140, 175, cy, W, H)], hexc("#9b4fdc", 225), True),
         ([crescent(110, 178, 150, 160, cy, W, H)], hexc("#d7a8ff", 235), False),
         ([crescent(110, 168, 156, 140, cy, W, H)], hexc(PALE, 240), False)]
    for (x, y, r, a) in ((262, 120, 7, 200), (276, 250, 6, 190), (205, 80, 5, 150), (210, 300, 5, 150), (150, 150, 4, 110)):
        L.append(([Ellipse(x / W, y / H, r / W, r / H)], hexc(GLOW, a), False))
    return render(W, H, L, 5, hexc("#3c1a5e", 230)), W, H


def main():
    ovr_path = os.path.join(OUT, "override.json"); ovr = json.load(open(ovr_path))
    os.makedirs(os.path.join(OUT, "png"), exist_ok=True)
    jobs = [("img/item/enchanted-spear0.png", "blast-held.png", 495, 101, held)]
    for c in ("", "colored/"):
        for v in ("out", "hover", "active"):
            key = ("colored-" if c else "") + v
            jobs.append(("img/interface/%sinv-enchanted-spear0-%s.png" % (c, v), "blast-inv-%s.png" % key, 160, 180, (lambda k=key: icon(k))))
    for path, png, w, h, fn in jobs:
        write_png(os.path.join(OUT, "png", png), w, h, fn())
        ovr["/img/h/%s.png" % HASH[path]] = "invented/png/" + png
        print("wrote", png, w, h, "for", path, flush=True)
    px, w, h = wave()
    write_png(os.path.join(OUT, "png", "blast-wave.png"), w, h, px)
    ovr["/img/h/%s.png" % HASH["img/creature/spell-water-dash-slash5.png"]] = "invented/png/blast-wave.png"
    print("wrote blast-wave.png", w, h, flush=True)
    json.dump(ovr, open(ovr_path, "w"), indent=1, sort_keys=True)
    print("override entries", len(ovr))


if __name__ == "__main__":
    main()
