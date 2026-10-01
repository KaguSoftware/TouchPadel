/**
 * The smallest rows the smoke renders need, and the query keys they go under.
 *
 * A smoke test is about LAYOUT, not about data, so every fixture here is the
 * minimum a screen reads to get past its loading and empty branches and draw
 * its real content. Seeding them into the QueryClient (rather than letting the
 * mocked Supabase client answer) keeps each case's data visible in the case
 * itself — and makes the difference between a screen's empty state and its
 * populated one a one-line change.
 *
 * The keys are IMPORTED from the feature modules that own them, never spelled
 * out here: apps/mobile/CLAUDE.md's rule is that a key family lives next to
 * its hook, and a literal copy in a test is exactly how the two drift.
 */
import type { Locale } from '@touch/i18n';
import type { DepositQuote, DepositStatus } from '../features/deposit/logic';
import type {
  MatchBlock,
  MatchDetail,
  MatchInvite,
  MatchQuote,
  MatchRestricted,
  MyMatchRow,
  OpenMatches,
  SlotMatch,
  TicketWallet,
} from '../features/matches/logic';

const TEST_USER_ID = '00000000-0000-4000-8000-00000000beef';
export const TEST_RESERVATION_ID = '11111111-1111-4111-8111-111111111111';
const TEST_COURT_ID = '22222222-2222-4222-8222-222222222222';
/** The one open branch every guest case books at (0122's default id). */
export const TEST_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';
/** A second branch, for the cases that need the picker to show. */
export const TEST_VENUE_2_ID = '44444444-4444-4444-8444-444444444444';

export interface ProfileFixture {
  id: string;
  full_name: string | null;
  phone: string | null;
  preferred_lang: Locale;
}

export const profileFixture = (over: Partial<ProfileFixture> = {}): ProfileFixture => ({
  id: TEST_USER_ID,
  full_name: 'Test Guest',
  phone: '+9647700000000',
  preferred_lang: 'en',
  ...over,
});

/**
 * One confirmed booking, far enough in the future that `booking/[id]` offers
 * its cancel action — the screen hides it for a booking that has started, and
 * a fixture pinned to a date would start failing on its own one day.
 */
export function bookingFixture(over: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  return {
    id: TEST_RESERVATION_ID,
    court_id: TEST_COURT_ID,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: 'confirmed',
    price_iqd: 30000,
    hold_expires_at: null,
    cancelled_by: null,
    cancelled_at: null,
    created_at: new Date().toISOString(),
    // app.my_reservations (0150). Unpaid by default, which is the state the
    // detail screen's smoke case asserts against.
    court_paid_iqd: 0,
    court_remaining_iqd: 30000,
    ...over,
  };
}

/**
 * The venue's public settings.
 *
 * `cancellation_window_hours` is what makes `booking/[id]` offer its cancel
 * action at all — the screen hides it until the policy is KNOWN, so a screen
 * rendered without this one row has no primary action to assert on.
 * Seven days a week, open long enough that the availability grid has rows
 * whatever time the suite runs.
 */
export function venueSettingsFixture(over: Record<string, unknown> = {}) {
  // A LIST of [open, close] windows per day (`OpeningHours` in @touch/core),
  // not an {open, close} object: a day can trade in two sittings, and the
  // overnight-tail check reads the last window of the previous day.
  const day = [['08:00', '23:00']] as const;
  return {
    venue_name: 'Touch Padel',
    timezone: 'Asia/Baghdad',
    opening_hours: { sun: day, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day },
    closed_dates: [],
    cancellation_window_hours: 2,
    protected_horizon_hours: 0,
    phone: '009647700000000',
    venue_id: TEST_VENUE_ID,
    venue_name_en: 'Touch Padel',
    venue_name_ar: 'تاتش بادل',
    // Open matches off by default (0257), so the Book tab renders exactly as
    // before; a case that wants chips turns it on.
    matches_enabled: false,
    match_fill_deadline_minutes: 120,
    // Coaching off by default (0274): the Book tab, Bookings and Profile render
    // exactly as before; a case that wants lessons turns it on.
    coaching_enabled: false,
    lesson_payment_mode: 'desk',
    lesson_prices_public: false,
    ...over,
  };
}

