import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  View,
  type LayoutRectangle,
} from 'react-native';
import { Text } from '../../src/i18n/text';
import { useFocusEffect } from 'expo-router';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { logicalSign } from '../../src/i18n/direction';
import { useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
import {
  openNowInfo,
  venuePhoneOf,
  type VenueSettingsPublic,
} from '../../src/features/availability/assemble';
import { useAuth } from '../../src/features/auth/context';
import { registerPushToken } from '../../src/features/profile/push';
import { useCourtTransition } from '../../src/features/courtTransition/useCourtTransition';
import { takeBookingSheetRequest } from '../../src/features/courtTransition/openIntent';
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
import { brand, radius, space, useTheme, withAlpha } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandPattern } from '../../src/components/BrandPattern';
import { DegradedBanner } from '../../src/components/booking';
import { BackChevronIcon, TitleSquiggle } from '../../src/components/icons';
import { Court3D, type Court3DHandle } from '../../src/components/Court3D';
import { CourtIllustration } from '../../src/components/CourtIllustration';
import { BookingSheet } from '../../src/components/BookingSheet';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';

/** logo.png is 900×332: a 30 pt tall wordmark is 81 pt wide (design lets height drive width). */
const LOGO_H = 30;
const LOGO_W = Math.round(LOGO_H * (900 / 332));
/** The back button's width + gap: the title slides over to make room for it. */
const BACK_SHIFT = 44;
/** The on-net button (prototype: 16 px padding round a 16 px line, top = tape − 24). */
const CTA_H = 48;
/** Room under the flat fallback court for the "reserve in the app" footer line. */
const FOOTER_SPACE = 34;
/**
 * The reading shade (owner, 2026-09-05: "a really subtle bg so the text is more
 * readable over the pattern and the court").
 *
 * The HEADER no longer has one. It did, over the whole block above the stage,
 * and that shade was the second reason the top of the page did not match the
 * rest: it put the pattern up there at ~22 % of the strength it has everywhere
 * else, which is a step you see before you see anything else on the screen.
 * The owner chose to lose it and protect the one piece of small text it was
 * really there for — the open-now pill — with a plate of its own (2026-09-05).
 * What remains below is the FOOTER band, which lies on the court rather than
 * on the pattern and is a different problem.
 *
 * It is the PAGE COLOUR at partial alpha, never a grey or a card: over the
 * brand pattern the only thing that changes is how much of the lime shows
 * through, so there is no second colour on screen and nothing that reads as a
 * chip behind the words. What it must not do is announce its own edge — a hard
 * rectangle crossing those long diagonals makes every line visibly step at the
 * boundary — so each shade is a solid core that DISSOLVES into a gradient tail
 * on the sides it ends on, and simply runs off-screen on the sides it does not.
 *
 * Lower in dark for the reason BrandPattern's own alpha is: lime is 1.77:1 on
 * the light page and 7.85:1 on the dark one, so the navy veil puts the lines
 * away much faster than the white one does and matching alphas would be two
 * different designs. These are the ONE dial here — raise them if the words
 * still fight the court, lower them if it stops reading through. Never to 1:
 * the point is that the court steps back, not that it disappears.
 */
const SHADE_ALPHA = { light: 0.78, dark: 0.62 } as const;
/**
 * The footer's band lies on the COURT rather than on the pattern, and the owner
 * has just asked to see the court at full strength — so it hazes at three
 * quarters of the shade rather than veiling at the full one.
 */
