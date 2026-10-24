/**
 * `/insights` — the marketing role's view of the whole place (0360).
 *
 * Majed, 2026-10-22: marketing needs the performance of the entire place,
 * "just enough to tailor the strategy", with as few exact numbers as possible,
 * and on the same UI as the Analytics page. So this page wears Analytics' own
 * frame: the sticky bar (period, comparison, section jump-nav), the zones with
 * their answer sentence first, and the Breakdown cards in sideways rows.
 *
 * What differs is what it prints. One read, app.marketing_insights, runs the
 * owner's analytics server side and hands back only levels (Empty .. Full),
 * trends (Up, Steady, Down), rounded shares ("about a third") and "about N"
 * counts ("a few" under ten), plus ranked hours and names. No money figure and
 * no exact count reaches this page, so none can be printed by mistake; the
 * exact figures stay on the owner's Analytics page.
 *
 * What the system does not record (social posts, referrals, walk-ins,
 * reviews) is said once, plainly, under "How they book", instead of being
 * guessed.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { LONG_REQUEST_TIMEOUT_MS, businessTodayISO, normalizeBusinessDayStart, resolveCompare, resolveRange } from '@touch/core';
import { VENUE_TZ, formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useCafeSettings } from '../../lib/settings';
import { StatusBadge } from '../../components/kit';
import { AnalyticsBar } from '../analytics/AnalyticsBar';
import { AnalyticsFrame } from '../analytics/AnalyticsFrame';
import { Notices, type Notice } from '../analytics/Notices';
import { Zone, ZoneGrid, ZoneRow, type ZoneDef } from '../analytics/Zone';
import { CardShell, type CardState } from '../analytics/cards/CardShell';
import { StatPair } from '../analytics/courts/cards/StatPair';
import { ChartCard } from '../analytics/charts/ChartCard';
import { ShareBars } from '../analytics/charts/ShareBars';
import { WeekHeatmap } from '../analytics/charts/WeekHeatmap';
import { weekdayName } from '../analytics/copy';
import { makeFormatters, type Formatters } from '../analytics/format';
import type { AnalyticsSearch } from '../analytics/search';
import {
  allUnknown,
  demandAdvice,
  heatCells,
  levelKey,
  parseInsights,
  shareWord,
  trendSize,
  trendTone,
  type BucketShare,
  type Count,
  type Insights,
  type Level,
  type Named,
  type Slot,
  type Trend,
} from './insightsLogic';

export const INSIGHT_ZONES: readonly ZoneDef[] = [
  { id: 'glance', titleKey: 'ws.insights.zones.glance', descKey: 'ws.insights.zones.glanceDesc' },
  { id: 'people', titleKey: 'ws.insights.zones.people', descKey: 'ws.insights.zones.peopleDesc', navKey: 'ws.insights.zones.peopleNav' },
  { id: 'when', titleKey: 'ws.insights.zones.when', descKey: 'ws.insights.zones.whenDesc', navKey: 'ws.insights.zones.whenNav' },
  { id: 'players', titleKey: 'ws.insights.zones.players', descKey: 'ws.insights.zones.playersDesc', navKey: 'ws.insights.zones.playersNav' },
  { id: 'channels', titleKey: 'ws.insights.zones.channels', descKey: 'ws.insights.zones.channelsDesc', navKey: 'ws.insights.zones.channelsNav' },
  { id: 'offers', titleKey: 'ws.insights.zones.offers', descKey: 'ws.insights.zones.offersDesc' },
  { id: 'cafe', titleKey: 'ws.insights.zones.cafe', descKey: 'ws.insights.zones.cafeDesc', navKey: 'ws.insights.zones.cafeNav' },
  { id: 'events', titleKey: 'ws.insights.zones.events', descKey: 'ws.insights.zones.eventsDesc', navKey: 'ws.insights.zones.eventsNav' },
  { id: 'mix', titleKey: 'ws.insights.zones.mix', descKey: 'ws.insights.zones.mixDesc', navKey: 'ws.insights.zones.mixNav' },
];

const VISIT_BUCKETS = ['1', '2_3', '4_6', '7_plus'] as const;
// 0369: the people buckets, in the order the cards print them. The server
// leaves out any bucket under ten guests, so a row may simply be absent.
const GENDER_BUCKETS = ['female', 'male', 'unknown'] as const;
const AGE_BUCKETS = ['u18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'unknown'] as const;
const LEVEL_BUCKETS = ['new', 'beginner', 'intermediate', 'advanced', 'unknown'] as const;
const INTEREST_BUCKETS = [
  'courts', 'matches', 'tournaments', 'lessons', 'cafe', 'shop', 'regular',
  'weekend', 'evenings', 'daytime', 'late', 'group', 'offers', 'ranked',
] as const;
const LEAD_BUCKETS = ['lt2h', '2_6h', '6_24h', '1_3d', '3_7d', '7d_plus'] as const;

/** The words this page prints, bound to the locale once. */
function useWords(f: Formatters) {
  const { tr, locale } = useLocale();
  return useMemo(() => {
    const unknown = tr('ws.insights.unknown');
    const sized = (t: Trend, kind: 'trend' | 'trendLine') => {
      const size = trendSize(t);
      if (!size || t.dir === 'unknown') return tr(`ws.insights.${kind}.${t.dir}`);
      const text =
        size.kind === 'times'
          ? tr('ws.insights.size.times', { n: f.num(size.n) })
          : size.kind === 'pts'
            ? tr('ws.insights.size.pts', { n: t.dir === 'steady' ? f.num(t.size ?? 0) : f.num(size.n) })
            : t.dir === 'steady'
              ? f.signedPct(t.size ?? 0)
              : f.pct(size.n);
      const signed = size.kind === 'pts' && t.dir === 'steady' && (t.size ?? 0) > 0 ? `+${text}` : text;
      return tr(`ws.insights.${kind}Sized.${t.dir}`, { size: signed });
    };
    return {
      tr,
      locale,
      unknown,
      level: (l: Level | null) => {
        const k = levelKey(l);
        return k ? tr(`ws.insights.levels.${k}`) : unknown;
      },
      /** "Up 18%", "Down 6 pts", "Steady (+3%)": the word, and how far (0365). */
      trend: (t: Trend) => sized(t, 'trend'),
      /** "Up 18% on the comparison". */
      trendLine: (t: Trend) => sized(t, 'trendLine'),
      /** "Busy (68%)": the level, and the fill as a percent (0365). */
      levelPct: (l: Level | null, pct: number | null) => {
        const k = levelKey(l);
        if (!k) return unknown;
        return pct === null ? tr(`ws.insights.levels.${k}`) : tr('ws.insights.levelPct', { level: tr(`ws.insights.levels.${k}`), pct: f.pct(pct) });
      },
      count: (c: Count) =>
        c === null ? unknown : c.kind === 'about' ? tr('ws.insights.count.about', { n: formatNumber(c.value, locale) }) : tr(`ws.insights.count.${c.kind}`),
      /** A share as its percent (0365, Majed: "how much this, how much that"). */
      share: (s: number | null) => (s === null ? unknown : f.pct(s)),
      /** The same share as plain words, beside its percent in the share bars' legend. */
      shareWords: (s: number | null) => {
        const w = shareWord(s);
        return w ? tr(`ws.insights.share.${w}`) : unknown;
      },
      slot: (s: Slot) => tr('ws.insights.slot', { day: weekdayName(tr, s.dow), hour: f.hour(s.hour) }),
      name: (n: Named) => (locale === 'ar' ? n.nameAr || n.nameEn : n.nameEn || n.nameAr),
    };
  }, [tr, locale, f]);
}
type Words = ReturnType<typeof useWords>;

