import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Image,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutRectangle,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { Text } from '../../src/i18n/text';
import { useFocusEffect } from 'expo-router';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { logicalSign, mirror } from '../../src/i18n/direction';
import { useVenueSettings } from '../../src/features/availability/hooks';
import { openNowInfo, type VenueSettingsPublic } from '../../src/features/availability/assemble';
import { useCourtTransition } from '../../src/features/courtTransition/useCourtTransition';
import { takeBookingSheetRequest } from '../../src/features/courtTransition/openIntent';
import {
  lerp,
  pitchEase,
  sampleCurve,
  sampleEased,
  SPEC,
  type Range,
} from '@touch/court3d/spec';
import {
  courtTopFraction,
  makeCamera,
  projectNet,
} from '@touch/court3d/camera';
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

/** logo.png is 900×332: a 30 pt tall wordmark is 81 pt wide (design lets height drive width). */
const LOGO_H = 30;
const LOGO_W = Math.round(LOGO_H * (900 / 332));
const android = Platform.OS === 'android';
/**
 * Android's navigation icon is the platform's own control, so it keeps the
 * platform's own measurements: Material's minimum touch target is 48 dp, and the
 * borderless ripple is drawn to the edge of that box. iOS took a different road
 * — there the whole capsule is the button (below) — but on Android a tappable
 * heading is not the idiom, so the icon button stays exactly what it was.
 */
const BACK_BTN_ANDROID = 48;
/**
 * The chevron's slot on iOS, where the glyph is only a mark: the capsule around
 * it takes the press, so it is sized to the SF Symbol rather than to a target.
 */
const BACK_GLYPH_IOS_SLOT = 17;
/**
 * The slot the Android icon button occupies in the row — unchanged from before
 * any of this. Its 48 dp touch target bleeds out past this box on all four
 * sides, so the capsule's height and the heading's position are set by the 34,
 * not by the target.
 */
const BACK_BTN_SLOT_ANDROID = 34;
/**
 * The 48 dp Android target is bigger than the slot the capsule lays out for the
 * glyph, so it is bled back out on all four sides — the button keeps its centre,
 * the capsule keeps its height, and the heading does not move.
 */
const ANDROID_BTN_BLEED = (BACK_BTN_ANDROID - BACK_BTN_SLOT_ANDROID) / 2;
/**
 * PICK A TIME's capsule — now the back button itself, chevron and words in one
 * control, so the padding is simply the air inside a button.
 *
 * The numbers fork by platform because the capsule's leading end holds a
 * different thing on each. ANDROID KEEPS ITS ORIGINAL VALUES (6 / 8 / 6): the
 * icon button is still there, and its own 48 dp box holds the arrow off the
 * capsule's curve exactly as it always did.
 *
 * iOS is retuned for a bare glyph. PAD_X goes 6 → 12: the chevron used to arrive
 * inside a bordered circle whose box did that job, and without it the glyph
 * would sit almost on the edge — a stadium's curve is widest at the middle of
 * its end cap, which is exactly where a centred chevron lands. TEXT_PAD goes
 * 8 → 6 to match: the two ends were lopsided only because the circle padded the
 * leading end for free, and with both ends paid for in real padding they balance
 * at a smaller number.
 */
const PICK_PILL_PAD_X = android ? 6 : 12;
const PICK_PILL_PAD_Y = 6;
const PICK_PILL_TEXT_PAD = android ? 8 : 6;
/**
 * Extra air above the title row, on iOS only.
 *
 * The row opens on `space.sm` (12) under the logo, and the capsule then pulls
 * itself back up by its own PAD_Y so it grows around the line rather than
 * pushing it down — which leaves only ~6 pt between the logo and the plate's top
 * edge. That was fine while the capsule barely had an edge; with real glass, and
 * its bright rim on iOS 26, the boundary is visible and reads as crowded.
 *
 * It goes on the ROW, not on the capsule. Both headings then take it together,
 * which is what keeps BOOK A COURT and PICK A TIME cross-fading in place: they
 * overlap on the same slice (SPEC.back.fade), so a capsule whose text sat lower
 * than the heading it replaces would visibly drift against it mid-transition.
 *
 * Android is untouched: its capsule is a flat tint with no rim, and its spacing
 * was never the problem.
 */
