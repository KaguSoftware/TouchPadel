/**
 * provider.ts — the Provider interface and the Claude adapter (plan §4.1
 * "Model", contracts "provider.ts"). Since 0307 the assistant answers with
 * Claude Opus 5.5 or Claude Sonnet 5.5 only (ASSISTANT_MODELS); providerGroq.ts
 * still implements the interface but nothing builds it. Deno-only: it imports the SDK through `npm:`, so vitest never
 * loads it; the door test asserts it is the only file that does.
 *
 * Request shape, fixed here and nowhere else:
 *   model            one of ASSISTANT_MODELS (default claude-opus-5-5)
 *   betas            ['server-side-fallback-2026-07-01'], fallbacks: 'default'
 *                    — a safety refusal is re-run server-side instead of blanking the chat
 *   thinking         { type: 'adaptive' } (the default on both 5.5 models; written out so a model change keeps it)
 *   output_config    { effort }  — 'medium' for chat, 'high' for the job reduce step
 *   system           [{ type:'text', text, cache_control: PREFIX_CACHE_CONTROL }]  — the frozen prefix, 5-minute cache
 *   tools            [tool_search_tool_bm25, web_search?, ...wireTools()]  — core tools loaded, the rest defer_loading;
 *                    web_search (server-side, max WEB_SEARCH_MAX_USES a request) only when the call asks for it
 *   messages         the conversation; a `{ role: 'system' }` entry is the operator channel (gate retry)
 *   cache_control    { type: 'ephemeral' } top-level — the growing tail
 *
 * `generate()` (0141, the analytics components) is `stream()` without the
 * stream and without tools: one non-streaming call whose `output_config.format`
 * is the component's JSON schema, so the answer is typed data the page renders.
 * Same Cleaned-only rule: its messages are ProviderMessage, nothing else.
 *
 * Never written here: budget_tokens, temperature, an assistant prefill.
 *
 * Type wall: the only tool_result a message may carry is a `CleanedToolResult`
 * from clean.ts (§11.0 property 1). Usage comes from `finalMessage().usage`.
 * Errors are mapped to ProviderError codes the chat function streams as-is.
 */
import Anthropic from 'npm:@anthropic-ai/sdk';
import type { Cleaned, CleanedToolResult } from './clean.ts';
import type { WireTool } from './tools.ts';

export type ProviderErrorCode = 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'UPSTREAM' | 'TIMEOUT';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

/** The only models the assistant answers with (owner call 2026-10-07, 0307); the DB CHECKs hold the same pair. */
export const ASSISTANT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const TOOL_SEARCH = { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as const;
/** Searches one request may run (owner call 2026-10-08: outside context for ideas, billed per search). */
export const WEB_SEARCH_MAX_USES = 5;
/** Anthropic's server-side web search; results come back in the same response, billed per search on top of tokens. */
export const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES } as const;

export type ContentBlock = Anthropic.Beta.BetaContentBlock;
/**
 * Our own text. `cache_control` is set by the chat on one block only: the
 * owner's words when a pre-retrieved search block follows them, so the next
 * turn (whose history holds those words without the search) still has a cache
 * entry to read (review 2026-10-08). With the system marker and the top-level
 * automatic one that is three of the four breakpoints.
 */
export type TextBlockParam = { type: 'text'; text: string; cache_control?: typeof PREFIX_CACHE_CONTROL };
/** What a user turn may carry: our own text, or a cleaned tool result. Nothing else compiles. */
export type UserContent = string | readonly (TextBlockParam | CleanedToolResult)[];
export type ProviderMessage =
  | { role: 'user'; content: UserContent }
  | { role: 'assistant'; content: readonly ContentBlock[] | string }
  /** Mid-conversation operator instruction (Opus 5 supports it); must follow a user message. */
  | { role: 'system'; content: string };

