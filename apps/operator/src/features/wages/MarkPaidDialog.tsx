/**
 * Mark a person's month paid (app.mark_wage_paid, the owner only).
 *
 * The dialog shows the month as the server added it up: salary − deductions −
 * lateness = net, and the amount to pay, which is the net or nothing when the
 * net is below zero (nothing carries over). It sends the net it showed as
 * p_expected_net_iqd: a deduction or a late day that landed while it was open
 * comes back WAGE_CHANGED, the page refetches, and the message stays above
 * the new figures until the owner confirms again. One idempotency key per
 * dialog, so a retry after a lost answer never pays twice.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { countPhrase, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter, Money } from '../../components/kit';
import { refusalCode } from '../protocols/errors';
import { dayLabel, monthLabel } from '../deductions/venueDate';
import { WK } from './api';
import { isWageStale, payableIqd, type WageLine } from './wagesLogic';

export interface PayTarget extends WageLine {
  staffId: string;
  displayName: string;
  /** Proposed deductions nobody has decided yet (unknown from the Due now strip alone). */
  waitingCount?: number;
}

export function MarkPaidDialog({ line, onClose, onDone }: { line: PayTarget; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [key] = useState(() => `wage.paid:${crypto.randomUUID()}`);

  const pay = useMutation({
    mutationFn: () =>
      appRpc('mark_wage_paid', {
        p_staff_id: line.staffId,
        p_month: line.month,
        p_expected_net_iqd: line.netIqd,
        p_idempotency_key: key,
      }),
    onSuccess: () => {
      toast.ok(tr('ws.wages.pay.done'));
      onDone();
    },
    // The month moved under the dialog: the message stays, and the figures catch up behind it.
    onError: (e) => isWageStale(refusalCode(e)) && void qc.invalidateQueries({ queryKey: WK.all }),
  });

  const negative = line.netIqd < 0;
  const waiting = line.waitingCount ?? 0;
  const paidAlready = refusalCode(pay.error) === 'WAGE_ALREADY_PAID';

  return (
    <Modal
      title={tr('ws.wages.pay.title', { name: isolate(line.displayName) })}
      subtitle={line.dueDate ? tr('ws.wages.pay.period', { month: monthLabel(line.month, locale), date: dayLabel(line.dueDate, locale) }) : monthLabel(line.month, locale)}
      onClose={onClose}
      dismissible={!pay.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={pay.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="check" busy={pay.isPending} disabled={paidAlready} data-testid="wages.pay.confirm" onClick={() => pay.mutate()}>
            {tr('ws.wages.pay.confirm')}
          </Button>
        </>
      )}
    >
      <dl data-testid="wages.pay.breakdown" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: 'var(--tp-sp-1) var(--tp-sp-4)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)', justifyContent: 'start' }}>
        <Line label={tr('ws.wages.pay.salary')}>
          <Money amount={line.salaryIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.deductions')} note={line.deductionCount > 0 ? countPhrase('ws.wages.count.deductions', line.deductionCount, locale) : undefined}>
          <Money amount={line.deductionsIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.penalties')} note={line.penaltyDays > 0 ? countPhrase('ws.wages.count.lateDays', line.penaltyDays, locale) : undefined}>
          <Money amount={line.penaltiesIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.net')} rule>
          <Money amount={line.netIqd} strong style={negative ? { color: 'var(--tp-danger-fg)' } : undefined} />
        </Line>
        <Line label={tr('ws.wages.pay.toPay')}>
          <Money amount={payableIqd(line.netIqd)} strong style={{ fontSize: 'var(--tp-fs-lg)' }} />
        </Line>
      </dl>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {negative && <MessagePresenter tone="refused" message={tr('ws.wages.pay.belowZero')} />}
        {waiting > 0 && <MessagePresenter tone="info" message={tr('ws.wages.pay.waiting', { deductions: countPhrase('ws.wages.count.deductions', waiting, locale) })} />}
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.wages.pay.frozen')}</p>
      </div>
      <ErrorText error={pay.error} />
    </Modal>
  );
}

function Line({ label, note, rule, children }: { label: string; note?: string; rule?: boolean; children: ReactNode }) {
  const border = rule ? { borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-1)' } : null;
  return (
    <>
      <dt style={{ color: 'var(--tp-muted-fg)', ...border }}>
        {label}
        {note && <span style={{ fontSize: 'var(--tp-fs-xs)' }}> · {note}</span>}
      </dt>
      <dd style={{ margin: 0, textAlign: 'end', ...border }}>{children}</dd>
    </>
  );
}
