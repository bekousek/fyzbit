import { studentInfoStore, parseStudents } from '../state/StudentInfo';
import { exportPdf, type PdfMetadata } from '../export/pdf';
import { findChartCanvas } from '../export/png';
import type { AppState } from '../state/AppState';
import { getLanguage, t } from '../i18n/i18n';

/**
 * Modal that collects PDF metadata (class, students, experiment, notes) before
 * triggering the PDF build. Pre-fills from localStorage so repeat exports are
 * one-click for the teacher.
 */
export class PdfExportModal {
  private dialog: HTMLDialogElement;
  private classInput: HTMLInputElement;
  private studentsInput: HTMLTextAreaElement;
  private experimentInput: HTMLInputElement;
  private notesInput: HTMLTextAreaElement;
  private dateInput: HTMLInputElement;

  constructor(private readonly state: AppState) {
    this.dialog = required<HTMLDialogElement>('#pdf-modal');
    this.classInput = required<HTMLInputElement>('#pdf-class', this.dialog);
    this.studentsInput = required<HTMLTextAreaElement>('#pdf-students', this.dialog);
    this.experimentInput = required<HTMLInputElement>('#pdf-experiment', this.dialog);
    this.notesInput = required<HTMLTextAreaElement>('#pdf-notes', this.dialog);
    this.dateInput = required<HTMLInputElement>('#pdf-date', this.dialog);

    required<HTMLButtonElement>('#btn-close-pdf', this.dialog).addEventListener(
      'click',
      () => this.close(),
    );
    required<HTMLButtonElement>('#btn-pdf-cancel', this.dialog).addEventListener(
      'click',
      () => this.close(),
    );
    required<HTMLButtonElement>('#btn-pdf-download', this.dialog).addEventListener(
      'click',
      () => void this.submit(),
    );
  }

  open(): void {
    const stored = studentInfoStore.load();
    this.classInput.value = stored.className;
    this.studentsInput.value = stored.students.join('\n');
    this.experimentInput.value = stored.experimentTitle;
    this.notesInput.value = stored.notes;
    this.dateInput.value = new Intl.DateTimeFormat(
      getLanguage() === 'cs' ? 'cs-CZ' : 'en-US',
      { dateStyle: 'long' },
    ).format(new Date());

    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
  }

  close(): void {
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
  }

  private async submit(): Promise<void> {
    const metadata: PdfMetadata = {
      className: this.classInput.value.trim(),
      students: parseStudents(this.studentsInput.value),
      experimentTitle: this.experimentInput.value.trim(),
      notes: this.notesInput.value.trim(),
    };
    studentInfoStore.save(metadata);

    const visibleRuns = [
      ...this.state.runs.filter((r) => r.visible),
      ...(this.state.activeRun ? [this.state.activeRun] : []),
    ];
    if (visibleRuns.length === 0) {
      window.alert(t('pdfModal.noDataYet'));
      return;
    }

    const canvas = findChartCanvas(document.getElementById('chart-container'));
    try {
      await exportPdf({
        runs: visibleRuns,
        channels: [...this.state.channels],
        metadata,
        chartCanvas: canvas,
      });
      this.close();
    } catch (err) {
      console.error('[PdfExportModal] generation failed:', err);
      window.alert(`PDF export failed: ${String((err as Error)?.message ?? err)}`);
    }
  }
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`PdfExportModal: missing element ${selector}`);
  return el;
}
