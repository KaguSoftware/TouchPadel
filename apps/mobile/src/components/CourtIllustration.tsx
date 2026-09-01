/**
 * The animated padel court from the courts home screen (design 2026-08-31):
 * top-down court, four swaying rackets, a ball rallying corner to corner with
 * a ground shadow. Static Svg court lines over a native turf View (which owns
 * the design's two-layer floating drop-shadow) + Animated.View overlays
 * (transform/opacity only, native driver). Under OS reduced-motion, everything
 * holds still — mirroring the design's `prefers-reduced-motion` block.
 *
 * Court → booking transition (design 2026-09-01, `Court Transition
 * Prototype.html`): given a `progress` value p the whole court PITCHES like
 * the prototype's camera orbit — top-down → 50° tilt, 28° azimuth, ×1.3, lifted
 * and dimmed to 55 % — as one native perspective transform on the court layer
 * (spec.pitchAt). Three things that ride on top are split into their own
 * layers so the stacking matches the prototype:
 *   · the on-net button (`netOverlay`) sits between the court and the ball,
 *     so the rally flies OVER it;
 *   · the ball layer carries the same pitch transform (same Animated nodes);
 *   · the rackets stand up as the camera pitches — a billboard in screen
 *     space, positioned along a precomputed track of where their spot on the
 *     court lands (spec.projectPlanePoint), because RN flattens every view's
 *     3D transform on its own and a nested counter-rotation would only squash
 *     them twice. The near pair's handle also crossfades from "toward the net"
 *     to "down" so a standing racket is not upside down.
 *
 * Memoised: the parent used to re-render every minute (open-now clock) and
 * every interpolation node was rebuilt and re-attached to the native driver
 * each time — a visible hitch once a minute plus leaked animated nodes.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { brand, useTheme } from '../theme';
import { useReduceMotion } from '../lib/useReduceMotion';
import {
  COURT,
  PERSPECTIVE_PER_HEIGHT,
  SPEC,
  netFrame,
  pitchAt,
  pitchEase,
  projectPlanePoint,
  sampleCurve,
  sampleEased,
  type Dir,
} from '../features/courtTransition/spec';

const VBW = COURT.vbw;
const VBH = COURT.vbh;
// Turf rect in viewBox units (design: rect x26 y8 w268 h380 rx5).
const TURF = { x: 26, y: 8, w: 268, h: 380, r: 5 };

// Keyframes traced from the design's @keyframes tpball / tpshade (6.6s loop).
const T = [0, 0.09, 0.15, 0.21, 0.25, 0.34, 0.4, 0.46, 0.5, 0.59, 0.65, 0.71, 0.75, 0.84, 0.9, 0.96, 1];
const BX = [102.4, 102.4, 102.4, 102.4, 102.4, 165.8, 203.8, 217.6, 217.6, 217.6, 217.6, 217.6, 217.6, 154.2, 116.2, 102.4, 102.4];
const BY = [92, 208.6, 278.6, 304, 304, 187.4, 117.4, 92, 92, 208.6, 278.6, 304, 304, 187.4, 117.4, 92, 92];
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
/** The racket Svg box; scale happens about its centre. */
const RACKET_BOX = { w: 44, h: 58 };
/** Standing rackets rise as the camera pitches (prototype: 0.75 m → 1.55 m), in viewBox units. */
const RACKET_LIFT_UNITS = 14;
/** Height reserved for the on-net button; the slot is centred on the net tape. */
const NET_OVERLAY_H = 56;

