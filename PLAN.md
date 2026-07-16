# FyzBit — Plán dokončení projektu (revize 3. 7. 2026)

Revize původního plánu M0–M12. Hotové milníky (M0–M2, M4–M7, M10–M12) tu nejsou; tento dokument pokrývá **jen dokončení**: opravy z auditu ([AUDIT.md](AUDIT.md)), firmware pipeline (M3), WebUSB flash (M8), Bluetooth (M9) a úklid.

## Zásady (závazné pro implementaci)

1. **Žádný user input.** Každý krok je proveditelný autonomně — žádné „počkej na uživatele", žádné „flashni a řekni, co vidíš". Kroky původního plánu, které to vyžadovaly, jsou **vyškrtnuté a přesunuté do fáze T (po dokončení)**.
2. **Žádné testování během vývoje.** Nepsat nové testy, nespouštět dev server na ověřování, žádné manuální ani preview kontroly. Testuje se až po dokončení celého projektu (fáze T).
3. **Definice „hotovo" pro každou fázi:** `npx tsc --noEmit` projde + `npm run build` projde + `npm run lint` projde. Nic víc.
4. **CI musí zůstat zelené** (deploy na Pages je jediná viditelná kontrola). Workflow spouští stávající vitest testy — ty se **nemažou ani nerozšiřují**; pokud změna API rozbije kompilaci existujícího testu, test se minimálně přizpůsobí (změna importu/volání, ne logiky). Nic jiného se s testy nedělá.
5. **Commit + push po každé fázi** (deploy ověří, že build žije). Commit message česky nebo anglicky, stručně.
6. **Každý nový UI text** má klíč v `src/i18n/cs.json` **i** `en.json` (parita klíčů je dnes 1:1, udržet).
7. Kód drží stávající konvence: vanilla TS, žádné nové frameworky, `strict` TS bez `any`, komponenty ve stylu existujících (konstruktor + `required()` helper), escapovat vše, co jde do `innerHTML`.

## Vyškrtnuté kroky původního plánu (a proč to nevadí)

| Původní krok | Proč vyškrtnut | Náhrada |
|---|---|---|
| M3: „flash ručně přetažením na MICROBIT, ověřit s reálnou aplikací" | Vyžaduje fyzický micro:bit + uživatele | `.hex` se staví **automatizovaně přes MakeCode CLI (mkc)** — kompilace samotná ověří validitu zdrojáku a závislostí; runtime ověření ve fázi T |
| M3 E2E test s reálným micro:bitem (poslední úkol staré session) | Totéž | Fáze T, připravený checklist |
| M8: „ověřit flash <30 s" (akceptační kritérium §18#1) | Vyžaduje HW | Implementace + fallback „Stáhnout .hex"; měření času ve fázi T |
| M9: BLE párování / dosah / V1-modal chování naživo | Vyžaduje HW (V2 deska) | Implementace naslepo podle Nordic UART spec; ověření ve fázi T |
| M11 „projít 15 akceptačních kritérií §18" ručně | Manuální testování | Fáze T |
| Průběžné `npm run dev` vizuální kontroly po milnících | Uživatel nechce testy během vývoje | Jen build/tsc/lint |

---

## Fáze 0 — Opravy funkčnosti z auditu (blokátory) — **S/M, ~2–3 h**

*Bez těchto oprav nemá smysl stavět firmware — kritická chyba N1 by znehodnotila každé reálné měření.*

0.1 **N1 — Serial framing (KRITICKÉ).**
   - `src/transport/Transport.ts`: přejmenovat `onLine` → `onChunk` (sémantika: surová data, může být část řádku i víc řádků). Upravit doc-komentář.
   - `src/transport/MockTransport.ts`: `emit()` přidává `\n` na konec každé zprávy (emituje validní stream).
   - `src/ui/App.ts:363-365`: odstranit hack `line.endsWith('\n') ? line : line + '\n'` → `this.buffer!.push(chunk)` beze změn.
   - `src/transport/SerialTransport.ts`: beze změny logiky, jen rename handler setu.
   - Pozor: `tests/protocol.test.ts` na LineBuffer se nemění (LineBuffer API zůstává).

0.2 **N15 — AutoSave během záznamu.** `src/state/AutoSave.ts:25-28`: v `data-point` handleru nastavit `this.dirty = true` (zápis stále 1× za 5 s přes `tick()`).

0.3 **N10 — Odesílání `#RATE`.** V `src/ui/App.ts`:
   - po přijetí `#READY` (case `'ready'` v `handleLine`) poslat `Commands.rate(settings.samplingHz)`;
   - v `start()` zaregistrovat `settings.onSamplingChange((hz) => this.sendCommand(Commands.rate(hz)))`.

