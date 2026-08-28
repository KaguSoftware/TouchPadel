/**
 * Guests-per-tab estimate, used to turn tab counts into a covers figure.
 *
 * This is a per-station preference (localStorage, not a venue setting) because
 * it is a reporting assumption rather than a fact about the business.
 *
 * WHY IT LIVES HERE. One storage key, `tp-analytics-covers-mult`, was being
 * read and written from three places that did not agree:
 *
 *   - `features/admin/settings/CafeSettings.tsx` offered [1, 1.1, 1.25, 1.5,
 *     1.75, 2] and fell back to **1** for anything else;
 *   - `features/analytics/ControlDeck.tsx` offered [1, 1.5, 2, 2.5, 3, 4];
 *   - `features/analytics/useAnalyticsData.ts` accepted 1–10 and fell back to
 *     **2**.
 *
 * So until an owner touched the control, the settings screen showed x1 while
 * every covers number on the dashboard was computed at x2 — and picking x3 in
 * the deck made the settings screen display x1 and silently write 1 back if it
 * was ever touched.
 *
 * One module: one key, one option list, one default, one validator.
 *
 * The option list is the union of what both pickers already offered, so no
 * value an owner may already have stored becomes invalid. The default is 2,
 * matching what the dashboard has always actually computed — changing it would
 * silently move every covers figure the owner has already looked at.
 */

export const COVERS_MULTIPLIER_KEY = 'tp-analytics-covers-mult';

/** Offered by both pickers, and the only values accepted from storage. */
export const COVERS_MULTIPLIER_OPTIONS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;

export const DEFAULT_COVERS_MULTIPLIER = 2;

export function isCoversMultiplier(n: number): boolean {
  return (COVERS_MULTIPLIER_OPTIONS as readonly number[]).includes(n);
}

/** Read the stored multiplier, falling back to the default on anything odd. */
export function readCoversMultiplier(): number {
  try {
    const raw = localStorage.getItem(COVERS_MULTIPLIER_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && isCoversMultiplier(n) ? n : DEFAULT_COVERS_MULTIPLIER;
  } catch {
    // Private mode / storage disabled — the default is still correct.
    return DEFAULT_COVERS_MULTIPLIER;
  }
}

/** Persist a multiplier. Silently a no-op if storage is unavailable. */
export function writeCoversMultiplier(n: number): void {
  try {
    localStorage.setItem(COVERS_MULTIPLIER_KEY, String(n));
  } catch {
    // Private mode — the choice simply does not survive a restart.
  }
}
