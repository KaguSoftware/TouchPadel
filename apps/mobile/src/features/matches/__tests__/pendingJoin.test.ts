import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingJoin,
  getPendingJoin,
  intentBooksCourt,
  pendingJoinHref,
  setPendingJoin,
  subscribePendingJoin,
} from '../pendingJoin';
import { clearPendingIntents, hasPendingIntent } from '../../booking/pendingIntent';
import { clearPendingSlot, getPendingSlot, setPendingSlot } from '../../booking/pendingSlot';

/**
 * The open-match intent carried across sign-in (docs/design/open-matches/guest.md
 * §4.18): in memory, subscribable, never persisted, and answered together
 * with the pending slot by `pendingIntent`.
 */
afterEach(() => {
  clearPendingJoin();
  clearPendingSlot();
});

describe('pendingJoin', () => {
  it('holds one intent and tells its subscribers', () => {
    const listener = vi.fn();
    const off = subscribePendingJoin(listener);
    setPendingJoin({ kind: 'link', token: 't' });
    expect(getPendingJoin()).toEqual({ kind: 'link', token: 't' });
    clearPendingJoin();
    expect(getPendingJoin()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    // Clearing nothing tells nobody.
    clearPendingJoin();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it('opens the screen each intent names (never a join, GD-2)', () => {
    expect(pendingJoinHref({ kind: 'link', token: 't' })).toEqual({ pathname: '/m/[token]', params: { token: 't' } });
    expect(pendingJoinHref({ kind: 'slot', venueId: 'v', startAt: 's' })).toEqual({
      pathname: '/matches',
      params: { at: 's' },
    });
    expect(pendingJoinHref({ kind: 'list', venueId: 'v', date: '2026-10-02' })).toEqual({
      pathname: '/matches',
      params: { date: '2026-10-02' },
    });
    expect(
      pendingJoinHref({ kind: 'start', venueId: 'v', courtId: 'c', startAt: 's', durationMin: 90, priceIqd: 40000 }),
    ).toEqual({
      pathname: '/match-new',
      params: { venueId: 'v', courtId: 'c', startAt: 's', durationMin: '90', priceIqd: '40000' },
    });
    // No price hint: the form re-quotes anyway (DF-3).
    expect(
      pendingJoinHref({ kind: 'start', venueId: 'v', courtId: 'c', startAt: 's', durationMin: 60, priceIqd: null }).params,
    ).not.toHaveProperty('priceIqd');
  });

  it('sends a start and a join through the booking gate, never the list', () => {
    expect(intentBooksCourt({ kind: 'link', token: 't' })).toBe(true);
    expect(intentBooksCourt({ kind: 'slot', venueId: 'v', startAt: 's' })).toBe(true);
    expect(
      intentBooksCourt({ kind: 'start', venueId: 'v', courtId: 'c', startAt: 's', durationMin: 90, priceIqd: null }),
    ).toBe(true);
    expect(intentBooksCourt({ kind: 'list', venueId: 'v', date: '2026-10-02' })).toBe(false);
  });
});

describe('pendingIntent', () => {
  const slot = {
    courtId: 'c',
    startAt: 's',
    durationMin: 90,
    priceIqd: null,
    courtNameEn: 'Court One',
    courtNameAr: 'الملعب الأول',
  };

  it('is true for either store', () => {
    expect(hasPendingIntent()).toBe(false);
    setPendingJoin({ kind: 'slot', venueId: 'v', startAt: 's' });
    expect(hasPendingIntent()).toBe(true);
    clearPendingJoin();
    setPendingSlot(slot);
    expect(hasPendingIntent()).toBe(true);
  });

  it('clears both at once', () => {
    setPendingSlot(slot);
    setPendingJoin({ kind: 'link', token: 't' });
    clearPendingIntents();
    expect(getPendingSlot()).toBeNull();
    expect(getPendingJoin()).toBeNull();
    expect(hasPendingIntent()).toBe(false);
  });
});
