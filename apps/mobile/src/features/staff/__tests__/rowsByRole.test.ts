import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, type StaffRole } from '@touch/core';
import { staffRows } from '../rows';

/**
 * What each role sees on Today (build-contracts-2026-09-23 §6.1, "Today rows
 * by role" and "Role-spec rows"), in the order Today lists them. rows.ts takes
 * each row's roles from its screen's gate; this pins the result against the
 * tables, so a gate that widens or narrows shows up here as a Today change.
 *
 * Nothing on the Parked list (§0) has a row: no assistant barista or waiter,
 * no salaries, no day close, no stock logging, no desk report and no
 * marketing approval.
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
    'suggestions',
    'ask-marketing',
  ],
  driver: ['protocols', 'run', 'purchases', 'requests', 'notes', 'suggestions', 'ask-marketing'],
  marketing: ['protocols', 'start', 'marketing', 'requests', 'notes', 'suggestions', 'marketing-inbox'],
  court_desk: ['protocols', 'start', 'requests', 'notes', 'stock', 'suggestions', 'ask-marketing'],
  cashier: ['protocols', 'requests', 'notes', 'suggestions', 'ask-marketing'],
  prep: ['protocols', 'requests', 'notes', 'suggestions', 'ask-marketing'],
};

describe('Today rows by role', () => {
  it.each(STAFF_ROLES)('match the contract tables for %s', (role) => {
    expect(staffRows(role).map((r) => r.id)).toEqual(EXPECTED[role]);
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

  it('relabel the requests row "Vacation and requests" (#62)', () => {
    for (const role of STAFF_ROLES) {
      const row = staffRows(role).find((r) => r.id === 'requests');
      expect(row?.labelKey, role).toBe('staff.checklists.vacation.row');
    }
  });
});
