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

import { wallTimeToUtc } from '@touch/core';

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
  /**
   * Display names `app.audit_log_page` (0068) already joins — staff name or,
   * for a guest, the profile's full name. Absent on the direct-table fallback.
   */
  actor_name?: string | null;
  authorizer_name?: string | null;
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

export function matchesAudit(row: AuditRow, filter: AuditFilter, words: readonly string[] = []): boolean {
  if (filter.family && actionFamily(row.action) !== filter.family) return false;
  if (filter.actorId && row.actor_id !== filter.actorId && row.authorizer_id !== filter.actorId) return false;
  if (filter.onlyMissingReason && !missingReason(row)) return false;
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  // `words` is what the screen shows for the row (the action in plain
  // language, the person's name), so a manager can search for what they SEE —
  // "refund", a name — as well as the stored code the overview links with.
  return [row.action, row.entity, row.entity_id, row.reason_code, row.device_id, row.actor_role, row.actor_name, ...words]
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

// ---------------------------------------------------------------------------
// Period + export (spec 06.38: filter by period, export CSV client-side)
// ---------------------------------------------------------------------------

export interface PeriodBounds {
  /** ISO instant the `from` business day starts at. */
  fromIso: string;
  /** ISO instant the business day AFTER `to` starts at (exclusive upper bound). */
  toExclusiveIso: string;
}

/**
 * Inclusive range of BUSINESS days → half-open instant range for `at`. A
 * business day starts at `startHour` in the venue's zone, as
 * app.business_date counts it, so a night's 00:00–02:00 tail stays with its
 * night. This used the station's calendar midnight and said the server
 * re-anchored to the venue day; it does not (audit_log_page filters
 * `at >= p_from and at < p_to` as given), so at 01:30 "Today" missed
 * tonight's 22:00 void, and "Yesterday" cut every night at midnight.
 */
export function periodBounds(period: { from: string; to: string }, startHour: number, tz: string): PeriodBounds {
  const start = startHour * 60;
  return {
    fromIso: wallTimeToUtc(period.from, start, tz).toISOString(),
    toExclusiveIso: wallTimeToUtc(period.to, 24 * 60 + start, tz).toISOString(),
  };
}

/** True when `row.at` falls inside the period (used by the direct-select fallback re-check). */
export function inPeriod(row: Pick<AuditRow, 'at'>, bounds: PeriodBounds): boolean {
  return row.at >= bounds.fromIso && row.at < bounds.toExclusiveIso;
}

export interface AuditCsvLabels {
  when: string;
  actor: string;
  role: string;
  authoriser: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string;
  device: string;
  changes: string;
}

/** Headers + one row per entry; changes are flattened to `field: before → after; …`. */
export function auditCsv(
  labels: AuditCsvLabels,
  rows: readonly AuditRow[],
  names: ReadonlyMap<string, string>,
): { headers: string[]; rows: (string | number | null)[][] } {
  const headers = [labels.when, labels.actor, labels.role, labels.authoriser, labels.action, labels.entity, labels.entityId, labels.reason, labels.device, labels.changes];
  const out = rows.map((r) => [
    r.at,
    actorLabel(r.actor_id, r.actor_role, names),
    r.actor_role,
    r.authorizer_id ? actorLabel(r.authorizer_id, null, names) : null,
    r.action,
    r.entity,
    r.entity_id,
    r.reason_code,
    r.device_id,
    diffFields(r.before, r.after)
      .map((c) => `${c.field}: ${c.before} → ${c.after}`)
      .join('; '),
  ]);
  return { headers, rows: out };
}

// ---------------------------------------------------------------------------
// Plain language (the screen shows words; the CSV keeps the stored codes)
// ---------------------------------------------------------------------------

/**
 * Every action the migrations write (grep `write_audit` in
 * packages/db/supabase/migrations), as catalog keys. The table used to print
 * `tab.settle`, `menu.item.sold_out` and `table_token.prev_secret_cleared` in
 * a monospace font. A new server action that is not listed here still shows —
 * under its area's name, with the code beside it — rather than disappearing.
 */
export const ACTION_KEYS = [
  'account.delete',
  'analytics.insight.reject',
  'analytics.insight.unreject',
  'analytics.insights.save',
  'analytics.patterns.save',
  'checklist.template.save',
  'courts.create',
  'courts.delete',
  'courts.reorder',
  'courts.update',
  'customer.create',
  'customer.flags_set',
  'customer.note_add',
  'customer.note_edit',
  'day.close',
  'day.open',
  'discount.apply',
  'drawer.open',
  // Wave 5, till shifts (wave5-addendum-2026-09-25 §2.9.4, §5.2).
  'drawer.shift_close',
  'drawer.shift_close_by_day',
  'drawer.shift_open',
  'incident.purge',
  'incident.redact',
  'incident.report',
  'incident.review',
  'marketing.audience_save',
  'marketing.campaign.suggest',
  'marketing.campaign_save',
  'marketing.campaign_status',
  'marketing.content.approve',
  'marketing.content.changes',
  'marketing.content.decline',
  'marketing.content.revise',
  'marketing.content.submit',
  'marketing.content.withdraw',
  'marketing.note.add',
  'marketing.request.add',
  'marketing.request.answer',
  'marketing.request.withdraw',
  'menu.category.create',
  'menu.category.photo',
  'menu.category.reorder',
  'menu.category.update',
  'menu.item.addons',
  'menu.item.availability',
  'menu.item.cost',
  'menu.item.create',
  'menu.item.link_group',
  'menu.item.photo',
  'menu.item.reorder',
  'menu.item.sold_out',
  'menu.item.update',
  'menu.modifier.create',
  'menu.modifier.reorder',
  'menu.modifier.reveals',
  'menu.modifier.update',
  'menu.modifier_group.create',
  'menu.modifier_group.update',
  'menu.variant.create',
  'menu.variant.update',
  'order_item.void',
  'payment.refund',
  'price.override',
  'promotion.apply',
  'promotion.drop_on_merge',
  'promotion.generate_code',
  'promotion.replace',
  'promotion.set_enabled',
  'promotion.upsert',
  'protocol.auto',
  'protocol.decide',
  'protocol.hiring.candidate_delete',
  'protocol.hiring.candidate_save',
  'protocol.hiring.complete',
  'protocol.hiring.purge',
  'protocol.price.apply',
  'protocol.promo.apply',
  'protocol.release.accept',
  'protocol.release.idea_decline',
  'protocol.release.idea_start',
  'protocol.release.idea_submit',
  'protocol.release.idea_withdraw',
  'protocol.release.launch',
  'protocol.release.review',
  'protocol.run.add_step',
  'protocol.run.edit_items',
  'protocol.skip',
  'protocol.start',
  'protocol.stop',
  'protocol.submit',
  'protocol.template.save',
  'protocol.unschedule',
  'protocol.withdraw',
  'protocol.withdraw_run',
  'purchase.acknowledge',
  'purchase.deliver',
  'purchase.receive',
  'purchase.record',
  'rates.rule.create',
  'rates.rule.update',
  'reservation.cancel',
  'reservation.confirm',
  'reservation.create',
  'reservation.event_block',
  'reservation.extend',
  'reservation.hold',
  'reservation.mark_arrived',
  'reservation.mark_completed',
  'reservation.mark_no_show',
  'reservation.move',
  'reservation.price_override',
  'reservation.release',
  'series.cancel',
  'series.create',
  'settings.cafe',
  'settings.opening_hours',
  'settings.waiter_cooldown',
  'shopping.add',
  'shopping.approve',
  'shopping.cancel',
  'shopping.decline',
  'staff.active_set',
  'staff.create',
  'staff.deduction.approve',
  'staff.deduction.cancel',
  'staff.deduction.decline',
  'staff.deduction.propose',
  'staff.deduction.withdraw',
  'staff.password_reset',
  'staff.pin_cleared',
  'staff.pin_collision',
  'staff.pin_locked',
  'staff.pin_lockout_cleared',
  'staff.pin_set',
  'staff.rename',
  'staff.role_set',
  'staff_request.decide',
  'staff_request.submit',
  'staff_request.withdraw',
  'stock.discard_count',
  'stock.finalize_count',
  'stock.ingredient.create',
  'stock.ingredient.update',
  'stock.log',
  'stock.price_log',
  'stock.product_test',
  'stock.receive_delivery',
  'stock.recipe.change_approve',
  'stock.recipe.change_decline',
  'stock.recipe.change_submit',
  'stock.recipe.change_withdraw',
  'stock.recipe.set',
  'stock.record_production',
  'stock.record_waste',
  'stock.start_count',
  'stock.submit_count',
  'stock.transfer',
  'stock.write_off_expired',
  'tab.cancel',
  'tab.merge',
  'tab.settle',
  'table.bell',
  'table.qr_tokens_read',
  'table.token.rotate',
  'table.upsert',
  'table_token.accepted_prev_secret',
  'table_token.prev_secret_cleared',
  'table_token.secret_rotated',
  'teaching.archive',
  'teaching.save',
  'telegram.o.seen',
  'telegram.o.served',
  'telegram.o.void',
  'telegram.staff_set',
  'telegram.w.ack',
  'telegram.w.done',
] as const;

/** The areas (dotted prefixes) the known actions fall into. */
export const FAMILY_KEYS = [
  'account',
  'analytics',
  'checklist',
  'courts',
  'customer',
  'day',
  'discount',
  'drawer',
  'incident',
  'marketing',
  'menu',
  'order_item',
  'payment',
  'price',
  'promotion',
  'protocol',
  'purchase',
  'rates',
  'reservation',
  'series',
  'settings',
  'shopping',
  'staff',
  'staff_request',
  'stock',
  'tab',
  'table',
  'table_token',
  'teaching',
  'telegram',
] as const;

/** `menu.item.sold_out` → `menuItemSoldOut`: a stored code as a catalog key segment. */
export function codeToKey(code: string): string {
  return code.replace(/[._:-]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function knownActionKey(action: string): string | null {
  return (ACTION_KEYS as readonly string[]).includes(action) ? codeToKey(action) : null;
}

export function knownFamilyKey(family: string): string | null {
  return (FAMILY_KEYS as readonly string[]).includes(family) ? codeToKey(family) : null;
}

/**
 * The area filter's options: every known area plus any new one present in the
 * data. The filter is applied on the server now, so a list built only from the
 * loaded page would shrink to the chosen area the moment it was chosen.
 */
export function familyOptions(rows: readonly AuditRow[]): string[] {
  return [...new Set<string>([...FAMILY_KEYS, ...actionFamilies(rows)])].sort();
}

/** An exact, known action code — safe to hand the server as a prefix filter. */
export function isActionCode(query: string): boolean {
  return (ACTION_KEYS as readonly string[]).includes(query.trim());
}

/**
 * Fields left out of the on-screen before/after list: row ids, foreign keys,
 * idempotency keys, tokens and secrets. They mean nothing to a manager reading
 * what changed; the CSV export keeps every field.
 */
export function isTechnicalField(field: string): boolean {
  return field === 'id' || field.endsWith('_id') || field.endsWith('_ids') || /idempotency|token|secret|blur|_hash$/.test(field);
}

/** `sold_out` → `Sold out`, `price_iqd` → `Price (IQD)`. */
export function humanizeField(field: string): string {
  const iqd = field.endsWith('_iqd');
  const base = (iqd ? field.slice(0, -4) : field).replace(/_/g, ' ').trim();
  const words = base.charAt(0).toUpperCase() + base.slice(1);
  return iqd ? `${words} (IQD)` : words;
}

/**
 * What the record is called, from the row itself: a menu item's name, a
 * guest's name, a tab's label. The table used to print the table name and a
 * uuid (`tabs a173d62b-…`).
 */
export function recordName(before: unknown, after: unknown, locale: 'en' | 'ar'): string | null {
  const src = isRecord(after) ? after : isRecord(before) ? before : null;
  if (!src) return null;
  const localized = locale === 'ar' ? src.name_ar : src.name_en;
  for (const v of [localized, src.name_en, src.display_name, src.guest_name, src.full_name, src.name, src.label, src.table_number]) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}
