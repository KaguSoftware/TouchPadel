/**
 * jobRunner.ts — assistant-job's work, as behaviour (split out of
 * assistant-job/index.ts on 2026-11-11). tests/assistant-jobs.test.ts and
 * tests/assistant-edge-errors.test.ts hold the wiring by reading the source;
 * this suite RUNS it with a scripted provider and the recording fake clients
 * of tests/assistant-edge-fakes.ts (a service client for the bookkeeping, an
 * owner client for the rows):
 *
 *   * chunksOf reads the accepted estimate's per_tool by POSITION: a tool
 *     called twice with two counts pages each call by its own count (the
 *     2026-11-09 estimator fix made the counts per call; find() by name gave
 *     both calls the first count), find() stays the fallback, refusals;
 *   * runLive end to end: rows read as the owner with each chunk's page,
 *     extraction on the extraction provider, the reduce on the job's model
 *     with the objects in chunk order, the answer at the next seq, one
 *     assistant_calls row and one llm_record_usage per call at THAT call's
 *     model, reducing → done, and no tick claim touched;
 *   * runLive failures: a chunk the model refuses, a database read error
 *     (our words only in the stored error), the monthly cap at begin() and
 *     with calls in flight, the wall clock before any launch and the clock's
 *     cut of chunks in flight (TIMEOUT, never the generic error), the
 *     over-estimate pause;
 *   * Book.price: a failed llm_price_micros prices by the TypeScript estimate
 *     (never 0), the price list read once per Book;
 *   * submitBatch: request shaping, the stamped tokens, the handles saved,
 *     and its failures;
 *   * tick: claims first, reads only the claimed ids, polls only those,
 *     releases a batch still in flight by its own stamp, collects an ended
 *     one (usage recorded once per succeeded result), reduces on the job's
 *     model, and a second tick that claims nothing records nothing.
 *
 * The SQL of the claim is tests/assistant-concurrency.test.ts. provider.ts
 * never loads under vitest (npm: SDK import); it is mocked with ProviderError
 * and textOf, the two values jobRunner.ts takes from it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ceilingTokens, estimateJob, isOverEstimate, JOB_EXTRACT_MODEL, LIVE_MAX_CHUNKS, restEstimate, resumeCeiling, type JobEstimate, type JobPlan } from '../supabase/functions/_shared/assistant/estimate.ts';
import { newHandleTable, type HandleTable } from '../supabase/functions/_shared/assistant/handles.ts';
import { buildJobSystem } from '../supabase/functions/_shared/assistant/prompt.ts';
import { ASSISTANT_TOOLS, LIST_ROW_CAP } from '../supabase/functions/_shared/assistant/tools.ts';
import { FLOOR_RATES, parseRates, turnEstimateMicros } from '../supabase/functions/_shared/assistant/turnPolicy.ts';
import { argsOf, denoEnv, eqs, fakeClient, loadDenoModule, type Op, type Result } from './assistant-edge-fakes';
import { TURN_ERROR_CODES as CORE_TURN_ERROR_CODES } from '../../core/src/assistant/outcome';

const mocks = vi.hoisted(() => {
  class ProviderError extends Error {
    readonly code: string;
    readonly status?: number;
    constructor(code: string, message: string, status?: number) {
      super(message);
      this.name = 'ProviderError';
      this.code = code;
      this.status = status;
    }
  }
  return { ProviderError };
});
vi.mock('../supabase/functions/_shared/assistant/provider.ts', () => ({
  ProviderError: mocks.ProviderError,
  providerFromEnv: () => null,
  textOf: (c: { type: string; text?: string }[]) => c.filter((b) => b.type === 'text').map((b) => b.text).join(''),
  withoutThinking: (c: { type: string }[]) => c.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking'),
}));
const { ProviderError } = mocks;

// ---------------------------------------------------------------------------
// The module's surface, typed loosely (it is loaded at run time).
// ---------------------------------------------------------------------------
type Usage = { input: number; cache_write: number; cache_read: number; output: number };
type Block = { type: string; text?: string };
interface Turn { content: Block[]; usage: Usage; ms: number; stop_reason: string }
interface StreamCall { system: string; tools: unknown[]; messages: { role: string; content: string }[]; maxTokens: number; effort: string; signal: AbortSignal }
interface JobRow {
  id: string; conversation_id: string; message_id: string | null; status: string;
  plan: JobPlan & { lang?: 'en' | 'ar' }; estimate: JobEstimate; mode: 'live' | 'batch' | null;
  chunks_total: number | null; chunks_done: number; tokens: Record<string, unknown> | null; result: unknown; batch_id: string | null;
  status_at?: string | null;
}
interface Chunk { no: number; spec: { name: string }; args: Record<string, unknown>; offset: number; limit: number }
interface BookLike {
  price(u: Usage, model: string): Promise<number>;
}
interface Runner {
  Book: new (service: unknown, provider: unknown, extract?: unknown, recordRetryMs?: number) => BookLike;
  chunksOf(job: JobRow): Chunk[] | string;
  runLive(book: BookLike, asOwner: unknown, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number): Promise<Response>;
  submitBatch(book: BookLike, asOwner: unknown, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string): Promise<Response>;
  tick(book: BookLike, signal: AbortSignal, providerOr: (model: string | null | undefined, fallback: unknown) => unknown): Promise<Response>;
  WALL_MS: number;
  TICK_CLAIM_SECONDS: number;
  TURN_ERROR_CODES: readonly string[];
}

let R: Runner;
beforeAll(async () => {
  R = await loadDenoModule<Runner>('_shared/assistant/jobRunner.ts');
});

let logged: string[];
beforeEach(() => {
  vi.stubGlobal('Deno', denoEnv({}));
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    logged.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CONV = 'aaaaaaaa-0000-4000-8000-000000000001';
const MSG = 'bbbbbbbb-0000-4000-8000-000000000002';
const JOB = 'cccccccc-0000-4000-8000-000000000003';
const OPUS = 'claude-opus-5-5';
const SONNET = JOB_EXTRACT_MODEL;
const TZ = 'Asia/Baghdad';

/** The fake database's price: (input + output) micros, three times that on Opus. */
const PRICE = (model: string, u: Pick<Usage, 'input' | 'output'>) => (u.input + u.output) * (model === OPUS ? 3 : 1);

// ---------------------------------------------------------------------------
// Scripted provider
// ---------------------------------------------------------------------------
function scripted(model: string, answer: (call: StreamCall, n: number) => Turn | Promise<Turn> = () => textTurn('{}')) {
  const streams: StreamCall[] = [];
  return {
    model,
    vendor: 'anthropic',
    capabilities: { batch: true, exactTokens: true, compactMap: false, deferTools: true, resultRows: 500 },
    streams,
    stream: async (call: StreamCall) => {
      streams.push(call);
      return answer(call, streams.length);
    },
    generate: async () => {
      throw new Error('generate is not used by jobs');
    },
    countTokens: async () => 0,
    batchCreate: vi.fn(async (_requests: unknown[]) => 'msgbatch_01'),
    batchStatus: vi.fn(async (_id: string) => ({ status: 'in_progress', ended: false, counts: { processing: 3, succeeded: 0, errored: 0, canceled: 0, expired: 0 } })),
    batchResults: vi.fn(async (_id: string) => new Map<string, unknown>()),
    batchCancel: vi.fn(async (_id: string) => {}),
  };
}

function textTurn(text: string, usage: Usage = { input: 2000, cache_write: 0, cache_read: 500, output: 300 }, stop_reason = 'end_turn'): Turn {
  return { content: [{ type: 'text', text }], usage, ms: 7, stop_reason };
}

const chunkNoOf = (call: StreamCall) => Number(/This is chunk (\d+) of (\d+)\./.exec(call.messages[0]!.content)![1]);
/** Extraction: each chunk answers {chunk_sum: 100 × its number}. */
const extractor = (over: (no: number) => Turn | Promise<Turn> | null = () => null) =>
  scripted(SONNET, async (call) => {
    const no = chunkNoOf(call);
    return (await over(no)) ?? textTurn(JSON.stringify({ chunk_sum: 100 * no }));
  });
const reducer = (answer = 'Bookings totalled 600 across the three chunks.') => scripted(OPUS, () => textTurn(answer, { input: 3000, cache_write: 0, cache_read: 0, output: 400 }));

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------
interface SvcOpts {
  maxSeq?: number;
  /** llm_price_micros fails (error) for these models; `true` for every model. */
  priceFails?: boolean | string[];
  /** llm_price_micros answers null with no error. */
  priceNull?: boolean;
  pricing?: Result;
  /** begin()'s answer, or one per call (n counts from 1). */
  begin?: Result | ((n: number) => Result);
  claim?: Result;
  /** The database's assistant_jobs rows (the tick's read filters them by its chain). */
  jobs?: JobRow[];
  jobsReadError?: unknown;
  /** The first this-many llm_record_usage calls fail. */
  recordFails?: number;
  /** Plain updates of assistant_jobs (patch / save) fail. */
  jobsUpdateFails?: boolean;
  /** 0423: app.assistant_job_claim_stuck's answer (the sweeper's claim); none by default. */
  stuck?: Result;
  /** 0423: the status a `select('status')` of one job reads (Book.cancelled), by call (n from 1); no row by default. */
  status?: (n: number, id: string) => string | null;
  /** 0423: the stored assistant messages a sweep finds by `contains('sources', …)`, or a read error. */
  answers?: Result;
  /** 0423: assistant_job_transition answers this error for these statuses. */
  transitionFails?: { statuses: string[]; error: unknown };
}

function service(o: SvcOpts = {}) {
  const transitions: { p_id: string; p_status: string; p_patch: Record<string, unknown> }[] = [];
  let begins = 0;
  let records = 0;
  let statusReads = 0;
  const fake = fakeClient({
    rpc: (name, args): Result => {
      if (name === 'llm_price_micros') {
        const model = String(args.p_model);
        if (o.priceFails === true || (Array.isArray(o.priceFails) && o.priceFails.includes(model))) return { data: null, error: { code: '42883', message: 'function app.llm_price_micros does not exist' } };
        if (o.priceNull) return { data: null, error: null };
        return { data: PRICE(model, { input: Number(args.p_input), output: Number(args.p_output) }), error: null };
      }
      if (name === 'llm_begin_request') {
        begins++;
        if (typeof o.begin === 'function') return o.begin(begins);
        return o.begin ?? { data: { month_cost_micros: 0, monthly_cap_micros: 1e12 }, error: null };
      }
      if (name === 'llm_record_usage') {
        records++;
        return records <= (o.recordFails ?? 0) ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } : { data: null, error: null };
      }
      if (name === 'assistant_job_transition') {
        // snapshot: the edge serialises the patch at call time, and the spend object keeps growing after
        transitions.push(structuredClone(args) as (typeof transitions)[number]);
        if (o.transitionFails?.statuses.includes(String(args.p_status))) return { data: null, error: o.transitionFails.error };
        return { data: null, error: null };
      }
      if (name === 'assistant_job_claim_tick') return o.claim ?? { data: [], error: null };
      if (name === 'assistant_job_claim_stuck') return o.stuck ?? { data: [], error: null };
      return { data: null, error: null };
    },
    from: (table, op: Op): Result => {
      const inserting = argsOf(op, 'insert') !== undefined;
      const updating = argsOf(op, 'update') !== undefined;
      if (table === 'assistant_messages') {
        if (inserting) return { data: null, error: null };
        if (argsOf(op, 'contains')) return o.answers ?? { data: [], error: null };
        return { data: o.maxSeq === undefined ? null : { seq: o.maxSeq }, error: null };
      }
      if (table === 'platform_settings') {
        const cols = String(argsOf(op, 'select')?.[0] ?? '');
        if (cols.includes('llm_pricing')) return o.pricing ?? { data: { llm_pricing: {}, llm_cost_micros_per_mtok: 0 }, error: null };
        return { data: { timezone: TZ }, error: null };
      }
      if (table === 'assistant_jobs' && updating && o.jobsUpdateFails) return { data: null, error: { code: '57014', message: 'timeout' } };
      if (table === 'assistant_jobs' && !inserting && !updating) {
        // Book.cancelled's one-row read of the status (0423)
        if (String(argsOf(op, 'select')?.[0] ?? '') === 'status') {
          const st = o.status?.(++statusReads, String(eqs(op).id)) ?? null;
          return { data: st === null ? null : { status: st }, error: null };
        }
        if (o.jobsReadError) return { data: null, error: o.jobsReadError };
        const ids = (argsOf(op, 'in')?.[1] as string[] | undefined) ?? [];
        const e = eqs(op);
        // the tick's read asks for a batch id (`.not('batch_id', 'is', null)`); the sweeper's does not
        const needsBatch = argsOf(op, 'not')?.[0] === 'batch_id';
        const rows = (o.jobs ?? []).filter((j) => ids.includes(j.id) && (e.status === undefined || j.status === e.status) && (e.mode === undefined || j.mode === e.mode) && (!needsBatch || j.batch_id !== null));
        return { data: rows, error: null };
      }
      return { data: null, error: null };
    },
  });
  return { ...fake, transitions };
}

