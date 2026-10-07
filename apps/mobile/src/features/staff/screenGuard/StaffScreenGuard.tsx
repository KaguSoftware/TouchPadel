/**
 * The staff area's screenshot guard (owner call 2026-10-07).
 *
 * While a staff account other than the owner is signed in, the phone:
 *   - blocks screenshots and screen recordings (Android: FLAG_SECURE, a black
 *     image; iOS cannot block a screenshot, it blanks recordings and the app
 *     switcher), and
 *   - reports every screenshot it hears of to the owner (`log_staff_screenshot`:
 *     an audit row and a push naming the person, the page in the audit row).
 *
 * It is mounted once in the root layout, inside StaffStatusProvider, so it
 * covers every staff screen and lets go the moment the account is not staff
 * (sign-out, a guest account), which keeps the guest app capturable.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { captureException } from '../../../lib/telemetry';
import { staffRpc } from '../api';
import { useStaffStatus } from '../StaffStatusProvider';

const GUARD_KEY = 'staff-screen-guard';
/** A report that fails (no signal) is tried again after these waits, then dropped with a log. */
const RETRY_MS = [2_000, 10_000, 60_000] as const;

/** The page the owner reads: the route as the router has it, kept to what the database accepts. */
export function reportedRoute(pathname: string | null | undefined): string {
  const clean = (pathname ?? '').replace(/[^A-Za-z0-9/_().[\]-]/g, '').slice(0, 120);
  return clean === '' ? '/' : clean;
}

async function report(venueId: string, route: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await staffRpc('log_staff_screenshot', { p_venue_id: venueId, p_route: route });
      return;
    } catch (err) {
      const wait = RETRY_MS[attempt];
      if (wait === undefined) {
        captureException(err, { scope: 'staff.screenshot.report', route });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

export function StaffScreenGuard() {
  const { status, venueId } = useStaffStatus();
  const pathname = usePathname();
  const guarded = status.kind === 'staff' && status.staff.role !== 'owner';
  const route = useRef('/');
  const venue = useRef<string | null>(null);
  route.current = reportedRoute(pathname);
  venue.current = venueId;

  useEffect(() => {
    if (!guarded) return;
    let cancelled = false;
    const run = async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync(GUARD_KEY);
        if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync();
        // Android 13 and older ask for a media permission to hear of a
        // screenshot; Android 14 and the iPhone need none. A refusal only
        // costs the report, never the block.
        if (Platform.OS === 'android' && Number(Platform.Version) < 34) {
          const have = await ScreenCapture.getPermissionsAsync();
          if (!have.granted && have.canAskAgain && !cancelled) {
            await ScreenCapture.requestPermissionsAsync();
          }
        }
      } catch (err) {
        captureException(err, { scope: 'staff.screenGuard.enable' });
      }
    };
    void run();
    const sub = ScreenCapture.addScreenshotListener(() => {
      const id = venue.current;
      if (id) void report(id, route.current);
    });
    return () => {
      cancelled = true;
      sub.remove();
      void ScreenCapture.allowScreenCaptureAsync(GUARD_KEY).catch(() => undefined);
      if (Platform.OS === 'ios') {
        void ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => undefined);
      }
    };
  }, [guarded]);

  return null;
}
