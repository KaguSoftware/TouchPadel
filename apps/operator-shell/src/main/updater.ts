import { autoUpdater, type AppUpdater } from 'electron-updater';
import type { UpdateReadyInfo } from '../ipc-channels';

/**
 * Auto-update (design-arch.md §2.5, §8) — the plain electron-updater loop,
 * without the scheduling machinery that was cut from phase 1: check, download
 * silently, and wait. Installing is a human's call: the rail's "Restart to
 * update" control, or the manager-PIN quit (index.ts swaps app.exit for
 * quitAndInstall when something is ready). `autoInstallOnAppQuit` covers the
 * one remaining exit — an OS shutdown that quits the app gracefully.
 *
 * The feed is the public releases repo (electron-builder.config.cjs `publish`),
 * embedded as resources/app-update.yml at package time. Offline is the normal
 * state for a till for hours at a time, so every failure here is logged and
 * none is allowed to throw.
 */

export const UPDATE_FIRST_CHECK_DELAY_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdaterHandle {
  checkNow(): void;
  /** quitAndInstall when a download is waiting; false (and nothing happens) otherwise. */
  installNow(): boolean;
  /** Install silently without relaunching — for the manager-PIN quit path. */
  installOnQuit(): boolean;
  ready(): UpdateReadyInfo | null;
  stop(): void;
}

export function startUpdater(opts: {
  /** app.isPackaged — a dev build has no app-update.yml and nothing to update. */
  enabled: boolean;
  onReady: (info: UpdateReadyInfo) => void;
  /** Test seam; defaults to electron-updater's singleton. */
  updater?: AppUpdater;
}): UpdaterHandle | null {
  if (!opts.enabled) {
    console.log('[updater] disabled (not packaged)');
    return null;
  }
  const updater = opts.updater ?? autoUpdater;
  let ready: UpdateReadyInfo | null = null;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;

  updater.on('error', (error) => {
    // ENOTFOUND / ECONNRESET while the WAN is down is the expected case.
    console.error('[updater]', error instanceof Error ? error.message : String(error));
  });
  updater.on('checking-for-update', () => console.log('[updater] checking'));
  updater.on('update-available', (info) => console.log('[updater] update available', info.version));
  updater.on('update-not-available', () => console.log('[updater] up to date'));
  updater.on('update-downloaded', (info) => {
    ready = { version: info.version };
    console.log('[updater] update downloaded', info.version);
    opts.onReady(ready);
  });

  const checkNow = () => {
    // Not checkForUpdatesAndNotify: no OS toasts on a kiosk. The renderer shows it.
    updater.checkForUpdates().catch((error: unknown) => {
      console.error('[updater] check failed:', error instanceof Error ? error.message : String(error));
    });
  };

  const first = setTimeout(checkNow, UPDATE_FIRST_CHECK_DELAY_MS);
  const interval = setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);

  return {
    checkNow,
    installNow() {
      if (!ready) return false;
      updater.quitAndInstall(true, true);
      return true;
    },
    installOnQuit() {
      if (!ready) return false;
      updater.quitAndInstall(true, false);
      return true;
    },
    ready: () => ready,
    stop() {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
}
