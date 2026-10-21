#!/usr/bin/env node
// Hosted taming mimic: the mirrored client and the local game server on one plain HTTP port, meant to sit
// behind a TLS reverse proxy (X-Forwarded-Proto / X-Forwarded-For / Host). Everything is same-origin:
//  /                    mirror of taming.invalid (index.html gets the URL shim, see hosted/rewrite.js)
//  /_h/<sub>/...        <sub>.taming.invalid (account, token, <region><k> game hosts); WebSocket upgrades here
//  /_dead/..., /blocked  third-party hosts and off-origin links: a local "link disabled offline" page
//  /list                our rooms, encrypted the way the client decrypts it
// Nothing here opens outbound connections.
// Usage: node hosted_server.js [--port 8920] [--bind 127.0.0.1] [--hconfig hosted_config.json]
//        [--logdir ../logs/hosted] [--mirror ../mirror] [--mode single] [--world world_atl4.json]
//        [--selftest-outbound]   try every blocked outbound API, exit 0 only if all threw
// Env: PORT, BIND, LOG_DIR, MIRROR, HOSTED_CONFIG, WORLD, IP_HASH_SALT
"use strict";
const NO = require("./hosted/no_outbound");
const crypto = require("crypto"), fs = require("fs"), http = require("http"), path = require("path"), zlib = require("zlib");

const D = __dirname, PKG = path.dirname(D);
const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[String(process.argv[i]).replace(/^--/, "")] = process.argv[i + 1];
const CFG_PATH = A.hconfig || process.env.HOSTED_CONFIG || path.join(D, "hosted_config.json");
let HC = {};
try { HC = JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); } catch (e) { console.error("config " + CFG_PATH + ": " + e.message); }
const PORT = +(A.port || process.env.PORT || HC.port || 8920);
const BIND = A.bind || process.env.BIND || HC.bind || "127.0.0.1";
const LOG_DIR = path.resolve(A.logdir || process.env.LOG_DIR || path.join(PKG, "logs", "hosted"));
const MIRROR = path.resolve(A.mirror || process.env.MIRROR || path.join(PKG, "mirror"));
const MODE = A.mode || process.env.MODE || HC.mode || "single";   // single: v0.1 game per socket; multi: shared rooms
const LIM = Object.assign({ max_players_per_room: 40, max_sockets_per_ip: 8, max_sockets_per_local: 16, afk_ms: 15 * 60 * 1000, max_ws_buffer: 256 * 1024,
  max_rx_frames_per_s: 120, max_rx_bytes_per_s: 128 * 1024, max_backlog_bytes: 4 * 1024 * 1024, max_body_bytes: 64 * 1024,
  ping_ms: 10 * 1000, dead_ms: 30 * 1000 }, HC.limits || {});
