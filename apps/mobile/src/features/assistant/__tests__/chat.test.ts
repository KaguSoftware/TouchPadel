import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  asModelsPayload,
  asUsageSummary,
  chatCostMicros,
  formatUsd,
  isModelNotPriced,
  modelName,
  emptyTurn,
  normaliseScopes,
  refusalCode,
  refusedScopes,
  sourcesOf,
  textOfContent,
  toggleScope,
  type LiveTurn,
} from '../chat';
import { parseSseChunk, parseSseData } from '../sse';

function fold(events: [string, unknown][]): LiveTurn {
  return events.reduce((turn, [name, data]) => applyEvent(turn, name, data), emptyTurn(null, 'q'));
}

describe('sse', () => {
  it('returns whole events and keeps the unfinished tail', () => {
    const first = parseSseChunk('event: delta\ndata: {"text":"Hel"}\n\nevent: del');
    expect(first.events).toEqual([{ event: 'delta', data: '{"text":"Hel"}' }]);
    expect(first.rest).toBe('event: del');
    const second = parseSseChunk(`${first.rest}ta\ndata: {"text":"lo"}\n\n`);
    expect(second.events).toEqual([{ event: 'delta', data: '{"text":"lo"}' }]);
    expect(second.rest).toBe('');
  });

  it('reads CRLF, comments and non-JSON data', () => {
    const { events } = parseSseChunk(': keep-alive\r\n\r\nevent: error\r\ndata: nope\r\n\r\n');
    expect(events).toEqual([{ event: 'error', data: 'nope' }]);
    expect(parseSseData('nope')).toBe('nope');
    expect(parseSseData('{"a":1}')).toEqual({ a: 1 });
    expect(parseSseData('')).toBeNull();
  });
});

describe('applyEvent', () => {
  it('grows the answer, tracks a tool and closes on done', () => {
    const turn = fold([
      ['message_start', { conversation_id: 'c1', assistant_message_id: 'm1' }],
      ['tool_start', { call_id: 't1', name: 'panel_headline', args: {} }],
      ['tool_end', { call_id: 't1', name: 'panel_headline', row_count: 3, ms: 40, route: null }],
      ['delta', { text: 'Sales were ' }],
      ['delta', { text: '1,250,000 IQD.' }],
      ['done', { message_id: 'm1', stop_reason: 'end_turn' }],
    ]);
    expect(turn.conversationId).toBe('c1');
    expect(turn.text).toBe('Sales were 1,250,000 IQD.');
    expect(turn.tools).toEqual([
      expect.objectContaining({ call_id: 't1', pending: false, row_count: 3 }),
    ]);
    expect(turn.done).toBe(true);
    expect(turn.assistantMessageId).toBe('m1');
  });

  it('withdraws the first draft when a gate retry resets the text', () => {
    const turn = fold([
      ['delta', { text: 'wrong figure 99' }],
      ['delta', { text: 'right figure 12', reset: true }],
    ]);
    expect(turn.text).toBe('right figure 12');
  });

  it('settles a pending tool and keeps the error code on an error event', () => {
    const turn = fold([
      ['tool_start', { call_id: 't1', name: 'x', args: {} }],
      ['error', { code: 'LLM_MONTHLY_CAP', message: 'cap' }],
    ]);
    expect(turn.error).toEqual({ code: 'LLM_MONTHLY_CAP', message: 'cap' });
    expect(turn.tools[0]!.pending).toBe(false);
    expect(turn.done).toBe(true);
  });

  it('maps an unknown error code to UNKNOWN and notes a proposed job', () => {
    expect(fold([['error', { code: 'WAT' }]]).error?.code).toBe('UNKNOWN');
    expect(fold([['job_estimate', { job_id: 'j' }]]).jobProposed).toBe(true);
  });

  it('lets the sources summary close a tool whose end never arrived', () => {
    const turn = fold([
      ['tool_start', { call_id: 't1', name: 'x', args: {} }],
      ['sources', { items: [{ call_id: 't1', name: 'x', args: {}, row_count: 2, ms: 5, route: null }] }],
    ]);
    expect(turn.tools).toEqual([expect.objectContaining({ pending: false, row_count: 2 })]);
  });
});

