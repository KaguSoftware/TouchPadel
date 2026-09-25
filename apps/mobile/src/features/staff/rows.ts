/**
 * The rows on Today, by role (build-contracts-2026-09-23 §6.1, "Today rows by
 * role"). Each row opens one staff page; the list a role sees is `staffRows`.
 *
 * A row lands in the same commit as its screen: __tests__/rows.test.ts fails
 * on a row whose `href` has no file under app/, which is the routes.test.ts
 * rule for a literal push carried over to rows, whose pushes are not literal.
 * The page lanes append their rows here, in the table's column order
 * (protocols, start, production, shopping, purchases, marketing, requests,
 * notes).
 *
 * PURE (vitest).
 */
import type { StaffRole } from '@touch/core';
import type { MessageKey } from '@touch/i18n';

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
  // Every role asks for leave, a swap, an advance or a correction here (0072).
  // The owner reads the requests on this page and decides them on the
  // operator only (plan #16, #56), which the page says.
  {
    id: 'requests',
    testID: 'staff.requests',
    href: '/staff-request',
    labelKey: 'staff.shell.requests.row',
  },
];

export function staffRows(role: StaffRole): StaffRowDef[] {
  return STAFF_ROW_DEFS.filter((row) => !row.roles || row.roles.includes(role));
}
