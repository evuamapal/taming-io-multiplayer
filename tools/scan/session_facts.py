#!/usr/bin/env python3
# Recorded game facts per play session (human captures and boss-near scans), so nothing the owner records is lost.
# Input: decoded per-server v2 files (rnd_ws/captures/*_human.v2.jsonl and captures/scans_dec/*nearboss*.v2.jsonl, each
# with a .key file holding the server key). Types go through decoder/typemap_<key>.json to Atlanta#4 ids; tx ops are
# un-rekeyed again from the raw numbers with this server's own op table (direct_scan/node/tables.js, cached in
# work/session_facts/op_tables.json), because decode.py assumes the Atlanta#4 rekey op and r = value (it is r ^= value).
# Output: work/session_facts/<tag>.json per session and mimic/data/session_facts.json (aggregate over every session:
# per fact the values, counts and source tags with frame times). Data only: the clone does not read it.
# Sections per session: boss_fights, creature_hits, pvp_received, pet_casts, buildings, cosmetics, deaths. A section whose
# inputs are missing is skipped with a reason; one bad file never stops the others.
# Times: t = seconds since the file's first rx frame (raw frame ts = t0 + t, t0 in the session file). "frame" = rx frame index.
# Usage: session_facts.py [FILE.v2.jsonl ...] [--force]
#   no files: every human capture plus every nearboss scan; only per-session files that are missing or older than their v2
#   file (or than this script) are rebuilt. Files named on the command line are always rebuilt.
#   The aggregate always covers every per-session file in work/session_facts.
import argparse, collections, glob, json, math, os, subprocess, sys, time, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(os.path.dirname(HERE))
HOME = os.path.expanduser("~")
RND = os.path.join(HOME, "tio", "tio_dev", "rnd_ws")
DECODER = os.path.join(RND, "decoder")
HUMAN = os.path.join(RND, "captures")
SCANS_DEC = os.path.join(RND, "captures", "scans_dec")
OUTDIR = os.path.join(PKG, "work", "session_facts")
AGG = os.path.join(PKG, "mimic", "data", "session_facts.json")
OPT = os.path.join(OUTDIR, "op_tables.json")
NODE = os.path.join(HOME, "node", "bin", "node")
TABLES = os.path.join(HOME, "tio", "tio_dev", "direct_scan", "node", "tables.js")
VERSION = 1

def _load(p, d):
    try: return json.load(open(p))
    except Exception: return d

SPECIES = {int(k): v.get("name") for k, v in _load(os.path.join(PKG, "work", "creature_table_client.json"), {}).items()}
ITEMS = {int(k): v for k, v in _load(os.path.join(PKG, "mimic", "data", "items.json"), {}).items()}
ICON2ITEM = {v.get("icon"): k for k, v in ITEMS.items()}
_H = _load(os.path.join(PKG, "mimic", "data", "client_hats.json"), {})
HATS = {h[0]: h[1] for h in _H.get("hats", [])}
WINGS = {h[0]: h[1] for h in _H.get("wings", [])}
# world bosses = stage 3 of these species (mimic/hosted/creatures.js WB.species: dragon, ice golem, spectrum, stone golem,
# ice dragon, octopus, gold golem, volcanic golem, fire dragon, mushroom boss = Polecat, cactus boss = Deer, dark tree)
BOSS_SP = {20, 21, 35, 62, 76, 85, 101, 121, 141, 4, 15, 68}
SHOP_OPS = {12: "open", 7: "buy", 6: "equip", 9: "close"}   # atl4 ops, value = category + id << 8 (category 0 hat)
ATTACK_OP, SELECT_OP, REKEY_OP = 4, 10, 16

def sp_name(s): return SPECIES.get(s, "species %s" % s) if s is not None else None
def item_name(i): return ITEMS.get(i, {}).get("name", "item %s" % i) if i is not None else None
def hat_name(h): return HATS.get(h, "hat %s" % h)
def wing_name(w): return WINGS.get(w, "wing %s" % w)
def r3(x): return None if x is None else round(x, 3)
def dist(a, b):
    if a is None or b is None or a[0] is None or b[0] is None or a[1] is None or b[1] is None: return None
    return round(math.hypot(a[0] - b[0], a[1] - b[1]), 1)
def mv(last, v):
    # move records (atl4 84, compact or not): v > 255 absolute, 128..255 last + (v - 128), 0..127 last - v
    if not isinstance(v, (int, float)): return last
    if v > 255 or last is None: return v
    return last + (v - 128) if v >= 128 else last - v
def med(xs):
    xs = sorted(xs)
    if not xs: return None
    n = len(xs); return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2.0

# ---------------------------------------------------------------- per-server tables
def op_tables(keys):
    """server tx op id -> atl4 op id per key, from the client's own shuffle (tables.js K), cached"""
    cache = _load(OPT, {})
    need = sorted({k for k in keys if k and k not in cache})
    if need and os.path.exists(NODE) and os.path.exists(TABLES):
        env = dict(os.environ, BUNDLE=os.path.join(PKG, "mimic", "game_mimic.js"))
        for i in range(0, len(need), 6):   # tables.js exits after one write: a pipe holds at most 64 KB
            try:
                out = subprocess.run([NODE, TABLES, "atlanta4"] + need[i:i + 6], env=env, capture_output=True, text=True,
                                     cwd=os.path.dirname(TABLES), timeout=300).stdout
                d = json.loads(out.strip().splitlines()[-1]); a = d["atlanta4"]["K"]
                for k in need[i:i + 6]:
                    if k in d: cache[k] = {str(v): a[n] for n, v in d[k]["K"].items() if n in a}
            except Exception as e:
                print("op tables failed for %s: %s" % (need[i:i + 6], e), file=sys.stderr)
        os.makedirs(OUTDIR, exist_ok=True)
        json.dump(cache, open(OPT, "w"), indent=0)
    return {k: {int(s): v for s, v in cache[k].items()} for k in keys if k in cache}

