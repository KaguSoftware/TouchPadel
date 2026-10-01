import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@touch/core';
import { appRpc, rpcErrorKey } from './appRpc';

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
