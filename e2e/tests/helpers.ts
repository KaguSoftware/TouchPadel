/**
 * e2e test harness for the LOCAL Supabase stack — mirrors the working patterns
 * in packages/db/tests/helpers.ts (service-role client, staff sign-in,
 * generate_table_token as owner, ensureOpenDay, ensureTillFresh).
 */
import { expect, type Locator, type Page } from '@playwright/test';
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

/**
 * Pick an option in a dropdown, native or not. The operator's dropdowns are
 * `Select` (components/ui.tsx), a combobox with its own popup rather than a
 * native <select>, so `selectOption()` refuses them. A string picks by value
 * (the option's data-value, which reads the same in both locales); `{ label }`
 * picks by the visible text, as selectOption() did.
 */
export async function choose(select: Locator, option: string | { label: string }): Promise<void> {
  if ((await select.evaluate((el) => el.tagName)) === 'SELECT') {
    await select.selectOption(option);
    return;
  }
  // A grouped list writes its group ahead of the label ("Cafe · Beans"), where
  // a native <optgroup> kept it out of the option: the label still matches.
  const escaped = typeof option === 'string' ? '' : option.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Already showing it — a form with one choice starts on it, as a native
  // select would, and selectOption() was a no-op there too.
  if (typeof option !== 'string' && new RegExp(`^(?:.+ · )?${escaped}$`).test((await select.innerText()).trim())) return;
  const list = select.page().getByRole('listbox');
  // A click that lands while the dialog is still settling can leave the popup
  // shut; open it until it is open rather than waiting on one that never came.
  await expect(async () => {
    if (!(await list.isVisible())) await select.click();
    await expect(list).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const item =
    typeof option === 'string'
      ? list.locator(`[role="option"][data-value="${option}"]`)
      : list.getByRole('option', { name: new RegExp(`^(?:.+ · )?${escaped}$`) });
  await item.click();
  await list.waitFor({ state: 'hidden' });
}

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

/**
 * Every court the desk calendar should show. The fixture dropped its two
 * invented outdoor courts on 2026-09-03 to match the venue's real two — see the
 * COURT COUNT note in packages/db/fixtures/courts.sql.
 */
export const FIXTURE_COURTS_EN = ['Indoor Court 1', 'Indoor Court 2'] as const;

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

/**
 * Un-degrade the venue: refresh every till heartbeat (aborted degraded-mode
 * experiments must never poison the e2e run).
 *
 * The filter MUST mirror `app.is_degraded()`, which counts a row as a till when
 * `is_till` is set OR the id starts with TILL. Matching on the name alone
 * silently updated ZERO rows once the seeds moved to `REG-01` (is_till = true),
 * so the venue stayed degraded and guest ordering was refused mid-journey.
 * With no till row at all, seed one: `is_degraded()` is false in that state, but
 * the till screens still expect a heartbeat to exist.
 */
export async function ensureTillFresh(svc: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await svc
    .from('device_heartbeats')
    .update({ last_seen_at: now, queue_depth: 0 })
    .or('is_till.eq.true,device_id.like.TILL%')
    .select('device_id');
  if (error) throw new Error(`ensureTillFresh failed: ${error.message}`);
  if (data && data.length > 0) return;

  // Since 0229 a heartbeat row belongs to a live, registered station (a
  // heartbeat never registers one), so the seeded till is registered first,
  // the way a manager does in Settings > Stations.
  const { data: venue, error: vErr } = await svc
    .from('venues')
    .select('id')
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .single();
  if (vErr) throw new Error(`ensureTillFresh venue failed: ${vErr.message}`);
  const { error: stErr } = await svc
    .from('stations')
    .upsert(
      { id: 'TILL-E2E', venue_id: (venue as { id: string }).id, is_till: true, mode: 'till', retired_at: null },
      { onConflict: 'id' },
    );
  if (stErr) throw new Error(`ensureTillFresh station failed: ${stErr.message}`);

  const { error: insErr } = await svc
    .from('device_heartbeats')
    .upsert(
      { device_id: 'TILL-E2E', last_seen_at: now, queue_depth: 0, is_till: true },
      { onConflict: 'device_id' },
    );
  if (insErr) throw new Error(`ensureTillFresh seed failed: ${insErr.message}`);
}

/**
 * Top up FIXTURE ingredients that reruns have eaten. The stock fixtures give
 * finite quantities and every guest-journey order deducts through the 0018
 * trigger — after enough reruns without a db reset an ingredient (Geymar was
 * the first) hits 0, the SOW L370-371 auto-greying correctly marks its items
 * unavailable, and the journey dies on a sold-out card. Restock through the
 * real RPC so batches and ledger stay coherent.
 */
export async function ensureFixtureStock(svc: SupabaseClient, min = 100): Promise<void> {
  const { data, error } = await svc
    .from('v_ingredient_on_hand')
    .select('ingredient_id, on_hand, kind')
    .eq('is_active', true);
  if (error) throw new Error(`ensureFixtureStock probe failed: ${error.message}`);
  const low = (data as { ingredient_id: string; on_hand: number; kind: string }[]).filter(
    // uuid columns refuse `like` — filter the fixture prefix client-side.
    (r) =>
      r.ingredient_id.startsWith('f1f7') && r.kind === 'purchased' && Number(r.on_hand) < min,
  );
  if (low.length === 0) return;

  const manager = await signedInClient(SEED_STAFF.manager);
  try {
    await appRpc(manager, 'receive_delivery', {
      p_lines: low.map((r) => ({
        ingredient_id: r.ingredient_id,
        qty_received: 1000,
        unit_cost_iqd: 10,
      })),
      p_supplier_name: 'e2e-restock',
    });
  } finally {
    await manager.auth.signOut();
  }

  // The guest SSR menu is unstable_cache'd for 60 s (menu.server.ts) and a
  // restock changes availability SILENTLY (a view over batches — no
  // menu_changed broadcast). A page served inside that window still stamps the
  // item sold out. This waits the window out — and only runs on the rare pass
  // where something was actually restocked; steady-state runs skip it.
  console.log(`[e2e] restocked ${low.length} fixture ingredient(s); waiting out the 60s menu cache`);
  await new Promise((resolve) => setTimeout(resolve, 61_000));
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

// ---------------------------------------------------------------------------
// Anonymous guest sessions — the same two calls the web app makes on scan
// ---------------------------------------------------------------------------

/**
 * Mint a token for `tableId`, then bind it from a fresh ANONYMOUS client, which
 * is the only principal `app.create_guest_order` accepts (it reads the session
 * from auth.uid(), never from an argument). Use this to fabricate guest orders
 * for staff-side tests without driving the browser.
 */
export async function openGuestSession(
  tableId: string,
): Promise<{ client: SupabaseClient; sessionId: string; token: string }> {
  const token = await mintTableToken(tableId);
  const client = createClient(SUPABASE_URL, ANON_KEY, clientOptions);
  const { error: authErr } = await client.auth.signInAnonymously();
  if (authErr) throw new Error(`anonymous sign-in failed: ${authErr.message}`);
  const opened = await appRpc<{ session_id: string }>(client, 'open_table_session', {
    p_token: token,
  });
  return { client, sessionId: opened.session_id, token };
}

/**
 * Keep the venue OUT of degraded mode for the whole of a long test.
 *
 * `venue_settings.heartbeat_stale_seconds` is 45s and `app.is_degraded()` blocks
 * guest ordering the moment the last TILL heartbeat ages past it. A real till
 * beats continuously; a test that runs longer than 45s must do the same, or the
 * basket comes back "Online ordering is temporarily paused" halfway through.
 *
 * Returns a stop function — always call it in `afterAll`/`finally`, otherwise
 * the interval keeps the Playwright worker alive.
 */
export function startTillHeartbeat(svc: SupabaseClient, everyMs = 15_000): () => void {
  let stopped = false;
  const beat = () => {
    if (stopped) return;
    void ensureTillFresh(svc).catch(() => {
      /* a transient failure just means the next beat covers it */
    });
  };
  const timer = setInterval(beat, everyMs);
  beat();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ---------------------------------------------------------------------------
// Realtime: wait for a broadcast subscription instead of racing it
// ---------------------------------------------------------------------------

/**
 * Resolve once a page has actually JOINED a broadcast topic.
 *
 * A broadcast fired before the join lands is simply not delivered, and the
 * guest app's other refetch triggers (`online`, visibility) never fire in a
 * headless run — so a test that writes immediately after `goto` fails for
 * timing reasons that say nothing about the product. Call this BEFORE
 * `page.goto` so the websocket listener is attached in time, then await it.
 *
 * React StrictMode double-mounts in dev, so the first channel leaves and
 * re-joins — settle briefly after the first successful reply.
 */
export function channelJoined(page: Page, topic = 'menu'): Promise<void> {
  return new Promise<void>((resolve) => {
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/realtime/v1/websocket')) return;
      ws.on('framereceived', (frame) => {
        const payload = String(frame.payload);
        if (payload.includes(`realtime:${topic}`) && payload.includes('"status":"ok"')) resolve();
      });
    });
  }).then(() => page.waitForTimeout(1_000));
}

// ---------------------------------------------------------------------------
// Till shifts (wave5-addendum-2026-09-25 §5.1, §8 Q30): a cashier's or the
// desk's first payment at a station asks for a shift of their own first.
// ---------------------------------------------------------------------------

/**
 * Call right after pressing Cash or Card. When the payment pane asks for a
 * shift ("Start my shift"), take what the drawer is offered as counted with
 * "That's right", so the tender opens in its place; with a shift of theirs
 * already open, or for a manager, the tender is already there and this only
 * waits for it.
 */
export async function passShiftGate(page: Page): Promise<void> {
  const start = page.getByRole('dialog', { name: 'Start my shift' });
  const tender = page.getByRole('dialog', { name: /^(Cash|Card)$/ });
  await expect(start.or(tender)).toBeVisible();
  if (await start.isVisible()) {
    await start.getByRole('button', { name: 'That’s right' }).click();
    await expect(start).toBeHidden();
  }
  await expect(tender).toBeVisible();
}

/** The station id the operator's browser bridge reports (apps/operator/src/ipc/bridge.ts). */
export const BROWSER_STATION = 'DEV1';
/** The seeded manager's PIN (packages/db/supabase/seed.sql). */
export const MANAGER_PIN = '380517';

/**
 * Close whatever till shift is open at the browser's station, the way a
 * manager does at the till: beat from it, prove the PIN (a single-use grant),
 * then close it counted at what it should hold. A suite whose desk or cashier
 * takes money calls it before and after, so the next suite's first payment
 * meets "Start my shift" rather than someone else's open drawer.
 */
export async function closeStationShift(station = BROWSER_STATION): Promise<void> {
  const manager = await signedInClient(SEED_STAFF.manager);
  try {
    await appRpc(manager, 'heartbeat', { p_device_id: station, p_queue_depth: 0, p_app_version: 'e2e', p_is_till: false });
    const status = await appRpc<{ shift: { id: string; cash_expected_iqd?: number } | null }>(manager, 'till_shift_status', {
      p_device_id: station,
    });
    if (!status.shift) return;
    await appRpc(manager, 'verify_manager_pin', { p_pin: MANAGER_PIN, p_device_id: station });
    await appRpc(manager, 'close_till_shift_for', {
      p_till_shift_id: status.shift.id,
      p_counted_iqd: Math.max(0, status.shift.cash_expected_iqd ?? 0),
      p_device_id: station,
    });
  } finally {
    await manager.auth.signOut();
  }
}

// ---------------------------------------------------------------------------
// Open matches (docs/design/open-matches/operator.md §5.23). Seeds go through
// the RPCs the phone and the desk call, never straight into the match tables,
// so every seeded match holds the same money and ticket rules a real one does.
// ---------------------------------------------------------------------------

/** The fixture branch (packages/db/fixtures) and its two courts, in calendar order. */
export const FIXTURE_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';
export const FIXTURE_COURT_IDS = [
  'f1f70000-0000-4000-8000-00000000c001',
  'f1f70000-0000-4000-8000-00000000c002',
] as const;

/**
 * Every name the desk types into an e2e match or booking starts with this,
 * so cleanE2eMatches finds what a run left. Letters only: the desk strips
 * digits as it types (deskLogic sanitizeName).
 */
export const E2E_MATCH_NAME = 'Playwright Match';

// The fixture branch runs on Asia/Baghdad (UTC+3, no DST) and its business day
// starts at 04:00 (app.venue_business_date).
const VENUE_UTC_OFFSET_H = 3;
const BUSINESS_DAY_START_H = 4;

/** The branch's business date (the night the desk calendar opens on), moved by whole days. */
export function venueBusinessDate(offsetDays = 0): string {
  const local = Date.now() + (VENUE_UTC_OFFSET_H - BUSINESS_DAY_START_H) * 3_600_000;
  return new Date(local + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** A wall-clock time ('HH:MM') on a branch date, as an instant. */
export function venueTime(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+0${VENUE_UTC_OFFSET_H}:00`);
}

/** The desk calendar's slot button for a court at a time ('HH:MM', from the 09:00 opening). */
export function calendarSlot(page: Page, courtId: string, hhmm: string): Locator {
  const [h, m] = hhmm.split(':').map(Number);
  return page.locator(`button[data-slot-court="${courtId}"][data-slot-min="${h! * 60 + m!}"]`);
}

export interface MatchSettingsRow {
  matches_enabled: boolean;
  match_fill_deadline_minutes: number;
  match_ticket_price_iqd: number;
}

/** app.match_settings at the fixture branch, read as the owner. */
export async function readMatchSettings(): Promise<MatchSettingsRow> {
  const owner = await signedInClient(SEED_STAFF.owner);
  try {
    return await appRpc<MatchSettingsRow>(owner, 'match_settings', { p_venue_id: FIXTURE_VENUE_ID });
  } finally {
    await owner.auth.signOut();
  }
}

/**
 * Switch open matches on (or off) at the fixture branch the way the owner
 * does (app.set_match_settings), optionally with a fill deadline or a ticket
 * price (the price is every branch's).
 */
export async function enableMatches(
  opts: { on?: boolean; deadlineMinutes?: number; ticketPriceIqd?: number } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { matches_enabled: opts.on ?? true };
  if (opts.deadlineMinutes !== undefined) patch.match_fill_deadline_minutes = opts.deadlineMinutes;
  if (opts.ticketPriceIqd !== undefined) patch.match_ticket_price_iqd = opts.ticketPriceIqd;
  const owner = await signedInClient(SEED_STAFF.owner);
  try {
    await appRpc(owner, 'set_match_settings', { p_patch: patch, p_venue_id: FIXTURE_VENUE_ID });
  } finally {
    await owner.auth.signOut();
  }
}

export interface MatchPlayer {
  id: string;
  email: string;
  /** The account's full name, as the desk sees it. */
  name: string;
  client: SupabaseClient;
}

// No digits in a name (sanitised on the desk), one pair per letter.
const MATCH_PLAYER_NAMES: Record<string, readonly [string, string]> = {
  a: ['Aya', 'Saleh'],
  b: ['Basma', 'Kareem'],
  c: ['Celine', 'Nouri'],
  d: ['Dalia', 'Hamid'],
  e: ['Eman', 'Jaber'],
  f: ['Farah', 'Latif'],
  g: ['Ghada', 'Munir'],
  h: ['Hala', 'Qasim'],
};

/**
 * Guest accounts that may play: `e2e-match-<letter>@dev.touch.local`, made
 * once and reused on a rerun, with a phone, given and family names, the terms
 * accepted and the gender set (0256), and any open-match ban from an earlier
 * run lifted. The profile is written with the service role so a rerun always
 * converges on the same player.
 */
export async function seedMatchPlayers(
  svc: SupabaseClient,
  letters: readonly string[],
  { gender = 'female' }: { gender?: 'female' | 'male' } = {},
): Promise<MatchPlayer[]> {
  const players: MatchPlayer[] = [];
  for (const [i, letter] of letters.entries()) {
    const [given, family] = MATCH_PLAYER_NAMES[letter] ?? (['Player', letter.toUpperCase()] as const);
    const name = `${given} ${family}`;
    const email = `e2e-match-${letter}@dev.touch.local`;
    const phone = `+96477010000${String(letter.charCodeAt(0) % 100).padStart(2, '0')}`;
    const created = await svc.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: name, phone },
    });
    if (created.error && !/already|registered|exists/i.test(created.error.message)) {
      throw new Error(`seedMatchPlayers ${letter}: ${created.error.message}`);
    }
    const client = await signedInClient(email);
    const id = (await client.auth.getUser()).data.user?.id;
    if (!id) throw new Error(`seedMatchPlayers ${letter}: no user id`);
    const now = new Date().toISOString();
    const { error } = await svc
      .from('profiles')
      .update({
        full_name: name,
        given_name: given,
        family_name: family,
        phone,
        terms_version: '2026-09-29',
        terms_accepted_at: now,
        gender,
        gender_set_at: now,
        gender_set_by: 'guest',
      })
      .eq('id', id);
    if (error) throw new Error(`seedMatchPlayers ${letter} profile: ${error.message}`);
    const { error: flagErr } = await svc.from('customer_flags').delete().eq('customer_id', id).eq('type', 'match_ban');
    if (flagErr) throw new Error(`seedMatchPlayers ${letter} ban: ${flagErr.message}`);
    players[i] = { id, email, name, client };
  }
  return players;
}

/**
 * `count` paid open-match tickets for a guest, bought the way the phone buys
 * them minus the bank (ticket-begin's prepare and mark_created, then a SUCCESS
 * through deposit_apply: the packages/db/tests/deposits.test.ts sequence). No
 * edge function and no PAYMENTS_PROVIDER. Returns the purchase's
 * booking_payments id.
 */
export async function grantTickets(svc: SupabaseClient, guestId: string, count: number): Promise<string> {
  const prep = await appRpc<{ request_id: string; amount_iqd: number; status: string }>(svc, 'ticket_payment_prepare', {
    p_guest_id: guestId,
    p_count: count,
    p_locale: 'en',
    p_provider: 'fake',
  });
  if (prep.status === 'created') {
    await appRpc(svc, 'deposit_mark_created', {
      p_request_id: prep.request_id,
      p_provider_payment_id: `e2e-${prep.request_id}`,
      p_form_url: `${SUPABASE_URL}/functions/v1/payments-fake?ref=${prep.request_id}`,
      p_provider_status: 'CREATED',
      p_raw: {},
    });
  }
  await appRpc(svc, 'deposit_apply', {
    p_request_id: prep.request_id,
    p_provider_payment_id: null,
    p_provider_status: 'SUCCESS',
    p_amount: prep.amount_iqd,
    p_currency: 'IQD',
    p_canceled: false,
    p_source: 'webhook',
    p_signature_ok: true,
    p_raw: { status: 'SUCCESS' },
  });
  const { data, error } = await svc.from('booking_payments').select('id').eq('request_id', prep.request_id).single();
  if (error) throw new Error(`grantTickets read: ${error.message}`);
  return (data as { id: string }).id;
}

/** A guest's tickets by status (service role). */
export async function ticketWallet(svc: SupabaseClient, guestId: string): Promise<Record<string, number>> {
  const { data, error } = await svc.from('match_tickets').select('status').eq('guest_id', guestId);
  if (error) throw new Error(`ticketWallet failed: ${error.message}`);
  const out: Record<string, number> = {};
  for (const t of (data ?? []) as { status: string }[]) out[t.status] = (out[t.status] ?? 0) + 1;
  return out;
}

export interface SeededMatch {
  matchId: string;
  shareToken: string;
  /** Set once the fourth seat booked the court. */
  reservationId: string | null;
}

/**
 * A filling match started by a guest in the app (app.match_quote, then
 * app.match_start with that quote and a fresh key; a 90-minute open public
 * match unless told otherwise), with `joiners` joining through
 * app.match_join. Every guest needs a ticket of their own (grantTickets).
 */
export async function seedFillingMatch(opts: {
  organiser: MatchPlayer;
  courtId: string;
  startAt: Date;
  durationMin?: number;
  category?: 'open' | 'women' | 'men';
  joiners?: readonly MatchPlayer[];
}): Promise<SeededMatch> {
  const dur = opts.durationMin ?? 90;
  const where = {
    p_venue_id: FIXTURE_VENUE_ID,
    p_court_id: opts.courtId,
    p_start_at: opts.startAt.toISOString(),
    p_duration_min: dur,
  };
  const quote = await appRpc<{ price_iqd: number | null; refusal: string | null }>(opts.organiser.client, 'match_quote', where);
  if (quote.refusal) throw new Error(`seedFillingMatch: the quote refuses (${quote.refusal})`);
  const started = await appRpc<{ match_id: string; share_token: string }>(opts.organiser.client, 'match_start', {
    ...where,
    p_category: opts.category ?? 'open',
    p_visibility: 'public',
    p_join_policy: 'open',
    p_friends: [],
    p_quoted_price_iqd: quote.price_iqd,
    p_idempotency_key: `match.start:${crypto.randomUUID()}`,
  });
  for (const p of opts.joiners ?? []) await appRpc(p.client, 'match_join', { p_match_id: started.match_id });
  return { matchId: started.match_id, shareToken: started.share_token, reservationId: null };
}

/**
 * A booked match: the guests start and join in the app, then the court desk
 * adds each of `deskNames` as a typed walk-in (app.desk_add_seat); the fourth
 * seat books the tapped court in the same transaction.
 */
export async function seedBookedMatch(opts: {
  organiser: MatchPlayer;
  joiners?: readonly MatchPlayer[];
  deskNames: readonly string[];
  courtId: string;
  startAt: Date;
  durationMin?: number;
}): Promise<SeededMatch & { reservationId: string }> {
  const seeded = await seedFillingMatch(opts);
  const desk = await signedInClient(SEED_STAFF.court_desk);
  try {
    for (const name of opts.deskNames) {
      await appRpc(desk, 'desk_add_seat', {
        p_match_id: seeded.matchId,
        p_guest_name: name,
        p_idempotency_key: `match.add:${crypto.randomUUID()}`,
      });
    }
  } finally {
    await desk.auth.signOut();
  }
  const reservationId = await matchReservationId(seeded.matchId);
  if (!reservationId) throw new Error('seedBookedMatch: four seats but no booking (is the court free?)');
  return { ...seeded, reservationId };
}

async function matchReservationId(matchId: string): Promise<string | null> {
  const { data, error } = await serviceClient().from('matches').select('reservation_id').eq('id', matchId).single();
  if (error) throw new Error(`matchReservationId failed: ${error.message}`);
  return (data as { reservation_id: string | null }).reservation_id;
}

/**
 * Move a booked match's booking so the game started `minutesAgo` minutes ago
 * (OM-43 forbids starting a match in the past, so a started one is made this
 * way). The reservation trigger (0263) copies the new times to the match. The
 * start never crosses back over 04:00, the business day's start, or the marks
 * would belong to yesterday's day and be closed.
 */
export async function backdateBookedMatch(svc: SupabaseClient, matchId: string, minutesAgo = 30): Promise<Date> {
  const { data, error } = await svc.from('matches').select('reservation_id, duration_min').eq('id', matchId).single();
  if (error) throw new Error(`backdateBookedMatch read: ${error.message}`);
  const row = data as { reservation_id: string | null; duration_min: number };
  if (!row.reservation_id) throw new Error('backdateBookedMatch: the match has no booking');
  const local = new Date(Date.now() + VENUE_UTC_OFFSET_H * 3_600_000);
  const sinceDayStart = ((local.getUTCHours() - BUSINESS_DAY_START_H + 24) % 24) * 60 + local.getUTCMinutes();
  const ago = Math.max(1, Math.min(minutesAgo, sinceDayStart - 1));
  const start = new Date(Math.floor((Date.now() - ago * 60_000) / 60_000) * 60_000);
  const end = new Date(start.getTime() + row.duration_min * 60_000);
  const { error: upErr } = await svc
    .from('reservations')
    .update({ start_at: start.toISOString(), end_at: end.toISOString() })
    .eq('id', row.reservation_id);
  if (upErr) throw new Error(`backdateBookedMatch move: ${upErr.message}`);
  return start;
}

/** A player's report on another seat of the match, as the phone sends it (app.match_report). */
export async function seedMatchReport(
  reporter: MatchPlayer,
  matchId: string,
  seatId: string,
  reason = 'abusive_behaviour',
): Promise<string> {
  const out = await appRpc<{ report_id: string }>(reporter.client, 'match_report', {
    p_match_id: matchId,
    p_reason: reason,
    p_seat_id: seatId,
    p_block: false,
  });
  return out.report_id;
}

/**
 * End whatever an earlier run left: every live match organised by an e2e
 * account or holding a seat typed with E2E_MATCH_NAME (a filling or waiting
 * one cancelled by the desk, app.desk_cancel_match; a booked one by
 * cancelling its booking, which the reservation trigger cascades), then every
 * live booking typed with E2E_MATCH_NAME.
 */
export async function cleanE2eMatches(svc: SupabaseClient): Promise<void> {
  const { data: users, error: uErr } = await svc.from('profiles').select('id').like('phone', '+96477010000%');
  if (uErr) throw new Error(`cleanE2eMatches players: ${uErr.message}`);
  const ids = new Set<string>();
  const players = ((users ?? []) as { id: string }[]).map((u) => u.id);
  if (players.length > 0) {
    const { data } = await svc.from('matches').select('id').in('organiser_id', players).in('status', ['filling', 'awaiting_court', 'booked']);
    for (const m of (data ?? []) as { id: string }[]) ids.add(m.id);
    const { data: seats } = await svc.from('match_seats').select('match_id').in('guest_id', players);
    for (const s of (seats ?? []) as { match_id: string }[]) ids.add(s.match_id);
  }
  const { data: typed } = await svc.from('match_seats').select('match_id').like('guest_name', `${E2E_MATCH_NAME}%`);
  for (const s of (typed ?? []) as { match_id: string }[]) ids.add(s.match_id);

  if (ids.size > 0) {
    const { data: live, error } = await svc
      .from('matches')
      .select('id, status, reservation_id')
      .in('id', [...ids])
      .in('status', ['filling', 'awaiting_court', 'booked']);
    if (error) throw new Error(`cleanE2eMatches read: ${error.message}`);
    const rows = (live ?? []) as { id: string; status: string; reservation_id: string | null }[];
    const desk = await signedInClient(SEED_STAFF.court_desk);
    try {
      for (const m of rows.filter((r) => r.status !== 'booked')) {
        await appRpc(desk, 'desk_cancel_match', { p_match_id: m.id, p_reason: 'staff_error: e2e cleanup' });
      }
    } finally {
      await desk.auth.signOut();
    }
    await cancelReservations(svc, rows.filter((r) => r.status === 'booked' && r.reservation_id).map((r) => r.reservation_id!));
  }

  const { data: bookings, error: bErr } = await svc
    .from('reservations')
    .select('id')
    .like('guest_name', `${E2E_MATCH_NAME}%`)
    .in('status', ['pending', 'confirmed', 'arrived']);
  if (bErr) throw new Error(`cleanE2eMatches bookings: ${bErr.message}`);
  await cancelReservations(svc, ((bookings ?? []) as { id: string }[]).map((r) => r.id));
}

async function cancelReservations(svc: SupabaseClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await svc
    .from('reservations')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'staff', cancellation_reason: 'e2e cleanup' })
    .in('id', ids);
  if (error) throw new Error(`cancelReservations failed: ${error.message}`);
}
