/**
 * The animated padel court from the courts home screen (design 2026-08-31):
 * top-down court, four swaying rackets, a ball rallying corner to corner with
 * a ground shadow. Static Svg court lines over a native turf View (which owns
 * the design's two-layer floating drop-shadow) + Animated.View overlays
 * (transform/opacity only, native driver). Under OS reduced-motion, everything
 * holds still — mirroring the design's `prefers-reduced-motion` block.
 *
 * Memoised: the parent re-rendered every minute (open-now clock) and every
 * interpolation node was rebuilt and re-attached to the native driver each
 * time — a visible hitch once a minute plus leaked animated nodes.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { brand, useTheme } from '../theme';
import { LtrIsland } from '../i18n/direction';

const VBW = 320;
const VBH = 396;
// Turf rect in viewBox units (design: rect x26 y8 w268 h380 rx5).
const TURF = { x: 26, y: 8, w: 268, h: 380, r: 5 };

// Keyframes traced from the design's @keyframes tpball / tpshade (6.6s loop).
// The four contact frames are pinned to where each racket's HEAD actually is
// at the moment it strikes — the point on the circle the head sweeps about its
// grip — so the ball arrives on the strings. The design's own values put it
// 8.5–12.5 units off, passing near the racket without ever meeting it.
//
// The frames BETWEEN contacts are spaced along the straight line to the next
// racket by a decaying-speed profile: speed falls linearly from 1 to 0.62
// across a leg, position being its integral. The ball leaves the strings at
// its quickest and bleeds pace as it crosses, the way a struck ball does —
// the design's own spacing decelerated it to 35 % on arrival, crawling into
// each racket instead of being hit to it.
//
// The rally is untouched: same four contact points, same order (r0 → r2 →
// r1 → r3), same timing.
const T = [0, 0.09, 0.15, 0.21, 0.25, 0.34, 0.4, 0.46, 0.5, 0.59, 0.65, 0.71, 0.75, 0.84, 0.9, 0.96, 1];
const BX = [106.2, 100.4, 97, 94, 92.2, 142.7, 172.2, 198.4, 214.1, 219.6, 222.9, 225.8, 227.5, 177.3, 147.9, 121.8, 106.2];
const BY = [84.4, 178.3, 233.3, 282.1, 311.3, 217.3, 162.3, 113.4, 84.2, 178.2, 233.2, 282.1, 311.3, 217.4, 162.4, 113.6, 84.4];
const BS = [1, 1.3, 1.07, 1, 1, 1.4, 1.07, 1, 1, 1.3, 1.07, 1, 1, 1.4, 1.07, 1, 1];
const SHS = [1, 0.58, 0.92, 1, 1, 0.58, 0.92, 1, 1, 0.58, 0.92, 1, 1, 0.58, 0.92, 1, 1];
const SHO = [0.3, 0.12, 0.26, 0.3, 0.3, 0.12, 0.26, 0.3, 0.3, 0.12, 0.26, 0.3, 0.3, 0.12, 0.26, 0.3, 0.3];

// Racket sway loops (design tpp1..tpp4): per-racket [t, dx, dy] keyframes.
const SWAY: [number[], number[], number[]][] = [
  [[0, 0.08, 0.46, 0.75, 0.92, 1], [0, -3, 6, 2, -4, 0], [0, -2, 10, 4, -1, 0]],
  [[0, 0.25, 0.46, 0.62, 1], [2, 6, -2, 4, 2], [2, -4, -1, -8, 2]],
  [[0, 0.21, 0.5, 0.71, 1], [0, -6, -2, -4, 0], [0, 9, 3, -2, 0]],
  [[0, 0.17, 0.25, 0.58, 1], [-2, -8, -5, 3, -2], [0, -3, -1, 5, 0]],
];

const RACKETS = [
  { x: 100, y: 88, rotate: -16, green: false, up: false },
  { x: 220, y: 88, rotate: 15, green: false, up: false },
  { x: 100, y: 308, rotate: 14, green: true, up: true },
  { x: 220, y: 308, rotate: -15, green: true, up: true },
];

/**
 * When the ball reaches each racket, as a fraction of the 6.6 s loop — read off
 * the BX/BY keyframes above: the rally runs corner to corner, r0 (t 0) → r2
 * (0.25) → r1 (0.5) → r3 (0.75) → r0. RACKETS is indexed [r0, r1, r2, r3], so
 * the contact times are ordered to match that, not the rally order.
 */