0.4 **N16 — Chyby `send()`.** `App.sendCommand`: `this.transport.send(cmd).catch(...)` → console.error + pokud `!transport.isConnected()`, spustit stejný cleanup jako `onDisconnect`.

0.5 **N17 — AutoSave po resetu.** `App.resetAllData()`: po `appState.reset()` znovu `this.autoSave.start()`.

0.6 **N14 — Lint.** Smazat neviditelný BOM znak z komentáře `src/export/csv.ts:22` (přepsat větu bez vloženého znaku). Do `.github/workflows/deploy.yml` přidat krok `npm run lint` mezi typecheck a test.

0.7 **N26 — `npm audit fix`** (bez `--force`; opraví dompurify/form-data/js-yaml, nesahá na vite/vitest).

0.8 **N2 — CSV hlavičky.** `buildRunsCsv`: prohnat názvy runů/kanálů v hlavičce přes `escapeCsvField`.

0.9 **N33 — PDF patička.** `src/export/pdf.ts:233`: `fyzbit.cz` → `bekousek.github.io/fyzbit` (až doména poběží, vrátí se).

**Hotovo =** tsc + build + lint zelené. Commit: `fix: serial framing, autosave during recording, #RATE wiring + audit quick fixes`.

---

## Fáze 1 — Dokončení aplikace (UI funkčnost bez HW) — **M, ~1 den**

