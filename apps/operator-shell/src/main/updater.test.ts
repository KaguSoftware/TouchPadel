import type * as ChildProcess from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoUpdater as squirrelMac } from 'electron';
import { autoUpdater, __calls, __reset } from 'electron-updater';
import {
  INSTALL_QUIT_FALLBACK_MS,
  NSIS_APP_GUID,
  REG_QUERY_TIMEOUT_MS,
  STARTUP_CHECK_RETRY_MS,
  STARTUP_INSTALL_WAIT_MAC_MS,
  STARTUP_INSTALL_WAIT_MS,
  UPDATER_LOG_MAX_BYTES,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  createUpdaterLog,
  isAtOrAbove,
  readInstallLocation,
  startUpdater,
  updaterPendingFile,
  windowsStartInstallBlocker,
  type UpdaterHandle,
} from './updater';

// reg.exe, for the one test of the default Windows wiring; every other test
// injects its own startInstallBlocker.
const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync,
}));

// electron-updater is aliased to test/electron-updater-stub.ts; the cast keeps
// the stub's extra members visible without widening the real type.
const stub = autoUpdater as unknown as typeof autoUpdater & {
  failNextCheck: Error | null;
  failChecks: number;
  hangNextCheck: boolean;
  nextCheckResult: unknown;
  refuseNextInstall: boolean;
  failNextInstallLate: boolean;
  throwNextCheck: boolean;
};

let handle: UpdaterHandle | null = null;

/** Windows unless a test says otherwise: that is what the tills run. */
function start(overrides: Partial<Parameters<typeof startUpdater>[0]> = {}) {
  return startUpdater({
    enabled: true,
    onReady: vi.fn(),
    allowClose: () => __calls.push('allowClose'),
    exit: (code) => __calls.push(`exit:${code}`),
    relaunch: () => __calls.push('relaunch'),
    platform: 'win32',
    version: '0.2.20',
    // Never reg.exe from a test.
    startInstallBlocker: () => null,
    ...overrides,
  });
}

