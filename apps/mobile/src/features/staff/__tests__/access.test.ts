import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCESS_AREAS, ACCESS_AREA_KEYS, type StaffAccess } from '@touch/core';
import {
  AREA_ROLES,
  STAFF_PAGE_AREAS,
  hrefBlocked,
  isStaffPage,
  pageBlocked,
  staffPageOfHref,
  type StaffPage,
} from '../access';
import { staffGate } from '../gate';
import { STAFF_ROW_DEFS, staffRows, visibleTodayRows } from '../rows';
import type { StaffStatus } from '../status';

/**
 * Blocked pages on the staff phone (0345 Staff Access; F-16, Majed 2026-11-01:
 * "blocked pages are always blocked, no exceptions"). Every staff screen
 * names its page, every page names its operator areas, and a blocked page
 * sends the person back to Today whichever way they came.
 */

const APP = join(__dirname, '../../../../app');
const OPERATOR_AUTH = join(__dirname, '../../../../../operator/src/lib/auth.tsx');

/** Every staff screen file, by page name. */
function staffScreens(): { page: string; file: string }[] {
  const group = readdirSync(join(APP, '(staff)'))
    .filter((f) => f.endsWith('.tsx') && !f.startsWith('_'))
    .map((f) => ({ page: f.slice(0, -4), file: join(APP, '(staff)', f) }));
  return [
    ...group,
    { page: 'staff', file: join(APP, 'staff.tsx') },
    { page: 'staff-group', file: join(APP, 'staff-group.tsx') },
  ];
}

const who = (over: Partial<StaffAccess> & Pick<StaffAccess, 'role'>): StaffAccess => ({
  extraRoles: [],
  blockedAreas: [],
  ...over,
});

describe('every staff screen is behind the blocked-pages check', () => {
  it('lists every staff screen, and nothing that is not one', () => {
    const screens = staffScreens().map((s) => s.page).sort();
    expect(Object.keys(STAFF_PAGE_AREAS).sort()).toEqual(screens);
  });

  it('has each screen name its own page on its RequireStaff', () => {
    for (const { page, file } of staffScreens()) {
      const src = readFileSync(file, 'utf8');
      const gates = src.match(/<RequireStaff\b[^>]*>/g) ?? [];
      expect(gates.length, page).toBe(1);
      expect(gates[0], page).toContain(`page="${page}"`);
    }
  });

  it('names only areas the operator knows', () => {
    for (const [page, areas] of Object.entries(STAFF_PAGE_AREAS)) {
      for (const area of areas) expect(ACCESS_AREA_KEYS, page).toContain(area);
    }
  });
});

describe('AREA_ROLES', () => {
  // The operator's ROUTE_ROLES, read as text: the phone cannot import the operator.
  const src = readFileSync(OPERATOR_AUTH, 'utf8');
  const rolesOfKey = (key: string): string[] => {
    const escaped = key.replace(/[/]/g, '\\/');
    const m = new RegExp(`'${escaped}':\\s*\\[([^\\]]*)\\]`).exec(src);
    if (!m) throw new Error(`no ROUTE_ROLES entry for ${key}`);
    return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).filter((r) => r !== 'owner');
  };

  it('is, for each area, the roles of its first route key on the operator (owner left out)', () => {
    for (const area of ACCESS_AREA_KEYS) {
      expect([...AREA_ROLES[area]].sort(), area).toEqual(rolesOfKey(ACCESS_AREAS[area][0]).sort());
    }
  });
});

