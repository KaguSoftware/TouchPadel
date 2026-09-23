import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBroadcastHub, type BroadcastStatus, type RealtimeClient, type Subscriber } from './realtime';

/**
 * A client that behaves like realtime-js 2.112 where it matters: channels are
 * listed by topic and `channel()` returns a listed one, a channel that is
 * leaving ignores `subscribe()`, and `removeChannel` only unlists it once the
 * leave has been acknowledged (here: when the test says so).
 */
function fakeClient() {
  type Ch = {
    topic: string;
    leaving: boolean;
    handlers: ((m: { event: string; payload?: unknown }) => void)[];
    status?: (s: string) => void;
    on: (t: 'broadcast', f: { event: string }, cb: (m: { event: string; payload?: unknown }) => void) => Ch;
    subscribe: (cb: (s: string) => void) => Ch;
  };
  const listed: Ch[] = [];
  const created: Ch[] = [];
  const acks: (() => void)[] = [];
  const client: RealtimeClient = {
    channel(topic) {
      const existing = listed.find((c) => c.topic === topic);
      if (existing) return existing;
      const ch: Ch = {
        topic,
        leaving: false,
        handlers: [],
        on(_t, _f, cb) {
          ch.handlers.push(cb);
          return ch;
        },
        subscribe(cb) {
          if (ch.leaving || ch.status) return ch; // realtime-js: a no-op unless closed
          ch.status = cb;
          return ch;
        },
      };
      listed.push(ch);
      created.push(ch);
      return ch;
    },
    removeChannel(c) {
      const ch = c as Ch;
      ch.leaving = true;
      return new Promise((resolve) => {
        acks.push(() => {
          listed.splice(listed.indexOf(ch), 1);
          resolve('ok');
        });
      });
    },
  };
  return {
    client,
    created,
    ackLeaves: async () => {
      while (acks.length) acks.shift()!();
      await flush();
    },
    join: (ch: Ch) => ch.status?.('SUBSCRIBED'),
    send: (ch: Ch, event: string) => ch.handlers.forEach((h) => h({ event, payload: { event } })),
  };
}

// Microtasks only, so it also works under fake timers.
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function sub(events = ['*']) {
  const seen: string[] = [];
  const statuses: [BroadcastStatus, boolean][] = [];
  const s: Subscriber = {
    events: new Set(events),
    onMessage: (e) => seen.push(e),
    onStatus: (st, recovered) => statuses.push([st, recovered]),
  };
  return { s, seen, statuses };
}

describe('broadcast hub', () => {
  afterEach(() => void vi.useRealTimers());

  it('a remount on the same topic gets a live channel, not the one still leaving', async () => {
    const f = fakeClient();
    const hub = createBroadcastHub(f.client);
    const a = sub();
    const leaveA = hub.subscribe('courts', true, a.s);
    await flush();
    f.join(f.created[0]!);

    // The screen change: the old screen leaves, the new one joins in the same commit.
    leaveA();
    const b = sub();
    hub.subscribe('courts', true, b.s);
    await flush();
    // Nothing new yet: realtime-js would hand back the dying channel.
    expect(f.created).toHaveLength(1);

    await f.ackLeaves();
    expect(f.created).toHaveLength(2);
    f.join(f.created[1]!);
    f.send(f.created[1]!, 'slot_changed');
    expect(b.seen).toEqual(['slot_changed']);
    expect(b.statuses.at(-1)).toEqual(['live', false]);
  });

  it('two subscribers share one channel, and one leaving does not deafen the other', async () => {
    const f = fakeClient();
    const hub = createBroadcastHub(f.client);
    const a = sub();
    const b = sub(['waiter_call']);
    const leaveA = hub.subscribe('floor', true, a.s);
    hub.subscribe('floor', true, b.s);
    await flush();
    expect(f.created).toHaveLength(1);
    f.join(f.created[0]!);
    expect(b.statuses.at(-1)).toEqual(['live', false]);

    leaveA();
    f.send(f.created[0]!, 'waiter_call');
    f.send(f.created[0]!, 'other');
    expect(b.seen).toEqual(['waiter_call']);
    expect(a.seen).toEqual([]);
    expect(f.created[0]!.leaving).toBe(false);
  });

  it('reconnects after an error and reports the recovery so missed events are re-read', async () => {
    vi.useFakeTimers();
    const f = fakeClient();
    const hub = createBroadcastHub(f.client, () => 0);
    const a = sub();
    hub.subscribe('kds', true, a.s);
    await vi.advanceTimersByTimeAsync(0);
    f.join(f.created[0]!);
    f.created[0]!.status!('CHANNEL_ERROR');
    expect(a.statuses.at(-1)).toEqual(['disconnected', false]);

    await vi.advanceTimersByTimeAsync(4_000);
    await f.ackLeaves();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.created).toHaveLength(2);
    f.join(f.created[1]!);
    expect(a.statuses.at(-1)).toEqual(['live', true]);
  });

  it('removes the channel once the last subscriber leaves', async () => {
    const f = fakeClient();
    const hub = createBroadcastHub(f.client);
    const leave = hub.subscribe('menu', false, sub().s);
    await flush();
    leave();
    await flush();
    expect(f.created[0]!.leaving).toBe(true);
  });
});
