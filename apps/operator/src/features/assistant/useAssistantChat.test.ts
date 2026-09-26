import { describe, expect, it } from 'vitest';
import { applyEvent, type LiveTurn } from './useAssistantChat';

function turn(): LiveTurn {
  return {
    conversationId: null,
    userText: 'How did the cafe do?',
    userMessageId: null,
    assistantMessageId: null,
    text: '',
    tools: [],
    scopes: null,
    model: null,
    gate: null,
    usage: null,
    jobEstimate: null,
    done: false,
    stopped: false,
    error: null,
  };
}

describe('applyEvent', () => {
  it('keeps the model message_start names, so the meter can say which model answered', () => {
    const t = applyEvent(turn(), 'message_start', { conversation_id: 'c1', user_message_id: 'u1', assistant_message_id: 'a1', scopes: ['cafe'], model: 'claude-sonnet-5' });
    expect(t.conversationId).toBe('c1');
    expect(t.model).toBe('claude-sonnet-5');
    expect(t.scopes).toEqual(['cafe']);
  });

  it('leaves the model alone when message_start omits it and lets usage confirm it', () => {
    const started = applyEvent({ ...turn(), model: 'claude-opus-5' }, 'message_start', { conversation_id: 'c1' });
    expect(started.model).toBe('claude-opus-5');
    const priced = applyEvent(started, 'usage', { input: 10, cache_write: 0, cache_read: 0, output: 5, cost_micros: 1, calls: 1, model: 'claude-sonnet-5' });
    expect(priced.model).toBe('claude-sonnet-5');
    expect(priced.usage?.model).toBe('claude-sonnet-5');
  });

  it('grows the text by deltas and withdraws it on a gate reset', () => {
    let t = applyEvent(turn(), 'delta', { text: 'Rev' });
    t = applyEvent(t, 'delta', { text: 'enue' });
    expect(t.text).toBe('Revenue');
    t = applyEvent(t, 'delta', { text: 'Sales', reset: true });
    expect(t.text).toBe('Sales');
  });
});
