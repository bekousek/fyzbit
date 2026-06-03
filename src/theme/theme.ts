export type ThemePreference = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'fyzbit.theme';
const THEME_CHANGE_EVENT = 'fyzbit:theme-changed';

let preference: ThemePreference = 'auto';
let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function loadPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return 'auto';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
  window.dispatchEvent(
    new CustomEvent<ResolvedTheme>(THEME_CHANGE_EVENT, { detail: resolved }),
  );
}

function detachMediaListener(): void {
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener('change', mediaListener);
    mediaListener = null;
  }
}

function attachMediaListener(): void {
  detachMediaListener();
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaListener = (e: MediaQueryListEvent) => {
    apply(e.matches ? 'dark' : 'light');
  };
  mediaQuery.addEventListener('change', mediaListener);
}

export function initTheme(): { preference: ThemePreference; resolved: ResolvedTheme } {
  preference = loadPreference();
  const resolved = resolve(preference);
  apply(resolved);
  if (preference === 'auto') attachMediaListener();
  return { preference, resolved };
}

export function setTheme(pref: ThemePreference): void {
  preference = pref;
  localStorage.setItem(STORAGE_KEY, pref);
  if (pref === 'auto') attachMediaListener();
  else detachMediaListener();
  apply(resolve(pref));
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolve(preference);
}

export function onThemeChange(handler: (theme: ResolvedTheme) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ResolvedTheme>).detail);
  window.addEventListener(THEME_CHANGE_EVENT, listener);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, listener);
}

/** Read a CSS custom property value from :root. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
