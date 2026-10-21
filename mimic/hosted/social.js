// Social plugin for hosted/world.js: age-up item picks (op 1), in-server clans ("teams", JSON 68 + rx 68 sub-ops),
// clan chat log, HUD counters (atl4 37). Wire values are Atlanta#4; the capture (Saopaulo#5) was translated with the
// client's own per-server shuffle (clan sub-ops and actions come from the message type table, like the types).
"use strict";

// clan sub-ops sent by the server (rx 68 m) and actions sent by the client (JSON 68 o), Atlanta#4 values
const M = { POS: 63, DEL: 26, ADD: 71, LIST: 61, EMPTY: 50, MEMBER: 16, LEADER: 46, MEMBERS: 83, NAMES: 35, REQ: 3, LEFT: 10, INFO: 74 };
const O = { OPEN: 77, CREATE: 51, ASK: 60, ACCEPT: 54, DECLINE: 72, KICK: 38, LEADER: 24, NEXT: 85, HIDE: 25, LOCKJOIN: 55, LOCK: 49, LEAVE: 33, CLOSE: 30 };
const T_CLAN = 68, T_CHAT = 39, T_COUNT = 37, T_ITEMCOUNT = 36, TM_CLAN = 62, OP_PICK = 1;
// hat shop ops (atl4): value = op + (category << 8) + (id << 16); category 0 hat, 1 wing
const SHOP = { OPEN: 12, CLOSE: 9, BUY: 7, EQUIP: 6, CRAFT: 13 };
const T_INV = 53, T_OWNED = 66, F_COSMETIC = "9", GOLD = 3, CAT_TOOL = 1;
const GOOFY_HAT = 70;   // owner: invented Brain Cooler 3000 (tools/invented/client_patch.js), every player owns it (not worn by default)
// client shop table: [gold price, listed (0 = hidden in the shop)]
const HAT_PRICE = [[0,1],[5000,1],[1000,0],[3000,1],[7200,1],[4000,1],[2000,1],[5000,1],[200,1],[200,1],[200,1],[200,1],[200,1],[200,1],[8000,1],[4000,1],[20000,1],[20000,1],[1000,0],[20000,1],[12000,1],[4000,1],[500,0],[5000,1],[2000,1],[10000,1],[6000,1],[7250,1],[6000,1],[15000,1],[3000,1],[3000,1],[5000,1],[7150,1],[2500,1],[3000,0],[15000,1],[6000,1],[2000,1],[4000,1],[8000,1],[7100,1],[7450,1],[7000,1],[7350,1],[7500,1],[7600,1],[7400,1],[7050,1],[3000,1],[9000,1],[3000,0],[20000,1],[7000,1],[10000,1],[16000,1],[3000,0],[3000,0],[8000,1],[10000,1],[7700,1],[7300,1],[8000,1],[3000,0],[3000,1],[20000,1],[14000,1],[3000,1],[7800,1],[9500,1],[1,1]];   // 70: invented Brain Cooler 3000, every player owns and wears it by default
const WING_PRICE = [[0,1],[20000,1],[10000,1],[5000,1],[3000,1],[2000,1],[20000,1],[20000,1],[6000,1],[6050,1],[6100,1],[6150,1],[6200,1],[6300,1],[6350,1],[6400,1],[6500,1],[6550,1],[6600,1],[6700,1],[6800,1],[8000,1],[8050,1],[8100,1],[8150,1],[8200,1],[8250,1],[8300,1],[8350,1],[8400,1],[8450,1],[8500,1],[8600,1],[8700,1],[6800,1],[8800,1],[6550,1],[20000,1]];
// worn effects for player.mods (world.js); src: sp5 = capture, wiki = mimic/data/wiki/hats.json, guess = direction from wiki, number guessed
const HAT_FX = {
  40: { bug_dup: 0.09, net_speed: 1.1, src: "wiki Bee Keeper's Hat: 9% chance to duplicate bugs, slightly faster with a bug net; 1.1 guess" },
  59: { lucky: true, src: "wiki Lucky Hat: more insects (a broken nest near a lucky player releases a 2nd insect half the time: guess); appletor wake risk and dice: none in the clone" },
  25: { dmg_taken: 0.6, speed: 0.6, src: "sp5 walk factors x0.6 under the helm (rows 17294..25368, 27588..), spike contact 3..5 vs 6..7; player hits Diamond Hammer 26 -> 14..20 (mostly 15-16), Amethyst Hammer 22 -> 13..17" },
  6: { gather_bonus: { 1: 2 }, src: "wiki Wood Hat +2 wood per hit" },
  24: { gather_bonus: { 2: 2 }, src: "wiki Miner Hat +2 stone per hit" },
  5: { regen_per_s: 1, src: "wiki Bandage ~1 hp/s" },
  54: { pad_immune: true, src: "wiki Short-circuit Hat: boost pads have no effect" },
  36: { xp_mult: 1.5, src: "wiki Wolf Trophy Hat +50% experience" },
  16: { speed: 1.1, src: "wiki Marlou Hat +10% speed" },
  7: { speed: 1.15, dmg_taken: 2.5, src: "wiki Clown Hat takes 2.5x damage; speed 1.15 guess (wiki: faster)" },
  // ids: client hat table (mimic/data/client_hats.json); effects: wiki In-game Shop (numbers in [] there), guess where the
  // wiki only says "more" (x1.2) or "slower" (x0.9)
  14: { wdmg: { crossbow: 1.2 }, src: "wiki Hunter: crossbows do more damage; 1.2 guess" },
  15: { wdmg: { bow: 1.2 }, src: "wiki Arrow Hat: bows do more damage; 1.2 guess" },
  58: { wdmg: { musket: 1.2 }, src: "wiki Musketeer Hat: muskets do more damage; 1.2 guess" },
  21: { wdmg: { slingshot: 1.2 }, src: "wiki Rascal's Cap: slingshots hurt more; 1.2 guess" },
  22: { hand_flat: 24, src: "wiki Party Hat: hands and gloves deal 24 more damage" },
  23: { bdmg: 1.5, speed: 0.9, src: "wiki Broken Pot: slower, hammers do more damage to buildings; 1.5 / 0.9 guess" },
  53: { gather_bonus: { 0: 2 }, src: "wiki Bush Hat +2 food per hit" },
  26: { food_kill_mult: 1.5, src: "wiki Explorer Hat +50% food from killing animals" },
  66: { speed: 0.8, dmg_taken: 0.7, src: "wiki Anvil Hat: protection, slower; 0.7 / 0.8 guess" },
  62: { dmg_taken: 0.9, glove_mult: 1.2, ko_mult: 2, src: "wiki Cheek Protection: weaker than biome hats, gloves +20%, knockout 25 -> 50 %; 0.9 guess" },
  29: { dmg_taken: 0.9, speed: 0.9, wrench_mult: 1.5, src: "wiki Worksite Helmet: slightly protects, slowed, buffs wrench repair; 0.9 / 0.9 / 1.5 guess" },
  65: { kb_mult: 1.5, speed: 0.9, src: "wiki Spring Cap: more knockback, slower; 1.5 / 0.9 guess" },
  50: { speed: 0.9, src: "wiki Termite's Hat: slower; 0.9 guess (decay of new buildings: the clone decays all buildings already)" },
  17: { pet_xp_mult: 1.5, src: "wiki King's Crown: pets gain 50% more XP" },
  34: { tame_mult: 1.29, src: "wiki Tamer's Cap: taming chance x1.29" },
  38: { hide_board: true, src: "wiki Imposter: hidden from the leaderboard under 1,000,000 gold" },
  19: { mill_gold: 10, src: "wiki Windmill Hat: +10 gold per placed windmill" },
  39: { wreck_mult: 1.5, src: "wiki Wrecker's Hat: 1.5x resources from destroying structures" },
  63: { dmg_taken: 0.9, speed: 1.05, src: "wiki Pilgrim's Hat: biome-hat protection and speed in every biome" },  // owner: every hat does what the client says. "Stronger <type> pet": that type's pets bite and cast x1.2 (guess)
  4: { pet_type: { Plant: 1.2 }, src: "client Leaf Crown: stronger Plant pet; 1.2 guess" },
  27: { pet_type: { Poison: 1.2 }, src: "client Plague Doctor: stronger Poison pet; 1.2 guess" },
  33: { pet_type: { Electric: 1.2 }, src: "client Lightning Band: stronger Electric pet; 1.2 guess" },
  41: { pet_type: { Water: 1.2 }, src: "client Sea King Fins: stronger Water pet; 1.2 guess" },
  42: { pet_type: { Ice: 1.2 }, src: "client Viking Helmet: stronger Ice pet; 1.2 guess" },
  43: { pet_type: { Normal: 1.2 }, src: "client Crown of Horns: stronger Normal pet; 1.2 guess" },
  44: { pet_type: { Combat: 1.2 }, src: "client War Trophy: stronger Combat pet; 1.2 guess" },
  45: { pet_type: { Spectrum: 1.2 }, src: "client Cursed Crown: stronger Spectrum pet; 1.2 guess" },
  46: { pet_type: { Dragon: 1.2 }, src: "client Dragon Tiara: stronger Dragon pet; 1.2 guess" },
  47: { pet_type: { Fire: 1.2 }, src: "client Fire Spirit Mask: stronger Fire pet; 1.2 guess" },
  48: { pet_type: { Rock: 1.2 }, src: "client Stone Helmet: stronger Rock pet; 1.2 guess" },
  60: { pet_type: { Fairy: 1.2 }, src: "client Fairy Helmet: stronger Fairy pet; 1.2 guess" },
  61: { pet_type: { Insect: 1.2 }, src: "client Insect Helmet: stronger Insect pet; 1.2 guess" },
  68: { pet_type: { Ancient: 1.2 }, src: "client Ancient Helmet: stronger Ancient pet; 1.2 guess" },
  69: { pet_type: { Dog: 1.2 }, src: "client Pup Ears: stronger Dog pet; 1.2 guess" },
  1: { pet_species: { Cow: 1.2, Bull: 1.2 }, src: "client Cowboy Hat: cows and bulls are stronger; 1.2 guess" },
  28: { appletor_mult: 3, src: "wiki Nurse Hat: Appletors heal 3x" },
  37: { trap_mult: 1.5, trap_reload: 0.6, src: "wiki Trapper's Hat: bear traps reload faster and do more damage; 1.5 / 0.6 guess" },
  20: { magician: true, src: "wiki Magician Hat: pet skill cooldown -1 s every 5 s (max 50 s)" },
  52: { steal: 5, src: "client Rogue's Hood: steal gold and food; 5 of each per hit on a player: guess" },
  55: { mount_buff: 1.2, src: "wiki Tamer's Helmet: the mounted pet has more defense and attack (like battle + turtle saddle); 1.2 guess" },
};
// biome hats: 10% shield (wiki) and a small speed bonus (guess 1.05) only while their biome phase is on; Santa's Hat (35)
// replaces Chapka in winter with +20% defense and speed (wiki)
const BIOME_HAT = { 30: 0, 3: 1, 31: 2, 49: 3, 64: 4, 67: 5 };   // Feather Tribe forest, Chapka snow, Mushroom dark, Turban desert, Diving Suit sea, Heatmask volcanic
const WING_FX = {
  1: { regen_per_s: 3, src: "wiki Angel Wings ~3 hp/s" },
  2: { wdmg: { sword: 1.1, katana: 1.1 }, src: "wiki Dragonic Wings: swords and katanas +10%" },
  3: { wdmg: { spear: 1.2, naginata: 1.2 }, src: "wiki Baby Wings: spears and naginatas +20%" },
  4: { gather_bonus: { 3: 2 }, speed: 0.9, src: "wiki Big Bag: +2 gold per hit, slower; 0.9 guess" },
  5: { gather_bonus: { 0: 2 }, speed: 0.9, src: "wiki Small Bag: +2 food per hit, slower; 0.9 guess" },
  6: { wdmg: { dagger: 1.1, cleaver: 1.1 }, src: "wiki Dark Wings: daggers and cleavers +10%" },
  7: { wdmg: { axe: 1.2, labrys: 1.2 }, src: "wiki Demon Wings: axes and labrys +20%" },
  37: { glove_mult: 1.2, ko_mult: 2, src: "wiki Final Round Wings: gloves +20% damage, more knockout chance (x2 like Cheek Protection: guess)" },  // client capes 8..20: "resistant to <type>": damage from that type's pets and creatures x0.7 (guess, Pup Tail's wiki 30 %);
  // wings 21..33: "<type> pets are stronger" x1.2 (guess)
  8: { type_resist: { Normal: 0.7 }, src: "client Normal Cape: resistant to Normal type; 0.7 guess" },
  21: { pet_type: { Normal: 1.2 }, src: "client Normal Wings: Normal pets are stronger; 1.2 guess" },
  9: { type_resist: { Rock: 0.7 }, src: "client Rock Cape: resistant to Rock type; 0.7 guess" },
  22: { pet_type: { Rock: 1.2 }, src: "client Rock Wings: Rock pets are stronger; 1.2 guess" },
  10: { type_resist: { Water: 0.7 }, src: "client Water Cape: resistant to Water type; 0.7 guess" },
  23: { pet_type: { Water: 1.2 }, src: "client Water Wings: Water pets are stronger; 1.2 guess" },
  11: { type_resist: { Electric: 0.7 }, src: "client Electric Cape: resistant to Electric type; 0.7 guess" },
  24: { pet_type: { Electric: 1.2 }, src: "client Electric Wings: Electric pets are stronger; 1.2 guess" },
  12: { type_resist: { Plant: 0.7 }, src: "client Plant Cape: resistant to Plant type; 0.7 guess" },
  25: { pet_type: { Plant: 1.2 }, src: "client Plant Wings: Plant pets are stronger; 1.2 guess" },
  13: { type_resist: { Poison: 0.7 }, src: "client Poison Cape: resistant to Poison type; 0.7 guess" },
  26: { pet_type: { Poison: 1.2 }, src: "client Poison Wings: Poison pets are stronger; 1.2 guess" },
  14: { type_resist: { Insect: 0.7 }, src: "client Insect Cape: resistant to Insect type; 0.7 guess" },
  27: { pet_type: { Insect: 1.2 }, src: "client Insect Wings: Insect pets are stronger; 1.2 guess" },
  15: { type_resist: { Combat: 0.7 }, src: "client Combat Cape: resistant to Combat type; 0.7 guess" },
  28: { pet_type: { Combat: 1.2 }, src: "client Combat Wings: Combat pets are stronger; 1.2 guess" },
  16: { type_resist: { Fire: 0.7 }, src: "client Fire Cape: resistant to Fire type; 0.7 guess" },
  29: { pet_type: { Fire: 1.2 }, src: "client Fire Wings: Fire pets are stronger; 1.2 guess" },
  17: { type_resist: { Ice: 0.7 }, src: "client Ice Cape: resistant to Ice type; 0.7 guess" },
  30: { pet_type: { Ice: 1.2 }, src: "client Ice Wings: Ice pets are stronger; 1.2 guess" },
  18: { type_resist: { Spectrum: 0.7 }, src: "client Spectrum Cape: resistant to Spectrum type; 0.7 guess" },
  31: { pet_type: { Spectrum: 1.2 }, src: "client Spectrum Wings: Spectrum pets are stronger; 1.2 guess" },
  19: { type_resist: { Dragon: 0.7 }, src: "client Dragon Cape: resistant to Dragon type; 0.7 guess" },
  32: { pet_type: { Dragon: 1.2 }, src: "client Dragon Wings: Dragon pets are stronger; 1.2 guess" },
  20: { type_resist: { Fairy: 0.7 }, src: "client Fairy Cape: resistant to Fairy type; 0.7 guess" },
  33: { pet_type: { Fairy: 1.2 }, src: "client Fairy Wings: Fairy pets are stronger; 1.2 guess" },
  34: { type_resist: { Ancient: 0.7 }, src: "client Ancient Cape: resistant to ancient type; 0.7 guess" },
  35: { pet_type: { Ancient: 1.2 }, src: "client Ancient Wings: ancient pets are stronger; 1.2 guess" },
  36: { type_resist: { Dog: 0.7 }, status_immune: true, src: "wiki Pup Tail: 30% less damage from dog type animals, nullifies status effects (slows, freezes, stuns; burn ticks still land: guess)" },
};
const COUNTER = { kills: 0, animals: 1, bosses: 2, tames: 3, bugs: 4, buildings: 5 };

