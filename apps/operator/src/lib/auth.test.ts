import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ROLES,
  ROUTE_ROLES,
  STAFF_ROLES,
  SUB_ROUTES,
  allowedRoutes,
  allowedSubRoutes,
  can,
  canAccess,
  homeRoute,
  type Capability,
  type StaffRole,
} from './auth';

const ALL_ROLES: readonly StaffRole[] = STAFF_ROLES;
/** Bar and kitchen (0155): prep's access exactly, and nothing more. */
const KITCHEN_FAMILY = ['head_barista', 'barista', 'head_chef', 'chef'] as const;
/** The any-staff baseline plus My tasks. */
const TEAM = ['driver', 'marketing'] as const;

describe('canAccess — longest-prefix match, default deny', () => {
  it('denies every role on a route that matches no prefix', () => {
    for (const role of ALL_ROLES) {
      expect(canAccess(role, '/nowhere')).toBe(false);
      expect(canAccess(role, '/')).toBe(false);
      expect(canAccess(role, '')).toBe(false);
    }
  });

  it('denies when there is no role at all', () => {
    expect(canAccess(undefined, '/till')).toBe(false);
    expect(canAccess(undefined, '/admin/menu')).toBe(false);
  });

  it('only matches on path-segment boundaries (a sibling is not a prefix)', () => {
    expect(canAccess('owner', '/adminx')).toBe(false);
    expect(canAccess('owner', '/analytics-old')).toBe(false);
    expect(canAccess('owner', '/tills')).toBe(false);
  });

  it('allows /admin/menu via the /admin prefix for manager and owner only', () => {
    expect(canAccess('manager', '/admin/menu')).toBe(true);
    expect(canAccess('owner', '/admin/menu')).toBe(true);
    expect(canAccess('cashier', '/admin/menu')).toBe(false);
    expect(canAccess('prep', '/admin/menu')).toBe(false);
    expect(canAccess('court_desk', '/admin/menu')).toBe(false);
  });

  it('lets an explicit deeper entry override the /admin prefix (owner-only sections)', () => {
    expect(canAccess('manager', '/admin/telegram')).toBe(false);
    expect(canAccess('manager', '/admin/staff')).toBe(false);
    expect(canAccess('owner', '/admin/telegram')).toBe(true);
    expect(canAccess('owner', '/admin/staff')).toBe(true);
    // Deeper paths inherit the longest matching prefix, not the shortest.
    expect(canAccess('manager', '/admin/telegram/outbox')).toBe(false);
    expect(canAccess('owner', '/admin/telegram/outbox')).toBe(true);
  });

  it('keeps /analytics owner-only', () => {
    expect(canAccess('owner', '/analytics')).toBe(true);
    for (const role of ALL_ROLES.filter((r) => r !== 'owner')) {
      expect(canAccess(role, '/analytics')).toBe(false);
    }
  });

  it('tolerates trailing slashes, query strings and hashes', () => {
    expect(canAccess('manager', '/admin/menu/')).toBe(true);
    expect(canAccess('manager', '/admin/menu?tab=items')).toBe(true);
    expect(canAccess('manager', '/admin#top')).toBe(true);
    expect(canAccess('manager', '/admin/telegram/?x=1')).toBe(false);
  });

  it('keeps the legacy top-level matrix intact', () => {
    expect(canAccess('cashier', '/till')).toBe(true);
    expect(canAccess('cashier', '/kds')).toBe(false);
    expect(canAccess('prep', '/kds')).toBe(true);
    expect(canAccess('court_desk', '/desk')).toBe(true);
    expect(canAccess('court_desk', '/admin')).toBe(false);
    expect(canAccess('manager', '/stock')).toBe(true);
  });

  it('gives the bar and kitchen family the kitchen display, and only that', () => {
    for (const role of KITCHEN_FAMILY) {
      expect(canAccess(role, '/kds'), role).toBe(true);
      // Every other route answers exactly as it does for prep.
      for (const route of Object.keys(ROUTE_ROLES)) {
        expect(canAccess(role, route), `${role} ${route}`).toBe(canAccess('prep', route));
      }
    }
  });

  it('gives driver and marketing My tasks and nothing else', () => {
    for (const role of TEAM) {
      expect(canAccess(role, '/tasks'), role).toBe(true);
      for (const route of Object.keys(ROUTE_ROLES).filter((r) => r !== '/tasks')) {
        expect(canAccess(role, route), `${role} ${route}`).toBe(false);
      }
    }
    // My tasks is theirs: no other role, the jokers included, lands on it.
    for (const role of ALL_ROLES.filter((r) => !(TEAM as readonly string[]).includes(r))) {
      expect(canAccess(role, '/tasks'), role).toBe(false);
    }
  });
});

