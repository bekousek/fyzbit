import './styles/theme-light.css';
import './styles/theme-dark.css';
import './styles/main.css';

import { initI18n, t } from './i18n/i18n';
import { initTheme } from './theme/theme';
import { initSettings } from './state/Settings';
import { App } from './ui/App';
import { SerialTransport } from './transport/SerialTransport';

initSettings();
initTheme();
initI18n();

const app = new App();
app.start();

// Detect total lack of FyzBit-relevant transports (Web Serial AND Web Bluetooth).
// If neither exists, show a non-dismissable warning banner. We allow Mock to
// still work so demos and screenshots are possible.
const hasSerial = SerialTransport.isSupported();
const hasBluetooth =
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;
if (!hasSerial && !hasBluetooth) {
  showBrowserBanner();
}

function showBrowserBanner(): void {
  const banner = document.createElement('div');
  banner.className = 'browser-warning';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <strong>⚠</strong>
    <span data-i18n="error.browserUnsupported">${t('error.browserUnsupported')}</span>
  `;
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
