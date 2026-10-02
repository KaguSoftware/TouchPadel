/**
 * SEC-20 — the stored-field allowlist.
 *
 * Both stores make you declare, field by field, what the app collects about a
 * user. That declaration is normally written once from memory into a web form
 * and then quietly goes stale: a column lands in a migration, nobody reopens the
 * form, and the listing is wrong until somebody notices. A paragraph drifts. A
 * test goes red.
 *
 * So this file, not a document, is the source for both forms. GUEST_DATA below
 * is the declaration; the last test prints it in the shape Google Play's Data
 * safety form and Apple's App Privacy questions ask for.
 *
 * Four things are enforced for GUEST_DATA:
 *
 *   1. DISCOVERY — the guest-linked tables are found in the live catalog, not
 *      listed here by hand. A new table carrying guest_id / profile_id /
 *      customer_id / linked_profile_id / auth_user_id fails until declared.
 *   2. EXACTNESS — each declared table's column set must equal the live one.
 *      An added column fails; so does a removed one.
 *   3. COMPLETENESS — a column declared personal must carry a purpose and an
 *      erasure route.
 *   4. DELETION — every column declared personal is PROVED emptied by
 *      app.delete_my_account (0077, 0264), by populating it and deleting for real.
 *      Declaring a field and forgetting to erase it is precisely the gap the
 *      store deletion requirement exists to close.
 *
 * UNLINKED_PERSONAL (wave5-addendum-2026-09-25 §2.12) declares the tables of
 * personal data staff type about other people that carry NO guest link on
 * purpose, so discovery cannot find them and app.delete_my_account cannot
 * follow them: they are erased by retention instead ('purge'). For those the
 * test proves there is no link column, the declared columns equal the live
 * ones, and the purge empties every 'purge' column.
 *
 * The catalog comes from PostgREST's own OpenAPI document, which is the same
 * view of the schema the clients get.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();

/** Store data-safety categories. `null` = nothing personal in this column. */
type Category =
  | 'Name'
  | 'Phone number'
  | 'Purchase history'
  | 'App activity'
  | 'Device or other IDs'
  | 'User content'
  | 'Photos'
  // 0256 (open matches): gender, the stores' "other personal info" (G5f).
  | 'Other personal info'
  // Coaching (R49): a coach's monthly pay, the stores' "financial info".
  | 'Financial info'
  | null;

interface Field {
  category: Category;
  /** Why it is stored — the form's free-text purpose box. */
  why?: string;
  /**
   * How 0077 erases it.
   *   'scrub'      the row survives, the column is set to null
   *   'anonymise'  the row survives and the column is NOT NULL, so it is
   *                overwritten with a placeholder that names nobody
   *   'row'        the whole row is deleted
   *   'auth'       it goes when the auth user is destroyed
   *   'keep'       deliberately RETAINED, with the reason in `why`
   *   'purge'      UNLINKED_PERSONAL only: no account reaches it, so it goes
   *                by retention (a marker, NULL or an emptied list)
   *   'empty'      the row survives and the column is a NOT NULL text or
   *                array, so it is set to '' or '{}' (coaching R22, R49: a
   *                coach's bio, a guest's friend names, a coach's time-off
   *                reason; the deletion re-issue of delete_my_account in the
   *                coaching build proves it)
   */
  onDelete?: 'scrub' | 'anonymise' | 'row' | 'auth' | 'keep' | 'purge' | 'empty';
}

/** Nothing personal: an id, a timestamp, a status, a foreign key. */
const n: Field = { category: null };

/** What 0077 writes over a NOT NULL identifying column. */
const TOMBSTONE_NAME = 'Deleted account';

/**
 * The guest link that puts a table on this surface. 0258 (open matches, R29)
 * adds the six ways a match row names a player other than guest_id: the
 * organiser, a block's two sides, a report's two sides and an event's actor.
 */
const LINK_COLUMNS = [
  'guest_id', 'profile_id', 'customer_id', 'linked_profile_id', 'auth_user_id',
  'organiser_id', 'blocker_id', 'blocked_id', 'reporter_id', 'reported_id', 'actor_guest_id',
  // Coaching (docs/design/coaching/db.md §4.3.16): the ways a lesson row names
  // the guest (or coach) who made it, beside coaches.profile_id and the
  // enrolment's and strike's guest_id.
  'created_by_profile_id', 'booked_by_profile_id', 'marked_by_profile_id', 'actor_profile_id',
];

/**
 * THE DECLARATION — every column of every table carrying a guest link.
 */
