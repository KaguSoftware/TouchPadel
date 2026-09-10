// .mjs on purpose: @touch/config is `"type": "module"` and its preset uses ESM
// `import` — same choice as the apps. Before this file `pnpm turbo lint`
// skipped this package silently because it had no `lint` script. This is
// the package whose whole point is the logical-property rule the guard enforces.
import { base, react } from '@touch/config/eslint';

export default [
  ...base, // typescript-eslint recommended + the repo's RTL logical-property guard
  ...react, // react-hooks
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'scripts/**'] },
];
