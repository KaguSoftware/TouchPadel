import { useState } from 'react';
import { Alert, Image, ScrollView, View } from 'react-native';
import { Text } from '../../src/i18n/text';
import { useRouter } from 'expo-router';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { isolate, isolateLtr } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { profileGateState } from '../../src/features/auth/social';
import { hasRealEmail, phoneOtpEnabled } from '../../src/features/auth/phoneOtp';
import { hasPasswordSignIn } from '../../src/features/profile/changePasswordFlow';
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
import { LockIcon, PencilIcon, PhoneIcon, SlidersIcon, TrashIcon } from '../../src/components/icons';
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
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
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

  // Native UIAlertController (Alert.alert) for the sign-out confirmation:
  // same copy and buttons as the in-app dialog, default iOS chrome. Note it
  // follows the SYSTEM language's direction, so an Arabic app on an English
  // phone shows an LTR alert with English button order.
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
  // The whole identity card is LTR in BOTH locales: avatar on the left, then the
  // text column. `direction: 'ltr'` on the row stops RN's RTL layout mirroring it
  // in Arabic; LRI + writingDirection keep the values themselves LTR, since a "+"
  // prefix and an email are structurally left-to-right whatever the UI language.
  // `auto` rather than a physical 'left' (the RTL guard forbids those outside
  // ui.tsx): with writingDirection ltr it already resolves to left, which is
  // what main's version of this card used at these same three spots.
  const idStyle = { textAlign: 'auto', writingDirection: 'ltr' } as const;
  const detailLine = profile.data?.phone ? isolateLtr(profile.data.phone) : '';

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
          <Card style={{ flexDirection: 'row', direction: 'ltr', gap: 13, alignItems: 'center' }}>
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
            {/* 'stretch' (not 'flex-start') so each line spans the full column and
                textAlign decides the edge; shrink-wrapping left the three lines at
                ragged widths instead of flush against the avatar. `gap` spaces the
                three evenly — with an explicit lineHeight on each, so the 16px name
                does not add extra leading and make its gap read wider than the
                12px lines' gap. */}
            <View style={{ flex: 1, minWidth: 0, alignItems: 'stretch', gap: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 16,
                  lineHeight: 20,
                  color: colors.ink,
                  ...idStyle,
                }}
              >
                {isolateLtr(name)}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12,
                  lineHeight: 16,
                  color: colors.mut,
                  ...idStyle,
                }}
                numberOfLines={1}
              >
                {isolateLtr(email)}
              </Text>
              {/* Design: "{phone}" on the third line, dropped when unset. */}
              {detailLine ? (
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: fonts.body400,
                    fontSize: 12,
                    lineHeight: 16,
                    color: colors.mut,
                    ...idStyle,
                  }}
                >
                  {detailLine}
                </Text>
              ) : null}
            </View>
          </Card>

          {profileGateState(profile) === 'incomplete' ? (
            // D3: a social sign-in that left before completing its profile.
            <Card style={{ marginTop: space.m, backgroundColor: colors.amb, borderColor: colors.ambline }}>
              <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 19, color: colors.ambtext }}>
                {/* A phone sign-up (OTP scaffold) has the phone and lacks the name; every other case lacks the phone. */}
                {t(profile.data?.phone ? 'profile.completeNameNudge' : 'profile.completeProfileNudge')}
              </Text>
              <Button
                label={t(profile.data?.phone ? 'auth.addNameLink' : 'auth.addPhoneLink')}
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
            {/* No password exists for a phone-only account, and a desk-created
              walk-in's synthetic address has no mailbox to recover to. */}
            {/* …and only for an account that HAS a password: a guest who only
              ever signed in with Google or Apple has none, and for them every
              "current password" is wrong — the row looked broken, not absent. */}
            {hasRealEmail(session?.user) && hasPasswordSignIn(session?.user) ? (
              <MenuRow
                icon={<LockIcon size={15} color={colors.gstrong} />}
                label={t('profile.changePassword')}
                onPress={() => router.push('/change-password')}
              />
            ) : null}
            {/* Phone OTP scaffold (dormant): an email / social account verifies
              its number once so a later phone sign-in lands on THIS account. */}
            {phoneOtpEnabled() && !session?.user.phone ? (
              <MenuRow
                icon={<PhoneIcon size={15} color={colors.gstrong} />}
                label={t('auth.verifyPhoneRow')}
                onPress={() => router.push({ pathname: '/phone-sign-in', params: { mode: 'link' } })}
              />
            ) : null}
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
            />
            {/* SEC-16. Last in the list and rendered in the error colour: both
              stores require account deletion to be reachable from inside the
              app, and this row is the path. It pushes a screen with a typed
              confirmation rather than opening a dialog — the act is not
              undoable, and an Alert is what a mis-tap dismisses by habit. */}
            <MenuRow
              icon={<TrashIcon size={15} color={colors.redtext} />}
              iconBg={colors.redtint}
              label={t('profile.deleteAccount')}
              onPress={() => router.push('/delete-account')}
              last
            />
          </View>

          <ErrorText>{error}</ErrorText>

          {/* A quiet outline, not a red one. Signing out is reversible and the
              native alert already marks it destructive; painted red it stood
              next to Delete account as a second alarm, and in dark mode coral
              text in a blue outline on navy did not read as anything (owner,
              2026-09-11). The one red on this screen is the row that earns it. */}
          <Button
            label={t('auth.signOut')}
            variant="secondary"
            size="medium"
            onPress={confirmSignOut}
            style={{ marginTop: space.m, backgroundColor: 'transparent' }}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
