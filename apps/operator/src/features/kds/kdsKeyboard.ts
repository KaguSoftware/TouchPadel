/**
 * Keyboard model for the kitchen display (spec R11: the kitchen is operated by
 * people who are not looking at the screen the whole time, so every action is
 * a key). Pure: a key event becomes a command, a command moves the selection
 * and may resolve to one action. The hook (useKdsKeyboard.ts) owns the DOM.
 *
 *   1–9         select ticket N (arrival order)
 *   ← / →       previous / next ticket (logical: mirrored under RTL)
 *   ↑ / ↓       previous / next item inside the selected ticket
 *   Space       toggle the selected item's ready mark
 *   S / R / C   start / ready / complete the selected ticket
 *   Esc         clear the selection
 *
 * Letters and digits match on `code` (physical key) first so an Arabic layout
 * — where the S key types س — still starts the ticket as the legend says.
 */
import { canTransition, type TicketAction, type TicketStatus } from './ticketView';

export type Direction = 'ltr' | 'rtl';

export type KeyCommand =
  | { type: 'select'; index: number }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'moveItem'; delta: 1 | -1 }
  | { type: 'toggleItem' }
  | { type: 'status'; status: TicketAction }
  | { type: 'clear' };

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const ARABIC_INDIC_ZERO = 0x0660;

function digitOf(e: KeyLike): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (m) return Number(m[1]);
  if (/^[1-9]$/.test(e.key)) return Number(e.key);
  const cp = e.key.length === 1 ? e.key.codePointAt(0) : undefined;
  if (cp !== undefined && cp > ARABIC_INDIC_ZERO && cp <= ARABIC_INDIC_ZERO + 9) {
    return cp - ARABIC_INDIC_ZERO;
  }
  return null;
}

export function commandForKey(e: KeyLike, dir: Direction): KeyCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const digit = digitOf(e);
  if (digit !== null) return { type: 'select', index: digit - 1 };

  const next = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const prev = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  if (e.key === next) return { type: 'move', delta: 1 };
  if (e.key === prev) return { type: 'move', delta: -1 };
  if (e.key === 'ArrowDown') return { type: 'moveItem', delta: 1 };
  if (e.key === 'ArrowUp') return { type: 'moveItem', delta: -1 };
  if (e.key === ' ' || e.code === 'Space') return { type: 'toggleItem' };
  if (e.key === 'Escape') return { type: 'clear' };

  const letter = e.code === 'KeyS' || e.code === 'KeyR' || e.code === 'KeyC' ? e.code.slice(3) : e.key;
  switch (letter.toLowerCase()) {
    case 's':
      return { type: 'status', status: 'preparing' };
    case 'r':
      return { type: 'status', status: 'ready' };
    case 'c':
      return { type: 'status', status: 'completed' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface Selection {
  ticketId: string | null;
  itemIndex: number | null;
}

export const noSelection: Selection = { ticketId: null, itemIndex: null };

export interface SelectableTicket {
  id: string;
  itemCount: number;
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(n, max));
}

export function reduceSelection(
  state: Selection,
  cmd: KeyCommand,
  tickets: readonly SelectableTicket[],
): Selection {
  const curIndex = state.ticketId === null ? -1 : tickets.findIndex((t) => t.id === state.ticketId);
  switch (cmd.type) {
    case 'select': {
      const t = tickets[cmd.index];
      if (!t) return state;
      return t.id === state.ticketId ? state : { ticketId: t.id, itemIndex: null };
    }
    case 'move': {
      if (tickets.length === 0) return state;
      const idx =
        curIndex < 0
          ? cmd.delta > 0
            ? 0
            : tickets.length - 1
          : clamp(curIndex + cmd.delta, tickets.length - 1);
      const t = tickets[idx];
      if (!t || t.id === state.ticketId) return state;
      return { ticketId: t.id, itemIndex: null };
    }
    case 'moveItem': {
      const t = curIndex < 0 ? undefined : tickets[curIndex];
      if (!t || t.itemCount === 0) return state;
      const idx =
        state.itemIndex === null
          ? cmd.delta > 0
            ? 0
            : t.itemCount - 1
          : clamp(state.itemIndex + cmd.delta, t.itemCount - 1);
      return idx === state.itemIndex ? state : { ...state, itemIndex: idx };
    }
    case 'toggleItem': {
      // With no item under the cursor, Space lands on the first item instead
      // of guessing which one to mark.
      const t = curIndex < 0 ? undefined : tickets[curIndex];
      if (!t || t.itemCount === 0 || state.itemIndex !== null) return state;
      return { ...state, itemIndex: 0 };
    }
    case 'clear':
      return state.ticketId === null ? state : noSelection;
    case 'status':
      return state;
  }
}

/**
 * Keep the selection valid after the list changes underneath it: a ticket that
 * dropped off hands the cursor to whichever ticket now sits in its old slot, and
 * an item cursor past the end of a shrunken ticket is pulled back.
 */
export function reconcileSelection(
  state: Selection,
  tickets: readonly SelectableTicket[],
  lastIndex: number,
): Selection {
  if (state.ticketId === null) return state;
  const t = tickets.find((x) => x.id === state.ticketId);
  if (t) {
    if (state.itemIndex === null) return state;
    if (t.itemCount === 0) return { ...state, itemIndex: null };
    return state.itemIndex >= t.itemCount ? { ...state, itemIndex: t.itemCount - 1 } : state;
  }
  if (tickets.length === 0) return noSelection;
  const fallback = tickets[clamp(lastIndex, tickets.length - 1)];
  return fallback ? { ticketId: fallback.id, itemIndex: null } : noSelection;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ActionableTicket extends SelectableTicket {
  status: TicketStatus;
  canMarkItems: boolean;
}

export type KeyAction =
  | { kind: 'status'; ticketId: string; status: TicketAction }
  | { kind: 'item'; ticketId: string; itemIndex: number };

/** The one action a command fires against the CURRENT selection (before it moves). */
export function actionForCommand(
  state: Selection,
  cmd: KeyCommand,
  tickets: readonly ActionableTicket[],
): KeyAction | null {
  if (state.ticketId === null) return null;
  const t = tickets.find((x) => x.id === state.ticketId);
  if (!t) return null;
  if (cmd.type === 'status') {
    return canTransition(t.status, cmd.status)
      ? { kind: 'status', ticketId: t.id, status: cmd.status }
      : null;
  }
  if (cmd.type === 'toggleItem') {
    if (state.itemIndex === null || !t.canMarkItems || t.status === 'completed') return null;
    if (state.itemIndex >= t.itemCount) return null;
    return { kind: 'item', ticketId: t.id, itemIndex: state.itemIndex };
  }
  return null;
}

/** Inputs where a key press is text, not a board command. Checkboxes and buttons are not. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return type !== 'checkbox' && type !== 'radio' && type !== 'button';
  }
  return false;
}

export function isCheckboxTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'checkbox';
}
