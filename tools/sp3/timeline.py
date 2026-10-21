#!/usr/bin/env python3
# Action timeline of the SP5 human capture: every client action (tx ops incl. ops inside JSON frames, client JSON)
# in plain words from the client's own code, with the triggering key/mouse event, the server reply in the next
# second, the assets fetched, and server-only events. Offline only.
# Usage: python3 tools/sp3/timeline.py -> mimic/data/sp5_action_timeline.json + .md
import collections, gzip, json, math, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import *
import decode as DECODE

OUTJ = os.path.join(REPO, "mimic", "data", "sp5_action_timeline.json")
OUTM = os.path.join(REPO, "mimic", "data", "sp5_action_timeline.md")
ITEMS = json.load(open(os.path.join(REPO, "mimic", "data", "items.json")))
FMAP = json.load(open(os.path.join(REPO, "mimic", "data", "sp3_fieldmap.json")))
NODE = os.path.expanduser("~/node/bin/node")
HARN = os.path.expanduser("~/tio/tio_dev/direct_scan/node/harness.js")
REPLY_S = 1.0

def item(i): x = ITEMS.get(str(i)); return x["name"] if x else "item%s" % i

# ---------------------------------------------------------------- client tables (inert vm, no network objects)
JS = r"""
const H = require(process.argv[1]); const env = H.load();
H.settle().then(() => {
  const R = o => { const r = {}; for (const k in o) r[H.RMAP[k] || k] = o[k]; return r; };
  const shop = R(env.G("_5268")), out = {shop: {}, skills: {}, creatures: {}};
  for (const c in shop) out.shop[c] = (shop[c] || []).map(x => x ? [x[0], x[1], x[2], x[3]] : null);
  const sk = env.G("_5586");
  for (const k in sk) { const s = R(sk[k]); out.skills[s._219] = [s._400, s._4822, s._8438]; }
  const cr = env.G("_3134");
  for (let i = 0; i < cr.length; i++) if (cr[i]) { const c = R(cr[i]); out.creatures[i] = [c._400, c._300]; }
  require("fs").writeSync(1, JSON.stringify(out) + "\n"); process.exit(0);
});
"""
def client_tables():
    try:
        p = subprocess.run([NODE, "-e", JS, HARN], capture_output=True, text=True, cwd=os.path.dirname(HARN), timeout=300)
        return json.loads(p.stdout.strip().splitlines()[-1])
    except Exception as e:
        print("client tables failed", e); return {"shop": {}, "skills": {}, "creatures": {}}
TAB = client_tables()
HATS = {}
for cat, lst in TAB["shop"].items():
    for x in lst:
        if x and len(lst) >= 60: HATS[x[2]] = (x[1], x[0])
SKILL = {int(k): v for k, v in TAB["skills"].items()}

# ---------------------------------------------------------------- client code meanings (sp5 numbering)
TYPES = {int(k): v for k, v in FMAP["types"].items()}
CLI = {k: v["client"] for k, v in TYPES.items()}
OPS = {  # sp5 base op -> (client name, meaning from the client's send site)
    0: ("_1423", "aim (angle*1000)"), 1: ("_5373", "open shop/cosmetics window (key c or shop button, _5264 when closed)"),
    2: ("_5635", "click a craft/unlock icon in the level-up bar (value = items.json id)"), 3: ("_5321", "close shop window (_5320)"),
    4: ("_12195", "re-key (r ^= value, every 1 s / 100 ms)"), 6: ("_5467", "select hotbar item (value = items.json id)"),
    7: ("_7385", "connect info (_21001: value = _20981 + 29)"), 8: ("_7266", "heartbeat"),
    10: ("_12197", "attack/use (angle code, 0 = release)"), 11: ("_12198", "move key (dir a0 d1 s2 w3 + 256*pressed)"),
    12: ("_5263", "shop EQUIP (value = category + 256*id)"), 14: ("_6442", "challenge reply to rx 70: (59*o) % 29"),
    16: ("_5225", "shop BUY (value = category + 256*id)"), 17: ("_5212", "shop unlock (value id)"), 5: ("_1445", "touch joystick dir"),
    9: ("_1521", "touch release"), 13: ("_12196", "_21015 (value id)"), 15: ("_1555", "touch reset")}
SHOP_CAT = {0: "hats", 1: "wings", 2: "crates"}
PET_S = {0: "ATTACK mode", 1: "DEFENSE mode", 2: "STOP", 3: "TARGET point/creature", 4: "SKILL (pet ultimate)"}
CLAN_TX = {"_12174": "open clan window (request clan list, key r)", "_12175": "create clan (n = name)", "_12172": "close clan window (quit-team-box)",
           "_12169": "accept the pending join request/invite", "_12171": "decline the pending join request/invite", "_12177": "change leader (n = uid)",
           "_12180": "kick member (n = uid)", "_12167": "ask to join clan (n = name)", "_12187": "next-leader (n = uid)",
           "_12186": "hide/show leader (n)", "_12163": "lock/unlock join (n)", "_12155": "lock/unlock team (n)"}
