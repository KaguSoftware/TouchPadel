import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutRectangle,
} from 'react-native';
import { Text } from '../../src/i18n/text';
import { useFocusEffect } from 'expo-router';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { logicalSign, mirror } from '../../src/i18n/direction';
import { useVenueSettings } from '../../src/features/availability/hooks';
import { BranchPicker } from '../../src/features/availability/BranchPicker';
import { openNowInfo, type VenueSettingsPublic } from '../../src/features/availability/assemble';
import { useCourtTransition } from '../../src/features/courtTransition/useCourtTransition';
import { takeBookingSheetRequest } from '../../src/features/courtTransition/openIntent';
import { lerp, pitchEase, sampleCurve, sampleEased, SPEC, type Range } from '@touch/court3d/spec';
import { courtTopFraction, makeCamera, projectNet } from '@touch/court3d/camera';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { brand, radius, space, useTheme, withAlpha } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { BrandPattern } from '../../src/components/BrandPattern';

import { BackArrowIcon, BackChevronIcon, TitleSquiggle } from '../../src/components/icons';
import { GlassView } from 'expo-glass-effect';
import { liquidGlass } from '../../src/lib/liquidGlass';
import { SymbolView } from 'expo-symbols';
import { Court3D } from '../../src/components/Court3D';
import { CourtIllustration } from '../../src/components/CourtIllustration';
import { BookingSheet } from '../../src/components/BookingSheet';

const android = Platform.OS === 'android';
/**
 * The back button: its own round plate beside the PICK A TIME pill
 * (iOS 2026-09-27, Android 2026-09-29), no longer riding inside the pill. 44 is
 * the HIG minimum target, and a touch shorter than the pill so the row's height
 * (and the heading's line) is still set by the words. Android reaches
 * Material's 48 dp target through `BACK_HIT_SLOP_ANDROID` on every side.
 */
const BACK_BTN = 44;
const BACK_HIT_SLOP_ANDROID = 2;
/** The air between the back button and the PICK A TIME pill. */
const BACK_GAP = 8;
/**
 * The pill holds only the words, so the padding is simply even round them.
 * PAD_Y 9 makes the Latin pill 45 pt, just taller than the 44 pt back button,
 * so the pill still sets the row. The header bleeds back up by the same amount
 * (its negative marginTop), so the words do not move and the cross-fade still
 * lands.
 */
const PICK_PILL_PAD_X = 16;
const PICK_PILL_PAD_Y = 9;
/**
 * Extra air above the title row.
 *
 * The capsule pulls itself back up by its own PAD_Y so it grows around the
 * line rather than pushing it down, which leaves its plate's top edge close to
 * whatever is above the row (the logo row, until the logo moved to the court's
 * turf on 2026-09-26; now the status bar). That was fine while the capsule
 * barely had an edge; with real glass, and its bright rim on iOS 26, the
 * boundary is visible and reads as crowded.
 *
 * It goes on the ROW, not on the capsule. Both headings then take it together,
 * which is what keeps BOOK A COURT and PICK A TIME cross-fading in place: they
 * overlap on the same slice (SPEC.back.fade), so a capsule whose text sat lower
 * than the heading it replaces would visibly drift against it mid-transition.
 *
 * Android takes more of it: its status-bar inset stops right at the icons,
 * with none of the spare room iOS's inset has under the Dynamic Island, so the
 * title and the open-now pill sat against the status bar (owner, 2026-09-29).
 */
const PICK_PILL_TOP_AIR = android ? 14 : 10;
/**
 * How far the capsule's backdrop sits BELOW the box that measures the text.
 *
 * The line box is 26 pt × 1.05 and all-caps Latin stops at the baseline, using
 * none of the descender room at its foot. Centring the plate on that box is
 * therefore not the same as centring it on the GLYPHS: the air over the cap line
 * is real, the air under the baseline is mostly empty line box. Pushing the
 * plate down off the box's centre takes that surplus off the top and gives it
 * back at the foot, so the caps end up optically centred.
 *
 * It was 3, which over-corrected: at PAD_Y 6 that left 3 pt of air above the
 * caps against 9 below — the plate visibly crowding the words at the top (owner,
 * 2026-09-19). 1 keeps the correction's direction without swallowing the top
 * padding, landing at 5 above / 7 below at PAD_Y 6 (9 / 11 at iOS's 10), which
 * reads level once the empty descender room is discounted.
 *
 * ARABIC TAKES NONE OF IT. There the line box is × 1.45 (Title), because ج/ح/ي
 * drop well under the baseline and actually use that room — the surplus this
 * compensates for does not exist, and shifting the plate down would crowd the
 * tails it was widened for.
 */
