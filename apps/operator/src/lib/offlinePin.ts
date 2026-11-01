/**
 * PINs while the station is offline (F-05, F-07; Majed 2026-11-01: "PINs
 * cached locally and used").
 *
 * The shell keeps a salted hash of every PIN that succeeded server-side
 * recently (apps/operator-shell/src/main/pin-cache.ts): manager PINs for the
 * manager actions, and a person's own lock-screen PIN for their own idle
 * lock. Online, the server is the only judge and nothing here runs. Offline,
 * the screens used to queue a PIN-gated write with whatever was typed, and a
 * wrong PIN only failed at replay, minutes after the till had shown the
 * refund as done. Now a PIN the cache does not know is refused on the spot,
 * with the same "Incorrect PIN" line the server would give.
 *
 * The cache is the gate the cashier meets, not the wall: a queued write
 * still carries its PIN and replay proves it to verify_manager_pin first
 * (0115). A PIN never used on this station while it was connected (or not in
 * 14 days) is not on file, so offline it is refused like a wrong one; the
 * manager authorises once online and the station remembers.
 */
import { touch } from '../ipc/bridge';
import { AppRpcError } from './appRpc';
import { isStationOffline } from './connectivity';

function inElectron(): boolean {
  const w = (globalThis as { window?: { touch?: unknown } }).window;
  return !!w && !!w.touch;
}

/** True when a PIN check must be answered from the station's own cache now. */
export function pinCheckIsLocal(): boolean {
  return inElectron() && isStationOffline();
}

/** Offline: is this a manager PIN the station has on file? Online or in a browser: null (ask the server). */
export async function managerPinOnFile(pin: string): Promise<boolean | null> {
  if (!pinCheckIsLocal()) return null;
  try {
    const hit = await touch.unlockPin(pin);
    return !!hit && typeof hit === 'object' && 'role' in hit;
  } catch {
    return false;
  }
}

/**
 * Offline, refuse a manager PIN the station's cache does not know, at once:
 * throws AppRpcError('PIN_INVALID'). Online and in a browser it does nothing;
 * the server judges the PIN as it always has.
 */
export async function assertManagerPinOffline(pin: string): Promise<void> {
  const known = await managerPinOnFile(pin);
  if (known === false) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
}

/**
 * The idle lock offline (F-07): is this the signed-in person's own PIN, on
 * file in the station's cache? The shell compares against the session it
 * holds, never an id from here. Browser mode: false.
 */
export async function verifyOwnPinOffline(pin: string): Promise<boolean> {
  if (!inElectron()) return false;
  try {
    return (await touch.unlockOwnPin(pin)) === true;
  } catch {
    return false;
  }
}
