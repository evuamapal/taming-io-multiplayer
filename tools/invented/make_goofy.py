#!/usr/bin/env python3
# Goofy default cosmetics (owner: three invented cosmetics every player wears by default; client side in
# tools/invented/client_patch.js, server defaults in world.js / social.js):
#   skin 1093 "Mauve Derpington": a mauve cat tamer with a flopped ear, crossed googly eyes and its tongue out
#   hat 70 "Brain Cooler 3000": a rainbow propeller beanie
#   accessory 626 "Floaty McQuackface": a rubber duck pool ring around the tamer
#   walking particle 511 "Squeaky Steps": a footprint trail (bare mauve foot, clown shoe, duck foot)
# Original art in the game's style (top-down, face toward the bottom of the image, thick dark outline, flat colours),
# drawn 4x and scaled down. Canvas sizes follow the real ones (player head 252x241, arms 86x156, trail frames 147 / 127 / 105,
# menu icons 200x200).
# Adds the in-game images (img/h/ names) and the menu icons (DOM paths) to mimic/invented/override.json.
# Needs Pillow. Usage: make_goofy.py
import json, math, os
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PNG = os.path.join(REPO, "mimic", "invented", "png")
S = 4
OUT = (58, 46, 42, 255)
LINE = 13   # outline width at 1x


def fnv(s, h):
    for c in s.encode():
        h ^= c; h = (h * 16777619) & 0xffffffff
    return h


def hashed(p):   # the client's image name for a registered path (tools/invented/client_patch.js fnv)
    return "img/h/" + "".join("%08x" % fnv(p, sd) for sd in (2166136033, 2166136043, 2166136061)) + ".png"


class Pen:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.im)

    def P(self, pts): return [(x * S, y * S) for x, y in pts]

    def ell(self, cx, cy, rx, ry, fill, line=LINE):
        if line: self.d.ellipse([(cx - rx - line) * S, (cy - ry - line) * S, (cx + rx + line) * S, (cy + ry + line) * S], fill=OUT)
        self.d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=fill)

    def poly(self, pts, fill, line=LINE):
        if line:
            self.d.polygon(self.P(pts), fill=OUT); self.d.line(self.P(pts + pts[:1]), fill=OUT, width=line * 2 * S, joint="curve")
            for x, y in pts: self.d.ellipse([(x - line) * S, (y - line) * S, (x + line) * S, (y + line) * S], fill=OUT)
        self.d.polygon(self.P(pts), fill=fill)

    def done(self, size=None): return self.im.resize(size or (self.w, self.h), Image.LANCZOS)


def blob(cx, cy, rx, ry, n=48, wob=None):
    return [(cx + rx * math.cos(2 * math.pi * i / n) * (1 + (wob(i / n) if wob else 0)), cy + ry * math.sin(2 * math.pi * i / n) * (1 + (wob(i / n) if wob else 0))) for i in range(n)]


MAUVE, MAUVE_D, EAR, CREAM, PINK = (208, 152, 230, 255), (176, 118, 214, 255), (146, 92, 218, 255), (244, 230, 210, 255), (240, 120, 150, 255)


def head(w=252, h=241):
    p = Pen(w, h); cx, cy = w / 2, h / 2 - 6
    # ears first (under the head): left one pointy, right one flopped down sideways
    p.poly([(cx - 84, cy - 22), (cx - 92, cy - 90), (cx - 34, cy - 60)], MAUVE)
    p.poly([(cx + 48, cy - 64), (cx + 100, cy - 60), (cx + 104, cy - 16), (cx + 80, cy - 26)], MAUVE)
    p.ell(cx, cy, 84, 78, MAUVE)
    # tongue lolling out of the front, past the outline
    p.ell(cx + 22, cy + 86, 16, 20, PINK)
    p.d.line(p.P([(cx + 22, cy + 76), (cx + 22, cy + 96)]), fill=(196, 80, 110, 255), width=4 * S)
    p.ell(cx, cy, 84, 78, MAUVE, line=0)
    p.d.ellipse([(cx + 8) * S, (cy + 58) * S, (cx + 36) * S, (cy + 78) * S], fill=PINK)
    # inner ears
    p.d.polygon(p.P([(cx - 76, cy - 32), (cx - 82, cy - 76), (cx - 46, cy - 56)]), fill=EAR)
    p.d.polygon(p.P([(cx + 56, cy - 56), (cx + 92, cy - 52), (cx + 94, cy - 26), (cx + 78, cy - 34)]), fill=EAR)
    # blush and a goofy crooked grin toward the front
    for bx in (-56, 56): p.d.ellipse([(cx + bx - 14) * S, (cy + 30) * S, (cx + bx + 14) * S, (cy + 44) * S], fill=(236, 140, 196, 255))
    p.d.arc([(cx - 34) * S, (cy + 26) * S, (cx + 30) * S, (cy + 70) * S], 20, 160, fill=OUT, width=7 * S)
    # crossed googly eyes: big whites, pupils that look at each other
    for ex, r, px in ((-34, 27, 14), (36, 22, -12)):
        p.ell(cx + ex, cy + 10, r, r, (255, 255, 255, 255), line=8)
        p.d.ellipse([(cx + ex + px - 10) * S, (cy + 16 - 10) * S, (cx + ex + px + 10) * S, (cy + 16 + 10) * S], fill=(30, 24, 22, 255))
        p.d.ellipse([(cx + ex + px - 6) * S, (cy + 9) * S, (cx + ex + px - 1) * S, (cy + 14) * S], fill=(255, 255, 255, 255))
    return p.done()


