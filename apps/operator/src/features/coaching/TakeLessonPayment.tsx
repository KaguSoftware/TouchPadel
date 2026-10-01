/**
 * Take payment for one lesson sign-up (docs/design/coaching/operator.md
 * §5.10.5, §5.15): the till's PaymentPane over app.lesson_settle, shared by the
 * lesson screen's roster and the customer record's Lessons panel (the
 * cashier's way in, R20).
 *
 * - `due` is the enrolment's `money.take_iqd`, the server's figure, and
 *   `allowPartial={false}`: the exact owed, nothing else (§1.7).
 * - `p_expected_owed_iqd` is that due; the server re-checks it. On
 *   LESSON_OWED_CHANGED (or TOTAL_CHANGED) the pane re-reads the sign-up
 *   (`refetchDue`) and stays open on the new due with "What this student owes
 *   changed to {amount}"; a new due of 0 closes it with "Nothing left to take
 *   for this student." (the CourtBillPanel TOTAL_CHANGED precedent).
 * - LESSON_NOT_PAYABLE closes the pane with its detail's line.
 * - The shift gate works unchanged (PaymentPane owns it).
 *
 * One idempotency key per opened pane, sent again on a retry inside it,
 * renewed after a success (§5.1). `p_device_id` stamps the till shift.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { PaymentPane, type PaymentMethod } from '../till/PaymentPane';
import { coachingErrorText } from './lessonLogic';
import { readLessonSettled } from './lessonPayloads';
import { invalidateLessonMoney, useLessonIdemKey } from './useCoaching';

export interface LessonPayTarget {
  enrolmentId: string;
  /** The student as the row shows them (the recorded name, R44). */
  name: string;
  /** A course sign-up reads "{name}'s course"; anything else "{name}'s lesson". */
  course: boolean;
  /** `money.take_iqd`: what Take payment collects. */
  dueIqd: number;
}

export interface TakeLessonPaymentProps {
  target: LessonPayTarget;
  method: PaymentMethod;
  onClose: () => void;
  /** After the server took it (the toast is already shown). */
  onPaid?: () => void;
  /**
   * Re-read the sign-up after LESSON_OWED_CHANGED: its new `take_iqd`, or null
   * when it is gone. The pane closes on 0 or null.
   */
  refetchDue: () => Promise<number | null>;
  /** A line for the caller to show once the pane has closed itself (nothing left, not payable). */
  onNotice?: (text: string) => void;
}

export function TakeLessonPayment({
  target,
  method,
  onClose,
  onPaid,
  refetchDue,
  onNotice,
}: TakeLessonPaymentProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const settleKey = useLessonIdemKey('settle');
  const [due, setDue] = useState(target.dueIqd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const money = (n: number | null | undefined) => formatIQD(n ?? 0, locale);

  // A new target is a new payment: its own key, its own due.
  useEffect(() => {
    settleKey.renew();
    setDue(target.dueIqd);
    setError(null);
    setMessage(null);
  }, [target.enrolmentId, target.dueIqd, settleKey]);

  async function settle(m: PaymentMethod, tenderedIqd: number | null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      const out = readLessonSettled(
        await appRpc('lesson_settle', {
          p_enrolment_id: target.enrolmentId,
          p_method: m,
          p_expected_owed_iqd: due,
          p_tendered_iqd: m === 'cash' ? tenderedIqd : null,
          p_idempotency_key: settleKey.key(),
          p_device_id: deviceId(),
        }),
      );
      settleKey.renew();
      invalidateLessonMoney(qc);
      const took = tr('ws.coaching.common.take.took', {
        amount: money(out.amount_iqd ?? due),
        name: isolate(target.name),
      });
      const change =
        m === 'cash' && (out.change_iqd ?? 0) > 0
          ? ` ${tr('ws.coaching.common.take.change', { change: money(out.change_iqd) })}`
          : '';
      toast.ok(`${took}${change}`);
      onPaid?.();
      onClose();
    } catch (e) {
      await refused(e);
    } finally {
      setBusy(false);
    }
  }

  async function refused(e: unknown) {
    const code = e instanceof AppRpcError ? e.code : null;
    if (code === 'LESSON_OWED_CHANGED' || code === 'TOTAL_CHANGED') {
      // What this student owes moved under the desk: read it again and ask again.
      settleKey.renew();
      const next = await refetchDue();
      if (next === null || next <= 0) {
        onNotice?.(tr('ws.coaching.errors.notPayable.nothing_owed'));
        onClose();
        return;
      }
      setDue(next);
      setError(e);
      setMessage(tr('ws.coaching.errors.owedChanged', { amount: money(next) }));
      return;
    }
    if (code === 'LESSON_NOT_PAYABLE') {
      onNotice?.(coachingErrorText(e, tr));
      onClose();
      return;
    }
    setError(e);
    setMessage(coachingErrorText(e, tr));
  }

  return (
    <PaymentPane
      mode={method}
      due={due}
      busy={busy}
      error={error}
      errorMessage={message}
      subtitle={tr(
        target.course
          ? 'ws.coaching.common.take.subtitleCourse'
          : 'ws.coaching.common.take.subtitleLesson',
        {
          name: isolate(target.name),
        },
      )}
      allowPartial={false}
      onCancel={onClose}
      onSettle={(m, _amount, tendered) => void settle(m, tendered)}
    />
  );
}
