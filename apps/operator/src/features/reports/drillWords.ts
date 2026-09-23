/**
 * A transaction from report_drill, said in words in the reader's language.
 *
 * Since 0102 each row carries `detail` — court and guest, table, payment
 * method, reason code, adjustment kind, item or ingredient names in both
 * languages, quantity and unit — next to the English `label` the server has
 * always built ("refund · quality · cash"). The sentence is written here from
 * `detail`; a row without it (an older server) falls back to the label, so the
 * window never goes blank.
 *
 * Reason codes are partly a fixed list (`op.reasons.*`) and partly what staff
 * typed; a known code is translated and anything else is shown as written.
 */
import type { Locale, MessageKey } from '@touch/i18n';
import type { DrillTransaction } from './reportPayloads';

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

const SUBS = ['booking', 'settledTab', 'order', 'payment', 'refund', 'discount', 'void', 'waste', 'line'] as const;
type Sub = (typeof SUBS)[number];

const KNOWN_REASONS = ['customer_request', 'weather', 'expired', 'staff_error', 'duplicate', 'wrong_item', 'changed_mind', 'quality', 'spill', 'comp', 'other'] as const;
const BOOKING_STATUSES = ['pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'expired'] as const;
const MOVEMENTS = ['waste_spill', 'waste_spoilage', 'void_after_send', 'expired_writeoff'] as const;
const UNITS = ['g', 'ml', 'pc'] as const;

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const text_ = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function reasonWords(v: unknown, tr: Tr): string | null {
  if (has(KNOWN_REASONS, v)) return tr(`op.reasons.${v}`);
  if (v === 'promotion') return tr('ws.reports.drill.reasons.promotion');
  // Free text a person typed; the underscores of an unknown code read better as spaces.
  const t = text_(v);
  return t ? t.replace(/_/g, ' ') : null;
}

function inLocale(en: unknown, ar: unknown, locale: Locale): string | null {
  return locale === 'ar' ? (text_(ar) ?? text_(en)) : (text_(en) ?? text_(ar));
}

function where(d: Record<string, unknown>, tr: Tr): string | null {
  const table = text_(d.table);
  return table ? tr('ws.reports.drill.table', { table }) : text_(d.tabLabel);
}

export function drillWords(t: DrillTransaction, tr: Tr, locale: Locale): { kind: string | null; text: string | null } {
  const d = t.detail;
  const sub: Sub | null = d && has(SUBS, d.sub) ? d.sub : null;
  if (!d || !sub) return { kind: null, text: t.label };

  const parts: (string | null)[] = [];
  switch (sub) {
    case 'booking':
      parts.push(inLocale(d.courtEn, d.courtAr, locale), text_(d.guest));
      // Kept bookings are the default; only the ones that did not stand say so.
      if (d.status === 'cancelled' || d.status === 'no_show') parts.push(has(BOOKING_STATUSES, d.status) ? tr(`ws.kit.bookingStatus.${d.status}`) : null);
      break;
    case 'settledTab':
      parts.push(where(d, tr));
      break;
    case 'order':
      parts.push(d.source === 'till' || d.source === 'guest_web' ? tr(`ws.reports.drill.sources.${d.source}`) : text_(d.source), where(d, tr));
      break;
    case 'payment':
      parts.push(d.method === 'cash' || d.method === 'card' ? tr(`ws.reports.drill.methods.${d.method}`) : text_(d.method), where(d, tr));
      break;
    case 'refund':
      parts.push(reasonWords(d.reason, tr), d.method === 'cash' || d.method === 'card' ? tr(`ws.reports.drill.methods.${d.method}`) : text_(d.method));
      break;
    case 'discount':
      parts.push(
        d.adjKind === 'discount_percent' || d.adjKind === 'discount_amount' || d.adjKind === 'price_override' ? tr(`ws.reports.drill.adjKinds.${d.adjKind}`) : text_(d.adjKind),
        reasonWords(d.reason, tr),
      );
      break;
    case 'void':
      parts.push(inLocale(d.itemEn, d.itemAr, locale), reasonWords(d.reason, tr));
      break;
    case 'waste': {
      const qty = typeof d.qty === 'number' ? d.qty : Number(d.qty);
      const unit = has(UNITS, d.unit) ? tr(`op.stock.unit.${d.unit}`) : text_(d.unit);
      parts.push(
        inLocale(d.ingredientEn, d.ingredientAr, locale),
        Number.isFinite(qty) && unit ? tr('op.stock.qty', { qty: new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-IQ').format(qty), unit }) : null,
        reasonWords(d.reason, tr) ?? (has(MOVEMENTS, d.movement) ? tr(`op.stock.movement.${d.movement}`) : null),
      );
      break;
    }
    case 'line': {
      const item = inLocale(d.itemEn, d.itemAr, locale);
      parts.push(item ? tr('ws.reports.drill.lineQty', { item, qty: String(d.qty ?? '') }) : null);
      break;
    }
  }
  const words = parts.filter((p): p is string => !!p);
  return { kind: tr(`ws.reports.drill.subs.${sub}`), text: words.length ? words.join(' · ') : null };
}

// ---------------------------------------------------------------------------
// The same facts, one per column, for the export
// ---------------------------------------------------------------------------

/**
 * A transaction's facts, each said in words, for a spreadsheet column of its
 * own.
 *
 * The export used to write `detail` raw: seventeen columns including
 * `courtEn`, `courtAr`, `itemEn`, `itemAr`, `ingredientEn`, `ingredientAr`,
 * of which at most one was ever filled, and codes like `no_show` and
 * `waste_spill` under them. That is a very wide, almost entirely empty sheet
 * whose filled cells still need a glossary.
 *
 * Here the six name columns collapse to one `what` — the court, the item or
 * the ingredient, whichever this kind of row has, in the reader's language —
 * and every code is the word the screen shows for it. Words from a fixed
 * catalog filter and count in a spreadsheet exactly as codes do, so nothing
 * that could be done with the raw file is lost.
 */
export interface DrillFacts {
  /** "Refund", "Booking", "Waste" — the kind of thing this row is. */
  kind: string | null;
  /** The one-line sentence the drill window shows. */
  text: string | null;
  /** The court, menu item or ingredient this row is about. */
  what: string | null;
  /** Table 12, or the tab's label. */
  where: string | null;
  guest: string | null;
  reason: string | null;
  method: string | null;
  status: string | null;
  source: string | null;
  qty: number | null;
  unit: string | null;
}

export function drillFacts(t: DrillTransaction, tr: Tr, locale: Locale): DrillFacts {
  const { kind, text } = drillWords(t, tr, locale);
  const d = t.detail ?? {};
  const qty = typeof d.qty === 'number' ? d.qty : Number(d.qty);
  return {
    kind,
    text,
    what: inLocale(d.courtEn, d.courtAr, locale) ?? inLocale(d.itemEn, d.itemAr, locale) ?? inLocale(d.ingredientEn, d.ingredientAr, locale),
    where: where(d, tr),
    guest: text_(d.guest),
    reason: reasonWords(d.reason, tr) ?? (has(MOVEMENTS, d.movement) ? tr(`op.stock.movement.${d.movement}`) : null),
    method: d.method === 'cash' || d.method === 'card' ? tr(`ws.reports.drill.methods.${d.method}`) : text_(d.method),
    status: has(BOOKING_STATUSES, d.status) ? tr(`ws.kit.bookingStatus.${d.status}`) : text_(d.status),
    source: d.source === 'till' || d.source === 'guest_web' ? tr(`ws.reports.drill.sources.${d.source}`) : text_(d.source),
    qty: Number.isFinite(qty) ? qty : null,
    unit: has(UNITS, d.unit) ? tr(`op.stock.unit.${d.unit}`) : text_(d.unit),
  };
}
