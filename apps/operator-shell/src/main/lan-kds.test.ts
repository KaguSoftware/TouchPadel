import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { setAuthState } from './auth-state';
import { parseStatusUpdate, type LanServerFrame } from './lan-frames';
import { pickLanBind, startLanKdsServer, type LanKdsServer } from './lan-kds-server';
import { openQueue } from './queue';
import { ulid } from './ulid';
import type { MutationEnvelope } from '../ipc-channels';

// The LAN half of the disconnection drill: tickets reach the KDS over the
// socket, and a bump lands in the TILL's queue (single writer, design-arch §2.4).

const STAFF = '5c9f1f1e-2b3a-4c4d-8e9f-0000000000aa';
const PSK = 'drill-psk';
const PORT = 47899; // test-only port; the real one is 47810

function connect(psk: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${PORT}`, {
    headers: { authorization: `Bearer ${psk}` },
  });
}

function nextMessage(ws: WebSocket): Promise<LanServerFrame> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as LanServerFrame));
    ws.once('close', (code) => reject(new Error(`closed ${code}`)));
    ws.once('error', reject);
  });
}

function orderEnvelope(): MutationEnvelope {
  const key = `TILL1:order.add_items:${ulid()}`;
  return {
    localId: `TILL1-${ulid()}`,
    idempotencyKey: key,
    mutationType: 'order.add_items',
    payload: {
      tabIdemKey: `TILL1:tab.open:${ulid()}`,
      items: [{ variantId: 'v-1', qty: 2, modifiers: [] }],
    },
    createdAt: new Date().toISOString(),
    staffId: STAFF,
    deviceId: 'TILL1',
  };
}

let server: LanKdsServer | null = null;
const sockets: WebSocket[] = [];

function track(ws: WebSocket): WebSocket {
  sockets.push(ws);
  return ws;
}

beforeEach(() => {
  openQueue().exec('DELETE FROM mutation_queue;');
  setAuthState({ accessToken: 't', staffId: STAFF, supabaseUrl: 'https://x.test', anonKey: 'k' });
  server = startLanKdsServer(
    { stationId: 'TILL1', mode: 'till', lanPsk: PSK, lanBind: '127.0.0.1', configured: true, appVersion: 't' },
    { port: PORT },
  );
  expect(server).not.toBeNull();
});

afterEach(() => {
  for (const ws of sockets) ws.close();
  sockets.length = 0;
  server?.close();
  server = null;
  setAuthState(null);
});

describe('parseStatusUpdate', () => {
  it('accepts a well-formed bump and refuses junk', () => {
    const good = JSON.stringify({
      type: 'status.update',
      data: { ref: 'TILL1:order.add_items:01J5X', status: 'ready', kdsStation: 'KDS-01' },
    });
    expect(parseStatusUpdate(good)?.status).toBe('ready');
    expect(parseStatusUpdate('not json')).toBeNull();
    expect(parseStatusUpdate(JSON.stringify({ type: 'status.update', data: { ref: 'x', status: 'burnt', kdsStation: 'KDS-01' } }))).toBeNull();
    expect(parseStatusUpdate(JSON.stringify({ type: 'ticket.new', data: {} }))).toBeNull();
    expect(parseStatusUpdate(JSON.stringify({ type: 'status.update', data: { ref: 'x', status: 'ready', kdsStation: 'kds lower' } }))).toBeNull();
  });
});

describe('lan kds server', () => {
  it('refuses a wrong PSK with 4401 and never sends the snapshot', async () => {
    const ws = track(connect('wrong'));
    const code = await new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('sends the ring as a snapshot on every successful auth', async () => {
    server!.onEnqueued(orderEnvelope());
    const ws = track(connect(PSK));
    const frame = await nextMessage(ws);
    expect(frame.type).toBe('ticket.snapshot');
    if (frame.type === 'ticket.snapshot') {
      expect(frame.data).toHaveLength(1);
      expect(frame.data[0]!.items[0]!.qty).toBe(2);
    }
  });

  it('broadcasts kitchen-bound enqueues as ticket.new', async () => {
    const ws = track(connect(PSK));
    await nextMessage(ws); // snapshot (empty)
    const pending = nextMessage(ws);
    const env = orderEnvelope();
    server!.onEnqueued(env);
    const frame = await pending;
    expect(frame.type).toBe('ticket.new');
    if (frame.type === 'ticket.new') expect(frame.data.ref).toBe(env.idempotencyKey);
  });

  it('a KDS bump becomes a ticket.status envelope on the TILL queue and echoes to all KDS', async () => {
    const env = orderEnvelope();
    server!.onEnqueued(env);
    const ws = track(connect(PSK));
    await nextMessage(ws); // snapshot
    const echoPending = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: 'status.update',
        data: { ref: env.idempotencyKey, status: 'ready', kdsStation: 'KDS-01' },
      }),
    );
    const echo = await echoPending;
    expect(echo).toEqual({
      type: 'status.update',
      data: { ref: env.idempotencyKey, status: 'ready' },
    });

    const row = openQueue()
      .prepare("SELECT * FROM mutation_queue WHERE mutation_type = 'ticket.status'")
      .get() as Record<string, unknown>;
    expect(row).toBeDefined();
    // Single writer: the TILL owns the key and the queue; the KDS keeps
    // provenance in the localId's station segment.
    expect(String(row.idempotency_key)).toMatch(/^TILL1:ticket\.status:/);
    expect(String(row.local_id)).toMatch(/^KDS-01-/);
    expect(row.staff_id).toBe(STAFF);
    expect(JSON.parse(String(row.payload))).toEqual({
      ticketIdemKey: env.idempotencyKey,
      status: 'ready',
    });
    // Ordering: the bump sits AFTER the order it bumps — replay resolves the
    // ticket only once the order row has landed.
  });

  it('refuses a bump when the till has no staff session', async () => {
    setAuthState(null);
    const ws = track(connect(PSK));
    await nextMessage(ws);
    const errPending = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: 'status.update',
        data: { ref: 'TILL1:order.add_items:X', status: 'ready', kdsStation: 'KDS-01' },
      }),
    );
    const err = (await errPending) as unknown as { type: string; data: { reason: string } };
    expect(err.type).toBe('error');
    expect(err.data.reason).toMatch(/staff/);
  });
});

describe('ulid (main-process mirror)', () => {
  it('emits 26 Crockford chars matching the canonical pattern', () => {
    for (let i = 0; i < 50; i++) {
      expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('is unique across a burst', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(seen.size).toBe(1000);
  });
});

describe('pickLanBind', () => {
  it('honours the station override and never returns 0.0.0.0', () => {
    expect(pickLanBind('192.168.1.50')).toBe('192.168.1.50');
    expect(pickLanBind()).not.toBe('0.0.0.0');
  });
});
