/**
 * `ws.activity.*`: the owner's activity monitor (/observation/activity, 0341):
 * for every person, when they were last seen and what they last did, on the
 * operator and on the mobile app separately. Mirror every key in
 * activity.ar.ts.
 *
 * Nothing here compares people: the page lists them by name. A counted phrase
 * sits under `ago.*` with all six plural forms (countPhrase, @touch/i18n
 * plural.ts). Single-line literals only (the assistant map indexes them).
 */
export const activityEn = {
  title: 'Activity monitor',
  lead: 'Who is using the operator and the mobile app now, when each person was last seen, and the last thing they did.',
  summary: 'Online now: {operator} on the operator, {mobile} on the mobile app.',
  filters: {
    label: 'Show',
    all: 'Everyone',
    online: 'Online now',
    notToday: 'Not seen today',
  },
  columns: {
    person: 'Person',
    operator: 'Operator',
    mobile: 'Mobile app',
  },
  status: {
    online: 'Online',
    away: 'Away',
    offline: 'Offline',
    signedOut: 'Signed out',
    never: 'Never used',
  },
  onBreak: 'On break',
  lastSeen: 'Last seen {time}',
  lastAction: '{action}, {time}',
  noAction: 'No actions yet',
  screen: 'Screen: {screen}',
  device: 'Device {device}',
  ago: {
    justNow: 'just now',
    minutes: {
      zero: 'just now',
      one: '1 min ago',
      two: '2 min ago',
      few: '{count} min ago',
      many: '{count} min ago',
      other: '{count} min ago',
    },
    hours: {
      zero: 'just now',
      one: '1 hour ago',
      two: '2 hours ago',
      few: '{count} hours ago',
      many: '{count} hours ago',
      other: '{count} hours ago',
    },
    days: {
      zero: 'today',
      one: 'yesterday',
      two: '2 days ago',
      few: '{count} days ago',
      many: '{count} days ago',
      other: '{count} days ago',
    },
  },
  audit: 'Audit log',
  auditFor: 'Audit log for {name}',
  empty: {
    title: 'No staff at this branch yet',
    body: 'People appear here once they are added on the Staff page.',
  },
} as const;
