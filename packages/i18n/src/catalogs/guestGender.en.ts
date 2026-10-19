/**
 * `guestGender.*` (Gender hours, the phone's side; Majed, 2026-10-19, migration 0353). Mirror
 * every key in guestGender.ar.ts.
 *
 * A gender is a must for every account, because some courts and hours are kept for women or
 * for men. The choice itself reads "Woman / Man" (`matches.gender.*`) under the "Gender" label
 * (`profile.genderSection`); a kept time's tag reads `matches.common.categoryWomen` /
 * `categoryMen` ("Women only" / "Men only"). These are the lines that had no home yet.
 */
export const guestGenderEn = {
  // Sign up and Complete profile: under the choice, and its error.
  hint: 'Some courts and hours are kept for women or for men. You choose once; the front desk can correct it.',
  required: 'Choose woman or man to continue.',
  // Complete profile's line when only the gender is missing (the phone and name are there).
  completeBody: 'One more answer for your profile before you book.',
  // A booking time two rules keep for women AND for men: nobody books it online.
  tagBoth: 'Not bookable',
  // Start an open match at a kept time.
  match: {
    lockedWomen: 'This time is kept for women, so the match is for women only.',
    lockedMen: 'This time is kept for men, so the match is for men only.',
    closedWomen: 'This time is kept for women only. Please pick another time.',
    closedMen: 'This time is kept for men only. Please pick another time.',
    closedBoth: 'This time is not open for matches. Please pick another time.',
  },
};
