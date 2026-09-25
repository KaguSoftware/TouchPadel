/**
 * `site.*` — the public Touch Padel website: the club's home page at /{locale}, the site
 * header and footer that also frame the legal pages, the 404 and the error page.
 *
 * The page presents THE CLUB, not the app (owner, 2026-09-23: "I asked for a customer
 * facing website"): the courts and the feel of playing there, lessons, events (coming),
 * Touch Cafe, the first visit, and where to find it. Booking today is WhatsApp, a call or
 * walking in; the app gets one short band.
 *
 * Voice (docs/brand/touch-padel-style-reference.md §11): confident, athletic, direct;
 * verbs first; the deck's two-weight headlines where the page is loud, plain sentences
 * where it informs. No em dashes in this file. Latin display lines are written in
 * sentence case and set in capitals by CSS, so Arabic (which has no case) never inherits
 * an uppercase transform.
 *
 * Only facts the owner has confirmed (2026-09-23): the club is in Durrat Karbala, Karbala;
 * two indoor courts; the hours (always interpolated from venue_settings_public, never
 * typed, and no line says "late" or "every day" unless the live window says so); rackets
 * and balls to rent; lockers; lessons (no levels, format or coach to promise); tournaments
 * and events coming; pay at the desk. Not confirmed, so absent: prices, durations, court features beyond
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
    events: 'Hi Touch Padel, please add me to the list for tournaments and events.',
    general: 'Hi Touch Padel,',
  },
  hero: {
    lineOne: 'Touch is',
    lineTwo: 'a lifestyle',
    // No hours here: the open-now pill right above it carries them.
    lead: 'A padel club and café in Durrat Karbala, with two indoor courts.',
    ctaWhatsApp: 'Book on WhatsApp',
    ctaCall: 'Call the desk',
    ctaVisit: 'Plan your visit',
  },
  club: {
    titleOne: 'Pure game,',
    titleTwo: 'perfect touch.',
    body: 'Book a slot and play.',
    pointIndoor: 'Two indoor courts',
    pointRent: 'Rackets and balls to rent at the desk',
    pointLockers: 'Lockers for your things',
    courtLabel: 'A 3D padel court behind glass, four rackets keeping a rally going.',
    // The rally's pause switch (WCAG 2.2.2): one name, its state is aria-pressed.
    courtPause: 'Pause the rally',
    courtCta: 'Book a court',
  },
  lessons: {
    titleOne: 'New to padel?',
    titleTwo: 'Start here.',
    body: 'We run lessons at Touch. Message us on WhatsApp with when you can play, and we will tell you what is available.',
    cta: 'Ask about lessons',
  },
  events: {
    label: 'Play. Smash. Win.',
    play: 'Play',
    smash: 'Smash',
    win: 'Win',
    comingSoon: 'Coming soon',
    title: 'Tournaments are coming to Touch.',
    body: 'Tournaments and events are on the way. Join the list on WhatsApp and be the first to know.',
    cta: 'Join the list',
  },
  cafe: {
    titleOne: 'Before the game.',
    titleTwo: 'After it.',
    // {categories} is the whole live list; `bodyMore` when it was cut short.
    body: 'Touch Cafe is part of the club, serving {categories}. Scan the code on your table and order from your phone.',
    bodyMore:
      'Touch Cafe is part of the club, serving {categories} and more. Scan the code on your table and order from your phone.',
    bodyNoCategories:
      'Touch Cafe is part of the club. Scan the code on your table and order from your phone.',
    cta: 'Open the menu',
  },
  app: {
    title: 'Booking in the app. Soon.',
    body: 'The Touch Padel app is on its way: see free courts live, hold a slot while you confirm, and keep every booking in one place. Until then, book on WhatsApp or call the desk.',
    downloadOnAppStore: 'Download on the App Store',
    getItOnGooglePlay: 'Get it on Google Play',
  },
  faq: {
    title: 'Your first visit',
    bookQ: 'How do I book a court?',
    bookA: 'Message us on WhatsApp, call the front desk, or walk in while we are open.',
    payQ: 'How do I pay?',
    payA: 'At the front desk when you arrive. There is no online payment.',
    racketQ: 'I do not have a racket. Can I still play?',
    racketA: 'Yes. Rackets and balls are available to rent at the desk.',
    lockersQ: 'Is there somewhere to leave my things?',
    lockersA: 'Yes, there are lockers at the club.',
    beginnerQ: 'I have never played padel. Is that a problem?',
    beginnerA: 'Not at all. We run lessons. Ask us on WhatsApp.',
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
    heroAlt: 'A padel player in black bends low to play the ball on a blue court under dark lighting.',
    clubAlt: 'The net of an empty indoor padel court, with blue turf and mesh-and-glass walls behind it.',
    lessonsAlt: 'A padel player in a dark top watches the ball as she lines up a shot on an indoor court.',
    cafeAlt: 'A cappuccino with latte art on a saucer, on a dimly lit café table.',
    eventsAlt: 'Two padel players shake hands on a blue court at night.',
  },
  footer: {
    tagline: 'Touch is a lifestyle.',
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
    body: 'This page is not on the court. Head back to the start, or open the café menu.',
    home: 'Back to Touch Padel',
    menu: 'Café menu',
  },
  error: {
    title: 'This page did not load.',
    body: 'Something went wrong on our side. Try again, or go back to the home page.',
    retry: 'Try again',
    home: 'Back to Touch Padel',
  },
  seo: {
    title: 'Touch Padel · Padel club and café in Karbala',
    // The one description: the page, the layout default, the manifest and the JSON-LD.
    description:
      'A padel club and café in Durrat Karbala, Karbala. Two indoor courts, lessons and Touch Cafe. Book on WhatsApp, call the desk or walk in.',
    ogAlt: 'Touch Padel. Touch is a lifestyle.',
    menuTitle: 'Menu · Touch Cafe',
  },
};
