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
];
