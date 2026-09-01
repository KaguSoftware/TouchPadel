import { Image, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { formatTime, isolate } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../src/i18n/LocaleProvider';
import { clearPendingSlot, usePendingSlot } from '../src/features/booking/pendingSlot';
import { brand, radius, useTheme } from '../src/theme';
import { Button, useSafeBack } from '../src/components/ui';
import { PadelBallIcon } from '../src/components/icons';

const LOGO_H = 44;
const LOGO_W = Math.round(LOGO_H * (900 / 332));

/**
 * Welcome (design 2026-08-31): blue gradient brand moment. Reached when a
 * signed-out guest needs an account — usually having tapped a free slot, which
 * shows the held-for-you banner. "Keep browsing" clears the intent and returns.
 */
function WelcomeScreen() {
  const { t, locale, dir } = useLocale();
  const router = useRouter();
  const safeBack = useSafeBack();
  const insets = useSafeAreaInsets();
  const { fonts } = useTheme();
  const pending = usePendingSlot();

  const pendingLabel = pending
    ? `${pickLocale({ en: pending.courtNameEn, ar: pending.courtNameAr }, locale)} · ${formatTime(
        new Date(pending.startAt),
        locale,
      )}`
    : '';

  return (
    // The design's 168deg three-stop ramp; art bleeds under the status bar.
    <LinearGradient
      colors={[...brand.welcomeGradient]}
      locations={[0, 0.55, 1]}
      start={{ x: 0.4, y: 0 }}
      end={{ x: 0.6, y: 1 }}
      style={{ flex: 1 }}
    >
      <StatusBar style="light" />
      {/* Oversized brand ball, bleeding off the trailing edge */}
      <View
        style={{
          position: 'absolute',
          top: 44,
          end: -58,
          opacity: 0.13,
          transform: [{ scaleX: dir === 'rtl' ? -1 : 1 }],
        }}
      >
        <PadelBallIcon size={210} fill={brand.white} stroke={brand.blue} strokeWidth={2.2} />
      </View>

      <View style={{ flex: 1, justifyContent: 'center', paddingStart: 26, paddingEnd: 26 }}>
        <Image
          source={require('../assets/logo-white.png')}
          resizeMode="contain"
          style={{ height: LOGO_H, width: LOGO_W, alignSelf: 'flex-start' }}
          accessibilityLabel={t('common.appName')}
        />
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 34,
            lineHeight: 35,
            textTransform: 'uppercase',
            color: brand.white,
            marginTop: 22,
          }}
        >
          {t('auth.welcomeHeadline')}
        </Text>
        <Svg
          width={110}
          height={10}
          viewBox="0 0 110 10"
          fill="none"
          style={{ marginTop: 10, transform: [{ scaleX: dir === 'rtl' ? -1 : 1 }] }}
        >
          <Path d="M2 8C32 1.5 74 1.5 108 5.5" stroke={brand.green} strokeWidth={4} strokeLinecap="round" />
        </Svg>

        {pending ? (
          <View
            style={{
              marginTop: 14,
              backgroundColor: `${brand.white}22`,
              borderWidth: 1,
              borderColor: `${brand.white}36`,
              borderRadius: radius.cell,
              paddingStart: 13,
              paddingEnd: 13,
              paddingTop: 10,
              paddingBottom: 10,
            }}
          >
            <Text
              style={{ fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 19, color: brand.white }}
            >
              {t('auth.pendingSlotBanner', { label: isolate(pendingLabel) })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ paddingStart: 20, paddingEnd: 20, paddingBottom: 26 + insets.bottom, gap: 9 }}>
        <Button
          label={t('auth.signIn')}
          onPress={() => router.push('/sign-in')}
          variant="secondary"
          style={{ backgroundColor: brand.white, borderWidth: 0 }}
          labelColor={brand.welcomeInk}
        />
        <Button label={t('auth.signUp')} onPress={() => router.push('/sign-up')} variant="cta" />
        <Button
          label={t('auth.keepBrowsing')}
          onPress={() => {
            clearPendingSlot();
            // Reached by redirect from a gated deep link too — no history there.
            safeBack();
          }}
          variant="ghost"
          labelColor={brand.navyText}
        />
      </View>
    </LinearGradient>
  );
}

/**
 * Signed-out only, on the ROOT stack. The `(auth)` group carried this rule in
 * its layout; flattening it is what lets UIKit draw its own back item here
 * instead of a JS stand-in. See RequireNoSession for the pending-slot
 * exemption that keeps the post-auth booking continuation working.
 */
export default function GuardedWelcomeScreen() {
  return (
    <RequireNoSession>
      <WelcomeScreen />
    </RequireNoSession>
  );
}
