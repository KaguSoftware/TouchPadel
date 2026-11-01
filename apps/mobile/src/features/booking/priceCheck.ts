/**
 * A court booking's price, checked BEFORE the guest confirms (F-21), the way
 * open matches and lessons already do it (PRICE_CHANGED).
 *
 * Two moments the price can move:
 *
 *  1. Between the slot the guest picked on the Book tab (the grid's price,
 *     read from the cached rate rules) and the hold: `hold_slot` stamps the
 *     server's price on the hold (0117), and Review shows that one. When the
 *     two differ, Review says so above Reserve (`heldPriceMove`), so the guest
 *     reads the new price before the confirmation, never on Success.
 *  2. Between the hold and the confirm: `confirm_booking` refuses with
 *     PRICE_CHANGED (detail `{"quoted_iqd","current_iqd"}`) rather than charge
 *     an amount nobody agreed to. Review then shows the new price and sends the
 *     guest back to pick the time again (`confirmPriceMove`); the next hold is
 *     stamped with the new price.
 *
 * PURE (vitest).
 */
import { rpcErrorCode, rpcErrorDetail } from './errors';
import { errorMessageOf } from '../../lib/network';

export interface PriceMove {
  /** What the guest saw (or the hold carried). */
  fromIqd: number;
  /** What it costs now. */
  toIqd: number;
}

/** A whole, non-negative IQD amount from a route param or a JSON number; null for anything else. */
export function parseIqd(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** The grid's price against the hold's: a move when both are known and differ. */
export function heldPriceMove(shown: unknown, held: unknown): PriceMove | null {
  const from = parseIqd(shown);
  const to = parseIqd(held);
  if (from === null || to === null || from === to) return null;
  return { fromIqd: from, toIqd: to };
}

/**
 * confirm_booking's PRICE_CHANGED as a move, or null for any other failure.
 * A refusal whose detail cannot be read still counts as a move to an unknown
 * price (`toIqd` null): the screen then says the price changed without a figure.
 */
export function confirmPriceMove(
  err: unknown,
  heldIqd: number | null,
): { fromIqd: number | null; toIqd: number | null } | null {
  if (rpcErrorCode(errorMessageOf(err)) !== 'PRICE_CHANGED') return null;
  const detail = rpcErrorDetail(err);
  let from: number | null = heldIqd;
  let to: number | null = null;
  if (detail) {
    try {
      const o = JSON.parse(detail) as Record<string, unknown>;
      from = parseIqd(o.quoted_iqd) ?? heldIqd;
      to = parseIqd(o.current_iqd);
    } catch {
      // A detail that is not JSON carries no figure.
    }
  }
  return { fromIqd: from, toIqd: to };
}
