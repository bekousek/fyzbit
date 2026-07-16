# FyzBit — Audit projektu

*Datum auditu: 3. 7. 2026 · Auditovaný stav: commit `d851ed0` (main) · Živá verze: https://bekousek.github.io/fyzbit/ (HTTP 200, nasazeno 3. 6. 2026)*

---

## Shrnutí

FyzBit je **velmi solidně rozjetý MVP**: čistá vanilla-TS architektura bez frameworku, striktní TypeScript, funkční CI/CD deploy na GitHub Pages, PWA s offline režimem, i18n (cs/en), světlý/tmavý motiv a kompletní tok Mock → graf → měření → exporty (CSV/PNG/PDF). Z původního plánu je hotovo 10 z 13 milníků; chybí firmware pipeline (M3 dokončení), WebUSB flash z aplikace (M8) a Bluetooth (M9).

Audit našel **1 kritickou chybu** (poškozování dat při čtení ze sériové linky — projeví se až s reálným hardwarem), **4 vysoké** (nefunkční nastavení vzorkovací frekvence, auto-save neukládá probíhající záznam, zranitelné závislosti, lokálně červené testy) a řadu středních/nízkých nálezů. Nic z toho není architektonický problém — jde o opravitelné implementační detaily.

---

## 1. Tech stack a struktura

| Vrstva | Technologie |
|---|---|
| Jazyk | TypeScript 5.9, strict mode + `noUncheckedIndexedAccess` |
| Build | Vite 6 (`base: /fyzbit/`, výstup do `docs/`, sourcemapy publikované) |
| UI | Vanilla TS, žádný framework; nativní `<dialog>`, CSS custom properties |
| Graf | uPlot 1.6 |
| Persistence | IndexedDB přes `idb-keyval`, `localStorage` pro nastavení |
| Export | jsPDF 4 + jspdf-autotable, vlastní CSV builder, canvas PNG |
| PWA | Vlastní service worker (`src/sw.ts`), manifest, ikony generované přes sharp |
| Testy | Vitest 2 + jsdom (49 testů: parser 26, commands 9, csv 8, stats 6) |
| Lint/format | ESLint 9 (flat config) + Prettier |
| Firmware | MakeCode (TS) projekt v `firmware/source/fyzbit-v1/` — zdroják hotový, `.hex` se zatím staví ručně v MakeCode |
| Hosting | GitHub Pages přes Actions (`.github/workflows/deploy.yml`: tsc → vitest → build → deploy), HSTS aktivní |

Architektura je čistě vrstvená: `transport/` (Serial/Mock, jednotný interface) → `protocol/` (parser + příkazy) → `state/` (typed event bus, storage, autosave) → `ui/` (komponenty) → `export/`. Orchestruje `ui/App.ts`.

**Stav vs. původní plán (M0–M12):**

| Milník | Stav |
|---|---|
| M0 tooling, M1 skeleton+chart+i18n+theme, M2 Web Serial+parser, M4 runs/anotace/stats/zkratky, M5 IndexedDB+recovery, M6 kalibrační wizard, M7 CSV/PNG/PDF, M10 PWA, M11 toasty+a11y, M12 deploy | ✅ hotovo |
| M3 firmware V1 | ⚠️ zdroják hotový, chybí automatizovaný build `.hex` a ověření (bylo zaseknuté na fyzickém testu) |
| M8 WebUSB flash z aplikace | ❌ nezačato (žádný `Flasher.ts` v repu) |
| M9 firmware V2 + Bluetooth | ❌ nezačato (žádný `BluetoothTransport.ts`) |

---

## 2. Nálezy podle oblastí

### 2.1 Bezpečnost

