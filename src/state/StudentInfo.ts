import type { PdfMetadata } from '../export/pdf';

const STORAGE_KEY = 'fyzbit.studentInfo';

/**
 * Persisted last-used student / class / experiment metadata.
 * Pre-fills the PDF export modal so teachers don't re-type each time.
 */
export const studentInfoStore = {
  load(): PdfMetadata {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<PdfMetadata>;
        return {
          className: parsed.className ?? '',
          students: Array.isArray(parsed.students) ? parsed.students : [],
          experimentTitle: parsed.experimentTitle ?? '',
          notes: parsed.notes ?? '',
        };
      } catch {
        /* fall through to default */
      }
    }
    return { className: '', students: [], experimentTitle: '', notes: '' };
  },

  save(info: PdfMetadata): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  },
};

/**
 * Parse a free-form text input (one name per line, or comma-separated) into a
 * student list. Empty entries are dropped.
 */
export function parseStudents(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
