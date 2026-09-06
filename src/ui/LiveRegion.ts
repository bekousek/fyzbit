import { required } from '../utils/dom';

/**
 * The app's single polite live region (#a11y-live in index.html).
 *
 * Only *discrete* state changes belong here — connected, recording started,
 * run saved. The streaming value deliberately does not: at up to 50 Hz a
 * screen reader would never finish a sentence. That is also why the big value
 * in the top bar carries no aria-live of its own.
 */
let region: HTMLElement | null = null;
let pending = 0;

export function announce(message: string): void {
  if (!message) return;
  region ??= required('#a11y-live');
  const el = region;
  // Setting the same string twice does not re-announce in most screen
  // readers, so the region is emptied first and refilled on the next frame —
  // the mutation is what they listen for, not the value.
  el.textContent = '';
  if (pending) window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = 0;
    el.textContent = message;
  }, 60);
}
