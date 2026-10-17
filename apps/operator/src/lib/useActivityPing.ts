/**
 * Tells the server who is on this operator and on which screen (0341,
 * app.staff_activity_ping), for the owner's activity monitor. When to ping is
 * lib/activityPing.ts; this file sends.
 *
 * NOT a queued mutation and never a toast: presence is worth nothing late, so
 * a ping that fails is simply dropped and the next one carries the truth.
 */
import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { appRpc } from './appRpc';
import { touch } from '../ipc/bridge';
import {
  PING_INTERVAL_MS,
  SIGN_OUT_PING_TIMEOUT_MS,
  nextPing,
  pingVersion,
  screenOf,
  type LastPing,
  type PingEvent,
} from './activityPing';

let last: LastPing | null = null;
let screen: string | null = null;

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function appVersion(): string | null {
  try {
    return pingVersion(touch.getStation().appVersion);
  } catch {
    return null;
  }
}

/** Send the ping an event calls for, if any. Never throws. */
export async function sendActivityPing(event: PingEvent, timeoutMs?: number): Promise<void> {
  const ping = nextPing(event, isVisible(), screen, last, Date.now());
  if (!ping) return;
  last = ping;
  try {
    await appRpc(
      'staff_activity_ping',
      { p_surface: 'operator', p_state: ping.state, p_screen: ping.screen, p_app_version: appVersion() },
      timeoutMs === undefined ? {} : { timeoutMs },
    );
  } catch {
    // Silent by design (see the header). Forget it so the next event retries.
    if (last === ping) last = null;
  }
}

/** The sign-out ping: best effort, at most SIGN_OUT_PING_TIMEOUT_MS. */
export async function sendSignedOutPing(): Promise<void> {
  try {
    await sendActivityPing('signOut', SIGN_OUT_PING_TIMEOUT_MS);
  } catch {
    /* never blocks sign-out */
  }
  last = null;
}

/**
 * Mounted once in the signed-in shell. `staffId` is the signed-in person, or
 * null while nobody is: a change of person starts over with a fresh ping.
 */
export function useActivityPing(staffId: string | null): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Declared first so the screen is known before the mount ping below. Before
  // that first ping (`last` null) the mount ping carries the screen itself.
  useEffect(() => {
    screen = screenOf(pathname);
    if (staffId && last) void sendActivityPing('route');
  }, [pathname, staffId]);

  useEffect(() => {
    if (!staffId) return;
    last = null;
    void sendActivityPing('mount');
    const timer = setInterval(() => void sendActivityPing('tick'), PING_INTERVAL_MS);
    const onVisibility = () => void sendActivityPing(isVisible() ? 'visible' : 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [staffId]);
}
