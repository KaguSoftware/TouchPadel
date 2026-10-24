/**
 * `/analytics/people` — the People tab (migration 0369; Majed 2026-10-24:
 * "there is nothing that shows exactly who our customers are").
 *
 * Five zones, in the order the owner asks: who they are, what they are into,
 * which groups are biggest, when each group plays, and whether the levels on
 * record are accurate. One read, `app.analytics_customers`, and the page draws
 * only what it returns: the shares, the coverage and the counts are all the
 * server's (DESIGN.md, principle 3).
 *
 * The exact counts live here because this page is the owner's. The marketing
 * panel reads the same picture as words and shares on /insights, where no
 * count and no money figure ever lands.
 */
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { LONG_REQUEST_TIMEOUT_MS, businessTodayISO, normalizeBusinessDayStart, resolveCompare, resolveRange } from '@touch/core';
import { VENUE_TZ, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useCafeSettings } from '../../../lib/settings';
import { DataTable, EmptyState, type Column } from '../../../components/kit';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame, usePeriodLine } from '../AnalyticsFrame';
import { Zone, ZoneGrid } from '../Zone';
import { CardShell, type CardState } from '../cards/CardShell';
import { StatPair } from '../courts/cards/StatPair';
import { ChartCard } from '../charts/ChartCard';
import { CountBars } from '../charts/CountBars';
import { HBarChart } from '../charts/HBarChart';
import { barTwin } from '../charts/twins';
import { weekdayName } from '../copy';
import { makeFormatters } from '../format';
import type { AnalyticsSearch } from '../search';
import { PEOPLE_ZONES } from './zones';
import {
  biggestBucket,
  claimLean,
  freshFor,
  parsePeople,
  peakFor,
  peopleEmpty,
  type PeopleBucket,
  type PeopleData,
  type PeopleSegment,
} from './peopleLogic';

const K = 'ws.analytics.people';

