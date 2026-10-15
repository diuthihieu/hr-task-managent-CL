/** Limits shared by the AI PDF report dialog, the generator API and the report library. */
export const REPORT_PROMPT_MAX = 4000;
export const REPORT_FILENAME_MAX = 120;
export const REPORT_CHARTS_MAX = 30;
/** One chart snapshot (SVG markup) in a saved report. */
export const REPORT_SVG_MAX = 400_000;
export const REPORT_CONTENT_MAX = 60_000;

/** Safe download name: no path separators or control characters, no extension. */
export function cleanFileName(v: string): string {
  return v
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REPORT_FILENAME_MAX);
}

/** Focus instruction on an AI Narrative widget. */
export const NARRATIVE_PROMPT_MAX = 500;
