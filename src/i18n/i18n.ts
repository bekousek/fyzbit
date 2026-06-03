import csMessages from './cs.json';
import enMessages from './en.json';

export type Language = 'cs' | 'en';

type MessageTree = { [key: string]: string | MessageTree };

const MESSAGES: Record<Language, MessageTree> = {
  cs: csMessages as MessageTree,
  en: enMessages as MessageTree,
};

const STORAGE_KEY = 'fyzbit.language';
const LANG_CHANGE_EVENT = 'fyzbit:language-changed';

let currentLanguage: Language = 'cs';

function detectLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'cs' || stored === 'en') return stored;
  const nav = navigator.language.toLowerCase();
  return nav.startsWith('cs') || nav.startsWith('sk') ? 'cs' : 'en';
}

function resolve(tree: MessageTree, path: string): string | undefined {
  const parts = path.split('.');
  let cursor: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = cursor[part];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{{${key}}}`,
  );
}

export function t(key: string, params?: Record<string, string | number>): string {
  const msg =
    resolve(MESSAGES[currentLanguage], key) ?? resolve(MESSAGES.cs, key) ?? key;
  return interpolate(msg, params);
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  if (lang === currentLanguage) return;
  currentLanguage = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.setAttribute('lang', lang);
  applyTranslations(document);
  window.dispatchEvent(new CustomEvent<Language>(LANG_CHANGE_EVENT, { detail: lang }));
}

export function onLanguageChange(handler: (lang: Language) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<Language>).detail);
  window.addEventListener(LANG_CHANGE_EVENT, listener);
  return () => window.removeEventListener(LANG_CHANGE_EVENT, listener);
}

/**
 * Replace text/attrs of nodes carrying data-i18n* attributes within `root`.
 * - data-i18n="key"            → textContent
 * - data-i18n-placeholder="k"  → placeholder
 * - data-i18n-title="k"        → title
 * - data-i18n-aria-label="k"   → aria-label
 */
export function applyTranslations(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key && 'placeholder' in el) {
      (el as HTMLInputElement).placeholder = t(key);
    }
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    const key = el.dataset.i18nAriaLabel;
    if (key) el.setAttribute('aria-label', t(key));
  });
}

export function initI18n(): Language {
  currentLanguage = detectLanguage();
  document.documentElement.setAttribute('lang', currentLanguage);
  applyTranslations(document);
  return currentLanguage;
}

/** Locale-aware number formatter. CZ → comma decimal, EN → dot decimal. */
export function formatNumber(
  value: number,
  fractionDigits = 1,
): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(currentLanguage === 'cs' ? 'cs-CZ' : 'en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** CSV decimal — comma in CZ, dot in EN. Used by exporter (M7). */
export function csvDecimal(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return '';
  const fixed = value.toFixed(fractionDigits);
  return currentLanguage === 'cs' ? fixed.replace('.', ',') : fixed;
}
