import { describe, expect, it } from 'vitest';
import {
  FLOOR_ROLES,
  activeGroups,
  addLine,
  draftCount,
  emptyDraft,
  initialChoices,
  initialTarget,
  itemCount,
  missingGroups,
  needsChoices,
  pruneChoices,
  readFloor,
  readMenu,
  rowPrice,
  searchMenu,
  sendArgs,
  sendIntent,
  sendIssue,
  setQty,
  tabName,
  toggleChoice,
  validTarget,
  type MenuGroup,
  type MenuItem,
} from '../logic';

/**
 * Place an order (0251): the rules the phone applies before place_floor_order
 * applies them again. The option rules are the server's (add_order_items,
 * 0028 reveals); the draft never carries a price.
 */

const g = (id: string, min: number, max: number, mods: MenuGroup['modifiers']): MenuGroup => ({
  id,
  name_en: id,
  name_ar: id,
  min_select: min,
  max_select: max,
  modifiers: mods,
});
const m = (id: string, reveals: MenuGroup[] = []) => ({ id, name_en: id, name_ar: id, price_delta_iqd: 0, reveals });

const ICE = g('ice', 1, 1, [m('light'), m('extra')]);
const TEMP = g('temp', 0, 1, [m('hot'), m('iced', [ICE])]);
const SUGAR = g('sugar', 1, 1, [m('none'), m('some')]);
const SYRUPS = g('syrups', 0, 2, [m('vanilla'), m('caramel'), m('hazelnut')]);
const LATTE: MenuItem = {
  id: 'latte',
  name_en: 'Latte',
  name_ar: 'لاتيه',
  orderable: true,
  variants: [
    { id: 'r', name_en: 'Regular', name_ar: 'عادي', price_iqd: 4000, is_default: false },
    { id: 'l', name_en: 'Large', name_ar: 'كبير', price_iqd: 5000, is_default: true },
  ],
  groups: [TEMP, SUGAR, SYRUPS],
};
const WATER: MenuItem = {
  id: 'water',
  name_en: 'Water',
  name_ar: 'ماء',
  orderable: true,
  variants: [{ id: 'w', name_en: 'One', name_ar: 'واحد', price_iqd: 1000, is_default: true }],
  groups: [],
};

describe('reading the server', () => {
  it('reads the floor, and anything else as a closed day with no tables', () => {
    expect(readFloor(null)).toEqual({ day_open: false, tables: [] });
    const floor = readFloor({
      day_open: true,
      tables: [
        { id: 't1', table_number: 'T1', zone: null, tabs: [{ id: 'a', label: 'Ali', opened_at: 'x', mine: true,
          lines: [{ name_en: 'Latte', name_ar: 'لاتيه', size_en: 'Large', size_ar: 'كبير', qty: 2 }] }] },
        { table_number: 'no id' },
      ],
    });
    expect(floor.tables).toHaveLength(1);
    expect(floor.tables[0]!.tabs[0]).toMatchObject({ label: 'Ali', mine: true, lines: [{ qty: 2, size_en: 'Large' }] });
  });

  it('reads the menu, dropping an item with no size and an empty category, and reveals one level only', () => {
    const menu = readMenu({
      categories: [
        { id: 'c1', name_en: 'Coffee', name_ar: 'قهوة', items: [
          { id: 'i1', name_en: 'Latte', name_ar: 'لاتيه', orderable: true,
            variants: [{ id: 'v', name_en: 'R', name_ar: 'ع', price_iqd: 4000, is_default: true }],
            groups: [{ id: 'g', name_en: 'T', name_ar: 'ح', min_select: 0, max_select: 1, modifiers: [
              { id: 'iced', name_en: 'Iced', name_ar: 'مثلج', price_delta_iqd: 500, reveals: [
                { id: 'ice', name_en: 'Ice', name_ar: 'ثلج', min_select: 1, max_select: 1, modifiers: [
                  { id: 'x', name_en: 'x', name_ar: 'x', price_delta_iqd: 0, reveals: [{ id: 'deep', modifiers: [] }] }] }] }] }] },
          { id: 'i2', name_en: 'Ghost', name_ar: 'شبح', variants: [] },
        ] },
        { id: 'c2', name_en: 'Empty', name_ar: 'فارغ', items: [] },
      ],
    });
    expect(menu.map((c) => c.id)).toEqual(['c1']);
    expect(menu[0]!.items.map((i) => i.id)).toEqual(['i1']);
    const iced = menu[0]!.items[0]!.groups[0]!.modifiers[0]!;
    expect(iced.reveals[0]!.id).toBe('ice');
    expect(iced.reveals[0]!.modifiers[0]!.reveals).toEqual([]);
  });
});

