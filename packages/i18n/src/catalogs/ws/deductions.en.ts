/**
 * `ws.deductions.*`: the operator's /deductions page (waiting, month, all; propose,
 * decide, cancel). Owned by lane P (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in deductions.ar.ts.
 *
 * Money about a named person: no string here carries a figure it was not given,
 * and the statuses themselves are `work.deduction.status.*`.
 */
export const deductionsEn = {
  title: 'Pay deductions',
  lead: 'Heads propose a deduction from their phone. Approve or decline it here; the Month tab shows what comes off each person’s pay.',
  tabsLabel: 'Show deductions',
  tab: {
    waiting: 'Waiting',
    waitingCount: 'Waiting ({count})',
    month: 'Month',
    all: 'All',
  },
  cols: {
    person: 'Person',
    amount: 'Amount',
    date: 'Happened',
    reason: 'Reason',
    proposedBy: 'Proposed by',
    status: 'Status',
  },
  // Under the date: the month a deduction is paid in (V16), amber when it
  // happened in an earlier month.
  paidIn: 'Counts in {month}',
  paidInEarlier: 'Happened earlier, counts in {month}',
  decidedBy: '{name}, {time}',
  noteLine: 'Note: {note}',
  cancelledBy: 'Cancelled by {name}, {time}',
  reasonLine: 'Reason: {reason}',
  approve: 'Approve',
  decline: 'Decline',
  yours: 'You proposed this. Another manager or the owner decides it.',
  // The owner's own proposal: nobody decides their own, so a manager does (0197).
  yoursOwner: 'You proposed this. A manager decides it.',
  empty: {
    waiting: 'Nothing to decide',
    waitingBody: 'When a head proposes a deduction on their phone, it waits here for you.',
    all: 'No deductions yet',
    allBody: 'Heads propose deductions from their phones. You can propose one here too.',
  },
  propose: {
    open: 'Propose a deduction',
    title: 'Propose a deduction',
    lead: 'Another manager or the owner decides it. The person is told only once it is approved, and never who proposed it.',
    leadOwner:
      'A manager decides it. The person is told only once it is approved, and never who proposed it.',
    person: 'Person',
    choosePerson: 'Choose a person',
    nobody: 'There is nobody you can propose a deduction for.',
    personRefused: 'You cannot propose a deduction for this person. Choose someone from the list.',
    amount: 'Amount',
    amountHint: '{min} to {max}.',
    date: 'When it happened',
    dateHint: 'Within the last {days} days.',
    reason: 'Reason',
    reasonHint: 'The person reads this once the deduction is approved.',
    submit: 'Send for approval',
    sent: 'Sent for approval.',
    issue: {
      required: 'Fill this in.',
      amountRange: 'Enter an amount from {min} to {max}.',
      dateRange: 'Pick a day within the last {days} days.',
      tooLong: 'Keep it to {limit} characters.',
    },
  },
  decide: {
    approveTitle: 'Approve this deduction?',
    declineTitle: 'Decline this deduction?',
    approveBody: '{amount} off {name}’s pay. It counts in this month’s pay, and {name} is told.',
    declineBody: '{amount} off {name}’s pay. {name} never sees a declined deduction.',
    note: 'Note',
    reason: 'Reason',
    readByProposer: 'The person who proposed it reads this.',
    approveConfirm: 'Approve deduction',
    declineConfirm: 'Decline deduction',
    approved: 'Deduction approved.',
    declined: 'Deduction declined.',
  },
  withdraw: {
    open: 'Withdraw',
    title: 'Withdraw your proposal?',
    body: '{amount} off {name}’s pay. Nobody will decide it.',
    confirm: 'Withdraw proposal',
    keep: 'Keep it',
    done: 'Proposal withdrawn.',
  },
  cancel: {
    open: 'Cancel deduction',
    title: 'Cancel this deduction?',
    body: '{amount} off {name}’s pay. It stays on record as cancelled and leaves every total. {name} sees it as cancelled.',
    reason: 'Reason',
    reasonHint: 'Kept with the deduction. The person does not see it.',
    confirm: 'Cancel deduction',
    keep: 'Keep it',
    done: 'Deduction cancelled.',
  },
  month: {
    thisMonth: 'This month',
    // The month's two figures, each label carrying how many deductions make it.
    approvedTotal: 'Approved ({count})',
    // A person with no approved deduction this month (only cancelled ones).
    nothingApproved: 'Nothing approved',
    waitingLabel: 'Waiting for a decision ({count})',
    empty: 'No deductions in {month}',
    emptyBody: 'A deduction counts in the month it is approved in.',
    leftStaff: 'Left the team',
    personCount: '{count} approved',
    personWaiting: '{count} waiting',
    earlier: 'Happened in {month}',
    proposedBy: 'Proposed by {name}',
    approvedBy: 'Approved by {name}, {time}',
  },
  // Observe home and /ops: what waits on the manager or owner.
  card: 'Heads’ proposals to take money off someone’s pay: decide them, and see each month’s total per person.',
  waiting: {
    title: 'Deductions to decide',
    hint: 'A head proposed taking money off someone’s pay.',
    action: 'Decide deductions',
  },
  // /tasks: a head's read-only copy of their proposals (on the phone).
  phone: {
    tab: 'My deduction proposals',
    empty: 'You have not proposed any deductions.',
  },
} as const;
