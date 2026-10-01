import { matchesCoreEn } from './matches.core.en';
import { matchesScreensEn } from './matches.screens.en';
import { matchesBookEn } from './matches.book.en';
import { matchesWalletEn } from './matches.wallet.en';
import { matchesWebEn } from './matches.web.en';

/**
 * `matches.*`: the guest app's open matches (docs/design/open-matches/guest.md
 * §4.24). Mirror every key in matches.ar.ts.
 *
 * Created with migration 0256 (the first code a player can meet,
 * GENDER_ALREADY_SET); every later commit adds the keys of the SQL it lands
 * (build contracts R11, R28).
 *
 * The other sub-namespaces live in one file pair per lane, so parallel lanes
 * never edit the same file (the ws/index.ts pattern), and are spread in here:
 * matches.core.* (common, count, states, link), matches.screens.* (list,
 * create, detail, report, blocks, messages, gender), matches.book.* (book),
 * matches.wallet.* (tickets, pay), matches.web.* (web).
 *
 * `errors.*` are the texts of the mobile CODE_TO_KEY entries
 * (apps/mobile/src/features/booking/errors.ts), copied from guest.md §4.22.
 */
export const matchesEn = {
  ...matchesCoreEn,
  ...matchesScreensEn,
  ...matchesBookEn,
  ...matchesWalletEn,
  ...matchesWebEn,
  errors: {
    genderAlreadySet: "That's already set. The front desk can change it.",
    // 0259: buying tickets.
    ticketCountInvalid: 'You can buy 1 to 3 tickets at a time.',
    walletLimit: 'You already hold as many unused tickets as you can. Use them in a match first.',
    off: "Open matches aren't available at this branch right now.",
    termsRequired: 'Accept the updated terms to use open matches.',
    banned: "Open matches aren't available on your account. Please contact the venue.",
    // 0260: the match core.
    genderRequired: "To play open matches, tell us once whether you're a woman or a man.",
    notFound: "This match isn't available.",
    needTickets: "You don't have enough tickets for this. Buy tickets to continue.",
    // NEED_TICKETS with its detail {needed, available, buy}; {tickets} is the
    // counted phrase for `buy` (guest.md §4.22).
    needTicketsCount: 'You need {tickets} more for this.',
    // 0261: the guest's open-match calls.
    closed: "This match isn't taking players any more.",
    full: 'This match is full.',
    slotFull: 'There are already as many open matches at this time as free courts. Join one of them instead.',
    tooLate: "It's too late to start an open match for this time. Pick a later time.",
    // MATCH_TOO_LATE with its detail (minutes of notice): {time} is now + those
    // minutes, rounded up to the next 30, in the branch's timezone.
    tooLateAt: 'Open matches need more notice. The earliest start now is {time}.',
    limitReached: "You already have as many open matches filling as you're allowed.",
    seatLimit: 'You can take up to 3 seats. The last seat is always for another player.',
    approvalRequired: 'The organiser approves each player in this match. Ask to join instead.',
    notApproval: 'Anyone can join this match. Join it directly.',
    alreadyIn: 'You already have a seat in this match.',
    genderMismatch: 'This match is for a different group of players.',
    unavailable: "You can't join this match.",
    timeClash: "You're already in another open match at this time.",
    booked: "The court is booked now, so the match can't be cancelled here. You can leave it, or call the venue.",
    notOrganiser: 'Only the organiser can do that.',
    requestClosed: 'This request was already answered or withdrawn.',
    requesterIneligible: "This request can't be approved right now. You can decline it.",
    requestLimit: 'You have too many requests waiting. Withdraw one or wait for an answer.',
    seatNotFound: "That seat isn't in this match any more.",
    seatHolderRequired: "Your friends' seats can't stay without yours. Leave all your seats instead.",
    seatStarted: 'The match has started. Please speak to the front desk.',
    reportTargetInvalid: "You can't report that player from this match.",
    blockTargetInvalid: "You can't block that player from here.",
    // A screen override, not a CODE_TO_KEY entry (§4.22): TERMS_REQUIRED on a
    // build whose CURRENT_TERMS_VERSION is already accepted.
    updateApp: 'Update the app to use open matches.',
  },
};
