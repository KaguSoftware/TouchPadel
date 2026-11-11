/**
 * The owner-assistant eval scorer (scripts/assistant-eval.mjs), pure: no stack,
 * no model. Also proves both scripts still load under node's strip-only mode.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { scoreCase, stripDates, textHasNumber } from '../scripts/assistant-eval.mjs';

const DB = path.resolve(__dirname, '..');

interface Case {
  id: string;
  kind: string;
  question: string;
  expect: { value?: number; tools_any_of?: string[] };
}
const CASES: Case[] = JSON.parse(readFileSync(path.join(DB, 'tests/assistant-eval/cases.json'), 'utf8')).cases;

const numeric = (truth: number, tools?: string[]): Case => ({
  id: 'x',
  kind: 'numeric',
  question: '',
  expect: { value: truth, ...(tools ? { tools_any_of: tools } : {}) },
});
const ran = (text: string, tools: string[] = []) => ({ text, tools, gate: null });

describe('textHasNumber and dates', () => {
  it('rejects a figure that is only part of the date range', () => {
    expect(textHasNumber('Between 4 and 10 March 2024 there were 7 court bookings', 4)).toBe(false);
    expect(textHasNumber('Between 4 and 10 March 2024 there were 7 court bookings', 10)).toBe(false);
  });
  it('accepts the figure outside the date phrase', () => {
    expect(textHasNumber('There were 4 court bookings between 4 and 10 March 2024', 4)).toBe(true);
    expect(textHasNumber('From 2024-03-04 to 2024-03-10: 4 bookings', 4)).toBe(true);
    expect(textHasNumber('4–10 March: 7 bookings', 4)).toBe(false);
    expect(textHasNumber('March 4 to March 10, 2024: 7 bookings', 4)).toBe(false);
    expect(textHasNumber('2024-03-04: 7 bookings', 4)).toBe(false);
  });
  it('handles Arabic date phrases and digits', () => {
    expect(textHasNumber('من 4 إلى 10 آذار 2024 كان هناك 7 حجوزات', 4)).toBe(false);
    expect(textHasNumber('بين ٤ و١٠ آذار ٢٠٢٤ كان هناك ٧ حجوزات', 10)).toBe(false);
    expect(textHasNumber('كان هناك ٤ حجوزات بين ٤ و١٠ آذار ٢٠٢٤', 4)).toBe(true);
  });
  it('matches large figures in any format', () => {
    for (const t of ['228,000', '228000', '٢٢٨٬٠٠٠']) expect(textHasNumber(`Revenue was ${t} IQD`, 228000)).toBe(true);
    expect(stripDates('x')).toBe('x');
  });
});

describe('tools_any_of is part of the verdict', () => {
  const c = numeric(4, ['report_courts', 'bookings_list']);
  it('fails with the right figure and no expected tool', () => {
    const s = scoreCase(c, ran('There were 4 bookings', ['other_tool']), 4);
    expect(s.pass).toBe(false);
    expect(s.toolHit).toBe(false);
    expect(s.why).toContain('report_courts/bookings_list');
  });
  it('passes when one expected tool ran', () => {
    expect(scoreCase(c, ran('There were 4 bookings', ['bookings_list']), 4).pass).toBe(true);
  });
  it('still fails on a wrong figure with the tool present', () => {
    const s = scoreCase(c, ran('There were 5 bookings', ['bookings_list']), 4);
    expect(s.pass).toBe(false);
    expect(s.why).toContain('truth 4 not in answer');
  });
});

const questionNumbers = (q: string) =>
  [...q.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).matchAll(/\d+/g)].map((m) => Number(m[0]));

describe('every numeric case whose truth collides with its question', () => {
  const colliding = CASES.filter(
    (c) => c.kind === 'numeric' && typeof c.expect.value === 'number' && questionNumbers(c.question).includes(c.expect.value),
  );
  it('exists (guards the filter)', () => expect(colliding.length).toBeGreaterThan(0));
  for (const c of colliding) {
    it(`${c.id}: echoing the question's dates plus a different figure fails`, () => {
      const truth = c.expect.value as number;
      const wrong = truth + 3;
      const range = /[؀-ۿ]/.test(c.question) ? 'بين 4 و10 آذار 2024' : 'Between 4 and 10 March 2024';
      const s = scoreCase(c, ran(`${range}: ${wrong}`, c.expect.tools_any_of ?? []), truth);
      expect(s.pass, c.id).toBe(false);
    });
  }
});

describe('scripts load under node strip-only mode', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--experimental-strip-types', ...args], { cwd: DB, encoding: 'utf8', timeout: 60_000 });
  it('assistant-eval.mjs --check exits 0 without contacting anything', () => {
    const r = run(['scripts/assistant-eval.mjs', '--check']);
    expect(r.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
    expect(r.status, r.stderr).toBe(0);
  });
  it('gate.ts, clean.ts and handles.ts import cleanly', () => {
    for (const f of ['gate', 'clean', 'handles']) {
      const url = path.join(DB, `supabase/functions/_shared/assistant/${f}.ts`);
      const r = run(['--input-type=module', '-e', `await import(${JSON.stringify(url)})`]);
      expect(r.stderr, f).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });
  it('measure-assistant-tokens.mjs does not fall back to raw JSON for clean.ts', () => {
    const r = run(['scripts/measure-assistant-tokens.mjs']);
    expect(r.stdout + r.stderr).not.toContain('could not be imported');
    expect(r.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
  });
});
