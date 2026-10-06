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
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTimeRange, isolate, VENUE_TZ, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../../lib/queries';
import { useToast } from '../../../components/toast';
import { useLocale, pickName } from '../../../lib/i18n';
import { canAccess, useAuth } from '../../../lib/auth';
import { useStationReach } from '../../../lib/stationReach';
import { useVenue } from '../../../lib/venue';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import {
  AsyncStateWrapper,
  BookingStatusIndicator,
  CustomerFlagBadge,
  DescriptionList,
  EmptyState,
  MessagePresenter,
  Money,
  PageHeader,
  Panel,
  ReasonCodePrompt,
  StatusBadge,
  TabStatusIndicator,
  type CustomerFlagType,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { matchStatusKey } from '../../matches/matchLogic';
import { invalidateMatchCustomer, useMatchCaps } from '../../matches/useMatches';
import type { CustomerFlag, CustomerMatchRow, CustomerNote, CustomerRecord, CustomerReservationRow } from '../deskTypes';
import type { CustomerSearchParams } from './CustomerSearch';
import { GenderDialog } from './GenderDialog';
import { TicketsPanel } from './TicketsPanel';
import { CustomerLoyaltyPanel } from '../../loyalty/CustomerLoyaltyPanel';
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

  return (
    <div>
      <PageHeader
        eyebrow={tr('ws.courtDesk.record.eyebrow')}
        title={rec?.customer.full_name ?? tr('ws.courtDesk.customers.title')}
        subtitle={
          rec ? (
            <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {lessons?.coach && <CoachBadge status={lessons.coach.status} />}
              {rec.flags.map((f, i) => (
                <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} size="md" />
              ))}
              <Button size="sm" kind="ghost" icon="tag" onClick={() => setFlagsOpen(true)}>
                {flagCount === 0 ? tr('ws.courtDesk.record.addFlags') : tr('ws.courtDesk.record.editFlags')}
              </Button>
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button kind="ghost" icon="chevronStart" onClick={() => void navigate({ to: '/desk/customers' })}>
              {tr('ws.courtDesk.record.backToSearch')}
            </Button>
            {params.attach && (
              <Button kind="primary" icon="userPlus" onClick={attach}>
                {attachLabel}
              </Button>
            )}
            {lessons && coachCaps.manageCoaches && !params.attach && (
              <Button
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
            {lessons && canBook && coachCaps.runLessons && !params.attach && (
              <Button icon="whistle" onClick={() => void navigate({ to: '/desk', search: { customer: id, kind: 'lesson' } as never })}>
                {tr('ws.coaching.customers.bookLesson')}
              </Button>
            )}
            {canBook && matchesKnown && caps.runMatches && !params.attach && (
              <Button icon="users" onClick={() => void navigate({ to: '/desk', search: { customer: id, kind: 'match' } as never })}>
                {tr('ws.matches.customers.startMatch')}
              </Button>
            )}
            {canBook && (
              <Button kind={params.attach ? 'default' : 'primary'} icon="calendar" onClick={() => void navigate({ to: '/desk', search: { customer: id } as never })}>
                {tr('ws.courtDesk.record.newBooking')}
              </Button>
            )}
          </>
        }
      />
      <AsyncStateWrapper status={status} error={recordQ.error} onRetry={() => void recordQ.refetch()} emptyContent={<EmptyState icon="users" title={tr('ws.courtDesk.record.notFound')} />}>
        {rec && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(20rem, 2fr)', gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <Panel>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: tr('ws.courtDesk.record.phone'), value: rec.customer.phone ? <bdi dir="ltr">{rec.customer.phone}</bdi> : '—' },
                    { label: tr('ws.courtDesk.record.email'), value: rec.customer.email ? <bdi dir="ltr">{rec.customer.email}</bdi> : '—' },
                    { label: tr('ws.courtDesk.record.language'), value: rec.customer.preferred_lang === 'ar' ? tr('ws.courtDesk.customers.lang.ar') : rec.customer.preferred_lang === 'en' ? tr('ws.courtDesk.customers.lang.en') : '—' },
                    { label: tr('ws.courtDesk.record.bookings'), value: formatNumber(counts.bookings, locale), numeric: true },
                    { label: tr('ws.courtDesk.record.cancellations'), value: formatNumber(counts.cancellations, locale), numeric: true },
                    {
                      label: tr('ws.courtDesk.record.noShows'),
                      // DF-12, DF-15: the count includes open-match seat no-shows, and says how many.
                      value: counts.matchNoShows
                        ? tr('ws.matches.customers.noShowsWithMatches', { count: formatNumber(counts.noShows, locale), matches: formatNumber(counts.matchNoShows, locale) })
                        : formatNumber(counts.noShows, locale),
                      numeric: true,
                    },
                    { label: tr('ws.courtDesk.record.cafeOrders'), value: formatNumber(counts.cafeOrders ?? rec.cafeOrders.length, locale), numeric: true },
                    ...(counts.matchesPlayed !== undefined
                      ? [{ label: tr('ws.matches.customers.matchesPlayed'), value: formatNumber(counts.matchesPlayed, locale), numeric: true }]
                      : []),
                    ...(counts.lateLeaves !== undefined ? [{ label: tr('ws.matches.customers.lateLeaves'), value: formatNumber(counts.lateLeaves, locale), numeric: true }] : []),
                    ...(rec.customer.created_at ? [{ label: tr('ws.courtDesk.record.since'), value: <bdi>{formatDate(new Date(rec.customer.created_at), locale, tz)}</bdi> }] : []),
                  ]}
                />
              </Panel>
              {matchesKnown && caps.runMatches && <MatchesPanel record={rec} tz={tz} onChanged={invalidate} />}
              {lessons && (
                <CustomerLessonsPanel
                  customerName={rec.customer.full_name}
                  data={lessons}
                  tz={tz}
                  refetch={async () => (await lessonsQ.refetch()).data}
                />
              )}
              <TicketsPanel customerId={id} />
              {/* Loyalty (build-contracts-2026-10-05 §5): balance, tier, history, Adjust points. */}
              <CustomerLoyaltyPanel customerId={id} tz={tz} />
              <CustomerHoldStanding customerId={id} />
              <BookingsPanel title={tr('ws.courtDesk.record.upcoming')} empty={tr('ws.courtDesk.record.upcomingEmpty')} rows={rec.upcoming} tz={tz} courtName={courtName} />
              {/* Sections with nothing in them are left out rather than drawn
                  as a titled box saying "none": the counts above already say
                  zero. Series in particular: customer_record does not fill it
                  yet (0065), so "No recurring series" was stated about
                  customers who have one. */}
              {rec.history.length > 0 && <BookingsPanel title={tr('ws.courtDesk.record.history')} empty={tr('ws.courtDesk.record.historyEmpty')} rows={rec.history} tz={tz} courtName={courtName} />}
              {rec.cafeOrders.length > 0 && (
              <Panel title={tr('ws.courtDesk.record.cafe')} padded={false}>
                {(
                  <table className="tp-table" data-dense="true">
                    <thead>
                      <tr>
                        <th>{tr('ws.courtDesk.record.orderDate')}</th>
                        <th>{tr('ws.courtDesk.common.status')}</th>
                        <th data-align="end">{tr('ws.courtDesk.record.orderTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.cafeOrders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <bdi>{formatDateTime(new Date(o.opened_at), locale, tz)}</bdi>
                          </td>
                          <td>
                            <TabStatusIndicator status={o.status} size="sm" />
                          </td>
                          <td data-align="end">
                            <Money amount={o.total_iqd} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
              )}
              {rec.series.length > 0 && (
              <Panel title={tr('ws.courtDesk.record.series')}>
                {(
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.35rem' }}>
                    {rec.series.map((s) => (
                      <li key={s.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
                )}
              </Panel>
              )}
            </div>
            <NoteList customerId={id} notes={rec.notes} tz={tz} onChanged={invalidate} />
          </div>
        )}
      </AsyncStateWrapper>

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
  return (
    <section aria-label={title} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{title}</h3>
      <table className="tp-table" data-dense="true">
        <tbody>
          {rows.map((r) => {
            const kind = seatKindKey(r.kind);
            return (
              <tr key={r.match_id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <bdi>{r.end_at ? formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz) : formatDateTime(new Date(r.start_at), locale, tz)}</bdi>
                </td>
                <td>{category(r.category)}</td>
                <td>
                  <StatusBadge size="sm" tone="neutral" label={words(matchStatusKey(r.status), r.status)} />
                </td>
                <td>
                  {words(seatStatusKey(r.seat_status), r.seat_status)}
                  {kind && <span style={{ color: 'var(--tp-muted-fg)' }}> · {tr(kind)}</span>}
                </td>
                <td data-align="end">
                  {isHereMatch(r, branchId) ? (
                    <Link to="/desk/matches/$id" params={{ id: r.match_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)', textDecoration: 'none' }}>
                      {tr('ws.matches.customers.matches.open')}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                      {tr('ws.matches.customers.matches.otherBranch', { branch: isolate(branchName(r.venue_id)) })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function BookingsPanel({ title, empty, rows, tz, courtName }: { title: string; empty: string; rows: readonly CustomerReservationRow[]; tz: string; courtName: (id: string) => string }) {
  const { locale } = useLocale();
  // The RPC carries the court's names with each row; the courts query is only the fallback.
  const nameOf = (r: CustomerReservationRow) => (r.court_name_en && r.court_name_ar ? pickName(locale, { name_en: r.court_name_en, name_ar: r.court_name_ar }) : courtName(r.court_id));
  const navigate = useNavigate();
  return (
    <Panel title={title} padded={rows.length === 0}>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{empty}</p>
      ) : (
        <table className="tp-table" data-dense="true" aria-label={title}>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-clickable="true"
                tabIndex={0}
                onClick={() => void navigate({ to: '/desk/bookings/$id', params: { id: r.id } })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void navigate({ to: '/desk/bookings/$id', params: { id: r.id } });
                }}
              >
                <td style={{ whiteSpace: 'nowrap' }}>
                  <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
                </td>
                <td>
                  <bdi>{nameOf(r)}</bdi>
                </td>
                <td>
                  <BookingStatusIndicator status={r.status} size="sm" />
                </td>
                <td data-align="end">
                  <Money amount={r.price_iqd} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
      <MessagePresenter tone="info" icon="lock" message={tr('ws.courtDesk.record.notesLead')} style={{ marginBlockEnd: '0.75rem' }} />
      {notes.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.75rem' }}>{tr('ws.courtDesk.record.noNotes')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem', marginBlockEnd: '0.75rem' }}>
          {notes.map((n) => (
            <NoteEntry key={n.id} note={n} tz={tz} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <Field label={tr('ws.courtDesk.record.addNote')}>
        <textarea style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical' }} value={draft} disabled={busy} maxLength={2000} placeholder={tr('ws.courtDesk.record.notePlaceholder')} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button kind="primary" icon="note" busy={busy} disabled={!draft.trim()} disabledReason={tr('ws.courtDesk.record.noteEmpty')} onClick={() => void add()}>
          {tr('ws.courtDesk.record.saveNote')}
        </Button>
      </div>
    </Panel>
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
          <textarea style={{ ...inputStyle, minBlockSize: '4rem', resize: 'vertical' }} value={body} disabled={busy} maxLength={2000} onChange={(e) => setBody(e.target.value)} autoFocus />
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
