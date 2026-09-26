import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, type StaffRole } from '@touch/core';
import { staffRows } from '../rows';

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
    'ask-marketing',
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
    'ask-marketing',
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
    'ask-marketing',
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
    'ask-marketing',
  ],
  driver: ['protocols', 'run', 'purchases', 'requests', 'notes', 'suggestions', 'ask-marketing'],
  marketing: ['protocols', 'start', 'marketing', 'requests', 'notes', 'suggestions', 'marketing-inbox'],
  court_desk: ['protocols', 'start', 'requests', 'notes', 'stock', 'stock-log', 'suggestions', 'ask-marketing'],
  cashier: ['protocols', 'requests', 'notes', 'stock-log', 'suggestions', 'ask-marketing'],
  prep: ['protocols', 'requests', 'notes', 'suggestions', 'ask-marketing'],
  assistant_barista: ['protocols', 'requests', 'notes', 'teachings', 'recipes', 'suggestions', 'ask-marketing'],
  waiter: ['protocols', 'requests', 'notes', 'stock', 'stock-move', 'suggestions', 'ask-marketing', 'calls'],
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
};

describe('Today rows by role', () => {
  it.each(STAFF_ROLES)('match the contract tables for %s', (role) => {
    expect(staffRows(role).map((r) => r.id)).toEqual([...EXPECTED[role], ...PEOPLE[role]]);
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

  it('send marketing to its inbox and every other role to ask', () => {
    for (const role of STAFF_ROLES) {
      const ids = staffRows(role).map((r) => r.id);
      expect(ids.includes('marketing-inbox'), role).toBe(role === 'marketing');
      expect(ids.includes('ask-marketing'), role).toBe(role !== 'marketing');
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
});