// client item tree: id -> [level (-1 = never offered), previous item in the chain, slot group for placed counts]
// 17 (the client's Enchanted Spear Level 1 slot) is the invented Air Blast Gun (owner: a last age-28 pick, see SWAP)
const TREE = {0:[0,null,null],1:[1,0,null],2:[6,1,null],3:[11,2,null],4:[15,3,null],5:[19,4,null],6:[22,5,null],7:[22,5,null],8:[22,5,null],9:[1,0,null],10:[6,9,null],11:[11,10,null],12:[15,11,null],13:[19,12,null],14:[22,13,null],15:[22,13,null],16:[22,13,null],17:[28,null,null],18:[-1,null,null],19:[-1,null,null],20:[6,9,null],21:[11,20,null],22:[15,21,null],23:[19,22,null],24:[22,23,null],25:[22,23,null],26:[22,23,null],27:[1,0,null],28:[6,27,null],29:[11,28,null],30:[15,29,null],31:[19,30,null],32:[22,31,null],33:[22,31,null],34:[22,31,null],35:[6,27,null],36:[11,35,null],37:[15,36,null],38:[19,37,null],39:[22,38,null],40:[22,38,null],41:[22,38,null],42:[1,0,null],43:[6,42,null],44:[11,43,null],45:[15,44,null],46:[19,45,null],47:[22,46,null],48:[22,46,null],49:[22,46,null],50:[6,42,null],51:[11,50,null],52:[15,51,null],53:[19,52,null],54:[22,53,null],55:[22,53,null],56:[22,53,null],57:[1,0,null],58:[6,57,null],59:[11,58,null],60:[15,59,null],61:[19,60,null],62:[22,61,null],63:[22,61,null],64:[22,61,null],65:[6,57,null],66:[11,65,null],67:[15,66,null],68:[19,67,null],69:[22,68,null],70:[22,68,null],71:[22,68,null],72:[1,0,null],73:[6,72,null],74:[11,73,null],75:[15,74,null],76:[19,75,null],77:[22,76,null],78:[22,76,null],79:[22,76,null],80:[6,72,null],81:[11,80,null],82:[15,81,null],83:[19,82,null],84:[22,83,null],85:[22,83,null],86:[22,83,null],87:[4,null,null],88:[10,87,null],89:[14,88,null],90:[18,89,null],91:[21,90,null],92:[24,91,null],93:[24,91,null],94:[24,91,null],95:[4,null,null],96:[10,95,null],97:[14,96,null],98:[18,97,null],99:[21,98,null],100:[24,99,null],101:[24,99,null],102:[24,99,null],103:[10,95,null],104:[14,103,null],105:[18,104,null],106:[21,105,null],107:[24,106,null],108:[24,106,null],109:[24,106,null],110:[10,95,null],111:[14,110,null],112:[18,111,null],113:[21,112,null],114:[24,113,null],115:[24,113,null],116:[24,113,null],117:[4,null,null],118:[10,117,null],119:[14,118,null],120:[18,119,null],121:[21,120,null],122:[24,121,null],123:[24,121,null],124:[24,121,null],125:[10,117,null],126:[14,125,null],127:[18,126,null],128:[21,127,null],129:[24,128,null],130:[24,128,null],131:[24,128,null],132:[10,117,null],133:[14,132,null],134:[18,133,null],135:[21,134,null],136:[24,135,null],137:[24,135,null],138:[24,135,null],139:[10,117,null],140:[14,139,null],141:[18,140,null],142:[21,141,null],143:[24,142,null],144:[24,142,null],145:[24,142,null],146:[4,null,null],147:[10,146,null],148:[14,147,null],149:[18,148,null],150:[21,149,null],151:[24,150,null],152:[24,150,null],153:[24,150,null],154:[5,null,null],155:[5,null,null],156:[5,null,null],157:[25,154,null],158:[25,155,null],159:[25,156,null],160:[5,null,null],161:[25,160,null],162:[25,160,null],163:[25,160,null],164:[25,160,null],165:[25,160,null],166:[0,null,null],167:[2,166,null],168:[7,167,null],169:[12,168,null],170:[16,169,null],171:[7,167,null],172:[12,171,null],173:[16,172,null],174:[7,167,null],175:[12,174,null],176:[16,175,null],177:[7,167,null],178:[12,177,null],179:[16,178,null],180:[2,175,null],181:[7,180,null],182:[12,181,null],183:[16,182,null],184:[7,180,null],185:[12,184,null],186:[16,185,null],187:[7,180,null],188:[12,187,null],189:[16,188,null],190:[7,180,null],191:[12,190,null],192:[16,191,null],193:[8,null,5],194:[26,193,5],195:[26,193,5],196:[8,null,7],197:[26,196,7],198:[26,196,7],199:[8,null,8],200:[26,199,8],201:[26,199,8],202:[1,199,13],203:[8,null,26],204:[26,203,26],205:[26,203,26],206:[0,null,0],207:[2,206,0],208:[7,207,0],209:[12,208,0],210:[16,209,0],211:[20,210,0],212:[23,211,0],213:[23,211,0],214:[23,211,0],215:[3,null,15],216:[9,215,12],217:[13,216,12],218:[17,217,12],219:[20,218,12],220:[23,219,12],221:[27,220,12],222:[27,220,12],223:[27,220,12],224:[9,215,14],225:[13,224,14],226:[17,225,14],227:[20,226,14],228:[23,227,14],229:[27,228,14],230:[27,228,14],231:[27,228,14],232:[3,null,4],233:[9,232,4],234:[13,233,4],235:[17,234,4],236:[20,235,4],237:[23,236,4],238:[27,237,4],239:[27,237,4],240:[27,237,4],241:[9,215,9],242:[13,241,9],243:[17,242,9],244:[20,243,9],245:[23,244,9],246:[27,245,9],247:[27,245,9],248:[27,245,9],249:[0,null,6],250:[3,249,6],251:[9,250,6],252:[13,251,6],253:[17,252,6],254:[20,253,6],255:[23,254,6],256:[23,254,6],257:[23,254,6],258:[9,215,11],259:[13,258,11],260:[17,259,11],261:[20,260,11],262:[23,261,11],263:[27,262,11],264:[27,262,11],265:[27,262,11],266:[0,null,1],267:[3,266,1],268:[9,267,1],269:[13,268,1],270:[17,269,1],271:[20,270,1],272:[23,271,1],273:[23,271,1],274:[23,271,1],275:[9,215,10],276:[13,275,10],277:[17,276,10],278:[20,277,10],279:[23,278,10],280:[27,279,10],281:[27,279,10],282:[27,279,10],283:[9,215,16],284:[13,283,16],285:[17,284,16],286:[20,285,16],287:[23,286,16],288:[27,287,16],289:[27,287,16],290:[27,287,16],291:[9,215,17],292:[13,291,17],293:[17,292,17],294:[20,293,17],295:[23,294,17],296:[27,295,17],297:[27,295,17],298:[27,295,17],299:[9,215,18],300:[13,299,18],301:[17,300,18],302:[20,301,18],303:[23,302,18],304:[27,303,18],305:[27,303,18],306:[27,303,18],307:[0,null,2],308:[3,307,2],309:[9,308,2],310:[13,309,2],311:[17,310,2],312:[20,311,2],313:[23,312,2],314:[23,312,2],315:[23,312,2],316:[3,266,1],317:[9,316,1],318:[13,317,1],319:[17,318,1],320:[20,319,1],321:[23,320,1],322:[23,320,1],323:[23,320,1],324:[-1,null,null],325:[-1,null,null],326:[-1,null,null],327:[-1,null,null],328:[-1,null,null],329:[-1,null,null],330:[-1,null,null],331:[-1,null,null],332:[-1,null,null],333:[-1,null,19],334:[-1,null,19],335:[-1,null,19],336:[-1,null,19],337:[-1,null,19],338:[-1,null,19],339:[-1,null,20],340:[-1,null,21]};
// invented fairy staffs (game_config staffs, client items appended by tools/invented/client_patch.js): age-28 picks, no chain
for (const id of [341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352]) TREE[id] = [28, null, null];
// owner: ages 1..27 pick like the real game; the invented weapons are one last pick at 28 that takes the bar slot of the
// main weapon (the Air Blast Gun and the staffs alike), so the bar keeps its size
// (the client does the same in tools/invented/client_patch.js)
const SWAP = new Set([17, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352]);
function swapOut(w, x, id) {
  const I = w.ctx && w.ctx.ITEMS, cat = 1; if (!I || !I[id]) return null;   // owner: always the main weapon (cat 1)
  const sw = x.swapped || (x.swapped = new Set());
  for (const o of x.picks) {
    if (o === id || sw.has(o) || !I[o] || I[o].cat !== cat) continue;
    let top = true; for (const q of x.picks) if (TREE[q] && TREE[q][1] === o) { top = false; break; }
    if (top) { sw.add(o); return o; }
  }
  return null;
}
const START = [0, 166, 206, 249, 266, 307];   // Hand, Apple, Wooden Wall, Wooden Door, Wooden Spike, Wooden Windmill