/** One racket: white or green face with string dots + a stub handle. */
function Racket({ green, rotate, up }: { green?: boolean; rotate: number; up?: boolean }) {
  const face = green ? brand.green : brand.white;
  const edge = green ? brand.racketEdge : brand.green;
  const dots = green ? brand.white : brand.green;
  const dotOpacity = green ? 0.7 : 0.45;
  const dir = up ? -1 : 1;
  return (
    <Svg width={RACKET_BOX.w} height={RACKET_BOX.h} viewBox="-14 -22 28 44">
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

export interface CourtIllustrationProps {
  /** Cap so whatever sits below the court stays on screen on small phones. */
  maxHeight?: number;
  /** Court → booking progress p ∈ [0, 1]. Omit for the static top-down court. */
  progress?: Animated.Value;
  /** Direction of the running transition — selects the direction-aware PITCH tables. */
  direction?: Dir;
  /** Rendered ON the net, between the court and the ball (the "Check availability" button). */
  netOverlay?: ReactNode;
}

/** Decorative layers are invisible to assistive tech; the net overlay is not. */
const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

function CourtIllustrationImpl({ maxHeight, progress, direction = 1, netOverlay }: CourtIllustrationProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const reduceMotion = useReduceMotion();
  const rallyRef = useRef<Animated.Value | null>(null);
  if (rallyRef.current === null) rallyRef.current = new Animated.Value(0);
  const rally = rallyRef.current;

  useEffect(() => {
    if (reduceMotion) {
      rally.stopAnimation();
      rally.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rally, {
        toValue: 1,
        duration: 6600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rally, reduceMotion]);

  const k = width / VBW; // viewBox unit -> rendered px
  const height = width * (VBH / VBW);

  // Ball: design r 5.2 (unscaled — only the rackets carry scale(1.5)).
  const ballSize = 10.4 * k;
  const glowSize = 10 * k;
  const shW = 24 * k;
  const shH = 11 * k;

  // Every interpolation is built once per size, not once per render.
  const anim = useMemo(() => {
    const interp = (out: number[]) => rally.interpolate({ inputRange: T, outputRange: out });
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
      rackets: SWAY.map(([times, dxs, dys]) => ({
        dx: rally.interpolate({ inputRange: times, outputRange: dxs.map((d) => d * k) }),
        dy: rally.interpolate({ inputRange: times, outputRange: dys.map((d) => d * k) }),
      })),
    };
  }, [rally, k, ballSize, glowSize, shW, shH]);

  // ── Court → booking pitch: the prototype's camera orbit as one view transform ──
  // Tables, not `easing`: the native driver interpolates linearly per segment
  // and drops an easing function on the floor (see spec.sampleEased).
  const pitch = useMemo(() => {
    if (!progress || width === 0) return null;
    const ease = pitchEase(direction, 0);
    const perspective = PERSPECTIVE_PER_HEIGHT * height;
    const curve = (f: (p: number) => number) =>
      progress.interpolate({ ...sampleCurve(f), extrapolate: 'clamp' });
    const degrees = (f: (p: number) => number) => {
      const table = sampleCurve(f);
      return progress.interpolate({
        inputRange: table.inputRange,
        outputRange: table.outputRange.map((v) => `${v}deg`),
        extrapolate: 'clamp',
      });
    };
    const at = (p: number) => pitchAt(ease(p), k);
    // Array order (first = outermost): a pure screen-space lift, then the
    // projection of the tilted, spun, enlarged court. [perspective, rotateX,
    // rotateZ, scale] is the order Android decomposes losslessly into its own
    // rotationX / rotation / scale / cameraDistance.
    const transform = [
      { translateY: curve((p) => at(p).translateY) },
      { perspective },
      { rotateX: degrees((p) => at(p).tiltDeg) },
      { rotateZ: degrees((p) => at(p).azimuthDeg) },
      { scale: curve((p) => at(p).scale) },
    ];
    const dim = progress.interpolate({
      ...sampleEased(SPEC.court.dim, SPEC.court.opacity, undefined, 1),
      extrapolate: 'clamp',
    });
    const lines = progress.interpolate({
      ...sampleEased(SPEC.lines.range, SPEC.lines.opacity, undefined, 1),
      extrapolate: 'clamp',
    });
    // Rackets: where each one's spot on the court lands on screen, as a delta
    // from its flat position, plus the standing lift; and its apparent size.
    const rackets = RACKETS.map((r) => {
      const u = (r.x - VBW / 2) * k;
      const v = (r.y - VBH / 2) * k;
      const project = (p: number) => projectPlanePoint(u, v, ease(p), k, perspective);
      return {
        dx: curve((p) => project(p).x - u),
        dy: curve((p) => {
          const pt = project(p);
          return pt.y - v - ease(p) * RACKET_LIFT_UNITS * k * pt.s;
        }),
        scale: curve((p) => project(p).s * 0.96 * k),
        // Handle crossfade for the near pair: "toward the net" lying flat →
        // "down" once standing.
        lying: curve((p) => 1 - ease(p)),
        standing: curve((p) => ease(p)),
      };
    });
    return { transform, dim, lines, rackets };
  }, [progress, direction, width, height, k]);

  const still = reduceMotion;
  const ballRest = [
    { translateX: BX[0]! * k - ballSize / 2 },
    { translateY: BY[0]! * k - ballSize / 2 },
  ];
  const net = netFrame(k);

  // Overlay positions are PHYSICAL (`left`), like the translate transforms that
  // move them: a picture of a symmetric court has nothing to mirror, and a
  // logical `start` under RTL would launch the ball off the far edge.
  return (
    <View
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
          {/* Court layer: turf, lines, net, ground shadow — pitched and dimmed as one. */}
          <Animated.View
            {...hidden}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              pitch ? { transform: pitch.transform, opacity: pitch.dim } : null,
            ]}
          >
            {/* Turf as a native view: it owns the design's two-layer floating
                drop-shadow (`.tpfloat`), which SVG cannot cast. Symmetric in the
                viewBox, so a logical start is the same pixel in both directions. */}
            <View
              style={{
                position: 'absolute',
                start: TURF.x * k,
                top: TURF.y * k,
                width: TURF.w * k,
                height: TURF.h * k,
                borderRadius: TURF.r * k,
                backgroundColor: colors.crtTurf,
                borderWidth: 1,
                borderColor: colors.crtTurfLine,
                boxShadow: `0 ${14 * k} ${20 * k} ${colors.crtCast}, 0 ${4 * k} ${7 * k} ${colors.crtCast2}`,
              }}
            />
            {/* court lines (the white line material fades to 40 % as the camera pitches) */}
            <Animated.View style={[StyleSheet.absoluteFill, pitch ? { opacity: pitch.lines } : null]}>
              <Svg width={width} height={height} viewBox={`0 0 ${VBW} ${VBH}`}>
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
                <Path d="M160 22v86M160 288v86" stroke={colors.crtLine} strokeWidth={1.4} opacity={0.7} />
              </Svg>
            </Animated.View>
            {/* net (keeps its full strength) */}
            <View style={StyleSheet.absoluteFill}>
              <Svg width={width} height={height} viewBox={`0 0 ${VBW} ${VBH}`}>
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
            </View>
            {/* ball shadow — on the ground, so it pitches with the turf */}
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
          </Animated.View>

          {/* Rackets: a screen-space layer so they can stand up (see header). */}
          <Animated.View
            {...hidden}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, pitch ? { opacity: pitch.dim } : null]}
          >
            {RACKETS.map((r, i) => {
              const sway = anim.rackets[i];
              const track = pitch?.rackets[i];
              return (
                <Animated.View
                  key={i}
                  style={{
                    position: 'absolute',
                    // Scale happens about the 44x58 box's own center, so pin that
                    // center on the design's (x, y); 0.96*k matches the design's
                    // 1.5x on-court racket size (viewBox unit ratio 44px/28u).
                    top: r.y * k - RACKET_BOX.h / 2,
                    left: r.x * k - RACKET_BOX.w / 2,
                    transform: [
                      { translateX: track ? track.dx : 0 },
                      { translateY: track ? track.dy : 0 },
                      { translateX: still || !sway ? 0 : sway.dx },
                      { translateY: still || !sway ? 0 : sway.dy },
                      { scale: track ? track.scale : 0.96 * k },
                    ],
                  }}
                >
                  {track && r.up ? (
                    <>
                      <Animated.View style={{ opacity: track.lying }}>
                        <Racket green={r.green} rotate={r.rotate} up />
                      </Animated.View>
                      <Animated.View
                        style={{ position: 'absolute', top: 0, start: 0, opacity: track.standing }}
                      >
                        <Racket green={r.green} rotate={r.rotate} up={false} />
                      </Animated.View>
                    </>
                  ) : (
                    <Racket green={r.green} rotate={r.rotate} up={r.up} />
                  )}
                </Animated.View>
              );
            })}
          </Animated.View>

          {/* The on-net button: post to post, centred on the tape; symmetric, so a logical start holds. */}
          {netOverlay ? (
            <View
              style={{
                position: 'absolute',
                top: net.centerY - NET_OVERLAY_H / 2,
                start: net.left,
                width: net.width,
                height: NET_OVERLAY_H,
                justifyContent: 'center',
              }}
            >
              {netOverlay}
            </View>
          ) : null}

          {/* Ball layer: same pitch as the court, stacked ABOVE the button so the rally flies over it. */}
          <Animated.View
            {...hidden}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              pitch ? { transform: pitch.transform, opacity: pitch.dim } : null,
            ]}
          >
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
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

export const CourtIllustration = memo(CourtIllustrationImpl);
