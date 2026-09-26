/**
 * Wave 5 lane T — till shifts (docs/design/protocols/wave5-addendum-2026-09-25.md
 * §2.9, §6.1 T1–T16, §7.5; draft packages/db/supabase/drafts/till_shifts.sql).
 *
 * The money-path invariants a wrong implementation would still appear to
 * satisfy, each proved against rows the test writes and sums itself:
 *
 *   * attribution is by STATION: a payment or refund carries the shift open at
 *     its device when it was inserted, or null ("outside a shift"); a supplied
 *     id is overwritten, and a refund with a device no longer fails the stamp
 *     (V1). The server never refuses money for a missing shift (TI1);
 *   * a closed shift's stamped figures equal the sums over the rows that carry
 *     it (TI3), including under a race with settle_tab (T9) and when the close
 *     internal is called without the caller locking the shift first;
 *   * the handover difference counts the cash that came in or went out at the
 *     station with no shift open in between (V18), a payment that began
 *     before the last close and landed after it included;
 *   * close_day's math is 0020's (TI5), and the day partitions exactly into
 *     shifts plus outside rows, with the cross-day refund term (TI6, V10); on a
 *     clean one-till day the day variance is the shift variances plus the
 *     handover differences minus the earlier days' cash refunds (TI7);
 *   * every count is signed by the holder's own PIN or a manager's grant; a
 *     wrong own PIN is returned, never raised (TI13); a retried close echoes
 *     and audits once (TI14).
 *
 * Days. The day is global in the till logic (one open day), so the suite owns
 * it the way cafe-flow does: forceCloseAllDays first, then fresh far-future
 * days — D1 (most scenarios, closed by close_day), D2 (the clean one-till day
 * and the cross-day refund), D3 (a negative expected; force-closed with a desk
 * shift open) and D4 (the self-heal; closed by close_day). Nothing is left
 * open: no day and no shift.
 *
 * Principals: the seeded cashier (a PIN is set here and cleared after), the
 * seeded cashier_b (no PIN: NO_PIN_SET and the manager-PIN close), the seeded
 * court desk (a PIN, as the cashier), manager and owner (seeded PINs), prep,
 * a guest and anon; the eight other roles are created for the denials and
 * deleted after. Stations are registered up front as non-tills (is_till
 * false, no TILL prefix), so no heartbeat here can put the venue into degraded
 * mode, and are retired after. Every write beats first.
 *
 * Shift, payment and refund rows stay behind (payments and refunds are
 * append-only and reference the shifts), as every till suite's money does.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonClient,
  anonymousSessionClient,
  appRpc,
  testIdemKey,
  createTestMenuItem,
  createTestCourt,
  createTestCafeTable,
  openFreshDay,
  forceCloseAllDays,
  ensureTillFresh,
  probeId,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PINS,
  DEV_PASSWORD,
  VENUE_A_ID,
  VENUE_B_ID,
} from './helpers';
import { asStaff, psqlSession } from './stores-harness';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

// Stations: registered here, never by a heartbeat, so the rows are ours.
const A = 'TS-TILL-A';
const B = 'TS-TILL-B';
const C = 'TS-TILL-C';
const D = 'TS-TILL-D';
const DESK = 'TS-DESK-A';
const RETIRED = 'TS-RETIRED';
const VB = 'TS-TILL-VB'; // at venue B, which stays inactive
const NOWHERE = 'TS-NOWHERE'; // never registered, never beaten
const OURS = [A, B, C, D, DESK, RETIRED];

const CASHIER_PIN = '592817';
const DESK_PIN = '738164';

const DENIED_ROLES = [
  'driver',
  'marketing',
  'head_barista',
  'barista',
  'head_chef',
  'chef',
  'assistant_barista',
  'waiter',
] as const;
type DeniedRole = (typeof DENIED_ROLES)[number];

type Res = { data: unknown; error: { message: string; code?: string; details?: string | null; hint?: string | null } | null };

interface OpenResult {
  duplicate: boolean;
  till_shift: {
    id: string;
    station_id: string;
    staff_id: string;
    staff_name: string;
    opened_at: string;
    opening_float_iqd: number;
    handover_from: null | {
      till_shift_id: string;
      staff_name: string;
      closed_at: string;
      left_in_drawer_iqd: number;
      outside_cash_since_iqd: number;
    };
    handover_difference_iqd: number | null;
  };
}

interface CloseResult {
  ok: boolean;
  code?: string;
  duplicate?: boolean;
  till_shift_id: string;
  station_id: string;
  staff_id: string;
  closed_via: string;
  authorized_by_name: string | null;
  opening_float_iqd: number;
  cash_payments_iqd: number;
  cash_refunds_iqd: number;
  cash_expected_iqd: number;
  cash_counted_iqd: number | null;
  cash_variance_iqd: number | null;
  card_payments_iqd: number;
  card_refunds_iqd: number;
  payment_count: number;
  refund_count: number;
  drawer_open_count: number;
  left_in_drawer_iqd: number | null;
}

interface ShiftRow {
  id: string;
  venue_id: string;
  day_session_id: string;
  station_id: string;
  staff_id: string;
  opened_at: string;
  opening_float_iqd: number;
  open_note: string | null;
  handover_from_shift_id: string | null;
  handover_difference_iqd: number | null;
  closed_at: string | null;
  closed_by: string | null;
  closed_via: string | null;
  authorized_by: string | null;
  cash_payments_iqd: number | null;
  cash_refunds_iqd: number | null;
  cash_expected_iqd: number | null;
  cash_counted_iqd: number | null;
  cash_variance_iqd: number | null;
  card_payments_iqd: number | null;
  card_refunds_iqd: number | null;
  payment_count: number | null;
  refund_count: number | null;
  drawer_open_count: number | null;
  close_note: string | null;
}

interface Status {
  station_id: string;
  day: null | { id: string; business_date: string; opening_float_iqd: number };
  shift: null | Record<string, unknown> & { id: string; is_mine: boolean; staff_id: string };
  last_closed: null | { id: string; left_in_drawer_iqd: number; outside_cash_since_iqd: number };
  mine_elsewhere: null | { id: string; station_id: string };
  queue_depth: number;
}

interface ListResult {
  from: string;
  to: string;
  shifts: (Record<string, number | string | null> & { id: string; day_session_id: string })[];
  outside: (Record<string, number | string | null> & { day_session_id: string; station_id: string | null })[];
  cross_day: {
    day_session_id: string;
    earlier_days_cash_refunds_iqd: number;
    earlier_days_card_refunds_iqd: number;
    later_cash_refunds_iqd: number;
    later_card_refunds_iqd: number;
  }[];
}

describe.skipIf(!up)('wave 5 lane T: till shifts', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let cashierB: SupabaseClient;
  let desk: SupabaseClient;
  let prep: SupabaseClient;
  let guest: SupabaseClient;
  let anon: SupabaseClient;
  const deniedIds = {} as Record<DeniedRole, string>;
  const denied = {} as Record<DeniedRole, SupabaseClient>;

  let ten: Awaited<ReturnType<typeof createTestMenuItem>>; // 10,000 IQD
  let one: Awaited<ReturnType<typeof createTestMenuItem>>; // 1,000 IQD
  let courtId: string;
  let tableId: string; // every sale's tab hangs off it (a tab needs an anchor)

  const days: string[] = [];
  let d1: string;
  let d2: string;
  let d3: string;
  let d4: string;
  // The venue-B probe day and shift of the RLS case, removed in afterAll.
  const vbDay = probeId('75d1');
  const vbShift = probeId('75d2');

  // ── calls ────────────────────────────────────────────────────────────────
  const call = (c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Res> =>
    appRpc(c, fn, args) as Promise<Res>;
  function ok<T>(res: Res, what = 'call'): T {
    expect(res.error, `${what}: ${res.error?.message}`).toBeNull();
    return res.data as T;
  }
  const code = (res: Res) => res.error?.message ?? null;
  const k = (intent: 'till_shift.open' | 'till_shift.close') => `${intent}:${crypto.randomUUID()}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function beat(c: SupabaseClient, station: string, depth = 0) {
    ok(
      await call(c, 'heartbeat', {
        p_device_id: station,
        p_queue_depth: depth,
        p_app_version: 'till-shifts-test',
        p_is_till: false,
      }),
      `heartbeat ${station}`,
    );
  }

  async function open(c: SupabaseClient, station: string, float: number, key = k('till_shift.open')) {
    await beat(c, station);
    return ok<OpenResult>(
      await call(c, 'open_till_shift', { p_opening_float_iqd: float, p_device_id: station, p_idempotency_key: key }),
      `open ${station}`,
    ).till_shift;
  }

  async function closeOwn(c: SupabaseClient, shiftId: string, counted: number, pin: string, station: string, key = k('till_shift.close')) {
    await beat(c, station);
    return call(c, 'close_till_shift', {
      p_till_shift_id: shiftId,
      p_counted_iqd: counted,
      p_pin: pin,
      p_device_id: station,
      p_idempotency_key: key,
    });
  }

  /** The screen's manager-PIN close: verify_manager_pin mints the grant, then the close spends it. */
  async function closeFor(c: SupabaseClient, shiftId: string, counted: number, station: string, key = k('till_shift.close')) {
    await beat(c, station);
    const v = await c.schema('app').rpc('verify_manager_pin', { p_pin: DEV_PINS.manager, p_device_id: station });
    expect(v.error).toBeNull();
    expect(v.data).toBe(SEED_STAFF_IDS.manager);
    return call(c, 'close_till_shift_for', {
      p_till_shift_id: shiftId,
      p_counted_iqd: counted,
      p_device_id: station,
      p_idempotency_key: key,
    });
  }

  async function status(c: SupabaseClient, station: string) {
    return ok<Status>(await call(c, 'till_shift_status', { p_device_id: station }), `status ${station}`);
  }

  // ── money ────────────────────────────────────────────────────────────────
  /** An open tab (opened by the manager, at the test table) carrying exactly `amount`. */
  async function tabWith(amount: number): Promise<string> {
    const tab = ok<{ tab_id: string }>(
      await call(manager, 'open_tab', {
        p_table_id: tableId,
        p_label: `till-shifts-${crypto.randomUUID().slice(0, 8)}`,
        p_idempotency_key: testIdemKey('tab.open'),
      }),
      'open_tab',
    );
    const items = [
      ...(Math.floor(amount / 10_000) ? [{ variant_id: ten.variantId, qty: Math.floor(amount / 10_000) }] : []),
      ...((amount % 10_000) / 1_000 ? [{ variant_id: one.variantId, qty: (amount % 10_000) / 1_000 }] : []),
    ];
    ok(
      await call(manager, 'till_add_items', { p_tab_id: tab.tab_id, p_items: items, p_idempotency_key: testIdemKey('order.add_items') }),
      'till_add_items',
    );
    return tab.tab_id;
  }

  function payArgs(tabId: string, method: 'cash' | 'card', amount: number, device: string | null, partial = false) {
    return {
      p_tab_id: tabId,
      p_method: method,
      p_tendered_iqd: method === 'cash' ? amount : null,
      p_amount_iqd: partial ? amount : null,
      p_idempotency_key: testIdemKey('tab.settle'),
      ...(device ? { p_device_id: device } : {}),
    };
  }

  /** A sale of `amount` at `device`, paid by `payer`. Returns the payment id. */
  async function sale(payer: SupabaseClient, device: string | null, amount: number, method: 'cash' | 'card' = 'cash') {
    const tabId = await tabWith(amount);
    const paid = ok<{ payment_id: string; status: string }>(
      await call(payer, 'settle_tab', payArgs(tabId, method, amount, device)),
      `settle ${amount} at ${device}`,
    );
    expect(paid.status).toBe('settled');
    return { paymentId: paid.payment_id, tabId };
  }

  /** A manager's refund at `device` (appRpc proves the PIN first, as the till does). */
  async function refundAt(device: string, paymentId: string, amount: number) {
    return ok<{ refund_id: string }>(
      await call(manager, 'refund', {
        p_payment_id: paymentId,
        p_amount_iqd: amount,
        p_pin: DEV_PINS.manager,
        p_reason_code: 'till-shifts-test',
        p_device_id: device,
        p_idempotency_key: testIdemKey('payment.refund'),
      }),
      `refund at ${device}`,
    ).refund_id;
  }

  async function paymentShift(id: string) {
    const { data, error } = await svc.from('payments').select('till_shift_id, device_id').eq('id', id).single();
    expect(error).toBeNull();
    return data as { till_shift_id: string | null; device_id: string | null };
  }
  async function refundShift(id: string) {
    const { data, error } = await svc.from('refunds').select('till_shift_id, device_id').eq('id', id).single();
    expect(error).toBeNull();
    return data as { till_shift_id: string | null; device_id: string | null };
  }
  async function shiftRow(id: string): Promise<ShiftRow> {
    const { data, error } = await svc.from('till_shifts').select('*').eq('id', id).single();
    expect(error).toBeNull();
    return data as ShiftRow;
  }

  /** The sums over the rows carrying a shift, computed here from the raw rows. */
  async function rowSums(shiftId: string) {
    const { data: pays, error: pErr } = await svc.from('payments').select('method, amount_iqd').eq('till_shift_id', shiftId);
    expect(pErr).toBeNull();
    const { data: refs, error: rErr } = await svc
      .from('refunds')
      .select('amount_iqd, payments!inner(method)')
      .eq('till_shift_id', shiftId);
    expect(rErr).toBeNull();
    const p = (pays ?? []) as { method: string; amount_iqd: number }[];
    const r = (refs ?? []) as unknown as { amount_iqd: number; payments: { method: string } }[];
    const sum = <T>(xs: T[], f: (x: T) => boolean, v: (x: T) => number) => xs.filter(f).reduce((a, x) => a + Number(v(x)), 0);
    return {
      cashIn: sum(p, (x) => x.method === 'cash', (x) => x.amount_iqd),
      cardIn: sum(p, (x) => x.method === 'card', (x) => x.amount_iqd),
      cashOut: sum(r, (x) => x.payments.method === 'cash', (x) => x.amount_iqd),
      cardOut: sum(r, (x) => x.payments.method === 'card', (x) => x.amount_iqd),
      payN: p.length,
      refN: r.length,
    };
  }

  /** TI3 and TI10: the stamp equals the rows, and expected/variance are tied. */
  async function assertStamped(shiftId: string) {
    const row = await shiftRow(shiftId);
    expect(row.closed_at, `${shiftId} closed`).not.toBeNull();
    const s = await rowSums(shiftId);
    expect(Number(row.cash_payments_iqd)).toBe(s.cashIn);
    expect(Number(row.card_payments_iqd)).toBe(s.cardIn);
    expect(Number(row.cash_refunds_iqd)).toBe(s.cashOut);
    expect(Number(row.card_refunds_iqd)).toBe(s.cardOut);
    expect(row.payment_count).toBe(s.payN);
    expect(row.refund_count).toBe(s.refN);
    expect(Number(row.cash_expected_iqd)).toBe(Number(row.opening_float_iqd) + s.cashIn - s.cashOut);
    if (row.cash_counted_iqd === null) {
      expect(row.cash_variance_iqd).toBeNull();
    } else {
      expect(Number(row.cash_variance_iqd)).toBe(Number(row.cash_counted_iqd) - Number(row.cash_expected_iqd));
    }
    return row;
  }

  async function dayOf(id: string) {
    const { data, error } = await svc.from('day_sessions').select('*').eq('id', id).single();
    expect(error).toBeNull();
    return data as { id: string; business_date: string; opening_float_iqd: number; status: string; cash_expected_iqd: number | null; cash_variance_iqd: number | null };
  }

  async function listDay(dayId: string) {
    const day = await dayOf(dayId);
    return ok<ListResult>(
      await call(manager, 'till_shift_list', { p_from: day.business_date, p_to: day.business_date }),
      'till_shift_list',
    );
  }

  /**
   * TI6 for one day: shifts + outside = the live day summary, payments exactly,
   * refunds with the cross-day term. The outside payments are also checked
   * against the raw rows, so the identity is not the list agreeing with itself.
   */
  async function assertPartition(dayId: string) {
    const list = await listDay(dayId);
    const { data: sumRow, error } = await svc
      .from('v_day_close_summary')
      .select('cash_payments_iqd, card_payments_iqd, refunds_iqd')
      .eq('day_session_id', dayId)
      .single();
    expect(error).toBeNull();
    const summary = sumRow as { cash_payments_iqd: number; card_payments_iqd: number; refunds_iqd: number };
    const shifts = list.shifts.filter((s) => s.day_session_id === dayId);
    const outside = list.outside.filter((o) => o.day_session_id === dayId);
    const cross = list.cross_day.find((x) => x.day_session_id === dayId)!;
    expect(cross).toBeTruthy();
    const S = (xs: Record<string, unknown>[], key: string) => xs.reduce((a, r) => a + Number(r[key] ?? 0), 0);

    expect(S(shifts, 'cash_payments_iqd') + S(outside, 'cash_payments_iqd')).toBe(Number(summary.cash_payments_iqd));
    expect(S(shifts, 'card_payments_iqd') + S(outside, 'card_payments_iqd')).toBe(Number(summary.card_payments_iqd));
    const made =
      S(shifts, 'cash_refunds_iqd') + S(shifts, 'card_refunds_iqd') + S(outside, 'cash_refunds_iqd') + S(outside, 'card_refunds_iqd');
    expect(made).toBe(
      Number(summary.refunds_iqd) +
        Number(cross.earlier_days_cash_refunds_iqd) +
        Number(cross.earlier_days_card_refunds_iqd) -
        Number(cross.later_cash_refunds_iqd) -
        Number(cross.later_card_refunds_iqd),
    );

    const { data: raw, error: rawErr } = await svc
      .from('payments')
      .select('method, amount_iqd')
      .eq('day_session_id', dayId)
      .is('till_shift_id', null);
    expect(rawErr).toBeNull();
    const rawCash = ((raw ?? []) as { method: string; amount_iqd: number }[])
      .filter((p) => p.method === 'cash')
      .reduce((a, p) => a + Number(p.amount_iqd), 0);
    expect(S(outside, 'cash_payments_iqd')).toBe(rawCash);
    return { list, shifts, outside, cross, summary };
  }

  async function auditCount(action: string, shiftId: string) {
    const { count, error } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', action)
      .eq('entity_id', shiftId);
    expect(error).toBeNull();
    return count ?? 0;
  }

  async function clearPinState(ids: string[]) {
    for (const id of ids) {
      let r = await svc.schema('app').from('pin_attempts').delete().like('device_id', `${id}:%`);
      expect(r.error).toBeNull();
      r = await svc.schema('app').from('pin_grants').delete().eq('caller_id', id);
      expect(r.error).toBeNull();
    }
  }

  async function newDay(float: number) {
    await ensureTillFresh(svc);
    const id = await openFreshDay(manager, float);
    days.push(id);
    return id;
  }

  const OUR_STAFF = [
    SEED_STAFF_IDS.cashier,
    SEED_STAFF_IDS.cashier_b,
    SEED_STAFF_IDS.court_desk,
    SEED_STAFF_IDS.manager,
    SEED_STAFF_IDS.owner,
  ];

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    cashierB = await signedInClient(SEED_STAFF.cashier_b);
    desk = await signedInClient(SEED_STAFF.court_desk);
    prep = await signedInClient(SEED_STAFF.prep);
    guest = await anonymousSessionClient();
    anon = anonClient();

    // Venue B exists only as an inactive venue outside multi-venue.test.ts.
    const vb = await svc.from('venues').upsert(
      {
        id: VENUE_B_ID,
        slug: 'probe-venue-b',
        name_en: 'Probe Venue B',
        name_ar: 'فرع تجريبي ب',
        timezone: 'Asia/Baghdad',
        is_active: false,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    expect(vb.error).toBeNull();
    const reg = await svc.from('stations').upsert(
      [
        ...[A, B, C, D, DESK].map((id) => ({ id, venue_id: VENUE_A_ID, is_till: false, retired_at: null, registered_by: SEED_STAFF_IDS.manager })),
        { id: RETIRED, venue_id: VENUE_A_ID, is_till: false, retired_at: new Date().toISOString(), registered_by: SEED_STAFF_IDS.manager },
        { id: VB, venue_id: VENUE_B_ID, is_till: false, retired_at: null, registered_by: SEED_STAFF_IDS.manager },
      ],
      { onConflict: 'id' },
    );
    expect(reg.error).toBeNull();
    const hb = await svc.from('device_heartbeats').delete().in('device_id', [...OURS, VB]);
    expect(hb.error).toBeNull();

    for (const role of DENIED_ROLES) {
      const email = `till-shifts-${role}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      deniedIds[role] = data.user.id;
      const ins = await svc.from('staff').insert({ id: data.user.id, display_name: `Till shifts ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      denied[role] = await signedInClient(email);
    }

    // The seed gives PINs to the manager and owner only; cashier_b stays
    // without one on purpose.
    for (const [id, pin] of [
      [SEED_STAFF_IDS.cashier, CASHIER_PIN],
      [SEED_STAFF_IDS.court_desk, DESK_PIN],
    ] as const) {
      ok(await call(owner, 'set_staff_pin', { p_staff_id: id, p_pin: pin }), `set_staff_pin ${id}`);
    }
    ok(await call(owner, 'clear_staff_pin', { p_staff_id: SEED_STAFF_IDS.cashier_b }), 'clear_staff_pin cashier_b');
    await clearPinState(OUR_STAFF);

    ten = await createTestMenuItem(svc, 'till-shifts-10k', 10_000);
    one = await createTestMenuItem(svc, 'till-shifts-1k', 1_000);
    courtId = await createTestCourt(svc, `Till Shifts ${Date.now()}`);
    tableId = await createTestCafeTable(svc, 'till-shifts');

    // A pristine day: every earlier one closed (any shift a previous run left
    // open is then on a closed day, and the next open heals it).
    await ensureTillFresh(svc);
    await forceCloseAllDays(svc);
  });

  afterAll(async () => {
    if (!svc) return;
    // Nothing open is left behind: no day, and no shift on our stations or of
    // our principals (the last scenario closes D4 through close_day).
    const { data: openShifts } = await svc
      .from('till_shifts')
      .select('id, station_id, staff_id')
      .is('closed_at', null)
      .or(`station_id.in.(${OURS.join(',')}),staff_id.in.(${OUR_STAFF.join(',')})`);
    expect(openShifts ?? []).toEqual([]);

    let r = await svc.from('till_shifts').delete().eq('id', vbShift);
    expect(r.error).toBeNull();
    r = await svc.from('day_sessions').delete().eq('id', vbDay);
    expect(r.error).toBeNull();
    r = await svc.from('device_heartbeats').delete().in('device_id', [...OURS, VB]);
    expect(r.error).toBeNull();
    // The shifts name the stations, so they are retired, not deleted.
    r = await svc.from('stations').update({ retired_at: new Date().toISOString() }).in('id', [...OURS, VB]);
    expect(r.error).toBeNull();

    await clearPinState(OUR_STAFF);
    for (const id of [SEED_STAFF_IDS.cashier, SEED_STAFF_IDS.court_desk]) {
      await call(owner, 'clear_staff_pin', { p_staff_id: id });
    }
    for (const role of DENIED_ROLES) await denied[role]?.auth.signOut();
    for (const id of Object.values(deniedIds)) {
      r = await svc.from('staff').delete().eq('id', id);
      expect(r.error, `staff delete ${id}`).toBeNull();
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const c of [owner, manager, cashier, cashierB, desk, prep, guest]) await c?.auth.signOut();
  });

  // ── T2 ───────────────────────────────────────────────────────────────────
  it('T2: only the till, the desk and MGMT hold a shift; the list is MGMT only', async () => {
    const probes: [string, Record<string, unknown>][] = [
      ['open_till_shift', { p_opening_float_iqd: 0, p_device_id: A }],
      ['close_till_shift', { p_till_shift_id: probeId('75d0'), p_counted_iqd: 0, p_pin: '000000', p_device_id: A }],
      ['close_till_shift_for', { p_till_shift_id: probeId('75d0'), p_counted_iqd: 0, p_device_id: A }],
      ['till_shift_status', { p_device_id: A }],
      ['till_shift_list', {}],
    ];
    for (const who of [...DENIED_ROLES.map((r) => [r, denied[r]] as const), ['prep', prep] as const, ['guest', guest] as const]) {
      for (const [fn, args] of probes) {
        expect(code(await call(who[1], fn, args)), `${who[0]} ${fn}`).toBe('FORBIDDEN');
      }
    }
    for (const [who, c] of [['cashier', cashier], ['court_desk', desk]] as const) {
      expect(code(await call(c, 'till_shift_list', {})), `${who} till_shift_list`).toBe('FORBIDDEN');
    }
    for (const [fn, args] of probes) {
      expect(code(await call(anon, fn, args)), `anon ${fn}`).toMatch(/permission denied/i);
    }
    // A refused principal wrote nothing: the probe principals hold no shift.
    const { data } = await svc.from('till_shifts').select('id').in('staff_id', Object.values(deniedIds));
    expect(data).toEqual([]);
  });

  // ── T1 ───────────────────────────────────────────────────────────────────
  let shiftA: string;
  const openKeyA = k('till_shift.open');

  it('T1: the argument and station refusals, and NO_OPEN_DAY', async () => {
    await beat(cashier, A);
    const args = (extra: Record<string, unknown>) => ({ p_opening_float_iqd: 100_000, p_device_id: A, ...extra });
    expect(code(await call(cashier, 'open_till_shift', args({ p_device_id: 'till 1' })))).toBe('INVALID_STATION');
    expect(code(await call(cashier, 'open_till_shift', args({ p_device_id: null })))).toBe('INVALID_STATION');
    for (const station of [RETIRED, VB, NOWHERE]) {
      expect(code(await call(cashier, 'open_till_shift', args({ p_device_id: station }))), station).toBe('STATION_UNKNOWN');
    }
    // No fresh beat from this session at B.
    expect(code(await call(cashier, 'open_till_shift', args({ p_device_id: B })))).toBe('TILL_SHIFT_WRONG_STATION');
    // A beat from someone else at A does not count for the cashier.
    await beat(cashierB, A);
    expect(code(await call(cashier, 'open_till_shift', args({})))).toBe('TILL_SHIFT_WRONG_STATION');
    // Nor does her own beat once it is older than a minute.
    await beat(cashier, A);
    const aged = await svc
      .from('device_heartbeats')
      .update({ last_seen_at: new Date(Date.now() - 120_000).toISOString() })
      .eq('device_id', A);
    expect(aged.error).toBeNull();
    expect(code(await call(cashier, 'open_till_shift', args({})))).toBe('TILL_SHIFT_WRONG_STATION');

    await beat(cashier, A);
    expect(code(await call(cashier, 'open_till_shift', args({ p_opening_float_iqd: -1 })))).toBe('INVALID_FLOAT');
    expect(code(await call(cashier, 'open_till_shift', args({ p_opening_float_iqd: null })))).toBe('INVALID_FLOAT');
    const long = await call(cashier, 'open_till_shift', args({ p_note: 'x'.repeat(501) }));
    expect(code(long)).toBe('TEXT_TOO_LONG');
    expect(long.error?.hint).toBe('note');
    // Every day is closed (beforeAll).
    // The claim is taken before the day is read; the refusal rolls it back,
    // so the next case opens with this same key.
    expect(code(await call(cashier, 'open_till_shift', args({ p_idempotency_key: openKeyA })))).toBe('NO_OPEN_DAY');

    d1 = await newDay(100_000);
  });

  it('T1: opens the shift, replays by key, and refuses a second shift for the person or the station', async () => {
    await beat(cashier, A);
    const res = ok<OpenResult>(
      await call(cashier, 'open_till_shift', {
        p_opening_float_iqd: 100_000,
        p_device_id: A,
        p_note: '  first float  ',
        p_idempotency_key: openKeyA,
      }),
    );
    expect(res.duplicate).toBe(false);
    shiftA = res.till_shift.id;
    expect(res.till_shift).toMatchObject({
      station_id: A,
      staff_id: SEED_STAFF_IDS.cashier,
      opening_float_iqd: 100_000,
      handover_from: null,
      handover_difference_iqd: null,
    });
    const row = await shiftRow(shiftA);
    expect(row).toMatchObject({
      venue_id: VENUE_A_ID,
      day_session_id: d1,
      station_id: A,
      staff_id: SEED_STAFF_IDS.cashier,
      open_note: 'first float',
      handover_from_shift_id: null,
      closed_at: null,
    });
    // The audit row is the shift minus the notes.
    const { data: audit } = await svc
      .from('audit_log')
      .select('after, device_id, actor_id')
      .eq('action', 'drawer.shift_open')
      .eq('entity_id', shiftA);
    expect(audit).toHaveLength(1);
    const a = (audit as { after: Record<string, unknown>; device_id: string; actor_id: string }[])[0]!;
    expect(a.device_id).toBe(A);
    expect(a.actor_id).toBe(SEED_STAFF_IDS.cashier);
    expect(a.after.id).toBe(shiftA);
    expect('open_note' in a.after).toBe(false);
    expect('close_note' in a.after).toBe(false);

    // Replay: the stored result, flagged, and nothing new.
    await beat(cashier, A);
    const again = ok<OpenResult>(
      await call(cashier, 'open_till_shift', { p_opening_float_iqd: 100_000, p_device_id: A, p_idempotency_key: openKeyA }),
    );
    expect(again.duplicate).toBe(true);
    expect(again.till_shift.id).toBe(shiftA);
    expect(await auditCount('drawer.shift_open', shiftA)).toBe(1);

    // Another person's key.
    await beat(cashierB, B);
    expect(
      code(await call(cashierB, 'open_till_shift', { p_opening_float_iqd: 0, p_device_id: B, p_idempotency_key: openKeyA })),
    ).toBe('IDEMPOTENCY_CONFLICT');
    // One open shift per person: the detail names where it is.
    await beat(cashier, B);
    const mine = await call(cashier, 'open_till_shift', { p_opening_float_iqd: 0, p_device_id: B });
    expect(code(mine)).toBe('TILL_SHIFT_ALREADY_OPEN');
    expect(mine.error?.details).toBe(A);
    // One open shift per station.
    await beat(cashierB, A);
    expect(code(await call(cashierB, 'open_till_shift', { p_opening_float_iqd: 0, p_device_id: A }))).toBe(
      'TILL_SHIFT_STATION_BUSY',
    );
  });

  it('T1: two opens by one person at once — one shift, and the loser gets TILL_SHIFT_ALREADY_OPEN', async () => {
    await beat(cashierB, C);
    await beat(cashierB, D);
    const [x, y] = await Promise.all([
      call(cashierB, 'open_till_shift', { p_opening_float_iqd: 0, p_device_id: C }),
      call(cashierB, 'open_till_shift', { p_opening_float_iqd: 0, p_device_id: D }),
    ]);
    const outcomes = [x, y].map((r) => (r.error ? r.error.message : 'ok')).sort();
    expect(outcomes).toEqual(['TILL_SHIFT_ALREADY_OPEN', 'ok']);
    const won = (x.error ? y : x).data as OpenResult;
    const closed = ok<CloseResult>(await closeFor(cashierB, won.till_shift.id, 0, won.till_shift.station_id));
    expect(closed).toMatchObject({ ok: true, closed_via: 'manager_pin', cash_variance_iqd: 0 });
  });

  // ── T3 ───────────────────────────────────────────────────────────────────
  // Ledger for shift A, kept here from what the test did, not from the server.
  const ledgerA = { cashIn: 0, cardIn: 0, cashOut: 0, cardOut: 0, payN: 0, refN: 0 };
  let yesterdayCash30k: string; // D1's 30,000 cash payment at A, refunded on D2 (T16)
  let cardSaleTab: string;

  it('T3: payments and refunds carry the shift open at their station, or null', async () => {
    const y = await sale(cashier, A, 30_000);
    yesterdayCash30k = y.paymentId;
    expect(await paymentShift(y.paymentId)).toEqual({ till_shift_id: shiftA, device_id: A });
    ledgerA.cashIn += 30_000;
    ledgerA.payN += 1;

    const card = await sale(cashier, A, 12_000, 'card');
    cardSaleTab = card.tabId;
    expect((await paymentShift(card.paymentId)).till_shift_id).toBe(shiftA);
    ledgerA.cardIn += 12_000;
    ledgerA.payN += 1;

    // The desk with no shift open: outside.
    const deskNoShift = await sale(desk, DESK, 4_000);
    expect(await paymentShift(deskNoShift.paymentId)).toEqual({ till_shift_id: null, device_id: DESK });
    // No device named: outside.
    const noDevice = await sale(manager, null, 2_000);
    expect(await paymentShift(noDevice.paymentId)).toEqual({ till_shift_id: null, device_id: null });

    // V1: a manager's refund at the till, with the device, succeeds and is
    // stamped (the shared-SELECT trigger raised here).
    const forRefund = await sale(cashier, A, 10_000);
    ledgerA.cashIn += 10_000;
    ledgerA.payN += 1;
    const refundId = await refundAt(A, forRefund.paymentId, 2_000);
    expect(await refundShift(refundId)).toEqual({ till_shift_id: shiftA, device_id: A });
    ledgerA.cashOut += 2_000;
    ledgerA.refN += 1;

    // A supplied till_shift_id is overwritten, whoever writes the row.
    const bogus = crypto.randomUUID();
    const ins = await svc
      .from('payments')
      .insert([
        { tab_id: cardSaleTab, day_session_id: d1, method: 'cash', amount_iqd: 1_000, recorded_by: SEED_STAFF_IDS.manager, device_id: null, till_shift_id: bogus },
        { tab_id: cardSaleTab, day_session_id: d1, method: 'cash', amount_iqd: 1_000, recorded_by: SEED_STAFF_IDS.manager, device_id: A, till_shift_id: bogus },
      ])
      .select('device_id, till_shift_id');
    expect(ins.error).toBeNull();
    expect(ins.data).toEqual([
      { device_id: null, till_shift_id: null },
      { device_id: A, till_shift_id: shiftA },
    ]);
    ledgerA.cashIn += 1_000;
    ledgerA.payN += 1;
    const { data: cardPay } = await svc.from('payments').select('id').eq('tab_id', cardSaleTab).eq('method', 'card').single();
    const rins = await svc
      .from('refunds')
      .insert({
        payment_id: (cardPay as { id: string }).id,
        amount_iqd: 1_000,
        reason_code: 'till-shifts-test',
        refunded_by: SEED_STAFF_IDS.manager,
        device_id: A,
        till_shift_id: bogus,
      })
      .select('till_shift_id')
      .single();
    expect(rins.error).toBeNull();
    expect((rins.data as { till_shift_id: string }).till_shift_id).toBe(shiftA);
    ledgerA.cardOut += 1_000;
    ledgerA.refN += 1;
  });

  it('T14 (TI12): the status is blind to a cashier and the desk, and shows MGMT the running expected cash', async () => {
    const own = await status(cashier, A);
    expect(own.shift).toMatchObject({ id: shiftA, is_mine: true, opening_float_iqd: 100_000, payment_count: ledgerA.payN });
    expect(own.shift && 'cash_expected_iqd' in own.shift).toBe(false);
    expect(own.day?.id).toBe(d1);
    const theirs = await status(desk, A);
    expect(theirs.shift?.is_mine).toBe(false);
    expect(theirs.shift && 'cash_expected_iqd' in theirs.shift).toBe(false);
    const mgmt = await status(manager, A);
    expect(mgmt.shift?.cash_expected_iqd).toBe(100_000 + ledgerA.cashIn - ledgerA.cashOut);
    // The table itself is MGMT's: a cashier and the desk read nothing.
    for (const c of [cashier, desk, prep, guest]) {
      const { data, error } = await c.from('till_shifts').select('id').eq('id', shiftA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    expect(code(await call(cashier, 'till_shift_status', { p_device_id: 'bad id' }))).toBe('INVALID_STATION');
    expect(code(await call(cashier, 'till_shift_status', { p_device_id: VB }))).toBe('STATION_UNKNOWN');
  });

  // ── §2.9.9 the desk ──────────────────────────────────────────────────────
  it('§2.9.9: a desk shift counts the desk cash box; court payments, a prepayment and a desk refund land in it, never in the till shift', async () => {
    const ds1 = await open(desk, DESK, 50_000);
    const start = new Date(Date.now() + 45 * 86_400_000);
    start.setUTCHours(12, 0, 0, 0);
    const { data: resv, error: rErr } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
        guest_name: 'Till Shifts Test',
        price_iqd: 30_000,
      })
      .select('id')
      .single();
    expect(rErr).toBeNull();
    const bookingTab = ok<{ tab_id: string }>(
      await call(desk, 'open_tab', { p_reservation_id: (resv as { id: string }).id, p_idempotency_key: testIdemKey('tab.open') }),
    ).tab_id;
    // The prepayment, then the rest, both at the desk.
    const pre = ok<{ payment_id: string; status: string }>(await call(desk, 'settle_tab', payArgs(bookingTab, 'cash', 10_000, DESK, true)));
    expect(pre.status).toBe('awaiting_payment');
    const rest = ok<{ payment_id: string; status: string }>(await call(desk, 'settle_tab', payArgs(bookingTab, 'cash', 20_000, DESK)));
    expect(rest.status).toBe('settled');
    expect((await paymentShift(pre.payment_id)).till_shift_id).toBe(ds1.id);
    expect((await paymentShift(rest.payment_id)).till_shift_id).toBe(ds1.id);
    // The till's shift is open at the same time; its sale stays at the till.
    const tillSale = await sale(cashier, A, 3_000);
    expect((await paymentShift(tillSale.paymentId)).till_shift_id).toBe(shiftA);
    ledgerA.cashIn += 3_000;
    ledgerA.payN += 1;
    // A manager refunds at the desk: out of the desk box.
    const deskRefund = await refundAt(DESK, rest.payment_id, 5_000);
    expect(await refundShift(deskRefund)).toEqual({ till_shift_id: ds1.id, device_id: DESK });

    const mgmt = await status(manager, DESK);
    expect(mgmt.shift?.cash_expected_iqd).toBe(50_000 + 30_000 - 5_000);
    const own = await status(desk, DESK);
    expect(own.shift?.is_mine).toBe(true);
    expect(own.shift && 'cash_expected_iqd' in own.shift).toBe(false);

    // A close with a difference: 1,000 over.
    const closed = ok<CloseResult>(await closeOwn(desk, ds1.id, 76_000, DESK_PIN, DESK));
    expect(closed).toMatchObject({
      ok: true,
      closed_via: 'own_pin',
      cash_payments_iqd: 30_000,
      cash_refunds_iqd: 5_000,
      cash_expected_iqd: 75_000,
      cash_counted_iqd: 76_000,
      cash_variance_iqd: 1_000,
      payment_count: 2,
      refund_count: 1,
      left_in_drawer_iqd: 76_000,
    });
    await assertStamped(ds1.id);

    // The handover at the desk: the manager takes the box as counted.
    const ds2 = await open(manager, DESK, 76_000);
    expect(ds2.handover_from).toMatchObject({ till_shift_id: ds1.id, left_in_drawer_iqd: 76_000, outside_cash_since_iqd: 0 });
    expect(ds2.handover_difference_iqd).toBe(0);
    ok(await closeOwn(manager, ds2.id, 76_000, DEV_PINS.manager, DESK));
    await assertStamped(ds2.id);

    // Without mixing: every row a shift carries came from its own station.
    for (const [shift, station] of [[ds1.id, DESK], [shiftA, A]] as const) {
      const { data: pays } = await svc.from('payments').select('device_id').eq('till_shift_id', shift);
      const { data: refs } = await svc.from('refunds').select('device_id').eq('till_shift_id', shift);
      for (const r of [...(pays ?? []), ...(refs ?? [])] as { device_id: string }[]) expect(r.device_id).toBe(station);
    }
  });

  // ── T4 ───────────────────────────────────────────────────────────────────
  it('T4 (TI13): a wrong own PIN is returned and counted; five lock; no PIN set is its own code', async () => {
    await clearPinState([SEED_STAFF_IDS.cashier]);
    const wrong = await closeOwn(cashier, shiftA, 0, '000000', A);
    expect(wrong.error).toBeNull();
    expect(wrong.data).toEqual({ ok: false, code: 'PIN_INVALID' });
    const { data: attempts } = await svc
      .schema('app')
      .from('pin_attempts')
      .select('success')
      .eq('device_id', `${SEED_STAFF_IDS.cashier}:self:${A}`);
    expect((attempts as { success: boolean }[]).some((x) => !x.success)).toBe(true);
    expect((await shiftRow(shiftA)).closed_at).toBeNull();

    for (let i = 0; i < 4; i++) {
      expect((await closeOwn(cashier, shiftA, 0, '000000', A)).data).toEqual({ ok: false, code: 'PIN_INVALID' });
    }
    expect(code(await closeOwn(cashier, shiftA, 0, CASHIER_PIN, A))).toBe('PIN_LOCKED');
    await clearPinState([SEED_STAFF_IDS.cashier]);

    expect(code(await closeOwn(cashierB, shiftA, 0, '123456', A))).toBe('NO_PIN_SET');
  });

  it('T4: someone else\'s shift, the wrong station and a queue refuse; the right PIN stamps the math once', async () => {
    expect(code(await closeOwn(desk, shiftA, 0, DESK_PIN, A))).toBe('TILL_SHIFT_NOT_YOURS');
    await beat(cashier, B);
    expect(
      code(await call(cashier, 'close_till_shift', { p_till_shift_id: shiftA, p_counted_iqd: 0, p_pin: CASHIER_PIN, p_device_id: B })),
    ).toBe('TILL_SHIFT_WRONG_STATION');
    // The right station, but the last beat there is someone else's.
    await beat(desk, A);
    expect(
      code(await call(cashier, 'close_till_shift', { p_till_shift_id: shiftA, p_counted_iqd: 0, p_pin: CASHIER_PIN, p_device_id: A })),
    ).toBe('TILL_SHIFT_WRONG_STATION');
    expect(code(await call(cashier, 'close_till_shift', { p_till_shift_id: probeId('75d0'), p_counted_iqd: 0, p_pin: CASHIER_PIN, p_device_id: A }))).toBe(
      'TILL_SHIFT_NOT_FOUND',
    );
    for (const bad of [-1, null, 1_000_000_000_000]) {
      expect(code(await closeOwn(cashier, shiftA, bad as number, CASHIER_PIN, A)), String(bad)).toBe('INVALID_COUNT');
    }
    // T5: a queue reported since the shift opened.
    await beat(cashier, A, 2);
    expect(
      code(await call(cashier, 'close_till_shift', { p_till_shift_id: shiftA, p_counted_iqd: 0, p_pin: CASHIER_PIN, p_device_id: A })),
    ).toBe('TILL_SHIFT_UNSYNCED');

    const expected = 100_000 + ledgerA.cashIn - ledgerA.cashOut;
    const key = k('till_shift.close');
    await beat(cashier, A);
    const res = await call(cashier, 'close_till_shift', {
      p_till_shift_id: shiftA,
      p_counted_iqd: expected - 1_000,
      p_pin: CASHIER_PIN,
      p_device_id: A,
      p_note: 'one note short',
      p_idempotency_key: key,
    });
    const closed = ok<CloseResult>(res);
    expect(closed).toMatchObject({
      ok: true,
      duplicate: false,
      till_shift_id: shiftA,
      station_id: A,
      closed_via: 'own_pin',
      opening_float_iqd: 100_000,
      cash_payments_iqd: ledgerA.cashIn,
      cash_refunds_iqd: ledgerA.cashOut,
      card_payments_iqd: ledgerA.cardIn,
      card_refunds_iqd: ledgerA.cardOut,
      payment_count: ledgerA.payN,
      refund_count: ledgerA.refN,
      cash_expected_iqd: expected,
      cash_counted_iqd: expected - 1_000,
      cash_variance_iqd: -1_000,
      left_in_drawer_iqd: expected - 1_000,
    });
    const row = await assertStamped(shiftA);
    expect(row).toMatchObject({ closed_by: SEED_STAFF_IDS.cashier, authorized_by: SEED_STAFF_IDS.cashier, close_note: 'one note short' });

    // TI14: the retry echoes the first result, and the close is audited once.
    await beat(cashier, A);
    const retry = ok<CloseResult>(
      await call(cashier, 'close_till_shift', {
        p_till_shift_id: shiftA,
        p_counted_iqd: expected - 1_000,
        p_pin: CASHIER_PIN,
        p_device_id: A,
        p_idempotency_key: key,
      }),
    );
    expect(retry.duplicate).toBe(true);
    expect({ ...retry, duplicate: false }).toEqual(closed);
    expect(await auditCount('drawer.shift_close', shiftA)).toBe(1);
    const { data: audit } = await svc.from('audit_log').select('after').eq('action', 'drawer.shift_close').eq('entity_id', shiftA).single();
    const after = (audit as { after: Record<string, unknown> }).after;
    expect(after.cash_variance_iqd).toBe(-1_000);
    expect('close_note' in after).toBe(false);
    expect('open_note' in after).toBe(false);

    // A new press on a closed shift.
    await beat(cashier, A);
    expect(
      code(await call(cashier, 'close_till_shift', { p_till_shift_id: shiftA, p_counted_iqd: 0, p_pin: CASHIER_PIN, p_device_id: A })),
    ).toBe('TILL_SHIFT_CLOSED');
  });

  // ── T5 ───────────────────────────────────────────────────────────────────
  it('T5 (TI11, V13): no open while the till reports a queue; the replayed sale lands outside, not in the new shift', async () => {
    const leftA = Number((await shiftRow(shiftA)).cash_counted_iqd);
    await beat(cashier, A, 3);
    expect(code(await call(cashier, 'open_till_shift', { p_opening_float_iqd: leftA, p_device_id: A }))).toBe('TILL_SHIFT_UNSYNCED');
    // The queue drains: the sale lands with no shift open at A.
    const replayed = await sale(cashier, A, 7_000);
    expect((await paymentShift(replayed.paymentId)).till_shift_id).toBeNull();
    // The start panel's prefill is the count plus the cash that came in since.
    const s = await status(cashier, A);
    expect(s.shift).toBeNull();
    expect(s.last_closed).toMatchObject({ id: shiftA, left_in_drawer_iqd: leftA, outside_cash_since_iqd: 7_000 });
    expect(s.queue_depth).toBe(3);

    await beat(cashier, A, 0);
    const a2 = await open(cashier, A, leftA + 7_000);
    expect(a2.handover_from).toMatchObject({ till_shift_id: shiftA, left_in_drawer_iqd: leftA, outside_cash_since_iqd: 7_000 });
    expect(a2.handover_difference_iqd).toBe(0);
    expect((await paymentShift(replayed.paymentId)).till_shift_id).toBeNull();

    // A queue last reported BEFORE the shift opened does not block its close.
    const { data: hb } = await svc.from('device_heartbeats').select('last_seen_at').eq('device_id', A).single();
    expect(new Date((hb as { last_seen_at: string }).last_seen_at) < new Date((await shiftRow(a2.id)).opened_at)).toBe(true);
    const q = await svc.from('device_heartbeats').update({ queue_depth: 4 }).eq('device_id', A);
    expect(q.error).toBeNull();
    const closed = ok<CloseResult>(
      await call(cashier, 'close_till_shift', {
        p_till_shift_id: a2.id,
        p_counted_iqd: leftA + 7_000,
        p_pin: CASHIER_PIN,
        p_device_id: A,
      }),
    );
    expect(closed).toMatchObject({ ok: true, cash_variance_iqd: 0 });
    await assertStamped(a2.id);
    await beat(cashier, A, 0);
  });

  // ── T9 ───────────────────────────────────────────────────────────────────
  it('T9 (TI3): settle_tab racing close_till_shift — the payment carries the shift or null, never the shift while missing from its sum', async () => {
    const landed = { inShift: 0, outside: 0 };
    for (let round = 0; round < 20; round++) {
      const amount = 1_000 * (round + 1);
      const tabId = await tabWith(amount);
      const s = await open(cashier, A, 0);
      const [paid, closed] = await Promise.all([
        // Stagger half the rounds past the close's PIN floor (250 ms), so both
        // orders are exercised.
        sleep(round % 2 === 0 ? 0 : 260).then(() => call(manager, 'settle_tab', payArgs(tabId, 'cash', amount, A))),
        call(cashier, 'close_till_shift', { p_till_shift_id: s.id, p_counted_iqd: 0, p_pin: CASHIER_PIN, p_device_id: A }),
      ]);
      const p = ok<{ payment_id: string }>(paid, `round ${round} settle`);
      expect(ok<CloseResult>(closed, `round ${round} close`).ok).toBe(true);
      const at = (await paymentShift(p.payment_id)).till_shift_id;
      expect([s.id, null]).toContain(at);
      const row = await assertStamped(s.id);
      expect(Number(row.cash_payments_iqd)).toBe(at === s.id ? amount : 0);
      if (at === s.id) landed.inShift += 1;
      else landed.outside += 1;
    }
    expect(landed.inShift + landed.outside).toBe(20);
  }, 120_000);

  // ── T7 + T6 ──────────────────────────────────────────────────────────────
  let b4: string;

  it('T6 + T7 (V18): the manager-PIN close, and the handover difference with cash in and out between shifts', async () => {
    // B1: cashier_b, no PIN of her own.
    const b1 = await open(cashierB, B, 200_000);
    expect(b1.handover_from).toBeNull();
    const p50 = await sale(cashierB, B, 50_000);
    expect((await paymentShift(p50.paymentId)).till_shift_id).toBe(b1.id);

    // T6: no grant, then the same key once the manager has entered the PIN.
    await clearPinState([SEED_STAFF_IDS.cashier_b]);
    const key = k('till_shift.close');
    await beat(cashierB, B);
    expect(
      code(await call(cashierB, 'close_till_shift_for', { p_till_shift_id: b1.id, p_counted_iqd: 250_000, p_device_id: B, p_idempotency_key: key })),
    ).toBe('PIN_GRANT_REQUIRED');
    const c1 = ok<CloseResult>(await closeFor(cashierB, b1.id, 250_000, B, key));
    expect(c1).toMatchObject({ ok: true, closed_via: 'manager_pin', cash_expected_iqd: 250_000, cash_variance_iqd: 0 });
    expect(await assertStamped(b1.id)).toMatchObject({ closed_by: SEED_STAFF_IDS.cashier_b, authorized_by: SEED_STAFF_IDS.manager });
    const { data: au } = await svc.from('audit_log').select('authorizer_id').eq('action', 'drawer.shift_close').eq('entity_id', b1.id).single();
    expect((au as { authorizer_id: string }).authorizer_id).toBe(SEED_STAFF_IDS.manager);

    // (a) A count of 250,000, then a float of 245,000.
    const b2 = await open(cashier, B, 245_000);
    expect(b2.handover_from).toMatchObject({ till_shift_id: b1.id, left_in_drawer_iqd: 250_000, outside_cash_since_iqd: 0 });
    expect(b2.handover_difference_iqd).toBe(-5_000);
    expect((await shiftRow(b2.id)).handover_from_shift_id).toBe(b1.id);
    // (b) After the open the sale is B2's.
    const inB2 = await sale(cashier, B, 10_000);
    expect((await paymentShift(inB2.paymentId)).till_shift_id).toBe(b2.id);
    ok(await closeOwn(cashier, b2.id, 255_000, CASHIER_PIN, B));
    await assertStamped(b2.id);

    // (b) Between the close and the next open: outside. (c) 20,000 of cash in.
    const between = await sale(manager, B, 20_000);
    expect((await paymentShift(between.paymentId)).till_shift_id).toBeNull();
    const s = await status(cashierB, B);
    expect(s.last_closed).toMatchObject({ id: b2.id, left_in_drawer_iqd: 255_000, outside_cash_since_iqd: 20_000 });
    const b3 = await open(cashierB, B, 275_000);
    expect(b3.handover_from).toMatchObject({ till_shift_id: b2.id, outside_cash_since_iqd: 20_000 });
    expect(b3.handover_difference_iqd).toBe(0);
    // A manager closes someone else's shift with the PIN.
    const c3 = ok<CloseResult>(await closeFor(manager, b3.id, 275_000, B));
    expect(c3).toMatchObject({ closed_via: 'manager_pin', cash_variance_iqd: 0 });

    // (d) A manager's 5,000 cash refund with no shift open: cash out.
    const out = await refundAt(B, p50.paymentId, 5_000);
    expect(await refundShift(out)).toEqual({ till_shift_id: null, device_id: B });
    const b4r = await open(cashier, B, 270_000);
    expect(b4r.handover_from).toMatchObject({ till_shift_id: b3.id, left_in_drawer_iqd: 275_000, outside_cash_since_iqd: -5_000 });
    expect(b4r.handover_difference_iqd).toBe(0);
    b4 = b4r.id;
    const mine = await status(cashier, A);
    expect(mine.mine_elsewhere).toMatchObject({ id: b4, station_id: B });
  });

  // ── races with a psql session of their own ───────────────────────────────
  const settleSql = (tabId: string, amount: number, station: string) =>
    asStaff(
      SEED_STAFF_IDS.manager,
      `select app.settle_tab(p_tab_id => '${tabId}', p_method => 'cash', p_tendered_iqd => ${amount},
                             p_idempotency_key => '${testIdemKey('tab.settle')}', p_device_id => '${station}')`,
    );
  async function waitFor(check: () => boolean, ms = 10_000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (check()) return;
      await sleep(50);
    }
    throw new Error('waitFor: timed out');
  }

  it('V18: a cash payment that began before a close and landed after it is outside cash at the next open', async () => {
    const tabId = await tabWith(7_000);
    const s = await open(cashierB, C, 100_000);
    // The settle's transaction starts (created_at = now()) and only writes
    // after the close has committed, so its stamp finds no open shift.
    const paying = psqlSession(`
set application_name = 'ts-race-pay';
begin;
select pg_sleep(3);
${settleSql(tabId, 7_000, C)}
commit;`);
    try {
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'ts-race-pay' and query like '%pg_sleep%'`) === '1');
      expect(ok<CloseResult>(await closeFor(cashierB, s.id, 100_000, C))).toMatchObject({ ok: true, cash_payments_iqd: 0 });
      await paying;
    } finally {
      await paying.catch(() => undefined);
    }
    const { data: late, error } = await svc.from('payments').select('till_shift_id, created_at').eq('tab_id', tabId).single();
    expect(error).toBeNull();
    const pay = late as { till_shift_id: string | null; created_at: string };
    expect(pay.till_shift_id).toBeNull();
    expect(new Date(pay.created_at).getTime()).toBeLessThan(new Date((await shiftRow(s.id)).closed_at!).getTime());
    // The start panel and the handover both count it.
    expect((await status(cashierB, C)).last_closed).toMatchObject({ id: s.id, left_in_drawer_iqd: 100_000, outside_cash_since_iqd: 7_000 });
    const next = await open(cashierB, C, 107_000);
    expect(next.handover_from).toMatchObject({ till_shift_id: s.id, outside_cash_since_iqd: 7_000 });
    expect(next.handover_difference_iqd).toBe(0);
    expect(ok<CloseResult>(await closeFor(cashierB, next.id, 107_000, C))).toMatchObject({ ok: true, cash_variance_iqd: 0 });
  });

  it('TI3: the close internal locks the shift itself, so a payment in flight is in its sums whoever calls it', async () => {
    const tabId = await tabWith(3_000);
    const s = await open(cashierB, C, 0);
    // The payment is stamped (the trigger holds the shift FOR SHARE) and its
    // transaction stays open.
    const paying = psqlSession(`
set application_name = 'ts-hold-pay';
begin;
${settleSql(tabId, 3_000, C)}
select pg_sleep(2);
commit;`);
    let closing: Promise<string> | null = null;
    try {
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'ts-hold-pay' and query like '%pg_sleep%'`) === '1');
      // A caller that did not lock the shift first (every RPC does).
      closing = psqlSession(`
set application_name = 'ts-bare-close';
begin;
select set_config('request.jwt.claims', '${JSON.stringify({ sub: SEED_STAFF_IDS.cashier_b, role: 'authenticated' })}', true);
select app.close_till_shift_internal(s, 3000, null, 'own_pin', null, '${C}')->>'cash_payments_iqd'
  from till_shifts s where s.id = '${s.id}';
commit;`);
      await paying;
      expect((await closing).split('\n').pop()).toBe('3000');
    } finally {
      await paying.catch(() => undefined);
      await closing?.catch(() => undefined);
    }
    expect(await assertStamped(s.id)).toMatchObject({ cash_payments_iqd: 3_000, cash_variance_iqd: 0 });
  });

  // ── T8 ───────────────────────────────────────────────────────────────────
  it('T8 (TI5, TI9, TI6): close_day refuses first and leaves the shift, then ends it with the day on the 0020 math', async () => {
    const pending = await tabWith(1_000);
    expect(code(await call(manager, 'close_day', { p_cash_counted_iqd: 0 }))).toBe('DAY_OPEN_TABS');
    expect((await shiftRow(b4)).closed_at).toBeNull();
    const voided = await svc.from('tabs').update({ status: 'void' }).eq('id', pending);
    expect(voided.error).toBeNull();

    // The 0020 formula, computed here from the raw rows.
    const day = await dayOf(d1);
    const { data: pays } = await svc.from('payments').select('amount_iqd').eq('day_session_id', d1).eq('method', 'cash');
    const { data: refs } = await svc
      .from('refunds')
      .select('amount_iqd, payments!inner(day_session_id, method)')
      .eq('payments.day_session_id', d1)
      .eq('payments.method', 'cash');
    const cashIn = ((pays ?? []) as { amount_iqd: number }[]).reduce((a, p) => a + Number(p.amount_iqd), 0);
    const cashOut = ((refs ?? []) as { amount_iqd: number }[]).reduce((a, r) => a + Number(r.amount_iqd), 0);
    const expected = Number(day.opening_float_iqd) + cashIn - cashOut;

    const closed = ok<{ cash_expected_iqd: number; cash_variance_iqd: number; shifts_closed_with_day: number }>(
      await call(manager, 'close_day', { p_cash_counted_iqd: expected + 250 }),
    );
    expect(closed.shifts_closed_with_day).toBe(1);
    expect(closed.cash_expected_iqd).toBe(expected);
    expect(closed.cash_variance_iqd).toBe(250);
    const ended = await assertStamped(b4);
    expect(ended).toMatchObject({
      closed_via: 'day_close',
      closed_by: SEED_STAFF_IDS.manager,
      authorized_by: null,
      cash_counted_iqd: null,
      cash_variance_iqd: null,
      cash_expected_iqd: 270_000,
    });
    expect(await auditCount('drawer.shift_close_by_day', b4)).toBe(1);

    const { list } = await assertPartition(d1);
    for (const s of list.shifts) await assertStamped(s.id);
    // The outside rows, by station: the desk before its shift, the write with
    // no device (and the service-role one), the replayed sale at A, the cash
    // in and out between B's shifts, and the race's late payments at A.
    const byStation = new Map(list.outside.map((o) => [o.station_id, o]));
    expect(byStation.get(DESK)).toMatchObject({ cash_payments_iqd: 4_000, cash_refunds_iqd: 0, payment_count: 1 });
    expect(byStation.get(null)).toMatchObject({ cash_payments_iqd: 3_000, payment_count: 2 });
    expect(byStation.get(B)).toMatchObject({ cash_payments_iqd: 20_000, cash_refunds_iqd: 5_000, payment_count: 1, refund_count: 1 });
    expect(Number(byStation.get(A)?.cash_payments_iqd)).toBeGreaterThanOrEqual(7_000);
  });

  // ── T16 + TI7 ────────────────────────────────────────────────────────────
  let d2Cash40k: string;

  it('T16 (V10) + TI7: a refund of yesterday\'s payment inside today\'s shift, and the clean-drawer identity', async () => {
    const d1LaterBefore = (await listDay(d1)).cross_day[0]!.later_cash_refunds_iqd;
    const { data: d1SumBefore } = await svc.from('v_day_close_summary').select('refunds_iqd').eq('day_session_id', d1).single();

    d2 = await newDay(100_000);
    // The next day's first shift at A: no handover, whatever D1 left.
    const s1 = await open(cashier, A, 100_000);
    expect(s1.handover_from).toBeNull();
    expect(s1.handover_difference_iqd).toBeNull();
    d2Cash40k = (await sale(cashier, A, 40_000)).paymentId;
    const cross = await refundAt(A, yesterdayCash30k, 30_000);
    expect((await refundShift(cross)).till_shift_id).toBe(s1.id);
    const c1 = ok<CloseResult>(await closeOwn(cashier, s1.id, 108_000, CASHIER_PIN, A));
    expect(c1).toMatchObject({ cash_payments_iqd: 40_000, cash_refunds_iqd: 30_000, cash_expected_iqd: 110_000, cash_variance_iqd: -2_000 });

    const s2 = await open(cashierB, A, 109_000);
    expect(s2.handover_difference_iqd).toBe(1_000);
    await sale(cashierB, A, 5_000, 'card');
    await sale(cashierB, A, 7_000);
    const c2 = ok<CloseResult>(await closeFor(cashierB, s2.id, 116_500, A));
    expect(c2).toMatchObject({ cash_expected_iqd: 116_000, cash_variance_iqd: 500, card_payments_iqd: 5_000 });

    // The day count is the last shift's count; no shift is open at the close.
    const day = ok<{ cash_expected_iqd: number; cash_variance_iqd: number; shifts_closed_with_day: number }>(
      await call(manager, 'close_day', { p_cash_counted_iqd: 116_500 }),
    );
    expect(day.shifts_closed_with_day).toBe(0);
    // close_day counts the refund under its payment's day (D1), so D2 expects
    // the float plus D2's cash only.
    expect(day.cash_expected_iqd).toBe(100_000 + 47_000);
    expect(day.cash_variance_iqd).toBe(-30_500);

    const p2 = await assertPartition(d2);
    expect(Number(p2.summary.refunds_iqd)).toBe(0);
    expect(Number(p2.cross.earlier_days_cash_refunds_iqd)).toBe(30_000);
    const shifts = p2.shifts;
    expect(shifts.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
    // TI7: Σ shift variances + Σ handover differences − earlier days' cash refunds.
    const sumVar = shifts.reduce((a, s) => a + Number(s.cash_variance_iqd), 0);
    const sumHand = shifts.reduce((a, s) => a + Number(s.handover_difference_iqd ?? 0), 0);
    expect(sumVar + sumHand - Number(p2.cross.earlier_days_cash_refunds_iqd)).toBe(day.cash_variance_iqd);

    // Yesterday's live summary now counts it; its later term carries it.
    const { data: d1SumAfter } = await svc.from('v_day_close_summary').select('refunds_iqd').eq('day_session_id', d1).single();
    expect(Number((d1SumAfter as { refunds_iqd: number }).refunds_iqd)).toBe(Number((d1SumBefore as { refunds_iqd: number }).refunds_iqd) + 30_000);
    const p1 = await assertPartition(d1);
    expect(p1.cross.later_cash_refunds_iqd).toBe(Number(d1LaterBefore) + 30_000);
  });

  // ── T10 + T12 ────────────────────────────────────────────────────────────
  it('T10 + T12 (V9): a negative expected; a shift left open by forceCloseAllDays takes no refund and heals at the next open', async () => {
    d3 = await newDay(0);
    // TI10: a refund of an earlier day's payment can take expected below zero.
    const n = await open(cashierB, B, 0);
    expect(n.handover_from).toBeNull();
    const back = await refundAt(B, d2Cash40k, 20_000);
    expect((await refundShift(back)).till_shift_id).toBe(n.id);
    const cn = ok<CloseResult>(await closeFor(cashierB, n.id, 0, B));
    expect(cn).toMatchObject({ cash_expected_iqd: -20_000, cash_counted_iqd: 0, cash_variance_iqd: 20_000 });
    await assertStamped(n.id);
    // The CHECKs tie the stamp: a service-role edit that breaks it is refused.
    const broken = await svc.from('till_shifts').update({ cash_variance_iqd: 0 }).eq('id', n.id);
    expect(broken.error?.code).toBe('23514');

    // A desk shift, then the day is closed around it (the test helper).
    const x = await open(desk, DESK, 0);
    const deskSale = await sale(desk, DESK, 6_000);
    expect((await paymentShift(deskSale.paymentId)).till_shift_id).toBe(x.id);
    await forceCloseAllDays(svc);
    expect((await shiftRow(x.id)).closed_at).toBeNull();

    d4 = await newDay(0);
    // The only open shift at the desk is on a closed day: the refund is outside.
    const late = await refundAt(DESK, deskSale.paymentId, 1_000);
    expect(await refundShift(late)).toEqual({ till_shift_id: null, device_id: DESK });
    const st = await status(desk, DESK);
    expect(st.shift?.id).toBe(x.id); // still open, on its closed day

    // The next open there ends it with its day, then opens with no handover.
    const y = await open(desk, DESK, 0);
    expect(y.handover_from).toBeNull();
    const healed = await assertStamped(x.id);
    expect(healed).toMatchObject({
      closed_via: 'day_close',
      closed_by: SEED_STAFF_IDS.court_desk,
      cash_counted_iqd: null,
      cash_payments_iqd: 6_000,
      cash_refunds_iqd: 0,
      cash_expected_iqd: 6_000,
    });
    expect(await auditCount('drawer.shift_close_by_day', x.id)).toBe(1);

    const closed = ok<{ shifts_closed_with_day: number }>(await call(manager, 'close_day', { p_cash_counted_iqd: 0 }));
    expect(closed.shifts_closed_with_day).toBe(1);
    expect((await shiftRow(y.id)).closed_via).toBe('day_close');

    // TI6 on every day this suite made, with the cross-day terms it created.
    const p3 = await assertPartition(d3);
    expect(p3.cross.earlier_days_cash_refunds_iqd).toBe(20_000);
    expect(p3.cross.later_cash_refunds_iqd).toBe(1_000);
    const p4 = await assertPartition(d4);
    expect(p4.cross.earlier_days_cash_refunds_iqd).toBe(1_000);
    expect(p4.outside.find((o) => o.station_id === DESK)).toMatchObject({ cash_refunds_iqd: 1_000, refund_count: 1 });
    const p2 = await assertPartition(d2);
    expect(p2.cross.later_cash_refunds_iqd).toBe(20_000);
    for (const id of days) await assertPartition(id);
  });

  // ── T13, T15 ─────────────────────────────────────────────────────────────
  it('T13: the table is MGMT at the venue only', async () => {
    // A shift at venue B, which is inactive and so in nobody's venues.
    const bizDate = `2${String(100 + Math.floor(Math.random() * 800)).padStart(3, '0')}-01-01`;
    // Times set here, both in the past: the client clock is not the database's.
    const openedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const closedAt = new Date(Date.now() - 3600_000).toISOString();
    let r = await svc.from('day_sessions').upsert(
      {
        id: vbDay,
        venue_id: VENUE_B_ID,
        business_date: bizDate,
        status: 'closed',
        opened_by: SEED_STAFF_IDS.manager_b,
        opened_at: openedAt,
        opening_float_iqd: 0,
        closed_at: closedAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    expect(r.error).toBeNull();
    r = await svc.from('till_shifts').upsert(
      {
        id: vbShift,
        venue_id: VENUE_B_ID,
        day_session_id: vbDay,
        station_id: VB,
        staff_id: SEED_STAFF_IDS.manager_b,
        opening_float_iqd: 0,
        opened_at: openedAt,
        closed_at: closedAt,
        closed_by: SEED_STAFF_IDS.manager_b,
        closed_via: 'day_close',
        cash_payments_iqd: 0,
        cash_refunds_iqd: 0,
        cash_expected_iqd: 0,
        payment_count: 0,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    expect(r.error).toBeNull();
    const ours = (await listDay(d1)).shifts.map((s) => s.id);
    for (const [who, c] of [['manager', manager], ['owner', owner]] as const) {
      const { data, error } = await c.from('till_shifts').select('id').in('id', [...ours, vbShift]);
      expect(error).toBeNull();
      expect((data as { id: string }[]).map((x) => x.id).sort(), who).toEqual([...ours].sort());
    }
    for (const c of [cashier, desk, prep, guest]) {
      const { data, error } = await c.from('till_shifts').select('id').in('id', ours);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const a = await anon.from('till_shifts').select('id').limit(1);
    expect(a.error?.message).toMatch(/permission denied/i);

    // TI8: the station and the shift agree on the venue (the 0132 pair key).
    const astray = await svc.from('till_shifts').insert({
      venue_id: VENUE_B_ID,
      day_session_id: vbDay,
      station_id: A,
      staff_id: SEED_STAFF_IDS.manager_b,
      opening_float_iqd: 0,
    });
    expect(astray.error?.code).toBe('23503');
    expect(astray.error?.message).toMatch(/till_shifts_station_venue_fkey/);
  });

  it('T15: the list covers at most 62 days, and with no dates the latest day', async () => {
    const ok62 = await call(manager, 'till_shift_list', { p_from: '2026-01-01', p_to: '2026-03-03' });
    expect(ok62.error).toBeNull();
    const over = await call(manager, 'till_shift_list', { p_from: '2026-01-01', p_to: '2026-03-04' });
    expect(code(over)).toBe('INVALID_ARGUMENT');
    expect(over.error?.hint).toBe('range');
    expect(code(await call(manager, 'till_shift_list', { p_from: '2026-02-01', p_to: '2026-01-01' }))).toBe('INVALID_ARGUMENT');
    // No open day now, so the latest one: D4, which this suite closed last.
    const latest = ok<ListResult>(await call(owner, 'till_shift_list', {}));
    expect(latest.from).toBe((await dayOf(d4)).business_date);
    // The station filter narrows the shifts and the outside rows alike.
    const onlyB = await call(manager, 'till_shift_list', { p_from: (await dayOf(d1)).business_date, p_to: (await dayOf(d1)).business_date, p_station_id: B });
    const lb = ok<ListResult>(onlyB);
    expect(lb.shifts.every((s) => s.station_id === B)).toBe(true);
    expect(lb.outside.map((o) => o.station_id)).toEqual([B]);
  });

  // ── TI4, TI5 (catalog) ───────────────────────────────────────────────────
  it.skipIf(!docker)('TI1, TI2, TI4, TI5: settle_tab untouched, every stamp names its own station, the stamp is insert-only, close_day keeps the 0020 math', async () => {
    // TI1: settle_tab is not re-issued; its live body is 0106's.
    const m0106 = readFileSync(
      fileURLToPath(new URL('../supabase/migrations/20260917000106_desk_payment.sql', import.meta.url)),
      'utf8',
    );
    const settle0106 = /\$settle_0106\$([\s\S]*?)\$settle_0106\$/.exec(m0106)?.[1];
    expect(settle0106).toBeTruthy();
    const settleLive = psql(`select prosrc from pg_proc where oid = 'app.settle_tab(uuid,payment_method,bigint,bigint,text,text,bigint)'::regprocedure`);
    // Multi-venue slice 3 (0217) re-issued it with one venue guard (a v_venue
    // declaration and one block after the role guard) and nothing else: the
    // live body is 0217's, and 0217's without the guard is 0106's.
    const m0217 = readFileSync(
      fileURLToPath(new URL('../supabase/migrations/20260926000217_cross_venue_guards.sql', import.meta.url)),
      'utf8',
    );
    const settle0217 = /\$settle_tab_0217\$([\s\S]*?)\$settle_tab_0217\$/.exec(m0217)?.[1];
    expect(settle0217).toBeTruthy();
    expect(settleLive).toBe(settle0217!.trim());
    const unguarded = settle0217!
      .replace('  v_venue uuid;\n', '')
      .replace(/ {2}-- 0217:[^\n]*\n {2}v_venue := [^\n]*\n {2}if v_venue is not null then\n[\s\S]*?\n {2}end if;\n/, '');
    expect(unguarded.trim()).toBe(settle0106!.trim());

    // TI2, over every stamped row in the database: the same station and venue,
    // and for a payment the same day.
    expect(
      psql(`select count(*) from payments p join till_shifts s on s.id = p.till_shift_id
             where p.device_id is distinct from s.station_id or p.venue_id <> s.venue_id
                or p.day_session_id <> s.day_session_id`),
    ).toBe('0');
    expect(
      psql(`select count(*) from refunds r join till_shifts s on s.id = r.till_shift_id
             where r.device_id is distinct from s.station_id or r.venue_id <> s.venue_id`),
    ).toBe('0');

    const triggers = psql(`
      select string_agg(tgname || ':' || tgrelid::regclass || ':' || tgtype, ',' order by tgname)
        from pg_trigger
       where tgname in ('payments_till_shift_stamp', 'refunds_till_shift_stamp', 'payments_ao', 'refunds_ao')`);
    // 7 = ROW | BEFORE | INSERT; 26 = BEFORE | DELETE | UPDATE, per statement.
    expect(triggers).toBe('payments_ao:payments:26,payments_till_shift_stamp:payments:7,refunds_ao:refunds:26,refunds_till_shift_stamp:refunds:7');
    const upd = await svc.from('payments').update({ till_shift_id: null }).eq('id', yesterdayCash30k);
    expect(upd.error?.message).toMatch(/append-only/i);

    const src = psql(`select prosrc from pg_proc where oid = 'app.close_day(bigint,bigint,text,text,uuid)'::regprocedure`);
    const m0020 = readFileSync(
      fileURLToPath(new URL('../supabase/migrations/20260824000020_day_close.sql', import.meta.url)),
      'utf8',
    );
    const math = /( {2}v_before := to_jsonb\(v_day\);[\s\S]*?returning \* into v_day;)/.exec(m0020)?.[1];
    expect(math).toBeTruthy();
    expect(src.includes(math!)).toBe(true);
  });
});