const rowId = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The owner's client: assistant_run_tool answers `limit` rows from `offset`, priced 1,000 IQD each. */
function owner(fail?: (args: Record<string, unknown>) => Result | null, count?: (args: Record<string, unknown>) => Result) {
  return fakeClient({
    rpc: (name, args): Result => {
      // 0423: the resume's row check, as the owner
      if (name === 'assistant_count' && count) return count(args);
      if (name !== 'assistant_run_tool') return { data: null, error: { code: 'P0001', message: 'NOT_A_TOOL' } };
      const failed = fail?.(args);
      if (failed) return failed;
      const p = args.p_args as { p_limit: number; p_offset: number };
      const rows = Array.from({ length: p.p_limit }, (_, i) => ({ id: rowId(p.p_offset + i), status: 'confirmed', price_iqd: 1000 }));
      return { data: { data: { columns: ['id', 'status', 'price_iqd'], rows, total: rows.length }, row_count: rows.length }, error: null };
    },
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
const WEEK = { from: '2026-11-01', to: '2026-11-07' };
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

function jobOf(plan: JobPlan, counts: number[], over: Partial<JobRow> = {}): JobRow {
  const est = estimateJob(plan, counts, ASSISTANT_TOOLS);
  return {
    id: JOB, conversation_id: CONV, message_id: MSG, status: 'running',
    plan: { ...plan, lang: 'en' }, estimate: { ...est, job_id: JOB, first_chunk_exact: null },
    mode: 'live', chunks_total: est.chunks, chunks_done: 0, tokens: {}, result: null, batch_id: null,
    ...over,
  };
}
/** 600 bookings in one week: three chunks of 250, 250, 100. */
const threeChunks = (over: Partial<JobRow> = {}) =>
  jobOf({ question: 'How many bookings were confirmed this week, by court?', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [600], over);

const chunksFor = (job: JobRow): Chunk[] => {
  const c = R.chunksOf(job);
  if (typeof c === 'string') throw new Error(c);
  return c;
};
const runLive = (svc: { client: unknown }, own: { client: unknown }, job: JobRow, book: BookLike, opts: { started?: number; signal?: AbortSignal; handles?: HandleTable } = {}) =>
  R.runLive(book, own.client, job, chunksFor(job), opts.handles ?? newHandleTable({}), TZ, opts.signal ?? new AbortController().signal, opts.started ?? Date.now());

const insertRows = (fake: ReturnType<typeof service>, table: string) =>
  fake.froms(table).filter((o) => argsOf(o, 'insert')).map((o) => argsOf(o, 'insert')![0]);
const statuses = (fake: ReturnType<typeof service>) => fake.transitions.map((t) => t.p_status);

// ---------------------------------------------------------------------------
describe('chunksOf: the plan paged by the accepted estimate', () => {
  it('a repeated tool with two counts pages each call by ITS count (per_tool read by position, 2026-11-09)', () => {
    const job = jobOf(
      { question: 'Bookings this week against October', calls: [{ tool: 'bookings_list', args: { ...WEEK } }, { tool: 'bookings_list', args: { ...OCTOBER } }] },
      [300, 1200],
    );
    expect(job.estimate.per_tool.map((p) => [p.tool, p.rows])).toEqual([['bookings_list', 300], ['bookings_list', 1200]]);
    const chunks = chunksFor(job);
    expect(chunks.map((c) => [c.no, c.args.from, c.offset, c.limit])).toEqual([
      [1, WEEK.from, 0, 250],
      [2, WEEK.from, 250, 50],
      [3, OCTOBER.from, 0, 250],
      [4, OCTOBER.from, 250, 250],
      [5, OCTOBER.from, 500, 250],
      [6, OCTOBER.from, 750, 250],
      [7, OCTOBER.from, 1000, 200],
    ]);
    // what was estimated and accepted is what runs (find() by name made this 2 + 2 chunks)
    expect(chunks).toHaveLength(job.estimate.chunks);
  });

  it('the two different counts drive two different page runs as the owner', async () => {
    const job = jobOf(
      { question: 'Bookings this week against October', calls: [{ tool: 'bookings_list', args: { ...WEEK } }, { tool: 'bookings_list', args: { ...OCTOBER } }] },
      [300, 1200],
    );
    const svc = service();
    const own = owner();
    const res = await runLive(svc, own, job, new R.Book(svc.client, reducer(), extractor()));
    expect(res.status).toBe(200);
    const reads = own.rpcs('assistant_run_tool').map((o) => (o.args as { p_args: Record<string, unknown> }).p_args);
    const pages = (from: string) => reads.filter((a) => a.p_from === from).map((a) => [a.p_offset, a.p_limit]);
    expect(pages(WEEK.from)).toEqual([[0, 250], [250, 50]]);
    expect(pages(OCTOBER.from)).toEqual([[0, 250], [250, 250], [500, 250], [750, 250], [1000, 200]]);
    expect(svc.rpcs('assistant_run_tool')).toEqual([]); // never the service role
  });

  it('an estimate stored with fewer rows than calls falls back to the row of that tool', () => {
    const job = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [300]);
    job.plan.calls.push({ tool: 'bookings_list', args: { ...OCTOBER } });
    const chunks = chunksFor(job);
    expect(chunks.map((c) => [c.args.from, c.offset, c.limit])).toEqual([
      [WEEK.from, 0, 250], [WEEK.from, 250, 50],
      [OCTOBER.from, 0, 250], [OCTOBER.from, 250, 50],
    ]);
  });

  it('strips limit and offset from the call, caps the page at LIST_ROW_CAP, and refuses what it cannot run', () => {
    const job = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK, limit: 5, offset: 40 } }] }, [10]);
    job.estimate.per_tool[0]!.chunk_rows = LIST_ROW_CAP * 4;
    job.estimate.per_tool[0]!.rows = LIST_ROW_CAP + 1;
    const chunks = chunksFor(job);
    expect(chunks[0]!.args).toEqual({ ...WEEK });
    expect(chunks.map((c) => [c.offset, c.limit])).toEqual([[0, LIST_ROW_CAP], [LIST_ROW_CAP, 1]]);

    expect(R.chunksOf(jobOf({ question: 'q', calls: [{ tool: 'report_revenue', args: { ...WEEK } }] }, [1]))).toBe('report_revenue is not a list tool');
    const noRow = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [1]);
    noRow.estimate.per_tool = [];
    expect(R.chunksOf(noRow)).toBe('bookings_list has no estimate row');
    const bad = R.chunksOf(jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { from: 'yesterday', to: WEEK.to } }] }, [1]));
    expect(bad).toMatch(/^bookings_list: /);
  });
});

