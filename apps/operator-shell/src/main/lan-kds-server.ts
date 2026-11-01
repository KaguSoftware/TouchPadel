import { createHash, timingSafeEqual } from 'node:crypto';
import * as os from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type { LanReach, MutationEnvelope, MutationResult } from '../ipc-channels';
import { getAuthState } from './auth-state';
import { enqueue } from './queue';
import { ulid } from './ulid';
import {
  applyCloudStatuses,
  parseKdsFrame,
  snapshotOf,
  type LanRefusal,
  type LanServerFrame,
  type LanTicket,
  type LanTicketItem,
} from './lan-frames';
import type { StationConfig } from './station';
import { isPrivateIpv4 } from './lan-net';

// LAN KDS fallback server — runs in the TILL's main process only (design-arch.md §2.4).
// KDS discovery: static till_host IP in the KDS's station.json (no mDNS in phase 1).

export const LAN_KDS_PORT = 47810;

/** Today's kitchen-bound frames, capped — backs the snapshot a KDS gets on connect. */
const RING_CAP = 500;
/** Refs a kitchen screen has acknowledged, newest kept (F-11). */
const ACK_CAP = 1000;

export interface LanKdsServer {
  /** Called by the enqueue path for kitchen-bound mutations (order.create/add_items). */
  onEnqueued(envelope: MutationEnvelope): void;
  /**
   * F-11: a queued order reached a terminal state. Acked: the order is on the
   * server, the KDS on the cloud board shows the cloud copy (ticket.synced).
   * Refused: the server made no ticket, so it leaves every kitchen screen.
   */
  onResult(result: MutationResult): void;
  /** F-11: the cloud's ticket statuses, from the till's renderer (ref = order key). */
  applyCloud(updates: readonly { ref: string; status: LanTicket['status'] }[]): void;
  /** F-11: what the till's renderer flags from — refs a kitchen screen drew, screens connected. */
  reach(): LanReach;
  close(): void;
}

/** Constant-time PSK check — hash both sides so length never leaks either. */
function pskMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** First private (RFC1918) IPv4 — PSK + non-routable bind is the threat model. */
export function pickLanBind(override?: string): string {
  if (override) return override;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (isPrivateIpv4(addr.address)) return addr.address;
    }
  }
  console.warn('[lan-kds] no private IPv4 interface found — binding 127.0.0.1 (KDS unreachable)');
  return '127.0.0.1';
}

function ticketFromEnvelope(m: MutationEnvelope): LanTicket | null {
  if (m.mutationType !== 'order.create' && m.mutationType !== 'order.add_items') return null;
  const p = m.payload as {
    items?: { variantId?: string; qty?: number; notes?: string; modifiers?: { modifierId?: string; qty?: number }[] }[];
    tabIdemKey?: string;
    shop?: boolean;
    service?: string;
  } | null;
  // 0146: a Touch Shop sale is never kitchen work (the server makes no ticket for it).
  if (p?.shop === true) return null;
  const items: LanTicketItem[] = (p?.items ?? []).map((it) => ({
    variantId: String(it.variantId ?? ''),
    qty: Number(it.qty ?? 1),
    ...(it.notes ? { notes: it.notes } : {}),
    modifiers: (it.modifiers ?? []).map((mod) => ({
      modifierId: String(mod.modifierId ?? ''),
      qty: Number(mod.qty ?? 1),
    })),
  }));
  if (items.length === 0) return null;
  return {
    ref: m.idempotencyKey,
    // The till knows the human label only in its renderer; the payload carries
    // the offline tab key at best. KDS shows the ref tail as the anchor.
    tabLabel: p?.tabIdemKey ? `#${p.tabIdemKey.slice(-6)}` : null,
    ...(p?.service === 'pickup' || p?.service === 'deliver' ? { service: p.service } : {}),
    items,
    createdAt: m.createdAt,
    status: 'queued',
    synced: false,
  };
}

