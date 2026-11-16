/**
 * This desk's clock secret, kept on the machine (0442, docs/design/clock-in/contracts-2026-11-15.md §2).
 *
 * app.issue_station_clock_key hands the secret to the station once; from then on the station draws
 * its 30-second code itself (`clockCode`, @touch/core/staff/clock), signed in or not, online or
 * not. So the secret has to be readable before anyone signs in, and it lives in the renderer's
 * localStorage under `tp.clock-key:<STATION_ID>` as `{secret, issued_at}`.
 *
 * Why not the shell's safeStorage (apps/operator-shell/src/main/secret-store.ts): no IPC exposes
 * it to the renderer today, and the code must also draw in a browser tab (dev, tests). What the
 * secret protects is narrow: a code from it is refused unless the phone is also inside the club's
 * radius, on the person's bound phone. Moving it behind the shell is a follow-up, not a blocker.
 *
 * `issued_at` is the server's own stamp for this station's key (from app.clock_setup right after
 * issuing), so the setup page can tell when the key on the machine is no longer the live one
 * (someone set the desk up again from another session, or the station was re-registered).
 */

export const CLOCK_KEY_PREFIX = 'tp.clock-key:';
/** Fired on window when this machine's key changes, so open screens redraw. */
export const CLOCK_KEY_EVENT = 'tp-clock-key';

export interface StoredClockKey {
  /** 40 hex characters (20 bytes). */
  secret: string;
  /** The server's issued_at for this station's key, or null when it could not be read back. */
  issued_at: string | null;
}

/** The minimal Storage surface used here (window.localStorage in the app, a map in tests). */
export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SECRET_RE = /^[0-9a-f]{40}$/i;

export function clockKeyName(stationId: string): string {
  return CLOCK_KEY_PREFIX + stationId.trim().toUpperCase();
}

/** Parse what was stored; anything malformed reads as no key (the desk shows no QR). */
export function parseStoredKey(raw: string | null): StoredClockKey | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.secret !== 'string' || !SECRET_RE.test(o.secret)) return null;
    const issued = typeof o.issued_at === 'string' && o.issued_at !== '' ? o.issued_at : null;
    return { secret: o.secret.toLowerCase(), issued_at: issued };
  } catch {
    return null;
  }
}

export function readStationKey(stationId: string, storage: KeyStorage | null): StoredClockKey | null {
  if (!storage || !stationId) return null;
  try {
    return parseStoredKey(storage.getItem(clockKeyName(stationId)));
  } catch {
    return null;
  }
}

/** Store the key; returns false when the machine refused it (private mode, quota). */
export function writeStationKey(stationId: string, key: StoredClockKey, storage: KeyStorage | null): boolean {
  if (!storage || !stationId || !SECRET_RE.test(key.secret)) return false;
  try {
    storage.setItem(clockKeyName(stationId), JSON.stringify({ secret: key.secret.toLowerCase(), issued_at: key.issued_at }));
    return true;
  } catch {
    return false;
  }
}

export function forgetStationKey(stationId: string, storage: KeyStorage | null): void {
  if (!storage || !stationId) return;
  try {
    storage.removeItem(clockKeyName(stationId));
  } catch {
    /* nothing to do */
  }
}

/** What the setup page says about this desk's QR. */
export type DeskKeyStatus =
  /** No key here and none on the server. */
  | 'none'
  /** The key here is the live one (or we could not read its stamp back: trusted). */
  | 'current'
  /** The key here is not the server's any more: the QR it draws is refused. */
  | 'stale'
  /** The server has a key for this desk but this machine lost it. */
  | 'lost';

function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y;
}

export function deskKeyStatus(local: StoredClockKey | null, server: { has_key: boolean; issued_at: string | null } | null): DeskKeyStatus {
  const onServer = !!server?.has_key;
  if (!local) return onServer ? 'lost' : 'none';
  if (!onServer) return 'stale';
  if (local.issued_at === null || !server?.issued_at) return 'current';
  return sameInstant(local.issued_at, server.issued_at) ? 'current' : 'stale';
}

/** window.localStorage when there is one (the renderer), else null. */
export function browserStorage(): KeyStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
