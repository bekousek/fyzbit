import type { SensorName } from '../protocol/Commands';
import { onLanguageChange, t } from '../i18n/i18n';
import { escapeHtml, required } from '../utils/dom';

/**
 * The board drawing is the Micro:bit Educational Foundation's own
 * (public/img/microbit-board.svg, CC BY-NC-SA 4.0 — see the file header and
 * README), cropped to the board. Everything below is measured against its
 * cropped viewBox: fractions of the drawing's width for the five big pads,
 * and the fraction of its height where the gold ends.
 *
 * If the asset is ever regenerated, re-measure these — they are the only
 * thing tying our wires to their pads.
 */
const BOARD_SVG = `${import.meta.env.BASE_URL}img/microbit-board.svg`;
const BOARD_ASPECT = 191.8 / 155.6;
const PAD_X_FRACTION: Record<string, number> = {
  P0: 0.08087,
  P1: 0.27497,
  P2: 0.49083,
  '3V': 0.70866,
  GND: 0.9013,
};
const PAD_BOTTOM_FRACTION = 0.97603;

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
const BOARD_X = 22;
const BOARD_Y = 2;
const BOARD_W = 176;
const BOARD_H = BOARD_W / BOARD_ASPECT;
/**
 * Wires attach just *below* the gold, not on it: the drawing silkscreens the
 * pad numbers (0, 1, 2, 3V, GND) across the lower half of each pad, and a
 * marker placed there covers the very label the wire is pointing at.
 */
const PAD_Y = BOARD_Y + PAD_BOTTOM_FRACTION * BOARD_H + 1.5;
const CHIP_W = 22;
const CHIP_GAP = 4;
const CHIP_H = 13;
const BUS_GAP = 12;
const SENSOR_GAP = 16;
const SENSOR_H = 48;

