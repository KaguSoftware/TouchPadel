/**
 * Expo push-token registration -> profiles.expo_push_token. Fully guarded:
 * simulators, dev builds without the notifications module, and permission
 * denials all resolve to 'unavailable' instead of throwing.
 */
import { supabase } from '../../lib/supabase';
import { updatePushToken } from './api';

export type PushRegistrationResult = 'registered' | 'denied' | 'unavailable';

export async function registerPushToken(): Promise<PushRegistrationResult> {
  try {
    // Dynamic imports: expo-notifications/expo-device are native modules that
    // may be absent in Expo Go / web / test environments.
    const Device = await import('expo-device');
    if (!Device.isDevice) return 'unavailable';
    const Notifications = await import('expo-notifications');

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return 'denied';

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