// ---------------------------------------------------------------------------
describe('runLive: accept → chunks → reduce → the answer in the chat', () => {
  it('reads each page as the owner, extracts on the extraction model, reduces on the job model, stores the answer and every call', async () => {
    const svc = service({ maxSeq: 6 });
    const own = owner();
    const ex = extractor();
    const rd = reducer();
    const job = threeChunks();
    const res = await runLive(svc, own, job, new R.Book(svc.client, rd, ex));

    // the rows: one read per chunk, as the owner, with the chunk's page
    const reads = own.rpcs('assistant_run_tool');
    expect(reads.map((o) => o.schema)).toEqual(['app', 'app', 'app']);
    expect(reads.map((o) => o.args)).toEqual([0, 250, 500].map((off, i) => ({ p_tool: 'assistant_bookings_list', p_args: { p_from: WEEK.from, p_to: WEEK.to, p_limit: [250, 250, 100][i], p_offset: off } })));

    // extraction: the fixed prompt, low effort, no tools, the row ids never in the prompt
    expect(ex.streams.map(chunkNoOf).sort()).toEqual([1, 2, 3]);
    for (const c of ex.streams) {
      expect(c).toMatchObject({ system: buildJobSystem(), tools: [], maxTokens: 2000, effort: 'low' });
      expect(c.messages[0]!.content).not.toContain(rowId(0));
    }
    // the reduce: once, on the job's model, the objects in chunk order
    expect(rd.streams).toHaveLength(1);
    expect(rd.streams[0]).toMatchObject({ tools: [], maxTokens: 4000, effort: 'high' });
    const data = /<data source="job_chunks" rows="3">\n(.*)\n<\/data>/.exec(rd.streams[0]!.messages[0]!.content)![1]!;
    expect(JSON.parse(data)).toEqual([1, 2, 3].map((no) => ({ chunk_sum: 100 * no, chunk: no, tool: 'bookings_list', rows_read: [250, 250, 100][no - 1] })));

    // the answer, at the next seq, with the job as its source
    const [msg] = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ job_id: JOB, status: 'done', chunks_done: 3, message_id: msg!.id });
    expect(msg).toMatchObject({ conversation_id: CONV, seq: 7, role: 'assistant', content: [{ type: 'text', text: 'Bookings totalled 600 across the three chunks.' }], sources: [{ job_id: JOB, chunks: 3, rows: 600 }] });
    expect(msg!.tokens).toMatchObject({ calls: 4, model: OPUS, extract_model: SONNET });

    // one assistant_calls row per call, each priced at the model that served it
    const [calls] = insertRows(svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls).toHaveLength(4);
    expect(calls!.map((c) => c.call_no)).toEqual([1, 2, 3, 4]);
    expect(calls!.map((c) => c.message_id)).toEqual([msg!.id, msg!.id, msg!.id, msg!.id]);
    expect(calls!.map((c) => [c.model, c.cost_micros])).toEqual([
      [SONNET, PRICE(SONNET, { input: 2000, output: 300 })],
      [SONNET, PRICE(SONNET, { input: 2000, output: 300 })],
      [SONNET, PRICE(SONNET, { input: 2000, output: 300 })],
      [OPUS, PRICE(OPUS, { input: 3000, output: 400 })],
    ]);
    // llm_record_usage once per call at its model, on the job surface; begin() once per call
    expect(svc.rpcs('llm_record_usage').map((o) => [(o.args as Record<string, unknown>).p_model, (o.args as Record<string, unknown>).p_model_calls, (o.args as Record<string, unknown>).p_surface])).toEqual([
      [SONNET, 1, 'assistant_job'], [SONNET, 1, 'assistant_job'], [SONNET, 1, 'assistant_job'], [OPUS, 1, 'assistant_job'],
    ]);
    expect(svc.rpcs('llm_begin_request')).toHaveLength(4);

    // reducing → done, the done patch carrying the answer; the conversation touched last
    expect(statuses(svc)).toEqual(['reducing', 'done']);
    expect(svc.transitions[0]!.p_patch).toMatchObject({ chunks_done: 3 });
    const done = svc.transitions[1]!.p_patch as { chunks_done: number; tokens: Record<string, number>; result: Record<string, unknown> };
    expect(done.chunks_done).toBe(3);
    expect(done.result).toMatchObject({ message_id: msg!.id, answer: 'Bookings totalled 600 across the three chunks.', objects: 3 });
    expect(done.tokens.cost_micros).toBe(3 * PRICE(SONNET, { input: 2000, output: 300 }) + PRICE(OPUS, { input: 3000, output: 400 }));
    expect(done.tokens).toMatchObject({ calls: 4, input: 9000, output: 1300, cache_read: 1500, total: 11_800 });
    const conv = svc.froms('assistant_conversations').find((o) => argsOf(o, 'update'))!;
    expect(eqs(conv)).toEqual({ id: CONV });
    expect(argsOf(conv, 'update')![0]).toHaveProperty('handles');

    // the progress patches only ever grow; a live job never touches the tick's lease
    const progress = svc.froms('assistant_jobs').map((o) => argsOf(o, 'update')?.[0] as Record<string, unknown>).filter((p) => p && 'chunks_done' in p).map((p) => p.chunks_done as number);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(3);
    expect(svc.rpcs('assistant_job_claim_tick')).toEqual([]);
    expect(svc.ops.some((o) => JSON.stringify(argsOf(o, 'update') ?? []).includes('tick_claimed_until'))).toBe(false);
  });

  it('a chunk the model refuses fails the job with its code; the chunks that ran are still recorded, nothing is reduced, the chat gets a failed message', async () => {
    const svc = service({ maxSeq: 4 });
    const ex = extractor((no) => (no === 2 ? Promise.reject(new ProviderError('RATE_LIMITED', 'vendor said: slow down, org-secret-42', 429)) : null));
    const rd = reducer();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ job_id: JOB, status: 'failed', error: 'RATE_LIMITED', message: 'the model is rate-limited right now; try again in a minute', chunks_done: 2 });
    expect(statuses(svc)).toEqual(['failed']);
    expect(svc.transitions[0]!.p_patch.error).toBe('RATE_LIMITED: the model is rate-limited right now; try again in a minute');
    // the objects already paid for stay on the job
    expect((svc.transitions[0]!.p_patch.result as { objects: unknown[] }).objects).toHaveLength(2);
    expect(JSON.stringify(svc.transitions)).not.toContain('org-secret-42');
    expect(logged.join('\n')).toContain(`live job ${JOB} failed (RATE_LIMITED)`);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(2); // spent is spent
    expect(rd.streams).toEqual([]);
    // the chat's failed-turn shape (persist.ts): one empty text block, error_code and stop_reason
    const msgs = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ conversation_id: CONV, seq: 5, role: 'assistant', content: [{ type: 'text', text: '' }], gate: null, sources: [{ job_id: JOB, chunks: 2, rows: 600 }] });
    expect(msgs[0]!.tokens).toMatchObject({ error_code: 'RATE_LIMITED', stop_reason: 'RATE_LIMITED', job_error: 'RATE_LIMITED', calls: 2 });
    expect(JSON.stringify(msgs)).not.toContain('org-secret-42');
    const [calls] = insertRows(svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls!.map((c) => [c.message_id, c.model])).toEqual([[msgs[0]!.id, SONNET], [msgs[0]!.id, SONNET]]);
  });

  it('a database error on a chunk read is UPSTREAM with our sentence; the raw Postgres text reaches the log only', async () => {
    const svc = service();
    const own = owner((a) => ((a.p_args as { p_offset: number }).p_offset === 250 ? { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "guest-secret-9"' } } : null));
    const res = await runLive(svc, own, threeChunks(), new R.Book(svc.client, reducer(), extractor()));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'UPSTREAM', message: 'the job failed' });
    expect(svc.transitions.at(-1)!.p_patch.error).toBe('UPSTREAM: the job failed');
    expect(JSON.stringify(svc.transitions)).not.toContain('guest-secret-9');
    expect(logged.join('\n')).toContain('guest-secret-9');
    expect(logged.join('\n')).toContain('bookings_list chunk 2: 22P02: the database refused this call (22P02)');
  });

  it('the monthly cap refused at begin() is a 429 with its code', async () => {
    const svc = service({ begin: { data: null, error: { code: 'P0001', message: 'LLM_MONTHLY_CAP' } } });
    const ex = extractor();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'LLM_MONTHLY_CAP', message: 'the monthly assistant budget is used up' });
    expect(svc.transitions.at(-1)!.p_patch.error).toBe('LLM_MONTHLY_CAP: the monthly assistant budget is used up');
    expect(ex.streams).toEqual([]);
  });

  it('with calls in flight the cap stops new launches one call short of the month (pool.ts budgetAllows)', async () => {
    // the job fits on the first reading; other spending lands before the next begin()
    const svc = service({ begin: (n) => ({ data: { month_cost_micros: n === 1 ? 0 : 999_999_999, monthly_cap_micros: 1_000_000_000 }, error: null }) });
    const ex = extractor();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex));
    expect(ex.streams).toHaveLength(1); // the first passes on the reading, the others count it in flight
    // 0423: the chunk already paid for is kept: the job pauses (cap) instead of failing
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'over_estimate', reason: 'cap', chunks_done: 1 });
    expect(statuses(svc)).toEqual(['over_estimate']);
    const pause = (svc.transitions[0]!.p_patch.result as { pause: { reason: string; chunks_left: number[] } }).pause;
    expect(pause).toMatchObject({ reason: 'cap', chunks_left: [2, 3] });
    expect(svc.rpcs('llm_record_usage')).toHaveLength(1);
    expect(insertRows(svc, 'assistant_messages')).toEqual([]);
  });

  it('past the launch cutoff nothing launches and the job fails as TIMEOUT, re-run as batch', async () => {
    const svc = service();
    const ex = extractor();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex), { started: Date.now() - R.WALL_MS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: JOB, status: 'failed', error: 'TIMEOUT', chunks_done: 0 });
    expect(svc.transitions.at(-1)!.p_patch.error).toBe('TIMEOUT: 0 of 3 chunks done inside the wall clock; re-run as batch');
    expect(ex.streams).toEqual([]);
  });

  it('chunks in flight at extractBy are cut on their own signal: TIMEOUT, never the generic failure, and the request signal is untouched', async () => {
    vi.useFakeTimers();
    const svc = service();
    const request = new AbortController();
    const ex = scripted(SONNET, (call) => new Promise<Turn>((_ok, ko) => call.signal.addEventListener('abort', () => ko(new ProviderError('TIMEOUT', 'aborted')))));
    const pending = runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex), { signal: request.signal });
    await vi.advanceTimersByTimeAsync(R.WALL_MS);
    const res = await pending;
    expect(ex.streams).toHaveLength(3);
    expect(ex.streams.every((c) => c.signal.aborted)).toBe(true);
    expect(request.signal.aborted).toBe(false);
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'TIMEOUT', chunks_done: 0 });
    expect(svc.transitions.at(-1)!.p_patch.error).toMatch(/^TIMEOUT: 0 of 3 chunks/);
  });

  it('spend past the estimate × 1.25 with chunks still unread stops the launches and pauses in over_estimate, objects kept, no reduce', async () => {
    const svc = service();
    const rd = reducer();
    const ex = extractor(() => textTurn('{"n":1}', { input: 900_000, cache_write: 0, cache_read: 0, output: 100 }));
    const job = jobOf({ question: 'Bookings this week', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [1500]); // 6 chunks
    const res = await runLive(svc, owner(), job, new R.Book(svc.client, rd, ex));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ job_id: JOB, status: 'over_estimate', chunks_done: 4 });
    expect(ex.streams).toHaveLength(4); // the four in flight finished; chunks 5 and 6 never launched
    expect(statuses(svc)).toEqual(['over_estimate']);
    const patch = svc.transitions[0]!.p_patch as { result: { objects: unknown[] } };
    expect(patch.result.objects).toHaveLength(4);
    expect(rd.streams).toEqual([]);
  });

  it('an overrun found only once every chunk is read still reduces: the extraction is paid for (review 2026-11-11)', async () => {
    const svc = service();
    const rd = reducer();
    const ex = extractor(() => textTurn('{"n":1}', { input: 900_000, cache_write: 0, cache_read: 0, output: 100 }));
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    expect(await res.json()).toMatchObject({ job_id: JOB, status: 'done', chunks_done: 3 });
    expect(statuses(svc)).toEqual(['reducing', 'done']);
    expect(rd.streams).toHaveLength(1);
    expect(logged.join('\n')).toContain('reducing anyway');
  });

  it('the reduce runs past the monthly cap or the daily quota once every chunk is read (begin() is still called)', async () => {
    for (const code of ['LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA']) {
      const svc = service({ begin: (n) => (n <= 3 ? { data: { month_cost_micros: 0, monthly_cap_micros: 1e12 }, error: null } : { data: null, error: { code: 'P0001', message: code } }) });
      const rd = reducer();
      const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, extractor()));
      expect(await res.json(), code).toMatchObject({ status: 'done' });
      expect(svc.rpcs('llm_begin_request'), code).toHaveLength(4);
      expect(rd.streams, code).toHaveLength(1);
      expect(statuses(svc), code).toEqual(['reducing', 'done']);
    }
  });

  it('the codes a failed job may store are exactly the ones both clients render (core outcome.ts)', () => {
    expect([...R.TURN_ERROR_CODES].sort()).toEqual([...CORE_TURN_ERROR_CODES].sort());
  });

  it('a job whose high-band estimate does not fit what is left of the month never starts: LLM_MONTHLY_CAP, no chunk paid for', async () => {
    const svc = service({ begin: { data: { month_cost_micros: 990, monthly_cap_micros: 1000 }, error: null } });
    const ex = extractor();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'LLM_MONTHLY_CAP', chunks_done: 0 });
    expect(ex.streams).toEqual([]);
    expect(svc.rpcs('llm_record_usage')).toEqual([]);
    // the failure message carries the cap's own code: both clients have a sentence for it (2026-11-12)
    const [msg] = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msg!.tokens).toMatchObject({ error_code: 'LLM_MONTHLY_CAP', stop_reason: 'LLM_MONTHLY_CAP', job_error: 'LLM_MONTHLY_CAP' });
  });

  it('a chunk cut mid-stream is metered from its partial usage (stop reason aborted), as the chat meters a cut call', async () => {
    const svc = service();
    const partial = { usage: { input: 1500, cache_write: 0, cache_read: 0, output: 40 }, ms: 900, webSearches: 0 };
    const ex = extractor((no) => (no === 2 ? Promise.reject(Object.assign(new ProviderError('UPSTREAM', 'overloaded mid-answer', 529), { partial })) : null));
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex));
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'UPSTREAM' });
    const recs = svc.rpcs('llm_record_usage').map((o) => o.args as Record<string, unknown>);
    expect(recs).toHaveLength(3);
    expect(recs).toContainEqual(expect.objectContaining({ p_model: SONNET, p_input: 1500, p_output: 40, p_model_calls: 1 }));
    const [calls] = insertRows(svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls!.filter((c) => c.stop_reason === 'aborted')).toEqual([expect.objectContaining({ model: SONNET, input_tokens: 1500, output_tokens: 40, ms: 900 })]);
    expect((svc.transitions.at(-1)!.p_patch.tokens as Record<string, number>).calls).toBe(3);
  });

  it('chunks cut by the clock are metered too, and the job still ends as TIMEOUT', async () => {
    vi.useFakeTimers();
    const svc = service();
    const partial = { usage: { input: 800, cache_write: 0, cache_read: 0, output: 10 }, ms: 1, webSearches: 0 };
    const ex = scripted(SONNET, (call) => new Promise<Turn>((_ok, ko) => call.signal.addEventListener('abort', () => ko(Object.assign(new ProviderError('TIMEOUT', 'aborted'), { partial })))));
    const pending = runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex));
    await vi.advanceTimersByTimeAsync(R.WALL_MS);
    expect(await (await pending).json()).toMatchObject({ status: 'failed', error: 'TIMEOUT', chunks_done: 0 });
    expect(svc.rpcs('llm_record_usage')).toHaveLength(3);
    const [msg] = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msg!.tokens).toMatchObject({ error_code: 'TIMEOUT', calls: 3, input: 2400 });
  });

  it('a reduce cut mid-stream is metered at the job model before the job fails', async () => {
    const svc = service();
    const partial = { usage: { input: 3000, cache_write: 0, cache_read: 0, output: 120 }, ms: 4000, webSearches: 0 };
    const rd = scripted(OPUS, () => Promise.reject(Object.assign(new ProviderError('UPSTREAM', 'connection reset'), { partial })));
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, extractor()));
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'UPSTREAM', chunks_done: 3 });
    expect(svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([SONNET, SONNET, SONNET, OPUS]);
    expect(statuses(svc)).toEqual(['failed']);
    expect((svc.transitions[0]!.p_patch.result as { objects: unknown[] }).objects).toHaveLength(3);
  });

  it('a failed usage record is retried once; a second failure is logged loudly with the amounts', async () => {
    const once = service({ recordFails: 1 });
    await runLive(once, owner(), threeChunks(), new R.Book(once.client, reducer(), extractor(), 0));
    expect(once.rpcs('llm_record_usage')).toHaveLength(5); // four calls, one of them twice
    expect(logged.join('\n')).toContain('llm_record_usage failed; retrying once');
    expect(logged.join('\n')).not.toContain('SPEND NOT RECORDED');

    // one chunk, so the two failures are the same record and its retry
    const twice = service({ recordFails: 2 });
    const oneChunk = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [250]);
    const res = await runLive(twice, owner(), oneChunk, new R.Book(twice.client, reducer(), extractor(), 0));
    expect(await res.json()).toMatchObject({ status: 'done' }); // the job never fails on its bookkeeping
    expect(twice.rpcs('llm_record_usage')).toHaveLength(3);
    expect(logged.join('\n')).toMatch(/SPEND NOT RECORDED: llm_record_usage failed twice; reconcile by hand: \{"p_model":"claude-sonnet-5-5","p_input":2000/);
  });

  it('an empty reduce is never stored as a finished job: failed, with the failure message', async () => {
    const svc = service();
    const rd = scripted(OPUS, () => textTurn('', { input: 3000, cache_write: 0, cache_read: 0, output: 4000 }, 'max_tokens'));
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, extractor()));
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'UPSTREAM' });
    expect(statuses(svc)).toEqual(['failed']);
    const msgs = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.tokens).toMatchObject({ error_code: 'UPSTREAM', calls: 4 });
    expect(logged.join('\n')).toContain('the reduce wrote no text (stop_reason max_tokens)');
  });

  it('a reduce cut off at max_tokens with text is stored marked as cut off (tokens.stop_reason, as the chat stores it)', async () => {
    const svc = service();
    const rd = scripted(OPUS, () => textTurn('Bookings totalled 600 and then', { input: 3000, cache_write: 0, cache_read: 0, output: 4000 }, 'max_tokens'));
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, extractor()));
    expect(await res.json()).toMatchObject({ status: 'done' });
    const [msg] = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msg!.tokens).toMatchObject({ stop_reason: 'max_tokens' });
    expect(msg!.tokens).not.toHaveProperty('error_code');
    expect((svc.transitions.at(-1)!.p_patch.result as Record<string, unknown>).stop_reason).toBe('max_tokens');
    // and an ordinary answer carries end_turn
    const ok = service();
    await runLive(ok, owner(), threeChunks(), new R.Book(ok.client, reducer(), extractor()));
    expect((insertRows(ok, 'assistant_messages')[0] as Record<string, unknown>).tokens).toMatchObject({ stop_reason: 'end_turn' });
  });

  it('live chunks are offered only up to what the clock finishes (LIVE_MAX_CHUNKS from pool.ts)', () => {
    const fits = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [250 * 8]);
    const over = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [250 * 8 + 1]);
    expect(fits.estimate.modes.live.allowed).toBe(true);
    expect(over.estimate.chunks).toBe(9);
    expect(over.estimate.modes.live.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Book.price: the TypeScript estimate when llm_price_micros cannot say', () => {
  const u: Usage = { input: 12_000, cache_write: 1_000, cache_read: 40_000, output: 2_500 };
  const pricing = { [SONNET]: { input: 3_000_000, cache_write: 3_750_000, cache_read: 300_000, output: 15_000_000 } };

  it('a failed read prices from the price list (never 0), read once per Book, and says so in the log', async () => {
    const svc = service({ priceFails: true, pricing: { data: { llm_pricing: pricing, llm_cost_micros_per_mtok: 0 }, error: null } });
    const book = new R.Book(svc.client, reducer(), extractor());
    const want = turnEstimateMicros(SONNET, u, parseRates(pricing), 0);
    expect(want).toBeGreaterThan(0);
    expect(await book.price(u, SONNET)).toBe(want);
    expect(await book.price(u, SONNET)).toBe(want);
    expect(svc.froms('platform_settings')).toHaveLength(1);
    expect(logged.join('\n')).toContain(`${SONNET} priced by the TypeScript estimate`);
  });

  it('an answer of null (no error) is a failed read too', async () => {
    const svc = service({ priceNull: true });
    expect(await new R.Book(svc.client, reducer()).price(u, OPUS)).toBe(turnEstimateMicros(OPUS, u, {}, 0));
    expect(logged.join('\n')).toContain('llm_price_micros answered null');
  });

  it('an unread price list prices at the floor rates, and says that too', async () => {
    const svc = service({ priceFails: true, pricing: { data: null, error: { code: '42501', message: 'denied' } } });
    const got = await new R.Book(svc.client, reducer()).price(u, OPUS);
    expect(got).toBe(turnEstimateMicros(OPUS, u, { [OPUS]: FLOOR_RATES }));
    expect(got).toBeGreaterThan(0);
    expect(logged.join('\n')).toContain('price list unread; estimating at the floor rates');
  });

  it('end to end: a live job whose price reads all fail stores estimated costs, and the in-flight cap still holds', async () => {
    const svc = service({ priceFails: true });
    await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), extractor()));
    const [calls] = insertRows(svc, 'assistant_calls') as { cost_micros: number }[][];
    expect(calls!.every((c) => c.cost_micros > 0)).toBe(true);
    expect(calls!.at(-1)!.cost_micros).toBe(turnEstimateMicros(OPUS, { input: 3000, cache_write: 0, cache_read: 0, output: 400 }, {}, 0));

    // a 0 first reading used to switch off the in-flight allowance (review 2026-11-09)
    const capped = service({ priceFails: true, begin: (n) => ({ data: { month_cost_micros: n === 1 ? 0 : 999_999_999, monthly_cap_micros: 1_000_000_000 }, error: null }) });
    const ex = extractor();
    await runLive(capped, owner(), threeChunks(), new R.Book(capped.client, reducer(), ex));
    expect(ex.streams).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('submitBatch: one Batch API request per chunk', () => {
  it('shapes every request, creates the batch on the extraction provider, stamps the models and saves the handles', async () => {
    const svc = service();
    const own = owner();
    const ex = extractor();
    const rd = reducer();
    const job = threeChunks({ mode: 'batch', tokens: { model: OPUS } });
    const res = await R.submitBatch(new R.Book(svc.client, rd, ex), own.client, job, chunksFor(job), newHandleTable({}), TZ);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: JOB, status: 'running', mode: 'batch', batch_id: 'msgbatch_01', chunks_total: 3 });

    expect(svc.rpcs('llm_begin_request')).toHaveLength(1); // one cap check; the tick records the real usage
    expect(svc.rpcs('llm_record_usage')).toEqual([]);
    expect(own.rpcs('assistant_run_tool')).toHaveLength(3);
    expect(rd.batchCreate).not.toHaveBeenCalled();
    const requests = ex.batchCreate.mock.calls[0]![0] as { custom_id: string; system: string; messages: { role: string; content: string }[]; maxTokens: number; effort: string }[];
    expect(requests.map((r) => r.custom_id)).toEqual([`job:${JOB}:1`, `job:${JOB}:2`, `job:${JOB}:3`]);
    for (const [i, r] of requests.entries()) {
      expect(r).toMatchObject({ system: buildJobSystem(), maxTokens: 2000, effort: 'low' });
      expect(r.messages).toHaveLength(1);
      expect(r.messages[0]!.role).toBe('user');
      expect(r.messages[0]!.content).toContain(`This is chunk ${i + 1} of 3.`);
      expect(r.messages[0]!.content).toContain('Question: How many bookings were confirmed this week, by court?');
      expect(r.messages[0]!.content).not.toContain(rowId(0));
    }

    const updates = svc.froms('assistant_jobs').filter((o) => argsOf(o, 'update'));
    // 0423: the row says a batch is being created before the vendor is asked (the sweeper's stalled_submit reads it)
    expect(Object.keys(argsOf(updates[0]!, 'update')![0] as object)).toEqual(['result']);
    expect((argsOf(updates[0]!, 'update')![0] as { result: Record<string, unknown> }).result).toEqual({ submitting_at: expect.any(String) });
    const patch = updates[1]!;
    expect(eqs(patch)).toEqual({ id: JOB });
    expect(argsOf(patch, 'update')![0]).toEqual({ batch_id: 'msgbatch_01', chunks_total: 3, tokens: { model: OPUS, extract_model: SONNET } });
    const conv = svc.froms('assistant_conversations').find((o) => argsOf(o, 'update'))!;
    expect(eqs(conv)).toEqual({ id: CONV });
    expect(Object.keys(argsOf(conv, 'update')![0] as object).sort()).toEqual(['handles', 'updated_at']);
    expect(svc.transitions).toEqual([]); // the job stays running
  });

  it('a batch the vendor refuses is a 502 with its code and a failed job', async () => {
    const svc = service();
    const ex = extractor();
    ex.batchCreate.mockRejectedValueOnce(new ProviderError('UPSTREAM', 'overloaded: req_secret'));
    const job = threeChunks({ mode: 'batch' });
    const res = await R.submitBatch(new R.Book(svc.client, reducer(), ex), owner().client, job, chunksFor(job), newHandleTable({}), TZ);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ job_id: JOB, status: 'failed', error: 'UPSTREAM', message: 'the job failed' });
    expect(svc.transitions.at(-1)).toMatchObject({ p_status: 'failed', p_patch: { error: 'UPSTREAM: the job failed' } });
    expect(logged.join('\n')).toContain(`batch job ${JOB} not submitted (UPSTREAM)`);
  });

  it('the cap at submission answers 429 with the cap code, the same code the job stores (as the live path does)', async () => {
    const svc = service({ begin: { data: null, error: { code: 'P0001', message: 'LLM_MONTHLY_CAP' } } });
    const ex = extractor();
    const job = threeChunks({ mode: 'batch' });
    const res = await R.submitBatch(new R.Book(svc.client, reducer(), ex), owner().client, job, chunksFor(job), newHandleTable({}), TZ);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'LLM_MONTHLY_CAP', message: 'the monthly assistant budget is used up' });
    expect(svc.transitions.at(-1)!.p_patch.error).toBe('LLM_MONTHLY_CAP: the monthly assistant budget is used up');
    expect(ex.batchCreate).not.toHaveBeenCalled();
  });

  it('a job whose high-band estimate does not fit what is left of the month is refused before batchCreate, with the same cap refusal', async () => {
    const job = threeChunks({ mode: 'batch' });
    // what the job costs at its high band in the fake's prices: the chunks at Sonnet, the reduce at Opus
    const step = (t: { input: number; output: number }, m: string) => PRICE(m, t);
    const jobMicros = step(job.estimate.by_step!.extract.tokens_high, SONNET) + step(job.estimate.by_step!.reduce.tokens_high, OPUS);
    const cap = 1_000_000;
    const tight = service({ begin: { data: { month_cost_micros: cap - jobMicros + 1, monthly_cap_micros: cap }, error: null } });
    const ex = extractor();
    const res = await R.submitBatch(new R.Book(tight.client, reducer(), ex), owner().client, job, chunksFor(job), newHandleTable({}), TZ);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ status: 'failed', error: 'LLM_MONTHLY_CAP', message: 'the monthly assistant budget is used up' });
    expect(tight.transitions.at(-1)!.p_patch.error).toBe('LLM_MONTHLY_CAP: the monthly assistant budget is used up');
    expect(ex.batchCreate).not.toHaveBeenCalled();
    expect(tight.rpcs('llm_begin_request')).toHaveLength(1);

    // exactly what is left still fits
    const exact = service({ begin: { data: { month_cost_micros: cap - jobMicros, monthly_cap_micros: cap }, error: null } });
    const ex2 = extractor();
    const ok = await R.submitBatch(new R.Book(exact.client, reducer(), ex2), owner().client, job, chunksFor(job), newHandleTable({}), TZ);
    expect(ok.status).toBe(200);
    expect(ex2.batchCreate).toHaveBeenCalledTimes(1);
  });

  it('a batch whose id cannot be saved on the job is cancelled (no tick would ever collect it) and the job fails', async () => {
    const svc = service({ jobsUpdateFails: true });
    const ex = extractor();
    const job = threeChunks({ mode: 'batch' });
    const res = await R.submitBatch(new R.Book(svc.client, reducer(), ex), owner().client, job, chunksFor(job), newHandleTable({}), TZ);
    expect(res.status).toBe(502);
    expect(ex.batchCreate).toHaveBeenCalledTimes(1);
    expect(ex.batchCancel).toHaveBeenCalledWith('msgbatch_01');
    expect(statuses(svc)).toEqual(['failed']);
  });
});

