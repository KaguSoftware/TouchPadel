import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_ERROR_CODES,
  applyEvent,
  asAssistantErrorCode,
  asModelsPayload,
  assistantErrorSentence,
  bodyCode,
  emptyTurn,
  refusalCode,
  sourcesOf,
  textOfContent,
  type LiveTurn,
} from './client';

function fold(events: [string, unknown][], start: LiveTurn = emptyTurn(null, 'q')): LiveTurn {
  return events.reduce((turn, [name, data]) => applyEvent(turn, name, data), start);
}

describe('applyEvent', () => {
  it('keeps what message_start names: ids, scopes and the model the meter shows', () => {
    const t = applyEvent(emptyTurn(null, 'How did the cafe do?'), 'message_start', {
      conversation_id: 'c1',
      user_message_id: 'u1',
      assistant_message_id: 'a1',
      scopes: ['cafe', 3],
      model: 'claude-sonnet-5',
    });
    expect(t.conversationId).toBe('c1');
    expect(t.userMessageId).toBe('u1');
    expect(t.assistantMessageId).toBe('a1');
    expect(t.model).toBe('claude-sonnet-5');
    expect(t.scopes).toEqual(['cafe']);
  });

  it('leaves the model alone when message_start omits it and lets usage confirm it', () => {
    const started = applyEvent({ ...emptyTurn(null, 'q'), model: 'claude-opus-5' }, 'message_start', { conversation_id: 'c1' });
    expect(started.model).toBe('claude-opus-5');
    const priced = applyEvent(started, 'usage', { input: 10, cache_write: 0, cache_read: 0, output: 5, cost_micros: 1, calls: 1, model: 'claude-sonnet-5' });
    expect(priced.model).toBe('claude-sonnet-5');
    expect(priced.usage?.model).toBe('claude-sonnet-5');
    expect(priced.usage?.cost_micros).toBe(1);
  });

  it('grows the text by deltas and withdraws it on a gate reset', () => {
    let t = applyEvent(emptyTurn(null, 'q'), 'delta', { text: 'Rev' });
    t = applyEvent(t, 'delta', { text: 'enue' });
    expect(t.text).toBe('Revenue');
    t = applyEvent(t, 'delta', { text: 'Sales', reset: true });
    expect(t.text).toBe('Sales');
  });

  it('grows the answer, tracks a tool and closes on done', () => {
    const turn = fold([
      ['message_start', { conversation_id: 'c1', assistant_message_id: 'm1' }],
      ['tool_start', { call_id: 't1', name: 'panel_headline', args: {} }],
      ['tool_end', { call_id: 't1', name: 'panel_headline', row_count: 3, ms: 40, route: null, stats: { sum: 9 } }],
      ['delta', { text: 'Sales were ' }],
      ['delta', { text: '1,250,000 IQD.' }],
      ['done', { message_id: 'm1', stop_reason: 'end_turn' }],
    ]);
    expect(turn.conversationId).toBe('c1');
    expect(turn.text).toBe('Sales were 1,250,000 IQD.');
    expect(turn.tools).toEqual([expect.objectContaining({ call_id: 't1', pending: false, row_count: 3, stats: { sum: 9 } })]);
    expect(turn.done).toBe(true);
    expect(turn.assistantMessageId).toBe('m1');
    expect(turn.stopReason).toBe('end_turn');
  });

  it('keeps the done event’s stop_reason, and none before done', () => {
    expect(emptyTurn(null, 'q').stopReason).toBeNull();
    expect(fold([['done', { message_id: 'm1', stop_reason: 'max_tokens' }]]).stopReason).toBe('max_tokens');
    expect(fold([['done', { message_id: 'm1' }]]).stopReason).toBeNull();
    const failed = fold([
      ['error', { code: 'TIMEOUT', message: 'x' }],
      ['done', { message_id: 'm1', stop_reason: 'TIMEOUT' }],
    ]);
    expect(failed.error?.code).toBe('TIMEOUT');
    expect(failed.stopReason).toBe('TIMEOUT');
  });

  it('adds a row for a tool_end whose start never arrived', () => {
    const turn = fold([['tool_end', { call_id: 't9', name: 'x', row_count: 1, ms: 2, route: '/stock' }]]);
    expect(turn.tools).toEqual([expect.objectContaining({ call_id: 't9', name: 'x', args: {}, route: '/stock', pending: false })]);
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

  it('maps an unknown error code to UNKNOWN and keeps a job estimate', () => {
    expect(fold([['error', { code: 'WAT' }]]).error?.code).toBe('UNKNOWN');
    expect(fold([['job_estimate', { job_id: 'j', rows: 10 }]]).jobEstimate).toEqual(expect.objectContaining({ job_id: 'j', rows: 10 }));
  });

  it('lets the sources summary close a tool whose end never arrived, and keep its scopes', () => {
    const turn = fold([
      ['tool_start', { call_id: 't1', name: 'x', args: {} }],
      ['sources', { items: [{ call_id: 't1', name: 'x', args: {}, row_count: 2, ms: 5, route: null }], scopes: ['money'] }],
    ]);
    expect(turn.tools).toEqual([expect.objectContaining({ pending: false, row_count: 2 })]);
    expect(turn.scopes).toEqual(['money']);
  });

  it('keeps the gate marks and ignores an event it does not know', () => {
    const gate = { status: 'unverified', unverified: [{ raw: '99', value: 99 }], checked: 4 };
    const turn = fold([['gate', gate], ['heartbeat', {}]]);
    expect(turn.gate).toEqual(gate);
  });
});

describe('error codes', () => {
  it('distinguishes the server’s NOT_FOUND, INTERNAL and INVALID_TRANSITION', () => {
    for (const code of ['NOT_FOUND', 'INTERNAL', 'INVALID_TRANSITION'] as const) {
      expect(asAssistantErrorCode(code)).toBe(code);
      expect(fold([['error', { code }]]).error?.code).toBe(code);
    }
    expect(asAssistantErrorCode('METHOD_NOT_ALLOWED')).toBe('UNKNOWN');
    expect(asAssistantErrorCode(42)).toBe('UNKNOWN');
  });

  it('words those three with the generic sentence and every other code with its own', () => {
    expect(assistantErrorSentence('NOT_FOUND')).toBe('UNKNOWN');
    expect(assistantErrorSentence('INTERNAL')).toBe('UNKNOWN');
    expect(assistantErrorSentence('INVALID_TRANSITION')).toBe('UNKNOWN');
    for (const code of ASSISTANT_ERROR_CODES) {
      if (code === 'NOT_FOUND' || code === 'INTERNAL' || code === 'INVALID_TRANSITION') continue;
      expect(assistantErrorSentence(code)).toBe(code);
    }
  });

  it('reads a refusal body’s code, or an upper-snake error', () => {
    expect(bodyCode({ code: 'X', error: 'Y' })).toBe('X');
    expect(bodyCode({ error: 'LLM_DAILY_QUOTA' })).toBe('LLM_DAILY_QUOTA');
    expect(bodyCode({ error: 'POST only' })).toBeUndefined();
    expect(bodyCode('nope')).toBeUndefined();
  });

  it('prefers the body code, then the HTTP class', () => {
    expect(refusalCode(429, { code: 'LLM_MONTHLY_CAP' })).toBe('LLM_MONTHLY_CAP');
    expect(refusalCode(429, { error: 'LLM_DAILY_QUOTA' })).toBe('LLM_DAILY_QUOTA');
    expect(refusalCode(401, null)).toBe('AUTH_REQUIRED');
    expect(refusalCode(403, {})).toBe('FORBIDDEN');
    expect(refusalCode(429, { message: 'slow' })).toBe('RATE_LIMITED');
    expect(refusalCode(503, { code: 'NOT_CONFIGURED' })).toBe('NOT_CONFIGURED');
    expect(refusalCode(502, null)).toBe('UPSTREAM');
    expect(refusalCode(500, { error: 'INTERNAL', code: 'INTERNAL' })).toBe('INTERNAL');
    expect(refusalCode(404, { error: 'NOT_FOUND', code: 'NOT_FOUND' })).toBe('NOT_FOUND');
    expect(refusalCode(400, null)).toBe('UNKNOWN');
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
    expect(textOfContent({ text: 'flat' })).toBe('flat');
    expect(textOfContent(null)).toBe('');
  });

  it('reads sources in either saved shape and notices a job', () => {
    const item = { call_id: 'a', name: 'tool', args: {}, row_count: 1, ms: 2, route: null };
    expect(sourcesOf([item, { job_id: 'j' }, 'junk'])).toEqual({ items: [item], scopes: [], jobIds: ['j'] });
    expect(sourcesOf({ items: [item], scopes: ['money'] })).toEqual({ items: [item], scopes: ['money'], jobIds: [] });
    expect(sourcesOf(null)).toEqual({ items: [], scopes: [], jobIds: [] });
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
});
