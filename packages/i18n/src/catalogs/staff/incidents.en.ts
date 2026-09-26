/**
 * `staff.incidents.*`: the staff phone's incidents page (app/staff-incidents.tsx: report,
 * my reports, review). Owned by lane P (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in incidents.ar.ts.
 *
 * Kinds, places and statuses are `work.incident.*`, shared with the operator
 * and with the push (app.incident_kind_label); role names are `op.roles.*`.
 */
export const staffIncidentsEn = {
  // Today's row (rows.ts), for every role.
  row: 'Incidents',
  // Management's row while reports wait (§5.3).
  rowCount: 'Incidents ({count} to review)',
  title: 'Incidents',
  views: {
    review: 'To review ({count})',
    reviewNone: 'To review',
    report: 'Report',
  },
  lead: 'An accident, an injury, a fight or damage at the venue. Report it here and the managers and the owner are told.',
  form: {
    title: 'Report an incident',
    kind: 'What kind',
    when: 'When',
    whenHint: 'Year-month-day and the time, for example {example}.',
    place: 'Where',
    court: 'Which court',
    noCourts: 'No courts to choose from.',
    placeDetail: 'Where exactly · Optional',
    description: 'What happened, in your words',
    people: 'Who was involved · Optional',
    // wave5-addendum §2.6.2, the form's privacy hint.
    privacyHint: 'Write only what is needed. Do not add phone numbers.',
    photos: 'Photos · Optional',
    whoSees: 'Only you, the managers and the owner see this report.',
    submit: 'Send report',
    sent: 'Report sent. A manager will review it.',
    errors: {
      kind: 'Choose what kind it was.',
      when: 'Enter the time like {example}.',
      future: 'That time has not come yet.',
      tooOld: 'Only the last 7 days can be reported here. Tell a manager about anything older.',
      place: 'Choose where it happened.',
      court: 'Choose the court.',
      placeDetailTooLong: 'Keep it to 120 characters.',
      description: 'Describe what happened.',
      descriptionTooLong: 'Keep it to 2,000 characters.',
      peopleTooLong: 'Keep it to 1,000 characters.',
    },
  },
  mine: {
    title: 'Your reports',
    empty: 'You have not reported anything.',
  },
  list: {
    where: '{place} ({detail})',
    people: 'Involved: {people}',
    redacted: 'This report’s text was deleted.',
    // A redacted report whose photos protocol-action has not removed yet (0198).
    photosGoing: 'The photos are deleted at the next cleanup.',
    reviewedBy: 'Reviewed by {name}: {note}',
    from: '{name} · {role}',
    reportedAt: 'Reported {when}',
  },
  review: {
    filters: {
      open: 'Open',
      reviewed: 'Reviewed',
      all: 'All',
    },
    empty: 'No reports here.',
    emptyOpen: 'Nothing to review.',
    open: 'Review',
    note: 'Your note',
    noteHint: 'The reporter sees this note.',
    confirm: 'Mark reviewed',
    cancel: 'Cancel',
    done: 'Marked reviewed. The reporter is told.',
    own: 'You reported this, so another manager or the owner reviews it.',
    // The owner's own report: only a manager is left to review it.
    ownOwner: 'You reported this, so a manager reviews it.',
    errors: {
      note: 'Write a note for the reporter.',
      noteTooLong: 'Keep it to 1,000 characters.',
    },
  },
} as const;
