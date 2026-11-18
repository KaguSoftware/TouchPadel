/**
 * The Edit profile header's geometry, as pure functions (owner, 2026-11-16,
 * after Telegram's settings page). `src/components/ProfileHero.tsx` turns them
 * into animated values; nothing here imports react-native, so vitest pins it.
 *
 * Two inputs drive everything:
 *   P, the FLIGHT: 0 is the full-width band, 1 is the framed circle. It is a
 *      timed animation (HERO_MS), started by a small scroll or pull and played
 *      by itself: the finger does not scrub it. Scrolling back to the top plays
 *      it in reverse.
 *   S, the page's scroll offset (negative while pulling past the top): it only
 *      moves the page. Past HERO_T the band, the circle and the texts leave
 *      with it, 1:1. A pull stretches the band while it is wide.
 *
 * The band does not shrink as a box and its content never zooms: a circular
 * window (an "iris") closes in on it while the content only slides, so the
 * focal point (the face, the letter) stays inside the window.
 *
 * `heroByP` and `heroByS` each depend on one input; `heroState` joins them. The
 * component animates the two halves separately and joins them with the same
 * formulas, so keep the two in step.
 *
 * Every function here is a worklet ('worklet'): the component calls them on the UI thread, so the
 * header animates without the JavaScript thread. They stay plain TypeScript for vitest.
 *
 * Coordinates are the hero's own: x from the start edge, y down from the top of
 * the page. `top` is the safe-area inset the clear native bar sits under.
 */

/** Scroll that starts the flight, and how far a pull stretches the band. */
export const HERO_T = 14;
export const HERO_PULL = 240;
export const HERO_CIRCLE = 72;
/** The air between the header (the band, or the circle's texts) and the first section label. */
export const HERO_GAP = 18;
/**
 * How far past the band's corners the iris opens. Without it the corners are still being cut in the last
 * stretch of opening, where the eased time barely moves, and the band seems to hang before it squares up
 * (seen on a phone, 2026-11-16). With it the iris clears the corners 10% of the way in, so the last of the
 * opening is a plain full-width band.
 */
const IRIS_OVERSHOOT = 1.3;
/** The name's size: one size in both states, so the text is never re-laid out while the flight plays. */
export const NAME_SIZE = 22;
/** How long the flight takes. */
export const HERO_MS = 260;

export type HeroGeo = {
  W: number;
  top: number;
  /** The full-width band's height at rest. */
  H0: number;
  /** The framed circle's diameter, and the photo's diameter inside the frame. */
  circle: number;
  inner: number;
  /** Where the circle sits once it has landed, and where the name sits under it. */
  circleTop: number;
  nameTop1: number;
  /** The header's height once the flight has landed. */
  H1: number;
  /** The content's focal point as a fraction of the band's height: the face, or the letter. */
  fyFrac: number;
};

export function heroGeo(opts: {
  W: number;
  top: number;
  /** The frame's inset at the circle's size (`frameDrawing(...).inset`). */
  frameInset: number;
  hasPhoto: boolean;
}): HeroGeo {
  const { W, top, frameInset, hasPhoto } = opts;
  const H0 = Math.round(W * 1.2);
  const circleTop = top + 38;
  const nameTop1 = circleTop + HERO_CIRCLE + 10;
  return {
    W,
    top,
    H0,
    circle: HERO_CIRCLE,
    inner: HERO_CIRCLE - 2 * frameInset,
    circleTop,
    nameTop1,
    // The room under the circle's texts, plus the scroll that starts the flight, so the
    // rows sit the same distance below the phone line whenever the page has scrolled on.
    H1: nameTop1 + 72 + HERO_T + HERO_GAP,
    fyFrac: hasPhoto ? 0.34 : 0.5,
  };
}

/** Everything that depends on the flight alone. */
export type HeroByP = {
  /** 1 - P, the weight of the wide band's own behaviour (pull stretch) in the join. */
  omP: number;
  heroH: number;
  /** The iris's radius and centre line over the unstretched band. */
  r0: number;
  cyc0: number;
  /** The slide that keeps the focal point in the window. */
  ty0: number;
  shade: number;
  avatarOpacity: number;
  /** 0 over the band (white texts), 1 over the page (ink texts). */
  tone: number;
  nameBase: number;
  nameStart: number;
  lineGap: number;
  lineStart: number;
};

/** Everything that depends on the scroll offset alone. */
export type HeroByS = {
  /** How far the page is pulled past the top, and how far the band and texts have left with the page. */
  q: number;
  off: number;
  /** The pull's effect on the iris, the content and its slide (each weighed by 1 - P in the join). */
  qr: number;
  qHalf: number;
  qs: number;
  qx: number;
  qty: number;
  full: number;
};

function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}
function clamp(v: number, a: number, b: number): number {
  'worklet';
  return Math.max(a, Math.min(b, v));
}

