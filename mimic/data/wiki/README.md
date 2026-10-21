# Community wiki extract (research data)

What was crawled
- Source: the game's community wiki on Fandom, read through its MediaWiki API (one host, HTTPS GET only, no redirects followed, no images or CDN, at most 1 request per second, User-Agent "tio-offline-research/1.0 (wiki reader)"). Every request is logged in work/wiki_requests.log (time, URL, status, bytes).
- When: 2026-10-17 15:32 to 15:43 (local time). 35 requests, all HTTP 200, 1.89 MB total.
- What: all 317 main-namespace content pages (list=allpages, non-redirects), the 547 redirect targets (alias map), 235 category names, 4 search queries (list=search: Water Bear, Knight Helm, Tardigrade, Deflagration) and 5 extra pages (Template:Pet Levels, Template:Animal Infobox, Template:Items Table, Module:Animals, Module:Animals/data). Wikitext was fetched in batches of 50 titles.
- Raw wikitext: raw/<title>.wiki plus raw/_index.json (title -> file, revision id, timestamp, categories, redirects, searches). raw/ is research only and is git-ignored. It must never ship in a package.

Files
- animals.json: 156 animals from {{Animal Infobox}}. Fields: type, biome(s), tool, mount, taming_chance, and stages baby / adult / boss with health, dmg, speed, weight, regen_points, regen_speed. Skill data is per stage (Reload, Player / Animal / Building Damage and their Over Time values).
- skills.json: 154 skills (name -> animal, description, per-stage data).
- bosses.json: 20 bosses from {{Boss Infobox}} (health, xp, type, biome, summoned animals, move damage text).
- hats.json: 57 shop hats, accessories and temporary hats from the In-game Shop tables (gold price, effect text, biome buff).
- items.json: 120 weapons, tools, food and saddles from {{Items Table}} and item infoboxes. Fields: damage, animal_damage, player_damage, building_damage, reload_s, speed (walk %), range, knockback, harvest yields, recipe.
- structures.json: 106 buildings (walls, doors, spikes, windmills, turrets, towers, pads, traps). Fields: durability, maximum per player, reload_s, damage, recipe.
- biomes.json: biome -> animals and bosses (from the infobox biome fields), plus minutes per biome.
- ../wiki_crosscheck.md / .json: the two-way comparison with the capture.

Every value is {"value": ..., "source": "wiki", "page": <wiki title>, "rev": <revision id>}. The parsed files contain no URLs and no real-domain text (parse.py asserts it).

Rerun
- python3 tools/wiki/crawl.py: lists pages, fetches only pages not yet stored. Flags: --refresh refetches all, --list-only lists only, --search TERM..., --titles TITLE....
- python3 tools/wiki/parse.py: rebuilds the JSON files above.
- python3 tools/wiki/species.py: writes work/wiki_species_*.json, the capture creature groups.
- python3 tools/wiki/crosscheck.py: rebuilds mimic/data/wiki_crosscheck.md and .json.

License
- Fandom wiki text is CC BY-SA 3.0 by the wiki's contributors. We ship only extracted numbers and short labels (stats, prices, names), each tagged with its page and revision for attribution. We do not ship the raw text.
- Attribution: "Game statistics from the community wiki on Fandom, CC BY-SA; see page/rev in each value."

Precedence
- recording > wiki > guess. A number measured in the Saopaulo#5 capture wins. The wiki fills what the capture lacks. "guess" is used only when neither has the number.
- Wiki numbers can be from a different game version. Every conflict is listed in ../wiki_crosscheck.md with the decision taken.
