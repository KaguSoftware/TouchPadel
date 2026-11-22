/**
 * A customer saved by name alone (0448) is incomplete until the desk adds
 * their number. This is the badge that says so and the one box that fixes it,
 * shown where the customer is picked (CustomerPicker) and on their record.
 *
 * Adding the number makes the record an ordinary desk walk-in: found by the
 * number from then on, and claimable by the person on their own phone. A
 * number that already has its customer is not forced onto this one: the box
 * says whose it is and, where the screen can take another customer, offers
 * them instead.
 */
import { useState } from 'react';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { Button, inputStyle } from '../../../components/ui';
import { StatusBadge } from '../../../components/kit';
import { sanitizePhone } from '../deskLogic';
import type { PickedCustomer } from './CustomerPicker';
import { completeDeskAccount, isDeskPhone, type CompleteResult } from './deskAccount';

export function IncompleteBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  const label = tr('ws.courtDesk.deskAccount.incomplete');
  return <StatusBadge tone="warn" label={label} size={size} title={tr('ws.courtDesk.deskAccount.incompleteHint')} />;
}

type Refusal = Exclude<CompleteResult, { ok: true }>;

export function CompleteCustomerPhone({
  customerId,
  disabled,
  onCompleted,
  onUseHolder,
}: {
  customerId: string;
  disabled?: boolean;
  /** The number is saved: the caller shows it on the customer. */
  onCompleted: (phone: string) => void;
  /** The number already has its customer, and this screen can take them instead. */
  onUseHolder?: (holder: PickedCustomer) => void;
}) {
  const { tr } = useLocale();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  async function save() {
    if (busy || !isDeskPhone(phone)) return;
    setBusy(true);
    setRefusal(null);
    const out = await completeDeskAccount(customerId, phone);
    setBusy(false);
    if (out.ok) onCompleted(out.phone);
    else setRefusal(out);
  }

  const holder = refusal?.code === 'DUPLICATE_PHONE' ? refusal.holder : null;
  const message = !refusal
    ? null
    : refusal.code === 'DUPLICATE_PHONE'
      ? holder?.name
        ? tr('ws.courtDesk.deskAccount.complete.taken', { name: isolate(holder.name) })
        : tr('ws.courtDesk.deskAccount.complete.takenUnknown')
      : tr(`ws.courtDesk.deskAccount.complete.${refusal.code}`);

  return (
    <div data-testid="complete-phone" style={{ marginBlockStart: 'var(--tp-sp-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 12rem', inlineSize: 'auto' }}
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="off"
          maxLength={30}
          value={phone}
          disabled={disabled || busy}
          placeholder={tr('ws.courtDesk.deskAccount.complete.placeholder')}
          aria-label={tr('ws.courtDesk.deskAccount.complete.label')}
          data-testid="complete-phone.input"
          onChange={(e) => {
            setPhone(sanitizePhone(e.target.value));
            setRefusal(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
        <Button kind="soft" size="sm" icon="check" busy={busy} disabled={disabled || busy || !isDeskPhone(phone)} onClick={() => void save()} data-testid="complete-phone.save">
          {tr('ws.courtDesk.deskAccount.complete.save')}
        </Button>
      </div>
      <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: message ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }} role={message ? 'alert' : undefined}>
        {message ?? tr('ws.courtDesk.deskAccount.complete.hint')}
      </p>
      {holder && onUseHolder && (
        <Button kind="ghost" size="sm" icon="user" disabled={disabled} onClick={() => onUseHolder(holder)} data-testid="complete-phone.use-holder" style={{ marginBlockStart: 'var(--tp-sp-1)' }}>
          {tr('ws.courtDesk.deskAccount.complete.useHolder', { name: isolate(holder.name || '—') })}
        </Button>
      )}
    </div>
  );
}
