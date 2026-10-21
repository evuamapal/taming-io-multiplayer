#!/usr/bin/env node
// taming.invalid mimic server: lets the mirrored client run fully offline.
//  - one local HTTP proxy port: CONNECT tunnels are TLS-terminated with the local self-signed cert,
//    every HTTP(S) request is answered from the mirror (else 404), nothing ever connects outward
//  - the game WebSocket is answered by a local game server that speaks the real wire protocol
//    (codec.js) for server "atlanta4": setup, spectate, join, world streaming, walking, HP, gathering
// Usage: node mimic_server.js [--port 8899] [--world world_atl4.json] [--config mimic_config.json]
//        [--bundle game_mimic.js|original] [--log runs/mimic_server.jsonl] [--selftest-outbound]
"use strict";
const NO = require("./hosted/no_outbound");   // first: every outbound API throws
const fs = require("fs"), net = require("net"), tls = require("tls"), http = require("http"),
  path = require("path"), crypto = require("crypto");
const C = require("./codec");

const ARGS = {};
for (let i = 2; i < process.argv.length; i += 2) ARGS[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const D = __dirname, RND = path.dirname(D);
const PORT = +(ARGS.port || 8899);
const MIRROR = ARGS.mirror || path.join(RND, "mirror");
const WORLD = JSON.parse(fs.readFileSync(ARGS.world || path.join(D, "world_atl4.json"), "utf8"));
const CFG_PATH = ARGS.config || path.join(D, "mimic_config.json");
const BUNDLE = ARGS.bundle || path.join(D, "game_mimic.js");
let LOGF = null, LOGGER = null;   // LOGGER: set by an embedding server (hosted_server.js)
NO.setLogger((o) => L(o));
function L(o) {
  o.t = Date.now() / 1000;
  try { if (LOGGER) return LOGGER(o); if (LOGF === null) LOGF = fs.openSync(ARGS.log || path.join(D, "runs", "mimic_server.jsonl"), "a"); fs.writeSync(LOGF, JSON.stringify(o) + "\n"); } catch (e) { }
}

function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); } catch (e) { return {}; } }
let CFG = loadCfg();

// ---------------------------------------------------------------- mirror
const MIR = new Map(), MIR_NOQ = new Map(), MIR_PATH = new Map();
const noq = (u) => { try { const p = new URL(u); return p.protocol + "//" + p.host + p.pathname; } catch (e) { return u; } };
for (const line of fs.readFileSync(path.join(MIRROR, "index.jsonl"), "utf8").split("\n")) {
  if (!line) continue;
  let r; try { r = JSON.parse(line); } catch (e) { continue; }
  MIR.set(r.url, r);
  if (!MIR_NOQ.has(noq(r.url))) MIR_NOQ.set(noq(r.url), r);
  try { const p = new URL(r.url); if (!MIR_PATH.has(p.pathname)) MIR_PATH.set(p.pathname, r); } catch (e) { }
}
function ctype(r) {
  for (const [k, v] of Object.entries(r.headers || {})) if (k.toLowerCase() === "content-type") return v;
  const m = r.mime || "application/octet-stream";
  return m + (/^text\/|javascript|json/.test(m) ? "; charset=UTF-8" : "");
}
function lookup(url) {
  if (/\/js\/NnukiuqQ\.js/.test(url) && BUNDLE !== "original")
    return [{ file: BUNDLE, headers: { "content-type": "application/javascript; charset=UTF-8" } }, "bundle"];
  let r = MIR.get(url), how = "exact";
  if (!r) { r = MIR_NOQ.get(noq(url)); how = "noquery"; }
  if (!r) { try { const p = new URL(url); if (p.hostname.endsWith("taming.invalid")) { r = MIR_PATH.get(p.pathname); how = "path"; } } catch (e) { } }
  return r ? [r, how] : [null, null];
}

