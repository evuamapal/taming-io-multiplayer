// Account API of the offline clone: every https://account.<host>/<ep> call the client makes, answered locally with mock data
//  (hosted_server.js /_h/account/<ep>, the Pages engine http()). Nothing is fetched; unknown calls answer "0", the client's
//  "request failed" value; try / refresh return null so the caller serves the mirrored real reply. The own account is profile.js; other player ids get a believable public profile made from the id.
//  Reply formats as the client bundle reads them (decoded hex strings of the account calls in /js/NnukiuqQ.js):
//   player / pets / tamodex / potions / insectarium / achievements / inventory ?id=  ENCODED: the client runs
//     JSON.parse(F(G(text, "25512"), 2613107)) (enc below)
//     F: text[0] = d, chunks of d*2 hex digits, each XOR (key & d*2 hex digits) is one char code; chars >= "g" are noise
//   merchant  ENCODED the same way with keys "819310", 11173932
//   getFriends  [friends [id, name, status, teamPrefix, teamName], requests [id, name], recent [id, name, time, where]]
//     status 0 offline, 1 "working on the next update", 2 "playing secretly"
//   getClans  "1" when the player is in a clan (the client then asks getClan), else {name: [name, [leaderId, leaderName],
//     members, totemPoints, score]}; getClan {id, owner [id, name], members [[id, name, role, score, totems]], totems,
//     score, rank, request, tags, regions, badge, location}
//   leaderboards (rankingScore, tameScore, heroScore, petsScore, goldenAppleScore, housingScore ?page=)  rows
//     [score, name, id, rankingScore, rankingScore], the last row is rank 1
//   buyChest  pet chests [[species, 10, total]]; alchemy chest (18) [[rarity, potionId, name]]
//   cookPotion  the potion id made; buyPotion  the potion counts (inventory["1"])
"use strict";
const fs = require("fs"), path = require("path");
const PROFILE = require("./profile");

let POTIONS = [];   // [name, rarity, kind] by potion id (client _3075 list)
try { POTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "potions.json"), "utf8")); } catch (e) { }
let SPECIES = {};   // id -> name
try { for (const [k, r] of Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "creature_radius.json"), "utf8")))) SPECIES[+k] = r[0]; } catch (e) { }

// ---------------------------------------------------------------- encoding (inverse of the client's decoder)
// the client decodes JSON.parse(F(G(text, keyStr), keyNum)); G is defined in code the bundle evals at load:
//  text = hex bytes, an LCG seeded by a string hash of keyStr gives one byte k per byte, byte ^= S(k, index); F as above
const SBOX = Buffer.from("637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b27509832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16", "hex");   // the AES s-box
function mix(h) { h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16; return h >>> 0; }
function sbyte(a, b, c) {
  a &= 255; const h = mix(((c >>> 0) ^ Math.imul(b >>> 0, 2654435769)) ^ a);
  return ((SBOX[h & 255] ^ SBOX[(h >>> 8) & 255] ^ SBOX[(h >>> 16) & 255] ^ SBOX[(h >>> 24) & 255]) + (h & 255) + a) & 255;
}
const LCG_C = 0x3C6EF35F;
function encG(s, keyStr) {
  let seed = 0; for (let i = 0; i < keyStr.length; i++) seed = (seed * 31 + keyStr.charCodeAt(i)) >>> 0;
  let o = "";
  for (let i = 0; i < s.length; i++) { seed = (seed * 1664525 + LCG_C) >>> 0; o += ((s.charCodeAt(i) ^ sbyte((seed >>> 24) & 255, i, LCG_C)) & 255).toString(16).padStart(2, "0"); }
  return o;
}
function encF(s, key) {   // chunks of 4 hex digits (d = 2), so any UTF-16 code unit fits
  const k = key & 0xffff; let o = "2";
  for (let i = 0; i < s.length; i++) o += ((s.charCodeAt(i) ^ k) & 0xffff).toString(16).padStart(4, "0");
  return o;
}
function enc(obj, key, keyStr) { return encG(encF(typeof obj === "string" ? obj : JSON.stringify(obj), key), keyStr); }
const K_PLAYER = [2613107, "25512"], K_MERCHANT = [11173932, "819310"];

