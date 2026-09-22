/**
 * groqWire.ts — the pure half of the Groq adapter (providerGroq.ts): the shape
 * conversions between the assistant's own message form (Anthropic-style content
 * blocks, which every stored message and the chat loop use) and Groq's
 * OpenAI-compatible chat completions, plus the SSE line parser. No Deno, no
 * fetch, so vitest covers it (tests/assistant-groq-wire.test.ts).
 *
 * WHY THE ASSISTANT SPEAKS ANTHROPIC BLOCKS INTERNALLY. The plan built the loop,
 * the gate, the persistence and the re-check on one message form; a second
 * vendor is a conversion at the edge of the provider, not a second loop. The
 * blocks this file READS include tool results built by clean.ts — it never
 * builds one (the door test names this file as a reader).
 */
import type { WireTool } from './tools.ts';

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Models whose `reasoning_effort` Groq accepts (low | medium | high). */
export function supportsReasoningEffort(model: string): boolean {
  return model.startsWith('openai/gpt-oss');
}

/** Models Groq documents for `response_format: json_schema` with `strict: true`. */
export function supportsStrictJsonSchema(model: string): boolean {
  return model.startsWith('openai/gpt-oss') || model.startsWith('qwen/qwen3');
}

// ---------------------------------------------------------------------------
// Our side (Anthropic-style blocks) → OpenAI messages
// ---------------------------------------------------------------------------
export interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type OaiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OaiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

type AnyBlock = { type: string; [k: string]: unknown };

function isBlockArray(v: unknown): v is AnyBlock[] {
  return Array.isArray(v) && v.every((b) => b && typeof b === 'object' && typeof (b as AnyBlock).type === 'string');
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!isBlockArray(content)) return '';
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

/** The tool-result blocks (built by clean.ts) inside a user turn, by their tool_use id. */
function toolResultsOf(content: unknown): { id: string; text: string; isError: boolean }[] {
  if (!isBlockArray(content)) return [];
  const RESULT = ['tool', 'result'].join('_'); // read only; see the header note and tests/assistant-clean-door.test.ts
  return content
    .filter((b) => b.type === RESULT && typeof b.tool_use_id === 'string')
    .map((b) => ({ id: b.tool_use_id as string, text: blockText(b.content) || (typeof b.content === 'string' ? b.content : ''), isError: b.is_error === true }));
}

/**
 * Convert the conversation. A user turn that carries tool results becomes one
 * `tool` message per result (OpenAI's shape), followed by a `user` message for
 * any text in the same turn. Thinking blocks are dropped.
 */
export function toOaiMessages(system: string, messages: readonly { role: string; content: unknown }[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: typeof m.content === 'string' ? m.content : blockText(m.content) });
      continue;
    }
    if (m.role === 'assistant') {
      const text = blockText(m.content);
      const calls: OaiToolCall[] = isBlockArray(m.content)
        ? m.content
            .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
            .map((b) => ({ id: b.id as string, type: 'function', function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) } }))
        : [];
      const msg: OaiMessage = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    // user
    const results = toolResultsOf(m.content);
    for (const r of results) out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERROR: ${r.text}` : r.text });
    const text = blockText(m.content);
    if (text) out.push({ role: 'user', content: text });
    else if (!results.length) out.push({ role: 'user', content: '' });
  }
  return out;
}

/** Tool definitions: our strict schemas as OpenAI functions (defer_loading has no equivalent and is dropped). */
export function toOaiTools(tools: readonly WireTool[]): OaiTool[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema as unknown as Record<string, unknown> } }));
}

// ---------------------------------------------------------------------------
// OpenAI response → our blocks
// ---------------------------------------------------------------------------
export interface OaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

export function usageFromOai(u: OaiUsage | null | undefined): { input: number; cache_write: number; cache_read: number; output: number } {
  const prompt = u?.prompt_tokens ?? 0;
  const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
  return { input: Math.max(0, prompt - cached), cache_write: 0, cache_read: cached, output: u?.completion_tokens ?? 0 };
}

export function stopReasonFromOai(finish: string | null | undefined): string {
  switch (finish) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    case 'stop':
    default:
      return 'end_turn';
  }
}

/** Text and tool calls → our content blocks. A tool call whose arguments do not parse becomes an empty input (the loop's validator then refuses it). */
export function blocksFromOai(text: string, toolCalls: readonly OaiToolCall[]): AnyBlock[] {
  const out: AnyBlock[] = [];
  if (text) out.push({ type: 'text', text });
  for (const c of toolCalls) {
    let input: unknown = {};
    try {
      input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      input = {};
    }
    out.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Streaming: accumulate chat.completion.chunk deltas
// ---------------------------------------------------------------------------
export interface StreamAccumulator {
  text: string;
  calls: Map<number, OaiToolCall>;
  finish: string | null;
  usage: OaiUsage | null;
}

export function newAccumulator(): StreamAccumulator {
  return { text: '', calls: new Map(), finish: null, usage: null };
}

/**
 * Apply one parsed `data:` object. Returns the text delta (if any) and the names
 * of tool calls that started in this chunk, so the caller can stream both.
 */
export function applyChunk(acc: StreamAccumulator, chunk: unknown): { textDelta: string; toolStarted: string[] } {
  const started: string[] = [];
  let textDelta = '';
  const c = chunk as { choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]; usage?: OaiUsage | null; x_groq?: { usage?: OaiUsage } };
  const choice = c.choices?.[0];
  if (choice?.delta?.content) {
    textDelta = choice.delta.content;
    acc.text += textDelta;
  }
  for (const tc of choice?.delta?.tool_calls ?? []) {
    const existing = acc.calls.get(tc.index);
    if (!existing) {
      const call: OaiToolCall = { id: tc.id ?? `call_${tc.index}`, type: 'function', function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' } };
      acc.calls.set(tc.index, call);
      if (call.function.name) started.push(call.function.name);
    } else {
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name && !existing.function.name) {
        existing.function.name = tc.function.name;
        started.push(tc.function.name);
      }
      if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
    }
  }
  if (choice?.finish_reason) acc.finish = choice.finish_reason;
  const usage = c.usage ?? c.x_groq?.usage;
  if (usage) acc.usage = usage;
  return { textDelta, toolStarted: started };
}

/** Split an SSE buffer into complete `data:` payloads; returns the rest to keep. `[DONE]` is dropped. */
export function takeSseData(buffer: string): { payloads: string[]; rest: string } {
  const payloads: string[] = [];
  let rest = buffer;
  for (;;) {
    const i = rest.indexOf('\n\n');
    if (i < 0) break;
    const frame = rest.slice(0, i);
    rest = rest.slice(i + 2);
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data && data !== '[DONE]') payloads.push(data);
    }
  }
  return { payloads, rest };
}

export function orderedCalls(acc: StreamAccumulator): OaiToolCall[] {
  return [...acc.calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}
