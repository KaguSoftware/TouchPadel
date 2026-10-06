/**
 * The assistant's answer as blocks, no markdown library (the model is told to
 * answer tersely; anything richer is noise): paragraphs, `- ` lists, `1. `
 * lists, `|` pipe tables, `**bold**`. The operator's `parseBlocks` /
 * `renderInline`, with the inline step returning plain segments the screen
 * turns into nested Text. PURE (vitest).
 */

export type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|?\s*$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        if (!TABLE_SEP.test(lines[i]!)) rows.push(splitRow(lines[i]!));
        i += 1;
      }
      if (rows.length > 0) blocks.push({ kind: 'table', header: rows[0]!, rows: rows.slice(1) });
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i]!)) {
        items.push(BULLET.exec(lines[i]!)![1]!);
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (NUMBERED.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED.test(lines[i]!)) {
        items.push(NUMBERED.exec(lines[i]!)![1]!);
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !TABLE_ROW.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !NUMBERED.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'p', lines: para });
  }
  return blocks;
}

function splitRow(line: string): string[] {
  const cells = line.trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Segment {
  text: string;
  bold: boolean;
  /** A figure the gate could not check against this turn's data. */
  unverified: boolean;
}

/**
 * One line as segments: `**bold**` and the unverified figures, matched as the
 * gate reported them (`raw`), longest first so `1,250` is not eaten by `250`,
 * and only on a digit boundary so `12` does not mark the `12` in `120`.
 */
export function splitInline(text: string, unverified: readonly string[]): Segment[] {
  const raws = [...new Set(unverified.filter((r) => r !== ''))].sort((a, b) => b.length - a.length);
  // A digit, or a separator followed by a digit, on either side means the match
  // is part of a longer number; a sentence's trailing comma or full stop is not.
  const markRe =
    raws.length > 0
      ? new RegExp(`(?<!\\d|\\d[.,])(${raws.map(escapeRe).join('|')})(?!\\d|[.,]\\d)`, 'g')
      : null;
  const out: Segment[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (part === '') continue;
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    const inner = bold ? part.slice(2, -2) : part;
    const pieces = markRe ? inner.split(markRe) : [inner];
    pieces.forEach((piece, pi) => {
      if (piece === '') return;
      out.push({ text: piece, bold, unverified: markRe !== null && pi % 2 === 1 });
    });
  }
  return out;
}
