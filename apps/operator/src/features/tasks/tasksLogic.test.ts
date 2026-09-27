import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { STAFF_ROLES, canAccess, type StaffRole } from '../../lib/auth';
import { kitchenTaskCount, phoneRead, phoneRows, phoneSectionKeys, phoneSectionsFor, readMyWork, runTitle, taskStarts } from './tasksLogic';
import { validateTasksSearch } from './search';

// My tasks, pure: the caller's work lists, the starts a role gets, and the
// read-only copies of the phone's pages (build-contracts-2026-09-23 §5.4).

const tr = makeT('en');
const ctx = { tr, locale: 'en' as const, qty: (n: number, u: string) => `${n} ${u}` };

describe('readMyWork', () => {
  it('reads each list and never crashes on a missing one', () => {
    const work = readMyWork({
      todo: [{ run_step_id: 's1', run_id: 'r1', kind: 'tournament', variant: 'type2', title_en: null, title_ar: 'بطولة الجمعة', name_en: 'Courts', name_ar: 'الملاعب', step_key: 'courts', opened_at: '2026-09-25T08:00:00Z', round: 1 }],
      decided: [{ run_step_id: 's2', run_id: 'r2', kind: 'product_release', name_en: 'Propose', name_ar: 'الاقتراح', decision: 'send_back', decision_note: 'Add a size', decided_by_name: 'Omar', decided_at: '2026-09-24T10:00:00Z', submission_id: 'x' }],
    });
    expect(work.todo[0]!.variant).toBe('type2');
    expect(work.waiting).toEqual([]);
    expect(work.decided[0]!.decision).toBe('send_back');
    expect(runTitle(work.todo[0]!, 'en', tr)).toBe('بطولة الجمعة');
    expect(runTitle({ titleEn: null, titleAr: null, kind: 'hiring' }, 'en', tr)).toBe('Hiring');
    expect(readMyWork(null)).toEqual({ todo: [], waiting: [], decided: [] });
  });

  it('counts the kitchen board’s My tasks as To do plus the ideas to review', () => {
    expect(kitchenTaskCount({ counts: { todo: 2 } }, 3)).toBe(5);
    expect(kitchenTaskCount({ todo: [{}, {}] }, 0)).toBe(2);
    expect(kitchenTaskCount(undefined, 0)).toBe(0);
  });
});

describe('taskStarts', () => {
  it('follows the capability matrix, never a role compare', () => {
    expect(taskStarts('head_chef')).toEqual(['product_release']);
    expect(taskStarts('marketing')).toEqual(['price_promo']);
    expect(taskStarts('court_desk')).toEqual(['tournament']);
    for (const role of ['barista', 'chef', 'cashier', 'driver', 'prep'] as const) expect(taskStarts(role), role).toEqual([]);
  });
});

