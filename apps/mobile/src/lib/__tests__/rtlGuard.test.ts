import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { rtlGuardRules } from '@touch/config/eslint';

/**
 * The RTL lint guard, run on fixtures.
 *
 * From day 1 to 2026-09-02 the guard's identifier-key selector was built with
 * JSON.stringify, which esquery reads as an EXACT string: `marginLeft`, `left`,
 * `borderTopLeftRadius`… were never flagged anywhere in the repo while every
 * document claimed they were. A rule nobody exercises can die silently; this
 * keeps it honest.
 */
const linter = new Linter({ configType: 'flat' });

function errors(code: string): string[] {
  return linter
    .verify(code, [
      {
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: rtlGuardRules as unknown as Linter.RulesRecord,
      },
    ])
    .map((m) => m.message);
}

describe('the RTL lint guard fires', () => {
  it.each([
    ['const s = { marginLeft: 4 };', 1],
    ['const s = { left: 0 };', 1],
    ['const s = { borderTopLeftRadius: 2 };', 1],
    ["const s = { textAlign: 'left' };", 1],
    ["const s = { textAlign: c ? 'right' : 'left' };", 2],
    ["const s = { flexDirection: c ? 'row-reverse' : 'row' };", 1],
    ["const s = { 'margin-left': 4 };", 1],
  ])('%s → %i error(s)', (code, count) => {
    expect(errors(code)).toHaveLength(count);
  });

  it.each([
    ['const s = { paddingStart: 4, marginEnd: 2, start: 0, end: 0 };'],
    ["const s = { textAlign: 'center' };"],
    ["const s = { flexDirection: 'row-reverse' };"],
    ["const s = { alignItems: 'flex-start', alignSelf: 'flex-end' };"],
    ["const s = { writingDirection: 'ltr' };"],
  ])('%s is clean', (code) => {
    expect(errors(code)).toEqual([]);
  });
});
