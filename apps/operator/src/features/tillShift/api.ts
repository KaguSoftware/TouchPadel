/**
 * Till shifts (wave5-addendum §2.9.4): the reads and the three writes.
 *
 * The writes go through appRpc, online-only, and are NOT queued types (the
 * open_day / close_day decision, HANDOFF.md "Till online-only ops"), so the six
 * mutation-list copies do not change. Each beats first: the write form of
 * app.till_shift_station wants this session's heartbeat from this device id
 * in the last minute, and the regular beat runs every ten seconds, which is
 * usually but not always inside that window (the DayClose.tsx close_day
 * precedent).
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { QK } from '../../lib/queryKeys';
import { touch } from '../../ipc/bridge';
import {
  readShiftList,
  readShiftStatus,
  shiftBeatIdentity,
  type CloseRefused,
  type CloseResult,
  type OpenResult,
  type ShiftList,
  type ShiftStatus,
  type StationMode,
} from './tillShiftLogic';

/** The device id every shift RPC names: the one mutate() sends as p_device_id. */
export function shiftDeviceId(): string {
  return deviceId();
}

export function stationMode(): StationMode {
  return touch.getStation().mode;
}

/** Feature-private: the lists under their own root, so a write refreshes them with the status. */
export const TILL_SHIFT_LIST_ROOT = ['tillShiftList'] as const satisfies QueryKey;

export function tillShiftListKey(args: { from?: string | null; to?: string | null; station?: string | null; staff?: string | null }): QueryKey {
  return [...TILL_SHIFT_LIST_ROOT, args.from ?? null, args.to ?? null, args.station ?? null, args.staff ?? null];
}

export async function fetchShiftStatus(device: string): Promise<ShiftStatus | null> {
  return readShiftStatus(await appRpc<unknown>('till_shift_status', { p_device_id: device }));
}

export async function fetchShiftList(args: { from?: string | null; to?: string | null; station?: string | null; staff?: string | null } = {}): Promise<ShiftList> {
  return readShiftList(
    await appRpc<unknown>('till_shift_list', {
      p_from: args.from ?? null,
      p_to: args.to ?? null,
      p_station_id: args.station ?? null,
      p_staff_id: args.staff ?? null,
    }),
  );
}

/**
 * The station's unsynced writes, read the way Day close reads them before its
 * own beat. Browser mode has no queue and answers none.
 */
async function currentQueueDepth(): Promise<number> {
  try {
    return (await touch.getQueueRows()).length;
  } catch {
    return 0;
  }
}

/** Beat as the shift's device right before a write. Best effort: the write reports its own refusal. */
export async function beatBeforeShiftWrite(): Promise<void> {
  const station = touch.getStation();
  const identity = shiftBeatIdentity(shiftDeviceId(), station.mode, import.meta.env.DEV);
  if (!identity) return;
  try {
    await appRpc('heartbeat', {
      p_device_id: identity.deviceId,
      p_queue_depth: await currentQueueDepth(),
      p_app_version: station.appVersion,
      p_is_till: identity.isTill,
    });
  } catch {
    // The write below says why it cannot run (TILL_SHIFT_WRONG_STATION, offline).
  }
}

export async function openShift(args: { floatIqd: number; note: string | null; key: string }): Promise<OpenResult> {
  await beatBeforeShiftWrite();
  return appRpc<OpenResult>('open_till_shift', {
    p_opening_float_iqd: args.floatIqd,
    p_device_id: shiftDeviceId(),
    p_note: args.note,
    p_idempotency_key: args.key,
  });
}

/** Close my own shift with my own PIN. A wrong PIN comes back as a value and is thrown here as the code every PIN prompt shows. */
export async function closeOwnShift(args: { shiftId: string; countedIqd: number; pin: string; note: string | null; key: string }): Promise<CloseResult> {
  await beatBeforeShiftWrite();
  const res = await appRpc<CloseResult | CloseRefused>('close_till_shift', {
    p_till_shift_id: args.shiftId,
    p_counted_iqd: args.countedIqd,
    p_pin: args.pin,
    p_device_id: shiftDeviceId(),
    p_note: args.note,
    p_idempotency_key: args.key,
  });
  if (res.ok === false) throw new AppRpcError(res.code, res.code);
  return res;
}

/**
 * Close anyone's shift (or my own without a PIN) with a manager's PIN: the
 * 0115 grant pattern. verify_manager_pin first, in its own round trip so the
 * attempt row commits whatever happens next; it RETURNS null for a wrong PIN.
 */
export async function closeShiftWithManager(args: { shiftId: string; countedIqd: number; managerPin: string; note: string | null; key: string }): Promise<CloseResult> {
  await beatBeforeShiftWrite();
  const device = shiftDeviceId();
  const authorizer = await appRpc<string | null>('verify_manager_pin', { p_pin: args.managerPin, p_device_id: device });
  if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
  touch.pinObserved(args.managerPin, authorizer);
  return appRpc<CloseResult>('close_till_shift_for', {
    p_till_shift_id: args.shiftId,
    p_counted_iqd: args.countedIqd,
    p_device_id: device,
    p_note: args.note,
    p_idempotency_key: args.key,
  });
}

/** After any shift write: the status, the lists, the day's figures and the drawer log. */
export function invalidateShift(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: QK.tillShift.all });
  void qc.invalidateQueries({ queryKey: TILL_SHIFT_LIST_ROOT });
  void qc.invalidateQueries({ queryKey: QK.day });
  void qc.invalidateQueries({ queryKey: ['drawerEvents'] });
}
