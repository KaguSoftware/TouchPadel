/**
 * Record money handed back outside Qi (build contracts R75; operator.md
 * §5.10.10, §5.17). When a share is owed back on an online payment that
 * already had its one Qi refund (a course leave, then a venue cancel of the
 * kept session), `lesson_refunds_due` lists it as `online_blocked_iqd`. The
 * manager hands it back another way and records it here:
 * app.lesson_blocked_refund_record(p_enrolment_id, p_amount_iqd, p_reference,
 * p_pin, p_idempotency_key, p_device_id), under the manager PIN. The key is
 * minted once per amount and reference (0293, DB-23): a retry after a lost
 * answer replays the first record instead of adding the money twice, and an
 * edited amount or reference is a new record.
 *
 * The amount starts at what is blocked and can never be more; the reference
 * is 1..80 characters and never a card number (a run of 12 or more digits once
 * spaces, dots and hyphens are gone, the R49 / R74 guard). Nothing leaves the
 * drawer through this record: the server stores it on the sign-up, never as a
 * payment or refund row. A direct write, so online only (CD-6).
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { useLocale } from '../../lib/i18n';
import { QK } from '../../lib/queryKeys';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MoneyInput } from '../../components/inputs';
import { MessagePresenter, PinPromptOverlay } from '../../components/kit';
import { coachingErrorText } from './lessonLogic';
import type { RefundDueItem } from './lessonPayloads';
import { useLessonIdemKey } from './useCoaching';
import {
  BLOCKED_REFERENCE_MAX,
  blockedRefundErrors,
  onlineBlockedOf,
  refundLabel,
} from './lessonScreenLogic';

/** The refusals the PIN prompt answers itself: the PIN, not the record, was wrong. */
const PIN_CODES = new Set(['PIN_INVALID', 'PIN_LOCKED', 'PIN_GRANT_REQUIRED', 'PIN_OWN']);

export function BlockedRefundDialog({
  item,
  onClose,
}: {
  item: RefundDueItem;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const max = onlineBlockedOf(item);
  const [amount, setAmount] = useState<number | null>(max > 0 ? max : null);
  const [reference, setReference] = useState('');
  const [referenceLeft, setReferenceLeft] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const recordKey = useLessonIdemKey('blocked_refund');

  // A changed amount or reference is a different record: its own key.
  useEffect(() => {
    recordKey.renew();
  }, [amount, reference, recordKey]);

  const errs = blockedRefundErrors({ amount, max, reference });
  const amountLine =
    errs.amount === 'required'
      ? tr('ws.coaching.refunds.blocked.amountRequired')
      : errs.amount === 'tooHigh'
        ? tr('ws.coaching.refunds.blocked.amountTooHigh', { amount: formatIQD(max, locale) })
        : null;
  const referenceLine =
    errs.reference === 'required'
      ? tr('ws.coaching.refunds.blocked.referenceRequired')
      : errs.reference === 'tooLong'
        ? tr('ws.coaching.refunds.blocked.referenceTooLong', {
            max: formatNumber(BLOCKED_REFERENCE_MAX, locale),
          })
        : errs.reference === 'cardNumber'
          ? tr('ws.coaching.errors.cardNumber')
          : null;
  // The server's own word on the reference (INVALID_ARGUMENT p_reference, R49) lands on the box.
  const serverReference =
    error instanceof AppRpcError &&
    error.code === 'INVALID_ARGUMENT' &&
    (error.details ?? '').trim() === 'p_reference';
  const blocked = !reachable
    ? tr('ws.coaching.offline.needsConnection')
    : (amountLine ?? referenceLine ?? undefined);

  async function submit(pin: string) {
    if (amount === null) return;
    setBusy(true);
    setPinError(null);
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      await appRpc('lesson_blocked_refund_record', {
        p_enrolment_id: item.enrolment_id,
        p_amount_iqd: amount,
        p_reference: reference.trim(),
        p_pin: pin,
        p_idempotency_key: recordKey.key(),
        p_device_id: deviceId(),
      });
      recordKey.renew();
      void qc.invalidateQueries({ queryKey: [...QK.coaching.all] });
      toast.ok(tr('ws.coaching.refunds.blocked.done'));
      setPinOpen(false);
      onClose();
    } catch (e) {
      if (e instanceof AppRpcError && PIN_CODES.has(e.code)) {
        setPinError(e);
      } else {
        setPinOpen(false);
        setError(e);
        void qc.invalidateQueries({ queryKey: [...QK.coaching.all] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={tr('ws.coaching.refunds.blocked.title')}
        subtitle={isolate(refundLabel(item, tr))}
        dismissible={!busy}
        onClose={onClose}
        size="sm"
        footer={(close) => (
          <>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button
              kind="primary"
              icon="lock"
              disabled={blocked !== undefined || busy}
              disabledReason={blocked}
              onClick={() => {
                setError(null);
                setPinError(null);
                setPinOpen(true);
              }}
            >
              {tr('ws.coaching.refunds.blocked.submit')}
            </Button>
          </>
        )}
      >
        <MessagePresenter
          tone="info"
          message={tr('ws.coaching.refunds.blocked.body')}
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
        />
        <Field
          label={tr('ws.coaching.refunds.blocked.amount')}
          hint={tr('ws.coaching.refunds.blocked.amountHint', { amount: formatIQD(max, locale) })}
          error={amount !== null && errs.amount === 'tooHigh' ? amountLine : undefined}
        >
          <MoneyInput value={amount} allowEmpty max={max} disabled={busy} onChange={setAmount} />
        </Field>
        <Field
          label={tr('ws.coaching.refunds.blocked.reference')}
          hint={tr('ws.coaching.refunds.blocked.referenceHint', {
            max: formatNumber(BLOCKED_REFERENCE_MAX, locale),
          })}
          error={
            serverReference
              ? coachingErrorText(error, tr)
              : referenceLeft && referenceLine
                ? referenceLine
                : undefined
          }
        >
          <input
            style={inputStyle}
            dir="ltr"
            autoComplete="off"
            maxLength={BLOCKED_REFERENCE_MAX}
            value={reference}
            disabled={busy}
            onChange={(e) => {
              setReference(e.target.value);
              if (serverReference) setError(null);
            }}
            onBlur={() => setReferenceLeft(true)}
          />
        </Field>
        <ErrorText
          error={serverReference ? null : error}
          message={error && !serverReference ? coachingErrorText(error, tr) : null}
        />
      </Modal>
      {pinOpen && (
        <PinPromptOverlay
          action={tr('ws.coaching.refunds.blocked.pinAction')}
          busy={busy}
          error={pinError}
          onCancel={() => setPinOpen(false)}
          onSubmit={(pin) => void submit(pin)}
        />
      )}
    </>
  );
}
