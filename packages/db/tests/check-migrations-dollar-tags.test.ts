/**
 * The migration gate's lexer must skip every dollar-quoted body, including the
 * repo's own `$<name>_<NNNN>$` tags (brooks audit 2026-11-07, db.md). Its old
 * pattern `^\$[A-Za-z_]*\$` never matched a tag with digits, so plpgsql and DO
 * bodies were read as DDL (9 false findings across the history). The
 * statement splitter is not exported (the script runs on import), so this
 * holds its pattern to fn-signatures.mjs's, which the gate's comment calls the
 * same scan. Pure, always runs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripSqlNoise } from '../scripts/lib/fn-signatures.mjs';

const source = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** The regex literal the scanner matches a dollar tag with. */
function dollarTagPattern(src: string): RegExp {
  const m = src.match(/const dq = ch === '\$' \? sql\.slice\([^)]*\)\.match\(\/(.+?)\/\)/);
  if (!m?.[1]) throw new Error('dollar-tag match not found');
  return new RegExp(m[1]);
}

describe('check-migrations.mjs dollar tags', () => {
  const gate = dollarTagPattern(source('../scripts/check-migrations.mjs'));
  const lib = dollarTagPattern(source('../scripts/lib/fn-signatures.mjs'));

  it('is the fn-signatures.mjs pattern', () => {
    expect(gate.source).toBe(lib.source);
  });

  it('matches a tag with digits, a plain tag and $$, never a positional parameter', () => {
    expect('$override_0049$ begin'.match(gate)?.[0]).toBe('$override_0049$');
    expect('$body$ x'.match(gate)?.[0]).toBe('$body$');
    expect('$$ x'.match(gate)?.[0]).toBe('$$');
    expect('$1 + 2'.match(gate)).toBeNull();
  });

  it('agrees with the scan it mirrors: DDL inside a digit-tagged body is not DDL', () => {
    const sql = `do $ddl_0027$ begin alter table t add constraint c check (true); end $ddl_0027$;`;
    expect(stripSqlNoise(sql)).not.toMatch(/add constraint/);
  });
});
