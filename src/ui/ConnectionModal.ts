import type { Transport, TransportKind } from '../transport/Transport';
import { MockTransport } from '../transport/MockTransport';
import { SerialTransport } from '../transport/SerialTransport';
import { t, onLanguageChange } from '../i18n/i18n';
import { required } from '../utils/dom';
import { FIRMWARE_HEX_URL } from '../flash/firmware';
import type { FlashProgress } from '../flash/Flasher';
import { toast } from './Toast';

// Flasher.ts / BluetoothTransport.ts are *not* imported at the top: both pull
// in @microbit/microbit-connection (~50 kB), so they're loaded lazily — in
// startFlash() and pick('bluetooth') respectively — only when actually used.
// These checks need no library code, just the relevant browser API's presence.
const FLASH_SUPPORTED = typeof navigator !== 'undefined' && 'usb' in navigator;
const BLUETOOTH_SUPPORTED = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/**
 * Web Serial, Web Bluetooth and WebUSB are all gated on a secure context, and
 * a browser that has them still hides them over plain http. The two causes —
 * "your browser cannot" and "this page is not https" — need different advice,
 * and the second one is invisible in feature detection: the API is simply
 * absent either way. So check the context separately and say which it is.
 */
function isInsecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}

/** Why a transport is unavailable, phrased for a teacher rather than a log. */
function unavailableReason(kind: 'serial' | 'bluetooth' | 'usb'): string {
  if (isInsecureContext()) return t('connection.insecureContext');
  if (kind === 'serial') return t('connection.unsupportedSerial');
  if (kind === 'bluetooth') return t('connection.unsupportedBluetooth');
  return t('connection.unsupportedUsb');
}

const STAGE_I18N_KEY: Partial<Record<string, string>> = {
  Initializing: 'flash.stageInitializing',
  FindingDevice: 'flash.stageFindingDevice',
  Connecting: 'flash.stageConnecting',
  PartialFlashing: 'flash.stagePartialFlashing',
  FullFlashing: 'flash.stageFullFlashing',
};

export type ConnectRequest = {
  kind: TransportKind;
  transport: Transport;
  /** Human label shown in the status badge (e.g., "USB", "Mock"). */
  label: string;
};

/**
 * ConnectionModal — walks the user through the two steps in the order they
 * happen the first time: flash the firmware (step 1), then pick a transport
 * (step 2). There is only one firmware file — the board's bootloader decides
 * whether it gets the Bluetooth-capable V2 image — so nothing is chosen here.
 *
 * The Mock demo lives below step 2 as a secondary link rather than a third
 * equal option: it is a presentation aid, not a way to connect a micro:bit.
 *
 * Errors during transport selection or flashing (user cancelled, browser
 * unsupported) are surfaced inside the modal, not as toasts.
 */
export class ConnectionModal {
  private dialog: HTMLDialogElement;
  private errorEl: HTMLElement;
  private serialBtn: HTMLButtonElement;
  private bluetoothBtn: HTMLButtonElement;
  private mockBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private flashBtn: HTMLButtonElement;
  private downloadLink: HTMLAnchorElement;
  private flashProgressEl: HTMLElement;
  private flashProgressBarEl: HTMLElement;
  private flashProgressFillEl: HTMLElement;
  private flashProgressLabelEl: HTMLElement;
  private flashErrorEl: HTMLElement;
  private flashUnavailableEl: HTMLElement;
  private serialNoteEl: HTMLElement;
  private bluetoothNoteEl: HTMLElement;
  private flashing = false;
  private pendingResolve: ((req: ConnectRequest | null) => void) | null = null;