/** A sentence's inner share, lower-cased where the language has case ("about a third of …"). */
function inner(text: string, locale: string): string {
  return locale === 'en' ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

export function InsightsPageScreen() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/insights' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const w = useWords(f);

  // The business day the period counts back from, as on Analytics.
  const settings = useCafeSettings();
  const startHour = normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour);
  const todayISO = businessTodayISO(new Date(), startHour, VENUE_TZ);
  const range = useMemo(() => resolveRange({ range: search.range, from: search.from, to: search.to }, todayISO).range, [search.range, search.from, search.to, todayISO]);
  const compare = useMemo(() => resolveCompare(search.cmp, range, { from: search.cmpFrom, to: search.cmpTo }), [search.cmp, search.cmpFrom, search.cmpTo, range]);

  const q = useQuery({
    queryKey: ['insights', range.from, range.to, compare.range.from, compare.range.to],
    queryFn: () =>
      appRpc<unknown>(
        'marketing_insights',
        { p_from: range.from, p_to: range.to, p_cmp_from: compare.range.from, p_cmp_to: compare.range.to },
        { timeoutMs: LONG_REQUEST_TIMEOUT_MS },
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const data = useMemo(() => (q.data === undefined ? null : parseInsights(q.data)), [q.data]);
  const state: CardState = q.isPending ? 'loading' : q.isError && !data ? 'error' : 'ready';
  const refreshing = q.isFetching && !q.isPending;
  const common = { state, refreshing, error: q.error, onRetry: () => void q.refetch() };

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/insights', search: { ...search, ...next } });
  };

  const notices: Notice[] = [];
  if (data?.legacy) notices.push({ key: 'legacy', text: tr('ws.insights.notices.legacy') });

  const zone = (id: string): ZoneDef => INSIGHT_ZONES.find((z) => z.id === id)!;
  const lead = (build: (d: Insights) => string | null) => (data && state === 'ready' ? build(data) : null);

  return (
    <AnalyticsFrame title={tr('ws.insights.title')} subtitle={tr('ws.insights.period', { range: f.dateRange(range.from, range.to), compare: f.dateRange(compare.range.from, compare.range.to) })}>
      <AnalyticsBar search={search} setSearch={setSearch} zones={INSIGHT_ZONES} compareBasis={compare.basis} compareRange={compare.range} />
      <Notices notices={notices} />

      <Zone zone={zone('glance')} lead={lead((d) => glanceLead(d, w))}>
        <GlanceRow d={data} w={w} common={common} />
      </Zone>

      <Zone zone={zone('people')} lead={lead((d) => peopleLead(d, w))}>
        <PeopleSection d={data} w={w} f={f} common={common} />
      </Zone>

      <Zone zone={zone('when')} lead={lead((d) => whenLead(d, w))}>
        <WhenSection d={data} w={w} f={f} common={common} />
      </Zone>

      <Zone zone={zone('players')} lead={lead((d) => playersLead(d, w))}>
        <PlayersSection d={data} w={w} f={f} common={common} />
      </Zone>

      <Zone zone={zone('channels')} lead={lead((d) => channelsLead(d, w))}>
        <ChannelsSection d={data} w={w} f={f} common={common} />
      </Zone>

      <Zone zone={zone('offers')} lead={lead((d) => offersLead(d, w))}>
        <OffersCard d={data} w={w} common={common} />
      </Zone>

      <Zone zone={zone('cafe')} lead={lead((d) => cafeLead(d, w))}>
        <CafeSection d={data} w={w} f={f} common={common} />
      </Zone>

      <Zone zone={zone('events')} lead={lead((d) => eventsLead(d, w))}>
        <EventsSection d={data} w={w} f={f} common={common} />
      </Zone>

      <Zone zone={zone('mix')} lead={lead((d) => mixLead(d, w))}>
        <MixSection d={data} w={w} f={f} common={common} />
      </Zone>
    </AnalyticsFrame>
  );
}

// ---------------------------------------------------------------------------
// The answer sentences
// ---------------------------------------------------------------------------

function glanceLead(d: Insights, w: Words): string {
  return w.tr('ws.insights.leads.glance', {
    level: inner(w.levelPct(d.demand.level, d.demand.levelPct), w.locale),
    players: inner(w.count(d.players.active), w.locale),
    crossover: inner(w.share(d.cafe.crossoverShare), w.locale),
  });
}

/**
 * "Most of the crowd is women, 25 to 34, playing at an intermediate level" —
 * built from the biggest bucket of each kind, and honest when the club knows
 * too little to say (0369, Majed: the marketing team needs this).
 */
function peopleLead(d: Insights, w: Words): string {
  const p = d.people;
  const biggest = (rows: readonly BucketShare[]) =>
    rows.filter((r) => r.bucket !== 'unknown' && r.share !== null).sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0] ?? null;
  const g = biggest(p.genders);
  const a = biggest(p.ages);
  const l = biggest(p.levels);
  if (!g && !a && !l) return w.tr('ws.insights.leads.peopleThin');
  const parts = [
    g ? w.tr('ws.insights.leads.peopleGender', { who: w.tr(`ws.insights.people.gender.${g.bucket}` as never), share: w.share(g.share) }) : null,
    a ? w.tr('ws.insights.leads.peopleAge', { band: w.tr(`ws.insights.people.age.${a.bucket}` as never) }) : null,
    l ? w.tr('ws.insights.leads.peopleLevel', { level: w.tr(`ws.insights.people.level.${l.bucket}` as never) }) : null,
  ].filter(Boolean) as string[];
  const sentence = parts.join(w.locale === 'ar' ? '، ' : ', ');
  return p.coveragePct === null
    ? sentence
    : `${sentence} ${w.tr('ws.insights.leads.peopleCoverage', { pct: w.share(p.coveragePct) })}`;
}