// ---------------------------------------------------------------------------
describe('tick: claim, poll, collect, reduce, release (0405)', () => {
  const A = 'eeeeeeee-0000-4000-8000-00000000000a';
  const B = 'eeeeeeee-0000-4000-8000-00000000000b';
  const C = 'eeeeeeee-0000-4000-8000-00000000000c';
  const STAMP_A = '2026-11-11T10:02:00.000Z';
  const STAMP_B = '2026-11-11T10:02:00.001Z';
  const batchJob = (id: string, batch: string, tokens: Record<string, unknown> = { model: OPUS, extract_model: SONNET }) =>
    threeChunks({ id, mode: 'batch', batch_id: batch, tokens });

  /** A ended with chunk 1 ok, chunk 2 errored, chunk 3 missing; the others still in flight. */
  function world(o: { claim?: Result; jobs?: JobRow[]; opus?: ReturnType<typeof scripted>; svc?: SvcOpts } = {}) {
    const svc = service({
      maxSeq: 2,
      claim: o.claim ?? { data: [{ job_id: A, claimed_until: STAMP_A }, { job_id: B, claimed_until: STAMP_B }], error: null },
      jobs: o.jobs ?? [batchJob(A, 'batch_A'), batchJob(B, 'batch_B'), batchJob(C, 'batch_C')],
      ...o.svc,
    });
    const fallback = scripted('the-tick-default');
    const opus = o.opus ?? reducer('Three chunks read; one errored, one missing.');
    const sonnet = scripted(SONNET);
    sonnet.batchStatus.mockImplementation(async (id: string) =>
      id === 'batch_A'
        ? { status: 'ended', ended: true, counts: { processing: 0, succeeded: 1, errored: 1, canceled: 0, expired: 1 } }
        : { status: 'in_progress', ended: false, counts: { processing: 2, succeeded: 1, errored: 0, canceled: 0, expired: 0 } },
    );
    sonnet.batchResults.mockImplementation(async () =>
      new Map<string, unknown>([
        [`job:${A}:1`, { ok: true, content: [{ type: 'text', text: '{"chunk_sum":250}' }], usage: { input: 2000, cache_write: 0, cache_read: 0, output: 300 }, stop_reason: 'end_turn' }],
        [`job:${A}:2`, { ok: false, error: 'errored' }],
      ]),
    );
    const providerOr = vi.fn((model: string | null | undefined, fb: unknown) => (model === OPUS ? opus : model === SONNET ? sonnet : fb));
    return { svc, fallback, opus, sonnet, providerOr, tick: () => R.tick(new R.Book(svc.client, fallback), new AbortController().signal, providerOr) };
  }

  it('claims first (120 s lease), reads only the claimed ids with the predicate, and polls only those batches', async () => {
    const w = world();
    const res = await w.tick();
    expect(res.status).toBe(200);
    const claim = w.svc.rpcs('assistant_job_claim_tick');
    expect(claim).toHaveLength(1);
    expect(claim[0]!.schema).toBe('app');
    expect(claim[0]!.args).toEqual({ p_seconds: R.TICK_CLAIM_SECONDS });
    expect(R.TICK_CLAIM_SECONDS).toBe(120);
    // 0423: the sweeper's claim is the one call before it
    expect(w.svc.ops[0]).toMatchObject({ kind: 'rpc', name: 'assistant_job_claim_stuck', schema: 'app', args: { p_seconds: 120, p_limit: 10 } });
    expect(w.svc.ops.indexOf(claim[0]!)).toBe(1);
    const read = w.svc.froms('assistant_jobs').find((o) => argsOf(o, 'select'))!;
    expect(argsOf(read, 'in')).toEqual(['id', [A, B]]);
    expect(eqs(read)).toEqual({ status: 'running', mode: 'batch' });
    expect(argsOf(read, 'not')).toEqual(['batch_id', 'is', null]);
    expect(w.sonnet.batchStatus.mock.calls.map((c) => c[0]).sort()).toEqual(['batch_A', 'batch_B']); // never C's
  });

  it('a batch still in flight: its chunks_done patched, only ITS claim released (by the stamp), nothing recorded for it', async () => {
    const w = world();
    const body = (await (await w.tick()).json()) as { ok: boolean; jobs: Record<string, unknown>[] };
    expect(body.jobs.find((j) => j.job_id === B)).toEqual({ job_id: B, status: 'in_progress', counts: { processing: 2, succeeded: 1, errored: 0, canceled: 0, expired: 0 } });
    const releases = w.svc.froms('assistant_jobs').filter((o) => (argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined)?.tick_claimed_until === null);
    expect(releases).toHaveLength(1);
    expect(eqs(releases[0]!)).toEqual({ id: B, tick_claimed_until: STAMP_B });
    const patchB = w.svc.froms('assistant_jobs').find((o) => eqs(o).id === B && (argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined)?.chunks_done !== undefined)!;
    expect(argsOf(patchB, 'update')![0]).toEqual({ chunks_done: 1 });
  });

  it('an ended batch: results collected by custom_id, usage recorded once per succeeded result, reduced on the job model, done, claim left to the status', async () => {
    const w = world();
    const body = (await (await w.tick()).json()) as { ok: boolean; jobs: Record<string, unknown>[] };
    const [msg] = insertRows(w.svc, 'assistant_messages') as Record<string, unknown>[];
    expect(body.ok).toBe(true);
    expect(body.jobs.find((j) => j.job_id === A)).toEqual({ job_id: A, status: 'done', message_id: msg!.id });

    // the job's own models: tokens.model reduces, tokens.extract_model read the chunks
    expect(w.providerOr.mock.calls.slice(0, 2)).toEqual([[OPUS, w.fallback], [SONNET, w.opus]]);
    expect(w.sonnet.batchResults).toHaveBeenCalledWith('batch_A');
    expect(w.fallback.streams).toEqual([]);
    expect(w.opus.streams).toHaveLength(1);
    const data = /<data source="job_chunks" rows="3">\n(.*)\n<\/data>/.exec(w.opus.streams[0]!.messages[0]!.content)![1]!;
    expect(JSON.parse(data)).toEqual([{ chunk_sum: 250, chunk: 1 }, { chunk: 2, error: 'errored' }, { chunk: 3, missing: true }]);

    // one usage record for the one succeeded chunk (at the extraction model), one for the reduce
    const rec = w.svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model);
    expect(rec).toEqual([SONNET, OPUS]);
    const [calls] = insertRows(w.svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls!.map((c) => [c.call_no, c.model, c.ms])).toEqual([[1, SONNET, 0], [2, OPUS, 7]]);
    expect(msg).toMatchObject({ conversation_id: CONV, seq: 3, sources: [{ job_id: A, chunks: 3, rows: 600 }] });
    expect(w.svc.transitions.filter((t) => t.p_id === A).map((t) => t.p_status)).toEqual(['reducing', 'done']);
    // the conversation's handles are not rewritten by the tick (it holds none)
    const conv = w.svc.froms('assistant_conversations').find((o) => argsOf(o, 'update'))!;
    expect(argsOf(conv, 'update')![0]).not.toHaveProperty('handles');
    // a job that left 'running' keeps its stamp (0405 header): no release for A
    const releasedA = w.svc.froms('assistant_jobs').some((o) => eqs(o).id === A && (argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined)?.tick_claimed_until === null);
    expect(releasedA).toBe(false);
  });

  it('a second tick that claims nothing (another holds it, or it is done) reads, polls and records nothing', async () => {
    const w = world();
    await w.tick();
    const recorded = w.svc.rpcs('llm_record_usage').length;
    const second = service({ claim: { data: [], error: null }, jobs: [batchJob(A, 'batch_A')] });
    const res = await R.tick(new R.Book(second.client, w.fallback), new AbortController().signal, w.providerOr);
    expect(await res.json()).toEqual({ ok: true, jobs: [] });
    expect(second.froms('assistant_jobs')).toEqual([]);
    expect(second.rpcs('llm_record_usage')).toEqual([]);
    expect(w.sonnet.batchResults).toHaveBeenCalledTimes(1);
    expect(w.svc.rpcs('llm_record_usage')).toHaveLength(recorded);
  });

  it('a job cancelled between the claim and the read is not worked', async () => {
    const cancelled = { ...batchJob(A, 'batch_A'), status: 'cancelled' };
    const w = world({ claim: { data: [{ job_id: A, claimed_until: STAMP_A }], error: null }, jobs: [cancelled] });
    expect(await (await w.tick()).json()).toEqual({ ok: true, jobs: [] });
    expect(w.sonnet.batchStatus).not.toHaveBeenCalled();
  });

  it('a failed claim or job read is INTERNAL, logged, and works nothing', async () => {
    const w = world({ claim: { data: null, error: { code: '42501', message: 'permission denied' } } });
    expect(await (await w.tick()).json()).toEqual({ ok: false, error: 'INTERNAL', code: 'INTERNAL' });
    expect(w.svc.froms('assistant_jobs')).toEqual([]);
    expect(logged.join('\n')).toContain('tick: claim failed');

    const svc = service({ claim: { data: [{ job_id: A, claimed_until: STAMP_A }], error: null }, jobsReadError: { code: '57014', message: 'timeout' } });
    const res = await R.tick(new R.Book(svc.client, w.fallback), new AbortController().signal, w.providerOr);
    expect(await res.json()).toEqual({ ok: false, error: 'INTERNAL', code: 'INTERNAL' });
    expect(logged.join('\n')).toContain('tick: running jobs read failed');
  });

  const onlyA = { data: [{ job_id: A, claimed_until: STAMP_A }], error: null };
  const released = (fake: ReturnType<typeof service>, id: string) =>
    fake.froms('assistant_jobs').filter((o) => eqs(o).id === id && (argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined)?.tick_claimed_until === null);
  /** The collected results a tick saved on the job (the plain patch carrying result.collected), last one wins. */
  const savedOf = (fake: ReturnType<typeof service>, id: string) =>
    fake.froms('assistant_jobs')
      .filter((o) => eqs(o).id === id && ((argsOf(o, 'update')?.[0] as { result?: { collected?: unknown } } | undefined)?.result?.collected))
      .map((o) => argsOf(o, 'update')![0] as { tokens: Record<string, unknown>; result: { collected: { objects: unknown[]; calls: unknown[]; attempts: number } } })
      .at(-1);

  it('a transient poll error (429, 5xx, a dropped connection, a timeout) leaves the job running: claim released, nothing failed, cancelled or recorded; the next tick finishes it', async () => {
    for (const err of [new ProviderError('RATE_LIMITED', 'slow down', 429), new ProviderError('UPSTREAM', 'vendor 500', 500), new ProviderError('UPSTREAM', 'socket hang up'), new ProviderError('TIMEOUT', 'aborted')]) {
      const w = world({ claim: onlyA });
      w.sonnet.batchStatus.mockRejectedValueOnce(err);
      const first = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
      expect(first.jobs, err.message).toEqual([{ job_id: A, status: 'retry', error: err.code }]);
      expect(w.svc.transitions, err.message).toEqual([]);
      expect(released(w.svc, A).map(eqs), err.message).toEqual([{ id: A, tick_claimed_until: STAMP_A }]);
      expect(w.sonnet.batchCancel, err.message).not.toHaveBeenCalled();
      expect(w.svc.rpcs('llm_record_usage'), err.message).toEqual([]);
      expect(insertRows(w.svc, 'assistant_messages'), err.message).toEqual([]);
      expect(logged.join('\n')).toContain(`tick: job ${A} deferred (${err.code}); the next tick retries`);

      // the next minute: the poll answers, the batch is collected and reduced
      const second = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
      expect(second.jobs[0], err.message).toMatchObject({ job_id: A, status: 'done' });
      expect(w.svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model), err.message).toEqual([SONNET, OPUS]);
    }
  });

  it('a terminal poll error fails the job for good, cancels the batch still running, and writes the failure into the chat', async () => {
    for (const err of [new ProviderError('UPSTREAM', 'batch not found', 404), new ProviderError('NOT_CONFIGURED', 'invalid ANTHROPIC_API_KEY', 401)]) {
      const w = world({ claim: onlyA });
      w.sonnet.batchStatus.mockRejectedValueOnce(err);
      const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
      expect(body.jobs).toEqual([{ job_id: A, status: 'failed', error: err.code }]);
      expect(w.svc.transitions).toEqual([expect.objectContaining({ p_id: A, p_status: 'failed', p_patch: expect.objectContaining({ error: `${err.code}: ${err.code === 'UPSTREAM' ? 'the job failed' : 'the model is not configured'}` }) })]);
      expect(w.sonnet.batchCancel).toHaveBeenCalledWith('batch_A');
      expect(released(w.svc, A)).toEqual([]);
      const [msg] = insertRows(w.svc, 'assistant_messages') as Record<string, unknown>[];
      expect(msg).toMatchObject({ conversation_id: CONV, seq: 3, role: 'assistant', content: [{ type: 'text', text: '' }] });
      expect(msg!.tokens).toMatchObject({ error_code: err.code, stop_reason: err.code });
      expect(logged.join('\n')).toContain(`tick: job ${A} failed (${err.code})`);
    }
  });

  it('a batch that ended with no result fails without a reduce call over nothing, and is not cancelled (it has ended)', async () => {
    const w = world({ claim: onlyA });
    w.sonnet.batchStatus.mockResolvedValueOnce({ status: 'ended', ended: true, counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 3 } });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'failed', error: 'UPSTREAM' }]);
    expect(w.sonnet.batchResults).not.toHaveBeenCalled();
    expect(w.opus.streams).toEqual([]);
    expect(w.sonnet.batchCancel).not.toHaveBeenCalled();
    expect(statuses(w.svc)).toEqual(['failed']);
  });

  it('a reduce that fails transiently keeps the collected results on the job; the next tick reduces from them without reading or recording the batch again', async () => {
    let n = 0;
    const opus = scripted(OPUS, () => (++n === 1 ? Promise.reject(new ProviderError('RATE_LIMITED', 'slow down', 429)) : textTurn('One chunk summed 250.', { input: 3000, cache_write: 0, cache_read: 0, output: 400 })));
    const w = world({ claim: onlyA, opus });
    const first = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(first.jobs).toEqual([{ job_id: A, status: 'retry', error: 'RATE_LIMITED' }]);
    expect(w.svc.transitions).toEqual([]); // still running
    expect(released(w.svc, A)).toHaveLength(1);
    expect(w.svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([SONNET]);
    const saved = savedOf(w.svc, A)!;
    expect(saved.result.collected.objects).toHaveLength(3);
    expect(saved.result.collected.calls).toHaveLength(1);
    expect(saved.result.collected.attempts).toBe(1);
    expect(saved.tokens).toMatchObject({ calls: 1, model: OPUS, extract_model: SONNET });

    // the next tick sees the row as saved
    const again = service({ maxSeq: 2, claim: onlyA, jobs: [{ ...batchJob(A, 'batch_A'), tokens: saved.tokens, result: saved.result }] });
    const second = (await (await R.tick(new R.Book(again.client, w.fallback), new AbortController().signal, w.providerOr)).json()) as { jobs: Record<string, unknown>[] };
    expect(second.jobs[0]).toMatchObject({ job_id: A, status: 'done' });
    expect(w.sonnet.batchStatus).toHaveBeenCalledTimes(1); // collected: no second poll
    expect(w.sonnet.batchResults).toHaveBeenCalledTimes(1); // nor a second read
    expect(again.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([OPUS]); // the batch is not recorded twice
    const [calls] = insertRows(again, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls!.map((c) => [c.call_no, c.model])).toEqual([[1, SONNET], [2, OPUS]]);
    expect(statuses(again)).toEqual(['reducing', 'done']);
    const done = again.transitions.at(-1)!.p_patch as { tokens: Record<string, number> };
    expect(done.tokens.calls).toBe(2);
  });

  it(`the reduce is tried at most REDUCE_ATTEMPTS times; then the job fails with the objects kept, and the ended batch is not cancelled`, async () => {
    const collected = { objects: [{ chunk_sum: 250, chunk: 1 }], calls: [{ call_no: 1, model: SONNET, usage: { input: 2000, cache_write: 0, cache_read: 0, output: 300 }, ms: 0, stop_reason: 'end_turn', cost_micros: 2300 }], attempts: 2 };
    const opus = scripted(OPUS, () => Promise.reject(new ProviderError('UPSTREAM', 'overloaded', 529)));
    const w = world({ claim: onlyA, opus, jobs: [{ ...batchJob(A, 'batch_A', { model: OPUS, extract_model: SONNET, calls: 1, input: 2000, output: 300, total: 2300, cost_micros: 2300 }), result: { collected } }] });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'failed', error: 'UPSTREAM' }]);
    expect(w.sonnet.batchStatus).not.toHaveBeenCalled();
    expect(w.sonnet.batchCancel).not.toHaveBeenCalled();
    expect(statuses(w.svc)).toEqual(['failed']);
    expect(w.svc.transitions[0]!.p_patch.result).toEqual({ objects: collected.objects });
    // the earlier calls ride on the failure message
    const [calls] = insertRows(w.svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls).toHaveLength(1);
  });

  it('an overrun found after the batch is collected (extraction 100% spent) still produces the answer, never over_estimate', async () => {
    const w = world({ claim: onlyA });
    w.sonnet.batchResults.mockResolvedValueOnce(new Map<string, unknown>([1, 2, 3].map((no) => [`job:${A}:${no}`, { ok: true, content: [{ type: 'text', text: `{"chunk_sum":${no}}` }], usage: { input: 900_000, cache_write: 0, cache_read: 0, output: 100 }, stop_reason: 'end_turn' }])));
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs[0]).toMatchObject({ job_id: A, status: 'done' });
    expect(statuses(w.svc)).toEqual(['reducing', 'done']);
    expect(w.opus.streams).toHaveLength(1);
    expect(logged.join('\n')).toContain(`tick: job ${A} ran past its estimate × 1.25; reducing anyway`);
  });

  it('the batch reduce runs past the monthly cap: the extraction is paid for', async () => {
    const w = world({ claim: onlyA, svc: { begin: { data: null, error: { code: 'P0001', message: 'LLM_MONTHLY_CAP' } } } });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs[0]).toMatchObject({ job_id: A, status: 'done' });
    expect(w.svc.rpcs('llm_begin_request')).toHaveLength(1);
    expect(logged.join('\n')).toContain('the reduce runs past the budget check');
  });

  it('a failed save of the collected results records nothing and retries next minute', async () => {
    const w = world({ claim: onlyA, svc: { jobsUpdateFails: true } });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'retry', error: 'UPSTREAM' }]);
    expect(w.svc.rpcs('llm_record_usage')).toEqual([]);
    expect(w.opus.streams).toEqual([]);
    expect(w.svc.transitions).toEqual([]);
  });

  it('a tick whose clock has run out starts no job: it releases the claim for the next minute', async () => {
    const w = world({ claim: onlyA });
    const gone = new AbortController();
    gone.abort();
    const res = await R.tick(new R.Book(w.svc.client, w.fallback), gone.signal, w.providerOr);
    expect(await res.json()).toEqual({ ok: true, jobs: [{ job_id: A, status: 'retry', error: 'TIMEOUT' }] });
    expect(w.sonnet.batchStatus).not.toHaveBeenCalled();
    expect(released(w.svc, A)).toHaveLength(1);
  });

  it('a batch submitted before 2026-10-08 (no extract_model) is read and priced at the job model', async () => {
    const w = world({ claim: { data: [{ job_id: A, claimed_until: STAMP_A }], error: null }, jobs: [batchJob(A, 'batch_A', { model: SONNET })] });
    await w.tick();
    expect(w.providerOr.mock.calls.slice(0, 2)).toEqual([[SONNET, w.fallback], [SONNET, w.sonnet]]);
    expect(w.svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([SONNET, SONNET]);
  });

  // 0423 (review 2026-11-12): counted after the call, a tick killed during a
  // billed reduce left the count unchanged and the next tick billed it again.
  it('a reduce try is saved on the job BEFORE the reduce call is made', async () => {
    let opsAtCall = -1;
    let w: ReturnType<typeof world> | null = null;
    const opus = scripted(OPUS, () => {
      opsAtCall = w!.svc.ops.length;
      return textTurn('One chunk summed 250.', { input: 3000, cache_write: 0, cache_read: 0, output: 400 });
    });
    w = world({ claim: onlyA, opus });
    await w.tick();
    const counted = w.svc.ops.findIndex((o) => o.name === 'assistant_jobs' && (argsOf(o, 'update')?.[0] as { result?: { collected?: { attempts?: number } } } | undefined)?.result?.collected?.attempts === 1);
    expect(counted).toBeGreaterThanOrEqual(0);
    expect(opsAtCall).toBeGreaterThan(counted);
  });

  it('a job whose reduce was already tried REDUCE_ATTEMPTS times (ticks killed mid-reduce) fails without another call', async () => {
    const collected = { objects: [{ chunk_sum: 250, chunk: 1 }], calls: [], attempts: 3 };
    const w = world({ claim: onlyA, jobs: [{ ...batchJob(A, 'batch_A'), result: { collected } }] });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'failed', error: 'UPSTREAM' }]);
    expect(w.opus.streams).toEqual([]);
    expect(statuses(w.svc)).toEqual(['failed']);
    expect(logged.join('\n')).toContain('the reduce was tried 3 times');
  });

  it('a try that cannot be counted is not made: the job waits for the next minute', async () => {
    const collected = { objects: [{ chunk_sum: 250, chunk: 1 }], calls: [], attempts: 0 };
    const w = world({ claim: onlyA, jobs: [{ ...batchJob(A, 'batch_A'), result: { collected } }], svc: { jobsUpdateFails: true } });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'retry', error: 'UPSTREAM' }]);
    expect(w.opus.streams).toEqual([]);
    expect(w.svc.transitions).toEqual([]);
  });

  it('a batch job cancelled before its reduce is not reduced, not failed and its batch not cancelled again', async () => {
    const w = world({ claim: onlyA, svc: { status: () => 'cancelled' } });
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'cancelled' }]);
    expect(w.opus.streams).toEqual([]);
    expect(w.svc.transitions).toEqual([]);
    expect(w.sonnet.batchCancel).not.toHaveBeenCalled();
    expect(insertRows(w.svc, 'assistant_messages')).toEqual([]);
  });

  it('a resumed job: the live part kept in result, only the batch part collected and recorded, the reduce over every chunk in order', async () => {
    const live = [{ chunk_sum: 100, chunk: 1 }, { chunk_sum: 200, chunk: 2 }];
    const liveCalls = [1, 2].map((n) => ({ call_no: n, model: SONNET, usage: { input: 2000, cache_write: 0, cache_read: 0, output: 300 }, ms: 7, stop_reason: 'end_turn', cost_micros: 2300 }));
    const row = { ...batchJob(A, 'batch_A', { model: OPUS, extract_model: SONNET, input: 4000, cache_write: 0, cache_read: 0, output: 600, total: 4600, calls: 2, cost_micros: 4600 }), result: { objects: live, calls: liveCalls, submitting_at: '2026-11-12T10:00:00.000Z' } };
    const w = world({ claim: onlyA, jobs: [row] });
    w.sonnet.batchStatus.mockResolvedValueOnce({ status: 'ended', ended: true, counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 } });
    w.sonnet.batchResults.mockResolvedValueOnce(new Map<string, unknown>([[`job:${A}:3`, { ok: true, content: [{ type: 'text', text: '{"chunk_sum":300}' }], usage: { input: 2000, cache_write: 0, cache_read: 0, output: 300 }, stop_reason: 'end_turn' }]]));
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs[0]).toMatchObject({ job_id: A, status: 'done' });
    const polled = w.svc.froms('assistant_jobs').find((o) => eqs(o).id === A && Object.keys((argsOf(o, 'update')?.[0] as object | undefined) ?? {}).join() === 'chunks_done')!;
    expect(argsOf(polled, 'update')![0]).toEqual({ chunks_done: 3 }); // the two live chunks + the batch's one
    const data = /<data source="job_chunks" rows="3">\n(.*)\n<\/data>/.exec(w.opus.streams[0]!.messages[0]!.content)![1]!;
    expect(JSON.parse(data)).toEqual([...live, { chunk_sum: 300, chunk: 3 }]);
    // the live calls were recorded when they ran: only the batch chunk and the reduce now
    expect(w.svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([SONNET, OPUS]);
    const [calls] = insertRows(w.svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls!.map((c) => [c.call_no, c.model])).toEqual([[1, SONNET], [2, SONNET], [3, SONNET], [4, OPUS]]);
    expect((w.svc.transitions.at(-1)!.p_patch.tokens as Record<string, number>).calls).toBe(4);
  });
});

