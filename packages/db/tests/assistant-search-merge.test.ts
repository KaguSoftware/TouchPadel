/**
 * searchMerge: the windows of one map entry that rank together read as one
 * passage, without the repeated head and overlap lines.
 */
import { describe, expect, it } from 'vitest';
import { mergeWindows, MAX_WINDOWS_PER_ENTRY, type SearchRow } from '../supabase/functions/_shared/assistant/searchMerge';
import { windowBody } from '../scripts/build-assistant-map.mjs';

const row = (ref: string, snippet: string, score: number, title = 'table t'): SearchRow => ({ kind: 'table', ref, lang: 'en', title, snippet, route: null, score });

describe('mergeWindows', () => {
  it('passes rows without windows through unchanged, in order', () => {
    const rows = [row('table:a', 'one', 0.3), row('table:b', 'two', 0.2)];
    expect(mergeWindows(rows)).toEqual(rows);
  });

  it('joins adjacent windows of a real windowed body back into the original text', () => {
    const lines = ['Head line of the entry.', ...Array.from({ length: 40 }, (_, i) => `column_${i} text not null — ${'z'.repeat(40)}`)];
    const body = lines.join('\n');
    const parts = windowBody(body);
    expect(parts.length).toBeGreaterThan(2);
    const rows = parts.slice(0, 3).map((p, i) => row(i === 0 ? 'table:t' : `table:t~${i + 1}`, p, 0.5 - i * 0.01, `table t (part ${i + 1} of ${parts.length})`));
    const merged = mergeWindows(rows);
    expect(merged).toHaveLength(1);
    const text = merged[0]!.snippet!;
    // nothing repeated, and the lines come back in order
    const got = text.split('\n');
    expect(new Set(got).size).toBe(got.length);
    expect(got).toEqual(lines.slice(0, got.length));
    expect(merged[0]!.ref).toBe('table:t');
    expect(merged[0]!.title).toBe(`table t (parts 1, 2, 3 of ${parts.length})`);
    expect(merged[0]!.score).toBe(0.5);
  });

  it('keeps the entry head once and marks a gap between windows that are not neighbours', () => {
    const merged = mergeWindows([row('table:t', 'Head\na\nb', 0.4, 'table t (part 1 of 5)'), row('table:t~4', 'Head\nx\ny', 0.3, 'table t (part 4 of 5)')]);
    expect(merged[0]!.snippet).toBe('Head\na\nb\n…\nx\ny');
  });

  it('keeps at most MAX_WINDOWS_PER_ENTRY windows, the best ranked', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(n === 1 ? 'table:t' : `table:t~${n}`, `Head\nbody ${n}`, n === 5 ? 0.9 : 0.1 * n, `table t (part ${n} of 5)`));
    const merged = mergeWindows(rows);
    expect(merged).toHaveLength(1);
    expect((merged[0]!.snippet!.match(/body \d/g) ?? []).length).toBe(MAX_WINDOWS_PER_ENTRY);
    expect(merged[0]!.snippet).toContain('body 5');
  });

  it('applies the limit after merging, best score first', () => {
    const rows = [row('table:t', 'Head\na', 0.9), row('table:t~2', 'Head\nb', 0.8), row('table:u', 'u', 0.7), row('table:v', 'v', 0.6)];
    const merged = mergeWindows(rows, 2);
    expect(merged.map((m) => m.ref)).toEqual(['table:t', 'table:u']);
  });
});
