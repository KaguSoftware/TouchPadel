import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import {
  COUNT_ROLES,
  LOG_ROLES,
  MOVE_ROLES,
  SHOW_ALL_UP_TO,
  countArgs,
  defaultCountStore,
  defaultLogStore,
  firstOf,
  fixes,
  homeStore,
  lineBaseQty,
  logArgs,
  logKindsFor,
  logStoresFor,
  moveArgs,
  newLine,
  onHandMap,
  parseCount,
  pickMatches,
  shortDetail,
  storeIntent,
  storeRefusal,
  toBaseQty,
  typedEntries,
  unitChoices,
  validateCount,
  validateLog,
  validateMove,
  waitingCount,
  type LineDraft,
  type PickItem,
  type PickList,
  type StockToday,
} from '../logic';

/**
 * The phone's store rules (wave5-addendum-2026-09-25 §2.8.5, §5.3). Each role
 * list mirrors one RPC guard (0201-0204): transfer_stock (MOVE), log_stock
 * (LOG), submit_stock_count (COUNT). The server stays the wall; these pin that
 * the phone offers exactly what it accepts.
 */

const item = (over: Partial<PickItem> = {}): PickItem => ({
  ingredient_id: 'flour',
  name_en: 'Flour',
  name_ar: 'طحين',
  unit: 'g',
  kind: 'purchased',
  pack_size: 1000,
  ...over,
});
const line = (over: Partial<LineDraft> = {}, it: Partial<PickItem> = {}): LineDraft => ({
  ...newLine(item(it)),
  ...over,
});

/** A PostgREST refusal as supabase-js hands it over. */
const pgError = (message: string, hint: string | null = null, details: string | null = null) =>
  Object.assign(new Error(message), { code: 'P0001', hint, details });

describe('who may add, move and count, as the guards say', () => {
  it('mirrors the three guards', () => {
    expect([...MOVE_ROLES].sort()).toEqual(['manager', 'owner', 'waiter']);
    expect([...LOG_ROLES].sort()).toEqual([
      'cashier',
      'court_desk',
      'head_barista',
      'head_chef',
      'manager',
      'owner',
    ]);
    expect([...COUNT_ROLES].sort()).toEqual(['chef', 'head_chef', 'manager', 'owner']);
  });

  it('gives neither new role anything but the waiter’s moves (§2.0)', () => {
    expect(LOG_ROLES).not.toContain('waiter');
    expect(COUNT_ROLES).not.toContain('waiter');
    for (const list of [MOVE_ROLES, LOG_ROLES, COUNT_ROLES])
      expect(list).not.toContain('assistant_barista');
  });

  it('logs each role’s kinds into each role’s stores, home first; shop stock into the cafe only (V14)', () => {
    expect(logKindsFor('head_barista')).toEqual(['purchased']);
    expect(logKindsFor('court_desk')).toEqual(['retail']);
    expect(logKindsFor('cashier')).toEqual(['purchased', 'retail']);
    expect(logStoresFor('head_barista')).toEqual(['cafe', 'bakery']);
    expect(logStoresFor('head_chef')).toEqual(['bakery', 'cafe']);
    expect(logStoresFor('court_desk')).toEqual(['cafe']);
    expect(logStoresFor('cashier', 'retail')).toEqual(['cafe']);
    expect(logStoresFor('manager', 'purchased')).toEqual(['cafe', 'bakery']);
    for (const role of STAFF_ROLES) {
      expect(logStoresFor(role).length > 0, role).toBe(LOG_ROLES.includes(role));
      expect(defaultLogStore(role), role).toBe(logStoresFor(role)[0] ?? null);
    }
  });

  it('opens the count on the bakery, and gives the kitchen nothing else', () => {
    expect(defaultCountStore('chef')).toBe('bakery');
    expect(defaultCountStore('head_chef')).toBe('bakery');
    expect(defaultCountStore('manager')).toBe('bakery');
    expect(defaultCountStore('waiter')).toBeNull();
    expect(homeStore('head_chef')).toBe('bakery');
    expect(homeStore('waiter')).toBe('cafe');
  });
});

