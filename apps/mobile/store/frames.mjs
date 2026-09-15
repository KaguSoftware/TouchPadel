/**
 * What each store frame says, in each listing language.
 *
 * TWO KINDS OF STRING LIVE HERE and they are not interchangeable:
 *
 *  1. `t` — UI text INSIDE the phone. Every key NOT in `DATA_KEYS` is copied
 *     verbatim from `packages/i18n/src/catalogs/{en,ar}.ts`, with its
 *     `{placeholders}` filled the way the app fills them. Do not write fresh UI
 *     copy here: if the screenshot says something the app does not say, the
 *     screenshot is a lie. `pnpm --filter @touch/mobile store:strings-check`
 *     fails when one of these stops matching a catalog value.
 *
 *     Keys in `DATA_KEYS` are the synthetic DATA a real account would show —
 *     dates, times, prices, counts' subjects, court names, the booking ref, the
 *     hold countdown. They have no catalog entry to match, so the check skips
 *     them; they are still produced the app's way (see "Formatting" below).
 *
 *  2. `eyebrow` / `headline` — MARKETING text on the poster around the phone.
 *     This is ours to write. It has no home in the app catalogs, but it must
 *     still be TRUE of the app (App Review 2.3.1).
 *
 * THE SCENARIO every frame shares, so nothing contradicts anything else:
 *   - "now" is Tuesday 22 September 2026, 9:41 AM Baghdad time;
 *   - the venue is Touch's own (packages/db/client-data/courts.sql): TWO
 *     courts, "Court 1" / "Court 2" ("الملعب الاول" / "الملعب الثاني"), 60 min
 *     the only bookable duration, open 09:00–02:00 every day (seed.sql);
 *   - cancellation window 4 h (venue_settings.cancellation_window_hours, pack
 *     policy.cancelNote); hold TTL 300 s (venue_settings.hold_ttl_seconds);
 *   - PRICES: Touch has sent no rate rules yet (both intake packs, NO_RATE), so
 *     the 60-minute prices are the dev fixtures' (packages/db/fixtures/courts.sql):
 *     40,000 IQD weekday before 17:00, 50,000 IQD weekday from 17:00,
 *     60,000 IQD Fri/Sat. Replace them once real rates exist.
 *
 * Formatting: `packages/i18n/src/formatting.ts` pins `en-IQ-u-nu-latn` /
 * `ar-IQ-u-nu-latn` and Asia/Baghdad. Run through Node's ICU (76) that gives
 * "Sep 24, 2026" / "24 أيلول 2026", "Thu" / "الخميس", "8:00 PM" / "8:00 م",
 * "50,000 IQD" (unit moved last by buildIQD) / "\u200f50,000 د.ع.\u200f". A time range is
 * isolated (FSI…PDI) exactly as formatTimeRange does, and so is the open-now
 * label (app/(tabs)/index.tsx OpenNowPill).
 */

const FSI = '\u2068';
const PDI = '\u2069';
const iso = (s) => `${FSI}${s}${PDI}`;
/** formatIQD('ar') output, bidi marks included (Intl emits them). */
const arIqd = (n) => `\u200f${n}\u00a0د.ع.\u200f`;

/**
 * Keys whose values are synthetic data, not catalog copy. Everything else in a
 * `t` object is checked against the catalogs by strings-check.mjs.
 */
export const DATA_KEYS = new Set([
  'statusTime',
  'days',
  'selectedDay',
  'slots',
  'courtA',
  'courtB',
  'holdCountdown',
  'holdPct',
  'vDate',
  'vTimeRange',
  'vPrice',
  'players',
  'heroWhen',
  'heroCount',
  'bookings',
  'venuePhone',
  'langActive',
  'appVersion',
  'build',
]);

/* ── English ───────────────────────────────────────────────────────────────── */