const CONTACT = [0, 0.5, 0.25, 0.75];

/**
 * Distance from the racket art's centre to the BUTT OF THE GRIP, in the
 * viewBox's units — the handle path runs from the face edge at 5.2 out to 15,
 * so the hand is at 15. At 12 the pivot sat 3 units short of it and the grip
 * still drifted ~2 units through a swing: a residual see-saw.
 */
const PIVOT = 15;

/** How far either side of contact the stroke runs, and how far the head swings. */
/**
 * The stroke is a STRIKE, not a drift. The loop is 6.6 s, so a window of 0.11
 * either side of contact spanned 1.45 s — the racket wafting through 68° over
 * a second and a half, which is what read as broken. 0.032 puts the whole
 * stroke in ~0.42 s, and the wider arc makes it register at that speed.
 */
const SWING_SPAN = 0.032;
const SWING_DEG = 62;

/**
 * The stroke's own shape over window position w ∈ [−1, 1], with contact at
 * w = 0 — the three phases of a swing, as one continuous curve:
 *
 *   · w < 0   WIND-UP: rotates backward, away from the impact angle. Fully
 *             cocked around w = −0.34 — a short, quick anticipation.
 *   · w = 0   STRIKE: passes through zero, so the angle is exactly the aim.
 *             The curve is steepest here: peak angular speed on the ball.
 *   · w > 0   FOLLOW-THROUGH: carries on PAST the impact angle to the side,
 *             reaching full extension late (w ≈ 0.63) before easing to rest.
 *
 * It is monotonic between those two extremes, so the head sweeps once through
 * the ball and never doubles back — the bare sin(πw) hump this replaces
 * peaked at w = ±0.5 and returned the way it came, which read as the racket
 * bouncing off the ball rather than hitting through it.
 *
 * The exponents are what make the two halves asymmetric: raising |w| to a
 * power below 1 compresses the wind-up toward contact, above 1 stretches the
 * follow-through away from it, and both halves still reach 0 at w = ±1 so the
 * racket settles to its resting angle at the window edges.
 */
function stroke(w: number): number {
  const p = w < 0 ? 0.6 : 1.6;
  return Math.sign(w) * Math.sin(Math.PI * Math.abs(w) ** p);
}

/**
 * The swing each racket needs AT the instant of contact to meet the ball
 * perpendicular: the outgoing shot's screen angle (read off the BX/BY
 * keyframes — straight down-court for r0/r1, ±28.5° diagonals for r2/r3)
 * minus the racket's static mount `rotate`. Returning to 0 at contact, as the
 * old curve did, left the face sitting at that mount angle — 14–16° off the
 * ball's line at the exact moment it mattered.
 */
const AIM = [16, -15, 14.52, -13.52];

