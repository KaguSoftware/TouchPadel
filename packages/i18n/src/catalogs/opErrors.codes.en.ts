/**
 * `op.errors.<CODE>` for the codes that reached people as "Something went
 * wrong" until the one error catalogue (packages/i18n/src/errors.ts, 2026-10-01)
 * mapped every code a migration raises. Spread at the end of `op.errors` in
 * en.ts; mirror every key in opErrors.codes.ar.ts.
 *
 * Every app reads these keys through `errorMessageKey`, so the wording names no
 * app and fits whoever meets the code: a guest for TOO_MANY_ORDERS,
 * TOO_MANY_ITEMS, CONFIRMATION_REQUIRED, SERIES_NOT_FOUND and VERSION_INVALID,
 * staff or the owner for the rest. Each line says what happened and what to do,
 * from the code's latest `raise exception` site and its hint.
 */
export const opErrorsCodesEn = {
  // The till: payments, discounts, splits and merges.
  TENDER_CARD: 'Cash given and change are for cash payments only.',
  DISCOUNT_REQUIRES_REFUND:
    'More has been paid than the bill would be after this discount. Refund the difference first.',
  OVERRIDE_REQUIRES_REFUND:
    'More has been paid than the bill would be after this price change. Refund the difference first.',
  REFUND_QTY_EXCEEDS_LINE: 'That is more than was sold on this line. Lower the quantity.',
  TAB_MOVED: 'This line just moved to another bill. Refresh and try again.',
  MERGE_SELF: 'A bill cannot be merged into itself. Choose another bill.',
  DONOR_HAS_PAYMENTS: 'The bill you are merging already has payments. Settle or refund it first.',
  INVALID_SPLIT: 'That split is not valid. Start the split again.',
  ITEM_ASSIGNED_TWICE:
    'An item is in more than one part of the split. Put each item in one part only.',
  SPLIT_INCOMPLETE: 'Every item has to go into a part of the split. Assign the rest.',
  // Migration 0106's one-off check (never raised by an RPC).
  DUPLICATE_LIVE_BOOKING_TABS:
    'Some bookings have more than one open bill. Merge or settle the extra bills first.',
  // The kitchen.
  TICKET_CLOSED: 'This ticket is already finished, so its items cannot change.',
  // The desk: bookings and series.
  RESERVATION_MOVED: 'This booking was just changed. Refresh and try again.',
  RESERVATION_NOT_STARTED:
    'This booking has not started yet, so it cannot be marked completed or a no-show. You can cancel it instead.',
  SERIES_NOT_FOUND: 'This series of bookings cannot be found.',
  SERIES_EMPTY:
    'No booking would be made: no date in that range fits, or every date was skipped. Change the dates or how it repeats.',
  SERIES_TOO_LONG: 'A series can have at most 200 bookings. Shorten the dates.',
  SERIES_UNRESOLVED_CONFLICTS:
    'One of the dates cannot be booked because it is taken, closed, outside opening hours or has no price. Skip that date or move it to another court.',
  INVALID_PATTERN: 'Choose how the series repeats: every week, every 2 weeks or chosen days.',
  INVALID_RESOLUTION: 'A clashing date can only be skipped or moved to another court.',
  INVALID_SCOPE: 'Choose whether to cancel only the bookings still to come, or all of them.',
  // Customers: the desk's new-customer form, flags and notes.
  AUTH_USER_NOT_FOUND: 'The customer’s account was not created. Try again.',
  INVALID_LANG: 'Choose English or Arabic.',
  NAME_LENGTH: 'A name must be 1 to 80 characters.',
  NOTE_LENGTH: 'A note must be 1 to 2000 characters.',
  NOTE_NOT_FOUND: 'That note no longer exists. Refresh the page.',
  INVALID_FLAG: 'That flag cannot be set here.',
  DUPLICATE_FLAG: 'Each flag can be added only once.',
  LABEL_LENGTH: 'A flag’s label can be at most 120 characters.',
  // Ordering from the table (0211's limits on guest orders).
  TOO_MANY_ORDERS:
    'Too many orders in a short time. Please wait a moment, or ask a member of staff.',
  TOO_MANY_ITEMS:
    'This order has too many items. Send the rest as another order, or ask a member of staff.',
  // Account and terms (the guest).
  CONFIRMATION_REQUIRED: 'Confirm that you want to delete your account, then try again.',
  VERSION_INVALID: 'The terms could not be accepted. Update the app and try again.',
  // Menu, courts and rates admin.
  DUPLICATE_ID: 'The new sort order lists something twice. Refresh and try again.',
  INVALID_SELECT_RANGE:
    'The minimum number of choices cannot be more than the maximum, and the maximum must be at least 1.',
  INVALID_SERVE_TEMP: 'Choose how it is served: none, hot, cold or both.',
  TAX_GROUP_NOT_FOUND: 'That tax group no longer exists. Choose another.',
  RULE_NOT_FOUND: 'That rate rule no longer exists. Refresh the page.',
  CODE_GENERATION_FAILED: 'A new code could not be made. Try again.',
  // Stock.
  BATCH_EMPTY: 'Nothing is left in this batch to write off.',
  INVALID_MOVEMENT: 'Choose spill or spoilage as the kind of waste.',
  ALERT_NOT_FOUND: 'This alert was already dealt with, or it is gone. Refresh the list.',
  // Scanned paper (receipt-scan stores a reading only while the paper is being read).
  RECEIPT_NOT_READING: 'This receipt is no longer being read. Refresh to see where it is.',
  SLIP_NOT_READING: 'This order slip is no longer being read. Refresh to see where it is.',
  // Staff, stations and branch settings.
  CANNOT_EDIT_SELF:
    'You cannot change your own role or switch off your own account. Another owner has to do it.',
  STAFF_EXISTS: 'This person already has a staff account.',
  DEVICE_NOT_FOUND: 'That station no longer exists. Refresh the list.',
  DEVICE_REQUIRED: 'This station has no name. Set the station up again.',
  // Migration 0124's one-off check (never raised by an RPC).
  STATION_ID_UNSUPPORTED: 'This station’s name is not supported. Retire it and register it again.',
  VENUE_SETTINGS_MISSING:
    'This branch’s settings are missing. The owner needs to finish setting up the branch.',
  TG_USER_REQUIRED: 'Enter the person’s Telegram user ID.',
  // Phone sign-in's send log (service only).
  SEND_NOT_FOUND: 'That text message could not be found.',
  // The owner's assistant and the AI budget.
  ASSISTANT_UNKNOWN_SCOPE:
    'This chat cannot read that. Refresh the page and choose again from the list.',
  CONVERSATION_NOT_FOUND: 'That chat no longer exists. Refresh the page.',
  JOB_NOT_FOUND: 'That job no longer exists. Refresh the page.',
  COMPONENT_NOT_FOUND: 'That card no longer exists. Refresh the page.',
  COMPONENT_BUILTIN: 'Built-in cards cannot be archived.',
  COMPONENT_KEY_TAKEN: 'A built-in card already uses this name. Choose another.',
  OWNER_NOT_FOUND: 'No active owner account was found.',
  LLM_DAILY_QUOTA: 'Today’s AI limit is reached. Try again tomorrow.',
  LLM_MONTHLY_CAP:
    'This month’s AI spending cap is reached. The owner can raise it in Venue settings.',
};
