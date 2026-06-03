/**
 * Tiny toast manager. No deps.
 *
 *   toast.show('Něco se pokazilo', 'error');
 *   const id = toast.show('Načítám…', 'info', 0);  // persistent
 *   toast.dismiss(id);
 *
 * Toasts stack at bottom-right and auto-dismiss after `durationMs` (default 4 s).
 * `duration: 0` keeps the toast until explicitly dismissed.
 */

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

let host: HTMLDivElement | null = null;
let nextId = 1;

function getHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

export const toast = {
  show(message: string, kind: ToastKind = 'info', durationMs = 4000): number {
    const h = getHost();
    const id = nextId++;
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.dataset.toastId = String(id);
    el.innerHTML = `
      <span class="toast__msg"></span>
      <button type="button" class="toast__close" aria-label="Dismiss">✕</button>
    `;
    const msgEl = el.querySelector<HTMLElement>('.toast__msg');
    if (msgEl) msgEl.textContent = message;
    el.querySelector<HTMLButtonElement>('.toast__close')!.addEventListener(
      'click',
      () => this.dismiss(id),
    );
    h.appendChild(el);
    // Animate in.
    requestAnimationFrame(() => el.classList.add('toast--shown'));
    if (durationMs > 0) {
      window.setTimeout(() => this.dismiss(id), durationMs);
    }
    return id;
  },

  dismiss(id: number): void {
    if (!host) return;
    const el = host.querySelector<HTMLElement>(`[data-toast-id="${id}"]`);
    if (!el) return;
    el.classList.remove('toast--shown');
    el.classList.add('toast--leaving');
    window.setTimeout(() => el.remove(), 200);
  },

  /** Convenience helpers. */
  info(msg: string, durationMs?: number): number {
    return this.show(msg, 'info', durationMs);
  },
  success(msg: string, durationMs?: number): number {
    return this.show(msg, 'success', durationMs);
  },
  warn(msg: string, durationMs?: number): number {
    return this.show(msg, 'warn', durationMs);
  },
  error(msg: string, durationMs?: number): number {
    return this.show(msg, 'error', durationMs);
  },
};
