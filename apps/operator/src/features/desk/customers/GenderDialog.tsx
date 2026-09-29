/**
 * "Plays as" on the customer record (docs/design/open-matches/operator.md
 * §5.15, §5.15.2): the desk declares or corrects which women's or men's open
 * matches a customer sees and can join (OM-39), through
 * app.staff_set_customer_gender. Two choices, no third: clearing a
 * declaration is not a desk action.
 *
 * Seats already taken keep the gender stamped when they were taken, so the
 * change never moves anyone out of a match; the dialog says so. Online only
 * (DF-11): the caller disables the way in while the station is offline.
 */
import { useId, useState } from 'react';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText, Modal } from '../../../components/ui';
import { Icon } from '../../../components/icons';
import type { CustomerGender } from '../deskTypes';

const CHOICES: readonly CustomerGender[] = ['female', 'male'];

export function GenderDialog({
  customerId,
  current,
  onClose,
  onSaved,
}: {
  customerId: string;
  current: CustomerGender | null;
  onClose: () => void;
  onSaved: (gender: CustomerGender) => void;
}) {
  const { tr } = useLocale();
  const id = useId();
  const [choice, setChoice] = useState<CustomerGender | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const changed = choice !== null && choice !== current;

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('staff_set_customer_gender', { p_customer_id: customerId, p_gender: choice });
      onSaved(choice);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.matches.customers.gender.title')}
      subtitle={tr('ws.matches.customers.playsAs.lead')}
      dismissible={!busy}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} disabled={!changed} onClick={() => void save()}>
            {tr('ws.matches.customers.gender.save')}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={tr('ws.matches.customers.gender.title')} style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-3)' }}>
        {CHOICES.map((g) => (
          <label key={g} className="tp-choice" data-selected={choice === g ? 'true' : undefined}>
            <input className="tp-sr-only" type="radio" name={`${id}-gender`} value={g} checked={choice === g} disabled={busy} onChange={() => setChoice(g)} />
            <span style={{ flex: 1 }}>{tr(g === 'female' ? 'ws.matches.customers.playsAs.female' : 'ws.matches.customers.playsAs.male')}</span>
            {choice === g && <Icon name="check" size={16} />}
          </label>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.customers.gender.kept')}</p>
      <ErrorText error={error} />
    </Modal>
  );
}
