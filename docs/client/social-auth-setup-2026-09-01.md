# Social sign-in — console runbook (Sign in with Apple + Google), 2026-09-01

**Continue with Apple** (iOS) and **Continue with Google** (iOS + Android) on the mobile sign-in and
sign-up screens, signing in natively and handing the provider's id token to
`supabase.auth.signInWithIdToken`. This document is the whole external path: what the owner must
decide, the order the consoles have to be touched in, the exact terminal commands, the four
Claude-in-Chrome prompts (canonical copies, house style `docs/client/chrome-agent-prompt.md`; A's and D's
Task 2 were amended on 2026-09-01 after A's first run — see "State" — and Prompt A′ resumes that run), the device
verification matrix, the store-review notes and the gotchas. The reviewer-facing design (nonce,
identity linking, security checklist, migrations) is `docs/design/social-signin-2026-09-01.md`.

**This is a vendor addition, not contract work.** The signed SOW lists "Social or Apple / Google
sign-in" under NOT INCLUDED (`docs/scope/touch-padel-phase1-scope-of-work.txt` L259-260) and the
approved mobile design spec §10 says do-not-build
(`docs/design/mobile-ui/touch-padel-mobile-ui-spec.md:507`). The owner accepted both flags on
2026-09-01 and chose to add it. Email + password stays the contractual path; acceptance never hinges
on this. Recorded in the HANDOFF scope ledger like analytics.

Owner decisions (2026-09-01, final): **D1** Google = native SDK
(`react-native-nitro-google-signin` 2.1.0 → needs an EAS development build; the Google button is
hidden in Expo Go). **D2** Apple = iOS only, native `expo-apple-authentication` (no Services ID, no
6-monthly secret; works in Expo Go on iOS while Supabase lists `host.exp.Exponent`; Android shows
Google + email only). **D3** a **complete-profile** step whenever the signed-in profile has no phone
(the booking write path refuses without one — migration 0059).

Offering Google on iOS makes Apple mandatory (App Store guideline 4.8), which is why both ship
together.

## State on 2026-09-01

- Code exists in the repo (paths in the design note). DB suite 342/342 green including the 8 new
  `packages/db/tests/oauth-profiles.test.ts` cases; `check:locks` / `check:authz` /
  `check:safeupdate` green; migration 0058 proven necessary (cases 2-3 fail on the 0004 trigger
  body); the local GoTrue accepted the `[auth.external.apple]` / `[auth.external.google]` blocks in
  `packages/db/supabase/config.toml`.
- Mobile static gate **green on 2026-09-01** (after the adversarial-review fixes): typecheck, lint,
  vitest 7 files / 99 tests, i18n parity 22/22, `expo export` iOS + Android with the Google env unset,
  expo-doctor 18/18, config introspection (URL scheme + `applesignin` entitlement with a well-formed
  id; `EAS_BUILD=true` throws on unset AND on the committed placeholder). Static only — see the next
  bullet. Exact numbers: HANDOFF Day 11 "Gate".
- **Prompt A ran on 2026-09-01 and was interrupted** (the browser connection dropped in the Web-client form).
  Verified by the Chrome report: Google Cloud project **Touch Padel** — id `touch-padel`, number
  `699390054618`, no organization — under `parsaxavier@gmail.com` (Parsa's personal account, not the
  dedicated Kagu account the plan asked for: a handover item, `API.md` §8); Google Auth Platform configured
  (External, no scopes, no logo, app-domain URLs empty, User Data Policy accepted); publishing status
  **Testing**. **Publish app was disabled** with *"Your app's OAuth configuration is incomplete. You must
  enter the missing information to proceed. Please visit the Branding page to finish configuring your
  app."* — Google requires a home-page URL, a privacy-policy URL and an authorized domain to publish an
  External app (Branding help: "required for all external production apps"), so the plan's "click Publish
  app" step was wrong. **Decision 2026-09-01: stay in Testing with test users until the privacy page
  exists; publish in release week (Prompt D Task 2).** Web + iOS clients **created 2026-09-01** (Prompt A′): Web `699390054618-egm0m36515stvli0dah67htvge6j88nh.apps.googleusercontent.com` (secret present, console only, never used), iOS `699390054618-hdmsl0sn76i09b9esp7tae2t8ktj77sq.apps.googleusercontent.com` → URL scheme `com.googleusercontent.apps.699390054618-hdmsl0sn76i09b9esp7tae2t8ktj77sq` (equals what `app.config.ts` derives). Test users: `parsaxavier@gmail.com` only (1/100) — add every device-test Gmail. Values are in `eas.json` (three profiles), `.env` and `config.toml`. Android client still waits for the EAS SHA-1.
- **Hosted Supabase providers configured 2026-09-01 (Prompt C):** Apple ON, Client IDs
  `com.kagu.touchpadel,host.exp.Exponent`, no secret (Apple's form has NO skip-nonce toggle); Google ON,
  Client IDs = Web,iOS exactly as above, no secret, **Skip nonce checks OFF**; callback
  `https://lczijabnorujcgmbuqlw.supabase.co/auth/v1/callback`; sign-ups ON, anonymous ON, confirm-email ON,
  captcha OFF. Both forms had been pre-populated with `Mustafa.akeel.awad1@gmail.com` and a non-JWT secret
  while disabled — cleared (unknown actor; HANDOFF gotcha). Report-only findings: Site URL still
  `http://localhost:3000`; redirect list = `https://localhost:3000`, the two `touchpadel://` links,
  `exp://192.168.1.108:8081/--/*` (SEC-05 / SEC-18 → release-week Prompt D Task 4). Rate limits in HANDOFF.
- **0058/0059 pushed to hosted on 2026-09-01** from `packages/db` (`npx supabase db push --linked --yes`, after
  an independent read-only verification of both files). Pre-push counts: 15 profiles, **12 phone-less = 6 staff (exempt from 0059) + 6 test guests, 0 of whom hold a reservation**; 130 anonymous cafe users; 15 `email` identities, no apple/google yet. Hosted is at 0059; both
  function bodies verified on hosted via `pg_get_functiondef`.
- **Nothing has been tested on a device.** No Expo/EAS project or Apple Developer team exists yet.
  `apps/mobile/app.config.ts` still carries the
  `owner` / `extra.eas.projectId` TODOs and `apps/mobile/eas.json` carries the real Google
  client ids since 2026-09-01 (Supabase staging values are still `REPLACE_*`).

## Owner inputs (needed before step 1; record the answers in `API.md` §8 — identifiers only)

**(a) Apple Developer enrolment type.**

- **Individual, under a Kagu-controlled Apple ID** — approx. 24–48 h; the recommended path for the
  2026-09-16 submission.
- **Organization** — needs Kagu's **D-U-N-S number**; weeks if Kagu does not already hold one. The
  same D-U-N-S fact decides the Google Play account path (HANDOFF gotcha: personal Play accounts
  created after 2023-11-13 carry the 12-testers / 14-days rule, organization accounts are exempt but
  need a D-U-N-S, 4–8 weeks).
- Apple's `sub` identifiers and Hide-My-Email relay addresses are **per Apple team**. If the app is
  later transferred to another team (e.g. Kagu → Touch), Apple's transfer-identifier migration must
  be run or every Apple user becomes a new account.

**(b) Which Google account owns Google Cloud (and later Google Play).** A dedicated Kagu account,
never a client one. The Cloud project needs **no billing** and no API enablement.

**(c) The Expo account / organisation slug** for `owner` in `apps/mobile/app.config.ts`. It must be
set **before** the first `eas init`, or the EAS project binds to whoever runs the command.

## The order (steps 1–11)

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | `npm i -g eas-cli` → `eas login` → `eas whoami`; set `owner` in `app.config.ts`; `eas init` → paste `projectId`; `eas credentials --platform android` → development → generate keystore → **copy the SHA-1** | owner terminal + Claude | (c) |
| 2 | **Prompt A — Google Cloud**: project, consent screen (**Testing** + test users — production needs the privacy page, step 10), Web + iOS clients, Android client (SHA-1 from 1). *Ran 2026-09-01, interrupted → finish with Prompt A′* | Claude in Chrome | (b), 1 |
| 3 | **Prompt C — Supabase**: Apple + Google providers (change), URL config / sign-up / anonymous / captcha / rate limits (report) | Claude in Chrome | 2 |
| 4 | Code is in the repo; paste the `.env` + `eas.json` values from Prompt A (Web + iOS client ids); push 0058 + 0059 to hosted **before** step 5 | Claude + owner | 2 |
| 5 | `eas build --profile development --platform android` → install APK → **first Google test on Android** | owner terminal | 1, 2, 4 |
| 6 | Apple membership active → accept the Program License Agreement | owner | (a) |
| 7 | `eas device:create` → `eas build --profile development --platform ios` (EAS creates the App ID, syncs Sign in with Apple, ad-hoc profile; owner signs in with 2FA) → **first Google test on iOS; Apple against the real bundle id** | owner terminal | 4, 6 |
| 8 | **Prompt B — Apple Developer** (report-only; `CREATE IT: no` unless step 7 failed): enrolment type, Team ID, expiry, App ID + capability, no Services IDs / keys, ASC record | Claude in Chrome | 6 (best after 7) |
| 9 | Device verification matrix (below) | owner + Claude | 5, 7 |
| 10 | **Prompt D** (before the first Play upload): Play App Signing SHA-1 → second Android client; **publish the consent screen to production** (needs the privacy + home-page URLs on an authorized domain — until then only listed test users can use Google); Supabase re-check | Claude in Chrome | Play Console, privacy page |
| 11 | Week of 2026-09-14: remove `host.exp.Exponent` from the Supabase Apple Client IDs (Prompt D Task 4 with `RELEASE WEEK: yes`); verify the `production` profile env in `eas.json` | Claude in Chrome / owner | store build |

Apple is testable **in Expo Go on the iPhone right after step 3** (the Apple Client IDs list carries
`host.exp.Exponent`). Google only from step 5 (Android) / step 7 (iOS). Store submission is Wed
2026-09-16 (hard stop Fri 2026-09-18).

Deploy order for the database half: **0058 (+ 0059) → dashboard providers (Prompt C) → build.**
Push via the `DB Migrate (staging)` workflow on merge (required reviewer) or from `packages/db`:
`pnpm exec supabase db push --linked --yes` — from **`packages/db`**, never the repo root (there the CLI sees no
migrations and suggests a destructive `migration repair`). Before a behaviour-changing migration run the
pre-push check in the design note with `supabase db query --linked "<sql>"` and record the number. **Done for
0058/0059 on 2026-09-01** (numbers in HANDOFF, 0059 gotcha).

## Commands (run from `apps/mobile` unless stated)

Bash-style below (HANDOFF "Running it" convention). In PowerShell an env prefix becomes
`$env:NAME = 'value'; <command>`.

**Step 1 — Expo account, EAS project, Android keystore + SHA-1**

```
npm i -g eas-cli
eas login
eas whoami                                  # must print the Kagu account from input (c)
# edit app.config.ts: owner: '<kagu expo slug>'  (replace the TODO comment) — BEFORE eas init
eas init                                    # creates the EAS project; paste the printed projectId
                                            # into extra.eas.projectId in app.config.ts
eas credentials --platform android          # profile: development → Keystore → "Set up a new keystore"
                                            # then view the keystore: copy the SHA-1 fingerprint verbatim
```

The SHA-1 goes into Prompt A Task 5 (`EAS keystore: <paste>`). Later, to compare a built APK with
the registered client: `keytool -printcert -jarfile <the .apk>`.

**Step 4 — local sanity checks after pasting the client ids** (no consoles involved)

```
pnpm --filter @touch/mobile run doctor       # expo-doctor ('run' matters: bare 'doctor' is pnpm's own command)
# the URL scheme + the applesignin entitlement appear only when the iOS client id is set
# (a REPLACE_* placeholder counts as UNSET: only <project-number>-<hash>.apps.googleusercontent.com passes):
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios client id> npx expo config --type introspect
# an EAS build without the iOS client id must FAIL at config time (by design, app.config.ts) —
# it also fails with the committed eas.json placeholders, on purpose:
EAS_BUILD=true npx expo config
# CI parity — export with NO Google env must still succeed (Google hidden, plugin skipped):
pnpm --filter @touch/mobile build
```

**Step 5 — Android development build**

```
eas build --profile development --platform android
# install the APK from the build page on the Android phone (developmentClient: true → expo-dev-client)
```

**Step 7 — iOS development build** (after the Apple membership is active and the agreement accepted)

```
eas device:create                            # registers the iPhone's UDID (ad-hoc profile); open the link on the phone
eas build --profile development --platform ios
# EAS signs in to Apple with the owner's Apple ID + 2FA, creates the App ID com.kagu.touchpadel if
# missing, syncs the Sign in with Apple capability (from ios.usesAppleSignIn + the
# expo-apple-authentication plugin), and makes the ad-hoc provisioning profile.
```

The `development` profile in `eas.json` points at the **hosted (client production)** Supabase
project on purpose — a phone cannot reach `127.0.0.1:54321`, and the anon key is public by design.
Every dev sign-in is therefore a real `auth.users` row: throwaway identities only, delete them
afterwards (matrix, last row).

## Prompt A — Google Cloud (project, consent screen, Web + iOS clients; Android when a SHA-1 is pasted)

Fill `<GOOGLE_ACCOUNT>`, `<TEST_USER_EMAILS>` and the SHA-1 line before pasting. Identifiers (client ids, project id and
number, the iOS URL scheme) are public and are reported verbatim; the Web client secret is reported
by presence only and is never needed by the app.

Copy everything below the line into Claude in Chrome.

---

You are setting up Google sign-in infrastructure for a project called **Touch Padel** (a padel club in Iraq;
React Native app, iOS + Android, bundle/package id `com.kagu.touchpadel`; backend Supabase). Work through the
tasks in order, in the browser, signed into this Google account ONLY: `<GOOGLE_ACCOUNT>`. Check the account
avatar first; if a different account is active, stop and tell me — create nothing under the wrong account.
This is Google CLOUD Console — NOT Google Play Console, NOT Firebase.

## Ground rules
- **Never invent a value.** If a page does not show something, say so.
- If a site needs a login, 2FA code, phone confirmation, payment card or identity verification — **stop,
  tell me exactly what you need, and wait**.
- Do NOT enable billing, do NOT enable any API, do NOT create service accounts or API keys, do NOT upload a logo.
- Client IDs, project id/number and the iOS URL scheme MAY be reported verbatim. The Web client **secret must
  never appear in your report** — report only `present (console only)`.
- Final report, exactly this shape:

  ## COLLECTED
  NAME = value            (one per line, real values, no placeholders)
  ## BLOCKED
  - <task> — <precisely what stopped you and what you need from me>
  ## DONE IN-BROWSER
  - <what you created or changed>

## Task 1 — project
1. https://console.cloud.google.com → project picker → **New project**. Name `Touch Padel`; organization:
   whatever the account offers (`No organization` is fine). Create, then switch to it. If a project named
   `Touch Padel` already exists, use it and say so.
2. From the Dashboard's *Project info* card record `GOOGLE_CLOUD_PROJECT_ID` and `GOOGLE_CLOUD_PROJECT_NUMBER`,
   and `GOOGLE_ACCOUNT_USED`.

## Task 2 — consent screen (*APIs & Services → OAuth consent screen* or *Google Auth Platform* → Branding / Audience)
1. App name `Touch Padel`; User support email = the signed-in account; Audience / User type **External**;
   Developer contact email = the same address.
2. Branding → App domain: leave *home page*, *Privacy policy* and *Terms* EMPTY (no privacy URL exists yet —
   known follow-up; these links are what gates publishing, see step 4). Report that they are empty.
3. Scopes / Data access: add NOTHING. If a scope list is shown, report it verbatim (expected none, or only
   `openid`, `…/auth/userinfo.email`, `…/auth/userinfo.profile`).
4. Audience → Publishing status: leave it in **Testing** for now. Google will not publish an External app to
   production without a home-page URL, a privacy-policy URL and an authorized domain on the Branding page
   (verified 2026-09-01: **Publish app** is disabled with "Your app's OAuth configuration is incomplete …
   visit the Branding page"), and those pages do not exist yet. Do NOT fill the app-domain fields and do NOT
   click Publish app. Instead: Audience → **Test users** → **Add users** → `<TEST_USER_EMAILS>` (one Gmail per
   line, the signed-in account included) → Save. Record `CONSENT_PUBLISHING_STATUS` (expected `Testing`),
   `CONSENT_USER_TYPE` and `CONSENT_TEST_USERS`.

## Task 3 — Web client (its id is also the audience of Android id tokens)
*Clients* (or *Credentials → Create credentials → OAuth client ID*):
1. Application type **Web application**; Name `Touch Padel — Supabase (web)`; Authorised JavaScript origins: none;
   Authorised redirect URIs: `https://lczijabnorujcgmbuqlw.supabase.co/auth/v1/callback`.
2. Create. Record `GOOGLE_WEB_CLIENT_ID` (ends `.apps.googleusercontent.com`). Do NOT download the JSON, do NOT
   copy the secret anywhere. Record `GOOGLE_WEB_CLIENT_SECRET = present (console only)`.

## Task 4 — iOS client
1. Create credentials → OAuth client ID → **iOS**; Name `Touch Padel — iOS`; Bundle ID `com.kagu.touchpadel`
   (exactly); App Store ID and Team ID empty.
2. Create; open the client's detail page. Record `GOOGLE_IOS_CLIENT_ID` and the **iOS URL scheme** shown there
   (`com.googleusercontent.apps.…`) as `GOOGLE_IOS_URL_SCHEME`. Both verbatim.

## Task 5 — Android client(s) — ONLY if fingerprints are pasted below; otherwise skip and list under BLOCKED as
"waiting for SHA-1 from eas credentials"
SHA-1 fingerprints (label: value):
- EAS keystore: `<paste or 'none'>`
For EACH fingerprint: Create credentials → OAuth client ID → **Android**; Name `Touch Padel — Android (<label>)`;
Package name `com.kagu.touchpadel`; SHA-1 exactly as pasted. Create. Record `GOOGLE_ANDROID_CLIENT_ID_<LABEL>`.
(Android client ids are used nowhere in the app or Supabase — they only have to EXIST in this project.) If
Google refuses with "already in use", the package + fingerprint pair belongs to another project — report verbatim.

## Final report
COLLECTED expected: GOOGLE_ACCOUNT_USED, GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_PROJECT_NUMBER, CONSENT_USER_TYPE,
CONSENT_PUBLISHING_STATUS, CONSENT_TEST_USERS, GOOGLE_WEB_CLIENT_ID, GOOGLE_WEB_CLIENT_SECRET = present (console only),
GOOGLE_IOS_CLIENT_ID, GOOGLE_IOS_URL_SCHEME, GOOGLE_ANDROID_CLIENT_ID_* (if any). Then BLOCKED and DONE IN-BROWSER.

---

After the report: `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` go into `apps/mobile/eas.json` (all
three profiles), `apps/mobile/.env` (local), `packages/db/supabase/config.toml`
`[auth.external.google] client_id` (Web first, then iOS — then `supabase stop && supabase start`) and
Prompt C. Confirm that `GOOGLE_IOS_URL_SCHEME` equals `com.googleusercontent.apps.` + the iOS client id
with `.apps.googleusercontent.com` removed — that is exactly what `app.config.ts` derives, so no
third env var is needed.

## Prompt A′ — resume Google Cloud after the dropped session (2026-09-01)

The first run of Prompt A on 2026-09-01 created the project and the consent screen, then the browser
connection dropped while the Web client form was open. This prompt finishes Prompt A. Fill
`<TEST_USER_EMAILS>` (every Gmail that will sign in on a test phone) and the SHA-1 line before pasting.

Copy everything below the line into Claude in Chrome.

---

You are RESUMING the Google Cloud setup for **Touch Padel** (a padel club in Iraq; React Native app, iOS +
Android, bundle/package id `com.kagu.touchpadel`; backend Supabase). A previous session created the project and
the consent screen, then the browser dropped while creating the Web client. Work in Google CLOUD Console only —
NOT Google Play Console, NOT Firebase — signed into `parsaxavier@gmail.com`. Check the account avatar first; if
a different account is active, stop and tell me.

Already done — do NOT redo: project **Touch Padel** (id `touch-padel`, number `699390054618`, no organization);
Google Auth Platform configured — app name `Touch Padel`, support + developer contact `parsaxavier@gmail.com`,
audience External, no scopes, no logo, app-domain URLs empty, User Data Policy accepted. Publishing status is
**Testing** and STAYS Testing: Google will not publish an External app to production without a home-page URL, a
privacy-policy URL and an authorized domain, none of which exist yet (a release-week task).

## Ground rules
- **Never invent a value.** If a page does not show something, say so.
- Login / 2FA / payment / identity prompts: **stop, tell me exactly what you need, and wait**.
- Do NOT enable billing or any API, do NOT create service accounts or API keys, do NOT upload a logo, do NOT
  fill the Branding app-domain fields, do NOT click Publish app.
- Client IDs and the iOS URL scheme MAY be reported verbatim. The Web client **secret must never appear in your
  report** — report only `present (console only)`.
- Final report, exactly this shape:

  ## COLLECTED
  NAME = value            (one per line, real values, no placeholders)
  ## BLOCKED
  - <task> — <precisely what stopped you and what you need from me>
  ## DONE IN-BROWSER
  - <what you created or changed>

## Task 1 — test users (Google Auth Platform → Audience → Test users → Add users)
Add exactly these accounts, one per line, then Save:
- `parsaxavier@gmail.com`
- <TEST_USER_EMAILS — one Gmail per line, or 'none'>
Record `CONSENT_TEST_USERS` (the list the page shows afterwards) and `CONSENT_PUBLISHING_STATUS` (expected
`Testing`). Change nothing else on the Audience or Branding pages.

## Task 2 — Web client (its id is also the audience of Android id tokens)
Google Auth Platform → Clients → **Create client** (or APIs & Services → Credentials → Create credentials → OAuth
client ID). First look at the existing client list: if a client named `Touch Padel — Supabase (web)` already
exists from the dropped session, use it and say so — create no duplicate.
1. Application type **Web application**; Name `Touch Padel — Supabase (web)`; Authorised JavaScript origins:
   none; Authorised redirect URIs: `https://lczijabnorujcgmbuqlw.supabase.co/auth/v1/callback`.
2. Create. Record `GOOGLE_WEB_CLIENT_ID` (ends `.apps.googleusercontent.com`). Do NOT download the JSON, do NOT
   copy the secret anywhere. Record `GOOGLE_WEB_CLIENT_SECRET = present (console only)`.

## Task 3 — iOS client
1. Create client → **iOS**; Name `Touch Padel — iOS`; Bundle ID `com.kagu.touchpadel` (exactly); App Store ID
   and Team ID empty.
2. Create; open the client's detail page. Record `GOOGLE_IOS_CLIENT_ID` and the **iOS URL scheme** shown there
   (`com.googleusercontent.apps.…`) as `GOOGLE_IOS_URL_SCHEME`. Both verbatim.

## Task 4 — Android client — ONLY if a fingerprint is pasted below; otherwise skip and list under BLOCKED as
"waiting for SHA-1 from eas credentials"
- EAS keystore SHA-1: `<paste or 'none'>`
Create client → **Android**; Name `Touch Padel — Android (EAS keystore)`; Package name `com.kagu.touchpadel`;
SHA-1 exactly as pasted. Create. Record `GOOGLE_ANDROID_CLIENT_ID_EAS`. (Android client ids are used nowhere in
the app or Supabase — they only have to EXIST in this project.) "Already in use" ⇒ the package + fingerprint pair
belongs to another project — report verbatim.

## Final report
COLLECTED expected: CONSENT_PUBLISHING_STATUS, CONSENT_TEST_USERS, GOOGLE_WEB_CLIENT_ID,
GOOGLE_WEB_CLIENT_SECRET = present (console only), GOOGLE_IOS_CLIENT_ID, GOOGLE_IOS_URL_SCHEME,
GOOGLE_ANDROID_CLIENT_ID_EAS (if any). Then BLOCKED and DONE IN-BROWSER.

---

## Prompt B — Apple Developer (enrolment, Team ID, App ID `com.kagu.touchpadel`; report-only)

Run after the membership is active, ideally after the first `eas build --platform ios` (EAS creates
the App ID). Leave `CREATE IT: no` unless step 7 failed because the App ID was missing.

Copy everything below the line into Claude in Chrome.

---

You are checking Apple Developer configuration for a project called **Touch Padel**. Work in order, in the
browser. Apple's sites always require a login with a two-factor code: when you reach the login, **STOP, tell me,
and wait** — never type codes yourself. This is developer.apple.com — NOT iCloud; App Store Connect only in Task 4.

## Ground rules
- **Never invent a value.** Report exactly what the page shows.
- Do NOT create Services IDs, Keys (.p8), certificates, provisioning profiles or devices. Do NOT purchase, renew,
  enrol or accept agreements — tell me if one is pending. An App ID cannot be renamed or deleted once used.
- Team ID, bundle IDs and enrolment details MAY be reported verbatim. No secrets exist in this task.
- Final report: ## COLLECTED (NAME = value) / ## BLOCKED (- <task> — <what stopped you>) / ## DONE IN-BROWSER
  (<anything changed, or "nothing">).

## Task 1 — enrolment status (report only)
1. https://developer.apple.com/account → **Membership details**. Record `APPLE_ID_USED` (email top right),
   `APPLE_ENROLLMENT_TYPE` (Individual | Organization), `APPLE_TEAM_NAME`, `APPLE_TEAM_ID` (10 characters),
   `APPLE_MEMBERSHIP_EXPIRES`.
2. If NOT enrolled ("Enroll", "pending", "under review"): record `APPLE_ENROLLMENT_STATUS = <exact text>`, STOP,
   list Tasks 2–4 under BLOCKED — enrolment is a payment + identity step I do myself.
3. Report any banner about an agreement to accept (Program License Agreement / Paid Applications) verbatim as
   `APPLE_AGREEMENT_PENDING` — an unaccepted agreement blocks our build service.

## Task 2 — App ID `com.kagu.touchpadel`
https://developer.apple.com/account/resources/identifiers/list → filter **App IDs**.
1. If it EXISTS: open it; record `APPLE_APP_ID_EXISTS = yes`, `APPLE_APP_ID_SIWA = <yes/no>` (Sign in with Apple
   ticked, "Enable as a primary App ID"), `APPLE_APP_ID_PUSH = <yes/no>`. Change nothing.
2. If it does NOT exist: record `APPLE_APP_ID_EXISTS = no` and STOP without creating it — our build service
   (EAS) creates and configures it on the first iOS build. EXCEPTION, only if the line below says `yes`:
   Register a new identifier → App IDs → App → Description `Touch Padel`, Bundle ID **Explicit**
   `com.kagu.touchpadel`, tick **Sign in with Apple** (primary App ID) and **Push Notifications** → Register.
   CREATE IT: `no`

## Task 3 — Sign in with Apple prerequisites (report only)
1. Identifiers → filter **Services IDs**: record `APPLE_SERVICES_IDS = none` or the names (expected none —
   native-only needs no Services ID).
2. https://developer.apple.com/account/resources/authkeys/list: record `APPLE_SIWA_KEYS = none` or names of keys
   with Sign in with Apple enabled (expected none). Create nothing.

## Task 4 — App Store Connect (report only)
https://appstoreconnect.apple.com → Apps. Record `ASC_APP_RECORD = none` or the numeric Apple ID of the
`Touch Padel` / `com.kagu.touchpadel` app (App Information → General). Do NOT create an app record.

## Final report
COLLECTED expected: APPLE_ID_USED, APPLE_ENROLLMENT_TYPE, APPLE_TEAM_NAME, APPLE_TEAM_ID, APPLE_MEMBERSHIP_EXPIRES,
APPLE_AGREEMENT_PENDING, APPLE_APP_ID_EXISTS, APPLE_APP_ID_SIWA, APPLE_APP_ID_PUSH, APPLE_SERVICES_IDS,
APPLE_SIWA_KEYS, ASC_APP_RECORD.

---

After the report: `APPLE_TEAM_ID`, enrolment type and expiry go into `API.md` §8. `APPLE_SERVICES_IDS`
and `APPLE_SIWA_KEYS` are expected `none` — the native flow needs neither. (A Sign in with Apple `.p8`
key becomes necessary only for the future account-deletion feature's token revocation — see the design
note; it is server-side and is not created here.)

## Prompt C — Supabase (Apple + Google providers = change; everything else = report)

Paste the two Google client ids from Prompt A. This is the **client's production project** — the
prompt changes only the two provider forms.

Copy everything below the line into Claude in Chrome.

---

You are configuring **native** Sign in with Apple and Google (id-token sign-in only, no browser OAuth) on the
Supabase project of **Touch Padel**. Project ref `lczijabnorujcgmbuqlw`, region eu-central-1,
https://supabase.com/dashboard/project/lczijabnorujcgmbuqlw. **This is the client's PRODUCTION project**:
change only the two provider forms in Tasks 1–2; everything else is report-only.

Values from the Google Cloud step:
- `GOOGLE_WEB_CLIENT_ID = <paste>`
- `GOOGLE_IOS_CLIENT_ID = <paste>`

## Ground rules
- **Never invent a value.** If a field or toggle is not there, say so.
- If the dashboard asks for a login or 2FA — stop and wait for me.
- For every field you change, report the value BEFORE and AFTER, quoted verbatim.
- Secrets (anon key, service-role key, JWT secret, any client secret): presence only — never paste them.
- Final report: ## COLLECTED / ## BLOCKED / ## DONE IN-BROWSER (exact settings changed, before → after).

## Task 1 — Apple provider (CHANGE)
Authentication → Sign In / Providers → **Apple**.
1. Report the current state (enabled?, Client IDs, Secret Key present?).
2. Turn **Enable Sign in with Apple** ON.
3. **Client IDs**: `com.kagu.touchpadel,host.exp.Exponent` — exactly, comma-separated, no spaces
   (`host.exp.Exponent` is the Expo Go development client; removing it before store release is a known follow-up).
4. **Secret Key (for OAuth)**: leave EMPTY — native sign-in does not use it. If the form refuses to save without
   it, do NOT invent one: STOP, report the exact validation message, leave the provider OFF.
5. If a *Skip nonce checks* toggle exists here, leave it OFF and report that it exists.
6. Save. Report the saved values.

## Task 2 — Google provider (CHANGE)
Same page → **Google**.
1. Report the current state.
2. Turn **Enable Sign in with Google** ON.
3. **Client IDs**: `<GOOGLE_WEB_CLIENT_ID>,<GOOGLE_IOS_CLIENT_ID>` — Web first, then iOS, comma, no spaces.
   Android is deliberately NOT listed (Android id tokens carry the Web client id as audience).
4. **Client Secret (for OAuth)**: leave EMPTY. If Save is refused without it, STOP and report the message — do not
   fetch the Google secret unless I say so in a follow-up.
5. **Skip nonce checks**: **OFF** (the app sends its own nonce). Report the toggle's state after saving.
6. Save. Report the saved values and the **Callback URL** shown (expected
   `https://lczijabnorujcgmbuqlw.supabase.co/auth/v1/callback`).

## Task 3 — URL configuration (REPORT ONLY)
Authentication → URL Configuration. Record `SUPABASE_SITE_URL` and every **Redirect URL** verbatim as
`SUPABASE_REDIRECT_URLS`. Expected to include `touchpadel://verify-email` and `touchpadel://reset-password`;
report any that are missing — do not add anything.

## Task 4 — sign-up, anonymous and captcha settings (REPORT ONLY)
1. Sign In / Providers → *User Signups*: **Allow new users to sign up** → `SIGNUPS_ALLOWED` (expected ON);
   **Allow anonymous sign-ins** → `ANON_SIGNINS` (expected ON — the cafe's guest sessions depend on it).
2. Email provider → **Confirm email** → `CONFIRM_EMAIL`.
3. Authentication → Attack Protection (or Settings → Bot and Abuse Protection): **Enable Captcha protection** →
   `CAPTCHA` (expected OFF; if ON also record the provider — native sign-in would then need a captcha token).

## Task 5 — rate limits (REPORT ONLY)
Authentication → Rate Limits — record verbatim with units: `RATE_LIMIT_TOKEN_VERIFICATIONS`,
`RATE_LIMIT_SIGNUPS_SIGNINS`, `RATE_LIMIT_ANONYMOUS_USERS`, `RATE_LIMIT_TOKEN_REFRESHES`. Change nothing.

## Task 6 — proof of a new identity (REPORT ONLY; only if I give an email)
Authentication → Users → search `<TEST_EMAIL or 'skip'>`. Report the **Providers** column (expected `apple` or
`google`) and whether *Last sign in* is set. Delete nothing.

## Final report
COLLECTED expected: APPLE_PROVIDER = enabled, client ids "<…>", secret = <empty|present>; GOOGLE_PROVIDER =
enabled, client ids "<…>", secret = <empty|present>, skip_nonce = off; GOOGLE_CALLBACK_URL; SUPABASE_SITE_URL;
SUPABASE_REDIRECT_URLS; SIGNUPS_ALLOWED; ANON_SIGNINS; CONFIRM_EMAIL; CAPTCHA; the four RATE_LIMIT_* values;
Task 6 if run.

---

After the report: cross-check the two Client IDs lists against `packages/db/supabase/config.toml`
(`[auth.external.apple]` / `[auth.external.google]`) — the hosted lists and the local file must carry
the same values (minus the `REPLACE_*` placeholders, which the report replaces). Treat the rate-limit
values as a record for the security reviewer (design note checklist item 3) — do not raise them. If
the dashboard refused to save a provider without a secret, that is a BLOCKED item for the owner, not
something to work around.

## Prompt D — later: Android client per new SHA-1 (Play App Signing) + Supabase re-check + release hygiene

Run before the first Play upload (the Play App Signing key has its own SHA-1 → its own Android OAuth
client, or the store build gets `DEVELOPER_ERROR`). Task 2 publishes the consent screen to production once
the privacy + home pages exist — until then only listed test users can use Google, so it must happen before
any non-test guest touches a store build. Task 4 runs only in the week of 2026-09-14 with
`RELEASE WEEK: yes`, immediately before the store build.

Copy everything below the line into Claude in Chrome.

---

You are finishing the Android half of Google sign-in for **Touch Padel**. Use Google account `<GOOGLE_ACCOUNT>`
and the existing Google Cloud project `<GOOGLE_CLOUD_PROJECT_ID>`. Then verify — without changing — the Supabase
Google provider, and (Task 4, release week only) tidy the Apple provider.

SHA-1 fingerprints to register (label: value; each becomes its own client):
- EAS keystore: `<SHA-1 or 'already done'>`
- Play App Signing key: `<SHA-1 or 'not yet'>`   (Play Console → Test and release → Setup → App signing → "App signing key certificate")
- Local debug keystore: `<SHA-1 or 'skip'>`

## Ground rules
- **Never invent a value.** Stop at any login/2FA and wait for me.
- Create Android OAuth clients only; the ONLY other changes are Task 2's Branding links + Publish app (when its
  URL lines are filled) and Task 4's Supabase hygiene (release week). No billing, no APIs, no other client
  types, nothing deleted.
- Client ids MAY be reported verbatim; no secrets exist for Android clients.
- Final report: ## COLLECTED / ## BLOCKED / ## DONE IN-BROWSER.

## Task 1 — Android OAuth clients (Google Cloud → Google Auth Platform → Clients / Credentials)
1. List the EXISTING Android clients (name + last 4 hex pairs of their SHA-1) as `GOOGLE_ANDROID_CLIENTS_EXISTING`.
2. For EACH fingerprint above not already registered: Create client → **Android** → Name
   `Touch Padel — Android (<label>)` → Package `com.kagu.touchpadel` → SHA-1 exactly as given. Create. Record
   `GOOGLE_ANDROID_CLIENT_ID_<LABEL>`. "Already in use" ⇒ the pair belongs to another project — report verbatim.

## Task 2 — consent screen → production (CHANGE only if both URL lines are filled; otherwise REPORT ONLY)
- Home page URL: `<HOME_URL or 'not yet'>`
- Privacy policy URL: `<PRIVACY_URL or 'not yet'>`
- Terms of service URL: `<TERMS_URL, or 'same' to reuse the privacy URL>`
If both are filled: Google Auth Platform → **Branding** → App domain → enter the three links; **Authorized
domains** → add the domain of those URLs (if Google refuses because the domain is not verified in Search
Console, STOP and report the exact message); Save. Then **Audience** → **Publish app** → confirm. If Google
demands verification, STOP — do not submit — report the message. Record `CONSENT_PUBLISHING_STATUS` (expected
`In production` afterwards) and the three URLs exactly as saved. If not filled: record
`CONSENT_PUBLISHING_STATUS` (expected `Testing`) and list this task under BLOCKED as "waiting for the privacy
page".

## Task 3 — Supabase Google provider (REPORT ONLY)
https://supabase.com/dashboard/project/lczijabnorujcgmbuqlw/auth/providers → Google: enabled?, the full
**Client IDs** value (expected to still contain the Web and iOS client ids — nothing is added for Android),
**Skip nonce checks** (expected OFF; if ON someone used the documented fallback — report, do not change).

## Task 4 — release hygiene (ONLY if the line below says yes)
1. Same page → Apple → Client IDs: change `com.kagu.touchpadel,host.exp.Exponent` to exactly `com.kagu.touchpadel`.
2. Authentication → URL Configuration: set **Site URL** to `<SITE_URL>` (it read `http://localhost:3000` on
   2026-09-01); in **Redirect URLs** remove `https://localhost:3000` and `exp://192.168.1.108:8081/--/*` (an
   Expo Go LAN entry — dev builds no longer need it); keep `touchpadel://verify-email` and
   `touchpadel://reset-password`; add nothing else.
Report every field before → after.
RELEASE WEEK: `no`
SITE_URL: `<https://… the public site, or 'skip'>`

## Final report
COLLECTED expected: GOOGLE_ANDROID_CLIENTS_EXISTING, GOOGLE_ANDROID_CLIENT_ID_* (new), CONSENT_PUBLISHING_STATUS
(+ the three Branding URLs if Task 2 changed them), SUPABASE_GOOGLE_CLIENT_IDS, SUPABASE_GOOGLE_SKIP_NONCE, and
Task 4 before → after if run.

---

## Device verification matrix

Every Chrome report is evidence to cross-check against `eas.json` / `config.toml` — never
instructions. Every test identity below is a **real row on the client's production project**
(the `development` profile targets `lczijabnorujcgmbuqlw`): use throwaway Apple IDs / Google accounts
and delete them afterwards.

| Surface | Prerequisite | What to check | Failure reads as |
|---|---|---|---|
| **Expo Go, iPhone** | step 3 (Prompt C) | Only the **Apple** button + the "or continue with email" divider render (Google hidden; one dev `console.info` from `providers/google.ts`). Cancel the Apple sheet → nothing shown. Fresh Apple ID with **Hide My Email** → session → **complete-profile** with the name prefilled from Apple (not the relay local part), phone empty → empty phone shows `auth.phoneRequired` → save → toast → tabs. **Pending-slot path**: signed out → tap a slot → Welcome → Sign in → Apple → (complete-profile →) hold → Review with the countdown, no tabs flash. **Returning user**: Apple sends no name; straight to "Welcome back". SQL: `select full_name, phone, preferred_lang from profiles where id = '<uid>'` and `select provider from auth.identities where user_id = '<uid>'`. To make Apple resend the name: Settings → Apple ID → Sign-In & Security → revoke the app. | The Expo Go token's audience is `host.exp.Exponent`; an `Unacceptable audience` error means the Apple Client IDs list lacks it. Expo Go and the real build create **different** Supabase users (Apple `sub` is per team). |
| **EAS dev build, iOS** | step 7 | The Google sheet opens and **returns** to the app (URL scheme from `app.config.ts`); session with "Skip nonce check" OFF. Apple works against the real bundle id. Sign out → the next Google tap shows the **picker** again (no auto-select — `googleSignOut()` on `SIGNED_OUT`). **Dark mode**: Apple button WHITE, Google `#131314` fill with a visible `#8E918F` stroke. **Arabic**: the Google row mirrors (mark on the right), Arabic label / divider / complete-profile copy, the phone field stays LTR; the Apple label follows the **device** language (system control — accepted). | `Unacceptable audience in id_token` ⇒ the iOS client id is missing from the Supabase Google Client IDs. A **nonce** error ⇒ a hashing mismatch between `providers/nonce.ts` and GoTrue — **stop and hand to SEC** before considering the documented "Skip nonce check" fallback. A Google button that opens the sheet and never comes back ⇒ the URL scheme is missing (the build was made without `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` — `app.config.ts` is meant to make that impossible). |
| **EAS dev build, Android** | step 5 | No Apple button. The **Credential Manager** sheet (or the explicit picker after "no saved credential") → session → profile name from Google → the phone gate → book. Phone without Play services → `auth.googlePlayServices` copy, email still works. | `DEVELOPER_ERROR` / a picker that closes instantly ⇒ no Android OAuth client for this APK's SHA-1, a package-name mismatch, or the Google account on the phone not in the consent screen's **test users** (it stays in Testing until release week): compare `keytool -printcert -jarfile <apk>` with the registered client. **Status 16** ⇒ Play services cooldown after repeated cancels, not code — wait, do not debug. A **cancel right after choosing an account** is usually the same missing-SHA-1 fault in disguise (Credential Manager conflates dismissal and misconfiguration): `providers/google.ts` logs every Android cancel as `auth.google.cancelled` (warning, with the cascade step) in the dev console / telemetry — a spike there is the signal; look before blaming the guest. |
| **Write-path gates** | either dev build, or Expo Go via Apple | `update profiles set phone = null where id = '<test uid>'` → signed in, tap a slot → complete-profile (`returnTo=continue`) → save → hold → Review. Null the phone again → open Review: **Reserve disabled + amber notice** → "Add phone number" (`returnTo=back`) → Reserve enabled, countdown intact. Profile → Edit refuses an empty phone. With 0059 on hosted: a `confirm_booking` while the gate read 'unknown' → `PHONE_REQUIRED` → routes to complete-profile. Profile tab shows the nudge card while the phone is blank. | A guest stranded on the tabs after a social sign-in with a pending slot ⇒ the `(auth)` layout redirect raced the continuation — check `pendingSlot` is still set until the hold settles. |
| **Identity linking** | any build | An existing email/password guest signs in with Google using the **same** email → one uid, two rows in `auth.identities`, phone intact, **no** complete-profile gate. A Google-only user tries email/password → generic "Invalid login credentials" → forgot-password → reset → password now works (one account). | A second account for the same person ⇒ the emails differ (an Apple relay address never matches) — expected, documented in the design note. |
| **Regression** | any build | Email/password sign-in and sign-up, verify-email → verify-result → Continue, forgot / reset deep links; staff sign-in in the operator app; the anonymous cafe web flow (an anonymous session still has **no** profiles row). | — |
| **Cleanup** | after every session | Delete every test user in Authentication → Users. **A user who booked cannot be deleted** (the `reservations.guest_id` FK — HANDOFF gotcha): cancel/void their bookings at the desk first or leave them and record the uid. Check the Supabase Auth logs for `provider is not enabled` / `Unacceptable audience` — those are configuration faults that must show up in telemetry as such, never as "no internet". | — |

Record the outcome of each row in HANDOFF (Day 11 or later) with the date; nothing above has run as of
2026-09-01.

## Store-review notes

- **App Store 4.8 (Login Services)** — offering Google on iOS obliges an equivalent privacy-preserving
  option; **Sign in with Apple satisfies it** (name + email only, Hide My Email honoured — the app stores
  only what the user shares, and a relay address is accepted). This is the reason both providers ship
  together.
- **App Store 5.1.1(v) (account deletion)** — **still open and still FK-blocked** (HANDOFF gotcha:
  `reservations.guest_id references profiles(id)` has no on-delete clause; a migration is mandatory).
  Sign in with Apple **adds** a requirement to that task: Apple obliges apps offering it to **revoke the
  user's Apple tokens** (`POST https://appleid.apple.com/auth/revoke`) when the account is deleted;
  `auth.admin.deleteUser` does not do it, and the id-token grant yields no refresh token, so the deletion
  flow must re-authenticate with Apple for a fresh `authorizationCode` and revoke it server-side with a
  Sign in with Apple `.p8` key held in an edge function — the **only** Apple secret this feature ever
  introduces. Details in the design note §8.
- **Privacy-policy URL dependency** — no privacy page exists (verified 2026-09-01: nothing named
  `privacy` under `apps/web`). Google's consent-screen branding (left empty in Prompt A Task 2), App
  Store Connect, Google Play's Data safety form and the web **deletion-request page** (SEC-17) all need
  one. Proposed: `https://touch-padel-web.vercel.app/{ar,en}/privacy` until `touch-padel.com` lands
  (`docs/client/domain-setup-2026-08-30.md`), then the real domain. Scheduled in roadmap 7; **not built
  here**. Once it exists, add it to the Google consent screen (Prompt A Task 2 follow-up).
- **Data declared to the stores** — the id-token flow adds to `auth.users.raw_user_meta_data`: Google
  `name` / `picture` / `avatar_url` / `email`; Apple `email` (possibly a relay) and `is_private_email`.
  `profiles` stores only `full_name`, `phone`, `preferred_lang` — never the picture. Declare accordingly
  in Apple's privacy labels and Play's Data safety.
- **Review notes** — keep the email/password demo account (design-delivery W3/W4); reviewers may exercise
  Sign in with Apple with their own Apple ID, which will create a real row on production — delete it
  afterwards like any test identity.
- **Release hygiene before the store build** — remove `host.exp.Exponent` from the Apple Client IDs
  (Prompt D Task 4), and verify the `production` profile in `eas.json` carries the real
  `EXPO_PUBLIC_GOOGLE_*` values (an EAS build fails at config time if the iOS id is unset — by design).

## Gotchas

- **External state, end of 2026-09-01:** Google Cloud project + Web/iOS clients exist (consent screen in
  Testing), hosted Supabase providers are ON (Prompt C), 0058/0059 pushed to hosted; still no Expo account /
  EAS project, no Apple team. The Apple membership (approx. 48 h,
  individual) gates the iOS dev build **and** the 2026-09-16 submission; Google is untestable until the
  first EAS build; the consent screen stays in **Testing** until the privacy + home pages exist (Google will
  not publish an External app without them — verified 2026-09-01), so only listed **test users** can use
  Google until release week: add every device-test Gmail as a test user (Prompt A′ Task 1).
- **Google Cloud, verified 2026-09-01 (Prompt A, interrupted):** project `touch-padel` / `699390054618`, no
  organization, under `parsaxavier@gmail.com` (personal — handover item); consent screen External, Testing,
  no scopes, no logo, app-domain URLs empty, User Data Policy accepted; **Publish app disabled** ("OAuth
  configuration is incomplete … Branding page") — the fix is the release-week privacy page, not a console
  setting; Web + iOS clients created on the second run (Prompt A′, same day; the dropped form had submitted
  nothing). Android waits for the EAS SHA-1. The plan's assumption that basic scopes let you publish with empty
  app-domain fields was wrong and is withdrawn.
- **Set `owner` in `app.config.ts` BEFORE `eas init`.** Otherwise the EAS project binds to whoever runs
  the command (mobile audit §2.2). The `owner` and `extra.eas.projectId` lines are still TODOs.
- **One Android OAuth client per signing key.** EAS keystore, Play App Signing key and any local debug
  keystore each need their own Android client in Google Cloud; `DEVELOPER_ERROR` almost always means a
  missing one (or the consent screen in Testing) — and so does a **cancel right after the account
  picker** (Credential Manager reports `RESULT_CANCELED` for both; the app records every Android cancel
  as the `auth.google.cancelled` warning with the cascade step). Android client ids are entered nowhere — Android id
  tokens carry the **Web** client id as `aud`, which is why Supabase lists Web + iOS only.
- **`host.exp.Exponent` must leave the Apple Client IDs before the store build** (step 11 / Prompt D Task
  4). While listed, an Expo Go token can sign in as its holder's own Apple identity only — a guest
  account, nothing more — but it does not belong in a production list.
- **`eas.json development` points at the client's production Supabase.** Every dev social sign-in is a
  real `auth.users` row; throwaway accounts only, delete afterwards (users who booked cannot be deleted
  — FK gotcha).
- **An EAS build fails at config time if `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is unset or still a
  `REPLACE_*` placeholder** (`app.config.ts`, by design: a binary without the URL scheme has a Google
  button that never returns; only `<project-number>-<hash>.apps.googleusercontent.com` counts as set,
  so the committed `eas.json` values fail until Prompt A's real ids are pasted). Conversely the
  Google button is **hidden** in Expo Go and whenever `EXPO_PUBLIC_GOOGLE_*` is unset or a placeholder
  — a missing button on a dev build is a config symptom, not a UI bug. CI's `expo export` runs with the Google env unset on
  purpose (proves no module-scope throw and an optional plugin).
- **Apple delivers the name ONLY on the first authorization.** The app patches `profiles.full_name` +
  user metadata immediately, best-effort; if that fails offline the profile keeps `''` (relay) or the
  email local part, `prefillDisplayName` hides it and the field is editable. The patch never overwrites
  a name the guest already chose (an existing email/password guest who signs in with Apple using her
  real email is LINKED to her account, and Apple still sends the name): only a blank or trigger-fallback
  name is filled. Revoke the app under Settings → Apple ID → Sign-In & Security to make Apple resend it.
- **Apple `sub` and relay emails are per Apple team.** An Expo Go sign-in (`host.exp.Exponent`, Expo's
  team) and a real-build sign-in are **different** Supabase users. Hide My Email never matches an
  existing email/password guest → a second account (accepted; complete-profile asks for the phone
  again).
- **The native Apple button follows the device language, not the in-app switch.** The Google label uses
  the platform system font at 17 / 600 rather than Google's spec font (Google Sans Medium 14 cannot be
  shipped) for optical parity with the Apple label; the mark, colours and stroke are exact and the mark
  is never recoloured or mirrored.
- **The `(auth)` layout now waits for the own-profile query before redirecting a signed-in user** (one
  extra round trip; fails open to the tabs on a query error — the booking gates re-check).
  `profile-edit` now **requires** a phone (spec 05.3) — the only way an email/password user could have
  reached the gate.
- **0059 is a behaviour change on a contractual RPC.** Hosted guests with a NULL phone are refused at
  `confirm_booking` (`PHONE_REQUIRED`) until they add one. Pushed 2026-09-01 after the pre-push count (15 profiles, **12 phone-less = 6 staff (exempt from 0059) + 6 test guests, 0 of whom hold a reservation**; 130 anonymous cafe users; 15 `email` identities, no apple/google yet).
  Holds are unaffected (`hold_slot` needs only an account).
- **Local GoTrue verifies id tokens against Apple's / Google's JWKS online** — `supabase start` needs
  internet for those two flows; `config.toml` provider edits need `supabase stop && supabase start`
  (a `db reset` alone does not reload GoTrue).
- **The Google SDK is young** (`react-native-nitro-google-signin` 2.1.0, repo created 2026-06-01). It is
  isolated in `apps/mobile/src/features/auth/providers/google.ts` and guarded by a boundary test; the
  export names used (`GoogleOneTapSignIn`, `statusCodes`, `checkPlayServices`, `createAccount`,
  `presentExplicitSignIn`, `configure({ …, nonce })`) were confirmed against the 2.1.0 README on
  2026-09-01. A build or runtime failure means a **one-file swap** to
  `@react-native-google-signin/google-signin` "Original" — which has no nonce support, so the swap also
  means Supabase "Skip nonce check" ON for Google, a security-reviewer decision.
- **iOS starts the Google cascade at the interactive step** (`firstGoogleAttempt` in `social.ts`; found
  by the 2026-09-01 adversarial review and verified in the library's Swift source). The nitro `signIn()`
  on iOS returns `GIDSignIn.currentUser` / a keychain restore — an id token from an EARLIER
  authorization whose nonce claim cannot equal this attempt's — so after one failed exchange every later
  tap would have been refused by GoTrue for ever. Only `createAccount()` / `presentExplicitSignIn()`
  mint a token with the configured nonce. On a device, a Google sheet that opens straight away on iOS
  (no silent restore) is therefore correct, not a regression. Android keeps the silent step.
- **Status 16 on Android is a Play-services cooldown**, not code — it follows repeated cancelled
  attempts; wait and retry.
- **The RTL lint guard is partially inert** (`packages/config/src/eslint.js:44` matches only
  `textAlign`) — logical props on the new components (`paddingStart` / `paddingEnd` in
  `components/social.tsx`) are enforced by review, not by lint. Recorded, not fixed here.
