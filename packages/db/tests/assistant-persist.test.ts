/**
 * persist.ts — the end of an assistant-chat turn, as behaviour (split out of
 * assistant-chat/index.ts on 2026-11-09), against a recording fake service
 * client (tests/assistant-edge-fakes.ts):
 *
 *   * the order: every call priced (app.llm_price_micros), the assistant row at
 *     the next seq, its assistant_calls rows, llm_record_usage,
 *     llm_record_web_search, then app.assistant_conversation_persist (0405)
 *     with THIS turn's delta (never stored + delta), a title only for an
 *     untitled chat and the frozen context only from a turn that finished;
 *     then the sources / gate / usage events;
 *   * the stored row: text blocks only (thinking dropped, a cited answer as
 *     one block), the gate with its deduped, sorted figures and the HMAC over
 *     them; a failed price keeps the call's estimate;
 *   * the error frame: a failed or timed-out turn stores its code as
 *     `tokens.error_code` (and `stop_reason`) and the text that had arrived,
 *     or one EMPTY text block (no longer "[CODE] sentence"), and still stores
 *     and records what it spent; a message that could not be stored writes no
 *     calls but the spend is still recorded;
 *   * how the turn ended (2026-11-11, packages/core outcome.ts): every row
 *     carries `stop_reason`; a Stop is `stopped` with no error_code, never
 *     TIMEOUT; a failed spend record is retried once, then logged loudly
 *     with the amounts;
 *   * a reused answer (no calls) prices and records nothing and says where it
 *     came from; a proposed job's row, its self-stamped estimate and the
 *     job_estimate event, or the UPSTREAM error frame when the row fails;
 *   * gateSigner, priceOf and webSearchPricer on their own.
 *
 * The SQL side of the persist RPC is tests/assistant-concurrency.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newHandleTable, handleFor, type HandleTable } from '../supabase/functions/_shared/assistant/handles.ts';
import { titleFrom } from '../supabase/functions/_shared/assistant/prompt.ts';
import { gateSignatureInput, type FrozenContext } from '../supabase/functions/_shared/assistant/turnPolicy.ts';
import { newTurnState, type TurnState } from '../supabase/functions/_shared/assistant/turn.ts';
import { argsOf, denoEnv, eqs, fakeClient, loadDenoModule, type Op, type Result } from './assistant-edge-fakes';

vi.mock('../supabase/functions/_shared/assistant/provider.ts', () => ({
  providerFromEnv: () => null,
  textOf: (c: { type: string; text?: string }[]) => c.filter((b) => b.type === 'text').map((b) => b.text).join(''),
  withoutThinking: (c: { type: string }[]) => c.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking'),
}));

type Block = { type: string; text?: string; [k: string]: unknown };
type Emit = (event: string, data: unknown) => void;
interface PersistInput {
  service: unknown;
  model: string;
  route: { kind: string; reason: string; effort: string };
  turn: TurnState<Block>;
  convId: string;
  convTitle: string | null;
  assistantMessageId: string;
  handles: HandleTable;
  scopes: readonly string[];
  ownerText: string;
  freshContext: FrozenContext | null;
  signal: AbortSignal;
  errorOut: { code: string; message: string } | null;
  stopped?: boolean;
  recordRetryMs?: number;
  reusedFrom: string | null;
  gateSign: ((input: string) => Promise<string>) | null;
  emit: Emit;
}
interface Persist {
  persistTurn(d: PersistInput): Promise<void>;
  gateSigner(): ((input: string) => Promise<string>) | null;
  priceOf(service: unknown, model: string, u: { input: number; cache_write: number; cache_read: number; output: number }): Promise<number | null>;
  webSearchPricer(service: unknown): () => Promise<number>;
  RECORD_RETRY_MS: number;
  insertMessage(service: unknown, conversationId: string, row: Record<string, unknown>): Promise<{ seq: number; error: unknown }>;
}

let P: Persist;
beforeAll(async () => {
  P = await loadDenoModule<Persist>('_shared/assistant/persist.ts');
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CONV = 'aaaaaaaa-0000-4000-8000-000000000001';
const MSG = 'bbbbbbbb-0000-4000-8000-000000000002';
const JOB = 'cccccccc-0000-4000-8000-000000000003';
const MODEL = 'claude-opus-5-5';
const ANSWER = 'Revenue was 4,250,000 IQD over 300 bookings.';

interface ServiceOpts {
  maxSeq?: number;
  /** p_input values whose llm_price_micros read fails. */
  priceFails?: number[];
  msgInsertError?: unknown;
  jobInsertError?: unknown;
}

