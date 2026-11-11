/**
 * A real streamed assistant-chat turn over HTTP, against the locally served
 * runtime and a FAKE Anthropic (tests/assistant-fake-anthropic.ts). The one
 * path tests/assistant-edge-http.test.ts cannot reach: the turn itself, from
 * the owner's request to the stored rows.
 *
 *   * a figure question: one tool round (courts_and_rates, run as the owner
 *     through app.assistant_run_tool), then a final answer quoting a figure
 *     the tool returned. Over HTTP: the SSE events arrive in order
 *     (message_start, the round's delta, tool_start, tool_end, the answer's
 *     deltas, then sources, gate, usage, done), the deltas spell exactly what
 *     the fake streamed, the gate is ok. Afterwards: the stored
 *     assistant_messages row (text, sources, gate with the figure among its
 *     signed numbers), one assistant_calls row per model call with the fake's
 *     usage, the chat's tokens = what was stored before + this turn
 *     (0405 app.assistant_conversation_persist), one quota request;
 *   * an invented figure: the same tool round, then an answer quoting the
 *     real figure AND a made-up 1,234,567 IQD; the gate flags it, turn.ts
 *     spends its one operator-channel retry (money-sized), the fake answers
 *     the same, and the turn lands marked: two gate events (retried), a reset
 *     delta, three calls, the stored gate `unverified` with that figure only.
 *
 * Never against the real API. The runtime's env is fixed when `functions
 * serve` starts, so the fake is reachable only when the serve was started with
 *   ANTHROPIC_BASE_URL=http://host.docker.internal:54380  and  ANTHROPIC_API_KEY=<any dummy>
 * The file proves that before any turn: it starts the fake, asks assistant-chat
 * for a dry run (count_tokens only, which generates and spends nothing), and
 * runs only when `start.tokens` is the fake's sentinel. Anything else (no key,
 * another base URL, port taken, runtime not serving, stack down) skips the
 * whole file with the reason printed. CI runs it in its own step with that env
 * (ci.yml "Streamed assistant turn against a fake Anthropic"), where a skip
 * fails the job (scripts/check-no-skips.mjs on that step's report); the main
 * "DB tests" step excludes it, because its serve has no key on purpose
 * (assistant-edge-http's 503 NOT_CONFIGURED case needs a runtime without one).
 *
 * Locally, from packages/db (leaves supabase/functions/.env untouched):
 *   { cat supabase/functions/.env; printf '\nANTHROPIC_BASE_URL=http://host.docker.internal:54380\nANTHROPIC_API_KEY=fake-key-not-a-secret\n'; } > /tmp/functions-fake-anthropic.env
 *   pnpm exec supabase functions serve --env-file /tmp/functions-fake-anthropic.env
 *   pnpm vitest run tests/assistant-edge-stream.test.ts
 * then restart the serve without --env-file for the usual runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSseChunk, type SseEvent } from '../supabase/functions/_shared/assistant/sse.ts';
import { titleFrom } from '../supabase/functions/_shared/assistant/prompt.ts';
import { ANON_KEY, SEED_STAFF, SEED_STAFF_IDS, SUPABASE_URL, serviceClient, signedInClient, stackAvailable } from './helpers';
import {
  FAKE_ANTHROPIC_BASE_URL,
  FAKE_COUNT_TOKENS,
  FAKE_TOOL,
  FAKE_USAGE,
  INVENTED_FIGURE,
  ROUND1_TEXT,
  letterNonce,
  marker,
  startFakeAnthropic,
  type FakeAnthropic,
  type SeenRequest,
} from './assistant-fake-anthropic';

const CHAT = `${SUPABASE_URL}/functions/v1/assistant-chat`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSISTANT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

const up = await stackAvailable();

/** The edge runtime is serving: ci.yml's readiness rule (replay answers 401 without a session). */
async function edgeRuntimeServes(): Promise<boolean> {
  if (!up) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/replay`, { method: 'POST', signal: AbortSignal.timeout(5_000) });
    await res.text();
    return res.status === 401;
  } catch {
    return false;
  }
}
const served = await edgeRuntimeServes();

async function postJson(token: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, json: { raw: text } };
  }
}

/**
 * Start the fake, then prove the served runtime talks to it: the dry run's
 * count_tokens must land on the fake and come back as its sentinel. Until
 * this holds, no request that could reach a model is sent.
 */
async function wire(): Promise<{ fake: FakeAnthropic; token: string } | { why: string }> {
  if (!up) return { why: 'the local stack is down' };
  if (!served) return { why: 'the edge runtime is not serving (replay does not answer 401)' };
  const started = await startFakeAnthropic();
  if ('error' in started) return { why: started.error };
  try {
    const owner = await signedInClient(SEED_STAFF.owner);
    const token = (await owner.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('no owner session');
    const dry = await postJson(token, { conversation_id: null, text: '', lang: 'en', scopes: ['courts'], model: 'claude-sonnet-5-5', dry_run: true });
    const start = dry.json.start as { tokens?: unknown; exact?: unknown } | null | undefined;
    const counted = started.seen.filter((r) => r.path === '/v1/messages/count_tokens').length;
    if (dry.status === 200 && start?.tokens === FAKE_COUNT_TOKENS && start.exact === true && counted > 0) return { fake: started, token };
    await started.close();
    if (dry.status !== 200) return { why: `the assistant-chat dry run answered ${dry.status}` };
    if (!start) return { why: 'the runtime has no ANTHROPIC_API_KEY' };
    return { why: `the runtime's ANTHROPIC_BASE_URL is not ${FAKE_ANTHROPIC_BASE_URL} (count_tokens answered ${String(start.tokens)}, the fake saw ${counted} call(s))` };
  } catch (e) {
    await started.close();
    return { why: `the wiring probe failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const wiring = await wire();
const wired = 'fake' in wiring;
if (!wired) {
  console.warn(
    `\n[assistant-edge-stream] SKIPPED, no turn was sent to any model: ${wiring.why}.\n` +
      `  Serve the functions with ANTHROPIC_BASE_URL=${FAKE_ANTHROPIC_BASE_URL} and a dummy ANTHROPIC_API_KEY (recipe in this file's header).\n`,
  );
}

interface Streamed {
  status: number;
  contentType: string | null;
  events: SseEvent[];
  raw?: string;
}

/** One turn: POST, then read the SSE stream to its end. */
async function streamTurn(token: string, body: Record<string, unknown>): Promise<Streamed> {
  const res = await fetch(CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const contentType = res.headers.get('content-type');
  if (!contentType?.includes('text/event-stream') || !res.body) return { status: res.status, contentType, events: [], raw: await res.text() };
  const events: SseEvent[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    events.push(...parsed.events);
    buffer = parsed.rest;
  }
  buffer += decoder.decode();
  if (buffer.trim()) events.push(...parseSseChunk(`${buffer}\n\n`).events);
  return { status: res.status, contentType, events };
}

type Data = Record<string, unknown>;
const dataOf = (events: SseEvent[], name: string): Data[] => events.filter((e) => e.event === name).map((e) => e.data as Data);
const deltaText = (events: SseEvent[]): string => dataOf(events, 'delta').map((d) => String(d.text ?? '')).join('');

/** Every number anywhere in a JSON value. */
function numbersDeep(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) for (const x of v) numbersDeep(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) numbersDeep(x, out);
  return out;
}

/** The API key a request carried: `x-api-key`, or `Authorization: Bearer <key>`. */
function credentialOf(r: SeenRequest): string {
  const x = r.headers['x-api-key'];
  if (typeof x === 'string' && x) return x;
  const auth = r.headers.authorization;
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

const sum = (k:keyof (typeof FAKE_USAGE)['answer'], kinds: (keyof typeof FAKE_USAGE)[]) => kinds.reduce((n, kind) => n + FAKE_USAGE[kind][k], 0);

describe.skipIf(!wired)('assistant-chat streamed over HTTP against a fake Anthropic (served runtime)', () => {
  const { fake, token } = wired ? wiring : ({} as { fake: FakeAnthropic; token: string });
  let svc: SupabaseClient;
  const conversations: string[] = [];

  /** Every request the paid quota has counted, all days. */
  const quotaRequests = async (): Promise<number> => {
    const { data, error } = await svc.from('llm_usage').select('requests');
    if (error) throw new Error(error.message);
    return ((data ?? []) as { requests: number }[]).reduce((n, r) => n + Number(r.requests ?? 0), 0);
  };
  const messagesOf = async (conversationId: string) => {
    const { data, error } = await svc.from('assistant_messages').select('id, seq, role, content, sources, gate, tokens').eq('conversation_id', conversationId).order('seq');
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; seq: number; role: string; content: unknown; sources: Data[]; gate: Data | null; tokens: Data }[];
  };
  const callsOf = async (messageId: string) => {
    const { data, error } = await svc
      .from('assistant_calls')
      .select('call_no, model, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_micros, web_searches, stop_reason')
      .eq('message_id', messageId)
      .order('call_no');
    if (error) throw new Error(error.message);
    return (data ?? []) as Data[];
  };
  const conversation = async (id: string) => {
    const { data, error } = await svc.from('assistant_conversations').select('id, owner_id, title, tokens').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data as { id: string; owner_id: string; title: string | null; tokens: Data };
  };
  const callsFor = (nonce: string): SeenRequest[] => fake.seen.filter((r) => r.nonce === nonce);

  beforeAll(() => {
    svc = serviceClient();
  });

  afterAll(async () => {
    await fake.close();
    if (conversations.length) await svc.from('assistant_conversations').delete().in('id', conversations); // cascades to messages and calls
  });

  it('a figure question: one tool round, an answer quoting the tool\'s figure, events in order, the gate ok, every row stored and the chat\'s tokens added to', async () => {
    // A chat that has already spent: persist must ADD this turn (0405), not overwrite.
    const before = { input: 1_000, output: 100, cache_write: 20, cache_read: 30, cost_micros: 7, calls: 3, web_searches: 0, kept: 'other keys stay' };
    const { data: planted, error: plantError } = await svc
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.owner, title: 'fake anthropic: figure', scopes: ['courts'], tokens: before, handles: {} })
      .select('id')
      .single();
    if (plantError) throw new Error(plantError.message);
    const conv = (planted as { id: string }).id;
    conversations.push(conv);

    const nonce = letterNonce();
    const text = `How much does one hour on court cost on a weekday evening? ${marker('figure', nonce)}`;
    const q0 = await quotaRequests();
    const r = await streamTurn(token, { conversation_id: conv, text, lang: 'en', scopes: ['courts'] });
    expect(r.status, r.raw).toBe(200);
    expect(r.contentType).toContain('text/event-stream');

    // What the fake was asked: the tool round, then the answer with the tool's result.
    const calls = callsFor(nonce);
    expect(calls.map((c) => c.kind)).toEqual(['tool_round', 'answer']);
    for (const c of calls) {
      expect(c.status).toBe(200);
      expect(c.body?.stream).toBe(true);
      // The runtime's dummy key rides along (x-api-key, or the bearer header newer SDKs send).
      expect(credentialOf(c).length).toBeGreaterThan(0);
      expect(String(c.headers['anthropic-version'] ?? '')).not.toBe('');
    }
    const model = calls[0]!.body!.model as string;
    expect(ASSISTANT_MODELS).toContain(model);
    expect(calls[1]!.body!.model).toBe(model);
    const toolNames = ((calls[0]!.body!.tools ?? []) as { name?: string }[]).map((t) => t.name);
    expect(toolNames).toContain('tool_search_tool_bm25');
    expect(toolNames).toContain(FAKE_TOOL);
    const figure = calls[1]!.figure;
    expect(figure, 'the tool result carried no money-sized figure (fixtures/courts.sql loaded?)').not.toBeNull();
    const answer = calls[1]!.texts[0]!;
    expect(answer).toContain(figure!.raw);

    // The SSE events, in order.
    const names = r.events.map((e) => e.event);
    expect(names[0]).toBe('message_start');
    expect(names).not.toContain('error');
    expect(names.slice(-4)).toEqual(['sources', 'gate', 'usage', 'done']);
    expect(names.filter((n) => n === 'tool_start')).toHaveLength(1);
    expect(names.filter((n) => n === 'tool_end')).toHaveLength(1);
    expect(names.filter((n) => n === 'gate')).toHaveLength(1);
    const iStart = names.indexOf('tool_start');
    const iEnd = names.indexOf('tool_end');
    expect(names.indexOf('delta')).toBeLessThan(iStart); // the round's own text streams first
    expect(iStart).toBeLessThan(iEnd);
    expect(names.lastIndexOf('delta')).toBeGreaterThan(iEnd); // the answer streams after the tool
    expect(names.lastIndexOf('delta')).toBeLessThan(names.indexOf('sources'));
    expect(dataOf(r.events, 'delta').some((d) => d.reset === true)).toBe(false);
    expect(deltaText(r.events)).toBe(`${ROUND1_TEXT}${answer}`);

    const start = dataOf(r.events, 'message_start')[0]!;
    expect(start.conversation_id).toBe(conv);
    expect(start.model).toBe(model);
    const assistantId = String(start.assistant_message_id);
    expect(assistantId).toMatch(UUID_RE);
    expect(String(start.user_message_id)).toMatch(UUID_RE);
    expect(dataOf(r.events, 'tool_start')[0]).toMatchObject({ call_id: calls[0]!.toolUseId, name: FAKE_TOOL });
    const toolEnd = dataOf(r.events, 'tool_end')[0]!;
    expect(toolEnd).toMatchObject({ call_id: calls[0]!.toolUseId, name: FAKE_TOOL, route: '/admin/rates' });
    expect(toolEnd.error).toBeUndefined();
    expect(Number(toolEnd.row_count)).toBeGreaterThan(0);
    expect(dataOf(r.events, 'gate')[0]).toMatchObject({ status: 'ok', unverified: [], retried: false });
    expect(dataOf(r.events, 'usage')[0]).toMatchObject({
      input: sum('input_tokens', ['tool_round', 'answer']),
      output: sum('output_tokens', ['tool_round', 'answer']),
      cache_write: sum('cache_creation_input_tokens', ['tool_round', 'answer']),
      cache_read: sum('cache_read_input_tokens', ['tool_round', 'answer']),
      calls: 2,
      model,
      web_searches: 0,
    });
    expect(dataOf(r.events, 'done')[0]).toEqual({ message_id: assistantId, stop_reason: 'end_turn' });

    // The figure is really the tool's: the owner's own read of the same tool has it.
    const owner = await signedInClient(SEED_STAFF.owner);
    const direct = await owner.schema('app').rpc('assistant_run_tool', { p_tool: 'assistant_courts_and_rates', p_args: {} });
    expect(direct.error).toBeNull();
    expect(numbersDeep(direct.data)).toContain(figure!.value);

    // The stored turn.
    const rows = await messagesOf(conv);
    expect(rows.map((m) => [m.seq, m.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
    ]);
    expect(rows[0]!.content).toEqual([{ type: 'text', text }]);
    const msg = rows[1]!;
    expect(msg.id).toBe(assistantId);
    expect(msg.content).toEqual([{ type: 'text', text: answer }]);
    expect(msg.sources).toHaveLength(1);
    expect(msg.sources[0]).toMatchObject({ call_id: calls[0]!.toolUseId, name: FAKE_TOOL, route: '/admin/rates' });
    expect(msg.sources[0]!.error).toBeUndefined();
    expect(msg.gate).toMatchObject({ status: 'ok', unverified: [] });
    expect(Number(msg.gate!.checked)).toBeGreaterThanOrEqual(1);
    expect(msg.gate!.numbers as number[]).toContain(figure!.value);
    expect(String(msg.gate!.sig)).toMatch(/^[0-9a-f]{64}$/); // signed by the function's service-role key
    const turnCost = Number(msg.tokens.cost_micros);
    expect(turnCost).toBeGreaterThan(0);
    expect(msg.tokens).toMatchObject({
      input: sum('input_tokens', ['tool_round', 'answer']),
      output: sum('output_tokens', ['tool_round', 'answer']),
      cache_write: sum('cache_creation_input_tokens', ['tool_round', 'answer']),
      cache_read: sum('cache_read_input_tokens', ['tool_round', 'answer']),
      calls: 2,
      model,
      web_searches: 0,
      route: 'analysis',
    });

    // One assistant_calls row per model call, with the fake's usage, priced.
    const callRows = await callsOf(assistantId);
    expect(callRows).toHaveLength(2);
    expect(callRows[0]).toMatchObject({ call_no: 1, model, stop_reason: 'tool_use', input_tokens: 1_200, output_tokens: 40, cache_write_tokens: 300, cache_read_tokens: 0, web_searches: 0 });
    expect(callRows[1]).toMatchObject({ call_no: 2, model, stop_reason: 'end_turn', input_tokens: 1_500, output_tokens: 60, cache_write_tokens: 0, cache_read_tokens: 300, web_searches: 0 });
    for (const c of callRows) expect(Number(c.cost_micros)).toBeGreaterThan(0);
    expect(callRows.reduce((n, c) => n + Number(c.cost_micros), 0)).toBe(turnCost);

    // 0405: the chat's tokens are the stored ones plus this turn, other keys kept; the planted title stays.
    const after = await conversation(conv);
    expect(after.title).toBe('fake anthropic: figure');
    expect(after.tokens).toMatchObject({
      input: before.input + sum('input_tokens', ['tool_round', 'answer']),
      output: before.output + sum('output_tokens', ['tool_round', 'answer']),
      cache_write: before.cache_write + sum('cache_creation_input_tokens', ['tool_round', 'answer']),
      cache_read: before.cache_read + sum('cache_read_input_tokens', ['tool_round', 'answer']),
      cost_micros: before.cost_micros + turnCost,
      calls: before.calls + 2,
      web_searches: 0,
      kept: before.kept,
    });

    // One paid request for the turn, whatever its model calls.
    expect(await quotaRequests()).toBe(q0 + 1);
  });

  it('an invented money figure: the gate flags it, one operator-channel retry, the same answer again, the turn stored marked', async () => {
    const nonce = letterNonce();
    const text = `How much does one hour on court cost on a weekday evening? ${marker('invented', nonce)}`;
    const q0 = await quotaRequests();
    const r = await streamTurn(token, { conversation_id: null, text, lang: 'en', scopes: ['courts'] });
    expect(r.status, r.raw).toBe(200);
    expect(r.contentType).toContain('text/event-stream');

    const start = dataOf(r.events, 'message_start')[0]!;
    const conv = String(start.conversation_id);
    expect(conv).toMatch(UUID_RE);
    conversations.push(conv);
    const assistantId = String(start.assistant_message_id);

    // The fake: the tool round, the first answer, then the retry with the operator line naming the figure.
    const calls = callsFor(nonce);
    expect(calls.map((c) => c.kind)).toEqual(['tool_round', 'answer', 'retry']);
    const system = ((calls[2]!.body!.messages ?? []) as { role?: string; content?: unknown }[]).filter((m) => m.role === 'system');
    expect(system).toHaveLength(1);
    expect(String(system[0]!.content)).toContain(INVENTED_FIGURE.raw);
    expect(((calls[1]!.body!.messages ?? []) as { role?: string }[]).some((m) => m.role === 'system')).toBe(false);
    const figure = calls[1]!.figure;
    expect(figure).not.toBeNull();
    expect(calls[2]!.figure).toEqual(figure);
    const answer = calls[2]!.texts[0]!;
    expect(calls[1]!.texts[0]).toBe(answer);
    expect(answer).toContain(INVENTED_FIGURE.raw);
    const model = calls[0]!.body!.model as string;

    // The events: the in-loop gate (retried), the reset, the regenerated answer, the final gate.
    const names = r.events.map((e) => e.event);
    expect(names[0]).toBe('message_start');
    expect(names).not.toContain('error');
    expect(names.slice(-4)).toEqual(['sources', 'gate', 'usage', 'done']);
    const gates = dataOf(r.events, 'gate');
    expect(gates).toHaveLength(2);
    const flagged = { status: 'unverified', unverified: [{ raw: INVENTED_FIGURE.raw, value: INVENTED_FIGURE.value }], retried: true };
    expect(gates[0]).toMatchObject(flagged);
    expect(gates[1]).toMatchObject(flagged);
    const iFirstGate = names.indexOf('gate');
    const iReset = r.events.findIndex((e) => e.event === 'delta' && (e.data as Data).reset === true);
    expect(iReset).toBeGreaterThan(iFirstGate);
    expect(names.indexOf('tool_end')).toBeLessThan(iFirstGate);
    expect(dataOf(r.events, 'delta').filter((d) => d.reset === true)).toHaveLength(1);
    // Before the reset: the round's text and the first answer; after it: the regenerated one.
    expect(deltaText(r.events.slice(0, iReset))).toBe(`${ROUND1_TEXT}${answer}`);
    expect(deltaText(r.events.slice(iReset + 1))).toBe(answer);
    expect(dataOf(r.events, 'usage')[0]).toMatchObject({
      input: sum('input_tokens', ['tool_round', 'answer', 'retry']),
      output: sum('output_tokens', ['tool_round', 'answer', 'retry']),
      calls: 3,
      model,
    });
    expect(dataOf(r.events, 'done')[0]).toEqual({ message_id: assistantId, stop_reason: 'end_turn' });

    // Stored marked: only the invented figure is unverified, the tool's figure is in the baseline.
    const rows = await messagesOf(conv);
    expect(rows.map((m) => [m.seq, m.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
    ]);
    const msg = rows[1]!;
    expect(msg.id).toBe(assistantId);
    expect(msg.content).toEqual([{ type: 'text', text: answer }]);
    expect(msg.gate).toMatchObject({ status: 'unverified', unverified: [{ raw: INVENTED_FIGURE.raw, value: INVENTED_FIGURE.value }], checked: 2 });
    expect(msg.gate!.numbers as number[]).toContain(figure!.value);
    expect(msg.gate!.numbers as number[]).not.toContain(INVENTED_FIGURE.value);

    const callRows = await callsOf(assistantId);
    expect(callRows.map((c) => [c.call_no, c.stop_reason, c.input_tokens, c.output_tokens])).toEqual([
      [1, 'tool_use', 1_200, 40],
      [2, 'end_turn', 1_500, 60],
      [3, 'end_turn', 1_650, 55],
    ]);

    // A new chat: created for the owner, titled from the question, tokens = this turn alone.
    const after = await conversation(conv);
    expect(after.owner_id).toBe(SEED_STAFF_IDS.owner);
    expect(after.title).toBe(titleFrom(text));
    expect(after.tokens).toMatchObject({
      input: sum('input_tokens', ['tool_round', 'answer', 'retry']),
      output: sum('output_tokens', ['tool_round', 'answer', 'retry']),
      cache_write: sum('cache_creation_input_tokens', ['tool_round', 'answer', 'retry']),
      cache_read: sum('cache_read_input_tokens', ['tool_round', 'answer', 'retry']),
      cost_micros: Number(msg.tokens.cost_micros),
      calls: 3,
    });
    expect(await quotaRequests()).toBe(q0 + 1);
  });

  it('nothing unscripted reached the fake, and every call carried the one runtime key', () => {
    const stray = fake.seen.filter((r) => r.status !== 200);
    expect(stray.map((r) => `${r.method} ${r.path} -> ${r.status}`)).toEqual([]);
    const keys = new Set(fake.seen.map(credentialOf));
    expect(keys.size).toBe(1);
    expect([...keys][0]).not.toBe('');
  });
});
