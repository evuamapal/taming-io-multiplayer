#!/usr/bin/env python3
# Decode the SP human capture into one time-ordered JSONL (work/sp3_decoded.jsonl): rx/tx frames with
# sp3 type ids plus their Atlanta#4 equivalents, snapshots and input events. Offline only.
# Usage: decode.py [CAPTURE] [--out work/sp3_decoded.jsonl]
import argparse, base64, collections, gzip, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tio_proto as T
REPO = os.path.dirname(os.path.dirname(HERE))
CAP = os.path.expanduser("~/tio/tio_dev/rnd_ws/captures/20261017_114839_human.jsonl.gz")

def load_map(path=os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json")):
    m = json.load(open(path))
    return m, {int(k): v for k, v in m["field_codes"].items()}

def decode(cap=CAP):
    M, FC = load_map()
    TY = {int(k): v for k, v in M["types"].items()}
    OPS = {int(k): v for k, v in M["ops"].items()}
    rekey = [k for k, v in OPS.items() if v["atl4"] == 16][0]
    move_t = [k for k, v in TY.items() if v["atl4"] == 84][0]
    st, ts, r = T.RxStream(), 0, 0
    rows, stat = [], collections.Counter()
    for idx, l in enumerate(gzip.open(cap, "rt")):
        f = json.loads(l)
        k = f.get("k")
        row = {"i": idx, "k": k, "w": float(f.get("wall") or 0)}
        if k == "rx":
            b = base64.b64decode(f["b64"])
            try:
                msgs = []
                for rec in T.parse_frame(st.unxor(b)):
                    if rec["kind"] == "c0":
                        m = {"0": rec["id"], "1": move_t, "_c": rec["case"]}
                        for kk in ("3", "4"):
                            if kk in rec: m[kk] = rec[kk]
                        if "A" in rec: m["5"] = rec["A"]
                        if rec.get("trunc"): m["_trunc"] = 1
                    elif rec["kind"] == "f":
                        m = {}
                        for c, v in rec["codes"].items():
                            if c not in FC: raise ValueError("unknown code %d" % c)
                            m[FC[c]] = v
                    else:
                        m = rec.get("msg")
                        if m is None: raise ValueError(rec.get("err") or "bad item")
                        if isinstance(m, dict) and "__mp_err" in m: raise ValueError(m["__mp_err"])
                    if isinstance(m, dict) and isinstance(m.get("1"), int):
                        m["_a"] = TY.get(m["1"], {}).get("atl4")
                    msgs.append(m)
                row["m"] = msgs; stat["rx_ok"] += 1
            except Exception as e:
                row["err"] = str(e)[:120]; stat["rx_err"] += 1
            row["ts"] = float(f["ts"])
        elif k == "tx":
            b = base64.b64decode(f["b64"])
            row["ts"] = float(f["ts"])
            if str(f.get("op")) == "1":
                try: row["json"] = json.loads(b.decode("utf-8")); stat["tx_ok"] += 1
                except Exception as e: row["err"] = str(e)[:120]; stat["tx_err"] += 1
            else:
                p, ts = T.tx_unxor(b, ts)
                nums = T.tx_numbers(p)
                if nums is None:
                    row["err"] = "tx parse"; stat["tx_err"] += 1
                else:
                    ops = []
                    for x in nums:
                        base, val = (x & 255) ^ r, x >> 8
                        ops.append([base, val])
                        if base == rekey: r ^= val
                    row["ops"] = ops; stat["tx_ok"] += 1
        elif k == "snapshot":
            row["ents"] = f["ents"]
        elif k == "input":
            row["ev"] = f["ev"]
        elif k == "ws_open":
            row["url"] = f["url"]
            st, ts, r = T.RxStream(), 0, 0   # each socket starts its own rx/tx xor streams and rekey state
        else:
            continue
        rows.append(row)
    return rows, stat

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cap", nargs="?", default=CAP)
    ap.add_argument("--out", default=os.path.join(REPO, "work", "sp3_decoded.jsonl"))
    A = ap.parse_args()
    rows, stat = decode(A.cap)
    with open(A.out, "w") as o:
        for r in rows: o.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(dict(stat))
    c = collections.Counter()
    for r in rows:
        for m in r.get("m") or []:
            if isinstance(m, dict): c[("rx", m.get("1"), m.get("_a"))] += 1
        for b, v in r.get("ops") or []: c[("tx", b)] += 1
        if "json" in r: c[("txjson", r["json"].get("type") if isinstance(r["json"], dict) else "list")] += 1
    for k, v in sorted(c.items(), key=lambda kv: -kv[1]): print(k, v)
