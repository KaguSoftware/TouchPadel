import { describe, expect, it, vi } from 'vitest';

// F-05: closing someone's shift offline with a wrong manager PIN is refused
// on the spot from the station's cache, before any call goes out.

const h = vi.hoisted(() => ({ appRpc: vi.fn(), pinOk: false }));

vi.mock('../../lib/offlinePin', () => ({
  assertManagerPinOffline: async () => {
    if (!h.pinOk) throw Object.assign(new Error('PIN_INVALID'), { code: 'PIN_INVALID' });
  },
}));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class extends Error {},
  appRpc: (...a: unknown[]) => h.appRpc(...a),
}));
vi.mock('../../lib/idem', () => ({ deviceId: () => 'TILL-01' }));
vi.mock('../../ipc/bridge', () => ({ touch: { getStation: () => ({ mode: 'till', appVersion: 'x' }), pinObserved: vi.fn() } }));

import { closeShiftWithManager } from './api';

describe('closeShiftWithManager offline (F-05)', () => {
  it('a PIN the station does not know is refused before anything is sent', async () => {
    h.pinOk = false;
    await expect(closeShiftWithManager({ shiftId: 's', countedIqd: 0, managerPin: '0000', note: null, key: 'k' })).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(h.appRpc).not.toHaveBeenCalled();
  });
});
