import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { RequireSession } from '../src/features/auth/RequireSession';
import { mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { isEmailTaken, isValidEmail, mapEmailAuthError } from '../src/features/auth/emailAuth';
import type { Locale } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import { PASSWORD_MIN, sendSignUpCode, setEmailAndPassword } from '../src/features/auth/api';
import { verifyRedirect } from '../src/features/auth/redirects';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { classifyUpdateFailure } from '../src/features/profile/changePasswordFlow';
import {
  useAcceptTerms,
  useSetAgeBand,
  useSetBirthDate,
  useUpdateProfile,
} from '../src/features/profile/hooks';
import { useSetMyGender } from '../src/features/matches/hooks';
import { rpcErrorCode } from '../src/features/booking/errors';
import { errorMessageOf } from '../src/lib/network';
import { captureException } from '../src/lib/telemetry';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FooterLink,
  FormScreen,
  LabeledDivider,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { BirthDatePicker } from '../src/components/BirthDatePicker';
import { ageBandOf } from '../src/features/playProfile/logic';
import { birthDateToLocalDate, isValidBirthDate } from '../src/features/profile/birthDate';
import { namePatch, NAME_PART_MAX } from '../src/features/profile/names';
import { PhoneField } from '../src/components/phone';
import { ConsentCheckbox } from '../src/features/profile/ConsentCheckbox';
import { SocialSignInBlock } from '../src/components/social';
import { useToast } from '../src/components/overlays';
import { GenderPicker } from '../src/components/GenderPicker';
import { resetSignUpDraft, useDraftField } from '../src/features/auth/signUpDraft';

const LAST_STEP = 2;

/**
 * Create account, three steps, each its own screen on the stack (so the native
 * back button, the iOS swipe and Android's back step back with no code of ours;
 * the form lives in signUpDraft):
 *
 *   0  phone number -> a code (app/verify-otp.tsx, mode register) that creates
 *      the account and signs it in. Apple / Google sit above it.
 *   1  first name, last name, gender, date of birth. Saved on Next, to the
 *      signed-in account (profile names, set_my_gender, set_my_birth_date,
 *      set_my_age_band), so a guest who stops here still has a whole profile.
 *   2  email, password, language, Terms. Email and password are put on the same
 *      account (auth.updateUser); the Terms are recorded with accept_terms.
 *
 * Steps 1 and 2 need the session the code created; step 0 stays mounted under
 * them, so its signed-out guard is lifted while `registering`.
 */
function SignUpScreen({ step }: { step: number }) {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const [firstName, setFirstName] = useDraftField('firstName');
  const [lastName, setLastName] = useDraftField('lastName');
  const [gender, setGender] = useDraftField('gender');
  const [birthDate, setBirthDate] = useDraftField('birthDate');
  const [email, setEmail] = useDraftField('email');
  // Country + national digits; the API receives the composed E.164.
  const [iso, setIso] = useDraftField('iso');
  const [national, setNational] = useDraftField('national');
  const [password, setPassword] = useDraftField('password');
  const [preferredLangDraft, setPreferredLang] = useDraftField('preferredLang');
  const preferredLang: Locale = preferredLangDraft ?? locale;
  // 0153: the Terms consent, recorded once the account has its session.
  const [agreed, setAgreed] = useDraftField('agreed');
  const [, setRegistering] = useDraftField('registering');
  const [fieldErrors, setFieldErrors] = useDraftField('fieldErrors');
  const [error, setError] = useDraftField('error');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const updateProfile = useUpdateProfile();
  const setMyGender = useSetMyGender();
  const setAgeBand = useSetAgeBand();
  const setBirth = useSetBirthDate();
  const acceptTerms = useAcceptTerms();
  const social = useSocialSignIn({
    onComplete: () => {
      toast(t('auth.welcomeBack'), 'info');
      continueAfterAuth();
    },
    disabled: busy,
  });

  // The first step leaving the stack (done, or the guest backing out) ends the draft.
  useEffect(() => (step === 0 ? resetSignUpDraft : undefined), [step]);

  const clear = () => {
    setError(null);
    setFieldErrors({});
    social.clearError();
  };

  /** Step 0: a code to the number. */
  const onPhone = async () => {
    clear();
    const { e164 } = validatePhoneInput(iso, national);
    if (!national.trim()) return setFieldErrors({ phone: t('auth.phoneRequired') });
    // A code to a number that cannot be one is paid for; stop at the field.
    if (!e164) return setFieldErrors({ phone: t('auth.phoneOtpInvalid') });
    setBusy(true);
    try {
      await sendSignUpCode(supabase, e164);
      setRegistering(true);
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'register' } });
    } catch (err) {
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  /** Step 1: save who they are, then on to the email and password. */
  const onDetails = async () => {
    clear();
    if (!firstName.trim()) return setFieldErrors({ firstName: t('auth.firstNameRequired') });
    if (!lastName.trim()) return setFieldErrors({ lastName: t('auth.lastNameRequired') });
    if (!gender) return setFieldErrors({ gender: t('guestGender.required') });
    if (!birthDate || !isValidBirthDate(birthDate)) {
      return setFieldErrors({ ageBand: t('auth.ageRequired') });
    }
    setBusy(true);
    try {
      await updateProfile.mutateAsync(namePatch(firstName, lastName));
      try {
        await setMyGender.mutateAsync(gender);
      } catch (err) {
        // Another device answered first: go on with the stored value.
        if (rpcErrorCode(errorMessageOf(err)) !== 'GENDER_ALREADY_SET') throw err;
      }
      // Neither stops the sign-up: worth asking for, not worth a refusal.
      try {
        await setBirth.mutateAsync(birthDate);
        const local = birthDateToLocalDate(birthDate);
        if (local) await setAgeBand.mutateAsync(ageBandOf(local));
      } catch (err) {
        captureException(err, { scope: 'signUp.birth' });
      }
      router.push({ pathname: '/sign-up', params: { step: '2' } });
    } catch (err) {
      captureException(err, { scope: 'signUp.details' });
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  /** Step 2: email, password, Terms; then the app. */
  const onFinish = async () => {
    clear();
    if (!isValidEmail(email)) {
      return setFieldErrors({
        email: t(email.trim() ? 'auth.emailInvalid' : 'auth.emailRequired'),
      });
    }
    if (password.length < PASSWORD_MIN)
      return setFieldErrors({ password: t('auth.passwordTooShort') });
    if (!agreed) return setError(t('auth.termsRequired'));
    setBusy(true);
    try {
      await setEmailAndPassword(supabase, { email, password }, verifyRedirect());
      try {
        await acceptTerms.mutateAsync();
      } catch (err) {
        captureException(err, { scope: 'consent.accept' });
        return setError(t('consent.failed'));
      }
      // The chosen language becomes the app language, then the welcome and the
      // continuation speak it.
      await setLocale(preferredLang);
      toast(t('auth.welcomeToApp'), 'info');
      continueAfterAuth();
    } catch (err) {
      if (isEmailTaken(err)) return setFieldErrors({ email: t('auth.emailTaken') });
      if (classifyUpdateFailure(err) === 'weak-password') {
        return setFieldErrors({ password: t('auth.passwordTooShort') });
      }
      setError(t(mapEmailAuthError(err)));
    } finally {
      setBusy(false);
    }
  };

  const onNext = () => void (step === 0 ? onPhone() : step === 1 ? onDetails() : onFinish());

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.signUp') }} />
      <FormScreen contentStyle={{ flexGrow: 1 }}>
        {step === 0 ? (
          <SocialSignInBlock
            testID="sign-up.social"
            available={social.available}
            busyProvider={social.busyProvider}
            disabled={busy || holdBusy}
            onPress={(provider) => void social.signInWith(provider)}
            googleBrowserOffer={social.googleBrowserOffer}
            onGoogleBrowser={() => void social.signInWith('google', 'browser')}
            style={{ marginTop: 14 }}
          />
        ) : null}
        {step === 0 && hasSocial(social.available) ? (
          <LabeledDivider
            label={t('auth.orContinueWithPassword')}
            style={{ marginTop: 18, marginBottom: 4 }}
          />
        ) : null}
        <MicroLabel style={{ marginTop: 14 }}>
          {t('auth.signUpStep', { step: step + 1, total: LAST_STEP + 1 })}
        </MicroLabel>
        {step === 0 ? (
          <PhoneField
            testID="sign-up.phone"
            placeholder={t('auth.phoneLabel')}
            iso={iso}
            onChangeIso={setIso}
            national={national}
            onChangeNational={setNational}
            error={fieldErrors.phone}
          />
        ) : null}
        {step === 1 ? (
          <>
            <Field
              testID="sign-up.first-name"
              placeholder={t('auth.firstNameLabel')}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              // Each part's CHECK (0256, guest.md §4.9): the server never has to clamp.
              maxLength={NAME_PART_MAX}
              error={fieldErrors.firstName}
              style={{ marginTop: 6 }}
            />
            <Field
              testID="sign-up.last-name"
              placeholder={t('auth.lastNameLabel')}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoComplete="family-name"
              textContentType="familyName"
              maxLength={NAME_PART_MAX}
              error={fieldErrors.lastName}
            />
            <GenderPicker
              testID="sign-up.gender"
              value={gender}
              onChange={(next) => {
                setGender(next);
                setFieldErrors((prev) => ({ ...prev, gender: undefined }));
              }}
              error={fieldErrors.gender}
            />
            <BirthDatePicker
              testID="sign-up.age"
              value={birthDate}
              onChange={(next) => {
                setBirthDate(next);
                setFieldErrors((prev) => ({ ...prev, ageBand: undefined }));
              }}
              error={fieldErrors.ageBand}
              style={{ marginBottom: space.sm }}
            />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Field
              testID="sign-up.email"
              placeholder={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              error={fieldErrors.email}
              style={{ marginTop: 6 }}
            />
            <Field
              testID="sign-up.password"
              placeholder={t('auth.passwordMinPlaceholder')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              error={fieldErrors.password}
            />
            <View style={{ marginTop: space.sm }}>
              <MicroLabel style={{ marginBottom: 5 }}>{t('auth.preferredLanguage')}</MicroLabel>
              <SegmentedControl<Locale>
                testID="sign-up.language"
                options={[
                  { value: 'en', label: t('settings.english') },
                  { value: 'ar', label: t('settings.arabic') },
                ]}
                value={preferredLang}
                onChange={setPreferredLang}
                pinOrder
              />
            </View>
            {/* 0153: one checkbox, each document its own link. */}
            <ConsentCheckbox
              testID="sign-up.terms"
              checked={agreed}
              onToggle={() => setAgreed((v) => !v)}
            />
          </>
        ) : null}
        <ErrorText>{error ?? social.errorText}</ErrorText>
        <Button
          testID="sign-up.submit"
          label={step < LAST_STEP ? t('common.next') : t('auth.signUp')}
          onPress={onNext}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        {step === 0 ? (
          <FooterLink
            testID="sign-up.sign-in"
            lead={t('auth.alreadyLead')}
            label={t('auth.signIn')}
            // Reached from Profile as well as Welcome: always land on sign-in.
            onPress={() => router.replace({ pathname: '/sign-in', params: { method: 'phone' } })}
            style={{ marginTop: 18 }}
          />
        ) : null}
      </FormScreen>
    </Screen>
  );
}

/**
 * Step 0 is signed-out only, on the ROOT stack (the `(auth)` group carried the
 * rule in its layout; flattening it is what lets UIKit draw its own back item
 * here). See RequireNoSession for the pending-slot exemption that keeps the
 * post-auth booking continuation working. Steps 1 and 2 belong to the account
 * the code just created, so they need the session instead.
 */
export default function GuardedSignUpScreen() {
  const params = useLocalSearchParams<{ step?: string }>();
  const step = Math.min(Math.max(Number(params.step) || 0, 0), LAST_STEP);
  const [registering] = useDraftField('registering');
  if (step > 0) {
    return (
      <RequireSession>
        <SignUpScreen step={step} />
      </RequireSession>
    );
  }
  return (
    <RequireNoSession allowSession={registering}>
      <SignUpScreen step={0} />
    </RequireNoSession>
  );
}