describe('phone copies', () => {
  const TASK_ROLES = STAFF_ROLES.filter((r) => canAccess(r, '/tasks'));

  it('puts checklists first for every role that opens /tasks', () => {
    for (const role of TASK_ROLES) expect(phoneSectionsFor(role)[0], role).toBe('checklists');
  });

  it('offers each copy only to the roles its read admits (§2.14–§2.24)', () => {
    const has = (role: StaffRole, s: string) => (phoneSectionsFor(role) as string[]).includes(s);
    // Stock: the heads read the cafe, the desk the shop, and since wave 5 the
    // waiter what he moves between the stores (STOCK_VIEW).
    expect(TASK_ROLES.filter((r) => has(r, 'stock')).sort()).toEqual(['court_desk', 'head_barista', 'head_chef', 'waiter']);
    // Today in the stores (M2): app.stock_today's MOVE ∪ LOG ∪ COUNT, as /tasks opens it.
    expect(TASK_ROLES.filter((r) => has(r, 'storeToday')).sort()).toEqual(['cashier', 'chef', 'court_desk', 'head_barista', 'head_chef', 'waiter']);
    // Teachings and recipes: the bar (the assistant barista since wave 5) and the kitchen.
    expect(TASK_ROLES.filter((r) => has(r, 'teachings')).sort()).toEqual(['assistant_barista', 'barista', 'chef', 'head_barista', 'head_chef']);
    expect(TASK_ROLES.filter((r) => has(r, 'recipes')).sort()).toEqual(['assistant_barista', 'barista', 'chef', 'head_barista', 'head_chef']);
    // Ideas: the barista and the chef assistant send them.
    expect(TASK_ROLES.filter((r) => has(r, 'myIdeas')).sort()).toEqual(['barista', 'chef']);
    // Production: the chef tiers.
    expect(TASK_ROLES.filter((r) => has(r, 'production')).sort()).toEqual(['chef', 'head_chef']);
    // Marketing's own pages.
    expect(TASK_ROLES.filter((r) => has(r, 'results'))).toEqual(['marketing']);
    expect(TASK_ROLES.filter((r) => has(r, 'purchases'))).toEqual(['driver']);
    // Everyone posts suggestions and asks for leave.
    for (const role of TASK_ROLES) {
      expect(has(role, 'mySuggestions'), role).toBe(true);
      expect(has(role, 'requests'), role).toBe(true);
    }
    expect(phoneSectionsFor(undefined)).toEqual([]);
  });

  it('reads marketing’s inbox, and everyone else’s own requests to marketing', () => {
    expect(phoneRead('marketingRequests', 'marketing')).toEqual({ fn: 'marketing_requests_page', args: { p_filter: 'open' } });
    expect(phoneRead('marketingRequests', 'cashier')).toEqual({ fn: 'my_marketing_requests', args: {} });
  });

  it('shows a checklist’s open lines and says which need a photo', () => {
    const rows = phoneRows(
      'checklists',
      { lists: [{ run_id: 'c1', slot: 'close', name_en: 'Closing', name_ar: 'الإغلاق', done: 2, total: 2, items: [{ text_en: 'Mop', done_at: 'x' }] }] },
      ctx,
    );
    expect(rows).toEqual([{ id: 'c1', title: 'Closing', detail: '2 of 2 done', lines: [], status: { label: 'Finished', tone: 'success' } }]);
  });

  it('shows stock as quantities only, low first as the server orders it', () => {
    const rows = phoneRows(
      'stock',
      { items: [{ ingredient_id: 'i1', name_en: 'Milk', name_ar: 'حليب', unit: 'ml', on_hand: 800, low: true, below_par: true }] },
      ctx,
    );
    expect(rows[0]).toEqual({ id: 'i1', title: 'Milk', detail: '800 ml', status: { label: 'Low', tone: 'danger' } });
  });

  it('says where the stock is once the bakery store holds some (wave 5, by_location)', () => {
    const rows = phoneRows(
      'stock',
      {
        items: [
          { ingredient_id: 'i1', name_en: 'Flour', name_ar: 'طحين', unit: 'g', on_hand: 5000, by_location: { cafe: 3000, bakery: 2000 } },
          { ingredient_id: 'i2', name_en: 'Milk', name_ar: 'حليب', unit: 'ml', on_hand: 800, by_location: { cafe: 800, bakery: 0 } },
        ],
      },
      ctx,
    );
    expect(rows[0]!.detail).toBe('5000 g · Cafe store 3000 g · Bakery store 2000 g');
    // All of it in the cafe store: the total alone, as before the stores.
    expect(rows[1]!.detail).toBe('800 ml');
  });

  it('copies the day in the stores: waiting driver deliveries first, then moves, additions and counts, never a cost', () => {
    expect(phoneRead('storeToday', 'waiter')).toEqual({ fn: 'stock_today', args: {} });
    expect(phoneSectionKeys('storeToday')).toEqual({ tab: 'ws.stores.today.tab', empty: 'ws.stores.today.empty' });
    expect(phoneSectionKeys('stock')).toEqual({ tab: 'ws.rolePages.phone.stock.tab', empty: 'ws.rolePages.phone.stock.empty' });
    const rows = phoneRows(
      'storeToday',
      {
        business_date: '2026-09-26',
        transfers: [
          { transfer_id: 't1', from: 'cafe', to: 'bakery', moved_by_name: 'Hasan', moved_at: '2026-09-26T07:00:00Z', lines: [{ ingredient_id: 'f', name_en: 'Flour', name_ar: 'طحين', unit: 'g', qty: 5000 }] },
        ],
        logs: [
          { delivery_id: 'd1', location: 'bakery', source: 'staff_log', received_by_name: 'Rusul', received_at: '2026-09-26T06:00:00Z', lines: [{ ingredient_id: 'b', name_en: 'Butter', name_ar: 'زبدة', unit: 'g', qty: 1000, expiry_date: null }] },
          { delivery_id: 'd2', location: 'cafe', source: 'goods_in', received_by_name: 'Omar', received_at: '2026-09-26T05:00:00Z', lines: [] },
        ],
        driver_deliveries_waiting: 2,
        counts: [{ count_id: 'c1', location: 'bakery', status: 'waiting', counted_by_name: 'Tiba', submitted_at: '2026-09-26T08:00:00Z', lines: [{ ingredient_id: 'f', name_en: 'Flour', name_ar: 'طحين', unit: 'g', counted_qty: 4800 }] }],
      },
      ctx,
    );
    expect(rows.map((r) => r.id)).toEqual(['driverWaiting', 't1', 'd1', 'd2', 'c1']);
    expect(rows[0]!.title).toContain('2');
    expect(rows[1]!.title).toBe('Moved to the bakery store');
    expect(rows[1]!.lines).toEqual(['Flour 5000 g']);
    expect(rows[2]!.title).toBe('Added to the bakery store');
    expect(rows[3]!.title).toBe('Added to the cafe store · Goods in');
    expect(rows[4]).toMatchObject({ title: 'Count of the bakery store', lines: ['Flour 4800 g'], status: { label: 'Waiting for a manager', tone: 'warn' } });
    expect(JSON.stringify(rows)).not.toMatch(/IQD|cost/i);
    // A section the caller's role does not get comes back null: nothing to list.
    expect(phoneRows('storeToday', { business_date: '2026-09-26', transfers: null, logs: null, driver_deliveries_waiting: null, counts: null }, ctx)).toEqual([]);
  });

  it('copies a head’s own deduction proposals, with the decider’s note, for the heads alone (wave 5 §5.1)', () => {
    const has = (role: StaffRole) => (phoneSectionsFor(role) as string[]).includes('myDeductionProposals');
    expect(TASK_ROLES.filter(has).sort()).toEqual(['head_barista', 'head_chef']);
    expect(phoneRead('myDeductionProposals', 'head_barista')).toEqual({ fn: 'my_deduction_proposals', args: {} });
    expect(phoneSectionKeys('myDeductionProposals')).toEqual({ tab: 'ws.deductions.phone.tab', empty: 'ws.deductions.phone.empty' });
    const rows = phoneRows(
      'myDeductionProposals',
      {
        proposals: [
          { id: 'd1', staff_name: 'Yusuf', staff_role: 'barista', amount_iqd: 25000, deduction_date: '2026-09-20', reason: 'Late three times', status: 'declined', proposed_at: '2026-09-20T09:00:00Z', decided_at: '2026-09-21T10:00:00Z', decision_note: 'Not on shift that day' },
          { id: 'd2', staff_name: 'Hussein', staff_role: 'assistant_barista', amount_iqd: 10000, deduction_date: '2026-09-24', reason: 'Broken cup', status: 'waiting', proposed_at: '2026-09-24T09:00:00Z', decided_at: null, decision_note: null },
        ],
      },
      ctx,
    );
    expect(rows.map((r) => [r.id, r.title, r.status?.label, r.status?.tone])).toEqual([
      ['d1', 'Yusuf', 'Declined', 'danger'],
      ['d2', 'Hussein', 'Waiting', 'warn'],
    ]);
    expect(rows[0]!.body).toBe('Late three times');
    expect(rows[0]!.detail).toMatch(/25,000/);
    expect(rows[0]!.lines?.[0]).toMatch(/Not on shift that day/);
    expect(rows[1]!.lines).toBeUndefined();
  });

  it('names a recipe’s ingredients and never a quantity (#72)', () => {
    const rows = phoneRows(
      'recipes',
      { items: [{ menu_item_id: 'm1', name_en: 'Latte', category_name_en: 'Coffee', sizes: [{ name_en: 'Small', lines: [{ name_en: 'Milk' }, { name_en: 'Espresso' }] }] }], prepared: [] },
      ctx,
    );
    expect(rows[0]!.lines).toEqual(['Small: Milk, Espresso']);
  });

  it('says a size or a prepared item has no recipe yet rather than naming nothing', () => {
    const rows = phoneRows(
      'recipes',
      {
        items: [{ menu_item_id: 'm1', name_en: 'Tea', sizes: [{ name_en: 'Regular', lines: [] }, { name_en: 'Large', lines: [{ name_en: 'Tea leaves' }] }] }],
        prepared: [{ ingredient_id: 'i1', name_en: 'Date paste', lines: [] }],
      },
      ctx,
    );
    expect(rows[0]!.lines).toEqual(['Regular: no recipe yet', 'Large: Tea leaves']);
    expect(rows[1]!.lines).toEqual(['no recipe yet']);
  });

  it('puts the chef assistant’s lines waiting for the head chef above the open list (#66)', () => {
    const rows = phoneRows(
      'shopping',
      { items: [{ id: 'l1', name_en: 'Dates', qty: 2, unit: 'pack', status: 'open', requested_by_name: 'Rusul' }], open_count: 1, pending_count: 3 },
      ctx,
    );
    expect(rows.map((r) => r.title)).toEqual(['Waiting for the head chef’s OK: 3', 'Dates']);
    expect(rows[1]!.detail).toBe('Packs: 2 · Rusul');
    // The driver's list never counts them (the server sends 0).
    expect(phoneRows('shopping', { items: [], pending_count: 0 }, ctx)).toEqual([]);
  });

  it('shows campaign results as counts, never money', () => {
    const rows = phoneRows('results', { campaigns: [{ campaign_id: 'c', name_en: 'Autumn', sends: 40, delivered: 38, redemptions: 5, attributable: true }] }, ctx);
    expect(rows[0]!.detail).toBe('Sent 40 · delivered 38 · used 5');
  });
});

describe('validateTasksSearch', () => {
  it('keeps a step, a start and an idea only when well formed', () => {
    expect(validateTasksSearch({ step: 'AAAAAAAA-0000-4000-8000-000000000001' })).toEqual({ step: 'aaaaaaaa-0000-4000-8000-000000000001' });
    expect(validateTasksSearch({ start: 'price_promo' })).toEqual({ start: 'price_promo' });
    expect(validateTasksSearch({ start: 'hiring' })).toEqual({});
    expect(validateTasksSearch({ start: 'product_release', idea: 'aaaaaaaa-0000-4000-8000-000000000009' })).toEqual({
      start: 'product_release',
      idea: 'aaaaaaaa-0000-4000-8000-000000000009',
    });
    // An idea only ever starts a new item.
    expect(validateTasksSearch({ start: 'price_promo', idea: 'aaaaaaaa-0000-4000-8000-000000000009' })).toEqual({ start: 'price_promo' });
    expect(validateTasksSearch({ step: 'nope' })).toEqual({});
  });
});