const PICK_PILL_SINK_LATIN = 1;
/**
 * How far the capsule's glass is parked OUT OF ITS CLIP, along the leading edge,
 * at rest. It has to clear the capsule's own WIDTH, or a strip of the material
 * stays inside the clip and frosts the court on a CLOSED sheet.
 *
 * It used to park downward, and so was derived from the capsule's height. The
 * pill leaves sideways now (owner, 2026-09-19), which makes the distance a width
 * — and a width this file cannot compute, because it is set by a translated
 * string in a display face. So this is a generous fixed overshoot rather than a
 * derivation: the clip crops whatever hangs past it, so overshooting is free and
 * falling short is a visible sliver of frosting on a closed sheet. 420 clears the
 * longest plausible PICK A TIME on the widest phone.
 */
const PICK_PILL_PARK_X = 420;
/**
 * Everything the header puts BEFORE the words: the round back button, the gap
 * after it and the pill's own leading padding. The title slides over by exactly
 * this much, so the words land back on the margin they share with BOOK A COURT.
 */
const BACK_SHIFT = BACK_BTN + BACK_GAP + PICK_PILL_PAD_X;
/**
 * The sheet card's glass fill, verbatim (BookingSheet's `glass`): iOS has a real
 * blur under it so the fill is only a veil, Android has none and carries the
 * frosting on the fill alone. Dark tints heavier than light because the court
 * behind it is brighter than the page. The card's white edge is NOT taken —
 * that line separates the card from the page it floats over, and the capsule
 * has no such job over the court.
 */
const PICK_PILL_TINT = { iosDark: 0.45, iosLight: 0.35, other: 0.94 } as const;
/**
 * How long the booking sheet's prewarm waits for the court's first frame before
 * giving up on it and mounting anyway. See `sheetPrewarmed` below: the wait is
 * what keeps the sheet's mount off the court's own first paint, and this is only
 * the floor under a court that neither paints nor reports itself unavailable.
 */
const PREWARM_BACKSTOP_MS = 2000;
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
 * The court scales with its box's HEIGHT (vertical fov), and Android's box runs
 * taller than iOS's on the same width: the nav bar and status bar are hidden,
 * so nothing is reserved above or below. Android's box is capped at this
 * height : width so the court spans the same share of the screen as on iOS.
 * Measured on device, not derived (owner, 2026-09-29): the iPhone 17 Pro's
 * court spans ~74 % of the width, the Android one spanned ~91 % uncapped at
 * ~1.75, so 1.75 × 74 / 91 ≈ 1.42 — which read too small on device, so it was
 * raised to 1.55. Lower shrinks the court, higher grows it.
 */
const ANDROID_COURT_BOX_RATIO = 1.55;

/**
 * The "Open now · 09:00–02:00" pill. Owns the minute clock so the rest of the
 * screen — the GL court in particular — does not re-render every minute.
 */