export function PeopleTab() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);

  // The business day the period counts back from, exactly as the other tabs.
  const settings = useCafeSettings();
  const startHour = normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour);
  const todayISO = businessTodayISO(new Date(), startHour, VENUE_TZ);
  const range = useMemo(
    () => resolveRange({ range: search.range, from: search.from, to: search.to }, todayISO).range,
    [search.range, search.from, search.to, todayISO],
  );
  const compare = useMemo(
    () => resolveCompare(search.cmp, range, { from: search.cmpFrom, to: search.cmpTo }),
    [search.cmp, search.cmpFrom, search.cmpTo, range],
  );

  const q = useQuery({
    queryKey: ['analytics-customers', range.from, range.to],
    queryFn: () =>
      appRpc<unknown>('analytics_customers', { p_from: range.from, p_to: range.to }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const d = useMemo(() => (q.data === undefined ? null : parsePeople(q.data)), [q.data]);
  const state: CardState = q.isPending ? 'loading' : q.isError && !d ? 'error' : peopleEmpty(d) ? 'empty' : 'ready';
  const common = {
    state,
    refreshing: q.isFetching && !q.isPending,
    error: q.error,
    onRetry: () => void q.refetch(),
    emptyKey: `${K}.empty` as MessageKey,
  };

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/people', search: { ...search, ...next } });
  };

  // Read before the tree, as the other tabs do: a hook inside JSX reads as a
  // value and is not one.
  const periodLine = usePeriodLine(f, range, compare.range);
  const zone = (id: string) => PEOPLE_ZONES.find((z) => z.id === id)!;
  const lead = (build: (data: PeopleData) => string | null) => (d && state === 'ready' ? build(d) : null);

  const bucketLabel = (kind: 'gender' | 'age' | 'level', b: string) => tr(`${K}.${kind}.${b}` as MessageKey);
  const bars = (rows: readonly PeopleBucket[], kind: 'gender' | 'age' | 'level') =>
    rows.map((r) => ({ label: bucketLabel(kind, r.bucket), value: r.guests }));

  return (
    <AnalyticsFrame title={tr('analytics.title')} subtitle={periodLine}>
      <AnalyticsBar search={search} setSearch={setSearch} zones={PEOPLE_ZONES} compareBasis={compare.basis} compareRange={compare.range} />

      <Zone zone={zone('who')} lead={lead((data) => whoLead(data, tr, f, locale))}>
        <ZoneGrid columns={2}>
          <StatPair
            title={tr(`${K}.cards.crowd`)}
            tip={tr(`${K}.tips.crowd`)}
            {...common}
            items={[
              { label: tr(`${K}.cards.guests`), value: f.num(d?.known.guests ?? 0), sub: tr(`${K}.cards.guestsSub`, { plays: f.num(d?.known.plays ?? 0) }) },
              {
                label: tr(`${K}.cards.returning`),
                value: f.num(d?.known.returningGuests ?? 0),
                sub: tr(`${K}.cards.newSub`, { n: f.num(d?.known.newGuests ?? 0) }),
              },
            ]}
          />
          <StatPair
            title={tr(`${K}.cards.coverage`)}
            tip={tr(`${K}.tips.coverage`)}
            {...common}
            meter={
              d && d.known.coveragePct !== null
                ? { pct: d.known.coveragePct, label: tr(`${K}.cards.coverageMeter`), of: d.known.guests }
                : null
            }
            pct={(n) => f.pct(n)}
            items={[
              { label: tr(`${K}.cards.withAge`), value: f.num(d?.known.withAges ?? 0) },
              { label: tr(`${K}.cards.withLevel`), value: f.num(d?.known.withLevels ?? 0), sub: tr(`${K}.cards.judgedSub`, { n: f.num(d?.known.judgedLevels ?? 0) }) },
            ]}
          />
        </ZoneGrid>
        <ZoneGrid columns={3}>
          <ChartCard title={tr(`${K}.cards.genders`)} {...common} twin={barTwin(bars(d?.genders ?? [], 'gender'), tr(`${K}.table.who`), tr(`${K}.cards.guests`), `people-genders_${range.from}_${range.to}`)} height={220}>
            <CountBars rows={bars(d?.genders ?? [], 'gender')} format={(n) => f.num(n)} name={tr(`${K}.cards.guests`)} />
          </ChartCard>
          <ChartCard title={tr(`${K}.cards.ages`)} {...common} twin={barTwin(bars(d?.ages ?? [], 'age'), tr(`${K}.table.band`), tr(`${K}.cards.guests`), `people-ages_${range.from}_${range.to}`)} height={220}>
            <CountBars rows={bars(d?.ages ?? [], 'age')} format={(n) => f.num(n)} name={tr(`${K}.cards.guests`)} interval={0} tickFontSize={10} />
          </ChartCard>
          <ChartCard title={tr(`${K}.cards.levels`)} tip={tr(`${K}.tips.levels`)} {...common} twin={barTwin(bars(d?.levels ?? [], 'level'), tr(`${K}.table.level`), tr(`${K}.cards.guests`), `people-levels_${range.from}_${range.to}`)} height={220}>
            <CountBars rows={bars(d?.levels ?? [], 'level')} format={(n) => f.num(n)} name={tr(`${K}.cards.guests`)} />
          </ChartCard>
        </ZoneGrid>
      </Zone>

      <Zone zone={zone('interests')} lead={lead((data) => interestsLead(data, tr, f))}>
        <ChartCard
          title={tr(`${K}.cards.interests`)}
          tip={tr(`${K}.tips.interests`)}
          {...common}
          state={state === 'ready' && (d?.interests.length ?? 0) === 0 ? 'empty' : state}
          height={Math.max(220, 34 * (d?.interests.length ?? 6))}
          twin={barTwin(
            (d?.interests ?? []).map((r) => ({ label: tr(`${K}.interest.${r.bucket}` as MessageKey), value: r.guests })),
            tr(`${K}.cards.interests`),
            tr(`${K}.cards.guests`),
            `people-interests_${range.from}_${range.to}`,
          )}
        >
          <HBarChart
            rows={(d?.interests ?? []).map((r) => ({ label: tr(`${K}.interest.${r.bucket}` as MessageKey), value: r.guests }))}
            format={(n) => f.num(n)}
            name={tr(`${K}.cards.guests`)}
            axisWidth={150}
          />
        </ChartCard>
      </Zone>

      <Zone zone={zone('groups')} lead={lead((data) => groupsLead(data, tr, f, locale))}>
        <CardShell title={tr(`${K}.cards.groups`)} tip={tr(`${K}.tips.groups`)} {...common} state={state === 'ready' && (d?.segments.length ?? 0) === 0 ? 'empty' : state} skeletonLines={4}>
          <SegmentsTable rows={d?.segments ?? []} />
        </CardShell>
      </Zone>

      <Zone zone={zone('when')} lead={lead((data) => whenLead(data, tr, f, locale))}>
        <ZoneGrid columns={2}>
          <CardShell title={tr(`${K}.cards.whenGender`)} {...common} skeletonLines={3}>
            <PeakList d={d} keys={(d?.genders ?? []).map((g) => g.bucket)} kind="gender" />
          </CardShell>
          <CardShell title={tr(`${K}.cards.whenAge`)} {...common} skeletonLines={3}>
            <PeakList d={d} keys={(d?.ages ?? []).map((g) => g.bucket)} kind="age" />
          </CardShell>
        </ZoneGrid>
      </Zone>

      <Zone zone={zone('judged')} lead={lead((data) => judgedLead(data, tr, f))}>
        <ZoneGrid columns={2}>
          <StatPair
            title={tr(`${K}.cards.judged`)}
            tip={tr(`${K}.tips.judged`)}
            {...common}
            state={state === 'ready' && (d?.judged.checked ?? 0) === 0 ? 'empty' : state}
            emptyKey={`${K}.emptyJudged` as MessageKey}
            items={[
              { label: tr(`${K}.cards.agree`), value: f.num(d?.judged.agree ?? 0), sub: tr(`${K}.cards.checkedSub`, { n: f.num(d?.judged.checked ?? 0) }) },
              { label: tr(`${K}.cards.claimedHigh`), value: f.num(d?.judged.higher ?? 0), sub: tr(`${K}.cards.claimedLowSub`, { n: f.num(d?.judged.lower ?? 0) }) },
            ]}
          />
          <CardShell title={tr(`${K}.cards.newReturning`)} {...common} skeletonLines={3}>
            <FreshList d={d} />
          </CardShell>
        </ZoneGrid>
      </Zone>
    </AnalyticsFrame>
  );
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

function SegmentsTable({ rows }: { rows: readonly PeopleSegment[] }) {
  const { tr, locale } = useLocale();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const label = (kind: 'gender' | 'age' | 'level', b: string) => tr(`${K}.${kind}.${b}` as MessageKey);
  const columns: Column<PeopleSegment>[] = [
    { key: 'who', header: tr(`${K}.table.who`), render: (r) => label('gender', r.who), truncateTitle: (r) => label('gender', r.who) },
    { key: 'band', header: tr(`${K}.table.band`), render: (r) => label('age', r.band), truncateTitle: (r) => label('age', r.band) },
    { key: 'level', header: tr(`${K}.table.level`), render: (r) => label('level', r.level), truncateTitle: (r) => label('level', r.level) },
    { key: 'guests', header: tr(`${K}.table.guests`), numeric: true, render: (r) => f.num(r.guests), truncateTitle: (r) => f.num(r.guests) },
    { key: 'plays', header: tr(`${K}.table.plays`), numeric: true, render: (r) => f.num(r.plays), truncateTitle: (r) => f.num(r.plays) },
    { key: 'spend', header: tr(`${K}.table.spend`), numeric: true, render: (r) => f.money(r.spendIqd), truncateTitle: (r) => f.money(r.spendIqd) },
  ];
  return <DataTable rows={[...rows]} columns={columns} rowKey={(r) => `${r.who}-${r.band}-${r.level}`} />;
}

/** Each bucket's busiest slots: "Women — Thursday 19:00, Saturday 20:00". */
function PeakList({ d, keys, kind }: { d: PeopleData | null; keys: readonly string[]; kind: 'gender' | 'age' }) {
  const { tr, locale } = useLocale();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const rows = keys
    .map((key) => ({ key, slots: peakFor(d, key) }))
    .filter((r) => r.slots.length > 0);
  if (rows.length === 0) return <EmptyState compact title={tr(`${K}.emptyPeak`)} />;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-3)', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600 }}>{tr(`${K}.${kind}.${r.key}` as MessageKey)}</span>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {r.slots.map((s) => tr(`${K}.slot`, { day: weekdayName(tr, s.dow), hour: f.hour(s.hour) })).join(locale === 'ar' ? '، ' : ', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** New against returning guests, per gender and age bucket. */
function FreshList({ d }: { d: PeopleData | null }) {
  const { tr, locale } = useLocale();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const keys = [...(d?.genders ?? []), ...(d?.ages ?? [])].map((b) => b.bucket);
  const rows = keys
    .map((key) => ({ key, fresh: freshFor(d, key) }))
    .filter((r): r is { key: string; fresh: NonNullable<ReturnType<typeof freshFor>> } => !!r.fresh);
  if (rows.length === 0) return <EmptyState compact title={tr(`${K}.empty`)} />;
  const kindOf = (key: string) => ((d?.genders ?? []).some((g) => g.bucket === key) ? 'gender' : 'age');
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-3)', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600 }}>{tr(`${K}.${kindOf(r.key)}.${r.key}` as MessageKey)}</span>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums' }}>
            {tr(`${K}.freshLine`, { returning: f.num(r.fresh.returningGuests), fresh: f.num(r.fresh.newGuests) })}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The zone sentences: the answer first, in words
