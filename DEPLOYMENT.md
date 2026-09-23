# Deployment – Det interaktiva arkivet

Simuleringen består av två delar som deployas var för sig:

| Del | Vad | Var | URL |
| --- | --- | --- | --- |
| **Sajten** | Vite-build (Three.js, MediaPipe, UI) | Vercel, team `williamavholmbergs-projects`, projekt `guldheden-archive` | https://guldheden-archive.vercel.app |
| **Rum-servern** | PartyServer (Cloudflare Durable Object) som synkar spelare, besökare och pelarens tillstånd | Cloudflare Workers, worker `guldheden-archive` | `wss://guldheden-archive.william-av-holmberg.workers.dev` |

Sajten hittar rum-servern via miljövariabeln `VITE_PARTY_HOST`, som läggs in i bygget. Utan den körs appen som single-player.

```
 webbläsare ──https──▶ Vercel (statiska filer, MediaPipe-wasm + modell)
     │
     └──wss /parties/guldheden/<rum>──▶ Cloudflare Worker ──▶ Durable Object "Guldheden" (ett per rum)
```

---

## Snabbversion

```sh
npm run deploy        # = deploy:party → smoke:prod → deploy:site
```

Eller steg för steg:

```sh
npm run deploy:party  # wrangler deploy  → rum-servern till Cloudflare
npm run smoke:prod    # 10 protokollkontroller mot produktionsservern
npm run deploy:site   # vercel deploy --prod → sajten till Vercel
```

Kör `npm run bot:prod` och öppna https://guldheden-archive.vercel.app/?room=bot-test samtidigt för att se en bot-spelare ("Bertil (bot)") gå från stora gatan fram till skärmen, vinka, skriva i chatten, byta epok och be värden om en grupp besökare.

---

## Förutsättningar (en gång per dator)

```sh
npm install
npx wrangler login    # Cloudflare (gratiskonto räcker, Durable Objects med SQLite ingår)
npx vercel login
```

Kontrollera inloggningarna med `npx wrangler whoami` och `npx vercel whoami`.

---

## 1. Rum-servern (Cloudflare Workers + PartyServer)

Konfigurationen ligger i `wrangler.jsonc`:

- `main: party/server.js` exporterar klassen `Guldheden` (en `partyserver`-`Server`) och en `fetch` som använder `routePartykitRequest`.
- Durable Object-bindningen heter `Guldheden`, så URL-vägen blir `/parties/guldheden/<rum>`. Klienten ansluter med `party: 'guldheden'` i `src/net.js`.
- Migreringen använder `new_sqlite_classes`, vilket krävs på Cloudflares gratisplan.

```sh
npm run deploy:party
# → https://guldheden-archive.william-av-holmberg.workers.dev
```

Verifiera:

```sh
npm run smoke:prod
```

Förväntat: `All 10 checks passed`. Kontrollerna är welcome, värdval, join, spelardata, besökarsnapshot, epokbyte, kommando vidare till värden, chatt, leave och värdbyte.

**Byter du protokollet** (`party/server.js` eller `src/net.js`): deploya servern **före** sajten. Annars pratar en ny klient med en gammal server.

### Varför inte PartyKit?

Projektet byggdes först mot PartyKit (`partykit deploy`). Deras gemensamma plattform `partykit.dev` svarar just nu:

> You have exceeded the limit of 10000 Workers custom domains on zone 'partykit.dev'

Därför körs servern med **PartyServer**, Cloudflares efterföljare till PartyKit, på ett eget Cloudflare-konto. Klientbiblioteket `partysocket` är detsamma.

---

## 2. Sajten (Vercel)

Konfigurationen ligger i `vercel.json`: framework `vite`, `npm run build` → `dist/`, och lång cache för `/mediapipe/*` och `/models/*`.

### Första gången (redan gjort)

```sh
npx vercel link --yes --project guldheden-archive --scope williamavholmbergs-projects
for env in production preview development; do
  printf 'guldheden-archive.william-av-holmberg.workers.dev' | npx vercel env add VITE_PARTY_HOST $env
done
```

> Kontot har flera team. I icke-interaktivt läge vägrar Vercel CLI att gissa, så ange alltid `--scope`. Projektet ligger på det personliga teamet `williamavholmbergs-projects`.

### Deploya

```sh
npm run deploy:site          # npx vercel deploy --prod --yes
npx vercel ls guldheden-archive
```

Ändras `VITE_PARTY_HOST` måste sajten **byggas om**, eftersom variabeln läses in vid build. Kör `npm run deploy:site` igen.

### Verifiera

1. Öppna https://guldheden-archive.vercel.app, skriv ett namn och gå in.
2. Uppe till vänster ska det stå **● Online · rum guldheden**.
3. Öppna `?room=bot-test` och kör `npm run bot:prod`. Boten kör alltid i testrummet `bot-test` och aldrig i huvudrummet, där riktiga personer kan vara inne. Bertil ska dyka upp med namnskylt, vinka, få en pratbubbla ("Hej! Jag är en bot…") och skärmen ska byta till 1958.
4. Webbkamera (`C`) fungerar bara på https eller localhost, alltså på Vercel-adressen.

---

## Lokal utveckling

```sh
npm run party    # wrangler dev → ws://localhost:8787
npm run dev      # vite → http://localhost:5199 (ansluter automatiskt till localhost:8787)
npm run smoke    # protokolltestet mot den lokala servern
```

Fler flikar i samma webbläsare blir olika spelare, eftersom id:t sparas per flik i `sessionStorage`. Chrome pausar rendering i bakgrundsflikar, så testa hellre med `scripts/smoke-test.mjs bot` än med två flikar.

---

## Rum

- `https://guldheden-archive.vercel.app/?room=energy` ger ett eget rum. Varje rum är en egen Durable Object-instans.
- Klicka på **● Online**-raden i spelet för att kopiera rumslänken.
- Rummets tillstånd (epok, ljud) sparas i minnet så länge någon är ansluten.

---

## Felsökning

| Symptom | Orsak / åtgärd |
| --- | --- |
| "Single-player" i HUD:en | `VITE_PARTY_HOST` saknas i bygget. Kontrollera med `npx vercel env ls` och deploya om. |
| "○ Ansluter…" hela tiden | Servern är nere eller fel host. Kör `npm run smoke:prod`. |
| `smoke:prod` misslyckas på "Host migrates" | Ändring i `onClose`/`electHost` i `party/server.js`. |
| Besökarna står still hos vissa | Ingen värd, eller värdens flik ligger i bakgrunden, där Chrome strypt `requestAnimationFrame`. |
| `vercel link` klagar på `missing_scope` | Lägg till `--scope williamavholmbergs-projects`. |
| `partykit deploy` → "10000 Workers custom domains" | Se ovan. Använd `npm run deploy:party` (wrangler). |
| Webbkameran startar inte | Kräver https eller localhost och kamerabehörighet i webbläsaren. |
