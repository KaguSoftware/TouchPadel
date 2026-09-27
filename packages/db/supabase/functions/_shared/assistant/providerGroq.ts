/**
 * providerGroq.ts — the Groq adapter behind the same Provider interface as the
 * Claude one (provider.ts). Owner call 2026-09-20: "connect it to the free
 * Groq for now, a one-line model and key change to move back". Raw fetch to
 * the OpenAI-compatible endpoint, like analytics-insights; no SDK.
 *
 * What Groq changes, declared in `capabilities` so the functions adapt:
 *   batch        false — Groq's batch API is not wired; the estimate card offers aggregate and live.
 *   exactTokens  false — no count_tokens endpoint; the estimator's first-chunk figure is bytes/4, labelled.
 *   compactMap   false — the free tier allows ~8k tokens per request, so the 8k-token system map
 *                        stays out of the prompt; the model reaches it through search/describe/page_lookup.
 *   deferTools   false — no tool search; only the tools the chat's scopes allow are sent.
 *   resultRows   60 — a tool result is cut at 60 rows with the usual "… N more rows" marker (a two-tool
 *                     courts question reached 20k tokens at 500).
 *   packBudget   1500 — context packs above this (estimated tokens, smallest first) are left out of the
 *                       first turn; the model calls the tool instead. The courts pack alone is ~8k tokens.
 * Usage: prompt/completion totals; `prompt_tokens_details.cached_tokens` (Groq's automatic prefix
 * cache) is reported as cache_read and subtracted from input, cache_write is 0.
 *
 * Type wall: messages are ProviderMessage (tool results built in clean.ts only); the conversion
 * to OpenAI shape lives in groqWire.ts (pure, tested).
 */
import type { BatchRequest, GenerateCall, Provider, ProviderCall, ProviderTurn, ContentBlock } from './provider.ts';
import { ProviderError } from './provider.ts';
import type { WireTool } from './tools.ts';
import {
  GROQ_URL,
  applyChunk,
  blocksFromOai,
  newAccumulator,
  orderedCalls,
  stopReasonFromOai,
  supportsReasoningEffort,
  supportsStrictJsonSchema,
  takeSseData,
  toOaiMessages,
  toOaiTools,
  usageFromOai,
  type OaiToolCall,
  type OaiUsage,
} from './groqWire.ts';

async function groqError(res: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    detail = body.error?.message ?? body.error?.code ?? '';
  } catch {
    detail = await res.text().catch(() => '');
  }
  if (res.status === 401 || res.status === 403) return new ProviderError('NOT_CONFIGURED', `Groq refused the key: ${detail}`, res.status);
  if (res.status === 429) return new ProviderError('RATE_LIMITED', `Groq rate limit: ${detail}`, 429);
  if (res.status === 413) return new ProviderError('RATE_LIMITED', `Groq request too large for the plan: ${detail}`, 413);
  return new ProviderError('UPSTREAM', `Groq ${res.status}: ${detail}`, res.status);
}

/** Rate-limit retries: up to three waits of at least 3 s, growing, none longer than 12 s (≈ 25 s worst case inside the 50 s turn). */
const RETRY_ATTEMPTS = 3;
const RETRY_FLOOR_MS = 3_000;
const RETRY_MAX_MS = 12_000;

/**
 * `retry-after` header (seconds), or the phrase Groq writes in the body:
 * "try again in 194.999999ms", "try again in 4.23s", "try again in 1m2.5s".
 */
export function retryAfterMs(res: Response, bodyText: string): number | null {
  const header = res.headers.get('retry-after');
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header) * 1000) + 250;
  const m = /try again in\s+(?:(\d+)m(?![s]))?\s*(\d+(?:\.\d+)?)(ms|s)/i.exec(bodyText);
  if (!m) return null;
  const minutes = Number(m[1] ?? 0);
  const n = Number(m[2]);
  const ms = m[3].toLowerCase() === 'ms' ? n : n * 1000;
  return Math.ceil(minutes * 60_000 + ms) + 250;
}

function baseBody(model: string, effort: 'low' | 'medium' | 'high', maxTokens: number): Record<string, unknown> {
  const body: Record<string, unknown> = { model, max_completion_tokens: maxTokens };
  if (supportsReasoningEffort(model)) body.reasoning_effort = effort;
  return body;
}

