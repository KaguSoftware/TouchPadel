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
import { PhoneField } from '../src/components/phone';
import { composePhone, DEFAULT_ISO, parsePhone, validatePhone } from '../src/features/profile/phone';
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
  // Country + national digits in the form, E.164 on save — see components/phone.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
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
      const parsed = parsePhone(profile.data.phone);
      setIso(parsed.iso);
      setNational(parsed.national);
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

  // What follows a save — the toast, and continueAfterAuth — must speak the
  // language just chosen. setLocale resolves once that language has
  // committed, but onSuccess's closure still holds the `t`, `toast` and
  // `continueAfterAuth` of the render BEFORE the switch; so the step is
  // carried over in state and run from the first render in which `locale`
  // matches, where this effect reads the fresh ones from context.
  // The target is the language the save SENT, not the picker's live value: the
  // picker stays usable while the request is in flight, and a toggle then
  // would otherwise leave this waiting for a locale that never arrives.
  const [continuation, setContinuation] = useState<{ to: ReturnTo; lang: Locale } | null>(null);
  useEffect(() => {
    if (!continuation || locale !== continuation.lang) return;
    setContinuation(null);
    if (continuation.to === 'back') {
      toast(t('profile.updated'));
      safeBack();
    } else {
      toast(t('auth.welcomeToApp'));
      continueAfterAuth();
    }
  }, [continuation, locale, t, toast, safeBack, continueAfterAuth]);

  if (!initializing && !session) return <Redirect href="/welcome" />;

  const onSave = () => {
    setError(null);
    setNameError(null);
    setPhoneError(null);
    if (!name.trim()) return setNameError(t('auth.nameRequired'));
    const badPhone = validatePhone(iso, national);
    if (badPhone === 'PHONE_REQUIRED') return setPhoneError(t('auth.phoneRequired'));
    if (badPhone) return setPhoneError(t('auth.phoneInvalid'));
    // The save's own invalidation refetches the profile while this screen is still
    // mounted; without this the auto-continue effect above would fire a SECOND
    // continueAfterAuth() (a duplicate hold_slot, or a replace to the tabs that
    // pulls the guest off Review). The save path navigates itself below.
    skipped.current = true;
    update.mutate(
      { full_name: name.trim(), phone: composePhone(iso, national) },
      {
        onSuccess: async () => {
          // ALWAYS, even when unchanged: a new OAuth row has preferred_lang 'en'
          // by trigger default even while the app runs in Arabic. setLocale
          // writes profiles.preferred_lang and, when the choice differs from the
          // running language, switches the app in place. The step after it
          // runs from the effect above, in that language.
          await setLocale(lang);
          setContinuation({ to: returnTo, lang });
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
          <PhoneField
            label={t('auth.phoneLabel')}
            iso={iso}
            onChangeIso={setIso}
            national={national}
            onChangeNational={setNational}
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
              pinOrder
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
