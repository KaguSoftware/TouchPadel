/**
 * The owner assistant's tool catalog — the ONE list of what the model may ask
 * the database for (docs/design/assistant/owner-assistant-plan-2026-09-20.md §3.1).
 *
 * Shared by three consumers that must never disagree:
 *   * app.assistant_run_tool (migration 0109) has one `case` branch per `rpc`
 *     name here; a test asserts the two sets are equal.
 *   * the assistant-chat edge function turns each spec into a strict JSON
 *     schema tool definition (packages/db/supabase/functions/_shared/assistant/
 *     tools.ts is a byte-identical copy, pinned by a parity test — Deno cannot
 *     import a workspace package).
 *   * the operator app reads scopes, presets and routes for the checkboxes and
 *     the sources panel.
 *
 * Pure: no imports, no runtime dependencies, deterministic iteration order
 * (the order below IS the order sent to the model, so the cached prefix never
 * moves).
 */

// ---------------------------------------------------------------------------
// Scopes — the context checkboxes (§5.5). A scope is at once the tools the
// model may call, the chunk kinds `search` may return, and a context pack.
// ---------------------------------------------------------------------------
export const ASSISTANT_SCOPES = [
  'cafe',
  'courts',
  'money',
  'stock',
  'staff',
  'customers',
  'audit',
  'marketing',
  'engagement',
  'settings',
  'system',
  'howto',
  'docs',
  'tables',
] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];

export const ASSISTANT_PRESETS: Readonly<Record<'everything' | 'moneyAndFloor' | 'justHelp', readonly AssistantScope[]>> = {
  everything: ASSISTANT_SCOPES,
  moneyAndFloor: ['money', 'cafe', 'courts', 'system', 'howto'],
  justHelp: ['howto'],
};

/** DECIDE 14 (recommended): the cheapest chat, Everything one tap away. */
export const DEFAULT_SCOPES: readonly AssistantScope[] = ['howto'];

/** The chunk kinds `search` may return per scope (§5.5 table). */
export const SCOPE_CHUNK_KINDS: Readonly<Record<AssistantScope, readonly string[]>> = {
  cafe: ['menu_item', 'finding'],
  courts: ['finding'],
  money: [],
  stock: ['alert'],
  staff: ['request'],
  customers: ['note'],
  audit: [],
  marketing: ['promotion'],
  engagement: [],
  settings: ['setting', 'enum'],
  system: ['system'],
  howto: ['page', 'nav', 'label', 'rpc', 'action', 'table', 'column', 'rule'],
  docs: ['doc'],
  tables: [],
};

/**
 * The scope a page pre-checks when the drawer opens from it (longest prefix
 * wins). `howto` is always added by the caller.
 */
export const ROUTE_SCOPES: readonly (readonly [prefix: string, scope: AssistantScope])[] = [
  ['/analytics/cafe', 'cafe'],
  ['/analytics/courts', 'courts'],
  ['/reports/cafe', 'cafe'],
  ['/reports/courts', 'courts'],
  ['/reports/revenue', 'money'],
  ['/reports/stock', 'stock'],
  ['/reports/staff', 'staff'],
  ['/panel', 'money'],
  ['/financial', 'money'],
  ['/till', 'cafe'],
  ['/desk/customers', 'customers'],
  ['/desk', 'courts'],
  ['/observation/courts', 'courts'],
  ['/observation/tills', 'cafe'],
  ['/observation/requests', 'staff'],
  ['/observation', 'system'],
  ['/ops', 'system'],
  ['/stock', 'stock'],
  ['/admin/audit', 'audit'],
  ['/admin/staff', 'staff'],
  ['/admin/promotions', 'marketing'],
  ['/marketing', 'marketing'],
  ['/admin', 'settings'],
  ['/setup', 'settings'],
];

export function scopeForRoute(path: string): AssistantScope | null {
  const bare = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  let best: (readonly [string, AssistantScope]) | null = null;
  for (const entry of ROUTE_SCOPES) {
    const [prefix] = entry;
    if (bare === prefix || bare.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best[0].length) best = entry;
    }
  }
  return best ? best[1] : null;
}

// ---------------------------------------------------------------------------
// Argument and tool specs
// ---------------------------------------------------------------------------
export type ToolArgType =
  | 'date' // YYYY-MM-DD
  | 'timestamp' // ISO 8601
  | 'string'
  | 'integer'
  | 'boolean'
  | 'id' // a uuid, or a short handle (r12, c3) from an earlier result
  | 'enum'
  | 'object' // free jsonb filters, passed through to the RPC
  | 'string[]';

export interface ToolArg {
  type: ToolArgType;
  description: string;
  required?: boolean;
  /** For `enum`. */
  values?: readonly string[];
  /** For `integer`: inclusive bounds. */
  min?: number;
  max?: number;
  /** The RPC parameter this maps to (default `p_${name}`). */
  param?: string;
}