export function groqProvider(apiKey: string, model: string): Provider {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  /**
   * One request, with one wait-and-retry on a rate limit. The free tier meters
   * tokens per minute (8k on gpt-oss-120b) and answers 429 with "try again in
   * 4.2s"; a chat turn has a 50 s wall clock, so a short wait is cheaper than a
   * failed answer. Longer waits surface as RATE_LIMITED for the UI to say so.
   */
  async function post(body: Record<string, unknown>, signal: AbortSignal, attempt = 0): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal.aborted) throw new ProviderError('TIMEOUT', 'the request was cut off');
      throw new ProviderError('UPSTREAM', e instanceof Error ? e.message : String(e));
    }
    if (res.status === 429 && attempt < RETRY_ATTEMPTS) {
      // Groq's hint can be "30ms" while the minute's counter is still full, so
      // the wait has a floor and grows with each attempt; the total stays inside
      // the turn's wall clock.
      const hint = retryAfterMs(res, await res.clone().text()) ?? RETRY_FLOOR_MS;
      const wait = Math.min(Math.max(hint, RETRY_FLOOR_MS) * (attempt + 1), RETRY_MAX_MS);
      if (!signal.aborted) {
        await new Promise((r) => setTimeout(r, wait));
        return post(body, signal, attempt + 1);
      }
    }
    if (!res.ok) throw await groqError(res);
    return res;
  }

  return {
    model,
    vendor: 'groq',
    capabilities: { batch: false, exactTokens: false, compactMap: false, deferTools: false, packBudget: 1500, resultRows: 60 },

    async stream(call: ProviderCall): Promise<ProviderTurn> {
      const started = Date.now();
      const body = {
        ...baseBody(model, call.effort, call.maxTokens),
        messages: toOaiMessages(call.system, call.messages),
        tools: call.tools.length ? toOaiTools(call.tools) : undefined,
        stream: true,
        stream_options: { include_usage: true },
      };
      const res = await post(body, call.signal);
      if (!res.body) throw new ProviderError('UPSTREAM', 'Groq returned no body');
      const acc = newAccumulator();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
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
            const { textDelta, toolStarted } = applyChunk(acc, chunk);
            if (textDelta) call.onText(textDelta);
            for (const name of toolStarted) call.onToolStart(name);
          }
        }
      } catch (e) {
        if (call.signal.aborted) throw new ProviderError('TIMEOUT', 'the turn was cut off');
        throw new ProviderError('UPSTREAM', e instanceof Error ? e.message : String(e));
      }
      const calls: OaiToolCall[] = orderedCalls(acc);
      return {
        content: blocksFromOai(acc.text, calls) as unknown as ContentBlock[],
        stop_reason: calls.length ? 'tool_use' : stopReasonFromOai(acc.finish),
        usage: usageFromOai(acc.usage),
        ms: Date.now() - started,
      };
    },

    async generate(call: GenerateCall): Promise<ProviderTurn> {
      const started = Date.now();
      const strict = supportsStrictJsonSchema(model);
      const body = {
        ...baseBody(model, call.effort, call.maxTokens),
        messages: toOaiMessages(
          strict ? call.system : `${call.system}\n\nAnswer with one JSON object that follows this schema exactly:\n${JSON.stringify(call.schema)}`,
          call.messages,
        ),
        response_format: strict ? { type: 'json_schema', json_schema: { name: 'component', strict: true, schema: call.schema } } : { type: 'json_object' },
      };
      const res = await post(body, call.signal);
      const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]; usage?: OaiUsage };
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? '';
      return {
        content: blocksFromOai(text, []) as unknown as ContentBlock[],
        stop_reason: stopReasonFromOai(choice?.finish_reason),
        usage: usageFromOai(data.usage),
        ms: Date.now() - started,
      };
    },

    // No count_tokens endpoint: an estimate the caller labels as such (capabilities.exactTokens = false).
    countTokens(system: string, tools: WireTool[], messages) {
      const bytes = JSON.stringify(toOaiMessages(system, messages)).length + JSON.stringify(toOaiTools(tools)).length;
      return Promise.resolve(Math.ceil(bytes / 4));
    },

    batchCreate(_requests: BatchRequest[]): Promise<string> {
      return Promise.reject(new ProviderError('NOT_CONFIGURED', 'batch jobs are not available on Groq; run the job live'));
    },
    batchStatus() {
      return Promise.reject(new ProviderError('NOT_CONFIGURED', 'batch jobs are not available on Groq'));
    },
    batchResults() {
      return Promise.reject(new ProviderError('NOT_CONFIGURED', 'batch jobs are not available on Groq'));
    },
    batchCancel() {
      return Promise.resolve();
    },
  };
}