// ---------------------------------------------------------------- game constants (atlanta4 mapping)
// server -> client message types for server "atlanta4" (the client derives them from the server name)
const T = { XP: 27, ITEMCOUNT: 36, CREATE: 79, MOVE: 84, REMOVE: 87, OWN: 19, BOARD: 64, MINIMAP: 59, INV: 53, TIMER: 32, DEATH: 6 };
// client -> server base op ids for "atlanta4" (wire op = base ^ K, K ^= value of each ROT op)
const OP = { AIM: 0, ATTACK: 4, KEY: 5, HEARTBEAT: 8, SELECT: 10, ROT: 16 };
const KEYDIR = { 0: [-1, 0], 1: [1, 0], 2: [0, 1], 3: [0, -1] };   // a, d, s, w
const TICK_MS = 125;              // measured: 8 ticks/s in recorded sessions
const SPEED = 46;                 // units per tick at speed factor 10 (measured from recorded players)
const VIEW_X = 1400, VIEW_Y = 1000, HYST = 250;   // render distance box (half sizes)
const PLAYER_R = 35;
const MAP = { x0: 100, y0: 100, x1: 17800, y1: 17800 };
const MINIMAP_DIV = 69.5;         // recorded p = pos / ~69.5

// object radius by def name (collision), approximate from sprite sizes
function radiusOf(name) {
  if (!name) return 0;
  if (/boost-pad|gift|egg|pebble|floor|plot/.test(name)) return 0;
  if (/stone|rock|ore|gold|ruby|amethyst|sapphire|diamond|emerald|amber/.test(name)) return 70;
  if (/tree/.test(name)) return 75;
  if (/bush|plant|flower/.test(name)) return 45;
  if (/wall|door|spike|windmill|totem|log/.test(name)) return 50;
  return 40;
}
function resourceOf(name) {   // inventory slot gained by hitting: 0 food, 1 wood, 2 stone (recorded inventory keys)
  if (!name) return null;
  if (/stone|rock/.test(name)) return 2;
  if (/tree|log/.test(name)) return 1;
  if (/bush|flower|plant/.test(name)) return 0;
  return null;
}

function ageOf(xp) { return Math.min(60, Math.floor((Math.sqrt(1 + 4 * (Math.max(0, xp - 1) * 2 / 40)) - 1) / 2)); }

// ---------------------------------------------------------------- world
let NEXT_ID = 5000000;
function buildWorld() {
  const objs = [];
  for (const o of WORLD.objects) {
    const f = {}; for (const [k, v] of Object.entries(o)) if (/^\d+$/.test(k)) f[k] = v;
    objs.push({ id: o["0"], x: o["3"], y: o["4"], name: o.name, f, r: radiusOf(o.name), synthetic: false });
  }
  for (const s of (CFG.synthetic || [])) {   // config-placed objects: {"name": "...", "x":..., "y":...}
    const idx = WORLD_NAMES.indexOf(s.name);
    if (idx < 0) { L({ k: "synthetic_skip", name: s.name }); continue; }
    const id = NEXT_ID++;
    objs.push({ id, x: s.x, y: s.y, name: s.name, r: s.r != null ? s.r : radiusOf(s.name), synthetic: true,
      f: { "0": id, "1": T.CREATE, "2": 3, "3": s.x, "4": s.y, "5": 628, "6": 1, "13": idx } });
  }
  // wandering animals: recorded creature creates (kind = field 7) re-homed around the spawn
  const tpl = {}; for (const c of (WORLD.creatures || [])) if (!tpl[c["7"]]) tpl[c["7"]] = c;
  const sp = CFG.spawn || { x: 0, y: 0 };
  let k = 0;
  for (const a of (CFG.animals || [{ kind: 2, n: 4 }, { kind: 10, n: 2 }])) {
    const t = tpl[a.kind]; if (!t) continue;
    for (let i = 0; i < a.n; i++, k++) {
      const id = NEXT_ID++, ang = k * 2.4, d = 350 + (k % 3) * 220;
      const hx = Math.round(sp.x + Math.cos(ang) * d), hy = Math.round(sp.y + Math.sin(ang) * d);
      const f = Object.assign({}, t, { "0": id, "3": hx, "4": hy });
      objs.push({ id, x: hx, y: hy, hx, hy, tx: hx, ty: hy, name: null, r: 0, mobile: true, kind: a.kind, f });
    }
  }
  return objs;
}
let ITEMS = {};   // client item defs (data/items.json from items_map.py): id -> {name, cost[slot], heal, limit, cat, place}
try { ITEMS = JSON.parse(fs.readFileSync(path.join(D, "data", "items.json"), "utf8")); } catch (e) { }
const CAT_FOOD = 4, CAT_BUILD = new Set([5, 6, 7, 8]);
let WORLD_NAMES = [];
try { WORLD_NAMES = JSON.parse(fs.readFileSync(path.join(RND, "decoder", "names.json"), "utf8")); } catch (e) { }