const ROOMS = HC.rooms || [{ region: "offline", id: 1 }, { region: "offline", id: 2 }];
// VERSION at the package root ("0.3.0 <shortcommit>", written by the release/deploy); else the checkout's HEAD
// commit read from .git (no git process), else "dev"
function readVersion() {
  try { const v = fs.readFileSync(path.join(PKG, "VERSION"), "utf8").trim().split(/\s+/); if (v[0]) return { v: v[0], c: v[1] || "" }; } catch (e) { }
  try {
    const g = path.join(PKG, ".git");
    let h = fs.readFileSync(path.join(g, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(\S+)$/.exec(h);
    if (ref) {
      try { h = fs.readFileSync(path.join(g, ref[1]), "utf8").trim(); }
      catch (e) { const m = fs.readFileSync(path.join(g, "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(" " + ref[1])); h = m ? m.split(" ")[0] : ""; }
    }
    if (/^[0-9a-f]{7,40}$/.test(h)) return { v: "dev", c: h.slice(0, 7) };
  } catch (e) { }
  return { v: "dev", c: "" };
}
const VER = readVersion();
// game HTML clears the browser's HTTP cache once per build per browser (stale files from older builds); storage is kept
const BUILD_ID = (VER.v + "-" + VER.c).replace(/[^A-Za-z0-9._-]/g, "");
function buildCookie(req, o, h) {
  const m = /(?:^|;\s*)tio_build=([^;]*)/.exec(req.headers.cookie || "");
  if (m && m[1] === BUILD_ID) return;
  h["Clear-Site-Data"] = "\"cache\"";
  h["Set-Cookie"] = "tio_build=" + BUILD_ID + "; Path=/; Max-Age=31536000; SameSite=Lax" + (/^https:/.test(o.origin) ? "; Secure" : "");
}
for (const k of ["v", "c"]) VER[k] = String(VER[k]).replace(/[^\w.+-]/g, "").slice(0, 40);
const VER_TEXT = (/^\d/.test(VER.v) ? "v" + VER.v : VER.v) + (VER.c ? " (" + VER.c + ")" : "");
process.env.TIO_VER_TEXT = VER_TEXT;   // /version in chat (world.js)
const TITLE = "Taming Offline " + VER_TEXT;

// mimic_server.js reads its own flags from argv: hand it the mirror, keep its default game config
const WORLD_FILE = path.resolve(D, A.world || process.env.WORLD || HC.world || "world_atl4.json");   // world objects, setup/join messages
process.argv = [process.argv[0], path.join(D, "mimic_server.js"), "--mirror", MIRROR, "--world", WORLD_FILE];
const { makeLog, ipHash } = require("./hosted/log");
const L = makeLog(LOG_DIR);
NO.setLogger(L);
const M = require("./mimic_server");
M.setLogger(L);
const RW = require("./hosted/rewrite");
const CHAT = require("./hosted/chatpanel");
const PROFILE = require("./hosted/profile");
const ACCOUNT = require("./hosted/account");
const CIDS = new Map();   // page cid -> latest game socket session (chat log stream)
const HD = require("./hosted/harden");
const CR = require("./hosted/crypto");
const WORLDS = new Map();
if (MODE === "multi") {
  const W = require("./hosted/world"), { gameConfig } = require("./hosted/game_config");
  let NAMES = [];
  try { NAMES = JSON.parse(fs.readFileSync(path.join(PKG, "decoder", "names.json"), "utf8")); } catch (e) { L({ k: "names_missing", err: e.message }); }
  const ctx = { M, WORLD: M.WORLD, ITEMS: M.ITEMS, NAMES, game: gameConfig(HC.game), log: L, join: {} };
  // one_world (default): every listed room is the same world, so players always meet
  const ONE = HC.one_world === false ? null : new W.World(ROOMS[0].region + ROOMS[0].id, Object.assign({}, ctx, { index: 0 }));
  ROOMS.forEach((r, i) => WORLDS.set(r.region + r.id, ONE || new W.World(r.region + r.id, Object.assign({}, ctx, { index: i }))));
  WORLDS.Player = W.Player;
} else if (MODE !== "single") { console.error("unknown mode " + MODE); process.exit(2); }

process.on("uncaughtException", (e) => { L({ k: "uncaught", err: String(e && e.stack || e).slice(0, 800) }); });
process.on("unhandledRejection", (e) => { L({ k: "unhandled", err: String(e && e.stack || e).slice(0, 800) }); });

// ---------------------------------------------------------------- compressed, ETagged bodies
// entry {raw, gz, br, tag}: compressed once, ETag = content hash + encoding suffix (strong ETags differ per encoding)
function digest(b) { return crypto.createHash("sha1").update(b).digest("base64url").slice(0, 22); }
function brOpts(n) {
  return { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: n } };
}
function pack(raw) { return { raw, gz: zlib.gzipSync(raw, { level: 9 }), br: null, tag: digest(raw) }; }
const INVENTED = {};
if (process.env.TIO_BOSS_PETS !== "0") {
  for (const f of ["override.json", "menu.json"]) {   // menu.json: the menu picker / pet slot art by species key
    try {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(D, "invented", f), "utf8"))))
        if (/^\/img\/[\w\/.-]+\.png$/.test(k) && !/\.\./.test(v)) INVENTED[k] = pack(fs.readFileSync(path.join(D, v)));
    } catch (e) { console.error("invented art " + f + ": " + e.message); }
  }
}
// placeholder art (world boss parts not mirrored yet): served instead of the blank pixel, so a real mirrored file wins
const PLACEHOLDER = {};
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(D, "invented", "placeholder.json"), "utf8")).map || {}))
    if (/^\/img\/[\w\/.-]+\.png$/.test(k) && !/\.\./.test(v)) PLACEHOLDER[k] = pack(fs.readFileSync(path.join(D, v)));
} catch (e) { console.error("placeholder art: " + e.message); }
function accepts(req, enc) {
  for (const part of String(req.headers["accept-encoding"] || "").toLowerCase().split(",")) {
    const [name, ...ps] = part.split(";").map((x) => x.trim());
    if (name !== enc) continue;
    const q = ps.map((x) => /^q\s*=\s*([0-9.]+)$/.exec(x)).find(Boolean);
    return !q || +q[1] > 0;
  }
  return false;
}
function notModified(req, etag) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const inm = req.headers["if-none-match"];
  if (!inm) return false;
  return String(inm).split(",").some((t) => { t = t.trim().replace(/^W\//, ""); return t === etag || t === "*"; });
}
// cache: Cache-Control value; byOrigin: the body embeds the request origin (Host + X-Forwarded-Proto)
function serve(req, res, o, type, e, cache, byOrigin) {
  let enc = null, b = e.raw;
  if (e.gz) {
    if (accepts(req, "br") && (e.br || !e.brAsync)) { enc = "br"; b = e.br || (e.br = zlib.brotliCompressSync(e.raw, brOpts(e.raw.length))); }
    else if (accepts(req, "gzip")) { enc = "gzip"; b = e.gz; }
  }
  const h = Object.assign(HD.headers(o), { "Cache-Control": cache });
  const vary = (byOrigin ? ["Host", "X-Forwarded-Proto"] : []).concat(e.gz ? ["Accept-Encoding"] : []);
  if (vary.length) h["Vary"] = vary.join(", ");
  if (/^text\/html/.test(type)) buildCookie(req, o, h);
  if (!/no-store/.test(cache)) {
    h["ETag"] = "\"" + e.tag + (enc === "br" ? "-br" : enc === "gzip" ? "-gz" : "") + "\"";
    if (notModified(req, h["ETag"])) { res.writeHead(304, h); return res.end(); }
  }
  h["Content-Type"] = type;
  if (enc) h["Content-Encoding"] = enc;
  h["Content-Length"] = b.length;
  res.writeHead(200, h);
  res.end(req.method === "HEAD" ? undefined : b);
}

// ---------------------------------------------------------------- bundle
// three in-memory patches of game_mimic.js (identifiers are the bundle's own, written as \u escapes):
//  1. the per-server type/field shuffle is seeded from region+id in function SEED_FN; pin it to "atlanta4" so every
//     room keeps the Atlanta#4 tables codec.js and the mimic constants are built on
//  2. the game socket constructor is taken from a fresh iframe (WS_CTOR), which skips the page's WebSocket wrapper
//     that maps *.taming.invalid hosts to this origin; use window.WebSocket instead
//  3. the default room is picked as region.l[1 + random(len - 1)] (DEF_ROOM), never l[0]: with one listed room that is
//     undefined and the menu never gets a server, so Play does nothing; take l[0] when the region has one room
const SEED_FN = "function ㅤ︇ㅤ‌ﾠ(ᅟ︁︂){";
const WS_CTOR = /const ㅤ‌ﾠ️︅=\([^;]*;/g;
const DEF_ROOM = /\[0x1\+Math\.floor\(Math\.random\(\)\*\(([^()+-]+)-([^()+-]+)\)\)\]\[0\]/g;
function loadBundle() {
  let s = fs.readFileSync(path.join(D, "game_mimic.js"), "utf8");
  if (s.split(SEED_FN).length !== 2) throw new Error("bundle: seed function not found exactly once");
  s = s.replace(SEED_FN, SEED_FN + "ᅟ︁︂=\"atlanta4\";");
  if ((s.match(WS_CTOR) || []).length !== 1) throw new Error("bundle: socket constructor not found exactly once");
  s = s.replace(WS_CTOR, "const ㅤ‌ﾠ️︅=window.WebSocket;");
  if ((s.match(DEF_ROOM) || []).length !== 1) throw new Error("bundle: default room pick not found exactly once");
  s = s.replace(DEF_ROOM, "[$1>1?0x1+Math.floor(Math.random()*($1-$2)):0][0]");
  // ---- invented boss pets (IMPL-CREATURES): own name, skill, description, icon id and reload for species slots 13 / 39
  if (process.env.TIO_BOSS_PETS !== "0") {
    try {
      const IP = JSON.parse(fs.readFileSync(path.join(D, "invented", "client_patch.json"), "utf8"));
      if (IP.patches.every((q) => s.split(q.find).length === 2)) for (const q of IP.patches) s = s.replace(q.find, () => q.replace);
      else L({ k: "invented_patch_skip", why: "a find string is not exactly once in the bundle" });
    } catch (e) { L({ k: "invented_patch_skip", why: e.message }); }
  }
  // ---- end invented boss pets
  // ---- local account: golden apples never drain (hosted/account_patch.json, same find-once rule)
  try {
    const AP = JSON.parse(fs.readFileSync(path.join(D, "hosted", "account_patch.json"), "utf8"));
    if (AP.patches.every((q) => s.split(q.find).length === 2)) for (const q of AP.patches) s = s.replace(q.find, () => q.replace);
    else L({ k: "account_patch_skip", why: "a find string is not exactly once in the bundle" });
  } catch (e) { L({ k: "account_patch_skip", why: e.message }); }
  s = RW.rewriteBundle(s);   // origin independent: one variant for every Host
  const e = pack(Buffer.from(s, "utf8"));
  e.brAsync = true;   // brotli of 27 MB takes ~2 s: built off the event loop, gzip is served until it is ready
  zlib.brotliCompress(e.raw, brOpts(e.raw.length), (err, b) => { if (err) L({ k: "bundle_br_err", err: err.message }); else e.br = b; });
  return e;
}
const BUNDLE = loadBundle();
const BUNDLE_V = BUNDLE.tag.slice(0, 10);   // cache buster on the bundle URL in served HTML

// ---------------------------------------------------------------- http helpers
const BLANKS = new Set();
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");   // 1x1 fully transparent
const BLANK_E = { raw: BLANK_PNG, tag: digest(BLANK_PNG) };
const STATIC_CACHE = "public, max-age=86400";   // bundle and mirrored assets; ETag revalidates after a day
// unmirrored /img/ pngs go to the miss log for the imagery downloader (async, on a helper machine; this server stays offline)
// owner: a miss serves the blank and is only written to missing.txt (a local file, no request) so the image session can
// fetch them later by hand; no automatic downloader runs. Off when that folder does not exist (laptop copies)
const LATE_DEFAULT = path.join(require("os").homedir(), "tio/tio_dev/laptop_pkg/tio_offline/mirror");
const MISSING_LOG = process.env.TIO_MISSING_LOG != null ? process.env.TIO_MISSING_LOG : (fs.existsSync(LATE_DEFAULT) ? path.join(LATE_DEFAULT, "missing.txt") : "");
// the repo mirror the downloader writes into (TIO_LATE_MIRROR, "" = off): its index.jsonl is read incrementally
const LATE_DIR = process.env.TIO_LATE_MIRROR != null ? process.env.TIO_LATE_MIRROR : LATE_DEFAULT;
const LATE = new Map(); let lateOff = 0, lateAt = 0;
function lateLookup(u) {
  if (!LATE_DIR || path.resolve(LATE_DIR) === MIRROR) return null;
  if (!LATE.has(u) && Date.now() - lateAt > 5000) {
    lateAt = Date.now();
    try {
      const idx = path.join(LATE_DIR, "index.jsonl"), size = fs.statSync(idx).size;
      if (size > lateOff) {   // first look reads it all, keeping only what the deployed mirror lacks
        const fd = fs.openSync(idx, "r"), buf = Buffer.alloc(size - lateOff); fs.readSync(fd, buf, 0, buf.length, lateOff); fs.closeSync(fd);
        const text = buf.toString("utf8"), end = text.lastIndexOf("\n") + 1; lateOff += Buffer.byteLength(text.slice(0, end));
        for (const line of text.slice(0, end).split("\n")) {
          let r; try { r = JSON.parse(line); } catch (e) { continue; }
          if (r && r.url && r.file && /^[0-9a-f]{40}$/.test(r.file) && !M.MIR.has(r.url)) LATE.set(r.url, Object.assign({}, r, { file: path.join(LATE_DIR, "files", r.file) }));
        }
      }
    } catch (e) { }
  }
  return LATE.get(u) || null;
}
function logMissing(u) {
  if (!MISSING_LOG || !/^https:\/\/taming\.invalid\/img\//.test(u) || /[\r\n]/.test(u)) return;
  fs.appendFile(MISSING_LOG, u + "\n", () => {});
}
function origins(req) {
  let proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto !== "https" && proto !== "http") proto = "http";
  let host = String(req.headers.host || "").toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host)) host = "127.0.0.1:" + PORT;
  return { proto, host, origin: proto + "://" + host, ws: (proto === "https" ? "wss" : "ws") + "://" + host };
}
// [ip, limit]: X-Forwarded-For first hop (a real client behind the proxy) or the peer address; a loopback peer
// without X-Forwarded-For is local admin/proof traffic and gets the larger local limit
function clientIp(req) {
  const x = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (x) return [x, LIM.max_sockets_per_ip];
  const ra = req.socket.remoteAddress || "?";
  return [ra, /^(127\.|::1$|::ffff:127\.)/.test(ra) ? LIM.max_sockets_per_local : LIM.max_sockets_per_ip];
}
// chat log stream (SSE): backlog, then live lines visible to the player behind the page's game socket
const STREAMS = new Map();
function chatStream(req, res, o, cid) {
  const s = cid && CIDS.get(cid), w = s && s.w;
  if (!w || !w.logChat) return send(req, res, o, 404, "text/plain", "no session", { "Cache-Control": "no-store" });
  const old = STREAMS.get(cid); if (old) try { old.end(); } catch (e) { }
  STREAMS.set(cid, res);
  res.writeHead(200, Object.assign(HD.headers(o), { "Content-Type": "text/event-stream; charset=UTF-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" }));
  const out = (l) => { if (w.chatVisible(l, s)) res.write("data: " + JSON.stringify({ seq: l.seq, t: l.t, name: l.name, text: l.text, team: l.team, to: l.to, k: l.k || null, hl: l.hl || null }) + "\n\n"); };
  res.write(": ok\n\n");   // flush headers at once (proxies, empty history)
  for (const l of (w.chatLog || [])) out(l);
  (w.chatSubs || (w.chatSubs = new Set())).add(out);
  const ka = setInterval(() => { try { res.write(": k\n\n"); } catch (e) { } }, 25000);
  const done = () => { clearInterval(ka); w.chatSubs.delete(out); if (STREAMS.get(cid) === res) STREAMS.delete(cid); };
  res.on("close", done); res.on("error", done);
  if (s.sock) s.sock.on("close", () => { try { res.end(); } catch (e) { } });
}
// uncached responses: body string or Buffer
function send(req, res, o, status, type, body, extra) {
  const h = Object.assign(HD.headers(o), { "Content-Type": type }, extra || {});
  let b = body == null ? Buffer.alloc(0) : body;
  if (!Buffer.isBuffer(b)) b = Buffer.from(String(b), "utf8");
  h["Content-Length"] = b.length;
  res.writeHead(status, h);
  res.end(req.method === "HEAD" ? undefined : b);
}
const TEXT = /^(text\/|application\/(json|javascript|manifest\+json))/;
// rewritten text embeds the origin: one map of built entries per origin, least recently used origin evicted first
const VARIANTS = new Map(), VARIANTS_MAX = 8;
function variant(o) {
  let v = VARIANTS.get(o.origin);
  if (v) VARIANTS.delete(o.origin);
  else {
    v = new Map();
    if (VARIANTS.size >= VARIANTS_MAX) VARIANTS.delete(VARIANTS.keys().next().value);
  }
  VARIANTS.set(o.origin, v);
  return v;
}
const binTags = new Map();   // mirror file -> content hash (mirror files never change while running)
// {type, e, text}
function mirrorBody(r, o) {
  const file = path.isAbsolute(r.file) ? r.file : path.join(MIRROR, "files", r.file);
  const type = M.ctype(r);
  if (!TEXT.test(type)) {
    const raw = fs.readFileSync(file);
    let tag = binTags.get(file);
    if (!tag) binTags.set(file, tag = digest(raw));
    return { type, e: { raw, tag } };
  }
  const v = variant(o);
  let e = v.get(file);
  if (!e) {
    let s = fs.readFileSync(file, "utf8");
    s = RW.rewriteText(s, o.origin, o.ws);
    if (/^text\/html/.test(type)) {
      s = HD.injectGuard(HD.stripDead(HD.hardenHtml(s, o.origin), o.origin), true);
      s = s.replace(/(<title\b[^>]*>)[\s\S]*?<\/title>/i, (all, open) => open + TITLE + "</title>");
      if (MODE === "multi") s = s.replace(/<\/body>/i, () => CHAT.HTML + "</body>");
      // ads, cross-promo, featured video, partners and the adblock popup: never shown offline
      s = s.replace(/<\/head>/i, () => "<meta name=\"darkreader-lock\">" + PROFILE.SEED + "<style>[id^=ccc],#cross-promo,#featured-video,#partners,#partners-box,#blo-box,.adsbygoogle,[id^=tamingio_]{display:none!important}</style><script>window.Widget=window.Widget||function(){return new Proxy({},{get:function(){return function(){};}});};</script></head>");
      s = s.replace(/(<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\/?js\/NnukiuqQ\.js)(?=["'\s>])/g, "$1?v=" + BUNDLE_V);
    } else if (/manifest/.test(r.url) && /json/.test(type)) s = HD.hardenManifest(s, o.origin);
    e = pack(Buffer.from(s, "utf8"));
    v.set(file, e);
  }
  return { type, e, text: true };
}
// room row: [id, fill 0..4, biome phase, ms left in the phase, ?, ms since the list was built, clan, clan points, ?, boss];
// the client counts "Next biome" down from row[3] - row[5]
function listBody() {
  const now = Date.now(), byRegion = new Map();
  for (const r of ROOMS) {
    if (!byRegion.has(r.region)) byRegion.set(r.region, { n: r.region, l: [], p: [[1, 0, 0, 0, 0, now, 0, 0]] });
    const n = roomCount(r.region + r.id), w = WORLDS.get(r.region + r.id);
    const fill = n ? Math.min(4, 1 + Math.floor(n * 4 / LIM.max_players_per_room)) : 0;
    byRegion.get(r.region).l.push([r.id, fill, w ? w.phase : 0, w ? w.phaseLeft(now) : 0, 0, 0, "", "0", null, 1]);
  }
  return JSON.stringify(CR.encList([...byRegion.values()]));
}

// ---------------------------------------------------------------- http
const H = http.createServer((req, res) => {
  const o = origins(req);
  try {
    let got = 0;
    req.on("data", (d) => { got += d.length; if (got > LIM.max_body_bytes) req.destroy(); });
    req.on("error", () => { });
    if (req.url.length > 4096) return send(req, res, o, 414, "text/plain", "too long");
    if (req.method === "OPTIONS") return send(req, res, o, 204, "text/plain", "");
    if (!/^(GET|HEAD|POST)$/.test(req.method)) return send(req, res, o, 405, "text/plain", "method");
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    if (p.startsWith("/_dead/") || p === "/blocked") return send(req, res, o, 200, "text/html; charset=UTF-8", HD.BLOCKED_PAGE, { "Cache-Control": "no-store" });
    let orig;
    const m = /^\/_h\/([a-z0-9-]{1,40})(\/.*)?$/i.exec(p);
    if (m) {
      const sub = m[1].toLowerCase(), rest = m[2] || "/";
      if (rest === "/ping") return send(req, res, o, 200, "text/plain", "ok", { "Cache-Control": "no-store" });
      const r = sub === "account" ? ACCOUNT.handle(rest.slice(1), u.searchParams) : null;   // the account API, mock data (hosted/account.js)
      if (r !== null) {
        if (rest !== "/tokenLogin") L({ k: "account", ep: rest.slice(1), q: u.search.replace(/([?&](mail|token)=)[^&]*/g, "$1_").slice(0, 200), r: r.length > 120 ? r.length : r });
        return send(req, res, o, 200, "text/plain; charset=UTF-8", r, { "Cache-Control": "no-store" });
      }
      orig = "https://" + sub + ".taming.invalid" + rest + u.search;
    } else {
      if (p === "/_chat/stream") return chatStream(req, res, o, u.searchParams.get("cid"));
      if (p === "/_debug/state") {   // owner: debug overlay (O) data for this browser's player
        const s = CIDS.get(u.searchParams.get("cid")), st = s && s.w && typeof s.w.debugState === "function" ? s.w.debugState(s) : { me: null };
        return send(req, res, o, 200, "application/json", JSON.stringify(st), { "Cache-Control": "no-store" });
      }
      if (p === "/version") return send(req, res, o, 200, "text/plain; charset=UTF-8", VER_TEXT + "\n", { "Cache-Control": "no-store" });
      if (p === "/list") return send(req, res, o, 200, "text/plain; charset=UTF-8", listBody(), { "Cache-Control": "no-store" });
      orig = "https://taming.invalid" + p + u.search;
    }
    if (/^https:\/\/taming\.invalid\/js\/NnukiuqQ\.js/.test(orig))
      return serve(req, res, o, "application/javascript; charset=UTF-8", BUNDLE, STATIC_CACHE, false);
    const ov = !m && INVENTED[p];   // TIO_BOSS_PETS: invented pet art replaces two unused species' sprites
    if (ov) return serve(req, res, o, "image/png", ov, STATIC_CACHE, false);
    const [r] = M.lookup(orig);
    if (r && r.file) {
      let mb = null;
      try { mb = mirrorBody(r, o); } catch (e) { }
      if (mb) {
        // HTML: revalidated on every load (origin specific, names the current bundle version), a 304 when unchanged;
        // /_h/ hosts are the game's dynamic endpoints: never stored
        const cache = m ? "no-store" : /^text\/html/.test(mb.type) ? "no-cache" : STATIC_CACHE;
        return serve(req, res, o, mb.type, mb.e, cache, mb.text);
      }
    }
    if (/\.png$/i.test(p) && lateLookup(orig)) {   // fetched by the downloader since this deploy
      let mb = null; try { mb = mirrorBody(lateLookup(orig), o); } catch (e) { }
      if (mb) return serve(req, res, o, mb.type, mb.e, "no-cache", mb.text);
    }
    if (PLACEHOLDER[p]) return serve(req, res, o, "image/png", PLACEHOLDER[p], "no-cache", false);
    if (/\.png$/i.test(p)) {   // unmirrored image: a blank pixel, logged once per path
      if (!BLANKS.has(p) && BLANKS.size < 2000) { BLANKS.add(p); L({ k: "png_blank", path: p.slice(0, 200) }); logMissing(orig); }
      return serve(req, res, o, "image/png", BLANK_E, "no-cache", false);   // asked again: the downloader may fetch it
    }
    L({ k: "http_404", path: p.slice(0, 200) });
    return send(req, res, o, 404, "text/plain", "not here");
  } catch (e) {
    L({ k: "http_err", err: String(e && e.message || e).slice(0, 300) });
    try { send(req, res, o, 500, "text/plain", "error"); } catch (x) { try { res.destroy(); } catch (y) { } }
  }
});
H.on("clientError", (e, sock) => { try { sock.destroy(); } catch (x) { } });
H.headersTimeout = 20000; H.requestTimeout = 30000; H.keepAliveTimeout = 10000;

// ---------------------------------------------------------------- websockets
const LIVE = new Set();   // {sock, s, ip, room, ...}
function roomCount(room) { let n = 0; for (const c of LIVE) if (c.room === room) n++; return n; }
function ipCount(ip) { let n = 0; for (const c of LIVE) if (c.ip === ip) n++; return n; }
function reject(sock, code, why, meta) {
  L(Object.assign({ k: "ws_reject", why }, meta || {}));
  try { sock.end("HTTP/1.1 " + code + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); } catch (e) { }
  setTimeout(() => { try { sock.destroy(); } catch (e) { } }, 1000);
}
H.on("upgrade", (req, sock) => {
  sock.on("error", () => { });
  sock.on("end", () => { try { sock.destroy(); } catch (e) { } });   // no half-open sockets
  try {
    const o = origins(req), [ip, ipLimit] = clientIp(req), iph = ipHash(ip);
    const m = /^\/_h\/([a-z0-9-]{1,40})\/([a-z]{1,30})(\d{1,4})(\?[^#]{0,512})?$/i.exec(req.url || "");
    if ((req.headers.upgrade || "").toLowerCase() !== "websocket" || !req.headers["sec-websocket-key"] || !m)
      return reject(sock, "400 Bad Request", "bad_upgrade", { iph });
    const og = req.headers.origin;
    if (og && og !== o.origin) return reject(sock, "403 Forbidden", "origin", { iph });
    const room = m[2].toLowerCase() + (+m[3]);
    if (!ROOMS.some((r) => r.region + r.id === room)) return reject(sock, "404 Not Found", "no_room", { iph, room });
    if (ipCount(ip) >= ipLimit) return reject(sock, "429 Too Many Requests", "ip_limit", { iph });
    if (roomCount(room) >= LIM.max_players_per_room) return reject(sock, "503 Service Unavailable", "room_full", { iph, room });
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
      M.wsAccept(req.headers["sec-websocket-key"]) + "\r\n\r\n");
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10000);
    const url = o.host + req.url.replace(/\?.*/, "");
    // the slot is taken here and released exactly once, when the socket is closed for any reason
    const c = { sock, s: null, ip, iph, room, opened: Date.now(), lastActive: Date.now(), lastRx: Date.now(), rxSeen: 0, pinged: Date.now(), act: 0, rx0: 0, bytes: 0, released: false };
    LIVE.add(c);
    sock.on("close", () => {
      if (c.released) return; c.released = true; LIVE.delete(c);
      L({ k: "ws_gone", n: c.s ? c.s.n : null, room, secs: Math.round((Date.now() - c.opened) / 1000), live: LIVE.size });
    });
    if (sock.destroyed) { sock.emit("close"); return; }
    const s = c.s = MODE === "multi" ? new WORLDS.Player(sock, url, WORLDS.get(room)) : new M.Session(sock, url);
    const sclose = s.close.bind(s);
    s.close = (why) => { try { sclose(why); } finally { try { sock.destroy(); } catch (e) { } } };   // session end = socket end
    L({ k: "ws_accept", n: s.n, room, iph, live: LIVE.size });
    const cid = /[?&]cid=([0-9a-f]{16})(?:&|$)/.exec(req.url || "");
    if (cid && MODE === "multi") { CIDS.set(cid[1], s); sock.on("close", () => { if (CIDS.get(cid[1]) === s) CIDS.delete(cid[1]); }); }
    const push = s.reader.push.bind(s.reader);
    s.reader.push = (d) => {
      try {
        c.bytes += d.length;
        if (s.reader.buf.length + d.length > LIM.max_ws_buffer) { L({ k: "ws_drop", n: s.n, why: "frame_size" }); return sock.destroy(); }
        push(d);
        const b = s.reader.buf;   // a partial frame that declares more than the cap is dropped now, not buffered
        if (b.length >= 2) {
          let n = b[1] & 127;
          if (n === 126 && b.length >= 4) n = b.readUInt16BE(2); else if (n === 127 && b.length >= 10) n = Number(b.readBigUInt64BE(2));
          if (n > LIM.max_ws_buffer) { L({ k: "ws_drop", n: s.n, why: "frame_size" }); return sock.destroy(); }
        }
      } catch (e) { L({ k: "ws_drop", n: s.n, why: "decode", err: String(e && e.message || e).slice(0, 200) }); sock.destroy(); }
    };
    if (s.step) {
      const step = s.step.bind(s);
      s.step = () => { try { step(); } catch (e) { L({ k: "ws_drop", n: s.n, why: "step", err: String(e && e.stack || e).slice(0, 400) }); sock.destroy(); } };
    }
  } catch (e) {
    L({ k: "ws_err", err: String(e && e.stack || e).slice(0, 400) });
    try { sock.destroy(); } catch (x) { }
  }
});

// once a second: rate caps, slow readers, AFK (input = any op but heartbeat, or a join), dead sockets (a ws ping every
// ping_ms, the browser answers with a pong; nothing at all received for dead_ms frees the slot)
setInterval(() => {
  const now = Date.now();
  for (const c of LIVE) {
    if (!c.s) continue;
    try {
      const s = c.s, st = s.stats;
      let act = s.joinedAt || 0;
      for (const k in st.ops) if (+k !== 8) act += st.ops[k];
      if (act !== c.act) { c.act = act; c.lastActive = now; }
      const why = st.rx - c.rx0 > LIM.max_rx_frames_per_s ? "rx_rate" : c.bytes > LIM.max_rx_bytes_per_s ? "rx_bytes"
        : c.sock.writableLength > LIM.max_backlog_bytes ? "slow_reader" : now - c.lastActive > LIM.afk_ms ? "afk" : now - c.lastRx > LIM.dead_ms ? "dead" : null;
      if (st.rx !== c.rxSeen) { c.rxSeen = st.rx; c.lastRx = now; }
      if (now - c.pinged >= LIM.ping_ms) { c.pinged = now; try { c.sock.write(M.wsFrame(Buffer.alloc(0), 9)); } catch (e) { } }
      c.rx0 = st.rx; c.bytes = 0;
      if (why) { L({ k: "ws_drop", n: s.n, why }); c.sock.destroy(); }
    } catch (e) { }
  }
}, 1000).unref();

H.on("error", (e) => {
  L({ k: "listen_err", err: e.message });
  console.error("hosted server: " + e.message);
  process.exit(1);
});
H.listen(PORT, BIND, () => {
  L({ k: "start", port: PORT, bind: BIND, mode: MODE, mirror: M.MIR.size, rooms: ROOMS.map((r) => r.region + r.id), bundle: BUNDLE.raw.length });
  console.log("hosted server on " + BIND + ":" + PORT + " mode " + MODE + ", " + M.MIR.size + " mirrored urls, rooms " + ROOMS.map((r) => r.region + r.id).join(","));
});
