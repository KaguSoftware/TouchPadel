/**
 * Inline icon set — every path traced from the approved design
 * (`docs/design/mobile-ui/Touch Padel App.dc.html`). Stroke-based, 24-viewBox,
 * colored by the caller. Directional icons flip with RTL via `flipRtl`.
 */
import { I18nManager } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

function paths(d: string[], { size = 16, color, strokeWidth = 2 }: IconProps, flip = false) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={flip && I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
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

export const CalendarIcon = (p: IconProps) => paths(['M3.5 5.5h17v15h-17zM3.5 10h17M8 3v4M16 3v4'], p);
export const ClockIcon = (p: IconProps) => paths(['M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z'], p);
export const StopwatchIcon = (p: IconProps) =>
  paths(['M12 9v4l2.5 2M12 5.5a7.5 7.5 0 107.5 7.5A7.5 7.5 0 0012 5.5zM10 2.5h4'], p);
export const TagIcon = (p: IconProps) =>
  paths(['M13.2 3H5v8.2L12.8 19a2 2 0 002.8 0l5.4-5.4a2 2 0 000-2.8L13.2 3zM8.7 7.7h.01'], p);
export const WifiOffIcon = (p: IconProps) =>
  paths(['M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.3h.01M4 4l16 16'], p);
export const BellIcon = (p: IconProps) =>
  paths(['M12 4a6 6 0 00-6 6c0 5-1.5 6-2 7h16c-.5-1-2-2-2-7a6 6 0 00-6-6zM10 20a2 2 0 004 0'], p);
export const GlobeIcon = (p: IconProps) =>
  paths(['M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18M21 12a9 9 0 11-18 0 9 9 0 0118 0z'], p);
export const MoonIcon = (p: IconProps) => paths(['M20.5 14A8.7 8.7 0 1110 3.5a7.5 7.5 0 0010.5 10.5z'], p);
export const SunIcon = (p: IconProps) =>
  paths(
    [
      'M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M18.4 5.6l-1.1 1.1M6.7 17.3l-1.1 1.1',
    ],
    p,
  );
export const PhoneIcon = (p: IconProps) =>
  paths(['M8 3h8a1.5 1.5 0 011.5 1.5v15A1.5 1.5 0 0116 21H8a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 018 3zM10.5 17.8h3'], p);
export const EnvelopeIcon = ({ size = 16, color, strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={3} y={5} width={18} height={14} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
    <Path d="M4 7l8 6 8-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => paths(['M4.5 12.5l5 5 10-11'], p);
export const ChevronIcon = (p: IconProps) => paths(['M9 6l6 6-6 6'], p, true);
export const BackChevronIcon = (p: IconProps) => paths(['M15 6l-6 6 6 6'], p, true);
export const PencilIcon = (p: IconProps) =>
  paths(['M4 20l1.2-4.2L16.5 4.5a2.05 2.05 0 012.9 2.9L8.2 18.8 4 20z'], p);
export const LockIcon = (p: IconProps) => paths(['M8 10.5V8a4 4 0 018 0v2.5M5.5 10.5h13V20h-13v-9.5z'], p);
export const SlidersIcon = (p: IconProps) =>
  paths(['M4 6.5h16M4 12h16M4 17.5h16M15.5 4.5v4M8.5 10v4M13 15.5v4'], p);
export const RoofIcon = (p: IconProps) => paths(['M4 11.5L12 4.5l8 7M6.5 9.8V19h11V9.8'], p);
export const CardIcon = ({ size = 16, color, strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={2.5} y={6} width={19} height={12} rx={2} stroke={color} strokeWidth={strokeWidth} />
    <Circle cx={12} cy={12} r={2.6} stroke={color} strokeWidth={strokeWidth} />
    <Path d="M6 12h.01M18 12h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

/** The brand padel-ball mark (circle + two racket-face arcs), 48-viewBox. */
export function PadelBallIcon({
  size = 48,
  fill = '#A5D06F',
  stroke = '#FFFFFF',
  opacity = 1,
}: {
  size?: number;
  fill?: string;
  stroke?: string;
  opacity?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" opacity={opacity}>
      <Circle cx={24} cy={24} r={21} fill={fill} />
      <Path d="M10 7.5c7.5 9 7.5 24 0 33M38 7.5c-7.5 9-7.5 24 0 33" stroke={stroke} strokeWidth={2.4} />
    </Svg>
  );
}

// ── Tab bar icons (design: grid court / calendar / person) ──────────────────
export const TabBookIcon = ({ size = 21, color }: { size?: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={2} />
    <Path d="M12 4.5v15M3.5 12h17" stroke={color} strokeWidth={2} />
  </Svg>
);
export const TabBookingsIcon = ({ size = 21, color }: { size?: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={3.5} y={5.5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={2} />
    <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
export const TabProfileIcon = ({ size = 21, color }: { size?: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8.5} r={3.5} stroke={color} strokeWidth={2} />
    <Path d="M5 19.5c1.5-3.2 4-4.5 7-4.5s5.5 1.3 7 4.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/** The green hand-drawn underline stroke below page titles. */
export function TitleSquiggle({ width = 76 }: { width?: number }) {
  const height = Math.round((width / 76) * 8);
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 76 8"
      fill="none"
      style={{ marginTop: 4, transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
    >
      <Path d="M2 6C22 1 50 1 74 4.5" stroke="#A5D06F" strokeWidth={3.5} strokeLinecap="round" />
    </Svg>
  );
}
