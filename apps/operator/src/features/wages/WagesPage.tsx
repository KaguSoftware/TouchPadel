/**
 * Wages (/wages), the owner only (0270–0272; Parsa 2026-10-01).
 *
 * Every worker has a monthly salary and a pay day the owner sets, and the
 * page answers, top to bottom:
 *
 *  - **Due now.** Every unpaid month whose pay day is within the reminder
 *    window or past, earlier months included (app.wages_due, the rail badge's
 *    own read), each with Mark paid.
 *  - **Deductions to approve.** What heads and managers proposed; only the
 *    owner decides (0272), through the dialogs /deductions uses too.
 *  - **No salary yet.** Who has no rate on record at the branch.
 *  - **The month.** Per person: salary, pay day, approved deductions,
 *    lateness, the net and where it stands, with Set salary, Mark paid, Undo
 *    and Deduct; a row opens to the deductions and late days behind it.
 *
 * Every figure is the server's (app.wage_line adds a month up); nothing here
 * sums money. A paid month answers from its snapshot. Money about a named
 * person: nothing here reaches the owner assistant.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { countPhrase, formatDateTime, formatIQD, formatNumber, isolate } from '@touch/i18n';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useCafeSettings, useSetCafeSettings } from '../../lib/settings';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field } from '../../components/ui';
import { CountInput } from '../../components/inputs';
import { AsyncStateWrapper, DataTable, EmptyState, Money, PageHeader, Panel, StatusBadge, TableSkeleton, ViewMore, useListCap, type Column } from '../../components/kit';
import { ChevronBack, ChevronForward } from '../../components/icons';
import { CardTitle } from '../ops/OpsVisuals';
import { fetchDeductionsWaiting } from '../deductions/api';
import { readDeductionsPage, type DeductionRow } from '../deductions/deductionsLogic';
import { DecideDialog } from '../deductions/DeductionDialogs';
import { ProposeDeduction } from '../deductions/ProposeDeduction';
import { dayLabel, monthLabel, shiftMonth } from '../deductions/venueDate';
import { WK, fetchWagesDue, fetchWagesMonth } from './api';
import {
  canMarkPaid,
  canStepWageForward,
  canUndoPaid,
  readWagesDue,
  readWagesMonth,
  unsetPeople,
  wageTone,
  type WageDueRow,
  type WagePerson,
  type WagesMonth,
} from './wagesLogic';
import { DueWhenText } from './DueWhenText';
import { SetWageDialog, type WageTarget } from './SetWageDialog';
import { MarkPaidDialog, type PayTarget } from './MarkPaidDialog';
import { UndoPaidDialog, type UndoTarget } from './UndoPaidDialog';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
const REMIND_MAX = 14;

/** The month "Mark paid" is about: found afresh in each read, so a refetch reaches the open dialog. */
interface PayingRef {
  staffId: string;
  month: string;
  snapshot: PayTarget;
}

