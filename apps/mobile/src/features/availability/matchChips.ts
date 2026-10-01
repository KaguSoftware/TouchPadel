/**
 * Open matches on the Book tab (docs/design/open-matches/guest.md §4.11), the
 * words and the routing, in PURE code (vitest). The placement rules — which
 * cell carries a chip, which buttons the choice offers — are
 * features/matches/logic.ts's (`chipCellKeys`, `slotActions`); this file turns
 * them into what the sheet shows and where a tap goes.
 *
 * Nothing here is an input of the day grid (rule 2): the chips are a
 * `Map<chipKey, string>` built beside it from the lanes and the `match_slots`
 * answer, and read cell by cell as a plain string (rule 4).
 */
import { countPhrase, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import {
  SEATS_TOTAL,
  chipCellKeys,
  chipKey,
  seatsOfLabel,
  type ChipLane,
  type OpenMatch,
  type SlotAction,
  type SlotMatch,
} from '../matches/logic';

type T = (key: MessageKey, params?: TParams) => string;

/** A match at that minute a guest could still take a seat in. */
const joinable = (m: Pick<SlotMatch, 'mine' | 'seatsLeft'>): boolean => !m.mine && m.seatsLeft > 0;

/**
 * One chip's words (§4.11 rule 5): the guest's own match first ("Your match ·
 * 3/4"), then several matches at one time ("2 open matches"), then the one
 * match by its category ("1 seat left · Join", "Women · 2 seats left"). Empty
 * for no match.
 */
export function chipLineOf(matches: readonly SlotMatch[], t: T, locale: Locale): string {
  if (matches.length === 0) return '';
  const mine = matches.find((m) => m.mine);
  if (mine)
    return t('matches.book.chipMine', { taken: seatsOfLabel(SEATS_TOTAL - mine.seatsLeft, t) });
  if (matches.length > 1) return countPhrase('matches.count.openMatches', matches.length, locale);
  const only = matches[0]!;
  const seats = countPhrase('matches.count.seatsLeft', only.seatsLeft, locale);
  if (only.seatsLeft === 0) return seats;
  switch (only.category) {
    case 'women':
      return t('matches.book.chipWomen', { seats });
    case 'men':
      return t('matches.book.chipMen', { seats });
    default:
      return t('matches.book.chipJoin', { seats });
  }
}

/**
 * Every chip on the night, keyed `chipKey(courtId, epochMs)`: one per time, on
 * the first free lane cell at that minute (`chipCellKeys`). Built once per
 * lanes, answer and language, so a cell's read is a lookup.
 */
export function chipLines(
  lanes: readonly ChipLane[],
  byStart: ReadonlyMap<number, readonly SlotMatch[]>,
  t: T,
  locale: Locale,
): Map<string, string> {
  const out = new Map<string, string>();
  if (byStart.size === 0) return out;
  const keys = chipCellKeys(lanes, byStart);
  for (const lane of lanes) {
    for (const cell of lane.cells) {
      const ms = cell.startAt.getTime();
      const key = chipKey(lane.courtId, ms);
      if (!keys.has(key)) continue;
      const line = chipLineOf(byStart.get(ms) ?? [], t, locale);
      if (line) out.set(key, line);
    }
  }
  return out;
}

/** A choice-sheet button: the action and its words. */
export interface SlotChoiceOption {
  value: SlotAction;
  label: string;
}

/**
 * The choice sheet's buttons, in `slotActions`' order. "Join" names the seats
 * of the one joinable match, or the number of matches when several are, since
 * that tap then opens the list at that time.
 */
export function slotChoiceOptions(
  actions: readonly SlotAction[],
  matches: readonly SlotMatch[],
  t: T,
  locale: Locale,
): SlotChoiceOption[] {
  return actions.map((value) => ({ value, label: slotChoiceLabel(value, matches, t, locale) }));
}

function slotChoiceLabel(
  action: SlotAction,
  matches: readonly SlotMatch[],
  t: T,
  locale: Locale,
): string {
  switch (action) {
    case 'view-mine':
      return t('matches.book.viewMine');
    case 'join': {
      const open = matches.filter(joinable);
      return open.length > 1
        ? t('matches.book.joinSeveral', {
            matches: countPhrase('matches.count.openMatches', open.length, locale),
          })
        : t('matches.book.join', {
            seats: countPhrase('matches.count.seatsLeft', open[0]?.seatsLeft ?? 0, locale),
          });
    }
    case 'book':
      return t('matches.book.bookCourt');
    case 'start':
      return t('matches.book.start');
  }
}

/**
 * Where "Join" or "Your open match" lands (§4.11), from the `open_matches`
 * read of that one minute (`match_slots` carries no ids): the one match it
 * means, the list at that time when several fit (or the one the chip meant
 * has changed hands), or null when nothing is there any more.
 */
export function matchTargetOf(
  action: 'join' | 'view-mine',
  found: readonly OpenMatch[],
): { matchId: string } | 'list' | null {
  const fits =
    action === 'view-mine'
      ? found.filter((m) => m.mine !== null)
      : found.filter((m) => m.mine === null && m.seatsLeft > 0);
  if (fits.length === 1) return { matchId: fits[0]!.matchId };
  return found.length > 0 ? 'list' : null;
}

/** Matches still to start that the guest could join: the entry row's count. */
export function joinableAhead(
  byStart: ReadonlyMap<number, readonly SlotMatch[]>,
  nowMs: number,
): number {
  let n = 0;
  for (const [ms, list] of byStart) {
    if (ms <= nowMs) continue;
    for (const m of list) if (joinable(m)) n++;
  }
  return n;
}

/**
 * The entry row's words (§4.11): signed out "Open matches · Sign in";
 * signed in "3 open matches coming up · Join", or "Open matches" with none.
 */
export function entryLabelOf(
  args: { signedIn: boolean; joinable: number },
  t: T,
  locale: Locale,
): string {
  if (!args.signedIn) return t('matches.book.entrySignIn');
  if (args.joinable === 0) return t('matches.book.entry');
  return t('matches.book.entryJoin', {
    matches: countPhrase('matches.count.openMatchesSoon', args.joinable, locale),
  });
}
