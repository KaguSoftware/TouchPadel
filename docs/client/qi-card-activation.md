# Online deposit (Qi Card): the activation runbook

Guests can pay a deposit on a court booking in the app, on Qi Card's own payment page. Everything is built
and tested, and it stays switched off until the steps below are done. Nothing a guest sees changes until
§D, when the owner turns it on in Settings.

**Status (2026-09-27):** built and tested on the local stack and against Qi's public sandbox. **Not on
hosted yet:** the code sits in the working tree under the push hold. Not activated.

- Design: `docs/design/payments/qi-deposit-plan-2026-09-20.md`. Binding shapes:
  `docs/design/payments/build-contracts-2026-09-27.md`.
- Database: migrations 0241 (tables, settings) and 0242 (the state machine and its hooks).
- Edge functions: `deposit-begin`, `deposit-status`, `deposit-webhook`, `deposit-reconcile`, and
  `payments-fake` (runs on the local stack only). Qi's URLs, headers and field names live only in
  `packages/db/supabase/functions/_shared/payments/`.
- Apps: the mobile Review, payment and booking screens; the website's `/{locale}/pay/return`; the operator's
  Settings, bill panel, refund list and customer flag.

---

## A. What to get from Qi Card

Hand these over the way `API.md` says ("How to hand these over"), never in chat.

