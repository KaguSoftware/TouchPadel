/**
 * Set a person's salary and pay day (app.set_staff_wage, the owner only).
 *
 * The salary is integer IQD, 0 to 100,000,000 (0: not paid at this branch);
 * the pay day 1 to 31, falling on a shorter month's last day. "Starting" is
 * the first pay month the new rate applies to: by default the next pay day
 * (null: the server picks the first pay day from today, after the last paid
 * month), or an explicit month from this one to three ahead. A paid month
 * keeps the rate it was paid at; the server refuses a start on or before it.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select } from '../../components/ui';
import { MoneyInput } from '../../components/inputs';
import { refusalCode, refusalHint } from '../protocols/errors';
import { monthLabel } from '../deductions/venueDate';
import {
  PAY_DAY_MAX,
  PAY_DAY_MIN,
  SALARY_MAX,
  SALARY_MIN,
  fromMonthOptions,
  payDayClamps,
  validateWageDraft,
  wageRefusalField,
  type WageDraft,
  type WageField,
  type WageStatus,
} from './wagesLogic';

/** Who the salary is for, and what they have now (when anything). */
export interface WageTarget {
  staffId: string;
  displayName: string;
  status: WageStatus;
  salaryIqd: number;
  payDay: number | null;
}

/** The "Starting" select's value for "the next pay day" (sent as null). */
const NEXT = 'next';

export function SetWageDialog({
  target,
  currentMonth,
  onClose,
  onDone,
}: {
  target: WageTarget;
  /** The branch's business month, as the server answered it. */
  currentMonth: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const hasRate = target.status !== 'unset' && target.payDay !== null;
  const [draft, setDraft] = useState<WageDraft>({
    salary: hasRate ? target.salaryIqd : null,
    payDay: target.payDay,
    from: null,
  });
  const [tried, setTried] = useState(false);
  const issues = validateWageDraft(draft);

  const save = useMutation({
    mutationFn: () =>
      appRpc('set_staff_wage', {
        p_staff_id: target.staffId,
        p_salary_iqd: draft.salary,
        p_pay_day: draft.payDay,
        p_from_month: draft.from,
      }),
    onSuccess: () => {
      toast.ok(tr('ws.wages.set.saved'));
      onDone();
    },
  });

  const serverField: WageField | null = wageRefusalField(refusalCode(save.error), refusalHint(save.error));
  const issueOf = (field: 'salary' | 'payDay'): string | undefined => {
    const i = tried ? issues.find((x) => x.field === field) : undefined;
    if (i) {
      return field === 'salary'
        ? tr('ws.wages.set.issue.salaryRange', { min: formatIQD(SALARY_MIN, locale), max: formatIQD(SALARY_MAX, locale) })
        : tr('ws.wages.set.issue.payDayRange');
    }
    if (serverField === 'salary') return tr('op.errors.INVALID_AMOUNT');
    if (serverField === 'payDay') return tr('ws.wages.set.issue.payDayRange');
    return undefined;
  };
  const set = (patch: Partial<WageDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (save.isError) save.reset();
  };

  const days = Array.from({ length: PAY_DAY_MAX - PAY_DAY_MIN + 1 }, (_, i) => String(PAY_DAY_MIN + i));
  const months = fromMonthOptions(currentMonth);

  return (
    <Modal
      title={tr('ws.wages.set.title', { name: isolate(target.displayName) })}
      onClose={onClose}
      dismissible={!save.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={save.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={save.isPending}
            data-testid="wages.set.confirm"
            onClick={() => {
              setTried(true);
              if (issues.length === 0) save.mutate();
            }}
          >
            {tr('ws.wages.set.save')}
          </Button>
        </>
      )}
    >
      {hasRate && (
        <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.wages.set.current', { amount: isolate(formatIQD(target.salaryIqd, locale)), day: formatNumber(target.payDay ?? 0, locale) })}
        </p>
      )}
      <Field
        label={tr('ws.wages.set.salary')}
        required
        hint={tr('ws.wages.set.salaryHint', { min: formatIQD(SALARY_MIN, locale), max: formatIQD(SALARY_MAX, locale) })}
        error={issueOf('salary')}
      >
        <MoneyInput value={draft.salary} allowEmpty max={SALARY_MAX} disabled={save.isPending} onChange={(v) => set({ salary: v })} />
      </Field>
      <Field label={tr('ws.wages.set.payDay')} required hint={payDayClamps(draft.payDay) ? tr('ws.wages.set.shortMonth') : undefined} error={issueOf('payDay')}>
        <Select<string>
          value={draft.payDay === null ? '' : String(draft.payDay)}
          placeholder={tr('ws.wages.set.choosePayDay')}
          disabled={save.isPending}
          options={days.map((d) => ({ value: d, label: tr('ws.wages.set.payDayOption', { day: formatNumber(Number(d), locale) }) }))}
          onChange={(v) => set({ payDay: Number(v) })}
        />
      </Field>
      <Field
        label={tr('ws.wages.set.from')}
        hint={tr('ws.wages.set.fromHint')}
        error={serverField === 'from' ? tr('ws.wages.set.fromRefused') : undefined}
      >
        <Select<string>
          value={draft.from ?? NEXT}
          disabled={save.isPending}
          options={[{ value: NEXT, label: tr('ws.wages.set.fromNext') }, ...months.map((m) => ({ value: m, label: monthLabel(m, locale) }))]}
          onChange={(v) => set({ from: v === NEXT ? null : v })}
        />
      </Field>
      {serverField === 'staff' && <ErrorText error={save.error} message={tr('ws.wages.set.personRefused')} />}
      {save.isError && serverField === null && <ErrorText error={save.error} />}
    </Modal>
  );
}
