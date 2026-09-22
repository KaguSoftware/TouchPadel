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

const TEST_USER_ID = '00000000-0000-4000-8000-00000000beef';
export const TEST_RESERVATION_ID = '11111111-1111-4111-8111-111111111111';
const TEST_COURT_ID = '22222222-2222-4222-8222-222222222222';

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
    ...over,
  };
}

export function courtFixture(over: Record<string, unknown> = {}) {
  return {
    id: TEST_COURT_ID,
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
