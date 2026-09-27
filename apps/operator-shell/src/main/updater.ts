import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoUpdater as nativeUpdater } from 'electron';
import { autoUpdater, type AppUpdater, type Logger } from 'electron-updater';
import type { UpdateReadyInfo } from '../ipc-channels';

/**
 * Auto-update (design-arch.md §2.5, §8) — the plain electron-updater loop,
 * without the scheduling machinery that was cut from phase 1: check, download
 * silently, and install when the app next starts. Three ways an update goes in:
 *
 * - The next start (installAtStart, owner call 2026-09-25). A newer download
 *   left waiting by an earlier session installs before the window exists, and
 *   the app comes back on the new version, so a restart is enough. Installing
 *   used to need a person at every machine, and that is how stations stayed
 *   behind. Not on a machine installed "for everyone" (its installer asks for
 *   administrator approval, and a start has nobody to give it), not to a
 *   version this station has already run (a rollback), and once per version:
 *   a start that tried and is still on the old version leaves it to the
 *   control.
 * - The rail's "Update ready" control (installNow), whenever someone taps it.
 * - Quit to desktop (index.ts swaps app.exit for installOnQuit when something
 *   is ready), which now opens the app again once the install is done.
 *
 * A Windows shutdown or restart does NOT install. Electron emits no 'quit'
 * when the session ends, and electron-updater's autoInstallOnAppQuit hooks
 * only 'quit' (ElectronAppAdapter.onQuit). This comment used to say it did;
 * the start after the restart is what installs it now. autoInstallOnAppQuit
 * stays on for the graceful app.quit() we do not start ourselves
 * (window-all-closed).
 *
 * Every install ends in a graceful quit — electron-updater's app.quit() on
 * Windows, Squirrel.Mac closing every window on macOS — and a till's windows
 * refuse to close (closable:false on Windows, the red-light PIN guard on
 * macOS), which cancels it. Quit to desktop did nothing whenever an update was
 * waiting. The windows now open up (allowClose) when that quit is announced
 * ('before-quit-for-update', which both emit only once the install is really
 * going), so an install that refuses leaves the station locked. A quit that
 * has still not landed INSTALL_QUIT_FALLBACK_MS later ends in an exit for the
 * control and Quit to desktop, and in the window for a start: a start never
 * ends with the app closed if it can help it.
 *
 * The feed is the public releases repo (electron-builder.config.cjs `publish`),
 * embedded as resources/app-update.yml at package time. Offline is the normal
 * state for a till for hours at a time, so every failure here is logged and
 * none is allowed to throw.
 */

export const UPDATE_FIRST_CHECK_DELAY_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/**
 * How long a start that has a newer download waiting gives its check before
 * the window opens anyway. A start with nothing waiting does not wait at all.
 * What it has to cover: three HTTPS requests to GitHub in a row (the releases
 * feed, releases/latest, latest.yml) and electron-updater re-hashing the
 * cached installer against that latest.yml
 * (DownloadedUpdateHelper.getValidCachedUpdateFile: no second download). That
 * is a few seconds on a venue line; 15 s leaves room for a slow one, and for
 * a network that comes up a few seconds after login (the check is asked
 * again every STARTUP_CHECK_RETRY_MS meanwhile). A fresh download ends the
 * wait at its first progress report.
 */
export const STARTUP_INSTALL_WAIT_MS = 15_000;
/**
 * macOS adds, after the re-hash, a copy of the ~100 MB zip (MacUpdater's
 * `done`) and Squirrel.Mac fetching it from electron-updater's local proxy,
 * unzipping it and verifying its signature, which it redoes at every start.
 * Not measured on a venue Mac; twice the Windows wait.
 */
export const STARTUP_INSTALL_WAIT_MAC_MS = 30_000;
/** A start's failed check (a network not up yet) is asked again this often while the wait lasts. */
export const STARTUP_CHECK_RETRY_MS = 2_500;
/** How long an install waits for its graceful quit before giving up on it. */
export const INSTALL_QUIT_FALLBACK_MS = 5_000;
/** Each reg.exe query (readInstallLocation); a start makes at most two. */
export const REG_QUERY_TIMEOUT_MS = 2_500;
/** updater.log rolls over to updater.log.1 past this size. */
export const UPDATER_LOG_MAX_BYTES = 1024 * 1024;
/**
 * The NSIS installer's APP_GUID: UUID v5 of the appId
 * (com.kagu.touchpadel.operator, electron-builder.config.cjs) in
 * electron-builder's namespace (NsisTarget.js). The installer writes
 * <hive>\Software\<this>\InstallLocation: HKLM for an install "for everyone",
 * HKCU for one "just for me". updater.test.ts derives it again with
 * electron-builder's own code, so an appId change cannot leave it stale.
 */
