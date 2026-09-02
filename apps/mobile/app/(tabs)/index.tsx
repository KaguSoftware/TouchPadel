import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import {
  lerp,
  pitchEase,
  sampleCurve,
  sampleEased,
  SPEC,
  type Range,
} from '../../src/features/courtTransition/spec';
import {
  courtTopFraction,
  makeCamera,
  projectNet,
} from '../../src/features/courtTransition/camera';
import { addBreadcrumb } from '../../src/lib/telemetry';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import { DegradedBanner } from '../../src/components/booking';
import { BackChevronIcon } from '../../src/components/icons';
import { Court3D } from '../../src/components/Court3D';
import { CourtIllustration } from '../../src/components/CourtIllustration';
import { BookingSheet } from '../../src/components/BookingSheet';

/** logo.png is 900×332: a 30 pt tall wordmark is 81 pt wide (design lets height drive width). */
const LOGO_H = 30;
const LOGO_W = Math.round(LOGO_H * (900 / 332));
/** The back button's width + gap: the title slides over to make room for it. */
const BACK_SHIFT = 44;
/** The on-net button (prototype: 16 px padding round a 16 px line, top = tape − 24). */
const CTA_H = 48;
/** Room under the flat fallback court for the "reserve in the app" footer line. */
const FOOTER_SPACE = 34;
/** The stage's court box: everything above the tab bar (`top` / `bottom` are added per render). */
const stageBounds = { position: 'absolute', start: 0, end: 0 } as const;
/**
 * The camera leaves a blank band above the far wall (≈ 11 % of the box: it
 * looks 0.8 m past the net). The GL box starts that far ABOVE the stage, under
 * the title, so the court's far wall sits COURT_GAP below the title instead of
 * floating under a band of page colour (Parsa, device, 2026-09-02).
 */
const COURT_TOP_BAND = courtTopFraction();
const COURT_GAP = 8;

/**
 * The "Open now · 09:00–02:00" pill. Owns the minute clock so the rest of the
 * screen — the GL court in particular — does not re-render every minute.
 */
function OpenNowPill({ settings }: { settings: VenueSettingsPublic | undefined }) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const info = useMemo(() => openNowInfo(settings, now), [settings, now]);
  if (!info) return null;
  return (
    <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
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
 * lime on a flat 8 px navy shadow; pressing drops it onto the shadow). Fades
 * and drops away over the first quarter of the transition. `hidden` = the
 * sheet is up: no touches, and nothing for a screen reader to land on.
 */
