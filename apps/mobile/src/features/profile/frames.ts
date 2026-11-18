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
 * Card rings (0445): three more frames a loyalty card unlocks (a `frame`
 * privilege the owner sets on a tier). Solid only, like the earned ones, and
 * drawn richer than both: a woven metal band in the card's own colour, a fine
 * shade line outside it, a bright key line inside, and a small card badge.
 * `app.my_frames` names the lowest card that unlocks each; a ring no card
 * unlocks is not on offer (`offeredCardFrames`).
 *
 * Geometry: every frame keeps the avatar's outer size; rings are drawn inward
 * from the edge, outermost first. Widths are fixed at 36, 50 and 84 px and
 * interpolated (to 0.5 px) between them.
 */
import type { MessageKey } from '@touch/i18n';
import { tierColor, type TierColor } from '@touch/core/loyalty';

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
  'card-green',
  'card-blue',
  'card-black',
] as const;
export type FrameId = (typeof FRAME_IDS)[number];

export const DEFAULT_FRAME: FrameId = 'brand-green';
export const FREE_FRAMES: readonly FrameId[] = FRAME_IDS.slice(0, 5);
export const EARNED_FRAMES: readonly FrameId[] = FRAME_IDS.slice(5, 9);
/** 0445: the rings a loyalty card unlocks. */
export const CARD_FRAMES: readonly FrameId[] = FRAME_IDS.slice(9);

/** The colour family of a card ring, resolved by the renderer from `cardRing` tokens. */
export type CardTone = 'green' | 'blue' | 'black';

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

export function isCardFrame(id: FrameId): boolean {
  return CARD_FRAMES.includes(id);
}

/** The tone of a card ring; null for every other frame. */
export function cardToneOf(id: FrameId): CardTone | null {
  return id === 'card-green' ? 'green' : id === 'card-blue' ? 'blue' : id === 'card-black' ? 'black' : null;
}

/**
 * The style `frame` is drawn in: `lines` only when stored as such AND the
 * frame can take it, so an earned frame or a card ring never draws dashed.
 */
export function frameStyleOf(frame: FrameId, style: string | null | undefined): FrameStyle {
  return style === 'lines' && FREE_FRAMES.includes(frame) ? 'lines' : 'solid';
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
/** 0445: a card ring's woven band, a touch wider than an earned ring. */
const CARD_BAND: Steps = [4, 5, 6.5];

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
  | { kind: 'metal'; metal: 'gold' | 'silver' }
  /** 0445: a card ring's paints: `band` the metal sheen, `shade` and `hi` its two edge lines. */
  | { kind: 'card'; tone: CardTone; part: 'band' | 'shade' | 'hi' };

/** Colour names resolved by the renderer from `brand` and `frame` tokens. */
export type ColorName = 'green' | 'blue' | 'navy' | 'white';

export interface Ring {
  width: number;
  paint: Paint;
  /** Court lines: dashes, n of them, 62% on, one centred at the top. */
  dashes?: number;
  /** Half and half: the bottom half in this colour (top half is `paint`); with dashes, each half's dashes. */
  bottom?: ColorName;
  /**
   * 0445: a woven band. The ring is split into an outer and an inner half,
   * each laid with `weave` light cells round the circle, the inner half's
   * cells offset by half a cell, so the two read as a basket weave.
   */
  weave?: number;
}

export interface FrameDrawing {
  /** Outermost first. */
  rings: Ring[];
  /** The total width of the rings: the photo sits inside it. */
  inset: number;
  badge: { size: number; fill: Paint; glyph: 'racket' | 'trophy' | 'card'; ink: ColorName } | null;
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
  const b = (fill: Paint, glyph: 'racket' | 'trophy' | 'card', ink: ColorName) => ({ size: w(BADGE), fill, glyph, ink });
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
    case 'card-green':
    case 'card-blue':
    case 'card-black': {
      const tone = cardToneOf(id) as CardTone;
      const card = (part: 'band' | 'shade' | 'hi'): Paint => ({ kind: 'card', tone, part });
      rings = [
        { width: w(HAIR), paint: card('shade') },
        { width: w(CARD_BAND), paint: card('band'), weave: size >= 60 ? 40 : 28 },
        { width: w(HAIR), paint: card('hi') },
      ];
      // The light green card carries navy ink; the blue and the black carry white.
      badge = b(card('band'), 'card', tone === 'green' ? 'navy' : 'white');
      break;
    }
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

/** The card that unlocks a card ring, as `app.my_frames` names it (0445). */
export interface FrameCard {
  tier_id: string;
  name_en: string;
  name_ar: string;
  color: TierColor;
}

/** A card ring on offer in the picker: the card that unlocks it, and whether the guest's does. */
export interface CardFrameOffer {
  id: FrameId;
  unlocked: boolean;
  card: FrameCard;
}

/**
 * The card rings the picker offers (0445), in the closed list's order, read from
 * `app.my_frames().frames`. A ring whose `card` is null is unlocked by no card
 * (the owner has not put it on one), so it is not offered at all; one whose card
 * is unreadable is left out the same way. A server before 0445 sends no card
 * rings, so this is empty and the picker shows no card section.
 */
export function offeredCardFrames(frames: readonly unknown[] | null | undefined): CardFrameOffer[] {
  const out: CardFrameOffer[] = [];
  for (const raw of frames ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as { id?: unknown; unlocked?: unknown; card?: unknown };
    const id = typeof f.id === 'string' ? f.id : '';
    if (!(CARD_FRAMES as readonly string[]).includes(id)) continue;
    const c = f.card && typeof f.card === 'object' ? (f.card as Record<string, unknown>) : null;
    if (!c || typeof c.tier_id !== 'string' || !c.tier_id) continue;
    const name_en = typeof c.name_en === 'string' ? c.name_en : '';
    const name_ar = typeof c.name_ar === 'string' ? c.name_ar : '';
    out.push({
      id: id as FrameId,
      unlocked: f.unlocked === true,
      card: { tier_id: c.tier_id, name_en, name_ar, color: tierColor(c.color) },
    });
  }
  return out.sort((a, b) => FRAME_IDS.indexOf(a.id) - FRAME_IDS.indexOf(b.id));
}
