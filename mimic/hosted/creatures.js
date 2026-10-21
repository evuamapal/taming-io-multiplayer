// Creatures plugin for hosted/world.js: wild animals per biome phase (wander, aggro, attacks, death, respawn), the own pet
// (spawned with the player as id = own id + 1, follows, fights, dies, back next life), pet commands (JSON 48), taming
// (JSON 45), creature skill projectiles (category 4) and turret shots (aim + field 9 = 17 + category 2 flash).
// Numbers are from the Sao Paulo #5 human capture (mimic/data/sp3_feature_inventory.md, tools/sp3); "guess" marks the
// ones the capture does not show. Per-species values (key = field 21) can be overridden with hosted_config.json
// game.creatures {species: {...}}.
// Dev only: with env TIO_CREATURES_TEST=1, JSON {type: 990, kind: S, d, a, hp, clear, target} moves the nearest creature
// of species S (field 21) next to the sender, optionally clearing other wild creatures within clear; {type: 990, pet: 1, sp, hpfrac, d, a} moves the
// sender's pet next to him and makes it stay; {type: 990, xp: N} adds XP; who: NAME applies it to that player instead,
// tame: true then starts taming the placed creature for him, cast: true casts his pet's skill; {type: 990, phase: B} switches the biome to B; {type: 990, cfg: {...}} sets C values (used by bin/test_creatures.js and work/creature_shots.py).
"use strict";
const fs = require("fs"), path = require("path");

const TAU = 2 * Math.PI;
const norm = (a) => ((a % TAU) + TAU) % TAU;
const ang255 = (a) => Math.round(norm(a) / TAU * 255) % 256;
const ang200 = (a) => Math.round(norm(a) * 200);
const J = { TAME: 45, PET: 48, TEST: 990, RELEASE: 2, RENAME: 37 };   // RENAME: client {type, i: pet id, n: name} (pet card rename)
const T_OWNINFO = 59, T_CREATE = 79, T_COUNTER = 44;

// Creature identity: field 21 is the species (index into the client's creature table, same order on every server and in
// the pinned client), field 22 its type (element, sent unchanged), field 23 the growth stage (0 baby, 1 adult, 2 boss,
// 3 giant). SPECIES: index -> [client display name (= wiki page name), skill projectile id (category 4 field 7)].
const SPECIES = {
  0: ["Wolf", 0], 1: ["Rabbit", 40], 2: ["Bear", 42], 3: ["Fox", 45], 4: ["Polecat", 60], 5: ["Skunk", 60],
  6: ["Bull", 77], 7: ["Cow", 78], 8: ["Horse", 108], 9: ["Snow Wolf", 145], 10: ["Snow Rabbit", 115],
  11: ["Polar Bear", 146], 12: ["Snow Fox", 147], 13: ["Reindeer", 111], 14: ["Lynx", 19], 15: ["Deer", 110],
  16: ["Boar", 63], 17: ["Water Fairy", 126], 18: ["Fire Fairy", 122], 19: ["Plant Fairy", 116],
  20: ["Dragon", 38], 21: ["Ice Golem", 173], 22: ["Iceberg", 177], 23: ["Barn Owl", 207], 24: ["Raven", 179],
  25: ["Bat", 229], 26: ["Goldfish", 232], 27: ["Easter Bunny", 237], 28: ["Rabbat", 234], 29: ["Rabbid", 264],
  30: ["White Spider", 44], 31: ["Black Spider", 230], 32: ["Living Mushroom", 29], 33: ["Sheep", 176],
  34: ["Unicorn", 79], 35: ["Spectrum", 134], 36: ["Combat Fairy", 129], 37: ["Ice Fairy", 131],
  38: ["Normal Fairy", 130], 39: ["Rat", 61], 40: ["Ibex", 133], 41: ["Mammoth", 371], 42: ["Fennec Fox", 55],
  43: ["Armadillo", 83], 44: ["Yellow Scorpion", 231], 45: ["Rock Fairy", 125], 46: ["Dragon Fairy", 123],
  47: ["Camel", 39], 48: ["Black Cat", 263], 49: ["Vulture", 178], 50: ["Electric Fairy", 120],
  51: ["Poison Fairy", 118], 52: ["Spectrum Fairy", 119], 53: ["Ostrich", 80], 54: ["Krampus", 143],
  55: ["Insect Fairy", 117], 56: ["Giant Mantis", 209], 57: ["Giant Bee", 62], 58: ["Giant Moth", 56],
  59: ["Oryx", 67], 60: ["Rabblow", 114], 61: ["Caracal", 53], 62: ["Stone Golem", 235], 63: ["Menhir", 5],
  64: ["Warg", 240], 65: ["Reaper", 57], 66: ["Kangaroo", 18], 67: ["Toad", 138], 68: ["Flying Squirrel", 225],
  69: ["Turkey", 226], 70: ["Normal Mask", 268], 71: ["Rock Mask", 269], 72: ["Water Mask", 271],
  73: ["Plant Mask", 272], 74: ["Ice Mask", 270], 75: ["Hedgehog", 135], 76: ["Ice Dragon", 32],
  77: ["Sea Crab", 273], 78: ["Squid", 274], 79: ["Seahorse", 17], 80: ["Mauve", 218], 81: ["Rabbyss", 223],
  82: ["Stingray", 46], 83: ["Axolotl", 241], 84: ["Shark", 228], 85: ["Octopus", 136], 86: ["Genie", 238],
  87: ["Siren", 377], 88: ["Plant Statue", 148], 89: ["Fire Statue", 149], 90: ["Water Statue", 151],
  91: ["Dog", 222], 92: ["Acidog", 104], 93: ["Coldog", 87], 94: ["Bugdog", 106], 95: ["Scrappy Shadow", 154],
  96: ["Digger Shadow", 159], 97: ["Pudgy Shadow", 158], 98: ["Guardian Shadow", 155],
  99: ["Adoring Shadow", 157], 100: ["Savant Shadow", 156], 101: ["Gold Golem", 172], 102: ["Penguin", 497],
  103: ["Yeti", 30], 104: ["Inferno Gaze", 160], 105: ["Infesting Gaze", 160], 106: ["Punchy Gaze", 160],
  107: ["Glacial Gaze", 160], 108: ["Spectral Gaze", 160], 109: ["Draconic Gaze", 160],
  110: ["Enchanting Gaze", 160], 111: ["Hellhound", 160], 112: ["Salamander", 161], 113: ["Lizardman", 22],
  114: ["Dark Wisp", 23], 115: ["Fire Wisp", 24], 116: ["Cratodon", 26], 117: ["Floodog", 88],
  118: ["Rexdog", 103], 119: ["Rabburn", 47], 120: ["Seal", 85], 121: ["Volcanic Golem", 121],
  122: ["Mantle", 247], 123: ["Lava Golem", 249], 124: ["Slime", 281], 125: ["Snowman", 127],
  126: ["Snowball", 220], 127: ["Normal Boostling", 160], 128: ["Rock Boostling", 160],
  129: ["Water Boostling", 160], 130: ["Electric Boostling", 160], 131: ["Plant Boostling", 160],
  132: ["Poison Boostling", 160], 133: ["Insect Boostling", 160], 134: ["Combat Boostling", 160],
  135: ["Fire Boostling", 160], 136: ["Ice Boostling", 160], 137: ["Spectrum Boostling", 160],
  138: ["Dragon Boostling", 160], 139: ["Fairy Boostling", 160], 140: ["Ancient Boostling", 160],
  141: ["Fire Dragon", 37], 142: ["Giant Fly", 310], 143: ["Chicken", 89], 144: ["Floren", 91],
  145: ["Pyren", 94], 146: ["Aquen", 93], 147: ["Richen", 90], 148: ["Voltdog", 105], 149: ["Sparken", 92],
  150: ["Silkworm", 311], 151: ["Mimipot", 214], 152: ["Foliroar", 213], 153: ["Spectrum Mask", 152],
  154: ["Poison Mask", 153],
  // invented pets (owner): their own client species slots, appended to the client table by mimic/invented/client_patch.json
  155: ["Grove Colossus", 371], 156: ["Stormhorn", 111], 157: ["Cinder Prowler", 61] };
// an invented species uses its base species' data (stats, wiki, speed, radius, type) wherever it has none of its own
const BASE_SP = { 155: 41, 156: 13, 157: 39 };   // Grove Colossus: mammoth, Stormhorn: reindeer, Cinder Prowler: rat
const bsp = (k) => (BASE_SP[k] != null ? BASE_SP[k] : k);
// STAGES: species -> per growth stage [bite damage, speed u/s, kill gold, kill xp, skill reload ms, size] from the client
// creature table (_782[stage]: _4564, _4558, _3166, _2151, _4796, _793)
const STAGES = {
  0: [[6,200,50,50,30000,50],[12,250,100,100,28000,60],[30,280,2000,400,25000,80],[40,300,10000,1200,25000,105]],
  1: [[3,270,50,50,20000,40],[4,290,100,100,18000,55],[14,370,2000,400,15000,70],[28,320,10000,1200,15000,80]],
  2: [[4,200,50,50,30000,40],[8,240,100,100,28000,80],[19,250,3200,400,25000,126],[32,280,10000,1200,25000,148]],
  3: [[4,240,50,50,30000,50],[8,280,100,100,25000,60],[19,310,2000,400,20000,80]],
  4: [[4,270,50,50,25000,40],[8,290,100,100,22000,55],[19,340,2000,400,20000,65],[20,0,20000,4800,5000,200]],
  5: [[4,280,50,50,25000,40],[8,300,100,100,22000,55],[17,360,2000,400,20000,65]],
  6: [[5,210,50,50,40000,50],[10,250,100,100,35000,70],[26,290,3200,400,30000,90]],
  7: [[4,200,50,50,30000,50],[7,250,100,100,25000,70],[18,280,2800,400,20000,90]],
  8: [[4,280,50,50,26000,50],[8,300,100,100,22000,65],[18,380,2000,400,18000,80]],
  9: [[5,220,50,50,30000,50],[11,260,100,100,28000,60],[28,290,2000,400,25000,80],[38,310,10000,1200,25000,105]],
  10: [[3,280,50,50,30000,40],[5,300,100,100,27000,55],[15,380,2000,400,25000,70],[30,0,20000,4500,5000,224]],
  11: [[5,210,50,50,35000,40],[9,250,100,100,32000,80],[22,260,3200,400,30000,126]],
  12: [[5,240,50,50,20000,50],[10,280,100,100,18000,60],[24,310,2000,400,16000,80]],
  13: [[4,290,50,50,28000,50],[10,310,100,100,24000,85],[22,390,4000,400,20000,105]],
  14: [[6,200,50,50,22000,50],[14,250,100,100,20000,60],[30,280,2400,400,18000,80],[40,270,10000,1200,20000,110]],
  15: [[3,260,50,50,25000,50],[7,280,100,100,22000,65],[15,360,2000,400,20000,80],[0,0,20000,4800,14000,229]],
  16: [[4,240,50,50,35000,50],[12,270,100,100,32000,60],[24,310,2800,400,30000,80]],
  17: [[3,270,1000,50,14000,35],[8,290,2000,100,12000,40],[14,390,4000,400,10000,50]],
  18: [[3,270,1000,50,14000,35],[8,290,2000,100,12000,40],[14,390,4000,400,10000,50]],
  19: [[3,270,1000,50,14000,35],[8,290,2000,100,12000,40],[14,390,4000,400,8000,50]],
  20: [[6,210,50,50,20000,45],[12,230,100,100,18000,70],[30,270,4000,500,16000,88],[40,0,20000,4000,5000,230]],
  21: [[5,190,100,50,38000,45],[11,220,400,90,36000,70],[24,240,5000,500,34000,100],[60,0,20000,5700,5000,230]],
  22: [[7,200,100,50,32000,45],[16,220,200,90,28000,60],[30,260,3500,500,24000,90]],
  23: [[3,200,50,50,32000,35],[10,250,100,100,32000,40],[18,280,2000,400,28000,50]],
  24: [[4,220,50,50,22000,35],[12,270,100,100,18000,40],[20,300,2000,400,14000,50],[34,290,10000,1200,19000,95]],
  25: [[4,250,50,50,24000,35],[10,270,100,100,22000,40],[15,330,2000,400,20000,50]],
  26: [[1,170,50,50,20000,45],[2,200,100,100,20000,85],[20,235,3200,400,35000,100]],
  27: [[3,260,50,50,40000,40],[5,280,100,100,35000,55],[16,350,3000,400,30000,70]],
  28: [[3,270,50,50,24000,35],[6,290,100,100,20000,45],[18,380,2500,400,16000,50]],
  29: [[3,240,50,50,18000,40],[8,260,100,100,14000,55],[24,340,2500,400,9000,70]],
  30: [[6,220,50,50,22000,50],[11,240,100,100,18000,60],[16,280,2400,400,14000,80]],
  31: [[7,240,50,50,22000,50],[15,260,100,100,20000,60],[22,320,2400,400,18000,80],[37,310,10000,1200,18000,105]],
  32: [[6,210,50,50,26000,50],[14,255,1000,100,24000,70],[28,280,5000,500,22000,80]],
  33: [[3,240,50,50,15000,40],[4,260,100,100,12000,55],[16,340,2000,400,9000,70]],
  34: [[3,300,50,50,24000,50],[9,320,100,100,20000,65],[20,400,4000,400,16000,80]],
  35: [[5,240,50,50,24000,32],[15,265,100,100,20000,50],[28,290,2000,400,16000,62],[12,0,20000,4200,5000,200]],
  36: [[3,270,1000,50,15000,35],[8,290,2000,100,12000,40],[14,390,4000,400,10000,50]],
  37: [[3,270,1000,50,15000,35],[8,290,2000,100,12000,40],[14,390,4000,400,11000,50]],
  38: [[3,270,1000,50,12000,35],[8,290,2000,100,10000,40],[14,390,4000,400,8000,50]],
  39: [[5,250,50,50,28000,35],[12,300,100,100,24000,40],[18,350,2000,400,18000,50]],
  40: [[4,220,50,50,28000,40],[7,250,100,100,24000,55],[22,310,2000,400,18000,70]],
  41: [[6,210,200,50,28000,60],[12,240,1500,150,24000,100],[25,260,4000,600,20000,134],[34,260,15000,1400,25000,160]],
  42: [[4,240,50,50,25000,40],[8,290,100,100,22000,55],[19,320,2000,400,17000,65]],
  43: [[3,220,50,50,35000,55],[6,270,100,100,30000,60],[12,300,3200,400,25000,75]],
  44: [[7,220,50,50,18000,70],[14,240,100,100,14000,80],[28,270,2400,400,10000,100]],
  45: [[3,270,1000,50,28000,35],[8,290,2000,100,24000,40],[14,390,4000,400,20000,50]],
  46: [[3,270,1000,50,21000,35],[8,290,2000,100,18000,40],[14,390,4000,400,15000,50]],
  47: [[4,250,50,50,28000,40],[10,280,100,100,24000,70],[20,320,2000,400,20000,90],[36,300,10000,1200,20000,125]],
  48: [[4,260,50,50,18000,40],[9,300,100,100,15000,55],[20,340,2000,400,12000,65]],
  49: [[3,240,50,50,40000,35],[8,280,100,100,35000,40],[16,320,2000,400,30000,50]],
  50: [[3,270,1000,50,20000,35],[8,290,2000,100,16000,40],[14,390,4000,400,12000,50]],
  51: [[3,270,1000,50,20000,35],[8,290,2000,100,16000,40],[14,390,4000,400,12000,50]],
  52: [[3,270,1000,50,22000,35],[8,290,2000,100,18000,40],[14,390,4000,400,14000,50]],
  53: [[4,310,50,50,21000,50],[8,350,100,100,18000,65],[11,400,2000,400,14000,80]],
  54: [[7,210,50,50,28000,60],[16,250,100,100,24000,80],[30,280,4000,400,20000,100]],
  55: [[3,270,1000,50,16000,35],[8,290,2000,100,12000,40],[14,390,4000,400,10000,50]],
  56: [[5,210,50,50,30000,60],[9,260,100,100,27000,70],[24,310,2000,400,25000,85]],
  57: [[3,250,50,50,42000,50],[7,270,100,100,32000,70],[15,340,3200,400,22000,90],[0,300,50,75,0,10]],
  58: [[3,260,50,50,20000,60],[4,280,100,100,16000,70],[14,320,2000,400,12000,80]],
  59: [[3,240,50,50,30000,50],[6,270,100,100,28000,65],[18,320,2000,400,25000,80],[25,380,300,200,6000000,50]],
  60: [[3,240,50,50,26000,40],[8,260,100,100,22000,55],[22,330,2500,400,18000,70]],
  61: [[4,210,50,50,28000,50],[10,260,100,100,24000,60],[22,290,2400,400,18000,80]],
  62: [[5,190,100,50,32000,55],[11,220,400,90,30000,62],[24,240,5000,500,28000,72],[60,0,20000,5700,5000,205]],
  63: [[7,150,100,50,30000,45],[15,180,200,90,30000,60],[24,220,3500,500,30000,80]],
  64: [[8,220,100,50,60000,50],[16,280,200,100,60000,60],[33,320,3000,500,60000,80]],
  65: [[4,270,1000,50,40000,35],[12,290,2000,100,35000,40],[23,390,4000,400,300000,50],[100,400,5000,10000,6000000,60],[27,280,4000,400,6000000,160]],
  66: [[5,210,50,50,28000,65],[12,270,100,100,25000,80],[24,300,2400,400,22000,105]],
  67: [[4,240,50,50,20000,40],[7,270,100,100,16000,55],[16,300,2000,400,12000,70],[26,290,10000,1200,12000,115]],
  68: [[3,290,50,50,28000,50],[6,310,100,100,24000,60],[12,370,2000,400,10000,80],[60,0,20000,4500,5000,160]],
  69: [[5,220,100,50,28000,45],[12,250,200,90,24000,60],[25,290,3500,500,20000,80],[60,280,25000,4000,120000,150]],
  70: [[5,140,100,50,28000,55],[12,160,400,90,24000,62],[22,180,5000,500,20000,72]],
  71: [[5,140,100,50,30000,55],[12,160,400,90,26000,62],[22,180,5000,500,22000,72]],
  72: [[5,140,100,50,32000,55],[12,160,400,90,28000,62],[22,180,5000,500,24000,72]],
  73: [[5,140,100,50,38000,55],[12,160,400,90,34000,62],[22,180,5000,500,30000,72],[60,0,20000,4500,5000,200]],
  74: [[5,140,100,50,32000,55],[12,160,400,90,28000,62],[22,180,5000,500,24000,72]],
  75: [[4,210,50,50,21000,55],[10,260,100,100,18000,60],[22,290,3200,400,15000,75]],
  76: [[6,210,50,50,24000,45],[12,230,100,100,22000,70],[30,270,4000,500,20000,88],[0,0,20000,4500,5000,110]],
  77: [[4,200,50,50,35000,40],[10,220,100,100,30000,70],[22,240,3200,400,25000,90],[37,270,10000,1200,30000,129]],
  78: [[3,200,50,50,28000,40],[7,240,100,100,24000,60],[15,270,2500,300,20000,85],[31,290,10000,1200,12000,115]],
  79: [[3,250,50,50,20000,30],[7,280,100,100,15000,60],[12,360,2000,400,12000,70],[26,340,10000,1200,12000,95]],
  80: [[4,290,50,50,28000,40],[12,310,100,100,28000,55],[22,370,2000,400,28000,70],[27,320,10000,1200,45000,80]],
  81: [[3,240,50,50,24000,40],[8,260,100,100,22000,55],[20,360,2500,400,20000,70]],
  82: [[4,260,50,50,20000,55],[8,280,100,100,18000,60],[16,350,3200,400,16000,75]],
  83: [[3,260,100,50,45000,50],[4,270,200,100,45000,60],[12,330,3000,400,45000,80]],
  84: [[6,220,50,50,30000,50],[12,260,100,100,26000,65],[30,300,2000,400,22000,80],[40,310,15000,1800,20000,155]],
  85: [[4,250,50,50,24000,50],[12,275,100,100,20000,90],[25,310,2000,400,16000,110],[12,0,20000,4800,5000,200]],
  86: [[4,270,1000,50,44000,40],[14,290,2000,100,42000,50],[20,390,4000,400,40000,60],[30,340,10000,1200,30000,85]],
  87: [[3,250,1000,50,24000,40],[8,260,2000,100,20000,50],[15,350,4000,400,16000,60],[20,340,10000,1200,30000,105]],
  88: [[3,220,1000,50,0,35],[6,240,2000,100,0,40],[12,290,4000,400,0,50],[15,280,6000,1200,0,60]],
  89: [[4,200,1000,50,0,35],[14,220,2000,100,0,40],[25,270,4000,400,0,50],[36,280,6000,1200,0,60]],
  90: [[4,210,1000,50,0,35],[16,230,2000,100,0,40],[30,280,4000,400,0,50],[44,270,6000,1200,0,60]],
  91: [[5,280,50,50,26000,50],[12,300,100,100,22000,60],[24,380,2000,400,18000,80],[36,360,10000,1200,18000,105]],
  92: [[5,280,50,50,26000,50],[12,300,100,100,22000,60],[24,380,2000,400,18000,80],[36,370,10000,1200,18000,95]],
  93: [[3,280,50,50,26000,50],[10,300,100,100,22000,60],[20,380,2000,400,18000,80],[30,370,10000,1200,18000,95]],
  94: [[3,280,50,50,26000,50],[10,310,100,100,22000,60],[20,390,2000,400,18000,80],[28,370,10000,1200,18000,95]],
  95: [[2,270,50,50,0,40],[3,290,100,100,0,55],[5,390,1000,200,0,70]],
  96: [[2,270,50,50,0,40],[3,290,100,100,0,55],[7,390,1000,200,0,70]],
  97: [[2,270,50,50,0,40],[3,290,100,100,0,55],[7,390,1000,200,0,70]],
  98: [[2,270,50,50,0,40],[3,290,100,100,0,55],[5,390,1000,200,0,70]],
  99: [[2,270,50,50,0,40],[3,290,100,100,0,55],[6,390,1000,200,0,70]],
  100: [[2,270,50,50,0,40],[3,290,100,100,0,55],[5,390,1000,200,0,70],[34,360,10000,1200,20000,150]],
  101: [[5,210,100,50,0,45],[14,220,400,90,0,70],[30,270,5000,500,0,100],[75,0,100000,15000,5000,320]],
  102: [[4,240,50,50,16000,35],[8,270,100,100,12000,33],[16,330,3200,400,8000,40]],
  103: [[5,195,200,50,45000,75],[14,205,1500,155,40000,110],[28,215,4000,600,35000,160]],
  104: [[0,100,50,50,0,40],[0,100,100,100,0,55],[18,270,2000,500,0,70]],
  105: [[0,100,50,50,0,40],[0,100,100,100,0,55],[14,280,2000,500,0,70]],
  106: [[0,100,50,50,0,40],[0,100,100,100,0,55],[24,270,2000,500,0,70]],
  107: [[0,100,50,50,0,40],[0,100,100,100,0,55],[16,270,2000,500,0,70]],
  108: [[0,100,50,50,0,40],[0,100,100,100,0,55],[16,280,2000,500,0,70]],
  109: [[0,100,50,50,0,40],[0,100,100,100,0,55],[25,280,2000,500,0,70],[15,0,20000,4500,5000,170]],
  110: [[0,100,50,50,0,40],[0,100,100,100,0,55],[20,290,2000,500,0,70]],
  111: [[8,210,50,50,0,55],[14,260,100,100,0,65],[32,290,2200,400,0,80],[42,310,12000,1400,0,115],[34,300,300,400,0,115]],
  112: [[3,240,50,50,26000,50],[9,280,100,100,24000,70],[15,340,2000,400,22000,80],[22,320,10000,1200,20000,105]],
  113: [[3,210,50,50,45000,40],[10,260,100,100,40000,50],[18,290,2000,400,35000,65],[25,270,10000,1200,38000,90]],
  114: [[3,290,50,50,46000,30],[9,310,100,100,30000,50],[15,390,1000,200,14000,60]],
  115: [[3,290,50,50,22000,30],[9,310,100,100,12000,50],[16,390,1000,200,4000,60]],
  116: [[4,210,200,50,34000,70],[14,250,1500,150,32000,85],[27,280,4000,600,30000,110],[38,320,10000,1400,30000,150]],
  117: [[3,280,50,50,27000,50],[8,310,100,100,23000,60],[18,390,2000,400,19000,80],[22,390,10000,1200,16000,95]],
  118: [[3,280,50,50,32000,50],[12,300,100,100,28000,60],[22,370,2000,400,24000,80],[24,370,10000,1200,20000,95]],
  119: [[3,240,50,50,20000,40],[10,270,100,100,16000,55],[26,340,2500,400,12000,70]],
  120: [[3,210,50,50,40000,50],[7,250,100,100,35000,70],[14,290,3200,400,30000,90],[24,290,10000,1200,25000,105]],
  121: [[5,190,100,50,30000,55],[11,230,400,90,28000,62],[28,260,5000,500,26000,72],[60,0,20000,5700,5000,229]],
  122: [[6,170,100,50,32000,65],[12,190,400,90,30000,90],[26,210,5000,500,28000,120]],
  123: [[4,190,100,50,55000,55],[10,230,400,90,50000,62],[22,270,5000,500,45000,72]],
  124: [[5,160,50,50,22000,50],[12,180,100,100,18000,70],[25,220,2000,400,14000,95]],
  125: [[4,220,50,50,16000,35],[9,250,100,100,12000,33],[20,290,3200,400,8000,50],[32,290,10000,1000,6000,90]],
  126: [[4,220,100,50,24000,30],[10,250,200,90,20000,50],[20,290,2000,400,16000,75]],
  127: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  128: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  129: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  130: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  131: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  132: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  133: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  134: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  135: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  136: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  137: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  138: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  139: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  140: [[0,300,50,50,0,30],[0,350,100,100,0,40],[0,420,2000,500,5000,50]],
  141: [[6,210,50,50,24000,45],[12,230,100,100,22000,70],[30,270,4000,500,20000,88],[0,0,20000,4500,5000,110]],
  142: [[3,250,50,50,35000,50],[6,270,100,100,30000,70],[16,320,2800,400,25000,90]],
  143: [[3,220,50,50,30000,25],[12,250,200,90,25000,45],[27,290,3500,500,20000,65],[45,280,10000,1200,20000,85]],
  144: [[3,160,50,50,30000,25],[9,220,100,100,25000,45],[21,300,2000,400,20000,65],[33,290,10000,1200,20000,85]],
  145: [[5,160,50,50,30000,25],[14,200,100,100,25000,45],[27,260,2000,400,20000,65],[50,220,10000,1200,20000,85]],
  146: [[3,160,50,50,30000,25],[7,180,100,100,25000,45],[15,270,2000,400,20000,65],[25,260,10000,1200,20000,85]],
  147: [[4,240,50,50,25000,25],[14,270,200,90,20000,45],[29,310,3500,500,15000,65],[50,300,20000,2400,15000,85]],
  148: [[4,290,50,50,24000,50],[10,310,100,100,20000,60],[20,400,2000,400,16000,80],[26,380,10000,1200,18000,95]],
  149: [[3,170,50,50,30000,25],[9,220,100,100,25000,45],[16,290,2000,400,20000,65],[30,270,10000,1200,20000,85]],
  150: [[2,220,50,50,40000,50],[4,240,100,100,35000,70],[8,260,2800,2000,30000,90]],
  151: [[3,240,50,50,24000,50],[8,280,100,100,18000,80],[15,320,4000,400,12000,100]],
  152: [[4,175,50,50,28000,75],[12,195,100,100,24000,115],[28,205,4000,400,20000,140]],
  153: [[5,140,100,50,34000,55],[12,160,400,90,30000,62],[22,180,5000,500,26000,72]],
  154: [[5,140,100,50,30000,55],[12,160,400,90,26000,62],[22,180,5000,500,22000,72]] };
let WIKI = {};
try { WIKI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "wiki", "animals.json"), "utf8")); } catch (e) { WIKI = {}; }
const STAGE = ["baby", "adult", "boss", "boss"];
const wv = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
// owned pets: the recorded wolf values scaled by the species' wiki stat against the wolf's at the same stage (the
// recorded rabbit run 365 = wolf 270 x wiki 270 / 200); 1 when the wiki has no value
function petScale(sp, st, key) {
  const g = (k) => { const w = SPECIES[k] && WIKI[SPECIES[k][0]], s0 = w && w.stages && w.stages[STAGE[Math.min(3, st | 0)]]; return s0 ? wv(s0[key]) : null; };
  const a = g(bsp(sp)), b = g(C.pet_species);
  return a > 0 && b > 0 ? a / b : 1;
}
function petHp(e, lvl) { return C.pet_hp_by_level[lvl] * (e.inv ? 1 : petScale(e.sp, lvl, "health")); }
// Measured per species (sp5 capture); anything missing comes from the wiki per stage, then DEF.
// mode: aggro (attacks players/pets in aggro range) or retal (only after being hit); hp: {stage: absolute hp} from damage
// vs hp-bar drop; reach: center distance at the hit; every: ms between hits; chase: u/s
const MEAS = {
  31: { mode: "aggro", aggro: 400, reach: 100, dmg: 15, pdmg: 3, every: 2000, chase: 280, hp: { 0: 200, 1: 382 } },
  78: { mode: "aggro", aggro: 450, reach: 84, dmg: 3, pdmg: 3, every: 900, chase: 275, hp: { 0: 191 },
    skill: { k: [274], life: 1100, speed: 0 } },
  79: { mode: "aggro", aggro: 350, reach: 105, dmg: 4, pdmg: 14, every: 1300, chase: 390, hp: { 0: 510, 1: 680 } },
  113: { mode: "aggro", aggro: 500, reach: 190, dmg: 6, pdmg: 10, every: 2400, chase: 360, hp: { 1: 382 } },
  112: { mode: "aggro", aggro: 400, reach: 130, dmg: 2, pdmg: 2, every: 1500 },
  44: { reach: 160, pdmg: 14, every: 2000, chase: 200, hp: { 0: 302, 1: 704 } },
  120: { reach: 120, pdmg: 3, every: 1500, chase: 300, hp: { 1: 1020, 2: 1020 } },
  111: { reach: 220, pdmg: 2, every: 1000, hp: { 2: 510 } },
  49: { chase: 160, hp: { 2: 850 } },
  67: { chase: 370, hp: { 1: 1020 }, skill: { k: [138, 139, 140, 141, 142], life: 950, speed: 420 } },
  57: { pdmg: 3, every: 1200 },
  77: { flee: true, chase: 170, hp: { 1: 711 }, skill: { k: [273], life: 8500, speed: 0 } },
  47: { chase: 260, hp: { 3: 2175 }, skill: { k: [39], life: 6200, speed: 40 } },
  48: { hp: { 1: 350 } }, 64: { chase: 330, hp: { 2: 935 } },
  15: { skill: { k: [110], life: 2000, speed: 0 } },
  2: { skill: { k: [42, 43], life: 4200, speed: 0 } },
  1: { skill: { k: [40], life: 3860, speed: 0 } },
  126: { skill: { k: [220, 267], at_pet: [267], speed: 0 } },
  0: { hp: { 1: 382, 2: 1190 }, skill: { k: [0], life: 3900, speed: 0, follow: true } },
  8: { hp: { 1: 403 }, skill: { k: [108, 108], life: 4000, speed: 420 } },
  20: { boss: true, hp: { 3: 9000 } },   // forest world boss slot: the invented Grove Colossus
  101: { boss: true, hp: { 3: 40000 } },   // Gold Golem world boss (wiki: exactly 40,000 hp)
};
const DEF = { name: "creature", hp: 250, mode: "retal", aggro: 0, reach: 110, dmg: 3, every: 1500, chase: 300 };
const KILL_XP = [50, 100, 400, 1200];
const INSECT_TYPE = { 57: 1, 56: 1, 58: 1, 142: 1, 150: 1 };   // species of type 11 (insects): giant bee, mantis, moth, fly, silkworm
// board ob[2] boss marker index (client table: 0 boss-tree, 1 dragon, 2 ice-golem, 3 boss-mushroom, 4 spectrum, 5 octopus,
// 6 fir-tree, 7 cactus, 8 dark-tree, 9 stone-golem, 10 ice-dragon, 11 gold-golem, 12 gaze-boss, 13 volcanic-golem, 14 fire-dragon)
const BOSS_MARKER_SP = { 20: 1, 21: 2, 35: 4, 62: 9, 76: 10, 85: 5, 101: 11, 121: 13, 141: 14 };
const BOSS_MARKER_PHASE = { 1: 10, 2: 3, 3: 9, 4: 5, 5: 13, 0: 1 };
// world bosses (on unless TIO_WORLD_BOSSES=0): one creature boss per biome phase, standing at the phase's board marker spot.
// Phase -> marker kinds: sp5 board ob per phase (snow 10 + 2, desert 9, sea 5, volcanic 13, forest 1); the spot is the
// recorded marker (game_config boss_markers, sp5) x minimap_div. Kinds 0 boss-tree, 3 boss-mushroom, 6 fir-tree, 7 cactus,
// 8 dark-tree and 12 gaze are world objects, not creatures: no world boss here. Stats: the client creature table at the
// boss stage (kdef), kill loot the same table; respawn and aggro radius: guess.
const WORLD_BOSSES = process.env.TIO_WORLD_BOSSES !== "0";
// Season sets from every capture's board markers by phase (sp5 / sp3 on the clone map, 20261017_053159, _114839, _162036,
// 20261018_045145, 20261018_092322 saopaulo2): forest 1 (+0 boss-tree), winter 10 + 2 (+6 fir-tree), darkness 4 (+3, 8),
// desert 9 (+7 cactus), ocean 5, volcanic 13. Spots: the clone map's own sp5 marker; a kind never seen on it (spectrum 4)
// takes the other map's spot (WB.spots).
// Object-looking bosses are creature stage 3 in the client table (the stage that carries the boss gauge and 8000 hp):
// mushroom boss = Polecat 4 (gauge living-mushroom-master), cactus boss = Deer 15 (gauge cactus-master); wiki: Mushroom
// Boss 8500 hp, Expulsive Bomb 55, Toxic Fog 20 per tick; Cactus Boss 8000-8500 hp, Thorn Puddle 8-9 per tick, Needle
// Shooting 20-30; both spawn fairy waves at 75 / 50 / 25 % (fairyWave) and drop 3 chests (chests: not built).
const WB = { phases: { 0: [1, 11], 1: [10, 2], 2: [4, 3, 8], 3: [9, 7], 4: [5], 5: [13, 14] }, species: { 11: 101, 10: 76, 2: 21, 9: 62, 5: 85, 13: 121, 14: 141, 1: 20, 4: 35, 3: 4, 7: 15, 8: 68 },   // 1: forest = the invented Grove Colossus in the dragon's world-boss slot (stage 3, boss gauge)
  stageBy: { 11: 3, 3: 3, 7: 3, 1: 3, 13: 3, 9: 3, 14: 3, 8: 3, 2: 3, 5: 3 },   // 5: octopus stage 3 in every recording (mexico2, miami3, saopaulo5, frankfurt3)
  // scans 20261018_11 (per-server tables from the client shuffle): world bosses are stage 3 with these types
  // (field 22): Trent 20/73, volcanic golem 121/20, fire dragon 141/20, stone golem 62/29, cactus 15/9
  typeBy: { 1: 73, 13: 20, 14: 20, 9: 29, 7: 9, 8: 9, 2: 45, 5: 21 },
  spots: { 11: [70, 55], 4: [31, 172], 14: [55, 105], 8: [150, 133] },
  // octopus: the marker spot changes per ocean round (8 servers, saopaulo5 two rounds two spots); the boss stands at it
  spotPool: { 5: [[112, 67], [209, 116], [193, 139], [21, 106], [221, 218], [135, 185], [75, 26], [42, 179], [51, 75]] },   // 4: capture 20261018_092322 (saopaulo2, darkness); 14: scan chicago4 volcanic (other map)
  stage: 2, aggro: 650, respawn_ms: 5 * 60 * 1000, near: { 20: 1 },
  aggroBy: { 141: 1000 } };   // fire dragon: meteor markers recorded up to 940 from it
