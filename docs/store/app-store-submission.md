# App Store submission — Touch Padel (iOS)

Every App Store Connect answer that is **not** listing copy: app information, availability, privacy
labels, age rating, export compliance, the review account, review notes, and the build/submit order.
Listing copy lives in `app-store-listing.md`. Screenshots come from `apps/mobile/store/`. The browser
agent that types all of this in is `docs/client/app-store-connect-chrome-prompt.md`.

- App Store Connect app: **6809045183**, team **BR42V976FS**, bundle id **`com.kagu.touchpadel`**
- Version: **1.0.0** (`apps/mobile/app.config.ts`). The App Store Connect version record must say the same
- Build number: EAS remote with `autoIncrement`. Builds 4–9 in App Store Connect are all **0.1.0** (newest 9, 2026-09-13), so the first 1.0.0 build is ≥ 10
- Target submission Wed 2026-09-16, hard stop Fri 2026-09-18
- Sign in with Apple key for revocation: **created 2026-09-15**, Key ID `34Y63525H2` ("Touch Padel SIWA Revoke"). The .p8 is downloaded by the owner only
- App Store Connect state after the first browser run: `docs/client/app-store-connect-chrome-prompt-2.md` finishes the rest

---

## 0 · Before anyone opens App Store Connect

| # | Must be true | How to check |
|---|---|---|
| 1 | Privacy and Support pages are live | `curl -sI https://www.touch-padel.com/en/privacy` (and `/ar/privacy`, `/en/support`, `/ar/support`, `/en/terms`, `/en/delete-account`) returns 200, and `LEGAL_STRICT=1 pnpm check:legal` passes (no `[FILL: …]` left on the pages) |
| 2 | apple-revoke is deployed with its four secrets | Delete a throwaway Sign-in-with-Apple account on TestFlight, then Supabase → Edge Functions → apple-revoke → Logs shows `[apple-revoke] revoked`. The audit row still says `apple_revoke_pending: true`, because `delete_my_account` has no "revoked" parameter. That's expected |
| 3 | The review account and its partner exist on the hosted project, both on Qi's sandbox | `node scripts/create-review-account.mjs --sandbox` and `node scripts/create-review-account.mjs --partner --sandbox --no-booking` each print `Signed in with phone + password: OK` and `Payments on Qi's sandbox (profiles.payment_sandbox): ON` |
| 3a | The partner's sandbox match is waiting for the reviewer (open matches, DF-19) | Signed in as the partner on a test phone: two sandbox tickets bought with Qi's sandbox card, and a public, open-join, open-category match for "Me + 1" started at the review branch at least a week out, showing 2/4. If it expires before review, start another |
| 4 | A build ≥ 10 with version 1.0.0 is processed | App Store Connect → TestFlight shows it with no "Missing Compliance" |
| 5 | The desk knows "App Review" bookings are test bookings | Tell them |
| 6 | The staff review account exists on the hosted project | `node scripts/create-staff-review-account.mjs` prints `Signed in with email + password as driver: OK` |
| 7 | The manager knows the "App Review" driver's shopping purchases are test entries | Tell them |

---

## 1 · App information

| Field | Value |
|---|---|
| Name | Touch Padel (EN) · تتش بادل (AR) |
| Bundle ID | `com.kagu.touchpadel` |
| SKU | `touch-padel-ios` (already fixed when the record was created; leave whatever is there) |
| Primary language | **Arabic** (as the record was created; left as is on 2026-09-15). English (U.S.) is a second localization |
| Localizations | Arabic (primary), English (U.S.) |
| Primary category | **Sports** |
| Secondary category | **Health & Fitness** |
| Content rights | Does **not** contain, show or access third-party content |
| Privacy Policy URL | EN `https://www.touch-padel.com/en/privacy` · AR `https://www.touch-padel.com/ar/privacy` |
| Price | **Free** |
| In-App Purchases | **None.** Online payments are court deposits and open-match tickets, both paid by Qi Card for a service used in person at the venue (Guideline 3.1.3(e)). A ticket is redeemable only for a seat in a match at the venue, is refundable at the front desk, and is never spent on digital content. Everything else is paid at the front desk. How a reviewer reads reusable tickets is **UNVERIFIED** (open matches, `docs/design/open-matches/guest.md` §4.26) |
| Made for Kids | No |
| Regulated medical device | **Not** a regulated medical device (EU/EEA, UK, US declaration) |

### Availability — all territories (owner decision 2026-09-15)

All countries and regions, including future ones. The account's EU Digital Services Act status for this app is
already **non-trader** ("This developer has identified itself as a non-trader for this app."), so no trader
contact details are published. Revisit it with the owner if Touch or Kagu should be declared a trader.

