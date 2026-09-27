/**
 * The replay function's payload mappers and the operator's browser-mode
 * mappers are two transports of ONE payload shape (mutate.ts header). Deno
 * cannot import a workspace package, so the item helpers both use are kept
 * as two copies — pinned here, the way assistant-catalog.test.ts pins the
 * edge copy of tools.ts. Pure: reads the two source files, no stack needed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPERATOR_MUTATE = path.resolve(HERE, '../../../apps/operator/src/lib/mutate.ts');
const REPLAY_INDEX = path.resolve(HERE, '../supabase/functions/replay/index.ts');

/** The helpers the two files must agree on, byte for byte (the doc comment above each may differ). */
const SHARED_HELPERS = ['orderItems', 'refundItems', 'wasteLocation'] as const;

/** `function <name>(` through the first `}` at column 0 — the body, without its doc comment. */
function functionBody(source: string, name: string, file: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${file}: function ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end, `${file}: function ${name} not closed`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

describe('replay ↔ mutate payload helpers', () => {
  const operator = readFileSync(OPERATOR_MUTATE, 'utf8').replace(/\r\n/g, '\n');
  const replay = readFileSync(REPLAY_INDEX, 'utf8').replace(/\r\n/g, '\n');

  for (const name of SHARED_HELPERS) {
    it(`${name}() is byte-identical in apps/operator/src/lib/mutate.ts and functions/replay/index.ts`, () => {
      const a = functionBody(operator, name, 'mutate.ts');
      const b = functionBody(replay, name, 'replay/index.ts');
      expect(a, `${name}() drifted between the operator and the replay function`).toBe(b);
    });
  }

  // Wave 5 §2.8.6: the queued stock.waste names its store only when the
  // payload does, so a queue written before the stores replays unchanged.
  it('wasteLocation() passes p_location when the payload names a store, and nothing when it does not', () => {
    const src = functionBody(replay, 'wasteLocation', 'replay/index.ts');
    const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const wasteLocation = new Function(`${js}\nreturn wasteLocation;`)() as (p: unknown) => Record<string, unknown>;
    expect(wasteLocation({ location: 'bakery' })).toEqual({ p_location: 'bakery' });
    expect(wasteLocation({ location: 'cafe' })).toEqual({ p_location: 'cafe' });
    expect(wasteLocation({})).toEqual({});
    expect(wasteLocation(undefined)).toEqual({});
    for (const [file, source] of [['mutate.ts', operator], ['replay/index.ts', replay]] as const) {
      const start = source.indexOf("'stock.waste':");
      expect(start, `${file}: no stock.waste mapper`).toBeGreaterThan(-1);
      expect(source.slice(start, source.indexOf('}),', start)), file).toContain('...wasteLocation(p)');
    }
  });
});
