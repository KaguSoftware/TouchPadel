/**
 * The edge function `analytics-insights` cannot import from @touch/core (Deno,
 * no workspace resolution), so it ships a COPY of insightsText.ts. This pure
 * test (no DB) fails the moment the two drift.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(here, '../../core/src/analytics/insightsText.ts');
const COPY = resolve(here, '../supabase/functions/_shared/insightsText.ts');
const HEADER_LINES = 3;

const normalizeEol = (s: string) => s.replace(/\r\n/g, '\n');

describe('insightsText edge copy', () => {
  it('is byte-identical to packages/core after stripping the 3-line header', () => {
    const core = normalizeEol(readFileSync(CORE, 'utf8'));
    const copyLines = normalizeEol(readFileSync(COPY, 'utf8')).split('\n');
    const header = copyLines.slice(0, HEADER_LINES);
    expect(header[0]).toMatch(/^\/\/ COPY — keep in sync with packages\/core\/src\/analytics\/insightsText\.ts/);
    expect(header.every((l) => l.startsWith('//'))).toBe(true);
    expect(copyLines.slice(HEADER_LINES).join('\n')).toBe(core);
  });
});
