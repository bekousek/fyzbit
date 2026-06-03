import { settings, type SamplingHz } from '../state/Settings';
import type { Language } from '../i18n/i18n';
import type { ThemePreference } from '../theme/theme';

/**
 * Settings modal — native <dialog> with language/theme/sampling/reset/about.
 * Changes apply immediately. ESC closes the modal (browser-native).
 */
export class SettingsModal {
  private dialog: HTMLDialogElement;
  private langSelect: HTMLSelectElement;
  private samplingSelect: HTMLSelectElement;
  private themeRadios: HTMLInputElement[];

  constructor() {
    // The <dialog> lives at document root (outside #app), so we query against document.
    this.dialog = required<HTMLDialogElement>('#settings-modal', document);
    this.langSelect = required<HTMLSelectElement>('#setting-language', this.dialog);
    this.samplingSelect = required<HTMLSelectElement>('#setting-sampling', this.dialog);
    this.themeRadios = Array.from(
      this.dialog.querySelectorAll<HTMLInputElement>('input[name="theme"]'),
    );

    this.langSelect.addEventListener('change', () => {
      settings.setLanguage(this.langSelect.value as Language);
    });
    this.samplingSelect.addEventListener('change', () => {
      const hz = Number(this.samplingSelect.value) as SamplingHz;
      settings.setSamplingHz(hz);
    });
    this.themeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) settings.setTheme(r.value as ThemePreference);
      });
    });

    required<HTMLButtonElement>('#btn-close-settings', this.dialog).addEventListener(
      'click',
      () => this.close(),
    );

    // Wire the open trigger.
    required<HTMLButtonElement>('#btn-settings', document).addEventListener('click', () =>
      this.open(),
    );

    // Reflect current values into the form on open.
    this.dialog.addEventListener('close', () => this.dialog.returnValue = '');
  }

  open(): void {
    this.syncFromSettings();
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
  }

  close(): void {
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
  }

  private syncFromSettings(): void {
    this.langSelect.value = settings.language;
    this.samplingSelect.value = String(settings.samplingHz);
    const pref = settings.theme;
    this.themeRadios.forEach((r) => {
      r.checked = r.value === pref;
    });
  }
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`SettingsModal: missing element ${selector}`);
  return el;
}
