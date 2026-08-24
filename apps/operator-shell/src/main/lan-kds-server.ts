import { WebSocketServer, type WebSocket } from 'ws';
import type { StationConfig } from './station';

// LAN KDS fallback server — runs in the TILL's main process only (design-arch.md §2.4).
// Frames: { type: 'ticket.new' | 'ticket.snapshot' | 'status.update', seq, data }.
// KDS discovery: static till_host IP in the KDS's station.json (no mDNS in phase 1).

export const LAN_KDS_PORT = 47810;

export interface LanFrame {
  type: 'ticket.new' | 'ticket.snapshot' | 'status.update';
  seq: number;
  data: unknown;
}

export function startLanKdsServer(station: StationConfig): WebSocketServer | null {
  if (station.mode !== 'till') {
    // Only the till owns the durable queue — and therefore the LAN server.
    return null;
  }
  if (!station.lanPsk) {
    console.warn('[lan-kds] no lan_psk in station.json — LAN fallback disabled');
    return null;
  }

  // TODO(W4): bind to the LAN interface only (host option), never 0.0.0.0 — PSK +
  // non-routable bind is the venue-LAN threat model; SEC signs off (design-arch.md §2.4).
  const wss = new WebSocketServer({ port: LAN_KDS_PORT });

  wss.on('connection', (socket: WebSocket, req) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${station.lanPsk}`) {
      socket.close(4401, 'bad psk');
      return;
    }
    socket.on('message', (raw) => {
      // TODO(W4): parse LanFrame; on 'status.update' from the KDS, enqueue into the
      // till's SQLite queue on the KDS's behalf (single-writer preserved); answer
      // 'ticket.snapshot' requests for resync after failover (design-arch.md §2.4).
      void raw;
    });
  });

  wss.on('error', (err) => console.error('[lan-kds]', err));
  return wss;
}

// TODO(W4): broadcastTicket(frame: LanFrame) — till pushes every kitchen-bound mutation
// it enqueues to all authenticated KDS sockets.