CLAN_RX = {"_12151": "teammate minimap markers", "_12150": "remove member name", "_12152": "add member name", "_12153": "member name list",
           "_12154": "open clan box", "_12158": "you are member", "_12157": "you are leader", "_12159": "member list (o, p)",
           "_12165": "clan list", "_12166": "join request/invitation popup (o name, n, p uid)", "_12162": "removed from clan", "_12168": "own clan info (lo, jo, n, l, x)"}
JTYPE = {68: "JOIN request (encoded name/skin/pet)", 67: "token", 14: "PET COMMAND", 9: "CLAN", 0: "CHAT", 18: "TAME request"}
RX_NAME = {79: "create", 84: "move", 87: "remove", 53: "inventory", 27: "xp total", 64: "leaderboard/minimap", 39: "chat", 59: "pet/own info",
           68: "clan", 19: "camera", 36: "item count", 81: "placed list", 80: "TORNADO minimap marker", 65: "METEORITE minimap marker",
           37: "HUD counter", 32: "biome timer", 44: "event notification", 75: "gift info", 31: "join ack", 58: "biome ambience",
           11: "challenge", 86: "leaderboard key", 66: "owned cosmetics H/W or token T", 6: "death scoreboard", 52: "announcement", 43: "state b"}
BIOME = {0: "plain", 1: "snow", 2: "dark", 3: "desert", 4: "sea", 5: "volcanic"}
COUNTER_N = {0: "player kills", 1: "animal kills", 2: "boss kills", 3: "tames", 4: "bugs caught", 5: "buildings"}
NOTE_O = {0: "ingredient/bug caught", 1: "first tame", 2: "achievement", 3: "potion", 4: "furniture", 5: "trinket"}
ACH = {"0": "A New Adventure (reach age 1)", "26": "Diggy Diggy Hole (1,000 stone)", "29": "The Woodcutter (1,000 wood)", "68": "Voluble (talk a lot)"}
INV_SLOT = {"0": "food", "1": "wood", "2": "stone", "3": "gold", "4": "slot4", "5": "slot5"}

def age_of(xp):
    L = 0
    while 20 * (L + 1) * (L + 2) + 1 <= xp: L += 1
    return L