// ---------------------------------------------------------------------------

type Tr = ReturnType<typeof useLocale>['tr'];
type F = ReturnType<typeof makeFormatters>;

function whoLead(d: PeopleData, tr: Tr, f: F, locale: string): string {
  const g = biggestBucket(d.genders);
  const a = biggestBucket(d.ages);
  const l = biggestBucket(d.levels);
  if (!g && !a && !l) return tr(`${K}.leads.thin`);
  const parts = [
    g ? tr(`${K}.leads.gender`, { who: tr(`${K}.gender.${g.bucket}` as MessageKey), share: f.pct(g.share ?? 0) }) : null,
    a ? tr(`${K}.leads.age`, { band: tr(`${K}.age.${a.bucket}` as MessageKey) }) : null,
    l ? tr(`${K}.leads.level`, { level: tr(`${K}.level.${l.bucket}` as MessageKey) }) : null,
  ].filter(Boolean) as string[];
  const sentence = parts.join(locale === 'ar' ? '، ' : ', ');
  return d.known.coveragePct === null
    ? sentence
    : `${sentence} ${tr(`${K}.leads.coverage`, { pct: f.pct(d.known.coveragePct) })}`;
}

function interestsLead(d: PeopleData, tr: Tr, f: F): string {
  // The first tag that is not simply "books courts": that one is nearly everyone.
  const notable = d.interests.filter((r) => r.bucket !== 'courts');
  if (notable.length === 0) return tr(`${K}.leads.interestsThin`);
  const top = notable.reduce((best, r) => (r.guests > best.guests ? r : best), notable[0]!);
  return tr(`${K}.leads.interests`, {
    tag: tr(`${K}.interest.${top.bucket}` as MessageKey),
    share: f.pct(top.share ?? 0),
  });
}

