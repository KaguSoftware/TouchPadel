// Bundle main + preload to single CJS files (design-arch.md §8, A6).
//
// Why bundle at all: a SANDBOXED preload cannot require() sibling compiled
// modules — one self-contained file per entry is what lets index.ts finally
// set sandbox: true. It also means the packaged asar carries two files instead
// of the whole tsc output tree. Natives and electron stay external:
// better-sqlite3 is a .node binary electron-builder rebuilds per-ABI, ws is a
// plain prod dep resolved from node_modules at runtime.
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20', // Electron 33 ships Node 20
  sourcemap: true,
  external: ['electron', 'better-sqlite3', 'ws', 'electron-updater'],
  logLevel: 'info',
};

await build({ ...shared, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' });
await build({ ...shared, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' });
