#!/usr/bin/env python3
# taming game WebSocket codec, ported from the client (NnukiuqQ.js, Oct 17 2026 build).
#   rx (server->client): even-index bytes XOR an LCG keystream s=(s*109+181)%241, seed 5 at socket open,
#        continuous across frames. Then the frame is a sequence of records:
#        h=b[i++]; t=h&3; L=(h&252)>>2
#        t==0 -> compact entity record, fixed layout (see compact0), record length L
#        t==1 -> field list, length L;  t==2 -> field list, length = (h==6 ? u16le : u8)
#        t==3 -> h>=8: msgpack, length (h==19 ? u16le : u8);  h<8: JSON utf-8, length (h==7 ? u16le : u8)
#   tx (client->server): binary = list of numbers, each [nbytes][little-endian bytes], every byte XOR
#        (1 + s%254) with s=(s*8121+28411)%134456 (seed found by brute force per socket); objects/strings
#        are sent as plain JSON text frames instead (join request, token).
# Field codes and message-type ids are shuffled per server by the client (wasm-seeded); this file decodes
# structure + raw codes; decoder/fieldmap.json (learned from the client tap) names them.
import base64, json, struct, sys

RX_A, RX_C, RX_M, RX_SEED = 109, 181, 241, 5
TX_A, TX_C, TX_M = 8121, 28411, 134456

class RxStream:
    def __init__(self, seed=RX_SEED):
        self.s = seed
    def unxor(self, b):
        b = bytearray(b); s = self.s
        for i in range(0, len(b), 2):
            b[i] ^= s; s = (s * RX_A + RX_C) % RX_M
        self.s = s
        return bytes(b)

def tx_unxor(b, s):
    out = bytearray(len(b))
    for i, x in enumerate(b):
        out[i] = x ^ (1 + (s % 254)); s = (s * TX_A + TX_C) % TX_M
    return bytes(out), s

def tx_numbers(p):
    nums, i = [], 0
    while i < len(p):
        n = p[i]; i += 1
        if n > 8 or i + n > len(p):
            return None
        v = 0
        for k in range(n):
            v += p[i + k] * (256 ** k)
        nums.append(v); i += n
    return nums

def tx_find_seed(frames, max_check=6):
    # smallest consistent seed: every binary frame must parse as a number list
    bins = [f for f in frames if f is not None][:max_check]
    for s0 in range(TX_M):
        s, ok = s0, True
        for f in bins:
            p, s = tx_unxor(f, s)
            if tx_numbers(p) is None:
                ok = False; break
        if ok:
            return s0
    return None

# ---- minimal msgpack ----
def mp(b, i=0):
    c = b[i]; i += 1
    if c <= 0x7f: return c, i
    if c >= 0xe0: return c - 256, i
    if 0x80 <= c <= 0x8f: return mp_map(b, i, c & 15)
    if 0x90 <= c <= 0x9f: return mp_arr(b, i, c & 15)
    if 0xa0 <= c <= 0xbf: n = c & 31; return b[i:i + n].decode("utf-8", "replace"), i + n
    if c == 0xc0: return None, i
    if c == 0xc2: return False, i
    if c == 0xc3: return True, i
    if c in (0xc4, 0xc5, 0xc6):
        n, i = mp_len(b, i, {0xc4: 1, 0xc5: 2, 0xc6: 4}[c]); return {"__bin": b[i:i + n].hex()}, i + n
    if c == 0xca: return struct.unpack(">f", b[i:i + 4])[0], i + 4
    if c == 0xcb: return struct.unpack(">d", b[i:i + 8])[0], i + 8
    if c in (0xcc, 0xcd, 0xce, 0xcf):
        n = {0xcc: 1, 0xcd: 2, 0xce: 4, 0xcf: 8}[c]; return int.from_bytes(b[i:i + n], "big"), i + n
    if c in (0xd0, 0xd1, 0xd2, 0xd3):
        n = {0xd0: 1, 0xd1: 2, 0xd2: 4, 0xd3: 8}[c]; return int.from_bytes(b[i:i + n], "big", signed=True), i + n
    if c in (0xd9, 0xda, 0xdb):
        n, i = mp_len(b, i, {0xd9: 1, 0xda: 2, 0xdb: 4}[c]); return b[i:i + n].decode("utf-8", "replace"), i + n
    if c in (0xdc, 0xdd):
        n, i = mp_len(b, i, 2 if c == 0xdc else 4); return mp_arr(b, i, n)
    if c in (0xde, 0xdf):
        n, i = mp_len(b, i, 2 if c == 0xde else 4); return mp_map(b, i, n)
    raise ValueError("msgpack 0x%02x" % c)

def mp_len(b, i, n):
    return int.from_bytes(b[i:i + n], "big"), i + n

def mp_arr(b, i, n):
    out = []
    for _ in range(n):
        v, i = mp(b, i); out.append(v)
    return out, i