// the Grove Colossus stands still at a random spot of the forest away from players, and after a kill comes back at
// another one; the minimap marker follows it (world.boss)
function stepNearBoss(world, now) {
  const st = S(world), sp = Object.keys(WB.near).map(Number).find((k) => (WB.phases[st.phase] || []).some((m) => WB.species[m] === k));
  if (sp == null || !WORLD_BOSSES || now < (st.nearAt || 0)) return;
  if ([...st.wild].some((e) => e.sp === sp && e.worldBoss && !e.dying)) return;
  const pl = [...world.players.values()].find((p) => p.alive && p.ent); if (!pl) return;
  const marker = (WB.phases[st.phase] || []).find((m) => WB.species[m] === sp);
  // owner: a random free spot of the biome, more than 2000 from every player and from the recorded spawn area; a new random
  // spot after each kill (/boss still brings it to the typer)
  const ph = world.phases && world.phases[st.phase], bb = (ph && ph.bbox) || [400, 400, 17200, 17200], home = typeof world.spawnXY === "function" ? world.spawnXY() : null;
  const pls = [...world.players.values()].filter((p) => p.alive && p.ent);
  for (let i = 0; i < 60; i++) {
    const x = Math.round(bb[0] + 500 + Math.random() * (bb[2] - bb[0] - 1000)), y = Math.round(bb[1] + 500 + Math.random() * (bb[3] - bb[1] - 1000));
    if (x < 400 || y < 400 || x > 17200 || y > 17200 || (typeof world.blocked === "function" && world.blocked(x, y, cRad(sp, 3) + 40))) continue;
    if (pls.some((p) => Math.hypot(p.ent.x - x, p.ent.y - y) < 2000) || (home && Math.hypot(home.x - x, home.y - y) < 2000)) continue;
    const tpl = { "21": sp, "22": WB.typeBy[marker] != null ? WB.typeBy[marker] : 0, "23": WB.stageBy[marker] != null ? WB.stageBy[marker] : 3, "7": 2, __wb: marker };
    const e = spawnWild(world, tpl, x, y, st.phase, true); e.tpl = null;
    world.L({ k: "near_boss", sp, x, y, by: pl.n });
    return;
  }
  st.nearAt = now + 2000;
}
function worldBossSpawns(world, phase) {
  const out = [];
  for (const k of WB.phases[phase] || []) {
    const pool = WB.spotPool[k], pk = pool && pool[Math.floor(Math.random() * pool.length)];
    const m = (pk && [pk[0], pk[1], k]) || (world.P.boss_markers || []).find((q) => q[2] === k) || (WB.spots[k] && [WB.spots[k][0], WB.spots[k][1], k]);
    if (m) out.push({ sp: WB.species[k], marker: k, x: Math.round(m[0] * world.P.minimap_div), y: Math.round(m[1] * world.P.minimap_div) });
  }
  return out;
}
function bossMarker(sp, phase) { return BOSS_MARKER_SP[sp] != null ? BOSS_MARKER_SP[sp] : BOSS_MARKER_PHASE[phase] != null ? BOSS_MARKER_PHASE[phase] : 1; }
const KINDS = MEAS;   // kept for older callers / tests
const C = {
  walk: 68,                // wander / pet walk, 6-7 units per 94 ms frame (all kinds)
  wander_r: 380, retarget_per_s: 0.3,
  wake_dist: 2200,         // creatures farther than this from every player stand still (CPU)
  leash: 900, give_up: 650, calm_ms: 10000, home_r: 120,
  pet_pvp_dmg: 4, pet_pvp_every: 1000,
  atk_flag_ms: 450,        // 7 = 34 during the attack, back to 2 (34 -> 2 seen 0.4..1.5 s later)
  die_ms: 1200,            // {7: 18} to remove: 0.95..1.74 s
  biome_die_ms: 1000,      // biome switch kill {7: 18, 9: 0, 10: 400} to remove: ~1.0 s
  respawn_ms: 60000,       // guess (no wild respawn observed)
  body_r: 45, player_gap: 43.5,   // player_gap: creatures and pets stop at r + 43.5 from a player center (recorded)
  // owner's choice: every owned pet is OB 30 at level 67, an invented level past the real max 60 (the client patch raises
  // its max to 67, mimic/invented/client_patch.json); create field 20 = level + OB * (max + 1) (client: level = v % 68,
  // OB = min(30, v / 68); real client: v % 61, v / 61; sp5 pets 102 = OB 1 level 41, 509 = OB 8 level 21). Wiki: OB 9 at level 60 maxes every stat;
  // the stat gain per point is not known, so maxed stats = x1.5 hp and bite: guess
  pet_level: process.env.TIO_BOSS_PETS !== "0" ? 67 : 60, pet_max_level: process.env.TIO_BOSS_PETS !== "0" ? 67 : 60, pet_ob: 30,   // unpatched client (TIO_BOSS_PETS=0): real max 60
  ob_hp_mult: 1.5, ob_dmg_mult: 1.5,
  pet_kind: 20, pet_species: 0, pet_reach: 95, pet_dmg: 5, pet_every: 1250, pet_run: 270, pet_run_dist: 400, pet_walk_dist: 220,
  pet_teleport: 20000, inv_teleport: 1800, pet_hunt: 500, pet_regen_bar_s: 0.28, pet_spawn_ms: 1000, pet_die_ms: 200, pet_max: 3, pet_extra_max: 3,
  pet_hp_by_level: [382, 700, 1190], pet_grow_xp: [200, 600], pet_easy_xp: 999999,
  pet_owner_death_ms: 3000,  // owner death: pets {7: 18}, removed one tick after the owner (afterDeath); this is the fallback
  pet_sprint: 827, pet_sprint_dist: 250, pet_follow_start: 430, pet_follow_stop: 300, pet_idle_speed: 67,
  pet_run_by: { 1: 365 }, pet_idle_in: 167, pet_idle_out: 393, pet_give_up: 900, pet_anchor_r: 200, pet_kb: 245, pet_kb_decay: 0.8,
  cast_delay_ms: 100, skill_r: 230, skill_tick_ms: 250,
  // wolf ult (sp5, 13 casts): the effect rides on the wolf, one hit 280 ms after it appears on everything within 175 of
  // the wolf, then each hit target burns for 10 ticks every 240 ms (out of range too); no area re-hits
  wolf_ult: { r: 175, hit_ms: 280, burn_n: 10, burn_ms: 240 },
  reload_scale: 1,         // dev only (cfg hook) to run many casts in a test
  saddle: 160,             // items.json Saddle; mount = swing at the own pet while holding it
  mount_r: 400,            // owner: a saddle swing mounts the nearest own pet this close (sp5 mounted one ~160 away; wiki: "your nearest boss pet")
  tame_dist: 300, tame_ms: 4700, tame_break: 600, tame_chance: null, tame_any_stage: false,
  turret_range: 678, turret_every: 1250, turret_flash_ms: 300, turret_speed: 1180, raptor_sp: 56, raptor_ms: 5400, fairy_ball_speed: 700,
  turret_dmg: { wooden: 10, stone: 12, golden: 15, ruby: 18, amethyst: 19, diamond: 25, sapphire: 25, emerald: 25, amber: 25 },   // emerald / amber: wiki Cosmetics Turret 25 (were the 12 fallback)
  proj_hit_r: 60,
  // owner: shadows come from the dark forest Hive Creep (wiki Hive Creep / Big Mamma Boss): the hive breaks into a BMB
  // shadow, the BMB dies into 7 shadow eggs (wiki: 5), each egg breaks into a baby shadow that falls asleep after 10 s.
  // Shadows tame at 11 %; every Appletor apple on a creature adds to its tame chance (wiki: +1 %, owner: up to 100 %)
  kill_food_hp: 0.075,
  hive_eggs: 7, hive_egg_r: 170, shadow_sleep_ms: 10000, shadow_tame: 0.11,
  siren_baby_tame: 0.11,   // owner: baby Sirens from the BMB Siren tame as the hive babies (wiki Siren: 6 %)
  appletor: { "Appletor": { tame: 0.1, heal: 20 }, "Golden Appletor": { tame: 0.2, heal: 40 } },
};
// owner: a player keeps 3 slot pets plus 3 extra pets: statues, shadows and gazes (no ultimates)
const EXTRA_SP = new Set([88, 89, 90, 95, 96, 97, 98, 99, 100, 104, 105, 106, 107, 108, 109, 110]);
// [species, type]: scans_dec shadow creates all carry 22 = 11 (154..159 are the skill fx ids, the client drew nothing)
const SHADOWS = [[95, 11], [96, 11], [97, 11], [98, 11], [99, 11], [100, 11]];

// Source of every number above: "sp5 <capture row(s)>" (work/sp3_decoded.jsonl row i), "atl4", or "guess".
const SOURCES = {
  "identity": "species = field 21: every capture projectile (category 4, field 7 = skill id) matches the client table skill of the owner's field 21 (wolf 0 deflagration row 2097, bear 42/43 ocean-wave row 42330, deer 110 vampiric-dash row 1516, toad 138..142 viscous-tongue row 13802, camel 39 row 16399, sea-crab 273 row 26871, squid 274 row 27019, horse 108 flame-dash row 32588); field 22 is shared by many species (22 = 21: bear, toad, seahorse, sea-crab, axolotl, camel). Ion's tamed water bear = species 2 bear (row 42292, 21 = 2); his pet = species 0 wolf (row 1017, 21 = 0). The inventory v1 named creatures by field 22 (wrong)",
  "wiki fallback": "any value MEAS lacks comes from mimic/data/wiki/animals.json for the species (client display name) at its stage: health (x2 for stage 3: guess), dmg, speed / 1.39 (wiki units vs ours, wiki_crosscheck), skill Reload / damage; else DEF (guess)",
  "MEAS.1/2/126.skill": "live1 / sp5 pet casts (work/wolf_ult_and_pass_findings.md): Rabbit kind 40 at the pet, life 3.86 s; Bear kinds 42 + 43 at the pet, life 3.9..4.6 s; Snowball kind 267 at the pet and kind 220 exactly on the aim point (A, B)",
  "starter pets": "join JSON pi = the species picked in the menu (client _4997), up to the rank's slots; 13 recorded lives started with Wolf, Rabbit or Bear",
  "MEAS.*.hp": "sp5 damage field 10 vs hp bar 9 drop, median per species (squid 34 hits, seahorse 32, wolf pet 72, lizardman 47, yellow-scorpion 21, toad 18, seal 13, vulture 9, sea-crab 8, black-spider 5, horse pet 11, ostrich 1, black-cat 1); others: guess",
  "MEAS.*.mode": "sp5 aggro = hit the player: black-spider row 11645, squid row 27006, seahorse row 28594, lizardman row 35181, salamander row 32678; retal = hit only our pet (yellow-scorpion, seal, hellhound rows by pet damage) or fought back (vulture, toad, giant-bee); others: guess (retal default)",
  "MEAS.*.aggro": "sp5 black-spider sprint starts 389 away (row 11618), squid ran in from 877 (row 26990..27006); seahorse/lizardman/salamander: guess",
  "MEAS.*.reach": "sp5 center distance at the hit: black-spider 98..105, squid 82..84, seahorse 102..106, lizardman 157..222, salamander 115..148, yellow-scorpion 152..161 (pet), seal 108..135 (pet), hellhound 155..268 (pet); others: guess",
  "MEAS.*.dmg": "sp5 damage to the player: black-spider 15 (6 of 6), squid 3 (4), seahorse 4 (12 of 15), lizardman 6 (6), salamander 1..6; others: guess (= pet damage or 3)",
  "MEAS.*.pdmg": "sp5 damage to our pet: yellow-scorpion 14, squid 3, seahorse 14, lizardman 10, seal 3, hellhound 2, giant-bee 3 (rows 27354..27428); others: guess",
  "MEAS.*.every": "sp5 intervals between hits: seahorse 0.77..2.52 s (rows 28594..28952), black-spider 1.1..2.65 s, lizardman 2.35+ s, squid 0.89 s, giant-bee ~13 frames; others: guess",
  "MEAS.*.chase": "sp5 per-frame displacement x 10.6 frames/s: black-spider 24..29, squid 26, seahorse 36..37 (sprint row 28541..28589), lizardman 34, seal 23..32, toad 35..37, yellow-scorpion 13..20, vulture 15, sea-crab 17, camel 24..36, warg 17..35; others: guess",
  "MEAS.*.skill": "sp5 category-4 creates owned by the species: squid 274 (row 27019, life 1.08 s, static), toad 138..142 (rows 13802..13811, life 0.94 s, ~40/frame), sea-crab 273 (row 26871, life 8.5 s), camel 39 (row 16399, life 6.2 s), horse 108 x2 (row 32588, life 4.0 s), deer 110 (row 1516), bear 42+43 (row 42330, life 4.0 s); cadence and damage: guess",
  "kill XP": "sp5 by stage field 23: 0 -> 50, 1 -> 100, 2 -> 400, 3 -> 1200 (work/v03_reverify.md), insect giant-bee 75 (row 27434); creatures.js grants it (world.js must not)",
  "kill gold / food": "gold: STAGES; food = 7.5 % of max hp: sp5 toad boss (hp 900) +64 food row 14095, camel giant (hp 2000) +157 row 16535 (work/timeline_gaps.md)",
  "fresh spawn": "sp5 respawned creatures are created with 7 = 10 (reverify), then 2 (or 66 asleep) after ~1 s: guess for the delay",
  "sleeping": "sp5 creates with 7 = 66 (64 = asleep): asleep creatures stand still and do not aggro until hit: guess from wiki (sleeping babies)",
  "MEAS.57.xp/gold/food": "sp5 giant-bee kill row 27434: XP +75, gold +50, no food; others scale by hp and food 40: guess (the other kill frames include quest rewards)",
  "boss marker": "sp5 board ob[2] per phase: snow 10 (21 s), 2 (159 s), 6 (285 s); dark 3 (345 s); desert 9 (825 s), 7 (1102 s); sea 5 (1305 s); volcanic 13 (1786 s); forest 1 (2329 s) = the forest dragon boss (species 20, row 37965); species with their own marker by client table name, else the phase's first marker",
  "world bosses": "on unless TIO_WORLD_BOSSES=0: spot = sp5 board marker x minimap_div per phase (season sets from all capture markers: forest dragon, winter ice dragon + ice golem, darkness spectrum (saopaulo2 spot) + mushroom boss (Polecat stage 3), desert stone golem + cactus boss (Deer stage 3), ocean octopus, volcanic volcanic golem); stage 2 stats and loot from the client creature table; stationary (owner); aggro 650 and respawn 5 min: guess; capture 20261018 markers: spectrum 4, cactus 7, dark-tree 8 (objects or not in sp5 phases)",
  "MEAS.20.boss": "guess (single wild dragon with state 9 and class 73, row 37965)",
  "petScale (pet hp, bite, run per species)": "recorded wolf values (pet_hp_by_level, pet_dmg, pet_run) x the species wiki stat / the wolf wiki stat at the same stage (Animal Infobox, mimic/data/wiki/animals.json); check: rabbit run 270 x 270/200 = 364.5 vs recorded 365",
  "C.player_gap, COLL_R": "351 sessions, 548k pair-frames (work/creature_collision.md): creature and pet pairs stop at 1.00 x (r1 + r2), creatures and pets vs players at r + 43.5; boss stages deer 165, plant mask 140, flying squirrel 90",
  "C.walk": "sp5 wander 6..7 units per update for every species and stage (both captures, 20 species/stage pairs with > 600 steps each)",
  "NAV.run_q": "sp5 wander run path length q10/q25/q50/q75/q90 = 59/188/367/928/1682 units (817 runs, both captures)",
  "NAV.pause_q": "sp5 pause between runs q10..q90 = 0.6/1.8/10.1/35.9/107 s (307 pauses)",
  "NAV.turn_rate": "sp5 runs curve: net heading change median 90 deg (q90 235) over ~51 steps, straightness disp/path median 0.69; steering limit 3 rad/s and the curved new-target choice: guess fitted to that",
  "no home": "sp5 106 creatures seen > 60 s: they drift up to 2473 from where first seen and the final distance is usually the maximum (no return to a spawn point); give-up only stops the chase",
  "MEAS.77.flee": "sp5 sea-crab moved away after all 16 player hits (1.5 s window); other species mixed toward/stay/away",
  "NAV.cell, NAV.budget, NAV.pad, NAV.replan_ms": "guess (64-unit grid, 400 node budget, 40 clearance on top of the solid's collide distance, chase replan 0.5 s)",
  "C.wander_r, C.retarget_per_s": "atl4 (v0.2 world.js animals)",
  "C.wake_dist, C.leash, C.give_up, C.calm_ms, C.home_r": "guess (CPU / chase limits: a creature gives up 650 from its target or 900 from its home, walks home ignoring players, and leaves that player alone for 10 s)",
  "C.pet_pvp_dmg, C.pet_pvp_every": "sp5 other players' pets hit us for 1..8 (rows 32675..32683, sp3_facts hp.damage_by_cause creature:dragon); cadence: guess",
  "player damage cause": "creature hits on players: cause creature:<kind name>, by = the creature entity; pet hits: cause pet, by = the pet owner",
  "C.atk_flag_ms": "sp5 7 = 34 then 2 again 0.4..1.5 s later (rows 28589..28628)",
  "C.die_ms": "sp5 {7: 18} to remove 0.95..1.74 s (rows 14095->14120, 15198->15237, 29042->29057)",
  "C.biome_die_ms": "sp5 switch kill {7: 18, 9: 0, 10: 400} row 6643, removed row 6684 (+1.0 s)",
  "C.respawn_ms": "guess (no wild respawn seen)",
  "C.pet_kind, C.pet_species, pet create fields": "sp5 row 1017 (id = own + 1, 7 = 10, 13 owner, 16 owner clan id, 21 = 0 wolf, 22 = 20); own_info i = pet id row 971; field 16 = clan 481/483 rows 26691, 38433, 42292",
  "C.pet_hp": "sp5 wolf pet damage vs bar drop median 382 (72 hits)",
  "C.pet_reach, C.pet_dmg, C.pet_every": "9 sessions (work/pet_ai_fit.md): bites at target radius + 49 (q50, n 174), 128 bites in 18 runs 1.244 s apart; damage sp5 skunk 3..6 (rows 15185..15196)",
  "C.pet_follow_start/stop, pet_run, pet_run_by, pet_idle_*, pet_anchor_r, pet_give_up": "9 sessions (work/pet_ai_fit.md, move offsets decoded): walk 6.5 / run 26 per tick only; run starts at 427 (q50) and ends at 300; run 270 (rabbit 365); idle walks non-stop between 167 and 393 at 67; stop / go-to spot wander up to ~200; bites up to 727 (q90) from the owner",
  "C.pet_run, C.pet_run_dist, C.pet_walk_dist": "sp5 pet 26/frame when > 400 from the owner, 6..7/frame at 100..400, owner distance mostly 150..450",
  "C.pet_teleport, C.pet_hunt, C.pet_max": "no teleport in 92 re-creates (pets ran back 8,000..10,600 at ~250/s), so 20000 = off; hunt and max: guess (2 pets seen at once, own_info n 2 row 42275)",
  "C.pet_regen_bar_s": "sp5 0.28 hp-bar units per second while hurt (442 over 1606 s)",
  "C.pet_spawn_ms": "sp5 pet 7 = 10 at create row 1017, guess for the duration",
  "C.pet_die_ms": "sp5 pet death {7: 50, 9: 0, 17: 0} + own_info d 1 row 25046, removed row 25070 (+0.2 s)",
  "C.pet_owner_death_ms": "guess (fallback only); sp5 owner death: pet {7: 18} in the owner's death frame, removed one frame after the owner's remove (B rows 3218, 3228-3230; A rows 37385, 37396-37398)",
  "C.pet_hp_by_level": "sp5 own wolf hp 382 at a = 0..1 (72 hits), 1190 at a = 2 (wiki_crosscheck); a = 1 value 700: guess",
  "C.pet_grow_xp": "sp5 pet {14: kill xp, 15: pet total} on kills: {14: 400, 15: 400} + a 1 (row 14119), {14: 400, 15: 800} + a 2 (row 15198), {14: 100, 15: 225} + a 1 (row 29042), no growth at 125: medium in 126..225, adult in 426..800 (timeline); 200 / 600 picked inside: guess",
  "STAGES": "client creature table per stage (work/creature_stages_client.json): bite dmg, speed, kill gold, kill xp, skill reload; sp5 kill frames fit it (toad boss +2000 gold +400 xp row 14095, giant-bee stage 3 +50 gold +75 xp row 27434, camel boss +10000)",
  "C.pet_sprint, C.pet_sprint_dist": "sp5 pet catch-up sprint up to 78 units/tick when the owner is > 250 away (rows 15468..15470, work/v03_reverify.md)",
  "C.pet_kb, C.pet_kb_decay": "pet knockback when hit, decay ~0.8 per tick (sp5 pet row 2405); total push ~115 = the 96..134 one-frame knockback jumps in the human sessions (work/pet_ai_fit.md); was 742 (~350 total, owner: a baby wolf flew off a baby cow)",
  "pet skill": "sp5 JSON 48 (sp5 14) S = 4 casts the pet skill: ~0.3 s later a category-4 create {7: skill id, 8: pet growth a, 10/11: pet} at the pet (rows 2088 -> 2097, 8892 -> 8896, 14081 -> 14087, 15047 -> 15055 ...), life 2.7..4.6 s; wolf = 7 0 Deflagration, bear = 7 42 + 43 Ocean Wave (row 42330)",
  "C.cast_delay_ms": "sp5 0.26..0.34 s from JSON 48 S 4 to the skill create = one round trip (select echo median 0.30 s): server side one tick",
  "C.wolf_ult": "sp5 wolf casts (work/wolf_ult_and_pass_findings.md): fx kind 0, variant = pet level, moves with the wolf, create to remove median 3.97 s; hits 20 (lvl 0) / 30 (lvl 1) at +0.28 s on targets 88..150 from the wolf, misses at 201..386; burn 10 ticks of 2..3 about 0.24 s apart, continues out of range",
  "C.skill_r, C.skill_tick_ms": "sp5 Deflagration hits: first hit at +0.28 s on creatures 108..238 away, then 3 every ~0.25 s (rows 35097.., 35651..); radius 230: guess from the farthest hit",
  "skill damage / reload": "wiki per growth stage (a 0 baby, 1 adult, 2 boss): Deflagration animal 20/30/40 + DoT 2/3/4, player 10/15/20 + DoT 1/1/2, reload 30/28/25 s; sp5 measured a = 1 animal 30 + DoT 3 (rows 35097, 35651)",
  "invented pet kits": "invented: Stormhorn Static Shell (-20% damage, shocks a melee attacker within 220 for 10, 0.8 s), Overcharge (2+ enemies within zap range: zaps every 0.5 s for 4 s, 12 s cooldown), Magnet Pull (every 8 s the farthest non-player enemy 220..520 away is pulled to 140, 8 damage), Thunder Step (blink to the owner when the owner is hit while the pet is > 300 away or when it is > 700 away, 8 shock within 150, 6 s cooldown), Chain Zap, ult Tempest Crown. Cinder Prowler Ember Trail (while dashing an ember every 140 units, 2.5 s, 4 / 2 burn every 0.5 s within 70, max 8), Molten Hide (-30% damage, burns a melee attacker within 220 for 6), Pounce Chain (a kill re-targets the nearest enemy within 450, next bite x1.5), Smoke Veil (below 50% hp, 3 s untargetable, wild creatures drop it, 20 s cooldown), Dash Bite, ult Ashen Snare. Client panel: own names, ult description, kit rows with icons (tools/invented/client_patch.js)",
  "invented boss pets": "invented (owner feature, TIO_BOSS_PETS=1): Stormhorn (species 156, reindeer shape) and Cinder Prowler (157, rat shape) are new client species appended by mimic/invented/client_patch.json (the real reindeer 13 / rat 39 keep their own name, art and kit), boss stage 23 = 2, art from tools/invented/make_art.py under the new species' image names (mimic/invented/override.json); the pet picker's Fart type lists them with the Grove Colossus (155, mammoth shape). Stormhorn: hp 1600, bite 22, speed 560 (catch-up 760, faster than a walking player), orbits the owner at 190 (1.6 rad/s), chain-zaps up to 3 enemies every 1.2 s (18/12/8, players 9/6/4, hop 260, range 450, visual skill id 45 thunder); ultimate Tempest Crown: 4 s, every 0.5 s 16 to creatures / 7 to players within 380, reload 20 s (= the client's slot-156 stage-2 reload, so the client never casts during a server cooldown). Cinder Prowler: hp 1400, bite 30 (players 15), walk 360, dash 900, hunts within 600 of the owner, falls back to the owner below 40 % hp or beyond 520; ultimate Ashen Snare (auto below 35 % hp or on S 4): 5 s field radius 300, slow x0.45 and 6 / 3 damage every 0.5 s, reload 18 s (= the client's slot-157 stage-2 reload), visual skill id 63 infernal mud. They do not count toward the 3-pet limit",
  "pet stages": "pet growth a 0 baby / 1 adult / 2 boss (the top pet stage; client card index card-<sprite><a>, skill field 8 = a, rows 2097 / 15055 / 16548); pet create 23 = that stage (others' pets were created with 23 = 1, row 493). Wild giants (23 = 3, e.g. the giant camel) and world bosses are separate tiers",
  "easy mode": "owner rule: /easy (player.easy) puts every pet of the player, and any pet it gets later, at max growth (a 1 then a 2 with their own_info messages, full pet XP, HP of the top level)",
  "pet level a": "sp5 own_info {i: pet, a: 1/2} + pet {14: 400, 15: 400} on our kills (rows 14119, 15198)",
  "pet commands": "sp5 JSON 48 S 4 x14, 2 x4, 1 x3, 0 x3; client labels (timeline): 0 attack, 1 defense, 2 stop, 3 target, 4 skill; replies only pet 7 changes; default mode 1 and what each mode does: guess",
  "C.tame_dist": "sp5 one sample 133 away (row 42194); limit 300: guess",
  "tame messages": "sp5 row 42275: own_info {i: pet id, n: species 2 = bear} (the pet bar entry carries the species) + atl4 44 {o: 1, n: species} ('You tamed your first <species>')",
  "C.tame_ms": "sp5 {12: 1} row 42200 -> remove row 42286 -> re-create as pet row 42292 (4.7 s); success always, cost none (no inventory paid): guess from one sample",
  "C.tame_break": "guess",
  "taming rules": "wiki: only babies (stage 23 = 0) can be tamed, chance = wiki taming_chance (Wolf/Bear/Rabbit 66 %, most others 6..18 %), no cost (sp5: nothing paid, row 42209), a failed tame wakes the animal and it attacks; sp5 one success (bear baby, rows 42194..42292); Slingshot/Appletor +1 % per hit not done; C.tame_chance overrides (tests)",
  "C.turret_range": "sp5 turret reach 678 / 614 measured (work/v03_reverify.md)",
  "C.turret_every": "sp5 shots {5: aim, 9: 17}: 69 shots from 3 turrets, mean gap 1.26 s (alternating 0.9 / 1.5 frame batching)",
  "C.turret_flash_ms": "sp5 category-2 create {7: 9} with each shot, gone after 0.0..1.55 s",
  "C.turret_speed": "scan_facts proj 9 (the turret shot): 1177 / s",
  "C.raptor_sp, C.raptor_ms": "wiki Raptorial Daggers (Giant Mantis 56): transforms the owner's daggers; owner: boss stage only, temporary; 5400 = the client mantis-clock effect duration",
  "C.fairy_ball_speed": "owner: fairy balls fly to the target; speed guess",
  "C.turret_dmg": "sp5 stone 12 with 11 = 3 (rows 28541, 28657), amethyst 19 on a player (6 hits, field 10 = 19); other tiers wiki 10/15/18/25",
  "C.proj_hit_r": "guess",
  "riding mount": "sp5 row 16110 select Saddle 160, row 16220 attack op with the own pet ~160 away: pet {17: 160}, own {7: 1, 8: previous item 95, 15: 500, 16: 1}, own x/y jump onto the pet",
  "riding motion": "sp5 rows 16220..25046: pet and rider at distance 0, both send x/y in the same frames (1497 frames); rider speed = normal walk with the held item (Golden Axe 36..37/frame, Ruby Axe 23..24), so riding adds no speed",
  "riding pet": "sp5 the ridden pet keeps fighting (7 = 34/2 x250) and takes hits (9/10 x39) without dismounting",
  "riding end": "sp5 row 25046 pet death: pet {7: 50, 9: 0, 17: 0}, own {7: 2, 16: 0}; dismount by swinging with the Saddle again: guess (not in the capture)",
};

function spName(k) { return SPECIES[k] ? SPECIES[k][0] : "creature"; }
const CACHE = new Map();
// stats for species k at growth stage st: measured first, then the wiki stage values, then DEF
function kdef(world, k, st) {
  st = st >= 0 && st <= 3 ? st | 0 : 1;
  const ov = world.P && world.P.creatures && world.P.creatures[k], key = k + "/" + st, b = bsp(k);
  if (!ov && CACHE.has(key)) return CACHE.get(key);
  const m = MEAS[b] || {}, w = (SPECIES[b] && WIKI[SPECIES[b][0]]) || {}, sg = (w.stages && w.stages[STAGE[st]]) || {};
  const sk = w.skill || {}, sv = (n) => wv((sk[n] || {})[STAGE[st]]);
  const d = Object.assign({}, DEF, { name: spName(k) });
  const T = (STAGES[b] || [])[Math.min(st, (STAGES[b] || [1]).length - 1)] || [];
  const whp = wv(sg.health), wdmg = wv(sg.dmg);
  // owner: copy the real game: the wiki / client table per stage first; single sp5 samples only where they have nothing
  d.hp = whp ? whp * (st === 3 ? 2 : 1) : (m.hp && m.hp[st]) || DEF.hp;
  d.dmg = T[0] != null ? T[0] : wdmg != null ? wdmg : m.dmg != null ? m.dmg : DEF.dmg;
  d.pdmg = m.pdmg != null ? m.pdmg : d.dmg;
  d.chase = m.chase != null ? m.chase : T[1] || DEF.chase;
  for (const f of ["mode", "aggro", "reach", "every", "boss"]) if (m[f] != null) d[f] = m[f];
  if (st === 3 && !INSECT_TYPE[b]) d.boss = true;   // giants; insects are always stage 3 and are not bosses
  d.xp = m.xp != null ? m.xp : T[3] != null ? T[3] : KILL_XP[st];
  d.gold = m.gold != null ? m.gold : T[2] != null ? T[2] : 50;
  d.food = m.food != null ? m.food : Math.round(d.hp * C.kill_food_hp);   // food scales with max hp (SOURCES "kill gold / food")
  d.tame = wv(w.taming_chance) != null ? wv(w.taming_chance) : 10;
  const kk = (m.skill && m.skill.k) || (SPECIES[b] && SPECIES[b][1] != null ? [SPECIES[b][1]] : []);
  const rl = T[4] || (sv("Reload") || 20) * 1000;
  d.skill = kk.length ? { k: kk, every: rl, life: (m.skill && m.skill.life) || 4000, speed: (m.skill && m.skill.speed) || 0, follow: !!(m.skill && m.skill.follow), at_pet: (m.skill && m.skill.at_pet) || null,
    dmg: sv("Player Damage") || 0, dot: sv("Player Damage Over Time") || 0, adm: sv("Animal Damage") || 0, adot: sv("Animal Damage Over Time") || 0 } : null;
  if (ov) return Object.assign(d, ov);
  CACHE.set(key, d);
  return d;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const now0 = (world) => world.now || Date.now();
let PROFILE = null; try { PROFILE = require("./profile"); } catch (e) { }
const CA = require("./chatargs");   // chat command arguments
const S = (world) => world.ext.creatures;
let TRK; try { TRK = require("./trinkets"); } catch (e) {   // trinkets.js not committed yet: no-op hooks so the plugin still loads
  TRK = { init() { }, bite: (w, e, t, d) => d, afterBite() { }, xpMult: () => 1, regenMult: () => 1, speed: (e, v) => v, hurt: (e, d) => d, tick() { }, stopped: () => false, attach() { } };
}   // pet trinkets: bite / hurt / regen / speed / xp hooks
TRK.init({ hit: (w, t, d, s) => hit(w, t, d, s), enemiesNear: (w, e, x, y, r) => enemiesNear(w, e, x, y, r), fx: (w, k, x, y, life, src) => fx(w, k, x, y, life, src), now: now0 });
function petBite(world, t, dmg, e) { const d = hit(world, t, TRK.bite(world, e, t, dmg), e); TRK.afterBite(world, e, t, d); return d; }

// ------------------------------------------------------------ spawn lists
let SP5 = null;
function phaseList(world, phase) {
  const W = (world.ctx && world.ctx.WORLD) || {};
  let ph = W.phases;
  if (!ph) {
    if (SP5 === null) { try { SP5 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "world_sp5.json"), "utf8")); } catch (e) { SP5 = false; } }
    ph = SP5 && SP5.phases;
  }
  const p = ph && (ph[phase] || ph[String(phase)]);
  const bug = (c) => !(c["21"] === 57 && c["23"] === 3);   // insects (species 57 stage 3) belong to insects.js
  if (p && Array.isArray(p.creatures)) return p.creatures.filter(bug);
  return (W.creatures || []).filter(bug);
}
function tplFields(c) {
  const f = {};
  for (const [k, v] of Object.entries(c)) if (/^\d+$/.test(k)) f[k] = v;
  return f;
}

