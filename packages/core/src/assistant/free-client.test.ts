import { describe, expect, it } from 'vitest';
import { applyFreeEvent, freeRefusal, freeTurn, freeTurnsOf, type FreeLiveTurn } from './free-client';
import { parseSseChunk, parseSseData } from './sse';

const done = (id: number, question: string, text: string): FreeLiveTurn => ({
  ...freeTurn(id, question),
  text,
  done: true,
});

describe('applyFreeEvent', () => {
  it('folds a streamed answer', () => {
    const stream =
      'event: message_start\ndata: {"model":"m","free":true}\n\n' +
      'event: delta\ndata: {"text":"Open "}\n\n' +
      ': keep-alive\n\n' +
      'event: delta\ndata: {"text":"/staff-request"}\n\n' +
      'event: done\ndata: {"stop_reason":"end_turn"}\n\n';
    let turn = freeTurn(1, 'day off?');
    for (const ev of parseSseChunk(stream).events) turn = applyFreeEvent(turn, ev.event, parseSseData(ev.data));
    expect(turn).toMatchObject({ text: 'Open /staff-request', done: true, error: null });
  });

  it('keeps the first error and ends the turn', () => {
    let turn = applyFreeEvent(freeTurn(1, 'q'), 'error', { code: 'TIMEOUT', message: 'slow' });
    turn = applyFreeEvent(turn, 'done', { stop_reason: 'TIMEOUT' });
    expect(turn.error).toEqual({ code: 'TIMEOUT' });
    expect(turn.done).toBe(true);
    expect(applyFreeEvent(freeTurn(1, 'q'), 'error', { code: 'WHAT' }).error).toEqual({ code: 'UNKNOWN' });
  });
});

describe('freeTurnsOf', () => {
  it('sends back only finished, whole answers, in order', () => {
    const earlier: FreeLiveTurn[] = [
      done(1, 'q1', 'a1'),
      { ...done(2, 'q2', ''), error: { code: 'UPSTREAM' } },
      { ...done(3, 'q3', 'half'), stopped: true },
      freeTurn(4, 'still streaming'),
      done(5, 'q5', 'a5'),
    ];
    expect(freeTurnsOf(earlier)).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
      { role: 'user', text: 'q5' },
      { role: 'assistant', text: 'a5' },
    ]);
  });
});

describe('freeRefusal', () => {
  it('reads the body’s code, scope and wait', () => {
    expect(freeRefusal(429, { code: 'RATE_LIMITED', scope: 'minute', retry_after_s: 12.2 })).toEqual({
      code: 'RATE_LIMITED',
      scope: 'minute',
      retryAfterS: 13,
    });
    expect(freeRefusal(429, { code: 'RATE_LIMITED', scope: 'club' })).toEqual({ code: 'RATE_LIMITED', scope: 'club' });
    expect(freeRefusal(503, { code: 'NOT_CONFIGURED' })).toEqual({ code: 'NOT_CONFIGURED' });
  });

  it('falls back to the HTTP class', () => {
    expect(freeRefusal(401, null).code).toBe('AUTH_REQUIRED');
    expect(freeRefusal(403, 'no').code).toBe('FORBIDDEN');
    expect(freeRefusal(429, {}).code).toBe('RATE_LIMITED');
    expect(freeRefusal(503, {}).code).toBe('NOT_CONFIGURED');
    expect(freeRefusal(502, {}).code).toBe('UPSTREAM');
    expect(freeRefusal(400, {}).code).toBe('INVALID_REQUEST');
    expect(freeRefusal(418, {}).code).toBe('UNKNOWN');
  });
});
