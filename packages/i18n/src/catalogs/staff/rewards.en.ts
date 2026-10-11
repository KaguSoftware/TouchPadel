/**
 * `staff.rewards.*`: the owner's per-person rewards for orders placed (0332). The reward track
 * on the staff phone's Today and the person's own page (app/staff-rewards.tsx), and the owner's
 * page that sets them (app/staff-rewards-admin.tsx). Each person reads only their own progress;
 * nothing here compares people. Mirror every key in rewards.ar.ts.
 */
export const staffRewardsEn = {
  /** A count of orders; `{count}` is the number. */
  orders: {
    zero: '0 orders',
    one: '1 order',
    two: '2 orders',
    few: '{count} orders',
    many: '{count} orders',
    other: '{count} orders',
  },
  /** Days left in the month, today counted. */
  daysLeft: {
    zero: 'Last day',
    one: 'Last day',
    two: '2 days left',
    few: '{count} days left',
    many: '{count} days left',
    other: '{count} days left',
  },
  /** Today's card. */
  card: {
    /** The eyebrow: "October rewards". */
    title: '{month} rewards',
    /** The headline: "16 orders to 50,000 IQD". */
    next: '{orders} to {reward}',
    /** Every reward this month is reached. */
    allDone: {
      zero: 'Every reward unlocked',
      one: 'Your reward is unlocked',
      two: 'Both rewards unlocked',
      few: 'All {count} rewards unlocked',
      many: 'All {count} rewards unlocked',
      other: 'All {count} rewards unlocked',
    },
    /** In place of the eyebrow, the visit a reward was reached since the last one. */
    unlocked: 'Unlocked: {reward}',
    /** A reward that is a prize as well as a bonus. */
    plusPrize: 'Plus {prize}',
    thisMonth: '{orders} this month',
    /** Rewards reached last month. */
    lastMonth: {
      zero: 'Last month: none unlocked',
      one: 'Last month: 1 unlocked',
      two: 'Last month: 2 unlocked',
      few: 'Last month: {count} unlocked',
      many: 'Last month: {count} unlocked',
      other: 'Last month: {count} unlocked',
    },
    /** Accessibility: the whole card as one button. */
    a11y: '{headline}. {progress}. Opens your rewards.',
    /** Accessibility: the track. */
    trackA11y: '{orders} of {target}',
  },
  /** The person's own page. */
  mine: {
    title: 'My rewards',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    /** One reward's line: "At 200 orders". */
    at: 'At {orders}',
    reached: 'Unlocked',
    toGo: '{orders} to go',
    lastMonthCount: '{orders} placed',
    lastMonthNone: 'No reward was unlocked.',
    /** Under a bonus reached last month: the wage month it is paid in ("Added to your November wage"). */
    inWage: 'Added to your {month} wage',
    howTitle: 'How it counts',
    how: 'Every order you place on the till or on this phone counts, at this branch. A voided order does not. The count starts again with each new month.',
    empty: 'No rewards yet. When the owner sets one for you, it shows here and on Today.',
    loadFailed: 'Your rewards could not be loaded.',
  },
  /** The owner's page. */
  admin: {
    title: 'Rewards',
    /** Today's tile, and its one-line preview. */
    entry: 'Rewards',
    entryPreview: 'Bonuses for orders placed',
    intro:
      'Set a bonus for a number of orders placed in a month. Each person sees only their own progress. Bonuses are added to their wage the month after they are reached.',
    /** One person's figures. */
    thisMonth: '{orders} this month',
    lastMonth: 'last month {orders}',
    none: 'No rewards set.',
    at: 'At {orders}',
    reached: 'Reached',
    add: 'Add reward',
    target: 'Orders in a month',
    bonus: 'Bonus (IQD)',
    prize: 'Prize (optional)',
    prizePlaceholder: 'Dinner for two',
    save: 'Save reward',
    cancel: 'Cancel',
    targetInvalid: 'Enter a number of orders from 1 to 100,000.',
    rewardMissing: 'Enter a bonus, a prize, or both.',
    saved: 'Reward saved',
    remove: 'Remove',
    removeTitle: 'Remove this reward?',
    removeBody: '{name} will no longer see the reward at {orders}. This month still counts: if they reach it by the end of the month, it is still earned.',
    removed: 'Reward removed',
    empty: 'No waiters, cashiers or managers work at this branch yet.',
    loadFailed: 'The rewards could not be loaded.',
  },
} as const;
