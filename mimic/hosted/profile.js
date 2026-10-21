// Local account for the hosted clone: every page logs in as one offline player, so the menu pet picker is unlocked.
//  The page seeds accMail/accToken in localStorage (SEED, injected into the game HTML), the client then calls
//  account /tokenLogin and reads this plain JSON. What it unlocks, as the client checks it:
//   rank = badge from the sum of the 10 best scores: 50,000,000 is the invented Fart badge (owner), 3 pet slots
//   tames[species] >= 50 unlocks a species in the picker (wolf, rabbit, bear always), a second copy of one species
//   needs 50 more per copy, so 999 lets any species fill every slot
//   id 67 (owner's choice); apple = the golden apples ("gapps") the shop and chests spend: refilled on every login and
//   every chest reply, so it never runs dry
//   buyChest (pet chests 4 / 5 and the biome chests): 3 species, +5 / +10 / +15 tames (slot 1 / 2 / 3, owner: as the real
//   game shows it), reply [[species, n, total]...]
//   as the client's pet-chest handler reads it; the tames persist for this server session
"use strict";
const fs = require("fs"), path = require("path");

const MAIL = "offline@taming.local", TOKEN = "offline";
const BADGE_SCORE = 100000000;   // the invented Fart badge (client_patch.json), every player wears it (owner)
const SPECIES = 158;   // _3134 length in this client build with the invented pets appended (155..157)
const TAMES = 999;
const ID = 67, APPLES = 999999999999;
let CC = {}; try { CC = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cosmetic_counts.json"), "utf8")); } catch (e) { }
const TAMES_NOW = new Array(SPECIES).fill(TAMES);
// cards a pet needs to be complete (wiki Animals: 150 = used thrice); 999 above stays
// for every pet (picker fully unlocked) except the mock unfinished ones: owner's example Fox 149, Polecat 144, Skunk 144
// (TIO_MOCK_TAMES='{"species": cards}' replaces them, for tests)
const MAX_CARDS = () => 150;
let MOCK = { 3: 149, 4: 144, 5: 144 };
try { if (process.env.TIO_MOCK_TAMES) MOCK = JSON.parse(process.env.TIO_MOCK_TAMES); } catch (e) { }
for (const [sp, n] of Object.entries(MOCK)) if (+sp < SPECIES) TAMES_NOW[+sp] = +n;
// chest pools by the wiki biome / type of each species (mimic/data/wiki/animals.json, names from creature_radius.json)
const POOL = { all: [], ancient: [], forest: [], winter: [], darkness: [], desert: [], sea: [], volcanic: [] };
try {
  const R = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "creature_radius.json"), "utf8"));
  const A = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "wiki", "animals.json"), "utf8"));
  const v = (x) => (x && typeof x === "object" && "value" in x ? x.value : x) || "";
  const BIOME = { forest: /^forest/i, winter: /winter|snow/i, darkness: /dark/i, desert: /desert/i, sea: /ocean|sea/i, volcanic: /volcan/i };
  for (const [k, r] of Object.entries(R)) {
    const sp = +k, w = A[r[0]]; if (!(sp < SPECIES)) continue;
    POOL.all.push(sp);
    if (!w) continue;
    if (/ancient/i.test(v(w.type))) POOL.ancient.push(sp);
    for (const [b, re] of Object.entries(BIOME)) if (re.test(v(w.biome))) POOL[b].push(sp);
  }
} catch (e) { }
const CHEST_POOL = { 4: "all", 5: "ancient", 7: "forest", 8: "winter", 9: "darkness", 10: "desert", 23: "sea", 28: "volcanic" };
// chest odds per slot (wiki Animals > Pet Chests; the real numbers are rolled on the real server and are not in the client):
// normal and biome chests: a boss pet (Legendary) 1 in 3, an event pet (Limited) "a mere chance" = 3 % (guess), else a
// Common pet; the ancient chest: "a higher chance" of a boss pet = 1 in 2 (guess) and a slight event chance = 6 % (guess).
// Rarity per species: mimic/data/chest_rarity.json (wiki pages); Special / Potion pets never come from chests.
const CHEST_COUNTS = [5, 10, 15];
const CHEST_ODDS = { normal: { Legendary: 1 / 3, Limited: 0.03 }, 5: { Legendary: 0.5, Limited: 0.06 } };
let RAR = {}; try { RAR = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "chest_rarity.json"), "utf8")); } catch (e) { }
function pickSlot(L, idx) {
  const O = CHEST_ODDS[idx] || CHEST_ODDS.normal, r = Math.random();
  const want = r < O.Legendary ? "Legendary" : r < O.Legendary + O.Limited ? "Limited" : "Common";
  const by = (q) => L.filter((sp) => (RAR[sp] || "Common") === q);
  const c = by(want).length ? by(want) : by("Common").length ? by("Common") : L.filter((sp) => !/Special|Potion/.test(RAR[sp] || ""));
  const P = c.length ? c : L;
  return P[Math.floor(Math.random() * P.length)];
}
// ancient chest sources: the client (game_rc.js) only shows the server reply [[species, n, total]...] and sets tames to the
// total; its chest table has "ANCIENT CHEST" 2500 apples, 3 slots, and the window text "You cannot receive fully unlocked
// pets, rabbit, wolf, or bear with this chest." Wiki Animals: "cannot give any pet that the player already owns", 150 tames =
// fully unlocked; fandom Guide:How_to_get_pets_easily: any pet except fully tamed (150/150). No source says how piles are
// matched or what an all-complete account gets.
// ancient chest (owner, real game): the 5 / 10 / 15 piles only go to pets that are not complete, smallest pile to the pet
// closest to max, larger piles to pets with more missing (the 3 unfinished pets closest to max; owner's example 149, 144, 144
// -> 5 on the 149 one, 10 and 15 on the 144 ones). Fewer unfinished pets than piles: the leftover piles, biggest first, go
// to the pet with the most still missing; a pile with nowhere left to go is not given. Totals stop at max. Never the
// starters wolf, rabbit, bear (the client chest window says so).
// Every pet complete: the wiki does not say what the real chest gives; GUESSED: the gold stays, reply "0" (the client
// takes no apples, closes the chest and goes back to the shop; an empty card list crashes its opening animation).
function ancient() {
  const miss = (sp) => MAX_CARDS(sp) - TAMES_NOW[sp];
  const open = POOL.all.filter((sp) => sp > 2 && miss(sp) > 0).sort((x, y) => miss(x) - miss(y) || x - y).slice(0, CHEST_COUNTS.length);
  const out = [], give = (sp, n) => { TAMES_NOW[sp] = Math.min(MAX_CARDS(sp), TAMES_NOW[sp] + n); out.push([sp, n, TAMES_NOW[sp]]); };
  CHEST_COUNTS.slice(0, open.length).forEach((n, i) => give(open[i], n));
  for (const n of CHEST_COUNTS.slice(open.length).reverse()) {
    const sp = open.filter((x) => miss(x) > 0).sort((x, y) => miss(y) - miss(x))[0];
    if (sp !== undefined) give(sp, n);
  }
  return out.length ? JSON.stringify(out) : "0";
}
function chest(idx) {
  if (idx === 5) return ancient();
  const L = POOL[CHEST_POOL[idx]] && POOL[CHEST_POOL[idx]].length ? POOL[CHEST_POOL[idx]] : POOL.all;
  if (!L.length) return "0";
  const out = [];
  for (let i = 0; i < 3; i++) { const sp = pickSlot(L, idx), n = CHEST_COUNTS[i]; TAMES_NOW[sp] += n; out.push([sp, n, TAMES_NOW[sp]]); }
  return JSON.stringify(out);
}