const CFG = {
  clan_name_max: 10, clan_max_members: 10, clan_first_id: 476, pos_ms: [5300, 9900], req_ttl_ms: 60000, req_repeat_ms: 3000,
  send_building_counter: false, test_gold: 20000, bubble_wait_ms: 1500, json_burst: 10, json_per_s: 5, pick_burst: 20, pick_per_s: 10,
};
// where each number and behaviour comes from: sp5 = Saopaulo#5 human capture (row = line index in work/sp3_decoded.jsonl),
// client = the pinned client bundle (study/game_r.js), guess = not observable in the capture
const SOURCES = {
  M_O_codes: "client: clan handler switch on m and the JSON 68 senders use the type table (tables.js atlanta4 column); sp5 tx o 45/25/12/11/32/53 match the saopaulo5 column; browser proof frames: open 77, create 51 {n}, decline 72",
  create: "sp5 rows 3425 (o 25 n AI) -> 3430 (m 23 {l,n,x}, m 28 p 0 [[name,uid,1,0,id,0]], m 40 [id,name] to all)",
  open: "sp5 rows 3339/3345 no team -> m 22 names; 7598/7602 alone in team -> m 46; 10324/10329 with members -> m 28",
  close: "sp5 o 53 a few s after every open/create (rows 3447, 7658, 10388, 17791, 34792), no reply",
  ask_req: "sp5 row 9332 m 33 {o name, n entity id, p tag}; accept o 12 has no argument (row 9379); client shows one request at a time",
  accept_reply: "guess: the joiner side is not in the capture; joiner gets INFO {n,x}; leader gets nothing (sp5 row 9379 onwards)",
  leader_transfer: "sp5 rows 17782 (o 32 n uid) -> 17788 m 39 (now member) + m 28 new order; own field 14 963 -> 962",
  dissolve: "sp5 row 33947 m 60 (left) then m 64 id to all; field 14 -> 0",
  leader_leave: "client: leader leave asks 'delete your team?' -> team removed; leader disconnect promotes next leader or first member: guess",
  kick_next_hide_locks: "client: o kick/next/hide/lockjoin/lock senders and INFO lo/jo fields; server replies are guesses (no capture rows)",
  list_on_join: "sp5 row 971 m 69 [[id,name]] (atl4 61)",
  respawn_info: "sp5 rows 26679 (member: {n,x}) and 38433 (leader: {n,l,x,lo,jo})",
  field14: "sp5 player creates: field 14 = team id*2 + leader bit (row 3430 own 963 for team 481, row 11081 AI 962)",
  positions: "sp5 m 36 rows 9451..: [x,y,0 (leader, id hidden), x,y,id ...] in own minimap p units; intervals 5.3..9.9 s; only while 2+ members",
  pos_ms: "sp5 m 36 interval min 5.3 s, max 9.9 s, median 8.3 s",
  clan_first_id: "sp5 row 971 team ids 476..483 (cosmetic)",
  clan_name_max: "client create-name maxlength 10, unique name check",
  clan_max_members: "guess", req_ttl_ms: "guess", req_repeat_ms: "guess", rate_limits: "guess",
  shop_ops: "client shop module: open 12 / close 9 / buy 7 / equip 6 / craft 13 (K table atl4), value = op + cat<<8 + id<<16; sp5 rows 17009 open (sp5 op 1), 17284 buy hat 25 (sp5 op 16 value 6400), 17288 equip hat 25 + close (sp5 ops 12, 3)",
  shop_buy_reply: "sp5 row 17290: inventory {i: {3: 4055}} = gold 14055 - 10000, 0.27 s after the buy; nothing else",
  hat_prices: "client table _5268 (70 hats, 38 wings, price + listed flag); Knight's Helmet 25 = 10000 matches the sp5 gold drop (row 17290)",
  cosmetic_field: "client: player create/move field 9 = hat | wing << 8; sp5 row 17294 own move {9: 25} after the equip; others e.g. row 752 {9: 5649} = hat 17 + wing 22",
  owned_list: "sp5 rows 26679 and 38433 (not in the first join batch, row 971): atl4 66 {H: [25], W: []} in each respawn join batch; ownership kept across death",
  equip_reset_on_death: "sp5 rows 26679, 38433: own create after respawn has 9 = 0; the helm was re-equipped at row 27588",
  buy_refused: "guess: never refused in the capture; server re-sends 66 {H, W} so the client drops the locally added hat",
  craft: "not implemented: crates (category 2, op 13) never used in the capture",
  tool_autoequip: "sp5: every cat 1 pick is followed ~0.25 s later by own field 8 = item (rows 1934, 12904, 16728 ...); other categories never",
  hat_effects: "HAT_FX / WING_FX / BIOME_HAT carry their own src tags; other hats are cosmetic here (wiki effects need hooks world.js does not have: weapon-type damage, pets, taming, luck, knockback, decay)",
  biome_hats: "wiki: Feather Tribe, Chapka, Mushroom Hat, Turban, Diving Suit, Heatmask Hat 3000 gold, 10% shield in their biome; speed 1.05 guess; ids from the client table (3, 30, 31, 49, 64, 67)",
  test_gold: "test only: chat /testgold grants test_gold, /testxp N adds N XP, /testdie kills (after the spawn shield), all only when TIO_SOCIAL_TEST=1",
  chat: "sp5 rows 7403/7408 tm 1 -> bubble {i,m,mt 1} + log {m,tm 62 (sp5 51),s role,n,p id}; tm 0 rows 7779/7783 bubble only (world.js)",
  bubble_delivery: "bubble only after the receiver has the sender in its world.js view set (else waits up to bubble_wait_ms, guess), fix for the proof runs where B got the log but not the bubble",
  chat_bubble_scope: "sp5: mt 1 bubbles only ever came from team members (148 of 148); non-member view is a guess",
  picks: "sp5 rows 38669..39194 after respawn: one pick per level 1..11 in order; first life Stone Axe L1 .. Amethyst Axe L15",
  pick_free: "sp5: no inventory drop on picks (Golden Axe row 12896 delta is gathering); cost is paid on use",
  item_count: "sp5: B = id*256 + placed count of the slot group, sent iff the item has a previous item in its chain (rows 1934, 4339, 5010, 15514 = 268*256+5, 16830, 38735, 39169); first-of-chain picks (Stone Shield 7122, Saddle 9112, Boost Pad 14458) get none",
  picks_reset: "sp5: after death (rows 25368, 37396) the picks restart at level 1 (rows 26814, 38669); client resets its panel too",
  item_tree: "client _5465 table: level, previous item (_5519), slot group (_5479); start items _5469",
  blast_gun: "invented (owner request): the Air Blast Gun in item slot 17 (Enchanted Spear Level 1, never given in this clone), the last pick at age 28 (with the staffs), it takes the primary weapon's bar slot (TREE 17 = [28], SWAP); no upgrades. Client name, description, tooltip and pick level: tools/invented/client_patch.js; purple art: tools/invented/make_blast.py; behaviour: world.js blast, numbers game_config blast",
  age: "client XP handler level curve; same formula as world.js ageOf (Stone Axe L1 at xp 43, Cookie L2 at 133, Golden Axe L6 at 856)",
  counters: "client: atl4 37 n 0..5 = kill, animal-kill, boss-kill, animal-tame, bug-catch, building counters, o = value; sp5 rows 12036 (n 1 o 1), 16535 (n 2 o 1, boss), 42275 (n 3 o 1, tame); after death n 1 restarts at o 1 (row 27854); kill XP/loot belong to creatures.js",
};
const ageOf = (xp) => Math.min(60, Math.floor((Math.sqrt(1 + 4 * (Math.max(0, xp - 1) * 2 / 40)) - 1) / 2));
const clean = (s, n) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, "").trim().slice(0, n);

