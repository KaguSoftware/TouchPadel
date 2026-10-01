/**
 * Menu tile state derivation (spec 06.11 / MenuItemTile).
 *
 * The `menu_item_availability` view exposes ONE boolean, `orderable`, folded
 * from four causes (0018 → 0025 → 0027 → 0041):
 *
 *   orderable = is_active
 *           and unavailable_on <> business_date        -- staff: paused for the day
 *           and not sold_out                           -- staff: marked sold out
 *           and no required ingredient has on_hand <= 0 -- stock
 *
 * The view does not say WHICH cause fired, so the two disabled states the spec
 * requires are derived from the item row itself: the two staff-set columns
 * (`sold_out`, `unavailable_on`) are readable, so if the view says "not
 * orderable" and either staff column is set, the cause is staff; otherwise the
 * only remaining cause is stock. Inactive items are filtered out of the grid
 * before this runs, so `is_active` never reaches here as a cause.
 *
 * `unavailable_on` is compared with the venue's business date (`tillToday`),
 * the date the server stamps it with (`app.business_date(now())`, 0041). It
 * used to be the station's calendar date taken once at mount, which on a till
 * left running overnight went stale at midnight. The effect is only which
 * LABEL a disabled tile shows, never whether it is disabled — that is always
 * the view's verdict.
 */
import { businessTodayISO } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';

export type TileState = 'ready' | 'noTab' | 'unavailable' | 'blockedByStock';

export interface TileInput {
  /** `orderable` from the availability view; undefined = no row = treat as orderable. */
  orderable: boolean | undefined;
  soldOut: boolean;
  /** ISO date (YYYY-MM-DD) or null. */
  unavailableOn: string | null;
  hasActiveTab: boolean;
  /** ISO date for "today" on this station; injected so the derivation is pure. */
  today: string;
}

/**
 * "Today" for the till's tiles: the venue's business date at `nowMs` — venue
 * time less the business-day start hour, as `app.business_date(now())`
 * computes it (lib/settings.ts useBusinessDay says the same).
 */
export function tillToday(nowMs: number, startHour: number, tz: string = VENUE_TZ): string {
  return businessTodayISO(new Date(nowMs), startHour, tz);
}

/** Local calendar date as YYYY-MM-DD (display helper — no time arithmetic). */
export function localIsoDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function deriveTileState(input: TileInput): TileState {
  const orderable = input.orderable ?? true;
  if (!orderable) {
    const staffMarked = input.soldOut || (input.unavailableOn !== null && input.unavailableOn === input.today);
    return staffMarked ? 'unavailable' : 'blockedByStock';
  }
  return input.hasActiveTab ? 'ready' : 'noTab';
}

/** Whether a tile in this state accepts a click / Enter. */
export function tileInteractive(state: TileState): boolean {
  return state === 'ready';
}