export function startLanKdsServer(
  station: StationConfig,
  opts?: { onQueueChanged?: () => void; onReach?: (reach: LanReach) => void; port?: number },
): LanKdsServer | null {
  if (station.mode !== 'till') {
    // Only the till owns the durable queue — and therefore the LAN server.
    return null;
  }
  const psk = station.lanPsk;
  if (!psk) {
    console.warn('[lan-kds] no lan_psk in station.json — LAN fallback disabled');
    return null;
  }

  const host = pickLanBind(station.lanBind);
  const port = opts?.port ?? LAN_KDS_PORT;
  const wss = new WebSocketServer({ host, port });
  const authed = new Set<WebSocket>();
  const ring: LanTicket[] = [];
  const acked = new Set<string>();

  function reach(): LanReach {
    return { acked: [...acked], kdsConnected: authed.size };
  }
  function pushReach(): void {
    opts?.onReach?.(reach());
  }
  function refuse(socket: WebSocket, reason: LanRefusal, ref?: string): void {
    socket.send(JSON.stringify({ type: 'error', data: { reason, ...(ref ? { ref } : {}) } } satisfies LanServerFrame));
  }

  function broadcast(frame: LanServerFrame): void {
    const raw = JSON.stringify(frame);
    for (const socket of authed) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }

  wss.on('connection', (socket: WebSocket, req) => {
    const auth = req.headers.authorization ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!presented || !pskMatches(presented, psk)) {
      socket.close(4401, 'bad psk');
      return;
    }
    authed.add(socket);
    pushReach();
    socket.on('close', () => {
      authed.delete(socket);
      pushReach();
    });

    // Resync is automatic: every successful auth gets the ring as a snapshot,
    // minus what is already completed (F-11: those came back as new work).
    socket.send(JSON.stringify({ type: 'ticket.snapshot', data: snapshotOf(ring) } satisfies LanServerFrame));

    socket.on('message', (raw) => {
      const frame = parseKdsFrame(raw as Buffer);
      if (!frame) {
        refuse(socket, 'malformed');
        return;
      }
      if (frame.kind === 'ack') {
        // F-11: a kitchen screen drew these. Only refs this till sent count.
        let changed = false;
        for (const ref of frame.ack.refs) {
          if (acked.has(ref) || !ring.some((t) => t.ref === ref)) continue;
          acked.add(ref);
          changed = true;
        }
        while (acked.size > ACK_CAP) acked.delete(acked.values().next().value as string);
        if (changed) pushReach();
        return;
      }
      const update = frame.update;
      // Single writer (design-arch §2.4): the KDS's bump becomes a ticket.status
      // envelope on the TILL's queue — key minted with the till's own station id
      // (core mutations.ts:220 anticipates exactly this), attributed to the
      // till's signed-in staff, ordered strictly AFTER the order it bumps.
      const staffId = getAuthState()?.staffId;
      if (!staffId) {
        // F-57: the KDS shows this beside the ticket and puts it back.
        refuse(socket, 'no-staff', update.ref);
        return;
      }
      try {
        enqueue({
          localId: `${update.kdsStation}-${ulid()}`,
          idempotencyKey: `${station.stationId}:ticket.status:${ulid()}`,
          mutationType: 'ticket.status',
          payload: { ticketIdemKey: update.ref, status: update.status },
          createdAt: new Date().toISOString(),
          staffId,
          deviceId: station.stationId,
        });
      } catch (error) {
        // Duplicate bump (same ref+status re-sent) or storage trouble — the
        // RPC is transition-idempotent anyway; tell the KDS and move on.
        console.error('[lan-kds] enqueue failed:', error);
        refuse(socket, 'enqueue-failed', update.ref);
        return;
      }
      const entry = ring.find((t) => t.ref === update.ref);
      if (entry) entry.status = update.status;
      opts?.onQueueChanged?.();
      // Echo the accepted update so every KDS screen converges.
      broadcast({ type: 'status.update', data: { ref: update.ref, status: update.status } });
    });
  });

  wss.on('error', (err) => console.error('[lan-kds]', err));
  console.log(`[lan-kds] listening on ws://${host}:${port}`);

  return {
    onEnqueued(envelope) {
      const ticket = ticketFromEnvelope(envelope);
      if (!ticket) return;
      ring.push(ticket);
      if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
      broadcast({ type: 'ticket.new', data: ticket });
    },
    onResult(result) {
      if (result.mutationType !== 'order.create' && result.mutationType !== 'order.add_items') return;
      const i = ring.findIndex((t) => t.ref === result.idempotencyKey);
      if (i < 0) return;
      if (result.state === 'acked') {
        const echo = result.serverResult as { ticket_id?: unknown } | null | undefined;
        const ticketId = typeof echo?.ticket_id === 'string' ? echo.ticket_id : null;
        ring[i]!.synced = true;
        broadcast({ type: 'ticket.synced', data: { ref: result.idempotencyKey, ticketId } });
      } else {
        ring.splice(i, 1);
        acked.delete(result.idempotencyKey);
        broadcast({ type: 'ticket.dropped', data: { ref: result.idempotencyKey } });
      }
    },
    applyCloud(updates) {
      for (const u of applyCloudStatuses(ring, updates)) {
        broadcast({ type: 'status.update', data: u });
      }
    },
    reach,
    close() {
      for (const socket of authed) socket.close();
      wss.close();
    },
  };
}
