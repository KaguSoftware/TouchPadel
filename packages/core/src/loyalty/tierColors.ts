// The colours an owner can give a loyalty tier (0376). A closed list: loyalty_tiers.color is
// CHECKed against the same keys, the operator's tier editor offers them as swatches, and the
// phone's points card takes its lines, its tier word and the holder's name from the tier's one.

export const TIER_COLORS = ['classic', 'bronze', 'silver', 'gold', 'platinum', 'black'] as const;

export type TierColor = (typeof TIER_COLORS)[number];

/** Every tier made before 0376, and any value a client does not know, reads as this. */
export const DEFAULT_TIER_COLOR: TierColor = 'classic';

/**
 * The colour itself, as the owner's swatch shows it and as the card's lines and tier word are
 * drawn: `classic` is Padel Green, the card as it always was. `black` is the card's ground, not
 * an ink: a black tier is a black card (the phone's tier finish draws it).
 */
export const TIER_SWATCH: Record<TierColor, string> = {
  classic: '#A5D06F',
  bronze: '#D99A6C',
  silver: '#E0E0E1',
  gold: '#E9BF72',
  platinum: '#D8ECFF',
  black: '#141416',
};

export function isTierColor(v: unknown): v is TierColor {
  return typeof v === 'string' && (TIER_COLORS as readonly string[]).includes(v);
}

/** A tier's colour as an answer carries it; anything unknown is the classic card. */
export function tierColor(v: unknown): TierColor {
  return isTierColor(v) ? v : DEFAULT_TIER_COLOR;
}
