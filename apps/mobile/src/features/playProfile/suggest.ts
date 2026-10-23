/**
 * What to offer a guest first, from their survey answers
 * (docs/design/play-coaches/contracts-2026-10-11.md §8). PURE.
 *
 * `suggest` ORDERS: every kind comes back every time, ranked, each with the
 * one short reason that put it where it is. `topSuggestions`, what the Join
 * tab's "For you" strip and the survey's last page show, also keeps to what
 * the guest said they are after (2026-10-12): once "What are you after?" has
 * an answer, tournaments need Tournaments and coaches need Lessons. Group
 * sessions and open matches need no want. With a level or years but no want,
 * it offers group sessions alone (the strip then asks for the wants).
 *
 * The rule, written as points so the order is explainable line by line:
 *   level   (3 for a strong fit, 1 for a mild one)
 *     new, beginner   → coaches and group sessions; Americano and open
 *                       matches mildly (Americano rotates partners, so it is
 *                       the friendly format)
 *     intermediate    → open matches and Americano; coaches and Mexicano mildly
 *     advanced        → Mexicano and open matches; Americano mildly
 *   years   (2 / 1)
 *     never           → coaches and group sessions
 *     under_one       → coaches, group sessions, Americano, mildly
 *     one_to_three    → open matches and Americano, mildly
 *     three_plus      → Mexicano, and open matches mildly
 *   wants   (1.5)     → reorders within that: lessons lift coaches (and group
 *                       sessions a little), matches lift open matches,
 *                       tournaments lift both formats
 * Ties keep DEFAULT_ORDER. A kind the venue has nothing of right now
 * (`available`) sinks below every kind it has, in the same relative order.
 */
import type { PlayAnswers, PlayLevel, PlayWant, PlayYears } from './logic';
import { onlinePaymentsShipped } from '../deposit/enabled';
import { tournamentsShipped } from '../tournaments/shipped';

export const SUGGESTION_KINDS = ['matches', 'americano', 'coaches', 'classes', 'mexicano'] as const;
/**
 * coaches    the Coaches tab, at the guest's level
 * classes    group sessions and courses
 * matches    open matches on the Play tab
 * americano  Americano tournaments on the Play tab
 * mexicano   Mexicano tournaments on the Play tab
 */
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** The tie-break, and the whole order when nothing was answered. */
const DEFAULT_ORDER: readonly SuggestionKind[] = SUGGESTION_KINDS;

/** Why a kind ranks where it does: one short line each (`playProfile.why.<reason>`). */
export type SuggestionReason =
  | 'starting'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'seasoned'
  | 'wantsLessons'
  | 'wantsMatches'
  | 'wantsTournaments'
  | 'general';

export interface Suggestion {
  kind: SuggestionKind;
  reason: SuggestionReason;
  /** 0 when nothing the guest said points at it. */
  score: number;
  /** False when the venue has none of it right now; it is ranked last, never dropped. */
  available: boolean;
}

type Points = Partial<Record<SuggestionKind, number>>;
interface Rule {
  points: Points;
  reason: SuggestionReason;
}

const LEVEL_RULES: Record<PlayLevel, Rule> = {
  new: { points: { coaches: 3, classes: 3, americano: 1 }, reason: 'starting' },
  beginner: { points: { coaches: 3, classes: 3, americano: 1, matches: 1 }, reason: 'beginner' },
  intermediate: { points: { matches: 3, americano: 3, coaches: 1, mexicano: 1 }, reason: 'intermediate' },
  advanced: { points: { mexicano: 3, matches: 3, americano: 1 }, reason: 'advanced' },
};

const YEARS_RULES: Record<PlayYears, Rule> = {
  never: { points: { coaches: 2, classes: 2 }, reason: 'starting' },
  under_one: { points: { coaches: 1, classes: 1, americano: 1 }, reason: 'beginner' },
  one_to_three: { points: { matches: 1, americano: 1 }, reason: 'intermediate' },
  three_plus: { points: { mexicano: 2, matches: 1 }, reason: 'seasoned' },
};

const WANT_RULES: Record<PlayWant, Rule> = {
  lessons: { points: { coaches: 1.5, classes: 1 }, reason: 'wantsLessons' },
  matches: { points: { matches: 1.5 }, reason: 'wantsMatches' },
  tournaments: { points: { americano: 1.5, mexicano: 1.5 }, reason: 'wantsTournaments' },
};

/** The want a kind needs once any want is answered; group sessions and open matches need none. */
const NEEDS_WANT: Partial<Record<SuggestionKind, PlayWant>> = {
  coaches: 'lessons',
  americano: 'tournaments',
  mexicano: 'tournaments',
};

/** Is this kind one the guest asked for? Always, while no want is answered. */
export function fitsWants(kind: SuggestionKind, wants: readonly PlayWant[] | null | undefined): boolean {
  const need = NEEDS_WANT[kind];
  return !need || !wants || wants.length === 0 || wants.includes(need);
}

/**
 * Every kind, ranked for these answers. `answers` null (or all unanswered)
 * gives DEFAULT_ORDER with the `general` reason and a score of 0 everywhere.
 */
export function suggest(
  answers: PlayAnswers | null | undefined,
  available?: Partial<Record<SuggestionKind, boolean>>,
): Suggestion[] {
  const rules: Rule[] = [];
  if (answers?.level) rules.push(LEVEL_RULES[answers.level]);
  if (answers?.years) rules.push(YEARS_RULES[answers.years]);
  // A want's reason wins a tie with the level's: the guest said it in so many words.
  for (const w of answers?.wants ?? []) rules.push(WANT_RULES[w]);

  const ranked = DEFAULT_ORDER.map((kind, order) => {
    let score = 0;
    let reason: SuggestionReason = 'general';
    let best = 0;
    for (const rule of rules) {
      const p = rule.points[kind] ?? 0;
      score += p;
      if (p > 0 && p >= best && (p > best || rule.reason.startsWith('wants'))) {
        best = p;
        reason = rule.reason;
      }
    }
    // Store build: open matches are not shipped, so they are never suggested.
    // And tournaments, while a build leaves them out (tournaments/shipped.ts).
    const offered =
      (kind === 'matches' && !onlinePaymentsShipped()) ||
      ((kind === 'americano' || kind === 'mexicano') && !tournamentsShipped())
        ? false
        : (available?.[kind] ?? true);
    return { kind, reason, score, available: offered, order };
  });

  ranked.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.order - b.order;
  });
  return ranked.map(({ kind, reason, score, available: on }) => ({ kind, reason, score, available: on }));
}

/**
 * The first `max` suggestions the answers actually point at (score above 0,
 * on offer, and of a kind the guest's wants allow, `fitsWants`). Empty when
 * nothing was answered: the caller then asks instead of guessing. Answered
 * but no want: group sessions alone, whatever they score, when on offer.
 */
export function topSuggestions(
  answers: PlayAnswers | null | undefined,
  max: number,
  available?: Partial<Record<SuggestionKind, boolean>>,
): Suggestion[] {
  const ranked = suggest(answers, available);
  if (answers && (answers.level || answers.years) && answers.wants.length === 0) {
    return ranked.filter((s) => s.kind === 'classes' && s.available).slice(0, Math.max(0, max));
  }
  return ranked
    .filter((s) => s.score > 0 && s.available && fitsWants(s.kind, answers?.wants))
    .slice(0, Math.max(0, max));
}
