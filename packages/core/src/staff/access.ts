/**
 * Per-person access on top of the role (0345): the owner's two lists on the
 * Staff page.
 *
 * - **Second jobs** (`staff.extra_roles`). A cashier who also runs the court
 *   desk holds `court_desk` as a second job. The server counts it everywhere a
 *   guard asks `app.is_staff(...)`, so the desk's RPCs open for them exactly as
 *   they do for a desk clerk. Only the front-line jobs below can be a second
 *   job: management and the team heads carry approval powers (PIN approvals,
 *   deductions, decisions) that a tick must never hand out, and an owner is
 *   never made by a tick either.
 * - **Blocked pages** (`staff.blocked_areas`). A page the person's jobs open
 *   that the owner has unticked. The operator and the staff phone keep them
 *   out of it (rail, section homes, the route guard). This is the screens'
 *   wall only: the role's RPCs still answer, so a block is "not on this
 *   person's screens", not a server refusal.
 *
 * An owner account has neither: owners open everything, and the RPC refuses to
 * set either list on one.
 */
import type { StaffRole } from './roles';

/**
 * The jobs a person can hold as a second job, in the picker's order. The SQL
 * twin is the `staff_extra_roles_chk` CHECK and `app.set_staff_access` (0345);
 * `packages/db/tests/staff-access.test.ts` compares them.
 */
export const SECOND_JOB_ROLES = [
  'cashier',
  'waiter',
  'court_desk',
  'shop_staff',
  'barista',
  'chef',
  'driver',
  'marketing',
] as const satisfies readonly StaffRole[];

export type SecondJobRole = (typeof SECOND_JOB_ROLES)[number];

export function isSecondJobRole(value: unknown): value is SecondJobRole {
  return typeof value === 'string' && (SECOND_JOB_ROLES as readonly string[]).includes(value);
}

/**
 * The pages an owner can block, each owning one or more operator route keys
 * (the keys of `ROUTE_ROLES` in apps/operator/src/lib/auth.tsx). A route is
 * blocked when the route key it resolves to belongs to a blocked area, so
 * blocking Court desk leaves Customers alone: '/desk/customers' is its own key.
 * Owner-only keys are not here (an owner account cannot be blocked), and
 * '/workspaces' is the picker, not a page. The operator's auth test fails when
 * a key a non-owner can open has no area.
 */
export const ACCESS_AREAS = {
  till: ['/till'],
  desk: ['/desk'],
  customers: ['/desk/customers', '/desk/customers/new'],
  tournaments: ['/desk/tournaments'],
  kds: ['/kds'],
  shop: ['/shop'],
  tasks: ['/tasks'],
  // The marketing role's Insights page (0360).
  insights: ['/insights'],
  incidents: ['/incidents'],
  ops: ['/ops'],
  stock: ['/stock'],
  admin: ['/admin'],
  reports: ['/reports'],
  protocols: ['/protocols'],
  suggestions: ['/suggestions'],
  deductions: ['/deductions'],
  attendance: ['/attendance'],
} as const satisfies Record<string, readonly string[]>;

export type AccessArea = keyof typeof ACCESS_AREAS;

/** Every area, in the order the Staff page lists them. */
export const ACCESS_AREA_KEYS = Object.keys(ACCESS_AREAS) as AccessArea[];

export function isAccessArea(value: unknown): value is AccessArea {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACCESS_AREAS, value);
}

/** The area that owns a route key, or null for a key no area owns. */
export function areaOfRouteKey(key: string): AccessArea | null {
  for (const area of ACCESS_AREA_KEYS) {
    if ((ACCESS_AREAS[area] as readonly string[]).includes(key)) return area;
  }
  return null;
}

/** What the apps need to decide access: the main role, the second jobs and the blocks. */
export interface StaffAccess {
  role: StaffRole;
  extraRoles?: readonly StaffRole[];
  blockedAreas?: readonly AccessArea[];
}

/** Main role first, then each second job once. An owner's list is the owner alone. */
export function rolesOf(who: StaffAccess): readonly StaffRole[] {
  if (who.role === 'owner' || !who.extraRoles?.length) return [who.role];
  return [who.role, ...who.extraRoles.filter((r, i, all) => r !== who.role && all.indexOf(r) === i)];
}

/** The blocks that apply: none for an owner. */
export function blockedAreasOf(who: StaffAccess): ReadonlySet<AccessArea> {
  if (who.role === 'owner' || !who.blockedAreas?.length) return new Set();
  return new Set(who.blockedAreas);
}

/**
 * Read the two columns of a staff row, keeping only values this build knows.
 * A newer database may hold a job or an area this build has never heard of;
 * dropping it means this app neither offers nor applies it, and the server
 * (which knows it) still does.
 */
export function parseStaffAccess(row: { extra_roles?: unknown; blocked_areas?: unknown }): {
  extraRoles: SecondJobRole[];
  blockedAreas: AccessArea[];
} {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    extraRoles: list(row.extra_roles).filter(isSecondJobRole),
    blockedAreas: list(row.blocked_areas).filter(isAccessArea),
  };
}
