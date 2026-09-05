/**
 * SVG path data → three.js shapes, for the brand artwork this folder draws.
 *
 * Shared by `logoMark` (the Touch Padel lockup) and `smileyMark` (the smiley
 * ball on the racket face), and split out of the first when the second arrived
 * — not for tidiness, but for weight: Metro bundles what is reachable, and the
 * racket now draws only the ball, so leaving the parser inside `logoMark` would
 * have shipped the wordmark's twelve kilobytes of `d` strings to every phone
 * for nothing.
 *
 * PURE — three's curve/shape maths and nothing else. No React, no react-native,
 * no material, mesh or scene code, which is what lets it be unit-tested under
 * plain node (vitest.config.ts collects only `__tests__` folders under `src/`,
 * and only modules that import no react-native or expo).
 *
 * Deliberately NOT a general SVG library. Both marks were lifted from the
 * brand's own PDFs with pdftocairo, which emits absolute M, L, C and Z and
 * nothing else; anything further is a sign the artwork was re-exported with
 * different settings, and throws rather than being quietly approximated.
 */
import * as THREE from 'three';

/**
 * Curve samples per bezier when a subpath is flattened for the containment
 * test. Only the ray-crossing vote reads this, and on this artwork that vote
 * is not close — a true counter scores 1.000 and the nearest thing to a false
 * positive scores 0.232 — so the number buys robustness, not precision, and
 * nothing about the emitted geometry depends on it.
 */
const FLATTEN_DIVISIONS = 16;

/**
 * One token of a path string: a command letter or a number. Whitespace and
 * commas separate and carry no meaning, so they never become tokens.
 */
type Token =
  | { readonly kind: 'command'; readonly text: string }
  | { readonly kind: 'number'; readonly value: number };

/** Sticky, so an unmatched character is a hard error rather than a silent skip. */
const TOKEN = /([A-Za-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)/y;

const tokenise = (d: string): Token[] => {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < d.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(d);
    if (!m)
      throw new Error(
        `svgPath: unreadable character at ${at}: ${JSON.stringify(d.slice(at, at + 12))}`,
      );
    if (m[1] !== undefined) tokens.push({ kind: 'command', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'number', value: Number.parseFloat(m[2]) });
  }
  return tokens;
};

/**
 * One THREE.Path per subpath of an SVG `d` string.
 *
 * Deliberately NOT a general SVG parser: the brand extraction contains only the
 * absolute M, L, C and Z, so anything else is a sign the artwork was re-exported
 * with different settings and throws rather than being quietly approximated.
 * Relative commands, arcs, quadratics and the shorthand forms are all absent and
 * all rejected.
 *
 * The one piece of grammar honoured beyond what this data uses is a command
 * letter followed by several coordinate sets (`L x y x y`, and the implicit
 * lineto after `M x y x y`) — pdftocairo repeats the letter instead, but the
 * form is legal SVG and costs a loop rather than a special case.
 */
export const parseSvgPath = (d: string): THREE.Path[] => {
  const tokens = tokenise(d);
  const paths: THREE.Path[] = [];
  let path: THREE.Path | null = null;
  let i = 0;

  const number = (command: string): number => {
    const token = tokens[i++];
    if (!token || token.kind !== 'number')
      throw new Error(`svgPath: ${command} wants a number at token ${i - 1}`);
    return token.value;
  };
  const more = (): boolean => tokens[i]?.kind === 'number';
  const open = (command: string): THREE.Path => {
    if (!path) throw new Error(`svgPath: ${command} before any moveto`);
    return path;
  };
  // A subpath that drew nothing is an export artefact, not geometry.
  const flush = (): void => {
    if (path && path.curves.length > 0) paths.push(path);
    path = null;
  };

  while (i < tokens.length) {
    const token = tokens[i++];
    if (!token || token.kind !== 'command')
      throw new Error(`svgPath: expected a command at token ${i - 1}`);
    const command = token.text;
    switch (command) {
      case 'M': {
        flush();
        path = new THREE.Path();
        path.moveTo(number('M'), number('M'));
        while (more()) path.lineTo(number('M'), number('M')); // implicit lineto
        break;
      }
      case 'L': {
        const p = open('L');
        do p.lineTo(number('L'), number('L'));
        while (more());
        break;
      }
      case 'C': {
        const p = open('C');
        do
          p.bezierCurveTo(
            number('C'),
            number('C'),
            number('C'),
            number('C'),
            number('C'),
            number('C'),
          );
        while (more());
        break;
      }
      case 'Z': {
        // three's closePath draws the closing line but leaves currentPoint
        // where the last curve ended; SVG puts the pen back on the subpath's
        // start. Every Z in this data is followed by an M, so nothing here
        // depends on it — a re-export that draws on after a Z would.
        const p = open('Z');
        p.closePath();
        p.currentPoint.copy(p.curves[0]!.getPoint(0));
        break;
      }
      default:
        throw new Error(
          `svgPath: unsupported path command "${command}" — the brand artwork uses only M, L, C, Z`,
        );
    }
  }
  flush();
  return paths;
};