const GUEST_DATA: Record<string, Record<string, Field>> = {
  profiles: {
    id: n,
    // profiles.full_name is NOT NULL, so deletion overwrites rather than empties.
    full_name: {
      category: 'Name',
      why: 'shown to the guest and the desk; other players see only the first name and an initial',
      onDelete: 'anonymise',
    },
    // 0256 (open matches): the two name parts and gender. The 0077 tombstone
    // UPDATE empties all five (profiles_sync_names), proved below.
    given_name: {
      category: 'Name',
      why: 'shown to the guest and the desk; other open-match players see it',
      onDelete: 'scrub',
    },
    family_name: {
      category: 'Name',
      why: 'other open-match players see only its first letter',
      onDelete: 'scrub',
    },
    gender: {
      category: 'Other personal info',
      why: 'offering women-only and men-only open matches',
      onDelete: 'scrub',
    },
    gender_set_at: n,
    gender_set_by: n,
    phone: { category: 'Phone number', why: 'booking confirmation, and the desk calling about a court', onDelete: 'scrub' },
    preferred_lang: n,
    expo_push_token: { category: 'Device or other IDs', why: 'booking reminders and order-ready pushes', onDelete: 'scrub' },
    created_at: n,
    deleted_at: n,
    // 0153: which Terms/Privacy version was accepted, and when. Identifies
    // nobody; kept on the tombstone as proof the terms applied.
    terms_version: n,
    terms_accepted_at: n,
    // 0241: set by hand on the store review account only (its deposits go to
    // Qi's sandbox). A switch, identifies nobody.
    payment_sandbox: n,
  },
  reservations: {
    id: n, court_id: n, kind: n, status: n, start_at: n, end_at: n, period: n, guest_id: n,
    guest_name: { category: 'Name', why: 'bookings taken at the desk, including for an account holder', onDelete: 'scrub' },
    guest_phone: { category: 'Phone number', why: 'the desk calling about this specific booking', onDelete: 'scrub' },
    created_by_staff_id: n, source: n, rate_rule_id: n,
    price_iqd: { category: 'Purchase history', why: 'what the court sold for — the venue reports on it', onDelete: 'keep' },
    // cancelled_by (0088) names a ROLE — 'guest' or 'staff' — never a person:
    // it says whether the account holder or the desk ended the booking, which
    // is what the app has to tell the guest, and identifies nobody.
    hold_expires_at: n, cancelled_at: n, cancelled_by: n, cancellation_reason: n,
    notes: { category: 'User content', why: 'free text taken at the desk about this booking', onDelete: 'scrub' },
    device_id: { category: 'Device or other IDs', why: 'which till or phone made the booking; replay protection', onDelete: 'scrub' },
    idempotency_key: n, client_ref: n, created_at: n, series_id: n,
    venue_id: n,
    // event_court_blocks: an event block's purpose and the tournament run
    // that asked for it. Only on maintenance rows; identify nobody.
    block_purpose: n, protocol_run_id: n,
    // Coaching: the lesson a court row is for (guest_id NULL on such a row).
    lesson_id: n,
  },
  reservation_series: {
    id: n, court_id: n, pattern: n, weekdays: n, start_time: n, duration_min: n,
    starts_on: n, ends_on: n, guest_id: n,
    guest_name: { category: 'Name', why: 'a standing booking is held in somebody’s name', onDelete: 'scrub' },
    guest_phone: { category: 'Phone number', why: 'the desk calls the holder when a week is cancelled', onDelete: 'scrub' },
    notes: { category: 'User content', why: 'free text about the standing booking', onDelete: 'scrub' },
    created_by_staff_id: n, idempotency_key: n, created_at: n, cancelled_at: n, cancelled_reason: n,
    venue_id: n,
  },
  guest_sessions: {
    id: n, table_id: n,
    auth_user_id: { category: 'App activity', why: 'which account scanned which table, so the tab is theirs', onDelete: 'auth' },
    linked_profile_id: n, created_at: n, last_activity_at: n, expires_at: n, closed_at: n,
    venue_id: n,
  },
  customer_notes: {
    id: n, customer_id: n,
    body: { category: 'User content', why: 'what the desk wrote about this customer', onDelete: 'row' },
    author_id: n, created_at: n, edited_at: n, edited_by: n,
  },
  // 0241: an online deposit on a booking (Qi Card). No card data is ever
  // stored: the card is typed on Qi's page. The money trail outlives the
  // account, as reservations.price_iqd does; guest_id goes null on a hard
  // delete (the FK), and 0077's tombstone keeps it pointing at nobody.
  // 0258: also a purchase of open-match tickets (purpose 'ticket', a chain
  // row with no booking); ticket_count is a count (C19).
  booking_payments: {
    id: n, venue_id: n, reservation_id: n, hold_id: n, guest_id: n, purpose: n, provider: n, sandbox: n,
    request_id: n, provider_payment_id: n, locale: n, status: n, provider_status: n, form_url: n,
    deadline_at: n, last_checked_at: n, succeeded_at: n, failed_at: n, expired_at: n, forfeited_at: n,
    failure_code: n, refund_reason: n, refund_request_id: n, refund_provider_id: n,
    refund_requested_at: n, refunded_at: n, refund_attempts: n, cancel_attempts: n, claimed_at: n,
    created_at: n, updated_at: n, ticket_count: n,
    // Coaching: the lesson enrolment a purpose 'lesson' payment is for.
    lesson_enrolment_id: n,
    amount_iqd: { category: 'Purchase history', why: 'a deposit, open-match tickets or a lesson paid online; the venue reconciles it with Qi Card', onDelete: 'keep' },
    quoted_price_iqd: { category: 'Purchase history', why: 'the court price a deposit was taken against, the price of one open-match ticket, or a lesson’s price', onDelete: 'keep' },
    refund_amount_iqd: { category: 'Purchase history', why: 'what went back to the card for a deposit, open-match tickets or a lesson paid online', onDelete: 'keep' },
    refund_note: { category: 'Purchase history', why: 'how a manager settled a refund by hand (cash at the desk…); part of the money trail', onDelete: 'keep' },
  },
  // 0252: the hold ladder. The key is a SHA-256 of a VERIFIED phone number's
  // digits (never the number), kept on purpose after the account is deleted:
  // a guest suspended or banned for holding courts and letting them lapse must
  // not come back on the same number by deleting the account. guest_id keeps
  // pointing at 0077's tombstone.
  hold_standing: {
    id: n, guest_id: n, strikes: n, last_strike_at: n, blocked_until: n, suspended_at: n,
    needs_review: n, review_venue_id: n, banned_at: n, banned_by: n, reviewed_at: n,
    reviewed_by: n, updated_at: n,
    key: { category: 'Phone number', why: 'abuse prevention: a hash of the verified phone, so a suspension or ban for letting court holds lapse follows the number and outlives a deleted account', onDelete: 'keep' },
  },
  customer_flags: {
    customer_id: n,
    type: { category: 'App activity', why: 'desk labels such as VIP', onDelete: 'row' },
    label: { category: 'User content', why: 'free-text label on the customer', onDelete: 'row' },
    created_by: n, created_at: n,
  },
  notification_outbox: {
    id: n, profile_id: n, kind: n,
    payload: { category: 'User content', why: 'the text of the push queued for this guest', onDelete: 'row' },
    scheduled_for: n, sent_at: n, attempts: n, last_error: n, created_at: n,
    // 0090: the delivery lease, a timestamp with no guest content.
    claimed_at: n,
  },
  promotion_redemptions: {
    id: n, promotion_id: n, tab_id: n, adjustment_id: n, customer_id: n,
    amount_iqd: { category: 'Purchase history', why: 'the discount given — part of the venue’s takings', onDelete: 'keep' },
    code_used: n, idempotency_key: n, redeemed_at: n, redeemed_by: n,
  },
  // ── 0258: open matches (docs/design/open-matches/db.md §4.4.9, R29) ──────
  // 0264 writes the two scrubs below (match_seats.gender,
  // match_requests.friend_genders) and deletes match_blocks with either
  // account; the deletion proof further down exercises all three.
  matches: {
    id: n, venue_id: n, status: n, start_at: n, end_at: n, period: n, duration_min: n, visibility: n,
    join_policy: n, category: n,
    price_iqd: { category: 'Purchase history', why: 'what the court sold for in an open match', onDelete: 'keep' },
    shares_iqd: { category: 'Purchase history', why: 'the open match’s court price split in four, one share per seat', onDelete: 'keep' },
    rate_rule_id: n, price_court_id: n, fill_deadline_at: n, share_token: n, organiser_id: n, organised_by: n,
    created_by_staff_id: n, reservation_id: n, sandbox: n, deadline_warned_at: n, ended_at: n, ended_reason: n,
    idempotency_key: n, created_at: n, updated_at: n,
  },
  match_seats: {
    id: n, venue_id: n, match_id: n, seat_no: n, kind: n, guest_id: n,
    guest_name: {
      category: 'Name',
      why: 'a walk-in the desk seated in an open match; such a seat has no account, so no account deletion reaches it',
      onDelete: 'keep',
    },
    guest_phone: {
      category: 'Phone number',
      why: 'a walk-in the desk seated in an open match; such a seat has no account, so no account deletion reaches it',
      onDelete: 'keep',
    },
    gender: { category: 'Other personal info', why: 'the seat in a women-only or men-only open match', onDelete: 'scrub' },
    status: n, ticket_id: n,
    share_iqd: { category: 'Purchase history', why: 'the player’s share of the court in an open match', onDelete: 'keep' },
    request_id: n, replaces_seat_id: n, created_by_staff_id: n, vouched: n, joined_at: n, ended_at: n,
    end_reason: n, marked_by_staff_id: n, marked_at: n, written_off_by_staff_id: n, written_off_at: n,
    write_off_reason: n,
  },
  match_requests: {
    id: n, venue_id: n, match_id: n, guest_id: n, seats_requested: n,
    friend_genders: {
      category: 'Other personal info',
      why: 'genders a player declared for friends in a women-only or men-only open match',
      onDelete: 'scrub',
    },
    status: n, decided_at: n, created_at: n,
  },
  match_tickets: {
    id: n, guest_id: n, status: n,
    price_iqd: { category: 'Purchase history', why: 'the price paid for an open-match ticket', onDelete: 'keep' },
    purchase_payment_id: n, sandbox: n, request_id: n, seat_id: n, forfeited_venue_id: n, forfeited_seat_id: n,
    forfeited_at: n, cashed_out_at: n, cashout_payment_id: n, created_at: n, updated_at: n,
  },
  match_reports: {
    id: n, venue_id: n, match_id: n, reporter_id: n, reported_id: n, seat_id: n, request_id: n,
    reason: {
      category: 'App activity',
      why: 'a report one player made about another; a moderation record, deleted after 12 months (R36)',
      onDelete: 'keep',
    },
    status: n, reviewed_by: n, reviewed_at: n, created_at: n,
  },
  // ids, codes and times only.
  match_events: {
    id: n, venue_id: n, match_id: n, type: n, actor: n, actor_guest_id: n, actor_staff_id: n, seat_id: n,
    request_id: n, code: n, data: n, at: n,
  },
  match_ticket_events: {
    id: n, ticket_id: n, guest_id: n, type: n, venue_id: n, match_id: n, seat_id: n, request_id: n,
    payment_id: n, actor_staff_id: n, code: n, at: n,
  },
  match_blocks: { id: n, blocker_id: n, blocked_id: n, created_at: n },
  match_exclusions: { match_id: n, guest_id: n, venue_id: n, reason: n, created_at: n },
  // ── coaching (docs/design/coaching/db.md §4.3.16, R22, R44, R49, R63) ────
  // The coaching deletion re-issue of delete_my_account erases these and the
  // deletion proof above gains them in that commit; until then no coaching
  // row can exist (the writers land after the tables).
  coaches: {
    id: n, profile_id: n,
    display_name_en: {
      category: 'Name',
      why: 'the coach’s public name, chosen by the venue; kept on a deleted coach for the statements the venue paid (C-29, R63)',
      onDelete: 'keep',
    },
    display_name_ar: {
      category: 'Name',
      why: 'the coach’s public name, chosen by the venue; kept on a deleted coach for the statements the venue paid (C-29, R63)',
      onDelete: 'keep',
    },
    bio_en: { category: 'User content', why: 'the coach’s public bio, written by a manager', onDelete: 'empty' },
    bio_ar: { category: 'User content', why: 'the coach’s public bio, written by a manager', onDelete: 'empty' },
    photo_path: {
      category: 'Photos',
      why: 'the coach’s public photo; the object is queued for removal on retirement or deletion (R43)',
      onDelete: 'scrub',
    },
    status: n, sort_order: n, public_accepted_at: n, created_by_staff_id: n, created_at: n, updated_at: n,
    retired_at: n,
  },
  courses: {
    id: n, venue_id: n, coach_id: n, lesson_type_id: n,
    title_en: { category: 'User content', why: 'a course title a coach or the desk wrote', onDelete: 'keep' },
    title_ar: { category: 'User content', why: 'a course title a coach or the desk wrote', onDelete: 'keep' },
    price_iqd: { category: 'Purchase history', why: 'the course’s price when it was set up', onDelete: 'keep' },
    court_share_iqd: n, coach_share_bp: n, sessions_count: n, max_places: n, min_places: n, cutoff_at: n,
    cutoff_checked_at: n, signup_closes_at: n, status: n, cancel_reason: n, created_by_kind: n,
    created_by_profile_id: n, created_by_staff_id: n, idempotency_key: n, created_at: n, updated_at: n,
    cancelled_at: n,
  },
  lessons: {
    id: n, venue_id: n, coach_id: n, lesson_type_id: n, kind: n, course_id: n, session_no: n, start_at: n,
    end_at: n, period: n,
    price_iqd: { category: 'Purchase history', why: 'the lesson’s price when it was booked', onDelete: 'keep' },
    court_share_iqd: n, coach_share_bp: n, max_places: n, min_places: n, cutoff_at: n, cutoff_checked_at: n,
    status: n, hold_expires_at: n, booked_by_kind: n, created_by_profile_id: n, created_by_staff_id: n,
    cancel_reason: n, cancelled_at: n, completed_at: n, rescheduled_at: n, idempotency_key: n, created_at: n,
    updated_at: n,
  },
  lesson_enrolments: {
    id: n, venue_id: n, lesson_id: n, course_id: n, guest_id: n,
    // NOT NULL on a coach- or desk-booked row (lesson_enrolments_typed), so a
    // deletion writes the placeholder; a guest-booked row's stays NULL.
    guest_name: {
      category: 'Name',
      why: 'a student a coach or the desk named; replaced by a fixed marker 365 days after the lesson (CD-8, R44)',
      onDelete: 'anonymise',
    },
    guest_phone: {
      category: 'Phone number',
      why: 'a student’s number typed by a coach or the desk, shown to the coach until 7 days after the session (CD-3, R54), purged after 365 (CD-8)',
      onDelete: 'scrub',
    },
    party_size: n,
    friend_names: { category: 'Name', why: 'the friends a guest brings to a private lesson', onDelete: 'empty' },
    booked_by_kind: n, booked_by_profile_id: n, booked_by_staff_id: n,
    price_iqd: { category: 'Purchase history', why: 'what the lesson place cost', onDelete: 'keep' },
    first_session_no: n, sessions_covered: n, payment_mode: n, status: n, hold_expires_at: n, cancel_kind: n,
    cancelled_at: n, link_confirmed_at: n,
    refunded_outside_iqd: {
      category: 'Purchase history',
      why: 'lesson money handed back outside the till when the card could not take a second refund (R75)',
      onDelete: 'keep',
    },
    idempotency_key: n, created_at: n, updated_at: n,
    // 0292 (DB-18): a time (cancelled_at plus the window), no guest data.
    kept_until: n,
  },
  // ids, codes, counts and times only.
  lesson_attendance: {
    lesson_id: n, enrolment_id: n, venue_id: n, status: n, marked_by_kind: n, marked_by_profile_id: n,
    marked_by_staff_id: n, marked_at: n,
  },
  lesson_strikes: {
    enrolment_id: n, lesson_id: n, venue_id: n, guest_id: n, kind: n, struck_at: n, settled_at: n, counted: n,
  },
  lesson_events: {
    id: n, venue_id: n, lesson_id: n, course_id: n, enrolment_id: n, type: n, actor: n, actor_profile_id: n,
    actor_staff_id: n, code: n, data: n, at: n,
  },
};

