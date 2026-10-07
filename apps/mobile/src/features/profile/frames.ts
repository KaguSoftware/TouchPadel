/**
 * Photo frames (Phase 2, migration 0314; design "Touch Profile Frames", the
 * first set to ship). The profile stores one id of this closed list; the server
 * (`app.frame_ids`, `profiles_avatar_frame_chk`) holds the same list and
 * refuses an earned frame the guest has not earned. Pure data and maths, no
 * react-native, so it runs under vitest.
 *
 * Court lines (0317) is a STYLE, not a frame: any free frame can be drawn
 * solid or as court lines (its rings as dashes); earned frames are always
 * solid. The profile stores it beside the id (`avatar_frame_style`).
 *
 * Geometry: every frame keeps the avatar's outer size; rings are drawn inward
 * from the edge, outermost first. Widths are fixed at 36, 50 and 84 px and
 * interpolated (to 0.5 px) between them.
 */
import type { MessageKey } from '@touch/i18n';

export const FRAME_IDS = [
  'brand-green',
  'touch-blue',
  'court-white',
  'split-court',
  'double-line',
  'regular',
  'silver-racket',
  'gold-racket',
  'champion',
] as const;
export type FrameId = (typeof FRAME_IDS)[number];

export const DEFAULT_FRAME: FrameId = 'brand-green';
export const FREE_FRAMES: readonly FrameId[] = FRAME_IDS.slice(0, 5);
export const EARNED_FRAMES: readonly FrameId[] = FRAME_IDS.slice(5);

/** 0317: how a frame is drawn. `lines` = court lines, free frames only. */
export const FRAME_STYLES = ['solid', 'lines'] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number];

/** An id from the server or the cache; anything unknown draws as the default. */
export function frameOf(id: string | null | undefined): FrameId {
  return (FRAME_IDS as readonly string[]).includes(id ?? '') ? (id as FrameId) : DEFAULT_FRAME;
}

export function isEarnedFrame(id: FrameId): boolean {
  return EARNED_FRAMES.includes(id);
}

/**
 * The style `frame` is drawn in: `lines` only when stored as such AND the
 * frame can take it, so an earned frame never draws dashed.
 */
export function frameStyleOf(frame: FrameId, style: string | null | undefined): FrameStyle {
  return style === 'lines' && !isEarnedFrame(frame) ? 'lines' : 'solid';
}

const camel = (id: string) => id.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());

/** profile.frameBrandGreen … */
export function frameNameKey(id: FrameId): MessageKey {
  return `profile.frame${camel(id)}` as MessageKey;
}

/** profile.frameRuleRegular … (earned frames only). */
export function frameRuleKey(id: FrameId): MessageKey | null {
  return isEarnedFrame(id) ? (`profile.frameRule${camel(id)}` as MessageKey) : null;
}

/** Width tables at 36 / 50 / 84 px, from the design spec. */
type Steps = readonly [number, number, number];
const SINGLE: Steps = [2.5, 2.5, 3];
const EARNED: Steps = [3.5, 4, 5];
const KEY: Steps = [1, 1, 1.5];
const HAIR: Steps = [1, 1, 1];
const OUTER: Steps = [2, 2.5, 3];
const INNER: Steps = [2, 2, 3];
const BADGE: Steps = [14, 16, 24];

/** A width for `size`, fixed at 36/50/84 and interpolated between, rounded to 0.5. */
export function step(t: Steps, size: number): number {
  if (size <= 36) return t[0];
  if (size >= 84) return t[2];
  const [a, b, lo, hi] = size < 50 ? [36, 50, t[0], t[1]] : [50, 84, t[1], t[2]];
  return Math.round((lo + ((hi - lo) * (size - a)) / (b - a)) * 2) / 2;
}

/** One ring: a colour, or a named gradient. */
export type Paint =
  | { kind: 'solid'; color: ColorName }
  | { kind: 'metal'; metal: 'gold' | 'silver' };

