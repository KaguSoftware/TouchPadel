/**
 * Add player (docs/design/open-matches/operator.md §5.13.9), opened from the
 * Players panel (an open seat, the footer, a no-show's "Add player here"), the
 * match screen's `?customer=` hand-back, and the Today group's rows. One
 * app.desk_add_seat call; the server puts the player on the lowest number open
 * for the desk and books the court when that makes four.
 *
 * The player is a customer found in the search (the booking dialog's
 * CustomerPicker, with its typed-query mirror into the name and phone boxes),
 * or a typed walk-in. **Create customer** leaves for the customer form with
 * `attach=match`, which hands the new customer back here through
 * `/desk/matches/$id?customer=<id>`.
 *
 * Client mirrors, each also refused by the server: a customer banned from
 * open matches (`match_ban`) cannot be added (MATCH_BANNED); in a women's or
 * men's match a customer who declared the other gender cannot be added, with
 * a link to their record (MATCH_GENDER_MISMATCH), and an undeclared customer
 * or a typed walk-in is sent with the category's gender, vouched at the desk
 * (OM-39). Online only (DF-11); the key is minted per dialog.
 *
 * A stepped wizard (components/StepWizard.tsx, Sait 2026-10-22): Who, then
 * Review (player, seat, what they owe), which holds Add player. Every element
 * is the approved preview's (operator-wizards.html, `seat`): "Add a player",
 * notes as WizardNote, Create customer as a link.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { formatIQD, formatNumber, formatTime, isolate, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { QK } from '../../lib/queryKeys';
import { fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { ErrorText, Field, inputStyle } from '../../components/ui';
import { ReviewList, StepWizard, WizardNote, type WizardAt, type WizardStep } from '../../components/StepWizard';
import { CustomerPicker, type PickedCustomer } from '../desk/customers/CustomerPicker';
import { PickerHint, WizardLinks } from '../desk/wizardParts';
import { nameFromQuery, phoneFromQuery, sanitizeName, sanitizePhone } from '../desk/deskLogic';
import type { CustomerRecord } from '../desk/deskTypes';
import { MATCH_SEATS, byCategory, matchErrorText, openSeatNumbers } from './matchLogic';
import { GUEST_NAME_MAX, guestFieldOf, guestFieldText, guestNameTooLong, guestPhoneInvalid } from './startMatchLogic';
import type { MatchDetail, MatchSeat } from './matchPayloads';
import { invalidateMatchSeats, useMatchDetail, useMatchIdemKey } from './useMatches';

export interface AddSeatDialogProps {
  matchId: string;
  /** A customer handed back from search or create (`/desk/matches/$id?customer=`), picked on open. */
  customerId?: string;
  onClose: () => void;
  /** After a success (the dialog has already invalidated the match reads). */
  onAdded?: () => void;
}

/**
 * The numbers open for the desk (db.md §3.2, R4, R21): a number nobody
 * carries, a late leaver's, or, after the start, a no-show's not yet
 * re-seated (the server's `can.replace`). app.desk_add_seat fills the lowest.
 */
export function deskOpenNumbers(seats: readonly MatchSeat[]): number[] {
  const open = new Set(openSeatNumbers(seats));
  for (const s of seats) {
    if (!s.carrying) continue;
    if (s.status === 'left_late' || (s.status === 'no_show' && s.can.replace)) open.add(s.seat_no);
  }
  return [...open].sort((a, b) => a - b);
}

/** The gender a match's category seats (OM-39), or null for an open match. */
export function categoryGender(category: string): 'female' | 'male' | null {
  return category === 'women' ? 'female' : category === 'men' ? 'male' : null;
}

/** A picked customer's declared gender, when the search or the record carried one. */
function declaredGender(c: PickedCustomer | null): string | null {
  const g = (c as { gender?: unknown } | null)?.gender;
  return typeof g === 'string' && g !== '' ? g : null;
}

