/**
 * The one catalogue of backend error codes, and the one way an error becomes
 * words (2026-10-01). It replaced three maps with three matching rules: the
 * operator's MAPPED_CODES (exact), the phone's CODE_TO_KEY (exact, then
 * longest substring) and the web's RPC_ERROR_KEYS (exact).
 *
 *   ERROR_CODE_KEYS  every code a person can meet → its catalog key. The SQL
 *                    codes (`raise exception 'CODE'`, errcode P0001 or 40001;
 *                    PostgREST hands CODE back as the error's message), the
 *                    edge functions' body codes (`{error: 'CODE'}`), and the
 *                    few codes the apps mint themselves (RPC_MISSING, PIN_OWN,
 *                    QUEUE_ROW_NOT_RESOLVABLE, EDGE_*). The text lives in the
 *                    catalogs, EN and AR: mostly `op.errors.<CODE>`, written so
 *                    it fits staff and guests alike.
 *   SQLSTATE_KEYS    the native Postgres errors that arrive as `error.code`
 *                    with an English message: unique and check violations,
 *                    malformed input, a deadlock or a statement timeout.
 *   errorMessageKey  the resolver every app delegates to (operator
 *                    lib/errors.ts, mobile features/booking/errors.ts, web
 *                    lib/appRpc.ts). An app passes `overrides` only where a
 *                    screen says a code its own way (the guest's
 *                    `booking.slotTaken` where staff read
 *                    `op.errors.SLOT_TAKEN`), and `isTransport` to say which
 *                    failures never reached the server.
 *
 * The matching rule, in order:
 *   1. exact: the error's `code`, then its `message`, trimmed, is a known code;
 *   2. embedded: a whole upper-snake word of the message is a known code (the
 *      longest wins). Wrappers put text around a code ("error: SLOT_TAKEN
 *      (reservations_no_overlap)", "CANCELLATION_WINDOW: inside the window", a
 *      relayed GoTrue hook refusal); the phone has always read those, and a
 *      whole-word match cannot find SLOT_TAKEN inside SLOT_TAKEN_X;
 *   3. SQLSTATE: the error's `sqlState`, then its `code`, is in SQLSTATE_KEYS;
 *   4. fallback: `errors.network` when `isTransport` says so, else
 *      `errors.generic`.
 *
 * `scripts/check-error-codes.mjs` (root `pnpm security`) requires every code a
 * migration raises to be a key here, and every key below to have an English
 * and an Arabic line; Node loads this file as it is, so it keeps to erasable
 * TypeScript and imports types only.
 */
import type { MessageKey } from './t';

