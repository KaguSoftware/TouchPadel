# Hosted project catch-up (owner runbook, 2026-09-12)

**Why this exists.** Bookings changed on the desk were not showing on guests' phones. The
apps are fine; the hosted Supabase project (`lczijabnorujcgmbuqlw`) is what fell behind.
Verified read-only with the anon key on 2026-09-12:

| Symptom on the phone | Cause on the hosted project |
|---|---|
| My Bookings and booking detail show "could not load" for every guest | The schema lacks `reservations.cancelled_by` (migration 0088), which the app selects. Hosted stopped at 0076: `20260906000071_booking_integrity` was merged after `20260907000071..75` had been pushed by hand, it sorts before them, and `supabase db push` refuses out-of-order files. Every push since (by hand or the CI job) was refused, so 0077–0088 never applied. |
| Every slot in the next 48 h is "desk only", holds refused | `app.is_degraded()` is **true**: a station installed in *Till* mode was switched off and its stale heartbeat row is still there. |
| The desk cannot create a customer account, so its bookings never link to a guest | Edge function `desk-customer-create` was never deployed (nor `staff-admin`, `apple-revoke`). |
| In-app account deletion fails | `delete_my_account` is migration 0077, not on hosted. |

The pull request that ships this file adds migration **0089** (re-asserts the merged
`mark_reservation` body so the late apply of 0071 cannot undo 0075/0076), a pull-request
check that refuses out-of-order or duplicate migration versions, an `include_all` switch on
the migration workflow, a **Functions deploy** workflow, and a **DB ops** workflow with a
one-click stale-till sweep.

**Do this outside service hours.** 0071 validates a constraint over `reservations`; the
3-second lock timeout protects the till, but the push may need one retry.

## Path A — from GitHub (no local CLI needed)

Every run below waits at the `staging` environment gate for your approval.

1. **Migrations.** Actions → *DB Migrate (staging)* → *Run workflow* on `main` with
   **include_all = true**. In the run summary, the "Show pending migrations" step must list
   `20260906000071_booking_integrity` plus `0077` … `0089` as local-only, and the diff must
   be additive. Approve. Expect the push to apply those 14 files.
2. **Functions.** Actions → *Functions deploy (staging)* → *Run workflow*. Approve. The
   summary lists every function; `telegram-callback` and `send-sms-otp` must show
   `verify_jwt = false` (the job fails otherwise).
3. **Degraded mode.** Actions → *DB ops (staging)* → task **clear-stale-till**. Approve. The
   summary ends with `app.is_degraded()`; it must read `false`. If it still reads `true`, a
   till beat within the last hour and has since stopped: start that machine, or reinstall it
   in *Desk* mode if it is not the venue's till (see §Venue note).

## Path B — from this machine

The Supabase CLI on the dev machine is currently logged in as a **different account**
(`petitati.ist@gmail.com`), which is why `migration list --linked` answers 403. Log in as the
account that belongs to the **touch padel** Supabase organisation first.

Everything runs from `packages/db`. Never from the repo root (the CLI then sees no migrations
and offers a `migration repair --status reverted` that would mark the whole history undone).

```sh
cd packages/db
npx supabase login
npx supabase projects list            # must show lczijabnorujcgmbuqlw
npx supabase migration list --linked  # expect 20260906000071 and 0077..0089 as local-only
npx supabase db push --linked --include-all --dry-run
npx supabase db push --linked --include-all --yes
npx supabase functions deploy         # every function, verify_jwt from config.toml
npx supabase functions list           # telegram-callback + send-sms-otp: verify_jwt = false
pnpm db:clear-dev-till                # prints app.is_degraded(); must be false
```

## Verify (anyone, read-only, anon key from `apps/operator/.env`)

```sh
URL=https://lczijabnorujcgmbuqlw.supabase.co
KEY=<anon key>
# 1. degraded mode cleared
curl -s -X POST "$URL/rest/v1/rpc/is_degraded" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Profile: app" -H "Content-Type: application/json" -d '{}'      # -> false
# 2. schema caught up: a 0087 function exists (permission denied = exists; PGRST202 = missing)
curl -s -X POST "$URL/rest/v1/rpc/has_own_pin" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Profile: app" -H "Content-Type: application/json" -d '{}'      # -> code 42501
# 3. the column the phone reads exists (42501 permission error is fine; 42703 is not)
curl -s "$URL/rest/v1/reservations?select=cancelled_by&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# 4. the desk's customer-create function is deployed (anything but NOT_FOUND)
curl -s -X POST "$URL/functions/v1/desk-customer-create" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -d '{}'
```

Then the round trip, with a staff login on the desk (packaged app or `pnpm --filter
@touch/operator dev`) and a guest account on a phone pointed at hosted:

- Desk: create a booking and **pick** that guest as the customer → the phone's My Bookings
  shows it (live while the tab is open; otherwise on pull-to-refresh).
- Desk: cancel it → the phone shows it as cancelled by the venue, and a push arrives.
- Phone: hold and confirm a slot inside 48 h → no "desk only", and the desk calendar shows
  it within seconds.
- Desk: mark a **future** booking no-show → refused (`RESERVATION_NOT_STARTED`). Mark a
  started one → it ends properly (proves 0089 held).
- Desk: move a booking across a price change without a reason → refused
  (`REASON_REQUIRED`; proves 0071 landed).

## Venue note — why the phone said "desk only"

By contract, when the venue's till stops heartbeating the venue is degraded and guests
cannot book inside the protected horizon (48 h). That is correct for the real till. It is
wrong for a laptop that was set up as *Till* to try the app and then closed — which is what
happened here (fourth time). Rules until the real till is installed:

- Only the machine that will be the venue's till is set up in **Till** mode.
- Any other machine (owner's laptop, the desk PC, demos) is set up in **Desk** mode.
- Development sessions (`pnpm dev`) already file themselves as `DEV-…` and cannot trip it.

If the phone shows "desk only" again, run *DB ops → clear-stale-till* first.

## Walk-in bookings and the guest's app

A desk booking entered with only a name and phone is a walk-in: it blocks the slot for
everyone, but it is nobody's booking in the app (a guest sees only rows linked to their
account). For a booking to appear on a guest's phone, the desk must **pick** the customer
(existing account) or **create** one (needs `desk-customer-create`, deployed by step 2).
Linking walk-ins to a later sign-up by phone number is decision D4c, still open.
