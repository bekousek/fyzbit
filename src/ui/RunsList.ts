import type { AppState, Run } from '../state/AppState';
import { onLanguageChange, t } from '../i18n/i18n';

/**
 * RunsList — rendered in the right column. Lists saved runs with a checkbox
 * (visible toggle), a color dot, an editable name (double-click), and a small
 * delete button. Empty state when no saved runs.
 */
export class RunsList {
  private host: HTMLUListElement;
  private newBtn: HTMLButtonElement;
  private disposers: Array<() => void> = [];

  constructor(private readonly state: AppState) {
    this.host = required<HTMLUListElement>('#runs-list');
    this.newBtn = required<HTMLButtonElement>('#btn-new-run');

    this.disposers.push(
      this.state.bus.on('runs-changed', () => this.render()),
      this.state.bus.on('active-run-changed', () => this.render()),
      onLanguageChange(() => this.render()),
    );
    this.render();
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  setNewRunEnabled(enabled: boolean): void {
    this.newBtn.disabled = !enabled;
  }

  private render(): void {
    const runs = [...this.state.runs];
    const active = this.state.activeRun;

    this.host.innerHTML = '';
    if (runs.length === 0 && !active) {
      const li = document.createElement('li');
      li.className = 'runs-list__empty';
      li.textContent = t('runs.empty');
      this.host.appendChild(li);
      return;
    }

    if (active) {
      this.host.appendChild(this.renderRow(active, /* isActive */ true));
    }
    for (const r of runs) {
      this.host.appendChild(this.renderRow(r, /* isActive */ false));
    }
  }

  private renderRow(run: Run, isActive: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'run-row' + (isActive ? ' run-row--active' : '');
    li.dataset.runId = run.id;

    // Visibility checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = run.visible;
    cb.className = 'run-row__cb';
    cb.disabled = isActive; // active is always visible
    cb.addEventListener('change', () => {
      this.state.setRunVisible(run.id, cb.checked);
    });

    // Color dot
    const dot = document.createElement('span');
    dot.className = 'run-row__dot';
    dot.style.background = run.color;
    dot.setAttribute('aria-hidden', 'true');

    // Name (double-click to edit)
    const name = document.createElement('span');
    name.className = 'run-row__name';
    name.textContent = run.name + (isActive ? '  •' : '');
    name.title = t('runs.dblclickRename');
    if (!isActive) {
      name.addEventListener('dblclick', () => this.beginRename(run.id, name));
    }

    li.append(cb, dot, name);

    if (!isActive) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--icon btn--sm run-row__delete';
      del.textContent = '✕';
      del.setAttribute('aria-label', t('runs.delete'));
      del.title = t('runs.delete');
      del.addEventListener('click', () => {
        if (confirm(t('runs.confirmDelete', { name: run.name }))) {
          this.state.deleteRun(run.id);
        }
      });
      li.appendChild(del);
    }

    return li;
  }

  private beginRename(runId: string, span: HTMLElement): void {
    const original = span.textContent ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.className = 'run-row__rename';
    span.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const newName = input.value.trim();
      if (newName) this.state.renameRun(runId, newName);
      // render() will rebuild rows.
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit();
      } else if (e.key === 'Escape') {
        input.value = original;
        commit();
      }
    });
  }
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`RunsList: missing element ${selector}`);
  return el;
}
