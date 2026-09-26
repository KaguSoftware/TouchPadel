/**
 * The `local` embedding provider's runner: Supabase's built-in gte-small
 * session, which exists only in the edge runtime (so this module is Deno-only
 * and is never imported by the pure modules or the vitest suites).
 *
 * Sequential on purpose: the runtime bills about 60 ms of CPU per text and
 * kills the worker at 2 s, so a request must never carry more than a handful of
 * texts and must not run them in parallel (measured 2026-09-20: 8 texts
 * 471 ms, 32 texts killed). The indexer caps a request at LOCAL_MAX_TEXTS; the
 * chat embeds one query.
 */
export type LocalRunner = (texts: readonly string[]) => Promise<ArrayLike<number>[]>;

/** With EMBEDDING_PROVIDER=local, the most texts one invocation may embed. */
export const LOCAL_MAX_TEXTS = 8;

type Session = { run(text: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<ArrayLike<number>> };

/**
 * One session per worker. Creating a session per call made every `search`
 * pay the model load again (~5.8 s each, measured 2026-09-20); with the
 * runtime's per_worker policy the loaded model then serves the next calls in
 * tens of milliseconds.
 */
let cached: Session | null = null;

export function localRunner(): LocalRunner | undefined {
  const g = globalThis as unknown as { Supabase?: { ai?: { Session: new (model: string) => Session } } };
  const ai = g.Supabase?.ai;
  if (!ai) return undefined;
  const session = cached ?? (cached = new ai.Session('gte-small'));
  return async (texts) => {
    const out: ArrayLike<number>[] = [];
    for (const t of texts) out.push(await session.run(t, { mean_pool: true, normalize: true }));
    return out;
  };
}