# ---------------------------------------------------------------- replay
class Replay:
    def __init__(self, path, key, tm, opm):
        self.path, self.key, self.tm, self.opm = path, key, tm, opm
        self.E = {}                 # id -> entity {id, cat, f, x, y, tc, n84}
        self.fi = -1; self.t0 = None; self.t = 0.0; self.tlast = 0.0
        self.owner = None; self.owner_src = None; self.owners = []; self.pets = set()
        self.dead = False
        self.fx = []                # every effect create (cat 4)
        self.fxlive = {}            # id -> fx rec
        self.bosses = {}            # id -> boss rec
        self.hits = []              # hp drops on the owner
        self.dmg = []               # field 10 on any creature / player / structure
        self.swings = collections.deque()    # (fi, t, id, item)
        self.last_att = {}          # creature id -> frame of last attack flag (field 7 bit 32)
        self.owner_swing_fi = None
        self.casts = []; self.places = []; self.presses = []; self.shop = []; self.worn = []; self.deaths = []
        self.selects = []
        self.stat = collections.Counter()
        self.have_tx = False; self.have_ops = opm is not None
        self.inv36 = {}

    def pos(self, i):
        e = self.E.get(i)
        return None if e is None or e["x"] is None else (e["x"], e["y"])

    def set_owner(self, oid, src):
        if oid is None or oid == self.owner: return
        self.owner = oid; self.owner_src = src; self.dead = False
        self.owners.append({"id": oid, "t": r3(self.t), "src": src})

    def run(self):
        rk = {}
        for ln in open(self.path):
            try: r = json.loads(ln)
            except Exception: self.stat["bad_line"] += 1; continue
            ts = r.get("ts")
            if not isinstance(ts, (int, float)): continue
            if r.get("dir") == "rx":
                if self.t0 is None: self.t0 = ts
                self.fi += 1; self.t = ts - self.t0; self.tlast = self.t
                self.frame(r.get("msgs") or [])
            elif r.get("dir") == "tx" and self.t0 is not None:
                self.have_tx = True
                t = ts - self.t0
                js = r.get("json"); js = js if isinstance(js, list) else [js] if js is not None else []
                for j in js:
                    if isinstance(j, dict): self.txjson(t, j)
                # numbers ride in binary frames and also after the object in JSON text frames; wire op = base ^ r, and the
                # rekey op XORs its value into r
                nums = (r.get("nums") or []) + [j for j in js if isinstance(j, int) and not isinstance(j, bool)]
                if self.opm is not None and nums:
                    rid = r.get("rid"); rr = rk.get(rid, 0)
                    for x in nums:
                        if not isinstance(x, int): continue
                        a = self.opm.get((x & 255) ^ rr); v = x >> 8
                        if a == REKEY_OP: rr ^= v
                        elif a is not None: self.txop(t, a, v)
                        else: self.stat["op_unknown"] += 1
                    rk[rid] = rr
        return self

    # ---- tx
    def txjson(self, t, j):
        a = self.tm.get(str(j.get("type")))
        if a == 48 and j.get("S") == 4:
            I = j.get("I"); e = self.E.get(I)
            self.casts.append({"t": r3(t), "frame": self.fi, "pet": I, "species": e["f"].get("21") if e else None,
                               "stage": e["f"].get("23") if e else None, "pet_pos": self.pos(I), "aim": [j["A"], j["B"]] if "A" in j else None,
                               "owner": self.owner})

    def txop(self, t, a, v):
        self.stat["op_%d" % a] += 1
        if a in SHOP_OPS:
            self.shop.append({"t": r3(t), "op": SHOP_OPS[a], "category": v & 255, "id": v >> 8,
                              "name": (hat_name(v >> 8) if v & 255 == 0 else wing_name(v >> 8) if v & 255 == 1 else None) if a in (7, 6) else None})
        elif a == SELECT_OP:
            self.selects.append((t, v))
        elif a == ATTACK_OP and v != 0 and self.owner in self.E:
            held = self.E[self.owner]["f"].get("8")
            it = ITEMS.get(held) if isinstance(held, int) else None
            if it and it.get("place") and "Saddle" not in it.get("name", ""):
                if not self.presses or t - self.presses[-1]["t"] > 0.5 or self.presses[-1]["item"] != held:
                    self.presses.append({"t": t, "item": held, "owner": self.owner, "pos": self.pos(self.owner)})

    # ---- rx
    def frame(self, msgs):
        t, fi = self.t, self.fi
        hits_here = []; f81 = []; f36 = []; created = {}
        for m in msgs:
            if not isinstance(m, dict): continue
            a = 84 if m.get("_c0") else self.tm.get(str(m.get("1")))
            i = m.get("0")
            if a == 79 and i is not None: created[i] = (m, self.pos(self.owner)); self.create(m, i)   # owner spot at the create, mid frame
            elif a == 84 and i is not None:
                h = self.update(m, i)
                if h: hits_here.append(h)
            elif a == 87 and i is not None: self.remove(i)
            elif a == 19 and isinstance(m.get("id"), int) and m.get("s") is False: self.set_owner(m["id"] >> 8, "camera 19")
            elif a == 59 and isinstance(m.get("i"), int):
                if m.get("d") == 1: self.pets.discard(m["i"])
                elif "n" in m or "a" in m: self.pets.add(m["i"])
            elif a in (6, 26) and isinstance(m.get("o"), dict): self.death(m["o"], a)
            elif a == 81: f81.append(m)
            elif a == 36 and isinstance(m.get("B"), list): f36.append(m["B"])
        for h in hits_here: self.hit_context(h)
        for b in self.bosses.values():
            if b["id"] in self.E and self.owner in self.E:
                d = dist(self.pos(b["id"]), self.pos(self.owner))
                if d is not None and (b["min_d_owner"] is None or d < b["min_d_owner"]): b["min_d_owner"] = d; b["min_d_t"] = r3(t)
        if f81 or f36: self.placements(f81, f36, created)
        while self.swings and self.swings[0][0] < fi - 30: self.swings.popleft()

    def create(self, m, i):
        f = {k: v for k, v in m.items() if k not in ("0", "1", "_type", "_c0", "3", "4") and not k.startswith("_")}
        cat = m.get("2")
        e = {"id": i, "cat": cat, "f": f, "x": m.get("3"), "y": m.get("4"), "tc": self.t, "n84": 0}
        self.E[i] = e
        if cat == 0 and isinstance(f.get("13"), int) and i in self.pets and (self.owner is None or self.owner_src != "camera 19"):
            self.set_owner(f["13"], "pet create 13")
        if cat == 0 and f.get("23") == 3 and f.get("21") in BOSS_SP:
            b = self.bosses.get(i)
            if b is None:
                b = self.bosses[i] = {"id": i, "species": f.get("21"), "name": sp_name(f.get("21")), "type": f.get("22"), "stage": 3,
                                      "first_t": r3(self.t), "last_t": r3(self.t), "views": 0, "pos_first": [e["x"], e["y"]],
                                      "min_d_owner": None, "min_d_t": None, "states": collections.Counter(), "state_log": [], "f18_last": None}
            b["views"] += 1
        if cat == 4:
            rec = {"id": i, "t": self.t, "frame": self.fi, "kind": f.get("7"), "var": f.get("8"), "src10": f.get("10"), "src11": f.get("11"),
                   "x": e["x"], "y": e["y"], "a5": f.get("5"), "removed_t": None, "moves": 0, "end": None,
                   "owner": self.owner, "owner_pos": self.pos(self.owner)}
            rec["src_pos"] = {s: self.pos(s) for s in (rec["src10"], rec["src11"]) if s in self.E}
            rec["boss"] = rec["src11"] if rec["src11"] in self.bosses else rec["src10"] if rec["src10"] in self.bosses else None
            # field 10 naming another entity than the source = the effect sits on that target (status, e.g. a burn on the owner)
            rec["on"] = rec["src10"] if rec["src10"] is not None and rec["src10"] != rec["src11"] and rec["src10"] in self.E else None
            self.fx.append(rec); self.fxlive[i] = rec

    def update(self, m, i):
        e = self.E.get(i)
        if e is None: return None
        e["n84"] += 1
        prev_hp = e["f"].get("12")
        for k, v in m.items():
            if k in ("0", "1", "_type", "_c0") or k.startswith("_"): continue
            if k == "3": e["x"] = mv(e["x"], v)
            elif k == "4": e["y"] = mv(e["y"], v)
            else: e["f"][k] = v
        if i in self.fxlive: r = self.fxlive[i]; r["moves"] += 1; r["end"] = (e["x"], e["y"])
        cat = e["cat"]
        if "15" in m and cat == 1:
            self.swings.append((self.fi, self.t, i, e["f"].get("8")))
            if i == self.owner: self.owner_swing_fi = self.fi
        if "7" in m and cat == 0 and isinstance(m["7"], int) and m["7"] & 32: self.last_att[i] = self.fi
        if i in self.bosses and "7" in m:
            b = self.bosses[i]; b["states"][m["7"]] += 1
            if len(b["state_log"]) < 400 and (not b["state_log"] or b["state_log"][-1][1] != m["7"]): b["state_log"].append([r3(self.t), m["7"]])
        if "10" in m and cat in (0, 1, 3):
            rec = {"t": self.t, "frame": self.fi, "id": i, "cat": cat, "sp": e["f"].get("21"), "stage": e["f"].get("23"), "dmg": m["10"],
                   "f9": e["f"].get("9"), "f11": m.get("11"), "f13": m.get("13"), "x": e["x"], "y": e["y"]}
            if i in self.bosses:
                rec["d_owner"] = dist(self.pos(i), self.pos(self.owner))
                rec["owner_swing_frames"] = None if self.owner_swing_fi is None else self.fi - self.owner_swing_fi
                rec["owner_item"] = self.E[self.owner]["f"].get("8") if self.owner in self.E else None
            self.dmg.append(rec)
            if i == self.owner and cat == 1:
                return {"m": m, "t": self.t, "frame": self.fi, "owner": i, "dmg": m["10"], "hp": e["f"].get("12"), "hp_prev": prev_hp,
                        "k13": m.get("13"), "pos": (e["x"], e["y"]), "hat": e["f"].get("9")}
        if i == self.owner and "9" in m:
            v = m["9"]
            if isinstance(v, int) and (not self.worn or self.worn[-1]["v"] != v): self.worn.append({"t": r3(self.t), "v": v, "owner": i})
        return None

    def remove(self, i):
        self.E.pop(i, None)
        r = self.fxlive.pop(i, None)
        if r is not None: r["removed_t"] = self.t

    def death(self, o, a):
        sbk = o.get("sbk")
        if self.deaths and self.t - self.deaths[-1]["t_screen"] < 2: return
        oid = self.owner
        hp0 = next((h for h in reversed(self.hits) if h["owner"] == oid and h["hp"] == 0), None)
        last = [h for h in self.hits if h["owner"] == oid and h["t"] >= (hp0["t"] if hp0 else self.t) - 5]
        self.deaths.append({"t_screen": r3(self.t), "t_hp0": r3(hp0["t"]) if hp0 else None, "msg": a, "owner": oid,
                            "killer_kind": sbk[0] if isinstance(sbk, list) and sbk else None,
                            "killer_name": sbk[1] if isinstance(sbk, list) and len(sbk) > 1 else None,
                            "alive_ms": o.get("t"), "score": o.get("sbs"), "pos": list(hp0["pos"]) if hp0 else (list(self.pos(oid)) if self.pos(oid) else None),
                            "last5s": [{"t": r3(h["t"]), "dmg": h["dmg"], "hp": h["hp"], "k13": h["k13"], "class": h.get("class"),
                                        "by": h.get("by")} for h in last]})
        self.dead = True

    def hit_context(self, h):
        fi, t = h["frame"], h["t"]; o = self.owner; op = h["pos"]
        # players that swung 0..5 frames before, within 320
        cands = []
        for (sfi, st, sid, sitem) in self.swings:
            if sid == o or fi - sfi > 5 or fi < sfi: continue
            se = self.E.get(sid)
            d = dist(self.pos(sid), op)
            if d is None or d > 320: continue
            cands.append({"id": sid, "frames": fi - sfi, "d": d, "item": se["f"].get("8") if se else sitem, "hat": se["f"].get("9") if se else None})
        best = {}
        for c in cands:
            if c["id"] not in best or c["frames"] < best[c["id"]]["frames"]: best[c["id"]] = c
        cands = sorted(best.values(), key=lambda c: (c["frames"], c["d"]))
        # creatures with an attack flag within 3 frames, within 400 (not his own pets)
        crs = []
        for cid, afi in self.last_att.items():
            if fi - afi > 3: continue
            e = self.E.get(cid)
            if e is None or e["cat"] != 0 or e["f"].get("13") == o or cid in self.pets: continue
            d = dist(self.pos(cid), op)
            if d is not None and d <= 400: crs.append({"id": cid, "d": d, "sp": e["f"].get("21"), "stage": e["f"].get("23"), "type": e["f"].get("22"),
                                                       "owned_by": e["f"].get("13"), "frames": fi - afi})
        crs.sort(key=lambda c: c["d"])
        # boss effects alive or created within 5 s
        bfx = []
        for r in self.fx[::-1]:
            if t - r["t"] > 12: break
            if r["boss"] is None: continue
            alive = r["removed_t"] is None or r["removed_t"] >= t - 0.05
            if not alive and t - r["t"] > 5: continue
            p = r["end"] or (r["x"], r["y"])
            bfx.append({"id": r["id"], "kind": r["kind"], "d": dist(p, op), "age": r3(t - r["t"]), "boss": r["boss"], "alive": alive, "on_owner": r["on"] == o})
        # nearest first; effects sitting on the owner himself (status) after the ones on the ground
        bfx.sort(key=lambda b: (b["on_owner"], b["d"] is None, b["d"] if b["d"] is not None else 0))
        h["cands"] = cands; h["creatures"] = crs; h["boss_fx"] = bfx
        dmg = h["dmg"] if isinstance(h["dmg"], int) else 0
        near_bfx = bool(bfx) and bfx[0]["d"] is not None and bfx[0]["d"] <= 150 and not bfx[0]["on_owner"]
        if crs and near_bfx and (crs[0]["id"] in self.bosses or crs[0]["d"] > 180): crs = []   # a boss casting far away: its ground effect hit
        h["creatures"] = crs
        if h["k13"] is None: cl = "dot"
        elif cands: cl = "small" if dmg <= 4 else ("ambiguous" if crs and crs[0]["d"] <= 180 else "pvp")
        elif crs: cl = "creature"
        elif bfx: cl = "boss_fx"
        else: cl = "unattributed"
        h["class"] = cl
        h["by"] = (("player %s" % cands[0]["id"]) if cands and cl in ("pvp", "small", "ambiguous") else
                   ("creature %s" % sp_name(crs[0]["sp"])) if crs and cl == "creature" else ("boss fx %s" % bfx[0]["kind"]) if bfx else None)
        self.hits.append(h)

    def placements(self, f81, f36, created):
        prev = dict(self.inv36)
        for B in f36:
            for v in B:
                if isinstance(v, int): self.inv36[v >> 8] = v & 255
        grew = [k for k, c in self.inv36.items() if c > prev.get(k, 0)]
        for m in f81:
            if "p" not in m: continue
            for ent in m.get("o") or []:
                if not isinstance(ent, list) or not ent: continue
                bid = ent[0]; c = created.get(bid)
                if c is None: continue
                c, op = c
                icon = ent[3] if len(ent) > 3 else None
                item = ICON2ITEM.get(icon) if icon else None
                if item is None and len(grew) == 1: item = grew[0]
                bp = (c.get("3"), c.get("4"))
                ang = None; off = None
                if op and None not in bp:
                    ang = math.atan2(bp[1] - op[1], bp[0] - op[0]) % (2 * math.pi)
                    if isinstance(c.get("5"), int): off = c["5"] - int(round(ang * 100))
                self.places.append({"t": r3(self.t), "frame": self.fi, "id": bid, "item": item, "name": item_name(item) if item is not None else icon, "icon": icon,
                                    "x": bp[0], "y": bp[1], "d_owner": dist(op, bp), "f5": c.get("5"), "angle": r3(ang), "f5_offset": off,
                                    "owner_fields": {k: c[k] for k in ("15", "16") if k in c}, "owner_fields_present": "16" in c or "15" in c,
                                    "f16_is_owner": c.get("16") == self.owner if "16" in c else None, "def13": c.get("13"), "p": m.get("p")})

