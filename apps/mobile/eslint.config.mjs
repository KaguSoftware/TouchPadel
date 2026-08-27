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
      // src/theme.ts imported the @touch/ui BARREL, which re-exports a DOM-only
      // ThemeProvider and the whole themeCss string into the React Native
      // bundle just to obtain a colour object.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@touch/ui',
              message:
                "Barrel pulls DOM-only modules into the RN bundle. Use a subpath, e.g. '@touch/ui/tokens/palette'.",
            },
          ],
        },
      ],
      // Would have caught the push-registration effect that fired on mount with
      // a stale closure, and the countdown interval that never cleared.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ignores: ['.expo/**', 'expo-env.d.ts', 'android/**', 'ios/**', 'dist/**', 'babel.config.js', 'metro.config.js'],
  },
];