// ---------------------------------------------------------------------------
describe('a failed job reaches the Monitoring page (2026-11-12, 0422)', () => {
  type MonitorEvent = { level: string; kind: string; message: string; detail?: Record<string, unknown> | null };
  /** Book with the injectable `report` (the fifth argument); the typed Runner above predates it. */
  const BookWithReport = () => R.Book as unknown as new (service: unknown, provider: unknown, extract: unknown, recordRetryMs: number, report: (e: MonitorEvent) => void) => BookLike;

  it('the monthly cap at begin(): one assistant_job_failed event, info, the code and ids only', async () => {
    const events: MonitorEvent[] = [];
    const svc = service({ begin: { data: null, error: { code: 'P0001', message: 'LLM_MONTHLY_CAP' } } });
    const red = reducer();
    const book = new (BookWithReport())(svc.client, red, extractor(), 0, (e) => events.push(e));
    await runLive(svc, owner(), threeChunks(), book);
    expect(events).toEqual([
      {
        level: 'info',
        kind: 'assistant_job_failed',
        message: 'assistant-job: job failed (LLM_MONTHLY_CAP)',
        detail: { jobId: JOB, conversationId: CONV, model: OPUS, status: 'failed', code: 'LLM_MONTHLY_CAP' },
      },
    ]);
  });

  it('a chunk the model refuses (UPSTREAM) is error; a database read error carries no row text', async () => {
    const events: MonitorEvent[] = [];
    const svc = service({ maxSeq: 1 });
    const own = owner(() => ({ data: null, error: { code: '22P02', message: 'invalid input syntax for guest "Zainab Al-Khafaji"' } }));
    const book = new (BookWithReport())(svc.client, reducer(), extractor(), 0, (e) => events.push(e));
    await runLive(svc, own, threeChunks(), book);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'error', kind: 'assistant_job_failed', message: 'assistant-job: job failed (UPSTREAM)' });
    expect(JSON.stringify(events)).not.toContain('Zainab');
  });

  it('the tick hands its report to the per-job Book: a batch that ended with nothing is one error event', async () => {
    const A = 'eeeeeeee-0000-4000-8000-00000000000a';
    const events: MonitorEvent[] = [];
    const svc = service({ maxSeq: 2, claim: { data: [{ job_id: A, claimed_until: '2026-11-11T10:02:00.000Z' }], error: null }, jobs: [threeChunks({ id: A, mode: 'batch', batch_id: 'batch_A', tokens: { model: OPUS, extract_model: SONNET } })] });
    const sonnet = scripted(SONNET);
    sonnet.batchStatus.mockResolvedValueOnce({ status: 'ended', ended: true, counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 3 } });
    const opus = reducer();
    const providerOr = (model: string | null | undefined, fb: unknown) => (model === OPUS ? opus : model === SONNET ? sonnet : fb);
    await R.tick(new (BookWithReport())(svc.client, scripted('the-tick-default'), scripted('the-tick-default'), 0, (e) => events.push(e)), new AbortController().signal, providerOr);
    expect(events).toEqual([
      { level: 'error', kind: 'assistant_job_failed', message: 'assistant-job: job failed (UPSTREAM)', detail: { jobId: A, conversationId: CONV, model: OPUS, status: 'failed', code: 'UPSTREAM' } },
    ]);
  });

  it('a fail() that is not ours (the transition refused: cancelled meanwhile) reports nothing; a reporter that throws changes nothing', async () => {
    const events: MonitorEvent[] = [];
    const refused = fakeClient({ rpc: (name): Result => (name === 'assistant_job_transition' ? { data: null, error: { code: 'P0001', message: 'INVALID_TRANSITION' } } : { data: null, error: null }) });
    const b1 = new (BookWithReport())(refused.client, reducer(), extractor(), 0, (e) => events.push(e)) as unknown as { fail(job: JobRow, error: string, spend: unknown): Promise<void> };
    await b1.fail(threeChunks(), 'UPSTREAM: the job failed', { input: 0, cache_write: 0, cache_read: 0, output: 0, cost_micros: 0, calls: 0, total: 0 });
    expect(events).toEqual([]);
    const svc = service({ maxSeq: 1 });
    const b2 = new (BookWithReport())(svc.client, reducer(), extractor(), 0, () => {
      throw new Error('monitoring down');
    }) as unknown as { fail(job: JobRow, error: string, spend: unknown): Promise<void> };
    await expect(b2.fail(threeChunks(), 'TIMEOUT: late', { input: 0, cache_write: 0, cache_read: 0, output: 0, cost_micros: 0, calls: 0, total: 0 })).resolves.toBeUndefined();
    expect(insertRows(svc, 'assistant_messages')).toHaveLength(1); // the failed message still lands
  });
});

