import { coachingDeskEn } from './coachingDesk.en';
import { coachingAdminEn } from './coachingAdmin.en';
import { coachingMoneyEn } from './coachingMoney.en';

/**
 * `ws.coaching.*`: lessons, coaches and coach pay on the operator
 * (docs/design/coaching/operator.md §5.20). Mirror every key in coaching.ar.ts.
 *
 * This file is the assembly and owns `common`, `banner`, `events`, `count`,
 * `errors` and `offline` (features/coaching/lessonLogic.ts reads them). The
 * lanes' groups live in one file pair each and are spread in here, so
 * parallel lanes never edit the same file: coachingDesk.* (calendar, today,
 * create, start, lesson, roster, pay, attendance, add, cancel, reschedule,
 * move, refunds), coachingAdmin.* (coachesAdmin, lessonTypes, coachHours,
 * settings, customers), coachingMoney.* (coachPay, lessonRefunds, dayClose,
 * reports, panel). The group names are the second key segment the assistant
 * map's `LABEL_ROUTE_HINTS` routes on (packages/db/scripts/build-assistant-map.mjs);
 * no group is named `hours`, which would route to /admin/hours.
 *
 * `count.<noun>` is a counted phrase for `countPhrase` / `pluralForm`
 * (packages/i18n/src/plural.ts): all six forms, English repeating `one` /
 * `other`. A coach or student in the third person is masculine in v1 (no
 * gender is stored, §5.20).
 */
