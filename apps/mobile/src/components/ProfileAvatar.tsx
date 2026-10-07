import { useState } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, frame as metal, radius, useTheme } from '../theme';
import { useAvatarUrl } from '../features/profile/hooks';
import {
  badgeCentre,
  DEFAULT_FRAME,
  frameDrawing,
  type ColorName,
  type FrameId,
  type FrameStyle,
  type Paint,
} from '../features/profile/frames';

/**
 * The guest's round avatar (0302): their photo when they set one, otherwise
 * their initials on Touch Blue. Since 0314 the ring around it is the guest's
 * photo frame (`features/profile/frames.ts`), drawn in an svg layer on top so a
 * badge can sit across the ring; the outer size never changes, so no layout
 * around an avatar moves. The photo arrives through a signed URL; while it
 * loads, or if it fails, the initials show, so the circle is never empty.
 *
 * The ring art never mirrors in Arabic; only an earned frame's badge follows
 * the reading direction (bottom end corner). `frameStyle` (0317) draws a free
 * frame as court lines.
 */
export function ProfileAvatar({
  path,
  initials,
  size,
  frame = DEFAULT_FRAME,
  frameStyle = 'solid',
}: {
  path: string | null | undefined;
  initials: string;
  size: number;
  frame?: FrameId;
  frameStyle?: FrameStyle;
}) {
  const { fonts, colors } = useTheme();
  const { dir } = useLocale();
  const url = useAvatarUrl(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!url.data && url.data !== failedUrl;
  const drawing = frameDrawing(frame, size, frameStyle);
  const inner = size - drawing.inset * 2;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          top: drawing.inset,
          start: drawing.inset,
          width: inner,
          height: inner,
          borderRadius: radius.pill,
          backgroundColor: brand.blue,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {showPhoto ? (
          <Image
            source={{ uri: url.data }}
            onError={() => setFailedUrl(url.data ?? null)}
            style={{ width: inner, height: inner }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: Math.round(size * 0.35),
              lineHeight: Math.round(size * 0.4),
              textAlign: 'center',
              includeFontPadding: false,
              color: brand.white,
            }}
          >
            {initials}
          </Text>
        )}
      </View>
      <FrameLayer frame={frame} frameStyle={frameStyle} size={size} rtl={dir === 'rtl'} rim={colors.card} />
    </View>
  );
}

const COLOR: Record<ColorName, string> = {
  green: brand.green,
  blue: brand.blue,
  navy: brand.navy,
  white: brand.white,
};

function paintOf(p: Paint, id: string): string {
  return p.kind === 'solid' ? COLOR[p.color] : `url(#${id}-${p.metal})`;
}

