import { useCallback, useEffect, useState } from 'react';
import { Redirect, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useRouter } from '../src/navigation/useRouter';
import type { Locale } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { needsProfileCompletion } from '../src/features/auth/social';
import {
  useAcceptTerms,
  useOwnConsent,
  useOwnProfile,
  useSetAgeBand,
  useSetBirthDate,
  useUpdateProfile,
} from '../src/features/profile/hooks';
import { consentAction } from '../src/features/profile/consent';
import { ConsentCheckbox } from '../src/features/profile/ConsentCheckbox';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { clearPendingIntents } from '../src/features/booking/pendingIntent';
import { mapErrorToKey, rpcErrorCode } from '../src/features/booking/errors';
import { markGenderAsked, signupGenderOf } from '../src/features/auth/genderGate';
import {
  getCompleteProfileDraft,
  patchCompleteProfileDraft,
  resetCompleteProfileDraft,
  useCompleteDraftField,
} from '../src/features/auth/completeProfileDraft';
import { signupAgeBandOf } from '../src/features/auth/ageBand';
import { captureException } from '../src/lib/telemetry';
import { parseAgeBand } from '../src/features/playProfile/logic';
import { useSetMyGender } from '../src/features/matches/hooks';
import { errorMessageOf } from '../src/lib/network';
import { BirthDatePicker } from '../src/components/BirthDatePicker';
import { ageBandOf } from '../src/features/playProfile/logic';
import { birthDateToLocalDate, isValidBirthDate } from '../src/features/profile/birthDate';
import { ScreenWithBar } from '../src/components/BottomBar';
import { FloatingField } from '../src/components/FloatingLabel';
import { GenderPicker } from '../src/components/GenderPicker';
import { space } from '../src/theme';
import {
  Button,
  Hint,
  Screen,
  Title,
} from '../src/components/ui';
import { useBack, useBackGuard } from '../src/navigation/back';
import { PhoneField } from '../src/components/phone';
import { composePhone, parsePhone, validatePhone } from '../src/features/profile/phone';
import { useToast } from '../src/components/overlays';
import { ErrorState, SkeletonList } from '../src/components/states';
import { NAME_PART_MAX, nameFieldsOf, namePatch } from '../src/features/profile/names';

type ReturnTo = 'continue' | 'back';

