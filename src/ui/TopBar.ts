import type { AppState, Channel, ConnectionStatus } from '../state/AppState';
import { formatNumber, onLanguageChange, t } from '../i18n/i18n';

/**
 * Top bar widget. Shows connection status badge + sensor name + big numeric
 * value of the primary (first) channel. Listens to AppState events.
 */
export class TopBar {
  private textEl: HTMLElement;
  private statusBadge: HTMLElement;
  private bigNumber: HTMLElement;
  private bigUnit: HTMLElement;
  private disposers: Array<() => void> = [];

  constructor(
    root: HTMLElement,
    private readonly state: AppState,
  ) {
    this.statusBadge = required('#status-badge', root);
    this.textEl = required('.status-badge__text', this.statusBadge);
    const bigValue = required('#big-value', root);
    this.bigNumber = required('.big-value__number', bigValue);
    this.bigUnit = required('.big-value__unit', bigValue);

    this.disposers.push(
      this.state.bus.on('connection-status', (s) => this.renderStatus(s)),
      this.state.bus.on('channels-changed', () => this.renderValue()),
      this.state.bus.on('sensor-name', () => this.renderStatus(this.state.status)),
      this.state.bus.on('current-values', () => this.renderValue()),
      onLanguageChange(() => {
        this.renderStatus(this.state.status);
        this.renderValue();
      }),
    );

    this.renderStatus(this.state.status);
    this.renderValue();
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  private renderStatus(status: ConnectionStatus): void {
    this.statusBadge.setAttribute('data-status', status);
    const sensorName = this.state.sensorName;
    const base = t(`status.${status}`);
    this.textEl.textContent =
      status === 'connected' || status === 'measuring'
        ? sensorName
          ? `${base}: ${sensorName}`
          : base
        : base;
    this.textEl.removeAttribute('data-i18n'); // Avoid clobber by global re-scan.
  }

  private renderValue(): void {
    const primary: Channel | undefined = this.state.channels[0];
    if (!primary) {
      this.bigNumber.textContent = '—';
      this.bigUnit.textContent = '';
      return;
    }
    const value = this.state.currentValues[primary.id];
    this.bigNumber.textContent = value === undefined ? '—' : formatNumber(value, 1);
    this.bigUnit.textContent = primary.unit;
  }
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`TopBar: missing element ${selector}`);
  return el;
}
