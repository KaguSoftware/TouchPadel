/**
 * Start an open match at the desk (docs/design/open-matches/operator.md
 * §5.11): opened from the new-booking dialog's Open match kind, the Today
 * group, the calendar in `kind=match` mode and the customer record. Court,
 * start and customer carry over from where it was opened.
 *
 * The rules that block Start are startMatchLogic's mirrors of
 * app.desk_start_match (OM-43 against the server's clock, an organiser, "ask
 * to join" only for someone with the app, the category against a declared
 * gender, a ban); the server decides, and a refusal it raises is read from
 * its detail (matchLogic.matchErrorText). The price is a preview from the
 * same function the server stamps with (app.price_slot, DF-3); when the
 * stamped price differs, the toast says the new one.
 *
 * Online only (DF-11): offline, Start stays on screen, disabled, with the
 * reason. The idempotency key is minted once per dialog and sent again on a
 * retry, so a double tap starts one match.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatIQD, formatNumber, formatTime, formatTimeRange, isolate, isolateLtr } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import type { CourtRow } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../components/kit';
import { CustomerPicker, type PickedCustomer } from '../desk/customers/CustomerPicker';
import { durationsFitting, nameFromQuery, phoneFromQuery, sanitizeName, sanitizePhone } from '../desk/deskLogic';
import type { CreateNight } from '../desk/CreateReservationDialog';
import { SLOT_MIN } from '../desk/useTradingNight';
import { invalidateMatchSeats, useMatchIdemKey } from './useMatches';
import { matchErrorText } from './matchLogic';
import { categoryKey, fillText } from './OpenMatchesStrip';
import type { OpenMatch, OpenMatches } from './matchPayloads';
import {
  EXTRA_SEATS,
  GUEST_NAME_MAX,
  earliestStartAt,
  guestFieldOf,
  guestFieldText,
  previewShares,
  quotedShare,
  stampedPriceDiffers,
  startArgs,
  startDraftErrors,
  startSeatLabels,
  type ExtraSeats,
  type MatchCategory,
  type MatchJoinPolicy,
  type MatchVisibility,
  type StartBlock,
  type StartDraft,
} from './startMatchLogic';

/** The picked customer, with the declared gender when the search row carries it (customer_search, 0262). */
type Organiser = PickedCustomer & { gender?: string | null };

export interface StartMatchDialogProps {
  courtId: string;
  startAt: Date;
  courts: readonly CourtRow[];
  tz: string;
  /** Pass to let the desk change court and start inside the dialog. */
  night?: CreateNight;
  /** The organiser carried over (the booking dialog's pick, the record's customer). */
  customer?: Organiser | null;
  /** A typed walk-in carried over from the booking dialog. */
  guestName?: string;
  guestPhone?: string;
  /**
   * app.desk_open_matches for the night: its `server_now` and
   * `earliest_start_minutes` feed the OM-43 mirror, its matches the
   * MATCH_SLOT_FULL list. Undefined while it loads.
   */
  openMatches: OpenMatches | null | undefined;
  /** When that envelope was read (the query's dataUpdatedAt), so the mirror moves with the clock. */
  openMatchesAt?: number;
  onClose: () => void;
}

