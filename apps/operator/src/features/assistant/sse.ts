/**
 * Server-sent events, parsed by hand (build-contracts §Lane D). `streamEdge`
 * reads the response body in chunks that end anywhere — mid-line, mid-JSON —
 * so the parser takes the whole buffer so far and hands back every COMPLETE
 * event plus the unfinished tail to prepend to the next chunk.
 *
 * Pure: no DOM, no fetch, so vitest runs it under node.
 */

export interface SseEvent {
  /** The `event:` name; 'message' when the block had none (the SSE default). */
  event: string;
  /** The `data:` lines joined with '\n', exactly as the server wrote them. */
  data: string;
}

/**
 * Split `buffer` on blank lines into events. The final segment is only an
 * event when the buffer ends with a blank line; otherwise it is `rest`.
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  // CRLF and lone CR are legal SSE line endings; normalise once so the split
  // below has one delimiter to look for.
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
    // `id:` and `retry:` are ignored: the edge function never sends them.
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
