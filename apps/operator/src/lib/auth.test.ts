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
/** Bar and kitchen (0155, the assistant barista since wave 5): prep's access exactly, and nothing more. */
const KITCHEN_FAMILY = ['head_barista', 'barista', 'assistant_barista', 'head_chef', 'chef'] as const;
/** The any-staff baseline plus My tasks (the waiter since wave 5). */
const TEAM = ['driver', 'marketing', 'waiter'] as const;

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

  it('gives /protocols to management alone', () => {
    // Every other actor works its steps from /tasks or the phone
    // (build-contracts-2026-09-23 §5.1).
    expect(canAccess('manager', '/protocols')).toBe(true);
    expect(canAccess('owner', '/protocols')).toBe(true);
    expect(canAccess('manager', '/protocols?start=price_promo&change=price')).toBe(true);
    for (const role of ALL_ROLES.filter((r) => r !== 'manager' && r !== 'owner')) {
      expect(canAccess(role, '/protocols'), role).toBe(false);
    }
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

  it('gives the bar and kitchen family the kitchen display and My tasks, and only those', () => {
    for (const role of KITCHEN_FAMILY) {
      expect(canAccess(role, '/kds'), role).toBe(true);
      // /tasks is the board's "My tasks" (§5.1); every other route answers
      // exactly as it does for prep, which gets nothing new.
      expect(canAccess(role, '/tasks'), role).toBe(true);
      for (const route of Object.keys(ROUTE_ROLES).filter((r) => r !== '/tasks')) {
        expect(canAccess(role, route), `${role} ${route}`).toBe(canAccess('prep', route));
      }
    }
  });

  it('gives driver, marketing and the waiter My tasks and nothing else', () => {
    for (const role of TEAM) {
      expect(canAccess(role, '/tasks'), role).toBe(true);
      for (const route of Object.keys(ROUTE_ROLES).filter((r) => r !== '/tasks')) {
        expect(canAccess(role, route), `${role} ${route}`).toBe(false);
      }
    }
  });

  it('opens My tasks to every hireable role but management, and never to prep (§5.1)', () => {
    const TASKS = [
      'cashier',
      'waiter',
      'court_desk',
      'head_barista',
      'barista',
      'assistant_barista',
      'head_chef',
      'chef',
      'driver',
      'marketing',
    ];
    for (const role of ALL_ROLES) {
      expect(canAccess(role, '/tasks'), role).toBe(TASKS.includes(role));
    }
  });

  it('gives the suggestion box to management alone (#63)', () => {
    for (const role of ALL_ROLES) {
      expect(canAccess(role, '/suggestions'), role).toBe(role === 'manager' || role === 'owner');
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
    expect(allowedRoutes('cashier')).toEqual(['/till', '/tasks']);
    expect(allowedRoutes('prep')).toEqual(['/kds']);
    expect(allowedRoutes('chef')).toEqual(['/kds', '/tasks']);
    expect(allowedRoutes('driver')).toEqual(['/tasks']);
    expect(allowedRoutes('assistant_barista')).toEqual(['/kds', '/tasks']);
    expect(allowedRoutes('waiter')).toEqual(['/tasks']);
    expect(allowedRoutes('manager')).toContain('/admin');
    expect(allowedRoutes('manager')).not.toContain('/analytics');
    expect(allowedRoutes('owner')).toContain('/analytics');
    expect(allowedRoutes('manager')).toContain('/protocols');
    expect(allowedRoutes('owner')).toContain('/protocols');
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
  // The first five were inline `staff?.role === 'owner'` comparisons inside two
  // components. SOW L185 promises "one place to change a permission", and a
  // route matrix that only covers routes is not one place.
  const ALL_CAPS = Object.keys(CAPABILITY_ROLES) as Capability[];
  /**
   * The capabilities a role besides the owner holds, each with exactly its
   * roles: the protocol starts, the heads' role-spec work, deciding a step,
   * and the reads behind /tasks' phone copies (each its RPC's guard).
   */
  const SHARED: Partial<Record<Capability, readonly StaffRole[]>> = {
    startProtocolRelease: ['head_barista', 'head_chef', 'manager', 'owner'],
    startProtocolPriceChange: ['marketing', 'manager', 'owner'],
    startProtocolTournament: ['court_desk', 'manager', 'owner'],
    reviewIdeas: ['head_barista', 'head_chef', 'manager', 'owner'],
    writeTeachings: ['head_barista', 'head_chef', 'manager', 'owner'],
    decideSteps: ['manager', 'owner'],
    readProduction: ['head_chef', 'chef', 'manager', 'owner'],
    readShoppingList: ['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'manager', 'owner'],
    readPurchases: ['driver', 'manager', 'owner'],
    readTeachings: ['head_barista', 'barista', 'head_chef', 'chef', 'manager', 'owner'],
    readStaffStock: ['head_barista', 'head_chef', 'court_desk', 'manager', 'owner'],
    readRecipes: ['head_barista', 'barista', 'head_chef', 'chef', 'manager', 'owner'],
  };
  /** A role's own work, which the owner does not do: the RPC refuses the owner too. */
  const OWN_WORK: Partial<Record<Capability, readonly StaffRole[]>> = {
    marketingWork: ['marketing'],
    requestRecipeChanges: ['head_barista', 'head_chef'],
    sendIdeas: ['barista', 'chef'],
  };
  const OWNER_ONLY = ALL_CAPS.filter((c) => !(c in SHARED) && !(c in OWN_WORK));

  it('is default-deny for a signed-out caller', () => {
    for (const capability of ALL_CAPS) expect(can(undefined, capability)).toBe(false);
  });

  it('grants every listed capability to the owner, but another role’s own work', () => {
    for (const capability of ALL_CAPS) expect(can('owner', capability), capability).toBe(!(capability in OWN_WORK));
  });

  it('withholds every owner-only capability from every other role', () => {
    for (const role of ALL_ROLES.filter((r) => r !== 'owner')) {
      for (const capability of OWNER_ONLY) {
        expect(can(role, capability), `${role} / ${capability}`).toBe(false);
      }
    }
  });

  it('gates the controls that actually need it', () => {
    // Named explicitly so deleting one from the matrix fails here rather
    // than silently exposing the control.
    expect(ALL_CAPS.sort()).toEqual(
      [
        'decideOwnerOkSteps',
        'decideRecipeChanges',
        'decideSteps',
        'editChecklists',
        'editLaunchedPrices',
        'editProtocols',
        'editVenueDetails',
        'launchDirectly',
        'marketingWork',
        'readProduction',
        'readPurchases',
        'readRecipes',
        'readShoppingList',
        'readStaffStock',
        'readTeachings',
        'requestRecipeChanges',
        'reviewIdeas',
        'rotateTableToken',
        'setAnalyticsExclusions',
        'setBusinessDayStart',
        'setEngagementFloor',
        'startProtocolPriceChange',
        'startProtocolRelease',
        'startProtocolTournament',
        'sendIdeas',
        'titleRunsInBoth',
        'writeTeachings',
      ].sort(),
    );
  });

  it('leaves the venue details to the owner, as app.set_venue_details does', () => {
    expect(can('owner', 'editVenueDetails')).toBe(true);
    expect(can('manager', 'editVenueDetails')).toBe(false);
  });

  it('lets exactly the proposing roles start a release or a price change (§5.1)', () => {
    for (const [capability, roles] of Object.entries({ ...SHARED, ...OWN_WORK }) as [Capability, readonly StaffRole[]][]) {
      for (const role of ALL_ROLES) {
        expect(can(role, capability), `${role} / ${capability}`).toBe(roles.includes(role));
      }
    }
    // The heads propose; the barista and chef under them, the retired
    // kitchen role and the till do not.
    for (const role of ['barista', 'chef', 'prep', 'cashier', 'court_desk', 'driver'] as const) {
      expect(can(role, 'startProtocolRelease'), role).toBe(false);
      expect(can(role, 'startProtocolPriceChange'), role).toBe(false);
    }
  });

  it('keeps launched prices and launching itself with the owner, never the manager (#51-#53)', () => {
    expect(can('manager', 'editLaunchedPrices')).toBe(false);
    expect(can('manager', 'launchDirectly')).toBe(false);
    expect(can('manager', 'editProtocols')).toBe(false);
    expect(can('manager', 'editChecklists')).toBe(false);
  });

  it('leaves a recipe change to the owner and ideas to the heads above the team (#65, #71)', () => {
    expect(can('manager', 'decideRecipeChanges')).toBe(false);
    for (const role of ['barista', 'assistant_barista', 'chef', 'prep', 'cashier', 'court_desk', 'driver', 'marketing', 'waiter'] as const) {
      expect(can(role, 'reviewIdeas'), role).toBe(false);
      expect(can(role, 'writeTeachings'), role).toBe(false);
    }
    expect(can('court_desk', 'startProtocolTournament')).toBe(true);
    expect(can('cashier', 'startProtocolTournament')).toBe(false);
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
