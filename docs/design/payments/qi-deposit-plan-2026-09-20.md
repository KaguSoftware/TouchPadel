# Online deposit for reservations — Qi Card, iOS + Android

Date: 2026-09-20. Status: plan, nothing built. Owner decisions are marked **DECIDE**.
Facts about Qi come from `developers-gate.qi.iq` and its OpenAPI spec (fetched 2026-09-20);
facts about this repo come from the code as of `3d70643`. Anything not verified is marked
**ASK QI** or **UNVERIFIED**, never assumed.

The bar set for this feature: no dead ends, no false positives ("paid" when not), no false
negatives ("failed" when paid), every server state maps to exactly one screen, every URL a
guest can land on exists before the first real credential is issued.

---

## 0. The one-paragraph design

A guest holds a slot as today (`app.hold_slot`). On Review, instead of "Confirm", the app calls
a new edge function `deposit-begin`, which (a) records a `booking_payments` row in state
`created` with a fresh UUID `request_id`, (b) extends the hold to cover a payment window,
(c) creates the payment at Qi with that `request_id`, and (d) returns Qi's hosted `formUrl`.
The app opens `formUrl` in the system in-app browser. Qi redirects to our web page
`/{locale}/pay/return?ref=<request_id>`, which bounces into the app via
`touchpadel://pay/return?ref=…`. The app then shows one screen, **Payment status**, which
only ever renders what the server says. The server learns the truth from Qi's signed
webhook and from its own status polls, and it alone confirms the booking, in the same
transaction that marks the payment `succeeded`. The desk sees the deposit as court fee already
paid and charges only the remainder, through the same `court_fee_remaining` that 0106 built.

Money never moves on the client. The client never decides success. A return URL, a closed
browser, or a push notification are hints to *go look*, never facts.

---

## 1. Integration surface: hosted page first, native SDK later

Qi offers two surfaces. Both were checked against their docs.

| | Hosted page (`formUrl`) | Native SDK (`PaymentSDKBridge`) |
|---|---|---|
| Distribution | none, it's a URL | local `.aar` + `.xcframework` files, not npm; the RN guide still says `react-native link` |
| Expo impact | none | config plugin + prebuild + custom dev client, on two platforms |
| Code paths | one, shared by iOS and Android | two native bridges + one JS bridge |
| Card entry | on Qi's PCI page | inside our binary (SDK is PCI-certified, we are not in scope) |
| SuperQi wallet | **ASK QI** whether the hosted page offers it | yes (`ALIPAY` method, QR or deep link, needs `finishPaymentUri` custom scheme) |
| Saved cards | no | yes (`PAYMENT_TOKEN`, needs non-null `accountId`) |
| 3DS | Qi handles it on their page | SDK handles it (`TDSSettings`) |
| Failure modes we own | browser closed early, return link not fired | native crash, SDK init state, two platforms' deep-link plumbing |

**Decision: build the hosted page first.** It is one code path, no native code, and every
failure mode is one we already handle elsewhere in the app (a deep link, a network call, a
poll). The server-side design below is identical for both surfaces, so the SDK can be added
later as "another way to reach `formUrl`'s outcome" without touching the state machine. The
SDK becomes worth it only if conversion data says guests want SuperQi wallet or saved cards.

Not chosen: `react-native-webview` embedding `formUrl`. 3DS pages, bank redirects and Qi's
`INVALID_PAYMENT_FORM_DOMAIN` error all argue against an embedded view; the system browser is
also what Apple and Google expect for third-party card entry.

---

## 2. What Qi actually gives us (verified)

Base URL, sandbox: `https://uat-sandbox-3ds-api.qi.iq/api/v1/`. Production URL: **ASK QI**.
Auth: `Authorization: Basic base64(user:pass)` + `X-Terminal-Id`. Sandbox credentials and a
test card are published on their docs (terminal `237984`, mobile test PAN
`5213720304238574`, 3DS OTP `123123`).

Endpoints we will use:

| Call | Method + path | We use it for |
|---|---|---|
| Create payment | `POST /payment` | `deposit-begin` |
| Status by our id | `GET /payment/status/by/request/{requestId}` | recovery when we never received `paymentId` |
| Status by Qi id | `GET /payment/{paymentId}/status` | confirmation after a webhook, reconciler |
| Cancel | `POST /payment/{paymentId}/cancel` | reconciler, when our deadline passes and the payment is still non-terminal |
| Refund | `POST /payment/{paymentId}/refund` (partial allowed, `amount` ≤ paid) | every refund path |

Create-payment request fields we send: `requestId` (UUID v4, ours, unique, never reused),
`amount`, `currency: "IQD"`, `locale`, `finishPaymentUrl`, `notificationUrl`, `customerInfo`
(`phone`, `accountId` = profile id), `additionalInfo` (`reservation_id`, `request_id`),
`appChannel: false` (true is only for the SDK).

Payment statuses (OpenAPI enum, 13 values). Terminal: `SUCCESS`, `FAILED`, `ERROR`,
`EXPIRED`, `AUTHENTICATION_FAILED`. Non-terminal: `CREATED`, `FORM_SHOWED`,
`THREE_DS_METHOD_CALL_REQUIRED`, `AUTHENTICATION_REQUIRED`, `AUTHENTICATION_STARTED`,
`AUTHENTICATED`, `INITIALIZED`, `STARTED`. Refund statuses: `SUCCESS`, `FAILED`, `PROCESSING`.
Any string outside these lists is treated as non-terminal and logged loudly.

Webhook: `POST` to our `notificationUrl`, JSON body with `requestId`, `paymentId`, `status`,
`amount`, `confirmedAmount`, `currency`, `creationDate`, `paymentType`, `details`
(`maskedPan`, `rrn`, `authId`…). Header `X-Signature` = base64 RSA-SHA256 over the string
`paymentId|amount.000|currency|creationDate|status` (missing values as `-`). Public key comes
from Qi support in PEM. Qi retries until we answer 200. **No replay protection, no timestamp.**
Their docs say: treat the verified webhook as authoritative, then confirm with the status call.
We do both, always.

