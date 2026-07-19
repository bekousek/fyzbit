# FyzBit

Webová aplikace (PWA) — datalogger pro fyzikální měření na ZŠ/SŠ. Učitel nebo žák připojí micro:bit s fyzikálním senzorem (USB kabelem, nebo Bluetooth u V2 desky) a v prohlížeči v reálném čase měří teplotu, sílu, vzdálenost, tlak nebo vlhkost — bez MakeCode, bez instalace, bez programování. Nasazeno na [bekousek.github.io/fyzbit](https://bekousek.github.io/fyzbit/).

Frontend i firmware jsou v jednom repu. Frontend je čistý TypeScript bez frameworku; firmware je MakeCode/PXT projekt pro micro:bit.

## Stav projektu

**Aktuální verze: 0.2.0. Celý plán dokončení (`PLAN.md`) je hotový** — všechny nálezy z `AUDIT.md` opravené a všechny milníky (M3 firmware pipeline, M8 WebUSB flash, M9 Bluetooth) implementované, mimo:

- **Fáze T** (viz konec `PLAN.md`) — testování s reálným hardwarem. Nikdo z týmu ho zatím fyzicky neměl v ruce po dokončení; potřeba: naflashovat micro:bit (jde přímo z aplikace přes WebUSB), projít měření se skutečnými senzory, ověřit obnovu session po pádu tabu, otestovat Bluetooth na V2 desce, projít 15 akceptačních kritérií ze specifikace §18.

`AUDIT.md` a `PLAN.md` zůstávají v repu jako historický záznam (nálezy auditu + krok-za-krokem plán, jak byly řešeny) — nejsou potřeba pro běžný vývoj, ale vysvětlují *proč* je kód napsaný tak, jak je (zejména netriviální opravy popsané níže).

## Architektura

Vrstvy (žádný cyklický import mezi nimi):

```
transport/  →  protocol/  →  state/  →  ui/
                                 ↕
                              export/
```

- **`src/transport/`** — `Transport` je společné rozhraní pro `SerialTransport` (Web Serial, USB), `BluetoothTransport` (Web Bluetooth, Nordic UART) a `MockTransport` (simulovaný senzor pro vývoj/demo bez hardwaru). Implementace emitují syrové **chunky** přes `onChunk`, ne řádky — chunk může být část řádku, celý řádek, nebo víc řádků najednou. Nikdy nespoléhat na to, že jeden chunk = jeden příkaz.
- **`src/protocol/`** — `Parser.ts` obsahuje `parseLine()` (čistá funkce, textový řádek → typovaná zpráva) a `LineBuffer` (skládá chunky zpět na řádky přes `\n`, řeší `\r\n`). `Commands.ts` staví odchozí příkazy (`#RATE;10\n` apod.).
- **`src/state/`** — `AppState` je typovaný event bus + reaktivní stav (žádný framework, žádné proxy kouzlo — komponenty se přihlašují přes `bus.on(event, fn)`). `AutoSave` průběžně ukládá do IndexedDB (`Storage.ts`, přes `idb-keyval`) pro obnovu po pádu tabu. `Settings.ts` drží uživatelské preference (jazyk, motiv, vzorkovací frekvence) v localStorage.
- **`src/ui/`** — vanilla komponenty, styl konstruktor + `required()` helper (z `src/utils/dom.ts`) pro povinné DOM elementy. `App.ts` je top-level orchestrátor, který propojuje transport → parser → stav → UI. `Dialog.ts` nahrazuje `window.alert/confirm/prompt` vlastními `<dialog>`-based modály.
- **`src/export/`** — CSV (`csv.ts`), PDF (`pdf.ts`, přes jsPDF — **lazy-loaded**, viz níže), PNG (`png.ts`, export grafu).
- **`src/flash/Flasher.ts`** — WebUSB flashování firmwaru přímo z aplikace, přes `@microbit/microbit-connection` (oficiální knihovna Micro:bit Educational Foundation, MIT licence). **Lazy-loaded** dynamickým importem v `ConnectionModal.ts`.
- **`src/theme/`** — světlý/tmavý motiv přes CSS custom properties + `runColors.ts` (barvy runů čtené z `--chart-series-N`, ne hardcoded paleta).
- **`firmware/source/`** — dva MakeCode/PXT projekty (viz sekce Firmware níže).

### Protokol (micro:bit ↔ aplikace)

Řádkově orientovaný ASCII protokol přes sériovou linku (USB) nebo Bluetooth UART, `\n`-terminated:

```
← micro:bit → PC
  #HELLO;v1;board=V1|V2;sensor=<name>
  #CH;<id>;<NAZEV>;<JEDNOTKA>;<MIN>;<MAX>
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
npm run firmware  # postaví oba firmware .hex (viz níže), zkopíruje do public/firmware/
```

CI (`.github/workflows/deploy.yml`) běží na push do `main`: typecheck → lint → test → build → deploy na GitHub Pages. Firmware build **není** součástí CI (síťová závislost na makecode.microbit.org by mohla shazovat deploy) — `.hex` soubory jsou commitnuté jako distribuční artefakty v `public/firmware/`.

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

## Firmware

Dva MakeCode/PXT projekty v `firmware/source/`, oba staví se přes `npm run firmware` (`scripts/build-firmware.mjs`, používá `makecode`/`mkc` CLI, potřeba síť — stahuje toolchain a GitHub-hostované senzorové drivery):

- **`fyzbit-v1`** — USB pouze, univerzální `.hex` (V1 i V2 v jednom souboru) → `public/firmware/fyzbit-usb.hex`.
- **`fyzbit-ble`** — USB *i* Bluetooth (Nordic UART Service) současně, ale distribuujeme **jen V2** image (`mbcodal-binary.hex` → `public/firmware/fyzbit-ble-v2.hex`), i když projekt reálně zkompiluje i pro V1 — V1 má jen 16 kB RAM a běh senzorových driverů + celého Bluetooth stacku najednou není runtime ověřený.

`firmware/source/*/built/` a `pxt_modules/` jsou v `.gitignore` (generované; přebuildí se lokálně). `.hex` soubory v `public/firmware/` **jsou** commitnuté (distribuční artefakty).

Uživatel v aplikaci nikdy MakeCode neotevírá — v dialogu „Připojit micro:bit" je tlačítko „⚡ Připravit micro:bit" (WebUSB flash přímo z prohlížeče) a fallback odkaz „⬇ Stáhnout firmware (.hex)" pro ruční přetažení na disk `MICROBIT`.

Dvě netriviální věci objevené při psaní firmwaru (obě by se mohly zopakovat při jeho úpravách):

1. `control.hardwareVersion()` v aktuálním MakeCode targetu vrací **`string`** (`"1"`/`"2"`), ne `number` — porovnání `== 2` neprojde typovou kontrolou při kompilaci pro V2.
2. Bluetooth „No Pairing Required" konfigurace v `pxt.json` musí obsahovat i `"security_level": null` (ne jen `open: 1, whitelist: 0`) — bez toho se zbytečně zkompiluje kód pro šifrované párování a V1 build selže na nedostatek flash (`program too big`). Přesný tvar configu odpovídá presetu v `core` balíčku (`userConfigs` → „No Pairing Required").

## Licence

MIT © Ondřej Bek
