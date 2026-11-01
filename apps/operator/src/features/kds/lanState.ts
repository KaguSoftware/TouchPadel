/**
 * The kitchen screen's LAN state (F-11, F-57), as a pure reducer over the
 * frames the station's main process forwards (operator-shell lan-frames.ts):
 * the till's tickets, whether the link to the till is up, and the last bump
 * that did not land.
 *
 *   - `link` frames come from this station's own main process: the socket to
 *     the till opened or closed. While the board has no internet it shows the
 *     till's tickets; with the link down too, "tickets arriving over the
 *     local network" would be false, so the notice says the link is down.
 *   - `error` frames: a bump the till refused (nobody signed in at the till,
 *     its queue failed) or one this screen could not send (link down). The
 *     board says so; the card stays where it was, because the till never
 *     echoed the change.
 *   - `ticket.synced` / `ticket.dropped`: the till's order reached the server
 *     (the cloud board shows it from then on) or was refused (it leaves).
 */
import type { MessageKey } from '@touch/i18n';
import type { KitchenTicket, LanBumpRefusal, LanFrame } from '../../ipc/bridge';

export interface LanRefusal {
  reason: LanBumpRefusal;
  ref: string | null;
  atMs: number;
}

export interface LanBoardState {
  tickets: ReadonlyMap<string, KitchenTicket>;
  /** undefined: not known yet; null: this station has no LAN link; else the socket's state. */
  link: boolean | null | undefined;
  refusal: LanRefusal | null;
}

export const EMPTY_LAN: LanBoardState = { tickets: new Map(), link: undefined, refusal: null };

/** How long a refused bump's message stays up. */
export const REFUSAL_SHOWN_MS = 15_000;

export function reduceLanFrame(state: LanBoardState, frame: LanFrame, nowMs: number): LanBoardState {
  switch (frame.type) {
    case 'ticket.snapshot': {
      const tickets = new Map<string, KitchenTicket>();
      for (const t of frame.data) tickets.set(t.ref, t);
      return { ...state, tickets };
    }
    case 'ticket.new': {
      const tickets = new Map(state.tickets);
      tickets.set(frame.data.ref, frame.data);
      return { ...state, tickets };
    }
    case 'status.update': {
      const existing = state.tickets.get(frame.data.ref);
      if (!existing) return state;
      const tickets = new Map(state.tickets);
      tickets.set(frame.data.ref, { ...existing, status: frame.data.status });
      // The till took a change for this ticket: an older refusal of it is moot.
      const refusal = state.refusal?.ref === frame.data.ref ? null : state.refusal;
      return { ...state, tickets, refusal };
    }
    case 'ticket.synced': {
      const existing = state.tickets.get(frame.data.ref);
      if (!existing) return state;
      const tickets = new Map(state.tickets);
      tickets.set(frame.data.ref, { ...existing, synced: true });
      return { ...state, tickets };
    }
    case 'ticket.dropped': {
      if (!state.tickets.has(frame.data.ref)) return state;
      const tickets = new Map(state.tickets);
      tickets.delete(frame.data.ref);
      return { ...state, tickets };
    }
    case 'error':
      return { ...state, refusal: { reason: frame.data.reason, ref: frame.data.ref ?? null, atMs: nowMs } };
    case 'link':
      return { ...state, link: frame.data.up };
    default:
      return state;
  }
}

/** The tickets a board working from the LAN shows: not completed, oldest first. */
export function lanOpenTickets(state: LanBoardState): KitchenTicket[] {
  return [...state.tickets.values()]
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * F-11: tickets a board on the CLOUD also shows, because the till has not got
 * them to the server yet (its internet is down, the kitchen screen's is not).
 * Only a till that says so (`synced: false`): an older till sends no flag and
 * its tickets would double the cloud board's.
 */
export function lanOnlyTickets(state: LanBoardState): KitchenTicket[] {
  return lanOpenTickets(state).filter((t) => t.synced === false);
}

/** The notice above the board: working from the LAN, or not even that. */
export function lanNotice(lanFallback: boolean, link: LanBoardState['link']): 'lanMode' | 'linkDown' | null {
  if (!lanFallback) return null;
  // Unknown (the first answer has not come back yet) reads as the old notice.
  if (link === undefined || link === true) return 'lanMode';
  return 'linkDown';
}

/** The message for the last refused bump, while it is fresh. */
export function refusalMessageKey(refusal: LanRefusal | null, nowMs: number): MessageKey | null {
  if (!refusal || nowMs - refusal.atMs > REFUSAL_SHOWN_MS) return null;
  switch (refusal.reason) {
    case 'link-down':
      return 'ws.prep.lan.bumpLinkDown';
    case 'no-staff':
      return 'ws.prep.lan.bumpNoStaff';
    default:
      return 'ws.prep.lan.bumpRefused';
  }
}

/** A LAN ticket's id is the till's order key ('TILL1:order.add_items:…'); a cloud id is a uuid. */
export function isLanRef(id: string): boolean {
  return id.includes(':');
}