// ---------------------------------------------------------------- mock players
function rng(seed) { let x = (seed * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const NAMES = ["Tamer", "Wolfy", "Kiwi", "Shadow", "Luna", "Bunny", "Mochi", "Rex", "Nova", "Pixel", "Ember", "Frosty", "Bramble", "Zed", "Maple",
  "Pumpkin", "Sky", "Rocco", "Juno", "Biscuit", "Onyx", "Pip", "Sage", "Fang", "Willow", "Echo", "Taro", "Indy", "Blaze", "Clover"];
const ME = () => JSON.parse(PROFILE.body());
const NICK = {};   // id -> nickname set by changename (own id) during this server run
function nameOf(id) {
  if (id === ME().id) return NICK[id] || ME().nickname;
  const r = rng(id + 7); return NAMES[Math.floor(r() * NAMES.length)] + (r() < 0.6 ? Math.floor(r() * 999) : "");
}
function player(id) {
  const me = ME();
  if (id === me.id) {
    // owner: own pets at the invented max level 67: 5061181 = the patched client's total XP for level 67 (60: 3756241)
    const tames = me.tames, heroes = tames.map((t, sp) => [process.env.TIO_BOSS_PETS !== "0" ? 5061181 : 3756241, sp % 4]);
    return { me, tames, heroes, inv: me.inventory, nick: nameOf(id), score: me.score };
  }
  const r = rng(id), sp = Object.keys(SPECIES).map(Number);
  const tames = sp.map((s) => (s < 3 ? 50 + Math.floor(r() * 300) : r() < 0.35 ? 50 + Math.floor(r() * 400) : Math.floor(r() * 49)));
  const heroes = tames.map((t) => (t >= 50 ? [Math.floor(r() * r() * 3000000), Math.floor(r() * 3)] : [0, 0]));
  const inv = { "0": {}, "1": {} };
  POTIONS.forEach((p, i) => { if (p[2] !== "container" && r() < 0.25) inv["1"][i] = 1 + Math.floor(r() * 8); });
  for (let i = 0; i < 40; i++) if (r() < 0.3) inv["0"][i] = 1 + Math.floor(r() * 20);
  return { tames, heroes, inv, nick: nameOf(id), score: Math.floor(r() * r() * 60000000) };
}
const keys = (o) => Object.keys(o).filter((k) => o[k] > 0);
function publicProfile(id) {
  const p = player(id), now = Date.now(), r = rng(id + 3), me = p.me;
  const unlocked = p.tames.filter((t, i) => i < 3 || t >= 50).length;
  return {
    id, nickname: p.nick, now, hide: 0, hideInventory: 0, incognito: 0,
    lastSkin: me ? 0 : Math.floor(r() * 40), lastAccessory: me ? 0 : Math.floor(r() * 30), lastParticle: 0,
    score: p.score, topPlayer: me ? 0 : undefined, vip: me ? me.vip : (r() < 0.3 ? now + 86400000 * 30 : 0), exam: me ? EXAM[2] : Math.floor(r() * 101),
    bestScore: me ? me.bestScore : [...Array(10).keys()].map((i) => [Math.floor(p.score / (3 + i)), now - i * 86400000 * 2]),
    achievements: me ? 108 : Math.floor(r() * 108), tamodex: unlocked, potions: keys(p.inv["1"] || {}).length,
    insectarium: keys(p.inv["0"] || {}).length, inventory: keys(p.inv["0"] || {}).length + keys(p.inv["1"] || {}).length, pets: unlocked,
    totalSkins: me ? me.skin.length : Math.floor(r() * 80), totalAccessories: me ? me.accessory.length : Math.floor(r() * 60),
    totalParticles: me ? me.particle.length : Math.floor(r() * 20), apple: me ? me.apple : Math.floor(r() * 50000),
    totalApple: me ? me.totalApple : Math.floor(r() * 500000), lastGame: Math.floor(r() * 3600), kill: me ? me.kill : Math.floor(r() * 5000),
    death: me ? me.death : Math.floor(r() * 3000), time: me ? me.time : Math.floor(r() * 2000000), clan: (me ? CLAN.mine : r() < 0.4 && CLAN_NAMES[id % CLAN_NAMES.length]) || "", banned: 0,
  };
}
// the public tabs: tamodex / potions / insectarium list keys of "achievements", the achievements tab wants [state 2, time]
function tab(name, id) {
  const p = player(id), now = Date.now();
  if (name === "pets") return { tames: p.tames, heroes: p.heroes, petSkins: p.me ? p.me.petSkins : [] };
  if (name === "inventory") return { inventory: p.inv };
  const o = {};
  if (name === "tamodex") p.tames.forEach((t, i) => { if (i < 3 || t >= 50) o[i] = 1; });
  if (name === "potions") for (const k of keys(p.inv["1"] || {})) o[k] = 1;
  if (name === "insectarium") for (const k of keys(p.inv["0"] || {})) o[k] = 1;
  if (name === "achievements") { const r = rng(id + 5); for (let i = 0; i < 108; i++) if (p.me || r() < 0.5) o[i] = [2, now]; }
  return { achievements: o };
}

// ---------------------------------------------------------------- friends (mock list, changes kept for this server run)
const FRIENDS = new Map([[1042, 0], [2077, 2], [3311, 0], [5150, 0], [8123, 1]]);   // id -> status
const REQUESTS = new Map([[6060, 0]]);
function friendsBody() {
  return JSON.stringify([
    [...FRIENDS].map(([id, st]) => [id, nameOf(id), st, "", ""]),
    [...REQUESTS.keys()].map((id) => [id, nameOf(id)]),
    [[4444, nameOf(4444), Date.now() - 3600000 * 5, "Offline #1"]],
  ]);
}

// ---------------------------------------------------------------- clans
const CLAN_NAMES = ["WOLVES", "TAMERS", "DRAGONS", "MOCHI", "NOVA", "EMBER", "FROST", "CLOVER"];
const CLAN = { mine: "", made: {} };
function clanRow(name, i) { const r = rng(i + 101); const lid = 1000 + Math.floor(r() * 9000); return [name, [lid, nameOf(lid)], 5 + Math.floor(r() * 95), Math.floor(r() * 400) + 1, Math.floor(r() * 9000000), 1 + Math.floor(r() * 12)]; }
function clansBody() {
  const o = {};
  CLAN_NAMES.forEach((n, i) => { o[n] = clanRow(n, i); });
  for (const n of Object.keys(CLAN.made)) o[n] = clanRow(n, 50);
  return o;
}
function clanBody() {
  const name = CLAN.mine, me = ME(), i = CLAN_NAMES.indexOf(name), row = clanRow(name, i < 0 ? 50 : i), r = rng(name.length * 31 + 7);
  const own = !!CLAN.made[name];
  const members = [[me.id, nameOf(me.id), own ? 2 : 0, me.score, 0]];
  if (!own) for (let k = 0; k < Math.min(row[2], 12); k++) { const id = 1000 + Math.floor(r() * 9000); members.push([id, nameOf(id), k === 0 ? 2 : 0, Math.floor(r() * 9000000), Math.floor(r() * 30)]); }
  return { id: name, owner: own ? [me.id, nameOf(me.id)] : row[1], members, totems: [], score: own ? me.score : row[4], rank: i < 0 ? 99 : i + 1, request: [], tags: [], regions: [], badge: 0, location: 0 };
}

// ---------------------------------------------------------------- leaderboards
const BOARDS = { rankingScore: 60000000, tameScore: 155, heroScore: 15000, petsScore: 3000, goldenAppleScore: 5e9, housingScore: 500 };
function board(ep, page) {
  if (page > 2) return "[]";
  const me = ME(), top = BOARDS[ep], rows = [];
  for (let i = 0; i < 50; i++) {
    const rank = page * 50 + i, id = rank === 0 ? me.id : 100 + rank * 37, sc = rank === 0 && ep === "rankingScore" ? Math.max(me.score, top) : Math.floor(top / (1 + rank * 0.15));   // owner: #1 of the game
    rows.push([sc, nameOf(id), id, Math.floor(60000000 / (1 + rank * 0.2)), Math.floor(60000000 / (1 + rank * 0.2))]);
  }
  return JSON.stringify(rows.reverse());
}

// ---------------------------------------------------------------- chests and potions
const W = { common: 60, rare: 25, epic: 10, legendary: 4, mythic: 1 };
function alchemy() {
  const pool = POTIONS.map((p, i) => [i, p]).filter(([, p]) => p[2] === "ingredient" && p[1] === "common");   // the chest window: "1 ingredient, common 100%"
  if (!pool.length) return "0";
  let t = pool.reduce((a, [, p]) => a + (W[p[1]] || 1), 0) * Math.random(), pick = pool[0];
  for (const e of pool) { t -= W[e[1][1]] || 1; if (t <= 0) { pick = e; break; } }
  PROFILE.potion(pick[0], 1);
  return JSON.stringify([[pick[1][1], pick[0], pick[1][0]]]);
}
// cosmetic chests (wooden 0, stone 1, gold 2, special 3, event chests): [[rarity, "skin" | "accessory" | "dust", title, id]]
let CC = {}; try { CC = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cosmetic_counts.json"), "utf8")); } catch (e) { }
const RAR = ["common", "rare", "epic", "legendary", "mythic"], CHEST_CARDS = { 0: [1, 2], 1: [2, 3], 2: [3, 4], 3: [3, 4] };
function cosmetic(idx) {
  const [n, cap] = CHEST_CARDS[idx] || [3, 4], out = [];
  for (let i = 0; i < n; i++) {
    const kind = ["skin", "accessory", "dust"][Math.floor(Math.random() * 3)], max = CC[kind === "dust" ? "particle" : kind] || 1;
    let r = 0; while (r < cap && Math.random() < 0.35) r++;
    out.push([RAR[r], kind, "New " + (kind === "dust" ? "Particle" : kind[0].toUpperCase() + kind.slice(1)), Math.floor(Math.random() * max)]);
  }
  return JSON.stringify(out);
}
// cookPotion?potion=<id>&protection=<0 none, 1..4 luck potion>: the client cooking window. Recipes and difficulty stars as the
// client shows them (data/recipes.json); success by the client's rarity table (stars 1..5: 1, 0.8, 0.5, 0.25, 0.05) plus the
// luck potion's bonus (client values: Flask of Stardust 1, Repellent Ointment 0.2, Ointment of Insolent Luck 0.6, Ointment of
// Minor Luck 0.08, the order of the protection buttons); wiki: a failed potion gives an Elixir of Failure (5) or, rarely,
// an Elixir of Serendipity (6; "rarely" = 10 %, guessed). The ingredients (and the luck potion) are used either way. The
// client adds the returned potion and takes the ingredients from its own copy of the inventory; the account does the same.
let RECIPES = {};
try { RECIPES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "recipes.json"), "utf8")).recipes || {}; } catch (e) { }
const COOK_CHANCE = [0, 1, 0.8, 0.5, 0.25, 0.05], LUCK = [[0, 0], [19, 1], [20, 0.2], [46, 0.6], [48, 0.08]], SERENDIPITY = 0.1;
function cook(id, prot) {
  const R = RECIPES[id]; if (!R) return "0";
  const L = LUCK[prot] || LUCK[0], need = R.ing.slice();
  if (L[0]) need.push([1, L[0], 1]);
  if (!PROFILE.spend || !PROFILE.spend(need)) return "0";   // missing ingredients: the client's "request failed"
  const ok = Math.random() < Math.min(1, (COOK_CHANCE[R.stars] || 1) + L[1]);
  const made = ok ? id : Math.random() < SERENDIPITY ? 6 : 5;
  PROFILE.potion(made, 1);
  return String(made);
}

