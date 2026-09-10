/**
 * The app's loading screen — one second of brand blue with the smiley ball,
 * between the native splash and the first real frame.
 *
 * THE PROBLEM IT SOLVES (owner, 2026-09-08): "the padel court is visible while
 * it's loading". The splash used to lift the instant boot prefs and the brand
 * fonts landed, which on a warm device is very fast — and what it uncovered was
 * the Book tab mid-build: the GL court still assembling its scene, the brand
 * pattern's one frame of bare ground, lists resolving out of the persisted
 * cache. Everything the app does between "ready" and "settled" was on show.
 *
 * SO THE ORDER IS INVERTED. This screen owns the reveal now (features/boot/
 * splash.ts): it paints FIRST, in the splash's own #3360AB, and only then asks
 * the native splash to hide — onto a surface identical to the one it was
 * showing, so there is no frame in which the court is visible and no colour
 * jump. The hold that follows is not padding: the GL context, the query cache
 * and the images all land underneath it, and the app that fades in is settled.
 *
 * It is the LAST child of DirectionRoot on purpose — a sibling of the whole
 * navigator, above the native tab bar, outside every route, and taking the
 * touches meanwhile. The locale-switch cover proved that position.
 *
 * It does NOT cover the crash or config-error screens: those render outside
 * AppRoot entirely and hide the splash themselves. A brand cover over an error
 * message is exactly the silent-white-screen bug in another colour.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LtrIsland } from '../../i18n/direction';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { brand } from '../../theme/tokens';
import { SmileyBall } from '../../components/SmileyBall';
import { claimBootOverlay } from './launchOnce';
import { hideNativeSplash } from './splash';

/** Visible hold once the splash is actually gone, and the fade that ends it. */
const HOLD_MS = 1000;
const REDUCED_HOLD_MS = 600;
const FADE_MS = 260;
/** If the splash never reports itself hidden, hold no longer than this. */
const WATCHDOG_MS = 1500;

const BALL = 104;
/** Bounce height, as a share of the ball. A ball hops; it does not fly. */
const APEX = BALL * 0.42;
const RISE_MS = 380;
const SPIN_MS = 1520;

export function BootOverlay() {
  // Lazily, so the latch is spent on the FIRST render of the launch and a Fast
  // Refresh remount does not replay the screen.
  const [owns] = useState(claimBootOverlay);
  const [done, setDone] = useState(!owns);
  // True once the native splash is actually down and this screen is what the
  // guest is looking at. The hold is measured from there, so a slow hide
  // shortens nothing: one second means one second of THIS screen.
  const [revealed, setRevealed] = useState(false);
  const reduceMotion = useReduceMotion();

  // Lazy state, not refs: these are read while rendering (they ARE the style),
  // and one Animated.Value per mount is exactly what a lazy initialiser gives.
  const [fade] = useState(() => new Animated.Value(1));
  const [bounce] = useState(() => new Animated.Value(0));
  const [spin] = useState(() => new Animated.Value(0));

  // Not the owner: the splash still has to come down, because nothing else
  // calls for it any more.
  useEffect(() => {
    if (!owns) void hideNativeSplash();
  }, [owns]);

  // The watchdog. If the splash never reports itself hidden — the promise is
  // native — the loading screen must not become the app's last frame.
  useEffect(() => {
    if (!owns) return;
    const w = setTimeout(() => {
      void hideNativeSplash();
      setRevealed(true);
    }, WATCHDOG_MS);
    return () => clearTimeout(w);
  }, [owns]);

  // The hold, then the fade.
  useEffect(() => {
    if (!revealed || done) return;
    const hold = setTimeout(
      () => {
        if (reduceMotion) {
          // Reduce Motion means no fade either: the cover goes, it does not
          // dissolve (LocaleProvider's switch cover does the same).
          fade.setValue(0);
          setDone(true);
          return;
        }
        Animated.timing(fade, {
          toValue: 0,
          duration: FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setDone(true);
        });
      },
      reduceMotion ? REDUCED_HOLD_MS : HOLD_MS,
    );
    return () => clearTimeout(hold);
    // `reduceMotion` can land mid-hold (the OS answers asynchronously); when it
    // does the hold restarts under the shorter timing, which is the right way
    // round — a guest who asked for less motion gets less of this screen.
  }, [revealed, done, reduceMotion, fade]);

  // The ball. Transforms on the wrapper only — the native driver cannot animate
  // svg props, and animating them would silently do nothing.
  useEffect(() => {
    if (!owns || done || reduceMotion) return;
    const hop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: RISE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: RISE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const roll = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    hop.start();
    roll.start();
    return () => {
      hop.stop();
      roll.stop();
      bounce.setValue(0);
      spin.setValue(0);
    };
  }, [owns, done, reduceMotion, bounce, spin]);

  if (done) return null;

  return (
    <Animated.View
      // The splash is only asked to hide once this has been laid out, and a
      // frame after that — a committed tree is not yet a painted one.
      onLayout={() => {
        requestAnimationFrame(() => {
          void hideNativeSplash().then(() => setRevealed(true));
        });
      }}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: brand.blue,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: fade,
        },
      ]}
    >
      {/* Light glyphs for the whole life of the cover, fade included: the
          theme's own bar style returns when this unmounts. */}
      <StatusBar style="light" animated />
      <LtrIsland>
        <Animated.View
          style={{
            transform: [
              {
                translateY: bounce.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -APEX],
                }),
              },
              {
                rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
              },
            ],
          }}
        >
          <SmileyBall size={BALL} />
        </Animated.View>
      </LtrIsland>
    </Animated.View>
  );
}
