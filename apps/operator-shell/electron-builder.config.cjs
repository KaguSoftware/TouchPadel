// @ts-check
// electron-builder config (design-arch.md 2.5, 8). Wired via `pnpm dist` /
// `pnpm dist:dir` (local) and .github/workflows/operator-release.yml (tag
// operator-v*). Always passed explicitly with `--config electron-builder.config.cjs`:
// electron-builder only auto-discovers `electron-builder.{yml,js,cjs,...}`.
//
// Why JavaScript rather than the old YAML: Windows signing has two routes
// (Azure Trusted Signing, classic PFX) and neither may be configured yet. A
// static `win.azureSignOptions` block makes Invoke-TrustedSigning fail whenever
// the Azure env is absent (local builds, the CI smoke job), so that block only
// exists when all of its env is present. The PFX route needs no config at all:
// electron-builder reads CSC_LINK / CSC_KEY_PASSWORD itself and treats an empty
// value as "unsigned, no error". Same idea on macOS: `notarize: true` is a
// no-op warning until APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID exist.

const env = (/** @type {string} */ key) => (process.env[key] ?? '').trim();

const AZURE_ENV = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_CODE_SIGNING_ENDPOINT',
  'AZURE_CODE_SIGNING_ACCOUNT_NAME',
  'AZURE_CERTIFICATE_PROFILE_NAME',
];
const azureSigning = AZURE_ENV.every((key) => env(key) !== '');

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.kagu.touchpadel.operator',
  productName: 'Touch Padel Operator',
  // electron-builder needs an exact version (it downloads that release's
  // binaries); package.json keeps the caret range for pnpm. Bump together.
  electronVersion: '33.4.11',
  // One 1024px png; electron-builder derives icon.ico / icon.icns from it.
  // Placeholder artwork until the client's brand files land (assets/icon.svg).
  icon: 'assets/icon.png',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: ['dist/**', 'package.json'],
  // The built apps/operator SPA rides as the renderer payload, loaded from
  // process.resourcesPath/renderer (main/index.ts), never from a URL. This is
  // what makes Module 7 possible: the UI boots with zero network.
  extraResources: [
    { from: '../operator/dist', to: 'renderer' },
    // station.json.example ships beside the app so the install runbook can copy it.
    { from: 'station.json.example', to: 'station.json.example' },
  ],
  // better-sqlite3's .node binary cannot load from inside the asar.
  asarUnpack: ['**/*.node'],
  // Native deps are rebuilt by scripts/native-abi.mjs (`pnpm native:electron`),
  // which `pnpm dist` and operator-release.yml run before this. electron-builder's
  // own rebuild is a no-op here — node-linker=hoisted puts better-sqlite3 at the
  // repo root, out of its reach — and it shipped a Node-ABI binary in
  // operator-v0.2.0 (app never opened a window). Off, so it can never look like
  // it did the job.
  npmRebuild: false,

  // The public download host and the electron-updater feed. Publishing needs
  // GH_TOKEN (a PAT with contents:write on THAT repo; the workflow's own
  // GITHUB_TOKEN cannot write to a foreign repo). The release itself is NOT
  // created here: operator-release.yml's `prepare` job creates a draft first
  // (electron-builder runs one publisher per artifact, and two concurrent
  // creates raced to a 422 on the first real run), the builders upload into it,
  // and the `publish` job flips it live once every asset is present.
  // `releaseType: release` stays — electron-publish reuses a matching draft
  // either way, but with `draft` it would silently skip an already-published
  // release instead of uploading. Even a `--publish never` build embeds this as
  // resources/app-update.yml, so local installs self-update too.
  publish: {
    provider: 'github',
    owner: 'KaguSoftware',
    repo: 'touchpadel-releases',
    releaseType: 'release',
  },

  win: {
    target: ['nsis'],
    ...(azureSigning
      ? {
          azureSignOptions: {
            endpoint: env('AZURE_CODE_SIGNING_ENDPOINT'),
            codeSigningAccountName: env('AZURE_CODE_SIGNING_ACCOUNT_NAME'),
            certificateProfileName: env('AZURE_CERTIFICATE_PROFILE_NAME'),
            // Azure does not tell electron-builder the certificate's CN, and
            // electron-updater only verifies a downloaded installer's signature
            // when app-update.yml carries publisherName. Set it once the cert
            // exists (must equal the CN exactly).
            ...(env('WIN_SIGN_PUBLISHER_NAME') ? { publisherName: env('WIN_SIGN_PUBLISHER_NAME') } : {}),
          },
        }
      : {}),
  },
  nsis: {
    // Assisted installer, not one-click: a welcome page, "just me / everyone",
    // a folder picker, then a finish page with "Run Touch Padel Operator"
    // ticked. The one-click variant flashed a progress bar and vanished, which
    // on the first public build read as "nothing happened" (2026-09-07).
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // Launch-on-boot: runAfterFinish for the first session; app.setLoginItemSettings
    // (main/index.ts) keeps it registered on every packaged boot.
    runAfterFinish: true,
    // Version-less on purpose: the download link on the staff page never changes
    // (.../releases/latest/download/Touch-Padel-Operator-Setup.exe). Release URLs
    // carry the version in the tag segment, so electron-updater and the
    // differential blockmap lookup still resolve per version.
    artifactName: 'Touch-Padel-Operator-Setup.${ext}',
  },

  // macOS. Builds only run on the mac job, which the release workflow enables
  // once a Developer ID cert + Apple credentials exist: an unsigned mac app is
  // unusable on current macOS (no "Run anyway") and Squirrel.Mac refuses to
  // update it. zip is the updater's format; dmg is what people download.
  // Apple silicon ONLY: scripts/native-abi.mjs rebuilds better-sqlite3 for the
  // runner's own arch (arm64), so an x64 slice would ship a binary that cannot
  // load. No Intel Mac is planned at the venue; add x64 back together with a
  // per-arch rebuild if that changes.
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    artifactName: 'Touch-Padel-Operator-${arch}.${ext}',
    category: 'public.app-category.business',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    // Boolean in electron-builder 26: credentials come from the APPLE_* env.
    notarize: true,
  },
};

module.exports = config;
