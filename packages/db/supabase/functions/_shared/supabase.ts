/**
 * Shared Supabase clients for edge functions.
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected by the
 * platform on deploy (and by `supabase functions serve` locally) — never hardcode.
 * The service client bypasses RLS: it exists ONLY inside edge functions (design-arch §7).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function createServiceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True when the request carries the service-role key itself (cron / trusted server). */
export function isServiceRoleRequest(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? '';
  return auth === `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`;
}

/**
 * Resolve the calling user from the request's JWT (the gateway has already
 * verified the signature when verify_jwt is on). Returns null for the bare
 * anon/service keys or an unresolvable token.
 */
export async function getCallerUserId(req: Request, service: SupabaseClient): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const jwt = auth.slice('Bearer '.length);
  const { data, error } = await service.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}
