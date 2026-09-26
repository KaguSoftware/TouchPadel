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
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function reasonWords(v: unknown, tr: Tr): string | null {
  if (has(KNOWN_REASONS, v)) return tr(`op.reasons.${v}`);
  if (v === 'promotion') return tr('ws.reports.drill.reasons.promotion');
  // Free text a person typed; the underscores of an unknown code read better as spaces.
  const t = text(v);
  return t ? t.replace(/_/g, ' ') : null;
}

function inLocale(en: unknown, ar: unknown, locale: Locale): string | null {
  return locale === 'ar' ? (text(ar) ?? text(en)) : (text(en) ?? text(ar));
}

function where(d: Record<string, unknown>, tr: Tr): string | null {
  const table = text(d.table);
  return table ? tr('ws.reports.drill.table', { table }) : text(d.tabLabel);
}

export function drillWords(t: DrillTransaction, tr: Tr, locale: Locale): { kind: string | null; text: string | null } {
  const d = t.detail;
  const sub: Sub | null = d && has(SUBS, d.sub) ? d.sub : null;
  if (!d || !sub) return { kind: null, text: t.label };

  const parts: (string | null)[] = [];
  switch (sub) {
    case 'booking':
      parts.push(inLocale(d.courtEn, d.courtAr, locale), text(d.guest));
      // Kept bookings are the default; only the ones that did not stand say so.
      if (d.status === 'cancelled' || d.status === 'no_show') parts.push(has(BOOKING_STATUSES, d.status) ? tr(`ws.kit.bookingStatus.${d.status}`) : null);
      break;
    case 'settledTab':
      parts.push(where(d, tr));
      break;
    case 'order':
      parts.push(d.source === 'till' || d.source === 'guest_web' ? tr(`ws.reports.drill.sources.${d.source}`) : text(d.source), where(d, tr));
      break;
    case 'payment':
      parts.push(d.method === 'cash' || d.method === 'card' ? tr(`ws.reports.drill.methods.${d.method}`) : text(d.method), where(d, tr));
      break;
    case 'refund':
      parts.push(reasonWords(d.reason, tr), d.method === 'cash' || d.method === 'card' ? tr(`ws.reports.drill.methods.${d.method}`) : text(d.method));
      break;
    case 'discount':
      parts.push(
        d.adjKind === 'discount_percent' || d.adjKind === 'discount_amount' || d.adjKind === 'price_override' ? tr(`ws.reports.drill.adjKinds.${d.adjKind}`) : text(d.adjKind),
        reasonWords(d.reason, tr),
      );
      break;
    case 'void':
      parts.push(inLocale(d.itemEn, d.itemAr, locale), reasonWords(d.reason, tr));
      break;
    case 'waste': {
      const qty = typeof d.qty === 'number' ? d.qty : Number(d.qty);
      const unit = has(UNITS, d.unit) ? tr(`op.stock.unit.${d.unit}`) : text(d.unit);
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