/** A service client: prices are p_input × 50 micros, assistant_messages holds seq `maxSeq`, jobs get JOB. */
function service(o: ServiceOpts = {}) {
  return fakeClient({
    rpc: (name, args): Result => {
      if (name === 'llm_price_micros') {
        const input = Number(args.p_input);
        return o.priceFails?.includes(input) ? { data: null, error: { code: '42883', message: 'function missing' } } : { data: input * 50, error: null };
      }
      return { data: null, error: null };
    },
    from: (table, op: Op): Result => {
      const inserting = argsOf(op, 'insert') !== undefined;
      if (table === 'assistant_messages') {
        if (inserting) return { data: null, error: o.msgInsertError ?? null };
        return { data: o.maxSeq === undefined ? null : { seq: o.maxSeq }, error: null };
      }
      if (table === 'assistant_jobs' && inserting) return o.jobInsertError ? { data: null, error: o.jobInsertError } : { data: { id: JOB }, error: null };
      return { data: null, error: null };
    },
  });
}

function turnWith(over: Partial<TurnState<Block>> = {}): TurnState<Block> {
  const t = newTurnState<Block>();
  t.calls.push(
    { call_no: 1, model: MODEL, usage: { input: 1000, cache_write: 200, cache_read: 3000, output: 150 }, ms: 900, stop_reason: 'tool_use', cost_micros: 11_111, web_searches: 1, search_micros: 10_000 },
    { call_no: 2, model: MODEL, usage: { input: 400, cache_write: 0, cache_read: 4200, output: 90 }, ms: 700, stop_reason: 'end_turn', cost_micros: 2_222, web_searches: 0, search_micros: 0 },
  );
  t.sources.push({ call_id: 't1', name: 'report_revenue', args: { from: '2026-11-01', to: '2026-11-07' }, row_count: 1, ms: 120, route: '/reports/revenue', stats: null });
  t.allowed.push(4_250_000, 300, 4_250_000, 12);
  t.webSearches = 1;
  t.finalContent = [{ type: 'thinking', thinking: 'private chain' }, { type: 'text', text: ANSWER }];
  t.finalText = ANSWER;
  t.gate = { status: 'ok', unverified: [], checked: 2 };
  return Object.assign(t, over);
}

const fresh: FrozenContext = { v: 1, text: 'first turn', numbers: [], scopes: ['money'], range: { from: '2026-11-01', to: '2026-11-07' }, today: '2026-11-09', tz: 'Asia/Baghdad', venue_scope: null, model: MODEL, built_at: '2026-11-09T10:00:00.000Z' } as FrozenContext;

function input(svc: unknown, over: Partial<PersistInput> = {}) {
  const events: [string, unknown][] = [];
  const d: PersistInput = {
    service: svc,
    model: MODEL,
    route: { kind: 'analysis', reason: 'compare', effort: 'medium' },
    turn: turnWith(),
    convId: CONV,
    convTitle: null,
    assistantMessageId: MSG,
    handles: newHandleTable({}),
    scopes: ['money', 'howto'],
    ownerText: '  How much   revenue did we make this week, and how does it compare with last week?  ',
    freshContext: fresh,
    signal: new AbortController().signal,
    errorOut: null,
    reusedFrom: null,
    gateSign: vi.fn(async (s: string) => `sig(${s})`),
    emit: (e, data) => events.push([e, data]),
    ...over,
  };
  return { d, events };
}

