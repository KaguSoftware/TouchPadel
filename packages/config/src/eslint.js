// @touch/config — shared ESLint flat-config presets.
//
// Usage (eslint.config.js in an app/package):
//
//   import { base, react, clientSecrets } from '@touch/config/eslint';
//   export default [...base, ...react, ...clientSecrets];
//
// `no-restricted-syntax` is NOT merged by ESLint — the last entry to define it
// wins outright — so a package wanting several of these guards at once composes
// ONE array with `composeRestrictedSyntax(rtlGuardRules, clientSecretRules,
// testIdRules)` inside a single config object, never one object per guard.
//
// `rtlGuard` is already included in `base`. `clientSecrets` is opt-in and belongs
// on every package that ships to a browser, a phone or a renderer process.
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

/**
 * Client-secret guard — Security Layer 1, Block 2 "Secrets".
 *
 * The service_role key bypasses RLS entirely: it is the whole database, every
 * guest record, every payment row, with no policy in front of it. It has
 * exactly one legitimate home — a server the guest cannot read (an edge
 * function, a CI job, packages/db tooling).
 *
 * The failure mode this catches is not malice, it is convenience. A developer
 * debugging why a query returns nothing swaps the anon key for the service_role
 * key, the query works, and the line ships. In a browser or a phone bundle that
 * key is then readable by anyone who opens devtools — and because the code
 * around it looks completely ordinary, review does not catch it.
 *
 * So it is a lint error in every client package. The selectors match the
 * string, the template literal, and the conventional env-var names, because
 * those are the three shapes it actually arrives in. What they cannot see is a
 * value assembled at runtime or read from a variable named something else —
 * which is why scripts/security/check-artifact-secrets.mjs scans the BUILT
 * bundle as well. Lint catches the intent; the artifact scan catches the result.
 */
export const clientSecretRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `Literal[value=/service_role|sb_secret_/]`,
      message:
        'service_role / sb_secret_ must never appear in client code — it bypasses RLS and ships to the browser. ' +
        'Use the anon (publishable) key, or move the call to an edge function.',
    },
    {
      selector: `TemplateElement[value.raw=/service_role|sb_secret_/]`,
      message:
        'service_role / sb_secret_ must never appear in client code — it bypasses RLS and ships to the browser. ' +
        'Use the anon (publishable) key, or move the call to an edge function.',
    },
    {
      // process.env.SUPABASE_SERVICE_ROLE_KEY and friends. In a client package
      // the READ is the bug, whatever the value turns out to be at runtime.
      selector: `MemberExpression[property.name=/SERVICE_ROLE|SB_SECRET/i]`,
      message:
        'Reading a service_role / secret key in client code. That value has no safe use here; ' +
        'move the work behind an edge function.',
    },
    {
      selector: `Property[key.name=/SERVICE_ROLE|SB_SECRET/i]`,
      message: 'A service_role / secret key must not be configured in a client package.',
    },
  ],
};

/**
 * Test-ID guard — every interactive element carries a `testID`.
 *
 * apps/mobile had ZERO testIDs and zero component tests until 2026-09-21
 * (Phase 2 Milestone 0 item 11). The smoke tests added with them find a screen's
 * primary action by id, so an id that is quietly dropped in a refactor does not
 * fail loudly — the test just stops asserting anything real, and the next one
 * written copies the omission. This makes the omission a lint error at the
 * moment it is typed.
 *
 * WHAT IS LISTED. The React Native primitives that take a press or hold text
 * (`Pressable`, the three `Touchable*`, `TextInput`, `Switch`) plus the app's
 * own wrappers around them. Every wrapper on the list forwards `testID`
 * EXPLICITLY to the element underneath (`testID={testID}`), never via a
 * `{...props}` spread — this rule reads the JSX, so a spread satisfies nothing
 * and a component that relied on one would ship id-less.
 *
 * WHAT IS NOT, and why:
 *  - Alerts that `return null` (`ConfirmAlert`, `ErrorAlert`, `NoticeSheet`):
 *    they render no node, they ask the OS to present one.
 *  - `NativeTabs.Trigger` and the SwiftUI country sheet: configuration for a
 *    control UIKit draws outside the React tree — no node, nothing to name.
 *  - Containers (`ScrollView`, `FlatList`, `RefreshControl`) and drawings
 *    (icons, `Court3D`, `CourtIllustration`, `BrandPattern`, `LogoMark`,
 *    `SmileyBall`): a test presses actions, not scenery.
 *
 * THE CHILD COMBINATOR IS LOAD-BEARING. `:has(> JSXAttribute…)` means an id on
 * THIS element. Plain `:has(…)` is a descendant match, so
 * `<Field lead={<Chip testID="x" />} />` would satisfy the Field — the parent
 * would pass on its child's id and the field itself would have none.
 */