Error codes we must handle by name: `1 ORDER_ALREADY_EXISTS`, `10 PAYMENT_ALREADY_EXISTS`
(our `requestId` was already used → recover by status-by-request), `12 PAYMENT_NOT_FOUND`,
`14 PROCESSING_IMPOSSIBLE`, `15 CAN_NOT_CANCEL_PAYMENT`, `18 REFUNDS_NOT_ALLOWED`,
`20 REFUND_ERROR` (retryable), `22 INCORRECT_PAYMENT_STATE`, `23 INTERNAL_SYSTEM_ERROR` and
`24 EXTERNAL_SYSTEM_ERROR` (retryable), `27 BAD_CREDENTIALS`, `28 LIMIT_VIOLATION`.

**ASK QI before go-live** (each one changes a number or a branch below):
1. Production base URL, terminal id, Basic credentials, webhook public key (PEM).
2. Payment expiry window (how long `formUrl` stays payable). `EXPIRED` exists but no window is documented.
3. Whether `finishPaymentUrl` may be a custom scheme, or must be https (we plan https regardless).
4. Whether IQD amounts must be whole dinars; their example sends `256.505` IQD.
5. Whether the hosted page offers SuperQi, or only cards.
6. Refund time limit after a successful payment, and whether refunds are synchronous or can sit in `PROCESSING`.
7. Whether webhook retries are capped, and the retry cadence.
8. Whether they allowlist our webhook IPs (Supabase edge egress is not fixed) or rely on the signature only.
9. Settlement schedule and fees, for the owner's reconciliation.

---

## 3. Server state machine (the only source of truth)

### 3.1 New table `booking_payments`

One row per payment attempt. Never updated by anything except `app.deposit_apply`.

```
id                   uuid pk
reservation_id       uuid not null references reservations
guest_id             uuid not null references profiles
purpose              text not null default 'deposit'         -- future: 'balance'
provider             text not null                           -- 'qi' | 'fake'
request_id           uuid not null unique                    -- what we send Qi
provider_payment_id  text unique                             -- Qi paymentId, null until create succeeds
amount_iqd           iqd not null                            -- what we asked for
quoted_price_iqd     iqd not null                            -- full court price at begin
players              smallint                                -- carried to confirm
locale               text not null
status               booking_payment_status not null         -- see 3.2
provider_status      text                                    -- last raw Qi status
form_url             text
deadline_at          timestamptz not null                    -- our payment window end
sandbox              boolean not null default false          -- see §9 (App Review)
succeeded_at, failed_at, refund_requested_at, refunded_at timestamptz
refund_request_id    uuid unique                             -- our requestId for the refund call
refund_provider_id   text
refund_amount_iqd    iqd
refund_reason        text                                    -- 'guest_cancel' | 'staff_cancel' | 'slot_lost' | 'amount_mismatch' | 'venue_offline' | 'duplicate_success' | 'manual'
failure_code         text                                    -- our short code for the app
created_at, updated_at timestamptz
```

Indexes: `booking_payments_one_active` unique on `(reservation_id)` where
`status in ('created','pending')` — at most one live attempt per reservation, enforced by
the database, not by the app. Index on `(status, deadline_at)` for the reconciler.

`booking_payment_events` — append-only (same `app.forbid_mutation()` trigger as `payments`):
`id, payment_id, source ('begin'|'webhook'|'poll'|'reconcile'|'refund'|'manual'), provider_status,
signature_ok boolean, raw jsonb, at`. Every byte Qi ever sends us lands here, matched or not
(unmatched webhooks get `payment_id null` and a `raw`), so nothing is ever "lost in a log".

### 3.2 States and transitions

```
created ──(Qi create ok)──▶ pending ──(SUCCESS, amount ok, hold confirmable)──▶ succeeded
   │                          │  │
   │                          │  └─(FAILED|ERROR|AUTHENTICATION_FAILED)──▶ failed
   │                          └────(EXPIRED, or our deadline + cancel)──────▶ expired
   └─(Qi create failed, deadline passed)──▶ expired

succeeded ──(cancel outside window | staff cancel | slot lost | mismatch)──▶ refund_pending
refund_pending ──(Qi refund SUCCESS)──▶ refunded
refund_pending ──(Qi refund FAILED / REFUNDS_NOT_ALLOWED)──▶ refund_failed   (manager attention)
refund_failed  ──(manager retry)──▶ refund_pending
refund_failed  ──(manager "settled otherwise", PIN)──▶ refunded  (refund_reason='manual')
```

Rules the SQL enforces (each one is a test):
- A terminal state (`succeeded`, `failed`, `expired`, `refunded`) is never overwritten by a
  non-terminal one. A late `FORM_SHOWED` after `SUCCESS` is logged and ignored.
- `succeeded` is only reachable when **all** hold: Qi status `SUCCESS`; `confirmedAmount`
  (or `amount`) equals `amount_iqd` to the dinar; currency `IQD`; and the reservation was
  confirmed in this same transaction, or was already confirmed by an earlier apply of the same
  payment. A `SUCCESS` that cannot confirm goes straight to `refund_pending`, never to
  `succeeded`-without-a-booking. That is the false-positive guard.
- A `FAILED`/`EXPIRED` from a *poll* is only applied if the status call was made after
  `deadline_at`, or the status is terminal at Qi. A transport error on our side never marks a
  payment failed. That is the false-negative guard.
- Two `SUCCESS` payments on one reservation: the second becomes `refund_pending`
  (`duplicate_success`). The unique active-attempt index makes this near-impossible, but the
  rule exists anyway.

### 3.3 RPCs (all `SECURITY DEFINER`, `search_path = public`, P0001 codes, in `rpc-allowlist.json` and the RLS matrix)

