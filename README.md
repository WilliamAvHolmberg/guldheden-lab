# Guldhedstorget — Det interaktiva arkivet (simulation)

A walkable Three.js simulation of the Energy group's Design-in-Action concept: a freestanding LED
wall out on Guldhedstorget turns visitors into historical figures that mirror their movements. The wall
faces the big street, so the audience stands with their backs to the street. More people bring more
colour, light and music.

```sh
npm install
npm run party      # room server (PartyServer on wrangler) at localhost:8787
npm run dev        # http://localhost:5199
```

Without the room server running the app simply works in single-player.

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

Live: https://guldheden-archive.vercel.app. Full guide with verification and troubleshooting: [`DEPLOYMENT.md`](DEPLOYMENT.md). Short version: `npm run deploy` (room server → smoke test → site).


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

- **Tracking**: anyone inside the sensor zone in front of the wall gets a random historical avatar
  (`HISTORICAL` in `src/character.js`) that mirrors their pose in real time.
- **Escalation**: 0 people = attract mode (sepia, film grain). Each extra person raises the level
  (1 solo, 2 duo, 3–4 group, 5+ festival). Colour saturation, bunting, stage lights, confetti,
  dancing archive extras, string lights and spotlights on the real square, and the music layers
  (which open up from "old radio" to full band) all follow the level.
- **Proximity**: two visitors within 1.5 m trigger a duo animation between their avatars
  (swing dance, handshake, hat tip).
- **Content filter**: a hand held at the mouth (e.g. smoking) is not mirrored. The avatar's arm stays down.
- **Retention**: rotating eras, including children's drawings as the background, auto-rotating
  every ~90 s when nobody uses the pillar.
- **Privacy note** on the pillar plaque: only joint positions are read, no video is stored.
- **Wayfinding**: LED light strips in the paving pulse from the entrances towards the zone.
- **Static stage lighting**: four fixed spotlights on the truss light the zone; only brightness and a
  festival tint follow the level.
- **Audience benches** flank the zone just outside the sensors' field of view. Elderly visitors sit
  down and watch; you can sit too (`E`).
- **"+ Visitor"** spawns someone at the edge of the audience area who hurries to the wall (~4–6 s).

## Files

- `src/world.js`: Guldhedstorget model (buildings, paving, trees, lamps, bollards, sky, time of day)
- `src/installation.js`: LED wall, archive scene rendered to the wall, tracking/levels/duos/filter, pillar, lights, sensor view
- `src/character.js`: articulated rig, outfits, procedural gestures
- `src/crowd.js`: visitor AI
- `src/player.js`: third-person controller
- `src/pose.js`: MediaPipe Pose Landmarker → rig retargeting (3D world landmarks)
- `src/audio.js`: procedural swing music and ambience, spatialised at the wall
- `public/mediapipe`, `public/models`: MediaPipe wasm and the pose model, bundled locally