// ------------------------------------------------------------ wild creatures
// admin spawns: free spots on a ring 200..1250 around (x, y), at least 150 from each other and outside solids
function spreadSpots(world, x, y, n) {
  const P = world.P, out = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    for (let t = 0; t < 40 && !best; t++) {
      const a = Math.random() * TAU, r = 200 + Math.random() * 1050;
      const sx = Math.round(Math.max(P.map_min, Math.min(P.map_max, x + Math.cos(a) * r))), sy = Math.round(Math.max(P.map_min, Math.min(P.map_max, y + Math.sin(a) * r)));
      if (out.some((q) => Math.hypot(q[0] - sx, q[1] - sy) < 150) || world.blocked(sx, sy, 20)) continue;
      best = [sx, sy];
    }
    out.push(best || [Math.round(x + Math.cos(i) * 300), Math.round(y + Math.sin(i) * 300)]);
  }
  return out;
}
// world-boss bodies (all 38 scans): a stage-3 world boss sends its state with bit 0 where every other creature uses bit 1
// (2 -> 1 awake, 66 -> 65 asleep, 34 -> 33 attacking, 10 -> 9, 50 -> 49); that bit makes the client draw the boss art
// (master-*-golem, tree-boss, mushroom boss, dragon egg ...): with 2 it drew the plain giant (golems as the ice golem, Trents
// as branches over the animal). Statues and BMBs keep bit 1. The Grove Colossus (invented, species 20 next to players) too.
const BOSS_ART = new Set([4, 10, 15, 20, 21, 35, 62, 68, 73, 76, 85, 101, 109, 121, 123, 141]);
function artState(e, v) { return e.bossArt && typeof v === "number" && (v & 2) ? v - 1 : v; }
function spawnWild(world, tpl, hx, hy, phase, fresh) {
  const st = S(world), f = tplFields(tpl), ck = f["22"], sp = f["21"], stage = f["23"] | 0, d = kdef(world, sp, stage), id = world.nextId();
  const sleep = (f["7"] & 64) ? 66 : 2;
  f["0"] = id; f["1"] = T_CREATE; f["2"] = 0; if (f["25"] == null) f["25"] = 10;
  const e = { id, kind: "animal", ck, sp, stage, x: hx, y: hy, hx, hy, tx: hx, ty: hy, a: Math.random() * TAU, hp: d.hp, max: d.hp, f, tpl, phase,
    r: cRad(sp, stage), cr: collR(sp, stage), cd: d.cd != null ? d.cd : collR(sp, stage) + C.player_gap, st: "wander", s7: fresh ? 10 : sleep, wake7: sleep, born: now0(world), tgt: null, lastAtk: 0, lastSkill: 0, plug: "creatures" };
  e.create = () => Object.assign({}, e.f, { "3": Math.round(e.x), "4": Math.round(e.y), "5": ang200(e.a), "7": artState(e, e.s7) });
  e.hurt = (dmg, by) => hurtWild(world, e, dmg, by);
  e.name = d.name;   // death screen killer name (Player.die uses by.name)
  e.bossArt = stage === 3 && BOSS_ART.has(sp) && !(tpl && tpl.__wb != null && WB.near[sp]);
  if (tpl && tpl.__wb != null) {
    e.worldBoss = true; e.boss = true;
    world.boss = { x: Math.round(hx), y: Math.round(hy), kind: sp, marker: tpl.__wb, named: true, world: true };
  } else if (d.boss) {
    e.boss = true;
    if (fresh && wbBody(sp, stage)) e.bossBody = true;   // owner: a boss body outside its slot (Genie-woken Gold Golem, /spawn, /event) runs the full world-boss attack set
    const named = !!(MEAS[sp] && MEAS[sp].boss);   // the phase boss wins the single board marker over giants
    if (!(world.boss && world.boss.world) && (named || !world.boss || !world.boss.named)) world.boss = { x: Math.round(hx), y: Math.round(hy), kind: sp, marker: bossMarker(sp, phase), named };
  }
  world.addEnt(e);
  st.wild.add(e);
  return e;
}
// scan fill (on unless TIO_SCAN_SPAWNS=0): the base recording is thin in some biomes; tonight's 38 scans (per-server
// tables, biome from the server's own biome message) give the wild species / type / stage mix per biome and how many
// a walker sees per view (median). Target per biome = max(recorded, 4 x that median: forest has 146 recorded for a
// median 37 seen). Extras use the scan mix and stand near recorded creatures of the same biome (jitter 600).
const SCAN_FILL = process.env.TIO_SCAN_SPAWNS !== "0";
let SCANS = null;
function scanFill(world, phase, have) {
  if (SCANS === null) { try { SCANS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "scan_spawns.json"), "utf8")); } catch (e) { SCANS = {}; } }
  const S0 = SCANS[String(phase)]; if (!S0 || !S0.templates || !S0.templates.length) return 0;
  const med = S0.per_scan.slice().sort((a, b) => a - b)[Math.floor(S0.per_scan.length / 2)] || 0;
  const want = Math.min(world.P.creature_cap || 400, Math.round(4 * med)) - have; if (want <= 0) return 0;
  const pool = S0.templates.filter((t) => (t[2] | 0) < 3), tot = pool.reduce((a, t) => a + t[3], 0);
  const anchors = phaseList(world, phase).filter((c) => c["13"] == null && c["3"] != null);
  if (!tot || !anchors.length) return 0;
  let n = 0;
  for (let i = 0; i < want; i++) {
    let r = Math.random() * tot, t = pool[0]; for (const q of pool) { r -= q[3]; if (r <= 0) { t = q; break; } }
    const a = anchors[(Math.random() * anchors.length) | 0];
    let x = a["3"], y = a["4"];
    for (let k = 0; k < 12; k++) { const ang = Math.random() * TAU, d = 150 + Math.random() * 450; const tx = a["3"] + Math.cos(ang) * d, ty = a["4"] + Math.sin(ang) * d; if (typeof world.blocked !== "function" || !world.blocked(tx, ty, 30)) { x = tx; y = ty; break; } }
    x = Math.max(world.P.map_min + 50, Math.min(world.P.map_max - 50, Math.round(x))); y = Math.max(world.P.map_min + 50, Math.min(world.P.map_max - 50, Math.round(y)));
    spawnWild(world, { "21": t[0], "22": t[1], "23": t[2], "7": 2, "25": 10 }, x, y, phase); n++;
  }
  return n;
}
// ocean statue region (bbotot statue walk 20261019_092752, seattle1 tables): statue creatures stage 3 at their bmb objects.
// Plant Statue 88 type 9 appeared on bmb-plant-statue (1500, 5705) and roamed ~400 from it; Water Statue 90 type 21 was
// seen 374 from bmb-statue (1897, 5808); Fire Statue 89 at bmb-fire-statue (1495, 6102) never seen (type 20: guess, as the
// fire bosses). Respawn: the wild default (not recorded).
const STATUES = { 4: [{ sp: 88, type: 9, x: 1500, y: 5705 }, { sp: 90, type: 21, x: 1897, y: 5808 }, { sp: 89, type: 20, x: 1495, y: 6102 }] };
// Ocean Sanctuary chest: gift75, the client's own sea stone chest (owner: the statue chest; the Guardian's Heart image is
// only the inventory / achievement icon of the item the chest gives). Siren stage 3: wiki boss stats and Petrification
// via kdef; her kill drops 3 baby Sirens.
const SANCTUARY = { 4: { x: 1700, y: 6260, gift: "gift75", siren: 87, type: 21, babies: 3, rise: 160 } };
// Ocean Sanctuary flow (wiki Ocean Sanctuary, owner): the 3 petrified bmb statue objects stand solid; breaking one wakes its
// statue BMB (no pre-spawned statues); when all 3 statue BMBs are dead the Guardian's Heart chest spawns at the sanctuary
// center (stays until broken) and the BMB Siren wakes. Breaking the chest gives the ingredient Guardian's Heart (insect
// table id 44, the statue brews' [0, 44] ingredient) into the account inventory["0"]. Statue hp step / radius: GUESSED.
const STATUE_OBJ = { "bmb-plant-statue": 0, "bmb-statue": 1, "bmb-fire-statue": 2 }, STATUE_R = 110, STATUE_STEP = 13, HEART_ITEM = 44;
function statueCenter(list) { return [list.reduce((a, q) => a + q.x, 0) / list.length, list.reduce((a, q) => a + q.y, 0) / list.length]; }
// the 3 statue objects of the phase (the recorded ones where present), around (cx, cy) when given (the /event siren reset)
function sanctuaryReset(world, phase, at) {
  const st = S(world), L = STATUES[phase]; if (!L) return null;
  if (st.sanct) for (const id of st.sanct.objs) if (world.ents.has(id)) world.removeEnt(id);
  const [mx, my] = statueCenter(L), dx = at ? at.x - mx : 0, dy = at ? at.y - my : 0;
  const sc = st.sanct = { phase, left: L.length, objs: [], cx: mx + dx, cy: my + dy };
  L.forEach((q, i) => {
    const nm = Object.keys(STATUE_OBJ).find((k) => STATUE_OBJ[k] === i), x = q.x + dx, y = q.y + dy;
    let o = !at && [...world.ents.values()].find((e) => e.kind === "static" && e.name === nm && !e.dying && Math.hypot(e.x - x, e.y - y) < 60);
    if (!o) { o = hiveStatic(world, nm, x, y); if (!o) return; }
    o.rec = null; o.hiveHit = true; o.hiveStep = STATUE_STEP; o.cd = STATUE_R; o.cd0 = STATUE_R; o.statue = q; o.hp = 255;
    world.hzDirty = true; sc.objs.push(o.id);
  });
  world.L({ k: "sanctuary", room: world.name, x: Math.round(sc.cx), y: Math.round(sc.cy), statues: sc.objs.length });
  return sc;
}
function statueWake(world, o) {
  const q = o.statue, b = spawnWild(world, { "21": q.sp, "22": q.type, "23": 3, "7": 2 }, o.x, o.y, world.phase, true);
  if (!b) return;
  b.tpl = null; b.sanctStatue = true;   // no respawn: the statue object comes back with the next ocean season
  world.L({ k: "statue_wake", room: world.name, species: q.sp, id: b.id });
}
function statueDead(world) {
  const sc = S(world).sanct; if (!sc || --sc.left > 0) return;
  const q = SANCTUARY[sc.phase] || SANCTUARY[4];
  const h = hiveStatic(world, q.gift, sc.cx, sc.cy + q.rise);
  if (h) { h.sirenHeart = true; h.bossChest = true; sc.objs.push(h.id); }   // no random chest respawn
  const b = spawnWild(world, { "21": q.siren, "22": q.type, "23": 3, "7": 2 }, sc.cx, sc.cy - q.rise, world.phase, true);
  if (b) { b.tpl = null; b.sirenBmb = true; }
  world.L({ k: "siren_wake", room: world.name, chest: h ? h.id : null, id: b ? b.id : null, x: Math.round(sc.cx), y: Math.round(sc.cy) });
}
// /event <name>: turns on a real taming.io event (wiki Events / Christmas / Easter / Halloween / Thanksgiving / animal pages).
// Its legendary animals spawn around the player (2 babies to tame + 1 adult each) and its chests next to him; /event off
// removes them. GUESSED where the clone has no data: the chests are openable world gifts (Christmas: gift0..5 = the wiki's
// six world-chest kinds; Easter eggs and Halloween pumpkins are not openable objects in the clone, so gifts stand in for
// them), Golden Egg pets spawn as animals (no Giant Golden Egg to break), the Genie spawns without a Djinn Lamp, the
// Siren event resets the Ocean Sanctuary (3 statues) next to the player in any biome
const EVENTS = {
  christmas: { sp: [13, 54], gifts: ["gift0", "gift1", "gift2", "gift3", "gift4", "gift5"], note: "Reindeer, Krampus, Christmas chests" },
  easter: { sp: [27, 29, 28, 60, 81, 119, 144, 146, 145, 143, 147, 149], gifts: ["gift6", "gift7", "gift8", "gift9"], note: "Easter Bunny, Rabbid, Rabbat, Rabblow, Rabbyss, Rabburn, golden egg pets (Floren, Aquen, Pyren, Chicken, Richen, Sparken), egg chests, Golden Eggs to break (a BMB hen or a baby)" },
  halloween: { sp: [48, 34, 64], gifts: ["gift10", "gift11", "gift12"], note: "Black Cat, Unicorn, Warg, pumpkin chests" },
  thanksgiving: { sp: [69], gifts: [], note: "Turkey, Turkey Eggs (break one: the BMB Turkey)" },
  genie: { sp: [], gifts: [], genie: true, note: "3 genie lamps: break one for the BMB Genie or baby Genies; the BMB Genie leaves a baby or wakes the Gold Golem (4 gold chests)" },
  mammoth: { sp: [41], gifts: [], note: "Mammoth" },
  gaze: { sp: [], gifts: [], gaze: true, note: "Giant Gaze (5500 hp): Earthquake and Egg Bombs, calls the Gazes at 75 / 50 / 25 %" },
  yeti: { sp: [103], gifts: [], note: "Yeti" },
  siren: { sp: [], gifts: [], siren: true, note: "Ocean Sanctuary: break the 3 statues, kill their BMBs, then the Guardian's Heart chest and the BMB Siren (3 baby Sirens on her death)" },
};
// breakable event eggs (wiki Golden Egg / Turkey Egg): Easter Golden Eggs (2000 hp, 6 gold a hit): 67 % a BMB hen (Aquen, Chicken,
// Floren, Pyren) that leaves a baby to tame when it dies, else a sleeping baby hen (the wiki's Mysterious Egg hatches into a
// hatchling: no house here); an independent 25 % for a Golden Richen Egg (the same with Richen). Thanksgiving Turkey Egg (3500 hp,
// 3 food a hit) wakes the BMB Turkey (bite 60, no skill), a baby Turkey left on its death (guess). Hp steps (~43 / ~64 hits),
// egg spots around the player and the baby-left rule for the turkey: GUESSED
const EGGS = { "giant-golden-egg": { step: 6, gain: { 3: 6 }, hens: [146, 143, 144, 145] }, "giant-richen-egg": { step: 6, gain: { 3: 6 }, hens: [147] },
  "turkey-egg": { step: 4, gain: { 0: 3 }, hens: [69], always: true, bite: 60 } };
function eggStatic(world, nm, x, y) {
  const o = hiveStatic(world, nm, x, y); if (!o) return null;
  const E = EGGS[nm]; o.eggKind = nm; o.hiveStep = E.step; o.hitGain = E.gain; o.cd = o.cd0 = typeof world.collideDist === "function" ? world.collideDist(nm) || 70 : 70;   // owner: the egg sprite size (hosted_config collide_by_def)
  return o;
}
function eggBreak(world, o) {
  const E = EGGS[o.eggKind], sp = E.hens[Math.floor(Math.random() * E.hens.length)];
  if (E.always || Math.random() < 0.67) {
    const b = spawnWild(world, { "21": sp, "22": petType(sp), "23": 3, "7": 2 }, o.x, o.y, world.phase, true);
    b.tpl = null; b.eggBmb = sp; if (E.bite) b.biteDmg = E.bite; if (o.eventTag) b.eventTag = o.eventTag;
  } else eggBaby(world, sp, o.x, o.y, o.eventTag);
  world.L({ k: "egg_break", room: world.name, egg: o.eggKind, sp });
}
function eggBaby(world, sp, x, y, tag) {
  const b = spawnWild(world, { "21": sp, "22": petType(sp), "23": 0, "7": 66 }, x, y, world.phase, true);   // asleep: tameable
  b.tpl = null; if (tag) b.eventTag = tag;
}
function eventOff(world) {
  const st = S(world), ev = st.event; if (!ev) return 0;
  let n = 0;
  for (const e of [...st.wild]) if (e.eventTag) { st.wild.delete(e); world.removeEnt(e.id); n++; }
  for (const id of ev.objs) if (world.ents.has(id)) { world.removeEnt(id); n++; }
  st.event = null;
  return n;
}
function eventOn(world, p, name) {
  const E = EVENTS[name], st = S(world); if (!E || !p.ent) return false;
  eventOff(world);
  const ev = st.event = { name, objs: [] };
  const units = [];
  for (const sp of E.sp) units.push([sp, 0], [sp, 0], [sp, 1]);
  const spots = spreadSpots(world, p.ent.x, p.ent.y, units.length);
  units.forEach(([sp, stage], i) => {
    const e = spawnWild(world, { "21": sp, "22": petType(sp), "23": stage, "7": 2 }, spots[i][0], spots[i][1], world.phase, true);
    if (e) { e.eventTag = name; e.tpl = null; }   // no respawn
  });
  const eggs = name === "easter" ? ["giant-golden-egg", "giant-golden-egg", "giant-golden-egg"].concat(Math.random() < 0.25 ? ["giant-richen-egg"] : []) : name === "thanksgiving" ? ["turkey-egg", "turkey-egg"] : [];
  eggs.forEach((g, i) => {
    const a = (i + 0.5) / eggs.length * TAU, o = eggStatic(world, g, p.ent.x + Math.cos(a) * 520, p.ent.y + Math.sin(a) * 520);
    if (o) { o.eventTag = name; ev.objs.push(o.id); }
  });
  E.gifts.forEach((g, i) => {
    const a = i / Math.max(1, E.gifts.length) * TAU, o = hiveStatic(world, g, p.ent.x + Math.cos(a) * 260, p.ent.y + Math.sin(a) * 260);
    if (o) ev.objs.push(o.id);
  });
  if (E.gaze) giantGaze(world, p.ent.x + 600, p.ent.y, name);   // wiki Giant Gaze: the Draconic Gaze boss body (client stage 3), a standing world boss with fairy-wave Gazes
  if (E.siren) sanctuaryReset(world, 4, { x: p.ent.x + 450, y: p.ent.y });
  if (E.genie) for (let i = 0; i < GENIE.lamps; i++) { const a = i / GENIE.lamps * TAU, o = genieLamp(world, p.ent.x + Math.cos(a) * 420, p.ent.y + Math.sin(a) * 420); if (o) ev.objs.push(o.id); }
  world.L({ k: "event", room: world.name, n: p.n, name, animals: units.length, chests: ev.objs.length });
  return true;
}
// Genie lamps (changelog 2025: the Legendary Genies in the Desert, hit a genie lamp to make them appear, the Big Daddy Boss
// Genie is found in the genie lamp; owner): every desert season GENIE.lamps lamps stand at free spots. A broken lamp lets out
// the BMB Genie (bmb chance) or sleeping baby Genies. The BMB Genie's kill leaves a sleeping baby Genie, or sometimes
// (golem chance) wakes the Gold Golem boss there instead. A baby Genie lives through exactly one season change. Counts,
// chances and the lamp hp step: GUESSED (the event was removed before any capture).
const GENIE = { sp: 86, lamps: 3, step: 13, bmb: 0.5, babies: [1, 2], golem: 0.3, seasons: 1 };
function genieLamp(world, x, y) {
  const o = hiveStatic(world, "genie-lamp", x, y); if (!o) return null;
  o.genieLamp = true; o.hiveStep = GENIE.step;
  return o;
}
function genieLamps(world, phase, n) {
  const ph = world.phases && world.phases[phase], bb = ph && ph.bbox, out = [];
  for (let k = 0; bb && out.length < n && k < 80; k++) {
    const x = bb[0] + 600 + Math.random() * (bb[2] - bb[0] - 1200), y = bb[1] + 600 + Math.random() * (bb[3] - bb[1] - 1200);
    if (typeof world.blocked === "function" && world.blocked(x, y, 200)) continue;
    const o = genieLamp(world, x, y); if (o) out.push(o);
  }
  if (out.length) world.L({ k: "genie_lamps", room: world.name, n: out.length });
  return out;
}
function genieBaby(world, x, y) {
  const b = spawnWild(world, { "21": GENIE.sp, "22": petType(GENIE.sp), "23": 0, "7": 66 }, x, y, world.phase, true);   // asleep: tameable
  if (b) { b.tpl = null; b.surviveSwitch = GENIE.seasons; }
  return b;
}
function lampBreak(world, o) {
  if (Math.random() < GENIE.bmb) {
    const b = spawnWild(world, { "21": GENIE.sp, "22": petType(GENIE.sp), "23": 3, "7": 2 }, o.x, o.y, world.phase, true);
    if (b) { b.tpl = null; b.genieBmb = true; }
    world.L({ k: "genie_bmb", room: world.name, x: Math.round(o.x), y: Math.round(o.y) });
  } else {
    const n = GENIE.babies[0] + Math.floor(Math.random() * (GENIE.babies[1] - GENIE.babies[0] + 1));
    for (let i = 0; i < n; i++) genieBaby(world, o.x + (i - (n - 1) / 2) * 140, o.y);
    world.L({ k: "genie_babies", room: world.name, n });
  }
}
function genieBmbDead(world, e) {
  if (Math.random() < GENIE.golem) {
    const g = spawnWild(world, { "21": 101, "22": WB.typeBy[11] != null ? WB.typeBy[11] : petType(101), "23": 3, "7": 2 }, e.x, e.y, world.phase, true);
    if (g) { g.tpl = null; g.boss = true; g.goldGolem = true; }
    world.L({ k: "genie_golem", room: world.name, x: Math.round(e.x), y: Math.round(e.y) });
  } else { genieBaby(world, e.x, e.y); world.L({ k: "genie_baby", room: world.name }); }
}
// Gold Golem Boss (wiki): no baby pets; 4 golden chests, each with a Gold Golem's Eye, Heart (rarer) or Arm, the ingredients
// of Gold Golem's Potion (recipe [0, 45, 2], [0, 46, 1], [0, 47, 2]: Eye 45, Heart 46, Arm 47). Chest art gift76 / 77 / 78
// (the client's three gold rock chests) mapped Eye / Heart / Arm and the 2 : 1 : 2 odds: GUESSED.
const GOLEM_CHESTS = [[76, 45, 2], [77, 46, 1], [78, 47, 2]];
const GOLEM_PART = { 45: "Gold Golem Eye", 46: "Gold Golem Heart", 47: "Gold Golem Arm" };   // changelog: two Eyes, two Arms, a Heart
function golemChests(world, e) {
  const N = world.ctx && world.ctx.NAMES; if (!N || typeof world.objFromRec !== "function") return;
  // real fight (ws_20261019_140012, saopaulo5): gift76 at (-400, -400) and gift78 at (+400, -400) from the golem, 0.9 s before its
  // remove; the other two were out of view (wiki: four), placed at the mirrored corners
  const tot = GOLEM_CHESTS.reduce((a, q) => a + q[2], 0), at = [[-400, -400], [400, -400], [-400, 400], [400, 400]];
  for (const [dx, dy] of at) {
    let r = Math.random() * tot, q = GOLEM_CHESTS[0];
    for (const c of GOLEM_CHESTS) { r -= c[2]; if (r <= 0) { q = c; break; } }
    const name = "gift" + q[0], idx = N.indexOf(name); if (idx < 0) continue;
    const o = world.objFromRec({ "0": 0, "1": 79, "2": 3, "3": Math.round(e.x + dx), "4": Math.round(e.y + dy), "5": 628, "6": 1, "13": idx, name }, world.phase, "spawn");
    if (o) { o.rec = null; o.bossChest = true; o.golemItem = q[1]; }
  }
  world.L({ k: "golem_chests", room: world.name, n: at.length });
}
// owner: the client's own bottom pop-up (atl4 44, category 0 = bug / ingredient: "You got 1 ingredient!" with its art)
// instead of a chat line, as taming.io does
function popItem(p, id) { if (p && p.queue) p.queue({ "1": 44, o: 0, n: id, i: 1 }); }
function onChestOpen(world, o, by) {
  if (o.golemItem && by && PROFILE && PROFILE.catchInsect) {   // one random part per chest, drawn when it breaks
    let r = Math.random() * GOLEM_CHESTS.reduce((a, q) => a + q[2], 0), q = GOLEM_CHESTS[0];
    for (const c of GOLEM_CHESTS) { r -= c[2]; if (r <= 0) { q = c; break; } }
    PROFILE.catchInsect(q[1]);
    popItem(by, q[1]);
    world.L({ k: "golem_item", room: world.name, by: by.n, item: q[1] });
  }
  if (!o.sirenHeart || !by) return;
  if (PROFILE && PROFILE.catchInsect) PROFILE.catchInsect(HEART_ITEM);
  popItem(by, HEART_ITEM);
  world.L({ k: "guardian_heart", room: world.name, by: by.n, item: HEART_ITEM });
}
function sirenBabies(world, e) {
  const q = SANCTUARY[e.phase] || SANCTUARY[4];   // /event siren: the sanctuary may stand in any biome
  for (let i = 0; i < q.babies; i++) {
    const a = i / q.babies * TAU, b = spawnWild(world, { "21": q.siren, "22": q.type, "23": 0, "7": 2 }, e.x + Math.cos(a) * 120, e.y + Math.sin(a) * 120, world.phase, true);
    b.tpl = null; b.hiveBaby = true; b.sirenBaby = true; b.sleepAt = now0(world) + C.shadow_sleep_ms;   // owner: they nap soon (and stay put, as the hive babies) so they can be tamed
  }
  world.L({ k: "siren_babies", room: world.name, n: q.babies, x: Math.round(e.x), y: Math.round(e.y) });
}
// owner: every event runs all the time in its season, next to the season's world bosses. Forest: Easter Golden Eggs (+ a
// Richen Egg 25 %) and Thanksgiving Turkey Eggs; winter: a BMB Mammoth and Yetis; dark forest: the Hive Creep; desert:
// genie lamps; ocean: the statue sanctuary; and a Giant Gaze in every biome. Counts per season: GUESSED (owner's list).
// extra world bosses (wiki Bosses, owner): forest Trent (Plant Mask body 73) and Dragon Egg (Dragon 20 with the boss bit; the
// invented Grove Colossus is the same species without it), winter Snow Trent (Snow Rabbit 10), volcano Lava Golem (123);
// type field 22 from the scans; random free spots, back after a kill like the others (WB.respawn_ms)
const SEASON_EXTRA = { 0: { eggs: ["giant-golden-egg", "giant-golden-egg", "giant-golden-egg", "turkey-egg", "turkey-egg"], richen: 0.25, bosses: [[73, 9], [20, 73]] },
  1: { units: [[41, 3], [103, 1], [103, 1], [103, 0], [103, 0]], bosses: [[10, 45]] }, 5: { bosses: [[123, 20, 2]] } };   // Lava Golem: no giant art, its boss stage
