# Kanban – Next Step (feedback v2 + v4)

Källa: `Next Step.pdf` + `Design-in-action.zip` (6 låtar, skratt, gatuljud, referensbilder 1944).
Ordning: lägst hängande frukt först. **🧪 = William testar innan vi går vidare.**

**Ord vi använder** · *Spelarfigur* = den du styr · *Avatar* = figuren på skärmen som härmar dig · *NPC* = besökare som datorn styr · *Scenen* = trägolvet framför skärmen

---

## 🔄 Pågår

_(tomt)_

## 🧪 Att testa (William)

Kör `npm run dev` + `npm run party` → http://localhost:5199 (lägg till `?fps` för FPS-mätare)

### Feedback v4 – byggt, att testa

- **Meny:** rubriken heter nu "The Interactive Archive *at Guldhedstorget*" · ✔ byggt
- **Kontroller:** panelen med alla tangenter är tillbaka uppe till vänster (`H` döljer den) · ✔ byggt
- **Tid på dygnet gäller alla:** `T` byter för hela rummet, och den som ansluter sent får samma tid · ✔ byggt (smoke-testet kollar det)
- **Tyst när scenen är tom:** gatuljudet är borttaget, det är tyst tills någon kliver upp · ✔ byggt
- **NPC:er heter "Neighbour 1", "Neighbour 2"…** med namnskylt ovanför huvudet · ✔ byggt
- **Pratbubblorna på skärmen:** större text, ny fakta var 9:e sek (förut 6), tonar långsamt ut de sista 3 sek · ✔ byggt
- **Ljusslingorna i marken:** bara tända när det är mörkt (släckta på dagen, svaga i skymningen) · ✔ byggt
- **Spotlights:** sveper långsamt över scenen (både på torget och på skärmen) · ✔ byggt
- **Knuff när man står still:** efter 7 sek får avataren en tankebubbla, t.ex. "What will happen if I jump?" · ✔ byggt
- **Bänk = cykel:** sitter man på en bänk cyklar avataren runt på skärmen (cykeln har spelarens färg) tills man reser sig · ✔ byggt
- **Spelarfärger:** färgad ring under avataren på skärmen och under spelaren på torget · bänken och fotspåren lyser i färgen hos den som använder dem · en dans får en cirkel i alla dansarnas färger · ✔ byggt
- **Fotspårsreglerna:**
  - var som helst på scenen: 2 nära = prat, 3+ nära = dans (som förut)
  - **2-fotspåret är en låst pratplats:** två som står där fortsätter prata, och en tredje bredvid startar ingen dans
  - **3-fotspåret är en dansplats:** dansen startar när alla tre paren är upptagna
  - den som står bredvid pratplatsen kan bara dansa genom att gå till 3-fotspåret eller till öppen yta · ✔ byggt
- **Social Meter** till höger på skärmen: 0 när ingen är där. Att stå på scenen ger lite, att prata/dansa ger mycket. Full mätare = fyrverkerier · ✔ byggt
  - *Standardvärden (ändra gärna):* på scenen 1 p/person, pratar +2,5, dansar +4,5; full vid 13,5 p (= tre som dansar). Fylls på ~8 sek, töms långsammare. `SOCIAL` i `src/installation.js`
- **Avatarens egna rörelser** när spelaren gör en gest: Clap → hoppar och slår ihop hälarna · Jump → hoppar jättehögt · Dance → Lindy Hop · Airplane → flyger · Wave → stor vinkning med hela armen över huvudet · Bow → kullerbytta · ✔ byggt
  - *Antagande:* avataren speglar fortfarande allt annat (gång, Cheer, webbkameran) och spelar bara upp sin egen rörelse när en gest känns igen. Rörelsen spelas klart innan nästa kan börja
- **Repstaket runt scenen** (stolpar med band), öppningar där ljusslingorna kommer fram och i hörnet mot vägen bakom skärmen. NPC:erna går in genom öppningarna · ✔ byggt
- **Åskådarläge (`P`):** flygande kamera utan spelare (`W A S D`, `Space` upp, `Q` ned, `Shift` snabbare). Panelen: tid på dygnet (för alla), välj låt (bara på den egna datorn), lägg till/ta bort NPC:er. Andra ser inte åskådaren · ✔ byggt
- 🧪 Testa gärna med två fönster: byt tid, gör gester (den andra ska se din avatars rörelse), gå in i åskådarläge

### Feedback v4 – väntar på beslut

- **Avataren som egen karaktär** i stället för spegling: hur ska webbkameran (`C`) och hand-mot-mun-filtret funka då?
- **Hålla hand** (och blomman, och synkdansen för 3+ som håller hand): med vem – närmast, eller väljer man? Måste den andra säga ja?
- **Mjukare övergångar / mindre ryckigt:** behöver ögon på rörelsen, inte bara stillbilder
- **Prat-sorl för 2 resp. fler:** ljud att välja (och licens att kolla)
- **Skärmens 1940-talsbakgrund** (affärerna, 2 parkerade bilar, ny stil): se frågorna i chatten – Volvo Amazon-fotot är från 1956, skylten heter "Guldheden" på fotot, svenska eller engelska skyltar?

4. **Allt på engelska** · ✔ byggt
   - 🧪 Ser du något svenskt någonstans?
5. **Prestanda** · ✔ byggt och mätt (se tabellen under Klart)
   - 🧪 Testa på en långsammare laptop med `?fps`
