/**
 * Who a player is, as the desk reads it (migrations 0368/0369;
 * docs/design/customers/contracts-2026-10-24.md §1, §5).
 *
 * Majed, 2026-10-24: the level a player claims at sign-up "will not be final,
 * it will be measured, and a manager or their performance will judge if that
 * level is actually accurate". So three things live beside each other on a
 * customer record: what the player SAID (`claimedLevel`), what the club
 * JUDGED (`confirmed*`, written by a coach, the court desk, a manager or the
 * owner), and what the GAMES suggest (`suggested`, from confirmed results
 * only, never fewer than five). The level everything else goes by is
 * `effectiveLevel` — the judgment when there is one, else the claim.
 *
 * The interest tags are derived from behaviour and never asked (0368); this
 * module only orders and names them.
 *
 * PURE (no React, no network): vitest runs it under node.
 */

export const AGE_BANDS = ['u18', '18_24', '25_34', '35_44', '45_54', '55_plus'] as const;
export const PLAY_LEVELS = ['new', 'beginner', 'intermediate', 'advanced'] as const;
/** The closed, ordered tag list of app.customer_interest_tags. */
export const INTEREST_TAGS = [
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

export type AgeBand = (typeof AGE_BANDS)[number];
export type PlayLevel = (typeof PLAY_LEVELS)[number];
export type InterestTag = (typeof INTEREST_TAGS)[number];
export type JudgeRole = 'coach' | 'court_desk' | 'manager' | 'owner';

/** What the games suggest; null until five scored games exist. */
export interface LevelSuggestion {
  level: PlayLevel;
  games: number;
  wins: number;
  losses: number;
  score: number | null;
}

export interface PlayerFacts {
  ageBand: AgeBand | null;
  claimedLevel: PlayLevel | null;
  playYears: string | null;
  playWants: string[];
  confirmedLevel: PlayLevel | null;
  confirmedAt: string | null;
  confirmedRole: JudgeRole | null;
  confirmedByName: string | null;
  note: string | null;
  effectiveLevel: PlayLevel | null;
  suggested: LevelSuggestion | null;
  interests: InterestTag[];
}

export interface LevelReview {
  profileId: string;
  fullName: string;
  claimed: PlayLevel | null;
  confirmed: PlayLevel | null;
  suggested: PlayLevel;
  games: number;
  wins: number;
  losses: number;
  score: number | null;
  lastPlayedAt: string | null;
}

export const NOTE_MAX = 120;

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

export const parseBand = (v: unknown): AgeBand | null => oneOf(AGE_BANDS, v);
export const parseLevel = (v: unknown): PlayLevel | null => oneOf(PLAY_LEVELS, v);

function parseSuggestion(v: unknown): LevelSuggestion | null {
  const o = obj(v);
  const level = parseLevel(o.level);
  if (!level) return null;
  const score = typeof o.score === 'number' ? o.score : typeof o.score === 'string' ? Number(o.score) : NaN;
  return {
    level,
    games: int(o.games),
    wins: int(o.wins),
    losses: int(o.losses),
    score: Number.isFinite(score) ? score : null,
  };
}

/**
 * The record's `player` block. A server before 0368 sends none, and then this
 * answers null so the card renders nothing at all — never a half-empty card
 * that looks like a player who answered nothing.
 */
export function parsePlayerFacts(record: unknown): PlayerFacts | null {
  const rec = obj(record);
  if (!('player' in rec)) return null;
  const p = obj(rec.player);
  return {
    ageBand: parseBand(p.age_band),
    claimedLevel: parseLevel(p.claimed_level),
    playYears: str(p.play_years),
    playWants: arr(p.play_wants).filter((w): w is string => typeof w === 'string'),
    confirmedLevel: parseLevel(p.level_confirmed),
    confirmedAt: str(p.level_confirmed_at),
    confirmedRole: oneOf(['coach', 'court_desk', 'manager', 'owner'] as const, p.level_confirmed_role),
    confirmedByName: str(p.level_confirmed_by_name),
    note: str(p.level_note),
    effectiveLevel: parseLevel(p.effective_level),
    suggested: parseSuggestion(p.suggested),
    // In the server's order, each tag once, and nothing this build cannot name.
    interests: INTEREST_TAGS.filter((tag) => arr(p.interests).includes(tag)),
  };
}

export function parseLevelReviews(json: unknown): LevelReview[] {
  return arr(json)
    .map((r) => {
      const o = obj(r);
      const suggested = parseLevel(o.suggested);
      const id = str(o.profile_id);
      if (!suggested || !id) return null;
      const score = typeof o.score === 'number' ? o.score : typeof o.score === 'string' ? Number(o.score) : NaN;
      return {
        profileId: id,
        fullName: str(o.full_name) ?? '',
        claimed: parseLevel(o.claimed),
        confirmed: parseLevel(o.confirmed),
        suggested,
        games: int(o.games),
        wins: int(o.wins),
        losses: int(o.losses),
        score: Number.isFinite(score) ? score : null,
        lastPlayedAt: str(o.last_played_at),
      };
    })
    .filter((r): r is LevelReview => r !== null);
}

/** Does the club's record already agree with what the games suggest? */
export function agreesWithGames(facts: PlayerFacts): boolean {
  return facts.suggested !== null && facts.effectiveLevel === facts.suggested.level;
}

/**
 * What a review row offers: confirming the suggestion, or writing the claim
 * down as right. A row with no claim offers only the suggestion.
 */
export function reviewChoices(row: LevelReview): { confirm: PlayLevel; keep: PlayLevel | null } {
  return { confirm: row.suggested, keep: row.claimed ?? null };
}

// ── The dialog ──────────────────────────────────────────────────────────────

export interface FactsDraft {
  band: AgeBand | null;
  level: PlayLevel | null;
  note: string;
}

export function draftOf(facts: PlayerFacts | null): FactsDraft {
  return {
    band: facts?.ageBand ?? null,
    level: facts?.confirmedLevel ?? null,
    note: facts?.note ?? '',
  };
}

const trimmed = (s: string) => s.replace(/\s+/g, ' ').trim();

export function draftDirty(draft: FactsDraft, facts: PlayerFacts | null): boolean {
  const base = draftOf(facts);
  return draft.band !== base.band || draft.level !== base.level || trimmed(draft.note) !== trimmed(base.note);
}

/** The refusals the form states itself, before the server has to. */
export function draftErrors(draft: FactsDraft): { note?: 'long' | 'noLevel' } {
  if (trimmed(draft.note).length > NOTE_MAX) return { note: 'long' };
  // The server refuses a note with no level (INVALID_ARGUMENT p_note), because
  // there would be nothing to hang it on.
  if (draft.level === null && trimmed(draft.note) !== '') return { note: 'noLevel' };
  return {};
}

/** Which writes a save needs, in the order they run. Nothing unchanged is sent. */
export function saveSteps(
  draft: FactsDraft,
  facts: PlayerFacts | null,
): { band: AgeBand | null | 'keep'; level: { level: PlayLevel | null; note: string | null } | 'keep' } {
  const base = draftOf(facts);
  const note = trimmed(draft.note);
  return {
    band: draft.band !== base.band ? draft.band : 'keep',
    level:
      draft.level !== base.level || note !== trimmed(base.note)
        ? { level: draft.level, note: draft.level === null || note === '' ? null : note }
        : 'keep',
  };
}
