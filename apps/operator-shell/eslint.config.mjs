// Electron main + preload. CommonJS output, Node globals, no React, no DOM —
// so the RTL guard in `base` is inert here, but the unused-vars /
// consistent-type-imports / eqeqeq rules are exactly what a 350-line main
// process with five IPC handlers needs.
import { base } from '@touch/config/eslint';

export default [
  ...base,
  {
    name: '@touch/operator-shell',
    rules: {
      // A swallowed error in the main process is invisible: no console anyone
      // reads, no error boundary, no crash. `heartbeat.ts` hid a permanent 404
      // behind `catch {}` for four days. Empty catches must be deliberate.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    // release/ is electron-builder output (win-unpacked carries the whole
    // minified renderer) — linting it is noise at best.
    ignores: ['dist/**', 'release/**', 'eslint.config.mjs', 'esbuild.config.mjs', 'electron-builder.config.cjs', 'scripts/**'],
  },
];
