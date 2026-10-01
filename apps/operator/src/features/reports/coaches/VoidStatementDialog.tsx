/**
 * Void a statement (docs/design/coaching/operator.md §5.16; R49, R59, R70,
 * R74): a reason (1..200, never a card or account number), then, from
 * `approved`, a manager PIN. app.coach_statement_void(p_statement_id,
 * p_reason, p_pin, p_device_id): the PIN and the device go only from
 * `approved`, where cash may already have been handed over and the grant is
 * consumed; a draft is voided with the reason alone. The next drafting counts
 * the statement's lessons again.
 */
import { useState } from 'react';
import { isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { deviceId } from '../../../lib/idem';
import { useLocale } from '../../../lib/i18n';
import { useStationReach } from '../../../lib/stationReach';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { MessagePresenter, PinPromptOverlay } from '../../../components/kit';
import type { StatementRow } from '../../coaching/lessonPayloads';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  VOID_REASON_MAX,
  isPinRefusal,
  maybeNegativeMoneyText,
  textErrorKey,
  voidReasonErrors,
} from './statementsLogic';

export function VoidStatementDialog({
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
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  const approved = statement.status === 'approved';
  const fieldError = voidReasonErrors(reason);
  const amount = maybeNegativeMoneyText(statement.total_iqd, locale);

  function confirm() {
    setTouched(true);
    setError(null);
    if (fieldError) return;
    if (approved) {
      setPinError(null);
      setPinOpen(true);
      return;
    }
    void send(null);
  }

  async function send(pin: string | null) {
    setBusy(true);
    setPinError(null);
    setError(null);
    try {
      await appRpc(
        'coach_statement_void',
        pin === null
          ? { p_statement_id: statement.statement_id, p_reason: reason.trim() }
          : {
              p_statement_id: statement.statement_id,
              p_reason: reason.trim(),
              p_pin: pin,
              p_device_id: deviceId(),
            },
      );
      setPinOpen(false);
      onDone();
    } catch (e) {
      if (pin !== null && isPinRefusal(e)) {
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
        title={tr('ws.coaching.coachPay.void.title')}
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
              kind="danger"
              icon={approved ? 'lock' : 'ban'}
              busy={busy}
              disabled={!reachable}
              disabledReason={tr('ws.coaching.offline.needsConnection')}
              onClick={confirm}
              style={{ marginInlineStart: 'auto' }}
              data-testid="void.confirm"
            >
              {tr('ws.coaching.coachPay.void.confirm')}
            </Button>
          </>
        )}
      >
        <p style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.coaching.coachPay.void.body')}
        </p>
        {approved && (
          <MessagePresenter
            tone="info"
            icon="lock"
            message={tr('ws.coaching.coachPay.void.approvedBody')}
            style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
          />
        )}
        <Field
          label={tr('ws.coaching.coachPay.void.reason')}
          error={
            touched && fieldError
              ? tr(textErrorKey(fieldError, 'reason'), { max: String(VOID_REASON_MAX) })
              : undefined
          }
          required
        >
          <textarea
            style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical' }}
            value={reason}
            maxLength={VOID_REASON_MAX + 20}
            dir="auto"
            autoFocus
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ErrorText
          error={error}
          message={error ? coachingErrorText(error, tr, { amount }, { scope: 'statement' }) : null}
        />
      </Modal>
      {pinOpen && (
        <PinPromptOverlay
          action={tr('ws.coaching.coachPay.void.pinAction', { coach: isolate(coach) })}
          busy={busy}
          error={pinError}
          onSubmit={(pin) => void send(pin)}
          onCancel={() => setPinOpen(false)}
        />
      )}
    </>
  );
}
