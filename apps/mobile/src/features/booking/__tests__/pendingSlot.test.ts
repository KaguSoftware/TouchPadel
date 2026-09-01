import { describe, expect, it } from 'vitest';
import {
  clearPendingSlot,
  getPendingSlot,
  setPendingSlot,
  subscribePendingSlot,
  type PendingSlot,
} from '../pendingSlot';

const slot: PendingSlot = {
  courtId: 'c1',
  startAt: '2026-09-01T07:00:00.000Z',
  durationMin: 60,
  priceIqd: 40_000,
  courtNameEn: 'Court 1',
  courtNameAr: 'ملعب 1',
};

describe('pendingSlot store', () => {
  it('notifies subscribers on set and clear, and stays set until cleared', () => {
    // The (auth) layout guard reads this at render; a plain module variable
    // gave it no way to re-evaluate, and the intent was dropped BEFORE the
    // post-auth hold settled — the redirect race that stranded guests on the tabs.
    const seen: (PendingSlot | null)[] = [];
    const unsubscribe = subscribePendingSlot(() => seen.push(getPendingSlot()));

    setPendingSlot(slot);
    expect(getPendingSlot()).toEqual(slot);
    expect(getPendingSlot()).toEqual(slot); // peeking does not consume

    clearPendingSlot();
    expect(getPendingSlot()).toBeNull();
    clearPendingSlot(); // idempotent: no extra notification
    unsubscribe();
    setPendingSlot(slot);
    clearPendingSlot();

    expect(seen).toEqual([slot, null]);
  });
});
