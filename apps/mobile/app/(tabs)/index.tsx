import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
import { openNowInfo, venuePhoneOf } from '../../src/features/availability/assemble';
import { useAuth } from '../../src/features/auth/context';
import { registerPushToken } from '../../src/features/profile/push';
import { addBreadcrumb } from '../../src/lib/telemetry';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import { DegradedBanner } from '../../src/components/booking';
import { ChevronIcon } from '../../src/components/icons';
import { CourtIllustration } from '../../src/components/CourtIllustration';

/**
 * Book tab (design "Courts" screen): brand header with the open-now pill, the
 * animated court, and one big green CTA into the merged availability grid.
 * Public — browsing needs no session (owner decision 2026-08-31).
 */
export default function BookHomeScreen() {
  const { t } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();

  // Best-effort push registration once signed in. The outcome is recorded.
  useEffect(() => {
    if (!session) return;
    void registerPushToken().then((state) => addBreadcrumb('push.register', { state }));
  }, [session]);

  // Re-evaluate the pill every minute; openNowInfo itself is pure.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const openInfo = useMemo(() => openNowInfo(settings.data, now), [settings.data, now]);
  const phone = venuePhoneOf(settings.data);

  return (
    <Screen padded={false} style={{ backgroundColor: colors.page, paddingTop: insets.top }}>
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
          style={{ height: 30, width: 120, resizeMode: 'contain' }}
          accessibilityLabel={t('common.appName')}
        />
        {openInfo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: radius.pill,
                backgroundColor: openInfo.open ? brand.green : colors.fnt2,
              }}
            />
            <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: colors.mut }}>
              {openInfo.open
                ? t('courts.openNow', { hours: openInfo.label })
                : t('courts.closedNow')}
            </Text>
          </View>
        ) : null}
      </View>

      {degraded ? (
        <View style={{ marginTop: space.s, marginStart: space.l, marginEnd: space.l }}>
          <DegradedBanner message={t('degraded.bannerCourts', { phone: phone ?? '' })} />
        </View>
      ) : null}

      <View style={{ paddingStart: space.l, paddingEnd: space.l, paddingTop: space.sm }}>
        <Title>{t('booking.title')}</Title>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingStart: 18,
          paddingEnd: 18,
          paddingTop: space.xs,
          paddingBottom: 24,
          gap: space.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CourtIllustration />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/availability')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            borderRadius: 18,
            paddingTop: 24,
            paddingBottom: 24,
            backgroundColor: brand.green,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 19,
              letterSpacing: 1.33,
              textTransform: 'uppercase',
              color: brand.greenInk,
            }}
          >
            {t('courts.viewAvailability')}
          </Text>
          <ChevronIcon size={24} color={brand.greenInk} strokeWidth={2.6} />
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
