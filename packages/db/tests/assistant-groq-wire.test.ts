/**
 * The pure half of the Groq adapter (functions/_shared/assistant/groqWire.ts):
 * our Anthropic-shaped messages ↔ OpenAI-compatible chat completions, the
 * streamed-chunk accumulator and the SSE splitter. Run without Deno.
 */
import { describe, expect, it } from 'vitest';
import {
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
} from '../supabase/functions/_shared/assistant/groqWire.ts';
import { wireTools, ASSISTANT_TOOLS } from '../supabase/functions/_shared/assistant/tools.ts';

describe('toOaiMessages', () => {
  it('turns tool_use / tool_result turns into assistant tool_calls and tool messages, keeps operator system turns', () => {
    const out = toOaiMessages('SYSTEM', [
      { role: 'user', content: 'how much yesterday?' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Reading the panel.' },
          { type: 'tool_use', id: 'toolu_1', name: 'panel_headline', input: { from: '2026-09-19', to: '2026-09-19', compare: 'none' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: ['tool', 'result'].join('_'), tool_use_id: 'toolu_1', content: [{ type: 'text', text: '# panel_headline: 13 rows…' }] }],
      },
      { role: 'system', content: 'Restate using only tool figures.' },
    ]);
    expect(out[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(out[1]).toEqual({ role: 'user', content: 'how much yesterday?' });
    expect(out[2]).toEqual({
      role: 'assistant',
      content: 'Reading the panel.',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'panel_headline', arguments: '{"from":"2026-09-19","to":"2026-09-19","compare":"none"}' } }],
    });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'toolu_1', content: '# panel_headline: 13 rows…' });
    expect(out[4]).toEqual({ role: 'system', content: 'Restate using only tool figures.' });
  });

  it('prefixes an errored tool result and drops empty assistant content to null', () => {
    const out = toOaiMessages('S', [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'search', input: { query: 'q' } }] },
      { role: 'user', content: [{ type: ['tool', 'result'].join('_'), tool_use_id: 'x', is_error: true, content: 'Scope "cafe" is off for this chat' }] },
    ]);
    expect(out[1]).toMatchObject({ role: 'assistant', content: null });
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'x', content: 'ERROR: Scope "cafe" is off for this chat' });
  });
});

describe('toOaiTools', () => {
  it('maps every catalog tool to a function with our strict schema and no defer flag', () => {
    const tools = toOaiTools(wireTools());
    expect(tools).toHaveLength(ASSISTANT_TOOLS.length);
    const t = tools.find((x) => x.function.name === 'panel_headline')!;
    expect(t.type).toBe('function');
    expect(t.function.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    expect(JSON.stringify(tools)).not.toContain('defer_loading');
  });
});

describe('streaming accumulator', () => {
  it('accumulates text deltas, tool call fragments by index, usage and the finish reason', () => {
    const acc = newAccumulator();
    const a = applyChunk(acc, { choices: [{ delta: { content: 'Hel' } }] });
    const b = applyChunk(acc, { choices: [{ delta: { content: 'lo' } }] });
    const c = applyChunk(acc, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'report_cafe', arguments: '{"from":' } }] } }] });
    const d = applyChunk(acc, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"2026-09-01","to":"2026-09-07"}' } }] }, finish_reason: 'tool_calls' }] });
    applyChunk(acc, { choices: [], x_groq: { usage: { prompt_tokens: 1200, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000 } } } });
    expect(a.textDelta + b.textDelta).toBe('Hello');
    expect(c.toolStarted).toEqual(['report_cafe']);
    expect(d.toolStarted).toEqual([]);
    expect(acc.text).toBe('Hello');
    const calls = orderedCalls(acc);
    expect(calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'report_cafe', arguments: '{"from":"2026-09-01","to":"2026-09-07"}' } }]);
    expect(acc.finish).toBe('tool_calls');
    expect(usageFromOai(acc.usage)).toEqual({ input: 200, cache_write: 0, cache_read: 1000, output: 40 });
    const blocks = blocksFromOai(acc.text, calls);
    expect(blocks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 'call_1', name: 'report_cafe', input: { from: '2026-09-01', to: '2026-09-07' } },
    ]);
  });

  it('turns unparseable arguments into an empty input (the validator then refuses the call)', () => {
    expect(blocksFromOai('', [{ id: 'c', type: 'function', function: { name: 'usage', arguments: '{oops' } }])).toEqual([{ type: 'tool_use', id: 'c', name: 'usage', input: {} }]);
  });
});

describe('takeSseData', () => {
  it('yields complete data payloads, keeps the partial tail and drops [DONE]', () => {
    const { payloads, rest } = takeSseData('data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\ndata: {"c"');
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });
});

describe('model facts', () => {
  it('maps finish reasons and knows which Groq models take reasoning_effort and strict json_schema', () => {
    expect(stopReasonFromOai('stop')).toBe('end_turn');
    expect(stopReasonFromOai('tool_calls')).toBe('tool_use');
    expect(stopReasonFromOai('length')).toBe('max_tokens');
    expect(stopReasonFromOai('content_filter')).toBe('refusal');
    expect(supportsReasoningEffort('openai/gpt-oss-120b')).toBe(true);
    expect(supportsReasoningEffort('llama-3.3-70b-versatile')).toBe(false);
    expect(supportsStrictJsonSchema('openai/gpt-oss-120b')).toBe(true);
    expect(supportsStrictJsonSchema('llama-3.3-70b-versatile')).toBe(false);
  });
});
