# Kanban – Next Step (feedback v2)

Källa: `Next Step.pdf` + `Design-in-action.zip` (6 låtar, skratt, gatuljud, referensbilder 1944).
Ordning: lägst hängande frukt först. **🧪 = William testar innan vi går vidare.**

**Ord vi använder** · *Spelarfigur* = den du styr · *Avatar* = figuren på skärmen som härmar dig · *NPC* = besökare som datorn styr · *Scenen* = trägolvet framför skärmen

---

## 🔄 Pågår

_(tomt – allt från PDF:en är byggt, väntar på test)_

## 🧪 Att testa (William)

Kör `npm run dev` + `npm run party` → http://localhost:5199 (lägg till `?fps` för FPS-mätare)

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
   - **2 nära varandra:** avatarerna vänder sig mot varandra och pratar – **pratbubblor med historiska fakta på engelska** (byter var 6:e sek), skratt + sorl, lamporna runt skärmen "jagar"
   - **3+ nära varandra:** avatarerna dansar i en ring, gnistor/hjärtan + konfetti på skärmen, varma vintage-spotlights på scenen (och på skärmen), regnbågsljus runt skärmen, snabb låt
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
3. **Ljud** – era låtar efter ljudreglerna, ett gatuljud, skratt + sorl (public domain) när avatarer pratar. Online-raden borttagen.
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

- Pratbubblor: historiska fakta, **på engelska** – och allt i appen ska vara på engelska
- Fotspår: bara vägledning, inget händer när man står på dem
- Gatuljud: bara ett (de två filerna var identiska) · Sorl: fritt ljud (public domain, Wikimedia Commons)
- Webbkamera: kvar på `C` · Online-raden: bort

## ⚠️ Inför deploy

- **Låtarna:** varifrån kommer de? Live-sajten är offentlig, så upphovsrättsskyddad musik bör inte ligga där.
- **Faktan** i `src/facts.js` – dubbelkolla innan publik visning.