6. **Scenen: trägolv i marknivå** · ✔ byggt
   - Trägolv 13 × 7 m framför skärmen, inget steg upp, tunn stålkant
   - Målat på golvet: "STEP IN" + fotspår för **2** och **3** personer, utan förklarande text (besökarna ska själva upptäcka vad som händer)
   - 4 bänkar längs scenens sidokanter
   - **Bara den som står på scenen eller sitter på en scenbänk syns på skärmen**
   - Ljusslingorna i marken slutar vid scenkanten · sensorvyn (`K`) visar scenens rektangel
   - 🧪 Gå runt, kliv upp/av scenen, sätt dig
7. **Interaktionsregler** · ✔ byggt
   - **Tom scen:** svartvit, repig gammal film · 1940-talsfigurer promenerar · 1940-talsbilar (PV444-stil + skåpbil) kör förbi
   - **1+ på scenen:** skärmen går från svartvitt → färg, lampor runt skärmen tänds, mjuk låt
   - **2 nära varandra:** avatarerna vänder sig mot varandra och pratar – **pratbubblor med historiska fakta på engelska** (byter var 6:e sek), sorl, lamporna runt skärmen "jagar"
   - **3+ på scenen (var som helst):** varma vintage-spotlights på scenen (och på skärmen) tänds
   - **3+ nära varandra:** avatarerna dansar i en ring, gnistor/hjärtan + konfetti på skärmen, regnbågsljus runt skärmen, snabb låt
   - **Sitter på bänk:** avataren syns **stående** · **två på samma bänk:** avatarerna pratar
   - Faktalistan: `src/facts.js` (14 st) – **läs gärna igenom och stryk/ändra det ni inte står för**
   - 🧪 Testa varje nivå – `+ Visitor` flera gånger ger lätt både par och grupper
8. **Skärmens bakgrund: Guldhedstorget 1944** (+ 9, se nedan) · ✔ byggt
   - Byggd efter färgfotot: låga huset med mörkt tak, takkupor och röd markis · grå-beige punkthuset bakom · långa vita huset med rött tegeltak och Tobacco / Café / Flowers · flaggstång med svensk flagga · gräsmatta med gröna bänkar och vita blomlådor · unga björkar · klotlykta · gata · hus under byggnad med byggnadsställning · turkos Agfacolor-himmel
   - Skärmkameran vinklad upp så tak och himmel syns, som på fotot
   - 🧪 Jämför med fotot (tryck `V` två gånger för att se skärmen stort)

## ✅ Klart

1. **Städa gränssnittet** – bara `+ Visitor`, `Clear square`, `Day`, `Sit down (E)`, `Sound on` + gesterna kvar. Webbkamera finns kvar på `C`.
2. **Ta bort pelaren och epokerna** – skärmen visar bara 1944.
3. **Ljud** – era låtar efter ljudreglerna, ett gatuljud, sorl (public domain) när avatarer pratar. Online-raden borttagen.
9. **"The virtual square looks more like the real one"** – i PDF:en står den under *Screen Background*, så jag har tolkat den som torget **på skärmen** och gjort den i 8. Vill ni att 3D-torget man går på också ska justeras mot verkligheten? Säg till.

**Prestandamätning** (samma dator, samma vinkel, upplösning 1,5×, bästa av 5 × 60 bildrutor; "före" = samma kod med optimeringarna avstängda)

| Scenario | ms/bild före | ms/bild efter | Snabbare | Draw calls före → efter |
|---|---|---|---|---|
| Tomt torg, dag | 2.84 | 0.89 | **3,2×** | 1 225 → 191 |
| Fest (8 besökare), dag | 5.88 | 1.72 | **3,4×** | 3 224 → 284 |
| Fest, natt | 6.32 | 2.34 | **2,7×** | 3 331 → 286 |
| _Efter scen + regler + 1944-bakgrund (6–8)_ | | 1.1 – 1.5 | | 232 – 295 |

Mätverktyg: `__bench(60)` i webbläsarkonsolen.

## 💬 Beslut

- Karaktärer: behålls som de var (realistiska Rocketbox-avatarer och en förfinad low-poly-version testades och valdes bort)
- Pratbubblor: historiska fakta, **på engelska** – och allt i appen ska vara på engelska
- Fotspår: ~~bara vägledning, inget händer när man står på dem~~ → feedback v4: 2-fotspåret är en låst pratplats, 3-fotspåret en dansplats
- Gatuljud: bara ett (de två filerna var identiska) · Sorl: fritt ljud (public domain, Wikimedia Commons)
- Webbkamera: kvar på `C` · Online-raden: bort
- Gatuljudet: bort (feedback v4) – tyst när scenen är tom. Filen ligger kvar i `public/audio` om det ska tillbaka
- Skratt: borttaget helt (feedback v3) – bara sorl när avatarerna pratar
- Fotspåren: skoavtryck utan tår, med tån mot skärmen
- Ljusslingorna i marken: smal infälld stållist med bärnstensfärgat ljus, tydliga mjuka ljuspulser som vandrar mot scenen (ingen svart list, inget rosa). De slutar alltid vid scenkanten – ingen slinga går in på scenen
- Skärmens 1944-mark: stora rektanglar (6 × 4 m) av ljusa, oregelbundna naturstensplattor, inramade av band av mörkare gatsten – som på ArkDes-fotot från 1940-talet (ARKM.1962-101-0955 på Wikimedia Commons) · gräsmatta med naturlig variation och ljus stenkant · en gräsmatta till i förgrunden till vänster med gröna bänkar och blomlåda, som på färgfotot · ljus asfalt och ljusa kantstenar på gatan

## ⚠️ Inför deploy

- **Låtarna:** varifrån kommer de? Live-sajten är offentlig, så upphovsrättsskyddad musik bör inte ligga där.
- **Faktan** i `src/facts.js` – dubbelkolla innan publik visning.