describe('picking an item', () => {
  const many = Array.from({ length: SHOW_ALL_UP_TO + 1 }, (_, i) =>
    item({ ingredient_id: `i${i}`, name_en: `Item ${i}`, name_ar: `صنف ${i}` }),
  );

  it('shows a short list whole and a long one only once something is typed', () => {
    expect(pickMatches(many.slice(0, 3), '')).toHaveLength(3);
    expect(pickMatches(many, '')).toEqual([]);
    expect(pickMatches(many, 'item 1').map((i) => i.ingredient_id)).toEqual([
      'i1',
      'i10',
      'i11',
      'i12',
    ]);
  });

  it('matches either language and leaves out what is already on the form', () => {
    const list = [item(), item({ ingredient_id: 'sugar', name_en: 'Sugar', name_ar: 'سكر' })];
    expect(pickMatches(list, 'سكر').map((i) => i.ingredient_id)).toEqual(['sugar']);
    expect(pickMatches(list, '', new Set(['flour'])).map((i) => i.ingredient_id)).toEqual([
      'sugar',
    ]);
  });
});

describe('a line’s amount', () => {
  it('offers packs only for an item that has a pack size', () => {
    expect(unitChoices({ pack_size: 1000 })).toEqual(['base', 'pack']);
    expect(unitChoices({ pack_size: null })).toEqual(['base']);
    expect(unitChoices({ pack_size: 0 })).toEqual(['base']);
  });

  it('comes to the base unit as the server books it, in either digit set', () => {
    expect(lineBaseQty(line({ qty: '2', unit: 'pack' }))).toBe(2000);
    expect(lineBaseQty(line({ qty: '٢٫٥' }))).toBe(2.5);
    expect(lineBaseQty(line({ qty: '0' }))).toBeNull();
    expect(lineBaseQty(line({ qty: 'abc' }))).toBeNull();
    expect(toBaseQty(3, 'pack', { unit: 'g', pack_size: null })).toBeNull();
  });
});

describe('Add to stock before it is sent', () => {
  const today = '2026-09-26';

  it('asks for a line, an amount, and a use-by day that is a real day and not past', () => {
    expect(validateLog([], 'cafe', 'head_barista', today)).toEqual([
      { field: 'lines', code: 'required' },
    ]);
    expect(validateLog([line()], 'cafe', 'head_barista', today)).toEqual([
      { line: 'flour', field: 'qty', code: 'required' },
    ]);
    expect(
      validateLog([line({ qty: '5', expiry: '2026-02-30' })], 'cafe', 'head_barista', today),
    ).toEqual([{ line: 'flour', field: 'expiry', code: 'invalid' }]);
    expect(
      validateLog([line({ qty: '5', expiry: '2026-09-25' })], 'cafe', 'head_barista', today),
    ).toEqual([{ line: 'flour', field: 'expiry', code: 'past' }]);
    expect(
      validateLog([line({ qty: '5', expiry: '2026-09-26' })], 'cafe', 'head_barista', today),
    ).toEqual([]);
  });

  it('refuses shop stock at the bakery, and more than 50 lines', () => {
    const grip = line({ qty: '4' }, { ingredient_id: 'grip', kind: 'retail', pack_size: null });
    expect(validateLog([grip], 'cafe', 'cashier', today)).toEqual([]);
    expect(validateLog([grip], 'bakery', 'cashier', today)).toEqual([
      { line: 'grip', field: 'kind', code: 'cafeOnly' },
    ]);
    const lots = Array.from({ length: 51 }, (_, i) =>
      line({ qty: '1' }, { ingredient_id: `i${i}` }),
    );
    expect(validateLog(lots, 'cafe', 'manager', today)[0]).toEqual({
      field: 'lines',
      code: 'tooMany',
    });
  });

  it('sends the typed amount and its unit, the use-by day, and never a cost', () => {
    const args = logArgs(
      [
        line({ qty: '2', unit: 'pack', expiry: '2026-10-01' }),
        line({ qty: '24' }, { ingredient_id: 'buns', unit: 'pc' }),
      ],
      'bakery',
      'v1',
    );
    expect(args).toEqual({
      p_location: 'bakery',
      p_venue_id: 'v1',
      p_lines: [
        { ingredient_id: 'flour', qty: 2, unit: 'pack', expiry_date: '2026-10-01' },
        { ingredient_id: 'buns', qty: 24 },
      ],
    });
    const keys = JSON.stringify(args);
    expect(keys).not.toMatch(/_iqd|cost|price|supplier/);
  });
});

