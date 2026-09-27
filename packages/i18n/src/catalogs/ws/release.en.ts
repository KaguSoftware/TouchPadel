/**
 * `ws.release.*` — the menu editor’s in-release notice, price lock and “Propose a new item”, and the
 * variance column.
 * Owned by lane E (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in release.ar.ts.
 */
export const releaseEn = {
  // Count differences (Stock ▸ Variance) and the stock report's counts: what
  // left stock as a new item's test servings (product_test movements).
  variance: {
    productTest: 'Product tests',
  },
  // The ledger's note on a product-test movement links to its release.
  ledger: {
    openRun: 'Open the product release',
  },
  // The menu editor (Setup ▸ Menu items): a manager's new café item is a
  // proposal, an item in release waits for its run, and a price on sale
  // changes through a price change. The owner's editor shows only the
  // in-release parts.
  menu: {
    proposeItem: 'Propose a new item',
    proposeHint: 'New café items go through a product release, and the owner launches them.',
    inReleaseBadge: 'In release',
    inRelease: 'In release: {run}',
    inReleaseBody: 'Its prices come from the release, and it goes on sale when the owner launches it.',
    openRun: 'Open the release',
    putOnSale: 'Put on sale',
    // Under the Active switch, when it cannot be switched on here.
    switch: {
      inRelease: 'Goes on sale when the owner launches its release.',
      ownerLaunches: 'Goes on sale when the owner launches it.',
      putOnSale: 'Saved hidden until the owner approves its price.',
      savedHidden: 'A new product is saved hidden. Add its sizes and prices, then press Put on sale: it goes on sale when the owner approves its price.',
    },
    sizes: {
      changePrice: 'Change the price',
      // Wave 5 (N, §2.2, #9): the names of its sizes lock with their prices.
      onSale: 'This item is on sale, so its sizes’ prices and names change through Change the price, with the owner’s OK.',
      inRelease: 'The release’s price step sets these prices.',
    },
  },
} as const;
