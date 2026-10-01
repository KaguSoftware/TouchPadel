import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_RECONNECT_MIN_MS,
  createResilientChannel,
  type ChannelStatus,
  type RealtimeChannelLike,
  type RealtimeClientLike,
} from './resilientChannel';

/** A fake realtime client: every channel records its handlers and its subscribe callback. */
class FakeChannel implements RealtimeChannelLike {
  handlers = new Map<string, (m: { event?: string; payload?: unknown }) => void>();
  status: ((state: string) => void) | null = null;
  removed = false;
  constructor(readonly topic: string) {}
  on(_type: 'broadcast', filter: { event: string }, cb: (m: { event?: string; payload?: unknown }) => void) {
    this.handlers.set(filter.event, cb);
    return this;
  }
  subscribe(cb: (state: string) => void) {
    this.status = cb;
    return this;
  }
  emit(event: string, payload: unknown) {
    this.handlers.get(event)?.({ event, payload });
  }
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const client: RealtimeClientLike = {
    channel: (topic) => {
      const ch = new FakeChannel(topic);
      channels.push(ch);
      return ch;
    },
    removeChannel: async (ch) => {
      (ch as FakeChannel).removed = true;
      return 'ok';
    },
  };
  return { client, channels };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createResilientChannel', () => {
  function setup() {
    const { client, channels } = fakeClient();
    const messages: [string, unknown][] = [];
    const recovered: string[] = [];
    const statuses: ChannelStatus[] = [];
    const beforeSubscribe = vi.fn();
    const ch = createResilientChannel(client, {
      topic: 'courts:v1',
      isPrivate: true,
      events: ['slot_changed'],
      onMessage: (e, p) => messages.push([e, p]),
      onRecover: (r) => recovered.push(r),
      onStatus: (s) => statuses.push(s),
      beforeSubscribe,
      random: () => 0,
    });
    return { ch, channels, messages, recovered, statuses, beforeSubscribe };
  }

  it('joins once, sets auth first, and delivers its events', async () => {
    const { ch, channels, messages, recovered, beforeSubscribe } = setup();
    await flush();
    expect(beforeSubscribe).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
    channels[0]!.status!('SUBSCRIBED');
    expect(ch.status()).toBe('live');
    channels[0]!.emit('slot_changed', { court_id: 'c1' });
    expect(messages).toEqual([['slot_changed', { court_id: 'c1' }]]);
    // The first join is not a recovery: the owner's first read is fresh.
    expect(recovered).toEqual([]);
  });

  it('rebuilds after an error and tells the owner it recovered', async () => {
    const { ch, channels, recovered, statuses, beforeSubscribe } = setup();
    await flush();
    channels[0]!.status!('SUBSCRIBED');
    channels[0]!.status!('CHANNEL_ERROR');
    expect(ch.status()).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS);
    expect(channels[0]!.removed).toBe(true);
    expect(channels).toHaveLength(2);
    expect(beforeSubscribe).toHaveBeenCalledTimes(2);
    channels[1]!.status!('SUBSCRIBED');
    expect(recovered).toEqual(['reconnected']);
    expect(statuses).toEqual(['live', 'disconnected', 'connecting', 'live']);
  });

  it('owes a recovery when the first join failed too', async () => {
    const { channels, recovered } = setup();
    await flush();
    channels[0]!.status!('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS);
    channels[1]!.status!('SUBSCRIBED');
    expect(recovered).toEqual(['reconnected']);
  });

  it('ignores a replaced channel', async () => {
    const { channels, messages } = setup();
    await flush();
    channels[0]!.status!('CLOSED');
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS);
    channels[0]!.emit('slot_changed', {});
    channels[0]!.status!('SUBSCRIBED');
    expect(messages).toEqual([]);
  });

  it('a channel realtime-js rejoined by itself is not rebuilt', async () => {
    const { channels, recovered } = setup();
    await flush();
    channels[0]!.status!('SUBSCRIBED');
    channels[0]!.status!('CHANNEL_ERROR');
    channels[0]!.status!('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS * 2);
    expect(channels).toHaveLength(1);
    expect(recovered).toEqual(['reconnected']);
  });

  it('resume() re-reads, and reconnects at once when down', async () => {
    const { ch, channels, recovered } = setup();
    await flush();
    channels[0]!.status!('SUBSCRIBED');
    ch.resume();
    expect(recovered).toEqual(['resumed']);
    expect(channels).toHaveLength(1); // live: nothing to rebuild

    channels[0]!.status!('CHANNEL_ERROR');
    ch.resume();
    await flush();
    expect(channels).toHaveLength(2); // no 4–7 s wait while the person is looking
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS * 2);
    expect(channels).toHaveLength(2); // the cancelled backoff does not fire a third
  });

  it('close() removes the channel and stops every retry', async () => {
    const { ch, channels, recovered } = setup();
    await flush();
    channels[0]!.status!('CHANNEL_ERROR');
    await ch.close();
    expect(channels[0]!.removed).toBe(true);
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS * 2);
    expect(channels).toHaveLength(1);
    ch.resume();
    expect(recovered).toEqual([]);
  });

  it('waits for a previous channel on the topic to finish leaving', async () => {
    const { client, channels } = fakeClient();
    let release!: () => void;
    const leaving = new Promise<void>((r) => (release = r));
    createResilientChannel(client, {
      topic: 'courts:v1',
      isPrivate: true,
      events: ['slot_changed'],
      onMessage: () => {},
      waitFor: leaving,
    });
    await flush();
    expect(channels).toHaveLength(0);
    release();
    await flush();
    expect(channels).toHaveLength(1);
  });
});
