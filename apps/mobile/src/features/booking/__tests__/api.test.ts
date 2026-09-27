import { describe, expect, it, vi } from 'vitest';
import { confirmBooking } from '../api';

/**
 * The confirm_booking argument shape. Padel is always four players, so the app
 * sends `p_hold_id` and nothing else: `p_players` survives on the server only
 * as a deprecated, ignored parameter for older builds.
 */
function stubClient(rpc: ReturnType<typeof vi.fn>) {
  return { schema: () => ({ rpc }) } as never;
}

describe('confirmBooking args', () => {
  it('sends only p_hold_id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { reservation_id: 'r1' }, error: null });
    await confirmBooking(stubClient(rpc), 'hold-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('confirm_booking', { p_hold_id: 'hold-1' });
  });

  it('never sends p_players', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { reservation_id: 'r1' }, error: null });
    await confirmBooking(stubClient(rpc), 'hold-1');
    const [, args] = rpc.mock.calls[0]!;
    expect(args).not.toHaveProperty('p_players');
    expect(Object.keys(args as object)).toEqual(['p_hold_id']);
  });

  it('throws the RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('HOLD_EXPIRED') });
    await expect(confirmBooking(stubClient(rpc), 'hold-1')).rejects.toThrow('HOLD_EXPIRED');
  });
});
