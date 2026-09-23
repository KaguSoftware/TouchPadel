/**
 * 06.3 BookingCreateScreen — stays a dialog over the calendar (and Today's
 * board). States: ready · busy · conflict (SLOT_TAKEN — the write was
 * rejected, nothing saved) · error. A booking needs a name OR a linked
 * customer, never both; a customer is optional (spec 06.3 note).
 *
 * WHY THIS ORDER
 *
 * A guest is standing at the counter. The first thing the clerk types is who
 * they are, so the guest comes first and the search box has the focus: typing
 * a name or number finds an account, and when there is none the same
 * keystrokes are already in the name and phone boxes (see CustomerPicker).
 * Then when and how long, with the PRICE the guest is about to ask for — read
 * from `app.price_slot`, the very function staff_create_reservation charges
 * with, so the figure shown is the figure booked. It used to say only "the
 * server prices the slot when it is created".
 *
 * Court and start are editable when the caller passes the night (`night`):
 * Today's "New booking" opens on the next free half-hour, which is a guess, and
 * a guess the clerk could not change sent them to the calendar to start over.
 * Start times the rows on screen already show as taken are marked and cannot
 * be picked; the exclusion constraint still has the final word.
 *
 * e2e selectors kept: dialog 'New booking', label 'Guest name', label
 * 'Duration' (a native select whose option values are minutes), button
 * 'Create booking'.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { SLOT_MIN } from './useTradingNight';
import { formatDate, formatNumber, formatTime, formatTimeRange } from '@touch/i18n';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import type { CourtRow } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import { ConflictNotice, Money, SegmentedControl } from '../../components/kit';
import { CustomerPicker, type PickedCustomer } from './customers/CustomerPicker';
import { durationsFitting, nameFromQuery, phoneFromQuery, sanitizeName, sanitizePhone, slotTaken } from './deskLogic';
import type { ReservationRow } from './deskTypes';

export type CreateKind = 'booking' | 'maintenance';

/** The trading night the dialog may move within: its date, its half-hour rows and what already holds them. */
export interface CreateNight {
  date: string;
  rows: readonly number[];
  reservations: readonly ReservationRow[];
}