describe('allowedRoutes — top-level entries only', () => {
  it('never returns a nested route', () => {
    for (const role of ALL_ROLES) {
      for (const route of allowedRoutes(role)) {
        expect(route.lastIndexOf('/')).toBe(0);
      }
    }
  });

  it('filters by role', () => {
    expect(allowedRoutes('cashier')).toEqual(['/till']);
    expect(allowedRoutes('prep')).toEqual(['/kds']);
    expect(allowedRoutes('chef')).toEqual(['/kds']);
    expect(allowedRoutes('driver')).toEqual(['/tasks']);
    expect(allowedRoutes('manager')).toContain('/admin');
    expect(allowedRoutes('manager')).not.toContain('/analytics');
    expect(allowedRoutes('owner')).toContain('/analytics');
  });
});

describe('allowedSubRoutes', () => {
  it('hides owner-only sections from a manager', () => {
    const manager = allowedSubRoutes('manager', '/admin');
    expect(manager).toContain('/admin/menu');
    expect(manager).toContain('/admin/day-close');
    expect(manager).not.toContain('/admin/telegram');
    expect(manager).not.toContain('/admin/staff');
  });

  it('shows everything to the owner and nothing to a cashier', () => {
    expect(allowedSubRoutes('owner', '/admin')).toEqual([...SUB_ROUTES['/admin']]);
    expect(allowedSubRoutes('cashier', '/admin')).toEqual([]);
  });

  it('keeps SUB_ROUTES and ROUTE_ROLES consistent', () => {
    for (const route of SUB_ROUTES['/admin']) expect(route.startsWith('/admin/')).toBe(true);
    for (const key of Object.keys(ROUTE_ROLES).filter((k) => k.startsWith('/admin/'))) {
      expect(SUB_ROUTES['/admin']).toContain(key);
    }
  });
});

describe('homeRoute', () => {
  it('lands each role on its module', () => {
    // Spec §04 workspace map: each role signs into its own landing screen.
    expect(homeRoute('cashier')).toBe('/till');
    expect(homeRoute('prep')).toBe('/kds');
    expect(homeRoute('court_desk')).toBe('/desk/today');
    expect(homeRoute('manager')).toBe('/ops');
    expect(homeRoute('owner')).toBe('/panel');
    for (const role of KITCHEN_FAMILY) expect(homeRoute(role), role).toBe('/kds');
    for (const role of TEAM) expect(homeRoute(role), role).toBe('/tasks');
  });

  it('lands every role on a screen it may open', () => {
    for (const role of ALL_ROLES) expect(canAccess(role, homeRoute(role)), role).toBe(true);
  });
});

