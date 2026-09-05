import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type AuthState,
  type DiscoverRequest,
  type DiscoverResult,
  type LanFrameForRenderer,
  type MutationEnvelope,
  type MutationResult,
  type PairingInfoResult,
  type PinUnlockResult,
  type PrintJob,
  type PrintResult,
  type QueueRowInfo,
  type QueueStatus,
  type StationInfo,
  type StationSetupRequest,
  type StationSetupResult,
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

  onLanTicket: (cb: (frame: LanFrameForRenderer) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, frame: LanFrameForRenderer) => cb(frame);
    ipcRenderer.on(IPC.lanTicket, listener);
    return () => ipcRenderer.removeListener(IPC.lanTicket, listener);
  },

  sendLanStatus: (update: { ref: string; status: 'preparing' | 'ready' | 'completed' }): void =>
    ipcRenderer.send(IPC.lanStatus, update),

  quitApp: (pin: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.quitApp, pin),

  getCachedRef: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC.getCachedRef, key),

  // Fire-and-forget pushes: the renderer is the auth + connectivity authority.
  pushAuthState: (s: AuthState | null): void => ipcRenderer.send(IPC.authState, s),
  pushConnState: (online: boolean): void => ipcRenderer.send(IPC.connState, online),
  cachePut: (key: string, payload: unknown): void =>
    ipcRenderer.send(IPC.cachePut, { key, payload }),
  pinObserved: (pin: string): void => ipcRenderer.send(IPC.pinObserved, pin),

  onMutationResult: (cb: (r: MutationResult) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, r: MutationResult) => cb(r);
    ipcRenderer.on(IPC.mutationResult, listener);
    return () => ipcRenderer.removeListener(IPC.mutationResult, listener);
  },

  getQueueRows: (): Promise<QueueRowInfo[]> => ipcRenderer.invoke(IPC.queueRows),

  print: (job: PrintJob): Promise<PrintResult> => ipcRenderer.invoke(IPC.print, job),

  unlockPin: (pin: string): Promise<PinUnlockResult | null> =>
    ipcRenderer.invoke(IPC.unlockPin, pin),

  // Sync by design (design-arch.md §2.1) — fetched once per call via sendSync; the
  // value is static per boot.
  getStation: (): StationInfo => ipcRenderer.sendSync(IPC.getStation) as StationInfo,

  // First-run setup + kitchen-screen pairing (main/first-run.ts, main/lan-discover.ts).
  saveStation: (req: StationSetupRequest): Promise<StationSetupResult | { error: string }> =>
    ipcRenderer.invoke(IPC.saveStation, req),
  getPairingInfo: (pin: string): Promise<PairingInfoResult | { error: string }> =>
    ipcRenderer.invoke(IPC.getPairingInfo, pin),
  discoverTill: (req: DiscoverRequest): Promise<DiscoverResult | { error: string }> =>
    ipcRenderer.invoke(IPC.discoverTill, req),

  // Auto-update (main/updater.ts). The rail mounts after sign-in, long after
  // the push may have landed, so a subscriber first asks for the current state.
  onUpdateReady: (cb: (info: UpdateReadyInfo) => void): (() => void) => {
    void ipcRenderer.invoke(IPC.updateState).then((info: UpdateReadyInfo | null) => {
      if (info) cb(info);
    });
    const listener = (_e: IpcRendererEvent, info: UpdateReadyInfo) => cb(info);
    ipcRenderer.on(IPC.updateReady, listener);
    return () => ipcRenderer.removeListener(IPC.updateReady, listener);
  },
  installUpdate: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.installUpdate),
};

contextBridge.exposeInMainWorld('touch', touch);
