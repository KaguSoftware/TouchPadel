/**
 * Declarative RLS role matrix — the "written role test" deliverable
 * (design-data.md §6.2). This file is data: the runner (rls-matrix.test.ts)
 * executes it, and it can be exported to markdown for Mustafa's sign-off.
 *
 * DROP 1 covers the 0004–0008 surface. Later drops APPEND entries (menu,
 * sessions, tabs/orders, stock, day close) — never restructure this file,
 * only add rules with a higher `drop` number.
 */

export const PRINCIPALS = [
  'anon',
  'guest_account',
  'guest_anon_session',
  'cashier',
  'prep',
  'court_desk',
  'manager',
  'owner',
] as const;
export type Principal = (typeof PRINCIPALS)[number];

/**
 * Select expectations:
 *  - 'rows'    — grant + policy admit the probe row(s): error null, length > 0
 *  - 'silence' — grant exists but RLS hides everything: error null, ZERO rows
 *                (RLS silence, not an error — per the matrix's named cases)
 *  - 'denied'  — no grant (or no column grant): permission error
 */
export type SelectExpectation = 'rows' | 'silence' | 'denied';

/** Write expectations: 'denied' = permission/RLS error. Drop-1 business writes are RPC-only. */
export type WriteExpectation = 'allowed' | 'denied';

/**
 * RPC expectations:
 *  - 'execute' — grant admits the call; it may still fail business validation
 *                (anything except permission-denied / role-guard)
 *  - 'guarded' — grant admits the call but the in-function role/auth guard
 *                raises FORBIDDEN / AUTH_REQUIRED / ACCOUNT_REQUIRED
 *  - 'denied'  — no EXECUTE grant: permission denied (42501)
 */
export type RpcExpectation = 'execute' | 'guarded' | 'denied';

export interface SelectRule {
  kind: 'select';
  /** table or view name in schema public */
  name: string;
  /** explicit column list (needed where column-level grants apply, e.g. staff) */
  columns?: string;
  expect: Record<Principal, SelectExpectation>;
  note?: string;
  drop: number;
}

export interface WriteRule {
  kind: 'write';
  name: string;
  op: 'insert' | 'update' | 'delete';
  /** payload for insert / update attempts (kept invalid-but-typed on purpose) */
  payload?: Record<string, unknown>;
  expect: Record<Principal, WriteExpectation>;
  note?: string;
  drop: number;
}

export interface RpcRule {
  kind: 'rpc';
  schema: 'app';
  name: string;
  /** args chosen to fail fast AFTER the permission/guard layer */
  args: Record<string, unknown>;
  expect: Record<Principal, RpcExpectation>;
  note?: string;
  drop: number;
}

export type MatrixRule = SelectRule | WriteRule | RpcRule;

/** Build a full principal record from a default plus overrides. */
export function ex<T extends string>(
  def: T,
  overrides: Partial<Record<Principal, T>> = {},
): Record<Principal, T> {
  return Object.fromEntries(PRINCIPALS.map((p) => [p, overrides[p] ?? def])) as Record<
    Principal,
    T
  >;
}

const NIL_UUID = '00000000-0000-4000-8000-000000000000';
/** The default venue (migration 0122) — the only ACTIVE venue while this file runs. */
const VENUE_A = 'c0000000-0000-4000-8000-000000000001';
const FUTURE = new Date(Date.now() + 14 * 24 * 3600_000).toISOString();

// Drop 7. A settled date range in the past: the reports and analytics family
// read over it and must return calmly rather than fail on the range itself.
const DAY_FROM = '2026-01-01';
const DAY_TO = '2026-01-31';
const TS_FROM = '2026-01-01T00:00:00Z';
const TS_TO = '2026-01-31T23:59:59Z';

/**
 * The seeded manager PIN (supabase/seed.sql, mirrored by DEV_PINS in
 * helpers.ts). Inlined rather than imported so this file stays pure data that
 * the markdown export can read without pulling in a Supabase client.
 *
 * It is the CORRECT pin deliberately — see the override_price rule below.
 */
const MANAGER_PIN = '380517';

// ── shared expectation shapes for drop 7 ────────────────────────────────────
// 'guarded' = the in-function role check raises FORBIDDEN; 'execute' = the
// principal passes the guard and fails on the arguments instead.
const OWNER_ONLY = ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' });
const MANAGER_UP = ex<RpcExpectation>('guarded', {
  anon: 'denied', manager: 'execute', owner: 'execute',
});
const CASHIER_UP = ex<RpcExpectation>('guarded', {
  anon: 'denied', cashier: 'execute', manager: 'execute', owner: 'execute',
});
const PREP_UP = ex<RpcExpectation>('guarded', {
  anon: 'denied', prep: 'execute', cashier: 'execute', manager: 'execute', owner: 'execute',
});
/** The till surface plus the court desk (0106: the desk takes court payment). */
const CASHIER_DESK_UP = ex<RpcExpectation>('guarded', {
  anon: 'denied', cashier: 'execute', court_desk: 'execute', manager: 'execute', owner: 'execute',
});
/** Any active staff role (0105 breaks): guests are refused, anon has no grant. */
const STAFF_ANY = ex<RpcExpectation>('guarded', {
  anon: 'denied', cashier: 'execute', prep: 'execute', court_desk: 'execute', manager: 'execute', owner: 'execute',
});
/** Granted to `authenticated` only; answers about the caller alone. */
const SELF_AUTHED = ex<RpcExpectation>('execute', { anon: 'denied' });
/** Granted to `anon` too: the menu surface, before any identity exists. */
const SELF_ANON_OK = ex<RpcExpectation>('execute');