def mp_map(b, i, n):
    out = {}
    for _ in range(n):
        k, i = mp(b, i); v, i = mp(b, i); out[str(k)] = v
    return out, i

# ---- record parsers ----
def compact0(b, i):
    # client _14364: [flags|case][id lo][id hi]([id b2][id b3]) then 1..3 small fields by case
    h = b[i]
    nid = 2 if (h & 0x40 and h & 0x80) else (1 if h & 0x40 else 0)
    rid = b[i + 1] + (b[i + 2] << 8)
    if nid >= 1: rid += b[i + 3] << 16
    if nid >= 2: rid += b[i + 4] << 24
    case = h & 0x3f
    o = i + 3 + nid
    def u8(k): return b[o + k]
    def u16(k): return b[o + k] + (b[o + k + 1] << 8)
    rec = {"kind": "c0", "id": rid, "case": case}
    # client switch: bits 2=x u16, 32=x u8, 4=y u16, 1=y u8, 16=angle u8; fields follow in x, y, angle order
    layout = []
    if case & 2: layout.append(("3", 2))
    elif case & 32: layout.append(("3", 1))
    if case & 4: layout.append(("4", 2))
    elif case & 1: layout.append(("4", 1))
    if case & 16: layout.append(("A", 1))
    k = 0
    try:
        for name, w in layout:
            rec[name] = u8(k) if w == 1 else u16(k)
            k += w
    except IndexError:
        rec["trunc"] = True
    return rec

def fields(b, i, n):
    # client _14365: each field = [code*8 + (nbytes-1)][nbytes little-endian]; code -> name via fieldmap
    out, j, end = {}, i, i + n
    first = True
    while j < end:
        f = b[j]
        if first:
            f &= ~8 & 0xff  # client clears bit 3 of the first byte
            first = False
        nb = f % 8 + 1; code = f - f % 8; j += 1
        v = 0
        for k in range(nb):
            v += b[j + k] << (8 * k)
        out[code] = v; j += nb
    return {"kind": "f", "codes": out}

def parse_frame(p):
    recs, i = [], 0
    while i < len(p):
        h = p[i]; i += 1
        t, L = h & 3, (h & 252) >> 2
        if t == 0:
            recs.append(compact0(p, i)); n = L
        elif t == 1:
            n = L; recs.append(fields(p, i, n))
        elif t == 2:
            if h == 6:
                n = p[i] + (p[i + 1] << 8); i += 2
            else:
                n = p[i]; i += 1
            recs.append(fields(p, i, n))
        else:
            if h >= 8:
                if h == 19:
                    n = p[i] + (p[i + 1] << 8); i += 2
                else:
                    n = p[i]; i += 1
                try:
                    v, _ = mp(p[i:i + n])
                except Exception as e:
                    v = {"__mp_err": str(e)}
                recs.append({"kind": "mp", "msg": v})
            else:
                if h == 7:
                    n = p[i] + (p[i + 1] << 8); i += 2
                else:
                    n = p[i]; i += 1
                try:
                    recs.append({"kind": "json", "msg": json.loads(p[i:i + n].decode("utf-8"))})
                except Exception as e:
                    recs.append({"kind": "json", "err": str(e)})
        i += n
    return recs

# ---- encoder (fake server / injection) ----
def rx_xor(b, s):
    # same transform as RxStream.unxor (XOR is symmetric); returns (bytes, new state)
    b = bytearray(b)
    for i in range(0, len(b), 2):
        b[i] ^= s; s = (s * RX_A + RX_C) % RX_M
    return bytes(b), s

def encode_fields(msg, fieldmap):
    # msg {"0": id, "1": type, ...} -> one t==1/t==2 record; fieldmap: code(str) -> key
    inv = {v: int(c) for c, v in fieldmap.items()}
    body = bytearray()
    keys = sorted(msg.keys(), key=lambda k: (k != "0", inv.get(k, 999)))
    for k in keys:
        if k not in inv or not isinstance(msg[k], int) or msg[k] < 0:
            continue
        v = msg[k]; nb = max(1, (v.bit_length() + 7) // 8)
        body.append(inv[k] + (nb - 1))
        body += v.to_bytes(nb, "little")
    n = len(body)
    if n < 64:
        return bytes([(n << 2) | 1]) + bytes(body)
    if n < 256:
        return bytes([2, n]) + bytes(body)
    return bytes([6, n & 255, n >> 8]) + bytes(body)

def keepalive(oid):
    # t==0 compact record, case 0 (no fields): "object still here"
    if oid < 65536:
        body = bytes([0, oid & 255, oid >> 8])
    elif oid < 1 << 24:
        body = bytes([0x40, oid & 255, (oid >> 8) & 255, oid >> 16])
    else:
        body = bytes([0xC0, oid & 255, (oid >> 8) & 255, (oid >> 16) & 255, oid >> 24])
    return bytes([len(body) << 2]) + body
