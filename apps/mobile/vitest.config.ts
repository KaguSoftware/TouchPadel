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
  },
});