const tEn = {
  statusTime: '9:41',
  tabBook: 'Book',
  tabBookings: 'My Reservations',
  tabProfile: 'Profile',

  // Book tab — app/(tabs)/index.tsx
  appName: 'Touch Padel',
  openNow: `Open now · ${iso('09:00–02:00')}`,
  bookTitle: 'Book a court',
  checkAvailability: 'Check availability',
  reserveFooter: 'Reserve in the app · pay at the desk on arrival',

  // Availability — app/availability.tsx (Thu 24 Sep selected, weekday rates)
  availabilityTitle: 'Availability',
  duration60: '60 min',
  capacityFree: '2 courts free',
  capacityOne: '1 court left',
  stateBooked: 'Booked',
  availFooter: '2 courts per slot · your court is assigned at the desk',
  days: [
    { dow: 'Tue', num: '22' },
    { dow: 'Wed', num: '23' },
    { dow: 'Thu', num: '24' },
    { dow: 'Fri', num: '25' },
    { dow: 'Sat', num: '26' },
    { dow: 'Sun', num: '27' },
    { dow: 'Mon', num: '28' },
  ],
  selectedDay: 2,
  // [time, price | null (booked), free courts]
  slots: [
    ['9:00 AM', '40,000 IQD', 2],
    ['10:00 AM', '40,000 IQD', 2],
    ['11:00 AM', '40,000 IQD', 1],
    ['12:00 PM', '40,000 IQD', 2],
    ['1:00 PM', '40,000 IQD', 2],
    ['2:00 PM', null, 0],
    ['3:00 PM', '40,000 IQD', 2],
    ['4:00 PM', '40,000 IQD', 1],
    ['5:00 PM', '50,000 IQD', 1],
    ['6:00 PM', null, 0],
    ['7:00 PM', null, 0],
    ['8:00 PM', '50,000 IQD', 1],
    ['9:00 PM', '50,000 IQD', 2],
    ['10:00 PM', '50,000 IQD', 2],
    ['11:00 PM', '50,000 IQD', 2],
    ['12:00 AM', '50,000 IQD', 2],
    ['1:00 AM', '50,000 IQD', 2],
  ],

  // Review — app/review.tsx
  reviewTitle: 'Review & confirm',
  heldForYou: 'Slot held for you',
  holdCountdown: '4:31',
  holdPct: 91, // 271 s left of the ~297 s it mounted with
  holdExplainer:
    'Nobody else can take this slot while you check out. If the timer runs out, it goes back on the grid.',
  lDate: 'Date',
  lTime: 'Time',
  lDuration: 'Duration',
  lPrice: 'Price',
  courtA: 'Court 2',
  courtB: 'Court 1',
  vDate: 'Sep 24, 2026',
  vTimeRange: iso('8:00 PM–9:00 PM'),
  vPrice: '50,000 IQD',
  payAtDeskTitle: 'Pay at the desk',
  payAtDeskBody:
    'Your court is reserved now. You pay at reception when you arrive — there is no online payment in this app.',
  playersTitle: 'Players',
  playersOptional: 'Optional',
  playersOther: 'Other',
  players: 4,
  policyLine:
    'Free cancellation until 4 hours before your slot. Inside that window, changes are handled by the desk. Repeated no-shows may limit app booking.',
  reserveCta: 'Reserve court',

  // Success — app/success.tsx
  successTitle: 'Court reserved',
  refLabel: 'REF TP-7C3E',
  successPayBody:
    "Show up, check in at reception and pay there. We'll send a reminder before your slot.",
  viewBooking: 'View booking',
  done: 'Done',

  // My reservations — app/(tabs)/bookings.tsx
  myBookings: 'My reservations',
  upcoming: 'Upcoming',
  upcomingCount: '4 upcoming',
  playedCount: '12 played',
  cancelledCount: '1 cancelled',
  nextUp: 'Next up',
  startsInDays: 'In 2 days',
  statusConfirmed: 'Confirmed',
  heroWhen: 'Thu · Sep 24, 2026',
  heroCount: '4',
  bookings: [
    { mon: 'Sep', day: '26', court: 'Court 1', dow: 'Sat', range: iso('6:00 PM–7:00 PM'), price: '60,000 IQD' },
    { mon: 'Sep', day: '29', court: 'Court 2', dow: 'Tue', range: iso('8:00 PM–9:00 PM'), price: '50,000 IQD' },
    { mon: 'Sep', day: '30', court: 'Court 1', dow: 'Wed', range: iso('7:00 PM–8:00 PM'), price: '50,000 IQD' },
  ],

  // Settings — app/settings.tsx
  settingsTitle: 'Settings',
  appearance: 'Appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  language: 'Language',
  english: 'English',
  arabic: 'العربية',
  langActive: 'en',
  languageNote: 'Switching to العربية flips the whole app right-to-left, instantly.',
  notifications: 'Notifications',
  notifGranted: 'Enabled — booking confirmations, reminders and cancellations.',
  sendTestPush: 'Send a test notification',
  venue: 'Venue',
  venuePhone: '00995419010203',
  call: 'Call',
  about: 'About',
  privacyPolicy: 'Privacy policy',
  support: 'Support',
  appVersion: '1.0.0',
  build: '9',
  versionLine: 'Touch Padel · v1.0.0 (9)',
};

/* ── Arabic ────────────────────────────────────────────────────────────────── */

