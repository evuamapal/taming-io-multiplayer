#!/usr/bin/env python3
# Feature inventory of the SP human capture (Saopaulo#5) vs the hosted server, offline. Every count, span and example is
# recomputed from the capture; interpretation notes are written next to the numbers they rest on.
# Writes mimic/data/sp3_feature_inventory.json (section by section, partial results survive) and .md.
# Usage: python3 tools/sp3/inventory.py
import bisect, codecs, collections, gzip, json, math, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import *
import decode as DECODE

OUTJ = os.path.join(REPO, "mimic", "data", "sp3_feature_inventory.json")
OUTM = os.path.join(REPO, "mimic", "data", "sp3_feature_inventory.md")
FMAP = json.load(open(os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json")))
SEM = json.load(open(os.path.join(REPO, "mimic", "data", "sp3_semantics.json")))
FACTS = json.load(open(os.path.join(REPO, "mimic", "data", "sp3_facts.json")))["facts"]
ITEMS = json.load(open(os.path.join(REPO, "mimic", "data", "items.json")))
CRE = FMAP.get("creatures") or {}
REAL = codecs.decode("gnzvat.vb", "rot13")
rows = load_rows()
T0 = t0_of(rows)
DOC = {"capture": os.path.basename(DECODE.CAP), "server": "Saopaulo#5 (shuffle key saopaulo5)",
       "time_base": "t = seconds since ws_open; row = line index in the capture file (same as work/sp3_decoded.jsonl 'i')",
       "ids": "sp3 = Sao Paulo #5 wire ids; atl4 = Atlanta#4 ids used by our server (translation in sp3_semantics.json)",
       "sections": {}}

def save():
    json.dump(DOC, open(OUTJ, "w"), indent=1, ensure_ascii=False)
def put(k, v):
    DOC["sections"][k] = v; save(); print("section", k)
def rel(r): return round(r["w"] - T0, 2)
def at(r): return {"row": r["i"], "t": rel(r)}
def clean(m, n=12):
    out = {}
    for k, v in m.items():
        if k.startswith("_"): continue
        if isinstance(v, list) and len(v) > n: v = v[:n] + ["..."]
        if isinstance(v, str) and len(v) > 80: v = v[:80] + "..."
        out[k] = v
    return json.loads(json.dumps(out, ensure_ascii=True))
def span(evs):
    if not evs: return None
    return {"first": {"row": evs[0][0], "t": evs[0][1]}, "last": {"row": evs[-1][0], "t": evs[-1][1]}}
def iname(i):
    it = ITEMS.get(str(i)); return it["name"] if it else None
def cname(k): return (CRE.get(str(k)) or {}).get("name", "kind%s" % k)
PREFIXES = ("snow", "desert", "sea", "volcanic", "dark")
def prefix(n):
    m = re.match(r"^(%s)-" % "|".join(PREFIXES), n or "")
    return m.group(1) if m else "plain"
def family(n):
    if not n: return None
    n = re.sub(r"^(%s)-" % "|".join(PREFIXES), "", n)
    return re.sub(r"\d+$", "", n)
NATURAL = re.compile(r"tree|stone|bush|gold|hollow-log|anemone|urchin|thornbush|tumbleweed|cactus|mushroom|meteorite|nest")
def natural(n): return bool(n) and bool(NATURAL.search(n)) and not re.search(r"spike|wall|turret|tower|windmill|door|pad", n)

# ---------------------------------------------------------------- lives, ids, raw http
lives = []
for r in rows:
    for m in r.get("m") or []:
        if isinstance(m, dict) and m.get("_a") == 59 and "na" in m:
            lives.append({"own": m["i"] - 1, "pet": m["i"], "join_row": r["i"], "join_t": rel(r), "death_row": None, "death_t": None})
        if isinstance(m, dict) and m.get("_a") == 6 and lives:
            lives[-1]["death_row"] = r["i"]; lives[-1]["death_t"] = rel(r)
OWNS = {l["own"] for l in lives}; PETS = {l["pet"] for l in lives}
http = []
for i, l in enumerate(gzip.open(DECODE.CAP, "rt")):
    if '"http_req"' not in l[:40]: continue
    f = json.loads(l)
    http.append((i, round(float(f["wall"]) - T0, 2), f["method"], f["url"]))
SNAP = {}
for r in rows:
    if r["k"] == "snapshot":
        for e in r["ents"]: SNAP.setdefault(e[0], (e[1], e[2]))

# ---------------------------------------------------------------- one replay pass
W = World()
rx_stat = collections.defaultdict(lambda: {"n": 0, "evs": [], "keys": collections.Counter(), "ex": {}})
move_sig = collections.defaultdict(lambda: {"n": 0, "evs": [], "ex": None})
ENT = {}
own_rec, pet_rec, own_pos, inv_ev, xp_ev, obj_ev, rem_ev, cre_ev, cr_ev, rare = [], [], [], [], [], [], [], [], [], collections.defaultdict(list)
tx_ops = collections.defaultdict(list); tx_json = collections.defaultdict(list)
cur_own = None
for r in rows:
    t = rel(r)
    if r["k"] == "tx":
        for b, v in r.get("ops") or []: tx_ops[b].append((r["i"], t, v))
        j = r.get("json")
        for x in (j if isinstance(j, list) else [j]) if j is not None else []:
            if isinstance(x, dict): tx_json[x.get("type")].append((r["i"], t, x))
        continue
    if r["k"] != "rx": continue
    for m in r["m"]:
        if not isinstance(m, dict): continue
        sid, a, i = m.get("1"), m.get("_a"), m.get("0")
        s = rx_stat[sid]; s["n"] += 1
        if not s["evs"]: s["evs"].append((r["i"], t))
        s["last"] = (r["i"], t)
        ks = tuple(sorted(k for k in m if not k.startswith("_")))
        s["keys"][ks] += 1
        if ks not in s["ex"] and len(s["ex"]) < 4: s["ex"][ks] = dict(clean(m), row=r["i"], t=t)
        e = W.ents.get(i)
        if a == 59 and "na" in m: cur_own = m["i"] - 1
        if a == 79:
            ENT.setdefault(i, {"cat": m.get("2"), "def": m.get("13") if m.get("2") == 3 else None, "kind": m.get("22") if m.get("2") == 0 else None,
                               "name": defname(m.get("13")) if m.get("2") == 3 else None, "creates": 0, "first": (r["i"], t), "f": clean(m), "xs": [], "ys": []})
            en = ENT[i]; en["creates"] += 1; en["last"] = (r["i"], t); en["xs"].append(m.get("3")); en["ys"].append(m.get("4"))
            for k in ("13", "15", "16", "11", "12", "7"):
                if k in m: en.setdefault("cf", {}).setdefault(k, set()).add(m[k] if not isinstance(m[k], (list, dict)) else str(m[k]))
            o = W.ents.get(cur_own)
            cre_ev.append((r["i"], t, i, m, math.hypot(m.get("3", 0) - o["x"], m.get("4", 0) - o["y"]) if o else None))
        if a == 84 and e:
            ks2 = tuple(sorted(k for k in m if k not in ("0", "1", "3", "4", "5") and not k.startswith("_")))
            if i in OWNS: fam = "own player"
            elif i in PETS: fam = "own pet"
            elif e["cat"] == 3: fam = "object:" + (family(e.get("name")) or "?")
            else: fam = {0: "creature", 1: "player", 2: "effect", 4: "projectile"}.get(e["cat"], "cat%s" % e["cat"])
            if ks2:
                ms = move_sig[(fam, ks2)]; ms["n"] += 1
                if not ms["evs"]: ms["evs"].append((r["i"], t)); ms["ex"] = dict(clean(m), row=r["i"], t=t)
                ms["last"] = (r["i"], t)
            if ks2 and i in OWNS: own_rec.append((r["i"], t, i, {k: m[k] for k in ks2}))
            if ks2 and i in PETS: pet_rec.append((r["i"], t, i, {k: m[k] for k in ks2}))
            if ks2 and e["cat"] == 3:
                o = W.ents.get(cur_own)
                obj_ev.append((r["i"], t, i, e.get("name"), {k: m[k] for k in ks2}, math.hypot(e["x"] - o["x"], e["y"] - o["y"]) if o else None))
            if ks2 and e["cat"] == 0 and i not in PETS: cr_ev.append((r["i"], t, i, {k: m[k] for k in ks2}))
        if a == 87 and e:
            o = W.ents.get(cur_own)
            rem_ev.append((r["i"], t, i, dict(e, f=None), math.hypot(e["x"] - o["x"], e["y"] - o["y"]) if o and e["x"] is not None else None))
            if i in ENT: ENT[i]["removes"] = ENT[i].get("removes", 0) + 1
        if a == 53: inv_ev.append((r["i"], t, dict(m["i"])))
        if a == 27: xp_ev.append((r["i"], t, m["i"]))
        if a not in (79, 84, 87, 53, 27) and not (a == 64 and "ob" not in m) and not (a == 59 and "p" in m):
            rare[a].append((r["i"], t, clean(m, 40)))
        W.apply(m, t)
        if a == 84 and i in ENT and W.ents.get(i):
            ENT[i]["xs"].append(W.ents[i]["x"]); ENT[i]["ys"].append(W.ents[i]["y"])
    o = W.ents.get(cur_own)
    if o and cur_own in OWNS: own_pos.append((r["i"], t, o["x"], o["y"], cur_own))
print("replay done", len(ENT), "entities")

# ---------------------------------------------------------------- implementation map (our server)
SRV_RX = {79: "world.js World.createMsg / Player.stream", 84: "world.js Player.stream (delta + keepalive)", 87: "world.js World.removeEnt / Player.stream",
          53: "world.js Player.gain / join", 27: "world.js Player.addXp", 19: "world.js Player.join / afterDeath (camera)", 64: "world.js World.board",
          59: "world.js Player.join (own_info) / update (minimap p)", 6: "world.js Player.afterDeath", 39: "world.js World.chat", 36: "world.js Player.useItem (placed count)"}
REPLAY = {}
WA = json.load(open(os.path.join(REPO, "mimic", "world_atl4.json")))
for m in WA["setup"]: REPLAY.setdefault(m["1"], "replayed once from world_atl4.json setup (static values)")
for m in WA["join"]: REPLAY.setdefault(m["1"], "replayed once from world_atl4.json join (static values)")
SRV_TX = {0: "world.js Player.onFrame OP.AIM", 4: "world.js Player.onFrame OP.ATTACK (swing / useItem)", 5: "world.js Player.onFrame OP.KEY",
          8: "accepted, ignored (heartbeat)", 10: "world.js Player.onFrame OP.SELECT", 16: "world.js Player.onFrame OP.ROT (re-key)"}
SRV_JSON = {1: "world.js Player.join", 39: "world.js Player.onChat", 28: "ignored (token)"}

# ---------------------------------------------------------------- 1. message types
TNAME = {}
for nm, v in SEM["message_types"].items(): TNAME[v["sp3_type"]] = nm
MEAN = {79: "create entity (2 = category, 3/4 = x/y, 13 def / 22 kind)", 84: "move / keepalive / state record (hits, hp, damage, swing ride on it)", 87: "remove entity",
        53: "inventory (i = {slot: count})", 27: "XP total", 64: "leaderboard + minimap boss marker (ob, pa)", 59: "own_info at join / minimap position p",
        75: "gift_open (gi = gift def number, i = slot-4 bonus count)", 81: "placed_list (own structures: o = [[id, x/58, y/58, def name]] add, [[id]] remove; p = total placed)",
        80: "minimap event marker every ~130 s (o, j = minimap cell 0..100)", 65: "minimap marker every 30 s during the volcanic phase (o, j)",
        44: "event counter (o kind, n value as string)", 37: "quest progress (o = quest 1..4, n = times completed)", 32: "biome phase timer (b = phase 0..5, d = ms left)",
        52: "server announcement banner (m text, o ms, i colour)", 66: "token T at first ws message after login; H/W lists at each join", 68: "clan sub-protocol (m = sub-op)",
        43: "state_b (once at connect, b)", 31: "join_ack", 58: "join_flag (o)", 11: "join_value (o)", 86: "join_value2 (o)", 36: "item_count (B = [item*256 + placed count])",
        6: "death scoreboard (o = stats object)", 19: "camera target (id = entity*256+2, s = spectate)", 39: "chat (bubble i/m/mt, or clan log m/tm/s/n/p)"}
msgs = []
for sid, s in sorted(rx_stat.items(), key=lambda kv: -kv[1]["n"]):
    a = FMAP["types"].get(str(sid), {}).get("atl4")
    msgs.append({"dir": "rx", "sp3": sid, "atl4": a, "client_name": FMAP["types"].get(str(sid), {}).get("client"), "name": TNAME.get(sid), "meaning": MEAN.get(a),
                 "count": s["n"], "first": {"row": s["evs"][0][0], "t": s["evs"][0][1]}, "last": {"row": s["last"][0], "t": s["last"][1]},
                 "field_sets": [[list(k), v] for k, v in s["keys"].most_common(6)], "examples": list(s["ex"].values())[:3],
                 "our_server": SRV_RX.get(a) or REPLAY.get(a) or "not sent"})
OPN = {0: "aim", 1: "unlock/craft item (value = item id)", 2: "? at join", 3: "join extra", 4: "attack/use", 5: "move key", 6: "? 6400 at join", 7: "? 6400 at join",
       8: "heartbeat", 9: "? at join", 10: "select item", 12: "? at join", 15: "? 31 at connect", 16: "re-key"}
for b, lst in sorted(tx_ops.items()):
    a = FMAP["ops"].get(str(b), {}).get("atl4")
    msgs.append({"dir": "tx_op", "sp3": b, "atl4": a, "name": OPN.get(a), "count": len(lst), "first": {"row": lst[0][0], "t": lst[0][1]}, "last": {"row": lst[-1][0], "t": lst[-1][1]},
                 "values_top": collections.Counter(v for _, _, v in lst).most_common(6), "our_server": SRV_TX.get(a, "not handled (dropped)")})
JN = {1: "join", 28: "token reply", 48: "pet command (I = pet id, S = mode 0..4)", 68: "clan action (o = action, n = arg)", 39: "chat (msg, tm 1 = clan)", 45: "tame/claim creature (_ = creature id)"}
for jt, lst in sorted(tx_json.items(), key=lambda kv: str(kv[0])):
    a = FMAP["types"].get(str(jt), {}).get("atl4")
    ex = []
    for row, t, x in lst[:3]:
        x = dict(x)
        if "c" in x: x["c"] = x["c"][:16] + "..."
        ex.append(dict(x, row=row, t=t))
    msgs.append({"dir": "tx_json", "sp3": jt, "atl4": a, "name": JN.get(a), "count": len(lst), "first": {"row": lst[0][0], "t": lst[0][1]},
                 "last": {"row": lst[-1][0], "t": lst[-1][1]}, "examples": ex, "our_server": SRV_JSON.get(a, "not handled (dropped)")})
sigs = []
for (fam, ks), v in sorted(move_sig.items(), key=lambda kv: (kv[0][0], -kv[1]["n"])):
    sigs.append({"entity": fam, "fields": list(ks), "count": v["n"], "first": {"row": v["evs"][0][0], "t": v["evs"][0][1]}, "last": {"row": v["last"][0], "t": v["last"][1]}, "example": v["ex"]})
put("1_messages", {"rx_types_seen": len(rx_stat), "messages": msgs,
                   "move_record_signatures": {"note": "type move (atl4 84) records grouped by entity kind and the non-position fields they carry; one message type carries hits, hp, damage, swing and state",
                                              "rows": sigs}})

# ---------------------------------------------------------------- 2. biomes (rotating world biome)
phases = [(r, t, m) for a in [32] for (r, t, m) in rare[a]]
PH_NAME = {1: "snow", 2: "dark", 3: "desert", 4: "sea", 5: "volcanic", 0: "plain (forest)"}
music = [(i, t, u.rsplit("/", 1)[1]) for i, t, meth, u in http if re.search(r"/audio/(winter|darkness|desert|sea|volcanic|forest)\d\.mp3", u)]
segs = []
for k, (row, t, m) in enumerate(phases):
    nxt = phases[k + 1][1] if k + 1 < len(phases) else rel(rows[-1])
    if segs and segs[-1]["b"] == m["b"]:
        segs[-1]["timer_msgs"].append({"row": row, "t": t, "d": m["d"]}); continue
    segs.append({"b": m["b"], "biome": PH_NAME.get(m["b"]), "start_row": row, "start_t": t, "timer_msgs": [{"row": row, "t": t, "d": m["d"]}]})
for k, s in enumerate(segs): s["end_t"] = segs[k + 1]["start_t"] if k + 1 < len(segs) else rel(rows[-1])
cellp = collections.defaultdict(collections.Counter)
for s in segs:
    nat = collections.Counter(); minor = collections.defaultdict(list)
    for row, t, i, m, d in cre_ev:
        if s["start_t"] <= t < s["end_t"] and m.get("2") == 3 and "16" not in m and natural(defname(m.get("13"))):
            p = prefix(defname(m.get("13"))); nat[p] += 1; minor[p].append((m["3"], m["4"]))
            cellp[(m["3"] // 2000, m["4"] // 2000)][{"snow": "S", "dark": "K", "desert": "D", "sea": "W", "volcanic": "V", "plain": "F"}[p]] += 1
    major = nat.most_common(1)[0][0] if nat else None
    s["natural_object_creates_by_prefix"] = dict(nat)
    s["majority_prefix"] = major
    s["minority"] = {p: {"n": len(v), "bbox": [min(x for x, y in v), min(y for x, y in v), max(x for x, y in v), max(y for x, y in v)]} for p, v in minor.items() if p != major}
    pos = [(x, y) for row, t, x, y, o in own_pos if s["start_t"] <= t < s["end_t"]]
    s["own_bbox"] = [min(x for x, y in pos), min(y for x, y in pos), max(x for x, y in pos), max(y for x, y in pos)] if pos else None
    s["music"] = [{"row": i, "t": t, "file": f} for i, t, f in music if s["start_t"] - 2 <= t <= s["start_t"] + 70]
trans = []
for s in segs[1:]:
    new_p = s["majority_prefix"]; t0 = s["start_t"]
    cr = [x for x in cre_ev if abs(x[1] - t0) < 0.05 and x[3].get("2") == 3 and prefix(defname(x[3].get("13"))) == new_p]
    rm = [x for x in rem_ev if t0 <= x[1] <= t0 + 5 and x[3]["cat"] == 3 and natural(x[3].get("name")) and prefix(x[3].get("name")) != new_p]
    dz = [x for x in obj_ev if abs(x[1] - t0) < 0.05 and x[4].get("7") == 0 and x[4].get("10") == 1]
    ck = [x for x in cr_ev if abs(x[1] - t0) < 0.05 and x[3].get("7") == 18]
    trans.append({"to": s["biome"], "t": t0, "row": s["start_row"], "new_objects_created_same_frame": len(cr),
                  "old_objects_destroy_record_same_frame": len(dz), "creatures_killed_same_frame": [{"kind": cname(ENT.get(x[2], {}).get("kind")), "f": x[3]} for x in ck],
                  "old_biome_objects_removed_within_5s": len(rm), "old_removed_first": rm and {"row": rm[0][0], "t": rm[0][1], "delay_s": round(rm[0][1] - t0, 2)},
                  "old_prefixes_removed": dict(collections.Counter(prefix(x[3].get("name")) for x in rm))})
xs = sorted(cellp); grid = []
for gy in range(0, 9):
    line = []
    for gx in range(0, 9):
        c = cellp.get((gx, gy)); line.append("".join(k for k in "SKDWVF" if c and c[k] >= 2) or ".")
    grid.append(" ".join("%-4s" % c for c in line))
boss = collections.OrderedDict()
for row, t, m in rare[64]:
    k = json.dumps(m.get("ob"))
    if k not in boss: boss[k] = {"ob": m.get("ob"), "pa": m.get("pa"), "first": {"row": row, "t": t}}
    boss[k]["last"] = {"row": row, "t": t}
put("2_biomes", {
    "summary": "The biome is a GLOBAL ROTATING WORLD STATE, not a place: timer type sp3 71 (atl4 32) {b: phase, d: ms left} switches the whole map every 480 s "
               "(phase 0 = plain/forest lasts 960 s): 1 snow -> 2 dark -> 3 desert -> 4 sea -> 5 volcanic -> 0 plain -> 1 ... (full cycle 3360 s). At the switch the server sends, in the same frame as the timer, "
               "creates for the new-biome resource objects in view (new ids, new positions; their first move carries 7 = 255, the pop-in), a destroy record {7: 0, 10: 1} for every old-biome object in view, kills old-biome creatures in view (move {7: 18 dying, 9: 0, 10: 400 or 900}), and 0..0.7 s later removes the old objects. Biome music (winterN/darknessN/desertN/seaN/volcanicN/forestN.mp3) is fetched at the same instant. "
               "The same 2000x2000 cells show snow, then dark, then desert, then sea objects as the phases pass (grid below), so Ion did not walk between biomes: the world changed around him.",
    "phases": segs, "transitions": trans,
    "cell_grid_2000": {"legend": "rows y 0..17999 top to bottom, columns x 0..17999; letters = biome prefixes of natural objects created in that cell over the session (S snow, K dark, D desert, W sea, V volcanic, F plain/forest), . = never seen",
                       "rows": grid},
    "own_extent": [min(p[2] for p in own_pos), min(p[3] for p in own_pos), max(p[2] for p in own_pos), max(p[3] for p in own_pos)],
    "boss_markers": {"note": "leaderboard message (atl4 64) carries ob = [minimap x, minimap y, boss kind] and pa = [x, y] (a second fixed marker, changed once at 1783.7 s); ob changed %d times, independent of the phase switches (a boss spawns, dies or moves); kind is an index not yet mapped to a creature" % (len(boss) - 1),
                     "values": list(boss.values())},
    "boundaries": "no spatial biome boundaries: all natural objects created inside one phase carry the phase prefix except a few minority prefixes listed per phase (left-over objects removed a frame later, or the fixed sea/plain set listed in minority bbox). Map clamp for the player is 350..17250 (sp3_facts map_edge).",
    "evidence_ok": "yes", "implemented": "no: world_atl4.json is a fixed snow world (115 objects) and the timer (atl4 32 b=1) is replayed once with a static value; no phase rotation, no object swap"})

# ---------------------------------------------------------------- 3. entity catalogue
def bbox(en):
    xs = [x for x in en["xs"] if x is not None]; ys = [y for y in en["ys"] if y is not None]
    return [min(xs), min(ys), max(xs), max(ys)] if xs else None
env = FACTS.get("contact_envelope", {}).get("value", {}).get("by_def", {})
defs = collections.defaultdict(lambda: {"ids": 0, "creates": 0, "removes": 0, "spans": [], "cf": collections.Counter(), "def": None, "placed": 0, "hits": 0, "destroyed": 0})
destroyed_ids = set(i for row, t, i, nm, f, d in obj_ev if "10" in f)
hit_ids = collections.Counter(i for row, t, i, nm, f, d in obj_ev if "8" in f)
for i, en in ENT.items():
    if en["cat"] != 3: continue
    d = defs[en["name"]]; d["ids"] += 1; d["creates"] += en["creates"]; d["removes"] += en.get("removes", 0); d["def"] = en["def"]
    d["spans"].append(en["first"]); d["spans"].append(en["last"])
    for k, vs in (en.get("cf") or {}).items():
        if k != "13": d["cf"][k] += 1
    if "16" in (en.get("cf") or {}): d["placed"] += 1
    d["hits"] += hit_ids.get(i, 0); d["destroyed"] += i in destroyed_ids
objs = []
for nm, d in sorted(defs.items(), key=lambda kv: -kv[1]["ids"]):
    sp = sorted(d["spans"], key=lambda x: x[1])
    objs.append({"name": nm, "def": d["def"], "biome_prefix": prefix(nm), "family": family(nm), "distinct_ids": d["ids"], "creates": d["creates"], "removes": d["removes"],
                 "hit_records": d["hits"], "ids_destroyed": d["destroyed"], "player_placed_ids": d["placed"], "create_extra_fields": dict(d["cf"]),
                 "contact_dist": (env.get(nm) or {}).get("contact_dist"), "first": {"row": sp[0][0], "t": sp[0][1]}, "last": {"row": sp[-1][0], "t": sp[-1][1]}})
cre_kinds = collections.defaultdict(lambda: {"ids": set(), "pets": set(), "f21": collections.Counter(), "first": None, "last": None, "own_pet": set()})
for i, en in ENT.items():
    if en["cat"] != 0: continue
    k = cre_kinds[en["kind"]]; k["ids"].add(i)
    if "13" in en["f"]: k["pets"].add(i)
    if i in PETS: k["own_pet"].add(i)
    k["f21"][en["f"].get("21")] += 1
    k["first"] = min(k["first"] or en["first"], en["first"], key=lambda x: x[1]); k["last"] = max(k["last"] or en["last"], en["last"], key=lambda x: x[1])
creatures = [{"kind": k, "name": cname(k), "distinct_ids": len(v["ids"]), "pets_of_players": len(v["pets"]), "own_pet_ids": sorted(v["own_pet"]),
              "f21_top": v["f21"].most_common(4), "first": {"row": v["first"][0], "t": v["first"][1]}, "last": {"row": v["last"][0], "t": v["last"][1]}}
             for k, v in sorted(cre_kinds.items(), key=lambda kv: -len(kv[1]["ids"]))]
players = [i for i, en in ENT.items() if en["cat"] == 1]
pl_f = collections.defaultdict(collections.Counter)
for i in players:
    f = ENT[i]["f"]
    for k in ("7", "8", "9", "14", "20", "21", "26"):
        if k in f: pl_f[k][iname(f[k]) if k == "8" else f[k]] += 1
proj = collections.defaultdict(lambda: {"n": 0, "owner": collections.Counter(), "f8": collections.Counter(), "first": None, "last": None})
for i, en in ENT.items():
    if en["cat"] != 4: continue
    f = en["f"]; p = proj[f.get("7")]; p["n"] += 1
    ow = f.get("10"); oe = ENT.get(ow)
    p["owner"]["own player" if ow in OWNS else "own pet" if ow in PETS else (oe and ({0: "creature:" + cname(oe["kind"]), 1: "player", 3: "object:" + str(oe["name"])}.get(oe["cat"], "cat%s" % oe["cat"]))) or "unseen id"] += 1
    p["f8"][f.get("8")] += 1
    p["first"] = p["first"] or en["first"]; p["last"] = en["last"]
projs = [{"field7_kind": k, "n": v["n"], "owners": dict(v["owner"]), "field8": dict(v["f8"]), "first": {"row": v["first"][0], "t": v["first"][1]}, "last": {"row": v["last"][0], "t": v["last"][1]},
          "example": next(dict(en["f"], row=en["first"][0], t=en["first"][1]) for en in ENT.values() if en["cat"] == 4 and en["f"].get("7") == k)} for k, v in sorted(proj.items(), key=lambda kv: -kv[1]["n"])]
effects = [dict(en["f"], row=en["first"][0], t=en["first"][1]) for en in ENT.values() if en["cat"] == 2]
switch_t = [s["start_t"] for s in segs[1:]]
rsteps = collections.defaultdict(collections.Counter); rlast = {}; rdead = []
for row, t, i, nm, f, d in obj_ev:
    if not natural(nm) or (nm or "").startswith("gift"): continue
    if "7" in f and "8" in f:
        if i in rlast and rlast[i] > f["7"]: rsteps[family(nm)][rlast[i] - f["7"]] += 1
        rlast[i] = f["7"]
    if f.get("10") == 1 and f.get("7") == 0 and not any(abs(t - st) < 0.1 for st in switch_t): rdead.append((row, t, i, nm))
resp = []
for row, t, i, nm in rdead:
    en = ENT[i]; x0, y0 = en["xs"][0], en["ys"][0]
    nxt = next(((r2, t2, m2) for r2, t2, i2, m2, d2 in cre_ev if t2 > t and m2.get("2") == 3 and family(defname(m2.get("13"))) == family(nm) and math.hypot(m2["3"] - x0, m2["4"] - y0) < 30), None)
    resp.append({"row": row, "t": t, "id": i, "def": nm, "same_spot_create": nxt and {"row": nxt[0], "t": nxt[1], "id": nxt[2]["0"], "def": defname(nxt[2]["13"]), "after_s": round(nxt[1] - t, 1), "same_id": nxt[2]["0"] == i}})
resources = {"hp_byte_step_per_hit_by_family": {k: v.most_common(4) for k, v in rsteps.items()},
             "destroyed_by_hits": len(rdead), "destroy_events": resp[:20],
             "how_it_works": "resources have an hp byte (move 7, 255 = full) that drops per hit (step depends on family and tool, table below; tree mode %s => ~%d hits); at 0 the server sends {7: 0, 10: 1} (destroy animation, wood-destroy/stone-destroy.mp3), then remove. Respawn: see same_spot_create (a later create of the same family within 30 units, new id)." % (rsteps["tree"].most_common(1)[0][0], round(255 / rsteps["tree"].most_common(1)[0][0])),
             "respawned_same_spot": sum(1 for x in resp if x["same_spot_create"]), "respawn_after_s": sorted(x["same_spot_create"]["after_s"] for x in resp if x["same_spot_create"])}
put("3_entities", {
    "resources": resources,
    "categories": {"0": "creature (field 22 kind, 13 owner = pet)", "1": "player", "2": "effect (no def, field 7 = 9)", "3": "static object (field 13 = def index into decoder/names.json)", "4": "projectile (7 kind, 10/11 owner id)"},
    "counts_by_category": dict(collections.Counter(en["cat"] for en in ENT.values())),
    "objects": objs, "object_create_fields": {"11": "1 on a freshly (re)spawned gift; the same frame carries move 7=255 (spawn pop-in)", "15": "owner clan id (476..483, matches clan list ids)", "16": "owner player id (player-placed structure)", "12": "rare, value listed"},
    "creatures": creatures, "players": {"distinct_other": len(set(players) - OWNS), "own_lives": len(OWNS), "create_field_values": {k: v.most_common(8) for k, v in pl_f.items()}},
    "projectiles": projs, "effects": {"n": len(effects), "examples": effects[:4], "note": "category 2 creates carry only position, angle and 7=9; rows %s..%s (t %s..%s s), the same time as cannon/bow audio (turret and bow use)" % (min(e["row"] for e in effects), max(e["row"] for e in effects), min(e["t"] for e in effects), max(e["t"] for e in effects))},
    "evidence_ok": "yes", "implemented": "partial: static objects from a fixed snow list (world_atl4.json), 3 animal kinds (game_config animals: kind 2/10/66 templates), players; no projectiles (cat 4), no effects (cat 2), no gifts behaviour, no biome sets"})

# ---------------------------------------------------------------- inventory deltas helper
inv_state = {}; inv_delta = {}
for row, t, i in inv_ev:
    full = len(i) >= 6
    if full: inv_state = {}
    d = {k: v - inv_state[k] for k, v in i.items() if not full and k in inv_state and v != inv_state[k]}
    inv_state.update(i); inv_delta[row] = (d, dict(inv_state), full)
xp_by_row = {}; prev = None
for row, t, v in xp_ev:
    xp_by_row[row] = v - prev if prev is not None and v >= prev else None; prev = v
rx_rows = [r["i"] for r in rows if r["k"] == "rx"]
ROWPOS = {r["i"]: n for n, r in enumerate(rows)}
def near_rows(row, before=2, after=2):
    k = bisect.bisect_left(rx_rows, row); return rx_rows[max(0, k - before):k + after + 1]

# ---------------------------------------------------------------- 4. chests (gift objects)
gifts = collections.OrderedDict()
for row, t, i, m, d in cre_ev:
    nm = defname(m.get("13")) if m.get("2") == 3 else None
    if nm and nm.startswith("gift"):
        g = gifts.setdefault(i, {"id": i, "def": nm, "x": m["3"], "y": m["4"], "creates": [], "hits": [], "open": None, "removes": []})
        g["creates"].append({"row": row, "t": t, "spawn_flag_11": m.get("11"), "dist_own": d and round(d)})
for row, t, i, nm, f, d in obj_ev:
    if i in gifts:
        if "7" in f and "8" in f: gifts[i]["hits"].append({"row": row, "t": t, "hp_byte": f["7"], "angle": f["8"], "dist_own": d and round(d)})
        if "10" in f and gifts[i]["open"] is None: gifts[i]["open"] = {"row": row, "t": t, "dist_own": d and round(d)}
        if "7" in f and f["7"] == 255 and "8" not in f: gifts[i].setdefault("spawn_pop", []).append({"row": row, "t": t})
for row, t, i, e, d in rem_ev:
    if i in gifts: gifts[i]["removes"].append({"row": row, "t": t, "dist_own": d and round(d)})
ginfo = rare[75]
for g in gifts.values():
    if g["open"]:
        gi = next((x for x in ginfo if abs(x[0] - g["open"]["row"]) <= 2 and x[2].get("gi") == int(g["def"][4:])), None)
        g["open"]["gift_info_to_us"] = gi and {"row": gi[0], "t": gi[1], "msg": gi[2]}
        if gi:
            d, st, _ = inv_delta.get(gi[0], ({}, {}, False))
            g["open"]["inventory_delta_same_frame"] = d; g["open"]["xp_delta_same_frame"] = xp_by_row.get(gi[0])
        steps = [g["hits"][k]["hp_byte"] - g["hits"][k + 1]["hp_byte"] for k in range(len(g["hits"]) - 1)]
        g["hp_steps"] = steps
        hy = []
        for h in g["hits"]:
            for rr in near_rows(h["row"], 1, 1):
                if rr in inv_delta and rr != (gi and gi[0]): hy.append(inv_delta[rr][0])
        g["hit_inventory_deltas"] = hy[:6]
    g["n_hits"] = len(g["hits"])
opened = [g for g in gifts.values() if g["open"]]
ours = [g for g in opened if g["open"].get("gift_info_to_us")]
respawn = []
for g in gifts.values():
    for c in g["creates"]:
        if c["spawn_flag_11"]: respawn.append({"id": g["id"], "def": g["def"], "row": c["row"], "t": c["t"], "x": g["x"], "y": g["y"]})
first_hit = [g["hits"][0]["hp_byte"] for g in opened if g["hits"]]
put("4_chests", {
    "what": "Chests are the gift<N> static objects (names.json 216..313; seen: %s). They stand in the world like resources, are hit with any tool, lose a 0..255 hp byte per hit, and pop open at 0." % ", ".join(sorted({g["def"] for g in gifts.values()})),
    "counts": {"gift_ids_seen": len(gifts), "opened_in_view": len(opened), "opened_by_us": len(ours), "spawned_in_view": len(respawn), "gift_info_msgs": len(ginfo)},
    "how_it_works": [
        "hit: client attack op (sp3 10 / atl4 4) with the gift in reach -> server move record on the gift {7: hp byte, 8: hit angle 0..255, 9: 1}; hp byte goes 255 -> 196 -> 137 -> 78 -> 20 -> 0 with the usual tools (step 59, five hits; a stronger hit took 129, first values %s)." % sorted(collections.Counter(first_hit).items()),
        "each non-final hit also pays a small gather yield like a bush (own inventory +5 food and +5 XP for gift52, or stone/gold for others; see hit_inventory_deltas).",
        "open: the hit that reaches 0 carries {7: 0, 10: 1}. To the opener only, in the same frame: type sp3 3 / atl4 75 {gi: N of giftN, i: 2 when a slot-4 bonus is paid} + inventory (atl4 53) with the loot + XP (atl4 27). Then 0..2 frames of move records with 10: 1 (and for gift68 position deltas: the box flies off), then remove (atl4 87).",
        "loot seen (inventory delta in the open frame): " + "; ".join("%s -> %s xp %s" % (g["def"], g["open"].get("inventory_delta_same_frame"), g["open"].get("xp_delta_same_frame")) for g in ours),
        "spawn: a new gift appears with create field 11 = 1 plus a move with 7 = 255 in the same frame (pop-in animation); opened gifts do not come back at the same spot within the session (new ids appear elsewhere).",
        "client audio: pumpkin-open.mp3 / chest-open.mp3 and pumpkin-destroy*.mp3 are fetched at the open frames (rows near 4287, 22951)."],
    "gifts": list(gifts.values()), "gift_info_msgs": [{"row": r, "t": t, "msg": m} for r, t, m in ginfo], "spawns": respawn,
    "evidence_ok": "yes (6 opens by us with loot; hp steps, spawn flag); loot tables per gift number only partly (one sample per gift kind)",
    "implemented": "no: gifts in world_atl4.json are inert static objects (resourceOf(gift) gives 1 food via gather_slot.gift, no hp, no open, no type 75, no respawn)"})

# ---------------------------------------------------------------- 5. items
sel = tx_ops.get(6, []); unl = tx_ops.get(2, [])
echo8 = [(row, t, f["8"]) for row, t, i, f in own_rec if "8" in f]
sel_c = collections.Counter(iname(v) or v for _, _, v in sel)
def reply(row, secs=1.0, types=(53, 27, 36)):
    k = ROWPOS[row]; t0 = rows[k]["w"]; out = []
    for r in rows[k + 1:k + 120]:
        if r["w"] - t0 > secs: break
        for m in r.get("m") or []:
            if isinstance(m, dict) and (m.get("_a") in types or (m.get("_a") == 84 and m.get("0") in OWNS and "8" in m)):
                out.append(dict(clean(m), row=r["i"], t=rel(r), atl4=m.get("_a")))
    return out
unlocks = []
for row, t, v in unl:
    it = ITEMS.get(str(v), {})
    rp = reply(row)
    dd = collections.Counter()
    for x in rp:
        if x.get("atl4") == 53:
            for kk, vv in inv_delta.get(x["row"], ({}, {}, False))[0].items(): dd[kk] += vv
    unlocks.append({"row": row, "t": t, "item": v, "name": it.get("name"), "cat": it.get("cat"), "items_json_cost": it.get("cost"), "level": it.get("level"),
                    "server_reply": rp[:4], "inventory_delta_1s": dict(dd)})
icount = [{"row": r, "t": t, "B": m["B"], "decoded": [[b >> 8, iname(b >> 8), b & 255] for b in m["B"]]} for r, t, m in rare[36]]
foods = collections.Counter(); eat_ev = []
sel_rows = [r for r, t, v in sel]
for row, t, i, f in own_rec:
    k = bisect.bisect_left(sel_rows, row) - 1; held = sel[k][2] if k >= 0 else None
    if "11" in f and "15" in f:
        foods[iname(held)] += 1
        if len(eat_ev) < 6: eat_ev.append({"row": row, "t": t, "held": iname(held), "heal": f["11"], "hp": f.get("12"), "anim_ms": f["15"]})
inv_slots = {}
for k in "012345":
    vals = [(row, t, i[k]) for row, t, i in inv_ev if k in i]
    inv_slots[k] = {"name": {"0": "food", "1": "wood", "2": "stone", "3": "gold", "4": "slot 4 (gift bonus)", "5": "slot 5"}[k], "updates": len(vals),
                    "max": max((v for _, _, v in vals), default=None), "final": vals[-1][2] if vals else None, "first_nonzero": next(({"row": r, "t": t, "v": v} for r, t, v in vals if v), None)}
skin = [(row, t, f["14"]) for row, t, i, f in own_rec if "14" in f]
put("5_items", {
    "select": {"tx": "sp3 op 6 (atl4 10), value = items.json id", "count": len(sel), "span": span([(r, t) for r, t, v in sel]), "by_item": sel_c.most_common(),
               "server_echo": "own move record field 8 = held item id (%d echoes, e.g. %s)" % (len(echo8), echo8[:3]),
               "how_it_works": "client sends select op with the item id; the next own move record carries 8 = id (0 = hand). Food/structure items are consumed or placed by the next attack op; tools change walk speed (sp3_facts walk.item_speed_factor_vs_hand)."},
    "unlock_craft": {"tx": "sp3 op 2 (atl4 1), value = items.json id", "count": len(unl), "span": span([(r, t) for r, t, v in unl]),
                     "how_it_works": "client picks an item (age-up item choice / upgrade). Server answers with item_count (atl4 36) B = [id*256 + 0] (item now owned, 0 placed), an inventory update when the item costs resources (Golden Axe: wood and stone drop), and for tools an own record 8 = id (auto-equip).",
                     "events": unlocks},
    "item_count_msgs": {"count": len(icount), "note": "B = [item*256 + n]: n = number of that structure currently placed (counts up per placement, down when one is destroyed); 0 right after an unlock", "events": icount[:20]},
    "eaten": {"by_item": foods.most_common(), "item_basis": "last select op before the heal record", "examples": eat_ev, "how_it_works": "select food, attack op -> own record {11: healed amount, 12: hp, 15: 350 anim ms}, inventory food cost paid (sp3_facts hp.food_instant_heal)"},
    "inventory_slots": inv_slots, "inventory_msg": "type sp3 54 (atl4 53) i = {slot: absolute count}; full 6 slots at join, then only changed slots",
    "own_field14_changes": {"values": skin, "note": "own field 14 changes right after clan create/join/kick (963 at 151.9 s, 962 at 983 s, 967 at 2070.8 s): clan badge/skin id, not a hat"},
    "hats_accessories_shop": "not observed: no shop/market message, no hat equip op; the only cosmetic-like change is own field 14 at clan events",
    "evidence_ok": "yes for select/unlock/eat/place; costs for unlocks partly (inventory delta of the reply)",
    "implemented": "partial: select (OP.SELECT), eat and place (Player.useItem) exist; unlock/craft op (atl4 1) and item_count on unlock are not handled, every item is usable without unlocking, no costs for tools"})

# ---------------------------------------------------------------- 6. animals
st = collections.defaultdict(collections.Counter); dmg = collections.defaultdict(collections.Counter); bars = collections.Counter()
for row, t, i, f in cr_ev:
    k = cname(ENT.get(i, {}).get("kind"))
    if "7" in f: st[k][f["7"]] += 1
    if "10" in f: dmg[k][f["10"]] += 1
    if "9" in f: bars[k] += 1
cr_dead = []
for row, t, i, e, d in rem_ev:
    if e["cat"] == 0 and i not in PETS:
        last = [x for x in cr_ev if x[2] == i and x[1] <= t][-3:]
        if any(x[3].get("9") == 0 for x in last) or any(x[3].get("7") in (18,) for x in last):
            cr_dead.append({"row": row, "t": t, "id": i, "kind": cname(e["f"].get("22") if e.get("f") else ENT.get(i, {}).get("kind")), "dist_own": d and round(d), "last_records": [x[3] for x in last]})
own_dmg = [(row, t, f) for row, t, i, f in own_rec if "10" in f]
pet_info = {}
for l in lives:
    en = ENT.get(l["pet"])
    pet_info[l["pet"]] = en and {"kind": en["kind"], "name": cname(en["kind"]), "create": en["f"]}
pet_states = collections.Counter(f.get("7") for row, t, i, f in pet_rec if "7" in f)
pet_dmg = collections.Counter(f.get("10") for row, t, i, f in pet_rec if "10" in f)
tame = []
for row, t, x in tx_json.get(18, []):
    cid = x.get("_"); en = ENT.get(cid)
    later = [y for y in tx_json.get(14, []) if y[2].get("I") == cid]
    k2 = bisect.bisect_left([r for r, _, _ in sel], row) - 1
    seq = [{"row": a, "t": b, "rec": f} for a, b, i2, f in cr_ev if i2 == cid and a >= row and "12" in f][:3]
    seq += [{"row": a, "t": b, "remove": True} for a, b, i2, e2, d2 in rem_ev if i2 == cid and a >= row][:1]
    seq += [{"row": a, "t": b, "create_as_pet": clean(m2)} for a, b, i2, m2, d2 in cre_ev if i2 == cid and a >= row and m2.get("13") in OWNS][:1]
    dd = collections.Counter()
    for x2 in reply(row, 1.5, (53,)):
        for kk, vv in inv_delta.get(x2["row"], ({}, {}, False))[0].items(): dd[kk] += vv
    tame.append({"row": row, "t": t, "msg": x, "held_item_before": iname(sel[k2][2]) if k2 >= 0 else None, "sequence_after": sorted(seq, key=lambda q: q["row"]), "inventory_delta_1_5s": dict(dd), "target": en and {"cat": en["cat"], "kind": en["kind"], "name": cname(en["kind"]) if en["cat"] == 0 else None, "create": en["f"]},
                 "reply": reply(row, 1.5, (53, 27, 36, 75)), "pet_commands_on_it_after": [{"row": a, "t": b, "S": c.get("S")} for a, b, c in later]})
pcmd = collections.Counter(x.get("S") for _, _, x in tx_json.get(14, []))
STATE = {1: "idle", 2: "walk", 33: "attack windup?", 34: "attack/chase", 66: "flee/hurt?", 18: "dying?", 9: "spawn", 3: "?", 17: "?", 65: "?"}
put("6_animals", {
    "kinds_seen": [{"kind": c["kind"], "name": c["name"], "ids": c["distinct_ids"]} for c in creatures],
    "state_field7_by_kind": {k: v.most_common(6) for k, v in st.items()}, "state_guess": STATE,
    "damage_taken_field10_by_kind": {k: v.most_common(6) for k, v in dmg.items()}, "hp_bar_updates_field9": dict(bars),
    "creature_deaths_in_view": {"n": len(cr_dead), "events": cr_dead[:8]},
    "damage_to_us": {"n": len(own_dmg), "by_cause": {k: v.get("n") for k, v in FACTS.get("hp", {}).get("value", {}).get("damage_by_cause", {}).items()},
                     "how_it_works": "own record {10: damage, 12: new hp, 13: 1}; creature attack shows as creature move 7 = 34 near the player (sp3_facts hp.damage_by_cause)"},
    "own_pet": {"by_life": pet_info, "states_field7": pet_states.most_common(8), "damage_taken_field10": pet_dmg.most_common(6),
                "how_it_works": "at join the server creates the player's pet as a category-0 entity with id = own id + 1 and 13 = owner id; own_info (atl4 59) i = pet id. The pet follows, fights (7 = 34, its targets lose hp bar 9 and take 10/11) and takes damage (pet 9 = its hp bar, 10 = damage)."},
    "pet_commands": {"tx": "JSON {type: sp3 14 (atl4 48), I: pet id, S: mode}", "count": len(tx_json.get(14, [])), "S_values": pcmd.most_common(),
                     "note": "S 0..4 = pet behaviour mode buttons; replies are only pet state changes (7 = 34 after S 4/1, 2 = walk after S 2), no ack message"},
    "taming": {"tx": "JSON {type: sp3 18 (atl4 45), _: entity id}", "events": tame,
               "note": "one sample: JSON {type 18, _: creature id} on a wild Ice Golem in view -> the creature gets a move record {12: 1} (taming in progress) -> ~5 s later remove + create of the SAME id as a pet (13 = owner id, 16 = owner clan id, 17 = 0); pet commands then target it. What the player must hold or pay (inventory_delta_1_5s mixes gathering) and the success chance are not shown; tame_success/tame_fail.mp3 are only preloaded at page load."},
    "behaviour": "wild creatures wander at 6-7 units/frame (sp3_facts creatures), switch to 7 = 34 (attack) when a player is near, deal 3..20 damage per hit to the player; hp is a 0..255 bar (field 9), never absolute",
    "evidence_ok": "partial: kinds, states, damage to us, pet behaviour yes; kills by us and kill XP/drops not observed (sp3_facts unknown); taming one sample",
    "implemented": "partial: world.js World.animals wander + hurtAnimal (hp bar 9, kill XP guess); no aggression/attacks on players, no pets, no pet commands, no taming, only 3 kinds"})

# ---------------------------------------------------------------- 7. structures
placed = [(row, t, i, m) for row, t, i, m, d in cre_ev if m.get("2") == 3 and m.get("16") in OWNS]
placed_first = {}
for row, t, i, m in placed: placed_first.setdefault(i, (row, t, defname(m["13"]), m["3"], m["4"]))
plist = [{"row": r, "t": t, "msg": m} for r, t, m in rare[81]]
ratio = []
for r, t, m in rare[81]:
    for o in m["o"]:
        if len(o) >= 3 and o[0] in placed_first: ratio.append((round(placed_first[o[0]][3] / o[1], 2), round(placed_first[o[0]][4] / o[2], 2)))
struct_hits = collections.defaultdict(lambda: {"hits": 0, "destroyed": 0, "steps": collections.Counter(), "other": collections.Counter()})
lasthp = {}
for row, t, i, nm, f, d in obj_ev:
    if not nm or natural(nm) or nm.startswith("gift"): continue
    s = struct_hits[nm]
    if "8" in f: s["hits"] += 1
    if "10" in f: s["destroyed"] += 1
    if "7" in f:
        if i in lasthp and lasthp[i] > f["7"] and "8" in f: s["steps"][lasthp[i] - f["7"]] += 1
        lasthp[i] = f["7"]
    for k in f:
        if k not in ("7", "8", "9", "10"): s["other"][k] += 1
decay = collections.defaultdict(list); dlast = {}
for row, t, i, nm, f, d in obj_ev:
    if not nm or natural(nm) or nm.startswith("gift") or set(f) != {"7"} or f["7"] == 255: continue
    if i in dlast and 0 < t - dlast[i][0] < 60 and dlast[i][1] > f["7"]: decay[nm].append((round((dlast[i][1] - f["7"]) / (t - dlast[i][0]), 3), dlast[i][1] - f["7"], round(t - dlast[i][0], 1), row))
    dlast[i] = (t, f["7"])
decay_out = {}
for nm, v in sorted(decay.items()):
    rates = sorted(x[0] for x in v)
    decay_out[nm] = {"samples": len(v), "hp_byte_per_s_median": rates[len(rates) // 2], "step_top": collections.Counter(x[1] for x in v).most_common(3),
                     "interval_s_top": collections.Counter(round(x[2]) for x in v).most_common(3), "s_to_zero_from_255": round(255 / rates[len(rates) // 2]) if rates[len(rates) // 2] else None, "example_rows": [x[3] for x in v[:3]]}
door = [(row, t, f) for row, t, i, nm, f, d in obj_ev if nm == "wooden-door"][:10]
turret = [(row, t, f) for row, t, i, nm, f, d in obj_ev if nm and "turret" in nm][:6]
spike_dmg = {k: v for k, v in FACTS.get("hp", {}).get("value", {}).get("damage_by_cause", {}).items() if "object" in k}
put("7_structures", {
    "own_placed": {"count": len(placed_first), "by_def": collections.Counter(v[2] for v in placed_first.values()).most_common(), "span": span(sorted((v[0], v[1]) for v in placed_first.values()))},
    "how_it_works": ["place: select a structure (op 6) then attack op -> server create (atl4 79) cat 3 with 13 = def, 15 = clan id of the owner, 16 = owner id, 5 = angle; "
                     "plus placed_list (sp3 85 / atl4 81) {o: [[id, x/58, y/58, def name]], p: total placed} and item_count (atl4 36) B = [item*256 + placed count] and an inventory update (cost).",
                     "removal of an own structure (destroyed or limit replace): placed_list {o: [[id]]} and item_count with the lower count.",
                     "structures take hits like resources: move {7: hp byte, 8: angle, 9: 1}; at 0 {10: 1} then remove; amounts per hit by tool in steps below",
                     "turrets (stone/amethyst-turret): move field 9 alone = turret aim angle (40+29 records), and they fire projectiles (cat 4 with owner 10 = turret id, see 3_entities projectiles)",
                     "doors (wooden-door): field 9 alone toggles (open/close, open-door1/close-door1.mp3), only for the owner clan",
                     "spikes hurt players that touch them: own damage 3..5 per contact near amethyst/diamond/golden/stone spikes (sp3_facts hp damage_by_cause object:*)"],
    "placed_list_msgs": {"count": len(plist), "events": plist[:12], "coord_scale": collections.Counter(ratio).most_common(3)},
    "hits_by_structure": {k: {"hits": v["hits"], "destroyed_records": v["destroyed"], "hp_steps_top": v["steps"].most_common(5), "other_fields": dict(v["other"])} for k, v in sorted(struct_hits.items())},
    "door_records": door, "turret_records": turret, "spike_damage_to_us": spike_dmg,
    "decay": {"how_it_works": "structures lose hp over time with no hit: periodic move records carrying only 7 (hp byte), e.g. own stone-spike 4976918 255 -> 243 -> 230 -> ... -> 6 -> {7: 0, 10: 1} at 544.25 s, then placed_list {o: [[4976918]]} and item_count down. Rates per def below (hp byte per second; s_to_zero = full decay time)", "by_def": decay_out},
    "evidence_ok": "yes for placement, list/count messages, hits/destroy, decay, spike damage; turret damage numbers partial",
    "implemented": "partial: Player.useItem places with cost/limit/item_count and World.hazards spike damage; no structure hp/destroy/decay, no placed_list (atl4 81), no doors, no turrets, no clan field 15"})

# ---------------------------------------------------------------- 8. UI and client features
inp = []
for r in rows:
    if r["k"] == "input":
        for e in r["ev"]: inp.append((r["i"], e))
keys = collections.Counter(e[3] for _, e in inp if e[2] == "kd")
txs = [(r["w"], r) for r in rows if r["k"] == "tx"]; txw = [x[0] for x in txs]
def follow(ms, win=0.25):
    k = bisect.bisect_left(txw, ms / 1000.0); out = collections.Counter()
    while k < len(txs) and txs[k][0] <= ms / 1000.0 + win:
        r = txs[k][1]
        for b, v in r.get("ops") or []:
            if b not in (0, 8, 4): out["op%d(atl4 %s)" % (b, FMAP["ops"].get(str(b), {}).get("atl4"))] += 1
        j = r.get("json")
        for x in (j if isinstance(j, list) else [j]) if j is not None else []:
            if isinstance(x, dict): out["json%s(atl4 %s)" % (x.get("type"), FMAP["types"].get(str(x.get("type")), {}).get("atl4"))] += 1
        k += 1
    return out
chat_open = False; outside = []
for _, e in inp:
    if e[2] != "kd" or (len(e) > 5 and e[5]): continue
    if e[3] in ("Enter", "NumpadEnter"): chat_open = not chat_open; outside.append(e); continue
    if not chat_open: outside.append(e)
keymap = {}
for kname, n in keys.most_common():
    c = collections.Counter(); cnt = 0
    for e in outside:
        if e[3] == kname:
            cnt += 1; c.update(set(follow(e[1])))
    keymap[kname] = {"presses": n, "presses_outside_chat": cnt, "tx_within_250ms": [[k, v] for k, v in c.most_common(4) if v >= max(2, 0.2 * cnt)]}
clicks = collections.Counter(e[3] for _, e in inp if e[2] == "md")
GUESS = {"KeyW": "move up", "KeyA": "move left", "KeyS": "move down", "KeyD": "move right", "Space": "attack (hold)", "Enter": "open/send chat",
         "KeyE": "auto-attack toggle?", "Digit1": "hotbar slot", "Digit2": "hotbar slot", "KeyT": "chat (also typed letters while chatting)", "Backspace": "chat editing"}
http_game = collections.Counter()
for i, t, meth, u in http:
    host = u.split("/")[2]
    if REAL not in host: continue
    p = u.split(REAL, 1)[1].split("?")[0]
    k = "audio" if p.startswith("/audio/") else "image" if re.search(r"\.(png|svg|jpg|webp)$", p) else p
    http_game[(host.replace(REAL, "<game>"), k)] += 1
audio = collections.OrderedDict()
for i, t, meth, u in http:
    if "/audio/" in u and REAL in u.split("/")[2]:
        f = re.sub(r"\d*\.mp3$", "", u.rsplit("/", 1)[1])
        a = audio.setdefault(f, {"n": 0, "first": {"row": i, "t": t}}); a["n"] += 1; a["last"] = {"row": i, "t": t}
img_dirs = collections.Counter()
for i, t, meth, u in http:
    if REAL in u.split("/")[2] and re.search(r"\.(png|svg|jpg|webp)", u):
        p = u.split(REAL, 1)[1].split("?")[0]; img_dirs["/".join(p.split("/")[:3])] += 1
clan_sub = collections.Counter(m.get("m") for _, _, m in rare[68])
clan_ex = {}
for r, t, m in rare[68]: clan_ex.setdefault(m.get("m"), dict(m, row=r, t=t))
clan_tx = collections.Counter(x.get("o") for _, _, x in tx_json.get(9, []))
chat_tx = tx_json.get(0, [])
put("8_ui", {
    "keyboard": {"total_keydowns": sum(keys.values()), "keys": keymap, "guess": GUESS,
                 "note": "chat state toggled by Enter; presses_outside_chat = non-repeat presses while the chat box is closed; tx_within_250ms lists client messages that follow such a press in at least 20% of cases (aim, heartbeat, re-key excluded). Keys outside chat with no tx are client-only UI (menus, map, zoom) or unbound"},
    "mouse": {"button_downs": dict(clicks), "moves": sum(1 for _, e in inp if e[2] == "mm"), "wheel": sum(1 for _, e in inp if e[2] == "wh"), "focus_blur": [sum(1 for _, e in inp if e[2] == "focus"), sum(1 for _, e in inp if e[2] == "blur")],
              "note": "left button = attack op (sp3 10); blur makes the client send move-key value 5 (release all)"},
    "chat": {"tx": len(chat_tx), "rx": len(rare[39]), "span": span([(r, t) for r, t, x in chat_tx]), "how_it_works": "JSON [{type: sp3 0 (atl4 39), msg, tm}] -> rx bubble {i: sender id, m, mt: 1} to everyone in view plus, for clan members, a clan log entry {m, tm: clan id, s, n: name, p: sender id}"},
    "clan": {"tx_actions_o": clan_tx.most_common(), "rx_subops_m": clan_sub.most_common(), "rx_examples": clan_ex,
             "how_it_works": ["JSON {type: sp3 9 (atl4 68), o: action, n: arg}; o 25 + n = create clan with name n -> rx m 23 {l, n, x: clan id}, m 28 member list [[name, id_score?, 1, 0, player id, 0]], m 40 [id, name] (new clan in list), own field 14 changes",
                              "o 45 = open the clan list -> rx m 28 member list / m 46 (empty list) / m 22 [clan names]", "o 53 / o 12 / o 11 = other clan actions (no direct reply seen for 12/11/53 except own state)",
                              "o 32 + n = member action on member id (kick/promote) -> rx m 39 then m 28", "m 36 every few seconds: [x, y, 0, x2, y2, member id] = clan member positions on the minimap",
                              "m 69 at join: full clan list [[id, name]]; m 64 = clan removed (id); m 33 = join request {n: player id, p}; m 60 = ?",
                              "server announcement (atl4 52) 'The clan [14] has captured the totem' (totem object, def 0 'totem')"]},
    "leaderboard": {"msgs": sum(v["n"] for k, v in rx_stat.items() if FMAP["types"].get(str(k), {}).get("atl4") == 64), "note": "atl4 64 every ~1 s with the chained-XOR board (sp3_facts leaderboard) plus ob/pa minimap markers"},
    "quests": {"msgs": [{"row": r, "t": t, "m": m} for r, t, m in rare[37]], "how_it_works": "type sp3 74 (atl4 37) {o: quest 1..4, n: completion count}; quest 1 completes 3 times, 2/3/4 once per life; arrives together with XP and inventory gains (quest rewards?)"},
    "event_counter_44": [{"row": r, "t": t, "m": m} for r, t, m in rare[44]],
    "death_scoreboard": [{"row": r, "t": t, "m": m} for r, t, m in rare[6]],
    "respawn": "after death the client sends re-key op every ~1.3 s while spectating, then a new join JSON (atl4 1) and token (atl4 28); see sp3_facts death_respawn",
    "http": {"game_hosts": [[list(k), v] for k, v in http_game.most_common()], "audio_cues": audio, "image_dirs": img_dirs.most_common(20),
             "note": "audio files are fetched the first few times a sound plays, so they mark client events: pumpkin-open (gift open), chest-open, place-building, eat, open/close-door, cannon/bow/mini-bullet (turrets, weapons), labrys/big-sword (weapon swings), time-stopping-bubble/flame-dash/vampiric-dash/viscous-* (creature or pet skills), burn-effect, ocean-wave, levelup, notification (clan/chat), deflagration (volcanic meteor?), ui_scoreboard (death screen)"},
    "map_menu_settings_shop_daily": "not observed as server messages: no shop/market, settings, daily reward or map packets; UI-only keys produce no tx",
    "evidence_ok": "yes for chat, clan protocol, quests, pet commands, unlock picks; key bindings estimated from tx correlation",
    "implemented": "partial: chat bubbles (World.chat), leaderboard (World.board); no clan protocol, no quests, no clan chat log, no announcements"})

# ---------------------------------------------------------------- 9. timers, boosts, status
pads = [i for i, en in ENT.items() if en["cat"] == 3 and en["name"] and "boost-pad" in en["name"]]
boost = []
P2 = {}
for i in pads:
    en = ENT[i]; P2[i] = (en["xs"][0], en["ys"][0], en["name"])
for k in range(1, len(own_pos)):
    a, b = own_pos[k - 1], own_pos[k]
    if a[4] != b[4]: continue
    sp = math.hypot(b[2] - a[2], b[3] - a[3])
    if 70 < sp < 400:
        near = [(round(math.hypot(px - a[2], py - a[3])), nm) for px, py, nm in P2.values() if math.hypot(px - a[2], py - a[3]) < 260]
        if near: boost.append({"row": b[0], "t": b[1], "speed_per_frame": round(sp, 1), "pad": min(near)})
eps = []
for e in boost:
    if eps and e["t"] - eps[-1][-1]["t"] < 1.0: eps[-1].append(e)
    else: eps.append([e])
own9 = [(row, t, f) for row, t, i, f in own_rec if "9" in f or "16" in f]
own7 = collections.Counter(f["7"] for row, t, i, f in own_rec if "7" in f)
defl = audio.get("deflagration")
put("9_world_events", {
    "biome_timer": {"msgs": [{"row": r, "t": t, "m": m} for r, t, m in rare[32]], "how_it_works": "sent on connect, at every join and at every phase switch; d = ms left in the phase (480000, 960000 for phase 0); see 2_biomes"},
    "server_announce": [{"row": r, "t": t, "m": m} for r, t, m in rare[52]],
    "markers_80": {"n": len(rare[80]), "events": [{"row": r, "t": t, "m": m} for r, t, m in rare[80]], "interval_s": [round(b[1] - a[1], 1) for a, b in zip(rare[80], rare[80][1:])],
                   "note": "type sp3 79 (atl4 80) {o, j} 0..100 every ~130 s regardless of phase: a map event position (supply drop / gift spawn / boss) on the minimap; meaning not confirmed"},
    "markers_65": {"n": len(rare[65]), "events": [{"row": r, "t": t, "m": m} for r, t, m in rare[65]], "interval_s": [round(b[1] - a[1], 1) for a, b in zip(rare[65], rare[65][1:])],
                   "note": "type sp3 48 (atl4 65) {o, j} every 30.0 s from 1786.2 s (volcanic phase start + 2.5 s) to %s s (the volcanic phase ends at 2263.8 s; we were dead/away from 2218 s): a volcanic-phase event position, probably meteor strikes (volcanic-meteorite object seen once); not confirmed" % (rare[65][-1][1] if rare[65] else None)},
    "boost_pads": {"pad_ids_seen": len(pads), "fast_frames_near_pad": len(boost), "episodes": [{"start": x[0], "frames": len(x), "max_speed": max(e["speed_per_frame"] for e in x)} for x in eps][:10],
                   "note": "own displacement above 70 units/frame (hand cruise 46) within 260 of a boost/mega-boost pad = the pad pushes the player (no dedicated message; the boost is plain position updates)"},
    "own_state_field7": own7.most_common(), "own_fields_9_16": own9[:8],
    "status_effects": "not observed as dedicated messages: own records only carry 7/8/10/11/12/13/14/15 (+9/16 twice); burn-effect.mp3 fetched once (1942.8 s) next to flame-dash1 (volcanic phase creature skill)",
    "day_night": "no day/night message; the 'darkness' look is the dark biome phase (b = 2)",
    "evidence_ok": "yes for timer/phases, announce, marker cadence; marker meaning partial; boost pads not crossed (no evidence)",
    "implemented": "no: timer replayed once static, no announcements, no markers 80/65, boost pads have collide 0 and no push, no events"})

# ---------------------------------------------------------------- 10. feature table
S = DOC["sections"]
FEAT = [
    ("Rotating world biome (6 phases, timer 32, object swap)", len(rare[32]), "yes", "no", "world_atl4.json fixed snow world; timer replayed static (hosted/world.js Player constructor setup replay)", 1),
    ("Biome resource sets (snow/dark/desert/sea/volcanic/plain objects)", sum(o["distinct_ids"] for o in S["3_entities"]["objects"] if natural(o["name"])), "yes", "partial", "only snow-* + gifts/walls from world_atl4.json", 2),
    ("Resource depletion + respawn (hp byte 7 per hit, destroy 10, same-spot respawn ~120 s)", resources["destroyed_by_hits"], "yes", "no", "world.js Player.swing gathers forever, objects never deplete", 3),
    ("Chests (gift objects: hp, open, loot, type 75, spawn)", len(gifts), "yes", "no", "gift = inert static (game_config gather_slot.gift)", 4),
    ("Own pet (spawned with player, follows/fights)", len(PETS), "yes", "no", "world.js Player.join creates no pet", 5),
    ("Animal aggression and attacks on players", S["6_animals"]["damage_to_us"]["n"], "yes", "no", "world.js World.animals wander only", 6),
    ("Projectiles (turrets, weapons, creature skills)", sum(p["n"] for p in projs), "partial", "no", "no category-4 entities", 7),
    ("Turrets (aim field 9, shots)", sum(1 for x in obj_ev if x[3] and "turret" in x[3]), "partial", "no", "turret = static collide only", 8),
    ("Structure hp / destroy by hits", sum(v["hits"] for v in S["7_structures"]["hits_by_structure"].values()), "yes", "no", "placed structures are indestructible", 9),
    ("Structure decay (~1.1 hp byte/s, gone in ~225 s)", sum(v["samples"] for v in decay_out.values()), "yes", "no", "placed structures live until the owner leaves (World.remove)", 9.5),
    ("Unlock/craft item op (atl4 1) + item_count + cost", len(unl), "yes", "no", "op dropped in world.js Player.onFrame", 10),
    ("Clan system (JSON 68, rx 68 sub-ops, clan field 15, member minimap)", len(tx_json.get(9, [])) + len(rare[68]), "yes", "no", "clan list replayed static (world_atl4 join)", 11),
    ("Doors (toggle field 9, owner clan)", sum(1 for x in obj_ev if x[3] == "wooden-door"), "partial", "no", "door = solid static", 12),
    ("Placed list (atl4 81)", len(rare[81]), "yes", "no", "not sent", 13),
    ("Quests (atl4 37)", len(rare[37]), "partial", "no", "not sent", 14),
    ("Boss markers (board ob) per phase", len(boss), "partial", "no", "World.board sends no ob/pa", 15),
    ("Map event markers (atl4 80 / 65)", len(rare[80]) + len(rare[65]), "partial", "no", "not sent", 16),
    ("Server announcement banner (atl4 52)", len(rare[52]), "yes", "no", "not sent", 17),
    ("Boost pads push", len(boost), "no (never crossed one)", "no", "collide_family pad 0, no push", 18),
    ("Pet commands (JSON 48)", len(tx_json.get(14, [])), "partial", "no", "dropped", 19),
    ("Taming (JSON 45 -> creature 12:1 -> re-created as pet)", len(tx_json.get(18, [])), "partial (1 sample)", "no", "dropped", 20),
    ("Clan chat log (rx 39 with tm/s/n/p)", sum(1 for _, _, m in rare[39] if "tm" in m), "yes", "no", "World.chat sends bubble only", 21),
    ("Chat bubbles", sum(1 for _, _, m in rare[39] if "mt" in m), "yes", "yes", "world.js World.chat / Player.onChat", 22),
    ("Leaderboard", sum(v["n"] for k, v in rx_stat.items() if FMAP["types"].get(str(k), {}).get("atl4") == 64), "yes", "yes", "world.js World.board", 23),
    ("Walking / collision / map clamp", len(tx_ops.get(11, [])), "yes", "yes", "world.js Player.physics / World.collide", 24),
    ("Gathering resources + XP", len(xp_ev), "yes", "yes", "world.js Player.swing / gatherYield / addXp", 25),
    ("Eating food (heal)", sum(foods.values()), "yes", "yes", "world.js Player.useItem", 26),
    ("Placing structures (cost, limit, item_count)", len(placed_first), "yes", "yes", "world.js Player.useItem", 27),
    ("Spike contact damage", sum((v or {}).get("n", 0) for v in spike_dmg.values()), "yes", "yes", "world.js World.hazards", 28),
    ("Player vs player damage, death, scoreboard, respawn", len(rare[6]), "yes", "partial", "world.js Player.hurt/die/afterDeath (scoreboard has 4 of 17 fields)", 29),
    ("Select item / held item echo", len(sel), "yes", "yes", "world.js Player.onFrame OP.SELECT", 30),
]
table = [{"feature": f, "count": c, "capture_evidence": e, "implemented": im, "where_or_gap": w, "rank": rk} for f, c, e, im, w, rk in FEAT]
put("10_feature_table", {"rows": table,
    "top_missing_by_player_impact": [r["feature"] for r in sorted(table, key=lambda r: r["rank"]) if r["implemented"] == "no" and r["capture_evidence"].split(" ")[0] in ("yes", "partial")][:12]})

# ---------------------------------------------------------------- markdown
def mdtable(hdr, rws):
    out = ["| " + " | ".join(hdr) + " |", "|" + "---|" * len(hdr)]
    for r in rws: out.append("| " + " | ".join(str(x).replace("|", "/") for x in r) + " |")
    return "\n".join(out)
def ft(e): return e and "%s @%s s" % (e["row"], e["t"])
L = ["# SP3 feature inventory (Saopaulo#5 human capture)", "",
     "Generated by tools/sp3/inventory.py from %s. %s. Machine-readable twin: sp3_feature_inventory.json." % (DOC["capture"], DOC["time_base"]), "",
     "## 10. Feature table", "", mdtable(["feature", "count", "capture shows how it works", "implemented in our server", "where / gap"],
                                         [[r["feature"], r["count"], r["capture_evidence"], r["implemented"], r["where_or_gap"]] for r in table]), "",
     "Top missing features the capture specifies, by visible impact: " + "; ".join("%d. %s" % (k + 1, f) for k, f in enumerate(S["10_feature_table"]["top_missing_by_player_impact"])), ""]
L += ["## 1. Message types", "", "rx (server to client):", "",
      mdtable(["sp3", "atl4", "name", "meaning", "count", "first", "last", "our server"],
              [[m["sp3"], m["atl4"], m["name"], m.get("meaning") or "", m["count"], ft(m["first"]), ft(m["last"]), m["our_server"]] for m in S["1_messages"]["messages"] if m["dir"] == "rx"]), "",
      "tx (client to server):", "",
      mdtable(["kind", "sp3", "atl4", "name", "count", "first", "last", "our server"],
              [[m["dir"], m["sp3"], m["atl4"], m["name"], m["count"], ft(m["first"]), ft(m["last"]), m["our_server"]] for m in S["1_messages"]["messages"] if m["dir"] != "rx"]), "",
      "Move record signatures (non-position fields per entity kind, top):", "",
      mdtable(["entity", "fields", "count", "first", "example"], [[s["entity"], ",".join(s["fields"]), s["count"], ft(s["first"]), json.dumps(s["example"])[:110]] for s in S["1_messages"]["move_record_signatures"]["rows"] if s["count"] >= 5]), ""]
B = S["2_biomes"]
L += ["## 2. Biomes", "", B["summary"], "",
      mdtable(["phase b", "biome", "start", "end t", "object creates by prefix", "own bbox", "music"],
              [[s["b"], s["biome"], "%s @%s s" % (s["start_row"], s["start_t"]), s["end_t"], json.dumps(s["natural_object_creates_by_prefix"]), s["own_bbox"], ",".join(x["file"] for x in s["music"])] for s in B["phases"]]), "",
      "Transitions:", "", mdtable(["to", "t", "row", "new objects same frame", "old destroy records same frame", "creatures killed", "old removed within 5 s", "first removal delay s"],
                                  [[x["to"], x["t"], x["row"], x["new_objects_created_same_frame"], x["old_objects_destroy_record_same_frame"], len(x["creatures_killed_same_frame"]), x["old_biome_objects_removed_within_5s"], (x["old_removed_first"] or {}).get("delay_s")] for x in B["transitions"]]), "",
      "Cell grid (2000 units per cell, " + B["cell_grid_2000"]["legend"] + "):", "", "```"] + B["cell_grid_2000"]["rows"] + ["```", "",
      "Boss markers: " + "; ".join("ob %s from %s s" % (b["ob"], b["first"]["t"]) for b in B["boss_markers"]["values"]), "", "Implemented: " + B["implemented"], ""]
E = S["3_entities"]
L += ["## 3. Entities", "", "Counts by category: %s (%s)." % (json.dumps(E["counts_by_category"]), json.dumps(E["categories"])), "",
      mdtable(["object def", "def idx", "ids", "creates", "hits", "destroyed ids", "placed ids", "contact dist", "first", "last"],
              [[o["name"], o["def"], o["distinct_ids"], o["creates"], o["hit_records"], o["ids_destroyed"], o["player_placed_ids"], o["contact_dist"], ft(o["first"]), ft(o["last"])] for o in E["objects"]]), "",
      "Creatures:", "", mdtable(["kind", "name", "ids", "pets of players", "own pet ids", "first", "last"],
                                [[c["kind"], c["name"], c["distinct_ids"], c["pets_of_players"], c["own_pet_ids"], ft(c["first"]), ft(c["last"])] for c in E["creatures"]]), "",
      "Other players: %d distinct; held items at create %s." % (E["players"]["distinct_other"], E["players"]["create_field_values"].get("8")), "",
      "Projectiles (category 4, by field 7):", "", mdtable(["kind 7", "n", "owners", "field 8", "first", "last"], [[p["field7_kind"], p["n"], json.dumps(p["owners"]), json.dumps(p["field8"]), ft(p["first"]), ft(p["last"])] for p in E["projectiles"]]), "",
      "Effects (category 2): %d. %s" % (E["effects"]["n"], E["effects"]["note"]), "",
      "Resources: " + E["resources"]["how_it_works"], "", "hp step per hit by family: %s" % json.dumps(E["resources"]["hp_byte_step_per_hit_by_family"]), "",
      "Destroyed by hits (not phase switch): %d; respawned at the same spot within the capture: %d after %s s." % (E["resources"]["destroyed_by_hits"], E["resources"]["respawned_same_spot"], E["resources"]["respawn_after_s"]), "", "Implemented: " + E["implemented"], ""]
C = S["4_chests"]
L += ["## 4. Chests", "", C["what"], "", "Counts: " + json.dumps(C["counts"]), "", "How it works:", ""] + ["- " + x for x in C["how_it_works"]] + ["",
      mdtable(["gift id", "def", "pos", "hits (t: hp byte)", "open", "gift_info", "loot (inv delta)", "xp"],
              [[g["id"], g["def"], (g["x"], g["y"]), " ".join("%s:%s" % (h["t"], h["hp_byte"]) for h in g["hits"]), g["open"] and ft(g["open"]),
                g["open"] and g["open"].get("gift_info_to_us") and json.dumps(g["open"]["gift_info_to_us"]["msg"]), g["open"] and json.dumps(g["open"].get("inventory_delta_same_frame")), g["open"] and g["open"].get("xp_delta_same_frame")] for g in C["gifts"] if g["open"] or g["hits"]]), "",
      "Evidence: " + C["evidence_ok"], "", "Implemented: " + C["implemented"], ""]
I = S["5_items"]
L += ["## 5. Items", "", "Select: %d ops, %s. %s" % (I["select"]["count"], I["select"]["by_item"][:12], I["select"]["how_it_works"]), "", "Echo: " + I["select"]["server_echo"], "",
      "Unlock/craft (%d ops): %s" % (I["unlock_craft"]["count"], I["unlock_craft"]["how_it_works"]), "",
      mdtable(["row", "t", "item", "name", "cat", "items.json cost", "inventory delta within 1 s (gathering mixes in)", "item_count reply"], [[u["row"], u["t"], u["item"], u["name"], u["cat"], u["items_json_cost"], json.dumps(u["inventory_delta_1s"]), json.dumps([x for x in u["server_reply"] if x.get("atl4") == 36])[:90]] for u in I["unlock_craft"]["events"]]), "",
      "Eaten: %s. %s" % (I["eaten"]["by_item"], I["eaten"]["how_it_works"]), "",
      "Inventory slots: " + "; ".join("%s %s (updates %d, max %s, final %s)" % (k, v["name"], v["updates"], v["max"], v["final"]) for k, v in I["inventory_slots"].items()), "",
      "Own field 14: %s. %s" % (I["own_field14_changes"]["values"], I["own_field14_changes"]["note"]), "", "Hats/shop: " + I["hats_accessories_shop"], "", "Implemented: " + I["implemented"], ""]
A = S["6_animals"]
L += ["## 6. Animals", "", A["behaviour"], "", "States (field 7) by kind: %s" % json.dumps(A["state_field7_by_kind"]), "", "Damage taken (field 10) by kind: %s" % json.dumps(A["damage_taken_field10_by_kind"]), "",
      "Creature deaths in view: %d. Damage to us: %s." % (A["creature_deaths_in_view"]["n"], json.dumps(A["damage_to_us"]["by_cause"])), "",
      "Own pet: %s. %s States %s." % (json.dumps({k: v and v["name"] for k, v in A["own_pet"]["by_life"].items()}), A["own_pet"]["how_it_works"], A["own_pet"]["states_field7"]), "",
      "Pet commands: %d, S values %s. %s" % (A["pet_commands"]["count"], A["pet_commands"]["S_values"], A["pet_commands"]["note"]), "",
      "Taming: %s Sequence: %s" % (A["taming"]["note"], json.dumps([e["sequence_after"] for e in A["taming"]["events"]])), "", "Evidence: " + A["evidence_ok"], "", "Implemented: " + A["implemented"], ""]
T7 = S["7_structures"]
L += ["## 7. Structures", "", "Own placed: %d %s." % (T7["own_placed"]["count"], T7["own_placed"]["by_def"]), ""] + ["- " + x for x in T7["how_it_works"]] + ["",
      "placed_list coordinate scale (create x / list x): %s" % T7["placed_list_msgs"]["coord_scale"], "",
      mdtable(["structure", "hits", "destroyed records", "hp steps (top)", "other fields"], [[k, v["hits"], v["destroyed_records"], v["hp_steps_top"], v["other_fields"]] for k, v in T7["hits_by_structure"].items()]), "",
      "Decay: " + T7["decay"]["how_it_works"], "", mdtable(["structure", "samples", "hp byte/s", "step top", "interval s top", "s to zero"], [[k, v["samples"], v["hp_byte_per_s_median"], v["step_top"], v["interval_s_top"], v["s_to_zero_from_255"]] for k, v in T7["decay"]["by_def"].items()]), "", "Implemented: " + T7["implemented"], ""]
U = S["8_ui"]
L += ["## 8. UI and client features", "", mdtable(["key", "presses", "outside chat", "client messages that follow (250 ms)"], [[k, v["presses"], v["presses_outside_chat"], v["tx_within_250ms"]] for k, v in U["keyboard"]["keys"].items()]), "",
      U["keyboard"]["note"] + ".", "", "Mouse: %s. %s" % (U["mouse"]["button_downs"], U["mouse"]["note"]), "",
      "Chat: %d sent, %d received. %s" % (U["chat"]["tx"], U["chat"]["rx"], U["chat"]["how_it_works"]), "",
      "Clan: tx actions %s, rx sub-ops %s." % (U["clan"]["tx_actions_o"], U["clan"]["rx_subops_m"]), ""] + ["- " + x for x in U["clan"]["how_it_works"]] + ["",
      "Quests: " + U["quests"]["how_it_works"] + " " + "; ".join("%s @%s" % (json.dumps(q["m"]), q["t"]) for q in U["quests"]["msgs"]), "",
      "HTTP game hosts: %s" % U["http"]["game_hosts"], "", "Audio cues: " + ", ".join("%s x%d (first %s s)" % (k, v["n"], v["first"]["t"]) for k, v in U["http"]["audio_cues"].items()), "",
      U["http"]["note"], "", "Not observed: " + U["map_menu_settings_shop_daily"], "", "Implemented: " + U["implemented"], ""]
V = S["9_world_events"]
L += ["## 9. Timers, events, boosts, status", "", "Biome timer: " + V["biome_timer"]["how_it_works"] + " " + "; ".join("b%s d%s @%s" % (x["m"]["b"], x["m"]["d"], x["t"]) for x in V["biome_timer"]["msgs"]), "",
      "Announce: %s" % [x["m"] for x in V["server_announce"]], "", "Markers 80: %d, intervals %s. %s" % (V["markers_80"]["n"], V["markers_80"]["interval_s"], V["markers_80"]["note"]), "",
      "Markers 65: %d, intervals %s. %s" % (V["markers_65"]["n"], V["markers_65"]["interval_s"], V["markers_65"]["note"]), "",
      "Boost pads: %s" % json.dumps({k: V["boost_pads"][k] for k in ("pad_ids_seen", "fast_frames_near_pad", "episodes", "note")}), "",
      "Status effects: " + V["status_effects"], "", "Day/night: " + V["day_night"], "", "Implemented: " + V["implemented"], ""]
txt = "\n".join(L)
assert "\u2014" not in txt and "\u2013" not in txt and REAL not in txt
open(OUTM, "w").write(txt + "\n")
js = open(OUTJ).read()
assert "\u2014" not in js and "\u2013" not in js and REAL not in js
print("wrote", OUTJ, OUTM)
