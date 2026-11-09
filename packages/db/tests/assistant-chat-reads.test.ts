/**
 * assistant-chat's reads and the two no-model paths that run on them (split
 * out of assistant-chat/index.ts on 2026-11-09), as behaviour:
 *
 *   * reads.ts: the queries each read sends (which client, which columns,
 *     which filters; the answer reuse filters on owner_id IN the query, the
 *     history window is tailStartSeq..userSeq-1 with the turn's signal) and
 *     each read's fallback when it fails (logged, never fatal);
 *   * reuse.ts findReusableAnswer over injected reads: only a chat of the
 *     last REUSE_LOOKBACK_MS, the same scopes (any order) and the same branch
 *     in scope, whose FIRST message is the same question once normalised;
 *     its stored tools re-run against THAT chat's handles inside a time box,
 *     and any moved figure, failed tool, non-assistant or stale reply means
 *     no reuse; at most three candidates are tried;
 *   * recheck.ts recheckMessage over an injected RecheckIo: 400 / 500 / 404 /
 *     403 before anything runs, knowledge, meta and failed calls skipped, the
 *     diff against the live figures, `baseline: false` for an old message,
 *     the 30 s time box (fake timers), and a runner's raw error never shown.
 *
 * Pure diff arithmetic is tests/assistant-recheck.test.ts; planReuse's rules
 * are tests/assistant-reuse.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CleanError, type Cleaned } from '../supabase/functions/_shared/assistant/clean.ts';
import { newHandleTable, type HandleTable } from '../supabase/functions/_shared/assistant/handles.ts';
import { recheckMessage, RECHECK_WALL_MS, type RecheckIo } from '../supabase/functions/_shared/assistant/recheck.ts';
import { findReusableAnswer, REUSE_LOOKBACK_MS, type ReuseReads } from '../supabase/functions/_shared/assistant/reuse.ts';
import type { AssistantScope, ToolSpec } from '../supabase/functions/_shared/assistant/tools.ts';
import { TAIL_MESSAGES, TAIL_STEP, tailStartSeq } from '../supabase/functions/_shared/assistant/turnPolicy.ts';
import type { Dispatched } from '../supabase/functions/_shared/assistant/turn.ts';
import { argsOf, eqs, fakeClient, loadDenoModule, type Op } from './assistant-edge-fakes';

vi.mock('../supabase/functions/_shared/assistant/provider.ts', () => ({
  providerFromEnv: () => null,
  textOf: () => '',
  withoutThinking: (c: unknown[]) => c,
}));

interface Reads {
  venueModels(service: unknown): Promise<{ default_model: string | null; priced: string[]; rates: Record<string, unknown>; fallback_per_mtok: number }>;
  readConversation(asOwner: unknown, id: string): Promise<{ data: unknown; error: unknown }>;
  latestAnswer(asOwner: unknown, id: string): Promise<{ tokens: unknown; created_at: unknown } | null>;
  venueTimezone(asOwner: unknown): Promise<string>;
  readTail(service: unknown, id: string, userSeq: number, signal: AbortSignal): Promise<unknown[]>;
  recheckReads(asOwner: unknown): { readMessage(id: string): PromiseLike<{ data: unknown; error: unknown }>; readConversation(id: string): PromiseLike<{ data: unknown; error: unknown }> };
  reuseReads(service: unknown): ReuseReads;
}

let RD: Reads;
beforeAll(async () => {
  RD = await loadDenoModule<Reads>('_shared/assistant/reads.ts');
});

let logged: string[];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    logged.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const OWNER = '0000000a-0000-4000-8000-00000000000a';
const OTHER_OWNER = '0000000b-0000-4000-8000-00000000000b';
const CONV = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEW_CONV = 'aaaaaaaa-0000-4000-8000-0000000000ff';
const MSG = 'bbbbbbbb-0000-4000-8000-000000000002';
const COURT = 'dddddddd-0000-4000-8000-000000000004';
const BRANCH_B = 'eeeeeeee-0000-4000-8000-00000000000b';

/** A tool result with these figures (the shape rerunStored reads). */
function result(numbers: number[], over: Partial<Dispatched> = {}): Dispatched {
  return { cleaned: { text: numbers.join(' '), numbers, stats: { rows_out: 1 } } as unknown as Cleaned, isError: false, row_count: 1, ...over };
}
const err = (text: string): Dispatched => ({ cleaned: { text, numbers: [], stats: { rows_out: 0 } } as unknown as Cleaned, isError: true, row_count: null });