function extraBoss(world, phase, sp, type, stage) {
  const at = freeSpot(world, phase, cRad(sp, 3) + 60); if (!at) return null;
  const e = spawnWild(world, { "21": sp, "22": type, "23": stage || 3, "7": 2, "25": 10 }, Math.round(at[0]), Math.round(at[1]), phase, true);
  if (!e) return null;
  e.tpl = null; e.worldBoss = true; e.boss = true; e.extraBoss = [sp, type, phase, stage];
  const hp = { 73: 8000, 20: 7000, 10: 8000, 123: 8500 }[sp]; if (hp) e.hp = e.max = hp;   // wiki Tree Boss 8000, Dragon Egg 7000, Snow Tree Boss 8000; Lava Golem: GUESSED
  return e;
}
function freeSpot(world, phase, pad) {
  const ph = world.phases && world.phases[phase], bb = ph && ph.bbox; if (!bb) return null;
  for (let k = 0; k < 60; k++) {
    const x = bb[0] + 600 + Math.random() * (bb[2] - bb[0] - 1200), y = bb[1] + 600 + Math.random() * (bb[3] - bb[1] - 1200);
    if (typeof world.blocked !== "function" || !world.blocked(x, y, pad)) return [x, y];
  }
  return null;
}
function giantGaze(world, x, y, tag) {
  WB_MINIONS[109] = WB_MINIONS[109] || [104, 105, 106, 107, 108, 109].map((k) => [k, petType(k)]);   // protector waves: random Gazes, never the fairy (Enchanting) Gaze (owner)
  const g = spawnWild(world, { "21": 109, "22": petType(109), "23": 3, "7": 2, "25": 10 }, Math.round(x), Math.round(y), world.phase, true);
  if (g) { g.tpl = null; g.worldBoss = true; g.boss = true; g.hp = g.max = 5500; g.name = "Giant Gaze"; if (tag) g.eventTag = tag; }
  return g;
}
function seasonExtras(world, phase) {
  const X = SEASON_EXTRA[phase] || {}, n = { eggs: 0, units: 0, gaze: 0 };
  const eggs = (X.eggs || []).concat(X.richen && Math.random() < X.richen ? ["giant-richen-egg"] : []);
  for (const g of eggs) { const at = freeSpot(world, phase, 220); if (at && eggStatic(world, g, at[0], at[1])) n.eggs++; }
  for (const [sp, stage] of X.units || []) {
    const at = freeSpot(world, phase, 160); if (!at) continue;
    const e = spawnWild(world, { "21": sp, "22": petType(sp), "23": stage, "7": stage === 0 ? 66 : 2 }, at[0], at[1], phase, true);
    if (e) { e.tpl = null; n.units++; }
  }
  const at = freeSpot(world, phase, 300); if (at && giantGaze(world, at[0], at[1])) n.gaze++;
  n.bosses = (X.bosses || []).filter(([sp, ty, sg]) => extraBoss(world, phase, sp, ty, sg)).length;
  world.L(Object.assign({ k: "season_extras", room: world.name, phase }, n));
}
function spawnPhase(world, phase) {
  const st = S(world);
  st.phase = phase;
  const wbs = WORLD_BOSSES ? worldBossSpawns(world, phase) : [];
  for (const b of wbs) {
    if (WB.near[b.sp]) { st.nearAt = 0; continue; }   // spawned next to a player instead (stepNearBoss)
    const rec = phaseList(world, phase).find((c) => c["21"] === b.sp) || {};
    const tpl = Object.assign({}, rec, { "21": b.sp, "22": WB.typeBy[b.marker] != null ? WB.typeBy[b.marker] : rec["22"] != null ? rec["22"] : 0, "23": WB.stageBy[b.marker] != null ? WB.stageBy[b.marker] : WB.stage, "7": 2, __wb: b.marker });
    spawnWild(world, tpl, b.x, b.y, phase);
  }
  for (const c of phaseList(world, phase)) {
    if (c["13"] != null || c["21"] == null) continue;
    if (wbs.some((b) => b.sp === c["21"])) continue;
    if (st.wild.size >= (world.P.creature_cap || 400)) break;
    spawnWild(world, c, c["3"], c["4"], phase);
  }
  if (SCAN_FILL) { const have = [...st.wild].filter((w) => w.phase === phase).length; const n = scanFill(world, phase, have); if (n) world.L({ k: "scan_fill", phase, have, added: n }); }
  if (phase === 2) spawnHive(world);
  if (phase === 3 && WORLD_BOSSES) genieLamps(world, phase, GENIE.lamps);
  if (WORLD_BOSSES) seasonExtras(world, phase);
  if (WORLD_BOSSES && STATUES[phase]) sanctuaryReset(world, phase);
}
// ------------------------------------------------------------ dark forest Hive Creep -> BMB shadow -> eggs -> baby shadows
function hiveStatic(world, nm, x, y) {
  const idx = world.ctx && world.ctx.NAMES ? world.ctx.NAMES.indexOf(nm) : -1;
  if (idx < 0 || typeof world.objFromRec !== "function") return null;
  const o = world.objFromRec({ "0": 0, "1": T_CREATE, "2": 3, "3": Math.round(x), "4": Math.round(y), "5": 628, "6": 1, "13": idx, name: nm }, world.phase, "spawn");
  if (o) o.rec = null;   // no same-spot respawn: a new hive comes with the next dark forest season
  if (o && nm !== "creep0" && nm !== "creep1" && nm !== "creep2") { o.hiveHit = true; o.cd = nm === "creep-hive" ? 120 : (typeof world.collideDist === "function" && world.collideDist(nm)) || 45; o.cd0 = o.cd; o.hiveStep = nm === "creep-hive" ? 13 : 90; }   // swing-hittable, solid (sprite-sized collide_by_def); hive ~20 hits, egg 3 (guess)
  return o;
}
// one hive per dark forest season at a free spot of the biome, ringed by shadow creep (wiki: stationary, random location)
function spawnHive(world, at) {
  const ph = world.phases && world.phases[2], bb = ph && ph.bbox; if (!bb) return null;
  let x = at ? at.x : 0, y = at ? at.y : 0;
  for (let k = 0; !at && k < 40; k++) {
    const tx = bb[0] + 600 + Math.random() * (bb[2] - bb[0] - 1200), ty = bb[1] + 600 + Math.random() * (bb[3] - bb[1] - 1200);
    if (typeof world.blocked !== "function" || !world.blocked(tx, ty, 260)) { x = tx; y = ty; break; }
  }
  if (!x && !y) return null;
  const h = hiveStatic(world, "creep-hive", x, y); if (!h) return null;
  h.hive = true;
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, r = 230 + (i % 2) * 90; hiveStatic(world, "creep" + (i % 3), x + Math.cos(a) * r, y + Math.sin(a) * r); }
  world.L({ k: "hive_spawn", room: world.name, x: Math.round(x), y: Math.round(y) });
  return h;
}
function hiveEggs(world, e) {
  for (let i = 0; i < C.hive_eggs; i++) {
    const a = i / C.hive_eggs * TAU, o = hiveStatic(world, "shadow-egg" + Math.floor(Math.random() * 5), e.x + Math.cos(a) * C.hive_egg_r, e.y + Math.sin(a) * C.hive_egg_r);
    if (o) o.shadowEgg = true;
  }
  world.L({ k: "hive_eggs", room: world.name, n: C.hive_eggs });
}
// world.js hitResource: a natural object was destroyed
function onDeplete(world, o, by) {
  if (o.hive) {
    const [sp, type] = SHADOWS[5];   // the BMB "Original" shadow: Savant (100) is the only shadow with a stage 3 row in the client table
    const b = spawnWild(world, { "21": sp, "22": type, "23": 3, "7": 2 }, o.x, o.y, world.phase, true);
    b.tpl = null; b.hiveBmb = true;   // no respawn; it dies into eggs
    world.L({ k: "hive_bmb", room: world.name, species: sp });
  } else if (o.genieLamp) {
    lampBreak(world, o);
  } else if (o.statue) {
    statueWake(world, o);
  } else if (o.eggKind) {
    eggBreak(world, o);
  } else if (o.shadowEgg) {
    const [sp, type] = SHADOWS[Math.floor(Math.random() * SHADOWS.length)];
    const b = spawnWild(world, { "21": sp, "22": type, "23": 0, "7": 2 }, o.x, o.y, world.phase, true);
    b.tpl = null; b.hiveBaby = true; b.sleepAt = now0(world) + C.shadow_sleep_ms;
    world.L({ k: "hive_baby", room: world.name, species: sp });
  }
}
function byPlayer(world, by) {
  if (!by) return null;
  if (by.ent !== undefined && by.queue) return by;              // Player
  if (by.p && by.p.queue) return by.p;                           // player entity
  if (by.kind === "pet" && by.owner) return by.owner;            // pet -> owner
  if (by.kind === "placed" && by.owner != null) return world.players.get(by.owner) || null;
  if (by.kind === "projectile" && by.src) return byPlayer(world, by.src);
  return null;
}
function entOf(by) {
  if (!by) return null;
  if (by.queue && by.ent !== undefined) return by.ent;
  return by;
}
// /admin (world.P.admin_hit_frac): a hit from an admin, his pet or its skill takes half the target's max hp
function adminHit(world, by, e, dmg) {
  const pl = byPlayer(world, by), f = world.P && world.P.admin_hit_frac;
  return pl && pl.god && f ? Math.ceil(e.max * f) : dmg;
}
function hurtWild(world, e, dmg, by) {
  if (e.st === "dying" || !world.ents.has(e.id)) return 0;
  if (e.st === "taming" && e.tamer && by !== e.tamer && byPlayer(world, by) === e.tamer) return 0;   // the tamer's own pets / buildings leave it alone
  const st = S(world), d = kdef(world, e.sp, e.stage);
  if (e.laserUntil > now0(world)) return 0;   // fire dragon: invincible while the Fire Laser runs (wiki)
  if (e.sp === 101 && e.stage === 3) dmg *= 0.88;   // Gold Golem boss: 12% damage / magic damage reduction (wiki)
  dmg = Math.max(0, Math.round(dmg));
  if (!dmg) return 0;
  dmg = (e.s7 & 64) ? 0 : adminHit(world, by, e, dmg);   // owner: the first hit on a sleeper does 0 and only wakes it
  e.hp -= dmg;
  const f = { "9": Math.max(0, Math.round(e.hp / e.max * 255)), "10": dmg };
  const pl = by && by.queue ? by : null, src = entOf(by);
  if (pl || (src && src.kind === "player")) f["11"] = 1;
  else if (src && src.kind === "placed") f["11"] = 3;
  if (e.st === "taming") { if (e.tamer && e.tamer.sb) e.tamer.sb.sbu = (e.tamer.sb.sbu || 0) + 1; e.st = "wander"; f["12"] = 0; e.tamer = null; }
  if (e.vs) e.vsBy = src;
  if (e.hp <= 0) { f["7"] = 18; f["9"] = 0; e.s7 = 18; world.touch(e, f); killWild(world, e, byPlayer(world, by)); pounceChain(world, src, e); return dmg; }
  if (e.s7 & 64) { e.s7 = 2; e.wake7 = 2; f["7"] = 2; }
  world.touch(e, f);
  if (!e.vs) fairyWave(world, e);
  const att = src && src.kind === "placed" ? null : src;
  if (d.mode === "passive" || (ASTAR && d.flee) || passiveBaby(e)) { if (att) { e.flee = att; e.fleeUntil = now0(world) + 3000; e.path = null; } }
  else if (att && att !== e && (att.kind === "player" || att.kind === "pet") && !(att.veilUntil > now0(world))) { e.tgt = att; e.st = "chase"; }
  else if (src && src.kind === "placed" && byPlayer(world, by) && byPlayer(world, by).ent) { e.tgt = byPlayer(world, by).ent; e.st = "chase"; }
  return dmg;
}
function pounceChain(world, k, dead) {   // Cinder Prowler: a kill sends it straight at the next enemy with a stronger bite
  if (!k || k.kind !== "pet" || !k.inv || !k.inv.kit || !k.inv.kit.pounce || k.dead) return;
  const P = k.inv.kit.pounce; let best = null, bd = P.r;
  for (const t of enemiesNear(world, k, k.x, k.y, P.r)) { if (t === dead || t.dying) continue; const q = dist(k, t); if (q < bd) { bd = q; best = t; } }
  if (!best) return;
  k.tgt = best; k.pounceBoost = true; k.retreat = false;
  kitLog(world, k, "Pounce Chain", { target: best.id });
}
function killWild(world, e, killer) {
  const st = S(world), d = kdef(world, e.sp, e.stage), now = now0(world);
  e.st = "dying"; e.dying = true; e.tgt = null; e.dieAt = now + C.die_ms;
  if (e.boss && world.boss && world.boss.kind === e.sp) world.boss = null;
  st.wild.delete(e); st.dying.add(e);
  if (e.vs) { vsKilled(world, e); return; }
  if (e.reaper) { if (S(world).restart) S(world).restart.reapers.delete(e); if (killer && killer.alive) killer.gain({ 3: RP.gold }); world.L({ k: "reaper_kill", room: world.name, by: killer ? killer.n : null }); }
  if (killer && killer.alive) {
    const xp = d.xp, gold = d.gold, food = d.food;
    if (killer.kills) killer.kills.animals = (killer.kills.animals || 0) + 1;
    killer.addXp(xp, "animal_kill");
    const add = {}; if (gold) add[3] = gold; if (food) add[0] = Math.round(food * ((killer.mods && killer.mods.food_kill_mult) || 1));   // Explorer Hat
    if (Object.keys(add).length) killer.gain(add);
    petLevel(world, killer, Math.round(xp * ((killer.mods && killer.mods.pet_xp_mult) || 1)));   // King's Crown
  }
  if (e.worldBoss) { bossChests(world, e); bossBabies(world, e); }
  if (e.extraBoss) { const [sp, ty, ph, sg] = e.extraBoss; world.after(WB.respawn_ms, () => { if (S(world).phase === ph && !S(world).vs) extraBoss(world, ph, sp, ty, sg); }); }
  if (e.hiveBmb) hiveEggs(world, e);
  if (e.eggBmb != null) eggBaby(world, e.eggBmb, e.x, e.y, e.eventTag);
  if (e.sirenBmb) sirenBabies(world, e);
  if (e.sanctStatue) statueDead(world);
  if (e.genieBmb) genieBmbDead(world, e);
  if (e.sp === 101 && (e.stage | 0) === 3) golemChests(world, e);
  if (typeof world.killed === "function") world.killed(e, killer || null);
  world.L({ k: "creature_kill", room: world.name, species: e.sp, name: spName(e.sp), by: killer ? killer.n : null });
  if (e.worldBoss && WB.near[e.sp]) st.nearAt = now + WB.respawn_ms;   // comes back next to a player
  else if (e.phase === st.phase && e.tpl) st.respawn.push({ at: now + (e.worldBoss ? WB.respawn_ms : C.respawn_ms), tpl: e.tpl, hx: e.hx, hy: e.hy, phase: e.phase });
}
// damage to a player names the source: creature entity (cause creature:<kind>) or the pet's owner (cause pet)
// no friendly fire: same owner or same team (world.sameTeam), wild creatures are never friends
function friendly(world, a, b) {
  if (!a || !b || a.kind === "animal" || b.kind === "animal") return false;
  if (typeof world.sameTeam === "function") { try { return !!world.sameTeam(a, b); } catch (e) { return false; } }
  const own = (x) => x.queue ? x : x.p && x.p.queue ? x.p : x.owner && x.owner.queue ? x.owner : null;
  const oa = own(a), ob = own(b);
  return !!(oa && ob && oa === ob);
}
function hit(world, tgt, dmg, src) {
  if (src && tgt && friendly(world, src, tgt)) return 0;
  if (src && src.vs && S(world).vs) dmg = vsCap(world, S(world).vs, tgt, dmg);   // /versus player: boss attacks obey the same caps
  if (tgt && tgt.kind === "player" && tgt.p) {
    const p = tgt.p; if (!p.alive || !(dmg > 0)) return 0;
    if (src && src.kind === "pet") p.hurt(dmg, src.owner || null, "pet");
    else if (src && src.kind === "animal") p.hurt(dmg, src, "creature:" + kdef(world, src.sp, src.stage).name);
    else if (src && src.kind === "placed") p.hurt(dmg, src.owner != null ? world.players.get(src.owner) || null : null, "turret:" + (src.name || ""));
    else return world.damage(tgt, dmg, src);
    return dmg;
  }
  return world.damage(tgt, dmg, src);
}
function attack(world, e, d, tgt, now) {
  e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms;
  world.touch(e, { "7": 34, "5": ang255(e.a) });
  const dmg = e.biteDmg || (tgt.kind === "pet" ? d.pdmg : d.dmg);   // biteDmg: BMB Turkey 60 (wiki)
  if (dmg > 0) hit(world, tgt, dmg, e);
  if (tgt.kind === "player" && tgt.p) defendOwner(world, tgt.p, e, true);
}
function skill(world, e, d, tgt, now) {
  const s = d.skill; if (!s || now - e.lastSkill < s.every) return;
  e.lastSkill = now;
  const base = Math.atan2(tgt.y - e.y, tgt.x - e.x), n = s.k.length;
  s.k.forEach((k, i) => {
    const a = base + (n > 1 ? (i - (n - 1) / 2) * 0.25 : 0);
    spawnProj(world, { k, x: e.x + Math.cos(a) * 60, y: e.y + Math.sin(a) * 60, a, speed: s.speed, life: s.life, dmg: s.dmg, src: e, hostile: "players" });
  });
}
// owner: wild babies never attack players or pets, even when hit; only a baby whose tame failed (angry) attacks its tamer
const passiveBaby = (e) => (e.stage | 0) === 0 && !e.angry && !e.vs && e.kind === "animal";
function validTgt(world, t, now) {
  if (!t || !world.ents.has(t.id)) return false;
  if (t.kind === "player") return !!(t.p && t.p.alive && !(t.p.shieldUntil > now));
  if (t.kind === "pet") return !t.dead && !(t.veilUntil > now);
  if (t.kind === "animal") return t.st !== "dying" && !t.dying;
  if (t.kind === "placed") return !t.dying;   // right-click on a building: the pet bites it until it breaks
  return false;
}
// body radius per species and stage from the client creature table (its own radius field, used for click targeting;
// mimic/data/creature_radius.json, dumped with the direct_scan harness): wolf 50 / 60 / 80 / 105, world bosses ~200-230
let CRAD = null;
function cRad(sp, stage) {
  if (CRAD === null) { try { CRAD = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "creature_radius.json"), "utf8")); } catch (e) { CRAD = {}; } }
  const a = CRAD[bsp(sp)] && CRAD[bsp(sp)][1]; if (!a || !a.length) return C.body_r;
  const v = a[Math.min(stage | 0, a.length - 1)]; return v > 0 ? v : C.body_r;
}
// body for collisions (351 recorded sessions, work/creature_collision.md): creatures and pets block each other at
// r1 + r2 and players at r + 43.5; a few boss stages collide smaller than their table radius (click radius)
const COLL_R = { "15/3": 165, "73/3": 140, "68/3": 90 };   // deer, plant mask, flying squirrel boss stages
function collR(sp, stage) { const o = COLL_R[sp + "/" + (stage | 0)]; return o != null ? o : cRad(sp, stage); }
function bodyR(e) { return e.cr || e.r || C.body_r; }
function idleShuffle(world, e, oe, now, dt) {   // walks non-stop: out to ~393 from the owner, back in to ~167 (8 sessions)
  if (!e.sh || Math.hypot(e.sh.x - e.x, e.sh.y - e.y) < 8 || now >= e.sh.at) {
    const d = Math.hypot(e.x - oe.x, e.y - oe.y), out = d < (C.pet_idle_in + C.pet_idle_out) / 2;
    const a = Math.atan2(e.y - oe.y, e.x - oe.x) + (Math.random() - 0.5) * 1.6, r = out ? C.pet_idle_out * (0.9 + Math.random() * 0.2) : C.pet_idle_in * (0.9 + Math.random() * 0.2);
    e.sh = { x: oe.x + Math.cos(a) * r, y: oe.y + Math.sin(a) * r, at: now + 8000 };
  }
  moveToward(world, e, e.sh.x, e.sh.y, C.pet_idle_speed, dt, 4);
}
function tRad(world, t) { return t.kind === "placed" ? world.buildR(t.name, t.cd) : (t.r || 35); }   // a building: its block radius
// measured pet movement per species (tools/scan/pet_speed.py over every decoded scan and human capture, hourly stitch):
// run = p90 of the species' moving samples (wolf 268 vs sp5 270) when 5+ pets were seen, dash = median peak of 2+ frame
// spikes above 1.8 x run when 2+ were seen, else the all-species dash median
let PSPD = null;
function petSpeed() { if (PSPD === null) { try { PSPD = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "pet_speed.json"), "utf8")); } catch (e) { PSPD = {}; } } return PSPD; }
function petRun(e) { return TRK.speed(e, petRun0(e), Date.now()); }   // trinket speed bonus / malus
function petRun0(e) {
  const m = petSpeed()[bsp(e.sp)];
  if (m && m.pets >= 5 && m.run > 0) return m.run;
  return (C.pet_run_by && C.pet_run_by[bsp(e.sp)]) || C.pet_run * petScale(e.sp, e.stage, "speed");
}
function moveToward(world, e, tx, ty, sp, dt, stopAt) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  e.a = Math.atan2(dy, dx);
  if (d <= stopAt || sp <= 0) return false;
  const step = Math.min(sp * dt, d - stopAt);
  const cd = e.cd; e.cd = 0;   // not against itself
  const [nx, ny] = world.collide(e.x + dx / d * step, e.y + dy / d * step, 0.8, e, bodyR(e));
  e.cd = cd; e.x = nx; e.y = ny;
  return true;
}
// ------------------------------------------------------------ navigation (on unless TIO_CREATURE_ASTAR=0)
// Coarse grid A* around solid statics/placed and the map edge, line-of-sight shortcuts, heading-limited steering so
// paths curve. Wander picks run lengths and pauses from the capture, from wherever the creature is (no home).
const ASTAR = process.env.TIO_CREATURE_ASTAR !== "0";   // on by default; TIO_CREATURE_ASTAR=0 restores the old straight-line + home movement
const SLIDE = process.env.TIO_SLIDE !== "0";   // pets bite only when a centred or blocked slide holds them (world.collide); TIO_SLIDE=0: the old stuck rule
const NAV = {
  cell: 32, budget: 1600, pad: 40, slack: 0, cache_ms: 5000, replan_ms: 500, los_step: 32,
  turn_rate: 3.0,          // rad/s steering limit
  run_q: [59, 188, 367, 928, 1682], pause_q: [0.6, 1.8, 10.1, 35.9, 107.0],
};
function qsample(q) {   // piecewise-linear sample of a q10/q25/q50/q75/q90 distribution
  const u = Math.random(), P = [0.1, 0.25, 0.5, 0.75, 0.9];
  if (u <= P[0]) return q[0] * (0.5 + 0.5 * u / P[0]);
  for (let i = 1; i < P.length; i++) if (u <= P[i]) return q[i - 1] + (q[i] - q[i - 1]) * (u - P[i - 1]) / (P[i] - P[i - 1]);
  return q[4] * (1 + (u - 0.9) * 2);
}
// rad: the mover's body radius: a solid blocks within its player distance - player radius + rad + NAV.slack
// (without rad the old fixed NAV.pad); small pets use gaps that big ones cannot
function solidAt(world, x, y, rad) {
  const P = world.P, pad = rad != null ? rad - 35 + NAV.slack : NAV.pad;
  if (x < P.map_min || x > P.map_max || y < P.map_min || y > P.map_max) return true;
  const near = typeof world.solidsNear === "function" ? world.solidsNear(x, y, []) : world.ents.values();
  for (const o of near) {
    if (!o.cd || (o.kind !== "static" && o.kind !== "placed") || o.dying) continue;
    if (Math.abs(o.x - x) < o.cd + pad && Math.abs(o.y - y) < o.cd + pad && Math.hypot(o.x - x, o.y - y) < o.cd + pad) return true;
  }
  return false;
}
function cellBlocked(world, cx, cy, rad) {
  const st = S(world), now = now0(world), k = (cx * 4096 + cy) * 64 + (rad != null ? Math.min(63, Math.round(rad / 8)) : 0);
  if (st.navEpoch !== world.epoch || now - (st.navAt || 0) > NAV.cache_ms) { st.nav = new Map(); st.navEpoch = world.epoch; st.navAt = now; }
  let v = st.nav.get(k);
  if (v === undefined) { v = solidAt(world, (cx + 0.5) * NAV.cell, (cy + 0.5) * NAV.cell, rad); st.nav.set(k, v); }
  return v;
}
function los(world, x0, y0, x1, y1, rad) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / NAV.los_step));
  for (let i = 1; i <= n; i++) { const t = i / n; if (solidAt(world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rad)) return false; }
  return true;
}
// A* from (x0,y0) to (x1,y1); null when the goal is unreachable within the node budget
function astar(world, x0, y0, x1, y1, rad) {
  const c = NAV.cell, sx = Math.floor(x0 / c), sy = Math.floor(y0 / c), gx = Math.floor(x1 / c), gy = Math.floor(y1 / c);
  if (cellBlocked(world, gx, gy, rad)) return null;
  const key = (x, y) => x * 4096 + y, h = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const open = [[h(sx, sy), 0, sx, sy]], came = new Map(), g = new Map([[key(sx, sy), 0]]);
  let n = 0;
  while (open.length && n < NAV.budget) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, gc, x, y] = open[bi]; open[bi] = open[open.length - 1]; open.pop(); n++;
    if (x === gx && y === gy) {
      const pts = []; let k = key(x, y);
      while (k !== undefined) { pts.push([(Math.floor(k / 4096) + 0.5) * c, (k % 4096 + 0.5) * c]); k = came.get(k); }
      pts.reverse(); pts[0] = [x0, y0]; pts[pts.length - 1] = [x1, y1];
      return smooth(world, pts, rad);
    }
    if (gc > g.get(key(x, y))) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (cellBlocked(world, nx, ny, rad)) continue;
      if (dx && dy && (cellBlocked(world, x + dx, y, rad) || cellBlocked(world, x, y + dy, rad))) continue;   // no corner cutting
      const ng = gc + (dx && dy ? 1.414 : 1), nk = key(nx, ny);
      if (ng < (g.has(nk) ? g.get(nk) : Infinity)) { g.set(nk, ng); came.set(nk, key(x, y)); open.push([ng + h(nx, ny), ng, nx, ny]); }
    }
  }
  return null;
}
function smooth(world, pts, rad) {   // string pulling: keep only the waypoints needed for line of sight
  const out = [pts[0]]; let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !los(world, pts[i][0], pts[i][1], pts[j][0], pts[j][1], rad)) j--;
    out.push(pts[j]); i = j;
  }
  return out.slice(1);
}
function planTo(world, e, tx, ty) {
  const rad = e.r || undefined;
  if (los(world, e.x, e.y, tx, ty, rad)) { e.path = [[tx, ty]]; return true; }
  const p = astar(world, e.x, e.y, tx, ty, rad);
  e.path = p; return !!p;
}
// follow e.path with a turn-rate limit; returns true when the end is reached
function steer(world, e, sp, dt, stopAt) {
  if (!e.path || !e.path.length) return true;
  let [tx, ty] = e.path[0];
  const last = e.path.length === 1, d = Math.hypot(tx - e.x, ty - e.y);
  if (last ? d <= stopAt + 4 : d <= Math.max(8, sp * dt)) { e.path.shift(); if (!e.path.length) return true; [tx, ty] = e.path[0]; }
  if (e.h == null) e.h = e.a;
  const want = Math.atan2(ty - e.y, tx - e.x);
  let dh = ((want - e.h + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const lim = NAV.turn_rate * dt; dh = Math.max(-lim, Math.min(lim, dh));
  e.h += dh; e.a = e.h;
  const v = Math.abs(dh) >= lim * 0.99 && Math.hypot(tx - e.x, ty - e.y) < 120 ? sp * 0.5 : sp;   // slow down in tight turns
  const cd = e.cd; e.cd = 0;
  const [nx, ny] = world.collide(e.x + Math.cos(e.h) * v * dt, e.y + Math.sin(e.h) * v * dt, 0.8, e, bodyR(e));
  e.cd = cd;
  if (Math.hypot(nx - e.x, ny - e.y) < v * dt * 0.2) e.stuck = (e.stuck || 0) + 1; else e.stuck = 0;
  e.x = nx; e.y = ny;
  return false;
}
// owned pets move in straight lines (owner): no path finding, they slide along what is in the way, squeeze like the
// player (body up to 20 % smaller while pressed into solids) and bite the solid in front of them when stuck
const PET_SQ = { max: 0.2, step: 0.06, relax: 0.02, stuck_ms: 400 };
function petBreakable(world, o, e) {   // gold (golden buildings, gold ore) and world boss things never break
  if (!o || o.dying || (o.kind !== "placed" && o.kind !== "static")) return false;
  if (o.worldBoss || o.boss || /gold/i.test(o.name || "")) return false;
  if (o.kind === "static") return o.hp != null && !/gift|chest/i.test(o.name || "");   // owner: trees, rocks, logs in the way get bitten through like a hammer would
  return o.kind === "placed" && (!friendly(world, e, o) || !!e.ordered || !!e.follow);   // owner: own / team ones on a right-click order or on the way back to him
}
// stuck: less than PET_STUCK.gain closer to the goal over the last PET_STUCK.ms (one good tick does not reset it)
const PET_STUCK = { ms: 1000, gain: 40 };
function stuckWindow(e, d0, now) {
  if (!e.pw || now - e.pw.t >= PET_STUCK.ms) { e.pwStuck = !!e.pw && e.pw.d - d0 < PET_STUCK.gain; e.pw = { t: now, d: d0 }; }
  return e.pwStuck;
}
function biteBlocker(world, e, tx, ty, now) {   // bites the breakable solid in the way; true while chewing
  const sb = e.slideBlk && now - (e.slideBlkAt || 0) < 400 && petBreakable(world, e.slideBlk, e) ? e.slideBlk : null;   // what the slide stopped at
  const o = chewTarget(world, e, tx, ty) || sb || blockerAhead(world, e, tx, ty, (b) => petBreakable(world, b, e));   // owner: never give up, bite whatever breakable is in the way
  e.chewOn = o || null;
  e.chewing = !!o;
  if (e.chewing && now - e.lastAtk >= C.pet_every) {
    const c = world.coreOf(o, e.x, e.y); e.a = Math.atan2(c[1] - e.y, c[0] - e.x);   // owner: face what it bites, not its walking heading
    e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34, "5": ang255(e.a) });
    // an own / team structure (right-click order) takes the bite without an attacker: the friendly check would refuse it
    const d = kdef(world, e.sp, e.stage), dmg = (e.primary || e.starter ? C.pet_dmg : Math.max(C.pet_dmg, d.dmg)) * (e.primary || e.starter ? petScale(e.sp, e.stage, "dmg") : 1) * petBoost(e);   // owner: bite like its attack
    if (o.kind === "static") world.hitResource(o, null, ang255(Math.atan2(o.y - e.y, o.x - e.x)), Math.max(25, Math.round(dmg * C.ob_dmg_mult * 255 / (world.P.resource_hp_wiki || 400))));   // owner: about a hammer, ~10 bites a tree
    else world.damage(o, Math.max(1, Math.round(dmg * C.ob_dmg_mult)), friendly(world, e, o) ? null : e);
  }
  return e.chewing;
}
// the structure the pet started chewing, while it is still beside the pet and roughly toward the goal
function chewTarget(world, e, tx, ty) {
  const o = e.chewOn;
  if (!o || world.ents.get(o.id) !== o || o.dying || !petBreakable(world, o, e)) return (e.chewOn = null);
  const reach = (o.cr != null ? o.cr : Math.max(0, o.cd - world.P.player_radius)) + bodyR(e) + 45;
  const off = Math.abs(((Math.atan2(o.y - e.y, o.x - e.x) - Math.atan2(ty - e.y, tx - e.x) + Math.PI) % TAU + TAU) % TAU - Math.PI);
  return Math.hypot(o.x - e.x, o.y - e.y) <= reach && off < 1.6 ? o : (e.chewOn = null);
}
function blockerAhead(world, e, tx, ty, ok) {   // the solid the pet is pressed against, closest to its heading (ok: filter)
  const a = Math.atan2(ty - e.y, tx - e.x), r = bodyR(e), P = world.P;
  let best = null, bs = Infinity;
  for (const o of world.solidsNear(e.x, e.y, [])) {
    if (!o.cd || (o.kind !== "static" && o.kind !== "placed") || o.dying || (ok && !ok(o))) continue;
    const cd = o.cr != null ? o.cr + r : Math.max(0, o.cd - P.player_radius) + r, d = Math.hypot(o.x - e.x, o.y - e.y);
    if (d > cd + 40) continue;
    const off = Math.abs(((Math.atan2(o.y - e.y, o.x - e.x) - a + Math.PI) % TAU + TAU) % TAU - Math.PI);
    if (off < 1.4 && off < bs) { bs = off; best = o; }
  }
  return best;
}
function petWalk(world, e, tx, ty, sp, dt, stopAt, now) {
  const d0 = Math.hypot(tx - e.x, ty - e.y), want = Math.min(sp * dt, Math.max(0, d0 - stopAt));
  if (d0 > stopAt + 30 && chewTarget(world, e, tx, ty)) { biteBlocker(world, e, tx, ty, now); return 0; }   // owner: stand and finish it
  const r0 = e.cr; e.cr = bodyR(e) * (1 - (e.sq || 0));
  moveToward(world, e, tx, ty, sp, dt, stopAt);
  e.cr = r0;
  const got = d0 - Math.hypot(tx - e.x, ty - e.y);   // progress toward the goal (sliding sideways along a wall is not progress)
  if (want > 0.5 && got < want * 0.35) e.sq = Math.min(PET_SQ.max, (e.sq || 0) + PET_SQ.step);
  else if (e.sq) e.sq = Math.max(0, e.sq - PET_SQ.relax);
  const held = !SLIDE || (e.slideBlk && now - (e.slideBlkAt || 0) < 400);   // owner: sliding round a solid is no reason to bite it; a centred or blocked push is
  if (d0 > stopAt + 30 && stuckWindow(e, d0, now) && held) {   // owner: can't get closer -> bite through what is in the way
    if (!e.stuckAt) e.stuckAt = now;
    biteBlocker(world, e, tx, ty, now);
  } else { e.stuckAt = 0; e.chewing = false; }
  return got;
}
// right-click go-to in a straight line: runs to ~125 from the spot, walks in (recorded); true when arrived
// (arrived: the pet stays at that spot, any distance from the owner, until a stop / attack / defense button)
// stuck: it keeps biting whatever breakable is in the way and never gives up (owner)
function goStep(world, e, sp, dt, now) {
  const d = Math.hypot(e.goto.x - e.x, e.goto.y - e.y);
  if (d < 12) { e.anchor = { x: e.goto.x, y: e.goto.y }; return true; }
  petWalk(world, e, e.goto.x, e.goto.y, d > 125 ? sp : C.pet_idle_speed, dt, 8, now);
  return false;
}
// anchored (go-to arrived or stop): short wander around the spot
function anchorStep(world, e, now, dt) {
  const A = e.anchor;
  if (!e.wt || now >= e.wt.at || Math.hypot(e.wt.x - e.x, e.wt.y - e.y) < 6) {
    const a = Math.random() * TAU, r = Math.random() * C.pet_anchor_r;   // stop / go-to spot: wanders up to ~200 (q50 ~90) at walk speed
    e.wt = { x: A.x + Math.cos(a) * r, y: A.y + Math.sin(a) * r, at: now + 1500 + Math.random() * 2500 };
  }
  moveToward(world, e, e.wt.x, e.wt.y, C.pet_idle_speed, dt, 4);
}
function newWander(world, e, now) {
  for (let k = 0; k < 4; k++) {
    const a = (e.h != null ? e.h : Math.random() * TAU) + (Math.random() - 0.5) * Math.PI * 1.5, r = qsample(NAV.run_q);
    const tx = e.x + Math.cos(a) * r, ty = e.y + Math.sin(a) * r;
    if (solidAt(world, tx, ty)) continue;
    if (planTo(world, e, tx, ty)) { e.st = "walk"; return true; }
  }
  e.path = null; e.idleUntil = now + 1000; return false;
}
function stepWildNav(world, e, now, dt, awake, d) {
  if (e.tgt && (!validTgt(world, e.tgt, now) || dist(e, e.tgt) > C.give_up)) {
    if (e.tgt.kind === "player" && e.tgt.p) { e.calm = e.calm || new Map(); e.calm.set(e.tgt.p.n, now + C.calm_ms); }
    e.tgt = null; e.st = "wander"; e.path = null; e.idleUntil = now + qsample(NAV.pause_q) * 1000;
  }
  if (!awake) return;
  if (!e.tgt && d.mode === "aggro" && !(e.s7 & 64) && !e.hiveBaby && !passiveBaby(e)) {   // hive babies: passive until they nap
    let best = null, bd = d.aggro;
    for (const p of world.players.values()) {
      const pe = p.ent; if (!pe || !p.alive || p.shieldUntil > now) continue;
      if (e.calm && e.calm.get(p.n) > now) continue;
      const q = dist(e, pe); if (q < bd) { bd = q; best = pe; }
    }
    for (const pt of S(world).pets) { if (pt.dead || pt.veilUntil > now) continue; const q = dist(e, pt); if (q < bd) { bd = q; best = pt; } }
    if (best) { e.tgt = best; e.st = "chase"; e.path = null; e.planAt = 0; }
  }
  if (e.fleeUntil > now && e.flee && world.ents.has(e.flee.id)) {
    if (!e.path || now - (e.planAt || 0) > NAV.replan_ms) {
      const a = Math.atan2(e.y - e.flee.y, e.x - e.flee.x); e.planAt = now;
      if (!planTo(world, e, e.x + Math.cos(a) * 300, e.y + Math.sin(a) * 300)) e.path = null;
    }
    steer(world, e, d.chase, dt, 0);
  } else if (e.tgt) {
    const t = e.tgt, q = dist(e, t);
    if (q > d.reach - 8) {
      if (!e.path || now - (e.planAt || 0) > NAV.replan_ms) { e.planAt = now; if (!planTo(world, e, t.x, t.y)) e.path = [[t.x, t.y]]; }
      steer(world, e, d.chase, dt, d.reach - 8);
    } else { e.path = null; e.a = e.h = Math.atan2(t.y - e.y, t.x - e.x); }
    if (q <= Math.max(d.reach, e.cd || 0) + 12 && now - e.lastAtk >= d.every) attack(world, e, d, t, now);
    else if (q < 600) skill(world, e, d, t, now);
  } else if (d.chase > 0 && !(e.s7 & 64)) {
    if (e.st === "walk" && e.path) {
      const done = steer(world, e, C.walk, dt, 0);
      if (done || e.stuck > 6) { e.st = "wander"; e.path = null; e.stuck = 0; e.idleUntil = now + qsample(NAV.pause_q) * 1000; }
    } else if (!(e.idleUntil > now)) newWander(world, e, now);
  }
}
// world boss: never moves; turns to the nearest player or pet within WB.aggro of its spot, bites in reach, casts its skill
// recorded boss attacks (near-boss scans 20261018_11, effects created with the boss as source): [effect kind, variant,
// median gap ms, burst]; damage per hit on players / pets within radius: wiki where it names the move (Trent swing 60,
// thorns 12 / 6; cactus needles 25, thorn puddle 8), otherwise 20 (guess); radius: boss radius + 120 (guess)
const WB_ATK = {
  // Giant Gaze (event): wiki Earthquake 20 a tick (15 to tamers), Egg Bombs 50; art kinds (stone-golem quake 191, impact 14) and
  // cadence GUESSED
  109: [[191, 2, 2400, 1, 15], [14, 3, 3300, 3, 50]],
  121: [[12, 3, 1600, 1, 20], [525, 3, 2000, 1, 20], [196, 3, 1700, 1, 20], [517, 3, 2900, 1, 20], [163, 3, 3900, 1, 20], [193, 2, 23000, 1, 30]],
  20: [[6, 3, 1400, 1, 60], [212, 2, 13500, 1, 12], [196, 1, 20000, 1, 12], [197, 1, 20000, 1, 12], [198, 1, 20000, 1, 12]],
  // all 38 scans (stage-3 creatures as effect source): ice golem, stone golem, dark-tree boss (Flying Squirrel stage 3),
  // Plant Mask stage 3, gold golem
  21: [[10, 3, 1400, 1, 20], [196, 2, 11600, 1, 30]],
  62: [[14, 3, 1700, 1, 50], [13, 3, 1700, 1, 20], [191, 2, 8100, 1, 30], [212, 2, 17200, 1, 30]],   // effects and cadence: scans; impact 14 damage 50: scan Silicon_Valley_4_desert_nearboss_stone-golem_20261018_122421 t 85.0 (n 1, 97 from a 2.5 s old impact; the 5s ~165 out are cactus contact); the rest: guess
  68: [[193, 2, 19300, 1, 30], [212, 2, 25000, 1, 30], [197, 2, 21800, 1, 30]],
  73: [[75, 3, 4700, 1, 20], [212, 2, 24300, 1, 30]],
  101: [[11, 3, 8000, 1, 75]],   // Golden Slam (wiki 75 around it); cadence: scan Toronto_2_forest_nearboss_gold-golem_20261018_123328 median 8.0 s (n 7)
  76: [[71, 3, 8000, -4, 25]],   // ice dragon (live capture 20261018_125257): 71, 72, 73, 74 in ~1.8 s, 120 apart in a line; cadence 8 s guess
  15: [[265, 0, 2000, 8, 25], [194, 2, 21000, 1, 8], [198, 2, 22600, 1, 8], [197, 2, 22000, 1, 8], [212, 2, 48000, 1, 8]],
};
// recorded boss specials (none yet: the manchester2 hits first read as a stone golem special were cactus contact)
const WB_SPECIAL = {};
// who a boss attack can hit: the players (and pets) in the open world; in /versus the other side's units, or the hunted player
// and his pets, wrapped like players so the same attack code (slam, meteors, laser, bombs) runs unchanged
function bossPlayers(world, e) {
  const V = S(world).vs; if (!e.vs || !V) return world.players.values();
  const foes = V.player ? [V.player.ent].concat(S(world).byOwner.get(V.player.n) || []) : [...V.side[3 - e.vs]];
  return foes.filter((o) => o && world.ents.has(o.id) && !o.dying).map((o) => o.kind === "player" ? o.p : { alive: true, ent: o, n: o.id, shieldUntil: 0 });
}
function bossSpecial(world, e, now) {
  const S1 = WB_SPECIAL[e.sp]; if (!S1 || !e.tgt) return;
  if (!e.spAt) e.spAt = now + S1.every * (0.8 + Math.random() * 0.4);
  if (now < e.spAt) return;
  e.spAt = now + S1.every * (0.8 + Math.random() * 0.4);
  const t = e.tgt, cx = t.x, cy = t.y;
  world.touch(e, { "7": S1.state }); e.s7 = S1.state; e.flagUntil = now + 1500;
  for (let i = 0; i < S1.burst[0]; i++) hit(world, t, S1.burst[1], e);
  for (let i = 1; i <= S1.dot[0]; i++) world.after(i * S1.dot[2], () => {
    for (const p of bossPlayers(world, e)) if (p.alive && p.ent && Math.hypot(p.ent.x - cx, p.ent.y - cy) < S1.r) hit(world, p.ent, S1.dot[1], e);
  });
  world.L({ k: "boss_special", sp: e.sp, id: e.id });
}
// fire dragon (live capture 20261018_140008, paris2, the owner died to it): meteors = warning 27 on a player's spot, 3.6 s
// later a fire puddle (561 / 563 / 565 / 567, variant 3) on that spot for ~4 s, markers every ~8 s at 480..940 from the
// boss; line = 561, 563, 567, 565 every 141 along its facing from 526 out; he died 351 away inside overlapping puddles
// taking 2..11 per tick (89 hp in under 2 s). Damage split per puddle (land 8, tick 3 / 470 ms, radius 110): guess
// Grove Colossus (invented, owner request): root burst = warning marker 27 then a thorn burst (Trent's 196..198) on each
// player's spot 2.4 s later; bramble line = Trent thorns 212 every 141 along its facing; numbers: invented
const WB_FD = { 4: { meteor: { warn: 0, kinds: [3], v: 3, delay: 600, life: 2000, every: 3200, range: 1200, around: [628, 825], r: 150, land: 55, tick: 0, tick_ms: 99999 } },   // mushroom boss: recorded bombs
  // Gold Meteor (owner's fight ws_20261019_140012, saopaulo5): no warning marker; the meteor itself (kind 11, f8 3, linked to the
  // golem) falls for 7.07 s, it lands 3.39 s in and leaves a golem-gold0 rock there (84 of 84 rocks); one every ~0.75 s,
  // 450..894 from the golem; damage wiki 65, hit radius GUESSED
  101: { meteor: { fall: true, kinds: [11], v: 3, delay: 3390, life: 7070, every: 750, range: 1000, around: [450, 894], r: 130, land: 65, tick: 0, tick_ms: 99999, gold: "golem-gold0" },
    summon: { every: 10000, max: 3, stages: [1, 2, 2], r: 300 } },   // recorded: Gold Golem helpers stage 1 then 2, 2 ~10 s apart
  20: { meteor: { warn: 27, kinds: [196, 197, 198], v: 1, delay: 2400, life: 3000, every: 7000, range: 900, r: 120, land: 18, tick: 4, tick_ms: 500 },
  line: { kinds: [212, 212, 212, 212, 212], v: 2, start: 260, step: 141, every: 9000, r: 100, dmg: 20, life: 2500 } },
  141: { meteor: { warn: 27, kinds: [561, 563, 565, 567], v: 3, delay: 3600, life: 4000, every: 8000, range: 1000, r: 110, land: 8, tick: 3, tick_ms: 470 },
  line: { kinds: [561, 563, 567, 565], v: 3, start: 526, step: 141, every: 12000, r: 90, dmg: 8, life: 2700 },
  // wiki Fire Laser: the boss goes invincible and a flaming laser follows the nearest target for a few seconds, 25 to players and
  // burning 3-4 a tick, leaving lava craters (4 a tick) behind it. Art kind 124, cadence, life 4 s, speed 430, radius 90, crater
  // spacing and burn ticks: GUESSED (no capture next to a fire dragon has it)
  laser: { k: 124, v: 0, every: 15000, life: 4000, speed: 430, r: 90, dmg: 25, burn: 3, burn_n: 3, burn_ms: 500, hit_ms: 800, crater_ms: 600,
    crater: { kinds: [561, 563, 565, 567], v: 3, life: 3000, r: 80, land: 0, tick: 4, tick_ms: 470 } } } };
function fireLaser(world, e, FL, now) {
  const pr = spawnProj(world, { k: FL.k, x: e.x, y: e.y, a: e.a, speed: 0, life: FL.life, dmg: 0, src: e, hostile: "none", f8: FL.v });
  e.laserUntil = now + FL.life; e.s7 = 33; e.flagUntil = now + FL.life; world.touch(e, { "7": 33 });
  const hitAt = new Map(); let craterAt = 0, t = 0;
  world.L({ k: "fire_laser", room: world.name, boss: e.id });
  const step = () => {
    t += 100;
    if (!world.ents.has(pr.id) || !world.ents.has(e.id) || e.dying || t > FL.life) return;
    let best = null, bd = 1e18;
    for (const p of bossPlayers(world, e)) { const pe = p.ent; if (!pe || !p.alive) continue; const d2 = (pe.x - pr.x) ** 2 + (pe.y - pr.y) ** 2; if (d2 < bd) { bd = d2; best = pe; } }
    if (best) { const q = Math.sqrt(bd), m = Math.min(q, FL.speed * 0.1); if (q > 1) { pr.x += (best.x - pr.x) / q * m; pr.y += (best.y - pr.y) / q * m; pr.a = Math.atan2(best.y - pr.y, best.x - pr.x); } world.touch(pr, { "3": Math.round(pr.x), "4": Math.round(pr.y) }); }
    const n = now0(world);
    for (const p of bossPlayers(world, e)) {
      if (!p.alive || !p.ent || Math.hypot(p.ent.x - pr.x, p.ent.y - pr.y) > FL.r || n < (hitAt.get(p) || 0)) continue;
      hitAt.set(p, n + FL.hit_ms); hit(world, p.ent, FL.dmg, e);
      for (let b = 1; b <= FL.burn_n; b++) world.after(b * FL.burn_ms, () => { if (p.alive && p.ent) hit(world, p.ent, FL.burn, e); });
    }
    if (t >= craterAt) { craterAt = t + FL.crater_ms; const M = FL.crater; puddle(world, e, M.kinds[Math.floor(Math.random() * M.kinds.length)], M.v, Math.round(pr.x), Math.round(pr.y), M); }
    world.after(100, step);
  };
  world.after(100, step);
}
function puddle(world, e, k, v, x, y, M) {
  fx(world, k, x, y, M.life, e, v);
  const hitAt = (dmg) => { for (const p of bossPlayers(world, e)) if (p.alive && p.ent && Math.hypot(p.ent.x - x, p.ent.y - y) < M.r) hit(world, p.ent, dmg, e); };
  hitAt(M.land);
  for (let t = M.tick_ms; t < M.life; t += M.tick_ms) world.after(t, () => { if (world.ents.has(e.id)) hitAt(M.tick); });
}
// Gold Meteor: the landed meteor stays as a gold rock (gold when hit) until broken (wiki)
function goldDrop(world, x, y, name) {
  const nm = typeof name === "string" ? name : "gold0", idx = world.ctx.NAMES.indexOf(nm); if (idx < 0 || typeof world.objFromRec !== "function") return;
  for (const o of world.solidsNear(x, y, [])) if ((o.kind === "static" || o.kind === "placed") && o.cd && Math.hypot(o.x - x, o.y - y) < o.cd + 40) return;   // not inside a rock / building
  const m = world.objFromRec({ "0": 0, "1": 79, "2": 3, "3": x, "4": y, "5": 628, "6": 1, "13": idx, name: nm }, world.phase, "spawn"); if (m) m.rec = null;
}
function fireDragon(world, e, now) {
  const F = WB_FD[e.sp]; if (!F || typeof world.after !== "function") return false;
  const M = F.meteor, L = F.line;
  if (!e.fdAt) e.fdAt = { meteor: now + 1500, line: now + 6000 };
  if (now >= e.fdAt.meteor) {
    e.fdAt.meteor = now + M.every * (0.85 + Math.random() * 0.3);
    const near = [...bossPlayers(world, e)].filter((p) => p.alive && p.ent && Math.hypot(p.ent.x - e.x, p.ent.y - e.y) <= M.range);
    for (const p of M.around ? near.slice(0, 1) : near) {   // around: one strike on a random spot in the ring while someone is near
      const ra = Math.random() * TAU, rd = M.around ? M.around[0] + Math.random() * (M.around[1] - M.around[0]) : 0;
      const x = Math.round(M.around ? e.x + Math.cos(ra) * rd : p.ent.x), y = Math.round(M.around ? e.y + Math.sin(ra) * rd : p.ent.y);
      if (M.fall) {   // the meteor art is the whole strike: it lands at M.delay, then fades out
        fx(world, M.kinds[0], x, y, M.life, e, M.v);
        world.after(M.delay, () => { if (!world.ents.has(e.id)) return; for (const p of bossPlayers(world, e)) if (p.alive && p.ent && Math.hypot(p.ent.x - x, p.ent.y - y) < M.r) hit(world, p.ent, M.land, e); if (M.gold) goldDrop(world, x, y, M.gold); });
        continue;
      }
      if (M.warn) fx(world, M.warn, x, y, M.delay + 400, e, M.v);
      world.after(M.delay, () => { if (world.ents.has(e.id)) { puddle(world, e, M.kinds[Math.floor(Math.random() * M.kinds.length)], M.v, x, y, M); if (M.gold) goldDrop(world, x, y); } });
    }
    e.s7 = 33; e.flagUntil = now + 1500; world.touch(e, { "7": 33 });
  }
  const SM = F.summon;
  if (SM && e.tgt && now >= (e.fdAt.summon || (e.fdAt.summon = now + SM.every))) {   // Gold Golem helpers
    e.fdAt.summon = now + SM.every; e.summoned = (e.summoned || []).filter((m) => world.ents.has(m.id) && !m.dying);
    if (e.summoned.length < SM.max) {
      const k = (e.nSummon = (e.nSummon || 0) + 1) - 1, a = Math.random() * TAU;
      const m = spawnWild(world, { "21": e.sp, "22": 0, "23": SM.stages[k % SM.stages.length], "7": 2 }, Math.round(e.x + Math.cos(a) * SM.r), Math.round(e.y + Math.sin(a) * SM.r), S(world).phase, true);
      if (m) { m.tpl = null; e.summoned.push(m); }
    }
  }
  const FL = F.laser;
  if (FL && e.tgt && now >= (e.fdAt.laser || (e.fdAt.laser = now + 8000))) {
    e.fdAt.laser = now + FL.every * (0.85 + Math.random() * 0.3);
    fireLaser(world, e, FL, now);
  }
  if (L && now >= e.fdAt.line && e.tgt) {
    e.fdAt.line = now + L.every * (0.85 + Math.random() * 0.3);
    L.kinds.forEach((k, b) => {
      const d = L.start + b * L.step, x = Math.round(e.x + Math.cos(e.a) * d), y = Math.round(e.y + Math.sin(e.a) * d);
      world.after(b * 150, () => { if (!world.ents.has(e.id)) return; fx(world, k, x, y, L.life, e, L.v);
        for (const p of bossPlayers(world, e)) if (p.alive && p.ent && Math.hypot(p.ent.x - x, p.ent.y - y) < L.r) hit(world, p.ent, L.dmg, e); });
    });
    e.s7 = 33; e.flagUntil = now + 1500; world.touch(e, { "7": 33 });
  }
  return true;
}
function bossAttacks(world, e, now) {
  bossSpecial(world, e, now);
  if (fireDragon(world, e, now) && e.sp !== 101) return true;   // the Gold Golem also slams (WB_ATK)
  const A = WB_ATK[e.sp]; if (!A) return false;
  e.atkAt = e.atkAt || A.map((a, i) => now + 800 + i * 400);
  const R = (e.r || 100) + 120;
  for (let i = 0; i < A.length; i++) {
    if (now < e.atkAt[i]) continue;
    const [k, v, every, burst, dmg] = A[i];
    e.atkAt[i] = now + every * (0.8 + Math.random() * 0.4);
    if (burst < 0) {   // line: kinds k, k+1, ... one per 0.45 s, 120 apart along the boss facing; hits whoever stands on the line
      for (let b = 0; b < -burst; b++) world.after(b * 450, () => { if (!world.ents.has(e.id)) return; const lx = e.x + Math.cos(e.a) * (e.r + 60 + b * 120), ly = e.y + Math.sin(e.a) * (e.r + 60 + b * 120); fx(world, k + b, lx, ly, 900, e, v);
        for (const p of bossPlayers(world, e)) if (p.alive && p.ent && Math.hypot(p.ent.x - lx, p.ent.y - ly) < 110) hit(world, p.ent, dmg, e); });
      e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
      continue;
    }
    for (let b = 0; b < burst; b++) { const a = (b / burst) * TAU; fx(world, k, e.x + Math.cos(a) * (burst > 1 ? R * 0.6 : 0), e.y + Math.sin(a) * (burst > 1 ? R * 0.6 : 0), 900, e, v); }
    for (const p of bossPlayers(world, e)) if (p.alive && p.ent && dist(e, p.ent) <= R) hit(world, p.ent, dmg, e);
    for (const pt of (e.vs ? [] : S(world).pets)) if (!pt.dead && dist(e, pt) <= R) hit(world, pt, dmg, e);
    e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
  }
  return true;
}
// fairy waves (wiki, on unless TIO_FAIRY_WAVES=0): tree-type bosses call 3 minions when their hp first drops under 75 % (3
// adults), 50 % (1 boss-stage + 2 adults) and 25 % (3 boss-stage); minion lists per boss from the wiki (cactus boss: Dragon,
// Rock, Insect Fairy; mushroom boss: Living Mushroom, Black / White Spider; haunted tree = dark-tree boss: Spectrum,
// Electric, Poison Fairy); type field 22 per minion from the recordings; spot around the boss and no respawn: guess
const FAIRY_WAVES = process.env.TIO_FAIRY_WAVES !== "0";
// owner: Trent fire / water / plant fairies, Haunted Trent poison / spectrum / electric, Snow Trent ice / normal / combat,
// Cactus dragon / rock / insect, Mushroom Boss baby mushrooms and white / black spiders
const WB_MINIONS = { 20: [[18, 20], [17, 21], [19, 9]], 73: [[18, 20], [17, 21], [19, 9]], 15: [[46, 73], [45, 29], [55, 11]], 4: [[32, 46], [31, 44], [30, 59]],
  68: [[51, 44], [52, 5], [50, 43]], 10: [[37, 45], [38, 0], [36, 0]] };
