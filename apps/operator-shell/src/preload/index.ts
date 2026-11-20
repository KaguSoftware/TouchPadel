import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type AuthState,
  type LeaveResult,
  type MutationEnvelope,
  type MutationResult,
  type PinUnlockResult,
  type PrintJob,
  type PrintResult,
  type QueueRowInfo,
  type QueueStatus,
  type ResolveQueueRowRequest,
  type ResolveQueueRowResult,
  type StationInfo,
  type StationSetupRequest,
  type StationSetupResult,
  type SupplierPageResult,
  type UpdateReadyInfo,
} from '../ipc-channels';

// Exposes the TouchBridge shape (design-arch.md §2.1) as window.touch.
// Renderer-side types: apps/operator/src/ipc/bridge.ts — keep in lockstep until both
// are unified via @touch/core (TODO W2).

const touch = {
  enqueue: (m: MutationEnvelope): Promise<{ localId: string; state: 'queued' }> =>
    ipcRenderer.invoke(IPC.enqueue, m),

  onQueueUpdate: (cb: (s: QueueStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: QueueStatus) => cb(s);
    ipcRenderer.on(IPC.queueUpdate, listener);
    return () => ipcRenderer.removeListener(IPC.queueUpdate, listener);
  },

  quitApp: (pin: string): Promise<LeaveResult> => ipcRenderer.invoke(IPC.quitApp, pin),

  exitFullscreen: (pin: string): Promise<LeaveResult> =>
    ipcRenderer.invoke(IPC.exitFullscreen, pin),

  getCachedRef: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC.getCachedRef, key),

  // Fire-and-forget pushes: the renderer is the auth + connectivity authority.
  pushAuthState: (s: AuthState | null): void => ipcRenderer.send(IPC.authState, s),
  pushConnState: (online: boolean): void => ipcRenderer.send(IPC.connState, online),
  cachePut: (key: string, payload: unknown): void =>
    ipcRenderer.send(IPC.cachePut, { key, payload }),
  pinObserved: (pin: string, staffId?: string, tier?: 'manager' | 'self'): void =>
    ipcRenderer.send(IPC.pinObserved, pin, staffId, tier),

  /**
   * Full-screen state, pushed on every change and once on subscribe — the
   * rail mounts long after the window settled, so a subscriber has to be told
   * where things stand rather than wait for the next transition.
   */
  onFullscreenState: (cb: (fullscreen: boolean) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, fullscreen: boolean) => cb(fullscreen);
    ipcRenderer.on(IPC.fullscreenState, listener);
    void ipcRenderer.invoke(IPC.fullscreenState).then((v: boolean) => cb(v));
    return () => ipcRenderer.removeListener(IPC.fullscreenState, listener);
  },

  /** The red traffic light was pressed; main has held the close. */
  onCloseRequested: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.closeRequested, listener);
    return () => ipcRenderer.removeListener(IPC.closeRequested, listener);
  },

  onMutationResult: (cb: (r: MutationResult) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, r: MutationResult) => cb(r);
    ipcRenderer.on(IPC.mutationResult, listener);
    return () => ipcRenderer.removeListener(IPC.mutationResult, listener);
  },

  getQueueRows: (): Promise<QueueRowInfo[]> => ipcRenderer.invoke(IPC.queueRows),

  resolveQueueRow: (req: ResolveQueueRowRequest): Promise<ResolveQueueRowResult | { error: string }> =>
    ipcRenderer.invoke(IPC.resolveQueueRow, req),

  print: (job: PrintJob): Promise<PrintResult> => ipcRenderer.invoke(IPC.print, job),

  unlockPin: (pin: string): Promise<PinUnlockResult | null> =>
    ipcRenderer.invoke(IPC.unlockPin, pin),
  unlockOwnPin: (pin: string): Promise<boolean> => ipcRenderer.invoke(IPC.unlockOwnPin, pin),

  // Sync by design (design-arch.md §2.1) — fetched once per call via sendSync; the
  // value is static per boot.
  getStation: (): StationInfo => ipcRenderer.sendSync(IPC.getStation) as StationInfo,

  // First-run setup (main/first-run.ts).
  saveStation: (req: StationSetupRequest): Promise<StationSetupResult | { error: string }> =>
    ipcRenderer.invoke(IPC.saveStation, req),

  // Auto-update (main/updater.ts). The rail mounts after sign-in, long after
  // the push may have landed, so a subscriber first asks for the current state.
  // null withdraws an update (its install refused, an installer started, or a
  // newer download is replacing it).
  onUpdateReady: (cb: (info: UpdateReadyInfo | null) => void): (() => void) => {
    void ipcRenderer.invoke(IPC.updateState).then((info: UpdateReadyInfo | null) => {
      if (info) cb(info);
    });
    const listener = (_e: IpcRendererEvent, info: UpdateReadyInfo | null) => cb(info);
    ipcRenderer.on(IPC.updateReady, listener);
    return () => ipcRenderer.removeListener(IPC.updateReady, listener);
  },
  installUpdate: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.installUpdate),

  // Shop desk price watch (main/supplier-fetch.ts): one supplier page's HTML,
  // or why not. Main refuses on any station that is not a shop desk.
  fetchSupplierPage: (url: string): Promise<SupplierPageResult> =>
    ipcRenderer.invoke(IPC.fetchSupplierPage, { url }),
};

contextBridge.exposeInMainWorld('touch', touch);