1.1 **Dropdown výběru senzoru (N11).** Nová komponenta `src/ui/SensorSelect.ts`:
   - `<select>` v top baru vedle status badge (do `index.html` + styl dle `.field__input`).
   - Položky = 5 senzorů z `Commands.SensorName` (i18n klíče `sensor.ds18b20` … s lidskými názvy: „Teploměr (DS18B20)", „Siloměr (HX711)", „Sonar (HC-SR04)", „Tlakoměr (HX710B)", „Teplota + vlhkost (DHT11)").
   - Zobrazený jen ve stavu connected/measuring; change → `Commands.selectSensor(name)`; po `#HELLO` (re-handshake z firmwaru) se UI samo přenačte — žádná další logika.
   - Volba se předvybere podle prvního `#CH` kanálu? Ne — firmware neposílá název senzoru; přidat do protokolu: firmware v `#HELLO` doplní `;sensor=<name>` (viz 2.2) a parser (`Parser.ts` case `#HELLO`) ho volitelně přečte → `appState.setSensorName`. Zpětně kompatibilní (pole volitelné).

1.2 **Schémata zapojení (nahradí placeholder).** `src/ui/WiringDiagram.ts` + inline SVG pro každý senzor (5 jednoduchých schémat: micro:bit pin → součástka; stačí schematické obdélníky + popisky pinů z README firmwaru: DS18B20 P0, HX711 P15/P16, HC-SR04 P1/P2, HX710B P0/P1, DHT11 P0). Přepíná se podle zvoleného senzoru (event z 1.1, default DS18B20). SVG používá `var(--fg)`/`var(--accent)` kvůli theme. `aria-label` s textovým popisem zapojení.

1.3 **Lazy jsPDF (N6).** `src/ui/PdfExportModal.ts` a `App.exportPdf`: nahradit statický import `exportPdf` dynamickým `const { exportPdf } = await import('../export/pdf')` v okamžiku submitu. Ověřit, že `export/png.ts` (malý) může zůstat statický. Build pak vytvoří samostatný chunk pro jspdf.

1.4 **Inkrementální graf (N7).** `src/ui/Chart.ts`:
   - Nová metoda `appendActivePoint()`: pokud existuje plot a nezměnila se struktura sérií, přepočítat jen data a zavolat `this.plot.setData(data, false)` + `redraw()`; plný `rebuild()` nechat pro `setChannels`/`setRuns`/theme/language/resize.
   - Union časové osy stavět inkrementálně jen pro aktivní run (cache posledního indexu).
   - Zachovat stávající throttling 30 FPS.

1.5 **Barvy runů dle theme (N21+N12).** `AppState.startRun` nebere barvu z `RUN_COLORS`, ale ukládá **index**; `Chart`/`RunsList`/`SelectionStats` čtou barvu z `cssVar('--chart-series-N')` (s fallbackem). Storage schéma: `StoredRun.color` zůstává (zpětná kompatibilita — při načtení starých dat se použije uložená barva, nové runy index). Pozn.: nejjednodušší implementace = mapovat index→CSS proměnná v jediném helperu `src/ui/runColors.ts`.

1.6 **Responsive breakpoint (N29).** `src/styles/main.css`: `@media (max-width: 900px)` → `.layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; overflow-y: auto; }`, `.panel--center { min-height: 320px; }`, topbar zalamovat (`flex-wrap`), zmenšit `.big-value__number` na 32pt.

1.7 **CSP meta (N4).** Do `index.html` `<head>`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'">`. (`unsafe-inline` u stylů kvůli inline `style=` atributům běžícího kódu; blob kvůli exportům.)

**Hotovo =** tsc + build + lint zelené. Commit: `feat: sensor select, wiring diagrams, lazy PDF, incremental chart, theme-aware run colors, responsive layout`.

---

## Fáze 2 — Firmware pipeline bez MakeCode UI (dokončení M3) — **M/L, ~1 den**

*Klíčová změna proti původnímu plánu: `.hex` se nestaví ručně v makecode.microbit.org, ale příkazem přes [pxt-mkc](https://github.com/microsoft/pxt-mkc) (`npm` balíček `makecode`, CLI `mkc`). Tím zmizí jediný krok M3, který vyžadoval člověka. mkc při prvním běhu stáhne toolchain z makecode.microbit.org (potřebuje síť), kompiluje lokálně.*

2.1 **Build skript.** `scripts/build-firmware.mjs` (nebo npm skript):
   - `npx makecode build` (příp. `mkc build`) v `firmware/source/fyzbit-v1/` — mkc čte existující `pxt.json` včetně github závislostí.
   - Výstup `built/binary.hex` zkopírovat do `firmware/fyzbit-usb.hex`.
   - Pokud výstup není universal hex (V1+V2), postavit obě varianty (`--hw` přepínač) a sloučit balíčkem `@microbit/microbit-universal-hex` (přidat do devDependencies).
   - npm skript: `"firmware": "node scripts/build-firmware.mjs"`.
   - **Riziko a fallback:** pokud se github závislosti (`microbit-dstemp`, `pxt-myhx711`, `pxt-DHT11_DHT22`) nestáhnou nebo nezkompilují, zkopírovat jejich zdrojové `.ts` soubory přímo do `firmware/source/fyzbit-v1/` jako lokální soubory (drivery jsou MIT, jednosouborové) a závislosti z `pxt.json` odebrat. To je robustnější i do budoucna.

2.2 **Drobné úpravy firmwaru** (`firmware/source/fyzbit-v1/main.ts`):
   - `#HELLO;v1;board=V1;sensor=DS18B20` — doplnit aktuální senzor (pro 1.1).
   - Příjem příkazů: místo `serial.readString()` + split použít `serial.readUntil(serial.delimiters(Delimiters.NewLine))` (nerozlomí příkaz na hranici bufferu).
   - Parser v aplikaci (`Parser.ts`): volitelné pole `sensor` z `#HELLO` (zpětně kompatibilní, stávající testy zůstávají validní — jen ověřit kompilaci).

2.3 **Spustit build, commitnout artefakt.** `firmware/fyzbit-usb.hex` se commituje do repa (je to distribuční artefakt jako dřív plánované `fyzbit-v1-v1.hex`). Do `.gitignore` přidat `firmware/source/**/built/` a `firmware/source/**/pxt_modules/`.

2.4 **UI: „Stáhnout firmware".** V `ConnectionModal` pod volby připojení přidat sekci/odkaz „⬇ Stáhnout firmware (.hex)" (import přes `new URL('/firmware/fyzbit-usb.hex', import.meta.url)` — nejjednodušší je dát hex do `public/firmware/fyzbit-usb.hex` místo rootu `firmware/`; build skript ho tam zkopíruje) + krátký text „přetáhni na disk MICROBIT". Aktualizovat `firmware/source/fyzbit-v1/README.md`: primární cesta je stažení hotového `.hex` z aplikace/repa, MakeCode import zůstává jako alternativa.

2.5 **CI:** build firmwaru do CI **nepřidávat** (síťová závislost na makecode.microbit.org by mohla shazovat deploy); hex je commitnutý artefakt, přestavuje se lokálně npm skriptem při změně zdrojáku.

**Hotovo =** `npm run firmware` doběhne a vyprodukuje hex; tsc + build + lint zelené. Commit: `feat(firmware): automated hex build via mkc + downloadable firmware in app`.

---

## Fáze 3 — WebUSB flash z aplikace (M8) — **L, 1–2 dny**

*„Připravit micro:bit" — aplikace nahraje firmware sama, bez MakeCode a bez přetahování souborů.*

3.1 **Závislost:** `@microbit/microbit-connection` (knihovna Micro:bit Educational Foundation nad DAPjs; řeší CMSIS-DAP, V1/V2 rozdíly i partial flash). Fallback, kdyby API neodpovídalo dokumentaci: přímo `dapjs`.

3.2 **`src/flash/Flasher.ts`:**
   - `isSupported()` → `'usb' in navigator`.
   - `flash(hexText: string, onProgress: (pct: number) => void): Promise<void>` — `MicrobitWebUSBConnection` → `connect()` → `flash(createUniversalHexFlashDataSource(hexText), { partial: true, progress })` → `disconnect()` (port musí být volný pro následný Web Serial).
   - Hex se fetchne z `public/firmware/fyzbit-usb.hex` až při kliknutí (lazy, ~1 MB).

3.3 **UI v `ConnectionModal`:** nová volba „⚡ Připravit micro:bit (nahrát firmware)" — viditelná jen když `Flasher.isSupported()`:
   - klik → WebUSB picker (nativní, bez naší interakce) → progress bar v modalu (nový stav modalu, ne nový dialog) → po úspěchu toast „Firmware nahrán — teď Připojit → USB kabel" a návrat na výběr transportu;
   - při chybě: chybová hláška v modalu + tlačítko „Stáhnout .hex" (fallback z 2.4). I18n klíče `flash.*`.
   - Pozn.: WebUSB a Web Serial nemohou držet zařízení současně — flasher po dokončení **musí** uvolnit device (`disconnect()`), jinak Serial connect selže.

3.4 **SW pre-cache:** přidat `./firmware/fyzbit-usb.hex` do precache listu v `src/sw.ts` (offline flash ve třídě bez wifi je přesně use-case).

**Hotovo =** tsc + build + lint zelené. Commit: `feat: in-app WebUSB firmware flashing (M8)`.

---

## Fáze 4 — Bluetooth: V2 firmware + transport (M9) — **L, 1–2 dny**

4.1 **BLE firmware.** Nový projekt `firmware/source/fyzbit-ble/` (kopie fyzbit-v1 + úpravy):
   - `pxt.json`: přidat `"bluetooth": "*"`, odebrat konfliktní `radio` (pokud by ho core tahal); konfigurace bez párování: `"yotta": { "config": { "microbit-dal": { "bluetooth": { "open": 1, "whitelist": 0 } } } }` (ekvivalent „No Pairing Required" v MakeCode; přesný tvar ověřit tím, že build projde).
   - `main.ts`: `bluetooth.startUartService()`; výstup zrcadlit do BLE (`bluetooth.uartWriteString(line + "\n")`) i USB serialu; příjem `bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), ...)` → stejný `handleCommand`. Na LED při BLE připojení bliknout symbol.
   - Build jen pro V2 (`--hw` varianta V2; V1 nemá pro BLE + drivery paměť — v souladu s původním rozhodnutím). Artefakt `public/firmware/fyzbit-ble-v2.hex`.

4.2 **`src/transport/BluetoothTransport.ts`** (implementuje `Transport`):
   - Nordic UART Service UUID `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; TX (notify) `6e400003-…`, RX (write) `6e400002-…`.
   - `connect()`: `navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'BBC micro:bit' }], optionalServices: [NUS] })` → GATT connect → subscribe TX notifikace → emitovat chunky (LineBuffer v App je poskládá — díky opravě 0.1 funguje pro libovolné dělení).
   - `send()`: zapisovat po ≤20 B chunkách (`writeValueWithoutResponse`, fallback `writeValue`).
   - `gattserverdisconnected` → fireDisconnect. `isSupported()` → `'bluetooth' in navigator`.

4.3 **UI:** odemknout Bluetooth volbu v `ConnectionModal` (odstranit `disabled`, hint text změnit na „Web Bluetooth · jen micro:bit V2 s BLE firmwarem"); po `#HELLO;…;board=V1` přes BLE teoreticky nenastane (V1 hex neexistuje) — ale pokud board=V1 dorazí přes **USB** a uživatel pak zkusí BLE, nic detekovat nejde předem → místo detekčního modalu ze specifikace §15 stačí hint v ConnectionModal + sekce v README. (Původní krok „modal při V1" vyžadoval runtime ověření s HW — zjednodušeno.)
   - „Připravit micro:bit" (3.3) dostane druhou položku: výběr firmware USB / Bluetooth (V2).

