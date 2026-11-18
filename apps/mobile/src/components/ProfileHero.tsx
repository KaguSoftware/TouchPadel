import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Image, Platform, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LtrIsland } from '../i18n/direction';
import { useLocale } from '../i18n/LocaleProvider';
import { Text } from '../i18n/text';
import { brand, useTheme } from '../theme';
import { frameDrawing, type FrameId, type FrameStyle } from '../features/profile/frames';
import {
  HERO_CIRCLE,
  HERO_MS,
  HERO_PULL,
  HERO_T,
  NAME_SIZE,
  heroByP,
  heroGeo,
  heroState,
  mixColor,
  type HeroGeo,
} from '../features/profile/heroState';
import { BrandPattern } from './BrandPattern';
import { ProfileAvatar } from './ProfileAvatar';

/**
 * The Edit profile header, after Telegram's settings page (owner, 2026-11-16).
 *
 * At rest a full-width band: the guest's photo, or, without one, the brand blue
 * with the brand lines and their letter (as on a coach's page). A small scroll
 * or pull starts the FLIGHT, which plays by itself (it is a timed animation, not
 * tied to the finger): a circle, an iris, closes in on the band, and the normal
 * framed avatar fades in over it as it lands. No corner moves and the content
 * never zooms, it only slides to keep the face (or the letter) in the window.
 * The name and the phone line settle centred under the circle. Scrolling back to
 * the top plays the flight in reverse.
 *
 * The scroll offset only moves the page: once the flight has started, the
 * circle and the texts leave with it. Pulling past the top stretches the band
 * while it is wide. A light haptic marks the start of each flight and the far
 * end of a pull (iOS only).
 *
 * REANIMATED (this is why the app depends on it): the scroll offset, the
 * flight and every style run on the UI thread, so a busy JavaScript thread
 * cannot stall the animation. The geometry is `features/profile/heroState.ts`,
 * pure and tested, whose functions are worklets and are called here unchanged.
 * Native code: a new dev client / store build is needed to ship it.
 *
 * iOS draws the native bar clear over the page, so the band runs under it.
 * Android keeps its own solid toolbar above the page.
 *
 * The page keeps a `HeroSpacer` first in its scroll content, wraps its rows in
 * `HeroRows`, draws the scroll view as Reanimated's with `useHeroFlight`'s
 * `onScroll`, and mounts one `HeroOverlay` beside it.
 */

const IOS = Platform.OS === 'ios';
const AView = Animated.View;
const AText = Animated.createAnimatedComponent(Text);
/** Made here, on the JS side: a worklet takes an easing it was handed, it does not build one. */
const FLIGHT_EASING = Easing.bezier(0.3, 0, 0.2, 1);

export function useHeroGeo(hasPhoto: boolean, frame: FrameId, frameStyle: FrameStyle): HeroGeo {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(
    () =>
      heroGeo({
        W: width,
        top: IOS ? insets.top : 0,
        frameInset: frameDrawing(frame, HERO_CIRCLE, frameStyle).inset,
        hasPhoto,
      }),
    [width, insets.top, hasPhoto, frame, frameStyle],
  );
}

const tick = () => {
  if (IOS) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

export type HeroBarState = { closed: boolean; gone: boolean };

/**
 * What the native bar needs to know, as a tiny store outside React state: `closed` is where the
 * flight has landed, `gone` is that the circle has left the screen with the page. Changing it
 * re-renders whatever reads it and reconfigures the bar, so only a small component reads it
 * (`useHeroBar`) and it only changes while no flight is playing.
 */
export type HeroBarStore = {
  get: () => HeroBarState;
  subscribe: (listener: () => void) => () => void;
  /** Called from the UI thread. */
  setGone: (gone: boolean) => void;
  settle: (closed: boolean, gone: boolean) => void;
};

function createBarStore(): HeroBarStore {
  const listeners = new Set<() => void>();
  let bar: HeroBarState = { closed: false, gone: false };
  const set = (next: HeroBarState) => {
    if (next.closed === bar.closed && next.gone === bar.gone) return;
    bar = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => bar,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setGone: (gone) => set({ closed: bar.closed, gone }),
    // One frame later, so the last frame of the flight paints before the bar is touched.
    settle: (closed, gone) => {
      requestAnimationFrame(() => set({ closed, gone }));
    },
  };
}

/** `closed` and `gone`, for the small component that owns the native bar's options. */
export function useHeroBar(bar: HeroBarStore): HeroBarState {
  return useSyncExternalStore(bar.subscribe, bar.get);
}

export type HeroFlight = {
  /** 0 the full-width band, 1 the framed circle. */
  prog: SharedValue<number>;
  scrollY: SharedValue<number>;
  /** The page's `onScroll`, on Reanimated's scroll view. */
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  bar: HeroBarStore;
};

/**
 * Runs the flight, on the UI thread. A scroll past HERO_T starts it forward; getting back to the
 * top (or pulling past it) plays it in reverse.
 */
export function useHeroFlight(): HeroFlight {
  const prog = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const target = useSharedValue(0);
  const flying = useSharedValue(false);
  const stretched = useSharedValue(false);
  const wantGone = useSharedValue(false);
  const sentGone = useSharedValue(false);
  const [bar] = useState(createBarStore);

  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        const y = e.contentOffset.y;
        scrollY.value = y;
        const fly = (to: number) => {
          target.value = to;
          flying.value = true;
          scheduleOnRN(tick);
          prog.value = withTiming(to, { duration: HERO_MS, easing: FLIGHT_EASING }, (finished) => {
            if (!finished) return; // a newer flight took over; it will settle
            flying.value = false;
            sentGone.value = wantGone.value;
            scheduleOnRN(bar.settle, to === 1, wantGone.value);
          });
        };
        if (target.value === 0 && y > HERO_T) fly(1);
        else if (target.value === 1 && y <= 2) fly(0);
        wantGone.value = y > HERO_T + 60;
        if (!flying.value && sentGone.value !== wantGone.value) {
          sentGone.value = wantGone.value;
          scheduleOnRN(bar.setGone, wantGone.value);
        }
        if (!stretched.value && y < -HERO_PULL * 0.4) {
          stretched.value = true;
          scheduleOnRN(tick);
        } else if (stretched.value && y > -HERO_PULL * 0.1) {
          stretched.value = false;
        }
      },
    },
    [bar],
  );
  return { prog, scrollY, onScroll, bar };
}

