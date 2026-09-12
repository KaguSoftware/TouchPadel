/**
 * Expo push — the ONE module that touches expo-notifications (dynamic imports:
 * the native module is absent in Expo Go / web / vitest, and importing it in
 * Expo Go red-boxes on Android). Fully guarded: simulators, dev builds without
 * the module, and permission denials all resolve to a non-throwing result.
 *
 *   registerPushToken          permission prompt + token -> profiles.expo_push_token
 *   startPushRegistrationLifecycle  keeps that token present and CURRENT
 *   getPushPermissionState     passive probe for the Settings screen
 *   installNotificationHandler foreground display + Android channel + tap routing
 *
 * WHY THE LIFECYCLE EXISTS (audit 2026-09-12). The server refuses to enqueue a
 * notification at all when profiles.expo_push_token is null — the trigger
 * (migration 0075) returns early, so no row is written and NOTHING backfills
 * when a token arrives later. A missing or stale token is therefore not a
 * delayed notification, it is a permanently lost one. Registration used to run
 * only on a Book-tab render, which left three live holes:
 *   - sign up -> book immediately: the booking commits before any token exists;
 *   - the OS rotates the token (reinstall, restore, APNs/FCM churn): the row
 *     names a device that no longer answers and nothing notices;
 *   - sign out nulls the token (SEC-21) and signing back in never rewrote it
 *     unless the Book tab happened to mount.
 * So: register on SIGN-IN, re-check on every FOREGROUND, and follow Expo's own
 * token-rotation event. The write is idempotent and cheap.
 *
 * The server half is migration 0024 (outbox + trigger), 0048 (cron nudge),
 * 0070 (Settings test push) and the send-push edge function.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
// Type-only: erased at compile time, so the native module is still loaded
// through the guarded dynamic imports below and nowhere else.
import type * as ExpoNotifications from 'expo-notifications';

import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { updatePushToken } from './api';
import {
  shouldPersistToken,
  shouldRouteTap,
  shouldSync,
  tapDestination,
  type PushPermissionState,
} from './pushSync';

export { permissionStateAfter } from './pushSync';

/**
 * `unavailable` is a real outcome (simulator, Expo Go, no native module) and
 * `failed` is a fault we could not attribute — before the audit both were
 * reported as `unavailable`, so a network blip told the guest their phone does
 * not support notifications. Settings renders the two differently.
 */
export type PushRegistrationResult = 'registered' | 'denied' | 'unavailable' | 'failed';

/**
 * Android 8+ shows nothing (and plays nothing) for a notification whose channel
 * does not exist. send-push sends no channelId, so Expo delivers on 'default';
 * the channel is created here, before the first token is ever requested, and
 * again at every boot (idempotent) so an install that predates it catches up.
 */
const ANDROID_CHANNEL = 'default';

type NotificationsModule = typeof ExpoNotifications;

async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Touch Padel',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3360AB',
  });
}

/**
 * getExpoPushTokenAsync() infers the EAS project from the manifest, and throws
 * when it cannot. That inference is exactly what breaks in a bare dev client or
 * a stale OTA manifest, and the throw used to be swallowed as 'unavailable'.
 * Passing it explicitly removes the inference: the id is a build-time constant
 * (app.config.ts extra.eas.projectId), not an environment secret.
 */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? undefined;
}

/**
 * The last token this app instance successfully wrote, so the foreground
 * re-check is a no-op string compare rather than a write per resume. Cleared on
 * sign-out (the row is nulled server-side, so the next sign-in MUST rewrite).
 */
let lastWrittenToken: string | null = null;

/** Sign-out nulls the column server-side; forget it here so we rewrite later. */
export function forgetWrittenPushToken(): void {
  lastWrittenToken = null;
}

/**
 * Write the token unless this instance already wrote exactly that value.
 * `force` bypasses the cache for the rotation listener, where the point is that
 * the value changed underneath us.
 */
async function persistToken(token: string, force = false): Promise<boolean> {
  if (!shouldPersistToken({ token, lastWritten: lastWrittenToken, force })) return true;
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return false;
  await updatePushToken(supabase, uid, token);
  lastWrittenToken = token;
  return true;
}

/**
 * Ask for permission if needed, mint a token, and store it on the profile.
 *
 * `prompt: false` makes this the silent variant used by the lifecycle: it never
 * shows the OS dialog, so a guest who has not been asked yet is not ambushed on
 * app resume — it only repairs a profile whose permission is ALREADY granted.
 */