export function heroByP(P: number, g: HeroGeo, nameW26: number, lineW: number): HeroByP {
  'worklet';
  const rFull0 = (Math.hypot(g.W / 2, g.H0 / 2) + 4) * IRIS_OVERSHOOT;
  const cy1 = g.circleTop + g.circle / 2;
  const r0 = rFull0 * Math.pow(g.inner / 2 / rFull0, P);
  const cyc0 = lerp(g.H0 / 2, cy1, P);
  // The texts are white while they sit on the band (inside the iris) and ink once they are on the page.
  const nameBase = lerp(g.H0 - 66, g.nameTop1, P);
  const lineGap = lerp(36, 28, P);
  const offBand = (x: number, y: number, w: number) => {
    const d = Math.hypot(x + w / 2 - g.W / 2, y - cyc0);
    return clamp((d - (r0 - 10)) / 30, 0, 1);
  };
  const tone = Math.max(
    offBand(lerp(20, (g.W - nameW26) / 2, P), nameBase + 14, nameW26),
    offBand(lerp(20, (g.W - lineW) / 2, P), nameBase + lineGap + 8, lineW),
  );
  const fy0 = g.H0 * g.fyFrac;
  return {
    omP: 1 - P,
    heroH: lerp(g.H0 + HERO_GAP, g.H1, P),
    r0,
    cyc0,
    ty0: P * (cy1 - fy0),
    shade: 1 - P,
    avatarOpacity: clamp((P - 0.85) / 0.15, 0, 1),
    tone,
    nameBase,
    nameStart: lerp(20, (g.W - nameW26) / 2, P),
    lineGap,
    lineStart: lerp(20, (g.W - lineW) / 2, P),
  };
}

export function heroByS(S: number, g: HeroGeo): HeroByS {
  'worklet';
  const q = clamp(-S, 0, HERO_PULL);
  const rFull = (h: number) => Math.hypot(g.W / 2, h / 2) + 4;
  const qs = q / 900;
  return {
    q,
    off: Math.max(0, S - HERO_T),
    qr: rFull(g.H0 + q) - rFull(g.H0),
    qHalf: q / 2,
    qs,
    qx: (-g.W / 2) * qs,
    qty: -g.H0 * g.fyFrac * qs,
    full: g.H0 + q,
  };
}

export type HeroState = {
  /** The spacer's height in the page's scroll content (a pull is the scroll view's bounce, not layout). */
  heroH: number;
  /** The band's rectangle: it never reaches past the top of the rows. */
  boxTop: number;
  boxH: number;
  full: number;
  /** The iris: a circle (clipTop, clipStart, clipSize) that clips the content. */
  clipTop: number;
  clipStart: number;
  clipSize: number;
  /** The content inside the iris: placed so it stays put on screen while the window closes. */
  contentTop: number;
  contentStart: number;
  scale: number;
  tx: number;
  ty: number;
  shade: number;
  /** The framed avatar that takes over at the end of the flight. */
  avatarTop: number;
  avatarOpacity: number;
  tone: number;
  nameTop: number;
  nameStart: number;
  lineTop: number;
  lineStart: number;
};

/** The two halves joined. `nameW26` is the name's width at NAME_SIZE, `lineW` the phone line's at 13 pt (measured). */
export function heroState(S: number, P: number, g: HeroGeo, nameW26: number, lineW: number): HeroState {
  'worklet';
  const a = heroByP(P, g, nameW26, lineW);
  const b = heroByS(S, g);
  const r = a.r0 + b.qr * a.omP;
  const cyc = a.cyc0 + b.qHalf * a.omP;
  const clipTop = cyc - r;
  const clipStart = g.W / 2 - r;
  const boxTop = -b.off;
  const nameTop = a.nameBase + b.q * a.omP - b.off;
  return {
    heroH: a.heroH,
    boxTop,
    boxH: Math.max(0, Math.min(b.full, a.heroH - S)),
    full: b.full,
    clipTop,
    clipStart,
    clipSize: 2 * r,
    contentTop: -clipTop,
    contentStart: -clipStart,
    scale: 1 + b.qs * a.omP,
    tx: b.qx * a.omP,
    ty: a.ty0 + b.qty * a.omP,
    shade: a.shade,
    avatarTop: g.circleTop - b.off,
    avatarOpacity: a.avatarOpacity,
    tone: a.tone,
    nameTop,
    nameStart: a.nameStart,
    lineTop: nameTop + a.lineGap,
    lineStart: a.lineStart,
  };
}

/** `#rgb` or `#rrggbb` to channels; null for anything else. */
function channels(hex: string): [number, number, number] | null {
  'worklet';
  let h = hex.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Two colours blended, as an `rgba()` string (so animated colours share one format). The end colour wins if either is not a hex. */
export function mixColor(from: string, to: string, t: number, alpha = 1): string {
  'worklet';
  const a = channels(from);
  const b = channels(to);
  const c: [number, number, number] =
    a && b
      ? [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]
      : (b ?? a ?? [0, 0, 0]);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
