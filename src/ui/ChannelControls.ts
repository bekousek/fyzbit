import type { AppState, Channel } from '../state/AppState';
import { channelColorForIndex } from '../theme/runColors';
import { formatNumber, onLanguageChange, t } from '../i18n/i18n';
import { convert, displayUnit, onUnitsChange, setDisplayUnit, unitDecimals, unitOptionsFor } from '../units/units';
import { required } from '../utils/dom';

/**
 * The row of chips above the chart — one per channel the firmware announced.
 *
 * Each chip does three jobs at once: it names the quantity in its chart color
 * (so it doubles as a legend, which matters on phones where uPlot's own legend
 * is switched off), it toggles that quantity on and off, and it picks the unit
 * it is shown in. Hiding a channel only stops it being *drawn* — the run keeps
 * recording it.
 */
export class ChannelControls {
  private host: HTMLElement;
  private valueEls = new Map<string, HTMLElement>();
  private disposers: Array<() => void> = [];
  private valueFrame = 0;

  constructor(
    root: HTMLElement,
    private readonly state: AppState,
  ) {
    this.host = required('#channel-controls', root);
    this.disposers.push(
      this.state.bus.on('channels-changed', () => this.render()),
      this.state.bus.on('channel-visibility-changed', () => this.render()),
      this.state.bus.on('current-values', () => this.scheduleValueUpdate()),
      onLanguageChange(() => this.render()),
      onUnitsChange(() => this.render()),
    );
    this.render();
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    if (this.valueFrame) cancelAnimationFrame(this.valueFrame);
  }

  private render(): void {
    const channels = [...this.state.channels];
    this.host.textContent = '';
    this.valueEls.clear();
    this.host.hidden = channels.length === 0;
    if (channels.length === 0) return;

    channels.forEach((ch, idx) => this.host.appendChild(this.buildChip(ch, idx)));
    this.renderValues();
  }

  private buildChip(ch: Channel, idx: number): HTMLElement {
    const visible = this.state.isChannelVisible(ch.id);
    const unit = displayUnit(ch.unit);
    const name = t(ch.nameKey);

    const chip = document.createElement('div');
    chip.className = 'channel-chip';
    chip.classList.toggle('channel-chip--off', !visible);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'channel-chip__toggle';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.title = t(visible ? 'channel.hide' : 'channel.show', { name });

    const dot = document.createElement('span');
    dot.className = 'channel-chip__dot';
    dot.style.background = visible ? channelColorForIndex(idx) : 'transparent';
    dot.style.borderColor = channelColorForIndex(idx);
    toggle.appendChild(dot);

    const nameEl = document.createElement('span');
    nameEl.className = 'channel-chip__name';
    nameEl.textContent = name;
    toggle.appendChild(nameEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'channel-chip__value';
    toggle.appendChild(valueEl);
    this.valueEls.set(ch.id, valueEl);

    toggle.addEventListener('click', () => {
      this.state.setChannelVisible(ch.id, !this.state.isChannelVisible(ch.id));
    });
    chip.appendChild(toggle);

    const options = unitOptionsFor(ch.unit);
    if (options.length > 1) {
      const select = document.createElement('select');
      select.className = 'channel-chip__unit';
      select.setAttribute('aria-label', t('channel.unitFor', { name }));
      for (const opt of options) {
        const option = document.createElement('option');
        option.value = opt.id;
        option.textContent = opt.id;
        select.appendChild(option);
      }
      select.value = unit;
      select.addEventListener('change', () => setDisplayUnit(ch.unit, select.value));
      chip.appendChild(select);
    } else {
      const staticUnit = document.createElement('span');
      staticUnit.className = 'channel-chip__unit-static';
      staticUnit.textContent = unit;
      chip.appendChild(staticUnit);
    }

    return chip;
  }

  /** Live values arrive at up to 50 Hz — repaint at most once per frame. */
  private scheduleValueUpdate(): void {
    if (this.valueFrame) return;
    this.valueFrame = requestAnimationFrame(() => {
      this.valueFrame = 0;
      this.renderValues();
    });
  }

  private renderValues(): void {
    for (const ch of this.state.channels) {
      const el = this.valueEls.get(ch.id);
      if (!el) continue;
      const raw = this.state.currentValues[ch.id];
      if (raw === undefined) {
        el.textContent = '';
        continue;
      }
      const unit = displayUnit(ch.unit);
      el.textContent = formatNumber(convert(raw, ch.unit, unit), unitDecimals(unit));
    }
  }
}
