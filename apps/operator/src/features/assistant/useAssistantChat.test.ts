import { describe, expect, it } from 'vitest';
import { EdgeError } from '../../lib/edge';
import { errorCodeOf } from './useAssistantChat';

// The reducer's own tests live with it: packages/core/src/assistant/client.test.ts.
describe('errorCodeOf', () => {
  it('prefers the refusal body’s code over the HTTP class', () => {
    expect(errorCodeOf(new EdgeError(429, 'RATE_LIMITED', 'x', 'LLM_MONTHLY_CAP'))).toBe('LLM_MONTHLY_CAP');
    expect(errorCodeOf(new EdgeError(500, 'UPSTREAM', 'x', 'INTERNAL'))).toBe('INTERNAL');
    expect(errorCodeOf(new EdgeError(404, 'UNKNOWN', 'x', 'NOT_FOUND'))).toBe('NOT_FOUND');
  });

  it('falls back to the HTTP class, and to UNKNOWN for anything thrown that is not a refusal', () => {
    expect(errorCodeOf(new EdgeError(401, 'AUTH_REQUIRED', 'x'))).toBe('AUTH_REQUIRED');
    expect(errorCodeOf(new EdgeError(502, 'UPSTREAM', 'x', 'SOMETHING_NEW'))).toBe('UPSTREAM');
    expect(errorCodeOf(new TypeError('Failed to fetch'))).toBe('UNKNOWN');
  });
});