# ---------------------------------------------------------------- sections
def boss_fights(R):
    out = []
    fxby = collections.defaultdict(list)
    for r in R.fx:
        if r["boss"] is not None: fxby[r["boss"]].append(r)
    for bid, b in R.bosses.items():
        fx = fxby.get(bid, [])
        bp_first = tuple(b["pos_first"])
        effs = []
        for r in fx:
            p = (r["x"], r["y"]); bpos = r["src_pos"].get(bid) or bp_first
            effs.append({"id": r["id"], "t": r3(r["t"]), "frame": r["frame"], "kind": r["kind"], "var": r["var"], "x": r["x"], "y": r["y"],
                         "d_boss": dist(p, bpos), "d_owner": dist(p, r["owner_pos"]), "life_s": r3(r["removed_t"] - r["t"]) if r["removed_t"] is not None else None,
                         "moves": r["moves"], "end": list(r["end"]) if r["end"] else None, "src_field": "11" if r["src11"] == bid else "10", "a5": r["a5"],
                         "on": ("owner" if r["on"] == r["owner"] else r["on"]) if r["on"] is not None else None})
        cad = {}
        byk = collections.defaultdict(list)
        for e in effs: byk[e["kind"]].append(e["t"])
        for k, ts in byk.items():
            ts.sort(); groups = []
            for x in ts:
                if groups and x - groups[-1][-1] <= 0.5: groups[-1].append(x)
                else: groups.append([x])
            gi = [r3(groups[j + 1][0] - groups[j][0]) for j in range(len(groups) - 1)]
            cad[str(k)] = {"n": len(ts), "casts": len(groups), "per_cast": [len(g) for g in groups], "cast_intervals_s": gi,
                           "median_interval_s": r3(med(gi)) if gi else None, "min_interval_s": min(gi) if gi else None}
        pairs = []
        se = sorted(effs, key=lambda e: e["t"])
        for j, e2 in enumerate(se):
            best = None
            for e1 in se[:j][::-1]:
                dt = e2["t"] - e1["t"]
                if dt > 8: break
                if dt < 0.3 or e1["kind"] == e2["kind"]: continue
                d = dist((e1["x"], e1["y"]), (e2["x"], e2["y"]))
                if d is not None and d <= 60 and (best is None or d < best[1]): best = (e1, d)
            if best:
                e1 = best[0]
                pairs.append({"warn_id": e1["id"], "warn_kind": e1["kind"], "warn_var": e1["var"], "warn_life_s": e1["life_s"], "impact_id": e2["id"],
                              "impact_kind": e2["kind"], "impact_var": e2["var"], "t": e1["t"], "delay_s": r3(e2["t"] - e1["t"]), "spot_d": best[1]})
        drops = []
        for h in R.hits:
            bf = [x for x in h.get("boss_fx", []) if x["boss"] == bid]
            if not bf: continue
            n = bf[0]
            st = sorted({x["kind"] for x in bf if x["on_owner"]})
            drops.append({"t": r3(h["t"]), "frame": h["frame"], "owner": h["owner"], "dmg": h["dmg"], "hp": h["hp"], "k13": h["k13"], "class": h["class"],
                          "d_fx": n["d"], "fx_kind": n["kind"], "fx_id": n["id"], "fx_age_s": n["age"], "fx_alive": n["alive"],
                          "fx_within_150": sorted({x["kind"] for x in bf if x["d"] is not None and x["d"] <= 150 and not x["on_owner"]}), "fx_on_owner": st,
                          "d_boss": dist(h["pos"], R.pos(bid) or bp_first), "owner_pos": list(h["pos"])})
        hits = [{"t": r3(d["t"]), "frame": d["frame"], "dmg": d["dmg"], "hp_bar": d["f9"], "f11": d["f11"], "d_owner": d.get("d_owner"),
                 "owner_swing_frames": d.get("owner_swing_frames"), "owner_item": item_name(d.get("owner_item")) if isinstance(d.get("owner_item"), int) else None,
                 "by_owner": d.get("owner_swing_frames") is not None and 0 <= d["owner_swing_frames"] <= 6 and d.get("d_owner") is not None and d["d_owner"] <= 400}
                for d in R.dmg if d["id"] == bid]
        out.append({"boss_id": bid, "species": b["species"], "name": b["name"], "type": b["type"], "stage": 3, "first_t": b["first_t"],
                    "views": b["views"], "pos_first": b["pos_first"], "min_d_owner": b["min_d_owner"], "min_d_t": b["min_d_t"],
                    "states": {str(k): v for k, v in b["states"].items()}, "state_log": b["state_log"],
                    "effects": effs, "cadence": cad, "warn_impact": pairs, "owner_hp_drops": drops, "hits_on_boss": hits,
                    "counts": {"effects": len(effs), "kinds": len(byk), "warn_impact": len(pairs), "owner_hp_drops": len(drops),
                               "owner_dmg_total": sum(d["dmg"] for d in drops if isinstance(d["dmg"], int)), "hits_on_boss": len(hits),
                               "hits_on_boss_by_owner": sum(1 for x in hits if x["by_owner"])}})
    return out

