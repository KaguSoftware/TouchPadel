/**
 * `ws.branches.*`: the operator's branch words (multi-venue slice 4, plan
 * MV1–MV8): the owner's branch switcher, Setup › Branches, "Open a new branch",
 * the readiness checklist, station registration and the Devices panel, a staff
 * member's branches, and the reports' branch filter.
 * Mirror every key in branches.ar.ts.
 *
 * Vocabulary: a "branch" is one Touch location. It is Preparing (being set up,
 * guests cannot see it), Open or Closed (never deleted).
 */
export const branchesEn = {
  switcher: {
    label: 'Branch',
    all: 'All branches',
    thisStation: 'This station’s branch',
    preparing: 'Preparing',
  },
  status: {
    preparing: 'Preparing',
    open: 'Open',
    closed: 'Closed',
  },
  list: {
    title: 'Branches',
    intro: 'Every Touch location. A new branch is set up in Preparing, then opened to guests.',
    openNew: 'Open a new branch',
    empty: 'No branches yet.',
    tables: '{n} tables',
    courts: '{n} courts',
  },
  create: {
    title: 'Open a new branch',
    intro: 'The new branch starts as a copy of the branch you pick: courts, rates, hours, tables, menu, recipes, checklists and protocol templates. Nothing is copied back, and no promotion, stock or staff comes across.',
    nameEn: 'Name (English)',
    nameAr: 'Name (Arabic)',
    slug: 'Short name',
    slugHint: 'Lowercase letters, digits and dashes, used in links.',
    phone: 'Phone',
    addressEn: 'Address (English)',
    addressAr: 'Address (Arabic)',
    timezone: 'Timezone',
    copyFrom: 'Copy setup from',
    submit: 'Create',
    creating: 'Creating the branch…',
    created: '{name} is ready to set up.',
    copied: 'Copied: {courts} courts, {items} menu items, {tables} tables.',
  },
  readiness: {
    title: 'Before it opens',
    intro: 'Guests see the branch once every required step is done.',
    required: 'Required',
    warning: 'Recommended',
    courts_and_rates: 'A court with a rate',
    opening_hours: 'Opening hours',
    manager: 'A manager works here',
    till: 'A till is registered',
    menu: 'A menu item on sale',
    telegram: 'A Telegram group for alerts',
    opening_stock: 'Opening stock received',
    fix: 'Fix',
    openToGuests: 'Open to guests',
    opened: '{name} is open to guests.',
    close: 'Close branch',
    closeConfirm: 'Close {name}? Guests stop seeing it. Nothing is deleted, and you can open it again.',
    closed: '{name} is closed.',
    printQr: 'Print table QR codes',
  },
  stations: {
    title: 'Stations',
    intro: 'Every till, desk and kitchen screen belongs to one branch.',
    register: 'Register this station',
    name: 'Station name',
    nameHint: 'Capital letters, digits and dashes, for example TILL-2.',
    mode: 'What it is',
    modes: { till: 'Till', desk: 'Court desk', kds: 'Kitchen screen' },
    branch: 'Branch',
    retire: 'Retire',
    retireConfirm: 'Retire {name}? It stops counting for offline mode and the day close. The name can be registered again later.',
    retired: 'Retired',
    lastSeen: 'Last seen {time}',
    never: 'Never seen',
  },
  staff: {
    branches: 'Branches',
    branchesHint: 'Where this person works. Someone at two branches picks one on every screen.',
    save: 'Save branches',
    owner: 'An owner works at every branch.',
  },
  reports: {
    scope: 'Branch',
    all: 'All branches',
    clockNote: 'All branches are shown on {name}’s clock and business day.',
  },
} as const;
