/**
 * The Month tab of /deductions (wave5-addendum-2026-09-25 §2.5.3,
 * app.deductions_month): what comes off each person's pay in one month.
 *
 * A deduction counts in the month it was approved in (V16). The month's
 * figures are the server's: the approved total per person and for the venue,
 * with the cancelled ones listed but in no total, and, in the current month
 * only, what is still waiting (a waiting deduction has no pay month yet).
 *
 * One row per person, opened to the deductions behind it; the stepper never
 * passes the current month. The owner cancels an approval from the opened row
 * (cancelDeductions): the dialog is the page's, so the Waiting and All tabs
 * share it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { EmptyState, Money, StatusBadge } from '../../components/kit';
import { ChevronBack, ChevronForward, Icon } from '../../components/icons';
import { DK } from './api';
import { canStepForward, deductionTone, readDeductionsMonth, type MonthPerson } from './deductionsLogic';
import type { DeductionRef } from './DeductionsPage';
import { dayLabel, monthLabel, shiftMonth } from './venueDate';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function DeductionsMonthView({ onCancel }: { onCancel: (target: DeductionRef) => void }) {
  const { tr, locale } = useLocale();
  // null is "this month": the server answers which month that is.
  const [month, setMonth] = useState<string | null>(null);
  const currentQ = useQuery({
    queryKey: DK.month(null),
    queryFn: () => appRpc<unknown>('deductions_month', {}),
    refetchInterval: 60_000,
  });
  const pickedQ = useQuery({
    queryKey: DK.month(month),
    queryFn: () => appRpc<unknown>('deductions_month', { p_month: month }),
    enabled: month !== null,
  });
  const q = month === null ? currentQ : pickedQ;
  const current = readDeductionsMonth(currentQ.data).month;
  const data = readDeductionsMonth(q.data);
  const shown = month ?? current;
  const isCurrent = shown !== null && shown === current;

  return (
    <section aria-labelledby="deductions-month-title">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Button
          aria-label={tr('ws.kit.calendar.prevMonth')}
          disabled={shown === null}
          onClick={() => shown && setMonth(shiftMonth(shown, -1))}
          data-testid="deductions.month.prev"
        >
          <ChevronBack size={16} />
        </Button>
        <h2 id="deductions-month-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, minInlineSize: '11rem', textAlign: 'center' }}>
          {shown ? monthLabel(shown, locale) : tr('common.loading')}
        </h2>
        <Button
          aria-label={tr('ws.kit.calendar.nextMonth')}
          disabled={!canStepForward(shown, current)}
          onClick={() => shown && setMonth(shiftMonth(shown, 1) === current ? null : shiftMonth(shown, 1))}
          data-testid="deductions.month.next"
        >
          <ChevronForward size={16} />
        </Button>
        {!isCurrent && current && (
          <Button kind="ghost" size="sm" onClick={() => setMonth(null)}>
            {tr('ws.deductions.month.thisMonth')}
          </Button>
        )}
      </div>

      {q.isError && q.data === undefined ? (
        <div role="alert" style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('common.retry')}
          </Button>
        </div>
      ) : q.data === undefined ? (
        <Skeleton lines={4} />
      ) : (
        <>
          <Totals data={data} showWaiting={isCurrent} />
          {data.people.length === 0 ? (
            <EmptyState
              kind="nothingToDo"
              icon="banknote"
              title={tr('ws.deductions.month.empty', { month: shown ? monthLabel(shown, locale) : '' })}
              body={tr('ws.deductions.month.emptyBody')}
            />
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                border: '1px solid var(--tp-border)',
                borderRadius: 'var(--tp-radius-panel)',
                background: 'var(--tp-surface)',
                overflow: 'hidden',
              }}
            >
              {data.people.map((p, i) => (
                <PersonRow key={p.staffId} person={p} first={i === 0} onCancel={onCancel} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The month in two labelled figures: what comes off pay (the approved total,
 * with how many deductions make it) and, in the current month, what still
 * waits on a decision. Both are the server's sums.
 */
function Totals({ data, showWaiting }: { data: ReturnType<typeof readDeductionsMonth>; showWaiting: boolean }) {
  const { tr, locale } = useLocale();
  const t = data.totals;
  return (
    <dl
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--tp-sp-2) var(--tp-sp-6)',
        margin: 0,
        marginBlockEnd: 'var(--tp-sp-3)',
        alignItems: 'baseline',
      }}
      data-testid="deductions.month.totals"
    >
      <div>
        <dt style={{ ...muted, fontWeight: 600 }}>{tr('ws.deductions.month.approvedTotal', { count: formatNumber(t.approvedCount, locale) })}</dt>
        <dd style={{ margin: 0, fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>
          <Money amount={t.approvedIqd} />
        </dd>
      </div>
      {showWaiting && t.waitingCount > 0 && (
        <div>
          <dt style={{ ...muted, fontWeight: 600 }}>{tr('ws.deductions.month.waitingLabel', { count: formatNumber(t.waitingCount, locale) })}</dt>
          <dd style={{ margin: 0, color: 'var(--tp-warn-fg)', fontWeight: 600 }}>
            <Money amount={t.waitingIqd} />
          </dd>
        </div>
      )}
    </dl>
  );
}

