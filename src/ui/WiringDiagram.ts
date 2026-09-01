import type { SensorName } from '../protocol/Commands';
import { onLanguageChange, t } from '../i18n/i18n';
import { escapeHtml, required } from '../utils/dom';

/** Edge-connector pads FyzBit ever wires to. The five big ones are always drawn. */
const BIG_PADS = ['P0', 'P1', 'P2', '3V', 'GND'] as const;
const PAD_LABEL: Record<string, string> = {
  P0: '0',
  P1: '1',
  P2: '2',
  '3V': '3V',
  GND: 'GND',
  P15: 'P15',
  P16: 'P16',
};

type WireRole = 'power' | 'ground' | 'signal';

type Wire = {
  /** micro:bit pad this wire leaves from. */
  pad: string;
  /** What the sensor board prints next to the hole it goes into. */
  terminal: string;
  role: WireRole;
};

type SensorWiring = {
  nameKey: string;
  /** Terminals in the order they sit on the physical module, left to right. */
  wires: Wire[];
  /** i18n keys for caveats worth printing under the drawing. */
  noteKeys: string[];
};

/**
 * Pin assignment mirrors the firmware (see the two projects under
 * firmware/source) — terminal names are the module's own silkscreen, not our
 * invention, so a pupil can match them against the board in front of them.
 */
const SENSOR_WIRING: Record<SensorName, SensorWiring> = {
  DS18B20: {
    nameKey: 'sensor.ds18b20',
    wires: [
      { pad: '3V', terminal: 'VCC', role: 'power' },
      { pad: 'P0', terminal: 'DATA', role: 'signal' },
      { pad: 'GND', terminal: 'GND', role: 'ground' },
    ],
    noteKeys: ['wiring.noteDs18b20'],
  },
  HX711: {
    nameKey: 'sensor.hx711',
    wires: [
      { pad: 'GND', terminal: 'GND', role: 'ground' },
      { pad: 'P15', terminal: 'DT', role: 'signal' },
      { pad: 'P16', terminal: 'SCK', role: 'signal' },
      { pad: '3V', terminal: 'VCC', role: 'power' },
    ],
    noteKeys: ['wiring.noteSmallPins', 'wiring.noteHx711'],
  },
  HCSR04: {
    nameKey: 'sensor.hcsr04',
    wires: [
      { pad: '3V', terminal: 'VCC', role: 'power' },
      { pad: 'P1', terminal: 'Trig', role: 'signal' },
      { pad: 'P2', terminal: 'Echo', role: 'signal' },
      { pad: 'GND', terminal: 'GND', role: 'ground' },
    ],
    noteKeys: ['wiring.noteHcsr04'],
  },
  HX710B: {
    nameKey: 'sensor.hx710b',
    wires: [
      { pad: '3V', terminal: 'VCC', role: 'power' },
      { pad: 'P0', terminal: 'OUT', role: 'signal' },
      { pad: 'P1', terminal: 'SCK', role: 'signal' },
      { pad: 'GND', terminal: 'GND', role: 'ground' },
    ],
    noteKeys: ['wiring.noteHx710b'],
  },
  DHT11: {
    nameKey: 'sensor.dht11',
    wires: [
      { pad: '3V', terminal: 'VCC', role: 'power' },
      { pad: 'P0', terminal: 'DATA', role: 'signal' },
      { pad: 'GND', terminal: 'GND', role: 'ground' },
    ],
    noteKeys: ['wiring.noteDht11'],
  },
};

/** Jumper-wire colors, in the convention pupils meet on every breadboard photo. */
const POWER_COLOR = '#e53935';
const GROUND_COLOR = 'var(--fg-muted)';
const SIGNAL_COLORS = ['#1e88e5', '#fb8c00', '#8e24aa'];

// ── Drawing geometry (SVG user units; the viewBox is deliberately narrow so
//    that 9–11 unit type stays legible once scaled into a 260 px panel) ──
const W = 220;
const BOARD_TOP = 4;
const BOARD_BOTTOM = 64;
const STRIP_TOP = 52;
const PAD_LABEL_Y = 47;
const BUS_TOP = 78;
const BUS_GAP = 12;
const SENSOR_GAP = 16;
const SENSOR_H = 48;

/**
 * Wiring schematic in the left panel — swaps per selected sensor (see
 * SensorSelect).
 *
 * Read top to bottom: the micro:bit and its edge connector, then one wire per
 * connection dropping into the sensor's own terminals. Plain SVG (no bitmap)
 * so it stays crisp at any size and follows the CSS theme via var(--fg) etc.
 */
export class WiringDiagram {
  private host: HTMLElement;
  private current: SensorName = 'DS18B20';

  constructor(root: HTMLElement) {
    this.host = required('#wiring-diagram', root);
    onLanguageChange(() => this.render());
    this.render();
  }

  setSensor(name: SensorName): void {
    if (this.current === name) return;
    this.current = name;
    this.render();
  }

