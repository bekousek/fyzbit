import { onLanguageChange, t } from '../i18n/i18n';

/**
 * Help overlay listing keyboard shortcuts. Toggled by `?` key.
 *
 * Renders into a one-shot <dialog> lazily; reuses it after first open.
 */
export class ShortcutsHelp {
  private dialog: HTMLDialogElement | null = null;
  private isOpen = false;

  constructor() {
    onLanguageChange(() => {
      if (this.dialog && this.isOpen) this.populate();
    });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (!this.dialog) this.build();
    this.populate();
    this.dialog!.showModal();
    this.isOpen = true;
  }

  close(): void {
    this.dialog?.close();
    this.isOpen = false;
  }

  private build(): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal shortcuts-help';
    dlg.innerHTML = `
      <div class="modal__form">
        <header class="modal__header">
          <h2 data-i18n="shortcuts.title">Klávesové zkratky</h2>
          <button type="button" class="btn btn--icon" id="btn-close-help" aria-label="Close">✕</button>
        </header>
        <div class="modal__body shortcuts-body">
          <table class="shortcuts-table"></table>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => (this.isOpen = false));
    dlg.querySelector('#btn-close-help')!.addEventListener('click', () => this.close());
    this.dialog = dlg;
  }

  private populate(): void {
    if (!this.dialog) return;
    const table = this.dialog.querySelector<HTMLTableElement>('.shortcuts-table');
    if (!table) return;
    const rows: Array<[string, string]> = [
      ['Space', t('shortcuts.start')],
      ['T', t('shortcuts.tare')],
      ['S', t('shortcuts.save')],
      ['N', t('shortcuts.newRun')],
      ['A + ' + t('shortcuts.click'), t('shortcuts.annotation')],
      ['E', t('shortcuts.exportCsv')],
      ['P', t('shortcuts.exportPdf')],
      ['Esc', t('shortcuts.escape')],
      ['?', t('shortcuts.help')],
    ];
    table.innerHTML = rows
      .map(
        ([key, desc]) =>
          `<tr><th><kbd>${escapeHtml(key)}</kbd></th><td>${escapeHtml(desc)}</td></tr>`,
      )
      .join('');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
