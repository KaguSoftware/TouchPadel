/**
 * Coach pay's "this month so far" (0321): who is getting what right now.
 *
 * A statement is drafted on the 1st for the month before, so for the month in
 * progress the statements list below has no coach to show. This panel reads the
 * same RPC for the current month and lists the `live` rows: each coach (at each
 * branch) with the lessons they have taught, what was collected on them, the
 * court's share and what the coach has earned so far, plus the status of their
 * statement when one is drafted. Above the table is a small band: what the
 * coaches earn in all, what the court keeps, lessons taught and the average per
 * lesson, last month's payout for scale, and who has the largest share.
 *
 * Every money figure is the server's; the band only sums, averages and takes a
 * share of them (liveLogic.ts). Under "All branches" the other branches' rows
 * are listed too, with a branch line, and open nothing.
 */
import { formatNumber, formatIQD, isolate, type Locale, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { Skeleton } from '../../../components/ui';
import { DataTable, EmptyState, HeadlineFigure, Panel, StatusBadge, type Column } from '../../../components/kit';
import { CardTitle } from '../../ops/OpsVisuals';
import { monthLabel } from '../../deductions/venueDate';
import type { LiveCoachRow } from '../../coaching/lessonPayloads';
import { statementStatusKey } from '../../coaching/lessonLogic';
import { useCoachStatements } from './statementKeys';
import { averagePerLesson, liveTotals, orderLive, shareOfTotal, topEarner } from './liveLogic';
import { branchOf, coachOf, moneyText, showsBranchColumn, statementTone } from './statementsLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

type Tr = ReturnType<typeof useLocale>['tr'];

/** "Private 3 · Group 5": only the kinds that were taught. */
function mixText(tr: Tr, locale: Locale, r: Pick<LiveCoachRow, 'private_count' | 'group_count' | 'course_count'>): string {
  const parts: [MessageKey, number | null][] = [
    ['ws.coaching.common.kindShort.private', r.private_count],
    ['ws.coaching.common.kindShort.group', r.group_count],
    ['ws.coaching.common.kindShort.course', r.course_count],
  ];
  return parts
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([key, count]) => `${tr(key)} ${formatNumber(count ?? 0, locale)}`)
    .join(' · ');
}

export function CoachesThisMonth({
  month,
  lastMonthPaidOut,
}: {
  /** The server's current month, 'YYYY-MM-01'; null until the default read has answered. */
  month: string | null;
  /** Last month's coach share (the default read's totals), for scale; null when unknown. */
  lastMonthPaidOut: number | null;
}) {
  const { tr, locale } = useLocale();
  const { branchId: railBranch } = useVenue();
  const q = useCoachStatements(month, month !== null);
  const rows = q.data?.live ?? [];
  const title = (
    <CardTitle icon="whistle">
      {tr('ws.coaching.coachPay.live.title', { month: month ? monthLabel(month, locale) : '' })}
    </CardTitle>
  );

  // A failed or missing read is already spoken for by the statements section.
  if (month === null || (q.isError && !q.data) || q.data === null) return null;

  return (
    <Panel title={title}>
      <div data-testid="coachPay.live" style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <p style={{ ...muted, margin: 0 }}>{tr('ws.coaching.coachPay.live.lead')}</p>
        {q.data === undefined ? (
          <Skeleton lines={4} />
        ) : rows.length === 0 ? (
          <EmptyState compact kind="nothingToDo" icon="whistle" title={tr('ws.coaching.coachPay.live.empty')} />
        ) : (
          <>
            <Band rows={rows} lastMonthPaidOut={lastMonthPaidOut} />
            <LiveTable rows={rows} railBranch={railBranch} />
          </>
        )}
      </div>
    </Panel>
  );
}

