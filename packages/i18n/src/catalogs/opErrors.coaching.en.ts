/**
 * `op.errors.<CODE>` for coaching (docs/design/coaching/operator.md §5.19,
 * build contracts §1.10), spread at the end of `op.errors` in en.ts. Mirror
 * every key in opErrors.coaching.ar.ts.
 *
 * Each code lands with the migration that first raises it (check-error-codes
 * fails otherwise), in ERROR_CODE_KEYS (packages/i18n/src/errors.ts), which
 * the operator, the phone and the web all resolve through; the wording fits
 * staff and guests alike, and a screen with words of its own passes an
 * override. coaching_settings raises ONLINE_PAYMENT_OFF (set_coaching_settings, detail
 * `terms`: R50, R67); coaching_tables raises STATEMENT_NOT_DRAFT (the frozen statement
 * lines, R22); lesson_reservation_guards LESSON_VIA_COACHING; lesson_money
 * ENROLMENT_NOT_FOUND, LESSON_NOT_PAYABLE, LESSON_OWED_CHANGED, LESSON_TAB_NO_GOODS,
 * REFUND_EXCEEDS_DUE; coaching_admin NOT_A_COACH, ALREADY_COACH, COACH_NOT_FOUND,
 * COACH_NOT_AT_BRANCH, LESSON_TYPE_NOT_FOUND, LESSON_TYPE_NOT_OFFERED, HOURS_INVALID,
 * HOURS_OVERLAP, TIME_OFF_HAS_LESSONS; lesson_booking the booking codes; coach_statements
 * STATEMENT_NOT_APPROVED, STATEMENT_REFERENCE_REQUIRED. The detail sentences are the lane
 * catalogs' (ws.coaching.*, coaching.*), added with their screens (R52).
 */
export const opErrorsCoachingEn = {
  ONLINE_PAYMENT_OFF: "Online payment isn't available for lessons here.",
  STATEMENT_NOT_DRAFT: "This statement isn't a draft any more.",
  LESSON_VIA_COACHING: "This court is held for a lesson. Change it from the lesson's own screen.",
  ENROLMENT_NOT_FOUND: 'That sign-up changed. The list has been refreshed.',
  LESSON_NOT_PAYABLE: 'Nothing can be taken for this sign-up now.',
  LESSON_OWED_CHANGED: "What's owed for this lesson just changed. Check the new amount.",
  LESSON_TAB_NO_GOODS: "Café items don't go on a lesson's bill. Open a separate café bill.",
  REFUND_EXCEEDS_DUE:
    "That's more than is due back for this lesson. Refresh the list, or choose a goodwill refund to give more.",
  NOT_A_COACH: "This account isn't a coach.",
  ALREADY_COACH: 'This customer is already a coach.',
  COACH_NOT_FOUND: "That coach can't be found.",
  COACH_NOT_AT_BRANCH: "This coach doesn't teach at this branch.",
  LESSON_TYPE_NOT_FOUND: "That lesson type can't be found.",
  LESSON_TYPE_NOT_OFFERED: "This coach doesn't teach this lesson type.",
  HOURS_INVALID: 'Each window has to start before it ends, within one day.',
  HOURS_OVERLAP: 'These hours overlap other hours of this coach.',
  TIME_OFF_HAS_LESSONS: 'The coach has lessons in that time. Cancel or move them first.',
  COACHING_OFF: 'Lessons are switched off at this branch.',
  COACH_INACTIVE: 'This coach is paused or retired, so no new lessons can be booked with them.',
  LESSON_TYPE_INACTIVE: "This lesson type isn't on sale.",
  COACH_UNAVAILABLE: "The coach isn't working at that time.",
  COACH_BUSY: 'The coach already has a lesson at that time.',
  NO_COURT_FREE: 'No court is free at that time.',
  SLOT_NOT_ON_GRID: 'Lessons start on the hour or at half past.',
  PARTY_TOO_LARGE: "That's more people than this lesson takes.",
  LESSON_FULL: 'No place is left in this lesson.',
  LESSON_CLOSED: "This lesson isn't taking sign-ups any more.",
  ALREADY_ENROLLED: 'This person is already signed up.',
  LESSON_NOT_FOUND: "That lesson isn't at this branch any more.",
  LESSON_NOT_CANCELLABLE: "This lesson can't be cancelled any more.",
  ONLINE_PAYMENT_REQUIRED: 'This branch takes lesson payments online only.',
  COURSE_STARTS_INVALID:
    "The course dates don't fit: one per session, each after the one before, all within a year.",
  SESSION_NOT_MOVABLE: "This session can't be moved any more.",
  COACH_ADD_LIMIT: 'This coach has reached the limit on students they can add.',
  STATEMENT_NOT_APPROVED: 'The statement has to be approved before it is marked paid.',
  STATEMENT_REFERENCE_REQUIRED: 'Enter the payment reference.',
};
