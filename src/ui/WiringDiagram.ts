import type { SensorName } from '../protocol/Commands';
import { onLanguageChange, t } from '../i18n/i18n';
import { required } from '../utils/dom';

type PinConnection = { pin: string; labelKey: string };

const SENSOR_WIRING: Record<SensorName, { nameKey: string; pins: PinConnection[] }> = {
  DS18B20: { nameKey: 'sensor.ds18b20', pins: [{ pin: 'P0', labelKey: 'wiring.data' }] },
  HX711: {
    nameKey: 'sensor.hx711',
    pins: [
      { pin: 'P15', labelKey: 'wiring.dt' },
      { pin: 'P16', labelKey: 'wiring.sck' },
    ],
  },
  HCSR04: {
    nameKey: 'sensor.hcsr04',
    pins: [
      { pin: 'P1', labelKey: 'wiring.trig' },
      { pin: 'P2', labelKey: 'wiring.echo' },
    ],
  },
  HX710B: {
    nameKey: 'sensor.hx710b',
    pins: [
      { pin: 'P0', labelKey: 'wiring.dt' },
      { pin: 'P1', labelKey: 'wiring.sck' },
    ],
  },
  DHT11: { nameKey: 'sensor.dht11', pins: [{ pin: 'P0', labelKey: 'wiring.data' }] },
};

/**
 * Wiring schematic in the left panel — swaps per selected sensor (see
 * SensorSelect). Plain SVG (rectangles + lines + text) rather than a photo
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
    const componentLabel = t(wiring.nameKey);
    const pins: PinConnection[] = [
      ...wiring.pins,
      { pin: '3V', labelKey: 'wiring.power' },
      { pin: 'GND', labelKey: 'wiring.ground' },
    ];

    const rowH = 26;
    const topPad = 20;
    const height = topPad * 2 + (pins.length - 1) * rowH;
    const midY = height / 2;

    const rows = pins
      .map((p, i) => {
        const y = topPad + i * rowH;
        const label = `${p.pin} (${t(p.labelKey)})`;
        return `
          <line x1="66" y1="${y}" x2="194" y2="${y}" stroke="var(--border-strong)" stroke-width="1.5" />
          <circle cx="66" cy="${y}" r="3" fill="var(--accent)" />
          <circle cx="194" cy="${y}" r="3" fill="var(--accent)" />
          <text x="130" y="${y - 5}" text-anchor="middle" font-size="10" fill="var(--fg)">${label}</text>
        `;
      })
      .join('');

    const ariaLabel = `${t('panel.wiring')}: ${componentLabel} → ${pins
      .map((p) => `${p.pin} (${t(p.labelKey)})`)
      .join(', ')}`;

    this.host.innerHTML = `
      <svg viewBox="0 0 260 ${height}" role="img" aria-label="${ariaLabel}">
        <rect x="4" y="6" width="56" height="${height - 12}" rx="6" fill="var(--surface-2)" stroke="var(--border-strong)" />
        <text x="32" y="${midY}" text-anchor="middle" font-size="10" fill="var(--fg)" transform="rotate(-90 32 ${midY})">micro:bit</text>
        <rect x="200" y="6" width="56" height="${height - 12}" rx="6" fill="var(--surface-2)" stroke="var(--accent)" />
        <text x="228" y="${midY}" text-anchor="middle" font-size="9" fill="var(--fg)" transform="rotate(-90 228 ${midY})">${componentLabel}</text>
        ${rows}
      </svg>
    `;
  }
}