When the domain moves, change the Privacy Policy and Support URLs in App Store Connect. That needs no new build.
Also set `EXPO_PUBLIC_SITE_URL` for the next build so the in-app links follow.

---

## 2 · App Privacy (the nutrition label)

Answered from what the binary does. The mobile app has **no analytics, crash-reporting or advertising SDK**
(`apps/mobile/package.json`; `src/lib/telemetry.ts` is a local seam with no reporter).

The binary has two kinds of account. **Guests** book courts. **Venue staff**, whose accounts the owner creates on
the operator (there is no staff sign-up), sign in with email and password and see a separate staff area: their
tasks in the venue's protocols, checklists, the shopping list, notes on new menu items, their requests, incident
reports and their own pay deductions (`docs/design/protocols/plan-2026-09-23.md` §6;
`docs/design/protocols/wave5-addendum-2026-09-25.md` §5.3). The two User Content rows and the Other Financial Info
row below come from staff accounts only.

**Do you or your third-party partners collect data from this app? → Yes**

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Contact Info → **Name** | Yes | Yes | No | App Functionality |
| Contact Info → **Email Address** | Yes | Yes | No | App Functionality. Only when the guest uses Sign in with Apple or Google |
| Contact Info → **Phone Number** | Yes | Yes | No | App Functionality. Required: sign-in, the one-time WhatsApp code at sign-up, the desk calling about a booking |
| Identifiers → **User ID** | Yes | Yes | No | App Functionality. The account id, and the push token reminders go to |
| Other Data → **Other Data Types** | Yes | Yes | No | App Functionality. The bookings and open matches (court, date, time, group size), the gender a player gives for women-only and men-only matches, and an optional date of birth a guest may add in Edit profile, which only they can see |
| Purchases → **Purchase History** | Yes | Yes | No | App Functionality. Court deposits and open-match tickets paid by Qi Card on Qi's own page: what was bought, when and the amount. No card data reaches the app or the venue |
| User Content → **Photos or Videos** | Yes | Yes | No | App Functionality. A guest's optional profile photo, taken or chosen in Edit profile and seen by the guest and the venue's staff; and, on staff accounts, a work photo taken or chosen in the staff area (a proposed dish, a receipt, a finished task, an incident report). Both are re-encoded on the phone without location or camera metadata. A profile photo is deleted with the account |
| User Content → **Other User Content** | Yes | Yes | No | App Functionality. **Staff accounts only**: the text a staff member types into a task, a proposal, a staff request, a note on a new menu item, a marketing draft or an incident report |
| Financial Info → **Other Financial Info** | Yes | Yes | No | App Functionality. **Staff accounts only**: a wage advance a staff member asks for, and pay deductions (amount, date and reason) recorded against a staff member, which that person reads in the staff area. **UNVERIFIED** classification, Majed's call (wave5-addendum-2026-09-25 §7.7) |

For each: "Is this data used for tracking?" → **No**. Purposes: tick **App Functionality** only.

**Not collected:** Health & Fitness, Financial Info other than the staff-only row above (no payment, credit or
card info: Qi Card's page takes the card), Location, Sensitive Info, Contacts, User Content (Emails or Text
Messages, Audio Data, Gameplay Content, Customer Support), Browsing History, Search History,
Usage Data (Product Interaction, Advertising Data, Other Usage Data), Diagnostics (Crash Data, Performance Data,
Other Diagnostic Data), Device ID, Physical Address, Other Contact Info.

The iOS privacy manifest (`apps/mobile/app.config.ts` → `ios.privacyManifests`) lists the same nine types, each
linked, not tracking, App Functionality; `apps/mobile/src/lib/__tests__/privacyManifest.test.ts` fails when the
table above and the manifest differ. The
camera and photo-library prompts (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, EN and AR in
`apps/mobile/locales/ios.{en,ar}.json`) appear only when a guest adds a profile photo in Edit profile, or a staff
member adds a work photo in the staff area. The app never asks for the microphone.

The WhatsApp verification-code provider, Supabase, Expo push and Apple/Google sign-in all process data **for the
app's own functionality**, which is not "tracking" in Apple's definition. No ATT prompt, no
`NSUserTrackingUsageDescription`. An ATT prompt with nothing to track is itself a rejection.

If Sentry (or any crash reporter) ships later, add Diagnostics → Crash Data (not linked, App Functionality) first.

### Account deletion (5.1.1(v))