describe('capability matrix', () => {
  // These four were inline `staff?.role === 'owner'` comparisons inside two
  // components. SOW L185 promises "one place to change a permission", and a
  // route matrix that only covers routes is not one place.
  const ALL_CAPS = Object.keys(CAPABILITY_ROLES) as Capability[];

  it('is default-deny for a signed-out caller', () => {
    for (const capability of ALL_CAPS) expect(can(undefined, capability)).toBe(false);
  });

  it('grants every listed capability to the owner', () => {
    for (const capability of ALL_CAPS) expect(can('owner', capability)).toBe(true);
  });

  it('withholds all four from every non-owner role', () => {
    for (const role of ALL_ROLES.filter((r) => r !== 'owner')) {
      for (const capability of ALL_CAPS) {
        expect(can(role, capability), `${role} / ${capability}`).toBe(false);
      }
    }
  });

  it('gates the controls that actually need it', () => {
    // Named explicitly so deleting one from the matrix fails here rather
    // than silently exposing the control.
    expect(ALL_CAPS.sort()).toEqual(
      ['editVenueDetails', 'rotateTableToken', 'setAnalyticsExclusions', 'setBusinessDayStart', 'setEngagementFloor'].sort(),
    );
  });

  it('leaves the venue details to the owner, as app.set_venue_details does', () => {
    expect(can('owner', 'editVenueDetails')).toBe(true);
    expect(can('manager', 'editVenueDetails')).toBe(false);
  });

  it('never lists an unknown role', () => {
    for (const roles of Object.values(CAPABILITY_ROLES)) {
      for (const role of roles) expect(ALL_ROLES).toContain(role);
    }
  });
});

describe('permissionsFor (spec §03 can.*)', () => {
  it('is default-deny with no role', async () => {
    const { permissionsFor } = await import('./auth');
    expect(Object.values(permissionsFor(undefined)).every((v) => v === false)).toBe(true);
  });
  it('separates cashier, management and owner powers', async () => {
    const { permissionsFor } = await import('./auth');
    const cashier = permissionsFor('cashier');
    expect(cashier.takePayment).toBe(true);
    expect(cashier.refund).toBe(false);
    expect(cashier.closeDay).toBe(false);
    // The drawer screen gives a cashier the action, not the log (2026-09-22).
    expect(cashier.viewDrawerLog).toBe(false);
    const manager = permissionsFor('manager');
    expect(manager.viewDrawerLog).toBe(true);
    expect(manager.refund).toBe(true);
    expect(manager.manageStaff).toBe(false);
    expect(manager.viewFinancials).toBe(false);
    const owner = permissionsFor('owner');
    expect(owner.manageStaff).toBe(true);
    expect(owner.viewFinancials).toBe(true);
  });
  it('gives the six 0155 roles no permission at all', async () => {
    const { permissionsFor } = await import('./auth');
    for (const role of [...KITCHEN_FAMILY, ...TEAM]) {
      expect(Object.values(permissionsFor(role)).every((v) => v === false), role).toBe(true);
    }
  });
  it('lets the court desk take court payment without the till (0106)', async () => {
    const { permissionsFor, canAccess, requiredRoleFor } = await import('./auth');
    const desk = permissionsFor('court_desk');
    expect(desk.takeCourtPayment).toBe(true);
    expect(desk.takePayment).toBe(false);
    expect(desk.refund).toBe(false);
    expect(canAccess('court_desk', '/till')).toBe(false);
    expect(permissionsFor('prep').takeCourtPayment).toBe(false);
    expect(permissionsFor('cashier').takeCourtPayment).toBe(true);
    expect(requiredRoleFor('takeCourtPayment')).toBe('court_desk');
  });
  it('new workspace routes are default-deny for the wrong role', async () => {
    const { canAccess } = await import('./auth');
    expect(canAccess('cashier', '/ops')).toBe(false);
    expect(canAccess('manager', '/panel')).toBe(false);
    expect(canAccess('manager', '/reports/revenue')).toBe(false);
    expect(canAccess('manager', '/reports/courts')).toBe(true);
    expect(canAccess('cashier', '/desk/customers')).toBe(true);
    expect(canAccess('cashier', '/desk/customers/new')).toBe(false);
    expect(canAccess('court_desk', '/workspaces')).toBe(false);
  });
});
