/**
 * LAN KDS wire protocol (design-arch.md §2.4) — the degraded-mode fallback that
 * keeps food reaching the pass when Supabase Realtime cannot.
 *
 *   till → KDS : ticket.new       one kitchen-bound order, as enqueued
 *                ticket.snapshot  the ring buffer, sent on every successful auth
 *                status.update    echo of an ACCEPTED update, so every KDS converges
 *   KDS  → till: status.update    a bump; the till wraps it as a ticket.status
 *                                 envelope on ITS OWN queue (single writer)
 *
 * Tickets are identified by `ref` — the order envelope's idempotency key. An
 * offline order has no server ticket id yet; the ref is unique, known to both
 * ends, and resolvable server-side at replay (orders.idempotency_key →
 * tickets.order_id). Items carry variant/modifier IDS only; the KDS renders
 * names from its own cached menu.
 */

export interface LanTicketItem {
  variantId: string;
  qty: number;
  notes?: string;
  modifiers: { modifierId: string; qty: number }[];
}

export interface LanTicket {
  /** The order envelope's idempotency key — the ticket's identity on the LAN. */
  ref: string;
  /** Human anchor the till composes (table number / label) — display only. */
  tabLabel: string | null;
  items: LanTicketItem[];
  createdAt: string;
  status: 'queued' | 'preparing' | 'ready' | 'completed';
}

export type LanServerFrame =
  | { type: 'ticket.new'; data: LanTicket }
  | { type: 'ticket.snapshot'; data: LanTicket[] }
  | { type: 'status.update'; data: { ref: string; status: LanTicket['status'] } };

export interface LanStatusUpdate {
  ref: string;
  status: 'preparing' | 'ready' | 'completed';
  kdsStation: string;
}

export const LAN_STATUSES = ['queued', 'preparing', 'ready', 'completed'] as const;

/** Parse + validate a KDS → till frame. Returns null on anything malformed —
 *  a LAN peer is semi-trusted (PSK) but this is still a network boundary. */
export function parseStatusUpdate(raw: unknown): LanStatusUpdate | null {
  let value: unknown = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      value = JSON.parse(raw.toString());
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const frame = value as { type?: unknown; data?: unknown };
  if (frame.type !== 'status.update') return null;
  const d = frame.data as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return null;
  const { ref, status, kdsStation } = d as {
    ref?: unknown;
    status?: unknown;
    kdsStation?: unknown;
  };
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 128) return null;
  if (status !== 'preparing' && status !== 'ready' && status !== 'completed') return null;
  if (typeof kdsStation !== 'string' || !/^[A-Z][A-Z0-9-]{0,31}$/.test(kdsStation)) return null;
  return { ref, status, kdsStation };
}
