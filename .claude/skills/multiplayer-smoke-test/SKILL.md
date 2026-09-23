---
name: multiplayer-smoke-test
description: Verify the Guldhedstorget multiplayer (room server protocol, host election/migration, shared era state, NPC sync, remote players rendering in the browser) locally or in production. Use after touching party/server.js, src/net.js, src/multiplayer.js, src/crowd.js serialization or installation shared state, or when the user reports sync problems.
---

# Multiplayer smoke test

The room protocol (all JSON, see `party/server.js`):

| `t` | Direction | Meaning |
| --- | --- | --- |
| `hello` | client → server | `{ name, style }` registers the player; triggers host election |
| `welcome` | server → client | `{ id, host, state: { theme, muted }, players[] }` |
| `host` | server → all | id of the client that simulates NPCs (first in room; migrates on leave) |
| `join` / `leave` | server → others | player metadata |
| `p` | client → others | player snapshot `{ x, z, h, y, q[68], gs? }` (17 joint quaternions, `gs` = webcam guest) |
| `npcs` | host → others | `[{ id, n, k, s(seed), x, z, h, g, gt }]` at 8 Hz; non-hosts render puppets |
| `state` | client → others | shared installation state (era `theme`, `muted`), stored on the server |
| `cmd` | non-host → host | `add` / `group` / `clear` visitor requests |
| `chat` | client → server → others | `{ text }` in, `{ id, name, text }` out; trimmed to 140 chars, 400 ms rate limit per connection |

## 1. Protocol test (fast, no browser)

```sh
npm run party &            # local: wrangler dev on :8787 (skip for prod)
npm run smoke              # local
npm run smoke:prod         # production workers.dev host
```
Expect `All 10 checks passed`. Each run uses a fresh room `smoke-<timestamp>`, so it never disturbs real players.

## 2. Browser + bot (end-to-end)

Chrome throttles `requestAnimationFrame` in background tabs, so **don't test with two browser tabs**. Use one visible tab plus the bot.

**In production always use the test room** (`?room=bot-test`; the bot defaults to it). Real people play in the main room `guldheden`, and the bot changes shared state (era, visitor spawns) for everyone in its room.

1. Open the site (`http://localhost:5199/?room=bot-test` with `npm run dev`, or https://guldheden-archive.vercel.app/?room=bot-test), enter a name, then in the page:
   ```js
   player.pos.set(1.5, 0, 10); player.faceScreen(); player.dist = 7;   // in front of the south-facing wall
   ```
2. Run the bot in the background (`run_in_background`):
   ```sh
   node scripts/smoke-test.mjs bot --server localhost:8787 --seconds 30   # room bot-test
   npm run bot:prod     # production, room bot-test
   ```
3. After ~8 s check in the page:
   ```js
   JSON.stringify({ online: mp.online, host: mp.isHost, remotes: [...mp.remotes.values()].map(r => r.name),
     theme: installation.theme, tracked: installation.count })
   ```
   Expected: `remotes` contains `Bertil (bot)`, `theme` becomes `1958`, the bot's avatar waves on the LED wall, the chat panel shows "Bertil (bot) Hej! Jag är en bot…" with a speech bubble above him, and the host logs "Bertil (bot) asked for: a group of visitors".

## 3. Non-host / puppet path

To make the browser a non-host, a bot must be host: start a bot, then reload the page (the page's old connection leaves, so host migrates to the bot). Then check `crowd.puppet === true` and that `crowd.agents` mirror the host's NPC list. When the bot exits, the page must become host again (`mp.isHost === true`, `crowd.puppet === false`, agents resume AI states like `walk`/`idle`).

## Hidden / throttled tabs

An automated Chrome window is often `document.visibilityState === 'hidden'`, so `requestAnimationFrame` stops and nothing moves. Advance the simulation manually with `__sim(seconds)` (runs the update loop without rendering at 30 Hz). Network messages still arrive while hidden; `__sim` applies them. Screenshots render a frame.

## Debug handles

`window.mp`, `window.crowd`, `window.installation`, `window.player`, `window.__sim` are exposed in the page. Screen-frame helpers (`toScreenLocal`, `screenOffset`, `inSensorZone`) live in `src/world.js`; the installation is built in a local frame (screen plane x = 0 facing −X) placed by `LAYOUT.screen.{cx, cz, rot}`. `installation.getState()` gives count/level/theme/duos. The HUD's "● Online" line shows room, player count and `värd` when this client is host.

## Determinism rules (keep these when editing)

Every client runs the installation logic itself, so choices must not use `Math.random`:
- avatar style for a tracked person → `hashStr(person.id)` (`startTrack` in `src/installation.js`)
- duo animation type → `hashStr(pairKey + count)`
- NPC outfits → `modernStyle(rng(seed))`, with `seed` sent in the `npcs` snapshot
- only the host auto-rotates the era (`installation.autoRotate = isHost`) and broadcasts it
