/**
 * `site.*` — the public Touch Padel website: the club's home page at /{locale}, the site
 * header and footer that also frame the legal pages, the 404 and the error page.
 *
 * The page presents THE CLUB, not the app (owner, 2026-09-23: "I asked for a customer
 * facing website"): the courts and the feel of playing there, lessons, tournaments and events,
 * Touch Cafe, the first visit, and where to find it. Booking today is WhatsApp, a call or
 * walking in; the app gets one short band.
 *
 * Voice (docs/brand/touch-padel-style-reference.md §11): confident, athletic, direct;
 * verbs first; the deck's two-weight headlines where the page is loud, plain sentences
 * where it informs. No em dashes in this file.
 *
 * The name is the idea (Majed, 2026-09-27): padel, like one-touch football, comes down to
 * one touch of the ball. The slogan is "It’s all in one touch." (Arabic «اللعبة لمسة
 * واحدة.»), and the loud lines play on touch here and there: the hero, the club, lessons,
 * the app band, the footer, the 404. Lines that inform stay plain; so does "Play. Smash.
 * Win.", the deck's own. A changed headline means re-measuring its block's --tp-fit
 * (styles/site/*.css.ts). Latin display lines are written in
 * sentence case and set in capitals by CSS, so Arabic (which has no case) never inherits
 * an uppercase transform.
 *
 * Only facts the owner has confirmed (2026-09-23): the club is in Durrat Karbala, Karbala;
 * two indoor courts; the hours (always interpolated from venue_settings_public, never
 * typed, and no line says "late" or "every day" unless the live window says so); rackets
 * and balls to rent; lockers; lessons (no levels, format or coach to promise); tournaments
 * and events (running now, owner 2026-09-25); pay at the desk. Not confirmed, so absent: prices, durations, court features beyond
 * "indoor", court names, what to wear, minimum age, changing rooms, social handles.
 *
 * Placeholders: {hours} a display window like "09:00–02:00" (each time bidi-isolated by
 * lib/site/hours.ts), {categories} a locale-joined list of café category names, {count}
 * (`hoursCount`, which /terms uses for its cancellation window), {time}, {year}.
 */
