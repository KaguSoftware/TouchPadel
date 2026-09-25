/**
 * The rows on Today, by role (build-contracts-2026-09-23 §6.1, "Today rows by
 * role" and "Role-spec rows"). Each row opens one staff page; the list a role
 * sees is `staffRows`.
 *
 * A row lands in the same commit as its screen: __tests__/rows.test.ts fails
 * on a row whose `href` has no file under app/, which is the routes.test.ts
 * rule for a literal push carried over to rows, whose pushes are not literal.
 * The page lanes append their rows here, in the tables' column order
 * (protocols, start, production, shopping, purchases, marketing, requests,
 * notes; then ideas, teachings, recipes, stock, suggestions, ask marketing).
 *
 * A row's roles are its screen's own gate (the constant its `RequireStaff`
 * takes), so Today never offers a page that would send the person back.
 * __tests__/rowsByRole.test.ts pins what each role sees.
 *
 * PURE (vitest).
 */
import { STAFF_ROLES, type StaffRole } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { IDEA_ROLES, START_ROLES } from './protocols/logic';
import { PRODUCTION_ROLES } from './supplies/production';
import { PURCHASE_ROLES, SHOPPING_ROLES } from './supplies/logic';
import { TEACHING_ROLES } from './teachings/logic';
import { RECIPE_CHANGE_ROLES, RECIPE_ROLES } from './recipes/logic';
import { STOCK_ROLES } from './stock/logic';

export interface StaffRowDef {
  /** Stable name of the row. */
  id: string;
  /** `staff.row.<id>` (§6.3), or the route's own primary id for the requests row. */
  testID: string;
  /** The page the row opens: a flat root-stack screen `app/staff-*.tsx`. */
  href: `/staff-${string}`;
  labelKey: MessageKey;
  /** The roles that see the row; left out, every staff role. */
  roles?: readonly StaffRole[];
}

export const STAFF_ROW_DEFS: readonly StaffRowDef[] = [
  // Involved runs for everyone, every run for management (staff-runs.tsx).
  {
    id: 'protocols',
    testID: 'staff.row.protocols',
    href: '/staff-runs',
    labelKey: 'staff.protocols.runs.title',
  },
  // The roles with at least one kind to start (§2.7): the heads, management,
  // marketing (price/promo) and the court desk (tournament, #67).
  {
    id: 'start',
    testID: 'staff.row.start',
    href: '/staff-start',
    labelKey: 'staff.protocols.runs.start',
    roles: START_ROLES,
  },
  {
    id: 'production',
    testID: 'staff.row.production',
    href: '/staff-production',
    labelKey: 'staff.checklists.production.title',
    roles: PRODUCTION_ROLES,
  },
  // The bar and kitchen family and management read and add; the driver gets
  // the same page as the run checklist, under its own row (#70).
  {
    id: 'shopping',
    testID: 'staff.row.shopping',
    href: '/staff-shopping',
    labelKey: 'staff.supplies.rows.shopping',
    roles: SHOPPING_ROLES.filter((role) => role !== 'driver'),
  },
  {
    id: 'run',
    testID: 'staff.row.run',
    href: '/staff-shopping',
    labelKey: 'staff.supplies.rows.run',
    roles: ['driver'],
  },
  {
    id: 'purchases',
    testID: 'staff.row.purchases',
    href: '/staff-purchase',
    labelKey: 'staff.supplies.rows.purchases',
    roles: PURCHASE_ROLES,
  },
  {
    id: 'marketing',
    testID: 'staff.row.marketing',
    href: '/staff-marketing',
    labelKey: 'staff.marketing.rows.marketing',
    roles: ['marketing'],
  },
  // Every role asks for leave, a swap, an advance or a correction here (0072),
  // and the page opens on leave, so the row reads "Vacation and requests"
  // (#62). The owner reads the requests on this page and decides them on the
  // operator only (plan #16, #56), which the page says.
  {
    id: 'requests',
    testID: 'staff.requests',
    href: '/staff-request',
    labelKey: 'staff.checklists.vacation.row',
  },
  // Notes on new items in their first 30 days (Q9): every role.
  {
    id: 'notes',
    testID: 'staff.row.notes',
    href: '/staff-notes',
    labelKey: 'staff.notes.title',
  },
  // Role spec (plan #61–#74).
  // A barista's or chef assistant's ideas go to their head; the heads and
  // management review them (#65).
  {
    id: 'ideas',
    testID: 'staff.row.ideas',
    href: '/staff-ideas',
    labelKey: 'staff.protocols.ideas.title',
    roles: IDEA_ROLES,
  },
  {
    id: 'teachings',
    testID: 'staff.row.teachings',
    href: '/staff-teachings',
    labelKey: 'staff.checklists.teachings.title',
    roles: TEACHING_ROLES,
  },
  // Names only, never a quantity (#72, parked P3).
  {
    id: 'recipes',
    testID: 'staff.row.recipes',
    href: '/staff-recipes',
    labelKey: 'staff.checklists.recipes.title',
    roles: RECIPE_ROLES,
  },
  // The heads ask, the owner decides, the manager reads (#71). Its own row so
  // the owner reaches a waiting decision from Today, where the
  // recipe_change_submitted push lands.
  {
    id: 'recipe-changes',
    testID: 'staff.row.recipe-changes',
    href: '/staff-recipe-change',
    labelKey: 'staff.checklists.recipeChange.title',
    roles: RECIPE_CHANGE_ROLES,
  },
  // Quantities only (#68): the heads read the cafe, the desk the shop,
  // management everything.
  {
    id: 'stock',
    testID: 'staff.row.stock',
    href: '/staff-stock',
    labelKey: 'staff.checklists.stock.title',
    roles: STOCK_ROLES,
  },
  // Everyone posts (#63).
  {
    id: 'suggestions',
    testID: 'staff.row.suggestions',
    href: '/staff-suggestions',
    labelKey: 'staff.checklists.suggestions.title',
  },
  // Requests to marketing (#73): every role but marketing asks, and
  // marketing answers from its inbox on the same page.
  {
    id: 'ask-marketing',
    testID: 'staff.row.ask-marketing',
    href: '/staff-marketing-requests',
    labelKey: 'staff.marketing.rows.ask',
    roles: STAFF_ROLES.filter((role) => role !== 'marketing'),
  },
  {
    id: 'marketing-inbox',
    testID: 'staff.row.marketing-inbox',
    href: '/staff-marketing-requests',
    labelKey: 'staff.marketing.rows.inbox',
    roles: ['marketing'],
  },
];

export function staffRows(role: StaffRole): StaffRowDef[] {
  return STAFF_ROW_DEFS.filter((row) => !row.roles || row.roles.includes(role));
}
