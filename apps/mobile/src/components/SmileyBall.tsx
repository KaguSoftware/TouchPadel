/**
 * The smiley ball, flat — the brand mark on the boot loading screen.
 *
 * The SAME artwork the racket face wears in the 3D court, read straight off
 * `courtTransition/smileyPaths` (which is free of three, so this costs the
 * first frame nothing). Four `<Path>`s in the order that file insists on —
 * INK under BALL and SEAM, INK_TOP over both — because the mark is an ordered
 * stack: the navy is a silhouette with the felt's windows cut out of it, and
 * out of order it comes apart rather than merely looking wrong.
 *
 * THE VIEWBOX IS THE CIRCLE, NOT THE INK'S BOX. `SMILEY_VIEWBOX` is the
 * bounding box of the drawn ink, but the ball's own enclosing circle extends
 * past it, so a box-framed mark spins about a point that is not its centre and
 * wobbles. Framing on `SMILEY_CIRCLE` puts the ball's centre on the svg's, and
 * `size` is then the diameter of the ball itself.
 *
 * Fill rule: react-native-svg's default is nonzero, the PDF's own — and
 * smileyPaths records that every path fills identically under either rule.
 */
import Svg, { Path } from 'react-native-svg';
import {
  SMILEY_BALL_PATHS,
  SMILEY_CIRCLE,
  SMILEY_INK_PATHS,
  SMILEY_INK_TOP_PATHS,
  SMILEY_SEAM_PATHS,
} from '../features/courtTransition/smileyPaths';
import { brand } from '../theme/tokens';

const { cx, cy, r } = SMILEY_CIRCLE;
const VIEW_BOX = `${cx - r} ${cy - r} ${2 * r} ${2 * r}`;

/** ink → ball → seam → inkTop, with the colour each layer is painted in. */
const LAYERS: readonly { paths: readonly string[]; fill: string }[] = [
  { paths: SMILEY_INK_PATHS, fill: brand.markInk },
  { paths: SMILEY_BALL_PATHS, fill: brand.green },
  { paths: SMILEY_SEAM_PATHS, fill: brand.white },
  { paths: SMILEY_INK_TOP_PATHS, fill: brand.markInk },
];

export function SmileyBall({ size = 96 }: { size?: number }) {
  return (
    // Decorative: the screen it sits on is announced by its own label.
    <Svg width={size} height={size} viewBox={VIEW_BOX} accessible={false}>
      {LAYERS.map((layer, li) =>
        layer.paths.map((d, i) => <Path key={`${li}.${i}`} d={d} fill={layer.fill} />),
      )}
    </Svg>
  );
}
