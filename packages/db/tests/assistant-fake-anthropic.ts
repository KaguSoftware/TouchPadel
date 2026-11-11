/**
 * A fake Anthropic Messages API for tests/assistant-edge-stream.test.ts: just
 * enough of POST /v1/messages (stream: true, answered as SSE) and
 * POST /v1/messages/count_tokens for assistant-chat's provider.ts to run a
 * whole streamed turn against it, tool round included, without a key or a
 * network.
 *
 * How the served runtime reaches it: provider.ts builds the SDK client with
 * no baseURL, so the SDK reads ANTHROPIC_BASE_URL from the runtime's env, and
 * that env is fixed when `supabase functions serve` starts. The serve that
 * runs this file is started with an env file carrying
 *   ANTHROPIC_BASE_URL=http://host.docker.internal:54380   (FAKE_ANTHROPIC_BASE_URL)
 *   ANTHROPIC_API_KEY=<any dummy>
 * (ci.yml "Streamed assistant turn against a fake Anthropic"; the local
 * recipe is in the test file's header). The functions run in a container, so
 * the loopback name is host.docker.internal: Docker Desktop provides it, and
 * the Supabase CLI adds `host.docker.internal:host-gateway` on Linux. The
 * server listens on every interface for that reason (a container reaches the
 * host through the bridge, not 127.0.0.1); it answers scripted text only.
 *
 * Scenarios are picked by a marker in the owner's own words,
 * `[fake-anthropic:<scenario>:<nonce>]` (letters only, so the gate never reads
 * the marker as a figure): a request with no marker, or with one this file
 * does not know, is answered 400 and recorded, so a test can assert none came.
 *
 *   figure     call 1 (no tool_result yet): a short text, then a tool_use of
 *              courts_and_rates {}; stop tool_use.
 *              call 2 (the tool_result back): one text block quoting a rate
 *              price (>= 10,000 IQD) read from that tool_result, as the gate's
 *              own tokenizer reads it (figureIn); stop end_turn.
 *   invented   call 1 as above; call 2 quotes that real figure AND an invented
 *              1,234,567 IQD; call 3 (the gate's operator-channel retry, a
 *              `role: system` message) answers the same invented figure again,
 *              so the turn lands on the marked state.
 *
 * Not a test file (no `.test.ts`): vitest does not collect it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tokenizeNumbers } from '../supabase/functions/_shared/assistant/gate.ts';

export const FAKE_ANTHROPIC_PORT = 54380;
/** What the serve env's ANTHROPIC_BASE_URL must be for the runtime to reach this server. */
export const FAKE_ANTHROPIC_BASE_URL = `http://host.docker.internal:${FAKE_ANTHROPIC_PORT}`;
/** count_tokens answers this; the wiring probe looks for it in the dry run's `start.tokens`. */
export const FAKE_COUNT_TOKENS = 31_337;
/** The figure the `invented` scenario makes up: in no tool result, and no sum, difference or ratio of round rates. */
export const INVENTED_FIGURE = { raw: '1,234,567', value: 1_234_567 } as const;
/** The tool both scenarios call: every court and rate rule, money-sized prices from fixtures/courts.sql. */
export const FAKE_TOOL = 'courts_and_rates';
export const ROUND1_TEXT = 'Checking the rate list.';

export interface FakeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
/** Per call kind, so a test can add up exactly what persist should store. */
export const FAKE_USAGE: Readonly<Record<'tool_round' | 'answer' | 'retry', FakeUsage>> = {
  tool_round: { input_tokens: 1_200, output_tokens: 40, cache_creation_input_tokens: 300, cache_read_input_tokens: 0 },
  answer: { input_tokens: 1_500, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 300 },
  retry: { input_tokens: 1_650, output_tokens: 55, cache_creation_input_tokens: 0, cache_read_input_tokens: 300 },
};

export type CallKind = 'tool_round' | 'answer' | 'retry';

export interface SeenRequest {
  method: string;
  /** Path without the query (`/v1/messages`, `/v1/messages/count_tokens`). */
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown> | null;
  scenario: string | null;
  nonce: string | null;
  /** For /v1/messages: which scripted call was answered; null for anything else. */
  kind: CallKind | null;
  /** The text blocks this call streamed. */
  texts: string[];
  /** The tool_use id this call streamed, if any. */
  toolUseId: string | null;
  /** The figure read from the tool_result (answer / retry calls). */
  figure: { raw: string; value: number } | null;
  status: number;
}

export interface FakeAnthropic {
  readonly seen: SeenRequest[];
  readonly url: string;
  close(): Promise<void>;
}

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

/** A fresh letters-only nonce (never a figure for the gate). */
export function letterNonce(n = 10): string {
  const a = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export function marker(scenario: 'figure' | 'invented', nonce: string): string {
  return `[fake-anthropic:${scenario}:${nonce}]`;
}

const MARKER_RE = /\[fake-anthropic:([a-z]+):([a-z]+)\]/;

type Msg = { role?: unknown; content?: unknown };

/** Every text of a message's content (string or blocks), tool_result contents included. */
function textsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content as Record<string, unknown>[]) {
    if (b?.type === 'text' && typeof b.text === 'string') out.push(b.text);
    else if (b?.type === 'tool_result') out.push(...textsOf(b.content));
  }
  return out;
}

/** The tool_result blocks of a message. */
function toolResultsOf(m: Msg | undefined): { tool_use_id: string; text: string; is_error: boolean }[] {
  if (!m || m.role !== 'user' || !Array.isArray(m.content)) return [];
  return (m.content as Record<string, unknown>[])
    .filter((b) => b?.type === 'tool_result')
    .map((b) => ({ tool_use_id: String(b.tool_use_id), text: textsOf(b.content).join('\n'), is_error: b.is_error === true }));
}