function S(w) { return w.ext.social; }
function st(w, p) {
  const s = S(w);
  let x = s.ps.get(p.n);
  if (!x) { x = { hats: new Set(), wings: new Set(), hat: 0, wing: 0, team: null, picks: new Set(START), levels: new Set(), counts: [0, 0, 0, 0, 0, 0], bJson: CFG.json_burst, bPick: CFG.pick_burst, tB: Date.now(), lastChat: 0, lastAsk: {} }; s.ps.set(p.n, x); }
  return x;
}
function refill(x, now) {
  const dt = Math.max(0, now - x.tB) / 1000; x.tB = now;
  x.bJson = Math.min(CFG.json_burst, x.bJson + dt * CFG.json_per_s); x.bPick = Math.min(CFG.pick_burst, x.bPick + dt * CFG.pick_per_s);
}
function spend(w, p, x, key) {
  refill(x, Date.now());
  if (x[key] < 1) { S(w).dropped++; if (S(w).dropped % 50 === 1) w.L({ k: "social_rate", n: p.n, key, dropped: S(w).dropped }); return false; }
  x[key] -= 1; return true;
}
const placedOf = (p, id) => (p.placed && p.placed[id]) || 0;
function groupOf(id) { const t = TREE[id]; return t && t[2] != null ? t[2] : null; }
function placedGroup(p, id) {
  const g = groupOf(id);
  if (p.placedG) return g == null ? 0 : p.placedG[g] || 0;
  if (g == null) return placedOf(p, id);
  let n = 0; for (const k of Object.keys(TREE)) if (TREE[k][2] === g) n += placedOf(p, +k);
  return n;
}

