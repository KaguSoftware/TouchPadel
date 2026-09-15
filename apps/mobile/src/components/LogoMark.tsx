/**
 * The Touch Padel lockup, flat — the brand mark on the boot loading screen.
 *
 * The SAME artwork the racket decal and the court transition build geometry
 * from, read straight off `courtTransition/logoPaths` (which is free of three,
 * so this costs the first frame nothing). Two renderers rather than one,
 * because the loading screen animates the ball SEPARATELY from the word: the
 * "o" of Touch is the ball, and `LogoWordmark` draws the word without it while
 * `LogoBall` draws it alone, framed on its own circle so it spins and squashes
 * about its true centre. Laid over each other at `logoFrame`'s offsets they
 * reassemble into the lockup exactly.
 *
 * Fill rule: react-native-svg's default is nonzero, and it must stay so —
 * logoPaths.ts has the measurement (the u, h and a would lose their overlaps
 * under evenodd).
 *
 * The ball comes in two states. `white` is the splash's own: three white arcs
 * with the blue ground showing through the two gaps as the seam, exactly as
 * logo-white.png has it. `colour` is the brand's colour lockup: the arcs in
 * brand green over a white disc — the disc IS the seam, because on any ground
 * that is not white the gaps between the arcs go the ground's colour and the
 * ball stops being a tennis ball (see LOGO_BALL_CIRCLE).
 */
import Svg, { Circle, Path } from 'react-native-svg';
import {
  LOGO_BALL_CIRCLE,
  LOGO_BALL_PATHS,
  LOGO_VIEWBOX,
  LOGO_WORDMARK_PATHS,
  logoBallViewBox,
} from '../features/courtTransition/logoPaths';
import { brand } from '../theme/tokens';

const WORDMARK_VIEW_BOX = `0 0 ${LOGO_VIEWBOX.width} ${LOGO_VIEWBOX.height}`;
const BALL_VIEW_BOX = logoBallViewBox();

/** The word, without its "o": T·uch Padel, `width` points wide. */
export function LogoWordmark({ width, color }: { width: number; color: string }) {
  const height = (width * LOGO_VIEWBOX.height) / LOGO_VIEWBOX.width;
  return (
    // Decorative: the screen it sits on is announced by its own label.
    <Svg width={width} height={height} viewBox={WORDMARK_VIEW_BOX} accessible={false}>
      {LOGO_WORDMARK_PATHS.map((d, i) => (
        <Path key={i} d={d} fill={color} />
      ))}
    </Svg>
  );
}

/** The "o": the ball alone, `size` points square (its circle plus the pad). */
export function LogoBall({ size, variant }: { size: number; variant: 'white' | 'colour' }) {
  const colour = variant === 'colour';
  return (
    <Svg width={size} height={size} viewBox={BALL_VIEW_BOX} accessible={false}>
      {colour ? (
        <Circle
          cx={LOGO_BALL_CIRCLE.cx}
          cy={LOGO_BALL_CIRCLE.cy}
          r={LOGO_BALL_CIRCLE.r}
          fill={brand.white}
        />
      ) : null}
      {LOGO_BALL_PATHS.map((d, i) => (
        <Path key={i} d={d} fill={colour ? brand.green : brand.white} />
      ))}
    </Svg>
  );
}
