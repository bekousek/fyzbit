# FyzBit

> **Fyzika na micro:bitu** — webový datalogger pro fyzikální měření na ZŠ/SŠ.

FyzBit je webová aplikace, ve které učitel nebo žák připojí micro:bit s fyzikálním senzorem (kabelem nebo Bluetooth) a měří v reálném čase teplotu, sílu, vzdálenost, tlak nebo vlhkost. Žádné MakeCode, žádné programování, žádná instalace.

## Funkce

- 🔌 Připojení micro:bitu přes USB (Web Serial) nebo Bluetooth (V2)
- ⚡ Automatická detekce senzoru
- 📈 Graf v reálném čase
- 📥 Export do CSV (pro Excel) a PDF (protokol pro hodinu)
- 🌓 Světlý / tmavý motiv
- 🇨🇿 / 🇬🇧 Čeština a angličtina
- 📲 PWA — funguje offline

## Soukromí

Všechna data (naměřené hodnoty, jména žáků, nastavení) zůstávají uložená v tomto počítači/prohlížeči. Aplikace neodesílá nic na žádný server — žádná analytika, žádné externí požadavky za běhu.

## Vývoj

```bash
npm install
npm run dev       # vývojový server na http://localhost:5173
npm run build     # produkční build do docs/ (GitHub Pages)
npm run test      # unit testy (Vitest)
npm run lint      # ESLint
npm run format    # Prettier
```

## Firmware

Micro:bit potřebuje nahraný firmware FyzBit, aby s aplikací uměl mluvit. Distribuuje se **jediný soubor** `public/firmware/fyzbit.hex` — je to *universal hex*, tedy dva obrazy desky v jednom souboru, ze kterých si bootloader micro:bitu vezme jen ten svůj:

| slice | zdroj | co umí |
| --- | --- | --- |
| V1 (`0x9900`) | [`fyzbit-v1`](firmware/source/fyzbit-v1) | USB |
| V2 (`0x9903`) | [`fyzbit-ble`](firmware/source/fyzbit-ble) | USB *i* Bluetooth (Nordic UART) |

Uživatel tedy nic nevybírá — nahraje jeden firmware a Bluetooth se sám objeví jen tam, kde na něj deska má (V1 má 16 kB RAM a celý BLE stack se senzorovými drivery se do ní nevejde; není to volba firmwaru, ale limit hardwaru).

**Nejjednodušší cesta pro učitele/žáky:** v aplikaci → dialog „Připojit micro:bit" → krok 1 „⚡ Připravit micro:bit" nahraje firmware přímo přes WebUSB (Chrome/Edge), bez otevírání MakeCode. Kdo WebUSB nemá, stáhne `.hex` stejným dialogem a přetáhne ho ručně na disk `MICROBIT`.

Hex soubory se staví přes [MakeCode CLI](https://github.com/microsoft/pxt-mkc) (balíček `makecode`, ne ruční export z makecode.microbit.org):

```bash
npm run firmware   # sestaví oba projekty a spojí je do public/firmware/fyzbit.hex
```

Detaily zapojení senzorů, protokolu a Bluetooth (No Pairing Required) jsou v READMEs jednotlivých firmware projektů.

## Licence obrázků

Kresba micro:bitu (`public/img/microbit-board.svg`) je oříznutá a odlehčená verze
[oficiální kresby](https://github.com/microbit-foundation/microbit-svg) Micro:bit
Educational Foundation. **Není** pod MIT licencí zbytku projektu — platí pro ni
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), tedy
uvedení autora, nekomerční užití a sdílení pod stejnou licencí. Atribuce je
vidět přímo v aplikaci pod schématem zapojení a v hlavičce samotného souboru.

## Hosting

Produkční verze běží na [bekousek.github.io/fyzbit](https://bekousek.github.io/fyzbit/) (později [fyzbit.cz](https://fyzbit.cz)). Build je v adresáři `docs/`, který slouží jako root GitHub Pages.

Deploy probíhá automaticky přes GitHub Actions (workflow `.github/workflows/deploy.yml`) při každém pushi do `main`. Workflow nainstaluje deps, projde TS check + testy, vytvoří build a nahraje ho na GitHub Pages.

Pro první deploy: v Settings → Pages na GitHubu nastav source na **GitHub Actions** (ne na branch).

## Pro pokročilé

Pro vlastní MakeCode programy použij rozšíření [`fyzikalni_senzory`](https://github.com/bekousek/fyzikalni_senzory).

## Licence

MIT © Ondřej Bek
