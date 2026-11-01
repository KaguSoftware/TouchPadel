import { describe, expect, it } from 'vitest';
import type { KitchenTicket } from '../../ipc/bridge';
import {
  EMPTY_LAN,
  REFUSAL_SHOWN_MS,
  isLanRef,
  lanNotice,
  lanOnlyTickets,
  lanOpenTickets,
  reduceLanFrame,
  refusalMessageKey,
} from './lanState';

const t = (ref: string, over: Partial<KitchenTicket> = {}): KitchenTicket => ({
  ref,
  tabLabel: null,
  items: [],
  createdAt: `2026-11-01T10:0${ref.length % 10}:00Z`,
  status: 'queued',
  ...over,
});

describe('LAN board state (F-11, F-57)', () => {
  it('applies snapshot, new, status, synced and dropped frames', () => {
    let s = reduceLanFrame(EMPTY_LAN, { type: 'ticket.snapshot', data: [t('A:1'), t('A:22', { status: 'completed' })] }, 0);
    s = reduceLanFrame(s, { type: 'ticket.new', data: t('A:333', { synced: false }) }, 0);
    s = reduceLanFrame(s, { type: 'status.update', data: { ref: 'A:1', status: 'ready' } }, 0);
    expect(lanOpenTickets(s).map((x) => [x.ref, x.status])).toEqual([
      ['A:1', 'ready'],
      ['A:333', 'queued'],
    ]);
    // Only a ticket the till marks as not yet on the server joins the cloud board.
    expect(lanOnlyTickets(s).map((x) => x.ref)).toEqual(['A:333']);
    s = reduceLanFrame(s, { type: 'ticket.synced', data: { ref: 'A:333', ticketId: 'x' } }, 0);
    expect(lanOnlyTickets(s)).toEqual([]);
    s = reduceLanFrame(s, { type: 'ticket.dropped', data: { ref: 'A:1' } }, 0);
    expect(lanOpenTickets(s).map((x) => x.ref)).toEqual(['A:333']);
  });

  it('turns the LAN notice into "link down" when the till link drops', () => {
    expect(lanNotice(false, false)).toBeNull();
    expect(lanNotice(true, undefined)).toBe('lanMode');
    let s = reduceLanFrame(EMPTY_LAN, { type: 'link', data: { up: true } }, 0);
    expect(lanNotice(true, s.link)).toBe('lanMode');
    s = reduceLanFrame(s, { type: 'link', data: { up: false } }, 0);
    expect(lanNotice(true, s.link)).toBe('linkDown');
    // A station with no LAN link at all is not "receiving over the LAN" either.
    expect(lanNotice(true, null)).toBe('linkDown');
  });

  it('says why a bump did not land, for a while, and clears it when the till takes that ticket', () => {
    let s = reduceLanFrame(EMPTY_LAN, { type: 'ticket.new', data: t('A:1') }, 0);
    s = reduceLanFrame(s, { type: 'error', data: { reason: 'no-staff', ref: 'A:1' } }, 1_000);
    expect(refusalMessageKey(s.refusal, 2_000)).toBe('ws.prep.lan.bumpNoStaff');
    expect(refusalMessageKey(s.refusal, 1_000 + REFUSAL_SHOWN_MS + 1)).toBeNull();
    expect(refusalMessageKey({ reason: 'link-down', ref: 'A:1', atMs: 0 }, 0)).toBe('ws.prep.lan.bumpLinkDown');
    expect(refusalMessageKey({ reason: 'enqueue-failed', ref: null, atMs: 0 }, 0)).toBe('ws.prep.lan.bumpRefused');
    s = reduceLanFrame(s, { type: 'status.update', data: { ref: 'A:1', status: 'ready' } }, 3_000);
    expect(s.refusal).toBeNull();
  });

  it('tells a LAN ref from a cloud id', () => {
    expect(isLanRef('TILL1:order.add_items:01J')).toBe(true);
    expect(isLanRef('5c9f1f1e-2b3a-4c4d-8e9f-0000000000aa')).toBe(false);
  });
});