const WB_MINION_RANDOM = { 68: 1, 109: 1 };   // 109 Giant Gaze: any of the 7 Gazes (wiki)   // wiki Haunted Tree: each minion's type is random among the three
const WAVES = [[0.75, [1, 1, 1]], [0.5, [2, 1, 1]], [0.25, [2, 2, 2]]];
// boss chests (wiki: 3 chests of 14k gold on the kill): gift ids from fresh triples in the scans near each boss
// (dragon forest 9/10/11, ice golem 12/13/14, dark-tree 55/56/57, desert 58/59/60, volcanic golem 89/91, spectrum
// scan 43/45: mushroom boss, guess); laid out as recorded: x -400 / 0 / +400, the middle one 650 lower; no respawn
const WB_CHESTS = { 76: [12, 13, 14], 35: [55, 56, 57], 62: [58, 59, 60], 85: [89, 90, 91], 141: [89, 90, 91],   // no recorded chests: the biome's set (guess)
  20: [9, 10, 11], 21: [12, 13, 14], 68: [55, 56, 57], 15: [58, 59, 60], 121: [89, 90, 91], 4: [43, 44, 45] };
// wiki Bosses: a killed boss leaves 3 Legendary tameable baby animals (asleep, so the Appletor / a tame works at once);
// the Gold Golem Boss is the only one without babies. Babies: the boss's 3 minion kinds where the clone has them
// (WB_MINIONS), else 3 babies of the boss's own species.
// owner: Ice Golem babies are Ice Golems or Icebergs; dragons, the Ice Dragon, the Fire Dragon and the Octopus leave 3 of their own
// Giant Gaze: a random Gaze of the 7 kinds
const BOSS_BABIES = { 21: [[21, 45], [22, 45]], 20: [[20, 73]], 109: [104, 105, 106, 107, 108, 109, 110] };
function bossBabies(world, e) {
  if (e.sp === 101) return;
  if (e.sp === 4) {   // owner: the Mushroom Boss leaves 3 baby mushrooms and random white / black spiders
    [[-260, 120], [0, 260], [260, 120]].forEach(([dx, dy]) => { const b = spawnWild(world, { "21": 32, "22": 46, "23": 0, "7": 66 }, e.x + dx, e.y + dy, world.phase, true); if (b) b.tpl = null; });
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const sp = Math.random() < 0.5 ? 30 : 31, a = Math.random() * TAU, b = spawnWild(world, { "21": sp, "22": petType(sp), "23": 1, "7": 2 }, e.x + Math.cos(a) * 380, e.y + Math.sin(a) * 380, world.phase, true); if (b) b.tpl = null; }
    world.L({ k: "boss_babies", room: world.name, sp: e.sp, babies: 3, spiders: n });
    return;
  }
  const M = BOSS_BABIES[e.sp] || WB_MINIONS[e.sp], at = [[-260, 120], [0, 260], [260, 120]];
  at.forEach(([dx, dy], i) => {
    let q = M ? (BOSS_BABIES[e.sp] ? M[Math.floor(Math.random() * M.length)] : M[i % M.length]) : [e.sp, petType(e.sp)];
    if (typeof q === "number") q = [q, petType(q)];
    const b = spawnWild(world, { "21": q[0], "22": q[1], "23": 0, "7": 66 }, e.x + dx, e.y + dy, world.phase, true);
    if (b) b.tpl = null;
  });
  world.L({ k: "boss_babies", room: world.name, sp: e.sp, babies: at.length });
}
function bossChests(world, e) {
  const G = WB_CHESTS[e.sp]; if (!G || !e.worldBoss || typeof world.objFromRec !== "function") return;
  const N = world.ctx && world.ctx.NAMES; if (!N) return;
  const at = [[-400, -325], [0, 325], [400, -325]];
  G.forEach((g, i) => {
    const name = "gift" + g, idx = N.indexOf(name); if (idx < 0) return;
    const o = world.objFromRec({ "0": 0, "1": 79, "2": 3, "3": Math.round(e.x + at[i][0]), "4": Math.round(e.y + at[i][1]), "5": 628, "6": 1, "13": idx, name }, world.phase, "spawn");
    if (o) { o.rec = null; o.bossChest = true; }
  });
  world.L({ k: "boss_chests", sp: e.sp, gifts: G });
}
function fairyWave(world, e) {
  const M = WB_MINIONS[e.sp]; if (!FAIRY_WAVES || !M || !e.worldBoss) return;
  e.waves = e.waves || 0;
  while (e.waves < WAVES.length && e.hp > 0 && e.hp <= e.max * WAVES[e.waves][0]) {
    const st = WAVES[e.waves][1], a0 = Math.random() * TAU, R = (e.r || 100) + 150;
    for (let i = 0; i < 3; i++) {
      const [sp, ty] = WB_MINION_RANDOM[e.sp] ? M[Math.floor(Math.random() * M.length)] : M[i], a = a0 + i * TAU / 3;
      // wiki Giant Gaze: every minion is a boss-stage tamon
      const m = spawnWild(world, { "21": sp, "22": ty, "23": e.sp === 109 ? 2 : st[i], "7": 2, "25": 10 }, Math.round(e.x + Math.cos(a) * R), Math.round(e.y + Math.sin(a) * R), e.phase, true);
      m.minion = true; m.tpl = null; if (e.tgt) { m.tgt = e.tgt; m.st = "chase"; }
    }
    world.L({ k: "fairy_wave", sp: e.sp, id: e.id, wave: e.waves + 1 });
    e.waves++;
  }
}
function wbBody(sp, stage) { return Object.keys(WB.species).some((k) => WB.species[k] === sp && (WB.stageBy[k] != null ? WB.stageBy[k] : WB.stage) === stage); }
function stepWorldBoss(world, e, now, d) {
  if (e.x !== e.hx || e.y !== e.hy) { e.x = e.hx; e.y = e.hy; world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) }); }   // pushed by players: back to the spot
  const AG = (WB.aggroBy && WB.aggroBy[e.sp]) || WB.aggro;
  if (e.tgt && (!validTgt(world, e.tgt, now) || Math.hypot(e.tgt.x - e.x, e.tgt.y - e.y) > AG)) e.tgt = null;
  if (!e.tgt) {
    let best = null, bd = AG;
    for (const p of world.players.values()) { const pe = p.ent; if (!pe || !p.alive || p.shieldUntil > now) continue; const q = dist(e, pe); if (q < bd) { bd = q; best = pe; } }
    for (const pt of S(world).pets) { if (pt.dead || pt.veilUntil > now) continue; const q = dist(e, pt); if (q < bd) { bd = q; best = pt; } }
    e.tgt = best;
  }
  if (!e.tgt) return;
  const t = e.tgt, q = dist(e, t), a0 = ang255(e.a);
  e.a = Math.atan2(t.y - e.y, t.x - e.x);
  if (!bossAttacks(world, e, now)) {
    if (q <= Math.max(d.reach, e.cd || 0) + 12 && now - e.lastAtk >= d.every) attack(world, e, d, t, now);
    else skill(world, e, d, t, now);
  }
  if (ang255(e.a) !== a0) world.touch(e, { "5": ang255(e.a) });
}
// ------------------------------------------------------------ /restart: the server-restart Reaper (wiki "Reaper (Server Restart)")
// wiki: a Reaper per player, 2000 hp, 60 per scythe swing, spear reach, faster than any tamer, no aggro range (always chases the
// nearest player, retargets on a death), one swing breaks most buildings, more aggressive as the countdown runs, 5000 gold to its
// killer; the restart messages above the inventory; players killed by a Reaper get 100k gold, 1000 food / wood / stone and age
// 12 after the restart. Countdown 60 s (real: 5 min, shortened: guess), swing cadence, reach 170 and speed ramp: guess.
// Body: client species 65 Reaper at stage 3.
const RP = { sp: 65, stage: 3, hp: 2000, dmg: 60, reach: 170, speed: 560, ramp: 0.5, every: 900, bldg: 9999, gold: 5000, count_ms: 60000, d0: 1100 };
function rpAnnounce(world, msg) {
  const P = world.P;
  for (const q of world.players.values()) if (q.joined) { q.queue({ "1": world.T.ANNOUNCE, m: msg, o: 4000, i: P.announce_color }); q.queue({ "1": 39, i: 0, m: msg, mt: 1 }); }
  world.logChat({ name: "", text: msg, team: null, to: null, k: "warn" });
}
function rpSpawn(world, q) {
  const st = S(world), a = Math.random() * TAU;
  const e = spawnWild(world, { "21": RP.sp, "22": petType(RP.sp), "23": RP.stage, "7": 2, "25": 10 }, Math.round(q.ent.x + Math.cos(a) * RP.d0), Math.round(q.ent.y + Math.sin(a) * RP.d0), st.phase, true);
  e.tpl = null; e.reaper = true; e.boss = false; e.hp = e.max = RP.hp; e.s7 = e.wake7 = 2; e.f["7"] = 2; e.name = "Reaper";
  st.restart.reapers.add(e);
  return e;
}
function restartStart(world, p) {
  const st = S(world);
  if (st.restart) { if (p.say) p.say("A restart is already counting down (/restart stop cancels it)"); return; }
  if (st.vs) vsEnd(world, true);
  st.restart = { t0: now0(world), at: now0(world) + RP.count_ms, reapers: new Set(), said: new Set() };
  rpAnnounce(world, "The server will restart in " + Math.round(RP.count_ms / 1000) + " seconds!");
  world.after(2500, () => { if (st.restart) rpAnnounce(world, "After the reset you will get 100k gold!"); });
  for (const q of world.players.values()) if (q.joined && q.alive && q.ent) rpSpawn(world, q);
  world.L({ k: "restart_start", room: world.name, by: p.n, reapers: st.restart.reapers.size });
}
function restartStop(world, run) {
  const st = S(world), R = st.restart; if (!R) return;
  st.restart = null;
  for (const e of R.reapers) { st.wild.delete(e); st.dying.delete(e); world.removeEnt(e.id); }
  if (!run) { rpAnnounce(world, "Restart cancelled"); world.L({ k: "restart_stop", room: world.name }); return; }
  rpAnnounce(world, "The server is restarting");
  for (const q of world.players.values()) if (q.reaperKilled) { q.reaperKilled = false; q.restartGift = true; }
  const q = [...world.players.values()].find((x) => x.joined && typeof x.cmd === "function");
  world.lastReset = 0;
  if (q) q.cmd("/reset");
  world.L({ k: "restart_done", room: world.name, gifts: [...world.players.values()].filter((x) => x.restartGift).length });
}
function restartTick(world, now) {
  const R = S(world).restart, left = R.at - now;
  for (const s of [30, 10, 5]) if (left <= s * 1000 && !R.said.has(s)) { R.said.add(s); rpAnnounce(world, "The server will restart in " + s + " seconds!"); }
  if (left <= 0) { restartStop(world, true); return; }
  for (const q of world.players.values()) if (q.joined && q.alive && q.ent && ![...R.reapers].some((e) => !e.dying)) rpSpawn(world, q);   // a Reaper per player: a new one if all fell
}
function stepReaper(world, e, now, dt) {
  const R = S(world).restart; if (!R) return;
  const x0 = Math.round(e.x), y0 = Math.round(e.y), a0 = ang255(e.a);
  let best = null, bd = 1e18;
  for (const q of world.players.values()) { const pe = q.ent; if (!pe || !q.alive) continue; const d2 = (pe.x - e.x) ** 2 + (pe.y - e.y) ** 2; if (d2 < bd) { bd = d2; best = pe; } }
  e.tgt = best;
  if (best) {
    const q = Math.sqrt(bd), k = 1 + RP.ramp * Math.min(1, (now - R.t0) / RP.count_ms);
    e.a = Math.atan2(best.y - e.y, best.x - e.x);
    if (q > RP.reach - 20) moveToward(world, e, best.x, best.y, RP.speed * k, dt, RP.reach - 20);
    if (q <= RP.reach && now - e.lastAtk >= RP.every / k) {
      e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
      hit(world, best, RP.dmg, e);
      const sx = e.x + Math.cos(e.a) * RP.reach * 0.6, sy = e.y + Math.sin(e.a) * RP.reach * 0.6;
      for (const o of world.solidsNear(sx, sy, [])) if (o.kind === "placed" && !o.dying && Math.hypot(o.x - sx, o.y - sy) < RP.reach) world.damage(o, RP.bldg, e);
    }
  }
  const f = {}, x1 = Math.round(e.x), y1 = Math.round(e.y), a1 = ang255(e.a);
  if (x1 !== x0 || y1 !== y0) { f["3"] = x1; f["4"] = y1; }
  if (a1 !== a0) f["5"] = a1;
  if (Object.keys(f).length) world.touch(e, f);
}

// ------------------------------------------------------------ /versus
// owner: the map is cleared (statics and wild creatures kept aside), 100 random pets (random species, level and shot) fight
// a random army (10 world bosses, 20 giant bosses or 100 more pets) next to the typer; players are gods while it runs;
// rounds repeat until /versus stop or /reset, which put the world back. Both sides are wild creatures with e.vs = 1 / 2;
// total hp and damage per side are balanced so a round lasts about a minute and either side can win.
const VS_ARMIES = { pets: 1, bosses: 1, mobs: 1, epic: 1, player: 1 };
// owner: the armies come from the live registries, so every pet (the invented ones and the event legendaries too) and every
// world boss / BMB added later joins on its own. Bosses: the world-boss table, the per-season bosses (statues, Siren, genie,
// Gaze, Gold Golem, Reaper) and every species with boss minions, chests or kill babies.
function vsBossPool() {
  const out = new Set(Object.values(WB.species));
  for (const L of Object.values(STATUES)) for (const q of L) out.add(q.sp);
  for (const q of Object.values(SANCTUARY)) out.add(q.siren);
  [GENIE.sp, 109, 101, 65, 123].forEach((k) => out.add(k));
  for (const T of [WB_CHESTS, WB_MINIONS, BOSS_BABIES]) for (const k of Object.keys(T)) out.add(+k);
  return [...out].filter((k) => SPECIES[k] && !INSECT_TYPE[bsp(k)]);
}
const VS_NAME = { 1: "RED", 2: "BLUE" };
function vsSay(world, msg, hl) {   // hl: names the chat panel highlights
  for (const q of world.players.values()) if (q.joined) q.queue({ "1": 39, i: 0, m: msg, mt: 1 });
  world.logChat({ name: "", text: msg, team: null, to: null, k: "vs", hl: hl || null });
}
function vsPick(a) { return a[(Math.random() * a.length) | 0]; }
function vsPool() {
  const wb = new Set(Object.values(WB.species));
  return Object.keys(SPECIES).map(Number).filter((k) => !wb.has(k) && !INSECT_TYPE[bsp(k)]);
}
function vsUnit(world, V, side, sp, stage, ck, x, y, label, lvl) {
  const e = spawnWild(world, Object.assign({ "21": sp, "22": ck, "23": stage, "7": 2, "25": 10, "16": side, "19": label }, lvl ? { "20": lvl } : {}), x, y, S(world).phase, true);
  e.tpl = null; e.vs = side; e.s7 = e.wake7 = 2; e.f["7"] = 2; e.boss = false;
  e.vsBoss = stage === 3 && V.bossPool && V.bossPool.includes(sp);
  // owner: every unit uses its own species skill on its real reload, aimed at its target (a species without one: a random shot)
  const own = kdef(world, sp, stage).skill, sk = own && own.k.length ? own : kdef(world, vsPick(V.shotPool), 1).skill;
  e.vsShot = sk && sk.k.length ? { k: sk.k, speed: sk.speed || 0, life: Math.min(sk.life || 2000, 3000), every: own ? Math.max(1500, Math.min(sk.every || 8000, 20000)) : 2500 + Math.random() * 3500 } : null;
  e.vsNext = now0(world) + Math.random() * 2000;
  V.side[side].add(e); V.all.add(e);
  return e;
}
function vsArmy(world, V, side, kind, cx, cy) {
  const P = world.P, out = [];
  const place = (i, n, rad) => {
    const cols = Math.ceil(Math.sqrt(n)), sp = rad * 2 + 30, r = (i / cols) | 0, c = i % cols;
    const x = cx + (side === 1 ? -1 : 1) * (385 + c * sp),   // owner: 28 % more gap between RED and BLUE (was 300)
      y = cy + (r - (Math.ceil(n / cols) - 1) / 2) * sp;
    return [Math.max(P.map_min + 100, Math.min(P.map_max - 100, x)), Math.max(P.map_min + 100, Math.min(P.map_max - 100, y))];
  };
  const tag = VS_NAME[side];
  const bossType = (sp) => { const mk = Object.keys(WB.species).find((m) => WB.species[m] === sp); return mk != null && WB.typeBy[mk] != null ? WB.typeBy[mk] : petType(sp); };
  if (kind === "bosses") {
    for (let i = 0; i < 10; i++) { const sp = vsPick(V.bossPool); const [x, y] = place(i, 10, 230); out.push(vsUnit(world, V, side, sp, 3, bossType(sp), x, y, tag)); }
  } else if (kind === "epic") {   // owner: a boss-heavy mix, 8 world bosses and 12 BMBs
    for (let i = 0; i < 20; i++) { const boss = i < 8, sp = boss ? vsPick(V.bossPool) : vsPick(V.pool); const [x, y] = place(i, 20, 200); out.push(vsUnit(world, V, side, sp, 3, boss ? bossType(sp) : petType(sp), x, y, tag)); }
  } else if (kind === "mobs") {
    for (let i = 0; i < 20; i++) { const sp = vsPick(V.pool); const [x, y] = place(i, 20, 140); out.push(vsUnit(world, V, side, sp, 3, petType(sp), x, y, tag)); }
  } else {
    for (let i = 0; i < 100; i++) { const sp = vsPick(V.pool); const [x, y] = place(i, 100, 55); out.push(vsUnit(world, V, side, sp, (Math.random() * 3) | 0, petType(sp), x, y, tag, V.force === "epic" ? 1 + ((Math.random() * 67) | 0) : 0)); }
  }
  return out;
}
// /versus player (owner): 100+ hostiles from the same pools around the typer, all hunting him (no god mode, his pets fight
// back); chat shows the survival time and kills; a cleared wave brings a bigger one; his death ends it and puts the world back
function vsPlayerWave(world, V) {
  const p = V.player, out = [], n = 100 + V.round * 20, now = now0(world);
  for (let i = 0; i < n; i++) {
    const r = Math.random(), boss = r < 0.08, bmb = !boss && r < 0.25, sp = boss ? vsPick(V.bossPool) : vsPick(V.pool);
    const a = Math.random() * TAU, d = 900 + Math.random() * 900;
    const x = Math.max(world.P.map_min + 100, Math.min(world.P.map_max - 100, p.ent.x + Math.cos(a) * d)), y = Math.max(world.P.map_min + 100, Math.min(world.P.map_max - 100, p.ent.y + Math.sin(a) * d));
    const e = vsUnit(world, V, 2, sp, boss || bmb ? 3 : (Math.random() * 3) | 0, petType(sp), x, y, "HUNTER");
    e.vsMul = boss ? 0.25 : bmb ? 0.15 : 0.08; e.vsNext = now + 5000 + Math.random() * 8000; e.vsGrace = now + 4000; out.push(e);   // a few seconds to get ready
  }
  V.round++; V.done = false; V.feedAt = now + 3000;
  vsSay(world, "VERSUS PLAYER wave " + V.round + ": " + n + " hunters are coming for " + (p.n != null ? "you" : "the player") + "! Survive. (/versus stop ends it)");
  world.L({ k: "versus_player_wave", room: world.name, wave: V.round, n });
  return out;
}
function vsRound(world) {
  const st = S(world), V = st.vs, now = now0(world);
  for (const e of [...V.all]) vsDrop(world, e);
  V.round++; V.side = { 1: new Set(), 2: new Set() }; V.kills = { 1: 0, 2: 0 }; V.dmg = { 1: 0, 2: 0 }; V.sdmg = { 1: 0, 2: 0 }; V.hits = { 1: 0, 2: 0 };
  const kind = V.force || vsPick(["bosses", "mobs", "pets"]);
  const A = vsArmy(world, V, 1, "pets", V.cx, V.cy), B = vsArmy(world, V, 2, kind, V.cx, V.cy);
  // balance: same total hp per side, damage scaled so each side's dps empties the other in ~45 s
  const hp = (L) => L.reduce((a, e) => a + e.max, 0), H = Math.max(hp(A), 1);
  const kB = H / Math.max(hp(B), 1);
  for (const e of B) { e.max = e.hp = Math.round(e.max * kB); }
  for (const L of [A, B]) {
    const dps = L.reduce((a, e) => { const d = kdef(world, e.sp, e.stage); return a + Math.max(1, d.dmg) / Math.max(300, d.every) * 1000; }, 0);
    const mul = H / 45 / Math.max(dps, 0.1) * (0.8 + Math.random() * 0.4);   // a little luck per side
    const crowd = L === A ? Math.pow(A.length / B.length, 0.2) : 1;   // 100 pets cannot all reach 10 bosses at once
    for (const e of L) e.vsMul = mul * crowd;
  }
  V.kind = kind; V.t0 = now; V.done = false; V.feedAt = now + 4000;
  const lbl = { bosses: "10 WORLD BOSSES", mobs: "20 BIG BOSSES", pets: "100 RANDOM PETS", epic: "8 WORLD BOSSES + 12 BMBs" }[kind];
  vsSay(world, "VERSUS round " + V.round + ": RED 100 random pets vs BLUE " + lbl + ". Fight!");
  world.L({ k: "versus_round", room: world.name, round: V.round, kind, red: A.length, blue: B.length });
}
function vsStart(world, p, force) {
  const st = S(world);
  if (st.vs && (force === "player" || st.vs.player)) vsEnd(world, true);
  else if (st.vs) { st.vs.force = force; st.vs.nextAt = now0(world); vsSay(world, "VERSUS: new round"); return; }
  const V = st.vs = { round: 0, wins: { 1: 0, 2: 0 }, force, cx: p.ent.x, cy: p.ent.y, all: new Set(), side: { 1: new Set(), 2: new Set() },
    stash: [], respawn: st.respawn, boss: world.boss, god: new Map(), pool: vsPool(), bossPool: vsBossPool(), shotPool: Object.keys(SPECIES).map(Number).filter((k) => SPECIES[k][1] != null) };
  if (force === "player") {   // the map stays; only the typer is hunted, with no god mode
    V.player = p; V.respawn = []; V.kills = { 1: 0, 2: 0 }; V.dmg = { 1: 0, 2: 0 }; V.sdmg = { 1: 0, 2: 0 }; V.hits = { 1: 0, 2: 0 }; V.t0 = now0(world); V.pk = 0;
    if (p.god) { V.god.set(p, true); p.god = false; }
    vsPlayerWave(world, V);
    return;
  }
  st.respawn = [];
  for (const e of [...world.ents.values()]) {
    if (e.kind === "static" || e.kind === "animal" || (e.kind === "projectile" && e.plug === "creatures")) {
      if (e.kind === "animal") { if (st.dying.has(e)) { st.dying.delete(e); world.removeEnt(e.id); continue; } st.wild.delete(e); }
      if (e.kind === "projectile") { st.proj.delete(e); world.removeEnt(e.id); continue; }
      world.removeEnt(e.id); V.stash.push(e);
    }
  }
  world.boss = null;
  for (const q of world.players.values()) if (q.joined) { V.god.set(q, !!q.god); q.god = true; }
  vsSay(world, "VERSUS: map cleared, you are in god mode. /versus stop (or /reset) puts the world back.");
  vsRound(world);
}
function vsDrop(world, e) {
  const st = S(world); st.wild.delete(e); st.dying.delete(e); world.removeEnt(e.id);
  const V = st.vs; if (V) { V.all.delete(e); V.side[1].delete(e); V.side[2].delete(e); }
}
function vsEnd(world, restore) {
  const st = S(world), V = st.vs; if (!V) return;
  for (const e of [...V.all]) vsDrop(world, e);
  for (const e of [...st.proj]) if (e.hostile === "vs") { st.proj.delete(e); world.removeEnt(e.id); }
  st.vs = null;
  if (restore) {
    for (const e of V.stash) { world.addEnt(e); if (e.kind === "animal") { e.tgt = null; st.wild.add(e); } }
    st.respawn = V.respawn.concat(st.respawn); world.boss = V.boss;
  }
  for (const [q, g] of V.god) q.god = g;
  vsSay(world, "VERSUS over after " + V.round + " round(s): RED " + V.wins[1] + " wins, BLUE " + V.wins[2] + " wins." + (restore ? " The world is back." : ""));
  world.L({ k: "versus_end", room: world.name, rounds: V.round, wins: V.wins, restore });
}
function vsKilled(world, e) {
  const V = S(world).vs; if (!V || !V.all.has(e)) return;
  V.side[e.vs].delete(e); V.all.delete(e); S(world).dying.add(e);
  if (V.player) { V.pk++; return; }
  const k = e.vsBy && e.vsBy.vs ? e.vsBy : null; if (k) V.kills[k.vs]++;
  if (V.kind !== "pets" && e.vs === 2) vsSay(world, (k ? VS_NAME[k.vs] + " " + spName(k.sp) : "RED") + " took down BLUE " + spName(e.sp) + "! (" + V.side[2].size + " left)", [k ? spName(k.sp) : "", spName(e.sp)]);
}
function vsTick(world, now) {
  const V = S(world).vs;
  if (V.player) {
    const p = V.player, s = Math.round((now - V.t0) / 1000), left = V.side[2].size, clock = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    if (!p.alive || !p.ent || ![...world.players.values()].includes(p)) {
      vsSay(world, "VERSUS PLAYER over: survived " + clock + ", " + V.pk + " kills, wave " + V.round + ". The world is back.");
      world.L({ k: "versus_player_end", room: world.name, s, kills: V.pk, wave: V.round });
      vsEnd(world, true); return;
    }
    if (!left) { vsPlayerWave(world, V); return; }
    if (now >= V.feedAt) { V.feedAt = now + 5000; vsSay(world, "Survival " + clock + " | kills " + V.pk + " | " + left + " hunters left (wave " + V.round + ")"); }
    return;
  }
  if (V.nextAt) { if (now >= V.nextAt) { V.nextAt = 0; vsRound(world); } return; }
  const a = V.side[1].size, b = V.side[2].size;
  if (!V.done && (!a || !b)) {
    V.done = true; const w = a ? 1 : b ? 2 : 0;
    if (w) V.wins[w]++;
    vsSay(world, (w ? VS_NAME[w] + " WINS round " + V.round + " with " + (a || b) + " left standing" : "Round " + V.round + ": a draw") + " in " + Math.round((now - V.t0) / 1000) + " s! Score RED " + V.wins[1] + " - BLUE " + V.wins[2] + ". Next round in 8 s (/versus stop to end)");
    world.L({ k: "versus_win", room: world.name, round: V.round, winner: w, left: a || b, s: Math.round((now - V.t0) / 1000), dmg: V.dmg, shot_dmg: V.sdmg, hits: V.hits });
    V.nextAt = now + 8000; return;
  }
  if (now >= V.feedAt) { V.feedAt = now + 5000; vsSay(world, "RED " + a + " alive (" + V.kills[1] + " kills) | BLUE " + b + " alive (" + V.kills[2] + " kills)"); }
}
function stepVs(world, e, now, dt, d) {
  const V = S(world).vs; if (!V) return;
  const x0 = Math.round(e.x), y0 = Math.round(e.y), a0 = ang255(e.a);
  if (!e.tgt || e.tgt.dying || !world.ents.has(e.tgt.id) || now >= (e.retgt || 0)) {
    e.retgt = now + 400 + Math.random() * 600;
    let best = null, bd = 1e18;
    const foes = V.player ? [V.player.ent].concat(S(world).byOwner.get(V.player.n) || []).filter((o) => o && !o.dead && world.ents.has(o.id)) : V.side[3 - e.vs];
    for (const o of foes) { const q = (o.x - e.x) ** 2 + (o.y - e.y) ** 2; if (q < bd) { bd = q; best = o; } }
    e.tgt = best;
  }
  const t = e.tgt;
  if (t && e.vsBoss && !(e.vsGrace > now)) bossAttacks(world, e, now);   // world bosses also run their full attack routines
  if (t) {
    const q = dist(e, t), reach = Math.max(d.reach || 110, (e.cr || 40) + (t.cr || 40) + 10);
    e.a = Math.atan2(t.y - e.y, t.x - e.x);
    if (q > reach - 8) moveToward(world, e, t.x, t.y, Math.max(d.chase || 0, 180), dt, reach - 8);
    if (e.vsGrace > now) { /* player mode: hunters close in before they strike */ }
    else if (q <= reach + 12 && now - e.lastAtk >= Math.max(300, d.every || 1500)) {
      e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
      V.dmg[e.vs] += hit(world, t, vsCap(world, V, t, Math.max(1, d.dmg) * e.vsMul), e) || 0; V.hits[e.vs]++;
    } else if (e.vsShot && now >= e.vsNext && q < (V.player ? 600 : 900)) {
      e.vsNext = now + e.vsShot.every; const S0 = e.vsShot, n = S0.k.length;
      S0.k.forEach((k, i) => {
        const a = e.a + (n > 1 ? (i - (n - 1) / 2) * 0.25 : 0), fast = S0.speed > 0;
        spawnProj(world, { k, x: fast ? e.x + Math.cos(a) * 60 : t.x, y: fast ? e.y + Math.sin(a) * 60 : t.y, a, speed: S0.speed, life: S0.life, dmg: Math.max(1, d.dmg) * e.vsMul * 1.5, src: e, hostile: "vs" });
      });
    }
  }
  const f = {}, x1 = Math.round(e.x), y1 = Math.round(e.y), a1 = ang255(e.a);
  if (x1 !== x0 || y1 !== y0) { f["3"] = x1; f["4"] = y1; }
  if (a1 !== a0) f["5"] = a1;
  if (Object.keys(f).length) world.touch(e, f);
}
// player mode: one hunter hit takes at most 8 % of the player's max hp and the whole swarm at most 15 % a second, so it is a
// survival fight the player can answer, not a one-shot
function vsCap(world, V, t, dmg) {
  if (!V.player || !t || t.kind !== "player") return dmg;
  const mx = world.P.max_hp || 100, now = now0(world);
  if (!(now - (V.capT || 0) < 1000)) { V.capT = now; V.capD = 0; }
  const d = Math.max(0, Math.min(dmg, mx * 0.08, mx * 0.15 - V.capD)); V.capD += d;
  return d;
}
function vsProjHit(world, e) {
  const V = S(world).vs, s = e.src; if (!V || !s || !s.vs || !e.dmg) return;
  const foes = V.player ? [V.player.ent].concat(S(world).byOwner.get(V.player.n) || []).filter((o) => o && world.ents.has(o.id)) : V.side[3 - s.vs];
  for (const o of foes) {
    if (e.hit.has(o.id)) continue;
    if (dist(e, o) < C.proj_hit_r + (o.cr || 40)) { e.hit.add(o.id); V.sdmg[s.vs] += hit(world, o, vsCap(world, V, o, e.dmg), s) || 0; e.dmg = 0; return; }   // one enemy per shot: no crowd splash
  }
}

