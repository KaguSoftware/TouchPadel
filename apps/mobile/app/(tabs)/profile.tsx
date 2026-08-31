import { Image, Linking, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { supabase } from '../../src/lib/supabase';
import { signOut } from '../../src/features/auth/api';
import { useOwnProfile } from '../../src/features/profile/hooks';
import { useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Card, Screen, Title } from '../../src/components/ui';
import { MenuRow } from '../../src/components/booking';
import { LockIcon, PencilIcon, PhoneIcon, SlidersIcon } from '../../src/components/icons';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import { useState } from 'react';

/**
 * Profile tab (design 2026-08-31): avatar card + menu rows when signed in;
 * the sign-in / create-account pitch when signed out (browsing is public).
 */
export default function ProfileScreen() {
  const { t } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const settings = useVenueSettings();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const phone = venuePhoneOf(settings.data);
  const callVenue = () => {
    if (phone) void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
  };

  const onSignOut = async () => {
    try {
      await signOut(supabase);
      router.replace('/(tabs)');
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    }
  };

  const header = (
    <View style={{ paddingTop: space.l }}>
      <Title>{t('profile.title')}</Title>
    </View>
  );

  if (!session) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        {header}
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingStart: 12,
            paddingEnd: 12,
            paddingBottom: 90,
          }}
        >
          <Image
            source={
              appearance === 'dark'
                ? require('../../assets/logo-white.png')
                : require('../../assets/logo.png')
            }
            style={{ height: 40, width: 160, resizeMode: 'contain' }}
            accessibilityLabel={t('common.appName')}
          />
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 13.5,
              lineHeight: 22,
              color: colors.mut,
              marginTop: space.m,
              textAlign: 'center',
            }}
          >
            {t('auth.signedOutPitch')}
          </Text>
          <Button
            label={t('auth.signIn')}
            variant="primary"
            onPress={() => router.push('/(auth)/sign-in')}
            style={{ alignSelf: 'stretch', marginTop: space.xl }}
          />
          <Button
            label={t('auth.signUp')}
            variant="cta"
            onPress={() => router.push('/(auth)/sign-up')}
            style={{ alignSelf: 'stretch', marginTop: 9 }}
          />
        </View>
      </Screen>
    );
  }

  const name = profile.data?.full_name ?? '';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Screen style={{ paddingTop: insets.top }}>
      {header}
      {profile.isLoading ? (
        <SkeletonList rows={2} height={90} />
      ) : profile.isError ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(profile.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void profile.refetch()}
          busy={profile.isRefetching}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 90 }}
          showsVerticalScrollIndicator={false}
        >
          <Card style={{ flexDirection: 'row', gap: 13, alignItems: 'center' }}>
            <View
              style={{
                width: 50,
                height: 50,
                borderRadius: radius.pill,
                backgroundColor: brand.blue,
                borderWidth: 2.5,
                borderColor: brand.green,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: brand.white }}>
                {initials}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink }}>
                {name}
              </Text>
              <Text
                style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, marginTop: 2 }}
                numberOfLines={1}
              >
                {session.user.email ?? ''}
              </Text>
              {profile.data?.phone ? (
                <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                  {profile.data.phone}
                </Text>
              ) : null}
            </View>
          </Card>

          <View
            style={{
              marginTop: space.m,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card,
              overflow: 'hidden',
            }}
          >
            <MenuRow
              icon={<PencilIcon size={15} color={colors.gstrong} />}
              label={t('profile.editProfile')}
              onPress={() => router.push('/profile-edit')}
            />
            <MenuRow
              icon={<LockIcon size={15} color={colors.gstrong} />}
              label={t('profile.changePassword')}
              onPress={() => router.push('/change-password')}
            />
            <MenuRow
              icon={<SlidersIcon size={15} color={colors.gstrong} />}
              label={t('settings.title')}
              onPress={() => router.push('/settings')}
            />
            <MenuRow
              icon={<PhoneIcon size={15} color={colors.gstrong} />}
              label={t('profile.callVenue')}
              onPress={() => {
                if (phone) callVenue();
                else toast(t('errors.network'), 'info');
              }}
              last
            />
          </View>

          {error ? (
            <Text
              style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.redtext, marginTop: 10 }}
            >
              {error}
            </Text>
          ) : null}

          <Button
            label={t('auth.signOut')}
            variant="secondary"
            onPress={() => void onSignOut()}
            labelColor={colors.redtext}
            style={{ marginTop: space.m, backgroundColor: 'transparent' }}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