function whenLead(d: Insights, w: Words): string {
  const list = (s: readonly Slot[]) => s.map(w.slot).join(w.locale === 'ar' ? '، ' : ', ');
  switch (demandAdvice(d.demand)) {
    case 'both':
      return w.tr('ws.insights.leads.both', { quiet: list(d.demand.quiet), full: list(d.demand.full) });
    case 'fillQuiet':
      return w.tr('ws.insights.leads.fillQuiet', { slots: list(d.demand.quiet) });
    case 'protectFull':
      return w.tr('ws.insights.leads.protectFull', { slots: list(d.demand.full) });
    default:
      return w.tr('ws.insights.leads.none');
  }
}

function playersLead(d: Insights, w: Words): string {
  if (d.players.returningShare === null) return w.tr('ws.insights.leads.playersThin');
  if (d.players.lapsing?.kind === 'none') return w.tr('ws.insights.leads.playersNoLapsing', { returning: w.share(d.players.returningShare) });
  return w.tr('ws.insights.leads.players', { returning: w.share(d.players.returningShare), lapsing: inner(w.count(d.players.lapsing), w.locale) });
}

function channelsLead(d: Insights, w: Words): string {
  if (d.channels.appShare === null) return w.tr('ws.insights.leads.channelsThin');
  if (d.channels.appShare === 0) return w.tr('ws.insights.leads.channelsAllDesk');
  if (d.channels.appShare === 100) return w.tr('ws.insights.leads.channelsAllApp');
  return w.tr('ws.insights.leads.channels', { app: w.share(d.channels.appShare) });
}

