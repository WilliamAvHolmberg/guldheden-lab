# Kanban – feedback v5

Källa: svaren på de 11 frågorna + "To fix"-listan. **🧪 = testa när det är klart.**

## 📋 Att göra · ✔ allt byggt (🧪 nedan)

### Fixar
- [x] F1 Klapp → avataren **klappar först**, sedan hopp med hälklapp
- [x] F2 Ljusslingorna i marken: tydliga men inte för flashiga i **varje** tid på dygnet (dag, skymning, natt)
- [x] F3 Ta bort texterna på skärmen som förklarar vad som händer (t.ex. *"Three or more together – time to dance!"*) – besökarna ska upptäcka själva
- [x] F4 Social-mätaren: mer synlig, i skärmens färgschema · gul mätare och gul rubrik · märks men tar inte för mycket fokus
- [x] F5 Ringarna runt figuren på torget och avataren på skärmen ska **glöda**
- [x] F6 När två pratar eller flera dansar: **en gemensam ring** runt dem i deras färger (på skärmen)

### Från svaren
- [x] S1 Social-mätaren: att stå på scenen ger lite (högst 25 %), att göra saker med andra ger mer, ju fler som gör saker tillsammans desto mer · två som gör samma gest samtidigt räknas · tom scen → 0 på några sekunder
- [x] S2 Tydligare uppmaning på skärmen att kliva upp på scenen
- [x] S3 Dammen med de svängda trapporna framför restaurangen (1945-fotot) · stenfälten i marken i olika färger
- [x] S4 ~~Konststil: 1940-talsvykort~~ – byggd, sedan borttagen: skärmen är som förut
- [x] S5 **Hålla hand**: de 1–2 närmaste inom ungefär en armlängd, båda trycker · blommor växer ur händerna · 3+ som håller hand dansar en synkad dans

### 🧪 Att testa – feedback v5
- **Klapp** (`3`): avataren klappar händerna först, sedan hopp med hälklapp
- **Ljusslingorna**: syns tydligt men lugnt på dagen, i skymningen och på natten (`T`)
- **Inga förklarande texter** på skärmen längre (t.ex. "time to dance!"). Mätaren har bara små ikoner, inga ord
- **Social-mätaren** i skärmens arkivstil: mörkt kort med krämfärgad ram, gul skrivmaskinsrubrik *TOGETHER*, gul mätare
  - att bara stå där ger högst 25 % · ett par som pratar ≈ 47 % · två som gör samma gest samtidigt ≈ 40 % · tre som dansar = fullt · fler ihop = mer per person · tom scen → 0 på ~3 s
- **Glödande ringar** under figuren på torget och avataren på skärmen · **en gemensam ring i allas färger** runt par som pratar, dansare och de som håller hand
- **Uppmaning** på skärmen när scenen är tom: *Step onto the stage* med gula pilar som gungar nedåt
- **Dammen** med svängda stentrappor, vass, näckrosor och skulpturen på sin sockel – i vänstra förgrunden som på 1945-fotot · **stenfälten** i olika toner (ljusa, grå, varma)
- **Hålla hand** (`X` eller knappen *Hold hands*): de 1–2 närmaste inom en armlängd som också håller fram handen · på torget sträcker man armen mot varandra · på skärmen står avatarerna sida vid sida och håller hand och **en blomma växer** ur händerna · **3+ i en kedja dansar en synkad dans** i rad (sidsteg och sparkar, sedan upp med händerna) · besökarna tar din hand om du håller fram den, och håller ibland fram sin egen · fungerar i multiplayer

- **Bugg fixad:** besökare som skulle till scenen kunde bli stående precis utanför kanten (de gick fram till någon "åt sidan" i fel riktning, eller fastnade bakom sidobänkarna). Nu hamnar alla på scenen – testat 3 × 60 s med 10 besökare: 0 utanför
- **Hålla hand-flaggan** och gestens tid skickas nu i multiplayer

### 🧪 Att testa – runda 2
- **Skärmen** är tillbaka som den var (vykortsstilen borttagen)
- **Gemensam ring**: tydligt uppdelad i deras färger – två personer = halva ringen i den enas färg, andra halvan i den andras (tre = tredjedelar …) – och den snurrar sakta runt dem. Deras egna ringar på skärmen göms så länge, så färgerna inte blandas
- **Inga pratbubblor från NPC:erna** längre (faktabubblorna mellan avatarerna på skärmen finns kvar)
- **"Vem du blev"-skylten** på skärmen: större, nästan ogenomskinlig mörk skylt med guldram och guldtext – syns 8 s när man kliver upp
- **Bänken lyser under sig** i din färg när du sätter dig (tonar in/ut)

