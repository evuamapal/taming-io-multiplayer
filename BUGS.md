# Known bugs and gaps

## v0.4.0 (2026-10-18) known gaps

- World boss attack damage and radius are from the wiki or guessed; the stone golem, fire dragon, ice bosses, octopus,
  spectrum and mushroom boss have no recorded attacks yet and use their generic skill. Fairy waves at 75 / 50 / 25 %
  and boss chests are not built. Respawn time (5 min) and aggro range (650) are guesses.
- Spectrum and fire dragon spots come from other servers' maps.
- The darkness boss built from the mushroom boss's creature slot draws as a large tree; it may be the dark-tree boss.
- Pet attack and chase use the recorded cadence (600 ms) but no recorded engage range; idle pause lengths are guessed.
- Building-in-hand walk speed follows the client item table (60 %).
- Player body sizes per species and stage come from the client table; the base recording has too few close contacts
  to confirm them.

## v0.3.2 (2026-10-18) known gaps

- A browser window much wider than 16:9 crops the top and bottom of the game, as in the real client (fullscreen shows everything).
- The /fart cloud reuses the skunk fog effect; original art is pending.
- Invented pets and their skills are not from the real game.

## v0.3.1 (2026-10-18) known gaps

- Not in the recordings, so still guessed: pet growth thresholds, food per creature kill, pet skill damage and radius, minigun and slingshot damage, range and fire rate, burn damage, windmill income above wooden, repair tower second heal and range.
- No tornado or meteorite in the world, only their minimap markers.
- Wild creatures respawn one by one at their home spot; the real game spawns small packs, but when and where is not known.
- The death screen camera id ends in 2; the recordings show 2, 10 and 220 and the rule is unknown. The menu camera does not follow a live player.
- Mid-phase gift drops are one per 129 s map-wide (extrapolated from one view); gift lifetime unknown.
- The restore token the real server sends about 3 min into a life is not sent.
- Chat log panel stays in BACKLOG.md.

## v0.3.0 (2026-10-18) known gaps

- Players walking through each other matches the real game: tonight scans show players overlapping down to 5 units apart.
- Map areas the owner never saw are filled with synthetic objects (tagged synthetic); dark and desert are the thinnest.
- Dark-phase spawn has no creatures nearby (same as the recording).
- Shop/cosmetics other than the in-game hat shop are not supported; wings unseen.
- Values the recording cannot show come from the community wiki or are guesses, tagged per value.
- Admin mode and the chat log panel are in BACKLOG.md, not in this release.

## v0.2.0 (2026-10-17)

- Guessed, not measured (the recording had no animal kill and few weapon hits): animal HP 60, XP 20
  and food 5 per animal kill, player-kill XP, damage of weapons other than the hand (hand 4 is measured),
  spike damage timing. All guesses are marked in `mimic/hosted_config.json` under `game_sources`.
- Not observable in the recording: the player's own radius, water-edge collision, the real AFK timeout
  (15 min chosen; no kick seen in 112 s idle).
- Animals only wander: no attacks, fleeing or taming. No pets, projectiles, towers, clans, quests.
- Food heals instantly (the real game heals some foods over time).
- Placed walls and spikes disappear when their owner leaves.
- Chat drops `<` and `>` characters.
- Every room uses the Atlanta #4 snow world (about 115 recorded objects); the map outside it is empty.
- The page logs "Widget is not defined" (the dead third-party widget script); harmless.
- The leaderboard shows in the game; the proof checks it from a screenshot, not from decoded frames.
- 38 item icons were never recorded and still show blank (from v0.1).
## v0.1.0 (2026-10-17)

- Only Atlanta#4, snow biome, about 115 recorded world objects.
- 38 item icons were never recorded and show as blank squares (pick panel, hotbar).
- XP: in the real game you also age up from killing animals; the mimic's animals can't be hit or killed yet, so kill XP is missing (planned for a later version). Gather XP is 5 per stone/wood hit (approximate). In the real game spikes unlock at age 3 and hurt animals (and killing animals gives XP); in the mimic, spikes only hurt the player and animals take no damage yet.
- Collision radii and gather yields are guessed from object names, not the real client defs.
- Animals only wander: they do not fight, flee or get tamed.
- No other players, chat, crafting or taming. Replay mode is one fixed recorded timeline.
- `./play.sh demo` covers menu, Play, walk, gather, age up x2, HP loss, death and respawn, but its
  pick-panel, hotbar, wall and food steps do not register in this package's CDP driver (0 select
  ops reached the server), so those features are proven only by the rnd_ws mimic proof run, not by
  this package's demo. Not re-checked by hand in this package either.
- Chrome itself still tries google.com background calls (accounts, autofill, update); they reach
  only the local server and get a local 404 (visible in `server.jsonl`).
