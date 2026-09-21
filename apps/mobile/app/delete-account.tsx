import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useBack } from '../src/navigation/back';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { supabase } from '../src/lib/supabase';
import { deleteAccount, revokeAppleAuthorization } from '../src/features/profile/api';
import {
  DeletionCancelledError,
  confirmationMatches,
  hasAppleIdentity,
  runAccountDeletion,
  type AppleReauth,
} from '../src/features/profile/deletion';
import { requestAppleAuthorizationCode } from '../src/features/auth/providers/apple';
import { SocialAuthError } from '../src/features/auth/social';
import { purgeLocalIdentity } from '../src/features/profile/localPurge';
import { secureKeysToPurge } from '../src/features/profile/purgeKeys';
import { unregisterPushTokenLocally } from '../src/features/profile/push';
import { clearAllCaches } from '../src/lib/queryClient';
import { mapErrorToKey } from '../src/features/booking/errors';
import { addBreadcrumb, captureException } from '../src/lib/telemetry';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Screen } from '../src/components/ui';

/**
 * Delete account (SEC-16). Both stores require this to be reachable from INSIDE
 * the app — a support email or a web form does not satisfy either review — and
 * `app.delete_my_account` (migration 0077) has existed since 2026-09-07 with
 * nothing on any screen calling it.
 *
 * WHAT THE USER IS AGREEING TO, said plainly and before the field: the account
 * and their name and number go; the bookings themselves stay on the venue's
 * books without a person attached, because the venue's accounts have to keep
 * adding up. Saying so is not legal boilerplate — a guest who expects their
 * booking history to vanish and later sees a court still reserved has been
 * misled by omission.
 *
 * WHY A TYPED CONFIRMATION RATHER THAN A DIALOG. Sign-out uses Alert.alert and
 * that is right for sign-out: it is undoable. This is not. A native alert's
 * destructive button is one thumb-fall away from the row that opened it, and
 * `Alert` is exactly what a mis-tap dismisses by muscle memory. Typing a word
 * cannot be done by accident. The word is LOCALISED — an Arabic-first app must
 * not make its guest transliterate a Latin word to close their account.
 *
 * SIGN IN WITH APPLE (Guideline 5.1.1(v)). On iOS, an account with an Apple
 * identity sees the Apple sheet after pressing delete; its one-time code goes
 * to the apple-revoke function BEFORE the account is deleted. Cancelling the
 * sheet deletes nothing; any other Apple failure still deletes the account
 * (deletion.ts, step 0).
 */

/** The Apple sheet, with a cancel told apart from a failure. */
async function reauthAppleForDeletion(): Promise<AppleReauth> {
  try {
    return { status: 'code', authorizationCode: await requestAppleAuthorizationCode() };
  } catch (err) {
    if (err instanceof SocialAuthError && err.code === 'CANCELLED') return { status: 'cancelled' };
    throw err;
  }
}

