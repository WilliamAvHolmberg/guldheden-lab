# Guldhedstorget — Det interaktiva arkivet (simulation)

A walkable Three.js simulation of the Energy group's Design-in-Action concept: a freestanding LED
wall out on Guldhedstorget turns visitors into historical figures that mirror their movements. The wall
faces the big street, so the audience stands with their backs to the street. More people bring more
colour, light and music.

Live: https://guldheden-archive.vercel.app

## Running it locally

**Requirements:** Node.js 22+ (the smoke test uses the built-in `WebSocket`) and a browser with WebGL.
No accounts, API keys or `.env` files are needed to run locally.

```sh
npm install
npm run party      # terminal 1: room server (PartyServer via `wrangler dev`) on ws://localhost:8787
npm run dev        # terminal 2: the site on http://localhost:5199
```

Open http://localhost:5199, type a name and enter the square.

- **Single-player:** just run `npm run dev`. Without the room server the app runs in single-player mode,
  and the HUD shows "Single-player".
- **Multiplayer:** with both running, the HUD shows **● Online · rum guldheden**. On localhost the site
  finds the room server at `localhost:8787` automatically. Each browser tab is a separate player, but
  Chrome throttles background tabs, so use two windows side by side or the bot below.
- **Webcam pose** (`C`) only works on `https` or `localhost`. The MediaPipe wasm and model are served
  from `public/`, so no CDN is needed.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5199 |
| `npm run party` | Local room server (`wrangler dev`) on port 8787. Local state is written to `.wrangler/` (git-ignored) |
| `npm run build` / `npm run preview` | Production build to `dist/` / serve it |
| `npm run smoke` | Protocol test against the local room server: two clients, 10 checks, should end with `All 10 checks passed` |
| `node scripts/smoke-test.mjs bot --room bot-test` | Fake player "Bertil (bot)" that walks to the wall, waves, chats and switches era. Open `http://localhost:5199/?room=bot-test` to watch |
| `npm run smoke:prod`, `npm run bot:prod`, `npm run deploy*` | Same against / deploy to the author's production host (see [Deploy](#deploy)) |

There is no unit test suite. `npm run smoke` is the check to run after changing `party/server.js`,
`src/net.js` or `src/multiplayer.js`.

### Notes for AI agents

Project skills live in `.claude/skills/`: `deploy` (deploying and verifying production) and
`multiplayer-smoke-test` (verifying sync locally or in production). Never run the bot or test clients in the
main room `guldheden` in production. Real people use it, so use `?room=bot-test`.

## Multiplayer (PartyServer / Cloudflare Durable Objects)

Everyone who opens the same link ends up on the same square. `?room=name` gives a private room.

- **Chat** (`Enter`) is relayed by the server (140 chars, rate limited) and shown as a speech bubble
  above the sender and in the chat panel. Visitors (NPCs) also make remarks in bubbles.
- **Players** send position + all 17 joint rotations 15×/s, so webcam poses (and a second webcam
  person) are visible to everyone.
- **Shared installation state** (era on the screen, sound) lives on the server. A pillar press
  changes the screen for everybody.
- **Visitors (NPCs)** are simulated by one client, the *host* (the first in the room; the next one takes
  over if it leaves). Other clients render them as puppets. "+ Visitor / + Group / Clear" from a
  non-host is forwarded to the host.
- Every client runs the installation logic itself on the same set of people. Avatar types and duo
  animations are picked deterministically from ids, so everyone sees the same thing.

Server: `party/server.js`. Client: `src/net.js`, `src/multiplayer.js`.

## Deploy

Full guide with verification and troubleshooting (in Swedish): [`DEPLOYMENT.md`](DEPLOYMENT.md).
For the author's setup it is `npm run deploy` (room server → smoke test → site). The `*:prod` scripts in
`package.json` point to the author's host, so if you deploy your own copy, change them to your host.

