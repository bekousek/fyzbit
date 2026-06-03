import type { AppState, Channel } from '../state/AppState';
import { Commands } from '../protocol/Commands';
import { t, onLanguageChange, formatNumber } from '../i18n/i18n';

const CAL_TIMEOUT_MS = 3000;
const WARN_FACTOR_RATIO = 10;

type CalibrationDeps = {
  state: AppState;
  /** Sends a textual command to the connected transport. No-op if disconnected. */
  send: (cmd: string) => void;
  /** Notifies subscribers when a #CAL;id;ok;factor reply arrives. */
  onCalibrationReply: (
    handler: (msg: { channelId: string; ok: boolean; factor?: number }) => void,
  ) => () => void;
};

type Step = 'choose' | 'instructions' | 'value' | 'sending' | 'result';

/**
 * 5-step calibration wizard (spec §12).
 *
 *   1. choose       — channel pick (skipped if only one channel)
 *   2. instructions — "prepare a known reference for ..."
 *   3. value        — number input with the channel's unit
 *   4. sending      — emit #CAL, wait up to 3s for reply
 *   5. result       — show new factor (with safety warning if >10× from default)
 *
 * The "default factor" comparison is done against value 1.0 — firmware-reported
 * factors are scale multipliers; large deviations (>10×) suggest the user keyed
 * the wrong reference value or has a hardware fault.
 */
export class CalibrationModal {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private btnBack: HTMLButtonElement;
  private btnNext: HTMLButtonElement;
  private btnCancel: HTMLButtonElement;
  private btnClose: HTMLButtonElement;

  private step: Step = 'choose';
  private selectedChannel: Channel | null = null;
  private referenceValue = 0;
  private resultFactor: number | null = null;
  private resultError: string | null = null;
  private timeoutHandle: number | null = null;
  private unsubscribeReply: (() => void) | null = null;

