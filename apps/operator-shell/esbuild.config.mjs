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
//
// ws is deliberately BUNDLED. It used to be external, and the workspace holds
// two copies — 8.x here, 7.x hoisted at the repo root by another package — and
// electron-builder packed the root 7.x into the asar. ws 7 has no
// WebSocketServer export, so every configured till died at boot with
// "import_ws.WebSocketServer is not a constructor" (operator-v0.2.1 candidate,
// 2026-09-07). Bundling pins the copy this package resolves. ws's two optional
// native accelerators are required inside try/catch and fall back to JS, so
// they stay external rather than failing the bundle.
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20', // Electron 33 ships Node 20
  sourcemap: true,
  external: ['electron', 'better-sqlite3', 'electron-updater', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
};

await build({ ...shared, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' });
await build({ ...shared, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' });
