/**
 * The leaderboard on the phone (migration 0364, Majed 2026-10-22). PURE: parsers for the two
 * reads, and the small rules the screens share, so vitest can pin them.
 *
 * The server owns every number: points, places and levels come from `ranks_board` and `my_ranks`,
 * and the phone never adds points up or ranks anyone. A player below the board is never sent.
 */
import type { Locale } from '@touch/i18n';

export type RanksPeriod = 'all' | 'month' | 'quarter';

export interface RanksLevel {
  nameEn: string | null;
  nameAr: string | null;
  minPoints: number;
}

export interface BoardRow {
  rank: number;
  /** "First L." as players see each other; null when the account has no name. */
  name: string | null;
  points: number;
  level: RanksLevel;
  mine: boolean;
}

export type Board =
  | { enabled: false }
  | { enabled: true; period: RanksPeriod; from: string | null; size: number; rows: BoardRow[] };

export interface ResultPlayer {
  name: string | null;
  username: string | null;
  former: boolean;
  me: boolean;
}

export type ResultStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'voided';
export type ResultOutcome = 'won' | 'lost' | 'draw';

export interface MyResult {
  id: string;
  source: 'player' | 'desk' | 'tournament';
  status: ResultStatus;
  playedAt: string;
  score: string | null;
  outcome: ResultOutcome;
  /** The guest's side, them first. A seat may be empty (a desk entry with a walk-in). */
  us: (ResultPlayer | null)[];
  them: (ResultPlayer | null)[];
  reportedByMe: boolean;
  canConfirm: boolean;
  expiresAt: string | null;
  /** What it gave this guest, net of any void. */
  points: number;
}

export interface ToReport {
  reservationId: string;
  startAt: string;
  endAt: string;
  courtEn: string;
  courtAr: string;
}

export interface RecentPlayer {
  username: string;
  name: string | null;
}

export type MyRanks =
  | { enabled: false }
  | {
      enabled: true;
      period: RanksPeriod;
      from: string | null;
      size: number;
      points: number;
      lifetime: number;
      /** Their place in the period; null with no points yet. */
      rank: number | null;
      level: RanksLevel;
      nextLevel: RanksLevel | null;
      rules: { win: number; loss: number; draw: number; reportHours: number; reports: boolean };
      username: string | null;
      results: MyResult[];
      toReport: ToReport[];
      recent: RecentPlayer[];
    };

// ── Parsing (defensive: a field the server leaves out reads as nothing, never a crash) ───────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
const period = (v: unknown): RanksPeriod => (v === 'all' || v === 'quarter' ? v : 'month');

function parseLevel(v: unknown): RanksLevel {
  const o = obj(v);
  return { nameEn: str(o.name_en), nameAr: str(o.name_ar), minPoints: int(o.min_points) };
}

function parsePlayer(v: unknown): ResultPlayer | null {
  if (!v || typeof v !== 'object') return null;
  const o = obj(v);
  return { name: str(o.name), username: str(o.username), former: o.former === true, me: o.me === true };
}

const STATUSES: readonly ResultStatus[] = ['pending', 'confirmed', 'rejected', 'expired', 'voided'];

function parseResult(v: unknown): MyResult | null {
  const o = obj(v);
  const id = str(o.id);
  const playedAt = str(o.played_at);
  if (!id || !playedAt) return null;
  const status = STATUSES.includes(o.status as ResultStatus) ? (o.status as ResultStatus) : 'pending';
  const source = o.source === 'desk' || o.source === 'tournament' ? o.source : 'player';
  const outcome = o.outcome === 'won' || o.outcome === 'draw' ? o.outcome : 'lost';
  return {
    id,
    source,
    status,
    playedAt,
    score: str(o.score),
    outcome,
    us: arr(o.us).map(parsePlayer),
    them: arr(o.them).map(parsePlayer),
    reportedByMe: o.reported_by_me === true,
    canConfirm: o.can_confirm === true,
    expiresAt: str(o.expires_at),
    points: int(o.points),
  };
}

export function parseBoard(raw: unknown): Board {
  const o = obj(raw);
  if (o.enabled !== true) return { enabled: false };
  const rows = arr(o.rows)
    .map((r): BoardRow => {
      const x = obj(r);
      return {
        rank: int(x.rank, 0),
        name: str(x.name),
        points: int(x.points),
        level: parseLevel(x.level),
        mine: x.mine === true,
      };
    })
    .filter((r) => r.rank > 0);
  return { enabled: true, period: period(o.period), from: str(o.from), size: int(o.size, 10), rows };
}

