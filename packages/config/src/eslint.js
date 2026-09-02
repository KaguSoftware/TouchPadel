// @touch/config — shared ESLint flat-config presets.
//
// Usage (eslint.config.js in an app/package):
//
//   import { base, react, rtlGuard } from '@touch/config/eslint';
//   export default [...base, ...react]; // rtlGuard is already included in `base`
//
// Plain .js (not .ts) on purpose: ESLint loads this file directly at lint time and
// the monorepo packages ship raw TS with no build step — config must not need one either.

import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * RTL guard — forbid physical CSS properties in JS/TS style objects.
 *
 * The whole product is bilingual EN/AR with full RTL; house rule is CSS logical
 * properties ONLY (marginInlineStart, insetInlineEnd, textAlign: 'start', …).
 * These `no-restricted-syntax` selectors catch the common physical forms when they
 * appear as object property keys (inline `style={{ … }}`, StyleSheet.create,
 * vanilla-extract / CSS-in-JS objects) or as `textAlign: 'left' | 'right'` literals.
 *
 * HISTORY: until 2026-09-02 the identifier-key selector below was built with
 * JSON.stringify, which esquery reads as an EXACT string — it matched nothing,
 * and the rule the whole repo claimed to enforce was inert. It is a /regex/
 * now; apps/mobile pins that with a self-test (src/lib/__tests__/rtlGuard.test.ts).
 *
 * KNOWN LIMITATIONS (documented, accepted):
 *  - Only sees JS/TS ASTs. Plain `.css` / `.scss` files need stylelint
 *    (stylelint-use-logical) — not wired up here.
 *  - Key-name matching is lexical: a non-style object that happens to have a key
 *    named `left`/`right` will false-positive. Suppress locally with
 *    `// eslint-disable-next-line no-restricted-syntax` and a reason.
 *  - Computed keys, spread-in styles, and strings built at runtime
 *    (`style['margin' + side]`) are invisible to it.
 *  - Tailwind/utility class strings (`class="ml-4 text-left"`) are not parsed.
 */
const physicalPropPattern =
  '^(marginLeft|marginRight|paddingLeft|paddingRight|' +
  'borderLeft|borderRight|borderLeftWidth|borderRightWidth|' +
  'borderLeftColor|borderRightColor|borderLeftStyle|borderRightStyle|' +
  'borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|' +
  'left|right)$';

export const rtlGuardRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `Property[key.name=/${physicalPropPattern}/][computed=false]`,
      message:
        'Physical CSS property — use logical properties instead (marginInlineStart, ' +
        'paddingInlineEnd, insetInlineStart, borderStartStartRadius, …). Full RTL is contractual.',
    },
    {
      // Descendant, not child: `textAlign: cond ? 'right' : 'left'` is the same
      // physical alignment with extra steps.
      selector: `Property[key.name='textAlign'] Literal[value=/^(left|right)$/]`,
      message:
        "textAlign: 'left'|'right' is physical — on the web use 'start' | 'end'; in React Native leave it " +
        "unset ('auto' follows the layout direction) or use 'center'. Full RTL is contractual.",
    },
    {
      // `flexDirection: dir === 'rtl' ? 'row-reverse' : 'row'` mirrored rows by
      // hand while the native flag lagged the language. Under a real layout
      // direction a plain 'row' already mirrors, so this shape double-flips.
      selector: `Property[key.name='flexDirection'] ConditionalExpression Literal[value='row-reverse']`,
      message:
        "A direction-conditional 'row-reverse' double-flips: a plain 'row' mirrors under the layout direction.",
    },
    {
      // string-key variant: { 'margin-left': … } / { 'padding-right': … } / { 'text-align': 'left' }
      selector: `Property[key.value=/^(margin-left|margin-right|padding-left|padding-right|border-left|border-right|left|right)$/]`,
      message:
        'Physical CSS property — use logical properties instead (margin-inline-start, ' +
        'padding-inline-end, inset-inline-start, …). Full RTL is contractual.',
    },
  ],
};

/** A config entry applying only the RTL guard (merge-friendly). */
export const rtlGuard = [
  {
    name: '@touch/rtl-guard',
    rules: rtlGuardRules,
  },
];

/** Base: typescript-eslint recommended + repo tweaks + RTL guard. */
export const base = [
  ...tseslint.configs.recommended,
  {
    name: '@touch/base',
    rules: {
      ...rtlGuardRules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    name: '@touch/ignores',
    ignores: ['**/dist/**', '**/build/**', '**/.next/**', '**/.expo/**', '**/node_modules/**'],
  },
];

/** React add-on: hooks rules (for apps/web, apps/operator, apps/mobile, packages/ui). */
export const react = [
  {
    name: '@touch/react',
    files: ['**/*.{jsx,tsx}', '**/*.{js,ts}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];

export default base;
