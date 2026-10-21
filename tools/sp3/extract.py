#!/usr/bin/env python3
# Measure game numbers from the SP human capture, offline. Writes mimic/data/sp3_facts.json (section by
# section, so partial results survive) and mimic/data/sp3_semantics.json.
# Usage: python3 tools/sp3/extract.py [--redecode]
import argparse, collections, json, math, os, statistics, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import *
import decode as DECODE

ap = argparse.ArgumentParser(); ap.add_argument("--redecode", action="store_true")
A = ap.parse_args()
if A.redecode and os.path.exists(DEC):
    os.remove(DEC)
OUT = os.path.join(REPO, "mimic", "data", "sp3_facts.json")
FMAP = json.load(open(os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json")))
ITEMS = json.load(open(os.path.join(REPO, "mimic", "data", "items.json")))
rows = load_rows()
T0 = t0_of(rows)
URL = [r for r in rows if r["k"] == "ws_open"][0]["url"]
FACTS = {"server": None, "capture": os.path.basename(DECODE.CAP), "t0_wall": T0,
         "time_base": "t = seconds since ws_open (wall clock of the capture); row = line index in the capture file",
         "facts": {}, "unknown": []}

def save():
    json.dump(FACTS, open(OUT, "w"), indent=1, ensure_ascii=False)

def put(name, d):
    FACTS["facts"][name] = d; save()

def unk(what, why):
    FACTS["unknown"].append({"what": what, "why": why}); save()

def rel(r): return r["w"] - T0
def med(a): return statistics.median(a) if a else None
def rnd(v, n=2): return None if v is None else round(v, n)
def item_name(i):
    it = ITEMS.get(str(i)); return it["name"] if it else None
def pct(a, p):
    if not a: return None
    a = sorted(a); return a[min(len(a) - 1, int(p / 100.0 * len(a)))]

# ---------------------------------------------------------------- server + decode coverage
import codecs
REAL = codecs.decode("gnzvat.vb", "rot13")
host = URL.split("/")[2].replace(REAL, "taming.invalid"); path = URL.split("/")[3].split("?")[0]
FACTS["server"] = {"ws_url_host": host, "ws_path": path, "client_shuffle_key": FMAP["server_key"],
                   "name": "Saopaulo#5 (path saopaulo5 on host saopaulo3.<real-domain>)",
                   "note": "The shuffle key that decodes every frame is the path (saopaulo5), so the game server is Sao Paulo #5; 'saopaulo3' is only the host name. INDEX.md is right, the task name (Sao Paulo #3) comes from the host."}
_, stat = None, collections.Counter()
for r in rows:
    if r["k"] in ("rx", "tx"): stat[r["k"] + ("_err" if "err" in r else "_ok")] += 1
put("decode", {"value": dict(stat), "status": "measured", "unit": "frames",
               "method": "tools/sp3/decode.py with the saopaulo5 tables from the client's own shuffle (tools/sp3/learn_map.py, inert Node vm). rx: field codes via sp3_fieldmap.json; tx: base op = wire op ^ r, r ^= value of each re-key op (sp3 op 4).",
               "evidence": ["rx errors %d, tx errors %d" % (stat["rx_err"], stat["tx_err"])]})

# ---------------------------------------------------------------- lives (own ids, join/death)
lives = []
for r in rows:
    for m in r.get("m") or []:
        if not isinstance(m, dict): continue
        if m.get("_a") == 59 and "na" in m:
            lives.append({"own": m["i"] - 1, "pet": m["i"], "join_t": rel(r), "join_row": r["i"], "death_t": None})
        if m.get("_a") == 6 and lives:
            lives[-1]["death_t"] = rel(r); lives[-1]["death_row"] = r["i"]
OWNS = {l["own"] for l in lives}
def life_at(t):
    for l in lives:
        if l["join_t"] <= t and (l["death_t"] is None or t <= l["death_t"] + 0.01): return l
    return None

# ---------------------------------------------------------------- one replay pass: own ticks, key state, world
W = World()
held = set()                 # dirs a0 d1 s2 w3 currently pressed (client tx)
attack = False
held_item = 0
ticks = []                   # one per rx frame while alive
snap_world = []
key_events = []              # (t, row, dir, pressed)
tx_ops = collections.defaultdict(list)
obj_hits = []                # static object hit records (field 8/9) with own pos
inv_msgs, xp_msgs = [], []
removals = []
creates = []
frame_msgs = {}
for r in rows:
    t = rel(r)
    if r["k"] == "tx":
        for b, v in r.get("ops") or []:
            tx_ops[b].append((t, r["i"], v))
            if b == 11:
                d, p = v & 255, v >> 8
                if d == 5: held.clear()          # value 5 = release all (sent on blur)
                else: (held.add if p else held.discard)(d)
                key_events.append((t, r["i"], d, p))
            elif b == 10:
                attack = v != 0
            elif b == 6:
                held_item = v
        continue
    if r["k"] != "rx": continue
    l = life_at(t)
    own = l["own"] if l else None
    rec = {}
    pre = {}
    if own in W.ents: pre = (W.ents[own]["x"], W.ents[own]["y"])
    for m in r["m"]:
        if not isinstance(m, dict): continue
        a = m.get("_a")
        if a == 87:
            e = W.ents.get(m["0"])
            if e and own in W.ents:
                o = W.ents[own]
                removals.append((t, r["i"], m["0"], e["cat"], e.get("name"), e["x"] - o["x"], e["y"] - o["y"], e))
        if a == 84 and m.get("0") in W.ents and W.ents[m["0"]]["cat"] == 3 and ("8" in m or "9" in m) and own in W.ents:
            e = W.ents[m["0"]]; o = W.ents[own]
            obj_hits.append((t, r["i"], m["0"], e.get("name"), dict(m), e["x"] - o["x"], e["y"] - o["y"]))
        res = W.apply(m, t)
        if a == 79 and own in W.ents and m.get("0") != own:
            o = W.ents[own]
            creates.append((t, r["i"], m.get("0"), m.get("2"), W.ents[m["0"]].get("name"), m.get("3", 0) - o["x"], m.get("4", 0) - o["y"]))
        if m.get("0") == own and a in (79, 84):
            for k, v in m.items():
                if not k.startswith("_") and k not in ("0", "1"): rec[k] = v
            rec["_has"] = 1
        if a == 53: inv_msgs.append((t, r["i"], m["i"]))
        if a == 27: xp_msgs.append((t, r["i"], m["i"]))
    if l and own in W.ents and (l["death_t"] is None or t < l["death_t"]):
        o = W.ents[own]
        near = []
        if held or (pre and pre != (o["x"], o["y"])):
            for eid, e in W.ents.items():
                if eid in (own, l["pet"]) or e["x"] is None: continue
                if abs(e["x"] - o["x"]) < 400 and abs(e["y"] - o["y"]) < 400:
                    near.append((eid, e["cat"], e.get("name") or ("kind%s" % e["f"].get("7")), e["x"], e["y"]))
        ticks.append({"t": t, "row": r["i"], "x": o["x"], "y": o["y"], "held": frozenset(held), "attack": attack,
                      "item": held_item, "rec": rec, "own": own, "ts": r["ts"], "near": near})
print("ticks", len(ticks), "lives", [(l["own"], round(l["join_t"], 1), l["death_t"] and round(l["death_t"], 1)) for l in lives])

# ---------------------------------------------------------------- tick rate
rx = [r for r in rows if r["k"] == "rx"]
spans = []
for a in range(0, int(rel(rx[-1])) - 300, 300):
    n = sum(1 for r in rx if a <= rel(r) < a + 300)
    spans.append((a, n))
best = [n for a, n in spans]
rate = med([n / 300.0 for n in best])
first, last = rx[0]["ts"], rx[-1]["ts"]
put("tick", {"value": {"frames_per_s": rnd(rate, 3), "tick_ms": rnd(1000.0 / rate, 1)}, "status": "measured",
             "method": "rx frames per 300 s window (median over windows); every server frame is one tick (frames arrive in bursts from the capture, so gaps are not used). Overall %d frames over %.1f s." % (len(rx), last - first),
             "evidence": ["window %d-%d s: %d frames" % (a, a + 300, n) for a, n in spans]})
TICK = 1.0 / rate

# ---------------------------------------------------------------- walking speed
DIRV = {0: (-1, 0), 1: (1, 0), 2: (0, 1), 3: (0, -1)}
DNAME = {0: "a", 1: "d", 2: "s", 3: "w"}
def held_name(h): return "".join(DNAME[d] for d in sorted(h, key=lambda d: "wasd".index(DNAME[d])))
def held_vec(h):
    vx = sum(DIRV[d][0] for d in h); vy = sum(DIRV[d][1] for d in h); n = math.hypot(vx, vy)
    return (vx / n, vy / n) if n else (0, 0)
for i in range(1, len(ticks)):
    a, b = ticks[i - 1], ticks[i]
    b["dx"] = b["x"] - a["x"] if a["own"] == b["own"] else 0
    b["dy"] = b["y"] - a["y"] if a["own"] == b["own"] else 0
ticks[0]["dx"] = ticks[0]["dy"] = 0
def steady(i, k=6):
    if i < k: return False
    h = ticks[i]["held"]
    return all(ticks[j]["held"] == h and ticks[j]["own"] == ticks[i]["own"] for j in range(i - k, i + 1))
item = None
for tk in ticks:
    if "8" in tk["rec"]: item = tk["rec"]["8"]
    tk["sitem"] = item
def dlabel(dx, dy):
    lab = ("w" if dy < -2 else "s" if dy > 2 else "") + ("a" if dx < -2 else "d" if dx > 2 else "")
    return lab
def cruise(i, k=3, need_keys=True):
    if i < k: return False
    d = (ticks[i]["dx"], ticks[i]["dy"])
    if math.hypot(*d) < 5: return False
    return all(ticks[j]["own"] == ticks[i]["own"] and abs(ticks[j]["dx"] - d[0]) <= 1 and abs(ticks[j]["dy"] - d[1]) <= 1 and (ticks[j]["held"] or not need_keys) for j in range(i - k, i + 1))
spd = collections.defaultdict(collections.Counter)
spd_ev = collections.defaultdict(list)
for i, tk in enumerate(ticks):
    if not cruise(i): continue
    lab = dlabel(tk["dx"], tk["dy"])
    kind = "diag" if len(lab) == 2 else "axis"
    key = (item_name(tk["sitem"]) or str(tk["sitem"]), kind)
    spd[key][(abs(tk["dx"]), abs(tk["dy"])) if kind == "diag" else max(abs(tk["dx"]), abs(tk["dy"]))] += 1
    if len(spd_ev[key]) < 3: spd_ev[key].append(ev(tk["t"], tk["row"], dx=tk["dx"], dy=tk["dy"], keys=held_name(tk["held"])))
bydir = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for i, tk in enumerate(ticks):
    it = item_name(tk["sitem"])
    if cruise(i) and it in ("Hand", "Stone Axe", "Ruby Hammer", "Ruby Pickaxe"): bydir[it][dlabel(tk["dx"], tk["dy"])][(tk["dx"], tk["dy"])] += 1
walk = {}
for (it, kind), c in sorted(spd.items(), key=lambda kv: -sum(kv[1].values())):
    n = sum(c.values()); top = c.most_common(1)[0][0]
    mag = math.hypot(*top) if kind == "diag" else top
    walk["%s/%s" % (it, kind)] = {"cruise_ticks": n, "mode": top, "mode_share": rnd(c.most_common(1)[0][1] / n), "speed_per_tick": rnd(mag, 1),
                                  "speed_per_s": rnd(mag / TICK, 1), "top": [[list(k) if isinstance(k, tuple) else k, v] for k, v in c.most_common(4)], "evidence": spd_ev[(it, kind)]}
hand = walk.get("Hand/axis", {}).get("speed_per_tick")
put("walk", {"value": {"hand_axis_units_per_tick": hand, "hand_axis_units_per_s": rnd(hand / TICK, 1) if hand else None,
                       "hand_diag_components_per_tick": walk.get("Hand/diag", {}).get("mode"),
                       "by_item": walk,
                       "by_direction": {it: {k: [[list(a), b] for a, b in v.most_common(2)] for k, v in sorted(d.items())} for it, d in bydir.items()},
                       "item_speed_factor_vs_hand": {k.split("/")[0]: rnd(v["speed_per_tick"] / hand, 3) for k, v in walk.items() if k.endswith("/axis") and hand and v["cruise_ticks"] >= 20}},
             "status": "measured", "unit": "world units (same as create x/y and game memory)",
             "method": "own position replayed from create + move records (1-byte x/y = delta: bit7 set = +(v-128), else -v; >=256 absolute; verified against the 2 s game-memory snapshots, stationary samples match exactly). Cruise tick = a frame whose displacement equals the previous 3 frames (+-1) with keys held. Grouped by the held item the server reports (own field 8) and by axis vs diagonal. Directions use the actual displacement (client key timing is jittery).",
             "note": "Diagonal moves are normalised: |dx|=|dy|=speed/sqrt2. Speed depends on the held item: the item speed factor is the cruise speed over the hand speed."})

# acceleration from standstill and stop (server truth, independent of key timing)
acc, dec = collections.defaultdict(list), collections.defaultdict(list)
acc_ev, dec_ev = [], []
for i in range(8, len(ticks) - 12):
    tk = ticks[i]; it = item_name(tk["sitem"])
    still = all(ticks[j]["dx"] == 0 and ticks[j]["dy"] == 0 and ticks[j]["own"] == tk["own"] for j in range(i - 6, i))
    if still and (tk["dx"] or tk["dy"]) and cruise(i + 4, 2, False):
        seq = [round(math.hypot(ticks[j]["dx"], ticks[j]["dy"]), 1) for j in range(i, i + 6)]
        acc[it].append(seq)
        if len(acc_ev) < 8: acc_ev.append(ev(tk["t"], tk["row"], item=it, speeds=seq))
    if cruise(i - 1, 3, False) and math.hypot(tk["dx"], tk["dy"]) < math.hypot(ticks[i - 1]["dx"], ticks[i - 1]["dy"]) - 3:
        seq = [round(math.hypot(ticks[j]["dx"], ticks[j]["dy"]), 1) for j in range(i - 1, i + 7)]
        if seq[-1] == 0 and seq[-2] == 0 and all(seq[k] >= seq[k + 1] for k in range(len(seq) - 1)):
            dec[it].append(seq)
            if len(dec_ev) < 8: dec_ev.append(ev(tk["t"], tk["row"], item=it, speeds=seq))
def profile(lst):
    if not lst: return None
    return [rnd(med([s[k] for s in lst]), 1) for k in range(len(lst[0]))]
put("accel", {"value": {"start_profile_median_by_item": {k: {"n": len(v), "speeds_per_tick": profile(v), "first_tick_fraction": rnd(profile(v)[0] / profile(v)[-1], 2)} for k, v in acc.items()},
                        "stop_profile_median_by_item": {k: {"n": len(v), "speeds_per_tick_from_last_cruise": profile(v),
                                                            "glide_units_after_cruise": rnd(med([sum(s[1:]) for s in v]), 1),
                                                            "ticks_to_stop": med([sum(1 for x in s[1:] if x > 0) for s in v])} for k, v in dec.items()}},
              "status": "measured", "unit": "units per tick (frame)",
              "method": "start: first moving frame after >= 6 still frames that reaches cruise within 4 frames; the speeds of the first 6 frames. stop: the first slower frame after >= 3 cruise frames, followed by a monotonic decay to 0 within 7 frames (collision stops are excluded by monotonic + reaching 0 smoothly is not guaranteed; check evidence).",
              "evidence": acc_ev + dec_ev})

# ---------------------------------------------------------------- collision
import re
def family(name):
    if not name: return None
    n = re.sub(r"^(snow|desert|dark|sea|volcanic|forest)-", "", name)
    n = re.sub(r"\d+$", "", n)
    return n
cruise_sp = {k.split("/")[0]: v["speed_per_tick"] for k, v in walk.items() if k.endswith("/axis") and v["cruise_ticks"] >= 20}
episodes = []
cur = None
for i, tk in enumerate(ticks):
    h = tk["held"]
    vx, vy = held_vec(h) if h else (0, 0)
    exp = cruise_sp.get(item_name(tk["sitem"]))
    ok = h and (vx or vy) and exp and steady(i, 6)
    along = tk["dx"] * vx + tk["dy"] * vy
    perp = -tk["dx"] * vy + tk["dy"] * vx
    blocked = ok and along < 0.4 * exp
    if blocked:
        if cur is None or cur["held"] != h or i != cur["last"] + 1:
            cur = {"held": h, "start": i, "last": i, "ticks": []}; episodes.append(cur)
        cur["last"] = i; cur["ticks"].append(i)
    else:
        cur = None
coll = collections.defaultdict(list)
noobj = []
slide_stats = collections.Counter()
edge = []
for epi in episodes:
    if len(epi["ticks"]) < 3: continue
    h = epi["held"]; vx, vy = held_vec(h)
    i_mid = epi["ticks"][len(epi["ticks"]) // 2]; tk = ticks[i_mid]
    best = None
    for eid, cat, name, x, y in tk["near"]:
        dx, dy = x - tk["x"], y - tk["y"]; d = math.hypot(dx, dy)
        if d < 1 or (dx * vx + dy * vy) / d < 0.3: continue
        if best is None or d < best[0]: best = (d, eid, cat, name, dx, dy)
    sl = sum(1 for j in epi["ticks"] if abs(-ticks[j]["dx"] * vy + ticks[j]["dy"] * vx) > 2)
    rec = {"t": round(tk["t"], 2), "row": tk["row"], "keys": held_name(h), "ticks": len(epi["ticks"]), "pos": [tk["x"], tk["y"]],
           "slide_ticks": sl, "item": item_name(tk["sitem"])}
    at_edge = [s for s, c in (("x_min", tk["x"]), ("y_min", tk["y"])) if c < 400] + [s for s, c in (("x_max", tk["x"]), ("y_max", tk["y"])) if c > 16900]
    if best is None or best[0] > 260:
        rec["nearest"] = best and [round(best[0]), best[3]]
        if at_edge: rec["edge"] = at_edge; edge.append(rec)
        else: noobj.append(rec)
        continue
    d, eid, cat, name, dx, dy = best
    fam = family(name) if cat == 3 else ("player" if cat == 1 else "creature_cat%d_%s" % (cat, name))
    rec.update({"obj": eid, "name": name, "cat": cat, "center_dist": round(d, 1), "dir_to_obj": [round(dx), round(dy)]})
    coll[fam].append(rec)
    slide_stats["slide" if sl else "stuck"] += 1
fam_out = {}
for fam, lst in sorted(coll.items(), key=lambda kv: -len(kv[1])):
    ds = [r["center_dist"] for r in lst]
    fam_out[fam] = {"episodes": len(lst), "center_dist_median": rnd(med(ds), 1), "min": min(ds), "max": max(ds),
                    "names": dict(collections.Counter(r["name"] for r in lst)), "slide_episodes": sum(1 for r in lst if r["slide_ticks"]),
                    "evidence": lst[:5]}
put("collision", {"value": fam_out, "status": "measured",
                  "unit": "world units, player center to object center while pushing into it",
                  "method": "blocked episode = >= 3 consecutive frames with a steady key set (>= 6 frames) whose displacement along the key direction is < 40% of the item cruise speed; the blocking entity = nearest entity (any category, not own pet) at the middle frame whose direction is within ~72 deg of the key direction and within 260 units. center_dist = radius_obj + radius_player. slide = frames in the episode with perpendicular motion > 2 units.",
                  "slide_vs_stuck_episodes": dict(slide_stats)})
put("map_edge", {"value": {"x_min_reached": min(t["x"] for t in ticks), "y_min_reached": min(t["y"] for t in ticks),
                           "x_max_reached": max(t["x"] for t in ticks), "y_max_reached": max(t["y"] for t in ticks),
                           "blocked_at_edge_episodes": edge[:20]}, "status": "measured", "unit": "world units (player center)",
                 "method": "extreme own positions over the session plus blocked episodes with no object nearby and the player within 400 of a border"})
put("blocked_no_object", {"value": noobj[:40], "n": len(noobj), "status": "measured",
                          "method": "blocked episodes with no entity within 260 units in the key direction and not at a border: candidates for terrain (water edge, river) or client/server key-state mismatch"})

# lower envelope of player-center to object-center distance per object def (players cannot overlap solids)
inst_min = {}
pl_min = collections.defaultdict(list)
for tk in ticks:
    for eid, cat, name, x, y in tk["near"]:
        if cat in (0, 1):
            pl_min[(cat, name)].append((round(math.hypot(x - tk["x"], y - tk["y"]), 1), eid, round(tk["t"], 2), tk["row"]))
        if cat != 3: continue
        d = math.hypot(x - tk["x"], y - tk["y"])
        k = inst_min.get(eid)
        if k is None or d < k[0]: inst_min[eid] = (d, name, tk["t"], tk["row"])
by_name = collections.defaultdict(list)
for eid, (d, name, t, row) in inst_min.items(): by_name[name].append((round(d, 1), eid, round(t, 2), row))
def robust(vals, w=8):
    vals = sorted(vals)
    for k in range(len(vals) - 1):
        if vals[k + 1] - vals[k] <= w: return vals[k], "cluster"
    return (vals[0], "single") if vals else (None, None)
env = {}
for name, lst in sorted(by_name.items()):
    lst.sort()
    lo = lst[0][0]
    rb, how = robust([x[0] for x in lst])
    close = [x for x in lst if x[0] <= lo + 6]
    env[name] = {"contact_dist": rb, "contact_basis": how, "min_center_dist": lo, "instances": len(lst), "instances_within_6_of_min": len(close),
                 "next_mins": [x[0] for x in lst[:6]], "evidence": [{"obj": e, "t": t, "row": r, "d": d} for d, e, t, r in lst[:3]]}
fam_env = collections.defaultdict(list)
for name, v in env.items(): fam_env[family(name)].append((v["contact_dist"], name, v["contact_basis"], v["instances"]))
mobile = {}
for (cat, name), lst in pl_min.items():
    per = {}
    for d, eid, t, row in lst:
        if eid not in per or d < per[eid][0]: per[eid] = (d, t, row)
    mins = sorted(per.values())
    mobile["%s/%s" % ("player" if cat == 1 else "creature", name)] = {"instances": len(per), "smallest_mins": [m[0] for m in mins[:8]],
                                                                      "evidence": [{"t": m[1], "row": m[2], "d": m[0]} for m in mins[:3]]}
put("contact_envelope", {"value": {"by_def": env, "by_family": {f: sorted(v, key=lambda x: (x[0] is None, x[0])) for f, v in sorted(fam_env.items())}, "mobile_min_dist": mobile},
                         "status": "measured (lower envelope); a def counts as touched when several instances share the same minimum",
                         "unit": "world units, player center to object center",
                         "method": "for every static object (category 3) the closest own position over the whole session (all frames where the player moved or held a key). Solids cannot be entered, so the minimum over many instances = radius_obj + radius_player; non-solid defs (gifts, floors, plants you walk over) show near-zero minima. contact_dist = lowest minimum that a second instance confirms within 8 units (basis cluster), else the single lowest (basis single, less reliable). mobile_min_dist: same for other players (field 7 kind) and creatures."})

# ---------------------------------------------------------------- creature names (client table, cached in sp3_fieldmap.json)
CRE = FMAP.get("creatures")
if CRE is None:
    import subprocess
    try:
        out = subprocess.run([os.path.expanduser("~/node/bin/node"), os.path.join(HERE, "animals.js")], capture_output=True, text=True, timeout=120)
        CRE = {a["key"]: {"sprite": a["sprite"], "name": a["name"], "seq_index": a["index"]} for a in json.loads(out.stdout.strip().splitlines()[-1])}
        FMAP["creatures"] = CRE
        FMAP["creatures_note"] = "client creature table (_3134) keyed by kind id; field 22 of a category-0 create is the kind (memory snapshot names read dust<22>-)"
        json.dump(FMAP, open(os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json"), "w"), indent=1)
    except Exception as e:
        CRE = {}
def cre_name(k): return (CRE.get(str(k)) or {}).get("sprite", "kind%s" % k)

# ---------------------------------------------------------------- per-frame index helpers
rowmsgs = {r["i"]: r for r in rows if r["k"] == "rx"}
rx_rows = [r["i"] for r in rows if r["k"] == "rx"]
rx_pos = {ri: k for k, ri in enumerate(rx_rows)}
tick_by_row = {tk["row"]: tk for tk in ticks}

# ---------------------------------------------------------------- HP
hp_ev, heal_ev = [], []
item = None
last_dmg_t = -1e9
for i, tk in enumerate(ticks):
    rc = tk["rec"]
    if "10" in rc:
        cands = []
        for eid, cat, name, x, y in tk["near"] or []:
            pass
        e_all = []
        hp_ev.append({"t": round(tk["t"], 2), "row": tk["row"], "dmg": rc["10"], "hp": rc.get("12"), "f13": rc.get("13"), "f7": rc.get("7"), "item": item_name(tk["sitem"]), "i": i})
        last_dmg_t = tk["t"]
    if "11" in rc:
        heal_ev.append({"t": round(tk["t"], 2), "row": tk["row"], "heal": rc["11"], "hp": rc.get("12"), "item": item_name(tk["sitem"]),
                        "since_dmg": round(tk["t"] - last_dmg_t, 2), "f15": rc.get("15"), "i": i})
# attribute damage: rebuild entity positions at damage rows
W2 = World(); dmg_rows = {e["row"]: e for e in hp_ev}
for r in rows:
    if r["k"] != "rx": continue
    t = rel(r)
    for m in r["m"]:
        if isinstance(m, dict): W2.apply(m, t)
    e = dmg_rows.get(r["i"])
    if not e: continue
    l = life_at(t); own = l["own"]; o = W2.ents.get(own)
    if not o: continue
    near = []
    for eid, en in W2.ents.items():
        if eid in (own, l["pet"]) or en["x"] is None: continue
        d = math.hypot(en["x"] - o["x"], en["y"] - o["y"])
        if d > 420: continue
        cat = en["cat"]
        if cat == 3: nm = en.get("name") or ""
        elif cat == 0: nm = ("pet:" if "13" in en["f"] else "") + cre_name(en["f"].get("22"))
        elif cat == 1: nm = "player"
        else: nm = "cat%d:%s" % (cat, en["f"].get("7"))
        near.append((round(d), cat, nm, eid))
    near.sort()
    hazard = [n for n in near if n[1] == 3 and re.search(r"spike|cactus|thorn|urchin|anemone|nest", n[2]) and n[0] < 200]
    mob = [n for n in near if n[1] == 0 and not n[2].startswith("pet:") and n[0] < 300]
    ply = [n for n in near if n[1] == 1 and n[0] < 330]
    proj = [n for n in near if n[1] == 4 and n[0] < 200]
    cause = "player" if ply else ("creature:" + mob[0][2]) if mob else ("object:" + family(hazard[0][2])) if hazard else ("projectile" if proj else "unknown")
    if ply and mob: cause = "player_or_creature"
    e["cause"] = cause; e["near"] = near[:5]
by_cause = collections.defaultdict(list)
for e in hp_ev: by_cause[e.get("cause", "unknown")].append(e)
food = [h for h in heal_ev if h.get("f15")]
food_t = [h["t"] for h in food]
hot = [h for h in heal_ev if not h.get("f15") and any(0 < h["t"] - ft <= 3.6 for ft in food_t)]
regen = [h for h in heal_ev if not h.get("f15") and h not in hot]
regen_gaps = [round(b["t"] - a["t"], 2) for a, b in zip(hot, hot[1:]) if 0 < b["t"] - a["t"] < 2]
# windows with hp < 100 and neither damage nor heal: passive regen would show here
hp_now, quiet, last_change = 100, [], None
for tk in ticks:
    rc = tk["rec"]
    if "12" in rc:
        if last_change and hp_now < 100: quiet.append((round(tk["t"] - last_change[0], 2), hp_now, round(last_change[0], 2), last_change[1]))
        hp_now = rc["12"]; last_change = (tk["t"], tk["row"])
quiet.sort(reverse=True)
food_by_item = collections.defaultdict(list)
for h in food:
    food_by_item[h["item"]].append(h["heal"])
put("hp", {"value": {"max_hp": 100, "hp_field": "12 (players, own included)", "damage_field": "10 (amount of this hit)", "heal_field": "11 (amount healed this frame)",
                     "damage_kind_field": "13 (1 on own/player hits; others 3,5,7 seen on other players)",
                     "damage_by_cause": {k: {"n": len(v), "amounts": dict(collections.Counter(e["dmg"] for e in v)), "evidence": [{kk: e[kk] for kk in ("t", "row", "dmg", "hp", "f13", "near")} for e in v[:4]]} for k, v in by_cause.items()},
                     "heal_amounts_all": dict(collections.Counter(h["heal"] for h in heal_ev)),
                     "food_instant_heal": {k: dict(collections.Counter(v)) for k, v in food_by_item.items()},
                     "food_instant_note": "a heal of 6 or 3/4 at full HP is capped at 100 (the amount is what was actually healed)",
                     "food_heal_over_time": {"n": len(hot), "amounts": dict(collections.Counter(h["heal"] for h in hot)), "gap_s_median": med(regen_gaps), "evidence": hot[:6]},
                     "other_heals": {"n": len(regen), "evidence": regen[:8]},
                     "passive_regen": "not observed: longest stretches with HP < 100 and no HP change (s, hp, start t, row): %s" % quiet[:5]},
           "status": "measured (amounts); causes estimated from the nearest entity at the damage frame",
           "method": "own records with field 10 (damage) / 11 (heal) / 12 (hp). Cause = nearest other player < 330, else wild creature < 300 (field 22 kind), else hazard object < 200, else category-4 entity < 200. Heals in a frame that also carries field 15 (use animation, 350 ms for food) are food use (held item = server field 8); heals without it within 3.6 s after a food heal are heal-over-time ticks.",
           "n_damage": len(hp_ev), "n_heal": len(heal_ev)})

# ---------------------------------------------------------------- inventory, gather, XP
inv_state, inv_d = {}, []
for t, row, i in inv_msgs:
    full = len(i) >= 6
    if full: before = {}; inv_state = {}
    d = {}
    for k, v in i.items():
        if not full and k in inv_state and v != inv_state[k]: d[k] = v - inv_state[k]
        inv_state[k] = v
    inv_d.append({"t": t, "row": row, "full": full, "d": d, "state": dict(inv_state)})
inv_by_row = collections.defaultdict(dict)
for e in inv_d:
    for k, v in e["d"].items(): inv_by_row[e["row"]][k] = inv_by_row[e["row"]].get(k, 0) + v
hits_by_row = collections.defaultdict(list)
for t, row, oid, name, m, dx, dy in obj_hits:
    if "8" in m: hits_by_row[row].append((oid, name, round(math.hypot(dx, dy))))
crem_by_row = collections.defaultdict(list)
for t, row, oid, cat, name, dx, dy, e in removals:
    if cat == 0 and "13" not in e["f"] and math.hypot(dx, dy) < 350: crem_by_row[row].append((oid, cre_name(e["f"].get("22")), round(math.hypot(dx, dy))))
xp_ev = []
prev = None
join_rows = [l["join_row"] for l in lives]
for t, row, tot in xp_msgs:
    if prev is None or any(prev[1] < jr <= row for jr in join_rows): d = tot - (0 if prev is None else 0)
    if prev is not None and not any(prev[1] < jr <= row for jr in join_rows): d = tot - prev[2]
    else: d = None
    k = rx_pos.get(row, 0)
    ctx_rows = rx_rows[max(0, k - 2):k + 1]
    hits = [h for rr in ctx_rows for h in hits_by_row.get(rr, [])]
    invd = {}
    for rr in rx_rows[max(0, k - 1):k + 2]:
        for kk, vv in inv_by_row.get(rr, {}).items(): invd[kk] = invd.get(kk, 0) + vv
    crem = [c for rr in rx_rows[max(0, k - 3):k + 2] for c in crem_by_row.get(rr, [])]
    tk = tick_by_row.get(row)
    xp_ev.append({"t": round(t, 2), "row": row, "total": tot, "d": d, "hits": hits, "inv_d": invd, "creature_removed": crem,
                  "item": item_name(tk["sitem"]) if tk else None})
    prev = (t, row, tot)
def xp_kind(e):
    if e["creature_removed"]: return "kill:" + e["creature_removed"][0][1]
    if e["hits"]: return "hit:" + family(e["hits"][0][1])
    if e["inv_d"]: return "inv_only"
    return "other"
xp_by = collections.defaultdict(list)
for e in xp_ev:
    if e["d"] is None or e["d"] <= 0: continue
    xp_by[xp_kind(e)].append(e)
SLOT = {}
slot_votes = collections.defaultdict(collections.Counter)
for e in xp_ev:
    if e["hits"] and len(e["inv_d"]) >= 1:
        for kk, vv in e["inv_d"].items():
            if vv > 0: slot_votes[kk][family(e["hits"][0][1])] += 1
put("xp", {"value": {"by_source": {k: {"n": len(v), "xp_per_event": dict(collections.Counter(e["d"] for e in v)), "evidence": [{kk: e[kk] for kk in ("t", "row", "d", "total", "hits", "inv_d", "creature_removed", "item")} for e in v[:4]]}
                                   for k, v in sorted(xp_by.items(), key=lambda kv: -len(kv[1]))},
                     "xp_field": "type sp3 75 (atl4 27) 'i' = total XP (absolute)",
                     "totals_at_death": [{"life": l["own"], "xp_before_death": max([x[2] for x in xp_msgs if l["join_t"] <= x[0] <= (l["death_t"] or 1e9)] or [0])} for l in lives]},
           "status": "measured",
           "method": "XP total messages in order; delta per message; source = creature (no owner) removed within 350 of the player in the last 3 frames, else a static object hit record (field 8) in the same or previous 2 frames, else inventory change only.",
           "n_messages": len(xp_msgs)})
put("inventory", {"value": {"slot_by_hit_family_votes": {k: dict(v) for k, v in slot_votes.items()},
                            "start_inventory": [e["state"] for e in inv_d if e["full"]],
                            "field": "type sp3 54 (atl4 53) 'i' = {slot: count}; join sends all slots, later only changed slots (absolute counts)"},
                  "status": "measured", "method": "inventory deltas paired with object hits in the same XP frame"})

# ---------------------------------------------------------------- gather yields per hit and swing rate
gy = collections.defaultdict(collections.Counter)
gy_ev = collections.defaultdict(list)
xp_eq = collections.Counter()
for e in xp_ev:
    if e["d"] and e["d"] > 0 and e["hits"] and e["inv_d"]:
        fam = family(e["hits"][0][1])
        gy[(fam, e["item"])][tuple(sorted(e["inv_d"].items()))] += 1
        xp_eq["xp==sum(resources)" if e["d"] == sum(v for v in e["inv_d"].values() if v > 0) else "differs"] += 1
        if len(gy_ev[(fam, e["item"])]) < 2: gy_ev[(fam, e["item"])].append({"t": e["t"], "row": e["row"], "inv_d": e["inv_d"], "xp": e["d"]})
SLOTN = {"0": "food", "1": "wood", "2": "stone", "3": "gold"}
gather = {}
for (fam, it), c in sorted(gy.items(), key=lambda kv: -sum(kv[1].values())):
    if sum(c.values()) < 2: continue
    top = c.most_common(1)[0][0]
    gather["%s|%s" % (fam, it)] = {"hits": sum(c.values()), "mode_yield": {SLOTN.get(k, k): v for k, v in top}, "mode_share": rnd(c.most_common(1)[0][1] / sum(c.values())),
                                   "other": [[{SLOTN.get(k, k): v for k, v in y}, n] for y, n in c.most_common(4)[1:]], "evidence": gy_ev[(fam, it)]}
swing = collections.defaultdict(list)
last15 = None
for tk in ticks:
    if "15" in tk["rec"]:
        if last15 and last15["own"] == tk["own"] and tk["attack"] and last15["attack"] and last15["sitem"] == tk["sitem"]:
            swing[(item_name(tk["sitem"]), tk["rec"]["15"])].append(rx_pos[tk["row"]] - rx_pos[last15["row"]])
        last15 = tk
swing_out = {}
for (it, f15), v in sorted(swing.items(), key=lambda kv: -len(kv[1])):
    if len(v) < 3: continue
    gaps = [g for g in v if g < 30]
    c = collections.Counter(gaps)
    swing_out["%s|f15=%s" % (it, f15)] = {"n": len(gaps), "interval_frames_mode": c.most_common(1)[0][0], "interval_ms_mode": rnd(c.most_common(1)[0][0] * TICK * 1000, 0),
                                          "interval_frames_top": c.most_common(4),
                                          "items_json_reload_ms": next((x.get("reload") for x in ITEMS.values() if x["name"] == it), None)}
put("gather", {"value": {"yield_per_hit": gather, "xp_vs_resources": dict(xp_eq),
                         "slots": {"0": "food", "1": "wood", "2": "stone", "3": "gold", "4": "?", "5": "?"},
                         "note": "one XP per resource unit gathered: the XP delta of a hit equals the resources it gave"},
               "status": "measured", "method": "XP frames paired with the static object hit record (field 8 = hit angle on the object) and the inventory delta in the same +-1 frames; grouped by object family and held item (server field 8 on own records)."})
put("swing", {"value": swing_out, "status": "measured (bursty frame arrival widens the spread; use the median)",
              "unit": "server frames (ticks) between own records with field 15 while the attack button is held; ms = frames * tick",
              "method": "field 15 on the own record = use/swing animation (value = its duration in ms); interval between consecutive ones with the same held item and the attack op held (sp3 op 10 != 0), counted in server frames (frame arrival is bursty, frame count is not)"})

# ---------------------------------------------------------------- age
def age_of(xp):
    L = 0
    while L < 60 and xp >= 20 * (L + 1) * (L + 2) + 1: L += 1
    return L
age_ev = []
pa = None
for t, row, tot in xp_msgs:
    a = age_of(tot)
    if pa is not None and a != pa:
        r = rowmsgs[row]
        others = [m for m in r["m"] if isinstance(m, dict) and m.get("_a") not in (84, 79, 87)]
        nxt = []
        k = rx_pos[row]
        for rr in rx_rows[k + 1:k + 6]:
            nxt += [m for m in rowmsgs[rr]["m"] if isinstance(m, dict) and m.get("_a") not in (84, 79, 87, 64, 27, 53)]
        age_ev.append({"t": round(t, 2), "row": row, "xp": tot, "age_from": pa, "age_to": a, "same_frame": others, "next_frames": nxt[:6]})
    pa = a
q74 = [{"t": round(rel(r), 2), "row": r["i"], "m": m} for r in rows if r["k"] == "rx" for m in r["m"] if isinstance(m, dict) and m.get("_a") == 37]
put("age", {"value": {"formula": "age L starts at 20*L*(L+1)+1 XP (client), checked: the XP totals cross these thresholds; no dedicated age-up message was found in the frames at a crossing",
                      "crossings": age_ev[:40], "n_crossings": len(age_ev), "max_age_reached": max([e["age_to"] for e in age_ev] or [0]),
                      "type_sp74_atl37_messages": q74},
            "status": "measured (thresholds from the formula; server sends only the XP total)",
            "method": "age computed from each XP total with the client formula; frames at each crossing listed with their non-move messages"})

# ---------------------------------------------------------------- death and respawn
def nonmove(r, keep_own=None):
    out = []
    for m in r.get("m") or []:
        if not isinstance(m, dict): continue
        a = m.get("_a")
        if a == 84 and not (m.get("0") == keep_own and set(m) - {"0", "1", "3", "4", "5", "_c", "_a"}): continue
        if a in (79, 87) and m.get("0") != keep_own and m.get("2") != 1: continue
        if a == 64: continue
        out.append(m)
    return out
deaths = []
for li, l in enumerate(lives):
    if l["death_t"] is None: continue
    own = l["own"]
    seq = []
    hp0 = next((tk for tk in ticks if tk["own"] == own and tk["rec"].get("12") == 0), None)
    t_a = (hp0["t"] if hp0 else l["death_t"]) - 0.3
    nxt = lives[li + 1] if li + 1 < len(lives) else None
    for r in rows:
        t = rel(r)
        if t < t_a or t > l["death_t"] + 4: continue
        if r["k"] == "rx":
            for m in nonmove(r, own): seq.append({"t": round(t, 2), "row": r["i"], "dir": "rx", "m": m})
        elif r["k"] == "tx":
            seq.append({"t": round(t, 2), "row": r["i"], "dir": "tx", "ops": r.get("ops"), "json": r.get("json")})
    spect = [x for x in tx_ops[4] if l["death_t"] < x[0] < (nxt["join_t"] if nxt else 1e9)]
    rs = []
    if nxt:
        for r in rows:
            t = rel(r)
            if nxt["join_t"] - 1.0 <= t <= nxt["join_t"] + 0.5:
                if r["k"] == "rx":
                    for m in r["m"]:
                        if isinstance(m, dict) and not (m.get("_a") in (84, 87) or (m.get("_a") == 79 and m.get("2") in (3, 2, 4))): rs.append({"t": round(t, 2), "row": r["i"], "dir": "rx", "m": m})
                elif r["k"] == "tx":
                    j = r.get("json")
                    if j: j = json.loads(json.dumps(j)); [x.update({"c": x["c"][:24] + "..."}) for x in (j if isinstance(j, list) else [j]) if isinstance(x, dict) and "c" in x]
                    rs.append({"t": round(t, 2), "row": r["i"], "dir": "tx", "ops": r.get("ops"), "json": j})
    shield = []
    if nxt:
        for tk in ticks:
            if tk["own"] == nxt["own"] and "24" in tk["rec"] and tk["t"] < nxt["join_t"] + 10: shield.append((round(tk["t"] - nxt["join_t"], 2), tk["rec"]["24"]))
    inv_before = [e["state"] for e in inv_d if e["t"] <= l["death_t"]][-1:]
    inv_after = [e["state"] for e in inv_d if nxt and e["full"] and e["t"] >= nxt["join_t"] - 0.1][:1]
    xp_before = [x[2] for x in xp_msgs if x[0] <= l["death_t"]][-1:]
    xp_after = [x[2] for x in xp_msgs if nxt and x[0] >= nxt["join_t"] - 0.1][:2]
    spawn = None
    if nxt:
        c = next((m for r in rows if r["k"] == "rx" and abs(rel(r) - nxt["join_t"]) < 0.5 for m in r["m"] if isinstance(m, dict) and m.get("_a") == 79 and m.get("0") == nxt["own"]), None)
        spawn = c and {"x": c["3"], "y": c["4"], "create": c}
    deaths.append({"life_own_id": own, "hp0_t": hp0 and round(hp0["t"], 2), "hp0_row": hp0 and hp0["row"], "death_msg_t": round(l["death_t"], 2), "death_row": l["death_row"],
                   "sequence": seq[:40], "client_while_dead": {"op4_count": len(spect), "op4_interval_s_median": med([round(b[0] - a[0], 2) for a, b in zip(spect, spect[1:])])},
                   "respawn_after_s": nxt and round(nxt["join_t"] - l["death_t"], 1), "respawn_exchange": rs[:30], "spawn": spawn,
                   "shield_field24_after_spawn": shield[:12], "inventory_before": inv_before, "inventory_after": inv_after, "xp_before": xp_before, "xp_after": xp_after})
first_spawn = next((m for r in rows if r["k"] == "rx" for m in r["m"] if isinstance(m, dict) and m.get("_a") == 79 and m.get("0") == lives[0]["own"]), None)
sh0 = [(round(tk["t"] - lives[0]["join_t"], 2), tk["rec"]["24"]) for tk in ticks if tk["own"] == lives[0]["own"] and "24" in tk["rec"]][:12]
put("death_respawn", {"value": deaths, "first_join": {"spawn_create": first_spawn, "shield_field24": sh0},
                      "status": "measured", "unit": "t in s; field 24 in ms",
                      "method": "frames from 0.3 s before the own hp-0 record to 4 s after the death message (type sp3 26 = atl4 6), non-move messages only; respawn exchange = all non-object messages within 1 s before/0.5 s after the next own_info join; shield = field 24 on own create/move records after spawn"})

# ---------------------------------------------------------------- idle / keepalive / AFK
inp = []
for r in rows:
    if r["k"] == "input":
        for e in r["ev"]:
            if e[2] in ("kd", "ku", "md", "mu", "mm", "wh"): inp.append(e[1] / 1000.0 - T0)
inp.sort()
gaps = sorted([(round(b - a, 1), round(a, 1), round(b, 1)) for a, b in zip(inp + [rel(rx[-1])], inp[1:] + [rel(rx[-1])]) if b > a], reverse=True)[:6]
idle = []
for g, a, b in gaps[:3]:
    rxn = [r for r in rows if r["k"] == "rx" and a < rel(r) < b]
    txn = [r for r in rows if r["k"] == "tx" and a < rel(r) < b]
    types = collections.Counter(m.get("_a") for r in rxn for m in r["m"] if isinstance(m, dict))
    hb = [rel(r) for r in txn if any(o[0] == 8 for o in r.get("ops") or [])]
    other_tx = collections.Counter(o[0] for r in txn for o in (r.get("ops") or []) if o[0] != 8)
    idle.append({"from": a, "to": b, "s": g, "alive": bool(life_at(a)) and bool(life_at(b)), "rx_frames": len(rxn), "rx_per_s": rnd(len(rxn) / g, 2), "rx_types_atl4": {str(k): v for k, v in types.most_common(8)},
                 "tx_heartbeats": len(hb), "heartbeat_interval_s_median": med([round(y - x, 2) for x, y in zip(hb, hb[1:])]), "tx_other_ops": dict(other_tx)})
hb_all = [t for t, row, v in tx_ops[8]]
hb_gaps = [round(b - a, 2) for a, b in zip(hb_all, hb_all[1:])]
put("idle", {"value": {"longest_input_gaps": idle, "heartbeat_interval_s_median": med(hb_gaps), "heartbeat_interval_hist": collections.Counter(round(g) for g in hb_gaps).most_common(6),
                       "ws_closed_in_capture": False, "last_rx_t": round(rel(rx[-1]), 2), "capture_input_end_t": round(inp[-1], 2) if inp else None,
                       "afk_kick": "not observed: no close, no warning message; the capture ends %.0f s after the last input with the player alive and frames still arriving" % (rel(rx[-1]) - inp[-1])},
             "status": "measured", "method": "gaps between keyboard/mouse events (input records); rx/tx counted inside each gap; heartbeat = sp3 tx op 8 (atl4 8), value 0"})

# ---------------------------------------------------------------- other players, creatures, render distance
pl_creates = [m for r in rows if r["k"] == "rx" for m in r["m"] if isinstance(m, dict) and m.get("_a") == 79 and m.get("2") == 1 and m.get("0") not in OWNS]
fstat = collections.defaultdict(collections.Counter)
for m in pl_creates:
    for k, v in m.items():
        if not k.startswith("_") and k not in ("0", "1", "2", "3", "4"): fstat[k][v if not isinstance(v, (list, dict)) else str(v)] += 1
ids = {m["0"] for m in pl_creates}
vis_frames, rec_frames, moving_rec = collections.Counter(), collections.Counter(), collections.Counter()
W3 = World(); prevpos = {}
for r in rows:
    if r["k"] != "rx": continue
    seen = set()
    for m in r["m"]:
        if not isinstance(m, dict): continue
        W3.apply(m, rel(r))
        if m.get("0") in ids and m.get("_a") == 84: seen.add(m["0"])
    for i in ids:
        if i in W3.ents:
            vis_frames[i] += 1
            if i in seen: rec_frames[i] += 1
pl_rem = [(math.hypot(dx, dy), dx, dy) for t, row, oid, cat, name, dx, dy, e in removals if cat == 1 and oid not in OWNS]
put("other_players", {"value": {"n_distinct": len(ids), "n_creates": len(pl_creates),
                                "create_fields": {k: {"distinct": len(v), "top": [[a, b] for a, b in v.most_common(6)]} for k, v in sorted(fstat.items(), key=lambda kv: int(kv[0]))},
                                "field_guess": {"5": "angle (0..1256 = rad*200?)", "7": "state (1 idle, 2 moving, 16 dead, 9 at spawn)", "8": "held item id (items.json)", "9": "secondary item / hat id",
                                                "12": "hp", "14": "skin/cosmetic id (956-967)", "18": "name", "19": "score (= xp)", "20": "age level", "21": "pet/badge id?", "26": "clan tag",
                                                "24": "spawn shield ms (5000 counting down)", "25": "speed factor (always 10)"},
                                "record_share_while_visible": rnd(sum(rec_frames.values()) / max(1, sum(vis_frames.values())), 3),
                                "removal_offsets_p50_abs": [pct([abs(x[1]) for x in pl_rem], 50), pct([abs(x[2]) for x in pl_rem], 50)], "n_removals": len(pl_rem),
                                "example_creates": pl_creates[:3]},
                      "status": "measured (values); semantics estimated", "method": "category-1 creates of non-own ids; record share = frames with a move/keepalive record for the id / frames the id was alive in view"})
cr_creates = [m for r in rows if r["k"] == "rx" for m in r["m"] if isinstance(m, dict) and m.get("_a") == 79 and m.get("2") == 0]
kinds = collections.defaultdict(lambda: {"n": 0, "f21": collections.Counter(), "f23": collections.Counter(), "f24": collections.Counter(), "pets": 0})
for m in cr_creates:
    k = kinds[cre_name(m.get("22"))]; k["n"] += 1; k["f21"][m.get("21")] += 1; k["f23"][m.get("23")] += 1; k["f24"][m.get("24")] += 1
    if "13" in m: k["pets"] += 1
# creature speeds: cruise displacement per frame
cs = collections.defaultdict(collections.Counter)
W4 = World(); last = {}
for r in rows:
    if r["k"] != "rx": continue
    for m in r["m"]:
        if not isinstance(m, dict): continue
        i = m.get("0"); e0 = W4.ents.get(i)
        before = (e0["x"], e0["y"]) if e0 else None
        W4.apply(m, rel(r))
        e = W4.ents.get(i)
        if m.get("_a") == 84 and e and e["cat"] == 0 and before and ("3" in m or "4" in m):
            d = round(math.hypot(e["x"] - before[0], e["y"] - before[1]))
            if 0 < d < 200: cs[cre_name(e["f"].get("22")) + ("/pet" if "13" in e["f"] else "")][d] += 1
cr_hits = collections.defaultdict(lambda: collections.Counter())
for r in rows:
    if r["k"] != "rx": continue
    for m in r["m"]:
        if isinstance(m, dict) and m.get("_a") == 84 and "10" in m:
            e = W4.ents.get(m.get("0"))
put("creatures", {"value": {"kinds": {k: {"n": v["n"], "pets": v["pets"], "f21": v["f21"].most_common(5), "f23": dict(v["f23"]), "f24": v["f24"].most_common(4),
                                          "speed_per_frame_top": cs[k].most_common(5), "speed_per_frame_max_common": max([d for d, c in cs[k].items() if c >= 3] or [None]) if cs[k] else None}
                                      for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]["n"])},
                            "fields": {"22": "creature kind (client table key -> sprite)", "21": "varies per instance (level or hp?)", "23": "flag 0..3", "24": "0 or a timer",
                                       "13": "owner player id (present = pet)", "16": "pet owner-related id (479-483)", "move 9": "hp bar 0..255", "move 10": "damage taken this frame", "move 11": "hit kind (1, 3)", "move 7": "state (2 walk, 34 attack, 1 idle, 66, 18 dying?)"},
                            "pet_speeds": {k: v.most_common(4) for k, v in cs.items() if k.endswith("/pet")}},
                  "status": "measured (kinds, speeds); kind names from the client table (estimated mapping by table key)",
                  "method": "category-0 creates; speeds = displacement between consecutive position updates of the same creature (per frame when it moves every frame)"})
# render distance
cre_off = [(abs(dx), abs(dy)) for t, row, oid, cat, name, dx, dy in creates if cat == 3]
rem_off = [(abs(dx), abs(dy)) for t, row, oid, cat, name, dx, dy, e in removals if cat == 3]
def edge_vals(off):
    xs = sorted(dx for dx, dy in off if dy < 500); ys = sorted(dy for dx, dy in off if dx < 700)
    return {"x_p99": pct(xs, 99), "x_max": xs[-1] if xs else None, "y_p99": pct(ys, 99), "y_max": ys[-1] if ys else None, "n": len(off)}
put("render_distance", {"value": {"create_offsets": edge_vals(cre_off), "remove_offsets": edge_vals(rem_off),
                                  "remove_x_hist_top": collections.Counter(dx // 50 * 50 for dx, dy in rem_off if dy < 500).most_common(5),
                                  "remove_y_hist_top": collections.Counter(dy // 50 * 50 for dx, dy in rem_off if dx < 700).most_common(5),
                                  "create_x_hist_top": collections.Counter(dx // 50 * 50 for dx, dy in cre_off if dy < 500).most_common(5),
                                  "create_y_hist_top": collections.Counter(dy // 50 * 50 for dx, dy in cre_off if dx < 700).most_common(5)},
                        "status": "measured", "unit": "world units, |object - own player| at create/remove time",
                        "method": "static objects (category 3); x edge from objects with |dy| < 500, y edge from |dx| < 700. Removes include destroyed objects (small offsets)."})

# ---------------------------------------------------------------- leaderboard, chat, clan, client ops
boards = []
for r in rows:
    for m in r.get("m") or []:
        if isinstance(m, dict) and m.get("_a") == 64 and "o" in m:
            o = m["o"]; txt = "".join(chr(o[i] ^ o[i - 1]) for i in range(1, len(o)))
            try: val = json.loads("[" + txt)
            except Exception as e: val = None
            boards.append({"t": round(rel(r), 2), "row": r["i"], "k0": o[0] ^ ord("["), "rows": val})
full_board = next((b for b in boards if b["rows"] and all(isinstance(x, list) and len(x) >= 4 for x in b["rows"])), None)
def safe(v): return json.loads(json.dumps(v, ensure_ascii=True))
put("leaderboard", {"value": {"n": len(boards), "decoded_ok": sum(1 for b in boards if b["rows"] is not None), "first_char_key_values": dict(collections.Counter(b["k0"] for b in boards)),
                              "row_format": "[entity_id, name, score, rank_badge(0..10), is_marked(only on some rows; 1 = crown/king)]; delta frames: 1 = row unchanged, [score] = score update for that row, full row = replaced",
                              "decrypt": "plain[i] = chr(o[i] ^ o[i-1]) for i >= 1 (chained XOR; the setup key only decrypts o[0], which is always '['). Client: JSON.parse(_6437(o, (key + c) % 255)).",
                              "first_full_board": full_board and safe(full_board), "examples": [safe(b) for b in boards[1:4]],
                              "minimap_fields": {"ob": "[x, y, boss kind] minimap boss marker", "pa": "[x, y] marker"}},
                    "status": "measured"})
chat_tx = [{"t": round(rel(r), 2), "row": r["i"], "json": r["json"]} for r in rows if r["k"] == "tx" and isinstance(r.get("json"), list) and any(isinstance(x, dict) and x.get("type") == 0 for x in r["json"])]
chat_rx = [{"t": round(rel(r), 2), "row": r["i"], "m": m} for r in rows if r["k"] == "rx" for m in r["m"] if isinstance(m, dict) and m.get("_a") == 39]
put("chat", {"value": {"tx_format": "JSON text frame [{type: 0 (sp3 json type of atl4 39), msg, tm: 1 (team/clan) or 0 (all)}, 1365]",
                       "rx_format": "type sp3 0 (atl4 39): {i: sender entity id, m: text, mt: 1} (bubble) and {m, tm: clan id, s, n: sender name, p: sender id} (clan chat log)",
                       "tx": chat_tx[:8], "rx": chat_rx[:10], "n_tx": len(chat_tx), "n_rx": len(chat_rx)}, "status": "measured"})
tx_json = collections.defaultdict(list)
for r in rows:
    if r["k"] == "tx" and r.get("json") is not None:
        for x in (r["json"] if isinstance(r["json"], list) else [r["json"]]):
            if isinstance(x, dict):
                xx = dict(x)
                if "c" in xx: xx["c"] = xx["c"][:20] + "..."
                tx_json[x.get("type")].append({"t": round(rel(r), 2), "row": r["i"], "m": xx})
OPMEAN = {0: "aim (value = angle*1000? 0..6283)", 11: "move key (dir a0 d1 s2 w3 + 256*pressed; 5 = release all)", 8: "heartbeat (every ~3 s)", 10: "attack (0 release, else angle code)",
          4: "re-key r ^= value; also sent every ~1.3 s while dead/spectating", 6: "select item (value = items.json id)", 2: "? (values 57-268, item-like)", 14: "join extra (11/20/25)",
          1: "? at join (0)", 3: "? at join (0)", 7: "? (31)", 12: "? (6400)", 16: "? (6400)"}
ops_out = {}
for b, lst in sorted(tx_ops.items()):
    ops_out[str(b)] = {"count": len(lst), "atl4_base": FMAP["ops"].get(str(b), {}).get("atl4"), "meaning": OPMEAN.get(b), "values_top": collections.Counter(v for t, r, v in lst).most_common(6),
                       "first": [round(lst[0][0], 2), lst[0][1]]}
put("client_ops", {"value": {"binary_ops": ops_out, "json_types": {str(k): {"count": len(v), "atl4_type": FMAP["types"].get(str(k), {}).get("atl4"), "examples": v[:3]} for k, v in tx_json.items()}},
                   "status": "measured (counts); meanings partly estimated",
                   "method": "all tx frames; base op = wire op ^ r. JSON types use the same shuffled type table as rx (sp3 68 = atl4 1 join, 67 = atl4 28 token)."})

# ---------------------------------------------------------------- semantics (sp3 -> atl4)
TNAME = {79: "obj_create", 84: "obj_move_keepalive", 87: "obj_remove", 53: "inventory", 27: "xp_total", 59: "own_info / minimap pos", 6: "death_scoreboard",
         64: "leaderboard_minimap", 19: "camera_target (id*256+2, s=spectate)", 32: "timer (b phase, d ms)", 36: "item_count (B = [item*256+count])", 68: "clan (m = sub-op)",
         39: "chat", 37: "quest_progress (o quest, n count)", 44: "event_counter (o, n)", 80: "event_marker (o, j)", 65: "event_marker2 (o, j)", 81: "placed_list (o = [[id, x/?, y/?, def name]], p count)",
         66: "token / H W lists", 43: "state_b (b)", 75: "gift_info (gi, i)", 52: "server_announce (m text, o ms, i color)", 31: "join_ack (empty)", 58: "join_flag (o)", 11: "join_value (o)", 86: "join_value2 (o)"}
seen_types = collections.defaultdict(lambda: {"n": 0, "ex": None})
for r in rows:
    for m in r.get("m") or []:
        if isinstance(m, dict) and isinstance(m.get("1"), int):
            st = seen_types[m["1"]]; st["n"] += 1
            if st["ex"] is None: st["ex"] = {k: v for k, v in m.items() if not k.startswith("_")}
sem_types = {}
for sid, st in sorted(seen_types.items(), key=lambda kv: -kv[1]["n"]):
    a = FMAP["types"].get(str(sid), {}).get("atl4")
    ex = json.loads(json.dumps(st["ex"], ensure_ascii=True))
    if isinstance(ex.get("o"), list) and len(ex["o"]) > 20: ex["o"] = ex["o"][:20] + ["..."]
    name = TNAME.get(a, "setup_u" if set(st["ex"]) <= {"1", "u"} else "unknown")
    sem_types[name if name not in sem_types else "%s_%d" % (name, sid)] = {"sp3_type": sid, "atl4_type": a, "client_name": FMAP["types"].get(str(sid), {}).get("client"), "count": st["n"], "example": ex}
codes = FMAP["field_codes"]; acodes = FMAP["atl4_field_codes"]
inv_c = {v: k for k, v in codes.items()}; inv_a = {v: k for k, v in acodes.items()}
FIELDS = {"0": "id", "1": "type", "2": "category (0 creature, 1 player, 2 effect, 3 static object, 4 projectile/effect)", "3": "x (>=256 absolute; 1 byte = delta, bit7 set plus)", "4": "y (same as x)",
          "5": "angle", "6": "constant 1", "7": "state flags (player 1 idle 2 moving 16 dead; creature 2/34/66; object hp-ish 0..255 on hit)",
          "8": "player: held item id; object: hit angle byte", "9": "creature hp bar 0..255; object hit flag; player secondary item",
          "10": "damage taken this frame (player/creature); projectile owner on cat 4 create", "11": "heal amount this frame (player); hit kind (creature)",
          "12": "hp (player)", "13": "player: damage source kind (1 melee); static: def index into names.json; creature: owner id (pet)",
          "14": "player skin id", "15": "use/swing animation ms", "16": "pet: owner-related id", "17": "?", "18": "player name", "19": "player score (= xp)",
          "20": "player age level", "21": "creature level/variant; player badge id", "22": "creature kind (client creature table key)", "23": "?", "24": "player spawn shield ms; creature timer",
          "25": "speed factor (10)", "26": "clan tag", "27": "pet list/extra array"}
sem_fields = {}
for k, nm in FIELDS.items():
    sem_fields[nm.split(" (")[0].split(";")[0] + " [key %s]" % k] = {"field_key": k, "sp3_wire_code": int(inv_c[k]) if k in inv_c else None, "atl4_wire_code": int(inv_a[k]) if k in inv_a else None, "notes": nm}
sem_ops = {}
for b, v in ops_out.items():
    sem_ops[(v["meaning"] or "op%s" % b).split(" (")[0] + " [sp3 %s]" % b] = {"sp3_op": int(b), "atl4_op": v["atl4_base"], "example_values": v["values_top"][:3], "notes": v["meaning"]}
SEM = {"server": FACTS["server"]["name"], "note": "Field keys (the decoded '0'..'27') are the same on every server; only wire codes, message type ids and tx op ids are shuffled. Translate an SP3 message by replacing '1' (type) with atl4_type; tx ops by sp3_op -> atl4_op. Compact records (header t==0) are always the move type.",
       "message_types": sem_types, "fields": sem_fields, "tx_ops": sem_ops,
       "tx_json_types": {str(k): {"atl4_type": FMAP["types"].get(str(k), {}).get("atl4"), "example": v[0]["m"] if v else None} for k, v in tx_json.items()}}
json.dump(SEM, open(os.path.join(REPO, "mimic", "data", "sp3_semantics.json"), "w"), indent=1, ensure_ascii=False)
print("wrote semantics", len(sem_types), "types")

# ---------------------------------------------------------------- headline summary + unknowns
F = FACTS["facts"]
wk = F["walk"]["value"]
dr = F["death_respawn"]["value"]
FACTS["summary"] = {
    "tick_ms": [F["tick"]["value"]["tick_ms"], "measured"],
    "walk_hand_units_per_tick": [wk["hand_axis_units_per_tick"], "measured", "diagonal components %s" % (wk["hand_diag_components_per_tick"],)],
    "walk_item_factor": [wk["item_speed_factor_vs_hand"], "measured"],
    "start_first_tick_fraction_stone_axe": [F["accel"]["value"]["start_profile_median_by_item"].get("Stone Axe", {}).get("first_tick_fraction"), "measured"],
    "stop_profile_stone_axe": [F["accel"]["value"]["stop_profile_median_by_item"].get("Stone Axe", {}).get("speeds_per_tick_from_last_cruise"), "measured"],
    "map_clamp_player_center": [[F["map_edge"]["value"]["x_min_reached"], F["map_edge"]["value"]["x_max_reached"]], "measured", "same for y"],
    "render_box_half_create": [[F["render_distance"]["value"]["create_offsets"]["x_p99"], F["render_distance"]["value"]["create_offsets"]["y_p99"]], "measured"],
    "render_box_half_remove": [[F["render_distance"]["value"]["remove_offsets"]["x_p99"], F["render_distance"]["value"]["remove_offsets"]["y_p99"]], "measured"],
    "max_hp": [100, "measured"],
    "passive_regen": ["none", "measured (92 s at 88 HP without change)"],
    "spawn_shield_ms": [5000, "measured (field 24 counts down)"],
    "respawn_keeps_xp_fraction": [[rnd(d["xp_after"][0] / d["xp_before"][0], 3) for d in dr if d["xp_before"] and d["xp_after"]], "measured"],
    "respawn_inventory": [[(d["inventory_before"], d["inventory_after"]) for d in dr], "measured"],
    "xp_per_resource": [1, "measured (%s)" % F["gather"]["value"]["xp_vs_resources"]],
    "heartbeat_s": [F["idle"]["value"]["heartbeat_interval_s_median"], "measured"],
}
for what, why in [
    ("player radius", "no reference of known size: contact distances give r_obj + r_player only; other players came within 51 units (no player-player collision or radii sum <= 51); map clamp 350/17250 does not give the map size"),
    ("water edge collision", "water is terrain, not sent as entities; no blocked episode could be tied to water (see blocked_no_object for unexplained stops)"),
    ("XP per animal kill", "no wild creature was killed by the player in the capture (no creature removal near the player paired with an XP change)"),
    ("drops on animal kill", "no kill observed"),
    ("animal max HP in units", "creatures carry an hp bar 0..255 (move field 9), not absolute HP; field 21 varies per instance"),
    ("cold / water / hunger damage", "not observed: every damage frame had a nearby creature, player, hazard object or projectile"),
    ("AFK kick timeout", "not reached: longest alive no-input stretch is the last %.0f s of the capture, no warning or close" % (rel(rx[-1]) - inp[-1])),
    ("tx ops 1, 2, 3, 7, 12, 16 exact meaning", "rare ops; values listed in client_ops"),
    ("player create fields 16, 17, 21, 22, 23 meaning", "values listed in other_players.create_fields; meanings not confirmed"),
    ("per-direction speed differences", "per_direction samples show the same magnitude for w/a/s/d (by_direction); no asymmetry found"),
    ("key-to-move latency on the server", "frame arrival in the capture is bursty (gaps up to 400 ms then bursts), so client tx time vs server tick cannot be aligned better than a few frames"),
]:
    unk(what, why)
save()
print("done", OUT)