  constructor() {
    this.dialog = required<HTMLDialogElement>('#connection-modal');
    this.errorEl = required<HTMLElement>('#connection-error', this.dialog);
    this.serialBtn = required<HTMLButtonElement>('#btn-connect-serial', this.dialog);
    this.bluetoothBtn = required<HTMLButtonElement>('#btn-connect-bluetooth', this.dialog);
    this.mockBtn = required<HTMLButtonElement>('#btn-connect-mock', this.dialog);
    this.closeBtn = required<HTMLButtonElement>('#btn-close-connection', this.dialog);
    this.flashBtn = required<HTMLButtonElement>('#btn-flash-firmware', this.dialog);
    this.downloadLink = required<HTMLAnchorElement>('#link-download-firmware', this.dialog);
    this.flashProgressEl = required<HTMLElement>('#flash-progress', this.dialog);
    this.flashProgressBarEl = required<HTMLElement>('#flash-progress-bar', this.dialog);
    this.flashProgressFillEl = required<HTMLElement>('#flash-progress-fill', this.dialog);
    this.flashProgressLabelEl = required<HTMLElement>('#flash-progress-label', this.dialog);
    this.flashErrorEl = required<HTMLElement>('#flash-error', this.dialog);
    this.flashUnavailableEl = required<HTMLElement>('#flash-unavailable', this.dialog);
    this.serialNoteEl = required<HTMLElement>('#serial-unavailable', this.dialog);
    this.bluetoothNoteEl = required<HTMLElement>('#bluetooth-unavailable', this.dialog);
    this.downloadLink.href = FIRMWARE_HEX_URL;

    this.syncAvailability();
    // The flash step has a working fallback (download the .hex, drag it onto
    // the MICROBIT drive), so instead of hiding the button without a word,
    // the reason is spelled out above that fallback link.
    this.flashBtn.hidden = !FLASH_SUPPORTED;
    if (!FLASH_SUPPORTED) {
      this.flashUnavailableEl.textContent = unavailableReason('usb');
      this.flashUnavailableEl.hidden = false;
    }

    this.serialBtn.addEventListener('click', () => {
      void this.pick('serial');
    });
    this.bluetoothBtn.addEventListener('click', () => {
      void this.pick('bluetooth');
    });
    this.mockBtn.addEventListener('click', () => {
      void this.pick('mock');
    });
    this.flashBtn.addEventListener('click', () => void this.startFlash());
    this.closeBtn.addEventListener('click', () => {
      if (!this.flashing) this.cancel();
    });
    this.dialog.addEventListener('cancel', (e) => {
      if (this.flashing) e.preventDefault();
      else this.cancel();
    });

    onLanguageChange(() => {
      this.syncAvailability();
      if (!FLASH_SUPPORTED) this.flashUnavailableEl.textContent = unavailableReason('usb');
    });
  }

  /**
   * Marks the transports this browser cannot offer and says why, both as a
   * tooltip and — since a tooltip is unreachable by keyboard and touch — as
   * a line of text under the button, wired to it via aria-describedby.
   */
  private syncAvailability(): void {
    const serialOk = SerialTransport.isSupported() && !isInsecureContext();
    const bluetoothOk = BLUETOOTH_SUPPORTED && !isInsecureContext();

    this.serialBtn.disabled = !serialOk;
    this.bluetoothBtn.disabled = !bluetoothOk;

    const explain = (
      btn: HTMLButtonElement,
      note: HTMLElement,
      kind: 'serial' | 'bluetooth',
    ) => {
      if (btn.disabled) {
        const reason = unavailableReason(kind);
        btn.title = reason;
        note.textContent = reason;
        note.hidden = false;
        btn.setAttribute('aria-describedby', note.id);
      } else {
        btn.removeAttribute('title');
        btn.removeAttribute('aria-describedby');
        note.textContent = '';
        note.hidden = true;
      }
    };
    explain(this.serialBtn, this.serialNoteEl, 'serial');
    explain(this.bluetoothBtn, this.bluetoothNoteEl, 'bluetooth');
  }