**N1 — Poškozování dat na sériové lince (KRITICKÉ, funkční i „bezpečnost dat")**
[App.ts:363](src/ui/App.ts:363) přijímá od transportu chunk a pokud nekončí `\n`, **uměle ho doplní**: `this.buffer!.push(line.endsWith('\n') ? line : line + '\n')`. Jenže [SerialTransport.ts:121-142](src/transport/SerialTransport.ts:121) emituje **surové dekódované chunky**, které běžně končí uprostřed řádku (USB CDC pakety po 64 B). MockTransport naproti tomu emituje celé řádky bez `\n` — hack je napsaný pro Mock a s reálným micro:bitem rozbije data.
*Konkrétní riziko:* řádek `t:24.5` rozdělený mezi dva chunky se zparsuje jako dvě zprávy `t:2` a `4.5` → do grafu, statistik, CSV i PDF protokolu se zapíší **falešné hodnoty**, náhodně a nereprodukovatelně. Přesně tohle by zablokovalo první test s hardwarem.
*Doporučení:* Transport má emitovat chunky tak, jak přišly (přejmenovat callback na `onChunk`), `LineBuffer` už dělení na řádky umí správně. MockTransport má emitovat řádky **včetně** `\n`. Hack v App.ts odstranit.

**N2 — XSS / injection (OK, jen drobnosti)**
Všechna místa s `innerHTML` jsem prošel: [CalibrationModal.ts](src/ui/CalibrationModal.ts), [RecoveryModal.ts](src/ui/RecoveryModal.ts), [SelectionStats.ts](src/ui/SelectionStats.ts), [ShortcutsHelp.ts](src/ui/ShortcutsHelp.ts), [Toast.ts](src/ui/Toast.ts) — uživatelský vstup (názvy měření, anotace, jména žáků) je důsledně escapovaný nebo jde přes `textContent`. Jediný neescapovaný interpolovaný údaj je `run.color` v inline stylu ([SelectionStats.ts:63](src/ui/SelectionStats.ts:63)) — pochází z hardcoded palety, po obnově z IndexedDB by ho mohl změnit jen sám uživatel na vlastním stroji. Riziko zanedbatelné. CSV pole se escapují jen v anotacích ([csv.ts:102](src/export/csv.ts:102)), názvy runů v hlavičce hlavního CSV ne — název obsahující `;` posune sloupce (ne bezpečnostní, ale korektnostní detail).
*Doporučení:* escapovat i hlavičky v `buildRunsCsv`; sjednotit 4× zduplikovaný `escapeHtml` do jednoho modulu.

**N3 — Secrets a klíče (OK)**
Git historie má 2 commity, žádné `.env`, žádné API klíče (aplikace žádné nepoužívá — vše client-side). `id-token: write` ve workflow je standardní OIDC oprávnění pro Pages deploy. `.gitignore` kryje `.env*`.

**N4 — HTTPS a hlavičky (STŘEDNÍ)**
HTTPS + HSTS zajišťuje GitHub Pages (ověřeno na živé URL). Custom HTTP hlavičky (CSP, X-Content-Type-Options…) na Pages nastavit **nelze**. Chybí ale i `<meta http-equiv="Content-Security-Policy">` v [index.html](index.html).
*Konkrétní riziko:* nízké (žádné externí skripty, žádná user-generated HTML persistence), ale CSP je levná pojistka proti budoucí chybě.
*Doporučení:* přidat meta CSP `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'` (ověřit proti uPlot/jsPDF chování).

**N5 — Zranitelné závislosti (VYSOKÉ — detail v §2.8)** — `npm audit`: 8 zranitelností (1 critical, 2 high, 5 moderate). Jediná **runtime** je `dompurify` (moderate, tranzitivně přes jsPDF, opravitelná `npm audit fix` bez breaking změn); zbytek jsou dev-nástroje (vitest critical, vite high, form-data high, esbuild + js-yaml moderate).
*Konkrétní riziko:* dev server Vite ≤6.4.2 (esbuild advisory) dovoluje **libovolné webové stránce** posílat requesty na běžící `npm run dev` a číst odpovědi — tj. při vývoji s otevřeným dev serverem může cizí web číst zdrojáky. Vitest critical se týká jen `vitest --ui` (nepoužívá se). Produkce ohrožená není.

### 2.2 Výkon

**N6 — jsPDF v hlavním bundlu (STŘEDNÍ)**
Hlavní bundle má **548 kB (183 kB gzip)**, protože [App.ts](src/ui/App.ts) staticky importuje `PdfExportModal` → [pdf.ts:1](src/export/pdf.ts:1) → jsPDF + autotable (~350 kB raw). jsPDF je potřeba až při kliknutí na „PDF".
*Doporučení:* dynamický `import('./export/pdf')` v okamžiku exportu. Initial JS klesne odhadem na ~200 kB raw / ~60 kB gzip. (Vedlejší chunky html2canvas 202 kB / index.es 160 kB / purify 26 kB už jsou lazy — stahují se jen při použití.)

**N7 — Graf se při každém překreslení kompletně zahodí a postaví znovu (STŘEDNÍ)**
[Chart.ts:205](src/ui/Chart.ts:205) `rebuild()` volá `plot.destroy()` + `new uPlot(...)` a [Chart.ts:128](src/ui/Chart.ts:128) to plánuje až 30× za sekundu při streamu dat. Navíc [Chart.ts:142](src/ui/Chart.ts:142) při každém rebuildu staví union všech časových bodů všech viditelných runů (O(n·m) + alokace polí).
*Doporučení:* při appendu bodu volat `uPlot.setData()` (uPlot je na to stavěný, zvládá to v O(1) na frame); plný rebuild nechat jen pro změnu kanálů/runs/theme. Při 50 Hz a více runech je to rozdíl mezi plynulým a trhaným UI na školních strojích.

**N8 — Cachování a assets (OK / drobnosti)**
Service worker: cache-first pro hashované assety, network-first pro shell — správně. Font (145 kB TTF) se stahuje jen pro PDF a je pre-cachovaný pro offline. Obrázky jen ikony (generované ze SVG, přiměřené velikosti). Sourcemapy (~3 MB) se publikují na Pages — pro open-source OK, jen vědomě. Žádné zbytečné requesty za běhu (žádná analytika, žádné CDN).

### 2.3 Kvalita kódu a architektura

**N9 — Mrtvý kód: celé API pro řízení firmware se nepoužívá (VYSOKÉ ve spojení s N10)**
`Commands.rehello()`, `Commands.rate()`, `Commands.selectSensor()` ([Commands.ts:17-44](src/protocol/Commands.ts:17)) a `settings.onSamplingChange` ([Settings.ts:52](src/state/Settings.ts:52)) nemají v celém `src/` jediného konzumenta.

**N10 — Nastavení vzorkovací frekvence nic nedělá (VYSOKÉ)**
Uživatel v Nastavení zvolí 1–50 Hz, hodnota se uloží, ale **nikdy se neodešle** `#RATE` do micro:bitu (ani při připojení, ani při změně). Firmware tak vždy streamuje default 10 Hz a `Run.samplingHz` zaznamenává nastavení, ne realitu.
*Konkrétní riziko:* učitel nastaví 50 Hz na rychlý děj (pružina, ráz), dostane 10 Hz data a měření je k ničemu — a vypadá to jako vada senzoru.
*Doporučení:* po `#READY` poslat `Commands.rate(settings.samplingHz)`; na `onSamplingChange` poslat nový rate za běhu.

**N11 — Přepnutí senzoru jde jen fyzickým tlačítkem B (STŘEDNÍ)**
Protokol i firmware umí `#SELECT;<sensor>`, ale UI nemá žádný ovládací prvek (v původním plánu „sensor dropdown placeholder", nikdy nedodělané). Bez hardwaru u sebe je to jediná cesta, jak senzor přepnout.
*Doporučení:* dropdown/menu v top baru volající `Commands.selectSensor()`.

**N12 — Duplicity (STŘEDNÍ)**
- `escapeHtml` 4× ([SelectionStats.ts:127](src/ui/SelectionStats.ts:127), [RecoveryModal.ts:100](src/ui/RecoveryModal.ts:100), [ShortcutsHelp.ts:79](src/ui/ShortcutsHelp.ts:79), [CalibrationModal.ts:348](src/ui/CalibrationModal.ts:348))
- `required()` DOM helper 7×
- výpočet statistik 2× ([SelectionStats.ts:98](src/ui/SelectionStats.ts:98) `computeStats` vs. [pdf.ts:240](src/export/pdf.ts:240) `quickStats`) a potřetí **reimplementovaný v testu** (viz N20)
- vzor „viditelné runy + aktivní" 4× (App, Chart, SelectionStats, PdfExportModal)
- paleta barev runů 2×: hardcoded `RUN_COLORS` ([AppState.ts:74](src/state/AppState.ts:74)) vs. nepoužívané CSS proměnné `--chart-series-1..6` v obou theme souborech
*Doporučení:* modul `src/utils/` (escapeHtml, required, stats) + jediný zdroj palety.

**N13 — Nekonzistentní dialogy (NÍZKÉ)**
Vlastní modálový systém + toasty existují, ale anotace používá `window.prompt` ([App.ts:79](src/ui/App.ts:79)), mazání `confirm`, reset `confirm`+`alert`, chyba PDF `alert`. Funguje to, ale blokuje to UI vlákno a vizuálně to vybočuje.

**N14 — Typování (OK)** — strict mode, žádné `any` v src, vlastní minimální typy pro Web Serial ([WebSerial.d.ts](src/transport/WebSerial.d.ts)). Soubory rozumně velké (nejvíc App.ts 463 řádků). ESLint má ale **1 error**: neviditelný BOM znak v komentáři [csv.ts:22](src/export/csv.ts:22) (`no-irregular-whitespace`) → `npm run lint` je červený; CI lint nespouští, takže to nikoho nezastaví (mezera v CI).

### 2.4 Error handling

**N15 — Auto-save během nahrávání nic neukládá (VYSOKÉ)**
[AutoSave.ts:25-28](src/state/AutoSave.ts:25) záměrně ignoruje `data-point` událost a dirty flag se nastaví jen při start/stop/save. Průběh: START → `active-run-changed` → za ≤5 s se uloží snapshot s pár vzorky → `dirty=false` → **dalších N minut záznamu se nikdy neuloží**, dokud uživatel nezmáčkne STOP.
*Konkrétní riziko:* pád prohlížeče / vytržený kabel / omylem zavřený tab v 10. minutě měření → recovery dialog nabídne session, ve které je z celého měření ~5 s dat. Přesně scénář, proti kterému má recovery chránit.
*Doporučení:* v `data-point` handleru nastavovat `this.dirty = true` (je to jen bool; reálný zápis stále 1× za 5 s).

**N16 — Selhání zápisu na port se zahodí (STŘEDNÍ)**
[App.ts:399-402](src/ui/App.ts:399) `void this.transport.send(cmd)` — když `writer.write()` rejectne (zařízení odpojené mezi eventy), vznikne unhandled rejection, uživatel nic nevidí a disconnect flow se nespustí.
*Doporučení:* `.catch()` → zavolat disconnect cleanup + toast.

**N17 — Po „Smazat všechna data" zůstane auto-save vypnutý (STŘEDNÍ)**
[App.ts:235-250](src/ui/App.ts:235) `resetAllData()` volá `autoSave.stop()`, ale po vyčištění už nikdy `start()`. Do reloadu stránky se nic neukládá.

**N18 — Selhání IndexedDB je jen v konzoli (NÍZKÉ)**
[Storage.ts](src/state/Storage.ts) všechna selhání loguje a mlčí. Plné úložiště / private mode → uživatel si myslí, že se ukládá. Toast systém na to existuje, jen není napojený. Jinak je error handling slušný: výpadek spojení → toast + status, neznámé řádky → warn, NaN hodnoty se filtrují, timeout kalibrace ošetřený, nepodporovaný prohlížeč → banner + disabled tlačítka, offline → PWA funguje.

**N19 — Drobnosti stavového stroje (NÍZKÉ)**
`App.connect()` nečeká na dokončení `disconnect()` starého transportu ([App.ts:356](src/ui/App.ts:356)) — starý `onDisconnect` handler může teoreticky přepsat status `connecting` na `disconnected` (race, prakticky vzácné). `hydrateRuns` nastaví `_runCounter = runs.length` — po smazání/přejmenování runů může nové „Měření N" kolidovat jménem. Status `calibrating` a event `error` v AppState nejsou nikdy použité.

### 2.5 Přístupnost (a11y)

Solidní základ: nativní `<dialog>` (focus trap zdarma), `aria-label` na ikonových tlačítkách, `aria-live="polite"` na velké hodnotě i toastech, `aria-pressed` na autoscale, `:focus-visible` styly, `prefers-reduced-motion` respektováno, jazyk dokumentu se přepíná. Nálezy:

**N20 — Anotace nejde přidat bez myši (STŘEDNÍ)** — jediná cesta je „podrž A + klikni do grafu". Klávesová alternativa neexistuje.
**N21 — Barvy runů v tmavém režimu (STŘEDNÍ)** — `RUN_COLORS` jsou tmavé odstíny pro světlé pozadí (`#1B5E20`, `#C62828`…); v dark mode na `#161c17` mají kontrast ~2:1. Theme na to má připravené světlé `--chart-series-*` proměnné, které se nepoužívají (viz N12).
**N22 — Rozlišení runů jen barvou (NÍZKÉ)** — aktivní run je plnou čarou, uložené čárkovaně (dobré), ale mezi sebou se uložené runy liší jen barvou; legenda jména obsahuje, takže OK, jen pro tisk/černobílou kopii zvážit odlišné dash patterny.
**N23 — Kontrast textů (OK)** — `--fg-muted` 4,6:1 (light) / 7:1 (dark), hlavní texty >12:1.

### 2.6 SEO

Aplikace (ne obsahový web) — nároky nízké. Existuje `<title>`, `meta description`, `theme-color`, manifest. Chybí: Open Graph / twitter karty (sdílení do školních systémů/soc. sítí ukáže holý odkaz), `robots.txt`, `sitemap.xml`, kanonická URL. `lang="cs"` je v HTML staticky a mění se až za běhu — pro crawler je EN verze neviditelná (nevadí, obsah je aplikace). **Vše NÍZKÁ priorita**; doporučuji jen OG tagy + robots.txt (5 minut práce).

### 2.7 Testy

**N24 — Testy lokálně padají: 8/49 (VYSOKÉ jako signál, příčina prostředí)**
`npm test` na tomto stroji: `csv.test.ts` celý padá na `localStorage` = `undefined` — lokální **Node v26.3.0** není kompatibilní s jsdom 25 (deklarovaná podpora končí dřív). CI běží Node 22 a poslední run prošel (deploy 3. 6. proběhl).
*Konkrétní riziko:* lokální guardrail nefunguje; při příštím bumpu Node v CI (GitHub od 09/2026 vynucuje Node 24 pro actions) se to může rozbít i tam a **zablokovat deploy** (test step je před buildem).
*Doporučení:* bump `jsdom` na ^29 (podporuje aktuální Node) + `"engines": { "node": ">=22" }` do package.json.

**N25 — Kvalita pokrytí (STŘEDNÍ)**
Pokryté: parser (26), commands (9), CSV (8), statistická matematika (6). Nepokryté: `AppState` (run lifecycle), `AutoSave` (tam je bug N15!), `Storage` round-trip, `LineBuffer` + transport framing (tam je bug N1!), i18n. Test [stats.test.ts:3-7](tests/stats.test.ts:3) si **reimplementuje produkční funkci** a sám v komentáři přiznává, že drift = bug — tj. netestuje produkční kód. Struktura kódu je přitom na testování připravená (čisté funkce, DI v modálech) — přidávání testů je snadné.
*(Pozn.: dle zadání se nové testy během dokončování psát nebudou — viz PLAN.md, testovací fáze přijde po dokončení.)*

### 2.8 Závislosti

**N26 — Zranitelnosti (`npm audit`: 1 critical / 2 high / 5 moderate)** — viz N5. Rozpad:

| Balíček | Severity | Kde | Fix |
|---|---|---|---|
| vitest ≤3.2.5 | **critical** | dev | major bump (vitest 4) — critical se týká `--ui` serveru |
| vite ≤6.4.2 | high | dev | major bump (vite 7/8) |
| form-data | high | dev (jsdom) | `npm audit fix` |
| dompurify ≤3.4.10 | moderate | **runtime** (jspdf) | `npm audit fix` |
| esbuild, js-yaml, vite-node, @vitest/mocker | moderate | dev | s výše uvedenými |

**N27 — Nepoužívané závislosti (NÍZKÉ)** — `@fontsource/roboto` je v `dependencies`, ale nikde se neimportuje (font se servíruje ručně z `public/fonts/`). Vyhodit. `sharp` v devDependencies je OK (používá ho `scripts/make-icons.mjs`).

**N28 — Zastaralé (NÍZKÉ)** — větší skoky: vite 6→8, vitest 2→4, eslint 9→10, jsdom 25→29, TS 5.9→6. Nic z toho nehoří kromě jsdom (N24); bump udělat v jedné údržbové dávce.

### 2.9 Responzivita a kompatibilita

**N29 — Pod ~900 px je layout nepoužitelný (STŘEDNÍ)**
[main.css:133-146](src/styles/main.css:133) má grid `240px 1fr 260px`, jediný breakpoint 1100 px jen zúží sloupce na `200px 1fr 220px`. Na tabletu/mobilu se prostřední sloupec s grafem zmenší na pár desítek pixelů. Web Serial na mobilech stejně není (Android Chrome ho nemá), ale PWA manifest instalaci na mobil aktivně nabízí a prohlížení uložených dat / demo režim by na tabletu dávaly smysl (interaktivní tabule, žákovské tablety).
*Doporučení:* breakpoint ~900 px: sloupce pod sebe (panely stackovat), graf min. 300 px výšky.

**N30 — Prohlížeče (OK, záměrně omezené)** — plná funkce Chrome/Edge (Web Serial), ostatní: banner + Mock demo funguje. `<dialog>` fallback pro staré prohlížeče existuje ([ConnectionModal.ts:57](src/ui/ConnectionModal.ts:57)), byť bez fokus trapu — zanedbatelné.

**N31 — Hardcoded base path `/fyzbit/` (NÍZKÉ, budoucí)** — [vite.config.ts:12](vite.config.ts:12) a [manifest.json:6](public/manifest.json:6) natvrdo. Při plánovaném přesunu na `fyzbit.cz` (root) je nutné změnit obojí + otestovat SW cache přechod.

### 2.10 Data a soukromí

**Velmi dobrý stav — vše zůstává v zařízení.** Žádná analytika, žádné třetí strany, žádné externí requesty za běhu (fonty self-hosted, ověřeno v kódu i síťově). Ukládá se:

| Co | Kde | Poznámka |
|---|---|---|
| Naměřené runy + anotace | IndexedDB (`fyzbit.session`) | auto-save, recovery |
| **Jména žáků, třída, název pokusu** | `localStorage` (`fyzbit.studentInfo`) | předvyplnění PDF |
| Jazyk, motiv, frekvence | `localStorage` | |

**N32 — Osobní údaje žáků (STŘEDNÍ, spíš formální)** — jména žáků (osobní údaje nezletilých) se persistují v `localStorage` sdíleného školního počítače a „Smazat všechna data" je smaže korektně (`localStorage.clear()` + IndexedDB clear). Riziko: další třída u stejného PC uvidí předvyplněná jména předchozí třídy v PDF dialogu.
*Doporučení:* (a) věta v README/O aplikaci „všechna data zůstávají v tomto počítači, nic se neodesílá" — pro školy silný argument, zaslouží si být vidět; (b) zvážit checkbox „nepamatovat si jména" nebo mazání jmen (ne třídy/pokusu) při zavření.

**N33 — PDF stopa (NÍZKÉ)** — patička PDF uvádí `fyzbit.cz` ([pdf.ts:233](src/export/pdf.ts:233)), doména zatím neběží — v protokolech pro rodiče/inspekci bude mrtvý odkaz. Změnit na GitHub Pages URL, dokud doména nežije.

---

## 3. Prioritizace

### 🔴 Kritické
| # | Nález | Konkrétní riziko |
|---|---|---|
| N1 | Sériové chunky se lámou uměle vloženými `\n` | Falešné naměřené hodnoty v grafu/CSV/PDF s reálným HW; znehodnocené měření, nedeterministické. Blokuje jakýkoli smysluplný HW test. |

### 🟠 Vysoké
| # | Nález | Konkrétní riziko |
|---|---|---|
| N10 (+N9) | `#RATE` se nikdy neodešle; nastavení Hz je atrapa | Měření rychlých dějů proběhne v 10 Hz místo 50 Hz → nepoužitelná data, vypadá jako vada čidla |
| N15 | Auto-save neukládá běžící záznam | Pád/odpojení během měření → ztráta celého záznamu kromě prvních ~5 s; recovery slibuje a nedodá |
| N26 | vitest critical / vite high / dompurify runtime | Otevřený dev server čitelný cizím webem; runtime XSS vektor v PDF knihovně (byť nevyužívaná cesta) |
| N24 | Testy červené na Node 26 (jsdom 25) | Lokální kontrola mrtvá; po vynuceném bumpu Node v CI spadne deploy pipeline |

### 🟡 Střední
N6 (jsPDF v initial bundlu), N7 (rebuild grafu na každý frame), N11 (přepínání senzoru jen tlačítkem B), N12 (duplicity), N16 (ztracené chyby `send()`), N17 (auto-save po resetu), N4 (chybí CSP), N20 (anotace bez myši), N21 (barvy runů v dark mode), N25 (mezery pokrytí testů — odloženo po dokončení), N29 (responzivita <900 px), N32 (jména žáků na sdíleném PC), N14 (lint červený + CI lint nespouští)

### 🟢 Nízké
N2 (CSV hlavičky escape), N8 (sourcemapy veřejné — vědomě), N13 (prompt/confirm/alert), N18 (tiché selhání IndexedDB), N19 (drobné race/stavy), N22 (dash patterny), SEO (OG/robots/sitemap), N27 (`@fontsource/roboto`), N28 (starší dev deps), N31 (hardcoded `/fyzbit/`), N33 (fyzbit.cz v PDF), firmware drobnost: `serial.readString()` + split může rozlomit příchozí příkaz (použít `readUntil`)

---

## 4. Plán vylepšení

*(S ≤ 1 h, M = půl dne, L = 1+ den. Kroky 1–6 jsou „rychlé opravy", 7–12 střednědobé, 13–15 dlouhodobé. Firmware/Bluetooth dokončení řeší samostatný [PLAN.md](PLAN.md).)*

**Rychlé opravy (do 1 h každá)**
1. **N1 — oprava serial framingu** (S) — odstranit `+'\n'` hack, Mock emituje `\n`, kontrakt = chunky. *Důvod: jediná kritická chyba; bez ní je HW provoz loterie.*
2. **N15 — dirty flag na `data-point`** (S) — jednořádková změna. *Důvod: recovery jinak nechrání to jediné, co chránit má.*
3. **N10 — poslat `#RATE` po `#READY` a při změně nastavení** (S). *Důvod: zviditelnit existující funkci, odstranit atrapu.*
4. **`npm audit fix`** (S) — opraví dompurify + form-data + js-yaml bez breaking změn. *Důvod: runtime zranitelnost pryč za minutu.*
5. **N14 — smazat BOM z komentáře csv.ts:22 + přidat `npm run lint` do CI** (S). *Důvod: zelený lint, díra v CI.*
6. **N17 + N16 — restart auto-save po resetu; `.catch` na send()** (S). *Důvod: dva tiché ztrátové stavy.*

**Střednědobé (M)**
7. **N6 — lazy-load jsPDF** (S/M) — dynamic import v místě exportu. *Důvod: −65 % initial JS, školní počítače a pomalé wifi.*
8. **N11 — dropdown senzoru v top baru** (M) — využije mrtvý `Commands.selectSensor`. *Důvod: bez HW tlačítka B nejde senzor přepnout; učitel nemá sahat na desku na katedře.*
9. **N7 — inkrementální `setData()` místo rebuildů** (M). *Důvod: plynulost při 25–50 Hz a víc runech.*
10. **N21 + N12 (paleta) — barvy runů z CSS proměnných dle theme** (M). *Důvod: čitelnost v dark mode, jeden zdroj pravdy.*
11. **N24 — bump jsdom ^29 + `engines` pole** (S/M). *Důvod: funkční testy na moderním Node, pojistka proti CI bumpu.*
12. **N29 — responsive breakpoint <900 px** (M). *Důvod: tablety/interaktivní tabule, prohlížení dat na mobilu.*

**Dlouhodobé / refaktoring (L)**
13. **Dev-deps major bumpy** (M/L) — vite 8, vitest 4, eslint 10 v jedné dávce (zavře zbytek auditu). *Důvod: critical/high advisories v dev řetězci, budoucí udržovatelnost.*
14. **Konsolidace duplicit + jednotné dialogy** (M/L) — `src/utils/`, náhrada prompt/confirm/alert vlastními modály (N12, N13, N2). *Důvod: konzistence, snadnější rozšiřování, odblokuje i N20 (anotační dialog s klávesovou cestou).*
15. **Testovací fáze po dokončení projektu** (L) — pokrýt AutoSave, LineBuffer/transport framing, AppState lifecycle, Storage round-trip; přepsat stats test na produkční funkci; zvážit Playwright smoke test s MockTransport. *Důvod: přesně v netestovaných místech seděly N1 a N15; před ostrým nasazením do škol je to nutná pojistka.*

---

## 5. Otevřené otázky (z kódu neověřitelné)

1. **Reálný HW nikdy neproběhl** — celý řetězec firmware ↔ SerialTransport ↔ parser je ověřený jen Mockem a unit testy. Fyzický test je vědomě odložen (viz PLAN.md, fáze „Po dokončení").
2. **MakeCode závislosti firmwaru** — `pxt.json` pinuje `microbit-dstemp#v0.1.26`, `pxt-myhx711#v1.0.18`, `pxt-DHT11_DHT22#v0.0.3` z GitHubu třetích stran. Zda se dnes stále resolvují a kompilují, ověří až automatizovaný build (PLAN.md fáze 1).
3. **Doména fyzbit.cz** — vlastnictví/timeline neznámé; ovlivňuje N31 a N33.
4. **Kalibrační faktor „>10× default" warning** ([CalibrationModal.ts:29-32](src/ui/CalibrationModal.ts:29)) porovnává s 1.0, ale reálné defaulty jsou −10578 (síla) a 581.84 (tlak) — heuristika bude s reálným HW pravděpodobně varovat vždy/nikdy. Ověřit až s daty z fyzického testu.
5. **Chování `serial.setRxBufferSize(64)`** ve firmware při delších příkazech (`#CAL;F;123.456789`) — teoreticky OK, prakticky ověří HW test.
