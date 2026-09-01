# FyzBit firmware V2 (Bluetooth)

Tento MakeCode projekt je stejný **firmware pro micro:bit** jako [`fyzbit-v1`](../fyzbit-v1/), rozšířený o Bluetooth (Nordic UART Service) — každý řádek protokolu jde současně přes USB i BLE a příkazy se přijímají z obou. **Do distribuovaného `.hex` jde jen jako V2 obraz** — projekt sice po nastavení „No Pairing Required" (viz níže) projde kompilací i pro V1, ale V1 má jen 16 kB RAM a běh senzorových driverů společně s celým Bluetooth stackem na tom nebyl ověřen za provozu, takže to zatím nenabízíme jako podporovanou variantu.

> Toto **není** rozšíření pro vlastní programy v MakeCode — to je projekt [`fyzikalni_senzory`](https://github.com/bekousek/fyzikalni_senzory).
> Tady je *kompletní firmware*, který nahraješ na micro:bit V2 a pak ho jen připojíš k FyzBit aplikaci — kabelem, nebo přes Bluetooth.

## Jak získat `.hex`

**Nejjednodušší cesta:** stáhni hotový `.hex` přímo z [aplikace FyzBit](https://bekousek.github.io/fyzbit/) — v dialogu „Připojit micro:bit" je odkaz „↓ Stáhnout firmware (.hex)". Není co vybírat: [`public/firmware/fyzbit.hex`](../../../public/firmware/fyzbit.hex) je *universal hex*, jehož V2 obraz je právě tento projekt (V1 obraz je [`fyzbit-v1`](../fyzbit-v1/), tedy bez Bluetooth). Bootloader V2 desky si vezme tenhle, V1 deska ten druhý.

### Postavit `.hex` sám

```bash
npm run firmware   # v kořeni repa; sestaví oba projekty a spojí je do jednoho hexu
```

### Alternativa: MakeCode ve webu

Stejný postup jako u [`fyzbit-v1`](../fyzbit-v1/README.md), navíc přidej závislost `bluetooth` (Extensions → bluetooth). V Project Settings nastav „No Pairing Required" (odpovídá `yotta.config.microbit-dal.bluetooth.open/whitelist/security_level` v `pxt.json` tohoto projektu — bez toho V1 build selže na nedostatek flash, protože se zbytečně přidá kód pro šifrované párování). Vyber a nahraj cílové zařízení **V2**.

## Bluetooth párování

Firmware běží v režimu **bez párování** (open link) — aplikace se připojí přímo přes prohlížečový výběr zařízení, žádný PIN. Micro:bit při připojení bliknutím zobrazí ✓, při odpojení ✗.

## Co firmware umí

Stejné senzory a protokol jako `fyzbit-v1` (viz jeho [README](../fyzbit-v1/README.md)) — jediný rozdíl je transport (USB *i* Bluetooth současně).

## Licence

MIT, viz hlavní [LICENSE](../../../LICENSE) v repu.
