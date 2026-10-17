/**
 * assistant-free — the free guide to the app (owner call 2026-10-16), for
 * every staff role in the operator and on the phone, and for the owner who
 * picks "The free AI". Contract: packages/core/src/assistant/free.ts; the pure
 * rules (prompt, pages by role, allowance) are _shared/assistant/free.ts.
 *
 * Request  POST { text, lang, app: 'operator'|'mobile', route?, history?, pages? }
 * Response text/event-stream: message_start {model, free: true} · delta {text}
 *          · done {stop_reason} · error {code, message}. Before the stream,
 *          JSON refusals: 400 INVALID_REQUEST · 401 AUTH_REQUIRED ·
 *          403 FORBIDDEN · 429 RATE_LIMITED {retry_after_s, scope} ·
 *          503 NOT_CONFIGURED.
 *
 * Strictly free, on purpose:
 *   - Groq only (GROQ_API_KEY), one model (free.ts freeModel refuses a Claude
 *     id); ANTHROPIC_API_KEY is never read, the paid quota (llm_begin_request)
 *     is never debited, and nothing is recorded against the spend cap.
 *   - No tools and no business read. The service client reads the caller's
 *     staff row (requireStaffRole) and nothing else; the pages in the prompt
 *     come from the committed map, filtered by the caller's role, or, on the
 *     phone, from the rows the app sends (labels and routes only).
 *   - Nothing stored: the client keeps the thread and sends its last turns.
 *   - A per-person allowance in memory (free.ts createLimiter) so one person
 *     cannot use up the club's free tier; Groq's own 429 is the backstop.
 *
 * Wall clock 25 s; the answer is at most FREE_MAX_OUTPUT_TOKENS.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole, type StaffRole } from '../_shared/auth.ts';
import { handle, json, KB, logError, readJsonBody } from '../_shared/http.ts';
import { mapChunks } from '../_shared/assistant/map.ts';
import { SSE_HEADERS, sseFrame, sseHeartbeat } from '../_shared/assistant/sse.ts';
import { GROQ_URL, applyChunk, newAccumulator, stopReasonFromOai, supportsReasoningEffort, takeSseData, usageFromOai } from '../_shared/assistant/groqWire.ts';
import {
  FREE_MAX_OUTPUT_TOKENS,
  buildFreeSystem,
  createLimiter,
  freeModel,
  listedPages,
  mobilePages,
  operatorPages,
  parseFreeBody,
  rankPages,
  type FreeReq,
} from '../_shared/assistant/free.ts';

/** Every staff role: the free guide is for everyone with a staff row. */
const ALL_ROLES: readonly StaffRole[] = [
  'owner',
  'manager',
  'cashier',
  'court_desk',
  'prep',
  'head_barista',
  'barista',
  'assistant_barista',
  'head_chef',
  'chef',
  'driver',
  'marketing',
  'waiter',
  'shop_staff',
];

const WALL_MS = 25_000;
const HEARTBEAT_MS = 10_000;
/** Text, six earlier turns and sixty phone rows: a few KB; 32 KB, then 413. */
const MAX_BODY = 32 * KB;
/** A Groq 429 that asks for at most this long is waited out once; longer is RATE_LIMITED. */
const SHORT_WAIT_MS = 4_000;

const limiter = createLimiter();

const ERROR_TEXT: Record<string, string> = {
  RATE_LIMITED: 'the free AI is busy right now; try again in a minute',
  UPSTREAM: 'the free AI did not answer',
  TIMEOUT: `the free AI did not finish inside ${WALL_MS / 1000} s`,
};

class FreeError extends Error {
  constructor(readonly code: 'RATE_LIMITED' | 'UPSTREAM' | 'TIMEOUT' | 'NOT_CONFIGURED') {
    super(code);
  }
}

function retryAfter(res: Response, body: string): number | null {
  const header = res.headers.get('retry-after');
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header) * 1000);
  const m = /try again in\s+(?:(\d+)m(?!s))?\s*(\d+(?:\.\d+)?)(ms|s)/i.exec(body);
  if (!m) return null;
  return Math.ceil(Number(m[1] ?? 0) * 60_000 + Number(m[2]) * (m[3]!.toLowerCase() === 'ms' ? 1 : 1000));
}

async function post(apiKey: string, body: unknown, signal: AbortSignal, retried = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal.aborted) throw new FreeError('TIMEOUT');
    logError('assistant-free', e, 'Groq unreachable');
    throw new FreeError('UPSTREAM');
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  if (res.status === 429 || res.status === 413) {
    const wait = retryAfter(res, text);
    if (!retried && res.status === 429 && wait !== null && wait <= SHORT_WAIT_MS && !signal.aborted) {
      await new Promise((r) => setTimeout(r, wait + 250));
      return post(apiKey, body, signal, true);
    }
    console.error('[assistant-free] Groq refused', res.status, text.slice(0, 300));
    throw new FreeError('RATE_LIMITED');
  }
  console.error('[assistant-free] Groq error', res.status, text.slice(0, 300));
  throw new FreeError(res.status === 401 || res.status === 403 ? 'NOT_CONFIGURED' : 'UPSTREAM');
}