const PICK_PILL_TOP_AIR = android ? 0 : 10;
/**
 * The gap between the chevron and the words. On Android it is still PAD_X's old
 * value, which is what the row used before — nothing changed there. On iOS it
 * gets its own number: PAD_X used to double as this gap only because the
 * chevron's circle already supplied most of the air, and a bare glyph has to
 * stand the distance on its own — too tight and the chevron crowds the P, too
 * wide and the control reads as two things sharing a plate.
 */
const PICK_PILL_GAP = android ? 6 : 8;
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
 * padding, landing at 5 above / 7 below, which reads level once the empty
 * descender room is discounted.
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
 * Everything the capsule puts BEFORE the words. The title slides over by exactly
 * this much, and the capsule opens exactly this far before the heading's own
 * margin — so the words land back on the margin they share with BOOK A COURT
 * while the capsule grows leftwards around them.
 *
 * Android is the original expression, unchanged: the icon button's 34 pt slot
 * plus the padding either side of it (46). iOS measures from the GLYPH instead,
 * because the button that used to set this width is gone there. Derived from the
 * parts on both sides so it stays true if the padding is retuned.
 */
const BACK_SHIFT = android
  ? BACK_BTN_SLOT_ANDROID + PICK_PILL_PAD_X * 2
  : BACK_GLYPH_IOS_SLOT + PICK_PILL_GAP + PICK_PILL_PAD_X;
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
 * The "Open now · 09:00–02:00" pill. Owns the minute clock so the rest of the
 * screen — the GL court in particular — does not re-render every minute.
 */
