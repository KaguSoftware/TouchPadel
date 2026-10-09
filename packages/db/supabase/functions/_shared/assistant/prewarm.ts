/**
 * Which analytics cards the nightly pre-warm generates (migration 0327).
 *
 * The pre-warm (assistant-component {prewarm:true}, cron tp_assistant_prewarm,
 * plan DECIDE 12) used to fill every built-in × the three default ranges ×
 * ASSISTANT_PREWARM_LANGS whether or not the owner ever opened the card. Now a
 * card is pre-warmed only while the owner has read it within the last
 * PREWARM_VIEWED_DAYS: app.analytics_component stamps
 * assistant_components.last_viewed_at (at most once an hour) whenever the
 * owner's card reads the cache, and the owner-initiated generate path reads
 * through the same RPC. A card nobody opened costs nothing; the owner's next
 * open reads the cache (a miss shows the Generate button) and puts it back on
 * the list for the following night.
 *
 * Pure, so tests/assistant-prewarm.test.ts runs it without Deno.
 */

/** A component must have been viewed within this many days to be pre-warmed. */
export const PREWARM_VIEWED_DAYS = 7;

export interface PrewarmCandidate {
  key: string;
  /** assistant_components.last_viewed_at (0327); null = never viewed since 0327. */
  last_viewed_at?: string | null;
}

export interface PrewarmSelection<T extends PrewarmCandidate> {
  /** Viewed within the window: these are generated. */
  warm: T[];
  /** Never viewed, viewed too long ago, or an unreadable stamp: listed in the report, never generated. */
  skipped: { key: string; last_viewed_at: string | null }[];
}

/** Split the components into those viewed within `days` of `now` and the rest. */
export function selectPrewarm<T extends PrewarmCandidate>(components: readonly T[], now: Date, days: number = PREWARM_VIEWED_DAYS): PrewarmSelection<T> {
  const cutoff = now.getTime() - days * 86_400_000;
  const warm: T[] = [];
  const skipped: PrewarmSelection<T>['skipped'] = [];
  for (const c of components) {
    const seen = typeof c.last_viewed_at === 'string' ? Date.parse(c.last_viewed_at) : Number.NaN;
    if (Number.isFinite(seen) && seen >= cutoff) warm.push(c);
    else skipped.push({ key: c.key, last_viewed_at: c.last_viewed_at ?? null });
  }
  return { warm, skipped };
}
