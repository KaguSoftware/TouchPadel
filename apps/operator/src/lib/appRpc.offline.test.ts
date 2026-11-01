import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F-23 (0395): offline, an allowlisted save is durably queued instead of
 * failing and taking the change with it. The queue itself is queuedRpc.ts
 * (mocked here); the replay side is packages/db tests/queued-rpc.test.ts.
 */
const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { schema: () => ({ rpc }) } }));
const queueRpc = vi.fn();

const { appRpc, isSavedOffline, setOfflineQueue } = await import('./appRpc');
setOfflineQueue((fn, args) => queueRpc(fn, args));
const { isStationOffline, resetConnectivityForTests, setStationReachable } = await import('./connectivity');
const { errorToMessageKey } = await import('./errors');

beforeEach(() => {
  rpc.mockReset();
  queueRpc.mockReset();
  vi.stubGlobal('window', { touch: {} });
});
afterEach(() => {
  resetConnectivityForTests();
  vi.unstubAllGlobals();
});

describe('appRpc offline (F-23)', () => {
  it('known offline: queues the save without trying, and says it was saved here', async () => {
    setStationReachable(false);
    queueRpc.mockResolvedValue({ queued: true, localId: 'TILL-01-X', idempotencyKey: 'k', result: null });
    const err = await appRpc('set_venue_details', { p_patch: { name: 'x' } }).catch((e: unknown) => e);
    expect(isSavedOffline(err)).toBe(true);
    expect(errorToMessageKey(err)).toBe('op.errors.SAVED_OFFLINE');
    expect(rpc).not.toHaveBeenCalled();
    expect(queueRpc).toHaveBeenCalledWith('set_venue_details', { p_patch: { name: 'x' } });
  });

  it('a call that could not connect is queued, and the station is marked offline', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    queueRpc.mockResolvedValue({ queued: true, localId: 'L', idempotencyKey: 'k', result: null });
    const err = await appRpc('upsert_court', { p_name: 'C1' }).catch((e: unknown) => e);
    expect(isSavedOffline(err)).toBe(true);
    expect(isStationOffline()).toBe(true);
  });

  it('when the queue reaches the server inside the wait after all, the answer comes back as success', async () => {
    setStationReachable(false);
    queueRpc.mockResolvedValue({ queued: false, localId: 'L', idempotencyKey: 'k', result: { id: 'c1' } });
    await expect(appRpc('upsert_court', { p_name: 'C1' })).resolves.toEqual({ id: 'c1' });
  });

  it('a server refusal is never queued', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: 'P0001' }, status: 400 });
    await expect(appRpc('set_venue_details', { p_patch: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(queueRpc).not.toHaveBeenCalled();
    expect(isStationOffline()).toBe(false);
  });

  it('an online-only RPC offline is not queued, and reads as "No connection" (F-31)', async () => {
    setStationReachable(false);
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    const err = await appRpc('open_day', {}).catch((e: unknown) => e);
    expect(queueRpc).not.toHaveBeenCalled();
    expect(errorToMessageKey(err)).toBe('errors.network');
  });

  it('with no queue registered (packages/db, a bare test) nothing is queued', async () => {
    setOfflineQueue(null);
    setStationReachable(false);
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    await expect(appRpc('set_venue_details', { p_patch: {} })).rejects.toBeTruthy();
    expect(queueRpc).not.toHaveBeenCalled();
    setOfflineQueue((fn, args) => queueRpc(fn, args));
  });

  it('in a browser (no shell, no queue) nothing is queued', async () => {
    vi.stubGlobal('window', {});
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    await expect(appRpc('set_venue_details', { p_patch: {} })).rejects.toBeTruthy();
    expect(queueRpc).not.toHaveBeenCalled();
  });
});
