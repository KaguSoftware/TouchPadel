/**
 * A broadcast channel that comes back by itself and says when it did.
 *
 * Modelled on the operator's hub (apps/operator/src/lib/realtime.ts), which
 * got this right first: on CHANNEL_ERROR / TIMED_OUT / CLOSED the channel is
 * removed and recreated after a jittered 4–7 s delay, and a channel that comes
 * back tells its owner it RECOVERED so the owner re-reads whatever it missed
 * while it was down. Before this, the guest app's courts channel only logged
 * an error and the café's session channel did nothing at all: a guest whose
 * phone slept kept a stale grid or a stale order status until something else
 * happened to refetch it.
 *
 * Two more rules the hub's callers needed:
 *
 *   - `resume()` is the foreground hook (the app came back to the front, the
 *     tab became visible, the network came back). It always asks the owner to
 *     re-read — events broadcast while the socket slept are gone for good —
 *     and reconnects at once if the channel is down instead of waiting out the
 *     backoff.
 *   - realtime-js keys channels by topic, and `channel(topic)` hands back one
 *     still LEAVING after `removeChannel`, on which `subscribe()` does nothing.
 *     A new channel on a topic is only created once the old one's removal has
 *     finished (`waitFor`, and the channel's own drops).
 *
 * A rotated access token needs nothing from here: supabase-js pushes it to
 * every joined channel in place (`realtime.setAuth`), so the channel is never
 * torn down for it. `beforeSubscribe` runs before every (re)join, where an
 * owner sets the realtime auth a private topic needs.
 *
 * Structural types only: no supabase-js import (callers cast their client, as
 * the operator hub does), so this stays pure and unit-testable.
 */

export type ChannelStatus = 'connecting' | 'live' | 'disconnected';

export interface BroadcastMessageLike {
  event?: string;
  payload?: unknown;
}

export interface RealtimeChannelLike {
  on(type: 'broadcast', filter: { event: string }, cb: (message: BroadcastMessageLike) => void): unknown;
  subscribe(cb: (state: string) => void): unknown;
}

export interface RealtimeClientLike {
  channel(topic: string, opts: { config: { private: boolean } }): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
}

export const CHANNEL_RECONNECT_MIN_MS = 4_000;
export const CHANNEL_RECONNECT_MAX_MS = 7_000;

export type RecoverReason = 'reconnected' | 'resumed';

export interface ResilientChannelOptions {
  topic: string;
  isPrivate: boolean;
  /** Broadcast events to hear. */
  events: readonly string[];
  onMessage(event: string, payload: unknown): void;
  /**
   * Re-read what this channel feeds: it is live again after being down
   * ('reconnected'), or the app came back to the foreground ('resumed').
   */
  onRecover?(reason: RecoverReason): void;
  onStatus?(status: ChannelStatus): void;
  /** Runs before every (re)join: set the realtime auth a private topic needs. */
  beforeSubscribe?(): unknown;
  /** Settles once a previous channel on this topic is fully removed. */
  waitFor?: Promise<unknown>;
  /** Injectable for tests. */
  random?: () => number;
}

export interface ResilientChannel {
  status(): ChannelStatus;
  /** The app is in front again (foreground, visible tab, network back). */
  resume(): void;
  /** Leave for good; resolves once the channel is removed. */
  close(): Promise<unknown>;
}

const DOWN_STATES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export function createResilientChannel(client: RealtimeClientLike, opts: ResilientChannelOptions): ResilientChannel {
  const random = opts.random ?? Math.random;
  let channel: RealtimeChannelLike | null = null;
  let status: ChannelStatus = 'connecting';
  /** Live at least once, or failed before ever going live: either way the owner's data may be behind. */
  let owesRecovery = false;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let removing: Promise<unknown> = opts.waitFor ?? Promise.resolve();

  const setStatus = (next: ChannelStatus) => {
    if (status === next) return;
    status = next;
    opts.onStatus?.(next);
  };

  const drop = () => {
    if (!channel) return;
    const ch = channel;
    channel = null;
    removing = removing.then(() => client.removeChannel(ch)).catch(() => undefined);
  };

  const cancelRetry = () => {
    if (retry) clearTimeout(retry);
    retry = null;
  };

  const connect = () => {
    setStatus('connecting');
    void removing.then(async () => {
      if (closed || channel) return;
      try {
        await opts.beforeSubscribe?.();
      } catch {
        // No fresh auth: join anyway. A private topic refuses, and the
        // refusal comes back as CHANNEL_ERROR, which retries.
      }
      if (closed || channel) return;
      const ch = client.channel(opts.topic, { config: { private: opts.isPrivate } });
      channel = ch;
      for (const event of opts.events) {
        ch.on('broadcast', { event }, (message) => {
          // A message from a channel already replaced (or closed) is not ours.
          if (ch !== channel || closed) return;
          opts.onMessage(message.event ?? event, message.payload);
        });
      }
      ch.subscribe((state) => {
        if (ch !== channel || closed) return;
        if (state === 'SUBSCRIBED') {
          // realtime-js rejoined this channel by itself: no rebuild needed.
          cancelRetry();
          const recovered = owesRecovery;
          owesRecovery = true;
          setStatus('live');
          if (recovered) opts.onRecover?.('reconnected');
        } else if (DOWN_STATES.has(state)) {
          owesRecovery = true;
          setStatus('disconnected');
          if (retry) return;
          const delay =
            CHANNEL_RECONNECT_MIN_MS + random() * (CHANNEL_RECONNECT_MAX_MS - CHANNEL_RECONNECT_MIN_MS);
          retry = setTimeout(() => {
            retry = null;
            if (closed) return;
            drop();
            connect();
          }, delay);
        }
      });
    });
  };

  connect();

  return {
    status: () => status,
    resume() {
      if (closed) return;
      opts.onRecover?.('resumed');
      if (status !== 'disconnected') return;
      // Down and waiting out the backoff: the person is looking now.
      cancelRetry();
      drop();
      connect();
    },
    close() {
      if (!closed) {
        closed = true;
        cancelRetry();
        drop();
      }
      return removing;
    },
  };
}