/**
 * A money-sized figure of the courts_and_rates result, as the gate's tokenizer
 * reads it: the first rate price (`"price_iqd":40000` in the laid-out rows) of
 * at least 10,000. Only prices: a stack that has run the suite also holds
 * courts named with timestamps ("Court promo 1794248475032-16"), digits the
 * gate allows but that are not a figure anybody would quote.
 */
export function figureIn(text: string): { raw: string; value: number } | null {
  const tokens = new Set(tokenizeNumbers(text).map((t) => t.value));
  for (const m of text.matchAll(/"price_iqd":\s*(\d+)/g)) {
    const value = Number(m[1]);
    if (value >= 10_000 && value !== INVENTED_FIGURE.value && tokens.has(value)) return { raw: m[1]!, value };
  }
  return null;
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** One scripted assistant message, streamed the way the Messages API streams it. */
function streamMessage(res: ServerResponse, model: string, blocks: Block[], stopReason: 'tool_use' | 'end_turn', usage: FakeUsage, id: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'request-id': `req_${id}` });
  sse(res, 'message_start', {
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } },
  });
  sse(res, 'ping', { type: 'ping' });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      // Two deltas per text block, so the edge's delta events are a real stream, not one write.
      const cut = Math.max(1, Math.floor(b.text.length / 2));
      for (const part of [b.text.slice(0, cut), b.text.slice(cut)]) {
        if (part) sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
      }
    } else {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      const cut = Math.max(1, Math.floor(json.length / 2));
      for (const part of [json.slice(0, cut), json.slice(cut)]) {
        if (part) sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } });
      }
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index });
  });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function jsonReply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function apiError(res: ServerResponse, status: number, type: string, message: string): void {
  jsonReply(res, status, { type: 'error', error: { type, message } });
}

/** Start the fake on FAKE_ANTHROPIC_PORT; `{ error }` when the port cannot be bound. */
export async function startFakeAnthropic(): Promise<FakeAnthropic | { error: string }> {
  const seen: SeenRequest[] = [];
  let msgNo = 0;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    const path = (req.url ?? '').split('?')[0] ?? '';
    const rec: SeenRequest = { method: req.method ?? '', path, headers: req.headers, body, scenario: null, nonce: null, kind: null, texts: [], toolUseId: null, figure: null, status: 0 };
    seen.push(rec);

    if (req.method !== 'POST') {
      rec.status = 405;
      return apiError(res, 405, 'invalid_request_error', 'POST only');
    }
    if (path === '/v1/messages/count_tokens') {
      rec.status = 200;
      return jsonReply(res, 200, { input_tokens: FAKE_COUNT_TOKENS });
    }
    if (path !== '/v1/messages' || !body) {
      rec.status = 404;
      return apiError(res, 404, 'not_found_error', `the fake does not serve ${req.method} ${path}`);
    }

    const messages = (Array.isArray(body.messages) ? body.messages : []) as Msg[];
    const owner = messages.filter((m) => m.role === 'user').flatMap((m) => textsOf(m.content)).join('\n');
    const found = MARKER_RE.exec(owner);
    rec.scenario = found?.[1] ?? null;
    rec.nonce = found?.[2] ?? null;
    if (body.stream !== true || (rec.scenario !== 'figure' && rec.scenario !== 'invented')) {
      rec.status = 400;
      return apiError(res, 400, 'invalid_request_error', 'unscripted request (no stream, or no known [fake-anthropic:<scenario>:<nonce>] marker)');
    }

    const model = typeof body.model === 'string' ? body.model : 'claude-opus-5-5';
    const id = `msg_fake_${++msgNo}`;
    // The latest tool_result, wherever the loop put it (the retry adds a system entry after it).
    const lastResults = [...messages].reverse().map(toolResultsOf).find((r) => r.length) ?? [];
    const retry = messages.some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('These figures are not'));

    if (!lastResults.length) {
      rec.kind = 'tool_round';
      rec.toolUseId = `toolu_fake_${rec.scenario}_${rec.nonce}`;
      rec.texts = [ROUND1_TEXT];
      rec.status = 200;
      return streamMessage(res, model, [{ type: 'text', text: ROUND1_TEXT }, { type: 'tool_use', id: rec.toolUseId, name: FAKE_TOOL, input: {} }], 'tool_use', FAKE_USAGE.tool_round, id);
    }

    const result = lastResults[0]!;
    rec.figure = result.is_error ? null : figureIn(result.text);
    const quoted = rec.figure ? `${rec.figure.raw} IQD` : 'no figure';
    let text: string;
    if (rec.scenario === 'figure') {
      rec.kind = 'answer';
      text = `From the rate list, that hour is ${quoted}.`;
    } else {
      rec.kind = retry ? 'retry' : 'answer';
      text = `From the rate list, that hour is ${quoted}, and the courts take ${INVENTED_FIGURE.raw} IQD a year.`;
    }
    rec.texts = [text];
    rec.status = 200;
    return streamMessage(res, model, [{ type: 'text', text }], 'end_turn', FAKE_USAGE[rec.kind], id);
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e) => {
      if (!res.headersSent) apiError(res, 500, 'api_error', e instanceof Error ? e.message : String(e));
      else res.end();
    });
  });
  const bound = await new Promise<string | null>((resolve) => {
    server.once('error', (e) => resolve(e instanceof Error ? e.message : String(e)));
    server.listen(FAKE_ANTHROPIC_PORT, '0.0.0.0', () => resolve(null));
  });
  if (bound) return { error: `the fake Anthropic could not listen on ${FAKE_ANTHROPIC_PORT}: ${bound}` };

  return {
    seen,
    url: FAKE_ANTHROPIC_BASE_URL,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
