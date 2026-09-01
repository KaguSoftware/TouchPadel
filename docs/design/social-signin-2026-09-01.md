# Social sign-in (Sign in with Apple + Google, native) — design note for security review, 2026-09-01

For the security reviewer (SEC) and the PR description. Companion: the console runbook with the
four Claude-in-Chrome prompts and the device matrix, `docs/client/social-auth-setup-2026-09-01.md`.
Approved plan: `~/.claude/plans/on-the-mobile-app-zippy-hennessy.md`.

## 1. What and why

`apps/mobile` authenticated with email + password only. The owner asked for **Continue with Apple**
and **Continue with Google** on the sign-in and sign-up screens. Both providers sign in **natively**
(system sheet, no browser) and hand the resulting **id token** to
`supabase.auth.signInWithIdToken({ provider, token, nonce })`. No browser OAuth, no redirect URLs, no
Services ID, no rotating Apple client secret.

- **Vendor addition, not contract work.** SOW `docs/scope/touch-padel-phase1-scope-of-work.txt`
  L259-260 lists "Social or Apple / Google sign-in" under NOT INCLUDED; the approved mobile design
  spec §10 says do-not-build (`docs/design/mobile-ui/touch-padel-mobile-ui-spec.md:507`). Owner
  accepted on 2026-09-01. Email/password stays the contractual path; acceptance never hinges on this.
- **Both together.** Offering Google on iOS makes an equivalent privacy-preserving option mandatory
  (App Store guideline 4.8); Sign in with Apple satisfies it.
- **Owner decisions (2026-09-01, final).** D1 Google = native SDK → EAS development build required;
  Google hidden in Expo Go. D2 Apple = iOS only, native; Android shows Google + email only. D3 a
  **complete-profile** step whenever the signed-in profile has no phone — the phone is a required
  profile field (spec 05.3), Apple and Google carry none, and the booking write path must refuse
  without one (migration 0059).

