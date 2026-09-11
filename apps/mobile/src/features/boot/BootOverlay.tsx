/**
 * The app's loading screen — one second of brand blue in which the logo
 * serves, between the native splash and the first real frame.
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
 * THE SERVE (owner, 2026-09-11: "something creative with the logo, something
 * to remember"). The first frame is the splash's own lockup — the same
 * vector artwork as logo-white.png, at the splash's width, in white on the
 * splash's blue — so the handoff is a no-op. Then the brand's own joke is
 * played out: the "o" of Touch IS a tennis ball (the PDF drew it as one), and
 * it pops up out of the word, leaving "T uch" behind, grows toward the viewer
 * and spins once, turns brand green in the air, drops back into its slot,
 * squashes on landing — the word takes a two-point jolt and a thin green ring
 * ripples out of the impact — and comes to rest as the colour lockup. At the
 * hold's end the whole mark lifts a few points and fades into the app. Both
 * ends are still frames (the splash's lockup, then the colour lockup), which
 * is what keeps both handoffs seamless.
 *
 * Every value is a transform or an opacity on a plain view, native-driven:
 * nothing animates an svg prop, because the native driver cannot and the JS
 * thread at boot is the busiest one in the app's life.
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
import { LogoBall, LogoWordmark } from '../../components/LogoMark';
import { logoFrame } from '../courtTransition/logoPaths';
import { claimBootOverlay } from './launchOnce';
import { hideNativeSplash } from './splash';

/** Visible hold once the splash is actually gone, and the fade that ends it. */
const HOLD_MS = 1000;
const REDUCED_HOLD_MS = 600;
const FADE_MS = 260;
/** If the splash never reports itself hidden, hold no longer than this. */
const WATCHDOG_MS = 1500;

/**
 * The lockup's width, in points — and it MUST equal the native splash's
 * `imageWidth` in app.config.ts (220), as `brand.blue` must equal its
 * `backgroundColor`, because this screen's first frame is the splash's last
 * one. bootOverlay.test.ts holds the two files to each other.
 */
const LOGO_W = 220;
const FRAME = logoFrame(LOGO_W);

/**
 * A still beat before anything moves: the iOS splash cross-fades out over
 * 180 ms (app/_layout.tsx) and `hideNativeSplash` is not documented to resolve
 * after it, so the first motion waits until the frame under it is certainly
 * this one.
 */