function DeleteAccountScreen() {
  const { t } = useLocale();
  const router = useRouter();
  // Never router.back(): this screen is one tap from a deep-linked Profile with
  // no history beneath it, and back() is a silent no-op there (navigation/back.ts).
  const back = useBack();
  const { colors, fonts } = useTheme();
  const { session } = useAuth();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const word = t('profile.deleteConfirmWord');
  const armed = confirmationMatches(typed, word);
  const appleUser = hasAppleIdentity(session?.user);
  // Apple is iOS-only (D2): Android cannot show the sheet, so revocation is
  // skipped there and the audit row's apple_revoke_pending is the record.
  const canReauthApple = Platform.OS === 'ios';

  const onDelete = async () => {
    if (!armed || busy) return;
    setError(null);
    setBusy(true);
    // Captured BEFORE the delete: the session is gone by the time the local
    // purge runs, and `tp.historyClearedAt.<uid>` can only be named with it.
    const userId = session?.user.id ?? null;
    addBreadcrumb('account.delete.start');
    try {
      const outcome = await runAccountDeletion({
        deleteServerSide: () => deleteAccount(supabase),
        unregisterPush: unregisterPushTokenLocally,
        purgeSecureKeys: () =>
          purgeLocalIdentity({ supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL, userId }),
        clearCaches: clearAllCaches,
        // purgeLocalIdentity builds its own list; this is what it will sweep,
        // reported so a failure names the store rather than just "local".
        secureKeys: secureKeysToPurge(process.env.EXPO_PUBLIC_SUPABASE_URL),
        hasAppleIdentity: appleUser,
        reauthApple: canReauthApple ? reauthAppleForDeletion : undefined,
        revokeApple: canReauthApple
          ? (authorizationCode) => revokeAppleAuthorization(supabase, authorizationCode)
          : undefined,
      });

      addBreadcrumb('account.delete.done', {
        appleRevoke: outcome.appleRevoke,
        appleRevokePending: outcome.appleRevokePending,
        failures: outcome.failures,
      });
      // The account is gone either way; the tracker needs to see Apple refusing
      // (e.g. NOT_CONFIGURED, invalid_client) because the store obligation is unmet.
      if (outcome.appleRevoke === 'failed') {
        captureException(new Error(`account deletion: Apple revocation failed (${outcome.appleRevokeError ?? 'unknown'})`), {
          scope: 'account.delete.apple',
        });
      }
      // The account is gone whatever these say; they are for the tracker, not
      // the guest, who has no action left to take (SEC-36).
      if (outcome.failures.length > 0) {
        captureException(new Error(`account deletion: local cleanup incomplete`), {
          scope: 'account.delete',
          failures: outcome.failures,
        });
      }

      // Straight to the signed-out root, not back(): every screen beneath this
      // one is gated and would flash its redirect on the way past.
      router.replace('/welcome');
    } catch (err) {
      if (err instanceof DeletionCancelledError) {
        // The guest backed out of the Apple sheet. Not an error for the tracker.
        addBreadcrumb('account.delete.apple_cancelled');
        setError(t('profile.deleteAppleCancelled'));
        setBusy(false);
        return;
      }
      // The server refused and NOTHING on the device has been touched — the
      // guest still has their account and can simply press the button again.
      captureException(err, { scope: 'account.delete' });
      setError(t(mapErrorToKey(err)));
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.deleteAccount') }} />
      <FormScreen contentStyle={{ paddingTop: 4 }}>
        <View
          style={{
            backgroundColor: colors.redtint,
            borderColor: colors.redline,
            borderWidth: 1,
            borderRadius: radius.card,
            padding: space.m,
            marginBottom: space.m,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 13,
              lineHeight: 20,
              color: colors.redtext,
            }}
          >
            {t('profile.deleteHeading')}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 12.5,
              lineHeight: 20,
              color: colors.redtext,
              marginTop: 8,
            }}
          >
            {t('profile.deleteBody')}
          </Text>
        </View>

        {appleUser && canReauthApple ? (
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 12.5,
              lineHeight: 20,
              color: colors.mut,
              marginBottom: space.m,
            }}
          >
            {t('profile.deleteAppleNote')}
          </Text>
        ) : null}

        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12.5,
            lineHeight: 20,
            color: colors.mut,
            marginBottom: 8,
          }}
        >
          {t('profile.deleteTypePrompt', { word })}
        </Text>

        <Field
          testID="delete-account.confirm-word"
          placeholder={word}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          dense
          accessibilityLabel={t('profile.deleteTypePrompt', { word })}
        />

        <ErrorText>{error}</ErrorText>

        <Button
          testID="delete-account.confirm"
          label={t('profile.deleteAccount')}
          variant="danger"
          busy={busy}
          disabled={!armed}
          onPress={() => void onDelete()}
          style={{ marginTop: 6 }}
        />
        <Button
          testID="delete-account.cancel"
          label={t('common.cancel')}
          variant="ghost"
          size="medium"
          disabled={busy}
          onPress={back}
          style={{ marginTop: 4 }}
        />
      </FormScreen>
    </Screen>
  );
}

/**
 * On the ROOT stack, so UIKit draws its own animated back item — same reason
 * change-password is, and the same explicit session guard as a result.
 */
export default function GuardedDeleteAccountScreen() {
  return (
    <RequireSession>
      <DeleteAccountScreen />
    </RequireSession>
  );
}
