/**
 * Pay deductions (/deductions), manager and owner (wave5-addendum-2026-09-25
 * §2.5, §5.2; Parsa 2026-10-01, migration 0272: "approval is owner only,
 * managers and heads propose").
 *
 * A head proposes a deduction for someone on their team from the phone, and a
 * manager proposes one here; the owner alone decides it, here or under Wages,
 * and an approved one comes off the person's next unpaid wage. The owner's own
 * entry needs nobody else, so it is recorded approved at once. The page
 * answers three questions, one tab each:
 *
 *  - **Waiting.** What waits on a decision. The owner gets Approve and Decline
 *    (a reason, which the proposer reads), in the decision-dialog shape of the
 *    staff requests. A proposal the viewer sent shows Withdraw instead; any
 *    other waiting row tells a manager it waits for the owner. Each row
 *    follows the server's can_decide and can_withdraw, never a guess.
 *  - **Month.** What comes off each person's pay this month: the approved
 *    total per person, opened to the deductions behind it. A deduction counts
 *    in the person's first unpaid month on or after its approval (V16, 0272),
 *    and one that happened in an earlier month says so. The owner may cancel
 *    an approval, with a reason, until that month's wage is marked paid.
 *  - **All.** Every deduction and what became of it.
 *
 * Money about a named person: nothing here reaches the owner assistant (the
 * server's wall), and the page shows no figure it did not read. A deduction
 * against the viewer never appears here; they read it on their phone (F6).
 * "Propose a deduction" opens inline under the header rather than as a
 * dialog, so the list it adds to stays in view.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatIQD, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, ErrorText } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Pagination,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { DK, fetchDeductionsWaiting } from './api';
import {
  DEDUCTIONS_PAGE_SIZE,
  deductionTone,
  deductionsWaitingCount,
  isStaleRefusal,
  ownerRecordsAtOnce,
  readDeductionsPage,
  waitingAction,
  type DeductionRow,
  type DeductionTab,
} from './deductionsLogic';
import { refusalCode } from '../protocols/errors';
import { DeductionsMonthView } from './DeductionsMonth';
import { ProposeDeduction } from './ProposeDeduction';
import { CancelDialog, DecideDialog, type DeductionRef } from './DeductionDialogs';
import { dayLabel, monthLabel } from './venueDate';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function DeductionsPageScreen() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<DeductionTab>('waiting');
  const [proposing, setProposing] = useState(false);
  const [deciding, setDeciding] = useState<{ row: DeductionRow; approve: boolean } | null>(null);
  const [withdrawing, setWithdrawing] = useState<DeductionRow | null>(null);
  const [cancelling, setCancelling] = useState<DeductionRef | null>(null);

  const waitingQ = useQuery({ queryKey: QK.deductionsWaiting, queryFn: fetchDeductionsWaiting, refetchInterval: 60_000 });
  // What the viewer can decide, as the rail counts it: their own proposals wait too, for someone else.
  const waitingCount = deductionsWaitingCount(waitingQ.data);
  const refresh = () => void qc.invalidateQueries({ queryKey: DK.all });

  const withdraw = useMutation({
    mutationFn: (id: string) => appRpc('withdraw_deduction', { p_id: id }),
    onSuccess: () => {
      toast.ok(tr('ws.deductions.withdraw.done'));
      setWithdrawing(null);
      refresh();
    },
    // Decided in the meantime: the message stays, and the list catches up behind it.
    onError: (e) => isStaleRefusal(refusalCode(e)) && refresh(),
  });

  return (
    <div style={{ maxInlineSize: '84rem' }}>
      <PageHeader
        title={tr('ws.deductions.title')}
        subtitle={tr('ws.deductions.lead')}
        actions={
          can(staff?.role, 'proposeDeductions') && !proposing ? (
            <Button kind="primary" icon="plus" onClick={() => setProposing(true)} data-testid="deductions.propose">
              {tr(ownerRecordsAtOnce(staff?.role) ? 'ws.deductions.propose.openOwner' : 'ws.deductions.propose.open')}
            </Button>
          ) : undefined
        }
      />

      {proposing && (
        <ProposeDeduction
          onClose={() => setProposing(false)}
          onSent={() => {
            setProposing(false);
            refresh();
          }}
        />
      )}

      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <SegmentedControl<DeductionTab>
          aria-label={tr('ws.deductions.tabsLabel')}
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'waiting',
              label: waitingCount > 0 ? tr('ws.deductions.tab.waitingCount', { count: formatNumber(waitingCount, locale) }) : tr('ws.deductions.tab.waiting'),
            },
            { value: 'month', label: tr('ws.deductions.tab.month') },
            { value: 'all', label: tr('ws.deductions.tab.all') },
          ]}
        />
      </div>

      {tab === 'month' ? (
        <DeductionsMonthView onCancel={setCancelling} />
      ) : (
        <DeductionList
          key={tab}
          filter={tab}
          onDecide={(row, approve) => setDeciding({ row, approve })}
          onWithdraw={setWithdrawing}
          onCancel={(r) => setCancelling({ id: r.id, staffName: r.staffName, amountIqd: r.amountIqd })}
        />
      )}

      {deciding && (
        <DecideDialog
          row={deciding.row}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            refresh();
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          target={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        kind="danger"
        title={tr('ws.deductions.withdraw.title')}
        body={
          withdrawing ? (
            <>
              <p style={{ marginBlockStart: 0 }}>
                {tr('ws.deductions.withdraw.body', { name: isolate(withdrawing.staffName), amount: isolate(formatIQD(withdrawing.amountIqd, locale)) })}
              </p>
              <ErrorText error={withdraw.error} />
            </>
          ) : undefined
        }
        confirmLabel={tr('ws.deductions.withdraw.confirm')}
        cancelLabel={tr('ws.deductions.withdraw.keep')}
        busy={withdraw.isPending}
        onConfirm={() => withdrawing && withdraw.mutate(withdrawing.id)}
        onCancel={() => {
          withdraw.reset();
          setWithdrawing(null);
        }}
      />
    </div>
  );
}

/** A person's name over their role. */
function Person({ name, role }: { name: string; role: DeductionRow['staffRole'] }) {
  const { tr } = useLocale();
  return (
    // A name and its role stay on one line each: the reason column, not the
    // person's name, is the one that wraps.
    <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', whiteSpace: 'nowrap' }}>
      <bdi style={{ fontWeight: 600 }}>{name || '—'}</bdi>
      {role && <span style={muted}>{tr(`op.roles.${role}`)}</span>}
    </span>
  );
}

