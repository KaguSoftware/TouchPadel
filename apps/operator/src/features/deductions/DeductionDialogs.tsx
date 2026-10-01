/**
 * The deduction decisions more than one screen opens (0272): /deductions and
 * the owner's Wages page approve or decline a proposal, and take back an
 * approval, through the same two dialogs, so the two pages cannot word a
 * decision differently.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIQD, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { refusalCode } from '../protocols/errors';
import { DK, refreshAfterWrite } from './api';
import { NOTE_MAX, decisionIssue, isStaleRefusal, type DeductionRow } from './deductionsLogic';

/** A deduction a dialog is about: enough to name it in a sentence. */
export interface DeductionRef {
  id: string;
  staffName: string;
  amountIqd: number;
}

/**
 * Approve or decline, with the note the decision carries (the staff requests'
 * DecisionDialog shape, StaffRequests.tsx). Declining needs a reason: the form
 * says so before the server would (REASON_REQUIRED), and the proposer reads
 * it. The person is told only of an approval, and never who proposed it.
 */
export function DecideDialog({ row, approve, onClose, onDone }: { row: DeductionRow; approve: boolean; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const issue = decisionIssue(approve, note);
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: () => appRpc('decide_deduction', { p_id: row.id, p_approve: approve, p_note: note.trim() === '' ? null : note.trim() }),
    onSuccess: () => {
      toast.ok(tr(approve ? 'ws.deductions.decide.approved' : 'ws.deductions.decide.declined'));
      refreshAfterWrite(qc);
      onDone();
    },
    onError: (e) => isStaleRefusal(refusalCode(e)) && void qc.invalidateQueries({ queryKey: DK.all }),
  });
  const amount = isolate(formatIQD(row.amountIqd, locale));
  const name = isolate(row.staffName);

  return (
    <Modal
      title={tr(approve ? 'ws.deductions.decide.approveTitle' : 'ws.deductions.decide.declineTitle')}
      onClose={onClose}
      dismissible={!decide.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={decide.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind={approve ? 'primary' : 'danger'}
            busy={decide.isPending}
            data-testid="deductions.decide.confirm"
            onClick={() => {
              setTried(true);
              if (issue === null) decide.mutate();
            }}
          >
            {tr(approve ? 'ws.deductions.decide.approveConfirm' : 'ws.deductions.decide.declineConfirm')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>{tr(approve ? 'ws.deductions.decide.approveBody' : 'ws.deductions.decide.declineBody', { name, amount })}</p>
      <blockquote dir="auto" style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-3)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-ctl)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {row.reason}
      </blockquote>
      <Field
        label={tr(approve ? 'ws.deductions.decide.note' : 'ws.deductions.decide.reason')}
        hint={tr('ws.deductions.decide.readByProposer')}
        required={!approve}
        optional={approve}
        error={tried && issue ? tr(issue === 'required' ? 'op.errors.REASON_REQUIRED' : 'op.errors.TEXT_TOO_LONG') : undefined}
      >
        <textarea
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          dir="auto"
          disabled={decide.isPending}
          onChange={(e) => setNote(e.target.value)}
          style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <ErrorText error={decide.error} />
    </Modal>
  );
}

/**
 * The owner takes back an approval (app.cancel_deduction): the row stays, as
 * cancelled, and leaves every total. A reason is required, and the red
 * confirm sits apart from Keep it. Once the month's wage is paid the server
 * refuses (WAGE_ALREADY_PAID, 0272); the screens hide the button before then.
 */
export function CancelDialog({ target, onClose, onDone }: { target: DeductionRef; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const issue = decisionIssue(false, reason);
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => appRpc('cancel_deduction', { p_id: target.id, p_reason: reason.trim() }),
    onSuccess: () => {
      toast.ok(tr('ws.deductions.cancel.done'));
      refreshAfterWrite(qc);
      onDone();
    },
    // Out of date, or the month's wage was paid meanwhile (0272): the message
    // stays, and the list behind it drops the Cancel button.
    onError: (e) => {
      const code = refusalCode(e);
      if (isStaleRefusal(code) || code === 'WAGE_ALREADY_PAID') refreshAfterWrite(qc);
    },
  });
  return (
    <Modal
      title={tr('ws.deductions.cancel.title')}
      onClose={onClose}
      dismissible={!cancel.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={cancel.isPending}>
            {tr('ws.deductions.cancel.keep')}
          </Button>
          <Button
            kind="danger"
            busy={cancel.isPending}
            style={{ marginInlineStart: 'auto' }}
            data-testid="deductions.cancel.confirm"
            onClick={() => {
              setTried(true);
              if (issue === null) cancel.mutate();
            }}
          >
            {tr('ws.deductions.cancel.confirm')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>
        {tr('ws.deductions.cancel.body', { name: isolate(target.staffName), amount: isolate(formatIQD(target.amountIqd, locale)) })}
      </p>
      <Field
        label={tr('ws.deductions.cancel.reason')}
        hint={tr('ws.deductions.cancel.reasonHint')}
        required
        error={tried && issue ? tr(issue === 'required' ? 'op.errors.REASON_REQUIRED' : 'op.errors.TEXT_TOO_LONG') : undefined}
      >
        <textarea
          value={reason}
          rows={3}
          maxLength={NOTE_MAX}
          dir="auto"
          disabled={cancel.isPending}
          onChange={(e) => setReason(e.target.value)}
          style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <ErrorText error={cancel.error} />
    </Modal>
  );
}
