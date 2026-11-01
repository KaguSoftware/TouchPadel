/**
 * F-09: a queued payment the server refused at replay, set aside by a manager
 * from the till itself — the same act as Day close's "Resolve" on a queue row
 * (features/admin/DayClose.tsx dismissRow), reached where the cashier is.
 *
 * Online the PIN is proved to verify_manager_pin first (a wrong PIN is refused
 * there and never cached); offline the shell checks it against its own PIN
 * cache when it parks the row, so a wrong PIN is refused on the spot either
 * way (F-05). The row is kept in the queue with who and when; the write it
 * carried is NOT applied.
 */
import { touch } from '../../ipc/bridge';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { isStationOffline, isTransportFailure } from '../../lib/connectivity';

export async function resolveRefusedRow(idempotencyKey: string, pin: string): Promise<void> {
  if (!isStationOffline()) {
    try {
      const authorizer = await appRpc<string | null>('verify_manager_pin', {
        p_pin: pin,
        p_device_id: touch.getStation().stationId,
      });
      // verify_manager_pin RETURNS null for a wrong PIN.
      if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
      touch.pinObserved(pin, authorizer);
    } catch (e) {
      // The connection went while we asked: the shell's cache decides below.
      // A server refusal (PIN_INVALID, PIN_LOCKED) stands.
      const transport = isTransportFailure(e) || (e instanceof AppRpcError && e.code === 'UNKNOWN');
      if (!transport) throw e;
    }
  }
  const res = await touch.resolveQueueRow({ idempotencyKey, pin });
  if (!('ok' in res)) throw new AppRpcError('UNKNOWN', res.error);
  if (!res.ok) {
    if (res.error === 'pin not recognised') throw new AppRpcError('PIN_INVALID', res.error);
    throw new AppRpcError('QUEUE_ROW_NOT_RESOLVABLE', res.error);
  }
}
