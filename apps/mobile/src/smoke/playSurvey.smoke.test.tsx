/**
 * The sign-up play survey (play-coaches contracts §8): the sheet as a route
 * case, then its steps, its edit mode, Edit profile's "Your game" row and the
 * Play tab's "For you" strip, in EN and AR. The play profile is seeded on the
 * own-profile row (`profileKeys.own`), which is where the app reads it.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { supabase } from '../lib/supabase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { TEST_VENUE_ID, branchFixture, profileFixture, venueSettingsFixture } from '../test/fixtures';
import { profileKeys } from '../features/profile/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import { ForYouStrip } from '../components/forYou';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ASK_DISMISSED_KEY, __resetAskDismissed } from '../features/playProfile/askDismissed';
import PlaySurveyScreen from '../../app/play-survey';
import ProfileEditScreen from '../../app/profile-edit';
import { onlinePaymentsOnForFile } from '../test/onlinePaymentsEnv';

onlinePaymentsOnForFile();

type Seeds = [readonly unknown[], unknown][];

const NEVER_ASKED = { play_level: null, play_years: null, play_wants: null, play_survey_at: null };
const ANSWERED = {
  play_level: 'intermediate',
  play_years: 'one_to_three',
  play_wants: ['lessons'],
  play_survey_at: '2026-10-11T18:00:00.000Z',
};

const seeds = (play: Record<string, unknown>): Seeds => [
  [profileKeys.own, { ...profileFixture(), ...play }],
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
];

const Strip = () => <ForYouStrip testID="play.for-you" surface="play" />;

/**
 * The writes a test's rpc spy saw, in order. The sheet also reads the tournament list (0339:
 * a tournament suggestion only while one fits), which is not a save.
 */
const saves = (rpc: { mock: { calls: unknown[][] } }) =>
  rpc.mock.calls.map(([name]) => name).filter((name) => name !== 'tournaments_public');

runSmokeCases('play survey', [
  {
    route: 'play-survey',
    Component: PlaySurveyScreen,
    labelKey: 'playProfile.survey.skip',
    options: { session: 'in', queryData: seeds(NEVER_ASKED) },
  },
]);

