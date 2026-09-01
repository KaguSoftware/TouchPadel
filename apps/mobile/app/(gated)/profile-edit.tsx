import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Locale } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { useOwnProfile, useUpdateProfile } from '../../src/features/profile/hooks';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { radius, space, useTheme } from '../../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FormScreen,
  MicroLabel,
  Screen,
  ScreenHeader,
  SegmentedControl,
  useSafeBack,
} from '../../src/components/ui';
import { ConfirmationDialog, useToast } from '../../src/components/overlays';
import { SkeletonList } from '../../src/components/states';

/**
 * Edit profile (design 2026-08-31): name, phone, preferred language. Email is
 * deliberately not editable here — it changes through re-verification (spec
 * 05.18). Language choice persists via the same setLocale path as Settings,
 * WITHOUT flipping direction mid-navigation (the boot hook reconciles it).
 * Unsaved edits prompt before leaving (spec `dirty` state).
 */
export default function EditProfileScreen() {
  const { t, locale, setLocale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const safeBack = useSafeBack();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [lang, setLang] = useState<Locale>(locale);
  const [initial, setInitial] = useState<{ name: string; phone: string; lang: Locale } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (profile.data && !initial) {
      const storedLang: Locale = profile.data.preferred_lang === 'ar' ? 'ar' : 'en';
      setName(profile.data.full_name ?? '');
      setPhone(profile.data.phone ?? '');
      setLang(storedLang);
      setInitial({ name: profile.data.full_name ?? '', phone: profile.data.phone ?? '', lang: storedLang });
    }
  }, [profile.data, initial]);

  const dirty =
    initial !== null && (name !== initial.name || phone !== initial.phone || lang !== initial.lang);

  const onBack = () => {
    if (dirty && !update.isPending) setDiscardOpen(true);
    else safeBack();
  };

  const onSave = () => {
    setError(null);
    setNameError(null);
    setPhoneError(null);
    if (!name.trim()) return setNameError(t('auth.nameRequired'));
    // Required from day one (spec 05.3): the desk calls it about bookings, and
    // the booking path refuses without it — so it cannot be cleared here.
    if (!phone.trim()) return setPhoneError(t('auth.phoneRequired'));
    update.mutate(
      { full_name: name.trim(), phone: phone.trim() },
      {
        onSuccess: async () => {
          if (lang !== locale) await setLocale(lang, { flip: false });
          toast(t('profile.updated'));
          router.back();
        },
        onError: (err) => setError(t(mapErrorToKey(err))),
      },
    );
  };

  return (
    <Screen>
      <ScreenHeader title={t('profile.editProfile')} onBack={onBack} />
      {profile.isLoading && !initial ? (
        <SkeletonList rows={3} height={64} />
      ) : (
        <FormScreen contentStyle={{ paddingTop: 4 }}>
          <Field
            label={t('profile.name')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            dense
            error={nameError}
          />
          <Field
            label={t('auth.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            dense
            error={phoneError}
          />
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

          <View
            style={{
              marginTop: space.sm,
              backgroundColor: colors.sub,
              borderRadius: radius.cell,
              paddingStart: 13,
              paddingEnd: 13,
              paddingTop: 11,
              paddingBottom: 11,
            }}
          >
            <Text
              style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 18, color: colors.mut }}
            >
              {t('profile.emailLocked', { email: session?.user.email ?? '' })}
            </Text>
          </View>

          <ErrorText>{error}</ErrorText>
          <Button
            label={t('profile.saveChanges')}
            variant="cta"
            busy={update.isPending}
            onPress={onSave}
            style={{ marginTop: 6 }}
          />
        </FormScreen>
      )}

      <ConfirmationDialog
        visible={discardOpen}
        title={t('profile.discardTitle')}
        body={t('profile.discardBody')}
        confirmLabel={t('profile.discard')}
        cancelLabel={t('profile.keepEditing')}
        danger
        onConfirm={() => {
          setDiscardOpen(false);
          safeBack();
        }}
        onDismiss={() => setDiscardOpen(false)}
      />
    </Screen>
  );
}
