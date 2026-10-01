/**
 * The per-branch 'courts:<venue>' broadcast channels, shared by every mounted
 * consumer (features/availability/hooks.ts useCourtsBroadcast).
 *
 * One resilient channel per topic (@touch/core net/resilientChannel.ts, the
 * operator hub's model), reference counted:
 *
 *   - Recovery. A CHANNEL_ERROR / TIMED_OUT used to be logged and nothing more:
 *     the grid stayed quietly stale behind the 60 s poll. Now the channel is
 *     rebuilt after a short jittered delay and, once it is live again, every
 *     consumer re-reads (`onRecover`) what it may have missed.
 *   - Foreground. Events broadcast while the phone slept are gone; coming back
 *     to the app re-reads and, if the channel is down, rejoins at once.
 *   - Token rotation. The channel used to be torn down and rebuilt on every
 *     access-token refresh (hourly, and on every foreground), dropping any
 *     event sent in the gap. supabase-js pushes a new token to joined
 *     channels in place (`realtime.setAuth`), so a rotation now only updates
 *     the token; the channel stays.
 *   - Sharing. supabase-js hands back the SAME channel object for a topic that
 *     already exists and `removeChannel` removes it for everyone, so two
 *     mounted consumers share one subscription, and the last one out removes
 *     it. A new channel on a topic waits for the previous one to finish
 *     leaving (realtime-js would hand back the leaving one, which never joins).
 *
 * Pure: the realtime client, the auth setter and the foreground signal are
 * injected, so this is unit-tested under node.
 */
import {
  createResilientChannel,
  type ChannelStatus,
  type RealtimeClientLike,
  type ResilientChannel,
} from '@touch/core';

export interface CourtsListener {
  /** A slot was taken or freed. */
  onSlot(): void;
  /** The channel came back, or the app returned to the foreground: re-read. */
  onRecover(): void;
}

export interface CourtsChannelDeps {
  client: RealtimeClientLike;
  /** `supabase.realtime.setAuth(token)`: the private topic is authorised by it. */
  setAuth(token: string): unknown;
  /** Subscribe to "the app came back to the foreground"; returns the unsubscribe. */
  onForeground(cb: () => void): () => void;
  onStatus?(topic: string, status: ChannelStatus): void;
  random?: () => number;
}

interface Shared {
  channel: ResilientChannel;
  listeners: Set<CourtsListener>;
  stopForeground: () => void;
}

export interface CourtsChannels {
  /** Join `topic` with the current access token; returns the leave. */
  join(topic: string, token: string, listener: CourtsListener): () => void;
  /** A rotated access token: updated in place, no channel is rebuilt. */
  setToken(token: string): void;
  /** How many topics have a live channel (tests). */
  size(): number;
}

export function createCourtsChannels(deps: CourtsChannelDeps): CourtsChannels {
  const shared = new Map<string, Shared>();
  /** Topics whose last channel is still leaving. */
  const leaving = new Map<string, Promise<unknown>>();
  let token: string | null = null;

  const setToken = (next: string) => {
    if (next === token) return;
    token = next;
    deps.setAuth(next);
  };

  function join(topic: string, current: string, listener: CourtsListener): () => void {
    setToken(current);
    let entry = shared.get(topic);
    if (!entry) {
      const listeners = new Set<CourtsListener>();
      const channel = createResilientChannel(deps.client, {
        topic,
        isPrivate: true,
        events: ['slot_changed'],
        onMessage: () => {
          for (const l of [...listeners]) l.onSlot();
        },
        onRecover: () => {
          for (const l of [...listeners]) l.onRecover();
        },
        onStatus: (s) => deps.onStatus?.(topic, s),
        // Every (re)join carries the newest token, not the one this channel was born with.
        beforeSubscribe: () => (token ? deps.setAuth(token) : undefined),
        waitFor: leaving.get(topic),
        random: deps.random,
      });
      const stopForeground = deps.onForeground(() => channel.resume());
      entry = { channel, listeners, stopForeground };
      shared.set(topic, entry);
    }
    entry.listeners.add(listener);
    const mine = entry;
    return () => {
      if (!mine.listeners.delete(listener) || mine.listeners.size > 0) return;
      mine.stopForeground();
      if (shared.get(topic) === mine) shared.delete(topic);
      const done = mine.channel.close();
      leaving.set(topic, done);
      void done.then(() => {
        if (leaving.get(topic) === done) leaving.delete(topic);
      });
    };
  }

  return { join, setToken, size: () => shared.size };
}