function PersonRow({ person: p, first, onCancel }: { person: MonthPerson; first: boolean; onCancel: (target: DeductionRef) => void }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const [open, setOpen] = useState(false);
  const panelId = `deductions-person-${p.staffId}`;
  const mayCancel = can(staff?.role, 'cancelDeductions');
  return (
    <li style={{ borderBlockStart: first ? undefined : '1px solid var(--tp-border)' }}>
      <button
        type="button"
        className="tp-row"
        data-clickable="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        data-testid={`deductions.person.${p.staffId}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto auto',
          alignItems: 'center',
          gap: 'var(--tp-sp-4)',
          inlineSize: '100%',
          paddingBlock: 'var(--tp-sp-3)',
          paddingInline: 'var(--tp-sp-4)',
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'start',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', minInlineSize: 0 }}>
          <bdi style={{ fontWeight: 700 }}>{p.displayName}</bdi>
          {p.role && <span style={muted}>{tr(`op.roles.${p.role}`)}</span>}
          {!p.isActive && <StatusBadge size="sm" tone="neutral" label={tr('ws.deductions.month.leftStaff')} />}
        </span>
        {/* What comes off this person's pay; someone with nothing approved yet
            shows what waits instead of a zero. */}
        <span style={{ display: 'grid', justifyItems: 'end', gap: 'var(--tp-sp-0)' }}>
          {p.approvedCount > 0 ? (
            <>
              <Money amount={p.approvedIqd} strong />
              <span style={muted}>
                {tr('ws.deductions.month.personCount', { count: formatNumber(p.approvedCount, locale) })}
                {p.waitingCount > 0 && ` · ${tr('ws.deductions.month.personWaiting', { count: formatNumber(p.waitingCount, locale) })}`}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: p.waitingCount > 0 ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }}>
              {p.waitingCount > 0
                ? tr('ws.deductions.month.personWaiting', { count: formatNumber(p.waitingCount, locale) })
                : tr('ws.deductions.month.nothingApproved')}
            </span>
          )}
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} style={{ color: 'var(--tp-muted-fg)' }} />
      </button>
      {open && (
        <ul id={panelId} style={{ listStyle: 'none', margin: 0, paddingBlock: 'var(--tp-sp-1) var(--tp-sp-3)', paddingInline: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {p.deductions.map((d) => (
            <li
              key={d.id}
              data-testid={`deductions.item.${d.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(7rem, auto) minmax(0, 1fr) auto',
                gap: 'var(--tp-sp-1) var(--tp-sp-4)',
                alignItems: 'start',
                paddingBlock: 'var(--tp-sp-2)',
                paddingInline: 'var(--tp-sp-3)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface-2)',
              }}
            >
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                <Money amount={d.amountIqd} strong style={d.status === 'cancelled' ? { textDecoration: 'line-through', color: 'var(--tp-muted-fg)' } : undefined} />
                <span style={{ ...muted, whiteSpace: 'nowrap' }}>{dayLabel(d.deductionDate, locale)}</span>
                {d.datedEarlier && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-warn-fg)' }}>
                    <Icon name="clock" size={12} />
                    {tr('ws.deductions.month.earlier', { month: monthLabel(`${d.deductionDate.slice(0, 7)}-01`, locale) })}
                  </span>
                )}
              </span>
              <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                <span dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {d.reason}
                </span>
                <span style={muted}>
                  {[
                    d.proposedByName ? tr('ws.deductions.month.proposedBy', { name: isolate(d.proposedByName) }) : null,
                    d.decidedByName && d.decidedAt ? tr('ws.deductions.month.approvedBy', { name: isolate(d.decidedByName), time: formatDateTime(new Date(d.decidedAt), locale) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'end' }}>
                <StatusBadge size="sm" tone={deductionTone(d.status)} label={tr(`work.deduction.status.${d.status}`)} />
                {mayCancel && d.status === 'approved' && (
                  <Button size="sm" kind="ghost" icon="ban" onClick={() => onCancel({ id: d.id, staffName: p.displayName, amountIqd: d.amountIqd })} data-testid={`deductions.cancel.${d.id}`}>
                    {tr('ws.deductions.cancel.open')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
