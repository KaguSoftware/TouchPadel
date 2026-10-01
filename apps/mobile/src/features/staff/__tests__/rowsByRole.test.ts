import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, type StaffRole } from '@touch/core';
import { staffRows, todayRows } from '../rows';

/**
 * What each role sees on Today (build-contracts-2026-09-23 §6.1, "Today rows
 * by role" and "Role-spec rows"), in the order Today lists them. rows.ts takes
 * each row's roles from its screen's gate; this pins the result against the
 * tables, so a gate that widens or narrows shows up here as a Today change.
 *
 * Nothing still on the Parked list (§0) has a row: no salaries, no day close
 * and no desk report. Wave 5 (wave5-addendum-2026-09-25 §5.1, §5.3) unparked
 * stock logging and marketing approval: the stores' rows (`stock-log`,
 * `stock-move`, `stock-count`), the people records' rows (`deductions`,
 * `incidents`, `content`) and the waiter's `calls`. The assistant barista
 * and the waiter are wave 5's roles: the baseline rows, and for the assistant
 * barista the bar's teachings and recipe names.
 */
const MGMT = [
  'protocols',
  'start',
  'production',
  'shopping',
  'purchases',
  'requests',
  'notes',
  'ideas',
  'teachings',
  'recipes',
  'recipe-changes',
  'stock',
  'stock-log',
  'stock-move',
  'stock-count',
  'suggestions',
  'ask-marketing',
];

const EXPECTED: Record<StaffRole, string[]> = {
  owner: MGMT,
  manager: MGMT,
  head_barista: [
    'protocols',
    'start',
    'shopping',
    'requests',
    'notes',
    'ideas',
    'teachings',
    'recipes',
    'recipe-changes',
    'stock',
    'stock-log',
    'suggestions',
  ],
  head_chef: [
    'protocols',
    'start',
    'production',
    'shopping',
    'requests',
    'notes',
    'ideas',
    'teachings',
    'recipes',
    'recipe-changes',
    'stock',
    'stock-log',
    'stock-count',
    'suggestions',
  ],
  barista: [
    'protocols',
    'shopping',
    'requests',
    'notes',
    'ideas',
    'teachings',
    'recipes',
    'suggestions',
  ],
  chef: [
    'protocols',
    'production',
    'shopping',
    'requests',
    'notes',
    'ideas',
    'teachings',
    'recipes',
    'stock-count',
    'suggestions',
  ],
  driver: ['protocols', 'run', 'purchases', 'requests', 'notes', 'suggestions'],
  marketing: ['protocols', 'start', 'marketing', 'requests', 'notes', 'suggestions', 'marketing-inbox'],
  // 0245: the court desk keeps no stock; the shop assistant keeps the shop's.
  court_desk: ['protocols', 'start', 'requests', 'notes', 'suggestions'],
  cashier: ['protocols', 'requests', 'notes', 'stock-log', 'suggestions'],
  prep: ['protocols', 'requests', 'notes', 'suggestions'],
  assistant_barista: ['protocols', 'requests', 'notes', 'teachings', 'recipes', 'suggestions'],
  waiter: ['protocols', 'requests', 'notes', 'stock', 'stock-move', 'suggestions', 'calls'],
  shop_staff: ['protocols', 'requests', 'notes', 'stock', 'stock-log', 'stock-count', 'suggestions'],
};

/**
 * Wave 5, the people records (P, wave5-addendum-2026-09-25 §5.3), which close
 * the contracts' parked salaries, desk report and marketing approval: pay
 * deductions for the heads and management (DEDUCT), incidents for every role,
 * and content for marketing and the owners, never a manager (§8 Q14). They
 * come last on Today, after every row above.
 */
const PEOPLE: Record<StaffRole, string[]> = {
  owner: ['deductions', 'incidents', 'content'],
  manager: ['deductions', 'incidents'],
  head_barista: ['deductions', 'incidents'],
  head_chef: ['deductions', 'incidents'],
  barista: ['incidents'],
  chef: ['incidents'],
  driver: ['incidents'],
  marketing: ['incidents', 'content'],
  court_desk: ['incidents'],
  cashier: ['incidents'],
  prep: ['incidents'],
  assistant_barista: ['incidents'],
  waiter: ['incidents'],
  shop_staff: ['incidents'],
};

/**
 * After the people records: the floor places an order from the phone (0251,
 * which took "Scan an order" off Today; the slip photo is a link on the order
 * page), and the driver and management scan a supplier's receipt for Goods in.
 */
