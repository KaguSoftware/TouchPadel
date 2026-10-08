/**
 * Coach pay at `/reports/coaches` (docs/design/coaching/operator.md §5.16):
 * each coach's monthly statement at each branch, from
 * app.report_coach_statements. Modelled on the deductions Month tab
 * (features/deductions/DeductionsMonth.tsx): a month stepper that never passes
 * the default month, the server's `month` when none is asked for (the month
 * before `current_month`: statements are drafted on the 1st for the month
 * before; OP-02), `?month=` keeping it across reloads; the month's figures,
 * then one row per statement, each opening its statement dialog (named for
 * the statement's own month).
 *
 * Every figure is the server's (§5.1). No ReportTabs strip: this is not one of
 * the five reports; the `/reports` layout's ReportBranchScope still applies,
 * and under "All branches" a row of another branch is read-only and does not
 * open (R21: the detail read and every statement write act on the rail's
 * branch). A retired or deleted coach keeps their display name here (C-29).
 *
 * A server without the read (RPC_MISSING) shows "Coaching needs a server
 * update…"; a first read that fails shows the coaching refused presenter.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { isolate, type Locale } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { Button, Skeleton } from '../../../components/ui';
import {
  DataTable,
  EmptyState,
  HeadlineFigure,
  PageHeader,
  StatusBadge,
  type Column,
} from '../../../components/kit';
import { ChevronBack, ChevronForward } from '../../../components/icons';
import { monthLabel } from '../../deductions/venueDate';
import type { StatementRow } from '../../coaching/lessonPayloads';
import { statementStatusKey } from '../../coaching/lessonLogic';
import { LessonReadNotice } from '../../coaching/LessonReadNotice';
import { useLessonRead } from '../../coaching/useCoaching';
import { useCoachStatements } from './statementKeys';
import {
  branchOf,
  canStepForward,
  coachOf,
  countText,
  isDefaultView,
  isOtherBranch,
  maybeNegativeMoneyText,
  missingRows,
  moneyText,
  monthParam,
  orderStatements,
  showsBranchColumn,
  shownMonth,
  signedMoneyText,
  statementTone,
  stepMonth,
  totalsFigures,
} from './statementsLogic';
import { StatementDialog } from './StatementDialog';
import { CoachesThisMonth } from './CoachesThisMonth';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function CoachStatementsScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) ?? {}) as { month?: unknown };
  const asked = monthParam(search.month);
  const { branchId: railBranch } = useVenue();

  // The default view is always read: its month (the server's `month` with
  // none asked, the month before `current_month`) is the stepper's bound, and
  // it is asked for with no month at all (OP-02).
  const currentQ = useCoachStatements(null);
  const top = currentQ.data?.month ?? null;
  const onCurrent = isDefaultView(asked, top);
  const pickedQ = useCoachStatements(asked, !onCurrent);
  const q = onCurrent ? currentQ : pickedQ;
  const read = useLessonRead(q);
  const shown = shownMonth(asked, top) ?? q.data?.month ?? null;

  const [openRow, setOpenRow] = useState<StatementRow | null>(null);

  const go = (month: string | null) =>
    void navigate({ to: '/reports/coaches', search: month ? { month } : {}, replace: true });

  return (
    <div>
      <PageHeader
        title={tr('ws.coaching.coachPay.title')}
        subtitle={tr('ws.coaching.coachPay.lead')}
      />

      {/* Who is getting what in the month in progress: no statement exists for it until the 1st. */}
      {read.kind !== 'absent' && (
        <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
          <CoachesThisMonth
            month={currentQ.data?.current_month ?? null}
            lastMonthPaidOut={currentQ.data ? currentQ.data.totals.coach_iqd : null}
          />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
          flexWrap: 'wrap',
          marginBlockEnd: 'var(--tp-sp-3)',
        }}
      >
        <Button
          aria-label={tr('ws.kit.calendar.prevMonth')}
          disabled={shown === null}
          onClick={() => shown && go(stepMonth(shown, -1, top))}
          data-testid="coachPay.month.prev"
        >
          <ChevronBack size={16} />
        </Button>
        <h2
          id="coach-pay-month"
          style={{
            fontSize: 'var(--tp-fs-lg)',
            fontWeight: 700,
            minInlineSize: '11rem',
            textAlign: 'center',
          }}
        >
          {shown ? monthLabel(shown, locale) : tr('common.loading')}
        </h2>
        <Button
          aria-label={tr('ws.kit.calendar.nextMonth')}
          disabled={!canStepForward(shown, top)}
          onClick={() => shown && go(stepMonth(shown, 1, top))}
          data-testid="coachPay.month.next"
        >
          <ChevronForward size={16} />
        </Button>
        {!onCurrent && top && (
          <Button kind="ghost" size="sm" onClick={() => go(null)}>
            {tr('ws.coaching.coachPay.month.thisMonth')}
          </Button>
        )}
      </div>

      {read.kind === 'absent' ? (
        <EmptyState icon="whistle" title={tr('ws.coaching.offline.serverMissing')} />
      ) : read.kind === 'failed' ? (
        <LessonReadNotice status={read} onRetry={() => void q.refetch()} />
      ) : read.kind === 'loading' ? (
        <Skeleton lines={5} />
      ) : (
        <section
          aria-labelledby="coach-pay-month"
          style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}
        >
          <LessonReadNotice status={read} onRetry={() => void q.refetch()} />
          <Totals totals={read.data.totals} />
          <StatementTables
            rows={read.data.statements}
            railBranch={railBranch}
            onOpen={setOpenRow}
            empty={
              <EmptyState
                kind="nothingToDo"
                icon="whistle"
                title={
                  onCurrent || !shown
                    ? tr('ws.coaching.coachPay.emptyCurrent')
                    : tr('ws.coaching.coachPay.emptyMonth', { month: monthLabel(shown, locale) })
                }
              />
            }
          />
          <MissingList rows={missingRows(read.data.missing, locale)} />
        </section>
      )}

      {openRow && (
        <StatementDialog
          statementId={openRow.statement_id}
          fallback={openRow}
          monthText={
            openRow.month
              ? monthLabel(openRow.month, locale)
              : shown
                ? monthLabel(shown, locale)
                : ''
          }
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}

/** The month in figures: the server's `totals`, in the order of §5.16. */
function Totals({ totals }: { totals: Parameters<typeof totalsFigures>[0] }) {
  const { tr, locale } = useLocale();
  return (
    <section
      aria-label={tr('ws.coaching.coachPay.totals.label')}
      data-testid="coachPay.totals"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 10rem), 1fr))',
        gap: 'var(--tp-sp-3)',
      }}
    >
      {totalsFigures(totals).map((f) => (
        <HeadlineFigure
          key={f.key}
          label={tr(`ws.coaching.coachPay.totals.${f.key}`)}
          value={
            f.signed ? signedMoneyText(f.value, locale) : maybeNegativeMoneyText(f.value, locale)
          }
        />
      ))}
    </section>
  );
}

