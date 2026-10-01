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
  lead: 'Heads and managers propose deductions; only the owner approves or declines them, here or under Wages. An approved deduction comes off the person’s next unpaid wage, and the Month tab shows what comes off each person’s pay.',
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
  // A proposal the viewer sent (can_withdraw): only the owner decides it (0272).
  yours: 'You proposed this. The owner decides it.',
  // Anyone else's waiting proposal, read by a manager, who no longer decides (0272).
  waitingForOwner: 'Waiting for the owner',
  empty: {
    waiting: 'Nothing waiting',
    waitingBody: 'When a head or a manager proposes a deduction, it waits here for the owner to decide.',
    all: 'No deductions yet',
    allBody: 'Heads propose deductions from their phones. You can add one here too.',
  },
  propose: {
    open: 'Propose a deduction',
    // The owner's own entry needs nobody else: it is recorded approved at once (0272).
    openOwner: 'Deduct from a wage',
    title: 'Propose a deduction',
    titleOwner: 'Deduct from a wage',
    lead: 'The owner approves it under Wages, and it then comes off the person’s next unpaid wage. The person is told only once it is approved, and never who proposed it.',
    leadOwner:
      'Recorded at once: it comes off their next unpaid wage. The person is told, and never who entered it.',
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
    submitOwner: 'Deduct from wage',
    sent: 'Sent to the owner for approval.',
    recorded: 'Deduction recorded.',
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
    approveBody: '{amount} off {name}’s pay. It comes off their next unpaid wage, and {name} is told.',
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
    // A month whose wage the owner marked paid is frozen (WAGE_ALREADY_PAID, 0272).
    paidLocked: 'This month’s wage is paid, so its deductions can no longer be cancelled.',
  },
  month: {
    thisMonth: 'This month',
    // The month's two figures, each label carrying how many deductions make it.
    approvedTotal: 'Approved ({count})',
    // A person with no approved deduction this month (only cancelled ones).
    nothingApproved: 'Nothing approved',
    waitingLabel: 'Waiting for the owner ({count})',
    empty: 'No deductions in {month}',
    emptyBody: 'A deduction counts in the person’s first unpaid month from the day it is approved.',
    leftStaff: 'Left the team',
    // The owner marked this person's wage for the month paid (wages, 0271).
    wagePaid: 'Wage paid',
    personCount: '{count} approved',
    personWaiting: '{count} waiting',
    earlier: 'Happened in {month}',
    proposedBy: 'Proposed by {name}',
    approvedBy: 'Approved by {name}, {time}',
  },
  // Observe home and /ops: what waits on the owner, who alone decides (0272).
  card: 'Proposals to take money off someone’s pay: the owner decides each one, and each month’s total per person is here.',
  waiting: {
    title: 'Deductions to decide',
    hint: 'A head or a manager proposed taking money off someone’s pay.',
    action: 'Decide deductions',
  },
  // /tasks: a head's read-only copy of their proposals (on the phone).
  phone: {
    tab: 'My deduction proposals',
    empty: 'You have not proposed any deductions.',
  },
} as const;