// ------------------------------------------------------------ age-up picks
function canPick(w, p, x, id) {
  const t = TREE[id]; if (!t || t[0] < 1) return "unknown";
  if (x.picks.has(id)) return "owned";
  if (t[0] > ageOf(p.xp || 0)) return "age";
  if (x.levels.has(t[0])) return "level_used";
  if (t[1] != null && !x.picks.has(t[1])) return "needs_prev";
  return null;
}
function pick(w, p, id) {
  const x = st(w, p);
  if (!p.alive) { w.L({ k: "pick_refused", n: p.n, item: id, why: "dead" }); return; }
  if (!spend(w, p, x, "bPick")) return;
  const why = p.god ? (TREE[id] ? null : "unknown") : canPick(w, p, x, id);
  if (why) { w.L({ k: "pick_refused", n: p.n, item: id, why }); return; }
  const out = SWAP.has(id) ? swapOut(w, x, id) : null;
  x.picks.add(id); x.levels.add(TREE[id][0]);
  if (out != null && p.held === out) { p.held = id; p.pending = p.pending || {}; p.pending["8"] = id; }
  if (TREE[id][1] != null) p.queue({ "1": T_ITEMCOUNT, B: [id * 256 + (p.god ? 0 : placedGroup(p, id))] });
  const it = w.ctx && w.ctx.ITEMS && w.ctx.ITEMS[id];
  if (it && it.cat === CAT_TOOL) { p.held = id; p.pending = p.pending || {}; p.pending["8"] = id; }
  w.L({ k: "pick", n: p.n, item: id, level: TREE[id][0] });
}
// held = picked and not replaced by a later item of its chain
function canHold(w, p, id) {
  if (p.god) return true;
  if (!S(w)) return true;
  const x = st(w, p);
  if (!x.picks.has(id) || (x.swapped && x.swapped.has(id))) return false;
  for (const o of x.picks) if (TREE[o] && TREE[o][1] === id) return false;
  return true;
}

