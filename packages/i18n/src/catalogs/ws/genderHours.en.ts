/**
 * `ws.genderHours.*` — Gender hours (0353, `court_gender_rules`): the
 * management page at /admin/gender-hours, the kept bands on the desk calendar,
 * the note in the new-booking dialog, and the gender asked for on every new
 * customer at the desk. Mirror every key in genderHours.ar.ts.
 */
export const genderHoursEn = {
  page: {
    title: 'Gender hours',
    lead: 'Courts kept for women or men at set times. At a kept time, only a guest of that gender can book the court.',
    newRule: 'New rule',
    editRule: 'Edit rule',
    rule: 'Rule',
    who: 'For',
    court: 'Court',
    days: 'Days',
    window: 'Time',
    everyCourt: 'Every court',
    everyDay: 'Every day',
    womenOnly: 'Women only',
    menOnly: 'Men only',
    // After an overnight window: "22:00–02:00 (next day)".
    nextDay: 'next day',
    off: 'Off',
    showOff: 'Show switched-off rules ({count})',
    hideOff: 'Hide switched-off rules',
    empty: 'No gender hours yet.',
    emptyBody: 'Every court is open to everyone. Add a rule to keep one court, or every court, for women or men at set times.',
    howApplied: 'A booking that touches a kept time, even partly, needs a guest of that gender. A booking under a typed name only is not checked, so look at the calendar.',
    clashTitle: 'Rules that clash',
    clashLead: 'Each pair keeps the same court at the same time, one for women and one for men, so nobody can book it then. Open one of them and change its time, days or court.',
    clashFrom: 'first on {day}',
    clashBadge: 'Clashes',
    clashesAll: 'Show all {count} pairs',
    clashesFewer: 'Show fewer',
    clashInForm: 'Clashes with {name} ({day}): nobody can book then. Change the time, days or court of one of them.',
    saved: 'Rule saved.',
  },
  form: {
    name: 'Rule name',
    who: 'Kept for',
    women: 'Women',
    men: 'Men',
    court: 'Court',
    everyCourt: 'Every court',
    everyCourtHint: 'The whole club is kept at these times: every court of this branch.',
    oneCourtHint: 'Only this court is kept. The others stay open to everyone.',
    days: 'Days',
    start: 'Start',
    end: 'End',
    overnightHint: 'An end earlier than the start runs past midnight. The hours after midnight belong to the start day.',
    validFrom: 'From date',
    validTo: 'To date',
    validityHint: 'Blank means open-ended.',
    active: 'On',
    activeHint: 'A switched-off rule keeps nothing. Rules are switched off, never deleted.',
    disabled: {
      name: 'Give the rule a name.',
      who: 'Choose women or men.',
      days: 'Pick at least one day.',
      sameTime: 'The start and end cannot be the same time.',
    },
  },
  // The desk calendar's band over a kept time on a court.
  calendar: {
    womenOnly: 'Women only',
    menOnly: 'Men only',
    both: 'Rules clash',
  },
  // The new-booking dialog, under the time.
  booking: {
    womenOnly: 'Women only at this time.',
    menOnly: 'Men only at this time.',
    both: 'Kept for women and for men at this time, so nobody can book it.',
    needsGender: "This customer's record has no gender. Set it to book this time.",
    setGender: 'Set gender',
    notWomen: 'This customer is a man. This time is for women only.',
    notMen: 'This customer is a woman. This time is for men only.',
    // Why Create is disabled.
    blockedNeedsGender: "Set the customer's gender first.",
    blockedOther: 'This time is kept for the other gender.',
  },
  // The desk's New customer form: a gender is a must for every account.
  customer: {
    gender: 'Gender',
    woman: 'Woman',
    man: 'Man',
    hint: 'Some courts and hours are kept for women or men.',
    required: 'Choose woman or man.',
  },
} as const;
