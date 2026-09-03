import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { IPC, type PrintResult } from '../ipc-channels';
import {
  enqueue,
  getCachedRef,
  listBlockingRows,
  openQueue,
  putCachedRef,
  queueStatus,
  setConnOnline,
} from './queue';
import { loadStation } from './station';
import { startLanKdsServer, type LanKdsServer } from './lan-kds-server';
import { startLanKdsClient, type LanKdsClient } from './lan-kds-client';
import { startHeartbeat } from './heartbeat';
import { setAuthState } from './auth-state';
import { observePin, unlockPinOffline } from './pin-cache';
import { printReceiptHtml } from './print/print-receipt';
import { startSyncWorker, type SyncWorker } from './sync-worker';
import { mayNavigateTo, mayOpenExternally, type NavigationPolicy } from './window-security';
import {
  IpcValidationError,
  validateAuthState,
  validateCachePut,
  validateConnState,
  validateLanStatus,
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

let worker: SyncWorker | null = null;
let lanServer: LanKdsServer | null = null;
let lanClient: LanKdsClient | null = null;

/**
 * First-run station bootstrap: `--station-id=TILL-01 --station-mode=till
 * [--till-host=… --lan-psk=… --lan-bind=…]` writes station.json into userData
 * when none exists — so the three-machine install runbook is scriptable
 * (a shortcut per station) instead of hand-editing JSON in %APPDATA%.
 */
function bootstrapStationFromArgv(): void {
  const file = path.join(app.getPath('userData'), 'station.json');
  if (fs.existsSync(file)) return;
  const flag = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const stationId = flag('station-id');
  const mode = flag('station-mode');
  if (!stationId && !mode) return;
  const config = {
    station_id: stationId ?? 'TILL1',
    mode: mode ?? 'till',
    ...(flag('till-host') ? { till_host: flag('till-host') } : {}),
    ...(flag('lan-psk') ? { lan_psk: flag('lan-psk') } : {}),
    ...(flag('lan-bind') ? { lan_bind: flag('lan-bind') } : {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  console.log('[station] wrote', file, 'from CLI flags');
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
    // Production: the window closes only through the manager-PIN quit
    // (touch:quit-app below) — a till someone can casually X out of is a till
    // that silently stops heartbeating and degrades the whole venue.
    closable: isDev,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is a single esbuild bundle (esbuild.config.mjs), so the
      // sandbox can finally be on — it no longer require()s sibling modules.
      sandbox: true,
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
  } else if (app.isPackaged) {
    // The SPA rides as extraResources/renderer (electron-builder.yml) — loaded
    // from disk, never a URL: the UI boots with zero network (design-arch §2).
    void win.loadFile(path.join(process.resourcesPath, 'renderer', 'index.html'));
  } else {
    // Monorepo-local `pnpm build` of apps/operator, for `electron .` smoke runs.
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
    bootstrapStationFromArgv();
    const station = loadStation();
    openQueue();

    // Launch on boot (design-arch §2.5): registered on every packaged start so
    // an install moved between accounts heals itself; the NSIS runAfterFinish
    // covers only the very first session.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    ipcMain.handle(IPC.enqueue, (_e, m: unknown) =>
      guardIpc('enqueue', () => {
        const envelope = validateMutationEnvelope(m);
        const result = enqueue(envelope);
        // The insert is fsynced; replay immediately — online, the round trip
        // lands sub-second and the "one write path" costs nothing perceptible.
        worker?.kick();
        // Kitchen-bound rows also go out over the LAN so a KDS keeps receiving
        // tickets while the cloud path is down (design-arch §2.4).
        lanServer?.onEnqueued(envelope);
        return result;
      }),
    );

    ipcMain.on(IPC.lanStatus, (_e, v: unknown) => {
      guardIpc('lanStatus', () => {
        const update = validateLanStatus(v);
        lanClient?.sendStatus({ ...update, kdsStation: station.stationId });
        return null;
      });
    });

    ipcMain.on(IPC.authState, (_e, s: unknown) => {
      guardIpc('authState', () => {
        setAuthState(validateAuthState(s));
        return null;
      });
    });

    ipcMain.on(IPC.connState, (_e, v: unknown) => {
      guardIpc('connState', () => {
        setConnOnline(validateConnState(v));
        return null;
      });
    });

    ipcMain.handle(IPC.queueRows, () =>
      guardIpc('queueRows', () =>
        listBlockingRows().map((r) => ({
          seq: r.seq,
          localId: r.localId,
          idempotencyKey: r.idempotencyKey,
          mutationType: r.mutationType,
          state: r.state as Exclude<typeof r.state, 'acked'>,
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt,
        })),
      ),
    );
    ipcMain.handle(IPC.getCachedRef, (_e, key: unknown) =>
      guardIpc('getCachedRef', () => getCachedRef(validateRefKey(key))),
    );
    ipcMain.handle(IPC.print, async (_e, job: unknown): Promise<PrintResult | { error: string }> => {
      // async handler: guardIpc is sync, so validate inside a try of our own.
      let validated;
      try {
        validated = validatePrintJob(job);
      } catch (error) {
        if (error instanceof IpcValidationError) {
          console.error('[ipc:print]', error.message);
          return { error: error.message };
        }
        throw error;
      }
      const html = (validated.data as { html?: string } | null)?.html;
      if (!html) return { ok: false, error: 'no-html' };
      if (!station.printer) {
        // No printer configured — the renderer falls back to window.print();
        // the on-screen bill satisfies SOW L456 meanwhile.
        return { ok: false, error: 'no-printer' };
      }
      try {
        await printReceiptHtml(html, station.printer);
        return { ok: true };
      } catch (error) {
        // One retry: thermal printers drop the first connection after idling.
        try {
          await printReceiptHtml(html, station.printer);
          return { ok: true };
        } catch {
          console.error('[print]', error);
          return { ok: false, error: String(error) };
        }
      }
      // NO cash-drawer kick — cut from phase 1 (plan cut #7).
    });
    ipcMain.handle(IPC.unlockPin, (_e, pin: unknown) =>
      guardIpc('unlockPin', () => {
        // Purely the OFFLINE check (pin-cache.ts): scrypt of pins that
        // succeeded server-side recently, constant-time compare, 14-day TTL.
        // Online verification stays where it always was — inside the PIN-gated
        // RPCs themselves. The renderer decides which path applies.
        return unlockPinOffline(validatePin(pin));
      }),
    );

    ipcMain.on(IPC.cachePut, (_e, v: unknown) => {
      guardIpc('cachePut', () => {
        const { key, payload } = validateCachePut(v);
        putCachedRef(key, payload);
        return null;
      });
    });

    ipcMain.on(IPC.pinObserved, (_e, pin: unknown) => {
      guardIpc('pinObserved', () => {
        observePin(validatePin(pin));
        return null;
      });
    });

    // Manager-PIN quit (design-arch §2.5): the ONLY way a production window
    // closes. The renderer verifies the pin server-side first when online
    // (verify_manager_pin) and pushes it to the offline cache; this handler
    // re-checks against that cache so a random keypress can never kill a till.
    ipcMain.handle(IPC.quitApp, (_e, pin: unknown) =>
      guardIpc('quitApp', () => {
        const unlocked = unlockPinOffline(validatePin(pin));
        if (!unlocked) return { ok: false as const, error: 'pin not recognised' };
        setTimeout(() => app.exit(0), 50); // let the reply reach the renderer
        return { ok: true as const };
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

    const pushStatus = () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.queueUpdate, queueStatus());
    };

    worker = startSyncWorker({
      onResult: (result) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.mutationResult, result);
      },
      onActivity: pushStatus,
    });

    // Push queue status (depth / degraded / conflicts) to the renderer — the
    // 2s timer is the floor; the worker pushes eagerly on every state change.
    const statusTimer = setInterval(pushStatus, 2_000);
    win.on('closed', () => {
      clearInterval(statusTimer);
      worker?.stop();
    });

    lanServer = startLanKdsServer(station, {
      onQueueChanged: () => {
        pushStatus();
        worker?.kick(); // a KDS bump entered the till's queue — replay it
      },
    });
    lanClient = startLanKdsClient(station, (frame) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.lanTicket, frame);
    });
    win.on('closed', () => {
      lanServer?.close();
      lanClient?.close();
    });
    startHeartbeat(station);
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