export const coachingEn = {
  ...coachingDeskEn,
  ...coachingAdminEn,
  ...coachingMoneyEn,
  // The words every lesson surface shares (lessonLogic.ts).
  common: {
    lesson: 'Lesson',
    lessons: 'Lessons',
    coach: 'Coach',
    // lessons.kind (C-1): the badge word.
    kind: {
      private: 'Private lesson',
      group: 'Group session',
      course: 'Course',
    },
    // The short kind word inside a line ("Private 60 min · 30,000").
    kindShort: {
      private: 'Private',
      group: 'Group',
      course: 'Course',
    },
    session: 'Session {n}',
    sessionOf: 'Session {n} of {total}',
    courseSession: 'Course · Session {n} of {total}',
    // lessons.status (§5.20 status labels).
    status: {
      held: 'Awaiting payment',
      scheduled: 'Booked',
      completed: 'Done',
      cancelled: 'Cancelled',
      expired: 'Not confirmed',
    },
    courseStatus: {
      open: 'Open',
      running: 'Running',
      completed: 'Finished',
      cancelled: 'Cancelled',
    },
    enrolmentStatus: {
      booked: 'Signed up',
      held: 'Awaiting payment',
      cancelled: 'Cancelled',
      expired: 'Not paid in time',
    },
    coachStatus: {
      active: 'Active',
      paused: 'Paused',
      retired: 'Retired',
    },
    statementStatus: {
      draft: 'Draft',
      approved: 'Approved',
      paid: 'Paid',
      void: 'Void',
    },
    // lesson_enrolments.payment_mode.
    paymentMode: {
      desk: 'At the desk',
      online: 'Online',
    },
    // venue_settings.lesson_payment_mode (CD-1).
    lessonPaymentMode: {
      desk: 'At the desk',
      online_optional: 'At the desk or online',
      online_required: 'Online only',
    },
    // Who booked a sign-up (§5.10.4).
    bookedBy: {
      guest: 'Booked in the app',
      coach: 'Added by the coach',
      staff: 'Added at the desk',
      staffBy: 'Added at the desk by {name}',
    },
    walkIn: 'Walk-in',
    // A lesson's name on a tile, a row or a title (lessonLabel): "Coach Sara · Ali Hasan".
    label: {
      pair: '{a} · {b}',
      courseSession: '{coach} · {title} · Session {n}',
    },
    places: 'Places {taken} of {total}',
    placesAria: '{kind} · {taken} of {total} places',
    partyAria: 'Private lesson · {extra} with the booker',
    pay: {
      toPay: 'To pay {count}',
      toPayAmount: 'To pay {count} · {amount}',
      // OP-13: a held lesson, or held places waiting on Qi.
      awaiting: 'Awaiting online payment',
      allPaid: 'All paid',
      paidOnline: 'Paid online',
      // C-24: a private lesson the coach booked that is still unpaid.
      coachBookedUnpaid: 'Booked by the coach · unpaid',
    },
    tags: {
      needsMore: 'Needs {count} more by {time}',
      awaitingOnline: 'Awaiting online payment',
      startsIn: 'Starts in {minutes} min',
    },
    lessonUntil: 'Lesson until {time}',
    inALesson: 'In a lesson',
    openLesson: 'Open lesson',
    newLesson: 'New lesson',
    // R51: the desk stages lessons while coaching is off at the branch.
    stagingOff: "Lessons are switched off at this branch: guests can't see or book this yet.",
    minutes: '{minutes} min',
    // One sign-up's money line (lessonLogic.enrolmentLine, §5.10.4). Every figure is the server's.
    money: {
      toPayAtDesk: 'To pay {amount} at the desk',
      paidAtDesk: 'Paid at the desk {amount}',
      paidOnline: 'Paid online {amount}',
      awaitingOnline: 'Awaiting online payment',
      refunded: 'Refunded {amount}',
      keptLate: 'Kept: late cancel',
      // C-23: a guest leaving a running course keeps the next session's share.
      keptCourseLeave: 'Kept: the next session was inside the cancellation window',
      refundDue: 'Refund due {amount}',
    },
    attendance: {
      attended: 'Arrived',
      no_show: 'No-show',
      markedBy: '{status} · {name}',
    },
    // Take payment (§5.10.5): the till's PaymentPane over app.lesson_settle,
    // shared by the lesson screen and the customer record (TakeLessonPayment.tsx).
    take: {
      button: 'Take payment',
      cash: 'Cash',
      card: 'Card',
      subtitleLesson: "{name}'s lesson",
      subtitleCourse: "{name}'s course",
      took: 'Took {amount} for {name}.',
      change: 'Change {change}',
    },
    courseSignUp: 'Course sign-up · sessions {from}–{to}',
    joinedAt: 'Joined at session {n}',
    // The desk and coach cancel codes (§1.3), as a history line names them.
    cancelCode: {
      customer_request: 'Customer request',
      coach_unavailable: 'Coach unavailable',
      court_needed: 'Court needed',
      staff_error: 'Staff error',
      duplicate: 'Duplicate',
      other: 'Other',
      guest_cancel: 'Cancelled by the guest',
      coach_cancel: 'Cancelled by the coach',
      staff_cancel: 'Cancelled at the desk',
      under_filled: 'Too few students',
      payment_expired: 'Payment time ran out',
      account_deleted: 'Account deleted',
      coach_retired: 'Coach retired',
    },
  },
  // The lesson screen's banner (lessonLogic.lessonBannerKey, §5.10.2).
  banner: {
    held: "Awaiting the guest's online payment until {time}. If it doesn't arrive, the lesson is cancelled.",
    underMin: 'Needs {students} more by {time}, or it is cancelled and everyone is refunded.',
    scheduled: 'Booked on {court}',
    completed: 'Done',
    cancelled: {
      guest_cancel: 'Cancelled by the guest.',
      coach_cancel: 'Cancelled by the coach. Everyone was told and online money refunded.',
      staff_cancel: 'Cancelled at the desk. Everyone was told and online money refunded.',
      under_filled: 'Cancelled at the cut-off: too few students. Everyone was refunded.',
      payment_expired: "The guest's online payment didn't arrive in time.",
      account_deleted: 'The guest deleted their account.',
      coach_retired: 'Cancelled because the coach was retired. Everyone was told and online money refunded.',
      other: 'Cancelled.',
    },
    expired: 'Never confirmed.',
    // Added when any sign-up has desk money waiting to go back (§5.10.2).
    refundDueDesk: 'Money paid at the desk is waiting for a refund: {amount}.',
    // OP-14 (DB-31): online money whose refund Qi refused; never "paid at the desk".
    refundBlocked: 'Online refund needs attention: {amount}.',
  },
  // One history sentence per lesson_events.type (lessonLogic.eventKey, §5.10.11);
  // "· {actor}" is appended, system events read `common` "automatic".
  events: {
    booked: 'Booked',
    held: 'Held for online payment',
    paid_online: 'Paid online',
    expired: 'Payment time ran out',
    joined: 'Joined',
    added: 'Student added',
    cancelled: 'Lesson cancelled ({code})',
    enrolment_cancelled: 'Sign-up cancelled ({code})',
    rescheduled: 'Moved to a new time',
    court_moved: 'Moved to another court',
    under_filled: 'Cancelled at the cut-off',
    // R26: judged after the start, so nothing was cancelled.
    under_filled_late: 'Cut-off checked too late: nothing was cancelled',
    completed: 'Done',
    attended: 'Marked arrived',
    no_show: 'Marked no-show',
    unmarked: 'Mark undone',
    settled: 'Paid at the desk',
    refunded: 'Refunded',
    automatic: 'automatic',
  },
  // Counted phrases (countPhrase / pluralForm, §5.20). `lessons` and
  // `sessions` share their Arabic forms and keep separate keys.
  count: {
    lessons: {
      zero: 'no lessons',
      one: 'one lesson',
      two: 'two lessons',
      few: '{count} lessons',
      many: '{count} lessons',
      other: '{count} lessons',
    },
    students: {
      zero: 'no students',
      one: 'one student',
      two: 'two students',
      few: '{count} students',
      many: '{count} students',
      other: '{count} students',
    },
    places: {
      zero: 'no places',
      one: 'one place',
      two: 'two places',
      few: '{count} places',
      many: '{count} places',
      other: '{count} places',
    },
    sessions: {
      zero: 'no sessions',
      one: 'one session',
      two: 'two sessions',
      few: '{count} sessions',
      many: '{count} sessions',
      other: '{count} sessions',
    },
    coaches: {
      zero: 'no coaches',
      one: 'one coach',
      two: 'two coaches',
      few: '{count} coaches',
      many: '{count} coaches',
      other: '{count} coaches',
    },
  },
  // A refusal's detail line (lessonLogic.coachingErrorKey, §5.19 "Details",
  // R52). The base line of each code is `op.errors.<CODE>` (the database lane's
  // opErrors.coaching.* pair); these are the operator's own sentences for a
  // detail the server sends.
  errors: {
    // A course create refused for one session: "Session 3: {the base line}".
    sessionPrefix: 'Session {n}: {line}',
    courseStarts: {
      count: 'One date is needed for each of the {sessions}.',
      order: 'Each session has to start after the one before ends.',
      span: "A course can't run longer than a year.",
    },
    cutoffPassed: 'That start is too close: its cut-off has already passed. Pick a later time.',
    notCancellable: {
      status: 'This lesson is already cancelled or over.',
      started: 'This lesson has started.',
      ended: "The lesson, or the course's last session, has ended.",
      course_session: "A course session can't be cancelled alone. Move it, or cancel the course.",
      private: 'Cancel the private lesson itself instead.',
    },
    notMovable: {
      ended: 'This lesson is cancelled or over.',
      started: 'This lesson has started.',
      order: 'A course session has to stay between the sessions before and after it.',
    },
    heldWaiting: "Waiting for the guest's online payment: it can be moved once paid.",
    courtEnded: "This lesson is over or cancelled, so its court can't change.",
    attendance: {
      not_started: 'A no-show can be marked once the lesson starts',
      marks_closed: 'Too late to change: marks close 24 hours after the start.',
      not_booked: "This student's sign-up isn't active.",
      cancelled: 'This lesson was cancelled.',
    },
    voidPaid: "A paid statement can't be voided.",
    notPayable: {
      held: 'The guest is paying online.',
      expired: 'This sign-up expired.',
      cancelled: 'This sign-up is cancelled.',
      lesson_cancelled: 'Every session of this sign-up was cancelled.',
      no_show: 'This student was marked no-show.',
      nothing_owed: 'Nothing left to take for this student.',
    },
    hoursInvalid: '{day}: each window has to start before it ends, on the half hour, by 24:00.',
    hoursOverlap: "{day}: these hours overlap the coach's hours here or at another branch.",
    hoursOverlapTimeOff: 'This overlaps time off already set.',
    timeOffHasLessons: '{name} has {lessons} in that time. Cancel or move them first.',
    lessonPriceViaProtocol: "Lesson prices change through the owner's approval.",
    lessonShapeViaProtocol: 'Make a new lesson type to change its length, sessions or party size.',
    priceTargetChanged: {
      lesson_type: 'This lesson type changed after the proposal (price, length, sessions or party size). Start a new proposal.',
      coach_price: "This coach's price or lessons changed after the proposal. Start a new proposal.",
    },
    onlineOff: {
      provider: "Online payment isn't set up for this branch.",
      terms: 'Online lesson payment can be switched on once the terms and privacy text with a lessons section are live.',
    },
    branchHasLessons: 'This coach has lessons at {branch}. Cancel them first.',
    coachingMoney: 'This branch still has coach statements to approve or pay, a month or a pay adjustment not drafted yet, or lesson money still to refund or being refunded. Settle them in Coach pay and Ops first.',
    ownStatement: 'This is your own statement. Another manager or the owner approves and pays it.',
    ownStatementPin: "That PIN belongs to this statement's coach. Another manager or the owner enters theirs.",
    liveDraft: 'This coach already has a draft for that month. Open it instead.',
    negativeStatement: 'This statement is below zero ({amount}). Void it; the next statement carries it.',
    cardNumber: "A card or account number can't go here. Use a receipt or transfer number.",
    lessonLive: "This lesson is still on. Cancel the sign-up from the lesson's screen; its refund follows.",
    viaCoaching: {
      cancel: 'Cancel a lesson from its own screen.',
      mark: "Mark each student on the lesson's screen.",
      extend: "A lesson's length can't change here. Reschedule it from its screen.",
      move: "Move a lesson's court from its own screen.",
      create: 'Lessons are booked with New lesson.',
      tab: 'A lesson is paid on its own screen, not on a court bill.',
      held: "This hold is a lesson waiting for the guest's online payment.",
    },
    coachEnrolled: 'That customer is the coach of this lesson.',
    owedChanged: 'What this student owes changed to {amount}. Check before taking it.',
  },
  // §5.5: every coaching read and write needs a connection (CD-6).
  offline: {
    needsConnection: 'Needs a connection: lessons work online only',
    readFailed: "Lessons can't be shown without a connection",
    lastUpdated: 'Last updated {time}',
    serverMissing: "Coaching needs a server update that isn't there yet.",
  },
};
