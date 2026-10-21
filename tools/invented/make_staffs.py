#!/usr/bin/env python3
# Invented fairy staffs (one per fairy element, client items 341..352 appended by tools/invented/client_patch.js): original
# art in the game style (dark outline, flat colors), drawn with the pure-Python rasterizer of make_art.py (no PIL):
#   held sprite      img/item/staff-<el>.png (102 x 414, the musket's size and pose: the image top is the end at the
#                    hand and the bottom points at the aim, so the art is drawn tip up and turned 180 degrees: orb at the bottom)
#   hotbar / picker  img/interface/[colored/]inv-staff-<el>-{out,hover,active}.png (160 x 180, the inventory card size)
# The client loads every item image through its path hash (img/h/<hash>.png, 3 x FNV-1a, see new_slots.hashed).
# Writes mimic/invented/png/staff-*.png and adds them to mimic/invented/override.json. Usage: make_staffs.py [el ...]
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from make_art import Ellipse, Poly, Stroke, render, write_png, hexc
from new_slots import hashed
from make_blast import rr, crop, CARD

REPO = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(REPO, "mimic", "invented")
LINE = "#2b2523"
WOOD, WOOD_D, METAL, METAL_L = "#7a4f2c", "#5a3820", "#b9a27a", "#e2d3ab"
# element: orb, orb glow, orb shine, accent, accent light, metal override
EL = {
    "fire": ("#e8452a", "#ffb43c", "#fff1b8", "#ff7a2a", "#ffd25a"),
    "water": ("#2f7fd8", "#7cc4ff", "#e4f5ff", "#3d9be8", "#a8dcff"),
    "ice": ("#7fd6f0", "#d4f4ff", "#ffffff", "#a8e8fa", "#eefcff"),
    "plant": ("#3f9a3a", "#93d65a", "#e8ffc8", "#4fae3c", "#a6e070"),
    "electric": ("#f2c21a", "#fff07a", "#fffde0", "#ffd21e", "#fff3a0"),
    "rock": ("#8a7a68", "#b8a690", "#ece2d4", "#7a6a58", "#a8987f"),
    "spectrum": ("#8a3fc4", "#d29aff", "#f8ecff", "#5fd0e8", "#ff8ad2"),
    "poison": ("#7a3aa8", "#b6e04a", "#f2ffd0", "#8fd02a", "#d0f080"),
    "dragon": ("#c4283a", "#ff8a4a", "#ffe0b0", "#e0b03a", "#ffe08a"),
    "insect": ("#9ab02a", "#e0e85a", "#fbffd8", "#d8c040", "#f4eaa0"),
    "combat": ("#d8662a", "#ffb070", "#fff0dc", "#8a8f9a", "#d6dbe4"),
    "normal": ("#f08ab4", "#ffd0e4", "#fff6fb", "#ffffff", "#ffe8f2"),
}
CX = 51   # staff pixel frame 102 x 414, tip up; orb at (51, 84)
OY, OR = 84, 33


def star(cx, cy, r0, r1, n, rot=0.0):
    return ("poly", [(cx + (r1 if k % 2 == 0 else r0) * math.cos(rot + math.pi * k / n - math.pi / 2),
                      cy + (r1 if k % 2 == 0 else r0) * math.sin(rot + math.pi * k / n - math.pi / 2)) for k in range(2 * n)])