// ------------------------------------------------------------ clans
const role = (t, p) => (t.leader === p ? 2 : 1);
const teamField = (p, x) => (x.team ? x.team.id * 2 + (x.team.leader === p ? 1 : 0) : 0);
function setField(w, p) {
  const x = st(w, p), v = teamField(p, x);
  p.cf = Object.assign(p.cf || {}, { "14": v });
  if (p.ent) w.touch(p.ent, { "14": v });
}
function wrapCreate(w, p) {
  if (p._socialWrap || typeof p.createFields !== "function") return;
  p._socialWrap = true;
  if (/this\.cf\b/.test(String(Object.getPrototypeOf(p).createFields || ""))) return;
  const orig = p.createFields;
  p.createFields = function () { const f = orig.call(this); if (this.cf) Object.assign(f, this.cf); return f; };
}
function row(t, p) { return [p.name || "", p.n, p.alive ? 1 : 0, t.next === p ? 1 : 0, p.id || 0, 0]; }
function membersMsg(t) {
  const list = [t.leader].concat([...t.members].filter((q) => q !== t.leader));
  return { "1": T_CLAN, m: M.MEMBERS, p: t.hide, o: list.map((q) => row(t, q)) };
}
function info(t, p) {
  const o = { n: t.name, x: t.id };
  if (t.leader === p) { o.l = 1; o.lo = t.lo; o.jo = t.jo; }
  return { "1": T_CLAN, m: M.INFO, o };
}
function teamList(w) { return [...S(w).teams.values()].map((t) => [t.id, t.name]); }
function create(w, p, x, name) {
  if (x.team || typeof name !== "string") return;
  name = clean(name, CFG.clan_name_max);
  const s = S(w);
  if (!name || [...s.teams.values()].some((t) => t.name === name)) return;
  const t = { id: s.nextTeam++, name, leader: p, members: new Set([p]), next: null, hide: 0, lo: 0, jo: 0, reqs: [], posAt: Date.now() + CFG.pos_ms[0] };
  s.teams.set(t.id, t); x.team = t;
  p.queue({ "1": T_CLAN, m: M.INFO, o: { l: 1, n: name, x: t.id } });
  p.queue(membersMsg(t));
  w.broadcast({ "1": T_CLAN, m: M.ADD, o: [t.id, name] });
  setField(w, p);
  w.L({ k: "clan_create", n: p.n, id: t.id, name });
}
function removeTeam(w, t) {
  S(w).teams.delete(t.id);
  for (const q of t.members) { const y = st(w, q); y.team = null; q.queue({ "1": T_CLAN, m: M.LEFT }); setField(w, q); }
  t.members.clear();
  w.broadcast({ "1": T_CLAN, m: M.DEL, o: t.id });
  w.L({ k: "clan_delete", id: t.id });
}
function dropMember(w, t, q) {
  t.members.delete(q); if (t.next === q) t.next = null;
  const y = st(w, q); y.team = null;
  q.queue({ "1": T_CLAN, m: M.LEFT }); setField(w, q);
}
function promote(w, t, q) {
  const old = t.leader; t.leader = q; if (t.next === q) t.next = null;
  if (old && t.members.has(old)) { old.queue({ "1": T_CLAN, m: M.MEMBER }); old.queue(membersMsg(t)); setField(w, old); }
  q.queue({ "1": T_CLAN, m: M.LEADER }); q.queue(info(t, q)); setField(w, q);
  w.L({ k: "clan_leader", n: q.n, id: t.id, from: old ? old.n : null });
}
function leave(w, p, x, gone) {
  const t = x.team; if (!t) return;
  w.L({ k: "clan_leave", n: p.n, id: t.id, leader: t.leader === p, gone: !!gone });
  if (t.leader !== p) { dropMember(w, t, p); if (gone) x.team = null; return; }
  if (!gone || t.members.size <= 1) { removeTeam(w, t); return; }
  t.members.delete(p); x.team = null;
  const nx = t.next && t.members.has(t.next) ? t.next : [...t.members][0];
  t.leader = null; promote(w, t, nx);
}
function byUid(t, uid) { for (const q of t.members) if (q.n === Number(uid)) return q; return null; }
function ask(w, p, x, name) {
  if (x.team || typeof name !== "string") return;
  const t = [...S(w).teams.values()].find((q) => q.name === name);
  if (!t || t.lo || t.members.size >= CFG.clan_max_members) return;
  const now = Date.now();
  if (now - (x.lastAsk[t.id] || 0) < CFG.req_repeat_ms) return;
  for (const k of Object.keys(x.lastAsk)) if (!S(w).teams.has(+k)) delete x.lastAsk[k];
  x.lastAsk[t.id] = now;
  t.reqs = t.reqs.filter((r) => r.p !== p && now - r.at < CFG.req_ttl_ms);
  t.reqs.push({ p, at: now });
  t.leader.queue({ "1": T_CLAN, m: M.REQ, o: p.name || "", n: p.id || 0, p: 0 });
  w.L({ k: "clan_ask", n: p.n, id: t.id });
}
function accept(w, p, x) {
  const t = x.team; if (!t || t.leader !== p) return;
  const now = Date.now();
  while (t.reqs.length) {
    const r = t.reqs.pop(), y = st(w, r.p);
    if (now - r.at > CFG.req_ttl_ms || r.p.closed || y.team || !S(w).ps.has(r.p.n)) continue;
    if (t.members.size >= CFG.clan_max_members) return;
    t.members.add(r.p); y.team = t;
    r.p.queue(info(t, r.p)); setField(w, r.p);
    w.L({ k: "clan_accept", n: p.n, id: t.id, member: r.p.n });
    return;
  }
}
function open(w, p, x) {
  const t = x.team;
  if (!t) p.queue({ "1": T_CLAN, m: M.NAMES, o: [...S(w).teams.values()].map((q) => q.name) });
  else if (t.members.size > 1) p.queue(membersMsg(t));
  else p.queue({ "1": T_CLAN, m: M.EMPTY });
}
function clanAction(w, p, msg) {
  const x = st(w, p);
  if (!spend(w, p, x, "bJson")) return;
  const o = msg.o, n = msg.n, t = x.team, lead = t && t.leader === p;
  switch (o) {
    case O.OPEN: open(w, p, x); break;
    case O.CREATE: create(w, p, x, n); break;
    case O.ASK: ask(w, p, x, n); break;
    case O.ACCEPT: accept(w, p, x); break;
    case O.DECLINE: if (lead) { const r = t.reqs.pop(); w.L({ k: "clan_decline", n: p.n, id: t.id, member: r ? r.p.n : null }); } break;
    case O.LEAVE: leave(w, p, x, false); break;
    case O.KICK: if (lead) { const q = byUid(t, n); if (q && q !== p) { dropMember(w, t, q); p.queue(membersMsg(t)); w.L({ k: "clan_kick", n: p.n, id: t.id, member: q.n }); } } break;
    case O.LEADER: if (lead) { const q = byUid(t, n); if (q && q !== p) promote(w, t, q); } break;
    case O.NEXT: if (lead) { const q = byUid(t, n); if (q && q !== p) { t.next = q; p.queue(membersMsg(t)); } } break;
    case O.HIDE: if (lead) { t.hide = n ? 1 : 0; w.L({ k: "clan_lock", n: p.n, id: t.id, what: "hide_leader", v: t.hide }); } break;
    case O.LOCKJOIN: if (lead) { t.jo = n ? 1 : 0; w.L({ k: "clan_lock", n: p.n, id: t.id, what: "join", v: t.jo }); } break;
    case O.LOCK: if (lead) { t.lo = n ? 1 : 0; if (t.lo) t.reqs = []; w.L({ k: "clan_lock", n: p.n, id: t.id, what: "team", v: t.lo }); } break;
    case O.CLOSE: break;
    default: return;
  }
}
function positions(w, t) {
  const div = w.P.minimap_div || 69.5, o = [];
  const at = (q) => [Math.round(q.x / div), Math.round(q.y / div)];
  if (!t.hide && t.leader && t.leader.ent) o.push(...at(t.leader), 0);
  for (const q of t.members) if (q !== t.leader && q.ent && q.alive) o.push(...at(q), q.id);
  const m = { "1": T_CLAN, m: M.POS, o };
  for (const q of t.members) q.queue(m);
}

