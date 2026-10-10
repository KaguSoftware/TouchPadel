import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { isPhoneTaken, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import {
  isEmailTaken,
  mapEmailAuthError,
  parseAuthMethod,
  signUpHidExistingAccount,
  type AuthMethod,
} from '../src/features/auth/emailAuth';
import type { Locale } from '@touch/i18n';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import { Text } from '../src/i18n/text';
import { supabase } from '../src/lib/supabase';
import { signUpWithEmail, signUpWithPhone, validateSignUp } from '../src/features/auth/api';
import { verifyRedirect } from '../src/features/auth/redirects';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { classifyUpdateFailure } from '../src/features/profile/changePasswordFlow';
import { useLocale } from '../src/i18n/LocaleProvider';
import { brand, space, useTheme } from '../src/theme';
import { CheckIcon } from '../src/components/icons';
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
import { PhoneField } from '../src/components/phone';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { onTermsReviewAccepted } from '../src/features/profile/termsReview';
import { splitSentence } from '../src/features/auth/linkedSentence';
import { SocialSignInBlock } from '../src/components/social';
import { useToast } from '../src/components/overlays';
import { NAME_PART_MAX } from '../src/features/profile/names';

type FieldErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  password?: string;
};

/**
 * Create account: name · surname · (email) · phone · password ·
 * preferred language, with a password proved by the phone number (default
 * segment, owner decision 2026-09-15) or by an email address (restored beside
 * phone 2026-09-20, Phase 2 plan O2). Validation renders on the field it
 * concerns, in the form's order.
 *
 *   phone  submitting sends ONE code — WhatsApp, or SMS when the number has no
 *          WhatsApp — to confirm the number (app/verify-otp.tsx, mode signup);
 *          every later sign-in is phone + password with no code.
 *   email  submitting mails ONE link; app/verify-email.tsx waits for it and
 *          useAuthDeepLink exchanges it. The phone is still required (spec
 *          05.3: the desk calls it), so an email guest never meets
 *          PHONE_REQUIRED at confirm_booking; complete-profile remains the
 *          backstop for accounts that lack one.
 *
 * Continue with Apple / Google sit above the form (vendor addition 2026-09-01).
 * A social sign-up has no phone, so complete-profile collects one before the
 * first booking.
 */
function SignUpScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ method?: string }>();
  const [method, setMethod] = useState<AuthMethod>(() => parseAuthMethod(params.method));
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  // Country + national digits; the API receives the composed E.164.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [password, setPassword] = useState('');
  const [preferredLang, setPreferredLang] = useState<Locale>(locale);
  // 0153: the Terms consent. Required to submit; the version rides in the
  // sign-up metadata and useTermsGate records it once the session lands.
  const [agreed, setAgreed] = useState(false);
  // Ticking opens the Terms and Privacy reader (app/terms-review.tsx); its
  // Accept ticks the box. Unticking needs no reading.
  useEffect(() => onTermsReviewAccepted(() => setAgreed(true)), []);
  const openTerms = () => router.push('/terms-review');
  const onTermsRow = () => {
    if (agreed) setAgreed(false);
    else openTerms();
  };
  const { colors, fonts } = useTheme();
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const social = useSocialSignIn({
    onComplete: () => {
      toast(t('auth.welcomeBack'), 'info');
      continueAfterAuth();
    },
    disabled: busy,
  });


  /**
   * The phone or email already has an account. Said on the field AND in a
   * dialog whose Sign in opens sign-in on the same segment, the number or
   * address already filled in: signing up again must never lead into the
   * existing account through a fresh code.
   */
  const accountExists = (e164: string) => {
    const message = t(method === 'email' ? 'auth.emailTaken' : 'auth.phoneTaken');
    setFieldErrors(method === 'email' ? { email: message } : { phone: message });
    Alert.alert(t('auth.accountExistsTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signIn'),
        onPress: () =>
          router.replace({
            pathname: '/sign-in',
            params: method === 'email' ? { method, email: email.trim() } : { method, phone: e164 },
          }),
      },
    ]);
  };

  /** Shared field checks; the E.164 or null when something is wrong (already rendered). */
  const validate = (): string | null => {
    const invalid = validateSignUp({
      firstName,
      lastName,
      email: method === 'email' ? email : undefined,
      phoneNational: national,
      password,
    });
    if (invalid === 'FIRST_NAME_REQUIRED') {
      setFieldErrors({ firstName: t('auth.firstNameRequired') });
      return null;
    }
    if (invalid === 'LAST_NAME_REQUIRED') {
      setFieldErrors({ lastName: t('auth.lastNameRequired') });
      return null;
    }
    if (invalid === 'EMAIL_INVALID') {
      setFieldErrors({ email: t(email.trim() ? 'auth.emailInvalid' : 'auth.emailRequired') });
      return null;
    }
    if (invalid === 'PHONE_REQUIRED') {
      setFieldErrors({ phone: t('auth.phoneRequired') });
      return null;
    }
    const { e164 } = validatePhoneInput(iso, national);
    // A code to a number that cannot be one is paid for; stop at the field.
    if (!e164) {
      setFieldErrors({ phone: t('auth.phoneOtpInvalid') });
      return null;
    }
    if (invalid === 'PASSWORD_TOO_SHORT') {
      setFieldErrors({ password: t('auth.passwordTooShort') });
      return null;
    }
    return e164;
  };

  const onSubmit = async () => {
    setError(null);
    setFieldErrors({});
    social.clearError();
    const e164 = validate();
    if (!e164) return;
    if (!agreed) return setError(t('auth.termsRequired'));
    setBusy(true);
    try {
      if (method === 'email') {
        const data = await signUpWithEmail(
          supabase,
          { firstName, lastName, email, phone: e164, password, preferredLang, termsVersion: CURRENT_TERMS_VERSION },
          verifyRedirect(),
        );
        if (signUpHidExistingAccount(data)) return accountExists(e164);
      } else {
        const data = await signUpWithPhone(supabase, {
          firstName,
          lastName,
          phone: e164,
          password,
          preferredLang,
          termsVersion: CURRENT_TERMS_VERSION,
        });
        if (signUpHidExistingAccount(data)) return accountExists(e164);
      }
      // The chosen language becomes the app language — strings, faces and
      // layout direction switch in one commit, under a short crossfade, before
      // the code / check-your-email screen comes up.
      await setLocale(preferredLang);
      if (method === 'email') {
        // Confirmations on: no session yet, verify-email waits for the link.
        // Off: the session has landed and verify-email's own session effect
        // advances to verify-result.
        router.replace({ pathname: '/verify-email', params: { email: email.trim() } });
      } else {
        router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'signup' } });
      }
    } catch (err) {
      if (method === 'email' ? isEmailTaken(err) : isPhoneTaken(err)) return accountExists(e164);
      if (classifyUpdateFailure(err) === 'weak-password') {
        return setFieldErrors({ password: t('auth.passwordTooShort') });
      }
      setError(t(method === 'email' ? mapEmailAuthError(err) : mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.signUp') }} />
      <FormScreen contentStyle={{ flexGrow: 1 }}>
        <SocialSignInBlock
          testID="sign-up.social"
          available={social.available}
          busyProvider={social.busyProvider}
          disabled={busy || holdBusy}
          onPress={(provider) => void social.signInWith(provider)}
          style={{ marginTop: 14 }}
        />
        {hasSocial(social.available) ? (
          <LabeledDivider label={t('auth.orContinueWithPassword')} style={{ marginTop: 18, marginBottom: 4 }} />
        ) : null}
        <View style={{ marginTop: 6 }}>
          <SegmentedControl<AuthMethod>
            testID="sign-up.method"
            options={[
              { value: 'phone', label: t('auth.phoneLabel') },
              { value: 'email', label: t('auth.emailLabel') },
            ]}
            value={method}
            onChange={(next) => {
              setMethod(next);
              setFieldErrors({});
              setError(null);
            }}
          />
        </View>
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
        {method === 'email' ? (
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
          />
        ) : null}
        <PhoneField
          testID="sign-up.phone"
          placeholder={t('auth.phoneLabel')}
          iso={iso}
          onChangeIso={setIso}
          national={national}
          onChangeNational={setNational}
          error={fieldErrors.phone}
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
        {/* 0153: the whole row is the target, so the sentence is one too. */}
        <Pressable
          testID="sign-up.terms-row"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel={t('auth.termsAgree')}
          onPress={onTermsRow}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.l }}
        >
          <View
            testID="sign-up.terms"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              borderWidth: 1.5,
              // An empty box is still a control: fnt clears 3:1 on the card.
              borderColor: agreed ? brand.green : colors.fnt,
              backgroundColor: agreed ? brand.green : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {agreed ? <CheckIcon size={13} color={brand.greenInk} strokeWidth={3} /> : null}
          </View>
          {/* The two documents are links in the sentence; each opens the reader. */}
          <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ink }}>
            {splitSentence(t('auth.termsAgreeLinked')).map((part, i) =>
              part.kind === 'text' ? (
                part.text
              ) : (
                <Text
                  key={i}
                  testID={`sign-up.terms-link.${part.name}`}
                  accessibilityRole="link"
                  onPress={openTerms}
                  style={{ fontFamily: fonts.body700, color: colors.blue, textDecorationLine: 'underline' }}
                >
                  {t(part.name === 'privacy' ? 'auth.privacyLink' : 'auth.termsLink')}
                </Text>
              ),
            )}
          </Text>
        </Pressable>
        <ErrorText>{error ?? social.errorText}</ErrorText>
        <Button
          testID="sign-up.submit"
          label={t('auth.signUp')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <FooterLink
          testID="sign-up.sign-in"
          lead={t('auth.alreadyLead')}
          label={t('auth.signIn')}
          // Reached from Profile as well as Welcome — always land on sign-in,
          // on the segment the guest was using here.
          onPress={() => router.replace({ pathname: '/sign-in', params: { method } })}
          style={{ marginTop: 18 }}
        />
      </FormScreen>
    </Screen>
  );
}

/**
 * Signed-out only, on the ROOT stack. The `(auth)` group carried this rule in
 * its layout; flattening it is what lets UIKit draw its own back item here
 * instead of a JS stand-in. See RequireNoSession for the pending-slot
 * exemption that keeps the post-auth booking continuation working.
 */
export default function GuardedSignUpScreen() {
  return (
    <RequireNoSession>
      <SignUpScreen />
    </RequireNoSession>
  );
}
