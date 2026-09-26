import { describe, expect, it } from 'vitest';
import { onDeviceSchemeChange, onForeground } from '../appearanceEvents';

/**
 * THE REPORTED BUG, as a table.
 *
 * The user flipped the phone to dark while the app was on the Book tab and came
 * back to a half-flipped screen: white header and footer, the court band still
 * on the dark page colour. The cause was not the court — it was that changing
 * the system appearance means leaving the app, the crossfade awaited an
 * rAF-driven animation that cannot advance while backgrounded, and the theme
 * commit behind it never ran.
 *
 * These cover the decision that fixes it, including the excursion itself:
 * background → flip → return.
 */

const AUTO = 'automatic' as const;

describe('onDeviceSchemeChange', () => {
  it('applies outright when merely inactive (the Control Center shade)', () => {
    // THE REPORTED CASE: "the court bg should render for dark mode even when
    // the Control Center is open."
    //
    // Crossfading here looks right — the app IS still on screen under the shade
    // — but it cannot work: the dissolve awaits an `Animated.timing`, rAF does
    // not advance while the app is not active, and the palette commit sits
    // behind that fade until dismissal. Cutting means the React tree is already
    // in the new palette while the shade is still down, which is also what
    // gives Court3D's cover the new page colour to paint over the GL surface
    // (expo-gl will not flush a framebuffer while the app is inactive).
    expect(
      onDeviceSchemeChange({
        preference: AUTO,
        device: 'dark',
        painted: 'light',
        appState: 'inactive',
      }),
    ).toEqual({ type: 'apply', appearance: 'dark' });
  });

  it('still applies outright when genuinely backgrounded', () => {
    // The one state where rAF really is suspended: a dissolve started here
    // cannot advance and would strand the cover over a half-flipped tree.
    expect(
      onDeviceSchemeChange({
        preference: AUTO,
        device: 'dark',
        painted: 'light',
        appState: 'background',
      }),
    ).toEqual({ type: 'apply', appearance: 'dark' });
  });

  it('crossfades when the flip arrives with the app in the foreground', () => {
    // A scheduled sundown, or a second device changing the setting: the user is
    // watching, so the design's dissolve is correct and CAN run.
    expect(
      onDeviceSchemeChange({
        preference: AUTO,
        device: 'dark',
        painted: 'light',
        appState: 'active',
      }),
    ).toEqual({ type: 'crossfade', appearance: 'dark' });
  });

  it('ignores the device entirely under an explicit preference', () => {
    for (const preference of ['light', 'dark'] as const) {
      expect(
        onDeviceSchemeChange({ preference, device: 'dark', painted: 'light', appState: 'active' }),
      ).toEqual({ type: 'none' });
    }
  });

  it('does nothing when the device already matches what is painted', () => {
    expect(
      onDeviceSchemeChange({
        preference: AUTO,
        device: 'dark',
        painted: 'dark',
        appState: 'background',
      }),
    ).toEqual({ type: 'none' });
  });

  it('handles dark → light as well as light → dark', () => {
    expect(
      onDeviceSchemeChange({
        preference: AUTO,
        device: 'light',
        painted: 'dark',
        appState: 'background',
      }),
    ).toEqual({ type: 'apply', appearance: 'light' });
  });
});

describe('onForeground', () => {
  it('reconciles a change the OS never delivered an event for', () => {
    // iOS can change the scheme while the app is SUSPENDED and deliver nothing
    // on return. Without this the app repaints the old theme and nothing else
    // is scheduled to correct it — the half-flipped screen, permanently.
    expect(
      onForeground({ preference: AUTO, device: 'dark', painted: 'light', appState: 'active' }),
    ).toEqual({ type: 'apply', appearance: 'dark' });
  });

  it('never crossfades on return: the change happened off-screen', () => {
    const action = onForeground({
      preference: AUTO,
      device: 'dark',
      painted: 'light',
      appState: 'active',
    });
    expect(action.type).not.toBe('crossfade');
  });

  it('does nothing on the way OUT of the foreground', () => {
    for (const appState of ['background', 'inactive']) {
      expect(
        onForeground({ preference: AUTO, device: 'dark', painted: 'light', appState }),
      ).toEqual({ type: 'none' });
    }
  });

  it('does nothing when the theme is already correct', () => {
    expect(
      onForeground({ preference: AUTO, device: 'dark', painted: 'dark', appState: 'active' }),
    ).toEqual({ type: 'none' });
  });

  it('leaves an explicit preference alone on return', () => {
    expect(
      onForeground({ preference: 'light', device: 'dark', painted: 'light', appState: 'active' }),
    ).toEqual({ type: 'none' });
  });
});

describe('the excursion: background → flip → return', () => {
  /** Replays the user's exact sequence and reports what the app ends up painting. */
  function excursion(opts: { deliversEvent: boolean; startPainted: 'light' | 'dark' }) {
    let painted = opts.startPainted;
    const device = painted === 'light' ? ('dark' as const) : ('light' as const);
    const apply = (a: { type: string; appearance?: 'light' | 'dark' }) => {
      if (a.type === 'apply' && a.appearance) painted = a.appearance;
      // A crossfade backgrounded is the bug: it would not complete, so the
      // model deliberately does NOT move `painted` for one.
    };
    // 1. The user leaves the app for Control Center.
    const appState = 'background';
    // 2. The device flips. The OS may or may not tell us while we are away.
    if (opts.deliversEvent) {
      apply(onDeviceSchemeChange({ preference: AUTO, device, painted, appState }));
    }
    // 3. The user returns.
    apply(onForeground({ preference: AUTO, device, painted, appState: 'active' }));
    return { painted, device };
  }

  it('ends on the device scheme when the OS delivered the event', () => {
    const { painted, device } = excursion({ deliversEvent: true, startPainted: 'light' });
    expect(painted).toBe(device);
  });

  it('ends on the device scheme even when the OS delivered NOTHING', () => {
    // The path that has no listener to save it — only the foreground reconcile.
    const { painted, device } = excursion({ deliversEvent: false, startPainted: 'light' });
    expect(painted).toBe(device);
  });

  it('works in the dark → light direction too', () => {
    for (const deliversEvent of [true, false]) {
      const { painted, device } = excursion({ deliversEvent, startPainted: 'dark' });
      expect(painted).toBe(device);
    }
  });

  it('is idempotent: a second return changes nothing', () => {
    const { painted, device } = excursion({ deliversEvent: true, startPainted: 'light' });
    const again = onForeground({ preference: AUTO, device, painted, appState: 'active' });
    expect(again).toEqual({ type: 'none' });
  });
});
