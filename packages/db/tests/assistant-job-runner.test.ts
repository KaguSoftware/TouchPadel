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
import { estimateJob, JOB_EXTRACT_MODEL, type JobEstimate, type JobPlan } from '../supabase/functions/_shared/assistant/estimate.ts';
import { newHandleTable, type HandleTable } from '../supabase/functions/_shared/assistant/handles.ts';
import { buildJobSystem } from '../supabase/functions/_shared/assistant/prompt.ts';
import { ASSISTANT_TOOLS, LIST_ROW_CAP } from '../supabase/functions/_shared/assistant/tools.ts';
import { FLOOR_RATES, parseRates, turnEstimateMicros } from '../supabase/functions/_shared/assistant/turnPolicy.ts';
import { argsOf, denoEnv, eqs, fakeClient, loadDenoModule, type Op, type Result } from './assistant-edge-fakes';

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
}
interface Chunk { no: number; spec: { name: string }; args: Record<string, unknown>; offset: number; limit: number }
interface BookLike {
  price(u: Usage, model: string): Promise<number>;
}
interface Runner {
  Book: new (service: unknown, provider: unknown, extract?: unknown) => BookLike;
  chunksOf(job: JobRow): Chunk[] | string;
  runLive(book: BookLike, asOwner: unknown, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number): Promise<Response>;
  submitBatch(book: BookLike, asOwner: unknown, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string): Promise<Response>;
  tick(book: BookLike, signal: AbortSignal, providerOr: (model: string | null | undefined, fallback: unknown) => unknown): Promise<Response>;
  WALL_MS: number;
  TICK_CLAIM_SECONDS: number;
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
  begin?: Result;
  claim?: Result;
  /** The database's assistant_jobs rows (the tick's read filters them by its chain). */
  jobs?: JobRow[];
  jobsReadError?: unknown;
}

function service(o: SvcOpts = {}) {
  const transitions: { p_id: string; p_status: string; p_patch: Record<string, unknown> }[] = [];
  const fake = fakeClient({
    rpc: (name, args): Result => {
      if (name === 'llm_price_micros') {
        const model = String(args.p_model);
        if (o.priceFails === true || (Array.isArray(o.priceFails) && o.priceFails.includes(model))) return { data: null, error: { code: '42883', message: 'function app.llm_price_micros does not exist' } };
        if (o.priceNull) return { data: null, error: null };
        return { data: PRICE(model, { input: Number(args.p_input), output: Number(args.p_output) }), error: null };
      }
      if (name === 'llm_begin_request') return o.begin ?? { data: { month_cost_micros: 0, monthly_cap_micros: 1e12 }, error: null };
      if (name === 'assistant_job_transition') {
        // snapshot: the edge serialises the patch at call time, and the spend object keeps growing after
        transitions.push(structuredClone(args) as (typeof transitions)[number]);
        return { data: null, error: null };
      }
      if (name === 'assistant_job_claim_tick') return o.claim ?? { data: [], error: null };
      return { data: null, error: null };
    },
    from: (table, op: Op): Result => {
      const inserting = argsOf(op, 'insert') !== undefined;
      const updating = argsOf(op, 'update') !== undefined;
      if (table === 'assistant_messages') {
        if (inserting) return { data: null, error: null };
        return { data: o.maxSeq === undefined ? null : { seq: o.maxSeq }, error: null };
      }
      if (table === 'platform_settings') {
        const cols = String(argsOf(op, 'select')?.[0] ?? '');
        if (cols.includes('llm_pricing')) return o.pricing ?? { data: { llm_pricing: {}, llm_cost_micros_per_mtok: 0 }, error: null };
        return { data: { timezone: TZ }, error: null };
      }
      if (table === 'assistant_jobs' && !inserting && !updating) {
        if (o.jobsReadError) return { data: null, error: o.jobsReadError };
        const ids = (argsOf(op, 'in')?.[1] as string[] | undefined) ?? [];
        const e = eqs(op);
        const rows = (o.jobs ?? []).filter((j) => ids.includes(j.id) && (e.status === undefined || j.status === e.status) && (e.mode === undefined || j.mode === e.mode) && j.batch_id !== null);
        return { data: rows, error: null };
      }
      return { data: null, error: null };
    },
  });
  return { ...fake, transitions };
}

