/**
 * The sign-up play survey (play-coaches contracts §8): the sheet as a route
 * case, then its steps, its edit mode, Edit profile's "Your game" row and the
 * Play tab's "For you" strip, in EN and AR. The play profile is seeded on the
 * own-profile row (`profileKeys.own`), which is where the app reads it.
 */
import { describe, expect, it } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
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

  it('the For you strip ranks from the answers, with each "why"', () => {
    const screen = renderRoute(Strip, { locale, session: 'in', queryData: seeds(ANSWERED) });
    try {
      const first = screen.getByTestId('play.for-you.matches');
      expect(within(first).getByText(t('playProfile.kind.matches'))).toBeTruthy();
      expect(within(first).getByText(t('playProfile.why.intermediate'))).toBeTruthy();
      expect(screen.getByTestId('play.for-you.americano')).toBeTruthy();
      expect(screen.getByTestId('play.for-you.coaches')).toBeTruthy();
      fireEvent.press(first);
      expect(routerState.calls).toContainEqual({
        method: 'navigate',
        arg: { pathname: '/play', params: { show: 'matches' } },
      });
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
