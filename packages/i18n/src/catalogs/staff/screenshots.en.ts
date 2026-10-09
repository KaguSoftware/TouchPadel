/**
 * `staff.screenshots.*`: the owner's list of staff screenshots (app/staff-screenshots.tsx) and
 * the floating assistant button's label. Mirror every key in screenshots.ar.ts.
 */
export const staffScreenshotsEn = {
  title: 'Screenshots',
  /** Today's tile, and its one-line preview. */
  entry: 'Screenshots',
  entryPreview: 'Who captured which page',
  intro: 'Staff cannot capture the staff app on Android; every screenshot an iPhone allows, and every attempt we hear of, is listed here.',
  empty: 'No screenshots reported.',
  loadFailed: 'The list could not be loaded.',
  /** One row: who, on which page. */
  row: '{name} on {page}',
  unknownStaff: 'A staff member',
} as const;
