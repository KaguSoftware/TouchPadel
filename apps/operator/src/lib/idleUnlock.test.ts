import { describe, expect, it, vi } from 'vitest';
import { AppRpcError } from './appRpc';
import { verifyUnlockPin, type UnlockDeps } from './idleUnlock';

function deps(over: Partial<UnlockDeps> = {}): UnlockDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    offline: () => false,
    verifyOnline: vi.fn(async (pin: string) => {
      calls.push('online');
      return pin === '4821';
    }),
    verifyOffline: vi.fn(async (pin: string) => {
      calls.push('offline');
      return pin === '4821';
    }),
    isTransport: (e) => e instanceof TypeError,
    hasCache: true,
    observe: vi.fn(),
    ...over,
  };
}

describe('verifyUnlockPin (F-07)', () => {
  it('online: the server decides, and a PIN it accepts is cached for the next outage', async () => {
    const d = deps();
    expect(await verifyUnlockPin('4821', d)).toEqual({ ok: true, via: 'online' });
    expect(d.observe).toHaveBeenCalledWith('4821');
    expect(d.calls).toEqual(['online']);
  });

  it('online: a wrong PIN is refused and never cached', async () => {
    const d = deps();
    expect(await verifyUnlockPin('0000', d)).toEqual({ ok: false, via: 'online' });
    expect(d.observe).not.toHaveBeenCalled();
  });

  it('known offline: the shell cache decides without trying the server', async () => {
    const d = deps({ offline: () => true });
    expect(await verifyUnlockPin('4821', d)).toEqual({ ok: true, via: 'offline' });
    expect(await verifyUnlockPin('0000', d)).toEqual({ ok: false, via: 'offline' });
    expect(d.calls).toEqual(['offline', 'offline']);
    expect(d.observe).not.toHaveBeenCalled();
  });

  it('a call that never got an answer falls back to the cache: a wrong PIN is refused on the spot', async () => {
    const d = deps({
      verifyOnline: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    expect(await verifyUnlockPin('0000', d)).toEqual({ ok: false, via: 'offline' });
    expect(await verifyUnlockPin('4821', d)).toEqual({ ok: true, via: 'offline' });
  });

  it('a server ANSWER (NO_PIN_SET, PIN_LOCKED) is thrown back, never second-guessed by the cache', async () => {
    const d = deps({
      verifyOnline: vi.fn(async () => {
        throw new AppRpcError('PIN_LOCKED', 'PIN_LOCKED');
      }),
    });
    await expect(verifyUnlockPin('4821', d)).rejects.toMatchObject({ code: 'PIN_LOCKED' });
    expect(d.verifyOffline).not.toHaveBeenCalled();
  });

  it('browser mode has no cache: offline is the connection error, not "Incorrect PIN"', async () => {
    const d = deps({
      hasCache: false,
      offline: () => true,
      verifyOnline: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(verifyUnlockPin('4821', d)).rejects.toBeInstanceOf(TypeError);
    expect(d.verifyOffline).not.toHaveBeenCalled();
  });
});
