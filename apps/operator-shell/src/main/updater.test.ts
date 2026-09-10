import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoUpdater, __calls, __reset } from 'electron-updater';
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  startUpdater,
  type UpdaterHandle,
} from './updater';

// electron-updater is aliased to test/electron-updater-stub.ts; the cast keeps
// the stub's extra members visible without widening the real type.
const stub = autoUpdater as unknown as typeof autoUpdater & { failNextCheck: Error | null };

let handle: UpdaterHandle | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  __reset();
});

afterEach(() => {
  handle?.stop();
  handle = null;
  vi.useRealTimers();
});

describe('startUpdater', () => {
  it('does nothing at all when not packaged', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = startUpdater({ enabled: false, onReady: vi.fn() });
    expect(handle).toBeNull();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(__calls).toEqual([]);
  });

  it('checks after the first delay and then on the interval, downloading silently', async () => {
    handle = startUpdater({ enabled: true, onReady: vi.fn() });
    expect(handle).not.toBeNull();
    expect(stub.autoDownload).toBe(true);
    expect(stub.autoInstallOnAppQuit).toBe(true);
    expect(stub.allowPrerelease).toBe(false);
    expect(__calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(__calls).toEqual(['check']);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(__calls).toEqual(['check', 'check']);
  });

  it('a failed check (offline) is logged, never thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = startUpdater({ enabled: true, onReady: vi.fn() });
    stub.failNextCheck = new Error('getaddrinfo ENOTFOUND github.com');
    handle!.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith('[updater] check failed:', 'getaddrinfo ENOTFOUND github.com');
    stub.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(error).toHaveBeenCalledWith('[updater]', 'net::ERR_INTERNET_DISCONNECTED');
  });

  it('reports a downloaded update and installs only once one is waiting', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onReady = vi.fn();
    handle = startUpdater({ enabled: true, onReady });
    expect(handle!.ready()).toBeNull();
    expect(handle!.installNow()).toBe(false);
    expect(handle!.installOnQuit()).toBe(false);
    expect(__calls).toEqual([]);

    stub.emit('update-downloaded', { version: '0.2.0' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.0' });
    expect(handle!.ready()).toEqual({ version: '0.2.0' });

    expect(handle!.installNow()).toBe(true);
    expect(__calls).toEqual(['install:silent:relaunch']);
    expect(handle!.installOnQuit()).toBe(true);
    expect(__calls).toEqual(['install:silent:relaunch', 'install:silent:stay']);
  });

  it('stop() cancels the timers', async () => {
    handle = startUpdater({ enabled: true, onReady: vi.fn() });
    handle!.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(__calls).toEqual([]);
    handle = null;
  });
});