/** The small analytics band: four figures, then who has the largest share. */
function Band({ rows, lastMonthPaidOut }: { rows: readonly LiveCoachRow[]; lastMonthPaidOut: number | null }) {
  const { tr, locale } = useLocale();
  const t = liveTotals(rows);
  const average = averagePerLesson(t);
  const top = rows.length > 1 ? topEarner(rows) : null;
  const topShare = top ? shareOfTotal(top, t.coachIqd) : null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <section
        aria-label={tr('ws.coaching.coachPay.totals.label')}
        data-testid="coachPay.live.band"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 10rem), 1fr))', gap: 'var(--tp-sp-3)' }}
      >
        <HeadlineFigure
          label={tr('ws.coaching.coachPay.live.figures.coachShare')}
          value={moneyText(t.coachIqd, locale)}
          hint={lastMonthPaidOut !== null ? tr('ws.coaching.coachPay.live.lastMonth', { amount: moneyText(lastMonthPaidOut, locale) }) : undefined}
        />
        <HeadlineFigure label={tr('ws.coaching.coachPay.live.figures.courtShare')} value={moneyText(t.courtShare, locale)} />
        <HeadlineFigure
          label={tr('ws.coaching.coachPay.live.figures.lessons')}
          value={formatNumber(t.lessons, locale)}
          hint={mixText(tr, locale, { private_count: t.privateLessons, group_count: t.groupLessons, course_count: t.courseLessons })}
        />
        <HeadlineFigure
          label={tr('ws.coaching.coachPay.live.figures.average')}
          value={average === null ? '—' : formatIQD(average, locale)}
          hint={tr('ws.coaching.coachPay.live.coachCount', { count: formatNumber(t.coaches, locale) })}
        />
      </section>
      {top && topShare !== null && (
        <p data-testid="coachPay.live.top" style={{ ...muted, margin: 0 }}>
          {tr('ws.coaching.coachPay.live.top', { coach: isolate(coachOf(top, locale)), percent: formatNumber(topShare, locale) })}
        </p>
      )}
    </div>
  );
}

function LiveTable({ rows, railBranch }: { rows: readonly LiveCoachRow[]; railBranch: string | null }) {
  const { tr, locale } = useLocale();
  const total = liveTotals(rows).coachIqd;
  const withBranch = showsBranchColumn(rows, railBranch);
  const ordered = orderLive(rows, locale, railBranch);
  const columns: Column<LiveCoachRow>[] = [
    {
      key: 'coach',
      header: tr('ws.coaching.coachPay.columns.coach'),
      truncateTitle: (r) => coachOf(r, locale),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600 }}>{coachOf(r, locale)}</bdi>
          {withBranch && (
            <span style={muted}>
              <bdi>{branchOf(r, locale)}</bdi>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'lessons',
      header: tr('ws.coaching.coachPay.columns.lessons'),
      numeric: true,
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
          <bdi>{formatNumber(r.lessons_count ?? 0, locale)}</bdi>
          <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>
            <bdi>{mixText(tr, locale, r)}</bdi>
          </span>
        </span>
      ),
    },
    { key: 'collected', header: tr('ws.coaching.coachPay.columns.collected'), numeric: true, render: (r) => <bdi>{moneyText(r.collected_iqd, locale)}</bdi> },
    { key: 'court', header: tr('ws.coaching.coachPay.columns.courtShare'), numeric: true, render: (r) => <bdi>{moneyText(r.court_share_iqd, locale)}</bdi> },
    {
      key: 'earned',
      header: tr('ws.coaching.coachPay.live.columns.earned'),
      numeric: true,
      render: (r) => (
        <strong>
          <bdi>{moneyText(r.coach_iqd, locale)}</bdi>
        </strong>
      ),
    },
    {
      key: 'share',
      header: tr('ws.coaching.coachPay.live.columns.share'),
      width: '8rem',
      render: (r) => <ShareBar percent={shareOfTotal(r, total)} />,
    },
    {
      key: 'statement',
      header: tr('ws.coaching.coachPay.live.columns.statement'),
      render: (r) => {
        if (!r.statement_status) return <span style={muted}>{tr('ws.coaching.coachPay.live.notDrafted')}</span>;
        const key = statementStatusKey(r.statement_status);
        return <StatusBadge size="sm" tone={statementTone(r.statement_status)} label={key ? tr(key) : r.statement_status} />;
      },
    },
  ];
  return (
    <DataTable<LiveCoachRow>
      aria-label={tr('ws.coaching.coachPay.live.table')}
      columns={columns}
      rows={ordered}
      rowKey={(r) => `${r.coach_id}:${r.venue_id}`}
      dense
    />
  );
}

/** A thin bar and the whole-number percent beside it; "—" before anything is earned. */
function ShareBar({ percent }: { percent: number | null }) {
  const { locale } = useLocale();
  if (percent === null) return <span style={muted}>—</span>;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <span aria-hidden="true" style={{ flex: 1, blockSize: '0.4rem', borderRadius: '999px', background: 'var(--tp-border)', overflow: 'hidden' }}>
        <span style={{ display: 'block', blockSize: '100%', inlineSize: `${percent}%`, background: 'var(--tp-accent)' }} />
      </span>
      <bdi style={{ fontVariantNumeric: 'tabular-nums', minInlineSize: '2.5rem', textAlign: 'end' }}>{formatNumber(percent, locale)}%</bdi>
    </span>
  );
}
