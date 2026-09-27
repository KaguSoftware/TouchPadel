/**
 * The edge function `analytics-insights` cannot import from @touch/core (Deno,
 * no workspace resolution), so it ships COPIES of the zero-import modules it
 * shares with the operator: insightsText.ts (the post-model gates) and
 * insightsContract.ts (the payload types and the floors). This pure test (no
 * DB) fails the moment a copy drifts from its source.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const HEADER_LINES = 3;
const SHARED = ['insightsText', 'insightsContract'] as const;

const normalizeEol = (s: string) => s.replace(/\r\n/g, '\n');

describe.each(SHARED)('%s edge copy', (name) => {
  const CORE = resolve(here, `../../core/src/analytics/${name}.ts`);
  const COPY = resolve(here, `../supabase/functions/_shared/${name}.ts`);

  it('is byte-identical to packages/core after stripping the 3-line header', () => {
    const core = normalizeEol(readFileSync(CORE, 'utf8'));
    const copyLines = normalizeEol(readFileSync(COPY, 'utf8')).split('\n');
    const header = copyLines.slice(0, HEADER_LINES);
    expect(header[0]).toMatch(new RegExp(`^// COPY — keep in sync with packages/core/src/analytics/${name}\\.ts`));
    expect(header.every((l) => l.startsWith('//'))).toBe(true);
    expect(copyLines.slice(HEADER_LINES).join('\n')).toBe(core);
  });

  it('has zero imports, so the copy can never drift through a dependency', () => {
    const src = normalizeEol(readFileSync(CORE, 'utf8'));
    expect(src).not.toMatch(/^\s*import\b/m);
  });
});
