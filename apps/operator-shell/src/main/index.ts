import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain, screen, shell } from 'electron';
import { IPC, type PrintResult } from '../ipc-channels';
import {
  enqueue,
  getCachedRef,
  listBlockingRows,
  openQueue,
  putCachedRef,
  queueStatus,
  resolveRow,
  setConnOnline,
} from './queue';
import { canTrade, loadStation, writeStation } from './station';
import { completeFirstRun } from './first-run';
import { isPairingCode } from './pairing-code';
import { LAN_KDS_PORT, pickLanBind, startLanKdsServer, type LanKdsServer } from './lan-kds-server';
import { startLanKdsClient, type LanKdsClient } from './lan-kds-client';
import { confirmTill, discoverTill, SCAN_HANDSHAKE_TIMEOUT_MS } from './lan-discover';
import { startUpdater, updaterPendingFile, type UpdaterHandle } from './updater';
import { startHeartbeat } from './heartbeat';
import { getAuthState, setAuthState } from './auth-state';
import { mayLeave, observePin, unlockPinOffline } from './pin-cache';
import { printReceiptHtml } from './print/print-receipt';
import { startSyncWorker, type SyncWorker } from './sync-worker';
import {
  clampWindowMinimum,
  LAYOUT_MIN_HEIGHT,
  LAYOUT_MIN_WIDTH,
  openingWindowSize,
  mayNavigateTo,
  mayOpenExternally,
  shouldRecoverToRenderer,
  shouldShowTrafficLights,
  type NavigationPolicy,
} from './window-security';
import {
  IpcValidationError,
  validateAuthState,
  validateCachePut,
  validateChromeless,
  validateConnState,
  validateDiscoverRequest,
  validateLanStatus,
  validateMutationEnvelope,
  validatePin,
  validatePinOwner,
  validatePrintJob,
  validateRefKey,
  validateResolveQueueRow,
  validateStationSetup,
} from './ipc-validate';

const devServerUrl = process.env.VITE_DEV_SERVER_URL; // e.g. http://localhost:5174 (apps/operator `pnpm dev`)
const isDev = !!devServerUrl || !app.isPackaged;
const navPolicy: NavigationPolicy = { devServerUrl, isDev };

/**
 * Height in CSS px that `titleBarStyle: 'hiddenInset'` reserves at the
 * top-left for the macOS traffic lights. The buttons themselves are ~14pt on a
 * 12pt inset; 52 is the first round number that clears them plus a little
 * breathing room, and it is what the renderer pads its rail by.
 */
const TRAFFIC_LIGHT_INSET = 52;


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
let updater: UpdaterHandle | null = null;
/**
 * Set by the updater's allowClose once an install's quit is under way: every
 * close is that quit now. The red-light guard below must let it through (it
 * used to hold those closes too, and on macOS every window has it: Electron's
 * autoUpdater.quitAndInstall closes every window first and installs only once
 * they are all gone), and window-all-closed must not quit on top of it.
 */
let closingForUpdate = false;
/** The kitchen screen's in-flight LAN sweep; a new request cancels the last. */
let discoverAbort: AbortController | null = null;

/**
 * Scripted station bootstrap: `--station-id=TILL-01 --station-mode=till
 * [--till-host=… --lan-psk=… --lan-bind=…]` writes station.json into userData
 * when none exists — the install runbook's shortcut-per-station alternative to
 * the first-run setup screen (which is the primary path: completeFirstRun).
 */
function bootstrapStationFromArgv(): void {
  const file = path.join(app.getPath('userData'), 'station.json');
  if (fs.existsSync(file)) return;
  const flag = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const stationId = flag('station-id');
  const mode = flag('station-mode');
  if (!stationId && !mode) return;
  writeStation({
    station_id: stationId ?? 'TILL1',
    mode: mode ?? 'till',
    ...(flag('till-host') ? { till_host: flag('till-host') } : {}),
    ...(flag('lan-psk') ? { lan_psk: flag('lan-psk') } : {}),
    ...(flag('lan-bind') ? { lan_bind: flag('lan-bind') } : {}),
  });
  console.log('[station] wrote', file, 'from CLI flags');
}

