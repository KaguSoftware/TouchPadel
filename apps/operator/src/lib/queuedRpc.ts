/**
 * One allowlisted RPC through the durable queue — the 'rpc.queued' mutation
 * (0395; F-23 admin saves, F-56 the shop sale's member, F-57 the kitchen
 * recall, F-58 the deposit actions).
 *
 * Two ways in:
 *  - `queueRpc(fn, args)`: a screen that wants the queue on purpose (the KDS
 *    recall, a member on a tab opened offline). Like every mutate() type it
 *    rides the queue online too, and resolves `{ queued, result }`.
 *  - `appRpc(fn, args)` of a QUEUEABLE_RPCS name while the station is offline
 *    (lib/appRpc.ts): the save is queued here instead of failing with "No
 *    connection", and appRpc throws SavedOfflineError so the page keeps its
 *    draft and says "Saved on this station; it will be sent when the
 *    connection is back" — which is now true (the connectivity strip says the
 *    same).
 *
 * Exactly once: replay hands the envelope's key to app.queued_rpc, which
 * claims it in the same transaction as the write (app.claim_replay). A save
 * pressed twice offline with the same arguments is queued once (`pending`
 * below), so an editor that keeps its draft after the notice cannot stack
 * copies of one change.
 */
import type { MutateOutcome } from './mutate';
import { mutate } from './mutate';
import { onResult } from './queueResults';
import { setOfflineQueue } from './appRpc';
import type { QueueableRpc } from '@touch/core/schemas/mutations';

export type { QueueableRpc } from '@touch/core/schemas/mutations';

export interface QueueRpcOptions {
  /** A tab opened offline: its tab.open envelope's key; replay fills p_tab_id from it. */
  tabIdemKey?: string;
}

/** Stable JSON: object keys sorted, so the same change always reads the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The same RPC with the same arguments: one queued row, however often it is pressed. */
export function queuedSignature(fn: string, args: Record<string, unknown>, opts: QueueRpcOptions = {}): string {
  return `${fn}|${stable(args)}|${opts.tabIdemKey ?? ''}`;
}

/** signature -> the localId of its row still waiting in the queue. */
const pending = new Map<string, string>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  try {
    onResult((r) => {
      if (r.mutationType !== 'rpc.queued') return;
      for (const [sig, localId] of pending) if (localId === r.localId) pending.delete(sig);
    });
  } catch {
    listening = false;
  }
}

/** Is an identical call already waiting in the queue? */
export function isQueuedAlready(fn: string, args: Record<string, unknown>, opts: QueueRpcOptions = {}): boolean {
  return pending.has(queuedSignature(fn, args, opts));
}

/** Tests only. */
export function resetQueuedRpcForTests(): void {
  pending.clear();
}

/** Drop undefined values: JSON would, and the payload schema reads what JSON keeps. */
function clean(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Queue one allowlisted RPC. Resolves like mutate(): `queued: false` with the
 * RPC's own answer when the server took it inside the wait, `queued: true`
 * when it is safe on disk and will be sent later. A call identical to one
 * still waiting resolves `queued: true` without a second row.
 */
export async function queueRpc<T = unknown>(
  fn: QueueableRpc,
  args: Record<string, unknown>,
  opts: QueueRpcOptions = {},
): Promise<MutateOutcome<T>> {
  const cleaned = clean(args);
  const sig = queuedSignature(fn, cleaned, opts);
  const waiting = pending.get(sig);
  if (waiting) return { queued: true, localId: waiting, idempotencyKey: '', result: null };
  listen();
  const outcome = await mutate<T>('rpc.queued', {
    fn,
    args: cleaned,
    ...(opts.tabIdemKey ? { tabIdemKey: opts.tabIdemKey } : {}),
  });
  if (outcome.queued) pending.set(sig, outcome.localId);
  return outcome;
}

// appRpc queues an allowlisted save through this while offline (F-23).
setOfflineQueue((fn, args) => queueRpc(fn, args));
