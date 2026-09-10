import { describe, expect, it } from 'vitest';
import {
  actionForCommand,
  commandForKey,
  noSelection,
  reconcileSelection,
  reduceSelection,
  type ActionableTicket,
  type KeyLike,
} from './kdsKeyboard';

const key = (key: string, code = ''): KeyLike => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});

const tickets: ActionableTicket[] = [
  { id: 'a', itemCount: 2, status: 'queued', canMarkItems: true },
  { id: 'b', itemCount: 0, status: 'preparing', canMarkItems: true },
  { id: 'c', itemCount: 3, status: 'ready', canMarkItems: false },
];

describe('commandForKey', () => {
  it('maps digits from the physical key, the typed digit, or an Arabic-Indic digit', () => {
    expect(commandForKey(key('1', 'Digit1'), 'ltr')).toEqual({ type: 'select', index: 0 });
    expect(commandForKey(key('9', 'Numpad9'), 'ltr')).toEqual({ type: 'select', index: 8 });
    expect(commandForKey(key('3'), 'ltr')).toEqual({ type: 'select', index: 2 });
    expect(commandForKey(key('٢'), 'ar' === 'ar' ? 'rtl' : 'ltr')).toEqual({ type: 'select', index: 1 });
    expect(commandForKey(key('0', 'Digit0'), 'ltr')).toBeNull();
  });

  it('mirrors the ticket arrows under RTL and keeps item arrows vertical', () => {
    expect(commandForKey(key('ArrowRight'), 'ltr')).toEqual({ type: 'move', delta: 1 });
    expect(commandForKey(key('ArrowLeft'), 'ltr')).toEqual({ type: 'move', delta: -1 });
    expect(commandForKey(key('ArrowRight'), 'rtl')).toEqual({ type: 'move', delta: -1 });
    expect(commandForKey(key('ArrowLeft'), 'rtl')).toEqual({ type: 'move', delta: 1 });
    expect(commandForKey(key('ArrowDown'), 'rtl')).toEqual({ type: 'moveItem', delta: 1 });
    expect(commandForKey(key('ArrowUp'), 'ltr')).toEqual({ type: 'moveItem', delta: -1 });
  });

  it('reads S/R/C from the physical key so an Arabic layout still works', () => {
    expect(commandForKey(key('س', 'KeyS'), 'rtl')).toEqual({ type: 'status', status: 'preparing' });
    expect(commandForKey(key('R'), 'ltr')).toEqual({ type: 'status', status: 'ready' });
    expect(commandForKey(key('c', 'KeyC'), 'ltr')).toEqual({ type: 'status', status: 'completed' });
    expect(commandForKey(key(' ', 'Space'), 'ltr')).toEqual({ type: 'toggleItem' });
    expect(commandForKey(key('Escape'), 'ltr')).toEqual({ type: 'clear' });
  });

  it('ignores chords and unrelated keys', () => {
    expect(commandForKey({ ...key('s', 'KeyS'), ctrlKey: true }, 'ltr')).toBeNull();
    expect(commandForKey(key('x', 'KeyX'), 'ltr')).toBeNull();
    expect(commandForKey(key('Tab'), 'ltr')).toBeNull();
  });
});

