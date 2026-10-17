/**
 * `staff.activity.*`: the owner's activity monitor (0341; app/(staff)/staff-activity.tsx): each
 * person's status, last seen and last action, the operator (the desktop app) and the staff phone
 * apart. People are listed by name; nothing here ranks anyone. Action words are the desktop Audit
 * log's (`ws.manager.audit.actions.*`). Mirror every key in activity.ar.ts.
 */
export const staffActivityEn = {
  title: 'Activity',
  /** Today's tile, and its one-line preview. */
  entry: 'Activity',
  entryPreview: 'Who is on which app, and when',
  filter: {
    all: 'Everyone',
    online: 'Online now',
  },
  /** The line over the list; the numbers are people. */
  summary: 'Online now: {operator} on the operator, {mobile} on the phone',
  /** The two apps, each a section of a person's card. */
  surface: {
    operator: 'Operator',
    mobile: 'Mobile app',
  },
  status: {
    online: 'Online',
    away: 'Away',
    offline: 'Offline',
    never: 'Never used',
  },
  onBreak: 'On break',
  /** `{when}` is an `ago.*` phrase. */
  lastSeen: 'Last seen {when}',
  lastAction: 'Last action: {action}, {when}',
  noAction: 'No action recorded',
  /** `{screen}` is the page's route, e.g. /staff-order. */
  screen: 'Page {screen}',
  version: 'Version {version}',
  ago: {
    now: 'just now',
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
      one: '1 day ago',
      two: '2 days ago',
      few: '{count} days ago',
      many: '{count} days ago',
      other: '{count} days ago',
    },
    /** Older than a week. */
    date: 'on {date}',
  },
  empty: 'No staff at this branch.',
  emptyOnline: 'No one is online right now.',
  loadFailed: 'The activity could not be loaded.',
} as const;
