/**
 * `coaching.guest`: the guest's lesson screens on the phone (docs/design/
 * coaching/guest.md §4.8–§4.9, §4.15): the entry rows, the coaches list, a
 * coach's page and grid, the classes, a class, the review, a lesson, My
 * lessons, the cancel dialog, the link confirm (C-21), the Qi payment's lines
 * and the welcome banner. Spread into coaching.en.ts; mirror every key in
 * coaching.guest.ar.ts.
 *
 * No line names a price the phone computed: every figure is the server's
 * (`price_iqd`, `late_join`, `cancel.*`), passed in already formatted.
 */
export const coachingGuestEn = {
  guest: {
    entry: {
      // The Book tab's row (book.sheet.lessons): static, no count (GL-1).
      book: 'Lessons with a coach',
    },
    coaches: {
      title: 'Coaches',
      classes: 'Group sessions and courses',
      emptyTitle: 'No coaches yet',
      empty: 'No coaches are taking bookings at this branch yet.',
      error: "The coaches couldn't be loaded.",
    },
    coach: {
      title: 'Coach',
      more: 'More',
      less: 'Less',
      offers: 'Lessons',
      // The free-times section's title (Figma "D · Profile").
      grid: 'Free times',
      lessonType: 'Lesson',
      noTimes: 'No free times in the next two weeks. Call {branch} to ask.',
      noTimesNoPhone: 'No free times in the next two weeks.',
      paused: 'Not taking new bookings right now.',
      // The name card's badge while the grid is open (Figma "D · Profile").
      taking: 'Taking bookings',
      // Under the day cards: three more nights.
      moreDays: 'See more days',
      // The book bar's button once a time is picked.
      bookLesson: 'Book lesson',
      self: 'This is your coach profile. Guests book you here.',
      notFound: "This coach isn't available.",
      seeAll: 'See all coaches',
      sessions: 'Group sessions and courses',
      questions: 'Questions? Call {branch}',
      share: 'Share',
      shareMessage: 'Lessons with {name} at Touch Padel: {url}',
      error: "This coach couldn't be loaded.",
    },
    classes: {
      title: 'Group sessions and courses',
      filterAll: 'All',
      filterGroup: 'Group',
      filterCourse: 'Courses',
      emptyTitle: 'Nothing open right now',
      empty: 'No group sessions or courses with places right now.',
      starts: 'Starts {date}',
      next: 'Next {date} · {n} of {total}',
      error: "The sessions couldn't be loaded.",
    },
    class: {
      title: 'Lesson',
      sessions: 'Sessions',
      // C-14, before the cut-off while below the minimum.
      runsIf:
        "Runs if at least {people} sign up by {time}. If not, it's cancelled and anything paid online is refunded.",
      // C-15: the server's figures, never computed on the phone.
      lateJoin:
        'Joining late: {sessionsLeft} of {sessions}. You pay {price} for the sessions not yet started (the course price, {full}, split over its sessions).',
      join: 'Join',
      joinAndPay: 'Join and pay with Qi Card',
      full: 'Full',
      closed: 'Sign-up has closed',
      cancelled: 'Cancelled',
      mine: "You're booked on this",
      seeBooking: 'See your booking',
      // MB-14: a coach- or desk-added place from the guest's phone, not confirmed yet (C-21).
      mineConfirm: "A place on this was added with your phone number. Confirm it's you to keep it.",
      cancelGroup: 'Free to cancel until {hours} before. After that, online payment is kept.',
      cancelCourse:
        "Free to leave until {hours} before your next session. Leaving later keeps that session's share; the sessions after it are refunded.",
      notFound: "This lesson isn't available.",
      error: "This lesson couldn't be loaded.",
    },
    review: {
      title: 'Review',
      party: 'People',
      justMe: 'Just me',
      mePlus: 'Me + {count}',
      friends: "Friends' names (optional). They help the coach plan.",
      friend: 'Friend {n}',
      payment: 'Payment',
      payDesk: 'Pay at the desk',
      payOnline: 'Pay now with Qi Card',
      deskLine: 'Paid at the desk on the day.',
      onlineLine: 'Paid now by Qi Card.',
      book: 'Book the lesson',
      bookAndPay: 'Book and pay with Qi Card',
      booked: 'Booked. Pay at the desk on the day.',
      payDeskInstead: 'Pay at the desk instead',
    },
    lesson: {
      title: 'Lesson',
      court: 'Court',
      payBy: 'Finish payment by {time}',
      party: 'People',
      friends: 'With {names}',
      sessions: 'Sessions',
      moved: 'This lesson was moved after you booked. You can cancel free until it starts.',
      money: 'Payment',
      paidOnline: 'Paid online {paid}',
      toPay: 'To pay at the desk {owed}',
      refundOnWay: '{amount} on its way back to your card',
      refunded: 'Refunded {amount}',
      pay: 'Finish payment',
      cancel: 'Cancel the lesson',
      leave: 'Leave the course',
      notFound: "This booking isn't available.",
      error: "This lesson couldn't be loaded.",
    },
    cancel: {
      // §4.9.4: a private lesson or a group session, from `my_lesson.cancel`.
      free: "Cancel this lesson? It's free to cancel until {time}. {refund}",
      // MB-11: a held place (nothing paid yet), and a free cancel with no deadline sent.
      freeHeld: "Cancel this lesson? Nothing has been paid yet, so it's free to cancel.",
      freeNoTime: "Cancel this lesson? It's free to cancel. {refund}",
      freeMoved:
        "Cancel this lesson? It was moved after you booked, so it's free to cancel until it starts. {refund}",
      lateCounts:
        "It's less than {hours} before the lesson. If you cancel now, {kept} paid online is kept, and it counts as a late cancellation.",
      late: "It's less than {hours} before the lesson. If you cancel now, {kept} paid online is kept.",
      lateNothingPaidCounts:
        "It's less than {hours} before the lesson. If you cancel now, it counts as a late cancellation.",
      lateNothingPaid: "It's less than {hours} before the lesson.",
      // A course (C-23, R62).
      courseFree:
        "Leave the course? Your place on every session you haven't had is cancelled. {refund}",
      // MB-15: built from parts, each only when it has something to say.
      courseLate: 'Leave the course? Your next session, {when}, is less than {hours} away.',
      courseLateKept: 'Its share ({kept}) is kept{late}.',
      courseLateCounts: 'Leaving now counts as a late cancellation.',
      courseLateRest: 'The {refundSessions} after it are cancelled.',
      refund: '{amount} paid online goes back to your card.',
      lateClause: ', and it counts as a late cancellation',
      keep: 'Keep it',
      done: 'Cancelled.',
      doneRefund: 'Cancelled. {amount} is on its way back to your card.',
    },
    mine: {
      title: 'My lessons',
      upcoming: 'Upcoming',
      past: 'Past',
      cancelled: 'Cancelled',
      emptyTitle: 'No lessons yet.',
      emptyUpcoming: 'Book a lesson with a coach and it shows here.',
      emptyPast: 'Lessons you had show here.',
      emptyCancelled: 'Cancelled lessons show here.',
      find: 'Find a coach',
      error: "Your lessons couldn't be loaded.",
    },
    bookings: {
      section: 'Lessons',
      all: 'All my lessons',
      finish: 'Finish payment',
      confirm: "Confirm it's you",
    },
    confirm: {
      // C-21, R44: never the name the coach typed, and no money.
      byCoach: 'A coach added you to a lesson. Is this you?',
      byStaff: 'The front desk added you to a lesson. Is this you?',
      yes: "Yes, it's me",
      no: 'Not me',
      removeTitle: 'Not your lesson?',
      removeBody: 'Remove this lesson from your account? Nobody is told.',
      remove: 'Remove',
      added: 'Added to your lessons.',
      removed: 'Removed.',
    },
    pay: {
      lessonBooked: "You're booked",
      lessonBookedBody: 'Paid online by Qi Card.',
      viewLesson: 'View the lesson',
      summary: '{type} · {coach}',
      expiredBody: 'Payment window ended. No money was taken, and your place was released.',
      refundPending:
        "The payment came after your place was released, so it's on its way back to your card.",
      leaveBody:
        "If you already paid, your place is still confirmed. You'll find it under My lessons.",
    },
    welcome: {
      banner: 'Sign in to book the lesson',
    },
  },
} as const;
