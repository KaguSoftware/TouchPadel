/**
 * `ws.pricing.*` — the manager locks in Stock ▸ Products, Add-ons, Promotions, Rates and the hero’s
 * featured discount.
 * Owned by lane F (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in pricing.ar.ts.
 */
export const pricingEn = {
  // The starts a manager gets where a price now needs the owner’s OK (§5.5).
  // Each opens a price or promo change on /protocols, prefilled from its row.
  changePrice: 'Change the price',
  changePriceFor: 'Change the price: {name}',
  putOnSale: 'Put on sale',
  putOnSaleFor: 'Put on sale: {name}',
  savedHidden: 'Saved hidden until the owner approves its price',
  // Stock ▸ Products (#51, #53).
  products: {
    note: 'Prices of products on sale change through “Change the price”, with the owner’s OK. A new product is saved hidden: add its sizes and prices, then “Put on sale” sends it to the owner.',
    newHint:
      'A new product is saved hidden. Add its sizes and prices, then press “Put on sale”: it goes on sale when the owner approves its price.',
    priceLocked: 'This product is on sale, so its price changes through “Change the price”, with the owner’s OK. Everything else here is yours to edit.',
  },
  // Add-ons (#51, #53).
  addons: {
    note: 'Prices of options on sale change through “Change the price”, with the owner’s OK. A new paid option is saved hidden, and “Put on sale” sends its price to the owner. A free option goes on at once.',
    requiredAddon:
      'This would make guests pay more: a paid option they would have to pick, or a free one taken away. Only the owner makes this change.',
  },
  // Promotions and the promotion editor (#57).
  promotions: {
    note: 'The owner approves new promotions, changes to them and switching one back on. Propose it here and follow it in Protocols. You can still switch a promotion off.',
    editorNote: 'Only the owner edits a promotion directly. Propose a change and the owner approves it in Protocols.',
    newNote: 'A new promotion starts as a proposal in Protocols, and the owner approves it.',
    propose: 'Propose a promotion',
    change: 'Change this promotion',
    switchOn: 'Switch on',
    switchOnFor: 'Switch on: {name}',
  },
  // Court rates (#57).
  rates: {
    note: 'The owner approves court rates. Propose a new rate or a change here and follow it in Protocols.',
    propose: 'Propose a new rate',
    change: 'Change this rate',
  },
  // The hero builder’s featured discount (#57).
  hero: {
    discountLocked: 'The owner approves the discount. Change it in Protocols, or switch it off here.',
    changeDiscount: 'Change the discount',
    switchOff: 'Switch the discount off',
    itemLocked: 'Moving the featured item moves its discount. Change both with “Change the discount”, or switch the discount off first.',
    featuredLocked: 'Featured mode puts the stored discount on sale. Switch the discount off first, or change it in Protocols.',
    storedDiscount: 'A {pct}% discount is stored for {item}.',
    switchOffConfirm: {
      title: 'Switch the featured discount off?',
      body: 'The featured item goes back to its full price on the till and the guest menu. A new discount needs the owner’s OK.',
      confirm: 'Switch it off',
      cancel: 'Keep it',
    },
    switchedOff: 'The featured discount is off.',
  },
} as const;