def accents(el, a, al):
    """(shape, color, outline, front) around the orb; front = drawn over the orb"""
    if el == "fire":
        return [(("poly", [(51, 2), (64, 34), (70, 54), (32, 54), (38, 34)]), a, True, False),
                (("poly", [(26, 20), (40, 46), (30, 60), (20, 44)]), a, True, False), (("poly", [(76, 20), (82, 44), (72, 60), (62, 46)]), a, True, False),
                (("poly", [(51, 18), (59, 40), (43, 40)]), al, False, False)]
    if el == "water":
        return [(("poly", [(51, 4), (64, 30), (66, 42), (36, 42), (38, 30)]), a, True, False), (("ell", 51, 40, 15, 12), a, False, False),
                (("ell", 47, 30, 4, 6), al, False, False), (("ell", 20, 52, 6, 8), a, True, False), (("ell", 82, 52, 6, 8), a, True, False)]
    if el == "ice":
        return [(("poly", [(51, 0), (60, 40), (51, 56), (42, 40)]), a, True, False), (("poly", [(22, 18), (40, 50), (32, 62), (16, 38)]), a, True, False),
                (("poly", [(80, 18), (86, 38), (70, 62), (62, 50)]), a, True, False), (("poly", [(51, 8), (55, 38), (51, 44)]), al, False, False)]
    if el == "plant":
        return [(("poly", [(36, 150), (8, 136), (2, 112), (24, 118), (40, 138)]), a, True, False), (("poly", [(66, 150), (94, 136), (100, 112), (78, 118), (62, 138)]), a, True, False),
                (("poly", [(51, 6), (62, 26), (51, 52), (40, 26)]), a, True, False), (("stroke", [(51, 14), (51, 46)], 1.5), hexc("#2f6a24"), False, False)]
    if el == "electric":
        return [(("poly", [(56, 0), (36, 34), (50, 34), (40, 58), (68, 24), (54, 24), (64, 0)]), a, True, False),
                (("poly", [(18, 40), (8, 58), (16, 58), (10, 74), (26, 52), (19, 52), (24, 40)]), a, True, False),
                (("poly", [(84, 40), (94, 58), (86, 58), (92, 74), (76, 52), (83, 52), (78, 40)]), a, True, False)]
    if el == "rock":
        return [(("poly", [(14, 66), (26, 48), (38, 56), (34, 80), (18, 84)]), a, True, True), (("poly", [(88, 66), (76, 48), (64, 56), (68, 80), (84, 84)]), a, True, True),
                (("poly", [(40, 22), (56, 10), (68, 26), (60, 46), (42, 44)]), a, True, False), (("poly", [(46, 24), (56, 16), (60, 26)]), al, False, False)]
    if el == "spectrum":
        return [(("stroke", [(51 + 44 * math.cos(t / 20 * math.tau), OY + 16 * math.sin(t / 20 * math.tau)) for t in range(21)], 3.5), a, True, True),
                (star(51, 22, 6, 16, 4), al, True, False), (star(18, 44, 3, 8, 4), a, True, False), (star(84, 44, 3, 8, 4), al, True, False)]
    if el == "poison":
        return [(("ell", 51, 30, 16, 14), a, True, False), (("ell", 51, 16, 8, 8), a, True, False), (("ell", 46, 26, 4, 4), al, False, False),
                (("poly", [(26, 112), (32, 124), (20, 124)]), a, True, True), (("ell", 26, 126, 6, 6), a, True, True), (("ell", 78, 120, 5, 5), a, True, True)]
    if el == "dragon":
        return [(("poly", [(26, 70), (6, 40), (4, 10), (20, 34), (34, 58)]), a, True, False), (("poly", [(76, 70), (96, 40), (98, 10), (82, 34), (68, 58)]), a, True, False),
                (("poly", [(51, 10), (58, 30), (51, 44), (44, 30)]), al, True, False)]
    if el == "insect":
        return [(("ell", 22, 66, 20, 11, -0.5), (a[0], a[1], a[2], 210), True, False), (("ell", 80, 66, 20, 11, 0.5), (a[0], a[1], a[2], 210), True, False),
                (("ell", 26, 90, 14, 8, 0.4), (al[0], al[1], al[2], 210), True, False), (("ell", 76, 90, 14, 8, -0.4), (al[0], al[1], al[2], 210), True, False),
                (("stroke", [(46, 50), (38, 26), (32, 18)], 1.8), hexc(LINE), False, False), (("stroke", [(56, 50), (64, 26), (70, 18)], 1.8), hexc(LINE), False, False)]
    if el == "combat":
        return [(star(51, OY, OR + 4, OR + 18, 8, math.pi / 8), a, True, False), (("poly", [(51, 0), (60, 30), (42, 30)]), al, True, False)]
    if el == "normal":
        return [(star(51, 20, 7, 18, 5), a, True, False), (star(16, 46, 3, 9, 4), a, True, False), (star(86, 46, 3, 9, 4), a, True, False),
                (("ell", 51, 22, 4, 4), al, False, False)]
    return []


