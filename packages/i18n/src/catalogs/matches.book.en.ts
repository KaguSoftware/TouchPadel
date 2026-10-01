/**
 * `matches.book`: open matches on the Book tab (docs/design/open-matches/guest.md
 * §4.11). Owned by the mobile Book-tab lane; spread into matches.en.ts. Mirror
 * every key in matches.book.ar.ts.
 *
 * Counts arrive already phrased: `{seats}` is `count.seatsLeft`, `{matches}`
 * is `count.openMatches` or `count.openMatchesSoon` (`countPhrase`, which
 * LTR-isolates the digits), `{taken}` is `common.seatsOf` ("3/4").
 */
export const matchesBookEn = {
  book: {
    // The choice sheet on a free time. `{time}` is formatTime, `{day}` the weekday and date.
    choiceTitle: '{time} · {day}',
    // Shown only when "Start an open match" is one of the buttons.
    choiceMessage:
      "Book the whole court, or start an open match: it waits for four players and books the court once it's full.",
    join: 'Join the open match · {seats}',
    // Several matches share the time: the button opens the list at that time.
    joinSeveral: 'Join an open match · {matches}',
    viewMine: 'Your open match',
    bookCourt: 'Book the court',
    start: 'Start an open match',
    // The chip on a free time's cell, one per time (§4.11 rule 5).
    chipJoin: '{seats} · Join',
    chipWomen: 'Women · {seats}',
    chipMen: 'Men · {seats}',
    chipMine: 'Your match · {taken}',
    // The entry row under the courts.
    entryJoin: '{matches} · Join',
    entry: 'Open matches',
    entrySignIn: 'Open matches · Sign in',
  },
};
