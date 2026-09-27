/**
 * `staff.calls.*`: the waiter's guest calls on the phone (app/staff-calls.tsx) and its Today row.
 * Owned by lane R (docs/design/protocols/wave5-addendum-2026-09-25.md §2.1.8, §8 Q3). The till's
 * own words are reused, not copied: "On my way", "Done", the reasons, "Table {table}" and the
 * waiting line are `op.floor.*`. Mirror every key in calls.ar.ts.
 */
export const staffCallsEn = {
  title: 'Guest calls',
  /** The Today row with open calls: the checklists' own "Checklists · 2" form. */
  rowCount: 'Guest calls · {count}',
  /** The Today group the row sits in, first for the waiter. */
  group: 'On the floor',
  lead: 'The till sees these calls too. Whoever answers first takes the call.',
  listTitle: 'Open calls',
  mine: 'You’re on the way',
  other: 'Someone is on the way',
  old: 'Older than 2 hours',
  emptyTitle: 'Nobody is waiting',
  emptyBody: 'When a table calls for a waiter, it shows up here and your phone buzzes.',
  answered: 'Someone else already answered this call.',
  notLive: 'Not updating by itself right now. Pull down to refresh.',
  age: {
    minutes: '{minutes} min',
    hours: '{hours} h {minutes} min',
    days: '{days} d {hours} h',
  },
} as const;
