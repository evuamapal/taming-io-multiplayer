#!/usr/bin/env node
// Soak test for the hosted offline server: a private multi-mode server on a loopback port with a short biome cycle
// (own config copy with game.biome_ms_override), 6..8 random bots (walk, gather, fight, die, respawn, build, tame,
// ride, clans, chat, reconnects), two real browsers (bin/hosted_proof.sh in a loop) and monitors (RSS, entities,
// tick time, sockets, visibility). Writes <out>/metrics.jsonl, bots.jsonl, report.md, report.json; exit 0 only if
// every condition passes.
// Usage: node bin/soak.js [--port 8931] [--minutes 20] [--bots 8] [--out logs/soak_<ts>] [--no-browsers]
//        [--phase-ms N] [--sample-ms 3000]
"use strict";
const fs = require("fs"), path = require("path"), net = require("net"), cp = require("child_process"), os = require("os");
const ROOT = path.join(__dirname, "..");
const A = {}; for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i].replace(/^--/, ""); const v = process.argv[i + 1]; if (v != null && !v.startsWith("--")) { A[k] = v; i++; } else A[k] = true; }
const PORT = +(A.port || 8931);
if (PORT === 8921 || (PORT >= 8920 && PORT <= 8929)) { console.error("refusing shared port " + PORT); process.exit(2); }
const HOST = "127.0.0.1:" + PORT, ORIGIN = "http://" + HOST;
const DUR = Math.round(+(A.minutes || 20) * 60000), NBOTS = Math.max(1, +(A.bots || 8)), SAMPLE = +(A["sample-ms"] || 3000);
const PHASE_MS = +(A["phase-ms"] || Math.max(30000, Math.round(DUR / 10)));
const TS = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
const OUT = path.resolve(A.out || path.join(ROOT, "logs", "soak_" + TS));
const SLOG = path.join(OUT, "server", "server.jsonl");
const NODE = process.execPath;
const { TestClient } = require(path.join(ROOT, "mimic", "hosted", "testclient.js"));
const { encodeJoin } = require(path.join(ROOT, "mimic", "hosted", "joincodec.js"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const T0 = Date.now();
const el = () => (Date.now() - T0) / 1000;
fs.mkdirSync(path.join(OUT, "server"), { recursive: true });
const OUTF = {};
function out(name, o) { if (!OUTF[name]) OUTF[name] = fs.openSync(path.join(OUT, name), "a"); fs.writeSync(OUTF[name], JSON.stringify(o) + "\n"); }
function say(s) { const l = "[" + el().toFixed(0).padStart(5) + "] " + s; console.log(l); out("soak.log.jsonl", { t: el(), s }); }

// ------------------------------------------------------------ server
const BAD_KINDS = new Set(["world_err", "plugin_err", "uncaught", "unhandled"]);
const INFO_KINDS = new Set(["player_err", "ws_err", "http_err", "ws_drop", "log_err", "listen_err", "bundle_br_err"]);
const LOGS = { kinds: {}, bad: [], info: [], outbound: [], biome: [], tick: [], stats: [], gone: 0, accept: 0, place: 0, clan: {}, deaths: 0, joins: 0, chat: 0, tame: 0 };
let server = null, serverExit = null;
function startServer() {
  const hc = JSON.parse(fs.readFileSync(path.join(ROOT, "mimic", "hosted_config.json"), "utf8"));
  hc.port = PORT; hc.bind = "127.0.0.1"; hc.mode = "multi"; hc.world = hc.world || "world_sp5.json";
  hc.game = Object.assign({}, hc.game, { biome_ms_override: PHASE_MS });
  hc._doc = "SOAK test-only copy of mimic/hosted_config.json: game.biome_ms_override " + PHASE_MS + " ms";
  const cfg = path.join(OUT, "hosted_config.json");
  fs.writeFileSync(cfg, JSON.stringify(hc, null, 1));
  const env = Object.assign({}, process.env, { MODE: "multi", TIO_CREATURES_TEST: "1", TIO_STATS_MS: String(A["stats-ms"] || 5000), HOSTED_CONFIG: cfg });
  const so = fs.openSync(path.join(OUT, "server", "server.out"), "a");
  server = cp.spawn(NODE, [path.join(ROOT, "mimic", "hosted_server.js"), "--port", String(PORT), "--bind", "127.0.0.1", "--logdir", path.join(OUT, "server"), "--mode", "multi", "--hconfig", cfg],
    { cwd: ROOT, env, stdio: ["ignore", so, so] });
  fs.writeFileSync(path.join(OUT, "server", "server.pid"), String(server.pid));
  server.on("exit", (code, sig) => { serverExit = { code, sig, t: el() }; say("server exit " + code + " " + sig); });
  say("server pid " + server.pid + " port " + PORT + " phase_ms " + PHASE_MS);
}
function portOpen() { return new Promise((res) => { const s = net.connect(PORT, "127.0.0.1"); s.on("connect", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); }); }
// incremental reader of server.jsonl (log.js rotates server.jsonl -> .1 at 20 MB)
let logOff = 0, logIno = null, logRest = "";
function readLog() {
  let st; try { st = fs.statSync(SLOG); } catch (e) { return; }
  if (logIno != null && st.ino !== logIno) {   // rotated: finish the old file first
    try { const b = fs.readFileSync(SLOG + ".1"); onLogText(b.subarray(logOff).toString("utf8")); } catch (e) { }
    logOff = 0;
  }
  logIno = st.ino;
  if (st.size <= logOff) return;
  const fd = fs.openSync(SLOG, "r"), n = st.size - logOff, b = Buffer.alloc(n);
  fs.readSync(fd, b, 0, n, logOff); fs.closeSync(fd); logOff = st.size;
  onLogText(b.toString("utf8"));
}
function onLogText(s) {
  const lines = (logRest + s).split("\n"); logRest = lines.pop();
  for (const l of lines) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch (e) { continue; }
    const k = o.k; LOGS.kinds[k] = (LOGS.kinds[k] || 0) + 1;
    o.el = +(o.t - T0 / 1000).toFixed(1);
    if (BAD_KINDS.has(k)) { if (LOGS.bad.length < 200) LOGS.bad.push(o); say("BAD log " + l.slice(0, 300)); }
    else if (INFO_KINDS.has(k)) { if (LOGS.info.length < 200) LOGS.info.push(o); }
    if (k === "outbound_blocked") LOGS.outbound.push(o);
    else if (k === "biome") { LOGS.biome.push(o); say("biome " + o.from + " -> " + o.to + " created " + o.created); }
    else if (k === "tick_stats") LOGS.tick.push(o);
    else if (k === "stats") { LOGS.stats.push(o); lastStats = o; }
    else if (k === "place") LOGS.place++;
    else if (k === "death") LOGS.deaths++;
    else if (k === "join") LOGS.joins++;
    else if (k === "chat") LOGS.chat++;
    else if (/^clan_/.test(k)) LOGS.clan[k] = (LOGS.clan[k] || 0) + 1;
  }
}
let lastStats = null, lastCpu = null, lagMax = 0;
// event loop lag of this process: when it lags together with the server tick, the host is starved for CPU
(function lag() { const t = Date.now(); setTimeout(() => { lagMax = Math.max(lagMax, Date.now() - t - 100); lag(); }, 100).unref(); })();

// ------------------------------------------------------------ sockets (lsof on the server pid)
function lsof(pid) {
  const r = cp.spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-i"], { encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").slice(1).filter(Boolean);
  const res = { total: 0, listen: 0, est: 0, other: 0, nonloop: [], peers: new Set(), lines };
  for (const l of lines) {
    const m = /(TCP|UDP)\s+(\S+)(?:\s+\((\w+)\))?\s*$/.exec(l); if (!m) continue;
    res.total++;
    const name = m[2], state = m[3] || "";
    if (state === "LISTEN") res.listen++; else if (state === "ESTABLISHED") res.est++; else res.other++;
    for (const ep of name.split("->")) {
      const host = ep.replace(/:[^:]*$/, "");
      if (!/^(127\.0\.0\.1|\[::1\]|\*|localhost)$/.test(host)) res.nonloop.push(l);
    }
    const pm = /->127\.0\.0\.1:(\d+)/.exec(name); if (pm) res.peers.add(+pm[1]);
  }
  return res;
}
const closedPorts = [];   // {port, t, bot}
const stuck = [];

