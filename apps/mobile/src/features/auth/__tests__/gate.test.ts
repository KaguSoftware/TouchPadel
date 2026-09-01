import { describe, expect, it } from 'vitest';
import { noSessionGate, sessionGate } from '../gate';

/**
 * These rules used to live in the `(auth)` and `(gated)` layouts. Both groups
 * were flattened onto the root stack so every screen gets UIKit's own back item
 * (a screen entered from another navigator had no history of its own, so the
 * system drew no back item and a hand-rolled one had to stand in). The guards
 * moved to the screens; these tests pin the behaviour that move had to preserve.
 */

describe('sessionGate — signed-in only screens', () => {
  it('waits while auth is initializing, whatever the session looks like', () => {
    // Redirecting here would flash /welcome at a signed-in user on every cold
    // start, before the stored session has been read back.
    expect(sessionGate({ initializing: true, hasSession: false })).toBe('loading');
    expect(sessionGate({ initializing: true, hasSession: true })).toBe('loading');
  });

  it('redirects a signed-out user away', () => {
    expect(sessionGate({ initializing: false, hasSession: false })).toBe('redirect');
  });

  it('renders the screen for a signed-in user', () => {
    expect(sessionGate({ initializing: false, hasSession: true })).toBe('allow');
  });

  it('never allows a screen without a session', () => {
    for (const initializing of [true, false]) {
      expect(sessionGate({ initializing, hasSession: false })).not.toBe('allow');
    }
  });
});

describe('noSessionGate — signed-out only screens', () => {
  it('waits while auth is initializing', () => {
    expect(noSessionGate({ initializing: true, hasSession: false, hasPendingSlot: false })).toBe(
      'loading',
    );
    expect(noSessionGate({ initializing: true, hasSession: true, hasPendingSlot: true })).toBe(
      'loading',
    );
  });

  it('bounces a signed-in user to the tabs', () => {
    expect(noSessionGate({ initializing: false, hasSession: true, hasPendingSlot: false })).toBe(
      'redirect',
    );
  });

  it('lets a guest through', () => {
    expect(noSessionGate({ initializing: false, hasSession: false, hasPendingSlot: false })).toBe(
      'allow',
    );
  });

  it('KEEPS a freshly signed-in user while a slot is pending', () => {
    // The booking continuation is mid-flight: it is about to place the hold and
    // route to Review. Redirecting the instant the session lands wins that race
    // and strands the guest on the tabs with the slot lost.
    expect(noSessionGate({ initializing: false, hasSession: true, hasPendingSlot: true })).toBe(
      'allow',
    );
  });

  it('bounces once the hold has settled and the intent is cleared', () => {
    expect(noSessionGate({ initializing: false, hasSession: true, hasPendingSlot: false })).toBe(
      'redirect',
    );
  });

  it('never bounces a guest, pending slot or not', () => {
    for (const hasPendingSlot of [true, false]) {
      expect(
        noSessionGate({ initializing: false, hasSession: false, hasPendingSlot }),
      ).toBe('allow');
    }
  });
});
