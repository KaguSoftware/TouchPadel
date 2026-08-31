import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Screen,
  ScreenHeader,
  SegmentedControl,
} from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';
import { SkeletonList } from '../../src/components/states';

/**
 * Edit profile (design 2026-08-31): name, phone, preferred language. Email is
 * deliberately not editable here — it changes through re-verification (spec
 * 05.18). Language choice persists via the same setLocale path as Settings.
 */
export default function EditProfileScreen() {
  const { t, locale, setLocale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [lang, setLang] = useState<Locale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (profile.data && !hydrated) {
      setName(profile.data.full_name ?? '');
      setPhone(profile.data.phone ?? '');
      setHydrated(true);
    }
  }, [profile.data, hydrated]);

  const onSave = () => {
    setError(null);
    if (!name.trim()) return setError(t('errors.validation'));
    update.mutate(
      { full_name: name.trim(), phone: phone.trim() || null },
      {
        onSuccess: async () => {
          if (lang !== locale) await setLocale(lang);
          toast(t('profile.updated'));
          router.back();
        },
        onError: (err) => setError(t(mapErrorToKey(err))),
      },
    );
  };

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader title={t('profile.editProfile')} />
      {profile.isLoading && !hydrated ? (
        <SkeletonList rows={3} height={64} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            label={t('profile.name')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Field
            label={t('auth.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <View style={{ marginTop: space.sm }}>
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 11,
                letterSpacing: 0.66,
                textTransform: 'uppercase',
                color: colors.mut,
                marginBottom: 5,
              }}
            >
              {t('auth.preferredLanguage')}
            </Text>
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
            style={{ marginTop: space.l }}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