describe('Move stock before it is sent', () => {
  const source: PickList = {
    purpose: 'move',
    location: 'cafe',
    items: [
      item({ on_hand: 9000 }),
      item({ ingredient_id: 'buns', unit: 'pc', pack_size: null, on_hand: 40 }),
    ],
  };

  it('refuses a line larger than the source shows, packs included, and one it does not list', () => {
    const onHand = onHandMap(source);
    expect(validateMove([line({ qty: '9', unit: 'pack' })], onHand)).toEqual([]);
    expect(validateMove([line({ qty: '10', unit: 'pack' })], onHand)).toEqual([
      { line: 'flour', field: 'qty', code: 'short', shows: 9000 },
    ]);
    expect(validateMove([line({ qty: '1' }, { ingredient_id: 'milk' })], onHand)).toEqual([
      { line: 'milk', field: 'qty', code: 'short', shows: 0 },
    ]);
  });

  it('leaves the size to the server while the source is loading', () => {
    expect(validateMove([line({ qty: '99999' })], null)).toEqual([]);
    expect(onHandMap(undefined)).toBeNull();
  });

  it('moves to the other store, with no use-by day', () => {
    expect(moveArgs([line({ qty: '3', expiry: '2026-10-01' })], 'cafe', 'v1')).toEqual({
      p_from: 'cafe',
      p_to: 'bakery',
      p_venue_id: 'v1',
      p_lines: [{ ingredient_id: 'flour', qty: 3 }],
    });
  });
});

describe('the blind count', () => {
  const sheet = [item(), item({ ingredient_id: 'buns', unit: 'pc', pack_size: null })];

  it('reads 0 as a count and blank as not counted', () => {
    expect(parseCount('0')).toBe(0);
    expect(parseCount('٠')).toBe(0);
    expect(parseCount('0.0')).toBe(0);
    expect(parseCount('12.5')).toBe(12.5);
    expect(parseCount('')).toBeNull();
    expect(parseCount('-1')).toBeNull();
  });

  it('sends only what was typed, in the sheet’s order', () => {
    const entries = {
      buns: { qty: '0', unit: 'base' as const },
      flour: { qty: '2', unit: 'pack' as const },
    };
    expect(typedEntries(sheet, entries).map((e) => e.item.ingredient_id)).toEqual([
      'flour',
      'buns',
    ]);
    expect(countArgs(sheet, entries, 'bakery', 'v1')).toEqual({
      p_location: 'bakery',
      p_venue_id: 'v1',
      p_lines: [
        { ingredient_id: 'flour', counted_qty: 2, unit: 'pack' },
        { ingredient_id: 'buns', counted_qty: 0 },
      ],
    });
  });

  it('asks for one amount at least, and a number in a unit the item has', () => {
    expect(validateCount(sheet, {})).toEqual([{ field: 'lines', code: 'required' }]);
    expect(validateCount(sheet, { flour: { qty: 'x', unit: 'base' } })).toEqual([
      { line: 'flour', field: 'qty', code: 'invalid' },
    ]);
    expect(validateCount(sheet, { buns: { qty: '3', unit: 'pack' } })).toEqual([
      { line: 'buns', field: 'qty', code: 'invalid' },
    ]);
  });

  it('holds the next count while one of the same store waits (COUNT_IN_PROGRESS)', () => {
    const today: StockToday = {
      business_date: '2026-09-26',
      transfers: null,
      logs: null,
      driver_deliveries_waiting: null,
      counts: [
        {
          count_id: 'a',
          location: 'cafe',
          status: 'waiting',
          counted_by_name: 'M',
          submitted_at: 'x',
          applied_at: null,
          lines: [],
        },
        {
          count_id: 'b',
          location: 'bakery',
          status: 'applied',
          counted_by_name: 'T',
          submitted_at: 'x',
          applied_at: 'y',
          lines: [],
        },
      ],
    };
    expect(waitingCount(today, 'cafe')?.count_id).toBe('a');
    expect(waitingCount(today, 'bakery')).toBeNull();
    expect(waitingCount(undefined, 'bakery')).toBeNull();
  });
});

