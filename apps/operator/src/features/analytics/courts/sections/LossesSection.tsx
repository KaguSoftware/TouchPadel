/**
 * Cancellations and no-shows. The section's sentence says how many, out of
 * what, and what became of the late ones; the three COUNT cards (notice, who
 * cancelled, after a late cancellation) stay open because a count cannot
 * overstate itself. The seven breakdowns by segment are RATES of everything
 * booked in each segment (courts/losses.ts) and fold behind "Show more": nine
 * charts at one weight read as nine findings, and on a thin month most bars
 * are one booking tall. Segments under the twenty-booking floor are muted in
 * the chart and printed as "n of N" in the table twin, so a quiet hour with
 * one cancellation never reads as a 100% problem.
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { CardShell } from '../../cards/CardShell';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { ShareBars } from '../../charts/ShareBars';
import { StackedBars } from '../../charts/StackedBars';
import { barTwin, seriesTwin } from '../../charts/twins';
import { MoreCharts, ZoneGrid } from '../../Zone';
import { CHART_COURTS } from '../courtRows';
import { noticeLabel, segmentLabel, shortBucket } from '../copy';
import { StatPair } from '../cards/StatPair';
import { rateText, spanText } from '../format';
import { lossChartRows, lossRates, segmentKeys, type LossRateRow } from '../losses';
import type { Segment } from '../shape';
import type { SectionProps } from './types';

export function LossesSection({ raw, derived, state, refreshing, f, rangeLabel }: SectionProps) {
  const { tr, locale } = useLocale();
  const e = raw?.endings;
  const empty = state === 'ready' && ((e?.cancellations.total ?? 0) + (e?.noShows.total ?? 0) === 0);
  const series = [
    { key: 'cancelled', name: tr('ws.analytics.courts.series.cancelledRate') },
    { key: 'noShow', name: tr('ws.analytics.courts.series.noShowRate') },
  ];
  // The table twin carries the rate (or "n of N" below the floor) AND the raw counts.
  const twinSeries = [
    ...series,
    { key: 'cancelledN', name: tr('ws.analytics.courts.units.cancellations') },
    { key: 'noShowN', name: tr('ws.analytics.courts.units.noShows') },
    { key: 'total', name: tr('ws.analytics.courts.units.bookings') },
  ];
  const rates = (pick: (g: NonNullable<typeof e>['cancellations']) => Segment[], keys: readonly string[], label: (k: string) => string): LossRateRow[] =>
    e ? lossRates(pick(e.cancellations), pick(e.noShows), keys, label) : [];
  const twinRows = (rows: readonly LossRateRow[]) =>
    rows.map((r) => ({
      label: r.label,
      cancelled: rateText(tr, f, r.cancelledPct, r.cancelled, r.total),
      noShow: rateText(tr, f, r.noShowPct, r.noShow, r.total),
      cancelledN: r.cancelled,
      noShowN: r.noShow,
      total: r.total,
    }));

  const hours = Array.from({ length: 24 }, (_, h) => String(h));
  const byHour = rates((g) => g.byHour, hours, (k) => f.hour(Number(k)));
  const dows = ['0', '1', '2', '3', '4', '5', '6'];
  const byDow = rates((g) => g.byDow, dows, (k) => f.weekday(Number(k)));
  const leadKeys = ['lt2h', '2_6h', '6_24h', '1_3d', '3_7d', '7d_plus'];
  const byLead = rates((g) => g.byLeadTime, leadKeys, (k) => shortBucket(tr, 'byLeadTime', k));
  const bySource = rates((g) => g.bySource, ['mobile', 'desk'], (k) => segmentLabel(tr, f, 'bySource', k));
  const byType = rates((g) => g.byType, ['returning', 'new', 'unidentified'], (k) => segmentLabel(tr, f, 'byType', k));
  const courtKeys = (raw?.summary.perCourt ?? []).map((c) => c.courtId);
  const courtName = (id: string) => {
    const c = derived?.courtNames.get(id);
    return c ? pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || id : id;
  };
  const byCourtAll = rates((g) => g.byCourt.map((s) => ({ ...s, key: s.courtId ?? s.key })), courtKeys, courtName);
  // Past a dozen courts the chart keeps the courts that lost the most; the table twin keeps every court.
  const byCourt = byCourtAll.length > CHART_COURTS ? [...byCourtAll].sort((a, b) => b.cancelled + b.noShow - (a.cancelled + a.noShow)).slice(0, CHART_COURTS) : byCourtAll;
  const durationKeys = e ? segmentKeys(e.cancellations.byDuration, e.noShows.byDuration).sort((a, b) => Number(a) - Number(b)) : [];
  const byDuration = rates((g) => g.byDuration, durationKeys, (k) => tr('ws.analytics.courts.buckets.duration', { n: f.num(Number(k)) }));

  const noticeRows = (e?.cancellations.byNotice ?? []).map((b) => ({ label: noticeLabel(tr, f, b), value: b.n, highlight: b.policyEdge }));
  const actors = (e?.cancellations.byActor ?? []).map((a) => ({ key: a.actor, label: tr(`ws.analytics.courts.series.${a.actor}`), value: a.n }));
  const noCancellations = state === 'ready' && (e?.cancellations.total ?? 0) === 0;

  const stacked = (title: string, tip: string, rows: readonly LossRateRow[], file: string, height = 200, tickFontSize = 11, twinFrom: readonly LossRateRow[] = rows, note?: string) => (
    <ChartCard
      title={title}
      tip={tip}
      note={note}
      state={empty ? 'empty' : state}
      refreshing={refreshing}
      emptyKey="ws.analytics.courts.empty.losses"
      height={height}
      twin={seriesTwin(twinRows(twinFrom), title, twinSeries, `${file}-${rangeLabel}`)}
    >
      <StackedBars rows={lossChartRows(rows)} series={series} thinKey="thin" format={(n) => f.pct(n)} tickFontSize={tickFontSize} interval={tickFontSize < 11 ? 1 : 0} />
    </ChartCard>
  );
  return (
    <>
      <ZoneGrid columns={3}>
        <ChartCard
          title={tr('ws.analytics.courts.cards.notice')}
          tip={tr('ws.analytics.courts.tips.notice')}
          note={e?.cancellations.medianNoticeMin != null ? `${tr('ws.analytics.courts.cards.medianNotice')}: ${spanText(tr, f, e.cancellations.medianNoticeMin)}` : undefined}
          state={noCancellations ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.losses"
          height={180}
          twin={barTwin(noticeRows, tr('ws.analytics.courts.cards.notice'), tr('ws.analytics.courts.units.cancellations'), `cancellation-notice-${rangeLabel}`)}
        >
          <CountBars rows={noticeRows} format={(n) => f.num(n)} name={tr('ws.analytics.courts.units.cancellations')} emphasise="rows" />
        </ChartCard>
        <CardShell
          title={tr('ws.analytics.courts.cards.lossByWho')}
          tip={tr('ws.analytics.courts.tips.lossByWho')}
          state={noCancellations ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.losses"
          skeletonLines={2}
          note={
            e && !noCancellations
              ? tr('ws.analytics.courts.cards.whoCounts', { slotDay: f.num(e.cancellations.total), inPeriod: f.num(e.cancellations.cancelledInPeriod.n) })
              : undefined
          }
        >
          <ShareBars segments={actors} format={(n) => f.num(n)} pct={(n) => f.pct(n)} />
        </CardShell>
        <StatPair
          title={tr('ws.analytics.courts.cards.afterLate')}
          tip={tr('ws.analytics.courts.tips.afterLate', { window: spanText(tr, f, e?.policyWindowMin ?? 0) })}
          state={state === 'ready' && (e?.cancellations.resold.cancelled ?? 0) === 0 ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.lateCancellations"
          items={[
            { label: tr('ws.analytics.courts.cards.resold'), value: f.num(e?.cancellations.resold.resoldN ?? 0), sub: f.money(e?.cancellations.resold.recoveredIqd ?? 0) },
            { label: tr('ws.analytics.courts.cards.leftEmpty'), value: f.num(e?.cancellations.resold.emptyN ?? 0), sub: f.money(e?.cancellations.resold.lostIqd ?? 0) },
            { label: tr('ws.analytics.courts.cards.lateRevenue'), value: f.money(e?.cancellations.lateRevenueIqd ?? 0) },
          ]}
        />
      </ZoneGrid>
      <MoreCharts id="courts-losses" count={empty ? 0 : 7}>
        <ZoneGrid columns={2}>
          {stacked(tr('ws.analytics.courts.cards.lossByHour'), tr('ws.analytics.courts.tips.losses'), byHour, 'losses-by-hour', 200, 10)}
          {stacked(tr('ws.analytics.courts.cards.lossByLead'), tr('ws.analytics.courts.tips.losses'), byLead, 'losses-by-lead', 200)}
          {stacked(tr('ws.analytics.courts.cards.lossByWeekday'), tr('ws.analytics.courts.tips.losses'), byDow, 'losses-by-weekday', 180)}
          {stacked(
            tr('ws.analytics.courts.cards.lossByCourt'),
            tr('ws.analytics.courts.tips.losses'),
            byCourt,
            'losses-by-court',
            180,
            11,
            byCourtAll,
            byCourtAll.length > CHART_COURTS ? tr('ws.analytics.courts.cards.topCourtsLosses', { n: f.num(CHART_COURTS), total: f.num(byCourtAll.length) }) : undefined,
          )}
        </ZoneGrid>
        <ZoneGrid columns={3}>
          {stacked(tr('ws.analytics.courts.cards.lossBySource'), tr('ws.analytics.courts.tips.losses'), bySource, 'losses-by-channel', 160)}
          {stacked(tr('ws.analytics.courts.cards.lossByType'), tr('ws.analytics.courts.tips.returning'), byType, 'losses-by-guest-type', 160)}
          {stacked(tr('ws.analytics.courts.cards.lossByDuration'), tr('ws.analytics.courts.tips.losses'), byDuration, 'losses-by-length', 160)}
        </ZoneGrid>
      </MoreCharts>
    </>
  );
}