function offersLead(d: Insights, w: Words): string {
  const top = d.offers.find((o) => o.verdict !== 'unused');
  return top ? w.tr('ws.insights.leads.offers', { name: w.name(top) }) : w.tr('ws.insights.leads.offersNone');
}

function cafeLead(d: Insights, w: Words): string {
  if (d.cafe.crossoverShare === null || d.cafe.top.length === 0) return w.tr('ws.insights.leads.cafeThin');
  return w.tr('ws.insights.leads.cafe', { crossover: w.share(d.cafe.crossoverShare), top: w.name(d.cafe.top[0]!) });
}

function eventsLead(d: Insights, w: Words): string {
  if (!d.events.held) return w.tr('ws.insights.leads.eventsNone');
  return w.tr('ws.insights.leads.events', { fill: inner(w.levelPct(d.events.fillLevel, d.events.fillPct), w.locale), returning: inner(w.share(d.events.returningShare), w.locale) });
}

function mixLead(d: Insights, w: Words): string {
  if (d.mix.courts === null) return w.tr('ws.insights.leads.mixNone');
  return w.tr('ws.insights.leads.mix', { courts: inner(w.share(d.mix.courts), w.locale), cafe: inner(w.share(d.mix.cafe), w.locale) });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface Common {
  state: CardState;
  refreshing: boolean;
  error: unknown;
  onRetry: () => void;
}
interface SectionProps {
  d: Insights | null;
  w: Words;
  f: Formatters;
  common: Common;
}

/** A trend as a badge: the word, coloured by whether that direction is good news here. */
function TrendBadge({ t, w, upIsBad }: { t: Trend; w: Words; upIsBad?: boolean }) {
  const tone = trendTone(t, upIsBad);
  return (
    <StatusBadge
      size="sm"
      tone={tone}
      icon={t.dir === 'up' ? 'trendUp' : t.dir === 'down' ? 'trendDown' : undefined}
      dot={t.dir !== 'up' && t.dir !== 'down'}
      label={w.trendLine(t)}
    />
  );
}

function GlanceRow({ d, w, common }: Omit<SectionProps, 'f'>) {
  const { tr } = w;
  const s = common.state;
  return (
    <ZoneRow columns={4} min="15rem">
      <StatPair
        title={tr('ws.insights.cards.courts')}
        state={s}
        refreshing={common.refreshing}
        items={[
          { label: tr('ws.insights.cards.howFull'), value: d ? w.levelPct(d.demand.level, d.demand.levelPct) : '', sub: d ? w.trendLine(d.demand.levelTrend) : undefined },
          { label: tr('ws.insights.cards.bookings'), value: d ? w.trend(d.demand.bookingsTrend) : '' },
        ]}
      />
      <StatPair
        title={tr('ws.insights.cards.players')}
        state={s}
        refreshing={common.refreshing}
        items={[
          { label: tr('ws.insights.cards.activePlayers'), value: d ? w.count(d.players.active) : '', sub: d ? w.trendLine(d.players.activeTrend) : undefined },
          { label: tr('ws.insights.cards.newPlayers'), value: d ? w.share(d.players.newShare) : '' },
        ]}
      />
      <StatPair
        title={tr('ws.insights.cards.cafe')}
        state={s}
        refreshing={common.refreshing}
        items={[
          { label: tr('ws.insights.cards.crossover'), value: d ? w.share(d.cafe.crossoverShare) : '', sub: d ? w.trendLine(d.cafe.crossoverTrend) : undefined },
          { label: tr('ws.insights.cards.spend'), value: d ? w.trend(d.cafe.spendTrend) : '' },
        ]}
      />
      <StatPair
        title={tr('ws.insights.cards.money')}
        state={s}
        refreshing={common.refreshing}
        items={[
          { label: tr('ws.insights.cards.overall'), value: d ? w.trend(d.mix.trend) : '' },
          { label: tr('ws.insights.cards.courtsMoney'), value: d ? w.trend(d.mix.courtsTrend) : '' },
          { label: tr('ws.insights.cards.cafeMoney'), value: d ? w.trend(d.mix.cafeTrend) : '' },
        ]}
      />
    </ZoneRow>
  );
}

/** The heatmap over levels 0..4: the readout names the level, never a share of the peak. */
function LevelHeat({ title, hint, cells, w, f, common, tip }: { title: string; hint: string; cells: readonly Slot[]; w: Words; f: Formatters; common: Common; tip?: string }) {
  const values = heatCells(cells);
  return (
    <ChartCard title={title} tip={tip} {...common} state={common.state === 'ready' && values.length === 0 ? 'empty' : common.state} height={210}>
      <WeekHeatmap cells={values} f={f} format={(v) => w.level(Math.round(v) as Level)} unit={title} hint={hint} relative={false} scaleMax={4} />
    </ChartCard>
  );
}

/** A short ranked list: hours or names, first is the most. */
function RankCard({ title, items, common, tip, emptyKey, aside }: { title: string; items: readonly string[]; common: Common; tip?: string; emptyKey?: MessageKey; aside?: ReactNode }) {
  return (
    <CardShell title={title} tip={tip} {...common} state={common.state === 'ready' && items.length === 0 ? 'empty' : common.state} emptyKey={emptyKey} skeletonLines={3}>
      <ol style={{ margin: 0, paddingInlineStart: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
        {items.map((it, i) => (
          <li key={`${i}-${it}`} style={{ fontWeight: i === 0 ? 700 : 500, overflowWrap: 'anywhere' }}>
            <bdi>{it}</bdi>
          </li>
        ))}
      </ol>
      {aside}
    </CardShell>
  );
}

/** A row of rounded shares as the analytics share bar, the words in the legend. */
function ShareCard({ title, rows, w, f, common, tip }: { title: string; rows: readonly { key: string; label: string; share: number | null }[]; w: Words; f: Formatters; common: Common; tip?: string }) {
  const empty = common.state === 'ready' && rows.every((r) => r.share === null || r.share === 0);
  return (
    <CardShell title={title} tip={tip} {...common} state={empty ? 'empty' : common.state} emptyKey="ws.insights.unknown" skeletonLines={2}>
      <ShareBars segments={rows.map((r) => ({ key: r.key, label: r.label, value: r.share ?? 0 }))} format={(n) => w.shareWords(n)} pct={(n) => f.pct(n)} />
    </CardShell>
  );
}

const bucketRows = (rows: readonly BucketShare[], order: readonly string[], label: (b: string) => string) =>
  order.map((b) => ({ key: b, label: label(b), share: rows.find((r) => r.bucket === b)?.share ?? null }));

function WhenSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <LevelHeat title={tr('ws.insights.cards.heat')} hint={tr('ws.insights.cards.heatHint')} cells={d?.demand.heat ?? []} w={w} f={f} common={common} />
      <ZoneGrid columns={3}>
        <RankCard title={tr('ws.insights.cards.quiet')} items={(d?.demand.quiet ?? []).map(w.slot)} common={common} emptyKey="ws.insights.unknown" />
        <RankCard title={tr('ws.insights.cards.full')} items={(d?.demand.full ?? []).map(w.slot)} common={common} emptyKey="ws.insights.leads.none" />
        <CardShell title={tr('ws.insights.cards.losses')} {...common} skeletonLines={2}>
          {d && (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
              <TrendLine label={tr('ws.insights.cards.cancellations')} badge={<TrendBadge t={d.demand.cancelTrend} w={w} upIsBad />} />
              <TrendLine label={tr('ws.insights.cards.noShows')} badge={<TrendBadge t={d.demand.noShowTrend} w={w} upIsBad />} />
            </div>
          )}
        </CardShell>
      </ZoneGrid>
    </div>
  );
}

const trendRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' };

function TrendLine({ label, badge }: { label: string; badge: ReactNode }) {
  return (
    <div style={trendRow}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {badge}
    </div>
  );
}

function PlayersSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  const p = d?.players;
  return (
    <ZoneGrid columns={3}>
      <StatPair
        title={tr('ws.insights.cards.newReturning')}
        {...common}
        items={[
          { label: tr('ws.insights.cards.returning'), value: p ? w.share(p.returningShare) : '' },
          { label: tr('ws.insights.cards.newPlayers'), value: p ? w.share(p.newShare) : '', sub: p ? w.trendLine(p.newTrend) : undefined },
        ]}
      />
      <StatPair
        title={tr('ws.insights.cards.regulars')}
        {...common}
        items={[
          { label: tr('ws.insights.cards.regulars'), value: p ? w.count(p.regulars) : '' },
          { label: tr('ws.insights.cards.lapsing'), value: p ? w.count(p.lapsing) : '', sub: p ? tr('ws.insights.cards.lapsingSub', { days: formatNumber(p.lapseDays, w.locale) }) : undefined },
        ]}
      />
      <ShareCard
        title={tr('ws.insights.cards.frequency')}
        rows={bucketRows(p?.frequency ?? [], VISIT_BUCKETS, (b) => tr(`ws.insights.visits.${b as (typeof VISIT_BUCKETS)[number]}`))}
        w={w}
        f={f}
        common={{ ...common, state: common.state === 'ready' && p && allUnknown(p.frequency) ? 'empty' : common.state }}
      />
    </ZoneGrid>
  );
}

