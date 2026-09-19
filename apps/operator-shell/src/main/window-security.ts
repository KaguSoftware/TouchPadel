import { URL } from 'node:url';

/**
 * Navigation policy for the operator window.
 *
 * The window previously had NO `will-navigate` / `will-redirect` handler, so
 * nothing stopped the renderer navigating the top-level frame to arbitrary
 * remote content — with the preload, and therefore `window.touch` (the durable
 * write queue, the PIN unlock, the printer), still attached to it. And
 * `setWindowOpenHandler` passed whatever URL it was given straight to
 * `shell.openExternal`, which hands it to the OS protocol handler: `file:`,
 * `smb:` and every registered custom scheme included.
 *
 * These are pure functions so the policy is testable without an Electron
 * runtime — the window wiring in index.ts is then trivially thin.
 */

/** Schemes we will hand to the operating system. Nothing else, ever. */
const EXTERNAL_SCHEMES_PROD = new Set(['https:']);
const EXTERNAL_SCHEMES_DEV = new Set(['https:', 'http:']);

export interface NavigationPolicy {
  /** The dev server origin, when running against `vite dev`. */
  devServerUrl?: string;
  isDev: boolean;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * May the top-level frame navigate here?
 *
 * Packaged builds load the renderer from `file:` and must never leave it.
 * In development the Vite dev server origin is also allowed, because HMR
 * navigates within it.
 */
export function mayNavigateTo(url: string, policy: NavigationPolicy): boolean {
  const target = parse(url);
  if (!target) return false;

  if (target.protocol === 'file:') return true;

  if (policy.isDev && policy.devServerUrl) {
    const dev = parse(policy.devServerUrl);
    if (dev && target.origin === dev.origin) return true;
  }
  return false;
}

/**
 * May this URL be opened in the user's own browser?
 *
 * Only `https:` in a shipped build. `http:` is allowed in development for
 * local docs and the Supabase studio; nothing else in either mode.
 */
export function mayOpenExternally(url: string, policy: NavigationPolicy): boolean {
  const target = parse(url);
  if (!target) return false;
  const allowed = policy.isDev ? EXTERNAL_SCHEMES_DEV : EXTERNAL_SCHEMES_PROD;
  return allowed.has(target.protocol);
}

/** Chromium's ERR_ABORTED: a load superseded by another, not a failure. */
const ERR_ABORTED = -3;

/**
 * Should a failed load send the window back to the renderer's index.html?
 *
 * The renderer is one file on disk. A top-level `file:` load of anything else
 * — a stale pushState path like file:///C:/till from before the router used
 * hash history, reloaded by Ctrl+R or by the crash recovery — fails with
 * ERR_FILE_NOT_FOUND and leaves a white window a kiosk cannot get out of.
 * Only file: loads qualify (the dev server reports its own errors), never
 * index.html itself (a missing renderer would loop), never subframes, and
 * never ERR_ABORTED.
 */
export function shouldRecoverToRenderer(
  failed: { url: string; errorCode: number; isMainFrame: boolean },
  rendererUrl: string,
): boolean {
  if (!failed.isMainFrame || failed.errorCode === ERR_ABORTED) return false;
  const target = parse(failed.url);
  const renderer = parse(rendererUrl);
  if (!target || !renderer || target.protocol !== 'file:') return false;
  return target.pathname !== renderer.pathname;
}

/**
 * Should this window carry native macOS traffic lights?
 *
 * On a till or a KDS the window is a kiosk by design (design-arch.md §2.5) and
 * the only way out is Quit to desktop or "Exit forced full screen" — a close
 * button there would be a second, unaudited exit. Every other window on macOS
 * is a machine somebody actually drives: dev, a station that has not been set
 * up yet, and a desk station. Those get the real OS buttons.
 *
 * macOS only: Windows draws no traffic lights, and its frameless windows stay
 * as they were.
 */
export function shouldShowTrafficLights(chrome: {
  platform: NodeJS.Platform;
  isDev: boolean;
  configured: boolean;
  mode: 'till' | 'desk' | 'kds';
}): boolean {
  if (chrome.platform !== 'darwin') return false;
  if (chrome.isDev || !chrome.configured) return true;
  return chrome.mode === 'desk';
}


/**
 * The narrowest the shell can be before a screen's own columns start to clip,
 * derived rather than guessed — every term is a number the renderer actually
 * uses, so this moves when the layout does.
 *
 * The till is the widest screen in the app and therefore the one that sets the
 * floor (TillScreen.tsx): three columns whose minimums are 11rem + 17rem +
 * 16rem, and its comment records that at 1100px the menu and basket were
 * already being squeezed. Beside it sit the rail, the main padding and the
 * column gaps:
 *
 *   rail            208px   --tp-rail-w
 *   main padding     48px   --tp-sp-5 (1.5rem) each side
 *   column gaps      32px   --tp-sp-4 (1rem) x2
 *   till columns    704px   44rem at the 16px root
 *   ------------------------------------------------
 *                   992px
 *
 * At the 16px root, deliberately: --tp-fs scales to 17px only above 1600px
 * (GlobalStyles), so every width at this size is measured in 16px rem.
 *
 * Rounded up to 1024 for a little slack — this is the point where the layout
 * stops being merely tight and starts losing content, not a comfortable size.
 */
export const LAYOUT_MIN_WIDTH = 1024;

/**
 * Height is set by what has to be visible at once, not by a single screen:
 * the venue strip (34px), a workspace's header and toolbar, and the footer of
 * a modal — day close and payment are the tallest — which must never be pushed
 * off the bottom, because its buttons are how the operator finishes the job.
 *
 * 700 keeps those on screen. It is also low enough to fit every Mac's work
 * area, including an 11" Air's 768 and a 1280x720 projector.
 */
export const LAYOUT_MIN_HEIGHT = 700;

/**
 * The window's minimum size, clamped to a display that cannot hold it.
 *
 * A minimum larger than the screen is worse than none: macOS honours it, the
 * window extends past the work area, and the bottom of the app — day close,
 * a modal's buttons — becomes unreachable with no way to shrink it. The floor
 * above fits every Mac, but a projector, a scaled 4K display set to a huge
 * resolution, or a small secondary screen can still be smaller.
 *
 * So the floor is only ever as large as the work area it has to live in, which
 * is what makes it per-device: each station gets the smallest window its own
 * layout allows, and never one its screen cannot show.
 */
export function clampWindowMinimum(
  floor: { width: number; height: number },
  workArea: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.min(floor.width, workArea.width),
    height: Math.min(floor.height, workArea.height),
  };
}

/**
 * The size the window OPENS at.
 *
 * Electron's default is 800x600, which is below the layout floor — so the app
 * opened cramped and then jumped to the minimum on the first drag, because
 * that is when macOS applies minWidth/minHeight. The opening size has to
 * respect the floor itself for the jump to disappear.
 *
 * A share of the work area rather than a fixed size: a station on a 27" screen
 * should not open in a 1024px box, and a 13" laptop should not open larger
 * than its own desktop. The result is then held above the floor and below the
 * work area, so it is always both usable and fully on screen.
 */
export function openingWindowSize(
  floor: { width: number; height: number },
  workArea: { width: number; height: number },
  /** How much of the work area to take. 0.9 leaves the dock and a margin. */
  share = 0.9,
): { width: number; height: number } {
  const fit = (want: number, floorPx: number, available: number): number =>
    // Floor first, then the work area: on a screen too small for the floor the
    // work area wins, because a window larger than the desktop cannot be moved
    // back into view. Same precedence as clampWindowMinimum.
    Math.min(Math.max(Math.round(want), floorPx), available);
  return {
    width: fit(workArea.width * share, floor.width, workArea.width),
    height: fit(workArea.height * share, floor.height, workArea.height),
  };
}
