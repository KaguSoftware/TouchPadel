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

const VBW = 320;
const VBH = 396;
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
      rackets: SWAY.map(([times, dxs, dys]) => ({
        dx: progress.interpolate({ inputRange: times, outputRange: dxs.map((d) => d * k) }),
        dy: progress.interpolate({ inputRange: times, outputRange: dys.map((d) => d * k) }),
      })),
    };
  }, [progress, k, ballSize, glowSize, shW, shH]);

  const still = reduceMotion;
  const ballRest = [
    { translateX: BX[0]! * k - ballSize / 2 },
    { translateY: BY[0]! * k - ballSize / 2 },
  ];

  // Overlay positions are PHYSICAL (`left`), like the translate transforms that
  // move them: a picture of a symmetric court has nothing to mirror, and a
  // logical `start` under RTL would launch the ball off the far edge.
  return (
    <View
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
            <Path d="M160 22v86M160 288v86" stroke={colors.crtLine} strokeWidth={1.4} opacity={0.7} />
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
                    { scale: 0.96 * k },
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
    </View>
  );
}

export const CourtIllustration = memo(CourtIllustrationImpl);
