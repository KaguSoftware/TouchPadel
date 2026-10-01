import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESUME_GRACE_MS,
  claimResume,
  isResumable,
  isResumeSafePath,
  parsePendingPayment,
  pendingPaymentKey,
  readPendingPayment,
  rememberReturnRef,
  removePendingPayment,
  resetResumeClaims,
  serializePendingPayment,
  takeReturnRef,
  writePendingPayment,
  type KeyValueStore,
  type PendingPayment,
} from '../pendingPayment';

/**
 * The pointer to a payment in flight (build-contracts-2026-09-27 §4): per
 * user, persisted, cleared on a terminal answer, reopened on launch within its
 * window plus ten minutes. Driven here through a Map in place of AsyncStorage.
 */

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
  };
}

const UID = '11111111-2222-3333-4444-555555555555';
const P: PendingPayment = {
  ref: 'r-1',
  reservationId: 'hold-1',
  deadlineAt: '2026-09-27T12:15:00Z',
};

describe('the key', () => {
  it('is per user, and carries the uid the deletion purge names it by', () => {
    expect(pendingPaymentKey(UID)).toBe(`tp.pendingPayment.${UID}`);
  });
});

describe('persistence', () => {
  it('round-trips the three fields', async () => {
    const store = memoryStore();
    await writePendingPayment(store, UID, P);
    expect(await readPendingPayment(store, UID)).toEqual(P);
    expect(parsePendingPayment(serializePendingPayment(P))).toEqual(P);
  });

  it('keeps two accounts on one phone apart', async () => {
    const store = memoryStore();
    await writePendingPayment(store, UID, P);
    expect(await readPendingPayment(store, 'someone-else')).toBeNull();
  });

  it('writes nothing, and reads nothing, without a user', async () => {
    const store = memoryStore();
    await writePendingPayment(store, '', P);
    expect(store.data.size).toBe(0);
    expect(await readPendingPayment(store, '')).toBeNull();
  });

  it('removes a value that is not a pointer instead of reading it forever', async () => {
    const store = memoryStore();
    store.data.set(pendingPaymentKey(UID), '{not json');
    expect(await readPendingPayment(store, UID)).toBeNull();
    expect(store.data.has(pendingPaymentKey(UID))).toBe(false);
    expect(parsePendingPayment(JSON.stringify({ ref: '', reservationId: 'h', deadlineAt: 'd' }))).toBeNull();
    expect(parsePendingPayment(JSON.stringify({ ref: 'r' }))).toBeNull();
    expect(parsePendingPayment(null)).toBeNull();
  });
});

describe('clearing on a terminal answer', () => {
  it('forgets the pointer', async () => {
    const store = memoryStore();
    await writePendingPayment(store, UID, P);
    await removePendingPayment(store, UID);
    expect(await readPendingPayment(store, UID)).toBeNull();
  });

  it('only forgets the attempt it was asked about', async () => {
    // A failed attempt's screen settles AFTER "Try again" saved the new one:
    // it must not wipe the pointer to the attempt that is now running.
    const store = memoryStore();
    await writePendingPayment(store, UID, { ...P, ref: 'r-2' });
    await removePendingPayment(store, UID, 'r-1');
    expect((await readPendingPayment(store, UID))?.ref).toBe('r-2');
    await removePendingPayment(store, UID, 'r-2');
    expect(await readPendingPayment(store, UID)).toBeNull();
  });
});

describe('isResumable', () => {
  const deadline = Date.parse(P.deadlineAt);

  it('reopens within the window and ten minutes past it', () => {
    expect(RESUME_GRACE_MS).toBe(10 * 60_000);
    expect(isResumable(P, new Date(deadline - 60_000))).toBe(true);
    expect(isResumable(P, new Date(deadline + RESUME_GRACE_MS - 1))).toBe(true);
  });

  it('lets the booking list answer after that', () => {
    expect(isResumable(P, new Date(deadline + RESUME_GRACE_MS))).toBe(false);
    expect(isResumable({ ...P, deadlineAt: 'garbage' }, new Date(deadline))).toBe(false);
  });
});

