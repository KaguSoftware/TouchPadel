import { defineConfig } from 'vitest/config';

/**
 * Unit tests run under plain node against the PURE modules only
 * (src/features/x/{assemble,logic,errors}.ts) — nothing under test may import
 * react-native / expo, so no RN renderer or jest-expo preset is needed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    /**
     * The smoke renders are the OTHER runner's (jest.config.js explains the
     * split). `include` already excludes them by extension — they are `.tsx`
     * — but the exclusion is stated anyway: a test file collected by both
     * runners runs twice under two different globals, and the second failure
     * gets blamed on the first. The last two entries are vitest's own
     * defaults, which naming `exclude` at all would otherwise replace.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'src/smoke/**', '**/*.smoke.test.*'],
  },
});
