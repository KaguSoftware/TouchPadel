/**
 * Staff-role guard for edge functions that proxy third-party APIs (PostHog,
 * Groq) on behalf of the owner. Resolves the caller from the request JWT
 * (`getCallerUserId`), then checks `staff` (must be `is_active` and hold one
 * of `roles`). Returns a ready-to-send JSON Response on failure so callers can
 * `if (auth instanceof Response) return auth;`.
 *
 * Statuses line up with apps/operator/src/lib/edge.ts `statusToEdgeCode`:
 *   401 {error:'AUTH_REQUIRED'}  — no/invalid session JWT
 *   403 {error:'FORBIDDEN'}      — not active staff, or role not allowed
 *   403 {error:'AREA_BLOCKED'}   — the owner blocked every page this work
 *                                  belongs to (`opts.areas`, 0384, F-16)
 * Each body is { error, message, code } with `code` equal to `error`
 * (2026-11-09, like the assistant handlers' refusals).
 *
 * A second job counts like the main role (0345 staff.extra_roles; F-18): the
 * rule is `judgeStaffAccess` in ./staffAccess.ts, tested under Node.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getCallerUserId } from './supabase.ts';
import { json, logError } from './http.ts';
import { judgeStaffAccess } from './staffAccess.ts';

export type StaffRole =
  | 'cashier'
  | 'prep'
  | 'court_desk'
  | 'manager'
  | 'owner'
  // 0155: the bar and kitchen roles that replace prep, and driver and marketing.
  | 'head_barista'
  | 'barista'
  | 'head_chef'
  | 'chef'
  | 'driver'
  | 'marketing'
  // Wave 5 (wave5-addendum-2026-09-25 §2.1): the assistant barista and the waiter.
  | 'assistant_barista'
  | 'waiter'
  // Touch Shop own desk (0243).
  | 'shop_staff'
  // 0392: the developer, who reads the Monitoring page (0393) and nothing else.
  | 'dev';

export interface StaffCaller {
  userId: string;
  /** The main role. */
  role: StaffRole;
  /** The main role, then each second job (0345); an owner is the owner alone. */
  roles: StaffRole[];
}

export interface StaffRoleOptions {
  /**
   * The ACCESS_AREAS keys (packages/core/src/staff/access.ts) whose pages do
   * this work. A person who has all of them blocked is refused AREA_BLOCKED.
   */
  areas?: readonly string[];
}

export async function requireStaffRole(
  req: Request,
  service: SupabaseClient,
  roles: readonly string[],
  opts: StaffRoleOptions = {},
): Promise<StaffCaller | Response> {
  const userId = await getCallerUserId(req, service);
  if (!userId) return json({ error: 'AUTH_REQUIRED', message: 'staff session required', code: 'AUTH_REQUIRED' }, 401);

  const { data, error } = await service
    .from('staff')
    .select('id, role, is_active, extra_roles, blocked_areas')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // The staff read failed: the caller gets the code, the log gets the text.
    logError('auth', error, 'staff lookup');
    return json({ error: 'INTERNAL' }, 500);
  }
  const verdict = judgeStaffAccess(
    data
      ? {
          role: String(data.role),
          is_active: Boolean(data.is_active),
          extra_roles: (data.extra_roles as string[] | null) ?? [],
          blocked_areas: (data.blocked_areas as string[] | null) ?? [],
        }
      : null,
    roles,
    opts.areas ?? [],
  );
  if (!verdict.ok) return json({ error: verdict.code, message: verdict.message, code: verdict.code }, 403);
  return { userId, role: String(data!.role) as StaffRole, roles: verdict.roles as StaffRole[] };
}
