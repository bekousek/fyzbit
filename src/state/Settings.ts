import type { Language } from '../i18n/i18n';
import { getLanguage, setLanguage as i18nSetLanguage } from '../i18n/i18n';
import type { ThemePreference } from '../theme/theme';
import { getThemePreference, setTheme as themeSetTheme } from '../theme/theme';

export type SamplingHz = 1 | 5 | 10 | 25 | 50;
/** A fixed rate, or "let the sensor decide" (see RECOMMENDED_RATE_HZ). */
export type SamplingSetting = SamplingHz | 'auto';
const VALID_SAMPLING: SamplingHz[] = [1, 5, 10, 25, 50];

const STORAGE_KEY = 'fyzbit.samplingHz';
const DEFAULT_SAMPLING: SamplingSetting = 'auto';
const SAMPLING_CHANGE_EVENT = 'fyzbit:sampling-changed';

let sampling: SamplingSetting = DEFAULT_SAMPLING;

function loadSampling(): SamplingSetting {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SAMPLING;
  if (raw === 'auto') return 'auto';
  const n = Number(raw) as SamplingHz;
  return VALID_SAMPLING.includes(n) ? n : DEFAULT_SAMPLING;
}

export function initSettings(): void {
  sampling = loadSampling();
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

  /** What the user picked: a fixed rate, or "auto". */
  get sampling(): SamplingSetting {
    return sampling;
  },
  setSampling(value: SamplingSetting): void {
    if (value !== 'auto' && !VALID_SAMPLING.includes(value)) return;
    if (value === sampling) return;
    sampling = value;
    localStorage.setItem(STORAGE_KEY, String(value));
    window.dispatchEvent(
      new CustomEvent<SamplingSetting>(SAMPLING_CHANGE_EVENT, { detail: value }),
    );
  },

  onSamplingChange(handler: (value: SamplingSetting) => void): () => void {
    const l = (e: Event) => handler((e as CustomEvent<SamplingSetting>).detail);
    window.addEventListener(SAMPLING_CHANGE_EVENT, l);
    return () => window.removeEventListener(SAMPLING_CHANGE_EVENT, l);
  },
};
