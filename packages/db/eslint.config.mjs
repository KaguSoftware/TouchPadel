// .mjs on purpose: @touch/config is `"type": "module"` and its preset uses ESM
// `import` — same choice as the apps. Before this file `pnpm turbo lint`
// skipped this package silently because it had no `lint` script.
import { base } from '@touch/config/eslint';

export default [
  ...base, // typescript-eslint recommended + the repo's RTL logical-property guard
  {
    // supabase/functions/* run on Deno with their own types; lint them with `deno lint`, not this config.
    ignores: [
      'dist/**',
      'node_modules/**',
      'eslint.config.mjs',
      'vitest.config.ts',
      '**/*.gen.ts',
      'supabase/functions/**',
    ],
  },
];
