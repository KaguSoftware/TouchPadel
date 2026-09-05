/**
 * Workspace shell strings (spec §05): boot, sign-in, switcher, lock, rail.
 * Owned by the shell lane. Mirrored key-for-key in shell.ar.ts.
 */
export const shellEn = {
  boot: {
    title: 'Starting up',
    body: 'Loading your session, permissions and venue settings.',
    failed: 'The app could not start.',
    retry: 'Try again',
  },
  signIn: {
    title: 'Staff sign-in',
    lead: 'Sign in with your staff account.',
    submit: 'Sign in',
    invalid: 'Email or password is incorrect.',
    disabled: 'This account has been disabled. Ask the owner.',
    network: 'The server could not be reached. Check the connection and try again.',
    tagline: 'More than a game',
  },
  switcher: {
    title: 'Choose a workspace',
    lead: 'Your account holds more than one role. Pick where to work; you can switch any time.',
    current: 'Current',
    open: 'Open',
  },
  // The healthy rung of the connectivity strip (rulebook 9.6). The other three
  // read op.status.*; only "normal" had no string at all, because the banner
  // used to render nothing when everything was fine.
  status: {
    ok: 'Connected — nothing waiting to sync.',
  },
  // Named so RequireRole can hand the shared PermissionRefusedNotice a subject
  // instead of forking its own sentence. Reads as "{action} needs the {role}
  // role"; a verbal noun, so the Arabic template agrees with it.
  forbidden: {
    action: 'Opening this screen',
  },
  lock: {
    title: 'Station locked',
    hint: 'Signed in as {name}. Unlock to continue where you left off.',
    pin: 'Your PIN',
    unlock: 'Unlock',
    usePassword: 'Use password instead',
    switchUser: 'Switch user',
  },
  workspace: {
    courtDesk: 'Court desk',
    cashier: 'Till',
    prep: 'The pass',
    manager: 'Operations',
    owner: 'Management',
  },
  workspaceLead: {
    courtDesk: 'Bookings, arrivals and customers',
    cashier: 'Orders, tabs and payment',
    prep: 'Kitchen display',
    manager: 'Floor, stock, day close and reports',
    owner: 'The whole business in one place',
  },
  nav: {
    today: 'Today',
    calendar: 'Calendar',
    customers: 'Customers',
    newSeries: 'New series',
    blockCourt: 'Block court',
    till: 'Till',
    openTabs: 'Open tabs',
    cashDrawer: 'Cash drawer',
    overview: 'Overview',
    bookings: 'Bookings',
    tills: 'Tills',
    dayClose: 'Day close',
    menu: 'Menu',
    rates: 'Rates',
    promotions: 'Promotions',
    stock: 'Stock',
    reports: 'Reports',
    audit: 'Audit log',
    panel: 'Management panel',
    analytics: 'Cafe analytics',
    staff: 'Staff',
    courts: 'Courts',
    tables: 'Tables & QR',
    settings: 'Venue settings',
    guestSite: 'Guest site',
    groupOperations: 'Operations',
    groupSetup: 'Setup',
    // The owner's rail puts 17 links and four controls before the routed
    // screen; without this every navigation costs up to 21 Tab presses.
    skipToMain: 'Skip to main content',
    switchWorkspace: 'Switch workspace',
    language: 'العربية',
    languageAlt: 'English',
    signOut: 'Sign out',
    station: 'Station {id}',
    quit: 'Quit to desktop',
    kitchenNoNav: 'Kitchen display',
  },
} as const;
