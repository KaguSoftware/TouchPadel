# TOUCH PADEL — GUEST MOBILE APP
## UI BUILD SPECIFICATION

**Client:** Touch Padel · Iraq
**Supplier:** Kagu Software
**Source:** Scope of Work v2.0 (Phase 1) + System Diagrams v1.0
**Audience:** UI engineer only
**Platform:** React Native + Expo · iOS and Android · one codebase

---

## 00 · HOW TO READ THIS DOCUMENT

This document contains **only** what a UI engineer builds: screens, presentational components, the data each one receives, every state each one must render, and every event each one emits.

It deliberately contains **no visual direction** — no layout, no spacing, no colour, no typography, no component sizing, no interaction choreography. Those decisions are yours.

It also deliberately contains **no application logic**. Session handling, data fetching, realtime subscriptions, hold creation, booking writes, cancellation eligibility and the degraded-mode horizon are built by the application engineer and delivered to you as props and callbacks. You never call the database, never decide whether an action is permitted, and never compute a price.

**The contract rule:** if a state is listed under a screen, that state must be renderable. A screen that cannot render one of its listed states is incomplete, regardless of how it looks.

---

## 01 · WHAT YOU OWN AND WHAT YOU DO NOT

### You own
- Every screen in section 05
- Every presentational component in section 06
- The rendering of all four async states on every data-backed screen
- Right-to-left layout correctness on every screen
- All localized string rendering through the provided lookup
- Empty, loading, error and refused-action presentation

### You do not own
| Concern | Delivered to you as |
|---|---|
| Session and authentication | `session` object + auth callbacks |
| Data fetching | Resolved props + `status` flags |
| Realtime updates | Re-rendered props; you react, you do not subscribe |
| Slot hold lifecycle | `hold` object + `onHoldExpired` |
| Booking writes | `onConfirmBooking` callback + result |
| Cancellation permission | `cancellation.eligible` boolean + `cancellation.reason` |
| Degraded mode | `degraded` boolean + `protectedHorizonEnd` |
| Price calculation | Server-supplied `price` object — never computed on device |
| Push notifications | Handled outside the UI layer entirely |

If you find yourself writing a conditional that decides whether something is *allowed*, stop — that belongs to the application layer and should be requested as a prop.

---

## 02 · GLOBAL BUILD REQUIREMENTS

These apply to every screen and every component without exception.

**R1 · Bilingual**
All user-facing text renders through the provided translation lookup. No literal strings in components. Where a lookup key resolves empty, the lookup itself falls back to the other language — you do not implement fallback.

**R2 · Right-to-left**
Layout uses logical properties (start/end), never left/right. Direction is set globally by the application layer and delivered as `direction: 'ltr' | 'rtl'`. Every screen must be correct in both. A mirrored stylesheet is not acceptable.

**R3 · Bidirectional text**
Latin fragments inside Arabic strings — court names, times, prices, booking references — render through `BidirectionalTextRenderer`. Never concatenate raw.

**R4 · Formatting**
Numerals, dates, times, durations and currency render through the provided formatters. Never format on device with template literals.

**R5 · Record text**
Court names, descriptions and categories arrive as bilingual records. They render through `LocalizedRecordText`, never by reading a field directly.

**R6 · Four states**
Every screen that receives data renders `loading`, `ready`, `empty` and `error` — with retry on `error`. `AsyncStateWrapper` provides the shape.

**R7 · No writes without confirmation**
Booking confirmation and booking cancellation both require `ConfirmationDialog` before the callback fires.

**R8 · Blocked is visible, not hidden**
When an action is refused — degraded mode, protected horizon, cancellation window — the control is present and refused with a stated reason. It is never silently hidden.

**R9 · Double submission**
Every action control accepts `busy` and must be non-actionable while true.

---

## 03 · SHARED PROP TYPES

These shapes are stable across the app. Build against them.

```
Session        { userId, email, name, phone, preferredLanguage, verified }
Court          { id, name{en,ar}, description{en,ar}, outdoor, photoUrl, durations[] }
Slot           { courtId, startsAt, durationMinutes, price, state, blockedReason }
SlotState      'available' | 'held' | 'booked' | 'blocked' | 'closed' | 'horizon'
Price          { amount, currency }
Hold           { holdId, slot, expiresAt }
Booking        { id, reference, court, startsAt, durationMinutes, price,
                 status, seriesId, cancellation }
BookingStatus  'held' | 'confirmed' | 'arrived' | 'completed'
               | 'cancelled' | 'noShow' | 'expired'
Cancellation   { eligible, reason, windowEndsAt }
VenueConfig    { phone, openingHours, closedDays, protectedHorizonEnd,
                 cancellationPolicyText{en,ar} }
AsyncStatus    'loading' | 'ready' | 'empty' | 'error'
```

