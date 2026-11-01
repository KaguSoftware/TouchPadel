import { describe, expect, it } from 'vitest';
import {
  NOT_RECEIVED_AFTER_MS,
  SEEN_SHOWN_MS,
  cloudStatusesForLan,
  indexByKey,
  latestSendTo,
  notReceivedTabs,
  pruneSends,
  REACH_WINDOW_MS,
  sendReachState,
  sendStatusLine,
  type CloudTicket,
  type KitchenSend,
} from './kitchenReach';

const NOW = 1_000_000_000;
const send = (over: Partial<KitchenSend> = {}): KitchenSend => ({
  key: 'TILL1:order.add_items:A',
  tabId: 'tab-1',
  sentAtMs: NOW - 30_000,
  queued: false,
  ...over,
});
const ticket = (over: Partial<CloudTicket> = {}): CloudTicket => ({
  id: 't1',
  status: 'queued',
  createdAtMs: NOW - 30_000,
  seenAtMs: null,
  tabId: 'tab-1',
  key: 'TILL1:order.add_items:A',
  ...over,
});
const none = new Set<string>();

describe('kitchen reach (F-11)', () => {
  it('waits twenty seconds, then flags an order no kitchen screen drew', () => {
    const fresh = send({ sentAtMs: NOW - 5_000 });
    expect(sendReachState(fresh, indexByKey([ticket()]), none, NOW)).toBe('waiting');
    expect(sendReachState(send(), indexByKey([ticket()]), none, NOW)).toBe('notReceived');
    expect(notReceivedTabs([send()], [ticket()], none, NOW)).toEqual(new Set(['tab-1']));
  });

  it('a cloud sighting, a bump or a LAN ack clears it', () => {
    expect(sendReachState(send(), indexByKey([ticket({ seenAtMs: NOW - 1_000 })]), none, NOW)).toBe('seen');
    expect(sendReachState(send(), indexByKey([ticket({ status: 'preparing' })]), none, NOW)).toBe('seen');
    expect(sendReachState(send(), new Map(), new Set([send().key]), NOW)).toBe('seen');
    expect(notReceivedTabs([send()], [ticket({ seenAtMs: NOW })], none, NOW).size).toBe(0);
  });

  it('flags an order still in the offline queue that the LAN did not deliver either', () => {
    const queued = send({ queued: true, tabId: 'local:TILL1:tab.open:X' });
    expect(sendReachState({ ...queued, sentAtMs: NOW - 1_000 }, new Map(), none, NOW)).toBe('queued');
    expect(notReceivedTabs([queued], [], none, NOW)).toEqual(new Set(['local:TILL1:tab.open:X']));
    // Once the offline tab is replayed, the server tab carries the flag too.
    expect(notReceivedTabs([queued], [ticket({ tabId: 'tab-9' })], none, NOW)).toEqual(new Set(['local:TILL1:tab.open:X', 'tab-9']));
  });

  it('flags other tills’ and guests’ orders from the cloud alone', () => {
    const guest = ticket({ key: null, tabId: 'tab-2' });
    expect(notReceivedTabs([], [guest], none, NOW)).toEqual(new Set(['tab-2']));
    expect(notReceivedTabs([], [{ ...guest, createdAtMs: NOW - NOT_RECEIVED_AFTER_MS + 1 }], none, NOW).size).toBe(0);
  });

  it('the basket line: waiting, on screen for a minute, or not received', () => {
    const byKey = indexByKey([ticket({ seenAtMs: NOW })]);
    expect(sendStatusLine(null, byKey, none, NOW)).toBeNull();
    expect(sendStatusLine(send({ sentAtMs: NOW - 2_000 }), new Map(), none, NOW)).toBe('waiting');
    expect(sendStatusLine(send({ sentAtMs: NOW - 2_000, queued: true }), new Map(), none, NOW)).toBeNull();
    expect(sendStatusLine(send({ sentAtMs: NOW - 2_000 }), byKey, none, NOW)).toBe('seen');
    expect(sendStatusLine(send({ sentAtMs: NOW - SEEN_SHOWN_MS - 1 }), byKey, none, NOW)).toBeNull();
    expect(sendStatusLine(send(), new Map(), none, NOW)).toBe('notReceived');
  });

  it('picks the latest send to a tab and forgets old ones', () => {
    const a = send({ key: 'a', sentAtMs: NOW - 50_000 });
    const b = send({ key: 'b', sentAtMs: NOW - 10_000 });
    expect(latestSendTo([a, b, send({ key: 'c', tabId: 'other' })], 'tab-1', NOW)?.key).toBe('b');
    expect(pruneSends([send({ sentAtMs: NOW - REACH_WINDOW_MS - 1 }), b], NOW)).toEqual([b]);
  });

  it('hands the cloud statuses of the till’s own orders to the LAN ring', () => {
    expect(
      cloudStatusesForLan([
        ticket({ status: 'completed' }),
        ticket({ key: 'TILL1:order.add_items:B', status: 'voided' }),
        ticket({ key: null }),
        ticket({ key: 'not-a-lan-ref' }),
      ]),
    ).toEqual([
      { ref: 'TILL1:order.add_items:A', status: 'completed' },
      { ref: 'TILL1:order.add_items:B', status: 'completed' },
    ]);
  });
});