export function WagesPageScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // null is "this month": the server answers which month that is.
  const [month, setMonth] = useState<string | null>(null);
  const currentQ = useQuery({ queryKey: WK.month(null), queryFn: () => fetchWagesMonth(null), refetchInterval: 60_000 });
  const pickedQ = useQuery({ queryKey: WK.month(month), queryFn: () => fetchWagesMonth(month), enabled: month !== null });
  const q = month === null ? currentQ : pickedQ;
  const current = readWagesMonth(currentQ.data).currentMonth;
  const data = readWagesMonth(q.data);
  const shown = month ?? data.month ?? current;
  const isCurrent = shown !== null && shown === current;

  const dueQ = useQuery({ queryKey: QK.wagesDue, queryFn: fetchWagesDue, refetchInterval: 60_000 });
  const due = readWagesDue(dueQ.data);
  const waitingQ = useQuery({ queryKey: QK.deductionsWaiting, queryFn: fetchDeductionsWaiting, refetchInterval: 60_000 });
  const toDecide = readDeductionsPage(waitingQ.data).rows.filter((r) => r.status === 'waiting' && r.canDecide);

  const [setting, setSetting] = useState<WageTarget | null>(null);
  const [paying, setPaying] = useState<PayingRef | null>(null);
  const [undoing, setUndoing] = useState<UndoTarget | null>(null);
  const [deducting, setDeducting] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ row: DeductionRow; approve: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: WK.all });
    void qc.invalidateQueries({ queryKey: ['deductions'] });
  };

  /** A person's waiting proposals are theirs, not a month's: read them off the loaded month. */
  const waitingOf = (staffId: string) => (currentQ.data ? readWagesMonth(currentQ.data) : data).people.find((p) => p.staffId === staffId)?.waitingCount;
  const payLine = (ref: PayingRef): PayTarget => {
    const fromMonth = data.month === ref.month ? data.people.find((p) => p.staffId === ref.staffId) : undefined;
    if (fromMonth) return fromMonth;
    const fromDue = due.people.find((p) => p.staffId === ref.staffId && p.month === ref.month);
    return fromDue ? { ...fromDue, waitingCount: waitingOf(ref.staffId) } : ref.snapshot;
  };
  const startPaying = (line: PayTarget) => setPaying({ staffId: line.staffId, month: line.month, snapshot: line });
  const startSetting = (p: WagePerson) => setSetting({ staffId: p.staffId, displayName: p.displayName, status: p.status, salaryIqd: p.salaryIqd, payDay: p.payDay });
  const startUndo = (p: WagePerson) =>
    p.payment && setUndoing({ paymentId: p.payment.id, displayName: p.displayName, month: p.month, paidIqd: p.payment.paidIqd });

  const unset = unsetPeople(data);
  const expandedPerson = expanded ? data.people.find((p) => p.staffId === expanded) : undefined;

  return (
    <div style={{ maxInlineSize: '88rem' }}>
      <PageHeader
        title={tr('ws.wages.title')}
        subtitle={tr('ws.wages.lead')}
        actions={
          <>
            <Button kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/attendance' })} data-testid="wages.link.attendance">
              {tr('ws.wages.links.attendance')}
            </Button>
            <Button kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/deductions' })} data-testid="wages.link.deductions">
              {tr('ws.wages.links.deductions')}
            </Button>
          </>
        }
      />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', marginBlockEnd: 'var(--tp-sp-4)' }}>
        {due.count > 0 && <DueNow rows={due.people} remindDays={due.remindDays} onPay={(r) => startPaying({ ...r, waitingCount: waitingOf(r.staffId) })} />}
        {toDecide.length > 0 && <ToDecide rows={toDecide} onDecide={(row, approve) => setDeciding({ row, approve })} />}
        {unset.length > 0 && <UnsetPanel people={unset} onSet={startSetting} />}
        <RemindControl />
      </div>

      <section aria-labelledby="wages-month-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
          <Button aria-label={tr('ws.kit.calendar.prevMonth')} disabled={shown === null} onClick={() => shown && setMonth(shiftMonth(shown, -1))} data-testid="wages.month.prev">
            <ChevronBack size={16} />
          </Button>
          <h2 id="wages-month-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, minInlineSize: '11rem', textAlign: 'center' }}>
            {shown ? monthLabel(shown, locale) : tr('common.loading')}
          </h2>
          <Button
            aria-label={tr('ws.kit.calendar.nextMonth')}
            disabled={!canStepWageForward(shown, current)}
            onClick={() => shown && setMonth(shiftMonth(shown, 1) === current ? null : shiftMonth(shown, 1))}
            data-testid="wages.month.next"
          >
            <ChevronForward size={16} />
          </Button>
          {!isCurrent && current && (
            <Button kind="ghost" size="sm" onClick={() => setMonth(null)}>
              {tr('ws.wages.month.thisMonth')}
            </Button>
          )}
        </div>

        {q.data !== undefined && <Totals data={data} />}

        {deducting && (
          <ProposeDeduction
            key={deducting}
            initialStaffId={deducting}
            onClose={() => setDeducting(null)}
            onSent={() => {
              setDeducting(null);
              refresh();
            }}
          />
        )}

        <MonthTable
          q={q}
          data={data}
          shown={shown}
          expanded={expanded}
          onToggle={(id) => setExpanded((e) => (e === id ? null : id))}
          onSet={startSetting}
          onPay={startPaying}
          onUndo={startUndo}
          onDeduct={(id) => setDeducting(id)}
        />

        {expandedPerson && <PersonDetails person={expandedPerson} />}
      </section>

      {setting && (
        <SetWageDialog
          target={setting}
          currentMonth={data.currentMonth ?? current}
          onClose={() => setSetting(null)}
          onDone={() => {
            setSetting(null);
            refresh();
          }}
        />
      )}
      {paying && (
        <MarkPaidDialog
          line={payLine(paying)}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            refresh();
          }}
        />
      )}
      {undoing && (
        <UndoPaidDialog
          target={undoing}
          onClose={() => setUndoing(null)}
          onDone={() => {
            setUndoing(null);
            refresh();
          }}
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
    </div>
  );
}

