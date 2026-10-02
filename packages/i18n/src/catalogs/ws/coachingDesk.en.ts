
/**
 * `ws.coaching.*` desk groups (docs/design/coaching/operator.md §5.8–§5.11,
 * §5.17, §5.20): the lesson screen (`lesson`, `roster`, `attendance`, `add`,
 * `cancel`, `reschedule`, `move`, `refunds`) and the Ops panel
 * (`lessonRefunds`, which the assistant map routes to /ops), and the
 * calendar side (`calendar`, `today`, `create`, `start`). The shared words (kinds, statuses, money lines, the
 * banner, history sentences, refusal details, offline lines) are the
 * assembly's own `common` / `banner` / `events` / `errors` / `offline`.
 * Mirror every key in coachingDesk.ar.ts.
 */
export const coachingDeskEn = {
  // The desk calendar and the screens a lesson's court row reaches (§5.8, §5.9).
  calendar: {
    // The record's "Book a lesson" (`/desk?customer=<id>&kind=lesson`).
    bookingFor: 'Booking a lesson for {name}: pick a free time',
    // A lesson row opened where its lesson is not known (an older server, offline).
    heldForLesson: 'This court is held for a lesson. Lessons are changed from their own screen.',
  },
  // The Today board's "Lessons today" group (LessonsTodayPanel.tsx, §5.11).
  today: {
    title: 'Lessons today',
    none: 'No lessons today',
    off: 'Lessons are switched off here. Lessons already booked carry on.',
    // "18:00–19:00 · Court 2".
    when: '{time} · {court}',
    open: 'Open',
  },
  // The booking dialog's Lesson kind and the customer screens' attach mode (§5.3.2, §5.9).
  create: {
    attachLesson: 'Add to the lesson',
    attachingLesson: 'Choose the customer to add to this lesson.',
    creatingForLesson: 'Once created, the customer goes straight back to the lesson.',
  },
  // New lesson (StartLessonDialog.tsx, §5.9).
  start: {
    kind: 'Kind',
    noKinds: 'No lesson type is on sale at this branch yet.',
    type: 'Lesson type',
    // "Private 60 min · 30,000": the type's name, then the price (the coach's own once picked).
    typeOption: '{name} · {price}',
    // A type with no name of its own: "Private 60 min".
    typeName: '{kind} {minutes}',
    coach: 'Coach',
    coachPaused: '{name} · Paused: not taking lessons',
    noCoach: 'No coach teaches this lesson type here yet.',
    date: 'Date',
    start: 'Start',
    pickCoach: 'Pick a coach to see their free times.',
    pickTime: 'Pick a start time.',
    notFree: "{coach} isn't free at {time}. Pick one of these times.",
    noSlots: 'No free time for {coach} that day.',
    slotsFailed: "The coach's free times can't be read right now.",
    cutoffPassed: 'That start is too close: its cut-off ({time}) has already passed. Pick a later time.',
    inPast: 'That start has already passed.',
    firstSession: 'First session',
    // "Session 3 · Sun 19 Oct · 18:00".
    sessionRow: 'Session {n} · {date} · {time}',
    sessionDate: 'Session {n} date',
    sessionTime: 'Session {n} start',
    rowErrors: {
      grid: 'Lessons start on the hour or at half past.',
      past: 'This date has already passed.',
      order: 'Each session has to start after the one before ends.',
      missing: 'This session needs a date and a start.',
    },
    titleEn: 'Course title (English)',
    titleAr: 'Course title (Arabic)',
    titleHint: "Shown to guests instead of the lesson type's name.",
    student: 'Student',
    studentRequired: "Pick a customer or type the student's name.",
    comingWith: 'Coming with 0–{max}',
    price: {
      private: '{price} for the lesson, paid at the desk.',
      group: '{price} a place. Each student pays their own.',
      course: '{price} a person for {sessions}.',
    },
    court: {
      auto: 'The court is picked automatically from the free courts.',
      course: 'A court is taken for every session now.',
    },
    submit: 'Create lesson',
    booked: 'Lesson booked on {court}.',
    bookedElsewhere: "Booked on {court}: {pressed} wasn't free with the coach's hours. Move it from the lesson if needed.",
    created: 'Lesson created.',
    groupCreated: 'Group session created. Add students or share it in the app.',
    courseCreated: 'Course created: {sessions} booked.',
    // OP-11: a retry answered with an earlier lesson, or no answer at all.
    alreadyBooked: 'Already booked earlier at {time}.',
    maybeLanded: 'The last attempt may have gone through. Check the lessons before trying again.',
  },
  // The lesson screen (§5.10.1–§5.10.3, §5.10.11).
  lesson: {
    notFound: "That lesson isn't at this branch.",
    backToToday: 'Back to Today',
    title: '{name} · {coach}',
    seeOnCalendar: 'See on calendar',
    moveCourt: 'Move court',
    reschedule: 'Reschedule',
    cancelLesson: 'Cancel lesson',
    cancelCourse: 'Cancel the course',
    cancelled: 'Lesson cancelled.',
    courseCancelled: 'Course cancelled ({sessions}).',
    courseStrip: {
      title: 'Course sessions',
      chip: '{n} · {date} · {time}',
      signupCloses: 'Sign-up closes when the last session starts ({time}).',
    },
    history: {
      title: 'History',
      empty: 'Nothing recorded yet.',
    },
  },
  // The roster (§5.10.4); its money lines are `common.money`.
  roster: {
    title: 'Students',
    earlier: 'Earlier',
    empty: 'No one is signed up yet.',
    openCustomer: 'Open customer',
    friends: 'With {names}',
    addStudent: 'Add student',
    takeCard: 'Take payment by card',
    cancelSignUp: 'Cancel sign-up',
  },
  // Arrived / No-show / Undo (§5.10.6); the reasons are `errors.attendance`.
  attendance: {
    arrived: 'Arrived',
    noShow: 'No-show',
    undo: 'Undo',
  },
  // Add student (§5.10.7).
  add: {
    title: 'Add student',
    titleCourse: 'Add a student to the course',
    submit: 'Add student',
    name: 'Student name',
    phone: 'Phone',
    needsStudent: 'Pick a customer or type a name.',
    nameTooLong: 'A name can be at most {max} characters.',
    phoneInvalid: 'A phone number has {min} to {max} digits.',
    typedHint: 'A typed student stays as typed. A phone with an account is linked only after its owner confirms it in the app.',
    createCustomer: 'Create customer',
    findInDirectory: 'Find in the directory',
    joinsFrom: 'Joins from session {n}: pays for {sessions}.',
    added: '{name} is in.',
    // OP-11: a retry the server had already taken.
    alreadyAdded: '{name} was already added.',
    maybeLanded: 'The last attempt may have gone through. Check the list before trying again.',
    addedFull: '{name} is in. The session is full.',
    addedFullCourse: '{name} is in. The course is full.',
  },
  // Cancel a sign-up, a lesson or a course (§5.10.8): what happens to the money.
  cancel: {
    signUpAction: "Cancel {name}'s sign-up",
    deskPaid: '{amount} was paid at the desk. It becomes a refund a manager makes at the till.',
    online: "The online payment goes back to the guest's card.",
    courseSignUp: 'Money for the sessions not yet held goes back: online to the card, desk money as a refund due.',
    nothingPaid: 'Nothing was paid, so nothing is refunded.',
    // OP-15: a group sign-up cancelled after its session started.
    begunKept: 'The session has begun, so the money is kept.',
    privateBooker: 'This is the private lesson itself: cancelling it cancels the lesson.',
    lesson: 'Cancels the lesson for {students}, releases the court and tells everyone. Online money goes back; desk money becomes a refund due.',
    course: 'Cancels the sessions still to come for everyone signed up. Each payment gets back what the sessions not held are worth, in one refund.',
    signUpDone: 'Sign-up cancelled.',
    signUpDoneRefund: 'Sign-up cancelled. {amount} paid at the desk is now a refund due.',
  },
  // Reschedule (§5.10.9, R8, R32, R47).
  reschedule: {
    title: 'Reschedule',
    date: 'Date',
    start: 'Start',
    length: 'Ends {time}: the length stays {minutes} min.',
    body: 'Moves this lesson to the new time on any free court. Everyone in it is told, and guests who booked in the app may cancel free until the new start.',
    groupCutoff: 'The cut-off moves with it.',
    cutoffAt: 'New cut-off: {time}',
    cutoffPassed: 'That start is too close: its cut-off ({time}) has already passed. Pick a later time.',
    pickStart: 'Pick a start time.',
    sameStart: 'That is its time now. Pick another.',
    noStarts: 'No start is left on this date. Pick another date.',
    closedDate: 'The branch is closed on this date.',
    submit: 'Reschedule',
    done: 'Moved to {time} on {court}.',
  },
  // Move court (§5.10.9, R7).
  move: {
    title: 'Move court',
    body: 'Same time, another court. Students are told the new court.',
    court: 'Court',
    current: '{court} · now',
    taken: '{court} · taken',
    noneFree: 'No other court is free at this time.',
    pick: 'Pick a court.',
    submit: 'Move court',
    done: 'Moved to {court}.',
  },
  // Refunds due on the lesson screen (§5.10.10), the till's RefundDialog with
  // `dueIqd` (R36), and the record of money handed back outside Qi (R75).
  refunds: {
    title: 'Refunds due at the desk',
    row: '{label} · paid {amount} by {method} · {refunded} refunded · {due} due',
    method: {
      cash: 'cash',
      card: 'card',
    },
    student: 'Student',
    refund: 'Refund',
    goodwill: 'Goodwill: refund more than is due',
    capLead: 'Lesson money paid at the desk: at most what is due back ({amount}), unless it is a goodwill refund.',
    done: 'Refund recorded.',
    queued: 'Refund saved. It goes through once the station is back online.',
    courseLeave: 'Left the course: due for the sessions still to come',
    onlineBlocked: 'Online refund needs attention: {amount}',
    onlineRefunds: 'Online refunds',
    recordHandback: 'Record the handback',
    blocked: {
      title: 'Record money handed back',
      body: 'Qi takes one refund per payment, so this share was handed back to the student another way. This only records it: nothing leaves the drawer through this record.',
      amount: 'Amount handed back',
      amountHint: 'At most {amount}.',
      reference: 'Reference',
      referenceHint: 'A receipt or transfer number, up to {max} characters.',
      submit: 'Record',
      pinAction: 'record this handback',
      done: 'Handback recorded.',
      amountRequired: 'Enter an amount.',
      amountTooHigh: 'At most {amount} is owed back online on this sign-up.',
      referenceRequired: 'Enter a reference.',
      referenceTooLong: 'A reference is at most {max} characters.',
    },
  },
  // Ops: "Lesson refunds due" (§5.17). The group name routes the assistant map to /ops.
  lessonRefunds: {
    title: 'Lesson refunds due',
    lead: 'Desk money for lessons that were cancelled or left. Online money goes back by itself.',
    total: 'Total due',
    paid: 'Paid {amount} by {method}',
    refundedSoFar: 'Refunded so far {amount}',
    due: 'Due {amount}',
    empty: 'No lesson money is waiting to go back.',
  },
};
