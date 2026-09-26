/**
 * `staff.deductions.*`: the staff phone's deductions page (app/staff-deductions.tsx:
 * propose for your team, my proposals, my deductions). Owned by lane P
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §1.2, §4.1).
 * Mirror every key in deductions.ar.ts.
 *
 * Statuses are `work.deduction.status.*`, shared with the operator; role names
 * are `op.roles.*`. Deciding is on the operator only (§8 Q8).
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
  // Management only: how many wait on the operator.
  // Names the operator rail's row exactly (ws.shell nav deductions).
  waiting: 'Waiting for a decision: {count}. Decide them on the operator, under Pay deductions.',
  propose: {
    lead: 'Propose a deduction for someone on your team. A manager or the owner decides.',
    leadMgmt:
      'Propose a deduction for anyone at the venue but yourself and the owners. Another manager or the owner decides.',
    // The owner's own proposal: nobody decides their own, so a manager does (0197).
    leadOwner: 'Propose a deduction for anyone at the venue but the owners. A manager decides.',
    open: 'Propose a deduction',
    title: 'New deduction',
    who: 'Who',
    amount: 'Amount (IQD)',
    date: 'When it happened',
    dateHint: 'Year-month-day, within the last 60 days. For example {example}.',
    reason: 'Why',
    consequence:
      'A manager or the owner decides. {name} sees it only if it is approved, and never sees who proposed it.',
    consequenceAnyone:
      'A manager or the owner decides. The person sees it only if it is approved, and never sees who proposed it.',
    consequenceOwner:
      'A manager decides. {name} sees it only if it is approved, and never sees who proposed it.',
    consequenceAnyoneOwner:
      'A manager decides. The person sees it only if it is approved, and never sees who proposed it.',
    submit: 'Send for approval',
    cancel: 'Cancel',
    sent: 'Sent. A manager or the owner decides.',
    sentOwner: 'Sent. A manager decides.',
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
    lead: 'What a manager or the owner approved to take from your pay, by the month it counts in.',
    prev: 'Previous month',
    next: 'Next month',
    total: 'Approved in {month}',
    empty: 'No deductions in {month}.',
    happened: 'Happened {day}',
    datedEarlier: 'Happened in {happened}, counted in {counted}.',
    cancelled: 'Not taken from your pay.',
  },
} as const;