def creature_hits(R):
    out = []
    for h in R.hits:
        if h["class"] not in ("creature", "ambiguous") or not h["creatures"]: continue
        c = h["creatures"][0]
        out.append({"t": r3(h["t"]), "frame": h["frame"], "owner": h["owner"], "dmg": h["dmg"], "hp": h["hp"], "k13": h["k13"], "class": h["class"],
                    "creature": c["id"], "species": c["sp"], "name": sp_name(c["sp"]), "stage": c["stage"], "type": c["type"], "d": c["d"],
                    "attack_flag_frames": c["frames"], "someones_pet": c["owned_by"], "owner_hat": hat_name(h["hat"] & 255) if isinstance(h["hat"], int) else None})
    return out

def pvp_received(R):
    out = []
    for h in R.hits:
        if h["class"] not in ("pvp", "ambiguous", "small"): continue
        c = h["cands"][0]
        hat = h["hat"] & 255 if isinstance(h["hat"], int) else None
        ah = c["hat"]
        out.append({"t": r3(h["t"]), "frame": h["frame"], "owner": h["owner"], "attacker": c["id"], "item": c["item"], "item_name": item_name(c["item"]) if isinstance(c["item"], int) else None,
                    "dmg": h["dmg"], "hp_prev": h["hp_prev"], "hp": h["hp"], "d": c["d"], "swing_to_hit_frames": c["frames"],
                    "owner_hat": hat_name(hat) if hat is not None else None, "attacker_hat": hat_name(ah & 255) if isinstance(ah, int) else None,
                    "attacker_wing": (ah >> 8) if isinstance(ah, int) else None, "class": h["class"], "other_players": len(h["cands"]) - 1})
    return out

