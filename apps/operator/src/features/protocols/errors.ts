/**
 * Protocol refusals as the screen says them (build-contracts-2026-09-23 §3).
 *
 * An RPC's code maps through MAPPED_CODES as everywhere else. The launch goes
 * through the protocol-action function, which answers a refused step with the
 * engine's own code in its body (`{error: 'RELEASE_NOT_READY', hint}`); that
 * code reaches EdgeError.detail, and is mapped the same way when the catalog
 * has it, else as the edge failure it is (`EDGE_<code>`).
 *
 * `refusalHint` is where a record refusal landed (the RPC's hint, or the
 * edge body's): the form marks that field.
 */
import type { MessageKey } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { EdgeError } from '../../lib/edge';
import { MAPPED_CODES, errorToMessageKey } from '../../lib/errors';

export function protocolErrorKey(error: unknown): MessageKey {
  if (error instanceof EdgeError && error.detail && MAPPED_CODES.has(error.detail)) {
    return `op.errors.${error.detail}` as MessageKey;
  }
  return errorToMessageKey(error);
}

/** The server code of a refusal, whichever door it came through. */
export function refusalCode(error: unknown): string | null {
  if (error instanceof AppRpcError) return error.code;
  if (error instanceof EdgeError) return error.detail ?? `EDGE_${error.code}`;
  return null;
}

/** The field a RECORD_INVALID, TEXT_TOO_LONG or PHOTO_PATH_INVALID names, when it names one. */
export function refusalHint(error: unknown): string | null {
  if (error instanceof AppRpcError) return error.hint ?? null;
  return null;
}
