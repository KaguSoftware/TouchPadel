import * as fs from 'node:fs';
import { autoUpdater as squirrelMac } from 'electron';
import { autoUpdater, type AppUpdater, type Logger } from 'electron-updater';
import type { UpdateReadyInfo } from '../ipc-channels';

/**
 * Auto-update (design-arch.md §2.5, §8) — the plain electron-updater loop,
 * without the scheduling machinery that was cut from phase 1: check, download
 * silently, and wait. Installing is a human's call: the rail's "Restart to
 * update" control, or Quit to desktop (index.ts swaps app.exit for
 * installOnQuit when something is ready). `autoInstallOnAppQuit` covers the
 * one remaining exit — an OS shutdown that quits the app gracefully.
 *
 * Every install ends in a graceful app.quit() — electron-updater's on Windows,
 * Squirrel.Mac's on macOS — and a configured till's window is created
 * closable:false, which makes Electron cancel that quit. Quit to desktop did
 * nothing whenever an update was waiting. Both install paths now make the
 * windows closable first, and Quit to desktop still exits hard if the quit has
 * not landed INSTALL_QUIT_FALLBACK_MS later.
 *
 * The feed is the public releases repo (electron-builder.config.cjs `publish`),
 * embedded as resources/app-update.yml at package time. Offline is the normal
 * state for a till for hours at a time, so every failure here is logged and
 * none is allowed to throw.
 */

export const UPDATE_FIRST_CHECK_DELAY_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long Quit to desktop waits for the install's graceful quit before app.exit. */
export const INSTALL_QUIT_FALLBACK_MS = 5_000;
/** updater.log rolls over to updater.log.1 past this size. */
export const UPDATER_LOG_MAX_BYTES = 1024 * 1024;

export interface UpdaterHandle {
  checkNow(): void;
  /** quitAndInstall when a download is waiting; false (and nothing happens) otherwise. */
  installNow(): boolean;
  /** Install silently without relaunching — for the Quit to desktop path. */
  installOnQuit(): boolean;
  ready(): UpdateReadyInfo | null;
  stop(): void;
}

export function startUpdater(opts: {
  /** app.isPackaged — a dev build has no app-update.yml and nothing to update. */
  enabled: boolean;
  onReady: (info: UpdateReadyInfo) => void;
  /** Make every window closable: a closable:false window cancels the install's app.quit(). */
  allowClose: () => void;
  /** app.exit — Quit to desktop's last resort when the install's quit stalls. */
  exit: (code: number) => void;
  /** userData/updater.log. On a packaged till the console goes nowhere. */
  logFile?: string;
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
  let ready: UpdateReadyInfo | null = null;

  updater.logger = log;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;

  updater.on('error', (error) => {
    // ENOTFOUND / ECONNRESET while the WAN is down is the expected case.
    log.error(error instanceof Error ? error.message : String(error));
  });
  updater.on('checking-for-update', () => log.info('checking'));
  updater.on('update-available', (info) => log.info(`update available ${info.version}`));
  updater.on('update-not-available', () => log.info('up to date'));

  // On macOS the install is Squirrel.Mac's, which fetches the zip
  // electron-updater downloaded from a local proxy — and electron-updater
  // announces update-downloaded BEFORE that fetch. Until Squirrel reports,
  // MacUpdater.quitAndInstall() only waits (forever, if Squirrel fails), so the
  // update is not offered until both have reported.
  let downloaded: UpdateReadyInfo | null = null;
  let squirrelHasIt = platform !== 'darwin';
  const announce = () => {
    if (!downloaded || !squirrelHasIt) return;
    ready = downloaded;
    log.info(`update ready ${ready.version}`);
    opts.onReady(ready);
  };
  updater.on('update-downloaded', (info) => {
    downloaded = { version: info.version };
    log.info(`update downloaded ${info.version}${squirrelHasIt ? '' : ' (waiting for Squirrel.Mac)'}`);
    announce();
  });
  if (platform === 'darwin') {
    squirrelMac.on('update-downloaded', () => {
      squirrelHasIt = true;
      announce();
    });
  }

  const checkNow = () => {
    // Not checkForUpdatesAndNotify: no OS toasts on a kiosk. The renderer shows it.
    updater.checkForUpdates().catch((error: unknown) => {
      log.error(`check failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const first = setTimeout(checkNow, UPDATE_FIRST_CHECK_DELAY_MS);
  const interval = setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);

  return {
    checkNow,
    installNow() {
      if (!ready) return false;
      opts.allowClose();
      // MacUpdater ignores quitAndInstall's arguments: whether the app comes
      // back is autoRunAppAfterInstall, on both install paths.
      updater.autoRunAppAfterInstall = true;
      updater.quitAndInstall(true, true);
      return true;
    },
    installOnQuit() {
      if (!ready) return false;
      opts.allowClose();
      updater.autoRunAppAfterInstall = false;
      updater.quitAndInstall(true, false);
      // Not cleared by stop(): the window closing mid-quit is exactly when
      // this has to survive.
      setTimeout(() => {
        log.warn(`quit did not complete within ${INSTALL_QUIT_FALLBACK_MS} ms; exiting`);
        opts.exit(0);
      }, INSTALL_QUIT_FALLBACK_MS);
      return true;
    },
    ready: () => ready,
    stop() {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
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
