import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openQueue, getMeta, setMeta } from './queue';
import { observePin, unlockPinOffline, resetPinCache } from './pin-cache';
import { __setEncryptionAvailable } from '../../test/electron-stub';

/**
 * Salt-at-rest behaviour — Security Layer 1, Block 4 · Desktop (SEC-32/SEC-34).
 *
 * The property under test is not "encryption is called". It is that a queue.db
 * copied off the venue PC is useless: the salt must not be recoverable from the
 * file, and a station that cannot encrypt must refuse to cache PIN material
 * rather than quietly writing plaintext.
 */
describe('pin_cache salt at rest', () => {
  // openQueue() caches ONE handle for the process (queue.ts:25), so every suite
  // in this file shares a database — same approach as queue.test.ts: truncate
  // between cases rather than pretending each gets its own file. An earlier
  // draft of this test opened its own temp queue.db and quietly asserted
  // against a database the code under test never touched.
  beforeEach(() => {
    openQueue().exec("DELETE FROM pin_cache; DELETE FROM meta WHERE key LIKE 'pin_salt%';");
    __setEncryptionAvailable(true);
  });

  afterEach(() => {
    __setEncryptionAvailable(true);
  });

  it('never writes the salt in plaintext', () => {
    observePin('4821', 'manager');

    const legacy = getMeta('pin_salt');
    expect(legacy, 'the plaintext salt key must not be written').toBeUndefined();

    const stored = getMeta('pin_salt_enc');
    expect(stored, 'an encrypted salt must exist').toBeTruthy();
    // 64 hex characters is what a raw 32-byte salt looks like. The stored value
    // must not be that — if it is, the ciphertext is the plaintext.
    expect(stored).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('still unlocks with the right pin once encrypted', () => {
    observePin('4821', 'manager');
    expect(unlockPinOffline('4821')?.role).toBe('manager');
    expect(unlockPinOffline('0000')).toBeNull();
  });

  it('migrates a legacy plaintext salt without losing offline unlock', () => {
    // A station upgrading from the pre-Layer-1 build: salt in plaintext, and a
    // hash already cached against it. Re-encrypting the SAME bytes is what
    // keeps that cached hash valid.
    __setEncryptionAvailable(false);
    const legacySalt = 'a'.repeat(64);
    setMeta('pin_salt', legacySalt);

    __setEncryptionAvailable(true);
    observePin('4821', 'manager');

    expect(getMeta('pin_salt'), 'the legacy plaintext key must be removed').toBeUndefined();
    expect(unlockPinOffline('4821')?.role).toBe('manager');
  });

  it('FAILS CLOSED when the machine cannot encrypt', () => {
    __setEncryptionAvailable(false);

    observePin('4821', 'manager');

    // Nothing cached, nothing unlocked, and above all no plaintext salt.
    expect(unlockPinOffline('4821')).toBeNull();
    expect(getMeta('pin_salt')).toBeUndefined();
    expect(getMeta('pin_salt_enc')).toBeUndefined();
  });

  it('discards cached hashes when the salt can no longer be decrypted', () => {
    observePin('4821', 'manager');
    expect(unlockPinOffline('4821')).not.toBeNull();

    // Simulate a reimaged machine / recreated Windows profile: the ciphertext
    // is present but no longer readable.
    setMeta('pin_salt_enc', Buffer.from('not-stub-ciphertext').toString('base64'));

    expect(unlockPinOffline('4821'), 'a stale credential must not unlock').toBeNull();
    const rows = openQueue().prepare('SELECT COUNT(*) AS n FROM pin_cache').get() as { n: number };
    expect(rows.n, 'dead credential material must not linger on disk').toBe(0);
  });

  it('resetPinCache clears both the hashes and the salt', () => {
    observePin('4821', 'manager');
    resetPinCache();
    expect(getMeta('pin_salt_enc')).toBeUndefined();
    expect(unlockPinOffline('4821')).toBeNull();
  });
});