/**
 * The native bar's title, drawn as a view so it can fade: it comes in over the scroll that carries the
 * circle off the screen, and goes back out as the circle returns. (The native title text can only be
 * swapped, not faded.) iOS only; Android's solid toolbar carries its own title.
 */
export function HeroBarTitle({ flight, title }: { flight: HeroFlight; title: string }) {
  const { colors, fonts } = useTheme();
  const { scrollY } = flight;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [HERO_T + 30, HERO_T + 60], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <AView style={style}>
      <Text numberOfLines={1} style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>
        {title}
      </Text>
    </AView>
  );
}

/** Reserves the header's room in the scroll content: the landed height, always. */
export function HeroSpacer({ geo }: { geo: HeroGeo }) {
  return <View style={{ height: geo.H1 }} />;
}

/** The page's rows: pushed down by the wide band's extra room, and sliding up as the flight plays. */
export function HeroRows({ geo, flight, children }: { geo: HeroGeo; flight: HeroFlight; children: ReactNode }) {
  const { prog } = flight;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: heroByP(prog.value, geo, 160, 200).heroH - geo.H1 }],
  }));
  return <AView style={style}>{children}</AView>;
}

export function HeroOverlay({
  geo,
  flight,
  hasPhoto,
  photoUri,
  path,
  letter,
  name,
  subline,
  busy,
  frame,
  frameStyle,
}: {
  geo: HeroGeo;
  flight: HeroFlight;
  hasPhoto: boolean;
  /** The signed photo URL once it has loaded. */
  photoUri: string | undefined;
  path: string | null | undefined;
  /** The one letter the band and the avatar show without a photo. */
  letter: string;
  name: string;
  subline: string;
  busy: boolean;
  frame: FrameId;
  frameStyle: FrameStyle;
}) {
  const { colors, fonts } = useTheme();
  const { dir } = useLocale();
  const { prog, scrollY } = flight;
  // Positions are transforms (physical), measured from the start edge: mirrored in Arabic.
  const sign = dir === 'rtl' ? -1 : 1;
  // The name and the line, measured, so they can centre.
  const [nameW, setNameW] = useState(160);
  const [lineW, setLineW] = useState(200);
  const { W, H0, circle } = geo;
  const ink = colors.ink;
  const mut = colors.mut;

  // Everything the header draws, from the two inputs, once per frame on the UI thread.
  const hs = useDerivedValue(() => heroState(scrollY.value, prog.value, geo, nameW, lineW), [geo, nameW, lineW]);

  const boxStyle = useAnimatedStyle(() => ({
    height: hs.value.boxH,
    transform: [{ translateY: hs.value.boxTop }],
  }));
  const clipStyle = useAnimatedStyle(() => ({
    width: hs.value.clipSize,
    height: hs.value.clipSize,
    borderRadius: hs.value.clipSize / 2,
    transform: [{ translateX: hs.value.clipStart }, { translateY: hs.value.clipTop }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    height: hs.value.full,
    transform: [{ translateX: hs.value.contentStart }, { translateY: hs.value.contentTop }],
  }));
  const slideStyle = useAnimatedStyle(() => ({
    height: hasPhoto ? hs.value.full : H0,
    transform: [{ translateX: hs.value.tx }, { translateY: hs.value.ty }, { scale: hs.value.scale }],
  }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: hs.value.shade }));
  const avatarStyle = useAnimatedStyle(() => ({
    opacity: hs.value.avatarOpacity,
    transform: [{ translateY: hs.value.avatarTop }],
  }));
  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hs.value.boxTop + hs.value.clipTop + hs.value.clipSize / 2 - 12 }],
  }));
  const nameStyle = useAnimatedStyle(() => ({
    color: mixColor('#ffffff', ink, hs.value.tone),
    textShadowColor: `rgba(0,0,0,${0.45 * (1 - hs.value.tone)})`,
    transform: [{ translateX: sign * hs.value.nameStart }, { translateY: hs.value.nameTop }],
  }));
  const lineStyle = useAnimatedStyle(() => ({
    color: mixColor('#ffffff', mut, hs.value.tone, 0.92),
    textShadowColor: `rgba(0,0,0,${0.45 * (1 - hs.value.tone)})`,
    transform: [{ translateX: sign * hs.value.lineStart }, { translateY: hs.value.lineTop }],
  }));

  const fill: ViewStyle = { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 };
  const letterSize = Math.round(H0 * 0.3);
  const ground = hasPhoto ? brand.navy : brand.blue;

  return (
    <View pointerEvents="none" style={fill}>
      {/* The iris: a circular window over the band. Physical coordinates, so it stays left to right. */}
      <LtrIsland style={fill}>
        <AView style={[{ position: 'absolute', top: 0, start: 0, width: W, overflow: 'hidden' }, boxStyle]}>
          <AView
            style={[
              { position: 'absolute', top: 0, start: 0, overflow: 'hidden', backgroundColor: ground },
              clipStyle,
            ]}
          >
            <AView style={[{ position: 'absolute', top: 0, start: 0, width: W, backgroundColor: ground }, contentStyle]}>
              <AView
                style={[
                  { position: 'absolute', top: 0, start: 0, width: W, transformOrigin: '0 0' },
                  slideStyle,
                ]}
                // The photo (or the lines) is drawn once and moved as a bitmap while the flight plays.
                shouldRasterizeIOS
                renderToHardwareTextureAndroid
              >
                {hasPhoto ? (
                  photoUri ? (
                    <Image
                      source={{ uri: photoUri }}
                      resizeMode="cover"
                      style={{ width: '100%', height: '100%' }}
                      accessibilityIgnoresInvertColors
                    />
                  ) : null
                ) : (
                  <>
                    <BrandPattern />
                    <View style={{ ...fill, alignItems: 'center', justifyContent: 'center' }}>
                      <Text
                        style={{
                          fontFamily: fonts.display800,
                          fontSize: letterSize,
                          lineHeight: Math.round(letterSize * 1.1),
                          includeFontPadding: false,
                          color: brand.white,
                        }}
                      >
                        {letter}
                      </Text>
                    </View>
                  </>
                )}
              </AView>
              <AView style={[fill, shadeStyle]}>
                <LinearGradient
                  colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']}
                  style={{ position: 'absolute', top: 0, start: 0, end: 0, height: geo.top + 70 }}
                />
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']}
                  style={{ position: 'absolute', bottom: 0, start: 0, end: 0, height: 170 }}
                />
              </AView>
            </AView>
          </AView>
        </AView>
        {busy ? (
          <AView style={[{ position: 'absolute', top: 0, start: (W - 24) / 2 }, spinnerStyle]}>
            <ActivityIndicator color={brand.white} />
          </AView>
        ) : null}
      </LtrIsland>
      {/* The normal framed avatar, faded in over the iris as the flight lands. */}
      <AView
        style={[{ position: 'absolute', width: circle, height: circle, top: 0, start: (W - circle) / 2 }, avatarStyle]}
      >
        <ProfileAvatar path={path} initials={letter} size={circle} frame={frame} frameStyle={frameStyle} />
      </AView>
      <AText
        numberOfLines={1}
        style={[
          {
            position: 'absolute',
            top: 0,
            start: 0,
            maxWidth: W - 40,
            fontFamily: fonts.display800,
            fontSize: NAME_SIZE,
            textShadowRadius: 6,
            textShadowOffset: { width: 0, height: 1 },
          },
          nameStyle,
        ]}
      >
        {name}
      </AText>
      <AText
        numberOfLines={1}
        style={[
          {
            position: 'absolute',
            top: 0,
            start: 0,
            maxWidth: W - 40,
            fontFamily: fonts.body600,
            fontSize: 13,
            textShadowRadius: 6,
            textShadowOffset: { width: 0, height: 1 },
          },
          lineStyle,
        ]}
      >
        {subline}
      </AText>
      {/* Hidden twins that measure the texts so they can be centred. */}
      <Text
        onLayout={(e) => setNameW(e.nativeEvent.layout.width)}
        style={{ position: 'absolute', opacity: 0, fontFamily: fonts.display800, fontSize: NAME_SIZE }}
      >
        {name}
      </Text>
      <Text
        onLayout={(e) => setLineW(e.nativeEvent.layout.width)}
        style={{ position: 'absolute', opacity: 0, fontFamily: fonts.body600, fontSize: 13 }}
      >
        {subline}
      </Text>
    </View>
  );
}
