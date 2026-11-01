/**
 * F-58: the online-refund actions (Try again, Refund to guest, Settled
 * another way) keep working offline. They used to stay enabled and fail on
 * the row; now, with the station offline, each is put on the durable queue
 * (rpc.queued, replayed exactly once) and its row says "Queued" until the
 * server answers. "Settled another way" takes a manager PIN, which is checked
 * against the station's own PIN cache on the spot first (F-05): a wrong one
 * is refused at once, never queued to fail after reconnect.
 *
 * The queued marks live here, not in a row's state, so moving between Today
 * and Financial does not forget them (and a second press does not queue the
 * same refund twice). A mark goes when its queued write answers, or when the
 * row the server lists has moved on from the state it was queued against.
 */
import { useSyncExternalStore } from 'react';
import { AppRpcError, isSavedOffline } from '../../lib/appRpc';
import { isStationOffline } from '../../lib/connectivity';
import { isElectron } from '../../lib/mutate';
import { assertManagerPinOffline } from '../../lib/offlinePin';
import { queueRpc } from '../../lib/queuedRpc';
import { onResult } from '../../lib/queueResults';
import { deviceId } from '../../lib/idem';
import { requestDepositRefund, retryDepositRefund, settleDepositManually, type DepositAttentionRow } from './depositApi';

export type DepositAction = 'retry' | 'refund' | 'settle';

export interface QueuedDepositAction {
  action: DepositAction;
  /** The queued envelope, when known (a queueRpc); null when appRpc queued it for us. */
  localId: string | null;
  /** The row's status when it was queued: a later read that differs retires the mark. */
  status: string;
  /** Set when the queued write was refused at replay. */
  refused?: string | null;
}

const STORAGE_KEY = 'touch-operator-deposit-queue';
let marks: Record<string, QueuedDepositAction> = load();
const listeners = new Set<() => void>();

function load(): Record<string, QueuedDepositAction> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, QueuedDepositAction>) : {};
  } catch {
    return {};
  }
}

function write(next: Record<string, QueuedDepositAction>): void {
  marks = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    /* private mode: the queue itself is still durable in main */
  }
  for (const l of listeners) l();
}

export function queuedDepositAction(rowId: string): QueuedDepositAction | null {
  return marks[rowId] ?? null;
}

export function markDepositQueued(rowId: string, mark: QueuedDepositAction): void {
  write({ ...marks, [rowId]: mark });
}

export function clearDepositQueued(rowId: string): void {
  if (!(rowId in marks)) return;
  const next = { ...marks };
  delete next[rowId];
  write(next);
}

/** Tests only. */
export function resetDepositQueueForTests(): void {
  write({});
}

/**
 * Pure: is this mark still the row's state? The server listing the row in a
 * different status means the queued write (or someone else) moved it on.
 */
export function markStillCurrent(mark: QueuedDepositAction | null, row: Pick<DepositAttentionRow, 'status'>): boolean {
  return mark !== null && mark.status === row.status;
}

// A queued write's answer retires its mark; a refusal stays on the row, said in words.
onResult((r) => {
  const entry = Object.entries(marks).find(([, m]) => m.localId !== null && m.localId === r.localId);
  if (!entry) return;
  const [rowId, mark] = entry;
  if (r.state === 'acked') clearDepositQueued(rowId);
  else write({ ...marks, [rowId]: { ...mark, localId: null, refused: r.error ?? r.state } });
});

export function useQueuedDepositAction(rowId: string): QueuedDepositAction | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => marks[rowId] ?? null,
  );
}

/** How one action went: done online, or saved on this station for later. */
export type DepositActionOutcome = 'done' | 'queued';

/**
 * Run one action for a row. Offline in the shell it is queued (the manual
 * settle's PIN checked locally first); online it is the direct call, and an
 * appRpc that queued it itself on the way (isSavedOffline) counts as queued.
 */
export async function runDepositAction(
  row: Pick<DepositAttentionRow, 'id' | 'status'>,
  action: DepositAction,
  manual?: { pin: string; note: string },
): Promise<DepositActionOutcome> {
  if (action === 'settle' && !manual) throw new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT');
  if (isElectron() && isStationOffline()) {
    if (action === 'settle') await assertManagerPinOffline(manual!.pin);
    const outcome =
      action === 'retry'
        ? await queueRpc('deposit_refund_retry', { p_payment_id: row.id })
        : action === 'refund'
          ? await queueRpc('deposit_refund_request', { p_payment_id: row.id })
          : await queueRpc('deposit_refund_manual', { p_payment_id: row.id, p_pin: manual!.pin, p_note: manual!.note, p_device_id: deviceId() });
    if (outcome.queued) {
      markDepositQueued(row.id, { action, localId: outcome.localId, status: row.status });
      return 'queued';
    }
    return 'done';
  }
  try {
    if (action === 'retry') await retryDepositRefund(row.id);
    else if (action === 'refund') await requestDepositRefund(row.id);
    else await settleDepositManually(row.id, manual!.pin, manual!.note);
    return 'done';
  } catch (e) {
    if (isSavedOffline(e)) {
      markDepositQueued(row.id, { action, localId: null, status: row.status });
      return 'queued';
    }
    throw e;
  }
}
