/**
 * Report columns → DataTable columns. Labels come from the server when it
 * sends them, else the `ws.reports.columns.*` catalog, else the key itself.
 */
import type { Locale, MessageKey, TParams } from '@touch/i18n';
import type { Column } from '../../components/kit';
import { formatCell, humanizeKey, isColumnLabelKey, isNumericKind, type NormalizedColumn, type ReportRow } from './reportTypes';

export type Tr = (key: MessageKey, params?: TParams) => string;

export function columnLabel(c: NormalizedColumn, locale: Locale, tr: Tr): string {
  const server = locale === 'ar' ? (c.labelAr ?? c.labelEn) : (c.labelEn ?? c.labelAr);
  if (server) return server;
  if (isColumnLabelKey(c.key)) return tr(`ws.reports.columns.${c.key}`);
  return humanizeKey(c.key);
}

export function unitsFor(tr: Tr) {
  return {
    percent: (n: string) => `${n}%`,
    minutes: (n: string) => tr('ws.kit.common.minutes', { minutes: n }),
    hours: (n: string) => tr('ws.kit.common.hours', { hours: n }),
  };
}

export function toDataColumns(
  columns: readonly NormalizedColumn[],
  locale: Locale,
  tr: Tr,
  options: { sortable?: boolean } = {},
): Column<ReportRow>[] {
  const units = unitsFor(tr);
  return columns.map((c) => ({
    key: c.key,
    header: columnLabel(c, locale, tr),
    numeric: isNumericKind(c.kind),
    sortable: options.sortable,
    render: (row) => formatCell(row[c.key], c.kind, locale, units),
  }));
}
