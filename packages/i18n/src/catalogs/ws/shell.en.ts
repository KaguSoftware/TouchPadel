/**
 * Workspace shell strings (spec §05): boot, sign-in, switcher, lock, rail.
 * Owned by the shell lane. Mirrored key-for-key in shell.ar.ts.
 */
export const shellEn = {
  boot: {
    title: 'Starting up',
    body: 'Signing you in and loading the venue’s settings…',
    failed: 'The app could not start.',
    retry: 'Try again',
  },
  signIn: {
    title: 'Staff sign-in',
    lead: 'Use your staff email and password.',
    submit: 'Sign in',
    invalid: 'That email and password do not match a staff account. Check both and try again.',
    disabled: 'This account has been turned off. Ask the owner to turn it back on.',
    network: 'The server could not be reached. Check this station’s network connection and try again.',
    tagline: 'More than a game',
    emailRequired: 'Enter your email.',
    passwordRequired: 'Enter your password.',
    capsLock: 'Caps Lock is on.',
    // The signed-in account has no active staff row. Not a crash: the app
    // started fine, the account just cannot use it.
    notStaffTitle: 'This account cannot use the staff app',
    notStaffBody: 'You are signed in as {email}, but that account is not set up as active staff. Ask the owner to add or turn on your account, then check again — or sign in with a different account.',
    checkAgain: 'Check again',
    otherAccount: 'Use a different account',
  },
  switcher: {
    title: 'Choose a workspace',
    lead: 'A workspace is the set of screens for one job. Pick the job you are doing now; you can come back here any time from Switch workspace in the sidebar.',
    current: 'You are here',
    open: 'Open',
    confirmTitle: 'Switch to {workspace}?',
    confirmBody: 'The sidebar will change to the {workspace} screens. Nothing on your current screen is lost; you can switch back from Switch workspace.',
    confirmLabel: 'Switch',
  },
  // The connectivity strip (rulebook 9.6). It answers one question — can this
  // station reach the server — so "ok" no longer promises anything about the
  // queue: writes made offline replay on reconnect, which is what `offline`
  // says, and the Day close screen is where unsynced writes are listed.
  status: {
    ok: 'Connected.',
    offline: 'Not connected — changes are saved here and will sync once the connection is back.',
  },
  // Named so RequireRole can hand the shared PermissionRefusedNotice a subject
  // instead of forking its own sentence. Reads as "{action} needs the {role}
  // role"; a verbal noun, so the Arabic template agrees with it.
  forbidden: {
    action: 'Opening this screen',
  },
  lock: {
    title: 'Station locked',
    // SEC-34. Shown when the account has no unlock PIN — most cashiers. Says
    // WHY the password is being asked for, so nobody thinks they have
    // forgotten a PIN they were never given.
    hintPassword: 'This account has no unlock PIN, so enter your password.',
    pin: 'Your PIN',
    unlock: 'Unlock',
    usePassword: 'Use password instead',
    usePin: 'Use PIN instead',
    // It signs the person out; the old "Switch user" did not say so.
    switchUser: 'Not {name}? Sign out',
    pinFirst: 'Type your PIN first.',
    passwordFirst: 'Type your password first.',
  },
  // Staff breaks (0105). The rail row, the break screen that covers the
  // station while somebody is away, and the cover hand-over.
  break: {
    goOnBreak: 'Go on break',
    // Under the rail button: how much of today's allowance is left.
    remainingToday: '{minutes} min left today',
    noneLeft: 'No break time left today',
    startTitle: 'Go on break',
    startLead: 'Your PIN starts the break. While you are away the station shows who can cover.',
    startAction: 'Start break',
    started: 'Break started.',
    // The break screen.
    onBreak: 'On break',
    away: 'Away for {time}',
    over: '{minutes} min over today’s allowance',
    back: 'I’m back',
    backNamed: '{name} is back',
    coverTitle: 'Cover this station',
    coverLead: 'Tap your name and enter your PIN to take the till over.',
    coverNone: 'Nobody can cover this station yet. The owner assigns cover staff under Staff.',
    pinFor: '{name}’s PIN',
    confirm: 'Confirm',
    chooseAgain: 'Back',
    // The rail while somebody else is at the till.
    covering: 'Covering',
    coveringFor: 'Covering for {name}',
    coverStarted: '{name} has the station.',
    endTitle: 'End the break',
    endLead: 'Your PIN ends the break and takes the station back.',
    endAction: 'End break',
    ended: 'Break ended. {minutes} min left today.',
    endedOver: 'Break ended, {minutes} min over today’s allowance.',
    // Idle lock while a cover is at the till.
    lockCovering: '{name} is covering this station. Enter their PIN to continue.',
    lockOwnerBack: 'Not {cover}? {name} is back',
  },
  workspace: {
    courtDesk: 'Court desk',
    cashier: 'Till',
    prep: 'Kitchen',
    manager: 'Operations',
    owner: 'Management',
    // Driver and marketing (0155): one rail row, My tasks, for now.
    team: 'Team',
  },
  // A section of a workspace with its own landing screen and its own rail
  // (lib/workspaces.ts). Management shows one button per section instead of
  // spilling all fourteen destinations into its own column.
  section: {
    financial: 'Financial',
    observation: 'Observe',
    stock: 'Stock',
    setup: 'Setup',
  },
  sectionLead: {
    financial: 'Money in, money out, and whether the cash agrees',
    observation: 'The floor now, the pattern behind it, and what is waiting on you',
    stock: 'On hand, deliveries, waste, counts and what the shelves are worth',
    setup: 'Staff, courts, tables and how the venue is configured',
  },
  workspaceLead: {
    courtDesk: 'Bookings, arrivals and customers',
    cashier: 'Orders, tabs and payment',
    prep: 'The ticket board the cooks work from',
    manager: 'Floor, stock, day close and reports',
    owner: 'The whole business in one place',
    team: 'Tasks and checklists given to you',
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
    analytics: 'Analytics',
    staff: 'Staff',
    courts: 'Courts',
    tables: 'Tables & QR',
    settings: 'Venue settings',
    guestSite: 'Guest site',
    // Financial section rows. The reports are one 'reports' row, with a tab
    // per report on the screen itself.
    menuPrices: 'Menu prices',
    // Stock section rows. 'inventory' owns the whole /stock module, which
    // keeps its own sub-nav; 'stockValue' is the /reports/stock figure.
    inventory: 'Inventory',
    stockValue: 'Stock value',
    // Observation section rows.
    floorNow: 'Floor now',
    staffActivity: 'Staff activity',
    requests: 'Requests',
    marketing: 'Marketing',
    telegram: 'Telegram',
    // The owner assistant: a rail row on Management's own list and the drawer
    // button in the rail footer share this label.
    assistant: 'Assistant',
    // The team workspace's one row (driver, marketing), and the till's and
    // the desk's last row.
    myTasks: 'My tasks',
    // Protocols and the staff suggestion box, on the manager's rail and in
    // Observe (build-contracts-2026-09-23 §5.1).
    protocols: 'Protocols',
    suggestions: 'Suggestions',
    // Wave 5, people records (wave5-addendum-2026-09-25 §5.2).
    deductions: 'Pay deductions',
    incidents: 'Incidents',
    // A rail row's count, for a screen reader: the pill itself is only a number.
    badge: '{count} waiting on you',
    groupOperations: 'Operations',
    groupRun: 'Run the day',
    groupRecords: 'Records',
    groupSetup: 'Setup',
    // The way out of a section rail, back to the workspace's own.
    backTo: 'Back to {workspace}',
    // The owner's rail puts 17 links and four controls before the routed
    // screen; without this every navigation costs up to 21 Tab presses.
    skipToMain: 'Skip to main content',
    // The four station controls — workspace, assistant, language,
    // appearance — live behind one rail row rather than four (owner call,
    // 2026-09-21), so the foot of the rail reads as one thing to press.
    // Sign out stays outside it: it ends the shift and is not a setting.
    // "Options", not "More" (owner call, 2026-09-21): "More" only says there
    // is something further down, which the chevron already says; the row
    // holds settings, and the key keeps its name so the testids and the
    // accordion wiring do not churn for a word.
    more: 'Options',
    moreMenu: 'Station controls',
    switchWorkspace: 'Switch workspace',
    // Both ways out of where you are — another workspace, or a section's own
    // workspace — ask first (owner call, 2026-09-18). {destination} is the
    // row's own label, so the dialog repeats the words that were pressed.
    leaveTitle: '{destination}?',
    leaveBody: 'You are about to leave this screen. Nothing here is lost; you can come back the same way.',
    leaveConfirm: 'Yes, go',
    language: 'العربية',
    languageAlt: 'English',
    // The appearance switch. Like `language`, each label names the appearance
    // the press takes you TO. Blue mode is the operator's "dark mode" — the
    // brand blue as the ground rather than a dark gray (owner call, 2026-09-19).
    blueMode: 'Blue mode',
    lightMode: 'Light mode',
    signOut: 'Sign out',
    // Sign out asks first (owner call, 2026-09-21). It is one press on the
    // rail foot, where fingers rest, and it ends the shift for whoever is on
    // the till — the same reason Quit and the two leave paths already ask.
    // The body names the consequence rather than asking "are you sure": the
    // till stays signed in to nothing, and the next person has to sign in.
    signOutTitle: 'Sign out?',
    signOutBody: 'This ends your session on this station. Anything already sent is safe; the next person will need to sign in.',
    // Same words as `signOut` above, deliberately its own key: that one names
    // the control on the rail, this one the button that carries the deed out.
    // Not "Yes, sign out" (owner call, 2026-09-21) — the confirm button says
    // the deed, so the words pressed on the rail come back on the button that
    // does it.
    signOutConfirm: 'Sign out',
    station: 'Station {id}',
    exitFullscreen: 'Exit forced full screen',
    quit: 'Quit to desktop',
    quitConfirm: 'This ends service on this station. Orders stop and the venue sees it go offline.',
    // Quit and Exit forced full screen on a locked station (owner call,
    // 2026-09-23): staff are kept inside the app, and the way out is somebody
    // else's manager PIN.
    leavePin: 'Manager PIN',
    leavePinHint: 'A manager other than you has to enter their PIN.',
    kitchenNoNav: 'Kitchen display',
    version: 'Version {version}',
    updateReady: 'Update ready',
    restartToUpdate: 'Restart to update to {version}',
  },
  // First-run station setup (main/first-run.ts): shown once per machine,
  // before sign-in, when station.json does not exist yet.
  setup: {
    title: 'Set up this station',
    modeTitle: 'What is this machine for?',
    lead: 'Pick one. This is done once on each machine.',
    // For whoever installed the app; staff never need it.
    changeLater: 'To change it later, remove station.json and restart the app.',
    mode: {
      till: 'Till',
      desk: 'Desk',
      kds: 'Kitchen screen',
    },
    modeLead: {
      till: 'Orders, tabs, payment and the receipt printer. Kitchen screens connect to it.',
      desk: 'Bookings, arrivals, customers and the office.',
      kds: 'The wall-mounted ticket board. Connects to the till with a code.',
    },
    stationId: 'Station name',
    stationIdHint: 'How this machine is named in the app and in reports. Capitals, digits and dashes, e.g. TILL-01',
    stationIdInvalid: 'Use capitals, digits and dashes, starting with a letter.',
    code: 'Pairing code from the till',
    codeHint: 'On the till, sign in as the owner, open Setup and choose Pair a kitchen screen, then enter a manager PIN. It shows this code.',
    codeInvalid: 'The code is 10 letters and digits.',
    advanced: 'Enter the till address yourself',
    hostLabel: 'Till address',
    advancedHint: 'Only needed if the search cannot find the till. The Pair a kitchen screen card in the till’s Setup shows it, e.g. 192.168.1.10',
    hostInvalid: 'Enter a local network address like 192.168.1.10.',
    scanning: 'Looking for the till on this network…',
    choose: 'More than one till answered. Pick the one for this kitchen.',
    notFound: {
      none: 'No till answered on this network. Check the till is switched on and on the same network, then search again — or enter its address.',
      badCode: 'A till answered but did not accept that code. Check the code on the till and type it again.',
      noLan: 'This machine is not on a local network. Connect it to the venue network, then search again.',
      unreachable: 'The till at {host} did not answer. It may just be switched off: save anyway and this screen keeps trying until it answers.',
    },
    find: 'Find the till',
    searchAgain: 'Search again',
    retypeCode: 'Type the code again',
    enterAddress: 'Enter the till address',
    saveAnyway: 'Save anyway',
    confirm: 'Finish setup',
    saving: 'Saving and restarting…',
    failed: 'The station could not be saved.',
    alreadyConfigured: 'This station is already set up. Restart the app.',
    configError: 'station.json could not be read: {error}',
    back: 'Back',
    retry: 'Try again',
  },
  // The till's pairing card (behind the manager PIN).
  pair: {
    title: 'Pair a kitchen screen',
    pinLead: 'A manager PIN shows the code a new kitchen screen needs to connect to this till.',
    reveal: 'Show the code',
    done: 'Done',
    step1: 'On the kitchen screen’s setup, choose Kitchen screen.',
    step2: 'Type this code:',
    code: 'Pairing code',
    host: 'If it cannot find this till, choose Enter the till address there and type {host}.',
    noHost: 'This till has no local network address yet; kitchen screens will find it once it is on the venue network.',
    customPsk: 'This till was set up with a custom key from the command line. Pair kitchen screens with the same --lan-psk flag.',
    notTill: 'Only a till can pair kitchen screens.',
    noPsk: 'This till has no pairing key. Remove station.json and set the station up again.',
  },
} as const;
