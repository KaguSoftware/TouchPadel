/**
 * `tournaments.guest`: the phone's tournament screens (the list, the detail, the refusals and
 * the two pushes; build contracts §1.10, §1.11). Owned by the phone lane; spread into
 * tournaments.en.ts. Mirror every key in tournaments.guest.ar.ts.
 *
 * Counts read as "Places left: 3", a label and a figure, so no line needs the six Arabic number
 * forms.
 */
export const tournamentsGuestEn = {
  guest: {
    // The Book sheet's row and Profile's row (plan §5.2 entry points).
    entry: {
      book: 'Tournaments',
      mine: 'My tournaments',
    },
    list: {
      title: 'Tournaments',
      upcoming: 'Upcoming',
      mine: 'Mine',
      emptyTitle: 'Nothing here yet',
      empty: 'No tournaments coming up.',
      emptyMine: 'You have not entered a tournament yet.',
      off: 'Tournaments are not running at any branch right now.',
      error: 'The tournaments could not be loaded.',
      placesLeft: 'Places left: {count}',
      waitlistOnly: 'Waitlist open',
      full: 'Full',
    },
    detail: {
      title: 'Tournament',
      when: 'When',
      branch: 'Branch',
      placesLeft: 'Places left',
      entries: 'Players entered',
      closes: 'Registration closes {time}',
      schedule: 'Schedule',
      standings: 'Standings',
      waitlistPosition: 'Number {position} on the waitlist',
      notFound: 'This tournament is not available.',
      registered: 'You are registered.',
      waitlisted: 'You are on the waitlist. A place that opens up goes to the first in line.',
      noShow: 'You were marked as not showing up.',
      closedNote: 'Registration has closed.',
      fullNote: 'This tournament and its waitlist are full.',
      cancelledNote: 'This tournament was cancelled.',
      finishedNote: 'This tournament has finished.',
      scheduleLater: 'The schedule appears here once play begins.',
      court: 'Court {no}',
      sitOut: 'Sitting out: {names}',
      vs: 'vs',
      rank: '#',
      player: 'Player',
      pointsWon: 'Pts',
      diff: '+/−',
      played: 'Played',
      // 0311 (c27): a standing whose entry left the play (withdrew or did not show).
      withdrawn: '{name} (left)',
      withdrawTitle: 'Withdraw from this tournament?',
      withdrawBody:
        'Withdrawing is free until registration closes. Your place goes to the waitlist.',
      withdrawWaitlistBody: 'You leave the waitlist.',
      withdrawConfirm: 'Withdraw',
      keep: 'Keep my place',
      registeredToast: 'You are registered.',
      waitlistedToast: 'You are on the waitlist.',
      withdrawnToast: 'You have withdrawn.',
      refundAtDesk: 'You have withdrawn. Collect {amount} at the desk.',
    },
    register: 'Register',
    waitlist: 'Join the waitlist',
    withdraw: 'Withdraw',
    owedAtDesk: 'Pay {amount} at the desk on the day',
    // The details a refusal carries (build contracts §1.9), read before the catalogue's line.
    errors: {
      notOpenCutoff: 'Registration closed at the cut-off.',
      withdrawCutoff:
        'Registration has closed, so you can no longer withdraw in the app. The desk can take you off.',
      notOpenStatus: 'Registration for this tournament is not open now.',
      categoryMismatch: 'This tournament is for another category of players.',
      full: 'This tournament and its waitlist are full.',
      notFound: 'This tournament is no longer available.',
      off: 'Tournaments are switched off at this branch.',
      entryNotFound: 'You are not entered in this tournament.',
    },
    push: {
      cancelled: 'The tournament was cancelled.',
      promoted: 'A place opened up: you are in.',
    },
  },
};