// ===========================================================================
// 0423 (2026-11-12): pause instead of losing paid work, resume from it, a
// cancel that stops the spending, and the stuck-job sweeper.
// ===========================================================================
type MonitorEvent0423 = { level: string; kind: string; message: string; detail?: Record<string, unknown> | null };
type ResumeFn = (
  book: BookLike, asOwner: unknown, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number,
  o: { mode: 'live' | 'batch' | null; batchAvailable: boolean },
) => Promise<Response>;
const resumeJob = (...a: Parameters<ResumeFn>) => (R as unknown as { resumeJob: ResumeFn }).resumeJob(...a);
const BookReporting = () => R.Book as unknown as new (service: unknown, provider: unknown, extract: unknown, recordRetryMs: number, report: (e: MonitorEvent0423) => void) => BookLike;

const SPENT = { input: 4000, cache_write: 0, cache_read: 1000, output: 600, total: 5600, calls: 2, cost_micros: 2 * PRICE(SONNET, { input: 2000, output: 300 }), model: OPUS, extract_model: SONNET };
const liveCall = (n: number) => ({ call_no: n, model: SONNET, usage: { input: 2000, cache_write: 0, cache_read: 500, output: 300 }, ms: 7, stop_reason: 'end_turn', cost_micros: PRICE(SONNET, { input: 2000, output: 300 }) });
const LIVE_OBJECTS = [{ chunk_sum: 100, chunk: 1, tool: 'bookings_list', rows_read: 250 }, { chunk_sum: 200, chunk: 2, tool: 'bookings_list', rows_read: 250 }];
/** Three chunks, the first two read live and paid for, paused (`reason`). */
function pausedJob(reason = 'time', over: Partial<JobRow> = {}): JobRow {
  const base = threeChunks();
  const rest = restEstimate(base.estimate, 1, { chunks: 2, used: SPENT });
  return threeChunks({
    status: 'over_estimate', mode: 'live', chunks_done: 2, tokens: { ...SPENT },
    result: { objects: LIVE_OBJECTS, calls: [liveCall(1), liveCall(2)], pause: { reason, at: '2026-11-12T10:00:00.000Z', chunks_left: [3], rest } },
    ...over,
  });
}
const counting = (rows = 600) => owner(undefined, () => ({ data: rows, error: null }));
const resumeOf = (svc: { client: unknown }, own: { client: unknown }, job: JobRow, book: BookLike, o: { mode?: 'live' | 'batch' | null; batchAvailable?: boolean } = {}) =>
  resumeJob(book, own.client, job, chunksFor(job), newHandleTable({}), TZ, new AbortController().signal, Date.now(), { mode: o.mode ?? null, batchAvailable: o.batchAvailable ?? true });