function columnsFor(
  tr: ReturnType<typeof useLocale>['tr'],
  locale: Locale,
  withBranch: boolean,
  readOnly: boolean,
): Column<StatementRow>[] {
  const c = (k: Parameters<typeof tr>[0]) => tr(k);
  const n = (
    key: keyof StatementRow,
    header: string,
    text: (r: StatementRow) => string,
  ): Column<StatementRow> => ({
    key,
    header,
    numeric: true,
    render: (r) => <bdi>{text(r)}</bdi>,
  });
  return [
    {
      key: 'coach',
      header: c('ws.coaching.coachPay.columns.coach'),
      truncateTitle: (r) => coachOf(r, locale),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600 }}>{coachOf(r, locale)}</bdi>
          {readOnly && (
            <span style={muted}>
              {tr('ws.coaching.coachPay.switchBranch', { branch: isolate(branchOf(r, locale)) })}
            </span>
          )}
        </span>
      ),
    },
    ...(withBranch
      ? [
          {
            key: 'branch',
            header: c('ws.coaching.coachPay.columns.branch'),
            render: (r: StatementRow) => <bdi>{branchOf(r, locale)}</bdi>,
          },
        ]
      : []),
    n('lessons_count', c('ws.coaching.coachPay.columns.lessons'), (r) =>
      countText(r.lessons_count, locale),
    ),
    n('collected_iqd', c('ws.coaching.coachPay.columns.collected'), (r) =>
      moneyText(r.collected_iqd, locale),
    ),
    n('court_share_iqd', c('ws.coaching.coachPay.columns.courtShare'), (r) =>
      moneyText(r.court_share_iqd, locale),
    ),
    n('coach_iqd', c('ws.coaching.coachPay.columns.coachShare'), (r) =>
      moneyText(r.coach_iqd, locale),
    ),
    n('adjustments_iqd', c('ws.coaching.coachPay.columns.adjustments'), (r) =>
      signedMoneyText(r.adjustments_iqd, locale),
    ),
    {
      key: 'total_iqd',
      header: c('ws.coaching.coachPay.columns.toPay'),
      numeric: true,
      render: (r) => (
        <strong>
          <bdi>{maybeNegativeMoneyText(r.total_iqd, locale)}</bdi>
        </strong>
      ),
    },
    {
      key: 'status',
      header: c('ws.coaching.coachPay.columns.status'),
      render: (r) => {
        const key = statementStatusKey(r.status);
        return (
          <StatusBadge
            size="sm"
            tone={statementTone(r.status)}
            label={key ? tr(key) : r.status}
            style={r.status === 'void' ? { opacity: 0.7 } : undefined}
          />
        );
      },
    },
  ];
}

