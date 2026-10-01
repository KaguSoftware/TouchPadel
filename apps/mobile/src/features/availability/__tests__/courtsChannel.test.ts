import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_RECONNECT_MIN_MS, type RealtimeChannelLike, type RealtimeClientLike } from '@touch/core';
import { createCourtsChannels } from '../courtsChannel';

/** A fake realtime client in the shape supabase-js gives the hook. */
class FakeChannel implements RealtimeChannelLike {
  handlers = new Map<string, (m: { event?: string; payload?: unknown }) => void>();
  status: ((s: string) => void) | null = null;
  removed = false;
  constructor(readonly topic: string) {}
  on(_t: 'broadcast', f: { event: string }, cb: (m: { event?: string; payload?: unknown }) => void) {
    this.handlers.set(f.event, cb);
    return this;
  }
  subscribe(cb: (s: string) => void) {
    this.status = cb;
    return this;
  }
}

function setup() {
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
  const setAuth = vi.fn();
  let foreground: (() => void) | null = null;
  const stopForeground = vi.fn();
  const courts = createCourtsChannels({
    client,
    setAuth,
    onForeground: (cb) => {
      foreground = cb;
      return stopForeground;
    },
    random: () => 0,
  });
  return { courts, channels, setAuth, stopForeground, foreground: () => foreground?.() };
}

const listener = () => ({ onSlot: vi.fn(), onRecover: vi.fn() });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createCourtsChannels', () => {
  it('a token refresh updates the token in place and never rebuilds the channel', async () => {
    const { courts, channels, setAuth } = setup();
    const l = listener();
    courts.join('courts:v1', 'jwt-1', l);
    await flush();
    channels[0]!.status!('SUBSCRIBED');
    expect(setAuth).toHaveBeenCalledWith('jwt-1');

    courts.setToken('jwt-2'); // TOKEN_REFRESHED
    await flush();
    expect(setAuth).toHaveBeenLastCalledWith('jwt-2');
    expect(channels).toHaveLength(1);
    expect(channels[0]!.removed).toBe(false);

    channels[0]!.handlers.get('slot_changed')!({ event: 'slot_changed', payload: {} });
    expect(l.onSlot).toHaveBeenCalledTimes(1);
  });

  it('a dropped channel comes back with the newest token, and every consumer re-reads', async () => {
    const { courts, channels, setAuth } = setup();
    const a = listener();
    const b = listener();
    courts.join('courts:v1', 'jwt-1', a);
    courts.join('courts:v1', 'jwt-1', b);
    await flush();
    expect(channels).toHaveLength(1); // one shared subscription
    channels[0]!.status!('SUBSCRIBED');
    courts.setToken('jwt-2');
    channels[0]!.status!('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MIN_MS);
    expect(channels).toHaveLength(2);
    expect(setAuth).toHaveBeenLastCalledWith('jwt-2');
    channels[1]!.status!('SUBSCRIBED');
    expect(a.onRecover).toHaveBeenCalledTimes(1);
    expect(b.onRecover).toHaveBeenCalledTimes(1);
  });

  it('returning to the app re-reads, and rejoins at once when the channel is down', async () => {
    const { courts, channels, foreground } = setup();
    const l = listener();
    courts.join('courts:v1', 'jwt-1', l);
    await flush();
    channels[0]!.status!('SUBSCRIBED');
    foreground();
    expect(l.onRecover).toHaveBeenCalledTimes(1);
    channels[0]!.status!('TIMED_OUT');
    foreground();
    await flush();
    expect(channels).toHaveLength(2);
  });

  it('the last consumer out removes the channel; the next join waits for it to leave', async () => {
    const { courts, channels, stopForeground } = setup();
    const a = listener();
    const b = listener();
    const leaveA = courts.join('courts:v1', 'jwt-1', a);
    const leaveB = courts.join('courts:v1', 'jwt-1', b);
    await flush();
    leaveA();
    expect(channels[0]!.removed).toBe(false); // b still listens
    leaveB();
    expect(stopForeground).toHaveBeenCalledTimes(1);
    expect(courts.size()).toBe(0);
    courts.join('courts:v1', 'jwt-1', listener());
    await flush();
    expect(channels[0]!.removed).toBe(true);
    expect(channels).toHaveLength(2);
  });
});
