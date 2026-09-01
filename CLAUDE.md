# FyzBit

Webová aplikace (PWA) — datalogger pro fyzikální měření na ZŠ/SŠ. Učitel nebo žák připojí micro:bit s fyzikálním senzorem (USB kabelem, nebo Bluetooth u V2 desky) a v prohlížeči v reálném čase měří teplotu, sílu, vzdálenost, tlak nebo vlhkost — bez MakeCode, bez instalace, bez programování. Nasazeno na [bekousek.github.io/fyzbit](https://bekousek.github.io/fyzbit/).

Frontend i firmware jsou v jednom repu. Frontend je čistý TypeScript bez frameworku; firmware je MakeCode/PXT projekt pro micro:bit.

## Stav projektu

**Aktuální verze: 0.2.0. Celý plán dokončení (`PLAN.md`) je hotový** — všechny nálezy z `AUDIT.md` opravené a všechny milníky (M3 firmware pipeline, M8 WebUSB flash, M9 Bluetooth) implementované.

**Fáze T** (viz konec `PLAN.md`) — testování s reálným hardwarem — proběhla zatím **částečně**: první kolo s HC-SR04 přes USB (připojení, handshake i měření v pořádku). Z něj vzešly úpravy popsané níže (sjednocený firmware, čitelný graf s přepínáním veličin a jednotek, vertikální schéma zapojení, mobilní rozvržení). **Ještě neověřeno na hardwaru:** Bluetooth na V2 desce, ostatní senzory (DS18B20, HX711, HX710B, DHT11), obnova session po pádu tabu a 15 akceptačních kritérií ze specifikace §18.

Nový univerzální `public/firmware/fyzbit.hex` je poskládaný z už dřív postavených obrazů (V1 z `fyzbit-usb.hex`, V2 z `fyzbit-ble-v2.hex`), takže ještě **neobsahuje** změnu `°C` → `degC` ve zdrojích firmwaru — do doby, než někdo pustí `npm run firmware`, jednotku opravuje `normalizeUnit()` na straně aplikace (viz Firmware, bod 3).

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
- **`src/units/units.ts`** — rodiny jednotek (délka, rychlost, zrychlení, teplota, síla, tlak) a uživatelem zvolená *zobrazovací* jednotka. Ve stavu i v uloženém běhu je vždy **základní jednotka z firmwaru**; převádí se až při zobrazení (graf, velká hodnota, statistiky výběru, CSV/PDF), takže přepnutí cm → m uprostřed měření nemůže poškodit data. Preference se drží po rodinách v localStorage. Tady žije i `normalizeUnit()` — viz „netriviální věci".
- **`src/ui/`** — vanilla komponenty, styl konstruktor + `required()` helper (z `src/utils/dom.ts`) pro povinné DOM elementy. `App.ts` je top-level orchestrátor, který propojuje transport → parser → stav → UI. `Dialog.ts` nahrazuje `window.alert/confirm/prompt` vlastními `<dialog>`-based modály. `ChannelControls.ts` je řádek „čipů" nad grafem (legenda + zapnutí/vypnutí veličiny + volba jednotky), `MobileNav.ts` přepíná na úzkých displejích `data-view` na `#app` — samotné skrývání sloupců dělá CSS.
- **`src/export/`** — CSV (`csv.ts`), PDF (`pdf.ts`, přes jsPDF — **lazy-loaded**, viz níže), PNG (`png.ts`, export grafu).
- **`src/flash/Flasher.ts`** — WebUSB flashování firmwaru přímo z aplikace, přes `@microbit/microbit-connection` (oficiální knihovna Micro:bit Educational Foundation, MIT licence). **Lazy-loaded** dynamickým importem v `ConnectionModal.ts`.
- **`src/theme/`** — světlý/tmavý motiv přes CSS custom properties + `runColors.ts` (barvy runů čtené z `--chart-series-N`, ne hardcoded paleta).
- **`firmware/source/`** — dva MakeCode/PXT projekty (viz sekce Firmware níže).

### Protokol (micro:bit ↔ aplikace)

Řádkově orientovaný ASCII protokol přes sériovou linku (USB) nebo Bluetooth UART, `\n`-terminated:

```
← micro:bit → PC
  #HELLO;v1;board=V1|V2;sensor=<name>
  #CH;<id>;<NAZEV>;<JEDNOTKA>;<MIN>;<MAX>   (jednotka je ASCII: "degC", ne "°C")
  #READY
  #TARE;ok | #TARE;err
  #CAL;<id>;ok;<faktor>
  #ERR;<text>
  <id>:<hodnota>;<id>:<hodnota>          (datový řádek)

→ micro:bit
  #HELLO?
  #TARE
  #CAL;<id>;<hodnota>
  #RATE;<hz>                              (1, 5, 10, 25, 50)
  #SELECT;<sensorName>                    (DS18B20, HX711, HCSR04, HX710B, DHT11)
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

### Konvence

- Vanilla TypeScript, žádné nové frameworky. `strict: true`, `noUncheckedIndexedAccess`, žádné `any` (lint warning).
- Komponenty ve stylu existujících: konstruktor + `required<T>(selector, scope)` z `src/utils/dom.ts` pro povinné DOM elementy.
- Vše, co jde do `innerHTML`, projde přes `escapeHtml()` (`src/utils/dom.ts`) — jediné místo, kde se to dělá, žádné duplicitní implementace.
- Každý nový UI text má klíč v `src/i18n/cs.json` **i** `en.json` — parita klíčů je 1:1 a musí tak zůstat (dá se ověřit `node -e` skriptem, co projde oba JSONy a porovná ploché klíče).
- Těžké/vzácně používané závislosti (jsPDF, `@microbit/microbit-connection`) se importují **dynamicky** (`await import(...)`) v místě použití, ne staticky nahoře v souboru — jinak nabobtná hlavní bundle (viz `PdfExportModal.ts`, `ConnectionModal.ts`, `Flasher.ts`).
- Testy (`tests/*.test.ts`) se nepřepisují ani nerozšiřují bez konkrétního důvodu — nejsou součástí běžného vývojového cyklu podle `PLAN.md`, jsou to jen kontrolní testy spouštěné v CI.

### Netriviální věci, na které je dobré pamatovat

- **Node ≥22 experimental `localStorage` stíní jsdom.** Testy (`vite.config.ts`, blok `test`) běží s `execArgv: ['--no-experimental-webstorage']`, jinak `localStorage` v testovém prostředí spadne na `undefined`. Bez tohoto nastavení testy lokálně padají i na čistém checkoutu.
- **TypeScript je záměrně na `^6.0.3`, ne na nejnovější `7.x`.** `typescript-eslint` má peerDependency strop `<6.1.0` — bump na TS 7 by rozbil linting. Kontrolovat při budoucích upgradech.
- **WebUSB a Web Serial nemůžou držet stejné zařízení otevřené současně.** `Flasher.ts` po flashi vždy volá `usb.disconnect()`, jinak by následný pokus o „Připojit → USB kabel" (Web Serial) selhal.
- **`usb.connect()`/`bluetooth.connect()` musí běžet synchronně z click handleru** (bez `await` před nimi) — jinak prohlížeč ztratí "user activation" a nativní device picker se nezobrazí.
- **`[hidden]` prohrává s každou třídou, která nastaví `display`.** Atributový selektor v UA stylesheetu má stejnou specificitu jako třída a prohrává pořadím, takže `.flash-progress { display: flex }` element zobrazil i s `hidden`. V `main.css` je proto hned nahoře `[hidden] { display: none !important; }` — bez toho svítil v dialogu prázdný progress bar.
- **uPlot `height` je výška *plotu*, legenda se kreslí pod ním.** Předat kontejnerovou výšku znamená, že legenda vyteče ven. `Chart.fitToContainer()` proto legendu po vytvoření změří a plot zmenší o její výšku.
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

Tři netriviální věci objevené při psaní firmwaru (všechny by se mohly zopakovat při jeho úpravách):

1. `control.hardwareVersion()` v aktuálním MakeCode targetu vrací **`string`** (`"1"`/`"2"`), ne `number` — porovnání `== 2` neprojde typovou kontrolou při kompilaci pro V2.
2. Bluetooth „No Pairing Required" konfigurace v `pxt.json` musí obsahovat i `"security_level": null` (ne jen `open: 1, whitelist: 0`) — bez toho se zbytečně zkompiluje kód pro šifrované párování a V1 build selže na nedostatek flash (`program too big`). Přesný tvar configu odpovídá presetu v `core` balíčku (`userConfigs` → „No Pairing Required").
3. **MakeCode nahrazuje ne-ASCII znaky ve stringových literálech otazníkem.** Literál `"°C"` dorazí do aplikace jako `?C`. Firmware proto posílá `degC` a aplikace to mapuje zpět (`normalizeUnit()` v `src/units/units.ts`), včetně opravy `?C` z dříve naflashovaných desek.

## Licence

MIT © Ondřej Bek
