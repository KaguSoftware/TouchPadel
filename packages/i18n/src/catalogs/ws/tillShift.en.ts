/**
 * `ws.tillShift.*`: till shifts (the rail row, the start panel, the close dialog, the
 * drawer card, the day-close step, the staff activity panel). Owned by lane T
 * (docs/design/protocols/wave5-addendum-2026-09-25 §1.2, §4.1).
 * Mirror every key in tillShift.ar.ts.
 *
 * Vocabulary: a "shift" is one person's drawer at one till or at the desk. It is
 * started on a counted amount and ended with a blind count (the expected amount
 * is never shown before the count, §8 Q29). "Drawer" is the cash in it, at the
 * desk as at the till (§2.9.9).
 */
export const tillShiftEn = {
  // The rail row under the break row.
  rail: {
    start: 'Start my shift',
    mine: 'My shift · since {time}',
    end: 'End my shift',
    others: '{name}’s shift · since {time}',
    closeOthers: 'Close {name}’s shift',
    // The rail's own button: the name is in the caption under it, which wraps.
    closeThis: 'Close this shift',
    // Under a Start that cannot be pressed yet.
    noDay: 'The day is not open yet',
    elsewhere: 'Your shift is open on {station}',
  },
  // The start panel: from the rail, and inside the payment pane.
  start: {
    title: 'Start my shift',
    // The payment pane's lead when it asks for a shift first.
    gateLead: 'Start your shift to take payment.',
    // The same panel on /till and the desk's Today, before any payment is pressed.
    panelLead: 'Start your shift before the first payment.',
    handover: '{name} left {amount} in the drawer at {time}.',
    // The previous shift was the viewer's own.
    handoverYou: 'You left {amount} in the drawer at {time}.',
    outsideIn: 'Since then, {amount} was taken here with no shift open.',
    outsideOut: 'Since then, {amount} was paid out here with no shift open.',
    dayFloat: 'The day opened with {amount} in the drawer.',
    // The desk's first shift of the day: the day's float is the till's.
    deskCount: 'Count the cash in the desk’s box to start.',
    ask: 'Is {amount} in the drawer now?',
    confirm: 'That’s right',
    different: 'I counted a different amount',
    counted: 'Cash in the drawer now',
    countedHint: 'Everything in the drawer, float included.',
    note: 'Note',
    noteHint: 'What you found, if it is not what was handed over.',
    back: 'Back',
    started: 'Shift started.',
    startedMore: 'Shift started with {amount} more than was handed over.',
    startedLess: 'Shift started with {amount} less than was handed over.',
    noDay: 'The day is not open yet. A manager opens it on Day close.',
    unsynced: 'Sales made here are still waiting to send. Start once they are sent.',
    elsewhere: 'Your shift is still open on {station}. End it there first.',
    busy: '{name}’s shift is still open here.',
  },
  // The payment pane when it stands between the person and the tender.
  gate: {
    othersTitle: '{name}’s shift is still open',
    othersLead: 'Count {name}’s drawer and close the shift with a manager’s PIN, then start yours.',
    closeOthers: 'Close {name}’s shift',
    elsewhereTitle: 'Your shift is open on {station}',
    elsewhereLead: 'End it there, then start one here.',
    // A manager or owner taking payment (payOnOthersShift).
    othersDrawer: 'This payment goes into {name}’s drawer.',
    noShift: 'No shift is open here, so this payment is counted outside a shift.',
  },
  // The close dialog: count, sign, result.
  close: {
    titleMine: 'End my shift',
    titleOthers: 'Close {name}’s shift',
    countLead:
      'Count all the cash in the drawer, float included. The difference shows once the count is signed.',
    counted: 'Cash in the drawer',
    note: 'Note',
    next: 'Next',
    signOwn: 'Your PIN signs a count of {amount}.',
    signManager: 'A manager’s PIN signs a count of {amount}.',
    noPin: 'You have no PIN yet, so a manager signs this count.',
    useManager: 'Use a manager’s PIN instead',
    useOwn: 'Use my PIN',
    pin: 'Your PIN',
    managerPin: 'Manager’s PIN',
    changeCount: 'Change the count',
    endAction: 'End my shift',
    closeAction: 'Close the shift',
    closedTitle: 'Shift closed',
    exact: 'The drawer matches',
    short: 'Short by {amount}',
    over: 'Over by {amount}',
    signedBy: 'Signed with {name}’s PIN.',
    leftForNext: '{amount} stays in the drawer for the next shift.',
    signOut: 'Sign out',
    stay: 'Stay signed in',
    done: 'Done',
    startMine: 'Start my shift',
  },
  // Figure labels shared by the result, the drawer card, day close and the report.
  figures: {
    openedAt: 'Started at',
    float: 'Started with',
    cashIn: 'Cash taken',
    cashOut: 'Cash refunded',
    expected: 'Expected in the drawer',
    counted: 'Counted',
    difference: 'Difference',
    card: 'Card taken',
    payments: 'Payments',
    refunds: 'Refunds',
    drawerOpens: 'Drawer opened by hand',
    handover: 'At handover',
    handoverMore: '{amount} more than handed over',
    handoverLess: '{amount} less than handed over',
  },
  // Sign out and the idle lock's Switch user while one's own shift is open.
  leave: {
    title: 'Your shift is still open',
    body: 'Count the drawer and end your shift before you sign out. If you sign out now, it stays open here until a manager closes it.',
    end: 'End my shift',
    signOut: 'Sign out anyway',
    lock: '{name}’s shift is still open here. Signed out, it stays open until a manager closes it.',
    lockBack: 'Back',
  },
  // /till/drawer.
  drawer: {
    title: 'Your shift',
    since: 'Since {time}',
    blindHint: 'The expected amount shows when you end your shift and count the drawer.',
    none: 'No shift is open on this till',
    noneHint: 'Start your shift before you take payment.',
    others: '{name}’s shift is open on this till',
    othersHint: 'Since {time}. Close it with a manager’s PIN to start yours.',
    shiftsTitle: 'Shifts on this till today',
    shiftsEmpty: 'No shifts on this till today.',
    expectedNow: 'Expected now',
  },
  // One shift as a row, wherever shifts are listed.
  row: {
    open: 'Open',
    endedWithDay: 'Ended with the day, not counted',
    byManager: 'Manager’s PIN: {name}',
    noStation: 'No station named',
  },
  // The "Till shifts" step on /admin/day-close.
  dayClose: {
    title: 'Till shifts',
    none: 'No shifts',
    allClosed: 'All closed',
    openLeft: '{count} still open',
    openHint:
      'Closing the day ends an open shift without a count. Ask its holder to end it at the till, or close it there with a manager’s PIN.',
    outsideTitle: 'Taken outside a shift',
    outsideLead:
      'At a station while no shift was open there. The next handover at that station counts it.',
    crossDay:
      'Refunds made on this day for earlier days’ payments: {amount} in cash. The day’s expected cash leaves them out.',
    retry: 'Try again',
    // CSV rows: the figure column; the value is the difference or the amount.
    csv: {
      shift: 'Till shift difference: {name}, {station}',
      shiftOpen: 'Till shift still open: {name}, {station}',
      shiftByDay: 'Till shift ended with the day, not counted: {name}, {station}',
      outsideIn: 'Cash taken outside a shift: {station}',
      outsideOut: 'Cash refunded outside a shift: {station}',
      crossDay: 'Cash refunds made this day for earlier days',
    },
  },
  // /reports/staff, the "Till shifts" view.
  report: {
    view: 'Till shifts',
    lead: 'Each till and desk shift in the period, with its count and difference, in the order they started.',
    tooLong: 'Till shifts show for up to 62 days at a time. Pick a shorter period.',
    empty: 'No till shifts in this period.',
    columns: {
      day: 'Day',
      person: 'Person',
      station: 'Station',
      times: 'Time',
    },
  },
  // Setup "Worth checking".
  setup: {
    noPin: 'Cashiers and desk staff with no PIN',
    noPinHint:
      'They end their till shift with a manager’s PIN. Give each one a PIN of their own under Staff.',
    noPinAction: 'Go to Staff',
  },
  // /ops "Needs you now" and the Observe home.
  ops: {
    title: 'Till shifts closed short or over today',
    hint: 'Each difference is on Day close, with who counted it and who signed.',
    action: 'Open Day close',
  },
} as const;
