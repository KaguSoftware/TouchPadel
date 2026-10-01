/**
 * Protocol refusals as the screen says them (build-contracts-2026-09-23 §3).
 *
 * An RPC's code and an edge refusal's code map the same way, through the one
 * error catalogue: the launch goes through the protocol-action function, which
 * answers a refused step with the engine's own code in its body
 * (`{error: 'RELEASE_NOT_READY', hint}`), and lib/edge.ts keeps that code as
 * EdgeError.code when the catalogue has it (else EDGE_<class>).
 *
 * `refusalHint` is where a record refusal landed (the RPC's hint, or the
 * edge body's): the form marks that field.
 */
import type { MessageKey } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { EdgeError } from '../../lib/edge';
import { errorToMessageKey } from '../../lib/errors';

export function protocolErrorKey(error: unknown): MessageKey {
  // Coaching (0285, operator.md §5.19): a lesson price change whose type or
  // coach price moved since the proposal has its own line, by the hook's hint.
  if (error instanceof AppRpcError && error.code === 'PRICE_TARGET_CHANGED') {
    const hint = (error.hint || error.details || '').trim();
    if (hint === 'lesson_type' || hint === 'coach_price') return `ws.coaching.errors.priceTargetChanged.${hint}`;
  }
  return errorToMessageKey(error);
}

/** The server code of a refusal, whichever door it came through. */
export function refusalCode(error: unknown): string | null {
  if (error instanceof AppRpcError) return error.code;
  if (error instanceof EdgeError) return error.serverCode ?? `EDGE_${error.kind}`;
  return null;
}

/** The field a RECORD_INVALID, TEXT_TOO_LONG or PHOTO_PATH_INVALID names, when it names one. */
export function refusalHint(error: unknown): string | null {
  if (error instanceof AppRpcError) return error.hint ?? null;
  return null;
}