| RPC | Caller | Does |
|---|---|---|
| `app.deposit_quote(p_hold_id)` | guest (own hold) | Returns `{deposit_mode, deposit_iqd, price_iqd, window_seconds}` computed from `venue_settings`. Also folded into `hold_slot`'s return so Review needs no second call. |
| `app.deposit_prepare(p_hold_id, p_players, p_locale)` | service role, on behalf of the JWT user (passed as `p_guest_id`) | Locks the hold `FOR UPDATE`; refuses `HOLD_NOT_FOUND`, `FORBIDDEN`, `HOLD_EXPIRED`, `DEPOSITS_OFF`, `DEGRADED_LOCKOUT`, `PHONE_REQUIRED`, `TOO_MANY_ATTEMPTS` (>3 attempts on one hold). If an active attempt exists, returns it (idempotent). Else inserts `created`, sets `hold_expires_at = now() + deposit_window_seconds`, audits `reservation.deposit_begin`. Returns the row. |
| `app.deposit_mark_created(p_id, p_provider_payment_id, p_form_url, p_provider_status)` | service role | `created → pending`. |
| `app.deposit_apply(p_request_id, p_provider_status, p_amount, p_currency, p_raw, p_source, p_signature_ok)` | service role | **The only writer of terminal states.** Logs the event, then applies §3.2. On `SUCCESS`: calls `app.confirm_hold_internal` (see below). On confirm failure (hold swept, slot taken, degraded, price rule gone): tries once to re-insert the same court/time for the same guest as a fresh `booking`; if that also fails → `refund_pending` with `refund_reason`. |
| `app.confirm_hold_internal(p_hold_id, p_players, p_price_iqd, p_rate_rule_id)` | internal (revoked from clients) | The body of today's `confirm_booking`, factored out so the guest RPC and the deposit path share one implementation. Honors the quoted price: stamps `price_iqd = quoted_price_iqd` (the guest paid a deposit against that quote; a rate change mid-payment must not change what they owe). Audit `reservation.confirm` with `{via: 'deposit', payment_id}`. |
| `app.deposit_status(p_reservation_id)` | guest (own) / staff | The row's `status`, `failure_code`, `amount_iqd`, `deadline_at`, `refund_*` and the reservation's `status`. This is what the Payment status screen renders. |
| `app.deposit_request_refund(p_payment_id, p_reason)` | internal | `succeeded → refund_pending`. Called from `cancel_reservation` (guest outside window; any staff cancel), from `deposit_apply` (slot lost, mismatch), and from the manager UI. |
| `app.deposit_refund_apply(p_refund_request_id, p_provider_status, p_raw)` | service role | `refund_pending → refunded | refund_failed`. |
| `app.deposit_refund_manual(p_payment_id, p_pin, p_reason_code)` | manager/owner | Marks `refunded` with `refund_reason='manual'` after a manager PIN (same `PinReasonModal` path as till refunds). For "we gave them cash at the desk". |
| `app.deposits_due_for_reconcile(p_limit)` | service role | `pending` past `deadline_at`, `created` past `deadline_at`, `refund_pending` older than 60 s, `succeeded` whose reservation is not `confirmed|arrived|completed` (must be zero; if not, the reconciler refunds). `FOR UPDATE SKIP LOCKED`, same shape as `claim_due_notifications`. |
| `app.deposit_nudge()` | cron | `net.http_post` to `deposit-reconcile`, mirrored on `push_nudge`. |

`app.court_fee_paid` (0106) changes from "settled tabs' `court_iqd`" to that **plus**
`sum(amount_iqd) − sum(refund_amount_iqd)` of this reservation's `succeeded|refund_*|refunded`
payments (a refunded deposit no longer counts as paid). Nothing else in 0106 changes:
`court_fee_remaining`, `compute_tab_totals`, `settle_tab`, `settle_zero_tab`, `cancel_tab`,
`booking_bill_states` all inherit the deposit for free. `booking_bill` gains
`online_paid_iqd` and an `online_payments[]` list so the panel can show the line.

### 3.4 Where the deposit is *not* recorded