describe('the ceiling and the rest of a paused job (estimate.ts, 0423)', () => {
  it('the ceiling is the estimate × 1.25 until a resume stores its own', () => {
    const est = threeChunks().estimate;
    expect(ceilingTokens(est)).toBe(est.tokens.total * 1.25);
    expect(ceilingTokens({ ...est, ceiling_tokens: 99 })).toBe(99);
    expect(isOverEstimate(100, { ...est, ceiling_tokens: 99 })).toBe(true);
    expect(isOverEstimate(99, { ...est, ceiling_tokens: 99 })).toBe(false);
  });

  it('the rest prices each unread chunk at the dearer of the estimate and what the finished chunks used, plus the whole reduce', () => {
    const est = threeChunks().estimate;
    const perChunk = est.by_step!.extract.tokens.input / est.chunks;
    // used less than estimated: the estimate stands
    const low = restEstimate(est, 1, { chunks: 2, used: { input: 10, cache_read: 0, output: 1 } });
    expect(low.extract.input).toBe(Math.ceil(perChunk));
    // used far more: the observed figure, so a resume does not pause again at once
    const high = restEstimate(est, 2, { chunks: 2, used: { input: 2_000_000, cache_write: 0, cache_read: 0, output: 1000 } });
    expect(high.extract.input).toBe(2_000_000);
    expect(high.chunks).toBe(2);
    expect(high.reduce).toEqual(est.by_step!.reduce.tokens);
    expect(high.extract_high.total).toBeGreaterThan(high.extract.total);
    expect(resumeCeiling(1000, high)).toBe(Math.ceil(1000 + (high.extract_high.total + high.reduce_high.total) * 1.25));
    expect(restEstimate(est, 0, { chunks: 3, used: null }).extract.total).toBe(0);
  });
});

describe('runLive keeps paid work (0423)', () => {
  it('out of time with chunks read: paused (time) with the objects, their calls and the rest priced; no reduce, no message', async () => {
    vi.useFakeTimers();
    const svc = service();
    const rd = reducer();
    const ex = scripted(SONNET, (call) =>
      chunkNoOf(call) === 3
        ? new Promise<Turn>((_ok, ko) => call.signal.addEventListener('abort', () => ko(new ProviderError('TIMEOUT', 'aborted'))))
        : textTurn(JSON.stringify({ chunk_sum: 100 * chunkNoOf(call) })),
    );
    const pending = runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    await vi.advanceTimersByTimeAsync(R.WALL_MS);
    const res = await pending;
    expect(await res.json()).toMatchObject({ job_id: JOB, status: 'over_estimate', reason: 'time', chunks_done: 2 });
    expect(statuses(svc)).toEqual(['over_estimate']);
    const r = svc.transitions[0]!.p_patch.result as { objects: { chunk: number }[]; calls: unknown[]; pause: { reason: string; chunks_left: number[]; rest: { chunks: number } } };
    expect(r.objects.map((o) => o.chunk)).toEqual([1, 2]);
    expect(r.calls).toHaveLength(2);
    expect(r.pause).toMatchObject({ reason: 'time', chunks_left: [3], rest: { chunks: 1 } });
    expect(rd.streams).toEqual([]);
    expect(insertRows(svc, 'assistant_messages')).toEqual([]);
  });

  it('every progress write carries the objects and calls so far (a request that dies leaves them on the row)', async () => {
    const svc = service();
    await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), extractor()));
    const withResult = svc.froms('assistant_jobs').map((o) => argsOf(o, 'update')?.[0] as { result?: { objects: unknown[]; calls: unknown[] } } | undefined).filter((p) => p?.result);
    expect(withResult.length).toBe(3);
    expect(withResult.at(-1)!.result!.objects).toHaveLength(3);
    // a write's figures are read when its turn comes (Book.progress), so the last may already hold the reduce's call
    expect(withResult.at(-1)!.result!.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('a job cancelled before it starts launches nothing: no begin, no call, no message', async () => {
    const svc = service({ status: () => 'cancelled' });
    const ex = extractor();
    const rd = reducer();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    expect(await res.json()).toEqual({ job_id: JOB, status: 'cancelled', chunks_done: 0 });
    expect(ex.streams).toEqual([]);
    expect(svc.rpcs('llm_begin_request')).toEqual([]);
    expect(svc.transitions).toEqual([]);
    expect(insertRows(svc, 'assistant_messages')).toEqual([]);
  });

  it('a job cancelled after its chunks is not reduced (the dearest call is never made) and gets no failed message', async () => {
    const svc = service({ status: (n) => (n <= 3 ? 'running' : 'cancelled') });
    const ex = extractor();
    const rd = reducer();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    expect(await res.json()).toEqual({ job_id: JOB, status: 'cancelled', chunks_done: 3 });
    expect(ex.streams).toHaveLength(3);
    expect(rd.streams).toEqual([]);
    expect(svc.transitions).toEqual([]);
    expect(insertRows(svc, 'assistant_messages')).toEqual([]);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(3);
  });

  it('a done transition that fails after the answer is stored leaves the answer alone: no failed message, the sweeper finishes it', async () => {
    const svc = service({ transitionFails: { statuses: ['done'], error: { code: '57014', message: 'canceling statement due to statement timeout' } } });
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), extractor()));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'done' });
    const msgs = insertRows(svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.tokens).not.toHaveProperty('error_code');
    expect(statuses(svc)).toEqual(['reducing', 'done']);
    expect(logged.join('\n')).toContain('stored but the job not marked done; the sweeper finishes it');
  });
});

describe('resumeJob: a paused job continues from what it paid for (0423)', () => {
  it('in the background by default: one row check, ONE transition, only the unread chunk read and sent, its own number kept', async () => {
    const svc = service();
    const own = counting();
    const ex = extractor();
    const rd = reducer();
    const job = pausedJob();
    const res = await resumeOf(svc, own, job, new R.Book(svc.client, rd, ex));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: JOB, status: 'running', mode: 'batch', batch_id: 'msgbatch_01', chunks_total: 3 });

    expect(own.rpcs('assistant_count')).toHaveLength(1);
    expect(own.rpcs('assistant_count')[0]!.args).toMatchObject({ p_tool: 'bookings_list', p_args: { p_from: WEEK.from, p_to: WEEK.to } });
    expect(own.rpcs('assistant_run_tool').map((o) => (o.args as { p_args: { p_offset: number } }).p_args.p_offset)).toEqual([500]);

    expect(statuses(svc)).toEqual(['running']);
    const t = svc.transitions[0]!.p_patch as { mode: string; estimate: JobEstimate & { ceiling_tokens: number; resumes: Record<string, unknown>[] }; result: Record<string, unknown> };
    expect(t.mode).toBe('batch');
    expect(t.result).toEqual({ objects: LIVE_OBJECTS, calls: [liveCall(1), liveCall(2)] });
    const rest = (job.result as { pause: { rest: Parameters<typeof resumeCeiling>[1] } }).pause.rest;
    expect(t.estimate.ceiling_tokens).toBe(resumeCeiling(SPENT.total, rest));
    expect(t.estimate.resumes).toEqual([expect.objectContaining({ mode: 'batch', chunks_left: 1, spent_tokens: SPENT.total, spent_micros: SPENT.cost_micros })]);
    expect(t.estimate.resumes[0]!.rest_micros_high).toBeGreaterThan(0);

    const requests = ex.batchCreate.mock.calls[0]![0] as { custom_id: string; messages: { content: string }[] }[];
    expect(requests.map((r) => r.custom_id)).toEqual([`job:${JOB}:3`]);
    expect(requests[0]!.messages[0]!.content).toContain('This is chunk 3 of 3.');
    expect(ex.streams).toEqual([]);
    expect(rd.streams).toEqual([]);
    const updates = svc.froms('assistant_jobs').map((o) => argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined).filter(Boolean);
    expect(updates[0]).toEqual({ result: { objects: LIVE_OBJECTS, calls: [liveCall(1), liveCall(2)], submitting_at: expect.any(String) } });
    expect(updates[1]).toMatchObject({ batch_id: 'msgbatch_01', chunks_total: 3, tokens: { calls: 2, cost_micros: SPENT.cost_micros, model: OPUS, extract_model: SONNET } });
  });

  it('live when asked (the rest fits LIVE_MAX_CHUNKS): only chunk 3 is extracted, the reduce reads all three, every call stored once', async () => {
    const svc = service({ maxSeq: 3 });
    const ex = extractor();
    const rd = reducer();
    const res = await resumeOf(svc, counting(), pausedJob('over_estimate'), new R.Book(svc.client, rd, ex), { mode: 'live' });
    expect(await res.json()).toMatchObject({ status: 'done', chunks_done: 3 });
    expect(ex.streams.map(chunkNoOf)).toEqual([3]);
    const data = /<data source="job_chunks" rows="3">\n(.*)\n<\/data>/.exec(rd.streams[0]!.messages[0]!.content)![1]!;
    expect((JSON.parse(data) as { chunk: number }[]).map((o) => o.chunk)).toEqual([1, 2, 3]);
    expect(statuses(svc)).toEqual(['running', 'reducing', 'done']);
    expect(svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([SONNET, OPUS]);
    const [calls] = insertRows(svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(calls!.map((c) => [c.call_no, c.model])).toEqual([[1, SONNET], [2, SONNET], [3, SONNET], [4, OPUS]]);
    expect((svc.transitions.at(-1)!.p_patch.tokens as Record<string, number>).calls).toBe(4);
  });

  it('a second press (or a second device) is 409 before anything is read or spent', async () => {
    const svc = service({ transitionFails: { statuses: ['running'], error: { code: 'P0001', message: 'INVALID_TRANSITION', details: 'running -> running' } } });
    const own = counting();
    const ex = extractor();
    const res = await resumeOf(svc, own, pausedJob(), new R.Book(svc.client, reducer(), ex));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(own.rpcs('assistant_run_tool')).toEqual([]);
    expect(ex.batchCreate).not.toHaveBeenCalled();
    expect(svc.rpcs('llm_begin_request')).toEqual([]);
    // and a job that is not paused is refused before the row check
    const own2 = counting();
    const again = await resumeOf(service(), own2, pausedJob('time', { status: 'running' }), new R.Book(svc.client, reducer(), extractor()));
    expect(again.status).toBe(409);
    expect(own2.rpcs('assistant_count')).toEqual([]);
  });

  it('rows that changed since the estimate refuse the resume (JOB_DATA_CHANGED); an unreadable count is UPSTREAM; neither moves the job', async () => {
    const svc = service();
    const changed = await resumeOf(svc, counting(601), pausedJob(), new R.Book(svc.client, reducer(), extractor()));
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'JOB_DATA_CHANGED' });
    const unread = await resumeOf(svc, owner(undefined, () => ({ data: null, error: { code: '57014', message: 'timeout' } })), pausedJob(), new R.Book(svc.client, reducer(), extractor()));
    expect(unread.status).toBe(502);
    expect(svc.transitions).toEqual([]);
  });

  it('a vendor that refuses the batch, or the cap at submission, puts the job back to paused with its work; nothing spent, no failed message', async () => {
    const svc = service();
    const ex = extractor();
    ex.batchCreate.mockRejectedValueOnce(new ProviderError('UPSTREAM', 'overloaded', 529));
    const job = pausedJob();
    const res = await resumeOf(svc, counting(), job, new R.Book(svc.client, reducer(), ex));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'over_estimate', code: 'UPSTREAM' });
    expect(statuses(svc)).toEqual(['running', 'over_estimate']);
    expect(svc.transitions[1]!.p_patch).toEqual({ result: { objects: LIVE_OBJECTS, calls: [liveCall(1), liveCall(2)], pause: (job.result as { pause: unknown }).pause } });
    expect(insertRows(svc, 'assistant_messages')).toEqual([]);

    const capped = service({ begin: { data: null, error: { code: 'P0001', message: 'LLM_MONTHLY_CAP' } } });
    const ex2 = extractor();
    const r2 = await resumeOf(capped, counting(), pausedJob(), new R.Book(capped.client, reducer(), ex2));
    expect(r2.status).toBe(429);
    expect(statuses(capped)).toEqual(['running', 'over_estimate']);
    expect(ex2.batchCreate).not.toHaveBeenCalled();
  });

  it('modes: live refused when the rest is over LIVE_MAX_CHUNKS, batch refused where the vendor has none, only the reduce left runs live', async () => {
    const big = jobOf({ question: 'q', calls: [{ tool: 'bookings_list', args: { ...WEEK } }] }, [250 * 12], {
      status: 'over_estimate', tokens: { ...SPENT }, result: { objects: LIVE_OBJECTS, calls: [], pause: null },
    });
    const svc = service();
    const tooMany = await resumeJob(new R.Book(svc.client, reducer(), extractor()), counting(3000).client, big, chunksFor(big), newHandleTable({}), TZ, new AbortController().signal, Date.now(), { mode: 'live', batchAvailable: true });
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as { message: string }).message).toContain(`at most ${LIVE_MAX_CHUNKS}`);
    const noBatch = await resumeJob(new R.Book(svc.client, reducer(), extractor()), counting(3000).client, big, chunksFor(big), newHandleTable({}), TZ, new AbortController().signal, Date.now(), { mode: 'batch', batchAvailable: false });
    expect(noBatch.status).toBe(400);
    expect(svc.transitions).toEqual([]);

    // the sweeper paused a job whose every chunk was read: Continue only reduces
    const all = pausedJob('stopped', { result: { objects: [...LIVE_OBJECTS, { chunk_sum: 300, chunk: 3 }], calls: [], pause: null } });
    const s2 = service();
    const ex = extractor();
    const rd = reducer();
    const res = await resumeOf(s2, counting(), all, new R.Book(s2.client, rd, ex));
    expect(await res.json()).toMatchObject({ status: 'done', chunks_done: 3 });
    expect((s2.transitions[0]!.p_patch as { mode: string }).mode).toBe('live');
    expect(ex.streams).toEqual([]);
    expect(rd.streams).toHaveLength(1);
  });
});