describe('an item', () => {
  it('goes in with one tap only with one size and no options', () => {
    expect(needsChoices(WATER)).toBe(false);
    expect(needsChoices(LATTE)).toBe(true);
  });

  it('shows its only price, or its cheapest as "from"', () => {
    expect(rowPrice(WATER)).toEqual({ price: 1000, from: false });
    expect(rowPrice(LATTE)).toEqual({ price: 4000, from: true });
  });

  it('brings a revealed group into play after its parent, and drops its choice with the parent', () => {
    expect(activeGroups(LATTE, []).map((x) => x.id)).toEqual(['temp', 'sugar', 'syrups']);
    expect(activeGroups(LATTE, ['iced']).map((x) => x.id)).toEqual(['temp', 'ice', 'sugar', 'syrups']);
    expect(pruneChoices(LATTE, ['light', 'none'])).toEqual(['none']);
    // Hot replaces Iced (one choice), and the ice level goes with it.
    expect(toggleChoice(LATTE, TEMP, ['iced', 'light', 'none'], 'hot')).toEqual(['none', 'hot']);
  });

  it('keeps a required one-choice group chosen, and caps a wider group at its max', () => {
    expect(toggleChoice(LATTE, SUGAR, ['none'], 'none')).toEqual(['none']);
    expect(toggleChoice(LATTE, SUGAR, ['none'], 'some')).toEqual(['some']);
    expect(toggleChoice(LATTE, TEMP, ['hot'], 'hot')).toEqual([]);
    expect(toggleChoice(LATTE, SYRUPS, ['vanilla', 'caramel'], 'hazelnut')).toEqual(['vanilla', 'caramel']);
    expect(toggleChoice(LATTE, SYRUPS, ['vanilla', 'caramel'], 'vanilla')).toEqual(['caramel']);
  });

  it('names the groups still needing a choice, a revealed one included', () => {
    expect(missingGroups(LATTE, []).map((x) => x.id)).toEqual(['sugar']);
    expect(missingGroups(LATTE, ['iced', 'none']).map((x) => x.id)).toEqual(['ice']);
    expect(missingGroups(LATTE, ['iced', 'light', 'none'])).toEqual([]);
  });

  it('pre-picks a required group that has a single option', () => {
    const one = g('milk', 1, 1, [m('oat')]);
    expect(initialChoices({ groups: [one, SUGAR] })).toEqual(['oat']);
  });
});

