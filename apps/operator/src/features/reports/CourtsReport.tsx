/**
 * CourtsReportScreen (spec 06.41).
 *
 * The question: **how are the courts doing — which court earns and fills
 * best, when do people play, and how often do bookings fall through?**
 *
 * The period's totals lead (bookings kept, hours booked, occupancy, court
 * revenue, cancellations, no-shows). Below, one breakdown at a time:
 *
 *  - By court: bookings, hours, occupancy, revenue and revenue per open hour
 *    — sortable, so "which court earns least per hour" is one click. When a
 *    tournament held a court in the period, its event hours show as a column
 *    here and as a figure in the band: they are open hours the venue gave to
 *    an event, so without the line they would read as hours nobody booked
 *    (event_court_blocks, #55).
 *  - Cancellations: counts and rates per court.
 *  - Peak times: peak against off-peak bookings per court.
 *  - By start time: `byHour`, drawn as bars (the old "By hour" view asked for
 *    bars from columns the rows never had, so none were ever drawn).
 *  - By day: `trend`.
 *
 * What went: the Day / Week / Month switch (report_courts takes no grouping —
 * it changed nothing) and the comparison select (every report RPC returns
 * `comparison: null`). The management panel compares periods for real.
 *
 * A court row opens its bookings (report_drill `court:<id>`); the old rows
 * looked clickable and did nothing, because the drill read `court_id` from a
 * payload that sends `courtId`.
 *
 * Open matches (docs/design/open-matches/operator.md §5.19): when
 * report_courts carries its `matches` block (0265), an "Open matches" view
 * joins the list: a band from that block (bookings, booked, paid at the desk,
 * written off, no-show seats, called off, tickets lost here) and, from
 * app.report_matches for the same period with its own category and joining
 * filters, how the matches and their seats went and a By day table. The court
 * filter hides there, and "Compare with" is disabled (report_compare knows
 * three reports, not this one).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Field, Select } from '../../components/ui';
import { StatusBadge, type ComparisonMode } from '../../components/kit';
import {
  AsyncStateWrapper,
  asyncStatus,
  BarList,
  changeOf,
  ColumnNotes,
  CompareFilter,
  count,
  DrillDialog,
  EmptyPeriod,
  EmptyState,
  exportTable,
  Fig,
  FigureBand,
  formatDay,
  HeadlineFigure,
  hoursOf,
  money,
  nameIn,
  percent,
  ReportFrame,
  ReportSkeleton,
  ReportTable,
  tableCsv,
  TableHint,
  useComparedReport,
  useReportPeriod,
  ViewSwitch,
  type DrillRequest,
  type ReportColumn,
  type Tr,
} from './ReportParts';
import { CourtFilter } from './ReportFilterBar';
import {
  courtsIsEmpty,
  matchesReportIsEmpty,
  readCourts,
  readMatchesReport,
  type CourtMatches,
  type CourtRow,
  type MatchDayRow,
  type MatchTotalKey,
  type MatchesReport,
} from './reportPayloads';

type View = 'byCourt' | 'cancellations' | 'peak' | 'byHour' | 'byDay' | 'matches';
const COURT_VIEWS: readonly View[] = ['byCourt', 'cancellations', 'peak', 'byHour', 'byDay'];
/** The Open matches view is offered only when the server sends report_courts' `matches` block. */
export function courtsViews(hasMatches: boolean): readonly View[] {
  return hasMatches ? [...COURT_VIEWS, 'matches'] : COURT_VIEWS;
}
type Locale = ReturnType<typeof useLocale>['locale'];
type DayRow = { date: string; bookings: number | null; revenueIqd: number | null };
/** report_matches' own filters (money.md §7.6); '' is every value. */
type MatchCategory = '' | 'open' | 'women' | 'men';
type MatchJoin = '' | 'open' | 'approve';

