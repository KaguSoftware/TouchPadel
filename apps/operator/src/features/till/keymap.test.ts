import { describe, expect, it } from 'vitest';
import { TILL_KEYMAP, moveInGrid, moveInList, resolveTillKey, type KeyContext } from './keymap';

const ctx = (over: Partial<KeyContext>): KeyContext => ({
  key: '',
  inField: false,
  inFilter: false,
  overlayOpen: false,
  modifier: false,
  ...over,
});

describe('resolveTillKey', () => {
  it('maps the function keys everywhere — even inside a field or a dialog', () => {
    expect(resolveTillKey(ctx({ key: 'F2' }))).toBe('send');
    expect(resolveTillKey(ctx({ key: 'F4', inField: true }))).toBe('cash');
    expect(resolveTillKey(ctx({ key: 'F5', overlayOpen: true }))).toBe('card');
    expect(resolveTillKey(ctx({ key: 'F6', inFilter: true }))).toBe('newTab');
  });

  it('ignores chords so browser/OS shortcuts survive', () => {
    expect(resolveTillKey(ctx({ key: 'F5', modifier: true }))).toBeNull();
    expect(resolveTillKey(ctx({ key: '1', modifier: true }))).toBeNull();
  });

  it('Enter in the filter is the quick-add; other keys there are typing', () => {
    expect(resolveTillKey(ctx({ key: 'Enter', inFilter: true, inField: true }))).toBe('quickAddFromFilter');
    expect(resolveTillKey(ctx({ key: 'a', inFilter: true, inField: true }))).toBeNull();
    expect(resolveTillKey(ctx({ key: '3', inFilter: true, inField: true }))).toBeNull();
  });

  it('yields to any other text field', () => {
    expect(resolveTillKey(ctx({ key: '3', inField: true }))).toBeNull();
    expect(resolveTillKey(ctx({ key: '/', inField: true }))).toBeNull();
  });

  it('yields to an open overlay for non-function keys', () => {
    expect(resolveTillKey(ctx({ key: '3', overlayOpen: true }))).toBeNull();
    expect(resolveTillKey(ctx({ key: 'a', overlayOpen: true }))).toBeNull();
  });

  it('digits 1–9 pick a category (0-based index); 0 does not', () => {
    expect(resolveTillKey(ctx({ key: '1' }))).toEqual({ kind: 'category', index: 0 });
    expect(resolveTillKey(ctx({ key: '9' }))).toEqual({ kind: 'category', index: 8 });
    expect(resolveTillKey(ctx({ key: '0' }))).toBe('typeToFilter');
  });

  it('slash focuses the filter, question mark opens help, letters start filtering', () => {
    expect(resolveTillKey(ctx({ key: '/' }))).toBe('focusFilter');
    expect(resolveTillKey(ctx({ key: '?' }))).toBe('help');
    expect(resolveTillKey(ctx({ key: 'k' }))).toBe('typeToFilter');
    expect(resolveTillKey(ctx({ key: 'ك' }))).toBe('typeToFilter');
  });

  it('leaves navigation and control keys alone at the window level', () => {
    expect(resolveTillKey(ctx({ key: 'ArrowDown' }))).toBeNull();
    expect(resolveTillKey(ctx({ key: 'Escape' }))).toBeNull();
    expect(resolveTillKey(ctx({ key: 'Tab' }))).toBeNull();
  });
});

describe('TILL_KEYMAP', () => {
  it('documents every hotkey the resolver handles', () => {
    const documented = new Set(TILL_KEYMAP.map((r) => r.labelKey));
    for (const k of ['send', 'cash', 'card', 'newTab', 'filter', 'categories', 'help', 'escape', 'rail', 'grid']) {
      expect(documented.has(k)).toBe(true);
    }
  });
});

describe('moveInList', () => {
  it('wraps both ways and jumps with Home/End', () => {
    expect(moveInList('ArrowDown', 2, 3)).toBe(0);
    expect(moveInList('ArrowUp', 0, 3)).toBe(2);
    expect(moveInList('Home', 2, 3)).toBe(0);
    expect(moveInList('End', 0, 3)).toBe(2);
  });
  it('returns null for an empty list or an unrelated key', () => {
    expect(moveInList('ArrowDown', 0, 0)).toBeNull();
    expect(moveInList('ArrowLeft', 0, 3)).toBeNull();
  });
});

describe('moveInGrid', () => {
  // 7 items, 3 columns:  0 1 2 / 3 4 5 / 6
  it('steps horizontally along the reading direction', () => {
    expect(moveInGrid('ArrowRight', 0, 7, 3, 'ltr')).toBe(1);
    expect(moveInGrid('ArrowLeft', 1, 7, 3, 'ltr')).toBe(0);
    expect(moveInGrid('ArrowLeft', 0, 7, 3, 'rtl')).toBe(1);
    expect(moveInGrid('ArrowRight', 1, 7, 3, 'rtl')).toBe(0);
  });
  it('clamps at the ends instead of wrapping', () => {
    expect(moveInGrid('ArrowRight', 6, 7, 3, 'ltr')).toBe(6);
    expect(moveInGrid('ArrowLeft', 0, 7, 3, 'ltr')).toBe(0);
  });
  it('steps a whole row vertically and stays put at the edge', () => {
    expect(moveInGrid('ArrowDown', 1, 7, 3, 'ltr')).toBe(4);
    expect(moveInGrid('ArrowDown', 4, 7, 3, 'ltr')).toBe(4); // 7 does not exist
    expect(moveInGrid('ArrowUp', 4, 7, 3, 'ltr')).toBe(1);
    expect(moveInGrid('ArrowUp', 1, 7, 3, 'ltr')).toBe(1);
  });
  it('returns null when there is nothing to move through', () => {
    expect(moveInGrid('ArrowDown', 0, 0, 3, 'ltr')).toBeNull();
    expect(moveInGrid('ArrowDown', 0, 5, 0, 'ltr')).toBeNull();
    expect(moveInGrid('Enter', 0, 5, 3, 'ltr')).toBeNull();
  });
});