const tAr = {
  statusTime: '9:41',
  tabBook: 'احجز',
  tabBookings: 'حجوزاتي',
  tabProfile: 'حسابي',

  appName: 'تتش بادل',
  openNow: `مفتوح الآن · ${iso('09:00–02:00')}`,
  bookTitle: 'احجز ملعبًا',
  checkAvailability: 'عرض الأوقات المتاحة',
  reserveFooter: 'احجز من التطبيق · وادفع عند الاستقبال لدى وصولك',

  availabilityTitle: 'الأوقات المتاحة',
  duration60: '60 دقيقة',
  capacityFree: '2 ملاعب متاحة',
  capacityOne: 'بقي ملعب واحد',
  stateBooked: 'محجوز',
  availFooter: '2 ملاعب لكل وقت · يُحدَّد ملعبك عند الاستقبال',
  days: [
    { dow: 'الثلاثاء', num: '22' },
    { dow: 'الأربعاء', num: '23' },
    { dow: 'الخميس', num: '24' },
    { dow: 'الجمعة', num: '25' },
    { dow: 'السبت', num: '26' },
    { dow: 'الأحد', num: '27' },
    { dow: 'الاثنين', num: '28' },
  ],
  selectedDay: 2,
  slots: [
    ['9:00 ص', arIqd('40,000'), 2],
    ['10:00 ص', arIqd('40,000'), 2],
    ['11:00 ص', arIqd('40,000'), 1],
    ['12:00 م', arIqd('40,000'), 2],
    ['1:00 م', arIqd('40,000'), 2],
    ['2:00 م', null, 0],
    ['3:00 م', arIqd('40,000'), 2],
    ['4:00 م', arIqd('40,000'), 1],
    ['5:00 م', arIqd('50,000'), 1],
    ['6:00 م', null, 0],
    ['7:00 م', null, 0],
    ['8:00 م', arIqd('50,000'), 1],
    ['9:00 م', arIqd('50,000'), 2],
    ['10:00 م', arIqd('50,000'), 2],
    ['11:00 م', arIqd('50,000'), 2],
    ['12:00 ص', arIqd('50,000'), 2],
    ['1:00 ص', arIqd('50,000'), 2],
  ],

  reviewTitle: 'المراجعة والتأكيد',
  heldForYou: 'الوقت محجوز لك',
  holdCountdown: '4:31',
  holdPct: 91,
  holdExplainer:
    'لا يمكن لأحد أخذ هذا الوقت أثناء إكمالك الحجز. إذا انتهى الوقت يعود متاحًا للجميع.',
  lDate: 'التاريخ',
  lTime: 'الوقت',
  lDuration: 'المدة',
  lPrice: 'السعر',
  courtA: 'الملعب الثاني',
  courtB: 'الملعب الاول',
  vDate: '24 أيلول 2026',
  vTimeRange: iso('8:00 م–9:00 م'),
  vPrice: arIqd('50,000'),
  payAtDeskTitle: 'الدفع عند الاستقبال',
  payAtDeskBody:
    'ملعبك محجوز الآن. تدفع في الاستقبال عند وصولك — لا يوجد دفع إلكتروني في هذا التطبيق.',
  playersTitle: 'اللاعبون',
  playersOptional: 'اختياري',
  playersOther: 'أخرى',
  players: 4,
  policyLine:
    'إلغاء مجاني حتى 4 ساعات قبل موعدك. بعد ذلك تُدار التغييرات عبر الاستقبال. قد يؤدي تكرار عدم الحضور إلى تقييد الحجز من التطبيق.',
  reserveCta: 'حجز الملعب',

  successTitle: 'تم حجز الملعب',
  refLabel: 'المرجع TP-7C3E',
  successPayBody: 'احضر وسجّل وصولك في الاستقبال وادفع هناك. سنرسل لك تذكيرًا قبل موعدك.',
  viewBooking: 'عرض الحجز',
  done: 'تم',

  myBookings: 'حجوزاتي',
  upcoming: 'القادمة',
  upcomingCount: '4 قادم',
  playedCount: '12 مباراة',
  cancelledCount: '1 ملغاة',
  nextUp: 'التالي',
  startsInDays: 'خلال 2 يوم',
  statusConfirmed: 'مؤكد',
  heroWhen: 'الخميس · 24 أيلول 2026',
  heroCount: '4',
  bookings: [
    { mon: 'أيلول', day: '26', court: 'الملعب الاول', dow: 'السبت', range: iso('6:00 م–7:00 م'), price: arIqd('60,000') },
    { mon: 'أيلول', day: '29', court: 'الملعب الثاني', dow: 'الثلاثاء', range: iso('8:00 م–9:00 م'), price: arIqd('50,000') },
    { mon: 'أيلول', day: '30', court: 'الملعب الاول', dow: 'الأربعاء', range: iso('7:00 م–8:00 م'), price: arIqd('50,000') },
  ],

  settingsTitle: 'الإعدادات',
  appearance: 'المظهر',
  themeSystem: 'النظام',
  themeLight: 'فاتح',
  themeDark: 'داكن',
  language: 'اللغة',
  english: 'English',
  arabic: 'العربية',
  langActive: 'ar',
  languageNote: 'التبديل إلى English يقلب اتجاه التطبيق كاملًا من اليسار إلى اليمين فورًا.',
  notifications: 'الإشعارات',
  notifGranted: 'مفعّلة — تأكيدات الحجز والتذكيرات والإلغاءات.',
  sendTestPush: 'إرسال إشعار تجريبي',
  venue: 'المكان',
  venuePhone: '00995419010203',
  call: 'اتصال',
  about: 'حول التطبيق',
  privacyPolicy: 'سياسة الخصوصية',
  support: 'الدعم',
  appVersion: '1.0.0',
  build: '9',
  versionLine: 'تتش بادل · الإصدار 1.0.0 (9)',
};

