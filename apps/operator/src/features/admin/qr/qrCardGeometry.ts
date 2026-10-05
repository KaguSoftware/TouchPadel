/**
 * Pure geometry + QR path for the A6 table card. Port of
 * packages/db/scripts/qr-artwork.mjs (`qrPath`, `renderCard` layout) so the
 * printed card from the operator app matches the script's output 1:1.
 */
// The QR encoder and path builder live in @touch/core/loyalty (loyalty build contracts §3), so the
// member card on mobile and web draws with the same code; re-exported here for the table cards.
import { QUIET_MODULES } from '@touch/core/loyalty';
export { qrModules, qrPath, QR_INK, QR_PAPER, QUIET_MODULES } from '@touch/core/loyalty';
export type { QrModules } from '@touch/core/loyalty';

/** A6 portrait, 105 × 148 mm at 4 SVG units per mm. */
export const CARD_WIDTH = 420;
export const CARD_HEIGHT = 592;
export const QR_BOX = 224; // ~56 mm printed — comfortable phone-scan size
export const QR_X = (CARD_WIDTH - QR_BOX) / 2; // 98
export const QR_Y = 258;

export interface CardLayout {
  viewBox: string;
  width: number;
  height: number;
  qrBox: number;
  qrX: number;
  qrY: number;
  quiet: number;
  /** Font size of the huge table number (96 / 72 / 52 by length). */
  numSize: number;
  /** Modules → SVG units for a QR of `size` modules incl. the quiet zone. */
  scaleFor: (size: number) => number;
}

export function numberSize(tableNumber: string): number {
  const n = tableNumber.length;
  return n <= 2 ? 96 : n <= 4 ? 72 : 52;
}

export function cardLayout(tableNumber: string): CardLayout {
  return {
    viewBox: `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    qrBox: QR_BOX,
    qrX: QR_X,
    qrY: QR_Y,
    quiet: QUIET_MODULES,
    numSize: numberSize(tableNumber),
    scaleFor: (size) => QR_BOX / (size + QUIET_MODULES * 2),
  };
}

/**
 * Where a printed card sends the guest when nothing better is configured: the
 * venue's own domain, live since 2026-09-23 (the bare touch-padel.com
 * redirects to www). A card outlives any hosting move, so it carries the
 * domain, never the vercel.app address.
 */
export const DEFAULT_GUEST_SITE_URL = 'https://www.touch-padel.com';

const LOOPBACK_OR_PRIVATE =
  /^(localhost|0\.0\.0\.0|127(\.\d{1,3}){3}|\[?::1\]?|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$|\.local$/i;

/**
 * The guest-site origin printed into QR cards.
 *
 * A card is printed once and screwed to a table, so a wrong origin is a dead
 * card for months. `VITE_GUEST_SITE_URL` is baked in at build time, and the
 * dev `.env` holds `http://localhost:3000` — a card printed from a build that
 * picked that up opens nothing on a guest's phone. So in a PRODUCTION build:
 *   - unset, unparseable, or a loopback / private-network host → the live site
 *   - http → https
 * In dev (and e2e, where the local web app IS the guest site) an explicit
 * localhost is honoured; unset still falls back to the live site.
 * Any path (`/en/`, `/ar`) is dropped: `/t/<token>` picks the locale itself.
 */
export function resolveGuestSiteUrl(raw: string | undefined, isProduction: boolean): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_GUEST_SITE_URL;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return DEFAULT_GUEST_SITE_URL;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_GUEST_SITE_URL;
  if (isProduction) {
    if (LOOPBACK_OR_PRIVATE.test(url.hostname)) return DEFAULT_GUEST_SITE_URL;
    url.protocol = 'https:';
  }
  return url.origin;
}

/** Guest URL printed into the card; `null` when the site origin is not configured. */
export function guestTableUrl(siteUrl: string | undefined, token: string): string | null {
  const origin = siteUrl?.trim().replace(/\/+$/, '');
  if (!origin) return null;
  return `${origin}/t/${token}`;
}