function groupsLead(d: PeopleData, tr: Tr, f: F, locale: string): string {
  const named = d.segments.filter((s) => s.who !== 'other');
  if (named.length === 0) return tr(`${K}.leads.groupsThin`);
  const top = named[0]!;
  return tr(`${K}.leads.groups`, {
    group: [
      tr(`${K}.gender.${top.who}` as MessageKey),
      tr(`${K}.age.${top.band}` as MessageKey),
      tr(`${K}.level.${top.level}` as MessageKey),
    ].join(locale === 'ar' ? '، ' : ', '),
    guests: f.num(top.guests),
  });
}

function whenLead(d: PeopleData, tr: Tr, f: F, locale: string): string {
  const slots = d.peak.slice(0, 2);
  if (slots.length === 0) return tr(`${K}.leads.whenThin`);
  return tr(`${K}.leads.when`, {
    list: slots
      .map((s) =>
        tr(`${K}.leads.whenSlot`, {
          who: tr(`${K}.${(d.genders.some((g) => g.bucket === s.key) ? 'gender' : 'age') as 'gender' | 'age'}.${s.key}` as MessageKey),
          day: weekdayName(tr, s.dow),
          hour: f.hour(s.hour),
        }),
      )
      .join(locale === 'ar' ? '، ' : ', '),
  });
}

function judgedLead(d: PeopleData, tr: Tr, f: F): string {
  const lean = claimLean(d.judged);
  if (lean === null) {
    return tr(`${K}.leads.judgedThin`, { n: f.num(d.known.withLevels - d.judged.checked) });
  }
  return tr(`${K}.leads.judged${lean === 'agree' ? 'Agree' : lean === 'over' ? 'Over' : 'Under'}`, {
    checked: f.num(d.judged.checked),
    n: f.num(lean === 'over' ? d.judged.higher : lean === 'under' ? d.judged.lower : d.judged.agree),
  });
}