def arm(flip, w=86, h=156):
    p = Pen(w, h); cx, cy = w / 2, h / 2
    p.ell(cx, cy, 26, 60, MAUVE)
    # polka dots, because why not
    for dx, dy, r in ((-6, -30, 8), (8, 4, 7), (-8, 34, 6)):
        dx = -dx if flip else dx
        p.d.ellipse([(cx + dx - r) * S, (cy + dy - r) * S, (cx + dx + r) * S, (cy + dy + r) * S], fill=MAUVE_D)
    return p.done()


def beanie(w=250, h=250, up=60):
    p = Pen(w, h); cx, cy = w / 2, h / 2 - up
    cols = [(232, 72, 60, 255), (250, 204, 64, 255), (70, 150, 230, 255), (110, 196, 80, 255)]
    p.ell(cx, cy, 54, 50, cols[0])
    for i, c in enumerate(cols):
        p.d.pieslice([(cx - 54) * S, (cy - 50) * S, (cx + 54) * S, (cy + 50) * S], i * 90 - 45, i * 90 + 45, fill=c)
    for i in range(4):
        a = math.radians(i * 90 - 45)
        p.d.line(p.P([(cx, cy), (cx + 54 * math.cos(a), cy + 50 * math.sin(a))]), fill=OUT, width=5 * S)
    # propeller: two long blades, a little tilted
    for a in (math.radians(-18), math.radians(162)):
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        pts = [(cx + ux * t + vx * s, cy + uy * t + vy * s) for t, s in ((10, -7), (50, -17), (86, -10), (92, 0), (86, 10), (50, 17), (10, 7))]
        p.poly(pts, (250, 236, 120, 255), line=7)
    p.ell(cx, cy, 13, 13, (232, 72, 60, 255), line=7)
    return p.done()


def floatie(w=340, h=340):
    p = Pen(w, h); cx, cy = w / 2, h / 2 - 8
    Y, YD = (255, 214, 64, 255), (232, 170, 40, 255)
    # duck head at the front (bottom), drawn first so the ring sits on its neck
    p.ell(cx, cy + 136, 34, 30, Y)
    p.poly([(cx - 22, cy + 154), (cx + 22, cy + 154), (cx + 14, cy + 172), (cx - 14, cy + 172)], (250, 140, 40, 255), line=8)
    # tail flick at the back
    p.poly([(cx - 18, cy - 136), (cx, cy - 164), (cx + 18, cy - 136)], Y, line=9)
    # the ring: outlined donut, inner hole cut out
    R, r = 146, 118
    p.ell(cx, cy, R, R, Y, line=10)
    p.d.ellipse([(cx - r - 10) * S, (cy - r - 10) * S, (cx + r + 10) * S, (cy + r + 10) * S], fill=OUT)
    p.d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=(0, 0, 0, 0))
    # stripes of a pool ring and a shine
    for a0 in (30, 150, 270):
        p.d.arc([(cx - 132) * S, (cy - 132) * S, (cx + 132) * S, (cy + 132) * S], a0 - 14, a0 + 14, fill=(250, 250, 250, 255), width=20 * S)
    p.d.arc([(cx - 132) * S, (cy - 132) * S, (cx + 132) * S, (cy + 132) * S], 200, 240, fill=(255, 240, 170, 255), width=6 * S)
    # duck face on top of the ring: eyes looking up at the tamer
    p.ell(cx, cy + 136, 34, 30, Y, line=0)
    p.d.ellipse([(cx - 20) * S, (cy + 122) * S, (cx - 6) * S, (cy + 136) * S], fill=OUT)
    p.d.ellipse([(cx + 6) * S, (cy + 122) * S, (cx + 20) * S, (cy + 136) * S], fill=OUT)
    p.d.ellipse([(cx - 16) * S, (cy + 124) * S, (cx - 11) * S, (cy + 129) * S], fill=(255, 255, 255, 255))
    p.d.ellipse([(cx + 10) * S, (cy + 124) * S, (cx + 15) * S, (cy + 129) * S], fill=(255, 255, 255, 255))
    return p.done()


