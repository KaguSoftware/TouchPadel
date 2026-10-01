import { describe, expect, it, vi } from 'vitest';
import { cancelReservationSettled, confirmBooking } from '../api';

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

/**
 * The lost-answer cancel: the first cancel committed, its answer never came
 * back, and the next attempt got NOT_CANCELLABLE — the guest read "can't be
 * cancelled" about a booking that was cancelled.
 */
describe('cancelReservationSettled', () => {
  const notCancellable = { data: null, error: { message: 'NOT_CANCELLABLE', code: 'P0001' } };
  const row = (status: string, cancelledBy: string | null = 'guest') => ({
    data: [{ id: 'r1', status, cancelled_by: cancelledBy, court_id: 'c1', kind: 'booking', start_at: 'x', end_at: 'y', price_iqd: 1 }],
    error: null,
  });

  it('passes a plain cancel straight through', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { reservation_id: 'r1', status: 'cancelled', cancelled_by: 'guest' }, error: null });
    await expect(cancelReservationSettled(stubClient(rpc), 'r1')).resolves.toEqual({
      reservation_id: 'r1',
      status: 'cancelled',
      cancelled_by: 'guest',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('cancel_reservation', { p_reservation_id: 'r1' });
  });

  it('a NOT_CANCELLABLE on a booking that IS cancelled is the success it was', async () => {
    const rpc = vi.fn().mockResolvedValueOnce(notCancellable).mockResolvedValueOnce(row('cancelled'));
    await expect(cancelReservationSettled(stubClient(rpc), 'r1')).resolves.toEqual({
      reservation_id: 'r1',
      status: 'cancelled',
      cancelled_by: 'guest',
      alreadyCancelled: true,
    });
    // It re-read the booking, and did not send the cancel again.
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['cancel_reservation', 'my_reservations']);
    expect(rpc).toHaveBeenLastCalledWith('my_reservations', { p_reservation_id: 'r1' });
  });

  it('a NOT_CANCELLABLE on a booking still live is the refusal it says', async () => {
    const rpc = vi.fn().mockResolvedValueOnce(notCancellable).mockResolvedValueOnce(row('confirmed', null));
    await expect(cancelReservationSettled(stubClient(rpc), 'r1')).rejects.toMatchObject({ message: 'NOT_CANCELLABLE' });
  });

  it('the refusal stands when the re-read finds nothing or fails', async () => {
    const empty = vi.fn().mockResolvedValueOnce(notCancellable).mockResolvedValueOnce({ data: [], error: null });
    await expect(cancelReservationSettled(stubClient(empty), 'r1')).rejects.toMatchObject({ message: 'NOT_CANCELLABLE' });
    const broken = vi
      .fn()
      .mockResolvedValueOnce(notCancellable)
      .mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed', code: '' } });
    await expect(cancelReservationSettled(stubClient(broken), 'r1')).rejects.toMatchObject({ message: 'NOT_CANCELLABLE' });
  });

  it('any other error is not second-guessed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: 'P0001' } });
    await expect(cancelReservationSettled(stubClient(rpc), 'r1')).rejects.toMatchObject({ message: 'FORBIDDEN' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
