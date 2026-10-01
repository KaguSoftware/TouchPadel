# Online deposit (Qi Card): build contracts

Date: 2026-09-27. Binding for every lane of the deposit build. The plan is
`qi-deposit-plan-2026-09-20.md`; where this file and the plan disagree, this file wins (it
was written against the code as of `69b532f5`, after multi-venue).

Status: built 2026-09-27 and tested on the local stack (fake provider) and against Qi's public
sandbox. On hosted, what remains is shipping the code, setting the Qi secrets and turning the
switch on in Settings (`docs/client/qi-card-activation.md`).

## 1. Decisions taken (owner can change every one in Settings later)

| Plan item | Taken | Where it lives |
|---|---|---|
| Deposit size | 50 % of the court price, at least 10,000 IQD, no cap, rounded **up** to 250 IQD | `venue_settings.deposit_percent_bp`, `deposit_min_iqd`, `deposit_max_iqd` |
| Launch mode | `off` until the owner switches it on; `optional` is the recommended first setting | `venue_settings.deposit_mode` |
| Payment window | 15 minutes | `venue_settings.deposit_window_seconds` (120..1800) |
| Cancelled booking (guest or staff) | deposit is always refunded | the `reservations` trigger (§2.4) |
| No-show | deposit is kept (forfeit), switchable | `venue_settings.deposit_forfeit_no_show` |
| Per-guest exemption | `customer_flags` type `deposit_exempt` turns `required` into `optional` for that guest | `app.deposit_mode_for` |
| App Review | `profiles.payment_sandbox` routes that guest's payments to Qi's sandbox; stamped `sandbox`, left out of figures | edge `deposit-begin` |
| Desk bookings | never need a deposit | `staff_create_reservation` untouched |

Guests cannot cancel inside the cancellation window (`CANCELLATION_WINDOW`), so the plan's
"forfeit inside the window" setting has nothing to act on and is not built.

## 2. Database (migrations 0241, 0242)

### 2.1 Tables