export function CourtsReportScreen() {
  const { tr, locale } = useLocale();
  const { period, setPeriod, today, ready } = useReportPeriod();
  const [courtId, setCourtId] = useState('');
  const [picked, setView] = useState<View>('byCourt');
  const [drill, setDrill] = useState<DrillRequest | null>(null);
  const [matchCategory, setMatchCategory] = useState<MatchCategory>('');
  const [matchJoin, setMatchJoin] = useState<MatchJoin>('');

  const args = { p_from: period.from, p_to: period.to, p_filters: { courtId: courtId || null } };
  const [compare, setCompare] = useState<ComparisonMode>('none');
  const q = useComparedReport('courts', 'report_courts', args, compare, readCourts, ready);
  const data = q.data?.current;
  const changes = q.data?.changes;
  // A period with nothing booked, cancelled or missed is empty, not a table of
  // every court at zero.
  const status = asyncStatus(q, (d) => courtsIsEmpty(d.current));
  const t = data?.totals ?? null;
  const views = courtsViews(Boolean(data?.matches));
  // A server that stops sending the block (a branch switch) falls back to the first view.
  const view: View = views.includes(picked) ? picked : 'byCourt';
  const onMatches = view === 'matches';
  const matchArgs = {
    p_from: period.from,
    p_to: period.to,
    p_filters: { ...(matchCategory ? { category: matchCategory } : {}), ...(matchJoin ? { joinPolicy: matchJoin } : {}) },
  };
  const matchesQ = useQuery({
    queryKey: ['reports', 'report_matches', matchArgs],
    queryFn: async () => readMatchesReport(await appRpc('report_matches', matchArgs)),
    enabled: ready && onMatches,
    refetchInterval: 120_000,
  });
  // Tournament hours: shown only for a period that had some.
  const hasEvents = (t?.eventMinutes ?? 0) > 0 || (data?.rows.some((r) => (r.eventMinutes ?? 0) > 0) ?? false);

  const courtColumn: ReportColumn<CourtRow> = {
    key: 'court',
    header: tr('ws.reports.courts.columns.court'),
    truncate: true,
    truncateTitle: (r) => nameIn(r.name, locale),
    render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
        <bdi>{nameIn(r.name, locale)}</bdi>
        {!r.isActive && <StatusBadge size="sm" tone="neutral" label={tr('ws.reports.frame.retired')} />}
      </span>
    ),
    sort: (r) => nameIn(r.name, locale),
    csv: (r) => nameIn(r.name, locale),
  };
  const n = (key: keyof CourtRow, header: string, fmt: (v: number | null) => string, strong?: boolean, tone?: 'warn' | 'danger'): ReportColumn<CourtRow> => ({
    key,
    header,
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={fmt(r[key] as number | null)} strong={strong} tone={tone} />,
    sort: (r) => r[key] as number | null,
    csv: (r) => r[key] as number | null,
  });
  const c = (k: Parameters<Tr>[0]) => tr(k);
  const columns: Record<'byCourt' | 'cancellations' | 'peak', ReportColumn<CourtRow>[]> = {
    byCourt: [
      courtColumn,
      n('bookings', c('ws.reports.courts.columns.bookings'), (v) => count(v, locale)),
      { ...n('bookedMinutes', c('ws.reports.courts.columns.hours'), (v) => hoursOf(v, locale, tr)) },
      ...(hasEvents ? [n('eventMinutes', c('ws.events.courts.eventHours'), (v) => hoursOf(v, locale, tr))] : []),
      n('occupancyPct', c('ws.reports.courts.columns.occupancy'), (v) => percent(v, locale, tr)),
      n('revenueIqd', c('ws.reports.courts.columns.revenue'), (v) => money(v, locale), true),
      n('revenuePerOpenHourIqd', c('ws.reports.courts.columns.perOpenHour'), (v) => money(v, locale)),
    ],
    cancellations: [
      courtColumn,
      n('bookings', c('ws.reports.courts.columns.bookings'), (v) => count(v, locale)),
      n('cancellations', c('ws.reports.courts.columns.cancelled'), (v) => count(v, locale), false, 'warn'),
      n('cancellationRatePct', c('ws.reports.courts.columns.cancelledRate'), (v) => percent(v, locale, tr)),
      n('noShows', c('ws.reports.courts.columns.noShows'), (v) => count(v, locale), false, 'danger'),
      n('noShowRatePct', c('ws.reports.courts.columns.noShowRate'), (v) => percent(v, locale, tr)),
    ],
    peak: [
      courtColumn,
      n('peakBookings', c('ws.reports.courts.columns.peak'), (v) => count(v, locale)),
      n('offPeakBookings', c('ws.reports.courts.columns.offPeak'), (v) => count(v, locale)),
    ],
  };
  const dayColumns: ReportColumn<DayRow>[] = [
    { key: 'date', header: tr('ws.reports.courts.columns.day'), render: (r) => <bdi>{formatDay(r.date, locale)}</bdi>, sort: (r) => r.date, csv: (r) => r.date },
    { key: 'bookings', header: tr('ws.reports.courts.columns.bookings'), numeric: true, render: (r) => count(r.bookings, locale), sort: (r) => r.bookings, csv: (r) => r.bookings },
    { key: 'revenue', header: tr('ws.reports.courts.columns.revenue'), numeric: true, render: (r) => <strong>{money(r.revenueIqd, locale)}</strong>, sort: (r) => r.revenueIqd, csv: (r) => r.revenueIqd },
  ];

  const courtScope = courtId ? `court:${courtId}` : null;
  function openCourt(r: CourtRow) {
    setDrill({
      what: nameIn(r.name, locale),
      figures:
        view === 'cancellations'
          ? [
              { key: 'cancellations', label: tr('ws.reports.courts.columns.cancelled') },
              { key: 'noShows', label: tr('ws.reports.courts.columns.noShows') },
            ]
          : [{ key: 'bookings', label: tr('ws.reports.courts.columns.bookings') }],
      scope: `court:${r.courtId}`,
      from: period.from,
      to: period.to,
    });
  }
  function openDay(r: DayRow) {
    setDrill({ what: tr('ws.reports.courts.columns.bookings'), figures: [{ key: 'bookings', label: tr('ws.reports.courts.columns.bookings') }], scope: courtScope, from: r.date, to: r.date });
  }

  const matchDayColumns = matchDayColumnsOf(tr, locale);

  const notes: Record<View, Parameters<Tr>[0][]> = {
    // The event column says what it is where it appears, like the two derived figures.
    byCourt: ['ws.reports.courts.notes.occupancy', 'ws.reports.courts.notes.perOpenHour', ...(hasEvents ? (['ws.events.courts.eventHoursTip'] as const) : [])],
    cancellations: ['ws.reports.courts.notes.rates'],
    peak: ['ws.reports.courts.notes.peak'],
    byHour: [],
    byDay: [],
    matches: ['ws.matches.reports.compareOff'],
  };

  function exportCsv() {
    if (!data) return;
    const parts = { view, court: onMatches ? undefined : courtId || undefined };
    const base = tr('ws.reports.export.courts');
    if (view === 'matches') return exportTable(base, locale, period, parts, tableCsv(matchDayColumns, matchesQ.data?.byDay ?? []));
    if (view === 'byDay') return exportTable(base, locale, period, parts, tableCsv(dayColumns, data.trend));
    if (view === 'byHour') {
      return exportTable(base, locale, period, parts, {
        headers: [tr('ws.reports.columns.hour'), tr('ws.reports.courts.columns.bookings')],
        // `07:00`, not a bare `7` in a column headed "Hour".
        body: data.byHour.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.bookings]),
      });
    }
    // Every court figure, whichever of the three court breakdowns is showing;
    // the event figure once, in minutes beside the available ones.
    const all = [
      courtColumn,
      ...columns.byCourt.slice(1).filter((col) => col.key !== 'eventMinutes'),
      ...columns.cancellations.slice(2),
      ...columns.peak.slice(1),
    ];
    exportTable(
      base,
      locale,
      period,
      parts,
      tableCsv(all, data.rows, [
        { header: tr('ws.reports.columns.available_hours'), value: (r) => r.availableMinutes },
        ...(hasEvents ? [{ header: tr('ws.events.courts.eventMinutesCsv'), value: (r: CourtRow) => r.eventMinutes }] : []),
      ]),
    );
  }

  return (
    <ReportFrame
      name="courts"
      period={period}
      onPeriod={setPeriod}
      today={today}
      busy={q.isFetching && !data}
      onExport={exportCsv}
      exportDisabled={status !== 'ready'}
      comparedWith={q.data?.period ?? null}
      filters={
        onMatches ? (
          <>
            <MatchFilters category={matchCategory} onCategory={setMatchCategory} join={matchJoin} onJoin={setMatchJoin} />
            {/* report_compare knows three reports; the note under the view says so. */}
            <CompareFilter value={compare} onChange={setCompare} disabled />
          </>
        ) : (
          <>
            <CourtFilter value={courtId} onChange={setCourtId} />
            <CompareFilter value={compare} onChange={setCompare} />
          </>
        )
      }
    >
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<ReportSkeleton columns={[tr('ws.reports.courts.columns.court'), tr('ws.reports.courts.columns.bookings'), tr('ws.reports.courts.columns.occupancy'), tr('ws.reports.courts.columns.revenue')]} />}
        emptyContent={<EmptyPeriod title={tr('ws.reports.courts.emptyTitle')} body={tr('ws.reports.courts.emptyBody')} period={period} today={today} onPick={setPeriod} />}
      >
        {data && (
          <>
            <FigureBand label={tr('ws.reports.nav.courts')}>
              <HeadlineFigure label={tr('ws.reports.courts.bookings')} value={count(t?.bookings ?? null, locale)} hint={tr('ws.reports.courts.bookingsHint')} comparison={changeOf(changes, 'bookings')} format={(n) => count(n, locale)} />
              <HeadlineFigure label={tr('ws.reports.courts.hours')} value={hoursOf(t?.bookedMinutes ?? null, locale, tr)} comparison={changeOf(changes, 'bookedMinutes')} format={(n) => hoursOf(n, locale, tr)} />
              <HeadlineFigure
                label={tr('ws.reports.courts.occupancy')}
                value={percent(t?.occupancyPct ?? null, locale, tr)}
                hint={t?.availableMinutes != null ? tr('ws.reports.courts.occupancyHint', { hours: count(Math.round(t.availableMinutes / 60), locale) }) : undefined}
              />
              <HeadlineFigure label={tr('ws.reports.courts.revenue')} value={money(t?.revenueIqd ?? null, locale)} comparison={changeOf(changes, 'revenueIqd')} format={(n) => money(n, locale)} />
              <HeadlineFigure label={tr('ws.reports.courts.cancellations')} value={count(t?.cancellations ?? null, locale)} tone={t?.cancellations ? 'warn' : 'neutral'} comparison={changeOf(changes, 'cancellations')} format={(n) => count(n, locale)} invert />
              <HeadlineFigure label={tr('ws.reports.courts.noShows')} value={count(t?.noShows ?? null, locale)} tone={t?.noShows ? 'danger' : 'neutral'} comparison={changeOf(changes, 'noShows')} format={(n) => count(n, locale)} invert />
              {/* Last, so the six lead figures keep their places whether or not a
                  tournament held a court in the period. */}
              {hasEvents && (
                <HeadlineFigure label={tr('ws.events.courts.eventHours')} value={hoursOf(t?.eventMinutes ?? null, locale, tr)} hint={tr('ws.events.courts.eventHoursHint')} />
              )}
            </FigureBand>

            <ViewSwitch<View>
              value={view}
              onChange={setView}
              options={views.map((v) => ({ value: v, label: tr(`ws.reports.courts.views.${v}`) }))}
              lead={tr(`ws.reports.courts.lead.${view}`)}
            />
            {onMatches && data.matches ? (
              <MatchesView
                band={data.matches}
                report={matchesQ.data ?? null}
                status={asyncStatus(matchesQ, matchesReportIsEmpty)}
                error={matchesQ.error}
                onRetry={() => void matchesQ.refetch()}
                dayColumns={matchDayColumns}
              />
            ) : (
              <CourtsView view={view === 'matches' ? 'byCourt' : view} data={data} columns={columns} dayColumns={dayColumns} onCourt={openCourt} onDay={openDay} tr={tr} locale={locale} />
            )}
            <ColumnNotes notes={notes[view].map((k) => tr(k))} />
          </>
        )}
      </AsyncStateWrapper>
      {drill && <DrillDialog request={drill} onClose={() => setDrill(null)} />}
    </ReportFrame>
  );
}

