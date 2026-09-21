/**
 * TWO TEST RUNNERS, AND THEY MUST NOT OVERLAP.
 *
 *  • vitest (`pnpm test`) runs under plain node against the PURE modules —
 *    `src/**​/__tests__/**​/*.test.ts`. Nothing under it may import react-native
 *    or expo, which is why the logic lives in
 *    `src/features/<x>/{assemble,logic,errors}.ts` in the first place. It is
 *    fast, and it is where every rule-and-arithmetic test belongs.
 *
 *  • jest-expo (`pnpm test:smoke`) runs the SMOKE RENDERS —
 *    `src/smoke/**​/*.smoke.test.tsx`. Rendering a screen needs react-native's
 *    own Jest environment, the Metro-style platform resolution that picks
 *    `TabsLayout.ios.tsx` over `TabsLayout.android.tsx`, and a Babel transform
 *    for every `expo-*` package. vitest gives none of that, and teaching it to
 *    would mean re-implementing the preset.
 *
 * THE GLOBS CANNOT OVERLAP. Two runners collecting the same file means every
 * such test runs twice, under two different globals, and a failure in one is
 * attributed to the other. So the extensions differ (`.test.ts` vs
 * `.smoke.test.tsx`), the directories differ (`__tests__` vs `smoke`), and each
 * config excludes the other's glob explicitly — see `exclude` in
 * vitest.config.ts.
 *
 * CommonJS on purpose: this package has no `"type"` field, so a `.js` config is
 * parsed as CJS. (eslint.config.mjs is `.mjs` for the mirror-image reason.)
 */
module.exports = {
  // `ios`, not the universal preset: the app is iOS-first, its platform files
  // resolve `.ios.tsx` first, and running one platform means a screen renders
  // the navigator it actually ships on iOS rather than a blend of the two.
  preset: 'jest-expo/ios',
  // Anchors every path below to apps/mobile no matter where jest is invoked
  // from (the repo root via turbo, CI's `working-directory`, an editor).
  rootDir: __dirname,
  // `roots` (a PATH, expanded and normalised by Jest) plus a RELATIVE glob,
  // rather than one absolute `<rootDir>/src/smoke/**` glob.
  //
  // Jest hands a `<rootDir>`-expanded testMatch straight to micromatch, and on
  // Windows this repo can sit under a path containing `\.claude\worktrees\…`.
  // micromatch reads that `\.` as an ESCAPED DOT, not a separator, so the
  // pattern stops matching the real path and Jest reports "0 matches, 211
  // files checked" — a green-looking `--passWithNoTests` away from a suite
  // that silently tests nothing. A relative glob never contains the path.
  roots: ['<rootDir>/src'],
  testMatch: ['**/smoke/**/*.smoke.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Each case mounts a whole screen; a mock left armed by the previous one is
  // the classic way a smoke suite starts passing for the wrong reason.
  clearMocks: true,
  restoreMocks: true,
  // The first case pays for compiling react-native + expo-router through Babel.
  testTimeout: 20000,
  transformIgnorePatterns: [
    // jest-expo's own allow-list, plus `@touch`: the workspace packages ship
    // RAW TypeScript with no build step, so Jest has to transform them too.
    //
    // `[/\\]` rather than `/`: on Windows the absolute path Jest matches this
    // against is `C:\…\node_modules\expo\…`, and a pattern anchored on forward
    // slashes matches none of it — every expo module then arrives untransformed
    // and the first `import` throws.
    // `react-native-safe-area-context` is on the list for one file:
    // `jest/mock.tsx`, the library's own test double, which ships as raw TSX
    // beside the built output. jest.setup.ts requires it (see the note there
    // on why the real provider renders nothing in Node), and untransformed it
    // fails with "Cannot use import statement outside a module".
    '[/\\\\]node_modules[/\\\\](?!(.pnpm|react-native|@react-native|@react-native-community|react-native-safe-area-context|expo|expo-.*|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|@touch)[/\\\\])',
    '[/\\\\]node_modules[/\\\\]react-native-reanimated[/\\\\]plugin[/\\\\]',
    '[/\\\\]node_modules[/\\\\]@react-native[/\\\\]babel-preset[/\\\\]',
  ],
};