// ------------------------------------------------------------ bots
const T = { XP: 27, CHAT: 39, CREATE: 79, MOVE: 84, REMOVE: 87, OWN: 19, INV: 53, DEATH: 6, CLAN: 68, TIMER: 32 };
const CM = { DEL: 26, ADD: 71, LIST: 61, MEMBER: 16, LEADER: 46, MEMBERS: 83, NAMES: 35, REQ: 3, LEFT: 10, INFO: 74 };
const CO = { OPEN: 77, CREATE: 51, ASK: 60, ACCEPT: 54, DECLINE: 72, KICK: 38, LEADER: 24, LEAVE: 33, CLOSE: 30 };
const BUILD = [206, 249, 266, 307];   // Wooden Wall, Wooden Door, Wooden Spike, Wooden Windmill (start items)
const SADDLE = 160, VIEW = [1370, 933], MARGIN = 150;
const CLANS = new Map();   // tid -> {name, leader: Bot}
const BOTS = [];
let running = true;
const angCode = (a) => Math.round(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1000);
class Bot {
  constructor(i) {
    this.i = i; this.name = "soak" + i; this.c = null; this.st = {}; this.act = {}; this.errors = [];
    this.anchor = null; this.conn = 0; this.reset();
  }
  reset() {
    this.id = null; this.alive = false; this.joinedAt = 0; this.ents = new Map(); this.pos = null; this.hp = 100; this.xp = 0; this.inv = {};
    this.clan = null; this.leader = false; this.req = null; this.members = null; this.lastTest = null; this.riding = false; this.dead = false; this.keys = new Set();
  }
  count(k, n) { this.act[k] = (this.act[k] || 0) + (n || 1); }
  async connect() {
    this.reset();
    const c = this.c = new TestClient(() => net.connect(PORT, "127.0.0.1"), { host: HOST, path: "/_h/offline1/offline1?1_2", origin: ORIGIN });
    const t = Date.now();
    while (!c.status && !c.closed && Date.now() - t < 5000) await sleep(50);
    if (!c.open) { this.count("connect_fail"); try { c.sock.destroy(); } catch (e) { } this.c = null; return false; }
    this.lport = c.sock.localPort; this.conn++; this.count("connect");
    c.sock.on("close", () => { if (this.c === c) { this.c = null; this.alive = false; this.count("server_closed"); closedPorts.push({ port: this.lport, t: Date.now(), bot: this.i, by: "server" }); } });
    await sleep(rnd(100, 400));
    this.join();
    return true;
  }
  join() { if (this.c) { this.c.json({ type: 1, c: encodeJoin(JSON.stringify({ name: this.name }), 243) }); this.count("join_sent"); } }
  close(why) {
    const c = this.c; if (!c) return;
    this.c = null; this.alive = false;
    closedPorts.push({ port: this.lport, t: Date.now(), bot: this.i, by: why || "bot" });
    try { c.close(); } catch (e) { }
    setTimeout(() => { try { c.sock.destroy(); } catch (e) { } }, 500);
  }
  json(o) { if (this.c) this.c.json(o); }
  ops(l) { if (this.c) this.c.ops(l); }
  pump() {
    const c = this.c; if (!c) return;
    if (c.parseErr && !this.parseErrSeen) { this.parseErrSeen = true; this.errors.push("parse " + c.parseErr); }
    const msgs = c.msgs; if (!msgs.length) return;
    c.msgs = [];
    for (const q of msgs) { try { this.onMsg(q); } catch (e) { if (this.errors.length < 20) this.errors.push(String(e.stack || e).slice(0, 300)); } }
  }
  onMsg(q) {
    const t = q["1"], now = Date.now();
    if (t === T.OWN) {
      if (q.s === false) { this.id = Math.floor(q.id / 256); this.alive = true; this.dead = false; this.joinedAt = now; this.count("joined"); }
      return;
    }
    if (t === T.CREATE) {
      const id = q["0"];
      this.ents.set(id, { id, cat: q["2"], x: q["3"], y: q["4"], k22: q["22"], o13: q["13"], name: q["18"], s7: q["7"], seen: now });
      if (id === this.id) this.pos = [q["3"], q["4"]];
      return;
    }
    if (t === T.MOVE) {
      const e = this.ents.get(q["0"]); if (!e) return;
      if (q["3"] != null) { e.x = q["3"]; e.y = q["4"]; }
      if (q["7"] != null) e.s7 = q["7"];
      if (q["13"] != null && e.cat === 0) e.o13 = q["13"];
      if (e.id === this.id) {
        if (q["3"] != null) this.pos = [q["3"], q["4"]];
        if (q["12"] != null) this.hp = q["12"];
        if (q["16"] != null) { this.riding = q["16"] === 1; this.count(this.riding ? "mounted" : "dismounted"); }
        if (q["7"] === 16) { this.alive = false; this.count("died"); }
      }
      return;
    }
    if (t === T.REMOVE) { this.ents.delete(q["0"]); return; }
    if (t === T.XP) { this.xp = q.i; return; }
    if (t === T.INV) { this.inv = q.i || {}; return; }
    if (t === T.DEATH) {
      this.alive = false; this.dead = true; this.count("death_screen"); this.clanAfterDeath = this.clan;
      setTimeout(() => { if (running && this.c && this.dead) { this.join(); this.count("respawn"); } }, rnd(800, 2500));
      return;
    }
    if (t === T.CHAT) {
      const m = /^test (\d+)/.exec(q.m || "");
      if (q.i === 0 && m) this.lastTest = +m[1];
      else if (q.i !== 0) this.count(q.tm === 62 ? "team_chat_rx" : "chat_rx");
      return;
    }
    if (t === T.CLAN) this.onClan(q);
  }
  onClan(q) {
    const o = q.o;
    if (q.m === CM.INFO && o && o.x) {
      this.clan = o.x; this.leader = o.l === 1;
      if (this.leader) CLANS.set(o.x, { name: o.n, leader: this });
      else if (o.n && !CLANS.has(o.x)) CLANS.set(o.x, { name: o.n, leader: null });
      this.count(this.leader ? "clan_leader_info" : "clan_member_info");
    } else if (q.m === CM.REQ) {
      this.req = o; this.count("clan_req_rx");
      setTimeout(() => {
        if (!this.c || !this.leader || !this.req) return;
        if (Math.random() < 0.75) { this.json({ type: T.CLAN, o: CO.ACCEPT }); this.count("clan_accept"); }
        else { this.json({ type: T.CLAN, o: CO.DECLINE }); this.count("clan_decline"); }
        this.req = null;
      }, rnd(400, 2000));
    } else if (q.m === CM.LEFT) { this.clan = null; this.leader = false; this.count("clan_left_rx"); }
    else if (q.m === CM.DEL) { CLANS.delete(o); if (this.clan === o) { this.clan = null; this.leader = false; } }
    else if (q.m === CM.LEADER) { this.leader = true; if (this.clan && CLANS.has(this.clan)) CLANS.get(this.clan).leader = this; }
    else if (q.m === CM.MEMBER) { this.leader = false; }
    else if (q.m === CM.MEMBERS) this.members = o;
  }
  // ---------------------------------------------------------- actions
  setKeys(ks) {
    const l = [];
    for (const k of this.keys) if (!ks.has(k)) l.push([5, k]);
    for (const k of ks) if (!this.keys.has(k)) l.push([5, k + 256]);
    this.keys = ks; if (l.length) this.ops(l);
  }
  async walkTo(x, y, ms, near) {
    const end = Date.now() + ms;
    while (Date.now() < end && this.alive && this.pos) {
      const dx = x - this.pos[0], dy = y - this.pos[1];
      if (Math.hypot(dx, dy) < (near || 120)) break;
      const ks = new Set(); if (Math.abs(dx) > 40) ks.add(dx > 0 ? 1 : 0); if (Math.abs(dy) > 40) ks.add(dy > 0 ? 2 : 3);
      this.setKeys(ks); await sleep(150);
    }
    this.setKeys(new Set());
  }
  aimAt(x, y) { if (!this.pos) return 0; const c = angCode(Math.atan2(y - this.pos[1], x - this.pos[0])); this.ops([[0, c]]); return c; }
  async swingAt(getXY, ms) {
    const end = Date.now() + ms; let on = false;
    while (Date.now() < end && this.alive && this.c) {
      const p = getXY(); if (!p) break;
      const c = angCode(Math.atan2(p[1] - this.pos[1], p[0] - this.pos[0]));
      this.ops([[0, c], [4, (c << 3) + 1]]); on = true;
      await sleep(rnd(250, 450));
    }
    if (on) this.ops([[4, 0]]);
  }
  nearest(f) { let best = null, bd = 1e18; for (const e of this.ents.values()) { if (!f(e)) continue; const d = Math.hypot(e.x - this.pos[0], e.y - this.pos[1]); if (d < bd) { bd = d; best = e; } } return best; }
  async aWalk() {
    const a = this.anchor || this.pos, r = rnd(0, 1500), t = rnd(0, 2 * Math.PI);
    await this.walkTo(a[0] + Math.cos(t) * r, a[1] + Math.sin(t) * r, rnd(1500, 5000));
  }
  async aGather() {
    const o = this.nearest((e) => e.cat === 3 && e.s7 !== 0); if (!o) return this.aWalk();
    await this.walkTo(o.x, o.y, 4000, 170);
    const x0 = this.xp; await this.swingAt(() => this.ents.has(o.id) ? [o.x, o.y] : null, rnd(2000, 5000));
    if (this.xp > x0) this.count("gather_ok");
  }
  async aFight() {
    const tg = this.nearest((e) => e.cat === 1 && e.id !== this.id && !/^Proof/.test(e.name || "") && e.s7 !== 16); if (!tg) return this.aWalk();
    const end = Date.now() + rnd(6000, 20000); this.count("fight");
    while (Date.now() < end && this.alive && this.ents.has(tg.id) && tg.s7 !== 16) {
      if (Math.hypot(tg.x - this.pos[0], tg.y - this.pos[1]) > 110) await this.walkTo(tg.x, tg.y, 1200, 90);
      await this.swingAt(() => this.ents.has(tg.id) ? [tg.x, tg.y] : null, 900);
    }
  }
  async aBuild() {
    const it = pick(BUILD); this.ops([[10, it]]); await sleep(250);
    const c = angCode(rnd(0, 2 * Math.PI)); this.ops([[0, c], [4, (c << 3) + 1]]); await sleep(300); this.ops([[4, 0]]);
    this.count("build_try");
  }
  async test(o, ms) { this.lastTest = null; this.json(Object.assign({ type: 990 }, o)); const end = Date.now() + (ms || 2000); while (this.lastTest == null && Date.now() < end && this.c) await sleep(50); return this.lastTest; }
  async aTameRide() {
    const w = this.nearest((e) => e.cat === 0 && e.o13 == null && e.k22 != null);
    if (w) {
      const id = await this.test({ kind: w.k22, d: 130, a: rnd(0, 6) });
      if (id) {
        this.json({ type: 45, _: id }); this.count("tame_try");
        const end = Date.now() + 7000;
        while (Date.now() < end && this.alive) { const e = this.ents.get(id); if (e && e.o13 === this.id) { this.count("tame_ok"); break; } await sleep(200); }
        if (Math.random() < 0.5) this.json({ type: 48, I: id, S: pick([2, 4]) });
      }
    }
    if (!this.alive) return;
    if (this.xp < 700) await this.test({ xp: 700 });
    this.ops([[1, SADDLE]]); await sleep(200); this.ops([[10, SADDLE]]); await sleep(200);
    const pid = await this.test({ pet: 1, d: 100, a: rnd(0, 6) });
    if (!pid) return;
    await sleep(300);
    const pe = this.ents.get(pid); if (!pe || !this.pos) return;
    this.count("ride_try");
    await this.swingAt(() => (this.riding ? null : [pe.x, pe.y]), 2500);
    if (this.riding) {
      await this.aWalk();
      this.ops([[10, SADDLE]]); await sleep(200);
      await this.swingAt(() => (this.riding ? [pe.x, pe.y] : null), 2500);
    }
  }
  async aClan() {
    if (!this.clan) {
      const live = [...CLANS.entries()].filter(([, v]) => v.leader && v.leader.c);
      if (live.length < 3 && Math.random() < 0.4) { const n = "S" + this.i + Math.floor(rnd(100, 999)); this.json({ type: T.CLAN, o: CO.CREATE, n }); this.count("clan_create"); }
      else if (live.length) { const [, v] = pick(live); this.json({ type: T.CLAN, o: CO.ASK, n: v.name }); this.count("clan_ask"); }
      return;
    }
    if (this.leader) {
      this.members = null; this.json({ type: T.CLAN, o: CO.OPEN }); await sleep(700); this.json({ type: T.CLAN, o: CO.CLOSE });
      const others = (this.members || []).filter((r) => r[4] !== this.id);
      const r = Math.random();
      if (others.length && r < 0.35) { this.json({ type: T.CLAN, o: CO.KICK, n: pick(others)[1] }); this.count("clan_kick"); }
      else if (others.length && r < 0.5) { this.json({ type: T.CLAN, o: CO.LEADER, n: pick(others)[1] }); this.count("clan_transfer"); }
      else if (r < 0.65) { this.json({ type: T.CLAN, o: CO.LEAVE }); this.count("clan_leave_leader"); }
      else { this.json({ type: T.CHAT, msg: "team " + this.i, tm: 1 }); this.count("team_chat"); }
    } else if (Math.random() < 0.3) { this.json({ type: T.CLAN, o: CO.LEAVE }); this.count("clan_leave"); }
    else { this.json({ type: T.CHAT, msg: "team " + this.i, tm: 1 }); this.count("team_chat"); }
  }
  aChat() { this.json({ type: T.CHAT, msg: pick(["hi", "gg", "where", "follow me", "nice"]) + " " + this.i, tm: 0 }); this.count("chat"); }
  async aSuicide() {
    const id = await this.test({ kind: 44, d: 200, a: rnd(0, 6), target: true });
    this.count("scorpion");
    const end = Date.now() + 20000;
    while (Date.now() < end && this.alive) await sleep(250);
  }
  async aReconnect() {
    this.count("reconnect"); this.close("bot");
    await sleep(rnd(500, 3000));
  }
  async loop() {
    const acts = [["walk", 22, () => this.aWalk()], ["gather", 20, () => this.aGather()], ["fight", 16, () => this.aFight()], ["build", 8, () => this.aBuild()],
      ["tame", 5, () => this.aTameRide()], ["clan", 12, () => this.aClan()], ["chat", 10, () => this.aChat()], ["suicide", 2, () => this.aSuicide()], ["reconnect", 1.2, () => this.aReconnect()]];
    const tot = acts.reduce((a, x) => a + x[1], 0);
    while (running) {
      try {
        if (!this.c) { await this.connect(); if (!this.c) { await sleep(2000); continue; } }
        if (!this.alive) {
          if (!this.dead && this.joinedAt === 0 && this.c && Date.now() - this.c.openedAt > 0) { }
          await sleep(200); continue;
        }
        if (!this.anchor && this.pos) this.anchor = this.pos.slice();
        let r = Math.random() * tot, a = acts[0];
        for (const x of acts) { if ((r -= x[1]) < 0) { a = x; break; } }
        this.count("a_" + a[0]);
        await a[2]();
        await sleep(rnd(100, 500));
      } catch (e) { if (this.errors.length < 20) this.errors.push(String(e.stack || e).slice(0, 300)); await sleep(500); }
    }
  }
  summary() { return { i: this.i, conn: this.conn, alive: this.alive, id: this.id, pos: this.pos, vis: this.ents.size, clan: this.clan, leader: this.leader, xp: this.xp, hp: this.hp, riding: this.riding }; }
}

