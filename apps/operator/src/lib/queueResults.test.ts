import { describe, expect, it, vi } from 'vitest';
import { MUTATION_TYPES } from '@touch/core/schemas/mutations';
import type { MutationResult } from '../ipc/bridge';
import { RESULT_INVALIDATIONS, awaitResult, dispatchResult, errorStringCode, onFailedResult, onResult, resultErrorCode } from './queueResults';
import { QK, RESERVATION_LIST_KEYS } from './queryKeys';

const serialize = (key: readonly unknown[]) => JSON.stringify(key);

/** Plain registry keys and every family's `all` root — what a fan-out may name. */
function registryRoots(): string[] {
  // `'all' in` rather than Array.isArray: TS does not narrow a union of readonly
  // tuples through Array.isArray, so the family branch would not type.
  return Object.values(QK).map((entry) => serialize('all' in entry ? entry.all : entry));
}

describe('RESULT_INVALIDATIONS', () => {
  it('covers every registered mutation type — a result must always land somewhere', () => {
    expect(Object.keys(RESULT_INVALIDATIONS).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it('names only registry keys and roots — no literal can drift from the screens', () => {
    const allowed = new Set(registryRoots());
    for (const [type, keys] of Object.entries(RESULT_INVALIDATIONS)) {
      for (const key of keys) {
        expect(allowed.has(serialize(key)), `${type} invalidates unregistered ${serialize(key)}`).toBe(true);
      }
    }
  });

  it('money paths invalidate both the tab detail root and the rail', () => {
    for (const type of ['order.add_items', 'tab.settle', 'adjustment.apply', 'tab.cancel', 'tab.settle_zero', 'payment.refund', 'order_item.void']) {
      const keys = RESULT_INVALIDATIONS[type]!.map(serialize);
      expect(keys, type).toContain(serialize(QK.tab.all));
      expect(keys, type).toContain(serialize(QK.tabs));
    }
  });

  it('reservation writes refresh both reservation lists through the shared pair', () => {
    for (const type of ['reservation.create', 'reservation.update']) {
      const keys = RESULT_INVALIDATIONS[type]!.map(serialize);
      for (const key of RESERVATION_LIST_KEYS) expect(keys, type).toContain(serialize(key));
    }
  });
});

describe('awaitResult', () => {
  it('resolves null after the timeout — the write is queued, not lost', async () => {
    const result = await awaitResult('TILL1-01J5XAAAAAAAAAAAAAAAAAAAAA', 10);
    expect(result).toBeNull();
  });
});

const result = (over: Partial<MutationResult> = {}): MutationResult => ({
  localId: 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAB',
  idempotencyKey: 'TILL1:tab.cancel:01J5XAAAAAAAAAAAAAAAAAAAAB',
  mutationType: 'tab.cancel',
  state: 'failed',
  ...over,
});

describe('dispatchResult (item 9)', () => {
  it('invalidates the mapped keys on every terminal result, acked included', () => {
    const qc = { invalidateQueries: vi.fn() };
    dispatchResult(result({ state: 'acked' }), qc);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(RESULT_INVALIDATIONS['tab.cancel']!.length);
  });

  it('a refusal a waiter consumed is NOT re-announced — mutate() throws it to its caller', async () => {
    const qc = { invalidateQueries: vi.fn() };
    const seen: MutationResult[] = [];
    const off = onFailedResult((r) => seen.push(r));
    const localId = 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAC';
    const waiting = awaitResult(localId, 1_000);
    dispatchResult(result({ localId, state: 'failed' }), qc);
    expect((await waiting)?.state).toBe('failed');
    expect(seen).toEqual([]);
    off();
  });

  it('a refusal nobody was waiting for reaches the failed-result listeners once; an ack never does', () => {
    const qc = { invalidateQueries: vi.fn() };
    const seen: MutationResult[] = [];
    const off = onFailedResult((r) => seen.push(r));
    dispatchResult(result({ state: 'conflict' }), qc);
    dispatchResult(result({ state: 'acked', localId: 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAD' }), qc);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toBe('conflict');
    off();
  });
});

describe('onResult', () => {
  it('sees every terminal result, acked included, waiter or not — a screen retires its pending row on any of them', async () => {
    const qc = { invalidateQueries: vi.fn() };
    const seen: string[] = [];
    const off = onResult((r) => seen.push(`${r.localId}:${r.state}`));
    const waited = 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAE';
    const waiting = awaitResult(waited, 1_000);
    dispatchResult(result({ localId: waited, state: 'acked' }), qc);
    dispatchResult(result({ localId: 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAF', state: 'acked' }), qc);
    dispatchResult(result({ localId: 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAG', state: 'failed' }), qc);
    expect((await waiting)?.state).toBe('acked');
    expect(seen).toEqual([`${waited}:acked`, 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAF:acked', 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAG:failed']);
    off();
    dispatchResult(result({ state: 'failed' }), qc);
    expect(seen).toHaveLength(3);
  });
});

describe('errorStringCode', () => {
  it('reads the code after the worker’s status, or leading with its detail, and nothing from prose', () => {
    expect(errorStringCode('400: TAB_NOT_EMPTY')).toBe('TAB_NOT_EMPTY');
    expect(errorStringCode('ITEM_UNAVAILABLE: the item is sold out')).toBe('ITEM_UNAVAILABLE');
    expect(errorStringCode('PIN_INVALID')).toBe('PIN_INVALID');
    // The colon form is anchored first: an upper-case word at the start of prose is not a code.
    expect(errorStringCode('HTTP 503 gateway')).toBeNull();
    expect(errorStringCode('400: the server said no')).toBeNull();
    expect(errorStringCode('network down')).toBeNull();
    expect(errorStringCode(null)).toBeNull();
    expect(errorStringCode(undefined)).toBeNull();
  });
});

describe('resultErrorCode', () => {
  it('prefers the replay function’s upper-snake error, then its code, then the worker’s "400: CODE"', () => {
    expect(resultErrorCode(result({ serverResult: { error: 'REFUND_EXCEEDS_PAYMENT', message: 'paid 5000' } }))).toBe('REFUND_EXCEEDS_PAYMENT');
    expect(resultErrorCode(result({ serverResult: { code: 'TAB_NOT_EMPTY' } }))).toBe('TAB_NOT_EMPTY');
    expect(resultErrorCode(result({ error: '400: PIN_INVALID' }))).toBe('PIN_INVALID');
    expect(resultErrorCode(result({ error: 'ITEM_NOT_ON_TAB: detail' }))).toBe('ITEM_NOT_ON_TAB');
    expect(resultErrorCode(result({ serverResult: { error: 'not a code' }, error: 'network down' }))).toBeNull();
    expect(resultErrorCode(result())).toBeNull();
  });
});
