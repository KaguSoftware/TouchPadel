/**
 * The idle lock's PIN check (F-07), the pure half of IdleLock in
 * routes/__root.tsx.
 *
 * Online, the server decides (app.verify_own_pin, 0064) and a PIN it accepts
 * is handed to the shell's cache so the next outage can still unlock. When the
 * station already knows it is offline, or the online check never got an
 * answer (a transport failure), the shell's own PIN cache decides instead
 * (touch.unlockOwnPin, through lib/offlinePin.ts): a PIN it does not hold for
 * the signed-in person is refused on the spot. A till that idle-locked during
 * an outage used to stay locked until the connection came back.
 *
 * Anything the server ANSWERED (NO_PIN_SET, PIN_LOCKED, …) is thrown back to
 * the screen unchanged: those are facts, not a connection problem.
 */

export interface UnlockDeps {
  /** The station already knows it cannot reach the server (lib/connectivity.ts). */
  offline: () => boolean;
  /** app.verify_own_pin: true for the caller's own PIN, false for a wrong one. */
  verifyOnline: (pin: string) => Promise<boolean>;
  /** The shell's cache, against the signed-in person (lib/offlinePin.ts). */
  verifyOffline: (pin: string) => Promise<boolean>;
  /** A failure that never reached the server (lib/connectivity.ts isTransportFailure). */
  isTransport: (error: unknown) => boolean;
  /** Browser mode has no PIN cache: a transport failure there is "No connection". */
  hasCache: boolean;
  /** Teach the cache a PIN the server just accepted. */
  observe: (pin: string) => void;
}

export interface UnlockVerdict {
  ok: boolean;
  /** Which check decided. */
  via: 'online' | 'offline';
}

export async function verifyUnlockPin(pin: string, deps: UnlockDeps): Promise<UnlockVerdict> {
  if (deps.hasCache && deps.offline()) {
    return { ok: await deps.verifyOffline(pin), via: 'offline' };
  }
  let ok: boolean;
  try {
    ok = await deps.verifyOnline(pin);
  } catch (e) {
    if (deps.hasCache && deps.isTransport(e)) {
      return { ok: await deps.verifyOffline(pin), via: 'offline' };
    }
    throw e;
  }
  if (ok) deps.observe(pin);
  return { ok, via: 'online' };
}