// ---------------------------------------------------------------------------
describe('reads.ts', () => {
  const only = (ops: Op[]) => {
    expect(ops).toHaveLength(1);
    return ops[0]!;
  };

  it('reuseReads: the owner\'s live chats of the window, owner_id in the query, the new chat left out, newest first, 60 at most', async () => {
    const svc = fakeClient({ from: () => ({ data: [], error: null }) });
    await RD.reuseReads(svc.client).recentChats({ ownerId: OWNER, since: '2026-11-08T07:00:00.000Z', excludeId: NEW_CONV });
    const op = only(svc.froms('assistant_conversations'));
    expect(argsOf(op, 'select')).toEqual(['id, scopes, handles, context']);
    expect(eqs(op)).toEqual({ owner_id: OWNER });
    expect(argsOf(op, 'is')).toEqual(['archived_at', null]);
    expect(argsOf(op, 'gte')).toEqual(['updated_at', '2026-11-08T07:00:00.000Z']);
    expect(argsOf(op, 'neq')).toEqual(['id', NEW_CONV]);
    expect(argsOf(op, 'order')).toEqual(['updated_at', { ascending: false }]);
    expect(argsOf(op, 'limit')).toEqual([60]);
  });

  it('reuseReads: first user messages (seq 1) of the given chats, and one chat\'s reply at seq 2', async () => {
    const svc = fakeClient({ from: () => ({ data: [], error: null }) });
    const reads = RD.reuseReads(svc.client);
    await reads.firstMessages([CONV, NEW_CONV]);
    await reads.reply(CONV);
    const [first, reply] = svc.froms('assistant_messages');
    expect(argsOf(first!, 'in')).toEqual(['conversation_id', [CONV, NEW_CONV]]);
    expect(eqs(first!)).toEqual({ seq: 1, role: 'user' });
    expect(argsOf(first!, 'limit')).toEqual([60]);
    expect(eqs(reply!)).toEqual({ conversation_id: CONV, seq: 2 });
    expect(argsOf(reply!, 'select')).toEqual(['id, role, content, sources, gate, tokens, created_at']);
    expect(argsOf(reply!, 'maybeSingle')).toEqual([]);
  });

  it('recheckReads and readConversation read through the client they are given, with owner_id for the caller\'s comparison', async () => {
    const owner = fakeClient({ from: () => ({ data: null, error: null }) });
    const io = RD.recheckReads(owner.client);
    await io.readMessage(MSG);
    await io.readConversation(CONV);
    await RD.readConversation(owner.client, CONV);
    const [msg] = owner.froms('assistant_messages');
    const [c1, c2] = owner.froms('assistant_conversations');
    expect(argsOf(msg!, 'select')).toEqual(['id, conversation_id, role, content, sources, gate']);
    expect(eqs(msg!)).toEqual({ id: MSG });
    expect(argsOf(c1!, 'select')).toEqual(['id, owner_id, scopes, handles']);
    expect(String(argsOf(c2!, 'select')![0])).toMatch(/\bowner_id\b.*\bcontext\b/);
    expect(eqs(c2!)).toEqual({ id: CONV });
  });

  it('readTail: the aligned window up to the new message, ascending, bounded, on the turn\'s signal; a failed read is no history', async () => {
    const signal = new AbortController().signal;
    const rows = [{ id: 'x', role: 'user', content: [], seq: 21, gate: null }];
    const ok = fakeClient({ from: () => ({ data: rows, error: null }) });
    expect(await RD.readTail(ok.client, CONV, 30, signal)).toEqual(rows);
    const op = only(ok.froms('assistant_messages'));
    expect(argsOf(op, 'gte')).toEqual(['seq', tailStartSeq(30)]);
    expect(argsOf(op, 'lt')).toEqual(['seq', 30]);
    expect(argsOf(op, 'order')).toEqual(['seq', { ascending: true }]);
    expect(argsOf(op, 'limit')).toEqual([TAIL_MESSAGES + TAIL_STEP]);
    expect(op.signal).toBe(signal);
    const bad = fakeClient({ from: () => ({ data: null, error: { code: '57014', message: 'timeout' } }) });
    expect(await RD.readTail(bad.client, CONV, 30, signal)).toEqual([]);
    expect(logged.join('\n')).toContain('history not read');
  });

  it('latestAnswer: the newest assistant row; an error or a throw is null, logged', async () => {
    const ok = fakeClient({ from: () => ({ data: { tokens: { model: 'claude-sonnet-5-5' }, created_at: 't' }, error: null }) });
    expect(await RD.latestAnswer(ok.client, CONV)).toEqual({ tokens: { model: 'claude-sonnet-5-5' }, created_at: 't' });
    const op = only(ok.froms('assistant_messages'));
    expect(eqs(op)).toEqual({ conversation_id: CONV, role: 'assistant' });
    expect(argsOf(op, 'order')).toEqual(['seq', { ascending: false }]);
    const bad = fakeClient({ from: () => ({ data: null, error: { code: '42501', message: 'denied' } }) });
    expect(await RD.latestAnswer(bad.client, CONV)).toBeNull();
    const thrown = fakeClient({ from: () => { throw new Error('socket hang up'); } });
    expect(await RD.latestAnswer(thrown.client, CONV)).toBeNull();
    expect(logged.filter((l) => l.includes('latest answer unread'))).toHaveLength(2);
  });

  it('venueTimezone: the platform timezone, else Asia/Baghdad (an error is logged)', async () => {
    expect(await RD.venueTimezone(fakeClient({ from: () => ({ data: { timezone: 'Europe/Istanbul' }, error: null }) }).client)).toBe('Europe/Istanbul');
    expect(await RD.venueTimezone(fakeClient({ from: () => ({ data: { timezone: '' }, error: null }) }).client)).toBe('Asia/Baghdad');
    expect(await RD.venueTimezone(fakeClient({ from: () => ({ data: null, error: { message: 'x' } }) }).client)).toBe('Asia/Baghdad');
    expect(logged.join('\n')).toContain('timezone unread');
  });

  it('venueModels: the default, the priced models with their rates and the blended fallback; an unread list is logged, never fatal', async () => {
    const svc = fakeClient({
      from: () => ({
        data: { llm_default_model: 'claude-sonnet-5-5', llm_pricing: { 'claude-opus-5-5': { input: 5_000_000, output: 25_000_000 }, 'claude-sonnet-5-5': { input: 3_000_000 } }, llm_cost_micros_per_mtok: 6_000_000 },
        error: null,
      }),
    });
    const m = await RD.venueModels(svc.client);
    expect(m.default_model).toBe('claude-sonnet-5-5');
    expect(m.priced).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(m.rates['claude-opus-5-5']).toEqual({ input: 5_000_000, output: 25_000_000 });
    expect(m.fallback_per_mtok).toBe(6_000_000);
    const bad = await RD.venueModels(fakeClient({ from: () => ({ data: null, error: { message: 'x' } }) }).client);
    expect(bad).toEqual({ default_model: null, priced: [], rates: {}, fallback_per_mtok: 0 });
    expect(logged.join('\n')).toContain('estimating at the floor rates');
  });
});

