import { Image, Text, View , I18nManager } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { formatTime, type Locale } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { clearPendingSlot, getPendingSlot } from '../../src/features/booking/pendingSlot';
import { brand, radius, useTheme } from '../../src/theme';
import { Button } from '../../src/components/ui';
import { PadelBallIcon } from '../../src/components/icons';

/**
 * Welcome (design 2026-08-31): blue gradient brand moment. Reached when a
 * signed-out guest needs an account — usually having tapped a free slot, which
 * shows the held-for-you banner. "Keep browsing" clears the intent and returns.
 *
 * The gradient is approximated with the mid blue: expo-linear-gradient is not
 * in the dependency set and the 3-stop 168deg ramp reads as one blue on device.
 */
export default function WelcomeScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fonts } = useTheme();
  const pending = getPendingSlot();

  const pendingLabel = pending
    ? `${pickLocale({ en: pending.courtNameEn, ar: pending.courtNameAr }, locale as Locale)} · ${formatTime(
        new Date(pending.startAt),
        locale,
      )}`
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: brand.blue }}>
      {/* Oversized brand ball, bleeding off the trailing edge */}
      <View
        style={{
          position: 'absolute',
          top: 44 + insets.top,
          end: -58,
          opacity: 0.13,
          transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }],
        }}
      >
        <PadelBallIcon size={210} fill="#FFFFFF" stroke={brand.blue} />
      </View>

      <View style={{ flex: 1, justifyContent: 'center', paddingStart: 26, paddingEnd: 26 }}>
        <Image
          source={require('../../assets/logo-white.png')}
          style={{ height: 44, width: 170, resizeMode: 'contain', alignSelf: 'flex-start' }}
          accessibilityLabel={t('common.appName')}
        />
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 34,
            lineHeight: 36,
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
          style={{ marginTop: 10, transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
        >
          <Path d="M2 8C32 1.5 74 1.5 108 5.5" stroke={brand.green} strokeWidth={4} strokeLinecap="round" />
        </Svg>

        {pending ? (
          <View
            style={{
              marginTop: 14,
              backgroundColor: '#FFFFFF22',
              borderWidth: 1,
              borderColor: '#FFFFFF36',
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
              {t('auth.pendingSlotBanner', { label: pendingLabel })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ paddingStart: 20, paddingEnd: 20, paddingBottom: 26 + insets.bottom, gap: 9 }}>
        <Button
          label={t('auth.signIn')}
          onPress={() => router.push('/(auth)/sign-in')}
          variant="secondary"
          style={{ backgroundColor: brand.white, borderWidth: 0 }}
          labelColor="#132038"
        />
        <Button label={t('auth.signUp')} onPress={() => router.push('/(auth)/sign-up')} variant="cta" />
        <Button
          label={t('auth.keepBrowsing')}
          onPress={() => {
            clearPendingSlot();
            router.back();
          }}
          variant="ghost"
          labelColor="#B9C6DE"
        />
      </View>
    </View>
  );
}
