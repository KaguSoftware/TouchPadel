import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PinUnlockResult, Role } from '../ipc-channels';
import { getMeta, openQueue, setMeta } from './queue';

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
 */

const SALT_KEY = 'pin_salt';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // refuse hashes older than 14 days
const KEY_LEN = 32;

function salt(): Buffer {
  const existing = getMeta(SALT_KEY);
  if (existing) return Buffer.from(existing, 'hex');
  const fresh = randomBytes(32);
  setMeta(SALT_KEY, fresh.toString('hex'));
  return fresh;
}

function hashPin(pin: string): Buffer {
  return scryptSync(pin, salt(), KEY_LEN);
}

export function observePin(pin: string, role: Role = 'manager'): void {
  openQueue()
    .prepare(
      `INSERT INTO pin_cache (pin_hash, role, updated_at) VALUES (@hash, @role, @at)
       ON CONFLICT(pin_hash) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
    )
    .run({ hash: hashPin(pin).toString('hex'), role, at: new Date().toISOString() });
}

export function unlockPinOffline(pin: string): PinUnlockResult | null {
  const candidate = hashPin(pin);
  const cutoff = Date.now() - MAX_AGE_MS;
  const rows = openQueue()
    .prepare('SELECT pin_hash, role, updated_at FROM pin_cache')
    .all() as { pin_hash: string; role: string; updated_at: string }[];
  for (const row of rows) {
    const stored = Buffer.from(row.pin_hash, 'hex');
    // Equal-length scrypt outputs — constant-time compare, no early exit.
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
      if (new Date(row.updated_at).getTime() < cutoff) return null; // stale — re-verify online
      return {
        role: row.role as Role,
        grantToken: randomBytes(16).toString('hex'),
      };
    }
  }
  return null;
}