describe('the sweeper settles stuck jobs at the top of the tick, with no model call (0423)', () => {
  const S = 'ffffffff-0000-4000-8000-00000000000';
  const STAMP = '2026-11-12T10:02:00.000Z';
  const OLD = '2026-11-12T09:00:00.000Z';
  function sweepWorld(rows: JobRow[], reasons: [string, string][], svcOpts: SvcOpts = {}) {
    const events: MonitorEvent0423[] = [];
    const svc = service({ maxSeq: 5, stuck: { data: reasons.map(([job_id, reason]) => ({ job_id, reason, claimed_until: STAMP })), error: null }, jobs: rows, ...svcOpts });
    const opus = reducer();
    const sonnet = scripted(SONNET);
    const fallback = scripted('the-tick-default');
    const providerOr = (m: string | null | undefined, fb: unknown) => (m === OPUS ? opus : m === SONNET ? sonnet : fb);
    const book = new (BookReporting())(svc.client, fallback, fallback, 0, (e) => events.push(e));
    const noModelCall = () => {
      for (const p of [opus, sonnet, fallback]) {
        expect(p.streams).toEqual([]);
        expect(p.batchCreate).not.toHaveBeenCalled();
      }
    };
    return { svc, opus, sonnet, events, noModelCall, tick: async () => (await (await R.tick(book, new AbortController().signal, providerOr)).json()) as { ok: boolean; jobs: unknown[]; swept?: Record<string, unknown>[] } };
  }
  const tokens = { model: OPUS, extract_model: SONNET };

  it('stalled_start: failed with JOB_STALLED on the row, UPSTREAM in the chat (job_error JOB_STALLED), one error event naming the reason', async () => {
    const w = sweepWorld([threeChunks({ id: `${S}1`, status: 'accepted', status_at: OLD, tokens })], [[`${S}1`, 'stalled_start']]);
    const body = await w.tick();
    expect(body).toEqual({ ok: true, jobs: [], swept: [{ job_id: `${S}1`, swept: 'stalled_start', status: 'failed' }] });
    expect(w.svc.transitions).toEqual([expect.objectContaining({ p_id: `${S}1`, p_status: 'failed', p_patch: expect.objectContaining({ error: 'JOB_STALLED: the job stopped and was ended' }) })]);
    const [msg] = insertRows(w.svc, 'assistant_messages') as Record<string, unknown>[];
    expect(msg!.tokens).toMatchObject({ error_code: 'UPSTREAM', stop_reason: 'UPSTREAM', job_error: 'JOB_STALLED' });
    expect(w.events).toEqual([expect.objectContaining({ level: 'error', kind: 'assistant_job_failed', message: 'assistant-job: job failed (JOB_STALLED)', detail: expect.objectContaining({ jobId: `${S}1`, step: 'stalled_start', code: 'JOB_STALLED' }) })]);
    w.noModelCall();
  });

  it('stalled_live with objects saved: paused (stopped) with them, the chunks left and their calls; a warn event, no message', async () => {
    const row = threeChunks({ id: `${S}2`, status: 'running', mode: 'live', status_at: OLD, tokens: { ...SPENT }, result: { objects: LIVE_OBJECTS, calls: [liveCall(1), liveCall(2)] } });
    const w = sweepWorld([row], [[`${S}2`, 'stalled_live']]);
    const body = await w.tick();
    expect(body.swept).toEqual([{ job_id: `${S}2`, swept: 'stalled_live', status: 'over_estimate' }]);
    expect(statuses(w.svc)).toEqual(['over_estimate']);
    const r = w.svc.transitions[0]!.p_patch.result as { objects: unknown[]; calls: unknown[]; pause: { reason: string; chunks_left: number[] } };
    expect(r.objects).toEqual(LIVE_OBJECTS);
    expect(r.calls).toHaveLength(2);
    expect(r.pause).toMatchObject({ reason: 'stopped', chunks_left: [3] });
    expect(insertRows(w.svc, 'assistant_messages')).toEqual([]);
    expect(w.events).toEqual([expect.objectContaining({ level: 'warn', kind: 'assistant_job_swept', detail: expect.objectContaining({ step: 'stalled_live', status: 'paused' }) })]);
    w.noModelCall();
  });

  it('stalled_live with nothing saved fails; stalled_submit fails, and an error event when it may have created a batch', async () => {
    const rows = [
      threeChunks({ id: `${S}3`, status: 'running', mode: 'live', status_at: OLD, tokens }),
      threeChunks({ id: `${S}4`, status: 'running', mode: 'batch', status_at: OLD, tokens, result: { submitting_at: OLD } }),
      threeChunks({ id: `${S}5`, status: 'running', mode: 'batch', status_at: OLD, tokens }),
    ];
    const w = sweepWorld(rows, [[`${S}3`, 'stalled_live'], [`${S}4`, 'stalled_submit'], [`${S}5`, 'stalled_submit']]);
    await w.tick();
    expect(statuses(w.svc)).toEqual(['failed', 'failed', 'failed']);
    const unrecorded = w.events.filter((e) => e.kind === 'assistant_job_swept');
    expect(unrecorded).toEqual([expect.objectContaining({ level: 'error', message: 'assistant-job: batch may run unrecorded (JOB_STALLED)', detail: expect.objectContaining({ jobId: `${S}4`, step: 'batch_unrecorded' }) })]);
    expect(w.sonnet.batchCancel).not.toHaveBeenCalled(); // no id to cancel
    w.noModelCall();
  });

  it('batch_overdue cancels the batch still billing and fails; lease_lapsing with its results collected fails keeping them, no cancel', async () => {
    const collected = { objects: [{ chunk_sum: 1, chunk: 1 }], calls: [liveCall(1)], attempts: 2 };
    const rows = [
      threeChunks({ id: `${S}6`, status: 'running', mode: 'batch', batch_id: 'batch_O', status_at: OLD, tokens }),
      threeChunks({ id: `${S}7`, status: 'running', mode: 'batch', batch_id: 'batch_L', status_at: OLD, tokens, result: { collected } }),
    ];
    const w = sweepWorld(rows, [[`${S}6`, 'batch_overdue'], [`${S}7`, 'lease_lapsing']]);
    await w.tick();
    expect(w.sonnet.batchCancel.mock.calls).toEqual([['batch_O']]);
    expect(statuses(w.svc)).toEqual(['failed', 'failed']);
    expect(w.svc.transitions[1]!.p_patch.result).toEqual({ objects: collected.objects });
    const callRows = insertRows(w.svc, 'assistant_calls') as Record<string, unknown>[][];
    expect(callRows).toHaveLength(1); // the collected call rides on the failure message
    w.noModelCall();
  });

  it('stalled_reduce: done when its answer is already in the chat (no second message); failed when only a failure is there', async () => {
    const ANSWER = '99999999-0000-4000-8000-000000000001';
    const row = threeChunks({ id: `${S}8`, status: 'reducing', status_at: OLD, tokens, result: { objects: LIVE_OBJECTS } });
    const w = sweepWorld([row], [[`${S}8`, 'stalled_reduce']], { answers: { data: [{ id: ANSWER, tokens: { stop_reason: 'end_turn' } }], error: null } });
    expect((await w.tick()).swept).toEqual([{ job_id: `${S}8`, swept: 'stalled_reduce', status: 'done', message_id: ANSWER }]);
    expect(w.svc.transitions).toEqual([expect.objectContaining({ p_status: 'done', p_patch: { result: { message_id: ANSWER, recovered: true, objects: 2 } } })]);
    expect(insertRows(w.svc, 'assistant_messages')).toEqual([]);
    const read = w.svc.froms('assistant_messages').find((o) => argsOf(o, 'contains'))!;
    expect(argsOf(read, 'contains')).toEqual(['sources', [{ job_id: `${S}8` }]]);

    const f = sweepWorld([row], [[`${S}8`, 'stalled_reduce']], { answers: { data: [{ id: ANSWER, tokens: { error_code: 'UPSTREAM' } }], error: null } });
    await f.tick();
    expect(statuses(f.svc)).toEqual(['failed']);
    f.noModelCall();
  });

  it('a job whose settling cannot finish is released for the next minute; a failed sweep claim never stops the tick', async () => {
    const row = threeChunks({ id: `${S}9`, status: 'reducing', status_at: OLD, tokens });
    const w = sweepWorld([row], [[`${S}9`, 'stalled_reduce']], { answers: { data: null, error: { code: '57014', message: 'timeout' } } });
    expect((await w.tick()).swept).toEqual([{ job_id: `${S}9`, swept: 'stalled_reduce', status: 'retry' }]);
    expect(w.svc.transitions).toEqual([]);
    const release = w.svc.froms('assistant_jobs').find((o) => (argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined)?.tick_claimed_until === null)!;
    expect(eqs(release)).toEqual({ id: `${S}9`, tick_claimed_until: STAMP });

    const broken = service({ stuck: { data: null, error: { code: '42501', message: 'permission denied' } } });
    const res = await R.tick(new R.Book(broken.client, scripted('x')), new AbortController().signal, (_m, fb) => fb);
    expect(await res.json()).toEqual({ ok: true, jobs: [] });
    expect(broken.rpcs('assistant_job_claim_tick')).toHaveLength(1);
    expect(logged.join('\n')).toContain('sweep: claim failed');
  });
});
