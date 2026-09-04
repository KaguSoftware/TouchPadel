// .mjs on purpose: @touch/config is `"type": "module"` and its preset uses ESM
// `import`, while apps/operator has `"type": "module"` but Vite/TS tooling is
// happier with an explicit .mjs — same choice as apps/mobile.
//
// Before this file, `pnpm turbo lint` was a green no-op for the operator: no
// `lint` script, no eslint config, while HANDOFF.md claimed the RTL
// logical-properties rule was enforced. The operator is the ONE surface where
// that rule matters most — it is 100% inline styles, no stylesheet, and every
// screen must mirror in Arabic.
import { base, react, clientSecrets, clientSecretRules } from '@touch/config/eslint';

export default [
  ...base, // typescript-eslint recommended + the repo's RTL logical-property guard
  ...react, // react-hooks
  ...clientSecrets, // service_role / sb_secret_ must never reach the renderer
  {
    name: '@touch/operator',
    rules: {
      // The renderer must never import Node/Electron directly — everything the
      // main process owns crosses the typed IPC bridge (design-arch.md 2.1).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Renderer code must go through src/ipc/bridge.ts.' },
            { name: 'fs', message: 'No filesystem in the renderer — use the IPC bridge.' },
            { name: 'node:fs', message: 'No filesystem in the renderer — use the IPC bridge.' },
          ],
        },
      ],
    },
  },
  {
    // Recharts margin props are `{ top, right, bottom, left }` by API contract —
    // they are chart geometry, not CSS, and the library has no logical variant.
    //
    // This drops the RTL selectors ONLY. It used to be a blanket
    // `'no-restricted-syntax': 'off'`, which — now that the client-secret guard
    // shares that rule name — would have quietly carved a hole where a
    // service_role key could sit unlinted. Restate the secret rules instead.
    name: '@touch/operator/recharts-geometry',
    files: ['src/features/analytics/charts/**/*.tsx'],
    rules: clientSecretRules,
  },
  {
    ignores: ['dist/**', 'vite.config.ts', 'eslint.config.mjs'],
  },
];
