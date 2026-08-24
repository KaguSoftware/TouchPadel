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
 *                raises FORBIDDEN / AUTH_REQUIRED
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
const FUTURE = new Date(Date.now() + 14 * 24 * 3600_000).toISOString();

export const matrix: MatrixRule[] = [
  // ── profiles ──────────────────────────────────────────────────────────────
  {
    kind: 'select',
    name: 'profiles',
    // every authenticated principal owns exactly one profile row except the
    // anonymous-session guest (signup trigger skips anonymous users);
    // court_desk/manager/owner additionally see all rows (walk-in lookup).
    expect: ex<SelectExpectation>('rows', { anon: 'denied', guest_anon_session: 'silence' }),
    drop: 1,
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
      court_desk: 'rows',
      manager: 'rows',
      owner: 'rows',
    }),
    note: 'guests see only their own rows; cashier/prep have no reservations read in the matrix',
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
    expect: ex<RpcExpectation>('execute', { anon: 'denied' }),
    note: 'any authenticated principal may hold; validation then rejects the nil court',
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
  {
    kind: 'select',
    name: 'tabs',
    expect: ex<SelectExpectation>('silence', {
      anon: 'denied',
      cashier: 'rows',
      prep: 'rows',
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
      prep: 'rows',
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
      prep: 'rows',
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
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
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
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'prep can SEE tabs/orders but can NOT settle',
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
      p_pin: '000000',
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
    args: { p_payment_id: NIL_UUID, p_amount_iqd: 1, p_pin: '000000', p_reason_code: '' },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'cashiers can NOT refund (manager/owner only); reason check precedes PIN',
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
  {
    kind: 'rpc',
    schema: 'app',
    name: 'log_replay',
    args: {
      p_device_id: 'PROBE-RLS',
      p_idempotency_key: 'PROBE:never-inserted',
      p_entity: 'order',
      p_result: 'not-a-result',
    },
    expect: ex<RpcExpectation>('guarded', {
      anon: 'denied',
      cashier: 'execute',
      prep: 'execute',
      court_desk: 'execute',
      manager: 'execute',
      owner: 'execute',
    }),
    note: 'invalid result fails INVALID_RESULT past the guard — nothing is inserted',
    drop: 3,
  },
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
];
