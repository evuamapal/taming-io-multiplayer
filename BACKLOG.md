# Backlog

Planned features that are specified but not in a release yet.

## Admin mode
Shipped as chat commands any player can use (intended design: typing /admin makes that player admin; no site-login check).
The site-login (X-Tio-User) admin idea is dropped.

## Chat log panel
- A panel bottom-left, just above the minimap: all chat of the current server session (all-chat plus the
  viewer's own clan chat), newest at the bottom, scrollable, semi-transparent, name and time per line.
- Small toggle to hide/show (remembered per browser). Must not block clicks on the minimap or the game.
- Server keeps the session's chat history in memory (cap about 500 lines), sends the backlog to every player
  on join so late joiners see earlier chat, resets on server restart. Never shows admin command lines or
  muted players.
- Same-origin and CSP-safe, no external fonts, no new hosts. Planned data path: the page shim tags its game
  socket with a random per-page id; the panel opens a same-origin EventSource (`/_chat/stream?cid=...`) that
  sends that player's backlog and then live lines (all-chat + own current clan), following respawns and clan
  changes; unknown id = 404; per-IP connection caps like the game socket; text inserted as plain text only.
- Proof: a browser screenshot with lines from two players.
