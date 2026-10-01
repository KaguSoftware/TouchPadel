/**
 * Server error code -> i18n message key, for the staff app. The codes and
 * their lines are the one error catalogue (`ERROR_CODE_KEYS` in
 * packages/i18n/src/errors.ts), shared with the phone and the web, and the
 * matching rule is its `errorMessageKey`; this file only says what the staff
 * app adds: a fetch TypeError is the network line. The operator reads every
 * code in the catalogue's own words (no overrides).
 *
 * A new code goes into the catalogue with its line in both catalogs;
 * `check-error-codes` (root `pnpm security`) fails on a raised code it lacks.
 */
import {
  ERROR_CODE_KEYS,
  errorMessageKey,
  type ErrorKeyOptions,
  type MessageKey,
} from '@touch/i18n';

/** Every code the catalogue words (kept for call sites that test membership). */
export const MAPPED_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODE_KEYS));

const OPERATOR: ErrorKeyOptions = {
  // A fetch that never got an answer (offline, DNS, CORS) rejects with a TypeError.
  isTransport: (error) => error instanceof TypeError,
};

/** Map a raw server code (a queued write's refusal, a reported code) to a message key. */
export function errorCodeToMessageKey(code: string): MessageKey {
  return errorMessageKey({ code }, OPERATOR);
}

/**
 * Map any thrown value to a message key: an AppRpcError by its code (or its
 * SQLSTATE), an EdgeError by its code (the server's, or EDGE_<class>), a
 * fetch failure as the network line.
 */
export function errorToMessageKey(error: unknown): MessageKey {
  return errorMessageKey(error, OPERATOR);
}