// ---------------------------------------------------------------- ranks, daily challenges, merchant
function ranksBody() {   // own rank per board letter [rank, value]; d / w / m: per period, per stat
  const me = ME(), per = {};
  for (const k of ["score", "kill", "time", "animal", "boss", "tame", "food", "stone", "wood", "insect", "building"]) per[k] = [1, k === "score" ? me.score : 1000];
  return { r: [1, me.score], t: [1, 155], h: [1, 15000], g: [1, me.totalApple], o: [1, 500], p: me.tames.map(() => [1, 2000000]), d: per, w: per, m: per };
}
const CHALLENGES = [[12, 14, 0], [16, 20, 2], [3, 10000, 1], [11, 41, 0], [21, 27, 2], [25, 3, 0]];   // [daily key, progress, state 0 open / 1 collect / 2 collected]
function challengeBody() { const d = new Date(), end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return { challenges: CHALLENGES, duration: end - d }; }
const SHOP = {};   // merchant stock key -> [type 0 insect / 1 potion, id, amount, price, offer end time]
function shopInit() {
  if (Object.keys(SHOP).length) return;
  const pots = POTIONS.map((p, i) => [i, p]).filter(([, p]) => p[2] === "potion");
  for (let k = 0; k < 6; k++) {
    const r = rng(k + 77);
    SHOP[k] = k < 4 && pots.length ? [1, pots[Math.floor(r() * pots.length)][0], 1 + Math.floor(r() * 3), 500 + Math.floor(r() * 40) * 100, 0] : [0, Math.floor(r() * 20), 5, 200 + Math.floor(r() * 10) * 50, 0];
  }
}
// reply fields (client merchant window, headless check with distinct counts): 0 now, 1 sell prices, 2 / 3 sell timer start /
// sells left, 4 stock, 5 / 6 buy timer start / buys left, 7 apples, 8 ok. Wiki Merchant: at most 10 of each transaction, one more comes back every hour (the client counts
// the hour from the timer start). Owner: selling did not work (sells left was always 0).
const TRADE = { buy: [Date.now(), 10], sell: [Date.now(), 10] };
// field 1: what the merchant pays per item, the client looks up price[type][id] (0 insects, 1 potions and containers, 4
// seeds). No real sell price was captured: GUESSED by rarity (potions.json) about a fifth of the merchant's buy prices
// here; insects 50 (wiki Inventory: a caught bug is worth 50 gold), the 5 ingredient items (44..48, Guardian's Heart 44)
// 500; seeds 100.
const SELL_BY_RARITY = { common: 100, rare: 250, epic: 600, legendary: 1500, mythic: 4000 };
const SELL_PRICE = [Array.from({ length: 64 }, (_, i) => (i >= 44 && i <= 48 ? 500 : 50)), POTIONS.map((p) => SELL_BY_RARITY[p[1]] || 100), null, null, Array(150).fill(100)];
function tradeLeft(k) {
  const t = TRADE[k], n = Math.floor((Date.now() - t[0]) / 3600000);
  if (n > 0) { t[1] = Math.min(10, t[1] + n); t[0] += n * 3600000; }
  if (t[1] >= 10) t[0] = Date.now();
  return t;
}
function merchantBody(ok) {
  shopInit();
  for (const it of Object.values(SHOP)) if (!(it[4] > Date.now())) it[4] = Date.now() + 2 * 3600000;   // offers renew every 2 h
  const b = tradeLeft("buy"), s = tradeLeft("sell");
  return enc([Date.now(), SELL_PRICE, s[0], s[1], SHOP, b[0], b[1], ME().apple, ok ? 1 : 0], ...K_MERCHANT);
}
function merchantBuy(key) {
  shopInit(); const it = SHOP[key], t = tradeLeft("buy");
  if (!it || t[1] <= 0) return merchantBody(0);
  if (it[0] === 1) PROFILE.potion(it[1], it[2]); else if (it[0] === 0 && PROFILE.catchInsect) for (let i = 0; i < it[2]; i++) PROFILE.catchInsect(it[1]);
  if (t[1] >= 10) t[0] = Date.now();
  t[1]--;
  return merchantBody(1);
}
// sell?price=&type=&index=&points=<count> (client): the items leave the account (insects "0" / potions "1"; other bags are
// the client's own copy only) and the price is paid in golden apples (the account's apples never run out, so the payment
// shows only as the client's bag animation). The client takes the items from its copy when field 8 is 1.
function merchantSell(q) {
  const t = tradeLeft("sell"), type = +q.get("type"), id = +q.get("index"), n = Math.max(1, Math.floor(+q.get("points") || 1));
  if (t[1] <= 0 || !Number.isInteger(id) || id < 0) return merchantBody(0);
  if ((type === 0 || type === 1) && PROFILE.spend && !PROFILE.spend([[type, id, n]])) return merchantBody(0);
  if (t[1] >= 10) t[0] = Date.now();
  t[1]--;
  return merchantBody(1);
}