describe('keys, lists and refusals', () => {
  it('keeps a write’s key under its page, store and lines (§5.3)', () => {
    const a = { p_from: 'cafe', p_lines: [{ ingredient_id: 'i1', qty: 2000 }] };
    const b = { p_from: 'cafe', p_lines: [{ ingredient_id: 'i2', qty: 500 }] };
    expect(storeIntent('log', 'cafe', a)).toBe(`log:cafe:${JSON.stringify(a)}`);
    expect(storeIntent('move', 'bakery', a).startsWith('move:bakery:')).toBe(true);
    expect(storeIntent('count', 'bakery', a).startsWith('count:bakery:')).toBe(true);
    // A retry of the same lines reuses the key; different lines never do, so a
    // lost response cannot make the next move replay the first one's answer.
    expect(storeIntent('move', 'cafe', a)).toBe(storeIntent('move', 'cafe', { ...a }));
    expect(storeIntent('move', 'cafe', a)).not.toBe(storeIntent('move', 'cafe', b));
  });

  it('lists the first ten of the day and counts the rest', () => {
    expect(firstOf([1, 2, 3], 2)).toEqual({ shown: [1, 2], more: 1 });
    expect(firstOf(null)).toEqual({ shown: [], more: 0 });
  });

  it('drops an issue when its own field is edited', () => {
    const qty = { line: 'flour', field: 'qty' as const, code: 'short' as const, shows: 3 };
    expect(fixes(qty, 'flour', { qty: '2' })).toBe(true);
    expect(fixes(qty, 'flour', { unit: 'pack' })).toBe(true);
    expect(fixes(qty, 'flour', { expiry: '2026-10-01' })).toBe(false);
    expect(fixes(qty, 'buns', { qty: '2' })).toBe(false);
  });

  it('reads TRANSFER_SHORT’s line and figure, and nothing from another code (§3)', () => {
    const short = pgError('TRANSFER_SHORT', 'flour', '250.5');
    expect(shortDetail(short)).toEqual({ ingredientId: 'flour', shows: 250.5 });
    expect(shortDetail(pgError('INVALID_QTY'))).toBeNull();
    expect(storeRefusal(short)).toEqual({
      key: 'op.errors.TRANSFER_SHORT',
      issue: { line: 'flour', field: 'qty', code: 'short', shows: 250.5 },
    });
  });

  it('puts a shop line at the bakery and a gone item back on their lines', () => {
    expect(storeRefusal(pgError('INVALID_ARGUMENT', 'kind', 'grip'))).toEqual({
      key: 'staff.stores.errors.cafeOnly',
      issue: { line: 'grip', field: 'kind', code: 'cafeOnly' },
    });
    expect(storeRefusal(pgError('INGREDIENT_NOT_FOUND', null, 'milk'))).toEqual({
      key: 'staff.stores.errors.gone',
      issue: { line: 'milk', field: 'qty', code: 'gone' },
    });
  });

  it('says a count is waiting in the phone’s own words, and a store being counted in the shared ones', () => {
    expect(storeRefusal(pgError('COUNT_IN_PROGRESS')).key).toBe('staff.stores.countWaiting');
    expect(storeRefusal(pgError('STORE_BEING_COUNTED', 'bakery')).key).toBe(
      'op.errors.STORE_BEING_COUNTED',
    );
    expect(storeRefusal(pgError('FORBIDDEN', 'location')).key).toBe('errors.forbidden');
  });
});
