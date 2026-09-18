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
