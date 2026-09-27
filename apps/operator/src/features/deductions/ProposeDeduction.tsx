/**
 * "Propose a deduction" on /deductions (wave5-addendum-2026-09-25 §2.5.3):
 * the manager's and the owner's own proposal, which another manager or the
 * owner decides. The heads propose on their phones.
 *
 * It opens inline under the page header, so the lists it adds to stay in
 * view. The people offered are app.deduction_targets' (every active non-owner
 * at the venue but the proposer), and the form states each server rule before
 * the server would refuse it. The idempotency key follows what is sent: a
 * retry of the same proposal reuses it, and an edit or a success mints a new
 * one (app.claim_replay compares no payload, so a key kept across an edit
 * after a lost answer would replay the first proposal for the second).
 *
 * The date defaults to, and is bounded by, the venue's business day, the day
 * propose_deduction checks against: before the day's start hour it is still
 * the day before.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatIQD, formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useBusinessToday } from '../../lib/settings';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { MoneyInput, DateField } from '../../components/inputs';
import { Panel } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { refusalCode, refusalHint } from '../protocols/errors';
import { DK } from './api';
import {
  AMOUNT_MAX,
  AMOUNT_MIN,
  DATE_WINDOW_DAYS,
  REASON_MAX,
  dateWindow,
  onlyManagerDecides,
  proposeRefusalField,
  readDeductionTargets,
  validateProposal,
  type ProposeDraft,
  type ProposeField,
  type ProposeIssueCode,
} from './deductionsLogic';

const EMPTY: ProposeDraft = { staffId: '', amount: null, date: '', reason: '' };

export function ProposeDeduction({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const { staff } = useAuth();
  const today = useBusinessToday();
  const bounds = dateWindow(today);
  const [draft, setDraft] = useState<ProposeDraft>({ ...EMPTY, date: today });
  const [tried, setTried] = useState(false);
  /** One key per proposal as sent: kept for a retry of it, renewed by an edit or a success. */
  const key = useRef<{ sig: string; key: string } | null>(null);

  const targetsQ = useQuery({ queryKey: DK.targets, queryFn: () => appRpc<unknown>('deduction_targets', {}) });
  const targets = readDeductionTargets(targetsQ.data);

  const send = useMutation({
    mutationFn: () => {
      const args = { p_staff_id: draft.staffId, p_amount_iqd: draft.amount, p_date: draft.date, p_reason: draft.reason.trim() };
      const sig = JSON.stringify(args);
      if (key.current?.sig !== sig) key.current = { sig, key: `deduction.propose:${crypto.randomUUID()}` };
      return appRpc('propose_deduction', { ...args, p_idempotency_key: key.current.key });
    },
    onSuccess: () => {
      key.current = null;
      toast.ok(tr('ws.deductions.propose.sent'));
      onSent();
    },
  });

  const issues = validateProposal(draft, today);
  const serverField = proposeRefusalField(refusalCode(send.error), refusalHint(send.error));
  const issueOf = (field: ProposeField): string | undefined => {
    const i = tried ? issues.find((x) => x.field === field) : undefined;
    // An empty amount or day is asked for with its range, so the bounds stay in
    // view once the error takes the hint's place.
    const code: ProposeIssueCode | undefined = i?.code === 'required' && field === 'amount' ? 'amountRange' : i?.code === 'required' && field === 'date' ? 'dateRange' : i?.code;
    if (code) return tr(ISSUE_KEY[code], { min: formatIQD(AMOUNT_MIN, locale), max: formatIQD(AMOUNT_MAX, locale), days: formatNumber(DATE_WINDOW_DAYS, locale), limit: formatNumber(REASON_MAX, locale) });
    return undefined;
  };
  const set = (patch: Partial<ProposeDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (send.isError) send.reset();
  };

  return (
    <Panel title={<CardTitle icon="banknote">{tr('ws.deductions.propose.title')}</CardTitle>} data-testid="deductions.propose-form" style={{ marginBlockEnd: 'var(--tp-sp-4)', maxInlineSize: '44rem' }}>
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-3)', maxInlineSize: '62ch' }}>{tr(onlyManagerDecides(staff?.role) ? 'ws.deductions.propose.leadOwner' : 'ws.deductions.propose.lead')}</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (issues.length === 0 && !send.isPending) send.mutate();
        }}
      >
        <Field
          label={tr('ws.deductions.propose.person')}
          required
          error={issueOf('staffId') ?? (serverField === 'staffId' ? tr('ws.deductions.propose.personRefused') : undefined)}
          hint={targetsQ.isSuccess && targets.length === 0 ? tr('ws.deductions.propose.nobody') : undefined}
        >
          <Select<string>
            value={draft.staffId}
            placeholder={targetsQ.isPending ? tr('common.loading') : tr('ws.deductions.propose.choosePerson')}
            disabled={send.isPending || targets.length === 0}
            options={targets.map((t) => ({ value: t.id, label: t.role ? `${t.displayName} · ${tr(`op.roles.${t.role}`)}` : t.displayName }))}
            onChange={(v) => set({ staffId: v })}
          />
        </Field>
        {targetsQ.isError && <ErrorText error={targetsQ.error} />}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
          <Field
            label={tr('ws.deductions.propose.amount')}
            required
            hint={tr('ws.deductions.propose.amountHint', { min: formatIQD(AMOUNT_MIN, locale), max: formatIQD(AMOUNT_MAX, locale) })}
            error={issueOf('amount') ?? (serverField === 'amount' ? tr('op.errors.INVALID_AMOUNT') : undefined)}
            style={{ flex: '1 1 14rem' }}
          >
            <MoneyInput value={draft.amount} allowEmpty max={AMOUNT_MAX} disabled={send.isPending} onChange={(v) => set({ amount: v })} />
          </Field>
          <Field
            label={tr('ws.deductions.propose.date')}
            required
            hint={tr('ws.deductions.propose.dateHint', { days: formatNumber(DATE_WINDOW_DAYS, locale) })}
            error={issueOf('date') ?? (serverField === 'date' ? tr('ws.deductions.propose.issue.dateRange', { days: formatNumber(DATE_WINDOW_DAYS, locale) }) : undefined)}
            style={{ flex: '1 1 12rem' }}
          >
            <DateField value={draft.date} min={bounds.min} max={bounds.max} disabled={send.isPending} onChange={(v) => set({ date: v })} />
          </Field>
        </div>
        <Field
          label={tr('ws.deductions.propose.reason')}
          required
          hint={tr('ws.deductions.propose.reasonHint')}
          error={issueOf('reason') ?? (serverField === 'reason' ? tr('op.errors.TEXT_TOO_LONG') : undefined)}
        >
          <textarea
            value={draft.reason}
            rows={3}
            maxLength={REASON_MAX}
            dir="auto"
            disabled={send.isPending}
            onChange={(e) => set({ reason: e.target.value })}
            style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }}
            data-testid="deductions.propose.reason"
          />
        </Field>
        {send.isError && serverField === null && <ErrorText error={send.error} />}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button kind="ghost" onClick={onClose} disabled={send.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" type="submit" icon="check" busy={send.isPending} data-testid="deductions.propose.submit">
            {tr('ws.deductions.propose.submit')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

const ISSUE_KEY: Record<ProposeIssueCode, 'ws.deductions.propose.issue.required' | 'ws.deductions.propose.issue.amountRange' | 'ws.deductions.propose.issue.dateRange' | 'ws.deductions.propose.issue.tooLong'> = {
  required: 'ws.deductions.propose.issue.required',
  amountRange: 'ws.deductions.propose.issue.amountRange',
  dateRange: 'ws.deductions.propose.issue.dateRange',
  tooLong: 'ws.deductions.propose.issue.tooLong',
};