/**
 * One open branch as the branch list holds it (`availabilityKeys.branches`,
 * branch.ts `Branch`). One of these alone means no picker, as on a
 * one-branch install.
 */
export function branchFixture(over: Record<string, unknown> = {}) {
  return {
    venue_id: TEST_VENUE_ID,
    venue_slug: 'touch-padel',
    venue_name: 'Touch Padel',
    venue_name_en: 'Touch Padel',
    venue_name_ar: 'تاتش بادل',
    address_en: null,
    address_ar: null,
    map_url: null,
    phone: '009647700000000',
    timezone: 'Asia/Baghdad',
    // Coaching off by default (0274), so every existing case renders as before.
    coaching_enabled: false,
    ...over,
  };
}

export function courtFixture(over: Record<string, unknown> = {}) {
  return {
    id: TEST_COURT_ID,
    venue_id: TEST_VENUE_ID,
    name_en: 'Court One',
    name_ar: 'الملعب الأول',
    description_en: null,
    description_ar: null,
    indoor: true,
    photo_path: null,
    duration_options: [60, 90],
    sort_order: 1,
    ...over,
  };
}

/**
 * One online-deposit attempt as the payment screen's query holds it (the
 * PARSED `deposit_status`, features/deposit/logic.ts): pending, its window ten
 * minutes from now, on a hold still live, with the bank's page to reopen.
 */
export function depositStatusFixture(
  over: { ref?: string; reservationId?: string } & Partial<DepositStatus> = {},
): DepositStatus {
  const { ref = '55555555-5555-4555-8555-555555555555', reservationId = TEST_RESERVATION_ID, ...rest } = over;
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  return {
    ref,
    status: 'pending',
    failureCode: null,
    amountIqd: 15000,
    priceIqd: 30000,
    restIqd: 15000,
    deadlineAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    formUrl: 'https://payments.example.test/pay?ref=' + ref,
    refundReason: null,
    refundAmountIqd: null,
    refundedAt: null,
    sandbox: false,
    depositMode: 'optional',
    attemptsLeft: 2,
    holdLive: true,
    reservation: {
      id: reservationId,
      kind: 'hold',
      status: 'pending',
      courtId: TEST_COURT_ID,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      venueId: TEST_VENUE_ID,
    },
    serverNow: new Date().toISOString(),
    ...rest,
  };
}

/** app.deposit_quote, parsed, for Review: `off` unless a case asks for a mode. */
export function depositQuoteFixture(over: Partial<DepositQuote> = {}): DepositQuote {
  const mode = over.mode ?? 'off';
  const deposit = mode === 'off' ? 0 : 15000;
  return {
    mode,
    depositIqd: deposit,
    priceIqd: 30000,
    restIqd: 30000 - deposit,
    windowSeconds: 900,
    active: null,
    ...over,
  };
}

// ── Open matches (docs/design/open-matches/guest.md §4.27) ──────────────────
//
// PARSED shapes (features/matches/logic.ts), the way the queries hold them,
// seeded under `matchKeys` (features/matches/keys.ts). Times are relative to
// now, so a fixture never starts failing on its own one day.

export const TEST_MATCH_ID = '66666666-6666-4666-8666-666666666666';
/** A share token: 22 url-safe characters (0258). */
export const TEST_MATCH_TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const TEST_SEAT_IDS = [
  '77777777-7777-4777-8777-000000000001',
  '77777777-7777-4777-8777-000000000002',
  '77777777-7777-4777-8777-000000000003',
] as const;

/** Two days out at 20:00 Baghdad (17:00 UTC), 90 minutes: filling, well before its deadline. */
function matchTimes(): { startAt: string; endAt: string; deadline: string } {
  const day = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17, 0, 0));
  return {
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    deadline: new Date(start.getTime() - 120 * 60 * 1000).toISOString(),
  };
}

