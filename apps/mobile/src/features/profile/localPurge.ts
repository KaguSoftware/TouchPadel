/**
 * SEC-16 — the deleting half of the local purge.
 *
 * WHAT the purge removes, and why each key is on the list, lives in the pure
 * `purgeKeys.ts` so a test can read it. This module is only the effects: it
 * imports expo-secure-store and AsyncStorage and therefore cannot be loaded
 * under the plain-node vitest setup.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { purgeSecureKeys } from '../../lib/secureStorage';
import { captureException } from '../../lib/telemetry';
import { localKeysToPurge, secureKeysToPurge } from './purgeKeys';

export { localKeysToPurge, secureKeysToPurge } from './purgeKeys';

/**
 * Remove both stores' worth. Best-effort by contract — see deletion.ts step 2:
 * the account is already gone when this runs, so a throw here would only put an
 * error in front of someone who has nothing left to do about it.
 *
 * The SecureStore sweep is deliberately first. It is the one holding the live
 * refresh token, so if the process is killed mid-purge (a user force-quitting
 * the app the instant the screen changes), the credential is the thing that has
 * already gone rather than the thing left behind.
 */
export async function purgeLocalIdentity(opts: {
  supabaseUrl: string | undefined;
  userId: string | null | undefined;
}): Promise<void> {
  await purgeSecureKeys(secureKeysToPurge(opts.supabaseUrl));

  const keys = localKeysToPurge(opts.userId);
  if (keys.length === 0) return;
  try {
    await AsyncStorage.multiRemove(keys);
  } catch (error) {
    captureException(error, { scope: 'deletion.localPurge' });
  }
}