/**
 * Who comes: the crowd's size as an about-N, how much of it the club knows,
 * and the three cuts marketing plans on (gender, age, level) plus what the
 * data says they are into. Every figure is a share or a word — the exact
 * counts stay on the owner's Analytics › People.
 */
function PeopleSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  const p = d?.people;
  const thin = (rows: readonly BucketShare[] | undefined) =>
    common.state === 'ready' && (!rows || rows.length === 0) ? ('empty' as const) : common.state;
  return (
    <>
      <ZoneGrid columns={3}>
        <StatPair
          title={tr('ws.insights.cards.crowd')}
          {...common}
          items={[
            { label: tr('ws.insights.cards.known'), value: p ? w.count(p.known) : '', sub: p ? w.trendLine(p.knownTrend) : undefined },
            {
              label: tr('ws.insights.cards.coverage'),
              value: p ? w.levelPct(p.coverage, p.coveragePct) : '',
              sub: p ? tr('ws.insights.cards.coverageSub') : undefined,
            },
          ]}
        />
        <ShareCard
          title={tr('ws.insights.cards.whoThey')}
          rows={bucketRows(p?.genders ?? [], GENDER_BUCKETS, (b) => tr(`ws.insights.people.gender.${b as (typeof GENDER_BUCKETS)[number]}`))}
          w={w}
          f={f}
          common={{ ...common, state: thin(p?.genders) }}
        />
        <ShareCard
          title={tr('ws.insights.cards.ages')}
          rows={bucketRows(p?.ages ?? [], AGE_BUCKETS, (b) => tr(`ws.insights.people.age.${b as (typeof AGE_BUCKETS)[number]}`))}
          w={w}
          f={f}
          common={{ ...common, state: thin(p?.ages) }}
        />
      </ZoneGrid>
      <ZoneGrid columns={3}>
        <ShareCard
          title={tr('ws.insights.cards.levels')}
          tip={p && p.judgedShare !== null ? tr('ws.insights.cards.levelsTip', { judged: w.share(p.judgedShare) }) : undefined}
          rows={bucketRows(p?.levels ?? [], LEVEL_BUCKETS, (b) => tr(`ws.insights.people.level.${b as (typeof LEVEL_BUCKETS)[number]}`))}
          w={w}
          f={f}
          common={{ ...common, state: thin(p?.levels) }}
        />
        <ShareCard
          title={tr('ws.insights.cards.interests')}
          tip={tr('ws.insights.cards.interestsTip')}
          rows={bucketRows(p?.interests ?? [], INTEREST_BUCKETS, (b) => tr(`ws.insights.people.interest.${b as (typeof INTEREST_BUCKETS)[number]}`))}
          w={w}
          f={f}
          common={{ ...common, state: thin(p?.interests) }}
        />
        <CardShell
          title={tr('ws.insights.cards.groups')}
          {...common}
          state={common.state === 'ready' && (!p || p.top.length === 0) ? 'empty' : common.state}
          emptyKey="ws.insights.cards.groupsEmpty"
          skeletonLines={3}
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {(p?.top ?? []).map((seg) => (
              <li key={`${seg.who}-${seg.band}-${seg.level}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', alignItems: 'baseline' }}>
                <span>
                  {tr('ws.insights.people.segment', {
                    who: tr(`ws.insights.people.gender.${seg.who}` as never),
                    band: tr(`ws.insights.people.age.${seg.band}` as never),
                    level: tr(`ws.insights.people.level.${seg.level}` as never),
                  })}
                </span>
                <span style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{w.share(seg.share)}</span>
              </li>
            ))}
          </ul>
          {p && p.growing.length > 0 && (
            <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', lineHeight: 1.5 }}>
              {tr('ws.insights.people.growing', {
                list: p.growing
                  .filter((g) => g.trend.dir === 'up')
                  .slice(0, 3)
                  .map((g) => peopleBucketName(g.bucket, tr))
                  .join(w.locale === 'ar' ? '، ' : ', '),
              })}
            </p>
          )}
        </CardShell>
      </ZoneGrid>
    </>
  );
}

/** A growing bucket's word, whichever of the four kinds it belongs to. */
function peopleBucketName(bucket: string, tr: Words['tr']): string {
  if ((GENDER_BUCKETS as readonly string[]).includes(bucket)) return tr(`ws.insights.people.gender.${bucket}` as never);
  if ((AGE_BUCKETS as readonly string[]).includes(bucket)) return tr(`ws.insights.people.age.${bucket}` as never);
  if ((LEVEL_BUCKETS as readonly string[]).includes(bucket)) return tr(`ws.insights.people.level.${bucket}` as never);
  return tr(`ws.insights.people.interest.${bucket}` as never);
}

function ChannelsSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  const c = d?.channels;
  return (
    <ZoneGrid columns={3}>
      <ShareCard
        title={tr('ws.insights.cards.source')}
        rows={[
          { key: 'app', label: tr('ws.insights.cards.app'), share: c?.appShare ?? null },
          { key: 'desk', label: tr('ws.insights.cards.desk'), share: c?.deskShare ?? null },
        ]}
        w={w}
        f={f}
        common={common}
      />
      <ShareCard
        title={tr('ws.insights.cards.lead')}
        rows={bucketRows(c?.lead ?? [], LEAD_BUCKETS, (b) => tr(`ws.insights.leadBuckets.${b as (typeof LEAD_BUCKETS)[number]}`))}
        w={w}
        f={f}
        common={common}
      />
      <CardShell title={tr('ws.insights.cards.notRecorded')} state={common.state === 'loading' ? 'loading' : 'ready'} skeletonLines={2}>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{tr('ws.insights.notRecordedList')}</p>
        {c && (
          <div style={{ ...trendRow, marginBlockStart: 'var(--tp-sp-3)' }}>
            <span style={{ fontWeight: 600 }}>{tr('ws.insights.cards.appTrend')}</span>
            <TrendBadge t={c.appTrend} w={w} />
          </div>
        )}
      </CardShell>
    </ZoneGrid>
  );
}

function OffersCard({ d, w, common }: Omit<SectionProps, 'f'>) {
  const { tr } = w;
  const offers = d?.offers ?? [];
  const tone = { strong: 'success', some: 'info', little: 'warn', unused: 'neutral' } as const;
  return (
    <CardShell title={tr('ws.insights.cards.offerList')} {...common} state={common.state === 'ready' && offers.length === 0 ? 'empty' : common.state} emptyKey="ws.insights.leads.offersNone">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {offers.map((o, i) => (
          <li
            key={o.id}
            data-offer={o.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              paddingBlock: 'var(--tp-sp-2)',
              borderBlockStart: i === 0 ? undefined : '1px solid var(--tp-border)',
            }}
          >
            <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>
                <bdi>{w.name(o)}</bdi>
              </strong>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {o.live ? tr('ws.insights.offerLive') : tr('ws.insights.offerOff')}
                {o.uses && ` · ${tr('ws.insights.offerUses', { uses: inner(w.count(o.uses), w.locale) })}`}
              </span>
            </span>
            <StatusBadge size="sm" tone={tone[o.verdict]} label={tr(`ws.insights.verdict.${o.verdict}`)} />
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function CafeSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  const c = d?.cafe;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <ZoneGrid columns={3}>
        <StatPair
          title={tr('ws.insights.cards.cafe')}
          {...common}
          items={[
            { label: tr('ws.insights.cards.crossover'), value: c ? w.share(c.crossoverShare) : '', sub: c ? w.trendLine(c.crossoverTrend) : undefined },
            { label: tr('ws.insights.cards.shop'), value: c ? w.trend(c.shopTrend) : '' },
          ]}
        />
        <RankCard title={tr('ws.insights.cards.top')} items={(c?.top ?? []).map(w.name)} common={common} emptyKey="ws.insights.unknown" />
        <RankCard title={tr('ws.insights.cards.bottom')} items={(c?.bottom ?? []).map(w.name)} common={common} emptyKey="ws.insights.unknown" />
      </ZoneGrid>
      <LevelHeat title={tr('ws.insights.cards.cafeHeat')} hint={tr('ws.insights.cards.cafeHeatHint')} cells={c?.heat ?? []} w={w} f={f} common={common} />
    </div>
  );
}

function EventsSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  const e = d?.events;
  const l = d?.loyalty;
  const next = e?.next;
  return (
    <ZoneGrid columns={2}>
      <StatPair
        title={tr('ws.insights.cards.tournaments')}
        {...common}
        note={e ? (next ? tr('ws.insights.cards.nextTournament', { name: w.name(next), date: f.date(next.startDate) }) : tr('ws.insights.cards.noNext')) : undefined}
        items={[
          { label: tr('ws.insights.cards.held'), value: e ? w.count(e.tournaments) : '' },
          { label: tr('ws.insights.cards.fill'), value: e ? (e.held ? w.levelPct(e.fillLevel, e.fillPct) : w.unknown) : '' },
          { label: tr('ws.insights.cards.returningPlayers'), value: e ? w.share(e.returningShare) : '' },
        ]}
      />
      <StatPair
        title={tr('ws.insights.cards.loyalty')}
        {...common}
        note={l && !l.enabled ? tr('ws.insights.cards.loyaltyOff') : undefined}
        items={[
          { label: tr('ws.insights.cards.members'), value: l ? w.count(l.members) : '', sub: l ? `${tr('ws.insights.cards.newMembers')}: ${w.count(l.newMembers)}` : undefined },
          { label: tr('ws.insights.cards.redeeming'), value: l ? w.share(l.redeemingShare) : '' },
          { label: tr('ws.insights.cards.holding'), value: l ? w.count(l.holdingPoints) : '' },
        ]}
      />
    </ZoneGrid>
  );
}

function MixSection({ d, w, f, common }: SectionProps) {
  const { tr } = w;
  const m = d?.mix;
  return (
    <ZoneGrid columns={2}>
      <ShareCard
        title={tr('ws.insights.cards.mix')}
        rows={[
          { key: 'courts', label: tr('ws.insights.cards.mixCourts'), share: m?.courts ?? null },
          { key: 'cafe', label: tr('ws.insights.cards.mixCafe'), share: m?.cafe ?? null },
          { key: 'shop', label: tr('ws.insights.cards.mixShop'), share: m?.shop ?? null },
        ]}
        w={w}
        f={f}
        common={common}
      />
      <CardShell title={tr('ws.insights.cards.money')} {...common} skeletonLines={3}>
        {m && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <TrendLine label={tr('ws.insights.cards.overall')} badge={<TrendBadge t={m.trend} w={w} />} />
            <TrendLine label={tr('ws.insights.cards.courtsMoney')} badge={<TrendBadge t={m.courtsTrend} w={w} />} />
            <TrendLine label={tr('ws.insights.cards.cafeMoney')} badge={<TrendBadge t={m.cafeTrend} w={w} />} />
          </div>
        )}
      </CardShell>
    </ZoneGrid>
  );
}