export interface ProviderCall {
  system: string;
  tools: WireTool[];
  messages: ProviderMessage[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  onText(delta: string): void;
  onToolStart(name: string): void;
  signal: AbortSignal;
  /** Offer the server-side web search (the chat only). Always the same per surface, so the cached prefix holds. */
  webSearch?: boolean;
}

export interface ProviderUsage {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
}

export interface ProviderTurn {
  content: ContentBlock[];
  stop_reason: string;
  usage: ProviderUsage;
  ms: number;
  /** Web searches the server ran for this call (`usage.server_tool_use.web_search_requests`); 0 or absent without the tool. */
  webSearches?: number;
}

/** One structured, non-streaming call (analytics components, plan §4.4). */
export interface GenerateCall {
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  /** A strict JSON schema (type object, every property required, additionalProperties false). */
  schema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface BatchRequest {
  custom_id: string;
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
}

export type BatchOutcome =
  | { ok: true; content: ContentBlock[]; usage: ProviderUsage; stop_reason: string }
  | { ok: false; error: string };

export interface BatchStatus {
  status: string;
  ended: boolean;
  counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
}

export type ProviderVendor = 'anthropic' | 'groq';

/** What a vendor can do; the functions read these instead of the vendor name. */
export interface ProviderCapabilities {
  /** Batch API for big jobs (half price on Anthropic). */
  batch: boolean;
  /** A real count_tokens endpoint; otherwise countTokens() is bytes/4 and the estimate says so. */
  exactTokens: boolean;
  /** The 8k-token compact system map fits the vendor's per-request budget and goes in the cached prefix. */
  compactMap: boolean;
  /** Server-side tool search with defer_loading; otherwise only the scoped tools are sent. */
  deferTools: boolean;
  /**
   * The most estimated tokens of context packs the first user turn may carry;
   * packs beyond it are left out (largest first) and the model calls the tool
   * instead. Infinity on Anthropic; the free Groq tier's per-request budget
   * needs a small number (the courts pack alone is ~8k tokens).
   */
  packBudget: number;
  /** Row cap on one tool result (clean.ts stage 7). 500 on Anthropic; smaller where a request must fit a small budget. */
  resultRows: number;
}

export interface Provider {
  readonly model: string;
  readonly vendor: ProviderVendor;
  readonly capabilities: ProviderCapabilities;
  stream(call: ProviderCall): Promise<ProviderTurn>;
  generate(call: GenerateCall): Promise<ProviderTurn>;
  countTokens(system: string, tools: WireTool[], messages: ProviderMessage[], opts?: { webSearch?: boolean }): Promise<number>;
  batchCreate(requests: BatchRequest[]): Promise<string>;
  batchStatus(id: string): Promise<BatchStatus>;
  batchResults(id: string): Promise<Map<string, BatchOutcome>>;
  batchCancel(id: string): Promise<void>;
}

/** The text of a turn: every text block joined. */
export function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** The tool_use blocks of a turn. */
export function toolUsesOf(content: readonly ContentBlock[]): Anthropic.Beta.BetaToolUseBlock[] {
  return content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
}

/** Everything but thinking blocks — what a message persists (thinking is model-bound and unbilled to replay). */
export function withoutThinking(content: readonly ContentBlock[]): ContentBlock[] {
  return content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
}

/** A Cleaned value as a plain text block for a prompt (job chunks). Type-gated on the brand. */
export function cleanedText(c: Cleaned): TextBlockParam {
  return { type: 'text', text: c.text };
}

/** The request's tool list: tool search first, then web search when asked, then the catalog. Fixed order for the cache. */
function requestTools(tools: WireTool[], webSearch: boolean | undefined): unknown[] | undefined {
  // Job prompts carry no client tools; a lone tool-search tool would be a list with nothing to search.
  if (!tools.length) return undefined;
  return webSearch ? [TOOL_SEARCH, WEB_SEARCH, ...tools] : [TOOL_SEARCH, ...tools];
}

/** Searches the server ran, from the usage block; the SDK typings may lag the field. */
function webSearchesOf(u: unknown): number {
  const n = (u as { server_tool_use?: { web_search_requests?: unknown } } | null | undefined)?.server_tool_use?.web_search_requests;
  return typeof n === 'number' && n > 0 ? n : 0;
}

function usageOf(u: Anthropic.Beta.BetaUsage | Anthropic.Usage | null | undefined): ProviderUsage {
  return {
    input: u?.input_tokens ?? 0,
    cache_write: u?.cache_creation_input_tokens ?? 0,
    cache_read: u?.cache_read_input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

function mapError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new ProviderError('NOT_CONFIGURED', 'invalid ANTHROPIC_API_KEY', e.status);
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('RATE_LIMITED', e.message, e.status);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('TIMEOUT', e.message);
  if (e instanceof Anthropic.APIError) return new ProviderError('UPSTREAM', e.message, e.status);
  if (e instanceof Error && e.name === 'AbortError') return new ProviderError('TIMEOUT', 'aborted');
  return new ProviderError('UPSTREAM', e instanceof Error ? e.message : String(e));
}

/** Messages as the SDK wants them. The system-role entry is beyond the SDK's typings; it is passed through. */
function wireMessages(messages: readonly ProviderMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return messages as unknown as Anthropic.Beta.BetaMessageParam[];
}

/**
 * The frozen prefix's cache breakpoint: the default 5-minute TTL (written at
 * 1.25× the input price), not the 1-hour one (2×). The rounds of one message
 * are seconds apart, so 5 minutes covers them; one owner sending a few
 * messages a day rarely comes back between 5 minutes and an hour, so the
 * 1-hour write was paid at double price and almost never read (F1, 2026-10-08).
 * The 0312 price list's cache_write rates are the 5-minute ones too.
 */
export const PREFIX_CACHE_CONTROL = { type: 'ephemeral' } as const;

function systemBlocks(system: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: PREFIX_CACHE_CONTROL }];
}

/**
 * Build the provider from secrets. Null when ANTHROPIC_API_KEY is unset — the
 * caller answers 503 NOT_CONFIGURED before touching the database.
 */
export function providerFromEnv(get: (name: string) => string | undefined, modelOverride?: string | null): Provider | null {
  const model = assistantModel(get, modelOverride);
  const apiKey = (get('ANTHROPIC_API_KEY') ?? '').trim();
  if (!apiKey) return null;
  return anthropicProvider(apiKey, model);
}

/** The sentence a 503 carries when the model's vendor has no key. */
export function notConfiguredMessage(get: (name: string) => string | undefined, model: string | null | undefined): string {
  return `ANTHROPIC_API_KEY is not set (the model ${assistantModel(get, model)} is served by anthropic)`;
}

/**
 * The model an answer runs on: the chat's own (or the chain default), else
 * ANTHROPIC_MODEL, else DEFAULT_MODEL — and DEFAULT_MODEL for anything outside
 * ASSISTANT_MODELS, so a stale secret or row can never reach another model.
 */
export function assistantModel(get: (name: string) => string | undefined, modelOverride?: string | null): string {
  const wanted = (modelOverride ?? '').trim() || (get('ANTHROPIC_MODEL') ?? '').trim();
  return (ASSISTANT_MODELS as readonly string[]).includes(wanted) ? wanted : DEFAULT_MODEL;
}

function anthropicProvider(apiKey: string, model: string): Provider {
  // maxRetries 1: the chat has its own 50 s wall clock; the SDK's default of 2 could blow through it.
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 55_000 });

  return {
    model,
    vendor: 'anthropic',
    capabilities: { batch: true, exactTokens: true, compactMap: true, deferTools: true, packBudget: Number.POSITIVE_INFINITY, resultRows: 500 },

    async stream(call) {
      const started = Date.now();
      // SDK typings lag `fallbacks` and the top-level `cache_control`; the shape is the contract's.
      const params = {
        model,
        max_tokens: call.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: call.effort },
        system: systemBlocks(call.system),
        tools: requestTools(call.tools, call.webSearch),
        messages: wireMessages(call.messages),
        cache_control: { type: 'ephemeral' },
      } as unknown as Parameters<typeof client.beta.messages.stream>[0];
      try {
        const stream = client.beta.messages.stream(params, { signal: call.signal });
        stream.on('text', (delta) => call.onText(delta));
        stream.on('streamEvent', (ev) => {
          if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') call.onToolStart(ev.content_block.name);
        });
        const msg = await stream.finalMessage();
        return { content: msg.content, stop_reason: msg.stop_reason ?? 'end_turn', usage: usageOf(msg.usage), ms: Date.now() - started, webSearches: webSearchesOf(msg.usage) };
      } catch (e) {
        throw mapError(e);
      }
    },

    async generate(call) {
      const started = Date.now();
      // No tools and no tool search: the inputs are already in the user turn
      // (plan §4.4 runs the component's tools before the model). The schema
      // goes in output_config.format; the SDK typings lag the shape as above.
      const params = {
        model,
        max_tokens: call.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: call.effort, format: { type: 'json_schema', schema: call.schema } },
        system: systemBlocks(call.system),
        messages: wireMessages(call.messages),
        cache_control: { type: 'ephemeral' },
      } as unknown as Parameters<typeof client.beta.messages.create>[0];
      try {
        const msg = (await client.beta.messages.create(params, { signal: call.signal })) as Anthropic.Beta.BetaMessage;
        return { content: msg.content, stop_reason: msg.stop_reason ?? 'end_turn', usage: usageOf(msg.usage), ms: Date.now() - started };
      } catch (e) {
        throw mapError(e);
      }
    },

    async countTokens(system, tools, messages, opts) {
      try {
        const params = {
          model,
          system: systemBlocks(system),
          tools: requestTools(tools, opts?.webSearch),
          messages: wireMessages(messages),
          thinking: { type: 'adaptive' },
        } as unknown as Anthropic.Beta.MessageCountTokensParams;
        const r = await client.beta.messages.countTokens(params);
        return r.input_tokens;
      } catch (e) {
        throw mapError(e);
      }
    },

    async batchCreate(requests) {
      // The Batches API rejects `fallbacks`; a refused chunk comes back as stop_reason 'refusal' and the job reports it.
      try {
        const batch = await client.messages.batches.create({
          requests: requests.map((r) => ({
            custom_id: r.custom_id,
            params: {
              model,
              max_tokens: r.maxTokens,
              thinking: { type: 'adaptive' },
              output_config: { effort: r.effort },
              system: systemBlocks(r.system) as unknown as Anthropic.TextBlockParam[],
              messages: r.messages as unknown as Anthropic.MessageParam[],
            } as Anthropic.MessageCreateParamsNonStreaming,
          })),
        });
        return batch.id;
      } catch (e) {
        throw mapError(e);
      }
    },

    async batchStatus(id) {
      try {
        const b = await client.messages.batches.retrieve(id);
        return {
          status: b.processing_status,
          ended: b.processing_status === 'ended',
          counts: {
            processing: b.request_counts.processing,
            succeeded: b.request_counts.succeeded,
            errored: b.request_counts.errored,
            canceled: b.request_counts.canceled,
            expired: b.request_counts.expired,
          },
        };
      } catch (e) {
        throw mapError(e);
      }
    },

    async batchResults(id) {
      const out = new Map<string, BatchOutcome>();
      try {
        for await (const r of await client.messages.batches.results(id)) {
          if (r.result.type === 'succeeded') {
            const m = r.result.message;
            out.set(r.custom_id, {
              ok: true,
              content: m.content as unknown as ContentBlock[],
              usage: usageOf(m.usage),
              stop_reason: m.stop_reason ?? 'end_turn',
            });
          } else if (r.result.type === 'errored') {
            out.set(r.custom_id, { ok: false, error: JSON.stringify(r.result.error) });
          } else {
            out.set(r.custom_id, { ok: false, error: r.result.type });
          }
        }
        return out;
      } catch (e) {
        throw mapError(e);
      }
    },

    async batchCancel(id) {
      try {
        await client.messages.batches.cancel(id);
      } catch (e) {
        throw mapError(e);
      }
    },
  };
}
