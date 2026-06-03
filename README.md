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

## Vývoj

```bash
npm install
npm run dev       # vývojový server na http://localhost:5173
npm run build     # produkční build do docs/ (GitHub Pages)
npm run test      # unit testy (Vitest)
npm run lint      # ESLint
npm run format    # Prettier
```

## Hosting

Produkční verze běží na [bekousek.github.io/fyzbit](https://bekousek.github.io/fyzbit/) (později [fyzbit.cz](https://fyzbit.cz)). Build je v adresáři `docs/`, který slouží jako root GitHub Pages.

Deploy probíhá automaticky přes GitHub Actions (workflow `.github/workflows/deploy.yml`) při každém pushi do `main`. Workflow nainstaluje deps, projde TS check + testy, vytvoří build a nahraje ho na GitHub Pages.

Pro první deploy: v Settings → Pages na GitHubu nastav source na **GitHub Actions** (ne na branch).

## Pro pokročilé

Pro vlastní MakeCode programy použij rozšíření [`fyzikalni_senzory`](https://github.com/bekousek/fyzikalni_senzory).

## Licence

MIT © Ondřej Bek