export function StartMatchDialog({
  courtId: initialCourtId,
  startAt: initialStartAt,
  courts,
  tz,
  night,
  customer: initialCustomer = null,
  guestName: initialName = '',
  guestPhone: initialPhone = '',
  openMatches,
  openMatchesAt,
  onClose,
}: StartMatchDialogProps) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const idem = useMatchIdemKey('start');

  const [courtId, setCourtId] = useState(initialCourtId);
  const [startIso, setStartIso] = useState(() => initialStartAt.toISOString());
  const court = courts.find((c) => c.id === courtId);
  const soldKey = court?.duration_options?.join(',') ?? '';
  const sold = useMemo(
    () => (court?.duration_options?.length ? court.duration_options : [60, 90, 120]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soldKey],
  );
  const [durationPick, setDuration] = useState<number>(sold[0] ?? 60);
  const [customer, setCustomer] = useState<Organiser | null>(initialCustomer);
  const [guestName, setGuestName] = useState(() => (initialCustomer ? sanitizeName(initialCustomer.name) : sanitizeName(initialName)));
  const [guestPhone, setGuestPhone] = useState(() => sanitizePhone(initialCustomer?.phone ?? initialPhone));
  const [nameTouched, setNameTouched] = useState(initialName !== '');
  const [phoneTouched, setPhoneTouched] = useState(initialPhone !== '');
  // The phone's box says it is not a number once the desk leaves it, not at the first digit.
  const [phoneLeft, setPhoneLeft] = useState(initialPhone !== '');
  const [category, setCategory] = useState<MatchCategory>('open');
  const [joinPolicy, setJoinPolicy] = useState<MatchJoinPolicy>('open');
  const [visibility, setVisibility] = useState<MatchVisibility>('public');
  const [extraSeats, setExtraSeats] = useState<ExtraSeats>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const startAt = useMemo(() => new Date(startIso), [startIso]);

  // A game may not run past the close: the same clamp as the booking dialog.
  const durations = useMemo(() => {
    if (!night || night.rows.length === 0) return [...sold].sort((a, b) => a - b);
    const openMin = night.rows[0]!;
    const closeMin = night.rows[night.rows.length - 1]! + SLOT_MIN;
    const startMin = openMin + (startAt.getTime() - wallTimeToUtc(night.date, openMin, tz).getTime()) / 60_000;
    return durationsFitting(sold, startMin, closeMin);
  }, [night, sold, startAt, tz]);
  const duration = durations.includes(durationPick) ? durationPick : (durations[0] ?? 60);
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  // A filling match holds no court (OM-12), so no start is "taken" here; only
  // the past is left out, plus the one the dialog opened on.
  const nowMs = Date.now();
  const startOptions = useMemo(() => {
    if (!night) return [];
    return night.rows
      .map((min) => wallTimeToUtc(night.date, min, tz))
      .filter((d) => d.getTime() >= nowMs || d.toISOString() === initialStartAt.toISOString())
      .map((d) => d.toISOString());
    // nowMs is read per render on purpose, as in the booking dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night, tz, initialStartAt]);

  // The same quote the booking dialog reads (and caches): the function the server stamps with.
  const priceQ = useQuery({
    queryKey: ['priceSlot', courtId, startIso, duration],
    enabled: courtId !== '',
    queryFn: () => appRpc<{ rule_id: string; price_iqd: number }[]>('price_slot', { p_court_id: courtId, p_start_at: startIso, p_duration_min: duration }),
    staleTime: 60_000,
  });
  const unpriced = priceQ.isSuccess && (priceQ.data?.length ?? 0) === 0;
  const previewPrice = priceQ.data?.[0]?.price_iqd ?? null;
  const previewShare = quotedShare(previewShares(previewPrice));

  const draft: StartDraft = {
    courtId,
    startAt: startIso,
    durationMin: duration,
    category,
    joinPolicy,
    visibility,
    extraSeats,
    customer,
    guestName,
    guestPhone,
  };
  const clock = {
    serverNow: openMatches?.server_now,
    earliestStartMinutes: openMatches?.earliest_start_minutes,
    elapsedMs: openMatchesAt ? Math.max(0, nowMs - openMatchesAt) : 0,
  };
  const blocks = startDraftErrors(draft, clock);
  const earliest = earliestStartAt(clock);
  const blockText: Record<StartBlock, string> = {
    organiserRequired: tr('op.errors.GUEST_REQUIRED'),
    nameTooLong: guestFieldText('name', tr, locale),
    phoneInvalid: guestFieldText('phone', tr, locale),
    banned: tr('ws.matches.start.banned'),
    genderMismatch: tr('ws.matches.start.genderMismatch'),
    approveNeedsCustomer: tr('ws.matches.start.approveNeedsCustomer'),
    tooLate: tr('ws.matches.errors.tooLateAt', { time: earliest ? formatTime(new Date(earliest), locale, tz) : '—' }),
  };
  const closesTooSoon = durations.length === 0;
  const blockedReason = !reachable
    ? tr('ws.matches.offline.needsConnection')
    : closesTooSoon
      ? tr('ws.courtDesk.create.closesTooSoonReason')
      : unpriced
        ? tr('ws.courtDesk.create.noPriceReason')
        : blocks.length > 0
          ? blockText[blocks[0]!]
          : undefined;
  const canSubmit = !busy && blockedReason === undefined;

  // MATCH_SLOT_FULL: the matches already filling at that time, to add the players to instead.
  const slotFull = error instanceof AppRpcError && error.code === 'MATCH_SLOT_FULL';
  const overlapping: OpenMatch[] = slotFull
    ? (openMatches?.matches ?? []).filter(
        (m) => m.status === 'filling' && Date.parse(m.start_at) < endAt.getTime() && startAt.getTime() < Date.parse(m.end_at),
      )
    : [];

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      const out = (await appRpc('desk_start_match', startArgs(draft, idem.key()))) as { match_id: string; price_iqd?: number | null; shares_iqd?: number[] | null };
      idem.renew();
      invalidateMatchSeats(queryClient);
      const stamped = typeof out.price_iqd === 'number' ? out.price_iqd : null;
      if (stamped !== null && stampedPriceDiffers(previewPrice, stamped)) {
        const share = quotedShare(out.shares_iqd ?? previewShares(stamped));
        toast.ok(tr('ws.matches.start.startedPriceToast', { price: formatIQD(stamped, locale), share: share === null ? '—' : formatIQD(share, locale) }));
      } else {
        toast.ok(tr('ws.matches.start.startedToast'));
      }
      onClose();
      void navigate({ to: '/desk/matches/$id', params: { id: out.match_id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const seatName = customer?.name ?? (guestName.trim() || '—');
  const seats = startSeatLabels(seatName, extraSeats)
    .map((s) => (s.plus === null ? isolate(s.name) : `${isolate(s.name)} ${isolateLtr(`+${s.plus}`)}`))
    .join(' · ');
  const courtLabel = court ? pickName(locale, court) : '';
  const banned = blocks.includes('banned');
  const mismatch = blocks.includes('genderMismatch');
  // A typed organiser's name or phone the server would refuse: said on its box,
  // from the mirror before Start, or from the refusal after it (§5.7).
  const serverField = guestFieldOf(error);
  const nameError = blocks.includes('nameTooLong') || serverField === 'name' ? guestFieldText('name', tr, locale) : undefined;
  const phoneError = (phoneLeft && blocks.includes('phoneInvalid')) || serverField === 'phone' ? guestFieldText('phone', tr, locale) : undefined;

  return (
    <Modal
      title={tr('ws.matches.start.title')}
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
            {tr('ws.matches.start.submit')}
          </Button>
        </>
      )}
    >
      <CustomerPicker
        label={tr('ws.matches.start.organiser')}
        value={customer}
        disabled={busy}
        autoFocus={initialCustomer === null}
        onQueryChange={(q) => {
          if (!nameTouched) setGuestName(nameFromQuery(q));
          if (!phoneTouched) setGuestPhone(phoneFromQuery(q));
        }}
        onChange={(next: Organiser | null) => {
          setCustomer(next);
          // "Ask to join" needs someone with the app to answer: a typed organiser cannot.
          if (!next && joinPolicy === 'approve') setJoinPolicy('open');
          if (next) {
            if (!nameTouched || guestName.trim() === '') setGuestName(sanitizeName(next.name));
            if (next.phone && (!phoneTouched || guestPhone.trim() === '')) setGuestPhone(sanitizePhone(next.phone));
          }
        }}
      />
      {banned && <MessagePresenter tone="refused" icon="ban" message={tr('ws.matches.start.banned')} style={{ marginBlockEnd: '0.85rem' }} />}
      {!customer && (
        <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
          <Field label={tr('op.desk.guestName')} required error={nameError}>
            <input
              style={inputStyle}
              value={guestName}
              disabled={busy}
              maxLength={GUEST_NAME_MAX}
              onChange={(e) => {
                setNameTouched(true);
                setGuestName(sanitizeName(e.target.value));
                if (serverField === 'name') setError(null);
              }}
            />
          </Field>
          <Field label={tr('op.desk.guestPhone')} optional error={phoneError}>
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
                if (serverField === 'phone') setError(null);
              }}
              onBlur={() => setPhoneLeft(true)}
            />
          </Field>
        </div>
      )}

      <Field label={tr('ws.matches.start.comingWith')} group hint={tr('ws.matches.start.seatsAtStart', { seats })}>
        <SegmentedControl<string>
          value={String(extraSeats)}
          onChange={(v) => setExtraSeats(Number(v) as ExtraSeats)}
          options={EXTRA_SEATS.map((n) => ({ value: String(n), label: n === 0 ? formatNumber(0, locale) : isolateLtr(`+${n}`), disabled: busy }))}
        />
      </Field>

      <Field
        label={tr('ws.matches.start.category')}
        group
        hint={category === 'women' ? tr('ws.matches.start.women') : category === 'men' ? tr('ws.matches.start.men') : undefined}
        error={
          mismatch && customer ? (
            <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              {tr('ws.matches.start.genderMismatch')}
              <Link to="/desk/customers/$id" params={{ id: customer.id }} style={{ color: 'var(--tp-accent)', fontWeight: 600 }}>
                {tr('ws.matches.start.openRecord')}
              </Link>
            </span>
          ) : undefined
        }
      >
        <SegmentedControl<MatchCategory>
          value={category}
          onChange={setCategory}
          options={(['open', 'women', 'men'] as const).map((c) => ({ value: c, label: tr(categoryKey(c)), disabled: busy }))}
        />
      </Field>

      <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
        <Field label={tr('ws.matches.start.join')} group hint={customer ? undefined : tr('ws.matches.start.approveNeedsCustomer')}>
          <SegmentedControl<MatchJoinPolicy>
            value={joinPolicy}
            onChange={setJoinPolicy}
            options={[
              { value: 'open', label: tr('ws.matches.common.join.open'), disabled: busy },
              { value: 'approve', label: tr('ws.matches.common.join.approve'), disabled: busy || !customer },
            ]}
          />
        </Field>
        <Field label={tr('ws.matches.start.visibility')} group>
          <SegmentedControl<MatchVisibility>
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'public', label: tr('ws.matches.common.visibility.public'), disabled: busy },
              { value: 'link', label: tr('ws.matches.common.visibility.link'), disabled: busy },
            ]}
          />
        </Field>
      </div>

      <div className="tp-grid" data-cols={night ? '3' : '1'} style={{ columnGap: 'var(--tp-sp-3)' }}>
        {night && (
          <Field label={tr('ws.courtDesk.create.court')}>
            <Select value={courtId} disabled={busy} onChange={setCourtId} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
          </Field>
        )}
        {night && (
          <Field label={tr('ws.courtDesk.create.start')} error={blocks.includes('tooLate') ? blockText.tooLate : undefined}>
            <Select
              value={startIso}
              disabled={busy}
              onChange={setStartIso}
              options={startOptions.map((iso) => ({ value: iso, label: formatTime(new Date(iso), locale, tz) }))}
            />
          </Field>
        )}
        <Field label={tr('op.desk.duration')} error={closesTooSoon ? tr('ws.courtDesk.create.closesTooSoon') : undefined}>
          <Select
            value={String(duration)}
            disabled={busy || closesTooSoon}
            onChange={(d) => setDuration(Number(d))}
            options={durations.map((d) => ({ value: String(d), label: tr('op.common.minutesShort', { minutes: formatNumber(d, locale) }) }))}
          />
        </Field>
      </div>
      {!night && blocks.includes('tooLate') && <MessagePresenter tone="refused" icon="clock" message={blockText.tooLate} style={{ marginBlockEnd: '0.85rem' }} />}

      <p
        data-testid="start-price"
        style={{
          margin: 0,
          marginBlockEnd: '0.85rem',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: 'var(--tp-sp-3)',
          borderRadius: 'var(--tp-radius-ctl)',
          background: unpriced ? 'var(--tp-warn-soft)' : 'var(--tp-surface-2)',
          color: unpriced ? 'var(--tp-warn-fg)' : undefined,
          fontSize: 'var(--tp-fs-sm)',
        }}
      >
        {unpriced
          ? tr('ws.courtDesk.create.noPrice')
          : tr('ws.matches.start.price', {
              // Unreported is "—", never a made-up zero; a failed quote does not block the start.
              price: previewPrice === null ? '—' : formatIQD(previewPrice, locale),
              share: previewShare === null ? '—' : formatIQD(previewShare, locale),
            })}
      </p>

      <ErrorText error={serverField ? null : error} message={error && !serverField ? matchErrorText(error, { tr, locale, tz, serverNow: openMatches?.server_now }) : null} />
      {overlapping.length > 0 && (
        <section style={{ marginBlockStart: 'var(--tp-sp-2)' }}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.matches.start.slotFull')}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {overlapping.map((m) => {
              const when = formatTimeRange(new Date(m.start_at), new Date(m.end_at), locale, tz);
              return (
                <li key={m.match_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                  <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {tr('ws.matches.calendar.stripChipOpen', { time: when, category: tr(categoryKey(m.category)), fill: fillText(m.seats_taken) })}
                  </bdi>
                  <Button
                    size="sm"
                    icon="plus"
                    style={{ marginInlineStart: 'auto' }}
                    aria-label={`${tr('ws.matches.today.addPlayer')} ${when}`}
                    onClick={() => {
                      onClose();
                      // A linked organiser goes with them: the match screen opens Add player with them picked.
                      void navigate({ to: '/desk/matches/$id', params: { id: m.match_id }, search: (customer ? { customer: customer.id } : {}) as never });
                    }}
                  >
                    {tr('ws.matches.today.addPlayer')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Modal>
  );
}