`booking_payments` (branch table, `zz_branch_guard` scoped): `id`, `venue_id`,
`reservation_id` (what the money is for, may move to a re-created booking), `hold_id` (the hold
the payment began on, never changes), `guest_id` (null after account deletion), `purpose`
('deposit'), `provider` ('qi' | 'fake'), `sandbox`, `request_id` (uuid, unique, what Qi gets),
`provider_payment_id` (Qi's paymentId, unique), `amount_iqd`, `quoted_price_iqd`, `locale`
('en' | 'ar'), `status`, `provider_status`, `form_url`, `deadline_at`, `last_checked_at`,
`succeeded_at`, `failed_at`, `expired_at`, `forfeited_at`, `refund_reason`,
`refund_amount_iqd`, `refund_request_id`, `refund_provider_id`, `refund_requested_at`,
`refunded_at`, `refund_attempts`, `cancel_attempts`, `failure_code`, `claimed_at`,
`created_at`, `updated_at`.

`status`: `created` → `pending` → `succeeded` | `failed` | `expired`;
`succeeded` → `refund_pending` → `refunded` | `refund_failed`; `refund_failed` → `refund_pending`
(retry) | `refunded` (manual).

`failure_code` (what the app shows on `failed`): `declined`, `auth_failed`, `bank_error`,
`cancelled`.

`refund_reason`: `guest_cancel`, `staff_cancel`, `no_show`, `slot_lost`, `venue_offline`,
`amount_mismatch`, `duplicate_success`, `manual`, `staff_refund`.

`booking_payment_events`: append-only log of every byte from Qi (and our own decisions).
Service-only.

### 2.2 Guest RPCs (`authenticated`, ownership-guarded)

`app.deposit_quote(p_hold_id uuid) → jsonb`

```json
{ "deposit_mode": "off|optional|required",
  "deposit_iqd": 20000, "price_iqd": 40000, "rest_iqd": 20000,
  "window_seconds": 900,
  "active": null | { "request_id": "uuid", "status": "created|pending", "form_url": "…", "deadline_at": "…" } }
```

`deposit_iqd`/`rest_iqd` are 0 and the mode is `off` when deposits are off. Refusals:
`AUTH_REQUIRED`, `HOLD_NOT_FOUND`, `FORBIDDEN`.

`app.deposit_status(p_request_id uuid) → jsonb` (guest: own; staff at the branch: any)

```json
{ "request_id": "uuid", "status": "created|pending|succeeded|failed|expired|refund_pending|refunded|refund_failed",
  "failure_code": null | "declined|auth_failed|bank_error|cancelled",
  "amount_iqd": 20000, "price_iqd": 40000, "rest_iqd": 20000,
  "deadline_at": "…", "form_url": "…" | null,
  "refund_reason": null | "…", "refund_amount_iqd": null | 20000, "refunded_at": null | "…",
  "sandbox": false,
  "deposit_mode": "optional",            // effective mode for this guest at this branch, now
  "attempts_left": 2,                    // new attempts allowed on this hold
  "hold_live": true,                     // the hold can still be paid or confirmed
  "reservation": { "id": "uuid", "kind": "hold|booking", "status": "…", "court_id": "uuid",
                   "start_at": "…", "end_at": "…", "venue_id": "uuid" },
  "server_now": "…" }
```

Refusals: `AUTH_REQUIRED`, `PAYMENT_NOT_FOUND` (unknown ref and someone else's ref look the same).

`app.my_reservations(p_reservation_id uuid default null)` gains three columns:
`online_paid_iqd bigint` (succeeded deposits net of refunds, 0 when none),
`payment_status text` (latest attempt's status or null), `payment_ref uuid` (its request_id or null).

`app.confirm_booking` now refuses `DEPOSIT_REQUIRED` for a guest when the effective mode is
`required` and the hold has no succeeded payment. Everything else is unchanged.

`app.release_hold` no longer releases a hold with a `created|pending` payment: it answers
`{released:false, status:'pending', payment_in_progress:true}`.

### 2.3 Staff RPCs

`app.deposit_settings(p_venue_id uuid default null) → jsonb` (manager, owner):
`{venue_id, deposit_mode, deposit_percent_bp, deposit_min_iqd, deposit_max_iqd,
deposit_window_seconds, deposit_forfeit_no_show}`.

`app.set_deposit_settings(p_patch jsonb, p_venue_id uuid default null) → jsonb` (owner): same
keys, returns the new settings. Bounds: `deposit_mode` in off/optional/required;
`deposit_percent_bp` 100..10000; `deposit_min_iqd` 0..10,000,000; `deposit_max_iqd` null or
≥ min; `deposit_window_seconds` 120..1800; `deposit_forfeit_no_show` boolean. Refusals:
`FORBIDDEN`, `INVALID_ARGUMENT` (detail = key). Audited `venue.deposit_settings`.

`app.deposit_attention(p_venue_id uuid default null) → jsonb` (manager, owner): array of
`{id, request_id, reservation_id, guest_name, guest_phone, amount_iqd, refund_amount_iqd,
status, refund_reason, refund_requested_at, refund_attempts, succeeded_at, sandbox,
court_name_en, court_name_ar, start_at}` for `refund_failed`, `refund_pending` older than
24 h, and `succeeded` whose booking is not live and not forfeited.

`app.deposit_refund_retry(p_payment_id uuid) → jsonb` (manager, owner): `refund_failed →
refund_pending`. Refusals: `FORBIDDEN`, `PAYMENT_NOT_FOUND`, `PAYMENT_STATE`.

`app.deposit_refund_manual(p_payment_id uuid, p_pin text, p_note text, p_device_id text default
null) → jsonb` (manager, owner): in `PIN_GATED_RPCS`, so the caller proves the PIN to
`verify_manager_pin` first and the RPC spends the 0115 grant. `refund_failed → refunded` only,
keeping the refund's reason (0258, open matches R23: a `refund_pending` refund may still be paid
by Qi, and a `succeeded` deposit is refunded with `deposit_refund_request`; a stuck
`refund_pending` turns `refund_failed` after ten unanswered attempts). Refusals: `FORBIDDEN`,
`PIN_GRANT_REQUIRED`, `PAYMENT_NOT_FOUND`, `PAYMENT_STATE`, `REASON_REQUIRED`.

`app.deposit_refund_request(p_payment_id uuid, p_amount_iqd bigint default null) → jsonb`
(manager, owner): `succeeded → refund_pending` with `refund_reason='staff_refund'` (partial
when an amount is given, e.g. a price override below the deposit). Refusals: `FORBIDDEN`,
`PAYMENT_NOT_FOUND`, `PAYMENT_STATE`, `REFUND_TOO_LARGE`.

`app.booking_bill` gains `online_paid_iqd` and `online_payments` (array of
`{id, status, amount_iqd, refund_amount_iqd, succeeded_at, refunded_at, sandbox}`).
`court_paid_iqd` already includes succeeded deposits for a live booking, so
`court_remaining_iqd` and every tab's court line charge only the rest.

`app.customer_flags` type `deposit_exempt` is accepted by `set_customer_flags`.

### 2.4 Server-only (service role)

`deposit_prepare`, `deposit_mark_created`, `deposit_apply`, `deposit_log_event`,
`deposits_due_for_reconcile`, `deposit_refund_apply`, `deposit_note_cancel_attempt`,
`deposit_nudge` (cron `tp_deposit_sweep`). A trigger on `reservations` turns a cancelled
booking's succeeded deposit into `refund_pending`, and a no-show's into a forfeit or a refund.

### 2.5 New error codes

Guest (mobile `CODE_TO_KEY`): `DEPOSITS_OFF`, `DEPOSIT_REQUIRED`, `TOO_MANY_ATTEMPTS`,
`PAYMENT_NOT_FOUND`. Staff (operator `MAPPED_CODES`): `PAYMENT_NOT_FOUND`, `PAYMENT_STATE`,
`REFUND_TOO_LARGE`. Edge-only (never raised by SQL): `PROVIDER_UNAVAILABLE`, `BAD_REQUEST`.

## 3. Edge functions (`packages/db/supabase/functions`)

Error body everywhere: `{ "error": "CODE", "message"?: "…" }`.

`POST deposit-begin` (user JWT). Body `{ "hold_id": uuid, "locale": "en"|"ar" }`.
200 → `{ "request_id", "form_url", "amount_iqd", "deadline_at", "status": "pending" }`.
Errors: 401 `AUTH_REQUIRED`, 400 `BAD_REQUEST` | `PHONE_REQUIRED`, 403 `FORBIDDEN`,
404 `HOLD_NOT_FOUND`, 409 `HOLD_EXPIRED` | `DEPOSITS_OFF`, 429 `TOO_MANY_ATTEMPTS`,
503 `PROVIDER_UNAVAILABLE` | `DEGRADED_LOCKOUT`. Calling it again for the same hold while an
attempt is live returns that attempt (same `request_id`, same `form_url`).

`POST deposit-status` (user JWT). Body `{ "ref": uuid }`. 200 → the `deposit_status` JSON
above, after asking Qi when the attempt is still open. Errors: 401, 400 `BAD_REQUEST`,
404 `PAYMENT_NOT_FOUND`. A Qi outage never changes the answer; it returns the last known state.

`POST deposit-webhook` (no JWT; Qi's RSA signature). `POST deposit-reconcile` (service role,
cron). `payments-fake` (local stack only): `GET /functions/v1/payments-fake?ref=<request_id>`
is the stand-in for Qi's payment page, with Succeed / Decline / Wrong OTP / Do nothing buttons.

Return path: Qi sends the browser to `https://www.touch-padel.com/{locale}/pay/return?ref=<request_id>`
(`PAYMENTS_SITE_URL` overrides the origin), which opens `touchpadel://pay/return?ref=<request_id>`.

## 4. Mobile (`apps/mobile`)

- `app/pay/return.tsx`: landing for `touchpadel://pay/return?ref=`; dismisses the browser and
  `router.replace('/pay/status?ref=…')`.
- `app/pay/status.tsx`: the one payment screen; renders only what `deposit-status` says
  (plan §5.3 table). Polls every 2 s for 60 s, then every 5 s until `deadline_at + 60 s`.
- `app/+not-found.tsx`: designed "That page isn't here" with My bookings and Book a court.
- Review: calls `deposit_quote` after the hold; `off` → today's Confirm; `optional` →
  "Pay {deposit} now" (primary) and "Confirm, pay at the desk" (secondary); `required` → only
  the pay button. Pay → `deposit-begin` → save pending payment → push `/pay/status` →
  `WebBrowser.openBrowserAsync(form_url)`.
- Pending payment persisted per user (`tp.pendingPayment.<userId>`), cleared on any terminal
  state and in the account-deletion purge.
- Booking detail and the bookings list: "Paid online X · Y at the desk" from
  `online_paid_iqd`; a hold with `payment_status` created/pending shows "Finish payment".
- i18n namespace `deposit.*` in `packages/i18n/src/catalogs/{en,ar}.ts`.

## 5. Web (`apps/web`)

`app/[locale]/pay/return/page.tsx`: never shows a result; opens the app, shows an
"Open the app" button and a download link; `noindex`.

## 6. Operator (`apps/operator`)

- Owner Settings: an "Online deposit" section (mode switch, percent, minimum, maximum,
  window, no-show rule) reading `deposit_settings`, writing `set_deposit_settings`.
- Court bill panel: "Paid online · X" line from `booking_bill.online_paid_iqd`.
- Manager Financial: "Online refunds needing attention" from `deposit_attention` with Retry
  (`deposit_refund_retry`) and "Settled another way" (`deposit_refund_manual`, manager PIN).
- Customer flags: `deposit_exempt` offered with the other flags.
