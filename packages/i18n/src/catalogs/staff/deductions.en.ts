/**
 * `staff.deductions.*`: the staff phone's deductions page (app/staff-deductions.tsx:
 * propose for your team, my proposals, my deductions). Owned by lane P
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in deductions.ar.ts.
 *
 * Statuses are `work.deduction.status.*`, shared with the operator; role names
 * are `op.roles.*`. Deciding is on the operator only (§8 Q8), and only the
 * owner decides (0272): the owner's own entry is recorded approved at once.
 */
export const staffDeductionsEn = {
  // Today's row (rows.ts), for the heads and management.
  row: 'Pay deductions',
  // The requests page's row (staff-request.tsx), for every role.
  mineRow: 'My deductions',
  title: 'Pay deductions',
  mineTitle: 'My deductions',
  views: {
    propose: 'Propose',
    mine: 'Your deductions',
  },
  // The owner only (0272): how many wait on the operator.
  // Names the operator rail's row exactly (ws.shell nav deductions).
  waiting: 'Waiting for a decision: {count}. Decide them on the operator, under Pay deductions.',
  propose: {
    lead: 'Propose a deduction for someone on your team. The owner decides.',
    leadMgmt:
      'Propose a deduction for anyone at the venue but yourself and the owners. The owner decides.',
    // The owner's own entry needs nobody else: it is recorded approved at once (0272).
    leadOwner:
      'Deduct from the pay of anyone at the venue but the owners. It is recorded at once and comes off their next unpaid wage.',
    open: 'Propose a deduction',
    title: 'New deduction',
    who: 'Who',
    amount: 'Amount (IQD)',
    date: 'When it happened',
    dateHint: 'Year-month-day, within the last 60 days. For example {example}.',
    reason: 'Why',
    consequence:
      'The owner decides. {name} sees it only if it is approved, and never sees who proposed it.',
    consequenceAnyone:
      'The owner decides. The person sees it only if it is approved, and never sees who proposed it.',
    consequenceOwner:
      'Recorded at once: it comes off their next unpaid wage. {name} is told, and never sees who entered it.',
    consequenceAnyoneOwner:
      'Recorded at once: it comes off the person’s next unpaid wage. They are told, and never see who entered it.',
    submit: 'Send for approval',
    submitOwner: 'Deduct from wage',
    cancel: 'Cancel',
    sent: 'Sent. The owner decides.',
    recorded: 'Deduction recorded. It comes off their next unpaid wage.',
    noTargets: 'There is nobody you can propose a deduction for right now.',
    errors: {
      who: 'Choose who it is for.',
      amount: 'Enter the amount in whole dinars.',
      amountTooMuch: 'One deduction can be at most 2,000,000 IQD.',
      date: 'Enter a date like {example}.',
      future: 'Choose today or an earlier day.',
      tooOld: 'Choose a day within the last 60 days.',
      reason: 'Say why.',
      reasonTooLong: 'Keep it to 500 characters.',
    },
  },
  proposals: {
    title: 'Your proposals',
    empty: 'You have not proposed any deductions.',
    person: '{name} · {role}',
    happened: 'Happened {day}',
    note: 'Note: {note}',
    withdraw: 'Withdraw',
    withdrawTitle: 'Withdraw this proposal?',
    withdrawBody: 'Nobody will decide it, and the person never sees it.',
    withdrawn: 'Proposal withdrawn.',
  },
  mine: {
    lead: 'What the owner approved to take from your pay, by the month it counts in.',
    prev: 'Previous month',
    next: 'Next month',
    total: 'Approved in {month}',
    empty: 'No deductions in {month}.',
    happened: 'Happened {day}',
    datedEarlier: 'Happened in {happened}, counted in {counted}.',
    cancelled: 'Not taken from your pay.',
  },
} as const;