describe('isResumeSafePath', () => {
  it('resumes from a screen the guest is resting on', () => {
    for (const p of ['/', '/bookings', '/profile', '/booking/abc', '/settings', '/booking-history']) {
      expect(isResumeSafePath(p)).toBe(true);
    }
  });

  it('never jumps over an auth screen, a flow in progress, or the staff phone', () => {
    for (const p of [
      '/welcome',
      '/sign-in',
      '/sign-up',
      '/verify-email',
      '/verify-otp',
      '/verify-result',
      '/phone-sign-in',
      '/complete-profile',
      '/reset-password',
      '/accept-terms',
      '/review',
      '/success',
      '/pay/status',
      '/pay/return',
      '/staff',
      '/staff-run',
      // Open matches: mid-purchase, a form, or a link continuing into a join.
      '/tickets',
      '/match-new',
      '/match-report',
      '/m/abcdefghijklmnopqrstuv',
      // Coach mode (coaching guest.md §4.17): every coach-mode screen.
      '/coach-mode',
      '/coach-mode-hours',
      '/coach-mode-lesson',
      '/coach-mode-new',
      '/coach-mode-book',
      '/coach-mode-statements',
    ]) {
      expect(isResumeSafePath(p)).toBe(false);
    }
    expect(isResumeSafePath('')).toBe(false);
    expect(isResumeSafePath(null)).toBe(false);
  });
});

describe('claimResume', () => {
  beforeEach(() => resetResumeClaims());

  it('lets exactly one path reopen an attempt', () => {
    expect(claimResume('r-1')).toBe(true);
    expect(claimResume('r-1')).toBe(false);
    expect(claimResume('r-2')).toBe(true);
  });
});

describe('the return link while signed out', () => {
  it('is remembered once, for the post-auth continuation', () => {
    expect(takeReturnRef()).toBeNull();
    rememberReturnRef('r-9');
    expect(takeReturnRef()).toBe('r-9');
    expect(takeReturnRef()).toBeNull();
  });
});

describe('a ticket purchase (docs/design/open-matches/guest.md §4.10.2)', () => {
  const AFTER = {
    kind: 'join' as const,
    savedAt: '2026-09-27T12:00:00Z',
    matchId: 'm-1',
    token: null,
    friends: [{ gender: null }],
  };
  const T: PendingPayment = {
    ref: 'r-9',
    reservationId: '',
    deadlineAt: '2026-09-27T12:15:00Z',
    purpose: 'ticket',
    after: AFTER,
  };

  it('round-trips purpose and the continuation', async () => {
    const store = memoryStore();
    await writePendingPayment(store, UID, T);
    expect(await readPendingPayment(store, UID)).toEqual(T);
  });

  it('keeps reading a pointer written before open matches as a deposit', () => {
    const old = JSON.stringify({ ref: 'r-1', reservationId: 'hold-1', deadlineAt: '2026-09-27T12:15:00Z' });
    expect(parsePendingPayment(old)).toEqual(P);
    expect(parsePendingPayment(old)?.purpose).toBeUndefined();
    // A deposit's pointer is still written in the old shape.
    expect(JSON.parse(serializePendingPayment(P))).toEqual({
      ref: 'r-1',
      reservationId: 'hold-1',
      deadlineAt: '2026-09-27T12:15:00Z',
    });
  });

  it('drops a malformed continuation and keeps the pointer', () => {
    const raw = JSON.stringify({ ...T, after: { kind: 'join', savedAt: 'yesterday', matchId: 'm-1' } });
    expect(parsePendingPayment(raw)).toEqual({
      ref: 'r-9',
      reservationId: '',
      deadlineAt: '2026-09-27T12:15:00Z',
      purpose: 'ticket',
    });
  });

  it('keeps a ticket purchase that was bought for nothing in particular', () => {
    const bare: PendingPayment = { ref: 'r-9', reservationId: '', deadlineAt: T.deadlineAt, purpose: 'ticket' };
    expect(parsePendingPayment(serializePendingPayment(bare))).toEqual(bare);
  });
});