| # | Item | Goes into | Notes |
|---|---|---|---|
| A1 | Production API base URL | `QI_BASE_URL` | Must be https, e.g. `https://…qi.iq/api/v1`. Qi does not publish it; ask. |
| A2 | Terminal id | `QI_TERMINAL_ID` | Sent as `X-Terminal-Id`. |
| A3 | Basic-auth username and password | `QI_USERNAME`, `QI_PASSWORD` | |
| A4 | Qi's webhook public key (PEM) | `QI_WEBHOOK_PUBLIC_KEY_PEM` | "Contact the Payment Gateway team to request it" (their docs). Either `BEGIN PUBLIC KEY` or `BEGIN RSA PUBLIC KEY` works. Until it is set, a webhook is only a hint to ask Qi (see §F), so payments still complete. |
| A5 | Does our terminal use **signature-based auth**? | `QI_SIGNING_PRIVATE_KEY_PEM` | Only if Qi says yes. Then generate a key pair (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out qi-signing.pem`), send Qi the public half (`openssl rsa -in qi-signing.pem -pubout`), and set the private PEM as the secret. |
| A6 | Allow our return address | — | Tell Qi the payment page returns to `https://www.touch-padel.com/{en,ar}/pay/return` and that notifications go to `https://lczijabnorujcgmbuqlw.supabase.co/functions/v1/deposit-webhook`. Qi's error 26 (`INVALID_PAYMENT_FORM_DOMAIN`) suggests domains can be allow-listed. |
| A7 | Still open with Qi | — | How long a payment page stays payable (our window is 15 min and must be shorter), refund time limit, settlement schedule and fees, whether webhook retries stop, whether they allow-list IPs. None of these block activation. |

## B. Ship the code (lifts the push hold, so only on Majed's word)

1. Push `main`. Because `packages/db` changed, this runs **DB Migrate** (applies 0241 and 0242 to hosted),
   **Functions Deploy** (the five functions and `send-push` with the new `deposit_refunded` copy) and the
   Vercel build (the return page). Follow each run to green (root `CLAUDE.md`, "Pushing").
2. Confirm the return page is live in both languages:
   `curl -sI 'https://www.touch-padel.com/en/pay/return?ref=00000000-0000-4000-8000-000000000000'` and the
   same with `/ar/`: both 200.
3. Confirm `functions_base_url` is in the vault (the refund sweeper uses it, like push):
   `select name from vault.secrets where name in ('functions_base_url', 'service_role_key');` returns both rows.
4. Confirm the sweeper is scheduled: `select jobname, schedule from cron.job where jobname = 'tp_deposit_sweep';`
5. A **new mobile build** is needed (new screens and routes). Production `eas build` and store submission are
   Parsa's to run. Before submitting, update the store copy that says "pay at the desk", plus the privacy
   answers (plan §9): the app never sees card data, but "Purchase History" becomes yes.

## C. Set the secrets (hosted)

From `packages/db`:

```sh
pnpm exec supabase secrets set --project-ref lczijabnorujcgmbuqlw \
  PAYMENTS_PROVIDER=qi \
  QI_BASE_URL='https://…' QI_TERMINAL_ID='…' QI_USERNAME='…' QI_PASSWORD='…' \
  QI_WEBHOOK_PUBLIC_KEY_PEM="$(cat qi-webhook-public.pem)"
```

Optional:
- `QI_SIGNING_PRIVATE_KEY_PEM="$(cat qi-signing.pem)"` for signature-based auth only (A5).
- The sandbox, for the store review account (§E): `QI_SANDBOX_TERMINAL_ID`, `QI_SANDBOX_USERNAME` and
  `QI_SANDBOX_PASSWORD`, from Qi's public "Sandbox Environment" page. `QI_SANDBOX_BASE_URL` defaults to Qi's
  sandbox host.
- `PAYMENTS_SITE_URL` only if the website moves off `https://www.touch-padel.com`.

What each state does:
- `PAYMENTS_PROVIDER` unset: every "Pay now" answers "payment unavailable", nothing is recorded or charged,
  and the app offers pay at the desk.
- A secret missing or `QI_BASE_URL` not https: the same, with the reason in the function log
  (`[payments] qi is misconfigured: missing …`).

## D. Turn it on (the owner, in the operator)

Settings → Venue details → **Online deposit (Qi Card)**. Per branch:
- Mode: **off** (default), **optional** (Pay now, or pay everything at the desk), or **required** (pay first).
  Start with **optional** for a week and watch the refund list.
- Deposit: 50 %, at least 10,000 IQD, no maximum, 15 minutes to pay, no-show keeps the deposit. All can be
  changed.
- One guest can be excused from `required`: the desk sets the customer flag **No deposit needed**.

Turning it back **off** stops new payments at once. A payment already under way still finishes, gets
confirmed, or gets refunded.

## E. Prove it on hosted before guests see it

1. Set the sandbox secrets (§C) and mark one test account:
   `update profiles set payment_sandbox = true where id = '<test account uuid>';`
2. With mode `optional`, book on that account and tap Pay now. On Qi's page, use Qi's published **web** test
   card (on their Sandbox Environment page; 3-D Secure code `123123` if asked).
3. Expect, within seconds: the app shows the booking confirmed, and the desk bill shows the booking with a
   **Test** marker. Sandbox money never counts as paid, so the desk still asks for the full price.
4. Cancel the booking. Within about a minute the payment reads refunded (`deposit_attention` stays empty).
5. The same account is the App Review account's recipe (plan §9): give the reviewer the test card.

What Qi's sandbox showed on 2026-09-27, all handled in code (`_shared/payments/qi.ts`):
- A reused request id answers error **5** "already used" (not 1 or 10, as the docs suggest).
- "Not found" is HTTP 403 with code 12.
- The status call carries no page link.
- A cancelled payment keeps `status: CREATED` with `canceled: true`.
- Refunds answer `SUCCESS` at once, and the status call still says `SUCCESS` after a refund.
- Qi appends `&requestId=…&paymentId=…&status=SUCCESS` to our return URL. We ignore it on purpose: the app
  only believes Qi's API.
- The web test card needed no 3-D Secure code.

## F. How it behaves (for whoever is on call)

- **The truth is Qi's status API, asked with our credentials.** The webhook, the app's polling (every 2 s,
  then every 5 s) and the sweeper (every 30 s) are three ways of asking. The first answer to arrive wins, and
  the others are no-ops.
- **Webhooks:** with the key set, a bad signature is refused (401) and logged. Without it, the body is used
  only to find the payment, then Qi is asked. A forger can make us check, never make us book.
- **Paid but the slot is gone** (taken meanwhile, or the venue went offline): the money goes back
  automatically. It is never a paid payment without a booking.
- **Cancelled booking:** refunded automatically. **No-show:** deposit kept (the Settings switch changes this).
- **A refund Qi refuses, or one we could not confirm:** it appears in **Online refunds needing attention**
  (owner Financial home, manager Today). Retry it, or mark it "Settled another way" with the manager PIN
  after refunding the guest in cash.
- **Every message from Qi** is kept in `booking_payment_events` without card data: `select * from
  booking_payment_events where payment_id = '<id>' order by id;`

## G. Local development

`packages/db/supabase/functions/.env`: `PAYMENTS_PROVIDER=fake`. Then `pnpm exec supabase functions serve
--env-file supabase/functions/.env` from `packages/db`. "Pay now" opens the fake page, with Succeed,
Declined, Wrong code and Do nothing buttons. From a phone, set `PAYMENTS_FAKE_PAGE_URL` to the Mac's LAN
address. The fake refuses to load anywhere but the local stack.
