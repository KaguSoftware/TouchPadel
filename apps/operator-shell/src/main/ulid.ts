import { randomBytes } from 'node:crypto';

/**
 * Crockford-base32 ULID for the MAIN process. The canonical generator lives in
 * @touch/core (ESM, raw TS) which this CJS process cannot require until it is
 * bundled (A6) — same reason ipc-validate mirrors the regexes. 48-bit time +
 * 80-bit randomness, 26 chars, matches ULID_SRC exactly; monotonicity within a
 * millisecond is not needed here (keys are uniqueness handles, seq orders the
 * queue).
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now()): string {
  let time = now;
  const chars = new Array<string>(26);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ALPHABET[time % 32]!;
    time = Math.floor(time / 32);
  }
  const rand = randomBytes(16);
  for (let i = 0; i < 16; i++) {
    chars[10 + i] = ALPHABET[rand[i]! % 32]!;
  }
  return chars.join('');
}
