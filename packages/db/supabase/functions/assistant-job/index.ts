/**
 * assistant-job — accepted estimates become work (plan §4.3, §6.4, contracts
 * "assistant-job/index.ts").
 *
 *   POST {action:'accept', job_id, mode:'live'|'batch'}  owner session
 *     estimated → accepted → running. `live` runs the chunks inline (≤ 40
 *     chunks, LIVE_MAX_CHUNKS) and reduces; `batch` reads every chunk's rows
 *     now (as the owner), submits one Batch API request per chunk with
 *     custom_id `job:<id>:<chunk>`, stores batch_id and returns.
 *   POST {action:'tick'}                                   service role (cron tp_assistant_job_tick)
 *     polls every running batch job; when ended, collects results by
 *     custom_id, reduces, finishes.
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
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { json, mapPgError } from '../_shared/http.ts';
import { clean, CleanError, sourceForTool, type Cleaned } from '../_shared/assistant/clean.ts';
import { isOverEstimate, LIVE_MAX_CHUNKS, type JobEstimate, type JobPlan } from '../_shared/assistant/estimate.ts';
import { gateAnswer, numbersIn, type GateResult } from '../_shared/assistant/gate.ts';
import { newHandleTable, toJson, type HandleTable } from '../_shared/assistant/handles.ts';
import { buildChunkExtractPrompt, buildJobSystem, buildReducePrompt, buildReduceSystem } from '../_shared/assistant/prompt.ts';
import { providerFromEnv, ProviderError, textOf, type BatchRequest, type ContentBlock, type Provider, type ProviderUsage } from '../_shared/assistant/provider.ts';
import { LIST_ROW_CAP, rpcArgs, toolByName, validateToolInput, type ToolSpec } from '../_shared/assistant/tools.ts';

const WALL_MS = 50_000;
const CHUNK_MAX_TOKENS = 2000;
const REDUCE_MAX_TOKENS = 4000;
const DEFAULT_TZ = 'Asia/Baghdad';
const SURFACE = 'assistant_job';

type Lang = 'en' | 'ar';
type Status = 'estimated' | 'accepted' | 'running' | 'reducing' | 'done' | 'failed' | 'cancelled' | 'over_estimate';

interface JobRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  status: Status;
  plan: JobPlan & { lang?: Lang };
  estimate: JobEstimate;
  mode: 'live' | 'batch' | null;
  chunks_total: number | null;
  chunks_done: number;
  tokens: Record<string, unknown> | null;
  result: unknown;
  batch_id: string | null;
}

interface Chunk {
  no: number;
  spec: ToolSpec;
  args: Record<string, unknown>;
  offset: number;
  limit: number;
}

interface Spend extends ProviderUsage {
  cost_micros: number;
  calls: number;
  total: number;
}

interface CallRow {
  call_no: number;
  model: string;
  usage: ProviderUsage;
  ms: number;
  stop_reason: string;
  cost_micros: number;
}

const zeroSpend = (): Spend => ({ input: 0, cache_write: 0, cache_read: 0, output: 0, cost_micros: 0, calls: 0, total: 0 });

function errorText(e: unknown): string {
  if (e instanceof CleanError) return `${e.code}: ${e.message}`;
  if (e instanceof ProviderError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

function ownerClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
}

/** The chunk list from the plan and the accepted estimate (per_tool carries chunk_rows and rows). */
function chunksOf(job: JobRow): Chunk[] | string {
  const out: Chunk[] = [];
  let no = 0;
  for (const call of job.plan.calls) {
    const spec = toolByName(call.tool);
    if (!spec || spec.kind !== 'list' || !spec.rpc) return `${call.tool} is not a list tool`;
    const per = job.estimate.per_tool.find((p) => p.tool === call.tool);
    if (!per) return `${call.tool} has no estimate row`;
    const args = { ...call.args };
    delete args.limit;
    delete args.offset;
    const problems = validateToolInput(spec, args);
    if (problems.length) return `${call.tool}: ${problems.join('; ')}`;
    const limit = Math.min(per.chunk_rows, LIST_ROW_CAP);
    for (let offset = 0; offset < per.rows; offset += limit) {
      no++;
      out.push({ no, spec, args, offset, limit: Math.min(limit, per.rows - offset) });
    }
  }
  return out;
}