**Hotovo =** tsc + build + lint zelené; `npm run firmware` staví oba hexy. Commit: `feat: Bluetooth transport + V2 BLE firmware (M9)`.

---

## Fáze 5 — Úklid a release 0.2.0 — **M, ~0,5 dne**

5.1 **Deps:** odebrat nepoužívaný `@fontsource/roboto`; `"engines": { "node": ">=22" }`; bump `jsdom` ^29 (oprava lokálních testů na Node 26 — N24); major bumpy vite 8 / vitest 4 / eslint 10 v jednom commitu, s opravou configů (`vite.config.ts` test blok → `vitest/config` import). Po bumpu musí projít tsc + build + lint + **stávající** testy v CI.
5.2 **Duplicity (N12):** `src/utils/dom.ts` (`required`, `escapeHtml`), `src/utils/stats.ts` (`computeStats` — použít v SelectionStats i pdf.ts). Testy stats se **nepřepisují** (fáze T).
5.3 **SEO drobnosti:** OG + twitter meta tagy (title, description, og:image = icon-512), `public/robots.txt` (`Allow: /`). Sitemap netřeba (jednostránková app).
5.4 **Soukromí (N32):** do Settings „O aplikaci" a do README přidat větu „Všechna data (měření i jména žáků) zůstávají v tomto počítači; aplikace nic neodesílá."
5.5 **Verze:** `package.json` → `0.2.0` (promítne se do About + SW cache bust). Aktualizovat README (sekce firmware: mkc build, flash z aplikace, BLE).