export type ToolKind =
  /** Totals, trends, rankings — the RPCs the pages themselves render. */
  | 'aggregate'
  /** Rows. Paged, capped at 500, countable for the estimator. */
  | 'list'
  /** One record by id. */
  | 'lookup'
  /** The text layer: map + index. Runs in the edge function, not the dispatcher. */
  | 'knowledge'
  /** Meter and jobs. */
  | 'meta';

export interface ToolResultShape {
  /**
   * Where the rows live in the RPC's jsonb: a top-level key (`rows`,
   * `figures`, `items`), `$` for "the result is itself the array", or null for
   * "an object of aggregates; lay it out as key/value lines".
   */
  rows_path: string | null;
  /** Keys whose values are ids and get handles (§11.1). */
  id_keys?: readonly string[];
}

export interface ToolSpec {
  name: string;
  scope: AssistantScope;
  kind: ToolKind;
  /** Written for the model: what it answers, when to prefer it. */
  description: string;
  /** Where the same numbers appear in the operator app, or null. */
  route: string | null;
  /**
   * The `app.*` function the dispatcher calls, or null when the tool is served
   * by the edge function itself (knowledge, meta, and `posthog`, which the
   * chat function forwards to the analytics-posthog function as the owner).
   */
  rpc: string | null;
  args: Readonly<Record<string, ToolArg>>;
  result: ToolResultShape;
  /** Stays loaded in every request; everything else is `defer_loading` (§11.3). */
  core: boolean;
  /** The estimator (§6.2): rows per job chunk. Only list tools. */
  chunk_rows?: number;
  /**
   * Measured shaped tokens per row (scripts/measure-assistant-tokens.mjs). Null
   * until measured; the estimator then uses TOKENS_PER_ROW_FALLBACK and says so.
   */
  tokens_per_row: number | null;
}

export const TOKENS_PER_ROW_FALLBACK = 25;
export const LIST_ROW_CAP = 500;
export const MAX_TOOL_ROUNDS = 8;

const RANGE: Readonly<Record<string, ToolArg>> = {
  from: { type: 'date', description: 'First business day of the range, YYYY-MM-DD.', required: true },
  to: { type: 'date', description: 'Last business day of the range, YYYY-MM-DD (inclusive).', required: true },
};
const PAGE: Readonly<Record<string, ToolArg>> = {
  limit: { type: 'integer', description: `Rows to return, 1–${LIST_ROW_CAP}. Default 50.`, min: 1, max: LIST_ROW_CAP },
  offset: { type: 'integer', description: 'Rows to skip, for paging.', min: 0 },
};
const BASIS: ToolArg = {
  type: 'enum',
  description: "Sales basis: 'settled' (paid tabs, the default the pages use) or 'served'.",
  values: ['settled', 'served'],
};
const COURT: ToolArg = { type: 'id', description: 'Optional court id or handle; omit for every court.', param: 'p_court_id' };
const FILTERS: ToolArg = { type: 'object', description: 'Optional report filters exactly as the report page sends them (e.g. {"paymentMethod":"cash"}).' };

