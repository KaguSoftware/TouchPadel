/**
 * `/analytics/people` — the owner's People read (app.analytics_customers,
 * migration 0369; docs/design/customers/contracts-2026-10-24.md §2).
 *
 * Majed, 2026-10-24: "the analytics currently shows a lot of numbers ... but
 * there is nothing that shows exactly who our customers are." This module
 * parses that one payload and nothing else: the page prints the server's
 * figures, never a figure of its own (DESIGN.md, strategic principle 3).
 *
 * PURE (no React, no network), so vitest runs it under node.
 */

/** The buckets, in the order every card prints them. `unknown` always last. */
export const GENDER_ORDER = ['female', 'male', 'unknown'] as const;
export const AGE_ORDER = ['u18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'unknown'] as const;
export const LEVEL_ORDER = ['new', 'beginner', 'intermediate', 'advanced', 'unknown'] as const;
/** The derived interest tags (0368), in the server's own order. */
export const INTEREST_ORDER = [
  'courts',
  'matches',
  'tournaments',
  'lessons',
  'cafe',
  'shop',
  'regular',
  'weekend',
  'evenings',
  'daytime',
  'late',
  'group',
  'offers',
  'ranked',
] as const;

export interface PeopleBucket {
  bucket: string;
  guests: number;
  plays: number;
  bookings: number;
  spendIqd: number;
  /** Whole percent of the crowd, as the server rounded it. */
  share: number | null;
  /** Levels only: how many of the bucket a coach or the desk judged. */
  judged: number;
}

export interface PeopleKnown {
  guests: number;
  withGenders: number;
  withAges: number;
  withLevels: number;
  judgedLevels: number;
  plays: number;
  bookings: number;
  spendIqd: number;
  /** How many have gender, age AND level, as a whole percent; null with nobody in the range. */
  coveragePct: number | null;
  newGuests: number;
  returningGuests: number;
}

export interface PeopleJudged {
  checked: number;
  agree: number;
  /** Claimed above what the club judged. */
  higher: number;
  lower: number;
  unclaimed: number;
}

export interface PeopleSegment {
  who: string;
  band: string;
  level: string;
  guests: number;
  plays: number;
  spendIqd: number;
}

export interface PeoplePeak {
  key: string;
  dow: number;
  hour: number;
  plays: number;
}

export interface PeopleFresh {
  key: string;
  newGuests: number;
  returningGuests: number;
}

export interface PeopleData {
  period: { from: string; to: string };
  known: PeopleKnown;
  genders: PeopleBucket[];
  ages: PeopleBucket[];
  levels: PeopleBucket[];
  judged: PeopleJudged;
  interests: { bucket: string; guests: number; share: number | null }[];
  segments: PeopleSegment[];
  peak: PeoplePeak[];
  fresh: PeopleFresh[];
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const share = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n >= 0 && n <= 100 ? n : null;
};

function bucket(v: unknown): PeopleBucket {
  const o = obj(v);
  return {
    bucket: str(o.bucket),
    guests: num(o.guests),
    plays: num(o.plays),
    bookings: num(o.bookings),
    spendIqd: num(o.spend_iqd),
    share: share(o.share),
    judged: num(o.judged),
  };
}

/** Buckets in a fixed order; anything the server sent that is not in it comes after, as it came. */
function ordered(rows: readonly PeopleBucket[], order: readonly string[]): PeopleBucket[] {
  const known = order.map((b) => rows.find((r) => r.bucket === b)).filter((r): r is PeopleBucket => !!r);
  const rest = rows.filter((r) => !order.includes(r.bucket));
  return [...known, ...rest];
}

export function parsePeople(json: unknown): PeopleData {
  const o = obj(json);
  const k = obj(o.known);
  const j = obj(o.judged);
  return {
    period: { from: str(obj(o.period).from), to: str(obj(o.period).to) },
    known: {
      guests: num(k.guests),
      withGenders: num(k.withGenders),
      withAges: num(k.withAges),
      withLevels: num(k.withLevels),
      judgedLevels: num(k.judgedLevels),
      plays: num(k.plays),
      bookings: num(k.bookings),
      spendIqd: num(k.spend_iqd),
      coveragePct: share(k.coveragePct),
      newGuests: num(k.newGuests),
      returningGuests: num(k.returningGuests),
    },
    genders: ordered(arr(o.genders).map(bucket).filter((b) => b.bucket !== ''), GENDER_ORDER),
    ages: ordered(arr(o.ages).map(bucket).filter((b) => b.bucket !== ''), AGE_ORDER),
    levels: ordered(arr(o.levels).map(bucket).filter((b) => b.bucket !== ''), LEVEL_ORDER),
    judged: {
      checked: num(j.checked),
      agree: num(j.agree),
      higher: num(j.higher),
      lower: num(j.lower),
      unclaimed: num(j.unclaimed),
    },
    interests: INTEREST_ORDER.flatMap((tag) => {
      const row = arr(o.interests).map(obj).find((r) => str(r.bucket) === tag);
      if (!row) return [];
      const guests = num(row.guests);
      return guests > 0 ? [{ bucket: tag as string, guests, share: share(row.share) }] : [];
    }),
    segments: arr(o.segments)
      .map((r) => {
        const s = obj(r);
        return {
          who: str(s.who),
          band: str(s.band),
          level: str(s.level),
          guests: num(s.guests),
          plays: num(s.plays),
          spendIqd: num(s.spend_iqd),
        };
      })
      .filter((s) => s.who !== ''),
    peak: arr(o.peak)
      .map((r) => {
        const s = obj(r);
        return { key: str(s.key), dow: int(s.dow) ?? -1, hour: int(s.hour) ?? -1, plays: num(s.plays) };
      })
      .filter((s) => s.key !== '' && s.dow >= 0 && s.dow <= 6 && s.hour >= 0 && s.hour <= 23),
    fresh: arr(o.fresh)
      .map((r) => {
        const s = obj(r);
        return { key: str(s.key), newGuests: num(s.newGuests), returningGuests: num(s.returningGuests) };
      })
      .filter((s) => s.key !== ''),
  };
}

/** Nobody played in the range: every card says so once instead of drawing empty bars. */
export function peopleEmpty(d: PeopleData | null): boolean {
  return !!d && d.known.guests === 0;
}

/**
 * The two slots a bucket is busiest in, in the order the server ranked them
 * (it sends at most two per bucket).
 */
export function peakFor(d: PeopleData | null, key: string): PeoplePeak[] {
  return (d?.peak ?? []).filter((p) => p.key === key);
}

export function freshFor(d: PeopleData | null, key: string): PeopleFresh | null {
  return (d?.fresh ?? []).find((f) => f.key === key) ?? null;
}

/**
 * Which way the claimed levels lean, for the zone's own sentence: `agree` when
 * most judgments matched the claim, `over` when players mostly claim too high,
 * `under` when they sell themselves short, null before five judgments.
 */
export function claimLean(j: PeopleJudged): 'agree' | 'over' | 'under' | null {
  if (j.checked < 5) return null;
  if (j.higher > j.lower && j.higher >= j.agree) return 'over';
  if (j.lower > j.higher && j.lower >= j.agree) return 'under';
  return 'agree';
}

/** The share of the crowd a bucket holds, computed by the SERVER; this only reads it. */
export function biggestBucket(rows: readonly PeopleBucket[]): PeopleBucket | null {
  const named = rows.filter((r) => r.bucket !== 'unknown' && r.bucket !== 'other');
  if (named.length === 0) return null;
  return named.reduce((best, r) => (r.guests > best.guests ? r : best), named[0]!);
}