def pet_casts(R):
    out = []
    for c in R.casts:
        I = c["pet"]; t0 = c["t"]
        fx = [r for r in R.fx if (r["src10"] == I or r["src11"] == I) and t0 - 0.2 <= r["t"] <= t0 + 6]
        hits = []
        if fx:
            tf = min(r["t"] for r in fx)
            for d in R.dmg:
                if d["t"] < tf or d["t"] > t0 + 8 or d["id"] in (I, R.owner): continue
                dd = [x for x in (dist((d["x"], d["y"]), (r["x"], r["y"])) for r in fx) if x is not None] + \
                     [x for x in (dist((d["x"], d["y"]), r["end"]) for r in fx if r["end"]) if x is not None]
                if not dd or min(dd) > 400: continue
                hits.append({"t_after_fx": r3(d["t"] - tf), "target": d["id"], "cat": d["cat"], "species": sp_name(d["sp"]) if d["cat"] == 0 else None,
                             "dmg": d["dmg"], "d_fx": min(dd), "f11": d["f11"], "f13": d["f13"]})
        out.append({"t": t0, "frame": c["frame"], "pet": I, "species": c["species"], "name": sp_name(c["species"]), "stage": c["stage"], "aim": c["aim"],
                    "effects": [{"id": r["id"], "dt": r3(r["t"] - t0), "kind": r["kind"], "var": r["var"], "d_pet": dist((r["x"], r["y"]), c["pet_pos"]),
                                 "d_aim": dist((r["x"], r["y"]), c["aim"]) if c["aim"] else None,
                                 "life_s": r3(r["removed_t"] - r["t"]) if r["removed_t"] is not None else None, "moves": r["moves"]} for r in fx],
                    "hits": hits, "pet_in_view": c["species"] is not None})
    return out