/**
 * A throw during boot used to vanish: app.whenReady().then(...) turned it into
 * an unhandled rejection, Electron logged it to a stderr nobody sees on a
 * kiosk, and the process sat there with no window — every later click on the
 * shortcut was then eaten by the single-instance lock. (operator-v0.2.0 did
 * exactly this with a better-sqlite3 built for the wrong ABI.) Now it is a
 * dialog, a line in userData/startup-error.log, and an exit.
 */
function reportFatalStartup(error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('[boot] fatal:', detail);
  let logFile = '';
  try {
    logFile = path.join(app.getPath('userData'), 'startup-error.log');
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${detail}

`);
  } catch {
    logFile = ''; // userData unwritable — the dialog still carries the message
  }
  dialog.showErrorBox(
    'Touch Padel Operator could not start',
    `${detail}${logFile ? `

Saved to ${logFile}` : ''}`,
  );
  app.exit(1);
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

/**
 * The windows that were created WITH traffic lights. Hiding buttons on a
 * window that never had them is meaningless, and showing them again would
 * hand a kiosk an exit it is not supposed to have.
 */
const windowsWithTrafficLights = new WeakSet<BrowserWindow>();

/**
 * Windows whose renderer asked for a bare window (the kitchen board). Kept so
 * a full-screen transition recomputes button visibility without handing the
 * board its traffic lights back.
 */
const chromeless = new WeakSet<BrowserWindow>();
/**
 * Windows the kitchen board itself put into full screen. Leaving the board
 * undoes only that: a full screen the operator chose (green button, or already
 * full screen before signing in) is theirs, and a non-board screen mounting
 * (every sign-in does) must not throw them out of it.
 */
const boardFullscreen = new WeakSet<BrowserWindow>();
/**
 * Windows a manager let out of the lock (touch:exit-fullscreen with a PIN that
 * was not the signed-in person's own). Held only until the signed-in person
 * changes: the next sign-in or sign-out puts the station back in (lockWindow).
 */
const released = new WeakSet<BrowserWindow>();
/** The staff id each window last reported, so a TOKEN_REFRESHED push is not read as a change of person. */
const lastStaff = new WeakMap<BrowserWindow, string | null>();

/**
 * Staff are kept inside the app (owner call, 2026-09-23): a configured
 * station is a kiosk on every platform and in every mode, cannot be minimised,
 * and its only exits — Quit to desktop and Exit forced full screen — take a
 * manager's PIN that is not the signed-in person's own (pin-cache.ts mayLeave).
 *
 * On macOS kiosk is what actually holds the door: Electron sets the
 * presentation options that disable Cmd+Tab, Hide, Force Quit and the Dock,
 * and none of that can be done from the page. The traffic lights go with it,
 * and the red one was a way out anyway (it opens the same PIN dialog as Quit
 * when the window is released). Windows' kiosk covers the taskbar; locking
 * Alt+Tab and the Windows key there is the OS's job (Assigned Access), not
 * something an app can take.
 */
function lockWindow(win: BrowserWindow): void {
  released.delete(win);
  win.setMinimizable(false);
  // Back to what createWindow gave it: closable only where the red traffic
  // light exists, and there the close is held and handed to the PIN dialog.
  win.setClosable(windowsWithTrafficLights.has(win));
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
  if (!win.isKiosk()) win.setKiosk(true);
}

function createWindow(): BrowserWindow {
  const station = loadStation();
  // An UNCONFIGURED station (first run, before station.json exists) is a
  // normal window: there is no manager PIN in the offline cache yet, so a
  // kiosk whose only exit is the setup screen would be a machine nobody can
  // close if it was launched by mistake. Kiosk starts on the relaunch after setup.
  const relaxed = isDev || !station.configured;
  // Every configured production station starts locked (see lockWindow).
  const locked = !relaxed;
  // macOS: every window keeps the real OS close/minimise/zoom buttons, kiosk
  // modes included. `hiddenInset` draws them over the content instead of a full
  // titlebar, so a station still looks like the app and not like a browser —
  // see shouldShowTrafficLights.
  // Never larger than the screen it opens on: a floor macOS cannot honour
  // would push the bottom of the app off the work area for good.
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const floor = { width: LAYOUT_MIN_WIDTH, height: LAYOUT_MIN_HEIGHT };
  const minimum = clampWindowMinimum(floor, workArea);
  // Opened at a size that already clears the floor, so macOS has nothing to
  // correct on the first drag. See openingWindowSize.
  const opening = openingWindowSize(floor, workArea);
  const trafficLights = shouldShowTrafficLights({
    platform: process.platform,
    isDev,
    configured: station.configured,
    mode: station.mode,
  });
  const win = new BrowserWindow({
    // Kiosk per design-arch.md §2.5, on every configured station, whatever
    // its mode or platform — staff are kept inside the app (lockWindow). This
    // used to skip macOS so the traffic lights stayed visible; a till whose
    // red, yellow and green buttons let a cashier leave is not a till they are
    // kept in. Dev and first run stay windowed (`relaxed`).
    kiosk: locked,
    autoHideMenuBar: true,
    // Electron's default window is 800x600 — smaller than the floor below, so
    // the window opened cramped and then JUMPED to the minimum the moment it
    // was dragged, because macOS enforces the minimum on the first resize.
    // Opening at a size that already respects the floor is what removes the
    // jump; `opening` is the floor grown to a comfortable share of the screen.
    width: opening.width,
    height: opening.height,
    // A floor, not a size: this only stops the window being dragged down to
    // where the rail and the screen beside it no longer fit. Harmless on a
    // kiosk, which the OS sizes anyway.
    minWidth: minimum.width,
    minHeight: minimum.height,
    // The traffic lights are drawn by the frame, so a macOS window that shows
    // them is framed even when `relaxed` is false.
    frame: relaxed || trafficLights,
    ...(trafficLights ? { titleBarStyle: 'hiddenInset' as const } : {}),
    // Production: the window closes only through Quit to desktop
    // (touch:quit-app below), so there is no OS titlebar X on a till — but
    // that action no longer asks for a PIN, so what stops a casual exit is
    // its confirmation dialog, not a credential. Where the traffic lights are
    // shown the red button has to actually close, or it is worse than absent.
    closable: relaxed || trafficLights,
    // Never minimisable on a locked station, whoever is signed in: sending the
    // till to the Dock is leaving it. setMinimizable also refuses Cmd+M and
    // Window > Minimize. A manager's PIN releases it (touch:exit-fullscreen).
    minimizable: !locked,
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
  } else {
    const rendererFile = app.isPackaged
      ? // The SPA rides as extraResources/renderer (electron-builder.yml) — loaded
        // from disk, never a URL: the UI boots with zero network (design-arch §2).
        path.join(process.resourcesPath, 'renderer', 'index.html')
      : // Monorepo-local `pnpm build` of apps/operator, for `electron .` smoke runs.
        path.join(__dirname, '../../../operator/dist/index.html');
    void win.loadFile(rendererFile);

    // A reload of a URL that is not index.html used to end on a white window
    // (window-security.ts shouldRecoverToRenderer). Put the renderer back.
    const rendererUrl = pathToFileURL(rendererFile).href;
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (!shouldRecoverToRenderer({ url, errorCode, isMainFrame }, rendererUrl)) return;
      console.error('[window] load failed, returning to the renderer:', url, errorDescription);
      void win.loadFile(rendererFile);
    });
  }

  // Crash recovery (design-arch.md §2.5): renderer gone → reload. Note this
  // covers a PROCESS crash only; a React render throw is caught by the
  // renderer's own error boundary (apps/operator/src/components/CrashScreen.tsx).
  win.webContents.on('render-process-gone', () => win.webContents.reload());

  // The red traffic light must ask before it ends service. macOS closes the
  // window the moment it is clicked, which on a station means the app is gone
  // mid-shift on one mis-click — so the close is held here and handed to the
  // page, which opens the same "Quit to desktop?" dialog the rail row uses.
  // Confirming there calls touch:quit-app, and that exits through app.exit(),
  // which does not raise 'close' — so this guard cannot block the real quit.
  // An update's install closes the windows through Electron (app.quit() on
  // Windows, the autoUpdater on macOS), which does; closingForUpdate lets
  // that one through.
  //
  // Only where the buttons exist — Windows draws none, and browser dev has no
  // window to guard.
  // Full screen and the traffic lights are alternatives, not companions. In a
  // macOS full-screen Space the buttons only reappear on a mouse-to-the-top
  // reveal, so a station driven by touch has no visible way back — that is the
  // rail's "Exit forced full screen" row, which shows itself exactly while
  // this is true. Windowed, the buttons are right there and the row would be a
  // second control for what the green one already does.
  //
  // Published for EVERY window, not just the ones with buttons: on Windows a
  // till or a KDS is still born `kiosk: true` with no traffic lights at all,
  // and that row is its only way out — so it has to hear about the transition
  // too.
  const publishFullscreen = () => {
    if (win.isDestroyed()) return;
    const fullscreen = win.isFullScreen() || win.isKiosk() || win.isSimpleFullScreen();
    if (trafficLights) win.setWindowButtonVisibility(!fullscreen && !chromeless.has(win));
    win.webContents.send(IPC.fullscreenState, fullscreen);
  };
  win.on('enter-full-screen', publishFullscreen);
  win.on('leave-full-screen', () => {
    // However it left (Esc, green button, Exit full screen), the board's full
    // screen is over; a later one is the operator's and survives the board.
    boardFullscreen.delete(win);
    publishFullscreen();
  });
  win.webContents.on('did-finish-load', publishFullscreen);

  if (trafficLights) {
    windowsWithTrafficLights.add(win);

    win.on('close', (event) => {
      if (win.isDestroyed() || closingForUpdate) return;
      event.preventDefault();
      win.webContents.send(IPC.closeRequested);
    });
  }
  return win;
}

if (gotTheLock) {
  app.whenReady().then(async () => {
    bootstrapStationFromArgv();

    // Auto-update (updater.ts): silent download; installed at the next start,
    // from the rail's control, or by Quit to desktop. Started before anything
    // else so that a start can install what an earlier session downloaded
    // BEFORE the queue opens, the LAN port binds or a window exists, and come
    // back on the new version. installAtStart resolves at once when no newer
    // download is waiting or none may install here (a start already tried
    // that version, a rollback, an install for all users); otherwise within
    // the updater's wait (15 s, 30 s on macOS), unless an install is taking
    // the app down. It never rejects. The start then goes on as it always
    // did. bootstrapStationFromArgv runs first: the installer's relaunch
    // carries none of this launch's flags.
    updater = startUpdater({
      enabled: app.isPackaged,
      version: app.getVersion(),
      onReady: (info) => {
        // None yet during the start's wait; the renderer asks on mount
        // (updateState). null withdraws an update offered earlier (its
        // install refused, or a newer download replaced it): the preload
        // hands it straight to useUpdateReady, and the rail's control and
        // Quit's "installs as you quit" line go.
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.updateReady, info);
      },
      allowClose: () => {
        closingForUpdate = true;
        for (const w of BrowserWindow.getAllWindows()) w.setClosable(true);
      },
      exit: (code) => app.exit(code),
      relaunch: () => app.relaunch(),
      logFile: path.join(app.getPath('userData'), 'updater.log'),
      stateFile: path.join(app.getPath('userData'), 'updater-startup.json'),
      pendingFile: app.isPackaged
        ? updaterPendingFile({ resourcesPath: process.resourcesPath, appName: app.getName() })
        : undefined,
    });
    await updater?.installAtStart();

    const station = loadStation();
    // createWindow's `locked`: a dev or first-run window is an ordinary one,
    // with no PIN to ask for (a first-run machine has none cached yet).
    const stationLocked = station.configured && !isDev;
    openQueue();

    // Launch on boot (design-arch §2.5): registered on every packaged start so
    // an install moved between accounts heals itself; the NSIS runAfterFinish
    // covers only the very first session.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    ipcMain.handle(IPC.enqueue, (_e, m: unknown) =>
      guardIpc('enqueue', () => {
        // SEC-32: a machine that does not know which station it is must not
        // take a sale. The renderer already refuses (it shows the setup or
        // broken-install screen instead of the till), so reaching here means
        // something bypassed the shell UI — a stale window, a replayed IPC
        // message. Every queued row carries station_id into the idempotency
        // key, the audit trail and the day's reconciliation, so accepting one
        // from an unidentified machine is worse than dropping it: it is a sale
        // filed under somebody else's till.
        if (!canTrade(station)) {
          throw new Error('station is not configured — refusing to queue a mutation');
        }
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
        // Same rule (SEC-32): an unidentified machine does not announce itself
        // on the venue LAN. kdsStation is how a till labels which kitchen
        // screen acknowledged a ticket.
        if (!canTrade(station)) return null;
        const update = validateLanStatus(v);
        lanClient?.sendStatus({ ...update, kdsStation: station.stationId });
        return null;
      });
    });

    ipcMain.on(IPC.authState, (e, s: unknown) => {
      guardIpc('authState', () => {
        const next = validateAuthState(s);
        setAuthState(next);
        // A released station goes back in when the person changes: the next
        // shift is not let out because a manager let the last one out and
        // forgot. A token refresh is the same person, so it changes nothing.
        const win = BrowserWindow.fromWebContents(e.sender);
        if (win && !win.isDestroyed()) {
          const staffId = next?.staffId ?? null;
          const changed = lastStaff.has(win) && lastStaff.get(win) !== staffId;
          lastStaff.set(win, staffId);
          if (changed && released.has(win) && stationLocked) lockWindow(win);
        }
        return null;
      });
    });

    // The kitchen board asks for a bare window: no traffic lights over its
    // header. Only where they exist in the first place — Windows draws none.
    // The window keeps its 'hiddenInset' inset either way, so the renderer's
    // spacer stays correct whichever screen is up.
    //
    // This is now what makes a macOS KDS station edge-to-edge at all. It is no
    // longer born `kiosk: true` there (see createWindow: kiosk would hide the
    // traffic lights it was just given), so the full-screen Space comes from
    // the board asking for it — and goes away again when the operator browses
    // off the board, which is the behaviour a till/desk machine covering the
    // pass always had. Without it the board rendered inset in the middle of a
    // windowed macOS app, instead of the wall-mounted board design-arch §2.5
    // wants. Windows' taskbar-covering kiosk already reads as full screen.
    //
    // setFullScreen, not setSimpleFullScreen: the ask is the real macOS
    // full-screen Space (the same transition as the green button, its own
    // Mission Control tile, the menu bar auto-hidden), not the borderless-
    // window imitation, even though that means eating the Space-switch
    // animation on every workspace toggle.
    ipcMain.on(IPC.chromeless, (e, v: unknown) => {
      guardIpc('chromeless', () => {
        if (process.platform !== 'darwin') return null;
        const win = BrowserWindow.fromWebContents(e.sender);
        if (!win || win.isDestroyed() || !windowsWithTrafficLights.has(win)) return null;
        const bare = validateChromeless(v);
        if (bare) chromeless.add(win);
        else chromeless.delete(win);
        const fullscreen = win.isFullScreen() || win.isKiosk() || win.isSimpleFullScreen();
        win.setWindowButtonVisibility(!bare && !fullscreen);
        if (!win.isKiosk()) {
          if (bare && !win.isFullScreen()) {
            boardFullscreen.add(win);
            win.setFullScreen(true);
          } else if (!bare && boardFullscreen.has(win)) {
            boardFullscreen.delete(win);
            win.setFullScreen(false);
          }
        }
        return null;
      });
    });

    // A subscriber's first read: the rail mounts long after the window
    // settled into whatever state it is in, so it asks rather than waiting for
    // the next transition that may never come.
    ipcMain.handle(IPC.fullscreenState, (e) =>
      guardIpc('fullscreenState', () => {
        const win = BrowserWindow.fromWebContents(e.sender);
        if (!win || win.isDestroyed()) return false;
        return win.isFullScreen() || win.isKiosk() || win.isSimpleFullScreen();
      }),
    );

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
          state: r.state as Exclude<typeof r.state, 'acked' | 'resolved'>,
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt,
        })),
      ),
    );

    // A manager dismissing a row the worker will never deliver (409 conflict /
    // deterministic 4xx). Until this existed, one ITEM_UNAVAILABLE on an
    // offline order held day close shut forever: 'failed' is terminal, blocks
    // close, and nothing could clear it. Manager PIN against the offline
    // cache; the renderer verifies server-side first when online.
    ipcMain.handle(IPC.resolveQueueRow, (_e, v: unknown) =>
      guardIpc('resolveQueueRow', () => {
        const req = validateResolveQueueRow(v);
        if (!unlockPinOffline(req.pin)) return { ok: false as const, error: 'pin not recognised' as const };
        if (!resolveRow(req.idempotencyKey, getAuthState()?.staffId ?? null)) {
          return { ok: false as const, error: 'not-resolvable' as const };
        }
        pushStatus(); // the banner count and the heartbeat's depth drop now, not in 2s
        return { ok: true as const };
      }),
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
      // SEC-32. A receipt is a financial document naming the station that
      // issued it; an unidentified machine must not print one.
      if (!canTrade(station)) return { ok: false, error: 'no-printer' };
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

    ipcMain.on(IPC.pinObserved, (_e, pin: unknown, owner: unknown) => {
      guardIpc('pinObserved', () => {
        observePin(validatePin(pin), 'manager', validatePinOwner(owner));
        return null;
      });
    });

    // Quit to desktop (design-arch §2.5): the ONLY way a production window
    // closes. Behind a manager PIN again (owner call, 2026-09-23, reversing the
    // earlier no-PIN request), and not the signed-in person's own: staff are
    // kept inside the app. Re-checked here against the offline cache so a
    // compromised renderer cannot end service on its own word; the renderer
    // verifies online first and tags the PIN with its owner (pinObserved).
    ipcMain.handle(IPC.quitApp, (_e, pin: unknown) =>
      guardIpc('quitApp', () => {
        if (stationLocked) {
          const verdict = mayLeave(validatePin(pin), getAuthState()?.staffId ?? null);
          if (verdict !== 'ok') return { ok: false as const, error: verdict };
        }
        setTimeout(() => {
          // A downloaded update installs on the way out and the app opens
          // again on it. app.exit() skips will-quit, so autoInstallOnAppQuit
          // alone would never fire here; installOnQuit quits itself, and exits
          // hard if that quit stalls. With nothing waiting, or an install
          // that refuses on the spot, this just exits.
          if (!updater?.installOnQuit()) app.exit(0);
        }, 50); // let the reply reach the renderer
        return { ok: true as const };
      }),
    );
    // "Exit forced full screen" — the escape hatch for a station that needs to
    // be driven like a normal machine for a moment (a support session, reading
    // a PDF beside the till, reaching the Dock or the taskbar). Kiosk mode
    // swallows the OS chrome on both platforms — macOS hides the traffic
    // lights and the menu bar, Windows hides the taskbar — and neither one is
    // recoverable from inside the page, so it has to be done here.
    //
    // It does NOT end service: the renderer keeps running, the queue keeps
    // replaying, and the window stays on screen. What it gives back is the
    // titlebar and the ability to close/minimise, which is why it also lifts
    // the `closable: false` that createWindow set — a window with an X that
    // refuses to close would be worse than one with no X at all.
    //
    // That is leaving the station, so it takes the same PIN as Quit: a
    // manager's, not the signed-in person's own. The release lasts until the
    // signed-in person changes (touch:auth-state above puts it back).
    ipcMain.handle(IPC.exitFullscreen, (e, pin: unknown) =>
      guardIpc('exitFullscreen', () => {
        const win = BrowserWindow.fromWebContents(e.sender);
        if (!win || win.isDestroyed()) return { ok: false as const, error: 'no-window' as const };
        if (stationLocked) {
          const verdict = mayLeave(validatePin(pin), getAuthState()?.staffId ?? null);
          if (verdict !== 'ok') return { ok: false as const, error: verdict };
        }
        released.add(win);
        win.setMinimizable(true);
        // Order matters: kiosk off first, because on macOS leaving kiosk is
        // itself a fullscreen transition and setFullScreen(false) before it
        // gets undone. setSimpleFullScreen covers the macOS-only variant.
        if (win.isKiosk()) win.setKiosk(false);
        if (win.isFullScreen()) win.setFullScreen(false);
        if (process.platform === 'darwin' && win.isSimpleFullScreen()) {
          win.setSimpleFullScreen(false);
        }
        win.setClosable(true);
        win.setMenuBarVisibility(true);
        win.setAutoHideMenuBar(false);
        win.setAlwaysOnTop(false);
        // Production windows are built frameless (`frame: relaxed`), and
        // Electron cannot grow a titlebar after creation — so dropping kiosk
        // alone would leave an undecorated sheet still covering the screen,
        // which reads as "nothing happened". Shrink it to a windowed size and
        // centre it: that, not the titlebar, is what tells the operator they
        // are out, and the desktop behind it becomes reachable either way.
        if (win.isMaximized()) win.unmaximize();
        const { width, height } = screen.getDisplayMatching(win.getBounds()).workAreaSize;
        win.setBounds(
          {
            width: Math.round(width * 0.9),
            height: Math.round(height * 0.9),
            x: Math.round(width * 0.05),
            y: Math.round(height * 0.05),
          },
          true,
        );
        win.setMovable(true);
        return { ok: true as const };
      }),
    );

    ipcMain.on(IPC.getStation, (e) => {
      e.returnValue = {
        stationId: station.stationId,
        mode: station.mode,
        tillHost: station.tillHost,
        configured: station.configured,
        ...(station.configError ? { configError: station.configError } : {}),
        appVersion: app.getVersion(),
        locked: stationLocked,
        // The rail would start UNDER the traffic lights otherwise: 'hiddenInset'
        // draws them inside the page, not above it.
        titleBarInset: shouldShowTrafficLights({
          platform: process.platform,
          isDev,
          configured: station.configured,
          mode: station.mode,
        })
          ? TRAFFIC_LIGHT_INSET
          : 0,
      };
    });

    // First-run setup (design-arch §2.1 station identity): the renderer's
    // answer becomes station.json and the process relaunches. Refused once a
    // file exists — a configured station is never re-pointed from the renderer.
    ipcMain.handle(IPC.saveStation, (_e, v: unknown) =>
      guardIpc('saveStation', () => completeFirstRun(validateStationSetup(v))),
    );

    // The till's pairing card: behind the offline PIN gate (the renderer
    // verifies server-side first when online). The code is the LAN secret, so
    // it only ever crosses the bridge after a manager PIN — unlike quitApp,
    // which no longer asks for one.
    ipcMain.handle(IPC.getPairingInfo, (_e, pin: unknown) =>
      guardIpc('getPairingInfo', () => {
        if (!unlockPinOffline(validatePin(pin))) return { ok: false as const, error: 'pin not recognised' as const };
        if (station.mode !== 'till') return { ok: false as const, error: 'not-a-till' as const };
        if (!station.lanPsk) return { ok: false as const, error: 'no-psk' as const };
        // A hex PSK from the CLI flags is not typeable on the kitchen screen's form.
        if (!isPairingCode(station.lanPsk)) return { ok: false as const, error: 'custom-psk' as const };
        const bind = pickLanBind(station.lanBind);
        return {
          ok: true as const,
          stationId: station.stationId,
          host: bind === '127.0.0.1' ? null : bind,
          port: LAN_KDS_PORT,
          code: station.lanPsk,
        };
      }),
    );

    // An unconfigured kitchen screen looking for its till. First-run only.
    ipcMain.handle(IPC.discoverTill, async (_e, v: unknown) => {
      let req;
      try {
        req = validateDiscoverRequest(v);
      } catch (error) {
        if (error instanceof IpcValidationError) {
          console.error('[ipc:discoverTill]', error.message);
          return { error: error.message };
        }
        throw error;
      }
      if (station.configured) return { status: 'none' as const };
      discoverAbort?.abort();
      discoverAbort = new AbortController();
      if (req.host) {
        const outcome = await confirmTill(req.host, LAN_KDS_PORT, req.code, SCAN_HANDSHAKE_TIMEOUT_MS);
        if (outcome === 'ok') return { status: 'found' as const, tills: [req.host] };
        if (outcome === 'bad-code') return { status: 'bad-code' as const, candidates: [req.host] };
        return { status: 'none' as const };
      }
      return discoverTill(req.code, { signal: discoverAbort.signal });
    });

    ipcMain.handle(IPC.updateState, () => updater?.ready() ?? null);
    ipcMain.handle(IPC.installUpdate, () => ({ ok: updater?.installNow() ?? false }));

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
      updater?.stop();
      discoverAbort?.abort();
    });
    startHeartbeat(station);
  }).catch(reportFatalStartup);
}

app.on('window-all-closed', () => {
  // Not while an update installs. On macOS Electron's autoUpdater closes the
  // windows itself and only then asks Squirrel.Mac to relaunch after
  // installing; an app.quit() here raced that request and the app could stay
  // closed. On Windows electron-updater's own app.quit() is already under way
  // and this is not called. A quit that never lands ends in the updater's
  // exit fallback.
  if (closingForUpdate) return;
  app.quit();
});
