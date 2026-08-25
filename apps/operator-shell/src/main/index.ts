import * as path from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { IPC, type MutationEnvelope, type PrintJob, type PrintResult } from '../ipc-channels';
import { enqueue, getCachedRef, openQueue, queueStatus } from './queue';
import { loadStation } from './station';
import { startLanKdsServer } from './lan-kds-server';
import { startHeartbeat } from './heartbeat';

const devServerUrl = process.env.VITE_DEV_SERVER_URL; // e.g. http://localhost:5174 (apps/operator `pnpm dev`)
const isDev = !!devServerUrl || !app.isPackaged;

// Single-instance lock (design-arch.md §2.5 kiosk behavior).
if (!app.requestSingleInstanceLock()) {
  app.quit();
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

  // Links the renderer opens (Telegram setup doc, etc.) go to the system
  // browser — never a second Electron window inside the kiosk.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    // TODO(W2): load the bundled apps/operator Vite build (base './') from
    // resources/renderer once electron-builder extraResources is wired
    // (electron-builder.yml). Path below works for a monorepo-local `pnpm build`.
    void win.loadFile(path.join(__dirname, '../../../operator/dist/index.html'));
  }

  // Crash recovery (design-arch.md §2.5): renderer gone → reload.
  win.webContents.on('render-process-gone', () => win.webContents.reload());
  return win;
}

app.whenReady().then(() => {
  const station = loadStation();
  openQueue();

  ipcMain.handle(IPC.enqueue, (_e, m: MutationEnvelope) => enqueue(m));
  ipcMain.handle(IPC.getCachedRef, (_e, key: string) => getCachedRef(key));
  ipcMain.handle(IPC.print, (_e, job: PrintJob): PrintResult => {
    // TODO(W3): ESC/POS raster pipeline — hidden offscreen BrowserWindow renders
    // receipt.html (Arabic shaping by Chromium) → capturePage → sharp 1-bit dither →
    // GS v 0 raster; jobs persisted in a SQLite print_queue (design-arch.md §6.1).
    // NO cash-drawer kick — cut from phase 1 (plan cut #7).
    void job;
    return { ok: false, error: 'printing-not-implemented' };
  });
  ipcMain.handle(IPC.unlockPin, (_e, pin: string) => {
    // PIN check is online server-side crypt() per design-data.md (plan override #6) —
    // NO per-staff HMAC pin_proof machinery. TODO(W3): call the unlock RPC; pin_cache
    // (argon2 hashes, refreshed online) covers unlock during outages.
    void pin;
    return null;
  });
  ipcMain.on(IPC.getStation, (e) => {
    e.returnValue = {
      stationId: station.stationId,
      mode: station.mode,
      tillHost: station.tillHost,
    };
  });

  const win = createWindow();

  // Push queue status (depth / degraded / conflicts) to the renderer.
  const statusTimer = setInterval(() => {
    if (!win.isDestroyed()) win.webContents.send(IPC.queueUpdate, queueStatus());
  }, 2_000);
  win.on('closed', () => clearInterval(statusTimer));

  startLanKdsServer(station);
  startHeartbeat(station);
});

app.on('window-all-closed', () => {
  app.quit();
});