**Hotovo =** vše zelené vč. CI. Commit: `chore: dependency bumps, dedupe utils, SEO/privacy polish, v0.2.0`.

---

## Fáze T — Testování (AŽ PO DOKONČENÍ, s uživatelem) — *mimo scope implementace*

*Sem se přesunulo všechno vyškrtnuté. Nic z toho nedělá Sonnet během vývoje.*

**T1 — Fyzický E2E (potřeba micro:bit + DS18B20):**
1. V aplikaci „Připravit micro:bit" → WebUSB flash (očekávání: progress, <30 s, bez MakeCode).
2. Připojit → USB kabel → status „Měřím: USB", teplota 18–28 °C, plynulý graf.
3. Dropdownem přepnout senzor tam a zpět (nová funkce 1.1) + tlačítkem B na desce.
4. Nastavení → 50 Hz → ověřit hustotu vzorků (oprava 0.3); zpět 10 Hz.
5. START → 2 min záznam → **zabít tab** → otevřít → Obnovit session → data do posledních ~5 s (oprava 0.2).
6. STOP/Uložit/anotace/výběr statistik/CSV/PDF/PNG s reálnými daty.
7. V2 deska: flash BLE hexu → Připojit → Bluetooth → tok dat, dosah po třídě.
8. Kalibrace siloměru se závažím — ověřit heuristiku warningu faktoru (otevřená otázka č. 4 v AUDIT.md).
9. Regresní kontrola N1: nechat běžet 10 min a hlídat konzoli na `unknown protocol line` / nesmyslné skoky hodnot.

**T2 — Software:** projít 15 akceptačních kritérií §18 specifikace; Chrome + Edge na Windows; offline PWA test; instalace PWA; napsat testy pro AutoSave, LineBuffer/framing, AppState lifecycle, Storage round-trip; přepsat `stats.test.ts` na produkční `computeStats` (po 5.2 je exportovaná).

---

## Souhrn odhadů

| Fáze | Obsah | Náročnost |
|---|---|---|
| 0 | Opravy z auditu (kritické + vysoké) | S/M (~2–3 h) |
| 1 | Sensor select, schémata, lazy PDF, graf, barvy, responsive, CSP | M (~1 den) |
| 2 | mkc firmware pipeline + hex artefakt + download UI | M/L (~1 den) |
| 3 | WebUSB flash (M8) | L (1–2 dny) |
| 4 | BLE firmware + BluetoothTransport (M9) | L (1–2 dny) |
| 5 | Deps, duplicity, SEO/privacy, v0.2.0 | M (~0,5 dne) |
| T | Testování s HW (uživatel + agent společně) | — po dokončení |

**Známá rizika implementace naslepo** (řešení připravená v textu fází): mkc nemusí stáhnout github drivery (→ vendorovat zdrojáky, 2.1); `@microbit/microbit-connection` API drift (→ dapjs, 3.1); tvar no-pairing configu v pxt.json (→ validuje build, 4.1); WebUSB vs. Web Serial exkluzivita zařízení (→ explicitní disconnect po flashi, 3.3).