// ------------------------------------------------------------ visibility (every 500 ms)
const inside = {};   // "a,b" -> since
const visViol = [];
let visChecks = 0;
function visCheck() {
  const now = Date.now();
  for (const a of BOTS) for (const b of BOTS) {
    if (a === b) continue;
    const key = a.i + "," + b.i;
    const ok = a.c && b.c && a.alive && b.alive && a.pos && b.pos && a.id && b.id && now - a.joinedAt > 1000 && now - b.joinedAt > 1000 &&
      Math.abs(a.pos[0] - b.pos[0]) < VIEW[0] - MARGIN && Math.abs(a.pos[1] - b.pos[1]) < VIEW[1] - MARGIN;
    if (!ok) { delete inside[key]; continue; }
    const s = inside[key];
    if (!s || s.bid !== b.id || s.aid !== a.id) { inside[key] = { since: now, bid: b.id, aid: a.id, rep: false }; continue; }
    if (now - s.since >= 2000) {
      visChecks++;
      if (!a.ents.has(b.id) && !s.rep) {
        s.rep = true;
        const v = { t: el(), a: a.i, b: b.i, aid: a.id, bid: b.id, apos: a.pos, bpos: b.pos, for_ms: now - s.since, a_vis: a.ents.size };
        visViol.push(v); say("VISIBILITY " + JSON.stringify(v));
      }
    }
  }
}