/**
 * The rail branch's statements open their dialog; under "All branches" the
 * other branches' rows follow in a table of their own that opens nothing and
 * says where they are settled (R21).
 */
function StatementTables({
  rows,
  railBranch,
  onOpen,
  empty,
}: {
  rows: readonly StatementRow[];
  railBranch: string | null;
  onOpen: (r: StatementRow) => void;
  empty: ReactNode;
}) {
  const { tr, locale } = useLocale();
  if (rows.length === 0) return <>{empty}</>;
  const ordered = orderStatements(rows, locale, railBranch);
  const withBranch = showsBranchColumn(rows, railBranch);
  const mine = ordered.filter((r) => !isOtherBranch(r, railBranch));
  const others = ordered.filter((r) => isOtherBranch(r, railBranch));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {mine.length > 0 && (
        <DataTable<StatementRow>
          aria-label={tr('ws.coaching.coachPay.table')}
          columns={columnsFor(tr, locale, withBranch, false)}
          rows={mine}
          rowKey={(r) => r.statement_id}
          onRowClick={onOpen}
          dense
        />
      )}
      {others.length > 0 && (
        <section
          aria-label={tr('ws.coaching.coachPay.otherBranches')}
          data-testid="coachPay.otherBranches"
        >
          <h3
            style={{
              margin: 0,
              marginBlockEnd: 'var(--tp-sp-1)',
              fontSize: 'var(--tp-fs-sm)',
              fontWeight: 600,
            }}
          >
            {tr('ws.coaching.coachPay.otherBranches')}
          </h3>
          <DataTable<StatementRow>
            aria-label={tr('ws.coaching.coachPay.otherBranches')}
            columns={columnsFor(tr, locale, withBranch, true)}
            rows={others}
            rowKey={(r) => r.statement_id}
            dense
          />
        </section>
      )}
    </div>
  );
}

/** Coaches with lessons and no statement for the month, as muted lines (§5.16 "Not drafted"). */
function MissingList({ rows }: { rows: ReturnType<typeof missingRows> }) {
  const { tr, locale } = useLocale();
  if (rows.length === 0) return null;
  return (
    <section aria-label={tr('ws.coaching.coachPay.missing.title')} data-testid="coachPay.missing">
      <ul
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}
      >
        {rows.map((m) => (
          <li key={m.key} style={muted}>
            {tr(m.textKey, {
              coach: isolate(m.coach),
              month: m.month ? monthLabel(m.month, locale) : '',
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
