import type { AppState, Channel, ConnectionStatus } from '../state/AppState';
import { formatNumber, onLanguageChange, t } from '../i18n/i18n';
import { convert, displayUnit, onUnitsChange, unitDecimals } from '../units/units';
import { required } from '../utils/dom';

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
      this.state.bus.on('channel-visibility-changed', () => this.renderValue()),
      onUnitsChange(() => this.renderValue()),
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

  /**
   * The big number follows the *first channel still switched on*, so hiding
   * distance to look at speed alone moves the headline value too rather than
   * leaving it stuck on a quantity that is no longer on screen.
   */
  private renderValue(): void {
    const primary: Channel | undefined = this.state.visibleChannels[0];
    if (!primary) {
      this.bigNumber.textContent = '—';
      this.bigUnit.textContent = '';
      return;
    }
    const unit = displayUnit(primary.unit);
    const value = this.state.currentValues[primary.id];
    this.bigNumber.textContent =
      value === undefined
        ? '—'
        : formatNumber(convert(value, primary.unit, unit), unitDecimals(unit));
    this.bigUnit.textContent = unit;
  }
}
