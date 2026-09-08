/**
 * Shared presentational-component strings (spec §07): status indicators,
 * async states, governance prompts, tables. Owned by the shell lane.
 */
export const kitEn = {
  async: {
    loading: 'Loading…',
    empty: 'Nothing here yet.',
    error: 'This could not be loaded.',
    retry: 'Try again',
    offlineHint: 'You may be offline. The last known data is shown where available.',
  },
  /**
   * Rulebook 9.2: "empty" is three different situations and they need three
   * different sentences. `async.empty` above is the *initial* one ("nothing
   * yet") and stays where it is; a filtered list that matched nothing must not
   * tell staff the system is empty, and a queue that is genuinely clear should
   * say so positively rather than apologise.
   */
  empty: {
    filtered: 'Nothing matches those filters.',
    nothingToDo: 'Nothing needs your attention.',
    clearFilters: 'Clear filters',
  },
  filters: {
    active: 'Active filters',
    remove: 'Remove filter: {label}',
    clearAll: 'Clear all',
  },
  bookingStatus: {
    pending: 'Held',
    confirmed: 'Confirmed',
    arrived: 'Arrived',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No-show',
    expired: 'Expired',
  },
  paymentStatus: {
    unpaid: 'Unpaid',
    partial: 'Partly paid',
    paid: 'Paid',
    refunded: 'Refunded',
    unknown: 'Payment unknown',
  },
  ticketState: {
    queued: 'New',
    preparing: 'Preparing',
    ready: 'Ready',
    completed: 'Complete',
    voided: 'Voided',
  },
  tabStatus: {
    open: 'Open',
    awaiting_payment: 'Awaiting payment',
    settled: 'Settled',
    void: 'Void',
  },
  reservationKind: {
    booking: 'Booking',
    hold: 'Hold',
    maintenance: 'Blocked',
  },
  source: {
    web: 'Website',
    till: 'Till',
    mobile: 'App',
    desk: 'Desk',
  },
  flags: {
    vip: 'VIP',
    birthday: 'Birthday',
    payment_note: 'Payment note',
    special_request: 'Special request',
  },
  pin: {
    title: 'Manager authorisation',
    lead: 'Enter a manager PIN to {action}.',
    pin: 'PIN',
    confirm: 'Authorise',
    cancel: 'Cancel',
  },
  reason: {
    title: 'Reason required',
    lead: 'Choose why you are about to {action}. The reason is written to the audit log with your name.',
    code: 'Reason',
    note: 'Note (optional)',
    confirm: 'Continue',
    cancel: 'Cancel',
  },
  refused: {
    title: 'Not allowed for your role',
    body: '{action} needs the {role} role. The control stays here so you can see what is available; ask a {role} to do it.',
  },
  conflict: {
    title: 'The server refused this change',
    body: 'Someone else took this slot or changed this record first. Nothing was saved.',
    dismiss: 'Understood',
  },
  degraded: {
    title: 'Offline mode',
    body: 'The server cannot be reached. The till keeps trading; {count} changes are queued and will sync automatically.',
    queued: '{count} queued',
  },
  table: {
    sortAsc: 'Sorted ascending',
    sortDesc: 'Sorted descending',
    noRows: 'No rows match.',
    rowsOf: '{shown} of {total}',
    page: 'Page {page} of {count}',
    prev: 'Previous page',
    next: 'Next page',
    rowActions: 'Row actions',
    rowActionsFor: 'More actions for {name}',
  },
  search: {
    placeholder: 'Search…',
    // Deliberately not "Clear search": a second control whose accessible name
    // contains "Search" makes every getByLabel('Search') in the suite ambiguous.
    clear: 'Clear',
  },
  comparison: {
    none: 'No comparison',
    previousPeriod: 'Previous period',
    sameLastYear: 'Same period last year',
    vs: 'vs {label}',
    noPrevious: 'No earlier data',
  },
  dateRange: {
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This week',
    lastWeek: 'Last week',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    last30: 'Last 30 days',
    custom: 'Custom',
    from: 'From',
    to: 'To',
    apply: 'Apply',
  },
  export: {
    csv: 'Export CSV',
    exporting: 'Exporting…',
    scope: 'Current filters and dates',
  },
  drill: {
    title: 'Transactions behind this figure',
    empty: 'No transactions in this range.',
    close: 'Close',
  },
  keypad: {
    clear: 'Clear',
    backspace: 'Delete',
    confirm: 'Confirm',
    thousand: '000',
  },
  change: {
    due: 'Due',
    tendered: 'Tendered',
    change: 'Change',
    short: 'Short by {amount}',
  },
  bilingual: {
    en: 'English',
    ar: 'Arabic',
    missingOther: 'Shown in {lang} — no {other} text entered.',
  },
  actions: {
    save: 'Save',
    saving: 'Saving…',
    discard: 'Discard changes',
    edit: 'Edit',
    remove: 'Remove',
    add: 'Add',
    create: 'Create',
    back: 'Back',
    open: 'Open',
    details: 'Details',
    more: 'More',
    refresh: 'Refresh',
    unsaved: 'Unsaved changes',
    dirtyLeave: 'You have unsaved changes. Leave and lose them?',
  },
  common: {
    on: 'On',
    off: 'Off',
    all: 'All',
    none: 'None',
    unknown: 'Unknown',
    today: 'Today',
    now: 'now',
    minutes: '{minutes} min',
    hours: '{hours} h',
    until: 'until {time}',
    by: 'by {name}',
    at: 'at {time}',
    edited: 'edited',
    required: 'Required',
    optional: 'Optional',
    readOnly: 'Read-only',
    temporary: 'Temporary',
    readOnlyStock: 'Set by stock — not a toggle',
    /** The unit, not the number: Arabic uses U+066A, so it cannot be a literal. */
    percent: '%',
  },
} as const;