const NO_SEAT_CAN = { remove: false, report: false, block: false };

function seatFixture(
  seatId: string,
  seatNo: number,
  kind: 'account' | 'friend',
  name: string,
  holderSeatNo: number | null,
): MatchDetail['seats'][number] {
  return {
    seatId,
    seatNo,
    kind,
    status: 'in',
    name,
    former: false,
    holderSeatNo,
    isMe: false,
    isMine: false,
    shareIqd: 10000,
    open: false,
    can: { ...NO_SEAT_CAN },
  };
}

/**
 * One match as a VIEWER sees it: an instant (open-join) match at 3/4, open to
 * all, two tickets in the wallet, so the action card offers Join.
 */
export function matchDetailFixture(over: Partial<MatchDetail> = {}): MatchDetail {
  const { startAt, endAt, deadline } = matchTimes();
  return {
    restricted: false,
    id: TEST_MATCH_ID,
    venueId: TEST_VENUE_ID,
    status: 'filling',
    endedReason: null,
    startAt,
    endAt,
    durationMin: 90,
    category: 'open',
    visibility: 'public',
    joinPolicy: 'open',
    priceIqd: 40000,
    sharesIqd: [10000, 10000, 10000, 10000],
    fillDeadlineAt: deadline,
    seatsTaken: 3,
    seatsLeft: 1,
    seatsTotal: 4,
    courtId: null,
    organiser: { name: 'Ahmed K.', former: false, isMe: false },
    seats: [
      seatFixture(TEST_SEAT_IDS[0], 1, 'account', 'Ahmed K.', null),
      seatFixture(TEST_SEAT_IDS[1], 2, 'friend', 'Ahmed K.', 1),
      seatFixture(TEST_SEAT_IDS[2], 3, 'account', 'Sara M.', null),
    ],
    me: {
      role: 'viewer',
      seats: [],
      request: null,
      excluded: false,
      refusal: null,
      ticketsAvailable: 2,
      ticketsNeeded: 0,
      leaveOutcome: 'none',
      can: {
        join: true,
        request: false,
        withdraw: false,
        leave: false,
        cancel: false,
        remove: false,
        decide: false,
        message: false,
        report: false,
        block: false,
        share: false,
      },
    },
    requests: [],
    messages: [],
    shareToken: null,
    serverNow: new Date().toISOString(),
    ...over,
  };
}

/** A link viewer who may not join (R32): no ids, no names, the refusal only. */
export function matchRestrictedFixture(over: Partial<MatchRestricted> = {}): MatchRestricted {
  const { startAt, endAt } = matchTimes();
  return {
    restricted: true,
    status: 'filling',
    startAt,
    endAt,
    durationMin: 90,
    category: 'women',
    joinPolicy: 'open',
    seatsLeft: 2,
    venue: { nameEn: 'Touch Padel', nameAr: 'تاتش بادل' },
    timezone: 'Asia/Baghdad',
    refusal: 'MATCH_GENDER_MISMATCH',
    serverNow: new Date().toISOString(),
    ...over,
  };
}

/** The Open matches list: one match with a seat, not the guest's. */
export function openMatchesFixture(over: Partial<OpenMatches> = {}): OpenMatches {
  const { startAt, endAt, deadline } = matchTimes();
  return {
    banned: false,
    matches: [
      {
        matchId: TEST_MATCH_ID,
        startAt,
        endAt,
        durationMin: 90,
        category: 'open',
        joinPolicy: 'open',
        status: 'filling',
        seatsTaken: 3,
        seatsLeft: 1,
        refill: false,
        fillDeadlineAt: deadline,
        shareIqd: 10000,
        mine: null,
      },
    ],
    ...over,
  };
}

/**
 * The Book tab's chips, as `match_slots` answers them (parsed). The query's
 * `select` builds the Map (`slotMatchesByStart`), so a case seeds this list
 * under `matchKeys.slots(…)`.
 */