// potions (alchemy chest): bought potions per id, kept for this server run; the client stores the answer as inventory["1"]
// owner: mock starter stock so the inventory, potion and insectarium windows have something in them
const POTIONS = { 7: 4, 8: 2, 13: 3, 16: 5, 21: 3, 25: 5, 28: 2, 31: 4, 34: 3, 37: 2, 47: 6, 55: 1, 58: 3, 59: 3, 60: 3, 61: 2 };
// trinkets (inventory "4", client trinket ids, see trinkets.js): owner: one level 1 of each so the trinket slots can be tried at once;
// the rare bushes add more (trinket()), kept for this server run
const TRINKETS = { 20: 1, 30: 1, 40: 1, 50: 1, 60: 1, 70: 1, 80: 1, 90: 1, 100: 1, 110: 1, 130: 1, 140: 1, 145: 1 };
function trinket(id, n) { if (Number.isInteger(id) && id >= 0 && id < 150) TRINKETS[id] = (TRINKETS[id] || 0) + (n || 1); return TRINKETS; }
// insects caught with the Bug Net (insects.js) go to inventory "0" (insect id -> count), kept for this server run
// cooking (account.js cook): take every [type 0 insect / 1 potion, id, count] or nothing (false when one is missing)
function spend(list) {
  const inv = { 0: CATCHES, 1: POTIONS };
  for (const [t, id, n] of list) if (!inv[t] || (inv[t][id] || 0) < n) return false;
  for (const [t, id, n] of list) { inv[t][id] -= n; if (inv[t][id] <= 0) delete inv[t][id]; }
  return true;
}
function catchInsect(id) { if (Number.isInteger(id) && id >= 0 && id < 100) CATCHES[id] = (CATCHES[id] || 0) + 1; return CATCHES; }
const CATCHES = { 0: 12, 1: 8, 2: 5, 3: 9, 5: 3, 6: 7, 8: 2, 10: 4, 12: 6, 15: 1, 18: 3, 21: 2 };   // insects (inventory "0")
function potion(id, amount) {
  if (!(id >= 0) || !(amount > 0)) return "0";
  POTIONS[id] = (POTIONS[id] || 0) + Math.min(100, Math.floor(amount));
  return JSON.stringify(POTIONS);
}

