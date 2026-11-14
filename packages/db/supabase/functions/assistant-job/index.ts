/**
 * assistant-job — accepted estimates become work (plan §4.3, §6.4, contracts
 * "assistant-job/index.ts").
 *
 *   POST {action:'accept', job_id, mode:'live'|'batch'}  owner session
 *     estimated → accepted → running. `live` runs the chunks inline (≤ 40
 *     chunks, LIVE_MAX_CHUNKS), JOB_LIVE_CONCURRENCY at a time, and
 *     reduces; `batch` reads every chunk's rows now (as the owner), submits
 *     one Batch API request per chunk with custom_id `job:<id>:<chunk>`,
 *     stores batch_id and returns.
 *   POST {action:'tick'}                                   service role (cron tp_assistant_job_tick)
 *     claims the running batch jobs no other tick holds (0405
 *     app.assistant_job_claim_tick) and polls only those; when ended,
 *     collects results by custom_id, reduces, finishes.
 *   POST {action:'cancel', job_id}                         owner session
 *     app.assistant_job_cancel, and the batch is cancelled when one exists.
 *
 * Rows never enter the chat (§11.6): each chunk is a fixed extraction prompt
 * over cleaned rows returning a JSON object; only the objects reach the
 * reduce step, whose answer is inserted as an ordinary assistant message
 * with `sources: [{job_id}]`. Rows are read through the owner's JWT client
 * (`assistant_run_tool`), never the service role. Per chunk:
 * `llm_begin_request` (the cap), one model call, `llm_record_usage`; the job
 * pauses in `over_estimate` when spend passes the accepted estimate × 1.25.
 *
 * Models (2026-10-08): every chunk extraction, live and batch, runs on
 * JOB_EXTRACT_MODEL (Sonnet 5.5, estimate.ts) — pulling counts and sums out
 * of one chunk is mechanical; the reduce step runs on the job's model (the
 * chat's, stamped as tokens.model at accept) because it writes the owner's
 * answer. Every call is priced (`llm_price_micros`), recorded
 * (`llm_record_usage`) and stored (`assistant_calls.model`) at the model
 * that served it; tokens.extract_model says which model read the chunks.
 * Batch ids are account-wide (one ANTHROPIC_API_KEY): the batch is created,
 * polled and read through the extraction provider and cancelled through the
 * default one; the model only rides in each request's params.
 * Live: a pool of JOB_LIVE_CONCURRENCY (_shared/assistant/pool.ts) launches
 * chunks in order, stops launching at the clock's cutoff, over the estimate
 * or at the monthly cap, and lets in-flight chunks finish. The clock
 * (liveClock) sits inside the request's WALL_MS abort: no launch after
 * launchBy, extraction streams cut at extractBy on their own signal, so the
 * reduce keeps its time and a cut chunk ends in the TIMEOUT "re-run as batch"
 * failure, not the generic one. The cap (budgetAllows) counts this job's calls
 * still in flight, which begin()'s month-to-date figure misses, so the month
 * overshoots by at most one call, as it did sequentially. Progress writes go
 * through one ordered queue, so chunks_done and tokens only grow, and every
 * transition waits for them and happens once, after the pool.
 */