function OpenNowPill({
  settings,
  fade,
}: {
  settings: VenueSettingsPublic | undefined;
  /**
   * BOOK A COURT's own fade (`header.out`) while the sheet is mounted, so the
   * pill leaves and returns with the heading; a plain 1 at rest. See the
   * comment on the pill's call site for why it must be a plain 1 at rest.
   */
  fade: Animated.AnimatedInterpolation<number> | 1;
}) {
  const { t } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const dark = appearance === 'dark';
  const [now, setNow] = useState(() => new Date());
  // NOT in a transition. Transition work on this tab waits behind the rally's
  // frame loop for React's 5 s Normal-priority deadline (see the note in
  // useAvailabilityBooking), and a pill that says "open" five seconds after
  // closing time is worse than the one frame this costs.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const info = useMemo(() => openNowInfo(settings, now), [settings, now]);
  if (!info) return null;
  const glass = withAlpha(
    colors.bg,
    Platform.OS === 'ios' ? PICK_PILL_TINT[dark ? 'iosDark' : 'iosLight'] : PICK_PILL_TINT.other,
  );
  return (
    // On its own plate — the same glass as the "Pick a time" capsule, branch
    // for branch: iOS 26's Liquid Glass (GlassView, `regular`, no veil over
    // it) where the system has it (owner, 2026-09-26), else BlurView on iOS +
    // a translucent `colors.bg` tint, opaque tint on Android — so the two
    // floating labels over the court read as one material.
    //
    // The border WIDTH is kept on the Liquid Glass branch and only its colour
    // dropped (the capsule has no rim): the pill must not change size.
    // The whole pill fades as one, glass included (owner, 2026-09-26). A
    // GlassView under an alpha < 1 draws nothing, and one that has started
    // life that way may not come back, so at rest `fade` is a plain 1 (no
    // animated node over the glass at all) and the glass is REMOUNTED fresh
    // each time the pill comes to rest (`key` on the call site).
    <Animated.View
      style={{
        opacity: fade,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingStart: 9,
        paddingEnd: 10,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: radius.pill,
        overflow: 'hidden',
        borderWidth: dark ? StyleSheet.hairlineWidth : 0,
        borderColor: liquidGlass ? 'transparent' : colors.line,
      }}
    >
      {liquidGlass ? (
        <GlassView
          pointerEvents="none"
          colorScheme={dark ? 'dark' : 'light'}
          glassEffectStyle="regular"
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
        />
      ) : (
        <>
          {Platform.OS === 'ios' ? (
            <BlurView
              intensity={40}
              tint={dark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: glass }]} />
        </>
      )}
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: radius.pill,
          backgroundColor: info.open ? brand.green : colors.fnt2,
        }}
      />
      {/* `mut2`, a step firmer than the old `mut`: the words read washed out
          on the glass (owner, 2026-09-26). */}
      <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: colors.mut2 }}>
        {/* Latin-digit times in an Arabic sentence: isolated so the bidi algorithm
            keeps "09:00–02:00" in order (formatTimeRange does the same). */}
        {info.open ? t('courts.openNow', { hours: isolate(info.label) }) : t('courts.closedNow')}
      </Text>
    </Animated.View>
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
        testID="book.view-availability"
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
          // Pressing drops the button the 8 px onto its own shadow. `hidden`
          // holds it DOWN from there: the tap that opens the sheet disables
          // this Pressable in the same commit, so `pressed` fell back to false
          // and the button snapped up 8 px in one frame — while its fade and
          // its 24 px slide were already under way. That one-frame kick up,
          // immediately reversed, is what read as the button shaking as the
          // sheet opened (owner, 2026-09-08). It now stays on the shadow and
          // simply fades from there. Coming back, `hidden` clears at
          // p ≤ SHEET_GONE, where SPEC.button.fade has the button at zero
          // opacity, so the lift back up is never on screen.
          boxShadow: pressed || hidden ? `0 0 0 ${brand.navy}` : `0 8px 0 ${brand.navy}`,
          transform: [{ translateY: pressed || hidden ? 8 : 0 }],
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
/**
 * One of the header's two plates — the back button's circle or the PICK A TIME
 * pill — filling its parent, which clips it to a pill shape.
 *
 * iOS: PARKED, NOT FADED (see `header.capsulePark`): it stays at full opacity
 * and is slid out of its clip at rest, because a UIVisualEffectView or
 * GlassView under an alpha < 1 ancestor draws nothing and may not come back.
 *
 * Android: a flat tint with no blur to protect, so it simply fades (`fade`,
 * `header.capsuleFade`) and the park stays at 0.
 */