function stepWild(world, e, now, dt, awake) {
  if (e.slowUntil > now) dt *= e.slowFactor || 1;
  const d = kdef(world, e.sp, e.stage);
  if (e.flagUntil && now >= e.flagUntil) { e.flagUntil = 0; if (e.s7 === 34 || e.s7 === 33) { e.s7 = 2; world.touch(e, { "7": 2 }); } }
  if (e.s7 === 10 && now - e.born >= C.pet_spawn_ms) { e.s7 = e.wake7; world.touch(e, { "7": e.s7 }); }
  if (e.tgt && passiveBaby(e) && e.st !== "taming") { e.tgt = null; e.st = "wander"; }   // no other path may point a calm baby at anyone
  if (e.sleepAt && now >= e.sleepAt && e.st !== "taming") { e.sleepAt = 0; e.tgt = null; e.st = "wander"; e.s7 = e.wake7 = 66; world.touch(e, { "7": 66 }); }   // hive shadows
  if (e.hiveBaby && (e.s7 & 64) && e.st !== "taming") return;   // asleep: stands still until hit or tamed
  if (e.st === "taming") { if (now >= e.tameAt) finishTame(world, e); else if (!e.tamer || !e.tamer.alive || !e.tamer.ent || dist(e, e.tamer.ent) > C.tame_break) cancelTame(world, e); return; }
  if (e.vs) { stepVs(world, e, now, dt, d); return; }
  if (e.reaper) { stepReaper(world, e, now, dt); return; }
  if (e.worldBoss || e.bossBody) { stepWorldBoss(world, e, now, d); return; }
  if (ASTAR) {
    const x0 = Math.round(e.x), y0 = Math.round(e.y), a0 = ang255(e.a);
    stepWildNav(world, e, now, dt, awake, d);
    const f = {}, x1 = Math.round(e.x), y1 = Math.round(e.y), a1 = ang255(e.a);
    if (x1 !== x0 || y1 !== y0) { f["3"] = x1; f["4"] = y1; }
    if (a1 !== a0) f["5"] = a1;
    if (Object.keys(f).length) world.touch(e, f);
    return;
  }
  if (e.tgt && (!validTgt(world, e.tgt, now) || dist(e, e.tgt) > C.give_up || Math.hypot(e.x - e.hx, e.y - e.hy) > C.leash)) {
    if (e.tgt.kind === "player" && e.tgt.p) { e.calm = e.calm || new Map(); e.calm.set(e.tgt.p.n, now + C.calm_ms); }
    e.tgt = null; e.st = "home"; e.tx = e.hx; e.ty = e.hy;
  }
  if (!awake) { if (e.st === "home") { e.x = e.hx; e.y = e.hy; e.st = "wander"; world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) }); } return; }
  const x0 = Math.round(e.x), y0 = Math.round(e.y), a0 = ang255(e.a);
  if (e.st === "home") {
    if (Math.hypot(e.x - e.hx, e.y - e.hy) <= C.home_r) e.st = "wander";
    else { moveToward(world, e, e.hx, e.hy, d.chase || C.walk, dt, 0); }
  }
  if (!e.tgt && d.mode === "aggro" && e.st !== "home" && !(e.s7 & 64) && !e.hiveBaby && !passiveBaby(e)) {
    let best = null, bd = d.aggro;
    for (const p of world.players.values()) {
      const pe = p.ent; if (!pe || !p.alive || p.shieldUntil > now) continue;
      if (e.calm && e.calm.get(p.n) > now) continue;
      if (Math.hypot(pe.x - e.hx, pe.y - e.hy) > C.leash) continue;
      const q = dist(e, pe); if (q < bd) { bd = q; best = pe; }
    }
    for (const pt of S(world).pets) { if (pt.dead || pt.veilUntil > now) continue; const q = dist(e, pt); if (q < bd) { bd = q; best = pt; } }
    if (best) { e.tgt = best; e.st = "chase"; }
  }
  if (d.mode === "passive" && !e.revenge && e.fleeUntil > now && e.flee && world.ents.has(e.flee.id)) {
    const a = Math.atan2(e.y - e.flee.y, e.x - e.flee.x);
    moveToward(world, e, e.x + Math.cos(a) * 200, e.y + Math.sin(a) * 200, d.chase, dt, 0);
  } else if (e.st === "home") {
  } else if (e.tgt) {
    const t = e.tgt, q = dist(e, t);
    moveToward(world, e, t.x, t.y, d.chase, dt, d.reach - 8);
    if (q <= Math.max(d.reach, e.cd || 0) + 12 && now - e.lastAtk >= d.every) attack(world, e, d, t, now);
    else if (q < 600) skill(world, e, d, t, now);
  } else if (d.chase > 0 && !(e.s7 & 64)) {
    if (Math.hypot(e.tx - e.x, e.ty - e.y) < C.walk * dt) {
      if (Math.random() < C.retarget_per_s * dt) { const a = Math.random() * TAU, r = Math.random() * C.wander_r; e.tx = e.hx + Math.cos(a) * r; e.ty = e.hy + Math.sin(a) * r; }
    } else moveToward(world, e, e.tx, e.ty, C.walk, dt, 0);
  }
  const f = {}, x1 = Math.round(e.x), y1 = Math.round(e.y), a1 = ang255(e.a);
  if (x1 !== x0 || y1 !== y0) { f["3"] = x1; f["4"] = y1; }
  if (a1 !== a0) f["5"] = a1;
  if (Object.keys(f).length) world.touch(e, f);
}

// ------------------------------------------------------------ pets
function spawnPet(world, p, opt) {
  const st = S(world), now = now0(world);
  if (!p.ent) return null;
  const o = opt || {}, ck = o.ck != null ? o.ck : C.pet_kind, sp = o.sp != null ? o.sp : C.pet_species;
  const lvl = o.stage != null ? o.stage : 0, d = kdef(world, sp, lvl);
  const id = o.id != null ? o.id : world.nextId();
  const max = Math.round((o.invented ? o.invented.hp : o.ck != null && !o.starter ? d.hp : C.pet_hp_by_level[0] * petScale(sp, 0, "health")) * C.ob_hp_mult), a = Math.random() * TAU;
  const x = o.x != null ? o.x : p.ent.x + Math.cos(a) * 80, y = o.y != null ? o.y : p.ent.y + Math.sin(a) * 80;
  const e = { id, kind: "pet", ck, sp, owner: p, x, y, a: 0, hp: max, max, mode: 1, tgt: null, lastAtk: 0, lastCast: -1e9, lvl, pxp: 0, stage: lvl, kb: null,
    s7: o.ck != null && !o.starter ? 2 : 10, born: now, r: cRad(sp, lvl), cr: collR(sp, lvl), cd: collR(sp, lvl) + C.player_gap, plug: "creatures", primary: !!o.primary, starter: !!o.starter };
  e.create = () => ({ "0": e.id, "1": T_CREATE, "2": 0, "3": Math.round(e.x), "4": Math.round(e.y), "5": ang200(e.a), "6": 1, "7": e.s7,
    "13": e.owner.ent ? e.owner.ent.id : 0, "16": teamId(world, e.owner), "17": e.rider ? e.saddleId || C.saddle : 0, "20": C.pet_level + C.pet_ob * (C.pet_max_level + 1), "21": e.sp, "22": e.ck, "23": e.stage, "24": e.skin || 0, "25": 10, ...(e.petName ? { "19": e.petName } : {}) });
  e.hurt = (dmg, by) => hurtPet(world, e, dmg, by);
  const nm = p.petNames && p.petNames[sp] != null ? p.petNames[sp] : ((p.petNamePick || []).find((x) => x[0] === sp) || [])[1];
  if (cleanPetName(nm)) e.petName = cleanPetName(nm);
  if (o.invented) { e.inv = o.invented; e.name = o.invented.name; }
  world.addEnt(e);
  st.pets.add(e);
  const L = petsOf(world, p); L.push(e);
  if (p.easy) maxPet(world, p, e);
  return e;
}
function teamId(world, p) {
  const so = world.ext && world.ext.social;
  try { const t = so && typeof so.team === "function" ? so.team(p) : null; return t && t.id != null ? t.id : 0; } catch (e) { return 0; }
}
function petsOf(world, p) {
  const st = S(world);
  let L = st.byOwner.get(p.n); if (!L) { L = []; st.byOwner.set(p.n, L); }
  return L;
}
function dropPet(world, e, removeNow) {
  const st = S(world);
  st.pets.delete(e);
  const L = st.byOwner.get(e.owner.n); if (L) { const i = L.indexOf(e); if (i >= 0) L.splice(i, 1); }
  if (removeNow) world.removeEnt(e.id);
}
// RELEASE in the pet panel (headless Chrome: client JSON {type: 2, i: pet id}): the pet leaves the owner and the same
// species and stage turns wild on the spot, already chasing its former owner (owner rule; the slot frees up)
function releasePet(world, p, i) {
  const e = petsOf(world, p).find((q) => q.id === i);
  if (!e || e.dead) return;
  if (e.rider) { e.rider = false; p.riding = false; if (p.cf) p.cf["16"] = 0; }
  p.queue({ "1": T_OWNINFO, i: e.id, d: 1 });   // the pet bar drops it (real release: the same {i, d: 1} right after the request)
  dropPet(world, e, true);
  const tpl = { "21": e.sp, "22": e.ck, "23": e.stage, "25": 10, "7": 2 };
  const w = spawnWild(world, tpl, e.x, e.y, S(world).phase, false);
  w.tpl = null;   // a released pet does not respawn
  if (p.ent && p.alive) { w.tgt = p.ent; w.st = "chase"; w.flee = null; w.fleeUntil = 0; w.revenge = true; w.angry = true; }
  world.L({ k: "pet_release", room: world.name, n: p.n, pet: i, species: e.sp, stage: e.stage, wild: w.id });
}
// field 22 (type) of a species: the most common one in the recordings (wolf 20 as recorded on the own pet)
let PTYPE = null;
// wiki animal types of a species ("Fairy Fire" = both), plus Dog for the dog-like ones (hats / capes name a dog type)
function typesOf(sp) {
  const w = SPECIES[bsp(sp)] && WIKI[SPECIES[bsp(sp)][0]], t = String(wv(w && w.type) || "").split(/\s+/).filter(Boolean);
  if (/dog|wolf|hound|pup|fox/i.test(spName(sp))) t.push("Dog");
  return t;
}
// owner's hats / wings on his pet's bite and skill: type and species boosts, Tamer's Helmet on the mounted pet
function petBoost(e) {
  const m = e && e.owner && e.owner.mods; if (!m) return 1;
  let k = 1;
  if (m.pet_type) for (const t of typesOf(e.sp)) if (m.pet_type[t]) k = Math.max(k, m.pet_type[t]);
  if (m.pet_species && m.pet_species[spName(e.sp)]) k *= m.pet_species[spName(e.sp)];
  if (e.rider && m.mount_buff) k *= m.mount_buff;
  return k;
}
// type advantage of an animal / pet / fairy-ball hit on an animal or pet (game_config type_adv / type_weak_to, wiki);
// players and buildings have no type: 1. ATK_TY: the fairy ball aoeTick is resolving, its fairy's types
let ATK_TY = null;
function typeMul(world, src, tgt) {
  const P = world.P || {}; if (!P.type_adv || !tgt || (tgt.kind !== "animal" && tgt.kind !== "pet")) return 1;
  const at = ATK_TY || (src && (src.kind === "animal" || src.kind === "pet") ? typesOf(src.sp) : null); if (!at || !at.length) return 1;
  let k = 1;
  for (const a of at) for (const d of typesOf(tgt.sp)) {
    if ((P.type_adv[a] || []).includes(d)) k *= P.type_strong || 2;
    if ((P.type_weak_to[a] || []).includes(d)) k *= P.type_weak || 0.5;
  }
  return k;
}
function petType(sp) {
  if (sp === C.pet_species) return C.pet_kind;
  if (!PTYPE) {
    PTYPE = {}; const cnt = {};
    try { for (const [ph, v] of Object.entries(require("../data/scan_spawns.json"))) if (v && v.templates) for (const [k, t, , n] of v.templates) { const c = cnt[k] = cnt[k] || {}; c[t] = (c[t] || 0) + n; } } catch (e) { }
    for (const [k, c] of Object.entries(cnt)) PTYPE[k] = +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }
  return PTYPE[bsp(sp)] != null ? PTYPE[bsp(sp)] : C.pet_kind;
}
function ownInfo(p, pet) {
  p.queue({ "1": T_OWNINFO, i: pet.id, n: pet.sp, ag: 0, na: pet.petName || null, mi: 0, h: 0, s: 0 });
}
// pet names (owner): the client's pet card rename and the menu's names (join pn) as the real game: max 16 characters
// (the client inputs' maxlength), shown to the owner by own_info na and to every viewer by create field 19 (the client
// table's animal name field, drawn as the name tag); kept per species for the player's session (respawns, rejoin)
function cleanPetName(s) { return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16) : ""; }
function renamePet(world, p, id, name) {
  const e = world.ents.get(id); if (!e || e.kind !== "pet" || e.owner !== p) return false;
  name = cleanPetName(name);
  e.petName = name || undefined;
  (p.petNames = p.petNames || {})[e.sp] = name;
  p.queue({ "1": T_OWNINFO, i: e.id, na: name });
  world.touch(e, { "19": name });
  world.L({ k: "pet_rename", room: world.name, n: p.n, pet: e.id, sp: e.sp, name });
  return true;
}
function hurtPet(world, e, dmg, by) {
  if (e.dead || !world.ents.has(e.id)) return 0;
  if (by && friendly(world, by, e)) return 0;
  if (e.inv && e.inv.kit) dmg = kitOnHurt(world, e, dmg, entOf(by), now0(world));
  if (e.trk) dmg = TRK.hurt(e, dmg, now0(world));   // trinket defense malus / Frostguard shield
  const pl = by && by.queue ? by : null;
  if (pl && pl === e.owner) return 0;
  if (e.rider && e.owner && e.owner.mods && e.owner.mods.mount_buff > 1) dmg /= e.owner.mods.mount_buff;   // Tamer's Helmet
  dmg = Math.max(0, Math.round(dmg)); if (!dmg) return 0;
  dmg = adminHit(world, by, e, dmg);
  e.hp -= dmg;
  const f = { "9": Math.max(0, Math.round(e.hp / e.max * 255)), "10": dmg };
  const src = entOf(by);
  if (pl || (src && src.kind === "player")) f["11"] = 1;
  if (e.hp <= 0) {
    e.dead = true; e.dying = true; e.dieAt = now0(world) + C.pet_die_ms;
    Object.assign(f, { "7": 50, "9": 0, "17": 0 });
    world.touch(e, f);
    e.owner.queue({ "1": T_OWNINFO, i: e.id, d: 1 });
    if (e.rider) unmount(world, e, false);
    dropPet(world, e, false);
    S(world).dying.add(e);
    world.L({ k: "pet_death", room: world.name, n: e.owner.n, species: e.sp });
    return dmg;
  }
  world.touch(e, f);
  if (src && src !== e && src.x != null && !e.rider) { const a = Math.atan2(e.y - src.y, e.x - src.x); e.kb = [Math.cos(a) * C.pet_kb, Math.sin(a) * C.pet_kb]; }
  if (e.mode !== 2 && src && src !== e && (src.kind === "animal" || src.kind === "pet")) e.tgt = src;
  return dmg;
}
// growth: the kill XP goes to every live pet (pet record {14: kill xp, 15: pet total}); own_info a at the thresholds.
// Owner: a tamed baby is never the first pet, so it levels too and grows baby -> adult -> boss
function petLevel(world, p, xp0) {
  const L = S(world).byOwner.get(p.n); if (!L || !L.length) return;
  for (const e of [...L]) {
    if (e.dead) continue;
    const xp = Math.round((xp0 || 0) * TRK.xpMult(e));   // Majestic Flower
    e.pxp += xp || 0;
    if (xp) world.touch(e, { "14": xp, "15": e.pxp });
    let lvl = 0; for (let i = 0; i < C.pet_grow_xp.length; i++) if (e.pxp >= C.pet_grow_xp[i]) lvl = i + 1;
    growTo(world, p, e, lvl);
  }
}
// raise a pet to growth level lvl one step at a time, with the same messages and HP as normal growth
function growTo(world, p, e, lvl) {
  while (e.lvl < lvl && !e.dead) {
    e.lvl++; e.stage = e.lvl; e.r = cRad(e.sp, e.stage); e.cr = collR(e.sp, e.stage); if (!e.rider) e.cd = e.cr + C.player_gap;
    const nm = Math.round((e.primary || e.starter ? petHp(e, e.lvl) : kdef(world, e.sp, e.stage).hp) * C.ob_hp_mult);
    e.hp = e.hp / e.max * nm; e.max = nm;
    p.queue({ "1": T_OWNINFO, i: e.id, a: e.lvl });
    world.touch(e, { "23": e.stage, "15": e.pxp });   // owner: the body grows at once for everyone
    world.L({ k: "pet_grow", room: world.name, n: p.n, pet: e.id, a: e.lvl });
  }
}
// /easy: every pet of the player at max growth at once (full pet XP)
function maxPet(world, p, e) {
  const top = C.pet_grow_xp.length;
  // owner: /easy = the last stage with a full XP bar; the client draws the bar from its own thresholds (real boss growth
  // was seen between 426 and 800 total, above the guessed 600), so go far past every threshold
  const full = Math.max(C.pet_easy_xp || 0, C.pet_grow_xp[top - 1]);
  if (e.pxp < full) { e.pxp = full; world.touch(e, { "15": e.pxp }); }
  growTo(world, p, e, top);
}
function defendOwner(world, p, att, ownerHit) {   // ownerHit: the owner was hit (Thunder Step only then, not when the owner attacks)
  const L = S(world).byOwner.get(p.n); if (!L) return;
  for (const pt of L) if (ownerHit && pt.inv && pt.inv.kit && pt.inv.kit.step && !pt.dead && p.ent && dist(pt, p.ent) > pt.inv.kit.step.hitfar && att && !friendly(world, pt, att)) thunderStep(world, pt, now0(world), "owner hit");
  if (att && att.kind === "player" && att.p && att.p.shieldUntil > now0(world)) return;
  for (const pt of L) if (!pt.dead && pt.mode !== 2 && att && att !== pt && att !== p.ent && !friendly(world, pt, att)) pt.tgt = att;
}
function heldSaddle(world, p) {   // owner: every saddle mounts (Saddle 160 and the age 25 upgrades 161..165: Battle / Racing / Honey / Turtle / Crystal)
  const sid = (world.P && world.P.saddle_item) || C.saddle;
  return p.held === sid || (p.held >= C.saddle && p.held <= C.saddle + 5);
}
function mount(world, p, e) {
  const st = S(world);
  for (const q of petsOf(world, p)) if (q.rider) unmount(world, q, true);
  e.rider = p; p.riding = true; p.cf = p.cf || {}; p.cf["16"] = 1; e.cd = 0;   // a ridden pet does not block its rider
  e.saddleId = heldSaddle(world, p) ? p.held : C.saddle;   // the pet wears the saddle the rider held
  const prev = st.prevHeld.get(p.n) || 0;
  if ("held" in p) p.held = prev;
  e.x = p.ent.x; e.y = p.ent.y;
  world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y), "17": e.saddleId });
  world.touch(p.ent, { "7": 1, "8": prev, "15": 500, "16": 1 });
  world.L({ k: "pet_mount", room: world.name, n: p.n, pet: e.id });
}
function unmount(world, e, touchPet) {
  const p = e.rider; if (!p) return;
  e.rider = null; p.riding = false; p.cf = p.cf || {}; p.cf["16"] = 0; e.cd = bodyR(e) + C.player_gap;
  if (touchPet) {
    const a = Math.random() * TAU;
    e.x = p.ent.x + Math.cos(a) * 90; e.y = p.ent.y + Math.sin(a) * 90;
    world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y), "17": 0 });
  }
  if (p.ent) world.touch(p.ent, { "7": 2, "16": 0 });
  world.L({ k: "pet_unmount", room: world.name, n: p.n, pet: e.id });
}
// ------------------------------------------------------------ invented boss pets (TIO_BOSS_PETS=1, source "invented")
// The invented pets are their own client species (appended by mimic/invented/client_patch.json, art from
// tools/invented/make_art.py): 155 = Grove Colossus (mammoth shape), 156 = Stormhorn (reindeer shape), 157 = Cinder Prowler
// (rat shape). The real mammoth 41, reindeer 13 and rat 39 are untouched.
const BOSS_PETS = process.env.TIO_BOSS_PETS !== "0";
const DEFAULT_PETS = [155, 156, 157];   // owner: Grove Colossus, Stormhorn, Cinder Prowler when the menu sends no pick
const INVENTED = {
  156: { name: "Stormhorn", ck: 45, stage: 2, hp: 1600, bite: 22, speed: 560, catchup: 760, ai: "orbit", orbit_r: 190, orbit_w: 1.6,
    zap: { every: 1200, range: 450, chain: 3, hop: 260, dmg: [18, 12, 8], pdmg: [9, 6, 4], fx: 45, fx_life: 500 },
    kit: { shell: { reduce: 0.2, shock: 10, r: 220, cd: 800 }, over: { n: 2, dur: 4000, every: 500, cd: 12000 },
      magnet: { cd: 8000, range: 520, min: 220, to: 140, dmg: 8 }, step: { cd: 6000, far: 700, hitfar: 300, shock: 8, r: 150 } },
    ult: { kind: "crown", name: "Tempest Crown", reload: 20000, life: 4000, tick: 500, r: 380, adm: 16, pdm: 7, fx: 545 } },
  157: { name: "Cinder Prowler", ck: 20, stage: 2, hp: 1400, bite: 30, speed: 360, ai: "dash", range: 600, dash: 900, reach: 130,
    every: 900, leash: 520, retreat_hp: 0.4, back_r: 200,
    kit: { trail: { step: 140, life: 2500, r: 70, dmg: 4, pdm: 2, tick: 500, max: 8, fx: 122 }, hide: { reduce: 0.3, thorns: 6, r: 220, cd: 800, fx: 122 },
      pounce: { r: 450, mult: 1.5 }, veil: { hp: 0.5, dur: 3000, cd: 20000, fx: 60 } },
    ult: { kind: "snare", name: "Ashen Snare", reload: 18000, life: 5000, tick: 500, r: 300, slow: 0.45, adm: 6, pdm: 3, fx: 86, auto_hp: 0.35 } },
};
const HELP_LINES = [
  "Stormhorn (boss pet): orbits you and chain-zaps up to 3 enemies; ultimate Tempest Crown: a lightning crown that zaps everything near it for 4 s",
  "Cinder Prowler (boss pet): dashes at the nearest enemy and falls back to you when hurt; ultimate Ashen Snare: a smouldering field that slows and burns enemies for 5 s",
];
function giveBossPets(world, p) {
  for (const sp of [156, 157]) {
    const D = INVENTED[sp];
    const e = spawnPet(world, p, { sp, ck: D.ck, stage: 0, invented: D });
    if (!e) continue;
    p.queue({ "1": T_OWNINFO, i: e.id, n: sp, ag: 0, mi: 0, h: 0 });
    p.queue({ "1": T_OWNINFO, i: e.id, a: e.lvl });
  }
}
function enemiesNear(world, e, x, y, r) {
  const own = e.owner, ownPets = S(world).byOwner.get(own.n) || [], out = [];
  for (const w of S(world).wild) if (!w.dying && !w.dead && w.st !== "taming" && !w.hiveBaby && Math.hypot(w.x - x, w.y - y) < r) out.push(w);   // passive kits leave a creature being tamed and hive babies alone
  if (e.tgt && validTgt(world, e.tgt, now0(world)) && ownPets.indexOf(e.tgt) < 0 && e.tgt !== own.ent && !friendly(world, e, e.tgt) && Math.hypot(e.tgt.x - x, e.tgt.y - y) < r && out.indexOf(e.tgt) < 0) out.push(e.tgt);
  return out;
}
// auras (sea scans, owner): the elemental statues, wild and tamed, wear their element aura: an effect of the statue's own kind
// (Plant 148, Fire 149, Water 151) on the statue, re-sent every ~5.7 s (field 8 = stage); the Inferno Gaze shows 319 on itself
// and 315 on its owner every ~6 s. The other Gazes had no aura in any scan.
const AURA = { 88: { k: 148, every: 5700 }, 89: { k: 149, every: 5700 }, 90: { k: 151, every: 5700 }, 104: { k: 319, owner: 315, every: 6000 } };
function auraTick(world, now) {
  const st = S(world);
  for (const L of [st.wild, st.pets]) for (const e of L) {
    const A = AURA[e.sp]; if (!A || e.dead || e.dying || now < (e.auraAt || 0) || !world.ents.has(e.id)) continue;
    e.auraAt = now + A.every;
    fx(world, A.k, e.x, e.y, A.every, e, e.stage | 0);
    if (A.owner && e.kind === "pet" && e.owner && e.owner.ent) fx(world, A.owner, e.owner.ent.x, e.owner.ent.y, A.every, e.owner.ent, e.stage | 0);
  }
}
function fx(world, k, x, y, life, src, f8) { spawnProj(world, { k, x, y, a: 0, speed: 0, life, dmg: 0, src, hostile: "none", f8: f8 || 2 }); }
function zapChain(world, e, D, now) {
  const Z = D.zap, oe = e.owner.ent; if (!oe) return;
  let cur = null, bd = Z.range;
  for (const t of enemiesNear(world, e, e.x, e.y, Z.range)) { const q = dist(e, t); if (q < bd) { bd = q; cur = t; } }
  if (!cur) return;
  e.lastZap = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
  const hitList = [];
  for (let i = 0; i < Z.chain && cur; i++) {
    hitList.push(cur);
    hit(world, cur, cur.kind === "player" ? Z.pdmg[i] : Z.dmg[i], e);
    fx(world, Z.fx, cur.x, cur.y, Z.fx_life, e);
    let nx = null, nd = Z.hop;
    for (const t of enemiesNear(world, e, cur.x, cur.y, Z.hop)) { if (hitList.indexOf(t) >= 0) continue; const q = dist(cur, t); if (q < nd) { nd = q; nx = t; } }
    cur = nx;
  }
}
function moveTo(world, e, tx, ty, sp, dt, stopAt) { return moveToward(world, e, tx, ty, sp, dt, stopAt); }
// ---- invented pet kits (passives, server side; every trigger shows an effect or damage numbers and logs k pet_kit)
function kitLog(world, e, name, extra) { world.L(Object.assign({ k: "pet_kit", room: world.name, n: e.owner.n, pet: e.id, name }, extra || {})); }
function kitOnHurt(world, e, dmg, src, now) {   // Static Shell / Molten Hide: less damage, shock / burn a melee attacker
  const K = e.inv.kit, P = K.shell || K.hide;
  dmg = dmg * (1 - P.reduce);
  if (src && src !== e && src.x != null && (src.kind === "animal" || src.kind === "player" || src.kind === "pet") && !friendly(world, e, src) &&
      dist(e, src) <= P.r && now - (e.lastThorn || 0) >= P.cd) {
    e.lastThorn = now;
    hit(world, src, K.shell ? P.shock : P.thorns, e);
    fx(world, K.shell ? 45 : P.fx, src.x, src.y, 400, e);
    kitLog(world, e, K.shell ? "Static Shell" : "Molten Hide", { target: src.id });
  }
  return dmg;
}
function thunderStep(world, e, now, why) {
  const S0 = e.inv.kit.step, oe = e.owner.ent;
  if (!oe || now - (e.lastStep || 0) < S0.cd) return false;
  e.lastStep = now;
  fx(world, 45, e.x, e.y, 500, e);
  const a = Math.random() * TAU; e.x = oe.x + Math.cos(a) * 120; e.y = oe.y + Math.sin(a) * 120; e.phaseA = a;
  fx(world, 45, e.x, e.y, 500, e);
  for (const t of enemiesNear(world, e, e.x, e.y, S0.r)) hit(world, t, S0.shock, e);
  world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) });
  kitLog(world, e, "Thunder Step", { why });
  return true;
}
function stormKit(world, e, now) {
  const K = e.inv.kit, Z = e.inv.zap;
  const near = enemiesNear(world, e, e.x, e.y, Z.range);
  if (near.length >= K.over.n && now - (e.lastOver || 0) >= K.over.cd) { e.lastOver = now; e.overUntil = now + K.over.dur; fx(world, 45, e.x, e.y, 600, e); kitLog(world, e, "Overcharge", { enemies: near.length }); }
  if (now - (e.lastMagnet || 0) >= K.magnet.cd) {
    let far = null, fd = K.magnet.min;
    for (const t of enemiesNear(world, e, e.x, e.y, K.magnet.range)) { if (t.kind === "player") continue; const q = dist(e, t); if (q > fd) { fd = q; far = t; } }
    if (far) {
      e.lastMagnet = now;
      fx(world, 45, far.x, far.y, 400, e);
      const a = Math.atan2(far.y - e.y, far.x - e.x);
      far.x = e.x + Math.cos(a) * K.magnet.to; far.y = e.y + Math.sin(a) * K.magnet.to;
      world.touch(far, { "3": Math.round(far.x), "4": Math.round(far.y) });
      hit(world, far, K.magnet.dmg, e);
      kitLog(world, e, "Magnet Pull", { target: far.id, from: Math.round(fd) });
    }
  }
}
function emberTrail(world, e, now, moved) {
  const T0 = e.inv.kit.trail;
  e.trailDist = (e.trailDist || 0) + moved;
  if (e.trailDist < T0.step) return;
  e.trailDist = 0;
  e.embers = (e.embers || []).filter((q) => world.ents.has(q.id));
  if (e.embers.length >= T0.max) return;
  const pr = spawnProj(world, { k: T0.fx, x: e.x, y: e.y, a: e.a, speed: 0, life: T0.life, dmg: 0, src: e, hostile: "none", f8: 2,
    aoe: { tick: T0.tick, r: T0.r, adm: T0.dmg, adot: T0.dmg, pdmg: T0.pdm, pdot: T0.pdm, owner: e.owner } });
  e.embers.push(pr);
  if (!e.trailLogged || now - e.trailLogged > 2000) { e.trailLogged = now; kitLog(world, e, "Ember Trail"); }
}
function smokeVeil(world, e, now) {
  const V = e.inv.kit.veil;
  if (e.hp >= V.hp * e.max || now - (e.lastVeil || 0) < V.cd) return;
  e.lastVeil = now; e.veilUntil = now + V.dur;
  fx(world, V.fx, e.x, e.y, V.dur, e);
  for (const w of S(world).wild) if (w.tgt === e) { w.tgt = null; w.st = "wander"; }
  kitLog(world, e, "Smoke Veil");
}
function stepInvented(world, e, now, dt) {
  const D = e.inv, p = e.owner, oe = p.ent;
  const f = {}, x0 = Math.round(e.x), y0 = Math.round(e.y), a0 = ang255(e.a);
  if (e.hp < e.max) { const b0 = Math.round(e.hp / e.max * 255); e.hp = Math.min(e.max, e.hp + e.max * 0.01 * dt); const b1 = Math.round(e.hp / e.max * 255); if (b1 !== b0) f["9"] = b1; }
  if (e.tgt && (!validTgt(world, e.tgt, now) || dist(oe, e.tgt) > C.give_up || friendly(world, e, e.tgt))) e.tgt = null;
  if (e.castAt && now < e.castAt) {   // holds still for the cast wind-up
  } else if (D.kit && D.kit.step && dist(e, oe) > D.kit.step.far && thunderStep(world, e, now, "far")) {
  } else if (dist(e, oe) > C.inv_teleport) {   // invented pets keep their jump back to the owner
    const a = Math.random() * TAU; e.x = oe.x + Math.cos(a) * 150; e.y = oe.y + Math.sin(a) * 150; e.tgt = null;
  } else if (D.ai === "orbit") {
    e.phaseA = (e.phaseA == null ? Math.random() * TAU : e.phaseA) + D.orbit_w * dt;
    const tx = oe.x + Math.cos(e.phaseA) * D.orbit_r, ty = oe.y + Math.sin(e.phaseA) * D.orbit_r;
    moveTo(world, e, tx, ty, Math.hypot(tx - e.x, ty - e.y) > 300 ? D.catchup : D.speed, dt, 4);
    if (e.mode !== 2 && D.kit) stormKit(world, e, now);
    if (e.mode !== 2 && now - (e.lastZap || 0) >= (e.overUntil > now ? D.kit.over.every : D.zap.every)) zapChain(world, e, D, now);
  } else {
    const dOwn = dist(e, oe);
    if (e.hp < D.ult.auto_hp * e.max && now - e.lastCast >= D.ult.reload) castSkill(world, e);
    if (D.kit && D.kit.veil) smokeVeil(world, e, now);
    const px = e.x, py = e.y;
    if (e.retreat || e.hp < D.retreat_hp * e.max || dOwn > D.leash) {
      e.retreat = dOwn > D.back_r && !(e.hp >= 0.8 * e.max && dOwn <= D.leash);
      moveTo(world, e, oe.x, oe.y, D.dash, dt, D.back_r - 20);
      if (dOwn <= D.back_r) e.retreat = false;
    } else {
      let t = e.mode !== 2 && e.tgt && validTgt(world, e.tgt, now) ? e.tgt : null;
      if (!t && e.mode !== 2) { let bd = D.range; for (const w of enemiesNear(world, e, oe.x, oe.y, D.range)) { const q = dist(e, w); if (q < bd) { bd = q; t = w; } } }
      if (t) {
        e.tgt = t;
        const q = dist(e, t);
        moveTo(world, e, t.x, t.y, q > 200 ? D.dash : D.speed, dt, D.reach - 10);
        if (q <= D.reach + 12 && now - e.lastAtk >= D.every) {
          e.a = Math.atan2(t.y - e.y, t.x - e.x);   // face the target on the bite
          e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; f["7"] = 34;
          const mult = e.pounceBoost ? D.kit.pounce.mult : 1; e.pounceBoost = false;
          petBite(world, t, Math.round((t.kind === "player" ? D.bite / 2 : D.bite) * mult * C.ob_dmg_mult), e);
        }
      } else if (dOwn > C.pet_walk_dist) moveTo(world, e, oe.x, oe.y, dOwn > C.pet_run_dist ? D.dash : D.speed, dt, C.pet_walk_dist - 20);
    }
    const mv = Math.hypot(e.x - px, e.y - py);
    if (D.kit && D.kit.trail && mv > D.speed * dt * 1.2) emberTrail(world, e, now, mv);   // only while dashing
  }
  const x1 = Math.round(e.x), y1 = Math.round(e.y), a1 = ang255(e.a);
  if (x1 !== x0 || y1 !== y0) { f["3"] = x1; f["4"] = y1; }
  if (a1 !== a0) f["5"] = a1;
  if (Object.keys(f).length) world.touch(e, f);
}
function castInvented(world, e, now) {
  const U = e.inv.ult;
  const pr = spawnProj(world, { k: U.fx, x: e.x, y: e.y, a: e.a, speed: 0, life: U.life, dmg: 0, src: e, hostile: "none", f8: 2,
    aoe: { kind: U.kind, tick: U.tick, r: U.r, adm: U.adm, adot: U.adm, pdmg: U.pdm, pdot: U.pdm, slow: U.slow, owner: e.owner } });
  pr.nextTick = now + U.tick;
  const hits = aoeTick(world, pr, now);
  world.L({ k: "pet_ultimate", room: world.name, n: e.owner.n, pet: e.id, name: U.name, hits });
  return hits;
}
// dash skills by species (wiki skill_name): the pet runs while casting
const PET_DASH_SPEED = 900;   // fallback only when pet_speed.json is missing
// owner: the horse baby dash was way too fast: a stages own recorded dash first, else the adult dash x that stages run /
// the adult run, never above the fastest dash recorded for the species
function petDash(sp, stage) {
  const P = petSpeed(), m = P[bsp(sp)], st = (m && m.stages) || {}, s = st[stage | 0];
  if (s && s.dash > 0) return s.dash;
  const ad = st[2] && st[2].dash > 0 ? st[2].dash : m && m.dash_samples >= 2 && m.dash > 0 ? m.dash : (P.all && P.all.dash) || PET_DASH_SPEED;
  const top = Math.max(ad, ...Object.values(st).map((x) => x.dash || 0), (m && m.dash) || 0);
  const ar = st[2] && st[2].run > 0 ? st[2].run : m && m.run, sr = s && s.run > 0 ? s.run : 0;
  return Math.min(top, ar && sr ? ad * sr / ar : ad);
}
// how long the dash moves: the stages recorded dash_ms, else the species, else the all-species median (owner: not the whole cast)
function petDashMs(sp, stage) {
  const P = petSpeed(), m = P[bsp(sp)], s = m && m.stages && m.stages[stage | 0];
  return (s && s.dash_ms) || (m && m.dash_ms) || (P.all && P.all.dash_ms) || 282;
}
const DASH_RX = /dash|rush|charge|leap|pounce|lunge/i;
const DASH_SP = new Set(Object.entries(SPECIES).filter(([k, v]) => { const w = WIKI[SPECIES[bsp(+k)][0]]; return w && DASH_RX.test((w.skill_name && w.skill_name.value) || ""); }).map(([k]) => +k));
function dashSkill(sp) { return DASH_SP.has(sp); }
function stepPet(world, e, now, dt) {
  const p = e.owner, oe = p.ent;
  if (!oe || !p.alive) return;
  if (e.trk) { TRK.tick(world, e, now); if (TRK.stopped(e, now)) return; }   // Mimic Cap / Tidebladder; frozen by its own Wilted Frostberry
  if (e.s7 === 10 && now - e.born >= C.pet_spawn_ms) { e.s7 = 2; world.touch(e, { "7": 2 }); }
  if (e.flagUntil && now >= e.flagUntil) { e.flagUntil = 0; if (e.s7 === 34) { e.s7 = 2; world.touch(e, { "7": 2 }); } }
  if (e.inv && !e.rider && !e.goto && e.anchor) {
    const x0 = Math.round(e.x), y0 = Math.round(e.y); anchorStep(world, e, now, dt);
    if (Math.round(e.x) !== x0 || Math.round(e.y) !== y0) world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y), "5": ang255(e.a) });
    return;
  }
  if (e.inv && !e.rider && e.goto) {
    const x0 = Math.round(e.x), y0 = Math.round(e.y);
    if (goStep(world, e, e.inv.catchup || e.inv.dash || C.pet_run, dt, now)) e.goto = null;
    if (Math.round(e.x) !== x0 || Math.round(e.y) !== y0) world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y), "5": ang255(e.a) });
    return;
  }
  if (e.inv) { if (!e.rider) {
    stepInvented(world, e, now, dt);
    if (e.tgt && !e.goto && !(e.castUntil > now)) {   // owner: boss pets also bite through what blocks them from the target
      const d0 = Math.hypot(e.tgt.x - e.x, e.tgt.y - e.y);
      if (d0 > C.pet_reach + tRad(world, e.tgt) + 30 && stuckWindow(e, d0, now) && (!SLIDE || (e.slideBlk && now - (e.slideBlkAt || 0) < 400))) biteBlocker(world, e, e.tgt.x, e.tgt.y, now); else e.chewing = false;
    }
    return;
  } }
  const x0 = Math.round(e.x), y0 = Math.round(e.y), a0 = ang255(e.a), f = {};
  if (e.hp < e.max) {
    const b0 = Math.round(e.hp / e.max * 255);
    e.hp = Math.min(e.max, e.hp + C.pet_regen_bar_s * e.max / 255 * dt * TRK.regenMult(e));
    const b1 = Math.round(e.hp / e.max * 255); if (b1 !== b0) f["9"] = b1;
  }
  if (e.tgt && (!validTgt(world, e.tgt, now) || dist(oe, e.tgt) > C.pet_give_up || e.tgt === oe || e.mode === 2 || friendly(world, e, e.tgt))) e.tgt = null;
  if (!e.tgt && e.mode === 0) {
    let best = null, bd = C.pet_hunt;
    for (const w of S(world).wild) { if (w.st === "dying" || w.st === "taming" || w.hiveBaby) continue; const q = dist(oe, w); if (q < bd) { bd = q; best = w; } }   // like the kits: leave a creature being tamed and hive babies alone
    e.tgt = best; e.ordered = false;   // auto-hunt: no right-click order
  }
  const dOwn = dist(e, oe);
  if (e.kb && e.castUntil > now) e.kb = null;   // a casting pet is not knocked out of its own skill
  if (e.kb) {   // knockback after a hit: speed decays 0.8 per tick
    const [nx, ny] = world.collide(e.x + e.kb[0] * dt, e.y + e.kb[1] * dt, 0.8, e, bodyR(e)); e.x = nx; e.y = ny;
    e.kb[0] *= C.pet_kb_decay; e.kb[1] *= C.pet_kb_decay; if (Math.hypot(e.kb[0], e.kb[1]) < 20) e.kb = null;
  }
  if (e.castUntil > now && dashSkill(e.sp) && now < e.lastCast + petDashMs(e.sp, e.stage)) {   // owner: a dash skill propels the pet for the recorded dash time, then it is a normal cast
    const t = e.tgt && world.ents.has(e.tgt.id) ? e.tgt : null, a = e.aim ? Math.atan2(e.aim.y - e.y, e.aim.x - e.x) : t ? Math.atan2(t.y - e.y, t.x - e.x) : e.a;   // the aim point of the cast first
    e.dashUntil = e.lastCast + petDashMs(e.sp, e.stage); e.blastKb = null;   // owner: a dashing pet is heavy: nothing knocks it back or pushes it aside, it shoves through (world.collide)
    e.a = a; moveToward(world, e, e.x + Math.cos(a) * 400, e.y + Math.sin(a) * 400, petDash(e.sp, e.stage), dt, t ? C.pet_reach - 20 : 0);
    if (e.rider) { oe.x = e.x; oe.y = e.y; }   // owner: a ridden dash carries the rider, for the dash time only
  } else if (e.castUntil > now && !e.rider && !dashSkill(e.sp)) {   // the caster stays put while its skill runs (a ridden one stays under its rider); owner: a dash is a speed boost, no standstill after it
  } else if (e.rider) {
    e.x = oe.x; e.y = oe.y;
    if (e.tgt) {
      const t = e.tgt, q = dist(e, t), reach = C.pet_reach + tRad(world, t) - 45;
      e.a = Math.atan2(t.y - e.y, t.x - e.x);
      if (q <= reach + 12 && now - e.lastAtk >= C.pet_every) {
        e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; f["7"] = 34;
        petBite(world, t, Math.round((t.kind === "player" ? C.pet_pvp_dmg : C.pet_dmg) * petScale(e.sp, e.stage, "dmg") * C.ob_dmg_mult), e);
      }
    }
  } else if (e.goto) {   // right-click spot
    if (goStep(world, e, petRun(e), dt, now)) e.goto = null;
  } else if (e.anchor && !e.tgt) {
    anchorStep(world, e, now, dt);
  } else if (e.anchor && e.tgt) {   // stays anchored: only bites what comes into reach
    const t = e.tgt, q = dist(e, t), reach = C.pet_reach + tRad(world, t) - 45;
    if (q > reach + 60) e.tgt = null;
    else if (q <= reach + 12 && now - e.lastAtk >= C.pet_every) { e.a = Math.atan2(t.y - e.y, t.x - e.x); e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; f["7"] = 34; petBite(world, t, Math.round(C.pet_dmg * petScale(e.sp, e.stage, "dmg") * C.ob_dmg_mult), e); }
  } else if (dOwn > C.pet_teleport) {
    const a = Math.random() * TAU; e.x = oe.x + Math.cos(a) * 150; e.y = oe.y + Math.sin(a) * 150; e.tgt = null; e.goto = null;
  } else if (e.tgt) {
    const t = e.tgt, q = dist(e, t), reach = C.pet_reach + tRad(world, t) - 45;
    petWalk(world, e, t.x, t.y, petRun(e), dt, reach - 8, now);   // runs at the target (recorded: run 2..3 s before the first bite)
    if (q <= reach + 12 && now - e.lastAtk >= (t.kind === "player" ? C.pet_pvp_every : C.pet_every)) {
      e.a = Math.atan2(t.y - e.y, t.x - e.x);   // face the target on the bite
      e.lastAtk = now; e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; f["7"] = 34;
      const d = kdef(world, e.sp, e.stage), dmg = (t.kind === "player" ? C.pet_pvp_dmg : e.primary || e.starter ? C.pet_dmg : Math.max(C.pet_dmg, d.dmg)) * (e.primary || e.starter ? petScale(e.sp, e.stage, "dmg") : 1) * petBoost(e);
      petBite(world, t, Math.round(dmg * C.ob_dmg_mult), e);
    }
  } else if (!e.stay) {
    // TIO_PET_AI_V2 (on unless "0"): base capture owned wolf with the client's compact-move decode (one-byte x/y are
    // offsets: 128..255 last + (v - 128), 0..127 last - v): owner still: distance q10/q50/q90 184/275/432, pet speed ~70;
    // owner moving: pet speed ~70 under 350, 105 at 350..400, 131 at 400..450, 195 at 450..500, 245 past 500
    const V2 = process.env.TIO_PET_AI_V2 !== "0", walkD = V2 ? C.pet_follow_start : C.pet_walk_dist, stopD = V2 ? C.pet_follow_stop : C.pet_walk_dist - 20;
    if (V2 && (dOwn > walkD || (e.follow && dOwn > stopD))) { e.follow = true; e.sh = null; petWalk(world, e, oe.x, oe.y, petRun(e), dt, stopD, now); }   // runs flat out from 430 until 300
    else if (V2) { e.follow = false; idleShuffle(world, e, oe, now, dt); }
    else if (dOwn > C.pet_sprint_dist) moveToward(world, e, oe.x, oe.y, Math.min(C.pet_sprint, C.pet_run + (dOwn - C.pet_sprint_dist) * 2), dt, stopD);
    else if (dOwn > C.pet_run_dist) moveToward(world, e, oe.x, oe.y, C.pet_run, dt, stopD);
    else if (dOwn > walkD) moveToward(world, e, oe.x, oe.y, C.walk, dt, stopD);
  }
  const x1 = Math.round(e.x), y1 = Math.round(e.y), a1 = ang255(e.a);
  if (x1 !== x0 || y1 !== y0) { f["3"] = x1; f["4"] = y1; }
  if (a1 !== a0) f["5"] = a1;
  if (Object.keys(f).length) world.touch(e, f);
}
function removePets(world, p) {
  p.riding = false; if (p.cf) p.cf["16"] = 0;
  const L = S(world).byOwner.get(p.n); if (!L) return;
  for (const e of [...L]) dropPet(world, e, true);
}
// owner death: the pets get {7: 18} in the death frame and are removed one tick after the owner (afterDeath)
function deathPets(world, p) {
  p.riding = false; if (p.cf) p.cf["16"] = 0;
  const st = S(world), L = st.byOwner.get(p.n); if (!L) return;
  for (const e of [...L]) {
    dropPet(world, e, false);
    e.dead = true; e.dying = true; e.ownerDead = true; e.dieAt = now0(world) + C.pet_owner_death_ms;
    world.touch(e, { "7": 18 });
    st.dying.add(e);
  }
}

