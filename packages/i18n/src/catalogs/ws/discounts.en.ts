/**
 * `ws.discounts.*`: standing customer discounts on the operator (0342). A customer's own price
 * (sponsored players, family, coaches, staff): a café part and a court part, each a percent or
 * an IQD amount, set on the customer's record or at the close of a bill, never behind a manager
 * PIN. Owned by the operator lane; mirror every key in discounts.ar.ts.
 */
export const discountsEn = {
  /** The button beside the manager's Discount, and the bill dialog's title. */
  action: 'Customer discount',
  offline: 'Discounts need a connection.',
  reason: {
    sponsored: 'Sponsored',
    family: 'Family',
    coach: 'Coach',
    staff: 'Staff',
    other: 'Other',
  },
  part: {
    cafe: 'Café and shop',
    court: 'Court fee',
    cafeShort: 'Café',
    courtShort: 'Court',
  },
  editor: {
    none: 'None',
    percent: '%',
    amount: 'IQD',
    typeLabel: '{part}: discount type',
    valueLabel: '{part}: how much',
    percentPlaceholder: 'e.g. 20',
    amountPlaceholder: 'e.g. 5000',
    perBill: 'off each bill',
    perBooking: 'off each booking',
    reason: 'Reason',
    note: 'Note',
    notePlaceholder: 'e.g. Plays for the club team',
    errors: {
      empty: 'Enter how much.',
      percentRange: 'Enter a percent from 1 to 100.',
      amountRange: 'Enter an amount of at least 1 IQD.',
      parts: 'Set a discount on the café, the court fee, or both.',
      reason: 'Choose a reason.',
      note: 'Keep the note to 120 characters.',
    },
  },
  /** The section card on the customer record. */
  card: {
    title: 'Discount',
    none: 'No discount',
    noneLead: 'Sponsored, family or a coach? Set their price once and every bill carries it.',
    set: 'Set',
    change: 'Change',
    fullPrice: 'Full price',
    setBy: 'Set by {name} · {date}',
    someone: 'staff',
    badge: 'Discount · {reason}',
  },
  /** The dialog the card opens. */
  record: {
    title: 'Discount',
    lead: 'Every bill of theirs gets this, at every branch.',
    save: 'Save discount',
    remove: 'Remove discount',
    saved: 'Discount saved for {name}.',
    removed: 'Discount removed for {name}.',
    self: "You can't set a discount for yourself. Ask a colleague.",
  },
  /** At the close of a bill (till, shop, desk). */
  bill: {
    keep: 'Keep for {name} on every bill',
    keepHint: 'Saved on their record: every bill of theirs gets it from now on.',
    onceHint: 'This bill only. Their record stays as it is.',
    standing: 'On their record: {parts}',
    apply: 'Apply',
    remove: 'Remove from this bill',
    noCustomer: 'No customer on this bill yet.',
    noCustomerLead: 'Add the member to the bill first (Member, on the bill), then give the discount.',
    self: 'This is your own bill. A colleague has to give you a discount.',
    courtClosed: "The court discount can't change now: a bill of this booking was already paid with it.",
    nothing: 'This bill has nothing a discount can go on.',
    savedKeep: 'Saved for {name}. Every bill of theirs gets it.',
    savedOnce: 'Discount added to this bill.',
    removed: 'Discount taken off this bill.',
    /** The bill's row: "Customer discount · Coach · 20%". */
    row: 'Customer discount',
    once: 'This bill',
    /** Under the court fee, which already has it taken off. */
    courtNote: 'Includes {label}: {amount} off the court fee',
    /** "Remove from this bill" waived their standing discount here. */
    cafeWaived: 'Café at full price on this bill',
    courtWaived: 'Court fee at full price on this booking',
  },
};
