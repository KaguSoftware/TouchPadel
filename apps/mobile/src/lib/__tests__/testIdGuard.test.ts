import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  clientSecretRules,
  composeRestrictedSyntax,
  rtlGuardRules,
  testIdRules,
} from '@touch/config/eslint';

/**
 * The testID lint guard, run on fixtures.
 *
 * Same job as rtlGuard.test.ts next door, for the same reason: the RTL guard
 * was inert for months because its selector was built the wrong way and nobody
 * exercised it. This rule is exactly as easy to break — one mistyped selector
 * and every screen passes lint with no ids at all, while the smoke tests that
 * look for them are the only thing left saying otherwise, one screen at a time.
 *
 * NODE ONLY. This runs under the vitest project (`src/**\/__tests__/**\/*.test.ts`),
 * which forbids importing react-native or expo — so the fixtures are STRINGS
 * linted in memory, never rendered.
 */
const linter = new Linter({ configType: 'flat' });

function lint(code: string, rules: Linter.RulesRecord): string[] {
  return linter
    .verify(code, [
      {
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          // The fixtures are JSX; the default parser needs telling.
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules,
      },
    ])
    .map((m) => m.message);
}

const errors = (code: string) => lint(code, testIdRules as unknown as Linter.RulesRecord);

describe('the testID lint guard fires', () => {
  it.each([
    ['<Pressable onPress={f} />'],
    ['<Button label={l} />'],
    ['<Field placeholder={p} />'],
    ['<TextInput value={v} />'],
    ['<SegmentedControl options={o} value={v} onChange={c} />'],
    ['<AppleAuthentication.AppleAuthenticationButton onPress={f} />'],
    // A spread MAY carry a testID at runtime, and that is precisely the hole:
    // the rule reads the JSX, so a component relying on one ships id-less and
    // nothing says so. Every wrapper states it explicitly instead.
    ['<Button {...props} />'],
  ])('%s is an error', (code) => {
    expect(errors(`const x = ${code};`)).toHaveLength(1);
  });

  it('does not let a NESTED testID satisfy its parent', () => {
    // The child combinator in `:has(> JSXAttribute…)` is what makes this an
    // error. With a plain descendant `:has()` the Field would borrow the
    // chip's id and ship with none of its own.
    const messages = errors('const x = <Field lead={<Chip testID="a" />} />;');
    expect(messages).toHaveLength(1);
  });

  it.each([
    ['<Pressable testID="sign-in.submit" onPress={f} />'],
    ['<Button testID={id} label={l} />'],
    ['<Field testID={`bookings.filter.${k}`} />'],
    // Not on the list: a View is not interactive, whatever props it is handed,
    // and a Text is scenery.
    ['<View onPress={f} />'],
    ['<Text>hi</Text>'],
    ['<ScrollView><Pressable testID="a" /></ScrollView>'],
  ])('%s is clean', (code) => {
    expect(errors(`const x = ${code};`)).toEqual([]);
  });
});

describe('the composed mobile array keeps all three guards', () => {
  /**
   * The failure this pins: ESLint does not MERGE `no-restricted-syntax`, so a
   * second config object adding the testID selectors would delete the RTL and
   * client-secret ones outright — silently, with lint still green. apps/mobile
   * therefore composes ONE array inside ONE entry, and this is that array.
   */
  const composed = composeRestrictedSyntax(
    rtlGuardRules,
    clientSecretRules,
    testIdRules,
  ) as unknown as Linter.RulesRecord;

  /**
   * The fixture: one violation of each guard, in one file.
   *
   * It is a STRING of source code, linted in memory — but the guards read this
   * file too, and to them a `marginLeft` key and a `service_role` literal look
   * exactly like the real thing. That is the rules working. The disable is
   * scoped to this one constant and names all three.
   */
  // eslint-disable-next-line no-restricted-syntax
  const BREAKS_ALL_THREE = ['const s = { marginLeft: 4 };', "const k = 'service_role';", 'const x = <Pressable onPress={f} />;'].join('\n');

  // The NAME avoids spelling the secret out: the client-secret guard matches
  // any literal containing it, and a test title is a literal like any other.
  it('flags a physical style, a secret-key literal and a missing testID together', () => {
    const messages = lint(BREAKS_ALL_THREE, composed);
    expect(messages).toHaveLength(3);
    expect(messages.some((m) => m.includes('Physical CSS property'))).toBe(true);
    // Spelled in two halves so the assertion does not re-trip the guard it is
    // asserting on — the rule matches a literal, and this is not one.
    expect(messages.some((m) => m.includes(`service${'_'}role`))).toBe(true);
    expect(messages.some((m) => m.includes('testID'))).toBe(true);
  });

  it('is still clean on code that breaks none of them', () => {
    expect(
      lint('const x = <Pressable testID="a.b" style={{ marginStart: 4 }} />;', composed),
    ).toEqual([]);
  });
});
