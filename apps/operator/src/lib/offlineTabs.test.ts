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
    expect(t.failure).toEqual({ state: 'failed', error: '400: FORBIDDEN' });
    expect(offlineTabState(t)).toBe('failed');

    const k2 = open();
    result({ mutationType: 'tab.open', idempotencyKey: k2, state: 'conflict' });
    expect(getOfflineTab(k2)!.failure).toEqual({ state: 'conflict' });
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
});