def build(CAP, DEC_PATH, NOTE=None):
    rows = [json.loads(l) for l in open(DEC_PATH)]
    T0 = t0_of(rows)
    def rel(w): return round(w - T0, 3)
    http = []
    for l in gzip.open(CAP, "rt"):
        f = json.loads(l)
        if f.get("k") == "http_req":
            u = f["url"]; p = u.split("://", 1)[-1]; host, _, path = p.partition("/")
            http.append((float(f["wall"]) - T0, "/" + path.split("?")[0], host.endswith(".io") and host.count(".") <= 1))
    seen_path = set(); http_first = []
    for t, p, own in http:
        if (p.startswith("/img") or p.startswith("/audio")):
            http_first.append((t, p, p not in seen_path)); seen_path.add(p)

    inputs = []
    for r in rows:
        if r["k"] == "input":
            for e in r["ev"]: inputs.append([e[1] / 1000.0 - T0] + e[2:])
    inputs.sort(key=lambda e: e[0])
    chat_open = False
    for e in inputs:
        e.append(False)
        if e[1] == "kd":
            if e[2] == "Enter": chat_open = not chat_open; e[-1] = "enter"
            elif chat_open: e[-1] = "chat"

    # lives: camera with s false = own id
    lives = []
    deaths = []
    for r in rows:
        if r["k"] != "rx": continue
        for m in r.get("m") or []:
            if not isinstance(m, dict): continue
            if m.get("_a") == 19 and not m.get("s") and not any(l["own"] == m["id"] // 256 for l in lives):
                lives.append({"t": rel(r["w"]), "own": m["id"] // 256, "pet": m["id"] // 256 + 1})
            if m.get("_a") == 6: deaths.append(rel(r["w"]))
    def life_at(t):
        cur = lives[0]
        for l in lives:
            if l["t"] <= t + 0.5: cur = l
        return cur

    # ---------------------------------------------------------------- tx decode incl. ops inside JSON frames
    r_key = 0
    tx = []  # (t, row, kind, payload)
    for r in rows:
        if r["k"] == "ws_open": r_key = 0   # each socket starts its own rekey state
        if r["k"] != "tx": continue
        t = rel(r["w"])
        if "ops" in r:
            for b, v in r["ops"]:
                tx.append((t, r["i"], "op", (b, v)))
                if b == 4: r_key ^= v
        elif "json" in r:
            j = r["json"]
            for x in (j if isinstance(j, list) else [j]):
                if isinstance(x, dict): tx.append((t, r["i"], "json", x))
                elif isinstance(x, int):
                    b, v = (x & 255) ^ r_key, x >> 8
                    tx.append((t, r["i"], "op", (b, v, "in_json")))
                    if b == 4: r_key ^= v

    # ---------------------------------------------------------------- rx replay
    W = World()
    rxl = []  # (t, row, msg)
    inv = {}; xp = None
    inv_ev = []; xp_ev = []
    hp = {}
    REMOVED = {}
    for r in rows:
        if r["k"] != "rx": continue
        t = rel(r["w"])
        for m in r.get("m") or []:
            if not isinstance(m, dict): continue
            if m.get("_a") == 87 and m.get("0") in W.ents: REMOVED[(r["i"], m["0"])] = W.ents[m["0"]]
            W.apply(m, t)
            if m.get("_a") == 79 and m.get("0") in W.ents: W.ents[m["0"]]["cr"] = m
            rxl.append((t, r["i"], m, W.ents.get(m.get("0"), {}).get("x"), W.ents.get(m.get("0"), {}).get("y")))
            if m.get("_a") == 53:
                d = {}
                full = len(m["i"]) >= 6
                for k, v in m["i"].items():
                    d[k] = v - inv.get(k, 0) if not full else v
                    inv[k] = v
                inv_ev.append((t, r["i"], dict(m["i"]), d, full))
            if m.get("_a") == 27:
                xp_ev.append((t, r["i"], m["i"], m["i"] - (xp or 0))); xp = m["i"]
    rx_t = [x[0] for x in rxl]
    import bisect
    def rx_window(t, dt=REPLY_S):
        a = bisect.bisect_right(rx_t, t - 0.001); b = bisect.bisect_right(rx_t, t + dt)
        return rxl[a:b]

    STAGE = {0: "baby", 1: "medium", 2: "adult", 3: "boss/giant"}
    def spec(cr):
        n = TAB["creatures"].get(str(cr.get("21")), [None, "species %s" % cr.get("21")])[1]
        return "%s (21=%s, stage 23=%s %s)" % (n, cr.get("21"), cr.get("23"), STAGE.get(cr.get("23"), ""))
    def ent_name(e):
        if not e: return None
        c = e.get("cat")
        if c == 3: return e.get("name")
        cr = e.get("cr") or {}
        if c == 0: return spec(cr)
        if c == 1: return "player %s" % (cr.get("18") or "")
        return "cat%s" % c

    def summarize_reply(t, life, extra_ids=()):
        own, pet = life["own"], life["pet"]
        ids = {own, pet} | set(extra_ids)
        out = []
        for tt, row, m, x, y in rx_window(t):
            a = m.get("_a"); i = m.get("0")
            dt = round(tt - t, 2)
            if a == 84 and i in ids:
                d = {k: v for k, v in m.items() if k not in ("0", "1", "3", "4", "5", "_a", "_c")}
                if i == own and set(d) <= {"7", "15"}: continue
                if i == pet and set(d) <= {"7", "9", "10", "11"}: continue
                if d: out.append("+%.2f own%s %s" % (dt, "" if i == own else (" pet" if i == pet else " ent %d" % i), json.dumps(d)))
            elif a == 79 and (i in ids or m.get("10") in ids or m.get("11") in ids or m.get("13") in ids):
                d = {k: v for k, v in m.items() if k not in ("0", "1", "_a")}
                what = "effect kind %s (skill %s)" % (m.get("7"), SKILL.get(m.get("7"), ["?"])[0]) if m.get("2") == 4 else ("create %s" % (defname(m.get("13")) if m.get("2") == 3 else "cat%s" % m.get("2")))
                out.append("+%.2f %s id %d %s" % (dt, what, i, json.dumps(d)))
            elif a == 79 and m.get("2") == 3 and m.get("11") == 1 and life.get("x") is not None:
                out.append("+%.2f placed %s id %d" % (dt, defname(m.get("13")), i))
            elif a == 87 and i in ids:
                out.append("+%.2f remove %d" % (dt, i))
            elif a == 53:
                d = {INV_SLOT.get(k, k): v for k, v in m["i"].items()}
                out.append("+%.2f inventory %s" % (dt, json.dumps(d)))
            elif a == 27:
                out.append("+%.2f xp total %d" % (dt, m["i"]))
            elif a == 36:
                out.append("+%.2f item_count %s" % (dt, ", ".join("%s=%d" % (item(b >> 8), b & 255) for b in m["B"])))
            elif a == 81:
                out.append("+%.2f placed_list %s" % (dt, json.dumps(m.get("o"))[:160]))
            elif a in (59, 68, 37, 44, 75, 66, 6, 52, 11, 31, 58, 86):
                if (a == 68 and m.get("m") == 36) or (a == 59 and "i" not in m): continue
                mm = {k: v for k, v in m.items() if k not in ("1", "_a")}
                if a == 68:
                    mm["m"] = "%s %s" % (m.get("m"), CLAN_RX.get(CLI.get(m.get("m")), CLI.get(m.get("m"))))
                out.append("+%.2f %s %s" % (dt, RX_NAME.get(a, a), json.dumps(mm, ensure_ascii=True)[:200]))
            elif a == 39 and m.get("i") == own:
                out.append("+%.2f chat echo %s" % (dt, json.dumps(m.get("m"), ensure_ascii=True)))
        return out

    def cause(t, kinds=("kd", "md"), win=0.6):
        a = bisect.bisect_right(INP_T, t + 0.05)
        for e in reversed(inputs[max(0, a - 80):a]):
            if t - e[0] > win: break
            if e[1] in kinds and e[-1] != "chat":
                if e[1] == "kd": return "key %s" % e[2], round(e[0] - t, 3)
                return "mouse%s down at (%s,%s)" % (e[2], e[3], e[4]), round(e[0] - t, 3)
        return None, None
    INP_T = [e[0] for e in inputs]

    def assets(t, win=1.5):
        out = []
        for tt, p, first in http_first:
            if t - 0.05 <= tt <= t + win:
                if p.startswith("/audio") or first: out.append("%s%s" % (p, "" if first else " (again)"))
        return out

    # ---------------------------------------------------------------- events
    events = []
    def add(t, row, src, what, detail=None, **kw):
        life = life_at(t)
        e = {"t": round(t, 2), "row": row, "src": src, "what": what}
        if detail: e["detail"] = detail
        e.update(kw)
        events.append(e); return e

    STREAM = {0, 4, 8, 10, 11}
    rx11 = [(tt, m.get("o")) for tt, row, m, x, y in rxl if m.get("_a") == 11]
    for t, row, kind, p in tx:
        life = life_at(t)
        if kind == "op":
            b, v = p[0], p[1]; injson = len(p) > 2
            if b in STREAM or injson: continue
            name, mean = OPS.get(b, ("?", "unknown op"))
            if b == 6: what = "SELECT %s (op 6 = %d)" % (item(v), v)
            elif b == 2: what = "CRAFT/UNLOCK pick %s (op 2 = %d)" % (item(v), v)
            elif b == 1: what = "OPEN SHOP window (op 1 = 0)"
            elif b == 3: what = "CLOSE SHOP window (op 3 = 0)"
            elif b in (16, 12):
                cat, hid = v & 255, v >> 8
                hn = HATS.get(hid, ("hat %d" % hid, None))
                what = "%s %s %s (%s, price %s) (op %d = %d)" % ("BUY" if b == 16 else "EQUIP", SHOP_CAT.get(cat, cat), hid, hn[0], hn[1], b, v)
            elif b == 14:
                src = [o for tt, o in rx11 if tt <= t + 0.01][-1:]
                what = "CHALLENGE reply %d = (59*%s)%%29 (op 14)" % (v, src[0] if src else "?")
            elif b == 7: what = "CONNECT info (op 7 = %d)" % v
            elif b == 11: what = "release all keys (op 11 = 5, sent inside a chat JSON frame)"
            else: what = "op %d = %d (%s)" % (b, v, mean)
            c, cdt = cause(t)
            add(t, row, "tx", what, client=name, meaning=mean, input=c, input_dt=cdt, reply=summarize_reply(t, life), assets=assets(t), in_json=injson or None)
        else:
            jt = p.get("type")
            if jt == 68: what = "JOIN / PLAY (json 68, c = %d chars)" % len(p.get("c", ""))
            elif jt == 67: what = "TOKEN (json 67 dg %s)" % p.get("dg")
            elif jt == 14:
                pid = p.get("I"); s = p.get("S")
                who = "own pet" if pid == life["pet"] else "pet id %s" % pid
                what = "PET %s (%s): S=%s %s%s" % (PET_S.get(s, s), who, s, "" if "A" not in p else " aim A,B=%s,%s" % (p.get("A"), p.get("B")),
                                                  "" if "_" not in p else " point %s target %s" % (p.get("_"), p.get("T")))
            elif jt == 9:
                cn = CLI.get(p.get("o"))
                what = "CLAN %s (json 9 o=%s%s)" % (CLAN_TX.get(cn, cn), p.get("o"), "" if "n" not in p else " n=%s" % json.dumps(p["n"]))
            elif jt == 0:
                emb = [x for x in tx if x[1] == row and x[2] == "op"]
                what = "CHAT %s: %s%s" % ("clan" if p.get("tm") == 1 else "all", json.dumps(p.get("msg"), ensure_ascii=True),
                                          "" if not emb else " (same frame ops: %s)" % ", ".join("%d=%d" % (x[3][0], x[3][1]) for x in emb))
            elif jt == 18: what = "TAME request target id %s (json 18)" % p.get("_")
            else: what = "json %s %s" % (jt, json.dumps(p)[:120])
            c, cdt = cause(t, ("kd", "md"), 0.8)
            extra = [p.get("_")] if jt == 18 else ([p.get("I")] if jt == 14 else [])
            add(t, row, "tx", what, client="json " + (CLI.get(jt) or "?"), input=c, input_dt=cdt, reply=summarize_reply(t, life, extra), assets=assets(t))

    # server-only events
    OWN_STRUCT = set()
    for tt, row, m, x, y in rxl:
        if m.get("_a") == 81:
            for o in m.get("o") or []:
                if len(o) > 1: OWN_STRUCT.add(o[0])
    prev_age = None; pa_by_life = {}
    for tt, row, m, x, y in rxl:
        a = m.get("_a"); life = life_at(tt)
        if a == 32: add(tt, row, "rx", "BIOME -> %s (%s ms)" % (BIOME.get(m.get("b"), m.get("b")), m.get("d")))
        elif a == 52: add(tt, row, "rx", "ANNOUNCEMENT %s" % json.dumps(m.get("m"), ensure_ascii=True), detail=m)
        elif a == 80: add(tt, row, "rx", "TORNADO minimap marker at (%s, %s)" % (m.get("o"), m.get("j")))
        elif a == 65: add(tt, row, "rx", "METEORITE minimap marker at (%s, %s)" % (m.get("o"), m.get("j")))
        elif a == 75: add(tt, row, "rx", "GIFT info gi=%s i=%s" % (m.get("gi"), m.get("i")))
        elif a == 37: add(tt, row, "rx", "HUD counter %s (n=%s) = %s" % (COUNTER_N.get(m.get("n"), "?"), m.get("n"), m.get("o")))
        elif a == 44:
            o, n = m.get("o"), m.get("n")
            if o == 1: d = "You tamed your first %s" % TAB["creatures"].get(str(n), [None, n])[1]
            elif o == 2: d = "Achievement unlocked: %s" % ACH.get(str(n), "id %s" % n)
            else: d = "%s n=%s i=%s" % (NOTE_O.get(o, o), n, m.get("i"))
            add(tt, row, "rx", "NOTIFICATION (o=%s n=%s) %s" % (o, n, d))
        elif a == 6: add(tt, row, "rx", "DEATH scoreboard", detail=m.get("o"))
        elif a == 66: add(tt, row, "rx", "owned cosmetics H=%s W=%s" % (m.get("H"), m.get("W")) if "H" in m else "restore token T")
        elif a == 11: add(tt, row, "rx", "CHALLENGE o=%s" % m.get("o"))
        elif a == 58: add(tt, row, "rx", "biome ambience o=%s" % m.get("o"))
        elif a == 86: add(tt, row, "rx", "leaderboard key o=%s" % m.get("o"))
        elif a == 31: add(tt, row, "rx", "join ack (o=%s)" % m.get("o"))
        elif a == 59 and m.get("i") is not None:
            i = m["i"]; who = "own pet" if i == life["pet"] else "pet %d" % i
            if "a" in m: add(tt, row, "rx", "%s GROWS to stage %s (%s)" % (who, m["a"], {1: "medium", 2: "adult"}.get(m["a"], "?")), detail=m)
            elif "d" in m: add(tt, row, "rx", "%s DIED (pet bar)" % who, detail=m)
            elif "n" in m: add(tt, row, "rx", "%s added to pet bar n=%s age=%s" % (who, m.get("n"), m.get("ag")), detail=m)
            elif "na" in m: add(tt, row, "rx", "%s renamed %s" % (who, m.get("na")))
            elif i == 0: add(tt, row, "rx", "tame cooldown reset (i=0)")
            else: add(tt, row, "rx", "pet info %s" % json.dumps(m))
        elif a == 81:
            for o in m.get("o") or []:
                if len(o) > 1: add(tt, row, "rx", "OWN STRUCTURE placed: %s id %d (count %s)" % (o[3], o[0], m.get("p")))
                else: add(tt, row, "rx", "OWN STRUCTURE gone: id %d" % o[0])
        elif a == 19 and m.get("s") and False: pass
        elif a in (84, 79) and m.get("0") == life["pet"]:
            if "15" in m and "14" in m: add(tt, row, "rx", "own pet xp +%s (total %s)" % (m["14"], m["15"]))
        elif a == 79 and m.get("2") == 4 and m.get("7") is not None and (m.get("10") in (life["own"], life["pet"]) or m.get("10") in OWN_STRUCT):
            src = "own pet" if m["10"] == life["pet"] else ("self" if m["10"] == life["own"] else "own structure %d" % m["10"])
            add(tt, row, "rx", "effect kind %s (%s) from %s" % (m["7"], SKILL.get(m["7"], ["?"])[0] if m["7"] < 200 else "eat effect", src))
    for t, row, full, d, isfull in inv_ev:
        if isfull: add(t, row, "rx", "INVENTORY full reset %s" % json.dumps({INV_SLOT.get(k, k): v for k, v in full.items()})); continue
        big = {INV_SLOT.get(k, k): v for k, v in d.items() if (k == "3" and abs(v) >= 50) or abs(v) >= 200}
        if big:
            life = life_at(t)
            gone = []
            for tt, rr, m, x, y in rx_window(t - 1.5, 3.0):
                if m.get("_a") == 87:
                    e = REMOVED.get((rr, m.get("0")))
                    if e and e.get("cat") == 0: gone.append(spec(e.get("cr") or {}) + " id %d" % m["0"])
            add(t, row, "rx", "INVENTORY jump %s (now %s)%s" % (json.dumps(big), json.dumps({INV_SLOT.get(k, k): v for k, v in full.items()}), "" if not gone else "; removed nearby: " + ", ".join(gone[:4])))

    # age ups from xp totals
    pa = None
    for t, row, tot, d in xp_ev:
        a = age_of(tot)
        if pa is not None and a > pa: add(t, row, "rx", "OWN AGE UP %d -> %d (xp %d)" % (pa, a, tot))
        pa = a
    # spectate spans
    spec = [tt for tt, row, m, x, y in rxl if m.get("_a") == 19 and m.get("s")]

    events.sort(key=lambda e: (e["t"], e["row"]))

    # ---------------------------------------------------------------- per-minute stream summary
    mins = collections.defaultdict(lambda: collections.Counter())
    for t, row, kind, p in tx:
        mi = int(t // 60)
        if kind == "op":
            b, v = p[0], p[1]
            if b == 11: mins[mi]["key_%s_%s" % ("adsw"[v & 255] if (v & 255) < 4 else "all", "down" if v >> 8 else "up")] += 1
            elif b == 10: mins[mi]["attack_press" if v else "attack_release"] += 1
            elif b == 0: mins[mi]["aim"] += 1
            elif b == 8: mins[mi]["heartbeat"] += 1
            elif b == 4: mins[mi]["rekey"] += 1
    own_by_life = {l["own"] for l in lives}
    for tt, row, m, x, y in rxl:
        mi = int(tt // 60)
        if m.get("0") in own_by_life and m.get("_a") in (84, 79):
            if "15" in m: mins[mi]["own_swing_anim"] += 1
            if "10" in m: mins[mi]["own_damage_taken"] += m["10"]
            if "11" in m: mins[mi]["own_heal"] += m["11"]
        a = m.get("_a")
        mins[mi]["rx_%s" % RX_NAME.get(a, a)] += 1
    for t, row, full, d, isfull in inv_ev:
        if isfull: continue
        for k, v in d.items():
            mins[int(t // 60)]["inv_%s_%s" % (INV_SLOT.get(k, k), "gain" if v > 0 else "spend")] += v
    for t, row, tot, d in xp_ev:
        if d > 0 and d < 100000: mins[int(t // 60)]["xp_gain"] += d
    for e in inputs:
        mi = int(e[0] // 60)
        if e[1] == "kd": mins[mi]["chat_typing_keys" if e[-1] == "chat" else "game_keydown"] += 1
        elif e[1] == "md": mins[mi]["mouse_down"] += 1
        elif e[1] == "mm": mins[mi]["mouse_move"] += 1
    for t, p, first in http_first:
        mins[int(t // 60)]["asset_fetch"] += 1

    # key -> effect table (data grounded): what tx follows a game key within 300 ms
    keyfx = collections.defaultdict(collections.Counter)
    tx_t = [x[0] for x in tx]
    for e in inputs:
        if e[1] != "kd" or e[-1] == "chat" or e[4]: continue
        a = bisect.bisect_left(tx_t, e[0] - 0.02); b = bisect.bisect_right(tx_t, e[0] + 0.3)
        got = set()
        for t, row, kind, p in tx[a:b]:
            if kind == "op" and p[0] not in (0, 4, 8): got.add("op%d" % p[0] + ("=%s" % item(p[1]) if p[0] == 6 else ""))
            elif kind == "json": got.add("json%s%s" % (p.get("type"), "/S%s" % p.get("S") if p.get("type") == 14 else ("/o%s" % p.get("o") if p.get("type") == 9 else "")))
        keyfx[e[2]].update(got or {"(no tx)"})
        keyfx[e[2]]["_presses"] += 1

    # clock check: walking key down -> op 11 press
    dts = []
    for e in inputs:
        if e[1] == "kd" and e[2] in ("KeyW", "KeyA", "KeyS", "KeyD") and e[-1] != "chat" and not e[4]:
            a = bisect.bisect_left(tx_t, e[0] - 0.5); b = bisect.bisect_right(tx_t, e[0] + 0.5)
            c = [t - e[0] for t, row, kind, p in tx[a:b] if kind == "op" and p[0] == 11 and p[1] >> 8 == 1]
            if c: dts.append(min(c, key=abs))
    dts.sort()
    clock = {"n": len(dts), "median_tx_minus_key_s": round(dts[len(dts) // 2], 3) if dts else None}

    # spans of repetitive streams
    spans = []
    def span_of(pred, label):
        cur = None
        for t, row, kind, p in tx:
            if kind == "op" and pred(p):
                if cur and t - cur[1] < 5: cur[1] = t; cur[2] += 1
                else:
                    if cur: spans.append({"t0": round(cur[0], 2), "t1": round(cur[1], 2), "n": cur[2], "what": label})
                    cur = [t, t, 1]
        if cur: spans.append({"t0": round(cur[0], 2), "t1": round(cur[1], 2), "n": cur[2], "what": label})
    span_of(lambda p: p[0] == 11, "walking (op 11 key presses/releases)")
    span_of(lambda p: p[0] == 10 and p[1] != 0, "attack/use presses (op 10)")
    spans.sort(key=lambda s: s["t0"])

    # ---------------------------------------------------------------- write
    sockets = [{"t": rel(r["w"]), "row": r["i"]} for r in rows if r["k"] == "ws_open"]
    dead_spans = []
    for dt0 in deaths:
        nxt = [l["t"] for l in lives if l["t"] > dt0]
        dt1 = nxt[0] if nxt else rel(rows[-1]["w"])
        rc = collections.Counter(RX_NAME.get(m.get("_a"), m.get("_a")) for tt, row, m, x, y in rxl if dt0 < tt < dt1)
        tc = collections.Counter(("op%d" % p[0]) if kind == "op" else "json%s" % p.get("type") for t, row, kind, p in tx if dt0 < t < dt1)
        cam = [tt for tt, row, m, x, y in rxl if dt0 < tt < dt1 and m.get("_a") == 19 and m.get("s")]
        gaps = sorted(b - a for a, b in zip(cam, cam[1:]))
        dead_spans.append({"t0": dt0, "t1": dt1, "respawn": bool(nxt), "rx": dict(rc.most_common()), "tx": dict(tc.most_common()), "camera_period_s": round(gaps[len(gaps) // 2], 2) if gaps else None})
    doc = {"capture": os.path.basename(CAP), "sockets": sockets, "dead_spans": dead_spans, "decoded": os.path.relpath(DEC_PATH, REPO), "note": NOTE, "server": "Saopaulo#5", "time_base": "t = s since ws_open; row = capture line",
           "lives": lives, "deaths_t": deaths, "clock_check": clock, "client_tables": {"hats": {k: v for k, v in HATS.items()}, "skills": SKILL},
           "op_meanings": {str(k): v for k, v in OPS.items()}, "pet_commands": PET_S, "clan_tx": CLAN_TX, "clan_rx": CLAN_RX,
           "key_effects": {k: dict(v) for k, v in keyfx.items()}, "events": events, "spans": spans,
           "minutes": {str(k): dict(v) for k, v in sorted(mins.items())},
           "assets_first_fetch": [(round(t, 2), p) for t, p, first in http_first if first]}

    L = []
    L.append("## Capture %s\n" % os.path.basename(CAP))
    L.append("%s Decoded %s. t = seconds since this capture's first ws_open; row = capture line. Ops use sp5 numbering, meanings from the client send sites (client names in the JSON).\n" % (NOTE or "", os.path.relpath(DEC_PATH, REPO)))
    L.append("Sockets (ws_open): " + "; ".join("t %.1f row %d" % (s_["t"], s_["row"]) for s_ in sockets) + ".\n")
    for dsp in dead_spans:
        L.append("Dead span t %.1f-%.1f (%.1f min, %s): rx while dead %s; tx while dead %s; camera (type 19 s:true) period median %.2f s.\n" % (
            dsp["t0"], dsp["t1"], (dsp["t1"] - dsp["t0"]) / 60, "ended by respawn" if dsp["respawn"] else "no respawn until the capture ended",
            json.dumps(dsp["rx"]), json.dumps(dsp["tx"]), dsp["camera_period_s"] or 0))
    L.append("Lives: " + "; ".join("t %.1f own %d pet %d" % (l["t"], l["own"], l["pet"]) for l in lives) + ". Deaths at t " + ", ".join("%.1f" % d for d in deaths) + ". Input clock check: op 11 press - key down median %s s (n %d).\n" % (clock["median_tx_minus_key_s"], clock["n"]))
    L.append("\n## Key -> effect (game keys outside chat, tx within 300 ms)\n")
    for k, c in sorted(keyfx.items(), key=lambda kv: -kv[1]["_presses"]):
        if c["_presses"] < 2 and len(c) <= 2: continue
        L.append("- %s x%d: %s" % (k, c["_presses"], ", ".join("%s %d" % (a, b) for a, b in c.most_common(6) if a != "_presses")))
    L.append("\n## Timeline, minute by minute\n")
    ev_by_min = collections.defaultdict(list)
    for e in events: ev_by_min[int(e["t"] // 60)].append(e)
    sp_by_min = collections.defaultdict(list)
    for s in spans: sp_by_min[int(s["t0"] // 60)].append(s)
    for mi in sorted(set(mins) | set(ev_by_min)):
        if mi < 0: continue
        c = mins.get(mi, {})
        L.append("### minute %d (t %d-%d)\n" % (mi, mi * 60, mi * 60 + 60))
        keys = sum(v for k, v in c.items() if k.startswith("key_"))
        L.append("Streams: keys %d, aim %d, attack press %d / release %d, heartbeat %d, rekey %d, own swing anims %d, damage taken %d, heal %d, xp +%d; inventory %s; chat typing keys %d, game keydowns %d, mouse downs %d, assets %d.\n" % (
            keys, c.get("aim", 0), c.get("attack_press", 0), c.get("attack_release", 0), c.get("heartbeat", 0), c.get("rekey", 0), c.get("own_swing_anim", 0),
            c.get("own_damage_taken", 0), c.get("own_heal", 0), c.get("xp_gain", 0),
            ", ".join("%s %+d" % (k[4:], v) for k, v in sorted(c.items()) if k.startswith("inv_")) or "-",
            c.get("chat_typing_keys", 0), c.get("game_keydown", 0), c.get("mouse_down", 0), c.get("asset_fetch", 0)))
        for s in sp_by_min.get(mi, []):
            if s["n"] >= 4: L.append("- span t %.1f-%.1f: %s x%d" % (s["t0"], s["t1"], s["what"], s["n"]))
        for e in ev_by_min.get(mi, []):
            line = "- **t %.2f** row %d [%s] %s" % (e["t"], e["row"], e["src"], e["what"])
            if e.get("input"): line += " | input: %s (%+.2f s)" % (e["input"], e["input_dt"])
            if e.get("assets"): line += " | assets: %s" % ", ".join(e["assets"][:6])
            L.append(line)
            for rr in (e.get("reply") or [])[:8]: L.append("    - reply %s" % rr)
        L.append("")
    return doc, L, len(events), len(spans)

# ---------------------------------------------------------------- captures (oldest first; t restarts at each capture's first ws_open)
CAPS = [
    (DECODE.CAP, DEC, "46 min human play. Leads quoted elsewhere used a clock about 9 s later (tame json 18 = t 2528.31 here)."),
    (os.path.expanduser("~/tio/tio_dev/rnd_ws/captures/20261017_162036_human.jsonl.gz"), os.path.join(REPO, "work", "sp3_decoded_162036.jsonl"),
     "120 min. Two menu sockets (menu background spectate), join at t 23.7, death at t 122.3, then about 118 min on the death screen without respawn: the client kept the camera on the death spot, his auto-walk keys produced no tx (dead), the server kept streaming that view through two full biome cycles."),
]
docs, LL, ne, ns = [], [], 0, 0
for cap, dec, note in CAPS:
    if not os.path.exists(dec):
        rows_, _ = DECODE.decode(cap)
        with open(dec, "w") as o:
            for r in rows_: o.write(json.dumps(r, ensure_ascii=False) + "\n")
    d, L, a, b = build(cap, dec, note)
    docs.append(d); LL += L + [""]; ne += a; ns += b
json.dump({"captures": docs, "note": "one entry per capture, oldest first; times are per capture (t = s since that capture's first ws_open)"}, open(OUTJ, "w"), indent=1, ensure_ascii=True)
open(OUTM, "w").write("# SP5 action timelines (Saopaulo#5 human captures)\n\nGenerated by tools/sp3/timeline.py: one section per capture, from its decode (tools/sp3/decode.py) + the raw capture (HTTP, input).\n\n" + "\n".join(LL) + "\n")
print("wrote", OUTJ, OUTM, ne, "events", ns, "spans", len(docs), "captures")
