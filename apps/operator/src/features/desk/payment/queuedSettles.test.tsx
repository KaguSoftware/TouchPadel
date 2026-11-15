import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MutationResult } from '../../../ipc/bridge';
import { dispatchResult } from '../../../lib/queueResults';
import { holdQueuedSettle, resetQueuedSettles, useQueuedSettleHeld } from './queuedSettles';

// Audit finding 22: a court payment queued offline holds the desk's pay buttons
// until its answer lands, even when the booking was closed and reopened.

const qc = { invalidateQueries: () => Promise.resolve() };
const result = (localId: string, state: MutationResult['state']): MutationResult => ({
  localId,
  idempotencyKey: `DESK1:tab.settle:${localId}`,
  mutationType: 'tab.settle',
  state,
});

afterEach(() => resetQueuedSettles());

describe('queued court payments (finding 22)', () => {
  it('outlives the panel: a reopened booking still sees the queued payment', () => {
    const first = renderHook(() => useQueuedSettleHeld('tab-1'));
    act(() => holdQueuedSettle('tab-1', 'L1'));
    expect(first.result.current).toBe(true);
    first.unmount();

    const reopened = renderHook(() => useQueuedSettleHeld('tab-1'));
    expect(reopened.result.current).toBe(true);
    expect(renderHook(() => useQueuedSettleHeld('tab-2')).result.current).toBe(false);
  });

  it('lets go when the queued payment is answered, acked or refused', () => {
    const one = renderHook(() => useQueuedSettleHeld('tab-1'));
    const two = renderHook(() => useQueuedSettleHeld('tab-2'));
    act(() => {
      holdQueuedSettle('tab-1', 'L1');
      holdQueuedSettle('tab-2', 'L2');
    });
    act(() => dispatchResult(result('L1', 'acked'), qc));
    expect(one.result.current).toBe(false);
    expect(two.result.current).toBe(true);
    act(() => dispatchResult(result('L2', 'conflict'), qc));
    expect(two.result.current).toBe(false);
  });
});
