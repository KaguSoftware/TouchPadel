/**
 * Nonce for the id-token grant. The provider SDK receives the SHA-256 hex (it
 * lands in the id token's `nonce` claim); Supabase receives the RAW value and
 * hashes it itself for the comparison. One fresh nonce per attempt, never
 * persisted, never logged.
 */
import * as Crypto from 'expo-crypto';
import { makeNonce, type Nonce } from '../social';

export const sha256Hex = (value: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });

export const newNonce = (): Promise<Nonce> => makeNonce(() => Crypto.randomUUID(), sha256Hex);