Libraries (stated exactly): **Google** = `react-native-nitro-google-signin` **2.1.0** (MIT; Android
Credential Manager + the Google Sign-In SDK for iOS; peer `react-native-nitro-modules` `^0.37.1`;
Expo config plugin option `iosUrlScheme`, derived in `apps/mobile/app.config.ts` from
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`). Chosen over `@react-native-google-signin/google-signin` 16.1.4,
whose free tier sits on Google's deprecated legacy Android Sign-In SDK (Credential Manager support is
paid there). **Apple** = `expo-apple-authentication` (SDK 54, `~8.0.8`), the native
`AppleAuthenticationButton`, iOS only. **Nonce** = `expo-crypto` (`~15.0.9`). Also `expo-dev-client`
for the development build.

## 2. Architecture (paths are real; line numbers as of 2026-09-01)

```
tap ─► useSocialSignIn.signInWith(p)
        ├─ newNonce()                        providers/nonce.ts   {raw, hashed = sha256hex(raw)}
        ├─ provider SDK(hashed)              providers/apple.ios.ts | providers/google.ts
        │     └─ id token  (nonce claim = hashed; aud = bundle id | Google client id)
        ├─ signInWithIdToken({token, nonce: raw})     features/auth/api.ts
        │     └─ GoTrue: JWKS signature · iss · exp · aud ∈ Client IDs · sha256(raw) == claim
        │           └─ auth.users insert ─► trigger app.handle_new_user (0058) ─► profiles row
        ├─ queryClient.fetchQuery(own-profile)   read FIRST — the identity may have LINKED to an existing account
        ├─ (Apple, first authorization, blank/fallback name only) updateOwnProfile + setUserMetadata  best-effort
        ├─ needsProfileCompletion(profile)
        └─ incomplete ? (pending slot ? router.replace(complete-profile?returnTo=continue)
                                      : return — the (auth) layout's derived <Redirect> routes)
                      : onComplete()  ─► toast + continueAfterAuth()   (identical to the email path)
```

| Layer | File | What it holds |
|---|---|---|
| Pure module | `apps/mobile/src/features/auth/social.ts` | No RN / Expo / Supabase imports. `SocialProvider`, `PROVIDER_LABEL`, `SocialAuthError` (library-agnostic codes `CANCELLED · IN_PROGRESS · PLAY_SERVICES_NOT_AVAILABLE · DEVELOPER_ERROR · UNAVAILABLE · NO_ID_TOKEN · FAILED`), `makeNonce(random, sha256Hex)`, `appleDisplayName`, `mapSocialError`, `needsProfileCompletion`, `profileGateState`, `prefillDisplayName`, `buildProfilePatch` (Apple; only over a blank / trigger-fallback name), `nextGoogleStep`, `firstGoogleAttempt` (iOS starts interactive — §3), `isGoogleClientId` (a `REPLACE_*` placeholder = unset). |
| Pure-module tests | `apps/mobile/src/features/auth/__tests__/social.test.ts` | 10 `describe` blocks, 28 cases: nonce (raw passthrough, hashed = hasher(raw), empty rejected, distinct per call), name join matrix, every error mapping incl. `Unacceptable audience in id_token` → `auth.socialFailed` (reported) and `Network request failed` → `errors.network` (not reported), the profile-completion truth table, the gate matrix, relay-local-part hiding, the Apple-only patch and its linked-account guard, the Credential Manager cascade and its iOS start, the client-id shape check. Runs under `environment: 'node'` (`apps/mobile/vitest.config.ts`). |
| Nonce adapter | `apps/mobile/src/features/auth/providers/nonce.ts` | `newNonce()` = `makeNonce(() => Crypto.randomUUID(), s => Crypto.digestStringAsync(SHA256, s, {encoding: HEX}))`. One fresh nonce per attempt; never persisted, never logged. |
| Apple adapter | `providers/apple.ios.ts` (iOS) / `providers/apple.ts` (every other platform) | iOS: `isAvailableAsync()`, `signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce: hashed })` → `{ identityToken, fullName, email }`; maps `ERR_REQUEST_CANCELED` → `CANCELLED`, `ERR_REQUEST_NOT_HANDLED` / `ERR_REQUEST_NOT_INTERACTIVE` → `UNAVAILABLE`, else `FAILED`. Non-iOS file: `isAppleSignInAvailable()` = `false`, `requestAppleCredential` throws `UNAVAILABLE`. Metro picks the `.ios.ts` file on iOS; `tsc` checks against the plain file — both export identical signatures. **Android never bundles `expo-apple-authentication`.** |
| Google adapter | `providers/google.ts` | **The only file importing the Google SDK.** `isGoogleSignInAvailable()` = `!isRunningInExpoGo() && WEB_CLIENT_ID && (Platform.OS !== 'ios' || IOS_CLIENT_ID)` where both ids must pass `isGoogleClientId` (a `REPLACE_*` placeholder = unset; one dev-only console line when hidden). `requestGoogleIdToken(hashed)`: lazy `import('react-native-nitro-google-signin')` (module evaluation throws where the native side is absent — never at module scope); Android `checkPlayServices()`; `configure({ webClientId, iosClientId, nonce: hashed })` per attempt; `signIn()` → `createAccount()` → `presentExplicitSignIn()` via `nextGoogleStep`, **starting at `createAccount()` on iOS** (`firstGoogleAttempt` — the iOS `signIn()` returns the cached `GIDSignIn.currentUser`, whose token carries an earlier nonce; §3); every Android cancel is recorded as `captureMessage('auth.google.cancelled', 'warning', { attempt })` because Credential Manager conflates dismissal and misconfiguration (even the "silent" `signIn()` shows a sheet when an authorized account exists); maps `statusCodes.*` to `SocialAuthError`. `googleSignOut()` best-effort. Header documents the one-file swap to the mature library. |
| Supabase calls | `apps/mobile/src/features/auth/api.ts` | `signInWithIdToken(client, { provider, token, nonce })` — passes the **raw** nonce, throws on error, returns `{ user, session }`. `setUserMetadata(client, { full_name })` → `auth.updateUser({ data })`. `apps/mobile/src/features/profile/api.ts` `updateOwnProfile` fields widened to `{ full_name?, phone?, preferred_lang? }` (existing own-row RLS UPDATE grant — **no new RPC**). |
| Orchestration | `apps/mobile/src/features/auth/useSocialSignIn.ts` | `{ available: {apple, google}, busyProvider, errorText, clearError, signInWith }`. Breadcrumbs `auth.social.start` / `auth.social.success` / `auth.social.cancelled` / `auth.social.failed` carry **provider + outcome only**; `captureException(err, { scope: 'auth.social', provider })` only when `mapSocialError` says `report`. Cancelled = silent (the breadcrumb carries the dismissed cascade step, nothing else). The profile read uses `queryClient.fetchQuery({ queryKey: profileKeys.own, staleTime: 0 })` — the same cache entry the `(auth)` layout observes, one request — and happens BEFORE the Apple name patch, which `buildProfilePatch` allows only over a blank / trigger-fallback name (a linked existing guest keeps her chosen name); after a patch the cached row is updated in place. In the incomplete case the hook navigates ONLY while a pending slot exists (the layout's exempt case); otherwise the layout's derived `<Redirect>` routes — two replaces would re-key and remount the form. |
| UI | `apps/mobile/src/components/social.tsx` (`GoogleButton`, `SocialSignInBlock`, `SOCIAL_BUTTON_HEIGHT = 50`), `components/AppleButton.ios.tsx` / `AppleButton.tsx` (renders `null` off-iOS), `components/ui.tsx:636` `LabeledDivider`, `components/icons.tsx:192` `GoogleGMark`, `theme/tokens.ts:192` `vendor` (exported from `theme/index.ts`) | Identical geometry by construction (height 50 = `Button` regular `minH`, radius 14, `alignSelf: 'stretch'`, `gap: 10`). Apple first (HIG). Native Apple button `CONTINUE`, `WHITE` in dark / `BLACK` in light; busy → same-geometry placeholder with an `ActivityIndicator`. Google row uses logical `paddingStart` / `paddingEnd` so it mirrors under RTL; the mark is never recoloured or mirrored. `SocialSignInBlock` returns `null` when neither provider is available (Android in Expo Go → screens look exactly as before). |
| Screens | `apps/mobile/app/(auth)/sign-in.tsx`, `sign-up.tsx` | `useSocialSignIn({ onComplete: () => { toast(auth.welcomeBack); continueAfterAuth(); }, disabled })`; `SocialSignInBlock` then `LabeledDivider auth.orContinueWithEmail` above the form; `ErrorText` shows `error ?? social.errorText ?? …`; the email `Button` is disabled while a provider is busy. A social sign-up never goes to verify-email (provider emails are verified). |
| Race-free gate | `apps/mobile/app/(auth)/_layout.tsx` | Exempt: `verify-email`, `verify-result`, `complete-profile`, or a pending slot. Otherwise a signed-in user is routed from **derived state**: `profile.isPending` → `Loading`; `needsProfileCompletion(profile.data)` → `<Redirect href="/(auth)/complete-profile" />`; else `/(tabs)`. A profile query error fails **open** to the tabs — the booking gates re-check. |
| Complete-profile | `apps/mobile/app/(auth)/complete-profile.tsx` | Params `returnTo: 'continue' \| 'back'`. Name (prefilled via `prefillDisplayName` and kept in sync with the row until the guest types — the Apple name patch can land after the first read; required), phone (required), language (`SegmentedControl`). Save → `updateOwnProfile({ full_name, phone })` → **always** `setLocale(lang, { flip: false })` (a new OAuth row has `preferred_lang 'en'` by trigger default even in an Arabic app) → `continue`: toast + `continueAfterAuth()`; `back`: toast + `safeBack()`. Auto-skips in `continue` mode when the profile is already complete. **Back-out in `continue` mode = `clearPendingSlot()` + `router.replace('/(tabs)')`, never `router.back()`** (the layout would bounce an incomplete profile straight back — a trap). Browsing stays public; the gate re-catches at the next booking. |
| Write-path gates (D3) | `apps/mobile/app/availability.tsx:57-60,172` · `app/(gated)/review.tsx:70-76,148,379-396,423` · `app/(gated)/profile-edit.tsx:75` · `app/(tabs)/profile.tsx:194-204` · `src/features/booking/errors.ts:32` | Availability: `profileGateState(profile) === 'incomplete'` → `setPendingSlot(slot)` + push complete-profile (`continue`) — the guest flow reused verbatim; `'unknown'` proceeds (fail open). Review: Reserve `disabled` when incomplete + amber notice `auth.profileIncompleteNotice` + `LinkText auth.addPhoneLink` → complete-profile (`back`; Review stays mounted, countdown keeps running, `useUpdateProfile` invalidation re-enables Reserve); on `rpcErrorCode === 'PHONE_REQUIRED'` (0059) → same route. Profile-edit: phone required (`auth.phoneRequired`) — closes the only way an email/password user could reach the gate. Profile tab: nudge card `profile.completeProfileNudge` + `auth.addPhoneLink`. `CODE_TO_KEY.PHONE_REQUIRED = 'auth.profileIncompleteNotice'`. |
| Sign-out | `apps/mobile/src/features/auth/context.tsx:63-69` | `SIGNED_OUT` → `clearAllCaches()` **and** `void googleSignOut()` — every sign-out path incl. refresh failures; the next Google tap shows the picker instead of auto-selecting. |
| Native config | `apps/mobile/app.config.ts` · `eas.json` · `.env.example` · `package.json` | `ios.usesAppleSignIn: true`; plugins += `expo-apple-authentication` always, `['react-native-nitro-google-signin', { iosUrlScheme }]` only when the iOS client id is set; `iosUrlScheme = 'com.googleusercontent.apps.' + id.replace(/\.apps\.googleusercontent\.com$/, '')`. `EAS_BUILD === 'true'` with the iOS client id unset **or a `REPLACE_*` placeholder** (`GOOGLE_CLIENT_ID_RE` — the same shape rule as `isGoogleClientId`, repeated because the config file stays import-free) → **throw at config time** (never at runtime); otherwise `console.warn` and skip the plugin so `expo start` / `expo export` work without Google. `eas.json`: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` + `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in all three profiles (public identifiers — real values since 2026-09-01: Web `699390054618-egm0…`, iOS `699390054618-hdms…`); `development` points at the hosted URL + anon key on purpose (a phone cannot reach `127.0.0.1`). `owner` / `extra.eas.projectId` still TODO (set before `eas init`). |
| Library boundary guard | `apps/mobile/src/lib/__tests__/reliability.test.ts:98-129` | Walks `app/` + `src/` and asserts `'react-native-nitro-google-signin'` appears only in `src/features/auth/providers/google.ts` and `'expo-apple-authentication'` only in `src/components/AppleButton.ios.tsx` + `src/features/auth/providers/apple.ios.ts`. |
| i18n | `packages/i18n/src/catalogs/en.ts:101-115, 537` · `ar.ts:99-110, 538` | `auth.continueWithGoogle / continueWithApple / orContinueWithEmail / completeProfileTitle / completeProfileBody / phoneRationale / completeProfileCta / profileIncompleteNotice / addPhoneLink / googlePlayServices / socialFailed / appleUnavailable`, `profile.completeProfileNudge`. Brand names stay Latin; `{provider}` is wrapped with `isolate()` at the call site. The parity test enforces both catalogs. |
| Database | `packages/db/supabase/migrations/20260901000058_oauth_profile_bootstrap.sql` · `20260901000059_confirm_booking_phone_required.sql` · `packages/db/tests/oauth-profiles.test.ts` · `tests/helpers.ts:88` `shapedGuest`, `:75` `guestClient` phone · `supabase/config.toml:81-117` · `packages/db/README.md` | §6 below. |

## 3. Nonce design and replay reasoning

**Mechanism.** Per attempt the app mints `raw = randomUUID()` (expo-crypto CSPRNG, 122 random bits)
and `hashed = SHA-256(raw)` as lowercase hex. The **provider SDK receives `hashed`** and Apple / Google
embed it verbatim in the id token's `nonce` claim. **GoTrue receives `raw`** (`signInWithIdToken({
nonce: raw })`), hashes it itself and compares with the claim — supabase-js documents the parameter as
"the hash of this value is compared to the value in the ID token". Supabase's **"Skip nonce check"
stays OFF for both providers** (`config.toml` `skip_nonce_check = false`; Prompt C asks for the same
on hosted and reports the toggle state).

**What the nonce buys.** An id token is a bearer credential: any token whose signature verifies,
whose `iss`/`exp` pass and whose `aud` is in the provider's Client IDs list would otherwise mint a
Supabase session for the subject it names. Binding the token to a client-chosen nonce means:

- a token **captured anywhere other than inside this app's own attempt** (a provider-side log, a
  leaked device log, another integration of the same Google client id) cannot be exchanged — the
  attacker holds the token with `sha256(raw)` inside but not `raw`, which never left the device
  except over TLS to GoTrue;
- a token obtained by a **different flow** (e.g. someone driving the provider's browser flow for our
  Web client id with no nonce, or their own nonce) fails the comparison;
- a **replay of an old successful attempt's token** needs the matching `raw`, which the app discards
  after the call; nothing stores nonces.

What it does not buy, stated plainly: GoTrue does not keep a used-nonce list, so a (token, raw) pair
intercepted **between the app and GoTrue** could be resubmitted inside the token's lifetime — but
whoever holds that pair already holds the session GoTrue returned for it. TLS is the control for
that hop; the nonce is the control for every other place the token exists.

**Fallback (needs SEC sign-off, not taken).** If the Google iOS SDK ignores the nonce or hashing
mismatches on a device (matrix row "EAS dev build, iOS"), the documented fallback is to flip "Skip
nonce check" ON for Google **and** omit `nonce` in `signInWithIdToken` for Google. That widens the
accepted set to every valid Google token for our Web/iOS client ids. It requires a SEC decision, a
HANDOFF entry and a code change; the one-file swap to `@react-native-google-signin/google-signin`
"Original" (no nonce support) implies the same fallback. `providers/google.ts` header and
`config.toml` both record this.

**Cached-token corollary (found in the 2026-09-01 adversarial review; verified in the library's
Swift source, `ios/HybridNitroGoogleSignin.swift`).** On iOS the nitro library's `signIn()` mints
nothing: it returns `GIDSignIn.sharedInstance.currentUser` (or a keychain restore) — the id token of
an EARLIER authorization, whose nonce claim can never equal this attempt's hash. With the nonce check
ON, one failed exchange (offline, incomplete Client IDs) would therefore have made every later attempt
fail for ever — `googleSignOut()` runs only on `SIGNED_OUT`, which a user who never obtained a
session never reaches. `firstGoogleAttempt` starts iOS at `createAccount()`, whose
`interactiveSignIn()` passes the configured nonce to
`GIDSignIn.signIn(withPresenting:hint:additionalScopes:nonce:)`. Android's Credential Manager mints
per request. This is also why "Skip nonce check" is not a workaround worth having: it would have hidden
the defect instead of surfacing it.

## 4. Identity linking (Supabase automatic linking; verified against Supabase docs 2026-09-01)

Rule: a provider sign-in whose **verified** email matches an existing user links the new identity to
that user (same uid → same `profiles` row); an **unconfirmed** email identity is removed on link.
Apple Hide-My-Email relay addresses never match anything.

- **(a) Email/password guest → Google with the same Gmail.** Linked: same uid, two rows in
  `auth.identities`, profile / phone / bookings intact; no complete-profile gate (the phone is already
  there). The trigger does not fire (no new `auth.users` row). The same holds for Apple with a real
  (non-relay) email — and Apple still sends the full name on this app's first authorization for that
  account, so `buildProfilePatch` refuses to overwrite a chosen name (only a blank or trigger-fallback
  name is filled, and the profile is read before the patch); the desk keeps searching the name the
  guest typed.
- **(b) Apple with Hide My Email.** The relay address matches nothing → a **second account**, with
  `full_name ''` (0058) and no phone → complete-profile asks for both. Accepted and documented; the
  desk sees a second guest with the same phone if the person types it again. No mitigation attempted
  (Apple's design).
- **(c) Google-only user tries email/password.** Generic "Invalid login credentials" — no account
  existence oracle, keep it. Forgot-password → the reset adds a password credential to the same user
  (Supabase FAQ). No new copy.
- **(d) Unconfirmed email/password sign-up + Google with the same email.** The unconfirmed identity is
  removed, the uid is reused, the `profiles` row **survives** — so the `full_name` / `phone` the
  unconfirmed registrant typed are what the Google user inherits. Residual: an attacker who
  pre-registered (unconfirmed) with the victim's address chose that name / phone. Low impact — both
  are visible and editable on the profile screen, carry no privilege, and the desk confirms bookings
  by the phone on the reservation row; this is a pre-existing property of unconfirmed sign-ups, not
  introduced here.

**Staff conclusion: nothing new.** Staff are a `staff` row keyed by uid, created with a password by
the `staff-admin` edge function (no metadata — the local-part fallback in 0058 exists for them); the
operator uses `signInWithPassword`. Linking a Google/Apple identity to a staff uid requires a
*verified* matching email, i.e. control of that mailbox — which already grants password reset. The
browser OAuth endpoints become live project-wide when the providers are enabled; no Touch client uses
them; the redirect allow-list is unchanged (Prompt C Task 3 reports it, adds nothing).

## 5. Security checklist (SEC reviewer)

1. **Audience validation is GoTrue's**, against the dashboard Client IDs — the lists are exact and
   minimal. Apple: `com.kagu.touchpadel` + `host.exp.Exponent` **dev only** (an Expo Go token can only
   sign in as its holder's own Apple identity, i.e. create a guest account; removed before release —
   runbook step 11 / Prompt D Task 4). Google: **Web + iOS only** (Android id tokens carry the Web
   client id as `aud`; Android client ids exist only in Google Cloud, one per signing SHA-1).
2. **Nonce**: raw → SHA-256 hex → provider; raw → GoTrue. "Skip nonce check" **OFF** on both. Flipping
   it ON for Google iOS is a documented fallback that needs SEC sign-off + a HANDOFF entry + the client
   omitting the nonce (§3).
3. **Rate limits**: Authentication → Rate Limits "Token verifications" / sign-ups / anonymous / token
   refreshes — recorded 2026-09-01 (Prompt C): token verifications 30 / 5 min, sign-ups + sign-ins 30 / 5 min
   per IP, anonymous users 300 / h, token refreshes 150 / 5 min. Not raised (the venue shares one WAN IP);
   the sign-in cap is the one to watch on a launch night.
4. **No secrets in the app.** Client ids are public identifiers (they ship in the bundle). The Google
   Web client **secret** is never needed client-side and stays out of `eas.json` / `.env.example` / the
   repo (Prompt A reports `present (console only)`; Prompt C leaves the secret fields empty and stops if
   the form insists). `config.toml` carries the documented dummy `local-dev-unused` because the CLI
   rejects an empty secret for an enabled provider; it is unused by the id-token grant.
5. **GoTrue verifies** issuer, signature (JWKS fetched online), `exp`, `aud`, nonce. "provider is not
   enabled", "Unacceptable audience in id_token" and nonce mismatches surface as `AuthApiError` →
   `mapSocialError` → `auth.socialFailed` **with `report: true`** (telemetry), never as `errors.network`
   — `isTransportError` (anchored, `src/lib/network.ts`) is the only path to the "no connection" copy.
6. **Profiles / RLS unchanged.** `app.handle_new_user` stays `SECURITY DEFINER` with EXECUTE revoked
   (0004:150 survives a `create or replace`); INSERT into `profiles` remains trigger-only; the
   complete-profile step uses the existing own-row UPDATE grant on `full_name, phone, preferred_lang`
   (test case 5: another user's row is silently untouched). 0059 adds its guard **after** the
   ownership `FORBIDDEN` and the idempotent duplicate return (`check:authz` asserts that order).
7. **PII.** The relay email, `is_private_email` and Google `picture` / `avatar_url` land only in
   `auth.users.raw_user_meta_data`; `profiles` stores `full_name`, `phone`, `preferred_lang` — never the
   picture. Breadcrumbs carry provider + outcome only; no token, nonce or email is ever placed in an
   error object or breadcrumb (`SocialAuthError.reason` holds the SDK error for telemetry, never shown
   to the guest).
8. **Account deletion dependency** — §8 below; add to the deletion task's checklist (SEC-15/16).
9. **Deploy order 0058 → providers → build.** Anonymous cafe sessions untouched: the `is_anonymous`
   early return is kept in 0058 (0048/C1 depends on it), `enable_anonymous_sign_ins` unchanged, test
   case 7 pins "an anonymous session still has NO profiles row".

## 6. Migrations 0058 and 0059

**0058 `oauth_profile_bootstrap`** — `create or replace function app.handle_new_user()` with the same
name / signature / `SECURITY DEFINER` / `search_path`, so the 0004:150 revoke and the 0004:56 trigger
binding survive untouched (the trigger is deliberately not dropped or recreated). Why: the 0004 body
read only `raw_user_meta_data->>'full_name'` and fell back to the email's local part. GoTrue's
id-token flow writes different metadata — Google `full_name` *and* `name` (+ `picture`), Apple **no
name at all** and, with Hide My Email, an opaque `k3x9q2@privaterelay.appleid.com` — so the 0004
fallback made `k3x9q2` a display name the desk would search for (`profiles_select` lets desk roles
read every row). Now:

```sql
v_name := coalesce(
  nullif(btrim(v_meta->>'full_name'), ''),                                          -- email/password; Google
  nullif(btrim(v_meta->>'name'), ''),                                               -- Google `name` claim
  nullif(btrim(concat_ws(' ', v_meta->>'given_name', v_meta->>'family_name')), ''), -- standard OIDC
  case when v_email ilike '%@privaterelay.appleid.com' then null                     -- a relay token is not a name
       else nullif(split_part(v_email, '@', 1), '') end,                              -- historical fallback kept (admin-created staff rely on it)
  '');