def buildings(R):
    refusals = []
    for p in R.presses:
        ok = any(-0.3 <= q["t"] - p["t"] <= 2.0 for q in R.places)
        if not ok and p["t"] < R.tlast - 2:
            refusals.append({"t": r3(p["t"]), "item": p["item"], "name": item_name(p["item"]), "owner_pos": list(p["pos"]) if p["pos"] else None})
    return {"placed": R.places, "refusals": refusals, "presses": len(R.presses)}

def cosmetics(R):
    worn = []
    for j, w in enumerate(R.worn):
        end = R.worn[j + 1]["t"] if j + 1 < len(R.worn) else r3(R.tlast)
        worn.append({"t": w["t"], "until": end, "hat": w["v"] & 255, "hat_name": hat_name(w["v"] & 255), "wing": w["v"] >> 8, "wing_name": wing_name(w["v"] >> 8), "owner": w["owner"]})
    return {"worn": worn, "shop": R.shop}

def deaths(R):
    return R.deaths

SECTIONS = [("boss_fights", boss_fights), ("creature_hits", creature_hits), ("pvp_received", pvp_received), ("pet_casts", pet_casts),
            ("buildings", buildings), ("cosmetics", cosmetics), ("deaths", deaths)]

def tag_of(path): return os.path.basename(path).replace(".v2.jsonl", "")

def extract(path, opmaps):
    key = open(path.replace(".v2.jsonl", ".key")).read().strip()
    tm = json.load(open(os.path.join(DECODER, "typemap_%s.json" % key)))
    R = Replay(path, key, tm, opmaps.get(key)).run()
    doc = {"tag": tag_of(path), "kind": "scan" if "/scans_dec/" in path else "human", "file": path, "server": key, "version": VERSION,
           "t0": R.t0, "frames": R.fi + 1, "duration_s": r3(R.tlast), "owners": R.owners, "pets": sorted(R.pets),
           "hits_on_owner": len(R.hits), "hit_classes": dict(collections.Counter(h["class"] for h in R.hits)),
           "tx": R.have_tx, "op_table": R.have_ops, "tx_ops": sum(v for k, v in R.stat.items() if k.startswith("op_") and k != "op_unknown"),
           "tx_ops_unknown": R.stat["op_unknown"], "skipped": {}, "counts": {}}
    for name, fn in SECTIONS:
        why = None
        if R.owner is None and name not in ("boss_fights",): why = "owner never resolved"
        elif name == "pet_casts" and not R.have_tx: why = "no tx frames"
        elif name == "buildings" and not R.have_tx and not R.places: why = "no tx frames and no placements"
        if why: doc["skipped"][name] = why; continue
        try:
            doc[name] = fn(R)
        except Exception as e:
            doc["skipped"][name] = "error: %s" % e; traceback.print_exc()
            continue
        v = doc[name]
        if name == "buildings":
            doc["counts"][name] = {"placed": len(v["placed"]), "refusals": len(v["refusals"])}
            if not R.have_ops: doc["skipped"]["buildings.refusals"] = "no op table for %s" % key
        elif name == "cosmetics":
            doc["counts"][name] = {"worn": len(v["worn"]), "shop": len(v["shop"])}
            if not R.have_ops: doc["skipped"]["cosmetics.shop"] = "no op table for %s" % key
        elif name == "boss_fights":
            doc["counts"][name] = {"bosses": len(v), "effects": sum(b["counts"]["effects"] for b in v), "owner_hp_drops": sum(b["counts"]["owner_hp_drops"] for b in v)}
        else:
            doc["counts"][name] = len(v)
    return doc