/**
 * Coaching (R49): what the venue keeps about a coach, in tables that carry no
 * guest link column: reached through coaches.profile_id (the UNLINKED_PERSONAL
 * precedent, an explicit block with its own proof). A coach's time-off reason
 * is emptied on deletion; a coach's monthly pay and its payment reference are
 * the venue's accounts and are kept (C-29). The coaching deletion re-issue of
 * delete_my_account proves the 'empty' route.
 */
const COACH_DATA: Record<string, Record<string, Field>> = {
  coach_time_off: {
    id: n, coach_id: n, period: n,
    reason: { category: 'User content', why: 'a coach’s note on their time off', onDelete: 'empty' },
    set_by: n, set_by_staff_id: n, created_at: n, cancelled_at: n,
  },
  coach_statements: {
    id: n, coach_id: n, venue_id: n, month: n, status: n, lessons_count: n,
    collected_iqd: { category: 'Financial info', why: 'a coach’s monthly pay: the lesson money collected', onDelete: 'keep' },
    court_share_iqd: { category: 'Financial info', why: 'a coach’s monthly pay: the court share taken off', onDelete: 'keep' },
    coach_iqd: { category: 'Financial info', why: 'a coach’s monthly pay: the coach’s share', onDelete: 'keep' },
    adjustments_iqd: { category: 'Financial info', why: 'a coach’s monthly pay: corrections to earlier months', onDelete: 'keep' },
    drafted_at: n, refreshed_at: n, approved_by: n, approved_at: n, paid_by: n, paid_at: n,
    paid_reference: {
      category: 'Financial info',
      why: 'the receipt or transfer number of a coach payment, never a card or account number (R49, R74)',
      onDelete: 'keep',
    },
    voided_by: n, voided_at: n, void_reason: n,
  },
  coach_statement_lines: {
    id: n, statement_id: n, venue_id: n, lesson_id: n,
    collected_iqd: { category: 'Financial info', why: 'a coach’s monthly pay, per lesson', onDelete: 'keep' },
    court_share_iqd: { category: 'Financial info', why: 'a coach’s monthly pay, per lesson', onDelete: 'keep' },
    share_bp: n,
    coach_iqd: { category: 'Financial info', why: 'a coach’s monthly pay, per lesson', onDelete: 'keep' },
    is_adjustment: n, created_at: n,
  },
};

