// .mjs on purpose: @touch/config is `"type": "module"` and its preset uses ESM
// `import`, while apps/mobile has no `"type"` field — so a plain
// `eslint.config.js` would be parsed as CJS and fail to load.
//
// Until now NO package in this monorepo defined a `lint` script and no
// eslint.config.* existed anywhere, so `pnpm turbo lint` (and the CI step that
// runs it) was a green no-op across the whole repo — while HANDOFF.md claimed
// "CSS logical properties only (lint-enforced)". The preset with that RTL guard
// was written on day 1 and consumed by nobody. This wires it up.
import expoConfig from 'eslint-config-expo/flat.js';
import { base, react } from '@touch/config/eslint';

export default [
  ...expoConfig,
  ...base, // typescript-eslint recommended + the repo's RTL logical-property guard
  ...react, // react-hooks
  {
    name: '@touch/mobile',
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              // src/theme.ts imported the @touch/ui BARREL, which re-exports a
              // DOM-only ThemeProvider and the whole themeCss string into the
              // React Native bundle just to obtain a colour object.
              name: '@touch/ui',
              message:
                "Barrel pulls DOM-only modules into the RN bundle. Use a subpath, e.g. '@touch/ui/tokens/palette'.",
            },
            {
              // Layout direction is app state (src/i18n/direction.tsx), applied
              // live. The native flag is pinned LTR once, in
              // src/i18n/nativeDirection.ts — nothing else reads it, and a
              // language switch never reloads the bundle.
              name: 'react-native',
              importNames: ['I18nManager', 'DevSettings'],
              message:
                'Direction comes from useLocale().dir (src/i18n/direction.tsx). Only src/i18n/nativeDirection.ts touches I18nManager, and nothing reloads.',
            },
            {
              // A `<Text>` with no textAlign is aligned by iOS from the FIRST
              // STRONG CHARACTER of its content, not from the layout direction
              // — so in Arabic a heading holding a court name, a price or a
              // booking reference stayed on the left while its page mirrored.
              // src/i18n/text.tsx names the paragraph's writing direction
              // instead, and is the only module that may take Text from here.
              name: 'react-native',
              importNames: ['Text'],
              message: "Import Text from src/i18n/text: it carries the paragraph's writing direction.",
            },
            {
              name: 'expo-updates',
              importNames: ['reloadAsync'],
              message: 'A language switch never reloads the app (src/i18n/direction.tsx).',
            },
          ],
          patterns: [
            {
              // SDK 56+: expo-router vendors react-navigation and no longer
              // depends on the bare packages, so they are not resolvable from
              // app code (a second copy would also split every context).
              group: ['@react-navigation/*'],
              message:
                "Import from expo-router's entry points instead: 'expo-router/react-navigation' (native/core/routers/elements) or 'expo-router/js-tabs' (bottom-tabs).",
            },
          ],
        },
      ],
      // Would have caught the push-registration effect that fired on mount with
      // a stale closure, and the countdown interval that never cleared.
      'react-hooks/exhaustive-deps': 'warn',
      // eslint-config-expo 57 ships eslint-plugin-react-hooks 7, whose
      // `recommended` set adds the React Compiler rules. Two of them flag the
      // existing ref-driven animation code (i18n switch, court transition) —
      // 51 sites on the day of the SDK 57 upgrade (2026-09-05). Kept visible as
      // warnings rather than failing CI on the upgrade commit; clearing them is
      // a refactor of its own, not part of the SDK bump.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // The one module allowed to pin the native RTL flag.
    name: '@touch/mobile/native-direction-pin',
    files: ['src/i18n/nativeDirection.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The one module allowed to wrap react-native's own Text.
    name: '@touch/mobile/text-primitive',
    files: ['src/i18n/text.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Physical coordinates by design: the decorative court art (rooted in an
    // LtrIsland, so it is invariant under the language — pinned by
    // src/i18n/__tests__/direction.test.ts) and three.js camera geometry.
    name: '@touch/mobile/physical-art',
    files: ['src/components/CourtIllustration.tsx', 'src/features/courtTransition/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    ignores: ['.expo/**', 'expo-env.d.ts', 'android/**', 'ios/**', 'dist/**', 'babel.config.js', 'metro.config.js'],
  },
];