export const ASSISTANT_TOOLS: readonly ToolSpec[] = [
  // ── Money and headline ───────────────────────────────────────────────────
  {
    name: 'panel_headline',
    scope: 'money',
    kind: 'aggregate',
    description:
      'The management panel headline figures for a date range: revenue, padel revenue, cafe revenue and net, cash, card, bookings, orders, average order value, discounts, refunds, waste, no-shows; optionally against a comparison period. Prefer this for any "how much did we make" question.',
    route: '/panel',
    rpc: 'panel_headline',
    args: {
      ...RANGE,
      compare: { type: 'enum', description: 'Comparison basis.', values: ['none', 'previousPeriod', 'sameLastYear'] },
    },
    result: { rows_path: 'figures' },
    core: true,
    tokens_per_row: null,
  },
  {
    name: 'report_revenue',
    scope: 'money',
    kind: 'aggregate',
    description:
      'The revenue report: padel, cafe (gross and net), tax, discounts, orders, cash, card and refunds per day, week or month over a range. Use for trends over time.',
    route: '/reports/revenue',
    rpc: 'report_revenue',
    args: {
      ...RANGE,
      group: { type: 'enum', description: 'Bucket size.', values: ['day', 'week', 'month'] },
      filters: FILTERS,
    },
    result: { rows_path: 'rows' },
    core: true,
    tokens_per_row: null,
  },
  {
    name: 'report_compare',
    scope: 'money',
    kind: 'aggregate',
    description: 'One report (revenue, courts, cafe, stock or staff) for a range set against a comparison period, figure by figure with the change. Use for "compared with last month" questions.',
    route: '/reports/revenue',
    rpc: 'report_compare',
    args: {
      report: { type: 'enum', description: 'Which report.', values: ['revenue', 'courts', 'cafe', 'stock', 'staff'], required: true },
      ...RANGE,
      compare: { type: 'enum', description: 'Comparison basis.', values: ['previousPeriod', 'sameLastYear'], required: true },
      group: { type: 'enum', description: 'Bucket size where the report has one.', values: ['day', 'week', 'month'] },
      filters: FILTERS,
    },
    result: { rows_path: null },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'report_drill',
    scope: 'money',
    kind: 'list',
    description: 'The transactions behind one panel figure (revenue, cash, refunds, discounts, waste, noShows, …) for a range; the same list the panel opens when a figure is clicked.',
    route: '/panel',
    rpc: 'report_drill',
    args: {
      figure: { type: 'string', description: 'The figure key as panel_headline names it (e.g. "refunds").', required: true },
      key: { type: 'string', description: 'Optional sub-key (a day, a court, a method) as the panel uses it.' },
      ...RANGE,
    },
    result: { rows_path: 'transactions', id_keys: ['id', 'staffId', 'reference'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },
  {
    name: 'payments_list',
    scope: 'money',
    kind: 'list',
    description: 'Individual payments (cash or card) with amount, time, tab and who took it, paged. Only when the rows themselves are wanted; totals come from report_revenue.',
    route: '/reports/revenue',
    rpc: 'assistant_payments_list',
    args: {
      ...RANGE,
      method: { type: 'enum', description: 'Only one payment method.', values: ['cash', 'card'] },
      ...PAGE,
    },
    result: { rows_path: 'rows', id_keys: ['id', 'tab_id', 'day_session_id', 'recorded_by'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },

  // ── Cafe ─────────────────────────────────────────────────────────────────
  {
    name: 'report_cafe',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'The cafe report for a range: sales, items sold, tabs, refunds, voids and waste, with per-day rows.',
    route: '/reports/cafe',
    rpc: 'report_cafe',
    args: { ...RANGE, filters: FILTERS },
    result: { rows_path: null },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_daily_sales',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'Cafe sales per business day over a range (revenue, orders, tabs, average order value).',
    route: '/analytics/cafe',
    rpc: 'analytics_daily_sales',
    args: RANGE,
    result: { rows_path: '$' },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_sold_items',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'Every menu item sold in a range with units and revenue.',
    route: '/analytics/cafe',
    rpc: 'analytics_sold_items',
    args: { ...RANGE, basis: BASIS },
    result: { rows_path: '$', id_keys: ['item_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_best_sellers',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'The top-selling menu items in a range by units and revenue.',
    route: '/analytics/cafe',
    rpc: 'analytics_best_sellers',
    args: { ...RANGE, limit: { type: 'integer', description: 'How many items (default 10).', min: 1, max: 100 }, basis: BASIS },
    result: { rows_path: '$', id_keys: ['item_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_item_margins',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'Margin per menu item in a range: price, cost, margin and units. Answers "what earns us the most".',
    route: '/analytics/cafe',
    rpc: 'analytics_item_margins',
    args: { ...RANGE, basis: BASIS },
    result: { rows_path: null, id_keys: ['item_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_price_bands',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'Cafe sales grouped by price band in a range.',
    route: '/analytics/cafe',
    rpc: 'analytics_price_bands',
    args: { ...RANGE, basis: BASIS },
    result: { rows_path: '$' },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_hourly',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'Cafe orders and revenue by hour of day over a range; the busiest hours.',
    route: '/analytics/cafe',
    rpc: 'analytics_hourly',
    args: RANGE,
    result: { rows_path: '$' },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_bought_together',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'Pairs of menu items bought together in a range, with support.',
    route: '/analytics/cafe',
    rpc: 'analytics_bought_together',
    args: {
      ...RANGE,
      min_support: { type: 'integer', description: 'Minimum times a pair must occur (default 3).', min: 1, max: 1000 },
      limit: { type: 'integer', description: 'How many pairs (default 20).', min: 1, max: 100 },
      scope: { type: 'enum', description: 'Which sales.', values: ['all', 'cafe', 'courts'] },
    },
    result: { rows_path: '$' },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_menu_snapshot',
    scope: 'cafe',
    kind: 'aggregate',
    description: 'The current menu as the guests see it: categories, items, prices, availability and costs.',
    route: '/admin/menu',
    rpc: 'analytics_menu_snapshot',
    args: {},
    result: { rows_path: null, id_keys: ['id', 'category_id', 'item_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'tabs_list',
    scope: 'cafe',
    kind: 'list',
    description: 'Individual tabs (bills) opened in a range with status, table, totals and who opened them, paged. For rows; totals come from report_cafe.',
    route: '/observation/tills',
    rpc: 'assistant_tabs_list',
    args: {
      ...RANGE,
      status: { type: 'enum', description: 'Only one status.', values: ['open', 'awaiting_payment', 'settled', 'void'] },
      ...PAGE,
    },
    result: { rows_path: 'rows', id_keys: ['id', 'table_id', 'reservation_id', 'opened_by_staff_id', 'day_session_id'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },

  // ── Courts and bookings ───────────────────────────────────────────────────
  {
    name: 'report_courts',
    scope: 'courts',
    kind: 'aggregate',
    description: 'The courts report for a range: bookings, hours booked, revenue per court, occupancy, cancellations, no-shows.',
    route: '/reports/courts',
    rpc: 'report_courts',
    args: { ...RANGE, filters: FILTERS },
    result: { rows_path: null, id_keys: ['courtId', 'court_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_courts_summary',
    scope: 'courts',
    kind: 'aggregate',
    description: 'Courts analytics KPIs for a range: occupancy, revenue, bookings, average price, per court.',
    route: '/analytics/courts',
    rpc: 'analytics_courts_summary',
    args: { ...RANGE, court: COURT },
    result: { rows_path: null, id_keys: ['court_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_courts_demand',
    scope: 'courts',
    kind: 'aggregate',
    description: 'Court demand by weekday and hour over a range (the heat calendar).',
    route: '/analytics/courts',
    rpc: 'analytics_courts_demand',
    args: { ...RANGE, court: COURT },
    result: { rows_path: null, id_keys: ['court_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_courts_endings',
    scope: 'courts',
    kind: 'aggregate',
    description: 'How bookings ended in a range: completed, cancelled, no-show, expired, and how early or late.',
    route: '/analytics/courts',
    rpc: 'analytics_courts_endings',
    args: { ...RANGE, court: COURT },
    result: { rows_path: null, id_keys: ['court_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_courts_guests',
    scope: 'courts',
    kind: 'aggregate',
    description: 'Who books: new versus returning guests, players per booking, sources (mobile, desk) over a range.',
    route: '/analytics/courts',
    rpc: 'analytics_courts_guests',
    args: { ...RANGE, court: COURT },
    result: { rows_path: null, id_keys: ['court_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'analytics_courts_cafe',
    scope: 'courts',
    kind: 'aggregate',
    description: 'Cafe spend attached to court bookings in a range: attach rate and spend per booking.',
    route: '/analytics/courts',
    rpc: 'analytics_courts_cafe',
    args: { ...RANGE, court: COURT },
    result: { rows_path: null, id_keys: ['court_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'bookings_list',
    scope: 'courts',
    kind: 'list',
    description: 'Individual bookings in a range with court, time, status, guest, price and source, paged. For rows; totals come from report_courts.',
    route: '/observation/courts',
    rpc: 'assistant_bookings_list',
    args: {
      ...RANGE,
      court: COURT,
      status: {
        type: 'enum',
        description: 'Only one status.',
        values: ['pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'expired'],
      },
      customer: { type: 'id', description: 'Only this customer (id or handle).', param: 'p_customer_id' },
      ...PAGE,
    },
    result: { rows_path: 'rows', id_keys: ['id', 'court_id', 'guest_id', 'series_id', 'created_by_staff_id', 'rate_rule_id'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },
  {
    name: 'booking_bill',
    scope: 'courts',
    kind: 'lookup',
    description: 'One booking with its bill: court fee, attached cafe tab, payments, what is owed.',
    route: '/desk',
    rpc: 'booking_bill',
    args: { id: { type: 'id', description: 'Booking id or handle.', required: true, param: 'p_reservation_id' } },
    result: { rows_path: null, id_keys: ['id', 'reservation_id', 'tab_id', 'court_id', 'guest_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'series_detail',
    scope: 'courts',
    kind: 'lookup',
    description: 'One recurring booking series: pattern, court, weekdays, its bookings and their statuses.',
    route: '/desk/series/new',
    rpc: 'series_detail',
    args: { id: { type: 'id', description: 'Series id or handle.', required: true, param: 'p_series_id' } },
    result: { rows_path: null, id_keys: ['id', 'series_id', 'court_id', 'reservation_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'courts_and_rates',
    scope: 'courts',
    kind: 'aggregate',
    description: 'Every court (name, indoor, durations, active dates) and every rate rule with its prices per duration.',
    route: '/admin/rates',
    rpc: 'assistant_courts_and_rates',
    args: {},
    result: { rows_path: null, id_keys: ['id', 'court_id', 'rule_id'] },
    core: false,
    tokens_per_row: null,
  },

  // ── Stock ────────────────────────────────────────────────────────────────
  {
    name: 'report_stock',
    scope: 'stock',
    kind: 'aggregate',
    description: 'The stock report for a range: goods in, consumption, waste, write-offs and stock value.',
    route: '/reports/stock',
    rpc: 'report_stock',
    args: { ...RANGE, filters: FILTERS },
    result: { rows_path: null, id_keys: ['ingredient_id', 'ingredientId'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'stock_view',
    scope: 'stock',
    kind: 'list',
    description:
      'One of the live stock views: on_hand (quantity per ingredient now), variance (counted vs expected), item_margin (cost and margin per menu item), expiring_soon, expired.',
    route: '/stock',
    rpc: 'assistant_stock_view',
    args: {
      view: { type: 'enum', description: 'Which view.', values: ['on_hand', 'variance', 'item_margin', 'expiring_soon', 'expired'], required: true },
      ...PAGE,
    },
    result: { rows_path: 'rows', id_keys: ['ingredient_id', 'item_id', 'batch_id', 'count_id'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },

  // ── Staff and operations ─────────────────────────────────────────────────
  {
    name: 'ops_overview',
    scope: 'system',
    kind: 'aggregate',
    description: 'What is happening on the floor right now: open tabs, courts in play, kitchen queue, waiter calls, alerts, day session status.',
    route: '/ops',
    rpc: 'ops_overview',
    args: {},
    result: { rows_path: null },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'list_staff',
    scope: 'staff',
    kind: 'list',
    description: 'Every staff account with role, active flag and whether a PIN is set. Never the PIN itself.',
    route: '/admin/staff',
    rpc: 'list_staff',
    args: {},
    result: { rows_path: '$', id_keys: ['id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'staff_requests_page',
    scope: 'staff',
    kind: 'list',
    description: 'Staff requests (leave, shift swap, advance, correction) with status, dates, amounts and decisions, paged.',
    route: '/observation/requests',
    rpc: 'staff_requests_page',
    args: {
      status: { type: 'enum', description: 'Only one status; omit for all.', values: ['pending', 'approved', 'rejected', 'withdrawn'] },
      ...PAGE,
    },
    result: { rows_path: 'requests', id_keys: ['id', 'staffId', 'staff_id', 'decidedBy', 'decided_by'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },
  {
    name: 'report_staff_activity',
    scope: 'staff',
    kind: 'aggregate',
    description: 'Per-staff activity in a range: tabs opened, payments taken, bookings made, discounts, refunds, voids.',
    route: '/reports/staff',
    rpc: 'report_staff_activity',
    args: { ...RANGE, staff: { type: 'id', description: 'Only this staff member (id or handle).', param: 'p_staff_id' } },
    result: { rows_path: 'rows', id_keys: ['staffId', 'staff_id', 'id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'break_history',
    scope: 'staff',
    kind: 'list',
    description: 'Staff breaks in a range: who, station, start, end, length, who covered.',
    route: '/admin/staff',
    rpc: 'assistant_break_history',
    args: { ...RANGE, staff: { type: 'id', description: 'Only this staff member (id or handle).', param: 'p_staff_id' }, ...PAGE },
    result: { rows_path: 'rows', id_keys: ['id', 'staff_id', 'covered_by'] },
    core: false,
    chunk_rows: 250,
    tokens_per_row: null,
  },

  // ── Audit ────────────────────────────────────────────────────────────────
  {
    name: 'audit_page',
    scope: 'audit',
    kind: 'list',
    description:
      'The audit log: who did what, when, to which record, with the reason code and the changed fields. Filter by time, actor, action prefix (e.g. "tab.", "reservation.") and free text. Answers "who changed X".',
    route: '/admin/audit',
    rpc: 'assistant_audit_page',
    args: {
      from: { type: 'timestamp', description: 'Earliest event time, ISO 8601.' },
      to: { type: 'timestamp', description: 'Latest event time, ISO 8601 (exclusive).' },
      actor: { type: 'id', description: 'Only this staff member (id or handle).', param: 'p_actor_id' },
      action_prefix: { type: 'string', description: 'Only actions starting with this (e.g. "tab.discount").' },
      text: { type: 'string', description: 'Free text matched against action, entity, reason and the changed keys.' },
      ...PAGE,
    },
    result: { rows_path: 'rows', id_keys: ['id', 'actorId', 'authorizerId', 'entityId'] },
    core: true,
    chunk_rows: 200,
    tokens_per_row: null,
  },

  // ── Customers ────────────────────────────────────────────────────────────
  {
    name: 'customer_search',
    scope: 'customers',
    kind: 'list',
    description: 'Find customers by name, phone or email (at least 2 characters). Phones and emails come back pseudonymised.',
    route: '/desk/customers',
    rpc: 'customer_search',
    args: {
      query: { type: 'string', description: 'Name, phone digits or email fragment.', required: true },
      limit: { type: 'integer', description: 'How many (default 12, max 50).', min: 1, max: 50 },
    },
    result: { rows_path: '$', id_keys: ['id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'customer_record',
    scope: 'customers',
    kind: 'lookup',
    description: 'One customer: profile, flags, notes, bookings and tabs history, totals.',
    route: '/desk/customers',
    rpc: 'customer_record',
    args: { id: { type: 'id', description: 'Customer id or handle.', required: true, param: 'p_customer_id' } },
    result: { rows_path: null, id_keys: ['id', 'customer_id', 'reservation_id', 'tab_id', 'court_id', 'author_id'] },
    core: false,
    tokens_per_row: null,
  },

  // ── Promotions and marketing ─────────────────────────────────────────────
  {
    name: 'analytics_promo',
    scope: 'marketing',
    kind: 'aggregate',
    description: 'Promotion performance in a range: redemptions, discount given, revenue on promoted tabs, per promotion.',
    route: '/admin/promotions',
    rpc: 'analytics_promo',
    args: RANGE,
    result: { rows_path: null, id_keys: ['promotion_id', 'id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'marketing_overview',
    scope: 'marketing',
    kind: 'aggregate',
    description: 'Marketing audiences and campaigns: reach, status, sends, redemptions.',
    route: '/marketing',
    rpc: 'marketing_overview',
    args: {},
    result: { rows_path: null, id_keys: ['id', 'audience_id', 'campaign_id'] },
    core: false,
    tokens_per_row: null,
  },
  {
    name: 'marketing_campaign_performance',
    scope: 'marketing',
    kind: 'lookup',
    description: 'One campaign: sends, opens where known, redemptions and revenue attributed.',
    route: '/marketing',
    rpc: 'marketing_campaign_performance',
    args: { id: { type: 'id', description: 'Campaign id or handle.', required: true, param: 'p_campaign' } },
    result: { rows_path: null, id_keys: ['id', 'campaign_id'] },
    core: false,
    tokens_per_row: null,
  },

  // ── Guest engagement (PostHog, through the analytics-posthog function) ──
  {
    name: 'posthog',
    scope: 'engagement',
    kind: 'aggregate',
    description:
      "Guest engagement from the guest site (PostHog): one of the analytics page's templates — daily_engagement, funnel, peak_hours, abandoned_by_dwell, top_viewed_items, top_carted_items, basket_to_call, locale_split, table_activity, week_heatmap, promo_engagement, item_views_with_price, session_stats, category_popularity, locale_preferences — for a range. Live minus a 30 s proxy cache; says so when PostHog is not configured.",
    route: '/analytics/cafe',
    rpc: null,
    args: {
      template: {
        type: 'enum',
        description: 'Which analytics template to run.',
        values: [
          'daily_engagement',
          'funnel',
          'peak_hours',
          'abandoned_by_dwell',
          'top_viewed_items',
          'top_carted_items',
          'basket_to_call',
          'locale_split',
          'table_activity',
          'week_heatmap',
          'promo_engagement',
          'item_views_with_price',
          'session_stats',
          'category_popularity',
          'locale_preferences',
        ],
        required: true,
      },
      ...RANGE,
      limit: { type: 'integer', description: 'Rows for the "top N" templates, 1–100.', min: 1, max: 100 },
    },
    result: { rows_path: 'rows' },
    core: false,
    tokens_per_row: null,
  },

  // ── Settings and venue ───────────────────────────────────────────────────
  {
    name: 'settings_read',
    scope: 'settings',
    kind: 'aggregate',
    description:
      'Every venue setting whole: name, timezone, opening hours, closed dates, hold TTL, booking horizon, cancellation window, cash rounding, tax, the LLM spend caps and prices, plus every cafe setting and tax group.',
    route: '/admin/settings',
    rpc: 'assistant_settings_read',
    args: {},
    result: { rows_path: null },
    core: false,
    tokens_per_row: null,
  },

  // ── System state ─────────────────────────────────────────────────────────
  {
    name: 'system_status',
    scope: 'system',
    kind: 'aggregate',
    description: 'Venue mode (open, closed, degraded), device heartbeats, outbox depths (push, Telegram), index queue depth, last cron runs, open day session.',
    route: '/ops',
    rpc: 'assistant_system_status',
    args: {},
    result: { rows_path: null },
    core: false,
    tokens_per_row: null,
  },

  // ── Any table or view ────────────────────────────────────────────────────
  {
    name: 'table_read',
    scope: 'tables',
    kind: 'list',
    description:
      'Read rows from any business table or view by name, choosing columns, simple equality/range filters, an order and a page. Only registered tables and columns are readable; secrets and tokens never are. Use `describe` first to learn the columns. Prefer a dedicated tool when one exists.',
    route: null,
    rpc: 'assistant_table_read',
    args: {
      table: { type: 'string', description: 'Table or view name in the public schema (e.g. "reservations", "v_expiring_soon").', required: true },
      columns: { type: 'string[]', description: 'Columns to return; omit for the registered default set.' },
      filters: {
        type: 'object',
        description:
          'Equality and range filters: {"status":"settled","created_at":{"gte":"2026-09-01","lt":"2026-09-08"}}. Operators: eq, neq, gt, gte, lt, lte, in, is_null.',
      },
      order: { type: 'string', description: 'Column to order by, optionally suffixed " desc".' },
      ...PAGE,
    },
    result: { rows_path: 'rows' },
    core: true,
    chunk_rows: 250,
    tokens_per_row: null,
  },

  // ── Knowledge (edge-side) ────────────────────────────────────────────────
  {
    name: 'search',
    scope: 'howto',
    kind: 'knowledge',
    description:
      'Search the venue\'s system map and free text: pages and where they are, buttons and labels, what each operation does and who may do it, tables and columns, settings, enum meanings, rules, documents, and (when their scopes are on) menu items, promotions, alerts, staff requests, customer notes and stored findings. Returns short passages with the route they live on.',
    route: null,
    rpc: null,
    args: {
      query: { type: 'string', description: 'What to look for, in English or Arabic.', required: true },
      kinds: { type: 'string[]', description: 'Restrict to chunk kinds (page, nav, label, rpc, action, table, column, setting, enum, rule, doc, system, menu_item, promotion, alert, request, note, finding).' },
    },
    result: { rows_path: '$' },
    core: true,
    tokens_per_row: null,
  },
  {
    name: 'describe',
    scope: 'howto',
    kind: 'knowledge',
    description: 'The full map entry for one thing: a table (its columns and their meanings), an RPC or action, a page, a setting or an enum.',
    route: null,
    rpc: null,
    args: {
      kind: { type: 'enum', description: 'What kind of thing.', values: ['table', 'rpc', 'action', 'page', 'setting', 'enum', 'system'], required: true },
      ref: { type: 'string', description: 'Its name: a table name, a function name, a route, a setting column, an enum type.', required: true },
    },
    result: { rows_path: null },
    core: true,
    tokens_per_row: null,
  },
  {
    name: 'page_lookup',
    scope: 'howto',
    kind: 'knowledge',
    description: 'Which page a route is, who may open it, its rail label in English and Arabic, and what it does.',
    route: null,
    rpc: null,
    args: { route: { type: 'string', description: 'A route such as "/admin/day-close".', required: true } },
    result: { rows_path: null },
    core: false,
    tokens_per_row: null,
  },

  // ── Meter and jobs ───────────────────────────────────────────────────────
  {
    name: 'usage',
    scope: 'howto',
    kind: 'meta',
    description: 'What the assistant itself has cost: tokens by kind and cost per day over a range, month to date and the cap.',
    route: '/assistant/usage',
    rpc: 'assistant_usage',
    args: RANGE,
    result: { rows_path: 'days' },
    core: true,
    tokens_per_row: null,
  },
  {
    name: 'propose_job',
    scope: 'howto',
    kind: 'meta',
    description:
      'Propose a job instead of reading many rows in the chat. Call this when a request needs more than one page (500 rows) of any list tool, or says "all", "every" or names a large number. Nothing runs; the owner sees an estimate with the exact row count and the price and decides.',
    route: null,
    rpc: null,
    args: {
      question: { type: 'string', description: 'The question the job answers, in the owner\'s words.', required: true },
      steps: {
        type: 'object',
        description:
          'The list tool calls the job would make, as {"calls":[{"tool":"payments_list","args":{...}}]}, without limit/offset — the job pages them itself. Also "extract": one sentence on what each chunk should extract, and "reduce": how the chunks combine.',
        required: true,
      },
      aggregate_alternative: {
        type: 'object',
        description: 'Optional: aggregate tool calls that could answer most of the question now, as {"calls":[...]} — shown to the owner as the recommended cheaper way.',
      },
    },
    result: { rows_path: null },
    core: true,
    tokens_per_row: null,
  },
];

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------
const BY_NAME: ReadonlyMap<string, ToolSpec> = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function toolByName(name: string): ToolSpec | undefined {
  return BY_NAME.get(name);
}

export const CORE_TOOL_NAMES: readonly string[] = ASSISTANT_TOOLS.filter((t) => t.core).map((t) => t.name);

/** The `app.*` names the dispatcher must have a branch for (rpc-backed tools only). */
export const DISPATCHED_RPCS: readonly string[] = ASSISTANT_TOOLS.filter((t) => t.rpc).map((t) => t.rpc as string);

/** Tools countable by app.assistant_count (the estimator's inputs). */
export const COUNTABLE_TOOL_NAMES: readonly string[] = ASSISTANT_TOOLS.filter((t) => t.kind === 'list' && t.rpc).map((t) => t.name);

export function toolsForScopes(scopes: readonly AssistantScope[]): readonly ToolSpec[] {
  const set = new Set<string>(scopes);
  // `howto` carries the meta tools; the knowledge tools are always callable so
  // the model can say where something is even in a money-only chat.
  return ASSISTANT_TOOLS.filter((t) => set.has(t.scope) || t.kind === 'knowledge' || t.kind === 'meta');
}

export function isToolAllowed(name: string, scopes: readonly AssistantScope[]): boolean {
  const spec = BY_NAME.get(name);
  if (!spec) return false;
  if (spec.kind === 'knowledge' || spec.kind === 'meta') return true;
  return (scopes as readonly string[]).includes(spec.scope);
}

// ---------------------------------------------------------------------------
// JSON schema — strict, additionalProperties:false, the shape the API wants.
// ---------------------------------------------------------------------------
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export const HANDLE_RE = /^[a-z]{1,2}[0-9]{1,6}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function argSchema(arg: ToolArg): Record<string, unknown> {
  switch (arg.type) {
    case 'date':
      return { type: 'string', description: arg.description, pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
    case 'timestamp':
      return { type: 'string', description: arg.description };
    case 'string':
      return { type: 'string', description: arg.description };
    case 'integer': {
      const s: Record<string, unknown> = { type: 'integer', description: arg.description };
      if (arg.min !== undefined) s.minimum = arg.min;
      if (arg.max !== undefined) s.maximum = arg.max;
      return s;
    }
    case 'boolean':
      return { type: 'boolean', description: arg.description };
    case 'id':
      return { type: 'string', description: `${arg.description} A uuid, or a handle such as r12 from an earlier result.` };
    case 'enum':
      return { type: 'string', description: arg.description, enum: [...(arg.values ?? [])] };
    case 'object':
      return { type: 'object', description: arg.description, additionalProperties: true };
    case 'string[]':
      return { type: 'array', description: arg.description, items: { type: 'string' } };
  }
}

/**
 * Strict schema: every property is listed, optional ones are nullable so the
 * model can pass null and the API can validate `required` exactly.
 */
export function toolInputSchema(spec: ToolSpec): JsonSchemaObject {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, arg] of Object.entries(spec.args)) {
    const base = argSchema(arg);
    if (arg.required) {
      properties[name] = base;
    } else {
      // anyOf with null keeps "strict" satisfiable while letting the model omit.
      properties[name] = { anyOf: [base, { type: 'null' }], description: arg.description };
    }
    required.push(name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** The wire-shape tool definition for the Messages API. */
export interface WireTool {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
  strict: true;
  defer_loading?: true;
}

export function wireTools(specs: readonly ToolSpec[] = ASSISTANT_TOOLS): WireTool[] {
  return specs.map((spec) => {
    const t: WireTool = { name: spec.name, description: spec.description, input_schema: toolInputSchema(spec), strict: true };
    if (!spec.core) t.defer_loading = true;
    return t;
  });
}

/**
 * Validate a tool input against its spec (the server stops validating once
 * inputs stream eagerly). Returns the list of problems; empty means valid.
 */
export function validateToolInput(spec: ToolSpec, input: unknown): string[] {
  const problems: string[] = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return ['input must be an object'];
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!(key in spec.args)) problems.push(`unknown argument ${key}`);
  for (const [name, arg] of Object.entries(spec.args)) {
    const v = obj[name];
    if (v === undefined || v === null) {
      if (arg.required) problems.push(`${name} is required`);
      continue;
    }
    switch (arg.type) {
      case 'date':
        if (typeof v !== 'string' || !DATE_RE.test(v)) problems.push(`${name} must be YYYY-MM-DD`);
        break;
      case 'timestamp':
      case 'string':
        if (typeof v !== 'string') problems.push(`${name} must be a string`);
        break;
      case 'integer':
        if (typeof v !== 'number' || !Number.isInteger(v)) problems.push(`${name} must be an integer`);
        else if ((arg.min !== undefined && v < arg.min) || (arg.max !== undefined && v > arg.max)) problems.push(`${name} out of range`);
        break;
      case 'boolean':
        if (typeof v !== 'boolean') problems.push(`${name} must be a boolean`);
        break;
      case 'id':
        if (typeof v !== 'string' || !(UUID_RE.test(v) || HANDLE_RE.test(v))) problems.push(`${name} must be a uuid or a handle`);
        break;
      case 'enum':
        if (typeof v !== 'string' || !(arg.values ?? []).includes(v)) problems.push(`${name} must be one of ${(arg.values ?? []).join(', ')}`);
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) problems.push(`${name} must be an object`);
        break;
      case 'string[]':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) problems.push(`${name} must be an array of strings`);
        break;
    }
  }
  return problems;
}

/**
 * Tool input → the `p_args` object the dispatcher reads (RPC parameter names).
 * Handles must already be resolved to uuids by the caller.
 */
export function rpcArgs(spec: ToolSpec, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, arg] of Object.entries(spec.args)) {
    const v = input[name];
    if (v === undefined || v === null) continue;
    out[arg.param ?? `p_${name}`] = v;
  }
  return out;
}
