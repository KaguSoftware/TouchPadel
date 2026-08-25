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
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getCallerUserId } from './supabase.ts';
import { json } from './http.ts';

export type StaffRole = 'cashier' | 'prep' | 'court_desk' | 'manager' | 'owner';

export interface StaffCaller {
  userId: string;
  role: StaffRole;
}

export async function requireStaffRole(
  req: Request,
  service: SupabaseClient,
  roles: readonly string[],
): Promise<StaffCaller | Response> {
  const userId = await getCallerUserId(req, service);
  if (!userId) return json({ error: 'AUTH_REQUIRED', message: 'staff session required' }, 401);

  const { data, error } = await service
    .from('staff')
    .select('id, role, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error) return json({ error: 'INTERNAL', message: error.message }, 500);
  if (!data || !data.is_active) {
    return json({ error: 'FORBIDDEN', message: 'caller is not active staff' }, 403);
  }
  const role = String(data.role) as StaffRole;
  if (!roles.includes(role)) {
    return json({ error: 'FORBIDDEN', message: `role '${role}' not allowed` }, 403);
  }
  return { userId, role };
}
