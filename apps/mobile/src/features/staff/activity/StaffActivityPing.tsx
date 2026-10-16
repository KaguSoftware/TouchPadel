/**
 * The staff phone's side of the owner's activity monitor (0341).
 *
 * While a staff account is signed in (any role, the owner too) the phone tells
 * the server it is here: "active" on mount, every minute in the foreground and
 * on each new page, "background" when the app leaves the screen. "Signed out"
 * is sent by useStaffSignOut right before the session goes. A guest never
 * pings (the server would refuse it). Every failure is silent: no toast, no
 * retry; the next minute's ping is the retry.
 *
 * Mounted once in the root layout, inside StaffStatusProvider, beside
 * StaffScreenGuard. The timing rules are logic.ts's (`shouldPing`).
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { useStaffStatus } from '../StaffStatusProvider';
import { pingsHeld, sendActivityPing } from './api';
import {
  PING_INTERVAL_MS,
  appStateToPing,
  pingScreen,
  shouldPing,
  type PingState,
  type SentPing,
} from './logic';

export function StaffActivityPing() {
  const { status } = useStaffStatus();
  const staff = status.kind === 'staff';
  const pathname = usePathname();
  const screen = useRef('/');
  const last = useRef<SentPing | null>(null);
  const inFlight = useRef(false);
  /** A state asked for while a ping was in flight: sent when it lands (e.g. "background"). */
  const queued = useRef<PingState | null>(null);
  screen.current = pingScreen(pathname);

  const ping = useRef(function ping(state: PingState) {
    const now = Date.now();
    if (pingsHeld(now)) return;
    if (inFlight.current) {
      queued.current = state;
      return;
    }
    const next = { state, screen: screen.current };
    if (!shouldPing(last.current, next, now)) return;
    inFlight.current = true;
    last.current = { ...next, at: now };
    sendActivityPing(state, next.screen)
      .catch(() => {
        // Silent; let the next ping go as soon as it is due.
        last.current = null;
      })
      .finally(() => {
        inFlight.current = false;
        const again = queued.current;
        queued.current = null;
        if (again) ping(again);
      });
  }).current;

  useEffect(() => {
    if (!staff) {
      last.current = null;
      return;
    }
    if (AppState.currentState === 'active') ping('active');
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') ping('active');
    }, PING_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      const state = appStateToPing(next);
      if (state) ping(state);
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [staff, ping]);

  // A new page while in the foreground.
  useEffect(() => {
    if (staff && AppState.currentState === 'active') ping('active');
  }, [staff, pathname, ping]);

  return null;
}
