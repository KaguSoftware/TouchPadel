/**
 * Court players at the cafe: what bookings buy, from tabs the till linked to
 * a booking (the attach rate is a business metric — it measures the till
 * habit as much as the guests). What each court orders and the court-plus-cafe
 * value of an hour stay open; the six refinements fold behind "Show more".
 *
 * With no linked tab at all the section used to print the same two-sentence
 * explanation in all nine cards. It says it once now, in one card, and the
 * section's sentence says how many bookings are waiting for a link.
 */
import { useState } from 'react';
import { MIN_RATE_DENOM, pickLocale } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { Select, card } from '../../../../components/ui';
import { DataTable, type Column } from '../../../../components/kit';
import { CardShell } from '../../cards/CardShell';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { HBarChart } from '../../charts/HBarChart';
import { ShareBars } from '../../charts/ShareBars';
import { StackedBars } from '../../charts/StackedBars';
import { WeekHeatmap } from '../../charts/WeekHeatmap';
import { barTwin, heatTwin, seriesTwin } from '../../charts/twins';
import { MoreCharts, ZoneGrid } from '../../Zone';
import { CHART_COURTS, topRows } from '../courtRows';
import { weekdayName } from '../../copy';
import type { CourtItemRow } from '../shape';
import { spanText } from '../format';
import type { SectionProps } from './types';

const TIMING_LABEL: Record<string, 'before30' | 'before0' | 'firstHalf' | 'secondHalf' | 'after0' | 'after30'> = {
  before_30plus: 'before30',
  before_0_30: 'before0',
  first_half: 'firstHalf',
  second_half: 'secondHalf',
  after_0_30: 'after0',
  after_30plus: 'after30',
};

