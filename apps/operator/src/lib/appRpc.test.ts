import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  LONG_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  isRetryableError,
} from '@touch/core';

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

const { appRpc, AppRpcError, rpcTimeoutMs } = await import('./appRpc');

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

describe('appRpc: every call has a deadline', () => {
  /** The real builder's shape: awaitable, and `.abortSignal()` returns the awaitable. */
  function hangingBuilder() {
    let signal: AbortSignal | undefined;
    const answer = new Promise<{ data: null; error: { message: string; code: string }; status: number }>((resolve) => {
      queueMicrotask(() =>
        signal?.addEventListener('abort', () =>
          // What postgrest-js answers for an aborted fetch: an error object, not a throw.
          resolve({ data: null, error: { message: 'AbortError: signal is aborted without reason', code: '' }, status: 0 }),
        ),
      );
    });
    return {
      then: answer.then.bind(answer),
      abortSignal(s: AbortSignal) {
        signal = s;
        return answer;
      },
      signal: () => signal,
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a call that never answers throws a retryable RequestTimeoutError after 15 s', async () => {
    vi.useFakeTimers();
    const builder = hangingBuilder();
    rpc.mockReturnValueOnce(builder);
    const caught = appRpc('customer_record', { p_customer_id: 'c1' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    const err = await caught;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect((err as Error).message).toContain('customer_record');
    expect(isRetryableError(err)).toBe(true);
    // A TypeError: lib/errors.ts shows it as a connection problem.
    expect(err).toBeInstanceOf(TypeError);
  });

  it('report and analytics RPCs get the long deadline; a call site may set its own or none', async () => {
    expect(rpcTimeoutMs('report_drill')).toBe(LONG_REQUEST_TIMEOUT_MS);
    expect(rpcTimeoutMs('analytics_daily_sales')).toBe(LONG_REQUEST_TIMEOUT_MS);
    expect(rpcTimeoutMs('customer_record')).toBe(DEFAULT_REQUEST_TIMEOUT_MS);

    vi.useFakeTimers();
    const slow = hangingBuilder();
    rpc.mockReturnValueOnce(slow);
    const caught = appRpc('report_drill', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(slow.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(LONG_REQUEST_TIMEOUT_MS - DEFAULT_REQUEST_TIMEOUT_MS);
    expect(await caught).toBeInstanceOf(RequestTimeoutError);

    rpc.mockResolvedValueOnce({ data: 1, error: null });
    await expect(appRpc('customer_record', {}, { timeoutMs: null })).resolves.toBe(1);
  });

  it('a refusal is still the refusal, with its SQLSTATE kept for the retry policy', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'FORBIDDEN', code: 'P0001' }, status: 400 });
    const err = (await appRpc('customer_record', {}).catch((e: unknown) => e)) as InstanceType<typeof AppRpcError>;
    expect(err).toBeInstanceOf(AppRpcError);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.pgCode).toBe('P0001');
    expect(err.status).toBe(400);
    expect(isRetryableError(err)).toBe(false);
  });
});

describe('toAppRpcError: a function the server does not have (operator.md §5.5)', () => {
  it('mints RPC_MISSING from PostgREST PGRST202, whatever the message says', async () => {
    const { toAppRpcError, isRpcMissing } = await import('./appRpc');
    const err = toAppRpcError({
      code: 'PGRST202',
      message: 'Could not find the function app.desk_open_matches(p_from, p_to) in the schema cache',
      hint: 'Perhaps you meant to call the function app.desk_match_states',
      details: 'Searched for the function app.desk_open_matches with parameters p_from, p_to',
    });
    expect(err.code).toBe('RPC_MISSING');
    expect(err.hint).toContain('Perhaps');
    expect(isRpcMissing(err)).toBe(true);
    // A raised code is still the code; a network failure is not a missing RPC.
    expect(toAppRpcError({ code: 'P0001', message: 'MATCH_NOT_FOUND' }).code).toBe('MATCH_NOT_FOUND');
    expect(isRpcMissing(toAppRpcError({ code: 'P0001', message: 'MATCH_NOT_FOUND' }))).toBe(false);
    expect(isRpcMissing(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('surfaces RPC_MISSING from a call the way every other refusal is thrown', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(appRpc('match_settings', {})).rejects.toMatchObject({ code: 'RPC_MISSING' });
  });
});