/** 0 name and birth date, 1 gender / phone / Terms; the last step saves. */
const LAST_STEP = 1;

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
 *
 * The gender (0353, Majed 2026-10-19: a must for every account) is asked here
 * while the profile has none: "Woman / Man", nothing picked at first (the
 * sign-up form's answer when the account carries one), and Save refuses until
 * one is. It is saved through app.set_my_gender after the profile update, set
 * once; GENDER_ALREADY_SET (another device answered first) goes on with the
 * stored value. The app-open ask (features/auth/useGenderGate.ts) opens this
 * screen in back mode, and its opening marks the account asked for the launch.
 *
 * The age band (0368, Majed 2026-10-24) is asked the same way while the
 * profile has none, so a social sign-in that never saw the sign-up form
 * answers it here. Unlike the gender it never blocks Save: no court hour
 * depends on it (features/auth/ageBand.ts), so a guest who leaves it is asked
 * again by the survey and by Edit profile.
 */
/** Flags the two steps share, read and written like a ref. */
const skipped = {
  get current() {
    return getCompleteProfileDraft().skipped;
  },
  set current(v: boolean) {
    patchCompleteProfileDraft({ skipped: v });
  },
};
const nameTouched = {
  get current() {
    return getCompleteProfileDraft().nameTouched;
  },
  set current(v: boolean) {
    patchCompleteProfileDraft({ nameTouched: v });
  },
};

export default function CompleteProfileScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  
  const toast = useToast();
  const { session, initializing } = useAuth();
  const params = useLocalSearchParams<{ returnTo?: string; step?: string }>();
  const step = Math.min(Math.max(Number(params.step) || 0, 0), LAST_STEP);
  // False while a later step is on top: the first step waits for it to pop.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const returnTo: ReturnTo = params.returnTo === 'back' ? 'back' : 'continue';
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const setMyGender = useSetMyGender();
  const setAgeBand = useSetAgeBand();
  const setBirth = useSetBirthDate();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  // Account creation for an Apple / Google sign-up: it never saw the sign-up
  // form, so this is where the Terms are agreed (and recorded on save). An
  // account that already accepted, or ticked at sign-up, is not asked.
  const user = session?.user ?? null;
  const consent = useOwnConsent(user && !user.is_anonymous ? user.id : null);
  const acceptTerms = useAcceptTerms();
  const needsTerms = consentAction(consent.data, user?.user_metadata) === 'ask';
  const [agreed, setAgreed] = useCompleteDraftField('agreed');

  const [firstName, setFirstName] = useCompleteDraftField('firstName');
  const [lastName, setLastName] = useCompleteDraftField('lastName');
  // Country + national digits in the form, E.164 on save — see components/phone.
  const [iso, setIso] = useCompleteDraftField('iso');
  const [national, setNational] = useCompleteDraftField('national');
  const [langDraft, setLang] = useCompleteDraftField('lang');
  const lang: Locale = langDraft ?? locale;
  const [initialised, setInitialised] = useCompleteDraftField('initialised');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gender, setGender] = useCompleteDraftField('gender');
  const [genderError, setGenderError] = useState<string | null>(null);
  const [band, setBand] = useCompleteDraftField('band');
  const [birthDate, setBirthDate] = useCompleteDraftField('birthDate');

  // Asked while the row has none; a set gender is the desk's to change.
  const askGender = !!profile.data && !profile.data.gender;
  // 0368: asked while the row has none. A server or a cached row without the
  // column reads as "not known", and then nothing is asked.
  const askAge =
    !!profile.data && 'age_band' in profile.data && parseAgeBand(profile.data.age_band) === null;
  // Only the gender is missing: the body says so instead of asking for a phone.
  const onlyGender =
    askGender && !!profile.data?.phone?.trim() && !!profile.data?.full_name?.trim();

  // Whoever sent the guest here, the app-open ask does not stack another on top.
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  useEffect(() => {
    if (uid) markGenderAsked(uid);
  }, [uid]);

  const metaGender = signupGenderOf(session?.user.user_metadata);
  const metaBand = signupAgeBandOf(session?.user.user_metadata);
  const email = session?.user.email ?? null;
  useEffect(() => {
    if (!profile.data) return;
    if (!initialised) {
      const parsed = parsePhone(profile.data.phone);
      setIso(parsed.iso);
      setNational(parsed.national);
      setLang(locale);
      // The sign-up form's answer, when the account carries one that has not
      // been recorded yet; otherwise nothing is picked.
      setGender(metaGender);
      setBand(metaBand);
      setInitialised(true);
    }
    // The name keeps following the row until the guest types: the Apple
    // first-authorization name patch can land AFTER the first read (the (auth)
    // layout routes here from that read; useSocialSignIn patches the name a
    // moment later and updates this cache entry). The parts are the server's
    // split of it (0256), with `full_name` as the fallback for a row cached
    // before them; the trigger's email-local-part fallback is hidden, so the
    // field shows its placeholder, not 'k3x9q2'.
    if (!nameTouched.current) {
      const names = nameFieldsOf(profile.data, email);
      setFirstName(names.first);
      setLastName(names.last);
    }
  }, [
    profile.data,
    initialised,
    email,
    locale,
    metaGender,
    metaBand,
    setIso,
    setNational,
    setLang,
    setGender,
    setBand,
    setInitialised,
    setFirstName,
    setLastName,
  ]);

  const back = useBack();

  /**
   * 'continue' mode has no ordinary way out: a plain pop would let
   * RequireNoSession send an incomplete profile straight back here, a trap. So
   * the departure is intercepted and turned into a replace — browsing stays
   * open, and the gate reappears at the next booking attempt (availability /
   * Review). 'back' mode needs no guard; the native back item already does the
   * right thing.
   *
   * The continuation lifts it (`leave(continueAfterAuth)`): its replace — to
   * Review, or to the phone verification a booking now needs — is a departure
   * too, and the guard would otherwise turn it into a trip to the tabs.
   */
  const toTabs = () => {
    clearPendingIntents();
    router.dismissTo('/(tabs)');
  };
  const leave = useBackGuard({
    // Only the first step: the last one's back is a plain pop to the first.
    when: returnTo === 'continue' && step === 0,
    onBlocked: (leave) => leave(toTabs),
    // The iOS back item has already popped; the screen beneath may be the
    // sign-in that sends an incomplete profile straight back here.
    onDismissed: toTabs,
  });

  // Safety net with ONE legitimate trigger: the (auth) layout can route here from
  // a STALE persisted cache row (phone null) that the mount refetch then corrects
  // — this lets that guest through without re-saving. Every other route in
  // 'continue' mode comes from a known-incomplete row, and onSave marks `skipped`
  // before saving so the save's own refetch can never re-fire it.
  useEffect(() => {
    if (step !== 0 || returnTo !== 'continue' || skipped.current || !profile.data) return;
    if (!needsProfileCompletion(profile.data)) {
      skipped.current = true;
      leave(continueAfterAuth);
    }
  }, [step, returnTo, profile.data, continueAfterAuth, leave]);

  // What follows a save — the toast, and continueAfterAuth — must speak the
  // language just chosen. setLocale resolves once that language has
  // committed, but onSuccess's closure still holds the `t`, `toast` and
  // `continueAfterAuth` of the render BEFORE the switch; so the step is
  // carried over in state and run from the first render in which `locale`
  // matches, where this effect reads the fresh ones from context.
  // The target is the language the save SENT, not the picker's live value: the
  // picker stays usable while the request is in flight, and a toggle then
  // would otherwise leave this waiting for a locale that never arrives.
  // It lives in the shared draft and is run by the FIRST step, once the last
  // has popped and this one is on top again: the guard and `back()` belong here.
  const [continuation, setContinuation] = useCompleteDraftField('continuation');
  useEffect(() => {
    if (step !== 0 || !focused) return;
    if (!continuation || locale !== continuation.lang) return;
    setContinuation(null);
    if (continuation.to === 'back') {
      toast(t('profile.updated'));
      back();
    } else {
      toast(t('auth.welcomeToApp'));
      leave(continueAfterAuth);
    }
  }, [step, focused, continuation, locale, t, toast, back, continueAfterAuth, leave, setContinuation]);

  // The first step leaving the stack (done, or the guest backing out) ends the draft.
  useEffect(() => (step === 0 ? resetCompleteProfileDraft : undefined), [step]);

  if (!initializing && !session) return <Redirect href="/welcome" />;
  // A later step reached with an empty draft (a restored route) starts over.
  if (step > 0 && !initialised) {
    return <Redirect href={{ pathname: '/complete-profile', params: { returnTo } }} />;
  }

  const fail = (set: (m: string) => void, message: string) => {
    set(message);
    return false;
  };

  /** Validates the step on screen; true when the guest may go on. */
  const stepOk = (at: number): boolean => {
    if (at === 0) {
      if (!firstName.trim()) return fail(setNameError, t('auth.firstNameRequired'));
    } else {
      if (askGender && !gender) return fail(setGenderError, t('guestGender.required'));
      const badPhone = validatePhone(iso, national);
      if (badPhone === 'PHONE_REQUIRED') return fail(setPhoneError, t('auth.phoneRequired'));
      if (badPhone) return fail(setPhoneError, t('auth.phoneInvalid'));
      if (needsTerms && !agreed) return fail(setError, t('auth.termsRequired'));
    }
    return true;
  };

  const clearErrors = () => {
    setError(null);
    setNameError(null);
    setPhoneError(null);
    setGenderError(null);
  };

  const onNext = () => {
    clearErrors();
    if (!stepOk(step)) return;
    if (step < LAST_STEP) {
      router.push({ pathname: '/complete-profile', params: { returnTo, step: String(step + 1) } });
      return;
    }
    onSave();
  };

  const onSave = () => {
    // The save's own invalidation refetches the profile while this screen is still
    // mounted; without this the auto-continue effect above would fire a SECOND
    // continueAfterAuth() (a duplicate hold_slot, or a replace to the tabs that
    // pulls the guest off Review). The save path navigates itself below.
    skipped.current = true;
    update.mutate(
      { ...namePatch(firstName, lastName), phone: composePhone(iso, national) },
      {
        onSuccess: async () => {
          if (needsTerms) {
            try {
              await acceptTerms.mutateAsync();
            } catch (err) {
              captureException(err, { scope: 'consent.accept' });
              skipped.current = false;
              setError(t('consent.failed'));
              return;
            }
          }
          // 0353: the gender, once. A failure stops here with the reason; Save
          // again re-sends the (unchanged) profile and the gender.
          if (askGender && gender) {
            try {
              await setMyGender.mutateAsync(gender);
            } catch (err) {
              if (rpcErrorCode(errorMessageOf(err)) !== 'GENDER_ALREADY_SET') {
                setError(t(mapErrorToKey(err)));
                return;
              }
              // Another device answered first: go on with the stored value.
              toast(t('matches.errors.genderAlreadySet'), 'info');
            }
          }
          // 0368: the band, when it was asked and answered. It never stops the
          // save: a band is worth asking for, not worth a refusal.
          if (askAge && (band || (birthDate && isValidBirthDate(birthDate)))) {
            try {
              const local =
                birthDate && isValidBirthDate(birthDate) ? birthDateToLocalDate(birthDate) : null;
              if (local && birthDate) {
                await setBirth.mutateAsync(birthDate);
                await setAgeBand.mutateAsync(ageBandOf(local));
              } else if (band) {
                await setAgeBand.mutateAsync(band);
              }
            } catch (err) {
              captureException(err, { scope: 'completeProfile.ageBand' });
            }
          }
          // ALWAYS, even when unchanged: a new OAuth row has preferred_lang 'en'
          // by trigger default even while the app runs in Arabic. setLocale
          // writes profiles.preferred_lang and, when the choice differs from the
          // running language, switches the app in place. The step after it
          // runs from the effect above, in that language.
          await setLocale(lang);
          // Pop the last step; the first one, now on top, carries on from the draft.
          setContinuation({ to: returnTo, lang });
          router.dismiss();
        },
        onError: (err) => setError(t(mapErrorToKey(err))),
      },
    );
  };

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.completeProfileTitle') }} />
      {profile.isPending && !initialised ? (
        <SkeletonList rows={3} height={64} />
      ) : profile.isError && !initialised ? (
        <ErrorState
          testID="complete-profile.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(profile.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void profile.refetch()}
          busy={profile.isRefetching}
        />
      ) : (
        <ScreenWithBar
          gutter={20}
          contentContainerStyle={{ paddingTop: 6 }}
          error={error}
          bar={
            <>
              <Button
                testID="complete-profile.submit"
                label={step < LAST_STEP ? t('common.next') : t('auth.completeProfileCta')}
                variant="primary"
                busy={update.isPending || setMyGender.isPending || acceptTerms.isPending || holdBusy}
                onPress={onNext}
              />
            </>
          }
        >
          {step === 0 ? (
            <>
              <Title plain>{t('auth.completeProfileTitle')}</Title>
              <Hint style={{ marginTop: 8 }}>
                {t(onlyGender ? 'guestGender.completeBody' : 'auth.completeProfileBody')}
              </Hint>
              <FloatingField
                testID="complete-profile.first-name"
                placeholder={t('auth.firstNameLabel')}
                value={firstName}
                onChangeText={(v) => {
                  nameTouched.current = true;
                  setFirstName(v);
                }}
                autoCapitalize="words"
                autoComplete="given-name"
                textContentType="givenName"
                maxLength={NAME_PART_MAX}
                error={nameError}
                style={{ marginTop: 6 }}
              />
              <FloatingField
                testID="complete-profile.last-name"
                placeholder={t('auth.lastNameLabel')}
                value={lastName}
                onChangeText={(v) => {
                  nameTouched.current = true;
                  setLastName(v);
                }}
                autoCapitalize="words"
                autoComplete="family-name"
                textContentType="familyName"
                maxLength={NAME_PART_MAX}
              />
              {askAge ? (
                <BirthDatePicker
                  testID="complete-profile.age"
                  value={birthDate}
                  onChange={setBirthDate}
                  style={{ marginTop: space.sm }}
                />
              ) : null}
            </>
          ) : null}
          {step === 1 ? (
            <>
              {askGender ? (
                <GenderPicker
                  testID="complete-profile.gender"
                  value={gender}
                  onChange={(next) => {
                    setGender(next);
                    setGenderError(null);
                  }}
                  error={genderError}
                />
              ) : null}
              <PhoneField
                testID="complete-profile.phone"
                placeholder={t('auth.phoneLabel')}
                iso={iso}
                onChangeIso={setIso}
                national={national}
                onChangeNational={setNational}
                error={phoneError}
              />
              {needsTerms ? (
                <ConsentCheckbox
                  testID="complete-profile.terms"
                  checked={agreed}
                  onToggle={() => setAgreed((v) => !v)}
                />
              ) : null}
            </>
          ) : null}
        </ScreenWithBar>
      )}
    </Screen>
  );
}
