// The colours an owner can give a loyalty tier (0376, 0416). A closed list: loyalty_tiers.color
// is CHECKed against the same keys, the operator's tier editor offers them as swatches, and the
// phone's points card takes its lines, its tier word and the holder's name from the tier's one.
//
// 0416 (Majed, 2026-11-13): the club's cards are four, in this order from the starter card up:
// white, Touch Padel green, Touch Padel blue, black (CARD_LADDER). The metals from 0376 stay valid
// so a tier already saved in one still draws, but the operator offers only the four.

/** The club's four cards, from the starter card (the base tier) up. */
export const CARD_LADDER = ['white', 'green', 'blue', 'black'] as const;

/** Before 0416. Still accepted and drawn, no longer offered. */
export const LEGACY_TIER_COLORS = ['classic', 'bronze', 'silver', 'gold', 'platinum'] as const;

export const TIER_COLORS = [...CARD_LADDER, ...LEGACY_TIER_COLORS] as const;

export type TierColor = (typeof TIER_COLORS)[number];

/** Every tier made before 0376, and any value a client does not know, reads as this. */
export const DEFAULT_TIER_COLOR: TierColor = 'classic';

/**
 * The colour itself, as the owner's swatch shows it and as the card's lines and tier word are
 * drawn: `classic` is Padel Green, the card as it always was, and `green` the same green. `blue`
 * is the brand blue. `black` is the card's ground, not an ink: a black tier is a black card (the
 * phone's tier finish draws it).
 */
export const TIER_SWATCH: Record<TierColor, string> = {
  white: '#FFFFFF',
  green: '#A5D06F',
  blue: '#3360AB',
  black: '#141416',
  classic: '#A5D06F',
  bronze: '#D99A6C',
  silver: '#E0E0E1',
  gold: '#E9BF72',
  platinum: '#D8ECFF',
};

/** A ground in this colour needs light ink (the blue and the black card); the rest take dark. */
export function tierWantsLightInk(color: TierColor): boolean {
  return color === 'blue' || color === 'black';
}

export function isTierColor(v: unknown): v is TierColor {
  return typeof v === 'string' && (TIER_COLORS as readonly string[]).includes(v);
}

/** A tier's colour as an answer carries it; anything unknown is the classic card. */
export function tierColor(v: unknown): TierColor {
  return isTierColor(v) ? v : DEFAULT_TIER_COLOR;
}

/**
 * The colours the tier editor offers: the four cards, and the tier's own colour as well when it
 * is a legacy one, so the owner sees what it has and can move it onto a card.
 */
export function offeredTierColors(current: TierColor | null | undefined): readonly TierColor[] {
  return current && !(CARD_LADDER as readonly string[]).includes(current)
    ? [...CARD_LADDER, current]
    : CARD_LADDER;
}