def foot(w=147, h=149):   # bare mauve footprint: sole and five toes, big toe first
    p = Pen(w, h); cx, cy = w / 2, h / 2 + 14
    p.ell(cx, cy, 30, 44, MAUVE, line=11)
    for tx, ty, r in ((-22, -58, 14), (2, -64, 12), (22, -58, 10), (36, -46, 8), (44, -30, 7)):
        p.ell(cx + tx - 6, cy + ty + 4, r, r, MAUVE, line=9)
    p.ell(cx, cy, 30, 44, MAUVE, line=0)
    p.d.ellipse([(cx - 12) * S, (cy + 6) * S, (cx + 12) * S, (cy + 30) * S], fill=MAUVE_D)
    return p.done()


def clown(w=127, h=140):   # clown shoe print: a huge round toe, a tiny heel and a smiley in the sole
    p = Pen(w, h); cx, cy = w / 2, h / 2
    p.ell(cx, cy + 40, 20, 18, (232, 72, 60, 255), line=10)
    p.ell(cx, cy - 18, 42, 40, (232, 72, 60, 255), line=10)
    p.d.ellipse([(cx - 16) * S, (cy - 30) * S, (cx - 6) * S, (cy - 20) * S], fill=OUT)
    p.d.ellipse([(cx + 6) * S, (cy - 30) * S, (cx + 16) * S, (cy - 20) * S], fill=OUT)
    p.d.arc([(cx - 20) * S, (cy - 26) * S, (cx + 20) * S, (cy + 4) * S], 20, 160, fill=OUT, width=5 * S)
    return p.done()


def duckfoot(w=105, h=105):   # little duck print: three webbed toes
    p = Pen(w, h); cx, cy = w / 2, h / 2 + 4
    pts = [(cx, cy + 32), (cx - 34, cy - 22), (cx - 12, cy - 14), (cx, cy - 36), (cx + 12, cy - 14), (cx + 34, cy - 22)]
    p.poly(pts, (250, 140, 40, 255), line=9)
    return p.done()


def icon(parts, size=200):   # menu tile: parts [(image, x, y)] on a 400 canvas, scaled to 200
    c = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
    for im, x, y in parts: c.alpha_composite(im, (int(x), int(y)))
    bb = c.getbbox(); c = c.crop(bb); k = min(176 / c.width, 176 / c.height)
    c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.alpha_composite(c, ((size - c.width) // 2, (size - c.height) // 2))
    return out


def main():
    H, AL, AR, HAT, ACC = head(), arm(False), arm(True), beanie(), floatie()
    F0, F1, F2 = foot(), clown(), duckfoot()
    files = {
        "img/creature/player1093-head.png": ("goofy-skin-head.png", H),
        "img/creature/player1093-arm-left.png": ("goofy-skin-arm-left.png", AL),
        "img/creature/player1093-arm-right.png": ("goofy-skin-arm-right.png", AR),
        "img/item/hat70.png": ("goofy-hat.png", HAT),
        "img/item/accessory626.png": ("goofy-accessory.png", ACC),
        "img/particle/dust511-0.png": ("goofy-trail0.png", F0),
        "img/particle/dust511-1.png": ("goofy-trail1.png", F1),
        "img/particle/dust511-2.png": ("goofy-trail2.png", F2),
    }
    menu = {
        "img/interface/cosmetic-skin1093.png": ("goofy-menu-skin.png", icon([(AL, 70, 150), (AR, 244, 150), (H, 74, 80)])),
        "img/interface/cosmetic-hat70.png": ("goofy-menu-hat.png", icon([(HAT, 75, 75)])),
        "img/interface/cosmetic-accessory626.png": ("goofy-menu-accessory.png", icon([(ACC, 50, 50)])),
        "img/interface/cosmetic-dust511.png": ("goofy-menu-trail.png", icon([(F0, 40, 150), (F1, 150, 40), (F2, 250, 190)])),
    }
    ovr_path = os.path.join(REPO, "mimic", "invented", "override.json")
    ovr = json.load(open(ovr_path))
    for p, (fn, im) in files.items():
        im.save(os.path.join(PNG, fn), optimize=True); ovr["/" + hashed(p)] = "invented/png/" + fn
    for p, (fn, im) in menu.items():
        im.save(os.path.join(PNG, fn), optimize=True); ovr["/" + p] = "invented/png/" + fn
    open(ovr_path, "w").write(json.dumps(dict(sorted(ovr.items())), indent=1, ensure_ascii=False) + "\n")
    print("wrote", len(files) + len(menu), "images")


if __name__ == "__main__":
    main()
