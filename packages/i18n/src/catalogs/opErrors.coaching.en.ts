/**
 * `op.errors.<CODE>` for coaching (docs/design/coaching/operator.md §5.19,
 * build contracts §1.10), spread at the end of `op.errors` in en.ts. Mirror
 * every key in opErrors.coaching.ar.ts.
 *
 * Each code lands with the migration that first raises it (check-error-codes
 * fails otherwise), in ERROR_CODE_KEYS (packages/i18n/src/errors.ts), which
 * the operator, the phone and the web all resolve through; the wording fits
 * staff and guests alike, and a screen with words of its own passes an
 * override. coaching_settings raises ONLINE_PAYMENT_OFF (set_coaching_settings, detail
 * `terms`: R50, R67); coaching_tables raises STATEMENT_NOT_DRAFT (the frozen statement
 * lines, R22). The detail sentences are the lane catalogs' (ws.coaching.*,
 * coaching.*), added with their screens.
 */
export const opErrorsCoachingEn = {
  ONLINE_PAYMENT_OFF: "Online payment isn't available for lessons here.",
  STATEMENT_NOT_DRAFT: "This statement isn't a draft any more.",
};
