import './styles/theme-light.css';
import './styles/theme-dark.css';
import './styles/main.css';

import { initI18n, t } from './i18n/i18n';
import { initTheme } from './theme/theme';
import { initSettings } from './state/Settings';
import { initUnits } from './units/units';
import { App } from './ui/App';
import { SerialTransport } from './transport/SerialTransport';

initSettings();
initUnits();
initTheme();
initI18n();

const app = new App();
app.start();

// No Web Serial *and* no Web Bluetooth means no micro:bit at all — say so up
// front rather than letting a teacher discover it two clicks in. Mock still
// works, so demos and screenshots remain possible.
//
// Two different causes produce the same missing APIs: a browser that never
// had them, and a page served over plain http (both are gated on a secure
// context). They need different advice, so they get different messages.
const hasSerial = SerialTransport.isSupported();
const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
const insecure = typeof window !== 'undefined' && window.isSecureContext === false;
if (!hasSerial && !hasBluetooth) {
  showBrowserBanner(insecure ? 'error.insecureContext' : 'error.browserUnsupported');
}

function showBrowserBanner(messageKey: string): void {
  const banner = document.createElement('div');
  banner.className = 'browser-warning';
  banner.setAttribute('role', 'alert');
  const icon = document.createElement('strong');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠';
  const text = document.createElement('span');
  text.dataset.i18n = messageKey;
  text.textContent = t(messageKey);
  banner.append(icon, text);
  document.body.prepend(banner);
}

// Convenience: expose for debugging in DevTools.
if (import.meta.env.DEV) {
  (window as unknown as { fyzbit?: { app: App } }).fyzbit = { app };
}

// Register service worker — production only (dev would interfere with HMR).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('[sw] registration failed:', err));
  });
}
