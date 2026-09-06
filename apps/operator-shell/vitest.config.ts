import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The shell had NO test script and NO tests, so `turbo test` skipped it in
// silence — including the SQLite queue, which is the durability guarantee the
// contract makes ("every write flushed to disk before the screen confirms it").
//
// `electron` is aliased to a stub: the queue module imports `app.getPath` only
// to locate queue.db, and nothing else under test touches the Electron runtime.
export default defineConfig({
  resolve: {
    alias: {
      // fileURLToPath, NOT `.pathname`: this repo lives under a directory with a
      // space in its name, and `.pathname` hands back a percent-encoded '%20'
      // path that Vite cannot resolve.
      electron: fileURLToPath(new URL('./test/electron-stub.ts', import.meta.url)),
      'electron-updater': fileURLToPath(new URL('./test/electron-updater-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
