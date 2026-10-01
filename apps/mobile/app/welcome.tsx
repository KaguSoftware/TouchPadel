import { Image, View } from 'react-native';
import { Text } from '../src/i18n/text';
import { useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { formatTime, isolate } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../src/i18n/LocaleProvider';
import { mirror } from '../src/i18n/direction';
import { usePendingSlot } from '../src/features/booking/pendingSlot';
import { clearPendingIntents } from '../src/features/booking/pendingIntent';
import { usePendingJoin } from '../src/features/matches/pendingJoin';
import { brand, radius, useTheme } from '../src/theme';
import { Button } from '../src/components/ui';
import { useBack } from '../src/navigation/back';
import { PadelBallIcon } from '../src/components/icons';

const LOGO_H = 44;
const LOGO_W = Math.round(LOGO_H * (900 / 332));

/**
 * Welcome (design 2026-08-31): blue gradient brand moment. Reached when a
 * signed-out guest needs an account — usually having tapped a free slot, which
 * shows the held-for-you banner, or an open match, which shows its own. "Keep
 * browsing" clears the intent and returns.
 */
function WelcomeScreen() {
  const { t, locale, dir } = useLocale();
  const router = useRouter();
  const back = useBack();
  const insets = useSafeAreaInsets();
  const { fonts } = useTheme();
  const pending = usePendingSlot();
  // An open match the guest was about to see (a link, a slot's match, a new
  // match or the list; guest.md §4.18). Signing in never joins by itself, so
  // the banner names the match, not a seat. A held slot wins: it is the one
  // with a clock on it.
  const pendingJoin = usePendingJoin();

  const pendingLabel = pending
    ? `${pickLocale({ en: pending.courtNameEn, ar: pending.courtNameAr }, locale)} · ${formatTime(
        new Date(pending.startAt),
        locale,
      )}`
    : '';
  const banner = pending
    ? t('auth.pendingSlotBanner', { label: isolate(pendingLabel) })
    : pendingJoin
      ? t('matches.link.pendingBanner')
      : null;

  return (
    // The design's 168deg three-stop ramp; art bleeds under the status bar.
    // Gradient stops are physical fractions, so its slight tilt is mirrored here.
    <LinearGradient
      colors={[...brand.welcomeGradient]}
      locations={[0, 0.55, 1]}
      start={{ x: dir === 'rtl' ? 0.6 : 0.4, y: 0 }}
      end={{ x: dir === 'rtl' ? 0.4 : 0.6, y: 1 }}
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
        }}
      >
        {/* Symmetric about its axis, and a brand mark: never mirrored. */}
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
            // Arabic drops its tails well under the baseline; the Latin-caps
            // line box clips them (same 1.45 ratio as Title in ui.tsx).
            lineHeight: dir === 'rtl' ? 49 : 35,
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
          style={[{ marginTop: 10 }, mirror(dir)]}
        >
          <Path d="M2 8C32 1.5 74 1.5 108 5.5" stroke={brand.green} strokeWidth={4} strokeLinecap="round" />
        </Svg>

        {banner ? (
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
              {banner}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ paddingStart: 20, paddingEnd: 20, paddingBottom: 26 + insets.bottom, gap: 9 }}>
        {/* Both lead to a password screen with phone (default) and email segments
            (phone-only 2026-09-15; email restored beside it 2026-09-20). Create
            account is the green CTA, as designed. */}
        <Button
          testID="welcome.sign-in"
          label={t('auth.signIn')}
          onPress={() => router.push('/sign-in')}
          variant="secondary"
          style={{ backgroundColor: brand.white, borderWidth: 0 }}
          labelColor={brand.welcomeInk}
        />
        <Button
          testID="welcome.sign-up"
          label={t('auth.signUp')}
          onPress={() => router.push('/sign-up')}
          variant="cta"
        />
        <Button
          testID="welcome.keep-browsing"
          label={t('auth.keepBrowsing')}
          onPress={() => {
            clearPendingIntents();
            // Reached by redirect from a gated deep link too — no history there.
            back();
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
