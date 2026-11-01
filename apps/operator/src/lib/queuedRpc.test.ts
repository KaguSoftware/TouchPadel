import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
vi.mock('./mutate', () => ({ mutate: (...a: unknown[]) => mutate(...a) }));
let resultListener: ((r: { mutationType: string; localId: string }) => void) | null = null;
vi.mock('./appRpc', () => ({ setOfflineQueue: () => {} }));
vi.mock('./queueResults', () => ({
  onResult: (cb: (r: { mutationType: string; localId: string }) => void) => {
    resultListener = cb;
    return () => {};
  },
}));

const { queueRpc, queuedSignature, isQueuedAlready, resetQueuedRpcForTests } = await import('./queuedRpc');

beforeEach(() => {
  mutate.mockReset();
  resetQueuedRpcForTests();
});

describe('queueRpc (0395)', () => {
  it('sends one rpc.queued mutation with the cleaned arguments and the offline tab key', async () => {
    mutate.mockResolvedValue({ queued: true, localId: 'L1', idempotencyKey: 'k', result: null });
    await queueRpc('set_tab_customer', { p_customer_id: 'c', p_unused: undefined }, { tabIdemKey: 'TILL-01:tab.open:01J5XABCDEFGHJKMNPQRSTVWXY' });
    expect(mutate).toHaveBeenCalledWith('rpc.queued', {
      fn: 'set_tab_customer',
      args: { p_customer_id: 'c' },
      tabIdemKey: 'TILL-01:tab.open:01J5XABCDEFGHJKMNPQRSTVWXY',
    });
  });

  it('the same change pressed twice offline is queued once, and again once its row has a result', async () => {
    mutate.mockResolvedValue({ queued: true, localId: 'L1', idempotencyKey: 'k', result: null });
    await queueRpc('set_venue_details', { p_patch: { a: 1, b: 2 } });
    const second = await queueRpc('set_venue_details', { p_patch: { b: 2, a: 1 } });
    expect(second).toMatchObject({ queued: true, localId: 'L1' });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(isQueuedAlready('set_venue_details', { p_patch: { a: 1, b: 2 } })).toBe(true);

    resultListener?.({ mutationType: 'rpc.queued', localId: 'L1' });
    expect(isQueuedAlready('set_venue_details', { p_patch: { a: 1, b: 2 } })).toBe(false);
    await queueRpc('set_venue_details', { p_patch: { a: 1, b: 2 } });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('a different change is its own row', async () => {
    mutate.mockResolvedValue({ queued: true, localId: 'L1', idempotencyKey: 'k', result: null });
    await queueRpc('set_venue_details', { p_patch: { a: 1 } });
    mutate.mockResolvedValue({ queued: true, localId: 'L2', idempotencyKey: 'k', result: null });
    await queueRpc('set_venue_details', { p_patch: { a: 2 } });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('an answered call leaves nothing pending', async () => {
    mutate.mockResolvedValue({ queued: false, localId: 'L1', idempotencyKey: 'k', result: { ok: true } });
    const out = await queueRpc('recall_ticket', { p_ticket_id: 't' });
    expect(out.result).toEqual({ ok: true });
    expect(isQueuedAlready('recall_ticket', { p_ticket_id: 't' })).toBe(false);
  });

  it('signatures ignore key order and undefined values', () => {
    expect(queuedSignature('f', { b: 1, a: { d: 2, c: undefined } })).toBe(queuedSignature('f', { a: { d: 2 }, b: 1 }));
  });
});
