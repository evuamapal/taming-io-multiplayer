#!/usr/bin/env python3
# Stitch the v0.3 world from the SP human capture (offline). Biomes are map-wide PHASES on a timer (timer message
# b = phase, d = ms left), and each phase has its own object layout. The capture is cut into phase windows by the
# timer messages; per phase: every static world object he saw (deduped by def + spot), wild creatures and their
# zones, view coverage, an optional sparse synthetic fill of the unseen map, and the switch sequence evidence.
# Several sources are merged by played length: the longest is the base, shorter ones only fill cells/phases no
# higher-ranked source covered, synthetic last.
# Usage: stitch_world.py [--source ID:capture|world:PATH ...] [--phase 1] [--synth 0.5] [--seed 5]
#        [--out mimic/world_sp5.json] [--report mimic/data/sp5_world_report.md] [--no-report]
#   capture = a capture decoded by tools/sp3/decode.py (sp3 jsonl format); world = a world file (world_atl4.json schema,
#   phase from its "biome", played length = recorded frames x 94.3 ms)
# Default sources: sp5b:capture:work/sp3_decoded_162036.jsonl sp5:capture:work/sp3_decoded.jsonl atl4:world:mimic/world_atl4.json
# A capture's view = his own player while alive; while dead (death scoreboard to the next own spawn) the client camera
# stays on the death spot, so the view is held there (the 162036 capture is 2 h of that after a death at t 122 s).
import argparse, collections, json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import REPO, NAMES, World, load_rows, t0_of

PHASES = {1: "snow", 2: "dark", 3: "desert", 4: "sea", 5: "volcanic", 0: "forest"}   # server order
PHASE_MS = {0: 960000, 1: 480000, 2: 480000, 3: 480000, 4: 480000, 5: 480000}
MAP = 17600
VIEW = (1370, 933)   # sp3 render_distance create p99
CELL = 1100          # 16 x 16 coverage grid
RES = 100            # coverage raster
OBJ_ID0, SYNTH_ID0, CRE_ID0 = 4100000, 4400000, 4700000   # + phase * step; all below the 5000000+ ids mimic_server.js hands out
SUP_OBJ, SUP_CRE = 40000, 1000   # id offsets (within a phase block) for records from lower-ranked sources
TICK_S = 0.0943
NIDX = {n: i for i, n in enumerate(NAMES)}

ap = argparse.ArgumentParser()
ap.add_argument("--phase", type=int, default=1, choices=sorted(PHASES), help="phase sent as the top-level objects/creatures and in the join timer (atl4 join has 1 = snow)")
ap.add_argument("--synth", type=float, default=0.5, help="synthetic density in unseen cells, as a fraction of the phase's observed density (0 = none)")
ap.add_argument("--seed", type=int, default=5)
ap.add_argument("--out", default=os.path.join(REPO, "mimic", "world_sp5.json"))
ap.add_argument("--report", default=os.path.join(REPO, "mimic", "data", "sp5_world_report.md"))
ap.add_argument("--no-report", action="store_true")
ap.add_argument("--source", action="append", default=None, help="ID:capture|world:PATH (repeatable; default sp5b + sp5 captures + atl4 world)")
ap.add_argument("--no-atl4", action="store_true", help="drop the default atl4 world source")
A = ap.parse_args()

def family(n):
    for f in ("hollow-log", "tumbleweed", "thornbush", "anemone", "urchin", "golden-flower-bush", "seeds-plant", "big-gold", "gold", "tree", "stone", "bush", "gift", "cactus", "mushroom", "meteorite", "wasp-nest", "boost-pad"):
        if f in n: return f
    return "other"

