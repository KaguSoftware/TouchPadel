/**
 * 0331 legacy_reports: proves client-data/padel-monthly-2026/reports.json
 * against the four original Word files it was built from. Owner call
 * 2026-10-10: zero made-up numbers. So every *_stated string must be a
 * paragraph (or, for a summary phrase, a piece of the summary) of the original,
 * every number must be the digits of the string it came from, and the chart
 * figures (typed from images) must agree with the summary text. Pure: no stack.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, figureRows, readReports, type LegacyReportJson } from '../scripts/lib/legacy-reports.mjs';

/** The entries of a .zip (a .docx), by name: enough of the format for Word files. */
function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every paragraph's text, in document order (table cells included). */
function paragraphs(documentXml: string): string[] {
  const out: string[] = [];
  for (const m of documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const texts = [...m[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decode(t[1] ?? ''));
    out.push(texts.join(''));
  }
  return out;
}

const AR = '٠١٢٣٤٥٦٧٨٩';
const digits = (s: string) => [...s].map((c) => (AR.includes(c) ? String(AR.indexOf(c)) : c)).join('').replace(/[^0-9]/g, '');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const doc = readReports();

describe('0331 legacy reports: the JSON is the original files, nothing added', () => {
  it('holds the four months June to September 2026, padel desk, one writer', () => {
    expect(doc.reports.map((r) => r.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(new Set(doc.reports.map((r) => r.department))).toEqual(new Set(['padel']));
    expect(new Set(doc.reports.map((r) => r.employee_name))).toEqual(new Set(['حسين الصراف']));
  });

  describe.each(doc.reports.map((r) => [r.month, r] as [string, LegacyReportJson]))('%s', (_month, r) => {
    const file = readFileSync(join(DATA_DIR, r.repo_file));
    const zip = unzip(file);
    const paras = paragraphs(zip.get('word/document.xml')!.toString('utf8'));
    const summary = r.summary_stated.join('\n');

    it('is the received file with only the last editor\'s email blanked', () => {
      expect(sha(file)).toBe(r.repo_sha256);
      expect(sha(zip.get('word/document.xml')!)).toBe(r.document_xml_sha256);
      const core = zip.get('docProps/core.xml')!.toString('utf8');
      expect(core).toContain('<cp:lastModifiedBy></cp:lastModifiedBy>');
      expect(core).not.toMatch(/@/);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.sha256).not.toBe(r.repo_sha256);
    });

    it('copies every header string from the file', () => {
      for (const s of [r.title_stated, r.report_no_stated, r.employee_label_stated, r.employee_name,
        r.period_label_stated, r.period_stated, r.section_heading_stated, r.separator_stated]) {
        expect(paras).toContain(s);
      }
      expect(r.report_no).toBe(Number(digits(r.report_no_stated)));
    });

    it('reads the period from what is written, as written', () => {
      const ends = r.period_stated.split('_').map((d) => d.split('/').map((x) => Number(digits(x))));
      expect(ends).toHaveLength(2);
      const iso = ([d, m, y]: number[]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      expect([r.period_from, r.period_to]).toEqual(ends.map(iso));
    });

    it('copies the summary paragraphs, and every summary figure is in them', () => {
      for (const p of r.summary_stated) expect(paras).toContain(p);
      for (const f of r.summary_figures) {
        expect(summary).toContain(f.phrase_stated);
        expect(f.phrase_stated).toContain(String(f.count));
        if (f.percent_stated) expect(f.phrase_stated).toContain(f.percent_stated);
      }
      // Every number in the summary is accounted for by a figure (count or percent).
      const numbers = [...summary.matchAll(/\d+(?:\.\d+)?%?/g)].map((m) => m[0]);
      const used = r.summary_figures.flatMap((f) => [String(f.count), ...(f.percent_stated ? [f.percent_stated] : [])]);
      for (const n of numbers) expect(used).toContain(n);
    });

    it('copies every table cell, and every count is the digits of its cell (blank stays null)', () => {
      for (const h of r.table.header_stated) expect(paras).toContain(h);
      for (const row of r.table.rows) {
        expect(paras).toContain(row.label_stated);
        expect(paras).toContain(row.count_stated);
        if (row.note_stated) expect(paras).toContain(row.note_stated);
        const d = digits(row.count_stated);
        expect(row.count).toBe(d === '' ? null : Number(d));
      }
    });

    it("has a table whose rows add up to the table's own total", () => {
      const total = r.table.rows.find((x) => x.category === 'total')!.count!;
      const rest = r.table.rows.filter((x) => x.category !== 'total').reduce((s, x) => s + (x.count ?? 0), 0);
      expect(rest).toBe(total);
    });

    it('copies the amount of money only where the report gives one', () => {
      if (!r.revenue) {
        expect(paras.some((p) => /مبلغ|الدخل|الدهل|دينار/.test(p))).toBe(false);
        return;
      }
      expect(paras).toContain(r.revenue.stated);
      expect(r.revenue.amount).toBe(Number(digits(r.revenue.stated)));
      if (r.revenue.words_stated) expect(paras).toContain(r.revenue.words_stated);
      if (r.revenue.currency_stated) {
        expect(`${r.revenue.stated} ${r.revenue.words_stated ?? ''}`).toContain(r.revenue.currency_stated);
      }
      expect(r.revenue.approximate).toBe(r.revenue.stated.includes('تقريبا'));
    });

    it('leaves out no paragraph of the file', () => {
      const covered = new Set([
        r.title_stated, r.report_no_stated, r.employee_label_stated, r.employee_name, r.period_label_stated,
        r.period_stated, r.section_heading_stated, r.separator_stated, ...r.summary_stated, ...r.table.header_stated,
        ...r.table.rows.flatMap((x) => [x.label_stated, x.count_stated, x.note_stated ?? '']),
        ...(r.revenue ? [r.revenue.stated, r.revenue.words_stated ?? ''] : []),
      ]);
      expect(paras.filter((p) => p.trim() !== '' && !covered.has(p))).toEqual([]);
    });

    it('names the chart and logo images by their bytes', () => {
      expect(sha(zip.get(r.chart.media)!)).toBe(r.chart.sha256);
      expect(sha(zip.get(r.logo.media)!)).toBe(r.logo.sha256);
      const media = [...zip.keys()].filter((k) => k.startsWith('word/media/')).sort();
      expect(media).toEqual([r.logo.media, r.chart.media].sort());
    });

    it('has chart figures (typed from the image) that match the summary text, category by category', () => {
      for (const c of r.chart.rows.filter((x) => x.category !== 'total')) {
        const s = r.summary_figures.find((f) => f.category === c.category);
        expect(s, `${c.label} has no summary figure`).toBeDefined();
        expect(c.count).toBe(s!.count);
      }
      const chartTotal = r.chart.rows.find((x) => x.category === 'total')!.count;
      expect(chartTotal).toBe(r.table.rows.find((x) => x.category === 'total')!.count);
    });

    it('turns into one figure row per table row, summary figure and chart row', () => {
      const rows = figureRows(r, 'v');
      expect(rows).toHaveLength(r.table.rows.length + r.summary_figures.length + r.chart.rows.length);
      expect(new Set(rows.map((x) => `${x.source}/${x.position}`)).size).toBe(rows.length);
    });
  });
});
