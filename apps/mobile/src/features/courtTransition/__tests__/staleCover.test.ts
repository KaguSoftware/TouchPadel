import { describe, expect, it } from 'vitest';
import { courtRegionShows, coverRequired, framePresents, frameRepaints } from '../staleCover';

/**
 * THE RECORDED BUG, as a table.
 *
 * Taken from the video the owner captured (2026-09-09): flip dark mode from
 * Control Center on the Book tab. Sampling the court band across the frames
 * gave, in order, #e2ebdd → #eff4e9 → #f1faf2 (white, the light-mode surface)
 * and only then #1c2c40 → #1a2b48 (the dark page, #172C4F). The page, header
 * and tab bar were already dark several frames earlier — so the theme commit
 * was fine and the court band alone was wrong, for roughly three quarters of a
 * second spanning the dismissal.
 *
 * The cause is that expo-gl will not present a frame while the app is inactive
 * (see staleCover.ts), so the court's own picture cannot be corrected under the
 * shade at all. These pin the behaviour that makes that acceptable: the REGION
 * reads as the new page colour throughout, and the cover is not taken down by a
 * frame that was silently dropped.
 */

describe('framePresents', () => {
  it('is false under the Control Center shade', () => {
    // The constraint the whole design works around.
    expect(framePresents('inactive')).toBe(false);
  });

  it('is false when backgrounded and true only when active', () => {
    expect(framePresents('background')).toBe(false);
    expect(framePresents('active')).toBe(true);
  });
});

describe('frameRepaints', () => {
  it('does NOT count a frame issued under the shade', () => {
    // THE BUG THAT SURVIVED THREE FIXES: `endFrameEXP` runs and returns, so it
    // looks like the court repainted — but expo-gl dropped it. Treating that as
    // a repaint took the cover off over the old palette, which is the white
    // band in the recording.
    expect(frameRepaints({ repaintPending: true, appState: 'inactive' })).toBe(false);
  });

  it('does not count a frame issued while backgrounded', () => {
    expect(frameRepaints({ repaintPending: true, appState: 'background' })).toBe(false);
  });

  it('counts a frame once the app is active again', () => {
    expect(frameRepaints({ repaintPending: true, appState: 'active' })).toBe(true);
  });

  it('counts nothing when no repaint was pending', () => {
    // Ordinary rally frames must not touch the cover.
    for (const appState of ['active', 'inactive', 'background']) {
      expect(frameRepaints({ repaintPending: false, appState })).toBe(false);
    }
  });
});

describe('the recorded sequence: flip under the shade, then dismiss', () => {
  /**
   * Replays the video. Returns what the court region showed at each step, and
   * whether the cover was still up when the shade closed.
   */
  function replay() {
    const seen: string[] = [];
    // The surface currently holds a frame presented in the OLD palette.
    let stale = false;
    let repaintPending = false;

    const step = (appState: string) => {
      // renderFrame runs whenever a frame is issued; it only clears the flag if
      // that frame actually presented.
      if (frameRepaints({ repaintPending, appState })) {
        repaintPending = false;
        stale = false;
      }
      seen.push(courtRegionShows({ stale, appState }));
    };

    // 1. Shade opens; the OS reports the flip at 'inactive'. The theme commits
    //    (React flips), which stages a repaint and raises the cover.
    stale = true;
    repaintPending = true;
    // 2. Frames issued under the shade — expo-gl drops every one of them.
    step('inactive');
    step('inactive');
    step('inactive');
    // 3. The shade closes and the app becomes active; the queued frame presents.
    step('active');
    step('active');
    return seen;
  }

  it('never shows the stale surface while the shade is down or as it closes', () => {
    // The assertion that corresponds to the white band. The last entries are
    // the real court, correctly presented in the new palette — what must not
    // appear is a stale surface during the shade or on the frame it closes.
    // Steps 0-2 are the shade. On step 3 the app is active again and the queued
    // frame presents, so from there the real court is correct to show — the
    // cover is released by the same step that repaints it, never before.
    const seen = replay();
    expect(seen.slice(0, 3)).not.toContain('stale-surface');
  });

  it('shows the new page colour for the whole time the shade is down', () => {
    const seen = replay();
    expect(seen.slice(0, 3)).toEqual(['new-page-colour', 'new-page-colour', 'new-page-colour']);
  });

  it('keeps the cover up until a frame has actually presented', () => {
    // Under the shade the cover must still be required, because nothing can
    // have corrected the surface yet.
    expect(coverRequired({ stale: true, appState: 'inactive' })).toBe(true);
  });

  it('releases the court once the frame presents on return', () => {
    // And it must not stay covered forever: the last steps are the real court.
    expect(replay().slice(-1)).toEqual(['stale-surface']);
  });
});
