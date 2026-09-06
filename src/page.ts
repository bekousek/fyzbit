import './styles/theme-light.css';
import './styles/theme-dark.css';
import './styles/page.css';

import { initTheme } from './theme/theme';

/**
 * Entry point for the static text pages (accessibility statement, privacy,
 * licences, 404).
 *
 * It exists for one reason: the theme lives in a `data-theme` attribute set
 * from a localStorage preference, and the CSP forbids inline scripts, so
 * there is nowhere else to put those three lines. Everything else on those
 * pages is plain HTML — they work with JavaScript switched off, only in the
 * light theme.
 */
initTheme();

// Reflect the app's language choice in the year stamp and nothing else: the
// legal texts themselves are Czech, and saying otherwise in `lang` would make
// a screen reader read them with an English voice.
const yearEl = document.getElementById('current-year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
