import { describe, expect, it } from 'vitest';
import type { ItemRow, TabListRow, TillMenu } from '../tillData';
import {
  draftFromLine,
  draftProblem,
  missingGroup,
  readSlipDetail,
  readSlips,
  sendItems,
  sendTarget,
  slipItems,
  tableTabs,
  withItem,
  withSheetLine,
  type SlipLine,
} from './slipLogic';

// The pure half of the till's "Scanned orders" (ScannedSlipsPanel.tsx, SlipReview.tsx).

const variant = (id: string, item: string, is_default: boolean, sort_order: number) => ({
  id, item_id: item, name_en: id, name_ar: id, price_iqd: 4000, is_default, sort_order,
});
const item = (id: string, category_id: string, variants: ReturnType<typeof variant>[], groups: string[] = []): ItemRow => ({
  id, category_id, name_en: id, name_ar: id, is_active: true, sold_out: false, unavailable_on: null, sort_order: 1,
  menu_item_variants: variants, menu_item_modifier_groups: groups.map((g, i) => ({ group_id: g, sort_order: i })),
});
const latte = item('latte', 'hot', [variant('latte-l', 'latte', false, 2), variant('latte-r', 'latte', true, 1)]);
const karak = item('karak', 'hot', [variant('karak-r', 'karak', true, 1)], ['sugar']);
const soap = item('soap', 'shop', [variant('soap-1', 'soap', true, 1)]);
const MENU: TillMenu = {
  categories: [
    { id: 'hot', name_en: 'Hot', name_ar: 'ساخن', sort_order: 1, is_active: true, tax_group: null, kind: 'cafe' },
    { id: 'shop', name_en: 'Shop', name_ar: 'متجر', sort_order: 2, is_active: true, tax_group: null, kind: 'shop' },
  ],
  items: [latte, karak, soap, { ...item('old', 'hot', [variant('old-r', 'old', true, 1)]), is_active: false }],
  groups: [{ id: 'sugar', name_en: 'Sugar', name_ar: 'سكر', min_select: 1, max_select: 1 }],
  modifiers: [{ id: 'no-sugar', group_id: 'sugar', name_en: 'No sugar', name_ar: 'بدون', price_delta_iqd: 0, is_active: true }],
  availability: {},
};

const line = (over: Partial<SlipLine>): SlipLine => ({
  id: 'l1', line_no: 1, text_read: 'لاتيه', qty_read: 2, notes_read: 'بدون سكر', flags: [],
  variant_id: 'latte-r', match_source: 'trigram', confidence: 0.9, ...over,
});

const tab = (id: string, table: string | null, status = 'open'): TabListRow => ({
  id, status, label: null, opened_at: '', total_iqd: null, table: table ? { table_number: table } : null,
  reservation: null, orders: [], tab_adjustments: [], payments: [],
});

describe('reading the payloads', () => {
  it('reads the till list and one slip defensively', () => {
    expect(readSlips({ slips: [{ id: 's1', status: 'nope', line_count: '4' }, 7] })).toMatchObject([
      { id: 's1', status: 'uploaded', line_count: 4, matched_count: 0, table_number: null },
    ]);
    expect(readSlips(null)).toEqual([]);
    const d = readSlipDetail({
      id: 's1', status: 'read', table_id: 't5',
      lines: [
        { id: 'b', line_no: 2, text_read: 'كرك', flags: ['NO_QTY', 'X'], match_source: 'alias' },
        { id: 'a', line_no: 1, text_read: 'لاتيه', qty_read: 2, variant_id: 'latte-r', match_source: 'odd' },
      ],
    });
    expect(d?.lines.map((l) => [l.id, l.flags, l.match_source])).toEqual([['a', [], 'none'], ['b', ['NO_QTY'], 'alias']]);
    expect(readSlipDetail({})).toBeNull();
  });
});

