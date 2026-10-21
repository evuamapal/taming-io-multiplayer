# Re-verification of v0.3 "not observed / guess" claims against the SP5 capture.
# Usage: python3 tools/sp3/reverify.py [section ...]  -> work/v03_reverify.json (merged per section)
import json, math, os, sys, collections, bisect
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import load_rows, t0_of, NAMES, REPO, dval

ITEMS = json.load(open(os.path.join(REPO, "mimic", "data", "items.json")))
OUT = os.path.join(REPO, "work", "v03_reverify.json")
STRUCT = ("spike", "wall", "door", "turret", "pad", "windmill", "tower", "totem", "trap")
PAD_DEFS = {i for i, n in enumerate(NAMES) if isinstance(n, str) and "pad" in n}
ROWS = load_rows(); T0 = t0_of(ROWS); TFIRST = ROWS[0]["w"]
RX = [r for r in ROWS if r["k"] == "rx"]

def iname(i):
    v = ITEMS.get(str(i)); return v["name"] if v else str(i)
def dname(d):
    return NAMES[d] if isinstance(d, int) and 0 <= d < len(NAMES) else None
def dist(a, b, c, d):
    return math.hypot(a - c, b - d)
def rnd(v, k=1):
    return round(v, k) if isinstance(v, float) else v