export const ERROR_CODE_KEYS = {
  // ── Staff and shared refusals (the operator's op.errors.* lines) ──────────
  SLOT_TAKEN: 'op.errors.SLOT_TAKEN',
  DEGRADED_LOCKOUT: 'op.errors.DEGRADED_LOCKOUT',
  PIN_INVALID: 'op.errors.PIN_INVALID',
  PIN_LOCKED: 'op.errors.PIN_LOCKED',
  // Renderer-minted: leaving a locked station with your own manager PIN
  // (Quit / Exit forced full screen, __root.tsx proveLeavePin).
  PIN_OWN: 'op.errors.PIN_OWN',
  // Renderer-minted: PostgREST PGRST202, an RPC this build calls that the
  // server does not have yet (appRpc.ts toAppRpcError; open matches §5.5).
  RPC_MISSING: 'op.errors.RPC_MISSING',
  // 0115: a money RPC reached without a fresh verify_manager_pin grant. appRpc
  // verifies first, so a user sees this only after a very slow round trip.
  PIN_GRANT_REQUIRED: 'op.errors.PIN_GRANT_REQUIRED',
  // 0120: refunds and the other queued money corrections (item 9 / C3).
  REFUND_EXCEEDS_PAYMENT: 'op.errors.REFUND_EXCEEDS_PAYMENT',
  PAYMENT_NOT_FOUND: 'op.errors.PAYMENT_NOT_FOUND',
  ITEM_NOT_ON_TAB: 'op.errors.ITEM_NOT_ON_TAB',
  IDEMPOTENCY_CONFLICT: 'op.errors.IDEMPOTENCY_CONFLICT',
  FORBIDDEN: 'op.errors.FORBIDDEN',
  AUTH_REQUIRED: 'op.errors.AUTH_REQUIRED',
  ALREADY_NOTIFIED: 'op.errors.ALREADY_NOTIFIED',
  NO_OPEN_DAY: 'op.errors.NO_OPEN_DAY',
  PREVIOUS_DAY_OPEN: 'op.errors.PREVIOUS_DAY_OPEN',
  DAY_OPEN_TABS: 'op.errors.DAY_OPEN_TABS',
  DAY_UNSYNCED: 'op.errors.DAY_UNSYNCED',
  TAB_NOT_OPEN: 'op.errors.TAB_NOT_OPEN',
  TAB_NOT_FOUND: 'op.errors.TAB_NOT_FOUND',
  TAB_MERGED: 'op.errors.TAB_MERGED',
  TAB_NOT_EMPTY: 'op.errors.TAB_NOT_EMPTY',
  TAB_DAY_MISMATCH: 'op.errors.TAB_DAY_MISMATCH',
  TENDER_SHORT: 'op.errors.TENDER_SHORT',
  ALREADY_PAID: 'op.errors.ALREADY_PAID',
  // Renderer-minted: touch:resolve-queue-row refused (day-close dismiss).
  QUEUE_ROW_NOT_RESOLVABLE: 'op.errors.QUEUE_ROW_NOT_RESOLVABLE',
  INVALID_AMOUNT: 'op.errors.INVALID_AMOUNT',
  ITEM_UNAVAILABLE: 'op.errors.ITEM_UNAVAILABLE',
  EMPTY_ORDER: 'op.errors.EMPTY_ORDER',
  MODIFIER_SELECTION: 'op.errors.MODIFIER_SELECTION',
  INVALID_TRANSITION: 'op.errors.INVALID_TRANSITION',
  HOLD_EXPIRED: 'op.errors.HOLD_EXPIRED',
  NO_RATE: 'op.errors.NO_RATE',
  CLOSED_DATE: 'op.errors.CLOSED_DATE',
  OUTSIDE_HOURS: 'op.errors.OUTSIDE_HOURS',
  INVALID_TIME_RANGE: 'op.errors.INVALID_TIME_RANGE',
  GUEST_REQUIRED: 'op.errors.GUEST_REQUIRED',
  INVALID_RANGE: 'op.errors.INVALID_RANGE',
  CANCELLATION_WINDOW: 'op.errors.CANCELLATION_WINDOW',
  // 0150: a move whose START would land before now. The desk no longer offers
  // one, so this is the wall behind the wall (and the offline replay's answer).
  RESERVATION_IN_PAST: 'op.errors.RESERVATION_IN_PAST',
  RESERVATION_NOT_FOUND: 'op.errors.RESERVATION_NOT_FOUND',
  REASON_REQUIRED: 'op.errors.REASON_REQUIRED',
  INVALID_VALUE: 'op.errors.INVALID_VALUE',
  INVALID_PRICES: 'op.errors.INVALID_PRICES',
  INVALID_DAYS: 'op.errors.INVALID_DAYS',
  INVALID_HOURS: 'op.errors.INVALID_HOURS',
  INVALID_FLOAT: 'op.errors.INVALID_FLOAT',
  INVALID_COUNT: 'op.errors.INVALID_COUNT',
  INVALID_PRICE: 'op.errors.INVALID_PRICE',
  INVALID_QTY: 'op.errors.INVALID_QTY',
  CAFE_CLOSED: 'op.errors.CAFE_CLOSED',
  TICKET_NOT_FOUND: 'op.errors.TICKET_NOT_FOUND',
  ITEM_NOT_FOUND: 'op.errors.ITEM_NOT_FOUND',
  ITEM_VOIDED: 'op.errors.ITEM_VOIDED',
  INVALID_DURATION: 'op.errors.INVALID_DURATION',
  SLOT_IN_PAST: 'op.errors.SLOT_IN_PAST',
  COURT_NOT_FOUND: 'op.errors.COURT_NOT_FOUND',
  TABLE_NOT_FOUND: 'op.errors.TABLE_NOT_FOUND',
  TAB_ANCHOR_REQUIRED: 'op.errors.TAB_ANCHOR_REQUIRED',
  NOT_MOVABLE: 'op.errors.NOT_MOVABLE',
  NOT_EXTENDABLE: 'op.errors.NOT_EXTENDABLE',
  NOT_CANCELLABLE: 'op.errors.NOT_CANCELLABLE',
  INVALID_SPLIT_COUNT: 'op.errors.INVALID_SPLIT_COUNT',
  // Cafe rebuild (migrations 0027-0034).
  INVALID_HIGHLIGHT: 'op.errors.INVALID_HIGHLIGHT',
  HOOK_TOO_LONG: 'op.errors.HOOK_TOO_LONG',
  HOOK_PAIR_MISMATCH: 'op.errors.HOOK_PAIR_MISMATCH',
  PHOTO_BLUR_TOO_LONG: 'op.errors.PHOTO_BLUR_TOO_LONG',
  INVALID_SOLD_OUT: 'op.errors.INVALID_SOLD_OUT',
  INVALID_PHOTO_PATH: 'op.errors.INVALID_PHOTO_PATH',
  INVALID_COST: 'op.errors.INVALID_COST',
  CATEGORY_NOT_FOUND: 'op.errors.CATEGORY_NOT_FOUND',
  VARIANT_NOT_FOUND: 'op.errors.VARIANT_NOT_FOUND',
  MODIFIER_INVALID: 'op.errors.MODIFIER_INVALID',
  MODIFIER_NOT_FOUND: 'op.errors.MODIFIER_NOT_FOUND',
  GROUP_NOT_FOUND: 'op.errors.GROUP_NOT_FOUND',
  REVEAL_SELF: 'op.errors.REVEAL_SELF',
  REVEAL_DEPTH: 'op.errors.REVEAL_DEPTH',
  SELF_SUGGESTION: 'op.errors.SELF_SUGGESTION',
  UNKNOWN_SETTING: 'op.errors.UNKNOWN_SETTING',
  INVALID_SETTING_VALUE: 'op.errors.INVALID_SETTING_VALUE',
  INVALID_PCT: 'op.errors.INVALID_PCT',
  TABLE_NUMBER_TAKEN: 'op.errors.TABLE_NUMBER_TAKEN',
  INVALID_TABLE_NUMBER: 'op.errors.INVALID_TABLE_NUMBER',
  INVALID_COOLDOWN: 'op.errors.INVALID_COOLDOWN',
  BELL_DISABLED: 'op.errors.BELL_DISABLED',
  CALL_COOLDOWN: 'op.errors.CALL_COOLDOWN',
  // ack_waiter_call and resolve_waiter_call (0194): a call at another venue or
  // one that is gone. The waiter meets it on the phone, the desk on the operator.
  CALL_NOT_FOUND: 'op.errors.CALL_NOT_FOUND',
  TOKEN_INVALID: 'op.errors.TOKEN_INVALID',
  TELEGRAM_NOT_CONFIGURED: 'op.errors.TELEGRAM_NOT_CONFIGURED',
  OUTBOX_NOT_FOUND: 'op.errors.OUTBOX_NOT_FOUND',
  INVALID_KIND: 'op.errors.INVALID_KIND',
  REF_NOT_FOUND: 'op.errors.REF_NOT_FOUND',
  REF_REQUIRED: 'op.errors.REF_REQUIRED',
  ACTOR_REQUIRED: 'op.errors.ACTOR_REQUIRED',
  INVALID_ACTION: 'op.errors.INVALID_ACTION',
  VOID_REQUIRES_REFUND: 'op.errors.VOID_REQUIRES_REFUND',
  // hold_slot and confirm_booking raise it too, so a guest reads this line;
  // it names no screen.
  INVALID_ARGUMENT: 'op.errors.INVALID_ARGUMENT',
  REJECTION_NOT_FOUND: 'op.errors.REJECTION_NOT_FOUND',
  // Courts admin (0062) + delete (0074).
  INVALID_DURATIONS: 'op.errors.INVALID_DURATIONS',
  COURT_HAS_FUTURE_RESERVATIONS: 'op.errors.COURT_HAS_FUTURE_RESERVATIONS',
  INVALID_ACTIVE_WINDOW: 'op.errors.INVALID_ACTIVE_WINDOW',
  // CourtsAdmin intercepts this via courtUsageFromError to show the counts and
  // offer Deactivate, so this string is the net under that path, not the path.
  COURT_IN_USE: 'op.errors.COURT_IN_USE',
  NAME_REQUIRED: 'op.errors.NAME_REQUIRED',
  // Stock admin (0063) + counts (0019).
  UNIT_LOCKED: 'op.errors.UNIT_LOCKED',
  KIND_LOCKED: 'op.errors.KIND_LOCKED',
  INVALID_YIELD: 'op.errors.INVALID_YIELD',
  INVALID_WASTE_ALLOWANCE: 'op.errors.INVALID_WASTE_ALLOWANCE',
  INVALID_PACK: 'op.errors.INVALID_PACK',
  INGREDIENT_NOT_FOUND: 'op.errors.INGREDIENT_NOT_FOUND',
  INVALID_TARGET: 'op.errors.INVALID_TARGET',
  RECIPE_CYCLE: 'op.errors.RECIPE_CYCLE',
  COUNT_IN_PROGRESS: 'op.errors.COUNT_IN_PROGRESS',
  COUNT_NOT_FOUND: 'op.errors.COUNT_NOT_FOUND',
  COUNT_FINALIZED: 'op.errors.COUNT_FINALIZED',
  COUNT_LINE_NOT_FOUND: 'op.errors.COUNT_LINE_NOT_FOUND',
  BATCH_NOT_FOUND: 'op.errors.BATCH_NOT_FOUND',
  NOT_EXPIRED: 'op.errors.NOT_EXPIRED',
  // Staff requests (0072).
  REQUEST_NOT_PENDING: 'op.errors.REQUEST_NOT_PENDING',
  CANNOT_DECIDE_OWN: 'op.errors.CANNOT_DECIDE_OWN',
  REQUEST_ALREADY_PENDING: 'op.errors.REQUEST_ALREADY_PENDING',
  BAD_KIND: 'op.errors.BAD_KIND',
  BAD_STATUS: 'op.errors.BAD_STATUS',
  // Marketing (0073).
  BAD_TRANSITION: 'op.errors.BAD_TRANSITION',
  CAMPAIGN_LOCKED: 'op.errors.CAMPAIGN_LOCKED',
  BAD_CHANNEL: 'op.errors.BAD_CHANNEL',
  BAD_RULE: 'op.errors.BAD_RULE',
  BODY_REQUIRED: 'op.errors.BODY_REQUIRED',
  START_REQUIRED: 'op.errors.START_REQUIRED',
  REQUEST_NOT_FOUND: 'op.errors.REQUEST_NOT_FOUND',
  CAMPAIGN_NOT_FOUND: 'op.errors.CAMPAIGN_NOT_FOUND',
  AUDIENCE_NOT_FOUND: 'op.errors.AUDIENCE_NOT_FOUND',
  // Staff breaks (0105).
  BREAK_ALREADY_OPEN: 'op.errors.BREAK_ALREADY_OPEN',
  BREAK_ALLOWANCE_USED: 'op.errors.BREAK_ALLOWANCE_USED',
  BREAK_NOT_OPEN: 'op.errors.BREAK_NOT_OPEN',
  COVER_NOT_ALLOWED: 'op.errors.COVER_NOT_ALLOWED',
  INVALID_STATION: 'op.errors.INVALID_STATION',
  NO_PIN_SET: 'op.errors.NO_PIN_SET',
  // 0125/0130 (multi-venue slice 1) — the venue could not be resolved for this
  // write, and a station beat in that could not be filed to any venue. Both are
  // unreachable on a one-venue project; the mapping lands with the migration so
  // the first two-venue day is not the day the operator shows errors.generic.
  VENUE_REQUIRED: 'op.errors.VENUE_REQUIRED',
  STATION_UNKNOWN: 'op.errors.STATION_UNKNOWN',
  // Multi-venue slices 2–3 (0212, 0217): a row of another branch, and a
  // chain-wide promotion that names one branch's courts, categories or items.
  VENUE_MISMATCH: 'op.errors.VENUE_MISMATCH',
  PROMOTION_SCOPE_BRANCH: 'op.errors.PROMOTION_SCOPE_BRANCH',
  // 0218: the owner's branch assignment for a staff member.
  STAFF_VENUE_REQUIRED: 'op.errors.STAFF_VENUE_REQUIRED',
  STAFF_NOT_FOUND: 'op.errors.STAFF_NOT_FOUND',
  VENUE_NOT_FOUND: 'op.errors.VENUE_NOT_FOUND',
  // 0222–0223: stations and "Open a new branch".
  STATION_OTHER_BRANCH: 'op.errors.STATION_OTHER_BRANCH',
  SLUG_TAKEN: 'op.errors.SLUG_TAKEN',
  BRANCH_NOT_READY: 'op.errors.BRANCH_NOT_READY',
  LAST_OPEN_BRANCH: 'op.errors.LAST_OPEN_BRANCH',
  BRANCH_DAY_OPEN: 'op.errors.BRANCH_DAY_OPEN',
  // 0229, 0233 (multi-venue audit): stations on purpose, and the branch lifecycle.
  STATION_RETIRED: 'op.errors.STATION_RETIRED',
  STATION_HAS_HISTORY: 'op.errors.STATION_HAS_HISTORY',
  BRANCH_HAS_BOOKINGS: 'op.errors.BRANCH_HAS_BOOKINGS',
  VENUE_CLOSED: 'op.errors.VENUE_CLOSED',
  // Open matches at the desk (docs/design/open-matches/operator.md §5.20), each
  // code with the migration that first raises it (R11, R28); the copy is in
  // opErrors.matches.*.ts. The guest's own words for the codes it shares with the
  // desk are the phone's overrides. 0259: the record's Tickets panel and cash-out.
  TICKET_IN_USE: 'op.errors.TICKET_IN_USE',
  NO_UNUSED_TICKETS: 'op.errors.NO_UNUSED_TICKETS',
  CUSTOMER_NOT_FOUND: 'op.errors.CUSTOMER_NOT_FOUND',
  // 0262: the desk's open-match RPCs, seat money and the DF-16 wall.
  MATCHES_OFF: 'op.errors.MATCHES_OFF',
  MATCH_NOT_FOUND: 'op.errors.MATCH_NOT_FOUND',
  MATCH_NOT_FILLING: 'op.errors.MATCH_NOT_FILLING',
  MATCH_NOT_BOOKED: 'op.errors.MATCH_NOT_BOOKED',
  MATCH_NOT_STARTED: 'op.errors.MATCH_NOT_STARTED',
  MATCH_FULL: 'op.errors.MATCH_FULL',
  MATCH_TOO_LATE: 'op.errors.MATCH_TOO_LATE',
  MATCH_SLOT_FULL: 'op.errors.MATCH_SLOT_FULL',
  MATCH_GENDER_MISMATCH: 'op.errors.MATCH_GENDER_MISMATCH',
  MATCH_SEAT_LIMIT: 'op.errors.MATCH_SEAT_LIMIT',
  MATCH_BANNED: 'op.errors.MATCH_BANNED',
  MATCH_MARK_SEATS: 'op.errors.MATCH_MARK_SEATS',
  MATCH_ALREADY_IN: 'op.errors.MATCH_ALREADY_IN',
  MATCH_BOOKING_NO_CAFE: 'op.errors.MATCH_BOOKING_NO_CAFE',
  SEAT_NOT_FOUND: 'op.errors.SEAT_NOT_FOUND',
  SEAT_NOT_STARTED: 'op.errors.SEAT_NOT_STARTED',
  SEAT_MARK_LOCKED: 'op.errors.SEAT_MARK_LOCKED',
  SEAT_OWED_CHANGED: 'op.errors.SEAT_OWED_CHANGED',
  NOTHING_OWED: 'op.errors.NOTHING_OWED',
  PAYMENT_NOT_ON_MATCH: 'op.errors.PAYMENT_NOT_ON_MATCH',
  AMOUNT_OVER_SEAT: 'op.errors.AMOUNT_OVER_SEAT',
  PAYMENT_OVER_ALLOCATED: 'op.errors.PAYMENT_OVER_ALLOCATED',
  REPORT_NOT_FOUND: 'op.errors.REPORT_NOT_FOUND',
  REPORT_CLOSED: 'op.errors.REPORT_CLOSED',
  // Desk payment (0106).
  BOOKING_TAB_OPEN: 'op.errors.BOOKING_TAB_OPEN',
  BOOKING_TAB_DONOR: 'op.errors.BOOKING_TAB_DONOR',
  RESERVATION_NOT_LIVE: 'op.errors.RESERVATION_NOT_LIVE',
  TOTAL_CHANGED: 'op.errors.TOTAL_CHANGED',
  NOT_ZERO: 'op.errors.NOT_ZERO',
  REFUND_DUE: 'op.errors.REFUND_DUE',
  TAB_EMPTY: 'op.errors.TAB_EMPTY',
  // Touch Shop (0145/0146).
  CATEGORY_NOT_EMPTY: 'op.errors.CATEGORY_NOT_EMPTY',
  NOT_SHOP_CATEGORY: 'op.errors.NOT_SHOP_CATEGORY',
  BARCODE_TAKEN: 'op.errors.BARCODE_TAKEN',
  SKU_TAKEN: 'op.errors.SKU_TAKEN',
  SUPPLIER_EXISTS: 'op.errors.SUPPLIER_EXISTS',
  SUPPLIER_NOT_FOUND: 'op.errors.SUPPLIER_NOT_FOUND',
  LABEL_REQUIRED: 'op.errors.LABEL_REQUIRED',
  MIXED_BASKET: 'op.errors.MIXED_BASKET',
  SHOP_ITEM_NOT_ORDERABLE: 'op.errors.SHOP_ITEM_NOT_ORDERABLE',
  // 0244/0246: Touch Shop is its own desk (tab kind decides who works it).
  TAB_KIND_FORBIDDEN: 'op.errors.TAB_KIND_FORBIDDEN',
  TAB_KIND_MISMATCH: 'op.errors.TAB_KIND_MISMATCH',
  SHOP_TAB_NO_ANCHOR: 'op.errors.SHOP_TAB_NO_ANCHOR',
  DAY_NOT_FOUND: 'op.errors.DAY_NOT_FOUND',
  // Protocols and the staff phone (build-contracts-2026-09-23). Strings in
  // catalogs/opErrors.protocols.*.ts, read by both staff apps.
  PROTOCOL_NOT_FOUND: 'op.errors.PROTOCOL_NOT_FOUND',
  PROTOCOL_NOT_READY: 'op.errors.PROTOCOL_NOT_READY',
  PROTOCOL_CLOSED: 'op.errors.PROTOCOL_CLOSED',
  STEP_NOT_OPEN: 'op.errors.STEP_NOT_OPEN',
  STEP_CLOSED: 'op.errors.STEP_CLOSED',
  STEP_NOT_OPTIONAL: 'op.errors.STEP_NOT_OPTIONAL',
  NOT_STEP_ACTOR: 'op.errors.NOT_STEP_ACTOR',
  NOT_DECIDER: 'op.errors.NOT_DECIDER',
  SUBMISSION_DECIDED: 'op.errors.SUBMISSION_DECIDED',
  SEND_BACK_TARGET_INVALID: 'op.errors.SEND_BACK_TARGET_INVALID',
  RECORD_INVALID: 'op.errors.RECORD_INVALID',
  TEXT_BOTH_LANGUAGES_REQUIRED: 'op.errors.TEXT_BOTH_LANGUAGES_REQUIRED',
  TEXT_REQUIRED: 'op.errors.TEXT_REQUIRED',
  TEXT_TOO_LONG: 'op.errors.TEXT_TOO_LONG',
  TEMPLATE_CHANGED: 'op.errors.TEMPLATE_CHANGED',
  PROTOCOL_ORDER_INVALID: 'op.errors.PROTOCOL_ORDER_INVALID',
  PROTOCOL_STEP_FIXED: 'op.errors.PROTOCOL_STEP_FIXED',
  LIST_TOO_LONG: 'op.errors.LIST_TOO_LONG',
  INVALID_ROLE: 'op.errors.INVALID_ROLE',
  PHOTO_PATH_INVALID: 'op.errors.PHOTO_PATH_INVALID',
  UPLOAD_LIMIT: 'op.errors.UPLOAD_LIMIT',
  PRICE_TARGET_CHANGED: 'op.errors.PRICE_TARGET_CHANGED',
  RELEASE_NOT_READY: 'op.errors.RELEASE_NOT_READY',
  NOTE_WINDOW_CLOSED: 'op.errors.NOTE_WINDOW_CLOSED',
  SPONSOR_DETAILS_REQUIRED: 'op.errors.SPONSOR_DETAILS_REQUIRED',
  CANDIDATE_NOT_FOUND: 'op.errors.CANDIDATE_NOT_FOUND',
  HIRE_ROLE_MISMATCH: 'op.errors.HIRE_ROLE_MISMATCH',
  CHECKLIST_NOT_FOUND: 'op.errors.CHECKLIST_NOT_FOUND',
  SHOPPING_ITEM_NOT_OPEN: 'op.errors.SHOPPING_ITEM_NOT_OPEN',
  PURCHASE_NOT_FOUND: 'op.errors.PURCHASE_NOT_FOUND',
  PURCHASE_ALREADY_RECEIVED: 'op.errors.PURCHASE_ALREADY_RECEIVED',
  // 0237: Goods in's scanned receipts.
  RECEIPT_NOT_FOUND: 'op.errors.RECEIPT_NOT_FOUND',
  RECEIPT_ALREADY_DONE: 'op.errors.RECEIPT_ALREADY_DONE',
  RECEIPT_BUSY: 'op.errors.RECEIPT_BUSY',
  // 0239: the till's scanned orders.
  SLIP_NOT_FOUND: 'op.errors.SLIP_NOT_FOUND',
  SLIP_ALREADY_DONE: 'op.errors.SLIP_ALREADY_DONE',
  SLIP_BUSY: 'op.errors.SLIP_BUSY',
  // 0240: the scan hardening, and the till's and Goods in's own refusals the scan screens reach.
  SCAN_REREAD_LIMIT: 'op.errors.SCAN_REREAD_LIMIT',
  SCAN_USER_DAILY_LIMIT: 'op.errors.SCAN_USER_DAILY_LIMIT',
  READING_SUPERSEDED: 'op.errors.READING_SUPERSEDED',
  TAB_AMBIGUOUS: 'op.errors.TAB_AMBIGUOUS',
  DAY_CLOSED: 'op.errors.DAY_CLOSED',
  EMPTY_DELIVERY: 'op.errors.EMPTY_DELIVERY',
  INVALID_LINE: 'op.errors.INVALID_LINE',
  SHOPPING_LABEL_REQUIRED: 'op.errors.SHOPPING_LABEL_REQUIRED',
  CAMPAIGN_DRAFT_LOCKED: 'op.errors.CAMPAIGN_DRAFT_LOCKED',
  BLOCK_RANGE_INVALID: 'op.errors.BLOCK_RANGE_INVALID',
  // The menu and price writers' refusals: upsert_menu_item, upsert_variant,
  // upsert_modifier, the promotion and rate writers, set_cafe_setting.
  ITEM_IN_RELEASE: 'op.errors.ITEM_IN_RELEASE',
  PRICE_VIA_PROTOCOL: 'op.errors.PRICE_VIA_PROTOCOL',
  ITEM_VIA_RELEASE: 'op.errors.ITEM_VIA_RELEASE',
  LAUNCH_VIA_PROTOCOL: 'op.errors.LAUNCH_VIA_PROTOCOL',
  // Existing codes keyed for the first time. The Staff page keeps its own
  // words for ROLE_RETIRED and EMAIL_IN_USE (staffModel.ts staffRefusal).
  NOT_PREPARED: 'op.errors.NOT_PREPARED',
  NO_RECIPE: 'op.errors.NO_RECIPE',
  ROLE_RETIRED: 'op.errors.ROLE_RETIRED',
  PROMOTION_NOT_FOUND: 'op.errors.PROMOTION_NOT_FOUND',
  INVALID_WEEKDAYS: 'op.errors.INVALID_WEEKDAYS',
  CODE_TAKEN: 'op.errors.CODE_TAKEN',
  // staff-admin's body code, for the add-staff form.
  EMAIL_IN_USE: 'op.errors.EMAIL_IN_USE',
  // Role spec (lane J): decide_recipe_change's approve.
  RECIPE_CHANGED: 'op.errors.RECIPE_CHANGED',
  // Wave 5 (wave5-addendum-2026-09-25 §3). Strings in catalogs/opErrors.protocols.*.ts.
  // The stores: transfer_stock, and receive_delivery_internal, which Goods in,
  // the driver receipt and log_stock reach.
  TRANSFER_SHORT: 'op.errors.TRANSFER_SHORT',
  STORE_BEING_COUNTED: 'op.errors.STORE_BEING_COUNTED',
  // Till shifts (operator only: the phone never calls a till-shift RPC, M7).
  TILL_SHIFT_ALREADY_OPEN: 'op.errors.TILL_SHIFT_ALREADY_OPEN',
  TILL_SHIFT_STATION_BUSY: 'op.errors.TILL_SHIFT_STATION_BUSY',
  TILL_SHIFT_NOT_FOUND: 'op.errors.TILL_SHIFT_NOT_FOUND',
  TILL_SHIFT_CLOSED: 'op.errors.TILL_SHIFT_CLOSED',
  TILL_SHIFT_NOT_YOURS: 'op.errors.TILL_SHIFT_NOT_YOURS',
  TILL_SHIFT_WRONG_STATION: 'op.errors.TILL_SHIFT_WRONG_STATION',
  TILL_SHIFT_UNSYNCED: 'op.errors.TILL_SHIFT_UNSYNCED',
  // Online deposits (build-contracts-2026-09-27 §2.5). PAYMENT_NOT_FOUND is
  // mapped above with the till refunds and says the same thing here.
  PAYMENT_STATE: 'op.errors.PAYMENT_STATE',
  REFUND_TOO_LARGE: 'op.errors.REFUND_TOO_LARGE',
  // The hold ladder (0252): a standing decided or gone while the list was open.
  HOLD_STANDING_NOT_FOUND: 'op.errors.HOLD_STANDING_NOT_FOUND',
  // Renderer-minted from an edge failure with no code the catalogue knows: the
  // HTTP class (lib/edge.ts EdgeError.kind), prefixed to keep it apart from SQL codes.
  EDGE_NOT_CONFIGURED: 'op.errors.EDGE_NOT_CONFIGURED',
  EDGE_FORBIDDEN: 'op.errors.EDGE_FORBIDDEN',
  EDGE_AUTH_REQUIRED: 'op.errors.EDGE_AUTH_REQUIRED',
  EDGE_UPSTREAM: 'op.errors.EDGE_UPSTREAM',
  EDGE_RATE_LIMITED: 'op.errors.EDGE_RATE_LIMITED',
  EDGE_UNKNOWN: 'op.errors.EDGE_UNKNOWN',
  // Coaching (docs/design/coaching/build-contracts-2026-10-01.md §1.10): each
  // code lands with the migration that first raises it; the lines are in
  // catalogs/opErrors.coaching.*.ts, worded for staff and guests alike.
  // coaching_settings: set_coaching_settings refuses an online lesson payment mode before
  // the lessons terms are live (detail terms; R50, R67).
  ONLINE_PAYMENT_OFF: 'op.errors.ONLINE_PAYMENT_OFF',
  // coaching_tables: the lines of an approved, paid or void coach statement are frozen (R22).
  STATEMENT_NOT_DRAFT: 'op.errors.STATEMENT_NOT_DRAFT',
  // lesson_reservation_guards: a lesson's court row is changed only through the coaching RPCs
  // (cancel_reservation, mark_reservation, extend_reservation, staff_create_reservation,
  // open_tab, confirm_booking, move_reservation; detail cancel | mark | extend | create | tab |
  // confirm | move; R7, R35, R73). A replayed offline envelope meets it too (a conflict row).
  LESSON_VIA_COACHING: 'op.errors.LESSON_VIA_COACHING',
  // lesson_money: the desk payment of a lesson place (lesson_settle; detail held | expired |
  // cancelled | lesson_cancelled | no_show | nothing_owed; lesson-begin adds booked | desk |
  // free), what it owes moving under the clerk (detail "expected X, now Y" | tab_open), a
  // lesson tab's wall, an unknown or unseen enrolment, and lesson money refunded beyond what is
  // due (app.refund, R36; lesson_blocked_refund_record, R75; detail "due <n>").
  ENROLMENT_NOT_FOUND: 'op.errors.ENROLMENT_NOT_FOUND',
  LESSON_NOT_PAYABLE: 'op.errors.LESSON_NOT_PAYABLE',
  LESSON_OWED_CHANGED: 'op.errors.LESSON_OWED_CHANGED',
  LESSON_TAB_NO_GOODS: 'op.errors.LESSON_TAB_NO_GOODS',
  REFUND_EXCEEDS_DUE: 'op.errors.REFUND_EXCEEDS_DUE',
  // coaching_admin: coaches, lesson types, hours and time off (HOURS_INVALID / HOURS_OVERLAP
  // detail the 0-based window index, or time_off, R73), and coach mode for a non-coach.
  NOT_A_COACH: 'op.errors.NOT_A_COACH',
  ALREADY_COACH: 'op.errors.ALREADY_COACH',
  COACH_NOT_FOUND: 'op.errors.COACH_NOT_FOUND',
  COACH_NOT_AT_BRANCH: 'op.errors.COACH_NOT_AT_BRANCH',
  LESSON_TYPE_NOT_FOUND: 'op.errors.LESSON_TYPE_NOT_FOUND',
  LESSON_TYPE_NOT_OFFERED: 'op.errors.LESSON_TYPE_NOT_OFFERED',
  HOURS_INVALID: 'op.errors.HOURS_INVALID',
  HOURS_OVERLAP: 'op.errors.HOURS_OVERLAP',
  TIME_OFF_HAS_LESSONS: 'op.errors.TIME_OFF_HAS_LESSONS',
  // lesson_booking: booking, joining, adding, cancelling, moving and marks (a course's per-start
  // codes carry the 1-based session number as detail; ALREADY_ENROLLED detail coach, R56, R73;
  // LESSON_CLOSED detail cutoff, R47; COACH_ADD_LIMIT detail day | live, CD-9, R56).
  COACHING_OFF: 'op.errors.COACHING_OFF',
  COACH_INACTIVE: 'op.errors.COACH_INACTIVE',
  LESSON_TYPE_INACTIVE: 'op.errors.LESSON_TYPE_INACTIVE',
  COACH_UNAVAILABLE: 'op.errors.COACH_UNAVAILABLE',
  COACH_BUSY: 'op.errors.COACH_BUSY',
  NO_COURT_FREE: 'op.errors.NO_COURT_FREE',
  SLOT_NOT_ON_GRID: 'op.errors.SLOT_NOT_ON_GRID',
  PARTY_TOO_LARGE: 'op.errors.PARTY_TOO_LARGE',
  LESSON_FULL: 'op.errors.LESSON_FULL',
  LESSON_CLOSED: 'op.errors.LESSON_CLOSED',
  ALREADY_ENROLLED: 'op.errors.ALREADY_ENROLLED',
  LESSON_NOT_FOUND: 'op.errors.LESSON_NOT_FOUND',
  LESSON_NOT_CANCELLABLE: 'op.errors.LESSON_NOT_CANCELLABLE',
  ONLINE_PAYMENT_REQUIRED: 'op.errors.ONLINE_PAYMENT_REQUIRED',
  COURSE_STARTS_INVALID: 'op.errors.COURSE_STARTS_INVALID',
  SESSION_NOT_MOVABLE: 'op.errors.SESSION_NOT_MOVABLE',
  COACH_ADD_LIMIT: 'op.errors.COACH_ADD_LIMIT',
  // coach_statements: mark paid needs an approved statement whose total is not negative (detail
  // the status, or negative: R59) and a receipt or transfer reference (R4, R49, R74).
  STATEMENT_NOT_APPROVED: 'op.errors.STATEMENT_NOT_APPROVED',
  STATEMENT_REFERENCE_REQUIRED: 'op.errors.STATEMENT_REFERENCE_REQUIRED',
  // Tournaments (docs/design/tournaments/build-contracts-2026-10-03.md §1.9): the lines are in
  // catalogs/opErrors.tournaments.*.ts, worded for staff and guests alike; the detail sentences
  // are the lanes' (ws.tournaments.*, tournaments.*).
  // tournaments_lifecycle: the branch switch (publish, register), an unknown or unseen tournament
  // or entry, publish refused (detail not_done | already_published | capacity_unit |
  // capacity_count | format | fee_not_approved | no_blocks | settings:<key>), registration shut
  // (detail status | cutoff), no place left, the wrong category, and an adopted event block
  // cancelled, moved or marked from the calendar (the guard trigger).
  TOURNAMENTS_OFF: 'op.errors.TOURNAMENTS_OFF',
  TOURNAMENT_NOT_FOUND: 'op.errors.TOURNAMENT_NOT_FOUND',
  TOURNAMENT_PUBLISH_REFUSED: 'op.errors.TOURNAMENT_PUBLISH_REFUSED',
  TOURNAMENT_NOT_OPEN: 'op.errors.TOURNAMENT_NOT_OPEN',
  TOURNAMENT_FULL: 'op.errors.TOURNAMENT_FULL',
  TOURNAMENT_CATEGORY_MISMATCH: 'op.errors.TOURNAMENT_CATEGORY_MISMATCH',
  TOURNAMENT_ENTRY_NOT_FOUND: 'op.errors.TOURNAMENT_ENTRY_NOT_FOUND',
  TOURNAMENT_VIA_EVENTS: 'op.errors.TOURNAMENT_VIA_EVENTS',
  // tournaments_play: the rounds write (detail status | stale | engine | format | numbering |
  // played | mexicano_one | round_open | seat | court | courts_used) and the score (detail
  // status | invalid | changed | locked).
  TOURNAMENT_ROUNDS_INVALID: 'op.errors.TOURNAMENT_ROUNDS_INVALID',
  TOURNAMENT_SCORE_REFUSED: 'op.errors.TOURNAMENT_SCORE_REFUSED',
  // 0310 tournaments_money_lifecycle: the desk closes registration below min_entries (detail
  // <registered>/<min>), and an early finish with no complete round (detail not_played) or a
  // begun round after it (detail partial_round).
  TOURNAMENT_UNDER_FILLED: 'op.errors.TOURNAMENT_UNDER_FILLED',
  TOURNAMENT_FINISH_REFUSED: 'op.errors.TOURNAMENT_FINISH_REFUSED',
  // tournaments_schema_money: the desk payment of an entry fee (tournament_settle; detail
  // waitlisted | withdrawn | no_show | cancelled | nothing_owed, then "expected X, now Y").
  TOURNAMENT_NOT_PAYABLE: 'op.errors.TOURNAMENT_NOT_PAYABLE',
  TOURNAMENT_OWED_CHANGED: 'op.errors.TOURNAMENT_OWED_CHANGED',
  // Loyalty and the account merge (docs/design/loyalty/build-contracts-2026-10-05.md §2): the
  // lines are in catalogs/opErrors.loyalty.*.ts. PHONE_TAKEN: a guest's phone edit that another live
  // profile holds (0303); MERGE_REFUSED detail staff_both | coach_both | same | missing; the member
  // codes from loyalty_identify and link_guest_session; the rest from loyalty_redeem.
  PHONE_TAKEN: 'op.errors.PHONE_TAKEN',
  MERGE_REFUSED: 'op.errors.MERGE_REFUSED',
  MEMBER_CODE_INVALID: 'op.errors.MEMBER_CODE_INVALID',
  MEMBER_CODE_EXPIRED: 'op.errors.MEMBER_CODE_EXPIRED',
  MEMBER_NOT_FOUND: 'op.errors.MEMBER_NOT_FOUND',
  NO_CUSTOMER: 'op.errors.NO_CUSTOMER',
  LOYALTY_OFF: 'op.errors.LOYALTY_OFF',
  POINTS_INSUFFICIENT: 'op.errors.POINTS_INSUFFICIENT',
  POINTS_BELOW_MIN: 'op.errors.POINTS_BELOW_MIN',
  REWARD_NOT_FOUND: 'op.errors.REWARD_NOT_FOUND',

  // ── Guest refusals the desk never meets (the phone's lines) ───────────────
  // 0048/C1 + 0058: raised by app.hold_slot from the day it was hardened; the
  // hold cap is what a guest hits after backing out of Review a few times.
  // NOT_A_HOLD comes from app.release_hold.
  HOLD_NOT_FOUND: 'errors.notFound',
  HOLD_QUOTA_EXCEEDED: 'booking.holdQuota',
  BEYOND_HORIZON: 'booking.beyondHorizon',
  ACCOUNT_REQUIRED: 'booking.accountRequired',
  NOT_A_HOLD: 'booking.notAHold',
  // 0252, the hold ladder: a guest whose holds keep lapsing waits, then is
  // suspended. The owner chose no message of its own for either (2026-09-27),
  // so both read as the generic line (GENERIC_BY_DECISION below).
  HOLD_COOLDOWN: 'errors.generic',
  BOOKING_SUSPENDED: 'errors.generic',
  // 0059: confirm_booking refuses a guest whose profile has no phone (spec 05.3).
  // Review routes this code to the complete-profile screen; the text is the backstop.
  PHONE_REQUIRED: 'auth.profileIncompleteNotice',
  // 0117 (C5): the hold carries the quoted price; a rule edited underneath it
  // refuses the confirm instead of charging an amount the guest never saw.
  PRICE_CHANGED: 'booking.priceChanged',
  // The online deposit (build-contracts-2026-09-27 §2.5). Raised by SQL, except
  // PROVIDER_UNAVAILABLE, which only the deposit-begin edge function sends.
  // Review and the payment screen act on several (DEPOSIT_REQUIRED refreshes
  // the quote, DEPOSITS_OFF falls back to Confirm); the text is what the guest
  // reads either way.
  DEPOSITS_OFF: 'deposit.errors.depositsOff',
  DEPOSIT_REQUIRED: 'deposit.errors.depositRequired',
  TOO_MANY_ATTEMPTS: 'deposit.errors.tooManyAttempts',
  PROVIDER_UNAVAILABLE: 'deposit.errors.providerUnavailable',
  // send_test_push's limit (0070) and any other rate-limited call; the
  // Settings screen keeps its own wording for the test push.
  RATE_LIMITED: 'errors.tooManyRequests',
  // Open matches (docs/design/open-matches/guest.md §4.22): each commit adds
  // the codes its SQL raises. 0256: app.set_my_gender.
  GENDER_ALREADY_SET: 'matches.errors.genderAlreadySet',
  // 0259: buying tickets (edge ticket-begin -> app.ticket_payment_prepare). The
  // detail wallet_limit has its own line (matches.errors.walletLimit), which the
  // tickets screen picks from the detail.
  TICKET_COUNT_INVALID: 'matches.errors.ticketCountInvalid',
  TERMS_REQUIRED: 'matches.errors.termsRequired',
  // 0260: the match core. GENDER_REQUIRED is app.match_guest's (the phone asks
  // inline, DF-10); NEED_TICKETS app.ticket_pick's, whose detail has its own
  // line (matches.errors.needTicketsCount) for the screen that reads it.
  GENDER_REQUIRED: 'matches.errors.genderRequired',
  NEED_TICKETS: 'matches.errors.needTickets',
  // 0261: the guest's open-match calls (start, join, request, decide, leave,
  // remove, cancel, message, report, block).
  MATCH_CLOSED: 'matches.errors.closed',
  MATCH_LIMIT_REACHED: 'matches.errors.limitReached',
  MATCH_APPROVAL_REQUIRED: 'matches.errors.approvalRequired',
  MATCH_NOT_APPROVAL: 'matches.errors.notApproval',
  MATCH_UNAVAILABLE: 'matches.errors.unavailable',
  MATCH_TIME_CLASH: 'matches.errors.timeClash',
  MATCH_BOOKED: 'matches.errors.booked',
  NOT_ORGANISER: 'matches.errors.notOrganiser',
  REQUEST_CLOSED: 'matches.errors.requestClosed',
  REQUESTER_INELIGIBLE: 'matches.errors.requesterIneligible',
  REQUEST_LIMIT: 'matches.errors.requestLimit',
  SEAT_HOLDER_REQUIRED: 'matches.errors.seatHolderRequired',
  SEAT_STARTED: 'matches.errors.seatStarted',
  REPORT_TARGET_INVALID: 'matches.errors.reportTargetInvalid',
  BLOCK_TARGET_INVALID: 'matches.errors.blockTargetInvalid',
  // The table's session ran out (create_guest_order, raise_waiter_call).
  SESSION_EXPIRED: 'errors.sessionTableExpired',

  // ── Codes no app had worded until this catalogue (2026-10-01) ─────────────
  // Lines in catalogs/opErrors.codes.*.ts unless a screen already had words
  // for the code, which are reused so there is one sentence per refusal.
  // The till.
  TENDER_CARD: 'op.errors.TENDER_CARD',
  DISCOUNT_REQUIRES_REFUND: 'op.errors.DISCOUNT_REQUIRES_REFUND',
  OVERRIDE_REQUIRES_REFUND: 'op.errors.OVERRIDE_REQUIRES_REFUND',
  REFUND_QTY_EXCEEDS_LINE: 'op.errors.REFUND_QTY_EXCEEDS_LINE',
  // Raised with errcode 40001 (retry): the order moved tab under the lock.
  TAB_MOVED: 'op.errors.TAB_MOVED',
  MERGE_SELF: 'op.errors.MERGE_SELF',
  DONOR_HAS_PAYMENTS: 'op.errors.DONOR_HAS_PAYMENTS',
  INVALID_SPLIT: 'op.errors.INVALID_SPLIT',
  ITEM_ASSIGNED_TWICE: 'op.errors.ITEM_ASSIGNED_TWICE',
  SPLIT_INCOMPLETE: 'op.errors.SPLIT_INCOMPLETE',
  // The promo code box on the bill (eligible_promotions, apply_best_promotion):
  // TabDetailPanel's own lines.
  CODE_INVALID: 'ws.cashier.detail.promoCodeInvalid',
  CODE_NOT_ELIGIBLE: 'ws.cashier.detail.promoCodeNotEligible',
  NO_ELIGIBLE_PROMOTION: 'ws.cashier.detail.promoNone',
  // Migration 0106's one-off check, never raised by an RPC.
  DUPLICATE_LIVE_BOOKING_TABS: 'op.errors.DUPLICATE_LIVE_BOOKING_TABS',
  // The kitchen.
  TICKET_CLOSED: 'op.errors.TICKET_CLOSED',
  // The desk. RESERVATION_MOVED is raised with errcode 40001 (retry).
  RESERVATION_MOVED: 'op.errors.RESERVATION_MOVED',
  RESERVATION_NOT_STARTED: 'op.errors.RESERVATION_NOT_STARTED',
  SERIES_NOT_FOUND: 'op.errors.SERIES_NOT_FOUND',
  SERIES_EMPTY: 'op.errors.SERIES_EMPTY',
  SERIES_TOO_LONG: 'op.errors.SERIES_TOO_LONG',
  SERIES_UNRESOLVED_CONFLICTS: 'op.errors.SERIES_UNRESOLVED_CONFLICTS',
  INVALID_PATTERN: 'op.errors.INVALID_PATTERN',
  INVALID_RESOLUTION: 'op.errors.INVALID_RESOLUTION',
  INVALID_SCOPE: 'op.errors.INVALID_SCOPE',
  // create_series with a guest who is gone: the customer record's own line.
  GUEST_NOT_FOUND: 'op.errors.CUSTOMER_NOT_FOUND',
  // Customers: desk-customer-create (which also sends DUPLICATE_EMAIL) on the
  // new-customer form's field lines; INVALID_PHONE is also app.sms_send_gate's.
  DUPLICATE_PHONE: 'ws.courtDesk.createCustomer.errors.DUPLICATE_PHONE',
  DUPLICATE_EMAIL: 'ws.courtDesk.createCustomer.errors.DUPLICATE_EMAIL',
  INVALID_PHONE: 'ws.courtDesk.createCustomer.errors.INVALID_PHONE',
  AUTH_USER_NOT_FOUND: 'op.errors.AUTH_USER_NOT_FOUND',
  INVALID_LANG: 'op.errors.INVALID_LANG',
  NAME_LENGTH: 'op.errors.NAME_LENGTH',
  NOTE_LENGTH: 'op.errors.NOTE_LENGTH',
  NOTE_NOT_FOUND: 'op.errors.NOTE_NOT_FOUND',
  INVALID_FLAG: 'op.errors.INVALID_FLAG',
  DUPLICATE_FLAG: 'op.errors.DUPLICATE_FLAG',
  LABEL_LENGTH: 'op.errors.LABEL_LENGTH',
  // Ordering from the table: 0211's per-minute and per-order caps on guests.
  TOO_MANY_ORDERS: 'op.errors.TOO_MANY_ORDERS',
  TOO_MANY_ITEMS: 'op.errors.TOO_MANY_ITEMS',
  // The guest's account: delete_my_account and accept_terms. The web form has
  // its own line for ALREADY_DELETED, used here for every app.
  ALREADY_DELETED: 'legal.deleteAccount.form.errors.already',
  CONFIRMATION_REQUIRED: 'op.errors.CONFIRMATION_REQUIRED',
  VERSION_INVALID: 'op.errors.VERSION_INVALID',
  // send_test_push with no device token: Settings' own line.
  NO_PUSH_TOKEN: 'settings.testPushNoToken',
  // Menu, courts and rates admin.
  DUPLICATE_ID: 'op.errors.DUPLICATE_ID',
  INVALID_SELECT_RANGE: 'op.errors.INVALID_SELECT_RANGE',
  INVALID_SERVE_TEMP: 'op.errors.INVALID_SERVE_TEMP',
  TAX_GROUP_NOT_FOUND: 'op.errors.TAX_GROUP_NOT_FOUND',
  RULE_NOT_FOUND: 'op.errors.RULE_NOT_FOUND',
  CODE_GENERATION_FAILED: 'op.errors.CODE_GENERATION_FAILED',
  // Stock.
  BATCH_EMPTY: 'op.errors.BATCH_EMPTY',
  INVALID_MOVEMENT: 'op.errors.INVALID_MOVEMENT',
  ALERT_NOT_FOUND: 'op.errors.ALERT_NOT_FOUND',
  // Scanned paper: receipt-scan storing a reading for a paper no longer being read.
  RECEIPT_NOT_READING: 'op.errors.RECEIPT_NOT_READING',
  SLIP_NOT_READING: 'op.errors.SLIP_NOT_READING',
  // Staff: set_staff_pin, set_staff_role and set_staff_active, on the Staff
  // page's own lines where it has them (staffModel.ts staffRefusal).
  PIN_FORMAT: 'ws.owner.staff.refusals.pinFormat',
  PIN_WEAK: 'ws.owner.staff.refusals.pinWeak',
  LAST_OWNER: 'ws.owner.staff.refusals.lastOwner',
  CANNOT_EDIT_SELF: 'op.errors.CANNOT_EDIT_SELF',
  STAFF_EXISTS: 'op.errors.STAFF_EXISTS',
  // Stations and branch settings. STATION_ID_UNSUPPORTED is migration 0124's
  // one-off check, never raised by an RPC.
  DEVICE_NOT_FOUND: 'op.errors.DEVICE_NOT_FOUND',
  DEVICE_REQUIRED: 'op.errors.DEVICE_REQUIRED',
  STATION_ID_UNSUPPORTED: 'op.errors.STATION_ID_UNSUPPORTED',
  VENUE_SETTINGS_MISSING: 'op.errors.VENUE_SETTINGS_MISSING',
  TG_USER_REQUIRED: 'op.errors.TG_USER_REQUIRED',
  // Shape checks of internal callers (the replay log, the SMS hook, settings
  // and flags payloads): nothing a person typed, so the plain invalid-input line.
  INVALID_FLAGS: 'op.errors.INVALID_ARGUMENT',
  INVALID_RESULT: 'op.errors.INVALID_ARGUMENT',
  INVALID_SETTINGS: 'op.errors.INVALID_ARGUMENT',
  INVALID_STATUS: 'op.errors.INVALID_ARGUMENT',
  SEND_NOT_FOUND: 'op.errors.SEND_NOT_FOUND',
  // The owner's assistant. The four a tool call meets when the model asks for
  // something the catalog does not offer share the assistant's own "could not
  // answer" line; the model choice has its own line on the model switch.
  ASSISTANT_NOT_COUNTABLE: 'ws.owner.assistant.message.errors.UNKNOWN',
  ASSISTANT_UNKNOWN_COLUMN: 'ws.owner.assistant.message.errors.UNKNOWN',
  ASSISTANT_UNKNOWN_TABLE: 'ws.owner.assistant.message.errors.UNKNOWN',
  ASSISTANT_UNKNOWN_TOOL: 'ws.owner.assistant.message.errors.UNKNOWN',
  ASSISTANT_MODEL_NOT_PRICED: 'ws.owner.assistant.model.notPriced',
  ASSISTANT_UNKNOWN_SCOPE: 'op.errors.ASSISTANT_UNKNOWN_SCOPE',
  CONVERSATION_NOT_FOUND: 'op.errors.CONVERSATION_NOT_FOUND',
  JOB_NOT_FOUND: 'op.errors.JOB_NOT_FOUND',
  COMPONENT_NOT_FOUND: 'op.errors.COMPONENT_NOT_FOUND',
  COMPONENT_BUILTIN: 'op.errors.COMPONENT_BUILTIN',
  COMPONENT_KEY_TAKEN: 'op.errors.COMPONENT_KEY_TAKEN',
  OWNER_NOT_FOUND: 'op.errors.OWNER_NOT_FOUND',
  // assistant_set_model's missing conversation (detail 'conversation').
  NOT_FOUND: 'errors.notFound',
  // llm_begin_request: the AI budget, for the assistant and the scan reader.
  LLM_DAILY_QUOTA: 'op.errors.LLM_DAILY_QUOTA',
  LLM_MONTHLY_CAP: 'op.errors.LLM_MONTHLY_CAP',
  // Wages (0271–0272): the owner's pay list.
  WAGE_NOT_SET: 'op.errors.WAGE_NOT_SET',
  WAGE_ALREADY_PAID: 'op.errors.WAGE_ALREADY_PAID',
  WAGE_CHANGED: 'op.errors.WAGE_CHANGED',

  // ── Edge functions' own body codes (never raised by SQL) ──────────────────
  // _shared/http.ts mapPgError: a unique violation, a retryable database error
  // (40001, 40P01, 55P03, 57014, …) and an RPC that has not landed yet. They
  // read as their SQLSTATE twins below and the renderer's RPC_MISSING.
  DUPLICATE: 'errors.duplicate',
  RETRY_LATER: 'errors.busy',
  RPC_NOT_DEPLOYED: 'op.errors.RPC_MISSING',
  // staff-admin, desk-customer-create and protocol-action: the form sent
  // something malformed.
  BAD_REQUEST: 'errors.validation',
} as const satisfies Record<string, MessageKey>;

