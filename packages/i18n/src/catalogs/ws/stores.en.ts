/**
 * `ws.stores.*`: the cafe and bakery stores on the operator (Move stock, Added by staff,
 * the store pickers, Counts from the phone, Today in the stores). Owned by lane S
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in stores.ar.ts.
 *
 * The stores' own names are `work.store.{cafe,bakery}` ("Cafe store", "Bakery store").
 * A store named inside a sentence has its own sentence per store here, so each language
 * keeps its own word order and article.
 */
export const storesEn = {
  // Inside a sentence, after a preposition: "Stock cannot go into the cafe store…".
  inSentence: {
    cafe: 'the cafe store',
    bakery: 'the bakery store',
  },
  picker: {
    putIn: 'Put it in',
    takeFrom: 'Taken from',
    madeIn: 'Made in',
    shopCafeOnly: 'Shop stock stays in the cafe store, so the bakery store is off while a shop product is on the list.',
    beingCounted: 'A count of {store} is open. Nothing can go into it until that count is finished or discarded.',
    openCounts: 'Open the count',
    // Under a held Record or Move button; the notice above it says which count.
    held: 'Held until that count is finished or discarded.',
  },
  moves: {
    lead: 'Record stock carried from one store to the other. The venue’s total and its value stay the same.',
    direction: 'Direction',
    cafe_to_bakery: 'Cafe store to bakery store',
    bakery_to_cafe: 'Bakery store to cafe store',
    formTitle: 'What you moved',
    ingredient: 'Ingredient',
    quantity: 'Quantity',
    unit: 'Unit',
    unitPacks: 'Packs of {size}',
    shows: 'On record here: {qty}',
    problem: {
      ingredient: 'Choose what you moved.',
      qty: 'Enter how much, above zero.',
      repeat: 'Already on another line. Put it on one line.',
      short: 'More than {store} shows ({qty}). Move what it shows, or count it first.',
    },
    addLine: 'Add another ingredient',
    removeLine: 'Remove line {n}',
    move: 'Move stock',
    moveDisabled: 'Choose what you moved and how much.',
    moved: {
      cafe: 'Moved into the cafe store.',
      bakery: 'Moved into the bakery store.',
    },
    nothingAt: {
      cafe: 'Nothing is on record in the cafe store',
      bakery: 'Nothing is on record in the bakery store',
    },
    nothingAtBody: 'Stock arrives through Goods in, production and staff on the phone. Record it there first.',
    openGoodsIn: 'Open Goods in',
    countBlocked: 'Moves wait while {store} is being counted. Finish or discard that count first.',
    firstDay: {
      title: 'First day with two stores',
      body: 'Everything on record starts in the cafe store. Before the bakery’s first count, record what already sits on the bakery shelf as one move from the cafe store to the bakery store.',
    },
    recent: {
      title: 'Recent moves',
      lead: 'The last {days} days, from here and from the waiter’s phone.',
      when: 'When',
      direction: 'Direction',
      what: 'What moved',
      who: 'By',
      empty: 'No moves in the last {days} days',
      emptyBody: 'Moves recorded here or on the phone show up here.',
    },
  },
  staffLogs: {
    title: 'Added by staff',
    lead: 'Stock staff added on the phone. They never see or type a cost, so each line was booked at an estimate. Set the cost where it is missing or wrong.',
    needCost: 'Need a cost: {count}',
    by: '{name}, {when}',
    source: {
      none: 'Needs a cost',
      last_batch: 'Estimated from the last delivery',
      pack: 'Estimated from the pack price',
      entered: 'Set by a manager',
    },
    costPer: '{cost} per {unit}',
    setCost: 'Set cost',
    changeCost: 'Change cost',
    per: 'Cost for',
    perUnit: 'One {unit}',
    perPack: 'One pack of {size}',
    cost: 'Cost (IQD)',
    save: 'Save cost',
    cancel: 'Cancel',
    saved: 'Cost saved. What is still on the shelf now carries it.',
    problem: 'Enter a cost of 0 or more.',
    revalues: 'Saving changes the cost of what is still on the shelf. What was already used keeps the estimate.',
    showCosted: 'Show the ones already costed ({count})',
    hideCosted: 'Hide the ones already costed',
    allCosted: 'Every addition of the last {days} days has a cost.',
  },
  counts: {
    storeTabs: 'Store to count',
    counting: 'Counting',
    startBlocked: 'A count from the phone is waiting for {store}. Apply or discard it first.',
    discard: 'Discard this count',
    discardTitle: 'Discard this count?',
    discardBody: 'Stock does not change and the numbers entered are lost. Deliveries and moves into {store} can go ahead again.',
    discardConfirm: 'Discard count',
    discarded: 'Count discarded. Stock is unchanged.',
    phone: {
      title: 'Counts from the phone',
      lead: 'Counted blind on the phone. Stock changes only when you apply one.',
      waiting: 'Waiting: {count}',
      // The sub-nav's Stock count row, for a screen reader: the pill itself is only a number.
      badge: '{count} counts from the phone to apply',
      sentBy: '{name}, {when}',
      review: 'Review',
      hide: 'Hide',
      recordsSaid: 'Records said',
      recordsNote: 'Records said is what the records showed when the count was sent.',
      counted: 'Counted',
      difference: 'Difference',
      apply: 'Apply count',
      applyTitle: 'Apply this count?',
      applyBody: 'Stock in {store} is corrected to these {count} numbers. Anything not on this count stays as recorded. This cannot be undone.',
      applied: 'Count applied. Here is what it found.',
      discard: 'Discard',
      discardTitle: 'Discard this count?',
      discardBody: '{name} counted {store}. Stock does not change, and the count would need doing again.',
      discardConfirm: 'Discard count',
      discarded: 'Count discarded. Stock is unchanged.',
    },
  },
  onHand: {
    split: {
      cafe: 'Cafe store {qty}',
      bakery: 'Bakery store {qty}',
    },
    storeFilter: 'Store',
    bothStores: 'Both stores',
    now: {
      phoneCounts: 'Counts from the phone to apply',
      phoneCountsHint: 'Counted blind on the phone. Apply or discard each one; stock changes only when applied.',
      openCounts: 'Open counts',
      needsCost: 'Staff additions with no cost',
      needsCostHint: 'Added on the phone with no cost on record, so they are valued at nothing. Set a cost on Goods in.',
      openGoodsIn: 'Open Goods in',
    },
  },
  waste: {
    onHandAt: {
      cafe: 'In the cafe store: {qty}',
      bakery: 'In the bakery store: {qty}',
    },
    productionHint: 'Its ingredients come out of this store first, then the other one. The batch goes into this store.',
  },
  ledger: {
    store: 'Store',
    to: {
      cafe: 'To the cafe store',
      bakery: 'To the bakery store',
    },
    from: {
      cafe: 'From the cafe store',
      bakery: 'From the bakery store',
    },
  },
  variance: {
    store: 'Store',
    moved: 'Moved',
    movedIn: 'in',
    movedOut: 'out',
    countLabel: '{store}, {date}',
  },
  alerts: {
    negativeAt: {
      cafe: '{qty} sold beyond the record, at the cafe store',
      bakery: '{qty} sold beyond the record, at the bakery store',
    },
  },
  store: 'Store',
  setup: {
    needsCost: 'Staff stock additions need a cost',
    needsCostHint: 'Staff added stock on the phone with no cost on record, so it counts as worth nothing in stock value and margins. Set the cost on Goods in, under Added by staff.',
    needsCostAction: 'Open Goods in',
  },
  // /tasks' read-only copy of the phone's store pages (wave5-addendum §5.1, M2).
  today: {
    tab: 'Today in the stores',
    empty: 'Nothing moved, added or counted today',
    moved: {
      cafe_to_bakery: 'Moved to the bakery store',
      bakery_to_cafe: 'Moved to the cafe store',
    },
    added: {
      cafe: 'Added to the cafe store',
      bakery: 'Added to the bakery store',
    },
    goodsIn: 'Goods in',
    driverWaiting: 'Driver deliveries waiting for a manager: {count}. Do not add those on the phone.',
    counted: {
      cafe: 'Count of the cafe store',
      bakery: 'Count of the bakery store',
    },
    countStatus: {
      waiting: 'Waiting for a manager',
      applied: 'Applied',
    },
  },
  // The waiter's and the heads' Stock copy on /tasks, by store.
  stockByStore: 'Cafe store {cafe} · Bakery store {bakery}',
} as const;
