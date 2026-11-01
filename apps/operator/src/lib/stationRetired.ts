/**
 * F-49: this machine was retired (Settings › Cashier computers) and must do
 * nothing at all until a manager or the owner registers it again.
 *
 * The server says so on every beat (app.heartbeat `retired: true`, 0397). The
 * verdict is remembered on the machine, per station id, so a restart or a
 * reload shows the retired screen at once, before the first beat lands, and
 * an outage (no answer) never lifts it. Only a beat that says the station is
 * live again (or a successful re-registration here) clears it.
 */
const KEY = 'tp.station.retired';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Was this station id retired at its last word from the server? */
export function rememberedRetired(stationId: string): boolean {
  return read() === stationId;
}

export function rememberRetired(stationId: string, retired: boolean): void {
  try {
    if (retired) localStorage.setItem(KEY, stationId);
    else if (read() === stationId) localStorage.removeItem(KEY);
  } catch {
    // Storage refused (private window, tests): the server says it again in ten seconds.
  }
}

/**
 * The next retired state from a beat's verdict: retired stays retired through
 * 'other' and through an outage (null); only 'live' lifts it.
 */
export function nextRetired(current: boolean, verdict: 'retired' | 'live' | 'other' | null | undefined): boolean {
  if (verdict === 'retired') return true;
  if (verdict === 'live') return false;
  return current;
}

const LOCK_KEY = 'tp.station.idleLockSeconds';

/**
 * F-48: the idle-lock timeout the last beat carried, kept on the machine so a
 * till that boots offline still locks after the owner's time.
 */
export function rememberedIdleLock(): number | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 3600 ? n : null;
  } catch {
    return null;
  }
}

export function rememberIdleLock(seconds: number | null): void {
  try {
    if (seconds === null) localStorage.removeItem(LOCK_KEY);
    else localStorage.setItem(LOCK_KEY, String(seconds));
  } catch {
    // Storage refused: the next beat brings it again.
  }
}

/** The timeout a station runs: the owner's (from the beat) when there is one, else what this person can read, else the default. */
export function idleLockTimeout(fromBeat: number | null, fromSettings: number): number {
  return fromBeat ?? fromSettings;
}
