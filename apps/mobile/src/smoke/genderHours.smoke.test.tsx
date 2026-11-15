/**
 * Gender hours (migration 0353, Majed 2026-10-19), in EN and AR: a gender is a
 * must for every account, and some courts and hours are kept for women or for
 * men.
 *
 *   - Complete profile asks "Woman / Man" while the profile has none, with
 *     nothing picked; Save refuses inline until one is, then saves it through
 *     app.set_my_gender after the profile update. A set gender is not asked.
 *   - Sign up asks it under the name and refuses without it.
 *   - The booking sheet tags a kept time and greys it for the other gender.
 *
 * Not route cases (sign-up is auth.smoke's, the Book tab
 * tabs.smoke's): this suite walks the behaviour.
 */
import { useState } from 'react';
import { Animated } from 'react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { wallTimeToUtc, type GenderRuleLike } from '@touch/core';
import { makeT, type Locale } from '@touch/i18n';
import { expectAlerted } from '../test/alertState';
import { renderRoute } from '../test/smoke';
import { supabase } from '../lib/supabase';
import {
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { profileKeys } from '../features/profile/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import { listBookableDates } from '../features/availability/assemble';
import { clearPendingSlot } from '../features/booking/pendingSlot';
import { clearPendingJoin } from '../features/matches/pendingJoin';
import { BookingSheet } from '../components/BookingSheet';
import SignUpScreen from '../../app/sign-up';
import { patchSignUpDraft, resetSignUpDraft } from '../features/auth/signUpDraft';
import { onlinePaymentsOnForFile } from '../test/onlinePaymentsEnv';

onlinePaymentsOnForFile();

afterEach(() => {
  jest.restoreAllMocks();
  delete (supabase as { schema?: unknown }).schema;
  clearPendingSlot();
  clearPendingJoin();
});

describe.each<Locale>(['en', 'ar'])('a gender for every account in %s', (locale) => {
  const t = makeT(locale);

  it('sign up asks it after the name and refuses without it', async () => {
    // Step 2 of create account (gender, birth, language, Terms): nothing exists
    // yet, so nobody is signed in. The draft is module state, shared by the
    // steps: start each case clean, with the name step already done.
    resetSignUpDraft();
    patchSignUpDraft({ firstName: 'Sara', lastName: 'Ali' });
    const screen = renderRoute(SignUpScreen, { locale, params: { step: '1' } });
    try {
      const picker = screen.getByTestId('sign-up.gender');
      expect(picker).toBeTruthy();
      fireEvent.press(screen.getByTestId('sign-up.submit'));
      await expectAlerted(t('guestGender.required'));
      fireEvent.press(screen.getByTestId('sign-up.gender.female'));
    } finally {
      screen.unmount();
    }
  });
});

// ── The booking sheet ───────────────────────────────────────────────────────

const TZ = 'Asia/Baghdad';
const COURT = courtFixture();

function Sheet() {
  const [progress] = useState(() => new Animated.Value(1));
  return <BookingSheet testID="book.sheet" progress={progress} direction={1} bottomInset={0} isOpen />;
}

/** Tomorrow's first time (08:00), the first cell of the lane: a tap books it at once. */
function tomorrow() {
  const strip = listBookableDates(new Date(), TZ, 6, venueSettingsFixture());
  const date = strip[1]!;
  const startAt = wallTimeToUtc(date, 8 * 60, TZ);
  return { strip, date, startMin: Math.floor(startAt.getTime() / 60_000) };
}

/** Women only, every court, every day, 08:00 to 10:00. */
const WOMEN_MORNINGS: GenderRuleLike = {
  id: 'rule-women',
  gender: 'female',
  court_id: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  start_time: '08:00',
  end_time: '10:00',
  valid_from: null,
  valid_to: null,
  is_active: true,
};

function seeds(profile: ReturnType<typeof profileFixture> | null): [readonly unknown[], unknown][] {
  const { strip } = tomorrow();
  return [
    [availabilityKeys.branches, [branchFixture()]],
    [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
    [availabilityKeys.courts(TEST_VENUE_ID), [COURT]],
    [availabilityKeys.rates(TEST_VENUE_ID), []],
    [availabilityKeys.ratePrices, []],
    [availabilityKeys.window(TEST_VENUE_ID, strip[0]!, strip[strip.length - 1]!), []],
    [availabilityKeys.genderRules(TEST_VENUE_ID), [WOMEN_MORNINGS]],
    ...(profile ? ([[profileKeys.own, profile]] as [readonly unknown[], unknown][]) : []),
  ];
}

function renderSheet(locale: Locale, profile: ReturnType<typeof profileFixture> | null) {
  const screen = renderRoute(Sheet, {
    locale,
    session: profile ? 'verified' : 'out',
    queryData: seeds(profile),
  });
  const { date, startMin } = tomorrow();
  fireEvent.press(screen.getByTestId(`book.sheet.day.${date}`));
  return { screen, cell: () => screen.getByTestId(`book.sheet.slot.${COURT.id}-${startMin}`) };
}

describe.each<Locale>(['en', 'ar'])('kept hours on the booking sheet in %s', (locale) => {
  const t = makeT(locale);
  const tag = t('matches.common.categoryWomen');

  it('a woman sees the time open, tagged', () => {
    const { screen, cell } = renderSheet(locale, profileFixture({ gender: 'female' }));
    try {
      expect(within(cell()).getByText(tag)).toBeTruthy();
      expect(cell().props.accessibilityState).toMatchObject({ disabled: false });
    } finally {
      screen.unmount();
    }
  });

  it('a man sees it taken, the tag saying why', () => {
    const { screen, cell } = renderSheet(locale, profileFixture({ gender: 'male' }));
    try {
      expect(within(cell()).getByText(tag)).toBeTruthy();
      expect(cell().props.accessibilityState).toMatchObject({ disabled: true });
    } finally {
      screen.unmount();
    }
  });

  it('signed out, the tag only', () => {
    const { screen, cell } = renderSheet(locale, null);
    try {
      expect(within(cell()).getByText(tag)).toBeTruthy();
      expect(cell().props.accessibilityState).toMatchObject({ disabled: false });
    } finally {
      screen.unmount();
    }
  });
});