/** Staff with no salary set yet, each with Set salary. */
function UnsetPanel({ people, onSet }: { people: WagePerson[]; onSet: (p: WagePerson) => void }) {
  const { tr } = useLocale();
  const cap = useListCap(people);
  return (
    <Panel muted title={<CardTitle icon="info">{tr('ws.wages.unset.title')}</CardTitle>} data-testid="wages.unset">
      <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.wages.unset.lead')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
        {cap.shown.map((p) => (
          <li key={p.staffId} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <bdi style={{ fontWeight: 600 }}>{p.displayName}</bdi>
            <Button size="sm" icon="banknote" onClick={() => onSet(p)} data-testid={`wages.unset.set.${p.staffId}`}>
              {tr('ws.wages.actions.setSalary')}
            </Button>
          </li>
        ))}
      </ul>
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}

/** Every unpaid month due now or overdue, earliest pay day first, each with Mark paid. */
function DueNow({ rows, remindDays, onPay }: { rows: WageDueRow[]; remindDays: number | null; onPay: (row: WageDueRow) => void }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(rows);
  return (
    <Panel title={<CardTitle icon="bell">{tr('ws.wages.due.title')}</CardTitle>} data-testid="wages.due">
      {remindDays !== null && <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.wages.due.lead', { days: formatNumber(remindDays, locale) })}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {cap.shown.map((r) => (
          <li
            key={`${r.staffId}:${r.month}`}
            data-testid={`wages.due.row.${r.staffId}.${r.month}`}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-2)', borderBlockEnd: '1px solid var(--tp-border)' }}
          >
            <bdi style={{ fontWeight: 600, minInlineSize: '9rem' }}>{r.displayName}</bdi>
            <span style={{ minInlineSize: '8rem' }}>{monthLabel(r.month, locale)}</span>
            {r.dueDate && <span style={muted}>{tr('ws.wages.due.payDay', { date: dayLabel(r.dueDate, locale) })}</span>}
            <DueWhenText daysLeft={r.daysLeft} />
            <Money amount={r.netIqd} strong style={{ marginInlineStart: 'auto', whiteSpace: 'nowrap', ...(r.netIqd < 0 ? { color: 'var(--tp-danger-fg)' } : null) }} />
            <Button size="sm" kind="primary" icon="check" onClick={() => onPay(r)} data-testid={`wages.due.pay.${r.staffId}.${r.month}`}>
              {tr('ws.wages.actions.markPaid')}
            </Button>
          </li>
        ))}
      </ul>
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}