describe('refusals', () => {
  it('prefers the body code, then the HTTP class', () => {
    expect(refusalCode(429, { code: 'LLM_MONTHLY_CAP' })).toBe('LLM_MONTHLY_CAP');
    expect(refusalCode(429, { error: 'LLM_DAILY_QUOTA' })).toBe('LLM_DAILY_QUOTA');
    expect(refusalCode(401, null)).toBe('AUTH_REQUIRED');
    expect(refusalCode(403, {})).toBe('FORBIDDEN');
    expect(refusalCode(429, { message: 'slow' })).toBe('RATE_LIMITED');
    expect(refusalCode(503, { code: 'NOT_CONFIGURED' })).toBe('NOT_CONFIGURED');
    expect(refusalCode(502, null)).toBe('UPSTREAM');
    expect(refusalCode(400, null)).toBe('UNKNOWN');
  });
});

describe('scopes', () => {
  it('keeps catalog order and never empties the set', () => {
    expect(normaliseScopes(['howto', 'money', 'nope'])).toEqual(['money', 'howto']);
    expect(toggleScope(['howto'], 'howto')).toEqual(['howto']);
    expect(toggleScope(['money', 'howto'], 'howto')).toEqual(['money']);
    expect(toggleScope(['money'], 'cafe')).toEqual(['cafe', 'money']);
  });

  it('keeps a scope the phone does not offer when another is toggled', () => {
    expect(toggleScope(['audit', 'money'], 'money')).toEqual(['audit']);
    expect(toggleScope(['audit'], 'money')).toEqual(['money', 'audit']);
  });

  it('offers "turn on" only for scopes a tool error names and that are off', () => {
    const errors = ['Scope "cafe" is off for this chat', undefined, 'Scope "money" is off for this chat'];
    expect(refusedScopes(errors, ['money', 'howto'])).toEqual(['cafe']);
    expect(refusedScopes(['something else'], [])).toEqual([]);
  });
});

describe('stored rows', () => {
  it('reads text from a string or from content blocks', () => {
    expect(textOfContent('hi')).toBe('hi');
    expect(
      textOfContent([
        { type: 'text', text: 'one' },
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one\n\ntwo');
    expect(textOfContent(null)).toBe('');
  });

  it('reads sources in either saved shape and notices a job', () => {
    const item = { call_id: 'a', name: 'tool', args: {}, row_count: 1, ms: 2, route: null };
    expect(sourcesOf([item, { job_id: 'j' }])).toEqual({ items: [item], hasJob: true });
    expect(sourcesOf({ items: [item], scopes: ['money'] })).toEqual({ items: [item], hasJob: false });
    expect(sourcesOf(null)).toEqual({ items: [], hasJob: false });
  });
});

describe('models', () => {
  it('reads the models payload defensively', () => {
    expect(asModelsPayload({ default_model: 'claude-opus-5-5', models: ['a', 3, 'b'] })).toEqual({
      default_model: 'claude-opus-5-5',
      models: ['a', 'b'],
    });
    expect(asModelsPayload(null)).toEqual({ default_model: null, models: [] });
  });

  it('names the known models and prints any other id as is', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelName('other-model')).toBe('other-model');
  });

  it('recognises the unpriced-model refusal by code or message', () => {
    expect(isModelNotPriced({ code: 'ASSISTANT_MODEL_NOT_PRICED' })).toBe(true);
    expect(isModelNotPriced({ message: 'ASSISTANT_MODEL_NOT_PRICED' })).toBe(true);
    expect(isModelNotPriced(new Error('boom'))).toBe(false);
    expect(isModelNotPriced(null)).toBe(false);
  });
});

describe('spend', () => {
  it('formats micros as dollars, with a floor for a fraction of a cent', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1_000)).toBe('<$0.01');
    expect(formatUsd(42_000)).toBe('$0.04');
    expect(formatUsd(1_250_000)).toBe('$1.25');
    expect(formatUsd(1_234_567_890)).toBe('$1,234.57');
  });

  it('reads the month and the cap from assistant_usage, and nothing from junk', () => {
    expect(asUsageSummary({ month: { cost_micros: 900 }, cap: { monthly_cap_micros: 20_000_000 } })).toEqual({
      monthMicros: 900,
      capMicros: 20_000_000,
    });
    expect(asUsageSummary(null)).toEqual({ monthMicros: 0, capMicros: null });
  });

  it('reads a chat’s spend from its tokens, zero when there is none', () => {
    expect(chatCostMicros({ tokens: { cost_micros: 3_400 } })).toBe(3_400);
    expect(chatCostMicros({ tokens: null })).toBe(0);
    expect(chatCostMicros(null)).toBe(0);
  });
});