// ------------------------------------------------------------ hat shop
const owned = (x) => ({ "1": T_OWNED, H: [...x.hats], W: [...x.wings] });
function applyMods(w, p, x) {
  if (!p.mods) return;
  const m = { speed: 1, dmg_taken: 1, gather_bonus: {}, regen_per_s: 0, xp_mult: 1, pad_immune: false, wdmg: {}, hand_flat: 0, glove_mult: 1, bdmg: 1,
    kb_mult: 1, ko_mult: 1, wrench_mult: 1, food_kill_mult: 1, pet_xp_mult: 1, tame_mult: 1, hide_board: false, mill_gold: 0, wreck_mult: 1,
    pet_type: {}, pet_species: {}, type_resist: {}, appletor_mult: 1, trap_mult: 1, trap_reload: 1, magician: false, steal: 0, mount_buff: 1, bug_dup: 0, net_speed: 1, lucky: false, status_immune: false };
  const santa = x.hat === 35 && w.phase === 1 ? { dmg_taken: 0.8, speed: 1.2 } : null;
  for (const fx of [HAT_FX[x.hat], WING_FX[x.wing], BIOME_HAT[x.hat] != null && BIOME_HAT[x.hat] === w.phase ? { dmg_taken: 0.9, speed: 1.05 } : null, santa]) {
    if (!fx) continue;
    for (const [k, v] of Object.entries(fx.wdmg || {})) m.wdmg[k] = (m.wdmg[k] || 1) * v;
    for (const k of ["wrench_mult", "ko_mult", "glove_mult", "bdmg", "kb_mult", "food_kill_mult", "pet_xp_mult", "tame_mult", "wreck_mult", "appletor_mult", "trap_mult", "trap_reload", "mount_buff"]) if (fx[k]) m[k] *= fx[k];
    for (const g of ["pet_type", "pet_species"]) for (const [k, v] of Object.entries(fx[g] || {})) m[g][k] = (m[g][k] || 1) * v;
    for (const [k, v] of Object.entries(fx.type_resist || {})) m.type_resist[k] = Math.min(m.type_resist[k] || 1, v);
    if (fx.magician) m.magician = true;
    if (fx.bug_dup) m.bug_dup = Math.max(m.bug_dup || 0, fx.bug_dup);
    if (fx.net_speed) m.net_speed = fx.net_speed;
    if (fx.lucky) m.lucky = true;
    if (fx.status_immune) m.status_immune = true;
    if (fx.steal) m.steal += fx.steal;
    if (fx.hand_flat) m.hand_flat += fx.hand_flat;
    if (fx.mill_gold) m.mill_gold += fx.mill_gold;
    if (fx.hide_board) m.hide_board = true;
    if (fx.speed) m.speed *= fx.speed;
    if (fx.dmg_taken) m.dmg_taken *= fx.dmg_taken;
    if (fx.xp_mult) m.xp_mult *= fx.xp_mult;
    if (fx.regen_per_s) m.regen_per_s += fx.regen_per_s;
    if (fx.pad_immune) m.pad_immune = true;
    for (const [k, n] of Object.entries(fx.gather_bonus || {})) m.gather_bonus[k] = (m.gather_bonus[k] || 0) + n;
  }
  Object.assign(p.mods, m);
}
function cosmetic(w, p, x) {
  applyMods(w, p, x);
  const v = (x.hat & 255) + ((x.wing & 255) << 8);
  p.cf = Object.assign(p.cf || {}, { [F_COSMETIC]: v });
  if (p.ent) w.touch(p.ent, { [F_COSMETIC]: v });
}
function shop(w, p, op, v) {
  const x = st(w, p), cat = v & 255, id = (v >> 8) & 0xffff;
  if (op === SHOP.OPEN || op === SHOP.CLOSE) return;
  if (!spend(w, p, x, "bJson")) return;
  const tab = cat === 0 ? HAT_PRICE : cat === 1 ? WING_PRICE : null, own = cat === 0 ? x.hats : x.wings;
  if (op === SHOP.CRAFT || !tab || !tab[id]) { w.L({ k: "shop_refused", n: p.n, op, cat, id, why: op === SHOP.CRAFT ? "craft_not_implemented" : "unknown" }); return; }
  if (op === SHOP.BUY) {
    const price = tab[id][0], gold = (p.inv && p.inv[GOLD]) || 0;
    if (own.has(id) || id === 0 || (!tab[id][1] && !p.god) || gold < price) {   // admins may buy unlisted (event) hats and wings too
      w.L({ k: "shop_refused", n: p.n, cat, id, price, gold, why: own.has(id) ? "owned" : gold < price ? "gold" : "not_sold" });
      p.queue(owned(x));
      return;
    }
    p.inv[GOLD] = gold - price; own.add(id);
    p.queue({ "1": T_INV, i: { [GOLD]: p.inv[GOLD] } });
    w.L({ k: "shop_buy", n: p.n, cat, id, price, gold: p.inv[GOLD] });
  } else if (op === SHOP.EQUIP) {
    if (id !== 0 && !own.has(id)) { w.L({ k: "shop_refused", n: p.n, cat, id, why: "not_owned" }); return; }
    if (cat === 0) x.hat = id; else x.wing = id;
    cosmetic(w, p, x);
    w.L({ k: "shop_equip", n: p.n, cat, id });
  }
}

