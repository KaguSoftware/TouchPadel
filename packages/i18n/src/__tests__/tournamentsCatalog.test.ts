import { describe, expect, it } from 'vitest';
import { en } from '../catalogs/en';
import { ar } from '../catalogs/ar';
import { ERROR_CODE_KEYS } from '../errors';

/**
 * The tournaments catalogs (docs/design/tournaments/build-contracts-2026-10-03.md §1.9, §1.11).
 * Parity and placeholders are t.test.ts's; this holds what is the milestone's own: the Arabic
 * reads Arabic, and every code of §1.9 is in the one catalogue with an operator line.
 */

const leaves = (obj: object, prefix = ''): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : leaves(v as object, `${prefix}${k}.`),
  );

const TOURNAMENT_CODES = [
  'TOURNAMENTS_OFF',
  'TOURNAMENT_NOT_FOUND',
  'TOURNAMENT_PUBLISH_REFUSED',
  'TOURNAMENT_NOT_OPEN',
  'TOURNAMENT_FULL',
  'TOURNAMENT_CATEGORY_MISMATCH',
  'TOURNAMENT_ENTRY_NOT_FOUND',
  'TOURNAMENT_ROUNDS_INVALID',
  'TOURNAMENT_SCORE_REFUSED',
  'TOURNAMENT_NOT_PAYABLE',
  'TOURNAMENT_OWED_CHANGED',
  'TOURNAMENT_VIA_EVENTS',
] as const;

describe('tournaments in Arabic', () => {
  const lines = [
    ...leaves(ar.tournaments, 'tournaments.'),
    ...leaves(ar.ws.tournaments, 'ws.tournaments.'),
    ...TOURNAMENT_CODES.map((c) => [`op.errors.${c}`, ar.op.errors[c]] as [string, string]),
    [
      'ws.events.block.conflictKind.match_waiting',
      ar.ws.events.block.conflictKind.match_waiting,
    ] as [string, string],
  ];

  it('is Arabic wherever English has words (placeholders aside)', () => {
    expect(lines.length).toBeGreaterThan(60);
    for (const [key, value] of lines) {
      const words = value.replace(/\{\w+\}/g, '');
      if (/[A-Za-z]{3,}/.test(words)) throw new Error(`${key} reads Latin: ${value}`);
      expect(value, key).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('the 12 tournament codes (§1.9)', () => {
  it.each(TOURNAMENT_CODES)(
    '%s is in ERROR_CODE_KEYS with an op.errors line in both languages',
    (code) => {
      expect(ERROR_CODE_KEYS[code]).toBe(`op.errors.${code}`);
      expect(en.op.errors[code].length).toBeGreaterThan(10);
      expect(ar.op.errors[code].length).toBeGreaterThan(5);
    },
  );
});
