// electron-builder beforePack hook: put the RIGHT better-sqlite3 binary in
// place for the arch that is about to be packaged.
//
// electron-builder calls this once per (platform, arch) just before it copies
// node_modules into the app, and it copies the one hoisted better-sqlite3 from
// the repo root (electron-builder.config.cjs, npmRebuild: false). Without this
// hook that copy is whatever scripts/native-abi.mjs last fetched — the host's
// arch — so a mac x64 target built on the arm64 runner would ship an arm64
// .node that an Intel Mac cannot load (the same "never opens a window" failure
// as operator-v0.2.0, just for the other reason). Here each arch fetches its
// own prebuild right before its files are collected; native-abi.mjs proves it
// (a real load when the arch is the host's, a header check when it is not).
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Arch } = require('electron-builder');

module.exports = async function beforePack(context) {
  const arch = Arch[context.arch];
  if (arch === 'universal') {
    // A universal slice needs both binaries lipo'd together; not set up (and
    // not needed: the mac target ships one dmg per arch).
    throw new Error('before-pack: universal mac builds are not supported — target arm64 and x64 separately');
  }
  const script = path.join(__dirname, 'native-abi.mjs');
  console.log(`  • before-pack     better-sqlite3 for ${context.electronPlatformName} ${arch}`);
  const r = spawnSync(process.execPath, [script, 'electron'], {
    stdio: 'inherit',
    env: { ...process.env, npm_config_arch: arch },
  });
  if (r.status !== 0) {
    throw new Error(`before-pack: native-abi.mjs failed for ${arch} (exit ${r.status ?? r.signal})`);
  }
};