`blockedReason` and `Cancellation.reason` are string keys, not sentences. You render them through the lookup.

---

## 04 · NAVIGATION MAP

**Auth stack** (no session, or unverified)
Splash → Welcome → { SignIn, SignUp } → VerificationPending → VerificationResult
Welcome → SignIn → ForgotPassword → ResetPassword

**Main stack** (verified session)
Courts → CourtDetail → AvailabilityDay → BookingReview → BookingSuccess
MyBookings → BookingDetail
Profile → { EditProfile, ChangePassword, Settings }

**Entry points from outside**
- Push notification tap → BookingDetail (booking id supplied)
- Email verification link → VerificationResult
- Password reset link → ResetPassword

Route guarding is applied by the application layer. You build the screens; you do not decide who reaches them.

---

## 05 · SCREENS

### 05.1 · SplashBootScreen

**Purpose** Covers the boot sequence while session, locale and venue configuration resolve.
**Data in** `status`
**States** `loading` · `error` (boot failed, with retry)
**Events out** `onRetry`

---

### 05.2 · WelcomeScreen

**Purpose** First screen for a guest with no session; entry to sign-in and sign-up, and the point at which language can be chosen before an account exists.
**Data in** `direction`, `activeLanguage`
**States** `ready`
**Events out** `onSignIn` · `onSignUp` · `onChangeLanguage(lang)`

---

### 05.3 · SignUpScreen

**Purpose** Creates a guest account by email and password, capturing the profile fields the system needs from day one.
**Data in** `busy`, `error`, `activeLanguage`
**Fields** name · email · password · phone number · preferred language
**States** `ready` · `busy` · `error` (field-level validation and server-level failure rendered separately)
**Events out** `onSubmit({ name, email, password, phone, language })` · `onGoToSignIn`
**Note** Phone number is collected but is not the identity — it is a profile field. It is required.

---

### 05.4 · SignInScreen

**Purpose** Signs an existing guest in.
**Data in** `busy`, `error`
**Fields** email · password
**States** `ready` · `busy` · `error` — must distinguish *invalid credentials* from *email not verified* from *network failure*
**Events out** `onSubmit({ email, password })` · `onForgotPassword` · `onGoToSignUp`

---

### 05.5 · EmailVerificationPendingScreen

**Purpose** Holds an unverified account until the emailed verification link is used.
**Data in** `email`, `resendBusy`, `resendCooldownEndsAt`, `error`
**States** `ready` · `resendBusy` · `cooldown` (resend not yet available) · `error`
**Events out** `onResend` · `onChangeEmail` · `onSignOut`

---

### 05.6 · EmailVerificationResultScreen

**Purpose** Renders the outcome of a verification link.
**Data in** `status`, `outcome: 'verified' | 'expired' | 'invalid'`
**States** `loading` · `verified` · `expired` · `invalid`
**Events out** `onContinue` · `onResend`

---

### 05.7 · ForgotPasswordScreen

**Purpose** Starts a password reset.
**Data in** `busy`, `submitted`, `error`
**Fields** email
**States** `ready` · `busy` · `submitted` (dispatch confirmed — must not disclose whether the account exists) · `error`
**Events out** `onSubmit({ email })` · `onBack`

---

### 05.8 · ResetPasswordScreen

**Purpose** Completes a password reset from an emailed link.
**Data in** `busy`, `linkValid`, `error`
**Fields** new password · confirm password
**States** `ready` · `busy` · `invalidLink` · `error` · `success`
**Events out** `onSubmit({ password })` · `onContinue`

---

### 05.9 · ChangePasswordScreen

**Purpose** Lets a signed-in guest change their own password.
**Data in** `busy`, `error`
**Fields** current password · new password · confirm password
**States** `ready` · `busy` · `error` · `success`
**Events out** `onSubmit({ current, next })`

---

### 05.10 · CourtListScreen

**Purpose** Presents the courts the venue offers.
**Data in** `status`, `courts: Court[]`, `degraded`
**States** `loading` · `ready` · `empty` (no courts configured) · `error`
**Events out** `onSelectCourt(courtId)` · `onRetry`
**Renders** `DegradedModeBanner` when `degraded`

---

### 05.11 · CourtDetailScreen

