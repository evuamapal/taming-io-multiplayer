# Clone features (v0.6.0)

What the hosted taming.io clone does, where each number comes from, and what is still missing.

Sources:
- **recorded**: measured from the owner's play sessions (the 45 min Sao Paulo #5 base session plus 10 more human
  sessions) or from the 335 capture-mode scans.
- **client**: the game client's own tables (items, creatures, hats).
- **wiki**: the community wiki (mimic/data/wiki).
- **guess**: no data; picked to play well and marked in the code (`SOURCES` blocks in mimic/hosted/*.js).

## World

| Feature | Source |
|---|---|
| 6 biomes rotating in real time (forest 16 min, then winter, darkness, desert, ocean, volcano 8 min each), live countdown, /next and /prev | recorded |
| Map layout per biome: the base session plus every object seen in 335 scans and 10 human sessions (base wins, then newest) | recorded |
| Wild creatures: species, type and stage mix per biome and density per view from the full-length scans | recorded |
| Creature movement: A* pathing, wander run lengths and pauses | recorded |
| Creature damage, reach, aggro for the measured species | recorded; others client or guess |
| Creature respawn time | guess |
| Chests (gifts): 5 hits, loot per gift type, map-wide drop every 129 s | recorded |
| Resource depletion and same-spot respawn | recorded |
| Hourly stitch loop (com.taming.stitch): new scans and play sessions are decoded, stitched, self-tested and deployed | |

## World bosses

| Feature | Source |
|---|---|
| Each season's bosses at their recorded minimap spots, removed at the season end | recorded |
| Stats (hp, xp, gold) | client |
| Attack effects and cadence: Trent, volcanic golem, cactus boss, ice golem, stone golem, dark-tree boss, gold golem, ice dragon line | recorded |
| Fire dragon: meteor marker 27, then a fire puddle (561..567) 3.6 s later on the player's spot; flame line every 141; aggro 1000 | recorded (puddle damage split: guess) |
| Boss attack damage where no hit on a player was recorded | wiki or guess |
| Fairy waves at 75 / 50 / 25 % (3 adults; 1 boss + 2 adults; 3 boss fairies) for the cactus, mushroom and dark-tree bosses; haunted tree types random | wiki (types per minion: recorded) |
| 3 boss chests on a kill, 14k gold each, recorded layout | gift ids and layout: recorded; gold: wiki; mushroom ids: guess |
| Boss respawn 5 min, default aggro 650 | guess |

## Player

| Feature | Source |
|---|---|
| Walk speed, slow-down per held item, glide, map edge, view box, 94 ms frames | recorded |
| Collisions: buildings at their real footprint, diagonal wall gaps passable, a new wall pushes the placer out, a spike does not | recorded |
| Body size per creature species and stage | client |
| Weapon damage per item (the client tooltip, confirmed by 32 clean received hits) | client + recorded |
| Swing cadence per item (daggers 0.38 s, swords 0.88 s, hammers 0.66..0.75 s) | recorded |
| No knockback from player weapons | recorded |
| Hit arc 1.2 rad | guess (the recordings only bound it to about +-75 degrees) |
| Death screen with the 17 scoreboard fields, 5 s respawn shield, 1/3 XP kept | recorded |
| Age-up item picks and XP thresholds | recorded / client |
| Hat and wing shop, 70 hats and 38 wings with their effects; Knight's Helmet x0.6 damage taken | client; helmet recorded; other effects wiki or guess |
| Clans, clan chat, no friendly fire | recorded |
| Chat bubbles and the chat log panel | |
| Mobile touch joystick | recorded (client ops) |

## Buildings

| Feature | Source |
|---|---|
| Placed 62 from the player center (boost pad 100) | recorded |
| Rotation field 5 = aim * 100 + 785 (spike, wall, windmill) / 471 (turret, tower, pad) / 628 (door) | recorded |
| Owner fields 15 / 16 only on spikes, turrets and doors | recorded |
| Placement refused on overlap | recorded spacing per type |
| Turrets fire every 1.25 s; amethyst turret 19 to players; stone 12 | recorded; other tiers wiki |
| Repair tower heal pulses | recorded (second heal and range: guess) |
| Boost pads, doors, windmill gold, decay, 50 % refund | recorded; windmill tiers above wooden: guess |
| No crafting: none appears in any recording | |

## Pets

| Feature | Source |
|---|---|
| Menu picker: every species (155) unlocked plus Stormhorn and Cinder Prowler (local account: ice badge, 3 slots) | owner's choice |
| The picked pets spawn with matching cards; nothing forced; no pick = the wolf | |
| Follow: runs once the owner is 430 away until 300, at 270 (rabbit 365) | recorded (9 sessions) |
| Idle: walks non-stop between 167 and 393 from the owner at 67 | recorded |
| No teleport back (real pets run back) | recorded |
| Bite reach 95 (target radius + 50), one bite per 1.25 s, give up at 900 | recorded |
| Commands: right-click go-to (shift: all pets), stop, attack, defense; the spot wander up to 200 | recorded |
| Release: the pet turns wild and attacks its former owner | recorded |
| Wolf ult: rides on the wolf, one hit at +280 ms within 175, then a 10-tick burn every 240 ms | recorded |
| Rabbit, bear and snowball skill effects and lives | recorded |
| Pet growth by kill XP, level-based hp | recorded thresholds, partly guess |
| Riding: any species with the Saddle; a Saddle swing while riding dismounts; rider speed = normal walk | recorded (any species: owner's choice) |
| Stormhorn and Cinder Prowler: invented pets with their own art, ultimates and passives | invented |

## Admin and commands

/help, /admin (god mode; every hit takes half the target's max hp; creatures, pets and players are pushed aside while
solids still block), /spawn, /spawnall, /tp, /give, /age, /heal, /speed, /fart, /kick, /die, /easy, /nodecay, /dodecay,
/reset, /next, /prev, /biome, /version.

## Known gaps

- Menu card art is missing for the species the mirror never fetched (see the latest deploy note).
- Boss damage for the octopus, spectrum, mushroom boss and ice dragon: no recorded hits on a player; wiki or guess.
- The fire dragon's moving fireball (kind 124) is not built.
- The rare chest mimic, tornado and meteorite world events: minimap markers only.
- Wild creatures respawn one by one at their spot; real pack spawning is unknown.
- Pet skill damage to players: not recorded.
- The account is synthetic (the owner's sessions were guest sessions); the reward timer is synthetic.
- The darkness boss from the mushroom slot may be the dark-tree boss.
- Unit tests: a few invented-pet and chase-path checks are timing-flaky.

## Added for v0.6.0

| Feature | Source |
|---|---|
| Local account: logged in as Offline#67, ancient badge, every species unlocked, golden apples never drain, pet chests open locally (3 species, +10 tames each) | owner's choice |
| Badge above every name and on the board (field 20 / board 4th value = rank + 1) | client |
| No achievement popups (every player has them all) | owner's choice |
| OB 30 level 60 pets, maxed stats x1.5 | display: client; stats: guess |
| Pet stats per species: recorded wolf values x the species wiki ratio | recorded + wiki |
| Collision: creatures and pets at r1 + r2, vs players r + 43.5, players 87 apart (strong push) | recorded (351 sessions) |
| Riding any species; a Saddle swing dismounts | owner's choice |
| Admin: 50 % max hp per hit, pushes through crowds | owner's choice |
| Air Blast Gun (purple, first pick): pokes 8, 3 cone waves push everything | invented (POC) |
| Grove Colossus: the forest world boss (mammoth slot), root bursts with warning markers, bramble line, fairy waves, chests | invented (POC) |
| Tornado event: the biome tornado at the minimap marker wanders, hurts and pulls players; a player inside at the end wakes the boss dog (Acidog, Coldog, Voltdog, Bugdog, Floodog, Rexdog); meteorites land on the volcanic marker | scans (objects, speed) + wiki; damage, pull, life: guess |
| Ashen Snare and Tempest Crown with their own art on free effect ids | invented |

Known gaps (v0.6.0 sweep): a released pet may not attack its former owner and the pet idle walk can stall since pet collision; right-click go-to next to a tree is ignored; the air gun's own wave art slot does not render (it uses the fart cloud); baby dogs after a boss dog kill are not dropped.
