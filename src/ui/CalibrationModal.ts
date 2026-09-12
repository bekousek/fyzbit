import type { AppState, Channel } from '../state/AppState';
import { Commands } from '../protocol/Commands';
import { t, onLanguageChange, formatNumber } from '../i18n/i18n';
import { escapeHtml, required } from '../utils/dom';
import { showAlert } from './Dialog';

const CAL_TIMEOUT_MS = 3000;
const WARN_FACTOR_RATIO = 10;

type CalibrationDeps = {
  state: AppState;
  /** Sends a textual command to the connected transport. No-op if disconnected. */
  send: (cmd: string) => void;
  /** Notifies subscribers when a #CAL;id;ok;factor reply arrives. */
  onCalibrationReply: (
    handler: (msg: {
      channelId: string;
      ok: boolean;
      factor?: number;
      previousFactor?: number;
    }) => void,
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
 *   5. result       — show the new factor, warning if it moved more than 10×
 *
 * "Moved" is the operative word. The factor is the firmware's scale in
 * converter counts per unit, so its magnitude belongs to the sensor: -10578 for
 * the load cell, 581.84 for the pressure module. This once compared it against
 * 1.0, which meant the warning fired on every correct calibration of those two
 * and would have kept quiet on a genuinely wrong one. The firmware now reports
 * the scale it held before, and the ratio between the two is what says whether
 * the user keyed the wrong reference.
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
  private resultPrevious: number | null = null;
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
      void showAlert(t('calibration.noChannels'));
      return;
    }
    this.step = channels.length === 1 ? 'instructions' : 'choose';
    this.selectedChannel = channels.length === 1 ? channels[0]! : null;
    this.referenceValue = 0;
    this.resultFactor = null;
    this.resultPrevious = null;
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
        if (input.value.trim() === '' || !Number.isFinite(v)) {
          this.showValueError(input, t('calibration.invalidNumber'));
          return;
        }
        this.clearValueError(input);
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
        this.resultPrevious = null;
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

  private handleReply(msg: {
    channelId: string;
    ok: boolean;
    factor?: number;
    previousFactor?: number;
  }): void {
    this.cancelPendingReply();
    this.resultFactor = msg.ok ? msg.factor ?? null : null;
    this.resultPrevious = msg.ok ? msg.previousFactor ?? null : null;
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
      <p>${escapeHtml(t('calibration.choose'))}</p>
      <div class="field">
        <label class="field__label" for="cal-channel-select">${escapeHtml(
          t('calibration.channel'),
        )}</label>
        <select id="cal-channel-select" class="field__input">
          <option value="">—</option>
          ${channels
            .map(
              (c) =>
                `<option value="${escapeHtml(c.id)}">${escapeHtml(t(c.nameKey))} (${escapeHtml(c.unit)})</option>`,
            )
            .join('')}
        </select>
      </div>
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
      <p>${escapeHtml(t('calibration.prepare', { name: t(ch.nameKey) }))}</p>
      <ul class="cal-tips">
        ${getChannelTips(ch.id)
          .map((tip) => `<li>${escapeHtml(tip)}</li>`)
          .join('')}
      </ul>
    `;
  }

  private renderValue(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    // The help text and the validation message are both wired to the input
    // through aria-describedby: a screen reader reads the format hint on
    // focus and the error the moment aria-invalid flips.
    this.body.innerHTML = `
      <div class="field">
        <label class="field__label" for="cal-value-input">${escapeHtml(
          t('calibration.enterValue', { name: t(ch.nameKey) }),
        )}</label>
        <div class="cal-value-row">
          <input
            type="number"
            step="any"
            id="cal-value-input"
            class="field__input"
            aria-describedby="cal-value-help cal-value-error"
            aria-invalid="false"
            value="${Number.isFinite(this.referenceValue) && this.referenceValue !== 0 ? this.referenceValue : ''}"
          />
          <span class="cal-value-unit">${escapeHtml(ch.unit)}</span>
        </div>
        <p class="field__error" id="cal-value-error" role="alert" hidden></p>
      </div>
      <p class="cal-help" id="cal-value-help">${escapeHtml(t('calibration.valueHelp'))}</p>
    `;
    const input = this.body.querySelector<HTMLInputElement>('#cal-value-input');
    input?.addEventListener('input', () => this.clearValueError(input));
    setTimeout(() => input?.focus(), 0);
  }

  private showValueError(input: HTMLInputElement, message: string): void {
    const errorEl = this.body.querySelector<HTMLElement>('#cal-value-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('field__input--invalid');
    input.focus();
  }

  private clearValueError(input: HTMLInputElement): void {
    const errorEl = this.body.querySelector<HTMLElement>('#cal-value-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
    input.setAttribute('aria-invalid', 'false');
    input.classList.remove('field__input--invalid');
  }

  private renderSending(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    this.body.innerHTML = `
      <p role="status">${escapeHtml(t('calibration.sending', { name: t(ch.nameKey) }))}</p>
      <div class="cal-spinner" aria-hidden="true"></div>
    `;
  }

  private renderResult(): void {
    const ch = this.selectedChannel;
    if (!ch) return;
    if (this.resultError) {
      this.body.innerHTML = `
        <div class="cal-result cal-result--err" role="alert">
          <strong>${escapeHtml(t('calibration.failedTitle'))}</strong>
          <p>${escapeHtml(this.resultError)}</p>
        </div>
      `;
      return;
    }
    const factor = this.resultFactor ?? 1;
    // No previous scale means firmware too old to report one. Say nothing
    // rather than guess: a wrong warning on a good calibration is worse than
    // no warning at all, which is what comparing against 1.0 used to produce.
    const previous = this.resultPrevious;
    const moved = previous !== null && previous !== 0 ? Math.abs(factor / previous) : 1;
    const showWarning = moved > WARN_FACTOR_RATIO || moved < 1 / WARN_FACTOR_RATIO;
    this.body.innerHTML = `
      <div class="cal-result cal-result--ok" role="status">
        <strong>${escapeHtml(t('calibration.doneTitle'))}</strong>
        <p>${escapeHtml(
          t('calibration.doneBody', { name: t(ch.nameKey), factor: formatNumber(factor, 3) }),
        )}</p>
        ${
          showWarning
            ? `<p class="cal-warning"><span aria-hidden="true">⚠</span> ${escapeHtml(
                t('calibration.warningFactor'),
              )}</p>`
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