async function readChunk(asOwner: SupabaseClient, chunk: Chunk, handles: HandleTable, tz: string, lang: Lang): Promise<Cleaned> {
  const { data, error } = await asOwner
    .schema('app')
    .rpc('assistant_run_tool', { p_tool: chunk.spec.rpc, p_args: rpcArgs(chunk.spec, { ...chunk.args, limit: chunk.limit, offset: chunk.offset }) });
  if (error) {
    const m = mapPgError(error);
    throw new Error(`${chunk.spec.name} chunk ${chunk.no}: ${m.code}: ${m.message}`);
  }
  const payload = (data as { data?: unknown })?.data;
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  const columns = Array.isArray(obj?.columns) ? (obj.columns as string[]) : null;
  return clean(sourceForTool(chunk.spec, columns), payload, { tz, lang, handles, cap: chunk.limit });
}

/** The chunk object the model returned, or a record of what it said instead. */
function parseObject(text: string): Record<string, unknown> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(stripped);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return { value: v };
  } catch {
    return { parse_error: true, text: stripped.slice(0, 2000) };
  }
}

async function venueTimezone(asOwner: SupabaseClient | null, service: SupabaseClient): Promise<string> {
  const client = asOwner ?? service;
  const { data } = await client.from('venue_settings').select('timezone').limit(1).maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return typeof tz === 'string' && tz ? tz : DEFAULT_TZ;
}

// ---------------------------------------------------------------------------
// Bookkeeping (service)
// ---------------------------------------------------------------------------
class Book {
  constructor(
    readonly service: SupabaseClient,
    readonly provider: Provider,
  ) {}

  async transition(id: string, status: Status, patch: Record<string, unknown> = {}): Promise<void> {
    const { error } = await this.service.schema('app').rpc('assistant_job_transition', { p_id: id, p_status: status, p_patch: patch });
    if (error) throw new Error(`assistant_job_transition(${status}): ${error.message}`);
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.service.from('assistant_jobs').update(patch).eq('id', id);
    if (error) console.error('[assistant-job] patch failed', id, error.message);
  }

  /** The cap check, once per model call. Throws with the LLM_* code. */
  async begin(): Promise<void> {
    const r = await this.service.schema('app').rpc('llm_begin_request');
    if (r.error) throw new Error(r.error.message ?? 'LLM_BUDGET');
  }

  async price(u: ProviderUsage): Promise<number> {
    const { data, error } = await this.service.schema('app').rpc('llm_price_micros', {
      p_model: this.provider.model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
    });
    if (error) {
      console.error('[assistant-job] llm_price_micros', error.message);
      return 0;
    }
    return Number(data ?? 0);
  }

  async record(u: ProviderUsage, calls: number): Promise<void> {
    const rec = await this.service.schema('app').rpc('llm_record_usage', {
      p_model: this.provider.model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
      p_model_calls: calls,
      p_surface: SURFACE,
    });
    if (rec.error) console.error('[assistant-job] usage not recorded', rec.error.message);
  }

  /** Add one model call's usage to the running spend and store it on the job. */
  async account(job: JobRow, spend: Spend, calls: CallRow[], u: ProviderUsage, ms: number, stop_reason: string): Promise<void> {
    const cost = await this.price(u);
    calls.push({ call_no: calls.length + 1, model: this.provider.model, usage: u, ms, stop_reason, cost_micros: cost });
    spend.input += u.input;
    spend.cache_write += u.cache_write;
    spend.cache_read += u.cache_read;
    spend.output += u.output;
    spend.cost_micros += cost;
    spend.calls += 1;
    spend.total = spend.input + spend.cache_write + spend.cache_read + spend.output;
    await this.record(u, 1);
    await this.patch(job.id, { tokens: spend });
  }

