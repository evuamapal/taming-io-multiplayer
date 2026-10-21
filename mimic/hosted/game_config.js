// Multiplayer game numbers: defaults here, overridden by hosted_config.json "game" (same keys).
// Sources: hosted_config.json "game_sources", each tagged sp5 (measured in the Saopaulo#5 human capture: sp3_facts.json,
// sp3_feature_inventory.md), atl4 (Atlanta#4 / v0.1 fallback where sp5 has nothing) or guess.
"use strict";
const fs = require("fs"), path = require("path");
const DEFAULTS = {
  send_ms: 94, substeps: 4,
  walk_speed: 488, start_fraction: 0.8, stop_glide: [0.76, 0.19, 0.054, 0.027, 0],
  speed_by_item: {},
  speed_food_wiki_suffix: [" Instant Healing", " Heal Over Time", " Speed Buff", " Defense Buff", " (item)"],
  speed_by_pattern: [["pickaxe", 0.46], ["axe", 0.8], ["hammer", 0.94], ["shield", 0.7], ["saddle", 0.61], ["minigun", 0.34]],
  speed_food: 0.6, speed_build: 1,
  map_min: 350, map_max: 17250,
  view_create: [1370, 933], view_remove: [1521, 1053], keepalive_ticks: 6,
  collide_by_def: {},
  // base capture closest approach (center distance, the player got this close, so the real block distance is at most this):
  // objects where the clone blocked earlier; on unless TIO_COLLIDE_V2=0
  collide_measured: { "dark-tree1": 102, "volcanic-stone3": 102, "sea-stone2": 121 }, collide_family: { tree: 120, stone: 130, gold: 150, bush: 95, flower: 90, plant: 90, "hollow-log": 80, wall: 80,
    door: 80, spike: 65, windmill: 70, turret: 65, tower: 65, gift: 110, cactus: 90, anemone: 87, urchin: 87, totem: 80, pad: 0, trap: 0, other: 0 },
  // type chart (wiki Module:Animals/data rev 38899, the table behind {{Type Relations}}): attacker type -> defender types it
  // deals 2x to (type_adv) / 0.5x to (type_weak_to). Dual types multiply (wiki Types rev 33719: combined multiplicatively),
  // so Fire vs Ancient (in both lists) = 1x. Players have no type (capes are separate), so it applies only to animals and pets;
  // fairy balls deal the fairy's type (wiki Enchanting Gaze: fairy-type damage, affected by resistance or weakness)
  type_strong: 2, type_weak: 0.5,
  type_adv: { Normal: [], Rock: ["Electric", "Poison", "Insect", "Fire", "Ice", "Fairy"], Water: ["Rock", "Fire"], Electric: ["Water", "Fairy"],
    Plant: ["Rock", "Water"], Poison: ["Plant", "Combat", "Spectrum"], Insect: ["Plant", "Poison"], Combat: ["Normal", "Rock", "Ice"],
    Fire: ["Plant", "Insect", "Ice", "Ancient"], Ice: ["Plant", "Dragon", "Ancient"], Spectrum: ["Normal", "Combat"], Dragon: ["Dragon", "Ancient"],
    Fairy: ["Combat", "Spectrum", "Dragon"], Ancient: ["Rock", "Electric", "Insect", "Fire", "Fairy"] },
  type_weak_to: { Normal: ["Rock", "Spectrum"], Rock: ["Combat", "Ancient"], Water: ["Water", "Plant", "Dragon"], Electric: ["Rock", "Electric", "Plant", "Dragon"],
    Plant: ["Plant", "Poison", "Insect", "Fire", "Dragon"], Poison: ["Rock", "Poison", "Insect"], Insect: ["Combat", "Fire", "Spectrum", "Fairy", "Ancient"],
    Combat: ["Poison", "Insect", "Spectrum", "Fairy"], Fire: ["Rock", "Water", "Fire", "Dragon"], Ice: ["Water", "Fire", "Ice"],
    Spectrum: ["Poison", "Spectrum", "Fairy"], Dragon: ["Fairy"], Fairy: ["Rock", "Fire", "Ancient"], Ancient: ["Ice", "Dragon", "Ancient"] },
  max_hp: 100, spawn_shield_ms: 5000, spawn: { x: 11350, y: 12750 }, spawn_radius: 450,
  start_inv: { 0: 900, 1: 900, 2: 900, 3: 3000, 4: 0, 5: 0 },   // owner: every join, respawn, /reset and /die starts with 900 food / wood / stone and 3,000 gold
  potion_start_age: { 25: 10, 26: 20, 27: 30 },   // owner: menu potions (join po): Philter of Aging I / II / III start at this age, the highest one wins
  potion_pets: { 58: [90], 59: [89], 60: [88], 61: [88, 89, 90] },   // owner: statue potions (join po) add these pets: Mend / Inferno / Bloom Rock Brew = Water / Fire / Plant Statue, Guardians' Call Elixir = all three (wiki)
  respawn_keep_xp: 1 / 3, respawn_keep_inv: { 0: 0.08, 1: 0.14, 2: 0.14, 3: 0, 4: 0, 5: 0 },
  death_screen_ms: 1000,
  xp_per_resource: 1, gather_default: 1,
  // hollow logs pay the tool's tree wood + 3 per hit (human capture 20261017_114839: Stone Axe 7 vs tree 4, Golden Pickaxe
  // 9 vs 6, Ruby Pickaxe 11 vs 8; 9 log hits, XP = the wood; no extra on the breaking hit)
  gather_extra: { "hollow-log": 3 },
  gather_slot: { tree: 1, "hollow-log": 1, stone: 2, gold: 3, bush: 0, flower: 0, plant: 0, gift: 0, anemone: 0 },
  gather_tool_family: ["pickaxe", "axe", "hammer"],
  gather_yield: {},
  // owner balance pass: an item without an accepted recorded swing swings at its client tooltip reload + swing_tip_extra_ms
  // (median recorded gap over the tooltip, 34 items with 20+ swings in 5+ captures: 147); a recorded median further than
  // swing_scan_tol_ms from that is not used (Sapphire Sword 1216, Amber Sword 1495: swords are 0.7..0.8 s)
  swing_tip_extra_ms: 150, swing_scan_tol_ms: 250,
  swing_extra_ms: 250, reach: 110, hit_arc: 1.2, player_radius: 35, animal_radius: 45,
  damage_hand: 4, damage_default: 8, damage_by_item: {}, damage_by_pattern: [["sword", 15], ["katana", 17], ["spear", 15], ["naginata", 18],
    ["dagger", 10], ["cleaver", 12], ["battle-axe", 20], ["hammer", 8], ["axe", 8], ["pickaxe", 6], ["punch", 6]],
  hazard_match: ["spike", "cactus"], hazard_reach: 0, spike_damage: 4, spike_period_ms: 140,   // measured: hits land up to ~97 from the center (hz 98), every 0.09 / 0.19 s alternating (~0.14)
  spike_damage_by_def: { "wooden-spike": 2, "stone-spike": 3, "golden-spike": 4, "ruby-spike": 5, "amethyst-spike": 6, "sapphire-spike": 7, "diamond-spike": 7, "emerald-spike": 7, "amber-spike": 7,
    "big-stone-spike": 2, "big-golden-spike": 2, "big-ruby-spike": 3, "big-amethyst-spike": 4, "big-sapphire-spike": 5, "big-diamond-spike": 5, "big-emerald-spike": 5, "big-amber-spike": 5 },   // big spikes: wiki Spikes (were the 4 fallback)   // measured per hit on players (36 sessions); ruby guessed between golden and amethyst
  xp_player_kill_min: 10, xp_player_kill_frac: 0.25,
  animals: [{ kind: 2, n: 6 }, { kind: 10, n: 3 }, { kind: 66, n: 2 }],
  animal_hp: 60, animal_speed: 70, animal_retarget_per_s: 0.3, animal_respawn_ms: 30000, xp_animal_kill: 20, animal_food: 5,
  place_dist: 120, place_clear_mobile: 60,
  // TIO_PLACE_V2 (on unless "0"): no overlap; footprint radius from the base capture's closest same-type spacing / 2
  // (amethyst-wall pairs 113.9, stone-spike 131.1, wooden-door 100.7); items without a place value go at player radius + footprint + place_gap (guess)
  // same-family minimum center distance seen between real player buildings in the 38 scans (spacing only, collision
  // keeps build_r): spike 78, door 104, tower 124, turret 125; wall: base capture pairs 114
  space_pair: { spike: 125, door: 104, tower: 124, turret: 125, wall: 114 },   // owner: spike = wall x 1.1 (was 78)
  build_r: { wall: 57, spike: 63, door: 50 }, place_gap: 10, collide_k: { spike: 0.98, wall: 0.96 },   // owner: spike = wall x 1.1 (was 65); spike k 0.98: block 92.5 (bbotot recording: pressed 92..94, rest 94..95)
  player_hit_k: 0.9,
  // fallen logs are capsules for the player: center segment +-log_half_len along the field 5 rotation (/100 rad), radius = the
  // def collide distance (bbotot sea log: slides 67.5 from the axis over u -102..85, around the end at 184; every scan: axis
  // distance sea 68, snow 73.6, desert 74.8, volcanic 75.6, forest 76.5, dark 80.2, flat side out to ~120..140)
  log_half_len: 120,
  ease_out_step: 0.5, ease_out_frac: 0.13,   // a wall / spike placed on the placer slides him out by 13% of the remaining gap per substep, at least 0.5 (measured: gap x 0.57 per frame, 62 -> 88 / 94 in 0.5 s)
  place_hold: true,   // owner: holding the button with a building keeps placing every tick and the building stays in hand (no re-select)
  shot_gather: true,   // owner: bullets hit trees / stones / bushes / logs like a melee hit (gold only stops them)
  move_squeeze: 0.12, speed_squeeze_max: 0.33,   // owner: squeeze scales with speed (move_squeeze x speed / walk_speed), capped: a pad launch rams into spike gaps walking cannot enter
    // owner: while a move key is held the player body is 12% smaller against solids (slides through gaps between two structures); standing still: full size
  squeeze_wall: 0.23,   // owner: walls and other solids squeeze the player up to 23% while he keeps pressing into them
  squeeze_max: 0.31, squeeze_step: 0.06, squeeze_fams: ["spike"],   // owner (v67): 5% tighter gaps pass than before (wall+wall 161 -> 153, spike+spike 171 -> 163); walls never squeeze (bbotot Frankfurt#3 ocean wall row: pressed into joints 153 / 154 / 156 apart he stopped dead at 84..86 from both, 1 s, no shrink); wall block 84.5 (k 0.96)
  squeeze_relax: 0.02,   // owner: pushing into solids shrinks the hitbox up to 20% more, only when wedged between two or more solids, never against one (gaps: wall+wall 153, spike+spike 171; measured 155..156 / 175) (per substep, snake-like slide), relaxes when free   // owner: the player's own radius counts 10% smaller against solids (two-wall gaps pass as in the real game)
  board_ticks: 32, minimap_div: 69.5, minimap_ticks: 127, chat_min_ms: 700, chat_max_len: 80, max_msg_bytes: 8192,
  synthetic: [], synthetic_fill: true, spawn_force: false, spawn_mode: "default", animals_max: 40,
  biome_ms: {}, biome_ms_override: 0, biome_order: [0, 1, 2, 3, 4, 5], biome_start: 0, biome_start_elapsed_ms: 0,
  biome_remove_ms: 650, biome_kill_dmg: [400, 900, 350, 200, 300],
  resource_step: [["wasp-nest", 51], ["golden-flower-bush", 51], ["seeds-plant", 51], ["thornbush", 24], ["hollow-log", 102], ["anemone", 43], ["urchin", 2], ["gold", 0], ["bush", 51], ["tree", 16], ["stone", 16]],
  resource_step_default: 16, resource_respawn_ms: 121000, destroy_remove_ms: 500,
  chest_step: 58.75, chest_remove_ms: 200, chest_respawn_ms: 129000,
  // boss chests (gift 9..14, 43..45, 55..60, 89..91): wiki 14k gold each
  chest_loot: { 9: { inv: { 3: 14000 } }, 10: { inv: { 3: 14000 } }, 11: { inv: { 3: 14000 } }, 12: { inv: { 3: 14000 } }, 13: { inv: { 3: 14000 } }, 14: { inv: { 3: 14000 } },
    43: { inv: { 3: 14000 } }, 44: { inv: { 3: 14000 } }, 45: { inv: { 3: 14000 } }, 55: { inv: { 3: 14000 } }, 56: { inv: { 3: 14000 } }, 57: { inv: { 3: 14000 } },
    58: { inv: { 3: 14000 } }, 59: { inv: { 3: 14000 } }, 60: { inv: { 3: 14000 } }, 89: { inv: { 3: 14000 } }, 90: { inv: { 3: 14000 } }, 91: { inv: { 3: 14000 } },
    52: { inv: { 0: 205 }, xp: 5 }, 49: { inv: { 2: [205, 716] }, xp: 5 }, 68: { inv: { 4: 2 }, xp: 0 }, 86: { inv: { 2: 17, 3: 17, 4: 2 }, xp: 34 }, 48: { inv: { 0: 216 }, xp: 16 } },
  boss_chest_gold: 14000,   // owner: the Gold Golem chests pay it too (they had only their part, no gold)
  chest_loot_default: [{ inv: { 0: 205 }, xp: 5 }, { inv: { 2: 205 }, xp: 5 }, { inv: { 4: 2 }, xp: 0 }, { inv: { 2: 17, 3: 17, 4: 2 }, xp: 34 }, { inv: { 0: 216 }, xp: 16 }],
  struct_byte_per_dmg: 4, decay_step: 13, decay_ms: 11000, placed_div: 57.9, placed_persist: true,
  door_open_dist: 90, door_open: 18, door_closed: 19,
  marker80_ms: 129000, marker80_first_ms: 148000, marker65_ms: 30000, marker65_first_ms: 2500, marker_div: 176,
  boss_markers: [[85, 40, 10], [148, 204, 2], [111, 79, 6], [105, 185, 3], [24, 26, 9], [115, 52, 7], [112, 67, 5], [165, 198, 13], [47, 33, 1]],
  boss_marker_ms: 300000, boss_marker_max: 14, boss_marker_default: 1, boss_marker_by_species: {}, pa_by_phase: { 1: [27, 57], 2: [27, 57], 3: [27, 57], 4: [27, 57], 5: [210, 217], 0: [210, 217] },
  cmd_next_cooldown_ms: 500,
  announce_ms: 6000, announce_color: "#F0E4D0", announce_on_join: null,
  resource_step_by_tool: { Hand: 2, "Stone Axe": 10, "Golden Axe": 13, "Golden Pickaxe": 13, "Stone Hammer": 13, "Ruby Axe": 16, "Ruby Pickaxe": 16,
    "Amethyst Pickaxe": 19, "Ruby Hammer": 19, "Sapphire Pickaxe": 24 },
  chest_step_by_tool: { "Stone Axe": 58.75, "Ruby Axe": 140, "Ruby Pickaxe": 140, "Sapphire Pickaxe": 127.5 },
  struct_step_tool: 32, struct_step_by_tool: { "Stone Hammer": 24 },
  struct_step: { spike: 32, "diamond-spike|Amethyst Axe": 22, door: 38, "ruby-wall": 32 },
  damage_vs: { creature: { Hand: 6, "Stone Axe": 42, "Golden Axe": 51, "Ruby Axe": 58, "Golden Pickaxe": 26, "Ruby Hammer": 18, "Amethyst Pickaxe": 28 },
    pet: { "Ruby Pickaxe": 30 }, player: { Hand: 4, "Ruby Pickaxe": 30 } },
  pad_trigger: 90, pad_trigger_by: { "big-boost-pad": 128 }, walk_fams: ["pad", "trap"], build_r_by: { "boost-pad": 55, "mega-boost-pad": 55, "big-boost-pad": 93 }, pad_profile: [96, 132, 123], pad_decay: 0.8, pad_cooldown_ms: 1000, resource_hp_wiki: 400,
  achievements_done: true,   // owner's choice: every player already has every achievement, so no achievement popups (44 o: 2)
  tornado: { name_by_phase: { 0: "poison-tornado", 1: "ice-tornado", 2: "electric-tornado", 3: "insect-tornado", 4: "water-tornado", 5: "ancient-tornado" },
    boss_dog: { 0: 92, 1: 93, 2: 148, 3: 94, 4: 117, 5: 118 },   // wiki: Acidog, Coldog, Voltdog, Bugdog, Floodog, Rexdog
    speed: 130, turn: 1.5, life_ms: 125000, leash: 700, r: 200, pull: 120, dmg: 4, hit_ms: 500 },   // speed: scans q50; the rest: guess
  pvp_body_r: 43.5,   // players stop at 2 x 43.5 from each other (owner: players collide; the creature-vs-player contact is r + 43.5)
  player_badge: 14,   // owner: every player wears the invented Fart badge (client rank13 after client_patch.json inserts it before ancient; field 20 and the board send it + 1)
  admin_hit_frac: 0.5,   // owner rule: in /admin every hit (weapon, hand, pet, pet skill) takes this share of the target's max hp
  knockback_peak: 70, knockback_decay: 0.8, knockback_hand: 30,
  // player weapon hits on players: no knockback (7 recordings, 15 clean hits on a still player: position change <= 6)
  knockback_pvp: 0,
  repair_range: 610, repair_heal_k: 15500, repair_durability_default: 400, repair_pulses: 2, repair_pulse_ms: 850, repair_first_pulse_ms: 1800,
  repair_first_ms: 2350, repair_aim: 24,
  windmill: { default: { gold: 10, ms: 11500 }, "Wooden Windmill": { gold: 10, ms: 11500 }, "Stone Windmill": { gold: 10, ms: 7500 },
    "Golden Windmill": { gold: 20, ms: 7500 }, "Ruby Windmill": { gold: 20, ms: 5000 }, "Amethyst Windmill": { gold: 30, ms: 5000 } },
  // clan totems (world.js hitTotem / totems): hp byte step per hit 10.3 measured (scans: 233, 222, 212, 202 ...); gold a
  // minute, heal (from level 2) and repair (from level 3) per level: wiki Totem; ability cadence and radius: guess
  totem: { default_clan: "BREAKME", step: 10.3, gold_per_min: [0, 250, 500, 1000, 1500, 2000, 2500], heal: { 2: 6, 3: 6, 4: 8, 5: 10, 6: 10 },
    repair: { 3: 30, 4: 50, 5: 60, 6: 60 }, ability_ms: 5000, r: 500,
    // wiki Totem: curse from level 3 (stage 1: enemy life -20 %), level 4-5 -40 %, level 6 -60 %, one player at a time, wears off
    // (read as a one-off loss of that share of max hp on the nearest enemy, never below 1 hp; once per enemy per curse_ms: guess);
    // totem points a minute per level 1 / 5 / 25 / 50 / 100 / 200 to the owning clan (shown by /totem)
    // wiki Totem shop: wood chest 7 golden apples (from level 2), stone chest 8 (level 3), food chest 9 (level 5), 500 of the material
    // each; a mask (random among the kinds the level allows: untamed 2, tamed baby 3, adult 4, boss 6). The clone's account never
    // runs out of golden apples, so the price is shown but not taken; one buy per player per shop_ms (guess)
    shop: { wood: [2, 7, 1], stone: [3, 8, 2], food: [5, 9, 0], mask: [2, 0] }, shop_ms: 10000, masks: [70, 71, 72, 73, 74, 153, 154],
    curse: { 3: 0.2, 4: 0.4, 5: 0.4, 6: 0.6 }, curse_ms: 30000, points_per_min: [0, 1, 5, 25, 50, 100, 200] },
  kill_xp_by_stage: { 0: 50, 1: 100, 2: 400, 3: 1200 },
  // wiki Wrenches: a hit on an own or clan building repairs it [repair, stone, gold] per tier (Stone 40, Golden 70, Ruby 100, Amethyst
  // 140, Sapphire and the cosmetic tiers 200); the wiki recipe columns read as the per-hit cost ("uses stone and gold"): guess
  wrench: { Stone: [40, 4, 0], Golden: [70, 5, 0], Ruby: [100, 6, 0], Amethyst: [140, 7, 1], Sapphire: [200, 8, 4], other: [200, 8, 4] },
  // wiki Gloves: Knockout, a 25 % chance to stun after 3 hits in a row on one tamer or pet (Cheek Protection 50 %); blocks the pet's
  // skill, dismounts, slows a lot; a shield held by the target protects. Stun 1.5 s, slow x0.3 and the 1.5 s combo gap: guess
  knockout: { combo: 3, chance: 0.25, stun_ms: 1500, slow: 0.3, combo_gap_ms: 1500 },
  fart_v: 4000, fart_tau: 0.2, fart_ms: 600, fart_cd_ms: 3000, fart_fx: 61, fart_fx_ms: 1500,   // /fart: invented
  // Air Blast Gun (invented, owner request; world.js blast): item slot 17, a level-1 pick next to the stone tools; poke damage
  // per target, a 60 degree cone of reach range (+ reach_step per wave), waves gap_ms apart pushing at push[i] units per frame
  // (knockback_peak is 70), effect 434 (art: tools/invented/make_blast.py) flying out along fx_fan for fx_life ms
  // owner: swings and walks like the Stone Spear (reload 700 + swing_extra_ms, speed 0.84), keeps its waves and art
  blast: { item: 17, ms: 950, speed: 0.84, dmg: { player: 8, creature: 8, pet: 8 }, range: 400, reach_step: 120, cone_deg: 60, waves: 3, gap_ms: 150,
    push: [60, 45, 32], fx: 61, fx_life: 380, fx_fan: [-0.4, 0, 0.4], gather_as: 20, quiet_age: 100 },   // owner: each shot also gathers / hits buildings as a Golden Naginata (item 20) swing
  refund_frac: 0.5, gift_drop_ms: 129000, fx_ms: 300,
  // owner: every ranged weapon shoots its own projectile. fx = client projectile table index, anchored on two recorded ids
  // (Slingshot stone-projectile 10, Golden Minigun 23): arrows 0..7, crossbow bullets 16..22, blowpipe darts 30..37. Golden Bow measured (recovered capture ws_20261019_140012: 7 shots 1.51..1.60 s apart,
  // arrow flies 141 per 94 ms frame for up to 0.75 s = ~1100); other bows take that arrow range; other periods / ranges: guess
  // element towers shoot (owner: same effect as the fairy of their type): k = that fairy's skill effect, pdmg / adm = its
  // wiki Player / Animal Damage (sp = that fairy: its ball is thrown by creatures.js fairyBall with its damage over time;
  // k / pdmg / adm are the fallback), ms = wiki tower reload per material in s (cosmetic = diamond / emerald / amber), the ball
  // flies at speed to the target; range, speed, splash_r and first / idle delays: guess
  guns: { first_ms: 1500, idle_ms: 300, splash_r: 230,
    towers: {
      fire: { sp: 18, k: 122, pdmg: 15, adm: 30, range: 650, speed: 700, ms: { stone: 5, golden: 7, ruby: 5, amethyst: 7, sapphire: 7, cosmetic: 6 } },
      ice: { sp: 37, k: 131, pdmg: 12, adm: 25, range: 650, speed: 700, ms: { stone: 7, golden: 9, ruby: 7, amethyst: 9, sapphire: 7, cosmetic: 8 } },
      plant: { sp: 19, k: 116, pdmg: 15, adm: 30, range: 650, speed: 700, ms: { stone: 10, golden: 12, ruby: 10, amethyst: 10, sapphire: 10, cosmetic: 12 } },
      electric: { sp: 50, k: 120, pdmg: 15, adm: 30, range: 650, speed: 700, ms: { stone: 6, golden: 8, ruby: 6, amethyst: 8, sapphire: 6, cosmetic: 7 } },
      water: { sp: 17, k: 126, pdmg: 12, adm: 24, range: 650, speed: 700, ms: { stone: 6, golden: 8, ruby: 6, amethyst: 8, sapphire: 6, cosmetic: 13.5 } },
      rock: { sp: 45, k: 125, pdmg: 15, adm: 30, range: 650, speed: 700, ms: { stone: 9, golden: 11, ruby: 9, amethyst: 11, sapphire: 11, cosmetic: 12.5 } },
      spectrum: { sp: 52, k: 119, pdmg: 5, adm: 10, range: 650, speed: 700, ms: { stone: 10, golden: 12, ruby: 10, amethyst: 12, sapphire: 10, cosmetic: 11.5 } } } },
  // Enchanting Gaze (species 110) boss pets within r of the owner turn his spear / naginata into the Enchanted Spear (owner):
  // held items by gazes near (client 17 / 18 / 19 = Level 1 / 2 / 3; slot 17 carries the Air Blast Gun art, so 1 gaze shows
  // the Level 2 art) and a fairy energy arrow per swing (client effect 211 / 333 / 335, art spell-fairy-staff7..12, 1 s).
  // gazes: other Gaze species (104..109), a nearer one cancels it (wiki). r, range, speed and dmg (per gaze stacked): guess
  enchant: { sp: 110, gazes: [104, 105, 106, 107, 108, 109], r: 600, items: [18, 18, 19], fx: [211, 333, 335], range: 700, speed: 900,
    dmg: { player: 8, creature: 12, pet: 10 } },
  // bear traps (wiki Bear Traps): armed 5 s after placing, 40 to players / 120 to animals and a stun, 5 s cooldown; Big Bear
  // Trap: larger radius, Mega Bear Trap: more damage (r, the Big / Mega numbers, stun_ms: guess); fx = client paralysis-effect
  traps: { arm_ms: 5000, cooldown_ms: 5000, stun_ms: 2000, fx: 197,
    "Bear Trap": { r: 60, dmg: 40, animal: 120 }, "Big Bear Trap": { r: 95, dmg: 40, animal: 120 }, "Mega Bear Trap": { r: 60, dmg: 60, animal: 180 } },
  appletor_heal: { "Appletor": { player: 10, pet: 20 }, "Golden Appletor": { player: 20, pet: 40 } },   // wiki Appletors: player / animal heal
  raptor_items: [324, 325, 326],   // Raptorial Daggers Level 1 / 2 / 3 (client items, art mantis-dagger0..2): daggers shown while a boss mantis skill runs (creatures.js)
  proj_speed: 1500,   // units/s a shot projectile flies (Golden Bow capture: 141 per 94 ms frame); ranged[name].speed overrides
  // client projectile table (game_rc _5566 / _10929): arrows stone..amber 1..8, cannonball 9, stone-projectile 10, apple 11,
  // gift 12, gold-projectile 13, golden-apple 14, bullets golden..amber 16..22, mini-bullets golden..amber 23..29, darts stone,
  // ruby..amber 30..36, golden dart 37. speed: scan_facts proj per kind (arrows 1163..1302, mini-bullet 1825, darts 1127..1229,
  // stone / apple 1186 / 1264), Golden Bow 1500 measured; crossbow bolts 1500: guess. fx = the client item's own projectile
  // (crossbows shoot the arrow of their material, muskets the bullets). ms (balance pass): the client tooltip reload + 250
  // (Golden Bow: tooltip 1.3 s, measured 1.51..1.60 s), Appletors the scan_facts median (1001 / 1006 ms, 50 / 39 swings),
  // Slingshots 1050 (scan 1045, tooltip 0.85 s), miniguns the recorded 125; musket range: client range 1800 vs the bow's 1500
  // on the measured arrow range (~920), musket bullet speed: guess
  ranged: {
    "Stone Bow": { fx: 1, ms: 1550, range: 1100, speed: 1250 },
    "Golden Bow": { fx: 2, ms: 1550, range: 1100, speed: 1500 },
    "Ruby Bow": { fx: 3, ms: 1450, range: 1100, speed: 1250 },
    "Amethyst Bow": { fx: 4, ms: 1450, range: 1100, speed: 1250 },
    "Sapphire Bow": { fx: 5, ms: 1350, range: 1100, speed: 1250 },
    "Diamond Bow": { fx: 6, ms: 1350, range: 1100, speed: 1270 },
    "Emerald Bow": { fx: 7, ms: 1350, range: 1100, speed: 1270 },
    "Amber Bow": { fx: 8, ms: 1350, range: 1100, speed: 1300 },
    "Appletor": { fx: 11, ms: 1000, range: 900, speed: 1260 },          // owner: apples raise the tame chance (creatures.js onHit); fx: apple-projectile
    "Golden Appletor": { fx: 14, ms: 1000, range: 900, speed: 1260 },   // golden-apple-projectile
    "Golden Crossbow": { fx: 2, ms: 1850, range: 850, speed: 1500 },
    "Ruby Crossbow": { fx: 3, ms: 1750, range: 850, speed: 1500 },
    "Amethyst Crossbow": { fx: 4, ms: 1800, range: 850, speed: 1500 },
    "Sapphire Crossbow": { fx: 5, ms: 1750, range: 850, speed: 1500 },
    "Diamond Crossbow": { fx: 6, ms: 1750, range: 850, speed: 1500 },
    "Emerald Crossbow": { fx: 7, ms: 1750, range: 850, speed: 1500 },
    "Amber Crossbow": { fx: 8, ms: 1750, range: 850, speed: 1500 },
    "Golden Musket": { fx: 16, ms: 1250, range: 1100, speed: 1800 },
    "Ruby Musket": { fx: 17, ms: 1200, range: 1100, speed: 1800 },
    "Amethyst Musket": { fx: 18, ms: 1150, range: 1100, speed: 1800 },
    "Sapphire Musket": { fx: 19, ms: 1100, range: 1100, speed: 1800 },
    "Diamond Musket": { fx: 20, ms: 1050, range: 1100, speed: 1800 },
    "Emerald Musket": { fx: 21, ms: 1050, range: 1100, speed: 1800 },
    "Amber Musket": { fx: 22, ms: 1050, range: 1100, speed: 1800 },
    "Golden Minigun": { fx: 23, ms: 125, range: 700, speed: 1825 },
    "Ruby Minigun": { fx: 24, ms: 125, range: 700, speed: 1825 },
    "Amethyst Minigun": { fx: 25, ms: 125, range: 700, speed: 1825 },
    "Sapphire Minigun": { fx: 26, ms: 125, range: 700, speed: 1825 },
    "Diamond Minigun": { fx: 27, ms: 125, range: 700, speed: 1825 },
    "Emerald Minigun": { fx: 28, ms: 125, range: 700, speed: 1825 },
    "Amber Minigun": { fx: 29, ms: 125, range: 700, speed: 1825 },
    "Stone Blowpipe": { fx: 30, ms: 1800, range: 650, speed: 1130 },
    "Golden Blowpipe": { fx: 37, ms: 1800, range: 650, speed: 1180 },
    "Ruby Blowpipe": { fx: 31, ms: 1700, range: 650, speed: 1180 },
    "Amethyst Blowpipe": { fx: 32, ms: 1700, range: 650, speed: 1180 },
    "Sapphire Blowpipe": { fx: 33, ms: 1600, range: 650, speed: 1180 },
    "Diamond Blowpipe": { fx: 34, ms: 1600, range: 650, speed: 1180 },
    "Emerald Blowpipe": { fx: 35, ms: 1600, range: 650, speed: 1180 },
    "Amber Blowpipe": { fx: 36, ms: 1600, range: 650, speed: 1230 },
    Slingshot: { fx: 10, ms: 1050, range: 600, speed: 1190 },
    "Golden Slingshot": { fx: 13, ms: 1050, range: 600, speed: 1190 } },
  // invented fairy staffs (owner): items 341..352 (client: tools/invented/client_patch.js, art tools/invented/make_staffs.py), one per
  // fairy; a cast throws that fairy's boss-stage ball (creatures.js fairyBall: its kind, first hit, damage over time and
  // status) at the first enemy on the aim line within range, else at range. The field lasts the fairy skill's own life like a pet ultimate (owner; life_ms > 0 overrides) and the ball flies over buildings.
  // ms: the full damage to a player (field + lingering) / 14 per s, 1500..3000; Ice longer so its freeze cannot chain;
  // hit: the tooltip's damage (the ball's first hit on a player, creatures.js), shown by the client only
  // gather_as: each cast also gathers / hits buildings as a Stone Spear (item 9) swing (owner)
  staffs: { range: 650, life_ms: 0, speed: 0.75, f15: 500, gather_as: 9, items: {
    341: { el: "fire", sp: 18, name: "Fire Staff", ms: 2000, hit: 15 },
    342: { el: "water", sp: 17, name: "Water Staff", ms: 1500, hit: 12 },
    343: { el: "ice", sp: 37, name: "Ice Staff", ms: 2600, hit: 12 },
    344: { el: "plant", sp: 19, name: "Plant Staff", ms: 2100, hit: 15 },
    345: { el: "electric", sp: 50, name: "Lightning Staff", ms: 2800, hit: 15 },
    346: { el: "rock", sp: 45, name: "Rock Staff", ms: 1500, hit: 15 },
    347: { el: "spectrum", sp: 52, name: "Spectrum Staff", ms: 2100, hit: 5 },
    348: { el: "poison", sp: 51, name: "Poison Staff", ms: 3000, hit: 7 },
    349: { el: "dragon", sp: 46, name: "Dragon Staff", ms: 3000, hit: 12 },
    350: { el: "insect", sp: 55, name: "Insect Staff", ms: 2900, hit: 6 },
    351: { el: "combat", sp: 36, name: "Combat Staff", ms: 2300, hit: 27 },
    352: { el: "normal", sp: 38, name: "Normal Staff", ms: 1500, hit: 10 } } },
  eat_fx: 203, eat_fx_variant: { Sandwich: 0, Salad: 1, "Mushroom Soup": 2 }, eat_fx_ms: 3000,
  achievements: [["sbw", "29", 1000], ["sbs", "26", 1000]],
  repair_reload_ms: { default: 6000, "Stone Repair Tower": 6000, "Golden Repair Tower": 8000, "Ruby Repair Tower": 6000, "Amethyst Repair Tower": 8000, "Sapphire Repair Tower": 6000 },
  join_values: { 11: { o: 69 }, 86: { o: 33 } },
  place_angle_off: { spike: 1.5708, turret: -1.5708, pad: -1.5708 },
  // sp5 builds: field 5 = round(aim * 100) + this per family, aim in [0, 2pi), not wrapped (spike 1184 seen)
  place_rot_100: { spike: 785, wall: 785, windmill: 785, turret: 471, tower: 471, pad: 471, door: 628 },
  // sp5: only these carry the placer 16 and his clan 15; pad, windmill, repair tower and wall creates have neither
  place_owner_fams: ["spike", "turret", "door"],
  eat_anim_ms: 350, eat_restore_ms: 370, heal_first_ms: 660, heal_tick_ms: 470, heal_ticks: 6,
  heal_tick_by_item: { Sandwich: 4, Salad: 6, "Mushroom Soup": 8 },
  // wiki Food: speed buff foods +5 / 10 / 15 % walk speed, defense buff foods 10 / 15 / 20 % (read as damage taken x0.9 / 0.85 / 0.8);
  // the wiki gives no duration: 10 s guess; a buff food can be eaten at full hp (guess, it is eaten for the buff)
  food_buff: { "Toffee Candy": { speed: 1.05 }, Biscuit: { speed: 1.1 }, "Roll Cake": { speed: 1.15 }, Steak: { def: 0.9 }, Eggs: { def: 0.85 }, Meatballs: { def: 0.8 } }, food_buff_ms: 10000,
  start_fraction_by_item: { "Stone Axe": 0.48, "Amethyst Pickaxe": 0.43, "Ruby Hammer": 0.6, "Sapphire Pickaxe": 0.67, "Ruby Axe": 0.53, Hand: 0.81,
    "Golden Axe": 0.86, "Golden Pickaxe": 0.81, "Ruby Pickaxe": 0.82 },
  // recorded swing gaps (median, held attack, all players in 7 recordings) where reload + swing_extra_ms is off by 40+
  swing_ms_by_item: { "Stone Shield": 566, "Golden Shield": 570, "Stone Daggers": 380, "Golden Daggers": 380, "Ruby Daggers": 380, "Diamond Daggers": 380,
    "Amethyst Daggers": 380, "Sapphire Daggers": 380, "Emerald Daggers": 380, "Amber Daggers": 380, "Raptorial Daggers Level 2": 380,
    "Stone Sword": 880, "Diamond Sword": 880, "Ruby Hammer": 660, "Amethyst Hammer": 660, "Golden Pickaxe": 940, "Sapphire Pickaxe": 1040,
    "Amethyst Axe": 1120 }, f15_by_item: { "Golden Minigun": 250, "Ruby Minigun": 250, "Amethyst Minigun": 250, "Sapphire Minigun": 250, "Diamond Minigun": 250, "Emerald Minigun": 250, "Amber Minigun": 250 },   // all miniguns animate like the recorded Golden one
  spectate_cam_delay_ms: 230,
  f15_by_family: [[" Daggers", 300], [" Gloves", 300], [" Blowpipe", 350], [" Musket", 700], [" Labrys", 1000], [" Crossbow", 1300]],
  join_extra: [],
};
// wiki weapon tables (mimic/data/wiki/items.json): walk speed % / 100, damage vs animals / players, keyed by the in-game name
function wikiTables(g) {
  const out = { speed: {}, animal: {}, player: {}, building: {}, durability: {}, knockback: {} };
  let W = {};
  try { W = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "wiki", "items.json"), "utf8")); } catch (e) { return out; }
  const val = (x) => (x && typeof x === "object" ? x.value : x);
  for (const it of Object.values(W)) {
    let nm = String(val(it.name) || "");
    for (const suf of g.speed_food_wiki_suffix) nm = nm.replace(suf, "");
    nm = nm.replace("Sapphire / & Cosmetics", "Sapphire").trim();
    if (!nm) continue;
    if (typeof val(it.speed) === "number") out.speed[nm] = val(it.speed) / 100;
    if (typeof val(it.animal_damage) === "number") out.animal[nm] = val(it.animal_damage);
    if (typeof val(it.player_damage) === "number") out.player[nm] = val(it.player_damage);
    if (typeof val(it.building_damage) === "number") out.building[nm] = val(it.building_damage);
    if (typeof val(it.knockback) === "number") out.knockback[nm] = val(it.knockback);
  }
  try {
    const S = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "wiki", "structures.json"), "utf8"));
    for (const it of Object.values(S)) { const nm = String(val(it.name) || ""); if (typeof val(it.durability) === "number") out.durability[nm] = val(it.durability); }
  } catch (e) { }
  return out;
}
// client tooltip table (mimic/data/client_items.json, the client's own item stats): per item name
function clientTable() {
  const out = {};
  let J = {};
  try { J = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "client_items.json"), "utf8")); } catch (e) { return out; }
  for (const it of Object.values(J.items || {})) {
    const t = it.tooltip || {}, nm = it.items_json_name || it.name; if (!nm) continue;
    const one = typeof t.damage === "number" ? t.damage : null;
    out[nm] = { dmg_player: t["damage-tamer"] != null ? t["damage-tamer"] : one, dmg_animal: t["damage-animal"] != null ? t["damage-animal"] : one,
      dmg_building: typeof t["damage-building"] === "number" ? t["damage-building"] : null, speed: typeof t.speed === "number" ? t.speed : null,
      range: typeof t.range === "number" ? t.range : null, knockback: typeof t.knockback === "number" ? t.knockback : null,
      durability: typeof t["building-durability"] === "number" ? t["building-durability"] : null, harvest: Array.isArray(it.harvest) ? it.harvest : null,
      reload_ms: /^[\d.]+s$/.test(t.reload || "") ? Math.round(parseFloat(t.reload) * 1000) : null };
  }
  return out;
}
// corpus measurements (tools/scan/scan_facts.py over every decoded scan and human capture, rebuilt by the hourly stitch):
// swing period per item = median gap of held attacks (20+ samples, 5+ captures); range per projectile kind = p90 straight travel
// (5+ shots, p90 flight 0.4 s+ so shots that hit at once do not count), a weapon whose kind has fewer takes the median of its family (Bow, Crossbow, ...) when that has data
function scanFacts(g) {
  let F; try { F = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "scan_facts.json"), "utf8")); } catch (e) { return; }
  g.swing_ms_by_item = Object.assign({}, g.swing_ms_by_item);
  const tip = (n) => { const c = g.client && g.client[n]; return c && c.reload_ms != null ? c.reload_ms + g.swing_tip_extra_ms : null; };
  for (const v of Object.values(F.swing || {})) if (v.name && v.n >= 20 && v.files >= 5 && v.median_s > 0) {
    const ms = Math.round(v.median_s * 1000), t = tip(v.name);
    if (t == null || Math.abs(ms - t) <= g.swing_scan_tol_ms) g.swing_ms_by_item[v.name] = ms;
  }
  // owner: an item without an accepted recording swings like its recorded siblings with the same tooltip reload (median), so Ruby..Amber
  // Cleavers swing like the recorded Golden / Diamond ones (499 / 476; Ruby 499, Sapphire 503, Amber 478 on 5..23 swings), not tooltip + 150 (550)
  const kin = (n) => n.replace(/^(Stone|Golden|Ruby|Amethyst|Sapphire|Diamond|Emerald|Amber) /, ""), sib = {};
  for (const v of Object.values(F.swing || {})) if (v.name && g.swing_ms_by_item[v.name] != null && tip(v.name) != null) (sib[kin(v.name) + "|" + tip(v.name)] = sib[kin(v.name) + "|" + tip(v.name)] || []).push(g.swing_ms_by_item[v.name]);
  for (const n of Object.keys(g.client || {})) if (g.swing_ms_by_item[n] == null && !(g.ranged || {})[n] && tip(n) != null) {
    const xs = (sib[kin(n) + "|" + tip(n)] || []).slice().sort((a, b) => a - b);
    g.swing_ms_by_item[n] = xs.length ? xs[xs.length >> 1] : tip(n);
  }
  const fam = (n) => n.replace(/^(Stone|Golden|Ruby|Amethyst|Sapphire|Diamond|Emerald|Amber) /, "").replace("Crossbow", "Bow"), byFam = {};   // crossbows shoot the arrows
  const got = (fx) => { const q = (F.proj || {})[fx]; return q && q.n >= 5 && q.life_p90_s >= 0.4 && q.range > 0 ? q.range : null; };
  for (const [n, R] of Object.entries(g.ranged || {})) { const r = got(R.fx); if (r) (byFam[fam(n)] = byFam[fam(n)] || {})[R.fx] = r; }   // once per projectile kind
  for (const [n, R] of Object.entries(g.ranged || {})) {
    const xs = Object.values(byFam[fam(n)] || {}).sort((a, b) => a - b), r = xs.length ? xs[xs.length >> 1] : got(R.fx);   // balance pass: one range per family, the median over its projectile kinds (arrow p90s 719..986 on 5..14 shots)
    if (r) g.ranged[n] = Object.assign({}, R, { range: r });
  }
}
function gameConfig(over) {
  const g = JSON.parse(JSON.stringify(DEFAULTS));
  for (const [k, v] of Object.entries(over || {})) if (!k.startsWith("_")) g[k] = v;
  g.client = clientTable();
  scanFacts(g);
  const w = wikiTables(g);
  g.speed_by_item = Object.assign({}, g.speed_by_item);
  for (const S of Object.values((g.staffs && g.staffs.items) || {})) { g.speed_by_item[S.name] = g.staffs.speed; g.f15_by_item[S.name] = g.staffs.f15; }
  // balance pass: field 15 (attack animation ms) = the client item's own value per family (game_rc _8438; hand 300, the rest 500)
  for (const n of Object.keys(g.client || {})) for (const [suf, v] of g.f15_by_family) if (n.endsWith(suf) && g.f15_by_item[n] == null) g.f15_by_item[n] = v;
  g.wiki_speed = w.speed; g.wiki_damage = { animal: w.animal, player: w.player, building: w.building }; g.wiki_durability = w.durability; g.wiki_knockback = w.knockback;
  return g;
}
module.exports = { gameConfig, DEFAULTS };
