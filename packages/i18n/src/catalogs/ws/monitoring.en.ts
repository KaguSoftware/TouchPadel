/**
 * `ws.monitoring.*`: the Monitoring page (/monitoring, 0393), the developer's
 * view of crashes and errors from every app, the edge functions and the
 * scheduled jobs. The dev role's page; the owner may open it too.
 * Mirror every key in monitoring.ar.ts.
 *
 * Single-line literals only (the assistant map indexes them).
 */
export const monitoringEn = {
  title: 'Monitoring',
  lead: 'Crashes and errors from the phones, the tills, the website, the server and the scheduled jobs, newest first. Refreshes every minute.',
  refresh: 'Refresh now',
  updated: 'Updated {time}',
  cronChecked: 'Scheduled jobs last checked {time}',
  cronNever: 'Scheduled jobs not checked yet',
  filters: {
    period: 'Period',
    source: 'From',
    level: 'Level',
    kind: 'Kind',
    allSources: 'Every app',
    allLevels: 'Every level',
    allKinds: 'Every kind',
    userReported: 'Reported by a person only',
  },
  periods: {
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
  },
  sources: {
    operator: 'Operator',
    mobile: 'Phone app',
    web: 'Website',
    edge: 'Server functions',
    db: 'Database',
    cron: 'Scheduled jobs',
  },
  levels: {
    error: 'Error',
    warn: 'Warning',
    info: 'Info',
  },
  totals: {
    total: 'Events',
    error: 'Errors',
    warn: 'Warnings',
    userReported: 'Reported by a person',
  },
  chart: {
    titleHour: 'Events per hour',
    titleDay: 'Events per day',
    bar: '{when}: {count} events',
    empty: 'Nothing was reported in this period.',
  },
  kinds: {
    title: 'Most frequent',
    count: '{count} times',
  },
  list: {
    title: 'Events',
    when: 'When',
    source: 'From',
    level: 'Level',
    kind: 'Kind',
    message: 'What happened',
    userReported: 'Reported by a person',
    emptyTitle: 'All quiet',
    emptyBody: 'No crash or error was reported in this period.',
    filteredTitle: 'Nothing matches these filters',
    filteredBody: 'Try another period, app or level.',
    older: 'Show older events',
  },
  detail: {
    title: 'Event #{id}',
    when: 'When',
    source: 'From',
    level: 'Level',
    kind: 'Kind',
    version: 'App version',
    branch: 'Branch',
    staff: 'Staff member',
    account: 'Signed in',
    accountYes: 'Yes',
    accountNo: 'No',
    none: 'Not known',
    message: 'What happened',
    details: 'Details',
    noDetails: 'No further details were sent.',
    close: 'Close',
  },
};