**Purpose** Shows one court's record and routes into its availability.
**Data in** `status`, `court: Court`, `degraded`
**States** `loading` · `ready` · `error`
**Events out** `onViewAvailability(courtId)` · `onRetry`
**Note** Renders name, indoor/outdoor classification, description, photograph and configured duration options. Photograph may be absent — handle it.

---

### 05.12 · AvailabilityDayScreen

**Purpose** The guest's live view of what can be booked on a chosen day. This is the highest-traffic screen in the app and the one that changes underneath the guest without a refresh.

**Data in**
`status`, `date`, `courts: Court[]`, `selectedCourtIds`, `slots: Slot[]`, `selectedDuration`, `venue: VenueConfig`, `degraded`, `protectedHorizonEnd`, `holdBusy`

**States**
- `loading`
- `ready` — grid populated
- `empty` — day has no bookable slots at all
- `closed` — venue closed that day (distinct from empty)
- `error` — with retry
- `holdBusy` — a hold request is in flight
- `holdFailed` — slot was taken between display and request

**Events out**
`onChangeDate(date)` · `onChangeCourts(ids)` · `onChangeDuration(minutes)` · `onSelectSlot(slot)` · `onRetry`

**Requirements**
- Every `Slot` renders its own `state`, including `blocked` and `horizon`, each with its reason available.
- Price shown per slot is the server-supplied `price` for that specific slot. Never derived.
- The grid re-renders when `slots` changes — realtime updates arrive as new props. Do not cache slots locally.
- Duration change invalidates a selection that no longer fits; the parent supplies the new slot set.

---

### 05.13 · BookingReviewScreen

**Purpose** Final review before the reservation is created, while the exclusive hold is live.

**Data in**
`hold: Hold`, `court: Court`, `venue: VenueConfig`, `busy`, `error`

**States**
- `ready` — hold live, countdown running
- `busy` — confirmation in flight
- `holdExpired` — countdown reached zero
- `slotTaken` — write rejected by the database
- `error` — other failure, with retry

**Events out**
`onConfirm` (via `ConfirmationDialog`) · `onCancel` · `onHoldExpired` · `onBackToAvailability`

**Must render**
- Court, date, start time, duration, price
- `HoldCountdown` against `hold.expiresAt`
- `CancellationPolicyDisclosure` from `venue.cancellationPolicyText`
- `PaymentAtDeskNotice` — this is not optional copy; it is the single most misunderstood thing in the product

---

### 05.14 · BookingSuccessScreen

**Purpose** Confirms the created reservation.
**Data in** `booking: Booking`
**States** `ready`
**Events out** `onViewBooking(id)` · `onDone`
**Must render** Court, date, time, duration, price, reference, and the payment-at-desk statement.

---

### 05.15 · MyBookingsScreen

**Purpose** The guest's own reservations, upcoming and past.
**Data in** `status`, `upcoming: Booking[]`, `past: Booking[]`, `pastHasMore`, `pastLoadingMore`, `refreshing`, `degraded`
**States** `loading` · `ready` · `empty` (no bookings ever) · `emptyUpcoming` (past exists, nothing upcoming) · `error` · `refreshing` · `loadingMore`
**Events out** `onSelectBooking(id)` · `onRefresh` · `onLoadMorePast` · `onRetry` · `onBookACourt` (from empty state)
**Note** Statuses change underneath the guest when staff act at the desk. Re-render from props.

---

### 05.16 · BookingDetailScreen

**Purpose** The full record of one reservation and the only place a guest cancels.

**Data in**
`status`, `booking: Booking`, `venue: VenueConfig`, `cancelBusy`, `error`, `degraded`

**States**
- `loading` · `ready` · `notFound` · `error`
- `cancelBusy`
- `cancelRefused` — with `booking.cancellation.reason`
- `cancelled` — post-cancellation state

**Events out**
`onCancelBooking` (via `ConfirmationDialog`) · `onCallVenue` · `onRetry`

**Must render**
- Court record, date, start time, duration, stored price, status
- `RecurringSeriesIndicator` when `booking.seriesId` is present
- The cancellation window that applies
- Cancel control present in all cases, refused with a stated reason where `cancellation.eligible` is false
- `VenueContactComponent` whenever cancellation is refused or the venue is degraded

**Note** A guest may cancel a single occurrence only. There is no series-level action in this app.

---

### 05.17 · ProfileScreen

**Purpose** The guest's own account details and the route into everything account-level.
**Data in** `session: Session`, `status`
**States** `loading` · `ready` · `error`
**Events out** `onEditProfile` · `onChangePassword` · `onOpenSettings` · `onSignOut`
**Note** Shows the guest's own account only. There is no history, no loyalty, no spend, no staff notes — those exist in the system but are never guest-facing.