export const siteEn = {
  skipToContent: 'Skip to content',
  brandHome: 'Touch Padel, home',
  nav: {
    label: 'Main',
    club: 'The club',
    lessons: 'Lessons',
    menu: 'Café menu',
    visit: 'Visit',
    book: 'Book a court',
    // The small-screen button that opens the section links (not the café's menu).
    toggle: 'Site menu',
    language: 'العربية',
    languageLabel: 'Read this page in Arabic',
  },
  theme: {
    toNight: 'Switch to night mode',
    toLight: 'Switch to light mode',
  },
  hours: {
    openNow: 'Open now',
    closedNow: 'Closed now',
    opensAt: 'Opens {time}',
    everyDay: 'Every day',
  },
  // A count of hours as a phrase, by the locale's plural rules (Intl.PluralRules; English
  // has one and other, Arabic all six). lib/site/plural.ts picks the form.
  // `one` and `two` spell the number out, as Arabic's «ساعة واحدة» and «ساعتين» do (the
  // catalogs' placeholders must match key for key; English never picks `two`).
  hoursCount: {
    zero: '{count} hours',
    one: 'one hour',
    two: 'two hours',
    few: '{count} hours',
    many: '{count} hours',
    other: '{count} hours',
  },
  // Said after a button that opens WhatsApp but does not say so itself ("Book a court").
  onWhatsApp: ', on WhatsApp',
  // The WhatsApp message each button pre-fills (the guest can edit it before sending).
  whatsapp: {
    court: 'Hi Touch Padel, I would like to book a court.',
    lesson: 'Hi Touch Padel, I would like to book a lesson.',
    events: "Hi Touch Padel, I'd like to sign up for the next tournament. Can you send me the details?",
    // The events ticket, once the visitor has written their name on it.
    eventsNamed:
      "Hi Touch Padel, this is {name}. I'd like to sign up for the next tournament. Can you send me the details?",
    general: 'Hi Touch Padel,',
  },
  hero: {
    lineOne: 'It’s all in',
    lineTwo: 'one touch',
    // No hours here: the open-now pill right above it carries them.
    lead: 'A padel club and café in Durrat Karbala, with two indoor courts.',
    ctaWhatsApp: 'Book on WhatsApp',
    ctaCall: 'Call the desk',
    ctaVisit: 'Plan your visit',
  },
  club: {
    titleOne: 'Every point,',
    titleTwo: 'one touch.',
    body: 'Book a slot and make every touch count.',
    pointIndoor: 'Two indoor courts',
    pointRent: 'Rackets and balls to rent at the desk',
    pointLockers: 'Lockers for your things',
    courtLabel: 'A 3D padel court behind glass, four rackets keeping a rally going.',
    courtCta: 'Book a court',
  },
  lessons: {
    titleOne: 'Your first touch?',
    titleTwo: 'Start here.',
    body: 'We run lessons at Touch. Message us on WhatsApp with when you can play, and we will tell you what is available.',
    cta: 'Ask about lessons',
  },
  events: {
    label: 'Play. Smash. Win.',
    play: 'Play',
    smash: 'Smash',
    win: 'Win',
    eyebrow: 'Tournaments are on at Touch',
    title: 'Grab a partner. Grab a pass.',
    body: 'Tournaments and events are running at Touch, where one touch can decide a final. Message us on WhatsApp to get into the next one.',
    cta: 'Join a tournament',
    // The entry pass (components/landing/EventsTicket.tsx). What the visitor "writes" on it
    // (you, your rival, your level, and their name) is set in the handwriting face.
    ticket: {
      brand: 'Touch Padel',
      admit: 'Admit one pair',
      titleOne: 'Tournament',
      titleTwo: 'entry',
      player1: 'Player 1',
      player2: 'Player 2',
      you: 'You',
      rival: 'Your rival',
      category: 'Category',
      level: 'Your level',
      venue: 'Venue',
      venueName: 'Touch',
      nameLabel: 'Your name',
      namePlaceholder: 'Write it here',
      nameHint: 'We add it to your WhatsApp message.',
      nameLocked: 'Signed. Your pass is torn.',
      tear: 'Tear here · Send to enter',
    },
  },
  cafe: {
    titleOne: 'Before the game.',
    titleTwo: 'After it.',
    body: 'Touch Cafe is part of the club. No queue at the counter: your table has a code, and your phone is the menu.',
    stepsLabel: 'How to order',
    step1Title: 'Take a table',
    step1Body: 'Courtside or inside, before your game or after it.',
    step2Title: 'Scan the code on it',
    step2Body: 'Your phone’s camera opens the menu for your table. No app to install.',
    step3Title: 'Send your order with one touch',
    step3Body: 'Pick, send, and get back to your game. The café knows which table it’s for.',
    // The drawings' own labels (hidden from screen readers; the steps say it in words).
    artTable: 'Table 4',
    artScan: 'Scan the code',
    artBasket: '2 items',
    cta: 'Open the menu',
  },
  app: {
    titleOne: 'Your court, a touch away.',
    titleTwo: 'Soon.',
    // The three things the app will do, each shown on its own real screen. The eyebrows
    // and lines are the app's own store captions (apps/mobile/store/frames.mjs).
    liveEyebrow: 'Every slot, every day',
    liveTitle: 'See what’s free before you drive.',
    liveAlt: 'The app’s Availability screen: the days of the week and every time that is still free.',
    holdEyebrow: 'Nobody can take it',
    holdTitle: 'Your slot is held while you decide.',
    holdAlt: 'The app’s Review and confirm screen: the slot held for you, with the timer counting down.',
    placeEyebrow: 'Upcoming · played · cancelled',
    placeTitle: 'Every game in one place.',
    placeAlt: 'The app’s My reservations screen: the next game first, then every upcoming booking.',
    body: 'Until then, book on WhatsApp or call the desk.',
    downloadOnAppStore: 'Download on the App Store',
    getItOnGooglePlay: 'Get it on Google Play',
    // A store badge before its listing exists: dimmed, not a link, tagged "Soon".
    soon: 'Soon',
    appStoreSoon: 'App Store, coming soon',
    googlePlaySoon: 'Google Play, coming soon',
  },
  faq: {
    title: 'Your first visit',
    lead: 'The seven things everyone asks the desk before their first game.',
    askTitle: 'Still wondering?',
    askCta: 'Ask the desk',
    bookQ: 'How do I book a court?',
    bookA: 'Message us on WhatsApp, call the front desk, or walk in while we are open.',
    payQ: 'How do I pay?',
    payA: 'At the front desk when you arrive. If you book in the app, you may be able to pay a deposit first with Qi Card.',
    racketQ: 'I do not have a racket. Can I still play?',
    racketA: 'Yes. Rackets and balls are available to rent at the desk.',
    lockersQ: 'Is there somewhere to leave my things?',
    lockersA: 'Yes, there are lockers at the club.',
    beginnerQ: 'I have never played padel. Is that a problem?',
    beginnerA: 'Not at all. Every player starts with a first touch, and we run lessons. Ask us on WhatsApp.',
    cancelQ: 'What if I need to cancel?',
    cancelA: 'Message or call the front desk as early as you can.',
    hoursQ: 'When are you open?',
    hoursA: 'Every day, {hours}.',
    // Only when the live window closes after midnight (lib/site/hours.ts crossesMidnight).
    hoursALate: 'Every day, {hours}. We stay open past midnight.',
    hoursANoHours: 'Message us on WhatsApp or call the front desk for today’s hours.',
  },
  visit: {
    titleOne: 'Find us',
    titleTwo: 'in Karbala.',
    address: 'Durrat Karbala, Karbala, Iraq',
    addressTitle: 'Address',
    maps: 'Open in Google Maps',
    hoursTitle: 'Hours',
    contactTitle: 'Talk to us',
    whatsapp: 'WhatsApp',
    call: 'Call the desk',
    walkIn: 'Or just walk in while we are open.',
  },
  // Alt text for the page's photographs. Stock placeholders until Touch's own photos
  // arrive (docs/design/web-site/photo-credits.md): describe what is IN the frame, never
  // claim it is Touch's venue.
  photos: {
    heroAlt:
      'A padel player in black bends low to play the ball on a blue court under dark lighting.',
    clubAlt:
      'The net of an empty indoor padel court, with blue turf and mesh-and-glass walls behind it.',
    lessonsAlt:
      'A padel player in a dark top watches the ball as she lines up a shot on an indoor court.',
    eventsAlt: 'Two padel players shake hands on a blue court at night.',
  },
  footer: {
    tagline: 'It’s all in one touch.',
    hoursTitle: 'Hours',
    phoneTitle: 'Front desk',
    whatsapp: 'WhatsApp',
    addressTitle: 'Find us',
    exploreTitle: 'Touch Padel',
    legalTitle: 'Legal',
    lessons: 'Lessons',
    menu: 'Café menu',
    support: 'Support',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    deleteAccount: 'Delete account',
    copyright: '© {year} Touch Padel',
    developedBy: 'Developed by Kagu',
  },
  notFound: {
    title: 'Out of bounds',
    body: 'That touch went wide: this page is not on the court. Head back to the start, or open the café menu.',
    home: 'Back to Touch Padel',
    menu: 'Café menu',
  },
  error: {
    title: 'This page did not load.',
    body: 'Something went wrong on our side. Try again, or go back to the home page.',
    retry: 'Try again',
    home: 'Back to Touch Padel',
  },
  // /{locale}/pay/return, where Qi's payment page sends the guest's browser back
  // (docs/design/payments/qi-deposit-plan-2026-09-20.md §6). The page cannot know how
  // the payment went, so no string here may state or hint at a result: never "paid",
  // "success" or the like (page.test.tsx checks both catalogs). The app says it.
  payReturn: {
    metaTitle: 'Back to the app',
    title: 'Return to the Touch Padel app to see your booking',
    body: 'The app has the latest on your booking. If it did not open by itself, use the button below.',
    open: 'Open the app',
    noApp: 'Don’t have the app?',
  },
  seo: {
    title: 'Touch Padel · Padel club and café in Karbala',
    // The one description: the page, the layout default, the manifest and the JSON-LD.
    description:
      'A padel club and café in Durrat Karbala, Karbala. Two indoor courts, lessons and Touch Cafe. Book on WhatsApp, call the desk or walk in.',
    ogAlt: 'Touch Padel. It’s all in one touch.',
    menuTitle: 'Menu · Touch Cafe',
  },
};