/**
 * The racket's swing angle over its stroke window, as sampled keyframes.
 *
 * The stroke has three phases over window position w ∈ [−1, 1]:
 *
 *   1. WIND-UP (w < 0) — the racket rotates BACKWARD, away from the impact
 *      angle, anticipating the hit. Fully cocked around w = −0.5.
 *   2. STRIKE (w = 0) — it snaps forward through exactly AIM, the outgoing
 *      shot's angle, so the face meets the ball square. This is the one
 *      instant that must be exact, and it is where the curve is steepest:
 *      peak angular speed lands on the ball, which is what reads as a hit
 *      rather than a waft.
 *   3. FOLLOW-THROUGH (w > 0) — it carries on PAST the impact angle to the
 *      side, finishing the arc around w = +0.5 before easing back to rest.
 *
 *   angle(w) = AIM·cos(πw/2)  +  sweep·SWING_DEG·sin(πw)·(1 − |w|)
 *
 * · The cos term is the aim carrier: exactly AIM at contact and 0 at both
 *   window edges, so the racket rests at its mount angle between strokes.
 * · The sin term is the stroke. Tapering it by (1 − |w|) is what makes the
 *   sweep MONOTONIC through the strike: the bare sin hump peaked at w = ±0.5
 *   and then doubled back the way it came, so the head rebounded off the ball
 *   instead of following through. The taper moves each extreme outward and
 *   flattens the return into an ease-back.
 *
 * Both terms are 0 at w = ±1, so the ends settle to rest — the easing lives
 * in the keyframe SHAPE. The master clock must stay Easing.linear: it is a
 * shared timeline driving every keyframed property, and any curve on the
 * clock itself would warp the ball too. The native driver's interpolate() is
 * piecewise-linear between keyframes, so the curve is sampled rather than
 * described analytically.
 *
 * A contact at t = 0 (racket 0) straddles the loop: its wind-up lands at the
 * tail of the range and its follow-through at the head, and the seam is
 * padded with the contact value so t = 1 continues the stroke into t = 0.
 */
function swingFrames(
  contact: number,
  aim: number,
  sweep: 1 | -1,
): { input: number[]; output: number[] } {
  const N = 16;
  const pts: [number, number][] = [];
  for (let j = 0; j <= N; j++) {
    const w = (j / N) * 2 - 1;
    const deg = aim * Math.cos((Math.PI / 2) * w) + sweep * SWING_DEG * stroke(w);
    pts.push([(contact + w * SWING_SPAN + 1) % 1, deg]);
  }
  return wrapStroke(pts);
}

/**
 * Sampled stroke keyframes → a valid interpolate() range: sorted ascending,
 * padded to rest (0) outside the window, and periodic across the loop seam —
 * a stroke straddling t = 0 keeps its t = 0 value at t = 1 so the wind-up in
 * the tail of the loop flows into the contact at its head.
 */
function wrapStroke(pts: [number, number][]): { input: number[]; output: number[] } {
  pts.sort((a, b) => a[0] - b[0]);
  const input: number[] = [];
  const output: number[] = [];
  if (pts[0]![0] > 0) {
    input.push(0);
    output.push(0); // the window is clear of the seam: at rest there
  }
  for (const [x, v] of pts) {
    if (input.length && x <= input[input.length - 1]!) continue;
    input.push(x);
    output.push(v);
  }
  if (input[input.length - 1]! < 1) {
    input.push(1);
    output.push(output[0]!); // periodic: t = 1 must equal t = 0
  }
  return { input, output };
}

/**
 * Where racket `i`'s head sits relative to its box centre at the moment of
 * contact, in design units — the head's own point on the circle it sweeps.
 *
 * The art is drawn with the head at (0, −3·dir) and rotated twice: by the
 * static `rotate` mount inside the <G>, about the box centre; then by the
 * swing, about the grip at (0, 15·dir). U converts the viewBox's units to
 * design units (28 units → 44 px, then the 0.96 box scale).
 */
function headOffset(i: number): { x: number; y: number } {
  const U = (44 / 28) * 0.96;
  const dir = RACKETS[i]!.up ? -1 : 1;
  const spin = (p: [number, number], a: number, about: [number, number]): [number, number] => {
    const x = p[0] - about[0];
    const y = p[1] - about[1];
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    return [about[0] + x * cs - y * sn, about[1] + x * sn + y * cs];
  };
  const mounted = spin([0, -3 * dir], (RACKETS[i]!.rotate * Math.PI) / 180, [0, 0]);
  const swung = spin(mounted, (AIM[i]! * Math.PI) / 180, [0, 15 * dir]);
  return { x: swung[0] * U, y: swung[1] * U };
}

/** Piecewise-linear value of a keyframe track (times, values) at loop position t. */
function keyframeAt(times: number[], values: number[], t: number): number {
  let i = 0;
  while (i < times.length - 2 && times[i + 1]! < t) i++;
  const f = (t - times[i]!) / (times[i + 1]! - times[i]!);
  return values[i]! + (values[i + 1]! - values[i]!) * f;
}

