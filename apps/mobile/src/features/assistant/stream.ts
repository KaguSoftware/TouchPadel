/**
 * Reading an SSE answer, and the rules around it (PURE, vitest): what counts
 * as "the owner stopped it", the stream that ends without `done` or `error`,
 * and the silence watchdog. `api.ts` hands this the response body's reader.
 */
import { parseSseChunk, parseSseData } from '@touch/core/assistant/sse';

/** No bytes at all for this long and the read is given up (the server sends a heartbeat every 15 s). */
export const SILENCE_MS = 45_000;

/** The connection failed under an answer: the stream ended without `done`/`error`, or went silent. */
export class StreamLostError extends Error {
  readonly reason: 'ended' | 'silent';
  constructor(reason: 'ended' | 'silent') {
    super(`the answer stream ${reason === 'ended' ? 'ended early' : 'went silent'}`);
    this.name = 'StreamLostError';
    this.reason = reason;
  }
}

/**
 * Did the owner stop it? Decided by the controller the Stop button aborts, never by the
 * error's name: expo/fetch rethrows a request cancelled before its headers as a
 * FetchError named 'Error'. Our own watchdog aborts a different, internal controller.
 */
export function ownerStopped(signal: AbortSignal | null | undefined): boolean {
  return signal?.aborted === true;
}

export interface ByteReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel?(): Promise<unknown> | unknown;
}

/** A reader over a body that arrived whole (no streaming body on this platform). */
export function textReader(text: string): ByteReader {
  let sent = false;
  const bytes = new TextEncoder().encode(text.endsWith('\n\n') ? text : `${text}\n\n`);
  return {
    read: async () => {
      if (sent) return { done: true };
      sent = true;
      return { value: bytes, done: false };
    },
  };
}

export interface ReadOptions {
  /** Aborts the underlying request (the internal controller). */
  abort?: () => void;
  silenceMs?: number;
}

/**
 * Hand every SSE event to `onEvent`, in order. Throws StreamLostError when the
 * body ends before a `done` or `error` event, or when nothing (not even a
 * heartbeat) arrives for `silenceMs`. A rejection from the reader (Stop) passes through.
 */
export async function readEvents(
  reader: ByteReader,
  onEvent: (name: string, data: unknown) => void,
  opts: ReadOptions = {},
): Promise<void> {
  let finished = false;
  const emit = (events: readonly { event: string; data: string }[]) => {
    for (const ev of events) {
      if (ev.event === 'done' || ev.event === 'error') finished = true;
      onEvent(ev.event, parseSseData(ev.data));
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectSilent: (e: StreamLostError) => void = () => {};
  const silent = new Promise<never>((_, rej) => {
    rejectSilent = rej;
  });
  silent.catch(() => {});
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        opts.abort?.();
        void Promise.resolve(reader.cancel?.()).catch(() => {});
      } catch {
        /* the guard's job is to reject below */
      }
      rejectSilent(new StreamLostError('silent'));
    }, opts.silenceMs ?? SILENCE_MS);
  };

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      arm();
      const pending = reader.read();
      pending.catch(() => {});
      const { value, done } = await Promise.race([pending, silent]);
      if (done) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      emit(parsed.events);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  // A last event the server did not end with a blank line.
  buffer += decoder.decode();
  if (buffer.trim() !== '') emit(parseSseChunk(`${buffer}\n\n`).events);
  if (!finished) throw new StreamLostError('ended');
}

/** An AbortController that also aborts when `outer` does; `abort()` here never touches `outer`. */
export function linkedController(outer: AbortSignal | undefined): AbortController {
  const ac = new AbortController();
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return ac;
}
