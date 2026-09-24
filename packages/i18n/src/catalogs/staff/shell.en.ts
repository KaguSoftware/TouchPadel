/**
 * `staff.shell.*` — the staff phone’s Today, account, venue picker, revoked and update-the-app screens,
 * the work-alerts row, the sign-in refusal and staff requests.
 * Owned by lane B (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in shell.ar.ts.
 */
export const staffShellEn = {
  today: {
    title: 'Today',
    greeting: 'Hello, {name}',
    // "Head chef · Touch Padel"
    roleAtVenue: '{role} · {venue}',
    rowsTitle: 'Your work',
  },
  venue: {
    label: 'Working at',
    none: 'No venue is linked to your account yet. Ask the owner to add you to one.',
  },
  alerts: {
    title: 'Turn on work alerts',
    body: 'Get a notification when a task is waiting for you or something you sent is decided.',
    enable: 'Turn on',
    deniedBody: 'Work alerts are off for this app. Turn them on in your phone’s settings.',
    openSettings: 'Open settings',
  },
  account: {
    title: 'Account',
    alertsOn: 'Work alerts are on on this phone.',
    alertsOff: 'Work alerts are off on this phone.',
    onePhone:
      'One account per phone: while you are signed in here as staff, this phone gets your work alerts and no guest booking reminders.',
    passwordNote: 'Forgot your password? The owner resets it on the Staff page.',
    signOutConfirm: 'You will need your email and password to sign back in.',
  },
  pending: {
    slow: 'Checking your account is taking longer than usual. Check your connection and try again.',
  },
  revoked: {
    title: 'This staff account is switched off',
    body: 'Ask the owner if you think this is a mistake. Sign out to use the app as a guest.',
  },
  update: {
    title: 'Update the app',
    body: 'Your account has a role this version of the app does not know yet. Update Touch Padel, then open it again.',
  },
  // A Google or Apple sign-in that lands on a staff account is signed out again (§6.6).
  socialRefused: 'Staff accounts sign in with email and password.',
  requests: {
    row: 'Requests',
    title: 'Requests',
    lead: 'Ask for leave, a shift swap, a wage advance or a correction to your record. The owner decides.',
    // The owner reads requests here and decides them on the operator (plan #16, #56).
    decideOnOperator: 'Decide in Observe ▸ Requests on the operator.',
    managerNote: 'The owner decides requests. Your team’s requests are listed here too.',
    newTitle: 'New request',
    kind: 'Asking for',
    kinds: {
      leave: 'Leave',
      shift_swap: 'Shift swap',
      advance: 'Wage advance',
      correction: 'Record correction',
    },
    from: 'First day',
    to: 'Last day',
    day: 'Day',
    dateHint: 'Type the date as year-month-day, for example {example}.',
    amount: 'Amount (IQD)',
    note: 'Note',
    noteOptional: 'Note (optional)',
    noteCorrection: 'What does the record get wrong?',
    submit: 'Send request',
    sent: 'Request sent',
    mine: 'Your requests',
    everyone: 'Everyone’s requests',
    empty: 'No requests yet.',
    statuses: {
      pending: 'Waiting for the owner',
      approved: 'Approved',
      rejected: 'Declined',
      withdrawn: 'Withdrawn',
    },
    dates: '{from} to {to}',
    ownerNote: 'Owner’s note: {note}',
    withdraw: 'Withdraw',
    withdrawConfirm: 'Withdraw this request? The owner will no longer see it as waiting.',
    withdrawn: 'Request withdrawn',
    errors: {
      date: 'Enter a date like {example}.',
      dateOrder: 'The last day cannot come before the first.',
      amount: 'Enter an amount above 0.',
      note: 'Say what the record gets wrong.',
    },
  },
} as const;
