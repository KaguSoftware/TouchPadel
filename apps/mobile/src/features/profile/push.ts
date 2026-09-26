/**
 * Expo push — the ONE module that touches expo-notifications (dynamic imports:
 * the native module is absent in Expo Go / web / vitest, and importing it in
 * Expo Go red-boxes on Android). Fully guarded: simulators, dev builds without
 * the module, and permission denials all resolve to 'unavailable' instead of
 * throwing.
 *
 *   registerPushToken          permission prompt + token -> profiles.expo_push_token
 *   getPushPermissionState     passive probe for the Settings screen
 *   installNotificationHandler foreground display + Android channel + tap routing
 *
 * The server half is migration 0024 (outbox + trigger), 0048 (cron nudge),
 * 0070 (Settings test push) and the send-push edge function.
 */
import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
// Type-only: erased at compile time, so the native module is still loaded
// through the guarded dynamic imports below and nowhere else.
import type * as ExpoNotifications from 'expo-notifications';

import { supabase } from '../../lib/supabase';
import { addBreadcrumb } from '../../lib/telemetry';
import { updatePushToken } from './api';

export type PushRegistrationResult = 'registered' | 'denied' | 'unavailable';

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

export async function registerPushToken(): Promise<PushRegistrationResult> {
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
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return 'denied';

    await ensureAndroidChannel(Notifications);
    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    if (!token) return 'unavailable';

    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return 'unavailable';
    await updatePushToken(supabase, uid, token);
    return 'registered';
  } catch {
    // No device / module missing / network hiccup — never break the app for push.
    return 'unavailable';
  }
}

export type PushPermissionState = 'undetermined' | 'granted' | 'denied' | 'unavailable';

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
  } catch {
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
        const data = response?.notification.request.content.data as
          | { kind?: unknown; reservation_id?: unknown }
          | undefined;
        addBreadcrumb('push.open', { kind: data?.kind });
        const id = data?.reservation_id;
        if (typeof id === 'string' && id) opts.onOpenReservation(id);
      };

      const sub = Notifications.addNotificationResponseReceivedListener(open);
      remove = () => sub.remove();
      // Launched by tapping a notification while the app was closed.
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!cancelled && last) open(last);
    } catch {
      // Module absent (Expo Go, web, an older binary): push simply stays off.
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
    addBreadcrumb('push.unregistered');
    return true;
  } catch {
    return false;
  }
}