function OpenNowPill({ settings }: { settings: VenueSettingsPublic | undefined }) {
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
    // GlassView renders here because nothing above the pill fades — the
    // condition the capsule's park exists to meet.
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
 * The PICK A TIME capsule's outer element.
 *
 * On iOS it is a Pressable: the whole capsule — chevron and words — is the back
 * button (owner, 2026-09-19), which is both a far bigger target and the reading
 * the glass already suggested.
 *
 * On Android it is a plain View. Material's back affordance is the navigation
 * ICON, not a tappable title, so there the capsule stays inert and the icon
 * button inside it keeps the press, the ripple and the 48 dp target exactly as
 * it had them. Taking a `style` callback either way keeps the one JSX block
 * below from having to fork.
 */
function CapsuleControl({
  style,
  children,
  testID,
  ...props
}: Omit<PressableProps, 'style'> & { style: (state: { pressed: boolean }) => ViewStyle }) {
  // The id is forwarded to BOTH branches and stated EXPLICITLY rather than
  // left to `{...props}` (which carries it — `testID` is a PressableProps):
  // the lint rule reads the JSX, and the Android branch is a plain View that
  // the spread never reaches at all.
  if (android)
    return (
      <View testID={testID} style={style({ pressed: false })}>
        {children as ReactNode}
      </View>
    );
  return (
    <Pressable {...props} testID={testID} style={style}>
      {children as ReactNode}
    </Pressable>
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

      {/* Everything above the stage — logo, open-now pill, heading — stands
          directly on the pattern, at the strength the rest of
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

        {/* Title row: [back to the court] BOOK A COURT ⇄ PICK A TIME */}
        <View
          style={{
            paddingStart: space.l,
            paddingEnd: space.l,
            // The capsule's plate used to sit ~6 pt under the logo row and read
            // as crowded against it once it became real glass with a visible
            // rim. The air goes on the WHOLE row, so both headings take it
            // together and BOOK A COURT ⇄ PICK A TIME still cross-fade in place.
            paddingTop: space.sm + PICK_PILL_TOP_AIR,
          }}
        >
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
                    carries the contrast on the tint alone.

                    The back button rides INSIDE the capsule, sharing its blur
                    and border, so the two read as one control rather than a
                    button parked beside a plate. That is also why this layer is
                    not `pointerEvents="none"` as the bare pill was — the button
                    inside it has to stay pressable. */}
                {/* THE WHOLE CAPSULE IS THE BACK BUTTON — chevron and words
                    together, one control on one glass surface (owner,
                    2026-09-19). It used to be a small round button parked beside
                    a heading that happened to share its plate; now the plate IS
                    the button, which is both a far bigger target and the reading
                    the glass already suggested.

                    That also retires the nested-glass problem: there is one
                    material here, not a `clear` control sitting on a `regular`
                    plate, so nothing can read as double-frosted.

                    `accessibilityRole` and the label live here, on the thing
                    that is actually pressable; the chevron below is now only a
                    glyph and is hidden from assistive tech. */}
                {/* NO OPACITY ON THIS ONE EITHER. It briefly carried
                    `header.fade` while the backdrop was hoisted outside it, and
                    moving the backdrop back in (to give the plate a real box to
                    size itself against) put the glass under a fading ancestor
                    again — which is precisely the thing a UIVisualEffectView
                    refuses to render under, and the capsule went flat on device
                    a second time.

                    So the fade sits on the CONTENT instead: the glyph and the
                    words each carry it, the backdrop carries none of it and
                    hides by parking out of its clip. Nothing above the glass
                    animates its alpha. */}
                <View>
                  <CapsuleControl
                    testID="book.court-title"
                    // iOS ONLY. On Android these all land on a plain View (see
                    // CapsuleControl): the capsule is inert there and the icon
                    // button below takes the press, because a tappable heading
                    // is an iOS idiom and Material's is the navigation icon.
                    accessibilityRole={android ? undefined : 'button'}
                    accessibilityLabel={android ? undefined : t('booking.backToCourt')}
                    accessibilityState={
                      android ? undefined : { disabled: !isOpen || sheetBusy, busy: sheetBusy }
                    }
                    disabled={android ? undefined : !isOpen || sheetBusy}
                    onPress={android ? undefined : close}
                    style={({ pressed }: { pressed: boolean }) => ({
                      // NO OPACITY HERE EITHER — not even the busy dim. It is
                      // 1 almost always, but it drops to 0.55 while a hold
                      // settles, and the glass below would go flat for exactly
                      // that moment. The dim rides the content with the fade.
                      flexDirection: 'row',
                      // Centred on the plate, so the glyph sits in the middle of
                      // the glass rather than on the heading's line (owner,
                      // 2026-09-19). The column beside it is the words plus the
                      // mark under them, and the capsule's whole point is that it
                      // is ONE shape — an icon aligned to the text's line reads
                      // as pinned to the top of that shape, which is what the
                      // top-alignment here used to do.
                      alignItems: 'center',
                      alignSelf: 'flex-start',
                      paddingStart: PICK_PILL_PAD_X,
                      paddingEnd: PICK_PILL_PAD_X + PICK_PILL_TEXT_PAD,
                      paddingTop: PICK_PILL_PAD_Y,
                      paddingBottom: PICK_PILL_PAD_Y,
                      gap: PICK_PILL_GAP,
                      // Bled back out so the capsule grows around the line rather
                      // than pushing it down.
                      marginTop: -PICK_PILL_PAD_Y,
                      borderRadius: radius.pill,
                      // The press response, iOS only. Liquid Glass answers to
                      // the touch itself (the backdrop's `isInteractive`), so
                      // this tint is just for the pre-26 stand-in. Android never
                      // presses here at all.
                      backgroundColor:
                        pressed && !android && !liquidGlass
                          ? withAlpha(colors.sub, 0.18)
                          : 'transparent',
                    })}
                  >
                    {/* The capsule's backdrop — Liquid Glass on iOS 26, blur and
                        tint everywhere else — on its own absolute layer so
                        the sink can drop it off the line box's centre
                        without moving the words. Inset by +SINK at the top and
                        -SINK at the foot, so it shifts down while keeping its
                        height. Clipping lives HERE rather than on the row:
                        `overflow: hidden` up there would crop this very offset,
                        and a blurred view escaping a rounded parent squares off at
                        the corners. */}
                    <View
                      pointerEvents="none"
                      style={{
                        // Stretched to all four edges of the capsule itself — it
                        // is the pressable's own first child now, so it fills a
                        // box that the padding and the words have really sized.
                        //
                        // It used to hang off the absolute WRAPPER outside, which
                        // shrink-wrapped and so had no height to give: the plate
                        // collapsed to a band and the words stood out the top of
                        // it (owner, 2026-09-19). Nothing here measures anything
                        // any more.
                        //
                        // The sink shifts the whole plate down off the line box's
                        // centre — both edges by the same amount, so it moves
                        // without shrinking. (`start`/`end` rather than
                        // left/right: the row is mirrored wholesale in Arabic.)
                        position: 'absolute',
                        start: 0,
                        end: 0,
                        top: pillSink,
                        bottom: -pillSink,
                        borderRadius: radius.pill,
                        overflow: 'hidden',
                      }}
                    >
                      {/* iOS: PARKED, NOT FADED — see `header.capsulePark`. At
                          full opacity always, slid out of the clip at rest and
                          back in as the sheet opens, so UIKit never sees the blur
                          under a fading ancestor.

                          It parks SIDEWAYS, along the leading edge. It used to go
                          down, which read as the pill collapsing into the header
                          (owner, 2026-09-19); the capsule already travels
                          horizontally on this transition — the whole title row
                          rides `header.shift` — so leaving the same way is the
                          move the eye is expecting.

                          Android: unchanged from before any of this — no park, and
                          the flat tint simply fades in on the same slice. Native-
                          driven either way, like every other node that reads p. */}
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          StyleSheet.absoluteFill,
                          {
                            transform: [{ translateX: header.capsulePark }],
                            opacity: header.capsuleFade,
                          },
                        ]}
                      >
                        {liquidGlass ? (
                          /* iOS 26: the system material itself, in place of the
                             blur-plus-tint stand-in below. No fill over it — the
                             whole point of the hand-built version's tint was to
                             approximate a frosting the platform can now draw, and
                             stacking the veil on top would only cloud the real
                             one. It needs no open/closed switch of its own: the
                             park above keeps it out of sight at rest and out of
                             any fading ancestor, which is the same condition the
                             GlassView docs give for the effect rendering at all. */
                          <GlassView
                            pointerEvents="none"
                            // The capsule IS the back button now, so its material is
                            // the button's material: `isInteractive` gives it
                            // UIKit's own press response, the flex and highlight a
                            // system glass control has under the finger. That is why
                            // the pressable above paints no tint of its own on
                            // iOS 26 — the glass answers the touch itself.
                            isInteractive
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
                            <View
                              style={[
                                StyleSheet.absoluteFill,
                                {
                                  // The sheet card's own glass, to the value: it is
                                  // the box the time grid sits on, and this capsule
                                  // is the same material arriving a moment earlier.
                                  // `bg` and not `card` — the card's frosting tints
                                  // the page colour. Borderless, unlike the card:
                                  // the card's white edge separates it from the page
                                  // it floats over, and this one has no such job
                                  // over the court.
                                  backgroundColor: glass,
                                  borderRadius: radius.pill,
                                },
                              ]}
                            />
                          </>
                        )}
                      </Animated.View>
                    </View>
                    {/* The back affordance, which is a different KIND of
                        thing on each platform.

                        iOS: only a glyph. The capsule around it is the button,
                        so this carries no target, no fill and no border, and is
                        hidden from assistive tech (the capsule is labelled). It
                        is the system's own `chevron.backward`, mirrored here
                        rather than by the symbol: `.backward` resolves against
                        UIKit's RTL flag, and this app pins that flag LTR on
                        every launch (app.config.ts) because layout direction is
                        application state here — so UIKit always thinks it is LTR
                        and would point it the wrong way in Arabic.

                        Android: a real icon button, unchanged — Material's arrow
                        on a borderless 48 dp ripple, carrying the press, the
                        label and the disabled state, because on Android the
                        navigation icon is the back affordance and the heading
                        beside it is not tappable. The 48 dp target is bled back
                        out on all four sides so it keeps its centre without
                        growing the capsule or shoving the heading along. */}
                    {android ? (
                      /* The slot the absolute button sits in. It holds the row's
                         width open — the button itself is out of the flow, so
                         without this the heading would slide under the arrow —
                         while contributing no height of its own, which is the
                         whole point: the words alone set how deep the plate is. */
                      <Animated.View
                        style={{
                          // Android's capsule never had a blur to protect, but
                          // the fade moved off the shared wrapper for iOS's sake,
                          // so this slot takes its own copy — same value, same
                          // slice, identical result.
                          opacity: sheetBusy ? 0.55 : header.fade,
                          width: BACK_BTN_SLOT_ANDROID,
                          // Square, and the row centres it: the slot takes the
                          // arrow's own size and the plate's middle is wherever
                          // the row puts it. It was a heading-line-tall box only
                          // to fake that while the row was top-aligned.
                          height: BACK_BTN_SLOT_ANDROID,
                          justifyContent: 'center',
                          marginTop: pillSink * 2,
                        }}
                      >
                        <Pressable
                          testID="book.back-to-court"
                          accessibilityRole="button"
                          accessibilityLabel={t('booking.backToCourt')}
                          accessibilityState={{ disabled: !isOpen || sheetBusy, busy: sheetBusy }}
                          disabled={!isOpen || sheetBusy}
                          onPress={close}
                          android_ripple={{ color: withAlpha(colors.ink, 0.12), borderless: true }}
                          style={{
                            width: BACK_BTN_ANDROID,
                            // OUT OF THE FLOW, so the 48 dp target cannot set
                            // the row's height — the words do. Left in the flow
                            // its box still contributed 34 pt against the
                            // title's ~27, and that surplus landed as slack the
                            // text did not share, which is what made the plate
                            // deeper below the words than above them.
                            //
                            // It overhangs its 34 pt slot by ANDROID_BTN_BLEED
                            // on every side, evenly. The bleed is stated as
                            // insets rather than left to the parent's
                            // justifyContent, which does not place an absolute
                            // child. The old uneven pair (-1 top, -7 bottom,
                            // because the button also carried the sink) is
                            // exactly what tipped the row's centre off the
                            // text's.
                            position: 'absolute',
                            start: -ANDROID_BTN_BLEED,
                            top: -ANDROID_BTN_BLEED,
                            bottom: -ANDROID_BTN_BLEED,
                            borderRadius: radius.pill,
                            alignItems: 'center',
                            justifyContent: 'center',
                            // No dim here: the slot above already carries it,
                            // and two nested 0.55s compound to 0.30.
                          }}
                        >
                          <BackArrowIcon size={24} color={colors.ink} strokeWidth={2} />
                        </Pressable>
                      </Animated.View>
                    ) : (
                      <Animated.View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={{
                          // The fade lives on the content now, never on an
                          // ancestor of the glass — see the wrapper above. The
                          // busy dim rides with it for the same reason.
                          opacity: sheetBusy ? 0.55 : header.fade,
                          width: BACK_GLYPH_IOS_SLOT,
                          height: BACK_GLYPH_IOS_SLOT,
                          alignItems: 'center',
                          justifyContent: 'center',
                          // The row centres it now, so no hand-offset onto the
                          // heading's line any more — only the plate's own sink
                          // is ridden, so the glyph stays centred on the GLASS
                          // rather than on the box the row measures.
                          marginTop: pillSink * 2,
                        }}
                      >
                        <SymbolView
                          name="chevron.backward"
                          size={17}
                          weight="semibold"
                          tintColor={colors.ink}
                          style={mirror(dir)}
                          fallback={
                            <BackChevronIcon size={17} color={colors.ink} strokeWidth={2.4} />
                          }
                        />
                      </Animated.View>
                    )}
                    {/* The words AND the mark, both inside the plate (owner,
                        2026-09-19). Title's own squiggle row is declined and the
                        mark drawn here instead, so the column can cancel Title's
                        bottom margin — which exists to space a heading from the
                        content under it — without also losing the mark.

                        The plate therefore grows round both, and the capsule is
                        a taller lozenge than the one that held a single line.
                        That is the shape the owner asked for. */}
                    <Animated.View style={{ opacity: sheetBusy ? 0.55 : header.fade }}>
                      <View style={{ marginBottom: -space.s }}>
                        <Title squiggle={false}>{t('booking.pickTime')}</Title>
                      </View>
                      <View style={{ alignItems: 'flex-start' }}>
                        <TitleSquiggle />
                      </View>
                    </Animated.View>
                  </CapsuleControl>
                </View>
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
            style={[stageBounds, { top: courtTop, bottom: tabBarHeight }]}
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
            { top: courtTop, backgroundColor: colors.page, opacity: veil },
          ]}
        />
      </View>
    </Screen>
  );
}
