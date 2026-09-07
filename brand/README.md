# Zdrojové obrázky značky

Sem patří dva soubory, ze kterých `npm run icons` generuje všechno ostatní:

| soubor | co to je | kam se z něj generuje |
| --- | --- | --- |
| `icon-source.png` | zjednodušená značka (bez koleček, svorka jako hrot) | favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png |
| `logo-source.png` | plné logo (s kolečky a detailní svorkou) | public/logo.png — logo v topbaru a v hlavičce návodu |

Obojí čtvercové PNG, ideálně 1024×1024, plnobarevné pozadí až k okrajům.

Tahle složka se **nedistribuuje** — Vite kopíruje na web jen `public/`.
Zdroje zůstávají v repu, aby šlo sadu kdykoli přegenerovat.