---

### 05.18 · EditProfileScreen

**Purpose** Lets the guest maintain their own contact details.
**Data in** `session`, `busy`, `error`
**Fields** name · phone number · preferred language
**States** `ready` · `busy` · `error` · `success` · `dirty` (unsaved changes on back)
**Events out** `onSubmit({ name, phone, language })` · `onDiscard`
**Note** Email is not editable here. It changes through the verification flow.

---

### 05.19 · SettingsScreen

**Purpose** Container for account-level and device-level actions.
**Data in** `activeLanguage`, `notificationPermission: 'granted' | 'denied' | 'undetermined'`, `venue: VenueConfig`, `appVersion`, `buildNumber`
**States** `ready`
**Events out** `onChangeLanguage(lang)` · `onRequestNotifications` · `onOpenSystemSettings` · `onCallVenue` · `onChangePassword` · `onSignOut`
**Note** The three permission states render differently: undetermined offers a request, denied routes to system settings, granted states it plainly.

---

## 06 · PRESENTATIONAL COMPONENTS

Each is stateless with respect to the domain. All logic arrives as props.

### Availability & booking

**AvailabilityGrid**
Holds the slot set for the selected day and courts. Props: `slots`, `courts`, `direction`. States: populated · empty · closed. Emits `onSelectSlot(slot)`. Re-renders wholly from props on realtime change.

**SlotItem**
One bookable slot. Props: `slot`, `selectable`, `busy`. Renders court, start time, duration and price; renders its `state` and, when not selectable, its `blockedReason`. Emits `onSelect`.

**DaySelector**
Chooses the displayed trading day. Props: `date`, `closedDays`, `minDate`, `maxDate`. Emits `onChangeDate`. Closed days render as closed, not absent.

**CourtSelector**
Narrows availability to a court or courts. Props: `courts`, `selectedIds`. Emits `onChange(ids)`.

**DurationSelector**
Chooses booking length from the court's configured options only. Props: `options`, `selected`. Emits `onChange(minutes)`.

**SlotPriceDisplay**
Renders a server-supplied `Price`. Props: `price`. Never calculates.

**HoldCountdown**
Counts down against `expiresAt`. Props: `expiresAt`. Emits `onExpired` exactly once.

**OpeningHoursNotice**
States that a day or time range falls outside opening hours. Props: `reason`, `openingHours`.

### Bookings

**BookingListItem**
One reservation in a list. Props: `booking`. Renders court, date, time, duration, price, status and series membership. Emits `onSelect(id)`.

**BookingStatusIndicator**
Maps `BookingStatus` to a localized label. Props: `status`. Seven statuses, all must be handled.

**RecurringSeriesIndicator**
Marks an occurrence as part of a venue-created series. Props: `seriesId`. Carries no action.

**CancellationPolicyDisclosure**
Renders the configured cancellation window and no-show handling. Props: `policyText`, `windowEndsAt`. Text comes from config, never hard-coded.

**PaymentAtDeskNotice**
States that the court is reserved now and paid at the desk. No props. Appears on review, success and detail.

### Notices & refusals

**DegradedModeBanner** — venue unreachable; near-term booking unavailable. Props: `protectedHorizonEnd`.
**BlockedBookingNotice** — this slot cannot be booked in the app now. Props: `reason`, `venuePhone`. Emits `onCallVenue`.
**HoldExpiredNotice** — hold expired, slot returned to the grid. Emits `onBackToAvailability`.
**SlotTakenNotice** — the slot was just taken. Emits `onBackToAvailability`.
**CancellationBlockedNotice** — cancellation refused. Props: `reason`, `windowEndsAt`, `venuePhone`. Emits `onCallVenue`.
**ConnectionRequiredNotice** — no device connection; the app requires one. Emits `onRetry`.
**AuthErrorMessage** — maps auth error codes to localized messages.

### Forms

**EmailField · PasswordField · PhoneNumberField · NameField**
Each: props `value`, `error`, `disabled`; emits `onChange`, `onBlur`. Each applies the correct keyboard type and autofill hint, renders its own validation message, and handles Latin input inside an RTL layout.

**LanguageSelector**
Switches between English and Arabic. Props: `active`. Emits `onChange(lang)`. Note: the direction flip is applied globally by the application layer and may restart the app — surface that this is expected.

**FormSubmitButton**
Props: `label`, `busy`, `disabled`. Non-actionable while `busy`.

### Infrastructure-facing UI

**AsyncStateWrapper**
Standardises the four states. Props: `status`, `onRetry`, `emptyContent`, `errorContent`, children.

