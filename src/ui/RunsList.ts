import type { AppState, Run } from '../state/AppState';
import { onLanguageChange, t } from '../i18n/i18n';
import { markerSvg, shapeForRun } from '../theme/seriesStyles';
import { required } from '../utils/dom';
import { showConfirm } from './Dialog';

/**
 * RunsList — rendered in the right column. One row per run: a labelled
 * checkbox (draw it or not), the run's marker shape as it appears on the
 * chart, the name, and rename / delete buttons.
 *
 * The marker, not a color dot: the chart identifies runs by shape as well as
 * hue (theme/seriesStyles.ts), and the legend has to show the same key.
 * Renaming is a real button rather than double-click alone — a double-click
 * is not reachable from a keyboard.
 */
export class RunsList {
  private host: HTMLUListElement;
  private disposers: Array<() => void> = [];

  constructor(private readonly state: AppState) {
    this.host = required<HTMLUListElement>('#runs-list');

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

    // Index has to match the order Chart.visibleRuns builds — saved runs
    // first, active last — or the marker in the list would name a different
    // shape than the one on the canvas.
    const visible = [...runs.filter((r) => r.visible), ...(active ? [active] : [])];
    const shapeIndex = (run: Run) => Math.max(0, visible.indexOf(run));

    if (active) {
      this.host.appendChild(this.renderRow(active, true, shapeIndex(active)));
    }
    for (const r of runs) {
      this.host.appendChild(this.renderRow(r, false, shapeIndex(r)));
    }
  }

  private renderRow(run: Run, isActive: boolean, index: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'run-row' + (isActive ? ' run-row--active' : '');
    li.dataset.runId = run.id;

    // Visibility checkbox. Its own <label> rather than a bare input: without
    // one a screen reader announces "checkbox, unchecked" and nothing else.
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = run.visible;
    cb.className = 'run-row__cb';
    cb.id = `run-vis-${run.id}`;
    cb.disabled = isActive; // active is always visible
    cb.addEventListener('change', () => {
      this.state.setRunVisible(run.id, cb.checked);
    });
    const cbLabel = document.createElement('label');
    cbLabel.className = 'visually-hidden';
    cbLabel.htmlFor = cb.id;
    cbLabel.textContent = t('runs.toggleVisible', { name: run.name });

    // The run's chart marker, so the list doubles as a colour-free legend.
    const marker = document.createElement('span');
    marker.className = 'run-row__marker';
    marker.innerHTML = markerSvg(shapeForRun(index), run.color);

    const name = document.createElement('span');
    name.className = 'run-row__name';
    name.textContent = run.name + (isActive ? '  •' : '');

    li.append(cb, cbLabel, marker, name);

    if (!isActive) {
      name.title = t('runs.dblclickRename');
      name.addEventListener('dblclick', () => this.beginRename(run.id, name));

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'btn btn--icon btn--sm run-row__action';
      rename.innerHTML = '<span aria-hidden="true">✎</span>';
      const renameLabel = t('runs.rename', { name: run.name });
      rename.setAttribute('aria-label', renameLabel);
      rename.title = renameLabel;
      rename.addEventListener('click', () => this.beginRename(run.id, name));
      li.appendChild(rename);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--icon btn--sm run-row__action run-row__delete';
      del.innerHTML = '<span aria-hidden="true">✕</span>';
      const delLabel = t('runs.deleteNamed', { name: run.name });
      del.setAttribute('aria-label', delLabel);
      del.title = delLabel;
      del.addEventListener('click', () => {
        void showConfirm(t('runs.confirmDelete', { name: run.name }), {
          okLabel: t('runs.delete'),
          danger: true,
        }).then((confirmed) => {
          if (confirmed) this.state.deleteRun(run.id);
        });
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
    input.setAttribute('aria-label', t('runs.rename', { name: original }));
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
