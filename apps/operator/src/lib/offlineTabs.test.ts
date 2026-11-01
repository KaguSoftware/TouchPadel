import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BridgeModule from '../ipc/bridge';

// Ported from fix/offline-signals 59b8c083. Two ways an offline tab used to
// vanish while the money was still the till's to account for: any result on
// its tab.open (a refusal included) retired it, and a settle retired it the
// moment it was ENQUEUED, so a taken payment was visible only in day close.

const h = vi.hoisted(() => ({
  emit: null as null | ((r: BridgeModule.MutationResult) => void),
}));

vi.mock('../ipc/bridge', () => ({
  touch: {
    onMutationResult: (cb: (r: BridgeModule.MutationResult) => void) => {
      h.emit = cb;
      return () => {
        h.emit = null;
      };
    },
  },
}));

import {
  addOfflineTab,
  getOfflineTab,
  initOfflineTabRetirement,
  listOfflineTabs,
  markOfflineSettled,
  offlineTabState,
  removeOfflineTab,
  serverTotalFrom,
} from './offlineTabs';

let n = 0;

function open(): string {
  const key = `TILL1:tab.open:K${n++}`;
  addOfflineTab({ idemKey: key, localId: `L-${key}`, label: null, tableNumber: '3' });
  return key;
}

function result(
  r: Partial<BridgeModule.MutationResult> &
    Pick<BridgeModule.MutationResult, 'mutationType' | 'state'>,
) {
  h.emit!({ localId: 'x', idempotencyKey: 'x', ...r });
}

const onPlan = (k: string) => listOfflineTabs().some((t) => t.idemKey === k);

beforeEach(() => {
  for (const t of listOfflineTabs()) removeOfflineTab(t.idemKey);
  initOfflineTabRetirement();
});

describe('offline tab retirement', () => {
  it('an acked tab.open retires the entry', () => {
    const k = open();
    result({ mutationType: 'tab.open', idempotencyKey: k, state: 'acked' });
    expect(onPlan(k)).toBe(false);
  });

  it('a refused tab.open keeps the tab, its lines and its table, marked failed', () => {
    const k = open();
    result({
      mutationType: 'tab.open',
      idempotencyKey: k,
      state: 'failed',
      error: '400: FORBIDDEN',
    });
    expect(onPlan(k)).toBe(true);
    const t = getOfflineTab(k)!;
    expect(t.failure).toEqual({ state: 'failed', error: '400: FORBIDDEN', on: 'open' });
    expect(offlineTabState(t)).toBe('failed');

    const k2 = open();
    result({ mutationType: 'tab.open', idempotencyKey: k2, state: 'conflict' });
    expect(getOfflineTab(k2)!.failure).toEqual({ state: 'conflict', on: 'open' });
  });

  it('a queued settle keeps the tab on the plan, marked settled, until the settle acks', () => {
    const k = open();
    markOfflineSettled(k, 'TILL1:tab.settle:S1');
    expect(onPlan(k)).toBe(true);
    expect(offlineTabState(getOfflineTab(k)!)).toBe('settled');

    // Another tab's settle does not touch it.
    result({
      mutationType: 'tab.settle',
      idempotencyKey: 'TILL1:tab.settle:OTHER',
      state: 'acked',
    });
    expect(onPlan(k)).toBe(true);

    result({ mutationType: 'tab.settle', idempotencyKey: 'TILL1:tab.settle:S1', state: 'acked' });
    expect(onPlan(k)).toBe(false);
  });

  it('a refused settle keeps the tab, marked failed', () => {
    const k = open();
    markOfflineSettled(k, 'TILL1:tab.settle:S2');
    result({
      mutationType: 'tab.settle',
      idempotencyKey: 'TILL1:tab.settle:S2',
      state: 'failed',
      error: '409: X',
    });
    expect(onPlan(k)).toBe(true);
    expect(offlineTabState(getOfflineTab(k)!)).toBe('failed');
  });

  it("a settle that acked inside mutate()'s wait fires before its key is known, so the store cannot retire it", () => {
    // Why the call sites retire it themselves when mutate() answers queued:false
    // (OfflineTabPanel, ShopTill): the result has already gone by.
    const k = open();
    result({ mutationType: 'tab.settle', idempotencyKey: 'TILL1:tab.settle:FAST', state: 'acked' });
    markOfflineSettled(k, 'TILL1:tab.settle:FAST');
    expect(onPlan(k)).toBe(true);
    removeOfflineTab(k);
  });

  it('an entry restored from an older build (settled, no settle key) stays off the plan', () => {
    const k = open();
    // The pre-fix shape: settled with no settleIdemKey.
    markOfflineSettled(k, 'K');
    const t = getOfflineTab(k)!;
    Object.assign(t, { settleIdemKey: undefined });
    // Re-emit through an unrelated write so the snapshot is recomputed.
    open();
    expect(onPlan(k)).toBe(false);
  });

  // F-09: a payment taken offline is never retired with its tab's open.
  it('a settled tab outlives its open replaying (off the plan) until the settle answers', () => {
    const k = open();
    markOfflineSettled(k, 'TILL1:tab.settle:S3', { method: 'cash', amountIqd: 9000, tenderedIqd: 10000 });
    result({ mutationType: 'tab.open', idempotencyKey: k, state: 'acked' });
    // The server tab now shows on the plan; this entry waits, out of sight.
    expect(onPlan(k)).toBe(false);
    expect(getOfflineTab(k)).toBeTruthy();
    result({ mutationType: 'tab.settle', idempotencyKey: 'TILL1:tab.settle:S3', state: 'acked' });
    expect(getOfflineTab(k)).toBeUndefined();
  });

  it('a settle refused at replay comes back on the plan with its code, the server total and its own key', () => {
    const k = open();
    markOfflineSettled(k, 'TILL1:tab.settle:S4', { method: 'card', amountIqd: 9000, tenderedIqd: null });
    result({ mutationType: 'tab.open', idempotencyKey: k, state: 'acked' });
    result({
      mutationType: 'tab.settle',
      idempotencyKey: 'TILL1:tab.settle:S4',
      state: 'failed',
      serverResult: { error: 'TOTAL_CHANGED', details: 'expected 9000, now 9900' },
    });
    expect(onPlan(k)).toBe(true);
    const t = getOfflineTab(k)!;
    expect(t.failure).toMatchObject({ on: 'settle', code: 'TOTAL_CHANGED', serverTotalIqd: 9900, settleIdemKey: 'TILL1:tab.settle:S4' });
    expect(t.settle).toEqual({ method: 'card', amountIqd: 9000, tenderedIqd: null });

    // Taken again at the server's total: the refusal clears and the new key is waited on.
    markOfflineSettled(k, 'TILL1:tab.settle:S5', { method: 'card', amountIqd: 9900, tenderedIqd: null });
    expect(getOfflineTab(k)!.failure).toBeUndefined();
    expect(onPlan(k)).toBe(false);
    result({ mutationType: 'tab.settle', idempotencyKey: 'TILL1:tab.settle:S5', state: 'acked' });
    expect(getOfflineTab(k)).toBeUndefined();
  });

  it("reads TOTAL_CHANGED's server total from the details or the worker's error text", () => {
    expect(serverTotalFrom({ serverResult: { details: 'expected 5000, now 5750' } })).toBe(5750);
    expect(serverTotalFrom({ error: '409: TOTAL_CHANGED expected 1, now 2' })).toBe(2);
    expect(serverTotalFrom({ serverResult: { error: 'TENDER_SHORT' } })).toBeNull();
  });
});
