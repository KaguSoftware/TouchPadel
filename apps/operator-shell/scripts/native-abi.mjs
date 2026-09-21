// Fetch better-sqlite3's prebuilt binary for the runtime (and CPU arch) that is
// about to load it, then PROVE it is the right one.
//   usage: node scripts/native-abi.mjs [electron|node]      (npm_config_arch overrides the arch)
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
// unless it is proven right. `pnpm dist` and operator-release.yml run the
// electron flavour before electron-builder; the node flavour flips the same
// file back for vitest (the two ABIs cannot coexist).
//
// Arch: defaults to the host's. scripts/before-pack.cjs (electron-builder's
// beforePack hook) re-runs this once per packaged arch with npm_config_arch
// set, which is what lets the arm64 mac runner also ship an Intel (x64) mac
// build. The proof differs by case:
//   - same arch as the host: open an in-memory database inside the runtime
//     itself (the real ABI check);
//   - a foreign arch: the runtime here cannot load it, so read the binary's
//     own header (Mach-O / PE / ELF) and refuse anything but the asked arch.
import { spawnSync } from 'node:child_process';
import { openSync, readSync, closeSync } from 'node:fs';
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
// `pnpm native:electron --arch=arm64` style overrides arrive as npm_config_arch;
// before-pack.cjs sets it explicitly.
const arch = process.env.npm_config_arch || process.arch;
const crossArch = arch !== process.arch;

console.log(`[native-abi] better-sqlite3 at ${pkgDir}`);
console.log(`[native-abi] fetching the prebuilt binary for ${runtime} ${target} (${arch}${crossArch ? `, host is ${process.arch}` : ''})`);
// The prebuild comes from github.com/WiseLibs/better-sqlite3/releases, which
// answered 504 for ten seconds on 2026-09-07 and took the whole release run
// with it. A few tries with a pause cost nothing on the happy path.
const FETCH_ATTEMPTS = 4;
let fetch = null;
for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
  fetch = spawnSync(
    process.execPath,
    [prebuildInstall, '--runtime', runtime, '--target', target, '--arch', arch, '--force', '--verbose'],
    { cwd: pkgDir, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } },
  );
  if (fetch.status === 0) break;
  if (attempt < FETCH_ATTEMPTS) {
    const wait = 15 * attempt;
    console.warn(`[native-abi] prebuild-install failed (attempt ${attempt}/${FETCH_ATTEMPTS}); retrying in ${wait}s`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
  }
}
if (fetch.status !== 0) {
  console.error('[native-abi] prebuild-install failed — no binary for this runtime/arch, or the download host is down');
  process.exit(fetch.status ?? 1);
}

const binaryPath = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');

// Every fetch, both cases: the file on disk must be for the arch we asked for.
// prebuild-install trusts its --arch flag; this trusts the bytes.
const found = binaryArch(binaryPath);
if (found !== arch) {
  console.error(`[native-abi] ${binaryPath} is ${found ?? 'not a recognised native binary'}, expected ${arch} — refusing to continue`);
  process.exit(1);
}
console.log(`[native-abi] ${path.basename(binaryPath)} header says ${found}`);

if (crossArch) {
  console.log(`[native-abi] ok: ${arch} binary in place (cannot be loaded on this ${process.arch} host; header-verified only)`);
  process.exit(0);
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

/**
 * The CPU arch a native binary was built for, read from its own header, as a
 * Node `process.arch` name ('x64' | 'arm64' | 'ia32'), or null if unknown.
 * Mach-O (macOS), PE (Windows) and ELF (Linux); a fat Mach-O reports the
 * arch only when it is the sole slice, which is all prebuilds ever ship.
 */
function binaryArch(file) {
  const buf = Buffer.alloc(0x400);
  const fd = openSync(file, 'r');
  let n = 0;
  try {
    n = readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  if (n < 0x40) return null;
  const MACH_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64', 0x00000007: 'ia32' };
  const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x014c: 'ia32' };
  const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64', 0x03: 'ia32' };

  const magicBE = buf.readUInt32BE(0);
  // Mach-O, little-endian on disk: 64-bit 0xFEEDFACF, 32-bit 0xFEEDFACE.
  if (magicBE === 0xcffaedfe || magicBE === 0xcefaedfe) {
    return MACH_CPU[buf.readUInt32LE(4)] ?? null;
  }
  // Fat (universal) Mach-O, big-endian: 0xCAFEBABE + nfat_arch + fat_arch[].
  if (magicBE === 0xcafebabe) {
    const count = buf.readUInt32BE(4);
    if (count !== 1) return null;
    return MACH_CPU[buf.readUInt32BE(8)] ?? null;
  }
  // PE: 'MZ', e_lfanew at 0x3C, 'PE\0\0', then IMAGE_FILE_HEADER.Machine.
  if (buf.toString('latin1', 0, 2) === 'MZ') {
    const peOff = buf.readUInt32LE(0x3c);
    if (peOff + 6 > n || buf.readUInt32BE(peOff) !== 0x50450000) return null;
    return PE_MACHINE[buf.readUInt16LE(peOff + 4)] ?? null;
  }
  // ELF: 0x7F 'ELF', e_machine (u16) at 0x12, endianness at byte 5.
  if (buf.readUInt32BE(0) === 0x7f454c46) {
    const machine = buf[5] === 2 ? buf.readUInt16BE(0x12) : buf.readUInt16LE(0x12);
    return ELF_MACHINE[machine] ?? null;
  }
  return null;
}
