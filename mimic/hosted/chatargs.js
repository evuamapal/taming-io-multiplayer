// Shared chat command parsing for every /command (world.js, creatures.js, insects.js): case-insensitive command name,
// any spacing, "quoted words", numbers like 1000, 1,000, 10k, 1.5m, and a target player with -p <player> or @player
// (exact name, player number or entity id, or a unique name prefix; case-insensitive). Also the /help table.
"use strict";

// "10k" -> 10000, "1,000" -> 1000, "1.5m" -> 1500000; null when the token is not a number
function num(s) {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const m = /^([+-]?\d+(?:\.\d+)?)([kmb]?)$/i.exec(String(s == null ? "" : s).replace(/[,_]/g, ""));
  if (!m) return null;
  return +m[1] * { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
}
// 1000 -> "1,000"
function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// words, with "..." or '...' kept as one word
function tokens(s) {
  const out = [], re = /"([^"]*)"?|'([^']*)'?|(\S+)/g; let m;
  while ((m = re.exec(s))) out.push({ t: m[1] != null ? m[1] : m[2] != null ? m[2] : m[3], q: m[3] == null });
  return out;
}

// /give -p "playerone 2" food 1k -> { cmd: "give", args: ["food", "1k"], target: "playerone 2" }; unquoted -p takes one word
function parse(line) {
  const m = /^\s*\/(\S+)\s*([\s\S]*)$/.exec(String(line || "")); if (!m) return null;
  const tk = tokens(m[2]), args = [];
  const hasP = tk.some((x) => !x.q && /^-p$|^--player$/i.test(x.t));   // with -p, a later @name is a plain argument (/tp -p bob @alice)
  let target = null;
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    let rest = null;
    if (!t.q && /^-p$|^--player$/i.test(t.t)) { i++; if (i >= tk.length) { target = ""; break; } rest = i; }
    else if (!t.q && /^@./.test(t.t)) { tk[i] = { t: t.t.slice(1), q: false }; if (hasP) { args.push(tk[i].t); continue; } rest = i; }
    if (rest == null) { args.push(t.t); continue; }
    const take = 1;   // one word; a name with spaces goes in quotes: -p "playerone 2"
    target = tk.slice(rest, rest + take).map((x) => x.t).join(" ");
    i = rest + take - 1;
  }
  return { cmd: m[1].toLowerCase(), args, target, rest: args.join(" ") };
}

// a player from a name, number or id: exact name, then "number" (player number n or entity id), then unique prefix
// players: [{ name, n, ent }]; returns { p } or { err }
function findPlayer(players, spec) {
  const s = String(spec == null ? "" : spec).trim().toLowerCase();
  if (!s) return { err: "Which player? -p needs a name, e.g. -p \"playerone 2\"" };
  const L = players.filter((q) => q && q.name);
  let hit = L.filter((q) => q.name.toLowerCase() === s);
  if (hit.length === 1) return { p: hit[0] };
  if (/^#?\d+$/.test(s)) {
    const k = +s.replace("#", "");
    hit = L.filter((q) => q.n === k || (q.ent && q.ent.id === k));
    if (hit.length === 1) return { p: hit[0] };
    hit = L.filter((q) => / (\d+)$/.test(q.name) && +/ (\d+)$/.exec(q.name)[1] === k);   // "2" -> "playerone 2"
    if (hit.length === 1) return { p: hit[0] };
  }
  hit = L.filter((q) => q.name.toLowerCase().startsWith(s));
  if (hit.length === 1) return { p: hit[0] };
  if (hit.length > 1) return { err: "\"" + spec + "\" matches " + hit.length + " players: " + hit.slice(0, 5).map((q) => q.name).join(", ") + ". Type more of the name, or put a name with spaces in quotes" };
  hit = L.filter((q) => q.name.toLowerCase().includes(s));
  if (hit.length === 1) return { p: hit[0] };
  return { err: "No player \"" + spec + "\" (type /who for the list; names with spaces go in quotes: -p \"playerone 2\")" };
}

