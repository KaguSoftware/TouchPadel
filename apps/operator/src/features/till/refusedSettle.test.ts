import { beforeEach, describe, expect, it, vi } from 'vitest';

// F-09: a manager sets a refused queued payment aside from the till, as Day
// close does. Online the PIN is proved first; offline the shell's cache judges.

const h = vi.hoisted(() => ({
  offline: false,
  verify: vi.fn(async (): Promise<string | null> => 'mgr-1'),
  resolve: vi.fn(async (): Promise<unknown> => ({ ok: true })),
  observed: vi.fn(),
}));

vi.mock('../../ipc/bridge', () => ({
  touch: {
    getStation: () => ({ stationId: 'TILL-01' }),
    pinObserved: (...a: unknown[]) => h.observed(...a),
    resolveQueueRow: (...a: unknown[]) => h.resolve(...(a as [])),
  },
}));
vi.mock('../../lib/connectivity', () => ({
  isStationOffline: () => h.offline,
  isTransportFailure: (e: unknown) => e instanceof TypeError,
}));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    constructor(public code: string, message?: string) {
      super(message ?? code);
    }
  },
  appRpc: (...a: unknown[]) => h.verify(...(a as [])),
}));

import { resolveRefusedRow } from './refusedSettle';

beforeEach(() => {
  h.offline = false;
  h.verify.mockReset().mockResolvedValue('mgr-1');
  h.resolve.mockReset().mockResolvedValue({ ok: true });
  h.observed.mockReset();
});

describe('resolveRefusedRow', () => {
  it('online: proves the PIN, then parks the row', async () => {
    await resolveRefusedRow('TILL-01:tab.settle:X', '1234');
    expect(h.verify).toHaveBeenCalledWith('verify_manager_pin', { p_pin: '1234', p_device_id: 'TILL-01' });
    expect(h.observed).toHaveBeenCalledWith('1234', 'mgr-1');
    expect(h.resolve).toHaveBeenCalledWith({ idempotencyKey: 'TILL-01:tab.settle:X', pin: '1234' });
  });

  it('online: a wrong PIN is refused and the row is not touched', async () => {
    h.verify.mockResolvedValue(null);
    await expect(resolveRefusedRow('K', '0000')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("offline: the shell's cache judges; a PIN it does not know is PIN_INVALID at once", async () => {
    h.offline = true;
    h.resolve.mockResolvedValue({ ok: false, error: 'pin not recognised' });
    await expect(resolveRefusedRow('K', '0000')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it('a row that can no longer be resolved says so', async () => {
    h.offline = true;
    h.resolve.mockResolvedValue({ ok: false, error: 'not-resolvable' });
    await expect(resolveRefusedRow('K', '1234')).rejects.toMatchObject({ code: 'QUEUE_ROW_NOT_RESOLVABLE' });
  });

  it('the connection dropping during the check falls through to the cache', async () => {
    h.verify.mockRejectedValue(new TypeError('Failed to fetch'));
    await resolveRefusedRow('K', '1234');
    expect(h.resolve).toHaveBeenCalled();
  });
});
