// .mjs on purpose: @touch/config is `"type": "module"` and its preset uses ESM
// `import`, the same choice as every other package here.
import { base, clientSecrets, clientSecretRules } from '@touch/config/eslint';

export default [
  ...base, // typescript-eslint recommended + the repo's RTL logical-property guard
  ...clientSecrets, // this code ships in the phone bundle and on the public site
  {
    // Physical coordinates by design: three.js geometry (a shadow camera's
    // left/right/top/bottom frustum, mesh positions), not layout. Mirrors
    // apps/mobile's `physical-art` override: it drops the RTL selectors ONLY,
    // because `no-restricted-syntax` is one rule and a blanket 'off' would
    // take the client-secret guard with it. `clientSecretRules` is exactly
    // that guard, restated.
    name: '@touch/court3d/geometry',
    files: ['src/**/*.ts'],
    rules: clientSecretRules,
  },
  { ignores: ['node_modules/**', 'eslint.config.mjs', 'vitest.config.ts'] },
];