/**
 * Waiting or All, from app.deductions_page. Waiting's first page is the rail
 * badge's own read (QK.deductionsWaiting); every other page keeps its own key.
 */
function DeductionList({
  filter,
  onDecide,
  onWithdraw,
  onCancel,
}: {
  filter: 'waiting' | 'all';
  onDecide: (row: DeductionRow, approve: boolean) => void;
  onWithdraw: (row: DeductionRow) => void;
  onCancel: (row: DeductionRow) => void;
}) {
  const { tr, locale } = useLocale();
  const [page, setPage] = useState(1);
  const offset = (page - 1) * DEDUCTIONS_PAGE_SIZE;
  const shared = filter === 'waiting' && offset === 0;
  const sharedQ = useQuery({ queryKey: QK.deductionsWaiting, queryFn: fetchDeductionsWaiting, refetchInterval: 60_000, enabled: shared });
  const ownQ = useQuery({
    queryKey: DK.page(filter, offset),
    queryFn: () => appRpc<unknown>('deductions_page', { p_filter: filter, p_limit: DEDUCTIONS_PAGE_SIZE, p_offset: offset }),
    enabled: !shared,
    refetchInterval: 60_000,
  });
  const q = shared ? sharedQ : ownQ;
  const data = readDeductionsPage(q.data);
  const pageCount = Math.ceil(data.total / DEDUCTIONS_PAGE_SIZE);

  const columns: Column<DeductionRow>[] = [
    {
      key: 'person',
      header: tr('ws.deductions.cols.person'),
      render: (r) => <Person name={r.staffName} role={r.staffRole} />,
      truncateTitle: (r) => r.staffName,
    },
    {
      key: 'amount',
      header: tr('ws.deductions.cols.amount'),
      numeric: true,
      // An amount never breaks between its figure and its unit.
      render: (r) => <Money amount={r.amountIqd} strong style={{ whiteSpace: 'nowrap' }} />,
      truncateTitle: (r) => String(r.amountIqd),
    },
    {
      key: 'date',
      header: tr('ws.deductions.cols.date'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>{dayLabel(r.deductionDate, locale)}</span>
          {r.payMonth && <PayMonthLine month={r.payMonth} earlier={r.datedEarlier} />}
        </span>
      ),
      truncateTitle: (r) => dayLabel(r.deductionDate, locale),
    },
    {
      key: 'reason',
      header: tr('ws.deductions.cols.reason'),
      // No fixed width: the reason takes what the person and proposer columns leave.
      render: (r) => (
        <span dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {r.reason}
        </span>
      ),
      truncateTitle: (r) => r.reason,
    },
    {
      key: 'proposed',
      header: tr('ws.deductions.cols.proposedBy'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <Person name={r.proposedByName ?? ''} role={r.proposedByRole} />
          {r.proposedAt && <span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(new Date(r.proposedAt), locale)}</span>}
        </span>
      ),
      truncateTitle: (r) => r.proposedByName ?? '',
    },
    ...(filter === 'all'
      ? [
          {
            key: 'status',
            header: tr('ws.deductions.cols.status'),
            render: (r: DeductionRow) => <StatusCell row={r} />,
            truncateTitle: (r: DeductionRow) => tr(`work.deduction.status.${r.status}`),
          },
        ]
      : []),
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (r) => <RowButtons row={r} onDecide={onDecide} onWithdraw={onWithdraw} onCancel={onCancel} />,
      truncateTitle: () => '',
    },
  ];

  return (
    <>
      <AsyncStateWrapper
        status={q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : data.rows.length === 0 ? 'empty' : 'ready'}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={4} />}
        emptyContent={
          <EmptyState
            kind={filter === 'waiting' ? 'nothingToDo' : 'initial'}
            icon={filter === 'waiting' ? 'checkCircle' : 'banknote'}
            title={tr(filter === 'waiting' ? 'ws.deductions.empty.waiting' : 'ws.deductions.empty.all')}
            body={tr(filter === 'waiting' ? 'ws.deductions.empty.waitingBody' : 'ws.deductions.empty.allBody')}
          />
        }
      >
        <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.id} aria-label={tr(`ws.deductions.tab.${filter}`)} />
        {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onChange={setPage} />}
      </AsyncStateWrapper>
    </>
  );
}