/** The rings and badge of one frame, over the photo. Pointer events pass through. */
function FrameLayer({
  frame,
  frameStyle,
  size,
  rtl,
  rim,
}: {
  frame: FrameId;
  frameStyle: FrameStyle;
  size: number;
  rtl: boolean;
  rim: string;
}) {
  const d = frameDrawing(frame, size, frameStyle);
  const id = `f${frame}${frameStyle}${size}`;
  const c = size / 2;
  const rings = d.rings.map((ring, i) => {
    // The ring's centre line: inside every ring drawn before it.
    const mid = c - d.rings.slice(0, i).reduce((sum, x) => sum + x.width, 0) - ring.width / 2;
    const stroke = paintOf(ring.paint, id);
    if (ring.dashes) {
      const n = ring.dashes;
      const seg = (2 * Math.PI * mid) / n;
      // The clip sits on a wrapping group, not on the rotated circle: a clip on
      // the circle would turn with it and split the halves off the horizontal.
      const dashed = (color: string, clip?: string) => (
        <G clipPath={clip ? `url(#${clip})` : undefined}>
          <Circle
            cx={c}
            cy={c}
            r={mid}
            fill="none"
            stroke={color}
            strokeWidth={ring.width}
            strokeDasharray={`${seg * 0.62} ${seg * 0.38}`}
            // One dash centred at the top.
            transform={`rotate(${-90 - (360 / n) * 0.31} ${c} ${c})`}
          />
        </G>
      );
      if (!ring.bottom) return <G key={i}>{dashed(stroke)}</G>;
      // Half and half as court lines: the same dashes, each half in its colour.
      return (
        <G key={i}>
          {dashed(stroke, `${id}-top`)}
          {dashed(COLOR[ring.bottom], `${id}-bottom`)}
        </G>
      );
    }
    if (ring.bottom) {
      // Half and half: top half `paint`, bottom half `bottom`, split on the horizontal.
      const half = (sweepTop: boolean) =>
        `M ${c - mid} ${c} A ${mid} ${mid} 0 0 ${sweepTop ? 1 : 0} ${c + mid} ${c}`;
      return (
        <G key={i}>
          <Path d={half(true)} fill="none" stroke={stroke} strokeWidth={ring.width} />
          <Path d={half(false)} fill="none" stroke={COLOR[ring.bottom]} strokeWidth={ring.width} />
        </G>
      );
    }
    return <Circle key={i} cx={c} cy={c} r={mid} fill="none" stroke={stroke} strokeWidth={ring.width} />;
  });

  let badge = null;
  if (d.badge) {
    const B = d.badge.size;
    const { x, y } = badgeCentre(size, d.inset, B, rtl);
    const s = (B - 3) / 24;
    badge = (
      <G>
        <Circle cx={x} cy={y} r={B / 2 - 0.75} fill={paintOf(d.badge.fill, id)} stroke={rim} strokeWidth={1.5} />
        <G transform={`translate(${x - (B - 3) / 2} ${y - (B - 3) / 2}) scale(${s})`}>
          {d.badge.glyph === 'trophy' ? (
            <Trophy color={metal.gold} />
          ) : (
            <Racket color={COLOR[d.badge.ink]} clipId={`${id}-face`} />
          )}
        </G>
      </G>
    );
  }

  return (
    <Svg width={size} height={size} style={{ position: 'absolute', top: 0, start: 0 }} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={metal.goldHi} />
          <Stop offset="0.5" stopColor={metal.gold} />
          <Stop offset="1" stopColor={metal.goldLo} />
        </LinearGradient>
        <LinearGradient id={`${id}-silver`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={metal.silverHi} />
          <Stop offset="0.5" stopColor={metal.silver} />
          <Stop offset="1" stopColor={metal.silverLo} />
        </LinearGradient>
        <ClipPath id={`${id}-top`}>
          <Rect x={0} y={0} width={size} height={c} />
        </ClipPath>
        <ClipPath id={`${id}-bottom`}>
          <Rect x={0} y={c} width={size} height={c} />
        </ClipPath>
      </Defs>
      {rings}
      {badge}
    </Svg>
  );
}

/**
 * The court's racket (packages/court3d/src/racket.ts), flattened: its outline
 * in that file's model units as centimetres, svg y down, the butt cap at 0 and
 * the crown at -45. The frame is one even-odd path: the outer teardrop with
 * the face opening and the throat window cut out of it.
 */
const RACKET_OUTER =
  'M12.216 -27.554 A13 13 0 1 0 -12.216 -27.554 C-9.8 -20.5 -1.8 -16.5 -1.8 -12.5 ' +
  'L-1.8 -10.8 L1.8 -10.8 L1.8 -12.5 C1.8 -16.5 9.8 -20.5 12.216 -27.554 Z';
const RACKET_FACE =
  'M10.513 -27.098 A11.6 11.6 0 1 0 -10.513 -27.098 C-8.513 -22.598 -5 -20.4 0 -20.4 ' +
  'C5 -20.4 8.513 -22.598 10.513 -27.098 Z';
const RACKET_THROAT = 'M-4.6 -18.8 L4.6 -18.8 Q1.6 -16.8 0 -15.6 Q-1.6 -16.8 -4.6 -18.8 Z';
/**
 * The net: a fine mesh of strings along and across the racket (so diagonals
 * on the badge), STRING_GAP apart — tight on purpose, the squares tiny.
 */
const STRING_GAP = 1.8;
const strungAt = (from: number, to: number) =>
  Array.from({ length: Math.floor((to - from) / STRING_GAP) + 1 }, (_, i) => +(from + i * STRING_GAP).toFixed(2));
const RACKET_STRINGS = [
  ...strungAt(-12.6, 12.6).map((x) => `M${x} -46 V-19`),
  ...strungAt(-45, -19).map((y) => `M-13 ${y} H13`),
].join(' ');

/**
 * The racket glyph, drawn in a 24-unit box: the court's padel racket laid at
 * 45°, crown to the top start, its face strung with a net clipped to the face
 * opening. `face` is the badge's own paint, so the strings sit on it.
 */
function Racket({ color, clipId }: { color: string; clipId: string }) {
  return (
    <G transform="translate(12 12) rotate(-45) scale(0.5) translate(0 22.5)">
      <Defs>
        <ClipPath id={clipId}>
          <Path d={RACKET_FACE} />
        </ClipPath>
      </Defs>
      <Path d={`${RACKET_OUTER} ${RACKET_FACE} ${RACKET_THROAT}`} fill={color} fillRule="evenodd" />
      <Path d={RACKET_STRINGS} stroke={color} strokeWidth={0.7} clipPath={`url(#${clipId})`} />
      <Rect x={-1.95} y={-10.2} width={3.9} height={9} rx={1.2} fill={color} />
      <Rect x={-2.3} y={-1.4} width={4.6} height={1.4} rx={0.6} fill={color} />
    </G>
  );
}

/** The trophy glyph, drawn in a 24-unit box. */
function Trophy({ color }: { color: string }) {
  return (
    <G>
      <Path d="M7 4h10v5a5 5 0 0 1-10 0z" fill={color} />
      <Rect x={10.8} y={13} width={2.4} height={4} fill={color} />
      <Rect x={7.5} y={17} width={9} height={2.6} rx={1} fill={color} />
      <Path d="M7 6H4.5a3 3 0 0 0 3 4" fill="none" stroke={color} strokeWidth={1.8} />
      <Path d="M17 6h2.5a3 3 0 0 1-3 4" fill="none" stroke={color} strokeWidth={1.8} />
    </G>
  );
}
