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

/**
 * True when the request carries the service-role key (cron / trusted server).
 *
 * Two shapes are accepted:
 *   1. byte-equal to this function's SUPABASE_SERVICE_ROLE_KEY env — the
 *      original test;
 *   2. a JWT whose `role` claim is `service_role`.
 *
 * Why (2) exists. app.push_nudge / app.telegram_nudge post the legacy 219-char
 * service-role JWT from Vault, and on 2026-09-06 every one of those calls was
 * answering 403 `forbidden` — 2,515 in a day — while the gateway (verify_jwt =
 * true for both functions, config.toml) had accepted the very same bearer as
 * validly signed. The key the platform injects into the function env is no
 * longer byte-equal to the key Vault holds (the project's key format moved on;
 * both remain valid), so a string compare is the wrong test. The `role` claim
 * is trusted here ONLY because the gateway has already verified the signature:
 * an unsigned or foreign token never reaches this code, the anon key carries
 * `role: anon` and a user session carries `role: authenticated`, and neither
 * passes. Do not deploy either caller with verify_jwt = false.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? '';
  if (auth === `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`) return true;
  if (!auth.startsWith('Bearer ')) return false;
  return jwtRole(auth.slice('Bearer '.length)) === 'service_role';
}

/** The `role` claim of a JWT payload, or null when the token does not parse. No signature work. */
export function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the calling user from the request's JWT (the gateway has already
 * verified the signature when verify_jwt is on). Returns null for the bare
 * anon/service keys or an unresolvable token.
 */
export async function getCallerUserId(
  req: Request,
  service: SupabaseClient,
): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const jwt = auth.slice('Bearer '.length);
  const { data, error } = await service.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}
