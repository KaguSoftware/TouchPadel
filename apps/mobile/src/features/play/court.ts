/**
 * What the Play tab's court shows (packages/court3d join.ts; Majed, 2026-10-12:
 * the court is the next open match, its open spots tappable, its taken seats
 * warming up). PURE (vitest).
 *
 * The court follows the list under it: the same nights, already narrowed by the
 * kind and category chips (`playNights`), so a spot never leads to a match the
 * list is hiding. It claims a seat COUNT only, the one the match card shows
 * (`seatsTaken`, or four less the seats left for a signed-out guest's
 * `match_slots` row), and never who.
 *
 *   · `match`: the first match or time on the timeline with a seat still open
 *     and a start still ahead, the guest's own included (Majed, 2026-10-12).
 *   · `none`: the matches are in and none has a seat: four open spots, and the
 *     caption offers to start one.
 *   · `loading`: an empty court until the matches are in; nothing is claimed.
 *   · `quiet`: matches are off, banned, failed to load, or filtered out (the
 *     Tournaments chip): four rackets warm up, no spot, no caption. Decoration
 *     that claims nothing.
 */
import { SEATS_TOTAL } from '../matches/logic';
import type { PlayKind, PlayNight } from './timeline';

export interface CourtMatch {
  /** The entry's list key (`play.match.<key>` / `play.slot.<key>`), and where it sits. */
  key: string;
  kind: 'match' | 'slot';
  startAt: string;
  seatsTaken: number;
  seatsLeft: number;
  /** The guest is seated in it (signed in only). */
  mine: boolean;
  sectionIndex: number;
  itemIndex: number;
}

export type PlayCourt =
  | { show: 'match'; taken: number; spots: true; match: CourtMatch }
  | { show: 'none'; taken: 0; spots: true }
  | { show: 'loading'; taken: 0; spots: false }
  | { show: 'quiet'; taken: 4; spots: false };

const clampSeats = (n: number) => Math.max(0, Math.min(SEATS_TOTAL, Math.floor(n)));

/** The first match on the timeline with a seat open and a start after `nowMs`. */
export function nextOpenSeat(nights: readonly PlayNight[], nowMs: number): CourtMatch | null {
  for (let s = 0; s < nights.length; s++) {
    const entries = nights[s]!.entries;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.kind === 'tournament') continue;
      const start = Date.parse(e.startAt);
      if (!Number.isFinite(start) || start <= nowMs) continue;
      const seatsLeft = e.kind === 'match' ? e.match.seatsLeft : e.slot.seatsLeft;
      if (seatsLeft <= 0) continue;
      const seatsTaken = e.kind === 'match' ? e.match.seatsTaken : SEATS_TOTAL - e.slot.seatsLeft;
      return {
        key: e.key,
        kind: e.kind,
        startAt: e.startAt,
        seatsTaken: clampSeats(seatsTaken),
        seatsLeft,
        mine: e.kind === 'match' && e.match.mine === 'seated',
        sectionIndex: s,
        itemIndex: i,
      };
    }
  }
  return null;
}

export function playCourt(args: {
  /** The matches' source state, as the screen has it. */
  matches: 'loading' | 'error' | 'off' | 'ready';
  kind: PlayKind;
  nights: readonly PlayNight[];
  nowMs: number;
}): PlayCourt {
  if (args.kind === 'tournaments' || args.matches === 'off' || args.matches === 'error') {
    return { show: 'quiet', taken: 4, spots: false };
  }
  if (args.matches === 'loading') return { show: 'loading', taken: 0, spots: false };
  const match = nextOpenSeat(args.nights, args.nowMs);
  if (!match) return { show: 'none', taken: 0, spots: true };
  return { show: 'match', taken: match.seatsTaken, spots: true, match };
}