const FOOTER_SHADE_SCALE = 0.75;
/** The footer line's band: it dissolves on BOTH sides, into the court. */
const FOOTER_SHADE_TAIL = 16;
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
    // On its own plate. The header used to sit under a reading shade that ran
    // the width of the page; that shade is gone (it made the top of the page a
    // different picture from the bottom), and this is the one string it was
    // really carrying — 11 pt `mut`, which over a full-strength band measures
    // 2.69:1 in dark and cannot be left on the artwork. A card plate is what
    // the paused note and the back button already use, so `mut` on `card` is a
    // pairing the design has ruled on rather than a new one. It also stops
    // being a loose label and starts being the chip it always looked like.
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingStart: 9,
        paddingEnd: 10,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: radius.pill,
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.line,
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: radius.pill,
          backgroundColor: info.open ? brand.green : colors.fnt2,
        }}
      />
      <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: colors.mut }}>
        {/* Latin-digit times in an Arabic sentence: isolated so the bidi algorithm
            keeps "09:00–02:00" in order (formatTimeRange does the same). */}
        {info.open ? t('courts.openNow', { hours: isolate(info.label) }) : t('courts.closedNow')}
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
        {/* No lineHeight: a 16 pt box on a 14 pt face cropped the label's
            bottom (Arabic descenders — ض, ح — lost their tails) and rode the
            text high in the button. Natural leading plus a 1 pt nudge down
            optically centres the display face's tall caps. */}
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.display800,
            fontSize: 14,
            letterSpacing: tracking(0.7),
            textTransform: 'uppercase',
            color: brand.greenInk,
            transform: [{ translateY: 1 }],
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
 *
 * The tab stands on the brand line pattern (owner, 2026-09-05: "make the bg
 * here be the lines pattern thats in the brand file", lines only, whole
 * screen). It is one full-bleed view at the root, NOT a texture per section,
 * so there is a single crop of the artwork rather than one per band.
 *
 * It runs from the status bar down to where the COURT starts, and no further:
 * the court's GL surface clears opaque (Court3D's header has the why — the
 * transparent clear that let the pattern through froze the rally on device).
 * Putting the pattern back under the court means drawing it inside the scene,
 * not clearing to nothing.
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
  /**
   * The two boxes the brand pattern has to be the same picture in: the box the
   * page draws it over, and the stage the court's GL surface stands in.
   *
   * Both come off onLayout, so both are in THIS view's coordinate space and
   * neither has to know what that space is — which is the point. The pattern's
   * box is an absolute child and the stage is a flex one, and whether Yoga
   * resolves an absolute inset against the border box or the padding box is
   * exactly the kind of thing that would put the court's copy 47 px out. Asking
   * both, in one space, cannot be wrong.
   */
  const [patternRect, setPatternRect] = useState<LayoutRectangle | null>(null);
  const [stageRect, setStageRect] = useState<LayoutRectangle | null>(null);
  const [glUnavailable, setGlUnavailable] = useState(false);
  // Touches in the sheet count as watching: the rally behind it plays on / restarts its idle clock.
  const courtRef = useRef<Court3DHandle>(null);
  const wakeCourt = useCallback(() => courtRef.current?.wake(), []);
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

  // Another screen asked for the sheet (My bookings' "Book your next game"):
  // take the one-shot intent as the tab comes up and play the transition from
  // the court, exactly as a tap on the net button would. Taking it clears it,
  // so a later visit to the tab lands on the court; an already-open sheet is
  // the same destination, so there is nothing to animate.
  useFocusEffect(
    useCallback(() => {
      if (takeBookingSheetRequest() && !isOpen) open();
    }, [isOpen, open]),
  );

  // The court layer: lifted 60 px at full opacity (PITCH ease, direction-aware).
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

  // Header: the back button fades in (0.2 → 0.5), the title slides over and
  // the heading itself cross-fades on that same slice — BOOK A COURT is the
  // court view's name, PICK A TIME is the booking view's, and the sheet no
  // longer carries a heading of its own (owner, 2026-09-05). The footer line
  // leaves with the button.
  //
  // The slide is a `translateX`, which is the one horizontal quantity Yoga
  // never mirrors (BaseViewProps::resolveTransform ignores the layout
  // direction), so it is the one that has to name the direction itself. The
  // button is placed logically (`start`), so it sits on the RIGHT in Arabic
  // and the title has to move the other way to clear it: `logicalSign` is
  // exactly that mapping, and using it keeps this from drifting out of step
  // with the rest of the app the way a hand-rolled ternary can.
  const header = useMemo(() => {
    const table = (range: Range, out: Range) =>
      progress.interpolate({ ...sampleEased(range, out, undefined, 1), extrapolate: 'clamp' });
    return {
      fade: table(SPEC.back.fade, [0, 1]),
      out: table(SPEC.back.fade, [1, 0]),
      shift: table(SPEC.back.fade, [0, logicalSign(dir) * BACK_SHIFT]),
      footer: table(SPEC.button.fade, [1, 0]),
    };
  }, [progress, dir]);

  // The reading shade, and the same colour at zero for every gradient's far
  // stop: `transparent` is black at alpha 0 on Android, which greys the ramp.
  const courtShade = withAlpha(colors.page, SHADE_ALPHA[appearance] * FOOTER_SHADE_SCALE);
  const clear = withAlpha(colors.page, 0);

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
  // Where the court's surface sits inside the pattern, for the copy it draws
  // behind the scene. Not memoised on purpose: Court3D reads the four numbers,
  // not this object, so rebuilding it every render costs nothing.
  const courtPatternBox =
    patternRect && stageRect
      ? {
          width: patternRect.width,
          height: patternRect.height,
          offsetX: stageRect.x - patternRect.x,
          // The court's box starts `courtTop` ABOVE the stage (negative).
          offsetY: stageRect.y + courtTop - patternRect.y,
        }
      : undefined;

  return (
    <Screen padded={false} style={{ backgroundColor: colors.page }}>
      {/* The ground for everything below: the brand line pattern over the page
          colour, full bleed. FIRST child and deliberately without a zIndex, so
          it paints before every sibling — the stage, which carries no zIndex
          either, still comes after it in document order, and the header block
          sits above both on its own `zIndex: 1`. Absolute
          children resolve against the padding box, so this reaches under the
          safe-area inset the Screen pads for and the pattern runs behind the
          status bar too. `opacity` is the one dial if it reads too loud — the
          brand's green at full strength is a lot of green.

          The court's surface is opaque and covers this from `courtTop` down —
          it has to be, on the frame budget (Court3D's header) — so it draws the
          SAME crop of the pattern itself, as geometry inside its scene
          (patternBackdrop). `courtPatternBox` below is what keeps the two the
          one continuous picture, and the wrapper here exists only to measure
          the box this is cropped over. */}
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={(e) => setPatternRect(e.nativeEvent.layout)}
      >
        <BrandPattern />
      </View>

      {/* Everything above the stage — logo, open-now pill, degraded banner,
          heading — stands directly on the pattern, at the strength the rest of
          the page has it. There WAS a reading shade over this whole block; it
          is gone because it made the top of the page a different picture from
          the bottom, which is the thing the owner kept pointing at. The one
          string it was genuinely protecting, the open-now pill, carries its own
          plate now (OpenNowPill) — the logo is artwork and the heading is
          display-sized, so neither needed it.

          `zIndex: 1` still lives here, so the whole block paints over the
          lifted court the way each row used to on its own. */}
      <View style={{ zIndex: 1 }}>
        {/* Header: logo + open-now pill. Above the stage in z so the lifted court passes beneath. */}
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
              // Isolated: an RTL paragraph would otherwise reorder the number groups.
              message={t('degraded.bannerCourts', { phone: phone ? isolate(phone) : '' })}
              phone={phone}
            />
          </View>
        ) : null}

        {/* Title row: [back to the court] BOOK A COURT ⇄ PICK A TIME */}
        <View style={{ paddingStart: space.l, paddingEnd: space.l, paddingTop: space.sm }}>
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
            {/* The two headings cross-fade in place on the back button's slice.
                Only the words change, so the squiggle is drawn ONCE underneath
                rather than inside each Title: two identical marks fading through
                each other dip to ~75 % at the halfway point, and the one thing
                that must not flicker here is the brand mark. Title's own bottom
                margin is cancelled on the stack and re-applied under the mark,
                so the row measures exactly as `<Title>` always did. */}
            <View style={{ marginBottom: -space.s }}>
              <Animated.View
                accessibilityElementsHidden={isOpen}
                importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
                style={{ opacity: header.out }}
              >
                <Title squiggle={false}>{t('booking.title')}</Title>
              </Animated.View>
              {/* Absolute so the outgoing heading alone sets the row's height —
                  the two strings are different lengths and, in Arabic, different
                  heights. */}
              <Animated.View
                pointerEvents="none"
                accessibilityElementsHidden={!isOpen}
                importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
                style={{ position: 'absolute', start: 0, end: 0, top: 0, opacity: header.fade }}
              >
                <Title squiggle={false}>{t('booking.pickTime')}</Title>
              </Animated.View>
            </View>
            <View style={{ alignItems: 'flex-start', marginBottom: space.s }}>
              <TitleSquiggle />
            </View>
          </Animated.View>
        </View>
      </View>

      {/* Stage: the court fills everything above the tab bar; the button sits on its net, the ball
          flies over the button (Court3D's second surface); the sheet floats over all of it. */}
      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          setStageHeight(e.nativeEvent.layout.height);
          setStageRect(e.nativeEvent.layout);
        }}
      >
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
            ref={courtRef}
            patternBox={courtPatternBox}
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
          {/* This line stands on the court itself, so its shade dissolves at
              BOTH ends and bleeds past the gutter to the screen edges: a band
              with no edge of its own anywhere the eye can find one. Two
              gradients back to back rather than one four-stop ramp — the pair
              keeps a solid core between them at any height. */}
          <LinearGradient
            pointerEvents="none"
            colors={[clear, courtShade]}
            style={{
              position: 'absolute',
              start: -space.l,
              end: -space.l,
              top: -FOOTER_SHADE_TAIL,
              height: FOOTER_SHADE_TAIL,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              start: -space.l,
              end: -space.l,
              top: 0,
              bottom: 0,
              backgroundColor: courtShade,
            }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[courtShade, clear]}
            style={{
              position: 'absolute',
              start: -space.l,
              end: -space.l,
              bottom: -FOOTER_SHADE_TAIL,
              height: FOOTER_SHADE_TAIL,
            }}
          />
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
            onInteraction={wakeCourt}
          />
        ) : null}

        {/* Reduced motion: the stage (court box included) dips through the page
            colour while p jumps. FLAT page colour, not the pattern, even though
            the pattern is what stands behind the stage now: this is a cover, its
            one job is to be opaque at the top of the dip, and a second
            BrandPattern inside it could not line up with the one at the root
            anyway — `slice` crops to the box it is handed, and this box starts
            at `courtTop` and ends at the tab bar, so the two crops would differ
            and the seam would be the loudest thing on screen. 110 ms of flat page
            colour over the stage is by far the quieter of the two. */}
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
