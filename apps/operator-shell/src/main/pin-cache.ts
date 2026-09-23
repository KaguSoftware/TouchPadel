import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PinUnlockResult, Role } from '../ipc-channels';
import { getMeta, openQueue, setMeta } from './queue';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secret-store';

/**
 * Offline PIN cache — the authorisation-token model (design decision, day 14).
 *
 * `staff.pin_hash` is bcrypt via server-side crypt() and deliberately never
 * client-readable (0004), so the station cannot mirror the server's table.
 * Instead: whenever a PIN-gated action SUCCEEDS online, the renderer pushes the
 * pin over touch:pin-observed and main stores scrypt(pin, station salt). While
 * degraded, unlockPin accepts a pin whose hash matches a recent entry — an
 * ADVISORY gate only: every queued PIN-gated mutation still carries the typed
 * pin and is re-verified server-side at replay. A wrong pin accepted by a stale
 * cache becomes a failed row surfaced to the manager; the cache gates UX, the
 * server remains the wall.
 *
 * The pin itself never touches disk; the salt is minted once per station.
 *
 * ── SALT AT REST — Security Layer 1, Block 4 · Desktop (SEC-32/SEC-34) ───────
 *
 * The hashes above are only as strong as the salt is secret. A staff PIN is
 * 4–6 digits, so the whole keyspace is at most a million candidates: anyone who
 * copies queue.db off the venue PC AND has the salt recovers real PINs in
 * seconds — and those PINs are the manager authorisations for voids, discounts
 * and price overrides. Until now the salt sat next to the hashes in plaintext,
 * which made the pair self-contained: one file, everything needed to attack it.
 *
 * The salt is now encrypted with Electron's safeStorage (DPAPI on Windows), so
 * it is bound to the logged-in Windows account. The database file on its own is
 * inert: copied to another machine, or read as another user, the salt does not
 * decrypt and the hashes cannot be attacked at all.
 *
 * FAIL CLOSED. If encryption is unavailable the station does not cache PIN
 * material — offline unlock is simply unavailable, and staff authorise online
 * as normal. Writing plaintext "so the feature works" would put the credential
 * store back exactly where it started. See docs/security/decisions-layer-1.md.
 */

/** Legacy plaintext key (pre-Layer-1). Migrated and deleted on first read. */
const LEGACY_SALT_KEY = 'pin_salt';
const SALT_KEY = 'pin_salt_enc';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // refuse hashes older than 14 days
const KEY_LEN = 32;

/**
 * The station salt, encrypted at rest.
 *
 * Returns null when this machine cannot encrypt — the caller must then treat
 * offline PIN unlock as unavailable rather than falling back to plaintext.
 */
function salt(): Buffer | null {
  if (!isEncryptionAvailable()) return null;

  const stored = getMeta(SALT_KEY);
  if (stored) {
    const plain = decryptSecret(stored);
    if (plain) return Buffer.from(plain, 'hex');
    // Undecryptable: the Windows profile changed, or the machine was reimaged.
    // The cached hashes are keyed to a salt nobody can read any more, so they
    // can never match — drop them and start clean rather than accumulating
    // dead credential material on disk.
    resetPinCache();
  }

  // Migrate a legacy plaintext salt in place, then remove it. Re-encrypting the
  // SAME bytes keeps every already-cached hash valid, so a station that has
  // been running does not lose offline unlock at upgrade.
  const legacy = getMeta(LEGACY_SALT_KEY);
  const fresh = legacy ? Buffer.from(legacy, 'hex') : randomBytes(32);

  try {
    setMeta(SALT_KEY, encryptSecret(fresh.toString('hex')));
  } catch {
    return null;
  }
  if (legacy) deleteMeta(LEGACY_SALT_KEY);
  return fresh;
}

function hashPin(pin: string): Buffer | null {
  const s = salt();
  return s ? scryptSync(pin, s, KEY_LEN) : null;
}

/** Forget every cached hash. Used when the salt becomes unreadable. */
export function resetPinCache(): void {
  openQueue().prepare('DELETE FROM pin_cache').run();
  deleteMeta(SALT_KEY);
}

function deleteMeta(key: string): void {
  openQueue().prepare('DELETE FROM meta WHERE key = ?').run(key);
}

/**
 * `staffId` is whose PIN this is, when the renderer knows it: the id
 * verify_manager_pin returned, or the signed-in person's own on the lock
 * screen. A later observation without one (a queued write's PIN) keeps the
 * owner already on file rather than forgetting it.
 */
export function observePin(pin: string, role: Role = 'manager', staffId?: string): void {
  const hash = hashPin(pin);
  // Fail closed: no encryption, no cached credential material.
  if (!hash) return;
  openQueue()
    .prepare(
      `INSERT INTO pin_cache (pin_hash, role, updated_at, staff_id) VALUES (@hash, @role, @at, @staffId)
       ON CONFLICT(pin_hash) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at,
         staff_id = coalesce(excluded.staff_id, pin_cache.staff_id)`,
    )
    .run({ hash: hash.toString('hex'), role, at: new Date().toISOString(), staffId: staffId ?? null });
}

export function unlockPinOffline(pin: string): PinUnlockResult | null {
  const candidate = hashPin(pin);
  // No salt means no trustworthy comparison. Refusing sends the manager to the
  // online path, which is the correct degraded behaviour.
  if (!candidate) return null;
  const cutoff = Date.now() - MAX_AGE_MS;
  const rows = openQueue()
    .prepare('SELECT pin_hash, role, updated_at, staff_id FROM pin_cache')
    .all() as { pin_hash: string; role: string; updated_at: string; staff_id: string | null }[];
  for (const row of rows) {
    const stored = Buffer.from(row.pin_hash, 'hex');
    // Equal-length scrypt outputs — constant-time compare, no early exit.
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
      if (new Date(row.updated_at).getTime() < cutoff) return null; // stale — re-verify online
      return {
        ...(row.staff_id ? { staffId: row.staff_id } : {}),
        role: row.role as Role,
        grantToken: randomBytes(16).toString('hex'),
      };
    }
  }
  return null;
}

export type LeaveVerdict = 'ok' | 'pin not recognised' | 'own pin';

/**
 * May this PIN take the station out of its lock (quit, or leave full screen)?
 *
 * Staff are kept inside the app (owner call, 2026-09-23): the way out is a
 * manager's PIN, and never the signed-in person's own — a manager on the till
 * cannot let themselves out, somebody else has to. Signed out there is no
 * "own" to exclude, so any manager PIN on file will do.
 *
 * Signed in, the PIN's owner must be KNOWN and different. A cached hash with
 * no owner on file is refused as unrecognised: it could be the signed-in
 * person's, and online the renderer tags it before asking (the id
 * verify_manager_pin returns), so this only bites an offline station whose
 * cache never learnt the owner.
 */
export function mayLeave(pin: string, signedInStaffId: string | null): LeaveVerdict {
  const unlocked = unlockPinOffline(pin);
  if (!unlocked) return 'pin not recognised';
  if (!signedInStaffId) return 'ok';
  if (!unlocked.staffId) return 'pin not recognised';
  return unlocked.staffId === signedInStaffId ? 'own pin' : 'ok';
}
