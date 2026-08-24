/**
 * e2e test harness for the LOCAL Supabase stack — mirrors the working patterns
 * in packages/db/tests/helpers.ts (service-role client, staff sign-in,
 * generate_table_token as owner, ensureOpenDay, ensureTillFresh).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

// Long-standing `supabase start` demo keys — LOCAL ONLY, no secret value.
// Never point these tests at a hosted project.
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

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);
}

export async function signedInClient(email: string, password: string = DEV_PASSWORD) {
  const c = createClient(SUPABASE_URL, ANON_KEY, clientOptions);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message} (run pnpm db:reset?)`);
  return c;
}

/** Call an app-schema RPC and throw on error. */
export async function appRpc<T = unknown>(
  c: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await c.schema('app').rpc(fn, args);
  if (error) throw new Error(`app.${fn} failed: ${error.message}`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Fixture ids (packages/db/fixtures — stable f1f7 prefix)
// ---------------------------------------------------------------------------
export function fixtureTableId(n: number): string {
  return `f1f70000-0000-4000-8000-00000000ab${String(n).padStart(2, '0')}`;
}

export const FIXTURE_COURTS_EN = [
  'Indoor Court 1',
  'Indoor Court 2',
  'Outdoor Court 1',
  'Outdoor Court 2',
] as const;

// ---------------------------------------------------------------------------
// Table tokens — app.generate_table_token requires manager/owner
// ---------------------------------------------------------------------------
export async function mintTableToken(tableId: string): Promise<string> {
  const owner = await signedInClient(SEED_STAFF.owner);
  try {
    return await appRpc<string>(owner, 'generate_table_token', { p_table_id: tableId });
  } finally {
    await owner.auth.signOut();
  }
}

// ---------------------------------------------------------------------------
// Day sessions — cafe orders require an open business day (0015)
// ---------------------------------------------------------------------------
export async function ensureOpenDay(svc: SupabaseClient): Promise<string> {
  const { data, error } = await svc
    .from('day_sessions')
    .select('id')
    .in('status', ['open', 'closing'])
    .limit(1);
  if (error) throw new Error(`ensureOpenDay probe failed: ${error.message}`);
  if (data && data.length > 0) return (data[0] as { id: string }).id;

  const manager = await signedInClient(SEED_STAFF.manager);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      // Unique far-future business_date (opaque to the till logic) so reruns
      // without a db reset never collide with a previously closed date.
      const days = 20_000 + Math.floor(Math.random() * 2_000_000);
      const date = new Date(days * 86_400_000).toISOString().slice(0, 10);
      const res = await appRpc<{ duplicate: boolean; day_session_id: string; status?: string }>(
        manager,
        'open_day',
        { p_opening_float_iqd: 100_000, p_business_date: date },
      );
      if (!res.duplicate || res.status === 'open') return res.day_session_id;
    }
    throw new Error('ensureOpenDay: could not find a free business_date');
  } finally {
    await manager.auth.signOut();
  }
}

/** Un-degrade the venue: refresh every TILL heartbeat (aborted degraded-mode
 *  experiments must never poison the e2e run). */
export async function ensureTillFresh(svc: SupabaseClient): Promise<void> {
  const { error } = await svc
    .from('device_heartbeats')
    .update({ last_seen_at: new Date().toISOString(), queue_depth: 0 })
    .like('device_id', 'TILL%');
  if (error) throw new Error(`ensureTillFresh failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Per-table cleanup so reruns are deterministic
// ---------------------------------------------------------------------------

/** Void any open/awaiting tab anchored on the table (till journey re-opens fresh). */
export async function voidOpenTabsForTable(svc: SupabaseClient, tableId: string): Promise<void> {
  const { error } = await svc
    .from('tabs')
    .update({ status: 'void' })
    .eq('table_id', tableId)
    .in('status', ['open', 'awaiting_payment']);
  if (error) throw new Error(`voidOpenTabsForTable failed: ${error.message}`);
}

/**
 * Wipe the table's waiter-call history: the raise cooldown looks at
 * max(raised_at) over ALL calls (open or resolved), so a rerun within the
 * cooldown window would otherwise start with CALL_COOLDOWN.
 */
export async function clearWaiterCalls(svc: SupabaseClient, tableId: string): Promise<void> {
  const { error } = await svc.from('waiter_calls').delete().eq('table_id', tableId);
  if (error) throw new Error(`clearWaiterCalls failed: ${error.message}`);
}

/**
 * Latest guest order (+ ticket) placed on a table.
 *
 * NOTE: in dev, React StrictMode double-mounts the CafeApp boot effect, so a
 * single page load creates TWO anonymous users / live guest sessions a few ms
 * apart — "latest session" is not deterministic. Scanning the orders of ALL
 * live sessions on the table is.
 */
export async function latestOrderForTable(
  svc: SupabaseClient,
  tableId: string,
): Promise<{ orderId: string; ticketId: string; guestSessionId: string }> {
  const { data: sessions, error: sErr } = await svc
    .from('guest_sessions')
    .select('id')
    .eq('table_id', tableId)
    .is('closed_at', null);
  if (sErr) throw new Error(`latestOrderForTable sessions failed: ${sErr.message}`);
  const ids = (sessions ?? []).map((s) => (s as { id: string }).id);
  if (ids.length === 0) throw new Error('latestOrderForTable: no live session on table');

  const { data, error } = await svc
    .from('orders')
    .select('id, guest_session_id, tickets(id)')
    .in('guest_session_id', ids)
    .order('placed_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestOrderForTable failed: ${error.message}`);
  const row = data?.[0] as
    | { id: string; guest_session_id: string; tickets: { id: string } | { id: string }[] | null }
    | undefined;
  // tickets(id) embeds as a single object (one ticket per order), but stay
  // tolerant of the array shape too.
  const ticket = Array.isArray(row?.tickets) ? row?.tickets[0] : row?.tickets;
  if (!row || !ticket) throw new Error('no order/ticket found for table');
  return { orderId: row.id, ticketId: ticket.id, guestSessionId: row.guest_session_id };
}

/** Open waiter call on a table (raised or acknowledged). */
export async function openWaiterCall(
  svc: SupabaseClient,
  tableId: string,
): Promise<{ id: string }> {
  const { data, error } = await svc
    .from('waiter_calls')
    .select('id')
    .eq('table_id', tableId)
    .in('status', ['raised', 'acknowledged'])
    .order('raised_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`openWaiterCall failed: ${error.message}`);
  if (!data?.length) throw new Error('openWaiterCall: no open call on table');
  return data[0] as { id: string };
}
