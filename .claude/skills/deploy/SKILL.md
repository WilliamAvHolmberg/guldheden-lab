---
name: deploy
description: Deploy the Guldhedstorget simulation — the room server to Cloudflare Workers (PartyServer) and the site to Vercel — and verify multiplayer in production. Use when the user asks to deploy, publish, ship, "lägga ut", update the live site, or change the multiplayer host/env.
---

# Deploy Det interaktiva arkivet

Two independently deployed parts (full reference: `DEPLOYMENT.md`):

| Part | Where | Identifier |
| --- | --- | --- |
| Room server (`party/server.js`, PartyServer Durable Object `Guldheden`) | Cloudflare Workers | `guldheden-archive.william-av-holmberg.workers.dev` |
| Site (Vite build) | Vercel, scope `williamavholmbergs-projects`, project `guldheden-archive` | https://guldheden-archive.vercel.app |

The site reads the room server host from `VITE_PARTY_HOST` **at build time**.

## Steps

1. **Check auth** (both are interactive logins the user must run themselves with `! <cmd>`):
   ```sh
   npx wrangler whoami
   npx vercel whoami
   ```
   If either says not authenticated, ask the user to run `! npx wrangler login` / `! npx vercel login` and stop until they have.

2. **Build locally first** to catch errors: `npx vite build && rm -rf dist`.

3. **Deploy the room server first** whenever `party/server.js` or the protocol in `src/net.js` / `src/multiplayer.js` changed (a new client must never talk to an old server):
   ```sh
   npm run deploy:party
   ```

4. **Verify the server**: `npm run smoke:prod` must print `All 10 checks passed`. If it fails, do not deploy the site; fix the server first.

5. **Deploy the site**:
   ```sh
   npm run deploy:site          # npx vercel deploy --prod --yes
   npx vercel ls guldheden-archive | head -8   # confirm status ● Ready, Environment Production
   ```
   The `vercel deploy` output is JSON-ish and truncated. Rely on `vercel ls` for the result.

6. **Verify the live site** (browser automation if available):
   - open https://guldheden-archive.vercel.app/?room=bot-test (a test room), type a name, click "Enter the square"
   - `document.getElementById('online').textContent` should start with `● Online`
   - optional: `npm run bot:prod` in the background → a player "Bertil (bot)" walks in from the big street, waves, chats (speech bubble), switches the era to 1958
   - HEAD `/models/pose_landmarker_lite.task` and `/mediapipe/vision_wasm_internal.wasm` → 200

7. Report the URLs and what was verified. Screenshots taken from an unfocused automation window show 0 fps and stale screen content. That is Chrome throttling, not a bug.

## Gotchas (learned the hard way)

- **Real people use the main room `guldheden`.** Never run the bot or join with test clients there. The bot switches the shared era and asks the host to spawn visitors, which disturbs a live session. `npm run bot:prod` defaults to `--room bot-test`; open the site with `?room=bot-test` to watch it. Close automation tabs when done.

- **Do not use `partykit deploy`.** The shared `partykit.dev` zone rejects new deploys ("exceeded the limit of 10000 Workers custom domains"). That is why the project runs PartyServer on the user's own Cloudflare account via `wrangler`.
- **Vercel scope is mandatory non-interactively.** The account has several teams. Always pass `--scope williamavholmbergs-projects` to `vercel link`. Never deploy this project to any other team.
- **Changing `VITE_PARTY_HOST`** requires a rebuild/redeploy of the site. Set it for all three environments:
  ```sh
  for env in production preview development; do printf '<host>' | npx vercel env add VITE_PARTY_HOST $env; done
  ```
- **Free-plan Durable Objects need SQLite**: `wrangler.jsonc` migrations must use `new_sqlite_classes`. If you rename the class, add a new migration tag instead of editing `v1`.
- The Durable Object binding name `Guldheden` determines the URL path `/parties/guldheden/<room>`. The client passes `party: 'guldheden'`. Keep them in sync.
- `vercel link` creates `.env.local` with an OIDC token. It is git-ignored; never commit or print it.
- Deploying is outward-facing: confirm with the user before deploying unless they explicitly asked for a deploy in this conversation.
