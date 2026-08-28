import * as path from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { IPC, type PrintResult } from '../ipc-channels';
import { enqueue, getCachedRef, openQueue, queueStatus } from './queue';
import { loadStation } from './station';
import { startLanKdsServer } from './lan-kds-server';
import { startHeartbeat } from './heartbeat';
import { mayNavigateTo, mayOpenExternally, type NavigationPolicy } from './window-security';
import {
  IpcValidationError,
  validateMutationEnvelope,
  validatePin,
  validatePrintJob,
  validateRefKey,
} from './ipc-validate';

const devServerUrl = process.env.VITE_DEV_SERVER_URL; // e.g. http://localhost:5174 (apps/operator `pnpm dev`)
const isDev = !!devServerUrl || !app.isPackaged;
const navPolicy: NavigationPolicy = { devServerUrl, isDev };

// Single-instance lock (design-arch.md §2.5 kiosk behavior).
//
// This used to call `app.quit()` and fall through: module evaluation continued,
// `app.whenReady()` was still registered, and a second copy could open a second
// SQLite handle on the same queue.db before quitting. `app.quit()` is
// asynchronous — the guard has to stop execution itself.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

/** Wrap an IPC handler so a malformed argument is refused, not stored. */
function guardIpc<T>(name: string, fn: () => T): T | { error: string } {
  try {
    return fn();
  } catch (error) {
    if (error instanceof IpcValidationError) {
      // Deliberately visible: a renderer sending a malformed envelope is a bug
      // in our own code, and on a kiosk this log is the only place it surfaces.
      console.error(`[ipc:${name}]`, error.message);
      return { error: error.message };
    }
    throw error;
  }
}

function createWindow(): BrowserWindow {
  const station = loadStation();
  const win = new BrowserWindow({
    // Kiosk-leaning per design-arch.md §2.5, but closable in dev.
    kiosk: !isDev && (station.mode === 'till' || station.mode === 'kds'),
    autoHideMenuBar: true,
    frame: isDev,
    // TODO(W4): closable:false in production except via manager-PIN "Quit to desktop";
    // launch-on-boot + Task Scheduler watchdog per §2.5 runbook.
    closable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // TODO(W3): bundle the preload to a single file (esbuild) and set sandbox: true —
      // sandboxed preloads cannot require sibling compiled modules.
      sandbox: false,
      // KDS / floor chimes (WebAudio) must play without a click on a station;
      // browser dev keeps the "Start shift" arming gesture (operator-slice.md §4.5).
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Pin the top-level frame to our own renderer. Without this a compromised or
  // merely buggy renderer could navigate the window to remote content while the
  // preload — and with it the durable queue, the PIN unlock and the printer —
  // stays attached to the page.
  const blockNavigation = (event: Electron.Event, url: string) => {
    if (mayNavigateTo(url, navPolicy)) return;
    event.preventDefault();
    console.error('[security] blocked navigation to', url);
  };
  win.webContents.on('will-navigate', blockNavigation);
  win.webContents.on('will-redirect', blockNavigation);

  // Links the renderer opens (Telegram setup doc, etc.) go to the system
  // browser — never a second Electron window inside the kiosk, and never a
  // scheme other than https (http too in dev). `shell.openExternal` hands the
  // string to the OS protocol handler, so an unfiltered URL is an arbitrary
  // local-protocol trigger.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (mayOpenExternally(url, navPolicy)) {
      void shell.openExternal(url);
    } else {
      console.error('[security] refused to open externally:', url);
    }
    return { action: 'deny' };
  });

  // Nothing in this app embeds third-party frames; a webview tag would carry
  // its own preload and its own privileges.
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.error('[security] blocked webview attach');
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    // TODO(W2): load the bundled apps/operator Vite build (base './') from
    // resources/renderer once electron-builder extraResources is wired
    // (electron-builder.yml). Path below works for a monorepo-local `pnpm build`.
    void win.loadFile(path.join(__dirname, '../../../operator/dist/index.html'));
  }

  // Crash recovery (design-arch.md §2.5): renderer gone → reload. Note this
  // covers a PROCESS crash only; a React render throw is caught by the
  // renderer's own error boundary (apps/operator/src/components/CrashScreen.tsx).
  win.webContents.on('render-process-gone', () => win.webContents.reload());
  return win;
}

if (gotTheLock) {
  app.whenReady().then(() => {
    const station = loadStation();
    openQueue();

    ipcMain.handle(IPC.enqueue, (_e, m: unknown) =>
      guardIpc('enqueue', () => enqueue(validateMutationEnvelope(m))),
    );
    ipcMain.handle(IPC.getCachedRef, (_e, key: unknown) =>
      guardIpc('getCachedRef', () => getCachedRef(validateRefKey(key))),
    );
    ipcMain.handle(IPC.print, (_e, job: unknown): PrintResult | { error: string } =>
      guardIpc('print', (): PrintResult => {
        validatePrintJob(job);
        // TODO(W3): ESC/POS raster pipeline — hidden offscreen BrowserWindow renders
        // receipt.html (Arabic shaping by Chromium) → capturePage → sharp 1-bit dither →
        // GS v 0 raster; jobs persisted in a SQLite print_queue (design-arch.md §6.1).
        // NO cash-drawer kick — cut from phase 1 (plan cut #7).
        return { ok: false, error: 'printing-not-implemented' };
      }),
    );
    ipcMain.handle(IPC.unlockPin, (_e, pin: unknown) =>
      guardIpc('unlockPin', () => {
        validatePin(pin);
        // PIN check is online server-side crypt() per design-data.md (plan override #6) —
        // NO per-staff HMAC pin_proof machinery. TODO(W3): call the unlock RPC; pin_cache
        // (argon2 hashes, refreshed online) covers unlock during outages.
        return null;
      }),
    );
    ipcMain.on(IPC.getStation, (e) => {
      e.returnValue = {
        stationId: station.stationId,
        mode: station.mode,
        tillHost: station.tillHost,
      };
    });

    const win = createWindow();

    // A second launch should surface the station that is already trading, not
    // silently do nothing. (Previously there was no handler at all.)
    app.on('second-instance', () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });

    // Push queue status (depth / degraded / conflicts) to the renderer.
    const statusTimer = setInterval(() => {
      if (!win.isDestroyed()) win.webContents.send(IPC.queueUpdate, queueStatus());
    }, 2_000);
    win.on('closed', () => clearInterval(statusTimer));

    startLanKdsServer(station);
    startHeartbeat(station);
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
