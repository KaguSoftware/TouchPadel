import { safeStorage } from 'electron';

/**
 * OS-bound encryption for the small secrets the station keeps on disk —
 * Security Layer 1, Block 4 · Desktop (SEC-32/SEC-34).
 *
 * `safeStorage` binds the key to the logged-in OS account: DPAPI on Windows,
 * Keychain on macOS, the desktop keyring on Linux. The practical consequence is
 * the one that matters here — a file copied off the venue PC (USB stick, backup,
 * stolen machine, a support engineer "grabbing the database") decrypts to
 * nothing on any other machine or under any other account.
 *
 * WHAT THIS PROTECTS, precisely
 *
 * `pin_cache` holds scrypt(pin, station_salt) so a staff PIN can be checked
 * while the venue is offline. Those hashes are only as strong as the salt is
 * secret: a PIN is 4–6 digits, so the entire keyspace is at most a million
 * candidates. With the salt in hand, an attacker walks it in seconds and
 * recovers real staff PINs — which are the manager authorisations for voids,
 * discounts and price overrides.
 *
 * So the salt is what gets encrypted. The hashes may stay as they are: without
 * the salt they cannot be attacked at all, and encrypting them too would break
 * the primary-key dedupe in `observePin` for no additional protection.
 *
 * FAIL CLOSED
 *
 * If encryption is unavailable, this refuses rather than silently writing
 * plaintext. On Windows — the only platform the venue runs — DPAPI is always
 * available, so unavailability means something is genuinely wrong. In
 * development the caller may opt into a plaintext fallback; production may not.
 */

export class SecretUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretUnavailableError';
  }
}

/** Is OS-bound encryption usable in this process right now? */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    // safeStorage throws if touched before app 'ready', and on a Linux box with
    // no keyring at all. Both mean "no", not "crash".
    return false;
  }
}

/**
 * Encrypt to a base64 string for storage in SQLite.
 * @throws SecretUnavailableError when the OS cannot provide encryption.
 */
export function encryptSecret(plaintext: string): string {
  if (!isEncryptionAvailable()) {
    throw new SecretUnavailableError('safeStorage encryption is not available on this machine');
  }
  return safeStorage.encryptString(plaintext).toString('base64');
}

/**
 * Decrypt a value written by encryptSecret.
 *
 * Returns null rather than throwing when the ciphertext cannot be read — which
 * happens legitimately: the Windows profile was recreated, the app runs as a
 * different user, the machine was reimaged. The caller's correct response is to
 * discard the secret and re-derive it, not to crash the till on startup.
 */
export function decryptSecret(ciphertextBase64: string): string | null {
  if (!isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(ciphertextBase64, 'base64'));
  } catch {
    return null;
  }
}
