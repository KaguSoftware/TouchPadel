/**
 * 06.9 CustomerRecordScreen — the history behind a customer and the staff
 * notes on them (customer_record). Flags are editable (set_customer_flags)
 * and surface wherever the customer appears. Notes are STAFF-VISIBLE ONLY:
 * nothing here is passed to any printable or guest-facing surface, and each
 * note shows its author, time and whether it was edited.
 * States: loading · ready · error.
 *
 * Open matches (docs/design/open-matches/operator.md §5.15): the counts
 * include seat no-shows (DF-12, DF-15); an "Open matches" panel carries what
 * the customer plays as (with Change, GenderDialog), the ban (R35, chain-wide,
 * banFromMatches) and their recent and coming matches; the Tickets panel
 * (TicketsPanel) holds the wallet and the cash-out. A server before 0262
 * sends no gender and no matches, and the record shows none of it. Every
 * match write is online only (DF-11).
 *
 * Coaching (docs/design/coaching/operator.md §5.15): `customer_lessons`
 * gives the coach badge (not a flag), Make coach / Open in Coaches
 * (`manageCoaches`), Book a lesson (`runLessons`), the lesson counts and the
 * Lessons panel, where a cashier takes lesson money (R20). A server without
 * coaching (RPC_MISSING) shows none of it.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTimeRange, isolate, VENUE_TZ, type MessageKey } from '@touch/i18n';
import { appRpc, isRpcMissing } from '../../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../../lib/queries';
import { useToast } from '../../../components/toast';
import { useLocale, pickName } from '../../../lib/i18n';
import { can, canAccess, useAuth } from '../../../lib/auth';
import { useStationReach } from '../../../lib/stationReach';
import { useVenue } from '../../../lib/venue';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../../components/ui';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import {
  AsyncStateWrapper,
  DataTable,
  BidirectionalTextRenderer,
  BookingStatusIndicator,
  CustomerFlagBadge,
  EmptyState,
  InSectionDialog,
  MessagePresenter,
  Money,
  Panel,
  ReasonCodePrompt,
  StatusBadge,
  TabStatusIndicator,
  ViewMore,
  useListCap,
  type Column,
  type CustomerFlagType,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { matchStatusKey } from '../../matches/matchLogic';
import { invalidateMatchCustomer, useGuestTickets, useMatchCaps, useMatchRead } from '../../matches/useMatches';
import type { CustomerFlag, CustomerMatchRow, CustomerNote, CustomerRecord, CustomerReservationRow } from '../deskTypes';
import type { CustomerSearchParams } from './CustomerSearch';
import { GenderDialog } from './GenderDialog';
import { TicketsPanel } from './TicketsPanel';
import { CustomerLoyaltyPanel, CustomerLoyaltyTop } from '../../loyalty/CustomerLoyaltyPanel';
import { useLoyaltyCustomer } from '../../loyalty/useLoyalty';
import { CardFoot, CardPill, Figure, KeptRing, MiniList, RacketMark, RecordCard, SectionCard, Spark, StatRow, TearLine } from './RecordCards';
import { cafeSpark, initials, keptShare, lastOrderAt, nextBooking, tierColour, untilStart, type RecordSection } from './recordSummary';
import { editableFlags, isHereMatch, isMatchBanned, playsAsLine, playsAsOf, recordMatches, seatKindKey, seatStatusKey } from './ticketsLogic';
import { CustomerHoldStanding } from '../../holds/HoldStandingPanels';
import { CoachBadge } from '../../coaching/CoachBadge';
import { CustomerLessonsPanel } from '../../coaching/CustomerLessonsPanel';
import { useCoachingCaps, useCustomerLessons } from '../../coaching/useCoaching';

const FLAG_TYPES: readonly CustomerFlagType[] = ['vip', 'birthday', 'payment_note', 'special_request', 'deposit_exempt'];

export function CustomerRecordScreen() {
  const { tr, locale } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const params = useSearch({ strict: false }) as CustomerSearchParams;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const courtName = (cid: string) => pickName(locale, courtsQ.data?.find((c) => c.id === cid)) || cid;

  const recordQ = useQuery({
    queryKey: ['customer', id],
    queryFn: () => appRpc<CustomerRecord | null>('customer_record', { p_customer_id: id }),
  });
  const rec = recordQ.data ?? null;
  const [flagsOpen, setFlagsOpen] = useState(false);

  const status = recordQ.isError && !recordQ.data ? 'error' : recordQ.data === undefined ? 'loading' : recordQ.data === null ? 'empty' : 'ready';

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['customer', id] });
    void queryClient.invalidateQueries({ queryKey: ['customerSearch'] });
    void queryClient.invalidateQueries({ queryKey: ['customerDirectory'] });
  }

  function attach() {
    if (params.attach === 'booking' && params.reservation) {
      void navigate({ to: '/desk/bookings/$id', params: { id: params.reservation }, search: { customer: id } as never });
    } else if (params.attach === 'tab') {
      void navigate({ to: '/till', search: { tab: params.tab, customer: id } as never });
    } else if (params.attach === 'match' && params.match) {
      // Open matches §5.3: the match screen opens Add player with this customer picked.
      void navigate({ to: '/desk/matches/$id', params: { id: params.match }, search: { customer: id } as never });
    } else if (params.attach === 'tournament' && params.tournament) {
      // Tournaments §1.11: the tournament screen adds this customer as a walk-in.
      void navigate({ to: '/desk/tournaments/$id', params: { id: params.tournament }, search: { customer: id } as never });
    }
  }

  const counts = rec?.counts ?? { bookings: 0, cancellations: 0, noShows: 0, cafeOrders: 0 };
  const { staff } = useAuth();
  const canBook = canAccess(staff?.role, '/desk');
  const caps = useMatchCaps();
  // Coaching (§5.15): null on a server without customer_lessons (RPC_MISSING), and then no coaching UI.
  const lessonsQ = useCustomerLessons(id);
  const lessons = lessonsQ.data ?? null;
  const coachCaps = useCoachingCaps();
  // A server before 0262 sends no gender key and no matches: no open-match block on the record.
  const matchesKnown = rec ? playsAsOf(rec.customer).known || rec.matches !== undefined : false;
  const flagCount = rec ? editableFlags(rec.flags).length : 0;
  const attachLabel =
    params.attach === 'booking'
      ? tr('ws.courtDesk.customers.attachBooking')
      : params.attach === 'match'
        ? tr('ws.matches.customers.attachMatch')
        : params.attach === 'tournament'
          ? tr('ws.tournaments.entries.attach')
          : tr('ws.courtDesk.customers.attachTab');

  // The cards (2026-10-14): each opens its section in a dialog.
  const [section, setSection] = useState<RecordSection | null>(null);
  const loyaltyAllowed = can(staff?.role, 'attachMember');
  const loyaltyQ = useLoyaltyCustomer(id, loyaltyAllowed);
  const showLoyalty = loyaltyAllowed && !isRpcMissing(loyaltyQ.error);
  const ticketsQ = useGuestTickets(id, caps.runMatches);
  const ticketsRead = useMatchRead(ticketsQ);
  const showTickets = caps.runMatches && ticketsRead.kind !== 'absent';
  const showMatches = matchesKnown && caps.runMatches;

  const nowMs = Date.now();
  const next = rec ? nextBooking(rec.upcoming) : null;
  const kept = keptShare(counts);
  const keptShown = kept ?? { kept: 0, cancelled: 0, noShows: 0, pct: 0 };
  const playsAs = rec ? playsAsOf(rec.customer) : null;
  const matchRows = rec ? recordMatches(rec.matches, nowMs) : { upcoming: [], recent: [] };
  const lastOrder = rec ? lastOrderAt(rec.cafeOrders) : null;
  const n = (v: number | null | undefined) => (v == null ? '—' : formatNumber(v, locale));
  const nameOfRow = (r: CustomerReservationRow) => (r.court_name_en && r.court_name_ar ? pickName(locale, { name_en: r.court_name_en, name_ar: r.court_name_ar }) : courtName(r.court_id));
  const countdown = (startIso: string) => {
    const e = untilStart(startIso, nowMs);
    switch (e.unit) {
      case 'now':
        return tr('ws.courtDesk.record.cards.startsNow');
      case 'minutes':
        return tr('ws.courtDesk.record.cards.startsInMinutes', { minutes: formatNumber(e.minutes, locale) });
      case 'hours':
        return tr('ws.courtDesk.record.cards.startsInHours', { hours: formatNumber(e.hours, locale), minutes: formatNumber(e.minutes, locale) });
      case 'days':
        return tr('ws.courtDesk.record.cards.startsInDays', { days: formatNumber(e.days, locale), hours: formatNumber(e.hours, locale) });
    }
  };
  const close = () => setSection(null);
  const cafeColumns: Column<CustomerRecord['cafeOrders'][number]>[] = [
    { key: 'date', header: tr('ws.courtDesk.record.orderDate'), render: (o) => <bdi>{formatDateTime(new Date(o.opened_at), locale, tz)}</bdi> },
    { key: 'status', header: tr('ws.courtDesk.common.status'), render: (o) => <TabStatusIndicator status={o.status} size="sm" /> },
    { key: 'total', header: tr('ws.courtDesk.record.orderTotal'), numeric: true, render: (o) => <Money amount={o.total_iqd} /> },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      {/* Top bar: the way back, and the booking actions. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlockEnd: 'var(--tp-sp-3)', borderBlockEnd: '1px solid var(--tp-border)' }}>
        {/* A bordered button, not a ghost (owner, 2026-10-15). */}
        <Button icon="chevronStart" onClick={() => void navigate({ to: '/desk/customers' })}>
          {tr('ws.courtDesk.record.backToSearch')}
        </Button>
        <div className="tp-page-actions" style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {params.attach && (
            <Button kind="primary" icon="userPlus" onClick={attach}>
              {attachLabel}
            </Button>
          )}
          {canBook && matchesKnown && caps.runMatches && !params.attach && (
            <Button icon="users" onClick={() => void navigate({ to: '/desk', search: { customer: id, kind: 'match' } as never })}>
              {tr('ws.matches.customers.startMatch')}
            </Button>
          )}
          {lessons && canBook && coachCaps.runLessons && !params.attach && (
            <Button icon="whistle" onClick={() => void navigate({ to: '/desk', search: { customer: id, kind: 'lesson' } as never })}>
              {tr('ws.coaching.customers.bookLesson')}
            </Button>
          )}
          {canBook && (
            <Button kind={params.attach ? 'default' : 'primary'} icon="calendar" onClick={() => void navigate({ to: '/desk', search: { customer: id } as never })}>
              {tr('ws.courtDesk.record.newBooking')}
            </Button>
          )}
        </div>
      </div>

      <AsyncStateWrapper status={status} error={recordQ.error} onRetry={() => void recordQ.refetch()} emptyContent={<EmptyState icon="users" title={tr('ws.courtDesk.record.notFound')} />}>
        {rec && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            {/* Who this is. */}
            <header style={{ display: 'flex', gap: 'var(--tp-sp-4)', alignItems: 'center' }}>
              <span
                aria-hidden="true"
                style={{
                  inlineSize: '3.6rem',
                  blockSize: '3.6rem',
                  flex: 'none',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--tp-accent)',
                  color: 'var(--tp-accent-contrast)',
                  fontWeight: 700,
                  fontSize: 'var(--tp-fs-xl)',
                  boxShadow: '0 0 0 3px var(--tp-bg), 0 0 0 5px var(--tp-accent-2)',
                }}
              >
                {initials(rec.customer.full_name)}
              </span>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', minInlineSize: 0 }}>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: 'var(--tp-fs-3xl)', fontWeight: 700, lineHeight: 1.1, margin: 0 }}>{rec.customer.full_name}</h1>
                  {lessons?.coach && <CoachBadge status={lessons.coach.status} />}
                  {rec.flags.map((f, i) => (
                    <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} size="md" />
                  ))}
                  <Button size="sm" kind="ghost" icon="tag" onClick={() => setFlagsOpen(true)}>
                    {flagCount === 0 ? tr('ws.courtDesk.record.addFlags') : tr('ws.courtDesk.record.editFlags')}
                  </Button>
                  {lessons && coachCaps.manageCoaches && !params.attach && (
                    <Button
                      size="sm"
                      kind="ghost"
                      icon="whistle"
                      onClick={() =>
                        void navigate({
                          to: '/admin/coaches',
                          search: (lessons.coach ? { coach: lessons.coach.coach_id } : { tab: 'coaches', promote: id }) as never,
                        })
                      }
                    >
                      {lessons.coach ? tr('ws.coaching.customers.openInCoaches') : tr('ws.coaching.customers.makeCoach')}
                    </Button>
                  )}
                </div>
                <BidirectionalTextRenderer
                  style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}
                  parts={[
                    ...(rec.customer.phone ? [<bdi key="p" dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)' }}>{rec.customer.phone}</bdi>] : []),
                    ...(rec.customer.email ? [<bdi key="e" dir="ltr">{rec.customer.email}</bdi>] : []),
                    ...(rec.customer.preferred_lang === 'ar' ? [tr('ws.courtDesk.customers.lang.ar')] : rec.customer.preferred_lang === 'en' ? [tr('ws.courtDesk.customers.lang.en')] : []),
                    ...(rec.customer.created_at ? [`${tr('ws.courtDesk.record.since')} ${formatDate(new Date(rec.customer.created_at), locale, tz)}`] : []),
                  ]}
                />
              </div>
            </header>

            <CustomerHoldStanding customerId={id} />

            {/* The summary cards. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
              <RecordCard
                label={tr('ws.courtDesk.record.cards.nextBooking')}
                tone="accent"
                decoration={<RacketMark />}
                aside={next ? <CardPill tone="green">{countdown(next.start_at)}</CardPill> : undefined}
                testId="card-next-booking"
              >
                {next ? (
                  <>
                    <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', position: 'relative' }}>
                      <span style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, lineHeight: 1.1 }}>
                        <bdi>{formatDate(new Date(next.start_at), locale, tz)}</bdi>
                      </span>
                      <span style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--tp-fs-lg)', opacity: 0.92 }}>
                        <bdi>{formatTimeRange(new Date(next.start_at), new Date(next.end_at), locale, tz)}</bdi>
                      </span>
                    </span>
                    <span style={{ fontSize: 'var(--tp-fs-sm)', opacity: 0.9, position: 'relative' }}>
                      <bdi>{nameOfRow(next)}</bdi>
                      {next.price_iqd != null && (
                        <>
                          {' · '}
                          <Money amount={next.price_iqd} />
                        </>
                      )}
                    </span>
                  </>
                ) : (
                  <Figure size="md" value={tr('ws.courtDesk.record.cards.nothingBooked')} />
                )}
                <CardFoot rule>
                  <span>{tr('ws.courtDesk.record.cards.bookingsLine', { upcoming: n(rec.upcoming.length), past: n(rec.history.length) })}</span>
                </CardFoot>
              </RecordCard>

              <RecordCard label={tr('ws.courtDesk.record.cards.kept')} tone="scoreboard" onOpen={() => setSection('bookings')} testId="card-kept">
                {/* With no bookings yet the ring still shows, empty, at 0% and every count 0. */}
                <KeptRing
                  centre={tr('ws.courtDesk.record.cards.keptValue', { pct: formatNumber(keptShown.pct, locale) })}
                  parts={[
                    { key: 'kept', label: tr('ws.courtDesk.record.cards.keptPart'), value: keptShown.kept, color: 'var(--tp-ring-kept)' },
                    { key: 'cancelled', label: tr('ws.courtDesk.record.cards.cancelledPart'), value: keptShown.cancelled, color: 'var(--tp-ring-cancelled)' },
                    { key: 'noShows', label: tr('ws.courtDesk.record.cards.noShowsPart'), value: keptShown.noShows, color: 'var(--tp-ring-no-show)' },
                  ]}
                />
                {/* DF-12, DF-15: every no-show, saying how many were open-match seats. */}
                {counts.matchNoShows ? (
                  <CardFoot>
                    <span>{tr('ws.courtDesk.record.cards.allNoShows')}</span>
                    <span>{tr('ws.matches.customers.noShowsWithMatches', { count: formatNumber(counts.noShows, locale), matches: formatNumber(counts.matchNoShows, locale) })}</span>
                  </CardFoot>
                ) : null}
              </RecordCard>

              {showLoyalty && (
                <RecordCard
                  label={tr('ws.loyalty.panel.title')}
                  tone="loyalty"
                  tier={tierColour(loyaltyQ.data?.tier?.name_en)}
                  aside={loyaltyQ.data?.tier ? <CardPill tone="tier">{pickName(locale, { name_en: loyaltyQ.data.tier.name_en, name_ar: loyaltyQ.data.tier.name_ar })}</CardPill> : undefined}
                  onOpen={() => setSection('loyalty')}
                  testId="card-loyalty"
                >
                  {loyaltyQ.data ? (
                    <>
                      <Figure value={n(loyaltyQ.data.balance)} unit={tr('ws.loyalty.panel.balance')} />
                      <CardFoot rule>
                        <span>{tr('ws.loyalty.panel.points12m')}</span>
                        <span style={{ fontFamily: 'var(--tp-font-numeric)', fontWeight: 600, color: 'var(--tp-fg)' }}>{n(loyaltyQ.data.points_12m)}</span>
                      </CardFoot>
                    </>
                  ) : loyaltyQ.isError ? (
                    <Figure size="md" value="—" />
                  ) : (
                    <Skeleton lines={2} />
                  )}
                </RecordCard>
              )}

              {showTickets && (
                <RecordCard label={tr('ws.matches.customers.tickets.title')} tone="ticket" onOpen={() => setSection('tickets')} testId="card-tickets">
                  {ticketsRead.kind === 'ready' ? (
                    <>
                      <Figure value={n(ticketsRead.data.available)} unit={tr('ws.matches.customers.tickets.available')} />
                      <TearLine />
                      <CardFoot>
                        <span>
                          {tr('ws.matches.customers.tickets.reserved')} {n(ticketsRead.data.reserved)} · {tr('ws.matches.customers.tickets.inUse')} {n(ticketsRead.data.in_use)}
                        </span>
                      </CardFoot>
                    </>
                  ) : ticketsRead.kind === 'loading' ? (
                    <Skeleton lines={2} />
                  ) : (
                    <Figure size="md" value="—" />
                  )}
                </RecordCard>
              )}
            </div>

            {/* The section cards, and the staff notes beside them. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(18rem, 22rem)', gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: 'var(--tp-sp-3)', alignContent: 'start' }}>
                {showMatches && playsAs && (
                  <SectionCard icon="users" tone="matches" testId="card-matches" title={tr('ws.matches.customers.title')} sub={playsAsLine(playsAs, tr)} openLabel={tr('ws.courtDesk.record.cards.open')} onOpen={() => setSection('matches')}>
                    <Figure size="md" value={n(counts.matchesPlayed ?? 0)} unit={tr('ws.matches.customers.matchesPlayed')} />
                    {counts.lateLeaves !== undefined && (
                      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                        <span>{tr('ws.matches.customers.lateLeaves')}</span> <strong style={{ color: 'var(--tp-fg)' }}>{n(counts.lateLeaves)}</strong>
                      </span>
                    )}
                    <MiniList
                      rows={[...matchRows.upcoming, ...matchRows.recent].slice(0, 2).map((r) => ({
                        key: r.match_id,
                        dot: matchRows.upcoming.includes(r) ? 'info' : r.seat_status === 'attended' ? 'ok' : r.seat_status === 'no_show' ? 'bad' : 'neutral',
                        text: <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi>,
                        aside: matchStatusKey(r.status) ? tr(matchStatusKey(r.status)!) : r.status,
                      }))}
                    />
                  </SectionCard>
                )}
                {lessons && (
                  <SectionCard icon="whistle" tone="lessons" testId="card-lessons" title={tr('ws.coaching.customers.panelTitle')} sub={tr('ws.coaching.customers.counts', { lessons: n(lessons.counts.lessons), noShows: n(lessons.counts.no_shows) })} openLabel={tr('ws.courtDesk.record.cards.open')} onOpen={() => setSection('lessons')}>
                    <Figure size="md" value={n(lessons.counts.lessons)} unit={tr('ws.coaching.customers.panelTitle')} />
                    <MiniList
                      rows={[...lessons.lessons]
                        .sort((a, b) => b.start_at.localeCompare(a.start_at))
                        .slice(0, 2)
                        .map((l) => ({
                          key: l.enrolment_id,
                          dot: Date.parse(l.start_at) > nowMs ? 'info' : l.attendance === 'attended' ? 'ok' : l.attendance === 'no_show' ? 'bad' : 'neutral',
                          text: <bdi>{formatDate(new Date(l.start_at), locale, tz)}</bdi>,
                          aside: pickName(locale, { name_en: l.type_name_en ?? '', name_ar: l.type_name_ar ?? '' }) || undefined,
                        }))}
                    />
                  </SectionCard>
                )}
                {rec.cafeOrders.length > 0 && (
                  <SectionCard
                    icon="receipt"
                    tone="cafe" testId="card-cafe"
                    title={tr('ws.courtDesk.record.cafe')}
                    sub={lastOrder ? tr('ws.courtDesk.record.cards.lastOrder', { date: formatDate(new Date(lastOrder), locale, tz) }) : undefined}
                    openLabel={tr('ws.courtDesk.record.cards.open')}
                    onOpen={() => setSection('cafe')}
                  >
                    <Figure size="md" value={n(counts.cafeOrders ?? rec.cafeOrders.length)} unit={tr('ws.courtDesk.record.cafe')} />
                    <Spark values={cafeSpark(rec.cafeOrders)} />
                  </SectionCard>
                )}
                {rec.series.length > 0 && (
                  <SectionCard icon="repeat" tone="series" testId="card-series" title={tr('ws.courtDesk.record.series')} openLabel={tr('ws.courtDesk.record.cards.open')} onOpen={() => setSection('series')}>
                    <Figure size="md" value={n(rec.series.length)} unit={tr('ws.courtDesk.record.series')} />
                    <MiniList
                      rows={rec.series.slice(0, 2).map((s) => ({
                        key: s.id,
                        dot: s.cancelled_at ? 'neutral' : 'info',
                        text: <bdi>{courtName(s.court_id)}</bdi>,
                        aside: <bdi>{formatDate(new Date(`${s.ends_on}T12:00:00Z`), locale, 'UTC')}</bdi>,
                      }))}
                    />
                  </SectionCard>
                )}
              </div>
              <NoteList customerId={id} notes={rec.notes} tz={tz} onChanged={invalidate} />
            </div>
          </div>
        )}
      </AsyncStateWrapper>

      {/* The dialogs the cards open. */}
      {rec && section === 'bookings' && (
        <SectionDialog
          title={tr('ws.courtDesk.record.cards.bookings')}
          subtitle={rec.customer.full_name}
          flat={false}
          band="scoreboard"
          bandExtra={
            <StatRow
              items={[
                { key: 'past', label: tr('ws.courtDesk.record.cards.statPast'), value: n(rec.history.length) },
                { key: 'cancelled', label: tr('ws.courtDesk.record.cards.cancelledPart'), value: n(kept?.cancelled ?? counts.cancellations), tone: 'warn' },
                { key: 'noShows', label: tr('ws.courtDesk.record.cards.noShowsPart'), value: n(kept?.noShows ?? 0), tone: 'danger' },
              ]}
            />
          }
          onClose={close}
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            <BookingsPanel title={tr('ws.courtDesk.record.history')} empty={tr('ws.courtDesk.record.historyEmpty')} rows={rec.history} tz={tz} courtName={courtName} />
          </div>
        </SectionDialog>
      )}
      {rec && section === 'matches' && (
        <SectionDialog title={tr('ws.matches.customers.title')} subtitle={rec.customer.full_name} band="section" section="matches" onClose={close}>
          <MatchesPanel record={rec} tz={tz} onChanged={invalidate} />
        </SectionDialog>
      )}
      {rec && section === 'lessons' && lessons && (
        <SectionDialog title={tr('ws.coaching.customers.panelTitle')} subtitle={rec.customer.full_name} band="section" section="lessons" onClose={close}>
          <CustomerLessonsPanel
            customerName={rec.customer.full_name}
            data={lessons}
            tz={tz}
            refetch={async () => (await lessonsQ.refetch()).data}
            onBookLesson={canBook && coachCaps.runLessons && !params.attach ? () => void navigate({ to: '/desk', search: { customer: id, kind: 'lesson' } as never }) : undefined}
          />
        </SectionDialog>
      )}
      {rec && section === 'tickets' && (
        <SectionDialog title={tr('ws.matches.customers.tickets.title')} subtitle={rec.customer.full_name} band="section" section="tickets" onClose={close}>
          <TicketsPanel customerId={id} />
        </SectionDialog>
      )}
      {rec && section === 'loyalty' && (
        <SectionDialog title={tr('ws.loyalty.panel.title')} subtitle={rec.customer.full_name} band="loyalty" tier={tierColour(loyaltyQ.data?.tier?.name_en)} bandExtra={<CustomerLoyaltyTop customerId={id} />} onClose={close}>
          <CustomerLoyaltyPanel customerId={id} tz={tz} withTop={false} />
        </SectionDialog>
      )}
      {rec && section === 'cafe' && (
        <SectionDialog title={tr('ws.courtDesk.record.cafe')} subtitle={rec.customer.full_name} band="section" section="cafe" onClose={close}>
          <DataTable
            aria-label={tr('ws.courtDesk.record.cafe')}
            dense
            columns={cafeColumns}
            rows={rec.cafeOrders}
            rowKey={(o) => o.id}
          />
        </SectionDialog>
      )}
      {rec && section === 'series' && (
        <SectionDialog title={tr('ws.courtDesk.record.series')} subtitle={rec.customer.full_name} band="section" section="series" onClose={close}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {rec.series.map((s) => (
              <li key={s.id} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <Icon name="repeat" size={14} style={{ color: 'var(--tp-muted-fg)' }} />
                <bdi>{courtName(s.court_id)}</bdi>
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                  <bdi>
                    {formatDate(new Date(`${s.starts_on}T12:00:00Z`), locale, 'UTC')} – {formatDate(new Date(`${s.ends_on}T12:00:00Z`), locale, 'UTC')}
                  </bdi>
                  {s.occurrences !== undefined && <> · {tr('ws.courtDesk.record.occurrences', { count: formatNumber(s.occurrences, locale) })}</>}
                </span>
                <Link to="/desk/series/$id" params={{ id: s.id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)', textDecoration: 'none' }}>
                  {tr('ws.courtDesk.common.open')}
                </Link>
              </li>
            ))}
          </ul>
        </SectionDialog>
      )}

      {flagsOpen && rec && (
        <FlagsEditor
          customerId={id}
          flags={rec.flags}
          onClose={() => setFlagsOpen(false)}
          onSaved={() => {
            setFlagsOpen(false);
            toast.ok(tr('ws.kit.actions.save'));
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/**
 * One section of the record in a dialog. `flat` (one self-contained Panel
 * inside) lets that panel drop its own title and edge: the dialog's header
 * names it (InSectionDialog).
 *
 * `band` (owner, 2026-10-15): the dialog's header wears the look of the card
 * that opened it, the same moving ground (GlobalStyles .tp-record-card tones),
 * with the title, the customer and the close button on it; the body below
 * stays on the ordinary dialog ground.
 */
function SectionDialog({
  title,
  subtitle,
  flat = true,
  band,
  tier,
  section,
  bandExtra,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  flat?: boolean;
  band?: 'accent' | 'scoreboard' | 'loyalty' | 'section';
  tier?: string | null;
  /** With band="section": whose colour the header wears. */
  section?: 'matches' | 'lessons' | 'tickets' | 'cafe' | 'series';
  /** Shown in the band, under the title (the bookings dialog's count tiles). */
  bandExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { tr } = useLocale();
  const body = <InSectionDialog.Provider value={flat}>{children}</InSectionDialog.Provider>;
  if (!band) {
    return (
      <Modal title={title} subtitle={subtitle} size="lg" onClose={onClose}>
        {body}
      </Modal>
    );
  }
  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      bare={(close) => (
        // The scope carries the header's colour to the tiles in the dialog
        // (.tp-band-scope in GlobalStyles): their ground matches the header.
        <div className="tp-band-scope" data-band={band} data-tier={tier ?? undefined} data-section={section} style={{ display: 'flex', flexDirection: 'column', minBlockSize: 0, flex: 1 }}>
          <header
            className="tp-record-card"
            data-tone={band}
            data-tier={tier ?? undefined}
            data-section={section}
            style={{
              position: 'relative',
              overflow: 'hidden',
              flex: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--tp-sp-4)',
              paddingBlock: 'var(--tp-sp-5)',
              paddingInline: 'var(--tp-sp-5)',
              border: 'none',
              borderRadius: 0,
              boxShadow: 'none',
              minBlockSize: '7rem',
            }}
          >
            {band === 'accent' && <RacketMark />}
            <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--tp-sp-4)', position: 'relative' }}>
              <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, color: 'inherit' }}>{title}</h2>
                {subtitle && (
                  <span style={{ fontSize: 'var(--tp-fs-md)', opacity: 0.85 }}>
                    <bdi>{subtitle}</bdi>
                  </span>
                )}
              </span>
              <Button kind="ghost" size="sm" icon="x" className="tp-band-close" onClick={close} aria-label={tr('common.close')} style={{ color: 'inherit' }} />
            </span>
            {/* The band's ink is light; tiles set their own dark ink on their own ground. */}
            {bandExtra && <div style={{ position: 'relative', color: 'var(--tp-fg)' }}>{bandExtra}</div>}
          </header>
          <div style={{ overflowY: 'auto', minBlockSize: 0, paddingBlock: 'var(--tp-sp-4)', paddingInline: 'var(--tp-sp-4)' }}>{body}</div>
        </div>
      )}
    >
      {null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Open matches (operator.md §5.15): plays as, the ban, their matches.
// ---------------------------------------------------------------------------
function MatchesPanel({ record: rec, tz, onChanged }: { record: CustomerRecord; tz: string; onChanged: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const caps = useMatchCaps();
  const { reachable } = useStationReach();
  const { branchId, venues } = useVenue();
  const [genderOpen, setGenderOpen] = useState(false);
  const [banOpen, setBanOpen] = useState<'ban' | 'lift' | null>(null);
  const [banBusy, setBanBusy] = useState(false);
  const [banError, setBanError] = useState<unknown>(null);
  const customerId = rec.customer.id;
  const playsAs = playsAsOf(rec.customer);
  const banned = isMatchBanned(rec.flags);
  const offline = tr('ws.matches.offline.needsConnection');
  const { upcoming, recent } = recordMatches(rec.matches, Date.now());

  function changed() {
    invalidateMatchCustomer(queryClient, customerId);
    onChanged();
  }

  /** R35: `<code>` or `<code>: <note>` to ban (R42), null to lift. */
  async function setBan(ban: boolean, reason: string | null) {
    setBanBusy(true);
    setBanError(null);
    try {
      await appRpc('set_match_ban', { p_customer_id: customerId, p_banned: ban, p_reason: reason });
      setBanOpen(null);
      toast.ok(tr(ban ? 'ws.matches.customers.ban.banned' : 'ws.matches.customers.ban.lifted'));
      changed();
    } catch (e) {
      setBanError(e);
    } finally {
      setBanBusy(false);
    }
  }

  const branchName = (venueId: string | null) => {
    const v = venues.find((b) => b.id === venueId);
    return v ? pickName(locale, v) : tr('ws.matches.customers.matches.anotherBranch');
  };

  return (
    <Panel
      title={tr('ws.matches.customers.title')}
      data-testid="customer-matches"
      actions={
        caps.banFromMatches ? (
          banned ? (
            <Button
              size="sm"
              icon="ban"
              disabled={!reachable}
              disabledReason={offline}
              onClick={() => {
                setBanError(null);
                setBanOpen('lift');
              }}
            >
              {tr('ws.matches.customers.ban.lift')}
            </Button>
          ) : (
            <Button
              size="sm"
              kind="danger"
              icon="ban"
              disabled={!reachable}
              disabledReason={offline}
              onClick={() => {
                setBanError(null);
                setBanOpen('ban');
              }}
            >
              {tr('ws.matches.customers.ban.ban')}
            </Button>
          )
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.matches.customers.playsAs.label')}</span>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.customers.playsAs.lead')}</span>
          </div>
          <strong data-testid="plays-as">{playsAsLine(playsAs, tr)}</strong>
          <Button size="sm" kind="ghost" disabled={!reachable} disabledReason={offline} onClick={() => setGenderOpen(true)}>
            {tr('ws.matches.customers.playsAs.change')}
          </Button>
        </div>
        {upcoming.length > 0 && <MatchRows title={tr('ws.matches.customers.matches.upcoming')} rows={upcoming} tz={tz} branchId={branchId} branchName={branchName} />}
        {recent.length > 0 && <MatchRows title={tr('ws.matches.customers.matches.recent')} rows={recent} tz={tz} branchId={branchId} branchName={branchName} />}
      </div>

      {genderOpen && (
        <GenderDialog
          customerId={customerId}
          current={playsAs.gender}
          onClose={() => setGenderOpen(false)}
          onSaved={() => {
            setGenderOpen(false);
            toast.ok(tr('ws.matches.customers.gender.saved'));
            changed();
          }}
        />
      )}
      {banOpen === 'ban' && (
        <ReasonCodePrompt
          action={tr('ws.matches.customers.ban.ban')}
          reasonCodes={['conduct', 'no_shows', 'reported', 'other']}
          noteMode="optional"
          busy={banBusy}
          error={banError}
          onSubmit={(code, note) => void setBan(true, note ? `${code}: ${note}` : code)}
          onCancel={() => setBanOpen(null)}
        >
          <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.matches.customers.ban.body')}</p>
        </ReasonCodePrompt>
      )}
      <ConfirmDialog
        open={banOpen === 'lift'}
        title={tr('ws.matches.customers.ban.liftTitle')}
        body={
          <>
            <p>{tr('ws.matches.customers.ban.liftBody')}</p>
            <ErrorText error={banError} />
          </>
        }
        confirmLabel={tr('ws.matches.customers.ban.liftConfirm')}
        busy={banBusy}
        onConfirm={() => void setBan(false, null)}
        onCancel={() => setBanOpen(null)}
      />
    </Panel>
  );
}

/** One group of the record's matches: when, category, status, their seat; a row here opens the match screen. */
function MatchRows({
  title,
  rows,
  tz,
  branchId,
  branchName,
}: {
  title: string;
  rows: readonly CustomerMatchRow[];
  tz: string;
  branchId: string | null;
  branchName: (venueId: string | null) => string;
}) {
  const { tr, locale } = useLocale();
  const category = (c: string) => (c === 'open' || c === 'women' || c === 'men' ? tr(`ws.matches.common.category.${c}`) : c);
  const words = (key: MessageKey | null, raw: string | null) => (key ? tr(key) : (raw ?? '—'));
  const columns: Column<CustomerMatchRow>[] = [
    { key: 'date', header: tr('ws.courtDesk.common.date'), render: (r) => <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi> },
    {
      key: 'time',
      header: tr('ws.courtDesk.common.time'),
      numeric: true,
      align: 'start',
      render: (r) => <bdi>{r.end_at ? formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz) : formatDateTime(new Date(r.start_at), locale, tz)}</bdi>,
    },
    { key: 'category', header: tr('ws.courtDesk.record.cards.category'), render: (r) => category(r.category) },
    { key: 'status', header: tr('ws.courtDesk.common.status'), render: (r) => <StatusBadge size="sm" tone="neutral" label={words(matchStatusKey(r.status), r.status)} /> },
    {
      key: 'seat',
      header: tr('ws.courtDesk.record.cards.seat'),
      render: (r) => {
        const kind = seatKindKey(r.kind);
        return (
          <>
            {words(seatStatusKey(r.seat_status), r.seat_status)}
            {kind && <span style={{ color: 'var(--tp-muted-fg)' }}> · {tr(kind)}</span>}
          </>
        );
      },
    },
    {
      key: 'open',
      header: '',
      align: 'end',
      render: (r) =>
        isHereMatch(r, branchId) ? (
          <Link to="/desk/matches/$id" params={{ id: r.match_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)', textDecoration: 'none' }}>
            {tr('ws.matches.customers.matches.open')}
          </Link>
        ) : (
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('ws.matches.customers.matches.otherBranch', { branch: isolate(branchName(r.venue_id)) })}
          </span>
        ),
    },
  ];
  return (
    <section aria-label={title} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{title}</h3>
      <DataTable aria-label={title} dense columns={columns} rows={rows} rowKey={(r) => r.match_id} />
    </section>
  );
}

function BookingsPanel({ title, empty, rows, tz, courtName }: { title: string; empty: string; rows: readonly CustomerReservationRow[]; tz: string; courtName: (id: string) => string }) {
  const { tr, locale } = useLocale();
  // The RPC carries the court's names with each row; the courts query is only the fallback.
  const nameOf = (r: CustomerReservationRow) => (r.court_name_en && r.court_name_ar ? pickName(locale, { name_en: r.court_name_en, name_ar: r.court_name_ar }) : courtName(r.court_id));
  const navigate = useNavigate();
  const columns: Column<CustomerReservationRow>[] = [
    { key: 'date', header: tr('ws.courtDesk.common.date'), render: (r) => <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi> },
    { key: 'time', header: tr('ws.courtDesk.common.time'), numeric: true, align: 'start', render: (r) => <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi> },
    { key: 'court', header: tr('ws.courtDesk.common.court'), render: (r) => <bdi>{nameOf(r)}</bdi> },
    { key: 'status', header: tr('ws.courtDesk.common.status'), render: (r) => <BookingStatusIndicator status={r.status} size="sm" /> },
    { key: 'price', header: tr('ws.courtDesk.record.cards.price'), numeric: true, render: (r) => <Money amount={r.price_iqd} /> },
  ];
  return (
    <Panel title={title}>
      {/* The table keeps an edge of its own inside the panel's padding. */}
      <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', overflow: 'hidden' }}>
        <DataTable
          aria-label={title}
          dense
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => void navigate({ to: '/desk/bookings/$id', params: { id: r.id } })}
          emptyContent={empty}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// NoteList / NoteEntry (spec §07 Customers). Staff-visible only.
// ---------------------------------------------------------------------------
export function NoteList({ customerId, notes, tz, onChanged }: { customerId: string; notes: readonly CustomerNote[]; tz: string; onChanged: () => void }) {
  const { tr } = useLocale();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cap = useListCap(notes);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('add_customer_note', { p_customer_id: customerId, p_body: draft.trim() });
      setDraft('');
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={tr('ws.courtDesk.record.notes')} data-testid="customer-notes">
      {notes.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.75rem' }}>{tr('ws.courtDesk.record.noNotes')}</p>
      ) : (
        <div style={{ marginBlockEnd: '0.75rem' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
            {cap.shown.map((n) => (
              <NoteEntry key={n.id} note={n} tz={tz} onChanged={onChanged} />
            ))}
          </ul>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </div>
      )}
      <Field label={tr('ws.courtDesk.record.addNote')}>
        <AutoGrowTextarea value={draft} disabled={busy} maxLength={2000} placeholder={tr('ws.courtDesk.record.notePlaceholder')} onChange={setDraft} />
      </Field>
      <ErrorText error={error} />
      {/* Who sees these: under the note box, above Save (owner, 2026-10-15). */}
      <MessagePresenter tone="info" icon="lock" message={tr('ws.courtDesk.record.notesLead')} style={{ marginBlockEnd: '0.75rem' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button kind="primary" icon="note" busy={busy} disabled={!draft.trim()} disabledReason={tr('ws.courtDesk.record.noteEmpty')} onClick={() => void add()}>
          {tr('ws.courtDesk.record.saveNote')}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * A note box that is not resized by hand: it grows a line at a time as the note
 * does (owner, 2026-10-15), from two lines up to about twelve, then scrolls.
 */
function AutoGrowTextarea({
  value,
  onChange,
  disabled,
  maxLength,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    el.style.blockSize = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={2}
      style={{ ...inputStyle, resize: 'none', overflowY: 'auto', maxBlockSize: '18rem', minBlockSize: '3.25rem' }}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NoteEntry({ note, tz, onChanged }: { note: CustomerNote; tz: string; onChanged: () => void }) {
  const { tr, locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    if (!body.trim() || body.trim() === note.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await appRpc('edit_customer_note', { p_note_id: note.id, p_body: body.trim() });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const author = note.author_name ?? note.author_id ?? tr('ws.courtDesk.common.unknown');
  return (
    <li style={{ background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-ctl)', paddingBlock: '0.5rem', paddingInline: '0.65rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.25rem' }}>
        <strong style={{ color: 'var(--tp-fg)' }}>
          <bdi>{author}</bdi>
        </strong>
        <bdi>{formatDateTime(new Date(note.created_at), locale, tz)}</bdi>
        {note.edited_at && (
          <span title={formatDateTime(new Date(note.edited_at), locale, tz)}>
            · {tr('ws.courtDesk.record.edited')}
            {note.edited_by_name ? ` (${tr('ws.courtDesk.record.by', { name: note.edited_by_name })})` : ''}
          </span>
        )}
        {!editing && (
          <Button size="sm" kind="ghost" style={{ marginInlineStart: 'auto' }} onClick={() => setEditing(true)}>
            {tr('ws.courtDesk.record.editNote')}
          </Button>
        )}
      </div>
      {editing ? (
        <div>
          <AutoGrowTextarea value={body} disabled={busy} maxLength={2000} onChange={setBody} autoFocus />
          <ErrorText error={error} />
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginBlockStart: '0.35rem' }}>
            <Button size="sm" disabled={busy} onClick={() => { setEditing(false); setBody(note.body); }}>
              {tr('ws.courtDesk.record.cancelEdit')}
            </Button>
            <Button size="sm" kind="primary" busy={busy} onClick={() => void save()}>
              {tr('ws.courtDesk.common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note.body}</p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Flags editor: type + optional label per flag (set_customer_flags).
// ---------------------------------------------------------------------------
function FlagsEditor({ customerId, flags, onClose, onSaved }: { customerId: string; flags: readonly CustomerFlag[]; onClose: () => void; onSaved: () => void }) {
  const { tr } = useLocale();
  const [state, setState] = useState<Record<CustomerFlagType, { on: boolean; label: string }>>(() => {
    const init = {} as Record<CustomerFlagType, { on: boolean; label: string }>;
    for (const t of FLAG_TYPES) {
      const existing = flags.find((f) => f.type === t);
      init[t] = { on: Boolean(existing), label: existing?.label ?? '' };
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const p_flags = FLAG_TYPES.filter((t) => state[t].on).map((t) => ({ type: t, label: state[t].label.trim() || null }));
      await appRpc('set_customer_flags', { p_customer_id: customerId, p_flags });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.courtDesk.record.flagsTitle')}
      subtitle={tr('ws.courtDesk.record.flagsLead')}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()}>
            {tr('ws.courtDesk.record.saveFlags')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {FLAG_TYPES.map((t) => (
          <div key={t} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 0.75rem', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={state[t].on} disabled={busy} onChange={(e) => setState({ ...state, [t]: { ...state[t], on: e.target.checked } })} />
              <CustomerFlagBadge flag={{ type: t }} size="md" />
            </label>
            <input
              style={inputStyle}
              aria-label={`${tr(`ws.kit.flags.${t}`)} · ${tr('ws.courtDesk.record.flagLabel')}`}
              placeholder={tr('ws.courtDesk.record.flagLabel')}
              value={state[t].label}
              disabled={busy || !state[t].on}
              maxLength={80}
              onChange={(e) => setState({ ...state, [t]: { ...state[t], label: e.target.value } })}
            />
            {/* The one flag that changes what the guest can do, so it says what. */}
            {t === 'deposit_exempt' && (
              <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.record.depositExemptHint')}</p>
            )}
          </div>
        ))}
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
