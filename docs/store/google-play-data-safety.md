# Google Play: Data safety and account deletion answers

For Play Console → **App content → Data safety**, and **App content → Data deletion**. The answers come from what
the app does. The field-level source is the SEC-20 declaration in `packages/db/tests/stored-fields.test.ts`; run it
(`pnpm --filter @touch/db exec vitest run tests/stored-fields.test.ts`) and it prints the current inventory. If
that printout and this page disagree, the printout wins and this page is stale.

Written 2026-09-23 alongside the Terms, the Privacy Policy rewrite and the web deletion page. Keep it consistent with
the App Store label (`docs/store/app-store-submission.md` §2) and the iOS privacy manifest
(`apps/mobile/app.config.ts` → `ios.privacyManifests`).

## Links

| Field | Value |
|---|---|
| Privacy policy URL | `https://www.touch-padel.com/en/privacy` |
| **Delete account URL** (Data deletion section) | `https://www.touch-padel.com/en/delete-account` |
| Terms of service (listing description / website) | `https://www.touch-padel.com/en/terms` |

The deletion URL works without the app: the guest signs in with phone or email and password, types the
confirmation word, and the same `app.delete_my_account` RPC the app uses runs. Apple and Google accounts, which have
no password, are sent to the app or to the emailed request on the same page.

## Overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS/TLS only; Supabase, Expo push) |
| Do you provide a way for users to request that their data is deleted? | **Yes**: in the app (Profile → Delete account) and at the URL above |
| Independent security review (MASA) | No |

## Data types

Nothing is **shared**. In Play's definition, data sent to service providers that process it on the developer's
behalf (Supabase, Expo/FCM, the WhatsApp/SMS code provider) is not "sharing". Every type below is **Collected: Yes,
Shared: No, Processed ephemerally: No, Required** (except email), purpose **App functionality** (plus **Account
management** where noted). Nothing is used for advertising, analytics or fraud-prevention purposes in Play's sense.

| Play category → type | Collected | Optional? | Purposes | What it is |
|---|---|---|---|---|
| Personal info → **Name** | Yes | Required | App functionality, Account management | First name and surname on the profile; the name on a booking |
| Personal info → **Email address** | Yes | **Optional** | App functionality, Account management | Only for email sign-up or Sign in with Google/Apple |
| Personal info → **Phone number** | Yes | Required | App functionality, Account management | Sign-in, the one-time verification code, the desk calling about a booking |
| Personal info → **User IDs** | Yes | Required | App functionality, Account management | The account id |
| Financial info → **Purchase history** | Yes | Required | App functionality | Court bookings and their prices (paid at the venue; no card data is ever collected) |
| App activity → **Other actions** | Yes | Required | App functionality | Bookings made and cancelled |
| Device or other IDs → **Device or other IDs** | Yes | Optional | App functionality | The push-notification token, only if notifications are allowed |
| Photos and videos → **Photos** | Yes | Optional | App functionality | **Staff accounts only**: a work photo a staff member takes or chooses in the staff area (a proposed dish, a receipt, a finished task), re-encoded on the phone without location metadata. A guest account cannot upload a photo |
| App activity → **Other user-generated content** | Yes | Optional | App functionality | **Staff accounts only**: the text a staff member types into a task, a proposal, a staff request, a note on a new menu item or a marketing draft |

**Not collected:** location (approximate or precise), web browsing, contacts, calendar, videos, audio, files,
health and fitness, messages, app info and performance (crash logs, diagnostics), financial info other than purchase
history (no card or bank details), race/religion/political or other sensitive info. Photos only as above: from staff
accounts, never from a guest.

> Only what the **Android app** collects belongs on this form. The website's café table sessions, the order notes
> guests type there, PostHog page-view analytics, and the notes and labels the front desk writes in the operator app
> are all outside it. The Privacy Policy discloses each of them. The guest side of the app has no free-text field
> that reaches the server. The staff area does, and it can attach work photos, so Photos and Other user-generated
> content are declared, for staff accounts only, matching the App Store label (`docs/store/app-store-submission.md`
> §2). Staff accounts are created by the owner; there is no staff sign-up in the app.
>
> The photo picker is the system one, which needs no media permission: `app.config.ts` blocks
> `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE` and `RECORD_AUDIO`, so Play's Photo and video
> permissions declaration should not apply. Confirm it on the first Android build's merged manifest (UNVERIFIED
> against SDK 57, build-contracts-2026-09-23 §8.4). The camera permission is asked only when a staff member takes a
> work photo.

## Data deletion section

| Question | Answer |
|---|---|
| Account deletion URL | `https://www.touch-padel.com/en/delete-account` |
| Can users request that some or all of their data is deleted without deleting their account? | Yes: by emailing the privacy contact or asking at the front desk (Privacy Policy → Your rights) |
| What is deleted | Login, name, phone, email, linked Google/Apple sign-in, push token, staff notes and labels about the guest, queued notifications. Immediately |
| What is kept, and why | Bookings and café orders stay **anonymised** (no name, phone or notes) because the venue must keep its accounts, and the record of which Terms version was accepted stays on the anonymised row. Stated on the deletion page and in the Privacy Policy |
| Staff accounts | Not deleted through this page. The owner switches a leaver's account off (sessions ended, push token cleared); the account and its work records stay, as the staff privacy notice (`docs/legal/staff-privacy-notice.md`) tells every employee |

## Before submitting

- [ ] `LEGAL_STRICT=1 pnpm check:legal` passes: the legal pages name the company, not `[FILL: …]`.
- [ ] Migration 0153 is on the hosted project (the app's consent gate calls `app.accept_terms`).
- [ ] The web deletion page works against hosted: sign in with the review account and stop at the confirmation word.
      Deleting the review account for real means recreating it with `scripts/create-review-account.mjs`.
- [ ] The staff review account exists (`scripts/create-staff-review-account.mjs`) and its login is in the review
      notes; switch it off with `--deactivate` after the decision.
- [ ] The first Android build's merged manifest carries none of the four blocked permissions.
