# App Store submission — Touch Padel (iOS)

Every App Store Connect answer that is **not** listing copy: app information, availability, privacy
labels, age rating, export compliance, the review account, review notes, and the build/submit order.
Listing copy lives in `app-store-listing.md`. Screenshots come from `apps/mobile/store/`. The browser
agent that types all of this in is `docs/client/app-store-connect-chrome-prompt.md`.

- App Store Connect app: **6809045183**, team **BR42V976FS**, bundle id **`com.kagu.touchpadel`**
- Version: **1.1.0** (`apps/mobile/app.config.ts`; 1.0.0 → 1.1.0 with the Expo SDK 58 move, so an OTA for SDK 58 never reaches a 1.0.0 binary). The App Store Connect version record must say the same
- Build number: EAS remote with `autoIncrement`. Builds 4–9 in App Store Connect are all **0.1.0** (newest 9, 2026-09-13), so the first 1.1.0 build is ≥ 10
- **What this build is (F-02/F-03, Majed 2026-11-01): no online payment, no tickets; open matches ON.** `apps/mobile/eas.json`
  sets `EXPO_PUBLIC_ONLINE_PAYMENTS` to "off" in every profile (`src/features/deposit/enabled.ts`: no deposit, no
  lesson online pay, no ticket wallet, no `/pay/*`) and keeps `EXPO_PUBLIC_TOURNAMENTS` "on". Open matches follow the
  branch's `matches_enabled` alone: since 0370/0371 each seat is paid at the desk while online payments are off
  (`app.match_pay_at_desk()`; the app's `useMatchPayAtDesk`), so no ticket is ever asked for. Courts, match seats,
  lessons and tournament entries are paid at the front desk. The
  website follows it: `/{locale}/pay/return` says payment is made at the club (`NEXT_PUBLIC_ONLINE_PAYMENTS` unset,
  `apps/web/src/lib/site/payments.ts`). Everything below is written for that build
- Target submission Wed 2026-09-16, hard stop Fri 2026-09-18
- Sign in with Apple key for revocation: **created 2026-09-15**, Key ID `34Y63525H2` ("Touch Padel SIWA Revoke"). The .p8 is downloaded by the owner only
- App Store Connect state after the first browser run: `docs/client/app-store-connect-chrome-prompt-2.md` finishes the rest

---

## 0 · Before anyone opens App Store Connect

| # | Must be true | How to check |
|---|---|---|
| 1 | Privacy and Support pages are live | `curl -sI https://www.touch-padel.com/en/privacy` (and `/ar/privacy`, `/en/support`, `/ar/support`, `/en/terms`, `/en/delete-account`) returns 200, and `LEGAL_STRICT=1 pnpm check:legal` passes (no `[FILL: …]` left on the pages; the minimum play age is 4 since 2026-11-01) |
| 1a | The build has online payment off, open matches on | `apps/mobile/eas.json` → `build.production.env.EXPO_PUBLIC_ONLINE_PAYMENTS` is `"off"`. On TestFlight: no Tickets row in Profile, no Pay button on a lesson, no deposit step when booking; Join lists open matches and tournaments, and joining a match asks for no ticket. Hosted: the review branch has `matches_enabled` on, and `platform_settings.online_payments_live` is false (so `app.match_pay_at_desk()` is true) |
| 2 | apple-revoke is deployed with its four secrets | Delete a throwaway Sign-in-with-Apple account on TestFlight, then Supabase → Edge Functions → apple-revoke → Logs shows `[apple-revoke] revoked`. The audit row still says `apple_revoke_pending: true`, because `delete_my_account` has no "revoked" parameter. That's expected |
| 3 | The review account and its partner exist on the hosted project, both sandbox profiles | `node scripts/create-review-account.mjs --sandbox` and `node scripts/create-review-account.mjs --partner --sandbox --no-booking` each print the number and `Sandbox profile (profiles.payment_sandbox): ON`. `--sandbox` no longer means Qi's sandbox (there is no payment in this build): it keeps both accounts to sandbox matches, which never book a real court (DF-19) |
| 3a | Both can sign in without WhatsApp | The app signs a phone account in with a one-time code, not a password (`apps/mobile/app/sign-in.tsx`, owner 2026-10-11). Supabase (hosted) → Authentication → Sign In / Providers → Phone → **Test phone numbers and OTPs**: add each printed number (digits without `+`) with a six-digit code the owner picks for this review. Sign in with both on TestFlight. Remove the pairs after approval |
| 3b | The partner's match is waiting for the reviewer (open matches, DF-19) | Signed in as the partner on a test phone: start a public, open-join, open-category match for "Me + 1" at the review branch at least a week out, showing 2/4. No ticket is needed: seats are paid at the desk. If it expires before review, start another |
| 4 | A build ≥ 10 with version 1.1.0 is processed | App Store Connect → TestFlight shows it with no "Missing Compliance" |
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
| In-App Purchases | **None.** This version takes no payment at all: courts, open-match seats, lessons and tournament entries are paid at the front desk, and the app never asks for card details. There are no tickets in this build. (When online payment ships in a later reviewed build, it is Qi Card for a service used in person at the venue, Guideline 3.1.3(e), and this row changes with it) |
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

Answered from what the binary does. The mobile app has **no analytics, advertising or third-party crash-reporting
SDK** (`apps/mobile/package.json`). Since 2026-11-01 (F-15) it does send **crash and error reports** to the venue's
own server: `src/lib/telemetry.ts` reports through `src/lib/monitoring.ts` to `app.report_event` (migration 0393), which
the team's monitoring page lists, with the account it came from when someone is signed in. That is the **Crash Data**
row below. The report is scrubbed on the phone and again on the server (no PIN, token, phone number, email or card
number), and it never goes to a third party.

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
| Other Data → **Other Data Types** | Yes | Yes | No | App Functionality. The bookings, open matches, lessons and tournament entries (court, date, time, group size); the gender and age band asked at sign-up (gender also decides whether women-only or men-only matches are offered); the level, years played and interests in the play survey; the username and the match scores a player reports for the Ranks leaderboard; and an optional date of birth a guest may add in Edit profile, which only they can see |
| Purchases → **Purchase History** | Yes | Yes | No | App Functionality. Court bookings, open-match seats, lessons and tournament entries with their prices, and the points earned and rewards used with the member card at the venue's till. All of it is paid at the venue; the app takes no payment and no card data |
| User Content → **Photos or Videos** | Yes | Yes | No | App Functionality. A guest's optional profile photo, taken or chosen in Edit profile and seen by the guest and the venue's staff; and, on staff accounts, a work photo taken or chosen in the staff area (a proposed dish, a receipt, a finished task, an incident report). Both are re-encoded on the phone without location or camera metadata. A profile photo is deleted with the account |
| User Content → **Other User Content** | Yes | Yes | No | App Functionality. **Staff accounts only**: the text a staff member types into a task, a proposal, a staff request, a note on a new menu item, a marketing draft or an incident report |
| Financial Info → **Other Financial Info** | Yes | Yes | No | App Functionality. **Staff accounts only**: a wage advance a staff member asks for, and pay deductions (amount, date and reason) recorded against a staff member, which that person reads in the staff area. **UNVERIFIED** classification, Majed's call (wave5-addendum-2026-09-25 §7.7) |
| Diagnostics → **Crash Data** | Yes | Yes | No | App Functionality. A report when the app crashes or an action fails (what failed, on which screen, the app version), sent automatically or when the person presses "Report crash", to the venue's own monitoring page; linked to the account when someone is signed in (F-15, migration 0393). **UNVERIFIED** whether Apple also wants Other Diagnostic Data for the non-crash error reports; Majed's call |

For each: "Is this data used for tracking?" → **No**. Purposes: tick **App Functionality** only.

**Not collected:** Health & Fitness, Financial Info other than the staff-only row above (no payment, credit or
card info: the app takes no payment), Location, Sensitive Info, Contacts, User Content (Emails or Text
Messages, Audio Data, Gameplay Content, Customer Support), Browsing History, Search History,
Usage Data (Product Interaction, Advertising Data, Other Usage Data), Diagnostics other than Crash Data (Performance
Data, Other Diagnostic Data), Device ID, Physical Address, Other Contact Info.

The iOS privacy manifest (`apps/mobile/app.config.ts` → `ios.privacyManifests`) lists the same ten types, each
linked, not tracking, App Functionality; `apps/mobile/src/lib/__tests__/privacyManifest.test.ts` fails when the
table above and the manifest differ. The
camera and photo-library prompts (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, EN and AR in
`apps/mobile/locales/ios.{en,ar}.json`) appear only when a guest adds a profile photo in Edit profile, or a staff
member adds a work photo in the staff area. The app never asks for the microphone.

The WhatsApp verification-code provider, Supabase, Expo push and Apple/Google sign-in all process data **for the
app's own functionality**, which is not "tracking" in Apple's definition. No ATT prompt, no
`NSUserTrackingUsageDescription`. An ATT prompt with nothing to track is itself a rejection.

If a third-party crash reporter (Sentry or similar) ships later, it is a third party: revisit this table first.

### Account deletion (5.1.1(v))

In the app: **Profile → Edit profile → Delete account**, typed confirmation. The same deletion also runs on the web at
`https://www.touch-padel.com/en/delete-account`; Google Play requires that page, and Apple only requires the in-app
path. `app.delete_my_account`
(migration 0077) removes the login, name and phone immediately. Past bookings stay in the venue's books with no
name attached. The player also leaves their open matches. For a Sign in with Apple account the app first re-authorises with Apple, and the
server revokes the Apple token (`apple-revoke`). Say this in the review notes (§5).

---

## 3 · Age rating — record the rating Apple computes

Open matches make the user-generated content answer **Yes** (DF-17), which can move the rating off 4+. Answer the questions as below and record whatever rating Apple computes; do not bend an answer to
reach 4+.

Answer **None / No** to every question: violence (all kinds), profanity/crude humour, mature/suggestive themes,
horror/fear, medical or treatment information, health or wellness topics, alcohol/tobacco/drugs, sexual content or
nudity, simulated or real gambling, contests, loot boxes.

| Capability question | Answer | Why |
|---|---|---|
| Unrestricted web access | **No** | No in-app browser. The Privacy/Support links open Safari, and "Call" opens the dialer |
| User-generated content | **Yes** (DF-17) | Players in open matches see each other's first name and surname initial, and fixed preset status messages; the Ranks leaderboard shows the username a player chose, and tournament standings show players' names. There is no free text between players. Report, block and a venue ban are built in (Guideline 1.2): a player reports or blocks another from that player's seat in a match, and Profile → Blocked players undoes a block. Staff notes and work photos are seen only by colleagues and managers at the same venue, inside their staff accounts. A guest's profile photo is seen by the guest and the venue's staff |
| Messaging or chat | **No** | Fixed preset statuses in a match only; no direct messages |
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

- creates a guest on the hosted project, **phone already confirmed**. The app signs a phone account in with a
  one-time code (since 2026-10-11), so the owner sets a fixed test code for the number in Supabase (§0 item 3a)
  and the reviewer never needs WhatsApp
- books one court ~60 days out through the app's own RPCs, so My Bookings isn't empty through a re-review
- prints the number **once**. It is generated, never committed
- `--sandbox` sets `profiles.payment_sandbox = true`: the account sees and joins only sandbox matches, which never
  book a real court (DF-19). In this build nothing is paid in the app, so the name is historical
- `--partner` does the same for a second account, "Review Partner", whose login never goes to Apple
- `--delete` cancels its bookings and deletes it through `delete_my_account` after approval

**Open matches (DF-19).** Run it twice: `node scripts/create-review-account.mjs --sandbox` (the reviewer) and
`node scripts/create-review-account.mjs --partner --sandbox --no-booking` (the partner). Then, before submitting,
sign in as the partner on a test phone and start a public, open-join, open-category match for "Me + 1" at the review
branch, at least a week out (it shows 2/4). No ticket is needed: seats are paid at the desk. The reviewer joins it as
the third player, so it never needs a court. If it expires before the review, start another.

App Store Connect → App Review Information → **Sign-in required** ✓:

```
User name: <the +964… number the script printed>
Password:  <the six-digit test code set for that number in §0 item 3a>
```

Don't change the test code until the version is live. If you must, change it in Supabase and in this field together.

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

```
Touch Padel is the app of a single padel venue in Iraq. Guests reserve courts, start or join open matches, book lessons, enter tournaments and carry a member card for points at the venue's till. Browsing needs no account; reserving does. A staff area serves the venue's employees (STAFF AREA below).

SIGN IN
Use the account in Sign-in Information. On the sign-in screen keep "Phone", choose country Iraq (+964) and enter the phone number without the +964 prefix. The app asks for a six-digit code: enter the code given in the Password field. It is a fixed test code for this number, so no message needs to be received. Sign in with Apple and Google are also offered; Sign in with Apple is provided as required by guideline 4.8.

The account has an upcoming booking under Bookings. You may reserve and cancel another slot: this account's bookings are marked as test bookings for the front desk.

PAYMENTS
There is no online payment in this version. Courts, open-match seats, lessons and tournament entries are all paid at the venue's front desk when the player arrives. No in-app purchases, no tickets, and the app never asks for card details.

OPEN MATCHES
Players start a match at a free time or join one; four players book the court together and each pays their share at the desk (Book > a free time > Start an open match; Join > Open matches). To try it: under Join > Open matches, join Review Partner's match (2/4). At 3/4 no court is booked. In the match, send a preset status (no free text), and report or block a player from their seat's menu; Profile > Blocked players undoes a block. Then leave the match. The review account is a sandbox profile: it sees only sandbox matches, which never book a real court.

LESSONS, TOURNAMENTS AND THE CLUB TAB
Coaches: book a place in a session, paid at the desk. Join also lists tournaments: enter, wait-list or withdraw; the fee is paid at the desk. Club: the member card (a QR the till scans for points), the Ranks leaderboard, and the café menu, for looking only: nothing is ordered in the app.

ACCOUNT DELETION
Profile > Edit profile > Delete account, in the app. It deletes the login, the guest's name and phone number immediately and signs them out. For Sign in with Apple accounts the app re-authorises with Apple and the Apple token is revoked. Past bookings remain in the venue's records with no name attached; the deletion screen says so before the user confirms. Open matches are left.

PRIVACY
Settings > About > Privacy policy (also linked on the sign-up screen) opens the same policy as the listing. The app contains no analytics, advertising or tracking. Crash and error reports go only to the venue's own server.

STAFF AREA
Venue employees use the app for their work: workflow tasks (a new menu item, a checklist, the shopping list), menu notes and requests to the owner. The owner creates staff accounts; there is no staff sign-up, and staff sign in with email and password only. To see it, sign out, choose "Email" on the sign-in screen and sign in with:

Email:    <the email create-staff-review-account.mjs printed>
Password: <the password it printed>

This driver account, the role with the least access, sees the venue's real shopping list; anything you record reaches the manager, so please type test text. The camera and photo library are used for a work photo (a receipt, say) and for a guest's profile photo in Edit profile. The app never uses the microphone or location.

LANGUAGES
English and Arabic with full right-to-left layout. Settings > Language switches immediately, no restart.

VENUE CONNECTION NOTICE
If the venue's own system loses connectivity, bookings for today and tomorrow are refused in the app with an explanation and the venue's phone number instead of being taken and lost. If you see that banner during review it is intended behaviour; dates further ahead remain bookable.
```

The block sits right under its heading because `apps/mobile/store/chrome-prompt.mjs` reads it from there. The field holds 4,000 characters; this is 3,871 (2026-11-01, version 1.1.0: no online payment, open matches paid
at the desk). Count again after any edit.

App Review contact: the account holder's real name, phone and email (the browser agent uses what App Store Connect
already holds, or asks).

