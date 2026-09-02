import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, BackHandler, Image, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
import {
  openNowInfo,
  venuePhoneOf,
  type VenueSettingsPublic,
} from '../../src/features/availability/assemble';
import { useAuth } from '../../src/features/auth/context';
import { registerPushToken } from '../../src/features/profile/push';
import { useCourtTransition } from '../../src/features/courtTransition/useCourtTransition';
import { sampleEased, SPEC } from '../../src/features/courtTransition/spec';
import { addBreadcrumb } from '../../src/lib/telemetry';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import { DegradedBanner } from '../../src/components/booking';
import { BackChevronIcon } from '../../src/components/icons';
import { CourtIllustration } from '../../src/components/CourtIllustration';
import { BookingSheet } from '../../src/components/BookingSheet';

/** logo.png is 900×332: a 30 pt tall wordmark is 81 pt wide (design lets height drive width). */
const LOGO_H = 30;
const LOGO_W = Math.round(LOGO_H * (900 / 332));
/** Room under the court for the "reserve in the app" footer line. */
const FOOTER_SPACE = 34;
/** The back button's width + gap: the title slides over to make room for it. */
const BACK_SHIFT = 44;

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
 * "Check availability", sitting ON the net (prototype: spans post to post,
 * flat 8 px navy shadow; pressing drops it onto its shadow). Fades and drops
 * away over the first quarter of the transition.
 */
function NetCta({
  progress,
  disabled,
  onPress,
}: {
  progress: Animated.Value;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useLocale();
  const { fonts, tracking } = useTheme();
  const anim = useMemo(() => {
    const table = (range: readonly [number, number], out: readonly [number, number]) =>
      progress.interpolate({ ...sampleEased(range, out, undefined, 1), extrapolate: 'clamp' });
    return {
      opacity: table(SPEC.button.fade, [1, 0]),
      translateY: table(SPEC.button.move, SPEC.button.y),
      scale: table(SPEC.button.move, SPEC.button.scale),
    };
  }, [progress]);
  return (
    <Animated.View
      pointerEvents={disabled ? 'none' : 'auto'}
      style={{
        opacity: anim.opacity,
        transform: [{ translateY: anim.translateY }, { scale: anim.scale }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          height: 50,
          borderRadius: radius.button,
          backgroundColor: brand.green,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: space.l,
          paddingEnd: space.l,
          boxShadow: pressed ? `0 0 0 ${brand.navy}` : `0 8 0 ${brand.navy}`,
          transform: [{ translateY: pressed ? 8 : 0 }],
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.display800,
            fontSize: 14,
            letterSpacing: tracking(0.7),
            textTransform: 'uppercase',
            color: brand.greenInk,
          }}
        >
          {t('courts.viewAvailability')}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Book tab (design "Courts" screen + the court → booking transition of
 * 2026-09-01): brand header with the open-now pill, the animated court with
 * "Check availability" on its net, and — in place, no navigation — the booking
 * sheet floating over the pitched court once tapped. The standalone
 * Availability route still serves the other entry points. Public — browsing
 * needs no session (owner decision 2026-08-31).
 */
export default function BookHomeScreen() {
  const { t, dir } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const tabBarHeight = useTabBarHeight();
  const { session } = useAuth();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();
  const { progress, direction, isOpen, sheetMounted, openBooking, closeBooking } =
    useCourtTransition();
  const [stageHeight, setStageHeight] = useState(0);

  // Best-effort push registration once signed in. The outcome is recorded.
  useEffect(() => {
    if (!session) return;
    void registerPushToken().then((state) => addBreadcrumb('push.register', { state }));
  }, [session]);

  // Android back reverses the transition instead of leaving the tab — only
  // while this screen is focused, so a pushed Review keeps its own back.
  useFocusEffect(
    useCallback(() => {
      if (!isOpen) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        closeBooking();
        return true;
      });
      return () => sub.remove();
    }, [isOpen, closeBooking]),
  );

  // Header: the back button fades in (0.2 → 0.5) and the title slides over.
  const header = useMemo(() => {
    const fade = progress.interpolate({
      ...sampleEased(SPEC.back.fade, [0, 1], undefined, 1),
      extrapolate: 'clamp',
    });
    const shift = progress.interpolate({
      ...sampleEased(SPEC.back.fade, [0, dir === 'rtl' ? -BACK_SHIFT : BACK_SHIFT], undefined, 1),
      extrapolate: 'clamp',
    });
    const footer = progress.interpolate({
      ...sampleEased(SPEC.button.fade, [1, 0], undefined, 1),
      extrapolate: 'clamp',
    });
    return { fade, shift, footer };
  }, [progress, dir]);

  const phone = venuePhoneOf(settings.data);
  const courtMaxHeight = Math.max(0, stageHeight - tabBarHeight - FOOTER_SPACE - space.s);

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

      {/* Title row: [back to the court] BOOK A COURT */}
      <View style={{ paddingStart: space.l, paddingEnd: space.l, paddingTop: space.sm }}>
        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          style={{ position: 'absolute', start: space.l, top: space.sm, opacity: header.fade }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('booking.backToCourt')}
            hitSlop={8}
            onPress={closeBooking}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.sub : colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <BackChevronIcon size={17} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: header.shift }] }}>
          <Title>{t('booking.title')}</Title>
        </Animated.View>
      </View>

      {/* Stage: the court fills what is left above the tab bar; the sheet floats over it. */}
      <View style={{ flex: 1 }} onLayout={(e) => setStageHeight(e.nativeEvent.layout.height)}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingStart: 18,
            paddingEnd: 18,
            paddingBottom: tabBarHeight + FOOTER_SPACE,
          }}
        >
          {stageHeight > 0 ? (
            <CourtIllustration
              maxHeight={courtMaxHeight}
              progress={progress}
              direction={direction}
              netOverlay={<NetCta progress={progress} disabled={isOpen} onPress={openBooking} />}
            />
          ) : null}
        </View>

        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            start: space.l,
            end: space.l,
            bottom: tabBarHeight + 12,
            opacity: header.footer,
          }}
        >
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
        </Animated.View>

        {sheetMounted ? (
          <BookingSheet progress={progress} direction={direction} bottomInset={tabBarHeight} />
        ) : null}
      </View>
    </Screen>
  );
}
