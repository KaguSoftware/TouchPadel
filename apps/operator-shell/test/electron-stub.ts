/**
 * Minimal `electron` stand-in for unit tests. Only the surface the modules
 * under test actually touch — deliberately tiny, so a module that starts
 * reaching for more of Electron fails loudly here instead of being mocked
 * into looking testable.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

let userData: string | null = null;

export const app = {
  getPath(name: string): string {
    if (name !== 'userData') throw new Error(`electron-stub: unsupported path '${name}'`);
    if (!userData) {
      userData = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-shell-test-'));
    }
    return userData;
  },
  getVersion(): string {
    return '0.0.0-test';
  },
};

/** Test helper: forget the temp userData dir so the next test gets a fresh queue.db. */
export function __resetUserData(): void {
  userData = null;
}
