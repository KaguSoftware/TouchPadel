/**
 * English message catalog — the source of truth for the catalog SHAPE.
 * `ar.ts` must mirror every key (enforced by the `Messages` type).
 *
 * Interpolation placeholders use single braces: {name}, {phone}, {count}.
 */
export const en = {
  common: {
    appName: 'Touch Padel',
    cafeName: 'Touch Cafe',
    ok: 'OK',
    cancel: 'Cancel',
    confirm: 'Confirm',
    back: 'Back',
    next: 'Next',
    save: 'Save',
    close: 'Close',
    retry: 'Try again',
    loading: 'Loading…',
    today: 'Today',
    total: 'Total',
    subtotal: 'Subtotal',
    discount: 'Discount',
    yes: 'Yes',
    no: 'No',
  },
  auth: {
    signIn: 'Sign in',
    signUp: 'Create account',
    signOut: 'Sign out',
    // SOW: email + password with verification — phone/OTP login is out of scope for Phase 1.
    emailLabel: 'Email',
    passwordLabel: 'Password',
    placeholder: 'you@example.com',
    forgotPassword: 'Forgot password?',
    verifyEmailSent: 'We sent a verification link to {email}. Check your inbox.',
    resetEmailSent: 'We sent a password reset link to {email}.',
    invalidCredentials: 'Email or password is incorrect.',
    pinPrompt: 'Manager PIN required',
    pinInvalid: 'Incorrect PIN.',
    sessionExpired: 'Your session has expired. Please sign in again.',
  },
  courts: {
    title: 'Courts',
    placeholder: 'Live availability grid coming soon — courts load here.',
  },
  operator: {
    appName: 'Touch Padel — Operator',
    home: 'Choose a view from the navigation.',
  },
  till: { title: 'Till' },
  desk: { title: 'Desk calendar' },
  kds: { title: 'Kitchen display' },
  stock: { title: 'Stock' },
  admin: { title: 'Admin' },
  booking: {
    title: 'Book a court',
    court: 'Court',
    date: 'Date',
    time: 'Time',
    duration: 'Duration',
    durationMinutes: '{minutes} min',
    pricePerSlot: '{price} per slot',
    holdExpiresIn: 'Your slot is held for {minutes} minutes',
    confirmBooking: 'Confirm booking',
    confirmed: 'Booking confirmed — see you on court!',
    cancelled: 'Booking cancelled.',
    payAtDesk: 'Payment is taken at the front desk.',
    slotTaken: 'Sorry, that slot has just been taken. Please pick another time.',
    myBookings: 'My bookings',
    noBookings: 'You have no upcoming bookings.',
  },
  cafe: {
    menu: 'Menu',
    addToOrder: 'Add to order',
    yourOrder: 'Your order',
    placeOrder: 'Place order',
    orderPlaced: 'Order sent — it is on its way to the kitchen.',
    orderStatus: 'Order status',
    statusReceived: 'Received',
    statusPreparing: 'Preparing',
    statusReady: 'Ready',
    statusDelivered: 'Delivered',
    callWaiter: 'Call a waiter',
    waiterCalled: 'A member of staff is on their way.',
    waiterAlreadyCalled: 'Staff have already been notified for this table.',
    tableLabel: 'Table {table}',
    itemUnavailable: 'This item is currently unavailable.',
    notesPlaceholder: 'Any notes for the kitchen?',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'No connection. Check your internet and try again.',
    notFound: 'We could not find what you were looking for.',
    forbidden: 'You do not have permission to do that.',
    tooManyRequests: 'Too many attempts. Please wait a moment and try again.',
    sessionTableExpired: 'This table session has expired. Please scan the QR code again.',
    validation: 'Please check the highlighted fields and try again.',
  },
  degraded: {
    // Contractual degraded-mode UX (SOW "Degraded mode" acceptance):
    // mobile shows the venue phone; web directs the guest to a member of staff.
    bookingRefused:
      'Online booking is temporarily unavailable. Please call the venue at {phone} to book.',
    bookingRefusedShort: 'Online booking is temporarily unavailable.',
    orderingRefused: 'Online ordering is temporarily paused. Please see a member of staff to order.',
    waiterCallRefused:
      'The call button is temporarily unavailable. Please see a member of staff.',
    readOnlyNotice: 'You can still browse — new requests are paused for a moment.',
    tillBanner: 'Offline — orders are being queued ({count} waiting to sync).',
    tillBannerSynced: 'Back online — all queued items have synced.',
    dayCloseBlocked: 'The day cannot be closed while {count} items are still unsynced.',
  },
} as const;

/**
 * Deep shape of the catalog with all leaves widened to `string`,
 * so `ar.ts` can carry different literals while matching every key.
 */
export type Messages = DeepMessages<typeof en>;

type DeepMessages<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepMessages<T[K]>;
};
