import type { ReactNode } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { brand, palettes } from '../../theme';
import { categoryArtFor, type CategoryArtColors } from '../cafe/categoryArt';

/**
 * The drawings on a deal's poster (Majed, 2026-11-15, "B+": the blue side in the menu's own
 * drawing style). A deal on one menu category draws that category exactly as the menu does
 * (`categoryArt.tsx`); two drawings are new and made in the same hand, on the same 64-unit grid
 * with the same stroke weights: a padel racket with a ball for court deals, and a till receipt
 * with a percent badge for the whole café bill.
 *
 * The menu draws on paper; here the ground is the poster's blue or navy, so the colour roles move:
 * the lines go white, every fill takes the ground's own colour, the tints step one shade off it.
 */
export type DealDrawingKind =
  | { kind: 'category'; nameEn: string }
  | { kind: 'court' }
  | { kind: 'bill' }
  /** A wrapped present: a reward that is one menu item (the reward does not say which). */
  | { kind: 'gift' };

/** The menu drawings' colour roles on one of the poster's grounds. */
export function posterArtColors(ground: string): CategoryArtColors {
  // A ready reward's tile is all green (2026-11-16): the lines go black, the green parts navy.
  if (ground === brand.green) {
    return {
      accent: brand.greenInk,
      bg: ground,
      blueTint: palettes.light.gline,
      greenTint: `${brand.navy}33`,
      green: brand.navy,
      greenLight: palettes.light.gline,
    };
  }
  return {
    accent: brand.white,
    bg: ground,
    blueTint: ground === brand.blue ? brand.blueShade : ground === brand.navy ? brand.navyCard : brand.navyLine,
    greenTint: `${brand.green}47`,
    green: brand.green,
    greenLight: palettes.light.gline,
  };
}

/** A padel racket (solid perforated face, short grip) and a ball. */
function racketArt(c: CategoryArtColors): ReactNode {
  const holes: [number, number][] = [
    [25, 15], [30, 13.2], [35, 15],
    [22.6, 21], [27.5, 20], [32.5, 20], [37.4, 21],
    [24.5, 27], [30, 26.5], [35.5, 27], [30, 32],
  ];
  return (
    <>
      <Path
        d="M30 5 C41 5 48 13 48 23 C48 32 42 38 35 40.5 L33.5 45 H26.5 L25 40.5 C18 38 12 32 12 23 C12 13 19 5 30 5 Z"
        fill={c.bg}
        strokeWidth="3.8"
      />
      <Ellipse cx="30" cy="22.5" rx="11.5" ry="12.5" fill={c.blueTint} stroke="none" />
      <G fill={c.accent} stroke="none" opacity={0.7}>
        {holes.map(([x, y]) => (
          <Circle key={`${x}:${y}`} cx={x} cy={y} r="1.5" />
        ))}
      </G>
      <Path d="M26.5 40.5 L30 35.5 L33.5 40.5" strokeWidth="2.4" opacity={0.5} />
      <Rect x="26.5" y="45" width="7" height="14" rx="2.2" fill={c.greenTint} strokeWidth="3.2" />
      <G stroke={c.green} strokeWidth="2">
        <Path d="M27.5 49.5 L32.5 51.5" />
        <Path d="M27.5 54 L32.5 56" />
      </G>
      <Circle cx="50" cy="50" r="7.5" fill={c.green} stroke="none" />
      <Path d="M43.4 47.2 C47 49 47.2 53 44.8 56" stroke={c.bg} strokeWidth="1.7" />
      <Path d="M56.6 52.8 C53 51 52.8 47 55.2 44" stroke={c.bg} strokeWidth="1.7" />
      <G stroke={c.green} strokeWidth="2.4">
        <Path d="M40 60 L37 62.5" />
        <Path d="M45 61.5 L43.5 63.5" />
      </G>
    </>
  );
}

const RECEIPT =
  'M15 6 H45 V55 L41.25 58.5 L37.5 55 L33.75 58.5 L30 55 L26.25 58.5 L22.5 55 L18.75 58.5 L15 55 Z';

/** A till receipt with a percent badge: the whole café bill. */
function billArt(c: CategoryArtColors): ReactNode {
  return (
    <>
      <Path d={RECEIPT} fill={c.bg} strokeWidth="3.6" />
      <Path d={RECEIPT} fill={c.blueTint} stroke="none" transform="translate(30 32) scale(0.78) translate(-30 -32)" />
      <G strokeWidth="2.6" opacity={0.6}>
        <Path d="M20.5 16 H32" />
        <Path d="M20.5 23 H38" />
        <Path d="M20.5 30 H30" />
        <Path d="M35 30 H39.5" />
      </G>
      <Path d="M20.5 38 H39.5" strokeWidth="1.8" strokeDasharray="2 3.2" opacity={0.5} />
      <Path d="M20.5 45.5 H27" strokeWidth="3" />
      <Path d="M32 45.5 H39.5" stroke={c.green} strokeWidth="3.6" />
      <Circle cx="47" cy="13" r="9.5" fill={c.green} stroke={c.bg} strokeWidth="3.2" />
      <Path d="M43.6 16.6 L50.4 9.4" stroke={c.bg} strokeWidth="2.4" />
      <Circle cx="44.1" cy="9.9" r="1.7" fill={c.bg} stroke="none" />
      <Circle cx="49.9" cy="16.1" r="1.7" fill={c.bg} stroke="none" />
    </>
  );
}

/** A present with a bow: one free menu item. */
function giftArt(c: CategoryArtColors): ReactNode {
  return (
    <>
      <Rect x="13" y="37" width="38" height="21" rx="2.6" fill={c.blueTint} strokeWidth="3.6" />
      <Rect x="9.5" y="26" width="45" height="11" rx="2.6" fill={c.bg} strokeWidth="3.6" />
      <Path d="M32 26 V58" stroke={c.green} strokeWidth="4.2" />
      <Path d="M32 25 C28 15 16 14 18.5 21.5 C20 25.5 26 25.5 32 25 Z" fill={c.greenTint} stroke={c.green} strokeWidth="3" />
      <Path d="M32 25 C36 15 48 14 45.5 21.5 C44 25.5 38 25.5 32 25 Z" fill={c.greenTint} stroke={c.green} strokeWidth="3" />
    </>
  );
}

/** One drawing, `size` points square, on `ground`. Decorative. */
export function DealDrawing({ which, ground, size }: { which: DealDrawingKind; ground: string; size: number }) {
  const c = posterArtColors(ground);
  const category = which.kind === 'category' ? categoryArtFor(which.nameEn) : undefined;
  const art = category
    ? category.art(c)
    : which.kind === 'court'
      ? racketArt(c)
      : which.kind === 'gift'
        ? giftArt(c)
        : billArt(c);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke={c.accent}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      {art}
    </Svg>
  );
}
