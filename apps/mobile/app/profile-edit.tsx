import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../src/i18n/text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { isolate, isolateLtr } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useOwnProfile, useUpdateProfile } from '../src/features/profile/hooks';
import { mapErrorToKey } from '../src/features/booking/errors';
import { brand, radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Hint, Screen } from '../src/components/ui';
import { useBack } from '../src/navigation/back';
import { PhoneField } from '../src/components/phone';
import {
  composePhone,
  DEFAULT_ISO,
  displayPhone,
  parsePhone,
  phoneChangeNeedsCode,
  validatePhone,
} from '../src/features/profile/phone';
import { startPhoneLink } from '../src/features/auth/api';
import { mapOtpError, phoneOtpEnabled } from '../src/features/auth/phoneOtp';
import { supabase } from '../src/lib/supabase';
import { useToast } from '../src/components/overlays';
import { passwordProofOf } from '../src/features/profile/changePasswordFlow';
import { ChevronIcon, LockIcon, PencilIcon, PhoneIcon } from '../src/components/icons';
import { SkeletonList } from '../src/components/states';
import { NAME_PART_MAX, nameFieldsOf, namePatch } from '../src/features/profile/names';

/**
 * Edit profile: a hub, then one small form per thing to change (owner,
 * 2026-10-01). The hub is the avatar plus three rows (Name & surname, Mobile
 * phone, Change password); each row opens this same route with `section` set,
 * so there is one file and one stack entry per form. Email is not editable
 * (re-verification, spec 05.18); language lives in Settings alone. Leaving
 * never prompts: back drops unsaved edits (owner, 2026-09-09).
 *
 * NAME (open matches, guest.md §4.9): two fields, because other players see
 * the first name and the surname's initial. The first is required; the
 * surname is not (single-name guests exist). The server rebuilds `full_name`.
 *
 * PHONE: a CHANGED number costs a 6-digit code. The number is what the desk
 * dials about a booking, so Save sends a code (`startPhoneLink`) and hands
 * off to app/verify-otp.tsx in `link` mode, which writes `profiles.phone`
 * only after the code comes back. Only when `phoneChangeNeedsCode` says so;
 * otherwise Save writes the number directly.
 */
type Section = 'name' | 'phone';

function useInitials(first: string, last: string, email: string) {
  return (
    [first, last]
      .map((w) => w.trim()[0] ?? '')
      .join('')
      .toUpperCase() ||
    email.slice(0, 1).toUpperCase() ||
    '•'
  );
}

function Avatar({ initials }: { initials: string }) {
  const { fonts } = useTheme();
  return (
    <View
      style={{
        width: 84,
        height: 84,
        borderRadius: radius.pill,
        backgroundColor: brand.blue,
        borderWidth: 3,
        borderColor: brand.green,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 30,
          lineHeight: 34,
          textAlign: 'center',
          includeFontPadding: false,
          color: brand.white,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

function HubRow({
  testID,
  icon,
  label,
  value,
  onPress,
  last,
}: {
  testID: string;
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: 14,
        paddingBottom: 14,
        backgroundColor: pressed ? colors.sub : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.pill,
          backgroundColor: colors.gtint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 14, color: colors.ink, textAlign: 'auto' }}
        >
          {label}
        </Text>
        {value ? (
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              fontFamily: fonts.body400,
              fontSize: 12.5,
              color: colors.mut,
              textAlign: 'auto',
            }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

function Hub() {
  const { t } = useLocale();
  const { colors } = useTheme();
  const { session } = useAuth();
  const router = useRouter();
  const profile = useOwnProfile(!!session);
  const { first, last } = nameFieldsOf(profile.data ?? {});
  const email = session?.user.email ?? '';
  const phone = profile.data?.phone ? isolateLtr(displayPhone(profile.data.phone)) : '';
  const go = (section: Section) => router.push({ pathname: '/profile-edit', params: { section } });

  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 22, gap: 10 }}>
        <Avatar initials={useInitials(first, last, email)} />
        <Text
          numberOfLines={1}
          style={{ fontSize: 13, color: colors.mut, textAlign: 'center', writingDirection: 'ltr' }}
        >
          {isolate(email)}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        <HubRow
          testID="profile-edit.name"
          icon={<PencilIcon size={15} color={colors.gstrong} />}
          label={t('profile.nameSection')}
          value={[first, last].filter(Boolean).join(' ') || t('profile.notSet')}
          onPress={() => go('name')}
        />
        <HubRow
          testID="profile-edit.phone-row"
          icon={<PhoneIcon size={15} color={colors.gstrong} />}
          label={t('profile.phoneSection')}
          value={phone || t('profile.notSet')}
          onPress={() => go('phone')}
          last={!passwordProofOf(session?.user)}
        />
        {/* Only for an account that HAS a password (not Google/Apple-only, not a
            desk walk-in): every "current password" is wrong for the others. */}
        {passwordProofOf(session?.user) ? (
          <HubRow
            testID="profile-edit.change-password"
            icon={<LockIcon size={15} color={colors.gstrong} />}
            label={t('profile.changePassword')}
            onPress={() => router.push('/change-password')}
            last
          />
        ) : null}
      </View>
    </FormScreen>
  );
}

function NameForm() {
  const { t } = useLocale();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();
  const back = useBack();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ready, setReady] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && !ready) {
      const names = nameFieldsOf(profile.data);
      setFirstName(names.first);
      setLastName(names.last);
      setReady(true);
    }
  }, [profile.data, ready]);

  const onSave = () => {
    setError(null);
    setNameError(null);
    if (!firstName.trim()) return setNameError(t('auth.firstNameRequired'));
    update.mutate(namePatch(firstName, lastName), {
      onSuccess: () => {
        toast(t('profile.updated'));
        back();
      },
      onError: (err) => setError(t(mapErrorToKey(err))),
    });
  };

  if (profile.isLoading && !ready) return <SkeletonList rows={2} height={64} />;
  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <Field
        testID="profile-edit.first-name"
        label={t('auth.firstNameLabel')}
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        maxLength={NAME_PART_MAX}
        dense
        error={nameError}
      />
      <Field
        testID="profile-edit.last-name"
        label={t('auth.lastNameLabel')}
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        autoComplete="family-name"
        textContentType="familyName"
        maxLength={NAME_PART_MAX}
        dense
      />
      <Hint>{t('profile.nameShownHint')}</Hint>
      <ErrorText>{error}</ErrorText>
      <Button
        testID="profile-edit.save"
        label={t('profile.saveChanges')}
        variant="cta"
        busy={update.isPending}
        onPress={onSave}
        style={{ marginTop: 6 }}
      />
    </FormScreen>
  );
}

