/**
 * The owner assistant's file_read (0354): the gzip text unpacks under a cap,
 * and a window ends on a line break so no line is cut between reads. Pure:
 * no stack.
 */
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { clean, sourceForTool } from '../supabase/functions/_shared/assistant/clean';
import { newHandleTable } from '../supabase/functions/_shared/assistant/handles';
import { toolByName } from '../supabase/functions/_shared/assistant/tools';
import {
  FILE_READ_DEFAULT_CHARS,
  FILE_READ_MAX_CHARS,
  FileTextTooLarge,
  fileWindow,
  gunzipText,
} from '../supabase/functions/_shared/assistant/files';

const gz = (s: string) => new Blob([new Uint8Array(gzipSync(Buffer.from(s, 'utf8')))]);

describe('gunzipText', () => {
  it('unpacks what the operator packed, Arabic included', async () => {
    const text = 'Contract\nعقد توريد المياه\nTerm 12 months';
    expect(await gunzipText(gz(text))).toBe(text);
  });

  it('refuses a body that unpacks past the cap', async () => {
    await expect(gunzipText(gz('x'.repeat(5000)), 1000)).rejects.toBeInstanceOf(FileTextTooLarge);
  });
});

describe('fileWindow', () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1} of the price list`);
  const text = lines.join('\n');

  it('reads from the start by default and says where to go on', () => {
    const w = fileWindow(text);
    expect(w.offset).toBe(0);
    expect(w.total_chars).toBe(text.length);
    expect(w.end).toBeLessThanOrEqual(FILE_READ_DEFAULT_CHARS);
    expect(w.next_offset).toBe(w.end);
    // Ended on a line break: the last line is whole.
    expect(text[w.end - 1]).toBe('\n');
    expect(w.lines[0]).toBe('line 1 of the price list');
    expect(w.lines.at(-1)).toMatch(/^line \d+ of the price list$/);
  });

  it('pages through the whole text with no line lost or doubled', () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const w = fileWindow(text, offset, 5000);
      seen.push(...w.lines);
      offset = w.next_offset;
    }
    expect(seen).toEqual(lines);
  });

  it('clamps the window and drops blank lines', () => {
    const w = fileWindow('a\n\n\n  \nb\n', -5, 10_000_000);
    expect(w.offset).toBe(0);
    expect(w.lines).toEqual(['a', 'b']);
    expect(w.next_offset).toBeNull();
    expect(fileWindow(text, 0, 10_000_000).end).toBeLessThanOrEqual(FILE_READ_MAX_CHARS);
    expect(fileWindow('short', 99).lines).toEqual([]);
  });

  it('goes through clean(): one row per line, phone numbers pseudonymised', () => {
    const spec = toolByName('file_read')!;
    const w = fileWindow('Water supplier\nCall 07701234567 to order\nPrice 2500 IQD a case');
    const cleaned = clean(sourceForTool(spec), {
      file: { name: 'Water.pdf', size_kb: 12 },
      total_chars: w.total_chars,
      offset: w.offset,
      next_offset: w.next_offset,
      lines: w.lines.map((text) => ({ text })),
    }, { tz: 'Asia/Baghdad', lang: 'en', handles: newHandleTable(null), cap: w.lines.length });
    expect(cleaned.text).toContain('Water supplier');
    expect(cleaned.text).toContain('Price 2500 IQD a case');
    expect(cleaned.text).not.toContain('07701234567');
    expect(cleaned.numbers).toContain(2500);
  });
});