Deliberately **not** a row in `payments`: that ledger needs a staff `recorded_by`, an open
`day_sessions` row, and it feeds `cash_expected_iqd`. Putting a 03:00 online deposit there
would either fail (`NO_OPEN_DAY`) or corrupt the till count. `close_day` is untouched.
`v_day_close_summary` gains `online_payments_iqd` and `online_refunds_iqd` (payments
`succeeded_at` / `refunded_at` inside the session's window) as information-only columns.

`app.reports_figures` / `report_revenue` gain `online_iqd` next to `cash_iqd` / `card_iqd`.
Padel revenue stays `Σ reservations.price_iqd` and is not attributed to any staff member.

### 3.5 Settings (`venue_settings`, owner-writable via `set_venue_details`, mirrored on `venue_settings_public`)

| Column | Default | Meaning |
|---|---|---|
| `deposit_mode` | `'off'` | `off` / `optional` / `required`. The kill switch. |
| `deposit_percent_bp` | `5000` | basis points of `price_iqd` (5000 = 50 %). **DECIDE** |
| `deposit_min_iqd` | `10000` | floor. **DECIDE** |
| `deposit_max_iqd` | `null` | cap, null = none. |
| `deposit_window_seconds` | `900` | hold extension for the payment; 60..1800. Must be ≤ Qi's expiry (**ASK QI 2**). |
| `deposit_forfeit_inside_window` | `true` | guest cancels inside `cancellation_window_hours` → keep deposit. **DECIDE** |
| `deposit_forfeit_no_show` | `true` | **DECIDE** |

Amount = `clamp(round(price_iqd × bp / 10000), min, max)`, then rounded to `cash_rounding_iqd`.
Never computed on a client.

**Per-guest exemption (added 2026-09-20).** Some guests may book without a deposit even when
the venue mode is `required`. This reuses the existing `customer_flags` table (0065): a new
flag type `deposit_exempt` next to `vip | birthday | payment_note | special_request`, with an
optional label ("owner's friend", "club member"). The desk, manager and owner already edit
flags in `CustomerRecord` via `set_customer_flags`, and every change is audited
(`customer.flags_set`), so there is no new screen and no new permission.

The *effective* mode for one guest is computed in one place, `app.deposit_mode_for(p_guest_id)`:
`off` stays `off`; `optional` stays `optional`; `required` becomes `optional` when the guest
carries `deposit_exempt`. `hold_slot`, `deposit_quote`, `deposit_prepare` and
`confirm_booking`'s `DEPOSIT_REQUIRED` check all call it, so an exempt guest sees "Pay now"
as a choice, never as a gate, and `confirm_booking` accepts them without a payment.
`customer_flags` is staff-read only; the guest never sees the flag, only its effect.

Not chosen: piggy-backing on `vip`. VIP is a greeting flag the desk hands out freely; tying
money rules to it would change what "VIP" means without anyone deciding that. Also not
chosen for v1: automatic exemption after N clean bookings. It can be added later as a rule
inside `deposit_mode_for` without touching any caller. **DECIDE** whether a no-show should
strip the flag automatically (one line in `mark_reservation`), or leave it to the desk.

Desk-created bookings (`source='desk'`, `staff_create_reservation`) never require a deposit
regardless of flags: the desk is already standing in front of the guest.

### 3.6 Hooks into existing lifecycle RPCs

| Existing RPC | Change |
|---|---|
| `hold_slot` | returns `deposit_mode`, `deposit_iqd` in its JSON. |
| `confirm_booking` (guest) | when `deposit_mode = 'required'` and no `succeeded` payment exists → `DEPOSIT_REQUIRED`. Body moves to `confirm_hold_internal`. |
| `cancel_reservation` | after the status write: if a `succeeded` payment exists → guest outside window ⇒ `deposit_request_refund('guest_cancel')`; guest inside window ⇒ forfeit if `deposit_forfeit_inside_window` else refund; staff ⇒ refund `'staff_cancel'`. Audit carries the decision. |
| `mark_reservation('no_show')` | forfeit or refund per `deposit_forfeit_no_show`. |
| `release_hold`, `expire_stale_holds` | if an active (`created|pending`) payment exists on the hold, **do not** expire the hold; the payment window owns it. The reconciler releases it when the payment resolves. |
| `move_reservation`, `extend_reservation` | nothing: `court_fee_remaining` re-derives; if the new price is below the deposit, `booking_bill_states` already reports `refund_due` and the manager refunds the difference via `deposit_request_refund` with a partial amount. |
| `delete_my_account` | payments keep `guest_id` as a tombstone reference is not possible (FK) → set `on delete set null` on `booking_payments.guest_id`; the row and its money trail survive without a name, as reservations already do. |

---

## 4. Edge functions

All under `packages/db/supabase/functions/`. One vendor seam, cloned from the SMS pattern:

```
_shared/payments/types.ts     PaymentProvider { create, status, statusByRequest, cancel, refund }, errors
_shared/payments/qi.ts        the only file that knows qi.iq URLs, headers, field names
_shared/payments/fake.ts      local-only provider (see §8), refuses to load when !isLocalRuntime
_shared/payments/index.ts     paymentsFromEnv(): unset → misconfigured (rejects everything); 'qi' with missing secrets → misconfigured; 'fake' outside local → misconfigured
_shared/payments/verify.ts    verifyQiSignature({ publicKeyPem, header, payload }) — pure Web Crypto, testable under vitest, builds the pipe string byte-for-byte from the payload strings (never reformats creationDate or amount)
```

Boundary test cloned from `sms-provider.test.ts:364-401`: tokens `qi.iq`, `X-Terminal-Id`,
`QI_` may appear only under `_shared/payments/`.

| Function | `verify_jwt` | Auth | Does |
|---|---|---|---|
| `deposit-begin` | true | user JWT → `getCallerUserId` | `deposit_prepare` → provider `create` (10 s timeout) → `deposit_mark_created` → `{ request_id, form_url, amount_iqd, deadline_at }`. On provider code 1/10 → `statusByRequest(request_id)` and recover `paymentId`/`formUrl`. On timeout/5xx → leave `created`, answer `PROVIDER_UNAVAILABLE` (503); the next tap retries the same row. |
| `deposit-webhook` | **false** | RSA signature, fail-closed (no key ⇒ 401 for everything) | Verify → find row by `paymentId` (fallback `requestId`) → **call `status` at Qi** for the authoritative state → `deposit_apply(source='webhook')` → 200. Unknown payment ⇒ log event unmatched, 200 (so Qi stops retrying a payload we can never match). DB error ⇒ 500 (so Qi retries). Bad signature ⇒ 401, event logged with `signature_ok=false`. |
| `deposit-status` | true | user JWT | Reads `deposit_status`. If non-terminal and the last provider check is older than 3 s, calls Qi `status` and applies (`source='poll'`). Returns the DB row after apply. This is the path that makes a lost webhook harmless. |
| `deposit-reconcile` | true (service role only, `isServiceRoleRequest`) | cron via `deposit_nudge` | `deposits_due_for_reconcile` → per row: `pending` past deadline → Qi status; still non-terminal → Qi `cancel` → `expired`. `created` past deadline (Qi create never succeeded) → `statusByRequest`; not found → `expired`. `refund_pending` → Qi `refund` (idempotent by `refund_request_id`; if `refund_request_id` is set, query instead of re-sending) → `deposit_refund_apply`. `succeeded` with unconfirmed reservation → `deposit_request_refund('slot_lost')`. Every action bounded to 100 rows and a 45 s budget under the cron's 60 s lease. |

Secrets (`.env.example` + `supabase secrets set`): `PAYMENTS_PROVIDER` (`qi` | `fake`),
`QI_BASE_URL`, `QI_TERMINAL_ID`, `QI_BASIC_USER`, `QI_BASIC_PASS`, `QI_WEBHOOK_PUBLIC_KEY_PEM`,
`QI_SANDBOX_BASE_URL`, `QI_SANDBOX_TERMINAL_ID`, `QI_SANDBOX_BASIC_USER`,
`QI_SANDBOX_BASIC_PASS`, `QI_SANDBOX_WEBHOOK_PUBLIC_KEY_PEM`, `SITE_URL` (for
`finishPaymentUrl`), plus the existing `functions_base_url` in `app.secrets` for
`notificationUrl` and the nudge. Hosted logs redact `maskedPan`, `rrn`, phone — same rule as
`sms/log.ts`.

`config.toml`: add all four functions to the explicit `verify_jwt` block.
`tp_deposit_sweep` cron every 30 s (fallback `* * * * *`), guarded like the others.

---

## 5. Mobile app (iOS and Android, one code path)

### 5.1 Routes to add (and the one that is missing today)

| Route file | Path | Purpose |
|---|---|---|
| `app/pay/return.tsx` | `/pay/return?ref=` | Deep-link landing. Calls `WebBrowser.dismissBrowser()` (iOS), stores nothing, `router.replace('/pay/status', { ref })`. Renders a spinner for the one frame it lives. |
| `app/pay/status.tsx` | `/pay/status?ref=` | **The** payment screen. `RequireSession`. Polls `deposit-status`. Renders exactly one of the states in §5.3. |
| `app/+not-found.tsx` | any unknown path | **Does not exist today.** Any malformed deep link, an old push, or a typo'd return URL would render expo-router's default. This screen says "That page isn't here", offers "My bookings" and "Book a court", and logs the URL. Required before any external party can send us a URL. |

Review (`app/review.tsx`) changes: reads `deposit_mode`/`deposit_iqd` from the hold result.
`off` → today's "Confirm" button. `optional` → primary "Pay {deposit} now, {rest} at the desk",
secondary "Confirm and pay everything at the desk". `required` → only the pay button; the
`PayAtDeskCard` copy changes to "Pay {rest} at the desk". Before navigating to `/pay/status`
it sets `keepHoldRef` so `beforeRemove` does not fire `release_hold` — the payment window
owns the hold now.

`src/navigation/__tests__/routes.test.ts` is updated for the new push targets and the
`+not-found` file; it must keep asserting "no route group except `(tabs)`".

### 5.2 Opening the page and coming back

```
begin = await depositBegin({ holdId, players, locale })      // edge deposit-begin
await savePendingPayment({ ref: begin.request_id, reservationId, deadlineAt })   // AsyncStorage, per user
router.push('/pay/status', { ref })                                              // screen mounts first
WebBrowser.openBrowserAsync(begin.form_url, { presentationStyle: 'pageSheet' })  // iOS SFSafariViewController, Android Custom Tab
```

Return paths, all of which land on `/pay/status` already mounted underneath:
1. Qi → `https://<site>/{locale}/pay/return?ref=…` → page redirects to
   `touchpadel://pay/return?ref=…` → `Linking` `url` event → `app/pay/return.tsx` →
   `dismissBrowser()`.
2. Guest closes the browser sheet themselves → `openBrowserAsync` resolves `{type:'cancel'}`
   → the status screen is still there and keeps polling. **Nothing is inferred from
   `cancel`**: the bank may have completed the charge a second before they closed it.
3. App killed while in the bank's 3DS page → next launch, `pendingPayment` is found →
   the app opens `/pay/status` for it (after sign-in if needed; `continueAfterAuth` checks
   `pendingPayment` before `pendingSlot`).
4. Guest switches to the bank app for an OTP and back → `AppState` active → the status
   screen refetches immediately.

Why `openBrowserAsync` and not `openAuthSessionAsync`: `ASWebAuthenticationSession` shows a
system alert "touchpadel wants to use qi.iq to sign in", which is wrong copy for a payment.
`SFSafariViewController` opens a custom-scheme redirect straight into the app and we dismiss
it ourselves. **Verify on both platforms in sandbox** (checklist §10): iOS scheme redirect
from SFSafariViewController; Android Custom Tab → intent to our scheme (Chrome may block a
scheme redirect fired without a user gesture, which is why the web return page also shows a
button, §6).

The Linking listener lives next to `useAuthDeepLink`: `parseAuthLink` already returns `null`
for non-auth URLs and lets expo-router route by path, so `/pay/return` reaches its screen with
`ref` in `useLocalSearchParams` and needs no change to the auth hook.

### 5.3 The status screen: server state → one screen

`deposit-status` returns `{ payment: {status, failure_code, amount_iqd, deadline_at,
refund_reason}, reservation: {status} }`. Mapping, exhaustive, tested as a pure function
(`src/features/deposit/logic.ts` → `screenFor(status)`):

| Server says | Screen | Actions |
|---|---|---|
| `created` / `pending`, before deadline | **Checking your payment** — spinner, court + time, amount, "Keep this screen open or return to the bank page" | "Open payment page again" (re-opens `form_url`; safe, Qi serves the same payment) · "Cancel" (→ confirm? see below) |
| `pending`, after deadline, not yet reconciled | **Still checking** — "This is taking longer than usual. We'll notify you the moment it settles." | "My bookings" |
| `succeeded` + reservation `confirmed` | → `router.replace('/success')` with the deposit line ("Paid now X · at the desk Y") | as today |
| `failed` | **Payment didn't go through** — `failure_code` text (declined / authentication failed / bank error) | "Try again" (new attempt, same hold, if hold still live and attempts < 3) · "Pay at the desk instead" (only when `deposit_mode='optional'`; calls `confirm_booking`) · "Choose another time" |
| `expired` | **Payment window ended** — the hold was released | "Book again" (→ availability at the same day) |
| `succeeded` but reservation not confirmed, i.e. `refund_pending` (`slot_lost`, `venue_offline`, `amount_mismatch`) | **We couldn't keep that slot** — "Your payment of X is being refunded to your card. Refunds take N business days." | "Choose another time" · "Call the venue" |
| `refunded` | **Refunded** — amount, date | "My bookings" |
| `refund_failed` | **We're sorting out your refund** — "The venue will contact you." | "Call the venue" |
| network error while polling | keeps the last known screen and shows the existing offline banner; never regresses to "failed" | |
| `deposit-status` says `RESERVATION_NOT_FOUND` / `FORBIDDEN` (foreign ref, deleted account) | **Nothing to show here** (the `+not-found` design) | "My bookings" |

"Cancel" on the checking screen does not cancel money. It asks "If you already paid, we'll
still confirm your booking. Leave this screen?" and goes to My bookings; the reconciler and
push notifications finish the job. There is no client action that can lose a paid booking.

Polling: every 2 s for the first 60 s, then every 5 s until `deadline_at + 60 s`, then stop
and rely on push. `refetchOnWindowFocus` on. The screen is idempotent: mounting it twice
(deep link + pending resume) is harmless.

### 5.4 Elsewhere in the app

- Bookings tab (`(tabs)/bookings.tsx`): a held slot with an active payment shows
  "Payment in progress" with **Finish payment** (→ `/pay/status`). Confirmed rows show
  "Deposit paid · X" from `deposit_status` folded into `fetchMyReservations` via a
  guest-readable view `my_booking_payments` (RLS `guest_id = auth.uid()`).
- Booking detail: "Paid online X · Pay Y at the desk", and refund state when cancelled.
  The cancel confirmation sheet states the money outcome before the guest taps
  ("Your deposit of X will be refunded" / "…will not be refunded") — from server rules via
  `venue_settings_public`, never computed locally.
- New push kinds: `deposit_refunded`, `deposit_failed` (only when the guest is no longer on
  the status screen, i.e. sent by the reconciler, not by `deposit_apply` on the poll path).
  `booking_confirmed` already fires from the reservations trigger on confirm.
- `errors.ts` gains: `DEPOSITS_OFF`, `DEPOSIT_REQUIRED`, `TOO_MANY_ATTEMPTS`,
  `PROVIDER_UNAVAILABLE`, `PAYMENT_NOT_FOUND`.
- i18n: new `deposit.*` namespace in `packages/i18n/src/catalogs/{en,ar}.ts`; every amount
  wrapped in `isolate()` in Arabic sentences; `booking.payAtDeskBody` / `successPayBody` /
  the FAQ entry are rewritten to be true under all three modes.
- `pendingPayment` is **persisted** (unlike `pendingSlot`, which is in-memory by design):
  key `tp.pendingPayment.<userId>`, cleared on any terminal state, and named in the SEC-16
  deletion purge list.

---

## 6. Web return page (`apps/web`)

`app/[locale]/pay/return/page.tsx`, `export const dynamic = 'force-dynamic'`, no cookies.
Reads `ref`. On load: `location.replace('touchpadel://pay/return?ref=' + ref)`. Renders, in
the locale: "Return to the Touch Padel app to see your booking", a big **Open the app** button
(same link, for browsers that block unprompted scheme navigation), a "Don't have the app?"
link to `/{locale}/download`. **It never shows a payment result** — it does not know one, and
a page that says "Paid" from a URL parameter is exactly the false positive we are avoiding.
`robots`: noindex. `not-found.tsx` already exists for anything else.

This page must be deployed and reachable (`curl -sI` 200 in both locales) **before** the
production `finishPaymentUrl` is ever given to Qi. It is a go-live gate (§10), not a nicety.

When `EXPO_PUBLIC_LINK_DOMAIN` becomes real, the same path becomes a universal link and the
scheme hop disappears; nothing else changes.

---

## 7. Operator app

- `CourtBillPanel`: `online_paid_iqd` line ("Paid online · X"), and the payments history
  gets a third label (`ws.courtDesk.payment.online`) where line 258 currently assumes
  cash-or-card. `ChargeCell` already has `partlyPaid`.
- `PaymentPane` `due` is already the remainder; nothing changes at the till.
- Day close: `online_payments_iqd` / `online_refunds_iqd` as information rows (not
  reconciled against drawer or terminal), in `SUMMARY_COLUMNS`, `DaySummaryRow`, the CSV,
  and `ws.manager.dayClose.*` in both languages.
- Revenue report + panel: `online` next to `cash` / `card` (`PaymentMethodFilter` grows a
  third value; `reportTypes.ts`, `reportPayloads.ts`, figures).
- Manager → Financial: **Online refunds needing attention** list (`refund_failed`, and
  `refund_pending` older than 24 h): Retry, or "Settled by other means" behind the manager
  PIN (`deposit_refund_manual`). This is the human path so no refund can be stuck forever.
- Owner → Settings → Venue details: the deposit rule fields from §3.5, with the mode switch.
- `packages/core/src/schemas/mutations.ts` keeps `z.enum(['cash','card'])` for till
  settlement: deposits are not a till payment method and must not be selectable there.

---

## 8. Local development without Qi

`PAYMENTS_PROVIDER=fake`, loadable only when `isLocalRuntime()`. `fake.ts` returns a
`formUrl` pointing at a tiny local page served by a `payments-fake` edge function
(local-only, refuses to deploy hosted by checking `isLocalRuntime` at start) with four
buttons: **Succeed**, **Fail**, **Authentication failed**, **Do nothing** (leaves it pending
so the deadline/cancel path can be exercised). Each button posts a correctly-shaped webhook
to `deposit-webhook`, signed with a local test key pair committed under
`packages/db/supabase/functions/_shared/payments/__fixtures__/`. This gives the whole
state machine, the app screens and the desk panel a run on the local stack with no Qi
account, and it is what the DB tests drive.

---

## 9. Apple, Google, and the review account

- IAP is not required: court time is a service used outside the app (Guideline 3.1.3(e), as
  already cited in `docs/store/app-store-submission.md`). Google Play's equivalent policy
  also excludes physical services. Card entry happens on Qi's page in the system browser,
  not in our binary.
- Update, in this order, before submitting the build: `app-store-listing.md` promo text and
  the "PAY AT THE DESK" description block (both languages), the FAQ/legal copy in the
  catalogs, the privacy nutrition label (Financial Info → **Payment Info** likely stays "not
  collected" because the app never sees card data, but "Purchase History" linked to the user
  becomes Yes), Play Console Data safety to match, and the review notes: cite the exemption,
  describe the flow, and give the reviewer a way to finish it.
- Reviewer flow: `profiles.payment_sandbox boolean` (owner-set on the review account).
  `deposit-begin` reads it and uses the `QI_SANDBOX_*` credentials for that account only;
  the row is stamped `sandbox=true` and excluded from every revenue figure. The review notes
  then give Qi's published test card and OTP. Launch with `deposit_mode='optional'` so a
  reviewer (or any guest) can also skip payment.
- A new build and a fresh review are required regardless (native scheme handling and
  `+not-found` are binary changes). Check whether 1.0.0 is already live before bumping.

---

## 10. Situations we must survive, and what each one does

Each row is a test (DB, edge, or manual sandbox), and each names the state, the guest's
screen, and the desk's view. "Guest sees" refers to §5.3.

| # | Situation | Server outcome | Guest sees | Desk sees |
|---|---|---|---|---|
| 1 | Happy path, webhook arrives before the guest returns | `succeeded`, reservation `confirmed` | Success | "Part paid · Y due" |
| 2 | Happy path, webhook lost entirely | poll → Qi `SUCCESS` → same as 1 | Success, ~2 s later | same |
| 3 | Guest closes browser before paying | `pending` until deadline → reconciler cancels at Qi → `expired`, hold expires | Checking… → Payment window ended | slot free again |
| 4 | Guest closes browser one second after the bank approved | webhook/poll `SUCCESS` → `succeeded` | Checking… → Success | part paid |
| 5 | App killed mid-3DS, reopened 10 min later | `pendingPayment` resume → status | whichever terminal state | — |
| 6 | Airplane mode after paying | polls fail → screen holds "Checking…" + offline banner; webhook confirms server-side; push arrives when online | Success on reconnect | part paid |
| 7 | Card declined | `failed` (`failure_code=declined`), hold still live | Didn't go through → Try again | — |
| 8 | 3DS OTP wrong | `AUTHENTICATION_FAILED` → `failed` | same, with auth text | — |
| 9 | Double tap "Pay now" / two devices | unique active-attempt index → same row, same `form_url` | one browser | — |
| 10 | `deposit-begin` times out after Qi created the payment | row stays `created`; retry → code 10 → `statusByRequest` recovers `paymentId` | Try again works | — |
| 11 | `deposit-begin` fails before Qi | row `created`, deadline passes → `expired`; hold expires normally | "Payment service unavailable" + pay at desk (optional mode) | — |
| 12 | Desk moves/cancels the hold's slot during payment | hold row is locked by neither; on `SUCCESS` confirm fails (`SLOT_TAKEN`) → re-insert attempt → else `refund_pending('slot_lost')` | We couldn't keep that slot + refund | nothing (booking never existed) |
| 13 | Hold swept before `SUCCESS` (should not happen: sweep skips holds with active payments) | re-insert same slot for same guest; else refund | Success or slot-lost | — |
| 14 | Venue goes degraded between begin and success | `assert_not_degraded_for` refuses → `refund_pending('venue_offline')` | slot-lost variant | — |
| 15 | Webhook `amount` ≠ our amount | never `succeeded`; `refund_pending('amount_mismatch')`; manager alert | slot-lost variant | attention list |
| 16 | Webhook replayed (same payload twice) | second apply is a no-op; event logged | — | — |
| 17 | Webhook forged / bad signature | 401, event logged `signature_ok=false`; state untouched | — | — |
| 18 | Webhook for unknown `paymentId` | 200, unmatched event; reconciler surfaces it | — | attention list |
| 19 | Webhook arrives with non-terminal status after `succeeded` | ignored, logged | — | — |
| 20 | Qi says `EXPIRED` while we still think `pending` | `expired`; hold released | Payment window ended | — |
| 21 | Our deadline passes, Qi still non-terminal, cancel call fails (code 15) | keep `pending`, retry next sweep; after 3 failed cancels mark `expired` and log | Still checking → push | — |
| 22 | Guest cancels booking outside window | `refund_pending('guest_cancel')` → Qi refund → `refunded` | Refunded | booking cancelled, `refund_due` not shown (deposit no longer counts) |
| 23 | Guest cancels inside window | forfeit (or refund per setting), stated before they confirm | Cancelled, "deposit not refunded" | — |
| 24 | Staff cancels a paid booking | `refund_pending('staff_cancel')` | push `deposit_refunded` | attention list until refunded |
| 25 | No-show on a paid booking | forfeit (per setting); `court_fee_remaining` is 0 for no_show anyway | booking no_show | — |
| 26 | Qi refund `FAILED` / `REFUNDS_NOT_ALLOWED` | `refund_failed` | "We're sorting out your refund" | attention list → retry / manual |
| 27 | Refund sits in `PROCESSING` for days | stays `refund_pending`; >24 h shows in attention list | Refunded appears when done | attention list |
| 28 | Staff extends the booking after deposit | `court_fee_remaining` grows; desk charges difference | detail shows new price, same deposit | "Owed again · Δ" |
| 29 | Price override below deposit | `refund_due` state (0106) → manager partial refund via deposit path | Refunded (partial) | refund due → done |
| 30 | Two `SUCCESS` payments on one reservation | second → `refund_pending('duplicate_success')` | Success + a refund notice | part paid once |
| 31 | `deposit_mode` switched to `off` mid-flow | `deposit_prepare` refuses `DEPOSITS_OFF` → Review falls back to Confirm; an in-flight payment still resolves normally | Confirm works | — |
| 32 | Deep link `touchpadel://pay/return` with garbage `ref` | status → `PAYMENT_NOT_FOUND` | Nothing to show here | — |
| 33 | Deep link to a route that doesn't exist | `+not-found` | designed screen | — |
| 34 | Web return page opened on desktop | shows "Open the app" + download | — | — |
| 35 | Guest signed out when the deep link fires | `/welcome` → sign in → `pendingPayment` resumes status | status | — |
| 36 | Account deleted with a `succeeded` deposit | `guest_id` set null; money trail kept; refund needs manual | — | attention list |
| 37 | Day close with online deposits | untouched cash/card expectations; info rows shown | — | close proceeds |
| 38 | Reports | `online_iqd` column; padel revenue unchanged | — | owner report |
| 39 | Qi outage during begin | `PROVIDER_UNAVAILABLE`; nothing recorded at Qi | try again / pay at desk | — |
| 40 | Qi outage during reconcile | rows stay; next sweep; nothing marked failed on our transport errors | Still checking | — |
| 41 | Secrets unset on hosted | provider `misconfigured` → every begin refused with `PROVIDER_UNAVAILABLE`; webhook 401 | pay at desk | — |
| 42 | Sandbox row on the review account | `sandbox=true`, excluded from figures | Success | shown, flagged "test" |
| 43 | Guest with `deposit_exempt` flag, venue mode `required` | `deposit_mode_for` → `optional`; `confirm_booking` accepts without payment | Review shows Pay now + Confirm without paying | booking "Not paid yet · full price" |
| 44 | Flag removed while the guest is on Review | next call recomputes; `confirm_booking` → `DEPOSIT_REQUIRED` | Review refreshes to pay-only with a notice | — |

Invariants checked by `check:invariants` after every test run:
- I1 at most one `created|pending` payment per reservation.
- I2 every `succeeded` payment's reservation is `confirmed|arrived|completed`.
- I3 every `refund_pending|refunded|refund_failed` has `refund_reason`.
- I4 no `payments` (till ledger) row has `recorded_by` null; no `booking_payments` row is a till payment.
- I5 `court_fee_remaining ≥ 0` for every booking.
- I6 every `booking_payments` row has ≥ 1 event.

---

## 11. Tests and gates

- **DB** (`packages/db/tests/deposits.test.ts`, live local stack, narrative style like
  `desk-payment.test.ts`): every §10 row that is server-side, every §3.2 transition and its
  refusal, `hold_slot` quote, `confirm_booking` `DEPOSIT_REQUIRED`, the sweep skipping
  holds with active payments, `court_fee_paid` with and without refunds, `booking_bill`
  and `booking_bill_states` figures, day-close columns, report columns, `delete_my_account`.
  Add the RPCs to `fixtures/rpc-allowlist.json` and `tests/rls-matrix.ts` (guest can read
  only own rows; `court_desk` can read payment status but not events; `cashier` per 0106).
  `check:authz` will call every new RPC with NULL args as a guest and expect a refusal.
- **Edge** (pure, no stack): `verify.test.ts` with a captured sandbox webhook + the local
  key pair (exact pipe string, tampered amount, tampered status, wrong key, missing header);
  `qi.test.ts` with `fetch` stubbed (exact URL, headers, body, error-code mapping, timeout);
  `payments-provider.test.ts` selection + fail-closed + boundary tokens; `apply.test.ts`
  status→transition table.
- **Mobile** (node-only pure tests): `screenFor()` exhaustive over every status and
  reservation-status pair (a `never` check so a new status cannot be forgotten);
  `pendingPayment` persistence/cleanup; return-URL parsing; `errors.ts` new codes;
  `routes.test.ts` updated.
- **Web**: Playwright: `/en/pay/return?ref=x` and `/ar/pay/return?ref=x` render the button,
  set `noindex`, and never contain the words "paid" / "success".
- **Manual sandbox runbook** (both platforms, on a phone via Metro, screenshots into
  `docs/design/payments/`): rows 1, 3, 4, 5, 6, 7, 8, 9, 34, 35 from §10, plus the two
  browser-return mechanics called out in §5.2.

---

## 12. Build order and lanes

Lanes can run in parallel after A. Each lane names the files it claims (shared tree rule).

- **Lane Q — Qi onboarding (start today, longest pole):** send the §2 ASK-QI list, request
  production credentials and the webhook public key, register our `notificationUrl`
  (`<functions>/deposit-webhook`) and `finishPaymentUrl` domain. Owner signs the merchant
  agreement.
- **Lane A — DB (`packages/db`):** migration `20260920000108_online_deposits.sql` (tables,
  enum, settings, RPCs, `court_fee_paid`, `booking_bill`, day-close view, report figures,
  `cancel_reservation`/`mark_reservation`/sweep hooks, cron, outbox kinds), tests, allowlist,
  RLS matrix, `pnpm db:types` committed in the same change.
- **Lane B — Edge (`packages/db/supabase/functions`):** `_shared/payments/*`, four functions
  + `payments-fake`, `config.toml`, `.env.example`, `send-push` copy for the two new kinds,
  tests.
- **Lane C — Mobile (`apps/mobile`):** `+not-found`, `pay/return`, `pay/status`, Review
  changes, `features/deposit/{api,logic,pendingPayment,hooks}.ts`, bookings/detail chips,
  i18n, errors, routes test.
- **Lane D — Web (`apps/web`):** `/[locale]/pay/return`, Playwright.
- **Lane E — Operator (`apps/operator`):** bill panel line, day-close rows, report column,
  refunds attention list, owner settings fields, i18n en/ar.
- **Lane F — Store:** listing copy, privacy labels, review notes, `payment_sandbox` flag on
  the review account.

Go-live gates, in order: A+B green on the local stack with the fake provider → sandbox
end-to-end on a phone, both platforms, all §11 manual rows → web return page live in both
locales → production secrets set and `deposit-webhook` answering 401 to an unsigned POST →
`deposit_mode='optional'` for one week with the owner watching the attention list and the
`online_iqd` figure → `required` if the owner wants it.

---

## 13. Decisions for the owner (**DECIDE**)

1. Deposit size: percent and floor (§3.5 defaults are placeholders).
2. Inside the cancellation window: forfeit or refund.
3. No-show: forfeit or refund.
4. Launch mode: `optional` (recommended) or `required`.
5. Whether the desk may take the deposit for a phone booking in cash instead (today: yes,
   nothing prevents settling the whole fee at the desk; the deposit simply reduces it).
6. Who gets the refund-attention alerts (manager Telegram channel already exists).
7. Whether a no-show automatically removes a guest's `deposit_exempt` flag.
