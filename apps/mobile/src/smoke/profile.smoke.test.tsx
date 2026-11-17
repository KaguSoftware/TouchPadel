/**
 * The four screens behind the Profile tab.
 *
 * `settings` is the awkward one: it reads push state through dynamic imports
 * and the venue's number through a query, so it has more to settle before a
 * first paint than any other form in the app. See
 * `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { isolate, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { loyaltyKeys } from '../features/loyalty/keys';
import { parseMyLoyalty } from '../features/loyalty/logic';
import {
  TEST_VENUE_ID,
  branchFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { profileKeys } from '../features/profile/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import SettingsScreen from '../../app/settings';
import ProfileEditScreen from '../../app/profile-edit';
import ChangePasswordScreen from '../../app/change-password';
import DeleteAccountScreen from '../../app/delete-account';
import AcceptTermsScreen from '../../app/accept-terms';
import TermsReviewScreen from '../../app/terms-review';

const SIGNED_IN: [readonly unknown[], unknown][] = [
  [profileKeys.own, profileFixture()],
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
];

const CASES: SmokeCase[] = [
  {
    route: 'settings',
    Component: SettingsScreen,
    // A SegmentedControl track: it carries the id and no text of its own, so
    // the language assertion lands on the option the guest would tap. In
    // Arabic that option still reads "English" — `pinOrder` holds the pair in
    // place — which is exactly what `t('settings.english')` returns in both.
    nearbyKey: 'settings.arabic',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'profile-edit',
    Component: ProfileEditScreen,
    labelKey: 'profile.nameSection',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'change-password',
    Component: ChangePasswordScreen,
    labelKey: 'profile.updatePassword',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'delete-account',
    Component: DeleteAccountScreen,
    // MOUNTED but disabled until the confirmation word is typed — which is the
    // state worth smoking: the screen must offer the action and refuse it.
    labelKey: 'profile.deleteAccount',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'accept-terms',
    Component: AcceptTermsScreen,
    // Mounted but disabled until the consent checkbox is ticked — the gate must
    // offer acceptance and refuse it unticked.
    labelKey: 'consent.accept',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'terms-review',
    Component: TermsReviewScreen,
    // Read-only viewer opened from the consent links; Close is its one action.
    labelKey: 'common.close',
  },
];

runSmokeCases('profile screens', CASES);

/** 0445: the frames a guest on the Green card reads (`app.my_frames`). */
const GREEN = { tier_id: 't-green', name_en: 'Touch Padel green', name_ar: 'تتش بادل الأخضر', color: 'green' };
const BLUE = { tier_id: 't-blue', name_en: 'Touch Padel blue', name_ar: 'تتش بادل الأزرق', color: 'blue' };
const FRAMES = {
  current: 'brand-green',
  style: 'solid',
  played: 0,
  tournaments_won: 0,
  frames: [
    ...['brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line'].map((id) => ({ id, unlocked: true, goal: null, progress: null })),
    { id: 'regular', unlocked: false, goal: 10, progress: 0 },
    { id: 'silver-racket', unlocked: false, goal: 50, progress: 0 },
    { id: 'gold-racket', unlocked: false, goal: 100, progress: 0 },
    { id: 'champion', unlocked: false, goal: 1, progress: 0 },
    { id: 'card-green', unlocked: true, goal: null, progress: null, card: GREEN },
    { id: 'card-blue', unlocked: false, goal: null, progress: null, card: BLUE },
    // No card unlocks the black ring: it is not on offer.
    { id: 'card-black', unlocked: false, goal: null, progress: null, card: null },
  ],
};

for (const locale of ['en', 'ar'] as Locale[]) {
  describe(`card rings and the birthday note in ${locale} (0445)`, () => {
    const t = makeT(locale);

    it('the frame picker offers the card rings some card unlocks, a locked one with its card', () => {
      const screen = renderRoute(ProfileEditScreen, {
        locale,
        session: 'in',
        params: { section: 'frame' },
        queryData: [...SIGNED_IN, [profileKeys.frames, FRAMES]],
      });
      try {
        expect(screen.getByText(t('profile.frameCard'))).toBeTruthy();
        const green = screen.getByTestId('profile-edit.frame.card-green');
        expect(within(green).getByText(t('profile.frameCardGreen'))).toBeTruthy();
        expect(green.props.accessibilityState).toMatchObject({ disabled: false });
        const blue = screen.getByTestId('profile-edit.frame.card-blue');
        expect(blue.props.accessibilityState).toMatchObject({ disabled: true });
        expect(
          within(blue).getByText(
            t('profile.frameCardRule', { card: isolate(locale === 'ar' ? BLUE.name_ar : BLUE.name_en) }),
          ),
        ).toBeTruthy();
        expect(screen.queryByTestId('profile-edit.frame.card-black')).toBeNull();
      } finally {
        screen.unmount();
      }
    });

    it('a server before 0445 shows no card section', () => {
      const screen = renderRoute(ProfileEditScreen, {
        locale,
        session: 'in',
        params: { section: 'frame' },
        queryData: [...SIGNED_IN, [profileKeys.frames, { ...FRAMES, frames: FRAMES.frames.slice(0, 9) }]],
      });
      try {
        expect(screen.queryByText(t('profile.frameCard'))).toBeNull();
        expect(screen.queryByTestId('profile-edit.frame.card-green')).toBeNull();
      } finally {
        screen.unmount();
      }
    });

    it('the date of birth notes the 30 days only while some card carries a birthday gift', () => {
      const ladder = (perks: unknown[]) =>
        parseMyLoyalty({
          enabled: true,
          tiers: [{ id: 't-green', name_en: 'Green', name_ar: 'الأخضر', min_points_12m: 250, color: 'green', perks, deals: [] }],
        });
      const gift = { id: 'g', kind: 'gift', name_en: 'A drink', name_ar: 'مشروب', config: { days: 7 } };
      const withGift = renderRoute(ProfileEditScreen, {
        locale,
        session: 'in',
        queryData: [...SIGNED_IN, [loyaltyKeys.mine, ladder([gift])]],
      });
      try {
        const row = withGift.getByTestId('profile-edit.birth-date');
        expect(within(row).getByText(t('profile.birthGiftNote'))).toBeTruthy();
      } finally {
        withGift.unmount();
      }
      const without = renderRoute(ProfileEditScreen, {
        locale,
        session: 'in',
        queryData: [...SIGNED_IN, [loyaltyKeys.mine, ladder([])]],
      });
      try {
        expect(without.queryByText(t('profile.birthGiftNote'))).toBeNull();
      } finally {
        without.unmount();
      }
    });
  });
}