def staff_parts(el):
    orb, glow, shine, acc, accl = (hexc(c) for c in EL[el])
    back = [p for p in accents(el, acc, accl) if not p[3]]
    front = [p for p in accents(el, acc, accl) if p[3]]
    body = [
        (rr(40, 150, 62, 406, 10), hexc(WOOD), True),                            # shaft
        (("stroke", [(46, 160), (46, 396)], 2.2), hexc("#a0703f"), False),       # shaft shine
        (rr(36, 238, 66, 254, 5), hexc(METAL), True), (rr(36, 368, 66, 382, 5), hexc(METAL), True),   # bands
        (rr(38, 280, 64, 340, 6), hexc(WOOD_D), False),                          # grip
        (("poly", [(28, 152), (74, 152), (64, 122), (38, 122)]), hexc(METAL), True),   # collar
        (("poly", [(40, 124), (20, 98), (16, 66), (28, 52), (30, 70), (34, 96), (48, 120)]), hexc(METAL), True),   # prongs
        (("poly", [(62, 124), (82, 98), (86, 66), (74, 52), (72, 70), (68, 96), (54, 120)]), hexc(METAL), True),
        (("ell", 51, OY, OR, OR), orb, True),                                    # orb
        (("ell", 51, OY + 3, OR - 11, OR - 11), glow, False),
        (("ell", 41, OY - 12, 8, 6), shine, False),
        (("poly", [(34, 136), (68, 136), (66, 142), (36, 142)]), hexc(METAL_L), False),
    ]
    return [(s, c, o) for s, c, o, _ in back] + body + [(s, c, o) for s, c, o, _ in front]


def place(S, el, ox, oy, sc, rot):
    """staff pixels -> square canvas (side S) normalized: scale sc, rotate rot around the staff center, center at (ox, oy)"""
    c, s = math.cos(rot), math.sin(rot)
    def P(x, y):
        x, y = (x - 51) * sc, (y - 207) * sc
        return ((ox + x * c - y * s) / S, (oy + x * s + y * c) / S)
    out = []
    for sh, col, ol in staff_parts(el):
        if sh[0] == "poly": shape = Poly([P(x, y) for x, y in sh[1]])
        elif sh[0] == "stroke": shape = Stroke([P(x, y) for x, y in sh[1]], sh[2] * sc / S)
        else:
            cx, cy = P(sh[1], sh[2])
            shape = Ellipse(cx, cy, sh[3] * sc / S, sh[4] * sc / S, rot + (sh[5] if len(sh) > 5 else 0))
        out.append(([shape], col, ol))
    return out


def held(el):   # square canvas so the outline is even, then the 102 columns around the staff
    S = 414
    px = render(S, S, place(S, el, 207, 207, 1.0, math.pi), 5, hexc(LINE))
    out = bytearray(102 * 414 * 4)
    for y in range(414):
        out[y * 102 * 4:(y + 1) * 102 * 4] = px[(y * S + 156) * 4:(y * S + 258) * 4]
    return bytes(out)


def icon(el, variant):
    S = 180; body, edge = CARD[variant]
    N = lambda pts: [(x / S, y / S) for x, y in pts]
    L = [([Poly(N(rr(10, 0, 170, 180, 22)[1]))], hexc(edge), False), ([Poly(N(rr(10, 0, 170, 166, 22)[1]))], hexc(body), False)]
    if variant.endswith("active"):
        ring = N(rr(14, 4, 166, 162, 19)[1])
        L.append(([Stroke(ring + ring[:1], 3.5 / S)], hexc(EL[el][1]), False))
    L += place(S, el, 90, 84, 0.37, math.radians(42))
    px = render(S, S, L, 3, hexc(LINE))
    return crop(px, S, 10, 0, 160, 180)


def main():
    els = sys.argv[1:] or list(EL)
    os.makedirs(os.path.join(OUT, "png"), exist_ok=True)
    for el in els:
        jobs = [("img/item/staff-%s.png" % el, "staff-%s-held.png" % el, 102, 414, lambda: held(el))]
        for c in ("", "colored/"):
            for v in ("out", "hover", "active"):
                key = ("colored-" if c else "") + v
                jobs.append(("img/interface/%sinv-staff-%s-%s.png" % (c, el, v), "staff-%s-inv-%s.png" % (el, key), 160, 180, (lambda k=key: icon(el, k))))
        upd = {}
        for path, png, w, h, fn in jobs:
            write_png(os.path.join(OUT, "png", png), w, h, fn())
            upd[hashed(path)] = "invented/png/" + png
        ovr_path = os.path.join(OUT, "override.json"); ovr = json.load(open(ovr_path))   # re-read: other runs may add theirs
        for k, v in upd.items(): ovr["/" + k] = v
        json.dump(ovr, open(ovr_path, "w"), indent=1, sort_keys=True)
        print("wrote", el, len(upd), "images; override entries", len(ovr), flush=True)


if __name__ == "__main__":
    main()