FMAP = json.load(open(os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json")))
CRE = FMAP.get("creatures", {})
ATL = json.load(open(os.path.join(REPO, "mimic", "world_atl4.json")))   # setup/join/player/boards templates (client pinned to Atlanta#4)
ITEMS = json.load(open(os.path.join(REPO, "mimic", "data", "items.json")))
BUILD = {it["icon"] for it in ITEMS.values() if it and it.get("cat") in (5, 6, 7, 8, 9, 10)}   # player structures, never world layout
HC = json.load(open(os.path.join(REPO, "mimic", "hosted_config.json")))
CD_DEF = (HC.get("game") or {}).get("collide_by_def", {})
CD_FAM = {"tree": 120, "stone": 130, "gold": 150, "bush": 95, "flower": 90, "plant": 90, "hollow-log": 80, "wall": 80, "door": 80, "spike": 65, "windmill": 70,
          "turret": 65, "tower": 65, "gift": 110, "cactus": 90, "anemone": 87, "urchin": 87, "totem": 80}   # hosted/game_config.js collide_family
def collide(n):
    if n in CD_DEF: return max(80, CD_DEF[n])
    for f in ("spike", "wall", "door", "windmill", "turret", "tower", "hollow-log", "tree", "gold", "stone", "bush", "flower", "plant", "gift", "cactus", "anemone", "urchin", "totem"):
        if f in n: return max(80, CD_FAM[f])
    return 80
_SPJS = open(os.path.join(REPO, "mimic", "hosted", "creatures.js")).read()
_SPJS = _SPJS[_SPJS.index("const SPECIES = {"):]; _SPJS = _SPJS[:_SPJS.index("};")]
SPECIES = {int(k): n.lower().replace(" ", "-") for k, n in __import__("re").findall(r'(\d+): \["([^"]+)"', _SPJS)}   # hosted/creatures.js SPECIES names
def cre_name(k): return SPECIES.get(k) or (CRE.get(str(k)) or {}).get("sprite", "species%s" % k)   # k = field 21 (species)
TYPE22 = {5: "Spectrum", 9: "Plant", 11: "Insect", 20: "Fire", 21: "Water", 29: "Normal", 43: "Rock", 44: "Poison", 45: "Ice", 46: "Combat", 59: "Electric", 73: "unknown (boss)"}   # field 22 type names (Oct 17 species pass)
CAPTURES = {"work/sp3_decoded.jsonl": "captures/20261017_114839_human.jsonl.gz", "work/sp3_decoded_162036.jsonl": "captures/20261017_162036_human.jsonl.gz"}

# ---------------------------------------------------------------- replay one capture (sp3 decoded format)
def replay(rows):
    T0 = t0_of(rows)
    W = World()
    phase, own = None, set()
    track, spawns, timers, switches = [], [], [], []
    creates, built, wild = [], collections.Counter(), {}
    born, drift, obj_phase, cre_phase = {}, {}, {}, {}
    removed = collections.Counter()
    pets = 0
    pending = []    # open switches waiting for the old objects to be removed
    dead, last_pos, last_dead_t = False, None, -9
    gone_t = {}
    for r in rows:
        t = r["w"] - T0
        ms = [m for m in (r.get("m") or []) if isinstance(m, dict)]
        sw = None
        for m in ms:   # a timer applies to its whole frame: the server creates the new phase's objects in the same frame
            if m.get("_a") == 32:
                timers.append({"t": round(t, 1), "row": r["i"], "b": m.get("b"), "phase": PHASES.get(m.get("b")), "d": m.get("d")})
                if phase is not None and m.get("b") != phase:
                    old_o = {i for i, e in W.ents.items() if e.get("cat") == 3 and obj_phase.get(i) == phase and i in born}
                    old_c = {i for i, e in W.ents.items() if e.get("cat") == 0 and cre_phase.get(i) == phase}
                    sw = {"t": round(t, 2), "row": r["i"], "from": PHASES[phase], "to": PHASES[m["b"]], "old_objects_in_view": len(old_o), "old_creatures_in_view": len(old_c),
                          "new_objects_same_frame": 0, "new_creatures_same_frame": 0, "old_obj_moves": collections.Counter(), "old_cre_moves": collections.Counter(),
                          "new_first_move": collections.Counter(), "old_obj_removed": 0, "remove_delay_max_s": 0, "_old_o": old_o, "_old_c": old_c, "_new": set(), "_t": t}
                    switches.append(sw); pending.append(sw)
                phase = m.get("b")
        for m in ms:
            a = m.get("_a")
            if a == 59 and m.get("i") and "n" in m: own.add(m["i"] - 1)
            if a == 19 and not m.get("s") and m.get("id"): own.add(m["id"] // 256)
            if a == 6 and last_pos: dead = True
            res = W.apply(m, t)
            i = m.get("0")
            for p in pending:
                if a == 84 and i in p["_old_o"] and t - p["_t"] < 1.0:
                    p["old_obj_moves"][json.dumps({k: m[k] for k in sorted(m) if k not in ("0", "1") and not k.startswith("_")})] += 1
                if a == 84 and i in p["_old_c"] and t - p["_t"] < 1.0 and ("7" in m or "9" in m):
                    p["old_cre_moves"][json.dumps({k: m[k] for k in ("7", "9", "10") if k in m})] += 1
                if a == 84 and i in p["_new"] and i not in p.get("_seen_new", set()):
                    p.setdefault("_seen_new", set()).add(i); p["new_first_move"][json.dumps({k: m[k] for k in sorted(m) if k not in ("0", "1", "3", "4", "5") and not k.startswith("_")})] += 1
                if a == 87 and i in p["_old_o"] and i not in p.setdefault("_gone", set()):
                    p["_gone"].add(i); p["old_obj_removed"] += 1; p["remove_delay_max_s"] = max(p["remove_delay_max_s"], round(t - p["_t"], 2))
            if a == 79 and m.get("2") == 3:
                obj_phase[i] = phase
                if sw is not None and r["i"] == sw["row"]: sw["new_objects_same_frame"] += 1; sw["_new"].add(i)
                if "16" in m or NAMES[m["13"]] in BUILD: built[NAMES[m["13"]]] += 1
                else: creates.append({"m": m, "phase": phase, "t": t}); born[i] = (m["3"], m["4"])
            elif a == 79 and m.get("2") == 0:
                cre_phase[i] = phase
                if sw is not None and r["i"] == sw["row"]: sw["new_creatures_same_frame"] += 1
                if "13" in m: pets += 1
                elif i not in wild: wild[i] = {"m": m, "phase": phase, "t": t}
            elif a == 79 and m.get("2") == 1 and i in own and not any(s["x"] == m["3"] and s["y"] == m["4"] for s in spawns):
                spawns.append({"t": round(t, 1), "x": m["3"], "y": m["4"], "phase": PHASES.get(phase)}); dead = False
            elif a == 84 and res and res[1] is not None:
                e = res[1]
                if i in born and ("3" in m or "4" in m):
                    d = math.hypot(e["x"] - born[i][0], e["y"] - born[i][1])
                    if d > 1: drift[i] = max(drift.get(i, 0), d)
                if i in own and e.get("x") is not None and not dead: track.append((t, e["x"], e["y"], phase)); last_pos = (e["x"], e["y"])
            elif a == 87 and i is not None:
                removed[i] += 1; gone_t.setdefault(i, []).append(t)
        pending = [p for p in pending if t - p["_t"] < 1.0]
        if dead and r["k"] == "rx" and t - last_dead_t >= 1.0:
            track.append((t, last_pos[0], last_pos[1], phase)); last_dead_t = t

    # switch artifacts: an old-phase object that enters view during the removal sweep is created, marked dying (10:1) and removed within 1.5 s
    sw_t = [s["t"] for s in switches]
    fl = [c for c in creates if any(0 <= g - c["t"] < 1.5 for g in gone_t.get(c["m"]["0"], ())) and any(abs(c["t"] - x) < 2.0 for x in sw_t)]
    flash = {id(c) for c in fl}
    creates = [c for c in creates if id(c) not in flash]
    played = (rows[-1]["w"] - T0) - (spawns[0]["t"] if spawns else 0)   # first own-player create to the end of the capture
    return dict(flash=len(flash), rows=rows, T0=T0, track=track, spawns=spawns, timers=timers, switches=switches, creates=creates, built=built, wild=wild, drift=drift, pets=pets, played=played)

# ---------------------------------------------------------------- sources, ranked by played length
SRC = []
for spec in A.source or ["sp5b:capture:work/sp3_decoded_162036.jsonl", "sp5:capture:work/sp3_decoded.jsonl"] + ([] if A.no_atl4 else ["atl4:world:mimic/world_atl4.json"]):
    sid, kind, path = spec.split(":", 2)
    path = os.path.join(REPO, path) if not os.path.isabs(path) else path
    if kind == "capture":
        rows = load_rows() if os.path.abspath(path) == os.path.abspath(os.path.join(REPO, "work", "sp3_decoded.jsonl")) else [json.loads(l) for l in open(path)]
        R = replay(rows)
        rp = os.path.relpath(path, REPO)
        SRC.append({"id": sid, "kind": kind, "path": rp, "capture": CAPTURES.get(rp), "played_s": R["played"], "R": R})
    elif kind == "world":
        wf = json.load(open(path))
        frames = sum(x.get("frames") or 0 for x in wf.get("sources") or [])
        ph = {v: k for k, v in PHASES.items()}.get(wf.get("biome"))
        SRC.append({"id": sid, "kind": kind, "path": os.path.relpath(path, REPO), "played_s": frames * TICK_S, "frames": frames, "phase": ph, "W": wf})
    else:
        sys.exit("unknown source kind " + kind)
SRC.sort(key=lambda x: -x["played_s"])
CAP_IDS = {x["id"] for x in SRC if x["kind"] == "capture"}
for r, x in enumerate(SRC): x["rank"] = r + 1
if SRC[0]["kind"] != "capture": sys.exit("the longest source must be a capture (phase windows, coverage and switches come from it)")
BASE = SRC[0]
R = BASE["R"]
rows, T0, track, spawns, timers, switches = R["rows"], R["T0"], R["track"], R["spawns"], R["timers"], R["switches"]
creates, built, wild, drift, pets = R["creates"], R["built"], R["wild"], R["drift"], R["pets"]

# ---------------------------------------------------------------- per phase
def stitch(cs):
    spots = {}
    for c in cs:
        m = c["m"]; name = NAMES[m["13"]]
        key = (name, m["3"], m["4"])
        s = spots.get(key)
        if s is None:
            s = spots[key] = {"name": name, "x": m["3"], "y": m["4"], "ids": set(), "f": {k: v for k, v in m.items() if k not in ("0", "1", "2", "3", "4", "13") and not k.startswith("_")}}
        s["ids"].add(m["0"])
    out, near = [], 0
    for s in sorted(spots.values(), key=lambda s: (s["name"], s["x"], s["y"])):
        q = out[-1] if out else None
        if q and q["name"] == s["name"] and abs(q["x"] - s["x"]) <= 4 and abs(q["y"] - s["y"]) <= 4:
            q["ids"] |= s["ids"]; near += 1; continue
        out.append(s)
    return out, near

def raster_of(pts):
    ras, last = set(), None
    for t, x, y in pts:
        if last and abs(last[0] - x) < 50 and abs(last[1] - y) < 50: continue
        last = (x, y)
        for gx in range(max(0, (x - VIEW[0]) // RES), min(MAP // RES, (x + VIEW[0]) // RES + 1)):
            for gy in range(max(0, (y - VIEW[1]) // RES), min(MAP // RES, (y + VIEW[1]) // RES + 1)):
                ras.add((gx, gy))
    return ras

G, FULL = MAP // CELL, (CELL // RES) ** 2
windows = collections.defaultdict(float)
for a, b in zip(timers, timers[1:] + [{"t": round(rows[-1]["w"] - T0, 1)}]):
    windows[a["b"]] += b["t"] - a["t"]

def cells_of(ras):
    return {(gx * RES // CELL, gy * RES // CELL) for gx, gy in ras}

def candidates(x, b):
    """(objects, creatures, covered cells) one source offers for phase b; objects are (name, x, y, digit fields, src_id, n_ids)"""
    if x["kind"] == "capture":
        R = x["R"]
        spots, _ = stitch([c for c in R["creates"] if c["phase"] == b])
        ras = raster_of([(t, px, py) for t, px, py, p in R["track"] if p == b])
        objs = [(s["name"], s["x"], s["y"], s["f"], min(s["ids"]), len(s["ids"])) for s in sorted(spots, key=lambda s: (s["y"], s["x"]))]
        cres = [{k: v for k, v in c["m"].items() if not k.startswith("_")} for _, c in sorted(R["wild"].items()) if c["phase"] == b]
        return objs, cres, cells_of(ras), ras
    if x["phase"] != b: return [], [], set(), set()
    objs, skip = [], x.setdefault("skipped", collections.Counter())
    for o in x["W"].get("objects") or []:
        nm = o.get("name")
        if not nm or nm not in NIDX or nm in BUILD or "16" in o: skip["build_or_unknown_def"] += 1; continue
        objs.append((nm, o["3"], o["4"], {k: v for k, v in o.items() if k.isdigit() and k not in ("0", "1", "2", "3", "4", "13")}, o.get("0"), 1))
    cres = [{k: v for k, v in c.items() if k.isdigit()} for c in x["W"].get("creatures") or [] if "13" not in c]
    return objs, cres, {(o[1] // CELL, o[2] // CELL) for o in objs}, set()

P = {}
for b in PHASES:
    objs, cres, zones = [], [], collections.defaultdict(list)
    covered, ras_all, contrib = set(), set(), collections.defaultdict(lambda: {"objects": 0, "creatures": 0})
    cap_objs = []   # real objects from capture sources (base + lower-ranked captures), the pool for density, synthetic defs and spawn
    sup_cells, near, nsup_o, nsup_c = set(), 0, 0, 0
    for x in SRC:
        cobj, ccre, ccells, cras = candidates(x, b)
        base = x is BASE
        skip = x.setdefault("skipped", collections.Counter())
        n_before = len(objs)
        for nm, px, py, f, sid, nids in cobj:
            if not base:
                if (px // CELL, py // CELL) in covered: skip["cell_covered_by_higher_rank"] += 1; continue
                cd = collide(nm)
                if any(o["source"] != x["id"] and math.hypot(o["3"] - px, o["4"] - py) < cd for o in objs): skip["near_higher_rank_object"] += 1; continue
            o = {"0": OBJ_ID0 + b * 50000 + (len(objs) if base else SUP_OBJ + nsup_o), "1": 79, "2": 3, "3": px, "4": py}
            o.update(f); o.setdefault("5", 628); o.setdefault("6", 1)
            o["13"] = NIDX[nm]; o["name"] = nm; o["source"] = x["id"]; o["src_id"] = sid
            if nids > 1: o["src_ids"] = nids
            objs.append(o); contrib[x["id"]]["objects"] += 1
            if not base: nsup_o += 1; sup_cells.add((px // CELL, py // CELL))
        for c in ccre:
            if not base and (c["3"] // CELL, c["4"] // CELL) in covered: continue
            f = dict(c); f["1"] = 79; f["0"] = CRE_ID0 + b * 2000 + (len(cres) if base else SUP_CRE + nsup_c); f["source"] = x["id"]
            if not base: nsup_c += 1
            cres.append(f); zones[cre_name(c.get("21"))].append((c["3"], c["4"], c.get("22"), x["id"], c.get("21"), c.get("23"))); contrib[x["id"]]["creatures"] += 1
        covered |= ccells; ras_all |= cras
        if x["kind"] == "capture": cap_objs = [o for o in objs if o["source"] in CAP_IDS]
        if base:
            n5, ras = len(objs), cras
            _, near = stitch([c for c in creates if c["phase"] == b])
    cov = len(ras) / (MAP // RES) ** 2
    cov_all = len(ras_all) / (MAP // RES) ** 2
    dens = len(cap_objs) / (len(ras_all) * RES * RES) if ras_all else 0
    cc = collections.Counter((gx * RES // CELL, gy * RES // CELL) for gx, gy in ras_all)
    sp = None
    if cap_objs:
        bo = cap_objs
        top = collections.Counter((o["3"] // 1500, o["4"] // 1500) for o in bo).most_common(1)[0][0]
        pts = [o for o in bo if (o["3"] // 1500, o["4"] // 1500) == top]
        sp = {"x": sum(o["3"] for o in pts) // len(pts), "y": sum(o["4"] for o in pts) // len(pts)}
    synth = []
    if A.synth > 0 and dens > 0:
        rnd = random.Random(A.seed * 10 + b)
        pool = [o for o in cap_objs if family(o["name"]) not in ("gift", "boost-pad", "other")]
        occ = [(o["3"], o["4"]) for o in objs]
        for cx in range(G):
            for cy in range(G):
                free = 1 - cc.get((cx, cy), 0) / FULL
                if free < 0.5 or (cx, cy) in sup_cells: continue
                want = dens * CELL * CELL * free * A.synth
                n = int(want) + (1 if rnd.random() < want - int(want) else 0)
                for _ in range(n):
                    for _try in range(20):
                        x = rnd.randint(cx * CELL + 60, cx * CELL + CELL - 60); y = rnd.randint(cy * CELL + 60, cy * CELL + CELL - 60)
                        if not (450 <= x <= 17150 and 450 <= y <= 17150) or (x // RES, y // RES) in ras_all: continue
                        if any(abs(px - x) < 260 and abs(py - y) < 260 for px, py in occ): continue
                        t = rnd.choice(pool)
                        synth.append({"0": SYNTH_ID0 + b * 20000 + len(synth), "1": 79, "2": 3, "3": x, "4": y, "5": 628, "6": 1, "13": t["13"], "name": t["name"], "source": "synthetic", "synthetic": True})
                        occ.append((x, y)); break
    zout = {}
    for nm, pts in sorted(zones.items(), key=lambda kv: -len(kv[1])):
        xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
        t22 = collections.Counter(q[2] for q in pts).most_common(1)[0][0]
        zout[nm] = {"species_field_21": pts[0][4], "type_field_22": t22, "type": TYPE22.get(t22, "unknown"), "n": len(pts),
                    "stages_field_23": {str(k): v for k, v in sorted(collections.Counter(q[5] for q in pts).items(), key=lambda kv: -kv[1])},
                    "sources": dict(collections.Counter(q[3] for q in pts)), "pos": [[q[0], q[1]] for q in pts], "bbox": [min(xs), min(ys), max(xs), max(ys)]}
    quality = "good" if cov_all >= 0.15 and len(cap_objs) >= 150 else "sparse"
    srcs = {"objects": {x["id"]: contrib[x["id"]]["objects"] for x in SRC}, "creatures": {x["id"]: contrib[x["id"]]["creatures"] for x in SRC}}
    srcs["objects"]["synthetic"] = len(synth)
    P[b] = {"name": PHASES[b], "ms": PHASE_MS[b], "objects": objs, "synthetic": synth, "creatures": cres, "creature_zones": zout,
            "coverage": {"view_pct": round(cov_all * 100, 1), "view_pct_base": round(cov * 100, 1), "minutes_in_phase": round(windows.get(b, 0) / 60, 1), "real_objects": n5, "supplement_objects": nsup_o, "synthetic": len(synth),
                         "sources": srcs, "density_per_Mu2": round(dens * 1e6, 2), "quality": quality, "near_dupes_merged": near,
                         "respawned_spots": sum(1 for o in objs[:n5] if o.get("src_ids", 1) > 1)},
            "spawn": sp, "_ras": ras, "_ras_all": ras_all}

# ---------------------------------------------------------------- write
# default spawn: the first observed own spawn in the default phase, by source rank (spawns are random in the real game;
# one in the default phase keeps the join next to that phase's real objects), else the base's first spawn
SPAWNS_ALL = [dict(sp, source=x["id"]) for x in SRC if x["kind"] == "capture" for sp in x["R"]["spawns"]]
_sd = [sp for sp in SPAWNS_ALL if sp["phase"] == PHASES[A.phase]] or SPAWNS_ALL
SPAWN_DEF = {"x": _sd[0]["x"], "y": _sd[0]["y"], "source": _sd[0]["source"], "phase": _sd[0]["phase"]} if _sd else None
d = P[A.phase]
join = []
for m in ATL["join"]:
    m = dict(m)
    if m.get("1") == 32: m["b"] = A.phase; m["d"] = PHASE_MS[A.phase]
    join.append(m)
for s in switches:
    for k in ("old_obj_moves", "old_cre_moves", "new_first_move"): s[k] = dict(s[k].most_common(4))
    for k in [k for k in s if k.startswith("_")]: del s[k]
out = {
    "setup": ATL["setup"], "join": join, "player": ATL["player"],
    "objects": d["objects"] + d["synthetic"], "creatures": d["creatures"], "boards": ATL["boards"],
    "biome": PHASES[A.phase],
    "phase": {"b": A.phase, "name": PHASES[A.phase], "order": [1, 2, 3, 4, 5, 0], "names": {str(k): v for k, v in PHASES.items()}, "ms": {str(k): v for k, v in PHASE_MS.items()},
              "note": "biomes are map-wide timed phases: timer message (atl4 type 32) {b: phase, d: ms left}; every phase has its own object layout and creatures (phases below); top-level objects/creatures = phase b"},
    "phases": {str(b): {k: v for k, v in P[b].items() if not k.startswith("_")} for b in (1, 2, 3, 4, 5, 0)},
    "switches_observed": switches, "timers_observed": timers,
    "spawns": {"default": SPAWN_DEF, "observed": SPAWNS_ALL, "per_phase": {str(b): P[b]["spawn"] for b in P}},
    "sources": [{"id": x["id"], "kind": x["kind"], "path": x["path"], "played_min": round(x["played_s"] / 60, 1), "rank": x["rank"],
                 "capture": x.get("capture"), "skipped": dict(x.get("skipped") or {}), "contributed": {PHASES[b]: {"objects": P[b]["coverage"]["sources"]["objects"][x["id"]], "creatures": P[b]["coverage"]["sources"]["creatures"][x["id"]]} for b in (1, 2, 3, 4, 5, 0)}}
                for x in SRC] + [{"id": "synthetic", "rank": len(SRC) + 1, "args": {"synth": A.synth, "seed": A.seed}}],
    "build": {"tool": "tools/sp3/stitch_world.py", "base_capture": "%s (Saopaulo#5)" % (BASE.get("capture") or BASE["path"]), "args": {"phase": A.phase, "synth": A.synth, "seed": A.seed}},
    "notes": {"creature_identity": "creature field 21 = species (client creature table index, mimic/hosted/creatures.js SPECIES), field 22 = type/element, field 23 = growth stage (0 baby, 1 adult, 2 boss, 3 giant); creature_zones keyed by species (was keyed by field 22 with wrong names before Oct 17)",
              "view": "a capture covers his own view while alive and the death spot while dead (the client camera stays there until the next spawn); coverage.view_pct = union of all capture sources, view_pct_base = base only; density, synthetic defs and per-phase spawn use the real objects of all capture sources"},
}
json.dump(out, open(A.out, "w"), indent=1, ensure_ascii=False)
stats = {"switch_flash_dropped": {x["id"]: x["R"]["flash"] for x in SRC if x["kind"] == "capture"}, "creates_cat3_natural": len(creates), "built_skipped": sum(built.values()), "drifted_gt40": sum(1 for v in drift.values() if v > 40), "wild": len(wild), "pets": pets,
         "phases": {PHASES[b]: P[b]["coverage"] for b in (1, 2, 3, 4, 5, 0)}, "spawns": spawns}
print(json.dumps(stats, indent=1))
if A.no_report: sys.exit(0)

# ---------------------------------------------------------------- report
L = []; w = L.append
w("# Saopaulo#5 world (v0.3)")
w("")
w("Built by `tools/sp3/stitch_world.py` from Ion's human sessions on Saopaulo#5 (" + "; ".join("%s = %s, decoded %s, %.0f min" % (x["id"], x.get("capture"), x["path"], (x["R"]["rows"][-1]["w"] - x["R"]["T0"]) / 60) for x in SRC if x["kind"] == "capture") + "). Base = %s. Output" % BASE["id"] + " `mimic/world_sp5.json`: one layout per biome phase under `phases` (keyed by phase id), top-level `objects`/`creatures` = phase %d (%s) so the current world.js loads it unchanged. Rerun: `/usr/bin/python3 tools/sp3/stitch_world.py [--phase B] [--synth F]`." % (A.phase, PHASES[A.phase]))
w("")
w("## Precedence (stable rule)")
w("")
w("Sources are ranked by played length. The longest is the base of every phase and is kept as recorded. Each shorter source, in order of played length, only adds records in cells (1100 units) and phases that no higher-ranked source covered (a capture covers the cells in its view during that phase, a world file the cells of its records), never within the candidate's collision distance of a higher-ranked record (hosted_config `game.collide_by_def`, else the game_config.js family value, at least 80), and never overrides, moves or removes a higher-ranked record. A world file only feeds the phase of its `biome`. Synthetic fill comes last, only in cells still mostly unseen and holding no lower-ranked record. Every record carries `source` = its source id (`synthetic` records also keep `synthetic: true`). Player builds and unknown defs are dropped from every source.")
w("")
w("| rank | source | kind | played min | " + " | ".join("%s obj/cre" % PHASES[b] for b in (1, 2, 3, 4, 5, 0)) + " |")
w("|---|---|---|---|" + "---|" * 6)
for x in SRC:
    w("| %d | %s | %s | %.1f%s | %s |" % (x["rank"], x["id"], x["kind"], x["played_s"] / 60, " (%d frames x 94.3 ms)" % x["frames"] if x["kind"] == "world" else "",
        " | ".join("%d / %d" % (P[b]["coverage"]["sources"]["objects"][x["id"]], P[b]["coverage"]["sources"]["creatures"][x["id"]]) for b in (1, 2, 3, 4, 5, 0))))
w("| %d | synthetic | fill | - | %s |" % (len(SRC) + 1, " | ".join("%d / 0" % len(P[b]["synthetic"]) for b in (1, 2, 3, 4, 5, 0))))
w("")
for x in SRC:
    if x is not BASE: w("%s (%s): skipped %s." % (x["id"], x["path"], ", ".join("%s %d" % kv for kv in x.get("skipped", {}).items()) or "nothing"))
w("Played length: capture = first own-player create to the end of the capture; world file = recorded frames in its `sources` x 94.3 ms. Sources: `--source ID:capture|world:PATH` (repeatable).")
w("")
w("## Biomes are timed phases, each with its own layout")
w("")
w("No spatial biome map exists. The server sends a timer message (sp5 type 71, atl4 type 32) `{b, d}`: `b` = phase, `d` = ms left; the client re-themes the ground from `b` itself (bundle: the timer handler calls the theme switch: background colour plus one of six ground decal sets, each spread over the whole map). At every switch the objects of the new phase appear at NEW positions (0 of the new objects in a switch frame sit on an old object's spot; median distance to the nearest old object 146 to 449 units), so each phase is its own layout on the same coordinates. The capture is cut into phase windows by the timer messages and each phase is stitched only from its own window.")
w("")
w("| b | phase | duration | in base capture (min) | view coverage all captures (base) | base objects | lower-ranked objects | synthetic | creatures (all sources) | quality |")
w("|---|---|---|---|---|---|---|---|---|---|")
for b in (1, 2, 3, 4, 5, 0):
    c = P[b]["coverage"]
    w("| %d | %s | %d min | %.1f | %.1f%% (%.1f%%) | %d | %d | %d | %d | %s |" % (b, PHASES[b], PHASE_MS[b] // 60000, c["minutes_in_phase"], c["view_pct"], c["view_pct_base"], c["real_objects"], c["supplement_objects"], c["synthetic"], len(P[b]["creatures"]), c["quality"]))
w("")
w("Cycle 1,2,3,4,5,0 = 5 x 8 min + 16 min = 56 min. quality good = view coverage (all captures) >= 15% and >= 150 capture objects, else sparse. The atl4 join carries `b:1`, so the default top level is phase 1 (snow).")
w("")
w("Timers seen: " + "; ".join("t=%.1f min row %d b=%d d=%s" % (tm["t"] / 60, tm["row"], tm["b"], tm["d"]) for tm in timers))
w("")
w("## Switch sequence (frame evidence)")
w("")
w("Per observed switch: the frame that carries the timer, what it holds, and what follows within 1 s (moves keyed by their non-position fields).")
w("")
for s in switches:
    w("- t=%.2f s, row %d, %s -> %s: in view %d old objects, %d old creatures. Same frame: %d new objects, %d new creatures. First move of new objects: %s. Old objects get %s; old creatures get %s; old objects removed %d (last %.2f s after the switch)." % (
        s["t"], s["row"], s["from"], s["to"], s["old_objects_in_view"], s["old_creatures_in_view"], s["new_objects_same_frame"], s["new_creatures_same_frame"],
        s["new_first_move"] or "-", s["old_obj_moves"] or "-", s["old_cre_moves"] or "-", s["old_obj_removed"], s["remove_delay_max_s"]))
w("")
w("Implementer summary: in one frame send the timer `{1:32, b, d}`, create the new phase's objects in view, mark old objects in view (they carry `7:0, 10:1`), kill old-phase creatures (`7:18, 9:0, 10:<dmg>`), then remove the old objects in view within the next ~0.75 s (same frame in the last two switches). Only natural objects (no owner, not a buildable def) are counted as old objects here.")
w("")
w("## Objects")
w("")
w("- category-3 creates without owner: %d; player builds skipped (owner field 16 or a buildable item def): %d (%s)" % (len(creates), sum(built.values()), ", ".join("%s %d" % kv for kv in built.most_common(6))))
w("- dedupe per phase by (def, x, y), near-dupes within 4 units merged; spots re-created under a new id (respawn or re-entering view) keep one record (`src_ids` = how many ids)")
w("- ids that drifted > 40 units after create (tumbleweeds, anemones, pushed stones) are kept at their create position: %d" % sum(1 for v in drift.values() if v > 40))
w("- memory snapshots (%d) hold no category-3 id that the wire did not create; they were used as a cross-check only" % sum(1 for r in rows if r["k"] == "snapshot"))
w("")
w("| phase | families (real) |")
w("|---|---|")
for b in (1, 2, 3, 4, 5, 0):
    w("| %s | %s |" % (PHASES[b], ", ".join("%s %d" % kv for kv in collections.Counter(family(o["name"]) for o in P[b]["objects"]).most_common())))
w("")
w("Record fields: `0` new id (phase b: base %d+b*50000, lower-ranked sources +40000, synthetic %d+b*20000, creatures %d+b*2000 (lower-ranked +1000); clear of the ids mimic_server.js and world.js hand out), `1` atl4 create type 79, `2` 3, `3`/`4` x/y, `5` angle as sent (628 default), `6` as sent, `11` kept where sent, `13` def index, `name`; `source` (source id or synthetic), `src_id` (id in that source), `src_ids`, `synthetic` are annotations (world.js keeps digit keys only)." % (OBJ_ID0, SYNTH_ID0, CRE_ID0))
w("")
w("## Coverage maps")
w("")
w("Union of his view rectangles over all capture sources (+-%d x +-%d) while each phase was active, per 1100-unit cell (rows y top to bottom, columns x; `#` >= 50%%, `+` > 0, `.` unseen):" % VIEW)
w("")
for b in (1, 2, 3, 4, 5, 0):
    cc = collections.Counter((gx * RES // CELL, gy * RES // CELL) for gx, gy in P[b]["_ras_all"])
    w("%s (%.1f%%):" % (PHASES[b], P[b]["coverage"]["view_pct"]))
    w("```")
    for cy in range(G): w("".join("#" if cc.get((cx, cy), 0) >= FULL / 2 else "+" if cc.get((cx, cy)) else "." for cx in range(G)))
    w("```")
alls = set().union(*(P[b]["_ras_all"] for b in P))
w("All phases together: %.1f%% of the map was in view at some time (positions are shared, layouts are not)." % (len(alls) / (MAP // RES) ** 2 * 100))
w("")
w("## Synthetic")
w("")
w("Per phase, cells at least half unseen in that phase get objects flagged `synthetic: true` at %.0f%% of that phase's observed density (all capture sources), defs drawn from the phase's own real capture objects (no gifts), >= 260 units apart, never inside his seen area for that phase (seed %d). They sit in `phases[b].synthetic` and are appended to the top-level `objects` for the default phase. `--synth 0` gives a real-only world." % (A.synth * 100, A.seed))
w("")
w("## Spawns")
w("")
for s in SPAWNS_ALL: w("- %s: own player create at t=%.1f min: (%d, %d), phase %s" % (s["source"], s["t"] / 60, s["x"], s["y"], s["phase"]))
w("")
w("`spawns.default` = the first observed spawn in the default phase (%s), by source rank: %s. `spawns.per_phase` = centroid of the densest 1500-unit cell of each phase's real capture objects. world.js uses `spawns.default` (or `per_phase` with spawn_mode per_phase) unless hosted_config `game.spawn_force` is set." % (PHASES[A.phase], json.dumps(SPAWN_DEF)))
w("")
w("## Creatures (wild, no owner) per phase")
w("")
w("%d unique wild creatures in the base, %d pet creates skipped. Zones are keyed by species = field 21 (client creature table); field 22 = type, field 23 = stage, field 7 = state (2 walk, 66, 10, 34), which world.js keys its templates by. Old-phase creatures are killed at a switch, so species are per phase." % (len(wild), pets))
w("")
w("| phase | species (f21, type): n, bbox x0,y0,x1,y1 |")
w("|---|---|")
for b in (1, 2, 3, 4, 5, 0):
    w("| %s | %s |" % (PHASES[b], "; ".join("%s (%s, %s): %d, %s" % (nm, z["species_field_21"], z["type"], z["n"], ",".join(map(str, z["bbox"]))) for nm, z in P[b]["creature_zones"].items())))
w("")
w("Every position is in `phases[b].creature_zones[species].pos` for a zone-based spawner.")
open(A.report, "w").write("\n".join(L) + "\n")