### Beslut (inget att bygga)
- Avataren: behåll speglingen + egna rörelser vid gester · Restaurangskylten: **Guldheden** · Bilen från 1956: behåll · "Mer lik verkligheten" gällde torget på skärmen · Låtarna: från en sajt med gratis ljud · Faktatexterna: godkända

---

# Arkiv – feedback v4


Källa: den inklistrade feedbacken (Menu, Storyline, Historical, Music, Social Meter, Interactions, Controls, Player Color, Rules, Spectator, Stage Area, Screen Layout).
**27 punkter är tydliga nog att bygga direkt** – alla fyra omgångarna är byggda och ligger under Att testa. **7 punkter väntar på beslut** (längst ner). **🧪 = testa när omgången är klar.**

**Ord vi använder** · *Spelarfigur* = den du styr · *Avatar* = figuren på skärmen · *NPC* = besökare som datorn styr · *Scenen* = trägolvet framför skärmen · *Pratplats* = 2-fotspåren · *Dansplats* = 3-fotspåren

---

## 📋 Att göra

### Omgång A – snabba UI- och regelfixar · ✔ byggt (🧪 under Att testa)
- [x] A1 Rubriken på startskärmen: **"The Interactive Archive at Guldhedstorget"**
- [x] A2 Tangentpanelen tillbaka (gå, springa, kamera, gester, sitta, webbkamera …)
- [x] A3 Pratbubblorna på skärmen: större text, stannar längre, tonar ut långsamt
- [x] A4 NPC:er får namnet **"Neighbour #"** ovanför huvudet (olika nummer)
- [x] A5 Tyst när ingen står på scenen (gatuljudet tas bort)
- [x] A6 Olika pratljud: två som pratar vs en grupp som pratar
- [x] A7 Ljusslingorna i marken lyser bara när det är mörkt
- [x] A8 Strålkastarna rör sig långsamt
- [x] A9 ~~Repstaket (band) runt scenen~~ – byggt, sedan borttaget på Williams begäran
- [x] A10 Tid på dygnet gäller alla spelare samtidigt (delat i multiplayer)
- [x] A11 Knuff-bubbla när en avatar står still länge: *"What will happen if I jump?"*, *"…if I clap?"*

### Omgång B – spelarfärger, mätare och fotspårsplatser · ✔ byggt (🧪 under Att testa)
- [x] B1 Varje spelare får en färg · färgad ring under avataren på skärmen
- [x] B2 Bänkar och fotspår lyser i färgen hos den som använder dem
- [x] B3 Dansande avatarer får en cirkel i allas färger runt sig
- [x] B4 **Social Meter** till höger på skärmen: 0 när ingen är där, laddas av folk – att stå på scenen ger lite, att göra saker tillsammans ger mer
- [x] B5 **Fyrverkeri** när mätaren är full
- [x] B6 **Pratplatsen** (2 fotspår) är låst: två där pratar, även om en tredje kommer nära – den tredje startar ingen dans
- [x] B7 **Dansplatsen** (3 fotspår): dans startar när alla tre är upptagna
- [x] B8 Mjukare övergång när avataren går från att följa dig till samtal/dans, och varje interaktion spelas klart innan nästa börjar

### Omgång C – avatarens egna rörelser · ✔ byggt (🧪 under Att testa)
- [x] C1 Klapp → hoppar och slår ihop hälarna
- [x] C2 Hopp → hoppar högt
- [x] C3 Vinka → stor vinkning med hela armen över huvudet
- [x] C4 Buga → kullerbytta
- [x] C5 Flygplan → avataren flyger
- [x] C6 Dans → Lindy Hop
- [x] C7 Sitter man på en bänk → avataren cyklar runt tills man reser sig

### Omgång D – skärmen 1940-tal + åskådarläge · ✔ byggt (🧪 under Att testa)
- [x] D1 Två parkerade 1940-talsbilar i skärmens bakgrund
- [x] D2 Butikerna: **Tobak**, **Konditori**, restaurangskylt, **Manufakturaffär**
- [x] D3 Åskådarläge: flygande kamera utan spelare
- [x] D4 I åskådarläget: byt tid på dygnet, lägg till/ta bort NPC:er

## 🔄 Pågår

_(tomt)_

## 🧪 Att testa

