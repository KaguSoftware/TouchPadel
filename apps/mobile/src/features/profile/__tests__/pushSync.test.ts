/**
 * Push-token upkeep — the decisions that decide whether a notification EXISTS.
 *
 * These tests are about one server fact: app.enqueue_reservation_push
 * (migration 0075) returns early when profiles.expo_push_token is null, so no
 * outbox row is written and nothing backfills when a token arrives later. A
 * token that is missing or stale at the moment of booking is therefore not a
 * late notification — it is a confirmation and a 3-hour reminder that were
 * never created at all.
 *
 * That makes every predicate here silently load-bearing: each one answers
 * "write the token now?", and the cost of a wrong "no" is invisible on the
 * phone. Nobody testing by hand would catch it, which is precisely why the
 * registration hole survived until the 2026-09-12 audit.
 *
 * Mutation-checked while writing: dropping the `force` branch of
 * shouldPersistToken turns the rotation test red; folding 'failed' back into
 * 'unavailable' in permissionStateAfter turns two tests red; returning true
 * unconditionally from shouldRouteTap turns the cold-start dedupe red.
 */
import { describe, expect, it } from 'vitest';

import {
  permissionStateAfter,
  shouldPersistToken,
  shouldRouteTap,
  shouldSync,
  tapDestination,
  type PushOutcome,
} from '../pushSync';

describe('shouldPersistToken', () => {
  it('writes the first token this instance has seen', () => {
    expect(shouldPersistToken({ token: 'ExponentPushToken[a]', lastWritten: null })).toBe(true);
  });

  it('skips a redundant write when the token has not changed', () => {
    // The foreground re-check runs on EVERY resume; without this it would be a
    // network write per app switch.
    expect(
      shouldPersistToken({ token: 'ExponentPushToken[a]', lastWritten: 'ExponentPushToken[a]' }),
    ).toBe(false);
  });

  it('writes when the OS has handed us a different token', () => {
    expect(
      shouldPersistToken({ token: 'ExponentPushToken[b]', lastWritten: 'ExponentPushToken[a]' }),
    ).toBe(true);
  });

  it('writes on force even when the token looks unchanged', () => {
    // The rotation listener's whole point: the cached value is what went stale.
    expect(
      shouldPersistToken({
        token: 'ExponentPushToken[a]',
        lastWritten: 'ExponentPushToken[a]',
        force: true,
      }),
    ).toBe(true);
  });

  it('writes again after the cache is forgotten, which is what sign-out does', () => {
    // Sign-out nulls the column server-side (SEC-21). If the cache survived,
    // the next sign-in would skip the rewrite as redundant and the profile
    // would stay unreachable for every booking made afterwards.
    expect(shouldPersistToken({ token: 'ExponentPushToken[a]', lastWritten: null })).toBe(true);
  });
});

describe('shouldSync', () => {
  it('syncs when signed in, idle and live', () => {
    expect(shouldSync({ cancelled: false, inFlight: false, hasSession: true })).toBe(true);
  });

  it('does nothing without a session — there is no row to write the token to', () => {
    expect(shouldSync({ cancelled: false, inFlight: false, hasSession: false })).toBe(false);
  });

  it('does not stack a second sync on top of one in flight', () => {
    // Resume can fire twice in quick succession on Android.
    expect(shouldSync({ cancelled: false, inFlight: true, hasSession: true })).toBe(false);
  });

  it('does nothing after teardown', () => {
    expect(shouldSync({ cancelled: true, inFlight: false, hasSession: true })).toBe(false);
  });
});

describe('permissionStateAfter', () => {
  it('shows granted after a successful registration', () => {
    expect(permissionStateAfter('registered', 'undetermined')).toEqual({
      state: 'granted',
      errored: false,
    });
  });

  it('shows denied when the guest said no, without calling it an error', () => {
    expect(permissionStateAfter('denied', 'undetermined')).toEqual({
      state: 'denied',
      errored: false,
    });
  });

  it('shows unavailable on a device that genuinely cannot do push', () => {
    // Simulator, Expo Go, no native module. Not a fault.
    expect(permissionStateAfter('unavailable', 'undetermined')).toEqual({
      state: 'unavailable',
      errored: false,
    });
  });

  it('keeps the observed permission on a fault instead of blaming the device', () => {
    // THE regression this function exists for: a network blip used to render
    // "Push notifications are not available on this device" to a guest holding
    // a perfectly capable phone, with no action attached to it.
    expect(permissionStateAfter('failed', 'granted')).toEqual({
      state: 'granted',
      errored: true,
    });
  });

  it('reports a fault as an error even when permission is still undetermined', () => {
    expect(permissionStateAfter('failed', 'undetermined')).toEqual({
      state: 'undetermined',
      errored: true,
    });
  });

  it('never reports an error for any non-fault outcome', () => {
    const clean: PushOutcome[] = ['registered', 'denied', 'unavailable'];
    for (const outcome of clean) {
      expect(permissionStateAfter(outcome, 'undetermined').errored).toBe(false);
    }
  });
});

describe('shouldRouteTap', () => {
  it('routes a tap it has not seen', () => {
    expect(shouldRouteTap({ id: 'n1', handled: new Set() })).toBe(true);
  });

  it('drops the duplicate a cold start delivers twice', () => {
    // getLastNotificationResponseAsync AND the response listener both report
    // the launching tap on some Expo versions, which pushed the booking screen
    // onto itself.
    expect(shouldRouteTap({ id: 'n1', handled: new Set(['n1']) })).toBe(false);
  });

  it('still routes a different notification while one is already handled', () => {
    expect(shouldRouteTap({ id: 'n2', handled: new Set(['n1']) })).toBe(true);
  });

  it('routes an id-less response rather than dropping it', () => {
    // A missed dedupe is a doubled screen; a missed route is a booking the
    // guest cannot reach from the notification they tapped.
    expect(shouldRouteTap({ id: null, handled: new Set(['n1']) })).toBe(true);
  });
});

describe('tapDestination', () => {
  it('routes the booking kinds to their reservation', () => {
    expect(tapDestination({ reservation_id: 'res-1' })).toBe('res-1');
  });

  it('routes nowhere for the test notification, which carries no reservation', () => {
    expect(tapDestination({ reservation_id: undefined })).toBeNull();
    expect(tapDestination(undefined)).toBeNull();
  });

  it('ignores a non-string reservation id rather than navigating to garbage', () => {
    expect(tapDestination({ reservation_id: 42 })).toBeNull();
    expect(tapDestination({ reservation_id: '' })).toBeNull();
  });
});
