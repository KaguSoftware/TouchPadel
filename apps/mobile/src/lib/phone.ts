import { Linking } from 'react-native';
import { captureException } from './telemetry';

/** `tel:` URL with everything but digits and a leading + stripped. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * Open the dialer. Resolves `false` — and records it — when the device cannot
 * place calls (tablet, emulator, restricted profile). Four screens used to do
 * `void Linking.openURL(...)`, which turned that into an unhandled rejection:
 * a red box in Expo Go, silence in production.
 */
export async function callPhone(phone: string): Promise<boolean> {
  try {
    await Linking.openURL(telUrl(phone));
    return true;
  } catch (error) {
    captureException(error, { label: 'call.open' });
    return false;
  }
}