// ---------------------------------------------------------------- websocket framing
function wsAccept(key) { return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64"); }
function wsFrame(payload, op) {
  const n = payload.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, payload]);
}
class WsReader {
  constructor(onMsg) { this.buf = Buffer.alloc(0); this.onMsg = onMsg; this.frag = null; }
  push(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1]; let n = b1 & 127, o = 2;
      if (n === 126) { if (this.buf.length < 4) return; n = this.buf.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (this.buf.length < 10) return; n = Number(this.buf.readBigUInt64BE(2)); o = 10; }
      const masked = b1 & 128; const need = o + (masked ? 4 : 0) + n;
      if (this.buf.length < need) return;
      let p = Buffer.from(this.buf.subarray(o + (masked ? 4 : 0), need));
      if (masked) { const m = this.buf.subarray(o, o + 4); for (let i = 0; i < p.length; i++) p[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(need);
      this.onMsg(b0 & 15, p, !!(b0 & 128));
    }
  }
}

// ---------------------------------------------------------------- game session
let SESSIONS = 0;
class Session {
  constructor(sock, url) {
    this.sock = sock; this.url = url; this.n = ++SESSIONS;
    this.enc = new C.ServerEnc(); this.dec = new C.ClientDec(); this.r = 0;
    this.objs = buildWorld(); this.byId = new Map(this.objs.map((o) => [o.id, o]));
    this.vis = new Set(); this.joined = false; this.alive = false; this.tick = 0;
    this.keys = new Set(); this.aim = 0; this.attacking = false; this.lastSwing = 0;
    const sp = CFG.spawn || { x: WORLD.player["3"], y: WORLD.player["4"] };
    this.spawnPt = sp; this.x = sp.x; this.y = sp.y;
    this.pid = 6000000 + this.n * 16; this.inv = Object.assign({}, (WORLD.join.find((m) => m["1"] === T.INV) || { i: { 0: 20, 1: 20, 2: 20, 3: 0, 4: 0, 5: 0 } }).i);
    this.hp = 100; this.lastHurt = 0; this.out = []; this.nBoard = 0; this.xp = 0; this.held = 0; this.placed = {}; this.pending = {};
    this.stats = { rx: 0, tx: 0, ops: {} };
    L({ k: "ws_open", n: this.n, url });
    this.reader = new WsReader((op, p) => this.onFrame(op, p));
    sock.on("data", (d) => this.reader.push(d));
    sock.on("close", () => this.close("close"));
    sock.on("error", (e) => this.close("error " + e.message));
    this.start();
  }
  close(why) { if (this.closed) return; this.closed = true; clearInterval(this.timer); L({ k: "ws_close", n: this.n, why, stats: this.stats }); }
  queue(m) { this.out.push(m); }
  flush() {
    if (!this.out.length || this.closed) return;
    const msgs = this.out; this.out = [];
    for (let i = 0; i < msgs.length; i += 120) {   // keep frames modest, like the real server
      const fr = C.frame(this.enc, msgs.slice(i, i + 120));
      try { this.sock.write(wsFrame(fr, 2)); } catch (e) { }
      this.stats.tx++;
    }
  }
  // spectate before join: setup values, objects around the spawn, camera on a world object
  start() {
    for (const m of WORLD.setup) this.queue(m);
    this.streamObjects(true);
    const cam = this.nearest(this.x, this.y, () => true);
    if (cam) { this.queue({ "1": T.OWN, id: cam.id * 256 + 2, s: true }); }
    this.flush();
    this.timer = setInterval(() => this.step(), TICK_MS);
  }
  nearest(x, y, pred) {
    let best = null, bd = 1e18;
    for (const o of this.objs) { if (!pred(o)) continue; const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } }
    return best;
  }
  streamObjects(initial) {
    for (const o of this.objs) {
      const dx = Math.abs(o.x - this.x), dy = Math.abs(o.y - this.y);
      const inside = dx < VIEW_X && dy < VIEW_Y, outside = dx > VIEW_X + HYST || dy > VIEW_Y + HYST;
      if (inside && !this.vis.has(o.id)) { this.vis.add(o.id); this.queue(Object.assign({}, o.f, { "3": Math.round(o.x), "4": Math.round(o.y) })); }
      else if (outside && this.vis.has(o.id)) { this.vis.delete(o.id); this.queue({ "0": o.id, "1": T.REMOVE }); }
    }
  }
  playerCreate() {
    const f = Object.assign({}, WORLD.player);
    f["0"] = this.pid; f["3"] = Math.round(this.x); f["4"] = Math.round(this.y);
    f["12"] = Math.round(this.hp); f["18"] = this.name || " ";
    f["24"] = CFG.spawn_shield_ms != null ? CFG.spawn_shield_ms : 5000;
    return f;
  }
  join(msg) {
    CFG = loadCfg();
    this.name = (CFG.name || " ");
    if (!this.joined) {
      for (const m of WORLD.join) {
        if (m["1"] === T.OWN || m["1"] === T.INV) continue;
        if (m["1"] === T.MINIMAP && m.i) { this.queue(Object.assign({}, m, { i: this.pid + 1 })); continue; }
        this.queue(m);
      }
    }
    this.joined = true; this.alive = true; this.joinedAt = Date.now(); this.hp = 100; this.x = this.spawnPt.x; this.y = this.spawnPt.y;
    this.queue(this.playerCreate());
    this.queue({ "1": T.OWN, id: this.pid * 256 + 2, s: false });
    if (CFG.start_inv && !this.gotStartInv) { Object.assign(this.inv, CFG.start_inv); this.gotStartInv = true; }
    this.queue({ "1": T.INV, i: this.inv });
    this.queue({ "1": T.XP, i: this.xp });
    this.streamObjects(false);
    this.flush();
    L({ k: "join", n: this.n, pid: this.pid, x: this.x, y: this.y, msg: JSON.stringify(msg).slice(0, 80) });
  }
  onFrame(op, p) {
    this.stats.rx++;
    if (op === 8) { this.close("ws close frame"); return; }
    if (op === 9) { try { this.sock.write(wsFrame(p, 10)); } catch (e) { } return; }
    if (op === 10) return;
    const s0 = this.dec.s;
    const d = this.dec.decode(p, op === 1);
    if (process.env.MIMIC_DEBUG) L({ k: "c_raw", n: this.n, op, s0, raw: p.toString("hex").slice(0, 120), plain: d.raw ? d.raw.toString("hex").slice(0, 120) : null, nums: d.nums });
    if (d.json) {
      const arr = Array.isArray(d.json) ? d.json : [d.json];
      for (const m of arr) {
        L({ k: "c_json", n: this.n, type: m && m.type });
        if (m && m.type === 1) this.join(m);
      }
      return;
    }
    for (const v of d.nums || []) {
      const code = (v & 255) ^ this.r, arg = Math.floor(v / 256);
      this.stats.ops[code] = (this.stats.ops[code] || 0) + 1;
      if (process.env.MIMIC_DEBUG && code !== OP.HEARTBEAT) L({ k: "op", n: this.n, code, arg });
      if (code === OP.ROT) { this.r ^= arg & 255; continue; }   // the client XORs its op table with each new key, so keys accumulate
      if (code === OP.KEY) {
        const k = arg & 255, down = (arg >> 8) & 1;
        if (down) this.keys.add(k); else this.keys.delete(k);
        L({ k: "c_key", n: this.n, key: k, down });
      } else if (code === OP.AIM) { this.aim = arg / 1000; }
      else if (code === OP.ATTACK) {
        // value = action (low 3 bits, 1 = press) + aim*1000 << 3; 0 = release
        if (arg) this.aim = (arg >> 3) / 1000;
        this.attacking = arg !== 0;
        L({ k: "c_attack", n: this.n, on: this.attacking, arg, aim: this.aim, held: this.held });
        if (this.attacking && this.usable()) this.useItem();
      } else if (code === OP.SELECT) {
        // the client waits for the server to echo the held item (player field 8) before it accepts another pick
        this.held = ITEMS[arg] ? arg : 0;
        this.pending["8"] = this.held;
        L({ k: "c_select", n: this.n, item: arg, name: ITEMS[arg] && ITEMS[arg].name });
      }
      else if (code !== OP.HEARTBEAT) { L({ k: "c_op", n: this.n, code, arg }); }
    }
  }
  collide(nx, ny) {
    for (const o of this.objs) {
      if (!o.r) continue;
      const dx = nx - o.x, dy = ny - o.y, rr = o.r + PLAYER_R, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2); nx = o.x + dx / d * rr; ny = o.y + dy / d * rr; }
    }
    return [Math.max(MAP.x0, Math.min(MAP.x1, nx)), Math.max(MAP.y0, Math.min(MAP.y1, ny))];
  }
  step() {
    if (this.closed) return;
    this.tick++;
    const now = Date.now();
    if (this.joined && this.alive) {
      let vx = 0, vy = 0;
      for (const k of this.keys) { const d = KEYDIR[k]; if (d) { vx += d[0]; vy += d[1]; } }
      const m = Math.hypot(vx, vy);
      const f = {};
      if (m > 0) {
        const sp = (CFG.speed || SPEED);
        const [nx, ny] = this.collide(this.x + vx / m * sp, this.y + vy / m * sp);
        this.x = nx; this.y = ny;
      }
      f["3"] = Math.max(256, Math.round(this.x)); f["4"] = Math.max(256, Math.round(this.y));
      f["5"] = Math.round(((this.aim % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * 255);
      Object.assign(f, this.pending); this.pending = {};
      this.health(now, f);
      if (this.attacking && !this.usable() && now - this.lastSwing >= (CFG.swing_ms || 500)) { this.lastSwing = now; this.swing(f); }
      if (this.alive) this.queue(Object.assign({ "0": this.pid, "1": T.MOVE }, f));
      if (this.tick % 8 === 0) this.queue({ "1": T.MINIMAP, p: [Math.round(this.x / MINIMAP_DIV), Math.round(this.y / MINIMAP_DIV)] });
      this.streamObjects(false);
    } else if (!this.joined) {
      this.streamObjects(false);
    }
    this.moveAnimals();
    // keepalive: the client drops a static entity after ~22 frames without a type-84 record
    for (const id of this.vis) if ((id + this.tick) % 6 === 0) this.queue({ "0": id, "1": T.MOVE });
    if (!CFG.no_boards && this.joined && this.tick % 40 === 1 && WORLD.boards.length) this.queue(WORLD.boards[(this.nBoard++) % WORLD.boards.length]);   // delta-coded: in order from the first
    this.flush();
  }
  // HP: contact damage from hazard objects (config), regen after a quiet period, death -> scoreboard
  health(now, f) {
    const hz = CFG.hazards || [{ match: "spike", dps: 20 }, { match: "cactus", dps: 10 }];
    let dmg = 0;
    for (const o of this.objs) {
      if (o.owner === this.pid) continue;
      const h = hz.find((z) => o.name && o.name.indexOf(z.match) >= 0);
      if (!h) continue;
      if (Math.hypot(o.x - this.x, o.y - this.y) < o.r + PLAYER_R + 8) dmg = Math.max(dmg, h.dps * TICK_MS / 1000);
    }
    for (const z of (CFG.damage_zones || [])) {
      if (Math.hypot(z.x - this.x, z.y - this.y) < z.r) dmg = Math.max(dmg, z.dps * TICK_MS / 1000);
    }
    const before = Math.round(this.hp);
    if (dmg > 0) { this.hp = Math.max(0, this.hp - dmg); this.lastHurt = now; f["10"] = Math.max(1, Math.round(dmg)); }
    else if (now - this.lastHurt > (CFG.regen_delay_ms || 3000) && this.hp < 100) {
      this.hp = Math.min(100, this.hp + (CFG.regen_per_s || 5) * TICK_MS / 1000);
    }
    if (Math.round(this.hp) !== before) { f["12"] = Math.round(this.hp); if (this.tick % 4 === 0) L({ k: "hp", n: this.n, hp: Math.round(this.hp) }); }
    if (this.hp <= 0) this.die(now);
  }
  die(now) {
    this.alive = false; this.keys.clear(); this.attacking = false;
    L({ k: "death", n: this.n, x: this.x, y: this.y });
    this.queue({ "1": T.DEATH, o: { k: 0, t: Math.round((now - (this.joinedAt || now)) / 1000), s: 0, p: [] } });
    this.queue({ "0": this.pid, "1": T.REMOVE });
    const cam = this.nearest(this.x, this.y, (o) => this.vis.has(o.id));   // back to spectating, camera on a nearby object
    if (cam) this.queue({ "1": T.OWN, id: cam.id * 256 + 2, s: true });
  }
  // XP: the client derives age and bar from the total (type 27 "i"): age L starts at 20*L*(L+1)+1,
  // the bar is (xp - 20L(L+1)) / (40(L+1)), max age 60; each new age opens the client's item choices
  addXp(n, why) {
    const before = ageOf(this.xp);
    this.xp += n;
    this.queue({ "1": T.XP, i: this.xp });
    const after = ageOf(this.xp);
    if (after !== before) L({ k: "age_up", n: this.n, age: after, xp: this.xp, why });
  }
  usable() { const it = ITEMS[this.held]; return !!it && (it.cat === CAT_FOOD || CAT_BUILD.has(it.cat)); }   // else a tool/weapon: swings gather
  moveAnimals() {
    const sp = CFG.animal_speed || 18;
    for (const o of this.objs) {
      if (!o.mobile) continue;
      if (Math.hypot(o.tx - o.x, o.ty - o.y) < sp) {
        if (Math.random() < 0.04) { const a = Math.random() * 2 * Math.PI, d = Math.random() * 380; o.tx = o.hx + Math.cos(a) * d; o.ty = o.hy + Math.sin(a) * d; }
        continue;
      }
      const a = Math.atan2(o.ty - o.y, o.tx - o.x);
      let nx = o.x + Math.cos(a) * sp, ny = o.y + Math.sin(a) * sp;
      for (const b of this.objs) {   // walk around solid objects
        if (!b.r || b.mobile) continue;
        const dx = nx - b.x, dy = ny - b.y, rr = b.r + 30, d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2); nx = b.x + dx / d * rr; ny = b.y + dy / d * rr; }
      }
      o.x = nx; o.y = ny;
      if (this.vis.has(o.id)) this.queue({ "0": o.id, "1": T.MOVE, "3": Math.max(256, Math.round(o.x)), "4": Math.max(256, Math.round(o.y)),
        "5": Math.round(((a + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 255) });
    }
  }
  canPay(cost) { return (cost || []).every((c, i) => !c || (this.inv[i] || 0) >= c); }
  pay(cost) { (cost || []).forEach((c, i) => { if (c) this.inv[i] -= c; }); }
  useItem() {
    const it = ITEMS[this.held];
    if (!it || !this.alive) return;
    if (it.cat === CAT_FOOD) {
      // full HP: the food is refused and nothing is spent
      if (this.hp >= 100) { L({ k: "eat_refused", n: this.n, item: it.name, hp: this.hp }); return; }
      if (!this.canPay(it.cost)) { L({ k: "eat_no_food", n: this.n, inv: this.inv }); return; }
      this.pay(it.cost);
      const before = this.hp;
      this.hp = Math.min(100, this.hp + (it.heal || 0));
      this.pending["12"] = Math.round(this.hp); this.pending["11"] = Math.round(this.hp - before);
      this.held = 0; this.pending["8"] = 0;
      this.queue({ "1": T.INV, i: this.inv });
      L({ k: "eat", n: this.n, item: it.name, hp_from: Math.round(before), hp_to: Math.round(this.hp), inv: this.inv });
    } else if (CAT_BUILD.has(it.cat)) {
      const cnt = this.placed[it.id] || 0;
      if (it.limit && cnt >= it.limit) { L({ k: "place_limit", n: this.n, item: it.name }); return; }
      if (!this.canPay(it.cost)) { L({ k: "place_no_res", n: this.n, item: it.name, inv: this.inv }); return; }
      const idx = WORLD_NAMES.indexOf(it.icon);
      if (idx < 0) { L({ k: "place_no_def", n: this.n, item: it.name }); return; }
      const r = radiusOf(it.icon), dist = PLAYER_R + (it.place || 62) + 8;
      const x = this.x + Math.cos(this.aim) * dist, y = this.y + Math.sin(this.aim) * dist;
      for (const o of this.objs) if (o.r && Math.hypot(o.x - x, o.y - y) < o.r + r - 10) { L({ k: "place_blocked", n: this.n, item: it.name, by: o.name }); return; }
      this.pay(it.cost);
      const id = NEXT_ID++, ang = Math.round((((this.aim % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 100);
      const o = { id, x: Math.round(x), y: Math.round(y), name: it.icon, r, synthetic: true, owner: this.pid,
        f: { "0": id, "1": T.CREATE, "2": 3, "3": Math.round(x), "4": Math.round(y), "5": ang, "6": 1, "13": idx, "16": this.pid } };
      this.objs.push(o); this.byId.set(id, o);
      this.placed[it.id] = cnt + 1;
      this.held = 0; this.pending["8"] = 0;   // back to the weapon after a placement (approximation)
      this.queue({ "1": T.INV, i: this.inv });
      this.queue({ "1": T.ITEMCOUNT, B: [it.id * 256 + this.placed[it.id]] });
      this.streamObjects(false);
      L({ k: "place", n: this.n, item: it.name, id, x: o.x, y: o.y, inv: this.inv, count: this.placed[it.id] });
    }
  }
  // gathering: hit the nearest resource object in front of the player
  swing(f) {
    f["15"] = 300;   // swing animation timer
    const reach = CFG.reach || 110;
    let best = null, bd = 1e9;
    for (const o of this.objs) {
      if (resourceOf(o.name) == null) continue;
      const dx = o.x - this.x, dy = o.y - this.y, d = Math.hypot(dx, dy) - o.r - PLAYER_R;
      if (d > reach) continue;
      let da = Math.abs(Math.atan2(dy, dx) - this.aim); da = Math.min(da, 2 * Math.PI - da);
      if (da > 1.2) continue;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) { L({ k: "swing_miss", n: this.n, x: Math.round(this.x), y: Math.round(this.y), aim: this.aim }); return; }
    const slot = resourceOf(best.name), gain = (CFG.gain && CFG.gain[best.name]) || 1;
    this.inv[slot] = (this.inv[slot] || 0) + gain;
    const ang = Math.atan2(best.y - this.y, best.x - this.x);
    this.queue({ "0": best.id, "1": T.MOVE, "8": Math.round(((ang + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 255) });
    this.queue({ "1": T.INV, i: this.inv });
    // Ion rule: age XP comes from hitting stone and wood only; food bushes give food, no XP
    if (slot === 1 || slot === 2) this.addXp((CFG.xp && CFG.xp[best.name]) || CFG.xp_per_gather || 5, "gather");
    L({ k: "gather", n: this.n, obj: best.id, name: best.name, synthetic: best.synthetic, slot, inv: this.inv });
  }
}

module.exports = { Session, lookup, ctype, MIR, MIRROR, WORLD, ITEMS, WsReader, wsFrame, wsAccept, setLogger: (f) => { LOGGER = f; } };
if (require.main === module) {
// ---------------------------------------------------------------- http + proxy
const CERT = { key: fs.readFileSync(ARGS.key || path.join(RND, "tls", "key.pem")), cert: fs.readFileSync(ARGS.cert || path.join(RND, "tls", "cert.pem")) };
const HD = require("./hosted/harden"), RW = require("./hosted/rewrite");
const TEXT_CACHE = new Map();
function served(r, body) {   // third-party URLs -> local dead page, HTML guarded, manifest kept local
  const type = ctype(r);
  if (!/^(text\/|application\/(json|javascript|manifest\+json))/.test(type)) return body;
  const key = r.file;
  if (TEXT_CACHE.has(key)) return TEXT_CACHE.get(key);
  let s = body.toString("utf8");
  if (r.file === BUNDLE) s = RW.rewriteBundle(s);
  else {
    s = RW.rewriteText(s, "https://taming.invalid", "wss://taming.invalid", true);
    if (/^text\/html/.test(type)) s = HD.injectGuard(HD.hardenHtml(s, null), false);
    else if (/manifest/.test(r.url || "") && /json/.test(type)) s = HD.hardenManifest(s, null);
  }
  const out = Buffer.from(s, "utf8");
  if (TEXT_CACHE.size > 32) TEXT_CACHE.clear();
  TEXT_CACHE.set(key, out);
  return out;
}
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const H = http.createServer((req, res) => {
  const url = /^https?:\/\//.test(req.url) ? req.url : ((req.socket.encrypted ? "https://" : "http://") + req.headers.host + req.url);
  req.resume();
  const SEC = HD.headers(null);
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "*" }, SEC));
    return res.end();
  }
  if (/^https?:\/\/[^/]+\/(_dead\/|blocked(\?|$))/.test(url)) {
    L({ k: "http", url: url.slice(0, 300), hit: "blocked_page" });
    res.writeHead(200, Object.assign({ "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" }, SEC));
    return res.end(HD.BLOCKED_PAGE);
  }
  const [r, how] = lookup(url);
  if (r) {
    let body = null;
    try { body = served(r, fs.readFileSync(path.isAbsolute(r.file) ? r.file : path.join(MIRROR, "files", r.file))); } catch (e) { }
    if (body) {
      L({ k: "http", url: url.slice(0, 300), hit: how, n: body.length });
      res.writeHead(200, Object.assign({ "Content-Type": ctype(r), "Content-Length": body.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }, SEC));
      return res.end(body);
    }
  }
  if (/^https:\/\/taming\.invalid\/.*\.png(\?|$)/.test(url)) {   // asset the recordings never fetched: blank image, logged
    L({ k: "http", url: url.slice(0, 300), hit: "blank_png" });
    res.writeHead(200, Object.assign({ "Content-Type": "image/png", "Content-Length": BLANK_PNG.length, "Access-Control-Allow-Origin": "*" }, SEC));
    return res.end(BLANK_PNG);
  }
  L({ k: "http", url: url.slice(0, 300), hit: null });
  res.writeHead(404, Object.assign({ "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }, SEC));
  res.end("offline: not mirrored");
});
H.on("upgrade", (req, sock) => {
  const host = req.headers.host || "";
  if ((req.headers.upgrade || "").toLowerCase() !== "websocket" || !/taming\.invalid/.test(host)) { sock.destroy(); L({ k: "ws_reject", host }); return; }
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + wsAccept(req.headers["sec-websocket-key"]) + "\r\n\r\n");
  sock.setNoDelay(true);
  new Session(sock, host + req.url);
});
const P = net.createServer((sock) => {
  sock.once("data", (d) => {
    const s = d.toString("latin1");
    if (s.startsWith("CONNECT ")) {
      const host = s.split(" ")[1];
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const t = new tls.TLSSocket(sock, Object.assign({ isServer: true }, CERT));
      t.on("error", (e) => L({ k: "tls_err", host, err: e.message }));
      H.emit("connection", t);
    } else {
      sock.unshift(d);
      H.emit("connection", sock);
    }
  });
  sock.on("error", () => { });
});
P.listen(PORT, "127.0.0.1", () => { L({ k: "start", port: PORT, mirror: MIR.size, objects: WORLD.objects.length, bundle: BUNDLE }); console.log("mimic server on 127.0.0.1:" + PORT + ", " + MIR.size + " mirrored urls, " + WORLD.objects.length + " world objects"); });
}
