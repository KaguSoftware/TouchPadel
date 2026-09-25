/**
 * `staff.supplies.*` — the staff phone’s production, shopping list and purchases.
 * Owned by lane H (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in supplies.ar.ts.
 *
 * Line and purchase statuses are `work.shopping.status.*` and
 * `work.purchase.status.*`, shared with the operator.
 */
export const staffSuppliesEn = {
  // Today's rows for these pages (rows.ts).
  rows: {
    shopping: 'Shopping list',
    // The driver's shopping row (#70).
    run: 'Shopping run',
    purchases: 'Purchases',
  },
  // shopping_items.unit; `one` when the quantity is exactly 1.
  units: {
    one: { g: 'g', ml: 'ml', pc: 'piece', pack: 'pack' },
    many: { g: 'g', ml: 'ml', pc: 'pieces', pack: 'packs' },
  },
  // "2 packs", "500 g"
  qtyUnit: '{qty} {unit}',
  shopping: {
    title: 'Shopping list',
    lead: {
      head: 'Add what you need. It goes straight to the driver.',
      chef: 'Add what the kitchen needs. Each line waits for the head chef’s OK before the driver sees it.',
      reader: 'What the driver is buying. Ask the head barista to add something.',
      driver: 'Tick what you buy. At each shop, record the purchase with its receipt.',
      mgmt: 'Add what you need; it goes straight to the driver. The chef assistant’s lines wait here for your OK.',
    },
    add: {
      title: 'Add to the list',
      what: 'What to buy',
      whatHint: 'Pick a stock item from the matches, or keep what you typed if it is not one.',
      stockItem: 'Stock item',
      change: 'Change',
      qty: 'How much',
      unit: 'Unit',
      note: 'Note · Optional',
      submit: 'Add to the list',
      waitsForOk: 'Waits for the head chef’s OK before the driver sees it.',
      added: 'Added. The driver sees it now.',
      sentForOk: 'Sent to the head chef for an OK.',
      errors: {
        what: 'Write what to buy.',
        whatTooLong: 'Keep it to 80 characters.',
        qty: 'Enter an amount above 0, like 2 or 1.5.',
        unit: 'Choose a unit.',
        noteTooLong: 'Keep the note to 200 characters.',
      },
    },
    approve: {
      title: 'Waiting for your OK ({count})',
      lead: 'The chef assistant’s lines. Approve one and the driver sees it.',
      approve: 'Approve',
      decline: 'Decline',
      reason: 'Why not? The chef assistant sees this.',
      confirmDecline: 'Decline this line',
      keep: 'Keep it',
      approved: 'Approved. The driver sees it now.',
      declined: 'Declined. The chef assistant is told why.',
      errors: {
        reason: 'Say why, so the chef assistant knows.',
        reasonTooLong: 'Keep the reason to 300 characters.',
      },
    },
    waiting: {
      title: 'Waiting for the head chef ({count})',
    },
    declined: {
      title: 'Declined by the head chef',
      reason: 'Why: {reason}',
    },
    list: {
      title: 'To buy ({count})',
      empty: 'Nothing to buy right now.',
      by: 'Added by {name} · {when}',
      cancel: 'Take off the list',
      cancelConfirm: 'Take this off the shopping list?',
      cancelled: 'Taken off the list.',
    },
    run: {
      title: 'Your run ({count})',
      record: 'Record purchase ({count})',
      recordNone: 'Record a purchase',
      purchases: 'Your purchases and receipts',
    },
  },
  purchase: {
    title: 'Purchases',
    form: {
      title: 'Record a purchase',
      lead: 'One purchase per shop: what you bought, what you paid, and the receipt.',
      fromList: 'From the list',
      listAsked: 'The list asked for {qty}',
      bought: 'Bought ({unit})',
      boughtNoUnit: 'Bought',
      packHint: 'Type the amount in {unit}: stock is counted in {unit}, not packs.',
      paid: 'Paid (IQD)',
      remove: 'Remove',
      extra: 'Not on the list',
      label: 'What you bought',
      addLine: 'Add something not on the list',
      noLines: 'Tick what you bought on the shopping list, or add a line here.',
      gone: 'Some ticked lines are no longer on the list ({count}), so they are left out.',
      shop: 'Shop · Optional',
      receipt: 'Receipt photo',
      receiptHint: 'A photo of the receipt lets the manager check the purchase.',
      total: 'Total paid',
      save: 'Save purchase',
      saved: 'Purchase recorded. The manager receives it in Goods in.',
      noReceiptTitle: 'No receipt photo',
      noReceiptBody: 'Save this purchase without a photo of the receipt?',
      saveAnyway: 'Save without it',
      errors: {
        lines: 'Add at least one line.',
        tooMany: 'One purchase holds up to 40 lines.',
        label: 'Write what you bought.',
        labelTooLong: 'Keep it to 80 characters.',
        qty: 'Enter an amount above 0.',
        price: 'Enter what you paid, in whole dinars.',
        shopTooLong: 'Keep the shop name to 80 characters.',
      },
    },
    list: {
      mine: 'Your purchases',
      all: 'Purchases',
      empty: 'No purchases yet.',
      noShop: 'Shop not named',
      showReceipt: 'Show receipt',
      hideReceipt: 'Hide receipt',
      noReceipt: 'No receipt photo',
      markDelivered: 'Delivered',
      deliveredAt: 'Delivered {when}',
      deliveredConfirmTitle: 'At the venue?',
      deliveredConfirmBody: 'Confirm the goods from this purchase are at the venue.',
      deliveredDone: 'Marked as delivered.',
      mgmtNote: 'Purchases go into stock in Goods in on the operator.',
    },
  },
} as const;
