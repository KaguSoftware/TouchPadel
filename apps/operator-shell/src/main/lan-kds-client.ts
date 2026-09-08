import WebSocket from 'ws';
import { LAN_KDS_PORT } from './lan-kds-server';
import type { LanStatusUpdate } from './lan-frames';
import type { StationConfig } from './station';

/**
 * LAN KDS client — runs in a KDS-mode station's main process. Connects to the
 * till's LAN server (static till_host, no mDNS), forwards every server frame to
 * the renderer over IPC.lanTicket, and carries the KDS's bumps back when the
 * cloud path is down. Reconnects forever with backoff: the drill unplugs the
 * WAN, not the LAN, but a till reboot mid-outage must also heal on its own.
 */

export interface LanKdsClient {
  sendStatus(update: LanStatusUpdate): boolean;
  close(): void;
}

export function startLanKdsClient(
  station: StationConfig,
  onFrame: (frame: unknown) => void,
): LanKdsClient | null {
  if (station.mode !== 'kds') return null;
  if (!station.tillHost || !station.lanPsk) {
    console.warn('[lan-kds-client] kds mode without till_host/lan_psk — LAN fallback disabled');
    return null;
  }

  let socket: WebSocket | null = null;
  let closed = false;
  let backoffMs = 2_000;

  function connect(): void {
    if (closed) return;
    const ws = new WebSocket(`ws://${station.tillHost}:${LAN_KDS_PORT}`, {
      headers: { authorization: `Bearer ${station.lanPsk}` },
    });
    socket = ws;
    ws.on('open', () => {
      backoffMs = 2_000;
      console.log('[lan-kds-client] connected to till', station.tillHost);
    });
    ws.on('message', (raw) => {
      try {
        onFrame(JSON.parse(raw.toString()));
      } catch {
        /* malformed frame from the till would be our own bug — drop it */
      }
    });
    ws.on('close', () => {
      if (closed) return;
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
    ws.on('error', (err) => {
      console.error('[lan-kds-client]', err.message);
      ws.close();
    });
  }

  connect();

  return {
    sendStatus(update) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: 'status.update', data: update }));
      return true;
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}
