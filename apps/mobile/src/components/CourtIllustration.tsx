/**
 * The animated padel court from the courts home screen (design 2026-08-31):
 * top-down court, four swaying rackets, a ball rallying corner to corner with
 * a ground shadow. Static Svg court + Animated.View overlays (transform/opacity
 * only, native driver). Under OS reduced-motion, everything holds still —
 * mirroring the design's `prefers-reduced-motion` block.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { brand, useTheme } from '../theme';

const VBW = 320;
const VBH = 396;

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

/** One racket: white or green face with string dots + a stub handle. */
function Racket({ green, rotate, up }: { green?: boolean; rotate: number; up?: boolean }) {
  const face = green ? brand.green : '#FFFFFF';
  const edge = green ? '#7FAE4C' : brand.green;
  const dots = green ? '#FFFFFF' : brand.green;
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

export function CourtIllustration() {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

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

  // Overlay elements are positioned at the origin and moved entirely by
  // transforms, so the native driver owns every frame.
  const ballSize = 10.4 * k * 1.5; // r 5.2, scaled like the design's 1.5x rackets feel
  const ballX = progress.interpolate({ inputRange: T, outputRange: BX.map((x) => x * k - ballSize / 2) });
  const ballY = progress.interpolate({ inputRange: T, outputRange: BY.map((y) => y * k - ballSize / 2) });
  const ballS = progress.interpolate({ inputRange: T, outputRange: BS });
  const shW = 24 * k;
  const shH = 11 * k;
  const shX = progress.interpolate({ inputRange: T, outputRange: BX.map((x) => x * k - shW / 2) });
  const shY = progress.interpolate({
    inputRange: T,
    outputRange: BY.map((y) => (y + 7.1) * k - shH / 2),
  });
  const shS = progress.interpolate({ inputRange: T, outputRange: SHS });
  const shO = progress.interpolate({ inputRange: T, outputRange: SHO });

  const rackets = [
    { x: 100, y: 88, rotate: -16, green: false, up: false },
    { x: 220, y: 88, rotate: 15, green: false, up: false },
    { x: 100, y: 308, rotate: 14, green: true, up: true },
    { x: 220, y: 308, rotate: -15, green: true, up: true },
  ];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ width: '100%', aspectRatio: VBW / VBH }}
    >
      {width > 0 ? (
        <>
          <Svg width={width} height={height} viewBox={`0 0 ${VBW} ${VBH}`}>
            {/* turf */}
            <Rect x={26} y={8} width={268} height={380} rx={5} fill={colors.crtTurf} />
            <Rect
              x={26}
              y={8}
              width={268}
              height={380}
              rx={5}
              fill="none"
              stroke={colors.crtTurfLine}
              strokeWidth={1}
              opacity={0.45}
            />
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
          {rackets.map((r, i) => {
            const sway = SWAY[i];
            if (!sway) return null;
            const [times, dxs, dys] = sway;
            const dx = reduceMotion
              ? 0
              : progress.interpolate({ inputRange: times, outputRange: dxs.map((d) => d * k) });
            const dy = reduceMotion
              ? 0
              : progress.interpolate({ inputRange: times, outputRange: dys.map((d) => d * k) });
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
                    { translateX: dx as never },
                    { translateY: dy as never },
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
              opacity: reduceMotion ? 0.3 : (shO as never),
              transform: reduceMotion
                ? [{ translateX: BX[0]! * k - shW / 2 }, { translateY: (BY[0]! + 7.1) * k - shH / 2 }]
                : [{ translateX: shX as never }, { translateY: shY as never }, { scale: shS as never }],
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
              backgroundColor: '#EAF7D2',
              borderWidth: Math.max(1.4 * k, 1),
              borderColor: brand.green,
              transform: reduceMotion
                ? [{ translateX: BX[0]! * k - ballSize / 2 }, { translateY: BY[0]! * k - ballSize / 2 }]
                : [{ translateX: ballX as never }, { translateY: ballY as never }, { scale: ballS as never }],
            }}
          />
        </>
      ) : null}
    </View>
  );
}