/**
 * Personal data staff type about other people, with NO guest link on purpose
 * (wave5-addendum §2.6.1, §2.12): erased by retention, never by an account.
 * Every column of every table, as for GUEST_DATA.
 */
const UNLINKED_PERSONAL: Record<string, Record<string, Field>> = {
  // wave 5, lane P (incident_reports): 365 days after the report, or at once
  // on the owner's redaction, app.incident_purge_due replaces the text and
  // protocol-action removes the photos.
  incident_reports: {
    id: n, venue_id: n, kind: n, occurred_at: n, place: n, court_id: n,
    place_detail: { category: 'User content', why: 'where an incident happened, as staff typed it', onDelete: 'purge' },
    description: { category: 'User content', why: 'what happened in an incident at the venue', onDelete: 'purge' },
    people_involved: { category: 'Name', why: 'who was involved in an incident, which may name a guest', onDelete: 'purge' },
    photos: { category: 'Photos', why: 'photos of an incident at the venue', onDelete: 'purge' },
    reported_by: n, reported_at: n, status: n, reviewed_by: n, reviewed_at: n,
    review_note: { category: 'User content', why: 'the manager’s note on an incident report', onDelete: 'purge' },
    purge_after: n, text_purged_at: n, photos_purged_at: n,
  },
};

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

