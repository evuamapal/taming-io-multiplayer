# Shared loading + entity tracking for the SP capture analysis.
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
REPO = os.path.dirname(os.path.dirname(HERE))
DEC = os.path.join(REPO, "work", "sp3_decoded.jsonl")
NAMES = json.load(open(os.path.expanduser("~/tio/tio_dev/rnd_ws/decoder/names.json")))

def load_rows():
    if not os.path.exists(DEC):
        import decode
        rows, _ = decode.decode()
        with open(DEC, "w") as o:
            for r in rows: o.write(json.dumps(r, ensure_ascii=False) + "\n")
    return [json.loads(l) for l in open(DEC)]

def dval(v):
    # 1-byte x/y in a move = sign-magnitude delta (bit 7 set = plus, clear = minus); >= 256 = absolute
    return (v & 127) if v & 128 else -v

def defname(d):
    return NAMES[d] if isinstance(d, int) and 0 <= d < len(NAMES) else None

class World:
    """Replays rx messages; ents[id] = dict(x, y, cat, def, name, born, f(last create fields))."""
    def __init__(self):
        self.ents = {}
    def apply(self, m, t):
        a = m.get("_a"); i = m.get("0")
        if a == 79:
            e = {"x": m.get("3"), "y": m.get("4"), "cat": m.get("2"), "def": m.get("13"), "born": t, "f": m}
            e["name"] = defname(m.get("13")) if m.get("2") == 3 else None
            self.ents[i] = e
            return ("create", e)
        if a == 84:
            e = self.ents.get(i)
            if e is None: return None
            for k in ("3", "4"):
                if k in m:
                    v = m[k]; kk = "x" if k == "3" else "y"
                    if v >= 256: e[kk] = v
                    elif e.get(kk) is not None: e[kk] += dval(v)
            return ("move", e)
        if a == 87:
            e = self.ents.pop(i, None)
            return ("remove", e)
        return None

def t0_of(rows):
    return [r for r in rows if r["k"] == "ws_open"][0]["w"]

def ev(rel, i=None, **kw):
    d = {"t": round(rel, 3)}
    if i is not None: d["row"] = i
    d.update(kw); return d
