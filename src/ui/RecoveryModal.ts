import type { StoredSession } from '../state/Storage';
import { storage, storedToRun } from '../state/Storage';
import type { AppState, Run } from '../state/AppState';
import type { AutoSave } from '../state/AutoSave';
import { onLanguageChange, t, getLanguage } from '../i18n/i18n';

/**
 * Recovery prompt — shown at startup if a non-empty session is sitting in
 * IndexedDB. Choices: Obnovit (load into AppState) or Zahodit (delete).
 *
 * Hand-built dialog so we don't pollute index.html with another <dialog>.
 */
export class RecoveryModal {
  constructor(
    private readonly state: AppState,
    private readonly autoSave: AutoSave,
  ) {}

  /** Checks storage and, if a session is available, prompts the user. */
  async maybeShow(): Promise<void> {
    const session = await storage.loadSession();
    if (!session) return;
    if (session.runs.length === 0 && session.channels.length === 0) {
      // Empty snapshot — silently clear.
      await storage.clearSession();
      return;
    }
    this.render(session);
  }

  private render(session: StoredSession): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal recovery-modal';
    dlg.setAttribute('aria-labelledby', 'recovery-title');

    const updateLang = onLanguageChange(() => this.populate(dlg, session));
    dlg.addEventListener('close', () => {
      updateLang();
      dlg.remove();
    });

    this.populate(dlg, session);
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  private populate(dlg: HTMLDialogElement, session: StoredSession): void {
    const date = new Intl.DateTimeFormat(getLanguage() === 'cs' ? 'cs-CZ' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(session.updatedAt));
    const pointsTotal = session.runs.reduce((acc, r) => acc + r.times.length, 0);
    const annotationsTotal = session.runs.reduce((acc, r) => acc + r.annotations.length, 0);

    dlg.innerHTML = `
      <div class="modal__form">
        <header class="modal__header">
          <h2 id="recovery-title">${escapeHtml(t('recovery.title'))}</h2>
        </header>
        <div class="modal__body">
          <p>${escapeHtml(t('recovery.description'))}</p>
          <dl class="recovery-summary">
            <dt>${escapeHtml(t('recovery.date'))}</dt><dd>${escapeHtml(date)}</dd>
            <dt>${escapeHtml(t('panel.runs'))}</dt><dd>${session.runs.length}</dd>
            <dt>${escapeHtml(t('recovery.points'))}</dt><dd>${pointsTotal}</dd>
            <dt>${escapeHtml(t('recovery.annotations'))}</dt><dd>${annotationsTotal}</dd>
          </dl>
        </div>
        <footer class="modal__footer">
          <button type="button" class="btn btn--danger" id="btn-discard-session">
            ${escapeHtml(t('recovery.discard'))}
          </button>
          <button type="button" class="btn btn--primary" id="btn-restore-session">
            ${escapeHtml(t('recovery.restore'))}
          </button>
        </footer>
      </div>
    `;

    dlg.querySelector<HTMLButtonElement>('#btn-discard-session')!.addEventListener(
      'click',
      async () => {
        await storage.clearSession();
        dlg.close();
      },
    );
    dlg.querySelector<HTMLButtonElement>('#btn-restore-session')!.addEventListener(
      'click',
      () => {
        const runs: Run[] = session.runs.map(storedToRun);
        this.state.hydrateRuns([...session.channels], runs);
        this.autoSave.adoptSessionId(session.id);
        dlg.close();
      },
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