function NetCta({
  progress,
  hidden,
  onPress,
}: {
  progress: Animated.Value;
  hidden: boolean;
  onPress: () => void;
}) {
  const { t } = useLocale();
  const { fonts, tracking } = useTheme();
  const anim = useMemo(() => {
    const table = (range: Range, out: Range) =>
      progress.interpolate({ ...sampleEased(range, out, undefined, 1), extrapolate: 'clamp' });
    return {
      opacity: table(SPEC.button.fade, [1, 0]),
      translateY: table(SPEC.button.move, SPEC.button.y),
      scale: table(SPEC.button.move, SPEC.button.scale),
    };
  }, [progress]);
  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={{
        opacity: anim.opacity,
        transform: [{ translateY: anim.translateY }, { scale: anim.scale }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: hidden }}
        disabled={hidden}
        onPress={onPress}
        style={({ pressed }) => ({
          height: CTA_H,
          borderRadius: radius.button,
          backgroundColor: brand.green,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: space.l,
          paddingEnd: space.l,
          boxShadow: pressed ? `0 0 0 ${brand.navy}` : `0 8px 0 ${brand.navy}`,
          transform: [{ translateY: pressed ? 8 : 0 }],
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.display800,
            fontSize: 14,
            lineHeight: 16,
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
 * Book tab: brand header with the open-now pill, then the prototype's court —
 * a three.js scene on expo-gl (Court3D) with "Check availability" on its net
 * and the rally's ball flying over the button — and, in place, the booking
 * sheet floating over the pitched court once tapped (court → booking
 * transition, design 2026-09-01). The standalone
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
  const reduceMotion = useReduceMotion();
  const { progress, veil, direction, isOpen, sheetMounted, openBooking, closeBooking } =
    useCourtTransition();
  const [courtSize, setCourtSize] = useState<{ width: number; height: number } | null>(null);
  const [layerHeight, setLayerHeight] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const [glUnavailable, setGlUnavailable] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const onUnavailable = useCallback(() => setGlUnavailable(true), []);
  const onCourtSize = useCallback((size: { width: number; height: number }) => {
    setCourtSize((prev) =>
      prev && prev.width === size.width && prev.height === size.height ? prev : size,
    );
  }, []);

  // Best-effort push registration once signed in. The outcome is recorded.
  useEffect(() => {
    if (!session) return;
    void registerPushToken().then((state) => addBreadcrumb('push.register', { state }));
  }, [session]);

  // Opening only animates and mounts — nothing navigates, so tell screen
  // readers where they are. Closing waits for a hold call to settle: the sheet
  // owns the callbacks that push Review or show the refusal.
  const open = useCallback(() => {
    openBooking();
    AccessibilityInfo.announceForAccessibility(t('booking.pickTime'));
  }, [openBooking, t]);
  const close = useCallback(() => {
    if (sheetBusy) return;
    closeBooking();
  }, [sheetBusy, closeBooking]);

  // Android back reverses the transition instead of leaving the tab — only
  // while this screen is focused, so a pushed Review keeps its own back.
  useFocusEffect(
    useCallback(() => {
      if (!isOpen) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        close();
        return true;
      });
      return () => sub.remove();
    }, [isOpen, close]),
  );

  // The court layer: lifted 60 px and dimmed to 55 % (PITCH ease, direction-aware).
  // Both GL surfaces (court, ball) carry it; the button between them does not.
  const courtLayer = useMemo(() => {
    const ease = pitchEase(direction, 0);
    return {
      transform: [
        {
          translateY: progress.interpolate({
            ...sampleEased(SPEC.court.slice, SPEC.court.y, ease),
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: progress.interpolate({
        ...sampleEased(SPEC.court.dim, SPEC.court.opacity, undefined, 1),
        extrapolate: 'clamp',
      }),
    };
  }, [progress, direction]);

  // The on-net button rides the tape: its rest frame from the camera at p = 0,
  // then a native-driver track of where the tape (plus the layer's lift) goes
  // as the camera pitches — the prototype recomputes this every frame; here it
  // is sampled once per size/direction.
  const net = useMemo(() => {
    if (!courtSize) return null;
    const { width, height } = courtSize;
    const camera = makeCamera(width / height);
    const rest = projectNet(0, width, height, camera);
    const ease = pitchEase(direction, 0);
    const at = (p: number) => {
      const k = ease(p);
      return {
        tape: projectNet(k, width, height, camera),
        lift: lerp(SPEC.court.y[0], SPEC.court.y[1], k),
      };
    };
    const table = (f: (s: ReturnType<typeof at>) => number) =>
      progress.interpolate({ ...sampleCurve((p) => f(at(p))), extrapolate: 'clamp' });
    return {
      rest,
      translateX: table(({ tape }) => tape.centreX - rest.centreX),
      translateY: table(({ tape, lift }) => tape.centreY - rest.centreY + lift),
      scale: table(({ tape }) => tape.width / rest.width),
    };
  }, [courtSize, direction, progress]);

  // Header: the back button fades in (0.2 → 0.5) and the title slides over;
  // the footer line leaves with the button.
  const header = useMemo(() => {
    const table = (range: Range, out: Range) =>
      progress.interpolate({ ...sampleEased(range, out, undefined, 1), extrapolate: 'clamp' });
    return {
      fade: table(SPEC.back.fade, [0, 1]),
      shift: table(SPEC.back.fade, [0, dir === 'rtl' ? -BACK_SHIFT : BACK_SHIFT]),
      footer: table(SPEC.button.fade, [1, 0]),
    };
  }, [progress, dir]);

  const phone = venuePhoneOf(settings.data);
  const cta = <NetCta progress={progress} hidden={sheetMounted} onPress={open} />;
  // Box height S, blank band f·H at its top: start it m above the stage so
  // f·(S + m) − m = COURT_GAP, i.e. m = (f·S − gap) / (1 − f).
  const stageBox = stageHeight - tabBarHeight;
  const courtTop =
    stageBox > 0
      ? -Math.max(0, Math.round((COURT_TOP_BAND * stageBox - COURT_GAP) / (1 - COURT_TOP_BAND)))
      : 0;
  const fallbackCourtHeight = Math.max(0, layerHeight - CTA_H - space.xxl - FOOTER_SPACE);

  return (
    <Screen padded={false} style={{ backgroundColor: colors.page }}>
      {/* Header: logo + open-now pill. Above the stage in z so the lifted court passes beneath. */}
      <View
        style={{
          zIndex: 1,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: 10,
          paddingBottom: 6,
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row',
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
        <View style={{ zIndex: 1, marginTop: space.s, marginStart: space.l, marginEnd: space.l }}>
          <DegradedBanner
            lead={t('degraded.leadConnectionLost')}
            message={t('degraded.bannerCourts', { phone: phone ?? '' })}
            phone={phone}
          />
        </View>
      ) : null}

      {/* Title row: [back to the court] BOOK A COURT */}
      <View style={{ zIndex: 1, paddingStart: space.l, paddingEnd: space.l, paddingTop: space.sm }}>
        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          accessibilityElementsHidden={!isOpen}
          importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
          style={{ position: 'absolute', start: space.l, top: space.sm, opacity: header.fade }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('booking.backToCourt')}
            accessibilityState={{ disabled: !isOpen || sheetBusy, busy: sheetBusy }}
            disabled={!isOpen || sheetBusy}
            hitSlop={8}
            onPress={close}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.sub : colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: sheetBusy ? 0.55 : 1,
            })}
          >
            <BackChevronIcon size={17} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: header.shift }] }}>
          <Title>{t('booking.title')}</Title>
        </Animated.View>
      </View>

      {/* Stage: the court fills everything above the tab bar; the button sits on its net, the ball
          flies over the button (Court3D's second surface); the sheet floats over all of it. */}
      <View style={{ flex: 1 }} onLayout={(e) => setStageHeight(e.nativeEvent.layout.height)}>
        {glUnavailable ? (
          // No GL context on this device: the flat court, button underneath as before.
          <Animated.View
            onLayout={(e) => setLayerHeight(e.nativeEvent.layout.height)}
            style={[stageBounds, { top: 0, bottom: tabBarHeight }, courtLayer]}
          >
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingStart: 18,
                paddingEnd: 18,
                paddingBottom: FOOTER_SPACE,
                gap: space.xxl,
              }}
            >
              {fallbackCourtHeight > 0 ? (
                <CourtIllustration maxHeight={fallbackCourtHeight} />
              ) : null}
              <View style={{ alignSelf: 'stretch' }}>{cta}</View>
            </View>
          </Animated.View>
        ) : (
          <Court3D
            style={[stageBounds, { top: courtTop, bottom: tabBarHeight }]}
            layerStyle={courtLayer}
            progress={progress}
            direction={direction}
            reduceMotion={reduceMotion}
            onSize={onCourtSize}
            onUnavailable={onUnavailable}
            pausedNote={
              // The idle hold's note, above the footer line (Court3D fades it).
              <View
                style={{
                  position: 'absolute',
                  start: space.l,
                  end: space.l,
                  bottom: FOOTER_SPACE + 6,
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.pill,
                    backgroundColor: colors.card,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.line,
                  }}
                >
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{
                      textAlign: 'center',
                      fontFamily: fonts.body600,
                      fontSize: 11.5,
                      color: colors.mut,
                    }}
                  >
                    {t('courts.rallyPaused')}
                  </Text>
                </View>
              </View>
            }
          >
            {net ? (
              // Post to post on the tape, centred on it, following it through the
              // pitch. The court is symmetric about the screen centre at rest, so a
              // logical start is the same pixel in both writing directions. Outside
              // the lifted/dimmed layer, as in the prototype: the lift is in the table.
              <Animated.View
                style={{
                  position: 'absolute',
                  top: net.rest.centreY - CTA_H / 2,
                  start: net.rest.centreX - net.rest.width / 2,
                  width: net.rest.width,
                  transform: [
                    { translateX: net.translateX },
                    { translateY: net.translateY },
                    { scale: net.scale },
                  ],
                }}
              >
                {cta}
              </Animated.View>
            ) : null}
          </Court3D>
        )}

        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden={sheetMounted}
          importantForAccessibility={sheetMounted ? 'no-hide-descendants' : 'auto'}
          style={{
            position: 'absolute',
            start: space.l,
            end: space.l,
            bottom: tabBarHeight + 10,
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
          <BookingSheet
            progress={progress}
            direction={direction}
            bottomInset={tabBarHeight}
            isOpen={isOpen}
            onBusyChange={setSheetBusy}
          />
        ) : null}

        {/* Reduced motion: the stage (court box included) dips through the page colour while p jumps. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { top: courtTop, backgroundColor: colors.page, opacity: veil },
          ]}
        />
      </View>
    </Screen>
  );
}