// ---------------------------------------------------------------- tamers exam (mimic/data/exam.json)
let EXAM_Q = []; try { EXAM_Q = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "exam.json"), "utf8")).questions; } catch (e) { }
let EXAM = [0, 0, 0, 0];   // the profile's exam: [last time 0 = retake any time, -, best %, last %]
function examEnd(a) {
  let ans = []; try { ans = JSON.parse(a); } catch (e) { }
  const ok = EXAM_Q.filter((q, i) => ans[i] === q[2]).length, pc = EXAM_Q.length ? Math.round(ok * 100 / EXAM_Q.length) : 0;
  EXAM = [0, 0, Math.max(EXAM[2], pc), pc];
  return JSON.stringify(EXAM);
}

// ---------------------------------------------------------------- housing: the house world of a player
// reply ENCODED with keys 11 (number: G hashes nothing, seed 0) / 97: [house, inventory, flags, pets, _, _]
// house fields (client _7973): 0 ?, 1 furniture [[type, x, y, rot, id, time, data, ?]], 2 pets, 3 time, 5 owner id, ..., 13 locked
const HOUSES = {};
// furniture type ids by sprite name (mimic/data/housing_furniture.json, read from the client's house bag)
let FID = {}; try { FID = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "housing_furniture.json"), "utf8")).ids; } catch (e) { }
const F = { floor: FID["floor-planks0"] ?? 0, floorTiles: FID["floor-tiles-white0"] ?? 5, wall: FID["wall-planks"], bed: FID["red-bed"], table: FID["table"], chair: FID["chair"],
  sofa: FID["red-sofa"], lamp: FID["floor-lamp"], carpet: FID["carpet0"], plant: FID["potted-plant0"], bookshelf: FID["bookshelf"], fireplace: FID["fireplace"], jukebox: FID["jukebox"] };