In the app: **Profile → Edit profile → Delete account**, typed confirmation. The same deletion also runs on the web at
`https://www.touch-padel.com/en/delete-account`; Google Play requires that page, and Apple only requires the in-app
path. `app.delete_my_account`
(migration 0077) removes the login, name and phone immediately. Past bookings stay in the venue's books with no
name attached. The player also leaves their open matches, and unused open-match tickets are refunded to the card
they were paid with (DF-20). For a Sign in with Apple account the app first re-authorises with Apple, and the
server revokes the Apple token (`apple-revoke`). Say this in the review notes (§5).

---

## 3 · Age rating — record the rating Apple computes

Open matches make the user-generated content answer **Yes** (DF-17), which can move the rating off 4+. Answer
the questions as below and record whatever rating Apple computes; do not bend an answer to reach 4+.

Answer **None / No** to every question: violence (all kinds), profanity/crude humour, mature/suggestive themes,
horror/fear, medical or treatment information, health or wellness topics, alcohol/tobacco/drugs, sexual content or
nudity, simulated or real gambling, contests, loot boxes.

| Capability question | Answer | Why |
|---|---|---|
| Unrestricted web access | **No** | No in-app browser. The Privacy/Support links open Safari, and "Call" opens the dialer |
| User-generated content | **Yes** (DF-17) | Players in open matches see each other's first name and surname initial, and fixed preset status messages. There is no free text. Report, block and a venue ban are built in (Guideline 1.2). Staff notes and work photos are seen only by colleagues and managers at the same venue, inside their staff accounts. A guest's profile photo is seen by the guest and the venue's staff |
| Messaging or chat | **No** | Fixed preset statuses only; no direct messages |
| Advertising | **No** | |
| Parental controls / age assurance | **No** / not applicable | |

Record the rating Apple computes from these answers in the owner's report. If it is higher than expected,
re-read each question against the app, but never change a true answer to lower it.

---

## 4 · Export compliance

`app.config.ts` sets `ITSAppUsesNonExemptEncryption: false`, so builds arrive without the compliance question. If
asked anyway: uses encryption → **Yes** (HTTPS); exempt → **Yes**, standard encryption only (TLS to Supabase); no
CCATS or self-classification report.

---

## 5 · Review account and review notes

### The account

Created by `node scripts/create-review-account.mjs`, which the owner runs with the hosted service-role key. It:

- creates a phone + password guest on the hosted project, **phone already confirmed**. Sign-in is phone + password
  with no code, so the reviewer never needs WhatsApp
- books one court ~60 days out through the app's own RPCs, so My Reservations isn't empty through a re-review
- prints the number and password **once**. They are generated, never committed, and a re-run sets a new password
- `--sandbox` sets `profiles.payment_sandbox = true` (no more SQL by hand): its deposits and open-match tickets
  are paid on Qi's sandbox with Qi's sandbox card, and it sees and joins only sandbox matches, which never book a
  real court (DF-19)
- `--partner` does the same for a second account, "Review Partner", whose login never goes to Apple
- `--delete` cancels its bookings and deletes it through `delete_my_account` after approval

**Open matches (DF-19).** Run it twice: `node scripts/create-review-account.mjs --sandbox` (the reviewer) and
`node scripts/create-review-account.mjs --partner --sandbox --no-booking` (the partner). Then, before submitting,
sign in as the partner on a test phone, buy two sandbox tickets with Qi's sandbox card, and start a public,
open-join, open-category match for "Me + 1" at the review branch, at least a week out (it shows 2/4). The reviewer
joins it as the third player, so it never needs a court. If it expires before the review, start another.

App Store Connect → App Review Information → **Sign-in required** ✓:

```
User name: <the +964… number the script printed>
Password:  <the password the script printed>
```

Don't rotate the password until the version is live. If you must, re-run the script and update both fields.

### The staff account

Created by `node scripts/create-staff-review-account.mjs`, which the owner runs with the hosted service-role key. It:

- creates an email + password account with the **driver** role at the real venue. After 0157 the driver is the
  role with the least access: no prices, no order lines, no other person's data; it sees the shopping list and
  records its own purchases
- prints the email and password **once**. The password is generated, never committed, and a re-run sets a new one
- `--deactivate` switches the account off after the decision (`app.set_staff_active`: sessions ended, push token
  cleared). The account is kept, not deleted, like any leaver's, so its records keep their name

It sits at the real venue and sees the real shopping list: anything the reviewer records shows up for the
manager like any driver's work, so tell the manager (§0 item 7). The staff login goes in the review notes below;
the Sign-in Information fields hold the guest account.

### Review notes — paste this

The field holds 4,000 characters; this is 3,924 (2026-09-29, open matches added). Count again after any edit.

