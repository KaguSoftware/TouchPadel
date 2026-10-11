/**
 * `ws.rewards.*`: the owner's Rewards page (/rewards), the standing rewards
 * for orders placed in a business month (0332) that are added to a person's
 * wage the month after they are reached (0333). Mirror every key in
 * rewards.ar.ts.
 *
 * Money about a named person: no string here carries a figure it was not
 * given. Nothing here compares people: the page lists them by name. A counted
 * phrase sits under `count.*` with all six plural forms (countPhrase,
 * @touch/i18n plural.ts). Single-line literals only (the assistant map
 * indexes them).
 */
export const rewardsEn = {
  title: 'Rewards',
  lead: 'Set a bonus or a prize for a number of orders placed in a month. Each person sees only their own progress on their phone. Bonuses are added to their wage the month after they are reached.',
  links: {
    wages: 'Wages',
  },
  count: {
    orders: {
      zero: '0 orders',
      one: '1 order',
      two: '2 orders',
      few: '{count} orders',
      many: '{count} orders',
      other: '{count} orders',
    },
    daysLeft: {
      zero: 'last day',
      one: 'last day',
      two: '2 days left',
      few: '{count} days left',
      many: '{count} days left',
      other: '{count} days left',
    },
  },
  cols: {
    person: 'Person',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    rewards: 'Rewards',
  },
  reward: {
    at: 'At {orders}',
    reached: 'Reached',
    toGo: '{orders} to go',
    none: 'No rewards set.',
    limit: 'Up to {max} rewards each: remove one to add another.',
  },
  actions: {
    add: 'Add reward',
    remove: 'Remove',
    removeFor: 'Remove the reward at {orders} for {name}',
  },
  form: {
    title: 'Add a reward for {name}',
    target: 'Orders in a month',
    targetHint: 'From 1 to 100,000.',
    bonus: 'Bonus',
    bonusHint: 'Up to 10,000,000. Leave it empty for a prize only.',
    prize: 'Prize',
    prizeHint: 'Up to {max} characters, for example dinner for two.',
    needOne: 'Enter a bonus, a prize, or both.',
    save: 'Save reward',
    saved: 'Reward saved.',
    issue: {
      target: 'Enter a number of orders from 1 to 100,000.',
      bonus: 'Enter a bonus up to 10,000,000.',
      prize: 'Keep it to {max} characters.',
    },
  },
  remove: {
    title: 'Remove this reward?',
    body: '{name} will no longer see the reward at {orders}. This month still counts: if they reach it by the end of the month, it is still earned.',
    confirm: 'Remove reward',
    keep: 'Keep it',
    done: 'Reward removed.',
  },
  empty: {
    title: 'Nobody to reward at this branch',
    body: 'Waiters, cashiers and managers active at this branch show here.',
  },
} as const;
