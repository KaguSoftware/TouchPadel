/**
 * PostHog guest analytics — loader + thin capture API.
 *
 * Rules this file enforces (web-slice §5, decisions.md §5a):
 *  - GUEST APP ONLY. Never import this from the operator or any staff surface.
 *  - No key -> no-op. The venue has no PostHog project yet; everything must
 *    degrade silently so the menu never depends on analytics being configured.
 *  - Lazy: the SDK is imported on idle so it never competes with LCP.
 *  - No autocapture, no session recording, no cookies (localStorage only),
 *    never `identify()` — guests stay anonymous.
 *  - One kill switch: `localStorage['tp-analytics'] = 'off'` (also settable by
 *    visiting any page with `?analytics=off`, for staff/demo phones).
 *
 * NOTE: `process.env.NEXT_PUBLIC_*` must stay literal member expressions so
 * Next inlines them into the client bundle (same rule as supabase/env.ts).
 */

const KILL_KEY = 'tp-analytics';
const DEFAULT_HOST = 'https://eu.i.posthog.com';

type PostHogLike = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, props?: Record<string, unknown>, opts?: Record<string, unknown>) => void;
  register: (props: Record<string, unknown>) => void;
  __loaded?: boolean;
};

let client: PostHogLike | null = null;
let loading = false;
/** Super-properties registered before the SDK finished loading. */
let pendingSuperProps: Record<string, unknown> = {};

function publicKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key && key.length > 0 ? key : undefined;
}

function host(): string {
  const h = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return h && h.length > 0 ? h : DEFAULT_HOST;
}

/** True when the viewer (or a staff phone) has switched analytics off. */
export function isDisabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (new URLSearchParams(window.location.search).get('analytics') === 'off') {
      window.localStorage.setItem(KILL_KEY, 'off');
      return true;
    }
    return window.localStorage.getItem(KILL_KEY) === 'off';
  } catch {
    // Private mode / blocked storage: fail open (tracking off).
    return true;
  }
}

/** Analytics can only run with a key, in a browser, and without the kill switch. */
export function isEnabled(): boolean {
  return typeof window !== 'undefined' && publicKey() !== undefined && !isDisabled();
}

function onIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 2000 });
  else window.setTimeout(fn, 2000);
}

/**
 * Start analytics. Safe to call repeatedly (idempotent) and safe to call when
 * unconfigured — it simply returns.
 */
export function initAnalytics(locale: string): void {
  if (!isEnabled() || client || loading) return;
  loading = true;
  pendingSuperProps = { ...pendingSuperProps, locale };
  onIdle(() => {
    void import('posthog-js')
      .then((mod) => {
        const ph = (mod.default ?? mod) as unknown as PostHogLike;
        ph.init(publicKey() as string, {
          api_host: host(),
          autocapture: false,
          disable_session_recording: true,
          capture_pageview: true,
          capture_pageleave: true,
          person_profiles: 'identified_only',
          persistence: 'localStorage',
          // The venue has no consent banner; the kill switch above is the opt-out.
          opt_out_capturing_by_default: false,
        });
        client = ph;
        if (Object.keys(pendingSuperProps).length > 0) ph.register(pendingSuperProps);
      })
      .catch(() => {
        // Analytics must never break the menu.
        loading = false;
      });
  });
}

/**
 * Register/refresh super-properties (locale, has_table, table_number). Values
 * set before the SDK loads are applied at init.
 */
export function registerSuperProps(props: Record<string, unknown>): void {
  pendingSuperProps = { ...pendingSuperProps, ...props };
  if (client) {
    try {
      client.register(props);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Fire one event. Drops silently until the SDK is loaded — the first second of
 * interactions is not worth a replay queue.
 */
export function capture(
  event: string,
  props?: Record<string, unknown>,
  opts?: { transport?: 'sendBeacon' },
): void {
  if (!client) return;
  try {
    client.capture(event, props, opts as Record<string, unknown> | undefined);
  } catch {
    /* analytics must never throw into the UI */
  }
}

/** Test seam. */
export function __resetAnalyticsForTests(): void {
  client = null;
  loading = false;
  pendingSuperProps = {};
}
