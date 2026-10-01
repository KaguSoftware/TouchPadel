/**
 * `coaching.common`: the words every coaching screen shares on the phone, the
 * guest's and coach mode's (docs/design/coaching/guest.md §4.15): the kinds,
 * the guest states (§4.8.9), the money lines, the counted phrases and the
 * phone's line for every coaching code and detail a guest or a coach can meet
 * (§4.10, R52). Spread into coaching.en.ts; mirror every key in
 * coaching.common.ar.ts.
 *
 * `count.<key>` is a counted phrase for `countPhrase` (packages/i18n/src/
 * plural.ts): all six forms. English reads `one`, `other` and, at 0, `zero`;
 * each form carries the placeholders its Arabic twin carries, so `one` and
 * `two` spell their number ("1 place left", "2 places left"). A `zero` the
 * caller never shows (the table's "—") still carries words for parity.
 *
 * `errors.*` are read by `lessonErrorText` (apps/mobile/src/features/coaching/
 * errors.ts) before the catalogue, for the codes of build contracts §1.10.
 */
export const coachingCommonEn = {
  common: {
    lesson: 'Lesson',
    coach: 'Coach',
    kinds: {
      private: 'Private',
      group: 'Group',
      course: 'Course',
    },
    kindsLong: {
      private: 'Private lesson',
      group: 'Group session',
      course: 'Course',
    },
    // "Private · Group · Courses": the kinds a coach teaches, on a coach card.
    kindsTaught: {
      private: 'Private',
      group: 'Group',
      course: 'Courses',
    },
    price: 'Price',
    duration: 'Duration',
    durationMin: '{minutes} min',
    branch: 'Branch',
    atBranch: 'At {branch}',
    callBranch: 'Call {branch}',
    callVenue: 'Call the venue',
    // C-1: one price for the whole lesson, whatever the party.
    forTheLesson: '{price} for the lesson',
    from: 'From {price}',
    upTo: 'Up to {people}',
    // "Session 3 of 8": Latin digits, LTR-isolated by the caller.
    sessionOf: 'Session {n} of {total}',
    sessionDone: 'Done',
    sessionMoved: 'Moved',
    attended: 'Attended',
    noShow: 'Not attended',
    states: {
      confirmNeeded: "Added by a coach · confirm it's you",
      awaitingPayment: 'Payment in progress · finish by {time}',
      paymentLapsing: 'Payment window ended',
      needsMore: 'Booked · runs if {people} sign up by {time}',
      courseRunning: 'Course · next: session {n} of {total}',
      moved: 'Booked · moved to {time}',
      booked: 'Booked',
      attended: 'Attended',
      noShow: 'Marked as not attended',
      done: 'Done',
      now: 'On now',
      leftCourse: 'You left the course',
      cancelledFree: 'You cancelled · free',
      cancelledLate: 'You cancelled late',
      cancelledByCoach: 'Cancelled by the coach',
      cancelledByVenue: 'Cancelled by the venue',
      underFilled: 'Cancelled · not enough people signed up',
      courseCancelled: 'The course was cancelled · remaining sessions refunded',
      paymentExpired: 'Payment not completed · place released',
      unknown: 'Lesson',
    },
    money: {
      payAtDesk: 'Pay {owed} at the desk',
      paidOnline: 'Paid online',
      refunded: '{amount} refunded to your card',
      kept: '{kept} kept',
    },
    count: {
      placesLeft: {
        zero: 'No places left',
        one: '1 place left',
        two: '2 places left',
        few: '{count} places left',
        many: '{count} places left',
        other: '{count} places left',
      },
      places: {
        zero: 'No places',
        one: '1 place',
        two: '2 places',
        few: '{count} places',
        many: '{count} places',
        other: '{count} places',
      },
      people: {
        zero: 'No one',
        one: '1 person',
        two: '2 people',
        few: '{count} people',
        many: '{count} people',
        other: '{count} people',
      },
      sessions: {
        zero: 'No sessions',
        one: '1 session',
        two: '2 sessions',
        few: '{count} sessions',
        many: '{count} sessions',
        other: '{count} sessions',
      },
      sessionsLeft: {
        zero: 'No sessions left',
        one: '1 session left',
        two: '2 sessions left',
        few: '{count} sessions left',
        many: '{count} sessions left',
        other: '{count} sessions left',
      },
      students: {
        zero: 'No students',
        one: '1 student',
        two: '2 students',
        few: '{count} students',
        many: '{count} students',
        other: '{count} students',
      },
      hours: {
        zero: 'No hours',
        one: '1 hour',
        two: '2 hours',
        few: '{count} hours',
        many: '{count} hours',
        other: '{count} hours',
      },
      lessons: {
        zero: 'No lessons',
        one: '1 lesson',
        two: '2 lessons',
        few: '{count} lessons',
        many: '{count} lessons',
        other: '{count} lessons',
      },
      withPlaces: {
        zero: 'None with places',
        one: '1 with places',
        two: '2 with places',
        few: '{count} with places',
        many: '{count} with places',
        other: '{count} with places',
      },
      addsLeft: {
        zero: 'None more today',
        one: '1 more today',
        two: '2 more today',
        few: '{count} more today',
        many: '{count} more today',
        other: '{count} more today',
      },
      // A lesson's length (the website's lesson cards; one form reads for every count).
      minutes: {
        zero: '{count} min',
        one: '{count} min',
        two: '{count} min',
        few: '{count} min',
        many: '{count} min',
        other: '{count} min',
      },
    },
    errors: {
      off: "Lessons aren't bookable in the app at this branch right now.",
      coachNotFound: "This coach isn't available.",
      coachInactive: "This coach isn't taking new bookings right now.",
      coachNotAtBranch: "This coach doesn't teach at this branch.",
      typeNotFound: "This lesson isn't offered any more.",
      typeInactive: "This lesson isn't offered right now.",
      typeNotOffered: "This coach doesn't teach this lesson.",
      coachUnavailable: "The coach isn't available at that time. Pick another time.",
      coachBusy: 'The coach already has a lesson then. Pick another time.',
      noCourt: 'No court is free at that time. Pick another time.',
      notOnGrid: 'Lessons start on the hour or at half past.',
      partyTooLarge: "That's more people than this lesson takes.",
      full: 'This is full.',
      closed: 'Sign-up has closed.',
      alreadyEnrolled: "You're already booked on this.",
      notFound: "This lesson isn't available.",
      enrolmentNotFound: "We couldn't find this booking. Please refresh.",
      notCancellable: "This can't be cancelled in the app any more. Please call the front desk.",
      notPayable: "This booking can't be paid online any more.",
      onlineRequired: 'Lessons at this branch are paid online by Qi Card.',
      onlineOff: 'Online payment is off at this branch. You can pay at the desk.',
      notCoach: "Coach mode isn't available for this account.",
      hoursInvalid: 'Check the times: each one must end after it starts, and by midnight.',
      hoursOverlap: 'These hours overlap hours you already have, here or at another branch.',
      timeOffHasLessons: 'You have lessons booked in that time. Cancel or move them first.',
      courseStartsInvalid:
        'Check the session times: one for each session, in order, and in the future.',
      sessionNotMovable: "This lesson has started or ended, so it can't be moved.",
      addLimit: "You've added as many students as you can today. The front desk can add more.",
      // The details (R52, X31): a sentence of their own for each.
      alreadyEnrolledCoach: "You're the coach of this lesson, so you can't book a place in it.",
      addLimitLive:
        'You already have {cap} upcoming lessons booked for students, the most you can hold. The front desk can book more.',
      closedCutoff:
        "That's inside the sign-up cut-off, so guests couldn't join in time. Pick a later time.",
      notCancellablePrivate: 'This is a private lesson: cancel the lesson instead.',
      notCancellableSession:
        "A course session can't be cancelled on its own. Move it, or cancel the course.",
      notMovableOrder:
        'Sessions keep their order: this time is before the previous session or after the next one.',
      heldNotMovable:
        "This lesson is waiting for an online payment. Try again once it's paid or released.",
      markNotStarted: 'Attendance can be marked once the lesson starts.',
      marksClosed: "Attendance can't be changed more than 24 hours after the start.",
      markNotBooked: "This booking isn't confirmed yet.",
      markCancelled: 'This lesson was cancelled.',
      startsCount: 'Add one time for each session.',
      startsOrder: 'Put the sessions in order, each ending before the next one starts.',
      startsSpan: 'A course can run for a year at most.',
      // A per-start refusal of a new course: {n} is the session (1-based), {line} the code's own line.
      sessionPrefix: 'Session {n}: {line}',
      timeOffOverlap: 'This overlaps time off you already have.',
      timeOffHasLessonsCount: 'You have {lessons} booked in that time. Cancel or move them first.',
      partyTooLargeMax: 'This lesson takes up to {people}.',
      priceChangedTo: 'The price is now {price}. Check it and try again.',
      notPayableBooked: 'This booking is already confirmed.',
      notPayableDesk: 'This booking is paid at the desk.',
      notPayableFree: "There's nothing to pay online for this booking.",
      // The screen overrides (§4.10): the lessons terms (C-26, §4.9.6).
      termsRequired: 'Accept the updated terms to pay for lessons online.',
      updateApp: 'Update the app to pay for lessons online.',
    },
  },
} as const;