**Omgång A** – kör `npm run dev` + `npm run party` → http://localhost:5199
- Startskärmen: rubriken · tangentpanelen uppe till vänster (`H` fäller ihop den)
- Stå still på scenen ~6 s → avataren undrar *"What will happen if I jump?"* (försvinner när du rör dig)
- Två som pratar: större faktabubblor som stannar 10 s och tonar ut långsamt · ett tyst, dämpat samtal hörs · två par samtidigt → sorl av många
- Tom scen → helt tyst
- Ljusslingorna: av på dagen, halvt i skymning, fullt på natten (`T`)
- Strålkastarna sveper långsamt över scenen (3+ på scenen)
- Tid på dygnet (`T`) ändras för alla i samma rum
- NPC:er heter *Neighbour 1, 2, 3…* (vit skylt) · spelare har guldskylt, standardnamnet är nu *Guest ###*

**Omgång B**
- Alla på scenen får en egen färg: ring under avataren på skärmen + ring vid fötterna på scenen
- Fotspåren och bänkarna lyser i färgen hos den som står/sitter där
- **Pratplatsen** (2 fotspår): två där pratar – en tredje som kommer nära startar ingen dans
- **Dansplatsen** (3 fotspår): dansen startar när alla tre står där · dansarna får en cirkel i allas färger
- Var som helst: 2 nära = prat, 3+ nära = dans – men först efter att man stått ihop en liten stund, och ett samtal/en dans spelas klart minst 4 s
- Avataren glider mjukt över (~1 s) från att följa dig till samtal/dans och tillbaka
- **SOCIAL**-mätaren till höger på skärmen visar hur socialt det är **just nu**: 1 på scenen ≈ 7 %, ett par som pratar ≈ 50 %, tre som dansar = fullt · fylls snabbt, töms långsamt · visar procent · full → ramen pulserar och fyrverkerier i deltagarnas färger så länge den är full · tom scen → 0
- Avatarerna står nu lite längre in i bilden så att fötter, ringar och danscirkeln syns

**Omgång C** – gör gesterna `1`–`7` / `Space` på scenen och titta på skärmen (`V` två gånger = stor bild)
- Klapp (`3`) → avataren hoppar och slår ihop hälarna i luften
- Hopp (`Space`/`5`) → ett riktigt högt hopp med uppdragna knän
- Vinka (`1`) → hela armen svänger fram och tillbaka över huvudet
- Buga (`6`) → kullerbytta framåt
- Flygplan (`7`) → avataren lyfter, flyger en sväng över torget och landar
- Dansa (`4`) → Lindy Hop med Charleston-sparkar och "jazz hands" på slutet
- Sätt dig på en bänk (`E`) → avataren cyklar runt på en gammal cykel med korg tills du reser dig
- Varje rörelse spelas klart; gör man en ny under tiden kommer den direkt efter
- Jubla (`2`) visas som förut · hand-mot-mun-filtret fungerar som förut · andras gester syns också (skickas nu i multiplayer)

**Omgång D** – efter era referensbilder
- Butiksraden: **KONDITORI** (tårtor bakom spetsgardiner), **Tobak** (hyllor med askar), **MANUFAKTUR** (skyltdockor, tygrullar) – upplysta skyltfönster
- Restaurangen: **"Guldheden"** i vit skrivstil på taket (som på fotona – säg till om det ska vara "Guldhedstorget"), stolpar under markisen
- Två parkerade bilar längs gatan: en tvåfärgad sedan och en mörkblå coupé – med stänkskärmar, vita däcksidor och fotsteg 
- **Åskådarläge**: knappen *Watch as spectator* på startskärmen eller `O` i spelet · flyg med `W A S D`, `E`/`Space` upp, `Q` ner, `Shift` snabbare, scrolla för att glida, dra med musen för att titta (även rakt upp/ner) · du syns inte för andra och räknas inte på scenen · **panel till höger**: tid på dygnet (för alla), välj låt (bara på din dator), antal besökare + `+ Visitor` / `+ Group` / `− Visitor` / `Clear` · `O` tillbaka till din figur
- Ny knapp **− Visitor** (`B`) även i vanliga läget

**Bara riktiga personer på skärmen** – de promenerande 1940-talsfigurerna i bakgrunden är borta. Varje figur på skärmen är nu någon som står på scenen (eller sitter på en bänk). Inga bilar som kör förbi heller – bara de två parkerade.

**Tydligare social-mätare på skärmen** – en hög spalt till höger med rubriken *Together*, markeringar för vad som fyller den (👣 *Step in*, 💬 *Chat* halvvägs, 🎆 *Dance!* överst – de lyser upp när de nås), stor procentsiffra och hur många som står på scenen. En ljusstrimma glider uppåt medan den fylls, och den glöder när den är full. Den gamla nivåmätaren uppe till höger (prickar + WAITING/GROUP) är borta – spalten ersätter den.

