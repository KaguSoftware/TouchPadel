/**
 * `staff.clock.*`: starting and finishing work from the staff phone (0442;
 * docs/design/clock-in/contracts-2026-11-15.md). The work card at the top of
 * Today and the clock page (app/(staff)/staff-clock.tsx): the location and
 * camera steps, the scan, and what the server answered. Every refusal says
 * why and what to do next. Mirror every key in clock.ar.ts.
 */
export const staffClockEn = {
  /** Today's card. */
  card: {
    notStarted: 'Not started yet',
    /** `{time}` is when the accepted start was scanned. */
    atWorkSince: 'At work since {time}',
    start: 'Start work',
    finish: 'Finish work',
    /** At work, a shift running now. `{role}` is the job, `{time}` its end. */
    onAs: 'On as {role} until {time}',
    /** The next shift starts as this one ends, in another job. */
    onAsThen: 'On as {role} until {time}, then {next}',
    /** Not started, though a shift is running. */
    shiftNow: 'Your shift: {role} until {time}',
    shiftNowThen: 'Your shift: {role} until {time}, then {next}',
    /** At work between shifts, or with no hours set. */
    noShiftNow: 'No shift running now',
    /** Today's shifts, one line: "Today: Waiter 10 → 3 PM · Cashier 3 → 6 PM". */
    today: 'Today: {list}',
    /** One shift in that line. */
    shift: '{role} {range}',
    noHoursToday: 'No hours set for today',
    notReady: 'Logging your hours is not set up at this branch yet. Please ask a manager.',
    loadFailed: 'Your hours did not load.',
    retry: 'Try again',
  },
  /** The page's bar. */
  title: {
    in: 'Start work',
    out: 'Finish work',
  },
  checking: 'Checking…',
  /** Each step before the camera opens. */
  steps: {
    location: {
      title: 'Allow location',
      body: 'Touch Padel checks that you are at the club when you start or finish work. It reads your location only at that moment, never in the background.',
      action: 'Allow location',
    },
    locationBlocked: {
      title: 'Location is off for Touch Padel',
      body: 'Without it the app cannot check that you are at the club. In Settings, set Location to "While using the app", then come back.',
    },
    locationApprox: {
      title: 'Turn on precise location',
      body: 'Your phone shares only an approximate location with Touch Padel, which cannot show that you are at the club. In Settings, turn on Precise Location, then come back.',
    },
    servicesOff: {
      title: 'Your phone’s location is off',
      body: 'Turn on Location in your phone’s settings, then press Try again.',
      /** Android: the system's own switch. */
      turnOn: 'Turn on location',
    },
    camera: {
      title: 'Allow the camera',
      body: 'The camera scans the QR code on the desk screen. Nothing is recorded or saved.',
      action: 'Allow camera',
    },
    cameraBlocked: {
      title: 'The camera is off for Touch Padel',
      body: 'Turn on the camera for Touch Padel in Settings, or type the 6 digits shown under the QR code.',
    },
    openSettings: 'Open Settings',
    tryAgain: 'Try again',
  },
  scan: {
    hint: 'Point the camera at the QR code on the desk screen.',
    typeInstead: 'Type the 6 digits instead',
    scanInstead: 'Scan the QR code instead',
    locating: 'Finding your location…',
    /** `{accuracy}` is "±12 m". */
    located: 'Location found ({accuracy})',
  },
  type: {
    label: 'The 6 digits under the QR code',
    hint: 'They change every 30 seconds, so type the ones on the screen now.',
    send: 'Send',
    invalid: 'Type all 6 digits shown under the QR code.',
  },
  sending: {
    locating: 'Getting your location…',
    sending: 'Checking…',
  },
  locationFailed: {
    title: 'Your location was not found',
    body: 'Go near a window or outside for a moment, then try again.',
  },
  result: {
    /** `{time}` is the server's time of the scan. */
    started: 'Started at {time}',
    finished: 'Finished at {time}',
    late: {
      zero: 'On time',
      one: '1 min late',
      two: '2 min late',
      few: '{count} min late',
      many: '{count} min late',
      other: '{count} min late',
    },
    early: {
      zero: 'Left on time',
      one: 'Left 1 min early',
      two: 'Left 2 min early',
      few: 'Left {count} min early',
      many: 'Left {count} min early',
      other: 'Left {count} min early',
    },
    done: 'Done',
  },
  /** One per app.clock_punch refusal, in the order it checks. */
  refused: {
    TOO_MANY_TRIES: {
      title: 'Too many tries',
      body: 'This phone was refused several times in the last hour. Wait a while before trying again, or ask a manager.',
    },
    NO_PLACE: {
      title: 'Not set up at this branch yet',
      body: 'Logging your hours is not set up here yet. Please ask a manager.',
    },
    NO_STATION: {
      title: 'Not set up at this branch yet',
      body: 'No desk screen here shows the QR code yet. Please ask a manager.',
    },
    WRONG_DEVICE: {
      title: 'This is not your work phone',
      body: 'Your hours are logged from one phone, and this is a different one. A manager can reset it so this phone works.',
    },
    LOCATION_STALE: {
      title: 'Your location was out of date',
      body: 'Keep this page open while it checks, then try again.',
    },
    MOCK_LOCATION: {
      title: 'A fake location is on',
      body: 'This phone is using a fake-location app or setting. Turn it off, then try again.',
    },
    LOCATION_ROUGH: {
      title: 'Your location is not precise enough',
      /** `{accuracy}` is "±150 m". */
      body: 'It is only accurate to {accuracy}. Go near a window or outside, wait a few seconds, then try again.',
    },
    NOT_HERE: {
      title: 'You are not at the club',
      /** `{distance}` is "850 m" or "3.2 km". */
      body: 'Your phone is about {distance} away. You can start or finish work only at the club.',
    },
    CODE_WRONG: {
      title: 'That code did not work',
      body: 'The code changes every 30 seconds, or it is not from this branch’s desk. Scan the QR code again.',
    },
    ALREADY_IN: {
      title: 'You have already started',
      body: 'Your start is already logged. Finish work when you leave.',
    },
    NOT_IN: {
      title: 'You have not started yet',
      body: 'There is no start to finish. Start work first.',
    },
  },
  /** A binary built before the camera and location modules. */
  update: {
    title: 'Update the app to log your hours',
    body: 'This version of Touch Padel cannot scan the desk QR code. Update the app from the store, then try again.',
  },
  actions: {
    scanAgain: 'Scan again',
    tryAgain: 'Try again',
    back: 'Back to Today',
  },
  error: {
    title: 'It did not go through',
  },
  units: {
    m: '{n} m',
    km: '{n} km',
    accuracy: '±{n} m',
  },
} as const;
