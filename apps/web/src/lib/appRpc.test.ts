import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@touch/core';
import { t } from '@touch/i18n';
import { appRpc, isRpcError, rpcErrorKey, shouldRefreshMenu } from './appRpc';

/** PostgREST's error object for a `raise exception 'CODE'`. */
const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('rpcErrorKey', () => {
  it('keeps the guest site’s own words for the café and table codes', () => {
    expect(rpcErrorKey(pg('TOKEN_INVALID'))).toBe('cafe.invalidQr');
    expect(rpcErrorKey(pg('SESSION_EXPIRED'))).toBe('errors.sessionTableExpired');
    expect(rpcErrorKey(pg('DEGRADED_LOCKOUT'))).toBe('degraded.orderingRefused');
    expect(rpcErrorKey(pg('ITEM_UNAVAILABLE'))).toBe('cafe.itemUnavailable');
    expect(rpcErrorKey(pg('VENUE_MISMATCH'))).toBe('cafe.itemUnavailable');
    expect(rpcErrorKey(pg('CALL_COOLDOWN'))).toBe('cafe.waiterAlreadyCalled');
    // Not actionable for a guest: the generic line, as before.
    expect(rpcErrorKey(pg('IDEMPOTENCY_CONFLICT'))).toBe('errors.generic');
    expect(rpcErrorKey(pg('VENUE_REQUIRED'))).toBe('errors.generic');
    expect(rpcErrorKey(pg('INVALID_KIND'))).toBe('errors.generic');
  });

  it('the ordering limits a guest can hit now say so (0211), in both languages', () => {
    for (const code of ['TOO_MANY_ORDERS', 'TOO_MANY_ITEMS'] as const) {
      const key = rpcErrorKey(pg(code));
      expect(key).toBe(`op.errors.${code}`);
      expect(t('en', key)).toMatch(/member of staff/);
      expect(t('ar', key)).toMatch(/الموظفين/);
    }
  });

  it('maps a native Postgres error by its SQLSTATE, and anything else to the generic line', () => {
    expect(rpcErrorKey(pg('canceling statement due to statement timeout', '57014'))).toBe(
      'errors.busy',
    );
    expect(
      rpcErrorKey(pg('duplicate key value violates unique constraint "orders_pkey"', '23505')),
    ).toBe('errors.duplicate');
    expect(rpcErrorKey(pg('SOMETHING_NEW'))).toBe('errors.generic');
    expect(rpcErrorKey({ message: 'Failed to fetch' })).toBe('errors.generic');
    expect(rpcErrorKey(null)).toBe('errors.generic');
    expect(rpcErrorKey(undefined)).toBe('errors.generic');
  });
});

describe('isRpcError and shouldRefreshMenu', () => {
  it('compare the exact code', () => {
    expect(isRpcError(pg(' TABLE_NOT_FOUND '), 'TABLE_NOT_FOUND')).toBe(true);
    expect(isRpcError(pg('TABLE_NOT_FOUND'), 'TOKEN_INVALID')).toBe(false);
    expect(shouldRefreshMenu('VARIANT_NOT_FOUND')).toBe(true);
    expect(shouldRefreshMenu('TOO_MANY_ITEMS')).toBe(false);
    expect(shouldRefreshMenu(null)).toBe(false);
  });
});


/**
 * appRpc's deadline: a guest's order on a dying connection used to spin
 * forever. A miss now answers `{ error }` like any refusal, so every caller's
 * existing error path handles it.
 */

/** The real builder's shape: awaitable, abortable, and answering an abort with an error object. */
function builder(result?: { data: unknown; error: unknown }) {
  let signal: AbortSignal | undefined;
  const answer = new Promise<{ data: unknown; error: unknown; status: number }>((resolve) => {
    if (result) {
      resolve({ ...result, status: 200 });
      return;
    }
    queueMicrotask(() =>
      signal?.addEventListener('abort', () =>
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
    seen: () => signal,
  };
}

function client(rpcResult: unknown) {
  const rpc = vi.fn(() => rpcResult);
  return { client: { schema: () => ({ rpc }) } as unknown as SupabaseClient<Database>, rpc };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('appRpc (web)', () => {
  it('answers a call that never comes back with a timeout error after 15 s', async () => {
    vi.useFakeTimers();
    const { client: c } = client(builder());
    const pending = appRpc(c, 'create_guest_order', { p_items: [] } as never);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    const { data, error } = await pending;
    expect(data).toBeNull();
    expect(error?.message).toBe(`TimeoutError: Request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS} ms (create_guest_order)`);
    expect(rpcErrorKey(error)).toBe('errors.generic');
  });

  it('passes a refusal and a result through unchanged, and clears its deadline', async () => {
    vi.useFakeTimers();
    const refused = builder({ data: null, error: { message: 'CAFE_CLOSED' } });
    const { client: c } = client(refused);
    const { error } = await appRpc(c, 'create_guest_order', {} as never);
    expect(rpcErrorKey(error)).toBe('cafe.cafeClosed');
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(refused.seen()?.aborted).toBe(false);

    const ok = builder({ data: { order_id: 'o1' }, error: null });
    const { client: c2 } = client(ok);
    await expect(appRpc(c2, 'create_guest_order', {} as never)).resolves.toMatchObject({ data: { order_id: 'o1' } });
  });

  it('leaves a test double without abortSignal alone', async () => {
    const { client: c, rpc } = client(Promise.resolve({ data: { deleted: true }, error: null }));
    await expect(appRpc(c, 'delete_my_account', { p_confirm: 'DELETE' })).resolves.toEqual({ data: { deleted: true }, error: null });
    expect(rpc).toHaveBeenCalledWith('delete_my_account', { p_confirm: 'DELETE' });
  });
});
