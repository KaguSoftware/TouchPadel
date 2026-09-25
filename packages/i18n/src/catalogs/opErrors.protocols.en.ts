/**
 * `op.errors.<CODE>` for protocols and the staff phone (docs/design/protocols/
 * build-contracts-2026-09-23.md §3), spread at the end of `op.errors` in en.ts.
 * Mirror every key in opErrors.protocols.ar.ts.
 *
 * Both apps read these keys: the operator through MAPPED_CODES
 * (apps/operator/src/lib/errors.ts), the phone through CODE_TO_KEY
 * (apps/mobile/src/features/booking/errors.ts), so the wording never names an app.
 */
export const opErrorsProtocolsEn = {
  // Engine, kinds and staff pages (both maps).
  PROTOCOL_NOT_FOUND: 'That protocol could not be found.',
  PROTOCOL_NOT_READY: 'This kind of protocol is not available yet.',
  PROTOCOL_CLOSED: 'This protocol is finished or stopped, so it cannot change.',
  STEP_NOT_OPEN: 'This step is not open yet.',
  STEP_CLOSED: 'This step is already finished.',
  STEP_NOT_OPTIONAL: 'Only optional steps can be skipped.',
  NOT_STEP_ACTOR: 'This step is for someone else.',
  NOT_DECIDER: 'Someone else decides this step.',
  SUBMISSION_DECIDED: 'This was already decided or withdrawn. Refresh to see the latest.',
  SEND_BACK_TARGET_INVALID: 'Work can only go back to this step or an earlier finished one.',
  RECORD_INVALID: 'Some details are missing or not valid. Check the form and try again.',
  TEXT_BOTH_LANGUAGES_REQUIRED: 'Fill in both English and Arabic.',
  TEXT_REQUIRED: 'Write something first.',
  TEXT_TOO_LONG: 'That text is too long.',
  TEMPLATE_CHANGED: 'Someone saved this while you were editing. Reload it and make your change again.',
  PROTOCOL_ORDER_INVALID: 'That order is not possible: a step has to come after the steps it depends on.',
  PROTOCOL_STEP_FIXED:
    'Built-in steps cannot be removed, who does them cannot change, and the price steps always need the owner’s OK.',
  LIST_TOO_LONG: 'That list is too long.',
  INVALID_ROLE: 'That role cannot be chosen here.',
  PHOTO_PATH_INVALID: 'A photo did not upload properly. Take or choose it again.',
  UPLOAD_LIMIT: 'Too many photos in a short time. Try again in a few minutes.',
  PRICE_TARGET_CHANGED:
    'This change no longer matches what was approved: an item, size, add-on, promotion, court rate or the featured discount changed since. Start a new change.',
  RELEASE_NOT_READY: 'Not ready to launch: check names, prices, photo, recipe and category.',
  NOTE_WINDOW_CLOSED: 'Notes on this item closed 30 days after its launch.',
  SPONSOR_DETAILS_REQUIRED: 'Add the sponsor or client details before starting this tournament.',
  CANDIDATE_NOT_FOUND: 'That candidate could not be found. Their details may have been deleted.',
  HIRE_ROLE_MISMATCH: 'The new account’s role does not match the position.',
  CHECKLIST_NOT_FOUND: 'That checklist could not be found.',
  SHOPPING_ITEM_NOT_OPEN: 'That item is no longer on the list.',
  PURCHASE_NOT_FOUND: 'That purchase could not be found.',
  PURCHASE_ALREADY_RECEIVED: 'This purchase was already received.',
  SHOPPING_LABEL_REQUIRED: 'Pick an ingredient or write what to buy.',
  CAMPAIGN_DRAFT_LOCKED: 'The owner has picked up this draft, so it can no longer be changed here.',
  BLOCK_RANGE_INVALID: 'Each block has to end after it starts.',
  // Menu and price writers (operator only: nothing the phone calls raises them).
  ITEM_IN_RELEASE:
    'This item is still a new-item draft. Its prices come from its release, and it goes on sale when it is launched.',
  PRICE_VIA_PROTOCOL:
    'Prices, promotions, court rates and the featured-item discount change through a price or promotion change in Protocols.',
  ITEM_VIA_RELEASE: 'New menu items start as “Propose a new item”, and the owner launches them.',
  LAUNCH_VIA_PROTOCOL: 'Save it hidden. It goes on sale when the owner approves its price in a price change.',
  // Existing codes that had no op.errors string until now (both maps).
  NOT_PREPARED: 'Only prepared items can be made here.',
  NO_RECIPE: 'This item has no recipe yet. Ask a manager to add one.',
  ROLE_RETIRED: 'Kitchen is retired. Choose barista or chef assistant.',
  PROMOTION_NOT_FOUND: 'That promotion could not be found.',
  INVALID_WEEKDAYS: 'Those days of the week are not valid. Pick each day once.',
  CODE_TAKEN: 'That promo code is already used by another promotion.',
  // The staff-admin edge function's body code, for the phone's add-staff form.
  EMAIL_IN_USE: 'An account with this email already exists.',
  // Role spec (lane J, recipe_change_requests): the owner's approve of a head's
  // recipe change, when the recipe moved on since it was asked.
  RECIPE_CHANGED: 'The recipe changed after this request was sent. Ask for a new change.',
} as const;
