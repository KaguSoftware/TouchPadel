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
    // 0345: the owner unticked this page on the person's Access list.
    blocked: 'The owner has closed this page for you. Ask them if you need it.',
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
    // The Touch Shop desk (0243–0246).
    shop: 'Touch Shop',
  },
  // A section of a workspace with its own landing screen and its own rail
  // (lib/workspaces.ts). Management shows one button per section instead of
  // spilling all fourteen destinations into its own column.
  section: {
    // The page map (Sait, 2026-10-17): parts of the club, the same on both
    // rails. Courts and Café & shop have a key per rail (lib/workspaces.ts).
    money: 'Financial',
    courts: 'Courts',
    courtsDesk: 'Courts',
    cafe: 'Café & shop',
    cafeFloor: 'Café & shop',
    stock: 'Stock',
    team: 'Team',
    customers: 'Customers & marketing',
    settings: 'Settings',
  },
  sectionLead: {
    money: 'Sales, cash, wages and bills',
    courts: 'Bookings, court settings and coaches',
    courtsDesk: 'Bookings, court settings and coaches',
    cafe: 'Open tabs, the menu, table QR codes and the shop',
    cafeFloor: 'Open tabs, the menu, table QR codes and the shop',
    stock: 'What we have, deliveries, counts and costs',
    team: 'Staff, who is working, the staff inbox and protocols',
    customers: 'Customers, loyalty points, marketing and the guest app',
    settings: 'The club, branches, computers and the change history',
  },
  workspaceLead: {
    courtDesk: 'Bookings, arrivals and customers',
    cashier: 'Orders, tabs and payment',
    prep: 'The ticket board the cooks work from',
    manager: 'Floor, stock, day close and reports',
    owner: 'The whole business in one place',
    team: 'Tasks and checklists given to you',
    shop: 'The shop till, its drawer, stock and products',
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
    tills: 'Open tabs',
    dayClose: 'End of day count',
    menu: 'Menu',
    rates: 'Court prices',
    promotions: 'Discounts & offers',
    stock: 'Stock',
    reports: 'Reports',
    audit: 'Change history',
    panel: 'Overview',
    analytics: 'Trends',
    staff: 'Staff',
    branches: 'Branches',
    courts: 'Courts',
    tables: 'Table QR codes',
    settings: 'Venue settings',
    guestSite: 'Guest site',
    // Financial section rows. The reports are one 'reports' row, with a tab
    // per report on the screen itself.
    menuPrices: 'Menu prices',
    // Stock section rows: one per /stock screen (the same words as the
    // manager's sub-nav, op.stockNav), then 'stockValue', the /reports/stock
    // figure, and 'shop', the Touch Shop desk.
    onHand: 'What we have',
    goodsIn: 'Deliveries',
    moveStock: 'Move stock',
    wasteProduction: 'Waste & prep',
    expiry: 'Expiring soon',
    alerts: 'Running low',
    stockCount: 'Count stock',
    countDifferences: 'Missing or extra',
    margins: 'Profit per item',
    ingredients: 'Ingredients',
    recipes: 'Recipes',
    stockValue: 'Stock value',
    shop: 'Touch Shop',
    // The Touch Shop desk's own rail.
    shopTill: 'Sell',
    shopStock: 'Shop stock',
    shopReceive: 'Goods in',
    shopCounts: 'Stock count',
    shopProducts: 'Products',
    shopSuppliers: 'Suppliers',
    // Observation section rows.
    floorNow: 'Floor now',
    staffActivity: 'Who’s working',
    activityMonitor: 'Activity monitor',
    requests: 'Staff requests',
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
    suggestions: 'Staff ideas',
    // Wave 5, people records (wave5-addendum-2026-09-25 §5.2).
    deductions: 'Pay deductions',
    incidents: 'Incident reports',
    // Wages (0270–0272).
    wages: 'Wages',
    attendance: 'Late and early',
    // Staff rewards (0332–0333): beside Wages, where a reached bonus lands.
    rewards: 'Bonuses',
    safe: 'Main cash',
    // Coaching (docs/design/coaching/operator.md §5.3.3).
    coaches: 'Coaches',
    coachPay: 'Coach pay',
    // Tournaments (docs/design/tournaments/build-contracts-2026-10-03.md §1.11): the desk's list.
    tournaments: 'Tournaments',
    // Loyalty (docs/design/loyalty/build-contracts-2026-10-05.md §5): Setup's points, tiers and rewards.
    loyalty: 'Loyalty points',
    // Management rebuild (2026-10-17): the families' rows and their tabs
    // (lib/workspaces.ts). A tab's name is the page it opens.
    cash: 'Cash',
    pay: 'Pay',
    revenue: 'Money in',
    cafe: 'Cafe',
    menuItems: 'Menu items',
    categories: 'Menu groups',
    addons: 'Extras',
    suggested: 'Till suggestions',
    whoIsOn: 'Working now',
    whatTheyDid: 'What they did',
    campaigns: 'Posts & campaigns',
    lessonTypes: 'Lessons & prices',
    coachHours: 'Coach hours',
    lessonRules: 'Lesson rules',
    bookingRules: 'Booking rules',
    onlineDeposit: 'Online deposit',
    openMatches: 'Open matches',
    venue: 'Club details',
    venueDetails: 'Club details',
    openingHours: 'Opening hours',
    businessDay: 'Day start time',
    guestApp: 'Guest app',
    devices: 'Computers & tablets',
    stations: 'Till computers',
    kitchenScreens: 'Kitchen screens',
    offlineMode: 'No-internet mode',
    // A rail row's count, for a screen reader: the pill itself is only a number.
    badge: '{count} waiting on you',
    groupOperations: 'Operations',
    groupRun: 'Run the day',
    fromTeam: 'Staff inbox',
    stockMovement: 'Deliveries & waste',
    stockCounting: 'Stock counts',
    stockCosts: 'Recipes & costs',
    groupRecords: 'Records',
    groupSetup: 'Setup',
    // The way out of a section rail, back to the workspace's own.
    backTo: 'Back to {workspace}',
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
    // Under quitConfirm, only while the rail shows Update ready: quitting
    // installs it and the app then reopens by itself (main/updater.ts
    // installOnQuit). "ready", as the rail's control says it.
    quitInstallsUpdate: 'An update is ready. Quitting installs it, then the app opens again by itself.',
    // Quit and Exit forced full screen on a locked station (owner call,
    // 2026-09-23): staff are kept inside the app, and the way out is somebody
    // else's manager PIN.
    leavePin: 'Manager PIN',
    leavePinHint: 'A manager other than you has to enter their PIN.',
    // The owner leaves without a PIN, but the shell checks the role with the
    // server first; offline and never checked, it falls back to the PIN.
    leaveOwnerUnconfirmed: "Couldn't confirm you're the owner right now, so a manager's PIN is needed.",
    kitchenNoNav: 'Kitchen display',
    version: 'Version {version}',
    updateReady: 'Update ready',
    restartToUpdate: 'Restart to update to {version}',
    // The page map (2026-10-17): Court settings, the sales tabs, bills paid
    // from the main cash, and settings tabs that shared another page's name.
    courtSettings: 'Court settings',
    courtSales: 'Court sales',
    cafeSales: 'Café sales',
    billsSuppliers: 'Bills & suppliers',
    tournamentRules: 'Tournament rules',
    analyticsSettings: 'Trends settings',
    computersScreens: 'Computers & screens',
  },
  // Go to (Ctrl+G): one search over every page, tab and setting the person
  // may open in this workspace (components/GoToPalette.tsx). Ctrl+K is the
  // assistant's, so this is the Go To key of Office and VS Code.
  goTo: {
    open: 'Go to…',
    title: 'Go to',
    placeholder: 'Find a page or a setting',
    results: 'Pages and settings',
    none: 'Nothing matches “{query}”.',
    hint: 'Enter opens it. Esc closes.',
    shortcut: 'Ctrl+G',
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
      shop: 'Touch Shop desk',
    },
    modeLead: {
      till: 'Orders, tabs, payment and the receipt printer. Kitchen screens connect to it.',
      desk: 'Bookings, arrivals, customers and the office.',
      kds: 'The wall-mounted ticket board. Connects to the till with a code.',
      shop: 'The shop’s own PC: the shop till, its own drawer and receipts, the shop’s stock and products.',
    },
    stationId: 'Station name',
    stationIdHint: 'How this machine is named in the app and in reports. Capitals, digits and dashes, e.g. TILL-01',
    stationIdInvalid: 'Use capitals, digits and dashes, starting with a letter.',
    code: 'Pairing code from the till',
    codeHint: 'On the till, sign in as the owner, open Settings › Computers & screens › Kitchen screens and choose Pair a kitchen screen, then enter a manager PIN. It shows this code.',
    codeInvalid: 'The code is 10 letters and digits.',
    advanced: 'Enter the till address yourself',
    hostLabel: 'Till address',
    advancedHint: 'Only needed if the search cannot find the till. The till shows it under Settings › Computers & screens › Kitchen screens, e.g. 192.168.1.10',
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
