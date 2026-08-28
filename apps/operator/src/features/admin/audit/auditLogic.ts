/**
 * Pure helpers for the audit-log viewer.
 *
 * The contract (SOW L241-243) promises "an append-only audit log recording
 * actor, action, before and after values, and a reason code on discounts,
 * voids, price overrides, stock adjustments and reservation overrides". The log
 * has been written correctly since day 1 — `audit_log` even grants `select` to
 * management (0005:63-65) — and until now **nothing read it**. The acceptance
 * test is "every discount, void and refund traceable to a named actor"
 * (L434-439), which needs a screen, not a table.
 *
 * Everything here is pure so the parts that decide what a manager sees can be
 * tested without a database.
 */

export interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_role: string | null;
  authorizer_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason_code: string | null;
  device_id: string | null;
}

/**
 * Action families, derived from the dotted prefix rather than hard-coded, so a
 * new server-side action appears in the filter the day it first fires instead
 * of being invisible until someone remembers to list it here.
 */
export function actionFamily(action: string): string {
  const dot = action.indexOf('.');
  return dot === -1 ? action : action.slice(0, dot);
}

export function actionFamilies(rows: readonly AuditRow[]): string[] {
  return [...new Set(rows.map((r) => actionFamily(r.action)))].sort();
}

/**
 * The actions the contract singles out as requiring a reason code. A row in
 * this set with no reason is a contract violation, and the viewer marks it —
 * that is the whole point of showing the column.
 */
const REASON_REQUIRED = new Set([
  'discount.apply',
  'order_item.void',
  'reservation.price_override',
  'price.override',
  'payment.refund',
  'stock.adjustment',
  'stock.record_waste',
  'reservation.cancel',
  'reservation.move',
  'reservation.extend',
  'reservation.mark',
]);

export function reasonRequired(action: string): boolean {
  return REASON_REQUIRED.has(action);
}

/** A row the contract says should carry a reason, and does not. */
export function missingReason(row: AuditRow): boolean {
  return reasonRequired(row.action) && !row.reason_code;
}

export interface AuditFilter {
  /** Free text across action, entity, entity id, reason and device. */
  query: string;
  /** '' = every family. */
  family: string;
  /** '' = every actor. */
  actorId: string;
  /** Only rows the contract says need a reason but do not carry one. */
  onlyMissingReason: boolean;
}

export const EMPTY_FILTER: AuditFilter = {
  query: '',
  family: '',
  actorId: '',
  onlyMissingReason: false,
};

export function matchesAudit(row: AuditRow, filter: AuditFilter): boolean {
  if (filter.family && actionFamily(row.action) !== filter.family) return false;
  if (filter.actorId && row.actor_id !== filter.actorId) return false;
  if (filter.onlyMissingReason && !missingReason(row)) return false;
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  return [row.action, row.entity, row.entity_id, row.reason_code, row.device_id, row.actor_role]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => v.toLowerCase().includes(q));
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

/** Render a jsonb leaf the way a manager reads it, not the way JSON prints it. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * The fields that actually changed between `before` and `after`.
 *
 * A raw jsonb pair is unreadable at a glance — `menu_items` has eighteen
 * columns and a sold-out toggle changes one. Insert rows (`before` null) and
 * delete rows (`after` null) are shown whole, because for those the whole row
 * IS the change.
 */
export function diffFields(before: unknown, after: unknown): FieldChange[] {
  const b = isRecord(before) ? before : null;
  const a = isRecord(after) ? after : null;
  if (!b && !a) return [];

  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].sort();
  const out: FieldChange[] = [];
  for (const field of keys) {
    const bv = b ? b[field] : undefined;
    const av = a ? a[field] : undefined;
    if (sameValue(bv, av)) continue;
    out.push({ field, before: formatValue(bv), after: formatValue(av) });
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Display name for an actor id, falling back to something a human can still act on. */
export function actorLabel(
  actorId: string | null,
  role: string | null,
  names: ReadonlyMap<string, string>,
): string {
  if (!actorId) return role ?? 'system';
  const name = names.get(actorId);
  if (name) return name;
  // A guest or a deleted staff row: the short id is still enough to correlate
  // against another table, which a bare "unknown" would not be.
  return `${role ?? 'unknown'} ${actorId.slice(0, 8)}`;
}
