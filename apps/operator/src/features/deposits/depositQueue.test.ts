import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationResult } from '../../ipc/bridge';

// F-58: the queued marks on online-refund rows, and how they go.

const h = vi.hoisted(() => ({ emit: null as null | ((r: MutationResult) => void) }));

vi.mock('../../lib/queueResults', () => ({
  onResult: (cb: (r: MutationResult) => void) => {
    h.emit = cb;
    return () => {};
  },
}));
vi.mock('../../lib/queuedRpc', () => ({ queueRpc: vi.fn() }));
vi.mock('../../lib/offlinePin', () => ({ assertManagerPinOffline: vi.fn() }));
vi.mock('../../lib/mutate', () => ({ isElectron: () => false }));
vi.mock('../../lib/connectivity', () => ({ isStationOffline: () => false }));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
  isSavedOffline: () => false,
}));
vi.mock('./depositApi', () => ({ requestDepositRefund: vi.fn(), retryDepositRefund: vi.fn(), settleDepositManually: vi.fn() }));

import { markDepositQueued, markStillCurrent, queuedDepositAction, resetDepositQueueForTests } from './depositQueue';

const result = (r: Partial<MutationResult>) =>
  h.emit!({ localId: 'x', idempotencyKey: 'k', mutationType: 'rpc.queued', state: 'acked', ...r });

beforeEach(() => resetDepositQueueForTests());

describe('deposit queue marks', () => {
  it('a mark is current while the server still lists the row in the status it was queued against', () => {
    const mark = { action: 'retry' as const, localId: 'L', status: 'refund_failed' };
    expect(markStillCurrent(mark, { status: 'refund_failed' })).toBe(true);
    expect(markStillCurrent(mark, { status: 'refund_pending' })).toBe(false);
    expect(markStillCurrent(null, { status: 'refund_failed' })).toBe(false);
  });

  it('the queued write acking retires the mark', () => {
    markDepositQueued('pay-1', { action: 'retry', localId: 'L-1', status: 'refund_failed' });
    result({ localId: 'OTHER' });
    expect(queuedDepositAction('pay-1')).not.toBeNull();
    result({ localId: 'L-1' });
    expect(queuedDepositAction('pay-1')).toBeNull();
  });

  it('a refusal at replay stays on the row, said in words, and the actions come back', () => {
    markDepositQueued('pay-1', { action: 'settle', localId: 'L-2', status: 'refund_failed' });
    result({ localId: 'L-2', state: 'failed', error: '400: PIN_INVALID' });
    expect(queuedDepositAction('pay-1')).toMatchObject({ refused: '400: PIN_INVALID', localId: null });
  });
});