function starterRoom() {
  const out = [], t = Date.now(), W = 12, H = 9, T = 125;
  let n = 1; const add = (type, x, y, rot) => { if (type !== undefined) out.push([type, x * T, y * T, rot || 0, n++, t, {}, 0]); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) add(x > 6 && y > 4 ? F.floorTiles : F.floor, x, y);
  for (let x = -1; x <= W; x++) { add(F.wall, x, -1); add(F.wall, x, H); }
  for (let y = 0; y < H; y++) { add(F.wall, -1, y); add(F.wall, W, y); }
  add(F.bed, 1, 1); add(F.table, 5, 3); add(F.chair, 4, 3); add(F.chair, 6, 3); add(F.sofa, 9, 1); add(F.lamp, 11, 0);
  add(F.carpet, 5, 5); add(F.plant, 0, 8); add(F.bookshelf, 3, 0); add(F.fireplace, 7, 0); add(F.jukebox, 11, 8);
  return out;
}
function house(id) {
  if (!HOUSES[id]) HOUSES[id] = [0, starterRoom(), [], Date.now(), 0, id, 0, 0, [], [], 0, 0, 0, 0];
  return HOUSES[id];
}
function housingBody(id) {   // inventory {type: count}: a few of every furniture so the editor can place anything
  const inv = {}; for (const t of Object.values(FID)) inv[t] = 5;
  for (const it of house(id)[1]) inv[it[0]] = (inv[it[0]] || 0) + 1;   // the placed pieces count too (else the bag shows negatives)
  return enc([house(id), inv, {}, [], 0, 0], 97, "");
}