export type ErrorCode = keyof typeof ERROR_CODE_KEYS;

/**
 * Native Postgres errors: PostgREST puts the SQLSTATE in `error.code` and an
 * English sentence in `error.message`, so no business code matches. 40001 and
 * 55P03 join the two the edge functions already treat as retryable.
 */
export const SQLSTATE_KEYS = {
  '23505': 'errors.duplicate', // unique_violation
  '23514': 'errors.invalidValue', // check_violation
  '22P02': 'errors.invalidInput', // invalid_text_representation
  '40P01': 'errors.busy', // deadlock_detected
  '57014': 'errors.busy', // query_canceled (statement_timeout)
  '40001': 'errors.busy', // serialization_failure
  '55P03': 'errors.busy', // lock_not_available
} as const satisfies Record<string, MessageKey>;

/**
 * The only codes whose line is `errors.generic`, each by an owner's decision;
 * the gate refuses `errors.generic` for any other code.
 */
export const GENERIC_BY_DECISION: readonly ErrorCode[] = ['HOLD_COOLDOWN', 'BOOKING_SUSPENDED'];

/** An app's own words for some codes, consulted before the catalogue. */
export type ErrorOverrides = Readonly<Partial<Record<ErrorCode, MessageKey>>>;

export interface ErrorKeyOptions {
  overrides?: ErrorOverrides;
  /** True when the failure never reached the server: it reads as `errors.network`. */
  isTransport?: (err: unknown) => boolean;
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** True when `value` is a code of the catalogue. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && has(ERROR_CODE_KEYS, value);
}

