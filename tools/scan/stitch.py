#!/usr/bin/env python3
# Folds new capture-mode scans into the clone data. Reads work/stitched.txt (capture file name TAB status: stitched |
# skipped:<reason>), decodes every raw scan in rnd_ws/captures/scans not listed there (per-server tables made with
# direct_scan/node/tables.js when missing), sanity checks each decode, then rebuilds mimic/world_scan.json and
# mimic/data/scan_spawns.json from all stitched scans. Same spot: world_sp5.json wins, then the newest scan.
# Human play captures (rnd_ws/captures/*_human.jsonl[.gz]) with a game socket are decoded next to themselves and feed the
# world layout only (status stitched-world); their creatures are not a spawn sample.
# Then rebuilds work/session_facts/<tag>.json for every stitched human file and nearboss scan that is new or changed, and the
# aggregate mimic/data/session_facts.json (tools/scan/session_facts.py).
# Appends to work/stitched.txt and a dated section to work/stitch_log.md.
# Usage: stitch.py [--seed] [--jobs N] [--dry]
#   --seed  first list every scan already decoded in scans_dec as stitched (run once when stitched.txt is missing)
import argparse, collections, datetime, glob, gzip, json, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_scan_spawns
HOME = os.path.expanduser("~")
RND = os.path.join(HOME, "tio", "tio_dev", "rnd_ws")
SCANS, DEC, REJ = (os.path.join(RND, "captures", d) for d in ("scans", "scans_dec", "scans_dec_rejected"))
DECODER = os.path.join(RND, "decoder")
PY = os.path.join(HOME, "new-decode-sg", ".venv", "bin", "python")
NODE = os.path.join(HOME, "node", "bin", "node")
TABLES = os.path.join(HOME, "tio", "tio_dev", "direct_scan", "node", "tables.js")
LIST, LOG = os.path.join(PKG, "work", "stitched.txt"), os.path.join(PKG, "work", "stitch_log.md")
WORLD, SPAWNS = os.path.join(PKG, "mimic", "world_scan.json"), os.path.join(PKG, "mimic", "data", "scan_spawns.json")
NAMES = json.load(open(os.path.join(DECODER, "names.json")))
_W = json.load(open(os.path.join(PKG, "mimic", "world_sp5.json")))
ALLOWED = {int(b): {o.get("name") for o in v["objects"] + v.get("synthetic", [])} for b, v in _W["phases"].items()}
BUILD = ("wall", "spike", "door", "turret", "windmill", "pad", "tower", "trap", "chest", "bed", "table", "lamp", "gift")
# world objects the base map never shows but the live map has: the ocean statue region (bmb-plant-statue, bmb-fire-statue,
# bmb-statue near 1500..1900, 5700..6100, phase 4 only; seen in 6 scans and the bbotot statue walk 20261019_092752)
WORLD_EXTRA = ("bmb-", "totem")   # totem: clan totems (def 0) stand at fixed spots; stitched free (clan tag 14 / level 12 dropped)

def tag_of(fn): return os.path.basename(fn).replace(".jsonl.gz", "").replace(".v2.jsonl", "")
def ts_of(tag):
    m = re.search(r"(\d{8}_\d{6})$", tag); return m.group(1) if m else ""

def read_list():
    st = collections.OrderedDict()
    if os.path.exists(LIST):
        for l in open(LIST):
            if "\t" in l: n, s = l.rstrip("\n").split("\t", 1); st[n] = s
    return st

HUMAN = os.path.join(RND, "captures")

def server_key(path):
    with (gzip.open(path, "rt") if path.endswith(".gz") else open(path)) as f:
        for l in f:
            r = json.loads(l)
            if r.get("k") == "ws_open": return r["url"].split("://", 1)[1].split("/", 1)[1].split("?", 1)[0]
    return None

