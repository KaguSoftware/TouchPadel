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

/**
 * safeStorage stand-in. Deliberately NOT real encryption — it is a reversible
 * transform whose only job is to let the pin-cache code exercise its
 * encrypt/decrypt/migrate paths under vitest, where no OS keyring exists.
 *
 * `available` is togglable so tests can assert the FAIL-CLOSED behaviour, which
 * is the part that actually matters: a station that cannot encrypt must refuse
 * to cache PIN material rather than quietly write it in plaintext.
 */
let encryptionAvailable = true;

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return encryptionAvailable;
  },
  encryptString(plaintext: string): Buffer {
    if (!encryptionAvailable) throw new Error('electron-stub: encryption unavailable');
    return Buffer.from(`stub:${Buffer.from(plaintext, 'utf8').toString('base64')}`, 'utf8');
  },
  decryptString(buf: Buffer): string {
    if (!encryptionAvailable) throw new Error('electron-stub: encryption unavailable');
    const s = buf.toString('utf8');
    if (!s.startsWith('stub:')) throw new Error('electron-stub: not stub ciphertext');
    return Buffer.from(s.slice('stub:'.length), 'base64').toString('utf8');
  },
};

/** Test helper: simulate a machine with no usable keyring. */
export function __setEncryptionAvailable(v: boolean): void {
  encryptionAvailable = v;
}
