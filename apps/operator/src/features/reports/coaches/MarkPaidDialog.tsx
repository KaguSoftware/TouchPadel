/**
 * Mark paid (docs/design/coaching/operator.md §5.16; C-12, R4, R49, R59, R74):
 * the payment reference first, then a manager PIN. Sends
 * app.coach_statement_mark_paid with `p_reference`, `p_pin` and `p_device_id`,
 * so appRpc proves the PIN to verify_manager_pin before the write (the RPC is
 * in PIN_GATED_RPCS). Marking paid moves no till money.
 *
 * The reference mirrors the server's guard before anything is sent: 1..80
 * characters and never a run of 12 or more digits across spaces, hyphens and
 * dots (a card or account number). A PIN refusal stays on the PIN prompt;
 * every other refusal comes back here with its §5.19 line.
 */
import { useState } from 'react';
import { isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { deviceId } from '../../../lib/idem';
import { useLocale } from '../../../lib/i18n';
import { useStationReach } from '../../../lib/stationReach';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { PinPromptOverlay } from '../../../components/kit';
import { readStatementPaid, type StatementRow } from '../../coaching/lessonPayloads';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  REFERENCE_MAX,
  isPinRefusal,
  maybeNegativeMoneyText,
  referenceErrors,
  textErrorKey,
} from './statementsLogic';

export function MarkPaidDialog({
  statement,
  coach,
  onClose,
  onDone,
}: {
  statement: StatementRow;
  coach: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { tr, locale } = useLocale();
  const { reachable } = useStationReach();
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  const amount = maybeNegativeMoneyText(statement.total_iqd, locale);
  const fieldError = referenceErrors(reference);

  function next() {
    setTouched(true);
    setError(null);
    if (fieldError) return;
    setPinError(null);
    setPinOpen(true);
  }

  async function submit(pin: string) {
    setBusy(true);
    setPinError(null);
    setError(null);
    try {
      readStatementPaid(
        await appRpc('coach_statement_mark_paid', {
          p_statement_id: statement.statement_id,
          p_reference: reference.trim(),
          p_pin: pin,
          p_device_id: deviceId(),
        }),
      );
      setPinOpen(false);
      onDone();
    } catch (e) {
      if (isPinRefusal(e)) {
        setPinError(e);
      } else {
        setPinOpen(false);
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={tr('ws.coaching.coachPay.markPaid.title')}
        subtitle={tr('ws.coaching.coachPay.markPaid.amountLine', { amount, coach: isolate(coach) })}
        size="sm"
        dismissible={!busy}
        onClose={onClose}
        footer={(close) => (
          <>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button
              kind="primary"
              icon="lock"
              busy={busy}
              disabled={!reachable}
              disabledReason={tr('ws.coaching.offline.needsConnection')}
              onClick={next}
              data-testid="markPaid.next"
            >
              {tr('ws.coaching.coachPay.markPaid.next')}
            </Button>
          </>
        )}
      >
        <p style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.coaching.coachPay.markPaid.body')}
        </p>
        <Field
          label={tr('ws.coaching.coachPay.markPaid.reference')}
          hint={tr('ws.coaching.coachPay.markPaid.referenceHint')}
          error={
            touched && fieldError
              ? tr(textErrorKey(fieldError, 'reference'), { max: String(REFERENCE_MAX) })
              : undefined
          }
          required
        >
          <input
            style={inputStyle}
            value={reference}
            maxLength={REFERENCE_MAX + 20}
            dir="auto"
            autoComplete="off"
            autoFocus
            disabled={busy}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && next()}
          />
        </Field>
        <ErrorText
          error={error}
          message={error ? coachingErrorText(error, tr, { amount }, { scope: 'statement' }) : null}
        />
      </Modal>
      {pinOpen && (
        <PinPromptOverlay
          action={tr('ws.coaching.coachPay.markPaid.pinAction', { amount, coach: isolate(coach) })}
          busy={busy}
          error={pinError}
          onSubmit={(pin) => void submit(pin)}
          onCancel={() => setPinOpen(false)}
        />
      )}
    </>
  );
}