const LEAD_MS = 140;
/** How high the ball serves, as ball diameters. A serve, not a hop. */
const APEX = FRAME.ball.diameter * 2.2;
const RISE_MS = 300;
const DROP_MS = 240;
/** Toward the viewer at the top of the serve. */
const APEX_SCALE = 1.6;
/** The colour change, in the air, once the ball is well clear of the word. */
const GREEN_AT_MS = 180;
const GREEN_MS = 160;
/** The landing: flattened for a few frames, then sprung back round. */
const SQUASH_MS = 60;
const SQUASH_X = 1.22;
const SQUASH_Y = 0.78;
/** The word takes the impact: down two points and sprung back. */
const BUMP_PT = 2;
/** The ring that leaves the impact point. */
const RIPPLE_MS = 480;
const RIPPLE_SCALE = 4.2;
/** The whole mark lifts this far as it fades into the app. */
const LIFT_PT = 10;

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
  const [lift] = useState(() => new Animated.Value(0));
  const [ballY] = useState(() => new Animated.Value(0));
  const [ballScale] = useState(() => new Animated.Value(1));
  const [spin] = useState(() => new Animated.Value(0));
  const [green] = useState(() => new Animated.Value(0));
  const [squashX] = useState(() => new Animated.Value(1));
  const [squashY] = useState(() => new Animated.Value(1));
  const [bump] = useState(() => new Animated.Value(0));
  const [ripple] = useState(() => new Animated.Value(0));

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

  // The hold, then the fade — and the lift, in step with it.
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
        Animated.parallel([
          Animated.timing(fade, {
            toValue: 0,
            duration: FADE_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(lift, {
            toValue: 1,
            duration: FADE_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished) setDone(true);
        });
      },
      reduceMotion ? REDUCED_HOLD_MS : HOLD_MS,
    );
    return () => clearTimeout(hold);
    // `reduceMotion` can land mid-hold (the OS answers asynchronously); when it
    // does the hold restarts under the shorter timing, which is the right way
    // round — a guest who asked for less motion gets less of this screen.
  }, [revealed, done, reduceMotion, fade, lift]);

  // The serve. Starts on `revealed`, not on mount: until the native splash is
  // down the guest is looking at the OS's copy of this frame, and motion under
  // it would be a jump at the handoff. Reduce Motion keeps the still lockup.
  useEffect(() => {
    if (!owns || !revealed || done || reduceMotion) return;
    const timing = (
      value: Animated.Value,
      toValue: number,
      duration: number,
      easing: (t: number) => number,
    ) => Animated.timing(value, { toValue, duration, easing, useNativeDriver: true });
    const spring = (value: Animated.Value, toValue: number, friction: number, tension: number) =>
      Animated.spring(value, { toValue, friction, tension, useNativeDriver: true });

    const flight = Animated.parallel([
      Animated.sequence([
        timing(ballY, -APEX, RISE_MS, Easing.out(Easing.cubic)),
        timing(ballY, 0, DROP_MS, Easing.in(Easing.quad)),
      ]),
      Animated.sequence([
        timing(ballScale, APEX_SCALE, RISE_MS, Easing.out(Easing.quad)),
        timing(ballScale, 1, DROP_MS, Easing.in(Easing.quad)),
      ]),
      // One full turn over the whole flight, so the ball lands the way up it
      // left and the squash below flattens it along the ground.
      timing(spin, 1, RISE_MS + DROP_MS, Easing.linear),
      Animated.sequence([Animated.delay(GREEN_AT_MS), timing(green, 1, GREEN_MS, Easing.linear)]),
    ]);
    const impact = Animated.parallel([
      Animated.sequence([
        Animated.parallel([
          timing(squashX, SQUASH_X, SQUASH_MS, Easing.out(Easing.quad)),
          timing(squashY, SQUASH_Y, SQUASH_MS, Easing.out(Easing.quad)),
        ]),
        Animated.parallel([spring(squashX, 1, 4, 180), spring(squashY, 1, 4, 180)]),
      ]),
      Animated.sequence([
        timing(bump, 1, SQUASH_MS, Easing.out(Easing.quad)),
        spring(bump, 0, 5, 160),
      ]),
      timing(ripple, 1, RIPPLE_MS, Easing.out(Easing.cubic)),
    ]);
    const serve = Animated.sequence([Animated.delay(LEAD_MS), flight, impact]);
    serve.start();
    return () => {
      // Interrupted (Reduce Motion landing mid-serve, or the cover going):
      // back to the still lockup rather than a ball left mid-air.
      serve.stop();
      for (const v of [ballY, spin, green, ripple, bump]) v.setValue(0);
      for (const v of [ballScale, squashX, squashY]) v.setValue(1);
    };
  }, [
    owns,
    revealed,
    done,
    reduceMotion,
    ballY,
    ballScale,
    spin,
    green,
    squashX,
    squashY,
    bump,
    ripple,
  ]);

  if (done) return null;

  const { ball } = FRAME;
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
        {/* The lockup's box, exactly the wordmark's size, so the ball's absolute
            offsets (in the island's LTR space — `start`, never `left`, per
            i18n/direction) land it on the "o" the word is missing. */}
        <Animated.View
          style={{
            width: LOGO_W,
            height: FRAME.height,
            transform: [
              {
                translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT_PT] }),
              },
            ],
          }}
        >
          <Animated.View
            style={{
              transform: [
                {
                  translateY: bump.interpolate({ inputRange: [0, 1], outputRange: [0, BUMP_PT] }),
                },
              ],
            }}
          >
            <LogoWordmark width={LOGO_W} color={brand.white} />
          </Animated.View>
          {/* The ripple: a ring the ball's size, UNDER the ball, that grows and
              thins away from the impact. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              start: ball.start,
              top: ball.top,
              width: ball.size,
              height: ball.size,
              borderRadius: ball.size / 2,
              borderWidth: 1.5,
              borderColor: brand.green,
              opacity: ripple.interpolate({
                inputRange: [0, 0.02, 1],
                outputRange: [0, 0.85, 0],
              }),
              transform: [
                {
                  scale: ripple.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, RIPPLE_SCALE],
                  }),
                },
              ],
            }}
          />
          {/* The ball: two svgs, white and colour, cross-faded by `green` inside
              one transformed wrapper, so the flight is drawn once. Order
              matters: the flight's translate and grow, then the spin, then the
              landing squash — which at touchdown, the spin having completed a
              turn, flattens along the ground. */}
          <Animated.View
            style={{
              position: 'absolute',
              start: ball.start,
              top: ball.top,
              width: ball.size,
              height: ball.size,
              transform: [
                { translateY: ballY },
                { scale: ballScale },
                {
                  rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
                },
                { scaleX: squashX },
                { scaleY: squashY },
              ],
            }}
          >
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { opacity: green.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
              ]}
            >
              <LogoBall size={ball.size} variant="white" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: green }]}>
              <LogoBall size={ball.size} variant="colour" />
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </LtrIsland>
    </Animated.View>
  );
}