const rowId = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The owner's client: assistant_run_tool answers `limit` rows from `offset`, priced 1,000 IQD each. */
function owner(fail?: (args: Record<string, unknown>) => Result | null) {
  return fakeClient({
    rpc: (name, args): Result => {
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

  it('a chunk the model refuses fails the job with its code; the chunks that ran are still recorded, nothing is reduced or stored', async () => {
    const svc = service();
    const ex = extractor((no) => (no === 2 ? Promise.reject(new ProviderError('RATE_LIMITED', 'vendor said: slow down, org-secret-42', 429)) : null));
    const rd = reducer();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ job_id: JOB, status: 'failed', error: 'RATE_LIMITED', message: 'the model is rate-limited right now; try again in a minute', chunks_done: 2 });
    expect(statuses(svc)).toEqual(['failed']);
    expect(svc.transitions[0]!.p_patch.error).toBe('RATE_LIMITED: the model is rate-limited right now; try again in a minute');
    expect(JSON.stringify(svc.transitions)).not.toContain('org-secret-42');
    expect(logged.join('\n')).toContain(`live job ${JOB} failed (RATE_LIMITED)`);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(2); // spent is spent
    expect(rd.streams).toEqual([]);
    expect(insertRows(svc, 'assistant_messages')).toEqual([]);
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
    const svc = service({ begin: { data: { month_cost_micros: 999, monthly_cap_micros: 1000 }, error: null } });
    const ex = extractor();
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, reducer(), ex));
    expect(ex.streams).toHaveLength(1); // the first passes on the reading, the others count it in flight
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'LLM_MONTHLY_CAP' });
    expect(svc.rpcs('llm_record_usage')).toHaveLength(1);
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

  it('spend past the accepted estimate × 1.25 pauses the job in over_estimate with the objects kept, no reduce', async () => {
    const svc = service();
    const rd = reducer();
    const ex = extractor(() => textTurn('{"n":1}', { input: 900_000, cache_write: 0, cache_read: 0, output: 100 }));
    const res = await runLive(svc, owner(), threeChunks(), new R.Book(svc.client, rd, ex));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ job_id: JOB, status: 'over_estimate' });
    expect(statuses(svc)).toEqual(['over_estimate']);
    const patch = svc.transitions[0]!.p_patch as { result: { objects: unknown[] } };
    expect(patch.result.objects.length).toBeGreaterThan(0);
    expect(rd.streams).toEqual([]);
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
    const capped = service({ priceFails: true, begin: { data: { month_cost_micros: 999, monthly_cap_micros: 1000 }, error: null } });
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

    const patch = svc.froms('assistant_jobs').find((o) => argsOf(o, 'update'))!;
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
  function world(o: { claim?: Result; jobs?: JobRow[] } = {}) {
    const svc = service({
      maxSeq: 2,
      claim: o.claim ?? { data: [{ job_id: A, claimed_until: STAMP_A }, { job_id: B, claimed_until: STAMP_B }], error: null },
      jobs: o.jobs ?? [batchJob(A, 'batch_A'), batchJob(B, 'batch_B'), batchJob(C, 'batch_C')],
    });
    const fallback = scripted('the-tick-default');
    const opus = reducer('Three chunks read; one errored, one missing.');
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
    expect(w.svc.ops.indexOf(claim[0]!)).toBe(0);
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

  it('a poll that throws fails that job with its code and leaves the claim to lapse', async () => {
    const w = world({ claim: { data: [{ job_id: A, claimed_until: STAMP_A }], error: null } });
    w.sonnet.batchStatus.mockRejectedValueOnce(new ProviderError('UPSTREAM', 'vendor 500'));
    const body = (await (await w.tick()).json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toEqual([{ job_id: A, status: 'failed', error: 'UPSTREAM' }]);
    expect(w.svc.transitions).toEqual([expect.objectContaining({ p_id: A, p_status: 'failed', p_patch: expect.objectContaining({ error: 'UPSTREAM: the job failed' }) })]);
    expect(w.svc.froms('assistant_jobs').some((o) => (argsOf(o, 'update')?.[0] as Record<string, unknown> | undefined)?.tick_claimed_until === null)).toBe(false);
    expect(logged.join('\n')).toContain(`tick: job ${A} failed (UPSTREAM)`);
  });

  it('a batch submitted before 2026-10-08 (no extract_model) is read and priced at the job model', async () => {
    const w = world({ claim: { data: [{ job_id: A, claimed_until: STAMP_A }], error: null }, jobs: [batchJob(A, 'batch_A', { model: SONNET })] });
    await w.tick();
    expect(w.providerOr.mock.calls.slice(0, 2)).toEqual([[SONNET, w.fallback], [SONNET, w.sonnet]]);
    expect(w.svc.rpcs('llm_record_usage').map((o) => (o.args as Record<string, unknown>).p_model)).toEqual([SONNET, SONNET]);
  });
});