export function AddSeatDialog({ matchId, customerId, onClose, onAdded }: AddSeatDialogProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { reachable } = useStationReach();
  const detailQ = useMatchDetail(matchId);
  const detail = detailQ.data ?? null;
  const idem = useMatchIdemKey('add');

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  // The phone's box says it is not a number once the desk leaves it, not at the first digit.
  const [phoneLeft, setPhoneLeft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [at, setAt] = useState<WizardAt>(0);
  // The branch's clock, for the lead's start time.
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  // A customer handed back from search or create arrives as an id: read the
  // record (the key the booking screen shares) and pick them once it lands.
  const handedQ = useQuery({
    queryKey: ['customer', customerId ?? ''],
    enabled: Boolean(customerId),
    queryFn: () => appRpc<CustomerRecord>('customer_record', { p_customer_id: customerId }),
  });
  const handed = handedQ.data ?? null;
  useEffect(() => {
    if (!handed) return;
    const gender = (handed.customer as { gender?: unknown }).gender;
    setCustomer({
      id: handed.customer.id,
      name: handed.customer.full_name,
      phone: handed.customer.phone,
      flags: handed.flags ?? [],
      ...(typeof gender === 'string' ? { gender } : null),
    } as PickedCustomer);
  }, [handed]);

  const match = detail?.match ?? null;
  const category = match?.category ?? 'open';
  const wanted = categoryGender(category);
  const declared = declaredGender(customer);
  const banned = customer?.flags.some((f) => f.type === 'match_ban') ?? false;
  const mismatch = customer !== null && wanted !== null && declared !== null && declared !== wanted;
  // A typed walk-in or an undeclared customer is seated as the category's gender, vouched here.
  const vouched = wanted !== null && (customer === null || declared === null);
  const booked = match?.status === 'booked';
  const nextNo = detail ? deskOpenNumbers(detail.seats)[0] : undefined;
  const share = match && nextNo !== undefined ? (match.shares_iqd[nextNo - 1] ?? null) : null;
  const needsPlayer = customer === null && guestName.trim() === '';
  // A typed player's name and phone as the server takes them (INVALID_ARGUMENT
  // p_guest_name / p_guest_phone): said on the box, from the mirror or the refusal.
  const nameTooLong = customer === null && guestNameTooLong(guestName);
  const phoneInvalid = customer === null && guestPhoneInvalid(guestPhone);
  const serverField = guestFieldOf(error);
  const nameError = nameTooLong || serverField === 'name' ? guestFieldText('name', tr, locale) : undefined;
  const phoneError = (phoneLeft && phoneInvalid) || serverField === 'phone' ? guestFieldText('phone', tr, locale) : undefined;

  const blocked = !reachable
    ? tr('ws.matches.offline.needsConnection')
    : banned
      ? tr('ws.matches.add.banned')
      : mismatch
        ? tr(category === 'women' ? 'ws.matches.add.genderWomen' : 'ws.matches.add.genderMen')
        : needsPlayer
          ? tr('ws.matches.add.needsPlayer')
          : nameTooLong
            ? guestFieldText('name', tr, locale)
            : phoneInvalid
              ? guestFieldText('phone', tr, locale)
              : undefined;

  async function add() {
    if (!match || blocked !== undefined) return;
    setBusy(true);
    setError(null);
    const statusBefore = match.status;
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      const out = (await appRpc('desk_add_seat', {
        p_match_id: match.id,
        p_customer_id: customer?.id ?? null,
        p_guest_name: customer ? null : guestName.trim(),
        p_guest_phone: customer ? null : guestPhone.trim() || null,
        p_gender: vouched ? wanted : null,
        p_idempotency_key: idem.key(),
      })) as { seat_no?: number; match_status?: string; reservation_id?: string | null } | null;
      idem.renew();
      invalidateMatchSeats(qc);
      const name = isolate(customer?.name ?? guestName.trim());
      toast.ok(await addedToast(out?.match_status ?? statusBefore, statusBefore, name));
      onAdded?.();
      onClose();
    } catch (e) {
      setError(e);
      // A refused name or phone is said on its box: back to the Who step.
      if (guestFieldOf(e)) setAt(0);
    } finally {
      setBusy(false);
    }
  }

  /** "{name} is in.", or at four: booked on the court, or waiting for one. */
  async function addedToast(statusAfter: string, statusBefore: string, name: string): Promise<string> {
    if (statusAfter === 'awaiting_court' && statusBefore !== 'awaiting_court') return tr('ws.matches.add.fourWaiting');
    if (statusAfter === 'booked' && statusBefore !== 'booked') {
      // The court is the one the match just booked: read it from the fresh detail.
      await qc.refetchQueries({ queryKey: QK.deskMatches.one(matchId), exact: true });
      const fresh = qc.getQueryData<MatchDetail | null>(QK.deskMatches.one(matchId))?.match;
      const court = fresh ? pickName(locale, { name_en: fresh.court_name_en ?? '', name_ar: fresh.court_name_ar ?? '' }) : '';
      return tr('ws.matches.add.fourBooked', { court: court ? isolate(court) : '—' });
    }
    return tr(byCategory(category, 'ws.matches.add.added'), { name });
  }

  const playerName = customer?.name ?? guestName.trim();
  const shareText = share === null ? '—' : formatIQD(share, locale);
  const courtName = match ? pickName(locale, { name_en: match.court_name_en ?? '', name_ar: match.court_name_ar ?? '' }) : '';
  const lead = match
    ? courtName
      ? tr('ws.matches.add.wizard.lead', { court: courtName, time: formatTime(new Date(match.start_at), locale, tz) })
      : tr('ws.matches.add.wizard.leadNoCourt', { time: formatTime(new Date(match.start_at), locale, tz) })
    : null;
  // What holds the Who step: the same mirrors as the server's refusals.
  const whoProblem = banned
    ? tr('ws.matches.add.banned')
    : mismatch
      ? tr(category === 'women' ? 'ws.matches.add.genderWomen' : 'ws.matches.add.genderMen')
      : needsPlayer
        ? tr('ws.matches.add.needsPlayer')
        : nameTooLong
          ? guestFieldText('name', tr, locale)
          : phoneInvalid
            ? guestFieldText('phone', tr, locale)
            : null;

  const steps: WizardStep[] = [
    {
      key: 'who',
      label: tr('ws.matches.add.wizard.stepWho'),
      note: playerName || null,
      problems: whoProblem ? [whoProblem] : [],
      flagged: serverField !== null,
      content: (
        <>
          {share !== null && <WizardNote>{tr(byCategory(category, 'ws.matches.add.oweShare'), { share: shareText })}</WizardNote>}
          <div>
            <CustomerPicker
              value={customer}
              disabled={busy}
              autoFocus={!customerId}
              onQueryChange={(q) => {
                if (!nameTouched) setGuestName(nameFromQuery(q));
                if (!phoneTouched) setGuestPhone(phoneFromQuery(q));
              }}
              onChange={(next) => {
                setCustomer(next);
                setError(null);
              }}
            />
            {customer === null && <PickerHint />}
          </div>
          {customer === null && (
            <>
              <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
                <Field label={tr('op.desk.guestName')} error={nameError} style={{ marginBlockEnd: 0 }}>
                  <input
                    style={inputStyle}
                    aria-required="true"
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
                <Field label={tr('op.desk.guestPhone')} optional error={phoneError} style={{ marginBlockEnd: 0 }}>
                  <input
                    style={inputStyle}
                    type="tel"
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
              <WizardLinks
                disabled={busy}
                links={[
                  {
                    label: tr('ws.matches.add.createCustomer'),
                    onClick: () => void navigate({ to: '/desk/customers/new', search: { attach: 'match', match: matchId } as never }),
                  },
                ]}
              />
            </>
          )}
          {banned && <WizardNote tone="refused">{tr('ws.matches.add.banned')}</WizardNote>}
          {mismatch && customer && (
            <WizardNote tone="refused">
              <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                {tr(category === 'women' ? 'ws.matches.add.genderWomen' : 'ws.matches.add.genderMen')}
                <Link to="/desk/customers/$id" params={{ id: customer.id }} style={{ color: 'var(--tp-accent)', fontWeight: 600 }}>
                  {tr('ws.matches.add.openRecord')}
                </Link>
              </span>
            </WizardNote>
          )}
          {vouched && !mismatch && (
            <WizardNote tone="success">{tr(category === 'women' ? 'ws.matches.add.vouchedWomen' : 'ws.matches.add.vouchedMen')}</WizardNote>
          )}
        </>
      ),
    },
  ];

  return (
    <StepWizard
      title={tr(booked ? 'ws.matches.add.titleBooked' : 'ws.matches.add.wizard.title')}
      lead={lead ? <bdi>{lead}</bdi> : undefined}
      steps={steps}
      at={at}
      onAtChange={setAt}
      busy={busy}
      submitBlocked={!reachable ? tr('ws.matches.offline.needsConnection') : !match ? tr('ws.kit.async.loading') : null}
      onClose={onClose}
      submitLabel={tr('ws.matches.add.submit')}
      onSubmit={() => void add()}
      testId="seat"
      notice={error && !serverField ? <ErrorText error={error} message={matchErrorText(error, { tr, locale })} /> : undefined}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            { label: tr('ws.matches.add.wizard.reviewPlayer'), value: <bdi>{playerName || '—'}</bdi>, step: 'who' },
            {
              label: tr('ws.matches.add.wizard.reviewSeat'),
              value: nextNo === undefined ? '—' : tr('ws.matches.add.wizard.seatOf', { n: formatNumber(nextNo, locale), total: formatNumber(MATCH_SEATS, locale) }),
            },
            { label: tr('ws.matches.add.wizard.reviewOwes'), value: share === null ? '—' : tr('ws.matches.add.wizard.owesAtDesk', { share: shareText }) },
          ]}
        />
      )}
    />
  );
}
