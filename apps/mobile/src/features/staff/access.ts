/**
 * Blocked pages on the staff phone (0345 Staff Access; Majed, 2026-11-01,
 * finding F-16: "blocked pages are always blocked, no exceptions").
 *
 * The owner unticks pages per person on the operator's Staff page; the list is
 * `staff.blocked_areas`, keyed by the operator's ACCESS_AREAS
 * (packages/core/src/staff/access.ts). The phone has its own pages, so each
 * one names the operator areas that are the same work (STAFF_PAGE_AREAS), and
 * `pageBlocked` decides:
 *
 *   - a page that names no area is never blocked (Today, the person's own
 *     requests, rewards and work alerts, the owner's pages);
 *   - of the page's areas, the ones the person's jobs open on the operator
 *     count (AREA_ROLES, the operator's ROUTE_ROLES; second jobs included) —
 *     those are the only ones the owner's list can untick for them. When none
 *     of them is one their jobs open, every area of the page counts, so a
 *     block that is stored is never ignored;
 *   - the page is blocked when every area that counts is blocked. A manager
 *     whose Touch Shop is blocked still reads Stock (stock is open to them),
 *     a shop assistant whose Touch Shop is blocked does not.
 *
 * RequireStaff applies it on every staff screen (its `page` prop), so a row,
 * a push and a deep link all meet the same wall; Today and the group sheets
 * leave blocked rows out. An owner has no blocks (blockedAreasOf).
 *
 * The server refuses the RPCs behind a blocked area as well (LANE DB, F-16);
 * this is the screens' half.
 *
 * PURE (vitest).
 */
import {
  blockedAreasOf,
  rolesOf,
  type AccessArea,
  type StaffAccess,
  type StaffRole,
} from '@touch/core';

/**
 * Who opens each area on the operator: the roles of the area's first route
 * key in ROUTE_ROLES (apps/operator/src/lib/auth.tsx), the owner left out (an
 * owner is never blocked). __tests__/access.test.ts compares it with that file.
 */
export const AREA_ROLES = {
  till: ['cashier', 'manager'],
  desk: ['court_desk', 'manager'],
  customers: ['court_desk', 'cashier', 'manager'],
  tournaments: ['court_desk', 'manager'],
  kds: ['prep', 'head_barista', 'barista', 'assistant_barista', 'head_chef', 'chef', 'manager'],
  shop: ['shop_staff', 'manager'],
  tasks: [
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
  ],
  insights: ['marketing'],
  content: ['marketing'],
  incidents: ['court_desk', 'cashier', 'manager'],
  ops: ['manager'],
  stock: ['manager'],
  admin: ['manager'],
  reports: ['manager'],
  protocols: ['manager'],
  suggestions: ['manager'],
  deductions: ['manager'],
  attendance: ['manager'],
} as const satisfies Record<AccessArea, readonly StaffRole[]>;

const PROTOCOL_WORK = ['tasks', 'protocols'] as const;
const CHECKLISTS = ['tasks', 'ops'] as const;
const KITCHEN_BOOK = ['kds', 'admin'] as const;
const STOCK = ['stock', 'shop'] as const;
const FLOOR = ['till'] as const;

/**
 * Every staff page (app/staff.tsx, app/staff-group.tsx and each
 * app/(staff)/*.tsx, by file name) and the operator areas that are the same
 * work. __tests__/access.test.ts fails on a staff screen missing here, and on
 * a screen whose RequireStaff does not name its own page.
 */
export const STAFF_PAGE_AREAS = {
  // Today and its group sheet: the way in, never blocked.
  staff: [],
  'staff-group': [],
  // The person's own: requests, rewards, the work alerts page (which leaves
  // out the parts that open a blocked page) and the assistant.
  'staff-request': [],
  'staff-request-new': [],
  'staff-rewards': [],
  'staff-work': [],
  'staff-assistant': [],
  // The owner's alone (an owner has no blocks).
  'staff-activity': [],
  'staff-assistant-chats': [],
  'staff-rewards-admin': [],
  'staff-screenshots': [],
  // Protocols: "My tasks" on the operator for the front line, Protocols for management.
  'staff-runs': PROTOCOL_WORK,
  'staff-run': PROTOCOL_WORK,
  'staff-step': PROTOCOL_WORK,
  'staff-start': PROTOCOL_WORK,
  'staff-ideas': PROTOCOL_WORK,
  'staff-notes': PROTOCOL_WORK,
  // Checklists: "My tasks" for the front line, Operations for management.
  'staff-checklist': CHECKLISTS,
  'staff-checklist-history': CHECKLISTS,
  // The kitchen's own work and its book.
  'staff-production': ['kds', 'stock'],
  'staff-recipes': KITCHEN_BOOK,
  'staff-recipe-change': KITCHEN_BOOK,
  'staff-teachings': KITCHEN_BOOK,
  // Stock and buying.
  'staff-shopping': STOCK,
  'staff-purchase': STOCK,
  'staff-receipt': STOCK,
  'staff-stock': STOCK,
  'staff-stock-log': STOCK,
  'staff-stock-move': STOCK,
  'staff-stock-count': STOCK,
  // The floor: guest calls and orders feed the café cashier.
  'staff-calls': FLOOR,
  'staff-order': FLOOR,
  'staff-order-menu': FLOOR,
  'staff-order-item': FLOOR,
  'staff-order-review': FLOOR,
  'staff-order-slip': FLOOR,
  // The people records.
  'staff-incidents': ['incidents'],
  'staff-incident-report': ['incidents'],
  'staff-deductions': ['deductions'],
  'staff-deduction-propose': ['deductions'],
  'staff-suggestions': ['suggestions'],
  'staff-suggestion-new': ['suggestions'],
  // Marketing's work.
  'staff-content': ['content'],
  'staff-marketing': ['content'],
  'staff-marketing-requests': ['content'],
  'staff-marketing-request-new': ['content'],
} as const satisfies Record<string, readonly AccessArea[]>;

export type StaffPage = keyof typeof STAFF_PAGE_AREAS;

export function isStaffPage(value: unknown): value is StaffPage {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STAFF_PAGE_AREAS, value);
}

/** The page a staff href opens (`/staff-stock` → `staff-stock`), or null for anything else. */
export function staffPageOfHref(href: string): StaffPage | null {
  const page = href.replace(/^\//, '').split(/[?#]/)[0] ?? '';
  return isStaffPage(page) ? page : null;
}

/** True when the owner's blocks keep this person out of the page. */
export function pageBlocked(page: StaffPage, who: StaffAccess): boolean {
  const areas: readonly AccessArea[] = STAFF_PAGE_AREAS[page];
  if (areas.length === 0) return false;
  const blocked = blockedAreasOf(who);
  if (blocked.size === 0) return false;
  const roles = rolesOf(who);
  const theirs = areas.filter((area) =>
    (AREA_ROLES[area] as readonly StaffRole[]).some((role) => roles.includes(role)),
  );
  const counted = theirs.length > 0 ? theirs : areas;
  return counted.every((area) => blocked.has(area));
}

/** `pageBlocked` for an href; an href that is not a staff page is never blocked here. */
export function hrefBlocked(href: string, who: StaffAccess): boolean {
  const page = staffPageOfHref(href);
  return page !== null && pageBlocked(page, who);
}