-- phone = nullif(btrim(v_meta->>'phone'), '');  preferred_lang unchanged ('en' default; the client sets it right after)
```

`on conflict (id) do nothing` kept; `is_anonymous` early return kept; no backfill (no OAuth user
exists); nothing in `types.gen.ts` (trigger functions are not exposed through PostgREST). Additive and
safe for hosted. Rollback: re-run the 0004 L35-53 body.

**0059 `confirm_booking_phone_required`** — a **behaviour change on a contractual RPC**, kept in its
own file so SEC can line-review it independently and it can be deferred or reverted on its own (the
client gate enforces the rule regardless). The 0021 L217-291 `confirm_booking` body is re-issued
verbatim, same signature `(uuid, text, text)` (0008:704-705 grants and `types.gen.ts` unaffected),
plus **one guard after `HOLD_EXPIRED` / the degraded guard and before `GUEST_REQUIRED`**:

```sql
if not app.is_staff('court_desk','manager','owner')
   and not exists (select 1 from profiles
                    where id = v_uid and nullif(btrim(phone), '') is not null) then
  raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
    hint = 'add a phone number to your profile before confirming';
end if;
```

Guard order: `AUTH_REQUIRED → HOLD_NOT_FOUND → FORBIDDEN → idempotent duplicate → HOLD_EXPIRED →
DEGRADED → PHONE_REQUIRED (new) → GUEST_REQUIRED → NO_RATE`. Staff paths are exempt (they pass
`p_guest_phone`). `hold_slot` is untouched — a hold still needs only an account (0048/C1), so the app
can take the slot first and ask for the phone while the hold ticks. Reviewer ask: **diff the copied
0021 body line by line** against the new file. Rollback: re-run the 0021 L217-291 body.

**Proof the migrations matter** — `packages/db/tests/oauth-profiles.test.ts` (8 cases; users are
minted through the admin API with exactly the metadata GoTrue writes — `helpers.ts` `shapedGuest` —
so Apple and Google are never contacted and the suite stays offline): (1) Google shape → `{ 'Google
User', null, 'en' }`; (2) Google **`name` only** → full_name from the OIDC claim — **fails on the 0004
body**; (3) Apple relay shape → `full_name ''`, `phone null` — **fails on the 0004 body**; (4)
Apple/real-email, no metadata → local-part fallback preserved; (5) own-row RLS update succeeds,
another row is silently untouched; (6) a phone-less account can `hold_slot` but `confirm_booking` →
`PHONE_REQUIRED`, the hold stays `pending`, succeeds after a phone is set, idempotent replay still
answers `duplicate: true`; (7) anonymous session still has no profiles row; (8) staff-shaped user (no
metadata) still gets the local-part name. Fallout: `helpers.ts` `guestClient` now sets `phone:
'+9647700000000'` in `user_metadata` (one line). Verified 2026-09-01: DB suite **342/342** green
including these 8; `check:locks` / `check:authz` / `check:safeupdate` green; cases 2-3 confirmed
failing against the 0004 body.

**Hosted pre-push check (before 0059 leaves the repo):**

```sql
select count(*) from profiles where nullif(btrim(phone), '') is null;
```

**Run on 2026-09-01 before the push (via `supabase db query --linked`):** 15 profiles, **12 phone-less = 6 staff (exempt from 0059) + 6 test guests, 0 of whom hold a reservation**; 130 anonymous cafe users; 15 `email` identities, no apple/google yet. The estimate below was wrong about staff/test rows but right about impact — no existing booking is affected. **Pushed the same day**; hosted is at 0059 and `pg_get_functiondef` on hosted shows the `privaterelay` branch in `app.handle_new_user` and the `PHONE_REQUIRED` guard in `app.confirm_booking`.

Expect ~0 — every existing account came through email/password sign-up, where the app requires the
phone. A non-zero count is the number of guests who will see `PHONE_REQUIRED` at confirm until they
add a phone (intended product behaviour, but the number must be known and recorded in the PR).
Optional confirmation that 0058 has nothing to backfill: `select count(*) from auth.identities where
provider in ('apple','google');` — expect 0.

**Deploy order**: 0058 (+ 0059) → dashboard providers (Prompt C) → build. Via the `DB Migrate
(staging)` workflow on merge (required reviewer) or `pnpm exec supabase db push --linked` from
`packages/db`. **As of 2026-09-01 neither migration is on hosted.**

**Local parity** — `packages/db/supabase/config.toml:107-117`: `[auth.external.apple]` `client_id =
"com.kagu.touchpadel,host.exp.Exponent"`, `[auth.external.google]` `client_id = "<web>,<ios>"` (still
`REPLACE_*`), both `secret = "local-dev-unused"`, `skip_nonce_check = false`, with the house comment
block (client ids public; dummy secrets satisfy the CLI's non-empty rule and are unused by the
id-token grant; GoTrue fetches Apple/Google JWKS **online**; `supabase stop && supabase start` to
apply). The local GoTrue accepted the blocks on 2026-09-01. `packages/db/README.md` has the
auth-providers paragraph and lists the test file.

## 7. Error handling contract (what the guest sees, what telemetry sees)

| Cause | Guest copy | Reported |
|---|---|---|
| Cancelled / already in progress (`ERR_REQUEST_CANCELED`, `SIGN_IN_CANCELLED`, `12501`, `IN_PROGRESS`) | nothing | no (breadcrumb only, carrying the dismissed cascade step) |
| Any cancel on Android (Credential Manager reports `RESULT_CANCELED` for a missing SHA-1 client / package mismatch too) | nothing | `captureMessage('auth.google.cancelled', 'warning', { attempt })` — a spike on one build = misconfiguration, not guests |
| No Play services | `auth.googlePlayServices` | no |
| Apple unavailable on device | `auth.appleUnavailable` | no |
| `DEVELOPER_ERROR` (missing SHA-1 client / wrong client type / a Google account that is not a listed test user while the consent screen is in Testing) | `errors.generic` | **yes** |
| No id token / unknown SDK failure | `auth.socialFailed` | **yes** |
| GoTrue refusal (`AuthApiError`: audience, nonce, provider not enabled) | `auth.socialFailed` | **yes** |
| Transport failure (`isTransportError`) | `errors.network` | no |
| Anything else | `errors.generic` | **yes** |

Configuration faults are therefore always visible in telemetry and never disguised as connectivity —
the day-9 lesson (HANDOFF) applied to this path.

## 8. Account-deletion dependency (future feature; adds to SEC-15/16)

App Store 5.1.1(v) in-app account deletion is still **open and FK-blocked** (HANDOFF gotcha:
`reservations.guest_id references profiles(id)` has no on-delete clause; a migration is mandatory).
This feature adds a requirement to that task without making it harder as of 2026-09-01 (`auth.users`
deletion cascades `auth.identities`):

- Apple requires apps offering Sign in with Apple to **revoke the user's tokens** when the account is
  deleted (`POST https://appleid.apple.com/auth/revoke`). `auth.admin.deleteUser` does not do it.
- The id-token grant yields **no refresh token** to revoke, so the deletion flow must re-authenticate
  with Apple for a fresh `authorizationCode`, exchange it and revoke — server-side, in an edge function
  holding a Sign in with Apple **`.p8` key**. That key is the **only** Apple secret this feature ever
  introduces, and it belongs in edge-function secrets, never in the app or the repo. Prompt B expects
  `APPLE_SIWA_KEYS = none` at the 2026-09 setup; the key is created only when the deletion feature is
  built.
- Google needs no equivalent call (no long-lived Google token is held).

## 9. What is NOT covered by this note or by the 2026-09-01 verification

- **No device test has run.** Everything in the runbook's device matrix — Expo Go Apple flow, EAS dev
  builds on iOS and Android, the URL-scheme return, the nonce comparison against real Apple / Google
  tokens, Credential Manager behaviour, dark / Arabic rendering, the write-path gates, the linking
  scenarios, the regressions — is **unverified**. The Apple adapter's module-scope import has not been
  exercised on a device either.
- **Almost no console exists.** No Expo/EAS project (`owner` / `projectId` TODO), no Apple Developer team;
  the Google Cloud project exists since 2026-09-01 (`touch-padel`, consent screen in **Testing** — Google
  requires privacy + home-page URLs on an authorized domain to publish, so production publishing waits for
  the privacy page; Web/iOS clients not yet created — HANDOFF gotcha); the hosted Supabase providers are **ON since 2026-09-01** (Prompt C; both Client-ID lists equal
  `config.toml`, skip-nonce OFF, no secrets); rate limits recorded (§5 item 3).
- **Migrations 0058 / 0059 are on hosted since 2026-09-01** (pre-push count recorded in §6); hosted at 0059.
- **Mobile static gate** (typecheck / lint / vitest incl. `social.test.ts` + the boundary guard /
  `expo export` with the Google env unset): **green on 2026-09-01** — tsc, eslint, vitest 7 files /
  99 tests (28 in `social.test.ts`), i18n 22/22, `expo export` iOS + Android, expo-doctor 18/18,
  config introspection and the `EAS_BUILD=true` throw (unset and placeholder). Static only — nothing
  above replaces the first bullet.
- **Privacy policy / deletion-request pages** do not exist (no `privacy` route under `apps/web`;
  proposed `https://touch-padel-web.vercel.app/{ar,en}/privacy` until `touch-padel.com` lands) — roadmap
  7, not built here.
- **The RTL lint guard is partially inert** (`packages/config/src/eslint.js:44` `JSON.stringify` →
  exact match; only `textAlign` is caught). Logical props on `components/social.tsx` are a review rule.
  Recorded, not fixed (a one-line fix surfaces existing violations elsewhere — separate task).
- Not in scope by decision: browser OAuth, a Services ID, Apple on Android, Google One Tap on web, any
  change to the operator / web apps, MFA on the three new accounts (SEC-40 already lists Expo, Apple,
  Google — the accounts have to exist first).
