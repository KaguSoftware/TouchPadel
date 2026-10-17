/**
 * The one mapping from client-data/padel-monthly-2026/reports.json to the rows
 * of legacy_reports and legacy_report_figures (migration 0331). The loader
 * (scripts/db-legacy-reports.mjs) writes these rows and the tests compare the
 * database against them, so the two can never drift apart. Nothing here
 * computes a figure: every value is copied from the JSON.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client-data', 'padel-monthly-2026');
export const DEFAULT_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';

export function readReports() {
  return JSON.parse(readFileSync(join(DATA_DIR, 'reports.json'), 'utf8'));
}

function notes(report, lang) {
  return report.discrepancies.map((d) => `[${d.code}] ${d[lang]}`).join('\n');
}

export function reportRow(report, venueId) {
  const rev = report.revenue;
  return {
    id: report.id,
    venue_id: venueId,
    department: report.department,
    period_from: report.period_from,
    period_to: report.period_to,
    period_stated: report.period_stated,
    title_stated: report.title_stated,
    report_no: report.report_no,
    report_no_stated: report.report_no_stated,
    employee_name: report.employee_name,
    section_heading_stated: report.section_heading_stated,
    summary_stated: report.summary_stated.join('\n'),
    revenue_amount: rev ? rev.amount : null,
    revenue_stated: rev ? rev.stated : null,
    revenue_words_stated: rev ? rev.words_stated : null,
    revenue_currency_stated: rev ? rev.currency_stated : null,
    revenue_approximate: rev ? rev.approximate : false,
    chart_language: report.chart.language,
    chart_title: report.chart.title,
    chart_subtitle: report.chart.subtitle,
    chart_total_line: report.chart.total_line,
    chart_caption: report.chart.caption,
    review_notes_en: notes(report, 'en'),
    review_notes_ar: notes(report, 'ar'),
    source_file: report.source_file,
    source_sha256: report.sha256,
    source_created_at: report.docx.created,
  };
}

export function figureRows(report, venueId) {
  const base = { report_id: report.id, venue_id: venueId };
  return [
    ...report.table.rows.map((r) => ({
      ...base,
      source: 'table',
      position: r.position,
      category: r.category,
      label_stated: r.label_stated,
      count: r.count,
      count_stated: r.count_stated,
      percent_stated: null,
      note_stated: r.note_stated,
    })),
    ...report.summary_figures.map((f) => ({
      ...base,
      source: 'summary',
      position: f.position,
      category: f.category,
      label_stated: f.phrase_stated,
      count: f.count,
      count_stated: null,
      percent_stated: f.percent_stated,
      note_stated: null,
    })),
    ...report.chart.rows.map((c) => ({
      ...base,
      source: 'chart',
      position: c.position,
      category: c.category,
      label_stated: c.label,
      count: c.count,
      count_stated: null,
      percent_stated: c.percent,
      note_stated: null,
    })),
  ];
}

/** Every row the JSON makes, for one branch. */
export function allRows(venueId = DEFAULT_VENUE_ID) {
  const { reports } = readReports();
  return {
    reports: reports.map((r) => reportRow(r, venueId)),
    figures: reports.flatMap((r) => figureRows(r, venueId)),
  };
}

const sqlValue = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

function insertSql(table, rows, conflict) {
  const cols = Object.keys(rows[0]);
  const values = rows.map((r) => `  (${cols.map((c) => sqlValue(r[c])).join(', ')})`).join(',\n');
  return `insert into ${table} (${cols.join(', ')})\nvalues\n${values}\non conflict ${conflict} do nothing;\n`;
}

/**
 * The body of migration 0348: the same rows the loader writes, as SQL, so the
 * reports reach every database (hosted included) with the deploy. Generated:
 * tests/legacy-reports-source.test.ts fails if the file and this disagree.
 */
export function migrationRowsSql(venueId = DEFAULT_VENUE_ID) {
  const { reports, figures } = allRows(venueId);
  return `${insertSql('legacy_reports', reports, '(id)')}\n${insertSql('legacy_report_figures', figures, '(report_id, source, position)')}`;
}