export const NSIS_APP_GUID = '1a0b1f47-4c46-5878-8618-47e2a6d5f6d1';

export interface UpdaterHandle {
  checkNow(): void;
  /**
   * Before the window exists: when an earlier session left a newer download,
   * check at once and, if it is ready within the wait, install it and
   * relaunch. Resolves when the start should carry on and make its window;
   * while an install is taking the app down it does not resolve at all
   * (unless that quit stalls). Only the first call can install, and the window
   * is made after it resolves, so nothing installs on its own once a window is
   * up. Never rejects.
   */
  installAtStart(): Promise<void>;
  /** quitAndInstall when a download is waiting; false when nothing is waiting or the install refused. */
  installNow(): boolean;
  /** Install silently and open the app again — for the Quit to desktop path. False: just exit. */
  installOnQuit(): boolean;
  ready(): UpdateReadyInfo | null;
  stop(): void;
}

export function startUpdater(opts: {
  /** app.isPackaged — a dev build has no app-update.yml and nothing to update. */
  enabled: boolean;
  /** app.getVersion(). */
  version: string;
  /** A download is ready to install, or (null) the one offered is not any more. */
  onReady: (info: UpdateReadyInfo | null) => void;
  /** Make every window closable. Called when an install's quit is announced, never before. */
  allowClose: () => void;
  /** app.exit — the last resort when an install's quit stalls. */
  exit: (code: number) => void;
  /** app.relaunch: an installer that could not be started leaves the app to come back by itself. */
  relaunch?: () => void;
  /** userData/updater.log. On a packaged till the console goes nowhere. */
  logFile?: string;
  /** userData/updater-startup.json (StartupState). Without one, a start never installs. */
  stateFile?: string;
  /** electron-updater's pending/update-info.json (updaterPendingFile). Given, a start waits only while it exists. */
  pendingFile?: string;
  /** Why this machine's start must not install, or null. Defaults to windowsStartInstallBlocker on Windows. */
  startInstallBlocker?: () => string | null;
  /** Test seam; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Test seam; defaults to electron-updater's singleton. */
  updater?: AppUpdater;
}): UpdaterHandle | null {
  if (!opts.enabled) {
    console.log('[updater] disabled (not packaged)');
    return null;
  }
  const updater = opts.updater ?? autoUpdater;
  const log = createUpdaterLog(opts.logFile);
  const platform = opts.platform ?? process.platform;
  const stateFile = opts.stateFile;
  const blocker =
    opts.startInstallBlocker ??
    (platform === 'win32' ? () => windowsStartInstallBlocker((hive) => readInstallLocation(hive)) : () => null);
  let ready: UpdateReadyInfo | null = null;
  // An installer has been started in this process. electron-updater ignores a
  // second quitAndInstall without a word and then forgets it did
  // (BaseUpdater resets quitAndInstallCalled), so a third would start a second
  // installer: once this is set, nothing is offered or asked of it again.
  let launched = false;
  // The start's wait (installAtStart), ended by whichever answer comes first.
  let endStartupWait: ((why: string) => void) | null = null;
  let startTried = false;
  let startupAnswered = false;
  // The start's check is out: its failure is the promise's to handle (it is
  // asked again), not the 'error' event's.
  let startCheckOut = false;
  // Which install asked for the quit that 'before-quit-for-update' announces.
  let installing: 'start' | 'control' | 'quit' | null = null;
  let quitAnnounced = false;
  // On macOS the install is Squirrel.Mac's, which fetches the zip
  // electron-updater downloaded from a local proxy — and electron-updater
  // announces update-downloaded BEFORE that fetch. Until Squirrel reports,
  // MacUpdater.quitAndInstall() only waits (forever, if Squirrel fails), so the
  // update is not offered, at a start or anywhere else, until both have reported.
  let downloaded: UpdateReadyInfo | null = null;
  let squirrelHasIt = platform !== 'darwin';

  updater.logger = log;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;

  /** The update offered is not any more: the renderer drops the control and Quit's line. */
  const withdraw = (why: string) => {
    if (!ready) return;
    log.info(`${ready.version} is no longer offered: ${why}`);
    ready = null;
    opts.onReady(null);
  };

  /**
   * The start's download failed. Squirrel.Mac refusing the zip
   * electron-updater handed it (downloaded, but Squirrel never reported) will
   * refuse it at every start, and each would pay the re-hash, the copy and
   * Squirrel's fetch again: that start has had its one go at the version.
   */
  const startDownloadFailed = () => {
    if (!endStartupWait) return;
    if (downloaded && !squirrelHasIt && stateFile) {
      const version = downloaded.version;
      editStartupState(stateFile, log, (state) => {
        state.tried = version;
      });
    }
    endStartupWait('the download failed');
  };

  updater.on('error', (error) => {
    // ENOTFOUND / ECONNRESET while the WAN is down is the expected case.
    log.error(error instanceof Error ? error.message : String(error));
    // A download that failed, or Squirrel.Mac refusing the zip after fetching
    // it (MacUpdater passes its errors on here).
    if (!startCheckOut) startDownloadFailed();
  });
  updater.on('checking-for-update', () => log.info('checking'));
  updater.on('update-available', (info) => log.info(`update available ${info.version}`));
  updater.on('update-not-available', () => {
    log.info('up to date');
    // Whatever is cached is not on offer any more (a release taken down):
    // the next start has nothing to wait for.
    if (stateFile) recordDownloaded(stateFile, undefined, log);
    endStartupWait?.('up to date');
  });
  // A download under way means electron-updater has already emptied its cache
  // of the one offered (DownloadedUpdateHelper.validateDownloadedPath: a newer
  // release, or the same number re-cut). Offering it until the new one lands
  // would spawn an installer that is gone.
  updater.on('download-progress', () => withdraw('a newer download is replacing it'));

  const announce = () => {
    if (!downloaded || !squirrelHasIt || launched) return;
    ready = downloaded;
    log.info(`update ready ${ready.version}`);
    opts.onReady(ready);
    endStartupWait?.(`${ready.version} is ready`);
  };
  updater.on('update-downloaded', (info) => {
    downloaded = { version: info.version };
    log.info(`update downloaded ${info.version}${squirrelHasIt ? '' : ' (waiting for Squirrel.Mac)'}`);
    // The next start's reason to wait (installAtStart): electron-updater keeps
    // the file, but not which version it is.
    if (stateFile) recordDownloaded(stateFile, info.version, log);
    announce();
  });
  if (platform === 'darwin') {
    nativeUpdater.on('update-downloaded', () => {
      squirrelHasIt = true;
      announce();
    });
  }

  /**
   * Quit to desktop's and the control's hard exit when the install's graceful
   * quit has not landed. It cannot cost the relaunch on Windows: NsisUpdater
   * spawns the installer (detached, unref'd) inside quitAndInstall, before
   * app.quit() is even scheduled, so by now the installer is a process of its
   * own. It closes a copy of us that is still running by itself
   * (_CHECK_APP_RUNNING under --updated), and it is the installer, not us,
   * that opens the app again (--force-run). On macOS Squirrel.Mac rewrites its
   * relaunch request and terminates the app in milliseconds once the windows
   * are gone; a quit still pending 5 s later means that failed, and an exit
   * beats a process with no window that holds the single-instance lock. Not
   * cleared by stop(): the window closing mid-quit is exactly when this has
   * to survive.
   */
  const exitIfQuitStalls = () => {
    setTimeout(() => {
      log.warn(`quit did not complete within ${INSTALL_QUIT_FALLBACK_MS} ms; exiting`);
      opts.exit(0);
    }, INSTALL_QUIT_FALLBACK_MS);
  };

  // Both installers announce their quit here once the install is really going:
  // BaseUpdater just before its app.quit() (only when install() went ahead),
  // Electron's own autoUpdater before it closes the windows on macOS. Opening
  // the windows up any earlier left a station unlocked whenever the install
  // then refused. A start has no window to open up.
  nativeUpdater.on('before-quit-for-update', () => {
    if (installing !== 'control' && installing !== 'quit') return;
    // Electron's macOS autoUpdater announces twice: again once the windows are gone.
    if (quitAnnounced) return;
    quitAnnounced = true;
    log.info('install quitting; the windows may close');
    opts.allowClose();
    // Quit to desktop armed its own fallback already.
    if (installing === 'control') exitIfQuitStalls();
  });

  /**
   * quitAndInstall, silent and relaunching, at most once per process. False
   * when it refused on the spot: BaseUpdater.install emits 'error' before
   * quitAndInstall returns (the installer is gone from the cache) and then
   * never quits. That download is not offered again; the next check fetches
   * it afresh.
   */
  const requestInstall = (kind: 'start' | 'control' | 'quit'): boolean => {
    if (!ready) return false;
    let refused = false;
    const onRefused = () => {
      refused = true;
    };
    installing = kind;
    updater.on('error', onRefused);
    try {
      // MacUpdater ignores quitAndInstall's arguments: whether the app comes
      // back is autoRunAppAfterInstall, on every install path.
      updater.autoRunAppAfterInstall = true;
      updater.quitAndInstall(true, true);
    } catch (error) {
      refused = true;
      log.error(`install threw: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      updater.off('error', onRefused);
    }
    if (refused) {
      installing = null;
      withdraw('its install refused');
      return false;
    }
    launched = true;
    withdraw('its installer has been started');
    if (platform !== 'darwin') {
      // The installer relaunches the app, so one that never started leaves it
      // closed: BaseUpdater's setImmediate app.quit() goes ahead whatever the
      // spawn did. NsisUpdater.doInstall reports some spawn failures here,
      // after quitAndInstall returns and before that quit (EPERM, EMFILE and
      // the like), and the app then comes back by itself. Not all: ENOENT goes
      // to shell.openPath and EACCES or UNKNOWN (antivirus, AppLocker) to
      // elevate.exe, which report nothing. At a start, the one try per version
      // is what bounds those.
      const onLate = (error: unknown) => {
        log.error(`the installer did not start (${error instanceof Error ? error.message : String(error)}); relaunching`);
        opts.relaunch?.();
      };
      updater.on('error', onLate);
      setImmediate(() => updater.off('error', onLate));
    }
    return true;
  };

  /**
   * The start's install. True: the app is on its way out. A start has no
   * window to hold the quit, so one that has not landed INSTALL_QUIT_FALLBACK_MS
   * later means the install never got going, and the fallback is the window,
   * not app.exit: an exit here leaves a station closed until somebody comes
   * by, which is the problem this exists to fix. On Windows a spawned
   * installer still closes that window itself and relaunches.
   */
  const installAtStartNow = (file: string, carryOn: () => void): boolean => {
    if (!ready) return false;
    if (!claimStartupAttempt(file, opts.version, ready.version, log)) return false;
    log.info(`start: installing ${ready.version} before the window opens`);
    if (!requestInstall('start')) {
      log.warn('start: opening the window');
      return false;
    }
    setTimeout(() => {
      log.warn(`start: quit did not complete within ${INSTALL_QUIT_FALLBACK_MS} ms; opening the window`);
      carryOn();
    }, INSTALL_QUIT_FALLBACK_MS);
    return true;
  };

  // A download in progress is the proof that the cached one is not what the
  // feed offers: a cached one is only re-hashed, and that reports no progress.
  // It will not finish before the wait does on a venue line, so the start
  // stops waiting for it; it keeps downloading and becomes the Update ready
  // control, and the next start.
  const onDownloadProgress = () => endStartupWait?.('downloading; it installs at the next start');

  /** One check. Its download's failure is reported to onDownloadFailed; the promise is caught so it is not also an unhandled rejection. */
  const check = (onDownloadFailed?: () => void) =>
    updater.checkForUpdates().then((result) => {
      void result?.downloadPromise?.catch(() => onDownloadFailed?.());
      return result;
    });

  const checkNow = () => {
    // Not checkForUpdatesAndNotify: no OS toasts on a kiosk. The renderer shows it.
    check().catch((error: unknown) => {
      log.error(`check failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  // The start's check (installAtStart) already asked, and asking again 30 s
  // later would only repeat its answer. A start that could not reach the feed
  // (a till whose network comes up after login) still gets this one.
  const first = setTimeout(() => {
    if (!startupAnswered) checkNow();
  }, UPDATE_FIRST_CHECK_DELAY_MS);
  const interval = setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);

  /** Why this start does not wait for its check, or null when it should. */
  const noWaitReason = (file: string): string | null => {
    const state = settleStartupState(file, opts.version, log);
    const target = state.downloaded;
    // Settled: a download at or below the running version is gone.
    if (!target) return 'no newer download is waiting';
    if (opts.pendingFile && !fs.existsSync(opts.pendingFile)) return `${target} is no longer in the download cache`;
    const refusal = startInstallRefusal(state, target);
    if (refusal) return `not installing ${target}: ${refusal}; the Update ready control still offers it`;
    // The try is written down before it is made, so a file that can be read
    // but not written (a full disk, a read-only flag) would make every start
    // wait for an install it then refuses.
    if (!writeStartupState(file, state, log)) return `not installing ${target}: ${path.basename(file)} cannot be written`;
    const blocked = safeBlocker(blocker, log);
    if (blocked) return `not installing ${target}: ${blocked}; the Update ready control still offers it`;
    return null;
  };

  /** installAtStart's body; `resolve` makes the window. */
  const startWait = (file: string, resolve: () => void) => {
    const skip = noWaitReason(file);
    if (skip) {
      log.info(`start: ${skip}; opening the window`);
      // Still the start's check: it answers the 30 s one.
      check().then(
        () => {
          startupAnswered = true;
        },
        (error: unknown) => log.error(`check failed: ${error instanceof Error ? error.message : String(error)}`),
      );
      resolve();
      return;
    }
    const waitMs = platform === 'darwin' ? STARTUP_INSTALL_WAIT_MAC_MS : STARTUP_INSTALL_WAIT_MS;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => endStartupWait?.(`no answer within ${waitMs} ms`), waitMs);
    updater.on('download-progress', onDownloadProgress);
    endStartupWait = (why) => {
      endStartupWait = null;
      clearTimeout(timer);
      clearTimeout(retry);
      updater.off('download-progress', onDownloadProgress);
      log.info(`start: ${why}`);
      try {
        if (!installAtStartNow(file, resolve)) resolve();
      } catch (error) {
        log.error(`start: ${error instanceof Error ? error.message : String(error)}; opening the window`);
        resolve();
      }
    };
    const ask = () => {
      startCheckOut = true;
      check(startDownloadFailed).then(
        (result) => {
          startCheckOut = false;
          startupAnswered = true;
          if (!result?.isUpdateAvailable) endStartupWait?.('nothing to install');
        },
        (error: unknown) => {
          startCheckOut = false;
          log.error(`check failed: ${error instanceof Error ? error.message : String(error)}`);
          if (!endStartupWait) return;
          log.info(`start: asking again in ${STARTUP_CHECK_RETRY_MS} ms`);
          retry = setTimeout(ask, STARTUP_CHECK_RETRY_MS);
        },
      );
    };
    ask();
  };

  return {
    checkNow,
    installAtStart() {
      if (startTried || !stateFile) return Promise.resolve();
      startTried = true;
      return new Promise<void>((resolve) => {
        try {
          startWait(stateFile, resolve);
        } catch (error) {
          // Disarmed: nothing installs once the window is up.
          endStartupWait = null;
          startCheckOut = false;
          log.error(`start: ${error instanceof Error ? error.message : String(error)}; opening the window`);
          resolve();
        }
      });
    },
    installNow() {
      return requestInstall('control');
    },
    installOnQuit() {
      // Back on the new version, not left closed (owner call, 2026-09-25): a
      // station that stays closed after an install waits for somebody to
      // come and reopen it. Refused on the spot: index.ts just exits.
      if (!requestInstall('quit')) return false;
      // Armed now, not when the quit is announced: whatever the installer
      // does, the person asked to quit.
      exitIfQuitStalls();
      return true;
    },
    ready: () => ready,
    stop() {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
}

/** A blocker that throws is a machine we cannot vouch for: no install at the start. */
function safeBlocker(blocker: () => string | null, log: Logger): string | null {
  try {
    return blocker();
  } catch (error) {
    log.error(`start: install-scope check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'this machine could not be checked';
  }
}

/**
 * Why a start on this Windows machine must not install, or null. An install
 * "for everyone" makes the silent installer ask for administrator approval
 * (app-builder-lib installer.nsi: $hasPerMachineInstallation and /S run
 * UAC_RunElevated), and at a start after boot nobody is there to give it; No,
 * or no answer, quits without reopening the app. The installer decides that
 * on HKLM\Software\<APP_GUID>\InstallLocation (assistedInstaller.nsh
 * initMultiUser). reg.exe's "not there" is also its answer to a policy that
 * blocks it, so a "no" from HKLM counts only when HKCU then says this is an
 * install "just for me"; whatever cannot be read blocks.
 */
export function windowsStartInstallBlocker(installLocation: (hive: 'HKLM' | 'HKCU') => boolean | null): string | null {
  const hklm = installLocation('HKLM');
  if (hklm === true) return 'installed for all users, and its installer would ask for administrator approval';
  if (hklm === false && installLocation('HKCU') === true) return null;
  return 'its install could not be read, and an install for all users would ask for administrator approval';
}

/**
 * reg.exe on <hive>\Software\<APP_GUID> InstallLocation, by its full path.
 * True: the value is there. False: exit 1, which is "not there" and also
 * every refusal (a policy that disables registry tools). Null: anything else
 * (a timeout, no reg.exe).
 */
export function readInstallLocation(
  hive: 'HKLM' | 'HKCU',
  run: typeof execFileSync = execFileSync,
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const reg = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'reg.exe');
  try {
    run(reg, ['query', `${hive}\\Software\\${NSIS_APP_GUID}`, '/v', 'InstallLocation', '/reg:64'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: REG_QUERY_TIMEOUT_MS,
    });
    return true;
  } catch (error) {
    return (error as { status?: number | null }).status === 1 ? false : null;
  }
}

/**
 * electron-updater's record of a finished download:
 * <cache>/<updaterCacheDirName>/pending/update-info.json
 * (AppUpdater.getOrCreateDownloadHelper, DownloadedUpdateHelper.getUpdateInfoFile,
 * AppAdapter.getAppCacheDir). Written when a download completes, emptied when
 * a newer one replaces it or a download fails. The directory name is
 * resources/app-update.yml's updaterCacheDirName ('@touchoperator-shell-updater'
 * on the builds so far), or the app's name, as electron-updater falls back to.
 */
export function updaterPendingFile(o: {
  resourcesPath: string;
  appName: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): string {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const home = o.homedir ?? os.homedir();
  let dirName = '';
  try {
    const yml = fs.readFileSync(path.join(o.resourcesPath, 'app-update.yml'), 'utf8');
    const m = /^updaterCacheDirName:[ \t]*(.+?)[ \t]*$/m.exec(yml);
    dirName = m?.[1]?.replace(/^(['"])(.*)\1$/, '$2') ?? '';
  } catch {
    dirName = ''; // no app-update.yml: electron-updater falls back to the app's name too
  }
  const base =
    platform === 'win32'
      ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      : platform === 'darwin'
        ? path.join(home, 'Library', 'Caches')
        : env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(base, dirName || o.appName, 'pending', 'update-info.json');
}

/**
 * userData/updater-startup.json: what a start needs to know before its check.
 * An install that fails at every start would otherwise take the station down
 * at every start, so a start's try is written down BEFORE it is made, and a
 * start makes one per version.
 */
interface StartupState {
  /** The highest version this station has started on: a start never installs one at or below it (a rollback). */
  highest?: string;
  /** The version of the last download electron-updater finished. */
  downloaded?: string;
  /** The version a start has already tried to install; gone once this station runs it. */
  tried?: string;
}

const STATE_KEYS = ['highest', 'downloaded', 'tried'] as const;

/** The state, with whatever part of it cannot be read left out. Never throws. */
function readStartupState(file: string, log: Logger): StartupState {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {}; // no file is the normal case
  }
  let value: unknown = null;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null; // unparseable: same as a wrong shape
  }
  const state: StartupState = {};
  let unreadable = typeof value !== 'object' || value === null;
  if (!unreadable) {
    const v = value as Record<string, unknown>;
    for (const key of STATE_KEYS) {
      const field = v[key];
      if (typeof field === 'string') state[key] = field;
      else if (field !== undefined) unreadable = true;
    }
  }
  if (unreadable) log.warn(`start: ignoring what cannot be read in ${path.basename(file)}`);
  return state;
}

function writeStartupState(file: string, state: StartupState, log: Logger): boolean {
  try {
    fs.writeFileSync(file, JSON.stringify(state));
    return true;
  } catch (error) {
    log.error(`could not write ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function editStartupState(file: string, log: Logger, edit: (state: StartupState) => void): boolean {
  const state = readStartupState(file, log);
  edit(state);
  return writeStartupState(file, state, log);
}

/**
 * The start's bookkeeping: the running version raises `highest`, and a
 * download or a start's try at or below it has landed (or was overtaken)
 * and goes. Returns the state that is left.
 */
function settleStartupState(file: string, running: string, log: Logger): StartupState {
  const state = readStartupState(file, log);
  let changed = false;
  if (!state.highest || !isAtOrAbove(state.highest, running)) {
    state.highest = running;
    changed = true;
  }
  if (state.tried && isAtOrAbove(running, state.tried)) {
    log.info(`start: running ${running}; the start's install of ${state.tried} is done`);
    delete state.tried;
    changed = true;
  }
  if (state.downloaded && isAtOrAbove(running, state.downloaded)) {
    delete state.downloaded;
    changed = true;
  }
  if (changed) writeStartupState(file, state, log);
  return state;
}

/** Why a start must not install `target`, or null. */
function startInstallRefusal(state: StartupState, target: string): string | null {
  if (state.highest && isAtOrAbove(state.highest, target)) {
    return `this station has run ${state.highest} and was rolled back; a start installs only a release above it`;
  }
  if (state.tried === target) return 'a start already tried to install it';
  return null;
}

/** Write this start's try down, or refuse it. A try that cannot be written down is not made: it could loop. */
function claimStartupAttempt(file: string, running: string, target: string, log: Logger): boolean {
  const state = readStartupState(file, log);
  const refusal = startInstallRefusal(state, target);
  if (refusal) {
    log.warn(`start: not installing ${target}: ${refusal}; the Update ready control still offers it`);
    return false;
  }
  state.tried = target;
  state.highest ??= running;
  if (!writeStartupState(file, state, log)) {
    log.error(`start: not installing ${target}: cannot record the attempt`);
    return false;
  }
  return true;
}

/** The last finished download, for the next start; undefined forgets it. */
function recordDownloaded(file: string, version: string | undefined, log: Logger): void {
  const state = readStartupState(file, log);
  if (state.downloaded === version) return;
  if (version === undefined) delete state.downloaded;
  else state.downloaded = version;
  writeStartupState(file, state, log);
}

/**
 * x.y.z against x.y.z. A prerelease sorts below its release (0.3.0-beta.1 is
 * below 0.3.0): the release workflow accepts such tags and publishes them as
 * ordinary releases, and a station that ran one must still take the release
 * at a start. Two prereleases of one x.y.z count as the same. A version that
 * does not parse is never "at or above".
 */
export function isAtOrAbove(running: string, target: string): boolean {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
    return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] !== undefined } : null;
  };
  const a = parse(running);
  const b = parse(target);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const x = a.core[i] ?? 0;
    const y = b.core[i] ?? 0;
    if (x !== y) return x > y;
  }
  return !a.pre || b.pre;
}

/**
 * The updater's log — electron-updater's own lines (Squirrel.Mac's proxy
 * handshake, the installer command line) and this module's — to the console
 * and, when given a file, to that file. An install that silently did not happen
 * used to leave no trace on a till.
 */
export function createUpdaterLog(file?: string): Logger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', message: unknown) => {
    const text = message instanceof Error ? (message.stack ?? message.message) : String(message);
    if (level === 'warn' || level === 'error') console[level]('[updater]', text);
    else console.log('[updater]', text);
    if (!file) return;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > UPDATER_LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch (error) {
      // An unwritable userData must not take the updater down with it.
      console.error('[updater] log write failed:', error instanceof Error ? error.message : String(error));
    }
  };
  return {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}
