/**
 * One PIN, one action: "Start break" / "End break". The kit's PinPromptOverlay
 * is worded for manager authorisation ("Enter a manager PIN to …") and stops
 * at six digits; this asks for the person's OWN PIN and accepts the 6–12 the
 * server does. The caller runs the RPC; a refusal is shown here and the field
 * is cleared for another try, with focus kept in it.
 */
import { useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { PIN_MAX, PIN_MIN } from '../admin/staff/staffModel';

export function BreakPinDialog({
  title,
  lead,
  action,
  onSubmit,
  onClose,
}: {
  title: string;
  lead: string;
  action: string;
  /** Resolve to close; reject with the error to show (PIN_INVALID, PIN_LOCKED, …). */
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLInputElement>(null);
  const ready = pin.length >= PIN_MIN && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (e) {
      setError(e);
      setPin('');
      requestAnimationFrame(() => ref.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      subtitle={lead}
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="lock" busy={busy} disabled={!ready} onClick={() => void submit()}>
            {action}
          </Button>
        </>
      )}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={tr('ws.shell.lock.pin')} style={{ marginBlockEnd: 0 }}>
          <input
            ref={ref}
            style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            dir="ltr"
            value={pin}
            maxLength={PIN_MAX}
            readOnly={busy}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <ErrorText error={error} style={{ marginBlockEnd: 0 }} />
      </form>
    </Modal>
  );
}
