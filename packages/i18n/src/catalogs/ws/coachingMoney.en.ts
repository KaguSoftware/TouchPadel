/**
 * `ws.coaching.*` money groups (docs/design/coaching/operator.md §5.16–§5.18,
 * §5.20): `coachPay` (/reports/coaches), `dayClose`, `reports`, `panel`,
 * `deposits` (Ops online refunds). `lessonRefunds` (Ops, the desk money due
 * back) lives with the lesson screen's lane. Mirror every key in
 * coachingMoney.ar.ts.
 */
export const coachingMoneyEn = {
  // Coach pay (§5.16): monthly statements per coach per branch.
  coachPay: {
    title: 'Coach pay',
    lead: "Each coach's monthly statement: what was collected for their lessons, less the court share, and their share of the rest. The money is handed over outside the till.",
    month: {
      // OP-02: back to the default view, the latest month statements are drafted for.
      thisMonth: 'Latest month',
    },
    // The totals band (the server's `totals`).
    totals: {
      label: 'The month in figures',
      collected: 'Collected',
      courtShare: 'Court share',
      coachShare: "Coach's share",
      adjustments: 'Adjustments',
      toPay: 'To pay',
      approvedUnpaid: 'Approved, not paid',
      paid: 'Paid',
    },
    table: 'Statements',
    columns: {
      coach: 'Coach',
      branch: 'Branch',
      lessons: 'Lessons',
      collected: 'Collected',
      courtShare: 'Court share',
      coachShare: "Coach's share",
      adjustments: 'Adjustments',
      toPay: 'To pay',
      status: 'Status',
    },
    // R21: under "All branches" another branch's statement is read here only.
    otherBranches: 'Other branches',
    switchBranch: 'Switch to {branch} to approve or pay.',
    missing: {
      title: 'Not drafted',
      not_drafted: '{coach}: not drafted yet',
      older_draft: "{coach}: waits for an older month's draft",
      // 0293 (DB-24, OP-22): a later month's draft stands in the way.
      newer_draft: '{coach}: waits for the {month} draft',
    },
    // 0321: who is getting what in the month so far, before any statement is drafted.
    live: {
      title: 'Coaches · {month} so far',
      lead: 'What each coach has earned from lessons already taught this month. The statement is drafted on the 1st and can differ once adjustments are added.',
      empty: 'No lessons taught yet this month.',
      figures: {
        coachShare: 'Coaches earn',
        courtShare: 'Court keeps',
        lessons: 'Lessons taught',
        average: 'Average per lesson',
      },
      lastMonth: 'Last month: {amount}',
      coachCount: 'Coaches: {count}',
      top: 'Most: {coach}, {percent}% of coach pay',
      table: 'Coaches this month',
      columns: {
        earned: 'Earns so far',
        share: 'Share',
        statement: 'Statement',
      },
      notDrafted: 'Not drafted yet',
    },
    emptyCurrent: 'Statements are drafted on the 1st for the month before.',
    emptyMonth: 'No statements for {month}.',
    // The statement dialog.
    dialog: {
      title: '{coach} · {month}',
      lines: 'Lessons on this statement',
      noLines: 'No lessons on this statement.',
      columns: {
        date: 'Date',
        lesson: 'Lesson',
        signUps: 'Sign-ups',
        attended: 'Attended',
        noShows: 'No-shows',
        collected: 'Collected',
        courtShare: 'Court share',
        share: 'Share',
        coachAmount: 'To the coach',
      },
      adjustment: 'Adjustment',
      adjustmentHint: 'This lesson was on an approved statement; its money changed since.',
      stale: 'Lessons changed since this draft was counted. Recount to include them.',
      // C-24, R56, R72: a coach-booked lesson the student didn't come to.
      noShowsTitle: "Booked by the coach, the student didn't come",
      noShowRow: '{date} · {name}',
      approvedLine: 'Approved {date} by {name}',
      paidLine: 'Paid {date} by {name} · Ref {reference}',
      voidLine: 'Voided {date}: {reason}',
      notFound: "This statement can't be shown. It may have been redrafted.",
    },
    actions: {
      recount: 'Recount',
      recountHint: 'Recounts from the lessons collected so far.',
      approve: 'Approve',
      approveTitle: "Approve {coach}'s statement for {month}?",
      approveBody: "It can't change after this, except by voiding it.",
      void: 'Void',
      markPaid: 'Mark paid',
      redraft: 'Redraft',
      redraftHint: 'Drafts this month again from its lessons.',
      done: {
        recount: 'Recounted.',
        approve: 'Statement approved.',
        markPaid: 'Marked paid.',
        void: 'Statement voided.',
        redraft: 'Drafted again.',
      },
      // OP-22 (DB-25): a redraft that drafted nothing.
      redraftSettled: "Nothing to draft: this month's lessons were settled on a later statement.",
    },
    markPaid: {
      title: 'Mark paid',
      amountLine: '{amount} to {coach}',
      body: 'Records that the money was handed over. Nothing is taken from the drawer.',
      reference: 'Payment reference',
      referenceHint: 'Receipt or transfer number, or a note on how it was paid. Never a card or account number.',
      next: 'Continue',
      // Inside "Enter a manager PIN to {action}."
      pinAction: 'mark {amount} paid to {coach}',
    },
    void: {
      title: 'Void statement',
      reason: 'Reason',
      body: 'A voided statement is redrafted from the lessons next time statements are drafted.',
      approvedBody: 'Cash may already have been handed over for an approved statement. Voiding it needs a manager PIN, and the next statement counts these lessons again.',
      confirm: 'Void statement',
      // Inside "Enter a manager PIN to {action}."
      pinAction: "void {coach}'s approved statement",
    },
    // A field's own line, before anything is sent (R49, R74 mirrored).
    fieldErrors: {
      referenceRequired: 'Enter the payment reference.',
      reasonRequired: 'Enter a reason.',
      tooLong: 'At most {max} characters.',
    },
  },
  // Day close's "Money outside the drawer" (§5.18.1): the lessons group.
  dayClose: {
    title: 'Lessons today',
    rows: {
      onlineReceived: 'Paid online',
      onlineRefunded: 'Refunded online',
      onlineWaiting: 'Online refunds waiting',
      kept: 'Kept for late cancels and no-shows',
      deskPaid: 'Paid at the desk (in the drawer)',
      deskRefunded: 'Refunded at the desk today, whatever day it was paid (out of the drawer)',
      owed: 'Lessons held and not paid',
      refundsDueDesk: 'Refunds due at the desk',
      owedToCoaches: "Owed to coaches for today's lessons (paid outside the till)",
    },
  },
  // The Courts report's Lessons view (§5.18.2): report_courts' block and report_lessons.
  reports: {
    band: {
      lessons: 'Lessons',
      courtHours: 'Court hours',
      collected: 'Collected',
      courtShare: 'Court share',
      owedToCoaches: 'Owed to coaches',
    },
    counts: {
      title: 'How the lessons went',
      lessons: 'Lessons',
      private: 'Private lessons',
      group: 'Group sessions',
      courseSessions: 'Course sessions',
      cancelled: 'Cancelled',
      underFilled: 'Cancelled at the cut-off',
      expired: 'Not confirmed',
      enrolments: 'Sign-ups',
      attended: 'Attended',
      noShows: 'No-shows',
      lateCancels: 'Late cancels',
      fillRate: 'Fill rate',
      fillRateHint: 'Places taken out of the places offered',
    },
    money: {
      title: 'Money',
      collected: 'Collected',
      desk: 'At the desk',
      online: 'Online',
      refunds: 'Refunded',
      courtShare: 'Court share',
      coachShare: 'Owed to coaches',
      venueShare: "The venue's share",
      lessonRevenue: 'Lesson revenue',
    },
    byCoach: {
      title: 'By coach',
      coach: 'Coach',
      lessons: 'Lessons',
      enrolments: 'Sign-ups',
      collected: 'Collected',
      coachShare: "Coach's share",
    },
    byType: {
      title: 'By lesson type',
      type: 'Lesson type',
      kind: 'Kind',
      lessons: 'Lessons',
      enrolments: 'Sign-ups',
      collected: 'Collected',
    },
    byDay: {
      title: 'By day',
      day: 'Day',
      lessons: 'Lessons',
      collected: 'Collected',
      coachShare: "Coach's share",
    },
    exportTable: 'Export {table}',
    compareOff: "Comparison isn't available for lessons yet.",
    empty: 'No lessons in this period.',
    sandboxExcluded: 'Test payments are left out of these figures.',
  },
  // The management panel's lessons group (§5.18.4).
  panel: {
    title: 'Lessons',
    owedToCoachesHint: 'Paid outside the till',
  },
  // Ops online refunds (§5.17): a lesson's online money going back.
  deposits: {
    lessonRow: 'Lesson refund · {name}',
    // Inside "Why: {reason}", lower case like the other reasons.
    refundReason: {
      coach_cancel: 'the coach cancelled',
      under_filled: 'too few students',
    },
  },
};