// fuzzy pick from a list of names: exact, unique prefix, then the closest by edit distance (<= 1/3 of the length)
function fuzzy(want, list) {
  const w = String(want || "").toLowerCase().replace(/[\s_-]+/g, " ").trim(); if (!w) return null;
  const norm = (x) => String(x).toLowerCase().replace(/[\s_-]+/g, " ").trim();
  let hit = list.filter((x) => norm(x) === w); if (hit.length) return hit[0];
  hit = list.filter((x) => norm(x).startsWith(w)); if (hit.length === 1) return hit[0];
  const sq = w.replace(/ /g, "");
  hit = list.filter((x) => norm(x).replace(/ /g, "") === sq); if (hit.length) return hit[0];
  let best = null, bd = Math.max(1, Math.floor(w.length / 3)) + 1;
  for (const x of list) { const d = lev(w, norm(x)); if (d < bd) { bd = d; best = x; } }
  return best;
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 6) return 99;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i), pp = p;
  for (let i = 1; i <= a.length; i++) {
    const c = [i];
    for (let j = 1; j <= b.length; j++) {
      c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) c[j] = Math.min(c[j], pp[j - 2] + 1);   // swapped letters
    }
    pp = p; p = c;
  }
  return p[b.length];
}

// the /help table: group, name, usage, what it does (short, for the list), examples, details (for /help <command>)
// [-p player]: the command also works on another player: -p name (one word as is), -p "name with spaces", -p 2 (number from /who) or @name
const T = "[-p player]";
const PL = "-p player: do it to someone else (-p bob, -p \"playerone 2\", -p 2 = number from /who, or @bob); left out = yourself";
const AMT = "Amounts: 1000, 1,000, 10k (10,000), 1.5m (1,500,000), 2b";
const HELP = [
  ["Getting around", "next", "/next, /prev", "switch the whole map to the next or previous biome", ["/next", "/prev"],
    ["Order: forest, snow, dark, desert, sea, volcanic, then around again. Short cooldown between switches. Alias: /previous"]],
  ["Getting around", "biome", "/biome <forest|snow|dark|desert|sea|volcanic>", "switch the whole map to that biome", ["/biome snow", "/season desert"],
    ["Alias: /season. Also accepted: plain, winter, darkness, ocean, volcano. The map has one biome at a time, so this changes it for everyone"]],
  ["Getting around", "tp", "/tp <player | x y | spawn | boss | bug | biome> " + T, "teleport to a player, a spot, your first spawn, the world boss, the nearest insect, or switch biome", ["/tp bob", "/tp -p bob spawn"],
    ["/tp bob or /tp \"playerone 2\": next to that player. /tp 5000 3000: to x 5000 y 3000 (10k works too)", "/tp spawn (or home): where you first spawned. /tp boss: next to the world boss. /tp bug: next to the nearest insect",
      "/tp desert: same as /biome desert", PL + ". Example: /tp -p bob alice moves bob to alice. Alias: /teleport"]],
  ["Getting around", "boss", "/boss", "in the forest the boss walks to you; elsewhere you teleport to the world boss", ["/boss"], []],
  ["Getting around", "fart", "/fart " + T, "launch forward the way you face (3 s cooldown)", ["/fart", "/fart -p bob"], [PL]],
  ["Getting around", "speed", "/speed <x|normal> " + T, "move speed multiplier from 0.1 to 10", ["/speed 3", "/speed normal -p bob"],
    ["1 = normal. x3 or 3 both work. /speed alone or /speed normal resets to 1", PL]],
  ["Cheats", "admin", "/admin [on|off] " + T, "god mode: age 67, all items, free building, no limits, no damage (toggle)", ["/admin", "/admin off -p bob"],
    ["Without on/off it toggles. Admin also sets wood, stone, food and gold to 9,999,999,999, so /give shows no change while it is on", PL]],
  ["Cheats", "god", "/god [on|off] " + T, "take no damage, nothing else changes (toggle)", ["/god", "/god off -p bob"], ["/ungod turns it off", PL]],
  ["Cheats", "give", "/give <resource> [amount] " + T + " | /give <item>", "add wood, stone, food or gold, or put any item in your hand", ["/give food 1000", "/give -p \"playerone 2\" 10k gold"],
    ["Resource and amount in either order: /give food 1000 = /give 1000 food. No amount = 1,000. " + AMT,
      "/give everything 5k: all four resources. Short names work: /give go 500 = gold",
      "/give fire staff: puts that item in your hand; close names work (/give firestaf), or the item id", PL]],
  ["Cheats", "take", "/take <resource> [amount|all] " + T, "remove resources", ["/take gold 500", "/take everything all -p bob"],
    ["Same resources and amounts as /give; all removes everything. No amount = 1,000. " + AMT, PL]],
  ["Cheats", "age", "/age <0-67|max> " + T, "set the age", ["/age max", "/age 20 -p bob"], ["max = 67. Going down removes the XP too", PL]],
  ["Cheats", "heal", "/heal " + T, "full life", ["/heal", "/heal -p bob"], [PL]],
  ["Cheats", "easy", "/easy [on|off] " + T, "10x resources and XP, pets jump to max level (toggle)", ["/easy", "/easy off -p bob"], [PL]],
  ["Spawning", "spawn", "/spawn <creature|boss|insect|majestic|trinket|gift> [n] [baby|adult|boss]", "creatures, insects or bushes around you", ["/spawn wolf 3 adult", "/spawn majestic butterfly 2"],
    ["n: how many, up to 30 (20 for insects); count and stage in any order at the end, or the count first: /spawn 3 wolf",
      "Creature names are fuzzy (/spawn wolfs works), or a species id. boss: a boss of this biome (any biome if none here)",
      "Insects: a full name, insects (random ones), wasp-nest, leech-nest. majestic / trinket: this biome's bush; gift: gift boxes. /clear removes spawned creatures"]],
  ["Spawning", "spawnall", "/spawnall", "one of every creature kind and stage, plus every biome's tornado, around you", ["/spawnall"], ["/clear removes the creatures (not the tornados)"]],
  ["Spawning", "pet", "/pet <species> [baby|adult|boss] " + T, "an extra pet of that species", ["/pet fire fairy", "/pet wolf adult -p bob"],
    ["Stage left out = boss. Names are fuzzy, or a species id", PL]],
  ["Spawning", "clear", "/clear [radius] [all]", "remove the /spawn creatures near you", ["/clear", "/clear 3000 all"],
    ["radius in map units, 1,500 if left out (10k works). all: every wild creature in the radius, not only spawned ones. Pets are never removed"]],
  ["Spawning", "hive", "/hive", "a Hive Creep next to you", ["/hive"], ["Break it: BMB shadow, 7 eggs and baby shadows; tame them with an Appletor"]],
  ["Clan and totem", "totem", "/totem | /totem shop | /totem buy <wood|stone|food|mask>", "level up your clan's totem next to you, or use its shop", ["/totem", "/totem buy food"],
    ["Stand within 400 of a totem your clan owns (break a totem while in a clan to capture it). Levels 1 to 6",
      "/totem shop lists what each level unlocks. buy wood/stone/food: +500 of it; mask: a random pet mask"]],
  ["Events and shows", "event", "/event <name|list|off>", "start a real taming event around you", ["/event list", "/event yeti"],
    ["Names: christmas, easter, halloween, thanksgiving, genie, mammoth, yeti, siren, gaze (close spellings work). /events = /event list"]],
  ["Events and shows", "versus", "/versus [pets|bosses|mobs|epic|player|stop] " + T, "RED 100 random pets fight a random BLUE army, live score in chat", ["/versus bosses", "/versus player -p bob"],
    ["The map is cleared and everyone is in god mode until /versus stop puts the world back. No army = random. Alias: /vs",
      "player: the map stays and waves hunt you (or -p someone), with no god mode. -p only works with player"]],
  ["Events and shows", "restart", "/restart [stop]", "a server restart like the real one: 60 s countdown, a Reaper hunts every player", ["/restart", "/restart stop"],
    ["Killed by the Reaper = 100k gold, 1,000 of each resource and age 12. stop (or cancel) ends it"]],
  ["Players", "who", "/who", "the players online with their numbers", ["/who"], ["Use the number with -p: /heal -p 2. Aliases: /players, /list"]],
  ["Players", "kill", "/kill <player> | /die", "kill a player, or yourself", ["/kill bob", "/die"],
    ["/kill \"playerone 2\" or /kill -p 2 work too. They respawn normally. Alias: /slay"]],
  ["Players", "kick", "/kick <player>", "disconnect a player", ["/kick bob", "/kick \"playerone 2\""], ["They can join again"]],
  ["World", "decay", "/nodecay, /dodecay", "building decay off / on for everyone (off by default)", ["/nodecay"], []],
  ["World", "reset", "/reset", "fresh start for everyone and a clean world", ["/reset"], ["Everyone dies and starts over at age 0; admin, god, easy and speed are switched off. 10 s cooldown"]],
  ["Test helpers", "cast", "/cast", "every pet of yours casts its skill at the nearest creature within 600", ["/cast"], []],
  ["Test helpers", "testgold", "/testgold, /testxp <n>, /testdie", "only when the server runs with TIO_SOCIAL_TEST=1: gold, XP or a death", ["/testxp 5000"],
    ["/testgold: a test amount of gold. /testxp <n>: n XP (up to 999999, plain digits only). /testdie: you die"]],
  ["Info", "version", "/version", "the clone version", ["/version"], []],
  ["Info", "help", "/help [command]", "this list, or everything about one command", ["/help", "/help give"], ["Aliases: /commands, /h, /?"]],
];
const ALIAS = { prev: "next", previous: "next", season: "biome", die: "kill", slay: "kill", nodecay: "decay", dodecay: "decay", teleport: "tp", ungod: "god",
  vs: "versus", events: "event", players: "who", list: "who", testxp: "testgold", testdie: "testgold", commands: "help", h: "help" };