export const matrix: MatrixRule[] = [
  // ── profiles ──────────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'profiles',
    // Explicit column list since 0077: the table-wide SELECT grant was replaced
    // by a column grant, so `select *` is now permission-denied for everyone.
    columns: 'id, full_name, phone, preferred_lang',
    // every authenticated principal owns exactly one profile row except the
    // anonymous-session guest (signup trigger skips anonymous users);
    // court_desk/manager/owner additionally see all rows (walk-in lookup).
    expect: ex<SelectExpectation>('rows', { anon: 'denied', guest_anon_session: 'silence' }),
    drop: 1,
  },
  {
    kind: 'select',
    name: 'profiles',
    columns: 'expo_push_token',
    expect: ex<SelectExpectation>('denied'),
    note:
      'CRITICAL (SEC-21, 0077): the push token is never client-readable — a column ' +
      'grant test, exactly as staff.pin_hash is. 0004 granted SELECT on the WHOLE ' +
      'table to `authenticated`, and profiles_select admits court_desk/manager/owner, ' +
      'so every desk session could read every guest\'s token: the one credential ' +
      'needed to push an arbitrary notification to that guest\'s phone. Denied to the ' +
      'OWNING guest too — nothing in the app ever read it back, only registers it.',
    drop: 6,
  },
  {
    kind: 'write',
    name: 'profiles',
    op: 'insert',
    payload: { id: NIL_UUID, full_name: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'profile creation is signup-trigger-only',
    drop: 1,
  },

  // ── staff ─────────────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'staff',
    columns: 'id, display_name, role, is_active',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows', // own row
      prep: 'rows',
      court_desk: 'rows',
      manager: 'rows', // all rows
      owner: 'rows',
    }),
    drop: 1,
  },
  {
    kind: 'select',
    name: 'staff',
    columns: 'pin_hash',
    expect: ex<SelectExpectation>('denied'),
    note: 'CRITICAL: pin_hash column is never client-readable (column grant test)',
    drop: 1,
  },
  {
    kind: 'write',
    name: 'staff',
    op: 'insert',
    payload: { id: NIL_UUID, display_name: 'x', role: 'cashier' },
    expect: ex<WriteExpectation>('denied'),
    note: 'staff administration is owner-RPC-only (later drop)',
    drop: 1,
  },

  // ── audit_log ─────────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'audit_log',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      manager: 'rows',
      owner: 'rows',
    }),
    drop: 1,
  },
  {
    kind: 'write',
    name: 'audit_log',
    op: 'insert',
    payload: { action: 'x', entity: 'x', entity_id: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'append-only via definer RPC; also guarded by app.forbid_mutation',
    drop: 1,
  },
  {
    kind: 'write',
    name: 'audit_log',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    note: 'append-only for EVERY principal including manager/owner',
    drop: 1,
  },

  // ── venue settings ────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'venue_settings',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      prep: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'full settings row is staff-only',
    drop: 1,
  },
  {
    kind: 'select',
    name: 'venue_settings_public',
    expect: ex<SelectExpectation>('rows'),
    note: 'the ONLY settings surface for anon (opening hours, horizon, policy windows)',
    drop: 1,
  },
  {
    kind: 'write',
    name: 'venue_settings',
    op: 'update',
    payload: { hold_ttl_seconds: 1 },
    expect: ex<WriteExpectation>('denied'),
    drop: 1,
  },

  // ── tax groups ────────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'tax_groups',
    expect: ex<SelectExpectation>('rows', { anon: 'rows' }),
    note: 'active groups public; retired groups visible to staff only (probe: Standard is active)',
    drop: 1,
  },

  // ── courts / rates ────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'courts',
    expect: ex<SelectExpectation>('rows'),
    note: 'active courts are public reads',
    drop: 1,
  },
  {
    kind: 'write',
    name: 'courts',
    op: 'insert',
    payload: { name_en: 'x', name_ar: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'court admin is manager/owner RPC-only (later drop)',
    drop: 1,
  },
  {
    kind: 'select',
    name: 'rate_rules',
    expect: ex<SelectExpectation>('rows'),
    drop: 1,
  },
  {
    kind: 'select',
    name: 'rate_rule_prices',
    expect: ex<SelectExpectation>('rows'),
    drop: 1,
  },
  {
    kind: 'write',
    name: 'rate_rule_prices',
    op: 'update',
    payload: { price_iqd: 1 },
    expect: ex<WriteExpectation>('denied'),
    note: 'CRITICAL: nobody writes a price directly',
    drop: 1,
  },

  // ── reservations ──────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'reservations',
    // probe row belongs to no principal: guests see RLS silence (zero rows,
    // not an error), desk roles see it.
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    // 0106 reservations_cashier_read: a cashier reads bookings that carry a tab
    // or start within a day of now. The suite seeds one starting in two hours
    // (rows); the named case below proves the weeks-out probe stays hidden.
    note: 'guests see only their own rows; prep never; cashier only near-now or tabbed bookings (0106)',
    drop: 1,
  },
  {
    kind: 'write',
    name: 'reservations',
    op: 'insert',
    payload: {
      court_id: NIL_UUID,
      kind: 'booking',
      start_at: FUTURE,
      end_at: FUTURE,
      source: 'mobile',
      guest_name: 'x',
    },
    expect: ex<WriteExpectation>('denied'),
    note: 'CRITICAL: reservation writes are RPC-only for every principal',
    drop: 1,
  },
  {
    kind: 'select',
    name: 'court_availability',
    expect: ex<SelectExpectation>('rows'),
    note: 'no-PII availability view is public',
    drop: 1,
  },

  // ── RPCs (grant + guard layers) ───────────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'hold_slot',
    args: { p_court_id: NIL_UUID, p_start_at: FUTURE, p_duration_min: 60 },
    expect: ex<RpcExpectation>('execute', { anon: 'denied', guest_anon_session: 'guarded' }),
    note:
      'CRITICAL (0048/C1): an ACCOUNT is required. This row previously read ' +
      '"any authenticated principal may hold" and that is exactly how C1 shipped: ' +
      'a Supabase anonymous sign-in IS `authenticated`, so it held courts under ' +
      'guest_id = NULL -- unreadable, unconfirmable and uncancellable by its own ' +
      'creator, yet still occupying the exclusion constraint against real guests. ' +
      'Anonymous sessions are cafe guests; they never book courts.',
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'confirm_booking',
    args: { p_hold_id: NIL_UUID },
    expect: ex<RpcExpectation>('execute', { anon: 'denied' }),
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'cancel_reservation',
    args: { p_reservation_id: NIL_UUID },
    expect: ex<RpcExpectation>('execute', { anon: 'denied' }),
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'staff_create_reservation',
    args: {
      p_court_id: NIL_UUID,
      p_kind: 'booking',
      p_start_at: FUTURE,
      p_end_at: FUTURE,
      p_guest_name: 'x',
    },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'move_reservation',
    args: { p_reservation_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'extend_reservation',
    args: { p_reservation_id: NIL_UUID, p_new_end_at: FUTURE },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'mark_reservation',
    args: { p_reservation_id: NIL_UUID, p_status: 'arrived' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'expire_stale_holds',
    args: {},
    expect: ex<RpcExpectation>('execute', { anon: 'denied' }),
    note: 'flips truly-expired holds only; safe for any authenticated caller',
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_staff_pin',
    args: { p_staff_id: NIL_UUID, p_pin: '123456' },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' }),
    note: 'owner-only; owner call fails STAFF_NOT_FOUND on the nil uuid',
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'price_slot',
    args: { p_court_id: NIL_UUID, p_start_at: FUTURE, p_duration_min: 60 },
    expect: ex<RpcExpectation>('execute'),
    note: 'public pricing read (guests need live prices)',
    drop: 1,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'is_degraded',
    args: {},
    expect: ex<RpcExpectation>('execute'),
    drop: 1,
  },
  // verify_manager_pin is exercised in a dedicated test (wrong-PIN lockout needs
  // stateful attempts and unique device ids) — see rls-matrix.test.ts.

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP 2+3 — menu / tables / tabs / orders / stock / day / degraded surface
  // (0013–0021, 0024). Probe rows: helpers.ensureCafeProbeData (ee57 prefix).
  // ═══════════════════════════════════════════════════════════════════════════

  // ── menu (anon reads active rows; writes RPC-only) ────────────────────────
  {
    kind: 'select',
    name: 'menu_categories',
    expect: ex<SelectExpectation>('rows'),
    note: 'active categories are public (guest QR menu)',
    drop: 2,
  },
  {
    kind: 'select',
    name: 'menu_items',
    expect: ex<SelectExpectation>('rows'),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'menu_item_variants',
    expect: ex<SelectExpectation>('rows'),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'modifiers',
    expect: ex<SelectExpectation>('rows'),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'menu_item_availability',
    // FIXED by 0025: the 0018 view called app.item_required_ingredients /
    // app.ingredient_on_hand, whose EXECUTE was revoked from anon/authenticated
    // (Postgres checks function EXECUTE against the CALLING role even in a
    // security_invoker=off view) — every client got "permission denied". 0025
    // wraps the logic in ONE granted SECURITY DEFINER function
    // (app.menu_availability) and points the view at it; the internal helpers
    // stay revoked. Design intent (§1.4) restored: public 'rows'.
    expect: ex<SelectExpectation>('rows'),
    note: 'stock-aware availability is public (0025 wrapper fn; internal helpers stay revoked)',
    drop: 3,
  },
  {
    kind: 'write',
    name: 'menu_items',
    op: 'update',
    payload: { name_en: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'menu management is manager/owner RPC-only — no direct write for anyone',
    drop: 2,
  },

  // ── cafe tables / guest sessions (isolation) ──────────────────────────────
  {
    kind: 'select',
    name: 'cafe_tables',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      prep: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'guests learn their table from open_table_session, never from the table',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'cafe_tables',
    op: 'insert',
    payload: { table_number: 'RLS-W-1' },
    expect: ex<WriteExpectation>('denied'),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'guest_sessions',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'guests see only their own session (probe row belongs to nobody); prep/desk none',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'guest_sessions',
    op: 'insert',
    payload: { table_id: NIL_UUID, auth_user_id: NIL_UUID, expires_at: FUTURE },
    expect: ex<WriteExpectation>('denied'),
    note: 'sessions exist only via app.open_table_session',
    drop: 2,
  },

  // ── tabs / orders / order_items (guest sees only own session's) ───────────
  // kitchen_money_reads (build-contracts §2.23): prep reads none of the three;
  // its board reads app.kitchen_board, below.
  {
    kind: 'select',
    name: 'tabs',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'guest sees a tab only via own-session orders — probe tab is silence',
    drop: 2,
  },
  {
    kind: 'select',
    name: 'orders',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'order_items',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'tickets',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      prep: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'KDS + till read tickets; court_desk does not',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'tickets',
    op: 'update',
    payload: { status: 'ready' },
    expect: ex<WriteExpectation>('denied'),
    note: 'CRITICAL: prep updates tickets via app.set_ticket_status ONLY',
    drop: 2,
  },

  // ── money surfaces: append-only for EVERYONE including manager/owner ──────
  {
    kind: 'select',
    name: 'payments',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'money reads are till + management; guests and prep never',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'payments',
    op: 'insert',
    payload: {
      tab_id: NIL_UUID,
      day_session_id: NIL_UUID,
      method: 'cash',
      amount_iqd: 1,
      recorded_by: NIL_UUID,
    },
    expect: ex<WriteExpectation>('denied'),
    note: 'payments are settle_tab-only',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'payments',
    op: 'update',
    payload: { amount_iqd: 1 },
    expect: ex<WriteExpectation>('denied'),
    note: 'CRITICAL: append-only for every principal incl. manager — corrections are refunds',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'payments',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    drop: 2,
  },
  {
    kind: 'select',
    name: 'refunds',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    drop: 2,
  },
  {
    kind: 'write',
    name: 'refunds',
    op: 'update',
    payload: { reason_code: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'refunds are final — append-only for everyone',
    drop: 2,
  },
  {
    kind: 'select',
    name: 'tab_adjustments',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    drop: 2,
  },
  {
    kind: 'write',
    name: 'tab_adjustments',
    op: 'insert',
    payload: {
      tab_id: NIL_UUID,
      kind: 'discount_amount',
      value: 1,
      amount_iqd: 1,
      applied_by: NIL_UUID,
      authorized_by: NIL_UUID,
      reason_code: 'x',
    },
    expect: ex<WriteExpectation>('denied'),
    note: 'discounts/overrides land only through the PIN-gated RPCs',
    drop: 2,
  },

  // ── waiter calls ──────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'waiter_calls',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'guest reads own-session calls only (probe call is not theirs)',
    drop: 2,
  },
  {
    kind: 'write',
    name: 'waiter_calls',
    op: 'insert',
    payload: { table_id: NIL_UUID, guest_session_id: NIL_UUID, reason: 'water' },
    expect: ex<WriteExpectation>('denied'),
    note: 'raise/ack/resolve are RPC-only',
    drop: 2,
  },

  // ── stock: staff-role gradient — cashier NO, manager/owner YES ────────────
  {
    kind: 'select',
    name: 'ingredients',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: 'stock is management-only; cashier/prep/desk get RLS silence',
    drop: 3,
  },
  {
    kind: 'select',
    name: 'recipe_lines',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 3,
  },
  {
    kind: 'select',
    name: 'stock_batches',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 3,
  },
  {
    kind: 'select',
    name: 'stock_movements',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 3,
  },
  {
    kind: 'write',
    name: 'stock_movements',
    op: 'insert',
    payload: { ingredient_id: NIL_UUID, movement_type: 'goods_in', qty_delta: 1 },
    expect: ex<WriteExpectation>('denied'),
    note: 'CRITICAL: the ledger is append-only via definer functions exclusively',
    drop: 3,
  },
  {
    kind: 'write',
    name: 'stock_movements',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    drop: 3,
  },
  {
    kind: 'select',
    name: 'manager_alerts',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 3,
  },
  {
    kind: 'write',
    name: 'manager_alerts',
    op: 'update',
    payload: { acknowledged_at: FUTURE },
    expect: ex<WriteExpectation>('denied'),
    note: 'acknowledge via app.acknowledge_alert only',
    drop: 3,
  },

  // ── day sessions / degraded bookkeeping / outbox ──────────────────────────
  {
    kind: 'select',
    name: 'day_sessions',
    // 0106: the desk reads the day row to say "the trading day is not open".
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    drop: 2,
  },
  {
    kind: 'write',
    name: 'day_sessions',
    op: 'update',
    payload: { notes: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'open/close are RPC-only; the stamped close is immutable from clients',
    drop: 2,
  },
  {
    kind: 'select',
    name: 'device_heartbeats',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 3,
  },
  {
    kind: 'select',
    name: 'sync_replays',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 3,
  },
  {
    kind: 'select',
    name: 'notification_outbox',
    expect: ex<SelectExpectation>('denied'),
    note: 'CRITICAL: nobody reads the push outbox — service role only (payloads name other guests)',
    drop: 3,
  },
  {
    kind: 'write',
    name: 'notification_outbox',
    op: 'insert',
    payload: { profile_id: NIL_UUID, kind: 'booking_confirmed', payload: {} },
    expect: ex<WriteExpectation>('denied'),
    drop: 3,
  },

  // ── RPCs: admin guards ────────────────────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'upsert_menu_item',
    args: { p_category_id: NIL_UUID, p_name_en: 'x', p_name_ar: 'س' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'menu editor is manager/owner; nil category then fails CATEGORY_NOT_FOUND',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'generate_table_token',
    args: { p_table_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'rotate_table_token',
    args: { p_table_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' }),
    note: 'rotation is owner-ONLY (manager stays guarded)',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'open_day',
    args: { p_opening_float_iqd: -1 },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'negative float fails INVALID_FLOAT past the guard — no side effect',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'close_day',
    args: { p_cash_counted_iqd: -1 },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 3,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'receive_delivery',
    args: { p_lines: [] },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 3,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'record_production',
    args: { p_ingredient_id: NIL_UUID, p_qty: -1 },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 3,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'acknowledge_alert',
    args: { p_alert_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 3,
  },

  // ── RPCs: till guards (cashier allowed) ───────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'open_tab',
    args: { p_table_id: NIL_UUID },
    expect: CASHIER_DESK_UP,
    note: 'nil table fails NO_OPEN_DAY/TABLE_NOT_FOUND past the guard — no side effect',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'till_add_items',
    args: { p_tab_id: NIL_UUID, p_items: [] },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'settle_tab',
    args: { p_tab_id: NIL_UUID, p_method: 'cash' },
    expect: CASHIER_DESK_UP,
    note: 'prep can SEE tabs/orders but can NOT settle; the court desk can (0106)',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'split_evenly',
    args: { p_tab_id: NIL_UUID, p_n: 2 },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'apply_discount',
    args: {
      p_tab_id: NIL_UUID,
      p_kind: 'discount_percent',
      p_value: 100,
      // 0115: the helper proves the PIN to verify_manager_pin BEFORE the call, so
      // a placeholder PIN never reaches the role guard (PIN_INVALID for everyone).
      p_pin: MANAGER_PIN,
      p_reason_code: '',
    },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'empty reason fails REASON_REQUIRED before the PIN is ever checked',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'refund',
    args: { p_payment_id: NIL_UUID, p_amount_iqd: 1, p_pin: MANAGER_PIN, p_reason_code: '' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'cashiers can NOT refund (manager/owner only); the helper proves the PIN first (0115), then the role guard, then the reason check',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'record_waste',
    args: { p_ingredient_id: NIL_UUID, p_qty: 1, p_reason_code: '' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'the ONE cashier stock path; prep/desk stay guarded',
    drop: 3,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_ticket_status',
    args: { p_ticket_id: NIL_UUID, p_status: 'ready' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      prep: 'execute',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'prep updates tickets via THIS RPC only (direct update denied above)',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'ack_waiter_call',
    args: { p_call_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 2,
  },

  // ── RPCs: guest guards ────────────────────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'open_table_session',
    args: { p_token: 'not-a-real-token' },
    expect: ex<RpcExpectation>('execute', { anon: 'guarded' }),
    note: 'the single anon-granted RPC; anon (no auth.uid) hits AUTH_REQUIRED, others fail TOKEN_INVALID',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'create_guest_order',
    args: { p_items: [] },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'without a live table session EVERY caller stops at SESSION_EXPIRED — no principal orders sessionless',
    drop: 2,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'raise_waiter_call',
    args: { p_reason: 'water' },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'same session guard as guest ordering',
    drop: 2,
  },

  // ── RPCs: degraded / sync / outbox ────────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'heartbeat',
    args: { p_device_id: 'PROBE-RLS' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      prep: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'staff devices only; PROBE device id never flips degraded mode',
    drop: 3,
  },
  // app.log_replay: dropped in 0114 (S5) — sync_replays is written only by the
  // replay edge function as the service role; no client-callable rule remains.
  {
    kind: 'rpc',
    schema: 'app',
    name: 'venue_mode',
    args: {},
    expect: ex<RpcExpectation>('execute'),
    note: 'public degraded/horizon poll (numbers only)',
    drop: 3,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'claim_due_notifications',
    args: { p_limit: 1 },
    expect: ex<RpcExpectation>('denied'),
    note: 'CRITICAL: outbox claim is service-role only — no client EXECUTE at all',
    drop: 3,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP 4 — cafe rebuild (0027–0034): menu extensions / reveals / settings /
  // tables+storage / telegram / analytics. Probe rows: helpers.
  // ensureCafeProbeDataDrop4 (ee57 prefix, called by ensureCafeProbeData).
  // ═══════════════════════════════════════════════════════════════════════════

  // ── cafe settings: base table staff-only, public view for everyone ────────
  {
    kind: 'select',
    name: 'cafe_settings',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: 'private keys (telegram_*, analytics_*) never leave manager/owner',
    drop: 4,
  },
  {
    kind: 'select',
    name: 'cafe_settings_public',
    expect: ex<SelectExpectation>('rows'),
    note: 'the ONLY settings surface for anon / guests / the till (is_public rows only)',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'cafe_settings',
    op: 'update',
    payload: { value: true },
    expect: ex<WriteExpectation>('denied'),
    note: 'writes are app.set_cafe_setting-only for everyone',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'cafe_settings',
    op: 'insert',
    payload: { key: 'rls_probe_key', value: true, is_public: false },
    expect: ex<WriteExpectation>('denied'),
    drop: 4,
  },

  // ── menu extensions ───────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'modifier_reveals',
    expect: ex<SelectExpectation>('rows'),
    note: 'conditional-group links are public menu structure (ids only)',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'modifier_reveals',
    op: 'insert',
    payload: { modifier_id: NIL_UUID, group_id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'app.set_modifier_reveals is the only writer (depth invariant)',
    drop: 4,
  },
  {
    kind: 'select',
    name: 'menu_item_costs',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: 'CRITICAL: unit cost is management-only; cashier/prep/guests get RLS silence (spec deviation: cost lives in its own table, not a menu_items column)',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'menu_item_costs',
    op: 'update',
    payload: { cost_iqd: 1 },
    expect: ex<WriteExpectation>('denied'),
    note: 'app.set_item_cost only',
    drop: 4,
  },

  // ── telegram ──────────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'telegram_outbox',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: 'operator Telegram page lists deliveries; nobody else',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'telegram_outbox',
    op: 'insert',
    payload: { kind: 'test', chat_id: '-1', payload: {} },
    expect: ex<WriteExpectation>('denied'),
    note: 'enqueue is internal (app.enqueue_telegram) — no client insert',
    drop: 4,
  },
  {
    kind: 'select',
    name: 'telegram_actions',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    drop: 4,
  },
  {
    kind: 'write',
    name: 'telegram_actions',
    op: 'insert',
    payload: { action: 'o:seen', ref_id: NIL_UUID, tg_user_id: 1, tg_first_name: 'x', result: 'applied' },
    expect: ex<WriteExpectation>('denied'),
    note: 'the tap ledger is written only by app.telegram_apply_action (service role)',
    drop: 4,
  },
  {
    kind: 'select',
    name: 'telegram_staff',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: '0039 allowlist: who may drive the bot, and who may void from it',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'telegram_staff',
    op: 'insert',
    payload: { tg_user_id: 999001, staff_id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'RPC-only (app.set_telegram_staff, owner) — a client insert would be a self-grant',
    drop: 4,
  },
  {
    kind: 'select',
    name: 'telegram_chats',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: '0091 detected groups: the operator picks the staff group from these',
    drop: 7,
  },
  {
    kind: 'write',
    name: 'telegram_chats',
    op: 'insert',
    payload: { chat_id: '-570092', type: 'group', bot_status: 'member' },
    expect: ex<WriteExpectation>('denied'),
    note: 'written only by telegram-callback (service role) — a client insert could plant a group the owner then picks',
    drop: 7,
  },

  // ── analytics LLM tables: owner reads only, RPC-only writes ───────────────
  {
    kind: 'select',
    name: 'analytics_insights',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', owner: 'rows' }),
    note: 'owner-only (manager included in the silence)',
    drop: 4,
  },
  {
    kind: 'write',
    name: 'analytics_insights',
    op: 'insert',
    payload: { range_from: '2001-01-01', range_to: '2001-01-02', insights: [] },
    expect: ex<WriteExpectation>('denied'),
    note: 'app.save_analytics_insights only',
    drop: 4,
  },
  {
    kind: 'select',
    name: 'analytics_patterns',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', owner: 'rows' }),
    drop: 4,
  },
  {
    kind: 'select',
    name: 'analytics_insight_rejections',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', owner: 'rows' }),
    drop: 4,
  },
  {
    kind: 'write',
    name: 'analytics_insight_rejections',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    note: 'unreject is app.unreject_insight only (owner, audited)',
    drop: 4,
  },

  // ── RPCs: manager|owner admin guards ──────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_cafe_setting',
    args: { p_key: 'hero_mode', p_value: 'not-a-mode' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'content key: manager may write; the bogus enum value fails INVALID_SETTING_VALUE past the guard — nothing stored',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_modifier_reveals',
    args: { p_modifier_id: NIL_UUID, p_group_ids: [] },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil modifier fails MODIFIER_NOT_FOUND past the guard',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_item_photo',
    args: { p_item_id: NIL_UUID, p_photo_path: 'items/probe/x.webp' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'valid path, nil item -> ITEM_NOT_FOUND past the guard',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_item_sold_out',
    args: { p_item_id: NIL_UUID, p_sold_out: true },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_item_cost',
    args: { p_item_id: NIL_UUID, p_cost_iqd: 1 },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_table_bell',
    args: { p_table_id: NIL_UUID, p_enabled: false },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil table fails TABLE_NOT_FOUND past the guard',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'upsert_cafe_table',
    args: { p_table_number: '   ' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'blank number fails INVALID_TABLE_NUMBER past the guard — no side effect',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'table_qr_tokens',
    args: {},
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'QR export is manager|owner (0014 tier); one audit row per successful call',
    drop: 4,
  },

  // ── RPCs: owner-only ──────────────────────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'telegram_send_test',
    args: {},
    expect: ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' }),
    note: 'owner-ONLY (manager guarded); owner then hits TELEGRAM_NOT_CONFIGURED or enqueues a test row',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'analytics_daily_sales',
    args: { p_from: '2001-01-02', p_to: '2001-01-01' },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' }),
    note: 'every analytics_* surface is owner-only; inverted range fails INVALID_RANGE past the guard',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'save_analytics_insights',
    args: {
      p_range_from: '2001-01-01',
      p_range_to: '2001-01-02',
      p_compare_basis: 'not-a-basis',
      p_locale: 'ar',
      p_insights: [],
    },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' }),
    note: 'bogus basis fails INVALID_ARGUMENT past the guard — nothing stored',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'reject_insight',
    args: { p_text: '!!! ... ???' },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied', owner: 'execute' }),
    note: 'text with no letters/digits fails INVALID_ARGUMENT past the guard — nothing stored',
    drop: 4,
  },

  // ── RPCs: service-role only (edge functions) ──────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'claim_due_telegram',
    args: { p_limit: 1 },
    expect: ex<RpcExpectation>('denied'),
    note: 'CRITICAL: the Telegram outbox claim has no client EXECUTE at all',
    drop: 4,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'telegram_apply_action',
    args: { p_action: 'o:seen', p_ref_id: NIL_UUID, p_actor: { tg_user_id: 1 } },
    expect: ex<RpcExpectation>('denied'),
    note: 'CRITICAL: the callback write-back is service-role only — a client could otherwise move tickets unguarded',
    drop: 4,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP 5 — 0065 customers (customer_notes / customer_flags + desk RPCs).
  // Probe rows: helpers.ensureCustomerProbeData (ee57 prefix, one note + one
  // flag on a probe guest profile).
  // ═══════════════════════════════════════════════════════════════════════════

  // ── customer_notes: STAFF ONLY. Spec 06.9 "never rendered on any guest-
  //    facing surface" — a booking guest and a café guest are `authenticated`
  //    and get RLS silence; prep has no customer surface. Writes RPC-only. ──
  {
    kind: 'select',
    name: 'customer_notes',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'CRITICAL: staff-only notes — guest_account / guest_anon_session must read ZERO rows',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'customer_notes',
    op: 'insert',
    payload: { customer_id: NIL_UUID, body: 'x', author_id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'notes are written only through app.add_customer_note / edit_customer_note',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'customer_notes',
    op: 'update',
    payload: { body: 'x' },
    expect: ex<WriteExpectation>('denied'),
    note: 'an edit must stamp edited_at/edited_by and be audited — RPC-only for every principal',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'customer_notes',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    drop: 5,
  },

  // ── customer_flags: same wall as notes ──────────────────────────────────
  {
    kind: 'select',
    name: 'customer_flags',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'flags surface wherever the customer appears on STAFF screens; never to guests',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'customer_flags',
    op: 'insert',
    payload: { customer_id: NIL_UUID, type: 'vip', created_by: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'flags are replaced only through app.set_customer_flags',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'customer_flags',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    drop: 5,
  },

  // ── RPCs: desk reads (cashier included), desk writes (cashier excluded) ──
  {
    kind: 'rpc',
    schema: 'app',
    name: 'customer_search',
    args: { p_query: 'zz' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'search is court_desk|cashier|manager|owner; guests are refused before the query is read',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'customer_directory',
    args: { p_limit: 1 },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'the Customers list (0148) is court_desk|cashier|manager|owner, the same roles as customer_search',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'customer_record',
    args: { p_customer_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil customer fails CUSTOMER_NOT_FOUND past the guard',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'add_customer_note',
    args: { p_customer_id: NIL_UUID, p_body: 'x' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'cashier reads notes but does not write them; nil customer fails CUSTOMER_NOT_FOUND past the guard',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'edit_customer_note',
    args: { p_note_id: NIL_UUID, p_body: 'x' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil note fails NOTE_NOT_FOUND past the guard',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_customer_flags',
    args: { p_customer_id: NIL_UUID, p_flags: [] },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil customer fails CUSTOMER_NOT_FOUND past the guard — nothing replaced',
    drop: 5,
  },

  // ── RPCs: service-role only (desk-customer-create edge function) ─────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'find_customer_by_phone',
    args: { p_phone: '0000000' },
    expect: ex<RpcExpectation>('denied'),
    note: 'CRITICAL: the digits-only phone lookup has no client EXECUTE — it would otherwise be a phone-to-account oracle',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'desk_register_customer',
    args: {
      p_customer_id: NIL_UUID,
      p_full_name: 'x',
      p_phone: '0000000',
      p_preferred_lang: 'en',
      p_actor_id: NIL_UUID,
    },
    expect: ex<RpcExpectation>('denied'),
    note: 'CRITICAL: profile registration is service-role only (the edge function names the actor)',
    drop: 5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP 5 — 0066 reservation series (reservation_series, reservations.series_id).
  // Probe row: the runner plants one reservation_series row beside its probe
  // reservation (belongs to no guest).
  // ═══════════════════════════════════════════════════════════════════════════

  // ── reservation_series: staff read (cashier included: the till charges to a
  //    booking), the owning guest reads own; writes RPC-only for everyone ───
  {
    kind: 'select',
    name: 'reservation_series',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'probe series belongs to no guest: guests get RLS silence; prep has no booking surface',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'reservation_series',
    op: 'insert',
    payload: {
      court_id: NIL_UUID,
      pattern: 'weekly',
      start_time: '10:00',
      duration_min: 60,
      starts_on: '2001-01-01',
      ends_on: '2001-01-01',
      guest_name: 'x',
    },
    expect: ex<WriteExpectation>('denied'),
    note: 'CRITICAL: a series exists only via app.create_series (-> staff_create_reservation)',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'reservation_series',
    op: 'update',
    payload: { cancelled_at: FUTURE },
    expect: ex<WriteExpectation>('denied'),
    note: 'cancel is app.cancel_series only (reason required, audited per row)',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'reservations',
    op: 'update',
    payload: { series_id: null },
    expect: ex<WriteExpectation>('denied'),
    note: 'series membership is stamped inside app.create_series only',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'preview_series',
    args: {
      p_court_id: NIL_UUID,
      p_pattern: 'weekly',
      p_weekdays: null,
      p_start_time: '10:00',
      p_duration_min: 60,
      p_starts_on: '2001-01-01',
      p_ends_on: '2001-01-01',
    },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'read-only desk surface; nil court fails COURT_NOT_FOUND past the guard',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'create_series',
    args: {
      p_court_id: NIL_UUID,
      p_pattern: 'weekly',
      p_weekdays: null,
      p_start_time: '10:00',
      p_duration_min: 60,
      p_starts_on: '2001-01-01',
      p_ends_on: '2001-01-01',
      p_guest_name: 'x',
    },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil court fails COURT_NOT_FOUND past the guard — nothing written, no lock taken',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'series_detail',
    args: { p_series_id: NIL_UUID },
    expect: ex<RpcExpectation>('execute', { anon: 'denied', guest_anon_session: 'guarded' }),
    note:
      'ownership-guarded like cancel_reservation: any ACCOUNT may ask and gets SERIES_NOT_FOUND ' +
      'for a series it does not own; an anonymous cafe session has no account (ACCOUNT_REQUIRED)',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'cancel_series',
    args: { p_series_id: NIL_UUID, p_scope: 'future', p_reason_code: '' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'empty reason fails REASON_REQUIRED past the guard — no side effect',
    drop: 5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP 5 — 0067 promotions (promotions, promotion_redemptions,
  // tab_adjustments.promotion_id). Probe rows: helpers.ensurePromotionProbeData
  // — promotion ee57…701 is DISABLED so it can never reach a real tab.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    kind: 'select',
    name: 'promotions',
    expect: ex<SelectExpectation>('rows', {
      anon: 'denied',
      guest_account: 'silence',
      guest_anon_session: 'silence',
    }),
    note: 'every staff role reads promotions (the till needs names); guests never do in phase 1',
    drop: 5,
  },
  {
    kind: 'select',
    name: 'promotion_redemptions',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'money surface: same audience as tab_adjustments',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'promotions',
    op: 'insert',
    payload: { name_en: 'x', name_ar: 'س', type: 'percent', value: 10, created_by: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'RPC-only: app.upsert_promotion',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'promotions',
    op: 'update',
    payload: { enabled: false },
    expect: ex<WriteExpectation>('denied'),
    note: 'RPC-only: app.set_promotion_enabled — and no delete exists anywhere (06.26)',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'promotions',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    drop: 5,
  },
  {
    kind: 'write',
    name: 'promotion_redemptions',
    op: 'insert',
    payload: {
      promotion_id: NIL_UUID,
      tab_id: NIL_UUID,
      adjustment_id: NIL_UUID,
      amount_iqd: 1,
      redeemed_by: NIL_UUID,
    },
    expect: ex<WriteExpectation>('denied'),
    note: 'written only by app.apply_best_promotion',
    drop: 5,
  },
  {
    kind: 'write',
    name: 'promotion_redemptions',
    op: 'update',
    payload: { amount_iqd: 1 },
    expect: ex<WriteExpectation>('denied'),
    drop: 5,
  },
  {
    kind: 'write',
    name: 'promotion_redemptions',
    op: 'delete',
    expect: ex<WriteExpectation>('denied'),
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'upsert_promotion',
    args: {},
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'the guard admits manager|owner; since price_promo (#57) a manager is refused PRICE_VIA_PROTOCOL past it on every save (a promotion is proposed through a price or promotion change), the owner fails NAME_REQUIRED on empty args — no side effect',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_promotion_enabled',
    args: { p_id: NIL_UUID, p_enabled: false },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil id fails PROMOTION_NOT_FOUND past the guard; since price_promo (#57) a manager\'s switch-on of a promotion that is off is PRICE_VIA_PROTOCOL, a switch-off passes',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'generate_promo_code',
    args: { p_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'the owner fails PROMOTION_NOT_FOUND on a nil id past the guard; since price_promo (#57) a manager is refused PRICE_VIA_PROTOCOL past it (a code travels in the change\'s record)',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'eligible_promotions',
    args: { p_tab_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'till roles only (prep/desk guarded); nil tab fails TAB_NOT_FOUND past the guard',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'apply_best_promotion',
    args: { p_tab_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'cashier+ apply; nil tab fails TAB_NOT_FOUND past the guard — nothing written',
    drop: 5,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'send_test_push',
    args: {},
    expect: ex<RpcExpectation>('execute', {
      anon: 'denied',
    }),
    note:
      '0070 self-service: takes NO arguments, so the caller cannot name a profile — it can only ever ' +
      'enqueue for auth.uid(). Every signed-in principal reaches the body and stops at NO_PUSH_TOKEN ' +
      '(no Expo token on a test profile), which is business validation, not a role guard. anon has no ' +
      'grant at all. The security property under test is that there is no reachable path to another ' +
      "person's device.",
    drop: 5,
  },
  // ── drop 6 · 0072 staff requests · 0073 marketing · 0074 court delete ───────
  //
  // Eleven RPCs granted to `authenticated` landed on 2026-09-07 with no rule
  // here and no registry entry — the same gap migration 0070 left the day
  // before. Every one carries a role guard on its FIRST line, and check:authz
  // probes all of them as a real anonymous guest, so what these rules add is the
  // per-ROLE shape: which staff tier may call each, asserted rather than assumed.
  // Arguments are chosen to fail AFTER the guard and BEFORE any write.
  {
    kind: 'rpc',
    schema: 'app',
    name: 'submit_staff_request',
    args: { p_kind: '__not_a_kind__' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      prep: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'any staff may ask; guests refused by staff_role() is null. Bad kind fails BAD_KIND past the guard — nothing inserted',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'withdraw_staff_request',
    args: { p_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      prep: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'own request only; nil id fails past the guard',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'staff_requests_page',
    args: {},
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      prep: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'read-only; a guest cannot list staff requests at all',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'decide_staff_request',
    args: { p_id: NIL_UUID, p_approve: false },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      owner: 'execute',
    }),
    note: 'OWNER ONLY — approving leave or an advance is not a manager power; nil id fails past the guard',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'delete_court',
    args: { p_id: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'nil id fails past the guard — no court is removed',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'marketing_overview',
    args: {},
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      owner: 'execute',
    }),
    note: 'owner-only read',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'marketing_audience_reach',
    args: { p_rule: {} },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'counts an audience; returns a number, never guest identifiers',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'marketing_campaign_performance',
    args: { p_campaign: NIL_UUID },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'read-only; nil campaign returns nothing',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'save_marketing_audience',
    args: { p_id: NIL_UUID, p_name_en: '', p_name_ar: '' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      owner: 'execute',
    }),
    note: 'owner-only write; blank names fail NAME_REQUIRED before the insert/update',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'save_marketing_campaign',
    args: { p_id: NIL_UUID, p_name_en: '', p_name_ar: '', p_channel: '' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      owner: 'execute',
    }),
    note: 'owner-only write; blank names fail past the guard before anything is written',
    drop: 6,
  },
  {
    kind: 'rpc',
    schema: 'app',
    name: 'set_campaign_status',
    args: { p_id: NIL_UUID, p_status: '__not_a_status__' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      owner: 'execute',
    }),
    note: 'owner-only; bad status fails BAD_STATUS before the campaign is even looked up',
    drop: 6,
  },

  // ── account deletion (0077) ───────────────────────────────────────────────
  {
    kind: 'rpc',
    schema: 'app',
    name: 'delete_my_account',
    // NO p_confirm. That is deliberate and load-bearing: this matrix EXECUTES
    // every rule as all eight principals, so a rule carrying the confirmation
    // token would delete the suite's own guest_account on every run. Without it
    // the call stops at CONFIRMATION_REQUIRED — past the guard layer, which is
    // exactly what 'execute' asserts, and short of doing anything.
    args: {},
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',              // no EXECUTE grant to anon
      guest_account: 'execute',    // a real account gets as far as the confirmation
    }),
    note:
      'A cafe guest holds `authenticated` exactly as staff do, so the guards ARE ' +
      'the boundary: an anonymous session has no account to delete ' +
      '(ACCOUNT_REQUIRED) and a staff member is deactivated rather than deleted ' +
      '(FORBIDDEN — staff.id -> auth.users is ON DELETE RESTRICT, so without the ' +
      'guard the call would reach the delete and fail there with a raw 23503).',
    drop: 6,
  },
  // ══════════════════════════════════════════════════════════════════════════
  // DROP 7 — Phase 3 authorization sweep (SEC-12).
  //
  // Closes the gap §07 named: 67 granted RPCs had no realistic-argument rule,
  // so the ONLY thing asserting them was check-rpc-authz.mjs, which calls
  // everything with NULL as a single anonymous principal. That proves ROLE and
  // nothing else. These rules run the same functions as all eight principals
  // with arguments shaped to fail AFTER the guard.
  //
  // THE ARGUMENTS ARE THE SAFETY MECHANISM. Every principal expected to
  // 'execute' really does call the function, so each rule below is built to die
  // on a lookup or a validation check BEFORE anything is written — a NIL_UUID
  // foreign key, a blank name, a min>max range, an inverted date range. Every
  // one was read out of the function body first; they are not guesses.
  //
  // Guards, read from the live catalog 2026-09-07:
  //   app.analytics_guard()      -> is_staff('owner')
  //   app.reports_guard(true)    -> is_staff('owner')
  //   app.reports_guard(false)   -> is_staff('manager','owner')
  //
  // THREE ARE DELIBERATELY NOT COVERED, and this is the reason:
  //
  //   verify_manager_pin, verify_own_pin — the PIN limiter is 5 failures per
  //     CALLER per 5 minutes, in one shared app.pin_attempts table. Probing
  //     them as five staff principals every run would collide with the suites
  //     that assert on that limiter: hardening.test.ts drives `prep` to lockout
  //     and asserts `court_desk` is NOT collateral damage, and idle-lock.test.ts
  //     drives `owner` to lockout. hardening.test.ts:228 already names this
  //     coupling. Both RPCs are covered there, deliberately and in more depth
  //     than a matrix row could manage.
  //
  //   start_count — takes NO arguments and validates nothing before its INSERT,
  //     so manager and owner cannot call it without creating a real stock count
  //     and leaving it open for stock-admin.test.ts to trip over. There is no
  //     argument that makes it fail safely. Covered by stock-admin.test.ts.
  // ══════════════════════════════════════════════════════════════════════════

  // ── owner only: the analytics family (app.analytics_guard) ────────────────
  { kind: 'rpc', schema: 'app', name: 'analytics_best_sellers', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_bought_together', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_hourly', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_item_margins', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_menu_snapshot', args: {}, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_price_bands', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_promo', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'analytics_sold_items', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },

  // ── owner only: the Courts analytics family (0093, app.analytics_guard) ──
  // DROP 8. Same guard, same prologue; p_court_id is optional and unknown
  // ids yield empty sections, so the date pair alone is a safe probe.
  { kind: 'rpc', schema: 'app', name: 'analytics_courts_cafe', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 8 },
  { kind: 'rpc', schema: 'app', name: 'analytics_courts_demand', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 8 },
  { kind: 'rpc', schema: 'app', name: 'analytics_courts_endings', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 8 },
  { kind: 'rpc', schema: 'app', name: 'analytics_courts_guests', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 8 },
  { kind: 'rpc', schema: 'app', name: 'analytics_courts_summary', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 8 },
  {
    kind: 'rpc', schema: 'app', name: 'save_analytics_patterns',
    // Inverted range -> INVALID_RANGE, so owner never reaches the INSERT.
    args: { p_range_from: DAY_TO, p_range_to: DAY_FROM, p_locale: 'en', p_patterns: [] },
    expect: OWNER_ONLY, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'unreject_insight', args: { p_id: NIL_UUID }, expect: OWNER_ONLY, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'llm_usage_summary',
    // 0079/SEC-29. Spend is the owner's business and nobody else's — a manager
    // reading the model bill learns the venue's cost base.
    args: {}, expect: OWNER_ONLY, drop: 7,
  },

  // ── owner only: staff administration ──────────────────────────────────────
  { kind: 'rpc', schema: 'app', name: 'clear_staff_pin', args: { p_staff_id: NIL_UUID }, expect: OWNER_ONLY, drop: 7 },
  {
    // 0086/SEC-13. Releases a staff member locked out by five failed PIN
    // attempts. MANAGER_UP, not OWNER_ONLY: the lockout happens mid-service and
    // the owner is not always on the floor — an unclearable lock is why the
    // shift lead ends up sharing a PIN, which is the outcome the whole PIN
    // regime exists to prevent. It is audited, which is what makes delegating
    // it safe. Probed with NIL_UUID: every principal that passes the role guard
    // then meets STAFF_NOT_FOUND, which counts as 'execute'.
    kind: 'rpc', schema: 'app', name: 'clear_pin_lockout',
    args: { p_staff_id: NIL_UUID }, expect: MANAGER_UP, drop: 8,
  },
  { kind: 'rpc', schema: 'app', name: 'rename_staff', args: { p_staff_id: NIL_UUID, p_display_name: 'matrix probe' }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'set_staff_active', args: { p_staff_id: NIL_UUID, p_active: false }, expect: OWNER_ONLY, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'set_staff_role',
    // p_role must be a REAL staff_role: an unknown label fails at argument
    // coercion, before the function body, so no principal would reach the guard
    // and every 'guarded' expectation here would silently stop meaning anything.
    args: { p_staff_id: NIL_UUID, p_role: 'cashier' },
    expect: OWNER_ONLY, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'set_telegram_staff', args: { p_tg_user_id: 1, p_staff_id: NIL_UUID }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'retry_telegram_outbox', args: { p_id: 9_999_999_999 }, expect: OWNER_ONLY, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'set_venue_details',
    // The timezone is not an editable key -> INVALID_ARGUMENT before anything
    // is written. A valid patch here would rewrite the live venue on every run.
    args: { p_patch: { timezone: 'UTC' } }, expect: OWNER_ONLY, drop: 7,
  },

  // ── owner only: the money-facing reports (app.reports_guard(true)) ────────
  { kind: 'rpc', schema: 'app', name: 'panel_headline', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'report_revenue', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: OWNER_ONLY, drop: 7 },

  // ── manager + owner: reports and the audit trail (reports_guard(false)) ───
  { kind: 'rpc', schema: 'app', name: 'audit_log_page', args: { p_from: TS_FROM, p_to: TS_TO }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'ops_overview', args: {}, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'report_cafe', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'report_courts', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: MANAGER_UP, drop: 7 },
  // An unknown report -> INVALID_ARGUMENT after the guard (0103).
  { kind: 'rpc', schema: 'app', name: 'report_compare', args: { p_report: '__nope__', p_from: DAY_FROM, p_to: DAY_TO, p_compare: 'previousPeriod' }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'report_drill', args: { p_figure: '__not_a_figure__', p_key: 'x', p_from: DAY_FROM, p_to: DAY_TO }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'report_staff_activity', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'report_stock', args: { p_from: DAY_FROM, p_to: DAY_TO }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'list_staff', args: {}, expect: MANAGER_UP, drop: 7 },

  // ── manager + owner: menu, courts, stock and venue configuration ──────────
  { kind: 'rpc', schema: 'app', name: 'finalize_count', args: { p_count_id: NIL_UUID }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'link_item_modifier_group', args: { p_item_id: NIL_UUID, p_group_id: NIL_UUID }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'reorder_courts', args: { p_ids: [NIL_UUID] }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'reorder_menu_categories', args: { p_ids: [NIL_UUID] }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'reorder_menu_items', args: { p_ids: [NIL_UUID] }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'reorder_modifiers', args: { p_ids: [NIL_UUID] }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'set_addon_suggestions', args: { p_item_id: NIL_UUID, p_suggested_item_ids: [] }, expect: MANAGER_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'set_cafe_settings',
    // A JSON ARRAY, not an object -> INVALID_SETTINGS before anything is saved.
    args: { p_settings: [] }, expect: MANAGER_UP, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'set_category_photo', args: { p_category_id: NIL_UUID, p_photo_path: 'matrix/probe.png' }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'set_item_availability', args: { p_item_id: NIL_UUID, p_available: false }, expect: MANAGER_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'set_opening_hours',
    // Array, not object -> INVALID_HOURS. Passing nothing would UPDATE venue_settings.
    args: { p_opening_hours: [] }, expect: MANAGER_UP, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'set_recipe', args: { p_target: '__not_a_target__', p_target_id: NIL_UUID, p_lines: [] }, expect: MANAGER_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'set_waiter_call_cooldown',
    // Below the 30-second floor -> INVALID_COOLDOWN. A VALID number here would
    // rewrite the live venue setting on every run of the suite.
    args: { p_seconds: 1 }, expect: MANAGER_UP, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'upsert_court', args: { p_name_en: '', p_name_ar: '', p_indoor: true }, expect: MANAGER_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'upsert_ingredient',
    // Blank names -> NAME_REQUIRED. p_unit must still be a REAL stock_unit or
    // the call dies at coercion and never reaches the guard.
    args: { p_name_en: '', p_name_ar: '', p_unit: 'g' }, expect: MANAGER_UP, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'upsert_menu_category', args: { p_name_en: 'x', p_name_ar: 'x', p_tax_group_id: NIL_UUID }, expect: MANAGER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'upsert_modifier', args: { p_group_id: NIL_UUID, p_name_en: 'x', p_name_ar: 'x' }, expect: MANAGER_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'upsert_modifier_group',
    // min > max -> INVALID_SELECT_RANGE; this one has no foreign key to miss on.
    args: { p_name_en: 'x', p_name_ar: 'x', p_min_select: 5, p_max_select: 1 },
    expect: MANAGER_UP, drop: 7,
  },
  {
    kind: 'rpc', schema: 'app', name: 'upsert_rate_rule',
    // A named court that does not exist -> COURT_NOT_FOUND. Leaving p_court_id
    // null would make it a VENUE-WIDE rule and it would be created for real.
    args: {
      p_name: 'matrix probe', p_days_of_week: [1], p_start_time: '10:00', p_end_time: '11:00',
      p_prices: {}, p_court_id: NIL_UUID,
    },
    note: 'the owner fails COURT_NOT_FOUND past the guard; since price_promo (#57) a manager is refused PRICE_VIA_PROTOCOL past it on every save (a court rate changes through a rate change)',
    expect: MANAGER_UP, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'upsert_variant', args: { p_item_id: NIL_UUID, p_name_en: 'x', p_name_ar: 'x', p_price_iqd: 1000 }, expect: MANAGER_UP, drop: 7 },

  // ── cashier + manager + owner: the till surface ───────────────────────────
  { kind: 'rpc', schema: 'app', name: 'merge_tabs', args: { p_donor_tab_id: NIL_UUID, p_survivor_tab_id: NIL_UUID }, expect: CASHIER_DESK_UP, drop: 7 },
  // Nil tab stops at NO_OPEN_DAY/TAB_NOT_FOUND past the guard — nothing is voided.
  // The reason is mandatory (0100), so it is supplied here: without it every
  // allowed role would stop at REASON_REQUIRED and the row would prove nothing
  // about the guard it exists to test.
  { kind: 'rpc', schema: 'app', name: 'cancel_tab', args: { p_tab_id: NIL_UUID, p_reason_code: 'matrix' }, expect: CASHIER_DESK_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'override_price',
    // The CORRECT manager PIN on purpose. A wrong one writes a failed row to
    // app.pin_attempts, and five of those in five minutes lock that caller out
    // of every PIN path — which is shared state the hardening and idle-lock
    // suites assert on. A successful check writes success=true and counts
    // toward nothing. The NIL line id then stops it at ITEM_NOT_FOUND.
    args: { p_order_item_id: NIL_UUID, p_new_unit_price_iqd: 1000, p_pin: MANAGER_PIN, p_reason_code: 'matrix' },
    expect: CASHIER_UP, drop: 7,
  },
  {
    kind: 'rpc', schema: 'app', name: 'record_drawer_open',
    args: { p_reason_code: '' }, // REASON_REQUIRED — nothing is recorded
    expect: CASHIER_DESK_UP, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'resolve_waiter_call', args: { p_call_id: NIL_UUID }, expect: CASHIER_UP, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'split_by_item', args: { p_tab_id: NIL_UUID, p_groups: [] }, expect: CASHIER_UP, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'void_after_send',
    args: { p_order_item_id: NIL_UUID, p_pin: MANAGER_PIN, p_reason_code: 'matrix' },
    expect: CASHIER_UP, drop: 7,
  },
  {
    kind: 'rpc', schema: 'app', name: 'write_off_expired',
    args: { p_batch_id: NIL_UUID, p_pin: MANAGER_PIN, p_reason_code: 'expired' },
    expect: CASHIER_UP, drop: 7,
  },

  // ── prep + cashier + manager + owner: the kitchen surface ─────────────────
  { kind: 'rpc', schema: 'app', name: 'set_order_item_ready', args: { p_order_item_id: NIL_UUID, p_ready: true }, expect: PREP_UP, drop: 7 },

  // ── ownership-guarded, not role-guarded ───────────────────────────────────
  {
    kind: 'rpc', schema: 'app', name: 'release_hold',
    args: { p_reservation_id: NIL_UUID },
    // An ACCOUNT is required, exactly as for hold_slot (0048/C1): an anonymous
    // cafe session has no profiles row and is turned away with ACCOUNT_REQUIRED.
    // Everyone else passes the guard and stops at HOLD_NOT_FOUND; ownership
    // itself is proved by hold-release.test.ts with two real accounts.
    expect: ex<RpcExpectation>('execute', { anon: 'denied', guest_anon_session: 'guarded' }),
    drop: 7,
  },

  // ── tell-me-about-myself helpers: no role guard, and none needed ──────────
  // Each answers only about the CALLER, or about data that is public before any
  // identity exists. They are listed in check-rpc-authz's PUBLIC_BY_DESIGN; these
  // rows are what proves the claim across all eight principals rather than one.
  { kind: 'rpc', schema: 'app', name: 'is_media_path', args: { p: 'menu-media/x.png' }, expect: SELF_ANON_OK, drop: 7 },
  {
    kind: 'rpc', schema: 'app', name: 'is_staff',
    // VARIADIC roles staff_role[]. PostgREST needs the array under its real
    // parameter name — an empty body 404s with PGRST202 ("without parameters")
    // and would read as un-probed rather than as covered.
    args: { roles: ['owner'] },
    expect: SELF_ANON_OK, drop: 7,
  },
  { kind: 'rpc', schema: 'app', name: 'menu_availability', args: {}, expect: SELF_ANON_OK, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'staff_role', args: {}, expect: SELF_ANON_OK, drop: 7 },
  {
    // 0087/SEC-34. Self-answering, like staff_role beside it: no argument, so
    // every principal may call it and each learns one boolean about itself.
    // anon and both guest shapes get a plain `false` rather than a refusal —
    // there is nothing to refuse when the answer is about the caller.
    kind: 'rpc', schema: 'app', name: 'has_own_pin',
    args: {}, expect: SELF_ANON_OK, drop: 8,
  },
  { kind: 'rpc', schema: 'app', name: 'is_own_session', args: { p_session_id: NIL_UUID }, expect: SELF_AUTHED, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'item_active_groups', args: { p_item_id: NIL_UUID, p_chosen_modifier_ids: [] }, expect: SELF_AUTHED, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'order_is_callers', args: { p_order_id: NIL_UUID }, expect: SELF_AUTHED, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'tab_is_callers', args: { p_tab_id: NIL_UUID }, expect: SELF_AUTHED, drop: 7 },
  { kind: 'rpc', schema: 'app', name: 'verify_table_token', args: { p_token: 'not-a-real-token' }, expect: SELF_AUTHED, drop: 7 },

  // ── 0105: staff breaks with cover ─────────────────────────────────────────
  // Every staff role takes breaks (a prep cook has a rail-less screen, but the
  // RPC does not know that), so the guard is "active staff", not a role tier.
  // The arguments are chosen to fail BEFORE the PIN check for every principal:
  // start_break refuses an empty station id, end_break and cover_station find
  // no open break. A PIN comparison here would write pin_attempts rows under
  // five principals every run and collide with the limiter suites.
  {
    kind: 'rpc', schema: 'app', name: 'break_status',
    args: { p_device_id: 'TILL-MATRIX' }, expect: STAFF_ANY, drop: 9,
  },
  {
    kind: 'rpc', schema: 'app', name: 'start_break',
    args: { p_pin: '000000', p_device_id: '' }, expect: STAFF_ANY, drop: 9,
  },
  {
    kind: 'rpc', schema: 'app', name: 'end_break',
    args: { p_pin: '000000', p_device_id: 'TILL-MATRIX' }, expect: STAFF_ANY, drop: 9,
  },
  {
    kind: 'rpc', schema: 'app', name: 'cover_station',
    args: { p_staff_id: NIL_UUID, p_pin: '000000', p_device_id: 'TILL-MATRIX' }, expect: STAFF_ANY, drop: 9,
  },
  // Assigning cover is a floor matter: manager and owner, not owner alone.
  {
    kind: 'rpc', schema: 'app', name: 'set_station_staff',
    args: { p_staff_id: NIL_UUID, p_station_ids: [] }, expect: MANAGER_UP, drop: 9,
  },

  // ── 0106: the court desk takes court payment ─────────────────────────────
  // Nil ids stop every allowed principal past the guard with nothing written:
  // settle_zero_tab at NO_OPEN_DAY/TAB_NOT_FOUND (the reason is supplied so it
  // is not REASON_REQUIRED that answers), booking_bill at RESERVATION_NOT_FOUND,
  // booking_bill_states on an empty list, unpaid_played_bookings on a day that
  // does not exist.
  {
    kind: 'rpc', schema: 'app', name: 'settle_zero_tab',
    args: { p_tab_id: NIL_UUID, p_reason_code: 'matrix' }, expect: CASHIER_DESK_UP, drop: 10,
  },
  { kind: 'rpc', schema: 'app', name: 'booking_bill', args: { p_reservation_id: NIL_UUID }, expect: CASHIER_DESK_UP, drop: 10 },
  { kind: 'rpc', schema: 'app', name: 'booking_bill_states', args: { p_reservation_ids: [] }, expect: CASHIER_DESK_UP, drop: 10 },
  { kind: 'rpc', schema: 'app', name: 'unpaid_played_bookings', args: { p_day_session_id: NIL_UUID }, expect: MANAGER_UP, drop: 10 },

  // ── 0108–0112: the owner assistant ───────────────────────────────────────
  // Owner-only by decision (plan §12 DECIDE 5). Nil ids and an unknown tool
  // name stop the owner past the guard with nothing written: CONVERSATION_NOT_FOUND,
  // ASSISTANT_UNKNOWN_TOOL / ASSISTANT_NOT_COUNTABLE, JOB_NOT_FOUND; search,
  // pricing and the meter are pure reads.
  {
    kind: 'rpc', schema: 'app', name: 'assistant_archive_conversation',
    args: { p_id: NIL_UUID }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_set_scopes',
    args: { p_id: NIL_UUID, p_scopes: ['howto'] }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_run_tool',
    args: { p_tool: 'matrix_probe', p_args: {} }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_count',
    args: { p_tool: 'matrix_probe', p_args: {} }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_search',
    args: { p_query: 'matrix probe', p_embedding: null, p_kinds: null, p_limit: 1 }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'llm_price_micros',
    args: { p_model: 'matrix', p_input: 0, p_cache_write: 0, p_cache_read: 0, p_output: 0 }, expect: OWNER_ONLY, drop: 11,
  },
  { kind: 'rpc', schema: 'app', name: 'assistant_usage', args: {}, expect: OWNER_ONLY, drop: 11 },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_job_cancel',
    args: { p_id: NIL_UUID }, expect: OWNER_ONLY, drop: 11,
  },
  // 0140: the model switch. A nil chat id stops the owner at NOT_FOUND; an
  // unpriced model name at ASSISTANT_MODEL_NOT_PRICED; the list is a pure read.
  { kind: 'rpc', schema: 'app', name: 'assistant_models', args: {}, expect: OWNER_ONLY, drop: 11 },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_set_model',
    args: { p_id: NIL_UUID, p_model: null }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_set_default_model',
    args: { p_model: 'matrix-probe-model' }, expect: OWNER_ONLY, drop: 11,
  },
  // 0149: the monthly cap. A negative figure stops the owner at
  // INVALID_ARGUMENT, so the probe writes nothing.
  {
    kind: 'rpc', schema: 'app', name: 'assistant_set_monthly_cap',
    args: { p_cap_micros: -1 }, expect: OWNER_ONLY, drop: 11,
  },
  // 0141: analytics components. An unknown key stops the owner at
  // COMPONENT_NOT_FOUND; an empty tool list at INVALID_ARGUMENT; nothing written.
  {
    kind: 'rpc', schema: 'app', name: 'analytics_component',
    args: { p_key: 'matrix_probe_component', p_params: {} }, expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_pin_component',
    args: { p_key: 'matrix_probe_component', p_question: 'probe', p_tools: [], p_output_schema: { type: 'object' }, p_default_params: {} },
    expect: OWNER_ONLY, drop: 11,
  },
  {
    kind: 'rpc', schema: 'app', name: 'assistant_archive_component',
    args: { p_key: 'matrix_probe_component' }, expect: OWNER_ONLY, drop: 11,
  },

  // ── drop 12 · Phase 2 milestone 0 (criticals) ───────────────────────────────
  {
    kind: 'rpc', schema: 'app', name: 'phone_digits',
    args: { p_phone: '٠٧٧٠ ١٢٣ ٤٥٦٧' },
    expect: ex<RpcExpectation>('execute'),
    note: '0116/S7: pure text folding, granted to anon+authenticated because the profiles_phone_format CHECK evaluates it as the writing role',
    drop: 12,
  },
  {
    kind: 'rpc', schema: 'app', name: 'retire_device',
    args: { p_device_id: 'PROBE-RLS-NEVER' }, expect: OWNER_ONLY,
    note: '0118/C2: owner ends a stale till hold on degraded mode; an unknown id fails DEVICE_NOT_FOUND past the guard',
    drop: 12,
  },

  // ── drop 13 · Phase 2 milestone 1 slice 1 (multi-venue foundation) ─────────
  // Only ONE venue is active while this file runs; venue B lives and dies
  // inside tests/multi-venue.test.ts. Cross-venue isolation is proved there,
  // with two real B principals — this declarative loop selects with no filter
  // and could not tell A's rows from B's.
  {
    kind: 'select',
    name: 'venues',
    note: '0122: the venue list is public — the guest menu and the booking app name the venue before any identity exists, so venues_read admits everyone while is_active',
    expect: ex<SelectExpectation>('rows'),
    drop: 13,
  },
  {
    kind: 'select',
    name: 'staff_venues',
    note: '0123/0139: granted to authenticated only. A staffer reads their own membership (staff_venues_read_own); manager/owner read the rows of THEIR venues (staff_venues_read_mgmt, venue-scoped since 0139; the owner holds every active venue); a guest sees nothing rather than an error',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows', prep: 'rows', court_desk: 'rows', manager: 'rows', owner: 'rows',
    }),
    drop: 13,
  },
  {
    kind: 'select',
    name: 'stations',
    note: '0124/0139: the device registry is staff-only and venue-scoped (stations_read_staff, venue conjunct since 0139). ensureStationProbe plants TILL-PROBE-A at venue A so the five staff have a row to see',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows', prep: 'rows', court_desk: 'rows', manager: 'rows', owner: 'rows',
    }),
    drop: 13,
  },
  {
    kind: 'write',
    name: 'venues',
    op: 'insert',
    payload: { id: NIL_UUID, slug: 'matrix-probe', name_en: 'Matrix probe', name_ar: 'فحص المصفوفة' },
    note: '0122: venues are migration-written. A second ACTIVE venue before slice 3 makes every guest insert raise VENUE_REQUIRED, so no client may create one',
    expect: ex<WriteExpectation>('denied'),
    drop: 13,
  },
  {
    kind: 'write',
    name: 'staff_venues',
    op: 'insert',
    payload: { staff_id: NIL_UUID, venue_id: VENUE_A, role: 'cashier' },
    note: '0123: membership is written by the staff trigger and by app.register_staff, never by a client — granting yourself a venue is granting yourself its data',
    expect: ex<WriteExpectation>('denied'),
    drop: 13,
  },
  {
    kind: 'write',
    name: 'staff_venues',
    op: 'update',
    payload: { role: 'owner' },
    note: '0123: the same argument for the role column — an editable membership row is a role escalation',
    expect: ex<WriteExpectation>('denied'),
    drop: 13,
  },
  {
    kind: 'write',
    name: 'stations',
    op: 'insert',
    payload: { id: 'MATRIX-PROBE-NEVER', venue_id: VENUE_A, is_till: false },
    note: '0124/0130: a station registers itself through app.heartbeat, which resolves the venue and audits the registration; a direct insert would file a device wherever it liked',
    expect: ex<WriteExpectation>('denied'),
    drop: 13,
  },
  // The venue resolvers. Every one is granted to anon as well as authenticated
  // (0125/0123/0137): each is named by a column default, a policy or a CHECK,
  // and those evaluate as the WRITING role — the 0121 trap. None of them
  // answers about anything but the caller's own context.
  {
    kind: 'rpc', schema: 'app', name: 'current_venue',
    note: '0125: resolves station -> single membership -> single active venue, else raises VENUE_REQUIRED. A refusal is still an execute: it is a business answer, not a permission one',
    args: { p_station_id: null }, expect: SELF_ANON_OK, drop: 13,
  },
  {
    kind: 'rpc', schema: 'app', name: 'current_venue_or_default',
    note: '0125: the cron/service_role shape — falls back to the default venue rather than raising, and is the default on the eight D tables',
    args: {}, expect: SELF_ANON_OK, drop: 13,
  },
  {
    kind: 'rpc', schema: 'app', name: 'staff_venue_ids',
    note: '0123: the caller\'s own active memberships (every active venue for an owner). A guest gets an empty array, not a refusal',
    args: {}, expect: SELF_ANON_OK, drop: 13,
  },
  {
    kind: 'rpc', schema: 'app', name: 'is_staff_at',
    // VARIADIC roles staff_role[] after a named argument — same shape as the
    // is_staff rule in drop 7: PostgREST needs the array under its real name.
    note: '0123/0139: "is the caller one of these roles AT this venue". Called by no policy in slice 1 (0136 scopes on staff_venue_ids()); kept for slice 2 per-venue roles. 0139 revoked anon: it is authenticated-only',
    args: { p_venue: VENUE_A, roles: ['owner'] }, expect: SELF_AUTHED, drop: 13,
  },
  {
    kind: 'rpc', schema: 'app', name: 'is_degraded',
    note: '0137: the per-venue overload. The zero-arg form (drop 1) delegates through current_venue_or_default so the pre-identity guest menu can never be made to raise',
    args: { p_venue: VENUE_A }, expect: SELF_ANON_OK, drop: 13,
  },
  {
    kind: 'rpc', schema: 'app', name: 'venue_mode',
    note: '0137: the per-venue overload of the mode banner the guest app polls before sign-in',
    args: { p_venue: VENUE_A }, expect: SELF_ANON_OK, drop: 13,
  },

  // ── drop 14 · Phase 2 item 5 (Touch Shop, 0143–0146) ──────────────────────
  {
    kind: 'select',
    name: 'suppliers',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: '0144: suppliers are management data, venue-scoped like ingredients; the till never reads them',
    drop: 14,
  },
  {
    kind: 'write',
    name: 'suppliers',
    op: 'insert',
    payload: { venue_id: VENUE_A, name: 'MATRIX-PROBE-NEVER' },
    note: '0144: written only through app.upsert_supplier (duplicate-spelling check, audit)',
    expect: ex<WriteExpectation>('denied'),
    drop: 14,
  },
  {
    kind: 'rpc', schema: 'app', name: 'set_category_kind',
    args: { p_id: NIL_UUID, p_kind: 'shop' }, expect: MANAGER_UP,
    note: '0145: cafe <-> shop on an empty section; an unknown id fails CATEGORY_NOT_FOUND past the guard',
    drop: 14,
  },
  {
    kind: 'rpc', schema: 'app', name: 'upsert_supplier',
    args: { p_name: '' }, expect: MANAGER_UP,
    note: '0145: a blank name fails INVALID_ARGUMENT past the guard',
    drop: 14,
  },
  {
    kind: 'rpc', schema: 'app', name: 'upsert_retail_variant',
    args: { p_item_id: NIL_UUID, p_name_en: 'x', p_name_ar: 'x', p_price_iqd: 1 }, expect: MANAGER_UP,
    note: '0145: variant + its own retail stock row in one transaction; an unknown item fails ITEM_NOT_FOUND past the guard',
    drop: 14,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_reservations',
    args: { p_reservation_id: NIL_UUID },
    expect: ex<RpcExpectation>('execute', { anon: 'denied' }),
    note:
      '0150: ownership-guarded like cancel_reservation, but it FILTERS rather than raising \u2014 any ' +
      'account may ask and gets back only rows whose guest_id is its own, so an id it does not own ' +
      'returns the empty set. anon holds no grant at all.',
    drop: 15,
  },

  // ── terms consent (0153) ──────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'profiles',
    columns: 'terms_version, terms_accepted_at',
    expect: ex<SelectExpectation>('rows', { anon: 'denied', guest_anon_session: 'silence' }),
    note: '0153: the app gate reads the caller’s own acceptance; same row visibility as the other profile columns',
    drop: 16,
  },
  {
    kind: 'write',
    name: 'profiles',
    op: 'update',
    payload: { terms_version: '2000-01-01', terms_accepted_at: '2000-01-01T00:00:00Z' },
    expect: ex<WriteExpectation>('denied'),
    note: '0153: no UPDATE grant on the consent columns — app.accept_terms is the only write path, so the timestamp is the server’s',
    drop: 16,
  },
  {
    kind: 'rpc', schema: 'app', name: 'accept_terms',
    // No p_version: every principal that passes the guard stops at
    // VERSION_INVALID, so the matrix never records an acceptance.
    args: {},
    expect: ex<RpcExpectation>('execute', { anon: 'denied', guest_anon_session: 'guarded' }),
    note:
      '0153: any account may accept for itself; an anonymous café session has no profile and is ' +
      'refused with ACCOUNT_REQUIRED. anon holds no grant.',
    drop: 16,
  },

  // ── kitchen board read (kitchen_board_read, build-contracts §2.23) ────────
  {
    kind: 'rpc', schema: 'app', name: 'kitchen_board',
    args: {}, expect: PREP_UP,
    note:
      'the kitchen list of set_ticket_status at the venue (the bar and kitchen roles too, not in ' +
      'this matrix); court_desk and guests are refused FORBIDDEN, anon holds no grant. No window ' +
      'argument: the two-minute completed window is fixed in the body.',
    drop: 17,
  },

  // ── work photos (staff_media_bucket, build-contracts §2.3) ──────────────────
  {
    kind: 'select',
    name: 'staff_media_uploads',
    expect: ex<SelectExpectation>('silence', { anon: 'denied' }),
    note:
      'upload slots: each staff member reads only the slots minted for them (uploader = auth.uid()), ' +
      'and none of the matrix principals holds one while it runs; a guest sees nothing. ' +
      'tests/staff-media.test.ts proves the own-row read with real slots',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'staff_media_uploads',
    op: 'insert',
    payload: { path: 'matrix-probe-never', venue_id: VENUE_A, folder: 'steps', uploader: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'slots are minted only by app.staff_media_slot, which checks the venue and the hourly limit',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'staff_media_slot',
    args: { p_venue_id: VENUE_A, p_folder: 'matrix-never', p_ext: 'jpg' }, expect: STAFF_ANY,
    note: 'any active staff member at the venue; an unknown folder fails INVALID_ARGUMENT past the guard, so no slot is minted',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'is_staff_media_path',
    args: { p_name: 'items/matrix/probe.webp' }, expect: SELF_ANON_OK,
    note: 'pure text, never raises; granted to anon because the staff-media storage policies evaluate it as the reading role',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'staff_media_venue',
    args: { p_name: 'items/matrix/probe.webp' }, expect: SELF_ANON_OK,
    note: 'pure text: NULL for a name that is not a staff-media path; policy-evaluated, hence the anon grant',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'staff_media_folder',
    args: { p_name: 'items/matrix/probe.webp' }, expect: SELF_ANON_OK,
    note: 'pure text: NULL for a name that is not a staff-media path; policy-evaluated, hence the anon grant',
    drop: 17,
  },

  // ── ingredient names for the staff phone (staff_ingredient_options, §2.5) ──
  {
    kind: 'rpc', schema: 'app', name: 'staff_ingredient_options',
    args: { p_venue_id: VENUE_A, p_query: 'matrix-never' }, expect: MANAGER_UP,
    note:
      'the bar and kitchen family, the driver and MGMT (the new roles are not in this matrix: ' +
      'tests/staff-ingredient-options.test.ts); names, unit, kind and pack size only, no cost',
    drop: 17,
  },

  // ── protocol engine (protocols_engine_tables / _rpcs, §2.6, §2.7) ─────────
  // Select rules for the two template tables only: the seed gives MGMT rows to
  // read. The run-side tables have no probe row here, so their reads (MGMT
  // rows, everyone else silence) are proven in tests/protocols-roles.test.ts
  // against a probe run; every one of the seven refuses a client write.
  {
    kind: 'select',
    name: 'protocol_templates',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: 'MGMT at the venue; everyone else reads protocols through the definer RPCs',
    drop: 17,
  },
  {
    kind: 'select',
    name: 'protocol_template_steps',
    expect: ex<SelectExpectation>('silence', { anon: 'denied', manager: 'rows', owner: 'rows' }),
    note: 'MGMT at the venue, by exists on the template',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_templates',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC (start_protocol, submit_step, save_protocol_template, …)',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_template_steps',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: definer RPCs only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_template_items',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: definer RPCs only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_runs',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: definer RPCs only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_run_steps',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: definer RPCs only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_submissions',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: definer RPCs only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'protocol_run_items',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: definer RPCs only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'start_protocol',
    args: { p_kind: 'price_promo' }, expect: MANAGER_UP,
    note:
      'starters by kind (product_release adds the heads, price_promo marketing; not in this matrix); ' +
      'no title and no first record, so a caller past the guard stops at TEXT_REQUIRED or RECORD_INVALID',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'submit_step',
    args: { p_run_step_id: NIL_UUID, p_record: {} }, expect: STAFF_ANY,
    note: 'any active staff member; then who may act on the step. An unknown step is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'withdraw_step',
    args: { p_submission_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the sender only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'decide_step',
    args: { p_submission_id: NIL_UUID, p_decision: 'approve' }, expect: STAFF_ANY,
    note: 'any active staff member; then the step’s decider (NOT_DECIDER), never on their own submission',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'skip_step',
    args: { p_run_step_id: NIL_UUID, p_note: 'matrix' }, expect: STAFF_ANY,
    note: 'any active staff member; then the step’s decider, on an optional step',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'tick_run_item',
    args: { p_item_id: NIL_UUID, p_done: true }, expect: STAFF_ANY,
    note: 'any active staff member; then who may act on the open step',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'withdraw_protocol',
    args: { p_run_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the starter, before any decision',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'stop_protocol',
    args: { p_run_id: NIL_UUID, p_note: 'matrix' }, expect: MANAGER_UP,
    note: 'MGMT at the run’s venue',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'cancel_schedule',
    args: { p_run_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then who may act on the terminal step',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'edit_run_items',
    args: { p_run_step_id: NIL_UUID, p_items: [] }, expect: OWNER_ONLY,
    note: 'the owner’s per-run edit (Q11)',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'add_run_step',
    args: { p_run_id: NIL_UUID, p_after_run_step_id: NIL_UUID, p_step: {} }, expect: OWNER_ONLY,
    note: 'the owner’s per-run edit (Q11)',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'save_protocol_template',
    args: { p_template_id: NIL_UUID, p_expected_version: 1, p_name_en: 'x', p_name_ar: 'x', p_steps: [] },
    expect: OWNER_ONLY,
    note: 'How it works is the owner’s',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'protocol_template_detail',
    args: { p_template_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the template’s venue',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'protocols_overview',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'MGMT at the venue: the Protocols cards',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'protocol_runs_page',
    args: { p_venue_id: VENUE_A, p_filter: 'matrix-never' }, expect: STAFF_ANY,
    note: 'any active staff member at the venue (MGMT every run, others the runs they are in); an unknown filter fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'protocol_run_detail',
    args: { p_run_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; MGMT or involved, else PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'protocol_step_detail',
    args: { p_run_step_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; MGMT or involved, else PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_protocol_work',
    args: { p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue: their To do, waiting, decided and to decide',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'protocols_waiting_count',
    args: { p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue: the badge counts',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'staff_media_visible',
    args: { p_name: 'items/matrix/probe.webp' }, expect: ex<RpcExpectation>('execute', { anon: 'denied' }),
    note:
      'the staff_media_read policy\'s helper (re-issued here from 0159): answers false, never raises, so a ' +
      'menu-media name passes through; authenticated only, as the policy is. Who reads a claimed photo is ' +
      'tests/protocols-engine-flow.test.ts',
    drop: 17,
  },

  // ── staff-page DB, lane C (checklists, shopping_purchases, staff_production,
  //    marketing_staff; build-contracts §2.14-§2.17) ────────────────────────
  // Every new table refuses a client write. Their reads (MGMT rows, a driver's
  // own purchases, everyone else silence) are proven against rolled-back probe
  // rows in tests/{checklists,shopping-purchases,staff-production,
  // marketing-staff}.test.ts: this matrix has no probe row in them. Driver,
  // marketing and the bar and kitchen family are not among the eight
  // principals; their cases live in those files too.
  // checklists (§2.14)
  {
    kind: 'write',
    name: 'checklist_templates',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'checklist_template_items',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'checklist_runs',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'checklist_run_items',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_checklists_today',
    args: { p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue: their own role\'s lists for today (opens a list that has lines)',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'mark_checklist_item',
    args: { p_item_id: NIL_UUID, p_done: true, p_photo_path: null }, expect: STAFF_ANY,
    note: 'any active staff member; then the list\'s role or MGMT. An unknown line is CHECKLIST_NOT_FOUND. Since checklist_photos the four-argument signature (p_photo_path); a three-argument call still resolves (tests/checklist-photos.test.ts)',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'checklist_board',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'MGMT at the venue: every list and its day',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'save_checklist_template',
    args: { p_venue_id: VENUE_A, p_role: 'prep', p_slot: 'open', p_expected_version: 0, p_name_en: 'x',
            p_name_ar: 'x', p_items: [] },
    expect: OWNER_ONLY,
    note: 'the owner writes the lists; prep is refused INVALID_ROLE past the guard',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'checklist_day_state',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'MGMT at the venue: day close\'s checklist warning',
    drop: 17,
  },
  // shopping_purchases (§2.15)
  {
    kind: 'write',
    name: 'shopping_items',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'purchases',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'purchase_lines',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'shopping_list',
    args: { p_venue_id: VENUE_A, p_status: 'matrix-never' }, expect: MANAGER_UP,
    note: 'the bar and kitchen family, the driver and MGMT (not in this matrix: tests/shopping-purchases.test.ts); an unknown status fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'add_shopping_item',
    args: { p_venue_id: VENUE_A, p_ingredient_id: null, p_label: null, p_qty: 1, p_unit: 'pc' },
    expect: MANAGER_UP,
    note: 'the head barista, the head chef and MGMT; since shopping_head_approval (#66) the chef too, whose line waits as pending for the head chef\'s OK (tests/shopping-head-approval.test.ts); no ingredient and no label stops at SHOPPING_LABEL_REQUIRED',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'cancel_shopping_item',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the requester or MGMT. An unknown line is SHOPPING_ITEM_NOT_OPEN',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'record_purchase',
    args: { p_venue_id: VENUE_A, p_lines: [], p_total_iqd: 0, p_shop: null, p_receipt_path: null },
    expect: MANAGER_UP,
    note: 'the driver and MGMT; no lines stops at INVALID_ARGUMENT',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_purchases',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the driver (own purchases) and MGMT (every purchase)',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'purchases_to_receive',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'MGMT at the venue: Goods in\'s "Bought by the driver"',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'receive_purchase',
    args: { p_purchase_id: NIL_UUID, p_lines: [] }, expect: MANAGER_UP,
    note: 'MGMT at the purchase\'s venue; an unknown purchase is PURCHASE_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'acknowledge_purchase_line',
    args: { p_line_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the purchase\'s venue; an unknown line is PURCHASE_NOT_FOUND',
    drop: 17,
  },
  // staff_production (§2.16)
  {
    kind: 'rpc', schema: 'app', name: 'record_batch',
    args: { p_ingredient_id: NIL_UUID, p_qty: 1, p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the head chef, the chef and MGMT (the chefs: tests/staff-production.test.ts); an unknown ingredient is INGREDIENT_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'production_today',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the head chef, the chef and MGMT: what to make, no cost',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'production_log_today',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the head chef, the chef and MGMT: made today, no cost',
    drop: 17,
  },
  // marketing_staff (§2.17). Marketing is not among the eight principals, so
  // its own RPCs refuse all of them (tests/marketing-staff.test.ts runs it).
  {
    kind: 'write',
    name: 'marketing_notes',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: every write is a definer RPC',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'suggest_campaign',
    args: { p_venue_id: VENUE_A }, expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'marketing at the venue only; the owner saves campaigns through save_marketing_campaign',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_campaign_drafts',
    args: { p_venue_id: VENUE_A }, expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'marketing at the venue only: its own suggestions',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'marketing_suggestions',
    args: { p_venue_id: VENUE_A }, expect: OWNER_ONLY,
    note: 'the owner: which campaigns came from marketing',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'add_marketing_note',
    args: { p_venue_id: VENUE_A, p_subject_kind: 'item', p_subject_id: NIL_UUID, p_body: 'matrix' },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'marketing at the venue only: its own take',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'marketing_notes_for',
    args: { p_subject_kind: 'item', p_subject_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT and marketing at the subject\'s venue; an unknown subject is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_marketing_notes',
    args: { p_venue_id: VENUE_A }, expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'marketing at the venue only: its own notes',
    drop: 17,
  },

  // ── tournaments and hiring, lane F (event_court_blocks, hiring, §2.11,
  // §2.12). The driver and marketing are not among the eight principals:
  // their refusals are in tests/{event-court-blocks,hiring}.test.ts, and so
  // are hiring_candidates' reads (MGMT rows, everyone else silence), proven
  // against a probe run. ─────────────────────────────────────────────────────
  {
    kind: 'rpc', schema: 'app', name: 'block_courts_for_event',
    args: { p_run_id: NIL_UUID, p_blocks: [] },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied', court_desk: 'execute', manager: 'execute', owner: 'execute',
    }),
    note: 'the court desk and MGMT at the run\'s venue, while the courts step is open; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'tournament_context',
    args: { p_run_step_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the actor of the courts or marketing step, or MGMT (NOT_STEP_ACTOR). An unknown step is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'tournament_feasibility',
    args: { p_run_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue: bookings and guests in the plan\'s windows',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'hiring_candidates',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: save_hiring_candidate and delete_hiring_candidate only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'hiring_candidates',
    args: { p_run_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue: candidate names and phones; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'save_hiring_candidate',
    args: { p_run_id: NIL_UUID, p_candidate: {} }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue, while the interviews step is open; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'delete_hiring_candidate',
    args: { p_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue, while the interviews step is open; an unknown candidate is CANDIDATE_NOT_FOUND',
    drop: 17,
  },

  // ── product release, lane E (product_release, release_post_launch, §2.9,
  // §2.10). The heads, the barista, the chef, the driver and marketing are not
  // among the eight principals: their cases, the service-role functions'
  // refusals and the tables' MGMT-only reads (no probe row here) are in
  // tests/{product-release,release-post-launch,release-review,protocol-action}.test.ts.
  // upsert_menu_item and upsert_variant keep their rows above: the release
  // rules raise past the guard. ────────────────────────────────────────────
  {
    kind: 'write',
    name: 'release_ideas',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: submit_release_idea, withdraw_release_idea, decline_release_idea and the start hook only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'release_notes',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: add_release_note only',
    drop: 17,
  },
  {
    kind: 'write',
    name: 'release_reviews',
    op: 'insert',
    payload: { run_id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: release_review_save, service role only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'submit_release_idea',
    args: { p_record: {}, p_venue_id: VENUE_A }, expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'the barista and the chef (chef assistant) at the venue only (#65); every principal here is refused',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'withdraw_release_idea',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the author only. An unknown idea is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'decline_release_idea',
    args: { p_id: NIL_UUID, p_reason: 'matrix' }, expect: STAFF_ANY,
    note: 'any active staff member; then the head of the idea\'s team or MGMT. An unknown idea is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_ideas_to_review',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the head barista, the head chef and MGMT at the venue (the heads: tests/product-release.test.ts)',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_release_ideas',
    args: { p_venue_id: VENUE_A }, expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'the barista and the chef at the venue only: their own ideas',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_readiness',
    args: { p_run_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_cost',
    args: { p_run_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue: cost to make each size; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_test_context',
    args: { p_run_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the test step\'s assignee or MGMT, no cost. An unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_notes_for_me',
    args: { p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue: new items in their 30-day note window',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_notes_for_item',
    args: { p_menu_item_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member at the item\'s venue; an item no release launched is ITEM_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'add_release_note',
    args: { p_menu_item_id: NIL_UUID, p_body: 'matrix' }, expect: STAFF_ANY,
    note: 'any active staff member at the item\'s venue, in its 30-day window; an unknown item is ITEM_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'release_review',
    args: { p_run_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue only (#54): the starter and every other role are FORBIDDEN; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },

  // ── price and promotion changes, lane F (price_promo, §2.13). Marketing and
  // the driver are not among the eight principals: marketing's targets (every
  // kind but shop_launch) and both refusals are in tests/price-promo.test.ts,
  // as are the manager locks. upsert_variant, upsert_modifier,
  // upsert_promotion, set_promotion_enabled, generate_promo_code,
  // upsert_rate_rule and set_cafe_setting keep their rows above: each lock
  // raises past the guard. ─────────────────────────────────────────────────
  {
    kind: 'rpc', schema: 'app', name: 'price_promo_targets',
    args: { p_change: 'price', p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'manager, marketing and owner at the venue (shop_launch: MGMT only): list prices, rules and discounts, no cost and no sales',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'price_promo_numbers',
    args: { p_run_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'MGMT at the run\'s venue: cost, margin and 30-day sales of a change\'s targets; an unknown run is PROTOCOL_NOT_FOUND',
    drop: 17,
  },

  // ── role extras, lane J (build-contracts §2.24). staff_push_keys and
  // staff_media_folders grant no new RPC, so they have no rows here. Every
  // new table refuses a client write; their reads (MGMT rows, everyone else
  // silence) are proven against rolled-back probe rows in each lane file's
  // read_* cases: this matrix has no probe row in them. The heads, the
  // barista, the chef, the driver and marketing are not among the eight
  // principals; their cases live in those files too. ──────────────────────
  // teachings (§2.24.3)
  {
    kind: 'write',
    name: 'teachings',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: save_teaching and archive_teaching only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'save_teaching',
    args: { p_title: '', p_body: '', p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'a new teaching: the head barista and the head chef for their own team (tests/teachings.test.ts), MGMT for either; MGMT with no team stops at INVALID_ARGUMENT (hint team), so nothing is written',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'archive_teaching',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the author or MGMT at its venue. An unknown teaching is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'teachings_for_me',
    args: { p_venue_id: VENUE_A, p_team: 'matrix-never' }, expect: MANAGER_UP,
    note: 'the bar and kitchen teams (their own team) and MGMT at the venue; an unknown team fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  // suggestions (§2.24.4)
  {
    kind: 'write',
    name: 'staff_suggestions',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: add_suggestion and mark_suggestion_seen only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'add_suggestion',
    args: { p_body: '', p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue; an empty body stops at TEXT_REQUIRED, so nothing is written',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_suggestions',
    args: { p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue: their own suggestions',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'suggestions_page',
    args: { p_venue_id: VENUE_A, p_filter: 'matrix-never' }, expect: MANAGER_UP,
    note: 'MGMT at the venue: every suggestion with its author; an unknown filter fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'mark_suggestion_seen',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then MGMT at the suggestion\'s venue. An unknown suggestion is REF_NOT_FOUND',
    drop: 17,
  },
  // staff_stock_view (§2.24.5)
  {
    kind: 'rpc', schema: 'app', name: 'staff_stock_view',
    args: { p_venue_id: VENUE_A, p_kind: 'matrix-never' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied', court_desk: 'execute', manager: 'execute', owner: 'execute',
    }),
    note: 'the head barista and the head chef (not in this matrix), the court desk and MGMT at the venue: quantities only, no cost; an unknown kind fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  // recipe_view (§2.24.6)
  {
    kind: 'rpc', schema: 'app', name: 'recipe_view',
    args: { p_venue_id: VENUE_A, p_menu_item_id: NIL_UUID }, expect: MANAGER_UP,
    note: 'the bar and kitchen family (not in this matrix) and MGMT: ingredient names, no quantity; an unknown item is REF_NOT_FOUND',
    drop: 17,
  },
  // recipe_change_requests (§2.24.7)
  {
    kind: 'write',
    name: 'recipe_change_requests',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: request_recipe_change, withdraw_recipe_change and decide_recipe_change only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'request_recipe_change',
    args: { p_target: 'variant', p_target_id: NIL_UUID, p_ops: [], p_venue_id: VENUE_A },
    expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'the head barista and the head chef at the venue only (#71); every principal here is refused',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'withdraw_recipe_change',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the requester only. An unknown request is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'decide_recipe_change',
    args: { p_id: NIL_UUID, p_approve: false }, expect: STAFF_ANY,
    note: 'any active staff member; then the owner at the request\'s venue, never on their own request. An unknown request is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'recipe_changes_page',
    args: { p_venue_id: VENUE_A, p_filter: 'matrix-never' }, expect: MANAGER_UP,
    note: 'MGMT at the venue (the manager reads, the owner decides); an unknown filter fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_recipe_changes',
    args: { p_venue_id: VENUE_A }, expect: ex<RpcExpectation>('guarded', { anon: 'denied' }),
    note: 'the head barista and the head chef at the venue only: their own requests, no current quantity',
    drop: 17,
  },
  // shopping_head_approval (§2.24.9). add_shopping_item keeps its row above:
  // the chef it admits is not among the eight principals.
  {
    kind: 'rpc', schema: 'app', name: 'decide_shopping_item',
    args: { p_id: NIL_UUID, p_approve: false }, expect: STAFF_ANY,
    note: 'any active staff member; then the head chef or MGMT at the line\'s venue. An unknown line is SHOPPING_ITEM_NOT_OPEN',
    drop: 17,
  },
  // purchase_delivery_confirm (§2.24.10)
  {
    kind: 'rpc', schema: 'app', name: 'confirm_purchase_delivery',
    args: { p_purchase_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the purchase\'s buyer or MGMT at its venue. An unknown purchase is PURCHASE_NOT_FOUND',
    drop: 17,
  },
  // marketing_requests (§2.24.11). Marketing is not among the eight
  // principals: its answer, its page and its results are in
  // tests/marketing-requests.test.ts.
  {
    kind: 'write',
    name: 'marketing_requests',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: add_marketing_request, withdraw_marketing_request and answer_marketing_request only',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'add_marketing_request',
    args: { p_title: '', p_body: '', p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue except marketing; an empty title stops at TEXT_REQUIRED, so nothing is written',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'withdraw_marketing_request',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the requester only. An unknown request is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'answer_marketing_request',
    args: { p_id: NIL_UUID, p_outcome: 'done', p_answer: 'matrix' }, expect: STAFF_ANY,
    note: 'any active staff member; then marketing at the request\'s venue. An unknown request is REF_NOT_FOUND',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_marketing_requests',
    args: { p_venue_id: VENUE_A }, expect: STAFF_ANY,
    note: 'any active staff member at the venue except marketing: their own requests',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'marketing_requests_page',
    args: { p_venue_id: VENUE_A, p_filter: 'matrix-never' }, expect: MANAGER_UP,
    note: 'marketing and MGMT at the venue; an unknown filter fails INVALID_ARGUMENT past the guard',
    drop: 17,
  },
  {
    kind: 'rpc', schema: 'app', name: 'marketing_campaign_results',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'marketing and MGMT at the venue: the venue\'s campaigns with send and redemption counts, no money',
    drop: 17,
  },

  // ── wave 5, lane P: people records (wave5-addendum-2026-09-25 §2.5-§2.7,
  // §2.12). staff_push_keys_wave5 and staff_media_incidents grant no new RPC,
  // so they have no rows here. Every new table refuses a client write, and
  // its reads are proven against rolled-back rows in its own test file: this
  // matrix has no probe row in them. The heads, the bar and kitchen staff,
  // the driver, marketing and the two wave-5 roles are not among the eight
  // principals; their cases live in those files too. ─────────────────────
  // salary_deductions (§2.5): MGMT rows, everyone else silence
  // (salary-deductions.test.ts).
  {
    kind: 'write',
    name: 'salary_deductions',
    op: 'insert',
    payload: { id: NIL_UUID },
    expect: ex<WriteExpectation>('denied'),
    note: 'no client write grant: propose_deduction, withdraw_deduction, decide_deduction and cancel_deduction only',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'deduction_targets',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the head barista and the head chef (their own team, not in this matrix) and MGMT at the venue',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'propose_deduction',
    args: { p_staff_id: NIL_UUID, p_amount_iqd: 0, p_date: DAY_FROM, p_reason: 'matrix', p_venue_id: VENUE_A },
    expect: MANAGER_UP,
    note: 'the heads (not in this matrix) and MGMT at the venue; an amount of 0 stops at INVALID_AMOUNT before the target check, so nothing is written',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'withdraw_deduction',
    args: { p_id: NIL_UUID }, expect: STAFF_ANY,
    note: 'any active staff member; then the proposer only. An unknown deduction is REF_NOT_FOUND',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'decide_deduction',
    args: { p_id: NIL_UUID, p_approve: true }, expect: STAFF_ANY,
    note: 'any active staff member; then MGMT at the deduction\'s venue, never the proposer or the person. An unknown deduction is REF_NOT_FOUND',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'cancel_deduction',
    args: { p_id: NIL_UUID, p_reason: 'matrix' }, expect: STAFF_ANY,
    note: 'any active staff member; then the owner. An unknown deduction is REF_NOT_FOUND',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'deductions_page',
    args: { p_venue_id: VENUE_A, p_filter: 'matrix-never' }, expect: MANAGER_UP,
    note: 'MGMT at the venue; an unknown filter fails INVALID_ARGUMENT past the guard',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'deductions_month',
    args: { p_venue_id: VENUE_A, p_month: DAY_FROM }, expect: MANAGER_UP,
    note: 'MGMT at the venue: one pay month by person',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_deduction_proposals',
    args: { p_venue_id: VENUE_A }, expect: MANAGER_UP,
    note: 'the heads (not in this matrix) and MGMT at the venue: their own proposals',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'my_deductions',
    args: { p_venue_id: VENUE_A, p_month: DAY_FROM }, expect: STAFF_ANY,
    note: 'any active staff member at the venue: their own approved and cancelled deductions',
    drop: 18,
  },
  // ── wave 5, lane R: the waiter answers guests' calls (wave5-addendum-2026-09-25
  // §2.1.8, §8 Q3). assistant_barista_waiter_access adds the waiter to the
  // waiter_calls read and to both call RPCs, and gives the RPCs a venue
  // check. The waiter is not among the eight principals, and this matrix has
  // no second venue: his cases, and another venue's call, are in
  // assistant-barista-waiter.test.ts. These rows re-state drop 2's and drop
  // 7's for the eight. ──────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'waiter_calls',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'the cashier, the waiter (not in this matrix) and MGMT at the call\'s venue; a guest reads own-session calls only (the probe call is not theirs)',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'ack_waiter_call',
    args: { p_call_id: NIL_UUID }, expect: CASHIER_UP,
    note: 'the cashier, the waiter (not in this matrix) and MGMT; an unknown call, or one at another venue, is CALL_NOT_FOUND past the guard',
    drop: 18,
  },
  {
    kind: 'rpc', schema: 'app', name: 'resolve_waiter_call',
    args: { p_call_id: NIL_UUID }, expect: CASHIER_UP,
    note: 'the cashier, the waiter (not in this matrix) and MGMT; an unknown call, or one at another venue, is CALL_NOT_FOUND past the guard',
    drop: 18,
  },
];