describe.each<Locale>(['en', 'ar'])('play survey in %s', (locale) => {
  const t = makeT(locale);

  it('asks the level first, and one tap moves on to how long they have played', async () => {
    const screen = renderRoute(PlaySurveyScreen, { locale, session: 'in', queryData: seeds(NEVER_ASKED) });
    try {
      expect(screen.getByText(t('playProfile.survey.level.question'))).toBeTruthy();
      expect(screen.getByText(t('playProfile.survey.intro'))).toBeTruthy();
      expect(screen.queryByTestId('play-survey.back')).toBeNull();
      fireEvent.press(screen.getByTestId('play-survey.level.beginner'));
      await waitFor(() => expect(screen.getByTestId('play-survey.years.never')).toBeTruthy());
      expect(screen.getByText(t('playProfile.survey.years.question'))).toBeTruthy();
      expect(screen.getByTestId('play-survey.back')).toBeTruthy();
      expect(screen.getByTestId('play-survey.skip')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('after Advanced, "Not yet" cannot be picked and says why', async () => {
    const screen = renderRoute(PlaySurveyScreen, { locale, session: 'in', queryData: seeds(NEVER_ASKED) });
    try {
      fireEvent.press(screen.getByTestId('play-survey.level.advanced'));
      await waitFor(() => expect(screen.getByTestId('play-survey.years.never')).toBeTruthy());
      const never = screen.getByTestId('play-survey.years.never');
      expect(never.props.accessibilityState).toMatchObject({ disabled: true });
      expect(
        within(never).getByText(
          t('playProfile.survey.years.notWithLevel', { level: t('playProfile.survey.level.advanced.title') }),
        ),
      ).toBeTruthy();
      fireEvent.press(never);
      expect(never.props.accessibilityState).toMatchObject({ selected: false });
      expect(screen.getByTestId('play-survey.years.under-one').props.accessibilityState).toMatchObject({
        disabled: false,
      });
    } finally {
      screen.unmount();
    }
  });

  it('a saved Advanced with "Not yet" asks how long again', () => {
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      params: { mode: 'edit' },
      queryData: seeds({ ...ANSWERED, play_level: 'advanced', play_years: 'never' }),
    });
    try {
      fireEvent.press(screen.getByTestId('play-survey.next'));
      expect(screen.getByTestId('play-survey.years.never').props.accessibilityState).toMatchObject({
        selected: false,
        disabled: true,
      });
      // Unanswered again, so there is no Next until a fitting answer is picked.
      expect(screen.queryByTestId('play-survey.next')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('Skip closes the sheet at once', () => {
    const screen = renderRoute(PlaySurveyScreen, { locale, session: 'in', queryData: seeds(NEVER_ASKED) });
    try {
      fireEvent.press(screen.getByTestId('play-survey.skip'));
      expect(routerState.calls.some((c) => c.method === 'back' || c.method === 'replace')).toBe(true);
    } finally {
      screen.unmount();
    }
  });

  it('edit mode is prefilled, offers Cancel instead of Skip, and keeps an answer with Next', () => {
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      params: { mode: 'edit' },
      queryData: seeds(ANSWERED),
    });
    try {
      expect(within(screen.getByTestId('play-survey.skip')).getByText(t('common.cancel'))).toBeTruthy();
      expect(screen.queryByText(t('playProfile.survey.intro'))).toBeNull();
      expect(screen.getByTestId('play-survey.level.intermediate').props.accessibilityState).toMatchObject({
        selected: true,
      });
      fireEvent.press(screen.getByTestId('play-survey.next'));
      expect(screen.getByTestId('play-survey.years.one-to-three')).toBeTruthy();
      fireEvent.press(screen.getByTestId('play-survey.next'));
      expect(screen.getByTestId('play-survey.wants.lessons').props.accessibilityState).toMatchObject({
        checked: true,
      });
      expect(within(screen.getByTestId('play-survey.done')).getByText(t('common.save'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('asks the gender last while the profile has none, and Done saves both answers', async () => {
    const rpc = jest.fn((name: string, _args?: unknown) =>
      Promise.resolve({
        data:
          name === 'set_my_play_profile'
            ? { ...ANSWERED, play_level: 'new', play_years: 'never', play_wants: ['matches'] }
            : { gender: 'female', duplicate: false },
        error: null,
      }),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      queryData: seeds({ ...NEVER_ASKED, gender: null }),
    });
    try {
      fireEvent.press(screen.getByTestId('play-survey.level.new'));
      await waitFor(() => expect(screen.getByTestId('play-survey.years.never')).toBeTruthy());
      fireEvent.press(screen.getByTestId('play-survey.years.never'));
      await waitFor(() => expect(screen.getByTestId('play-survey.wants.matches')).toBeTruthy());
      fireEvent.press(screen.getByTestId('play-survey.wants.matches'));
      // Wants is no longer the last question: Next, not Done.
      expect(screen.queryByTestId('play-survey.done')).toBeNull();
      fireEvent.press(screen.getByTestId('play-survey.next'));

      expect(screen.getByText(t('playProfile.survey.gender.question'))).toBeTruthy();
      expect(screen.getByText(t('playProfile.survey.gender.hint'))).toBeTruthy();
      // A gender is a must (0353): there is no "prefer not to say".
      expect(screen.queryByTestId('play-survey.gender.none')).toBeNull();
      // A tap only chooses: the answer is set once, so it waits for Done.
      fireEvent.press(screen.getByTestId('play-survey.gender.female'));
      expect(saves(rpc)).toEqual([]);
      expect(screen.getByTestId('play-survey.gender.female').props.accessibilityState).toMatchObject({
        selected: true,
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('play-survey.done'));
      });
      await waitFor(() =>
        expect(saves(rpc)).toEqual(['set_my_play_profile', 'set_my_gender']),
      );
      expect(rpc).toHaveBeenCalledWith('set_my_gender', { p_gender: 'female' });
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('no gender answer saves the play answers and writes no gender (the gate asks later)', async () => {
    const rpc = jest.fn((_name: string, _args?: unknown) =>
      Promise.resolve({ data: { ...NEVER_ASKED, play_survey_at: ANSWERED.play_survey_at }, error: null }),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      params: { mode: 'edit' },
      queryData: seeds({ ...ANSWERED, gender: null }),
    });
    try {
      fireEvent.press(screen.getByTestId('play-survey.next'));
      fireEvent.press(screen.getByTestId('play-survey.next'));
      fireEvent.press(screen.getByTestId('play-survey.next'));
      await act(async () => {
        fireEvent.press(screen.getByTestId('play-survey.done'));
      });
      await waitFor(() => expect(saves(rpc)).toEqual(['set_my_play_profile']));
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('never asks a gender the profile already has', () => {
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      params: { mode: 'edit' },
      queryData: seeds({ ...ANSWERED, gender: 'male' }),
    });
    try {
      fireEvent.press(screen.getByTestId('play-survey.next'));
      fireEvent.press(screen.getByTestId('play-survey.next'));
      // Wants is the last question again.
      expect(within(screen.getByTestId('play-survey.done')).getByText(t('common.save'))).toBeTruthy();
      expect(screen.queryByTestId('play-survey.gender.female')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('step=gender (a match or tournament needs it) asks the gender alone and saves only that', async () => {
    const rpc = jest.fn((_name: string, _args?: unknown) =>
      Promise.resolve({ data: { gender: 'male', duplicate: false }, error: null }),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      params: { step: 'gender' },
      queryData: seeds({ ...ANSWERED, gender: null }),
    });
    try {
      expect(screen.getByText(t('playProfile.survey.gender.question'))).toBeTruthy();
      expect(screen.queryByTestId('play-survey.back')).toBeNull();
      expect(within(screen.getByTestId('play-survey.skip')).getByText(t('common.cancel'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('play-survey.gender.male'));
      expect(within(screen.getByTestId('play-survey.done')).getByText(t('common.save'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId('play-survey.done'));
      });
      await waitFor(() => expect(saves(rpc)).toEqual(['set_my_gender']));
      await waitFor(() =>
        expect(routerState.calls.some((c) => c.method === 'back' || c.method === 'replace')).toBe(true),
      );
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('Edit profile carries a "Your game" row that opens the sheet in edit mode', () => {
    const screen = renderRoute(ProfileEditScreen, { locale, session: 'in', queryData: seeds(ANSWERED) });
    try {
      const row = screen.getByTestId('profile-edit.play-profile');
      expect(within(row).getByText(t('playProfile.row.label'))).toBeTruthy();
      expect(
        within(row).getByText(
          `${t('playProfile.survey.level.intermediate.title')} · ${t('playProfile.survey.years.one_to_three')}`,
        ),
      ).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/play-survey', params: { mode: 'edit' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('the For you strip ranks from the answers, keeps to what they are after, with each "why"', () => {
    const screen = renderRoute(Strip, { locale, session: 'in', queryData: seeds(ANSWERED) });
    try {
      const first = screen.getByTestId('play.for-you.matches');
      expect(within(first).getByText(t('playProfile.kind.matches'))).toBeTruthy();
      expect(within(first).getByText(t('playProfile.why.intermediate'))).toBeTruthy();
      // They are after lessons, not tournaments: coaches and group sessions, no Americano.
      expect(screen.queryByTestId('play.for-you.americano')).toBeNull();
      expect(screen.getByTestId('play.for-you.coaches')).toBeTruthy();
      expect(screen.getByTestId('play.for-you.classes')).toBeTruthy();
      fireEvent.press(first);
      expect(routerState.calls).toContainEqual({
        method: 'navigate',
        arg: { pathname: '/play', params: { show: 'matches' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('the For you strip offers group sessions alone without "What are you after?", and asks for it', () => {
    const screen = renderRoute(Strip, {
      locale,
      session: 'in',
      queryData: seeds({ ...ANSWERED, play_level: 'advanced', play_wants: null }),
    });
    try {
      expect(screen.getByTestId('play.for-you.classes')).toBeTruthy();
      expect(screen.queryByTestId('play.for-you.matches')).toBeNull();
      expect(screen.queryByTestId('play.for-you.mexicano')).toBeNull();
      const more = screen.getByTestId('play.for-you.more');
      expect(within(more).getByText(t('playProfile.forYou.moreHint'))).toBeTruthy();
      fireEvent.press(more);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/play-survey', params: { mode: 'edit', step: 'wants' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('step=wants opens the edit at "What are you after?"', () => {
    const screen = renderRoute(PlaySurveyScreen, {
      locale,
      session: 'in',
      params: { mode: 'edit', step: 'wants' },
      queryData: seeds(ANSWERED),
    });
    try {
      expect(screen.getByText(t('playProfile.survey.wants.question'))).toBeTruthy();
      expect(screen.getByTestId('play-survey.back')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the For you strip asks gently when never asked, and can be put away', async () => {
    // The flag outlives a render (it is the phone's): start each language fresh.
    await AsyncStorage.removeItem(ASK_DISMISSED_KEY);
    __resetAskDismissed();
    const screen = renderRoute(Strip, { locale, session: 'in', queryData: seeds(NEVER_ASKED) });
    try {
      const ask = await waitFor(() => screen.getByTestId('play.for-you.ask'));
      expect(within(ask).getByText(t('playProfile.forYou.askTitle'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId('play.for-you.ask-dismiss'));
      });
      expect(screen.queryByTestId('play.for-you.ask')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('the For you strip stays out of the way for a guest who skipped', () => {
    const screen = renderRoute(Strip, {
      locale,
      session: 'in',
      queryData: seeds({ ...NEVER_ASKED, play_survey_at: '2026-10-11T18:00:00.000Z' }),
    });
    try {
      expect(screen.queryByTestId('play.for-you.ask')).toBeNull();
      expect(screen.queryByTestId('play.for-you.play')).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});
