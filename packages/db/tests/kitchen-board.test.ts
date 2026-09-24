/**
 * kitchen_board_read (build-contracts-2026-09-23 §2.23, plan #60): the kitchen
 * board reads its tickets through app.kitchen_board.
 *
 *   * app.kitchen_board gives every kitchen-list role the board's tickets in
 *     the shape the old embedded select returned, refuses driver, marketing
 *     and the desk, answers for one venue, carries no money key at any depth,
 *     fills the booking for cashier and MGMT only, and keeps a completed
 *     ticket for two minutes: no caller can widen that window.
 *
 * Self-contained like new-roles.test.ts: one auth user + staff row per new
 * role, deleted in afterAll. The probe tabs and tickets at venue A stay
 * behind, as kds-item-ready's do. Venue B's probe (a closed day, a tab, an
 * order, a line and a queued ticket, fixed ee57 ids) is written by the
 * service role once and reused: the venue axis is the row's venue_id, so B
 * is never switched on through the API here (helpers.ts VENUE_B_ID). The one
 * case that needs B active does it inside a psql transaction it rolls back.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  testIdemKey,
  probeId,
  createTestMenuItem,
  addModifierToItem,
  createTestCafeTable,
  createTestCourt,
  ensureOpenDay,
  ensureTillFresh,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
  VENUE_A_ID,
  VENUE_B_ID,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/** SQL the REST surface cannot run: a transaction (multi-venue.test.ts's helper). */
function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}

const KITCHEN = ['head_barista', 'barista', 'head_chef', 'chef'] as const;
const NO_STATION = ['driver', 'marketing'] as const;
const NEW_ROLES = [...KITCHEN, ...NO_STATION] as const;
type NewRole = (typeof NEW_ROLES)[number];

// The pre-K board read (op/features/kds/ticketView.ts TICKET_SELECT until the
// board commit), kept as the parity reference: app.kitchen_board must return
// what this returned to a role that reads every table it embeds.
const OLD_BOARD_SELECT = `id, status, target_seconds, created_at, completed_at, last_actor_label,
  order:orders (
    id, source, status,
    tab:tabs!orders_tab_id_fkey ( id, label, table:cafe_tables ( table_number ),
               reservation:reservations!tabs_reservation_id_fkey ( id, guest_name ) ),
    order_items (
      id, qty, notes, voided, ready_at,
      menu_item:menu_items ( name_en, name_ar ),
      variant:menu_item_variants ( name_en, name_ar ),
      order_item_modifiers ( qty, modifier:modifiers ( name_en, name_ar ) )
    )
  )`;

// Venue B's probe rows. The day is dated in 2001 so it can never meet
// multi-venue.test.ts's far-future days on (venue_id, business_date).
const B_DAY = probeId('b0e1');
const B_TAB = probeId('b0e2');
const B_ORDER = probeId('b0e3');
const B_LINE = probeId('b0e4');
const B_TICKET = probeId('b0e5');

type Named = { name_en: string; name_ar: string };
interface BoardLine {
  id: string;
  qty: number;
  notes: string | null;
  voided: boolean;
  ready_at: string | null;
  menu_item: Named | null;
  variant: Named | null;
  order_item_modifiers: { qty: number; modifier: Named | null }[];
}
interface BoardTicket {
  id: string;
  status: string;
  target_seconds: number;
  created_at: string;
  completed_at: string | null;
  last_actor_label: string | null;
  order: {
    id: string;
    source: string;
    status: string;
    tab: {
      id: string;
      label: string | null;
      table: { table_number: string } | null;
      reservation: { id: string; guest_name: string | null } | null;
    } | null;
    order_items: BoardLine[];
  } | null;
}

