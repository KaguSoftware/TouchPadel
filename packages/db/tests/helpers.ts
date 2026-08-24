/**
 * Shared test harness for the local Supabase stack.
 *
 * Env (falls back to `supabase start` local defaults):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

// Long-standing `supabase start` demo keys (local only — no secret value).
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const DEV_PASSWORD = 'touch-dev-password';
export const SEED_STAFF = {
  owner: 'owner@dev.touch.local',
  manager: 'manager@dev.touch.local',
  cashier: 'cashier@dev.touch.local',
  prep: 'prep@dev.touch.local',
  court_desk: 'desk@dev.touch.local',
} as const;
export const DEV_PINS = { owner: '111111', manager: '222222' } as const;

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, clientOptions);
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);
}

/** True when the local stack answers; suites skip themselves otherwise. */
export async function stackAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: ANON_KEY },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function signedInClient(email: string, password: string = DEV_PASSWORD) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message} (run pnpm db:reset?)`);
  return c;
}

export async function anonymousSessionClient() {
  const c = anonClient();
  const { error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  return c;
}

let guestCounter = 0;
/** Creates (idempotently) and signs in a throwaway guest account. */
export async function guestClient(svc: SupabaseClient, tag: string) {
  const email = `guest-${tag}-${guestCounter++}-${Date.now()}@test.touch.local`;
  const { error } = await svc.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Test Guest ${tag}` },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return signedInClient(email);
}

/** Call an app-schema RPC. */
export function appRpc(c: SupabaseClient, fn: string, args: Record<string, unknown>) {
  return c.schema('app').rpc(fn, args);
}

/** Idempotency key per resolved override #2: "{station}:{mutation_type}:{ulid}". */
export function testIdemKey(mutationType: string): string {
  const pseudoUlid = crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26);
  return `TEST1:${mutationType}:${pseudoUlid}`;
}

/** Create an isolated active court (service role bypasses RLS). */
export async function createTestCourt(svc: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await svc
    .from('courts')
    .insert({
      name_en: name,
      name_ar: `ملعب اختبار ${name}`,
      indoor: true,
      duration_options: [60, 90, 120],
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestCourt failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Ensure an all-day, all-week rate rule exists so price_slot always resolves —
 * concurrency tests must not depend on optional fixtures.
 */
export async function ensureTestRateRule(svc: SupabaseClient): Promise<void> {
  const { data } = await svc.from('rate_rules').select('id').eq('name', 'TEST all-day').limit(1);
  if (data && data.length > 0) return;
  const { data: rule, error } = await svc
    .from('rate_rules')
    .insert({
      name: 'TEST all-day',
      court_id: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time: '00:00',
      end_time: '23:59:59',
      priority: -100, // never beats a real fixture rule
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`ensureTestRateRule failed: ${error.message}`);
  const ruleId = (rule as { id: string }).id;
  const { error: pErr } = await svc.from('rate_rule_prices').insert(
    [60, 90, 120].map((d) => ({ rule_id: ruleId, duration_min: d, price_iqd: 40_000 })),
  );
  if (pErr) throw new Error(`ensureTestRateRule prices failed: ${pErr.message}`);
}

let slotCounter = 0;
/** A unique future slot (each call gets its own day+hour so tests never collide). */
export function futureSlot(hoursFromMidnightUtc = 10): { start: Date; plus: (min: number) => Date } {
  const day = 7 + Math.floor(slotCounter / 12);
  const hour = hoursFromMidnightUtc + (slotCounter % 12);
  slotCounter++;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + day);
  start.setUTCHours(hour, 0, 0, 0);
  return { start, plus: (min: number) => new Date(start.getTime() + min * 60_000) };
}

export interface RpcOutcome {
  ok: boolean;
  duplicate?: boolean;
  errorMessage?: string;
  data?: unknown;
}

export function outcome(res: { data: unknown; error: { message: string } | null }): RpcOutcome {
  if (res.error) return { ok: false, errorMessage: res.error.message };
  const d = res.data as { duplicate?: boolean } | null;
  return { ok: true, duplicate: d?.duplicate, data: res.data };
}