const installs = () => __calls.filter((c) => c.startsWith('install:'));
const checks = () => __calls.filter((c) => c === 'check').length;

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

  // A till's window is closable:false (the red-light guard on macOS), and
  // Electron cancels the quit every install ends in on a window that will not
  // close. The windows open up when that quit is announced, not before: an
  // install that refuses must leave the station locked.
  it('Restart to update installs and relaunches, opens the windows once the quit is announced, and exits if that quit stalls', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handle = start();
    stub.emit('update-downloaded', { version: '0.2.0' });
    stub.autoRunAppAfterInstall = false;

    expect(handle!.installNow()).toBe(true);
    expect(__calls).toEqual(['install:silent:relaunch']);
    expect(stub.autoRunAppAfterInstall).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(__calls).toEqual(['install:silent:relaunch', 'before-quit-for-update', 'allowClose']);

    // The installer is its own process by now and relaunches the app itself;
    // a quit that has not landed is ended, and the window closing mid-quit
    // (stop) must not cancel that.
    handle!.stop();
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS - 1);
    expect(__calls).not.toContain('exit:0');
    await vi.advanceTimersByTimeAsync(1);
    expect(__calls).toEqual(['install:silent:relaunch', 'before-quit-for-update', 'allowClose', 'exit:0']);
    expect(warn).toHaveBeenCalled();
  });

  it('Restart to update that refuses on the spot leaves the windows locked, never exits, and stops offering the update', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReady = vi.fn();
    handle = start({ onReady });
    stub.emit('update-downloaded', { version: '0.2.0' });
    stub.refuseNextInstall = true;

    expect(handle!.installNow()).toBe(false);
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS * 2);
    expect(__calls).toEqual(['install:silent:relaunch']);
    expect(handle!.ready()).toBeNull();
    // The renderer is told, so the control and Quit's line go.
    expect(onReady).toHaveBeenLastCalledWith(null);
    // Quit to desktop then just exits (index.ts): nothing is waiting any more.
    expect(handle!.installOnQuit()).toBe(false);
  });

  it('a second press while the first install is quitting asks nothing more of electron-updater', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onReady = vi.fn();
    handle = start({ onReady });
    stub.emit('update-downloaded', { version: '0.2.0' });
    expect(handle!.installNow()).toBe(true);
    // Nothing is offered any more; electron-updater would ignore a second
    // quitAndInstall without a word, and start a second installer on a third.
    expect(handle!.ready()).toBeNull();
    expect(onReady).toHaveBeenLastCalledWith(null);
    expect(handle!.installNow()).toBe(false);
    expect(handle!.installOnQuit()).toBe(false);
    stub.emit('update-downloaded', { version: '0.2.0' });
    expect(handle!.ready()).toBeNull();
    expect(handle!.installNow()).toBe(false);
    expect(installs()).toEqual(['install:silent:relaunch']);
    expect(__calls).not.toContain('ignored');
  });

  it('a newer download under way withdraws the update offered: its installer has left the cache', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onReady = vi.fn();
    handle = start({ onReady });
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(onReady).toHaveBeenLastCalledWith({ version: '0.2.21' });
    stub.emit('download-progress', { percent: 1 });
    expect(onReady).toHaveBeenLastCalledWith(null);
    expect(handle!.ready()).toBeNull();
    expect(handle!.installOnQuit()).toBe(false);
    expect(installs()).toEqual([]);
    stub.emit('update-downloaded', { version: '0.2.22' });
    expect(onReady).toHaveBeenLastCalledWith({ version: '0.2.22' });
  });

  it.each([
    ['Restart to update', (h: UpdaterHandle) => h.installNow()],
    ['Quit to desktop', (h: UpdaterHandle) => h.installOnQuit()],
  ])('%s whose installer cannot be spawned brings the app back', async (_name, press) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = start();
    stub.emit('update-downloaded', { version: '0.2.21' });
    stub.failNextInstallLate = true;
    expect(press(handle!)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // Before BaseUpdater's app.quit(), which goes ahead anyway.
    expect(__calls.indexOf('relaunch')).toBeGreaterThan(-1);
    expect(__calls.indexOf('relaunch')).toBeLessThan(__calls.indexOf('before-quit-for-update'));
    // Only then: a later 'error' is not the installer's.
    stub.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(__calls.filter((c) => c === 'relaunch')).toHaveLength(1);
  });

  it('Quit to desktop installs, opens the app again, opens the windows once the quit is announced, and exits if it stalls', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handle = start();
    stub.emit('update-downloaded', { version: '0.2.0' });
    stub.autoRunAppAfterInstall = false;

    expect(handle!.installOnQuit()).toBe(true);
    // Owner call 2026-09-25: back on the new version, not left closed. The
    // NSIS installer relaunches on --force-run; MacUpdater ignores the
    // arguments and relaunches on autoRunAppAfterInstall.
    expect(__calls).toEqual(['install:silent:relaunch']);
    expect(stub.autoRunAppAfterInstall).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(__calls).toEqual(['install:silent:relaunch', 'before-quit-for-update', 'allowClose']);

    // The window closing mid-quit stops the updater; the fallback must survive it.
    handle!.stop();
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS - 1);
    expect(__calls).not.toContain('exit:0');
    await vi.advanceTimersByTimeAsync(1);
    expect(__calls).toEqual(['install:silent:relaunch', 'before-quit-for-update', 'allowClose', 'exit:0']);
    expect(warn).toHaveBeenCalled();
  });

  it('Quit to desktop that refuses on the spot returns false, so index.ts exits at once, with the windows left alone', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = start();
    stub.emit('update-downloaded', { version: '0.2.0' });
    stub.refuseNextInstall = true;
    expect(handle!.installOnQuit()).toBe(false);
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS * 2);
    expect(__calls).toEqual(['install:silent:relaunch']);
  });

  it('Quit to desktop with nothing waiting installs nothing: index.ts then just exits', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = start();
    expect(handle!.installOnQuit()).toBe(false);
    vi.advanceTimersByTime(INSTALL_QUIT_FALLBACK_MS * 2);
    expect(__calls).toEqual([]);
  });

  it("Electron's macOS autoUpdater announcing the quit twice opens the windows and arms the fallback once", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    handle = start({ platform: 'darwin' });
    stub.emit('update-downloaded', { version: '0.2.0' });
    squirrelMac.emit('update-downloaded');
    expect(handle!.installNow()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    squirrelMac.emit('before-quit-for-update');
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS);
    expect(__calls.filter((c) => c === 'allowClose')).toHaveLength(1);
    expect(__calls.filter((c) => c === 'exit:0')).toHaveLength(1);
  });

  it('a quit announced with no install of ours asked for opens nothing', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    handle = start();
    squirrelMac.emit('before-quit-for-update');
    vi.advanceTimersByTime(INSTALL_QUIT_FALLBACK_MS * 2);
    expect(__calls).toEqual([]);
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

describe('installAtStart', () => {
  let dir: string;
  let stateFile: string;
  let pendingFile: string;
  const AVAILABLE = { isUpdateAvailable: true, updateInfo: { version: '0.2.21' } };
  const UP_TO_DATE = { isUpdateAvailable: false, updateInfo: { version: '0.2.20' } };

  /** Whether the start's promise has resolved, i.e. whether index.ts would make its window now. */
  function track(p: Promise<void>) {
    const state = { windowOpens: false };
    void p.then(() => {
      state.windowOpens = true;
    });
    return state;
  }

  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
  const writeState = (state: unknown) => fs.writeFileSync(stateFile, JSON.stringify(state));

  /** What an earlier session leaves when it has finished downloading `version`: electron-updater's cache, and our note of the version. */
  function downloadedEarlier(version = '0.2.21', extra: Record<string, unknown> = {}) {
    fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
    fs.writeFileSync(pendingFile, '{"fileName":"Touch-Padel-Operator-Setup.exe"}');
    const state = fs.existsSync(stateFile) ? readState() : {};
    writeState({ ...state, downloaded: version, ...extra });
  }

  /** A fresh process: the singleton updater keeps no listeners from the last one. */
  function restart(overrides: Partial<Parameters<typeof startUpdater>[0]> = {}) {
    handle?.stop();
    __reset();
    squirrelMac.removeAllListeners();
    handle = start({ stateFile, pendingFile, ...overrides });
    return handle!;
  }

  const logged = (level: 'log' | 'warn' | 'error', pattern: RegExp) =>
    expect(console[level]).toHaveBeenCalledWith('[updater]', expect.stringMatching(pattern));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-updater-start-'));
    stateFile = path.join(dir, 'updater-startup.json');
    pendingFile = path.join(dir, 'cache', 'pending', 'update-info.json');
    vi.setSystemTime(new Date('2026-09-25T06:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('installs a download an earlier session left, within the wait, relaunching, and makes no window', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = AVAILABLE;
    stub.autoRunAppAfterInstall = false;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(__calls).toEqual(['check']);

    // A cached installer is re-hashed, not re-downloaded: it reports late in the wait at worst.
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MS - 1);
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(installs()).toEqual(['install:silent:relaunch']);
    expect(stub.autoRunAppAfterInstall).toBe(true);
    expect(readState()).toEqual({ highest: '0.2.20', downloaded: '0.2.21', tried: '0.2.21' });

    // There is no window to open up for the quit, and one the stall fallback
    // opens has to keep its guards.
    await vi.advanceTimersByTimeAsync(0);
    expect(__calls).toContain('before-quit-for-update');
    expect(__calls).not.toContain('allowClose');
    expect(start.windowOpens).toBe(false);
  });

  it('notes a finished download for the next start, and forgets it once the feed offers nothing newer', () => {
    restart();
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(readState()).toEqual({ downloaded: '0.2.21' });
    // A release taken down: what is cached is no longer on offer.
    stub.emit('update-not-available', UP_TO_DATE.updateInfo);
    expect(readState()).toEqual({});
  });

  it('with no newer download waiting the window opens at once, and its check answers the 30 s one', async () => {
    const h = restart();
    stub.nextCheckResult = UP_TO_DATE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(__calls).toEqual(['check']);
    logged('log', /start: no newer download is waiting; opening the window/);
    expect(readState()).toEqual({ highest: '0.2.20' });
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(__calls).toEqual(['check']);
    // One loop: the 6 h checks carry on.
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(__calls).toEqual(['check', 'check']);
  });

  it('a download this version already is (it installed) is not waited for, and is forgotten', async () => {
    downloadedEarlier('0.2.20');
    const h = restart();
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(readState()).toEqual({ highest: '0.2.20' });
  });

  it('offline with nothing waiting: the window opens at once, and the 30 s check still runs', async () => {
    const h = restart();
    stub.failNextCheck = new Error('getaddrinfo ENOTFOUND github.com');
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    logged('error', /check failed: getaddrinfo ENOTFOUND github\.com/);
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(__calls).toEqual(['check', 'check']);
  });

  it('a download that finishes after the window is up never installs on its own', async () => {
    const onReady = vi.fn();
    const h = restart({ onReady });
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);

    stub.emit('download-progress', { percent: 50 });
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.21' });
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MS);
    expect(installs()).toEqual([]);
    // It is the next start's, and the control's now.
    expect(readState()).toMatchObject({ downloaded: '0.2.21' });
    expect(h.installNow()).toBe(true);
  });

  it('a download gone from the cache is not waited for', async () => {
    downloadedEarlier();
    fs.rmSync(pendingFile);
    const h = restart();
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    logged('log', /0\.2\.21 is no longer in the download cache/);
  });

  it('a machine installed for all users never installs at a start: its installer would wait for a UAC answer', async () => {
    downloadedEarlier();
    const h = restart({ startInstallBlocker: () => 'installed for all users' });
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    logged('log', /not installing 0\.2\.21: installed for all users; the Update ready control still offers it/);
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(installs()).toEqual([]);
    expect(h.ready()).toEqual({ version: '0.2.21' });
  });

  it('a machine that cannot be checked is treated the same', async () => {
    downloadedEarlier();
    const h = restart({
      startInstallBlocker: () => {
        throw new Error('reg.exe blocked');
      },
    });
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    logged('error', /install-scope check failed: reg\.exe blocked/);
  });

  it('opens the window if the install has not taken the app down in time, never exits, and offers nothing in it', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('update-downloaded', { version: '0.2.21' });

    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS - 1);
    expect(start.windowOpens).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(start.windowOpens).toBe(true);
    expect(__calls).not.toContain('exit:0');
    expect(__calls).not.toContain('allowClose');
    logged('warn', /quit did not complete.*opening the window/);

    // Its installer is out there, and electron-updater would ignore another
    // quitAndInstall: the window shows no Update ready, and Quit just exits.
    expect(h.ready()).toBeNull();
    expect(h.installNow()).toBe(false);
    expect(h.installOnQuit()).toBe(false);
    expect(installs()).toEqual(['install:silent:relaunch']);
    expect(__calls).not.toContain('ignored');
  });

  it('opens the window when the install refuses on the spot, and still counts the attempt', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = AVAILABLE;
    stub.refuseNextInstall = true;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('update-downloaded', { version: '0.2.21' });
    await vi.advanceTimersByTimeAsync(0);
    expect(installs()).toEqual(['install:silent:relaunch']);
    expect(start.windowOpens).toBe(true);
    // An install that refuses at every start must run out.
    expect(readState()).toMatchObject({ tried: '0.2.21' });
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS * 2);
    expect(__calls).not.toContain('exit:0');
  });

  it('an installer that cannot be spawned brings the app back, and that start opens the window without another try', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = AVAILABLE;
    stub.failNextInstallLate = true;
    track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('update-downloaded', { version: '0.2.21' });
    await vi.advanceTimersByTimeAsync(0);
    // Before BaseUpdater's app.quit(), which goes ahead anyway.
    expect(__calls.indexOf('relaunch')).toBeGreaterThan(-1);
    expect(__calls.indexOf('relaunch')).toBeLessThan(__calls.indexOf('before-quit-for-update'));
    logged('error', /the installer did not start \(spawn EMFILE\); relaunching/);

    // The relaunched start, seconds later.
    await vi.advanceTimersByTimeAsync(3_000);
    const again = restart();
    stub.nextCheckResult = AVAILABLE;
    const start = track(again.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    logged('log', /not installing 0\.2\.21: a start already tried to install it/);
    expect(installs()).toEqual([]);
  });

  it('on macOS an error after the install is not answered with a relaunch: the stall fallback opens the window', async () => {
    downloadedEarlier();
    const h = restart({ platform: 'darwin' });
    stub.nextCheckResult = AVAILABLE;
    stub.failNextInstallLate = true;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('update-downloaded', { version: '0.2.21' });
    squirrelMac.emit('update-downloaded');
    await vi.advanceTimersByTimeAsync(INSTALL_QUIT_FALLBACK_MS);
    expect(__calls).not.toContain('relaunch');
    expect(start.windowOpens).toBe(true);
  });

  it('a line that hangs: the window opens at the end of the wait, and a later download never installs on its own', async () => {
    downloadedEarlier();
    const onReady = vi.fn();
    const h = restart({ onReady });
    stub.hangNextCheck = true;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MS - 1);
    expect(start.windowOpens).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(start.windowOpens).toBe(true);

    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.21' });
    expect(installs()).toEqual([]);
    expect(readState()).not.toHaveProperty('tried');
    // The control is still a person's to press.
    expect(h.installNow()).toBe(true);
    expect(installs()).toEqual(['install:silent:relaunch']);
  });

  it('a network that comes up a few seconds after login: the check is asked again, and the download installs', async () => {
    downloadedEarlier();
    const h = restart();
    stub.failChecks = 2;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(checks()).toBe(1);
    expect(start.windowOpens).toBe(false);
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_RETRY_MS);
    expect(checks()).toBe(2);
    expect(start.windowOpens).toBe(false);
    stub.nextCheckResult = AVAILABLE;
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_RETRY_MS);
    expect(checks()).toBe(3);
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(installs()).toEqual(['install:silent:relaunch']);
    expect(start.windowOpens).toBe(false);
  });

  it('offline for the whole wait: asked again until it runs out, then the window, and the 30 s check still runs', async () => {
    downloadedEarlier();
    const h = restart();
    stub.failChecks = 1000;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MS - 1);
    expect(start.windowOpens).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(start.windowOpens).toBe(true);
    const asked = checks();
    expect(asked).toBe(Math.ceil(STARTUP_INSTALL_WAIT_MS / STARTUP_CHECK_RETRY_MS));
    // No retry outlives the wait.
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_RETRY_MS * 2);
    expect(checks()).toBe(asked);
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(checks()).toBe(asked + 1);
  });

  it('a failed download opens the window at once', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = { ...AVAILABLE, downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')) };
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(installs()).toEqual([]);
  });

  it("a failure reported only as 'error' after the check answered opens the window at once, and the next start still tries", async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(false);
    stub.emit('error', new Error('net::ERR_CONNECTION_RESET'));
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(installs()).toEqual([]);
    expect(readState()).not.toHaveProperty('tried');
  });

  it('on macOS, Squirrel.Mac refusing the zip opens the window at once, and later starts do not wait for that version again', async () => {
    downloadedEarlier();
    const h = restart({ platform: 'darwin' });
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    // electron-updater has it and hands it to Squirrel.Mac, which refuses.
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(start.windowOpens).toBe(false);
    stub.emit('error', new Error('Could not get code signature for running application'));
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(installs()).toEqual([]);
    expect(readState()).toMatchObject({ tried: '0.2.21' });

    const again = restart({ platform: 'darwin' });
    const next = track(again.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(next.windowOpens).toBe(true);
    logged('log', /not installing 0\.2\.21: a start already tried to install it/);
  });

  it('up to date after all (the release was taken down): the window opens at once, and the download is forgotten', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = UP_TO_DATE;
    const start = track(h.installAtStart());
    stub.emit('update-not-available', UP_TO_DATE.updateInfo);
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(readState()).not.toHaveProperty('downloaded');
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(checks()).toBe(1);
  });

  it("electron-updater's up-to-date event alone also ends the wait", async () => {
    downloadedEarlier();
    const h = restart();
    stub.hangNextCheck = true;
    const start = track(h.installAtStart());
    stub.emit('update-not-available', UP_TO_DATE.updateInfo);
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
  });

  it('a fresh download (a newer release than the one cached) ends the wait at its first progress report, and never installs on its own', async () => {
    downloadedEarlier();
    const onReady = vi.fn();
    const h = restart({ onReady });
    stub.nextCheckResult = { isUpdateAvailable: true, updateInfo: { version: '0.2.22' } };
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('download-progress', { percent: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);

    stub.emit('update-downloaded', { version: '0.2.22' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.22' });
    expect(installs()).toEqual([]);
    expect(readState()).toMatchObject({ downloaded: '0.2.22' });
  });

  it('only the first call can install', async () => {
    downloadedEarlier();
    const h = restart();
    stub.nextCheckResult = UP_TO_DATE;
    await h.installAtStart();
    const again = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(again.windowOpens).toBe(true);
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(__calls).toEqual(['check']);
  });

  it('never rejects: a check that throws outright opens the window, and nothing installs once it is up', async () => {
    downloadedEarlier();
    const h = restart();
    stub.throwNextCheck = true;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    logged('error', /start: checkForUpdates threw; opening the window/);
    stub.emit('update-downloaded', { version: '0.2.21' });
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MS + INSTALL_QUIT_FALLBACK_MS);
    expect(installs()).toEqual([]);
    expect(h.ready()).toEqual({ version: '0.2.21' });
  });

  it('without a state file a start never installs, and leaves the 30 s check alone', async () => {
    downloadedEarlier();
    const h = restart({ stateFile: undefined });
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    expect(start.windowOpens).toBe(true);
    expect(__calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS);
    expect(__calls).toEqual(['check']);
  });

  it('a failed download does not also surface as an unhandled rejection', async () => {
    downloadedEarlier();
    const h = restart();
    const failed = Promise.reject(new Error('sha512 checksum mismatch'));
    stub.nextCheckResult = { ...AVAILABLE, downloadPromise: failed };
    track(h.installAtStart());
    // vitest fails the run on an unhandled rejection; getting past this is the assertion.
    await vi.advanceTimersByTimeAsync(0);
    await expect(failed).rejects.toThrow('sha512');
  });

  it('on macOS, waits for Squirrel.Mac as well before installing, and longer than on Windows', async () => {
    downloadedEarlier();
    const h = restart({ platform: 'darwin' });
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('update-downloaded', { version: '0.2.21' });
    expect(installs()).toEqual([]);
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MS);
    expect(start.windowOpens).toBe(false);

    squirrelMac.emit('update-downloaded');
    expect(installs()).toEqual(['install:silent:relaunch']);
    expect(stub.autoRunAppAfterInstall).toBe(true);
  });

  it('on macOS, a Squirrel.Mac that never reports ends in the window at the end of the macOS wait, not an install', async () => {
    downloadedEarlier();
    const h = restart({ platform: 'darwin' });
    stub.nextCheckResult = AVAILABLE;
    const start = track(h.installAtStart());
    await vi.advanceTimersByTimeAsync(0);
    stub.emit('update-downloaded', { version: '0.2.21' });
    await vi.advanceTimersByTimeAsync(STARTUP_INSTALL_WAIT_MAC_MS - 1);
    expect(start.windowOpens).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(start.windowOpens).toBe(true);
    expect(installs()).toEqual([]);
  });

  describe('one try per version', () => {
    /** One start that finds `version` cached from an earlier session; installed: whether it tried. */
    async function startFindingCached(version = '0.2.21', running = '0.2.20') {
      downloadedEarlier(version);
      const h = restart({ version: running });
      stub.nextCheckResult = { isUpdateAvailable: true, updateInfo: { version } };
      const start = track(h.installAtStart());
      await vi.advanceTimersByTimeAsync(0);
      stub.emit('update-downloaded', { version });
      await vi.advanceTimersByTimeAsync(0);
      return { installed: installs().length > 0, windowOpens: start.windowOpens, handle: h };
    }
    const HOUR = 60 * 60 * 1000;

    it('a start that tried and came back on the old version leaves that version to the control', async () => {
      expect(await startFindingCached()).toMatchObject({ installed: true });
      expect(readState()).toMatchObject({ tried: '0.2.21' });
      // The installer failed; the app came back on 0.2.20 (seconds later, or a day).
      for (const later of [30_000, 24 * HOUR]) {
        await vi.advanceTimersByTimeAsync(later);
        const again = await startFindingCached();
        expect(again).toMatchObject({ installed: false, windowOpens: true });
        expect(again.handle.ready()).toEqual({ version: '0.2.21' });
        logged('log', /not installing 0\.2\.21: a start already tried to install it; the Update ready control still offers it/);
      }
    });

    it('a newer version gets its own try', async () => {
      writeState({ tried: '0.2.21' });
      expect(await startFindingCached('0.2.22')).toMatchObject({ installed: true });
      expect(readState()).toMatchObject({ tried: '0.2.22' });
    });

    it('is cleared by a start on the version it aimed for, or a later one; the highest version stays', async () => {
      writeState({ tried: '0.2.21' });
      const h = restart({ version: '0.2.20' });
      await h.installAtStart();
      expect(readState()).toHaveProperty('tried');

      const landed = restart({ version: '0.2.21' });
      await landed.installAtStart();
      expect(readState()).toEqual({ highest: '0.2.21' });

      writeState({ highest: '0.2.21', tried: '0.2.21' });
      const later = restart({ version: '0.3.0' });
      await later.installAtStart();
      expect(readState()).toEqual({ highest: '0.3.0' });
    });

    it('a station rolled back by hand is not put back on the release it left; a release above that one installs', async () => {
      // It ran 0.2.22, and somebody installed 0.2.21 over it.
      writeState({ highest: '0.2.22' });
      const back = await startFindingCached('0.2.22', '0.2.21');
      expect(back).toMatchObject({ installed: false, windowOpens: true });
      logged('log', /not installing 0\.2\.22: this station has run 0\.2\.22 and was rolled back/);
      expect(back.handle.ready()).toEqual({ version: '0.2.22' });
      expect(readState()).toMatchObject({ highest: '0.2.22' });

      expect(await startFindingCached('0.2.23', '0.2.21')).toMatchObject({ installed: true });
    });

    it('a station that ran a prerelease still takes the release at a start', async () => {
      writeState({ highest: '0.3.0-beta.1' });
      expect(await startFindingCached('0.3.0', '0.3.0-beta.1')).toMatchObject({ installed: true });
    });

    it('a state file it cannot read is ignored, never thrown; what can be read of it still counts', async () => {
      // Unreadable: nothing says a download is waiting, so the window opens
      // at once and the file is written afresh.
      downloadedEarlier();
      fs.writeFileSync(stateFile, '{"downloaded":"0.2.21","tried":');
      let h = restart();
      let start = track(h.installAtStart());
      await vi.advanceTimersByTimeAsync(0);
      expect(start.windowOpens).toBe(true);
      logged('warn', /start: ignoring what cannot be read in updater-startup\.json/);
      expect(readState()).toEqual({ highest: '0.2.20' });

      fs.writeFileSync(stateFile, 'null');
      h = restart();
      start = track(h.installAtStart());
      await vi.advanceTimersByTimeAsync(0);
      expect(start.windowOpens).toBe(true);

      // Wrong shapes are dropped part by part; the download it names still
      // installs. So does a record from the loop guard this replaced, whose
      // absurd date once threw (RangeError: Invalid time value).
      writeState({
        highest: 21,
        downloaded: '0.2.21',
        tried: 21,
        install: { version: '0.2.21', attempts: 2, total: 2, lastAt: 1e17 },
      });
      h = restart();
      stub.nextCheckResult = AVAILABLE;
      start = track(h.installAtStart());
      await vi.advanceTimersByTimeAsync(0);
      stub.emit('update-downloaded', { version: '0.2.21' });
      expect(installs()).toEqual(['install:silent:relaunch']);
      expect(readState()).toEqual({ highest: '0.2.20', downloaded: '0.2.21', tried: '0.2.21' });
    });

    it('a state file that can be read but not written is not waited on: its try could not be recorded', async () => {
      downloadedEarlier();
      writeState({ highest: '0.2.20', downloaded: '0.2.21' });
      fs.chmodSync(stateFile, 0o444);
      const h = restart();
      const start = track(h.installAtStart());
      await vi.advanceTimersByTimeAsync(0);
      expect(start.windowOpens).toBe(true);
      logged('log', /not installing 0\.2\.21: updater-startup\.json cannot be written; opening the window/);
      stub.emit('update-downloaded', { version: '0.2.21' });
      expect(installs()).toEqual([]);
    });

    it('an attempt it cannot write down is not made', async () => {
      downloadedEarlier();
      // The start's own write goes through; the claim's does not.
      const h = restart();
      stub.nextCheckResult = AVAILABLE;
      const start = track(h.installAtStart());
      await vi.advanceTimersByTimeAsync(0);
      fs.rmSync(dir, { recursive: true, force: true });
      stub.emit('update-downloaded', { version: '0.2.21' });
      await vi.advanceTimersByTimeAsync(0);
      expect(installs()).toEqual([]);
      expect(start.windowOpens).toBe(true);
      logged('error', /not installing 0\.2\.21: cannot record the attempt/);
    });
  });
});

