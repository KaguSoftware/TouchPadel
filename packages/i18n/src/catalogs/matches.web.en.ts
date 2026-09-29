/**
 * `matches.web`: the web invite page `/[locale]/m/[token]`
 * (docs/design/open-matches/guest.md §4.20). Owned by the web lane; spread
 * into matches.en.ts. Mirror every key in matches.web.ar.ts.
 *
 * DF-9 and GD-4: nothing here names a player, a price or an id. The seats-left
 * line is `matches.count.seatsLeft` through `countPhrase`, so 0 reads its `zero`
 * form. A third person comes in pairs `x` / `xF` (guest.md §4.24 rule 1):
 * English repeats the text, Arabic takes the feminine in a women-only match.
 */
export const matchesWebEn = {
  web: {
    // "Open match invite · Touch Padel" (the layout's title template).
    metaTitle: 'Open match invite',
    metaDescription: 'Join a padel match at Touch Padel.',
    // Shown in capitals by the stylesheet, so a screen reader says the words.
    eyebrow: 'Open match',
    // {weekday}, {date} and {time} come from the formatters, in the branch's timezone.
    when: '{weekday} {date} · {time}',
    category: {
      open: 'Open to all',
      women: 'Women only',
      men: 'Men only',
    },
    approve: 'The organiser approves each player',
    approveF: 'The organiser approves each player',
    full: 'This match is full',
    closed: 'This match is no longer open',
    error: "We couldn't load this match. Try again in a moment.",
    open: 'Open in the app',
    noApp: "Don't have the app?",
  },
};
