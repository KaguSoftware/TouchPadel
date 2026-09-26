/**
 * `staff.stores.*`: the staff phone's store pages (app/staff-stock-{log,move,count}.tsx: Add to
 * stock, Move stock, Count the bakery). Owned by lane S
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1). W0 wrote `countWaiting` only.
 * Mirror every key in stores.ar.ts.
 */
export const staffStoresEn = {
  // COUNT_IN_PROGRESS from submit_stock_count, through CODE_TO_KEY
  // (apps/mobile/src/features/booking/errors.ts). op.errors.COUNT_IN_PROGRESS says
  // "finalize it first", which only a manager on the operator can do (addendum §3, V11).
  countWaiting:
    'This store already has a count open or waiting for a manager. Try again once a manager has finished it.',
} as const;
