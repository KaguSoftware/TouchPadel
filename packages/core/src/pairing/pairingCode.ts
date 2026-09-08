/**
 * KDS pairing code — the LAN pre-shared key a kitchen screen types once.
 *
 * The till mints one at first run and shows it under "Pair a kitchen screen";
 * the kitchen screen's setup form takes it, finds the till on the LAN, and
 * both sides keep the code as `lan_psk` (design-arch.md §2.4, SEC-31 "a bearer
 * token minted at pairing"). 10 Crockford-base32 characters = 50 bits, which is
 * plenty against a bearer check on a non-routable LAN and short enough to read
 * off a screen: displayed as XXXXX-XXXXX.
 *
 * Pure and platform-neutral: the renderer normalises typed input with it, the
 * shell's main process mints with it (random bytes injected). The main process
 * carries a CJS mirror (apps/operator-shell/src/main/pairing-code.ts) with a
 * drift test against this file — the same arrangement as the ULID helper.
 */

/** Crockford base32: no I, L, O, U — the letters people misread. */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 10;
export const pairingCodeRegex = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * Forgiving input: uppercase, drop dashes/spaces/anything else, and map the
 * three look-alikes Crockford excludes (O→0, I→1, L→1). Does not validate —
 * the result may be too short or contain a U; check with isPairingCode.
 */
export function normalisePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** True for a canonical code (already normalised). */
export function isPairingCode(value: string): boolean {
  return pairingCodeRegex.test(value);
}

/** XXXXX-XXXXX for display; the argument must already be canonical. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5, 10)}`;
}

/**
 * Mint a fresh code from 10 random bytes. `byte & 31` is unbiased because
 * 256 is a multiple of 32. The random source is injected so this stays free
 * of Node/Web crypto and trivially testable.
 */
export function mintPairingCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    out += PAIRING_ALPHABET[(bytes[i] ?? 0) & 31];
  }
  return out;
}