/** The live schema as PostgREST publishes it. */
async function liveColumns(): Promise<Record<string, string[]>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status}`);
  const doc = (await res.json()) as {
    definitions: Record<string, { properties?: Record<string, unknown> }>;
  };
  const out: Record<string, string[]> = {};
  for (const [table, spec] of Object.entries(doc.definitions ?? {})) {
    out[table] = Object.keys(spec.properties ?? {});
  }
  return out;
}

describe.skipIf(!up)('SEC-20 stored-field allowlist', () => {
  let svc: SupabaseClient;
  let live: Record<string, string[]>;

  beforeAll(async () => {
    svc = serviceClient();
    live = await liveColumns();
  });

  it('reads a real catalog — the guard against a vacuously green suite', () => {
    expect(Object.keys(live).length).toBeGreaterThan(50);
    expect(live.profiles).toContain('expo_push_token');
  });

  it('declares every table that carries a guest link', () => {
    const found = Object.entries(live)
      .filter(([t, cols]) => t === 'profiles' || cols.some((c) => LINK_COLUMNS.includes(c)))
      .map(([t]) => t)
      .sort();
    const declared = Object.keys(GUEST_DATA).sort();

    expect(
      found.filter((t) => !declared.includes(t)),
      'a table now carries guest data and is not declared in GUEST_DATA — declare it, ' +
        'then re-fill both stores’ data-safety forms from this file',
    ).toEqual([]);
    expect(
      declared.filter((t) => !found.includes(t)),
      'declared here but no longer carries a guest link',
    ).toEqual([]);
  });

  it('matches the live column set of every declared table exactly', () => {
    const drift: string[] = [];
    for (const [table, fields] of Object.entries(GUEST_DATA)) {
      const actual = [...(live[table] ?? [])].sort();
      expect(actual.length, `${table} is not exposed by PostgREST`).toBeGreaterThan(0);
      const declared = Object.keys(fields).sort();
      for (const c of actual.filter((c) => !declared.includes(c))) {
        drift.push(`${table}.${c} exists in the database but is not declared`);
      }
      for (const c of declared.filter((c) => !actual.includes(c))) {
        drift.push(`${table}.${c} is declared but no longer exists`);
      }
    }
    expect(
      drift,
      'the schema moved and the declaration did not move with it. Update GUEST_DATA, ' +
        'then re-fill the store forms FROM IT — that is what this test is for.',
    ).toEqual([]);
  });

  it('gives every personal column a purpose and an erasure route', () => {
    const incomplete: string[] = [];
    for (const [table, fields] of Object.entries(GUEST_DATA)) {
      for (const [col, f] of Object.entries(fields)) {
        if (!f.category) continue;
        if (!f.why) incomplete.push(`${table}.${col} has no purpose for the form`);
        if (!f.onDelete) incomplete.push(`${table}.${col} has no erasure route`);
      }
    }
    expect(incomplete).toEqual([]);
  });

  /**
   * The proof, and the reason this file is worth more than a document: populate
   * every column declared personal, delete the account for real, and assert that
   * everything declared erasable is empty. Keeps the declaration and the
   * deletion from drifting apart.
   */
  it('app.delete_my_account empties every column declared erasable', async () => {
    await ensureTestRateRule(svc);
    const courtId = await createTestCourt(svc, `S20${Date.now() % 100000}`);
    const guest = await guestClient(svc, 'sec20');
    const uid = (await guest.auth.getUser()).data.user!.id;

    const slot = futureSlot();
    const held = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    });
    if (held.error) throw new Error(`hold_slot: ${held.error.message}`);
    const reservationId = (held.data as { reservation_id: string }).reservation_id;
    const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: reservationId });
    if (confirmed.error) throw new Error(`confirm_booking: ${confirmed.error.message}`);

    // Fill in every 'scrub' column on the two tables whose rows survive. The
    // 0256 columns too: both name parts, and the three gender columns together
    // (profiles_gender_stamp).
    const filled = await svc
      .from('profiles')
      .update({
        expo_push_token: 'ExponentPushToken[sec20]',
        given_name: 'Sec',
        family_name: 'Twenty',
        gender: 'female',
        gender_set_at: new Date().toISOString(),
        gender_set_by: 'guest',
      })
      .eq('id', uid)
      .select('given_name, family_name, gender')
      .single();
    if (filled.error) throw new Error(`profiles fill: ${filled.error.message}`);
    expect(filled.data).toEqual({ given_name: 'Sec', family_name: 'Twenty', gender: 'female' });
    await svc
      .from('reservations')
      .update({
        guest_name: 'SEC20 Guest',
        guest_phone: '+9647700020020',
        notes: 'sec20 note',
        device_id: 'DEV20',
      })
      .eq('id', reservationId);
    // …and one row in each table whose rows are removed whole.
    await svc
      .from('customer_notes')
      .insert({ customer_id: uid, body: 'sec20 note', author_id: SEED_STAFF_IDS.court_desk });
    await svc
      .from('customer_flags')
      .insert({ customer_id: uid, type: 'vip', label: 'sec20', created_by: SEED_STAFF_IDS.court_desk });
    await svc.from('notification_outbox').insert({
      profile_id: uid,
      kind: 'reservation_reminder',
      payload: { reservation_id: reservationId },
      scheduled_for: new Date().toISOString(),
    });

    // 0264 (R29, G5e): a linked match seat with a gender, a pending request
    // with friend_genders, and a block each way. The match (another guest's
    // approve-mode women's match, where the desk seated this guest as a linked
    // walk-in) is cancelled, so no list and no other suite ever reads it (the
    // cron's sweep may expire the request first: the scrub has no status
    // filter, so either proves it).
    const other = await guestClient(svc, 'sec20-other');
    const otherId = (await other.auth.getUser()).data.user!.id;
    const mStart = new Date(slot.start.getTime() + 2 * 3_600_000);
    const { data: match, error: mErr } = await svc
      .from('matches')
      .insert({
        venue_id: VENUE_A_ID,
        status: 'cancelled',
        start_at: mStart.toISOString(),
        end_at: new Date(mStart.getTime() + 3_600_000).toISOString(),
        duration_min: 60,
        visibility: 'link',
        join_policy: 'approve',
        category: 'women',
        price_iqd: 40_000,
        shares_iqd: [10_000, 10_000, 10_000, 10_000],
        price_court_id: courtId,
        fill_deadline_at: new Date(mStart.getTime() - 2 * 3_600_000).toISOString(),
        share_token: crypto.randomUUID().replace(/-/g, '').slice(0, 22),
        organiser_id: otherId,
        organised_by: 'guest',
        ended_at: new Date().toISOString(),
        ended_reason: 'staff_cancelled',
      })
      .select('id')
      .single();
    if (mErr) throw new Error(`matches: ${mErr.message}`);
    const matchId = (match as { id: string }).id;
    const { data: seat, error: sErr } = await svc
      .from('match_seats')
      .insert({
        venue_id: VENUE_A_ID,
        match_id: matchId,
        seat_no: 1,
        kind: 'desk',
        guest_id: uid,
        gender: 'female',
        status: 'cancelled',
        share_iqd: 10_000,
        created_by_staff_id: SEED_STAFF_IDS.court_desk,
        ended_at: new Date().toISOString(),
        end_reason: 'match_ended',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`match_seats: ${sErr.message}`);
    const { data: request, error: qErr } = await svc
      .from('match_requests')
      .insert({ venue_id: VENUE_A_ID, match_id: matchId, guest_id: uid, seats_requested: 2, friend_genders: ['female'] })
      .select('id')
      .single();
    if (qErr) throw new Error(`match_requests: ${qErr.message}`);
    const blocks = await svc.from('match_blocks').insert([
      { blocker_id: uid, blocked_id: otherId },
      { blocker_id: otherId, blocked_id: uid },
    ]);
    if (blocks.error) throw new Error(`match_blocks: ${blocks.error.message}`);

    // 0289 (coaching; db.md §4.10, R43, R49, R63, R83): the guest is a coach
    // (bios, a photo, a time-off reason), a student a coach typed and the
    // guest confirmed (C-21), a guest who booked a private lesson with a
    // friend, and a typed student whose phone matched the guest but was never
    // confirmed (unlinked silently, as "Not me"). The lessons were cancelled
    // weeks ago, so no sweep, statement or report reads them; every row is
    // removed at the end.
    const ins = async (table: string, row: Record<string, unknown>) => {
      const { data, error } = await svc.from(table).insert(row).select('id').single();
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data as { id: string }).id;
    };
    const teacher = await ins('coaches', {
      profile_id: otherId, display_name_en: 'SEC20 Teacher', display_name_ar: 'مدرّب SEC20',
    });
    const photoFolder = `coaches/${crypto.randomUUID()}`;
    const coachId = await ins('coaches', {
      profile_id: uid,
      display_name_en: 'SEC20 Coach',
      display_name_ar: 'مدرّب SEC20 الثاني',
      bio_en: 'sec20 bio',
      bio_ar: 'نبذة sec20',
      photo_path: `${photoFolder}/a.jpg`,
      public_accepted_at: new Date().toISOString(),
    });
    const timeOffId = await ins('coach_time_off', {
      coach_id: coachId,
      period: `[${new Date(Date.now() + 400 * 86_400_000).toISOString()},${new Date(Date.now() + 401 * 86_400_000).toISOString()})`,
      reason: 'sec20 holiday',
      set_by: 'coach',
    });
    const typeId = await ins('lesson_types', {
      venue_id: VENUE_A_ID, kind: 'private', name_en: 'SEC20 private', name_ar: 'حصة SEC20', duration_min: 60,
      price_iqd: 40_000, court_share_iqd: 10_000, max_places: 4, min_places: 1, cutoff_hours: 0,
    });
    const weeksAgo = Date.now() - 45 * 86_400_000;
    const cancelledLesson = (i: number) =>
      ins('lessons', {
        venue_id: VENUE_A_ID, coach_id: teacher, lesson_type_id: typeId, kind: 'private',
        start_at: new Date(weeksAgo + i * 3 * 3_600_000).toISOString(),
        end_at: new Date(weeksAgo + i * 3 * 3_600_000 + 3_600_000).toISOString(),
        price_iqd: 40_000, court_share_iqd: 10_000, coach_share_bp: 6000, max_places: 4, min_places: 1,
        status: 'cancelled', cancel_reason: 'staff_cancel', cancelled_at: new Date().toISOString(),
        booked_by_kind: 'staff', created_by_staff_id: SEED_STAFF_IDS.court_desk,
      });
    const lessonIds = [await cancelledLesson(0), await cancelledLesson(1), await cancelledLesson(2)];
    const ended = { status: 'cancelled', cancel_kind: 'staff', cancelled_at: new Date().toISOString() };
    const confirmedId = await ins('lesson_enrolments', {
      venue_id: VENUE_A_ID, lesson_id: lessonIds[0], guest_id: uid, guest_name: 'SEC20 Student',
      guest_phone: '07700020021', booked_by_kind: 'coach', booked_by_profile_id: otherId,
      link_confirmed_at: new Date().toISOString(), price_iqd: 40_000, payment_mode: 'desk', ...ended,
    });
    const ownId = await ins('lesson_enrolments', {
      venue_id: VENUE_A_ID, lesson_id: lessonIds[1], guest_id: uid, party_size: 2, friend_names: ['SEC20 Friend'],
      booked_by_kind: 'guest', booked_by_profile_id: uid, link_confirmed_at: new Date().toISOString(),
      price_iqd: 40_000, payment_mode: 'desk', ...ended,
    });
    const pendingId = await ins('lesson_enrolments', {
      venue_id: VENUE_A_ID, lesson_id: lessonIds[2], guest_id: uid, guest_name: 'SEC20 Pending',
      guest_phone: '07700020022', booked_by_kind: 'coach', booked_by_profile_id: otherId,
      price_iqd: 40_000, payment_mode: 'desk', ...ended,
    });

    const del = await appRpc(guest, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.error).toBeNull();

    const leaks: string[] = [];

    // 'scrub' must be null; 'anonymise' must be the placeholder, which is only
    // meaningful because it is NOT what the column held a moment ago.
    for (const [table, idColumn, idValue] of [
      ['profiles', 'id', uid],
      ['reservations', 'id', reservationId],
      ['match_seats', 'id', (seat as { id: string }).id],
      ['match_requests', 'id', (request as { id: string }).id],
      ['coaches', 'profile_id', uid],
      ['lesson_enrolments', 'id', confirmedId],
    ] as const) {
      const erasable = Object.entries(GUEST_DATA[table] ?? {}).filter(
        ([, f]) => f.category && (f.onDelete === 'scrub' || f.onDelete === 'anonymise'),
      );
      const { data, error } = await svc
        .from(table)
        .select(erasable.map(([c]) => c).join(','))
        .eq(idColumn, idValue)
        .maybeSingle();
      if (error) throw new Error(`${table}: ${error.message}`);
      expect(data, `${table} row should still exist after deletion`).not.toBeNull();
      const row = (data ?? {}) as Record<string, unknown>;
      for (const [col, f] of erasable) {
        const value = row[col];
        if (f.onDelete === 'scrub' && value !== null) {
          leaks.push(`${table}.${col} should be null, holds ${JSON.stringify(value)}`);
        }
        if (f.onDelete === 'anonymise' && value !== TOMBSTONE_NAME) {
          leaks.push(`${table}.${col} should be the placeholder, holds ${JSON.stringify(value)}`);
        }
      }
    }

    // 'row' — nothing may remain for this guest.
    for (const [table, col] of [
      ['customer_notes', 'customer_id'],
      ['customer_flags', 'customer_id'],
      ['notification_outbox', 'profile_id'],
      ['match_blocks', 'blocker_id'],
      ['match_blocks', 'blocked_id'],
    ] as const) {
      const { data } = await svc.from(table).select('*').eq(col, uid);
      if ((data ?? []).length > 0) leaks.push(`${table} still has ${(data ?? []).length} row(s)`);
    }

    // 'empty' (0289): the row survives, the column is '' or {}.
    for (const [table, id, cols] of [
      ['coaches', coachId, ['bio_en', 'bio_ar']],
      ['lesson_enrolments', ownId, ['friend_names']],
      ['coach_time_off', timeOffId, ['reason']],
    ] as const) {
      const { data, error } = await svc.from(table).select(cols.join(',')).eq('id', id).single();
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const col of cols) {
        const value = (data as unknown as Record<string, unknown>)[col];
        if (value !== '' && !(Array.isArray(value) && value.length === 0)) {
          leaks.push(`${table}.${col} should be empty, holds ${JSON.stringify(value)}`);
        }
      }
    }

    expect(leaks).toEqual([]);

    // The deleted coach is retired, keeps the display names for the statements
    // (C-29, R63), and its photo folder is queued for removal (R43).
    const { data: coachRow } = await svc
      .from('coaches')
      .select('status, display_name_en, retired_at')
      .eq('id', coachId)
      .single();
    expect(coachRow).toMatchObject({ status: 'retired', display_name_en: 'SEC20 Coach' });
    const { data: purges } = await svc.from('coach_photo_purges').select('folder').eq('coach_id', coachId);
    expect((purges ?? []).map((p) => (p as { folder: string }).folder)).toEqual([photoFolder]);
    // A pending link is dropped silently, as "Not me" (C-21, R83): the coach's
    // typed student stays exactly as typed.
    const { data: pending } = await svc
      .from('lesson_enrolments')
      .select('guest_id, guest_name, guest_phone')
      .eq('id', pendingId)
      .single();
    expect(pending).toEqual({ guest_id: null, guest_name: 'SEC20 Pending', guest_phone: '07700020022' });

    await svc.from('lesson_enrolments').delete().in('id', [confirmedId, ownId, pendingId]);
    await svc.from('lessons').delete().in('id', lessonIds);
    await svc.from('lesson_types').delete().eq('id', typeId);
    await svc.from('coach_time_off').delete().eq('id', timeOffId);
    await svc.from('coach_photo_purges').delete().eq('coach_id', coachId);
    await svc.from('coaches').delete().in('id', [coachId, teacher]);

    // The two gender stamps are declared n (they identify nobody alone), but
    // they go with gender: the tombstone has no trace of it.
    const { data: stamps } = await svc
      .from('profiles')
      .select('gender_set_at, gender_set_by')
      .eq('id', uid)
      .single();
    expect(stamps).toEqual({ gender_set_at: null, gender_set_by: null });

    // And the 'keep' columns really are kept — the venue's books are intact.
    const { data: kept } = await svc
      .from('reservations')
      .select('price_iqd')
      .eq('id', reservationId)
      .single();
    expect((kept as { price_iqd: number }).price_iqd).toBeGreaterThan(0);

    await svc.from('courts').delete().eq('id', courtId);
  });

  it('UNLINKED_PERSONAL tables carry no guest link, on purpose', () => {
    for (const table of Object.keys(UNLINKED_PERSONAL)) {
      expect(live[table]?.length ?? 0, `${table} is not exposed by PostgREST`).toBeGreaterThan(0);
      expect(live[table]!.filter((c) => LINK_COLUMNS.includes(c)), table).toEqual([]);
      expect(Object.keys(GUEST_DATA), table).not.toContain(table);
    }
  });

  it('matches the live column set of every UNLINKED_PERSONAL table exactly, each personal column purged', () => {
    const drift: string[] = [];
    for (const [table, fields] of Object.entries(UNLINKED_PERSONAL)) {
      const actual = [...(live[table] ?? [])].sort();
      const declared = Object.keys(fields).sort();
      for (const c of actual.filter((c) => !declared.includes(c))) drift.push(`${table}.${c} exists but is not declared`);
      for (const c of declared.filter((c) => !actual.includes(c))) drift.push(`${table}.${c} is declared but no longer exists`);
      for (const [col, f] of Object.entries(fields)) {
        if (f.category && (f.onDelete !== 'purge' || !f.why)) drift.push(`${table}.${col} needs a purpose and 'purge'`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('COACH_DATA tables carry no guest link, match the live columns exactly, and declare every personal column (R49)', () => {
    const drift: string[] = [];
    for (const [table, fields] of Object.entries(COACH_DATA)) {
      expect(live[table]?.length ?? 0, `${table} is not exposed by PostgREST`).toBeGreaterThan(0);
      expect(live[table]!.filter((c) => LINK_COLUMNS.includes(c)), table).toEqual([]);
      expect(Object.keys(GUEST_DATA), table).not.toContain(table);
      expect(Object.keys(UNLINKED_PERSONAL), table).not.toContain(table);
      const actual = [...(live[table] ?? [])].sort();
      const declared = Object.keys(fields).sort();
      for (const c of actual.filter((c) => !declared.includes(c))) drift.push(`${table}.${c} exists but is not declared`);
      for (const c of declared.filter((c) => !actual.includes(c))) drift.push(`${table}.${c} is declared but no longer exists`);
      for (const [col, f] of Object.entries(fields)) {
        if (f.category && (!f.why || !f.onDelete || !['empty', 'keep'].includes(f.onDelete))) {
          drift.push(`${table}.${col} needs a purpose and 'empty' or 'keep'`);
        }
      }
    }
    expect(drift).toEqual([]);
    // Every coach is reached through coaches.profile_id, a link column GUEST_DATA declares.
    expect(GUEST_DATA.coaches?.profile_id).toEqual(n);
  });

  it.skipIf(!docker)('the purge empties every UNLINKED_PERSONAL column declared purge', () => {
    // One rolled-back transaction: a report past its date, the text purge the
    // cron runs, and the photo pair the protocol-action tick calls.
    const purged = (Object.entries(UNLINKED_PERSONAL.incident_reports!) as Array<[string, Field]>)
      .filter(([, f]) => f.onDelete === 'purge')
      .map(([c]) => c);
    const raw = psql(`
      begin;
      create temp table t on commit drop as
        select gen_random_uuid() as id, '${VENUE_A_ID}/incidents/' || gen_random_uuid() || '.jpg' as path;
      insert into staff_media_uploads (path, venue_id, folder, uploader, used_at, used_by)
      select t.path, '${VENUE_A_ID}', 'incidents', '${SEED_STAFF_IDS.court_desk}', now(), 'incident:' || t.id from t;
      insert into incident_reports (id, venue_id, kind, occurred_at, place, place_detail, description, people_involved,
                                    photos, reported_by, status, reviewed_by, reviewed_at, review_note, purge_after)
      select t.id, '${VENUE_A_ID}', 'injury', now() - interval '366 days', 'cafe', 'SEC20 terrace', 'SEC20 what happened',
             'SEC20 a guest', array[t.path], '${SEED_STAFF_IDS.court_desk}', 'reviewed', '${SEED_STAFF_IDS.manager}', now(),
             'SEC20 note', now() - interval '1 day'
        from t;
      select app.incident_purge_due();
      select app.incident_photos_purged(t.id) from t;
      select row_to_json(i)::text from incident_reports i join t using (id);
      rollback;`);
    const row = JSON.parse(raw.split('\n').pop()!) as Record<string, unknown>;
    const leaks: string[] = [];
    for (const col of purged) {
      const v = row[col];
      const empty = v === null || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && /^\[deleted/.test(v));
      if (!empty) leaks.push(`incident_reports.${col} still holds ${JSON.stringify(v)}`);
    }
    expect(leaks).toEqual([]);
    expect(row.kind).toBe('injury');
    expect(row.status).toBe('reviewed');
  });

  /**
   * Not an assertion — the deliverable. Paste this into Google Play's Data
   * safety form and Apple's App Privacy questions.
   */
  it('prints the data-safety declaration for both store forms', () => {
    const byCategory = new Map<string, { where: string; why: string; fate: string }[]>();
    for (const [table, fields] of Object.entries({ ...GUEST_DATA, ...UNLINKED_PERSONAL, ...COACH_DATA })) {
      for (const [col, f] of Object.entries(fields)) {
        if (!f.category) continue;
        if (!byCategory.has(f.category)) byCategory.set(f.category, []);
        byCategory.get(f.category)!.push({ where: `${table}.${col}`, why: f.why!, fate: f.onDelete! });
      }
    }
    const lines = ['', 'DATA SAFETY — generated from GUEST_DATA (SEC-20). Do not retype from memory.', ''];
    for (const [category, entries] of [...byCategory].sort()) {
      lines.push(`  ${category}`);
      for (const e of entries) lines.push(`      ${e.where.padEnd(32)} ${e.fate.padEnd(6)} ${e.why}`);
      lines.push('');
    }
    lines.push('  Deletion: in-app, app.delete_my_account (migrations 0077, 0264).');
    lines.push('            on the web: https://www.touch-padel.com/en/delete-account (same RPC; the Play deletion URL).');
    lines.push('  Every "scrub"/"row" field above is proved erased by the test above this one.');
    lines.push('  "keep" is deliberate retention — the venue’s takings, not the guest’s identity.');
    lines.push('  "purge" is retention: staff-typed records with no guest link, emptied after a year');
    lines.push('            (incident reports: app.incident_purge_due and the protocol-action tick).');
    lines.push('  "empty" sets a NOT NULL text or list to empty on deletion (a coach’s bio and time-off');
    lines.push('            reasons, a guest’s friend names); a coach’s pay is the venue’s accounts and is kept.');
    console.log(lines.join('\n'));
    expect(byCategory.size).toBeGreaterThan(0);
  });
});
