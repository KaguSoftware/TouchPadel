import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecoverySession,
  hasRecoverySession,
  markRecoverySession,
  subscribeRecoverySession,
} from '../recovery';

/**
 * The reset-password form renders only while this marker is set (S6,
 * 2026-09-20). What must not drift: it starts unset, it is set by an explicit
 * call only, and subscribers see every transition — the screen relies on the
 * subscription to flip from "waiting for the link" to the form.
 */

afterEach(() => clearRecoverySession());

describe('recovery session marker', () => {
  it('starts unset — a plain signed-in session is not a recovery session', () => {
    expect(hasRecoverySession()).toBe(false);
  });

  it('is set and cleared explicitly', () => {
    markRecoverySession();
    expect(hasRecoverySession()).toBe(true);
    clearRecoverySession();
    expect(hasRecoverySession()).toBe(false);
  });

  it('notifies subscribers on each transition, and only on a transition', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecoverySession(listener);
    markRecoverySession();
    markRecoverySession(); // idempotent: the deep-link hook and GoTrue's event both mark
    expect(listener).toHaveBeenCalledTimes(1);
    clearRecoverySession();
    clearRecoverySession();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    markRecoverySession();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