def make_tables(keys):
    keys = [k for k in keys if not all(os.path.exists(os.path.join(DECODER, "%s_%s.json" % (m, k))) for m in ("fieldmap", "typemap", "opmap"))]
    if not keys: return []
    env = dict(os.environ, BUNDLE=os.path.join(PKG, "mimic", "game_mimic.js"))
    d = {}
    for i in range(0, len(keys), 6):   # tables.js exits right after one write, so a pipe gets at most 64 KB
        out = subprocess.run([NODE, TABLES, "atlanta4"] + keys[i:i + 6], env=env, capture_output=True, text=True, cwd=os.path.dirname(TABLES), check=True).stdout
        d.update(json.loads(out.strip().splitlines()[-1]))
    a, ak = d["atlanta4"]["T"], d["atlanta4"]["K"]
    for k in keys:
        json.dump({str(v): ak[n] for n, v in d[k]["K"].items() if n in ak}, open(os.path.join(DECODER, "opmap_%s.json" % k), "w"))
        fm = {str(c): str(v) for c, v in d[k]["F"].items()}
        tm = {str(d[k]["T"][n]): a[n] for n in d[k]["T"] if n in a}
        json.dump(fm, open(os.path.join(DECODER, "fieldmap_%s.json" % k), "w"))
        json.dump(tm, open(os.path.join(DECODER, "typemap_%s.json" % k), "w"))
    return keys

def decode(raw, key, out):
    r = subprocess.run([PY, os.path.join(DECODER, "decode.py"), raw, "--out", out, "--fieldmap", os.path.join(DECODER, "fieldmap_%s.json" % key)],
                       capture_output=True, text=True, cwd=RND)
    m = re.search(r"rx ok (\d+) err (\d+)", r.stdout)
    return (int(m.group(1)), int(m.group(2))) if m and r.returncode == 0 else (0, -1)

def sanity(path, key):
    # wrong protocol tables (older client builds) give garbage species / stages / names and no biome message
    tm = json.load(open(os.path.join(DECODER, "typemap_%s.json" % key)))
    c = collections.Counter(); ph = None
    for l in open(path):
        r = json.loads(l)
        for x in r.get("msgs", []) or []:
            if not isinstance(x, dict) or build_scan_spawns.compact(x): continue
            t = tm.get(str(x.get("1")))
            if t == 32 and isinstance(x.get("b"), int) and 0 <= x["b"] <= 5: c["biome"] += 1; ph = x["b"]
            if t != 79: continue
            if x.get("2") == 0 and "21" in x:
                c["cre"] += 1
                if isinstance(x.get("21"), int) and 0 <= x["21"] <= 200 and isinstance(x.get("23"), int) and 0 <= x["23"] <= 3: c["cre_ok"] += 1
            if x.get("2") == 3 and "13" in x:
                c["obj"] += 1
                if isinstance(x["13"], int) and 0 <= x["13"] < len(NAMES):
                    c["obj_ok"] += 1
                    if ph is not None and x.get("15") is None and x.get("16") is None:
                        c["obj_w"] += 1; c["obj_biome"] += NAMES[x["13"]] in ALLOWED.get(ph, ())
    if not c["biome"]: return "no biome message", c
    if c["obj"] < 5: return "objects %d" % c["obj"], c
    if c["obj_ok"] < 0.95 * c["obj"]: return "object names %d/%d resolve" % (c["obj_ok"], c["obj"]), c
    if c["obj_w"] >= 5 and c["obj_biome"] < 0.25 * c["obj_w"]: return "object names fit biome %d/%d" % (c["obj_biome"], c["obj_w"]), c
    if c["cre"] >= 5 and c["cre_ok"] < 0.9 * c["cre"]: return "creatures %d/%d plausible" % (c["cre_ok"], c["cre"]), c
    return None, c

