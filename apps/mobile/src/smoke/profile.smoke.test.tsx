/**
 * The four screens behind the Profile tab.
 *
 * `settings` is the awkward one: it reads push state through dynamic imports
 * and the venue's number through a query, so it has more to settle before a
 * first paint than any other form in the app. See
 * `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 */
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { profileFixture, venueSettingsFixture } from '../test/fixtures';
import { profileKeys } from '../features/profile/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import SettingsScreen from '../../app/settings';
import ProfileEditScreen from '../../app/profile-edit';
import ChangePasswordScreen from '../../app/change-password';
import DeleteAccountScreen from '../../app/delete-account';

const SIGNED_IN: [readonly unknown[], unknown][] = [
  [profileKeys.own, profileFixture()],
  [availabilityKeys.settings, venueSettingsFixture()],
];

const CASES: SmokeCase[] = [
  {
    route: 'settings',
    Component: SettingsScreen,
    // A SegmentedControl track: it carries the id and no text of its own, so
    // the language assertion lands on the option the guest would tap. In
    // Arabic that option still reads "English" — `pinOrder` holds the pair in
    // place — which is exactly what `t('settings.english')` returns in both.
    primary: 'settings.language',
    nearbyKey: 'settings.arabic',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'profile-edit',
    Component: ProfileEditScreen,
    primary: 'profile-edit.save',
    labelKey: 'profile.saveChanges',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'change-password',
    Component: ChangePasswordScreen,
    primary: 'change-password.submit',
    labelKey: 'profile.updatePassword',
    options: { session: 'in', queryData: SIGNED_IN },
  },
  {
    route: 'delete-account',
    Component: DeleteAccountScreen,
    // MOUNTED but disabled until the confirmation word is typed — which is the
    // state worth smoking: the screen must offer the action and refuse it.
    primary: 'delete-account.confirm',
    labelKey: 'profile.deleteAccount',
    options: { session: 'in', queryData: SIGNED_IN },
  },
];

runSmokeCases('profile screens', CASES);
