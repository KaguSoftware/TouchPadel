/**
 * The staff activity monitor's calls (0341): the owner's board, and the ping
 * every staff phone sends while someone is signed in (StaffActivityPing).
 */
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { staffRpc } from '../api';
import {
  SIGN_OUT_PING_TIMEOUT_MS,
  pingScreen,
  type ActivityBoard,
  type PingState,
} from './logic';

export const activityKeys = {
  /** Under the staff root, so it never reaches the disk cache (src/lib/queryClient.ts). */
  board: ['staff', 'activity', 'board'] as const,
};

/** The board refreshes this often while the screen is open. */
export const BOARD_REFRESH_MS = 30_000;

export async function fetchActivityBoard(): Promise<ActivityBoard> {
  const res = await staffRpc<ActivityBoard | null>('staff_activity_board', {});
  return { serverTime: res?.serverTime ?? new Date().toISOString(), rows: res?.rows ?? [] };
}

function appVersion(): string | null {
  return Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? null;
}

/** One ping. Throws what the server or the network threw; the caller stays silent about it. */
export async function sendActivityPing(state: PingState, screen: string): Promise<void> {
  await staffRpc('staff_activity_ping', {
    p_surface: 'mobile',
    p_state: state,
    p_screen: screen,
    p_app_version: appVersion(),
  });
}

/**
 * Until this time the foreground pings hold off: the phone is signing out, and
 * a minute's "active" landing after the "signed out" would undo it.
 */
let holdUntil = 0;

export function pingsHeld(nowMs: number): boolean {
  return nowMs < holdUntil;
}

/**
 * "Signed out", sent right before the session goes (useStaffSignOut). Best
 * effort: it never throws and never holds sign-out longer than
 * SIGN_OUT_PING_TIMEOUT_MS. A failure leaves the row to age to offline.
 */
export async function pingSignedOut(pathname: string | null | undefined): Promise<void> {
  holdUntil = Date.now() + 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendActivityPing('signed_out', pingScreen(pathname)).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SIGN_OUT_PING_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Never.
  } finally {
    if (timer) clearTimeout(timer);
  }
}
