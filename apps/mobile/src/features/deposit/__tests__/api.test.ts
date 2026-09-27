import { describe, expect, it, vi } from 'vitest';
import { depositBegin, depositQuote, depositStatus } from '../api';
import { DepositEdgeError } from '../logic';

/**
 * The deposit's three call shapes (build-contracts-2026-09-27 §2.2, §3), on a
 * stub client, and the edge refusal parsing: a refused call surfaces its body
 * code, a dropped one rethrows the fetch error for lib/network.ts.
 */

function rpcClient(rpc: ReturnType<typeof vi.fn>) {
  const app = { rpc };
  return { schema: vi.fn(() => app), app } as never as {
    schema: ReturnType<typeof vi.fn>;
    app: { rpc: ReturnType<typeof vi.fn> };
  };
}

function edgeClient(invoke: ReturnType<typeof vi.fn>) {
  return { functions: { invoke } } as never;
}

/** supabase-js's FunctionsHttpError: the Response rides on `context`. */
function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  };
}

describe('depositQuote', () => {
  it('calls app.deposit_quote with the hold, on the app schema, bound', async () => {
    const rpc = vi.fn(function (this: unknown) {
      // PostgREST's rpc reads its own `this` (url, headers): it must not be detached.
      expect(this).toBe(client.app);
      return Promise.resolve({
        data: { deposit_mode: 'optional', deposit_iqd: 20000, price_iqd: 40000, rest_iqd: 20000 },
        error: null,
      });
    });
    const client = rpcClient(rpc);
    const q = await depositQuote(client as never, 'hold-1');
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(rpc).toHaveBeenCalledWith('deposit_quote', { p_hold_id: 'hold-1' });
    expect(q.mode).toBe('optional');
    expect(q.depositIqd).toBe(20000);
  });

  it('throws the RPC error', async () => {
    const client = rpcClient(vi.fn().mockResolvedValue({ data: null, error: new Error('FORBIDDEN') }));
    await expect(depositQuote(client as never, 'hold-1')).rejects.toThrow('FORBIDDEN');
  });
});

describe('depositBegin', () => {
  it('posts the hold and the locale to deposit-begin', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { request_id: 'r-1', form_url: 'https://pay', amount_iqd: 20000, deadline_at: 'd', status: 'pending' },
      error: null,
    });
    const begin = await depositBegin(edgeClient(invoke), { holdId: 'hold-1', locale: 'ar' });
    expect(invoke).toHaveBeenCalledWith('deposit-begin', { body: { hold_id: 'hold-1', locale: 'ar' } });
    expect(begin).toEqual({ ref: 'r-1', formUrl: 'https://pay', amountIqd: 20000, deadlineAt: 'd' });
  });

  it('surfaces a refusal as its body code, with the status', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: httpError(503, { error: 'PROVIDER_UNAVAILABLE', message: 'qi down' }),
    });
    const err = await depositBegin(edgeClient(invoke), { holdId: 'h', locale: 'en' }).catch((e) => e);
    expect(err).toBeInstanceOf(DepositEdgeError);
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.status).toBe(503);
    expect(err.message).toBe('PROVIDER_UNAVAILABLE');
  });

  it('reads a refusal with no JSON body as a code-less refusal', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', context: { status: 500, json: async () => { throw new Error('html'); } } },
    });
    const err = await depositBegin(edgeClient(invoke), { holdId: 'h', locale: 'en' }).catch((e) => e);
    expect(err).toBeInstanceOf(DepositEdgeError);
    expect(err.code).toBeNull();
  });

  it('rethrows the fetch error when nothing came back', async () => {
    const dropped = new TypeError('Network request failed');
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request', context: dropped },
    });
    await expect(depositBegin(edgeClient(invoke), { holdId: 'h', locale: 'en' })).rejects.toBe(dropped);
  });
});

describe('depositStatus', () => {
  it('posts the ref to deposit-status and parses the answer', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { request_id: 'r-1', status: 'pending', deadline_at: 'd', hold_live: true },
      error: null,
    });
    const s = await depositStatus(edgeClient(invoke), 'r-1');
    expect(invoke).toHaveBeenCalledWith('deposit-status', { body: { ref: 'r-1' } });
    expect(s.status).toBe('pending');
    expect(s.holdLive).toBe(true);
  });

  it('surfaces PAYMENT_NOT_FOUND as its code', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: httpError(404, { error: 'PAYMENT_NOT_FOUND' }) });
    await expect(depositStatus(edgeClient(invoke), 'nope')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
      status: 404,
    });
  });
});
