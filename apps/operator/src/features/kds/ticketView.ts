/**
 * The kitchen board's view model. One shape for both ticket sources — the
 * cloud rows app.kitchen_board returns (KdsBoard) and the LAN frames the till
 * pushes while degraded (LanBoard) — so TicketList renders both with the same
 * cards and the keyboard flow works identically in both modes.
 *
 * Age is the one piece of time arithmetic the board does (spec 06.20: the
 * transition is rendered from `ageSeconds` against the ticket's target); the
 * state itself comes from the tested `ageColor` thresholds.
 */
import type { Locale } from '@touch/i18n';
import { pickName } from '../../lib/i18n';
import { ageState, type AgeState } from './ageColor';

/** A completed ticket stays on the board this long, faded, then drops off (KdsBoard). */
export const COMPLETED_LINGER_MS = 2 * 60 * 1000;
/** The board's re-read under the broadcast, and its retry after a failed load (KdsBoard). */
export const BOARD_REFETCH_MS = 30_000;

export type TicketStatus = 'queued' | 'preparing' | 'ready' | 'completed';
export type TicketAction = 'preparing' | 'ready' | 'completed';
export type TicketSource = 'web' | 'till';
/** 0351: brought to the tab's table or court, or collected at the counter. */
export type TicketService = 'deliver' | 'pickup';

export type TicketTag =
  | { kind: 'table'; number: string }
  /** `court` is the court's name (0351, every board role); `guest` only for the till and MGMT. */
  | { kind: 'court'; court: string | null; guest: string | null }
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
  service: TicketService;
  tag: TicketTag;
  /** 0352: brought to the guest, but no table attached yet (a counter order). */
  noSpot: boolean;
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

/**
 * One ticket of app.kitchen_board (build-contracts-2026-09-23 §2.23): the
 * shape the board's embedded select on `tickets` used to return, key for key,
 * with no money anywhere. `reservation` is null for the bar and kitchen roles
 * and prep, as the embed was.
 */
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
    /** 0351; absent from a row read before the migration reached the server. */
    service?: TicketService;
    /** 0352: the table or court attached to THIS order, after it was placed. */
    deliver_table?: { table_number: string } | null;
    deliver_court?: { name_en: string; name_ar: string } | null;
    tab: {
      id: string;
      label: string | null;
      table: { table_number: string } | null;
      reservation: { id: string; guest_name: string | null } | null;
      /** 0351: the booking's court, for every board role. */
      court?: { name_en: string; name_ar: string } | null;
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

/**
 * Where the ticket goes: the table or court attached to the order (0352),
 * else the tab's own table, its booking's court (with the guest), or its name.
 */
export function ticketTag(row: TicketRow, locale: Locale): TicketTag {
  const order = row.order;
  if (order?.service !== 'pickup') {
    if (order?.deliver_table) return { kind: 'table', number: order.deliver_table.table_number };
    if (order?.deliver_court) return { kind: 'court', court: pickName(locale, order.deliver_court), guest: null };
  }
  const tab = order?.tab;
  if (tab?.table) return { kind: 'table', number: tab.table.table_number };
  if (tab?.court || tab?.reservation) {
    return {
      kind: 'court',
      court: tab.court ? pickName(locale, tab.court) : null,
      guest: tab.reservation?.guest_name ?? null,
    };
  }
  return { kind: 'label', label: tab?.label ?? null };
}

/** 0352: a bring-it order with nowhere to bring it yet: no spot on the order, none on its tab. */
export function ticketNoSpot(row: TicketRow): boolean {
  const order = row.order;
  if (!order || (order.service ?? 'deliver') !== 'deliver') return false;
  if (order.deliver_table || order.deliver_court) return false;
  return !order.tab?.table && !order.tab?.court && !order.tab?.reservation;
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
    service: row.order?.service ?? 'deliver',
    tag: ticketTag(row, locale),
    noSpot: ticketNoSpot(row),
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
