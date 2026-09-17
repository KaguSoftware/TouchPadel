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
    body: 'Orders sent from the website or the till appear here the moment they are placed.',
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
} as const;
