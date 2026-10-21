# taming offline server - host it for everyone

A fully offline copy of the taming browser game that you host yourself. Players open your address in
any normal browser and play together in shared rooms ("Offline #1", "Offline #2"). The server and the
pages it serves never contact the real game or any third party.

## What you need

- A machine with Node.js 18 or newer (no npm packages, only Node's own modules).
- A domain name pointing at the machine and a TLS reverse proxy (Caddy is easiest, nginx works).
  Players can also use plain `http://` on a LAN, but browsers expect https on the internet.

## Start it

    cd tio_offline_server
    bin/hosted.sh start      # listens on 127.0.0.1:8920
    bin/hosted.sh status
    bin/hosted.sh stop

`bin/hosted.sh start` first runs `node mimic/hosted_server.js --selftest-outbound`, which proves that
every outbound network function in the server throws, and refuses to start if one does not.

Settings (environment variables or `mimic/hosted_config.json`):

| name | default | meaning |
|---|---|---|
| `PORT` | 8920 | listen port |
| `BIND` | 127.0.0.1 | listen address; keep loopback behind a reverse proxy |
| `MODE` | multi | `multi` = shared rooms (multiplayer); `single` = one private world per player (the v0.1 game) |
| `LOG_DIR` | logs/hosted | logs (rotated by size); client IPs are only stored as short salted hashes |
| `NODE` | auto | path to node for bin/hosted.sh |

Rooms, player and socket limits (40 players per room, 3 sockets per client IP, idle kick) and the game
numbers are in `mimic/hosted_config.json`.

Direct test without a proxy: open `http://127.0.0.1:8920/` on the same machine.

## Put it on the internet

The server speaks plain HTTP + WebSocket on loopback. A reverse proxy adds TLS and must pass `Host`,
`X-Forwarded-Proto` and `X-Forwarded-For` (the client address only, never a client-supplied chain: the
per-IP limit uses the first hop). The server derives every URL in the pages from `Host` and
`X-Forwarded-Proto`, so the game and its WebSocket stay on your own address.

- Caddy: `deploy/Caddyfile.example` (Caddy gets the certificate by itself).
- nginx: `deploy/nginx.conf.example`.

Run it as a service:

- Linux: `deploy/tio-offline.service.example` (systemd; also denies the process any non-local IP
  traffic at the kernel level).
- macOS: `deploy/tio-offline.launchd.plist.example` (LaunchAgent).

## Zero outside calls

- No outbound code: `mimic/hosted/no_outbound.js` loads first and replaces every Node API that could
  open a connection, resolve a name or start a process with a function that throws `OUTBOUND BLOCKED`
  and logs it.
- All game hostnames in the client are rewritten to `*.taming.invalid` (a name that can never resolve),
  then served from your own origin: static text, plus a small script in the page that maps hosts the
  game builds at runtime (server list, WebSocket) back to your address. Account and token calls are
  answered by this server from local data.
- Third-party ads, analytics and social links point at local `/_dead/...` or `/blocked` pages.
- Every response sends a strict Content-Security-Policy (only your own origin for scripts, images,
  fonts, connections and the WebSocket), `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`,
  a Permissions-Policy that denies camera, microphone, location, payment and the rest,
  `Cross-Origin-Opener-Policy`, `X-Frame-Options: DENY`. No service worker is registered.
- The release gates (see RELEASE_NOTES.md) scan every file for the real domain in any form, run the
  outbound self-test, start this package on a spare port and play it with two headless browsers that
  log every request they attempt and fail if anything other than the server is contacted, and watch
  the server's sockets with lsof the whole time.

Check it yourself: `bin/hosted_proof.sh --port 8920 --milestone 2` (needs Google Chrome and python3
with websocket-client) writes `logs/hosted_proof_<time>/report.md` with every host each browser tried.

## What multiplayer supports

Two rooms, Offline #1 and Offline #2, each one shared world for up to 40 players:

- Every player sees every other player in view: name (typed in the menu), movement, held item,
  swings, HP bar, damage numbers, deaths and respawns.
- Players hit each other (hand 4 damage per hit, measured), die, see the death screen and respawn
  near the spawn with a 5 s shield, keeping a third of their XP and part of their resources (measured).
- Gathering wood, stone, food and gold (1 XP per resource), aging up with the client's real thresholds,
  hotbar, walls and spikes (shared, spikes hurt players and animals), food healing.
- Animals wander, can be hit and killed for XP and respawn.
- Live top-10 leaderboard of the players in the room, chat bubbles.
- Walking speed, item slow-down, start and stop glide, collision distances, map edge and view distance
  are measured from a 46-minute recording of the real game.

Not supported: taming, pets, animal attacks, projectiles, towers, clans, quests, accounts and
skins beyond the default. Details and known bugs: CHANGELOG.md and BUGS.md.

## Releases

Every version ships as a pair built by one command in the source repo:

    bin/release.sh X.Y.Z

It builds `tio_offline_server_vX.Y.Z.zip` (this package) and `tio_offline_vX.Y.Z.zip` (single
computer) from the committed tree, runs all gates on the exact files that go into the zips, and only
when every gate passes tags `vX.Y.Z`, writes both zips with `.sha256` files and the release notes to the
downloads folder, and refreshes the unversioned `tio_offline.zip` / `tio_offline_server.zip` copies.