The room server uses [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver),
the Cloudflare-hosted successor to PartyKit. It is the same `partysocket` client, running on your own free
Cloudflare account. (PartyKit's shared `partykit.dev` platform currently refuses new deploys.)

1. **Room server**: `npx wrangler login`, then `npm run deploy:party`. Note the host it prints,
   e.g. `guldheden-archive.<subdomain>.workers.dev`.
2. **Vercel**: import the repo (or run `npx vercel`), set the environment variable
   `VITE_PARTY_HOST` to that host, and deploy. `vercel.json` already sets up the Vite build.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows, `Shift` | walk / run |
| drag, scroll | orbit camera, zoom |
| `1`–`8`, `Space` | gestures (8 = hand-to-mouth, tests the content filter), jump |
| `F` | face the screen |
| `Enter` | chat: the message appears as a speech bubble above your character (synced online) |
| `E` | sit down on / get up from an audience bench |
| click pillar buttons / `E` | change era (1944 / 1958 / children's drawings) and toggle sound |
| `C` | webcam pose via MediaPipe (1–2 people) |
| `N` / `G` | add a visitor / a group of four |
| `T` | day → dusk → night |
| `K` | sensor view (tracking zone, skeletons, proximity links) |
| `V` | LED wall feed picture-in-picture: small → large → off |
| `M` | mute |

## How the concept is modelled

- **The stage**: a flush wooden floor in front of the wall with "STEP IN" and footprint groups painted on
  it (two pairs, three pairs). There are deliberately no captions: visitors discover what standing
  together does. Nothing triggers on the footprints themselves. Only people
  standing on the stage, or sitting on one of the four benches along its edges, appear on the screen.
- **Avatars**: everyone on the stage gets a historical figure (`HISTORICAL` in `src/character.js`) that
  mirrors their pose in real time. Someone sitting on a bench appears standing.
- **Empty stage**: the wall shows black-and-white, scratched old film of Guldhedstorget in 1944, with
  1940s people strolling and 1940s cars driving past. Street ambience plays.
- **Someone steps in**: the picture turns to colour, the bulbs around the wall light up, a soft song plays.
- **Two close together** (or two on the same bench): their avatars turn to each other and chat, with
  speech bubbles showing historical facts (`src/facts.js`), laughter and a murmur of voices.
- **Three or more close together**: their avatars dance in a ring with sparkles and confetti, vintage
  spotlights light the stage and a high-tempo song plays.
- **Music**: the group's own songs and sounds in `public/audio` (see `CREDITS.md` there).
- **Content filter**: a hand held at the mouth (e.g. smoking) is not mirrored. The avatar's arm stays down.
- **Wayfinding**: LED light strips in the paving pulse from the entrances to the front of the stage.
- **"+ Visitor"** spawns someone at the edge of the audience area who hurries to the stage (~4–6 s).
- **Performance**: static scenery is merged per material, each character is a single skinned mesh,
  the wall's scene renders at 30 Hz and the resolution adapts to the machine. `?fps` shows an FPS
  counter; `__bench(60)` in the console measures frame cost.

## Files

- `src/world.js`: Guldhedstorget model (buildings, paving, trees, lamps, bollards, sky, time of day)
- `src/installation.js`: LED wall, the 1944 scene rendered to the wall, stage, tracking, chat/dance groups, filter, lights, sensor view
- `src/facts.js`: the historical facts in the avatars' speech bubbles
- `src/batch.js`: static batching (merges unmoving meshes per material)
- `src/character.js`: articulated rig, outfits, procedural gestures
- `src/crowd.js`: visitor AI
- `src/player.js`: third-person controller
- `src/pose.js`: MediaPipe Pose Landmarker → rig retargeting (3D world landmarks)
- `src/audio.js`: procedural swing music and ambience, spatialised at the wall
- `public/mediapipe`, `public/models`: MediaPipe wasm and the pose model, bundled locally
