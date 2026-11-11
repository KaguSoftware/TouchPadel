import { describe, expect, it } from 'vitest';
import { RequestTimeoutError } from '@touch/core';
import { EdgeError, StreamStalledError } from '../../lib/edge';
import { errorCodeOf } from './useAssistantChat';

// The reducer's own tests live with it: packages/core/src/assistant/client.test.ts.
describe('errorCodeOf', () => {
  it('prefers the refusal body’s code over the HTTP class', () => {
    expect(errorCodeOf(new EdgeError(429, 'RATE_LIMITED', 'x', 'LLM_MONTHLY_CAP'))).toBe('LLM_MONTHLY_CAP');
    expect(errorCodeOf(new EdgeError(500, 'UPSTREAM', 'x', 'INTERNAL'))).toBe('INTERNAL');
    expect(errorCodeOf(new EdgeError(404, 'UNKNOWN', 'x', 'NOT_FOUND'))).toBe('NOT_FOUND');
  });

  it('falls back to the HTTP class; a network failure, a silent stream or a deadline is the connection', () => {
    expect(errorCodeOf(new EdgeError(401, 'AUTH_REQUIRED', 'x'))).toBe('AUTH_REQUIRED');
    expect(errorCodeOf(new EdgeError(502, 'UPSTREAM', 'x', 'SOMETHING_NEW'))).toBe('UPSTREAM');
    expect(errorCodeOf(new TypeError('Failed to fetch'))).toBe('CONNECTION');
    expect(errorCodeOf(new StreamStalledError(45_000))).toBe('CONNECTION');
    expect(errorCodeOf(new RequestTimeoutError(1, 'assistant-chat'))).toBe('CONNECTION');
    expect(errorCodeOf(new Error('something else'))).toBe('UNKNOWN');
  });
});
