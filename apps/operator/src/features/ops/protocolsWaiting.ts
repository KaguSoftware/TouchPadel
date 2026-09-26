/**
 * What waits on the signed-in person in protocols: app.protocols_waiting_count,
 * `{to_decide, todo}` (build-contracts-2026-09-23 §2.7, §5.2). One read for the
 * rail badge, the /ops "Needs you now" row, the Observe home's Waiting on you
 * row and the Protocols page, all under QK.protocolsWaiting, which holds the
 * payload as returned.
 */
import { appRpc } from '../../lib/appRpc';

export function fetchProtocolsWaiting(): Promise<unknown> {
  return appRpc<unknown>('protocols_waiting_count', {});
}

export interface ProtocolsWaiting {
  toDecide: number;
  todo: number;
}

const count = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function readProtocolsWaiting(payload: unknown): ProtocolsWaiting {
  const p = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  return { toDecide: count(p.to_decide), todo: count(p.todo) };
}

/** Steps to decide and steps to do: "N waiting on you". */
export function protocolsWaitingTotal(payload: unknown): number {
  const w = readProtocolsWaiting(payload);
  return w.toDecide + w.todo;
}
