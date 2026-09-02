import { useState } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { profileGateState } from '../../src/features/auth/social';
import { supabase } from '../../src/lib/supabase';
import { signOut } from '../../src/features/auth/api';
import { useOwnProfile } from '../../src/features/profile/hooks';
import { useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { callPhone } from '../../src/lib/phone';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Card, ErrorText, Screen, Title } from '../../src/components/ui';
import { MenuRow } from '../../src/components/booking';
import { LockIcon, PencilIcon, PhoneIcon, SlidersIcon } from '../../src/components/icons';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';

const LOGO_H = 40;
const LOGO_W = Math.round(LOGO_H * (900 / 332));

/**
 * Profile tab (design 2026-08-31): avatar card + menu rows when signed in;
 * the sign-in / create-account pitch when signed out (browsing is public).
 */
export default function ProfileScreen() {
  const { t } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const router = useRouter();
  const tabBarHeight = useTabBarHeight();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const settings = useVenueSettings();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const phone = venuePhoneOf(settings.data);
  const onCallVenue = () => {
    if (!phone) {
      // Not a connectivity problem: the venue simply has no number published.
      toast(t('settings.phoneUnavailable'), 'info');
      return;
    }
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone }), 'error');
    });
  };

  const onSignOut = async () => {
    setError(null);
    setSigningOut(true);
    try {
      await signOut(supabase);
      router.replace('/(tabs)');
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setSigningOut(false);
    }
  };

  // Native confirm, same shape as PetApp's account settings: Cancel, then the
  // destructive Sign out.
  const confirmSignOut = () => {
    if (signingOut) return;
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void onSignOut() },
    ]);
  };

  const header = (
    <View style={{ paddingTop: space.l }}>
      <Title>{t('profile.title')}</Title>
    </View>
  );

  if (!session) {
    return (
      <Screen>
        {header}
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingStart: 12, // + the 16 gutter = the design's 28
            paddingEnd: 12,
            paddingBottom: tabBarHeight + 24,
          }}
        >
          <Image
            source={
              appearance === 'dark'
                ? require('../../assets/logo-white.png')
                : require('../../assets/logo.png')
            }
            resizeMode="contain"
            style={{ height: LOGO_H, width: LOGO_W }}
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
            onPress={() => router.push('/sign-in')}
            style={{ alignSelf: 'stretch', marginTop: space.xl }}
          />
          <Button
            label={t('auth.signUp')}
            variant="cta"
            onPress={() => router.push('/sign-up')}
            style={{ alignSelf: 'stretch', marginTop: 9 }}
          />
        </View>
      </Screen>
    );
  }

  const name = profile.data?.full_name ?? '';
  const email = session.user.email ?? '';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ||
    email.slice(0, 1).toUpperCase() ||
    '•';
  const langLabel =
    profile.data?.preferred_lang === 'ar' ? t('settings.arabic') : t('settings.english');
  // The phone is Latin digits sitting next to an Arabic label around a '·'
  // separator: without an isolate the bidi algorithm reorders the number
  // against the separator in RTL. Same reason the email is isolated below.
  const detailLine = [profile.data?.phone ? isolate(profile.data.phone) : null, langLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen>
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
          contentContainerStyle={{ paddingBottom: tabBarHeight + 24 }}
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
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink, textAlign: 'auto' }}
              >
                {isolate(name)}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12,
                  color: colors.mut,
                  marginTop: 2,
                  textAlign: 'auto',
                }}
                numberOfLines={1}
              >
                {isolate(email)}
              </Text>
              {/* Design: "{phone} · {language}" on the third line. */}
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, textAlign: 'auto' }}
              >
                {detailLine}
              </Text>
            </View>
          </Card>

          {profileGateState(profile) === 'incomplete' ? (
            // D3: a social sign-in that left before completing its profile.
            <Card style={{ marginTop: space.m, backgroundColor: colors.amb, borderColor: colors.ambline }}>
              <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 19, color: colors.ambtext }}>
                {t('profile.completeProfileNudge')}
              </Text>
              <Button
                label={t('auth.addPhoneLink')}
                variant="secondary"
                size="compact"
                onPress={() => router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } })}
                labelColor={colors.ambstrong}
                style={{ marginTop: 10, alignSelf: 'flex-start', backgroundColor: 'transparent', borderColor: colors.ambstrong }}
              />
            </Card>
          ) : null}

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
              onPress={onCallVenue}
              disabled={settings.isLoading}
              last
            />
          </View>

          <ErrorText>{error}</ErrorText>

          <Button
            label={t('auth.signOut')}
            variant="secondary"
            size="medium"
            onPress={confirmSignOut}
            labelColor={colors.redtext}
            style={{ marginTop: space.m, backgroundColor: 'transparent' }}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