# ---------------------------------------------------------------- aggregate
class Agg:
    def __init__(self): self.F = {}
    def add(self, key, tag, t, **vals):
        f = self.F.setdefault(key, {"count": 0, "values": collections.defaultdict(list), "sources": collections.defaultdict(list)})
        f["count"] += 1
        for k, v in vals.items():
            if v is None: continue
            if isinstance(v, list): v = json.dumps(v)
            f["values"][k].append(v)
        f["sources"][tag].append(t)
    def done(self):
        out = {}
        for key in sorted(self.F):
            f = self.F[key]; vals = {}
            for k, xs in f["values"].items():
                c = collections.Counter(xs)
                if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in xs):
                    vals[k] = {"n": len(xs), "min": min(xs), "median": r3(med(xs)), "max": max(xs), "top": [[v, n] for v, n in c.most_common(12)]}
                else:
                    vals[k] = {"n": len(xs), "top": [[v, n] for v, n in c.most_common(20)]}
            src = {tg: sorted(r3(t) for t in ts if t is not None)[:60] for tg, ts in f["sources"].items()}
            out[key] = {"count": f["count"], "values": vals, "sources": src, "source_count": {tg: len(ts) for tg, ts in f["sources"].items()}}
        return out

def aggregate(docs):
    A = Agg(); idx = {}
    for d in docs:
        tag = d["tag"]
        idx[tag] = {"kind": d["kind"], "server": d["server"], "t0": d["t0"], "duration_s": d["duration_s"], "counts": d["counts"], "skipped": d["skipped"]}
        for b in d.get("boss_fights", []):
            nm = b["name"]
            A.add("boss_seen|%s" % nm, tag, b["first_t"], type=b["type"], min_d_owner=b["min_d_owner"], effects=b["counts"]["effects"])
            for e in b["effects"]:
                A.add("boss_effect|%s|kind %s" % (nm, e["kind"]), tag, e["t"], var=e["var"], life_s=e["life_s"], d_boss=e["d_boss"], d_owner=e["d_owner"], moves=e["moves"])
            for k, c in b["cadence"].items():
                for x in c["cast_intervals_s"]: A.add("boss_cadence|%s|kind %s" % (nm, k), tag, None, interval_s=x)
                for x in c["per_cast"]: A.add("boss_per_cast|%s|kind %s" % (nm, k), tag, None, n=x)
            for p in b["warn_impact"]:
                A.add("boss_warn_impact|%s|%s->%s" % (nm, p["warn_kind"], p["impact_kind"]), tag, p["t"], delay_s=p["delay_s"], spot_d=p["spot_d"], impact_var=p["impact_var"])
            for h in b["owner_hp_drops"]:
                A.add("boss_hit_owner|%s|near kind %s" % (nm, h["fx_kind"]), tag, h["t"], dmg=h["dmg"], d_fx=h["d_fx"], d_boss=h["d_boss"], fx_age_s=h["fx_age_s"], k13=h["k13"])
            for h in b["hits_on_boss"]:
                A.add("boss_hit_by_%s|%s" % ("owner" if h["by_owner"] else "anyone", nm), tag, h["t"], dmg=h["dmg"], hp_bar=h["hp_bar"], owner_item=h["owner_item"], d_owner=h["d_owner"])
            for s, n in b["states"].items(): A.add("boss_state|%s|%s" % (nm, s), tag, None, n=n)
        for h in d.get("creature_hits", []):
            A.add("creature_hit|%s|stage %s" % (h["name"], h["stage"]), tag, h["t"], dmg=h["dmg"], d=h["d"], k13=h["k13"], owner_hat=h["owner_hat"], someones_pet=h["someones_pet"] is not None)
        for h in d.get("pvp_received", []):
            A.add("pvp_hit|%s|%s" % (h["item_name"], h["owner_hat"]), tag, h["t"], dmg=h["dmg"], d=h["d"], swing_to_hit_frames=h["swing_to_hit_frames"], cls=h["class"])
        for c in d.get("pet_casts", []):
            A.add("pet_cast|%s" % c["name"], tag, c["t"], stage=c["stage"], effects=len(c["effects"]), kinds=sorted({e["kind"] for e in c["effects"]}),
                  life_s=c["effects"][0]["life_s"] if c["effects"] else None, dt=c["effects"][0]["dt"] if c["effects"] else None, hits=len(c["hits"]))
            for h in c["hits"]: A.add("pet_cast_hit|%s|%s" % (c["name"], "creature" if h["cat"] == 0 else "player" if h["cat"] == 1 else "structure"), tag, c["t"],
                                      dmg=h["dmg"], t_after_fx=h["t_after_fx"], d_fx=h["d_fx"])
        bl = d.get("buildings") or {}
        for p in bl.get("placed", []):
            A.add("building|%s" % p["name"], tag, p["t"], d_owner=p["d_owner"], f5_offset=p["f5_offset"], owner_fields_present=p["owner_fields_present"], f16_is_owner=p["f16_is_owner"])
        for p in bl.get("refusals", []): A.add("building_refusal|%s" % p["name"], tag, p["t"])
        cs = d.get("cosmetics") or {}
        for w in cs.get("worn", []):
            A.add("worn_hat|%s" % w["hat_name"], tag, w["t"], seconds=r3(w["until"] - w["t"]) if w["until"] is not None else None)
            if w["wing"]: A.add("worn_wing|%s" % w["wing_name"], tag, w["t"], seconds=r3(w["until"] - w["t"]) if w["until"] is not None else None)
        for s in cs.get("shop", []): A.add("shop|%s|cat %s|%s" % (s["op"], s["category"], s["name"] or s["id"]), tag, s["t"])
        for x in d.get("deaths", []):
            kn = "player" if x["killer_kind"] == 1 else "kind %s" % x["killer_kind"]
            A.add("death|%s" % kn, tag, x["t_hp0"] if x["t_hp0"] is not None else x["t_screen"], alive_ms=x["alive_ms"], dmg_last5s=sum(h["dmg"] for h in x["last5s"] if isinstance(h["dmg"], int)),
                  hits_last5s=len(x["last5s"]), screen_delay_s=r3(x["t_screen"] - x["t_hp0"]) if x["t_hp0"] is not None else None,
                  last_class=x["last5s"][-1]["class"] if x["last5s"] else None)
    return {"note": "recorded game facts aggregated over every human session and boss-near scan (tools/scan/session_facts.py); "
                    "per fact: count, value summaries, source tags with t = seconds since that file's first rx frame (raw ts = sessions[tag].t0 + t). "
                    "Data only: the clone does not read it yet.",
            "generated": time.strftime("%Y-%m-%d %H:%M"), "version": VERSION, "sessions": idx, "facts": A.done()}