/** Colour names resolved by the renderer from `brand` and `frame` tokens. */
export type ColorName = 'green' | 'blue' | 'navy' | 'white';

export interface Ring {
  width: number;
  paint: Paint;
  /** Court lines: dashes, n of them, 62% on, one centred at the top. */
  dashes?: number;
  /** Half and half: the bottom half in this colour (top half is `paint`); with dashes, each half's dashes. */
  bottom?: ColorName;
}

export interface FrameDrawing {
  /** Outermost first. */
  rings: Ring[];
  /** The total width of the rings: the photo sits inside it. */
  inset: number;
  badge: { size: number; fill: Paint; glyph: 'racket' | 'trophy'; ink: ColorName } | null;
}

const solid = (color: ColorName): Paint => ({ kind: 'solid', color });

/**
 * How `id` is drawn on an avatar of `size` px. In the `lines` style every ring
 * of a free frame is dashed with the same count, so stacked rings dash
 * together as one band.
 */
export function frameDrawing(id: FrameId, size: number, style: FrameStyle = 'solid'): FrameDrawing {
  const w = (t: Steps) => step(t, size);
  let rings: Ring[];
  let badge: FrameDrawing['badge'] = null;
  const b = (fill: Paint, glyph: 'racket' | 'trophy', ink: ColorName) => ({ size: w(BADGE), fill, glyph, ink });
  switch (id) {
    case 'brand-green':
      rings = [{ width: w(SINGLE), paint: solid('green') }];
      break;
    case 'touch-blue':
      rings = [{ width: w(SINGLE), paint: solid('blue') }, { width: w(KEY), paint: solid('white') }];
      break;
    case 'court-white':
      rings = [{ width: w(HAIR), paint: solid('navy') }, { width: w(SINGLE), paint: solid('white') }];
      break;
    case 'split-court':
      rings = [
        { width: w(SINGLE), paint: solid('green'), bottom: 'blue' },
        { width: w(KEY), paint: solid('white') },
      ];
      break;
    case 'double-line':
      rings = [{ width: w(OUTER), paint: solid('blue') }, { width: w(INNER), paint: solid('green') }];
      break;
    case 'regular':
      rings = [{ width: w(EARNED), paint: solid('green') }];
      badge = b(solid('green'), 'racket', 'navy');
      break;
    case 'silver-racket':
      rings = [{ width: w(HAIR), paint: solid('navy') }, { width: w(EARNED), paint: { kind: 'metal', metal: 'silver' } }];
      badge = b({ kind: 'metal', metal: 'silver' }, 'racket', 'navy');
      break;
    case 'gold-racket':
      rings = [{ width: w(HAIR), paint: solid('navy') }, { width: w(EARNED), paint: { kind: 'metal', metal: 'gold' } }];
      badge = b({ kind: 'metal', metal: 'gold' }, 'racket', 'navy');
      break;
    case 'champion':
      rings = [
        { width: w(HAIR), paint: solid('navy') },
        { width: w(EARNED), paint: { kind: 'metal', metal: 'gold' } },
        { width: w(KEY), paint: solid('green') },
      ];
      badge = b(solid('navy'), 'trophy', 'navy');
      break;
  }
  if (frameStyleOf(id, style) === 'lines') {
    const dashes = size >= 60 ? 12 : 8;
    rings = rings.map((r) => ({ ...r, dashes }));
  }
  return { rings, inset: rings.reduce((sum, r) => sum + r.width, 0), badge };
}

/**
 * Where the badge's centre sits: on the ring band at the bottom END corner
 * (bottom right in English, bottom left in Arabic), kept inside the box.
 */
export function badgeCentre(size: number, inset: number, badge: number, rtl: boolean) {
  const c = size / 2;
  const off = (c - inset / 2) * Math.SQRT1_2;
  const clamp = (v: number) => Math.min(Math.max(v, badge / 2), size - badge / 2);
  return { x: clamp(c + (rtl ? -off : off)), y: clamp(c + off) };
}
