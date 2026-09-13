import { describe, expect, it, vi } from 'vitest';
import { confirmBooking } from '../api';

/**
 * The confirm_booking argument shape (0090). Old builds send `p_hold_id` alone;
 * this one must send EXACTLY that when no group size was picked, so a hosted
 * schema that predates the parameter keeps accepting the call.
 */
function stubClient(rpc: ReturnType<typeof vi.fn>) {
  return { schema: () => ({ rpc }) } as never;
}

describe('confirmBooking args', () => {
  it('sends only p_hold_id when players is unset', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { reservation_id: 'r1' }, error: null });
    await confirmBooking(stubClient(rpc), 'hold-1');
    expect(rpc).toHaveBeenCalledWith('confirm_booking', { p_hold_id: 'hold-1' });
  });

  it('adds p_players when a valid group size is picked', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { reservation_id: 'r1' }, error: null });
    await confirmBooking(stubClient(rpc), 'hold-1', 4);
    expect(rpc).toHaveBeenCalledWith('confirm_booking', { p_hold_id: 'hold-1', p_players: 4 });
  });

  it('drops an out-of-range value instead of sending it', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { reservation_id: 'r1' }, error: null });
    await confirmBooking(stubClient(rpc), 'hold-1', 9);
    expect(rpc).toHaveBeenCalledWith('confirm_booking', { p_hold_id: 'hold-1' });
  });

  it('throws the RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('HOLD_EXPIRED') });
    await expect(confirmBooking(stubClient(rpc), 'hold-1', 2)).rejects.toThrow('HOLD_EXPIRED');
  });
});
