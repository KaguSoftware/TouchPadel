import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type AuthState,
  type KitchenTicket,
  type MutationEnvelope,
  type MutationResult,
  type PinUnlockResult,
  type PrintJob,
  type PrintResult,
  type QueueRowInfo,
  type QueueStatus,
  type StationInfo,
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

  onLanTicket: (cb: (t: KitchenTicket) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, t: KitchenTicket) => cb(t);
    ipcRenderer.on(IPC.lanTicket, listener);
    return () => ipcRenderer.removeListener(IPC.lanTicket, listener);
  },

  getCachedRef: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC.getCachedRef, key),

  // Fire-and-forget pushes: the renderer is the auth + connectivity authority.
  pushAuthState: (s: AuthState | null): void => ipcRenderer.send(IPC.authState, s),
  pushConnState: (online: boolean): void => ipcRenderer.send(IPC.connState, online),

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
};

contextBridge.exposeInMainWorld('touch', touch);
