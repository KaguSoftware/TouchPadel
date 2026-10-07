/**
 * Server-sent events, parsed by hand: the response body arrives in chunks that
 * end anywhere (mid-line, mid-JSON), so the parser takes the whole buffer so
 * far and hands back every COMPLETE event plus the unfinished tail to prepend
 * to the next chunk. The same parser the operator's `streamEdge` uses
 * (apps/operator/src/features/assistant/sse.ts); a copy, because the two apps
 * share no feature code, and the event table it reads is fixed by the edge
 * function (docs/design/assistant/build-contracts-2026-09-20.md, Lane C).
 *
 * PURE (vitest): no fetch, no react-native.
 */

export interface SseEvent {
  /** The `event:` name; 'message' when the block had none (the SSE default). */
  event: string;
  /** The `data:` lines joined with '\n', exactly as the server wrote them. */
  data: string;
}

/** Split `buffer` on blank lines. The last segment is `rest` unless the buffer ends with a blank line. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  // CRLF and lone CR are legal SSE line endings; one delimiter to look for.
  const text = buffer.replace(/\r\n?/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    const event = parseBlock(block);
    if (event) events.push(event);
  }
  return { events, rest };
}

function parseBlock(block: string): SseEvent | null {
  let name = '';
  const data: string[] = [];
  let sawField = false;
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // One optional space after the colon is not part of the value.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      name = value;
      sawField = true;
    } else if (field === 'data') {
      data.push(value);
      sawField = true;
    }
  }
  if (!sawField) return null;
  return { event: name || 'message', data: data.join('\n') };
}

/** JSON-parse an event's data, or return the raw string when it is not JSON. */
export function parseSseData(data: string): unknown {
  if (data === '') return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}