export async function registerPushToken(
  opts: { prompt?: boolean } = {},
): Promise<PushRegistrationResult> {
  const prompt = opts.prompt !== false;
  try {
    // Dynamic imports: expo-notifications/expo-device are native modules that
    // may be absent in Expo Go / web / test environments.
    const Device = await import('expo-device');
    if (!Device.isDevice) return 'unavailable';
    // Expo Go dropped remote push in SDK 53; importing expo-notifications there
    // console.errors on Android (red box) before we could do anything useful.
    if (isRunningInExpoGo()) return 'unavailable';
    const Notifications = await import('expo-notifications');

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      if (!prompt) return status === 'denied' ? 'denied' : 'unavailable';
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      addBreadcrumb('push.register.denied', { prompted: prompt });
      return 'denied';
    }

    await ensureAndroidChannel(Notifications);
    const projectId = easProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) {
      // Permission granted but no token: a real fault, not an unsupported phone.
      captureException(new Error('expo push token was empty'), { scope: 'push.register' });
      return 'failed';
    }

    if (!(await persistToken(token))) {
      // No session to attach the token to. Not a fault — the lifecycle rewrites
      // it the moment somebody signs in.
      addBreadcrumb('push.register.noSession');
      return 'unavailable';
    }
    return 'registered';
  } catch (error) {
    // Never break the app for push — but never lose the reason either. Before
    // the audit this was a bare `catch { return 'unavailable' }`, which is why
    // "notifications not available on this device" was unfalsifiable in the field.
    captureException(error, { scope: 'push.register', prompted: prompt });
    return 'failed';
  }
}

/**
 * Keep profiles.expo_push_token present and current for as long as there is a
 * session. Called once from the root layout with the live session flag.
 *
 * Three triggers, all silent (never prompts — see registerPushToken's `prompt`):
 *   1. sign-in / mount, so a brand-new account has a token before it can book;
 *   2. every foreground, which catches an OS-level permission grant made in
 *      system settings and a token that rotted while the app was away;
 *   3. Expo's addPushTokenListener, the only authoritative signal that the OS
 *      reissued the token while we were running.
 *
 * Returns the teardown. Never throws.
 */
export function startPushRegistrationLifecycle(args: { hasSession: () => boolean }): {
  (): void;
  sync: (reason: string) => void;
} {
  let cancelled = false;
  let removeTokenListener: (() => void) | null = null;
  let inFlight = false;

  const sync = (reason: string) => {
    if (!shouldSync({ cancelled, inFlight, hasSession: args.hasSession() })) return;
    inFlight = true;
    void registerPushToken({ prompt: false })
      .then((state) => addBreadcrumb('push.sync', { reason, state }))
      .finally(() => {
        inFlight = false;
      });
  };

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') sync('foreground');
  };
  const sub = AppState.addEventListener('change', onAppState);

  void (async () => {
    try {
      if (isRunningInExpoGo()) return;
      const Device = await import('expo-device');
      if (!Device.isDevice || cancelled) return;
      const Notifications = await import('expo-notifications');
      if (cancelled) return;
      // The OS reissued the token mid-session: write it through immediately,
      // bypassing the cache — the cached value is precisely what went stale.
      const listener = Notifications.addPushTokenListener((next) => {
        const token = typeof next?.data === 'string' ? next.data : null;
        if (!token || !args.hasSession()) return;
        void persistToken(token, true)
          .then((ok) => addBreadcrumb('push.token.rotated', { stored: ok }))
          .catch((error) => captureException(error, { scope: 'push.token.rotated' }));
      });
      removeTokenListener = () => listener.remove();
    } catch (error) {
      captureException(error, { scope: 'push.tokenListener' });
    }
  })();

  sync('start');

  // The teardown carries `sync` so the caller can re-run it on a sign-in that
  // happens while the app is already foregrounded — the AppState event never
  // fires in that case, and that is the single most common way a brand-new
  // account gets its first token.
  const stop = () => {
    cancelled = true;
    sub.remove();
    removeTokenListener?.();
  };
  stop.sync = sync;
  return stop;
}

/** Declared in ./pushSync (the node-testable half) and re-exported here so
 * consumers keep importing it from the push module. One declaration: the two
 * used to be independent unions that would silently drift apart. */
export type { PushPermissionState } from './pushSync';

