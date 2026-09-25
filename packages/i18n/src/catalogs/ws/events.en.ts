/**
 * `ws.events.*` — the desk’s event block, the Staff hire prefill and the courts events line.
 * Owned by lane F (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in events.ar.ts.
 */
export const eventsEn = {
  // /desk/block?run=&step= — the courts step of a tournament.
  block: {
    title: 'Block courts for a tournament',
    lead: 'The courts and times come from the tournament plan. They are held as the tournament’s event: the calendar shows them as blocks, and court analytics counts them as event hours, not as closed time.',
    loadFailed: 'The tournament could not be loaded.',
    capacity: {
      players: '{count} players',
      pairs: '{count} pairs',
    },
    classLabel: 'Class {class}',
    windows: 'Courts and times',
    noWindows: 'The plan names no courts yet. Ask the manager to check the plan.',
    columns: {
      court: 'Court',
      when: 'When',
      state: 'State',
    },
    state: {
      blocked: 'Blocked',
      toBlock: 'To block',
    },
    blockAll: 'Block {count} remaining',
    allBlocked: 'Every court and time in the plan is blocked.',
    blockedDone: 'Blocked. The calendar shows them now.',
    conflictBody: 'These reservations hold part of the tournament’s time. Nothing was blocked. Move or cancel them, then check again.',
    conflictKind: {
      booking: 'Booking',
      hold: 'Being booked',
      maintenance: 'Block',
    },
    openBooking: 'Open booking',
    checkAgain: 'Check again',
    notOpen: 'This courts step is not open, so nothing can be blocked here. It is: {status}.',
    notCourts: 'This link is not a tournament’s courts step.',
    send: {
      title: 'Send the courts step',
      note: 'What was moved (optional)',
      noteHint: 'For the manager who checks this step: bookings you moved, or why a time is not blocked.',
      submit: 'Send courts step',
      remaining: '{count} of the plan’s times are not blocked yet. Block them first, or say why in the note.',
      needsBlock: 'Block at least one court before sending.',
      done: 'Sent. A manager checks the courts step next.',
    },
    back: 'Back to the tournament',
    openCalendar: 'Open calendar',
  },
  // /admin/staff?hire=<run step> — the owner adds the picked candidate.
  hire: {
    title: 'Hiring: add the new staff member',
    body: '{name} was picked for {role}. Add their account here; the hiring run finishes when it is saved.',
    bodyNoName: 'The run picked someone for {role}. Add their account here; the hiring run finishes when it is saved.',
    add: 'Add the new staff member',
    loading: 'Loading the hiring run…',
    loadFailed: 'The hiring run could not be loaded.',
    notOpen: 'This hiring step is not waiting for you, so nothing is filled in.',
    roleLocked: 'Set by the hiring run: the account must be in the role the position named.',
    done: 'Account added. The hiring run is finished.',
    submitFailed: 'The account was created, but the hiring step was not sent.',
    retry: 'Send the hiring step again',
    dismiss: 'Close',
  },
  // Court analytics and /reports/courts: hours held for tournaments.
  courts: {
    eventHours: 'Event hours',
    eventHoursTip: 'Court hours held for tournaments. They stay in open hours, so occupancy counts them as open and not booked.',
    eventHoursHint: 'Held for tournaments, counted as open hours',
    eventMinutesCsv: 'Event minutes',
  },
} as const;