// ------------------------------------------------------------ chat
// a bubble needs the sender's create on the receiver first: world.js visibility set, else fresh positions
function inView(w, q, p, box) {
  if (!q.ent || !p.ent) return false;
  const V = w.P[box] || (box === "view_create" ? [1370, 933] : [1521, 1053]);
  return Math.abs(q.ent.x - p.ent.x) < V[0] && Math.abs(q.ent.y - p.ent.y) < V[1];
}
function sees(w, q, p) {
  if (!q.ent || !q.alive || q.closed || !p.ent || p.ent.id == null) return false;
  if (q.vis instanceof Set) return q.vis.has(p.ent.id);
  return inView(w, q, p, "view_create");
}
function flushBubbles(w, now) {
  const s = S(w); if (!s.bubbles.length) return;
  s.bubbles = s.bubbles.filter((b) => {
    if (b.q.closed || now > b.until || !b.p.ent || b.p.ent.id !== b.m.i) return false;
    if (sees(w, b.q, b.p)) { b.q.queue(b.m); return false; }
    return true;
  });
}
function chat(w, p, msg) {
  if (process.env.TIO_SOCIAL_TEST === "1" && msg.msg === "/testgold" && p.alive) {
    p.inv[GOLD] = ((p.inv && p.inv[GOLD]) || 0) + CFG.test_gold;
    p.queue({ "1": T_INV, i: { [GOLD]: p.inv[GOLD] } });
    w.L({ k: "test_gold", n: p.n, gold: p.inv[GOLD] });
    return true;
  }
  if (process.env.TIO_SOCIAL_TEST === "1" && typeof msg.msg === "string" && /^\/testxp \d{1,6}$/.test(msg.msg) && p.alive && p.addXp) {
    p.addXp(+msg.msg.slice(8), "test");
    w.L({ k: "test_xp", n: p.n, xp: p.xp });
    return true;
  }
  if (process.env.TIO_SOCIAL_TEST === "1" && msg.msg === "/testdie" && p.alive && p.ent) {
    w.damage(p, (p.hp || 100) + 1, null);
    w.L({ k: "test_die", n: p.n });
    return true;
  }
  if (!msg.tm) return false;
  const x = st(w, p), t = x.team;
  if (!t || typeof msg.msg !== "string") return false;
  const now = Date.now();
  if (!p.alive || !p.ent || now - x.lastChat < (w.P.chat_min_ms || 700)) return true;
  x.lastChat = now;
  const text = clean(msg.msg, w.P.chat_max_len || 80);
  if (!text) return true;
  const bubble = { "1": T_CHAT, i: p.id, m: text, mt: 1 };
  const log = { "1": T_CHAT, m: text, tm: TM_CLAN, s: role(t, p), n: p.name || "", p: p.id };
  for (const q of t.members) {
    q.queue(log);
    if (q === p || sees(w, q, p)) q.queue(bubble);
    else if (q.alive && inView(w, q, p, "view_remove")) S(w).bubbles.push({ q, p, m: bubble, until: now + CFG.bubble_wait_ms });
  }
  if (w.logChat) w.logChat({ name: p.name || "", text, team: t.id, to: null });
  w.L({ k: "clan_chat", n: p.n, id: t.id, len: text.length });
  return true;
}

// ------------------------------------------------------------ counters (atl4 37: n = counter, o = value)
function count(w, p, which) {
  if (!p || !S(w)) return;
  const x = st(w, p), n = typeof which === "number" ? which : COUNTER[which];
  if (!(n >= 0 && n <= 5)) return;
  x.counts[n]++;
  if (n !== COUNTER.buildings || CFG.send_building_counter) p.queue({ "1": T_COUNT, o: x.counts[n], n });
}
function killed(w, by, target) {
  if (!by || !target || target._socialKill) return;
  target._socialKill = true;
  count(w, by, COUNTER.animals);
  if (target.boss) count(w, by, COUNTER.bosses);
}

// plain counts for soak tests; stale_* should stay 0
function stats(w) {
  const s = S(w); if (!s) return null;
  let members = 0, pending = 0, lastAsk = 0, staleMembers = 0, staleReqs = 0, staleLeaders = 0, ps = 0, stalePs = 0;
  const live = (p) => p && !p.closed && w.players && w.players.get(p.n) === p;
  for (const t of s.teams.values()) {
    members += t.members.size; pending += t.reqs.length;
    for (const q of t.members) if (!live(q)) staleMembers++;
    for (const r of t.reqs) if (!live(r.p)) staleReqs++;
    if (!live(t.leader)) staleLeaders++;
  }
  for (const [n, x] of s.ps) { ps++; lastAsk += Object.keys(x.lastAsk).length; if (!w.players || !w.players.has(n)) stalePs++; }
  return { clans: s.teams.size, members, pending_requests: pending, ps, rate_limiter_entries: ps, last_ask_entries: lastAsk,
    stale_ps: stalePs, stale_members: staleMembers, stale_requests: staleReqs, stale_leaders: staleLeaders, dropped_by_rate: s.dropped, pending_bubbles: s.bubbles.length, next_clan_id: s.nextTeam };
}

module.exports = {
  name: "social",
  ownsTypes: [T_OWNED],   // the owned hat/wing list (66 {H, W}) is per player: no static replay
  CFG, SOURCES, TREE, START, M, O, SHOP, HAT_PRICE, WING_PRICE, HAT_FX, WING_FX, BIOME_HAT, stats, groupOf, placedGroup, canHold: (w, p, id) => canHold(w, p, id),
  attach(w) {
    w.ext.social = { teams: new Map(), ps: new Map(), nextTeam: CFG.clan_first_id, dropped: 0, bubbles: [], hasKill: typeof w.killed === "function",
      count: (p, which) => count(w, p, which), canHold: (p, id) => canHold(w, p, id), team: (p) => (st(w, p).team || null) };
  },
  onJoin(w, p) {
    const x = st(w, p); wrapCreate(w, p);
    x.hats.add(GOOFY_HAT); p.queue(owned(x));   // owner: the goofy hat is owned but not worn by default
    p.queue({ "1": T_CLAN, m: M.LIST, o: teamList(w) });
    setField(w, p);
  },
  onRespawn(w, p) {
    const x = st(w, p);
    x.picks = new Set(START); x.levels = new Set(); x.swapped = new Set(); x.counts = [0, 0, 0, 0, 0, 0];
    wrapCreate(w, p);
    if (x.team) p.queue(info(x.team, p));
    x.hats.add(GOOFY_HAT);
    if (x.hats.size || x.wings.size) p.queue(owned(x));
    x.hat = 0; x.wing = 0; cosmetic(w, p, x);
    setField(w, p);
  },
  onLeave(w, p) {
    const s = S(w), x = s.ps.get(p.n); if (!x) return;
    leave(w, p, x, true);
    for (const t of s.teams.values()) t.reqs = t.reqs.filter((r) => r.p !== p);
    s.ps.delete(p.n);
  },
  onDeath(w, p, by) { if (by && by !== p && by.alive !== undefined && by.queue) count(w, by, COUNTER.kills); },
  onKill(w, by, target) { S(w).hasKill = true; killed(w, by, target); },
  onHit(w, by, target, dmg) {
    if (S(w).hasKill || !by || !by.queue || !target) return dmg;
    if (target.kind !== "player" && target.kind !== "static" && target.kind !== "placed" && typeof target.hp === "number" && target.hp > 0 && target.hp - dmg <= 0) killed(w, by, target);
    return dmg;
  },
  onJson(w, p, msg) {
    if (msg.type === T_CLAN) { if (p.joined) clanAction(w, p, msg); return true; }
    if (msg.type === T_CHAT) return chat(w, p, msg);
    return false;
  },
  onOp(w, p, op, v) {
    if (op === OP_PICK) { pick(w, p, v); return true; }
    if (op === SHOP.OPEN || op === SHOP.CLOSE || op === SHOP.BUY || op === SHOP.EQUIP || op === SHOP.CRAFT) { if (p.joined) shop(w, p, op, v); return true; }
    return false;
  },
  onBiome(w) { for (const p of w.players.values()) { const x = S(w).ps.get(p.n); if (x && (BIOME_HAT[x.hat] != null || x.hat === 35)) applyMods(w, p, x); } },
  tick(w, now) {
    flushBubbles(w, now);
    for (const t of S(w).teams.values()) {
      if (now < t.posAt) continue;
      t.posAt = now + CFG.pos_ms[0] + Math.random() * (CFG.pos_ms[1] - CFG.pos_ms[0]);
      if (t.members.size > 1) positions(w, t);
      if (t.reqs.length) t.reqs = t.reqs.filter((r) => now - r.at < CFG.req_ttl_ms);
    }
  },
};