**Lånat från kollegans gren** (`claude/eloquent-maxwell-ww7q80`, samma feedback byggd parallellt)
- Social-mätaren "just nu" (i stället för att laddas upp över tid) + procent + pulserande ram
- Effektivare fyrverkerier (ett partikelmoln per smäll i stället för 260 sprites) i deltagarnas färger
- Åskådarpanelen (tid, låt på egna datorn, besökare), mjukare flygning, titta fritt upp/ner
- "Bo changed the time of day to night" när någon annan byter tid
- Pratbubblor hamnar ovanför NPC:ernas namnskyltar (var en bugg hos oss)
- Tankebubbla med små bubblor i stället för spets · namnskylten döljs under knuffen
- Cykeln i spelarens färg · färgad ljuspöl under bänken · strålkastarkonerna på skärmen sveper också
- Samma gest två gånger i rad ger två rörelser (gestens tid skickas med i multiplayer)
- Multiplayer-testet: 12 kontroller (tid på dygnet + den som ansluter sent får rätt tid) · dokumentation uppdaterad

_Prestanda med full scen + fyrverkeri: ~3,5 ms/bild, ~325 draw calls. Multiplayer-testet: 12/12._

## ✅ Klart (redan byggt sedan tidigare)

- Kliva upp på scenen → skärmen går från svartvitt till färg och musik börjar
- Var som helst på scenen: 2 nära varandra pratar, 3+ nära varandra dansar

## ❓ Väntar på beslut

1. **Avataren som egen karaktär** i stället för spegling – ska webbkamerans spegling försvinna helt, eller finnas kvar som en lätt påverkan?
2. **Hålla hand** – med vem (närmaste 1–2 inom ~1,5 m?), måste båda trycka? Synkad gruppdans (3+ håller hand) och blommor ur händerna hänger på detta.
3. ~~Byta musik i åskådarläget~~ → löst: bara på den egna datorn (som i kollegans gren)
4. **"Mer lik bilden / mer historiskt korrekt"** – vad mer konkret saknas (utöver butikerna)?
5. **Ny konststil för skärmens bakgrund** – vilken riktning? (målad/akvarell, 40-talsvykort, fototexturer …)
6. **Restaurangskylten** – feedbacken säger "Guldhedstorget", men på 1940-talsfotona står det **"Guldheden"**. Vilken?
7. ~~Repstaketet~~ → löst: inget staket (borttaget)

**Ändrar tidigare beslut:** ljusslingor bara på natten (vi gjorde dem nyss synliga på dagen) · tangentpanelen tillbaka (togs bort i v2) · tyst tom scen (gatuljudet spelade förut).

---

# Arkiv – feedback v2 och v3

## 🔄 Pågår

_(tomt)_

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
   - **Tom scen:** svartvit, repig gammal film · ~~1940-talsfigurer promenerar~~ (borttaget, se nedan) · ~~1940-talsbilar kör förbi~~ (borttaget)
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
- Fotspår: bara vägledning, inget händer när man står på dem
- Gatuljud: bara ett (de två filerna var identiska) · Sorl: fritt ljud (public domain, Wikimedia Commons)
- Webbkamera: kvar på `C` · Online-raden: bort
- Skratt: borttaget helt (feedback v3) – bara sorl när avatarerna pratar
- Fotspåren: skoavtryck utan tår, med tån mot skärmen
- Ljusslingorna i marken: smal infälld stållist med bärnstensfärgat ljus, tydliga mjuka ljuspulser som vandrar mot scenen (ingen svart list, inget rosa). De slutar alltid vid scenkanten – ingen slinga går in på scenen
- Skärmens 1944-mark: stora rektanglar (6 × 4 m) av ljusa, oregelbundna naturstensplattor, inramade av band av mörkare gatsten – som på ArkDes-fotot från 1940-talet (ARKM.1962-101-0955 på Wikimedia Commons) · gräsmatta med naturlig variation och ljus stenkant · en gräsmatta till i förgrunden till vänster med gröna bänkar och blomlåda, som på färgfotot · ljus asfalt och ljusa kantstenar på gatan

## ⚠️ Inför deploy

- **Låtarna:** varifrån kommer de? Live-sajten är offentlig, så upphovsrättsskyddad musik bör inte ligga där.
- **Faktan** i `src/facts.js` – dubbelkolla innan publik visning.