const opName = (o: Op) => (o.kind === 'from' ? `${o.name}.${argsOf(o, 'insert') ? 'insert' : argsOf(o, 'update') ? 'update' : 'select'}` : o.name);
const persistArgs = (ops: Op[]) => ops.find((o) => o.name === 'assistant_conversation_persist')!.args as Record<string, unknown>;
const storedRow = (ops: Op[]) => argsOf(ops.find((o) => o.name === 'assistant_messages' && argsOf(o, 'insert'))!, 'insert')![0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
describe('persistTurn: a turn that finished', () => {
  it('writes in order: prices, the message at the next seq, its calls, the usage, the searches, then the conversation', async () => {
    const svc = service({ maxSeq: 4 });
    const { d } = input(svc.client);
    await P.persistTurn(d);
    expect(svc.ops.map(opName)).toEqual([
      'llm_price_micros',
      'llm_price_micros',
      'assistant_messages.select',
      'assistant_messages.insert',
      'assistant_calls.insert',
      'llm_record_usage',
      'llm_record_web_search',
      'assistant_conversation_persist',
    ]);
    for (const o of svc.rpcs()) expect(o.schema, o.name).toBe('app');
    expect(eqs(svc.froms('assistant_messages')[0]!)).toEqual({ conversation_id: CONV });
  });

  it('stores the text blocks only, the exact cost, and the gate with its deduped sorted figures and their signature', async () => {
    const svc = service({ maxSeq: 4 });
    const { d } = input(svc.client);
    await P.persistTurn(d);
    const row = storedRow(svc.ops);
    expect(row).toMatchObject({ id: MSG, conversation_id: CONV, seq: 5, role: 'assistant', content: [{ type: 'text', text: ANSWER }] });
    expect(row.sources).toEqual(d.turn.sources);
    const numbers = [12, 300, 4_250_000];
    expect(d.gateSign).toHaveBeenCalledWith(gateSignatureInput(CONV, MSG, numbers));
    expect(row.gate).toEqual({ status: 'ok', unverified: [], checked: 2, numbers, sig: `sig(${gateSignatureInput(CONV, MSG, numbers)})` });
    // 1000 × 50 + 10,000 for the search, then 400 × 50: 80,000.
    expect(row.tokens).toEqual({
      input: 1400, cache_write: 200, cache_read: 7200, output: 240,
      cost_micros: 80_000, calls: 2, model: MODEL, web_searches: 1,
      route: 'analysis', route_reason: 'compare', effort: 'medium',
      stop_reason: 'end_turn',
    });
  });

  it('stores one assistant_calls row per call, priced exactly, and records the usage and the searches', async () => {
    const svc = service({ maxSeq: 0 });
    const { d } = input(svc.client);
    await P.persistTurn(d);
    const calls = argsOf(svc.froms('assistant_calls')[0]!, 'insert')![0] as Record<string, unknown>[];
    expect(calls).toEqual([
      { message_id: MSG, call_no: 1, model: MODEL, input_tokens: 1000, cache_write_tokens: 200, cache_read_tokens: 3000, output_tokens: 150, cost_micros: 60_000, web_searches: 1, ms: 900, stop_reason: 'tool_use' },
      { message_id: MSG, call_no: 2, model: MODEL, input_tokens: 400, cache_write_tokens: 0, cache_read_tokens: 4200, output_tokens: 90, cost_micros: 20_000, web_searches: 0, ms: 700, stop_reason: 'end_turn' },
    ]);
    expect(svc.rpcs('llm_record_usage')[0]!.args).toEqual({ p_model: MODEL, p_input: 1400, p_cache_write: 200, p_cache_read: 7200, p_output: 240, p_model_calls: 2, p_surface: 'assistant' });
    expect(svc.rpcs('llm_record_web_search')[0]!.args).toEqual({ p_searches: 1 });
    expect(svc.rpcs('llm_price_micros')[0]!.args).toEqual({ p_model: MODEL, p_input: 1000, p_cache_write: 200, p_cache_read: 3000, p_output: 150 });
  });

  it('hands assistant_conversation_persist THIS turn\'s delta, a title for an untitled chat and the fresh context', async () => {
    const svc = service();
    const handles = newHandleTable({});
    handleFor(handles, 'dddddddd-0000-4000-8000-000000000004', 'r');
    const { d } = input(svc.client, { handles });
    await P.persistTurn(d);
    expect(persistArgs(svc.ops)).toEqual({
      p_conversation_id: CONV,
      p_handles: { r1: 'dddddddd-0000-4000-8000-000000000004', _next: { r: 2 } },
      p_usage: { input: 1400, cache_write: 200, cache_read: 7200, output: 240, cost_micros: 80_000, calls: 2, web_searches: 1 },
      p_title: titleFrom(d.ownerText),
      p_context: fresh,
    });
  });

  it('a chat that has a title gets none; a replayed context (null) is not written', async () => {
    const svc = service();
    const { d } = input(svc.client, { convTitle: 'Revenue this week', freshContext: null });
    await P.persistTurn(d);
    expect(persistArgs(svc.ops)).toMatchObject({ p_title: null, p_context: null });
  });

  it('emits sources, then the gate with its retry flag, then the usage', async () => {
    const svc = service();
    const { d, events } = input(svc.client, { turn: turnWith({ gateRetried: true }) });
    await P.persistTurn(d);
    expect(events.map(([e]) => e)).toEqual(['sources', 'gate', 'usage']);
    expect(events[0]![1]).toEqual({ items: d.turn.sources, scopes: ['money', 'howto'] });
    expect(events[1]![1]).toEqual({ status: 'ok', unverified: [], checked: 2, retried: true });
    expect(events[2]![1]).toEqual({ input: 1400, cache_write: 200, cache_read: 7200, output: 240, cost_micros: 80_000, calls: 2, model: MODEL, web_searches: 1 });
  });

  it('a cited web answer is stored as one text block', async () => {
    const svc = service();
    const turn = turnWith({
      finalContent: [
        { type: 'text', text: 'Padel courts in Erbil charge ', citations: [{ url: 'https://example.test' }] },
        { type: 'text', text: '40,000 IQD an hour.' },
      ],
    });
    const { d } = input(svc.client, { turn });
    await P.persistTurn(d);
    expect(storedRow(svc.ops).content).toEqual([{ type: 'text', text: 'Padel courts in Erbil charge 40,000 IQD an hour.' }]);
  });

  it('a price that cannot be read keeps that call\'s estimate (logged); the others are exact', async () => {
    const svc = service({ priceFails: [1000] });
    const { d } = input(svc.client);
    await P.persistTurn(d);
    const calls = argsOf(svc.froms('assistant_calls')[0]!, 'insert')![0] as { cost_micros: number }[];
    expect(calls.map((c) => c.cost_micros)).toEqual([11_111, 20_000]);
    expect((persistArgs(svc.ops).p_usage as { cost_micros: number }).cost_micros).toBe(31_111);
    expect(logged.join('\n')).toContain('llm_price_micros');
  });
});

// ---------------------------------------------------------------------------
describe('persistTurn: the gate signature', () => {
  it('a signer that throws stores the gate unsigned and says so in the log', async () => {
    const svc = service();
    const { d } = input(svc.client, { gateSign: vi.fn(async () => { throw new Error('subtle down'); }) });
    await P.persistTurn(d);
    const gate = storedRow(svc.ops).gate as Record<string, unknown>;
    expect(gate.numbers).toEqual([12, 300, 4_250_000]);
    expect(gate).not.toHaveProperty('sig');
    expect(logged.join('\n')).toContain('gate figures not signed');
  });

  it('no signer (no key) or no figures: nothing is signed', async () => {
    const a = service();
    await P.persistTurn(input(a.client, { gateSign: null }).d);
    expect(storedRow(a.ops).gate).not.toHaveProperty('sig');
    const b = service();
    const sign = vi.fn(async () => 'x');
    await P.persistTurn(input(b.client, { gateSign: sign, turn: turnWith({ allowed: [] }) }).d);
    expect(sign).not.toHaveBeenCalled();
    expect(storedRow(b.ops).gate).toEqual({ status: 'ok', unverified: [], checked: 2, numbers: [] });
  });
});

// ---------------------------------------------------------------------------
describe('persistTurn: the error frame', () => {
  it('a timed-out turn stores its code (no placeholder text: one empty block), still stores its calls and spend, and keeps the context out', async () => {
    const svc = service({ maxSeq: 2 });
    const abort = new AbortController();
    abort.abort();
    const { d, events } = input(svc.client, {
      turn: turnWith({ finalContent: [], finalText: '', gate: null }),
      errorOut: { code: 'TIMEOUT', message: 'the turn did not finish inside 50 s' },
      signal: abort.signal,
    });
    await P.persistTurn(d);
    const row = storedRow(svc.ops);
    expect(row.content).toEqual([{ type: 'text', text: '' }]);
    expect(row.tokens).toMatchObject({ stop_reason: 'TIMEOUT', error_code: 'TIMEOUT' });
    expect(row.gate).toBeNull();
    expect(row.seq).toBe(3);
    expect(svc.froms('assistant_calls')).toHaveLength(1);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(1);
    expect(persistArgs(svc.ops).p_context).toBeNull();
    expect(events.map(([e]) => e)).toEqual(['sources', 'usage']); // no gate without a verdict
  });

  it('a failed turn that was not aborted still keeps its fresh context out (contextStorable)', async () => {
    const svc = service();
    const { d } = input(svc.client, { errorOut: { code: 'UPSTREAM', message: 'the model call failed' } });
    await P.persistTurn(d);
    expect(persistArgs(svc.ops).p_context).toBeNull();
  });

  it('a Stop during a turn that otherwise finished keeps the context out too', async () => {
    const svc = service();
    const abort = new AbortController();
    abort.abort();
    await P.persistTurn(input(svc.client, { signal: abort.signal }).d);
    expect(persistArgs(svc.ops).p_context).toBeNull();
  });

  it('a message that could not be stored writes no calls, but the spend is still recorded and the chat updated', async () => {
    const svc = service({ msgInsertError: { code: '42501', message: 'permission denied for table assistant_messages' } });
    const { d } = input(svc.client);
    await P.persistTurn(d);
    expect(svc.froms('assistant_calls')).toEqual([]);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(1);
    expect(svc.rpcs('assistant_conversation_persist')).toHaveLength(1);
    expect(logged.join('\n')).toContain(`assistant message ${MSG} not stored in ${CONV}`);
  });
});

// ---------------------------------------------------------------------------
describe('persistTurn: how the turn ended (stop_reason, error_code)', () => {
  const tokensOf = async (over: Partial<PersistInput>) => {
    const svc = service();
    await P.persistTurn(input(svc.client, over).d);
    return { row: storedRow(svc.ops), svc };
  };

  it('every stored row carries the loop\'s stop_reason and no error_code when the turn did not fail', async () => {
    for (const stopReason of ['end_turn', 'max_tokens', 'refusal', 'cost_capped', 'rounds_exhausted', 'job_proposed']) {
      const { row } = await tokensOf({ turn: turnWith({ stopReason }) });
      expect(row.tokens, stopReason).toMatchObject({ stop_reason: stopReason });
      expect(row.tokens, stopReason).not.toHaveProperty('error_code');
    }
    const reused = await tokensOf({ turn: turnWith({ calls: [], webSearches: 0 }), reusedFrom: 'eeeeeeee-0000-4000-8000-000000000005' });
    expect(reused.row.tokens).toMatchObject({ stop_reason: 'end_turn', reused_from: 'eeeeeeee-0000-4000-8000-000000000005' });
  });

  it('a failed turn stores error_code and the same code as stop_reason (what the live done event says), for every code', async () => {
    for (const code of ['TIMEOUT', 'UPSTREAM', 'RATE_LIMITED', 'NOT_CONFIGURED']) {
      const { row } = await tokensOf({ turn: turnWith({ finalContent: [], finalText: '', gate: null, stopReason: 'tool_use' }), errorOut: { code, message: 'x' } });
      expect(row.tokens, code).toMatchObject({ stop_reason: code, error_code: code });
      expect(row.content, code).toEqual([{ type: 'text', text: '' }]);
    }
  });

  it('a failed turn keeps the text that had arrived (no placeholder appended)', async () => {
    const { row } = await tokensOf({ turn: turnWith({ finalContent: [], finalText: 'Revenue was 4,250,000 IQD and', gate: null }), errorOut: { code: 'UPSTREAM', message: 'the model call failed' } });
    expect(row.content).toEqual([{ type: 'text', text: 'Revenue was 4,250,000 IQD and' }]);
    expect(row.tokens).toMatchObject({ error_code: 'UPSTREAM' });
  });

  it('a Stop is stopped, not TIMEOUT: no error_code, the text that arrived, the spend recorded, the context kept out', async () => {
    const abort = new AbortController();
    abort.abort();
    const { row, svc } = await tokensOf({
      turn: turnWith({ finalContent: [], finalText: 'Revenue was 4,250,000', gate: null, stopReason: 'tool_use' }),
      stopped: true,
      signal: abort.signal,
    });
    expect(row.tokens).toMatchObject({ stop_reason: 'stopped' });
    expect(row.tokens).not.toHaveProperty('error_code');
    expect(row.content).toEqual([{ type: 'text', text: 'Revenue was 4,250,000' }]);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(1);
    expect(svc.froms('assistant_calls')).toHaveLength(1);
    expect(persistArgs(svc.ops).p_context).toBeNull();
  });

  it('a Stop with nothing arrived stores one empty text block; a failure reported alongside a Stop wins (error_code kept)', async () => {
    const empty = await tokensOf({ turn: turnWith({ finalContent: [], finalText: '', gate: null }), stopped: true });
    expect(empty.row.content).toEqual([{ type: 'text', text: '' }]);
    expect(empty.row.tokens).toMatchObject({ stop_reason: 'stopped' });
    const both = await tokensOf({ stopped: true, errorOut: { code: 'TIMEOUT', message: 'x' } });
    expect(both.row.tokens).toMatchObject({ stop_reason: 'TIMEOUT', error_code: 'TIMEOUT' });
  });
});

// ---------------------------------------------------------------------------
describe('persistTurn: the spend is never dropped silently', () => {
  /** A service whose spend RPCs fail the first `fails[name]` times. */
  function flaky(fails: Record<string, number>) {
    const seen: Record<string, number> = {};
    return fakeClient({
      rpc: (name, args): Result => {
        if (name === 'llm_price_micros') return { data: Number(args.p_input) * 50, error: null };
        seen[name] = (seen[name] ?? 0) + 1;
        return seen[name]! <= (fails[name] ?? 0) ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } : { data: null, error: null };
      },
      from: (): Result => ({ data: null, error: null }),
    });
  }

  it('a failed llm_record_usage and llm_record_web_search are each retried once; a retry that lands logs no loss', async () => {
    const svc = flaky({ llm_record_usage: 1, llm_record_web_search: 1 });
    await P.persistTurn(input(svc.client, { recordRetryMs: 0 }).d);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(2);
    expect(svc.rpcs('llm_record_usage')[1]!.args).toEqual(svc.rpcs('llm_record_usage')[0]!.args);
    expect(svc.rpcs('llm_record_web_search')).toHaveLength(2);
    expect(logged.join('\n')).toContain('llm_record_usage failed; retrying once');
    expect(logged.join('\n')).not.toContain('SPEND NOT RECORDED');
    expect(svc.rpcs('assistant_conversation_persist')).toHaveLength(1);
  });

  it('two failures: logged loudly with the amounts, and the turn still persists the chat', async () => {
    const svc = flaky({ llm_record_usage: 2, llm_record_web_search: 2 });
    await P.persistTurn(input(svc.client, { recordRetryMs: 0 }).d);
    expect(svc.rpcs('llm_record_usage')).toHaveLength(2);
    const log = logged.join('\n');
    expect(log).toContain(`SPEND NOT RECORDED: llm_record_usage failed twice for message ${MSG}`);
    expect(log).toContain('"p_input":1400');
    expect(log).toContain('"p_output":240');
    expect(log).toContain(`SPEND NOT RECORDED: llm_record_web_search failed twice for message ${MSG}`);
    expect(log).toContain('"p_searches":1');
    expect(svc.rpcs('assistant_conversation_persist')).toHaveLength(1);
  });

  it('the retry waits RECORD_RETRY_MS by default', async () => {
    vi.useFakeTimers();
    try {
      const svc = flaky({ llm_record_usage: 1 });
      const done = P.persistTurn(input(svc.client, { turn: turnWith({ webSearches: 0 }) }).d);
      await vi.advanceTimersByTimeAsync(0);
      expect(svc.rpcs('llm_record_usage')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(P.RECORD_RETRY_MS);
      await done;
      expect(svc.rpcs('llm_record_usage')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
describe('persistTurn: a reused answer and a proposed job', () => {
  it('a reused answer (no model call) prices and records nothing and names the message it came from', async () => {
    const svc = service();
    const { d, events } = input(svc.client, { turn: turnWith({ calls: [], webSearches: 0 }), reusedFrom: 'eeeeeeee-0000-4000-8000-000000000005' });
    await P.persistTurn(d);
    expect(svc.ops.map(opName)).toEqual(['assistant_messages.select', 'assistant_messages.insert', 'assistant_conversation_persist']);
    expect(storedRow(svc.ops).tokens).toMatchObject({ calls: 0, cost_micros: 0, reused_from: 'eeeeeeee-0000-4000-8000-000000000005' });
    expect(persistArgs(svc.ops).p_usage).toEqual({ input: 0, cache_write: 0, cache_read: 0, output: 0, cost_micros: 0, calls: 0, web_searches: 0 });
    expect(events.map(([e]) => e)).toEqual(['sources', 'gate', 'usage']);
  });

  it('a cost-capped turn says so on the stored tokens', async () => {
    const svc = service();
    await P.persistTurn(input(svc.client, { turn: turnWith({ costCapped: true }) }).d);
    expect(storedRow(svc.ops).tokens).toMatchObject({ cost_capped: true });
  });

  const estimate = {
    rows: 600, chunks: 3, per_tool: [], tokens: { input: 1, cache_read: 0, output: 1, total: 2 }, tokens_high: { input: 1, cache_read: 0, output: 1, total: 2 },
    modes: { aggregate: null, live: { allowed: true }, batch: { allowed: true } }, assumptions: [], first_chunk_exact: 1234,
    plan: { question: 'q', calls: [{ tool: 'bookings_list', args: {} }], aggregate_alternative: null },
  };

  it('a proposed job: its row (estimated, plan apart from the estimate), the estimate stamped with its own id, the job_estimate event, no gate event', async () => {
    const svc = service();
    const { d, events } = input(svc.client, { turn: turnWith({ jobEstimate: estimate as never }) });
    await P.persistTurn(d);
    const [ins, upd] = svc.froms('assistant_jobs');
    const { plan, ...rest } = estimate;
    expect(argsOf(ins!, 'insert')![0]).toEqual({ conversation_id: CONV, message_id: MSG, status: 'estimated', plan, estimate: rest, chunks_total: 3, chunks_done: 0, tokens: {} });
    expect(argsOf(upd!, 'update')![0]).toEqual({ estimate: { ...rest, job_id: JOB } });
    expect(eqs(upd!)).toEqual({ id: JOB });
    expect(events.map(([e]) => e)).toEqual(['job_estimate', 'sources', 'usage']);
    expect(events[0]![1]).toEqual({ ...rest, job_id: JOB });
  });

  it('a job row that cannot be stored is the UPSTREAM error frame, no job_estimate', async () => {
    const svc = service({ jobInsertError: { code: '23503', message: 'fk violation' } });
    const { d, events } = input(svc.client, { turn: turnWith({ jobEstimate: estimate as never }) });
    await P.persistTurn(d);
    expect(events.map(([e]) => e)).toEqual(['error', 'sources', 'usage']);
    expect(events[0]![1]).toEqual({ code: 'UPSTREAM', message: 'the job estimate could not be stored' });
    expect(logged.join('\n')).toContain('job not stored');
  });
});

// ---------------------------------------------------------------------------
describe('gateSigner, priceOf, webSearchPricer, insertMessage', () => {
  it('gateSigner is null without the service key; with it, a stable 64-hex HMAC per input', async () => {
    expect(P.gateSigner()).toBeNull();
    vi.stubGlobal('Deno', denoEnv({ SUPABASE_SERVICE_ROLE_KEY: 'local-service-key' }));
    const sign = P.gateSigner()!;
    const a = await sign('assistant-gate:v1:c:m:[1,2]');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sign('assistant-gate:v1:c:m:[1,2]')).toBe(a);
    expect(await sign('assistant-gate:v1:c:m:[1,3]')).not.toBe(a);
  });

  it('priceOf answers the RPC\'s number, null (logged) when it fails', async () => {
    const svc = service({ priceFails: [7] });
    expect(await P.priceOf(svc.client, MODEL, { input: 10, cache_write: 0, cache_read: 0, output: 0 })).toBe(500);
    expect(await P.priceOf(svc.client, MODEL, { input: 7, cache_write: 0, cache_read: 0, output: 0 })).toBeNull();
    expect(logged.join('\n')).toContain('llm_price_micros');
  });

  it('webSearchPricer reads platform_settings once per turn; an unread row is the 10,000-micro default', async () => {
    const ok = fakeClient({ from: () => ({ data: { llm_web_search_micros: 12_500 }, error: null }) });
    const price = P.webSearchPricer(ok.client);
    expect(await price()).toBe(12_500);
    expect(await price()).toBe(12_500);
    expect(ok.froms('platform_settings')).toHaveLength(1);
    expect(eqs(ok.froms('platform_settings')[0]!)).toEqual({ id: true });
    const bad = fakeClient({ from: () => ({ data: null, error: { code: '42501', message: 'denied' } }) });
    expect(await P.webSearchPricer(bad.client)()).toBe(10_000);
    expect(logged.join('\n')).toContain('llm_web_search_micros unread');
  });

  it('insertMessage lands at max(seq) + 1 and re-reads after a 23505', async () => {
    let inserts = 0;
    let max = 6;
    const svc = fakeClient({
      from: (_t, op) => {
        if (argsOf(op, 'insert')) {
          inserts++;
          if (inserts === 1) {
            max = 7; // another send took 7 meanwhile
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          return { data: null, error: null };
        }
        return { data: { seq: max }, error: null };
      },
    });
    const out = await P.insertMessage(svc.client, CONV, { role: 'user', content: [] });
    expect(out).toEqual({ seq: 8, error: null });
    const rows = svc.froms('assistant_messages').filter((o) => argsOf(o, 'insert')).map((o) => (argsOf(o, 'insert')![0] as { seq: number }).seq);
    expect(rows).toEqual([7, 8]);
  });
});
