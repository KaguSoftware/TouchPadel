/**
 * prep workspace strings — owned by the prep lane. Mirror every key in prep.ar.ts.
 * The kitchen display reuses `op.kds.*` for the strings the e2e suite reads
 * (stale banner, "Waiting too long", Start / Ready / Complete, the LAN notices)
 * and `ws.kit.source.*` / `ws.kit.ticketState.*` for the shared vocabulary.
 */
export const prepEn = {
  title: 'Kitchen display',
  /** Header count of tickets that still need the kitchen. */
  open: '{count} open',
  empty: {
    title: 'No tickets — all caught up',
    body: 'Orders sent from the website or the café cashier appear here the moment they are placed.',
  },
  error: {
    title: 'Tickets could not be loaded',
    // Browser mode only: an Electron kitchen screen falls back to the till's
    // LAN feed instead of ever showing this panel, so the hint must not
    // promise that fallback.
    hint: 'Check this screen’s network connection. The board keeps trying by itself every 30 seconds.',
  },
  age: {
    fresh: 'On time',
    warm: 'Getting late',
    late: 'Late',
    /** A ticket over an hour old: minutes-and-seconds stop meaning anything. */
    hours: '{h}h {m}m',
    days: '{d}d',
  },
  /**
   * The one way off a wall board that otherwise has no navigation. Only
   * rendered for staff who hold another workspace — a prep-only account has
   * nowhere to go and never sees it.
   */
  exit: 'Leave kitchen display',
  ticket: {
    number: 'Ticket {n}',
    selected: 'Selected',
    itemsDone: '{done} of {total} ready',
    marksOffline: 'Ticking items comes back when the connection does.',
  },
  // Start / Ready / Complete are not here: every action button already shows
  // its own key, so the legend only lists the keys nothing else explains.
  keys: {
    legend: 'Keys',
    ticket: 'Pick a ticket',
    prevNext: 'Next ticket',
    items: 'Next item',
    toggle: 'Tick the item',
    clear: 'Deselect',
  },
  // F-57 (0396): a ticket completed by mistake comes back for ten minutes.
  recall: {
    title: 'Just completed',
    hint: 'Completed by mistake? Bring it back within 10 minutes.',
    action: 'Bring back',
    actionLabel: 'Bring back {tag}',
    ago: '{min} min ago',
    queued: 'Saved. The ticket comes back on the board when the connection does.',
  },
  // F-57 / F-11: the café cashier's local network link, while the screen works without the internet.
  lan: {
    linkDown: 'No internet and no link to the café cashier. New orders cannot reach this screen. Tell the cashier.',
    bumpLinkDown: 'Not saved: this screen has no link to the café cashier. Tell the cashier, then try again.',
    bumpNoStaff: 'Not saved: nobody is signed in at the café cashier. Ask the cashier to sign in, then try again.',
    bumpRefused: 'The café cashier did not take that change. Try again.',
  },
} as const;