// ---------------------------------------------------------------------------
// Open matches (operator.md §5.19)
// ---------------------------------------------------------------------------

/** report_matches' own filters: the category and the joining rule (the court filter does not apply). */
function MatchFilters({ category, onCategory, join, onJoin }: { category: MatchCategory; onCategory: (c: MatchCategory) => void; join: MatchJoin; onJoin: (j: MatchJoin) => void }) {
  const { tr } = useLocale();
  const selectStyle = { inlineSize: 'auto', minInlineSize: '11rem', maxInlineSize: '18rem' } as const;
  return (
    <>
      <Field label={tr('ws.matches.reports.filters.category')} style={{ marginBlockEnd: 0 }}>
        <Select
          value={category}
          style={selectStyle}
          onChange={(v) => onCategory(v as MatchCategory)}
          options={[
            { value: '', label: tr('ws.matches.reports.filters.allCategories') },
            { value: 'open', label: tr('ws.matches.common.category.open') },
            { value: 'women', label: tr('ws.matches.common.category.women') },
            { value: 'men', label: tr('ws.matches.common.category.men') },
          ]}
        />
      </Field>
      <Field label={tr('ws.matches.reports.filters.join')} style={{ marginBlockEnd: 0 }}>
        <Select
          value={join}
          style={selectStyle}
          onChange={(v) => onJoin(v as MatchJoin)}
          options={[
            { value: '', label: tr('ws.matches.reports.filters.anyJoin') },
            { value: 'open', label: tr('ws.matches.common.join.open') },
            { value: 'approve', label: tr('ws.matches.common.join.approve') },
          ]}
        />
      </Field>
    </>
  );
}