describe('windowsStartInstallBlocker', () => {
  const answers =
    (hklm: boolean | null, hkcu: boolean | null) =>
    (hive: 'HKLM' | 'HKCU') =>
      hive === 'HKLM' ? hklm : hkcu;

  it('an install registered for all users is blocked', () => {
    expect(windowsStartInstallBlocker(answers(true, true))).toMatch(/installed for all users/);
  });

  it('an install registered for this user only is not', () => {
    expect(windowsStartInstallBlocker(answers(false, true))).toBeNull();
  });

  it("reg.exe's \"not there\" from both is a machine it cannot read (a policy that disables registry tools answers the same): blocked", () => {
    expect(windowsStartInstallBlocker(answers(false, false))).toMatch(/could not be read/);
  });

  it('anything reg.exe cannot answer blocks, and a failed HKLM is never overruled by HKCU', () => {
    const asked: string[] = [];
    const hklmTimesOut = (hive: 'HKLM' | 'HKCU') => {
      asked.push(hive);
      return hive === 'HKLM' ? null : true;
    };
    expect(windowsStartInstallBlocker(hklmTimesOut)).toMatch(/could not be read/);
    expect(asked).toEqual(['HKLM']);
    expect(windowsStartInstallBlocker(answers(false, null))).toMatch(/could not be read/);
  });
});

