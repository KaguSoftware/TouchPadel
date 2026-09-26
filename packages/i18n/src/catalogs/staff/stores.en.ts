/**
 * `staff.stores.*`: the staff phone's store pages (app/staff-stock-{log,move,count}.tsx: Add to
 * stock, Move stock, Count the bakery) and the store tabs on app/staff-stock.tsx. Owned by lane S
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1). W0 wrote `countWaiting`.
 * Mirror every key in stores.ar.ts.
 *
 * A store's name alone is `work.store.*` ("Cafe store"); a sentence that names a store has one
 * string per store here, because the Arabic sentence is built around the name.
 */
export const staffStoresEn = {
  // COUNT_IN_PROGRESS from submit_stock_count, through CODE_TO_KEY
  // (apps/mobile/src/features/booking/errors.ts). op.errors.COUNT_IN_PROGRESS says
  // "finalize it first", which only a manager on the operator can do (addendum §3, V11).
  countWaiting:
    'This store already has a count open or waiting for a manager. Try again once a manager has finished it.',

  // Today's rows (rows.ts).
  rows: {
    log: 'Add to stock',
    move: 'Move stock',
    count: 'Count the bakery',
  },

  // Shared by the three pages.
  find: 'Find an item',
  findHint: 'Type part of a name to find it.',
  noMatch: 'No item matches your search.',
  capped: 'Only the first 300 items are listed. Type more of the name to find another.',
  qty: 'How much',
  remove: 'Remove',
  // Under a line typed in packs: "1 pack = 500 g" until an amount is typed, then "5 packs = 2,500 g".
  packSize: '1 pack = {qty}',
  packTotal: '{packs} = {qty}',
  more: 'And {count} more.',
  // "Rusul at 9:02 AM"
  by: '{name} at {time}',
  // What a store holds: under a line to move, and on the stock page.
  holds: {
    cafe: '{qty} in the cafe store',
    bakery: '{qty} in the bakery store',
  },

  errors: {
    lines: 'Pick at least one item.',
    tooMany: 'Send at most 50 items at a time.',
    qty: 'Enter an amount above 0, like 250 or 1.5.',
    expiry: 'Enter a date like {example}.',
    expiryPast: 'The use-by date cannot be before today.',
    // Shop stock is kept in the cafe only (V14): log_stock's INVALID_ARGUMENT hint kind.
    cafeOnly: 'Shop stock goes into the cafe store only.',
    // INGREDIENT_NOT_FOUND: switched off, or gone since the list was read.
    gone: 'This item is no longer in the venue’s stock. Remove it.',
    // Before the move is sent, and from TRANSFER_SHORT's detail after.
    short: {
      cafe: 'The cafe store shows {qty}.',
      bakery: 'The bakery store shows {qty}.',
    },
    countNone: 'Type at least one amount.',
    countQty: 'Enter 0 or more, like 12 or 2.5.',
  },

  log: {
    title: 'Add to stock',
    lead: 'Add what arrived and where you put it. A manager sets the cost.',
    // The court desk logs shop stock, which is kept in the cafe only.
    leadShop: 'Add the shop stock that arrived. It goes into the cafe store.',
    driverWaiting: 'Driver purchases waiting for a manager: {count}. Do not add those here.',
    store: 'Put it in',
    linesTitle: 'Adding ({count})',
    noLines: 'Find an item above to add it.',
    expiryAdd: 'Add a use-by date',
    expiry: 'Use by · Optional',
    expiryHint: 'Year-month-day, for example {example}.',
    save: {
      cafe: 'Add to the cafe store',
      bakery: 'Add to the bakery store',
    },
    done: {
      cafe: 'Added to the cafe store',
      bakery: 'Added to the bakery store',
    },
    todayTitle: 'Added today',
    todayEmpty: 'Nothing added today yet.',
    // A delivery the manager took in on the operator, not a staff addition.
    goodsIn: 'Goods in',
    emptyTitle: 'Nothing to add here yet',
    emptyBody: 'A manager adds stock items on the operator.',
  },

  move: {
    title: 'Move stock',
    lead: 'Move stock between the cafe store and the bakery store. You can move up to what a store shows.',
    from: 'From',
    to: 'To',
    swap: 'Swap',
    linesTitle: 'Moving ({count})',
    noLines: 'Find an item above to move it.',
    // The button names where the stock goes.
    save: {
      cafe: 'Move to the cafe store',
      bakery: 'Move to the bakery store',
    },
    done: {
      cafe: 'Moved to the cafe store',
      bakery: 'Moved to the bakery store',
    },
    todayTitle: 'Moved today',
    todayEmpty: 'Nothing moved today yet.',
    // A move, by the store it left.
    route: {
      cafe: 'Cafe store to bakery store',
      bakery: 'Bakery store to cafe store',
    },
    emptyTitle: {
      cafe: 'Nothing to move from the cafe store',
      bakery: 'Nothing to move from the bakery store',
    },
    emptyBody:
      'Bought-in and made-here stock moves between the stores. Shop stock stays in the cafe.',
  },

  count: {
    title: {
      cafe: 'Count the cafe',
      bakery: 'Count the bakery',
    },
    lead: 'Type what you count on the shelf. Leave an item empty if you did not count it. A manager applies the count.',
    store: 'Store',
    waiting:
      'The count {name} sent at {time} is waiting for a manager. You can send another once it is applied.',
    sheetTitle: 'On the shelf',
    counted: 'Counted {count} of {total}',
    submit: 'Send the count',
    // Under a Send held by a count of this store that waits for a manager.
    held: 'Held until a manager applies the count already waiting.',
    done: 'Count sent. A manager will apply it.',
    recentTitle: 'Recent counts',
    recentEmpty: 'No counts sent in the last 30 days.',
    items: 'Items counted: {count}',
    // "Sent by Tiba, Sep 26, 2026, 9:00 AM"
    sentBy: 'Sent by {name}, {when}',
    show: 'Show what was counted',
    hide: 'Hide',
    status: {
      waiting: 'Waiting for a manager',
      applied: 'Applied',
    },
    emptyTitle: 'Nothing to count here yet',
    emptyBody: 'A manager adds stock items on the operator.',
  },

  // app/staff-stock.tsx, split by store.
  stock: {
    lead: 'What is in each store now. A manager applies counts and corrections.',
    here: '{qty} here',
    noneHere: 'None here',
    notHere: {
      cafe: 'Not in the cafe store ({count})',
      bakery: 'Not in the bakery store ({count})',
    },
  },
} as const;
