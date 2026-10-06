/**
 * The member card's offline copy (loyalty plan §5.1): the last card the server answered, in
 * SecureStore, so the QR still draws at a till with no signal. The token is TOTP, computed on
 * the phone from this secret (L-4); the secret is why it is the keychain and not AsyncStorage.
 *
 * The value names its account (`encodeCachedCard`), so another account on this phone reads
 * nothing. Sign-out removes it (auth/context.tsx), and so does an account deletion's purge
 * (profile/purgeKeys.ts). Every call is best-effort: a keychain that refuses only costs the
 * offline copy, never the screen.
 */
import * as SecureStore from 'expo-secure-store';
import type { MemberCard } from '@touch/core/loyalty';
import { captureException } from '../../lib/telemetry';
import { MEMBER_CARD_STORE_KEY, decodeCachedCard, encodeCachedCard } from './logic';

export async function readCachedCard(userId: string): Promise<MemberCard | null> {
  try {
    return decodeCachedCard(await SecureStore.getItemAsync(MEMBER_CARD_STORE_KEY), userId);
  } catch (error) {
    captureException(error, { scope: 'loyalty.card.read' });
    return null;
  }
}

export async function storeCachedCard(userId: string, card: MemberCard): Promise<void> {
  try {
    await SecureStore.setItemAsync(MEMBER_CARD_STORE_KEY, encodeCachedCard(userId, card));
  } catch (error) {
    captureException(error, { scope: 'loyalty.card.write' });
  }
}

export async function forgetMemberCard(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(MEMBER_CARD_STORE_KEY);
  } catch (error) {
    captureException(error, { scope: 'loyalty.card.forget' });
  }
}
