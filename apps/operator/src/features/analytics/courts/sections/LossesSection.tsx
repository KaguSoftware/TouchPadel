/** 06 Losses: where cancellations and no-shows cluster. Two series on the fixed hue pair, legends always present. */
import { useLocale } from '../../../../lib/i18n';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { ShareBars } from '../../charts/ShareBars';
import { StackedBars } from '../../charts/StackedBars';
import { barTwin, seriesTwin } from '../../charts/twins';
import { ZoneGrid } from '../../Zone';
import { weekdayName } from '../../copy';
import { segmentLabel, shortBucket } from '../copy';
import { StatPair } from '../cards/StatPair';
import { spanText } from '../format';
import type { EndingGroup, Segment } from '../shape';
import type { SectionProps } from './types';

function join(cancel: readonly Segment[], noShow: readonly Segment[], keys: readonly string[], label: (k: string) => string) {
  const c = new Map(cancel.map((s) => [s.key, s.n]));
  const n = new Map(noShow.map((s) => [s.key, s.n]));
  return keys.map((k) => ({ label: label(k), cancelled: c.get(k) ?? 0, noShow: n.get(k) ?? 0 }));
}

export function LossesSection({ raw, state, refreshing, f, rangeLabel }: SectionProps) {
  const { tr } = useLocale();
  const e = raw?.endings;
  const empty = state === 'ready' && ((e?.cancellations.total ?? 0) + (e?.noShows.total ?? 0) === 0);
  const series = [
    { key: 'cancelled', name: tr('ws.analytics.courts.series.cancelled') },
    { key: 'noShow', name: tr('ws.analytics.courts.series.noShow') },
  ];
  const hours = Array.from({ length: 24 }, (_, h) => String(h));
  const byHour = e ? join(e.cancellations.byHour, e.noShows.byHour, hours, (k) => f.hour(Number(k))) : [];
  const dows = ['0', '1', '2', '3', '4', '5', '6'];
  const byDow = e ? join(e.cancellations.byDow, e.noShows.byDow, dows, (k) => weekdayName(tr, Number(k)).slice(0, 3)) : [];
  const leadKeys = ['lt2h', '2_6h', '6_24h', '1_3d', '3_7d', '7d_plus'];
  const byLead = e ? join(e.cancellations.byLeadTime, e.noShows.byLeadTime, leadKeys, (k) => shortBucket(tr, 'byLeadTime', k)) : [];
  const bySource = e ? join(e.cancellations.bySource, e.noShows.bySource, ['mobile', 'desk'], (k) => segmentLabel(tr, f, 'bySource', k)) : [];
  const byType = e ? join(e.cancellations.byType, e.noShows.byType, ['returning', 'new', 'unidentified'], (k) => segmentLabel(tr, f, 'byType', k)) : [];
  const noticeRows = (e?.cancellations.byNotice ?? []).map((b) => ({ label: shortBucket(tr, 'byNotice', b.bucket), value: b.n }));
  const actors = (e?.cancellations.byActor ?? []).map((a) => ({ key: a.actor, label: tr(`ws.analytics.courts.series.${a.actor}`), value: a.n }));
  const stacked = (title: string, tip: string, rows: ReturnType<typeof join>, file: string, height = 200, tickFontSize = 11) => (
    <ChartCard
      title={title}
      tip={tip}
      state={empty ? 'empty' : state}
      refreshing={refreshing}
      emptyKey="ws.analytics.courts.empty.losses"
      height={height}
      twin={seriesTwin(rows, title, series, `${file}-${rangeLabel}`)}
    >
      <StackedBars rows={rows} series={series} format={(n) => f.num(n)} tickFontSize={tickFontSize} interval={tickFontSize < 11 ? 1 : 0} />
    </ChartCard>
  );
  const g = (x: EndingGroup | undefined) => x;
  return (
    <>
      <ZoneGrid columns={2}>
        {stacked(tr('ws.analytics.courts.cards.lossByHour'), tr('ws.analytics.courts.tips.losses'), byHour, 'losses-by-hour', 200, 10)}
        {stacked(tr('ws.analytics.courts.cards.lossByLead'), tr('ws.analytics.courts.tips.losses'), byLead, 'losses-by-lead', 200)}
      </ZoneGrid>
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        <ZoneGrid columns={3}>
          <ChartCard
            title={tr('ws.analytics.courts.cards.notice')}
            tip={tr('ws.analytics.courts.tips.notice')}
            note={g(e?.cancellations)?.medianNoticeMin != null ? `${tr('ws.analytics.courts.cards.medianNotice')}: ${spanText(tr, f, e?.cancellations.medianNoticeMin ?? 0)}` : undefined}
            state={state === 'ready' && (e?.cancellations.total ?? 0) === 0 ? 'empty' : state}
            refreshing={refreshing}
            emptyKey="ws.analytics.courts.empty.losses"
            height={180}
            twin={barTwin(noticeRows, tr('ws.analytics.courts.cards.notice'), tr('ws.analytics.courts.units.cancellations'), `cancellation-notice-${rangeLabel}`)}
          >
            <CountBars rows={noticeRows} format={(n) => f.num(n)} name={tr('ws.analytics.courts.units.cancellations')} />
          </ChartCard>
          <StatPair
            title={tr('ws.analytics.courts.cards.lossByWho')}
            tip={tr('ws.analytics.courts.tips.lossByWho')}
            state={state === 'ready' && (e?.cancellations.total ?? 0) === 0 ? 'empty' : state}
            refreshing={refreshing}
            emptyKey="ws.analytics.courts.empty.losses"
            items={[
              { label: tr('ws.analytics.courts.cards.lateRevenue'), value: f.money(e?.cancellations.lateRevenueIqd ?? 0) },
              { label: tr('ws.analytics.courts.units.cancellations'), value: f.num(e?.cancellations.total ?? 0) },
            ]}
            note={actors.length > 0 ? <ShareBars segments={actors} format={(n) => f.num(n)} pct={(n) => f.pct(n)} /> : undefined}
          />
          {stacked(tr('ws.analytics.courts.cards.lossByWeekday'), tr('ws.analytics.courts.tips.losses'), byDow, 'losses-by-weekday', 180)}
        </ZoneGrid>
      </div>
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        <ZoneGrid columns={2}>
          {stacked(tr('ws.analytics.courts.cards.lossBySource'), tr('ws.analytics.courts.tips.losses'), bySource, 'losses-by-channel', 160)}
          {stacked(tr('ws.analytics.courts.cards.lossByType'), tr('ws.analytics.courts.tips.returning'), byType, 'losses-by-guest-type', 160)}
        </ZoneGrid>
      </div>
    </>
  );
}