describe('the draft', () => {
  const line = (variantId: string, qty = 1, modifierIds: string[] = [], note = '') => ({
    itemId: variantId === 'w' ? 'water' : 'latte',
    variantId,
    qty,
    modifierIds,
    note,
  });

  it('merges the same item, size, options and note into one line, and caps it at 99', () => {
    let d = emptyDraft('t1', { kind: 'new' });
    d = addLine(d, line('l', 1, ['none', 'iced']), 'k1');
    d = addLine(d, line('l', 2, ['iced', 'none']), 'k2');
    d = addLine(d, line('l', 1, ['iced', 'none'], 'extra hot'), 'k3');
    d = addLine(d, line('w', 98), 'k4');
    d = addLine(d, line('w', 5), 'k5');
    expect(d.lines.map((l) => [l.key, l.qty])).toEqual([['k1', 3], ['k3', 1], ['k4', 99]]);
    expect(itemCount(d, 'latte')).toBe(4);
    expect(draftCount(d)).toBe(103);
  });

  it('removes a line when its count goes to 0', () => {
    let d = addLine(emptyDraft('t1'), line('w'), 'k');
    d = setQty(d, 'k', 3);
    expect(d.lines[0]!.qty).toBe(3);
    expect(setQty(d, 'k', 0).lines).toEqual([]);
  });

  it('starts on the only tab, a new tab when there is none, and nothing with several', () => {
    const tab = (id: string) => ({ id, label: null, opened_at: '', mine: false, lines: [] });
    expect(initialTarget({ tabs: [] })).toEqual({ kind: 'new' });
    expect(initialTarget({ tabs: [tab('a')] })).toEqual({ kind: 'tab', tabId: 'a' });
    expect(initialTarget({ tabs: [tab('a'), tab('b')] })).toBeNull();
    expect(validTarget({ kind: 'tab', tabId: 'gone' }, { tabs: [tab('a')] })).toBeNull();
    expect(validTarget({ kind: 'new' }, { tabs: [] })).toEqual({ kind: 'new' });
  });

  it('says why it cannot go yet: no tab, nothing for an existing tab, a long name', () => {
    const d = emptyDraft('t1');
    expect(sendIssue(d)).toBe('target');
    expect(sendIssue({ ...d, target: { kind: 'tab', tabId: 'a' } })).toBe('empty');
    expect(sendIssue({ ...d, target: { kind: 'new' } })).toBeNull();
    expect(sendIssue({ ...d, target: { kind: 'new' }, label: 'x'.repeat(41) })).toBe('label');
  });

  it('sends the till’s shape, never a price, and the name only for a new tab', () => {
    let d = { ...emptyDraft('t1', { kind: 'new' }), label: '  Ali ' };
    d = addLine(d, line('l', 2, ['iced', 'light'], ' no foam '), 'k');
    d = addLine(d, line('w'), 'k2');
    expect(sendArgs(d)).toEqual({
      p_table_id: 't1',
      p_tab_id: null,
      p_label: 'Ali',
      p_items: [
        { variant_id: 'l', qty: 2, notes: 'no foam', modifiers: [{ modifier_id: 'iced' }, { modifier_id: 'light' }] },
        { variant_id: 'w', qty: 1 },
      ],
    });
    const onTab = { ...d, target: { kind: 'tab' as const, tabId: 'a' } };
    expect(sendArgs(onTab)).toMatchObject({ p_tab_id: 'a', p_label: null });
    expect(JSON.stringify(sendArgs(d))).not.toMatch(/price|iqd/);
  });

  it('keeps one intent for the same order and a new one for any change', () => {
    const d = addLine(emptyDraft('t1', { kind: 'new' }), line('w'), 'k');
    expect(sendIntent(d)).toBe(sendIntent({ ...d }));
    expect(sendIntent(setQty(d, 'k', 2))).not.toBe(sendIntent(d));
    expect(sendIntent({ ...d, target: { kind: 'tab', tabId: 'a' } })).not.toBe(sendIntent(d));
  });
});

describe('the floor', () => {
  it('names a tab by its label, else its place on the table', () => {
    expect(tabName({ label: ' Ali ' }, 0)).toEqual({ label: 'Ali' });
    expect(tabName({ label: null }, 1)).toEqual({ n: 2 });
  });

  it('finds items by every word, in either language', () => {
    const menu = [{ id: 'c', name_en: 'Coffee', name_ar: 'قهوة', items: [LATTE, WATER] }];
    expect(searchMenu(menu, 'lat').map((i) => i.id)).toEqual(['latte']);
    expect(searchMenu(menu, 'ماء').map((i) => i.id)).toEqual(['water']);
    expect(searchMenu(menu, '  ')).toEqual([]);
  });

  it('is the waiter’s, the cashier’s and management’s', () => {
    expect([...FLOOR_ROLES].sort()).toEqual(['cashier', 'manager', 'owner', 'waiter']);
  });
});