export function CreateReservationDialog({
  courtId: initialCourtId,
  startAt: initialStartAt,
  courts,
  tz,
  night,
  customer: initialCustomer = null,
  onClose,
  onCreated,
}: {
  courtId: string;
  startAt: Date;
  courts: readonly CourtRow[];
  tz: string;
  /** Pass to let the clerk change court and start inside the dialog. */
  night?: CreateNight;
  /** A customer the booking starts linked to (the calendar's "book for" mode). */
  customer?: PickedCustomer | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { tr, locale } = useLocale();
  const [courtId, setCourtId] = useState(initialCourtId);
  const [startIso, setStartIso] = useState(() => initialStartAt.toISOString());
  const court = courts.find((c) => c.id === courtId);
  // Its own memo so the clamp below does not rebuild on every keystroke.
  const soldKey = court?.duration_options?.join(',') ?? '';
  const sold = useMemo(
    () => (court?.duration_options?.length ? court.duration_options : [60, 90, 120]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soldKey],
  );
  const [kind, setKind] = useState<CreateKind>('booking');
  const [durationPick, setDuration] = useState<number>(sold[0] ?? 60);
  const [guestName, setGuestName] = useState(() => (initialCustomer ? sanitizeName(initialCustomer.name) : ''));
  const [guestPhone, setGuestPhone] = useState(() => (initialCustomer?.phone ? sanitizePhone(initialCustomer.phone) : ''));
  const [notes, setNotes] = useState('');
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
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

  const startAt = useMemo(() => new Date(startIso), [startIso]);

  /*
   * A game may not run past the close. The night's rows are minutes from its
   * own midnight and each row is one slot, so the last row plus a slot IS the
   * closing minute; the chosen start is placed on the same scale by the offset
   * from the first row. Without the night (the dialog opened from a screen
   * that passes none) there is no close to clamp to and the court's whole
   * list stands.
   */
  const durations = useMemo(() => {
    if (!night || night.rows.length === 0) return [...sold].sort((a, b) => a - b);
    const openMin = night.rows[0]!;
    const closeMin = night.rows[night.rows.length - 1]! + SLOT_MIN;
    const startMin =
      openMin + (startAt.getTime() - wallTimeToUtc(night.date, openMin, tz).getTime()) / 60_000;
    return durationsFitting(sold, startMin, closeMin);
  }, [night, sold, startAt, tz]);

  // A court (or a start) whose list no longer sells the pick falls back to the
  // shortest length that still fits.
  const duration = durations.includes(durationPick) ? durationPick : (durations[0] ?? 60);
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  // Start times the clerk may pick: the night's rows from now on, plus the
  // one the dialog opened on (the calendar never opens a past slot, but the
  // clock may have moved past it while the dialog was open).
  const nowMs = Date.now();
  const startOptions = useMemo(() => {
    if (!night) return [];
    return night.rows
      .map((min) => wallTimeToUtc(night.date, min, tz))
      .filter((d) => d.getTime() >= nowMs || d.toISOString() === initialStartAt.toISOString())
      .map((d) => ({
        iso: d.toISOString(),
        taken: slotTaken(night.reservations, courtId, d.getTime(), d.getTime() + duration * 60_000),
      }));
    // nowMs is read per render on purpose; the list only needs to be as fresh as the last change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night, tz, courtId, duration, initialStartAt]);
  const chosenTaken = night ? slotTaken(night.reservations, courtId, startAt.getTime(), endAt.getTime()) : false;

  const priceQ = useQuery({
    queryKey: ['priceSlot', courtId, startIso, duration],
    enabled: kind === 'booking' && courtId !== '',
    queryFn: () => appRpc<{ rule_id: string; price_iqd: number }[]>('price_slot', { p_court_id: courtId, p_start_at: startIso, p_duration_min: duration }),
    staleTime: 60_000,
    retry: false,
  });
  // Zero rows is an answer: no rate rule sells this length at this time, and
  // the server will refuse the booking. An error is not an answer — never block on it.
  const unpriced = kind === 'booking' && priceQ.isSuccess && (priceQ.data?.length ?? 0) === 0;

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
        endAt: endAt.toISOString(),
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

  const needsGuest = kind === 'booking' && guestName.trim().length === 0 && customer === null;
  // Nothing the court sells fits before the close, so there is no booking to
  // make from this start at all.
  const closesTooSoon = durations.length === 0;
  const canSubmit = !busy && !needsGuest && !chosenTaken && !unpriced && !closesTooSoon;
  /*
   * Why Create is disabled. A missing guest name is NOT among these: the name
   * box already carries the required mark, so the tooltip only restated what
   * the field says, and it is the one blocked state the desk fixes by typing
   * rather than by changing the booking.
   */
  const blockedReason = closesTooSoon
    ? tr('ws.courtDesk.create.closesTooSoonReason')
    : chosenTaken
      ? tr('ws.courtDesk.create.takenReason')
      : unpriced
        ? tr('ws.courtDesk.create.noPriceReason')
        : undefined;

  const courtLabel = court ? pickName(locale, court) : '';

  return (
    <Modal
      title={tr('op.desk.newBooking')}
      subtitle={
        <bdi>
          {courtLabel} · {formatDate(startAt, locale, tz)} · {formatTimeRange(startAt, endAt, locale, tz)}
        </bdi>
      }
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} disabled={!canSubmit} disabledReason={blockedReason} onClick={() => void submit()}>
            {tr('op.desk.create')}
          </Button>
        </>
      )}
    >
      {conflict && (
        <ConflictNotice
          body={tr('ws.courtDesk.create.conflictBody')}
          resolveLabel={tr('ws.courtDesk.create.pickAnother')}
          onResolve={night ? () => setConflict(false) : onClose}
          style={{ marginBlockEnd: '0.85rem' }}
        />
      )}
      {/* group: a <label> around a set of buttons forwards the click to the first of them — see Field. */}
      <Field label={tr('op.desk.kind')} group>
        <SegmentedControl<CreateKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'booking', label: tr('op.desk.kindBooking'), disabled: busy },
            { value: 'maintenance', label: tr('ws.courtDesk.create.kindBlock'), disabled: busy },
          ]}
        />
      </Field>

      {kind === 'booking' && (
        <>
          <CustomerPicker
            value={customer}
            disabled={busy}
            autoFocus={initialCustomer === null}
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
          <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
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
              />
            </Field>
            <Field label={tr('op.desk.guestPhone')} optional>
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
          </div>
        </>
      )}

      <div className="tp-grid" data-cols={night ? '3' : '2'} style={{ columnGap: 'var(--tp-sp-3)' }}>
        {night && (
          <Field label={tr('ws.courtDesk.create.court')}>
            <Select value={courtId} disabled={busy} onChange={setCourtId} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
          </Field>
        )}
        {night && (
          <Field label={tr('ws.courtDesk.create.start')} error={chosenTaken ? tr('ws.courtDesk.create.takenNote') : undefined}>
            <Select
              value={startIso}
              disabled={busy}
              onChange={setStartIso}
              options={startOptions.map((o) => ({
                value: o.iso,
                label: o.taken ? tr('ws.courtDesk.create.startTaken', { time: formatTime(new Date(o.iso), locale, tz) }) : formatTime(new Date(o.iso), locale, tz),
                disabled: o.taken && o.iso !== startIso,
              }))}
            />
          </Field>
        )}
        <Field
          label={tr('op.desk.duration')}
          error={closesTooSoon ? tr('ws.courtDesk.create.closesTooSoon') : undefined}
        >
          <Select
            value={String(duration)}
            disabled={busy || closesTooSoon}
            onChange={(d) => setDuration(Number(d))}
            options={durations.map((d) => ({ value: String(d), label: tr('op.common.minutesShort', { minutes: formatNumber(d, locale) }) }))}
          />
        </Field>
        {!night && kind === 'booking' && <PriceLine loading={priceQ.isPending} failed={priceQ.isError} price={priceQ.data?.[0]?.price_iqd ?? null} unpriced={unpriced} />}
      </div>

      {/* Notes sit above the price: the price is the last thing the desk reads
       out before pressing Create, so it ends the form rather than being
       buried between two boxes. */}
      <Field label={kind === 'maintenance' ? tr('ws.courtDesk.create.blockReason') : tr('op.common.notes')} optional={kind === 'booking'}>
        <input style={inputStyle} value={notes} disabled={busy} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {night && kind === 'booking' && <PriceLine loading={priceQ.isPending} failed={priceQ.isError} price={priceQ.data?.[0]?.price_iqd ?? null} unpriced={unpriced} />}
      <ErrorText error={error} />
    </Modal>
  );
}

/** The price of what is about to be booked, or why there is none. */
function PriceLine({ loading, failed, price, unpriced }: { loading: boolean; failed: boolean; price: number | null; unpriced: boolean }) {
  const { tr } = useLocale();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--tp-sp-2)',
        flexWrap: 'wrap',
        marginBlockEnd: '0.85rem',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-3)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: unpriced ? 'var(--tp-warn-soft)' : 'var(--tp-surface-2)',
      }}
    >
      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.courtDesk.create.price')}</span>
      {unpriced ? (
        <strong style={{ color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.courtDesk.create.noPrice')}</strong>
      ) : loading || failed || price === null ? (
        // Unreported is "—", never a made-up zero; a failed quote does not block the booking.
        <strong style={{ marginInlineStart: 'auto', color: 'var(--tp-muted-fg)' }}>—</strong>
      ) : (
        <Money amount={price} strong style={{ marginInlineStart: 'auto', fontSize: 'var(--tp-fs-lg)' }} />
      )}
    </div>
  );
}