function promptFor(parsed: FreeReq, role: string): string {
  const pages = parsed.app === 'mobile' ? mobilePages(parsed.pages) : operatorPages(mapChunks(), role, parsed.lang);
  // The question and the turn before it pick the pages (a follow-up such as "and where do I close it?" leans on the last answer).
  const lastTurn = parsed.history.slice(-1)[0]?.text ?? '';
  const detailed = rankPages(`${parsed.text} ${lastTurn}`, pages, parsed.route);
  return buildFreeSystem({ lang: parsed.lang, app: parsed.app, role, current: parsed.route, detailed, listed: listedPages(pages) });
}

Deno.serve(handle('assistant-free', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const service = createServiceClient();
  const auth = await requireStaffRole(req, service, ALL_ROLES);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400),
  });
  if (!body.ok) return body.response;
  const parsed = parseFreeBody(body.value);
  if (typeof parsed === 'string') return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: parsed }, 400);

  const apiKey = (Deno.env.get('GROQ_API_KEY') ?? '').trim();
  if (!apiKey) return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: 'GROQ_API_KEY is not set' }, 503);

  const allowance = limiter.take(auth.userId, Date.now());
  if ('scope' in allowance) {
    const retry_after_s = Math.max(1, Math.ceil(allowance.retryAfterMs / 1000));
    return json({ error: 'RATE_LIMITED', code: 'RATE_LIMITED', scope: allowance.scope, retry_after_s, message: allowance.scope === 'day' ? 'today\'s free questions are used up' : 'too many questions in a minute' }, 429, { 'Retry-After': String(retry_after_s) });
  }

  const model = freeModel((n) => Deno.env.get(n));
  const system = promptFor(parsed, auth.role);
  const messages = [
    { role: 'system', content: system },
    ...parsed.history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: parsed.text },
  ];
  const groqBody: Record<string, unknown> = {
    model,
    messages,
    max_completion_tokens: FREE_MAX_OUTPUT_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (supportsReasoningEffort(model)) groqBody.reasoning_effort = 'low';

  const abort = new AbortController();
  const wall = setTimeout(() => abort.abort(), WALL_MS);
  // The first request is made before the stream opens, so a refusal (the
  // club's free tier used up) answers as JSON the clients already map.
  let upstream: Response;
  try {
    upstream = await post(apiKey, groqBody, abort.signal);
  } catch (e) {
    clearTimeout(wall);
    const code = e instanceof FreeError ? e.code : 'UPSTREAM';
    if (code === 'RATE_LIMITED') return json({ error: code, code, scope: 'club', message: ERROR_TEXT.RATE_LIMITED }, 429);
    if (code === 'NOT_CONFIGURED') return json({ error: code, code, message: 'Groq refused the key' }, 503);
    return json({ error: code, code, message: ERROR_TEXT[code] ?? ERROR_TEXT.UPSTREAM }, 502);
  }

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  const write = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };
  const emit = (event: string, data: unknown) => write(sseFrame(event, data));
  const heartbeat = setInterval(() => write(sseHeartbeat()), HEARTBEAT_MS);

  (async () => {
    const started = Date.now();
    const acc = newAccumulator();
    let errorCode: string | null = null;
    emit('message_start', { model, free: true });
    try {
      if (!upstream.body) throw new FreeError('UPSTREAM');
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { payloads, rest } = takeSseData(buffer);
        buffer = rest;
        for (const p of payloads) {
          let chunk: unknown;
          try {
            chunk = JSON.parse(p);
          } catch {
            continue;
          }
          const { textDelta } = applyChunk(acc, chunk);
          if (textDelta) emit('delta', { text: textDelta });
        }
      }
    } catch (e) {
      errorCode = e instanceof FreeError ? e.code : abort.signal.aborted ? 'TIMEOUT' : 'UPSTREAM';
      if (!(e instanceof FreeError)) console.error('[assistant-free] stream failed', e instanceof Error ? e.message : String(e));
    }
    // Free, so not priced or recorded against the cap; the log keeps the size for tuning the prompt.
    const usage = usageFromOai(acc.usage);
    console.log('[assistant-free]', JSON.stringify({ role: auth.role, app: parsed.app, model, ms: Date.now() - started, input: usage.input + usage.cache_read, output: usage.output, error: errorCode }));
    if (errorCode) emit('error', { code: errorCode, message: ERROR_TEXT[errorCode] ?? ERROR_TEXT.UPSTREAM });
    emit('done', { stop_reason: errorCode ?? stopReasonFromOai(acc.finish) });
    clearInterval(heartbeat);
    clearTimeout(wall);
    closed = true;
    try {
      (controller as ReadableStreamDefaultController<Uint8Array> | null)?.close();
    } catch {
      // already closed by the client
    }
  })();

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
}));