describe('drafts', () => {
  it('offers the active café items only', () => {
    expect(slipItems(MENU).map((i) => i.id)).toEqual(['latte', 'karak']);
    expect(slipItems(undefined)).toEqual([]);
  });

  it('turns a read line into a till line', () => {
    expect(draftFromLine(line({}), MENU)).toEqual({
      key: 'l1', lineId: 'l1', itemId: 'latte', variantId: 'latte-r', qty: 2, notes: 'بدون سكر', modifiers: [],
    });
    expect(draftFromLine(line({ qty_read: null, notes_read: null, variant_id: 'latte-l' }), MENU))
      .toMatchObject({ variantId: 'latte-l', qty: 1, notes: '' });
    expect(draftFromLine(line({ variant_id: null, match_source: 'none' }), MENU)).toMatchObject({ itemId: '', variantId: '' });
  });

  it('a picked item takes its default size; the item sheet sets size, qty, note and options', () => {
    const d = withItem({ ...draftFromLine(line({}), MENU), modifiers: [{ modifierId: 'x', name: 'x', qty: 1, priceDeltaIqd: 0 }] }, karak);
    expect(d).toMatchObject({ itemId: 'karak', variantId: 'karak-r', modifiers: [] });
    const s = withSheetLine(d, {
      key: 'k', variantId: 'karak-r', itemName: '', variantName: '', qty: 3, notes: 'hot',
      unitPriceIqd: 0, modifiers: [{ modifierId: 'no-sugar', name: 'No sugar', qty: 1, priceDeltaIqd: 0 }],
    });
    expect(s).toMatchObject({ qty: 3, notes: 'hot', modifiers: [{ modifierId: 'no-sugar' }] });
  });

  it('names the required option a line still lacks, and the line\'s problem', () => {
    const k = withItem(draftFromLine(line({}), MENU), karak);
    expect(missingGroup(k, karak, MENU.groups, MENU.modifiers)?.id).toBe('sugar');
    expect(draftProblem(k, karak, MENU)).toBe('options');
    const ok = { ...k, modifiers: [{ modifierId: 'no-sugar', name: '', qty: 1, priceDeltaIqd: 0 }] };
    expect(draftProblem(ok, karak, MENU)).toBeNull();
    expect(draftProblem({ ...ok, qty: 0 }, karak, MENU)).toBe('qty');
    expect(draftProblem({ ...ok, itemId: '' }, null, MENU)).toBe('item');
  });

  it('builds p_items', () => {
    const d = draftFromLine(line({}), MENU);
    expect(sendItems([d, { ...d, key: 'n', lineId: null, notes: '  ' }])).toEqual([
      { line_id: 'l1', variant_id: 'latte-r', qty: 2, notes: 'بدون سكر', modifiers: [] },
      { line_id: null, variant_id: 'latte-r', qty: 2, notes: null, modifiers: [] },
    ]);
  });
});

describe('where the order goes', () => {
  const tabs = [tab('a', '5'), tab('b', '5'), tab('c', '6'), tab('d', '7', 'awaiting_payment')];
  it('finds a table\'s open tabs', () => {
    expect(tableTabs(tabs, '5').map((t) => t.id)).toEqual(['a', 'b']);
    expect(tableTabs(tabs, '7')).toEqual([]);
    expect(tableTabs(tabs, null)).toEqual([]);
  });
  it('the picked tab, the only tab, a new tab, or a question', () => {
    expect(sendTarget('t5', tableTabs(tabs, '5'), 'b')).toEqual({ p_tab_id: 'b', p_table_id: 't5' });
    expect(sendTarget('t5', tableTabs(tabs, '5'), null)).toBe('choose_tab');
    expect(sendTarget('t6', tableTabs(tabs, '6'), null)).toEqual({ p_tab_id: 'c', p_table_id: 't6' });
    expect(sendTarget('t9', [], null)).toEqual({ p_tab_id: null, p_table_id: 't9' });
    expect(sendTarget(null, [], null)).toBe('choose_table');
  });
});
