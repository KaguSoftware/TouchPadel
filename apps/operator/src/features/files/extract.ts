/**
 * The words in a document, pulled out in the browser so the owner assistant
 * can read the file (0354). The result is gzipped (compress.ts) and stored
 * beside the file as `<id>.txt.gz`; it never travels as plain text.
 *
 *   plain text, CSV, Markdown, JSON, XML: as written;
 *   HTML: the text without the tags;
 *   Word, Excel, PowerPoint (.docx .xlsx .pptx) and OpenDocument (.odt .ods
 *   .odp): the XML inside the ZIP (zip.ts), one paragraph, row or slide line
 *   per line, sheet and slide headings;
 *   PDF: its text layer through pdf.js (loaded only when a PDF is picked),
 *   with a `[page N]` line before each page. A scanned PDF has no text layer
 *   and answers null, like a photo: the file is kept, only its name and note
 *   are readable.
 *
 * Nothing here throws to the caller: a file whose words cannot be read is
 * still stored, without text.
 */
import { readZipTexts } from './zip';

/** 0354 venue_files_text_chk. */
export const TEXT_MAX_CHARS = 500_000;
const PDF_MAX_PAGES = 400;

export type TextKind = 'plain' | 'html' | 'docx' | 'xlsx' | 'pptx' | 'odf' | 'pdf';

const EXT_KIND: Readonly<Record<string, TextKind>> = {
  txt: 'plain', csv: 'plain', tsv: 'plain', md: 'plain', markdown: 'plain', json: 'plain', xml: 'plain', log: 'plain',
  html: 'html', htm: 'html',
  docx: 'docx', docm: 'docx',
  xlsx: 'xlsx', xlsm: 'xlsx',
  pptx: 'pptx',
  odt: 'odf', ods: 'odf', odp: 'odf',
  pdf: 'pdf',
};

export function textKind(name: string, type: string): TextKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const byExt = EXT_KIND[ext];
  if (byExt) return byExt;
  const t = type.toLowerCase();
  if (t === 'application/pdf') return 'pdf';
  if (t === 'text/html') return 'html';
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml') return 'plain';
  return null;
}

// ---------------------------------------------------------------------------
// XML text (pure, node-tested)
// ---------------------------------------------------------------------------

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** Word: the runs' text, tabs and breaks, one paragraph a line. */
export function docxText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<\/w:p>/g;
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else if (m[0] === '<w:tab/>') out += '\t';
    else out += '\n';
  }
  return out;
}

/** PowerPoint and DrawingML: the text runs, one paragraph a line. */
export function drawingText(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>|<\/a:p>/g)) out += m[1] !== undefined ? decodeEntities(m[1]) : '\n';
  return out;
}

/** OpenDocument content.xml: paragraphs and headings a line each. */
export function odfText(xml: string): string {
  const body = xml.replace(/^[\s\S]*?<office:body>/, '');
  return decodeEntities(
    body
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:s(?:\s[^>]*)?\/>/g, ' ')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<\/text:(?:p|h)>/g, '\n')
      .replace(/<\/table:table-cell>/g, '\t')
      .replace(/<\/table:table-row>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, ''),
  );
}

/** A1-style column letters to a 0-based index (A=0, Z=25, AA=26). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(n - 1, 0);
}

export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...(m[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeEntities(t[1] ?? '')).join(''),
  );
}

/** One worksheet as tab-separated rows, empty rows left out. */
export function sheetText(xml: string, shared: readonly string[]): string {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of (row[1] ?? '').matchAll(/<c((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const inner = c[2] ?? '';
      const ref = /\sr="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\st="([a-zA-Z]+)"/.exec(attrs)?.[1];
      const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeEntities(t[1] ?? '')).join('');
      else if (type === 'b' && v !== undefined) value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = decodeEntities(v);
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value.replace(/[\t\r\n]+/g, ' ');
    }
    const line = cells.join('\t').replace(/\t+$/, '');
    if (line.trim()) rows.push(line);
  }
  return rows.join('\n');
}

/** The sheet names in workbook order. */
export function workbookSheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => decodeEntities(m[1] ?? ''));
}

/** `sheet12.xml` → 12, for ordering entries the way the file numbers them. */
function partNumber(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

/** Line endings, trailing spaces and runs of blank lines tidied; capped at TEXT_MAX_CHARS. */
export function tidyText(s: string): string {
  const t = s
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n\t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > TEXT_MAX_CHARS ? t.slice(0, TEXT_MAX_CHARS) : t;
}

// ---------------------------------------------------------------------------
// The formats
// ---------------------------------------------------------------------------

async function officeText(kind: 'docx' | 'xlsx' | 'pptx' | 'odf', buf: Uint8Array): Promise<string | null> {
  if (kind === 'docx') {
    const parts = await readZipTexts(buf, (n) => n === 'word/document.xml');
    return parts?.[0] ? docxText(parts[0].text) : null;
  }
  if (kind === 'pptx') {
    const parts = await readZipTexts(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    if (!parts) return null;
    return parts
      .sort((a, b) => partNumber(a.name) - partNumber(b.name))
      .map((p) => `# Slide ${partNumber(p.name)}\n${drawingText(p.text)}`)
      .join('\n\n');
  }
  if (kind === 'xlsx') {
    const parts = await readZipTexts(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    if (!parts) return null;
    const shared = sharedStrings(parts.find((p) => p.name === 'xl/sharedStrings.xml')?.text ?? '');
    const names = workbookSheetNames(parts.find((p) => p.name === 'xl/workbook.xml')?.text ?? '');
    const sheets = parts.filter((p) => p.name.startsWith('xl/worksheets/')).sort((a, b) => partNumber(a.name) - partNumber(b.name));
    return sheets
      .map((p, i) => `# ${names.length === sheets.length ? names[i] : `Sheet ${partNumber(p.name)}`}\n${sheetText(p.text, shared)}`)
      .join('\n\n');
  }
  const parts = await readZipTexts(buf, (n) => n === 'content.xml');
  return parts?.[0] ? odfText(parts[0].text) : null;
}

/** pdf.js on the main thread: its worker module is put on globalThis, so no Worker is started (the shell loads the app from file://). */
async function pdfText(buf: Uint8Array): Promise<string | null> {
  const g = globalThis as { pdfjsWorker?: unknown };
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    g.pdfjsWorker ? Promise.resolve(g.pdfjsWorker) : import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  g.pdfjsWorker ??= worker;
  const task = pdfjs.getDocument({ data: buf, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    let chars = 0;
    for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES) && chars < TEXT_MAX_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      page.cleanup();
      if (text.trim()) {
        pages.push(`[page ${n}]\n${text}`);
        chars += text.length;
      }
    }
    return pages.length ? pages.join('\n\n') : null;
  } finally {
    // pdf.js 6: the loading task owns the teardown (the document lost destroy()).
    await task.destroy();
  }
}

/** The file's words, tidied, or null when there are none to read. */
export async function extractText(file: File): Promise<string | null> {
  const kind = textKind(file.name, file.type);
  if (!kind) return null;
  try {
    let raw: string | null;
    if (kind === 'plain') raw = await file.text();
    else if (kind === 'html') raw = htmlText(await file.text());
    else {
      const buf = new Uint8Array(await file.arrayBuffer());
      raw = kind === 'pdf' ? await pdfText(buf) : await officeText(kind, buf);
    }
    const text = raw ? tidyText(raw) : '';
    return text ? text : null;
  } catch {
    return null;
  }
}
