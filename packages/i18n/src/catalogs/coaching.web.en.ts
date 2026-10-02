/**
 * `coaching.web`: the website's coaching words (docs/design/coaching/guest.md §4.14, §4.15):
 * the `/[locale]/coaching` page, the `/[locale]/c/[id]` "Open in the app" page and the landing's
 * coaches strip. Owned by the web lane; spread into coaching.en.ts. Mirror every key in
 * coaching.web.ar.ts.
 *
 * C-11: the page shows coaches, lesson types and sessions with places left; prices only where the
 * branch's `lesson_prices_public` switch is on (the parser drops them otherwise, so no key here
 * can print one by accident). No student, phone or count of people by name.
 *
 * Counted phrases are the phone's `coaching.common.count.*` (guest.md §4.15, one copy): the web
 * reads them with `countPhrase` (packages/i18n/src/plural.ts).
 */
export const coachingWebEn = {
  web: {
    // "Padel coaching · Touch Padel" (absolute, built by the page).
    metaTitle: 'Padel coaching',
    metaDescription:
      "Private lessons, group sessions and courses with Touch Padel's coaches in Karbala. Book in the app.",
    // The two-line display of the landing: "COACHING / AT TOUCH".
    titleOne: 'Coaching',
    titleTwo: 'at Touch',
    intro:
      'Private lessons, group sessions and courses with our coaches. Pick a coach and a time in the app.',
    coachesTitle: 'Our coaches',
    typesTitle: 'Lessons',
    sessionsTitle: 'Upcoming sessions with places',
    kind: {
      private: 'Private lessons',
      group: 'Group sessions',
      course: 'Courses',
    },
    // {duration} is `count.minutes`; {people}, {places} and {sessions} are counted phrases.
    privateLine: '{duration} · up to {people}',
    groupLine: '{duration} · {places}',
    courseLine: '{sessions} · {duration} each',
    // {price} is formatIQD. "From" on a coach card: the lowest price they teach at.
    from: 'From {price}',
    pricePrivate: '{price} a lesson',
    pricePlace: '{price} a place',
    priceCourse: '{price} for the course',
    // {weekday}, {date} and {time} come from the formatters, in the branch's timezone.
    when: '{weekday} {date} · {time}',
    courseStarts: 'Starts {date} · {sessions}',
    courseNext: 'Next session {date} · {sessionsLeft}',
    withCoach: 'with {coach}',
    bookInApp: 'Book in the app',
    getApp: 'Get the app',
    appBody: 'Lessons are booked in the Touch Padel app.',
    error: "We couldn't load the coaches. Try again in a moment.",
    landing: {
      body: 'Private lessons, group sessions and courses with our coaches. Book in the Touch Padel app, or ask us on WhatsApp.',
      cta: 'Meet the coaches',
      coachesLabel: 'Our coaches',
    },
    link: {
      // The /c/<id> page: "Lessons with {name} · Touch Padel" when found.
      metaTitle: 'Lessons with {name}',
      title: 'Book a lesson',
      eyebrow: 'Padel coach',
      // {branches}: the branch names, joined with " · ".
      at: 'At {branches}',
      typesTitle: 'Lessons',
      open: 'Open in the app',
      noApp: "Don't have the app?",
      allCoaches: 'See all coaches',
      notFound: "This coach isn't taking bookings online right now.",
      error: "We couldn't load this page. Try again in a moment.",
    },
  },
};
