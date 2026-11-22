// Bundle main + preload to single CJS files (design-arch.md §8, A6).
//
// Why bundle at all: a SANDBOXED preload cannot require() sibling compiled
// modules — one self-contained file per entry is what lets index.ts finally
// set sandbox: true. It also means the packaged asar carries two files instead
// of the whole tsc output tree.
//
// What stays external, and why: electron (provided by the runtime),
// better-sqlite3 (a .node binary; scripts/native-abi.mjs fetches the Electron
// ABI build and electron-builder unpacks it beside the asar), electron-updater
// (one version in the tree, resolved from the asar's node_modules).

import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20', // Electron 33 ships Node 20
  sourcemap: true,
  external: ['electron', 'better-sqlite3', 'electron-updater'],
  logLevel: 'info',
};

await build({ ...shared, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' });
await build({ ...shared, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' });