function matchDayColumnsOf(tr: Tr, locale: Locale): ReportColumn<MatchDayRow>[] {
  const n = (key: Exclude<keyof MatchDayRow, 'date'>, header: string, fmt: (v: number | null) => string): ReportColumn<MatchDayRow> => ({
    key,
    header,
    numeric: true,
    render: (r) => fmt(r[key]),
    sort: (r) => r[key],
    csv: (r) => r[key],
  });
  return [
    { key: 'date', header: tr('ws.matches.reports.byDay.day'), render: (r) => <bdi>{formatDay(r.date, locale)}</bdi>, sort: (r) => r.date, csv: (r) => r.date },
    n('started', tr('ws.matches.reports.byDay.started'), (v) => count(v, locale)),
    n('booked', tr('ws.matches.reports.byDay.booked'), (v) => count(v, locale)),
    n('bookedIqd', tr('ws.matches.reports.byDay.bookedIqd'), (v) => money(v, locale)),
    n('writtenOffIqd', tr('ws.matches.reports.byDay.writtenOffIqd'), (v) => money(v, locale)),
    n('noShowSeats', tr('ws.matches.reports.byDay.noShowSeats'), (v) => count(v, locale)),
  ];
}

const MATCH_COUNT_ROWS: readonly { key: MatchTotalKey; label: Parameters<Tr>[0]; pct?: boolean; hint?: Parameters<Tr>[0] }[] = [
  { key: 'started', label: 'ws.matches.reports.counts.started' },
  { key: 'booked', label: 'ws.matches.reports.counts.booked' },
  { key: 'played', label: 'ws.matches.reports.counts.played' },
  { key: 'bumped', label: 'ws.matches.reports.counts.bumped' },
  { key: 'expired', label: 'ws.matches.reports.counts.expired' },
  { key: 'cancelled', label: 'ws.matches.reports.counts.cancelled' },
  { key: 'calledOffShort', label: 'ws.matches.reports.counts.calledOffShort' },
  { key: 'allNoShow', label: 'ws.matches.reports.counts.allNoShow' },
  { key: 'fillRatePct', label: 'ws.matches.reports.counts.fillRate', pct: true, hint: 'ws.matches.reports.counts.fillRateHint' },
];
const SEAT_COUNT_ROWS: readonly { key: MatchTotalKey; label: Parameters<Tr>[0] }[] = [
  { key: 'seatsFilled', label: 'ws.matches.reports.seats.filled' },
  { key: 'accountSeats', label: 'ws.matches.reports.seats.account' },
  { key: 'friendSeats', label: 'ws.matches.reports.seats.friend' },
  { key: 'deskSeats', label: 'ws.matches.reports.seats.desk' },
  { key: 'attendedSeats', label: 'ws.matches.reports.seats.attended' },
  { key: 'noShowSeats', label: 'ws.matches.reports.seats.noShow' },
  { key: 'leftLateSeats', label: 'ws.matches.reports.seats.leftLate' },
  { key: 'refilledSeats', label: 'ws.matches.reports.seats.refilled' },
];