// ---------------------------------------------------------------- dispatch
const OK = /^(sendFriend|deleteFriend|acceptFriend|declineFriend|privateMode|hide|hideInventory|incognito|hideClan|saveSkin|buyPetStats|buyPetSkin|resetPetLevel|resetPetPoints|check|state|star|claimChallenge|claimEventReward|claimLoyaltyReward|claimMobileReward|claimReferralReward|kickClanMember|acceptClanMember|declineClanMember|changeClan|createClanEvent|deleteClanEvent|joinClanEvent)$/;
// the own profile with this run's clan / nickname changes (tokenLogin and every reply that is a whole profile)
function meBody() { const b = JSON.parse(PROFILE.body()); b.exam = EXAM; if (b.loyalty === undefined) b.loyalty = 1; if (CLAN.mine) b.clan = CLAN.mine; if (NICK[b.id]) b.nickname = NICK[b.id]; return JSON.stringify(b); }
const MIRRORED = /^(try|refresh)$/;   // captured real replies in the mirror: null = let the caller serve the mirror copy
function handle(ep, q) {
  if (MIRRORED.test(ep)) return null;
  const id = Number(q.get("id"));
  switch (ep) {
    case "tokenLogin": return meBody();
    case "buyChest": { const c = q.get("chest"); return +c === 18 ? alchemy() : PROFILE.POOL && [4, 5, 7, 8, 9, 10, 23, 28].includes(+c) ? PROFILE.chest(+c) : cosmetic(+c); }
    case "buyPotion": return PROFILE.potion(+q.get("potion"), +q.get("amount") || 1);
    case "cookPotion": return cook(+q.get("potion"), +q.get("protection") || 0);
    case "player": return id > 0 ? enc(publicProfile(id), ...K_PLAYER) : "0";
    case "pets": case "tamodex": case "potions": case "insectarium": case "achievements": case "inventory":
      return id > 0 ? enc(tab(ep, id), ...K_PLAYER) : "0";
    case "getFriends": return friendsBody();
    case "sendFriend": if (id > 0) FRIENDS.set(id, 0); return "1";
    case "deleteFriend": FRIENDS.delete(id); return "1";
    case "acceptFriend": if (REQUESTS.delete(id)) FRIENDS.set(id, 0); return "1";
    case "declineFriend": REQUESTS.delete(id); return "1";
    case "getClans": return q.get("raw") ? JSON.stringify(clansBody()) : CLAN.mine ? "1" : JSON.stringify(clansBody());
    case "getClan": case "clan": return CLAN.mine || q.get("name") ? JSON.stringify(Object.assign(clanBody(), q.get("name") && q.get("name") !== CLAN.mine ? { id: q.get("name") } : {})) : "0";
    case "joinClan": CLAN.mine = (q.get("name") || "").toUpperCase(); return CLAN.mine || "0";   // accepted at once (the client shows "request sent")
    case "createClan": { const n = (q.get("name") || "").toUpperCase(); if (!n) return "0"; CLAN.made[n] = 1; CLAN.mine = n; return meBody(); }
    case "leaveClan": CLAN.mine = ""; return "1";
    case "deleteClan": delete CLAN.made[CLAN.mine]; CLAN.mine = ""; return "1";
    case "startExam": return JSON.stringify(EXAM_Q.map((q) => [q[0], q[1]]));
    case "endExam": return examEnd(q.get("answers"));
    case "housing": return housingBody(id > 0 ? id : ME().id);
    case "ranks": return enc(ranksBody(), ...K_PLAYER);
    case "challenge": return JSON.stringify(challengeBody());
    case "merchant": return merchantBody(0);
    case "buy": return merchantBuy(q.get("id"));
    case "sell": return merchantSell(q);
    case "quiz": return q.get("answer") ? "500" : "0";
    case "puzzle": return "1000";
    case "calendar": case "adventure": case "giftCode": case "reward": case "event": return meBody();
    case "buyBag": return PROFILE.potion(+q.get("bag") === 1 ? 31 : 28, +q.get("bag") === 1 ? 96 : 32);
    case "changename": { const n = (q.get("name") || q.get("nickname") || "").slice(0, 16); if (!n) return "0"; NICK[ME().id] = n; return "1"; }
  }
  if (Object.prototype.hasOwnProperty.call(BOARDS, ep)) return board(ep, +q.get("page") || 0);
  if (OK.test(ep)) return "1";
  return "0";
}

module.exports = { handle, enc };