export function parseMyRanks(raw: unknown): MyRanks {
  const o = obj(raw);
  if (o.enabled !== true) return { enabled: false };
  const rules = obj(o.rules);
  const rank = int(o.rank, 0);
  return {
    enabled: true,
    period: period(o.period),
    from: str(o.from),
    size: int(o.size, 10),
    points: int(o.points),
    lifetime: int(o.lifetime),
    rank: rank > 0 ? rank : null,
    level: parseLevel(o.level),
    nextLevel: o.next_level && typeof o.next_level === 'object' ? parseLevel(o.next_level) : null,
    rules: {
      win: int(rules.win),
      loss: int(rules.loss),
      draw: int(rules.draw),
      reportHours: int(rules.report_hours, 48),
      reports: rules.reports !== false,
    },
    username: str(o.username),
    results: arr(o.results)
      .map(parseResult)
      .filter((r): r is MyResult => r !== null),
    toReport: arr(o.to_report)
      .map((r): ToReport | null => {
        const x = obj(r);
        const id = str(x.reservation_id);
        const startAt = str(x.start_at);
        if (!id || !startAt) return null;
        const court = obj(x.court);
        return {
          reservationId: id,
          startAt,
          endAt: str(x.end_at) ?? startAt,
          courtEn: str(court.name_en) ?? '',
          courtAr: str(court.name_ar) ?? str(court.name_en) ?? '',
        };
      })
      .filter((r): r is ToReport => r !== null),
    recent: arr(o.recent)
      .map((r): RecentPlayer | null => {
        const x = obj(r);
        const username = str(x.username);
        return username ? { username, name: str(x.name) } : null;
      })
      .filter((r): r is RecentPlayer => r !== null),
  };
}

// ── Shared rules ───────────────────────────────────────────────────────────

/** A level's name in the reading language, the other one when it has none. */
export function levelName(level: RanksLevel | null | undefined, locale: Locale): string | null {
  if (!level) return null;
  return (locale === 'ar' ? level.nameAr ?? level.nameEn : level.nameEn ?? level.nameAr) ?? null;
}

/**
 * How far into their level a guest is: 0..1 along the way to the next one, and the points still
 * to go. At the top level there is no next one: full, nothing to go.
 */
export function levelProgress(
  lifetime: number,
  level: RanksLevel,
  next: RanksLevel | null,
): { fraction: number; toNext: number | null } {
  if (!next) return { fraction: 1, toNext: null };
  const span = Math.max(1, next.minPoints - level.minPoints);
  const into = Math.min(Math.max(lifetime - level.minPoints, 0), span);
  return { fraction: into / span, toNext: Math.max(next.minPoints - lifetime, 0) };
}

/**
 * The podium reads second, first, third, as a podium stands; the rest of the board follows as
 * a list. Ties share a rank, so the three are the first three rows, whatever their numbers.
 */
export function splitPodium(rows: readonly BoardRow[]): {
  podium: (BoardRow | null)[];
  rest: BoardRow[];
} {
  const [first = null, second = null, third = null] = rows;
  return { podium: [second, first, third], rest: rows.slice(3) };
}

/** A username as typed: no "@", no spaces, lower case (the server folds it the same way). */
export function normaliseUsername(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

/** A set's two games, as typed: empty, or a whole number 0..99. */
export type SetInput = readonly [string, string];

/**
 * The optional score from the sets typed: "6-4, 7-5" (the server's exact form), null when no set
 * was typed, or 'invalid' when a set is half filled or not a number.
 */
export function buildScore(sets: readonly SetInput[]): string | null | 'invalid' {
  const parts: string[] = [];
  for (const [a, b] of sets) {
    const x = a.trim();
    const y = b.trim();
    if (x === '' && y === '') continue;
    if (!/^\d{1,2}$/.test(x) || !/^\d{1,2}$/.test(y)) return 'invalid';
    parts.push(`${Number(x)}-${Number(y)}`);
  }
  if (parts.length > 5) return 'invalid';
  return parts.length ? parts.join(', ') : null;
}

/** The three other players, each known and none twice nor the guest themself. */
export function playersReady(
  usernames: readonly [string, string, string],
  own: string | null,
): 'ready' | 'missing' | 'repeat' {
  const names = usernames.map(normaliseUsername);
  if (names.some((n) => n === '')) return 'missing';
  const seen = new Set(own ? [own.toLowerCase()] : []);
  for (const n of names) {
    if (seen.has(n)) return 'repeat';
    seen.add(n);
  }
  return 'ready';
}

/** A player's line on a result: their name, else their @username, else null for "Player". */
export function playerLabel(p: ResultPlayer | null): string | null {
  if (!p) return null;
  return p.name ?? (p.username ? `@${p.username}` : null);
}