  private async startFlash(): Promise<void> {
    this.flashing = true;
    this.clearFlashError();
    this.setTransportButtonsEnabled(false);
    this.flashBtn.disabled = true;
    this.flashProgressEl.hidden = false;
    this.setFlashProgress({ stage: 'Initializing' });
    try {
      const { flashFirmware } = await import('../flash/Flasher');
      await flashFirmware((p) => this.setFlashProgress(p));
      toast.success(t('flash.success'), 6000);
    } catch (err) {
      this.showFlashError(`${t('flash.failed')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      this.flashing = false;
      this.flashProgressEl.hidden = true;
      this.flashBtn.disabled = false;
      this.setTransportButtonsEnabled(true);
    }
  }

  private setTransportButtonsEnabled(enabled: boolean): void {
    if (enabled) {
      this.syncAvailability();
    } else {
      this.serialBtn.disabled = true;
      this.bluetoothBtn.disabled = true;
    }
    this.mockBtn.disabled = !enabled;
  }

  private setFlashProgress(p: FlashProgress): void {
    const key = STAGE_I18N_KEY[p.stage];
    this.flashProgressLabelEl.textContent = key ? t(key) : p.stage;
    const pct = p.progress !== undefined ? Math.round(p.progress * 100) : null;
    this.flashProgressFillEl.style.width = pct !== null ? `${pct}%` : '30%';
    // Stages without a percentage (connecting, finding the device) are
    // genuinely indeterminate — dropping aria-valuenow says so, rather than
    // claiming the 30% the bar happens to be painting.
    if (pct !== null) {
      this.flashProgressBarEl.setAttribute('aria-valuenow', String(pct));
    } else {
      this.flashProgressBarEl.removeAttribute('aria-valuenow');
    }
  }

  /** Open the modal and resolve with the chosen transport, or null if cancelled. */
  open(): Promise<ConnectRequest | null> {
    this.clearError();
    this.clearFlashError();
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  private async pick(kind: TransportKind): Promise<void> {
    this.clearError();
    try {
      if (kind === 'mock') {
        this.resolveAndClose({
          kind,
          transport: new MockTransport(),
          label: t('connection.mockLabel'),
        });
        return;
      }
      if (kind === 'serial') {
        if (!SerialTransport.isSupported() || isInsecureContext()) {
          this.showError(unavailableReason('serial'));
          return;
        }
        const transport = new SerialTransport();
        // Pre-show the picker BEFORE resolving so we know the user committed.
        // SerialTransport.connect() will trigger requestPort; App.connect() also
        // calls .connect(). Since connect() is idempotent (returns immediately
        // if already connected), this is safe — we delegate to App.
        this.resolveAndClose({ kind, transport, label: 'USB' });
        return;
      }
      if (kind === 'bluetooth') {
        if (!BLUETOOTH_SUPPORTED || isInsecureContext()) {
          this.showError(unavailableReason('bluetooth'));
          return;
        }
        const { BluetoothTransport } = await import('../transport/BluetoothTransport');
        // Same pattern as serial: transport.connect() (triggered by App.connect())
        // is what actually shows the device picker.
        this.resolveAndClose({ kind, transport: new BluetoothTransport(), label: 'Bluetooth' });
        return;
      }
    } catch (err) {
      this.showError(String((err as Error)?.message ?? err));
    }
  }

  private cancel(): void {
    if (this.pendingResolve) {
      const r = this.pendingResolve;
      this.pendingResolve = null;
      r(null);
    }
    this.close();
  }

  private resolveAndClose(req: ConnectRequest): void {
    if (this.pendingResolve) {
      const r = this.pendingResolve;
      this.pendingResolve = null;
      r(req);
    }
    this.close();
  }

  private close(): void {
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
  }

  private showError(msg: string): void {
    this.errorEl.textContent = msg;
    this.errorEl.hidden = false;
  }

  private clearError(): void {
    this.errorEl.textContent = '';
    this.errorEl.hidden = true;
  }

  private showFlashError(msg: string): void {
    this.flashErrorEl.textContent = msg;
    this.flashErrorEl.hidden = false;
  }

  private clearFlashError(): void {
    this.flashErrorEl.textContent = '';
    this.flashErrorEl.hidden = true;
  }
}
