/**
 * The padel desk's monthly reports from before the system (0331, rows 0348)
 * count in the management panel and Analytics › Courts since 0349, but only
 * when the picked range holds a report's whole month. The server says which
 * reports it counted and which the range cut (`history`); this turns that into
 * the notice lines both screens show, so the owner always knows when a figure
 * includes a report, when its money is the report's own approximation, and
 * why a report month is missing.
 */
import { formatMonthYear, type Locale, type MessageKey, type TParams } from '@touch/i18n';

/** A notice line (the Notices list's shape, kept here so this stays a plain .ts module). */
export interface LegacyNotice {
  key: string;
  text: string;
}

export interface LegacyMonth {
  from: string;
  to: string;
  revenueApproximate: boolean;
}

export interface LegacyHistory {
  included: LegacyMonth[];
  partial: LegacyMonth[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function months(v: unknown): LegacyMonth[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).flatMap((m) =>
    typeof m.from === 'string' && typeof m.to === 'string'
      ? [{ from: m.from, to: m.to, revenueApproximate: m.revenueApproximate === true }]
      : [],
  );
}

/** The server's `history` (or `history.period` on the panel); null when absent. */
export function parseLegacyHistory(json: unknown): LegacyHistory | null {
  if (!isObj(json)) return null;
  return { included: months(json.included), partial: months(json.partial) };
}

function monthList(list: readonly LegacyMonth[], locale: Locale): string {
  // A report's month is its first day's month; noon UTC keeps it on that day
  // in the venue's time zone.
  const names = list.map((m) => formatMonthYear(new Date(`${m.from}T12:00:00Z`), locale));
  return new Intl.ListFormat(locale === 'ar' ? 'ar' : 'en', { style: 'long', type: 'conjunction' }).format(names);
}

/** The notice lines for one screen: `panel` or `courts` names the slots it fills. */
export function legacyNotices(
  history: LegacyHistory | null,
  screen: 'panel' | 'courts',
  tr: (key: MessageKey, params?: TParams) => string,
  locale: Locale,
): LegacyNotice[] {
  if (history == null) return [];
  const out: LegacyNotice[] = [];
  if (history.included.length > 0) {
    out.push({
      key: 'legacy-included',
      text: tr(`ws.analytics.notices.history.${screen}`, { months: monthList(history.included, locale) }),
    });
    const approx = history.included.filter((m) => m.revenueApproximate);
    if (approx.length > 0) {
      out.push({ key: 'legacy-approx', text: tr('ws.analytics.notices.history.approximate', { months: monthList(approx, locale) }) });
    }
  }
  if (history.partial.length > 0) {
    out.push({ key: 'legacy-partial', text: tr('ws.analytics.notices.history.partial', { months: monthList(history.partial, locale) }) });
  }
  return out;
}
