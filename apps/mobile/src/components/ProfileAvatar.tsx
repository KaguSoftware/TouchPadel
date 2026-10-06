import { useState } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
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
  type Paint,
} from '../features/profile/frames';

/**
 * The guest's round avatar (0302): their photo when they set one, otherwise
 * their initials on Touch Blue. Since 0307 the ring around it is the guest's
 * photo frame (`features/profile/frames.ts`), drawn in an svg layer on top so a
 * badge can sit across the ring; the outer size never changes, so no layout
 * around an avatar moves. The photo arrives through a signed URL; while it
 * loads, or if it fails, the initials show, so the circle is never empty.
 *
 * The ring art never mirrors in Arabic; only an earned frame's badge follows
 * the reading direction (bottom end corner).
 */
export function ProfileAvatar({
  path,
  initials,
  size,
  frame = DEFAULT_FRAME,
}: {
  path: string | null | undefined;
  initials: string;
  size: number;
  frame?: FrameId;
}) {
  const { fonts, colors } = useTheme();
  const { dir } = useLocale();
  const url = useAvatarUrl(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!url.data && url.data !== failedUrl;
  const drawing = frameDrawing(frame, size);
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
      <FrameLayer frame={frame} size={size} rtl={dir === 'rtl'} rim={colors.card} />
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
function FrameLayer({ frame, size, rtl, rim }: { frame: FrameId; size: number; rtl: boolean; rim: string }) {
  const d = frameDrawing(frame, size);
  const id = `f${frame}${size}`;
  const c = size / 2;
  const rings = d.rings.map((ring, i) => {
    // The ring's centre line: inside every ring drawn before it.
    const mid = c - d.rings.slice(0, i).reduce((sum, x) => sum + x.width, 0) - ring.width / 2;
    const stroke = paintOf(ring.paint, id);
    if (ring.dashes) {
      const circ = 2 * Math.PI * mid;
      const seg = circ / ring.dashes;
      return (
        <Circle
          key={i}
          cx={c}
          cy={c}
          r={mid}
          fill="none"
          stroke={stroke}
          strokeWidth={ring.width}
          strokeDasharray={`${seg * 0.62} ${seg * 0.38}`}
          // One dash centred at the top.
          transform={`rotate(${-90 - (360 / ring.dashes) * 0.31} ${c} ${c})`}
        />
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
            <Racket color={COLOR[d.badge.ink]} holes={paintOf(d.badge.fill, id)} />
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
      </Defs>
      {rings}
      {badge}
    </Svg>
  );
}

/** The racket glyph, drawn in a 24-unit box. */
function Racket({ color, holes }: { color: string; holes: string }) {
  return (
    <G>
      <Path d="M14.4 14.4 L19.8 19.8" stroke={color} strokeWidth={3.6} strokeLinecap="round" />
      <Ellipse cx={10} cy={10} rx={7} ry={7.8} transform="rotate(-45 10 10)" fill={color} />
      <Circle cx={8} cy={8.6} r={1.25} fill={holes} />
      <Circle cx={11.6} cy={8.4} r={1.25} fill={holes} />
      <Circle cx={9.8} cy={11.8} r={1.25} fill={holes} />
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
