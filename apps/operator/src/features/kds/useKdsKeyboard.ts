/**
 * Wires kdsKeyboard.ts to the window: one keydown listener (so the board is
 * operable with nothing focused — a wall station has no pointer), selection
 * state keyed by ticket id (survives reorders and drop-offs), and the two
 * callbacks the screen fires for S/R/C and Space. Cards report pointer/Tab
 * focus back through `select` / `selectItem` so the two focus models agree.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  actionForCommand,
  commandForKey,
  isCheckboxTarget,
  isTypingTarget,
  noSelection,
  reconcileSelection,
  reduceSelection,
  type ActionableTicket,
  type Direction,
  type Selection,
} from './kdsKeyboard';
import type { TicketAction } from './ticketView';

export interface UseKdsKeyboardOptions {
  tickets: readonly ActionableTicket[];
  dir: Direction;
  enabled: boolean;
  onStatus: (ticketId: string, status: TicketAction) => void;
  onToggleItem: (ticketId: string, itemIndex: number) => void;
}

export interface KdsKeyboard {
  selection: Selection;
  select: (ticketId: string) => void;
  selectItem: (ticketId: string, itemIndex: number) => void;
}

export function useKdsKeyboard(opts: UseKdsKeyboardOptions): KdsKeyboard {
  const { tickets, dir, enabled } = opts;
  const [selection, setSelection] = useState<Selection>(noSelection);
  const selRef = useRef(selection);
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;
  const lastIndex = useRef(0);
  const onStatusRef = useRef(opts.onStatus);
  onStatusRef.current = opts.onStatus;
  const onToggleRef = useRef(opts.onToggleItem);
  onToggleRef.current = opts.onToggleItem;

  const commit = useCallback((next: Selection) => {
    if (next === selRef.current) return;
    selRef.current = next;
    setSelection(next);
  }, []);

  // Remember the slot so a drop-off hands the cursor to the ticket now there.
  useEffect(() => {
    const i = tickets.findIndex((t) => t.id === selection.ticketId);
    if (i >= 0) lastIndex.current = i;
    commit(reconcileSelection(selRef.current, tickets, lastIndex.current));
  }, [tickets, selection.ticketId, commit]);

  useEffect(() => {
    if (!enabled) {
      commit(noSelection);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const cmd = commandForKey(e, dir);
      if (!cmd) return;
      // A focused checkbox toggles itself on Space; do not double-fire.
      if (cmd.type === 'toggleItem' && isCheckboxTarget(e.target)) return;
      e.preventDefault();
      const cur = selRef.current;
      const list = ticketsRef.current;
      const action = actionForCommand(cur, cmd, list);
      if (action?.kind === 'status') onStatusRef.current(action.ticketId, action.status);
      else if (action?.kind === 'item') onToggleRef.current(action.ticketId, action.itemIndex);
      commit(reduceSelection(cur, cmd, list));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, dir, commit]);

  const select = useCallback(
    (ticketId: string) => {
      const cur = selRef.current;
      if (cur.ticketId === ticketId) return;
      commit({ ticketId, itemIndex: null });
    },
    [commit],
  );
  const selectItem = useCallback(
    (ticketId: string, itemIndex: number) => {
      const cur = selRef.current;
      if (cur.ticketId === ticketId && cur.itemIndex === itemIndex) return;
      commit({ ticketId, itemIndex });
    },
    [commit],
  );

  return { selection, select, selectItem };
}