// The work (Book, chunksOf, readChunk, runLive, submitBatch, tick) lives in
// _shared/assistant/jobRunner.ts since 2026-11-11, with every dependency
// injected so vitest runs it; this file is the request, the refusal ladder and
// the wiring (which providers, from this function's env).
import { callerClient, createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { handle, isUuid, json, KB, logError, pgErrorBody, readJsonBody } from '../_shared/http.ts';
import { JOB_EXTRACT_MODEL, LIVE_MAX_CHUNKS } from '../_shared/assistant/estimate.ts';
import { newHandleTable } from '../_shared/assistant/handles.ts';
import { providerFromEnv, type Provider } from '../_shared/assistant/provider.ts';
import { Book, chunksOf, errorText, jobErrorText, runLive, submitBatch, tick, venueTimezone, WALL_MS, type JobRow } from '../_shared/assistant/jobRunner.ts';

/** accept / cancel / tick: a job id and a mode. */
const MAX_BODY = 4 * KB;

/**
 * The provider that reads the chunks: JOB_EXTRACT_MODEL, else `fallback`
 * (built from the same key, so it never differs in practice). Batch is a
 * vendor capability (provider.ts) of this provider, since it creates the batch.
 */
function extractProviderOr(fallback: Provider): Provider {
  return providerFromEnv((n) => Deno.env.get(n), JOB_EXTRACT_MODEL) ?? fallback;
}

/** A provider for `model`, else `fallback`. */
function providerOr(model: string | null | undefined, fallback: Provider): Provider {
  return model ? (providerFromEnv((n) => Deno.env.get(n), model) ?? fallback) : fallback;
}

// ---------------------------------------------------------------------------
Deno.serve(handle('assistant-job', async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED', code: 'METHOD_NOT_ALLOWED', message: 'POST only' }, 405);
  const started = Date.now();
  const service = createServiceClient();

  const read = await readJsonBody<{ action?: string; job_id?: string; mode?: string }>(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400),
  });
  if (!read.ok) return read.response;
  const body = read.value;
  const action = body.action;
  if (action !== 'accept' && action !== 'tick' && action !== 'cancel') return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'action must be accept, tick or cancel' }, 400);

  const provider = providerFromEnv((n) => Deno.env.get(n));
  const abort = new AbortController();
  const wall = setTimeout(() => abort.abort(), WALL_MS);

  try {
    if (action === 'tick') {
      if (!isServiceRoleRequest(req)) return json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'tick is for the service role' }, 403);
      if (!provider) return json({ ok: false, error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED' });
      return await tick(new Book(service, provider), abort.signal, providerOr);
    }

    const auth = await requireStaffRole(req, service, ['owner']);
    if (auth instanceof Response) return auth;
    if (!body.job_id) return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'job_id is required' }, 400);
    // A malformed id is bad input (400), not a Postgres 22P02 from the read below (500 INTERNAL).
    if (!isUuid(body.job_id)) return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'job_id must be a uuid' }, 400);

    const { data: jobData, error: jobErr } = await service.from('assistant_jobs').select('*').eq('id', body.job_id).maybeSingle();
    if (jobErr) {
      logError('assistant-job', jobErr, 'job read failed');
      return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
    }
    if (!jobData) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'job not found' }, 404);
    const job = jobData as JobRow;
    const { data: conv, error: convErr } = await service.from('assistant_conversations').select('owner_id, handles, model').eq('id', job.conversation_id).maybeSingle();
    if (convErr) {
      logError('assistant-job', convErr, 'conversation read failed');
      return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
    }
    if (!conv || (conv as { owner_id: string }).owner_id !== auth.userId) return json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your job' }, 403);
    const asOwner = callerClient(req);

    if (action === 'cancel') {
      const { error } = await asOwner.schema('app').rpc('assistant_job_cancel', { p_id: job.id });
      if (error) {
        const refused = pgErrorBody(error, 'assistant-job');
        return json(refused.body, refused.status);
      }
      if (job.batch_id && provider) {
        try {
          // Batch ids are account-wide: the default provider (same key) cancels it, whatever model it runs.
          await provider.batchCancel(job.batch_id);
        } catch (e) {
          logError('assistant-job', errorText(e), 'batch cancel failed');
        }
      }
      return json({ job_id: job.id, status: 'cancelled' });
    }

    // accept — the request's own problems (mode, state) answer before the
    // runtime's: a double accept is 409 with or without a model key
    // (review 2026-11-09; it used to hide behind the 503).
    const mode = body.mode === 'live' || body.mode === 'batch' ? body.mode : null;
    if (!mode) return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: "mode must be 'live' or 'batch'" }, 400);
    if (job.status !== 'estimated') return json({ error: 'INVALID_TRANSITION', code: 'INVALID_TRANSITION', message: `job is ${job.status}` }, 409);
    if (!provider) return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: 'ANTHROPIC_API_KEY is not set' }, 503);
    if (mode === 'batch' && !extractProviderOr(provider).capabilities.batch) {
      return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'batch jobs are not available on this model; run the job live' }, 400);
    }
    if (mode === 'live' && (!job.estimate.modes.live.allowed || job.estimate.chunks > LIVE_MAX_CHUNKS)) {
      return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: job.estimate.modes.live.reason ?? `live jobs run at most ${LIVE_MAX_CHUNKS} chunks; choose batch` }, 400);
    }
    const chunks = chunksOf(job);
    if (typeof chunks === 'string') return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: chunks }, 400);

    // 0114: the job runs on the chat's model, else the chain default (platform_settings,
    // 0207); the tick rebuilds the same provider from tokens.model, stamped below.
    const { data: vs, error: vsErr } = await service.from('platform_settings').select('llm_default_model').eq('id', true).maybeSingle();
    if (vsErr) logError('assistant-job', vsErr, 'platform_settings default model unread; the chat model or the env default runs the job');
    const jobModel = (conv as { model?: string | null }).model ?? (vs as { llm_default_model?: string | null } | null)?.llm_default_model ?? null;
    const jobProvider = providerOr(jobModel, provider);
    const book = new Book(service, jobProvider, extractProviderOr(jobProvider));
    await book.transition(job.id, 'accepted', { mode, tokens: { ...(job.tokens ?? {}), model: jobProvider.model } });
    // started_at is stamped by the SQL on the first 'running' (0112), never patched:
    // passing it raised INVALID_ARGUMENT and left the job stuck in 'accepted'.
    await book.transition(job.id, 'running', { chunks_total: chunks.length });
    job.mode = mode;
    job.chunks_total = chunks.length;
    const handles = newHandleTable((conv as { handles: unknown }).handles);
    const tz = await venueTimezone(asOwner, service);

    return mode === 'live' ? await runLive(book, asOwner, job, chunks, handles, tz, abort.signal, started) : await submitBatch(book, asOwner, job, chunks, handles, tz);
  } catch (e) {
    // Logged in full; the owner gets the code and our sentence.
    logError('assistant-job', errorText(e), `${action} failed`);
    return json({ error: 'UPSTREAM', code: 'UPSTREAM', message: jobErrorText('UPSTREAM') }, 502);
  } finally {
    clearTimeout(wall);
  }
}));