---

## 6 · Build and submit (owner-run, from `apps/mobile`)

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production   # uses submit.production.ios: team BR42V976FS, ascAppId 6809045183
```

- `version` is **1.1.0**. `runtimeVersion: { policy: 'appVersion' }` pins OTAs to it.
- The production profile builds with `EXPO_PUBLIC_ONLINE_PAYMENTS: "off"` and `EXPO_PUBLIC_TOURNAMENTS: "on"`; open matches follow the branch switch (§0 item 1a).
- Production env points at Supabase `lczijabnorujcgmbuqlw`, the same project the review account is created on.
- Remove `host.exp.Exponent` from Supabase → Auth → Apple → Client IDs before release (Chrome prompt task 1).
- Processing takes 15–60 min before the build is selectable on the version page.

## 7 · Order of operations

1. Push the repo work to main. Vercel deploys, then check §0 item 1.
2. Chrome prompt task 2 (Sign in with Apple key). Owner downloads the .p8, sets the secrets, and deploys `apple-revoke`.
3. `node scripts/create-review-account.mjs --sandbox`, `node scripts/create-review-account.mjs --partner --sandbox
   --no-booking` and `node scripts/create-staff-review-account.mjs`; set the test codes (§0 item 3a); start the
   partner's match (§0 item 3b); put the staff login into the review notes, and tell the desk and the manager.
4. `eas build` then `eas submit`.
5. Chrome prompt tasks 1 and 3–7 (metadata can start while the build processes; build selection comes last).
6. Owner reads the agent's report, then presses **Add for Review → Submit for Review**.
7. After approval: `node scripts/create-review-account.mjs --delete`,
   `node scripts/create-review-account.mjs --partner --delete`, remove both test codes in Supabase, and
   `node scripts/create-staff-review-account.mjs --deactivate`.
