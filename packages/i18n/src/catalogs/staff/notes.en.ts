/**
 * `staff.notes.*` — the staff phone’s notes on new items.
 * Owned by lane H (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in notes.ar.ts.
 *
 * Every role may note what customers and colleagues say about a new item for
 * its first 30 days (Q9); the notes feed the day-30 review.
 */
export const staffNotesEn = {
  title: 'Notes on new items',
  lead: 'For 30 days after a new item launches, write down what customers and the team say about it. The notes go into its day-30 review.',
  empty: 'No new item is in its first 30 days right now.',
  pick: 'Which item?',
  daysLeft: '{days} days left',
  lastDay: 'Last day for notes',
  closed: 'Notes on this item closed 30 days after its launch.',
  body: 'What did you hear or see?',
  hint: 'Write what customers said, without names or phone numbers.',
  add: 'Add the note',
  added: 'Note added',
  notesTitle: 'Notes so far',
  none: 'No notes on this item yet.',
  mine: 'You',
  by: '{name}, {when}',
  tooLong: 'Keep it under 2,000 characters.',
  required: 'Write something first.',
} as const;
