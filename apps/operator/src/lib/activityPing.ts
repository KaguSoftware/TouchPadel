/**
 * When the operator tells the server "this person is here" (0341,
 * app.staff_activity_ping), for the owner's activity monitor
 * (/observation/activity). Pure, so the timing is tested under node; the hook
 * that sends is lib/useActivityPing.ts.
 *
 *   mount        'active' (or 'background' when the window opens hidden)
 *   tick         'active' every 60 s, only while the window is visible
 *   route        'active' when the screen changes
 *   hidden       'background' the moment the window is hidden
 *   visible      'active' the moment it is back
 *   signOut      'signed_out', sent by AuthProvider.signOut before it signs out
 *
 * The server keeps one write per 20 s per row unless the state or the screen
 * changed; the same rule here saves the request as well.
 */

export type PingState = 'active' | 'background' | 'signed_out';
export type PingEvent = 'mount' | 'tick' | 'route' | 'hidden' | 'visible' | 'signOut';

/** How often a visible window says it is still here. */
export const PING_INTERVAL_MS = 60_000;
/** The server's throttle (0341): an unchanged ping inside it is not sent. */
export const PING_MIN_GAP_MS = 20_000;
/** The sign-out ping's deadline: sign-out never waits longer than this. */
export const SIGN_OUT_PING_TIMEOUT_MS = 1_500;

export interface LastPing {
  state: PingState;
  screen: string | null;
  at: number;
}

/** The state an event reports, or null when it reports nothing. */
export function pingStateFor(event: PingEvent, visible: boolean): PingState | null {
  switch (event) {
    case 'signOut':
      return 'signed_out';
    case 'hidden':
      return 'background';
    case 'visible':
      return 'active';
    case 'mount':
      return visible ? 'active' : 'background';
    case 'tick':
    case 'route':
      // A hidden window is already filed as background; a tick or a route
      // change behind it is not the person using the app.
      return visible ? 'active' : null;
  }
}

/**
 * The ping to send now, or null. An identical state and screen inside the
 * server's 20 s window is skipped; a sign-out is always sent.
 */
export function nextPing(
  event: PingEvent,
  visible: boolean,
  screen: string | null,
  last: LastPing | null,
  now: number,
): LastPing | null {
  const state = pingStateFor(event, visible);
  if (!state) return null;
  const next: LastPing = { state, screen, at: now };
  if (state === 'signed_out' || !last) return next;
  if (last.state === state && last.screen === screen && now - last.at < PING_MIN_GAP_MS) return null;
  return next;
}

/** The screen as the monitor shows it: the route's path, no query or hash, no trailing slash. */
export function screenOf(pathname: string): string {
  return pathname.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
}

/** The version stamped on the ping: a real one, or null. */
export function pingVersion(version: string | null | undefined): string | null {
  const v = version?.trim();
  return v ? v : null;
}
