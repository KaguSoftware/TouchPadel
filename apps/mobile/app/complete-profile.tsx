import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import type { Locale } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { needsProfileCompletion, prefillDisplayName } from '../src/features/auth/social';
import { useOwnProfile, useUpdateProfile } from '../src/features/profile/hooks';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { clearPendingSlot } from '../src/features/booking/pendingSlot';
import { mapErrorToKey } from '../src/features/booking/errors';
import { space } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FormScreen,
  Hint,
  MicroLabel,
  Screen,
  SegmentedControl,
  Title,
  useSafeBack,
} from '../src/components/ui';
import { useToast } from '../src/components/overlays';
import { ErrorState, SkeletonList } from '../src/components/states';

type ReturnTo = 'continue' | 'back';

/**
 * Complete your profile (owner decision D3, 2026-09-01). A social sign-in creates
 * a profile with NO phone — Apple and Google carry none — while the phone is a
 * required profile field (spec 05.3: the desk calls it about the booking). One
 * screen, two entry modes:
 *
 *   returnTo=continue  post-sign-in / availability tap: save -> continueAfterAuth()
 *                      (pending slot -> hold -> Review; else the tabs).
 *   returnTo=back      Review's "Add phone number" / the Profile nudge: save -> back.
 *
 * Lives in the (auth) group and is exempt from its signed-in redirect; the same
 * layout sends any signed-in user with a blank phone here from DERIVED state, so
 * a first social sign-in cannot race past it (see (auth)/_layout.tsx).
 */
export default function CompleteProfileScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const safeBack = useSafeBack();
  const toast = useToast();
  const { session, initializing } = useAuth();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo: ReturnTo = params.returnTo === 'back' ? 'back' : 'continue';
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [lang, setLang] = useState<Locale>(locale);
  const [initialised, setInitialised] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skipped = useRef(false);

  const email = session?.user.email ?? null;
  const nameTouched = useRef(false);
  useEffect(() => {
    if (!profile.data) return;
    if (!initialised) {
      setPhone(profile.data.phone ?? '');
      setLang(locale);
      setInitialised(true);
    }
    // The name keeps following the row until the guest types: the Apple
    // first-authorization name patch can land AFTER the first read (the (auth)
    // layout routes here from that read; useSocialSignIn patches the name a
    // moment later and updates this cache entry). Hide the trigger's
    // email-local-part fallback so the field shows its placeholder, not 'k3x9q2'.
    if (!nameTouched.current) setName(prefillDisplayName(profile.data.full_name, email));
  }, [profile.data, initialised, email, locale]);

  // Safety net with ONE legitimate trigger: the (auth) layout can route here from
  // a STALE persisted cache row (phone null) that the mount refetch then corrects
  // — this lets that guest through without re-saving. Every other route in
  // 'continue' mode comes from a known-incomplete row, and onSave marks `skipped`
  // before saving so the save's own refetch can never re-fire it.
  useEffect(() => {
    if (returnTo !== 'continue' || skipped.current || !profile.data) return;
    if (!needsProfileCompletion(profile.data)) {
      skipped.current = true;
      continueAfterAuth();
    }
  }, [returnTo, profile.data, continueAfterAuth]);

  const onBack = () => {
    if (returnTo === 'back') {
      safeBack();
      return;
    }
    // NEVER a plain pop in 'continue' mode: RequireNoSession would send an
    // incomplete profile straight back here — a trap. Browsing stays open; the
    // gate reappears at the next booking attempt (availability / Review).
    clearPendingSlot();
    router.replace('/(tabs)');
  };

  // The header's back item and the edge-swipe are the SYSTEM's now (the screen
  // sits on the root stack), so the 'continue'-mode escape hatch has to block
  // the pop rather than own a button — same approach as profile-edit. Released
  // once the slot is cleared, then `onBack` performs the replace itself.
  const [leaving, setLeaving] = useState(false);
  const blockPop = returnTo === 'continue' && !leaving;

  // NOT `usePreventRemove`: registering the route as prevented makes
  // NativeStackView force `headerBackButtonMenuEnabled: false`, which
  // react-native-screens turns into a plain UIBarButtonItem — a bordered
  // capsule with no chevron, in the default tint. Listening to `beforeRemove`
  // gives the same interception (it is the event that hook wraps) while the
  // back item stays UIKit's own. See profile-edit for the full note.
  // `onBack` is rebuilt every render, so the listener reads it through a ref —
  // subscribing on it directly would tear down and re-add the listener on each
  // render, and could drop the event mid-gesture.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!blockPop) return;
    return navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      setLeaving(true);
      onBackRef.current();
    });
  }, [navigation, blockPop]);

  if (!initializing && !session) return <Redirect href="/welcome" />;

  const onSave = () => {
    setError(null);
    setNameError(null);
    setPhoneError(null);
    if (!name.trim()) return setNameError(t('auth.nameRequired'));
    if (!phone.trim()) return setPhoneError(t('auth.phoneRequired'));
    // The save's own invalidation refetches the profile while this screen is still
    // mounted; without this the auto-continue effect above would fire a SECOND
    // continueAfterAuth() (a duplicate hold_slot, or a replace to the tabs that
    // pulls the guest off Review). The save path navigates itself below.
    skipped.current = true;
    update.mutate(
      { full_name: name.trim(), phone: phone.trim() },
      {
        onSuccess: async () => {
          // ALWAYS, even when unchanged: a new OAuth row has preferred_lang 'en'
          // by trigger default even while the app runs in Arabic. setLocale
          // writes profiles.preferred_lang; direction reconciles on next launch.
          await setLocale(lang, { flip: false });
          if (returnTo === 'back') {
            toast(t('profile.updated'));
            safeBack();
          } else {
            toast(t('auth.welcomeToApp'));
            continueAfterAuth();
          }
        },
        onError: (err) => setError(t(mapErrorToKey(err))),
      },
    );
  };

  return (
    <Screen gutter={20}>
      <Stack.Screen options={{ title: t('auth.completeProfileTitle') }} />
      {profile.isPending && !initialised ? (
        <SkeletonList rows={3} height={64} />
      ) : profile.isError && !initialised ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(profile.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void profile.refetch()}
          busy={profile.isRefetching}
        />
      ) : (
        <FormScreen>
          <Title plain>{t('auth.completeProfileTitle')}</Title>
          <Hint style={{ marginTop: 8 }}>{t('auth.completeProfileBody')}</Hint>
          <Field
            label={t('profile.name')}
            value={name}
            onChangeText={(v) => {
              nameTouched.current = true;
              setName(v);
            }}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            dense
            error={nameError}
          />
          <Field
            label={t('auth.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            dense
            error={phoneError}
          />
          <Hint>{t('auth.phoneRationale')}</Hint>
          <View style={{ marginTop: space.sm }}>
            <MicroLabel style={{ marginBottom: 5 }}>{t('auth.preferredLanguage')}</MicroLabel>
            <SegmentedControl<Locale>
              options={[
                { value: 'en', label: t('settings.english') },
                { value: 'ar', label: t('settings.arabic') },
              ]}
              value={lang}
              onChange={setLang}
            />
          </View>
          <ErrorText>{error}</ErrorText>
          <Button
            label={t('auth.completeProfileCta')}
            variant="cta"
            busy={update.isPending || holdBusy}
            onPress={onSave}
            style={{ marginTop: space.l }}
          />
        </FormScreen>
      )}
    </Screen>
  );
}