/** Flatten a subpath to a polygon for the containment vote. */
const outline = (path: THREE.Path): THREE.Vector2[] => path.getPoints(FLATTEN_DIVISIONS);

/** Even-odd ray crossing: is `p` inside the polygon `poly`? */
const isInside = (p: THREE.Vector2, poly: readonly THREE.Vector2[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
};

/**
 * Is subpath `inner` inside subpath `outer`?
 *
 * A single sampled point would do for a typeface's nested counters, but this
 * wordmark is not a typeface: its letters are drawn as UNIONS of overlapping
 * outlines — the stem of the "u" is a rectangle laid across the bowl, the "h"
 * likewise — so a lone sample can land inside a neighbour that does not contain
 * the subpath at all. Voting the whole flattened outline separates the two
 * cases outright: on this artwork a true counter scores 1.000 and the worst
 * overlap scores 0.232.
 */
const containedBy = (inner: readonly THREE.Vector2[], outer: readonly THREE.Vector2[]): boolean => {
  let hits = 0;
  for (const p of inner) if (isInside(p, outer)) hits++;
  return hits > inner.length / 2;
};

/** Signed-area magnitude of a flattened outline — the tie-break for a nested counter. */
const area = (poly: readonly THREE.Vector2[]): number => {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    sum += b.x * a.y - a.x * b.y;
  }
  return Math.abs(sum) / 2;
};

/** A Shape carrying a Path's curves — the curves are cloned, never pre-flattened. */
const toShape = (path: THREE.Path): THREE.Shape => {
  const shape = new THREE.Shape();
  shape.curves = path.curves.slice();
  shape.currentPoint.copy(path.currentPoint);
  return shape;
};

/**
 * Loose subpaths → filled shapes, by CONTAINMENT DEPTH.
 *
 * The extraction hands over a flat list with no winding convention to trust and
 * no grouping of its own, so nesting is measured rather than assumed: count how
 * many OTHER subpaths contain each one. Even depth (0, 2, …) is ink and becomes
 * a Shape; odd depth is a counter and becomes a hole of its nearest container —
 * the containing subpath one level shallower, smallest first if several tie.
 *
 * Without it the two counters this artwork has — inside the bowl of the "d"
 * and inside the loop of the "P" — fill in as solid blobs, which is what a
 * naive `paths.map(toShape)` gives. The other letters need no counter: this
 * extraction draws "a", "c", "e" and "u" as open unions of overlapping
 * outlines rather than as outline-plus-counter, and the "o" is the ball, three
 * arcs that never enclose one another. Depth rather than a hole/outer flag is
 * still what is measured, because it stays right for a counter inside a
 * counter — none occurs here, but the mark is brand artwork and may be
 * re-exported.
 */
export const groupSubpaths = (subpaths: readonly THREE.Path[]): THREE.Shape[] => {
  const polys = subpaths.map(outline);
  const containers = subpaths.map((_, i) =>
    polys.map((_p, j) => j).filter((j) => j !== i && containedBy(polys[i]!, polys[j]!)),
  );
  const depth = containers.map((c) => c.length);

  const shapes: THREE.Shape[] = [];
  const shapeOf = new Map<number, THREE.Shape>();
  subpaths.forEach((path, i) => {
    if (depth[i]! % 2 !== 0) return;
    const shape = toShape(path);
    shapeOf.set(i, shape);
    shapes.push(shape);
  });

  subpaths.forEach((path, i) => {
    if (depth[i]! % 2 === 0) return;
    const nearest = containers[i]!.filter((j) => depth[j] === depth[i]! - 1).sort(
      (a, b) => area(polys[a]!) - area(polys[b]!),
    )[0];
    if (nearest === undefined) throw new Error(`svgPath: subpath ${i} is a counter of nothing`);
    const host = shapeOf.get(nearest);
    if (!host) throw new Error(`svgPath: subpath ${i} nests in ${nearest}, which is not a shape`);
    host.holes.push(path);
  });

  return shapes;
};
