import type { Transport, TransportKind } from '../transport/Transport';
import { MockTransport } from '../transport/MockTransport';
import { SerialTransport } from '../transport/SerialTransport';
import { t, onLanguageChange } from '../i18n/i18n';

export type ConnectRequest = {
  kind: TransportKind;
  transport: Transport;
  /** Human label shown in the status badge (e.g., "USB", "Mock"). */
  label: string;
};

/**
 * ConnectionModal — lets the user pick a transport. Web Bluetooth option is
 * shown but disabled until M9. Errors during transport selection (user
 * cancelled, browser unsupported) are surfaced inside the modal, not as toasts.
 */
export class ConnectionModal {
  private dialog: HTMLDialogElement;
  private errorEl: HTMLElement;
  private serialBtn: HTMLButtonElement;
  private mockBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private pendingResolve: ((req: ConnectRequest | null) => void) | null = null;

  constructor() {
    this.dialog = required<HTMLDialogElement>('#connection-modal');
    this.errorEl = required<HTMLElement>('#connection-error', this.dialog);
    this.serialBtn = required<HTMLButtonElement>('#btn-connect-serial', this.dialog);
    this.mockBtn = required<HTMLButtonElement>('#btn-connect-mock', this.dialog);
    this.closeBtn = required<HTMLButtonElement>('#btn-close-connection', this.dialog);

    if (!SerialTransport.isSupported()) {
      this.serialBtn.disabled = true;
      this.serialBtn.title = t('connection.unsupportedBrowser');
    }

    this.serialBtn.addEventListener('click', () => {
      void this.pick('serial');
    });
    this.mockBtn.addEventListener('click', () => {
      void this.pick('mock');
    });
    this.closeBtn.addEventListener('click', () => this.cancel());
    this.dialog.addEventListener('cancel', () => this.cancel());

    onLanguageChange(() => {
      if (this.serialBtn.disabled) {
        this.serialBtn.title = t('connection.unsupportedBrowser');
      }
    });
  }

  /** Open the modal and resolve with the chosen transport, or null if cancelled. */
  open(): Promise<ConnectRequest | null> {
    this.clearError();
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
          label: 'Mock (Teploměr)',
        });
        return;
      }
      if (kind === 'serial') {
        if (!SerialTransport.isSupported()) {
          this.showError(t('connection.unsupportedBrowser'));
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
      // Bluetooth not yet implemented.
      this.showError('Bluetooth not implemented yet.');
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
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`ConnectionModal: missing element ${selector}`);
  return el;
}