/** Every key at every depth, so a money column cannot hide in a nested object. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe.skipIf(!up)('kitchen_board_read: app.kitchen_board', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient;

  const ids = {} as Record<NewRole, string>;
  const as = {} as Record<NewRole, SupabaseClient>;
  /** The eight roles of the kitchen list, by name. */
  let board: [string, SupabaseClient][];

  let item: Awaited<ReturnType<typeof createTestMenuItem>>;
  let modifierId: string;
  let tableNumber: string;

  // The probe: a table ticket with a noted, modified, ready-marked line and a
  // plain one.
  let ticketId: string;
  let orderId: string;
  let tabId: string;
  let lineIds: string[];
  // A court tab's ticket, for the booking rule.
  let courtTicketId: string;
  let reservationId: string;
  // Completed a minute, three minutes and a week ago.
  let doneMinuteAgo: string;
  let doneThreeMinutesAgo: string;
  let doneWeekAgo: string;

  async function call(c: SupabaseClient, args: Record<string, unknown> = {}) {
    return appRpc(c, 'kitchen_board', args);
  }

  async function boardOf(c: SupabaseClient, who: string): Promise<BoardTicket[]> {
    const res = await call(c);
    expect(res.error, `${who} kitchen_board`).toBeNull();
    return (res.data as { tickets: BoardTicket[] }).tickets;
  }

  async function ticketOnTable(tag: string): Promise<{ ticketId: string; orderId: string; tabId: string }> {
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, tag),
      p_label: `${tag}-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (tab.error) throw new Error(tab.error.message);
    const order = await appRpc(cashier, 'till_add_items', {
      p_tab_id: (tab.data as { tab_id: string }).tab_id,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (order.error) throw new Error(order.error.message);
    return {
      ticketId: (order.data as { ticket_id: string }).ticket_id,
      orderId: (order.data as { order_id: string }).order_id,
      tabId: (tab.data as { tab_id: string }).tab_id,
    };
  }

  async function completedAgo(ms: number): Promise<string> {
    const { ticketId: id } = await ticketOnTable('kitchen-board-done');
    for (const status of ['preparing', 'ready', 'completed']) {
      const res = await appRpc(cashier, 'set_ticket_status', { p_ticket_id: id, p_status: status });
      if (res.error) throw new Error(`bump to ${status}: ${res.error.message}`);
    }
    const at = await svc
      .from('tickets')
      .update({ completed_at: new Date(Date.now() - ms).toISOString() })
      .eq('id', id);
    if (at.error) throw new Error(at.error.message);
    return id;
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    prep = await signedInClient(SEED_STAFF.prep);
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await anonymousSessionClient();

    for (const role of NEW_ROLES) {
      const email = `kitchen-board-${role}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({
        email,
        password: DEV_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      ids[role] = data.user.id;
      const ins = await svc
        .from('staff')
        .insert({ id: data.user.id, display_name: `Test ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      as[role] = await signedInClient(email);
    }
    board = [
      ...KITCHEN.map((role) => [role, as[role]] as [string, SupabaseClient]),
      ['prep', prep],
      ['cashier', cashier],
      ['manager', manager],
      ['owner', owner],
    ];

    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    item = await createTestMenuItem(svc, 'kitchen-board', 4000);
    modifierId = (await addModifierToItem(svc, item.itemId, 'إضافة لوحة المطبخ', 500)).modifierId;

    // The probe, placed the way the till places one.
    const tableId = await createTestCafeTable(svc, 'kitchen-board');
    const t = await svc.from('cafe_tables').select('table_number').eq('id', tableId).single();
    if (t.error) throw new Error(t.error.message);
    tableNumber = (t.data as { table_number: string }).table_number;
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: tableId,
      p_label: `kitchen-board-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (tab.error) throw new Error(tab.error.message);
    tabId = (tab.data as { tab_id: string }).tab_id;
    const order = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [
        { variant_id: item.variantId, qty: 2, notes: 'no sugar', modifiers: [{ modifier_id: modifierId, qty: 2 }] },
        { variant_id: item.variantId, qty: 1 },
      ],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (order.error) throw new Error(order.error.message);
    ticketId = (order.data as { ticket_id: string }).ticket_id;
    orderId = (order.data as { order_id: string }).order_id;
    const lines = await svc.from('order_items').select('id').eq('order_id', orderId).order('line_no');
    if (lines.error) throw new Error(lines.error.message);
    lineIds = (lines.data as { id: string }[]).map((r) => r.id);
    const mark = await appRpc(cashier, 'set_order_item_ready', { p_order_item_id: lineIds[0], p_ready: true });
    if (mark.error) throw new Error(mark.error.message);

    // A court tab: its own court, so the booking meets no other on the
    // exclusion constraint.
    const courtId = await createTestCourt(svc, `Kitchen Board ${Date.now()}`);
    const start = new Date(Date.now() + 60 * 86_400_000);
    start.setUTCHours(12, 0, 0, 0);
    const booking = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
        guest_name: 'Kitchen Board Guest',
        price_iqd: 30_000,
      })
      .select('id')
      .single();
    if (booking.error) throw new Error(booking.error.message);
    reservationId = (booking.data as { id: string }).id;
    const courtTab = await appRpc(cashier, 'open_tab', {
      p_reservation_id: reservationId,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (courtTab.error) throw new Error(courtTab.error.message);
    const courtOrder = await appRpc(cashier, 'till_add_items', {
      p_tab_id: (courtTab.data as { tab_id: string }).tab_id,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (courtOrder.error) throw new Error(courtOrder.error.message);
    courtTicketId = (courtOrder.data as { ticket_id: string }).ticket_id;

    doneMinuteAgo = await completedAgo(60_000);
    doneThreeMinutesAgo = await completedAgo(3 * 60_000);
    doneWeekAgo = await completedAgo(7 * 86_400_000);

    // Venue B, written once. ignoreDuplicates everywhere: an existing venue
    // row is never touched, so B stays inactive whatever ran before.
    const put = async (table: string, row: Record<string, unknown>, onConflict = 'id') => {
      const { error } = await svc.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
      if (error) throw new Error(`venue B probe ${table} failed: ${error.message}`);
    };
    await put('venues', {
      id: VENUE_B_ID,
      slug: 'probe-venue-b',
      name_en: 'Probe Venue B',
      name_ar: 'فرع تجريبي ب',
      timezone: 'Asia/Baghdad',
      is_active: false,
    });
    await put('day_sessions', {
      id: B_DAY, venue_id: VENUE_B_ID, business_date: '2001-01-01', status: 'closed',
      opened_by: SEED_STAFF_IDS.manager_b, opening_float_iqd: 0,
      closed_at: new Date().toISOString(), closed_by: SEED_STAFF_IDS.manager_b,
    });
    await put('tabs', { id: B_TAB, venue_id: VENUE_B_ID, day_session_id: B_DAY, label: 'kitchen-board B', status: 'void' });
    await put('orders', { id: B_ORDER, venue_id: VENUE_B_ID, tab_id: B_TAB, source: 'till' });
    await put('order_items', {
      id: B_LINE, order_id: B_ORDER, menu_item_id: item.itemId, variant_id: item.variantId,
      qty: 1, unit_price_iqd: 4000, line_total_iqd: 4000,
    });
    const bMods = await svc.from('order_item_modifiers').select('modifier_id').eq('order_item_id', B_LINE);
    if (bMods.error) throw new Error(bMods.error.message);
    if ((bMods.data ?? []).length === 0) {
      await put('order_item_modifiers', { order_item_id: B_LINE, modifier_id: modifierId, qty: 1, price_delta_iqd: 500 },
        'order_item_id,modifier_id');
    }
    await put('tickets', { id: B_TICKET, venue_id: VENUE_B_ID, order_id: B_ORDER });
  });

  afterAll(async () => {
    const staffIds = Object.values(ids);
    for (const role of NEW_ROLES) await as[role]?.auth.signOut();
    for (const id of staffIds) {
      const r = await svc.from('staff').delete().eq('id', id);
      expect(r.error, `staff delete ${id}`).toBeNull();
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const c of [owner, manager, cashier, prep, desk, guest]) await c?.auth.signOut();
  });

  it('gives every kitchen-list role the probe ticket with its lines, add-ons, notes and ready marks', async () => {
    let first: BoardTicket | undefined;
    for (const [role, c] of board) {
      const tickets = await boardOf(c, role);
      const probe = tickets.find((t) => t.id === ticketId);
      expect(probe, `${role} sees the probe ticket`).toBeTruthy();
      if (!first) first = probe;
      // A table ticket carries no booking, so every role gets the same payload.
      expect(probe, `${role} gets what the others get`).toEqual(first);
    }

    const probe = first!;
    expect(probe.status).toBe('queued');
    expect(probe.order?.id).toBe(orderId);
    expect(probe.order?.source).toBe('till');
    expect(probe.order?.tab?.id).toBe(tabId);
    expect(probe.order?.tab?.table).toEqual({ table_number: tableNumber });
    expect(probe.order?.tab?.reservation).toBeNull();
    const lines = probe.order!.order_items;
    expect(lines.map((l) => l.id)).toEqual(lineIds);
    expect(lines[0]).toMatchObject({ qty: 2, notes: 'no sugar', voided: false });
    expect(lines[0]!.ready_at, 'the ready mark').not.toBeNull();
    expect(lines[0]!.menu_item?.name_ar).toMatch(/^صنف اختبار kitchen-board-/);
    expect(lines[0]!.variant).toEqual({ name_en: 'Regular', name_ar: 'عادي' });
    expect(lines[0]!.order_item_modifiers).toHaveLength(1);
    expect(lines[0]!.order_item_modifiers[0]).toMatchObject({ qty: 2, modifier: { name_ar: 'إضافة لوحة المطبخ' } });
    expect(lines[1]).toMatchObject({ qty: 1, notes: null, ready_at: null, order_item_modifiers: [] });
  });

  it('returns the shape the old embedded select returned, key for key', async () => {
    // The owner reads every table the old select embedded, before and after
    // kitchen_money_reads, so the two reads must agree exactly.
    const tickets = await boardOf(owner, 'owner');
    for (const id of [ticketId, courtTicketId]) {
      const old = await owner.from('tickets').select(OLD_BOARD_SELECT).eq('id', id).single();
      expect(old.error).toBeNull();
      expect(tickets.find((t) => t.id === id), `ticket ${id}`).toEqual(old.data);
    }
  });

  it('carries no money key at any depth', async () => {
    for (const [role, c] of board) {
      const res = await call(c);
      expect(res.error).toBeNull();
      const money = keysDeep(res.data).filter((k) => k.endsWith('_iqd') || k.startsWith('cost'));
      expect(money, `${role} payload`).toEqual([]);
    }
  });

  it('refuses driver, marketing, the desk and a guest', async () => {
    for (const [who, c] of [
      ['driver', as.driver],
      ['marketing', as.marketing],
      ['court_desk', desk],
      ['guest', guest],
    ] as [string, SupabaseClient][]) {
      const res = await call(c);
      expect(res.error?.message, who).toBe('FORBIDDEN');
      expect(res.data, who).toBeNull();
    }
  });

  it('fills the booking for cashier and MGMT only', async () => {
    for (const [role, c] of board) {
      const court = (await boardOf(c, role)).find((t) => t.id === courtTicketId);
      expect(court, `${role} sees the court ticket`).toBeTruthy();
      expect(court!.order?.tab?.table).toBeNull();
      const expected = ['cashier', 'manager', 'owner'].includes(role)
        ? { id: reservationId, guest_name: 'Kitchen Board Guest' }
        : null;
      expect(court!.order?.tab?.reservation, `${role} booking`).toEqual(expected);
    }
  });

  it('keeps a completed ticket for two minutes and not a moment of history more', async () => {
    const seen = new Set((await boardOf(prep, 'prep')).map((t) => t.id));
    expect(seen.has(doneMinuteAgo), 'completed a minute ago').toBe(true);
    expect(seen.has(doneThreeMinutesAgo), 'completed three minutes ago').toBe(false);
    expect(seen.has(doneWeekAgo), 'completed a week ago').toBe(false);

    // No argument widens it: a window parameter matches no signature.
    const wider = await call(prep, {
      p_venue_id: null,
      p_completed_since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    });
    expect(wider.error?.code).toBe('PGRST202');
  });

  it('answers for one venue', async () => {
    for (const [role, c] of [
      ['cashier', cashier],
      ['prep', prep],
      ['head_chef', as.head_chef],
      ['manager', manager],
    ] as [string, SupabaseClient][]) {
      const seen = (await boardOf(c, role)).map((t) => t.id);
      expect(seen, `${role} board`).not.toContain(B_TICKET);
      const atB = await call(c, { p_venue_id: VENUE_B_ID });
      expect(atB.error?.message, `${role} naming venue B`).toBe('FORBIDDEN');
    }
    // B's ticket is really there, for anyone whose venue it is.
    const row = await svc.from('tickets').select('status').eq('id', B_TICKET).single();
    expect((row.data as { status: string }).status).toBe('queued');
  });

  it.skipIf(!dockerReachable())(
    'with a second venue active, no venue named reads every venue the caller works at, as tickets_staff_read did',
    () => {
      // app.current_venue() is ambiguous here: the owner holds no staff_venues
      // row and two venues are active, and the manager holds two memberships.
      // The board passes no venue, so the old read is the reference: the ticket
      // ids the caller's own tickets select returns in the same window.
      const same = (who: string) => `
        select '${who}',
               coalesce((select array_agg((e->>'id')::uuid order by (e->>'id')::uuid)
                           from jsonb_array_elements(app.kitchen_board(null)->'tickets') e), '{}')
               = coalesce((select array_agg(t.id order by t.id) from tickets t
                            where t.status in ('queued','preparing','ready')
                               or (t.status = 'completed' and t.completed_at >= now() - interval '2 minutes')), '{}'),
               exists (select 1 from jsonb_array_elements(app.kitchen_board(null)->'tickets') e
                        where e->>'id' = '${B_TICKET}'),
               exists (select 1 from jsonb_array_elements(app.kitchen_board('${VENUE_A_ID}')->'tickets') e
                        where e->>'id' = '${B_TICKET}');`;
      const claims = (sub: string) =>
        `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
      const out = psql(`
        begin;
        update venues set is_active = true where id = '${VENUE_B_ID}';
        insert into staff_venues (staff_id, venue_id, role)
          values ('${SEED_STAFF_IDS.manager}', '${VENUE_B_ID}', 'manager') on conflict do nothing;
        set local role authenticated;
        ${claims(SEED_STAFF_IDS.owner)}
        ${same('owner')}
        ${claims(SEED_STAFF_IDS.manager)}
        ${same('manager')}
        rollback;`)
        .split('\n')
        .filter((line) => line.startsWith('owner|') || line.startsWith('manager|'));
      // who | matches the old read | sees B's ticket | naming venue A shows B's
      expect(out).toEqual(['owner|t|t|f', 'manager|t|t|f']);
    },
  );
});
