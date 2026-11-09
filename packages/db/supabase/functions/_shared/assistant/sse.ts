/**
 * Server-sent events, both directions (contracts "sse.ts"). The chat function
 * writes frames with `sseFrame`; the clients' parser,
 * packages/core/src/assistant/sse.ts, mirrors `parseSseChunk` here, and
 * tests/assistant-sse.test.ts round-trips the two. `sseStream` is the response
 * scaffold assistant-chat and assistant-free share.
 *
 * Frame: `event: <name>\ndata: <json>\n\n`. A heartbeat is a comment line,
 * `: keep-alive\n\n`, which every SSE parser ignores. Pure: no Deno.
 */

export const ASSISTANT_EVENTS = [
  'message_start',
  'delta',
  'tool_start',
  'tool_end',
  'sources',
  'gate',
  'usage',
  'job_estimate',
  'done',
  'error',
] as const;
export type AssistantEvent = (typeof ASSISTANT_EVENTS)[number];

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** One frame. `data` is JSON-encoded on one line (JSON never contains a raw newline). */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
}

/** A comment frame that keeps the connection warm without producing an event. */
export function sseHeartbeat(): string {
  return ': keep-alive\n\n';
}

/** An open event stream: the body to answer with and the writers into it. */
export interface SseStream<E extends string = string> {
  stream: ReadableStream<Uint8Array>;
  /** Raw text into the stream; a no-op once it is closed or the client left. */
  write(chunk: string): void;
  emit(event: E, data: unknown): void;
  /** Stops the heartbeat and closes the stream (a client that already left is fine). */
  close(): void;
}

/**
 * The stream both assistant functions answer with: a heartbeat comment every
 * `heartbeatMs` from the moment it opens, writes that turn into no-ops once
 * the client cancels (which also calls `onCancel`, the function's abort) or
 * the stream is closed, and a close that never throws.
 */
export function sseStream<E extends string = string>(o: { heartbeatMs: number; onCancel?: () => void }): SseStream<E> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      o.onCancel?.();
    },
  });
  const write = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };
  const emit = (event: E, data: unknown) => write(sseFrame(event, data));
  const heartbeat = setInterval(() => write(sseHeartbeat()), o.heartbeatMs);
  const close = () => {
    clearInterval(heartbeat);
    closed = true;
    try {
      // Assigned inside the stream's start() callback, so TS still sees the initial null here.
      (controller as ReadableStreamDefaultController<Uint8Array> | null)?.close();
    } catch {
      // already closed by the client
    }
  };
  return { stream, write, emit, close };
}

export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * Parse whatever has arrived so far. Complete frames come back as events;
 * the trailing partial frame (if any) is returned as `rest` to prepend to
 * the next chunk. Comment lines are dropped; multi-line `data:` joins with `\n`.
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames = normalized.split('\n\n');
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // not JSON: keep the raw string
    }
    events.push({ event, data });
  }
  return { events, rest };
}