  /** Reduce, write the answer into the conversation, finish. */
  async reduce(job: JobRow, objects: unknown[], spend: Spend, calls: CallRow[], handles: HandleTable | null, signal: AbortSignal): Promise<{ message_id: string }> {
    const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
    await this.transition(job.id, 'reducing', { chunks_done: objects.length, tokens: spend });
    await this.begin();
    const turn = await this.provider.stream({
      system: buildReduceSystem(lang),
      tools: [],
      messages: [{ role: 'user', content: buildReducePrompt(job.plan, objects) }],
      maxTokens: REDUCE_MAX_TOKENS,
      effort: 'high',
      onText: () => {},
      onToolStart: () => {},
      signal,
    });
    await this.account(job, spend, calls, turn.usage, turn.ms, turn.stop_reason);
    const answer = textOf(turn.content) || (turn.stop_reason === 'refusal' ? 'The model declined to write this answer.' : '');
    const gate: GateResult = gateAnswer(answer, numbersIn(JSON.stringify(objects)), numbersIn(job.plan.question));

    // The answer as an ordinary assistant message
    const { data: last } = await this.service.from('assistant_messages').select('seq').eq('conversation_id', job.conversation_id).order('seq', { ascending: false }).limit(1).maybeSingle();
    const seq = ((last as { seq?: number } | null)?.seq ?? 0) + 1;
    const message_id = crypto.randomUUID();
    const tokens = { ...spend, model: this.provider.model };
    const ins = await this.service.from('assistant_messages').insert({
      id: message_id,
      conversation_id: job.conversation_id,
      seq,
      role: 'assistant',
      content: [{ type: 'text', text: answer }],
      sources: [{ job_id: job.id, chunks: objects.length, rows: job.estimate.rows }],
      gate,
      tokens,
    });
    if (ins.error) throw new Error(`answer not stored: ${ins.error.message}`);
    if (calls.length) {
      const rows = calls.map((c) => ({
        message_id,
        call_no: c.call_no,
        model: c.model,
        input_tokens: c.usage.input,
        cache_write_tokens: c.usage.cache_write,
        cache_read_tokens: c.usage.cache_read,
        output_tokens: c.usage.output,
        cost_micros: c.cost_micros,
        ms: c.ms,
        stop_reason: c.stop_reason,
      }));
      const r = await this.service.from('assistant_calls').insert(rows);
      if (r.error) console.error('[assistant-job] calls not stored', r.error.message);
    }
    const convPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (handles) convPatch.handles = toJson(handles);
    await this.service.from('assistant_conversations').update(convPatch).eq('id', job.conversation_id);

    await this.transition(job.id, 'done', {
      chunks_done: objects.length,
      tokens: spend,
      result: { message_id, answer, gate, objects: objects.length },
      finished_at: new Date().toISOString(),
    });
    return { message_id };
  }