const SCAN: Record<StaffRole, string[]> = {
  owner: ['order', 'receipt'],
  manager: ['order', 'receipt'],
  head_barista: [],
  head_chef: [],
  barista: [],
  chef: [],
  driver: ['receipt'],
  marketing: [],
  court_desk: [],
  cashier: ['order'],
  prep: [],
  assistant_barista: [],
  waiter: ['order'],
  shop_staff: [],
};

describe('Today rows by role', () => {
  it.each(STAFF_ROLES)('match the contract tables for %s', (role) => {
    expect(staffRows(role).map((r) => r.id)).toEqual([...EXPECTED[role], ...PEOPLE[role], ...SCAN[role]]);
  });

  it('keep content from managers, and deductions to the heads and management (wave 5 §5.3)', () => {
    for (const role of STAFF_ROLES) {
      const ids = staffRows(role).map((r) => r.id);
      expect(ids.includes('content'), role).toBe(role === 'marketing' || role === 'owner');
      expect(ids.includes('deductions'), role).toBe(
        ['head_barista', 'head_chef', 'manager', 'owner'].includes(role),
      );
      expect(ids, role).toContain('incidents');
    }
  });

  it('give the driver the run and never the plain shopping row', () => {
    const ids = staffRows('driver').map((r) => r.id);
    expect(ids).toContain('run');
    expect(ids).not.toContain('shopping');
    for (const role of STAFF_ROLES.filter((r) => r !== 'driver')) {
      expect(staffRows(role).map((r) => r.id), role).not.toContain('run');
    }
  });

  it('send marketing to its inbox, and only the manager and the owner to ask (2026-09-28)', () => {
    for (const role of STAFF_ROLES) {
      const ids = staffRows(role).map((r) => r.id);
      expect(ids.includes('marketing-inbox'), role).toBe(role === 'marketing');
      expect(ids.includes('ask-marketing'), role).toBe(role === 'manager' || role === 'owner');
    }
  });

  it('give guests\' calls to the waiter alone: the till keeps the cashier and managers (wave 5 §2.1.8)', () => {
    for (const role of STAFF_ROLES) {
      expect(staffRows(role).some((r) => r.id === 'calls'), role).toBe(role === 'waiter');
    }
  });

  it('relabel the requests row "Vacation and requests" (#62)', () => {
    for (const role of STAFF_ROLES) {
      const row = staffRows(role).find((r) => r.id === 'requests');
      expect(row?.labelKey, role).toBe('staff.checklists.vacation.row');
    }
  });

  it('place an order goes to the waiter, the cashier and management (0251)', () => {
    for (const role of STAFF_ROLES) {
      const row = staffRows(role).find((r) => r.id === 'order');
      expect(!!row, role).toBe(['waiter', 'cashier', 'manager', 'owner'].includes(role));
      if (row) expect(row).toMatchObject({ href: '/staff-order', labelKey: 'staff.floor.row' });
      expect(staffRows(role).some((r) => r.id === 'order-slip'), role).toBe(false);
    }
  });
});

/**
 * Two rows depend on the day, not the role (owner, 2026-09-28): Protocols
 * for management always and for anyone else while a run in progress involves
 * them; Notes on new items while one is at its feedback stage. Unknown (a read
 * still out, or failed) hides the row.
 */
describe('Today rows that depend on the day', () => {
  const ids = (role: StaffRole, runs: number | null, notes: number | null) =>
    todayRows(role, { runs, notes }).map((r) => r.id);

  it('shows Protocols to management always, and to others only with a run that involves them', () => {
    for (const role of ['manager', 'owner'] as const) {
      expect(ids(role, 0, 0), role).toContain('protocols');
      expect(ids(role, null, null), role).toContain('protocols');
    }
    for (const role of ['waiter', 'cashier', 'barista', 'head_chef', 'marketing'] as const) {
      expect(ids(role, 0, 0), role).not.toContain('protocols');
      expect(ids(role, null, 0), role).not.toContain('protocols');
      expect(ids(role, 2, 0), role).toContain('protocols');
    }
  });

  it('shows Notes on new items only while one is at its feedback stage, to everyone', () => {
    for (const role of STAFF_ROLES) {
      expect(ids(role, 1, 0), role).not.toContain('notes');
      expect(ids(role, 1, null), role).not.toContain('notes');
      expect(ids(role, 1, 1), role).toContain('notes');
    }
  });

  it('leaves every other row to the role', () => {
    for (const role of STAFF_ROLES) {
      const all = staffRows(role).map((r) => r.id).filter((id) => id !== 'protocols' && id !== 'notes');
      expect(ids(role, 0, 0).filter((id) => id !== 'protocols'), role).toEqual(all);
    }
  });
});
