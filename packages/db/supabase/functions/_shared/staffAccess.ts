/**
 * Who may call a staff edge function: the pure rule behind requireStaffRole
 * (_shared/auth.ts), kept free of imports so tests/edge-staff-access.test.ts
 * runs it under Node.
 *
 * - Second jobs (0345 staff.extra_roles; F-18, 0383): a person holds their main
 *   role AND each second job, exactly as app.is_staff counts them, so a cashier
 *   who also works the court desk passes a ['court_desk', ...] guard.
 * - Blocked pages (0345 staff.blocked_areas; F-16, 0384): when the function is
 *   the work of named areas (packages/core/src/staff/access.ts ACCESS_AREAS)
 *   and the person has every one of them blocked, they are refused with
 *   AREA_BLOCKED, the same rule app.pre_request applies to the RPCs. An owner
 *   is never blocked.
 */

export interface StaffAccessRow {
  role: string;
  is_active: boolean;
  extra_roles?: readonly string[] | null;
  blocked_areas?: readonly string[] | null;
}

export type StaffAccessVerdict =
  | { ok: true; roles: string[] }
  | { ok: false; code: 'FORBIDDEN' | 'AREA_BLOCKED'; message: string };

/** Main role first, then each second job once; an owner is the owner alone. */
export function staffRolesOf(row: StaffAccessRow): string[] {
  if (row.role === 'owner') return ['owner'];
  const out = [row.role];
  for (const r of row.extra_roles ?? []) if (!out.includes(r)) out.push(r);
  return out;
}

export function judgeStaffAccess(
  row: StaffAccessRow | null | undefined,
  roles: readonly string[],
  areas: readonly string[] = [],
): StaffAccessVerdict {
  if (!row || !row.is_active) return { ok: false, code: 'FORBIDDEN', message: 'caller is not active staff' };
  const held = staffRolesOf(row);
  if (!held.some((r) => roles.includes(r))) {
    return { ok: false, code: 'FORBIDDEN', message: `role '${row.role}' not allowed` };
  }
  const blocked = row.role === 'owner' ? [] : (row.blocked_areas ?? []);
  if (areas.length > 0 && areas.every((a) => blocked.includes(a))) {
    return { ok: false, code: 'AREA_BLOCKED', message: 'this page is blocked for this person' };
  }
  return { ok: true, roles: held };
}
