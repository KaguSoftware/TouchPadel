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
 * Not route cases (complete-profile and sign-up are auth.smoke's, the Book tab
 * tabs.smoke's): this suite walks the behaviour.
 */
import { useState } from 'react';
import { Animated } from 'react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { wallTimeToUtc, type GenderRuleLike } from '@touch/core';
import { makeT, type Locale } from '@touch/i18n';
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
import CompleteProfileScreen from '../../app/complete-profile';
import SignUpScreen from '../../app/sign-up';
import { onlinePaymentsOnForFile } from '../test/onlinePaymentsEnv';

onlinePaymentsOnForFile();

afterEach(() => {
  jest.restoreAllMocks();
  delete (supabase as { schema?: unknown }).schema;
  clearPendingSlot();
  clearPendingJoin();
});

const checked = (node: { props: { accessibilityState?: { checked?: boolean } } }) =>
  node.props.accessibilityState?.checked === true;

describe.each<Locale>(['en', 'ar'])('a gender for every account in %s', (locale) => {
  const t = makeT(locale);

  it('complete-profile asks it with nothing picked, and Save refuses until one is', () => {
    const screen = renderRoute(CompleteProfileScreen, {
      locale,
      session: 'in',
      params: { returnTo: 'back' },
      queryData: [[profileKeys.own, profileFixture({ gender: null })]],
    });
    try {
      expect(screen.getByTestId('complete-profile.gender')).toBeTruthy();
      expect(checked(screen.getByTestId('complete-profile.gender.female'))).toBe(false);
      expect(checked(screen.getByTestId('complete-profile.gender.male'))).toBe(false);
      // The phone and name are there: the body asks only for the one answer.
      expect(screen.getByText(t('guestGender.completeBody'))).toBeTruthy();
      expect(within(screen.getByTestId('complete-profile.gender.female')).getByText(t('matches.gender.female'))).toBeTruthy();

      fireEvent.press(screen.getByTestId('complete-profile.submit'));
      expect(screen.getByText(t('guestGender.required'))).toBeTruthy();

      fireEvent.press(screen.getByTestId('complete-profile.gender.male'));
      expect(checked(screen.getByTestId('complete-profile.gender.male'))).toBe(true);
      expect(screen.queryByText(t('guestGender.required'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('saves the profile, then the gender once', async () => {
    jest
      .spyOn(supabase.auth, 'getUser')
      .mockResolvedValue({ data: { user: { id: profileFixture().id } }, error: null } as never);
    const update = jest.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const query: Record<string, unknown> = {};
    query.update = update;
    query.select = () => query;
    query.eq = () => query;
    query.maybeSingle = () => Promise.resolve({ data: profileFixture({ gender: 'female' }), error: null });
    jest.spyOn(supabase, 'from').mockReturnValue(query as never);
    const rpc = jest.fn((_name: string, _args?: unknown) =>
      Promise.resolve({ data: { gender: 'female', duplicate: false }, error: null }),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });

    const screen = renderRoute(CompleteProfileScreen, {
      locale,
      session: 'in',
      params: { returnTo: 'back' },
      queryData: [[profileKeys.own, profileFixture({ gender: null })]],
    });
    try {
      fireEvent.press(screen.getByTestId('complete-profile.gender.female'));
      await act(async () => {
        fireEvent.press(screen.getByTestId('complete-profile.submit'));
      });
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_my_gender', { p_gender: 'female' }));
      expect(update).toHaveBeenCalled();
      expect(rpc.mock.calls.filter(([name]) => name === 'set_my_gender')).toHaveLength(1);
    } finally {
      screen.unmount();
    }
  });

  it('a set gender is not asked again', () => {
    const screen = renderRoute(CompleteProfileScreen, {
      locale,
      session: 'in',
      params: { returnTo: 'back' },
      queryData: [[profileKeys.own, profileFixture({ phone: null, gender: 'male' })]],
    });
    try {
      expect(screen.getByTestId('complete-profile.submit')).toBeTruthy();
      expect(screen.queryByTestId('complete-profile.gender')).toBeNull();
      expect(screen.getByText(t('auth.completeProfileBody'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('sign up asks it under the name and refuses without it', () => {
    const screen = renderRoute(SignUpScreen, { locale });
    try {
      const picker = screen.getByTestId('sign-up.gender');
      expect(picker).toBeTruthy();
      fireEvent.changeText(screen.getByTestId('sign-up.first-name'), 'Sara');
      fireEvent.changeText(screen.getByTestId('sign-up.last-name'), 'Ali');
      fireEvent.press(screen.getByTestId('sign-up.submit'));
      expect(screen.getByText(t('guestGender.required'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('sign-up.gender.female'));
      expect(screen.queryByText(t('guestGender.required'))).toBeNull();
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
