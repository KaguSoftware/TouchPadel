import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoUpdater as squirrelMac } from 'electron';
import { autoUpdater, __calls, __reset } from 'electron-updater';
import {
  INSTALL_QUIT_FALLBACK_MS,
  UPDATER_LOG_MAX_BYTES,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  createUpdaterLog,
  startUpdater,
  type UpdaterHandle,
} from './updater';

// electron-updater is aliased to test/electron-updater-stub.ts; the cast keeps
// the stub's extra members visible without widening the real type.
const stub = autoUpdater as unknown as typeof autoUpdater & { failNextCheck: Error | null };

let handle: UpdaterHandle | null = null;

/** Windows unless a test says otherwise: that is what the tills run. */
function start(overrides: Partial<Parameters<typeof startUpdater>[0]> = {}) {
  return startUpdater({
    enabled: true,
    onReady: vi.fn(),
    allowClose: () => __calls.push('allowClose'),
    exit: (code) => __calls.push(`exit:${code}`),
    platform: 'win32',
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __reset();
  squirrelMac.removeAllListeners();
});

afterEach(() => {
  handle?.stop();
  handle = null;
  vi.useRealTimers();
});

describe('startUpdater', () => {
  it('does nothing at all when not packaged', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = start({ enabled: false });
    expect(handle).toBeNull();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(__calls).toEqual([]);
  });

  it('checks after the first delay and then on the interval, downloading silently', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = start();
    expect(handle).not.toBeNull();
    expect(stub.autoDownload).toBe(true);
    expect(stub.autoInstallOnAppQuit).toBe(true);
    expect(stub.allowPrerelease).toBe(false);
    expect(stub.logger).not.toBe(console);
    expect(__calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(__calls).toEqual(['check']);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(__calls).toEqual(['check', 'check']);
  });

  it('a failed check (offline) is logged, never thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = start();
    stub.failNextCheck = new Error('getaddrinfo ENOTFOUND github.com');
    handle!.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith('[updater]', 'check failed: getaddrinfo ENOTFOUND github.com');
    stub.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(error).toHaveBeenCalledWith('[updater]', 'net::ERR_INTERNET_DISCONNECTED');
  });

  it('reports a downloaded update and installs only once one is waiting', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onReady = vi.fn();
    handle = start({ onReady });
    expect(handle!.ready()).toBeNull();
    expect(handle!.installNow()).toBe(false);
    expect(handle!.installOnQuit()).toBe(false);
    expect(__calls).toEqual([]);

    stub.emit('update-downloaded', { version: '0.2.0' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.0' });
    expect(handle!.ready()).toEqual({ version: '0.2.0' });
  });

  // A till's window is closable:false, and Electron cancels app.quit() — the
  // way every install quits — on a window that cannot close.
  it('Restart to update makes the windows closable, then installs and relaunches', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = start();
    stub.emit('update-downloaded', { version: '0.2.0' });

    expect(handle!.installNow()).toBe(true);
    expect(__calls).toEqual(['allowClose', 'install:silent:relaunch']);
    expect(stub.autoRunAppAfterInstall).toBe(true);

    // No hard exit on this path: it would leave the till closed, not restarted.
    handle!.stop();
    vi.advanceTimersByTime(INSTALL_QUIT_FALLBACK_MS * 10);
    expect(__calls).toEqual(['allowClose', 'install:silent:relaunch']);
  });

  it('Quit to desktop makes the windows closable, installs without relaunching, and exits if the quit stalls', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handle = start();
    stub.emit('update-downloaded', { version: '0.2.0' });

    expect(handle!.installOnQuit()).toBe(true);
    expect(__calls).toEqual(['allowClose', 'install:silent:stay']);
    // MacUpdater ignores quitAndInstall's arguments and relaunches unless this is off.
    expect(stub.autoRunAppAfterInstall).toBe(false);

    // The window closing mid-quit stops the updater; the fallback must survive it.
    handle!.stop();
    vi.advanceTimersByTime(INSTALL_QUIT_FALLBACK_MS - 1);
    expect(__calls).not.toContain('exit:0');
    vi.advanceTimersByTime(1);
    expect(__calls).toEqual(['allowClose', 'install:silent:stay', 'exit:0']);
    expect(warn).toHaveBeenCalled();
  });

  it('on macOS, offers an update only once Squirrel.Mac has it too', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onReady = vi.fn();
    handle = start({ onReady, platform: 'darwin' });

    stub.emit('update-downloaded', { version: '0.2.0' });
    expect(onReady).not.toHaveBeenCalled();
    expect(handle!.ready()).toBeNull();
    // Quit to desktop falls through to its plain app.exit meanwhile.
    expect(handle!.installOnQuit()).toBe(false);
    expect(__calls).toEqual([]);

    squirrelMac.emit('update-downloaded');
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.0' });
    expect(handle!.ready()).toEqual({ version: '0.2.0' });
  });

  it('does not listen to Squirrel.Mac off macOS', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = start();
    expect(squirrelMac.listenerCount('update-downloaded')).toBe(0);
  });

  it('stop() cancels the timers', async () => {
    handle = start();
    handle!.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(__calls).toEqual([]);
    handle = null;
  });
});

describe('createUpdaterLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-updater-log-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends every level to the file', () => {
    const file = path.join(dir, 'updater.log');
    const log = createUpdaterLog(file);
    log.info('checking');
    log.error(new Error('net::ERR_INTERNET_DISCONNECTED'));
    log.debug?.('Proxy server for native Squirrel.Mac is listening');
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines[0]).toMatch(/ info checking$/);
    expect(lines[1]).toMatch(/ error Error: net::ERR_INTERNET_DISCONNECTED$/);
    expect(lines.at(-1)).toMatch(/ debug Proxy server for native Squirrel\.Mac is listening$/);
  });

  it('rolls the file over past the size cap', () => {
    const file = path.join(dir, 'updater.log');
    fs.writeFileSync(file, 'x'.repeat(UPDATER_LOG_MAX_BYTES + 1));
    createUpdaterLog(file).info('fresh');
    expect(fs.statSync(`${file}.1`).size).toBe(UPDATER_LOG_MAX_BYTES + 1);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/ info fresh\n$/);
  });

  it('a log it cannot write is reported, never thrown', () => {
    const log = createUpdaterLog(path.join(dir, 'missing', 'updater.log'));
    expect(() => log.warn('still here')).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('[updater] log write failed:', expect.any(String));
  });
});