```
Touch Padel is the booking app for a single padel venue in Iraq. Guests check court availability and reserve a court. Availability can be browsed without an account; reserving needs one. The same app has a staff area for the venue's own employees (see STAFF AREA below).

SIGN IN
Use the account in Sign-in Information. On the sign-in screen choose country Iraq (+964), enter the phone number without the +964 prefix, then the password. No verification code is needed to sign in. Sign in with Apple and Google are also offered; Sign in with Apple is provided as required by guideline 4.8. New accounts confirm their phone number once with a WhatsApp code, which is why a ready account is provided.

The account already has an upcoming booking under My Reservations. You are welcome to reserve and cancel another slot: bookings from this account are marked as test bookings for the venue's front desk.

PAYMENTS
Courts are paid at the venue's front desk. The only online payments, a court deposit when a booking asks for one and open-match tickets, are made on Qi Card's own page for a service used in person at the venue (3.1.3(e)). A ticket is only redeemable for a seat in a match at the venue, is refundable at the desk, and never buys digital content. No in-app purchases; the app never sees card details.

OPEN MATCHES
Players start a match at a free time or join one; four players book the court together and each pays their share at the desk (Book > a free time > Start an open match; Book > Open matches). To try it: Profile > Tickets, buy two tickets with Qi's sandbox card, then join Review Partner's match under Book > Open matches (2/4). At 3/4 no court is booked. In the match, send a preset status (no free text), and report or block a player from their seat's menu. Leave, and the ticket returns to your wallet. The review account is a sandbox profile: it pays on Qi's sandbox (no real money) and sees only sandbox matches, which never book a real court.

ACCOUNT DELETION
Profile > Edit profile > Delete account, in the app. It deletes the login, the guest's name and phone number immediately and signs them out. For Sign in with Apple accounts the app re-authorises with Apple and the Apple token is revoked. Past bookings remain in the venue's records with no name attached; the deletion screen says so before the user confirms. Open matches are left and unused tickets refunded to the card.

PRIVACY
Settings > About > Privacy policy (also linked on the sign-up screen) opens the same policy as the listing. The app contains no analytics, advertising or tracking.

STAFF AREA
Venue employees use the same app on their own phones for their work: their tasks in the venue's workflows (for example proposing a new menu item, a checklist, the shopping list), notes on new menu items and requests to the owner. Staff accounts are created by the venue owner; there is no staff sign-up, and staff sign in with email and password only. To see it, sign out and sign in with email and password:

Email:    <the email create-staff-review-account.mjs printed>
Password: <the password it printed>

This is a driver account at the real venue, the staff role with the least access. It shows the venue's real shopping list; anything you record there reaches the venue manager like any driver's work, so please type test text. The camera and photo library are used here, when a staff member attaches a work photo (for example a receipt), and in a guest's Edit profile, when they add a profile photo. The app never uses the microphone or location.

LANGUAGES
English and Arabic with full right-to-left layout. Settings > Language switches immediately, no restart.

VENUE CONNECTION NOTICE
If the venue's own system loses connectivity, bookings for today and tomorrow are refused in the app with an explanation and the venue's phone number instead of being taken and lost. If you see that banner during review it is intended behaviour; dates further ahead remain bookable.
```

App Review contact: the account holder's real name, phone and email (the browser agent uses what App Store Connect
already holds, or asks).

---

## 6 · Build and submit (owner-run, from `apps/mobile`)

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production   # uses submit.production.ios: team BR42V976FS, ascAppId 6809045183
```

- `version` is **1.0.0**. `runtimeVersion: { policy: 'appVersion' }` pins OTAs to it.
- Production env points at Supabase `lczijabnorujcgmbuqlw`, the same project the review account is created on.
- Remove `host.exp.Exponent` from Supabase → Auth → Apple → Client IDs before release (Chrome prompt task 1).
- Processing takes 15–60 min before the build is selectable on the version page.

## 7 · Order of operations

1. Push the repo work to main. Vercel deploys, then check §0 item 1.
2. Chrome prompt task 2 (Sign in with Apple key). Owner downloads the .p8, sets the secrets, and deploys `apple-revoke`.
3. `node scripts/create-review-account.mjs --sandbox`, `node scripts/create-review-account.mjs --partner --sandbox
   --no-booking` and `node scripts/create-staff-review-account.mjs`; start the partner's sandbox match (§5, open
   matches); put the staff login into the review notes, and tell the desk and the manager.
4. `eas build` then `eas submit`.
5. Chrome prompt tasks 1 and 3–7 (metadata can start while the build processes; build selection comes last).
6. Owner reads the agent's report, then presses **Add for Review → Submit for Review**.
7. After approval: `node scripts/create-review-account.mjs --delete`,
   `node scripts/create-review-account.mjs --partner --delete` and
   `node scripts/create-staff-review-account.mjs --deactivate`.
