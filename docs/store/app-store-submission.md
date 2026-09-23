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
| 3 | The review account exists on the hosted project | `node scripts/create-review-account.mjs` prints `Signed in with phone + password: OK` |
| 4 | A build ≥ 10 with version 1.0.0 is processed | App Store Connect → TestFlight shows it with no "Missing Compliance" |
| 5 | The desk knows "App Review" bookings are test bookings | Tell them |

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
| In-App Purchases | **None.** The app takes no money. Guests pay at the venue's front desk for a service used in person, which is outside IAP (Guideline 3.1.3(e), goods and services used outside the app) |
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

**Do you or your third-party partners collect data from this app? → Yes**

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Contact Info → **Name** | Yes | Yes | No | App Functionality |
| Contact Info → **Email Address** | Yes | Yes | No | App Functionality. Only when the guest uses Sign in with Apple or Google |
| Contact Info → **Phone Number** | Yes | Yes | No | App Functionality. Required: sign-in, the one-time WhatsApp code at sign-up, the desk calling about a booking |
| Identifiers → **User ID** | Yes | Yes | No | App Functionality. The account id, and the push token reminders go to |
| Other Data → **Other Data Types** | Yes | Yes | No | App Functionality. The bookings (court, date, time, group size) |

For each: "Is this data used for tracking?" → **No**. Purposes: tick **App Functionality** only.

**Not collected:** Health & Fitness, Financial Info, Location, Sensitive Info, Contacts, User Content, Browsing
History, Search History, Purchases, Usage Data (Product Interaction, Advertising Data, Other Usage Data),
Diagnostics (Crash Data, Performance Data, Other Diagnostic Data), Device ID, Physical Address, Other Contact Info.

The WhatsApp verification-code provider, Supabase, Expo push and Apple/Google sign-in all process data **for the
app's own functionality**, which is not "tracking" in Apple's definition. No ATT prompt, no
`NSUserTrackingUsageDescription`. An ATT prompt with nothing to track is itself a rejection.

If Sentry (or any crash reporter) ships later, add Diagnostics → Crash Data (not linked, App Functionality) first.

### Account deletion (5.1.1(v))

In the app: **Profile → Delete account**, typed confirmation. The same deletion also runs on the web at
`https://www.touch-padel.com/en/delete-account`; Google Play requires that page, and Apple only requires the in-app
path. `app.delete_my_account`
(migration 0077) removes the login, name and phone immediately. Past bookings stay in the venue's books with no
name attached. For a Sign in with Apple account the app first re-authorises with Apple, and the server revokes
the Apple token (`apple-revoke`). Say this in the review notes (§5).

---

## 3 · Age rating — expect **4+**

Answer **None / No** to every question: violence (all kinds), profanity/crude humour, mature/suggestive themes,
horror/fear, medical or treatment information, health or wellness topics, alcohol/tobacco/drugs, sexual content or
nudity, simulated or real gambling, contests, loot boxes.

| Capability question | Answer | Why |
|---|---|---|
| Unrestricted web access | **No** | No in-app browser. The Privacy/Support links open Safari, and "Call" opens the dialer |
| User-generated content | **No** | A guest's name and phone go to the venue only. Nothing is published to other users |
| Messaging or chat | **No** | |
| Advertising | **No** | |
| Parental controls / age assurance | **No** / not applicable | |

If anything pushes the rating above 4+, re-read the question: nothing in this app justifies it.

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
- `--delete` cancels its bookings and deletes it through `delete_my_account` after approval

App Store Connect → App Review Information → **Sign-in required** ✓:

```
User name: <the +964… number the script printed>
Password:  <the password the script printed>
```

Don't rotate the password until the version is live. If you must, re-run the script and update both fields.

### Review notes — paste this

```
Touch Padel is the booking app for a single padel venue in Iraq. Guests check court availability and reserve a court; that is the entire app. Availability can be browsed without an account; reserving needs one.

SIGN IN
Use the account in Sign-in Information. On the sign-in screen choose country Iraq (+964), enter the phone number without the +964 prefix, then the password. No verification code is needed to sign in. Sign in with Apple and Google are also offered; Sign in with Apple is provided as required by guideline 4.8. New accounts confirm their phone number once with a WhatsApp code, which is why a ready account is provided.

The account already has an upcoming booking under My Reservations. You are welcome to reserve and cancel another slot: bookings from this account are marked as test bookings for the venue's front desk.

NO PAYMENT IN THE APP
The app takes no money and asks for no card details. A guest reserves a court and pays at the venue's front desk on arrival, for a real-world service used in person (3.1.3(e)). There are no in-app purchases and no digital goods.

ACCOUNT DELETION
Profile > Delete account, in the app. It deletes the login, the guest's name and phone number immediately and signs them out. For Sign in with Apple accounts the app re-authorises with Apple and the Apple token is revoked. Past bookings remain in the venue's records with no name attached; the deletion screen says so before the user confirms.

PRIVACY
Settings > About > Privacy policy (also linked on the sign-up screen) opens the same policy as the listing. The app contains no analytics, advertising or tracking.

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
3. `node scripts/create-review-account.mjs`, and tell the desk.
4. `eas build` then `eas submit`.
5. Chrome prompt tasks 1 and 3–7 (metadata can start while the build processes; build selection comes last).
6. Owner reads the agent's report, then presses **Add for Review → Submit for Review**.
7. After approval: `node scripts/create-review-account.mjs --delete`.
