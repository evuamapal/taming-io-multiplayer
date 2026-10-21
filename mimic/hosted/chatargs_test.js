// node mimic/hosted/chatargs_test.js: the shared chat command parser
"use strict";
const assert = require("assert"), A = require("./chatargs");
const eq = (a, b) => assert.deepStrictEqual(a, b);

eq(A.num("1000"), 1000); eq(A.num("1,000"), 1000); eq(A.num("10k"), 10000); eq(A.num("10K"), 10000);
eq(A.num("1.5m"), 1500000); eq(A.num("2b"), 2e9); eq(A.num("-3"), -3); eq(A.num("food"), null); eq(A.num("k"), null); eq(A.num(""), null);
eq(A.fmt(1000), "1,000"); eq(A.fmt(1234567), "1,234,567"); eq(A.fmt(5), "5");

const names = ["playerone 1", "playerone 2", "Bob", "Bobby Tables", "alice"];
const P = (l) => { const r = A.parse(l); return r && [r.cmd, r.args, r.target]; };
eq(P("/give food 1000"), ["give", ["food", "1000"], null]);
eq(P("/GIVE   Food    1000  "), ["give", ["Food", "1000"], null]);
eq(P("  /give 10k gold"), ["give", ["10k", "gold"], null]);
eq(P("/give -p playerone 2 food 100"), ["give", ["2", "food", "100"], "playerone"]);   // unquoted: one word
eq(P("/give food 100 -p \"playerone 2\""), ["give", ["food", "100"], "playerone 2"]);
eq(P("/give -P \"playerone 2\" food 100"), ["give", ["food", "100"], "playerone 2"]);
eq(P("/give @bob gold 5"), ["give", ["gold", "5"], "bob"]);
eq(P("/give -p 'Bobby Tables' gold 5"), ["give", ["gold", "5"], "Bobby Tables"]);
eq(P("/give -p 2 food 1"), ["give", ["food", "1"], "2"]);
eq(P("/tp -p bob @alice"), ["tp", ["alice"], "bob"]);
eq(P("/give fire staff"), ["give", ["fire", "staff"], null]);
eq(P("/pet 'fire fairy' boss"), ["pet", ["fire fairy", "boss"], null]);
eq(P("/age max -p"), ["age", ["max"], ""]);
eq(P("/help"), ["help", [], null]);
eq(P("/give -p bob 100 food"), ["give", ["100", "food"], "bob"]);
eq(A.parse("hello /give"), null);

const pl = [{ name: "playerone 1", n: 1, ent: { id: 11 } }, { name: "playerone 2", n: 2, ent: { id: 12 } }, { name: "Bob", n: 3, ent: { id: 13 } }, { name: "Bobby Tables", n: 4, ent: { id: 14 } }];
const F = (s) => { const r = A.findPlayer(pl, s); return r.p ? r.p.name : "ERR"; };
eq(F("playerone 2"), "playerone 2"); eq(F("PLAYERONE 2"), "playerone 2"); eq(F("2"), "playerone 2"); eq(F("12"), "playerone 2");
eq(F("bob"), "Bob"); eq(F("bobby"), "Bobby Tables"); eq(F("tables"), "Bobby Tables"); eq(F("pla"), "ERR"); eq(F("zed"), "ERR"); eq(F(""), "ERR");
assert(/matches 2 players/.test(A.findPlayer(pl, "pla").err));

const items = ["Fire Staff", "Golden Minigun", "Bug Net", "Wooden Sword"];
eq(A.fuzzy("fire staff", items), "Fire Staff"); eq(A.fuzzy("firestaff", items), "Fire Staff"); eq(A.fuzzy("fire staf", items), "Fire Staff");
eq(A.fuzzy("golden", items), "Golden Minigun"); eq(A.fuzzy("bugnet", items), "Bug Net"); eq(A.fuzzy("xyzzy", items), null); eq(A.fuzzy("sapwn", A.NAMES), "spawn"); eq(A.fuzzy("gvie", A.NAMES), "give");

assert(A.helpList().some((l) => l === "# Cheats"));
assert(A.helpOne("give").some((l) => /-p "playerone 2" 10k gold/.test(l)));
eq(A.helpOne("prev")[0], "# /next"); assert(A.HELP.every((h) => h[4].length >= 1)); eq(A.helpOne("nope"), null);
assert(/^Usage: \/give/.test(A.usage("give")));
console.log("chatargs ok");