**MessagePresenter**
Presents transient success, refusal and failure messages. Props: `message`, `tone: 'success' | 'refused' | 'error'`.

**ConfirmationDialog**
Blocks an irreversible action pending explicit confirmation. Props: `title`, `body`, `confirmLabel`, `cancelLabel`, `busy`. Emits `onConfirm`, `onDismiss`.

**RemoteImageComponent**
Renders court photographs. Props: `url`, `alt`. States: loading · loaded · failed · absent.

**VenueContactComponent**
Presents the venue phone number and initiates a call. Props: `phone`. Emits `onCall`.

**LocalizedRecordText**
Renders a bilingual record field. Props: `record{en,ar}`, `activeLanguage`. Falls back to the other language when the active field is empty.

**BidirectionalTextRenderer**
Isolates Latin fragments inside Arabic strings. Props: `parts[]`.

**LocaleNumberFormatter · LocaleDateTimeFormatter · CurrencyFormatter**
Render numerals, dates/times/durations and currency per locale. All display of these values goes through them.

---

## 07 · STRING INVENTORY

Every key below must exist in English and Arabic before the Arabic build can be accepted. Copy and translation are supplied by Touch (Scope §14, week 2) — you build against keys, not text.

Groups: `auth.*` · `verification.*` · `courts.*` · `availability.*` · `slot.blockedReason.*` · `booking.*` · `booking.status.*` · `cancellation.*` · `cancellation.reason.*` · `profile.*` · `settings.*` · `degraded.*` · `errors.*` · `common.*`

Two rules: no literal user-facing string in any component, and every `reason` key returned by the application layer must have a matching entry.

---

## 08 · ASSET DEPENDENCIES

| Asset | Source | Scope reference |
|---|---|---|
| Logo, colour palette, brand assets | Touch, week 1 | §14 — interfaces ship in placeholder styling if late |
| Court photographs | Touch, via Supabase storage | §04 court records |
| App icon and splash | Touch branding | Required for store submission, week 4 |
| Store listing screenshots | Produced from finished screens | Track B, week 4 |
| English and Arabic copy | Touch, week 2 | §14 — the Arabic build cannot be accepted without it |

---

## 09 · DEFINITION OF DONE, PER SCREEN

A screen is finished when all of the following hold:

1. Every state listed for it renders, including refusals and empty cases.
2. It is correct in both `ltr` and `rtl` with no mirrored stylesheet.
3. It renders correctly in both languages, including where a translation is missing.
4. No literal user-facing string appears in the file.
5. No date, number or price is formatted outside the provided formatters.
6. No conditional in the file decides whether an action is permitted.
7. Every action control respects `busy`.
8. It re-renders correctly when props change underneath it without user action.

Point 8 is the one that gets missed. Availability and bookings both change while the guest is looking at them.

---

## 10 · OUT OF SCOPE — DO NOT BUILD

Nothing below appears in the mobile app. If a design or a conversation implies one of these, it is a change request, not a task.

Cafe menu, ordering, table binding, waiter call (web only) · any payment, payment SDK, tipping · open matches, seat claiming, cost splitting · player levels and matchmaking · tournaments, leagues, fixtures · coaching and lesson booking · memberships, subscriptions, member rates · waiting lists · loyalty points, rewards, tiers · guest-created recurring series · household or family account linking · phone/SMS one-time-code login · Apple, Google or social sign-in · staff internal notes · behavioural analytics · any third language · offline use of any kind.

---

## 11 · UNRESOLVED — CONFIRM BEFORE BUILDING

Three points the scope document does not settle. Each changes what you build.

**1 · Pre-authentication browsing.** The scope never states whether courts and availability are viewable without an account. This spec assumes the booking path requires a verified session. If browsing is meant to be public, `CourtListScreen`, `CourtDetailScreen` and `AvailabilityDayScreen` each need an unauthenticated variant and a sign-in prompt at slot selection.

**2 · Public promotion codes.** Scope §05 includes public codes a customer can enter, but the app takes no payment and bills settle at the desk. No code entry field is specified here. If codes are meant to apply to app bookings, that is an additional field on `BookingReviewScreen` and an additional state, and it should be written into the scope before it is built.

**3 · Store-compliance screens.** Apple requires in-app account deletion for any app that creates accounts, and both stores require a reachable privacy policy and terms. None of these appear in the scope document. They are small screens, but they gate the week-4 submission the two-week buffer exists to protect.

---

*Touch Padel · Phase 1 · Guest Mobile App · UI Build Specification*
