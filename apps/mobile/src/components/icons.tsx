/**
 * Inline icon set — every path traced from the approved design
 * (`docs/design/mobile-ui/Touch Padel App.dc.html`). Stroke-based, 24-viewBox,
 * colored by the caller. Directional icons mirror under RTL.
 *
 * Yoga mirrors LAYOUT, never path data, so a directional glyph flips itself
 * with `mirror(dir)` — from the locale context, the app's one direction.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';
import { useLocale } from '../i18n/LocaleProvider';
import { mirror } from '../i18n/direction';
import { brand, vendor } from '../theme/tokens';

export interface IconProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

function StrokeIcon({
  d,
  size = 16,
  color,
  strokeWidth = 2,
  flip = false,
}: IconProps & { d: string[]; flip?: boolean }) {
  const { dir } = useLocale();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessible={false}
      style={flip ? mirror(dir) : undefined}
    >
      {d.map((p, i) => (
        <Path
          key={i}
          d={p}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

export const CalendarIcon = (p: IconProps) => (
  <StrokeIcon d={['M3.5 5.5h17v15h-17zM3.5 10h17M8 3v4M16 3v4']} {...p} />
);
export const ClockIcon = (p: IconProps) => (
  <StrokeIcon d={['M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z']} {...p} />
);
export const StopwatchIcon = (p: IconProps) => (
  <StrokeIcon d={['M12 9v4l2.5 2M12 5.5a7.5 7.5 0 107.5 7.5A7.5 7.5 0 0012 5.5zM10 2.5h4']} {...p} />
);
export const TagIcon = (p: IconProps) => (
  <StrokeIcon
    d={['M13.2 3H5v8.2L12.8 19a2 2 0 002.8 0l5.4-5.4a2 2 0 000-2.8L13.2 3zM8.7 7.7h.01']}
    {...p}
  />
);
export const WifiOffIcon = (p: IconProps) => (
  <StrokeIcon d={['M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.3h.01M4 4l16 16']} {...p} />
);
export const BellIcon = (p: IconProps) => (
  <StrokeIcon d={['M12 4a6 6 0 00-6 6c0 5-1.5 6-2 7h16c-.5-1-2-2-2-7a6 6 0 00-6-6zM10 20a2 2 0 004 0']} {...p} />
);
export const GlobeIcon = (p: IconProps) => (
  <StrokeIcon
    d={['M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18M21 12a9 9 0 11-18 0 9 9 0 0118 0z']}
    {...p}
  />
);
export const MoonIcon = (p: IconProps) => (
  <StrokeIcon d={['M20.5 14A8.7 8.7 0 1110 3.5a7.5 7.5 0 0010.5 10.5z']} {...p} />
);
export const SunIcon = (p: IconProps) => (
  <StrokeIcon
    d={[
      'M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M18.4 5.6l-1.1 1.1M6.7 17.3l-1.1 1.1',
    ]}
    {...p}
  />
);
export const PhoneIcon = (p: IconProps) => (
  <StrokeIcon
    d={['M8 3h8a1.5 1.5 0 011.5 1.5v15A1.5 1.5 0 0116 21H8a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 018 3zM10.5 17.8h3']}
    {...p}
  />
);
export const EnvelopeIcon = ({ size = 16, color, strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Rect x={3} y={5} width={18} height={14} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
    <Path d="M4 7l8 6 8-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => <StrokeIcon d={['M4.5 12.5l5 5 10-11']} {...p} />;
export const CloseIcon = (p: IconProps) => <StrokeIcon d={['M6 6l12 12M18 6L6 18']} {...p} />;
export const ChevronIcon = (p: IconProps) => <StrokeIcon d={['M9 6l6 6-6 6']} flip {...p} />;
export const BackChevronIcon = (p: IconProps) => <StrokeIcon d={['M15 6l-6 6 6 6']} flip {...p} />;
export const PencilIcon = (p: IconProps) => (
  <StrokeIcon d={['M4 20l1.2-4.2L16.5 4.5a2.05 2.05 0 012.9 2.9L8.2 18.8 4 20z']} {...p} />
);
export const LockIcon = (p: IconProps) => (
  <StrokeIcon d={['M8 10.5V8a4 4 0 018 0v2.5M5.5 10.5h13V20h-13v-9.5z']} {...p} />
);
export const SlidersIcon = (p: IconProps) => (
  <StrokeIcon d={['M4 6.5h16M4 12h16M4 17.5h16M15.5 4.5v4M8.5 10v4M13 15.5v4']} {...p} />
);
export const RoofIcon = (p: IconProps) => (
  <StrokeIcon d={['M4 11.5L12 4.5l8 7M6.5 9.8V19h11V9.8']} {...p} />
);
export const CardIcon = ({ size = 16, color, strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Rect x={2.5} y={6} width={19} height={12} rx={2} stroke={color} strokeWidth={strokeWidth} />
    <Circle cx={12} cy={12} r={2.6} stroke={color} strokeWidth={strokeWidth} />
    <Path d="M6 12h.01M18 12h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

/** The brand padel-ball mark (circle + two racket-face arcs), 48-viewBox. */
export function PadelBallIcon({
  size = 48,
  fill = brand.green,
  stroke = brand.white,
  strokeWidth = 2.4,
  opacity = 1,
}: {
  size?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" opacity={opacity} accessible={false}>
      <Circle cx={24} cy={24} r={21} fill={fill} />
      <Path d="M10 7.5c7.5 9 7.5 24 0 33M38 7.5c-7.5 9-7.5 24 0 33" stroke={stroke} strokeWidth={strokeWidth} />
    </Svg>
  );
}