// ------------------------------------------------------------ browsers (bin/hosted_proof.sh loop)
const proofs = [];
let proofProc = null;
function runProof(n) {
  const dir = path.join(OUT, "proof_" + n);
  const args = ["--url", ORIGIN + "/", "--server-pid", String(server.pid), "--server-log", SLOG, "--out", dir, "--milestone", "2", "--no-grep"];
  const so = fs.openSync(path.join(OUT, "proof_" + n + ".out"), "w");
  const t = el();
  proofProc = cp.spawn(path.join(ROOT, "bin", "hosted_proof.sh"), args, { cwd: ROOT, stdio: ["ignore", so, so] });
  const rec = { n, dir, start: t, pid: proofProc.pid };
  proofs.push(rec);
  say("proof " + n + " start pid " + proofProc.pid);
  return new Promise((res) => proofProc.on("exit", (code) => { rec.code = code; rec.end = el(); proofProc = null; say("proof " + n + " exit " + code + " after " + (rec.end - t).toFixed(0) + " s"); res(); }));
}
async function proofLoop() {
  let n = 0;
  while (running && DUR - (Date.now() - T0) > 540000) { await runProof(++n); await sleep(3000); }
}

// ------------------------------------------------------------ monitor
const samples = [];
function sampleNow(tag) {
  readLog();
  if (!server || serverExit) return null;
  const ps = cp.spawnSync("ps", ["-o", "rss=,time=", "-p", String(server.pid)], { encoding: "utf8" });
  const pf = String(ps.stdout).trim().split(/\s+/), rss = +pf[0] || null;
  const tp = (pf[1] || "").split(":").map(Number), cpuS = tp.length === 3 ? tp[0] * 3600 + tp[1] * 60 + tp[2] : tp.length === 2 ? tp[0] * 60 + tp[1] : null;
  const cpuPct = cpuS != null && lastCpu ? +((cpuS - lastCpu.s) / ((Date.now() - lastCpu.t) / 1000) * 100).toFixed(1) : null;
  if (cpuS != null) lastCpu = { s: cpuS, t: Date.now() };
  const ls = lsof(server.pid);
  const now = Date.now();
  for (const cpo of closedPorts) {
    if (cpo.checked || now - cpo.t < 10000) continue;
    cpo.checked = true;
    if (ls.peers.has(cpo.port)) { cpo.stuck = true; stuck.push(Object.assign({ el: el(), line: ls.lines.find((l) => l.indexOf("->127.0.0.1:" + cpo.port) >= 0) }, cpo)); say("STUCK socket " + JSON.stringify(cpo)); }
  }
  const s = { t: +el().toFixed(1), tag, rss_kb: rss, cpu_pct: cpuPct, load1: +os.loadavg()[0].toFixed(1), soak_lag_ms: lagMax,  sock: { total: ls.total, listen: ls.listen, est: ls.est, other: ls.other, nonloop: ls.nonloop.length },
    stats: lastStats ? { phase: lastStats.phase, players: lastStats.players, ents: lastStats.ents, by_kind: lastStats.ents_by_kind || lastStats.by_kind, tick_max_ms: lastStats.tick_max_ms, timers: lastStats.timers, plug: lastStats.plug, at: lastStats.el } : null,
    tick: LOGS.tick.length ? LOGS.tick[LOGS.tick.length - 1] : null, phase: LOGS.biome.length ? LOGS.biome[LOGS.biome.length - 1].to : 1,
    bots: BOTS.map((b) => b.summary()), vis_viol: visViol.length, vis_checks: visChecks, proof: proofProc ? proofs[proofs.length - 1].n : null };
  if (ls.nonloop.length) { s.nonloop_lines = ls.nonloop; say("NONLOOPBACK " + ls.nonloop.join(" | ")); }
  lagMax = 0;
  samples.push(s); out("metrics.jsonl", s);
  return s;
}

