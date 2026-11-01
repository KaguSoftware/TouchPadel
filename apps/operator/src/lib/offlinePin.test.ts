import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F-05 / F-07: offline, the station's own PIN cache answers on the spot.
 * The shell side (the hashes, the tiers) is apps/operator-shell pin-cache.test.ts.
 */
const unlockPin = vi.fn();
const unlockOwnPin = vi.fn();
vi.mock('../ipc/bridge', () => ({ touch: { unlockPin: (p: string) => unlockPin(p), unlockOwnPin: (p: string) => unlockOwnPin(p) } }));

const { assertManagerPinOffline, managerPinOnFile, verifyOwnPinOffline } = await import('./offlinePin');
const { resetConnectivityForTests, setStationReachable } = await import('./connectivity');

beforeEach(() => {
  unlockPin.mockReset();
  unlockOwnPin.mockReset();
  vi.stubGlobal('window', { touch: {} });
});
afterEach(() => {
  resetConnectivityForTests();
  vi.unstubAllGlobals();
});

describe('assertManagerPinOffline', () => {
  it('online, asks nothing locally: the server judges', async () => {
    await expect(assertManagerPinOffline('1234')).resolves.toBeUndefined();
    expect(await managerPinOnFile('1234')).toBeNull();
    expect(unlockPin).not.toHaveBeenCalled();
  });

  it('offline, refuses a PIN the cache does not know at once, as PIN_INVALID', async () => {
    setStationReachable(false);
    unlockPin.mockResolvedValue(null);
    await expect(assertManagerPinOffline('9999')).rejects.toMatchObject({ code: 'PIN_INVALID' });
  });

  it('offline, lets a cached manager PIN through', async () => {
    setStationReachable(false);
    unlockPin.mockResolvedValue({ role: 'manager', grantToken: 'x', staffId: 's' });
    await expect(assertManagerPinOffline('1234')).resolves.toBeUndefined();
  });

  it('offline, a shell that answers with an IPC error refuses rather than lets through', async () => {
    setStationReachable(false);
    unlockPin.mockResolvedValue({ error: 'pin must be 4-12 digits' });
    await expect(assertManagerPinOffline('12')).rejects.toMatchObject({ code: 'PIN_INVALID' });
  });

  it('in a browser (no shell) never checks locally', async () => {
    vi.stubGlobal('window', {});
    setStationReachable(false);
    await expect(assertManagerPinOffline('9999')).resolves.toBeUndefined();
  });
});

describe('verifyOwnPinOffline (F-07)', () => {
  it('is true only when the shell says the PIN is the signed-in person\'s own', async () => {
    unlockOwnPin.mockResolvedValueOnce(true);
    expect(await verifyOwnPinOffline('5150')).toBe(true);
    unlockOwnPin.mockResolvedValueOnce(false);
    expect(await verifyOwnPinOffline('5150')).toBe(false);
    unlockOwnPin.mockResolvedValueOnce({ error: 'bad' });
    expect(await verifyOwnPinOffline('5150')).toBe(false);
    unlockOwnPin.mockRejectedValueOnce(new Error('ipc down'));
    expect(await verifyOwnPinOffline('5150')).toBe(false);
  });
});
