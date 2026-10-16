/**
 * Advances (0344, Majed 2026-10-16): part of a person's wage handed over
 * before pay day, and taking one back when it was logged in error.
 *
 * Give advance (app.give_wage_advance, the owner only): an amount up to what
 * the server says is still owed this month, where the money came from (Safe,
 * preselected, takes it out of the main cash; Bank transfer moves nothing
 * there) and an optional note. Mark paid then hands over the rest; the page's
 * "Still owed" figure is the server's (owed_iqd), never added up here. One
 * idempotency key per dialog, so a retry after a lost answer never gives twice.
 *
 * Take back (app.undo_wage_advance): a reason, while the month is still open;
 * an advance from the safe goes back into it.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatIQD, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MoneyInput } from '../../components/inputs';
import { refusalCode, refusalHint } from '../protocols/errors';
import { monthLabel } from '../deductions/venueDate';
import { isObject, num } from '../roleExtras/roleExtrasLogic';
import { WK } from './api';
import { PaidFromField } from './PaidFromField';
import {
  ADVANCE_MAX,
  ADVANCE_NOTE_MAX,
  UNDO_REASON_MAX,
  advanceMaxFromHint,
  isWageStale,
  undoReasonIssue,
  validateAdvanceDraft,
  type AdvanceIssueCode,
  type PaidFrom,
  type WageAdvance,
} from './wagesLogic';

const AMOUNT_ISSUE = {
  required: 'ws.wages.give.issue.required',
  positive: 'ws.wages.give.issue.positive',
  tooLarge: 'ws.wages.give.issue.tooLarge',
  tooLong: 'ws.wages.give.issue.tooLong',
} as const satisfies Record<AdvanceIssueCode, string>;

/** The main cash's own key (the Safe page): an advance from the safe moves its balance. */
const MAIN_CASH_KEY = ['main-cash'] as const;

export interface AdvanceTarget {
  staffId: string;
  displayName: string;
  /** 'YYYY-MM-01', the pay month the advance comes off. */
  month: string;
  /** What is still owed this month, as the server answered it. */
  owedIqd: number;
}