// ------------------------------------------------------------ evaluation
const median = (l) => { const v = l.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
function evaluate(final) {
  const C = [];
  const add = (name, ok, ev) => C.push({ name, ok: !!ok, ev });
  const durS = DUR / 1000;
  // 1 log errors
  add("server log: no world_err / plugin_err / uncaught / unhandled", LOGS.bad.length === 0,
    { count: LOGS.bad.length, by_kind: Object.fromEntries([...BAD_KINDS].map((k) => [k, LOGS.kinds[k] || 0])), first: LOGS.bad.slice(0, 6), info_kinds: Object.fromEntries([...INFO_KINDS].map((k) => [k, LOGS.kinds[k] || 0]).filter((x) => x[1])), info_first: LOGS.info.slice(0, 6), server_exit: serverExit });
  // 2 sockets
  const win = (a, b) => samples.filter((s) => s.t >= a && s.t < b && s.tag === "run");
  const early = win(180, 480), late = win(durS - 300, durS + 1);
  const eMax = Math.max(0, ...early.map((s) => s.sock.total)), lMax = Math.max(0, ...late.map((s) => s.sock.total));
  const checked = closedPorts.filter((c) => c.checked).length;
  const sockOk = stuck.length === 0 && final && final.sock.total <= final.sock.listen && lMax <= eMax * 1.5 + 6;
  add("sockets: none stuck 10 s after a close, count bounded, none left after shutdown", sockOk,
    { closes_checked: checked, closes_total: closedPorts.length, stuck: stuck.slice(0, 10), early_max: eMax, late_max: lMax, max_any: Math.max(0, ...samples.map((s) => s.sock.total)),
      final_after_all_closed: final ? final.sock : null, final_lines: final ? final.lines : null });
  // 3 visibility
  const pr = proofs.map((p) => { let r = null; try { r = JSON.parse(fs.readFileSync(path.join(p.dir, "report.json"), "utf8")); } catch (e) { } return { p, r }; });
  const st = (r, n) => { const x = r && r.steps.find((s) => s.step === n); return x ? x.ok : null; };
  const brVis = pr.map(({ p, r }) => ({ n: p.n, code: p.code, B_sees_A_create: st(r, "B_sees_A_create"), B_sees_A_move: st(r, "B_sees_A_move"), both_joined: st(r, "both_joined"), B_hp_drops: st(r, "B_hp_drops") }));
  const brOk = A["no-browsers"] ? true : brVis.length > 0 && brVis.every((v) => v.B_sees_A_create === true && v.B_sees_A_move === true);
  add("visibility: every bot in another bot's 1370x933 box for 2 s was created in its view; browser B sees A in every proof run", visViol.length === 0 && visChecks > 100 && brOk,
    { bot_pair_checks: visChecks, violations: visViol.length, first: visViol.slice(0, 8), margin: MARGIN, browsers: brVis });
  // 3b client exceptions (bin/hosted_proof.py injects window.__errs / __mimErr and reads them before closing)
  const cex = pr.map(({ p, r }) => { const x = r && r.steps.find((q) => q.step === "no_client_exceptions"); return { n: p.n, ok: x ? x.ok : null, ev: x ? x.evidence : null }; });
  add("browsers: no client exception in any proof run (window.__errs, uncaught after join)", A["no-browsers"] ? true : cex.length > 0 && cex.every((x) => x.ok === true), { runs: cex });
  // 4 entity leak
  const nearSwitch = (t) => LOGS.biome.some((b) => t >= b.el - 1 && t < b.el + 8);
  const st5 = (a, b) => LOGS.stats.filter((s) => s.el >= a && s.el < b && !nearSwitch(s.el));
  let leak = [], method;
  const kindsOf = (s) => s.ents_by_kind || s.by_kind;
  if (LOGS.stats.length && kindsOf(LOGS.stats[0])) {
    method = "stats lines (per kind; phase-bound kinds compared per phase)";
    const E = st5(180, 480), Lt = st5(durS - 300, durS + 1);
    const kinds = new Set([].concat(...LOGS.stats.map((s) => Object.keys(kindsOf(s) || {}))));
    const PHASED = new Set(["static", "animal"]);
    for (const k of kinds) {
      if (PHASED.has(k)) {
        for (const ph of new Set(E.map((s) => s.phase))) {
          const e = E.filter((s) => s.phase === ph).map((s) => (kindsOf(s) || {})[k] || 0), l = Lt.filter((s) => s.phase === ph).map((s) => (kindsOf(s) || {})[k] || 0);
          if (!e.length || !l.length) continue;
          const em = Math.max(...e), lm = Math.max(...l);
          leak.push({ kind: k, phase: ph, early_max: em, late_max: lm, ok: lm <= em * 1.1 + 30 });
        }
      } else {
        const em = Math.max(0, ...E.map((s) => (kindsOf(s) || {})[k] || 0)), lm = Math.max(0, ...Lt.map((s) => (kindsOf(s) || {})[k] || 0));
        leak.push({ kind: k, early_max: em, late_max: lm, ok: lm <= em * 1.3 + 15 });
      }
    }
    const et = Math.max(0, ...E.map((s) => s.timers || 0)), lt = Math.max(0, ...Lt.map((s) => s.timers || 0));
    if (E.some((s) => s.timers != null)) leak.push({ kind: "world.timers", early_max: et, late_max: lt, ok: lt <= et * 1.5 + 50 });
    // plugin state sizes: stale_* always 0, social ps tracks players, other sizes bounded early vs late (counters skipped)
    const COUNTERS = new Set(["phase", "next_clan_id", "dropped_by_rate"]);
    const PHASED_PLUG = new Set(["creatures.wild", "creatures.dying", "creatures.respawn_queue"]);
    const pv = (s, pl, k) => s.plug && s.plug[pl] && typeof s.plug[pl][k] === "number" ? s.plug[pl][k] : null;
    const pkeys = new Set();
    for (const s of LOGS.stats) for (const [pl, o] of Object.entries(s.plug || {})) for (const [k, v] of Object.entries(o || {})) if (typeof v === "number") pkeys.add(pl + "." + k);
    for (const pk of pkeys) {
      const [pl, k] = pk.split(".");
      if (COUNTERS.has(k)) continue;
      if (/^stale_/.test(k)) { const bad = LOGS.stats.filter((s) => pv(s, pl, k) > 0); leak.push({ kind: pk, nonzero_samples: bad.length, first: bad.slice(0, 3).map((s) => ({ el: s.el, v: pv(s, pl, k) })), ok: bad.length === 0 }); continue; }
      if (PHASED_PLUG.has(pk)) {
        for (const ph of new Set(E.map((s) => s.phase))) {
          const e = E.filter((s) => s.phase === ph).map((s) => pv(s, pl, k) || 0), l = Lt.filter((s) => s.phase === ph).map((s) => pv(s, pl, k) || 0);
          if (!e.length || !l.length) continue;
          const em = Math.max(...e), lm = Math.max(...l);
          leak.push({ kind: pk, phase: ph, early_max: em, late_max: lm, ok: lm <= em * 1.1 + 30 });
        }
        continue;
      }
      const em = Math.max(0, ...E.map((s) => pv(s, pl, k) || 0)), lm = Math.max(0, ...Lt.map((s) => pv(s, pl, k) || 0));
      leak.push({ kind: pk, early_max: em, late_max: lm, ok: lm <= em * 1.3 + 15 });
    }
    if (pkeys.has("social.ps")) {
      const d = LOGS.stats.map((s) => ({ el: s.el, d: (pv(s, "social", "ps") || 0) - (s.players || 0) })).filter((x) => x.d > 2);
      leak.push({ kind: "social.ps - players", over2_samples: d.length, first: d.slice(0, 3), ok: d.length === 0 });
    }
  } else {
    method = "tick_stats total entity count per phase (no stats line in the server log)";
    const phaseAt = (t) => { let p = 1; for (const b of LOGS.biome) if (b.el <= t) p = b.to; return p; };
    const E = LOGS.tick.filter((s) => s.el >= 180 && s.el < 480), Lt = LOGS.tick.filter((s) => s.el >= durS - 300);
    for (const ph of new Set(E.map((s) => phaseAt(s.el)))) {
      const e = E.filter((s) => phaseAt(s.el) === ph).map((s) => s.ents), l = Lt.filter((s) => phaseAt(s.el) === ph).map((s) => s.ents);
      if (!e.length || !l.length) continue;
      leak.push({ kind: "all", phase: ph, early_max: Math.max(...e), late_max: Math.max(...l), ok: Math.max(...l) <= Math.max(...e) * 1.1 + 40 });
    }
  }
  // after every player left: no per-player state may remain
  const endS = LOGS.stats.filter((s) => s.el > durS && s.players === 0 && !nearSwitch(s.el)).pop();
  const ZERO = ["ents_by_kind.player", "ents_by_kind.pet", "creatures.pets", "creatures.by_owner", "creatures.owners_with_pets", "creatures.prev_held", "creatures.riding", "creatures.calm_entries",
    "social.ps", "social.members", "social.pending_requests", "social.clans", "social.rate_limiter_entries", "social.last_ask_entries"];
  let zero = null;
  if (endS) {
    zero = {};
    for (const z of ZERO) { const [a, k] = z.split("."); const o = a === "ents_by_kind" ? kindsOf(endS) : endS.plug && endS.plug[a]; if (o && o[k] != null) zero[z] = o[k]; }
    leak.push({ kind: "per-player state with 0 players (stats at " + endS.el + " s)", values: zero, ok: Object.values(zero).every((v) => v === 0) });
  }
  add("entities: per kind bounded (minutes 3..8 vs last 5), no per-player state left with 0 players", leak.length > 0 && leak.every((x) => x.ok), { method, compared: leak });
  // 5 RSS
  const r3 = median(win(180, 240).map((s) => s.rss_kb)), rEnd = median(win(durS - 60, durS + 1).map((s) => s.rss_kb));
  const rMax = Math.max(0, ...samples.map((s) => s.rss_kb || 0));
  add("server RSS growth under 30% from minute 3 to the end", r3 && rEnd && rEnd <= r3 * 1.3, { rss_min3_kb: r3, rss_end_kb: rEnd, growth_pct: r3 && rEnd ? +((rEnd / r3 - 1) * 100).toFixed(1) : null, rss_max_kb: rMax });
  // 6 tick
  const tm = LOGS.stats.map((s) => s.tick_max_ms).filter((x) => x != null).concat(LOGS.tick.map((s) => s.max_ms));
  const over = LOGS.stats.filter((s) => s.tick_max_ms > 50).map((s) => ({ el: s.el, tick_max_ms: s.tick_max_ms, phase: s.phase })).concat(LOGS.tick.filter((s) => s.max_ms > 50).map((s) => ({ el: s.el, max_ms: s.max_ms, ents: s.ents })));
  const near = (t) => { let b = null; for (const s of samples) if (!b || Math.abs(s.t - t) < Math.abs(b.t - t)) b = s; return b ? { load1: b.load1, server_cpu_pct: b.cpu_pct, soak_lag_ms: b.soak_lag_ms } : null; };
  for (const o of over) o.host = near(o.el);
  add("no tick over 50 ms", tm.length > 0 && over.length === 0, { load1_max: Math.max(0, ...samples.map((s) => s.load1 || 0)), load1_median: median(samples.map((s) => s.load1)), cpus: os.cpus().length, windows: tm.length, max_ms: Math.max(0, ...tm), over: over.slice(0, 10), source: LOGS.stats.length ? "stats + tick_stats" : "tick_stats (60 s windows)" });
  // 7 outbound
  const hosts = {}; let nreq = 0;
  for (const { p, r } of pr) if (r) for (const [tag, b] of Object.entries(r.browsers || {})) {
    for (const [h, n] of Object.entries(b.hosts || {})) hosts[h] = (hosts[h] || 0) + n;
    for (const q of b.requests || []) { nreq++; out("browser_requests.jsonl", { proof: p.n, browser: tag, url: q.url, kind: q.kind, status: q.status, fail: q.fail }); }
  }
  const offHosts = Object.keys(hosts).filter((h) => h !== HOST);
  const nonloop = samples.filter((s) => s.sock.nonloop).map((s) => ({ t: s.t, lines: s.nonloop_lines }));
  const prSock = pr.map(({ p, r }) => ({ n: p.n, only_allowed_hosts: st(r, "only_allowed_hosts"), chrome: st(r, "no_nonloopback_sockets_chrome"), server: st(r, "no_nonloopback_sockets_server"), nav: st(r, "no_offorigin_navigation_or_popup") }));
  const prBad = prSock.filter((x) => x.only_allowed_hosts === false || x.chrome === false || x.server === false || x.nav === false);
  add("no outbound or off-origin attempt", LOGS.outbound.length === 0 && offHosts.length === 0 && nonloop.length === 0 && prBad.length === 0,
    { outbound_blocked: LOGS.outbound.slice(0, 6), browser_requests: nreq, browser_hosts: hosts, off_hosts: offHosts, lsof_nonloopback: nonloop.slice(0, 5), proof_socket_steps: prSock });
  // 8 phases
  const sw = LOGS.biome.map((b) => b.from + "->" + b.to), need = ["1->2", "2->3", "3->4", "4->5", "5->0", "0->1"];
  add("all 6 phase switches happened", need.every((x) => sw.includes(x)), { switches: LOGS.biome.map((b) => ({ el: b.el, from: b.from, to: b.to, created: b.created, old: b.old })), phase_ms: PHASE_MS });
  return C;
}
function report(C) {
  const pass = C.every((c) => c.ok);
  const acts = {}; for (const b of BOTS) for (const [k, v] of Object.entries(b.act)) acts[k] = (acts[k] || 0) + v;
  const L = ["# Soak report " + TS, "", "Result: **" + (pass ? "PASS" : "FAIL") + "**", "",
    "Server: node mimic/hosted_server.js --port " + PORT + " --mode multi, world world_sp5.json, test config " + path.relative(ROOT, path.join(OUT, "hosted_config.json")) + " (biome_ms_override " + PHASE_MS + "), env TIO_CREATURES_TEST=1 TIO_STATS_MS. " +
    "Duration " + (DUR / 60000).toFixed(1) + " min, " + NBOTS + " bots, " + proofs.length + " browser proof runs, " + samples.length + " samples.", "",
    "| condition | result |", "|---|---|"];
  for (const c of C) L.push("| " + c.name + " | " + (c.ok ? "PASS" : "FAIL") + " |");
  L.push("", "## Evidence", "");
  for (const c of C) { L.push("### " + (c.ok ? "PASS" : "FAIL") + ": " + c.name, "", "```", JSON.stringify(c.ev, null, 1).slice(0, 6000), "```", ""); }
  L.push("## Activity", "", "Bot action counts: `" + JSON.stringify(acts) + "`", "",
    "Server log: joins " + LOGS.joins + ", deaths " + LOGS.deaths + ", places " + LOGS.place + ", chats " + LOGS.chat + ", clan " + JSON.stringify(LOGS.clan), "",
    "Server log kinds: `" + JSON.stringify(LOGS.kinds) + "`", "",
    "Proof runs: " + proofs.map((p) => p.n + " exit " + p.code + " (" + (p.end - p.start).toFixed(0) + " s)").join(", "), "",
    "Bot errors: `" + JSON.stringify(BOTS.map((b) => b.errors.slice(0, 3))) + "`", "");
  for (const p of proofs) {
    try { const r = JSON.parse(fs.readFileSync(path.join(p.dir, "report.json"), "utf8")); const f = r.steps.filter((s) => !s.ok).map((s) => s.step); L.push("- proof " + p.n + ": " + (f.length ? "failed steps (informational unless listed above): " + f.join(", ") : "all steps ok")); } catch (e) { L.push("- proof " + p.n + ": no report.json"); }
  }
  const md = L.join("\n") + "\n";
  fs.writeFileSync(path.join(OUT, "report.md"), md.replace(/[\u2013\u2014]/g, "-"));
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ts: TS, pass, conditions: C, acts, proofs, kinds: LOGS.kinds }, null, 1));
  return pass;
}