/** "Counts in October 2026", amber when it happened in an earlier month (V16, §8 Q9). */
export function PayMonthLine({ month, earlier }: { month: string; earlier: boolean }) {
  const { tr, locale } = useLocale();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-1)',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: earlier ? 600 : 400,
        color: earlier ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)',
      }}
    >
      {earlier && <Icon name="clock" size={12} />}
      {tr(earlier ? 'ws.deductions.paidInEarlier' : 'ws.deductions.paidIn', { month: monthLabel(month, locale) })}
    </span>
  );
}

/** The status word, who settled it and when, and the note or reason that came with it. */
function StatusCell({ row: r }: { row: DeductionRow }) {
  const { tr, locale } = useLocale();
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), locale) : '');
  return (
    <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
      <StatusBadge size="sm" tone={deductionTone(r.status)} label={tr(`work.deduction.status.${r.status}`)} />
      {r.decidedByName && r.decidedAt && (
        <span style={muted}>{tr('ws.deductions.decidedBy', { name: isolate(r.decidedByName), time: when(r.decidedAt) })}</span>
      )}
      {r.decisionNote && (
        <span dir="auto" style={{ ...muted, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {tr('ws.deductions.noteLine', { note: isolate(r.decisionNote) })}
        </span>
      )}
      {r.status === 'cancelled' && r.cancelledByName && r.cancelledAt && (
        <span style={muted}>{tr('ws.deductions.cancelledBy', { name: isolate(r.cancelledByName), time: when(r.cancelledAt) })}</span>
      )}
      {r.cancelReason && (
        <span dir="auto" style={{ ...muted, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {tr('ws.deductions.reasonLine', { reason: isolate(r.cancelReason) })}
        </span>
      )}
    </span>
  );
}

/**
 * What a row offers: Approve and Decline when the viewer may decide it (the
 * owner); Withdraw on the viewer's own proposal, with who decides it; a muted
 * "waiting for the owner" line on anyone else's waiting proposal; Cancel on an
 * approval the owner may still take back. Nothing on a settled row.
 */
function RowButtons({
  row,
  onDecide,
  onWithdraw,
  onCancel,
}: {
  row: DeductionRow;
  onDecide: (row: DeductionRow, approve: boolean) => void;
  onWithdraw: (row: DeductionRow) => void;
  onCancel: (row: DeductionRow) => void;
}) {
  const { tr } = useLocale();
  const action = waitingAction(row);
  if (action === 'decide') {
    return (
      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button size="sm" kind="primary" icon="check" onClick={() => onDecide(row, true)} data-testid={`deductions.approve.${row.id}`}>
          {tr('ws.deductions.approve')}
        </Button>
        <Button size="sm" icon="x" onClick={() => onDecide(row, false)} data-testid={`deductions.decline.${row.id}`}>
          {tr('ws.deductions.decline')}
        </Button>
      </span>
    );
  }
  if (action === 'withdraw') {
    return (
      <span style={{ display: 'inline-grid', gap: 'var(--tp-sp-1)', justifyItems: 'end' }}>
        <span style={{ ...muted, textAlign: 'end', maxInlineSize: '16rem' }}>{tr('ws.deductions.yours')}</span>
        <Button size="sm" kind="ghost" icon="undo" onClick={() => onWithdraw(row)} data-testid={`deductions.withdraw.${row.id}`}>
          {tr('ws.deductions.withdraw.open')}
        </Button>
      </span>
    );
  }
  if (action === 'awaitingOwner') {
    return (
      <span style={{ ...muted, display: 'inline-block', textAlign: 'end', maxInlineSize: '16rem' }} data-testid={`deductions.awaiting.${row.id}`}>
        {tr('ws.deductions.waitingForOwner')}
      </span>
    );
  }
  if (row.canCancel) {
    return (
      <Button size="sm" kind="ghost" icon="ban" onClick={() => onCancel(row)} data-testid={`deductions.cancel.${row.id}`}>
        {tr('ws.deductions.cancel.open')}
      </Button>
    );
  }
  return null;
}