  async fail(job: JobRow, error: string, spend: Spend): Promise<void> {
    try {
      await this.transition(job.id, 'failed', { error: error.slice(0, 1000), tokens: spend, finished_at: new Date().toISOString() });
    } catch (e) {
      console.error('[assistant-job] fail transition', errorText(e));
    }
  }
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------
async function runLive(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number) {
  const spend = zeroSpend();
  const calls: CallRow[] = [];
  const objects: unknown[] = [];
  const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
  try {
    for (const chunk of chunks) {
      if (Date.now() - started > WALL_MS) {
        await book.fail(job, `TIMEOUT: ${objects.length} of ${chunks.length} chunks done inside the wall clock; re-run as batch`, spend);
        return json({ job_id: job.id, status: 'failed', error: 'TIMEOUT', chunks_done: objects.length });
      }
      await book.begin();
      const cleaned = await readChunk(asOwner, chunk, handles, tz, lang);
      const turn = await book.provider.stream({
        system: buildJobSystem(),
        tools: [],
        messages: [{ role: 'user', content: buildChunkExtractPrompt(job.plan, chunk.no, chunks.length, cleaned) }],
        maxTokens: CHUNK_MAX_TOKENS,
        effort: 'low',
        onText: () => {},
        onToolStart: () => {},
        signal,
      });
      await book.account(job, spend, calls, turn.usage, turn.ms, turn.stop_reason);
      objects.push({ ...parseObject(textOf(turn.content)), chunk: chunk.no, tool: chunk.spec.name, rows_read: cleaned.stats.rows_out });
      await book.patch(job.id, { chunks_done: objects.length });
      if (isOverEstimate(spend.total, job.estimate)) {
        await book.transition(job.id, 'over_estimate', { chunks_done: objects.length, tokens: spend, result: { objects } });
        return json({ job_id: job.id, status: 'over_estimate', chunks_done: objects.length, tokens: spend });
      }
    }
    const { message_id } = await book.reduce(job, objects, spend, calls, handles, signal);
    return json({ job_id: job.id, status: 'done', message_id, chunks_done: objects.length, tokens: spend });
  } catch (e) {
    const msg = errorText(e);
    await book.fail(job, msg, spend);
    const code = msg.includes('LLM_DAILY_QUOTA') ? 'LLM_DAILY_QUOTA' : msg.includes('LLM_MONTHLY_CAP') ? 'LLM_MONTHLY_CAP' : e instanceof ProviderError ? e.code : 'UPSTREAM';
    return json({ job_id: job.id, status: 'failed', error: code, message: msg, chunks_done: objects.length }, code.startsWith('LLM_') ? 429 : 502);
  }
}

// ---------------------------------------------------------------------------
// Batch path
// ---------------------------------------------------------------------------
async function submitBatch(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string) {
  const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
  const spend = zeroSpend();
  try {
    await book.begin(); // one cap check at submission; the tick records the real usage
    const requests: BatchRequest[] = [];
    for (const chunk of chunks) {
      const cleaned = await readChunk(asOwner, chunk, handles, tz, lang);
      requests.push({
        custom_id: `job:${job.id}:${chunk.no}`,
        system: buildJobSystem(),
        messages: [{ role: 'user', content: buildChunkExtractPrompt(job.plan, chunk.no, chunks.length, cleaned) }],
        maxTokens: CHUNK_MAX_TOKENS,
        effort: 'low',
      });
    }
    const batch_id = await book.provider.batchCreate(requests);
    await book.patch(job.id, { batch_id, chunks_total: chunks.length });
    await book.service.from('assistant_conversations').update({ handles: toJson(handles), updated_at: new Date().toISOString() }).eq('id', job.conversation_id);
    return json({ job_id: job.id, status: 'running', mode: 'batch', batch_id, chunks_total: chunks.length });
  } catch (e) {
    const msg = errorText(e);
    await book.fail(job, msg, spend);
    return json({ job_id: job.id, status: 'failed', error: e instanceof ProviderError ? e.code : 'UPSTREAM', message: msg }, 502);
  }
}

async function tick(book: Book, signal: AbortSignal) {
  const { data, error } = await book.service.from('assistant_jobs').select('*').eq('status', 'running').eq('mode', 'batch').not('batch_id', 'is', null);
  if (error) return json({ ok: false, error: error.message });
  const jobs = (data ?? []) as JobRow[];
  const report: Record<string, unknown>[] = [];
  for (const job of jobs) {
    const spend: Spend = { ...zeroSpend(), ...((job.tokens ?? {}) as Partial<Spend>) };
    try {
      const status = await book.provider.batchStatus(job.batch_id!);
      await book.patch(job.id, { chunks_done: status.counts.succeeded + status.counts.errored + status.counts.canceled + status.counts.expired });
      if (!status.ended) {
        report.push({ job_id: job.id, status: status.status, counts: status.counts });
        continue;
      }
      const results = await book.provider.batchResults(job.batch_id!);
      const total = job.chunks_total ?? results.size;
      const objects: unknown[] = [];
      const calls: CallRow[] = [];
      for (let no = 1; no <= total; no++) {
        const r = results.get(`job:${job.id}:${no}`);
        if (!r) {
          objects.push({ chunk: no, missing: true });
          continue;
        }
        if (!r.ok) {
          objects.push({ chunk: no, error: r.error });
          continue;
        }
        await book.account(job, spend, calls, r.usage, 0, r.stop_reason);
        objects.push({ ...parseObject(textOf(r.content as ContentBlock[])), chunk: no });
      }
      if (isOverEstimate(spend.total, job.estimate)) {
        await book.transition(job.id, 'over_estimate', { chunks_done: objects.length, tokens: spend, result: { objects } });
        report.push({ job_id: job.id, status: 'over_estimate' });
        continue;
      }
      const { message_id } = await book.reduce(job, objects, spend, calls, null, signal);
      report.push({ job_id: job.id, status: 'done', message_id });
    } catch (e) {
      const msg = errorText(e);
      await book.fail(job, msg, spend);
      report.push({ job_id: job.id, status: 'failed', error: msg });
    }
  }
  return json({ ok: true, jobs: report });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const started = Date.now();
  const service = createServiceClient();

  let body: { action?: string; job_id?: string; mode?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const action = body.action;
  if (action !== 'accept' && action !== 'tick' && action !== 'cancel') return json({ error: 'INVALID_REQUEST', message: 'action must be accept, tick or cancel' }, 400);

  const provider = providerFromEnv((n) => Deno.env.get(n));
  const abort = new AbortController();
  const wall = setTimeout(() => abort.abort(), WALL_MS);

  try {
    if (action === 'tick') {
      if (!isServiceRoleRequest(req)) return json({ error: 'forbidden' }, 403);
      if (!provider) return json({ ok: false, error: 'NOT_CONFIGURED' });
      return await tick(new Book(service, provider), abort.signal);
    }

    const auth = await requireStaffRole(req, service, ['owner']);
    if (auth instanceof Response) return auth;
    if (!body.job_id) return json({ error: 'INVALID_REQUEST', message: 'job_id is required' }, 400);

    const { data: jobData, error: jobErr } = await service.from('assistant_jobs').select('*').eq('id', body.job_id).maybeSingle();
    if (jobErr) return json({ error: 'INTERNAL', message: jobErr.message }, 500);
    if (!jobData) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'job not found' }, 404);
    const job = jobData as JobRow;
    const { data: conv } = await service.from('assistant_conversations').select('owner_id, handles').eq('id', job.conversation_id).maybeSingle();
    if (!conv || (conv as { owner_id: string }).owner_id !== auth.userId) return json({ error: 'FORBIDDEN', message: 'not your job' }, 403);
    const asOwner = ownerClient(req);

    if (action === 'cancel') {
      const { error } = await asOwner.schema('app').rpc('assistant_job_cancel', { p_id: job.id });
      if (error) {
        const m = mapPgError(error);
        return json({ error: m.code, message: m.message }, m.status);
      }
      if (job.batch_id && provider) {
        try {
          await provider.batchCancel(job.batch_id);
        } catch (e) {
          console.error('[assistant-job] batch cancel failed', errorText(e));
        }
      }
      return json({ job_id: job.id, status: 'cancelled' });
    }

    // accept
    if (!provider) return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: 'ANTHROPIC_API_KEY is not set' }, 503);
    const mode = body.mode === 'live' || body.mode === 'batch' ? body.mode : null;
    if (!mode) return json({ error: 'INVALID_REQUEST', message: "mode must be 'live' or 'batch'" }, 400);
    if (job.status !== 'estimated') return json({ error: 'INVALID_TRANSITION', code: 'INVALID_TRANSITION', message: `job is ${job.status}` }, 409);
    if (mode === 'live' && (!job.estimate.modes.live.allowed || job.estimate.chunks > LIVE_MAX_CHUNKS)) {
      return json({ error: 'INVALID_REQUEST', message: job.estimate.modes.live.reason ?? `live jobs run at most ${LIVE_MAX_CHUNKS} chunks; choose batch` }, 400);
    }
    const chunks = chunksOf(job);
    if (typeof chunks === 'string') return json({ error: 'INVALID_REQUEST', message: chunks }, 400);

    const book = new Book(service, provider);
    await book.transition(job.id, 'accepted', { mode });
    await book.transition(job.id, 'running', { started_at: new Date().toISOString(), chunks_total: chunks.length });
    job.mode = mode;
    job.chunks_total = chunks.length;
    const handles = newHandleTable((conv as { handles: unknown }).handles);
    const tz = await venueTimezone(asOwner, service);

    return mode === 'live' ? await runLive(book, asOwner, job, chunks, handles, tz, abort.signal, started) : await submitBatch(book, asOwner, job, chunks, handles, tz);
  } catch (e) {
    const msg = errorText(e);
    console.error('[assistant-job] failed', action, msg);
    return json({ error: 'UPSTREAM', code: 'UPSTREAM', message: msg }, 502);
  } finally {
    clearTimeout(wall);
  }
});
