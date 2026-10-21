# Changelog

## v67 (2026-10-20)

Everything built from 2026-10-18 to 2026-10-20 (v0.3.1 through v0.9.2, then v67). Live on wearedumb and the
static Pages build. "Guess" marks numbers with no recording or wiki data behind them.

### Pets
- Every owned pet spawns at level 67, a new invented max level with its own badge (levels 61 to 66 got badges too).
- 6 pets per player: 3 slot pets plus 3 extras (statues, shadows, gazes; extras never cast an ultimate).
- Any sleeping creature can be tamed; your own pets and buildings can't hurt the creature you are taming.
- Hive Creep in the dark forest every season (/hive): break it, kill the BMB shadow, 7 eggs hatch tameable baby shadows.
- Pet AI from 9 recorded sessions: follow band, idle walk, catch-up speed, bite reach and cadence.
- Pets bite whatever blocks them, never give up, face what they chew, and chew trees, rocks and logs.
- Right-click pet orders: go to a spot or attack an enemy, building or player; pet release turns it wild.
- Dash pets: real dash speed and length per species and stage (2062 recorded pets); heavy while dashing.
- Riding: every saddle mounts (age 25+ saddles included), the nearest own pet, quick clicks count; a ridden dash
  carries the rider with the pet and stops when the dash ends.
- Pet names: rename from the card, shown to everyone. Minimap shows a paw for every owned pet.
- Invented pets in their own species slots (155 to 157), the Fart type and badge, Stormhorn, Cinder Prowler and the
  Grove Colossus with their own skills and art.
- Statue potions spawn statue pets (one per potion, up to the 3 extras); potion icons next to the Age bar.
- Trinkets: up to 3 per pet from the real pet menu, effects on bites, defense, regen, speed and XP; potion pets
  inherit a team slot's trinkets (the inheritance rule is a guess).

### Combat, weapons and buildings
- Every ranged weapon shoots its real projectile from the client table (34 weapons): bows were off by one, 4
  miniguns swung like melee before.
- Miniguns fire 8 shots a second (the server tick was dropping every other shot). Bullets gather from trees, stones,
  bushes and logs; gold only stops them.
- Shots stop at the first solid; log hitboxes match their capsule.
- Towers throw their fairy's exact ball, with the same status effects; turrets aim and their cannonballs fly to the
  target. Fairy balls fly from the fairy to its target.
