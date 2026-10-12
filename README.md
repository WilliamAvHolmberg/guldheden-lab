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
| `npm run smoke` | Protocol test against the local room server: three clients, 12 checks, should end with `All 12 checks passed` |
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
  person) are visible to everyone, plus the gesture they are playing, so every screen shows their avatar's
  answer to it. A player in spectator mode sends only `spec: 1` and disappears from the square for the others.
- **Shared installation state** (era on the screen, sound, time of day) lives on the server, so someone who
  joins later gets the current time of day too. A pillar press
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
| `1`–`8`, `Space` | gestures (8 = hand-to-mouth, tests the content filter), jump. On the stage, your avatar answers most gestures with its own bigger move (see below) |
| `F` | face the screen |
| `Enter` | chat: the message appears as a speech bubble above your character (synced online) |
| `E` | sit down on / get up from an audience bench |
| click pillar buttons / `E` | change era (1944 / 1958 / children's drawings) and toggle sound |
| `C` | webcam pose via MediaPipe (1–2 people) |
| `N` / `G` | add a visitor / a group of four |
| `T` | day → dusk → night, for everyone in the room |
| `P` | spectator mode: a flying camera with no player (`W A S D`, `Space` up, `Q` down, `Shift` faster). Its panel changes the time of day, picks a soundtrack (on your computer only) and adds or removes visitors |
| `H` | hide / show the controls panel (all keybindings, top left) |
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
  1940s people strolling and 1940s cars driving past. It is silent (no ambience while nobody is there).
- **Someone steps in**: the picture turns to colour, the bulbs around the wall light up, a soft song plays.
- **Two close together**, anywhere on the stage: their avatars turn to each other and chat, with
  speech bubbles showing historical facts (`src/facts.js`, a new fact every 9 s, dimming out slowly), and a murmur of voices.
- **Three or more close together**: their avatars dance in a ring with sparkles and confetti, vintage
  spotlights (panning slowly) light the stage and a high-tempo song plays.
- **The footprint markers**: the two-pair marker is a locked talk spot: two people on it stay in conversation
  and someone standing next to them cannot turn it into a dance (they join a dance on open ground or the
  dance marker instead). The three-pair marker is a dance spot: dancing starts when all three pairs are taken.
- **Player colours**: everyone on the stage gets a colour: a ring under their avatar on the screen and under
  them on the square, the footprints they stand on and the bench they sit on light up in it, and a dance
  has a circle in all the dancers' colours.
- **Sitting on a bench**: the avatar rides a bicycle (in the sitter's colour) round the screen until they get up.
- **Gestures**: the avatar is its own character and answers a gesture with a bigger move of its own, played to
  the end before the next: clap → jumps and clicks its heels, jump → jumps really high, dance → Lindy Hop,
  airplane → flies, wave → a big wave with the whole arm over the head, bow → a somersault. Other movement
  (walking, cheer, the webcam pose) is still mirrored. `GESTURE_ACTION` in `src/character.js`.
- **Standing still**: after 7 s the avatar gets a thought bubble ("What will happen if I jump?").
- **Social meter** on the right of the screen: 0 with nobody there, charged a little by being on the stage and
  a lot by talking and dancing together (`SOCIAL` in `src/installation.js`). Full = fireworks over the 1944 square.
- **Music**: the group's own songs and sounds in `public/audio` (see `CREDITS.md` there).
- **Content filter**: a hand held at the mouth (e.g. smoking) is not mirrored. The avatar's arm stays down.
- **Wayfinding**: Thin LED strips set flush in the paving glow softly from the entrances to the front of the stage,
  only when it is dark (off by day, dim at dusk).
- **Ribbon fence**: stanchions with a belt round the stage, open where the light strips arrive (`STAGE_GATES`
  in `src/world.js`). Visitors walk in and out through the openings.
- **Visitors** are called "Neighbour 1", "Neighbour 2"… and carry a name label.
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