function ParkedGlass({
  park,
  fade,
  dark,
  tint,
  interactive = false,
}: {
  park: Animated.AnimatedInterpolation<number>;
  fade?: Animated.AnimatedInterpolation<number>;
  dark: boolean;
  tint: string;
  interactive?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, overflow: 'hidden' }]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ translateX: park }], opacity: fade }]}
      >
        {liquidGlass ? (
          <GlassView
            pointerEvents="none"
            isInteractive={interactive}
            colorScheme={dark ? 'dark' : 'light'}
            glassEffectStyle="regular"
            style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
          />
        ) : (
          <>
            {android ? null : (
              <BlurView
                intensity={40}
                tint={dark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            )}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
          </>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * The PICK A TIME header (iOS 2026-09-27, Android 2026-09-29): a round back
 * button with the chevron (Material's arrow on Android), then a pill holding
 * only the words, with the squiggle hung under the pill. The chevron used to ride inside the pill, which made the whole
 * pill the button; with the squiggle inside too, the words sat high in the
 * glass. Now the pill's padding is even round the words alone.
 *
 * Nothing above either glass plate animates its alpha: the chevron, the words
 * and the squiggle each carry the fade (and the busy dim) themselves.
 */
function PickTimeHeader({
  title,
  backLabel,
  fade,
  park,
  plateFade,
  dark,
  tint,
  sink,
  disabled,
  busy,
  onBack,
}: {
  title: string;
  backLabel: string;
  fade: Animated.AnimatedInterpolation<number>;
  park: Animated.AnimatedInterpolation<number>;
  /** The plates' own fade — Android only; iOS's glass must stay at alpha 1. */
  plateFade?: Animated.AnimatedInterpolation<number>;
  dark: boolean;
  tint: string;
  /** PICK_PILL_SINK_LATIN in Latin, 0 in Arabic: the plate sits this much lower than the words' box. */
  sink: number;
  disabled: boolean;
  busy: boolean;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const { dir } = useLocale();
  const contentFade = busy ? 0.55 : fade;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: BACK_GAP,
        // The pill is the row's tallest item, so this puts the words back on
        // the line BOOK A COURT stands on, and the cross-fade still lands.
        marginTop: -(PICK_PILL_PAD_Y - sink),
      }}
    >
      <Pressable
        testID="book.back-to-court"
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onBack}
        hitSlop={android ? BACK_HIT_SLOP_ANDROID : undefined}
        android_ripple={{
          color: withAlpha(colors.ink, 0.12),
          borderless: true,
          radius: BACK_BTN / 2,
        }}
        style={({ pressed }) => ({
          // NO OPACITY: the glass inside would go flat. The press tint is for
          // iOS's pre-26 stand-in only; Liquid Glass answers the touch itself,
          // and Android answers with the ripple.
          width: BACK_BTN,
          height: BACK_BTN,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            pressed && !android && !liquidGlass ? withAlpha(colors.sub, 0.18) : 'transparent',
        })}
      >
        <ParkedGlass park={park} fade={plateFade} dark={dark} tint={tint} interactive />
        {/* iOS: the system's `chevron.backward`, mirrored here rather than by
            the symbol: `.backward` resolves against UIKit's RTL flag, which
            this app pins LTR (app.config.ts), so it would point the wrong way
            in Arabic. Android: Material's arrow, which flips itself. */}
        <Animated.View style={{ opacity: contentFade }}>
          {android ? (
            <BackArrowIcon size={24} color={colors.ink} strokeWidth={2} />
          ) : (
            <SymbolView
              name="chevron.backward"
              size={17}
              weight="semibold"
              tintColor={colors.ink}
              style={mirror(dir)}
              fallback={<BackChevronIcon size={17} color={colors.ink} strokeWidth={2.4} />}
            />
          )}
        </Animated.View>
      </Pressable>
      <View
        testID="book.court-title"
        style={{
          paddingStart: PICK_PILL_PAD_X,
          paddingEnd: PICK_PILL_PAD_X,
          // The sink, as padding: Latin caps leave the line box's foot empty,
          // so the words ride `sink` above the pill's true middle to look
          // centred in it.
          paddingTop: PICK_PILL_PAD_Y - sink,
          paddingBottom: PICK_PILL_PAD_Y + sink,
          borderRadius: radius.pill,
        }}
      >
        <ParkedGlass park={park} fade={plateFade} dark={dark} tint={tint} />
        <Animated.View style={{ opacity: contentFade, marginBottom: -space.s }}>
          <Title squiggle={false}>{title}</Title>
        </Animated.View>
        {/* The mark hangs under the pill, on the words' leading edge, out of
            the flow so it adds nothing to the pill's height. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: '100%',
            start: PICK_PILL_PAD_X,
            opacity: contentFade,
          }}
        >
          <TitleSquiggle />
        </Animated.View>
      </View>
    </View>
  );
}

export default function BookHomeScreen() {
  const { t, dir } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  // The capsule behind PICK A TIME is the sheet card's material, so it takes the
  // card's own glass formula (BookingSheet) rather than a lookalike of it.
  const dark = appearance === 'dark';
  // Latin-only optical correction — see PICK_PILL_SINK_LATIN. Arabic's line box
  // is taller precisely because its glyphs use the room, so it takes none.
  const pillSink = dir === 'rtl' ? 0 : PICK_PILL_SINK_LATIN;
  const glass = withAlpha(
    colors.bg,
    Platform.OS === 'ios' ? PICK_PILL_TINT[dark ? 'iosDark' : 'iosLight'] : PICK_PILL_TINT.other,
  );
  const tabBarHeight = useTabBarHeight();
  const settings = useVenueSettings();

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
  const [sheetBusy, setSheetBusy] = useState(false);
  /**
   * THE SHEET IS BUILT BEFORE IT IS ASKED FOR.
   *
   * Opening it used to do everything at once, on the frame of the tap: pull in
   * the sheet's whole module subtree, build its ~40 components, subscribe six
   * queries, fire five requests and join the realtime channel. The first press
   * of "Check availability" therefore cost around 200 ms and the court's rally
   * — drawn from a rAF loop on this same thread — lurched through all of it
   * (owner, 2026-09-10). Later presses were fine, which is the tell: this is
   * one-time setup, not the work of opening.
   *
   * Module loading is the biggest single piece and the least visible one.
   * Expo's Metro inlines requires, so `BookingSheet` is not fetched when this
   * file loads but when the branch below first RENDERS it — and in dev that is
   * a round trip to the dev server (the "Android Bundled … (N modules)" line in
   * the log). Nothing about that has to happen under a finger.
   *
   * So the sheet mounts once the tab has settled, invisible (p rests at 0: the
   * card sits 360 px down at zero opacity, takes no touches and is hidden from
   * screen readers) and never unmounts again. The tap is then only the spring.
   * `runAfterInteractions` keeps it out of the way of whatever is animating,
   * and the rally rides the build out on its capped clock (rallyClock.ts): the
   * frames it costs are frames dropped, never a jump.
   *
   * NOT IN A TRANSITION, ANY MORE. It was, on the reasoning that nobody is
   * waiting on a prewarm so it may as well be time-sliced — and that reasoning
   * had the runtime wrong twice over. React's scheduler on this platform is the
   * native RuntimeScheduler, where a transition is a NormalPriority task that
   * cannot start while the rally's frame loop keeps an ImmediatePriority task
   * waiting, and it is not sliced when it finally does: it lands whole, at the
   * five-second expiry. So on any phone that cannot draw the court inside a
   * display frame the prewarm arrived AFTER the guest had already tapped —
   * which put the mount, five queries and two round trips back under the finger
   * this whole mechanism exists to keep them off (owner's colleague, 2026-09-12:
   * a weaker Android phone could not change the date for five seconds).
   *
   * Court3D's frame loop no longer starves that queue (its `startLoop` carries
   * the mechanism), so an ordinary update lands within a frame or two of the
   * tab settling — which is what this wanted all along. The mount still costs
   * what it costs; it is simply paid before the tap again.
   *
   * BUT AFTER THE COURT, NOT ALONGSIDE IT. `runAfterInteractions` alone put this
   * mount — the biggest single piece of JS the tab runs — in the same window as
   * the court's own context creation and scene build, and now that the loop
   * shares the thread fairly the court waited its turn behind it: the first
   * arrival on the tab got visibly slower on a slow bundle (owner, 2026-09-12,
   * Expo Go). The court is what the guest came to see and the sheet is what they
   * might ask for next, so the order is: paint the court, then build the sheet
   * (`onFirstFrame`, Court3D). Nothing is lost by waiting — the "check
   * availability" button lives INSIDE the stage the first frame lifts, so there
   * is no tap to beat until the court is up, and the prewarm then runs under the
   * entrance fade, which is native-driven and does not care.
   *
   * The backstop is for a court that never paints and never fails either — no
   * `onFirstFrame`, no `onUnavailable`. Nothing known reaches it (a dead context
   * raises the flat court), but a prewarm silently disabled by an exotic GL state
   * would be a slow first open with no signal, so it is time-boxed rather than
   * conditional on GL working at all.
   *
   * The cost is that a closed sheet keeps its queries: one extra
   * `court_availability` read a minute while this tab is open, and the
   * degraded probe at the same rate (the sheet is where that is shown now).
   * In exchange the grid is warm when it appears — real times rather than a
   * skeleton.
   */
  const [sheetPrewarmed, setSheetPrewarmed] = useState(false);
  const [courtPainted, setCourtPainted] = useState(false);
  const onCourtPainted = useCallback(() => setCourtPainted(true), []);
  useFocusEffect(
    useCallback(() => {
      if (sheetPrewarmed) return;
      // The court is up (or there will never be one): build the sheet now, out
      // of the way of whatever is still animating.
      if (courtPainted || glUnavailable) {
        const handle = InteractionManager.runAfterInteractions(() => setSheetPrewarmed(true));
        return () => handle.cancel();
      }
      // Still waiting on the first frame. This effect re-runs the moment it
      // lands, which clears the timer below — so the backstop only ever fires
      // for a court that never arrived at all.
      const timer = setTimeout(() => setSheetPrewarmed(true), PREWARM_BACKSTOP_MS);
      return () => clearTimeout(timer);
    }, [sheetPrewarmed, courtPainted, glUnavailable]),
  );
  const onUnavailable = useCallback(() => setGlUnavailable(true), []);
  const onCourtSize = useCallback((size: { width: number; height: number }) => {
    setCourtSize((prev) =>
      prev && prev.width === size.width && prev.height === size.height ? prev : size,
    );
  }, []);

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
      /**
       * The capsule's blur is PARKED, NOT FADED — the same trick the sheet card
       * plays with its own (BookingSheet's `blurPark`, and the reason recorded
       * there): a UIVisualEffectView under an alpha < 1 ancestor does not render
       * its blur, and once it has started life that way UIKit does not
       * reliably bring it back when the alpha reaches 1. The capsule's wrapper
       * is exactly such an ancestor (`fade` above), which is why the frosting
       * never appeared on device while the tint alone did.
       *
       * So the blur sits OUTSIDE that wrapper at full opacity and is slid down
       * out of its own clip at rest — entirely outside it, so nothing renders —
       * then rides back up over the same slice the capsule fades on. A
       * translateY is not an alpha, so UIKit keeps drawing it the whole way.
       */
      // iOS only. The park exists solely to keep a UIVisualEffectView out
      // from under a fading ancestor; Android has no such view and no such
      // constraint, so there the backdrop stays put and fades like it always
      // did (`capsuleFade` below).
      // Negative in LTR (out past the leading edge, to the left), positive in
      // Arabic where leading is the right — `logicalSign` is the same mapping
      // `shift` uses below, so the pill and the title always leave the same way.
      capsulePark: table(SPEC.back.fade, [android ? 0 : -logicalSign(dir) * PICK_PILL_PARK_X, 0]),
      // The backdrop's own opacity. On Android it is the original fade — the
      // capsule is a flat tint there and fades in with everything else. On iOS
      // it must stay at 1 (a blur under alpha < 1 renders nothing), which is
      // what the park is for.
      capsuleFade: android ? table(SPEC.back.fade, [0, 1]) : undefined,
      shift: table(SPEC.back.fade, [0, logicalSign(dir) * BACK_SHIFT]),
      footer: table(SPEC.button.fade, [1, 0]),
    };
  }, [progress, dir]);

  // The reading shade, and the same colour at zero for every gradient's far
  // stop: `transparent` is black at alpha 0 on Android, which greys the ramp.
  const courtShade = withAlpha(colors.page, SHADE_ALPHA[appearance] * FOOTER_SHADE_SCALE);
  const clear = withAlpha(colors.page, 0);

  const cta = <NetCta progress={progress} hidden={sheetMounted} onPress={open} />;
  // Box height S, blank band f·H at its top: start it m above the stage so
  // f·(S + m) − m = COURT_GAP, i.e. m = (f·S − gap) / (1 − f).
  const stageBox = stageHeight - tabBarHeight;
  // Android only: the box stops at the ratio that matches iOS, and the spare
  // height is split above and below so the court sits centred between the
  // title and the footer, where it sits on iOS (owner, 2026-09-29).
  const courtBox =
    android && stageRect && stageRect.width > 0
      ? Math.min(stageBox, Math.round(stageRect.width * ANDROID_COURT_BOX_RATIO))
      : stageBox;
  const courtBand =
    courtBox > 0
      ? Math.max(0, Math.round((COURT_TOP_BAND * courtBox - COURT_GAP) / (1 - COURT_TOP_BAND)))
      : 0;
  const courtTop = Math.round((stageBox - courtBox) / 2) - courtBand;
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

      {/* Everything above the stage — heading, open-now pill — stands
          directly on the pattern, at the strength the rest of
          the page has it. There WAS a reading shade over this whole block; it
          is gone because it made the top of the page a different picture from
          the bottom, which is the thing the owner kept pointing at. The one
          string it was genuinely protecting, the open-now pill, carries its own
          plate now (OpenNowPill) — the heading is display-sized, so it never
          needed it.

          `zIndex: 1` still lives here, so the whole block paints over the
          lifted court the way each row used to on its own. */}
      <View style={{ zIndex: 1 }}>
        {/* Header: [back to the court] BOOK A COURT ⇄ PICK A TIME on the
            leading edge, where the logo was (owner, 2026-09-26: the logo is
            painted on the court's turf now, courtTransition/courtLogo.ts), and
            the open-now pill on the trailing edge. Above the stage in z so the
            lifted court passes beneath. */}
        <View
          style={{
            paddingStart: space.l,
            paddingEnd: space.l,
            // The capsule pulls itself up by its own PAD_Y round the heading,
            // and on iOS its glass rim wants air above it. The air goes on the
            // WHOLE row, so both headings take it together and BOOK A COURT ⇄
            // PICK A TIME still cross-fade in place.
            paddingTop: 10 + PICK_PILL_TOP_AIR,
            flexDirection: 'row',
            alignItems: 'flex-start',
          }}
        >
          <Animated.View style={{ flex: 1, transform: [{ translateX: header.shift }] }}>
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
                {/* One line always (owner, 2026-09-29): it shrinks on narrow
                    phones and in longer languages, and never grows past 26. */}
                <Title squiggle={false} fit>
                  {t('booking.title')}
                </Title>
              </Animated.View>
              {/* Absolute so the outgoing heading alone sets the row's height —
                  the two strings are different lengths and, in Arabic, different
                  heights. */}
              <Animated.View
                // The capsule is faded out but still laid out when the sheet is
                // shut, so taps must not reach the button through it — this is
                // the guard the free-standing button carried on its own wrapper.
                pointerEvents={isOpen ? 'auto' : 'none'}
                accessibilityElementsHidden={!isOpen}
                importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
                style={{
                  // The capsule holds the button, so it opens on the row's own
                  // margin and the shift is all that positions it — the bleed
                  // and clearance budget the free-standing pill needed are gone.
                  position: 'absolute',
                  start: -BACK_SHIFT,
                  top: 0,
                  // NO OPACITY HERE. This used to carry `header.fade`, and that
                  // is what kept the capsule from ever frosting on device: a
                  // UIVisualEffectView (and iOS 26's GlassView with it) renders
                  // nothing while any ancestor sits at alpha < 1, and it does
                  // not reliably recover once the alpha reaches 1 — the same
                  // constraint BookingSheet records for the card's own blur.
                  // The fade now lives on the two children INSIDE instead: the
                  // backdrop hides itself by parking out of its clip, and the
                  // chevron and words fade as they always did. The wrapper is
                  // left as pure layout.
                }}
              >
                {/* PICK A TIME reads over the 3D court, where BOOK A COURT reads
                    over the page — by the time the sheet is open the court has
                    risen behind these words. Frosted like the sheet card: iOS
                    blurs the court behind it, Android has no blur to sit on and
                    carries the contrast on the tint alone. Not
                    `pointerEvents="none"`: the back button inside it has to stay
                    pressable. NO OPACITY on anything above the glass — the fade
                    rides the content inside (see PickTimeHeader). */}
                <PickTimeHeader
                  title={t('booking.pickTime')}
                  backLabel={t('booking.backToCourt')}
                  fade={header.fade}
                  park={header.capsulePark}
                  plateFade={header.capsuleFade}
                  dark={dark}
                  tint={glass}
                  sink={pillSink}
                  disabled={!isOpen || sheetBusy}
                  busy={sheetBusy}
                  onBack={close}
                />
              </Animated.View>
            </View>
            {/* BOOK A COURT's mark. It used to be ONE mark shared by both
                headings, drawn once here so it could not flicker: two identical
                marks fading through each other dip to ~75 % at the halfway
                point, and the brand mark is the thing that must not flicker.
                PICK A TIME's mark now lives inside the capsule instead (owner,
                2026-09-19), so this one belongs to the outgoing heading alone
                and leaves on its slice — `header.out`, the same value the words
                above it use, so mark and heading go together. */}
            <Animated.View
              style={{ alignItems: 'flex-start', marginBottom: space.s, opacity: header.out }}
            >
              <TitleSquiggle />
            </Animated.View>
          </Animated.View>
          {/* Belongs to the court view, like the branch picker: it fades out
              with BOOK A COURT when the sheet opens and back in as it closes
              (owner, 2026-09-26). The fade is only attached while the sheet is
              mounted; the sheet unmounts at p 0.25 on the way down, where
              `header.out` is already ~1, so dropping to a plain 1 there does
              not show. The `key` remounts the pill at that moment, so its glass
              is created fresh with nothing fading above it. */}
          <View
            pointerEvents={isOpen ? 'none' : 'auto'}
            accessibilityElementsHidden={isOpen}
            importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
            style={{ marginStart: space.sm }}
          >
            <OpenNowPill
              key={sheetMounted ? 'fading' : 'rest'}
              settings={settings.data ?? undefined}
              fade={sheetMounted ? header.out : 1}
            />
          </View>
        </View>

        {/* The branch picker (multi-venue slice 4), before the grid: which
            branch the sheet will book at. It renders nothing with one open
            branch, so today's tab is unchanged. It belongs to the court view
            and leaves with BOOK A COURT (`header.out`), taking no touches and
            hiding from screen readers while the sheet is up. The sheet then
            shows the chosen branch's times, phone and notice. */}
        <Animated.View
          pointerEvents={isOpen ? 'none' : 'auto'}
          accessibilityElementsHidden={isOpen}
          importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
          style={{ paddingStart: space.l, paddingEnd: space.l, opacity: header.out }}
        >
          <BranchPicker testID="book.branch" style={{ paddingBottom: space.s }} />
        </Animated.View>
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
        {/*
          NO VENUE NOTICE ON THIS TAB. The amber "venue connection lost" banner
          used to sit here, under the title, whenever the till's heartbeat went
          stale — which is most nights after close, and for a few seconds on
          many mornings. A guest opening the app at midnight to look at
          tomorrow was greeted by an error about a server they have never
          heard of (owner, 2026-09-11). The fact only matters at the moment of
          booking, so it lives in the sheet now: a small line under the
          duration picker, with the venue's number to tap (BookingSheet).
        */}
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
            patternBox={courtPatternBox}
            style={[
              stageBounds,
              courtBox < stageBox
                ? { top: courtTop, height: courtBox + courtBand }
                : { top: courtTop, bottom: tabBarHeight },
            ]}
            layerStyle={courtLayer}
            progress={progress}
            direction={direction}
            reduceMotion={reduceMotion}
            onSize={onCourtSize}
            onUnavailable={onUnavailable}
            onFirstFrame={onCourtPainted}
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

        {sheetMounted || sheetPrewarmed ? (
          <BookingSheet
            testID="book.sheet"
            progress={progress}
            direction={direction}
            bottomInset={tabBarHeight}
            isOpen={isOpen}
            onBusyChange={setSheetBusy}
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
            { top: Math.min(0, courtTop), backgroundColor: colors.page, opacity: veil },
          ]}
        />
      </View>
    </Screen>
  );
}