describe('pageBlocked', () => {
  it('never blocks a page with no area, nor anyone with no blocks', () => {
    const everything = who({ role: 'manager', blockedAreas: [...ACCESS_AREA_KEYS] });
    for (const page of ['staff', 'staff-group', 'staff-request', 'staff-rewards', 'staff-work'] as StaffPage[]) {
      expect(pageBlocked(page, everything), page).toBe(false);
    }
    for (const page of Object.keys(STAFF_PAGE_AREAS) as StaffPage[]) {
      expect(pageBlocked(page, who({ role: 'manager' })), page).toBe(false);
    }
  });

  it('never blocks an owner', () => {
    const owner = who({ role: 'owner', blockedAreas: [...ACCESS_AREA_KEYS] });
    for (const page of Object.keys(STAFF_PAGE_AREAS) as StaffPage[]) {
      expect(pageBlocked(page, owner), page).toBe(false);
    }
  });

  it('blocks a front-line person\'s protocol work and checklists when My tasks is unticked', () => {
    const waiter = who({ role: 'waiter', blockedAreas: ['tasks'] });
    for (const page of ['staff-runs', 'staff-run', 'staff-step', 'staff-notes', 'staff-checklist', 'staff-checklist-history'] as const) {
      expect(pageBlocked(page, waiter), page).toBe(true);
    }
    expect(pageBlocked('staff-request', waiter)).toBe(false);
  });

  it('blocks a manager\'s protocols by Protocols and their checklists by Operations', () => {
    expect(pageBlocked('staff-runs', who({ role: 'manager', blockedAreas: ['protocols'] }))).toBe(true);
    expect(pageBlocked('staff-runs', who({ role: 'manager', blockedAreas: ['tasks'] }))).toBe(false);
    expect(pageBlocked('staff-checklist', who({ role: 'manager', blockedAreas: ['ops'] }))).toBe(true);
  });

  it('keeps a page open while another of its areas is open to the person', () => {
    // A manager opens Stock and Touch Shop: blocking the shop leaves Stock.
    expect(pageBlocked('staff-stock', who({ role: 'manager', blockedAreas: ['shop'] }))).toBe(false);
    expect(pageBlocked('staff-stock', who({ role: 'manager', blockedAreas: ['shop', 'stock'] }))).toBe(true);
    // A shop assistant opens only the shop.
    expect(pageBlocked('staff-stock', who({ role: 'shop_staff', blockedAreas: ['shop'] }))).toBe(true);
  });

  it('applies a second job\'s areas too (0345)', () => {
    // A waiter who also works the café cashier: the floor pages follow Café cashier.
    const both = who({ role: 'waiter', extraRoles: ['cashier'], blockedAreas: ['till'] });
    expect(pageBlocked('staff-order', both)).toBe(true);
    expect(pageBlocked('staff-calls', both)).toBe(true);
    const open = who({ role: 'waiter', extraRoles: ['cashier'] });
    expect(pageBlocked('staff-order', open)).toBe(false);
  });

  it('never ignores a stored block, even on an area the person does not open', () => {
    // A waiter does not open Café cashier on the operator; a stored block still holds.
    expect(pageBlocked('staff-order', who({ role: 'waiter', blockedAreas: ['till'] }))).toBe(true);
  });

  it('reads hrefs the way Today rows carry them', () => {
    expect(staffPageOfHref('/staff-stock')).toBe('staff-stock');
    expect(staffPageOfHref('/staff-step?id=1')).toBe('staff-step');
    expect(staffPageOfHref('/coach-mode')).toBeNull();
    expect(isStaffPage('staff-till')).toBe(false);
    expect(hrefBlocked('/staff-incidents', who({ role: 'cashier', blockedAreas: ['incidents'] }))).toBe(true);
    expect(hrefBlocked('/coach-mode', who({ role: 'cashier', blockedAreas: [...ACCESS_AREA_KEYS] }))).toBe(false);
  });
});

describe('staffGate with a page', () => {
  const status = (access: Partial<StaffAccess>): StaffStatus => ({
    kind: 'staff',
    staff: { id: 'u-1', displayName: 'Sara', role: 'head_chef', ...access },
    venues: [],
  });

  it('sends a blocked page back to Today, whichever way it was opened', () => {
    expect(staffGate(status({ blockedAreas: ['kds'] }), undefined, 'staff-recipes')).toBe('redirect-staff-home');
    expect(staffGate(status({ blockedAreas: ['kds'] }), undefined, 'staff-request')).toBe('allow');
    expect(staffGate(status({}), undefined, 'staff-recipes')).toBe('allow');
  });

  it('never blocks Today itself', () => {
    expect(staffGate(status({ blockedAreas: [...ACCESS_AREA_KEYS] }), undefined, 'staff')).toBe('allow');
  });
});

describe('Today leaves blocked rows out', () => {
  it('drops exactly the rows whose page is blocked', () => {
    const cashier = who({ role: 'cashier', blockedAreas: ['incidents', 'till'] });
    const ids = visibleTodayRows(staffRows('cashier'), cashier).map((r) => r.id);
    expect(ids).not.toContain('incidents');
    expect(ids).not.toContain('order');
    expect(ids).toContain('requests');
    expect(visibleTodayRows(staffRows('cashier'), who({ role: 'cashier' }))).toEqual(staffRows('cashier'));
  });

  it('knows the page of every row', () => {
    for (const row of STAFF_ROW_DEFS) expect(staffPageOfHref(row.href), row.id).not.toBeNull();
  });
});

describe('the server\'s refusal (0384)', () => {
  it('reads AREA_BLOCKED as the owner\'s block, in both languages', async () => {
    const { mapErrorToKey } = await import('../../booking/errors');
    const { makeT } = await import('@touch/i18n');
    const key = mapErrorToKey(Object.assign(new Error('AREA_BLOCKED'), { code: 'P0001' }));
    expect(key).toBe('op.errors.AREA_BLOCKED');
    expect(makeT('en')(key)).toMatch(/blocked/i);
    expect(makeT('ar')(key)).not.toBe(key);
  });
});
