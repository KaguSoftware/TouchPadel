/**
 * The transactions behind a pulse tile, the way the management panel opens
 * them: `report_drill` for the figure over the page's dates, in the kit's
 * DrillThroughPanel. One layer per tab; a tile calls `open` with the panel's
 * figure key, so the same figure lists the same rows on both screens.
 *
 * The court filter narrows court figures (`court:<uuid>` as the key); venue-
 * wide and cafe figures pass no key.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from '@touch/core';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { DrillThroughPanel, asyncStatus } from '../../components/kit';
import { normalizeColumns, type DrillResult, type ReportRow } from '../reports/reportTypes';
import { toDataColumns } from '../reports/columns';

/** The report_drill figure keys a pulse tile can open. */
export type DrillFigure =
  | 'revenue'
  | 'padelRevenue'
  | 'cafeNet'
  | 'cash'
  | 'card'
  | 'discounts'
  | 'refunds'
  | 'waste'
  | 'orders'
  | 'bookings'
  | 'noShows'
  | 'cancellations';

export interface DrillTarget {
  figure: DrillFigure;
  /** What the modal title calls it — the tile's label. */
  label: string;
  /** A court uuid when the court filter narrows this figure. */
  courtId?: string | null;
}

export interface AnalyticsDrill {
  open: (target: DrillTarget) => void;
  layer: ReactNode;
}

export function useAnalyticsDrill(range: DateRange): AnalyticsDrill {
  const { tr, locale } = useLocale();
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const key = target?.courtId ? `court:${target.courtId}` : null;
  const q = useQuery({
    queryKey: ['analytics', 'drill', target?.figure, key, range.from, range.to],
    queryFn: () => appRpc<DrillResult>('report_drill', { p_figure: target!.figure, p_key: key, p_from: range.from, p_to: range.to }),
    enabled: target !== null,
  });
  const rows: ReportRow[] = useMemo(() => q.data?.transactions ?? [], [q.data]);
  const columns = useMemo(() => toDataColumns(normalizeColumns(null, rows), locale, tr), [rows, locale, tr]);
  const layer = target ? (
    <DrillThroughPanel
      title={tr('ws.analytics.drill.title', { figure: target.label })}
      status={asyncStatus(q, (d) => (d?.transactions ?? []).length === 0)}
      transactions={rows}
      columns={columns}
      rowKey={(row, i) => String(row.id ?? i)}
      onClose={() => setTarget(null)}
      onRetry={() => void q.refetch()}
      error={q.error}
    />
  ) : null;
  return { open: setTarget, layer };
}
