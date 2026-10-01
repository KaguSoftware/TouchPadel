/**
 * Take back a payment marked in error (app.undo_wage_paid, the owner only).
 * A reason is required (1 to 1000 characters); the month opens again and adds
 * up afresh. A day or deduction that landed in a later month while it was paid
 * stays there.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIQD, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { refusalCode } from '../protocols/errors';
import { monthLabel } from '../deductions/venueDate';
import { WK } from './api';
import { UNDO_REASON_MAX, isWageStale, undoReasonIssue } from './wagesLogic';

export interface UndoTarget {
  paymentId: string;
  displayName: string;
  month: string;
  paidIqd: number;
}

export function UndoPaidDialog({ target, onClose, onDone }: { target: UndoTarget; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const issue = undoReasonIssue(reason);

  const undo = useMutation({
    mutationFn: () => appRpc('undo_wage_paid', { p_id: target.paymentId, p_reason: reason.trim() }),
    onSuccess: () => {
      toast.ok(tr('ws.wages.undo.done'));
      onDone();
    },
    onError: (e) => isWageStale(refusalCode(e)) && void qc.invalidateQueries({ queryKey: WK.all }),
  });

  return (
    <Modal
      title={tr('ws.wages.undo.title')}
      onClose={onClose}
      dismissible={!undo.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={undo.isPending}>
            {tr('ws.wages.undo.keep')}
          </Button>
          <Button
            kind="danger"
            busy={undo.isPending}
            style={{ marginInlineStart: 'auto' }}
            data-testid="wages.undo.confirm"
            onClick={() => {
              setTried(true);
              if (issue === null) undo.mutate();
            }}
          >
            {tr('ws.wages.undo.confirm')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>
        {tr('ws.wages.undo.body', { name: isolate(target.displayName), month: monthLabel(target.month, locale), amount: isolate(formatIQD(target.paidIqd, locale)) })}
      </p>
      <Field
        label={tr('ws.wages.undo.reason')}
        hint={tr('ws.wages.undo.reasonHint')}
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