  constructor(private readonly deps: CalibrationDeps) {
    this.dialog = required<HTMLDialogElement>('#calibration-modal');
    this.body = required<HTMLElement>('#calibration-body', this.dialog);
    this.btnBack = required<HTMLButtonElement>('#btn-cal-back', this.dialog);
    this.btnNext = required<HTMLButtonElement>('#btn-cal-next', this.dialog);
    this.btnCancel = required<HTMLButtonElement>('#btn-cal-cancel', this.dialog);
    this.btnClose = required<HTMLButtonElement>('#btn-close-calibration', this.dialog);

    this.btnBack.addEventListener('click', () => this.goBack());
    this.btnNext.addEventListener('click', () => this.goNext());
    this.btnCancel.addEventListener('click', () => this.close());
    this.btnClose.addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });

    onLanguageChange(() => {
      if (this.dialog.open) this.render();
    });
  }

  open(): void {
    const channels = this.deps.state.channels;
    if (channels.length === 0) {
      window.alert(t('calibration.noChannels'));
      return;
    }
    this.step = channels.length === 1 ? 'instructions' : 'choose';
    this.selectedChannel = channels.length === 1 ? channels[0]! : null;
    this.referenceValue = 0;
    this.resultFactor = null;
    this.resultError = null;
    this.render();
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
  }

  close(): void {
    this.cancelPendingReply();
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  private goNext(): void {
    switch (this.step) {
      case 'choose': {
        if (!this.selectedChannel) return;
        this.step = 'instructions';
        break;
      }
      case 'instructions':
        this.step = 'value';
        break;
      case 'value': {
        const input = this.body.querySelector<HTMLInputElement>('#cal-value-input');
        if (!input) return;
        const v = Number(input.value);
        if (!Number.isFinite(v)) {
          input.setCustomValidity(t('calibration.invalidNumber'));
          input.reportValidity();
          return;
        }
        this.referenceValue = v;
        this.step = 'sending';
        this.sendCalibration();
        break;
      }
      case 'sending':
        // No-op while waiting.
        return;
      case 'result':
        this.close();
        return;
    }
    this.render();
  }

  private goBack(): void {
    switch (this.step) {
      case 'instructions':
        if (this.deps.state.channels.length > 1) this.step = 'choose';
        break;
      case 'value':
        this.step = 'instructions';
        break;
      case 'result':
        this.cancelPendingReply();
        this.resultFactor = null;
        this.resultError = null;
        this.step = 'value';
        break;
    }
    this.render();
  }

  // ──────────────────────────────────────────────────────────
  // Calibration request
  // ──────────────────────────────────────────────────────────

  private sendCalibration(): void {
    this.cancelPendingReply();
    if (!this.selectedChannel) return;
    const channelId = this.selectedChannel.id;
    this.render();
    this.unsubscribeReply = this.deps.onCalibrationReply((msg) => {
      if (msg.channelId !== channelId) return;
      this.handleReply(msg);
    });
    this.deps.send(Commands.calibrate(channelId, this.referenceValue));
    // If the transport already replied synchronously (e.g. Mock), step has
    // moved past 'sending' and there's nothing to time out.
    if (this.step !== 'sending') return;
    const myTimer = window.setTimeout(() => {
      if (this.timeoutHandle !== myTimer) return;
      this.resultError = t('error.calibrationTimeout');
      this.handleReply({ channelId, ok: false });
    }, CAL_TIMEOUT_MS);
    this.timeoutHandle = myTimer;
  }

  private handleReply(msg: { channelId: string; ok: boolean; factor?: number }): void {
    this.cancelPendingReply();
    this.resultFactor = msg.ok ? msg.factor ?? null : null;
    this.resultError = msg.ok ? null : this.resultError ?? t('calibration.failed');
    this.step = 'result';
    this.render();
  }

  private cancelPendingReply(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.unsubscribeReply) {
      this.unsubscribeReply();
      this.unsubscribeReply = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────

  private render(): void {
    switch (this.step) {
      case 'choose':
        this.renderChoose();
        this.setButtons({ back: false, next: t('calibration.next'), nextDisabled: !this.selectedChannel });
        break;
      case 'instructions':
        this.renderInstructions();
        this.setButtons({ back: this.deps.state.channels.length > 1, next: t('calibration.next') });
        break;
      case 'value':
        this.renderValue();
        this.setButtons({ back: true, next: t('calibration.send') });
        break;
      case 'sending':
        this.renderSending();
        this.setButtons({ back: false, next: t('calibration.waiting'), nextDisabled: true });
        break;
      case 'result':
        this.renderResult();
        this.setButtons({
          back: this.resultError ? true : false,
          next: t('button.close'),
          nextDisabled: false,
        });
        break;
    }
  }

  private setButtons(opts: { back: boolean; next: string; nextDisabled?: boolean }): void {
    this.btnBack.hidden = !opts.back;
    this.btnNext.textContent = opts.next;
    this.btnNext.disabled = !!opts.nextDisabled;
  }

  private renderChoose(): void {
    const channels = this.deps.state.channels;
    this.body.innerHTML = `
      <p>${escape(t('calibration.choose'))}</p>
      <label class="field">
        <span class="field__label">${escape(t('calibration.channel'))}</span>
        <select id="cal-channel-select" class="field__input">
          <option value="">—</option>
          ${channels
            .map((c) => `<option value="${escape(c.id)}">${escape(t(c.nameKey))} (${escape(c.unit)})</option>`)
            .join('')}
        </select>
      </label>
    `;
    const select = this.body.querySelector<HTMLSelectElement>('#cal-channel-select');
    if (select) {
      select.value = this.selectedChannel?.id ?? '';
      select.addEventListener('change', () => {
        this.selectedChannel = channels.find((c) => c.id === select.value) ?? null;
        this.btnNext.disabled = !this.selectedChannel;
      });
    }
  }

  private renderInstructions(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    this.body.innerHTML = `
      <p>${escape(t('calibration.prepare', { name: t(ch.nameKey) }))}</p>
      <ul class="cal-tips">
        ${getChannelTips(ch.id)
          .map((tip) => `<li>${escape(tip)}</li>`)
          .join('')}
      </ul>
    `;
  }

  private renderValue(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    this.body.innerHTML = `
      <label class="field">
        <span class="field__label">${escape(t('calibration.enterValue', { name: t(ch.nameKey) }))}</span>
        <div class="cal-value-row">
          <input
            type="number"
            step="any"
            id="cal-value-input"
            class="field__input"
            value="${Number.isFinite(this.referenceValue) && this.referenceValue !== 0 ? this.referenceValue : ''}"
            autofocus
          />
          <span class="cal-value-unit">${escape(ch.unit)}</span>
        </div>
      </label>
      <p class="cal-help">${escape(t('calibration.valueHelp'))}</p>
    `;
    const input = this.body.querySelector<HTMLInputElement>('#cal-value-input');
    input?.addEventListener('input', () => input.setCustomValidity(''));
    setTimeout(() => input?.focus(), 0);
  }

  private renderSending(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    this.body.innerHTML = `
      <p>${escape(t('calibration.sending', { name: t(ch.nameKey) }))}</p>
      <div class="cal-spinner" aria-hidden="true"></div>
    `;
  }

  private renderResult(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    if (this.resultError) {
      this.body.innerHTML = `
        <div class="cal-result cal-result--err">
          <strong>${escape(t('calibration.failedTitle'))}</strong>
          <p>${escape(this.resultError)}</p>
        </div>
      `;
      return;
    }
    const factor = this.resultFactor ?? 1;
    const showWarning = Math.abs(factor) > WARN_FACTOR_RATIO || Math.abs(factor) < 1 / WARN_FACTOR_RATIO;
    this.body.innerHTML = `
      <div class="cal-result cal-result--ok">
        <strong>${escape(t('calibration.doneTitle'))}</strong>
        <p>${escape(
          t('calibration.doneBody', { name: t(ch.nameKey), factor: formatNumber(factor, 3) }),
        )}</p>
        ${
          showWarning
            ? `<p class="cal-warning">⚠ ${escape(t('calibration.warningFactor'))}</p>`
            : ''
        }
      </div>
    `;
  }
}

function getChannelTips(channelId: string): string[] {
  switch (channelId) {
    case 't':
      return [t('calibration.tipTemperature1'), t('calibration.tipTemperature2')];
    case 'F':
      return [t('calibration.tipForce1'), t('calibration.tipForce2')];
    case 'p':
      return [t('calibration.tipPressure1'), t('calibration.tipPressure2')];
    case 'd':
      return [t('calibration.tipDistance1')];
    default:
      return [t('calibration.tipGeneric')];
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`CalibrationModal: missing element ${selector}`);
  return el;
}