/** A whole upper-snake word: SLOT_TAKEN, FORBIDDEN (never part of a longer word). */
const CODE_WORD = /\b[A-Z][A-Z0-9_]*[A-Z0-9]\b/g;

interface ErrorFields {
  code: string | null;
  message: string | null;
  sqlState: string | null;
}

/** What any thrown value carries: a string, or an object with code / message / sqlState. */
function fieldsOf(err: unknown): ErrorFields {
  if (typeof err === 'string') return { code: null, message: err.trim(), sqlState: null };
  if (!err || typeof err !== 'object') return { code: null, message: null, sqlState: null };
  const o = err as { code?: unknown; message?: unknown; sqlState?: unknown };
  return {
    code: typeof o.code === 'string' ? o.code.trim() : null,
    message: typeof o.message === 'string' ? o.message.trim() : null,
    sqlState: typeof o.sqlState === 'string' ? o.sqlState.trim() : null,
  };
}

/**
 * The catalogue code an error names, or null: rule steps 1 and 2 (exact
 * `code`, exact `message`, then the longest code word inside the message).
 * Takes a thrown value or a bare message string.
 */
export function errorCode(err: unknown): ErrorCode | null {
  const { code, message } = fieldsOf(err);
  if (isErrorCode(code)) return code;
  if (isErrorCode(message)) return message;
  let best: ErrorCode | null = null;
  for (const word of message?.match(CODE_WORD) ?? []) {
    if (isErrorCode(word) && (best === null || word.length > best.length)) best = word;
  }
  return best;
}

/** The line of a native Postgres error (rule step 3), or null. */
export function sqlStateMessageKey(err: unknown): MessageKey | null {
  const { code, sqlState } = fieldsOf(err);
  for (const state of [sqlState, code]) {
    if (state && has(SQLSTATE_KEYS, state))
      return SQLSTATE_KEYS[state as keyof typeof SQLSTATE_KEYS];
  }
  return null;
}

/** Any thrown value (RPC refusal, edge refusal, Postgres error, network failure) → its catalog key. */
export function errorMessageKey(err: unknown, opts: ErrorKeyOptions = {}): MessageKey {
  const code = errorCode(err);
  if (code !== null) return opts.overrides?.[code] ?? ERROR_CODE_KEYS[code];
  const native = sqlStateMessageKey(err);
  if (native !== null) return native;
  return opts.isTransport?.(err) ? 'errors.network' : 'errors.generic';
}
