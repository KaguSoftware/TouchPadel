/**
 * staff-admin — the role check for a new account. PURE: no `Deno.*`, no
 * supabase-js, no fetch, so it runs unchanged under Deno (index.ts) and under
 * vitest (tests/staff-admin.test.ts), the same arrangement as
 * desk-customer-create/phone.ts.
 *
 * It is the only server wall between the owner and a new prep account: the
 * database still admits prep everywhere (0156), so an account created on it
 * would simply work. Keep the retired test ahead of the general one, or a
 * prep create reads as "no such role" instead of naming barista and chef.
 */

/**
 * Every role a new account can start on; 0155 added the six after court_desk,
 * wave 5 the assistant barista and the waiter (the owner creates Hussein's and
 * Hasan's accounts, wave5-addendum-2026-09-25 §2.1.6).
 */
export const ROLES = [
  'cashier',
  'court_desk',
  'head_barista',
  'barista',
  'head_chef',
  'chef',
  'driver',
  'marketing',
  'assistant_barista',
  'waiter',
  'manager',
  'owner',
] as const;

/** Still a staff_role, and every guard still admits it, but never a new account's. */
export const RETIRED_ROLES = ['prep'] as const;

export type CreateRole = (typeof ROLES)[number];

export type RoleCheck =
  | { ok: true; role: CreateRole }
  | { ok: false; error: 'ROLE_RETIRED' | 'BAD_REQUEST'; message: string };

/**
 * `role` is the untrusted body field. Exact match only: 'prep ' or 'Prep' is
 * not a role at all, so it is a bad request, not a retired one.
 */
export function checkCreateRole(role: unknown): RoleCheck {
  if (typeof role === 'string' && (RETIRED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: 'ROLE_RETIRED', message: `${role} is retired: create the account as barista or chef instead` };
  }
  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: 'BAD_REQUEST', message: `role must be one of ${ROLES.join(', ')}` };
  }
  return { ok: true, role: role as CreateRole };
}
