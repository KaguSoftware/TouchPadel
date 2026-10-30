/**
 * The Play tab's one timeline (docs/design/play-coaches/contracts-2026-10-11.md
 * §7): open matches and tournaments in sections by trading night, interleaved
 * by start time, narrowed by the kind chips and (matches only) the category. PURE (vitest).
 *
 * Three sources, one shape. A signed-in guest's matches are `open_matches`
 * rows (ids, the share at the desk, their own state); a signed-out guest has no
 * `open_matches` (it is granted to `authenticated` only) and browses the
 * `match_slots` answer instead (times, category, seats; no ids, names or
 * money), which the Book tab's chips already read signed out. Tournaments are
 * `tournaments_public(null)`'s upcoming rows (`tournamentRows(…, 'upcoming')`),
 * every live branch's.
 *
 * Nothing here filters out what the server sent beyond the chips: a match with
 * no seat left is kept (the card says so), except a `match_slots` row with no
 * seat left, which a signed-out guest could do nothing with.
 */
import type { MatchCategory, OpenMatch, SlotMatch } from '../matches/logic';
import type { TourListItem } from '../tournaments/logic';

/** The kind chips. */
export const PLAY_KINDS = ['all', 'matches', 'tournaments'] as const;
export type PlayKind = (typeof PLAY_KINDS)[number];

/**
 * The category chips (the matches list's), applied to matches only: a tournament
 * is for one gender (women's or men's), so a gender filter over it says nothing.
 */
export type PlayCategory = 'all' | MatchCategory;

export type PlayEntry =
  | { kind: 'match'; key: string; startAt: string; match: OpenMatch }
  | { kind: 'slot'; key: string; startAt: string; slot: SlotMatch }
  | { kind: 'tournament'; key: string; startAt: string; tournament: TourListItem };

export interface PlayNight {
  /** The trading night, `YYYY-MM-DD` (`tradingNightOf`). */
  key: string;
  entries: PlayEntry[];
  /** How many of `entries` are matches (signed in or out) and how many tournaments. */
  matches: number;
  tournaments: number;
}

/** The `show` param a route opened with (`/play?show=tournaments`). Anything else is All. */
export function showFromParam(raw: unknown): PlayKind {
  return raw === 'matches' || raw === 'tournaments' ? raw : 'all';
}

const ms = (iso: string): number => {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/** A tournament first at a shared minute (it is the bigger event), then a stable key. */
const RANK: Record<PlayEntry['kind'], number> = { tournament: 0, match: 1, slot: 1 };

function compare(a: PlayEntry, b: PlayEntry): number {
  const d = ms(a.startAt) - ms(b.startAt);
  if (d !== 0) return d;
  const r = RANK[a.kind] - RANK[b.kind];
  if (r !== 0) return r;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The nights, soonest first, each with its entries in start order.
 *
 * `nightOf` is the branch's `tradingNightOf` (a 00:30 start belongs to the
 * night before); `today` is tonight's night. A tournament still in play from
 * an earlier night (status `running`) is drawn under tonight rather than
 * under a date that has gone.
 */
export function playNights(args: {
  matches: readonly OpenMatch[];
  slots: readonly SlotMatch[];
  tournaments: readonly TourListItem[];
  kind: PlayKind;
  category: PlayCategory;
  nightOf: (startAt: string) => string;
  today: string;
}): PlayNight[] {
  const fits = (c: MatchCategory) => args.category === 'all' || c === args.category;
  const entries: PlayEntry[] = [];
  if (args.kind !== 'tournaments') {
    for (const m of args.matches) {
      if (fits(m.category)) entries.push({ kind: 'match', key: m.matchId, startAt: m.startAt, match: m });
    }
    // `match_slots` has no ids: several matches at one minute are told apart by
    // order, as `<epoch ms>-<n>` (testID-safe: the screen appends it to `play.slot.`).
    const seen = new Map<number, number>();
    for (const s of args.slots) {
      if (s.seatsLeft <= 0 || !fits(s.category)) continue;
      const at = ms(s.startAt);
      const n = seen.get(at) ?? 0;
      seen.set(at, n + 1);
      entries.push({ kind: 'slot', key: `${at}-${n}`, startAt: s.startAt, slot: s });
    }
  }
  if (args.kind !== 'matches') {
    for (const t of args.tournaments) {
      entries.push({ kind: 'tournament', key: t.id, startAt: t.startsAt, tournament: t });
    }
  }
  entries.sort(compare);

  const nights = new Map<string, PlayNight>();
  for (const e of entries) {
    const own = args.nightOf(e.startAt);
    const key = e.kind === 'tournament' && own < args.today ? args.today : own;
    let night = nights.get(key);
    if (!night) {
      night = { key, entries: [], matches: 0, tournaments: 0 };
      nights.set(key, night);
    }
    night.entries.push(e);
    if (e.kind === 'tournament') night.tournaments++;
    else night.matches++;
  }
  // Clamping can file a tournament under an earlier key than its neighbours: sort the nights too.
  return [...nights.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The entry is the time the guest came for (`at`): a match, signed in or out, at that minute. */
export function isAtEntry(entry: PlayEntry, atMs: number): boolean {
  return Number.isFinite(atMs) && entry.kind !== 'tournament' && ms(entry.startAt) === atMs;
}

/**
 * Where the list scrolls once it has rows: the first match at `at`, else the
 * night `date` names. Null when neither is there (yet).
 */
export function playScrollTarget(
  nights: readonly PlayNight[],
  want: { atMs: number; date: string | null },
): { sectionIndex: number; itemIndex: number } | null {
  if (Number.isFinite(want.atMs)) {
    for (let s = 0; s < nights.length; s++) {
      const i = nights[s]!.entries.findIndex((e) => isAtEntry(e, want.atMs));
      if (i >= 0) return { sectionIndex: s, itemIndex: i };
    }
    return null;
  }
  if (want.date) {
    const s = nights.findIndex((n) => n.key === want.date);
    return s >= 0 ? { sectionIndex: s, itemIndex: 0 } : null;
  }
  return null;
}
