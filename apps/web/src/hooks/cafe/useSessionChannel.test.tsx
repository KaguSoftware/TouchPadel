import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { CHANNEL_RECONNECT_MAX_MS } from '@touch/core';
import type { BrowserSupabase } from '@/lib/supabase/client';
import { useSessionChannel, type SessionChannelHandlers } from './useSessionChannel';

/**
 * The guest session channel recovers by itself and says when events may have
 * been missed — it had no recovery, so a phone that slept kept a stale order
 * status until the page was reloaded.
 */
class FakeChannel {
  handlers = new Map<string, (m: { event?: string; payload?: unknown }) => void>();
  status: ((s: string) => void) | null = null;
  removed = false;
  constructor(readonly topic: string) {}
  on(_t: string, f: { event: string }, cb: (m: { event?: string; payload?: unknown }) => void) {
    this.handlers.set(f.event, cb);
    return this;
  }
  subscribe(cb: (s: string) => void) {
    this.status = cb;
    return this;
  }
}

function fakeSupabase() {
  const channels: FakeChannel[] = [];
  const setAuth = vi.fn(async () => {});
  const client = {
    channel: (topic: string) => {
      const ch = new FakeChannel(topic);
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(async (ch: FakeChannel) => {
      ch.removed = true;
      return 'ok';
    }),
    realtime: { setAuth },
  };
  return { supabase: client as unknown as BrowserSupabase, channels, setAuth, client };
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionChannel', () => {
  function mount() {
    const fake = fakeSupabase();
    const handlers: Required<SessionChannelHandlers> = {
      onOrderStatus: vi.fn(),
      onWaiterCallStatus: vi.fn(),
      onRecover: vi.fn(),
    };
    const hook = renderHook(() => useSessionChannel(fake.supabase, 'sess-1', handlers));
    return { ...fake, handlers, hook };
  }

  it('authorises, joins session:{id} and fans its two events out', async () => {
    const { channels, setAuth, handlers, hook } = mount();
    await flush();
    expect(setAuth).toHaveBeenCalledTimes(1);
    expect(channels.map((c) => c.topic)).toEqual(['session:sess-1']);
    act(() => channels[0]!.status!('SUBSCRIBED'));
    expect(hook.result.current.connected).toBe(true);

    channels[0]!.handlers.get('order_status')!({ event: 'order_status', payload: { order_id: 'o1', status: 'ready' } });
    channels[0]!.handlers.get('waiter_call_status')!({ event: 'waiter_call_status', payload: { call_id: 'c1', status: 'acknowledged' } });
    expect(handlers.onOrderStatus).toHaveBeenCalledWith({ order_id: 'o1', status: 'ready' });
    expect(handlers.onWaiterCallStatus).toHaveBeenCalledWith({ call_id: 'c1', status: 'acknowledged' });
    expect(handlers.onRecover).not.toHaveBeenCalled();
  });

  it('rebuilds a dropped channel, re-authorises, and asks for a re-read once live again', async () => {
    const { channels, setAuth, handlers, hook } = mount();
    await flush();
    act(() => channels[0]!.status!('SUBSCRIBED'));
    act(() => channels[0]!.status!('CHANNEL_ERROR'));
    expect(hook.result.current.connected).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(CHANNEL_RECONNECT_MAX_MS));
    expect(channels[0]!.removed).toBe(true);
    expect(channels).toHaveLength(2);
    expect(setAuth).toHaveBeenCalledTimes(2);
    act(() => channels[1]!.status!('SUBSCRIBED'));
    expect(hook.result.current.connected).toBe(true);
    expect(handlers.onRecover).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the tab becomes visible or the network returns', async () => {
    const { channels, handlers } = mount();
    await flush();
    act(() => channels[0]!.status!('SUBSCRIBED'));
    act(() => setVisibility('hidden'));
    expect(handlers.onRecover).not.toHaveBeenCalled();
    act(() => setVisibility('visible'));
    expect(handlers.onRecover).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(handlers.onRecover).toHaveBeenCalledTimes(2);
  });

  it('leaves the channel and stops listening on unmount', async () => {
    const { channels, client, handlers, hook } = mount();
    await flush();
    hook.unmount();
    await flush();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(channels[0]!.removed).toBe(true);
    act(() => setVisibility('visible'));
    expect(handlers.onRecover).not.toHaveBeenCalled();
  });

  it('does nothing without a client or a session', () => {
    const { result } = renderHook(() => useSessionChannel(null, 'sess-1', {}));
    expect(result.current.connected).toBe(false);
  });
});