/** The proposals waiting on the owner: approve or decline each, as /deductions does. */
function ToDecide({ rows, onDecide }: { rows: DeductionRow[]; onDecide: (row: DeductionRow, approve: boolean) => void }) {
  const { tr } = useLocale();
  const cap = useListCap(rows);
  return (
    <Panel title={<CardTitle icon="banknote">{tr('ws.wages.approve.title')}</CardTitle>} data-testid="wages.approve">
      <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.wages.approve.lead')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {cap.shown.map((r) => (
          <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-2)', borderBlockEnd: '1px solid var(--tp-border)' }}>
            <Money amount={r.amountIqd} strong style={{ whiteSpace: 'nowrap', minInlineSize: '7rem' }} />
            <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: '9rem' }}>
              <bdi style={{ fontWeight: 600 }}>{r.staffName}</bdi>
              {r.staffRole && <span style={muted}>{tr(`op.roles.${r.staffRole}`)}</span>}
            </span>
            <span dir="auto" style={{ flex: '1 1 14rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {r.reason}
            </span>
            {r.proposedByName && <span style={muted}>{tr('ws.wages.approve.proposedBy', { name: isolate(r.proposedByName) })}</span>}
            <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', marginInlineStart: 'auto' }}>
              <Button size="sm" kind="primary" icon="check" onClick={() => onDecide(r, true)} data-testid={`wages.approve.${r.id}`}>
                {tr('ws.deductions.approve')}
              </Button>
              <Button size="sm" icon="x" onClick={() => onDecide(r, false)} data-testid={`wages.decline.${r.id}`}>
                {tr('ws.deductions.decline')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}

/** "Remind me this many days before each pay day": wage_reminder_days, the owner's own setting. */
function RemindControl() {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { settings, isSuccess } = useCafeSettings();
  const saved = settings.wage_reminder_days;
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? saved;
  const save = useSetCafeSettings();
  const commit = useMutation({
    mutationFn: () => save.mutateAsync([{ key: 'wage_reminder_days', value }]),
    onSuccess: () => {
      toast.ok(tr('ws.wages.remind.saved'));
      setDraft(null);
      // The due list and every month's statuses read the window.
      void qc.invalidateQueries({ queryKey: WK.all });
    },
  });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
      <Field label={tr('ws.wages.remind.label')} hint={tr('ws.wages.remind.hint')} style={{ marginBlockEnd: 0 }}>
        <CountInput value={value} min={0} max={REMIND_MAX} disabled={commit.isPending} onChange={setDraft} />
      </Field>
      {(draft !== null && draft !== saved) || commit.isPending ? (
        <Button size="sm" kind="primary" busy={commit.isPending} disabled={!isSuccess && !commit.isPending} onClick={() => commit.mutate()} data-testid="wages.remind.save">
          {tr('ws.wages.remind.save')}
        </Button>
      ) : null}
      <ErrorText error={commit.error} />
    </div>
  );
}

/** The month in five labelled figures, each the server's sum. */
function Totals({ data }: { data: WagesMonth }) {
  const { tr } = useLocale();
  const t = data.totals;
  const items: [string, number, boolean][] = [
    [tr('ws.wages.totals.salary'), t.salaryIqd, false],
    [tr('ws.wages.totals.deductions'), t.deductionsIqd, false],
    [tr('ws.wages.totals.penalties'), t.penaltiesIqd, false],
    [tr('ws.wages.totals.net'), t.netIqd, true],
    [tr('ws.wages.totals.paid'), t.paidIqd, false],
  ];
  return (
    <dl data-testid="wages.totals" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2) var(--tp-sp-6)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)' }}>
      {items.map(([label, amount, strong]) => (
        <div key={label} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <dt style={muted}>{label}</dt>
          <dd style={{ margin: 0, fontSize: 'var(--tp-fs-lg)' }}>
            <Money amount={amount} strong={strong} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MonthTable({
  q,
  data,
  shown,
  expanded,
  onToggle,
  onSet,
  onPay,
  onUndo,
  onDeduct,
}: {
  q: { isError: boolean; data: unknown; error: unknown; refetch: () => unknown };
  data: WagesMonth;
  shown: string | null;
  expanded: string | null;
  onToggle: (staffId: string) => void;
  onSet: (p: WagePerson) => void;
  onPay: (p: WagePerson) => void;
  onUndo: (p: WagePerson) => void;
  onDeduct: (staffId: string) => void;
}) {
  const { tr, locale } = useLocale();
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), locale) : '');
  // Owner's rule (2026-10-08): three people, then "View more". Totals above read the whole month.
  const peopleCap = useListCap(data.people);

  const columns: Column<WagePerson>[] = [
    {
      key: 'person',
      header: tr('ws.wages.cols.person'),
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', whiteSpace: 'nowrap' }}>
          <bdi style={{ fontWeight: 600 }}>{p.displayName || '—'}</bdi>
          {p.role && <span style={muted}>{tr(`op.roles.${p.role}`)}</span>}
          {!p.member && <span style={muted}>{tr('ws.wages.leftBranch')}</span>}
        </span>
      ),
      truncateTitle: (p) => p.displayName,
    },
    {
      key: 'salary',
      header: tr('ws.wages.cols.salary'),
      numeric: true,
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
          {p.status === 'unset' ? <span style={muted}>{tr('ws.wages.salary.notSet')}</span> : <Money amount={p.salaryIqd} strong style={{ whiteSpace: 'nowrap' }} />}
          {p.rateFrom && p.status !== 'paid' && <span style={muted}>{tr('ws.wages.salary.from', { month: monthLabel(p.rateFrom, locale) })}</span>}
          {p.nextRate && (
            <span style={{ ...muted, color: 'var(--tp-info-fg)' }}>
              {tr('ws.wages.salary.next', { amount: isolate(formatIQD(p.nextRate.salaryIqd, locale)), month: monthLabel(p.nextRate.from, locale) })}
            </span>
          )}
        </span>
      ),
      truncateTitle: (p) => String(p.salaryIqd),
    },
    {
      key: 'payDay',
      header: tr('ws.wages.cols.payDay'),
      render: (p) =>
        p.payDay === null ? (
          <span style={muted}>—</span>
        ) : (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span style={{ whiteSpace: 'nowrap' }}>{tr('ws.wages.payDay.day', { day: formatNumber(p.payDay, locale) })}</span>
            {p.dueDate && <span style={{ ...muted, whiteSpace: 'nowrap' }}>{dayLabel(p.dueDate, locale)}</span>}
            {(p.status === 'due' || p.status === 'overdue') && <DueWhenText daysLeft={p.daysLeft} />}
          </span>
        ),
      truncateTitle: (p) => (p.dueDate ? dayLabel(p.dueDate, locale) : ''),
    },
    {
      key: 'deductions',
      header: tr('ws.wages.cols.deductions'),
      numeric: true,
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
          <Money amount={p.deductionsIqd} style={{ whiteSpace: 'nowrap' }} />
          {p.deductionCount > 0 && <span style={muted}>{countPhrase('ws.wages.count.deductions', p.deductionCount, locale)}</span>}
          {p.waitingCount > 0 && <span style={{ ...muted, color: 'var(--tp-warn-fg)', fontWeight: 600 }}>{countPhrase('ws.wages.count.waiting', p.waitingCount, locale)}</span>}
        </span>
      ),
      truncateTitle: (p) => String(p.deductionsIqd),
    },
    {
      key: 'lateness',
      header: tr('ws.wages.cols.lateness'),
      numeric: true,
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
          <Money amount={p.penaltiesIqd} style={{ whiteSpace: 'nowrap' }} />
          {p.penaltyDays > 0 && <span style={muted}>{countPhrase('ws.wages.count.lateDays', p.penaltyDays, locale)}</span>}
        </span>
      ),
      truncateTitle: (p) => String(p.penaltiesIqd),
    },
    {
      key: 'net',
      header: tr('ws.wages.cols.net'),
      numeric: true,
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
          <Money amount={p.netIqd} strong style={{ whiteSpace: 'nowrap', ...(p.netIqd < 0 ? { color: 'var(--tp-danger-fg)' } : null) }} />
          {p.netIqd < 0 && <span style={{ ...muted, color: 'var(--tp-danger-fg)', maxInlineSize: '14rem', whiteSpace: 'normal', textAlign: 'end' }}>{tr('ws.wages.net.negative')}</span>}
        </span>
      ),
      truncateTitle: (p) => String(p.netIqd),
    },
    {
      key: 'status',
      header: tr('ws.wages.cols.status'),
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
          <StatusBadge size="sm" tone={wageTone(p.status)} label={tr(`ws.wages.status.${p.status}`)} />
          {p.payment?.status === 'paid' && p.payment.paidByName && p.payment.paidAt && (
            <span style={muted}>{tr('ws.wages.paidBy', { name: isolate(p.payment.paidByName), time: when(p.payment.paidAt) })}</span>
          )}
          {p.payment?.status === 'undone' && p.payment.undoneByName && p.payment.undoneAt && (
            <span style={muted}>{tr('ws.wages.undoneBy', { name: isolate(p.payment.undoneByName), time: when(p.payment.undoneAt) })}</span>
          )}
        </span>
      ),
      truncateTitle: (p) => tr(`ws.wages.status.${p.status}`),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (p) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', justifyContent: 'flex-end', flexWrap: 'wrap', maxInlineSize: '22rem' }}>
          {canMarkPaid(p) && (
            <Button size="sm" kind="primary" icon="check" onClick={() => onPay(p)} data-testid={`wages.row.pay.${p.staffId}`}>
              {tr('ws.wages.actions.markPaid')}
            </Button>
          )}
          {canUndoPaid(p) && (
            <Button size="sm" kind="ghost" icon="undo" onClick={() => onUndo(p)} data-testid={`wages.row.undo.${p.staffId}`}>
              {tr('ws.wages.actions.undo')}
            </Button>
          )}
          {p.member && (
            <Button size="sm" icon="banknote" onClick={() => onSet(p)} data-testid={`wages.row.set.${p.staffId}`}>
              {tr('ws.wages.actions.setSalary')}
            </Button>
          )}
          {p.member && (
            <Button size="sm" kind="ghost" icon="minus" onClick={() => onDeduct(p.staffId)} data-testid={`wages.row.deduct.${p.staffId}`}>
              {tr('ws.wages.actions.deduct')}
            </Button>
          )}
          <Button
            size="sm"
            kind="ghost"
            icon={expanded === p.staffId ? 'chevronUp' : 'chevronDown'}
            aria-expanded={expanded === p.staffId}
            onClick={() => onToggle(p.staffId)}
            data-testid={`wages.row.details.${p.staffId}`}
          >
            {tr(expanded === p.staffId ? 'ws.wages.actions.hideDetails' : 'ws.wages.actions.details')}
          </Button>
        </span>
      ),
      truncateTitle: () => '',
    },
  ];

  return (
    <AsyncStateWrapper
      status={q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : data.people.length === 0 ? 'empty' : 'ready'}
      error={q.error}
      onRetry={() => void q.refetch()}
      skeleton={<TableSkeleton columns={columns} rows={4} />}
      emptyContent={<EmptyState kind="initial" icon="users" title={tr('ws.wages.empty.title')} body={tr('ws.wages.empty.body')} />}
    >
      <DataTable columns={columns} rows={peopleCap.shown} rowKey={(p) => p.staffId} selectedKey={expanded} aria-label={shown ? monthLabel(shown, locale) : tr('ws.wages.title')} />
      <ViewMore hidden={peopleCap.hidden} open={peopleCap.open} onToggle={peopleCap.toggle} />
    </AsyncStateWrapper>
  );
}

