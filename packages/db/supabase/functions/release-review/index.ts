/**
 * release-review (build-contracts-2026-09-23 §2.20, §2.10; plan §5.1).
 *
 *   POST {action:'tick'}   service role only (cron tp_release_review through
 *                          app.release_review_nudge)
 *
 * For every product release live for 30 days (app.release_due_reviews): its
 * input (app.release_review_input, the model's only input), the model from
 * the run venue's llm_default_model (venue-qualified; Q13), one structured
 * call returning {en, ar} under the spend cap (app.llm_begin_request, then
 * app.llm_record_usage with surface 'release_review'), the number gate and
 * the template fallback of analytics-insights, then app.release_review_save,
 * which moves the run to done and tells the owners and the venue's managers.
 * The flow is in review.ts, pure.
 *
 * verify_jwt = true (config.toml).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { providerFromEnv, textOf } from '../_shared/assistant/provider.ts';
import {
  REVIEW_MAX_TOKENS,
  REVIEW_SCHEMA,
  REVIEW_SURFACE,
  reviewTick,
  type DueReview,
  type ReviewPorts,
  type ReviewWriter,
} from './review.ts';

const CALL_MS = 45_000;

function ports(service: SupabaseClient): ReviewPorts {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await service.schema('app').rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  return {
    dueReviews: async () => ((await rpc('release_due_reviews', { p_limit: 5 })) as DueReview[] | null) ?? [],
    input: (runId) => rpc('release_review_input', { p_run_id: runId }),
    async modelFor(venueId) {
      const { data, error } = await service
        .from('venue_settings')
        .select('llm_default_model')
        .eq('venue_id', venueId)
        .maybeSingle();
      if (error) throw new Error(`venue_settings: ${error.message}`);
      return (data as { llm_default_model?: string | null } | null)?.llm_default_model ?? null;
    },
    writer(model): ReviewWriter | null {
      const provider = providerFromEnv((n) => Deno.env.get(n), model);
      if (!provider) return null;
      return {
        model: provider.model,
        async write(system, user) {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), CALL_MS);
          try {
            const turn = await provider.generate({
              system,
              messages: [{ role: 'user', content: user }],
              maxTokens: REVIEW_MAX_TOKENS,
              effort: 'medium',
              schema: REVIEW_SCHEMA,
              signal: abort.signal,
            });
            return { raw: textOf(turn.content), usage: turn.usage, stop_reason: turn.stop_reason };
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
    beginRequest: async () => {
      await rpc('llm_begin_request', {});
    },
    async recordUsage(model, usage) {
      const { error } = await service.schema('app').rpc('llm_record_usage', {
        p_model: model,
        p_input: usage.input,
        p_cache_write: usage.cache_write,
        p_cache_read: usage.cache_read,
        p_output: usage.output,
        p_model_calls: 1,
        p_surface: REVIEW_SURFACE,
      });
      if (error) console.error('[release-review] usage not recorded', error.message);
    },
    save: async (runId, numbers, writeUp, status, model) => {
      await rpc('release_review_save', {
        p_run_id: runId,
        p_numbers: numbers,
        p_write_up: writeUp,
        p_status: status,
        p_model: model,
      });
    },
    log: (message) => console.error('[release-review]', message),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);
  let body: { action?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  if (body.action !== 'tick') return json({ error: 'BAD_REQUEST', message: "action must be 'tick'" }, 400);
  if (!isServiceRoleRequest(req)) return json({ error: 'FORBIDDEN', message: 'service role only' }, 403);

  try {
    return json(await reviewTick(ports(createServiceClient())));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[release-review] failed', message);
    return json({ error: 'INTERNAL', message }, 500);
  }
});