// ------------------------------------------------------------ taming (JSON 45) and pet commands (JSON 48)
function startTame(world, p, id) {
  const e = world.ents.get(id), now = now0(world);
  if (!p.alive || !p.ent || !e || e.kind !== "animal" || e.plug !== "creatures" || e.st === "dying" || e.st === "taming") return;
  if (dist(e, p.ent) > C.tame_dist) return;
  const extra = EXTRA_SP.has(e.sp);   // owner: 3 slot pets + 3 extra (statue / shadow / gaze) pets
  if (petsOf(world, p).filter((q) => !q.inv && EXTRA_SP.has(q.sp) === extra).length >= (extra ? C.pet_extra_max : C.pet_max)) {   // owner: say why instead of nothing
    if (!(p.tameFullSaid > now) && typeof p.say === "function") { p.tameFullSaid = now + 3000; p.say("Your " + (extra ? C.pet_extra_max + " extra pet" : C.pet_max + " pet") + " slots are full: release a pet to tame another"); }
    return;
  }
  if ((e.stage | 0) !== 0 && !(e.s7 & 64) && !C.tame_any_stage && !p.god) return;   // babies, or (owner) any sleeping creature; /admin: any
  e.st = "taming"; e.tamer = p; e.tameAt = now + C.tame_ms; e.tgt = null;
  world.touch(e, { "12": 1 });
  world.L({ k: "tame_start", room: world.name, n: p.n, species: e.sp, name: spName(e.sp) });
}
function cancelTame(world, e) {
  if (e.tamer && e.tamer.sb) e.tamer.sb.sbu = (e.tamer.sb.sbu || 0) + 1;
  e.st = "wander"; e.tamer = null;
  world.touch(e, { "12": 0 });
}
function finishTame(world, e) {
  const p = e.tamer, st = S(world), d = kdef(world, e.sp, e.stage);
  const base = C.tame_chance != null ? C.tame_chance : SHADOWS.some((q) => q[0] === e.sp) ? C.shadow_tame : e.sirenBaby ? C.siren_baby_tame : d.tame / 100;
  const chance = p && p.god ? 1 : Math.min(1, (base + (e.tameBonus || 0)) * ((p && p.mods && p.mods.tame_mult) || 1));   // Tamer's Cap; Appletor apples; /admin: always
  if (Math.random() >= chance) {   // failed: it wakes up and attacks the tamer
    cancelTame(world, e);
    if (e.s7 & 64) { e.s7 = 2; e.wake7 = 2; world.touch(e, { "7": 2 }); }
    e.angry = true; e.hiveBaby = false; e.sleepAt = 0;   // a failed tame turns even a baby aggressive (real taming)
    if (p.ent) { e.tgt = p.ent; e.st = "chase"; }
    world.L({ k: "tame_fail", room: world.name, n: p.n, species: e.sp, chance });
    return;
  }
  st.wild.delete(e);
  world.removeEnt(e.id);
  const pet = spawnPet(world, p, { id: e.id, ck: e.ck, sp: e.sp, stage: e.stage | 0, x: e.x, y: e.y });
  if (!pet) return;
  pet.a = e.a; pet.hp = Math.min(pet.max, Math.max(1, e.hp)); pet.mode = 1;
  p.queue({ "1": T_OWNINFO, i: pet.id, n: pet.sp, ag: 0, mi: 0, h: 0 });
  p.queue({ "1": T_COUNTER, o: 1, n: pet.sp });
  if (world.ext.social && typeof world.ext.social.count === "function") world.ext.social.count(p, 3);
  if (p.sb) p.sb.sbt = (p.sb.sbt || 0) + 1;
  world.L({ k: "tame_done", room: world.name, n: p.n, species: e.sp, name: spName(e.sp), id: e.id });
}
// S: 0 attack (hunts wild creatures near the owner), 1 defense (default: fights what attacks the owner or the pet),
// 2 stop (no fighting), 3 target (fights what the owner hits), 4 cast the skill (one shot, reload per stage)
// right-click (headless Chrome, client JSON 48 S 3 with _: [x, y] the clicked spot and T the entity under the cursor):
// every owned pet goes there (A* through moveToward); an enemy or wild creature under the cursor becomes its target
function petGoTo(world, p, m) {
  const xy = Array.isArray(m._) ? m._ : null, T = typeof m.T === "number" ? world.ents.get(m.T) : null;
  const me = petsOf(world, p)[0] || { owner: p, kind: "pet" };
  let tgt = T && (T.kind === "animal" || ((T.kind === "player" || T.kind === "pet") && !friendly(world, me, T) && T !== p.ent)) ? T : null;
  // a building under the cursor (T, or the clicked spot inside one): the pet bites it; own, team, gold and world boss
  // buildings are not targets, the pet just walks there in a straight line
  let B = T && T.kind === "placed" ? T : null;
  if (!B && !tgt && xy) for (const o of world.solidsNear(+xy[0], +xy[1], [])) if (o.kind === "placed" && !o.dying && Math.hypot(o.x - xy[0], o.y - xy[1]) <= world.buildR(o.name, o.cd)) { B = o; break; }
  if (!tgt && B && petBreakable(world, B, me)) tgt = B;
  for (const e of petsOf(world, p)) {
    if (e.dead || e.rider || (typeof m.I === "number" && e.id !== m.I)) continue;
    e.anchor = null; e.ordered = true; e.pw = null;   // owner: a right-click order may bite through own structures
    if (tgt) { e.tgt = tgt; e.goto = null; }
    else if (xy && isFinite(xy[0]) && isFinite(xy[1])) { e.goto = { x: +xy[0], y: +xy[1] }; e.tgt = null; }
    e.s7 = 34; e.flagUntil = now0(world) + C.atk_flag_ms; world.touch(e, { "7": 34 });
  }
}
function petCommand(world, p, I, mode, m) {
  world.L({ k: "pet_cmd", room: world.name, n: p.n, m: JSON.stringify(m).slice(0, 200) });   // what the client sends (shift: all pets)
  if (mode === 3 && m) { petGoTo(world, p, m); return; }
  const L = petsOf(world, p), e = L.find((q) => q.id === I) || null;
  if (!e || !(mode >= 0 && mode <= 4)) return;
  if (mode === 4) {   // live capture 20261018_125257: the cast carries the aim point {A, B}; the skill faces it (area skills land there, max 500 away)
    if (m && isFinite(m.A) && isFinite(m.B)) e.aim = { x: +m.A, y: +m.B }; else e.aim = null;
    castSkill(world, e); return;
  }
  e.mode = mode; e.ordered = false;
  e.goto = null; e.anchor = mode === 2 ? { x: e.x, y: e.y } : null;   // client buttons: 0 attack, 1 defense (recall), 2 stop (stay here)
  if (mode === 2) { e.tgt = null; e.s7 = 2; world.touch(e, { "7": 2 }); }
  else { e.s7 = 34; e.flagUntil = now0(world) + C.atk_flag_ms; world.touch(e, { "7": 34 }); }
}

// ------------------------------------------------------------ projectiles and turrets
function petSkill(world, e) {
  const d = kdef(world, e.sp, e.stage);
  return d.skill;
}
function castSkill(world, e) {
  if (e.koUntil > now0(world)) return false;   // knocked out by gloves: the skill is blocked
  if (e.kind === "pet" && EXTRA_SP.has(e.sp)) return false;   // owner: extra pets have no ultimate
  if (e.inv) {
    const now = now0(world), U = e.inv.ult;
    if (e.dead || now - e.lastCast < U.reload * C.reload_scale || e.castUntil > now) return false;
    e.lastCast = now; e.castAt = now + C.cast_delay_ms; e.castUntil = e.castAt + (U.kind === "crown" ? U.life : 600);
    e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
    world.L({ k: "pet_skill", room: world.name, n: e.owner.n, pet: e.id, species: e.sp, name: U.name });
    return true;
  }
  const now = now0(world), sk = petSkill(world, e);
  const om = e.owner && e.owner.mods, cut = om && om.magician ? Math.min(50000, Math.floor((now - e.lastCast) / 5000) * 1000) : 0;   // Magician Hat
  if (!sk || e.dead || now - e.lastCast < sk.every * C.reload_scale - cut || e.castUntil > now) return false;
  e.lastCast = now; e.castAt = now + C.cast_delay_ms; e.castUntil = e.castAt + sk.life;
  e.s7 = 34; e.flagUntil = now + C.atk_flag_ms; world.touch(e, { "7": 34 });
  world.L({ k: "pet_skill", room: world.name, n: e.owner.n, pet: e.id, species: e.sp, a: e.stage });
  return true;
}
// fire a started cast: the effect is created where the pet is (seen by every viewer) and the first hit lands at once
function fireDue(world, e, now) {
  e.castAt = 0;
  if (!world.ents.has(e.id)) return;
  const before = S(world).proj.size;
  const hits = e.inv ? castInvented(world, e, now) : castFire(world, e, now);
  if (e.sp === C.raptor_sp && e.stage === 2 && e.owner) {   // owner: a boss Giant Mantis's Raptorial Daggers turn the owner's daggers for a while
    e.owner.raptorUntil = now + C.raptor_ms;
    e.owner.raptorLvl = Math.min(3, petsOf(world, e.owner).filter((q) => q.sp === C.raptor_sp && q.stage === 2 && !q.dead).length);
  }
  const fxs = [...S(world).proj].filter((q) => q.src === e && q.born === now);
  const V = world.P.view_create || [1370, 933];
  let viewers = 0;
  for (const q of world.players.values()) if (fxs.some((f) => Math.abs(f.x - q.x) < V[0] && Math.abs(f.y - q.y) < V[1])) viewers++;
  world.L({ k: "pet_cast", room: world.name, n: e.owner.n, pet: e.id, species: e.sp, effects: fxs.map((f) => f.f["7"]), created: S(world).proj.size - before, viewers, hits });
}
// owner: a tower throws the ball of the fairy of its type exactly like that fairy (boss stage): same effect kind, first hit,
// damage over time and radius (aoeTick), flying from src to the target dd away along a and bursting there;
// o.life: the field's life in ms instead of the skill's (invented fairy staffs, world.js staffCast)
function fairyBall(world, src, sp, owner, a, dd, o) {
  const sk = petSkill(world, { sp, stage: 2 }); if (!sk || !owner) return null;
  const d = kdef(world, sp, 2), now = now0(world), fly = Math.max(100, dd / C.fairy_ball_speed * 1000);
  const adm = sk.adm || Math.max(10, 2 * (d.dmg || 5)), pdmg = sk.dmg || Math.max(5, d.dmg || 5);
  const pr = spawnProj(world, { k: sk.k[0], x: src.x, y: src.y, a, speed: C.fairy_ball_speed, life: ((o && o.life) || sk.life) + fly, dmg: 0, src, hostile: "none", f8: 2,
    aoe: { r: C.skill_r, pdmg, pdot: sk.dot, adm, adot: sk.adot, owner, ty: typesOf(sp), pass: !!(o && o.pass) } });
  pr.stopAt = now + fly; pr.nextTick = o && o.pass ? now : now + fly;   // pass (staffs): hits everything along its flight too
  return pr;
}
// fairy ball status effects (wiki skill text; towers inherit them through fairyBall): Ice Ball freezes, Lightning Ball
// paralyzes (both stop the target, with the client freeze-effect 198 / paralysis-effect 197 on it, on the first hit),
// Vortex Ball slows (Slowdown 10 %) every tick it holds the target, Plant Ball drains (Vampirism: the caster heals what it
// deals per hit). Durations and the drain amount: guess. Slows reach wild creatures and players (pets do not read slowUntil)
// owner: the elements keep hurting after the target leaves the ball (wiki: Fire Ball devastating, Dragon Ball enormous damage
// over time, Poisoned Ball very dangerous poison, Butterfly Ball damage over time + reduced visibility, read as a slow), on
// players, creatures and pets alike: dot = n ticks of p (players) / a (creatures, pets) every ms after the first hit, one
// running per element per target (a new hit while it runs does not stack it); Punch Ball knocks back (push x knockback_peak);
// Water Ball heals (wiki Heal Over Time) the caster's player and pets inside it by heal a tick; Plant Ball's drain also heals a
// player caster (staffs) and a Plant Tower itself (its hp byte by its wiki durability), once a tick. The dots show the
// client burn-effect 196 / poison-effect 194 / butterfly-effect 180 on the target, healing heal-effect 203. Tick counts, amounts
// and the push: guess
// wiki Status Effects: Frozen = basically unable to move (owner: 90 % slower, 1.5 s), Paralyzed = a slight slowdown and a tiny
// bit of damage over time (it no longer stops the target)
const FAIRY_STATUS = { 131: { stop_ms: 1500, stop_factor: 0.1, fx: 198 }, 119: { slow: 0.9, slow_ms: 400 }, 116: { drain: 3 },
  120: { slow: 0.8, slow_ms: 2000, dot: { n: 4, ms: 500, p: 1, a: 2, fx: 197 } },
  122: { dot: { n: 4, ms: 500, p: 2, a: 4, fx: 196 } }, 123: { dot: { n: 5, ms: 500, p: 2, a: 4, fx: 196 } }, 118: { dot: { n: 6, ms: 500, p: 2, a: 4, fx: 194 } },
  117: { dot: { n: 4, ms: 500, p: 1, a: 2, fx: 180 }, slow: 0.8, slow_ms: 1500 }, 129: { push: 1.5 }, 126: { heal: 2 }, 130: { repair: 20 } };
function fairyStatus(world, e, ST, holder, ent, first, now) {
  if (first && ST.stop_ms) {
    holder.slowUntil = now + ST.stop_ms; holder.slowFactor = ST.stop_factor != null ? ST.stop_factor : 0;
    if (ST.fx) fx(world, ST.fx, ent.x, ent.y, ST.stop_ms, ent);   // the client sticks a status effect on its src entity (10 / 11): the target, not the caster
  }
  if (ST.slow) {   // never weakens a stronger hold (a freeze) still running
    if (!(holder.slowUntil > now && holder.slowFactor < ST.slow)) holder.slowFactor = ST.slow;
    holder.slowUntil = Math.max(holder.slowUntil || 0, now + ST.slow_ms);
  }
  if (ST.drain && e.src && e.src.kind === "pet" && !e.src.dead && e.src.hp < e.src.max) {
    e.src.hp = Math.min(e.src.max, e.src.hp + ST.drain);
  }
  if (ST.drain && e.src && e.src.kind === "player" && e.src.p && e.drained !== now) { e.drained = now; healPlayer(e.src.p, ST.drain); }   // once a tick
  if (ST.drain && e.src && e.src.kind === "placed" && !e.src.dying && e.src.hp < 255 && e.drained !== now) {   // Plant Tower
    e.drained = now;
    const it = world.ctx.ITEMS[e.src.item], dur = (it && world.P.wiki_durability && world.P.wiki_durability[it.name]) || world.P.repair_durability_default || 1000;
    e.src.hp = Math.min(255, e.src.hp + Math.max(1, Math.round(ST.drain * 255 / dur))); world.touch(e.src, { "7": e.src.hp });
  }
  if (first && ST.dot) {
    const D = ST.dot, k = e.f["7"], dots = holder.fairyDots || (holder.fairyDots = {});
    if (!(dots[k] > now)) {
      dots[k] = now + D.n * D.ms;
      if (D.fx) fx(world, D.fx, ent.x, ent.y, D.n * D.ms, ent);
      const ty = ATK_TY;   // the ball's fairy types (typeMul) for the ticks that run after aoeTick
      for (let i = 1; i <= D.n; i++) world.after(i * D.ms, () => {
        if (ent.kind === "player") { if (ent.p && ent.p.alive) hit(world, ent, D.p, e.src); }
        else if (!ent.dying && !ent.dead && world.ents.has(ent.id)) { ATK_TY = ty; try { world.damage(ent, D.a, e.src); } finally { ATK_TY = null; } }
      });
    }
  }
  if (first && ST.push && !ent.worldBoss && !ent.rider) {
    const a = Math.hypot(ent.x - e.x, ent.y - e.y) > 40 ? Math.atan2(ent.y - e.y, ent.x - e.x) : e.a, v = (world.P.knockback_peak || 70) * ST.push * 1000 / (world.P.send_ms || 94);
    if (ent.kind === "player" && ent.p) ent.p.kb = { vx: Math.cos(a) * v, vy: Math.sin(a) * v };
    else if (world.blasted) { ent.blastKb = [Math.cos(a) * v, Math.sin(a) * v]; world.blasted.add(ent); }
  }
}
function healPlayer(p, n) {
  const max = (p.P && p.P.max_hp) || 100;
  if (!p.alive || !(p.hp < max)) return;
  const b = p.hp; p.hp = Math.min(max, p.hp + n); p.pending["11"] = Math.round(p.hp - b); p.pending["12"] = Math.round(p.hp);
}
// the fairies' skill balls (client kinds plantball 116, butterflyball 117, poisonedball 118, vortexball 119, lightningball 120,
// fireball 122, dragon-ball 123, rock-ball 125, waterball 126, punchball 129, repairball 130, iceball 131)
const FAIRY_BALLS = new Set([116, 117, 118, 119, 120, 122, 123, 125, 126, 129, 130, 131]);
function castFire(world, e, now) {
  const sk = petSkill(world, e); if (!sk) return 0;
  const d = kdef(world, e.sp, e.stage);
  const pb = petBoost(e), adm = (sk.adm || Math.max(10, 2 * (d.dmg || 5))) * pb, pdmg = (sk.dmg || Math.max(5, d.dmg || 5)) * pb;   // never a silent cast; hat / wing boosts
  let hits = 0, sx = e.x, sy = e.y, fly = 0;
  // owner: a fairy's ball flies from the fairy to its target (aim, else the enemy it fights) and bursts there
  const ball = !sk.speed && FAIRY_BALLS.has(sk.k[0]);
  if (!e.aim && ball && e.tgt && !e.tgt.dead && world.ents.has(e.tgt.id)) e.aim = { x: e.tgt.x, y: e.tgt.y };
  if (e.aim) {
    e.a = Math.atan2(e.aim.y - e.y, e.aim.x - e.x);
    const dd = Math.min(500, Math.hypot(e.aim.x - e.x, e.aim.y - e.y));
    if (ball) fly = Math.max(100, dd / C.fairy_ball_speed * 1000);
    else if (!sk.speed) { sx = e.x + Math.cos(e.a) * dd; sy = e.y + Math.sin(e.a) * dd; }
    e.aim = null;
  }
  sk.k.forEach((k, i) => {
    const W = sk.follow ? C.wolf_ult : null;
    const atPet = sk.at_pet && sk.at_pet.indexOf(k) >= 0;
    const pr = spawnProj(world, { k, x: atPet ? e.x : sx, y: atPet ? e.y : sy, a: e.a, speed: fly ? C.fairy_ball_speed : sk.speed, life: sk.life + fly, dmg: 0, src: e, hostile: "none", f8: e.stage,
      aoe: i === 0 ? { r: W ? W.r : C.skill_r, pdmg, pdot: sk.dot, adm, adot: sk.adot, owner: e.owner, follow: !!W, once: W } : null });
    if (fly) { pr.stopAt = now + fly; if (pr.aoe) pr.nextTick = now + fly; }
    else if (pr.aoe && W) pr.nextTick = now + W.hit_ms;
    else if (pr.aoe) { pr.nextTick = now + (pr.aoe.tick || C.skill_tick_ms); hits += aoeTick(world, pr, now); }
  });
  return hits;
}
// skill area: first tick deals the hit, later ticks the damage over time, to wild creatures, other pets and other players
function aoeTick(world, e, now) {
  ATK_TY = (e.aoe && e.aoe.ty) || null;
  try { return aoeTick0(world, e, now); } finally { ATK_TY = null; }
}
function aoeTick0(world, e, now) {
  const A = e.aoe, first = !e.ticked; e.ticked = true;
  let hits = 0;
  if (A.kind === "crown" || A.kind === "snare") {   // invented ultimates
    const src = e.src, own = A.owner, ownPets = S(world).byOwner.get(own.n) || [];
    const cx = A.kind === "crown" && src && !src.dead ? src.x : e.x, cy = A.kind === "crown" && src && !src.dead ? src.y : e.y;
    const until = now + 900;
    for (const w of [...S(world).wild]) if (!w.dying && Math.hypot(w.x - cx, w.y - cy) < A.r) {
      hits++;
      if (A.adm) world.damage(w, A.adm, src);
      if (A.kind === "snare") { w.slowUntil = until; w.slowFactor = A.slow; }
      else fx(world, 45, w.x, w.y, 400, src);
    }
    for (const pt of [...S(world).pets]) if (!pt.dead && ownPets.indexOf(pt) < 0 && !friendly(world, src || own, pt) && Math.hypot(pt.x - cx, pt.y - cy) < A.r && A.adm) { world.damage(pt, A.adm, src); hits++; }
    for (const q of world.players.values()) {
      if (q === own || !q.alive || !q.ent || friendly(world, own, q) || Math.hypot(q.ent.x - cx, q.ent.y - cy) >= A.r) continue;
      hits++;
      if (A.pdmg) hit(world, q.ent, A.pdmg, src);
      if (A.kind === "snare") { q.slowUntil = until; q.slowFactor = A.slow; }
    }
    if (A.kind === "crown") { e.x = cx; e.y = cy; world.touch(e, { "3": Math.round(cx), "4": Math.round(cy) }); }
    return hits;
  }
  const own = A.owner, ownPets = S(world).byOwner.get(own.n) || [];
  if (A.once) {
    if (!first) {
      for (const b of e.burns || []) if (b.left > 0) { b.left--; const t = b.t; if (t.kind === "player" && t.p) { if (t.p.alive && A.pdot) hit(world, t, A.pdot, e.src); } else if (!t.dying && !t.dead && A.adot) world.damage(t, A.adot, e.src); }
      return 0;
    }
    e.burns = []; e.aoe.tick = A.once.burn_ms;
    const tg = [];
    for (const w of [...S(world).wild]) if (!w.dying && dist(e, w) < A.r) tg.push([w, A.adm]);
    for (const pt of [...S(world).pets]) if (!pt.dead && ownPets.indexOf(pt) < 0 && !friendly(world, e.src || own, pt) && dist(e, pt) < A.r) tg.push([pt, A.adm]);
    for (const q of world.players.values()) if (q !== own && q.alive && q.ent && !friendly(world, own, q) && dist(e, q.ent) < A.r) tg.push([q.ent, A.pdmg]);
    for (const [t, v] of tg) { if (v) { if (t.kind === "player") hit(world, t, v, e.src); else world.damage(t, v, e.src); } e.burns.push({ t, left: A.once.burn_n }); }
    return tg.length;
  }
  const ST = FAIRY_STATUS[e.f["7"]];
  // pass (staff balls fly through everything): the first hit lands on each target the first time the ball covers it
  const seen = A.pass ? (e.seen || (e.seen = new Set())) : null, fst = (t) => { if (!seen) return first; if (seen.has(t.id)) return false; seen.add(t.id); return true; };
  for (const w of [...S(world).wild]) if (!w.dying && dist(e, w) < A.r) { hits++; const f1 = fst(w), v = f1 ? A.adm : A.adot; if (v) world.damage(w, v, e.src); if (ST) fairyStatus(world, e, ST, w, w, f1, now); }
  for (const pt of [...S(world).pets]) if (!pt.dead && ownPets.indexOf(pt) < 0 && !friendly(world, e.src || own, pt) && dist(e, pt) < A.r) { hits++; const f1 = fst(pt), v = f1 ? A.adm : A.adot; if (v) world.damage(pt, v, e.src); if (ST) fairyStatus(world, e, ST, pt, pt, f1, now); }
  for (const q of world.players.values()) {
    if (q === own || !q.alive || !q.ent || friendly(world, own, q) || dist(e, q.ent) >= A.r) continue;
    hits++; const f1 = fst(q.ent), v = f1 ? A.pdmg : A.pdot; if (v) hit(world, q.ent, v, e.src); if (ST) fairyStatus(world, e, ST, q, q.ent, f1, now);
  }
  if (ST && ST.heal && own) {   // Water Ball: the caster's side inside it heals (owner: teammates and their pets too, like the real Water fairy ultimate)
    for (const q of world.players.values()) {
      if (!q.alive || !q.ent || (q !== own && !friendly(world, own, q))) continue;
      if (dist(e, q.ent) < A.r) healPlayer(q, ST.heal);
      for (const pt of S(world).byOwner.get(q.n) || []) if (!pt.dead && pt.hp < pt.max && dist(e, pt) < A.r) { pt.hp = Math.min(pt.max, pt.hp + ST.heal); world.touch(pt, { "9": Math.round(pt.hp / pt.max * 255) }); }
    }
  }
  if (ST && ST.repair && own && e.repaired !== now) {   // Repair Ball: only the caster's own and his teammates' buildings (friendly), never an enemy's
    e.repaired = now;
    for (const o of world.solidsNear(e.x, e.y, [])) {
      if (o.kind !== "placed" || o.dying || o.owner == null || !(o.hp < 255) || dist(e, o) >= A.r || !friendly(world, own, o)) continue;
      const it = world.ctx.ITEMS[o.item], dur = (it && world.P.wiki_durability && world.P.wiki_durability[it.name]) || world.P.repair_durability_default || 1000;
      o.hp = Math.min(255, o.hp + Math.max(1, Math.round(ST.repair * 255 / dur))); world.touch(o, { "7": o.hp });
    }
  }
  return hits;
}
function spawnProj(world, o) {
  const st = S(world), id = world.nextId(), now = now0(world);
  const src = o.src, sid = src ? src.id : 0;
  const e = { id, kind: "projectile", x: o.x, y: o.y, a: o.a, speed: o.speed, until: now + o.life, dmg: o.dmg, src, hostile: o.hostile, hit: new Set(), cd: 0, plug: "creatures",
    aoe: o.aoe || null, nextTick: now, born: now,
    f: { "0": id, "1": T_CREATE, "2": 4, "6": 1, "7": o.k, "8": o.f8 != null ? o.f8 : 2, "9": 0, "10": sid, "11": sid } };
  e.create = () => Object.assign({}, e.f, { "3": Math.round(e.x), "4": Math.round(e.y), "5": ang200(e.a) });
  world.addEnt(e); st.proj.add(e);
  return e;
}
function stepProj(world, e, now, dt) {
  if (now >= e.until) { S(world).proj.delete(e); world.removeEnt(e.id); return; }
  if (e.stopAt && now >= e.stopAt) { e.speed = 0; e.stopAt = 0; }   // a fairy ball stops where it bursts
  if (e.speed) {
    e.x += Math.cos(e.a) * e.speed * dt; e.y += Math.sin(e.a) * e.speed * dt;
    world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) });
  }
  if (e.aoe && e.aoe.follow && e.src && !e.src.dead && world.ents.has(e.src.id) && (e.x !== e.src.x || e.y !== e.src.y)) {
    e.x = e.src.x; e.y = e.src.y; world.touch(e, { "3": Math.round(e.x), "4": Math.round(e.y) });
  }
  if (e.aoe && now >= e.nextTick) { e.nextTick = now + (e.aoe.tick || C.skill_tick_ms); aoeTick(world, e, now); }
  if (e.hostile === "vs") { vsProjHit(world, e); return; }
  if (!e.dmg || e.hostile !== "players") return;
  for (const p of world.players.values()) {
    const pe = p.ent; if (!pe || !p.alive || e.hit.has(pe.id)) continue;
    if (dist(e, pe) < C.proj_hit_r) { e.hit.add(pe.id); hit(world, pe, e.dmg, e.src || e); }
  }
  for (const pt of S(world).pets) if (!pt.dead && !e.hit.has(pt.id) && dist(e, pt) < C.proj_hit_r) { e.hit.add(pt.id); world.damage(pt, e.dmg, e.src || e); }
}
function turretDmg(name) {
  for (const [k, v] of Object.entries(C.turret_dmg)) if (name.indexOf(k) === 0) return v;
  return 12;
}
function stepTurrets(world, now) {
  const st = S(world);
  if (now - st.turretScan >= 1000) {
    st.turretScan = now; st.turrets = [];
    for (const e of world.ents.values()) if (e.kind === "placed" && e.name && e.name.indexOf("turret") >= 0) st.turrets.push(e);
  }
  for (const t of st.turrets) {
    if (!world.ents.has(t.id) || t.ownerGone || now - (t.lastShot || 0) < C.turret_every) continue;   // a left player's turrets stay quiet
    let best = null, bd = C.turret_range;
    for (const w of st.wild) { if (w.st === "dying") continue; const q = dist(t, w); if (q < bd) { bd = q; best = w; } }
    for (const p of world.players.values()) {
      const pe = p.ent; if (!pe || !p.alive || p.n === t.owner || p.shieldUntil > now || friendly(world, t, pe)) continue;
      const q = dist(t, pe); if (q < bd) { bd = q; best = pe; }
    }
    if (!best) continue;
    t.lastShot = now;
    const a = Math.atan2(best.y - t.y, best.x - t.x);
    world.touch(t, { "5": ang255(a), "9": 17 });
    // owner: the cannonball flies from the muzzle to the target (moved each tick by world.flying) and hits on arrival
    const id = world.nextId(), sx = t.x + Math.cos(a) * 60, sy = t.y + Math.sin(a) * 60, fly = Math.max(C.turret_flash_ms, Math.max(0, bd - 60) / C.turret_speed * 1000);
    const fx = { id, kind: "effect", x: sx, y: sy, cd: 0, vx: Math.cos(a) * C.turret_speed, vy: Math.sin(a) * C.turret_speed, until: now + fly,
      f: { "0": id, "1": T_CREATE, "2": 2, "6": 1, "7": 9 } };
    fx.create = () => Object.assign({}, fx.f, { "3": Math.round(fx.x), "4": Math.round(fx.y), "5": ang200(a) });
    world.addEnt(fx); world.flying.add(fx);
    const tgt = best, dmg = turretDmg(t.name);
    world.after(fly, () => { if (world.ents.has(tgt.id) && !tgt.dying) hit(world, tgt, dmg, t); });
  }
}

