import { describe, expect, it } from 'vitest';
import {
  baseQty,
  confirmLines,
  draftFromLine,
  draftsTotal,
  lineCost,
  matchTone,
  readReceiptDetail,
  readReceipts,
  readUnit,
  totalOff,
  type ReceiptLine,
  type StockIngredient,
} from './receiptLogic';

// The pure half of Goods in ▸ "Scanned receipts" (ReceiptsPanel.tsx, ReceiptReview.tsx).

const milk: StockIngredient = { id: 'milk', unit: 'ml', pack_size: 1000, pack_cost_iqd: 1500 };
const sugar: StockIngredient = { id: 'sugar', unit: 'g', pack_size: 1000, pack_cost_iqd: 2000 };
const eggs: StockIngredient = { id: 'eggs', unit: 'pc', pack_size: 30, pack_cost_iqd: 6000 };
const syrup: StockIngredient = { id: 'syrup', unit: 'ml', pack_size: 750, pack_cost_iqd: null };

const line = (over: Partial<ReceiptLine>): ReceiptLine => ({
  id: 'l1',
  line_no: 1,
  text_read: 'Milk 1L',
  qty_read: 12,
  unit_read: 'L',
  unit_price_iqd_read: 1500,
  line_total_iqd_read: 18000,
  expiry_read: null,
  flags: [],
  ingredient_id: 'milk',
  match_source: 'trigram',
  confidence: 0.8,
  ...over,
});

describe('reading the payloads', () => {
  it('reads the list defensively', () => {
    expect(readReceipts(null)).toEqual([]);
    expect(readReceipts({ receipts: [{ id: 'r1', status: 'bogus', line_count: '3' }, { nope: 1 }] })).toEqual([
      {
        id: 'r1', status: 'uploaded', error_code: null, source: 'phone', storage_path: '', uploaded_by_name: null,
        created_at: '', supplier_name_read: null, total_iqd_read: null, line_count: 3, matched_count: 0,
      },
    ]);
  });

  it('reads one receipt, lines in order, unknown flags dropped', () => {
    const d = readReceiptDetail({
      id: 'r1', status: 'read', source: 'operator', total_iqd_read: '58000',
      lines: [
        { id: 'b', line_no: 2, text_read: 'Sugar', flags: ['NO_PRICE', 'WHAT'], match_source: 'alias', confidence: 1 },
        { id: 'a', line_no: 1, text_read: 'Milk', match_source: 'weird' },
      ],
    });
    expect(d?.status).toBe('read');
    expect(d?.source).toBe('operator');
    expect(d?.total_iqd_read).toBe(58000);
    expect(d?.lines.map((l) => [l.id, l.flags, l.match_source])).toEqual([['a', [], 'none'], ['b', ['NO_PRICE'], 'alias']]);
    expect(readReceiptDetail({ lines: [] })).toBeNull();
  });
});

describe('a read line into a draft', () => {
  it('knows receipt units in English and Arabic', () => {
    expect(readUnit(' Kg. ')).toBe('kg');
    expect(readUnit('كيلو')).toBe('kg');
    expect(readUnit('لتر')).toBe('l');
    expect(readUnit('كرتون')).toBe('pack');
    expect(readUnit('حبة')).toBe('count');
    expect(readUnit('bunch')).toBeNull();
    expect(readUnit(null)).toBeNull();
  });

  it('converts to the base unit, or gives up', () => {
    expect(baseQty(12, 'L', milk)).toBe(12000);
    expect(baseQty(500, 'ml', milk)).toBe(500);
    expect(baseQty(5, 'كيلو', sugar)).toBe(5000);
    expect(baseQty(2, 'box', eggs)).toBe(60);
    expect(baseQty(24, null, eggs)).toBe(24);
    expect(baseQty(6, 'btl', syrup)).toBe(4500); // a bottle of a ml ingredient is one pack
    expect(baseQty(3, 'bunch', sugar)).toBeNull();
    expect(baseQty(3, null, sugar)).toBeNull();
    expect(baseQty(0, 'kg', sugar)).toBeNull();
    expect(baseQty(1, 'pack', { ...sugar, pack_size: null })).toBeNull();
  });

  it('costs per base unit from the printed total, else the pack price, else blank', () => {
    expect(lineCost(line({ line_total_iqd_read: null }))).toBe(18000);
    expect(lineCost(line({ line_total_iqd_read: null, unit_price_iqd_read: null }))).toBeNull();
    expect(draftFromLine(line({}), milk)).toEqual({ ingredientId: 'milk', qtyReceived: '12000', unitCostIqd: '1.5', expiryDate: '' });
    // Units that do not reconcile: the quantity is the manager's, the cost the pack's.
    expect(draftFromLine(line({ unit_read: 'bunch', expiry_read: '2027-01-01' }), milk))
      .toEqual({ ingredientId: 'milk', qtyReceived: '', unitCostIqd: '1.5', expiryDate: '2027-01-01' });
    expect(draftFromLine(line({ unit_read: 'bunch' }), syrup).unitCostIqd).toBe('');
    expect(draftFromLine(line({}), null)).toEqual({ ingredientId: '', qtyReceived: '', unitCostIqd: '', expiryDate: '' });
  });

  it('says how sure a match is', () => {
    expect(matchTone(line({ match_source: 'alias', confidence: 1 }))).toBe('sure');
    expect(matchTone(line({ match_source: 'manual', confidence: null }))).toBe('sure');
    expect(matchTone(line({ confidence: 0.72 }))).toBe('sure');
    expect(matchTone(line({ confidence: 0.5 }))).toBe('check');
    expect(matchTone(line({ ingredient_id: null, match_source: 'none' }))).toBe('none');
  });
});

describe('totals and the confirm payload', () => {
  const drafts = [
    { key: 'a', lineId: 'l1', ingredientId: 'milk', qtyExpected: '', qtyReceived: '12000', unitCostIqd: '1.5', expiryDate: '' },
    { key: 'b', lineId: null, ingredientId: 'sugar', qtyExpected: '', qtyReceived: '5000', unitCostIqd: '2', expiryDate: '2027-01-01' },
    { key: 'c', lineId: null, ingredientId: '', qtyExpected: '', qtyReceived: 'x', unitCostIqd: '', expiryDate: '' },
  ];
  it('adds up the drafts and compares them with the receipt', () => {
    expect(draftsTotal(drafts)).toBe(28000);
    expect(totalOff(28000, 28001, 2)).toBe(false);
    expect(totalOff(28000, 30000, 2)).toBe(true);
    expect(totalOff(28000, null, 2)).toBe(false);
  });
  it('builds p_lines', () => {
    expect(confirmLines(drafts.slice(0, 2))).toEqual([
      { line_id: 'l1', ingredient_id: 'milk', qty_received: 12000, unit_cost_iqd: 1.5, expiry_date: null },
      { line_id: null, ingredient_id: 'sugar', qty_received: 5000, unit_cost_iqd: 2, expiry_date: '2027-01-01' },
    ]);
  });
});