describe('readInstallLocation', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  const run = vi.fn();
  const fail = (status: number | null) => {
    run.mockImplementation(() => {
      throw Object.assign(new Error('reg.exe'), { status });
    });
  };

  it("asks reg.exe by its full path for the installer's InstallLocation, in the 64-bit view", () => {
    run.mockReturnValue(Buffer.from(''));
    expect(readInstallLocation('HKLM', run as never, env)).toBe(true);
    expect(run).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\reg.exe',
      ['query', `HKLM\\Software\\${NSIS_APP_GUID}`, '/v', 'InstallLocation', '/reg:64'],
      { stdio: 'ignore', windowsHide: true, timeout: REG_QUERY_TIMEOUT_MS },
    );
    readInstallLocation('HKCU', run as never, {});
    expect(run).toHaveBeenLastCalledWith(
      'C:\\Windows\\System32\\reg.exe',
      ['query', `HKCU\\Software\\${NSIS_APP_GUID}`, '/v', 'InstallLocation', '/reg:64'],
      expect.anything(),
    );
  });

  it('exit 1 is false; a timeout or anything else is null', () => {
    fail(1);
    expect(readInstallLocation('HKLM', run as never, env)).toBe(false);
    fail(null);
    expect(readInstallLocation('HKLM', run as never, env)).toBeNull();
    fail(5);
    expect(readInstallLocation('HKLM', run as never, env)).toBeNull();
  });

  it('is what a Windows start asks when no blocker is given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-updater-reg-'));
    const stateFile = path.join(dir, 'updater-startup.json');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const perMachine of [true, false]) {
        __reset();
        execFileSync.mockReset();
        execFileSync.mockImplementation((_file: string, args: string[]) => {
          if (args[1]?.startsWith('HKLM') && !perMachine) throw Object.assign(new Error('not found'), { status: 1 });
          return Buffer.from('');
        });
        fs.writeFileSync(stateFile, JSON.stringify({ downloaded: '0.2.21' }));
        const h = start({ stateFile, startInstallBlocker: undefined, platform: 'win32' });
        stub.nextCheckResult = { isUpdateAvailable: true, updateInfo: { version: '0.2.21' } };
        void h!.installAtStart();
        await vi.advanceTimersByTimeAsync(0);
        stub.emit('update-downloaded', { version: '0.2.21' });
        expect(execFileSync.mock.calls.map((c) => (c[1] as string[])[1]?.slice(0, 4))).toEqual(
          perMachine ? ['HKLM'] : ['HKLM', 'HKCU'],
        );
        expect(execFileSync.mock.calls[0]?.[0]).toMatch(/System32\\reg\.exe$/);
        expect(installs()).toEqual(perMachine ? [] : ['install:silent:relaunch']);
        h!.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("NSIS_APP_GUID is the installer's APP_GUID, by electron-builder's own code, and nothing overrides it", () => {
    const loadCjs = createRequire(import.meta.url);
    const config = loadCjs('../../electron-builder.config.cjs') as {
      appId: string;
      win?: { appId?: string };
      nsis?: { guid?: string };
    };
    // AppInfo.id takes win.appId first, and nsis.guid replaces the derivation (NsisTarget.js).
    expect(config.win?.appId).toBeUndefined();
    expect(config.nsis?.guid).toBeUndefined();
    const { UUID } = createRequire(loadCjs.resolve('electron-builder'))('builder-util-runtime') as {
      UUID: { v5(name: string, namespace: Buffer): string; parse(uuid: string): Buffer };
    };
    // NsisTarget.js: ELECTRON_BUILDER_NS_UUID.
    expect(UUID.v5(config.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'))).toBe(NSIS_APP_GUID);
  });
});

describe('updaterPendingFile', () => {
  let resources: string;

  beforeEach(() => {
    resources = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-updater-res-'));
  });

  afterEach(() => {
    fs.rmSync(resources, { recursive: true, force: true });
  });

  // What electron-builder wrote into the installed 0.2.20 app, quotes and all.
  const YML = "owner: KaguSoftware\nrepo: touchpadel-releases\nprovider: github\nreleaseType: release\nupdaterCacheDirName: '@touchoperator-shell-updater'\n";

  it("finds electron-updater's pending download record the way electron-updater does", () => {
    fs.writeFileSync(path.join(resources, 'app-update.yml'), YML);
    expect(
      updaterPendingFile({ resourcesPath: resources, appName: 'Touch Padel Operator', platform: 'darwin', homedir: '/Users/till', env: {} }),
    ).toBe(path.join('/Users/till', 'Library', 'Caches', '@touchoperator-shell-updater', 'pending', 'update-info.json'));
    expect(
      updaterPendingFile({
        resourcesPath: resources,
        appName: 'Touch Padel Operator',
        platform: 'win32',
        homedir: 'C:\\Users\\till',
        env: { LOCALAPPDATA: 'C:\\Users\\till\\AppData\\Local' },
      }),
    ).toBe(path.join('C:\\Users\\till\\AppData\\Local', '@touchoperator-shell-updater', 'pending', 'update-info.json'));
  });

  it('reads an unquoted or double-quoted name too', () => {
    fs.writeFileSync(path.join(resources, 'app-update.yml'), 'updaterCacheDirName: plain-updater\n');
    expect(
      updaterPendingFile({ resourcesPath: resources, appName: 'x', platform: 'linux', homedir: '/home/till', env: {} }),
    ).toBe(path.join('/home/till', '.cache', 'plain-updater', 'pending', 'update-info.json'));
    fs.writeFileSync(path.join(resources, 'app-update.yml'), 'updaterCacheDirName: "quoted-updater"\n');
    expect(
      updaterPendingFile({ resourcesPath: resources, appName: 'x', platform: 'darwin', homedir: '/Users/till', env: {} }),
    ).toBe(path.join('/Users/till', 'Library', 'Caches', 'quoted-updater', 'pending', 'update-info.json'));
  });

  it("falls back to the app's name without an app-update.yml", () => {
    expect(
      updaterPendingFile({ resourcesPath: resources, appName: 'Touch Padel Operator', platform: 'darwin', homedir: '/Users/till', env: {} }),
    ).toBe(path.join('/Users/till', 'Library', 'Caches', 'Touch Padel Operator', 'pending', 'update-info.json'));
  });
});

describe('isAtOrAbove', () => {
  it('compares x.y.z numerically', () => {
    expect(isAtOrAbove('0.2.21', '0.2.21')).toBe(true);
    expect(isAtOrAbove('0.2.22', '0.2.21')).toBe(true);
    expect(isAtOrAbove('0.10.0', '0.9.9')).toBe(true);
    expect(isAtOrAbove('1.0.0', '0.99.99')).toBe(true);
    expect(isAtOrAbove('0.2.20', '0.2.21')).toBe(false);
    expect(isAtOrAbove('0.2.9', '0.2.10')).toBe(false);
  });

  it('a prerelease sorts below its release; two of one x.y.z count as the same', () => {
    expect(isAtOrAbove('0.3.0-beta.1', '0.3.0')).toBe(false);
    expect(isAtOrAbove('0.3.0', '0.3.0-beta.1')).toBe(true);
    expect(isAtOrAbove('0.3.0-beta.1', '0.2.99')).toBe(true);
    expect(isAtOrAbove('0.3.0-beta.2', '0.3.0-beta.1')).toBe(true);
    expect(isAtOrAbove('0.3.0-beta.1', '0.3.0-beta.2')).toBe(true);
    expect(isAtOrAbove('0.3.0+build.7', '0.3.0')).toBe(true);
  });

  it('a version that does not parse is never at or above', () => {
    expect(isAtOrAbove('garbage', '0.2.21')).toBe(false);
    expect(isAtOrAbove('0.2.21', '')).toBe(false);
    expect(isAtOrAbove('0.2.21x', '0.2.20')).toBe(false);
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
