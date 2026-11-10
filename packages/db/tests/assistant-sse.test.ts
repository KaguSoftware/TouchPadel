/**
 * SSE frames (_shared/assistant/sse.ts): what assistant-chat writes must come
 * back unchanged through the parser the operator mirrors, whatever the chunk
 * boundaries the network picks.
 */
import { describe, expect, it } from 'vitest';
import { ASSISTANT_EVENTS, parseSseChunk, sseFrame, sseHeartbeat, sseStream } from '../supabase/functions/_shared/assistant/sse.ts';

describe('sseFrame / parseSseChunk', () => {
  it('encodes one frame per event with JSON data', () => {
    expect(sseFrame('delta', { text: 'hi' })).toBe('event: delta\ndata: {"text":"hi"}\n\n');
    expect(sseFrame('done', undefined)).toBe('event: done\ndata: null\n\n');
  });

  it('round-trips every event name with a payload that has newlines and unicode', () => {
    const payloads = ASSISTANT_EVENTS.map((e, i) => [e, { i, text: `line\nbreak ${e} ١٢٣ 🎾`, nested: { ok: true } }] as const);
    const wire = payloads.map(([e, d]) => sseFrame(e, d)).join('');
    const { events, rest } = parseSseChunk(wire);
    expect(rest).toBe('');
    expect(events.map((x) => x.event)).toEqual([...ASSISTANT_EVENTS]);
    events.forEach((ev, i) => expect(ev.data).toEqual(payloads[i]![1]));
  });

  it('keeps a partial trailing frame as rest and completes it on the next chunk', () => {
    const wire = sseFrame('delta', { text: 'a' }) + sseFrame('delta', { text: 'b' });
    const cut = wire.length - 7;
    const first = parseSseChunk(wire.slice(0, cut));
    expect(first.events).toHaveLength(1);
    expect(first.rest.length).toBeGreaterThan(0);
    const second = parseSseChunk(first.rest + wire.slice(cut));
    expect(second.events).toEqual([{ event: 'delta', data: { text: 'b' } }]);
    expect(second.rest).toBe('');
  });

  it('ignores heartbeat comments and tolerates CRLF', () => {
    const wire = sseHeartbeat() + sseFrame('usage', { input: 1 }).replace(/\n/g, '\r\n') + sseHeartbeat();
    const { events, rest } = parseSseChunk(wire);
    expect(events).toEqual([{ event: 'usage', data: { input: 1 } }]);
    expect(rest).toBe('');
  });

  it('keeps non-JSON data as a string and defaults the event name', () => {
    const { events } = parseSseChunk('data: plain text\n\n');
    expect(events).toEqual([{ event: 'message', data: 'plain text' }]);
  });
});

describe('sseStream (the scaffold assistant-chat and assistant-free share)', () => {
  async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let out = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return out;
      out += dec.decode(value, { stream: true });
    }
  }

  it('writes frames until closed, then nothing; close twice is harmless', async () => {
    const sse = sseStream({ heartbeatMs: 60_000 });
    sse.emit('delta', { text: 'a' });
    sse.emit('done', { stop_reason: 'end_turn' });
    sse.close();
    sse.emit('delta', { text: 'late' });
    sse.close();
    const { events, rest } = parseSseChunk(await drain(sse.stream));
    expect(events).toEqual([
      { event: 'delta', data: { text: 'a' } },
      { event: 'done', data: { stop_reason: 'end_turn' } },
    ]);
    expect(rest).toBe('');
  });

  it('a client that cancels calls onCancel and turns writes into no-ops', async () => {
    let cancelled = 0;
    const sse = sseStream({ heartbeatMs: 60_000, onCancel: () => cancelled++ });
    await sse.stream.cancel();
    expect(cancelled).toBe(1);
    expect(() => sse.emit('delta', { text: 'x' })).not.toThrow();
    sse.close();
  });
});