// ------------------------------------------------------------ biome switch
function biomeSwitch(world, oldPhase, newPhase) {
  const st = S(world), now = now0(world);
  for (const e of [...st.wild]) {
    if (e.surviveSwitch > 0) { e.surviveSwitch--; continue; }   // a baby Genie lives through one season change
    if (e.st === "taming" && e.tamer) { e.tamer = null; }
    e.st = "dying"; e.dying = true; e.s7 = 18; e.tgt = null; e.dieAt = now + C.biome_die_ms;
    if (e.boss && world.boss && world.boss.kind === e.sp) world.boss = null;
    world.touch(e, { "7": 18, "9": 0, "10": 400 });
    st.wild.delete(e); st.dying.add(e);
  }
  st.respawn = [];
  spawnPhase(world, newPhase);
  world.L({ k: "creatures_biome", room: world.name, from: oldPhase, to: newPhase, n: st.wild.size });
}

// drop per-player entries whose player is gone, whatever the hook order
function prune(world) {
  const st = S(world), live = world.players;
  for (const n of [...st.prevHeld.keys()]) if (!live.has(n)) st.prevHeld.delete(n);
  for (const [n, L] of [...st.byOwner]) if (!live.has(n)) { for (const e of [...L]) dropPet(world, e, true); st.byOwner.delete(n); }
  for (const e of st.wild) if (e.calm) { for (const n of [...e.calm.keys()]) if (!live.has(n) || e.calm.get(n) < now0(world)) e.calm.delete(n); if (!e.calm.size) e.calm = null; }
}
// drop every per-player entry (player left)
function forget(world, p) {
  const st = S(world);
  st.byOwner.delete(p.n); st.prevHeld.delete(p.n);
  for (const e of st.wild) if (e.calm) { e.calm.delete(p.n); if (!e.calm.size) e.calm = null; }
  for (const e of st.wild) if (e.tgt && e.tgt.p === p) { e.tgt = null; e.st = "home"; }
}
// ------------------------------------------------------------ plugin hooks
module.exports = {
  name: "creatures",
  replaces: ["animals"],
  KINDS, C, SOURCES, INVENTED, HELP_LINES, BOSS_PETS, _spawnPhase: spawnPhase, _nav: { astar, los, solidAt, NAV, ASTAR },
  fairyBall(world, src, sp, owner, a, dd, o) { return fairyBall(world, src, sp, owner, a, dd, o); },
  typesOf(sp) { return typesOf(sp); },
  typeMul(world, src, tgt) { return typeMul(world, src, tgt); },
  stats(world) {
    const st = world.ext && world.ext.creatures;
    if (!st) return null;
    let riding = 0, owners = 0, calm = 0;
    for (const e of st.pets) if (e.rider) riding++;
    for (const L of st.byOwner.values()) if (L.length) owners++;
    for (const e of st.wild) if (e.calm) calm += e.calm.size;
    return { wild: st.wild.size, pets: st.pets.size, dying: st.dying.size, projectiles: st.proj.size, effects: st.fx.size,
      turrets_active: st.turrets.length, respawn_queue: st.respawn.length, riding, by_owner: st.byOwner.size, owners_with_pets: owners,
      prev_held: st.prevHeld.size, calm_entries: calm, phase: st.phase };
  },
  attach(world) {
    world.ext.creatures = { wild: new Set(), pets: new Set(), dying: new Set(), proj: new Set(), fx: new Set(), byOwner: new Map(),
      respawn: [], turrets: [], prevHeld: new Map(), turretScan: 0, phase: world.phase, tickN: 0 };
    if (!world.__typeDmg) {   // type advantages on every hit an animal / pet / fairy ball lands on an animal or pet (typeMul)
      const d0 = world.damage.bind(world); world.__typeDmg = true;
      world.damage = (t, v, by) => d0(t, v > 0 ? Math.max(1, Math.round(v * typeMul(world, by, t))) : v, by);
    }
    if (!world.__artTouch) {   // every state update of a world-boss body goes out with its boss bit (artState)
      const t0 = world.touch.bind(world); world.__artTouch = true;
      world.touch = (o, f) => (o && o.bossArt && f && typeof f["7"] === "number" && (f["7"] & 2) ? t0(o, Object.assign({}, f, { "7": f["7"] - 1 })) : t0(o, f));
    }
    spawnPhase(world, world.phase || 0);
    world.L({ k: "creatures_attach", room: world.name, phase: world.phase, n: S(world).wild.size });
  },
  tick(world, now, dtMs) {
    const st = S(world); if (!st) return;
    now = now || now0(world);
    const dt = Math.min(0.5, (dtMs || 94) / 1000);
    st.tickN++;
    if (world.phase !== st.phase && world.phase != null) biomeSwitch(world, st.phase, world.phase);
    for (const e of [...st.dying]) if (now >= e.dieAt) { st.dying.delete(e); world.removeEnt(e.id); }
    for (const fx of [...st.fx]) if (now >= fx.until) { st.fx.delete(fx); world.removeEnt(fx.id); }
    if (st.vs) vsTick(world, now);
    if (st.tickN % 5 === 0) auraTick(world, now);
    if (st.restart) restartTick(world, now);
    if (st.respawn.length && st.tickN % 10 === 0 && !st.vs) {
      const keep = [];
      for (const r of st.respawn) {
        if (r.phase !== st.phase) continue;
        if (now >= r.at) spawnWild(world, r.tpl, r.hx, r.hy, r.phase, true); else keep.push(r);
      }
      st.respawn = keep;
    }
    const pl = [];
    for (const p of world.players.values()) if (p.ent) pl.push(p.ent);
    const W2 = C.wake_dist * C.wake_dist;
    for (const e of [...st.wild]) {
      let awake = false;
      for (const pe of pl) { const dx = pe.x - e.x, dy = pe.y - e.y; if (dx * dx + dy * dy < W2) { awake = true; break; } }
      stepWild(world, e, now, dt, awake);
    }
    for (const p of world.players.values()) if (p.joined && p.alive && p.held != null && !heldSaddle(world, p)) st.prevHeld.set(p.n, p.held);
    if (now - (st.pruned || 0) >= 5000) { st.pruned = now; prune(world); }
    for (const e of [...st.pets]) if (e.castAt && now >= e.castAt) fireDue(world, e, now);   // a started cast always fires
    for (const e of [...st.pets]) stepPet(world, e, now, dt);
    for (const e of [...st.proj]) stepProj(world, e, now, dt);
    stepTurrets(world, now);
    if (!st.vs) try { stepNearBoss(world, now); } catch (e) { world.L({ k: "near_boss_err", err: String(e && e.stack || e).slice(0, 300) }); }
  },
  onJoin(world, p) { this.giveFirstPet(world, p); },
  // the minimap: one [x, y] pair per owned pet in card order (real T_OWNINFO p; [] with no pets)
  minimapPets(world, p) { return petsOf(world, p).filter((q) => !q.dead); },
  onRespawn(world, p) {
    S(world).prevHeld.delete(p.n); this.giveFirstPet(world, p);
    if (p.restartGift) {   // wiki: killed by a Reaper -> 100k gold, 1000 food / wood / stone, age 12 after the restart
      p.restartGift = false; p.inv[0] = (p.inv[0] || 0) + 1000; p.inv[1] = (p.inv[1] || 0) + 1000; p.inv[2] = (p.inv[2] || 0) + 1000; p.inv[3] = (p.inv[3] || 0) + 100000; p.sendInv();
      const want = 20 * 12 * 13 + 1; if (p.xp < want) p.addXp(want - p.xp, "cmd");
      world.L({ k: "restart_gift", n: p.n });
    }
  },
  // the pets picked in the menu (join pi): starters and, with TIO_BOSS_PETS, the invented Stormhorn (156) / Cinder Prowler
  // (157); nothing is forced; no pick: the default pets
  starterList(p) {
    const ok = (k) => (BOSS_PETS && INVENTED[k]) || (SPECIES[k] && !INVENTED[k]);
    const pick = (p.petPick || []).filter(ok).slice(0, 5);
    return pick.length ? pick : BOSS_PETS ? DEFAULT_PETS.filter(ok) : [C.pet_species];
  },
  giveFirstPet(world, p) {
    if (!p.ent) return;
    removePets(world, p);
    const want = p.ent.id + 1, pp = (p.P && p.P.potion_pets) || {}, pick = this.starterList(p).slice();
    const st = [];   // statue potions: each potion adds its statues (duplicates too, e.g. 3 Mend Rock = 3 Water Statues), up to the extra pet cap
    for (const id of p.potPick || []) for (const k of pp[id] || []) if (st.length < (C.pet_extra_max || 3)) st.push(k);
    const nTeam = pick.length;
    pick.push(...st);
    pick.forEach((k, i) => {
      const D = BOSS_PETS && INVENTED[k];
      const q = spawnPet(world, p, D ? { primary: i === 0, sp: k, ck: D.ck, stage: 0, invented: D } : k === C.pet_species && !p.petPick ? { primary: i === 0 } : { primary: i === 0, sp: k, ck: petType(k), starter: true });
      if (!q) return;
      const sk = (p.petSkinPick || []).find((x) => x[0] === k); if (sk && sk[1]) q.skin = sk[1];   // owner: pet skin from the menu
      // menu trinket slots; a potion pet (changelog 0.126: no own slots) inherits the trinkets of the next team slot past
      // the team pets, else of team slot (its index among potion pets) (approximation of "place non-slot pets in your team")
      const rows = p.trinketRows || [], tk = i < nTeam ? (p.trinketPick || []).find((x) => x[0] === k) : null;
      if (tk) TRK.attach(q, tk[1]); else if (i >= nTeam) TRK.attach(q, rows[i] && rows[i].some((x) => x > 0) ? rows[i] : rows[(i - nTeam) % 3]);
      if (i > 0 || q.id !== want) ownInfo(p, q);   // the primary card comes with the join (world.js) when the id lines up
      else if (q.petName) p.queue({ "1": T_OWNINFO, i: q.id, na: q.petName });   // its name (the join card has none)
      if (D) p.queue({ "1": T_OWNINFO, i: q.id, a: q.lvl });
    });
  },
  onEasy(world, p) {
    const L = S(world) && S(world).byOwner.get(p.n);
    if (L) for (const e of L) if (!e.dead) maxPet(world, p, e);
  },
  onDeath(world, p, by) {
    if (by && by.reaper) p.reaperKilled = true;
    deathPets(world, p);
    for (const e of S(world).wild) if (e.tamer === p) cancelTame(world, e);
  },
  afterDeath(world, p) { const now = now0(world); for (const e of S(world).dying) if (e.ownerDead && e.owner === p) e.dieAt = now + 1; },
  onLeave(world, p) {
    removePets(world, p);
    const st = S(world); for (const e of [...st.dying]) if (e.ownerDead && e.owner === p) { st.dying.delete(e); world.removeEnt(e.id); }
    forget(world, p);
    for (const e of S(world).wild) if (e.tamer === p) cancelTame(world, e);
  },
  onJson(world, p, m) {
    // chat commands (chatargs.js parses them the same way as world.js): restart, versus, hive, event, cast, pet, spawn, spawnall, clear
    const r = m.type === 39 && typeof m.msg === "string" ? CA.parse(m.msg) : null;
    const CMD = r && { restart: 1, versus: 1, vs: 1, hive: 1, event: 1, events: 1, cast: 1, pet: 1, spawn: 1, spawnall: 1, clear: 1 }[r.cmd] ? r.cmd : null;
    const say = (t, k, hl) => { if (typeof p.say === "function") p.say(t, k, hl); };
    const cmdLog = (args, ok) => world.L({ k: "cmd", n: p.n, cmd: CMD, args: String(args).slice(0, 60), ok });
    const usage = () => { say(CA.usage(CMD === "vs" ? "versus" : CMD === "events" ? "event" : CMD), "err"); cmdLog(r.rest, false); return true; };
    const noP = () => { if (r.target == null) return false; say("/" + CMD + " does not take -p", "err"); cmdLog(r.rest, false); return true; };
    const lo = r ? r.args.map((x) => x.toLowerCase()) : [];
    if (CMD === "restart") {   // chat /restart [stop]: the server-restart Reapers
      if (noP()) return true;
      if (lo.length > 1 || (lo[0] && !/^(stop|cancel|off|end)$/.test(lo[0]))) return usage();
      if (lo[0]) restartStop(world, false); else restartStart(world, p);
      world.L({ k: "cmd_restart", n: p.n, arg: lo[0] || "" });
      return true;
    }
    if (CMD === "versus" || CMD === "vs") {   // chat /versus [pets|bosses|mobs|epic|player|stop] [-p player: who is hunted in player mode]
      const arg = lo[0] || "";
      if (arg === "stop" || arg === "end" || arg === "off") { if (S(world).vs) { vsEnd(world, true); say("Versus stopped, the world is back", "ok"); } else say("No versus battle running", "err"); return true; }
      if (arg && !VS_ARMIES[arg]) return usage();
      if (r.target != null && arg !== "player") { say("-p only works with /versus player", "err"); cmdLog(r.rest, false); return true; }
      const q = typeof p.target === "function" ? p.target(r) : p; if (!q) { cmdLog(r.rest, false); return true; }
      if (!q.ent) { say(q === p ? "You are dead" : q.name + " is dead", "err"); return true; }
      vsStart(world, q, arg || null);
      if (q !== p) say("Versus player: " + q.name + " is hunted", "ok", [q.name]);
      world.L({ k: "cmd_versus", n: p.n, arg, who: q.n });
      return true;
    }
    if (CMD === "hive") {   // chat /hive: a Hive Creep next to you
      if (noP()) return true;
      if (lo.length) return usage();
      if (!p.ent) { say("You are dead", "err"); return true; }
      const h = spawnHive(world, { x: p.ent.x + 450, y: p.ent.y });
      say(h ? "Hive Creep spawned: break it for a BMB shadow" : "No free spot for a hive here", h ? "ok" : "err");
      cmdLog("", !!h);
      return true;
    }
    if (CMD === "event" || CMD === "events") {   // chat /event <name|list|off>
      if (noP()) return true;
      const arg = CMD === "events" ? "list" : lo[0] || "list", hit = arg === "list" || arg === "off" || arg === "stop" ? arg : EVENTS[arg] ? arg : CA.fuzzy(arg, Object.keys(EVENTS));
      if (hit === "list") say("Events: " + Object.keys(EVENTS).join(", ") + ", off" + (S(world).event ? " (on: " + S(world).event.name + ")" : ""), "reply");
      else if (hit === "off" || hit === "stop") { const n = eventOff(world); say(n ? "Event off" : "No event on", n ? "ok" : "err"); }
      else if (!hit) say("Unknown event \"" + arg + "\": " + Object.keys(EVENTS).join(", "), "err");
      else if (eventOn(world, p, hit)) say("Event " + hit + ": " + EVENTS[hit].note, "event", [hit]);
      world.L({ k: "cmd", n: p.n, cmd: "event", args: arg, ok: !!hit });
      return true;
    }
    if (CMD === "cast") {
      // chat /cast: every own pet casts its skill at the nearest wild creature within 600 (tests)
      if (noP()) return true;
      if (!p.ent) { say("You are dead", "err"); return true; }
      let n = 0;
      for (const e of petsOf(world, p)) {
        if (e.dead) continue;
        let best = null, bd = 600;
        for (const w of S(world).wild) { if (w.dying) continue; const q = dist(e, w); if (q < bd) { bd = q; best = w; } }
        if (world.ext.insects) for (const w of world.ext.insects.bugs) { const q = dist(e, w); if (q < bd) { bd = q; best = w; } }   // insects too (toad tongue)
        e.aim = best ? { x: best.x, y: best.y } : null; e.lastCast = -1e9; e.castUntil = 0;
        if (castSkill(world, e)) n++;
      }
      say(n ? n + " pet" + (n > 1 ? "s" : "") + " cast" : "No pet could cast (no pet, or no creature within 600)", n ? "ok" : "err");
      world.L({ k: "cmd", n: p.n, cmd: "cast", args: String(n), ok: n > 0 });
      return true;
    }
    if (CMD === "pet") {
      // chat /pet <species name|id> [baby|adult|boss] [-p player]: an extra pet of that species at that stage (tests: fairies, gazes, mantis)
      const STG = { baby: 0, adult: 1, boss: 2 }, a = r.args.slice();
      const stage = a.length > 1 && STG[a[a.length - 1].toLowerCase()] != null ? STG[a.pop().toLowerCase()] : 2;
      const want = a.join(" ").toLowerCase();
      if (!want) return usage();
      const names = Object.keys(SPECIES).map((k) => SPECIES[k][0]), nm = SPECIES[want] ? null : CA.fuzzy(want, names);
      const sp = SPECIES[want] ? want : nm != null ? Object.keys(SPECIES).find((k) => SPECIES[k][0] === nm) : null;
      if (sp == null) { say("Unknown pet species \"" + want + "\". " + CA.usage("pet"), "err"); world.L({ k: "cmd", n: p.n, cmd: "pet", args: want, ok: false }); return true; }
      const q = typeof p.target === "function" ? p.target(r) : p; if (!q) { cmdLog(r.rest, false); return true; }
      if (!q.ent) { say(q === p ? "You are dead" : q.name + " is dead", "err"); return true; }
      const pt = spawnPet(world, q, { sp: +sp, ck: petType(+sp), stage });
      if (pt) ownInfo(q, pt);
      const what = SPECIES[sp][0] + " (" + ["baby", "adult", "boss"][stage] + ")";
      if (pt) { say((q === p ? "New pet: " : "Gave " + q.name + " a pet: ") + what, "ok", q === p ? null : [q.name]); if (q !== p && q.say) q.say(p.name + " gave you a pet: " + what, "ok", [p.name]); }
      else say("No room for another pet", "err");
      world.L({ k: "cmd", n: p.n, cmd: "pet", args: want + " " + stage + (q !== p ? " -p " + q.name : ""), ok: !!pt });
      return true;
    }
    if (CMD === "spawn" && lo.length) {
      // chat /spawn <creature name|species id|boss> [n] [baby|adult|boss]: recorded templates of that species next to the player
      if (noP()) return true;
      const a = lo.slice(), STG = { baby: 0, adult: 1, boss: 2, giant: 3 };
      let stage = null, n = 1;
      for (let k = 0; k < 2; k++) {   // count and stage in either order at the end, or a count first: /spawn 3 wolf
        if (a.length > 1 && STG[a[a.length - 1]] != null) stage = STG[a.pop()];
        else if (a.length > 1 && CA.num(a[a.length - 1]) != null) n = CA.num(a.pop());
      }
      if (a.length > 1 && CA.num(a[0]) != null) n = CA.num(a.shift());
      n = Math.max(1, Math.min(30, Math.floor(n)));
      const want = a.join(" "), all = [];
      for (let ph = 0; ph < 6; ph++) for (const c of phaseList(world, ph)) if (c["13"] == null && c["21"] != null) all.push([ph, c]);
      let pool, label = want;
      if (want === "boss") {
        pool = all.filter(([ph, c]) => ph === world.phase && ((MEAS[c["21"]] && MEAS[c["21"]].boss) || (c["23"] | 0) >= 2));
        if (!pool.length) pool = all.filter(([, c]) => (MEAS[c["21"]] && MEAS[c["21"]].boss) || (c["23"] | 0) >= 2);
      } else {
        const exact = (w) => all.filter(([, c]) => String(c["21"]) === w || spName(c["21"]).toLowerCase() === w);
        pool = exact(want);
        let sp = pool.length ? null : Object.keys(SPECIES).find((k) => k === want || SPECIES[k][0].toLowerCase() === want);
        if (!pool.length && sp == null) {   // a close name: "wolfs", "fire fary"
          const nm = CA.fuzzy(want, Object.keys(SPECIES).map((k) => SPECIES[k][0]));
          if (nm) { pool = exact(nm.toLowerCase()); label = nm; if (!pool.length) sp = Object.keys(SPECIES).find((k) => SPECIES[k][0] === nm); }
        }
        if (!pool.length && sp != null) {   // species never seen wild in the recording (e.g. wolf): reuse a recorded body with that species id
          const base = all.find(([ph]) => ph === world.phase) || all[0];
          if (base) pool = [[base[0], Object.assign({}, base[1], { "21": +sp, "23": 1 })]];
          label = SPECIES[sp][0];
        }
      }
      if (!pool.length) return false;   // not a creature: insects.js (/spawn wasp-nest, majestic butterfly), then "unknown"
      if (!p.ent) { say("You are dead", "err"); return true; }
      if (stage != null) { const f = pool.filter(([, c]) => (c["23"] | 0) === stage); if (f.length) pool = f; }
      const spots = spreadSpots(world, p.ent.x, p.ent.y, n);
      for (let i = 0; i < n; i++) { const e = spawnWild(world, pool[i % pool.length][1], spots[i][0], spots[i][1], world.phase, true); if (e) e.byCmd = true; }
      say("Spawned " + n + " " + label + (stage != null ? " (" + Object.keys(STG).find((k) => STG[k] === stage) + ")" : "") + ". /clear removes them", "ok");
      world.L({ k: "cmd", n: p.n, cmd: "spawn", args: want + " " + n, ok: true });
      return true;
    }
    if (CMD === "spawnall") {   // chat /spawnall: one of every recorded creature kind and stage, scattered around the player
      if (noP()) return true;
      if (!p.ent) { say("You are dead", "err"); return true; }
      const seen = new Set(), list = [];
      for (let ph = 0; ph < 6; ph++) for (const c of phaseList(world, ph)) {
        if (c["13"] != null || c["21"] == null) continue;
        const key = c["21"] + "/" + (c["23"] | 0); if (seen.has(key)) continue; seen.add(key); list.push(c);
      }
      const spots = spreadSpots(world, p.ent.x, p.ent.y, list.length); let i = 0;
      for (const c of list) { const e = spawnWild(world, c, spots[i][0], spots[i][1], world.phase, true); if (e) e.byCmd = true; i++; }
      // owner: every biome's tornado too, in a ring 700 around the player (kept on the current phase)
      const TK = world.P.tornado ? Object.values(world.P.tornado.name_by_phase) : [];
      TK.forEach((nm, k) => { const a = k / TK.length * Math.PI * 2; world.spawnTornado(p.ent.x + Math.cos(a) * 700, p.ent.y + Math.sin(a) * 700, now0(world), nm); });
      say("Spawned " + i + " creatures and " + TK.length + " tornados. /clear removes the creatures", "ok");
      world.L({ k: "cmd_spawnall", n: p.n, count: i, tornados: TK.length });
      return true;
    }
    if (CMD === "clear") {   // chat /clear [radius] [all]: remove /spawn creatures near the player (all: every wild creature, not pets)
      if (noP()) return true;
      if (!p.ent) { say("You are dead", "err"); return true; }
      const every = lo.includes("all"), nums = lo.map(CA.num).filter((v) => v != null);
      if (lo.some((x) => x !== "all" && CA.num(x) == null) || nums.length > 1) return usage();
      const R = nums.length ? Math.max(100, nums[0]) : 1500, st = S(world);
      let n = 0;
      for (const e of [...st.wild]) {
        if (!(every || e.byCmd) || dist(e, p.ent) > R || e.owner) continue;
        st.wild.delete(e); st.dying.delete(e); world.removeEnt(e.id); n++;
      }
      say(n ? "Removed " + n + " creature" + (n > 1 ? "s" : "") + " within " + CA.fmt(R) : "Nothing to remove within " + CA.fmt(R) + (every ? "" : " (only /spawn creatures; /clear all for every wild one)"), n ? "ok" : "err");
      cmdLog(r.rest, n > 0);
      return true;
    }
    if (process.env.TIO_CREATURES_TEST === "1" && m.type !== J.TEST) world.L({ k: "json_in", n: p.n, m: JSON.stringify(m).slice(0, 200) });
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && typeof m.who === "string") {
      const q = [...world.players.values()].find((x) => x.name === m.who && x.ent);
      if (!q) return true;
      const sender = p; p = q; m = Object.assign({}, m); delete m.who;
      const r = this.onJson(world, q, m);
      if (m.cast) { const pt = petsOf(world, q).find((x) => !x.dead); if (pt) castSkill(world, pt); }
      if (m.tame) { const e = [...S(world).wild].filter((w) => w.sp === m.kind).sort((u, v) => dist(u, q.ent) - dist(v, q.ent))[0]; if (e) startTame(world, q, e.id); }
      sender.queue({ "1": 39, i: 0, m: "test who " + q.name, mt: 1 });
      return r;
    }
    if (m.type === J.TAME) { if (typeof m._ === "number") startTame(world, p, m._); return true; }
    if (m.type === J.RELEASE && typeof m.i === "number") { releasePet(world, p, m.i); return true; }
    if (m.type === J.RENAME) { if (typeof m.i === "number") renamePet(world, p, m.i, m.n); return true; }
    if (m.type === J.PET) { if (typeof m.I === "number" && typeof m.S === "number") petCommand(world, p, m.I, m.S | 0, m); return true; }
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && m.cfg && typeof m.cfg === "object") {
      for (const [k, v] of Object.entries(m.cfg)) if (k in C && typeof v !== "object") C[k] = v;
      p.queue({ "1": 39, i: 0, m: "test cfg", mt: 1 });
      return true;
    }
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && typeof m.team === "number") {   // dev: join team m.team (0 = none)
      p.cf = p.cf || {}; p.cf["14"] = m.team ? m.team * 2 : 0;
      p.queue({ "1": 39, i: 0, m: "test team " + m.team, mt: 1 });
      return true;
    }
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && typeof m.phase === "number" && typeof world.switchPhase === "function") {
      for (let i = 0; i < 6 && world.phase !== m.phase; i++) world.switchPhase(now0(world));
      p.queue({ "1": 39, i: 0, m: "test phase " + world.phase, mt: 1 });
      return true;
    }
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && p.ent && typeof m.xp === "number") { p.addXp(Math.min(1e6, m.xp), "test"); p.queue({ "1": 39, i: 0, m: "test xp", mt: 1 }); return true; }
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && p.ent && m.pet) {
      const pt = petsOf(world, p).find((q) => !q.dead && (typeof m.sp !== "number" || q.sp === m.sp)); if (!pt) return true;
      if (typeof m.hpfrac === "number") { pt.hp = pt.max * m.hpfrac; world.touch(pt, { "9": Math.round(m.hpfrac * 255) }); }
      const a = typeof m.a === "number" ? m.a : 0, r = typeof m.d === "number" ? m.d : 100;
      pt.x = p.ent.x + Math.cos(a) * r; pt.y = p.ent.y + Math.sin(a) * r; pt.mode = 0; pt.tgt = null;
      world.touch(pt, { "3": Math.round(pt.x), "4": Math.round(pt.y) });
      p.queue({ "1": 39, i: 0, m: "test " + pt.id, mt: 1 });
      return true;
    }
    if (m.type === J.TEST && process.env.TIO_CREATURES_TEST === "1" && p.ent) {
      let best = null, bd = 1e18;
      for (const e of S(world).wild) { if (e.sp !== m.kind || e.st === "dying") continue; const q = dist(e, p.ent); if (q < bd) { bd = q; best = e; } }
      if (!best) {
        let tpl = null;
        for (const b of [S(world).phase, 0, 1, 2, 3, 4, 5]) { tpl = phaseList(world, b).find((c) => c["21"] === m.kind && c["13"] == null); if (tpl) break; }
        tpl = tpl || { "21": m.kind, "22": typeof m.cls === "number" ? m.cls : 21, "23": 0, "24": 0, "25": 10, "6": 1 };
        best = spawnWild(world, tpl, p.ent.x, p.ent.y, S(world).phase);
      }
      const a = typeof m.a === "number" ? m.a : 0, r = typeof m.d === "number" ? m.d : 150;
      best.x = best.hx = best.tx = p.ent.x + Math.cos(a) * r; best.y = best.hy = best.ty = p.ent.y + Math.sin(a) * r;
      if (typeof m.stage === "number") { best.stage = m.stage; best.r = cRad(best.sp, m.stage); best.f["23"] = m.stage; const d2 = kdef(world, best.sp, m.stage); best.hp = best.max = d2.hp; }
      if (m.hp) best.hp = Math.min(best.max, m.hp);
      if (!m.sleep && (best.s7 & 64 || best.s7 === 10)) { best.s7 = best.wake7 = 2; world.touch(best, { "7": 2 }); }
      if (typeof m.clear === "number") for (const e of [...S(world).wild]) if (e !== best && dist(e, p.ent) < m.clear) { S(world).wild.delete(e); world.removeEnt(e.id); }
      if (m.target) { best.tgt = p.ent; best.st = "chase"; }
      world.touch(best, { "3": Math.round(best.x), "4": Math.round(best.y) });
      p.queue({ "1": 39, i: 0, m: "test " + best.id, mt: 1 });
      return true;
    }
    return false;
  },
  // a saddle swing while riding dismounts, whichever way the rider faces (the ridden pet sits under him); any species rides
  onSwing(world, p) {   // owner: a saddle swing dismounts while riding, else mounts the nearest own pet in reach, whichever way the player faces
    if (!heldSaddle(world, p) || !p.ent || p.saddleAt === now0(world)) return false;
    const ridden = petsOf(world, p).find((q) => q.rider);
    if (ridden) { p.saddleAt = now0(world); unmount(world, ridden, true); return true; }
    let best = null, bd = C.mount_r;   // wiki Saddles: "Mount your nearest boss pet"
    for (const q of petsOf(world, p)) { if (q.dead || q.dying) continue; const d = dist(q, p.ent); if (d < bd) { bd = d; best = q; } }
    if (!best) return false;
    p.saddleAt = now0(world); mount(world, p, best); return true;
  },
  // a creature at a spot (tornado boss dogs): stage 3 = the sleeping boss form
  // /boss: the near-player world boss (Grove Colossus) comes 400 from the typer (spawned if it is not up)
  bossToPlayer(world, p) {
    const st = S(world), sp = Object.keys(WB.near).map(Number).find((k) => (WB.phases[st.phase] || []).some((m) => WB.species[m] === k));
    if (sp == null || !p.ent) return false;
    const a = Math.random() * TAU, x = Math.round(p.ent.x + Math.cos(a) * 400), y = Math.round(p.ent.y + Math.sin(a) * 400);
    let e = [...st.wild].find((q) => q.sp === sp && q.worldBoss && !q.dying);
    if (!e) { const marker = (WB.phases[st.phase] || []).find((m) => WB.species[m] === sp);
      e = spawnWild(world, { "21": sp, "22": WB.typeBy[marker] || 0, "23": WB.stageBy[marker] || 3, "7": 2, __wb: marker }, x, y, st.phase, true); e.tpl = null; }
    e.x = e.hx = x; e.y = e.hy = y; world.touch(e, { "3": x, "4": y });
    if (world.boss) { world.boss.x = x; world.boss.y = y; }
    return true;
  },
  // totem shop mask (world.js /totem buy mask): untamed = a sleeping baby mask next to the totem (tame it), tamed = a pet at that stage
  totemMask(world, p, t, kind, list) {
    const sp = list[Math.floor(Math.random() * list.length)];
    if (kind === "untamed") {
      const e = spawnWild(world, { "21": sp, "22": petType(sp), "23": 0, "7": 66, "25": 10 }, Math.round(t.x + 160), Math.round(t.y + 60), S(world).phase, true);
      e.tpl = null; if (p.say) p.say("An untamed " + spName(sp) + " sleeps next to the totem: tame it");
    } else {
      const stage = { baby: 0, adult: 1, boss: 2 }[kind], q = spawnPet(world, p, { sp, ck: petType(sp), stage });
      if (q) { ownInfo(p, q); if (p.say) p.say("A tamed " + kind + " " + spName(sp) + " joins you", "ok", [spName(sp)]); }
    }
    world.L({ k: "totem_mask", n: p.n, kind, sp });
  },
  spawnAt(world, sp, stage, x, y) {
    const tp = petType(sp);
    const e = spawnWild(world, { "21": sp, "22": tp, "23": stage, "7": 2, "25": 10 }, x, y, S(world).phase, true);
    e.tpl = null; world.L({ k: "boss_dog", sp, x, y }); return e;
  },
  onHit(world, attacker, target, dmg) {
    if (!target) return dmg;
    const it = attacker && attacker.queue && world.ctx && world.ctx.ITEMS ? world.ctx.ITEMS[attacker.held] : null, A = it && C.appletor[it.name];
    if (A && target.kind === "animal" && target.plug === "creatures") {   // Appletor apple: heals, raises the tame chance, never wakes
      target.hp = Math.min(target.max, target.hp + A.heal * ((attacker.mods && attacker.mods.appletor_mult) || 1)); target.tameBonus = Math.min(1, (target.tameBonus || 0) + A.tame);
      const d = kdef(world, target.sp, target.stage), base = SHADOWS.some((q) => q[0] === target.sp) ? C.shadow_tame : target.sirenBaby ? C.siren_baby_tame : d.tame / 100;
      if (typeof attacker.say === "function") attacker.say(spName(target.sp) + " tame chance " + Math.round(Math.min(1, base + target.tameBonus) * 100) + "%");
      return 0;
    }
    if (target.kind === "pet" && attacker && attacker !== target.owner && friendly(world, attacker, target)) return 0;
    if (target.kind === "pet" && target.owner && attacker && attacker === target.owner) {
      if (!target.dead && target.owner.ent && heldSaddle(world, attacker) && attacker.saddleAt !== now0(world)) {
        attacker.saddleAt = now0(world);   // one mount/dismount per swing even when the arc covers several pets
        const ridden = petsOf(world, attacker).find((q) => q.rider);
        if (ridden) unmount(world, ridden, true); else mount(world, attacker, target);
      }
      return 0;
    }
    if (attacker && attacker.queue && target.kind !== "pet") {
      if (target.kind === "animal" || target.kind === "player") defendOwner(world, attacker, target);
    }
    if (target.kind === "player" && target.p && attacker && attacker.ent) defendOwner(world, target.p, attacker.ent, true);
    return dmg;
  },
  riddenPet(world, p) { return petsOf(world, p).find((q) => q.rider && !q.dead) || null; },
  onKnockout(world, o) {   // gloves knockout: the rider falls off
    const ridden = o.kind === "pet" ? (o.rider ? o : null) : o.p ? petsOf(world, o.p).find((q) => q.rider) : null;
    if (ridden) unmount(world, ridden, true);
  },
  onReset(world) { const st = S(world); if (st && st.restart) restartStop(world, false); if (st && st.vs) vsEnd(world, false); if (st) biomeSwitch(world, st.phase, st.phase); },
  onDeplete(world, o, by) { onDeplete(world, o, by); },
  onChestOpen(world, o, by) { onChestOpen(world, o, by); },
  sanctuaryReset(world, phase, at) { return sanctuaryReset(world, phase != null ? phase : world.phase, at); },
  spawnHive(world, at) { return spawnHive(world, at); },
  onBiome(world, oldPhase, newPhase) {
    if (S(world) && S(world).vs) vsEnd(world, false);
    const st = S(world); if (!st || st.phase === newPhase) return;
    biomeSwitch(world, oldPhase, newPhase);
  },
};
