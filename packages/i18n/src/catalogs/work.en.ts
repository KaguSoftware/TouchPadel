/**
 * `work.*` — the words both apps show for protocols, checklists, shopping and
 * purchases (docs/design/protocols/build-contracts-2026-09-23.md §4). The
 * operator's `ws.*` lanes and the phone's `staff.*` lanes read these instead
 * of each keeping a copy. Mirror every key in work.ar.ts.
 *
 * Keys under a status or kind match the database values (protocol_runs.status,
 * protocol_run_steps.status, shopping_items.status, …) so a screen looks them up
 * directly. Role names stay `op.roles.*`.
 */
export const workEn = {
  protocol: {
    kind: {
      product_release: 'New item',
      tournament: 'Tournament',
      hiring: 'Hiring',
      price_promo: 'Price or promo change',
    },
    variant: {
      type1: 'Type 1',
      type2: 'Type 2 (community)',
      type3: 'Type 3 (sponsor or client)',
    },
    runStatus: {
      active: 'In progress',
      scheduled: 'Scheduled',
      // A product release after launch, until its day-30 review is written.
      live: 'Launched',
      done: 'Finished',
      stopped: 'Stopped',
      withdrawn: 'Withdrawn',
    },
    stepStatus: {
      waiting: 'Not open yet',
      open: 'To do',
      submitted: 'Waiting for a decision',
      passed: 'Done',
      skipped: 'Skipped',
      stopped: 'Stopped',
    },
    decision: {
      approve: 'Approved',
      auto: 'Passed automatically',
      send_back: 'Sent back',
      stop: 'Stopped',
    },
    action: {
      start: 'Start',
      submit: 'Send',
      withdraw: 'Withdraw',
      approve: 'Approve',
      sendBack: 'Send back for changes',
      stop: 'Stop',
      skip: 'Skip',
      launchNow: 'Launch now',
      launchOnDate: 'Launch on a date',
      applyNow: 'Apply now',
      applyOnDate: 'Apply on a date',
      cancelSchedule: 'Cancel the date',
    },
    needsOwnerOk: 'Needs the owner’s OK',
    optional: 'Optional',
    round: 'Round {round}',
    autoPassed: 'Passed automatically: sent by someone who decides this step.',
    involved: 'Involves you',
    // Shown in place of the '[deleted after 90 days]' marker the hiring purge
    // writes over decision notes, skip notes and stop reasons.
    noteDeleted: 'Note deleted after 90 days',
    // The eight price or promo change kinds (record `change`).
    change: {
      price: 'Change item prices',
      shop_launch: 'Put a shop product on sale',
      addon_price: 'Change add-on prices',
      promotion: 'Propose a promotion',
      promotion_edit: 'Change a promotion',
      promotion_enable: 'Switch a promotion on',
      rate: 'Change or add a court rate',
      featured_discount: 'Change the featured-item discount',
    },
  },
  checklist: {
    slot: {
      open: 'Opening',
      close: 'Closing',
    },
  },
  shopping: {
    status: {
      open: 'To buy',
      bought: 'Bought',
      cancelled: 'Cancelled',
      received: 'Received',
      acknowledged: 'Checked',
      // A chef assistant's line (role spec #66).
      pending: 'Waiting for the head chef',
      declined: 'Declined',
    },
  },
  // purchases.status (to_receive, done) and purchase_lines.status (to_receive,
  // received, acknowledged) share this map.
  purchase: {
    status: {
      to_receive: 'To receive',
      done: 'Done',
      received: 'Received',
      acknowledged: 'Checked',
    },
  },
  item: {
    kind: {
      drink: 'Drink',
      dessert: 'Dessert',
      food: 'Food',
    },
  },
  // marketing_requests.status (role spec #73).
  marketingRequest: {
    status: {
      open: 'Waiting for marketing',
      done: 'Done',
      declined: 'Declined',
      withdrawn: 'Withdrawn',
    },
  },
  // recipe_change_requests.status (role spec #71).
  recipeChange: {
    status: {
      waiting: 'Waiting for the owner',
      approved: 'Approved',
      declined: 'Declined',
      withdrawn: 'Withdrawn',
    },
  },
  // release_ideas.status (role spec #65): a barista's or chef assistant's
  // idea for a new item, waiting for the head of their team.
  idea: {
    status: {
      waiting: 'Waiting for review',
      started: 'Started as a new item',
      declined: 'Declined',
      withdrawn: 'Withdrawn',
    },
  },
  // release_ideas.team: bar (head barista, barista), kitchen (head chef, chef).
  team: {
    bar: 'Bar',
    kitchen: 'Kitchen',
  },
} as const;
