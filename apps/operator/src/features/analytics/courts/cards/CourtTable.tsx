/**
 * One row per court over the period. The table IS the chart here (the twin
 * of the two per-court bar charts beside it), so it gets its own CSV and no
 * plot. Rates print as "n of N" below the twenty-booking floor.
 */
import { pickLocale } from '@touch/core';
import { Button } from '../../../../components/ui';
import { DataTable, type Column } from '../../../../components/kit';
import { useLocale } from '../../../../lib/i18n';
import { CardShell, type CardState } from '../../cards/CardShell';
import { downloadCsv, toCsv } from '../../csv';
import type { Formatters } from '../../format';
import type { CourtAttachRow, CourtRow } from '../shape';
import { rateText } from '../format';

export interface CourtTableRow {
  court: CourtRow;
  cafe: CourtAttachRow | null;
}

export function CourtTable({
  rows,
  state,
  refreshing,
  selectedCourtId,
  f,
  tip,
  file,
}: {
  rows: readonly CourtTableRow[];
  state: CardState;
  refreshing?: boolean;
  selectedCourtId: string | null;
  f: Formatters;
  tip: string;
  file: string;
}) {
  const { tr, locale } = useLocale();
  const name = (c: CourtRow) => pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.courtId;
  const columns: Column<CourtTableRow>[] = [
    { key: 'court', header: tr('ws.reports.filters.court'), render: (r) => name(r.court), truncate: true, truncateTitle: (r) => name(r.court) },
    { key: 'bookings', header: tr('ws.analytics.courts.kpi.bookings'), numeric: true, render: (r) => f.num(r.court.bookings) },
    { key: 'hours', header: tr('ws.analytics.courts.kpi.bookedHours'), numeric: true, render: (r) => f.num(Math.round(r.court.bookedMinutes / 60)) },
    { key: 'occupancy', header: tr('ws.analytics.courts.kpi.occupancy'), numeric: true, render: (r) => (r.court.occupancyPct == null ? '—' : f.pct(r.court.occupancyPct)) },
    { key: 'revenue', header: tr('ws.analytics.courts.kpi.revenue'), numeric: true, render: (r) => f.money(r.court.revenueIqd) },
    { key: 'revPerHour', header: tr('ws.analytics.courts.kpi.revPerOpenHourShort'), numeric: true, render: (r) => (r.court.revPerOpenHourIqd == null ? '—' : f.money(r.court.revPerOpenHourIqd)) },
    { key: 'cancel', header: tr('ws.analytics.courts.kpi.cancelRate'), numeric: true, render: (r) => rateText(tr, f, r.court.cancellationRatePct, r.court.cancellations, r.court.bookedTotal) },
    { key: 'noShow', header: tr('ws.analytics.courts.kpi.noShowRate'), numeric: true, render: (r) => rateText(tr, f, r.court.noShowRatePct, r.court.noShows, r.court.bookedTotal) },
    { key: 'attach', header: tr('ws.analytics.courts.kpi.attachRate'), numeric: true, render: (r) => (r.cafe ? rateText(tr, f, r.cafe.attachPct, r.cafe.linkedBookings, r.cafe.liveBookings) : '—') },
    { key: 'players', header: tr('ws.analytics.courts.cards.avgPlayers'), numeric: true, render: (r) => (r.court.playersAvg == null ? '—' : f.num1(r.court.playersAvg)) },
  ];
  const exportCsv = () => {
    const headers = columns.map((c) => String(c.header));
    const cells = rows.map((r) => [
      name(r.court),
      r.court.bookings,
      Math.round(r.court.bookedMinutes / 60),
      r.court.occupancyPct,
      r.court.revenueIqd,
      r.court.revPerOpenHourIqd,
      // The columns are RATES; this used to write the raw counts under the rate headers.
      r.court.cancellationRatePct,
      r.court.noShowRatePct,
      r.cafe?.attachPct ?? null,
      r.court.playersAvg,
    ]);
    downloadCsv(`${file}.csv`, toCsv(headers, cells));
  };
  return (
    <CardShell
      title={tr('ws.analytics.courts.cards.courtTable')}
      tip={tip}
      state={state}
      refreshing={refreshing}
      emptyKey="ws.analytics.courts.empty.bookings"
      actions={state === 'ready' ? <Button kind="ghost" size="sm" icon="fileText" aria-label={tr('ws.analytics.twin.csv')} onClick={exportCsv} /> : undefined}
      skeletonLines={4}
    >
      <DataTable<CourtTableRow>
        columns={columns}
        rows={[...rows]}
        rowKey={(r) => r.court.courtId}
        selectedKey={selectedCourtId ?? undefined}
        dense
        maxBlockSize="28rem"
        aria-label={tr('ws.analytics.courts.cards.courtTable')}
      />
    </CardShell>
  );
}