/**
 * The racket's step to the interception point — the missing translation that
 * left the face up to 14.5 units from the ball at its own contact (the sway
 * loop drifts the racket without ever looking at the ball).
 *
 * The target is where the ball IS at this racket's contact instant, minus the
 * racket's rest position and minus what the sway contributes right then — so
 * sway + reach lands the face exactly on the ball, and outside the window the
 * reach is zero and the sway loop carries on untouched.
 *
 * The racket gets there EARLY and waits: the step reaches full extension by
 * the middle of the wind-up and holds through contact, so the face is planted
 * in front of the oncoming ball rather than arriving at the same instant it
 * does. A symmetric raised cosine peaking only at contact had the racket and
 * the ball converging together, which read as the ball meeting a racket still
 * on its way. Both ends still leave at zero with ZERO SLOPE, so it is a step
 * out and an ease back, never a snap.
 */
function reachFrames(i: number): { input: number[]; dx: number[]; dy: number[] } {
  const c = CONTACT[i]!;
  const r = RACKETS[i]!;
  const [times, dxs, dys] = SWAY[i]!;
  // Aim the HEAD at the ball, not the box centre. The head sits 7–8.5 units
  // off centre once the mount and swing rotations are applied, so targeting
  // the centre left the strings that far from the ball — the racket and the
  // ball chasing each other and never meeting.
  const head = headOffset(i);
  const tx = keyframeAt(T, BX, c) - r.x - keyframeAt(times, dxs, c) - head.x;
  const ty = keyframeAt(T, BY, c) - r.y - keyframeAt(times, dys, c) - head.y;
  const N = 16;
  const ptsX: [number, number][] = [];
  const ptsY: [number, number][] = [];
  for (let j = 0; j <= N; j++) {
    const w = (j / N) * 2 - 1;
    // Rises over the wind-up (w −1 → −0.5), holds at full extension from
    // there through contact and the early follow-through (−0.5 → +0.4), then
    // eases back out. Each ramp is a raised cosine, so the joins at the hold
    // are flat and the window edges leave at zero slope.
    const e =
      w < -0.5
        ? (1 - Math.cos(Math.PI * ((w + 1) / 0.5))) / 2
        : w > 0.4
          ? (1 + Math.cos(Math.PI * ((w - 0.4) / 0.6))) / 2
          : 1;
    const t = (c + w * SWING_SPAN + 1) % 1;
    ptsX.push([t, tx * e]);
    ptsY.push([t, ty * e]);
  }
  const wx = wrapStroke(ptsX);
  const wy = wrapStroke(ptsY);
  return { input: wx.input, dx: wx.output, dy: wy.output };
}