def med(v):
    v = sorted(v); return v[len(v) // 2] if v else None
def kind_of(e):
    if e.cat == 1: return "player"
    if e.cat == 3:
        n = e.name or ""
        if n.startswith("gift"): return "gift"
        return "struct" if any(s in n for s in STRUCT) else "resource"
    if e.cat == 0: return "pet" if (e.f.get("13") or 0) > 1000 else "creature"
    return "other"

LIVES = []
for r in RX:
    for m in r["m"]:
        if m.get("_a") == 59 and "na" in m:
            LIVES.append({"own": m["i"] - 1, "pet": m["i"], "t": rnd(r["w"] - T0, 2), "row": r["i"]})
OWNS = {l["own"] for l in LIVES}; PETS = {l["pet"] for l in LIVES}
PET_OF = {l["own"]: l["pet"] for l in LIVES}; OWN_OF = {l["pet"]: l["own"] for l in LIVES}

class Ent:
    __slots__ = ("id", "cat", "x", "y", "d", "name", "f", "s", "born")

def replay():
    # yields (n, t, row, recs, ents); rec = (id, a, m, e, px, py)
    ents = {}
    for n, r in enumerate(RX):
        t = r["w"] - T0; recs = []
        for m in r["m"]:
            a = m.get("_a"); i = m.get("0")
            if a == 79:
                e = Ent(); e.id = i; e.cat = m.get("2"); e.x = m.get("3"); e.y = m.get("4"); e.d = m.get("13")
                e.name = dname(e.d) if e.cat == 3 else None; e.f = dict(m); e.s = dict(m); e.born = t
                ents[i] = e; recs.append((i, a, m, e, None, None))
            elif a == 84:
                e = ents.get(i)
                if e is None: continue
                px, py = e.x, e.y
                for k, at in (("3", "x"), ("4", "y")):
                    if k in m:
                        v = m[k]
                        if v >= 256: setattr(e, at, v)
                        elif getattr(e, at) is not None: setattr(e, at, getattr(e, at) + dval(v))
                for k, v in m.items():
                    if not k.startswith("_") and k not in ("0", "1", "3", "4"): e.s[k] = v
                recs.append((i, a, m, e, px, py))
            elif a == 87:
                e = ents.pop(i, None)
                recs.append((i, a, m, e, None, None))
            else:
                recs.append((None, a, m, None, None, None))
        yield n, t, r["i"], recs, ents

RES = {}
if os.path.exists(OUT):
    try: RES = json.load(open(OUT))
    except Exception: RES = {}

# ------------------------------------------------------------------ 1. decoding check + fast steps + pads
def sec_moves():
    out = {}
    # resync error of tracked position vs next absolute value, per delta convention
    conv = {"sign_magnitude (bit7 set = plus)": dval, "raw byte as delta": lambda v: v, "twos complement": lambda v: v - 256 if v >= 128 else v}
    chk = {}
    for nm, f in conv.items():
        pos = {}; errs = []
        for r in RX:
            for m in r["m"]:
                if m.get("_a") == 79: pos[m["0"]] = [m.get("3"), m.get("4")]; continue
                if m.get("_a") != 84 or m.get("0") not in pos: continue
                p = pos[m["0"]]
                for j, k in enumerate(("3", "4")):
                    if k in m and p[j] is not None:
                        v = m[k]
                        if v >= 256: errs.append(abs(v - p[j])); p[j] = v
                        else: p[j] += f(v)
        errs.sort()
        chk[nm] = {"resyncs": len(errs), "median_err": errs[len(errs) // 2], "p90_err": errs[int(len(errs) * .9)]}
    out["delta_convention_check"] = chk
    # the disputed claim: raw byte values 128..131 on the pet record at the cited times (time base = first capture row)
    cited = [37.8, 42.1, 50.6, 53.5, 55.5, 55.8, 58.5, 59.0, 68.8]
    hits = []; naive = 0
    for r in RX:
        tf = round(r["w"] - TFIRST, 1)
        for m in r["m"]:
            if m.get("0") == 4972447 and m.get("_a") == 84:
                vs = [m[k] for k in ("3", "4") if k in m and m[k] < 256]
                if any(v > 70 for v in vs): naive += 1
                if tf in cited and any(128 <= v <= 131 for v in vs): hits.append([r["i"], tf, rnd(r["w"] - T0, 2), m.get("3"), m.get("4")])
    out["owner_claim_check"] = {"entity_4972447": "own pet of life 1 (create cat 0, field 13 = owner 4972446); the player is 4972446 (create cat 1, camera id (v-2)/256)",
                                "pet_records_with_raw_delta_byte_over_70": naive, "cited_times_first_row_base_rows_with_byte_128_131": hits[:12], "n_cited_hits": len(hits),
                                "time_base_offset_s": rnd(T0 - TFIRST, 2),
                                "reading": "byte 128..131 = +0..+3 units (sign-magnitude); the 128-131 'units' were raw bytes, not displacement"}
    # fast steps of own players and own pets
    pads = {}; padnear = {}; fast = []; chain = {}; f16 = {}; lastdmg = collections.defaultdict(lambda: -99)
    stepn = collections.defaultdict(int); pet_hist = collections.Counter(); own_hist = collections.Counter()
    for n, t, row, recs, ents in replay():
        for i, a, m, e, px, py in recs:
            if a == 79 and e.cat == 3 and e.d in PAD_DEFS:
                pads[i] = {"id": i, "def": e.name, "x": e.x, "y": e.y, "a5": m.get("5"), "t": rnd(t, 2), "row": row, "f": {k: v for k, v in m.items() if not k.startswith("_")}}
            if a == 87 and i in pads: pads[i]["removed_t"] = rnd(t, 2)
            if i is None or (i not in OWNS and i not in PETS): continue
            if a == 84 and ("10" in m or "11" in m): lastdmg[i] = n
            if i in OWNS and a == 84 and "16" in m:
                if f16.get(i, 0) != m["16"]: fast.append({"t": rnd(t, 2), "row": row, "id": i, "who": "player", "event": "field16 %s -> %s" % (f16.get(i, 0), m["16"])})
                f16[i] = m["16"]
            if a != 84 or px is None or py is None or e.x is None: continue
            for p in pads.values():
                if "removed_t" not in p and dist(px, py, p["x"], p["y"]) < 100: padnear[i] = (n, "pad %s %s at %d" % (p["id"], p["def"], dist(px, py, p["x"], p["y"])))
            s = dist(e.x, e.y, px, py)
            who = "player" if i in OWNS else "pet"
            (own_hist if who == "player" else pet_hist)[int(s // 10) * 10 if s < 200 else 200] += 1
            lim = 47 if who == "player" else 40
            if s <= lim: chain.pop(i, None); continue
            c = None; why = ""
            if s > 600: c = "teleport/respawn"
            if c is None and chain.get(i) == "boost_pad": c = "boost_pad"; why = "continues pad push"
            if c is None and n - padnear.get(i, (-99, ""))[0] <= 3: c = "boost_pad"; why = padnear[i][1]
            own = i if who == "player" else OWN_OF[i]; pet = PET_OF[own]
            if c is None and f16.get(own, 0):
                o = ents.get(own); pe = ents.get(pet)
                if o and pe and o.x is not None and pe.x is not None and dist(o.x, o.y, pe.x, pe.y) < 5:
                    c = "riding"; why = "owner and pet same position"
                    if n - lastdmg[pet] <= 2 or n - lastdmg[own] <= 2: c = "riding+knockback"; why += ", hit (10/11) on rider or mount <= 2 frames"
            if c is None and n - lastdmg[i] <= 2: c = "knockback"; why = "own 10/11 hit record <= 2 frames"
            if c is None and who == "player" and "16" in m: c = "mount_snap"; why = "field 16 set in this record"
            if c is None and who == "pet":
                o = ents.get(own)
                if o and o.x is not None and dist(o.x, o.y, e.x, e.y) > 250: c = "pet_catch_up"; why = "owner %d away" % dist(o.x, o.y, e.x, e.y)
            if c is None and i in chain: c = chain[i]; why = "continues previous fast step"
            if c is None: c = "other"
            chain[i] = c
            fast.append({"t": rnd(t, 2), "row": row, "id": i, "who": who, "step": rnd(s), "dx": e.x - px, "dy": e.y - py, "class": c, "why": why})
    steps = [f for f in fast if "step" in f]
    out["fast_steps"] = {"thresholds": {"player": 47, "pet": 40}, "count": len(steps),
                         "by_class": dict(collections.Counter((f["who"], f["class"]) for f in steps).most_common()) if False else
                         {"%s/%s" % k: v for k, v in collections.Counter((f["who"], f["class"]) for f in steps).most_common()},
                         "over_70": [f for f in steps if f["step"] > 70], "field16_events": [f for f in fast if "event" in f],
                         "all": steps,
                         "player_step_hist": dict(sorted(own_hist.items())), "pet_step_hist": dict(sorted(pet_hist.items()))}
    out["pads_seen"] = list(pads.values())
    return out

# ------------------------------------------------------------------ 1b. pad push profile
def sec_pads():
    pads = {p["id"]: p for p in RES["moves"]["pads_seen"]}
    out = {"pads": []}
    for pid, p in pads.items():
        near = collections.defaultdict(list)
        for n, t, row, recs, ents in replay():
            if t < p["t"] - 1 or t > p.get("removed_t", 1e9) + 3: continue
            for i, a, m, e, px, py in recs:
                if i == pid and a == 84 and any(k in m for k in ("7", "8", "9", "10")):
                    near["_pad"].append([row, rnd(t, 2), {k: v for k, v in m.items() if not k.startswith("_") and k not in ("0", "1")}])
                if e is None or a != 84 or e.cat not in (0, 1) or px is None or e.x is None: continue
                d0 = dist(px, py, p["x"], p["y"])
                if d0 < 300 or (near[i] and t - near[i][-1][1] < 1.5):
                    near[i].append([row, rnd(t, 2), round(d0), e.x - px, e.y - py, rnd(dist(e.x, e.y, px, py)), kind_of(e)])
        pushes = []
        for i, tr in near.items():
            if i == "_pad": continue
            for j, s in enumerate(tr):
                if s[5] > 60 and s[2] < 110 and (j == 0 or tr[j - 1][5] <= 60):
                    seq = [x for x in tr[j:j + 6]]
                    pre = tr[max(0, j - 3):j]
                    pushes.append({"ent": i, "kind": s[6], "row": s[0], "t": s[1], "d_before": s[2], "approach": [[x[2], x[5]] for x in pre],
                                   "steps": [[x[3], x[4], x[5]] for x in seq], "dir_deg": rnd(math.degrees(math.atan2(s[4], s[3])) % 360)})
        closest = {str(i): min(x[2] for x in tr) for i, tr in near.items() if i != "_pad" and tr}
        kinds = {str(i): tr[0][6] for i, tr in near.items() if i != "_pad" and tr}
        a5 = p["a5"]
        out["pads"].append({"pad": p, "facing_deg_from_5": rnd(math.degrees(a5 / 100.0) % 360), "pushes": pushes, "pad_records": near["_pad"],
                            "closest_approach": closest, "kinds": kinds})
    return out

SECTIONS = {"moves": sec_moves, "pads": sec_pads}

# ------------------------------------------------------------------ 2. damage per held item (own swings)
def sec_damage():
    held = {}; swings = collections.defaultdict(list); hits = []; last7 = {}; petpos = {}
    for n, t, row, recs, ents in replay():
        for i, a, m, e, px, py in recs:
            if e is None: continue
            if a == 79 and e.cat == 3: last7[i] = m.get("7", 255)
            if a == 79 and e.cat == 1 and "8" in m: held[i] = m["8"]
            if a != 84: continue
            if e.cat == 1 and "8" in m: held[i] = m["8"]
            if e.cat == 1 and "15" in m: swings[n].append((i, e.x, e.y, held.get(i, 0), m["15"]))
            d = None
            if "10" in m and e.cat in (0, 1): d = m["10"]
            if "7" in m and e.cat == 3:
                p = last7.get(i, 255)
                if m["7"] < p and m.get("9"): d = p - m["7"]
                last7[i] = m["7"]
            if d is not None and e.x is not None:
                hits.append((n, t, row, i, kind_of(e), e.name if e.cat == 3 else "k%s" % e.f.get("22"), e.x, e.y, d, {k: v for k, v in m.items() if k in ("9", "11", "12", "13")}))
        for p in PETS:
            pe = ents.get(p)
            if pe is not None and pe.x is not None: petpos[n] = (pe.x, pe.y)
    tab = collections.defaultdict(list)
    for n, t, row, i, kind, name, x, y, d, extra in hits:
        if i in OWNS or kind == "resource": continue
        cands = []
        for k in range(n - 3, n + 1):
            for sid, sx, sy, h, f15 in swings.get(k, []):
                if sid != i and sx is not None and dist(x, y, sx, sy) < 260: cands.append((sid, h, dist(x, y, sx, sy), n - k))
        ion = [c for c in cands if c[0] in OWNS]
        if not ion: continue
        other = [c for c in cands if c[0] not in OWNS]
        pp = petpos.get(n)
        petnear = i not in PETS and pp is not None and dist(pp[0], pp[1], x, y) < 220 and kind != "struct" and kind != "gift"
        if kind == "pet" and i in PETS: kind = "own_pet"
        clean = not other and not petnear
        h = iname(ion[0][1])
        tab[(kind, h, clean)].append({"dmg": d, "row": row, "t": rnd(t, 2), "target": i, "name": name, "dist": round(ion[0][2]), "lag": ion[0][3], "extra": extra})
    out = {"method": "own player swing (own record 15) in frames n-3..n, held = own record 8 (server); target = record with 10 (players/creatures, damage this frame) or a 7 drop with 9 set (structures, hp byte step) within 260 of the swinger; clean = no other player swung within 260 in that window and own pet > 220 from the target", "table": []}
    for (kind, h, clean), v in sorted(tab.items()):
        c = collections.Counter(x["dmg"] for x in v)
        out["table"].append({"target": kind, "item": h, "clean": clean, "n": len(v), "mode": c.most_common(1)[0][0], "values": c.most_common(8),
                             "rows": [x["row"] for x in v][:10], "names": sorted({str(x["name"]) for x in v})[:6], "h11": dict(collections.Counter(str(x["extra"].get("11")) for x in v))})
    by = collections.defaultdict(list)
    for (kind, h, clean), v in tab.items():
        if clean or kind == "struct":
            for x in v: by["%s|%s|%s" % (kind, h, x["name"])].append(x["dmg"])
    out["by_target_name"] = {k: {"n": len(v), "values": collections.Counter(v).most_common(5)} for k, v in sorted(by.items())}
    return out
SECTIONS["damage"] = sec_damage
# ------------------------------------------------------------------ 3. the other suspect lines
def own_of(ents):
    o = [ents[i] for i in OWNS if i in ents and ents[i].x is not None]
    return o[0] if o else None

def sec_rest():
    out = {}
    inv = None; invd = []; xp = None; xpd = []; cnt = []; lastswing = -99; eat = -99; hp = {}; regen = []
    kills_near = {}; spawn10 = []; gifts = {}; gift_spawn = []; gopen = []; shots = []; dm = []; heal = []; last7 = {}
    doors = {}; door_ev = []; marks = []; ion_path = []; jv = []; spawns = []; pclose = []; pf = collections.defaultdict(lambda: collections.defaultdict(set))
    windmill_t = None; tot = []
    for n, t, row, recs, ents in replay():
        o = own_of(ents)
        if o is not None and n % 5 == 0: ion_path.append((t, o.x, o.y))
        for i, a, m, e, px, py in recs:
            if a == 53:
                if inv is not None:
                    dd = {k: m["i"][k] - inv.get(k, 0) for k in m["i"] if m["i"][k] != inv.get(k, 0)}
                    if dd: invd.append((n, t, row, dd, n - lastswing))
                inv = dict(m["i"])
            if a == 27:
                if xp is not None and m["i"] != xp: xpd.append((n, t, row, m["i"] - xp))
                xp = m["i"]
            if a == 37: cnt.append((n, t, row, m.get("n"), m.get("o")))
            if a in (80, 65): marks.append((row, t, a, m["o"] * 176, m["j"] * 176))
            if a in (11, 86, 44, 58, 31): jv.append([row, rnd(t, 1), a, {k: v for k, v in m.items() if k not in ("1", "_a")}])
            if a == 52: tot.append([row, rnd(t, 1), m.get("m")])
            if a == 81 and any("windmill" in str(x[-1]) for x in m.get("o") or []): windmill_t = t
            if e is None: continue
            if a == 79 and e.cat == 3 and e.name and "totem" in e.name: tot.append([row, rnd(t, 1), "create " + e.name])
            if i in OWNS and a == 84:
                if "15" in m: lastswing = n
                if m.get("15") == 350: eat = t
                if "12" in m:
                    if i in hp and m["12"] > hp[i] and "11" not in m and t - eat > 8: regen.append((row, rnd(t, 1), hp[i], m["12"]))
                    hp[i] = m["12"]
            if a == 79 and i in OWNS: spawns.append([row, rnd(t, 1), e.x, e.y])
            if a == 79 and e.cat == 1 and i not in OWNS:
                for k in ("17", "21", "22", "23"): pf[k][str(m.get("18"))].add(m.get(k))
            if a == 79 and e.cat == 0 and m.get("7") == 10 and not (e.f.get("13") or 0) > 1000:
                spawn10.append([row, rnd(t, 1), i, m.get("21"), m.get("23"), e.x, e.y])
            if a == 79 and e.cat == 3 and e.name and e.name.startswith("gift"):
                gifts[i] = e
                if m.get("11") == 1: gift_spawn.append([row, rnd(t, 1), e.name, e.x, e.y])
            if a == 84 and i in gifts and m.get("7") == 0: gopen.append((n, t, row, i, e.name, e.x, e.y))
            if a == 79 and e.cat == 3: last7[i] = m.get("7", 255)
            if a == 84 and e.cat == 3 and "7" in m:
                p = last7.get(i, 255)
                if m["7"] > p and e.name and any(s in e.name for s in STRUCT): heal.append([row, rnd(t, 2), i, e.name, e.x, e.y, m["7"] - p])
                last7[i] = m["7"]
            if e.cat == 3 and e.name and "turret" in e.name and a == 84 and m.get("9") == 17: shots.append((n, t, row, i, e.name, e.x, e.y))
            if a == 84 and "10" in m and e.cat in (0, 1) and e.x is not None: dm.append((n, t, row, i, e.cat, m["10"], m.get("11"), e.x, e.y))
            if a == 79 and e.cat == 0 and e.f.get("13", 0) and not (e.f.get("13") or 0) > 1000: pass
            if a == 79 and e.cat == 3 and e.name and "door" in e.name: doors[i] = (e.x, e.y, m.get("15"), m.get("16"))
            if i in doors and a == 84 and m.get("9") in (18, 19):
                pl = sorted((round(dist(p.x, p.y, e.x, e.y)), pid, p.s.get("14")) for pid, p in ents.items() if p.cat == 1 and p.x is not None)[:2]
                door_ev.append([row, rnd(t, 2), i, m["9"], pl])
            if a == 87 and e.cat == 0 and o is not None and e.x is not None and dist(e.x, e.y, o.x, o.y) < 700:
                kills_near[i] = (t, e.f.get("21"), e.f.get("23"), e.s.get("9"))
        if o is not None:
            for pid, p in ents.items():
                if p.cat == 1 and pid not in OWNS and p.x is not None and dist(o.x, o.y, p.x, p.y) < 60: pclose.append(round(dist(o.x, o.y, p.x, p.y)))
    # kills: counter 37 n 1 (animal) / 2 (boss) and the same-frame xp + inventory delta; victim = bar-0 creature removed within 2 s
    ks = []
    for n, t, row, cn, co in cnt:
        if cn not in (1, 2): continue
        x = [d[3] for d in xpd if d[0] == n]; iv = [d[3] for d in invd if d[0] == n]
        vic = [(k, v) for k, v in kills_near.items() if 0 <= v[0] - t <= 2 and v[3] == 0]
        ks.append({"row": row, "t": rnd(t, 2), "counter": cn, "xp": x[0] if x else None, "inv": iv[0] if iv else None,
                   "victim_species21": vic[0][1][1] if vic else None, "victim_field23": vic[0][1][2] if vic else None})
    xp_by23 = collections.defaultdict(list)
    for k in ks:
        if k["victim_field23"] is not None: xp_by23[k["victim_field23"]].append(k["xp"])
    out["kills"] = {"events": ks, "xp_by_field23": {str(k): v for k, v in sorted(xp_by23.items())}, "slots": "inventory slots 0 food, 1 wood, 2 stone, 3 gold"}
    out["creature_spawns"] = {"create_with_7_10": spawn10, "note": "fresh spawns (7 = 10) come in same-species groups; no create at a kill spot after a kill"}
    # windmill: gold ticks without own swing after the windmill was placed
    if windmill_t:
        tk = [d for d in invd if d[1] > windmill_t and d[3] == {"3": 10} and d[4] > 4]
        iv = [round(b[1] - a[1], 2) for a, b in zip(tk, tk[1:]) if b[1] - a[1] < 14]
        out["windmill"] = {"placed_t": rnd(windmill_t, 1), "ticks": len(tk), "gold_per_tick": 10, "interval_median_s": med(iv), "interval_range": [min(iv), max(iv)], "rows": [d[2] for d in tk[:8]]}
    # repair: structure hp byte rises with a category-4 kind-1 effect nearby
    out["repair"] = {"heals": heal}
    # turrets: first damage record with 11 = 3 within 12 frames and 700 of the shot
    tt = collections.defaultdict(list)
    for s in shots:
        c = [d for d in dm if 0 <= d[0] - s[0] <= 12 and dist(d[7], d[8], s[5], s[6]) < 700 and d[6] == 3]
        if c:
            d = min(c, key=lambda d: d[0]); tt[s[4]].append((d[5], round(dist(d[7], d[8], s[5], s[6])), d[2]))
    out["turrets"] = {k: {"shots_matched": len(v), "damage": collections.Counter(x[0] for x in v).most_common(3), "max_dist": max(x[1] for x in v), "dists": sorted(x[1] for x in v), "rows": [x[2] for x in v[:6]]} for k, v in tt.items()}
    out["turrets"]["shots_total"] = dict(collections.Counter(s[4] for s in shots))
    # gifts
    go = []
    for g in gopen:
        c = [d for d in invd if 0 <= d[0] - g[0] <= 2]
        later = [x for x in gift_spawn if dist(x[3], x[4], g[5], g[6]) < 100 and x[1] > g[1]]
        go.append({"row": g[2], "t": rnd(g[1], 1), "gift": g[4], "inv_same_frame": c[0][3] if c else None, "respawn_same_spot": later})
    out["gifts"] = {"opened": go, "spawn_creates_11_1": gift_spawn}
    # doors
    out["doors"] = {"events": door_ev[:80], "n": len(door_ev)}
    # markers
    mk = []
    for row, t, a, x, y in marks:
        c = min([dist(p[1], p[2], x, y) for p in ion_path if -5 < p[0] - t < 90] or [None]) if ion_path else None
        mk.append([row, rnd(t, 1), a, x, y, round(c) if c else None])
    out["markers"] = mk
    out["join_values"] = jv
    out["spawns"] = spawns
    out["regen_events"] = regen
    out["player_close"] = {"min": min(pclose) if pclose else None, "n_under_60": len(pclose)}
    out["player_fields_per_name"] = {k: {nm: sorted(v, key=str) for nm, v in d.items() if len(nm) and nm != "None"} for k, d in pf.items()}
    out["totem"] = tot
    TX = [r for r in ROWS if r["k"] == "tx"]
    out["op15"] = [[r["i"], rnd(r["w"] - T0, 1), o] for r in TX for o in (r.get("ops") or []) if o[0] == 7]
    out["tame_window_inv"] = [[d[2], rnd(d[1], 1), d[3]] for d in invd if 2526 <= d[1] <= 2536]
    return out
SECTIONS["rest"] = sec_rest

if __name__ == "__main__":
    want = sys.argv[1:] or list(SECTIONS)
    for s in want:
        RES[s] = SECTIONS[s]()
        json.dump(RES, open(OUT, "w"), indent=1, default=str)
        print("section", s, "done")