// ------------------------------------------------------------ main
(async () => {
  say("out " + OUT);
  startServer();
  let up = false;
  for (let i = 0; i < 150 && !serverExit; i++) { if (await portOpen()) { up = true; break; } await sleep(200); }
  if (!up) { say("server did not come up"); process.exit(3); }
  await sleep(1500);
  for (let i = 0; i < NBOTS; i++) BOTS.push(new Bot(i));
  const pumpT = setInterval(() => { for (const b of BOTS) b.pump(); }, 40);
  const visT = setInterval(visCheck, 500);
  BOTS.forEach((b, i) => setTimeout(() => b.loop(), i * 700));
  const browsers = A["no-browsers"] ? Promise.resolve() : (async () => { await sleep(15000); await proofLoop(); })();
  const monT = setInterval(() => { try { sampleNow("run"); } catch (e) { say("monitor err " + e.message); } }, SAMPLE);
  const progT = setInterval(() => { const s = samples[samples.length - 1]; if (s) say("rss " + s.rss_kb + " sock " + s.sock.total + " ents " + (s.stats ? s.stats.ents : s.tick && s.tick.ents) + " phase " + s.phase + " alive " + BOTS.filter((b) => b.alive).length + " vis " + visChecks + "/" + visViol.length + " bad " + LOGS.bad.length); }, 60000);
  while (Date.now() - T0 < DUR && !serverExit) await sleep(1000);
  say("duration reached, stopping bots");
  running = false;
  for (const b of BOTS) { b.setKeys(new Set()); b.close("end"); }
  clearInterval(visT);
  if (proofProc) say("waiting for the running proof");
  const wEnd = Date.now() + 480000;
  while (proofProc && Date.now() < wEnd) await sleep(1000);
  if (proofProc) { say("proof still running, sending SIGINT"); try { proofProc.kill("SIGINT"); } catch (e) { } await sleep(10000); }
  await browsers.catch(() => { });
  await sleep(15000);   // > 10 s after the last close and the HTTP keep-alive timeout
  clearInterval(monT); clearInterval(progT); clearInterval(pumpT);
  sampleNow("end");
  let final = null;
  if (server && !serverExit) { const ls = lsof(server.pid); final = { sock: { total: ls.total, listen: ls.listen, est: ls.est, other: ls.other }, lines: ls.lines }; }
  for (const cpo of closedPorts) if (!cpo.checked && final && Date.now() - cpo.t >= 10000) { cpo.checked = true; if (final.lines.some((l) => l.indexOf("->127.0.0.1:" + cpo.port) >= 0)) { cpo.stuck = true; stuck.push(cpo); } }
  for (const b of BOTS) out("bots.jsonl", Object.assign(b.summary(), { act: b.act, errors: b.errors }));
  if (server && !serverExit) { server.kill("SIGTERM"); for (let i = 0; i < 50 && !serverExit; i++) await sleep(100); if (!serverExit) server.kill("SIGKILL"); }
  await sleep(300); readLog();
  const C = evaluate(final);
  const pass = report(C);
  say((pass ? "PASS" : "FAIL") + " report " + path.join(OUT, "report.md"));
  for (const c of C) console.log((c.ok ? "PASS " : "FAIL ") + c.name);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); try { if (server && !serverExit) server.kill("SIGTERM"); } catch (x) { } process.exit(4); });
process.on("SIGINT", () => { try { if (server && !serverExit) server.kill("SIGTERM"); } catch (e) { } try { if (proofProc) proofProc.kill("SIGINT"); } catch (e) { } process.exit(130); });