const testIdElements = [
  // react-native primitives
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TextInput',
  'Switch',
  // apps/mobile wrappers (src/components/**, and the route-local ones)
  'Button',
  'Field',
  'LinkText',
  'FooterLink',
  'SegmentedControl',
  'CodeInput',
  'PhoneField',
  'GoogleButton',
  'AppleButton',
  'SocialSignInBlock',
  'MenuRow',
  'FilterChip',
  'DayChip',
  'SlotCell',
  'UpcomingBookingRow',
  'PastBookingRow',
  'NextUpCard',
  'HeldSlotCard',
  'ErrorState',
  'EmptyState',
  'BookingSheet',
  'DegradedBanner',
  'CapsuleControl',
  'PlayersChip',
  'CountryRow',
].join('|');

const TEST_ID_MESSAGE =
  'Interactive element without a testID. Name it `<route>.<element>` (kebab-case, dots between ' +
  'segments — `sign-in.submit`, `bookings.filter.upcoming`); a list row appends its entity id. ' +
  'A shared component takes `testID?: string` and forwards it explicitly — a {...spread} does not count.';

const TEST_ID_UNDEFINED_MESSAGE =
  'testID={undefined} is no testID. A wrapper that derives child ids from its own takes ' +
  '`testID: string` (required) and passes `${testID}.<child>` unconditionally; the old ' +
  '`testID={testID ? … : undefined}` idiom shipped id-less controls whenever a caller forgot the prop.';

export const testIdRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        `JSXOpeningElement[name.name=/^(${testIdElements})$/]` +
        `:not(:has(> JSXAttribute[name.name="testID"]))`,
      message: TEST_ID_MESSAGE,
    },
    {
      // `<AppleAuthentication.AppleAuthenticationButton …>` — a member
      // expression, so `name.name` does not exist on it.
      selector:
        'JSXOpeningElement[name.type="JSXMemberExpression"][name.property.name="AppleAuthenticationButton"]' +
        ':not(:has(> JSXAttribute[name.name="testID"]))',
      message: TEST_ID_MESSAGE,
    },
    {
      // `testID={undefined}` satisfies the two selectors above (the attribute
      // IS there) and puts no id on the element. Reported on ANY element, not
      // only the listed ones: a literal undefined is never what a caller meant.
      selector:
        'JSXAttribute[name.name="testID"] > JSXExpressionContainer > Identifier[name="undefined"]',
      message: TEST_ID_UNDEFINED_MESSAGE,
    },
  ],
};

/**
 * Compose several `no-restricted-syntax` rule sets into ONE array.
 *
 * ESLint does not merge this rule: the last config entry to define it wins
 * outright (see the note on `clientSecrets` below). Every set here is shaped
 * `['error', …selectors]`, so composing means taking the severity once and
 * every set's selectors after it.
 */
export function composeRestrictedSyntax(...ruleSets) {
  return {
    'no-restricted-syntax': [
      'error',
      ...ruleSets.flatMap((set) => set['no-restricted-syntax'].slice(1)),
    ],
  };
}

/**
 * The client-secret guard as a standalone config entry.
 *
 * Wired explicitly into each client app rather than folded into `base`, because
 * `base` is also the right preset for server-side and tooling packages —
 * packages/db legitimately uses the service_role key, and a rule that has to be
 * switched off where it does not apply teaches people to switch it off.
 */
export const clientSecrets = [
  {
    name: '@touch/client-secrets',
    // NOTE: `no-restricted-syntax` is not merged by ESLint — the last config to
    // define it wins outright. `base` already sets it for the RTL guard, so this
    // entry re-states BOTH sets. Dropping the spread here silently disables the
    // RTL guard everywhere this preset is applied, which is exactly the kind of
    // quiet regression the RTL rule itself suffered until 2026-09-02.
    rules: {
      'no-restricted-syntax': [
        'error',
        ...rtlGuardRules['no-restricted-syntax'].slice(1),
        ...clientSecretRules['no-restricted-syntax'].slice(1),
      ],
    },
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
    // `*.timestamp-*.mjs`: vite/vitest transpile their config to a temp file
    // NEXT TO it (vitest.config.ts.timestamp-<ms>-<rand>.mjs) and delete it as
    // soon as the config is loaded. `turbo lint` and `turbo test` run
    // concurrently in the same package (lint has no dependsOn), so eslint can
    // glob that file and then fail reading it — ENOENT, exit 2, a red CI on a
    // commit that changed nothing relevant. Seen on @touch/i18n 2026-09-21.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/*.timestamp-*.mjs',
    ],
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