/* ── the frames ────────────────────────────────────────────────────────────── */

/**
 * Order matters: App Store Connect shows them in exactly this sequence, and
 * frame 1 is the only one most people ever see (it is the one that appears in
 * search results). It carries the single sentence the app has to land: you can
 * book a court from your phone.
 *
 * Frame 1 used to say "in three taps". A signed-in guest actually takes FOUR:
 * Check availability → a time → Reserve court → the confirmation alert's
 * Reserve court (review.tsx ConfirmAlert). So the count is gone rather than
 * wrong.
 */
const framesEn = [
  {
    slug: '1-book',
    screen: 'book',
    eyebrow: 'Live court availability',
    headline: ['Book a court', 'from your phone.'],
  },
  {
    slug: '2-availability',
    screen: 'availability',
    eyebrow: 'Every slot, every day',
    headline: ["See what's free", 'before you drive.'],
  },
  {
    slug: '3-review',
    screen: 'review',
    eyebrow: 'Nobody can take it',
    headline: ['Your slot is held', 'while you decide.'],
  },
  {
    slug: '4-success',
    screen: 'success',
    eyebrow: 'No card, no online payment',
    headline: ['Pay at the desk.', "That's it."],
  },
  {
    slug: '5-bookings',
    screen: 'bookings',
    eyebrow: 'Upcoming · played · cancelled',
    headline: ['Every game', 'in one place.'],
  },
  {
    slug: '6-settings',
    screen: 'settings',
    eyebrow: 'English and Arabic',
    headline: ['Fully Arabic,', 'right to left.'],
  },
];

const framesAr = [
  {
    slug: '1-book',
    screen: 'book',
    eyebrow: 'الأوقات المتاحة مباشرة',
    headline: ['احجز ملعبك', 'من هاتفك.'],
  },
  {
    slug: '2-availability',
    screen: 'availability',
    eyebrow: 'كل وقت، كل يوم',
    headline: ['اعرف المتاح', 'قبل أن تتحرك.'],
  },
  {
    slug: '3-review',
    screen: 'review',
    eyebrow: 'لا أحد يأخذ وقتك',
    headline: ['نحجز لك الوقت', 'ريثما تُكمل.'],
  },
  {
    slug: '4-success',
    screen: 'success',
    eyebrow: 'بلا بطاقة وبلا دفع إلكتروني',
    headline: ['ادفع عند', 'الاستقبال فقط.'],
  },
  {
    slug: '5-bookings',
    screen: 'bookings',
    eyebrow: 'القادمة · المباريات · الملغاة',
    headline: ['كل مبارياتك', 'في مكان واحد.'],
  },
  {
    slug: '6-settings',
    screen: 'settings',
    eyebrow: 'بالعربية والإنجليزية',
    headline: ['عربي بالكامل،', 'من اليمين لليسار.'],
  },
];

export const LOCALES = {
  en: { dir: 'ltr', t: tEn, frames: framesEn },
  ar: { dir: 'rtl', t: tAr, frames: framesAr },
};

/**
 * Output sizes.
 *
 * Apple takes ONE iPhone size now (6.9") and downscales it for every smaller
 * device, so `iphone-6.9` is the only required set. `iphone-6.5` is kept because
 * an App Store Connect listing created before the consolidation can still be
 * holding a 6.5" slot that has to be filled or emptied deliberately.
 * `play-phone` is Google Play's phone screenshot, same art, different frame.
 */
export const SIZES = {
  'iphone-6.9': { width: 1290, height: 2796, deviceWidth: 900 },
  'iphone-6.5': { width: 1242, height: 2688, deviceWidth: 866 },
  'play-phone': { width: 1080, height: 1920, deviceWidth: 700 },
};