def build_world(files):
    # build_world_scan.py logic, with the newest scan winning a spot seen by several
    W = json.load(open(os.path.join(PKG, "mimic", "world_sp5.json")))
    have = {int(b): {(o["3"], o["4"]) for o in v["objects"] if "3" in o and "4" in o} for b, v in W["phases"].items()}
    allowed = {int(b): {o.get("name") for o in v["objects"] + v.get("synthetic", [])} for b, v in W["phases"].items()}
    # one real server per 600 cell: hollow logs, gifts, tumbleweeds, thornbushes ... are placed at random per server (1 % of
    # their spots repeat across servers), so stitching every scan into a cell piled them up (30+ logs in one view). Each
    # cell now takes all its objects from one scan only (the newest that has objects there), cells the base map covers take
    # none, and an object closer than OVERLAP to one already taken is dropped.
    OVERLAP = 60
    base_cells = {int(b): {(o["3"] // 600, o["4"] // 600) for o in v["objects"] if "3" in o and "4" in o} for b, v in W["phases"].items()}
    owner = collections.defaultdict(dict); near = collections.defaultdict(lambda: collections.defaultdict(list))
    def crowded(ph, x, y):
        for gx in (x // 200 - 1, x // 200, x // 200 + 1):
            for gy in (y // 200 - 1, y // 200, y // 200 + 1):
                for (ox, oy) in near[ph][(gx, gy)]:
                    if (ox - x) ** 2 + (oy - y) ** 2 < OVERLAP * OVERLAP: return True
        return False
    for b, v in W["phases"].items():
        for o in v["objects"]:
            if "3" in o and "4" in o: near[int(b)][(o["3"] // 200, o["4"] // 200)].append((o["3"], o["4"]))
    objs = collections.defaultdict(dict); cells = collections.defaultdict(set)
    for f in sorted(files, key=lambda f: (ts_of(tag_of(f)), tag_of(f)), reverse=True):
        key = open(f.replace(".v2.jsonl", ".key")).read().strip(); tm = json.load(open(os.path.join(DECODER, "typemap_%s.json" % key))); ph = None
        tag = tag_of(f)
        for l in open(f):
            for x in json.loads(l).get("msgs", []) or []:
                if not isinstance(x, dict) or build_scan_spawns.compact(x): continue
                t = tm.get(str(x.get("1")))
                if t == 32 and isinstance(x.get("b"), int) and 0 <= x["b"] <= 5: ph = x["b"]
                if t != 79 or x.get("2") != 3 or ph is None or "3" not in x or not isinstance(x.get("13"), int) or x["13"] >= len(NAMES): continue
                if x.get("15") is not None or x.get("16") is not None: continue
                nm = NAMES[x["13"]]
                if (nm not in allowed.get(ph, set()) and not nm.startswith(WORLD_EXTRA)) or any(b in nm for b in BUILD): continue
                cell = (x["3"] // 600, x["4"] // 600); cells[ph].add(cell)
                if nm != "totem":   # totems: the base map has none; any scan's totem spot is kept (overlap check only)
                    if cell in base_cells.get(ph, ()): continue
                    if owner[ph].setdefault(cell, tag) != tag: continue
                p = (x["3"], x["4"])
                if p in have.get(ph, set()) or p in objs[ph] or crowded(ph, x["3"], x["4"]): continue
                near[ph][(x["3"] // 200, x["4"] // 200)].append(p)
                rec = {k: v for k, v in x.items() if k.isdigit() and k not in ("0", "11") and not (nm == "totem" and k in ("12", "14"))}
                rec["1"] = 79; rec["name"] = nm; rec["src"] = "scan " + tag
                objs[ph][p] = rec
    out = {"note": "capture-mode scans stitched onto the base map (tools/scan/stitch.py; base wins, then newest scan)", "phases": {}}
    for ph in sorted(cells):
        out["phases"][str(ph)] = {"objects": list(objs[ph].values()), "covered_cells_600": sorted(list(c) for c in cells[ph])}
    return out

def phase_stats(w, s):
    ph = {}
    for k in sorted(set(w.get("phases", {})) | {k for k in s if k != "note"}, key=int):
        v = w.get("phases", {}).get(k, {})
        ph[k] = {"objects": len(v.get("objects", [])), "cells": len(v.get("covered_cells_600", [])),
                 "scans": len(s.get(k, {}).get("per_scan", [])), "templates": {tuple(t[:3]): t[3] for t in s.get(k, {}).get("templates", [])}}
    return ph

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", action="store_true"); ap.add_argument("--jobs", type=int, default=3); ap.add_argument("--dry", action="store_true")
    A = ap.parse_args()
    os.makedirs(REJ, exist_ok=True)
    st = read_list()
    if A.seed and not st:
        with open(LIST, "a") as f:
            for d in sorted(glob.glob(os.path.join(DEC, "*.v2.jsonl"))):
                n = tag_of(d) + ".jsonl.gz"
                if os.path.exists(os.path.join(SCANS, n)): f.write("%s\tstitched\n" % n); st[n] = "stitched"
        print("seeded", len(st))
    raws = sorted(os.path.basename(p) for p in glob.glob(os.path.join(SCANS, "*.jsonl.gz")))
    import time
    young = [n for n in raws if n not in st and time.time() - os.path.getmtime(os.path.join(SCANS, n)) < 600]
    new = [n for n in raws if n not in st and n not in young]   # a scan still being written waits for the next run
    hraws = sorted(os.path.basename(p) for p in glob.glob(os.path.join(HUMAN, "*_human.jsonl*")))
    hraws = [n for n in hraws if not (n.endswith(".jsonl") and n + ".gz" in hraws)]
    hnew = [n for n in hraws if n not in st and time.time() - os.path.getmtime(os.path.join(HUMAN, n)) >= 600]
    print("raw scans", len(raws), "listed", len(st), "new", len(new), "still being written", len(young), "new human captures", len(hnew))
    if A.dry: return
    keys = {}
    for n in new:
        try: keys[n] = server_key(os.path.join(SCANS, n))
        except Exception as e: keys[n] = None
    made = make_tables(sorted({k for k in keys.values() if k}))
    if made: print("made tables", made)
    def one(n):
        k = keys[n]
        if not k: return n, "skipped:no ws_open", None
        tag = tag_of(n); tmp = os.path.join(REJ, tag + ".v2.jsonl")
        ok, err = decode(os.path.join(SCANS, n), k, tmp)
        open(tmp.replace(".v2.jsonl", ".key"), "w").write(k)
        if err < 0: return n, "skipped:decode failed", None
        if err > 0.02 * max(1, ok + err): return n, "skipped:rx frame errors %d/%d" % (err, ok + err), None
        why, c = sanity(tmp, k)
        if why: return n, "skipped:" + why, c
        os.replace(tmp, os.path.join(DEC, tag + ".v2.jsonl")); os.replace(tmp.replace(".v2.jsonl", ".key"), os.path.join(DEC, tag + ".key"))
        return n, "stitched", c
    hkeys = {}
    for n in hnew:
        try: hkeys[n] = server_key(os.path.join(HUMAN, n))
        except Exception: hkeys[n] = None
    made += make_tables(sorted({k for k in hkeys.values() if k}))
    def human(n):
        k = hkeys[n]
        if not k: return n, "skipped:no game socket", None
        tag = n.replace(".jsonl.gz", "").replace(".jsonl", ""); out = os.path.join(HUMAN, tag + ".v2.jsonl")
        ok, err = decode(os.path.join(HUMAN, n), k, out + ".tmp")
        if err < 0 or err > 0.02 * max(1, ok + err): return n, "skipped:decode rx %d/%d" % (ok, ok + max(err, 0)), None
        why, c = sanity(out + ".tmp", k)
        if why: os.remove(out + ".tmp"); return n, "skipped:" + why, c
        open(os.path.join(HUMAN, tag + ".key"), "w").write(k); os.replace(out + ".tmp", out)
        return n, "stitched-world", None
    with ThreadPoolExecutor(A.jobs) as ex: res = list(ex.map(one, new)) + list(ex.map(human, hnew))
    before = phase_stats(json.load(open(WORLD)) if os.path.exists(WORLD) else {}, json.load(open(SPAWNS)) if os.path.exists(SPAWNS) else {})
    with open(LIST, "a") as f:
        for n, s, _ in res: f.write("%s\t%s\n" % (n, s)); st[n] = s
    files = [os.path.join(DEC, tag_of(n) + ".v2.jsonl") for n, s in st.items() if s == "stitched"]
    files = [f for f in files if os.path.exists(f)]
    hfiles = [os.path.join(HUMAN, n.replace(".jsonl.gz", "").replace(".jsonl", "") + ".v2.jsonl") for n, s in st.items() if s == "stitched-world"]
    w = build_world(files + [f for f in hfiles if os.path.exists(f)]); json.dump(w, open(WORLD, "w"))
    sp = build_scan_spawns.build(sorted(files), DECODER); json.dump(sp, open(SPAWNS, "w"))
    # recorded game facts (boss fights, hits, casts, builds, cosmetics, deaths) from every stitched human file and boss-near scan
    try:
        import session_facts
        sfs = session_facts.update([f for f in hfiles if os.path.exists(f)] + sorted(glob.glob(os.path.join(DEC, "*nearboss*.v2.jsonl"))))
        sf_line = session_facts.summary_line(sfs)
        import scan_facts
        sc = scan_facts.update()
        print("scan_facts: %s; %d swing items, %d projectile kinds" % (sc["note"], len(sc["swing"]), len(sc["proj"])))
        import pet_speed
        ps = pet_speed.update()
        print("pet_speed: %d species, all %s" % (len(ps) - 2, {k: ps['all'].get(k) for k in ('run', 'dash', 'dash_samples')}))
    except Exception as e:
        sf_line = "Session facts: failed (%s)." % str(e)[:200]
    after = phase_stats(w, sp)
    passed = [n for n, s, _ in res if s.startswith("stitched")]; skipped = [(n, s[8:]) for n, s, _ in res if not s.startswith("stitched")]
    L = ["", "## %s" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "",
         "New raw scans: %d. Stitched: %d. Skipped: %d. Total stitched now: %d." % (len(new), len(passed), len(skipped), len(files))]
    if made: L.append("Tables made for: %s." % ", ".join(made))
    L += ["", sf_line]
    if skipped:
        L += ["", "Skipped by reason:"]
        for why, k in collections.Counter(w for _, w in skipped).most_common(): L.append("- %s: %d" % (why, k))
    if passed: L += ["", "Stitched: " + ", ".join(tag_of(n) for n in passed)]
    L += ["", "| phase | objects before | after | cells before | after | scans before | after | templates before | after |", "|---|---|---|---|---|---|---|---|---|"]
    for k in sorted(set(before) | set(after), key=int):
        b, a = before.get(k, {"objects": 0, "cells": 0, "scans": 0, "templates": {}}), after.get(k, {"objects": 0, "cells": 0, "scans": 0, "templates": {}})
        L.append("| %s | %d | %d | %d | %d | %d | %d | %d | %d |" % (k, b["objects"], a["objects"], b["cells"], a["cells"], b["scans"], a["scans"], len(b["templates"]), len(a["templates"])))
    L += ["", "Template changes per phase (new [species, type, stage] and the biggest count changes):"]
    for k in sorted(after, key=int):
        bt, at = before.get(k, {}).get("templates", {}), after[k]["templates"]
        add = sorted((t for t in at if t not in bt), key=lambda t: -at[t]); gone = [t for t in bt if t not in at]
        moved = sorted(((t, at[t] - bt[t]) for t in at if t in bt and at[t] != bt[t]), key=lambda x: -abs(x[1]))
        L.append("- phase %s: %d new%s; %d gone; changed %s" % (k, len(add), (" " + ", ".join("%s x%d" % (list(t), at[t]) for t in add[:8])) if add else "",
                 len(gone), ", ".join("%s %+d" % (list(t), d) for t, d in moved[:6]) or "none"))
    open(LOG, "a").write("\n".join(L) + "\n")
    print("\n".join(L))

if __name__ == "__main__":
    main()