- Fairy status effects: Ice freezes, Lightning paralyzes, Vortex slows, Plant drains (durations are guesses).
- Bear traps arm, damage and stun. Wrench repairs own and clan buildings. Glove knockout after 3 hits in a row.
- Every hat and wing does what the client says (type boosts, capes, Nurse, Trapper, Magician, Rogue, Tamer,
  Bee Keeper's, Lucky, Pup Tail). Buff foods for speed and defense (10 s duration is a guess).
- Boss Giant Mantis turns your daggers into Raptorial Daggers; a boss Enchanting Gaze enchants the spear.
- Appletor apples heal players and pets.
- Hold to place buildings with no delay; buildings still never overlap.
- Air Blast Gun (invented).

### Movement and collision
- Frictionless sliding for players, pets and animals: an off-centre hit slides around, a dead-centre hit stops (and
  animals bite), a blocked slide stops.
- Soft bodies: pets, players and animals nudge each other; structures and big world bosses never move.
- While a move key is held the player is 12% smaller and squeezes through tight gaps.
- Collision sizes from the recordings: stones per def, big gold, walls, spikes, logs, every creature per stage.
- Random spawn point on join and after every death.

### World, bosses and events
- World bosses draw their real art (the state field 7 boss bit was missing): Gold and Stone Golems, Mushroom Boss,
  Trents, Snow Trent, Dragon Egg, Ice Golem and Dragon, Cactus, Octopus, Volcanic Golem, Fire Dragon.
- New per-season world bosses: Trent, Dragon Egg, Snow Trent, Lava Golem. World bosses leave 3 sleeping tameable babies.
- Gold Golem: 40,000 hp, meteors, slams and helpers from the recorded fight; 4 gold chests laid out as recorded.
- Fire Dragon sky laser, Mushroom Boss bombs, boss fairy waves, stone golem impact.
- Grove Colossus (invented) spawns at a random forest spot far from players.
- Ocean Sanctuary: 3 solid statues wake their BMBs, then the chest and the BMB Siren; the chest gives Guardian's Heart;
  the Siren drops 3 baby Sirens that sleep and tame at 11%.
- /event: christmas, easter, halloween, thanksgiving, genie, mammoth, yeti, siren, gaze, with their legendary
  animals, chests and breakable eggs (chest art is a guess). Every season also runs its own events.
- Genie lamps in the desert; /restart runs the real server-restart Reapers.
- Insects: 59 bug kinds by biome, Wasp Nests and Porous Rocks, bugs flee players, Bug Net catches in 1 hit, a toad
  tongue catches at the tip and hurts otherwise.
- Trinket bushes (Golden Flower Bush, Oathbud), season objects at recorded density, tornado and meteorites.
- Totem: one per server, curse and points, /totem shop.

### Menu and account
- Mock account for every menu call: all pets, skins and achievements unlocked, infinite golden apples, house with
  real furniture, tamers exam with a reveal button.
- Potions picked in the menu apply in game (Philter of Aging starts you older).
- Potion cooking: all 78 real recipes, ingredients used, real success odds and luck potions.
- Mauve shop selling works with hourly trade counters (sell prices are guesses).
- Ancient chest gives 5/10/15 card piles to unfinished pets, closest to max first.
- Clan tag 67 by every name, #1 trophy, Fart badge.

### Chat commands
- /versus (pets vs bosses, mobs or pets), /versus epic, /versus player (survive the swarm), /versus stop; armies built
  from every pet and boss in the game, using their own skills and full boss attacks.
- Admin and test commands: /admin, /spawn, /tp, /give, /age, /biome, /boss, /pet, /cast, /hive, /event, /restart,
  /easy, /fart, /die, /reset.
- Debug mode on O: hitboxes, creatures, pets, players and an A to H / 1 to 8 minimap grid.

### Pages build and infrastructure
- Static GitHub Pages build of the clone (in-page engine), now with insects, cooking, potions and every runtime file;
  a check blocks any real-domain reference.
- Images: 122,572 mirrored, the client's full image table about 99% covered; new images go live without a deploy.
- Deploys: one global lock, no rollbacks, the version floor (now 67), the real commit hash recorded.
- Tracker dashboard: Pets tab, sortable columns, tab emojis, Quiet and Pets tabs, Play clone link, more Chromes.

## v0.9.1 (2026-10-20)

Measured numbers now come from the whole capture corpus (every scan and play capture, refreshed every hour), not one
old capture.

- Pets run and dash at their own measured speed per species (2062 pets seen); the dash speed was a guess before.
- Swing speed per weapon comes from about 10,000 recorded swings (39 weapons); bow, blowpipe and minigun ranges come
  from the recorded shots (bows ~920, blowpipe ~635, minigun ~766).

## v0.9.0 (2026-10-20)

Guessed numbers checked against the real game recordings; the ones the recordings cover now use measured values.

- Bows: the Golden Bow fires every 1.55 s (was 1.25 s) and arrows fly about 1100 (was 750) for every bow, measured on
  a recovered fight capture (ws_20261019_140012).
- Gold Golem: its Golden Slam comes every 8 s (was 6 s), from a near-boss scan.
- Stone golem: its impact hits for 50 (was 20), from a near-boss scan (one hit).
- Everything else marked "guess" was checked and has no data in the recordings yet (tornado and meteorite lifetimes,
  boss respawn and aggro, hat bonuses, clan limits); see the guess audit for the list.
- Also in this version: debug mode (O), dash pets, pets biting buildings, log capsule hitboxes, shots blocked by solid
  objects, the Gold Golem and Mushroom boss attacks from recordings, and every achievement marked done.

## v0.4.0 (2026-10-18)

World bosses, real collisions and placement, pet commands and pet AI from the recordings, mobile touch fixes and the
real art for bosses and items.

- World bosses: each season spawns its set of creature bosses at their recorded minimap spots and removes them when the
  season ends. They stand still, turn to attack, and cast their recorded attacks at the recorded cadence (Trent,
  volcanic golem, cactus boss); the forest Trent, ice dragon and ice golem, spectrum, mushroom boss, stone golem,
  cactus boss, octopus, volcanic golem and fire dragon are all in. Stats come from the client creature table.
- Real boss and item art: about 440 boss frames, item icons and building sprites the game loads by hashed name are now
  mirrored, so bosses, picker cards and hotbar slots show their real art.
- Collisions: buildings block at their real footprint (walls and spikes 5 % inside it, so gaps the real game allows
  stay passable), diagonal gaps between two walls work, and pets, animals and bosses collide and get hit at their
  real size per species and stage. Pet pathing keeps each pet's own size, so small pets take gaps big ones cannot.
- Placement: buildings land 62 from the player center as in the real game; a new wall pushes the placer out, a spike
  does not shove him and only blocks once he has walked off it; buildings never overlap each other or players.
- Pet commands: right-click sends the selected pet to the spot (shift + right-click: all pets), where it stays and
  wanders at any distance until recalled; the stop button holds a pet where it is; attack or defense recalls it.
- Pet release turns the pet wild on the spot, it attacks its former owner, and its card leaves the pet bar.
- Pet AI from the recorded wolf track: it wanders 200 to 350 from a still owner and catches up faster the farther
  behind it is, at the recorded speeds.
- Mobile: the touch joystick moves the player and stops on release, also when the system cancels the touch.
- /spawn and /spawnall place creatures at half the old distance; /fart has its own fart cloud art.

## v0.3.2 (2026-10-18)

Admin and chat commands, invented boss pets, recorded creature movement and a set of play fixes.

- Ads, cross-promo, featured video, partners box and the adblock popup are hidden.
- Commands: /tp spawn, /nodecay and /dodecay, /easy (10x gathering and XP, pets jump to the boss stage), /fart (a hard forward launch with a cloud, 3 s cooldown); /die gives the same fresh start as /reset for that player.
- Admins never hit a building limit.
- Item stats (damage, speed, reach, knockback, gathering) come from the client item table; recorded values win where the recording has them.
- Creatures wander and chase with A* pathing taken from the recordings, and never walk back to their spawn.
- Two invented boss-stage pets, Stormhorn and Cinder Prowler, come with every player, each with its own art, ultimate and five passives.
- No friendly fire inside a team: players, pets and buildings are safe from teammates.
- Pet ultimates always cast; boost pad art faces the push direction.
- The leaderboard shows each player's current gold.
- Welcome line in the chat log on join; up to 8 sockets per IP with dead sockets dropped after 30 s.
- Game pages carry a darkreader-lock meta and clear the browser cache once per build, so stale item art never sticks.

## v0.3.1 (2026-10-18)

Timing fixes from the owner's second Sao Paulo #5 recording (2 h, 118 min of it on the death screen), which shows what the real server sends to a dead player.

- Leaderboard every 32 server frames (about 3 s) and only while you are alive (was every second, also on the death screen).
- Own minimap position every 127 frames (about 12 s), only while alive (was every 8 frames).
- Tornado and meteorite minimap markers are no longer sent to dead players.
- Death screen camera: one camera update about 0.27 s after each client re-key, like the real server (was a fixed 1.2 s timer).
- Your pet shows its dying state in your death frame and disappears one frame after you (was removed at once).
- Chat commands /spawn, /tp, /give, /age, /biome, /kick, /heal, /speed; structures keep their spacing from their real sizes.
- 640 more mirrored game files that were blank or missing (sounds, sprites and icons the client asks for).

## v0.3.0 (2026-10-18)

Built from the owner's 46 min Sao Paulo #5 recording (base), the older Atlanta #4 winter session (fills gaps only) and the community wiki (where the recording is silent). Every value is tagged recording / wiki / guess.

- World: all 6 biomes rotate in real time (forest 16 min, then winter, darkness, desert, ocean, volcano 8 min each); one layout per biome from what the owner saw; joiners land in the current phase with the real countdown; SP5 spawn and starting kit; one listed server, Offline #1; all rooms are one shared world.
- Creatures named by real species (fixes the element-type mixup), aggression, kill XP by stage (baby 50, adult 100, boss 400, giant 1200), personal wolf pet with the Deflagration ultimate and baby/medium/adult growth, taming (wiki chances), riding, pet modes, turrets.
- Combat with recorded weapon damage and knockback; spikes; deaths with the full 17-field scoreboard.
- Building: boost pads (recorded push), repair towers, doors (open/closed fixed), windmill gold, 50% refund when breaking your own structures, resource depletion and respawn, chests with loot.
- Hat shop with in-game gold (Knight's Helmet 10000) and hat effects; age-up item picker reset on respawn; achievements; clans incl. decline, kick and locks; clan chat.
- Chat commands /next and /prev (/previous) switch the biome.
- 5,285 more mirrored game files (tool sprites, effects, sounds, biome music); held tools render.
- Fast reloads: day-long caching with ETags, pre-compressed script.
- Title bar and /version show the running version.
- Fixes: movement keys stuck after chat, golden-apple popup spam, empty leaderboard, boss marker index, single-room join, several memory leaks.

## v0.2.0 (2026-10-17)
Two packages from now on, same version: `tio_offline_server_v0.2.0.zip` (host it for everyone) and
`tio_offline_v0.2.0.zip` (one computer). Both built and gated by `bin/release.sh 0.2.0`.

- Multiplayer server `mimic/hosted_server.js`: plain HTTP + WebSocket on 127.0.0.1 (a TLS reverse
  proxy in front for the internet). The client, its assets, account/token calls, the server list and
  the game socket are all served from the request's own origin. Rooms Offline #1 and Offline #2, one
  shared world each, up to 40 players.
- Players see each other (names, moves, held item, swings, HP, damage numbers), hit and kill each
  other, death screen, respawn with shield; animals can be killed for XP and respawn; shared walls and
  spikes (spikes hurt players and animals); live top-10 leaderboard; chat bubbles.
- Real numbers from a 46-minute human session on the real Sao Paulo #5 server
  (`mimic/data/sp3_facts.json`, every value with frame evidence): walk 488 units/s, slow-down per held
  item, start and stop glide, collision distance per object family with sliding, map edge 350..17250,
  view box, hand damage 4, no passive regen, 1 XP per resource, respawn keeps 1/3 XP and part of the
  resources, 5 s shield, frames every 94 ms with 4 physics substeps.
- Zero outside calls, enforced in layers: `mimic/hosted/no_outbound.js` makes every Node outbound API
  throw (both servers, `--selftest-outbound`); strict CSP (own origin only), Referrer-Policy no-referrer,
  X-DNS-Prefetch-Control off, Permissions-Policy, COOP, X-Frame-Options; off-origin links and popups go
  to local `/_dead` or `/blocked` pages; no service worker; no manifest link; brand text carrying the
  real domain removed from the mirror and bundle.
- Robustness: per-IP socket limits (3 per forwarded client), AFK kick after 15 min, frame size, rate and
  backlog caps, garbage input never crashes the server; salted IP hashes only in logs.
- `./play.sh` runs the same multiplayer server on this computer (Chrome locked to it as before);
  `./play.sh server` serves other browsers on the same computer; `./play.sh demo` runs the two-browser
  proof. `./replay.sh` unchanged.
- Proofs in `proof_remote/hosted_m1_*` and `proof_remote/hosted_m2_*`; release gate output in RELEASE_NOTES.md.

## v0.1.0 (2026-10-17)
- First laptop package. Portable `./play.sh` (local mimic game server) and `./replay.sh` (one
  recorded Atlanta#4 session), both with a `demo` self-check mode.
- Built from the rnd_ws mimic as of Oct 17 07:34: age up with real XP thresholds and pick panel,
  hotbar 1-6, walls with cost/limit/collision, food refused at full HP and healing when hurt,
  wandering animals.
- Zero network: all taming hosts rewritten to `*.taming.invalid` (including the hex-escaped base
  domain in the game bundle), third-party hosts to `<host>.invalid`, mirror reduced to first-party
  entries, servers bound to 127.0.0.1, Chrome refused unless all local-only flags are set, fresh temp
  profile per run, 1 s socket watchdog that kills everything on any non-loopback socket.
- No capture, crawl, worker or seleniumbase code; the demo driver uses Chrome DevTools on 127.0.0.1.
- Proof runs on a helper machine in `proof_remote/`.
