/**
 * The pairing card's reading of main's answer (F-31). The card used to throw
 * main's own words ('pin not recognised') as a bare Error, which the error
 * line could only show as "Something went wrong": exactly what a manager sees
 * offline when the PIN typed is not one the station has on file. It is the
 * fact the server states as PIN_INVALID, so it reads "Incorrect PIN." here
 * too, as Quit's does (components/LeaveStation.tsx leaveRefusal).
 */
import { AppRpcError } from '../../lib/appRpc';
import type { IpcRefusal, PairingInfoResult } from '../../ipc/bridge';

export type PairingRefusal = 'not-a-till' | 'no-psk' | 'custom-psk';

export type PairingOutcome =
  | { kind: 'info'; host: string | null; port: number; code: string }
  | { kind: 'refusal'; refusal: PairingRefusal }
  | { kind: 'error'; error: Error };

export function readPairingAnswer(res: PairingInfoResult | IpcRefusal): PairingOutcome {
  // A validation refusal from main: the only thing this call carries is the
  // PIN, so it is a PIN main would not take (not 4 to 12 digits).
  if (!('ok' in res)) return { kind: 'error', error: new AppRpcError('PIN_INVALID', res.error) };
  if (res.ok) return { kind: 'info', host: res.host, port: res.port, code: res.code };
  if (res.error === 'pin not recognised') return { kind: 'error', error: new AppRpcError('PIN_INVALID', res.error) };
  return { kind: 'refusal', refusal: res.error };
}