export function CrossSection({ raw, state, refreshing, f, rangeLabel, selectedCourtId }: SectionProps & { selectedCourtId: string | null }) {
  const { tr, locale } = useLocale();
  const cafe = raw?.cafe;
  const courts = raw?.summary.perCourt ?? [];
  const name = (c: { nameEn: string; nameAr: string; courtId: string }) => pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.courtId;
  const noLinks = state === 'ready' && (cafe?.attach.liveBookings ?? 0) > 0 && (cafe?.attach.linkedBookings ?? 0) === 0;
  const noBookings = state === 'ready' && (cafe?.attach.liveBookings ?? 0) === 0;
  const cardState = noBookings ? 'empty' : noLinks ? 'empty' : state;
  const emptyKey = noBookings ? 'ws.analytics.courts.empty.bookings' : 'ws.analytics.cross.empty.noLinks';
  const attachAll = (cafe?.perCourt ?? []).map((c) => ({ label: name(c), value: c.attachPct ?? 0, highlight: c.courtId === selectedCourtId }));
  const spendAll = (cafe?.perCourt ?? []).map((c) => ({ label: name(c), value: c.cafePerLinkedIqd ?? 0, highlight: c.courtId === selectedCourtId }));
  const attachRows = topRows(attachAll);
  const spendRows = topRows(spendAll);
  const perCourtCapped = (cafe?.perCourt.length ?? 0) > CHART_COURTS ? tr('ws.analytics.courts.cards.topCourts', { n: f.num(CHART_COURTS), total: f.num(cafe?.perCourt.length ?? 0) }) : undefined;
  const timing = (cafe?.orderTiming.buckets ?? []).map((b) => ({ key: b.bucket, label: tr(`ws.analytics.courts.buckets.timing.${TIMING_LABEL[b.bucket] ?? 'firstHalf'}`), value: b.orders }));
  const valueSeries = [
    { key: 'courtFee', name: tr('ws.analytics.courts.series.courtFee') },
    { key: 'cafe', name: tr('ws.analytics.courts.series.cafe') },
  ];
  const valueAll = (cafe?.perCourt ?? []).map((c) => ({
    label: name(c),
    courtFee: c.bookedMinutes > 0 ? Math.round((c.courtIqd * 60) / c.bookedMinutes) : 0,
    cafe: c.bookedMinutes > 0 ? Math.round((c.cafeIqd * 60) / c.bookedMinutes) : 0,
  }));
  const valueRows = valueAll.length > CHART_COURTS ? [...valueAll].sort((a, b) => b.courtFee + b.cafe - (a.courtFee + a.cafe)).slice(0, CHART_COURTS) : valueAll;
  // Twenty-booking floor: a cell or group under it is muted and reads as "n of N".
  const nOfN = (n: number, total: number) => tr('ws.analytics.courts.kpi.nOfN', { n: f.num(n), total: f.num(total) });
  const attachCells = (cafe?.attachCells ?? []).map((c) => ({
    dow: c.dow,
    hour: c.hour,
    value: c.liveBookings > 0 ? (c.linkedBookings / c.liveBookings) * 100 : 0,
    thin: c.liveBookings < MIN_RATE_DENOM,
    label: nOfN(c.linkedBookings, c.liveBookings),
  }));
  const playersRows = (cafe?.byPlayers ?? []).map((p) => ({
    label: p.players == null ? tr('ws.analytics.courts.buckets.players.unknown') : p.players === 1 ? tr('ws.analytics.courts.buckets.players.one') : tr('ws.analytics.courts.buckets.players.n', { n: f.num(p.players) }),
    value: p.linked > 0 ? Math.round(p.cafeIqd / p.linked) : 0,
    thin: p.linked < MIN_RATE_DENOM,
    linked: p.linked,
  }));
  const durationRows = (cafe?.byDuration ?? []).map((d) => ({
    label: tr('ws.analytics.courts.buckets.duration', { n: f.num(d.durationMin) }),
    value: d.linked > 0 ? Math.round(d.cafeIqd / d.linked) : 0,
    thin: d.linked < MIN_RATE_DENOM,
    linked: d.linked,
  }));
  const spendTwin = (rows: readonly { label: string; value: number; linked: number }[], labelHeader: string, file: string) => ({
    columns: [
      { key: 'label', label: labelHeader },
      { key: 'value', label: tr('ws.analytics.cross.perLinked'), numeric: true },
      { key: 'linked', label: tr('ws.analytics.courts.units.bookings'), numeric: true },
    ],
    rows: rows.map((r) => ({ label: r.label, value: r.value, linked: r.linked })),
    file,
  });

  const [orderCourt, setOrderCourt] = useState<string>('');
  // Open on the court whose players ordered the most, not on whichever court sorts first.
  const busiestCourt = [...(cafe?.topItems ?? [])].reduce<Map<string, number>>((m, i) => m.set(i.courtId, (m.get(i.courtId) ?? 0) + i.qty), new Map());
  const defaultCourt = [...busiestCourt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const courtForOrders = orderCourt || selectedCourtId || defaultCourt || courts[0]?.courtId || '';
  const items: CourtItemRow[] = (cafe?.topItems ?? []).filter((i) => i.courtId === courtForOrders).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const itemColumns: Column<CourtItemRow>[] = [
    { key: 'item', header: tr('analytics.cards.bestSellers'), render: (r) => pickLocale({ en: r.nameEn, ar: r.nameAr }, locale) || r.itemId, truncate: true },
    { key: 'qty', header: tr('analytics.cards.quantity'), numeric: true, render: (r) => f.num(r.qty) },
    { key: 'orders', header: tr('ws.analytics.courts.units.orders'), numeric: true, render: (r) => f.num(r.linkedOrdersWithItem) },
    { key: 'revenue', header: tr('analytics.cards.revenue'), numeric: true, render: (r) => f.money(r.revenueIqd) },
  ];

  if (noLinks || noBookings) {
    return (
      <p style={{ ...card, margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(emptyKey)}</p>
    );
  }

  return (
    <>
      <ZoneGrid columns={2}>
        <CardShell
          title={tr('ws.analytics.cross.courtOrders')}
          tip={tr('ws.analytics.cross.tips.courtOrders')}
          state={cardState === 'ready' && items.length === 0 ? 'empty' : cardState}
          refreshing={refreshing}
          emptyKey={cardState === 'ready' && !noLinks && !noBookings ? 'ws.analytics.cross.empty.items' : emptyKey}
          actions={
            courts.length > 1 ? (
              <Select<string>
                value={courtForOrders}
                onChange={setOrderCourt}
                options={courts.map((c) => ({ value: c.courtId, label: name(c) }))}
                aria-label={tr('ws.reports.filters.court')}
                style={{ fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1)' }}
              />
            ) : undefined
          }
        >
          <DataTable<CourtItemRow> columns={itemColumns} rows={items} rowKey={(r) => r.itemId} dense aria-label={tr('ws.analytics.cross.courtOrders')} />
        </CardShell>
        <ChartCard
          title={tr('ws.analytics.cross.valuePerHour')}
          tip={tr('ws.analytics.cross.tips.valuePerHour')}
          state={cardState}
          refreshing={refreshing}
          emptyKey={emptyKey}
          note={perCourtCapped}
          height={220}
          twin={seriesTwin(valueAll, tr('ws.reports.filters.court'), valueSeries, `value-per-booked-hour-${rangeLabel}`)}
        >
          <StackedBars rows={valueRows} series={valueSeries} format={(n) => f.compact(n)} />
        </ChartCard>
      </ZoneGrid>
      <MoreCharts id="courts-cafe" count={state === 'ready' ? 6 : 0}>
        <ZoneGrid columns={2}>
          <ChartCard
            title={tr('ws.analytics.cross.attachByCourt')}
            tip={tr('ws.analytics.cross.tips.attachByCourt')}
            state={cardState}
            refreshing={refreshing}
            emptyKey={emptyKey}
            note={perCourtCapped}
            height={Math.max(120, 40 * attachRows.length + 40)}
            twin={barTwin(attachAll, tr('ws.reports.filters.court'), tr('ws.analytics.courts.kpi.attachRate'), `attach-by-court-${rangeLabel}`)}
          >
            <HBarChart rows={attachRows} format={(n) => f.pct(n)} name={tr('ws.analytics.courts.kpi.attachRate')} axisWidth={110} />
          </ChartCard>
          <ChartCard
            title={tr('ws.analytics.cross.spendPerBooking')}
            tip={tr('ws.analytics.cross.tips.spendPerBooking')}
            state={cardState}
            refreshing={refreshing}
            emptyKey={emptyKey}
            note={perCourtCapped}
            height={Math.max(120, 40 * spendRows.length + 40)}
            twin={barTwin(spendAll, tr('ws.reports.filters.court'), tr('ws.analytics.cross.spendPerBooking'), `cafe-spend-by-court-${rangeLabel}`)}
          >
            <HBarChart rows={spendRows} format={(n) => f.compact(n)} name={tr('ws.analytics.cross.spendPerBooking')} axisWidth={110} />
          </ChartCard>
        </ZoneGrid>
        <CardShell
          title={tr('ws.analytics.cross.orderTiming')}
          tip={tr('ws.analytics.cross.tips.orderTiming')}
          note={cafe?.orderTiming.medianOffsetMin != null ? `${tr('ws.analytics.courts.cards.medianOffset')}: ${spanText(tr, f, Math.abs(cafe.orderTiming.medianOffsetMin))}` : undefined}
          state={cardState === 'ready' && timing.every((t) => t.value === 0) ? 'empty' : cardState}
          refreshing={refreshing}
          emptyKey={emptyKey}
          skeletonLines={2}
        >
          <ShareBars segments={timing} format={(n) => f.num(n)} pct={(n) => f.pct(n)} />
        </CardShell>
        <ChartCard
          title={tr('ws.analytics.cross.attachBySlot')}
          tip={tr('ws.analytics.cross.tips.attachBySlot')}
          state={cardState}
          refreshing={refreshing}
          emptyKey={emptyKey}
          height={200}
          twin={heatTwin(
            [...attachCells].sort((a, b) => a.dow - b.dow || a.hour - b.hour).map((c) => ({ day: weekdayName(tr, c.dow), hour: f.hour(c.hour), value: c.thin ? c.label : Math.round(c.value) })),
            tr('ws.reports.filters.group'),
            tr('ws.analytics.courts.cards.byHour'),
            tr('ws.analytics.courts.kpi.attachRate'),
            `attach-by-slot-${rangeLabel}`,
          )}
        >
          <WeekHeatmap cells={attachCells} f={f} format={(n) => f.pct(n)} unit={tr('ws.analytics.courts.kpi.attachRate')} hint={tr('ws.analytics.heatmap.hint')} />
        </ChartCard>
        <ZoneGrid columns={2}>
          <ChartCard
            title={tr('ws.analytics.cross.spendByPlayers')}
            tip={tr('ws.analytics.cross.tips.spendByPlayers')}
            state={cardState === 'ready' && playersRows.every((r) => r.value === 0) ? 'empty' : cardState}
            refreshing={refreshing}
            emptyKey={cardState === 'ready' && !noLinks && !noBookings ? 'ws.analytics.courts.empty.players' : emptyKey}
            height={180}
            twin={spendTwin(playersRows, tr('ws.analytics.courts.cards.players'), `cafe-spend-by-players-${rangeLabel}`)}
          >
            <CountBars rows={playersRows} format={(n) => f.compact(n)} name={tr('ws.analytics.cross.perLinked')} emphasise="none" />
          </ChartCard>
          <ChartCard
            title={tr('ws.analytics.cross.spendByDuration')}
            tip={tr('ws.analytics.cross.tips.spendByDuration')}
            state={cardState}
            refreshing={refreshing}
            emptyKey={emptyKey}
            height={180}
            twin={spendTwin(durationRows, tr('ws.analytics.courts.cards.duration'), `cafe-spend-by-duration-${rangeLabel}`)}
          >
            <CountBars rows={durationRows} format={(n) => f.compact(n)} name={tr('ws.analytics.cross.perLinked')} emphasise="none" />
          </ChartCard>
        </ZoneGrid>
      </MoreCharts>
    </>
  );
}
