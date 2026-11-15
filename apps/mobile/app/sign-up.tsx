import { useEffect, useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { supabase } from '../src/lib/supabase';
import { sendSignUpCode } from '../src/features/auth/api';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import {
  Button,
  FooterLink,
  LabeledDivider,
  Screen,
} from '../src/components/ui';
import { ScreenWithBar } from '../src/components/BottomBar';
import { FloatingField } from '../src/components/FloatingLabel';
import { BirthDatePicker } from '../src/components/BirthDatePicker';
import { isValidBirthDate } from '../src/features/profile/birthDate';
import { NAME_PART_MAX } from '../src/features/profile/names';
import { PhoneField } from '../src/components/phone';
import { ConsentCheckbox } from '../src/features/profile/ConsentCheckbox';
import { SocialSignInBlock } from '../src/components/social';
import { useToast } from '../src/components/overlays';
import { GenderPicker } from '../src/components/GenderPicker';
import { resetSignUpDraft, useDraftField } from '../src/features/auth/signUpDraft';

const LAST_STEP = 1;

/**
 * Create account, two steps, each its own screen on the stack (so the native
 * back button, the iOS swipe and Android's back step back with no code of ours;
 * the form lives in signUpDraft). NOTHING is created until the very end:
 *
 *   0  first name, last name, date of birth. Apple / Google sit above them (a
 *      provider account is made by the provider, and fixes its gaps in Edit
 *      profile).
 *   1  gender, phone number and Terms -> a code (app/verify-otp.tsx,
 *      mode register). The verified code creates the account and signs it in,
 *      and that screen writes the whole draft onto it
 *      (features/auth/useApplySignUpDraft.ts).
 *
 * The session lands under these screens, so their signed-out guard is lifted
 * while `registering`.
 */
function SignUpScreen({ step }: { step: number }) {
  const { t } = useLocale();
  const router = useRouter();
  const [firstName, setFirstName] = useDraftField('firstName');
  const [lastName, setLastName] = useDraftField('lastName');
  const [gender, setGender] = useDraftField('gender');
  const [birthDate, setBirthDate] = useDraftField('birthDate');
  // Country + national digits; the API receives the composed E.164.
  const [iso, setIso] = useDraftField('iso');
  const [national, setNational] = useDraftField('national');
  // 0153: the Terms consent, recorded once the account has its session.
  const [agreed, setAgreed] = useDraftField('agreed');
  const [, setRegistering] = useDraftField('registering');
  const [fieldErrors, setFieldErrors] = useDraftField('fieldErrors');
  const [error, setError] = useDraftField('error');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
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

  /** Step 0: the name and date of birth, kept in the draft until the code. */
  const onDetails = () => {
    clear();
    if (!firstName.trim()) return setFieldErrors({ firstName: t('auth.firstNameRequired') });
    if (!lastName.trim()) return setFieldErrors({ lastName: t('auth.lastNameRequired') });
    if (!birthDate || !isValidBirthDate(birthDate)) {
      return setFieldErrors({ ageBand: t('auth.ageRequired') });
    }
    router.push({ pathname: '/sign-up', params: { step: '1' } });
  };

  /** Step 1: gender, phone and Terms; then a code to the number. */
  const onPhone = async () => {
    clear();
    if (!gender) return setFieldErrors({ gender: t('guestGender.required') });
    const { e164 } = validatePhoneInput(iso, national);
    if (!national.trim()) return setFieldErrors({ phone: t('auth.phoneRequired') });
    // A code to a number that cannot be one is paid for; stop at the field.
    if (!e164) return setFieldErrors({ phone: t('auth.phoneOtpInvalid') });
    if (!agreed) return setError(t('auth.termsRequired'));
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

  const onNext = () => void (step === 0 ? onDetails() : onPhone());

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.signUp') }} />
      <ScreenWithBar
        gutter={20}
        contentContainerStyle={{ paddingTop: 6 }}
        error={error ?? social.errorText}
        bar={
          <Button
            testID="sign-up.submit"
            label={step < LAST_STEP ? t('common.next') : t('auth.sendCode')}
            onPress={onNext}
            busy={busy || holdBusy}
            disabled={social.busyProvider !== null}
            variant="primary"
          />
        }
      >
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
        {step === 0 ? (
          <>
            <FloatingField
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
            <FloatingField
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
            <BirthDatePicker
              testID="sign-up.age"
              value={birthDate}
              onChange={(next) => {
                setBirthDate(next);
                setFieldErrors((prev) => ({ ...prev, ageBand: undefined }));
              }}
              error={fieldErrors.ageBand}
              style={{ marginTop: space.sm }}
            />
          </>
        ) : null}
        {step === 1 ? (
          <>
            <GenderPicker
              testID="sign-up.gender"
              value={gender}
              onChange={(next) => {
                setGender(next);
                setFieldErrors((prev) => ({ ...prev, gender: undefined }));
              }}
              error={fieldErrors.gender}
            />
            <PhoneField
              testID="sign-up.phone"
              placeholder={t('auth.phoneLabel')}
              iso={iso}
              onChangeIso={setIso}
              national={national}
              onChangeNational={setNational}
              error={fieldErrors.phone}
            />
            {/* 0153: one checkbox, each document its own link. */}
            <ConsentCheckbox
              testID="sign-up.terms"
              checked={agreed}
              onToggle={() => setAgreed((v) => !v)}
            />
          </>
        ) : null}
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
      </ScreenWithBar>
    </Screen>
  );
}

/**
 * Every step is signed-out only, on the ROOT stack (the `(auth)` group carried
 * the rule in its layout; flattening it is what lets UIKit draw its own back
 * item here). See RequireNoSession for the pending-slot exemption that keeps the
 * post-auth booking continuation working. The code's session lands under these
 * screens, which `registering` lets through.
 */
export default function GuardedSignUpScreen() {
  const params = useLocalSearchParams<{ step?: string }>();
  const step = Math.min(Math.max(Number(params.step) || 0, 0), LAST_STEP);
  const [registering] = useDraftField('registering');
  const [firstName] = useDraftField('firstName');
  // A later step reached with an empty draft (a restored route) starts over.
  if (step > 0 && !firstName.trim() && !registering) return <Redirect href="/sign-up" />;
  return (
    <RequireNoSession allowSession={registering}>
      <SignUpScreen step={step} />
    </RequireNoSession>
  );
}
