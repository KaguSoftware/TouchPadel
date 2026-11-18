/**
 * The id this phone logs hours with (0442, contract §3 `p_device_id`). The
 * first id the phone uses is kept in SecureStore and sent from then on: the
 * platform's own (iOS identifierForVendor, Android ANDROID_ID), or, when the
 * platform gives none (iOS can, briefly, after a restart before the first
 * unlock), a random one. The server keeps only its sha256 and binds the first
 * phone that is accepted; another phone is refused until a manager resets it.
 * Keeping the first id means the phone never changes id under its own person
 * (fallback first, platform id later), and the iOS keychain keeps it across a
 * reinstall.
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { pickDeviceId } from './logic';

const STORE_KEY = 'tp.clock-device';

async function platformId(): Promise<string | null> {
  try {
    if (Platform.OS === 'ios') return await Application.getIosIdForVendorAsync();
    if (Platform.OS === 'android') return Application.getAndroidId();
  } catch {
    // Fall back to the kept id.
  }
  return null;
}

export async function clockDeviceId(): Promise<string> {
  const own = await platformId();
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(STORE_KEY);
  } catch {
    stored = null;
  }
  const picked = pickDeviceId(own, stored);
  if (picked) {
    if (picked !== stored) {
      try {
        await SecureStore.setItemAsync(STORE_KEY, picked);
      } catch {
        // Unkept, the platform id is still sent; it is stable on its own.
      }
    }
    return picked;
  }
  const fresh = `tp-${Crypto.randomUUID()}`;
  try {
    await SecureStore.setItemAsync(STORE_KEY, fresh);
  } catch {
    // Unkept, it still identifies this attempt; the next may differ and be refused WRONG_DEVICE.
  }
  return fresh;
}
