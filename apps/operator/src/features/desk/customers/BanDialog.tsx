/**
 * The full ban (0449) on the customer record: the dialog that bans, the one
 * that lifts, and the banner a banned record opens on. Banning needs a reason
 * (staff read it; the customer never does) and says in plain words what
 * happens, including what the customer still has coming, so the desk can
 * cancel those by hand. Every write is online only.
 */
import { useState } from 'react';
import { countPhrase, formatDate, isolate } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useStationReach } from '../../../lib/stationReach';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Icon } from '../../../components/icons';
import {
  setCustomerBan,
  useInvalidateCustomerRules,
  type CustomerBan,
  type CustomerRules,
} from './customerRules';

const REASON_MAX = 120;

export function BanDialog({
  customerId,
  name,
  coming,
  onClose,
}: {
  customerId: string;
  name: string;
  coming: CustomerRules['coming'];
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const invalidate = useInvalidateCustomerRules();
  const { reachable } = useStationReach();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const missing = reason.trim() === '';

  const bookings =
    coming.bookings > 0
      ? countPhrase('ws.customerRules.ban.comingBookings', coming.bookings, locale)
      : null;
  const seats =
    coming.seats > 0 ? countPhrase('ws.customerRules.ban.comingSeats', coming.seats, locale) : null;
  const comingText =
    bookings && seats
      ? tr('ws.customerRules.ban.comingBoth', { bookings, seats })
      : (bookings ?? seats);

  async function ban() {
    setTried(true);
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      await setCustomerBan(customerId, true, reason.trim());
      toast.ok(tr('ws.customerRules.ban.done'));
      invalidate(customerId);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.customerRules.ban.title', { name: isolate(name) })}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="danger"
            icon="ban"
            busy={busy}
            disabled={!reachable}
            disabledReason={tr('ws.customerRules.offline')}
            onClick={() => void ban()}
            data-testid="ban-confirm"
          >
            {tr('ws.customerRules.ban.confirm')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{tr('ws.customerRules.ban.lead')}</p>
          <ul
            style={{
              margin: 0,
              paddingInlineStart: 'var(--tp-sp-5)',
              display: 'grid',
              gap: 'var(--tp-sp-1)',
            }}
          >
            <li>{tr('ws.customerRules.ban.effectApp')}</li>
            <li>{tr('ws.customerRules.ban.effectDesk')}</li>
            <li>{tr('ws.customerRules.ban.effectKept')}</li>
          </ul>
          {comingText && (
            <p
              style={{ margin: 0, color: 'var(--tp-warn-fg)', fontWeight: 600 }}
              data-testid="ban-coming"
            >
              {tr('ws.customerRules.ban.coming', { bookings: comingText })}
            </p>
          )}
        </div>
        <Field
          label={tr('ws.customerRules.ban.reason')}
          hint={tr('ws.customerRules.ban.reasonHint')}
          required
          error={tried && missing ? tr('op.errors.REASON_REQUIRED') : undefined}
        >
          <input
            style={inputStyle}
            value={reason}
            maxLength={REASON_MAX}
            disabled={busy}
            placeholder={tr('ws.customerRules.ban.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ban();
            }}
            autoFocus
            data-testid="ban-reason"
          />
        </Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

export function LiftBanDialog({
  customerId,
  name,
  onClose,
}: {
  customerId: string;
  name: string;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const invalidate = useInvalidateCustomerRules();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function lift() {
    setBusy(true);
    setError(null);
    try {
      await setCustomerBan(customerId, false, null);
      toast.ok(tr('ws.customerRules.ban.lifted'));
      invalidate(customerId);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title={tr('ws.customerRules.ban.liftTitle', { name: isolate(name) })}
      body={
        <>
          <p>{tr('ws.customerRules.ban.liftBody')}</p>
          <ErrorText error={error} />
        </>
      }
      confirmLabel={tr('ws.customerRules.ban.liftConfirm')}
      busy={busy}
      onConfirm={() => void lift()}
      onCancel={onClose}
    />
  );
}

/** Across the top of a banned record: what, why, who and when, and the way back. */
export function BanBanner({
  ban,
  tz,
  canLift,
  onLift,
}: {
  ban: CustomerBan;
  tz: string;
  canLift: boolean;
  onLift: () => void;
}) {
  const { tr, locale } = useLocale();
  const { reachable } = useStationReach();
  const date = ban.at ? formatDate(new Date(ban.at), locale, tz) : null;
  const who = ban.by?.name
    ? tr('ws.customerRules.ban.bannerBy', { name: isolate(ban.by.name), date: date ?? '' })
    : date
      ? tr('ws.customerRules.ban.bannerOn', { date })
      : null;
  return (
    <div
      role="status"
      data-testid="ban-banner"
      style={{
        display: 'flex',
        gap: 'var(--tp-sp-3)',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: 'var(--tp-sp-3) var(--tp-sp-4)',
        borderRadius: 'var(--tp-radius-panel)',
        background: 'var(--tp-danger-soft)',
        color: 'var(--tp-danger-fg)',
        border: '1px solid var(--tp-danger)',
      }}
    >
      <Icon name="ban" size={22} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 18rem', minInlineSize: 0 }}>
        <strong style={{ fontSize: 'var(--tp-fs-lg)' }}>{tr('ws.customerRules.ban.banner')}</strong>
        <span style={{ color: 'var(--tp-fg)' }}>
          {ban.reason && <bdi>{ban.reason}</bdi>}
          {ban.reason && who ? ' · ' : null}
          {who && <span style={{ color: 'var(--tp-muted-fg)' }}>{who}</span>}
        </span>
      </div>
      {canLift && (
        <Button
          icon="ban"
          disabled={!reachable}
          disabledReason={tr('ws.customerRules.offline')}
          onClick={onLift}
          data-testid="ban-lift"
        >
          {tr('ws.customerRules.ban.lift')}
        </Button>
      )}
    </div>
  );
}
