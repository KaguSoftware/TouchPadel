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
    title: 'No active tickets — all caught up',
    body: 'Orders sent from the website or the till appear here the moment they are placed.',
  },
  error: {
    title: 'The ticket queue could not be loaded',
    hint: 'Check the network. While the connection is down, tickets still reach this screen from the till over the local network.',
  },
  age: {
    fresh: 'On time',
    warm: 'Ageing',
    late: 'Late',
  },
  ticket: {
    number: 'Ticket {n}',
    selected: 'Selected',
    itemsDone: '{done} of {total} ready',
    marksOffline: 'Item marks return when the connection is back.',
  },
  keys: {
    legend: 'Keyboard',
    ticket: 'Select ticket',
    prevNext: 'Previous / next ticket',
    items: 'Previous / next item',
    toggle: 'Mark item ready',
    start: 'Start',
    ready: 'Ready',
    complete: 'Complete',
    clear: 'Clear selection',
  },
} as const;
