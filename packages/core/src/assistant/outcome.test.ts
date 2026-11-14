import { describe, expect, it } from 'vitest';
import { outcomeText, turnOutcome } from './outcome';

describe('turnOutcome', () => {
  it('reads a finished answer as ok', () => {
    expect(turnOutcome({ stop_reason: 'end_turn' }, 'Courts held up.')).toEqual({ kind: 'ok' });
  });

  it('reads a row stored before the fields existed as ok', () => {
    expect(turnOutcome({ cost_micros: 12 }, 'Courts held up.')).toEqual({ kind: 'ok' });
    expect(turnOutcome(null, 'Courts held up.')).toEqual({ kind: 'ok' });
  });

  it('keeps the server-closed endings as ok: their text already says why', () => {
    expect(turnOutcome({ stop_reason: 'cost_capped' }, 'x')).toEqual({ kind: 'ok' });
    expect(turnOutcome({ stop_reason: 'rounds_exhausted' }, 'x')).toEqual({ kind: 'ok' });
  });

  it('names a stop, a cut-short answer, a refusal and a job proposal', () => {
    expect(turnOutcome({ stop_reason: 'stopped' }, 'Half an ans')).toEqual({ kind: 'stopped' });
    expect(turnOutcome({ stop_reason: 'max_tokens' }, '| a | b |')).toEqual({ kind: 'cut_short' });
    expect(turnOutcome({ stop_reason: 'refusal' }, '')).toEqual({ kind: 'refused' });
    expect(turnOutcome({ stop_reason: 'job_proposed' }, '')).toEqual({ kind: 'job_proposed' });
  });

  it('puts a failure first, whatever the stop reason says', () => {
    expect(turnOutcome({ stop_reason: 'end_turn', error_code: 'TIMEOUT' }, 'Half an ans')).toEqual({ kind: 'error', code: 'TIMEOUT' });
  });

  it('ignores an error code it does not know', () => {
    expect(turnOutcome({ error_code: 'WHATEVER' }, 'An answer.')).toEqual({ kind: 'ok' });
  });

  it('reads the placeholder older rows stored for a failed turn', () => {
    expect(turnOutcome({}, '[TIMEOUT] the turn did not finish inside 50 s')).toEqual({ kind: 'error', code: 'TIMEOUT' });
    expect(turnOutcome({}, '[UPSTREAM] the model call failed')).toEqual({ kind: 'error', code: 'UPSTREAM' });
  });

  it('does not mistake an answer that merely starts with a bracket', () => {
    expect(turnOutcome({}, '[TIMEOUT] is the code you saw.\nIt means the turn ran out of time.')).toEqual({ kind: 'ok' });
    expect(turnOutcome({}, '[1] Cafe is down.')).toEqual({ kind: 'ok' });
  });
});

describe('outcomeText', () => {
  it('hides the old failure placeholder and keeps everything else', () => {
    expect(outcomeText('[TIMEOUT] the turn did not finish inside 50 s')).toBe('');
    expect(outcomeText('Courts held up.')).toBe('Courts held up.');
  });
});