/** The Open matches view: the report_courts band, then report_matches' counts and its By day table. */
function MatchesView({
  band: m,
  report,
  status,
  error,
  onRetry,
  dayColumns,
}: {
  band: CourtMatches;
  report: MatchesReport | null;
  status: ReturnType<typeof asyncStatus>;
  error: unknown;
  onRetry: () => void;
  dayColumns: ReportColumn<MatchDayRow>[];
}) {
  const { tr, locale } = useLocale();
  const K = 'ws.matches.reports';
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="courts-matches">
      <FigureBand label={tr('ws.reports.courts.views.matches')}>
        <HeadlineFigure label={tr(`${K}.band.bookings`)} value={count(m.bookings, locale)} />
        <HeadlineFigure label={tr(`${K}.band.bookedIqd`)} value={money(m.bookedIqd, locale)} />
        <HeadlineFigure label={tr(`${K}.band.deskPaidIqd`)} value={money(m.deskPaidIqd, locale)} />
        <HeadlineFigure label={tr(`${K}.band.writtenOffIqd`)} value={money(m.writtenOffIqd, locale)} tone={m.writtenOffIqd ? 'warn' : 'neutral'} />
        <HeadlineFigure label={tr(`${K}.band.noShowSeats`)} value={count(m.noShowSeats, locale)} tone={m.noShowSeats ? 'danger' : 'neutral'} />
        <HeadlineFigure label={tr(`${K}.band.calledOffShort`)} value={count(m.calledOffShort, locale)} />
        <HeadlineFigure label={tr(`${K}.band.ticketForfeitsIqd`)} value={money(m.ticketForfeitsIqd, locale)} />
      </FigureBand>
      <AsyncStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        compact
        skeleton={<ReportSkeleton columns={[tr(`${K}.byDay.day`), tr(`${K}.byDay.started`), tr(`${K}.byDay.booked`)]} />}
        emptyContent={<EmptyState compact kind="nothingToDo" icon="users" title={tr(`${K}.empty`)} />}
      >
        {report && (
          <>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', alignItems: 'start' }}>
              <CountList
                title={tr(`${K}.counts.title`)}
                rows={MATCH_COUNT_ROWS.map((r) => ({
                  label: tr(r.label),
                  hint: r.hint ? tr(r.hint) : undefined,
                  value: r.pct ? percent(report.totals[r.key], locale, tr) : count(report.totals[r.key], locale),
                }))}
              />
              <CountList title={tr(`${K}.seats.title`)} rows={SEAT_COUNT_ROWS.map((r) => ({ label: tr(r.label), value: count(report.totals[r.key], locale) }))} />
            </div>
            {report.byDay.length > 0 && (
              <ReportTable<MatchDayRow> label={tr(`${K}.byDay.title`)} columns={dayColumns} rows={report.byDay} rowKey={(r) => r.date} />
            )}
            {Boolean(report.totals.sandboxExcluded) && <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.sandboxExcluded`)}</p>}
          </>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

/** Label and figure rows under a small heading: the counts that read better as a list than a band. */
function CountList({ title, rows }: { title: string; rows: readonly { label: string; value: string; hint?: string }[] }) {
  return (
    <section aria-label={title}>
      <h3 style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{title}</h3>
      <dl style={{ margin: 0, display: 'grid' }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-3)',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              paddingBlock: 'var(--tp-sp-1)',
              borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined,
            }}
          >
            <div style={{ display: 'grid', minInlineSize: 0 }}>
              <dt style={{ fontSize: 'var(--tp-fs-sm)' }}>{r.label}</dt>
              {r.hint && <dd style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{r.hint}</dd>}
            </div>
            <dd style={{ margin: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CourtsView({
  view,
  data,
  columns,
  dayColumns,
  onCourt,
  onDay,
  tr,
  locale,
}: {
  view: Exclude<View, 'matches'>;
  data: ReturnType<typeof readCourts>;
  columns: Record<'byCourt' | 'cancellations' | 'peak', ReportColumn<CourtRow>[]>;
  dayColumns: ReportColumn<DayRow>[];
  onCourt: (r: CourtRow) => void;
  onDay: (r: DayRow) => void;
  tr: Tr;
  locale: Locale;
}) {
  const totals = data.totals;
  if (view === 'byHour') {
    if (!totals?.bookings) return <EmptyState compact kind="nothingToDo" icon="clock" title={tr('ws.reports.courts.noBookings')} />;
    return (
      <BarList
        label={tr('ws.reports.courts.views.byHour')}
        rows={data.byHour.map((h) => ({
          key: String(h.hour),
          label: tr('ws.reports.courts.hour', { hour: String(h.hour).padStart(2, '0') }),
          value: h.bookings,
          text: count(h.bookings, locale),
        }))}
      />
    );
  }
  if (view === 'byDay') {
    if (data.trend.length === 0) return <EmptyState compact kind="nothingToDo" icon="calendar" title={tr('ws.reports.courts.noBookings')} />;
    return (
      <>
        <TableHint icon="arrowUpRight">{tr('ws.reports.frame.drillHint')}</TableHint>
        <ReportTable<DayRow> label={tr('ws.reports.courts.views.byDay')} columns={dayColumns} rows={data.trend} rowKey={(r) => r.date} onRowClick={onDay} />
      </>
    );
  }
  if (view === 'cancellations' && totals && !totals.cancellations && !totals.noShows) {
    return <EmptyState compact kind="nothingToDo" title={tr('ws.reports.courts.noCancellations')} />;
  }
  return (
    <>
      <TableHint icon="arrowUpRight">{tr('ws.reports.frame.drillHint')}</TableHint>
      <ReportTable<CourtRow> label={tr(`ws.reports.courts.views.${view}`)} columns={columns[view]} rows={data.rows} rowKey={(r) => r.courtId} onRowClick={onCourt} />
    </>
  );
}