function PhoneForm() {
  const { t } = useLocale();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();
  const router = useRouter();
  const back = useBack();
  const [sendingCode, setSendingCode] = useState(false);
  // The phone is EDITED as country + national digits and STORED as E.164.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [initialPhone, setInitialPhone] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && initialPhone === null) {
      const parsed = parsePhone(profile.data.phone);
      setIso(parsed.iso);
      setNational(parsed.national);
      // The COMPOSED baseline, not the raw column: a number stored in an older
      // shape (`00964…`, or with spaces) round-trips as normalized E.164.
      setInitialPhone(composePhone(parsed.iso, parsed.national));
    }
  }, [profile.data, initialPhone]);

  const phone = composePhone(iso, national);

  const onSave = () => {
    setError(null);
    setPhoneError(null);
    // Required from day one (spec 05.3): the desk calls it about bookings, and
    // the booking path refuses without it — so it cannot be cleared here.
    const badPhone = validatePhone(iso, national);
    if (badPhone === 'PHONE_REQUIRED') return setPhoneError(t('auth.phoneRequired'));
    if (badPhone) return setPhoneError(t('auth.phoneInvalid'));

    const needsCode = phoneChangeNeedsCode({
      enabled: phoneOtpEnabled(),
      current: initialPhone ?? undefined,
      next: phone,
    });

    if (!needsCode) {
      update.mutate(
        { phone },
        {
          onSuccess: () => {
            toast(t('profile.updated'));
            back();
          },
          onError: (err) => setError(t(mapErrorToKey(err))),
        },
      );
      return;
    }

    // Not written here: it is not this guest's number until the code proves
    // it. verify-otp writes it after `verifyPhoneLink` succeeds.
    void (async () => {
      setSendingCode(true);
      try {
        await startPhoneLink(supabase, phone);
        router.push({ pathname: '/verify-otp', params: { phone, mode: 'link', from: 'edit' } });
      } catch (err) {
        setError(t(phoneOtpEnabled() ? mapOtpError(err) : mapErrorToKey(err)));
      } finally {
        setSendingCode(false);
      }
    })();
  };

  if (profile.isLoading && initialPhone === null) return <SkeletonList rows={1} height={64} />;
  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <PhoneField
        testID="profile-edit.phone"
        label={t('auth.phoneLabel')}
        iso={iso}
        onChangeIso={setIso}
        national={national}
        onChangeNational={setNational}
        dense
        error={phoneError}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        testID="profile-edit.save-phone"
        label={t('profile.saveChanges')}
        variant="cta"
        busy={update.isPending || sendingCode}
        onPress={onSave}
        style={{ marginTop: 6 }}
      />
    </FormScreen>
  );
}

function EditProfileScreen() {
  const { t } = useLocale();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const title =
    section === 'name'
      ? t('profile.nameSection')
      : section === 'phone'
        ? t('profile.phoneSection')
        : t('profile.editProfile');
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title }} />
      {section === 'name' ? <NameForm /> : section === 'phone' ? <PhoneForm /> : <Hub />}
    </Screen>
  );
}

/**
 * This screen lives on the ROOT stack rather than in the `(gated)` group, so
 * that a push from the Profile tab leaves real history beneath it and UIKit
 * draws its own (animated) back item. The group's layout guard does not apply
 * here, so the session requirement is declared explicitly — same three states,
 * same redirect.
 */
export default function GuardedEditProfileScreen() {
  return (
    <RequireSession>
      <EditProfileScreen />
    </RequireSession>
  );
}