// ---------------------------------------------------------------------------
describe('findReusableAnswer', () => {
  const NOW = Date.parse('2026-11-09T09:00:00.000Z'); // 12:00 in Baghdad
  const TODAY = '2026-11-09';
  const TZ = 'Asia/Baghdad';
  const QUESTION = 'How much revenue did we make today?';
  const ANSWER = 'Revenue today is 4,250,000 IQD.';

  type Ctx = { scopes: readonly AssistantScope[]; handles: HandleTable; signal?: AbortSignal; tag: string };
  const baseCtx: Ctx = { scopes: ['money', 'howto'], handles: newHandleTable({}), tag: 'chat-ctx' };

  const reply = (over: Record<string, unknown> = {}) => ({
    id: MSG,
    role: 'assistant',
    content: [{ type: 'text', text: ANSWER }],
    sources: [{ name: 'report_revenue', args: { from: TODAY, to: TODAY }, row_count: 1 }],
    gate: { status: 'ok', unverified: [], checked: 1, numbers: [4_250_000] },
    tokens: { model: 'claude-opus-5-5' },
    created_at: '2026-11-09T07:30:00.000Z',
    ...over,
  });

  interface World {
    chats?: unknown[];
    chatsError?: unknown;
    firsts?: unknown[];
    replies?: Record<string, unknown>;
  }
  function reads(w: World) {
    const r = {
      recentChats: vi.fn(async (_o: { ownerId: string; since: string; excludeId: string }) => ({ data: w.chats ?? [], error: w.chatsError ?? null })),
      firstMessages: vi.fn(async (_ids: string[]) => ({ data: w.firsts ?? [], error: null })),
      reply: vi.fn(async (id: string) => ({ data: w.replies?.[id] ?? null })),
    };
    return r;
  }
  const chat = (id: string, over: Record<string, unknown> = {}) => ({ id, scopes: ['howto', 'money'], handles: {}, context: { venue_scope: null }, ...over });
  const first = (conversation_id: string, text = QUESTION) => ({ conversation_id, content: [{ type: 'text', text }], created_at: '2026-11-09T07:29:00.000Z' });
  const find = (r: ReuseReads, run: (ctx: Ctx, spec: ToolSpec, args: Record<string, unknown>) => Promise<Dispatched>, over: Partial<{ text: string; scopes: AssistantScope[]; venueScope: string | null }> = {}) =>
    findReusableAnswer<Ctx>(r, OWNER, { text: QUESTION, scopes: baseCtx.scopes, venueScope: null, today: TODAY, tz: TZ, ctx: baseCtx, newConversationId: NEW_CONV, ...over }, run);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  it('a hit: the same first question in a same-scope chat, the stored tools re-run and nothing moved', async () => {
    const r = reads({ chats: [chat(CONV)], firsts: [first(CONV, '  how much REVENUE did we make today ?! ')], replies: { [CONV]: reply() } });
    const run = vi.fn(async () => result([4_250_000]));
    const hit = await find(r, run);
    expect(hit).not.toBeNull();
    expect(hit!.messageId).toBe(MSG);
    expect(hit!.writtenAt.toISOString()).toBe('2026-11-09T07:30:00.000Z');
    expect(hit!.plan.text).toBe(ANSWER);
    expect(r.recentChats).toHaveBeenCalledWith({ ownerId: OWNER, since: new Date(NOW - REUSE_LOOKBACK_MS).toISOString(), excludeId: NEW_CONV });
    expect(r.firstMessages).toHaveBeenCalledWith([CONV]);
    expect(run).toHaveBeenCalledTimes(1);
    const [ctx, spec, args] = run.mock.calls[0] as unknown as [Ctx, ToolSpec, Record<string, unknown>];
    expect(spec.name).toBe('report_revenue');
    expect(args).toEqual({ from: TODAY, to: TODAY });
    expect(ctx.tag).toBe('chat-ctx');
    expect(ctx.signal).toBeInstanceOf(AbortSignal); // the reuse's own time box
  });

  it('re-runs against THAT chat\'s handles, not the new chat\'s', async () => {
    const scopes: AssistantScope[] = ['money', 'courts', 'howto'];
    const r = reads({
      chats: [chat(CONV, { scopes: ['courts', 'money', 'howto'], handles: { k1: COURT, _next: { k: 2 } } })],
      firsts: [first(CONV)],
      replies: { [CONV]: reply({ sources: [{ name: 'bookings_list', args: { from: TODAY, to: TODAY, court: 'k1' } }] }) },
    });
    const run = vi.fn(async () => result([4_250_000]));
    const ctx0: Ctx = { ...baseCtx, scopes, handles: newHandleTable({}) };
    const hit = await findReusableAnswer<Ctx>(r, OWNER, { text: QUESTION, scopes, venueScope: null, today: TODAY, tz: TZ, ctx: ctx0, newConversationId: NEW_CONV }, run);
    expect(hit).not.toBeNull();
    const [ctx, , args] = run.mock.calls[0] as unknown as [Ctx, ToolSpec, Record<string, unknown>];
    expect(args.court).toBe(COURT);
    expect(ctx.handles.map.k1).toBe(COURT);
    expect(ctx0.handles.map).toEqual({}); // the new chat's table untouched
  });

  it('other scopes, another branch in scope, or no chats: no reuse, and the first messages are never read', async () => {
    const otherScopes = reads({ chats: [chat(CONV, { scopes: ['money', 'cafe'] })] });
    expect(await find(otherScopes, vi.fn())).toBeNull();
    expect(otherScopes.firstMessages).not.toHaveBeenCalled();
    const otherBranch = reads({ chats: [chat(CONV, { context: { venue_scope: BRANCH_B } })] });
    expect(await find(otherBranch, vi.fn())).toBeNull();
    expect(otherBranch.firstMessages).not.toHaveBeenCalled();
    const asked = reads({ chats: [chat(CONV, { context: null })], firsts: [first(CONV)], replies: { [CONV]: reply() } });
    expect(await find(asked, vi.fn(async () => result([4_250_000])), { venueScope: BRANCH_B })).toBeNull();
    const failed = reads({ chatsError: { message: 'x' } });
    expect(await find(failed, vi.fn())).toBeNull();
    expect(failed.firstMessages).not.toHaveBeenCalled();
  });

  it('the branch in scope matches when both name it; a chat with no stored context counts as the default branch', async () => {
    const same = reads({ chats: [chat(CONV, { context: { venue_scope: BRANCH_B } })], firsts: [first(CONV)], replies: { [CONV]: reply() } });
    expect(await find(same, vi.fn(async () => result([4_250_000])), { venueScope: BRANCH_B })).not.toBeNull();
    const legacy = reads({ chats: [chat(CONV, { context: null })], firsts: [first(CONV)], replies: { [CONV]: reply() } });
    expect(await find(legacy, vi.fn(async () => result([4_250_000])))).not.toBeNull();
  });

  it('other words are not the same question: the reply is never read', async () => {
    const r = reads({ chats: [chat(CONV)], firsts: [first(CONV, 'How much revenue did we make yesterday?')] });
    expect(await find(r, vi.fn())).toBeNull();
    expect(r.reply).not.toHaveBeenCalled();
  });

  it('a moved figure or a failed re-run means a normal turn', async () => {
    const world = { chats: [chat(CONV)], firsts: [first(CONV)], replies: { [CONV]: reply() } };
    expect(await find(reads(world), vi.fn(async () => result([4_300_000])))).toBeNull();
    expect(await find(reads(world), vi.fn(async () => err('RETRY_LATER: the database could not run this call right now (57014)')))).toBeNull();
    expect(await find(reads(world), vi.fn(async () => { throw new Error('boom'); }))).toBeNull();
  });

  it('a reply from yesterday, a missing reply or a user row is skipped; the next candidate is tried, three at most', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4'].map((s) => `aaaaaaaa-0000-4000-8000-0000000000${s}`);
    const r = reads({
      chats: ids.map((id) => chat(id)),
      firsts: ids.map((id) => first(id)),
      replies: {
        [ids[0]!]: reply({ created_at: '2026-11-08T07:30:00.000Z' }), // yesterday in Baghdad
        [ids[1]!]: { ...reply(), role: 'user' },
        // ids[2] has no reply
        [ids[3]!]: reply(), // a fourth match is never tried
      },
    });
    const run = vi.fn(async () => result([4_250_000]));
    expect(await find(r, run)).toBeNull();
    expect(r.reply.mock.calls.map((c) => c[0])).toEqual(ids.slice(0, 3));
    expect(run).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('recheckMessage', () => {
  type Ctx = { scopes: readonly AssistantScope[]; handles: HandleTable; tz: string; signal?: AbortSignal };
  const msgRow = (over: Record<string, unknown> = {}) => ({
    id: MSG,
    conversation_id: CONV,
    role: 'assistant',
    content: [{ type: 'text', text: 'Revenue 4,250,000 IQD over 300 bookings.' }],
    sources: [
      { name: 'report_revenue', args: { from: '2026-11-01', to: '2026-11-07' }, row_count: 1 },
      { name: 'search', args: { query: 'revenue' }, row_count: 3 },
      { name: 'usage', args: {}, row_count: 1 },
      { name: 'report_courts', args: { from: '2026-11-01', to: '2026-11-07' }, row_count: null, error: 'RETRY_LATER' },
    ],
    gate: { status: 'ok', numbers: [4_250_000, 300] },
    ...over,
  });
  function io(o: { msg?: unknown; msgError?: unknown; conv?: unknown; convError?: unknown; run?: RecheckIo<Ctx>['run'] } = {}) {
    const ios = {
      readMessage: vi.fn(async (_id: string) => ({ data: o.msg === undefined ? msgRow() : o.msg, error: o.msgError ?? null })),
      readConversation: vi.fn(async (_id: string) => ({ data: o.conv === undefined ? { id: CONV, owner_id: OWNER, scopes: ['money', 'courts', 'howto'], handles: { k1: COURT, _next: { k: 2 } } } : o.conv, error: o.convError ?? null })),
      timezone: vi.fn(async () => 'Asia/Baghdad'),
      context: vi.fn((scopes: AssistantScope[], handles: HandleTable, tz: string): Ctx => ({ scopes, handles, tz })),
      run: vi.fn(o.run ?? (async () => result([4_300_000, 300]))),
    };
    return ios;
  }
  const body = async (res: Response) => ({ status: res.status, json: (await res.json()) as Record<string, unknown> });

  it('a malformed message id is 400 INVALID_REQUEST with its code; nothing is read', async () => {
    const x = io();
    const r = await body(await recheckMessage(x, OWNER, { message_id: 'not-a-uuid' }));
    expect(r).toEqual({ status: 400, json: { error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'recheck.message_id must be a uuid' } });
    expect(x.readMessage).not.toHaveBeenCalled();
  });

  it('a failed message read is 500 INTERNAL, the database text logged only', async () => {
    const r = await body(await recheckMessage(io({ msgError: { code: '57014', message: 'raw pg text' } }), OWNER, { message_id: MSG }));
    expect(r).toEqual({ status: 500, json: { error: 'INTERNAL', code: 'INTERNAL' } });
    expect(logged.join('\n')).toContain('recheck message read failed');
  });

  it('no message, or a user message, is 404 NOT_FOUND', async () => {
    expect((await body(await recheckMessage(io({ msg: null }), OWNER, { message_id: MSG }))).json).toMatchObject({ code: 'NOT_FOUND' });
    const r = await body(await recheckMessage(io({ msg: msgRow({ role: 'user' }) }), OWNER, { message_id: MSG }));
    expect(r.status).toBe(404);
  });

  it('a missing conversation is 404; another owner\'s is 403 and nothing runs', async () => {
    const gone = io({ conv: null });
    expect((await body(await recheckMessage(gone, OWNER, { message_id: MSG }))).status).toBe(404);
    const theirs = io({ conv: { id: CONV, owner_id: OTHER_OWNER, scopes: ['money'], handles: {} } });
    const r = await body(await recheckMessage(theirs, OWNER, { message_id: MSG }));
    expect(r).toEqual({ status: 403, json: { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your conversation' } });
    expect(theirs.context).not.toHaveBeenCalled();
    expect(theirs.run).not.toHaveBeenCalled();
  });

  it('re-runs the data tools only, on a scratch copy of the chat\'s handles, and diffs the printed figures', async () => {
    const x = io();
    const r = await body(await recheckMessage(x, OWNER, { message_id: MSG }));
    expect(r.status).toBe(200);
    expect(x.readConversation).toHaveBeenCalledWith(CONV);
    const [scopes, handles, tz] = x.context.mock.calls[0]!;
    expect(scopes).toEqual(['money', 'courts', 'howto']);
    expect(handles.map.k1).toBe(COURT);
    expect(tz).toBe('Asia/Baghdad');
    expect(x.run).toHaveBeenCalledTimes(1); // search, usage and the failed report_courts skipped
    expect((x.run.mock.calls[0]![1] as ToolSpec).name).toBe('report_revenue');
    expect(r.json).toMatchObject({ message_id: MSG, changed: [{ value_then: 4_250_000, value_now: 4_300_000 }], unchanged: 1, baseline: true });
    expect((r.json.tools as { name: string; error?: string }[]).map((t) => t.name)).toEqual(['report_revenue']);
  });

  it('a message saved before gate.numbers says baseline false and compares nothing', async () => {
    const r = await body(await recheckMessage(io({ msg: msgRow({ gate: { status: 'ok' } }) }), OWNER, { message_id: MSG }));
    expect(r.json).toMatchObject({ baseline: false, changed: [], unchanged: 0 });
  });

  it('a stored call that no longer validates, or whose scope is now off, is reported and never run', async () => {
    const x = io({
      msg: msgRow({ sources: [{ name: 'report_revenue', args: { to: '2026-11-07' } }, { name: 'report_cafe', args: { from: '2026-11-01', to: '2026-11-07' } }] }),
    });
    const r = await body(await recheckMessage(x, OWNER, { message_id: MSG }));
    expect(x.run).not.toHaveBeenCalled();
    const tools = r.json.tools as { name: string; error?: string }[];
    expect(tools[0]!.error).toMatch(/from/);
    expect(tools[1]!.error).toBe('Scope "cafe" is off for this chat');
  });

  it('a runner\'s raw error is "the tool failed" (logged); a clean refusal is shown', async () => {
    const raw = io({ run: async () => { throw new Error('connection to 10.0.0.7 reset: secret'); } });
    const r = await body(await recheckMessage(raw, OWNER, { message_id: MSG }));
    expect((r.json.tools as { error?: string }[])[0]!.error).toBe('the tool failed');
    expect(logged.join('\n')).toContain('secret');
    const refused = io({ run: async () => { throw new CleanError('UNKNOWN_COLUMN', 'column ssn is not allowed'); } });
    const r2 = await body(await recheckMessage(refused, OWNER, { message_id: MSG }));
    expect((r2.json.tools as { error?: string }[])[0]!.error).toBe('UNKNOWN_COLUMN: column ssn is not allowed');
  });

  it('the 30 s time box: a call still running is cut, the next is not started', async () => {
    vi.useFakeTimers();
    const x = io({
      msg: msgRow({ sources: [{ name: 'report_revenue', args: { from: '2026-11-01', to: '2026-11-07' } }, { name: 'report_courts', args: { from: '2026-11-01', to: '2026-11-07' } }] }),
      run: () => new Promise<Dispatched>(() => {}), // never answers
    });
    const pending = recheckMessage(x, OWNER, { message_id: MSG });
    await vi.advanceTimersByTimeAsync(RECHECK_WALL_MS + 1);
    const r = await body(await pending);
    const tools = r.json.tools as { name: string; error?: string }[];
    expect(tools[0]).toMatchObject({ name: 'report_revenue', error: `not finished inside the ${RECHECK_WALL_MS / 1000} s time box` });
    expect(tools[1]).toMatchObject({ name: 'report_courts', error: `not re-run: the ${RECHECK_WALL_MS / 1000} s time box is used up` });
    expect(x.run).toHaveBeenCalledTimes(1);
  });
});