export function matchSlotsFixture(over: Partial<SlotMatch> = {}): SlotMatch[] {
  const { startAt, endAt } = matchTimes();
  return [
    {
      startAt,
      endAt,
      durationMin: 90,
      category: 'open',
      joinPolicy: 'open',
      seatsLeft: 1,
      mine: false,
      ...over,
    },
  ];
}

/** A start the server would take: no refusal, open or women (a woman's quote), one ticket. */
export function matchQuoteFixture(over: Partial<MatchQuote> = {}): MatchQuote {
  const { startAt, deadline } = matchTimes();
  return {
    enabled: true,
    priceIqd: 40000,
    sharesIqd: [10000, 10000, 10000, 10000],
    durationMin: 90,
    fillDeadlineAt: deadline,
    earliestStartAt: new Date(Date.parse(startAt) - 24 * 60 * 60 * 1000).toISOString(),
    categories: ['open', 'women'],
    myGender: 'female',
    ticketsAvailable: 1,
    ticketPriceIqd: 10000,
    seatsMax: 3,
    fillingAtTime: 0,
    courtsFree: 2,
    refusal: null,
    ...over,
  };
}

type OpenInvite = Extract<MatchInvite, { status: 'open' | 'full' }>;

/** The invite a signed-out guest opens (`match_invite`, DF-9): open, two seats, no names. */
export function matchInviteFixture(over: Partial<OpenInvite> = {}): MatchInvite {
  const { startAt, endAt } = matchTimes();
  return {
    status: 'open',
    startAt,
    endAt,
    timezone: 'Asia/Baghdad',
    category: 'open',
    joinPolicy: 'approve',
    seatsLeft: 2,
    venue: { nameEn: 'Touch Padel', nameAr: 'تاتش بادل' },
    ...over,
  };
}

/**
 * The ticket wallet. Empty by default (what the existing suites seed under
 * `matchKeys.tickets`, so `bookings` and `profile` still render);
 * `myTicketsFixture({ available: 2 })` for a wallet with tickets ready.
 */
export function myTicketsFixture(over: Partial<TicketWallet> = {}): TicketWallet {
  return {
    priceIqd: 10000,
    maxAvailable: 9,
    available: 0,
    reserved: 0,
    inUse: 0,
    sandbox: false,
    tickets: [],
    purchases: [],
    pending: null,
    serverNow: new Date().toISOString(),
    ...over,
  };
}

/** The blocked players (`my_match_blocks`): none by default, the empty state. */
export function myBlocksFixture(rows: MatchBlock[] = []): MatchBlock[] {
  return rows;
}

/**
 * The guest's matches (`my_matches`): none by default (what the existing
 * suites seed under `matchKeys.mine(…)`); pass rows for a populated list.
 */
export function myMatchesFixture(rows: MyMatchRow[] = []): MyMatchRow[] {
  return rows;
}

/** One `my_matches` row: a filling match the guest is in (row 6, "You're in"). */
export function myMatchRowFixture(over: Partial<MyMatchRow> = {}): MyMatchRow {
  const { startAt, endAt, deadline } = matchTimes();
  return {
    matchId: TEST_MATCH_ID,
    venueId: TEST_VENUE_ID,
    status: 'filling',
    endedReason: null,
    startAt,
    endAt,
    durationMin: 90,
    category: 'open',
    joinPolicy: 'open',
    visibility: 'public',
    seatsTaken: 3,
    courtId: null,
    fillDeadlineAt: deadline,
    isOrganiser: false,
    myRole: 'player',
    mySeats: [
      {
        seatId: TEST_SEAT_IDS[2],
        seatNo: 3,
        kind: 'account',
        status: 'in',
        endReason: null,
        shareIqd: 10000,
        requestId: null,
        ticketStatus: 'in_use',
      },
    ],
    request: null,
    myTickets: { locked: 1, released: 0, forfeited: 0 },
    ...over,
  };
}
