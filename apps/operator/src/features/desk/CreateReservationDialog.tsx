/**
 * 06.3 BookingCreateScreen — stays a dialog over the calendar (and Today's
 * board). States: ready · busy · conflict (SLOT_TAKEN — the write was
 * rejected, nothing saved) · error. A booking needs a name OR a linked
 * customer, never both; a customer is optional (spec 06.3 note).
 *
 * e2e selectors kept: dialog 'New booking', label 'Guest name', label
 * 'Duration' (option values are minutes), button 'Create booking'.
 */
import { useState } from 'react';
import { formatDateTime } from '@touch/i18n';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { AppRpcError } from '../../lib/appRpc';
import type { CourtRow } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import { ConflictNotice, MessagePresenter } from '../../components/kit';
import { CustomerPicker, type PickedCustomer } from './customers/CustomerPicker';
import { nameFromQuery, phoneFromQuery, sanitizeName, sanitizePhone } from './deskLogic';

export type CreateKind = 'booking' | 'maintenance';

export function CreateReservationDialog({
  courtId,
  startAt,
  courts,
  tz,
  onClose,
  onCreated,
}: {
  courtId: string;
  startAt: Date;
  courts: readonly CourtRow[];
  tz: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { tr, locale } = useLocale();
  const court = courts.find((c) => c.id === courtId);
  const durations = court?.duration_options?.length ? court.duration_options : [60, 90, 120];
  const [kind, setKind] = useState<CreateKind>('booking');
  const [duration, setDuration] = useState<number>(durations[0] ?? 60);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  /*
   * Whether each box below holds something the operator typed into it. While
   * one does not, the customer search mirrors every keystroke into it: a search
   * that turns out to have no account IS the walk-in, and the desk used to have
   * to type the whole thing a second time to book it. The search takes either a
   * name or a number, so each box takes the half of the query that belongs to
   * it — letters to one, digits to the other. Same rule as the series builder.
   */
  const [nameTouched, setNameTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await mutate('reservation.create', {
        clientRef: clientRef(),
        courtId,
        kind,
        startAt: startAt.toISOString(),
        // The server prices the slot; the end is the chosen duration from the court's own list.
        endAt: new Date(startAt.getTime() + duration * 60_000).toISOString(),
        ...(guestName.trim() ? { guestName: guestName.trim() } : {}),
        ...(guestPhone.trim() ? { guestPhone: guestPhone.trim() } : {}),
        ...(customer ? { guestId: customer.id } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onCreated();
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'SLOT_TAKEN') setConflict(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && (kind === 'maintenance' || guestName.trim().length > 0 || customer !== null);

  return (
    <Modal
      title={tr('op.desk.newBooking')}
      subtitle={`${court ? pickName(locale, court) : ''} · ${formatDateTime(startAt, locale, tz)}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!canSubmit}
            disabledReason={tr('ws.courtDesk.create.needsGuest')}
            onClick={() => void submit()}
          >
            {tr('op.desk.create')}
          </Button>
        </>
      }
    >
      {conflict && (
        <ConflictNotice
          body={tr('ws.courtDesk.create.conflictBody')}
          resolveLabel={tr('ws.courtDesk.create.pickAnother')}
          onResolve={onClose}
          style={{ marginBlockEnd: '0.85rem' }}
        />
      )}
      <Field label={tr('op.desk.kind')}>
        <Select<CreateKind>
          value={kind}
          disabled={busy}
          onChange={setKind}
          options={[
            { value: 'booking', label: tr('op.desk.kindBooking') },
            { value: 'maintenance', label: tr('op.desk.kindMaintenance') },
          ]}
        />
      </Field>
      <Field label={tr('op.desk.duration')} hint={tr('ws.courtDesk.create.priced')}>
        <select style={inputStyle} value={duration} disabled={busy} onChange={(e) => setDuration(Number(e.target.value))}>
          {durations.map((d) => (
            <option key={d} value={d}>
              {tr('op.common.minutesShort', { minutes: d })}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'booking' && (
        <>
          <CustomerPicker
            value={customer}
            disabled={busy}
            onQueryChange={(q) => {
              if (!nameTouched) setGuestName(nameFromQuery(q));
              if (!phoneTouched) setGuestPhone(phoneFromQuery(q));
            }}
            onChange={(next) => {
              setCustomer(next);
              if (next) {
                // What the account says outranks what was searched for.
                if (!nameTouched || guestName.trim() === '') setGuestName(sanitizeName(next.name));
                if (next.phone && (!phoneTouched || guestPhone.trim() === '')) setGuestPhone(sanitizePhone(next.phone));
              }
            }}
          />
          <MessagePresenter tone="info" message={tr('ws.courtDesk.create.noCustomerNote')} style={{ marginBlockEnd: '0.85rem' }} />
          <Field label={tr('op.desk.guestName')} required={customer === null}>
            <input
              style={inputStyle}
              value={guestName}
              disabled={busy}
              maxLength={200}
              onChange={(e) => {
                setNameTouched(true);
                setGuestName(sanitizeName(e.target.value));
              }}
              autoFocus
            />
          </Field>
          <Field label={tr('op.desk.guestPhone')}>
            <input
              style={inputStyle}
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
              value={guestPhone}
              disabled={busy}
              onChange={(e) => {
                setPhoneTouched(true);
                setGuestPhone(sanitizePhone(e.target.value));
              }}
            />
          </Field>
        </>
      )}
      <Field label={tr('op.common.notes')}>
        <input style={inputStyle} value={notes} disabled={busy} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}