// ── Tab bar icons (design: grid court / calendar / person) ──────────────────
/** Tab bar icons take react-navigation's `ColorValue` (SDK 57: no longer a plain string). */
type TabIconProps = { size?: number; color: ColorValue };

export const TabBookIcon = ({ size = 21, color }: TabIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={2} />
    <Path d="M12 4.5v15M3.5 12h17" stroke={color} strokeWidth={2} />
  </Svg>
);
export const TabBookingsIcon = ({ size = 21, color }: TabIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Rect x={3.5} y={5.5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={2} />
    <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
export const TabProfileIcon = ({ size = 21, color }: TabIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Circle cx={12} cy={8.5} r={3.5} stroke={color} strokeWidth={2} />
    <Path d="M5 19.5c1.5-3.2 4-4.5 7-4.5s5.5 1.3 7 4.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/** The green hand-drawn underline stroke below page titles. */
export function TitleSquiggle({ width = 76 }: { width?: number }) {
  const { dir } = useLocale();
  const height = Math.round((width / 76) * 8);
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 76 8"
      fill="none"
      accessible={false}
      style={[{ marginTop: 4 }, mirror(dir)]}
    >
      <Path d="M2 6C22 1 50 1 74 4.5" stroke={brand.green} strokeWidth={3.5} strokeLinecap="round" />
    </Svg>
  );
}

// ── Third-party brand marks ─────────────────────────────────────────────────

/**
 * Google's four-colour "G" (48-viewBox path data of the standard colour logo,
 * per developers.google.com/identity/branding-guidelines). Brand rules: never
 * recolour, never resize the mark relative to its padding, and — unlike every
 * directional icon above — never mirror it in RTL. Colours from theme `vendor`.
 */
export const GoogleGMark = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
    <Path
      fill={vendor.google.mark.blue}
      d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
    />
    <Path
      fill={vendor.google.mark.green}
      d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C8.05 41.07 15.4 46 24 46z"
    />
    <Path
      fill={vendor.google.mark.yellow}
      d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
    />
    <Path
      fill={vendor.google.mark.red}
      d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 8.05 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
    />
  </Svg>
);