/** One racket: white or green face with string dots + a stub handle. */
function Racket({ green, rotate, up }: { green?: boolean; rotate: number; up?: boolean }) {
  const face = green ? brand.green : brand.white;
  const edge = green ? brand.racketEdge : brand.green;
  const dots = green ? brand.white : brand.green;
  const dotOpacity = green ? 0.7 : 0.45;
  const dir = up ? -1 : 1;
  return (
    <Svg width={44} height={58} viewBox="-14 -22 28 44">
      <G rotation={rotate}>
        <Ellipse cx={0} cy={-3 * dir} rx={7.2} ry={8.4} fill={face} stroke={edge} strokeWidth={1.6} />
        <Circle cx={-2.7} cy={-5.4 * dir} r={0.9} fill={dots} opacity={dotOpacity} />
        <Circle cx={2.7} cy={-5.4 * dir} r={0.9} fill={dots} opacity={dotOpacity} />
        <Circle cx={0} cy={-2.4 * dir} r={0.9} fill={dots} opacity={dotOpacity} />
        <Circle cx={-2.7} cy={0.6 * dir} r={0.9} fill={dots} opacity={dotOpacity} />
        <Circle cx={2.7} cy={0.6 * dir} r={0.9} fill={dots} opacity={dotOpacity} />
        <Path
          d={up ? 'M0 -5.2V-15' : 'M0 5.2V15'}
          stroke={brand.green}
          strokeWidth={3.2}
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
}

function CourtIllustrationImpl({ maxHeight }: { maxHeight?: number }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progressRef = useRef<Animated.Value | null>(null);
  if (progressRef.current === null) progressRef.current = new Animated.Value(0);
  const progress = progressRef.current;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 6600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduceMotion]);

  const k = width / VBW; // viewBox unit -> rendered px
  const height = width * (VBH / VBW);

  // Ball: design r 5.2 (unscaled — only the rackets carry scale(1.5)).
  const ballSize = 10.4 * k;
  const glowSize = 10 * k;
  const shW = 24 * k;
  const shH = 11 * k;

  // Every interpolation is built once per size, not once per render.
  const anim = useMemo(() => {
    const interp = (out: number[]) => progress.interpolate({ inputRange: T, outputRange: out });
    return {
      ballX: interp(BX.map((x) => x * k - ballSize / 2)),
      ballY: interp(BY.map((y) => y * k - ballSize / 2)),
      ballS: interp(BS),
      glowX: interp(BX.map((x) => x * k - glowSize / 2)),
      glowY: interp(BY.map((y) => y * k - glowSize / 2)),
      shX: interp(BX.map((x) => x * k - shW / 2)),
      shY: interp(BY.map((y) => (y + 7.1) * k - shH / 2)),
      shS: interp(SHS),
      shO: interp(SHO),
      rackets: SWAY.map(([times, dxs, dys], i) => {
        const sw = swingFrames(CONTACT[i]!, AIM[i]!, RACKETS[i]!.up ? -1 : 1);
        const rf = reachFrames(i);
        return {
          dx: progress.interpolate({ inputRange: times, outputRange: dxs.map((d) => d * k) }),
          dy: progress.interpolate({ inputRange: times, outputRange: dys.map((d) => d * k) }),
          reachX: progress.interpolate({ inputRange: rf.input, outputRange: rf.dx.map((d) => d * k) }),
          reachY: progress.interpolate({ inputRange: rf.input, outputRange: rf.dy.map((d) => d * k) }),
          // Degrees, as a string transform: the racket swings through the ball
          // instead of holding one angle and drifting. The sweep sign and the
          // aim are both baked into the frames — no flip here, the aim is
          // absolute geometry and flipping it would un-square the face.
          swing: progress.interpolate({
            inputRange: sw.input,
            outputRange: sw.output.map((d) => `${d}deg`),
          }),
        };
      }),
    };
  }, [progress, k, ballSize, glowSize, shW, shH]);

  const still = reduceMotion;
  const ballRest = [
    { translateX: BX[0]! * k - ballSize / 2 },
    { translateY: BY[0]! * k - ballSize / 2 },
  ];

  // Overlay positions are PHYSICAL (`left`), like the translate transforms that
  // move them: a picture of a symmetric court has nothing to mirror, and a
  // logical `start` under RTL would launch the ball off the far edge. The root
  // is an LtrIsland so they stay physical whatever the language (the only
  // file where physical props pass lint — eslint.config.mjs).
  return (
    <LtrIsland
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        width: '100%',
        // Cap so the CTA below stays on screen on small phones.
        maxWidth: maxHeight ? maxHeight * (VBW / VBH) : undefined,
        alignSelf: 'center',
        aspectRatio: VBW / VBH,
      }}
    >
      {width > 0 ? (
        <>
          {/* Turf as a native view: it owns the design's two-layer floating
              drop-shadow (`.tpfloat`), which SVG cannot cast. */}
          <View
            style={{
              position: 'absolute',
              left: TURF.x * k,
              top: TURF.y * k,
              width: TURF.w * k,
              height: TURF.h * k,
              borderRadius: TURF.r * k,
              backgroundColor: colors.crtTurf,
              borderWidth: 1,
              borderColor: colors.crtTurfLine,
              boxShadow: `0 ${14 * k}px ${20 * k}px ${colors.crtCast}, 0 ${4 * k}px ${7 * k}px ${colors.crtCast2}`,
            }}
          />
          <Svg width={width} height={height} viewBox={`0 0 ${VBW} ${VBH}`}>
            {/* court lines */}
            <Rect
              x={40}
              y={22}
              width={240}
              height={352}
              fill="none"
              stroke={colors.crtLine}
              strokeWidth={1.6}
              opacity={0.9}
            />
            <Path d="M40 108h240M40 288h240" stroke={colors.crtLine} strokeWidth={1.4} opacity={0.7} />
            {/* Centre service line: each service line (y 108 / 288) to the net
                (y 198), splitting the service boxes. It ran from the service
                lines to the BACK walls, dividing the strips behind them. */}
            <Path d="M160 108v90M160 198v90" stroke={colors.crtLine} strokeWidth={1.4} opacity={0.7} />
            {/* net */}
            <Path d="M20 198h280" stroke={brand.green} strokeWidth={2.6} opacity={0.95} />
            <Path
              d="M20 198h280"
              stroke={colors.crtLine}
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.8}
            />
            <Circle cx={20} cy={198} r={2.8} fill={colors.crtLine} />
            <Circle cx={300} cy={198} r={2.8} fill={colors.crtLine} />
          </Svg>

          {/* rackets */}
          {RACKETS.map((r, i) => {
            const sway = anim.rackets[i];
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  // Scale happens about the 44x58 box's own center, so pin that
                  // center on the design's (x, y); 0.96*k matches the design's
                  // 1.5x on-court racket size (viewBox unit ratio 44px/28u).
                  top: r.y * k - 29,
                  left: r.x * k - 22,
                  transform: [
                    { translateX: still || !sway ? 0 : sway.dx },
                    { translateY: still || !sway ? 0 : sway.dy },
                    // The step to the interception point: composes with the
                    // sway so the face is exactly on the ball at contact.
                    { translateX: still || !sway ? 0 : sway.reachX },
                    { translateY: still || !sway ? 0 : sway.reachY },
                    { scale: 0.96 * k },
                    // Swing about the GRIP, not the box's centre. Rotating on
                    // the centre pivots the racket about its middle, so the
                    // head and the handle see-saw in opposite directions; these
                    // three steps move the origin to the handle end, turn, and
                    // move back. PIVOT is +y for a racket whose handle points
                    // down (up: false) and −y for one pointing up.
                    { translateY: r.up ? -PIVOT : PIVOT },
                    { rotate: still || !sway ? '0deg' : sway.swing },
                    { translateY: r.up ? PIVOT : -PIVOT },
                  ],
                }}
              >
                <Racket green={r.green} rotate={r.rotate} up={r.up} />
              </Animated.View>
            );
          })}

          {/* ball shadow */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: shW,
              height: shH,
              borderRadius: shH / 2,
              backgroundColor: colors.crtShadow,
              opacity: still ? 0.3 : anim.shO,
              transform: still
                ? [{ translateX: BX[0]! * k - shW / 2 }, { translateY: (BY[0]! + 7.1) * k - shH / 2 }]
                : [{ translateX: anim.shX }, { translateY: anim.shY }, { scale: anim.shS }],
            }}
          />
          {/* ball glow (design: r5 #EAF7D2 @ .28 behind the ball) */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              backgroundColor: brand.ballFill,
              opacity: 0.28,
              transform: still
                ? [{ translateX: BX[0]! * k - glowSize / 2 }, { translateY: BY[0]! * k - glowSize / 2 }]
                : [{ translateX: anim.glowX }, { translateY: anim.glowY }, { scale: 1.6 }],
            }}
          />
          {/* ball */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: ballSize,
              height: ballSize,
              borderRadius: ballSize / 2,
              backgroundColor: brand.ballFill,
              borderWidth: Math.max(1.4 * k, 1),
              borderColor: brand.green,
              transform: still
                ? ballRest
                : [{ translateX: anim.ballX }, { translateY: anim.ballY }, { scale: anim.ballS }],
            }}
          />
        </>
      ) : null}
    </LtrIsland>
  );
}

export const CourtIllustration = memo(CourtIllustrationImpl);
