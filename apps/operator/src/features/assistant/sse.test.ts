import { describe, expect, it } from 'vitest';
import { parseSseChunk, parseSseData } from './sse';

describe('parseSseChunk', () => {
  it('parses complete event/data blocks and returns the unfinished tail', () => {
    const buffer = 'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\nevent: don';
    const { events, rest } = parseSseChunk(buffer);
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"Hel"}' },
      { event: 'delta', data: '{"text":"lo"}' },
    ]);
    expect(rest).toBe('event: don');
  });

  it('completes the tail once the rest of the chunk arrives', () => {
    const first = parseSseChunk('event: done\ndata: {"message_id":"m1","stop_re');
    expect(first.events).toEqual([]);
    const second = parseSseChunk(`${first.rest}ason":"end_turn"}\n\n`);
    expect(second.events).toEqual([{ event: 'done', data: '{"message_id":"m1","stop_reason":"end_turn"}' }]);
    expect(second.rest).toBe('');
  });

  it('joins multi-line data, defaults the event name, skips comments and CRLF', () => {
    const { events, rest } = parseSseChunk(': keep-alive\r\n\r\ndata: a\r\ndata: b\r\n\r\nevent:tool_start\ndata:{"x":1}\n\n');
    expect(events).toEqual([
      { event: 'message', data: 'a\nb' },
      { event: 'tool_start', data: '{"x":1}' },
    ]);
    expect(rest).toBe('');
  });

  it('returns nothing for an empty buffer', () => {
    expect(parseSseChunk('')).toEqual({ events: [], rest: '' });
  });
});

describe('parseSseData', () => {
  it('parses JSON and falls back to the raw string', () => {
    expect(parseSseData('{"a":1}')).toEqual({ a: 1 });
    expect(parseSseData('not json')).toBe('not json');
    expect(parseSseData('')).toBeNull();
  });
});
