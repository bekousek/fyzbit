import { Commands, type SensorName } from '../protocol/Commands';
import type { AppState, ConnectionStatus } from '../state/AppState';
import { onLanguageChange, t } from '../i18n/i18n';
import { required } from '../utils/dom';

const SENSORS: SensorName[] = ['DS18B20', 'HX711', 'HCSR04', 'HX710B', 'DHT11'];

/**
 * Sensor picker in the top bar — sends #SELECT so a teacher can switch which
 * physical sensor the firmware reads without touching the on-board button B.
 * Only shown while connected (firmware only understands #SELECT post-handshake).
 */
export class SensorSelect {
  private select: HTMLSelectElement;

  constructor(
    root: HTMLElement,
    private readonly state: AppState,
    private readonly send: (cmd: string) => void,
  ) {
    this.select = required('#sensor-select', root);
    this.renderOptions();
    this.select.addEventListener('change', () => {
      this.send(Commands.selectSensor(this.select.value as SensorName));
    });

    this.state.bus.on('connection-status', (s) => this.updateVisibility(s));
    onLanguageChange(() => this.renderOptions());
    this.updateVisibility(this.state.status);
  }

  private renderOptions(): void {
    const current = this.select.value;
    this.select.textContent = '';
    for (const name of SENSORS) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = t(`sensor.${name.toLowerCase()}`);
      this.select.appendChild(opt);
    }
    if (current) this.select.value = current;
  }

  private updateVisibility(status: ConnectionStatus): void {
    this.select.hidden = !(status === 'connected' || status === 'measuring');
  }
}
