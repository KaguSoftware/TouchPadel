/**
 * `ws.incidents.*`: the operator's /incidents page (report, my reports, review, redact).
 * Owned by lane P (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in incidents.ar.ts.
 *
 * The kinds, places and statuses are `work.incident.*`. A report's own text is
 * staff free text, shown as typed; a redacted one reads `redactedText`.
 */
export const incidentsEn = {
  title: 'Incidents',
  leadStation:
    'Report an accident, an injury, a fight or damage here. A manager reviews every report.',
  leadReview:
    'Reports from the desk, the till and staff phones. Review each one with a note the reporter reads.',
  filterLabel: 'Show reports',
  filter: {
    open: 'To review',
    openCount: 'To review ({count})',
    reviewed: 'Reviewed',
    all: 'All',
  },
  cols: {
    what: 'What kind',
    when: 'When',
    summary: 'Report',
    reportedBy: 'Reported by',
    photos: 'Photos',
    status: 'Status',
  },
  review: 'Review',
  view: 'Open',
  // Also what a report reads once the 365-day purge has run (redacted = text_purged_at set, 0198).
  redactedText: 'This report’s text was deleted.',
  redactedShort: 'Text deleted',
  reviewedBy: 'Reviewed by {name}, {time}',
  happenedAt: 'Happened {time}',
  empty: {
    open: 'Nothing to review',
    openBody: 'When someone reports an incident, it waits here until a manager reviews it.',
    reviewed: 'No reviewed reports yet',
    all: 'No incidents reported',
  },
  mine: {
    title: 'My reports',
    empty:
      'You have not reported anything. What you send shows here, with the manager’s note once it is reviewed.',
  },
  form: {
    title: 'Report an incident',
    kind: 'What kind',
    when: 'When',
    whenHint: 'Up to 7 days ago.',
    now: 'Now',
    place: 'Where',
    court: 'Which court',
    chooseCourt: 'Choose a court',
    placeDetail: 'Where exactly',
    placeDetailPlaceholder: 'By the entrance',
    privacyHint: 'Write only what is needed. Do not add phone numbers.',
    description: 'What happened',
    people: 'Who was involved',
    peopleHint: 'Staff, guests or others, as briefly as you can.',
    submit: 'Send report',
    sent: 'Report sent. A manager will review it.',
    issue: {
      required: 'Fill this in.',
      whenRange: 'Pick a time in the last 7 days.',
      tooLong: 'Keep it to {limit} characters.',
      tooMany: 'Up to {limit} photos.',
    },
    // A server refusal, on the field it names.
    refused: {
      kind: 'Pick what kind of incident it was.',
      when: 'Pick a time in the last 7 days.',
      place: 'Pick where it happened.',
      courtId: 'That court is not at this venue any more. Pick another.',
      placeDetail: 'That is too long.',
      description: 'Write what happened, in up to 2,000 characters.',
      people: 'That is too long.',
      photos: 'A photo did not upload properly. Remove it and add it again.',
    },
  },
  sheet: {
    happened: 'Happened',
    reportedBy: 'Reported by',
    whatHappened: 'What happened',
    people: 'Who was involved',
    photos: 'Photos ({count})',
    photoAlt: 'Photo {n}',
    photosGoing: 'The photos are deleted at the next cleanup.',
    review: 'Review',
    note: 'Review note',
    noteHint: 'The reporter sees this note.',
    noteRequired: 'Write a note for the reporter.',
    ownReport: 'You reported this. Another manager or the owner reviews it.',
    ownReportOwner: 'You reported this. A manager reviews it.',
    markReviewed: 'Mark reviewed',
    reviewed: 'Marked reviewed. {name} can read your note.',
    redact: 'Redact',
    redactBody:
      'Redacting deletes what happened, who was involved, where exactly and the review note, now. The photos are deleted at the next cleanup. The kind, the place and the times stay. This cannot be undone.',
    redactConfirm: 'Redact report',
    keep: 'Keep it',
    redacted: 'Report redacted.',
  },
  // Observe home and /ops.
  card: 'Accidents, injuries, fights and damage reported by staff: read them, look at the photos, and review each with a note.',
  waiting: {
    title: 'Incidents to review',
    hint: 'Someone reported an incident. The reporter waits for your note.',
    action: 'Review incidents',
  },
} as const;
