/**
 * Mark a person's month paid (app.mark_wage_paid, the owner only).
 *
 * The dialog shows the month as the server added it up: salary − deductions −
 * lateness + bonuses = net, and the amount to pay, which is the net or nothing
 * when the net is below zero (nothing carries over). Under it, every reward
 * the month carries (0333), prize-only ones too, so a prize is handed over
 * with the wage. It sends the net it showed as
 * p_expected_net_iqd: a deduction or a late day that landed while it was open
 * comes back WAGE_CHANGED, the page refetches, and the message stays above
 * the new figures until the owner confirms again. One idempotency key per
 * dialog, so a retry after a lost answer never pays twice.
 *
 * 0344: the advances already given come off between the net and the amount
 * handed over now (the server's to_pay_iqd, sent back as
 * p_expected_paid_iqd), and "Paid from" (Safe, preselected, or Bank transfer)
 * says where that money came from: from the safe it leaves the main cash.
 *
 * F-13: the idempotency key is bound to the values sent (keyForValues), so a
 * retry after a lost answer with a different "Paid from" is its own write and
 * the toast names what was recorded; the dialog is online only (disabled with
 * the reason offline). F-12 (0387): from the safe, an amount above its
 * balance is refused, shown before the press.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { countPhrase, formatIQD, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter, Money } from '../../components/kit';
import { refusalCode } from '../protocols/errors';
import { dayLabel, monthLabel } from '../deductions/venueDate';
import { WK } from './api';
import { useSafeBalance } from '../safe/api';
import { isWageStale, keyForValues, safeShort, type PaidFrom, type WageLine } from './wagesLogic';
import { BonusList } from './BonusList';
import { PaidFromField } from './PaidFromField';

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
  const keys = useRef(new Map<string, string>());
  const [paidFrom, setPaidFrom] = useState<PaidFrom>('safe');
  const { reachable } = useStationReach();
  const safeBalance = useSafeBalance(line.toPayIqd > 0);

  const pay = useMutation({
    // The values sent ride with the call, so the toast names exactly what was recorded.
    mutationFn: async (from: PaidFrom) => {
      await appRpc('mark_wage_paid', {
        p_staff_id: line.staffId,
        p_month: line.month,
        p_expected_net_iqd: line.netIqd,
        p_expected_paid_iqd: line.toPayIqd,
        p_paid_from: from,
        p_idempotency_key: keyForValues(
          keys.current,
          [line.staffId, line.month, line.netIqd, line.toPayIqd, from],
          () => `wage.paid:${crypto.randomUUID()}`,
        ),
      });
      return from;
    },
    onSuccess: (from) => {
      const amount = isolate(formatIQD(line.toPayIqd, locale));
      toast.ok(line.toPayIqd > 0 ? tr(from === 'safe' ? 'ws.wages.pay.doneSafe' : 'ws.wages.pay.doneBank', { amount }) : tr('ws.wages.pay.done'));
      void qc.invalidateQueries({ queryKey: ['main-cash'] });
      onDone();
    },
    // The month moved under the dialog: the message stays, and the figures catch up behind it.
    onError: (e) => {
      const code = refusalCode(e);
      if (isWageStale(code)) void qc.invalidateQueries({ queryKey: WK.all });
      if (code === 'SAFE_NOT_ENOUGH') void qc.invalidateQueries({ queryKey: ['main-cash'] });
    },
  });

  const short = line.toPayIqd > 0 && safeShort(line.toPayIqd, paidFrom, safeBalance);
  const blocked = !reachable ? tr('ws.wages.paidFrom.offline') : short ? tr('ws.wages.paidFrom.safeShort', { amount: isolate(formatIQD(Math.max(safeBalance ?? 0, 0), locale)) }) : null;

  const negative = line.netIqd < 0;
  const advanced = line.advancesIqd > 0;
  // The advances covered the month exactly, or more than it (a deduction approved after them).
  const covered = advanced && !negative && line.toPayIqd === 0 && line.owedIqd === 0;
  const overAdvanced = advanced && !negative && line.owedIqd < 0;
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
          <Button
            kind="primary"
            icon="check"
            busy={pay.isPending}
            disabled={paidAlready || blocked !== null}
            disabledReason={blocked ?? undefined}
            data-testid="wages.pay.confirm"
            onClick={() => pay.mutate(paidFrom)}
          >
            {tr('ws.wages.pay.confirm')}
          </Button>
        </>
      )}
    >
      <dl data-testid="wages.pay.breakdown" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: 'var(--tp-sp-1) var(--tp-sp-4)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)', justifyContent: 'start' }}>
        <Line label={tr('ws.wages.pay.salary')} note={line.bonusOnly ? tr('ws.wages.salary.bonusOnly') : undefined}>
          <Money amount={line.salaryIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.deductions')} note={line.deductionCount > 0 ? countPhrase('ws.wages.count.deductions', line.deductionCount, locale) : undefined}>
          <Money amount={line.deductionsIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.penalties')} note={line.penaltyDays > 0 ? countPhrase('ws.wages.count.lateDays', line.penaltyDays, locale) : undefined}>
          <Money amount={line.penaltiesIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.bonuses')} note={line.bonusCount > 0 ? countPhrase('ws.wages.count.bonuses', line.bonusCount, locale) : undefined}>
          <Money amount={line.bonusesIqd} />
        </Line>
        <Line label={tr('ws.wages.pay.net')} rule>
          <Money amount={line.netIqd} strong style={negative ? { color: 'var(--tp-danger-fg)' } : undefined} />
        </Line>
        {advanced && (
          <Line label={tr('ws.wages.pay.advances')} note={countPhrase('ws.wages.count.advances', line.advanceCount, locale)}>
            <span data-testid="wages.pay.advances">
              <Money amount={-line.advancesIqd} />
            </span>
          </Line>
        )}
        <Line label={tr(advanced ? 'ws.wages.pay.toPayNow' : 'ws.wages.pay.toPay')} rule={advanced}>
          <span data-testid="wages.pay.toPay">
            <Money amount={line.toPayIqd} strong style={{ fontSize: 'var(--tp-fs-lg)' }} />
          </span>
        </Line>
      </dl>
      {line.bonuses.length + line.shopRewards.length > 0 && (
        <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
          <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.wages.pay.bonusesTitle')}</h3>
          <BonusList bonuses={line.bonuses} shopRewards={line.shopRewards} testId="wages.pay.bonuses" />
        </div>
      )}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {negative && <MessagePresenter tone="refused" message={tr('ws.wages.pay.belowZero')} />}
        {covered && <MessagePresenter tone="info" message={tr('ws.wages.pay.covered')} />}
        {overAdvanced && <MessagePresenter tone="refused" message={tr('ws.wages.pay.advancesOver')} />}
        {waiting > 0 && <MessagePresenter tone="info" message={tr('ws.wages.pay.waiting', { deductions: countPhrase('ws.wages.count.deductions', waiting, locale) })} />}
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.wages.pay.frozen')}</p>
      </div>
      {line.toPayIqd > 0 && (
        <div style={{ marginBlockStart: 'var(--tp-sp-4)' }}>
          <PaidFromField value={paidFrom} onChange={setPaidFrom} disabled={pay.isPending} testId="wages.pay.from" />
          {paidFrom === 'safe' && safeBalance !== null && (
            <p data-testid="wages.pay.safeBalance" style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: short ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }}>
              {tr('ws.wages.paidFrom.safeBalance', { amount: isolate(formatIQD(safeBalance, locale)) })}
            </p>
          )}
        </div>
      )}
      {blocked !== null && <MessagePresenter tone="refused" message={blocked} />}
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