# ---------------------------------------------------------------- driver
def default_files():
    hs = sorted(glob.glob(os.path.join(HUMAN, "*_human.v2.jsonl")))
    ss = sorted(glob.glob(os.path.join(SCANS_DEC, "*nearboss*.v2.jsonl")))
    return [f for f in hs + ss if os.path.exists(f.replace(".v2.jsonl", ".key"))]

def update(files=None, force=False, log=None):
    """rebuild missing / stale per-session files, then the aggregate; returns a summary dict"""
    os.makedirs(OUTDIR, exist_ok=True)
    files = default_files() if files is None else [f for f in files if os.path.exists(f) and os.path.exists(f.replace(".v2.jsonl", ".key"))]
    todo = []
    for f in files:
        o = os.path.join(OUTDIR, tag_of(f) + ".json")
        if force or not os.path.exists(o) or os.path.getmtime(o) < max(os.path.getmtime(f), os.path.getmtime(os.path.abspath(__file__))) \
                or _load(o, {}).get("version") != VERSION: todo.append(f)
    keys = set()
    for f in todo:
        try: keys.add(open(f.replace(".v2.jsonl", ".key")).read().strip())
        except Exception: pass
    opmaps = op_tables(sorted(keys)) if todo else {}
    built, failed = [], []
    for f in todo:
        t1 = time.time()
        try:
            d = extract(f, opmaps)
            tmp = os.path.join(OUTDIR, tag_of(f) + ".json.tmp")
            json.dump(d, open(tmp, "w"), ensure_ascii=False); os.replace(tmp, os.path.join(OUTDIR, tag_of(f) + ".json"))
            built.append(tag_of(f))
            if log: log("%s %.1fs %s" % (tag_of(f), time.time() - t1, json.dumps(d["counts"])))
        except Exception as e:
            failed.append((tag_of(f), str(e)[:200]))
            if log: log("FAILED %s: %s" % (tag_of(f), e))
            traceback.print_exc()
    docs = []
    for p in sorted(glob.glob(os.path.join(OUTDIR, "*.json"))):
        if os.path.basename(p) == "op_tables.json": continue
        d = _load(p, None)
        if isinstance(d, dict) and d.get("tag") and "counts" in d: docs.append(d)
    agg = aggregate(docs)
    tmp = AGG + ".tmp"; json.dump(agg, open(tmp, "w"), ensure_ascii=False); os.replace(tmp, AGG)
    tot = collections.Counter()
    for d in docs:
        for k, v in d["counts"].items():
            if isinstance(v, dict):
                for k2, v2 in v.items(): tot["%s.%s" % (k, k2)] += v2
            else: tot[k] += v
    return {"sessions": len(docs), "built": built, "failed": failed, "facts": len(agg["facts"]), "totals": dict(tot)}

def summary_line(s):
    t = s["totals"]
    return ("Session facts: %d sessions (%d rebuilt, %d failed), %d facts; boss fights %d (%d effects, %d owner hp drops), creature hits %d, pvp %d, "
            "pet casts %d, buildings %d (+%d refusals), hats worn %d, shop ops %d, deaths %d." % (
                s["sessions"], len(s["built"]), len(s["failed"]), s["facts"], t.get("boss_fights.bosses", 0), t.get("boss_fights.effects", 0),
                t.get("boss_fights.owner_hp_drops", 0), t.get("creature_hits", 0), t.get("pvp_received", 0), t.get("pet_casts", 0),
                t.get("buildings.placed", 0), t.get("buildings.refusals", 0), t.get("cosmetics.worn", 0), t.get("cosmetics.shop", 0), t.get("deaths", 0)))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("files", nargs="*"); ap.add_argument("--force", action="store_true")
    A = ap.parse_args()
    s = update(A.files or None, A.force or bool(A.files), log=print)
    print(summary_line(s))
    for tg, e in s["failed"]: print("failed", tg, e)

if __name__ == "__main__":
    main()
