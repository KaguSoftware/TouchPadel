import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
import {
  openNowInfo,
  venuePhoneOf,
  type VenueSettingsPublic,
} from '../../src/features/availability/assemble';
import { useAuth } from '../../src/features/auth/context';
import { registerPushToken } from '../../src/features/profile/push';
import { addBreadcrumb } from '../../src/lib/telemetry';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import { DegradedBanner } from '../../src/components/booking';
import { ChevronIcon } from '../../src/components/icons';
import { CourtIllustration } from '../../src/components/CourtIllustration';

/** logo.png is 900×332: a 30 pt tall wordmark is 81 pt wide (design lets height drive width). */
const LOGO_H = 30;
const LOGO_W = Math.round(LOGO_H * (900 / 332));

/**
 * The "Open now · 09:00–02:00" pill. Owns the minute clock so the rest of the
 * screen — the animated court in particular — does not re-render every minute.
 */
function OpenNowPill({ settings }: { settings: VenueSettingsPublic | undefined }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const info = useMemo(() => openNowInfo(settings, now), [settings, now]);
  if (!info) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: radius.pill,
          backgroundColor: info.open ? brand.green : colors.fnt2,
        }}
      />
      <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: colors.mut }}>
        {info.open ? t('courts.openNow', { hours: info.label }) : t('courts.closedNow')}
      </Text>
    </View>
  );
}

/**
 * Book tab (design "Courts" screen): brand header with the open-now pill, the
 * animated court, and one big green CTA into the merged availability grid.
 * Public — browsing needs no session (owner decision 2026-08-31).
 */
export default function BookHomeScreen() {
  const { t } = useLocale();
  const { colors, fonts, appearance, tracking } = useTheme();
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const { height: windowHeight } = useWindowDimensions();
  const { session } = useAuth();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();

  // Best-effort push registration once signed in. The outcome is recorded.
  useEffect(() => {
    if (!session) return;
    void registerPushToken().then((state) => addBreadcrumb('push.register', { state }));
  }, [session]);

  const phone = venuePhoneOf(settings.data);

  return (
    <Screen padded={false} style={{ backgroundColor: colors.page }}>
      {/* Header: logo + open-now pill */}
      <View
        style={{
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: 10,
          paddingBottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
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
        <OpenNowPill settings={settings.data} />
      </View>

      {degraded ? (
        <View style={{ marginTop: space.s, marginStart: space.l, marginEnd: space.l }}>
          <DegradedBanner
            lead={t('degraded.leadConnectionLost')}
            message={t('degraded.bannerCourts', { phone: phone ?? '' })}
            phone={phone}
          />
        </View>
      ) : null}

      <View style={{ paddingStart: space.l, paddingEnd: space.l, paddingTop: space.sm }}>
        <Title>{t('booking.title')}</Title>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingStart: 18,
          paddingEnd: 18,
          paddingTop: space.xl,
          paddingBottom: tabBarHeight + 24,
          gap: space.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Capped so "Check availability" stays above the fold on small phones. */}
        <CourtIllustration maxHeight={Math.round(windowHeight * 0.46)} />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/availability')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            borderRadius: 18,
            padding: 26,
            backgroundColor: brand.green,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 19,
              letterSpacing: tracking(1.33),
              textTransform: 'uppercase',
              color: brand.greenInk,
            }}
          >
            {t('courts.viewAvailability')}
          </Text>
          <ChevronIcon size={26} color={brand.greenInk} strokeWidth={2.6} />
        </Pressable>

        <Text
          style={{
            textAlign: 'center',
            fontFamily: fonts.body400,
            fontSize: 11.5,
            color: colors.fnt,
          }}
        >
          {t('courts.reserveFooter')}
        </Text>
      </ScrollView>
    </Screen>
  );
}