describe('reduceSelection', () => {
  it('selects by index and ignores a digit past the end', () => {
    expect(reduceSelection(noSelection, { type: 'select', index: 1 }, tickets)).toEqual({
      ticketId: 'b',
      itemIndex: null,
    });
    expect(reduceSelection(noSelection, { type: 'select', index: 7 }, tickets)).toBe(noSelection);
  });

  it('moves between tickets, entering at the first / last from nothing, and clamps', () => {
    const first = reduceSelection(noSelection, { type: 'move', delta: 1 }, tickets);
    expect(first.ticketId).toBe('a');
    expect(reduceSelection(noSelection, { type: 'move', delta: -1 }, tickets).ticketId).toBe('c');
    expect(reduceSelection(first, { type: 'move', delta: -1 }, tickets)).toBe(first);
    const second = reduceSelection({ ticketId: 'a', itemIndex: 1 }, { type: 'move', delta: 1 }, tickets);
    expect(second).toEqual({ ticketId: 'b', itemIndex: null }); // item cursor resets
  });

  it('moves between items inside the selected ticket and clamps at both ends', () => {
    const sel = { ticketId: 'a', itemIndex: null };
    const i0 = reduceSelection(sel, { type: 'moveItem', delta: 1 }, tickets);
    expect(i0.itemIndex).toBe(0);
    const i1 = reduceSelection(i0, { type: 'moveItem', delta: 1 }, tickets);
    expect(i1.itemIndex).toBe(1);
    expect(reduceSelection(i1, { type: 'moveItem', delta: 1 }, tickets)).toBe(i1);
    expect(reduceSelection(sel, { type: 'moveItem', delta: -1 }, tickets).itemIndex).toBe(1);
    // A ticket with no lines has no item cursor.
    expect(reduceSelection({ ticketId: 'b', itemIndex: null }, { type: 'moveItem', delta: 1 }, tickets).itemIndex).toBeNull();
    // No ticket selected: nothing to move within.
    expect(reduceSelection(noSelection, { type: 'moveItem', delta: 1 }, tickets)).toBe(noSelection);
  });

  it('Space with no item cursor lands on the first item; Esc clears', () => {
    const sel = { ticketId: 'a', itemIndex: null };
    expect(reduceSelection(sel, { type: 'toggleItem' }, tickets).itemIndex).toBe(0);
    const at1 = { ticketId: 'a', itemIndex: 1 };
    expect(reduceSelection(at1, { type: 'toggleItem' }, tickets)).toBe(at1);
    expect(reduceSelection(at1, { type: 'clear' }, tickets)).toBe(noSelection);
  });
});

describe('actionForCommand', () => {
  it('fires a status only when the transition is legal for the selected ticket', () => {
    const onA = { ticketId: 'a', itemIndex: null };
    expect(actionForCommand(onA, { type: 'status', status: 'preparing' }, tickets)).toEqual({
      kind: 'status',
      ticketId: 'a',
      status: 'preparing',
    });
    expect(actionForCommand(onA, { type: 'status', status: 'completed' }, tickets)).toBeNull();
    const onC = { ticketId: 'c', itemIndex: null };
    expect(actionForCommand(onC, { type: 'status', status: 'completed' }, tickets)).toEqual({
      kind: 'status',
      ticketId: 'c',
      status: 'completed',
    });
    expect(actionForCommand(noSelection, { type: 'status', status: 'preparing' }, tickets)).toBeNull();
  });

  it('toggles the item under the cursor only where marks are server-backed', () => {
    expect(actionForCommand({ ticketId: 'a', itemIndex: 1 }, { type: 'toggleItem' }, tickets)).toEqual({
      kind: 'item',
      ticketId: 'a',
      itemIndex: 1,
    });
    // Space with no cursor moves the cursor (reduceSelection) but marks nothing.
    expect(actionForCommand({ ticketId: 'a', itemIndex: null }, { type: 'toggleItem' }, tickets)).toBeNull();
    // LAN tickets carry no item marks.
    expect(actionForCommand({ ticketId: 'c', itemIndex: 0 }, { type: 'toggleItem' }, tickets)).toBeNull();
  });
});

describe('reconcileSelection', () => {
  it('keeps a selection that still exists, clamping the item cursor', () => {
    const sel = { ticketId: 'c', itemIndex: 2 };
    expect(reconcileSelection(sel, tickets, 2)).toBe(sel);
    const shrunk = [{ id: 'c', itemCount: 1 }];
    expect(reconcileSelection(sel, shrunk, 0)).toEqual({ ticketId: 'c', itemIndex: 0 });
    expect(reconcileSelection(sel, [{ id: 'c', itemCount: 0 }], 0).itemIndex).toBeNull();
  });

  it('hands the cursor to the ticket now in the old slot when the selected one drops off', () => {
    const sel = { ticketId: 'b', itemIndex: null };
    const without = tickets.filter((t) => t.id !== 'b');
    expect(reconcileSelection(sel, without, 1)).toEqual({ ticketId: 'c', itemIndex: null });
    expect(reconcileSelection(sel, [tickets[0]!], 1)).toEqual({ ticketId: 'a', itemIndex: null });
    expect(reconcileSelection(sel, [], 1)).toBe(noSelection);
    expect(reconcileSelection(noSelection, [], 0)).toBe(noSelection);
  });
});