  private render(): void {
    const wiring = SENSOR_WIRING[this.current];
    const sensorLabel = t(wiring.nameKey);

    // Pads: the five big ones, plus any small pin this sensor needs.
    const extraPads = wiring.wires
      .map((w) => w.pad)
      .filter((p) => !(BIG_PADS as readonly string[]).includes(p));
    const pads = [...BIG_PADS, ...new Set(extraPads)];
    const padX = spread(pads.length, 18, W - 18);

    // One bus row per wire so no two horizontal runs share a line.
    const wires = [...wiring.wires].sort(
      (a, b) => pads.indexOf(a.pad) - pads.indexOf(b.pad),
    );
    const sensorTop = BUS_TOP + (wires.length - 1) * BUS_GAP + SENSOR_GAP;
    const height = sensorTop + SENSOR_H + 4;
    const termX = spread(wiring.wires.length, 30, W - 30);

    let signalIdx = 0;
    const colorOf = (role: WireRole): string => {
      if (role === 'power') return POWER_COLOR;
      if (role === 'ground') return GROUND_COLOR;
      return SIGNAL_COLORS[signalIdx++ % SIGNAL_COLORS.length]!;
    };
    const wireColors = new Map<Wire, string>();
    for (const w of wiring.wires) wireColors.set(w, colorOf(w.role));

    const padMarkup = pads
      .map((pad, i) => {
        const x = padX[i]!;
        const isBig = (BIG_PADS as readonly string[]).includes(pad);
        const half = isBig ? 5 : 3;
        const used = wiring.wires.some((w) => w.pad === pad);
        return `
          <rect x="${x - half}" y="${STRIP_TOP}" width="${half * 2}" height="${BOARD_BOTTOM - STRIP_TOP}"
                fill="${used ? '#c9a227' : 'var(--surface-3)'}" stroke="var(--border-strong)" stroke-width="0.5" />
          <text x="${x}" y="${PAD_LABEL_Y}" text-anchor="middle" font-size="9"
                font-weight="${used ? '700' : '400'}"
                fill="${used ? 'var(--fg)' : 'var(--fg-muted)'}">${PAD_LABEL[pad] ?? pad}</text>`;
      })
      .join('');

    const wireMarkup = wires
      .map((w, i) => {
        const x1 = padX[pads.indexOf(w.pad)]!;
        const x2 = termX[wiring.wires.indexOf(w)]!;
        const color = wireColors.get(w)!;
        const busY = BUS_TOP + i * BUS_GAP;
        const d =
          Math.abs(x1 - x2) < 0.5
            ? `M ${x1} ${BOARD_BOTTOM} L ${x1} ${sensorTop}`
            : `M ${x1} ${BOARD_BOTTOM} L ${x1} ${busY} L ${x2} ${busY} L ${x2} ${sensorTop}`;
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"
                      stroke-linejoin="round" stroke-linecap="round" />`;
      })
      .join('');

    const terminalMarkup = wiring.wires
      .map((w, i) => {
        const x = termX[i]!;
        const color = wireColors.get(w)!;
        return `
          <circle cx="${x}" cy="${sensorTop}" r="3.5" fill="${color}" stroke="var(--surface-1)" stroke-width="1" />
          <text x="${x}" y="${sensorTop + 15}" text-anchor="middle" font-size="9" font-weight="600"
                fill="var(--fg)">${escapeHtml(w.terminal)}</text>`;
      })
      .join('');

    const ariaLabel = `${t('panel.wiring')}: ${wiring.wires
      .map((w) => `${PAD_LABEL[w.pad] ?? w.pad} → ${w.terminal}`)
      .join(', ')} (${sensorLabel})`;

    const notes = wiring.noteKeys
      .map((key) => `<li>${escapeHtml(t(key))}</li>`)
      .join('');

    this.host.innerHTML = `
      <svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <rect x="8" y="${BOARD_TOP}" width="${W - 16}" height="${BOARD_BOTTOM - BOARD_TOP}" rx="6"
              fill="var(--surface-2)" stroke="var(--border-strong)" />
        <text x="${W / 2}" y="26" text-anchor="middle" font-size="12" font-weight="700"
              fill="var(--fg)">micro:bit</text>
        <text x="${W / 2}" y="37" text-anchor="middle" font-size="8"
              fill="var(--fg-muted)">${escapeHtml(t('wiring.edgeConnector'))}</text>
        ${padMarkup}
        ${wireMarkup}
        <rect x="12" y="${sensorTop}" width="${W - 24}" height="${SENSOR_H}" rx="6"
              fill="var(--surface-2)" stroke="var(--accent)" />
        ${terminalMarkup}
        <text x="${W / 2}" y="${sensorTop + SENSOR_H - 10}" text-anchor="middle" font-size="10"
              font-weight="700" fill="var(--fg)">${escapeHtml(sensorLabel)}</text>
      </svg>
      <ul class="wiring-legend">
        <li><span class="wiring-legend__swatch" style="background:${POWER_COLOR}"></span>${escapeHtml(t('wiring.power'))}</li>
        <li><span class="wiring-legend__swatch" style="background:${GROUND_COLOR}"></span>${escapeHtml(t('wiring.ground'))}</li>
        <li><span class="wiring-legend__swatch" style="background:${SIGNAL_COLORS[0]}"></span>${escapeHtml(t('wiring.signal'))}</li>
      </ul>
      <ul class="wiring-notes">${notes}</ul>
    `;
  }
}

/** `count` evenly spaced positions covering [from, to] (single item: centred). */
function spread(count: number, from: number, to: number): number[] {
  if (count <= 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => round1(from + i * step));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
