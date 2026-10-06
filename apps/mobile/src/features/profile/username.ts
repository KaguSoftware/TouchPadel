/**
 * Usernames (Phase 2, migration 0307). The phone mirrors the server's grammar
 * so the field can say "invalid" without a round trip; the server
 * (`app.username_problem`, `app.set_my_username`) stays the authority, and only
 * it knows "taken", "reserved" and "not allowed" (a slur or swear word,
 * 0312). Pure, so it runs under vitest.
 */
import type { MessageKey } from '@touch/i18n';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** How long after a change the next one is allowed. */
export const USERNAME_CHANGE_DAYS = 7;

const GRAMMAR = /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;

/** As the server stores it: trimmed, lower case, a leading "@" dropped; '' for blank. */
export function normalizeUsername(typed: string): string {
  return typed.trim().replace(/^@+/, '').toLowerCase();
}

/** The grammar alone (3–20 of a-z 0-9 . _, letter or digit at both ends, no "..", "__", "._"). */
export function isUsernameShape(name: string): boolean {
  return GRAMMAR.test(name) && !/[._]{2}/.test(name);
}

export type UsernameState =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'yours' }
  | { kind: 'taken' }
  | { kind: 'not_allowed' }
  | { kind: 'reserved' };

/** The server's username_check answer, read for the field. */
export function stateFromCheck(
  check: { available?: unknown; reason?: unknown; username?: unknown } | null | undefined,
  current: string | null | undefined,
): UsernameState {
  if (!check) return { kind: 'checking' };
  if (check.available === true) return check.username === current ? { kind: 'yours' } : { kind: 'available' };
  if (check.reason === 'not_allowed') return { kind: 'not_allowed' };
  if (check.reason === 'reserved') return { kind: 'reserved' };
  if (check.reason === 'taken') return { kind: 'taken' };
  return { kind: 'invalid' };
}

/** The line under the field for a state; null where nothing is said. */
export function usernameStateKey(state: UsernameState): MessageKey | null {
  switch (state.kind) {
    case 'invalid':
      return 'profile.usernameInvalid';
    case 'checking':
      return 'profile.usernameChecking';
    case 'available':
      return 'profile.usernameAvailable';
    case 'yours':
      return 'profile.usernameYours';
    case 'taken':
      return 'profile.usernameTaken';
    case 'not_allowed':
      return 'profile.usernameNotAllowed';
    case 'reserved':
      return 'profile.usernameReserved';
    default:
      return null;
  }
}

/**
 * When the next change is allowed, or null when it is allowed now. The first
 * username is always free (no previous change).
 */
export function nextUsernameChange(
  username: string | null | undefined,
  changedAt: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!username || !changedAt) return null;
  const at = Date.parse(changedAt);
  if (Number.isNaN(at)) return null;
  const next = new Date(at + USERNAME_CHANGE_DAYS * 86_400_000);
  return next > now ? next : null;
}

/** "@name" for display, LTR whatever the language. */
export function atUsername(name: string): string {
  return `@${name}`;
}
