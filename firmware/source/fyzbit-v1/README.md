# FyzBit firmware V1

Tento MakeCode projekt je **firmware pro micro:bit**, který se domlouvá s [webovou aplikací FyzBit](https://bekousek.github.io/fyzbit/) přes sériovou linku (USB) jazykem FyzBit protokolu.

> Toto **není** rozšíření pro vlastní programy v MakeCode — to je projekt [`fyzikalni_senzory`](https://github.com/bekousek/fyzikalni_senzory).
> Tady je *kompletní firmware*, který nahraješ na micro:bit a pak ho jen připojíš k FyzBit aplikaci.

## Jak získat `.hex`

**Nejjednodušší cesta:** stáhni hotový `.hex` přímo z [aplikace FyzBit](https://bekousek.github.io/fyzbit/) — v dialogu „Připojit micro:bit" je odkaz „↓ Stáhnout firmware (.hex)". Přetáhni stažený soubor na disk `MICROBIT` (zapojený přes USB); LED matrice na chvilku rozsvítí během nahrávání, pak se firmware spustí. Soubor je i přímo v tomto repu: [`public/firmware/fyzbit.hex`](../../../public/firmware/fyzbit.hex).

Ten soubor je *universal hex*: obsahuje tenhle projekt jako V1 obraz a [`fyzbit-ble`](../fyzbit-ble/) jako V2 obraz. Na V1 desce se tedy nahraje to, co je v této složce; na V2 desce verze s Bluetooth.

### Postavit `.hex` sám

Přes [MakeCode CLI](https://github.com/microsoft/pxt-mkc) (`makecode`/`mkc`), bez otevírání prohlížeče:

```bash
npm run firmware   # v kořeni repa; spustí scripts/build-firmware.mjs
```

Skript sestaví oba projekty a spojí jejich obrazy do `public/firmware/fyzbit.hex`. Vyžaduje síť (mkc si při prvním běhu stáhne toolchain z makecode.microbit.org a GitHub závislosti driverů).

### Alternativa: MakeCode ve webu

1. Otevři [makecode.microbit.org](https://makecode.microbit.org/).
2. **Import → Import File…** a vyber soubor `main.ts` z této složky.
   - Alternativně: **Import → Import URL** a vlož GitHub URL adresáře `firmware/source/fyzbit-v1`.
3. V Settings (ozubené kolo) → Project Settings se ujisti, že jsou tyto závislosti:
   - `microbit-dstemp` (verze v0.1.26)
   - `pxt-myhx711` (verze v1.0.18)
   - `pxt-DHT11_DHT22` (verze v0.0.3)
   Pokud chybí: `Extensions` → najdi a přidej.
4. Klikni **Download**. MakeCode vyrobí `microbit-fyzbit-v1.hex`.
5. Přetáhni `.hex` na disk `MICROBIT`.

## Co firmware umí

| Senzor | Kanál | Výchozí piny |
|---|---|---|
| DS18B20 (teploměr) | `t` °C | P0 (data) |
| HX711 (siloměr) | `F` N | P15 DT / P16 SCK |
| HC-SR04 (sonar) | `d` cm + `v` m/s | P1 Trig / P2 Echo |
| HX710B (tlakoměr) | `p` Pa | P0 DT / P1 SCK |
| DHT11 | `t` °C + `h` % | P0 (data) |

**Po startu** firmware odešle handshake (`#HELLO;v1;board=V1` nebo `V2`, `#CH;…`, `#READY`) a začne streamovat data zvoleného senzoru s frekvencí 10 Hz.

**Tlačítka:**
- `A` = vynulování (tára) — užitečné pro siloměr/tlakoměr.
- `B` = přepnutí na další senzor (cyklicky). Na LED matrici problikne první písmeno názvu.
- `A + B` = znovuposlat handshake (pro aplikaci to vypadá jako nové připojení).

## Změna pinů

V `main.ts` najdi `DigitalPin.P…` a uprav podle svého zapojení. Pak znovu Download.

## Licence

MIT, viz hlavní [LICENSE](../../../LICENSE) v repu.
