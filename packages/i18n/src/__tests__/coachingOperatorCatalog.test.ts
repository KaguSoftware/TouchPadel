import { describe, expect, it } from 'vitest';
import { coachingGlossary } from '../catalogs/coaching.glossary';
import { wsAr, wsEn } from '../catalogs/ws';

/**
 * The operator's coaching catalogs (`ws.coaching.*`, docs/design/coaching/operator.md
 * §5.20) build from the one coaching glossary (C-30, R55, R72, R81). The Arabic
 * files spell the glossary's words out as literals (the assistant map reads
 * catalog lines as quoted literals), so this test is what keeps them equal.
 */

const g = coachingGlossary.ar;
/** Arabic text without its marks, so «المدرب» and «المدرّب» compare equal. */
const bare = (s: string): string => s.replace(/[ً-ْٰ]/g, '');

function leaves(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leaves(v, [...path, k]),
    );
  }
  return [];
}

const ar = leaves(wsAr.coaching);
const en = leaves(wsEn.coaching);

describe('ws.coaching (operator coaching catalogs)', () => {
  it('names the lesson kinds with the glossary words', () => {
    expect(wsAr.coaching.common.lesson).toBe(g.lesson);
    expect(wsAr.coaching.common.kind.private).toBe(g.privateLesson);
    expect(wsAr.coaching.common.kind.group).toBe(g.groupSession);
    expect(wsAr.coaching.common.kind.course).toBe(g.course);
    expect(wsAr.coaching.common.walkIn).toBe(g.walkIn);
    expect(wsEn.coaching.common.kind.private.toLowerCase()).toBe(coachingGlossary.en.privateLesson);
  });

  it('never uses «درس», «حصة الملعب» or «حصة المدرّب» (R55)', () => {
    const forbidden = ['درس', 'حصة الملعب', 'حصة المدرّب', 'حصص المدرّبين'].map(bare);
    for (const [key, value] of ar) {
      for (const word of forbidden) expect(bare(value), `${key}: ${value}`).not.toContain(word);
    }
  });

  it('calls the cut-off by the glossary word, never «موعد الإغلاق» (R81)', () => {
    for (const [key, value] of ar) expect(value, key).not.toContain('موعد الإغلاق');
    expect(wsAr.coaching.banner.cancelled.under_filled).toContain(g.cutoff);
  });

  it('has the same keys and placeholders in both languages', () => {
    expect(ar.map(([k]) => k)).toEqual(en.map(([k]) => k));
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const enByKey = new Map(en);
    for (const [key, value] of ar) expect(holes(value), key).toEqual(holes(enByKey.get(key) ?? ''));
  });
});
