/**
 * Types for legacy-reports.mjs, so the tests import it under `strict` without
 * `allowJs`. The script is the source of truth.
 */
export const DATA_DIR: string;
export const DEFAULT_VENUE_ID: string;

export interface LegacyReportJson {
  id: string;
  month: string;
  department: string;
  source_file: string;
  repo_file: string;
  /** sha256 of the file as received. */
  sha256: string;
  /** sha256 of the repo copy (docProps/core.xml lastModifiedBy blanked). */
  repo_sha256: string;
  /** sha256 of word/document.xml, the same in both. */
  document_xml_sha256: string;
  docx: { creator: string; lastModifiedBy: null; created: string; modified: string; pages: number; words: number; application: string };
  title_stated: string;
  report_no_stated: string;
  report_no: number | null;
  employee_label_stated: string;
  employee_name: string;
  period_label_stated: string;
  period_stated: string;
  period_from: string;
  period_to: string;
  section_heading_stated: string;
  separator_stated: string;
  summary_stated: string[];
  summary_figures: { position: number; phrase_stated: string; category: string; count: number; percent_stated: string | null }[];
  table: {
    header_stated: string[];
    rows: { position: number; label_stated: string; category: string; count_stated: string; count: number | null; note_stated: string | null }[];
  };
  revenue: { stated: string; amount: number; words_stated: string | null; currency_stated: string | null; approximate: boolean } | null;
  chart: {
    media: string;
    sha256: string;
    read_from: string;
    language: 'en' | 'ar';
    title: string;
    subtitle: string;
    total_line: string;
    caption: string;
    rows: { position: number; label: string; category: string; count: number; percent: string }[];
  };
  logo: { media: string; sha256: string; what: string };
  discrepancies: { code: string; en: string; ar: string }[];
}

export interface LegacyReportsJson {
  _readme: string;
  received: string;
  archive: string;
  categories: Record<string, string>;
  reports: LegacyReportJson[];
}

export type Row = Record<string, string | number | boolean | null>;

export function readReports(): LegacyReportsJson;
export function reportRow(report: LegacyReportJson, venueId: string): Row;
export function figureRows(report: LegacyReportJson, venueId: string): Row[];
export function allRows(venueId?: string): { reports: Row[]; figures: Row[] };
export function migrationRowsSql(venueId?: string): string;
