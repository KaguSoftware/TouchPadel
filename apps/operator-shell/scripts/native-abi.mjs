// Fetch better-sqlite3's prebuilt binary for the runtime that is about to load
// it, then PROVE it loads there.   usage: node scripts/native-abi.mjs [electron|node]
//
// Why this exists: the workspace uses pnpm with node-linker=hoisted, so the one
// better-sqlite3 lives at the repo root. `pnpm install` gives it the binary for
// the Node that ran the install (ABI 127 on Node 22). Electron 33 embeds ABI 130.
// electron-builder's own rebuild step runs in this package dir, finds no
// node_modules/better-sqlite3 of its own, reports success — and the installer
// ships the Node binary. The packaged app then throws NODE_MODULE_VERSION 127
// vs 130 inside app.whenReady and never opens a window, which is exactly what
// the first public build (operator-v0.2.0, 2026-09-07) did on every machine.
//
// So: rebuild explicitly against the resolved copy, and refuse to continue
// unless that runtime can actually open a database with it. `pnpm dist` and
// operator-release.yml run the electron flavour before electron-builder; the
// node flavour flips the same file back for vitest (the two ABIs cannot coexist).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

const runtime = process.argv[2] ?? 'electron';
if (runtime !== 'electron' && runtime !== 'node') {
  console.error(`[native-abi] unknown runtime "${runtime}" — expected electron or node`);
  process.exit(2);
}

const pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [pkgDir] });
const { electronVersion } = require('../electron-builder.config.cjs');
const target = runtime === 'electron' ? electronVersion : process.versions.node;
// `pnpm native:electron --arch=arm64` style overrides arrive as npm_config_arch.
const arch = process.env.npm_config_arch || process.arch;

console.log(`[native-abi] better-sqlite3 at ${pkgDir}`);
console.log(`[native-abi] fetching the prebuilt binary for ${runtime} ${target} (${arch})`);
const fetch = spawnSync(
  process.execPath,
  [prebuildInstall, '--runtime', runtime, '--target', target, '--arch', arch, '--force', '--verbose'],
  { cwd: pkgDir, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } },
);
if (fetch.status !== 0) {
  console.error('[native-abi] prebuild-install failed — no binary for this runtime/arch?');
  process.exit(fetch.status ?? 1);
}

// The proof: open an in-memory database inside the runtime itself. Under
// Electron that is the real electron binary in node mode, i.e. the same ABI the
// packaged app's main process has.
const probe = [
  'const Database = require(process.env.BS3_DIR);',
  "const db = new Database(':memory:');",
  "db.pragma('user_version');",
  'db.close();',
  "const rt = process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.versions.node;",
  "console.log('[native-abi] ok: better-sqlite3 loads under ' + rt + ' (ABI ' + process.versions.modules + ')');",
].join(' ');
const bin = runtime === 'electron' ? require('electron') : process.execPath;
const env = { ...process.env, BS3_DIR: pkgDir };
if (runtime === 'electron') env.ELECTRON_RUN_AS_NODE = '1';
else delete env.ELECTRON_RUN_AS_NODE;
const check = spawnSync(bin, ['-e', probe], { env, stdio: 'inherit' });
if (check.status !== 0) {
  console.error(`[native-abi] better-sqlite3 does NOT load under ${runtime} — refusing to continue`);
  process.exit(1);
}