function body() {
  const now = Date.now();
  return JSON.stringify({
    id: ID, mail: MAIL, token: TOKEN, nickname: "Offline", counter: ID, state: 1, private: 0, verified: 1, vip: Date.now() + 10 * 365 * 86400000, banned: 0,
    now, time: 0, reward: now + 6 * 3600 * 1000,   // "Next reward in" counts down to this (6 h: synthetic)
    apple: APPLES, totalApple: APPLES, kill: 0, death: 0, score: BADGE_SCORE, topPlayer: 0,   // owner: #1 player of the game (trophy badge-first)
    bestScore: [[BADGE_SCORE, now]],
    tames: TAMES_NOW.slice(),
    referral: {}, gifts: [], friends: [], heroes: [], inventory: { "0": CATCHES, "1": POTIONS, "4": TRINKETS },   // "1": potions (alchemy chest)
    // owner: every achievement already earned (client: challenges.achievements[key] = [state, time]; a missing key or the
    // in-progress state pops "Achievement Unlocked" on death / reset), so no popups
    challenges: { achievements: Object.fromEntries([...Array(200).keys()].map((i) => [i, [2, now]])) },
    // owner: everything unlocked: every skin, accessory (armours too), particle and pet skin
    skin: [...Array(CC.skin || 0).keys()], accessory: [...Array(CC.accessory || 0).keys()], particle: [...Array(CC.particle || 0).keys()],
    petSkins: [].concat(...Object.entries(CC.pet_skins || {}).map(([sp, n]) => [...Array(n).keys()].map((k) => [+sp, k + 1]))),
  });
}

// owner: the tamers exam window gets a "Reveal all answers" button (questions: mimic/data/exam.json, also used by account.js)
let EXAM_Q = []; try { EXAM_Q = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "exam.json"), "utf8")).questions; } catch (e) { }
const REVEAL = "<script>(function(){var Q=" + JSON.stringify(EXAM_Q.map((q) => [q[0], q[1][q[2]]])).replace(/</g, "\\u003c") +
  ";setInterval(function(){var c=document.getElementById('exam-box');if(!c||document.getElementById('exam-reveal'))return;" +
  "var b=document.createElement('div');b.id='exam-reveal';b.className='button1 yellow-button shadowed clickable';b.style.cssText='margin:8px auto;padding:6px 14px;display:inline-block;cursor:pointer';" +
  "b.textContent='Reveal all answers';var l=document.createElement('div');l.style.cssText='display:none;max-height:260px;overflow:auto;text-align:left;font-size:14px;padding:6px 12px;background:#3a2a1e;border:3px solid #5b4030;border-radius:8px;color:#f0e4d0';" +
  "l.innerHTML=Q.map(function(q,i){return '<div style=\"margin:3px 0\">'+(i+1)+'. '+q[0].replace(/</g,'&lt;')+' <b style=\"color:#a5d86e\">'+q[1].replace(/</g,'&lt;')+'</b></div>'}).join('');" +
  "b.onclick=function(){l.style.display=l.style.display==='none'?'block':'none'};var w=document.createElement('div');w.style.cssText='position:absolute;left:0;right:0;bottom:-46px;text-align:center;z-index:50';l.style.position='absolute';l.style.left='5%';l.style.right='5%';l.style.bottom='44px';w.appendChild(l);w.appendChild(b);c.appendChild(w);},700);})();</script>";

// runs before the bundle: a page without an account logs in as the offline player
const SEED = "<script>try{var s=window.localStorage;if(!s.getItem(\"accMail\")||!s.getItem(\"accToken\")){s.setItem(\"accMail\"," +
  JSON.stringify(MAIL) + ");s.setItem(\"accToken\"," + JSON.stringify(TOKEN) + ");}}catch(e){}</script>" + REVEAL;

module.exports = { body, SEED, chest, potion, trinket, catchInsect, spend, POOL };