export function GiveAdvanceDialog({ target, onClose, onDone }: { target: AdvanceTarget; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [key] = useState(() => `wage.advance:${crypto.randomUUID()}`);
  const [amount, setAmount] = useState<number | null>(null);
  const [paidFrom, setPaidFrom] = useState<PaidFrom>('safe');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const amountRef = useRef<HTMLSpanElement>(null);

  // The Modal claims focus for its panel first; the amount is what the owner came to type.
  useEffect(() => {
    amountRef.current?.querySelector('input')?.focus();
  }, []);

  const money = (n: number) => isolate(formatIQD(n, locale));
  const issues = validateAdvanceDraft({ amount, note }, target.owedIqd);
  const amountIssue = issues.find((i) => i.field === 'amount')?.code;
  const noteIssue = issues.find((i) => i.field === 'note')?.code;

  const give = useMutation({
    mutationFn: () =>
      appRpc<unknown>('give_wage_advance', {
        p_staff_id: target.staffId,
        p_amount_iqd: amount,
        p_paid_from: paidFrom,
        p_month: target.month,
        p_note: note.trim() === '' ? null : note.trim(),
        p_idempotency_key: key,
      }),
    onSuccess: (res) => {
      const owed = isObject(res) ? num(res.owed_iqd) : null;
      toast.ok(owed === null ? tr('ws.wages.give.confirmEmpty') : tr('ws.wages.give.done', { name: isolate(target.displayName), amount: money(Math.max(owed, 0)) }));
      void qc.invalidateQueries({ queryKey: WK.all });
      void qc.invalidateQueries({ queryKey: MAIN_CASH_KEY });
      onDone();
    },
    // The month moved under the dialog (paid, or a deduction landed): the page catches up behind the message.
    onError: (e) => {
      const code = refusalCode(e);
      if (isWageStale(code) || code === 'WAGE_ADVANCE_TOO_LARGE') void qc.invalidateQueries({ queryKey: WK.all });
    },
  });

  const tooLargeMax = refusalCode(give.error) === 'WAGE_ADVANCE_TOO_LARGE' ? advanceMaxFromHint(refusalHint(give.error)) : null;

  function submit() {
    setTried(true);
    if (issues.length === 0) give.mutate();
  }

  return (
    <Modal
      title={tr('ws.wages.give.title', { name: isolate(target.displayName) })}
      subtitle={monthLabel(target.month, locale)}
      size="sm"
      onClose={onClose}
      dismissible={!give.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={give.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="banknote" busy={give.isPending} data-testid="wages.advance.confirm" onClick={submit}>
            {amount !== null && amount > 0 ? tr('ws.wages.give.confirm', { amount: money(amount) }) : tr('ws.wages.give.confirmEmpty')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <Field
          label={tr('ws.wages.give.amount')}
          hint={tr('ws.wages.give.amountHint', { amount: money(target.owedIqd) })}
          required
          error={tried && amountIssue ? tr(AMOUNT_ISSUE[amountIssue], { amount: money(target.owedIqd) }) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <span ref={amountRef} data-testid="wages.advance.amount">
            <MoneyInput value={amount} allowEmpty max={ADVANCE_MAX} disabled={give.isPending} onChange={setAmount} />
          </span>
        </Field>
        <PaidFromField value={paidFrom} onChange={setPaidFrom} disabled={give.isPending} testId="wages.advance.from" />
        <Field
          label={tr('ws.wages.give.note')}
          optional
          error={tried && noteIssue ? tr('ws.wages.give.issue.tooLong', { limit: String(ADVANCE_NOTE_MAX) }) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={inputStyle}
            value={note}
            maxLength={ADVANCE_NOTE_MAX}
            dir="auto"
            autoComplete="off"
            disabled={give.isPending}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            data-testid="wages.advance.note"
          />
        </Field>
      </div>
      <ErrorText
        error={give.error}
        message={tooLargeMax !== null ? tr('ws.wages.give.tooLarge', { name: isolate(target.displayName), amount: money(tooLargeMax) }) : null}
      />
    </Modal>
  );
}

export interface UndoAdvanceTarget {
  advance: WageAdvance;
  displayName: string;
}

export function UndoAdvanceDialog({ target, onClose, onDone }: { target: UndoAdvanceTarget; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const issue = undoReasonIssue(reason);
  const a = target.advance;

  const undo = useMutation({
    mutationFn: () => appRpc('undo_wage_advance', { p_id: a.id, p_reason: reason.trim() }),
    onSuccess: () => {
      toast.ok(tr('ws.wages.undoAdvance.done'));
      void qc.invalidateQueries({ queryKey: WK.all });
      void qc.invalidateQueries({ queryKey: MAIN_CASH_KEY });
      onDone();
    },
    onError: (e) => isWageStale(refusalCode(e)) && void qc.invalidateQueries({ queryKey: WK.all }),
  });

  return (
    <Modal
      title={tr('ws.wages.undoAdvance.title')}
      onClose={onClose}
      dismissible={!undo.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={undo.isPending}>
            {tr('ws.wages.undoAdvance.keep')}
          </Button>
          <Button
            kind="danger"
            busy={undo.isPending}
            style={{ marginInlineStart: 'auto' }}
            data-testid="wages.advance.undo.confirm"
            onClick={() => {
              setTried(true);
              if (issue === null) undo.mutate();
            }}
          >
            {tr('ws.wages.undoAdvance.confirm')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>
        {tr('ws.wages.undoAdvance.body', {
          amount: isolate(formatIQD(a.amountIqd, locale)),
          name: isolate(target.displayName),
          date: a.givenAt ? formatDateTime(new Date(a.givenAt), locale) : '',
        })}
        {a.paidFrom === 'safe' && <> {tr('ws.wages.undoAdvance.safe')}</>}
      </p>
      <Field
        label={tr('ws.wages.undoAdvance.reason')}
        hint={tr('ws.wages.undoAdvance.reasonHint')}
        required
        error={tried && issue ? tr(issue === 'required' ? 'op.errors.REASON_REQUIRED' : 'op.errors.TEXT_TOO_LONG') : undefined}
      >
        <textarea
          value={reason}
          rows={3}
          maxLength={UNDO_REASON_MAX}
          dir="auto"
          disabled={undo.isPending}
          onChange={(e) => setReason(e.target.value)}
          style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <ErrorText error={undo.error} />
    </Modal>
  );
}
