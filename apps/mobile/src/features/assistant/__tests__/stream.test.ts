import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SILENCE_MS, StreamLostError, ownerStopped, readEvents, textReader, type ByteReader } from '../stream';
import { isNearBottom } from '../stickToBottom';

const enc = (s: string) => new TextEncoder().encode(s);

function scripted(chunks: string[]): ByteReader {
  let i = 0;
  return { read: async () => (i < chunks.length ? { value: enc(chunks[i++]!), done: false } : { done: true }) };
}

describe('ownerStopped', () => {
  it('reads the controller, never the error’s name', () => {
    const ac = new AbortController();
    expect(ownerStopped(ac.signal)).toBe(false);
    ac.abort();
    // expo/fetch rethrows a cancelled start as a FetchError named 'Error'.
    expect(ownerStopped(ac.signal)).toBe(true);
    expect(ownerStopped(undefined)).toBe(false);
  });
});

describe('readEvents', () => {
  it('emits events in order and resolves after done', async () => {
    const seen: string[] = [];
    await readEvents(scripted(['event: delta\ndata: {"text":"a"}\n\nevent: do', 'ne\ndata: {}\n\n']), (n) => seen.push(n));
    expect(seen).toEqual(['delta', 'done']);
  });

  it('accepts an error event as an end', async () => {
    await expect(readEvents(scripted(['event: error\ndata: {"code":"UPSTREAM"}\n\n']), () => {})).resolves.toBeUndefined();
  });

  it('treats an end without done or error as a lost connection', async () => {
    await expect(readEvents(scripted(['event: delta\ndata: {"text":"a"}\n\n']), () => {})).rejects.toMatchObject({
      name: 'StreamLostError',
      reason: 'ended',
    });
  });

  it('reads a body that arrived whole', async () => {
    const seen: string[] = [];
    await readEvents(textReader('event: done\ndata: {}'), (n) => seen.push(n));
    expect(seen).toEqual(['done']);
  });

  it('passes a reader rejection through (the owner’s Stop)', async () => {
    const reader: ByteReader = { read: () => Promise.reject(new Error('aborted')) };
    await expect(readEvents(reader, () => {})).rejects.toThrow('aborted');
  });
});

describe('the silence watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('aborts the read after 45 s with no bytes', async () => {
    const abort = vi.fn();
    const cancel = vi.fn(() => Promise.resolve());
    const reader: ByteReader = { read: () => new Promise(() => {}), cancel };
    const p = readEvents(reader, () => {}, { abort });
    const assertion = expect(p).rejects.toBeInstanceOf(StreamLostError);
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('is reset by any bytes, a heartbeat comment included', async () => {
    let resolve: ((v: { value?: Uint8Array; done: boolean }) => void) | null = null;
    const reader: ByteReader = {
      read: () =>
        new Promise((r) => {
          resolve = r;
        }),
    };
    const abort = vi.fn();
    const p = readEvents(reader, () => {}, { abort });
    const assertion = expect(p).rejects.toMatchObject({ reason: 'silent' });
    await vi.advanceTimersByTimeAsync(40_000);
    resolve!({ value: enc(': heartbeat\n\n'), done: false });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe('isNearBottom', () => {
  it('follows only within the slack of the end', () => {
    expect(isNearBottom({ offsetY: 500, viewHeight: 500, contentHeight: 1000 })).toBe(true);
    expect(isNearBottom({ offsetY: 460, viewHeight: 500, contentHeight: 1000 })).toBe(true);
    expect(isNearBottom({ offsetY: 300, viewHeight: 500, contentHeight: 1000 })).toBe(false);
  });
});
