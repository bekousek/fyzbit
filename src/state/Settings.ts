import type { Language } from '../i18n/i18n';
import { getLanguage, setLanguage as i18nSetLanguage } from '../i18n/i18n';
import type { ThemePreference } from '../theme/theme';
import { getThemePreference, setTheme as themeSetTheme } from '../theme/theme';

export type SamplingHz = 1 | 5 | 10 | 25 | 50;
const VALID_SAMPLING: SamplingHz[] = [1, 5, 10, 25, 50];

const STORAGE_KEY = 'fyzbit.samplingHz';
const DEFAULT_SAMPLING: SamplingHz = 10;
const SAMPLING_CHANGE_EVENT = 'fyzbit:sampling-changed';

let samplingHz: SamplingHz = DEFAULT_SAMPLING;

function loadSampling(): SamplingHz {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SAMPLING;
  const n = Number(raw) as SamplingHz;
  return VALID_SAMPLING.includes(n) ? n : DEFAULT_SAMPLING;
}

export function initSettings(): void {
  samplingHz = loadSampling();
}

export const settings = {
  get language(): Language {
    return getLanguage();
  },
  setLanguage(lang: Language): void {
    i18nSetLanguage(lang);
  },

  get theme(): ThemePreference {
    return getThemePreference();
  },
  setTheme(pref: ThemePreference): void {
    themeSetTheme(pref);
  },

  get samplingHz(): SamplingHz {
    return samplingHz;
  },
  setSamplingHz(hz: SamplingHz): void {
    if (!VALID_SAMPLING.includes(hz)) return;
    if (hz === samplingHz) return;
    samplingHz = hz;
    localStorage.setItem(STORAGE_KEY, String(hz));
    window.dispatchEvent(new CustomEvent<SamplingHz>(SAMPLING_CHANGE_EVENT, { detail: hz }));
  },

  onSamplingChange(handler: (hz: SamplingHz) => void): () => void {
    const l = (e: Event) => handler((e as CustomEvent<SamplingHz>).detail);
    window.addEventListener(SAMPLING_CHANGE_EVENT, l);
    return () => window.removeEventListener(SAMPLING_CHANGE_EVENT, l);
  },
};
