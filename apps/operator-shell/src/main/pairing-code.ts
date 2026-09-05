import { randomBytes } from 'node:crypto';

/**
 * KDS pairing code for the MAIN process — a mirror of
 * @touch/core/pairing/pairingCode (ESM, raw TS) which this CJS process cannot
 * require at typecheck time; same reason ulid.ts and ipc-validate.ts mirror.
 * `pairing-code.test.ts` asserts the two agree so they cannot drift silently.
 *
 * 10 Crockford-base32 chars (50 bits). The code IS the LAN PSK: the till mints
 * it at first run, the kitchen screen types it, both keep it as lan_psk.
 */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 10;
export const pairingCodeRegex = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function normalisePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isPairingCode(value: string): boolean {
  return pairingCodeRegex.test(value);
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5, 10)}`;
}

/** Fresh code from node:crypto. `byte & 31` is unbiased (256 % 32 === 0). */
export function mintPairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    out += PAIRING_ALPHABET[bytes[i]! & 31];
  }
  return out;
}
