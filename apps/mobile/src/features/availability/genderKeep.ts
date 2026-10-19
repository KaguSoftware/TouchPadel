/**
 * Gender hours on the Book tab and the new-match form (migration 0353, Majed
 * 2026-10-19: some courts are kept for women at set times, and some hours are
 * kept on every court). PURE (vitest): the clock rules are @touch/core's
 * `slotGenderRules`, the mirror of the server's `app.slot_gender_rules`, and
 * the server's triggers stay the authority.
 *
 * A free time a rule keeps carries `kept` and a tag ("Women only" / "Men
 * only"). Who sees what:
 *
 *   signed out          the tag only; the time stays free (signing in decides).
 *   kept for them       free as before, with the tag.
 *   kept for the other  shown as taken ('booked': greyed, not tappable), the
 *                       tag in place of the price saying why.
 *   no gender yet       free, with the tag: a tap meets the booking gate,
 *                       which sends them to complete-profile first.
 *   kept for both       (two rules disagree) taken for everyone, "Not bookable".
 *
 * A cell no rule touches is returned as the SAME object, so the memoised
 * SlotCell skips it as before.
 */
import {
  genderVerdict,
  keptFor,
  matchCategoryFor,
  slotGenderRules,
  type Gender,
  type GenderRuleLike,
} from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import type { MergedCell } from './assemble';

export interface KeptCell extends MergedCell {
  /** The genders a rule keeps this time for (sorted); absent when none. */
  kept?: readonly Gender[];
  /** Shown as taken for this guest because of the rule. */
  keptOut?: boolean;
}

export interface KeepContext {
  rules: readonly GenderRuleLike[] | undefined;
  tz: string;
  durationMin: number;
  /** Signed in with an account (not browsing, not an anonymous session). */
  signedIn: boolean;
  /** The guest's gender: null when never answered, undefined while not known. */
  gender: Gender | null | undefined;
}

/** One lane's cells (one court) with the gender hours applied. */
export function keepCells(
  cells: readonly MergedCell[],
  courtId: string,
  ctx: KeepContext,
): MergedCell[] {
  const rules = ctx.rules ?? [];
  if (rules.length === 0) return cells as MergedCell[];
  let changed = false;
  const out = cells.map((cell): MergedCell => {
    if (cell.state !== 'free') return cell;
    const end = new Date(cell.startAt.getTime() + ctx.durationMin * 60_000);
    const kept = slotGenderRules(rules, courtId, cell.startAt, end, ctx.tz);
    if (kept.length === 0) return cell;
    changed = true;
    const out =
      keptFor(kept) === 'both' ||
      (ctx.signedIn && genderVerdict(kept, ctx.gender) === 'restricted');
    const next: KeptCell = out
      ? { ...cell, kept, keptOut: true, state: 'booked', freeCount: 0 }
      : { ...cell, kept };
    return next;
  });
  return changed ? out : (cells as MergedCell[]);
}

/** Every lane, each against its own court; the same array when no rule exists. */
export function keepLanes<L extends { courtId: string; cells: MergedCell[] }>(
  lanes: readonly L[],
  ctx: KeepContext,
): L[] {
  if ((ctx.rules ?? []).length === 0) return lanes as L[];
  return lanes.map((lane) => {
    const cells = keepCells(lane.cells, lane.courtId, ctx);
    return cells === lane.cells ? lane : { ...lane, cells };
  });
}

/** The tag a cell carries, or null for a time no rule keeps. */
export function keptTagKey(cell: MergedCell): MessageKey | null {
  const kept = (cell as KeptCell).kept;
  if (!kept || kept.length === 0) return null;
  const one = keptFor(kept);
  if (one === 'female') return 'matches.common.categoryWomen';
  if (one === 'male') return 'matches.common.categoryMen';
  return 'guestGender.tagBoth';
}

/** Shown as taken because of a rule (the tag then stands in for the price). */
export function isKeptOut(cell: MergedCell): boolean {
  return (cell as KeptCell).keptOut === true;
}

export type MatchKeep =
  | { kind: 'open' }
  /** The match must be this category; the guest may start it. */
  | { kind: 'locked'; category: 'women' | 'men'; noteKey: MessageKey }
  /** No match the guest can start fits this time. */
  | { kind: 'closed'; noteKey: MessageKey };

/**
 * An open match touching a kept window at the branch, ANY court (the match
 * takes its court late, so the server judges it against all of them): it must
 * be that gender's match. `offered` is the quote's categories, which already
 * leave out the ones the guest cannot play.
 */
export function matchKeepOf(
  rules: readonly GenderRuleLike[] | undefined,
  startAt: Date,
  durationMin: number,
  tz: string,
  offered: readonly string[],
): MatchKeep {
  if (!rules || rules.length === 0 || !(durationMin > 0)) return { kind: 'open' };
  const end = new Date(startAt.getTime() + durationMin * 60_000);
  const kept = slotGenderRules(rules, null, startAt, end, tz);
  if (kept.length === 0) return { kind: 'open' };
  const category = matchCategoryFor(kept);
  if (category === null) return { kind: 'closed', noteKey: 'guestGender.match.closedBoth' };
  if (!offered.includes(category)) {
    return {
      kind: 'closed',
      noteKey: category === 'women' ? 'guestGender.match.closedWomen' : 'guestGender.match.closedMen',
    };
  }
  return {
    kind: 'locked',
    category,
    noteKey: category === 'women' ? 'guestGender.match.lockedWomen' : 'guestGender.match.lockedMen',
  };
}
