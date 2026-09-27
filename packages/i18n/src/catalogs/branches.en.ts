/**
 * `branches.*`: the guest-facing words for Touch's branches (multi-venue slice 4,
 * plan MV1–MV8): the branch picker in the guest app and on the website, and the
 * branch lines on the club site. The mobile app owns `mobile`, the website owns
 * `web`; `common` is shared. Mirror every key in branches.ar.ts.
 *
 * Vocabulary: a "branch" is one Touch location (venues row). Guests only ever
 * see branches that are open.
 */
export const branchesEn = {
  common: {
    branch: 'Branch',
    chooseBranch: 'Choose a branch',
    changeBranch: 'Change branch',
    allBranches: 'All branches',
    address: 'Address',
    directions: 'Directions',
    call: 'Call {name}',
  },
  mobile: {
    pickerTitle: 'Where do you want to play?',
    pickerHint: 'You can change this any time.',
    bookingAt: 'Booking at {name}',
  },
  web: {
    menuPickerTitle: 'Which branch are you at?',
    menuPickerHint: 'Scan the code on your table to order there directly.',
    visitTitle: 'Our branches',
    openNow: 'Open today',
  },
} as const;