/**
 * Wiring schematic in the left panel — swaps per selected sensor (see
 * SensorSelect).
 *
 * Read top to bottom: the micro:bit with its edge connector, then one wire per
 * connection dropping into the sensor's own terminals. The pads carry the
 * numbers printed on the real board, so "0" here is the "0" a pupil is
 * looking at.
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

    // Pins that aren't one of the five big pads (P15/P16) get a labelled chip
    // under the edge connector rather than a false-precision arrow at one of
    // the ~20 tiny strips nobody can hit without a breakout board.
    const smallPins = [...new Set(wiring.wires.map((w) => w.pad))].filter(
      (pad) => !(pad in PAD_X_FRACTION),
    );
    // Laid out side by side around the midpoint of the small-pin stretch
    // (between pads 2 and 3V) rather than spread across it: the gap is barely
    // two chips wide, and spreading inside it makes them overlap each other.
    const chipSpan = smallPins.length * CHIP_W + Math.max(0, smallPins.length - 1) * CHIP_GAP;
    const chipCentre =
      BOARD_X + ((PAD_X_FRACTION.P2! + PAD_X_FRACTION['3V']!) / 2) * BOARD_W;
    const chipX = smallPins.map(
      (_, i) => chipCentre - chipSpan / 2 + CHIP_W / 2 + i * (CHIP_W + CHIP_GAP),
    );
    const chipBottom = PAD_Y + 8 + CHIP_H;

    const sourceOf = (pad: string): { x: number; y: number } => {
      const frac = PAD_X_FRACTION[pad];
      if (frac !== undefined) return { x: BOARD_X + frac * BOARD_W, y: PAD_Y };
      const i = smallPins.indexOf(pad);
      return { x: chipX[i] ?? W / 2, y: chipBottom };
    };

    // One bus row per wire so no two horizontal runs share a line.
    const wires = [...wiring.wires].sort(
      (a, b) => sourceOf(a.pad).x - sourceOf(b.pad).x,
    );
    const busTop = (smallPins.length > 0 ? chipBottom : PAD_Y) + 14;
    const sensorTop = busTop + (wires.length - 1) * BUS_GAP + SENSOR_GAP;
    const height = sensorTop + SENSOR_H + 4;
    const termX = spread(wiring.wires.length, 30, W - 30);

    let signalIdx = 0;
    const wireColors = new Map<Wire, string>();
    for (const w of wiring.wires) {
      wireColors.set(
        w,
        w.role === 'power'
          ? POWER_COLOR
          : w.role === 'ground'
            ? GROUND_COLOR
            : SIGNAL_COLORS[signalIdx++ % SIGNAL_COLORS.length]!,
      );
    }

    const chipMarkup = smallPins
      .map((pad, i) => {
        const x = chipX[i]!;
        const color = wireColors.get(wiring.wires.find((w) => w.pad === pad)!)!;
        return `
          <rect x="${x - CHIP_W / 2}" y="${PAD_Y + 8}" width="${CHIP_W}" height="${CHIP_H}" rx="3"
                fill="var(--surface-2)" stroke="${color}" stroke-width="1.2" />
          <text x="${x}" y="${PAD_Y + 17.5}" text-anchor="middle" font-size="8" font-weight="700"
                fill="var(--fg)">${escapeHtml(pad)}</text>`;
      })
      .join('');

    const wireMarkup = wires
      .map((w, i) => {
        const from = sourceOf(w.pad);
        const x2 = termX[wiring.wires.indexOf(w)]!;
        const color = wireColors.get(w)!;
        const busY = busTop + i * BUS_GAP;
        const d =
          Math.abs(from.x - x2) < 0.5
            ? `M ${round1(from.x)} ${round1(from.y)} L ${round1(from.x)} ${round1(sensorTop)}`
            : `M ${round1(from.x)} ${round1(from.y)} L ${round1(from.x)} ${busY} L ${round1(x2)} ${busY} L ${round1(x2)} ${round1(sensorTop)}`;
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2"
                      stroke-linejoin="round" stroke-linecap="round" />
                <circle cx="${round1(from.x)}" cy="${round1(from.y)}" r="3.2" fill="${color}"
                        stroke="var(--surface-1)" stroke-width="1" />`;
      })
      .join('');

    const terminalMarkup = wiring.wires
      .map((w, i) => {
        const x = termX[i]!;
        const color = wireColors.get(w)!;
        return `
          <circle cx="${x}" cy="${round1(sensorTop)}" r="3.5" fill="${color}" stroke="var(--surface-1)" stroke-width="1" />
          <text x="${x}" y="${round1(sensorTop + 15)}" text-anchor="middle" font-size="9" font-weight="600"
                fill="var(--fg)">${escapeHtml(w.terminal)}</text>`;
      })
      .join('');

    const ariaLabel = `${t('panel.wiring')}: ${wiring.wires
      .map((w) => `${w.pad} → ${w.terminal}`)
      .join(', ')} (${sensorLabel})`;

    const notes = wiring.noteKeys.map((key) => `<li>${escapeHtml(t(key))}</li>`).join('');

    this.host.innerHTML = `
      <svg viewBox="0 0 ${W} ${round1(height)}" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <image href="${BOARD_SVG}" x="${BOARD_X}" y="${BOARD_Y}"
               width="${BOARD_W}" height="${round1(BOARD_H)}" />
        ${wireMarkup}
        <!-- Chips last: a wire routed past a small-pin chip would otherwise
             be drawn across its label. -->
        ${chipMarkup}
        <rect x="12" y="${round1(sensorTop)}" width="${W - 24}" height="${SENSOR_H}" rx="6"
              fill="var(--surface-2)" stroke="var(--accent)" />
        ${terminalMarkup}
        <text x="${W / 2}" y="${round1(sensorTop + SENSOR_H - 10)}" text-anchor="middle" font-size="10"
              font-weight="700" fill="var(--fg)">${escapeHtml(sensorLabel)}</text>
      </svg>
      <ul class="wiring-legend">
        <li><span class="wiring-legend__swatch" style="background:${POWER_COLOR}"></span>${escapeHtml(t('wiring.power'))}</li>
        <li><span class="wiring-legend__swatch" style="background:${GROUND_COLOR}"></span>${escapeHtml(t('wiring.ground'))}</li>
        <li><span class="wiring-legend__swatch" style="background:${SIGNAL_COLORS[0]}"></span>${escapeHtml(t('wiring.signal'))}</li>
      </ul>
      <ul class="wiring-notes">${notes}</ul>
      <p class="wiring-credit">${escapeHtml(t('wiring.boardCredit'))}</p>
    `;
  }
}

/** `count` evenly spaced positions covering [from, to] (single item: centred). */
function spread(count: number, from: number, to: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => round1(from + i * step));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
