import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 0115 (S3): the wrapper proves a manager PIN to verify_manager_pin BEFORE a
 * PIN-gated money RPC, so the failed attempt commits in its own round trip and
 * the lockout can engage. These tests pin the ORDER of calls and the arguments;
 * the server side is covered by packages/db/tests/pin-grants.test.ts.
 */
const rpc = vi.fn();
vi.mock('./supabase', () => ({
  supabase: { schema: () => ({ rpc }) },
}));

const { appRpc, AppRpcError } = await import('./appRpc');

beforeEach(() => {
  rpc.mockReset();
});

describe('appRpc: manager-PIN pre-verification', () => {
  it('calls verify_manager_pin first, then the money RPC, with the same pin and device', async () => {
    rpc.mockResolvedValueOnce({ data: 'auth-uuid', error: null });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });

    const out = await appRpc('apply_discount', {
      p_tab_id: 't1',
      p_kind: 'discount_percent',
      p_value: 1000,
      p_pin: '380517',
      p_reason_code: 'test',
      p_device_id: 'TILL-01',
    });

    expect(out).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(['verify_manager_pin', { p_pin: '380517', p_device_id: 'TILL-01' }]);
    expect(rpc.mock.calls[1]?.[0]).toBe('apply_discount');
  });

  it('stops at the verification when the PIN is refused — the money RPC is never called', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PIN_LOCKED', code: 'P0001' } });

    await expect(
      appRpc('refund', { p_payment_id: 'p1', p_amount_iqd: 1000, p_reason_code: 'x', p_pin: '000000' }),
    ).rejects.toMatchObject({ code: 'PIN_LOCKED' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe('verify_manager_pin');
  });

  it('turns a null verification (wrong PIN) into PIN_INVALID and never calls the money RPC', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      appRpc('apply_discount', { p_tab_id: 't1', p_kind: 'discount_percent', p_value: 1, p_pin: '000000', p_reason_code: 'x' }),
    ).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('passes a null device id when the call site has none', async () => {
    rpc.mockResolvedValueOnce({ data: 'auth-uuid', error: null });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await appRpc('write_off_expired', { p_batch_id: 'b1', p_pin: '380517', p_reason_code: 'expired' });
    expect(rpc.mock.calls[0]).toEqual(['verify_manager_pin', { p_pin: '380517', p_device_id: null }]);
  });

  it('does not pre-verify RPCs that are not PIN-gated, even if they carry p_pin', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await appRpc('verify_own_pin', { p_pin: '123456', p_device_id: 'TILL-01' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe('verify_own_pin');
  });

  it('still maps a money-RPC refusal after a good verification', async () => {
    rpc.mockResolvedValueOnce({ data: 'auth-uuid', error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'TAB_NOT_FOUND', code: 'P0001' } });
    await expect(appRpc('override_price', { p_order_item_id: 'oi', p_new_unit_price_iqd: 1, p_pin: '380517', p_reason_code: 'x' }))
      .rejects.toBeInstanceOf(AppRpcError);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