/**
 * Passive permission probe for the Settings screen (design 2026-08-31 renders
 * the three permission states differently). Never prompts — registerPushToken
 * owns the request flow.
 */
export async function getPushPermissionState(): Promise<PushPermissionState> {
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return 'unavailable';
    if (isRunningInExpoGo()) return 'unavailable';
    const Notifications = await import('expo-notifications');
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied' && !canAskAgain) return 'denied';
    return 'undetermined';
  } catch (error) {
    captureException(error, { scope: 'push.permissionState' });
    return 'unavailable';
  }
}

/**
 * Boot-time wiring, called once from the root layout. Returns the teardown.
 *
 *  - setNotificationHandler: without it a push that lands while the app is in
 *    the FOREGROUND is silently dropped on iOS — which is exactly when someone
 *    is looking at Settings after pressing "Send a test notification".
 *  - the Android channel (see ANDROID_CHANNEL).
 *  - tap routing: send-push puts `reservation_id` in `data` for the booking
 *    kinds; the caller decides where that goes (this module owns no navigation).
 *    A cold start from a notification is covered by getLastNotificationResponseAsync.
 *
 * Never throws — Expo Go, simulators and a missing module all leave the app
 * exactly as it was.
 */
export function installNotificationHandler(opts: {
  onOpenReservation: (reservationId: string) => void;
}): () => void {
  let cancelled = false;
  let remove: (() => void) | null = null;
  /**
   * A cold start delivers the SAME tap twice on some Expo versions: once from
   * getLastNotificationResponseAsync and once from the listener. Routing both
   * pushes the booking screen onto itself. Notification ids are unique per
   * delivery, so the id is the dedupe key.
   */
  const handled = new Set<string>();

  void (async () => {
    try {
      if (isRunningInExpoGo()) return;
      const Notifications = await import('expo-notifications');
      if (cancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      await ensureAndroidChannel(Notifications);

      const open = (response: ExpoNotifications.NotificationResponse | null) => {
        if (!response) return;
        const id = response.notification.request.identifier || null;
        if (!shouldRouteTap({ id, handled })) return;
        if (id) handled.add(id);
        const data = response.notification.request.content.data as
          | { kind?: unknown; reservation_id?: unknown }
          | undefined;
        // Only claim an open when one actually happens: the `test` kind (and any
        // future kind without a reservation) routes nowhere, and a breadcrumb
        // saying otherwise sent the last audit looking for a navigation bug.
        const reservationId = tapDestination(data);
        if (reservationId) {
          addBreadcrumb('push.open', { kind: data?.kind });
          opts.onOpenReservation(reservationId);
        } else {
          addBreadcrumb('push.open.noRoute', { kind: data?.kind });
        }
      };

      const sub = Notifications.addNotificationResponseReceivedListener(open);
      remove = () => sub.remove();
      // Launched by tapping a notification while the app was closed.
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!cancelled && last) open(last);
    } catch (error) {
      // Module absent (Expo Go, web, an older binary): push simply stays off.
      captureException(error, { scope: 'push.handler' });
    }
  })();

  return () => {
    cancelled = true;
    remove?.();
  };
}

/**
 * SEC-16 — surrender this device's push token, locally.
 *
 * app.delete_my_account already nulls `profiles.expo_push_token`, so the SERVER
 * can no longer address the handset. This is the other half: Expo's push
 * service still holds a live token minted for this installation, and the OS
 * still has the app registered for remote notifications. Neither is reachable
 * from SQL.
 *
 * `unregisterForNotificationsAsync` invalidates the token with APNs/FCM, which
 * is what makes a notification queued in the seconds before deletion fail to
 * deliver instead of landing on a phone whose owner just deleted their account.
 *
 * Never throws, and returns false rather than reporting a problem: this runs
 * inside a deletion the server has ALREADY committed. Nothing here can be
 * retried by the user, so an error has no action attached to it — the only
 * honest outcomes are "done" and "could not, and it changes nothing you can
 * act on". Expo Go, simulators and web all take the false path.
 */
export async function unregisterPushTokenLocally(): Promise<boolean> {
  try {
    if (isRunningInExpoGo()) return false;
    const Device = await import('expo-device');
    if (!Device.isDevice) return false;
    const Notifications = await import('expo-notifications');
    await Notifications.unregisterForNotificationsAsync();
    forgetWrittenPushToken();
    addBreadcrumb('push.unregistered');
    return true;
  } catch {
    // Deletion is already committed: there is no action to attach to an error.
    return false;
  }
}
