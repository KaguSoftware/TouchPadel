import { describe, expect, it } from 'vitest';
import { claimSwitch, isLiveSwitch, type SwitchGeneration } from '../switchGeneration';

/**
 * THE CONTROL CENTER GLITCH, as a table.
 *
 * Flipping the system appearance means leaving the app, so the change arrives
 * while AppState is 'inactive' (the shade part-way down) or 'background'. The
 * provider commits outright there instead of crossfading — but the crossfade it
 * abandoned cannot be cancelled, because every await in it resolves come what
 * may (settleAnimation). Its tail therefore lands afterwards and, before the
 * ticket, cleared `inFlight` and `switching` unconditionally: a newer switch
 * lost its re-entrancy guard mid-fade, a third could start on top of it, and the
 * cover was left stranded over the old palette or cut away before the commit.
 *
 * These pin the rule that fixes it: a phase may only write shared state while
 * it still holds the live ticket.
 */

function generation(): SwitchGeneration {
  return { current: 0 };
}

describe('claimSwitch', () => {
  it('hands out increasing tickets', () => {
    const g = generation();
    expect(claimSwitch(g)).toBe(1);
    expect(claimSwitch(g)).toBe(2);
  });

  it('makes the ticket it returns the live one', () => {
    const g = generation();
    const ticket = claimSwitch(g);
    expect(isLiveSwitch(g, ticket)).toBe(true);
  });
});

describe('isLiveSwitch', () => {
  it('keeps a switch live across its own phases', () => {
    // A crossfade checks its ticket at several awaits; nothing else has run,
    // so every one of them must proceed.
    const g = generation();
    const ticket = claimSwitch(g);
    expect(isLiveSwitch(g, ticket)).toBe(true);
    expect(isLiveSwitch(g, ticket)).toBe(true);
  });

  it('retires a crossfade that an outright commit superseded', () => {
    // THE REPORTED CASE: a crossfade is mid-fade when the Control Center flip
    // arrives, and `applyNow` claims a ticket to abandon it.
    const g = generation();
    const crossfade = claimSwitch(g);
    claimSwitch(g); // applyNow
    expect(isLiveSwitch(g, crossfade)).toBe(false);
  });

  it('retires a crossfade that a newer crossfade superseded', () => {
    const g = generation();
    const first = claimSwitch(g);
    const second = claimSwitch(g);
    expect(isLiveSwitch(g, first)).toBe(false);
    // ...and the newer one is unaffected by the older one's tail landing.
    expect(isLiveSwitch(g, second)).toBe(true);
  });

  it('does not let a stale tail revive itself', () => {
    // The tail runs its checks after being superseded; it must stay retired
    // no matter how many times it asks.
    const g = generation();
    const stale = claimSwitch(g);
    claimSwitch(g);
    expect(isLiveSwitch(g, stale)).toBe(false);
    expect(isLiveSwitch(g, stale)).toBe(false);
  });

  it('retires the OLDEST of several abandoned switches, not just the last', () => {
    // A rapid flip-flop at the Control Center: several switches abandoned in a
    // row, every one of their tails still to land.
    const g = generation();
    const first = claimSwitch(g);
    const second = claimSwitch(g);
    const third = claimSwitch(g);
    expect(isLiveSwitch(g, first)).toBe(false);
    expect(isLiveSwitch(g, second)).toBe(false);
    expect(isLiveSwitch(g, third)).toBe(true);
  });

  it('treats a ticket from before any switch as stale', () => {
    // The commit effect reads the counter rather than claiming; on the initial
    // render there is no switch to belong to.
    const g = generation();
    const beforeAnySwitch = g.current;
    claimSwitch(g);
    expect(isLiveSwitch(g, beforeAnySwitch)).toBe(false);
  });
});
