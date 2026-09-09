import { describe, expect, it } from 'vitest';
import { canAnimate, canDraw, isActive, isVisible } from '../surfaceState';

/**
 * THE STALE COURT, as a table.
 *
 * Reported as: flip the system theme from Control Center, and the app's
 * background only changes once the shade is fully closed. On the Book tab the
 * court is most of the screen, so the whole app appears to flip late.
 *
 * The cause was one conflation. The court is a GL surface — its framebuffer
 * changes only when a frame is drawn — and it gated drawing on a single
 * `active` boolean. iOS reports 'inactive' with the shade down, so the surface
 * was treated as dead at the exact moment the theme flip arrived — the loop was
 * torn down and no redraw was even requested, so nothing was queued to correct
 * the court.
 *
 * These pin the split: the rally pauses under the shade, while a redraw is
 * still requested there. Note the frame itself does not run until the shade is
 * dismissed (iOS pauses the display link), which is why Court3D pairs this with
 * a cover — see its `stale` flag.
 */

const READY = { ready: true, focused: true };

describe('isVisible / isActive', () => {
  it('counts the Control Center shade as visible but not active', () => {
    // The whole bug in two assertions.
    expect(isVisible('inactive')).toBe(true);
    expect(isActive('inactive')).toBe(false);
  });

  it('counts a genuinely backgrounded app as neither', () => {
    expect(isVisible('background')).toBe(false);
    expect(isActive('background')).toBe(false);
  });

  it('counts a frontmost app as both', () => {
    expect(isVisible('active')).toBe(true);
    expect(isActive('active')).toBe(true);
  });
});

describe('canDraw', () => {
  it('requests a redraw under the Control Center shade', () => {
    // THE REPORTED CASE: the flip lands here. iOS has paused the display link,
    // so the frame will not RUN until the shade is dismissed — but it must
    // still be requested, or nothing is queued to correct the court at all.
    // What keeps the band right meanwhile is Court3D's stale-frame cover, not
    // this frame.
    expect(canDraw({ ...READY, appState: 'inactive' })).toBe(true);
  });

  it('allows a redraw while frontmost', () => {
    expect(canDraw({ ...READY, appState: 'active' })).toBe(true);
  });

  it('refuses a redraw once genuinely backgrounded', () => {
    // rAF is suspended: the request would sit queued, which is what the
    // repaint flag is for instead.
    expect(canDraw({ ...READY, appState: 'background' })).toBe(false);
  });

  it('refuses a redraw before the surface exists or off-tab', () => {
    // No GL context to draw into, and no point drawing a tab nobody is on.
    expect(canDraw({ ready: false, focused: true, appState: 'active' })).toBe(false);
    expect(canDraw({ ready: true, focused: false, appState: 'active' })).toBe(false);
  });
});

describe('canAnimate', () => {
  it('pauses the rally under the Control Center shade', () => {
    // Visible, but nobody is watching a rally through the shade — and running
    // it there is battery spent on an invisible animation. THIS is the half
    // that legitimately stops at 'inactive'.
    expect(canAnimate({ ...READY, appState: 'inactive' })).toBe(false);
  });

  it('runs the rally only while frontmost', () => {
    expect(canAnimate({ ...READY, appState: 'active' })).toBe(true);
    expect(canAnimate({ ...READY, appState: 'background' })).toBe(false);
  });

  it('never animates what it may not draw', () => {
    // The invariant that keeps the two flags coherent: animating implies
    // drawable, for every lifecycle state.
    for (const appState of ['active', 'inactive', 'background', 'unknown']) {
      if (canAnimate({ ...READY, appState })) {
        expect(canDraw({ ...READY, appState })).toBe(true);
      }
    }
  });

  it('treats an unrecognised state as visible but not active', () => {
    // RN has reported 'unknown' on iOS during early launch. Drawing on demand
    // there is harmless; running the loop is not what we want by default.
    expect(canDraw({ ...READY, appState: 'unknown' })).toBe(true);
    expect(canAnimate({ ...READY, appState: 'unknown' })).toBe(false);
  });
});