/** A row opened: the month's approved deductions and late or early days behind its figures. */
function PersonDetails({ person: p }: { person: WagePerson }) {
  const { tr, locale } = useLocale();
  const item = { display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-1-5)', borderBlockEnd: '1px solid var(--tp-border)' } as const;
  return (
    <Panel
      title={tr('ws.wages.details.title', { name: isolate(p.displayName), month: monthLabel(p.month, locale) })}
      data-testid={`wages.details.${p.staffId}`}
      style={{ marginBlockStart: 'var(--tp-sp-3)' }}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))' }}>
        <div>
          <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.wages.details.deductions')}</h3>
          {p.deductions.length === 0 ? (
            <p style={muted}>{tr('ws.wages.details.noDeductions')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {p.deductions.map((d) => (
                <li key={d.id} style={item}>
                  <span style={{ ...muted, whiteSpace: 'nowrap' }}>{dayLabel(d.deductionDate, locale)}</span>
                  <span dir="auto" style={{ flex: '1 1 10rem', overflowWrap: 'anywhere' }}>
                    {d.reason}
                  </span>
                  <Money amount={d.amountIqd} strong style={{ whiteSpace: 'nowrap' }} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.wages.details.lateness')}</h3>
          {p.lateness.length === 0 ? (
            <p style={muted}>{tr('ws.wages.details.noLateness')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {p.lateness.map((d) => (
                <li key={d.id} style={item}>
                  <span style={{ ...muted, whiteSpace: 'nowrap' }}>{dayLabel(d.workDate, locale)}</span>
                  <span style={{ flex: '1 1 10rem' }}>
                    {tr('ws.wages.details.minutes', { late: formatNumber(d.lateMinutes, locale), early: formatNumber(d.earlyLeaveMinutes, locale) })}
                    <span style={muted}> · {tr('ws.wages.details.allowed', { minutes: formatNumber(d.graceMinutes, locale) })}</span>
                    {d.note && (
                      <span dir="auto" style={{ ...muted, display: 'block' }}>
                        {d.note}
                      </span>
                    )}
                  </span>
                  <Money amount={d.penaltyIqd} strong style={{ whiteSpace: 'nowrap' }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
