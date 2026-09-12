# FyzBit

Webová aplikace (PWA) — datalogger pro fyzikální měření na ZŠ/SŠ. Učitel nebo žák připojí micro:bit s fyzikálním senzorem (USB kabelem, nebo Bluetooth u V2 desky) a v prohlížeči v reálném čase měří teplotu, sílu, vzdálenost nebo tlak — bez MakeCode, bez instalace, bez programování. Nasazeno na [fyzbit.cz](https://fyzbit.cz/) (GitHub Pages s vlastní doménou; stará adresa `bekousek.github.io/fyzbit/` na ni přesměrovává).

Frontend i firmware jsou v jednom repu. Frontend je čistý TypeScript bez frameworku; firmware je MakeCode/PXT projekt pro micro:bit.

## Stav projektu

**Aktuální verze: 0.2.0. Celý plán dokončení (`PLAN.md`) je hotový** — všechny nálezy z `AUDIT.md` opravené a všechny milníky (M3 firmware pipeline, M8 WebUSB flash, M9 Bluetooth) implementované.

Nad rámec `PLAN.md` proběhl **webový audit** (větev `web-audit`): přístupnost na úroveň WCAG 2.2 AA, hygiena hlavičky a buildu, a stránky Ochrana soukromí / Prohlášení o přístupnosti / Licence. Podrobnosti jsou v commit zprávách té větve.

**Fáze T** (viz konec `PLAN.md`) — testování s reálným hardwarem — proběhla zatím **částečně**: první kolo s HC-SR04 přes USB (připojení, handshake i měření v pořádku). Z něj vzešly úpravy popsané níže (sjednocený firmware, čitelný graf s přepínáním veličin a jednotek, vertikální schéma zapojení, mobilní rozvržení). Druhé kolo (9.–10. 9. 2026) prošlo **všemi čtyřmi senzory, přes USB i Bluetooth, a všechny měří**. Cesta k tomu vydala čtyři nezávislé chyby, všechny popsané níže: aplikace si neuměla říct o handshake, chybu čtení čidla tiše zahazovala, `HX711.read()` bez připojeného převodníku zasekl celou smyčku, a rozsvícená fajfka na displeji zabíjela čtení DS18B20 (to byl ten skutečný důvod, proč „kabel funguje a Bluetooth ne" — ne SoftDevice).

**První běh workshopu (11. 9. 2026)** prošel se šesti účastníky a fungovalo všechno kromě **tlakoměru**: chvíli měřil, pak dlouho nic, a občas problikla hláška `no HX711 on P0/P1`. Příčina byla banální a hledala se dlouho ve firmwaru: **ve schématu zapojení byly prohozené barvy signálových vodičů** proti tomu, jak jsou kabely skutečně udělané, takže tlakoměr měl zaměněná data a hodiny.

Stojí za to si zapamatovat, *proč* to vypadalo na časování a ne na zapojení. Firmware čeká na DOUT na P0, kde ale při záměně visel vstup SCK modulu — pin bez budiče. Plovoucí vstup občas přečte nulu, takže `wait_ready_timeout()` občas uspěje a měření na chvíli „chodí". **Příznak „chvíli to jde a pak dlouho nic" u bitbangované sběrnice ukazuje na plovoucí vstup, ne na hraniční timeout.** Že to bylo všem šesti stejně, na kabelech fungujících u jiných čidel, a že RESET nepomáhal, ukazovalo správným směrem — jen jsme to čtli jako „tedy ne kabely" místo „tedy systematicky špatná informace o kabelech".

**Ještě neověřeno na hardwaru:** obnova session po pádu tabu a 15 akceptačních kritérií ze specifikace §18.

`public/firmware/fyzbit.hex` je od 8. 9. 2026 postavený `npm run firmware` z aktuálních zdrojů, takže obsahuje `degC`, hlavní smyčku přes `control.inBackground`, desetiny centimetru u sonaru, opravu znaménka z HX711 driveru (`hxRead()`), tárování mimo stream i **siloměr přesunutý z P15/P16 na P0/P1**. Ověřeno v disassembly obou řezů (V1 `0x9900` z `mbdal-binary.asm`, V2 `0x9903` z `mbcodal-binary.asm`): `hxBegin` v obou předává `SetPIN_DOUT` hodnotu 201 a `SetPIN_SCK` hodnotu 203, což je tagované kódování pin ID 100 (P0) a 101 (P1). **Na hardwaru zatím vyzkoušený není** — obraz z 1. 9. ano, tenhle ne.

Od 10. 9. 2026 k tomu přibylo: DS18B20 se čte na tři pokusy a místo `-Infinity` posílá `#ERR;DS18B20: <důvod>` (throttlovaný na 5 s), a přepnutí senzoru ukazuje na displeji písmeno veličiny (T/F/D/P) místo prvního písmene názvu, kde tři ze čtyř byly „H". Ověřeno v disassembly obou řezů: literály `"T"`, `"F"`, `"D"`, `"P"` i `"#ERR;DS18B20: "` jsou v `mbcodal-binary.asm` i `mbdal-binary.asm`.

`AUDIT.md` a `PLAN.md` zůstávají v repu jako historický záznam (nálezy auditu + krok-za-krokem plán, jak byly řešeny) — nejsou potřeba pro běžný vývoj, ale vysvětlují *proč* je kód napsaný tak, jak je (zejména netriviální opravy popsané níže).

## Architektura

Vrstvy (žádný cyklický import mezi nimi):

```
transport/  →  protocol/  →  state/  →  ui/
                                 ↕        ↑
                              export/   units/
```

- **`src/transport/`** — `Transport` je společné rozhraní pro `SerialTransport` (Web Serial, USB), `BluetoothTransport` (Web Bluetooth, Nordic UART) a `MockTransport` (simulovaný senzor pro vývoj/demo bez hardwaru). Implementace emitují syrové **chunky** přes `onChunk`, ne řádky — chunk může být část řádku, celý řádek, nebo víc řádků najednou. Nikdy nespoléhat na to, že jeden chunk = jeden příkaz.
- **`src/protocol/`** — `Parser.ts` obsahuje `parseLine()` (čistá funkce, textový řádek → typovaná zpráva) a `LineBuffer` (skládá chunky zpět na řádky přes `\n`, řeší `\r\n`). `Commands.ts` staví odchozí příkazy (`#RATE;10\n` apod.).
- **`src/state/`** — `AppState` je typovaný event bus + reaktivní stav (žádný framework, žádné proxy kouzlo — komponenty se přihlašují přes `bus.on(event, fn)`). `AutoSave` průběžně ukládá do IndexedDB (`Storage.ts`, přes `idb-keyval`) pro obnovu po pádu tabu. `Settings.ts` drží uživatelské preference (jazyk, motiv, vzorkovací frekvence) v localStorage.
- **`src/state/derive.ts`** — rychlost a zrychlení **počítá aplikace**, ne firmware. Z kanálu s délkovou jednotkou (sonar `d`) se dopočítá `v` a `a` proklá­dáním polynomu klouzavým oknem (0,3 s pro rychlost, 0,8 s pro zrychlení). Firmwarový `v` se zahazuje — byl to rozdíl dvou sousedních vzorků kvantovaných na celé cm, což je šum větší než signál. Odvozené kanály jsou po připojení **vypnuté** (měřená veličina je to podstatné).
- **`src/units/units.ts`** — rodiny jednotek (délka, rychlost, zrychlení, teplota, síla, tlak) a uživatelem zvolená *zobrazovací* jednotka. Ve stavu i v uloženém běhu je vždy **základní jednotka z firmwaru**; převádí se až při zobrazení (graf, velká hodnota, statistiky výběru, CSV/PDF), takže přepnutí cm → m uprostřed měření nemůže poškodit data. Preference se drží po rodinách v localStorage. Tady žije i `normalizeUnit()` — viz „netriviální věci".
- **`src/theme/seriesStyles.ts`** — neborevné rozlišení sérií v grafu (WCAG 1.4.1). **Vzor čáry = veličina, tvar značky = měření**, vždy, nezávisle na tom, kterou z těch dvou dimenzí zrovna nese barva. Stejné funkce kreslí i legendu (čipy veličin, seznam měření), takže klíč na plátně a klíč v UI se nemůžou rozejít.
- **`src/ui/ChartDataView.ts`** — textová alternativa grafu: generované shrnutí (počet vzorků, min/max/průměr, směr trendu pro každé měření × veličinu) napojené na plátno přes `aria-describedby`, plus skutečná `<table>` pod tlačítkem „Tabulka". Tabulka se decimuje na 300 řádků (10minutové měření sonarem je 30 000 vzorků) a pod ní je poznámka odkazující na CSV.
- **`src/ui/LiveRegion.ts`** — jediná `aria-live="polite"` oblast aplikace (`#a11y-live`). Patří sem **jen diskrétní změny stavu** (připojeno, měřím, uloženo). Průběžná hodnota do ní nikdy nesmí — při 50 Hz by čtečka nedomluvila; proto `#big-value` žádné `aria-live` nemá.
- **`src/ui/`** — vanilla komponenty, styl konstruktor + `required()` helper (z `src/utils/dom.ts`) pro povinné DOM elementy. `App.ts` je top-level orchestrátor, který propojuje transport → parser → stav → UI. `Dialog.ts` nahrazuje `window.alert/confirm/prompt` vlastními `<dialog>`-based modály. `ChannelControls.ts` je řádek „čipů" nad grafem (legenda + zapnutí/vypnutí veličiny + volba jednotky), `MobileNav.ts` přepíná na úzkých displejích `data-view` na `#app`, `PanelExpand.ts` nastavuje `data-expanded` (soustředěný režim jednoho panelu) — samotné skrývání dělá CSS a rozvržení je stejné, jen jinak spouštěné. Na širokých displejích `data-expanded` schová sousední sloupce, na úzkých topbar a spodní záložky (tam šířka nikdy nechyběla, chyběla výška) a navíc si řekne o skutečný fullscreen, ať zmizí i adresní řádek prohlížeče.
- **`src/export/`** — CSV (`csv.ts`), PDF (`pdf.ts`, přes jsPDF — **lazy-loaded**, viz níže), PNG (`png.ts`, export grafu).
- **`src/flash/Flasher.ts`** — WebUSB flashování firmwaru přímo z aplikace, přes `@microbit/microbit-connection` (oficiální knihovna Micro:bit Educational Foundation, MIT licence). **Lazy-loaded** dynamickým importem v `ConnectionModal.ts`.
- **`src/theme/`** — světlý/tmavý motiv přes CSS custom properties + `runColors.ts` (barvy runů čtené z `--chart-series-N`, ne hardcoded paleta).
- **Statické textové stránky** — `pristupnost.html`, `soukromi.html`, `licence.html`, `404.html`. Jeden společný vstupní bod `src/page.ts` (jen `initTheme()` + razítko roku) a `src/styles/page.css`. Každá je samostatný Vite entry point v `rollupOptions.input` — kdo přidá další, musí ji přidat i tam **a** do `sw.ts` precache a `public/sitemap.xml`.
- **`firmware/source/`** — dva MakeCode/PXT projekty (viz sekce Firmware níže).

### Protokol (micro:bit ↔ aplikace)

Řádkově orientovaný ASCII protokol přes sériovou linku (USB) nebo Bluetooth UART, `\n`-terminated:

```
← micro:bit → PC
  #HELLO;v1;board=V1|V2;sensor=<name>
  #CH;<id>;<NAZEV>;<JEDNOTKA>;<MIN>;<MAX>   (jednotka je ASCII: "degC", ne "°C")
  #READY
  #TARE;ok | #TARE;err
  #CAL;<id>;ok;<faktor>;<předchozí>
  #ERR;<text>
  <id>:<hodnota>;<id>:<hodnota>          (datový řádek)

→ micro:bit
  #HELLO?
  #TARE
  #CAL;<id>;<hodnota>
  #RATE;<hz>                              (1, 5, 10, 25, 50)
  #SELECT;<sensorName>                    (DS18B20, HX711, HCSR04, HX710B)
  #START / #STOP
```

Firmware sám hlídá framing (`serial.readUntil`/`bluetooth.uartReadUntil`), aplikace na straně JS to samé přes `LineBuffer`. **Nikdy nepředpokládat, že jeden „chunk" z transportu = jeden příkaz** — přesně tohle byla nejzávažnější chyba nalezená auditem (viz `AUDIT.md` N1).

## Vývoj

```bash
npm install
npm run dev       # vývojový server, http://localhost:5173
npm run build     # tsc --noEmit && vite build → docs/ (GitHub Pages root)
npm run test      # Vitest (tests/*.test.ts)
npm run lint      # ESLint (flat config, strict TS, no-any jako warning)
npm run format    # Prettier
npm run firmware  # postaví oba firmware projekty a spojí je do public/firmware/fyzbit.hex
```

CI (`.github/workflows/deploy.yml`) běží na push do `main`: typecheck → lint → test → build → deploy na GitHub Pages. Firmware build **není** součástí CI (síťová závislost na makecode.microbit.org by mohla shazovat deploy) — `.hex` je commitnutý jako distribuční artefakt v `public/firmware/`.

Web běží na vlastní doméně **fyzbit.cz** (GitHub Pages, Settings → Pages → Custom domain; `public/CNAME` drží stejnou hodnotu). Proto je `base` ve `vite.config.ts` `'/'` a `start_url`/`scope` v `manifest.json` `"/"` — kdyby se web někdy vrátil pod `bekousek.github.io/fyzbit/`, musí se změnit obojí zároveň.

### Konvence

- Vanilla TypeScript, žádné nové frameworky. `strict: true`, `noUncheckedIndexedAccess`, žádné `any` (lint warning).
- Komponenty ve stylu existujících: konstruktor + `required<T>(selector, scope)` z `src/utils/dom.ts` pro povinné DOM elementy.
- Vše, co jde do `innerHTML`, projde přes `escapeHtml()` (`src/utils/dom.ts`) — jediné místo, kde se to dělá, žádné duplicitní implementace.
- Každý nový UI text má klíč v `src/i18n/cs.json` **i** `en.json` — parita klíčů je 1:1 a musí tak zůstat (dá se ověřit `node -e` skriptem, co projde oba JSONy a porovná ploché klíče).
- Těžké/vzácně používané závislosti (jsPDF, `@microbit/microbit-connection`) se importují **dynamicky** (`await import(...)`) v místě použití, ne staticky nahoře v souboru — jinak nabobtná hlavní bundle (viz `PdfExportModal.ts`, `ConnectionModal.ts`, `Flasher.ts`).
- **Cíl přístupnosti je WCAG 2.2 AA a platí i pro nový kód.** Prakticky: každý ovládací prvek má přístupné jméno (ikona sama nestačí — glyf patří do `<span class="btn__icon" aria-hidden="true">` a text do `<span class="btn__label">`), formulářová pole mají `<label for>`, chyby `aria-invalid` + `aria-describedby`, nic není ovladatelné jen myší, barva nikdy nenese informaci sama. Stav aplikace se hlásí přes `announce()` z `LiveRegion.ts`.
- **Barvy jen přes tokeny z `theme-light.css` / `theme-dark.css`.** Hardcoded hex v `main.css` je chyba — přesně tak vznikl bílý text na světle zeleném tlačítku v tmavém motivu (2,4 : 1). Text na sytých výplních má vlastní tokeny `--fg-on-accent` (akcent) a `--fg-on-status` (danger / warning), protože v tmavém motivu je to inkoust, ne bílá.
- Testy (`tests/*.test.ts`) se nepřepisují ani nerozšiřují bez konkrétního důvodu — nejsou součástí běžného vývojového cyklu podle `PLAN.md`, jsou to jen kontrolní testy spouštěné v CI.

### Netriviální věci, na které je dobré pamatovat

- **Node ≥22 experimental `localStorage` stíní jsdom.** Testy (`vite.config.ts`, blok `test`) běží s `execArgv: ['--no-experimental-webstorage']`, jinak `localStorage` v testovém prostředí spadne na `undefined`. Bez tohoto nastavení testy lokálně padají i na čistém checkoutu.
- **TypeScript je záměrně na `^6.0.3`, ne na nejnovější `7.x`.** `typescript-eslint` má peerDependency strop `<6.1.0` — bump na TS 7 by rozbil linting. Kontrolovat při budoucích upgradech.
- **WebUSB a Web Serial nemůžou držet stejné zařízení otevřené současně.** `Flasher.ts` po flashi vždy volá `usb.disconnect()`, jinak by následný pokus o „Připojit → USB kabel" (Web Serial) selhal.
- **`usb.connect()`/`bluetooth.connect()` musí běžet synchronně z click handleru** (bez `await` před nimi) — jinak prohlížeč ztratí "user activation" a nativní device picker se nezobrazí.
- **`[hidden]` prohrává s každou třídou, která nastaví `display`.** Atributový selektor v UA stylesheetu má stejnou specificitu jako třída a prohrává pořadím, takže `.flash-progress { display: flex }` element zobrazil i s `hidden`. V `main.css` je proto hned nahoře `[hidden] { display: none !important; }` — bez toho svítil v dialogu prázdný progress bar.
- **Skrytý grid item posune ostatní o řádek.** `#app` má `grid-template-rows: auto 1fr auto`; když soustředěný režim schoval topbar (`display: none`), `main.layout` se posunula do prvního `auto` řádku a smrskla se na výšku obsahu — graf byl *menší* než předtím. Řádky proto mají pojmenované oblasti (`bar`/`body`/`tabs`) a prvky explicitní `grid-area`.
- **uPlot `height` je výška *plotu*, legenda se kreslí pod ním.** Předat kontejnerovou výšku znamená, že legenda vyteče ven. `Chart.fitToContainer()` proto legendu po vytvoření změří a plot zmenší o její výšku.
- **uPlot rozumí mezerám jako `null`, ne `NaN`.** `NaN` projde jeho kontrolou na null, ale prohraje každé porovnání, takže série, která začíná `NaN` (odvozený kanál, než se naplní okno), skončí bez rozsahu škály a **nevykreslí se vůbec** — bez chyby. `Chart.buildAlignedData()` proto do dat dává `null`, i když v `Run.values` je `NaN`.
- **Časový výřez grafu má jediného vlastníka — `range` funkci osy x.** uPlot ji volá při *každém* přerozsahování, včetně autoscale, který následuje po každém `setData`, takže průběžné okno i ruční přiblížení musí rozhodovat právě ona — jinak je další nastřádaný vzorek přepíše zpátky na celý běh. Argumenty `dataMin`/`dataMax` se přitom musí ignorovat: při explicitním `setScale` nesou *požadovaný* rozsah, ne rozsah dat, takže by odpověď závisela na tom, kdo se zrovna ptal. Rozsah dat si `Chart` počítá sám z `visibleRuns`.
- **`cursor.drag.setScale` musí zůstat `false`.** Tažením se v grafu vybírá úsek pro panel statistik; s výchozím nastavením by uPlot na stejné tažení ještě zoomoval a `range` funkce mu ten zoom hned vracela na celou šířku — přiblížení proto má vlastní ovládání (tlačítka, kolečko myši, `+`/`-`, `←`/`→`).
- **Firmware smí sáhnout jen na P0, P1 a P2.** Jen ty (plus 3V a GND) mají velký pad s dírou pro krokosvorku; P3–P16 jsou milimetrové proužky, na které se bez breakout desky nedá připojit nic — a školní sada ji mít nemusí. Siloměr proto nesedí na P15/P16, kam ho dává rozšíření `fyzikalni_senzory`, ale na P0/P1 společně s tlakoměrem: uvnitř obou modulů je stejný převodník HX711 na stejném páru drátů, takže i schéma zapojení je jedno. Že si senzory piny přebírají, nevadí — připojený je vždycky jen jeden. V `WiringDiagram.ts` to hlídá typ `Pad`, který je odvozený z tabulky pěti padů.
- **Vzorkovací frekvence je vlastnost senzoru, ne preference.** `RECOMMENDED_RATE_HZ` v `Commands.ts`: DS18B20 1 Hz (jedno 12bit měření trvá ~750 ms), HX711/HX710B 10 Hz, HC-SR04 50 Hz. Nastavení „Vzorkovací frekvence" je defaultně `auto` a znamená právě tuhle tabulku.
- **HX711 driver vrací `raw ± 2^23`, ne `raw`.** `pxt-myhx711` nejdřív rozšíří 24bitové znaménko na 32 bitů a *pak* překlopí znaménkový bit, takže kladný vzorek přijde jako `raw + 8388608` a záporný jako `raw − 8388608`. Konstantní posun by nevadil (tára i kalibrace ho pohltí), jenže tenhle mění znaménko podle měření — hodnota tedy **skočí o 2^24 kroků** ve chvíli, kdy měření překročí elektrickou nulu ADC: ~29 kPa u tlakoměru, ~1600 N u tenzometru. Firmware to proto rovná v `hxRead()` a `pressOffset` (`-57595972`) je posunutý o tu samou 2^23 proti výchozí hodnotě z `fyzikalni_senzory`.
- **Rozsah tlakoměru neomezuje čidlo, ale ADC.** Plný rozsah HX710B odpovídá jen ±14 kPa kolem elektrické nuly modulu (581,84 kroku na Pa × 2^23 kroků), takže MPS20N0040D svých 40 kPa nikdy neukáže. Kde ta nula na modulu leží, je vlastnost kusu — u testovaného kusu asi 1 kPa pod atmosférickým tlakem, tedy zhruba +13 kPa nahoru a −15 kPa dolů. Zobrazované „absolutní" kPa jsou fikce výchozího offsetu; čidlo je manometrické (rozdíl proti okolí) a bez `#CAL` je i měřítko cizí.
- **Kalibrační faktor se nedá posuzovat podle velikosti, jen podle změny.** Firmware v `#CAL` posílá měřítko v krocích převodníku na jednotku, takže jeho velikost je vlastnost čidla (−10578 u siloměru, 581,84 u tlakoměru), ne číslo blízké jedničce. Průvodce ho proto proti 1,0 porovnávat nesmí — dělal to a varování „faktor výrazně mimo" svítilo u **každé správné** kalibrace těch dvou čidel, zatímco u skutečně špatné by mlčelo. Odtud pátý údaj v `#CAL;<id>;ok;<nový>;<předchozí>`: rozhoduje poměr obou. Když pátý údaj chybí (deska se starším firmwarem), varování se neukáže vůbec — falešné varování je horší než žádné.
- **`set_gain()` nepatří do každého vzorku.** `hxBegin()` ho volal pokaždé, a protože `set_gain()` končí `read()`, spotřeboval navíc celou konverzi — při 10 Hz tedy 100 ms a 25 dalších hodinových pulzů, ve kterých se dá trefit power-down, na každé jedno měření. Tlakoměr tím reálně streamoval ~2,5 Hz místo 10 Hz. Driver si zesílení drží v globálu, takže stačí jednou: hlídá to `hxStartedGain`, který se nuluje při selhání čekání (resetovaný čip zesílení zapomněl) i při změně čidla.
- **`HX711.read()` i `HX711.begin()` čekají na převodník donekonečna.** Obojí začíná `wait_ready(0)`, což je neomezené `while (!is_ready())` — rozšíření to samo přiznává komentářem „will halt the sketch until a load cell is connected" — a `is_ready()` neznamená nic víc než „DOUT je v nule". (`begin()` se tam dostane přes `set_gain()`, které končí `read()`.) Bez připojeného modulu DOUT drží log. 1, takže se **hlavní smyčka zasekne natrvalo**: deska nestreamuje nic, po žádném transportu, a protože zaseknutý fibr už se nikdy nepodívá na `currentSensor`, nepomůže ani přepnutí čidla v aplikaci — jen RESET. Sériová obsluha přitom běží dál (`basic.pause(0)` uvolní scheduler), takže se aplikace normálně „připojí" a tváří se v pořádku. Přesunem siloměru na P0 se z toho stala jistota místo náhody: P0 sdílí s datovou linkou DS18B20, kterou 4,7k pull-up drží tvrdě nahoře. Proto `hxBegin()` vrací `boolean` a před každým čtením stojí `HX711.wait_ready_timeout()`; kdo ho obejde, vrátí ten zámrz zpátky.
- **`dstemp.celsius()` vrací při chybě `-Infinity`, ne malý sentinel** — a MakeCode ho vytiskne jako doslovný řetězec `"-Infinity"` (`PXT_DEF_STRING(sMInf, ...)`). Než to firmware začal odchytávat, šel takový vzorek na drát jako `t:-Infinity`, aplikace ho v `parseData()` neuměla přečíst jako číslo a **celý řádek tiše zahodila** (`unknown`, logovaný jen v DEV). Rozbité čidlo tím pádem vypadalo úplně stejně jako funkční, které zrovna nemá co říct: velká hodnota `—`, prázdný graf, nikde ani chyba. Firmware proto teď posílá `#ERR` a parser navíc rozlišuje `sensor-error` — ale **jen pro nekonečno**, ne pro každé „nečíslo": desetinná čárka je chyba protokolu, ne čidla, a zůstává `unknown` (hlídá to test v `tests/protocol.test.ts`).
- **Rozsvícený LED displej zabíjí čtení DS18B20.** Matice se multiplexuje softwarově z vysokoprioritního časovačového přerušení, takže *dokud svítí*, běží ta obsluha pořád dokola — a čtecí slot 1-Wire se musí navzorkovat do 15 µs. `onBluetoothConnected` rozsvěcoval ✓ a **nikdy ho nezhasl**, takže po připojení přes Bluetooth přestal teploměr číst až do resetu desky. Po USB matici nerozsvítí nic, což je celý důvod, proč „kabel funguje a Bluetooth ne" — s rádiem to má společného míň, než se zdálo. Proto se po každém `showIcon`/`showString` volá `basic.clearScreen()`; kdo přidá další zobrazení na displej, musí ho zhasnout taky.
- **Bitbangované 1-Wire a *aktivní* BLE spojení si nesednou.** `microbit-dstemp` čte DS18B20 aktivním čekáním (`system_timer_wait_cycles`) a nikde nemaskuje přerušení; čtecí slot se přitom musí navzorkovat do 15 µs od stažení linky. Jakmile existuje BLE spojení, SoftDevice si bere rádio každý connection interval s nejvyšší prioritou a tím oknem projede. Pouhé inzerování (stav desky na kabelu) nechává dlouhé klidné mezery — proto ta samá deska se stejnou binárkou po USB čte a přes Bluetooth ne. Ovladač si toho je vědom sám: `configTimer()` má podmínku `if (!ble_running())`. Opakování v `readDS18B20()` je zmírnění, ne oprava.
- **Handshake si musí vyžádat aplikace.** Firmware ho nabídne sám dvakrát — ~200 ms po bootu a při každém BLE připojení — a obojí se dá minout. Po USB to dlouho fungovalo náhodou: interface čip drží bootovací `#HELLO` v bufferu, dokud port někdo neotevře. Přes Bluetooth se deska ohlásí v okamžiku navázání GATT spojení, tedy dávno předtím, než prohlížeč stihne odebírat UART notifikace, takže handshake spadne do prázdna a aplikace visí na „Připojuji…" nad daty, která nemá jak pojmenovat. `App.requestHandshake()` proto posílá `#HELLO?` opakovaně (8× po 700 ms) — i ten první dotaz se totiž může ztratit stejnou cestou. Ruční záchrana zůstává A+B na desce.
- **Tárování běží v hlavní smyčce, ne v obsluze příkazu.** `#TARE` jen nastaví příznak; `applyPendingTare()` ho spotřebuje na začátku každé iterace — i když se zrovna nestreamuje. Smyčka je jediný vlastník bit-banged sběrnice HX711, tárování z fibru sériové obsluhy by se s jejím čtením prokládalo.
- **Připojeno znamená streamuje.** Aplikace posílá `#START` hned po `#READY` a `#STOP` už neposílá vůbec; START/STOP v UI rozhoduje jen o *nahrávání*. Bez toho po prvním zastavení zamrzla velká hodnota a hlavně přestala fungovat tára — deska nic nečetla, takže nebylo co vynulovat, a učitel musel nulovat uprostřed měření a rozhodit si měřítko grafu. `#START` po handshaku je tam i proto, že deska napájená z USB přežije reload stránky i ve stavu „zastaveno", do kterého ji poslala minulá session.
- **`basic.forever` ve firmwaru má strop ~50 Hz a v praxi míň.** Po každé iteraci spí pevných 20 ms, takže perioda je *tělo + 20 ms*. Hlavní smyčka proto běží přes `control.inBackground` s vlastním pacingem, který od pauzy odečte dobu čtení.
- **`<title>` má vlastní i18n klíč `app.documentTitle`, ne `app.title`.** Delší titulek je kvůli vyhledávačům; `app.title` zůstává krátká značka, protože stejný klíč používá i hlavička v aplikaci. Kdo by je sloučil, dostane do topbaru celou větu.
- **JSON-LD projde i přes `script-src 'self'`.** Blok `<script type="application/ld+json">` je datový, ne spustitelný, takže ho CSP neřeší a nepotřebuje hash ani nonce — přidávat je zbytečné.
- **`public/sitemap.xml` má `lastmod` napsaný ručně.** Je to jediná URL, takže se negeneruje při buildu; při větší změně obsahu ho stačí přepsat, jinak zestárne bez následků.
- **Service worker cachuje HTML pod URL požadavku, ne pod jedním klíčem.** Původně ukládal každou HTML odpověď jako `index.html`; jakmile přibyla druhá stránka, offline by na `/soukromi.html` vrátil aplikaci. Shell zůstal jen jako poslední záchrana pro navigaci, kterou SW nikdy neviděl.
- **jsPDF má volitelné závislosti, které se zabundlují, i když je nepoužiješ.** `canvg`, `html2canvas`, `dompurify` a `core-js` existují kvůli `doc.html()`; FyzBit dává graf do PDF jako PNG, takže je ta cesta mrtvá — ale nainstalované se zabalily do tří lazy chunků (~378 kB). Jsou proto v `rollupOptions.external` (a `onwarn` tiší `UNRESOLVED_IMPORT`). Kdyby někdo někdy chtěl `doc.html()`, musí je z `external` vyndat.
- **Světlý motiv je i výchozí `:root`, ne jen `[data-theme='light']`.** Statické stránky musí být čitelné i bez JavaScriptu, a `data-theme` nastavuje až `initTheme()`. Vedlejší efekt: v aplikaci zmizel bliknutý nestylovaný stav.
- **`?lang=cs|en` má přednost před uloženou volbou** a rovnou se uloží. Existuje kvůli `hreflang` (jedna URL by neměla co nabídnout) i prakticky — dá se poslat anglický odkaz.
- **Kresba desky micro:bit je CC BY-NC-SA 4.0, ne MIT.** Jediný soubor v repu s jinými podmínkami (`public/img/microbit-board.svg`). Pro školní použití v pořádku; komerční nasazení by ho muselo nahradit. Atribuce je v hlavičce souboru, pod schématem v aplikaci, v `licence.html` a v `NOTICE`.
- **`NOTICE` a `licence.html` musí zůstat v souladu se skutečnými závislostmi.** Apache-2.0 (idb-keyval, vložený Roboto) a BSD-3-Clause (nrf-intel-hex) atribuci vyžadují. Po každém přidání runtime závislosti obojí projít.
- **`npm run format` přeformátuje celý repozitář, ne jen rozdělané soubory.** Repo Prettierem projité není a CI ho nekontroluje (`deploy.yml` pustí typecheck → lint → test → build, nic víc), takže jedno spuštění nadělá 40+ změněných souborů, ve kterých se vlastní oprava ztratí. Když je potřeba zkontrolovat formát nového kódu, pustit `npx prettier <soubor>` do souboru stranou a porovnat — ne přepsat strom.
- **Analytika není a zapnutí není jednořádkovka.** Zakomentovaný blok GoatCounteru v `index.html` je jen krok 1 — bez rozšíření CSP (`script-src`, `connect-src`) ho prohlížeč tiše zablokuje, a `soukromi.html` dnes tvrdí, že žádná analytika neběží.
- **Zrušení připojení uprostřed device pickeru.** `App.disconnect()` zahodí referenci na transport; `connect()` po `await transport.connect()` porovná `this.transport !== transport` a případně port zase zavře. Stejnou kontrolu má i `onChunk`/`onDisconnect` handler — jinak by data ze zahozeného transportu tekla do parseru (a padala na `null` bufferu).

## Firmware

Dva MakeCode/PXT projekty v `firmware/source/`, ale **distribuuje se jediný soubor** — `public/firmware/fyzbit.hex`. Je to micro:bit *universal hex*: jeden soubor se dvěma nezávislými obrazy desky, ze kterých si bootloader nechá jen ten svůj.

| slice | projekt | co umí |
| --- | --- | --- |
| V1 (`0x9900`) | `fyzbit-v1` | USB |
| V2 (`0x9903`) | `fyzbit-ble` | USB *i* Bluetooth (Nordic UART) současně |

Tím pádem otázku „umí tenhle micro:bit Bluetooth?" **řeší hardware při flashi**, ne uživatel výběrem varianty ani runtime kontrola ve firmwaru — runtime kontrola by stejně nepomohla, protože problém V1 není, že by BLE běžet nemělo, ale že se senzorové drivery plus celý BLE stack **nevejdou** (flash + 16 kB RAM). V UI proto není žádný přepínač varianty; `fyzbit-ble` reálně zkompiluje i pro V1, ale ten obraz se nikam nedistribuuje.

Staví se přes `npm run firmware` (`scripts/build-firmware.mjs`, používá `makecode`/`mkc` CLI, potřeba síť — stahuje toolchain a GitHub-hostované senzorové drivery); spojení obou obrazů dělá `@microbit/microbit-universal-hex` (oficiální knihovna Micro:bit Educational Foundation, MIT; do `devDependencies` je přidaná explicitně, i když ji `@microbit/microbit-connection` tahá i tranzitivně).

`firmware/source/*/built/` a `pxt_modules/` jsou v `.gitignore` (generované; přebuildí se lokálně). `.hex` v `public/firmware/` **je** commitnutý (distribuční artefakt).

Uživatel v aplikaci nikdy MakeCode neotevírá — dialog „Připojit micro:bit" má krok 1 „⚡ Připravit micro:bit" (WebUSB flash přímo z prohlížeče) a fallback odkaz „↓ Stáhnout firmware (.hex)" pro ruční přetažení na disk `MICROBIT`.

Čtyři netriviální věci objevené při psaní a stavbě firmwaru (všechny by se mohly zopakovat při jeho úpravách):

1. `control.hardwareVersion()` v aktuálním MakeCode targetu vrací **`string`** (`"1"`/`"2"`), ne `number` — porovnání `== 2` neprojde typovou kontrolou při kompilaci pro V2.
2. Bluetooth „No Pairing Required" konfigurace v `pxt.json` musí obsahovat i `"security_level": null` (ne jen `open: 1, whitelist: 0`) — bez toho se zbytečně zkompiluje kód pro šifrované párování a V1 build selže na nedostatek flash (`program too big`). Přesný tvar configu odpovídá presetu v `core` balíčku (`userConfigs` → „No Pairing Required").
3. **MakeCode nahrazuje ne-ASCII znaky ve stringových literálech otazníkem.** Literál `"°C"` dorazí do aplikace jako `?C`. Firmware proto posílá `degC` a aplikace to mapuje zpět (`normalizeUnit()` v `src/units/units.ts`), včetně opravy `?C` z dříve naflashovaných desek.
4. **`fyzbit-ble` musí mít v `pxt.json` `"disablesVariants": ["mbdal"]`.** Target micro:bitu má `alwaysMultiVariant: true`, takže mkc překládá **každý** projekt pro obě desky a přepínač `--hw` ignoruje (`No such HW id`). Z `fyzbit-ble` se přitom distribuuje jen V2 řez — V1 dodává `fyzbit-v1`. Jak zdroje rostly, přestal se V1 obraz s BLE stackem vejít do flash a `program too big` shodil **celý** build, včetně V2 obrazu, který se vejde bez problémů. `disablesVariants` tu neužitečnou V1 variantu vyřadí. Připínání starší verze editoru nepomůže (zkoušeno `8.0.18` i `9.0.12`, s 8.0.18 je binárka dokonce o něco větší).

## Licence

MIT © Ondřej Bek
