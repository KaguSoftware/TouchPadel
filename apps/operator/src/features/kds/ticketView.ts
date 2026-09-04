/**
 * The kitchen board's view model. One shape for both ticket sources — the
 * cloud `tickets` rows (KdsBoard) and the LAN frames the till pushes while
 * degraded (LanBoard) — so TicketList renders both with the same cards and
 * the keyboard flow works identically in both modes.
 *
 * Age is the one piece of time arithmetic the board does (spec 06.20: the
 * transition is rendered from `ageSeconds` against the ticket's target); the
 * state itself comes from the tested `ageColor` thresholds.
 */
import type { Locale } from '@touch/i18n';
import { pickName } from '../../lib/i18n';
import { ageState, type AgeState } from './ageColor';

export type TicketStatus = 'queued' | 'preparing' | 'ready' | 'completed';
export type TicketAction = 'preparing' | 'ready' | 'completed';
export type TicketSource = 'web' | 'till';

export type TicketTag =
  | { kind: 'table'; number: string }
  | { kind: 'court'; guest: string | null }
  | { kind: 'label'; label: string | null };

export interface TicketItemView {
  id: string;
  qty: number;
  name: string;
  variant: string | null;
  /** Already localised, "2× Extra shot" style. */
  modifiers: string[];
  notes: string | null;
  ready: boolean;
}

export interface TicketView {
  id: string;
  status: TicketStatus;
  source: TicketSource;
  tag: TicketTag;
  createdAt: string;
  ageSeconds: number;
  targetSeconds: number;
  ageState: AgeState;
  /** Queued past the stale threshold (alarms.ts) — keeps the pulse. */
  stale: boolean;
  /** 'Telegram: Ahmed' when a tap moved the ticket (0032). */
  actorLabel: string | null;
  items: TicketItemView[];
  /** Item-ready marks are server state (0061); the LAN path has no server. */
  canMarkItems: boolean;
}

// ---------------------------------------------------------------------------
// Cloud rows
// ---------------------------------------------------------------------------

export interface TicketRow {
  id: string;
  status: 'queued' | 'preparing' | 'ready' | 'completed' | 'voided';
  target_seconds: number;
  created_at: string;
  completed_at: string | null;
  last_actor_label: string | null;
  order: {
    id: string;
    source: 'guest_web' | 'till';
    status: string;
    tab: {
      id: string;
      label: string | null;
      table: { table_number: string } | null;
      reservation: { id: string; guest_name: string | null } | null;
    } | null;
    order_items: {
      id: string;
      qty: number;
      notes: string | null;
      voided: boolean;
      ready_at: string | null;
      menu_item: { name_en: string; name_ar: string } | null;
      variant: { name_en: string; name_ar: string } | null;
      order_item_modifiers: {
        qty: number;
        modifier: { name_en: string; name_ar: string } | null;
      }[];
    }[];
  } | null;
}

export const TICKET_SELECT = `id, status, target_seconds, created_at, completed_at, last_actor_label,
  order:orders (
    id, source, status,
    tab:tabs ( id, label, table:cafe_tables ( table_number ),
               reservation:reservations ( id, guest_name ) ),
    order_items (
      id, qty, notes, voided, ready_at,
      menu_item:menu_items ( name_en, name_ar ),
      variant:menu_item_variants ( name_en, name_ar ),
      order_item_modifiers ( qty, modifier:modifiers ( name_en, name_ar ) )
    )
  )`;

/** Where the ticket goes: a table number, a court (with the guest), or a named tab. */
export function ticketTag(row: TicketRow): TicketTag {
  const tab = row.order?.tab;
  if (tab?.table) return { kind: 'table', number: tab.table.table_number };
  if (tab?.reservation) return { kind: 'court', guest: tab.reservation.guest_name };
  return { kind: 'label', label: tab?.label ?? null };
}

export function ticketViewFromRow(
  row: TicketRow,
  nowMs: number,
  stale: boolean,
  locale: Locale,
): TicketView {
  const ageSeconds = (nowMs - new Date(row.created_at).getTime()) / 1000;
  const items: TicketItemView[] = (row.order?.order_items ?? [])
    .filter((i) => !i.voided)
    .map((i) => ({
      id: i.id,
      qty: i.qty,
      name: pickName(locale, i.menu_item),
      variant: i.variant ? pickName(locale, i.variant) : null,
      modifiers: i.order_item_modifiers.map(
        (m) => `${m.qty > 1 ? `${m.qty}× ` : ''}${pickName(locale, m.modifier)}`,
      ),
      notes: i.notes,
      ready: i.ready_at !== null,
    }));
  return {
    id: row.id,
    // 'voided' rows are filtered out before they reach the board.
    status: row.status === 'voided' ? 'completed' : row.status,
    source: row.order?.source === 'guest_web' ? 'web' : 'till',
    tag: ticketTag(row),
    createdAt: row.created_at,
    ageSeconds,
    targetSeconds: row.target_seconds,
    ageState: ageState(ageSeconds, row.target_seconds),
    stale,
    actorLabel: row.last_actor_label,
    items,
    canMarkItems: true,
  };
}

export function ticketViews(
  rows: readonly TicketRow[],
  nowMs: number,
  stale: ReadonlySet<string>,
  locale: Locale,
): TicketView[] {
  return rows.map((r) => ticketViewFromRow(r, nowMs, stale.has(r.id), locale));
}

// ---------------------------------------------------------------------------
// Lifecycle — mirrors app.set_ticket_status's transition table so a key press
// on the wrong ticket is a no-op here instead of an INVALID_TRANSITION refusal.
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<TicketStatus, readonly TicketAction[]> = {
  queued: ['preparing', 'ready'],
  preparing: ['ready'],
  ready: ['completed'],
  completed: [],
};

export function canTransition(status: TicketStatus, to: TicketAction): boolean {
  return TRANSITIONS[status].includes(to);
}

/** Tickets that still need the kitchen (the header count). */
export function openCount(tickets: readonly { status: TicketStatus }[]): number {
  return tickets.filter((t) => t.status !== 'completed').length;
}
