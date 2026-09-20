/**
 * provider.ts — the Provider interface, the Claude adapter, and the vendor
 * switch (plan §4.1 "Model", contracts "provider.ts"; Groq lives in
 * providerGroq.ts behind the same interface). Deno-only: it imports the SDK through `npm:`, so vitest never
 * loads it; the door test asserts it is the only file that does.
 *
 * Request shape, fixed here and nowhere else:
 *   model            ANTHROPIC_MODEL (default claude-opus-5)
 *   betas            ['server-side-fallback-2026-07-01'], fallbacks: 'default'
 *                    — a safety refusal is re-run server-side instead of blanking the chat
 *   thinking         { type: 'adaptive' } (the default on Opus 5; written out so a model change keeps it)
 *   output_config    { effort }  — 'medium' for chat, 'high' for the job reduce step
 *   system           [{ type:'text', text, cache_control:{ type:'ephemeral', ttl:'1h' } }]  — the frozen prefix
 *   tools            [tool_search_tool_bm25, ...wireTools()]  — core tools loaded, the rest defer_loading
 *   messages         the conversation; a `{ role: 'system' }` entry is the operator channel (gate retry)
 *   cache_control    { type: 'ephemeral' } top-level — the growing tail
 *
 * `generate()` (0115, the analytics components) is `stream()` without the
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
import { groqProvider } from './providerGroq.ts';

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

export const DEFAULT_MODEL = 'claude-opus-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const TOOL_SEARCH = { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as const;

export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type TextBlockParam = { type: 'text'; text: string };
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

/**
 * Which vendor serves a model: Claude ids start with `claude-`; everything else
 * (Groq's `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, …) is Groq. The
 * venue default model (0114) therefore IS the vendor switch: set it to a Claude
 * id with ANTHROPIC_API_KEY present, or a Groq id with GROQ_API_KEY present.
 */
export function vendorFor(model: string): ProviderVendor {
  return model.startsWith('claude-') ? 'anthropic' : 'groq';
}

export function keyNameFor(model: string): 'ANTHROPIC_API_KEY' | 'GROQ_API_KEY' {
  return vendorFor(model) === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY';
}

export interface Provider {
  readonly model: string;
  readonly vendor: ProviderVendor;
  readonly capabilities: ProviderCapabilities;
  stream(call: ProviderCall): Promise<ProviderTurn>;
  generate(call: GenerateCall): Promise<ProviderTurn>;
  countTokens(system: string, tools: WireTool[], messages: ProviderMessage[]): Promise<number>;
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

function systemBlocks(system: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }];
}

/**
 * Build the provider from secrets. Null when ANTHROPIC_API_KEY is unset — the
 * caller answers 503 NOT_CONFIGURED before touching the database.
 */
export function providerFromEnv(get: (name: string) => string | undefined, modelOverride?: string | null): Provider | null {
  // 0114: the chat's own model (or the venue default) wins over ANTHROPIC_MODEL,
  // which is now only the fallback for a venue that has set nothing.
  const model = (modelOverride ?? '').trim() || (get('ANTHROPIC_MODEL') ?? '').trim() || DEFAULT_MODEL;
  const apiKey = (get(keyNameFor(model)) ?? '').trim();
  if (!apiKey) return null;
  if (vendorFor(model) === 'groq') return groqProvider(apiKey, model);
  return anthropicProvider(apiKey, model);
}

/** The sentence a 503 carries when the model's vendor has no key. */
export function notConfiguredMessage(get: (name: string) => string | undefined, model: string | null | undefined): string {
  const m = (model ?? '').trim() || (get('ANTHROPIC_MODEL') ?? '').trim() || DEFAULT_MODEL;
  return `${keyNameFor(m)} is not set (the model ${m} is served by ${vendorFor(m)})`;
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
        // Job prompts carry no client tools; a lone tool-search tool would be a list with nothing to search.
        tools: call.tools.length ? [TOOL_SEARCH, ...call.tools] : undefined,
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
        return { content: msg.content, stop_reason: msg.stop_reason ?? 'end_turn', usage: usageOf(msg.usage), ms: Date.now() - started };
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

    async countTokens(system, tools, messages) {
      try {
        const params = {
          model,
          system: systemBlocks(system),
          tools: tools.length ? [TOOL_SEARCH, ...tools] : undefined,
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