function helpFor(c) {
  c = String(c || "").toLowerCase().replace(/^\//, ""); c = ALIAS[c] || c;
  return HELP.find((h) => h[1] === c) || null;
}
// the grouped list: "# group" headers then "usage: what (e.g. example)" lines
function helpList() {
  const out = []; let g = null;
  for (const h of HELP) { if (h[0] !== g) { g = h[0]; out.push("# " + g); } out.push(h[2] + ": " + h[3] + (h[4].length ? " (e.g. " + h[4][0] + ")" : "")); }
  out.push("# Flags");
  out.push("[-p player] or @player: do it to someone else: -p bob, -p \"name with spaces\", -p 2 (number from /who)");
  out.push(AMT + ". /help <command> for everything about one command");
  return out;
}
function helpOne(c) {
  const h = helpFor(c); if (!h) return null;
  return ["# /" + h[1], "Usage: " + h[2], "What: " + h[3]].concat(h[5] || [], h[4].length ? ["Examples: " + h[4].join(", ")] : []);
}
function usage(c) { const h = helpFor(c); return h ? (h[1] === "testgold" ? "Test helpers are off on this server (TIO_SOCIAL_TEST=1). " : "") + "Usage: " + h[2] + (h[4].length ? " (e.g. " + h[4][0] + ")" : "") : "Unknown command /" + c + ", type /help"; }
const NAMES = HELP.map((h) => h[1]).concat(Object.keys(ALIAS), ["spawnall"]);

module.exports = { num, fmt, tokens, parse, findPlayer, fuzzy, helpFor, helpList, helpOne, usage, NAMES, HELP };
