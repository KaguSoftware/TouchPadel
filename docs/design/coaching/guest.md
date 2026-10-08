# Coaching: the guest contract (lane Guest)

Consistency pass 2026-10-01: aligned with §1.12–§1.13 and C-21…C-31.

Date: 2026-10-01. Status: **design, approved; nothing built.** Binding on lane Guest. Authority, highest
first: the contracts' §0.2b (C-21…C-31) and §0.2, §1.13 (R24–R63), §1.12 (R1–R23), §1.1–§1.11, then
this file. The full text behind a ruling is in `drafts/review-rules-privacy-2026-10-01.md` (its §5
X1–X29 and X31 are binding per R41 and R52) and `drafts/review-concurrency-money-2026-10-01.md`.

This file is §4 of `build-contracts-2026-10-01.md`: the phone's guest side, coach mode, the website,
push and links. Where it and §0 or §1 of the contracts disagree, those win. The names this file adds
are in §4.20 ("Additions to §1"). Code facts were checked on 2026-10-01 at `d93bd9bf`. `NNNN:line` is
a line of `packages/db/supabase/migrations/2026…NNNN_*.sql`; `db:`, `mo:`, `op:` are the lane files;
other citations are repo paths.

**Coverage:** done 2026-10-01 (R53): `packages/db/fixtures/assistant-coverage.json` has an `excluded`
`docs` entry for this file.

## 4. Guest app, coach mode, web, push, links (lane Guest)

### 4.0 What this lane owns, and the rules for all of it

**Owns:**
- migration **0271** (`outbox_lesson_kinds`, CHECK widening only) and, inside **0280**, the Guest part:
  the fan-out trigger `lesson_events_notify` (R40), `app.lesson_notify`, `app.lesson_sync_reminders`
  and the reminder triggers (§4.5);
- `send-push`'s lesson family: `_shared/guest-push.json` (shared with open matches),
  `send-push/guestStrings.ts`, the guest branch of `send-push/index.ts` (§4.6);
- every guest screen and every coach-mode screen in `apps/mobile` (§4.7–§4.13), the "Coach mode" row
  of the staff hub `app/staff.tsx` (C-27), the deep link `/c/<coachId>`, `app/+native-intent.ts`, the
  Android intent filters;
- the web pages `app/[locale]/coaching` and `app/[locale]/c/[id]`, the landing's lessons section, the
  footer link, `LINK_PATHS` (§4.14);
- the catalog pair `coaching.*` (all four fragments, §4.15), the shared Arabic glossary block (R55),
  the guest lines of every code and detail a guest or a coach can meet (R52), and the lessons text of
  the legal catalogs (R50, §4.16);
- the key lists of the reads it parses in `packages/core/src/coaching/shapes.ts` (R41, §4.3).

It reads what DB (`db.md`) and Money (`money.md`) build. §4.3 is the read contract those lanes return
(R41: the privacy review's X1–X29 picks, written out): they may add fields, never rename or drop these.

**Rules for every item below:**
1. Every coaching write is online-only and fails now (CD-6). Nothing is queued; there is no mutation
   type.
2. Nothing under the `['coaching']` or `['coach']` query roots is written to disk (§1.11).
3. No name and no amount reaches a lock screen (CD-7). A push carries ids, times and counts only.
4. The phone never computes a price, a pro-rata share, a coach share, a permission, a cancel policy, a
   refund preview or a refusal. It renders what the server sends (`price_iqd`, `late_join`,
   `cancel.*`, `can.*`) and parses every enum defensively: an unknown value falls back and never
   throws (the `parseDepositStatus` pattern, `apps/mobile/src/features/deposit/logic.ts:212`).
5. A coach is a guest. `StaffStatusProvider` keeps answering `guest` for a guest who coaches and
   `staff` for a staff member who coaches; coach mode is its own provider and gate (§4.13.1), reached
   from Profile and from the staff hub (C-27). There is no fourth tab.
6. All Arabic in this file is a draft, marked **DRAFT-AR**, and goes on the client's review list.
   Buttons and text addressed to the reader never use a gendered imperative (verbal nouns, passives,
   «يمكن / يلزم / يُرجى + noun», unvocalised past tense, possessive suffixes). The lesson is «حصة»
   everywhere (C-30); money words come from the one glossary (R55, §4.15).
7. Switch off means no guest work: while a branch has `coaching_enabled = false`, the phone makes no
   browsing or booking call for it and shows no guest entry (§4.7.5). Coach mode ignores the switch
   (`coach_me` and every coach read, with a notice, R45), and so do `my_lessons` / `my_lesson` once a
   guest holds a lesson there.
8. Every parser reads its key list from `packages/core/src/coaching/shapes.ts` (R41), the list DB's
   key-set test asserts against; a missing key falls back like an unknown enum.

### 4.1 Ordinals and landing order

§1.1 is current: the directory's latest file is `20261001000269_principal_lock_caps.sql`, so DB's 0270
is next and this lane's 0271 follows it. Check again when the file is written
(`packages/db/CLAUDE.md`, Migrations) and shift with everyone else if the team lands more. Dollar tags
use the file's ordinal (`$validate_kind_check_0271$`).

§6.1 lands the whole milestone as one batch and one push. Inside it, this lane's commits go in this
order; each commit carries its own tests and gates.

| # | Commit | Why here |
| --- | --- | --- |
| G1 | 0271 + `guest-push.json` + `guestStrings.ts` + the `send-push/index.ts` lesson branch + `send-push-guest.test.ts` + `outbox-kinds.test.ts` + the `guest-push.test.ts` split (§4.6.5) + the phone's `pushRoutes.ts` lists and their parity test (`guestPushHref` answers the tabs for the three new routes until G4 and G5 add their screens, so no href names a route that does not exist yet) | `outbox-kinds.test.ts` holds the CHECK equal to the JSON's kinds, and `pushRoutes.test.ts` holds the phone's lists equal to it, so the JSON, the CHECK and the phone lists must change in one commit. On hosted, `deploy.yml` deploys `send-push` before `db push` (`.github/workflows/deploy.yml:257-260`; any change under `supabase/functions` marks functions changed, `:180`), which is the §1.1 condition for 0271. |
| G2 | the Guest part of 0280 (§4.5: `lesson_events_notify`, `lesson_notify`, `lesson_sync_reminders`, the reminder triggers) and the Guest reads' key lists in `packages/core/src/coaching/shapes.ts`, inside DB's 0280 commit, with `lesson-push.test.ts` | DB writes the `lesson_events` rows (db §5.2) and DB's key-set test reads `shapes.ts`, both in 0280. The trigger is the only queuer (R40); Money's 0284 approve and mark-paid call `lesson_notify` for the two statement keys, which binds late, in the same push |
| G3 | the `coaching` catalog pair, the glossary block (R55) and the error lines (§4.10, §4.15) | each DB or Money commit that raises a code adds its catalogue entry and its guest line (the open-matches R11 rule); G3 creates and mounts the pair and the glossary with the first code (0274's `COACHING_OFF`) |
| G4 | mobile guest: `features/coaching`, the screens, the entry points, the link confirm (C-21), `pay/status`, push taps, links (§4.7–§4.12) | after `types.gen.ts` has every 0280–0281 signature |
| G5 | mobile coach mode (§4.13), the staff hub row (C-27), the new native dependency | after G4 |
| G6 | web: `/coaching`, `/c/[id]`, the landing and footer, `LINK_PATHS` (§4.14) | any time after 0280; with coaching off everywhere the landing renders exactly as today |
| G7 | legal: the lessons text for students and coaches, the deletion text in the app and on the web, the terms' lessons section, `CURRENT_TERMS_VERSION` bumped (§4.16, R50) | ships in the coaching build. `platform_settings.lesson_terms_version` is set to that version by a later one-line migration, once a build carrying it is on phones (the 0257 `match_terms_version` precedent); until then `set_coaching_settings` refuses an online lesson mode (C-26) and desk-paid lessons run |

Hosted order after the push (§6.1): `send-push` → `db push` (0270–0286) → every other function
(`lesson-begin`). Vercel builds the web in parallel; until `coaching_public` is on hosted the read
answers `error` and every web surface falls back to today's content (§4.14.1). The phone's coaching
screens reach users only in the next production `eas build` (§4.12: new intent filters; §4.13.8: the
date-time picker, R19), which Parsa runs after the push is green (`apps/mobile/CLAUDE.md`, Config and
builds). Push the `LINK_PATHS` change before that build is submitted, and check that Apple's CDN copy
(`app-site-association.cdn-apple.com`) lists `/c/*` (U6).

### 4.2 The guest's model

| Moment | Enrolment | Money | The guest reads |
| --- | --- | --- | --- |
| Private lesson, desk mode (CD-1 `desk`, or `online_optional` choosing desk) | `booked` at once; a court is taken | the whole lesson price at the desk on its own bill | "Booked · pay {price} at the desk" |
| Private lesson, Qi | `held` (lesson `held`, court `hold` row) until the payment lands | the whole price online | "Payment in progress", then "Booked · paid online" |
| Group session or course, desk | `booked` | one place (group) or the course, or its pro-rata share for a late join (C-15), at the desk | "Booked · pay {price} at the desk" |
| Group session or course, Qi | `held` until the payment lands | as above, online | as above |
| Qi window lapses | `expired` (`cancel_kind expired`) | nothing taken | "Payment not completed · place released" |
| Under its minimum at the cut-off (C-14) | `cancelled` (`under_filled`) | online money refunded | "Cancelled · not enough people signed up" |
| Guest cancels outside the branch's `cancellation_window_hours` | `cancelled` (`guest_free`) | online money refunded | "You cancelled · free" |
| Guest cancels inside the window (C-9) | `cancelled` (`guest_late`) | online money kept; a strike for a self-booked account (CD-2) | "You cancelled late" |
| The lesson was moved after the guest booked (R8, any kind) | `booked`; `rescheduled` | a cancel before the new start is `guest_free` | "Booked · moved to {time}"; free to cancel until it starts |
| Guest leaves a running course (C-23, R62) | `cancelled` (`guest_free` or `guest_late`, judged on the guest's own next session) | online shares of sessions starting outside the window refunded; the next one, if inside, kept | "You left the course" and the money line |
| Coach or venue cancels (C-9, C-19) | `cancelled` (`coach` / `staff` / `course_cancelled`) | online money refunded (a course: the remaining sessions' shares) | "Cancelled by the coach / venue" |
| Attended / no-show marked (CD-11) | `booked`, attendance row | a no-show keeps online money; a strike (CD-2) | "Attended" / "Marked as not attended" |
| Coach or desk adds a student whose typed phone matches a verified account (C-8, C-21, R44) | `booked`, `payment_mode desk`, `guest_id` set, `link_confirmed_at` NULL | at the desk | My lessons asks "A coach added you to a lesson. Is this you?"; "Yes" makes it a normal booking, "Not me" removes it silently; no reminder until "Yes" |
| Coach or desk adds a walk-in, or a phone that matches nobody | `booked`, no `guest_id` | at the desk | nothing in the app |

### 4.3 The read contracts the clients parse

DB and Money own the bodies and the refusal order. These are the field names the phone and the web
read, and they are **binding** (R41): each is the privacy review's X-pick (noted per read), and each
read's top-level and row key lists live in `packages/core/src/coaching/shapes.ts` (`COACHING_PUBLIC_KEYS`,
`COACH_PROFILE_KEYS`, … one export per read below). DB's key-set test asserts every RPC result's keys ⊇
its list; the mobile and web parsers import the same lists. Every timestamp is ISO; every amount is
integer IQD; every enum is parsed with a fallback. No public read carries a `profiles.id` (R43): every
`id` / `coach_id` below is `coaches.id`.

**`coaching_public(p_venue_id)`** (X1, Guest's; anon and authenticated, `publicByDesign`; never raises)
```jsonc
{ "off": false,
  "branches": [{ "venue_id", "name_en", "name_ar", "timezone",
                 "payment_mode": "desk|online_optional|online_required",
                 "prices_public": false, "cancellation_window_hours": 24 }],
  "coaches": [{ "id", "display_name_en", "display_name_ar", "bio_en", "bio_ar", "photo_path",
                "sort_order", "venue_ids": ["…"],
                "offers": [{ "lesson_type_id", "venue_id", "price_iqd": 30000 | null }] }],
  "lesson_types": [{ "id", "venue_id", "kind": "private|group|course", "name_en", "name_ar",
                     "description_en", "description_ar", "duration_min", "max_places",
                     "min_places", "sessions_count": null | 8, "price_iqd": null | 15000,
                     "sort_order" }],
  "sessions": [{ "kind": "group|course", "lesson_id": "…" | null, "course_id": "…" | null,
                 "venue_id", "coach_id", "lesson_type_id", "title_en", "title_ar",
                 "start_at", "end_at",               /* group: the session; course: the next session */
                 "sessions_count": null | 8, "sessions_left": null | 5,
                 "places_left": 3, "max_places": 8, "signup_closes_at", "cutoff_at",
                 "price_iqd": 15000, "full_price_iqd": 15000 }],   /* 0294 (DB-28) */
  "server_now": "…" }
```
- `{"off": true}` (and nothing else) when the named branch has coaching off, is closed or is
  unknown; with `p_venue_id` null, branches with coaching off are left out, and `{"off": true}` when
  none is left. Only active coaches who accepted the public profile (`public_accepted_at` set, R61,
  C-22); paused (R16), retired (R45, R63) and not-yet-accepted coaches are absent, and so are their
  sessions.
- `photo_path` is `coaches/<uuid>/<uuid>.<ext>` in `menu-media`, a fresh random folder, never a
  profile or coach id (R43).
- `offers[].price_iqd` is `lesson_price_for(coach, type)`; `lesson_types[].price_iqd` is the type's
  own. Both are sent whatever `prices_public` says (C-11: presentation, not secrecy). The **web**
  parser drops them when that branch's `prices_public` is false (§4.14.1); the phone shows them.
- `sessions` lists group sessions and courses with `places_left > 0` whose sign-up is still open
  (group: before its start; course: before `signup_closes_at`, C-15), soonest first, at most 50.
- **Amended 2026-10-02 (0294, DB-28):** each session row carries `price_iqd`, what a guest pays now
  (`lesson_offer`'s price: a group session's own price, which is the coach's price when it was
  created; a course's price before it starts, else `course_late_join_price` from its first session
  not yet started, C-15), and `full_price_iqd` (the session's, or the whole course's). A row shows
  these, never the type's base price. They follow `prices_public` like the other prices: the web
  drops them when it is false.
- No student, phone, court id or count of people by name.

**`coach_profile(p_coach_id, p_venue_id default null)`** (X2 and R17; anon and authenticated,
`publicByDesign`)
```jsonc
{ "off": false,
  "coach": { "id", "display_name_en", "display_name_ar", "bio_en", "bio_ar", "photo_path",
             "status": "active|paused", "venue_ids": ["…"] },
  "venue": null | { "venue_id", "name_en", "name_ar", "timezone", "phone", "payment_mode",
                    "prices_public", "cancellation_window_hours" },
  "offers": [{ "lesson_type_id", "kind", "name_en", "name_ar", "description_en",
               "description_ar", "duration_min", "max_places", "min_places",
               "sessions_count", "cutoff_hours", "price_iqd" }],
  "sessions": [ /* as coaching_public.sessions, this coach at this branch */ ],
  "server_now": "…" }
```
- **`p_venue_id` NULL** (R17, the `/c/<coachId>` link, which names no branch): the card with
  `coach.venue_ids` = every open branch with coaching on where the coach is active, `venue: null`,
  empty `offers` and `sessions`; `{"off": true}` when there is no such branch (P11). The phone picks a
  branch and asks again (§4.8.3).
- `COACH_NOT_FOUND` for an unknown, retired or not-yet-accepted coach (R61); `COACH_NOT_AT_BRANCH`
  when the coach is not active at the named branch; `{"off": true}` when that branch has coaching off.
  A paused coach who accepted is answered (`status: "paused"`) with no offers and no sessions (X2; a
  link to them reads "not taking bookings" rather than "not found"); the phone's paused state comes
  from this field, never from the refusal order (D8). `coaching_public` still leaves them out (R16).

**`coach_slots(p_coach_id, p_lesson_type_id, p_from, p_to)`** (X3, DB's envelope; anon and
authenticated)
```jsonc
{ "off": false, "venue_id", "lesson_type_id", "duration_min": 60, "bookable": true,
  "starts": [{ "start_at": "…", "end_at": "…" }] }
```
- A **private** type only (`LESSON_TYPE_NOT_FOUND` otherwise; db §4.7.9). Only bookable starts: on
  the 30-minute grid (C-20), coach available (hours, time off, no other live lesson), at least one
  court free for the type's duration, not in the past. `{"off": true}` while coaching is off at the
  type's branch, except to staff of that branch (R51). A paused coach answers `bookable: false,
  starts: []` (R51); a coach who has not accepted is `COACH_NOT_FOUND` to everyone but staff (R61). A
  window over 14 days is `INVALID_ARGUMENT`; the phone never sends more (§4.8.3).

**`lesson_offer(p_lesson_id, p_course_id)`** (X4, Guest's; anon and authenticated, `publicByDesign`;
exactly one id; `LESSON_NOT_FOUND` for a session of a coach who is paused, retired or not accepted)
```jsonc
{ "kind": "group|course", "lesson_id" | "course_id", "venue_id", "timezone", "phone",
  "coach": { "id", "display_name_en", "display_name_ar", "photo_path" },
  "type": { "id", "name_en", "name_ar", "description_en", "description_ar", "duration_min" },
  "title_en", "title_ar", "start_at", "end_at",
  "sessions": [{ "lesson_id", "session_no", "start_at", "end_at",
                 "status": "scheduled|completed|cancelled", "started": false }],  /* course */
  "status": "open|full|closed|cancelled",
  "places_left": 3, "max_places": 8, "min_places": 4, "places_taken": 5,
  "cutoff_at", "signup_closes_at",
  "price_iqd": 45000,          /* the caller's price: a place, the course, or its late-join share */
  "full_price_iqd": 60000,     /* course: the whole course; group: = price_iqd */
  "late_join": null | { "sessions_left": 6, "sessions_count": 8 },
  "payment_mode": "desk|online_optional|online_required", "cancellation_window_hours": 24,
  "mine": null | { "enrolment_id", "status": "held|booked", "confirm_needed": false },   /* signed in only */
  "server_now": "…" }
```
`places_taken` is a count, never names. `status` is the server's: `closed` after the group's start or
the course's last start, `full` with no place left. **Amended 2026-10-02 (0294, DB-33):** `mine` is
the caller's own place, held or booked, a confirmed one first; a place a coach or the desk added from
the caller's verified phone and not yet confirmed (C-21) is `mine` too, with `confirm_needed: true`,
so the class screen sends the guest to "Is this you?" instead of offering a second booking.

**Guest write results** (the phone reads these and refetches the rest)
- `lesson_book_private`, `lesson_join`, `course_join` (X5) → `{ enrolment_id, lesson_id | course_id,
  status: "booked|held", hold_expires_at, payment_mode, price_iqd, duplicate }` plus DB's extra fields.
  `status` is the **enrolment's** (`booked` for desk mode, `held` for Qi), never the lesson's
  `scheduled`.
- `lesson_cancel_mine` (X6, the union) → `{ enrolment_id, status, cancel_kind, refunds_started,
  strike, refund_iqd, kept_iqd, duplicate }`; the amounts are `lesson_enrolment_money` after the write
  (`refund_due_online_iqd` started, `kept_iqd`).
- `lesson_link_confirm(p_enrolment_id, p_yes)` (R44; DB, 0280) → `{ enrolment_id, linked, duplicate }`.
  `ENROLMENT_NOT_FOUND` unless the enrolment names the caller in `guest_id`, so a repeated "Not me"
  answers it too (the phone treats both as done).

**`my_lessons(p_scope)`** (X7, Guest's; `upcoming` = not ended, held included, plus anything ended in
the last 24 h; `past` = ended and booked; `cancelled` = cancelled or expired; limit 100)
```jsonc
[{ "enrolment_id", "kind", "lesson_id" | null, "course_id" | null, "venue_id",
   "coach": { "id", "display_name_en", "display_name_ar", "photo_path" },
   "type_name_en", "type_name_ar", "title_en", "title_ar",
   "start_at", "end_at",                 /* the next session (upcoming) or the last one (past) */
   "session_no" | null, "sessions_count" | null, "first_session_no" | null, "sessions_covered" | null,
   "status": "held|booked|cancelled|expired", "cancel_kind" | null,
   "lesson_status": "held|scheduled|completed|cancelled|expired",
   "attendance": null | "attended" | "no_show",
   "booked_by": "guest|coach|staff",
   "confirm_needed": false,              /* C-21: linked by a typed phone, not yet confirmed */
   "rescheduled": false,                 /* R8: moved after this enrolment was made */
   "party_size", "payment_mode": "desk|online", "price_iqd", "paid_online_iqd", "owed_iqd",
   "refund": null | { "status": "pending|refunded|failed", "amount_iqd" },
   "places_taken", "min_places", "cutoff_at",
   "pending_payment": null | { "request_id", "deadline_at" },
   "hold_expires_at" | null }]
```
A `confirm_needed` row carries no friend names, no court and no money beyond `price_iqd`; the phone
shows only the confirm card for it (§4.8.10).

**`my_lesson(p_enrolment_id)`** (X8, Guest's): the `my_lessons` row plus
```jsonc
{ "friend_names": [],
  "court_name_en" | null, "court_name_ar" | null,              /* once the lesson is scheduled */
  "sessions": [{ "lesson_id", "session_no", "start_at", "end_at", "status",
                 "rescheduled": false, "attendance": null }],  /* course: the sessions covered */
  "cancel": { "policy": "free|late|none", "free_until": "…" | null,
              "free_because": null | "rescheduled",            /* R8 */
              "refund_iqd": 0, "kept_iqd": 0, "counts_late": true,
              "refund_sessions": null | 5, "kept_sessions": null | 1,   /* course (C-23, R62) */
              "next_start_at": null | "…" },                           /* course: the guest's next covered session */
  "can": { "cancel": true, "pay": false, "confirm": false },
  "branch_phone", "timezone", "server_now" }
```
`cancel.*` is the server's answer for a cancel now (C-9, CD-2, R8, R62), computed by
`lesson_enrolment_money` as if the cancel ran: `policy` is `free`, `late`, or `none` when
`can.cancel` is false; `free_because: "rescheduled"` when the lesson (a course: the guest's next
covered session) was moved after the enrolment was made and has not started (R8). For a course,
`late` means the guest's own next covered session is inside the window (C-23); `refund_sessions` is
how many covered sessions are refunded, `kept_sessions` how many are kept. `counts_late` is false for
a coach- or desk-booked enrolment (CD-2). `can.pay` is true while the enrolment is `held` and its hold
is live; `can.confirm` while `confirm_needed` (then `can.cancel` and `can.pay` are false).
**Amended 2026-10-02 (0294, DB-33):** `can.pay` also needs the first covered session not to have
started; and a pending link whose place is no longer live (not `held` or `booked`, or its lesson, or
a course place's last covered session, has ended: `lesson_link_confirm`'s rule) answers
`ENROLMENT_NOT_FOUND`, so a place the coach removed never asks "Is this you?".

**`coach_me()`** (X9, Guest's plus DB's bios; `publicByDesign`, never raises; read whatever the
coaching switches and the staff status say, R45)
```jsonc
{ "coach": null } |
{ "coach": { "id", "status": "active|paused", "display_name_en", "display_name_ar",
             "bio_en", "bio_ar", "photo_path",
             "public_accepted": false,                              /* R61 */
             "branches": [{ "venue_id", "name_en", "name_ar", "timezone", "coaching_enabled",
                            "open_private": 4, "open_private_cap": 10 }],  /* R56, per branch */
             "lesson_types": [{ "id", "venue_id", "kind", "name_en", "name_ar", "duration_min",
                                "max_places", "min_places", "sessions_count", "cutoff_hours",
                                "price_iqd", "is_active" }],
             "adds_today": 3, "add_cap": 30,                        /* CD-9 */
             "private_open": 4, "private_cap": 10 },                /* display only: the sum and the lowest cap */
  "server_now": "…" } |
{ "coach": { "id", "status": "retired", "display_name_en", "display_name_ar" },
  "server_now": "…" }
```
`branches` lists every branch, not closed, where the coach is active, whatever its switch; a coach
whose branches all closed answers with `branches: []` and keeps statements (P5). A retired coach
answers the third shape (R45, C-25).

**`coach_accept_public()`** (R61; DB, 0280; coach) → `{ok: true}` or `{duplicate: true}`.

**`coach_schedule(p_from, p_to)`** (X10, Guest's; window ≤ 31 days; `NOT_A_COACH` for a retired
coach, R45)
```jsonc
{ "lessons": [{ "lesson_id", "venue_id", "kind", "course_id", "session_no", "sessions_count",
                "type_name_en", "type_name_ar", "title_en", "title_ar", "start_at", "end_at",
                "status", "places_taken", "max_places", "min_places", "cutoff_at",
                "court_name_en", "court_name_ar", "unmarked": 0 }],
  "time_off": [{ "id", "starts_at", "ends_at" }], "server_now": "…" }
```

**`coach_hours_mine()`**
```jsonc
{ "branches": [{ "venue_id", "name_en", "name_ar", "timezone",
                 "windows": [{ "id", "weekday": 0, "start_time": "09:00", "end_time": "24:00",
                               "set_by": "coach|staff", "updated_at" }] }],
  "time_off": [{ "id", "starts_at", "ends_at", "reason", "set_by": "coach|staff" }],  /* not ended, not cancelled */
  "server_now": "…" }
```
The read uses the names the phone renders (`start_time`, `end_time`; R41). The write is read only by
the server, so it takes DB's names: `set_my_coach_hours(p_venue_id, p_windows)` takes `[{weekday,
start: "HH:MM", end: "HH:MM"}]` (db §4.6.5) and replaces that branch's whole set; it answers the
branch's new `windows` in the read's names.

**`coach_lesson(p_lesson_id)`** (X11, Guest's; C-16, R44, R54; `NOT_A_COACH` for a retired coach)
```jsonc
{ "lesson": { "id", "venue_id", "kind", "course_id", "session_no", "sessions_count",
              "type_name_en", "type_name_ar", "title_en", "title_ar", "start_at", "end_at",
              "status", "cancel_reason", "court_name_en", "court_name_ar", "max_places",
              "min_places", "places_taken", "cutoff_at" },
  "course": null | { "id", "status", "sessions": [{ "lesson_id", "session_no", "start_at",
                                                     "end_at", "status" }] },
  "roster": [{ "enrolment_id", "name", "phone": "+9647…" | null, "party_size", "friend_names",
               "booked_by": "guest|coach|staff", "payment_mode": "desk|online",
               "status": "held|booked", "attendance": null | "attended" | "no_show" }],
  "can": { "add", "remove", "cancel", "cancel_course", "reschedule", "mark" },
  "mark_until": "…",            /* start + 24 h (CD-11) */
  "server_now": "…" }
```
- **Names (R44):** a coach- or staff-booked row shows the name and phone **as typed**, never the
  profile's, linked or not; after the CD-8 purge the name is DB's fixed marker, never a fallback to the
  account. A guest-booked row shows the account's name and phone.
- **Phone:** NULL after `end_at + 7 days` of this session (R54, CD-3), while the row is `held` (P13:
  shown as "Awaiting payment" until booked), and for a student with none.
- Cancelled enrolments are not in the roster. The roster never says whether a typed phone matched an
  account, or whether that account confirmed (C-8, C-21).

**`my_coach_statements(p_month)`** (X12: Money's visibility plus `months`; works for a retired coach,
R45)
```jsonc
{ "months": ["2026-09-01", "…"],              /* months with an approved or paid statement, newest first, last 12 */
  "statements": [{ "id", "venue_id", "venue_name_en", "venue_name_ar", "month",
                   "status": "approved|paid", "lessons_count", "collected_iqd",
                   "court_share_iqd", "coach_iqd", "adjustments_iqd", "share_bp",
                   "approved_at", "paid_at", "paid_reference",
                   "lines": [{ "lesson_id", "start_at", "kind", "type_name_en", "type_name_ar",
                               "collected_iqd", "court_share_iqd", "share_bp", "coach_iqd",
                               "is_adjustment" }] }],   /* lines only with p_month */
  "current_month": [{ "venue_id", "estimate": true, "lessons", "collected_iqd", "coach_iqd" }] }
```
`p_month` null: the summaries of the last 12 months, no lines. With `p_month`: that month's statements
with their lines. Drafts and `void` statements are never sent (CM-12); `current_month` is Money's
estimate of this month so far, and is not a statement.

**Coach write results** (X13 and DB's shapes; the phone reads the keys named): `coach_book_private` →
`{lesson_id, enrolment_id, duplicate, …}`; `coach_create_group` → `{lesson_id, duplicate, …}`;
`coach_create_course` → `{course_id, lesson_ids, sessions: [{session_no, lesson_id, …}], duplicate}`;
`coach_add_student` → `{enrolment_id, places_left, duplicate}` (the same answer whether the phone
matched or not); `coach_reschedule_session` → `{lesson_id, start_at, end_at, court_name_en,
court_name_ar}`; every other coach write → `{ok: true}`, the internal's JSON, or `{duplicate: true}`.

**`lesson-begin`** (Money, edge, `verify_jwt = true`, a copy of `ticket-begin`): `POST
{enrolment_id, locale}` → 200 `{request_id, form_url, amount_iqd, deadline_at, status: 'pending',
reused, enrolment_id}`. A live attempt for the same enrolment answers `reused: true` with its ref.
Refusals are `{error, detail?}` (X33, mo §6.7): 400 `BAD_REQUEST`, `INVALID_ARGUMENT`,
`PHONE_REQUIRED`; 401 `AUTH_REQUIRED`; 403 `ACCOUNT_REQUIRED`; 404 `ENROLMENT_NOT_FOUND`; 409
`LESSON_NOT_PAYABLE` (detail `booked`, `cancelled`, `expired`, `desk`, `free`), `ONLINE_PAYMENT_OFF`,
`COACHING_OFF`; 429 `TOO_MANY_ATTEMPTS`; 503 `PROVIDER_UNAVAILABLE`, `DEGRADED_LOCKOUT`,
`RETRY_LATER`.

**`deposit_status` for a lesson** (X14, the union; Money, 0281): Money's JSON with `purpose:
'lesson'`, `hold_live` (the enrolment is `held` and its hold has not lapsed), `attempts_left`,
`amount_iqd`, `reservation: null`, and `lesson: { enrolment_id, enrolment_status, kind, lesson_id,
course_id, start_at, end_at, venue_id, coach_id, coach_name_en, coach_name_ar, type_name_en,
type_name_ar }` (`start_at`/`end_at`: the first covered session). Coach names are public (they are on
the website), so the payment screen may show them.

**What Guest needs from DB and Money, beyond the shapes** (for their passes; R17, R41 and R52 already
bind the shapes and codes above):
1. Every un-keyed guest or coach write answers a repeat with success (`duplicate: true`) or a state
   code, never a second effect: the phone retries once on a transport fault (§4.7.3).
2. DB writes the db §5.2 events in the order of db §4.7.2 (inside a lesson cancel: the lesson row,
   then each enrolment's `enrolment_cancelled`, then the lesson's own event; inside a course cancel:
   the sessions, then each course enrolment, then the course's event), and `enrolment_cancelled`'s
   `data` gains `from` (`held` | `booked`, the status before the cancel). The trigger's mapping
   (§4.5.4) depends on both; `lesson-push.test.ts` pins them.
3. **Link confirmation (C-21, R44):** `lesson_enrolments.link_confirmed_at` is set at insert when the
   desk picked the customer (`p_customer_id`), and left NULL when a typed phone matched. A guest's own
   enrolment needs none (`booked_by_kind = 'guest'` counts as confirmed). `lesson_link_confirm` (DB,
   0280, `lesson_guest(false)` first, `guarded`) sets it, or sets `guest_id` NULL on "Not me"; neither
   writes an event the coach can see.
4. `coach_accept_public()` (R61; DB, 0280, `coach_self()` first, `guarded`); `coach_me`'s
   `public_accepted`, `bio_*`, `private_open`, `private_cap` and the retired shape (R45).
5. `my_coach_statements` answers a retired coach (approved and paid only, R45); `coach_lesson` and
   `coach_schedule` answer `NOT_A_COACH` for one.
6. Money calls `lesson_notify` only for `coach.statement_ready` (approve) and `coach.statement_paid`
   (mark paid), and never `lesson_sync_reminders` (R18, R40): the `paid_online` and `expired` events
   carry the rest.

### 4.4 0271 `outbox_lesson_kinds`

CHECK widening only, alone in its file. The thirteen existing kinds are 0255:16-24 verbatim (the
latest CHECK; `packages/db/CLAUDE.md`, "New push kind").

```sql
set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0271 outbox_lesson_kinds — coaching, lane Guest (docs/design/coaching/guest.md §4.4;
-- build contracts §1.1, §1.2, §1.9). CHECK widening only, alone in its file.
--
-- notification_outbox.kind gains the coaching kinds of the guest family:
-- lesson_update, lesson_reminder, coach_update. Their copy is in
-- supabase/functions/send-push/guestStrings.ts, keyed by payload.title_key, and
-- _shared/guest-push.json is the one list of kinds, title keys and routes.
-- send-push MUST be deployed with them before this file reaches hosted:
-- deploy.yml deploys send-push first. Nothing queues these kinds before
-- app.lesson_notify (0280). The thirteen existing kinds are 0255:16-24 verbatim.

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info',
                  'deposit_refunded',
                  'match_update', 'match_reminder', 'match_message',
                  'lesson_update', 'lesson_reminder', 'coach_update'))
  not valid;

do $validate_kind_check_0271$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0271$;
```

**Travels with it (commit G1):**
- `packages/db/src/types.gen.ts`: a CHECK is not typed, so no diff is expected; `pnpm db:types` must
  still show none.
- `tests/outbox-kinds.test.ts`: the describe title gains 0271; "accepts each of the 13 kinds" becomes
  16; the parsed CHECK still equals booking ∪ `staff-push.json` kinds ∪ `guest-push.json` kinds, which
  now holds the three lesson kinds (§4.6.1).
- `packages/db/CLAUDE.md`, "New push kind": "latest `0255`" becomes "latest `0271`", and the guest
  sentence names `app.lesson_notify`'s `c_keys` beside `app.match_notify`'s.
- No RPC, matrix row, coverage key, error code or catalog key. `check-migrations` locally before the
  push.

### 4.5 The Guest part of 0280

Guest writes these at the top of 0280, before DB's bodies (the tables exist since 0275). Every
function is `security definer set search_path = public` and `revoke all … from public, anon,
authenticated`; dollar tags `$lesson_notify_0280$` and so on.

**Who queues what (R18, R40), the whole list:**
- the trigger `lesson_events_notify` (§4.5.4) queues every `lesson.*` and `coach.*` key except the
  two statement keys;
- Money's `coach_statement_approve` and `coach_statement_mark_paid` (0284) call `lesson_notify` for
  `coach.statement_ready` and `coach.statement_paid`;
- the reminder triggers (§4.5.3), through `lesson_sync_reminders`, queue `lesson.reminder`.

No other DB or Money body calls `lesson_notify` or `lesson_sync_reminders`.

#### 4.5.1 `app.lesson_notify(p_ref uuid, p_title_key text, p_dedupe text default null, p_params jsonb default '{}') returns int`

§1.5 fixes the argument types `(uuid, text, text, jsonb)`; the names, the defaults and the meaning are
this lane's (R18). There is no recipient list, no actor and no schedule argument: each is derived, which
keeps every caller's line short and makes a wrong recipient impossible.

- **`p_ref`** is the route's id, and it names the one recipient:

| Title keys | Route | `p_ref` | Recipient |
| --- | --- | --- | --- |
| `lesson.added_by_coach` | `lesson` | a `lesson_enrolments.id` | that enrolment's `guest_id` while its link is **unconfirmed** (`booked_by_kind in ('coach','staff')` and `link_confirmed_at` NULL); otherwise nothing |
| every other `lesson.*` | `lesson` | a `lesson_enrolments.id` | that enrolment's `guest_id` when it is a **student**: `booked_by_kind = 'guest'` or `link_confirmed_at is not null` (C-21: an unconfirmed link gets nothing else, reminders included); a walk-in: nothing |
| `coach.statement_ready`, `coach.statement_paid` | `coach_statements` | a `coach_statements.id` | `coaches.profile_id` of its coach |
| every other `coach.*` | `coach_lesson` | a `lessons.id` (for a course-wide event, the course's first session with `start_at > now()`, live or just cancelled; with none, its last) | `coaches.profile_id` of the lesson's coach |

- **The actor** is `auth.uid()`: the caller is never told about their own act. The mapping (§4.5.4)
  already leaves the actor out; this is the backstop. The service role (the sweep, the payment
  webhook) has none, so nobody is skipped. `lesson.reminder` never skips.
- **The schedule** follows the key: `lesson.reminder` is queued at `start_at − 3 hours` of
  `p_params.lesson_id` (CD-7) and not at all when that is not in the future; `lesson.added_by_coach` is
  due at `now() + 5 seconds` and is not nudged, so the cron sends it (R44: a matched add and an
  unmatched one then do the same synchronous work, bar one outbox insert); every other key is due now.

Body, in order:
1. Validation, **outside** the exception block so tests see a bad call. `INVALID_ARGUMENT` when:
   - `p_title_key` is not a key of `c_keys` (hint `title_key`). `c_keys` is a `constant jsonb` copy of
     the `guest-push.json` `title_keys` whose kind is `lesson_update`, `lesson_reminder` or
     `coach_update` (key → kind; 18 keys, §4.6.1); a test compares the two;
   - `p_ref` is NULL (hint `p_ref`);
   - `p_params` is not an object, has a key outside `lesson_id`, `places_taken`, `places_total`,
     `lesson_id` is not a uuid string, or a `places_*` value is not an integer 0..64 (hint `params`);
   - a `lesson.*` key has no `lesson_id` (hint `params`).
2. Kind = `c_keys->>p_title_key`; route from the key as in the table. Payload `{route, id:
   p_ref::text, title_key, params}` plus `dedupe` when given. No name and no amount can enter it.
3. Inside `begin … exception when others then raise warning 'lesson_notify: %', sqlerrm; return 0;
   end`: resolve the recipient by the table (none → return 0); resolve the schedule (`lesson.reminder`
   in the past → return 0); insert one `notification_outbox (profile_id, kind, payload, scheduled_for)`
   row when the profile exists, `deleted_at is null`, `expo_push_token is not null` (the 0090 guest
   rule, `20260913000090_push_immediate_delivery.sql:159-163`), it is not the actor (except
   `lesson.reminder`), and, with `p_dedupe`, it has no row with that `dedupe` in the last 15 minutes
   (the predicate of `match_notify`, 0261:118-122).
4. When the row is due now and was inserted, `perform app.push_nudge()`.
5. Return the rows inserted (0 or 1).

**Dedupe keys** (15 minutes per recipient): `l:<p_ref>:<title_key>` for every key, except
`coach.new_student` and `coach.student_cancelled`, which add the count
(`l:<lesson>:<key>:<places_taken>`, so each change pushes and a retry does not), and
`lesson.reminder`, which has none (§4.5.2 deletes before it queues).

**Amended 2026-10-02 (0296, DB-42, DB-44).** The two helpers the trigger calls build the key:
- `coach.new_student` and `coach.student_cancelled` add the **enrolment**, not the count:
  `l:<lesson>:<key>:<enrolment>`, falling back to the count when no enrolment is named. With the count,
  A joins, A cancels, B joins inside 15 minutes lost B's push.
- A move adds its session and where it went, on both sides: `lesson.rescheduled` and
  `coach.rescheduled_by_staff` add `:<lesson>:<to_start_at>`; `lesson.court_moved` and
  `coach.court_moved` add `:<lesson>:<to_court_id>` (the event's id when the data has no court). Before,
  the guest's key was one per course enrolment, so a second session moved inside 15 minutes, or the same
  session moved again, pushed nothing. An identical replay of the same move still pushes once.
- Signatures: `app.lesson_read_push_guest(p_enrolment_id uuid, p_title_key text, p_lesson_id uuid,
  p_suffix text default null)` and `app.lesson_read_push_coach(p_lesson_id uuid, p_title_key text,
  p_places jsonb default '{}', p_enrolment_id uuid default null, p_suffix text default null)`; both
  internal, granted to nobody, called only by the trigger.

#### 4.5.2 `app.lesson_sync_reminders(p_lesson_id uuid) returns void`

Inside its own exception block (warning, never raise):
1. `delete from notification_outbox where kind = 'lesson_reminder' and sent_at is null and attempts <
   5 and scheduled_for > now() and payload->'params'->>'lesson_id' = p_lesson_id::text`. The first
   four terms are the partial index `notification_outbox_due`'s own (`0024:32-33`), so no new index is
   needed on a table with rows (the 0261 precedent).
2. When the lesson is `scheduled` and `start_at − 3 h > now()`: for every **student** enrolment
   (`status = 'booked'`, `guest_id is not null`, and `booked_by_kind = 'guest'` or `link_confirmed_at
   is not null`; C-21, R44) that covers it (a lesson enrolment with `lesson_id = p_lesson_id`, or a
   course enrolment of its course with `session_no` in `first_session_no .. first_session_no +
   sessions_covered − 1`): `perform app.lesson_notify(e.id, 'lesson.reminder', null,
   jsonb_build_object('lesson_id', p_lesson_id))`.

A lesson booked inside its last 3 hours gets no reminder (as bookings, 0090:178-181).

Step 1 deletes only future rows: a reminder already due (not yet claimed, or waiting out a failed
send's lease) survives a cancel or a move. `send-push` checks it at send time instead (coaching
review EC-02, `send-push/lessonReminder.ts`): the reminder goes only while its enrolment (`payload.id`)
is `booked`, is the row's profile's, and is a student's, and its lesson still starts 3 h after the row's
`scheduled_for`, give or take 2 minutes. Anything else is `REMINDER_STALE` (§4.6.3).

#### 4.5.3 The reminder triggers (Guest, in 0280)

The reminders follow the state, not the callers: these triggers are the **only** callers of
`lesson_sync_reminders` (R18). A missed call site cannot leave a stale or missing reminder (the 0090
booking trigger and the 0261 match trigger are the precedents).

- `lessons_reminders`: `create constraint trigger … after update of start_at, status on lessons
  deferrable initially deferred for each row when (old.start_at is distinct from new.start_at or
  old.status is distinct from new.status)` → `app.trg_lesson_reminders()` →
  `lesson_sync_reminders(new.id)`. A held lesson turning `scheduled`, a reschedule (R8, any kind), a
  cancel, a completion: each resyncs.
- `lesson_enrolments_reminders_ins`: `… after insert on lesson_enrolments deferrable initially
  deferred for each row when (new.status = 'booked')`, and `lesson_enrolments_reminders_upd`: `…
  after update of status, guest_id, link_confirmed_at on lesson_enrolments deferrable initially
  deferred for each row when (old.status is distinct from new.status or old.guest_id is distinct from
  new.guest_id or old.link_confirmed_at is distinct from new.link_confirmed_at)`, both →
  `app.trg_enrolment_reminders()`: a lesson enrolment resyncs its lesson; a course enrolment resyncs
  each `scheduled` session it covers (at most 52). A "Yes" to the link confirm adds the reminders; a
  "Not me" leaves none.
- **Once per lesson per transaction** (the concurrency review's F21): deferred, they fire at commit,
  when every row is final, and each body skips a lesson id already in the transaction-local list
  `app.lesson_reminders_synced` (`current_setting(…, true)`, appended with `set_config(…, true)`). A
  course cancel of 52 sessions and 16 enrolments then runs 52 syncs, not hundreds, and none of them
  under a half-written state.

Both bodies run inside `begin … exception when others then raise warning …; end` and return NULL, so
a push can never fail or roll back a booking. They read `lessons` and `lesson_enrolments` without
`FOR UPDATE` and write only `notification_outbox`, which is not in the lock `ORDER` (§1.4);
`check:locks` expands them under every writer and must stay green.

#### 4.5.4 `lesson_events_notify`: the one fan-out (R40)

`create trigger lesson_events_notify after insert on lesson_events for each row execute function
app.trg_lesson_events_notify()`. It fires straight away, so it reads the state DB wrote just before
the event (db §5.2: the event is written after the rows it describes). The body runs inside `begin …
exception when others then raise warning 'lesson_events_notify: %', sqlerrm; end`, returns NULL,
reads `lessons`, `courses` and `lesson_enrolments` without `FOR UPDATE`, and calls `lesson_notify`
once per recipient below, with §4.5.1's dedupe key. A push never fails or rolls back the write. DB writes no `lesson_notify`
call; Money writes only the two statement calls.

Terms in the table:
- **the guest**: the event's enrolment (`lesson_notify` applies §4.5.1's student and unconfirmed-link
  rules); `params.lesson_id` = the event's lesson, or for a course enrolment its first covered session
  with `start_at > now()`, else its last covered one.
- **each student covering it**: every `booked` enrolment covering the event's lesson (a lesson
  enrolment of it, or a course enrolment whose covered sessions include it), one call each.
- **the coach**: `p_ref` = the event's lesson; for a course-level event or a course enrolment, the
  course's first session with `start_at > now()` (live or just cancelled), else its last.
- **+ places**: `params {places_taken, places_total}` = the booked places after the change (the sum
  of `party_size` over `booked` enrolments of the lesson, or of the course) and `max_places`; a
  private lesson sends neither.
- **`from`**: `enrolment_cancelled`'s `data.from` (`held` | `booked`; "What Guest needs" item 2).

| Event `type` | When | Guest key | Coach key |
| --- | --- | --- | --- |
| `booked` | with an enrolment, actor `guest` (a desk-mode private booking) | — | `coach.new_student` |
| `booked` | no enrolment, actor `staff`, a group session or a course | — | `coach.session_added` |
| `booked` | otherwise (the coach's own creation; the lesson row of a coach- or desk-booked private lesson, whose `added` event follows) | — | — |
| `held` | — | — | — (`paid_online` tells the coach) |
| `joined` | the enrolment is `booked` (desk mode) | — | `coach.new_student` + places |
| `joined` | the enrolment is `held` | — | — |
| `added` | the enrolment's link is unconfirmed (a typed phone matched, C-21) | `lesson.added_by_coach` (due `now() + 5 s`, R44) | actor `staff`: `coach.new_student` + places; actor `coach`: — |
| `added` | the enrolment is a student (the desk picked the customer) | `lesson.booked` | as above |
| `added` | no `guest_id` (a walk-in, or no match) | — | as above |
| `paid_online` | — | — (the payment screen is open) | `coach.new_student` + places |
| `paid_online` | `data.revived` true (a late success revived an expired place; 0296, DB-43) | `lesson.booked` (the screen is long closed; the guest was last told `payment_expired`) | `coach.new_student` + places |
| `expired` | no `data.reason` (a lapse) | `lesson.payment_expired` | — |
| `expired` | `data.reason` set (0295, DB-35: the guest paid, the place could not be given, the money goes back whole; 0296) | — | — |
| `enrolment_cancelled` | code `guest_free`, `guest_late`, `account_deleted` | — | `coach.student_cancelled` + places, when `from = 'booked'` |
| `enrolment_cancelled` | code `coach` (a removal, a coach cancel, a retirement) | `lesson.cancelled_by_coach` | — |
| `enrolment_cancelled` | code `staff` | `lesson.cancelled_by_staff` | `coach.student_cancelled` + places, only while the group session or the course is still live (one removal); otherwise the lesson's own event tells the coach |
| `enrolment_cancelled` | code `under_filled` | `lesson.under_filled` | — (the lesson's event) |
| `enrolment_cancelled` | code `course_cancelled` | by `courses.cancel_reason`: `coach_cancel`, `coach_retired` → `lesson.cancelled_by_coach`; `staff_cancel` → `lesson.cancelled_by_staff`; `under_filled` → `lesson.under_filled`; anything else → — | — (the course's event) |
| `cancelled` | a session of a course (the event names the lesson, not only the course) | — | — (the course's event) |
| `cancelled` | code `staff_cancel` | — (each enrolment's event) | `coach.lesson_cancelled_by_staff` |
| `cancelled` | any other code (`coach_cancel`, `coach_retired`, `guest_cancel`, `payment_expired`, `account_deleted`) | — | — |
| `under_filled` | `data.late` true (R26: judged after the start; nothing cancelled), or a session of a course | — | — |
| `under_filled` | otherwise | — (each enrolment's event) | `coach.under_filled` |
| `rescheduled` | any kind (R8) | `lesson.rescheduled` → each student covering it | actor `staff`: `coach.rescheduled_by_staff` |
| `court_moved` | — | `lesson.court_moved` → each student covering it | `coach.court_moved` |
| `completed`, `attended`, `no_show`, `unmarked`, `settled`, `refunded` | — | — | — |

Three traces the test pins (each one push per person):
- A guest cancels a booked private lesson: the lesson's `cancelled` (`guest_cancel`) queues nothing;
  `enrolment_cancelled` (`guest_free`, from `booked`) → `coach.student_cancelled`.
- The desk cancels a private lesson: the lesson's `cancelled` (`staff_cancel`) →
  `coach.lesson_cancelled_by_staff`; `enrolment_cancelled` (`staff`) → `lesson.cancelled_by_staff`,
  and no second coach push because the lesson is no longer live.
- The sweep cancels an under-filled course: the sessions' events queue nothing; each enrolment's
  `course_cancelled` → `lesson.under_filled`; the course's `under_filled` → `coach.under_filled` once.

**Not pushed, on purpose:** attendance marks and completion; desk money and refunds (`settled`,
`refunded`: the cancel already told the guest); `held` (the guest is paying); a coach's own creation,
hours and time off, and a manager's override of them (coach mode shows "set by the venue", §4.13.3);
the link confirm's answer (the coach is never told, C-21); a late cut-off judgement (R26);
`close_branch` (it refuses live lessons and coaching money, R37). A court changes only through
`desk_move_lesson_court`, because `move_reservation` refuses a lesson row (R7).

#### 4.5.5 What travels with the Guest part of 0280

- `fixtures/assistant-coverage.json` `functions`: `lesson_notify`, `lesson_sync_reminders`,
  `trg_lesson_events_notify`, `trg_lesson_reminders`, `trg_enrolment_reminders` → `excluded:
  service_role only — coaching push fan-out (0280)`.
- No `rls-matrix.ts` row and no allowlist entry: nothing here is granted.
- `check:locks` after 0280 (the triggers are expanded under every writer of `lessons`,
  `lesson_enrolments` and `lesson_events`).
- New `packages/db/tests/lesson-push.test.ts` (stack), created in the 0280 commit; 0281 (`paid_online`,
  `expired` through Money's real bodies) and 0284 (the statement keys) append their cases:
  - `lesson_notify`: the closed payload; each `INVALID_ARGUMENT`; the recipient from each route
    (student, walk-in → 0, an unconfirmed link → only `lesson.added_by_coach`, due `now() + 5 s` and not
    nudged, coach profile, statement coach); the actor skipped through `request.jwt.claims`, and a
    reminder not skipped; deleted and tokenless profiles skipped; dedupe inside and outside 15
    minutes; the kind from the key; a failing insert returns 0 and the caller's write commits; the
    nudge only for rows due now;
  - `c_keys` parsed from `pg_get_functiondef('app.lesson_notify(uuid,text,text,jsonb)'::regprocedure)`
    equals the lesson subset of `guest-push.json` `title_keys` (the `guest-push.test.ts:70-79`
    pattern);
  - reminders: a booked private lesson queues one at `start − 3 h`; a course enrolment one per
    covered scheduled session; a reschedule of each kind moves them; a guest cancel, a coach cancel
    and an under-filled cancel clear them; a lesson inside 3 hours gets none; a held enrolment gets
    none until it is booked; an unconfirmed link gets none until `lesson_link_confirm(…, true)`, and
    "Not me" leaves none; a course cancel syncs each session once (F21);
  - **every row of the §4.5.4 table, driven through the real RPCs** (R40): the transition, then
    exactly its keys to exactly its recipients, nothing for the silent rows, the three traces above,
    and the event order DB relies on.

### 4.6 `send-push`: the lesson family

#### 4.6.1 `_shared/guest-push.json`

One catalogue for both guest families, now four copies: `send-push`, `app.match_notify`'s `c_keys`
(the match kinds' keys), `app.lesson_notify`'s `c_keys` (the lesson kinds' keys), and the phone's
`features/matches/pushRoutes.ts` (routes and kinds). The file gains, appended after the existing
entries in each list:

```jsonc
"kinds": [ …, "lesson_update", "lesson_reminder", "coach_update" ],
"title_keys": { …,
  "lesson.booked": "lesson_update", "lesson.cancelled_by_coach": "lesson_update",
  "lesson.cancelled_by_staff": "lesson_update", "lesson.under_filled": "lesson_update",
  "lesson.rescheduled": "lesson_update", "lesson.court_moved": "lesson_update",
  "lesson.payment_expired": "lesson_update", "lesson.added_by_coach": "lesson_update",
  "lesson.reminder": "lesson_reminder",
  "coach.new_student": "coach_update", "coach.student_cancelled": "coach_update",
  "coach.lesson_cancelled_by_staff": "coach_update", "coach.under_filled": "coach_update",
  "coach.statement_ready": "coach_update", "coach.statement_paid": "coach_update",
  "coach.session_added": "coach_update", "coach.rescheduled_by_staff": "coach_update",
  "coach.court_moved": "coach_update" },
"routes": [ "match", "tickets", "lesson", "coach_lesson", "coach_statements" ],
"params": [ "seats_taken", "seats_total", "minutes", "lesson_id", "places_taken", "places_total" ]
```
The last three `coach.*` keys are this lane's additions to §1.9 (§4.20). The `_readme` gains: "and
coaching (§1.9 of build-contracts-2026-10-01; docs/design/coaching/guest.md §4.6). `app.match_notify`
copies the keys of the three match kinds, `app.lesson_notify` those of the three lesson kinds; each
validates only its own params."

#### 4.6.2 `send-push/guestStrings.ts`

Still pure, still one `GUEST_STRINGS[lang][title_key]` table, typed by EN's keys so a missing Arabic
entry fails `typecheck`.
- `GuestTitle` gains `'lesson' | 'lessonReminder' | 'coach' | 'statement'`.
- `GuestVars` gains `places` (`"3/8"`, LTR-isolated as one unit, '' without both counts) and `month`
  (FSI-isolated, the statement's month and year in the reader's language, Latin digits).
- Every lesson key is `form: 'none'`: no third person on these lock screens has a known gender, and
  the role nouns (المدرّب، المتدرّبون) are the generic forms (§4.15, on the review list).
- `TITLES`: `lesson` → "Lesson · {when}{ · branch}" / «حصة · {when}{ · branch}»; `lessonReminder` →
  "Your lesson is in 3 hours" / «حصتك بعد 3 ساعات»; `coach` → "Coaching · {when}{ · branch}" /
  «تدريب · {when}{ · branch}»; `statement` → "Your coach statement" / «كشف حساب المدرّب».
- `guestMessage`: `BAD_ROUTE` when the route is not listed, or when `match`, `lesson` or
  `coach_lesson` comes without an id (`tickets` and `coach_statements` need none). `data` stays
  `{kind, route, title_key}` plus `id`: never a name, an amount or `lesson_id`.
- `GuestContext` gains `month: string` ('' without a statement). `when`, `time` and `branch` are
  filled by `index.ts` from the lesson row for lesson and coach rows.

#### 4.6.3 `send-push/index.ts`

- `OutboxRow.kind` gains the three kinds (`:146-159`); the header comment says four families' worth
  of copy: booking, staff, open matches, coaching.
- One more batch read per claim, only when lesson rows are present: `lessons (id, start_at, venue_id,
  status)` for the ids in `params.lesson_id` (route `lesson`) and `payload.id` (route
  `coach_lesson`), and `coach_statements (id, month, venue_id)` for route `coach_statements`. Only
  uuids are looked up (the `isUuid` filter of `:235`). The `venues` read (`:243`) is shared with the
  match rows.
- `{when}` and `{time}` from the lesson's `start_at` in its branch's timezone with `guestWhen` /
  `guestTime`; `{branch}` when more than one venue is active; `{month}` from the statement's `month`
  with `Intl.DateTimeFormat(lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB', {month: 'long', year:
  'numeric', timeZone: 'UTC'})` (the column is a date).
- Terminal errors (`attempts: RETRY_CAP`, as `:298-301`): `LESSON_GONE` (a lesson id that names no
  lesson), `STATEMENT_GONE`, and `REMINDER_STALE` (a `lesson.reminder` whose lesson is no longer
  `scheduled`, whose enrolment is no longer the profile's booked student place, or whose lesson moved
  since it was queued: §4.5.2, EC-02; the sync should have deleted it; this is the backstop), plus
  `guestMessage`'s three.
- `priority: 'high'` and `channelId: ANDROID_CHANNEL_ID`, as every kind.

#### 4.6.4 The copy (EN, then AR **DRAFT-AR**)

| Title key | Title | EN body | AR body |
| --- | --- | --- | --- |
| `lesson.booked` | lesson | You're booked in. The details are in the app. | تم حجز مكانك، والتفاصيل في التطبيق. |
| `lesson.cancelled_by_coach` | lesson | The coach cancelled your place in this lesson. Anything you paid online is refunded to your card. | أُلغي مكانك في هذه الحصة من قِبل المدرّب، ويُعاد ما دُفع إلكترونيًا إلى بطاقتك. |
| `lesson.cancelled_by_staff` | lesson | The venue cancelled your place in this lesson. Anything you paid online is refunded to your card. | ألغى النادي مكانك في هذه الحصة، ويُعاد ما دُفع إلكترونيًا إلى بطاقتك. |
| `lesson.under_filled` | lesson | Not enough people signed up, so it was cancelled. Anything you paid online is refunded to your card. | لم يكتمل الحد الأدنى من المشتركين فأُلغيت، ويُعاد ما دُفع إلكترونيًا إلى بطاقتك. |
| `lesson.rescheduled` | lesson | Your lesson moved to {when}. You can cancel free until it starts. | نُقلت حصتك إلى {when}، ويمكن إلغاؤها مجانًا حتى موعد بدئها. |
| `lesson.court_moved` | lesson | Your lesson moved to another court, at the same time. | نُقلت حصتك إلى ملعب آخر في الوقت نفسه. |
| `lesson.payment_expired` | lesson | The payment wasn't completed in time, so your place was released. No money was taken. | لم يكتمل الدفع في الوقت المحدد، فأُلغي حجز مكانك ولم يُخصم أي مبلغ. |
| `lesson.added_by_coach` | lesson | You've been added to a lesson. Open the app to confirm it's you. | تمت إضافتك إلى حصة. يُرجى فتح التطبيق لتأكيد أن الحجز لك. |
| `lesson.reminder` | lessonReminder | {time}{ · branch} | {time}{ · branch} |
| `coach.new_student` | coach | New booking in your lesson{ · places} | حجز جديد في حصتك{ · places} |
| `coach.student_cancelled` | coach | A booking in your lesson was cancelled{ · places} | أُلغي حجز في حصتك{ · places} |
| `coach.lesson_cancelled_by_staff` | coach | The venue cancelled this lesson. Your students have been told. | ألغى النادي هذه الحصة، وأُبلغ المتدرّبون. |
| `coach.under_filled` | coach | Not enough people signed up, so it was cancelled. Your students have been told. | لم يكتمل الحد الأدنى من المشتركين فأُلغيت، وأُبلغ المتدرّبون. |
| `coach.statement_ready` | statement | Your statement for {month} is ready to view. | كشف حسابك لشهر {month} جاهز للاطلاع. |
| `coach.statement_paid` | statement | Your statement for {month} is marked as paid. | سُجّل كشف حسابك لشهر {month} مدفوعًا. |
| `coach.session_added` | coach | The venue scheduled a session for you. | جدول النادي حصة لك. |
| `coach.rescheduled_by_staff` | coach | The venue moved this session to {when}. | نقل النادي هذه الحصة إلى {when}. |
| `coach.court_moved` | coach | This lesson moved to another court, at the same time. | نُقلت هذه الحصة إلى ملعب آخر في الوقت نفسه. |

- Every body names nobody and carries no amount (CD-7). "Anything you paid online" names no figure;
  the app shows it.
- `lesson.added_by_coach` goes only to an unconfirmed link (§4.5.1) and names neither the coach nor
  the student the coach typed, so a stranger whose number was mistyped learns nothing from it (C-21).
  The `lesson` route opens the confirm card (§4.8.10).
- A body that needs a missing value (`{when}`, `{time}`, `{month}`) sends the title alone, as the
  match keys do.
- `{places}` is LTR-isolated, so "3/8" never flips to "8/3" in Arabic.

#### 4.6.5 Tests

- `tests/send-push-guest.test.ts` (pure): the lists test reads six kinds, five routes and six params;
  "maps the 23 title keys" becomes the match subset, and a new case maps the 18 lesson keys to their
  kinds; the copy cases (both languages, non-empty, Arabic in Arabic, no name, no money) run over every
  key; new cases for the four titles, `{places}` isolation and its absence, `{month}`, the route-id
  rules (`lesson` and `coach_lesson` need an id, `coach_statements` does not), and the `index.ts`
  wiring of `LESSON_GONE`, `STATEMENT_GONE` and `REMINDER_STALE`; "never reads matches for a claim
  without match rows" gains "never reads lessons or statements without lesson rows".
- `tests/guest-push.test.ts` (stack, commit G1): `c_keys in app.match_notify` compares with the match
  subset (`title_keys` filtered to the three match kinds) instead of the whole map, so the JSON can
  grow; `lesson-push.test.ts` holds the lesson subset (G2).
- `tests/outbox-kinds.test.ts` (§4.4).
- `apps/mobile/src/features/matches/__tests__/pushRoutes.test.ts` (§4.11).

### 4.7 Mobile: folders, keys, queries, idempotency, gating

#### 4.7.1 `src/features/coaching/` (guest), modelled on `src/features/matches/`

| File | Exports |
| --- | --- |
| `keys.ts` | `coachingKeys`, `LessonScope = 'upcoming' \| 'past' \| 'cancelled'`, `CoachingMutation` (§4.7.3) |
| `api.ts` | one function per call, each taking the typed client: `fetchCoachingPublic(venueId)`, `fetchCoachProfile(coachId, venueId \| null)`, `fetchCoachSlots(coachId, typeId, from, to)`, `fetchLessonOffer({lessonId} \| {courseId})`, `bookPrivate(args)`, `joinLesson(args)`, `joinCourse(args)`, `cancelMyLesson(enrolmentId)`, `confirmLessonLink(enrolmentId, yes)` (`lesson_link_confirm`, C-21), `fetchMyLessons(scope)`, `fetchMyLesson(enrolmentId)`, `lessonBegin({enrolmentId, locale})` (through `invokeDepositEdge('lesson-begin', …)`) |
| `logic.ts` | the parsers (`parseCoachingPublic`, `parseCoachProfile`, `parseCoachSlots`, `parseLessonOffer`, `parseMyLessons`, `parseMyLesson`, `parseLessonWrite`, `parseCancelResult`, `parseLinkConfirm`, `parseLessonBegin`), each reading its key list from `@touch/core` `coaching/shapes.ts` (R41); the enums (`LESSON_KINDS`, `ENROLMENT_STATUSES`, `CANCEL_KINDS`, `LESSON_PAYMENT_MODES`, `CANCEL_REASONS`); `coachingEnabled(settings)`; `anyCoaching(branches)`; `lessonWindow(now, tz)`; `lessonCells(slots, night, settings, now)`; `slotsByNight(slots, settings)`; `paymentChoices(mode)`; `privateIntent(…)`, `joinIntent(…)`; `displayCoachName(coach, locale)`; `coachPhotoUrl(path)` (a `coaches/<uuid>/<file>` path only, R43) |
| `state.ts` | `lessonStateOf(row, now)` (§4.8.9) |
| `hooks.ts` | `useCoachingPublic(venueId)`, `useCoachProfile(coachId, venueId)`, `useCoachSlots(…)`, `useLessonOffer(kind, id)`, `useMyLessons(scope, {enabled})`, `useMyLesson(id)`, `useBookPrivate()`, `useJoinLesson()`, `useJoinCourse()`, `useCancelMyLesson()`, `useConfirmLessonLink()`, `useLessonEntry(venueId)`; re-exports `coachingKeys` |
| `useLessonBooking.ts` | the coach screen's grid (§4.8.3) |
| `payment.ts` | `useStartLessonPayment()` (§4.9.3) |
| `errors.ts` | `lessonErrorText(err, t, ctx)` (§4.10) |
| `pendingLesson.ts` | the signed-out intent store (§4.9.5) |
| `links.ts` | `COACH_ID_RE`, `isCoachId`, `normaliseCoachLink(path)`, `coachShareUrl(coachId)` (§4.12) |
| `__tests__/*` | §4.17 |

`coachingEnabled` lives in its own feature's `logic.ts`, the same shape as `matchesEnabled`
(`features/matches/logic.ts:1169`); §1.11's "beside" is read as "alongside, in the same shape":
`coachingEnabled(settings) => settings?.coaching_enabled === true`.

#### 4.7.2 `src/features/coach/` (coach mode)

| File | Exports |
| --- | --- |
| `status.ts` | `CoachStatus`, `nextCoachStatus(input)` (pure, §4.13.1) |
| `gate.ts` | `coachGate(status, screen)` (pure) |
| `CoachStatusProvider.tsx` | the provider and `useCoachStatus({read})` |
| `RequireCoach.tsx` | the per-screen gate (`allowRetired` on the statements screen only) |
| `keys.ts` | `coachKeys`, `CoachMutation` |
| `api.ts` | `fetchCoachMe`, `coachAcceptPublic()` (R61), `fetchCoachSchedule(from, to)`, `fetchCoachHours`, `setMyCoachHours(venueId, windows)`, `addMyTimeOff(…)`, `cancelMyTimeOff(id)`, `fetchCoachLesson(id)`, `coachBookPrivate(…)`, `coachCreateGroup(…)`, `coachCreateCourse(…)`, `coachAddStudent(…)`, `coachRemoveStudent(…)`, `coachMarkAttendance(…)`, `coachCancelLesson(…)`, `coachCancelCourse(…)`, `coachRescheduleSession(…)`, `fetchMyCoachStatements(month)` |
| `logic.ts` | parsers (key lists from `shapes.ts`, R41); `scheduleSections(lessons, tz)`; `windowsByWeekday`; `splitAcrossMidnight(weekday, start, end)` (CD-10); `windowsOverlap(a, b)`; `toWindowsJson` (DB's `{weekday, start, end}`, §4.3); `weeklyStarts(first, count, tz)`; `snapToGrid(date)` (C-20, R9); `insideCutoff(start, cutoffHours, now)` (R47); `canMarkNow(lesson, now)` (CD-11); `reasonValue(code, note)` (`<code>` or `<code>: <note>`, §1.3); `branchesOff(coach)` (R45) |
| `hooks.ts` | one hook per RPC, each mutation keyed `coachKeys.mutation(…)` |

#### 4.7.3 Query keys and `lib/queryClient.ts`

```ts
export const coachingKeys = {
  all: ['coaching'] as const,
  public: (venueId: string) => ['coaching', 'public', venueId] as const,
  profile: (coachId: string, venueId: string) => ['coaching', 'profile', coachId, venueId] as const,
  slots: (coachId: string, typeId: string, from: string, to: string) =>
    ['coaching', 'slots', coachId, typeId, from, to] as const,
  offer: (kind: 'session' | 'course', id: string) => ['coaching', 'offer', kind, id] as const,
  mine: (scope: LessonScope) => ['coaching', 'mine', scope] as const,
  one: (enrolmentId: string) => ['coaching', 'one', enrolmentId] as const,
  mutation: (name: CoachingMutation) => ['coaching', 'mutation', name] as const,
};
export type CoachingMutation = 'book' | 'join' | 'course' | 'cancel' | 'pay' | 'confirm';

export const coachKeys = {
  all: ['coach'] as const,
  me: (uid: string) => ['coach', 'me', uid] as const,
  schedule: (from: string, to: string) => ['coach', 'schedule', from, to] as const,
  hours: ['coach', 'hours'] as const,
  lesson: (lessonId: string) => ['coach', 'lesson', lessonId] as const,
  statements: (month: string) => ['coach', 'statements', month] as const,
  mutation: (name: CoachMutation) => ['coach', 'mutation', name] as const,
};
export type CoachMutation =
  | 'accept' | 'hours' | 'time_off' | 'time_off_cancel' | 'book' | 'create_group' | 'create_course'
  | 'add_student' | 'remove_student' | 'attendance' | 'cancel_lesson' | 'cancel_course'
  | 'reschedule';
```
`apps/mobile/CLAUDE.md` (Queries) gains both families.

`lib/queryClient.ts`:
- `shouldDehydrateQuery` (`:240-246`) adds `query.queryKey[0] !== 'coaching'` and `!== 'coach'`: a
  roster carries students' phones, a lesson read carries money, and a held enrolment read back from
  disk would be shown before it is re-checked.
- `setMutationDefaults(['coaching', 'mutation'], …)` and `(['coach', 'mutation'], …)` with the
  match values (`:205-208`): `networkMode: 'always'`, `retry: retryKeyedWriteOnce`. Run now or fail
  now (CD-6). One retry is safe because the booking and creation writes are keyed (§4.7.4) and every
  other write is state-idempotent (§4.3 "What Guest needs" item 2).
- `setQueryDefaults(['coaching', 'slots'], …)` with the match-slots value (`:209-211`): fail fast on
  a server without the RPC.
- `clearAllCaches` already wipes both roots on sign-out.

#### 4.7.4 Idempotency (`lib/idempotency.ts`)

```ts
export type LessonMutation =
  | 'book_private' | 'join' | 'course_join'
  | 'coach_book' | 'create_group' | 'create_course' | 'add_student';
export function lessonIdemKey(kind: LessonMutation): string;            // `MOBILE:lesson.<kind>:<ulid>`
export function lessonIntentKey(intent: string, kind: LessonMutation): string;   // memoised per intent
export function clearLessonIntentKey(intent: string): void;
export function clearAllLessonIntentKeys(): void;                        // sign-out, beside clearAllMatchIntentKeys
```

| RPC | Intent | Kept across | Cleared |
| --- | --- | --- | --- |
| `lesson_book_private` | `private:<coachId>\|<typeId>\|<startAt>\|<party>\|<mode>` | `PHONE_REQUIRED`, `TERMS_REQUIRED`, `PRICE_CHANGED` (a refused call created nothing, so the key is unspent), a transport failure | success (booked or held), any other refusal (`IDEMPOTENCY_CONFLICT` included) |
| `lesson_join` | `join:<lessonId>\|<mode>` | as above | as above |
| `course_join` | `course:<courseId>\|<mode>` | as above | as above |
| `coach_book_private` | `coach-book:<typeId>\|<venueId>\|<startAt>\|<party>\|<name>\|<phone>` | transport failure | success, any refusal |
| `coach_create_group` | `group:<typeId>\|<venueId>\|<startAt>` | transport failure | success, any refusal |
| `coach_create_course` | `course-new:<typeId>\|<venueId>\|<starts joined by ,>\|<title_en>\|<title_ar>` | transport failure | success, any refusal |
| `coach_add_student` | `add:<lessonId or courseId>\|<name>\|<phone>` | transport failure | success, any refusal |

- The mutable arguments are in the intent, so a guest who changes the party size or the payment mode
  after a refusal sends a new key: the server's replay of an old key never answers a different
  request. **Amended 2026-10-02 (MB-07):** that holds for coach mode too: the composed phone is in
  `coach-book` and the trimmed titles in `course-new`, so a phone or title edited after a dropped
  connection sends a new key instead of replaying the old request.
- The Qi path spends the booking key on the `held` answer; `lesson-begin` keys itself on the enrolment
  (Money: a live attempt answers with its own ref), so "Try again" needs no client key.
- `features/auth/context.tsx:85` calls `clearAllLessonIntentKeys()` beside `clearAllMatchIntentKeys()`.

#### 4.7.5 Gating: `coachingEnabled` and the branch

- `VenueSettingsPublic` (`features/availability/assemble.ts:67-88`) gains `coaching_enabled?`,
  `lesson_payment_mode?` and `lesson_prices_public?` (optional: a cached row from before 0274 reads as
  switched off). `fetchVenueSettings` already selects `*` (`availability/api.ts:44-47`).
- `Branch` (`features/availability/branch.ts:27-38`) gains `coaching_enabled: boolean`
  (`r.coaching_enabled === true` in `toBranches`); `anyCoaching(branches)` is true when one open branch
  has it on.
- **Guest screens** take the branch from `useGuestVenue()` (DF-1 of open matches: read, never written
  by a deep link), with `BranchPicker` when `showPicker`. A coach at several branches appears at each.
  The coach screen opened from a link uses the coach's own branch for that screen only (§4.8.3).
- **Off at the branch**: `coaches`, `classes` and the Book-tab row do no work; a screen opened anyway
  (a link, a push) renders the off notice (`coaching.common.errors.off`) with "Call {branch}".
- **Off everywhere** (`!anyCoaching(branches)`): Bookings does not call `my_lessons`, and Profile
  hides "My lessons". A guest with lessons at a branch whose switch was turned off later still finds
  them: `lesson/[id]` and `my-lessons` stay reachable from a push or a link and read regardless.
- **Coach mode ignores the switches** (R45, P5): `coach_me` is read on Profile mount and from the
  staff hub whatever `anyCoaching` and the staff status say (§4.13.1), and coach mode shows "Lessons
  are switched off at {branch}" rather than hiding (§4.13.2).
- **Degraded**: `useIsDegraded(venueId)` (`availability/hooks.ts:510`) puts the `DegradedBanner` on
  the coach screen and on `lesson-review`; a `DEGRADED_LOCKOUT` refusal reads `degraded.bookingRefused`
  with the branch phone (§4.10).

### 4.8 Guest screens

All are flat route files on the root stack (`src/navigation/__tests__/routes.test.ts`: only `(tabs)`
and exactly two `_layout.tsx`), each with a `<Stack.Screen>` entry in `app/_layout.tsx` beside the
open-match ones (`:286-292`). Browsing screens (`coaches`, `coach/[id]`, `classes`, `class/[id]`)
have no `RequireSession`: their reads are public. `lesson-review`, `lesson/[id]` and `my-lessons`
wrap in `RequireSession`.

#### 4.8.1 Entry points

**Book tab.** One more row under the court cards, reusing `MatchEntryRow`
(`components/booking.tsx:1708`, a plain label-and-press row) with `testID="book.sheet.lessons"` and the
static label `coaching.guest.entry.book` "Lessons with a coach" / «حصص مع مدرّب», → `/coaches`. Shown
only when `coachingEnabled(settings)` for the sheet's branch. It needs **no query**: the label carries
no count, so the rally's thread gets no new work (the §4.11 performance rules of open matches).
`useAvailabilityBooking` is not touched: `BookingSheet` reads `useLessonEntry(venueId)` itself, and the
grid block's geometry generalises from one row to a count:
- `ENTRIES = (a.matchEntry ? 1 : 0) + (lessonEntry ? 1 : 0)`;
- `scrollEnabled={ENTRIES > 0}` (`BookingSheet.tsx:327`), height `GRID_H + ENTRY_H * ENTRIES`
  (`:642`);
- the lesson row renders after the match row, in the same `Animated.View` wash
  (`rows[SPEC.grid.sharedFromRow]`, `:364-380`), so it adds no interpolation.
A device check with the rally and both rows (§4.17).

**Bookings tab** (`app/(tabs)/bookings.tsx`). A **LESSONS** section on the Upcoming filter, after
OPEN MATCHES: a `ListHeading` with its count, rows `bookings.lesson.<enrolmentId>` (`LessonRow`), and
the link "All my lessons" (`bookings.lessons.all`) → `/my-lessons`. Data: `useMyLessons('upcoming',
{enabled: signedIn && anyCoaching(branches)})`, its own query, so a failed read never turns the
bookings into an error (the match rows' rule, `:133-141`). A held lesson leads the section with
"Finish payment" (its `pending_payment.request_id` → `/pay/status?ref=`); a `confirm_needed` row
reads "Confirm it's you" (§4.8.9 row 0) and opens `/lesson/[id]`, where the confirm card is (C-21).
Past and cancelled lessons
live on `my-lessons`, not in the Played and Cancelled chips: a lesson is not a game, and
`mergeReservationLists` stays as it is. A lesson's court row has `guest_id` NULL, so it never comes
back from `my_reservations` (§1.2) and needs no dedupe.

**Profile** (`app/(tabs)/profile.tsx`, signed-in menu `:287-354`), which reads `coach_me` on mount
(`useCoachStatus({read: true})`, R45):
- `profile.coach-mode` "Coach mode" / «وضع المدرّب», **first** in the menu, shown when the coach
  status is `coach` (active or paused, whatever the coaching switches say) → `/coach-mode`; for a
  `retired` coach the same row reads "Coach statements" / «كشوف حساب المدرّب» →
  `/coach-mode-statements` (C-25);
- `profile.my-lessons` "My lessons" / «حصصي», after `profile.settings`, shown when signed in and
  `anyCoaching(branches)`, → `/my-lessons`.

**Staff hub** (`app/staff.tsx`, C-27, R45). A staff session never sees the tabs (`GuestTabsGate`), so
Profile is out of reach; the hub's account card gains `staff.coach-mode` "Coach mode" (or "Coach
statements" when retired), a `MenuRow` above "Show guest view", shown when the coach status is `coach`
or `retired`, → `/coach-mode` (or `/coach-mode-statements`). The hub reads `coach_me` on mount like
Profile. The coach-mode routes are root-stack screens, outside `(tabs)`, so `GuestTabsGate` never
stands in front of them, and `RequireStaff` is not on them; `StaffStatusProvider` still answers
`staff` and still owns the tabs. A coach-mode tap from a push opens the same screens for a staff phone
(`tapDestination` answers lesson and coach routes whatever the staff status, §4.11).

#### 4.8.2 `app/coaches.tsx` (route `coaches`)

- **Data:** `useCoachingPublic(venueId)` from `useGuestVenue()`.
- **Layout:** `BranchPicker` (`coaches.branch`) when `showPicker`; the row "Group sessions and courses"
  (`coaches.classes`, a `MenuRow`) with `coaching.common.count.withPlaces` ("4 with places") when
  `sessions` is non-empty → `/classes`; the `FlatList` `coaches.list` of `CoachCard`
  (`coaches.row.<coachId>`): photo (`coachPhotoUrl`, a neutral initial when none), display name in the
  locale, the kinds taught ("Private · Group · Courses"), "From {price}" (the lowest offer price, the
  app always shows prices, C-11), → `/coach/[id]` with `venueId`.
- **States:** `SkeletonList` while loading; off → `coaches.off` notice and "Call {branch}"; no coaches
  → `EmptyState` `coaches.empty` "No coaches are taking bookings at this branch yet." / «لا يوجد مدرّبون
  يستقبلون الحجوزات في هذا الفرع بعد.»; `ErrorState` `coaches.error` with retry.
- **Header:** "Coaches" / «المدرّبون».

#### 4.8.3 `app/coach/[id].tsx` (route `coach-detail`)

- **Params:** `id` (coach id; not a uuid → the not-found layout), `venueId?`, `typeId?` (preselects a
  private offer), `date?`.
- **Branch:** `venueId` param, else the guest's branch when `coach.venue_ids` contains it, else the
  coach's first branch. The first read is `coach_profile(id, venueId ?? null)`; a `venue: null` answer
  is followed by the second read with the chosen branch. The choice is for this screen only (never
  written to `tp.venue`); a branch other than the guest's reads "At {branch}".
- **Order:**
  1. **Header card** (not pressable): photo, display name, bio. **Amended 2026-10-08:** the bio shows
     in full; the "More" / "Less" toggle is gone.
  2. **Offers** `coach-detail.offers`, one `OfferCard` each in a sideways-scrolling row (`coach-detail.offer.<lessonTypeId>`):
     name, kind pill, duration, "Up to {people}" (private), "{places} places" (group), "{sessions}"
     (course), price. A private offer selects the grid below; a group or course offer scrolls to the
     sessions. **Amended 2026-10-08:** a private offer's card opens its free times on their own page,
     `app/lesson-times.tsx` (`lesson-times`; params `coachId`, `venueId`, `typeId`, `date?`): the grid
     below and the book bar moved there, ids `lesson-times.*`. It opens only while the coach can be
     booked (not off, paused or the viewer's own page). A group or course offer's card opens the same
     page, which lists that type's upcoming sessions with places (`lesson-times.session.<id>` →
     `/class/[id]`), or "No upcoming dates with places right now." A `typeId` param on the coach page
     opens it once the profile is in. The offers are two rows, "Private lessons"
     (`coach-detail.offers.private`) and "Group lessons" (`coach-detail.offers.group`, group and
     course); a group or course offer shows only while it has an upcoming session with places, and a
     row with no cards is left out.
     **Amended 2026-10-08 (design E):** a private lesson's page is a brand-blue header under a
     transparent bar (avatar, coach, lesson, chips for length, group size and price), then "Pick a
     time": a week of the window with arrows between weeks, its label (`lesson-times.pick-date`)
     opening Edit profile's date wheel (`DateWheelSheet`: Apple's wheel in the native sheet on
     iOS, the system date dialog on Android) for any night in the window, and the night's starts in a sideways row three in view
     (`lesson-times.slot.*`); then "Next 3 days", rows opening to their starts
     (`lesson-times.row-slot.*`). One time is picked across both; the floating navy book bar books
     it.
  3. **Booking grid** (private offers only; on `lesson-times` since 2026-10-08), from `useLessonBooking`:
     - a `SegmentedControl` `coach-detail.type` when the coach has more than one private offer at the
       branch;
     - the day strip of `DayChip`s (`coach-detail.day.<yyyy-mm-dd>`) from `listBookableDates(now, tz,
       13, settings)` (today and 13 more: inside the 14-day cap; the overnight tail adds yesterday as
       on the Book tab, `assemble.ts:115-129`), a chip `closed` when that night has no slot. **Amended
       2026-10-02 (MB-16):** only nights whose whole trading night fits the 14-day window are shown
       (`nightsInWindow`): with an overnight tail (a 16:00–02:00 branch) the last night would end past
       the window and lose its post-midnight starts, so it is dropped rather than shown cut short;
     - one `CourtLaneRow` (`testID="coach-detail.slot"`, so cells are
       `slotTestID('coach-detail.slot', cell)`) whose cells are `lessonCells(slots, night, settings,
       now)`: one `MergedCell` per start in that trading night (`tradingNightOf`,
       `features/matches/logic.ts:1138`), `state: 'free'`, `freeCount 1`, `capacity 1`, `priceIqd`
       = the offer's price, `courtId: null`. `timeFor` formats in the branch zone; `subFor` reads the
       price. Only free starts are cells: the server already crossed the coach's hours with the
       courts, so there is nothing to grey out and no `buildSlotGrid` pass;
     - the line "{price} for the lesson · up to {people}" (C-1: one price for the lesson);
     - no free start in the window: "No free times in the next two weeks. Call {branch} to ask." /
       «لا أوقات متاحة خلال الأسبوعين القادمين. يمكن الاتصال بـ{branch} للاستفسار.».
     A tap on a time (the lane's middle tap) runs the booking gate check later, on `lesson-review`; it
     pushes `/lesson-review` with `coachId`, `lessonTypeId`, `venueId`, `startAt`, `priceIqd`.
     Signed out: §4.9.5.
  4. **Sessions** with places (`coach-detail.session.<id>`, `ClassRow`) → `/class/[id]?kind=`.
  5. **Footer:** "Questions? Call {branch}" (`coach-detail.call-venue`).
- **`useLessonBooking({coachId, venueId, settings, offers})`** returns `{types, typeId, setTypeId,
  dates, night, setNight, cells, gridKey, tz, status}`. The query window is `lessonWindow(now, tz)`:
  from the start of the first strip night, venue-local, to `from + 14 days` exactly; the key is stable
  for a day. `staleTime` 30 s; refetched on focus and after any `COACH_BUSY` / `NO_COURT_FREE`
  refusal. It is a sibling of `useAvailabilityBooking`, which is not parameterised.
- **States:** skeleton; `COACH_NOT_FOUND` (unknown, retired, or not yet public, R61) →
  `coach-detail.not-found` "This coach isn't available." and "See all coaches"; off → the off notice
  (the profile's `off`, or `coach_slots` answering `{off: true}`: `useLessonBooking`'s `off` status,
  checked before `bookable`, so an off branch never reads as a pause; amended 2026-10-02, MB-12);
  paused (`coach.status`, or `coach_slots` `bookable: false`) → "Not taking new bookings right now." /
  «الحجز غير متاح مع هذا المدرّب حاليًا.» and no grid; the viewer is this coach
  (`useCoachStatus()`'s coach id equals `id`) → "This is your coach profile. Guests book you here." /
  «هذه صفحتك كمدرّب، ومنها يحجز الضيوف.» and no grid (R56: no self-booking); `ErrorState`
  `coach-detail.error`. **Amended 2026-10-02 (MB-18):** a signed-in viewer is a `coach_me` reader
  (`useCoachStatus({read: !!session})`), and while it is `pending` the grid is a skeleton, so a coach
  never sees their own grid before `coach_me` says whose page it is; signed out there is nothing to
  wait for.
- **Header:** the coach's name; a share icon (`coach-detail.share`) → React Native `Share` with
  `coachShareUrl(id)` = `${siteUrl()}/c/<id>` and the message "Lessons with {name} at Touch Padel:
  {url}" / «حصص مع {name} في تتش بادل: {url}» (no price). `DegradedBanner` when degraded.

#### 4.8.4 `app/classes.tsx` (route `classes`)

- **Data:** `useCoachingPublic(venueId)` `sessions`, with the coaches and types joined in the parser.
- **Filter:** `SegmentedControl` `classes.filter` with All / Group / Courses
  (`classes.filter.all|group|course`).
- **List** `classes.list`, `ClassRow` `classes.row.<lessonId|courseId>`: kind pill, title (course) or
  type name, coach name, "{weekday} {date} · {time}" (a course: "Starts {date}" or "Next {date} · {n}
  of {total}"), `count.placesLeft`, price, → `/class/[id]` with `kind=session|course`.
- **States:** skeleton, off, empty "No group sessions or courses with places right now." / «لا حصص
  جماعية أو دورات فيها أماكن حاليًا.», error. `BranchPicker` as `coaches`.

#### 4.8.5 `app/class/[id].tsx` (route `class-detail`)

- **Params:** `id`, `kind` (`session` → `lesson_offer(p_lesson_id)`, `course` →
  `lesson_offer(p_course_id)`; anything else → not found).
- **Order:**
  1. **`LessonPoster`** (not pressable): kind, title or type name, the coach (`class-detail.coach` →
     `/coach/[id]`), the day and time in `timezone`, duration, branch; a course lists its sessions
     (`class-detail.session.<n>`), each started session marked "Done".
  2. **Places line:** `count.placesLeft`, and while below the minimum before the cut-off: "Runs if at
     least {people} sign up by {time}. If not, it's cancelled and anything paid online is refunded."
     / «تُقام إذا سجّل {people} على الأقل قبل {time}، وإلا تُلغى ويُعاد ما دُفع إلكترونيًا.» (C-14).
  3. **Price card:** `price_iqd`. A late course join (`late_join` set): "Joining late: {sessionsLeft} of
     {sessions}. You pay {price} for the sessions not yet started (the course price, {full}, split over
     its sessions)." / «انضمام متأخر: {sessionsLeft} من {sessions}. تُدفع {price} عن الحصص التي لم تبدأ
     بعد (سعر الدورة {full} مقسومًا على حصصها).» The numbers are the server's (rule 4); the phone never
     calls `courseLateJoinPrice`.
  4. **`PaymentModeChoice`** `class-detail.mode` (§4.9.1).
  5. **Primary** `class-detail.join`, static label `coaching.guest.class.join` "Join" / «الانضمام»; with
     online mode chosen, `coaching.guest.class.joinAndPay` "Join and pay with Qi Card" / «الانضمام
     والدفع عبر Qi Card». Hidden when `status` is not `open`, with that status's line ("Full", "Sign-up
     has closed", "Cancelled").
  6. `mine` set: "You're booked on this" and "See your booking" (`class-detail.mine` →
     `/lesson/[id]`) in place of the primary. **Amended 2026-10-02 (MB-14):** with
     `mine.confirm_needed` (a coach- or desk-added place from the guest's phone, C-21) it reads "A place
     on this was added with your phone number. Confirm it's you to keep it." / «أُضيف مكان في هذه
     الحصة برقم هاتفك. أكّد أن الحجز لك للاحتفاظ به.» and the button "Confirm it's you"
     (`coaching.guest.bookings.confirm`) opens `/lesson/[id]`, where "Is this you?" waits; never a
     second Join that loops on "already booked".
  7. **Cancel rule line:** a group session: "Free to cancel until {hours} before. After that, online
     payment is kept." / «الإلغاء مجاني حتى {hours} قبل البدء، وبعدها لا يُعاد المبلغ المدفوع
     إلكترونيًا.»; a course (C-23): "Free to leave until {hours} before your next session. Leaving
     later keeps that session's share; the sessions after it are refunded." / «الانسحاب مجاني حتى
     {hours} قبل حصتك التالية، وبعدها لا يُعاد ثمن تلك الحصة ويُعاد ثمن الحصص التي تليها.»
     (`count.hours`).
- **States:** skeleton; `LESSON_NOT_FOUND` → `class-detail.not-found`; `ErrorState`
  `class-detail.error`; `{off: true}` (coaching off at the offer's branch) → `class-detail.off`, the
  off notice and no Join (amended 2026-10-02, MB-12: `LessonOffer.off`). A join refused
  `LESSON_NOT_FOUND` shows `class-detail.not-found` too, even while the old offer is still cached
  (MB-13).

#### 4.8.6 `app/lesson-review.tsx` (route `lesson-review`, `RequireSession`)

- **Params:** `coachId`, `lessonTypeId`, `venueId`, `startAt`, `priceIqd` (a hint; the profile read
  decides).
- **Data:** `useCoachProfile(coachId, venueId)` (the offer, its price, the branch's mode and window),
  `useOwnProfile` (the gate), `useVenueSettings(venueId)` (phone, timezone).
- **Form** (`FormScreen`, native controls):
  1. **Summary card:** coach, lesson type, day and time, duration, branch.
  2. **Party** `PartyStepper` `lesson-review.party` (`.minus`, `.plus`), 1..`max_places`: "Just me",
     "Me + 1", … (`count.people` for the total).
  3. **Friends' names** (optional, one `Field` per extra person, `lesson-review.friend.<n>`,
     `maxLength={40}`): "Friends' names (optional). They help the coach plan." / «أسماء الأصدقاء
     (اختياري)، لمساعدة المدرّب في التحضير.»
  4. **`PaymentModeChoice`** `lesson-review.mode`.
  5. **Price:** "{price} for the lesson" and, desk: "Paid at the desk on the day." / «الدفع عند
     الاستقبال يوم الحصة.»; online: "Paid now by Qi Card." / «الدفع الآن عبر Qi Card.»
  6. **Cancel rule** as `class-detail`.
  7. **Refusal banner** `lesson-review.refusal` when a refusal hides the primary (§4.9.1).
  8. **Primary** `lesson-review.book`, static label `coaching.guest.review.book` "Book the lesson" /
     «حجز الحصة»; online: `coaching.guest.review.bookAndPay` "Book and pay with Qi Card" / «الحجز والدفع
     عبر Qi Card».
- **Header:** "Review" / «مراجعة الحجز»; `DegradedBanner` when degraded.

#### 4.8.7 `app/lesson/[id].tsx` (route `lesson-detail`, `RequireSession`)

- **Params:** `id` (an enrolment). **Data:** `useMyLesson(id)`, refetched on focus and on a lesson
  push (§4.11).
- **`confirm_needed`** (C-21): the screen is the confirm card alone (§4.8.10,
  `lesson-detail.confirm`); nothing below renders until "Yes".
- **Order:**
  1. **`LessonPoster`**: kind, title or type name, the state line (§4.8.9), day and time, duration,
     branch, the court once scheduled ("Court 2"), and while `held` "Finish payment by {time}" /
     «يُرجى إكمال الدفع قبل {time}» (the hold's end as a time, so no counted minutes, U3).
  2. **Coach** row (`lesson-detail.coach` → `/coach/[id]`).
  3. **Party** (private): "{people}" and the friends' names.
  4. **Sessions** (course): rows `lesson-detail.session.<n>` with "Moved" on a rescheduled one and the
     attendance mark on a past one.
  5. **Moved** (R8, `rescheduled` and not started): "This lesson was moved after you booked. You can
     cancel free until it starts." / «نُقلت هذه الحصة بعد حجزك، ويمكن إلغاؤها مجانًا حتى موعد بدئها.»
  6. **Money card:** "{price}", "Paid online {paid}", "To pay at the desk {owed}", and a refund line
     ("{amount} on its way back to your card" / "Refunded {amount}").
  7. **Actions:** `lesson-detail.pay` "Finish payment" / «إكمال الدفع» while `can.pay` (§4.9.3);
     `lesson-detail.cancel` "Cancel the lesson" / «إلغاء الحصة» (a course: "Leave the course" /
     «الانسحاب من الدورة») while `can.cancel` (§4.9.4); `lesson-detail.call-venue` "Call {branch}".
- **States:** skeleton; `ENROLMENT_NOT_FOUND` (also after "Not me") → `lesson-detail.not-found` "This
  booking isn't available."; `ErrorState` `lesson-detail.error`.

#### 4.8.8 `app/my-lessons.tsx` (route `my-lessons`, `RequireSession`; an addition to §1.11)

- `SegmentedControl` Upcoming / Past / Cancelled (`my-lessons.filter.upcoming|past|cancelled`), one
  `useMyLessons(scope)` each; rows `my-lessons.row.<enrolmentId>` (`LessonRow`: coach photo, type,
  day and time, the state line) → `/lesson/[id]`.
- **Is this you?** (C-21, R44): on Upcoming, every `confirm_needed` row renders as a
  `LinkConfirmCard` (§4.8.10, `my-lessons.confirm.<enrolmentId>`) above the list, never as a plain
  row.
- Empty: "No lessons yet." / «لا حصص بعد.» and "Find a coach" (`my-lessons.find` → `/coaches`), or the
  scope's own empty line.
- Why a screen: `my_lessons` has three scopes and the existing history merges only reservations and
  matches; this is the one place past and cancelled lessons are listed, and where C-21's question is
  asked.

#### 4.8.9 Every guest state (`lessonStateOf`, `features/coaching/state.ts`)

The first matching row wins. Counted phrases are `coaching.common.count.*`. A money suffix is a
separate line from the money card, never part of the state.

| # | Condition | State | EN | AR **DRAFT-AR** |
| --- | --- | --- | --- | --- |
| 0 | `confirm_needed` (C-21) | confirmNeeded | Added by a coach · confirm it's you | حجز أضافه مدرّب · يلزم تأكيد أنه لك |
| 1 | `held`, hold live | awaitingPayment | Payment in progress · finish by {time} | الدفع قيد الإتمام · قبل {time} |
| 2 | `held`, hold lapsed (the sweep has not run yet) | paymentLapsing | Payment window ended | انتهت مهلة الدفع |
| 3 | `booked`, group or course, before the cut-off, `places_taken < min_places` | needsMore | Booked · runs if {people} sign up by {time} | محجوز · تُقام إذا سجّل {people} قبل {time} |
| 4 | `booked`, course, a session started | courseRunning | Course · next: session {n} of {total} | دورة · الحصة التالية {n} من {total} |
| 5 | `booked`, `rescheduled`, before `start_at` (R8) | moved | Booked · moved to {time} | محجوز · نُقلت إلى {time} |
| 6 | `booked`, before `start_at` | booked | Booked | محجوز |
| 7 | attendance `attended` | attended | Attended | حضور مسجّل |
| 8 | attendance `no_show` | noShow | Marked as not attended | سُجّل غياب |
| 9 | `booked`, lesson `completed`, unmarked | done | Done | انتهت |
| 10 | `booked`, between start and end | now | On now | جارية الآن |
| 11 | `cancelled`, `guest_free` or `guest_late`, a course (C-23) | leftCourse | You left the course | انسحبت من الدورة |
| 12 | `cancelled`, `guest_free` | cancelledFree | You cancelled · free | أُلغيت بطلبك · مجانًا |
| 13 | `cancelled`, `guest_late` | cancelledLate | You cancelled late | أُلغيت بطلبك متأخرًا |
| 14 | `cancelled`, `coach` | cancelledByCoach | Cancelled by the coach | أُلغيت من قِبل المدرّب |
| 15 | `cancelled`, `staff` | cancelledByVenue | Cancelled by the venue | ألغاها النادي |
| 16 | `cancelled`, `under_filled` | underFilled | Cancelled · not enough people signed up | أُلغيت لعدم اكتمال الحد الأدنى |
| 17 | `cancelled`, `course_cancelled` | courseCancelled | The course was cancelled · remaining sessions refunded | أُلغيت الدورة · يُعاد ثمن الحصص المتبقية |
| 18 | `expired` | paymentExpired | Payment not completed · place released | لم يكتمل الدفع · أُلغي حجز المكان |
| 19 | anything else | unknown | Lesson | حصة |

Rows 5 and 6 carry the desk line under them: "Pay {owed} at the desk" / «{owed} عند الاستقبال»; online:
"Paid online" / «مدفوعة إلكترونيًا». Rows 11–17 add the money line from `refund` and `kept_iqd`:
"{amount} refunded to your card" / «يُعاد {amount} إلى بطاقتك» and, when something was kept, "{kept}
kept" / «لا يُعاد {kept}».

#### 4.8.10 The link confirm (C-21, R44)

`LinkConfirmCard` (`src/components/coaching.tsx`, required `testID`, forwarding `.yes` and `.no`) on
`my-lessons` (`my-lessons.confirm.<enrolmentId>`) and as the whole of `lesson-detail` for that
enrolment (`lesson-detail.confirm`):
- Body: coach-booked "A coach added you to a lesson. Is this you?" / «أضاف مدرّب رقم هاتفك إلى حصة.
  هل هذا الحجز لك؟»; desk-booked (`booked_by: staff`) "The front desk added you to a lesson. Is this
  you?" / «أضاف الاستقبال رقم هاتفك إلى حصة. هل هذا الحجز لك؟». Under it: the coach's display name,
  the lesson type, day and time, and branch. Never the name the coach typed, and no money.
- `.yes` "Yes, it's me" / «نعم، الحجز لي» → `lesson_link_confirm(id, true)`; success: toast "Added to
  your lessons." / «أُضيفت إلى حصصك.», invalidate `coachingKeys.all`; the row becomes a normal booking
  (reminders start, §4.5.3).
- `.no` "Not me" / «ليس لي» → `ConfirmAlert` "Remove this lesson from your account? Nobody is told."
  / «إزالة هذه الحصة من حسابك؟ لن يُبلَّغ أحد.» → `lesson_link_confirm(id, false)`; success or
  `ENROLMENT_NOT_FOUND`: toast "Removed." / «أُزيلت.», invalidate, and `lesson-detail` goes back.
- Mutation key `coachingKeys.mutation('confirm')`; state-idempotent, no idempotency key.

### 4.9 Flows

#### 4.9.1 Private lesson: grid → review → book → desk or Qi → the lesson

1. **Grid** (§4.8.3): a time → `/lesson-review`.
2. **Gate** on `lesson-review`'s primary, before the call: `bookingGateState(profile, session.user)`
   (`features/auth/social.ts:208`): `incomplete` → `/complete-profile?returnTo=back`; `unverified` →
   `/phone-sign-in?returnTo=back&phone=` (back mode, as Review and the match screens,
   `app/review.tsx:94-100`). The rule of `apps/mobile/CLAUDE.md` is "every intent that ends in a court
   booking"; a private lesson takes a court, and group and course joins take the same gate because the
   coach must be able to call the student (C-16), and `lesson_guest(true)` refuses `PHONE_REQUIRED`
   anyway.
3. **Mode** (`PaymentModeChoice`, from the branch's `payment_mode`): `desk` → no choice, desk;
   `online_optional` → a `SegmentedControl` "Pay at the desk" / "Pay now with Qi Card" («الدفع عند
   الاستقبال» / «الدفع الآن عبر Qi Card»), desk preselected; `online_required` → no choice, online.
   An online mode exists only once the lessons terms are live (C-26: `set_coaching_settings` refuses
   it before `platform_settings.lesson_terms_version` is set).
4. **Call:** `lesson_book_private(p_coach_id, p_lesson_type_id, p_start_at, p_party_size,
   p_friend_names (trimmed, empty ones dropped), p_payment_mode, p_expected_price_iqd => the offer's
   price_iqd, p_idempotency_key => lessonIntentKey(privateIntent(…), 'book_private'))`.
5. **Desk answer** (`status: 'booked'`): clear the key; invalidate `coachingKeys.all` and
   `['availability']`; `router.replace('/lesson/[id]', {id: enrolment_id})`; toast "Booked. Pay at the
   desk on the day." / «تم الحجز، والدفع عند الاستقبال يوم الحصة.»
6. **Online answer** (`status: 'held'`): clear the key; `useStartLessonPayment().start(enrolment_id)`
   (§4.9.3). If `lesson-begin` refuses, the enrolment is still held: toast the refusal and
   `router.replace('/lesson/[id]')`, whose "Finish payment" tries again.
7. **Refusals** (exactly what `lesson_book_private` raises, db §4.7.3, R52):

| Code | Behaviour | Key |
| --- | --- | --- |
| `PHONE_REQUIRED` | `/complete-profile?returnTo=back` | kept |
| `TERMS_REQUIRED` | the terms gate (§4.9.6) | kept |
| `PRICE_CHANGED` | the detail's `current_iqd`; inline "The price is now {price}. Check it and book again."; the profile refetched | kept |
| `COACH_BUSY`, `NO_COURT_FREE`, `COACH_UNAVAILABLE`, `SLOT_IN_PAST`, `BEYOND_HORIZON`, `SLOT_NOT_ON_GRID`, `CLOSED_DATE`, `OUTSIDE_HOURS` | toast, invalidate the slots, `router.back()` to the grid | cleared |
| `PARTY_TOO_LARGE` | inline under the stepper, stepper clamped to the detail (the maximum) | cleared |
| `ONLINE_PAYMENT_REQUIRED`, `ONLINE_PAYMENT_OFF` | refetch the branch settings; the choice re-renders with the server's mode; inline line | cleared |
| `COACHING_OFF`, `COACH_INACTIVE`, `COACH_NOT_FOUND`, `COACH_NOT_AT_BRANCH`, `LESSON_TYPE_INACTIVE`, `LESSON_TYPE_NOT_OFFERED`, `LESSON_TYPE_NOT_FOUND` | the refusal banner, primary hidden | cleared |
| `ALREADY_ENROLLED` detail `coach` (R56) | the refusal banner ("You're the coach of this lesson…"), primary hidden | cleared |
| `DEGRADED_LOCKOUT` | `degraded.bookingRefused` with the branch phone | cleared |
| `HOLD_COOLDOWN`, `BOOKING_SUSPENDED` | `errors.generic` (owner's decision, `GENERIC_BY_DECISION`, `packages/i18n/src/errors.ts:596`) | cleared |
| `HOLD_QUOTA_EXCEEDED` (online only, R30) | its catalogue line, inline; desk mode stays offered | cleared |
| `IDEMPOTENCY_CONFLICT`, `INVALID_ARGUMENT`, `ACCOUNT_REQUIRED`, `AUTH_REQUIRED` | inline, `lessonErrorText` (the catalogue's line) | cleared |

#### 4.9.2 Group session or course: offer → join

1. `class/[id]` reads `lesson_offer`; the guest picks the mode; the gate as above.
2. Call `lesson_join(p_lesson_id, p_payment_mode, p_expected_price_iqd => offer.price_iqd,
   p_idempotency_key)` or `course_join(p_course_id, …)`; the key's kind is `join` / `course_join`.
3. Desk → `/lesson/[id]` and toast; online → §4.9.3.
4. Refusals (db §4.7.3): `PHONE_REQUIRED`, `TERMS_REQUIRED`, the payment modes, `HOLD_COOLDOWN`,
   `BOOKING_SUSPENDED`, `HOLD_QUOTA_EXCEEDED`, `COACHING_OFF`, `DEGRADED_LOCKOUT` (R15) and the
   catch-all as §4.9.1, plus:
   `LESSON_NOT_FOUND` → the not-found layout; `LESSON_FULL`, `LESSON_CLOSED` → refetch the offer, its
   status line replaces the primary (cleared); `ALREADY_ENROLLED` → refetch, `mine` shows "See your
   booking" (cleared); `ALREADY_ENROLLED` detail `coach` → the banner "You're the coach of this
   lesson…" (R56, cleared); `PRICE_CHANGED` here usually means a course session started between the
   read and the tap: the detail's `current_iqd`, inline "The price is now {price}, for the sessions
   left." (kept). A join takes no court, so no slot code reaches it.

#### 4.9.3 Qi: `lesson-begin` → the pointer → `pay/status` → the lesson

- **Edge client** (`features/deposit/api.ts:34`): `DepositEdgeFunction` gains `'lesson-begin'`;
  `lessonBegin(client, {enrolmentId, locale})` goes through `invokeDepositEdge`, so a refusal is a
  `DepositEdgeError` whose message is the code.
- **`useStartLessonPayment()`** (`features/coaching/payment.ts`), the `useStartTicketPurchase` shape
  (`features/matches/tickets.ts:67-104`): `lesson-begin` → `savePendingPayment(uid, {ref,
  reservationId: '', deadlineAt, purpose: 'lesson', lessonEnrolmentId})` → `claimResume(ref)` →
  `router.replace('/pay/status', {ref})` → `openPaymentPage(form_url)`. Mutation key
  `coachingKeys.mutation('pay')`. Used by `lesson-review`, `class-detail` and `lesson-detail.pay`.
- **The pointer** (`features/deposit/pendingPayment.ts`): `purpose` (`:35`) becomes the shared
  `PaymentPurpose` (`deposit/logic.ts:66`), which gains `'lesson'`; `PendingPayment` gains
  `lessonEnrolmentId?: string`; `serializePendingPayment` writes both for a lesson; `parsePendingPayment`
  keeps accepting every older pointer. Same key `tp.pendingPayment.<uid>`, same SEC-16 purge: no new
  storage key.
- **Resume paths** (`isResumeSafePath`, `:167`): `NOT_RESTING` gains `/lesson-review`, and any path
  starting `/coach-mode` returns false (coach mode is a working area, like `/staff`). A resume from
  anywhere else opens `/pay/status`, as for a deposit (`usePendingPaymentResume`,
  `deposit/hooks.ts:247`, unchanged).
- **`pay/status`** (`app/pay/status.tsx`): `parseDepositStatus` (`logic.ts:212`) reads `purpose:
  'lesson'` and `lesson{…}`; new `isLessonPayment(s)` beside `isTicketPayment` (`:254`); `screenFor`
  branches on it before its switch, into `lessonScreenFor`:

| Server status | Screen (`pay-status.state.<kind>`) | Actions |
| --- | --- | --- |
| `created`, `pending` | `checking` / `stillChecking` | open again, leave |
| `succeeded` | new **`lessonBooked`** "You're booked" / «تم الحجز» with "Paid online by Qi Card." | `pay-status.view-lesson` → `router.replace('/lesson/[id]', {id: pointer.lessonEnrolmentId ?? status.lesson.enrolment_id})` |
| `failed` | `failed` with `holdLive: status.holdLive`, `canRetry: holdLive && attemptsLeft > 0`, `canPayAtDesk: false`, `outOfAttempts` | `pay-status.try-again` (a new `lesson-begin` for the same enrolment), `pay-status.back` |
| `expired` | `expired` with the lesson line "Payment window ended. No money was taken, and your place was released." | `pay-status.back` |
| `refund_pending` | `refundPending` with `coaching.guest.pay.refundPending` "The payment came after your place was released, so it's on its way back to your card." (never `slotLost`) | `pay-status.view-lesson` |
| `refunded`, `refund_failed` | the existing screens | `pay-status.view-lesson` |

  - `PayScreen` gains `{kind: 'lessonBooked'; enrolmentId: string}`; `isTerminalScreen` treats it as
    terminal; the exhaustive switch keeps compiling.
  - The summary card shows "{type} · {coach}", the day and time, and "Paying now {amount}".
  - The deposit-only effects (`confirmed → /success`, `payAtDesk`, `chooseAnotherTime`) do not run for
    a lesson.
  - `useRefreshAfterPayment` (`deposit/hooks.ts:168-176`) also invalidates `coachingKeys.all`.
- **Lesson detail while held:** "Finish payment" calls `useStartLessonPayment` again; Money answers
  the live attempt with its own ref (`reused: true`), so the guest returns to the same page.
- **`lesson-begin` refusals** (X33, mo §6.7): `PHONE_REQUIRED` → `/complete-profile?returnTo=back`,
  as the booking refusal; `LESSON_NOT_PAYABLE` → its detail's line (`booked`, `cancelled`, `expired`,
  `desk`, `free`, §4.10) and a refetch of `my_lesson`; `ONLINE_PAYMENT_OFF`, `COACHING_OFF` → their
  lines and "Call {branch}"; `DEGRADED_LOCKOUT` → `degraded.bookingRefused`; `TOO_MANY_ATTEMPTS`,
  `PROVIDER_UNAVAILABLE`, `RETRY_LATER` → the deposit lines (`deposit.errors.*`); `AUTH_REQUIRED`,
  `ACCOUNT_REQUIRED`, `ENROLMENT_NOT_FOUND`, `BAD_REQUEST`, `INVALID_ARGUMENT` → the catalogue's line.

#### 4.9.4 Cancel

`lesson-detail.cancel` opens a `ConfirmAlert` (`components/overlays.tsx:182`) built from
`my_lesson.cancel`:

A private lesson or a group session:

| `cancel` | Body EN | Body AR **DRAFT-AR** |
| --- | --- | --- |
| `free` | Cancel this lesson? It's free to cancel until {time}. {refund} | إلغاء هذه الحصة؟ الإلغاء مجاني حتى {time}. {refund} |
| `free`, `free_because: rescheduled` (R8) | Cancel this lesson? It was moved after you booked, so it's free to cancel until it starts. {refund} | إلغاء هذه الحصة؟ نُقلت بعد حجزك، فالإلغاء مجاني حتى موعد بدئها. {refund} |
| `free`, the place `held` (MB-11) | Cancel this lesson? Nothing has been paid yet, so it's free to cancel. | إلغاء هذه الحصة؟ لم يُدفع شيء بعد، فالإلغاء مجاني. |
| `free`, no `free_until` (MB-11) | Cancel this lesson? It's free to cancel. {refund} | إلغاء هذه الحصة؟ الإلغاء مجاني. {refund} |
| `late`, `counts_late` | It's less than {hours} before the lesson. If you cancel now, {kept} paid online is kept, and it counts as a late cancellation. | بقي أقل من {hours} على الحصة. عند الإلغاء الآن لا يُعاد {kept} المدفوع إلكترونيًا، ويُحسب إلغاءً متأخرًا. |
| `late`, not `counts_late` | It's less than {hours} before the lesson. If you cancel now, {kept} paid online is kept. | بقي أقل من {hours} على الحصة. عند الإلغاء الآن لا يُعاد {kept} المدفوع إلكترونيًا. |

A course (C-23, R62; every figure is the server's preview, `my_lesson.cancel`):

| `cancel` | Body EN | Body AR **DRAFT-AR** |
| --- | --- | --- |
| `free` | Leave the course? Your place on every session you haven't had is cancelled. {refund} | الانسحاب من الدورة؟ يُلغى مكانك في كل حصة لم تحضرها بعد. {refund} |
| `late`, with `kept_sessions` | Leave the course? Your next session, {when}, is less than {hours} away. Its share ({kept}) is kept{late}. The {refundSessions} after it are cancelled. {refund} | الانسحاب من الدورة؟ بقي أقل من {hours} على حصتك التالية ({when}). لا يُعاد نصيبها ({kept}){late}. وتُلغى {refundSessions} بعدها. {refund} |

**Amended 2026-10-02 (MB-15):** the course's late body is built sentence by sentence, each only when
it has something to say: the share sentence only when `kept_iqd > 0` (with nothing kept and
`counts_late`, "Leaving now counts as a late cancellation." / «الانسحاب الآن يُحسب إلغاءً متأخرًا.»
instead), the "after it are cancelled" sentence only when `refund_sessions > 0`, and `{refund}` as its
own sentence. It never reads "its share (IQD 0) is kept" and never ends on a colon.

- `{refund}` = "{amount} paid online goes back to your card." / «يُعاد {amount} المدفوع إلكترونيًا إلى
  بطاقتك.» when `refund_iqd > 0`, else ''. A late cancel with nothing paid online drops the money clause
  ("If you cancel now, it counts as a late cancellation."). `{late}` = ", and it counts as a late
  cancellation" / «، ويُحسب إلغاءً متأخرًا» when `counts_late`, else ''. `{when}` is `next_start_at`;
  `{refundSessions}` is `count.sessions` of `refund_sessions`.
- Buttons: "Cancel the lesson" / "Leave the course" (destructive) and "Keep it" («الإبقاء عليها»).
- Call `lesson_cancel_mine(p_enrolment_id)` (state-idempotent, no key). Success: toast from the answer
  ("Cancelled. {amount} is on its way back to your card." or "Cancelled."), refetch `my_lesson`,
  `my_lessons`, the offer. `LESSON_NOT_CANCELLABLE` → its detail's line (§4.10) and "Call {branch}";
  `ENROLMENT_NOT_FOUND` → refetch.
- The server decides free or late at the moment of the call; if the window passed while the dialog was
  open, the answer's `cancel_kind` and amounts say so and the toast follows them.
- **Amended 2026-10-02 (MB-11):** a `held` place never reads "free to cancel until {time}": nothing
  has been paid, so it reads the `held` row above. When `lesson-begin` refuses a held place with
  `ONLINE_PAYMENT_OFF` or `COACHING_OFF` (Finish payment on the lesson, Try again on the payment
  screen), the line is `coaching.common.errors.heldOff` ("This place can't be paid online right now.
  Nothing has been paid yet, so you can cancel it for free." / «تعذّر الدفع الإلكتروني لهذا المكان
  الآن. لم يُدفع شيء بعد، فيمكن إلغاؤه مجانًا.»), never "pay at the desk", and the lesson screen opens
  the cancel dialog when `can.cancel`.

#### 4.9.6 The terms gate (C-26, R50)

`lesson_guest(true)` refuses `TERMS_REQUIRED` on the online paths (`p_payment_mode = 'online'`) when
the caller's accepted terms are older than `platform_settings.lesson_terms_version`, as open matches
use it (`match_terms_ok`, 0257:157). The phone:
- `needsTermsAcceptance(profile)` (`packages/core/src/legal/terms.ts:31`) true → `/accept-terms`
  (the consent screen records `CURRENT_TERMS_VERSION`, which G7 bumps to the lessons version), then
  back to the form with the key kept;
- false (this build's terms are older than the server's) → `coaching.common.errors.updateApp`, and,
  when the branch is `online_optional`, "Pay at the desk instead" switches the choice to desk (desk
  paths need no lessons terms).

#### 4.9.5 Signed out

Browsing needs no account. A signed-out tap on a time or on "Join" sets the in-memory
`pendingLesson` (`features/coaching/pendingLesson.ts`, a copy of the `pendingJoin` store, never
persisted):
```ts
type PendingLesson =
  | { kind: 'private'; coachId: string; lessonTypeId: string; venueId: string; startAt: string;
      priceIqd: number | null }
  | { kind: 'class'; classKind: 'session' | 'course'; id: string };
```
then pushes `/welcome`. `features/booking/pendingIntent.ts` reads three stores (`hasPendingIntent`,
`usePendingIntent`, `clearPendingIntents`); `continueAfterAuth`
(`features/booking/usePostAuthContinue.ts`) takes `pendingLesson` after `pendingJoin`: `private` →
`/lesson-review?…`, `class` → `/class/[id]?kind=`. Signing in never books by itself (the open-matches
GD-2 rule): the guest sees the review and taps once. The welcome banner reads "Sign in to book the
lesson" / «تسجيل الدخول لحجز الحصة».
**Amended 2026-10-02 (MB-04):** one intent at a time. Every set site (the coach grid, Join, the
court grid's slot, the open-match link, chip and list) goes through `setOnlyPendingSlot`,
`setOnlyPendingJoin` or `setOnlyPendingLesson` (`pendingIntent.ts`), each clearing the other two, so an
old slot or match intent never outranks a newer lesson tap; `pendingSlot` now lives 30 minutes like
the other two.

### 4.10 Errors

**The catalogue** (`packages/i18n/src/errors.ts`). Each §1.10 code gets its `ERROR_CODE_KEYS` entry in
the commit whose SQL first raises it (the open-matches R11 rule), so `check-error-codes` stays green
commit by commit. Codes a desk can also meet point at the operator's `op.errors.<CODE>` line
(`opErrors.coaching`, lane Operator); `LESSON_NOT_PAYABLE` is one (the desk's `lesson_settle`, mo
§5), and the phone overrides it below. The one code no staff screen meets points straight at this
lane's line (the `matches.errors.*` precedent, `errors.ts:414-436`): `NOT_A_COACH` →
`coaching.common.errors.notCoach`.

**The phone's lines** (`MOBILE_OVERRIDES`, `apps/mobile/src/features/booking/errors.ts:25`), one
literal entry per code a guest or a coach can meet, and only those (R52: each is raised by a body in
db §4.6–§4.7 or mo §6.7 that the phone calls), keys `coaching.common.errors.<name>`:

| Code | Key | EN | AR **DRAFT-AR** |
| --- | --- | --- | --- |
| `COACHING_OFF` | off | Lessons aren't bookable in the app at this branch right now. | حجز الحصص غير متاح في التطبيق في هذا الفرع حاليًا. |
| `COACH_NOT_FOUND` | coachNotFound | This coach isn't available. | هذا المدرّب غير متاح. |
| `COACH_INACTIVE` | coachInactive | This coach isn't taking new bookings right now. | الحجز غير متاح مع هذا المدرّب حاليًا. |
| `COACH_NOT_AT_BRANCH` | coachNotAtBranch | This coach doesn't teach at this branch. | حصص هذا المدرّب غير متاحة في هذا الفرع. |
| `LESSON_TYPE_NOT_FOUND` | typeNotFound | This lesson isn't offered any more. | لم تعد هذه الحصة متاحة. |
| `LESSON_TYPE_INACTIVE` | typeInactive | This lesson isn't offered right now. | هذه الحصة غير متاحة حاليًا. |
| `LESSON_TYPE_NOT_OFFERED` | typeNotOffered | This coach doesn't teach this lesson. | هذا النوع من الحصص غير متاح مع هذا المدرّب. |
| `COACH_UNAVAILABLE` | coachUnavailable | The coach isn't available at that time. Pick another time. | المدرّب غير متاح في هذا الوقت. يُرجى اختيار وقت آخر. |
| `COACH_BUSY` | coachBusy | The coach already has a lesson then. Pick another time. | لدى المدرّب حصة أخرى في هذا الوقت. يُرجى اختيار وقت آخر. |
| `NO_COURT_FREE` | noCourt | No court is free at that time. Pick another time. | لا يوجد ملعب متاح في هذا الوقت. يُرجى اختيار وقت آخر. |
| `SLOT_NOT_ON_GRID` | notOnGrid | Lessons start on the hour or at half past. | تبدأ الحصص عند رأس الساعة أو نصفها. |
| `PARTY_TOO_LARGE` | partyTooLarge | That's more people than this lesson takes. | العدد أكبر مما تتسع له هذه الحصة. |
| `LESSON_FULL` | full | This is full. | اكتمل العدد. |
| `LESSON_CLOSED` | closed | Sign-up has closed. | أُغلق التسجيل. |
| `ALREADY_ENROLLED` | alreadyEnrolled | You're already booked on this. | لديك حجز فيها بالفعل. |
| `LESSON_NOT_FOUND` | notFound | This lesson isn't available. | هذه الحصة غير متاحة. |
| `ENROLMENT_NOT_FOUND` | enrolmentNotFound | We couldn't find this booking. Please refresh. | تعذّر العثور على هذا الحجز. يُرجى التحديث. |
| `LESSON_NOT_CANCELLABLE` | notCancellable | This can't be cancelled in the app any more. Please call the front desk. | لم يعد الإلغاء ممكنًا من التطبيق. يُرجى الاتصال بالاستقبال. |
| `LESSON_NOT_PAYABLE` | notPayable | This booking can't be paid online any more. | لم يعد الدفع الإلكتروني متاحًا لهذا الحجز. |
| `ONLINE_PAYMENT_REQUIRED` | onlineRequired | Lessons at this branch are paid online by Qi Card. | تُدفع الحصص في هذا الفرع إلكترونيًا عبر Qi Card. |
| `ONLINE_PAYMENT_OFF` | onlineOff | Online payment is off at this branch. You can pay at the desk. | الدفع الإلكتروني متوقف في هذا الفرع، ويمكن الدفع عند الاستقبال. |
| `NOT_A_COACH` | notCoach | Coach mode isn't available for this account. | وضع المدرّب غير متاح لهذا الحساب. |
| `HOURS_INVALID` | hoursInvalid | Check the times: each one must end after it starts, and by midnight. | يُرجى التحقق من الأوقات: يجب أن ينتهي كل وقت بعد بدايته، وفي منتصف الليل كحد أقصى. |
| `HOURS_OVERLAP` | hoursOverlap | These hours overlap hours you already have, here or at another branch. | تتداخل هذه الأوقات مع أوقات مسجّلة لديك، هنا أو في فرع آخر. |
| `TIME_OFF_HAS_LESSONS` | timeOffHasLessons | You have lessons booked in that time. Cancel or move them first. | لديك حصص محجوزة في هذه المدة، ويلزم إلغاؤها أو نقلها أولًا. |
| `COURSE_STARTS_INVALID` | courseStartsInvalid | Check the session times: one for each session, in order, and in the future. | يُرجى التحقق من مواعيد الحصص: موعد لكل حصة، بالترتيب، وفي المستقبل. |
| `SESSION_NOT_MOVABLE` | sessionNotMovable | This lesson has started or ended, so it can't be moved. | بدأت هذه الحصة أو انتهت، فلا يمكن نقلها. |
| `COACH_ADD_LIMIT` | addLimit | You've added as many students as you can today. The front desk can add more. | بلغت الحد اليومي لإضافة المتدرّبين، ويمكن للاستقبال إضافة المزيد. |

**Details** (R52, X31: every detail a screen meets has its own sentence in both catalogs; the
detail is read with `rpcErrorDetail`, and an unknown detail falls back to the code's line above):

| Code · detail | Raised by | Key | EN | AR **DRAFT-AR** |
| --- | --- | --- | --- | --- |
| `ALREADY_ENROLLED` · `coach` | guest booking and joining (R56, C-24) | alreadyEnrolledCoach | You're the coach of this lesson, so you can't book a place in it. | هذه الحصة من تدريبك، فلا يمكن حجز مكان فيها. |
| `COACH_ADD_LIMIT` · `live` | `coach_book_private` (R56) | addLimitLive | You already have {cap} upcoming lessons booked for students, the most you can hold. The front desk can book more. | لديك {cap} حصص قادمة محجوزة للمتدرّبين، وهو الحد الأقصى، ويمكن للاستقبال حجز المزيد. |
| `COACH_ADD_LIMIT` · any other (the daily cap, CD-9) | `coach_book_private`, `coach_add_student` | addLimit | (the line above) | |
| `LESSON_CLOSED` · `cutoff` | coach creation and reschedule (R47) | closedCutoff | That's inside the sign-up cut-off, so guests couldn't join in time. Pick a later time. | هذا الوقت داخل مهلة إغلاق التسجيل، فلن يتمكن الضيوف من الانضمام في الوقت المناسب. يُرجى اختيار وقت لاحق. |
| `LESSON_NOT_CANCELLABLE` · `private` | `coach_remove_student` | notCancellablePrivate | This is a private lesson: cancel the lesson instead. | هذه حصة خاصة، ويمكن إلغاء الحصة نفسها بدلًا من ذلك. |
| `LESSON_NOT_CANCELLABLE` · `course_session` | `coach_cancel_lesson` (C-19) | notCancellableSession | A course session can't be cancelled on its own. Move it, or cancel the course. | لا يمكن إلغاء حصة من دورة وحدها، ويمكن نقلها أو إلغاء الدورة. |
| `LESSON_NOT_CANCELLABLE` · `started`, `status`, `ended` | guest and coach cancels | notCancellable | (the line above) | |
| `SESSION_NOT_MOVABLE` · `order` | `coach_reschedule_session` | notMovableOrder | Sessions keep their order: this time is before the previous session or after the next one. | تبقى الحصص بترتيبها، وهذا الوقت قبل الحصة السابقة أو بعد التالية. |
| `SESSION_NOT_MOVABLE` · `started`, `ended` | `coach_reschedule_session` | sessionNotMovable | This lesson has started or ended, so it can't be moved. | بدأت هذه الحصة أو انتهت، فلا يمكن نقلها. |
| `INVALID_TRANSITION` · `held` | `coach_reschedule_session` (R32) | heldNotMovable | This lesson is waiting for an online payment. Try again once it's paid or released. | هذه الحصة بانتظار دفع إلكتروني، ويمكن المحاولة بعد إتمامه أو إلغائه. |
| `INVALID_TRANSITION` · `not_started` | `coach_mark_attendance` | markNotStarted | Attendance can be marked once the lesson starts. | يُسجَّل الحضور بعد بدء الحصة. |
| `INVALID_TRANSITION` · `marks_closed` | `coach_mark_attendance` (CD-11) | marksClosed | Attendance can't be changed more than 24 hours after the start. | لا يمكن تعديل الحضور بعد مرور 24 ساعة على البدء. |
| `INVALID_TRANSITION` · `not_booked` | `coach_mark_attendance` | markNotBooked | This booking isn't confirmed yet. | هذا الحجز غير مؤكد بعد. |
| `INVALID_TRANSITION` · `cancelled` | `coach_mark_attendance` | markCancelled | This lesson was cancelled. | أُلغيت هذه الحصة. |
| `COURSE_STARTS_INVALID` · `count` | `coach_create_course` | startsCount | Add one time for each session. | يلزم موعد لكل حصة. |
| `COURSE_STARTS_INVALID` · `order` | `coach_create_course` | startsOrder | Put the sessions in order, each ending before the next one starts. | يلزم ترتيب الحصص بحيث تنتهي كل حصة قبل بدء التالية. |
| `COURSE_STARTS_INVALID` · `span` | `coach_create_course` | startsSpan | A course can run for a year at most. | لا تتجاوز مدة الدورة سنة واحدة. |
| `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `COACH_UNAVAILABLE`, `COACH_BUSY`, `NO_COURT_FREE` · `<i>` | `coach_create_course` (per start, 1-based) | sessionPrefix | Session {n}: {line} | الحصة {n}: {line} |
| `HOURS_INVALID` · `<i>` or `p_windows` | `set_my_coach_hours` | hoursInvalid, on window `i` | (the line above) | |
| `HOURS_OVERLAP` · `<i>` or `<i>:<weekday>` | `set_my_coach_hours` | hoursOverlap, on window `i` | (the line above) | |
| `HOURS_OVERLAP` · `time_off` | `add_my_time_off` | timeOffOverlap | This overlaps time off you already have. | تتداخل هذه المدة مع إجازة مسجّلة لديك. |
| `TIME_OFF_HAS_LESSONS` · `<count>` | `add_my_time_off` | timeOffHasLessons | You have {lessons} booked in that time. Cancel or move them first. | لديك {lessons} محجوزة في هذه المدة، ويلزم إلغاؤها أو نقلها أولًا. |
| `PARTY_TOO_LARGE` · `<max>` | `lesson_book_private`, `coach_book_private` | partyTooLarge | This lesson takes up to {people}. | تتسع هذه الحصة لـ{people} كحد أقصى. |
| `PRICE_CHANGED` · `{quoted_iqd, current_iqd}` | guest booking and joining | priceChangedTo | The price is now {price}. Check it and try again. | أصبح السعر {price}. يُرجى التحقق منه والمحاولة مجددًا. |
| `LESSON_NOT_PAYABLE` · `booked` | `lesson-begin` | notPayableBooked | This booking is already confirmed. | هذا الحجز مؤكد بالفعل. |
| `LESSON_NOT_PAYABLE` · `desk` | `lesson-begin` | notPayableDesk | This booking is paid at the desk. | يُدفع هذا الحجز عند الاستقبال. |
| `LESSON_NOT_PAYABLE` · `free` | `lesson-begin` | notPayableFree | There's nothing to pay online for this booking. | لا يوجد مبلغ للدفع الإلكتروني لهذا الحجز. |
| `LESSON_NOT_PAYABLE` · `cancelled`, `expired` | `lesson-begin` | notPayable | (the line above) | |

Codes the phone cannot meet (`ALREADY_COACH`, `LESSON_VIA_COACHING`, `LESSON_OWED_CHANGED`,
`LESSON_TAB_NO_GOODS`, `PRICE_VIA_PROTOCOL`, `LAUNCH_VIA_PROTOCOL`, `STATEMENT_*`,
`PIN_GRANT_REQUIRED`, `BRANCH_HAS_BOOKINGS`, `NOT_STEP_ACTOR`, `PRICE_TARGET_CHANGED`, `FORBIDDEN`,
`VENUE_MISMATCH`, `CUSTOMER_NOT_FOUND`, `COURT_NOT_FOUND`) keep the catalogue's operator line and get
no phone entry: rule 3 of db §4.7.1 answers a guest or coach with not-found codes, never `FORBIDDEN`.
Reused codes the phone meets keep their entries (`AUTH_REQUIRED`, `ACCOUNT_REQUIRED`,
`PHONE_REQUIRED`, `TERMS_REQUIRED`, `SLOT_IN_PAST`, `BEYOND_HORIZON`, `CLOSED_DATE`, `OUTSIDE_HOURS`,
`PRICE_CHANGED`, `HOLD_COOLDOWN`, `BOOKING_SUSPENDED`, `HOLD_QUOTA_EXCEEDED`, `INVALID_TRANSITION`,
`INVALID_ARGUMENT`, `IDEMPOTENCY_CONFLICT`, `DEGRADED_LOCKOUT`, and the edge's `BAD_REQUEST`,
`TOO_MANY_ATTEMPTS`, `PROVIDER_UNAVAILABLE`, `RETRY_LATER`, `PAYMENT_NOT_FOUND`). `VENUE_CLOSED` and
`RECORD_INVALID` are dropped from this lane: no coaching path raises them to a guest or a coach.

**Screen overrides** (`lessonErrorText(err, t, {phone, price, cap})` in `features/coaching/errors.ts`,
the `matchErrorText` pattern), applied before `mapErrorToKey`:
- every detail row above, by code and detail;
- `TERMS_REQUIRED` → `coaching.common.errors.termsRequired` "Accept the updated terms to pay for lessons
  online." / «يلزم قبول الشروط المحدَّثة للدفع الإلكتروني للحصص.», or `coaching.common.errors.updateApp`
  "Update the app to pay for lessons online." / «يلزم تحديث التطبيق للدفع الإلكتروني للحصص.» on a build
  whose terms are already accepted (§4.9.6; `matches.errors.termsRequired` speaks of open matches);
- `DEGRADED_LOCKOUT` → `degraded.bookingRefused` with the branch phone;
- `NOT_A_COACH` from any coach-mode call → its line, `coachKeys.me` invalidated, and `RequireCoach`
  re-gates (a retired coach lands on statements, anyone else on Profile or the staff hub, §4.13.1).

`isDegradedRefusal` (`booking/errors.ts:106`) stays the only recogniser of a degraded refusal;
`isTransportError` (`lib/network.ts:42`) decides retries; a P0001 refusal is never retried and never
shown as "offline".

### 4.11 Push on the phone: taps and the foreground

- **`features/matches/pushRoutes.ts`** stays the one list of guest routes and kinds (the parity test
  reads it): `GUEST_PUSH_ROUTES = ['match', 'tickets', 'lesson', 'coach_lesson', 'coach_statements']`
  and `GUEST_PUSH_KINDS` with the three lesson kinds appended, both equal to the JSON in its order.
  New `LESSON_PUSH_KINDS = ['lesson_update', 'lesson_reminder', 'coach_update']` and
  `isLessonPushKind`. `GuestHref` and `guestPushHref(route, id)` gain: `lesson` with an id →
  `{pathname: '/lesson/[id]', params: {id}}`; `coach_lesson` with an id → `{pathname:
  '/coach-mode-lesson', params: {id}}`; `coach_statements` → `{pathname: '/coach-mode-statements'}`;
  a route needing an id without one → the tabs. The header comment names both families.
- **`features/profile/pushSync.ts`:** `TapDestination` (`:112-117`) gains `{kind: 'lesson', id}`,
  `{kind: 'coachLesson', id}`, `{kind: 'coachStatements'}`; `tapDestination` answers them before its
  staff branch (`:159-165`), whatever the staff status: a guest who coaches and a staff member who
  coaches (C-27) both open them.
- **`features/profile/push.ts`:** `installNotificationHandler` (`:307`) gains `onOpenLesson(id)`,
  `onOpenCoachLesson(id)`, `onOpenCoachStatements()` and `onLessonNotice()`; the received listener
  (`:394-396`) calls `onMatchNotice` for a match kind and `onLessonNotice` for a lesson kind.
- **`app/_layout.tsx:376-387`:** `onOpenLesson: id => router.push({pathname: '/lesson/[id]', params:
  {id}})`, `onOpenCoachLesson: id => router.push({pathname: '/coach-mode-lesson', params: {id}})`,
  `onOpenCoachStatements: () => router.push('/coach-mode-statements')`, `onLessonNotice: () => {
  void queryClient.invalidateQueries({queryKey: coachingKeys.all}); void
  queryClient.invalidateQueries({queryKey: coachKeys.all}); }`. A coach route lands on
  `RequireCoach`: a retired coach is sent to `/coach-mode-statements` (so `coach.statement_paid` still
  opens, C-25), anyone no longer a coach to Profile (a staff session then goes on to the staff hub
  through `GuestTabsGate`). A `lesson` tap for an unconfirmed link opens the confirm card (§4.8.10).
- **Old builds:** a `lesson` route is unknown, so the tap reads as a staff tap and opens nothing on a
  guest's phone. Harmless, as with open matches.

### 4.12 Links: `/c/<coachId>`

**In.** The website and the share sheet hand out `https://www.touch-padel.com/c/<coachId>` (C-11). The
app claims `/c/*`, `/en/c/*`, `/ar/c/*` and `touchpadel://c/<id>`, and folds every spelling onto
`app/coach/[id].tsx`.
- `features/coaching/links.ts` `normaliseCoachLink(path)`: `touchpadel://(en/|ar/)?c/<rest>` and
  `(https://<host>/|/)?(en/|ar/)?c/<rest>` → `/coach/<rest>` (query and fragment kept); anything else →
  `null`. The id is not checked here: `coach/[id]` validates it (`COACH_ID_RE`, a uuid) and shows the
  not-found layout otherwise. The origin must end in its own slash, as `normaliseIncomingPath`
  requires (`features/matches/links.ts:41-44`), so `…touch-padel.com/club` is never read as `c/lub`.
- `app/+native-intent.ts` `redirectSystemPath`: `normaliseCoachLink(path) ?? normaliseIncomingPath(path)`
  inside the existing try/catch; its header comment names both links.
- Signed out or in, the coach screen opens (browsing is public); it never writes the stored branch.

**Configuration** (a native change: a new dev client, TestFlight and an internal APK, with the build
that ships coach mode):
- `apps/mobile/app.config.ts`: `COACH_LINK_PREFIXES = ['/c/', '/en/c/', '/ar/c/']` beside
  `MATCH_LINK_PREFIXES` (`:46`); the Android intent filter's `data` (`:55`) maps both lists. iOS
  `associatedDomains` (`:278`) is unchanged: the paths come from the web's association file.
- `apps/web/src/lib/security/applinks.ts:55`: `LINK_PATHS` appends `'/c/*', '/en/c/*', '/ar/c/*'`;
  the comment above it names the coach link; `app/.well-known/apple-app-site-association/route.ts`'s
  comment too. `/t/*` stays out.
- Universal links (U6): Apple reads the association file through its CDN, which refreshes on
  install or update, so the coaching build is installed after `/c/*` shows at
  `app-site-association.cdn-apple.com` (§4.1). A same-domain tap in Safari (the website's "Book in the
  app") never opens the app: it lands on the `/c/` fallback page, whose "Open in the app" scheme link
  does. On Android, one invalid `assetlinks.json` unverifies every path of the filter, match links
  included, so the applinks test covers the file whole.
- Android verification follows the Play fingerprints exactly as the match links do: until they exist,
  a link opens `/{locale}/c/<id>`, whose "Open in the app" still works.

**Out.** `coachShareUrl(id)` = `${siteUrl()}/c/<id>` (`src/lib/legal.ts:22`), the host every build
claims; `links.test.ts` pins it beside `shareHost()`.

### 4.13 Coach mode

A coach is a guest (or a staff member, C-27) who opens a working area from Profile or the staff hub:
their schedule, hours, rosters and statements. It is a stack of root-stack screens, not a tab, not a
group and not a nested navigator; the native back button returns to where it was opened.

#### 4.13.1 Status, provider, gate

```ts
// features/coach/status.ts (pure)
export type CoachStatus =
  | { kind: 'none' }                       // no session, or an anonymous one
  | { kind: 'pending' }                    // coach_me in flight, no answer yet for this uid
  | { kind: 'guest' }                      // coach: null (never a coach)
  | { kind: 'coach'; coach: CoachMe }      // active or paused
  | { kind: 'retired'; coach: CoachMeRetired } // C-25, R45: statements only
  | { kind: 'error' };                     // the read failed and there is no earlier answer
export function nextCoachStatus(input: {
  uid: string | null;
  restoring: boolean;                      // useAuth().initializing (MB-03)
  read: { state: 'idle' } | { state: 'pending' } | { state: 'error' }
      | { state: 'success'; data: CoachMeRead };
  previous: CoachStatus; previousUid: string | null;
}): CoachStatus;
```
- No staff and no switch input (R45): a staff session and a branch with coaching off read `coach_me`
  like anyone else. `idle` (no reader mounted yet) → `none` for no session, else the previous answer
  for the same uid, else `pending`.
- `previous` is evidence only for the same uid (the `nextStaffStatus` rule).
- **Amended 2026-10-02 (MB-03):** no uid while the stored session is still being restored
  (`restoring`, the auth context's `initializing`) is `pending`, not `none`, so a coach push tapped
  on a cold start shows Loading instead of bouncing to Profile. The provider's input key carries it.
- An error after a `coach` or `retired` answer keeps it (a dropped connection does not throw the coach
  out).

**`CoachStatusProvider`** (`features/coach/CoachStatusProvider.tsx`), mounted once inside
`StaffStatusProvider` (`app/_layout.tsx:417`): `<StaffStatusProvider><CoachStatusProvider>…`. It owns
the `coach_me` query under `coachKeys.me(uid)`, enabled while the session is signed in (not
anonymous) and at least one reader is mounted: Profile, the staff hub and every `RequireCoach` call
`useCoachStatus({read: true})` (R45: "read on Profile mount and from the staff hub"). `staleTime` 5
minutes; refetched on foreground while a reader is mounted, and whenever a coach-mode screen mounts.
A guest who never opens Profile never calls it. Without the provider (every existing smoke case) the
context answers `guest`, so every screen renders as today. It holds no device hint: `pending` only
delays one menu row.

**`coachGate(status, screen)`** → `'loading' | 'allow' | 'redirect-statements' | 'redirect-home' |
'error'`: `pending` → loading; `coach` → allow; `retired` → allow on the statements screen, else
redirect-statements; `error` → error; everything else → redirect-home.

**`RequireCoach`** wraps every `app/coach-mode*.tsx` (`allowRetired` on `coach-mode-statements`
only): `loading` → `Loading`; `redirect-statements` → `<Redirect href="/coach-mode-statements" />`;
`redirect-home` → `<Redirect href="/(tabs)/profile" />` (a staff session goes on to `/staff` through
`GuestTabsGate`); `error` → `ErrorState` (`coach-mode.status-error`) with retry; `allow` → the
screen, under the banners below.

**Banners** (every coach-mode screen but statements, `coach-mode.banner.*`):
- **Paused** (R16): "Your coaching is paused. Guests can't book you right now; your booked lessons go
  ahead." / «التدريب متوقف مؤقتًا: لا يمكن للضيوف حجز حصص معك حاليًا، وتُقام الحصص المحجوزة كما هي.»
  "Book for a student" and "New session" are hidden (the server refuses `COACH_INACTIVE` anyway).
- **Switched off** (R45, P5), one line per branch with `coaching_enabled` false: "Lessons are
  switched off at {branch}. Your booked lessons there go ahead." / «الحصص متوقفة في {branch}، وتُقام
  الحصص المحجوزة هناك كما هي.» Booking and creation offer only branches with coaching on, and are
  hidden when there is none; schedule, rosters, marks, cancels, reschedules, hours and statements
  keep working (db §4.7.1 rule 4).
- **Not public yet** (R61, C-22), while `public_accepted` is false: "Your profile isn't public yet,
  so guests can't find you. Lessons you or the desk book still work." / «صفحتك غير منشورة بعد، فلا
  يجدك الضيوف، وتبقى الحصص التي تحجزها أنت أو الاستقبال قائمة.» with "Review" (`coach-mode.banner.accept`)
  → the accept sheet.

#### 4.13.2 `app/coach-mode.tsx` (route `coach-mode`)

- **The accept sheet** (R61, C-22): while `public_accepted` is false, the screen opens on a native
  sheet (`presentation: 'formSheet'` on iOS, a full-screen modal on Android) `coach-mode.accept-sheet`:
  - title "Your public coach profile" / «صفحتك العامة كمدرّب»;
  - body "Your coach profile will be public on the app and the website." / «ستكون صفحتك كمدرّب منشورة
    في التطبيق وعلى الموقع.», then a preview of what is shown: the display name, photo and bio the
    venue set (from `coach_me`), the lesson types, and the sessions with places; "Only the venue can
    change your name, photo and bio." / «يعدّل النادي وحده الاسم والصورة والنبذة.»;
  - `coach-mode.accept` "Accept" / «موافقة» → `coach_accept_public()`; success → toast "Your profile
    is public." / «نُشرت صفحتك.», `coachKeys.me` invalidated, the sheet closes;
  - `coach-mode.accept-later` "Not now" / «ليس الآن» → the sheet closes for this visit; the "Not public
    yet" banner stays.
- **Header:** "Coach mode" / «وضع المدرّب»; the coach's display name and photo under it.
- **Branch:** `BranchPicker` (`coach-mode.branch`) over the coach's branches when more than one; "All
  branches" is the default (the schedule is one person's day).
- **Schedule** `coach-mode.schedule` (a `SectionList`): `coach_schedule(p_from = now − 24 h, p_to =
  start of today + 15 days)`, sections by trading night ("Today", "Tomorrow", "Thu 9 Oct"), rows
  `coach-mode.lesson.<lessonId>` (`LessonRow`, coach variant): "{time}–{end} · {type}", the kind,
  "Private · {people}" / "Group · {places}/{max}" / "Course · session {n} of {total}", the court, a
  "Below minimum" mark before the cut-off, "{n} to mark" (`unmarked`) within the CD-11 window, a
  cancelled row struck through. A row → `/coach-mode-lesson?id=`. Time off shows as a band "Time off".
- **Actions** (`MenuRow`s under the list): "Hours and time off" (`coach-mode.hours` →
  `/coach-mode-hours`), "New group session or course" (`coach-mode.new` → `/coach-mode-new`), "Book for
  a student" (`coach-mode.book` → `/coach-mode-book`), "Statements" (`coach-mode.statements` →
  `/coach-mode-statements`).
- **States:** skeleton; empty "Nothing scheduled in the next two weeks." / «لا حصص مجدولة خلال
  الأسبوعين القادمين.»; `ErrorState` `coach-mode.error`. Pull to refresh.

#### 4.13.3 `app/coach-mode-hours.tsx` (route `coach-mode-hours`)

- **Data:** `coach_hours_mine()`.
- **Branch:** `BranchPicker` `coach-mode-hours.branch` when the coach has more than one branch; one
  branch's windows are edited at a time.
- **Weekly hours:** seven `HoursDayEditor`s (`coach-mode-hours.day.<weekday>`, Sunday = 0 first, the
  stored numbering), each listing windows "09:00–12:00" with remove (`.window.<i>.remove`) and "Add
  hours" (`.add`), which opens two `DateTimeField`s in time mode (`.window.<i>.start`, `.end`, 30-minute
  steps) and the switch "Until midnight" (`.window.<i>.midnight`), which sends `24:00` (a time picker
  cannot show it, CD-10).
- **Past midnight** (CD-10): an end earlier than the start is offered as a split: "This runs past
  midnight. Add it as {start}–24:00 on {day} and 00:00–{end} on {next day}?" / «يمتد هذا الوقت بعد منتصف
  الليل. هل تُضاف {start}–24:00 يوم {day} و00:00–{end} يوم {next day}؟» → `splitAcrossMidnight` writes
  both windows.
- **Pre-checks** (pure, before the call): a window must end after it starts; windows on one weekday
  must not overlap at this branch or (from the same read) at another (`windowsOverlap`). The server's
  `HOURS_INVALID` / `HOURS_OVERLAP` stay authoritative; their detail (the window index) marks the row
  (§4.10).
- **Set by the venue:** a window with `set_by = 'staff'` carries "Set by the venue" / «حدّده النادي»;
  the coach may still change it (C-4).
- **Save** `coach-mode-hours.save` "Save hours" / «حفظ الأوقات» → `set_my_coach_hours(venueId,
  toWindowsJson(windows))` (DB's `{weekday, start, end}`, §4.3); success toast "Hours saved." Leaving
  with unsaved changes asks (the native `beforeRemove` confirm): "Discard your changes?"
- **Time off** (below): rows `coach-mode-hours.time-off.<id>` "{from} – {to} · {reason}", with
  "Cancel" (`.cancel`, `ConfirmAlert` → `cancel_my_time_off`; `INVALID_ARGUMENT` detail `p_id` →
  refetch); "Add time off" (`coach-mode-hours.time-off.add`) opens two `DateTimeField`s in date-time
  mode (`.start`, `.end`) and a reason `Field` (`.reason`, ≤ 200; "Only you and the venue see this." /
  «لا يراه إلا أنت والنادي.») and submits (`.submit`) → `add_my_time_off`. `TIME_OFF_HAS_LESSONS` →
  its line with the count and "See my schedule" (→ `/coach-mode` scrolled to the start day);
  `HOURS_OVERLAP` detail `time_off` → its line.

#### 4.13.4 `app/coach-mode-lesson.tsx` (route `coach-mode-lesson`)

- **Params:** `id` (a lesson). **Data:** `coach_lesson(id)`; refetched on focus and on a coach push.
- **Header card:** type, kind, day and time, the court, "{places}/{max}" (group, course), "Runs if
  {people} sign up by {time}" before the cut-off, the course's sessions (`coach-mode-lesson.session.<n>`
  → that session's screen).
- **Roster** `coach-mode-lesson.roster` (a `FlatList`), `RosterRow` `coach-mode-lesson.student.<enrolmentId>`:
  - the name (`isolate`) as the server sends it (R44: typed for coach- and desk-booked rows), "+{n}"
    friends and their names for a private party, "Booked by you" / "Booked at the desk" / "Booked in
    the app", "Pays at the desk" or "Paid online";
  - a `held` row reads "Awaiting payment" / «بانتظار الدفع» and has no phone (P13);
  - the phone (`isolateLtr`) with a call button (`.call`, `Linking.openURL('tel:…')`) while `phone`
    is set; afterwards the name only (C-16, R54). Under the list: "Phone numbers show until 7 days
    after the lesson ends. Use them only for this lesson." / «تظهر أرقام الهواتف حتى 7 أيام بعد انتهاء
    الحصة، ولا تُستخدم إلا لهذه الحصة.»;
  - **attendance** (`.mark`, a `SegmentedControl` Attended / No-show, «حضور» / «غياب», with "Clear" in
    the row menu) while `can.mark` and `canMarkNow` (from the start until `mark_until`, CD-11); before
    the start it is hidden, after `mark_until` read-only. → `coach_mark_attendance(lesson, enrolment,
    'attended' | 'no_show' | 'clear')`, state-idempotent; `INVALID_TRANSITION` details (§4.10) inline;
  - the row menu (`.menu`, `nativeChoice`): "Remove from this lesson" while `can.remove`.
- **Reasons** (remove and cancel, U4): an inline card on the screen (`coach-mode-lesson.reason`), not
  an `Alert`, because Android's `Alert` holds three buttons and no field: a `SegmentedControl`
  (`.reason.code`) of the action's reasons and an optional note `Field` (`.reason.note`, ≤ 200), then
  the action's `ConfirmAlert`. The value is `reasonValue(code, note)`.
- **Remove** (reasons "Asked to cancel" `customer_request`, "Booked twice" `duplicate`, "Other"
  `other`) → `ConfirmAlert` "Remove {name}? Anything paid online is refunded, and they're told." →
  `coach_remove_student(enrolment, reason)`. `LESSON_NOT_CANCELLABLE` detail `private` → "cancel the
  lesson instead" (§4.10).
- **Add a student** (C-8, `coach-mode-lesson.add`) while `can.add` (a group session until its end; a
  course until its last session starts, R39/R48): an inline card with name (`.add.name`, required, ≤
  80) and phone (`PhoneField`, `.add.phone`, optional) and submit (`.add.submit`) →
  `coach_add_student(p_lesson_id or, for a course, p_course_id, name, phone, key)`. The answer is the
  same whether the phone matched an account: the toast is always "{name} added. They pay at the desk."
  / «أُضيف {name}، والدفع عند الاستقبال.», and the roster shows the typed name and phone (C-21: the
  coach is never told about a match or its confirmation). Refusals inline: `COACH_ADD_LIMIT`,
  `LESSON_FULL`, `LESSON_CLOSED`, `COACHING_OFF`, `COACH_INACTIVE`, `DEGRADED_LOCKOUT` (R15); when
  `add_cap − adds_today ≤ 5` the card shows "{n} more today" (`count.addsLeft`).
- **Cancel** (`coach-mode-lesson.cancel`, a private or group lesson, while `can.cancel`; reasons "I
  can't make it" `coach_unavailable`, "Asked to cancel" `customer_request`, "Other" `other`) →
  `ConfirmAlert` "Cancel this lesson? Everyone booked is told, and anything paid online is refunded." →
  `coach_cancel_lesson`. A course session offers "Cancel the rest of the course"
  (`coach-mode-lesson.cancel-course`, while `can.cancel_course`) → the same reasons → "Cancel every
  session not yet started? Everyone is told, and the remaining sessions are refunded." →
  `coach_cancel_course` (C-19: no per-session cancel; `LESSON_NOT_CANCELLABLE` detail
  `course_session` → "Move it, or cancel the course").
- **Reschedule** (`coach-mode-lesson.reschedule`, while `can.reschedule`; any kind, R8): a
  `DateTimeField` (date and time, 30-minute steps; Android snaps with `snapToGrid`), pre-checked with
  `insideCutoff` for a group session and session 1 of a course (R47) → `ConfirmAlert` "Move this lesson
  to {when}? Everyone booked is told and can cancel free until it starts." / «نقل هذه الحصة إلى
  {when}؟ يُبلَّغ جميع المحجوزين، ويمكنهم الإلغاء مجانًا حتى موعد بدئها.» (a course: "Move session {n}
  to {when}? …") → `coach_reschedule_session`. Refusals inline (§4.10): `SESSION_NOT_MOVABLE` (`order`,
  `started`, `ended`), `INVALID_TRANSITION` `held` (R32), `LESSON_CLOSED` `cutoff` (R47), `COACH_BUSY`,
  `NO_COURT_FREE`, `COACH_UNAVAILABLE`, `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`,
  `OUTSIDE_HOURS`, `DEGRADED_LOCKOUT`.
- **States:** skeleton; `LESSON_NOT_FOUND` → "This lesson isn't yours or no longer exists." and back;
  `NOT_A_COACH` → §4.10 (re-gate); `ErrorState`.

#### 4.13.5 `app/coach-mode-new.tsx` (route `coach-mode-new`)

- **Kind** `coach-mode-new.kind` (`SegmentedControl` Group session / Course), **branch**
  (`coach-mode-new.branch`, branches with coaching on only), **lesson type** (`coach-mode-new.type.<id>`
  rows: the coach's active types of that kind at that branch, with "{max} places · at least {min} ·
  sign-up closes {hours} before" and the venue's price, read-only: "Price set by the venue: {price}"
  (C-5)).
- **Start:** `coach_slots` answers private types only (§4.3), so the start is a `DateTimeField`
  (`coach-mode-new.start`, date and time, 30-minute steps, R9), defaulting to the next half hour that
  is outside the type's cut-off. Pure pre-checks: on the grid, in the future, and `insideCutoff` false
  (R47, R26: a group or course type has a cut-off of at least one hour). The server checks hours, time
  off, other lessons and courts.
- **Course sessions:** from the first start, `weeklyStarts(first, sessions_count, tz)` lists one start
  a week at the same local time; each row (`coach-mode-new.start.<n>`) is a `DateTimeField` the coach
  can change. Title EN and AR (`coach-mode-new.title-en`, `.title-ar`, optional, ≤ 80).
- **Primary** `coach-mode-new.create` "Create" / «إنشاء» → `coach_create_group(type, venue, start,
  key)` or `coach_create_course(type, venue, starts, title_en, title_ar, key)`. Success →
  `router.replace('/coach-mode-lesson', {id: lesson_id or lesson_ids[0]})`, toast "Created. Guests can
  book it now." (while `public_accepted` is false: "Created. Guests will see it once your profile is
  public."). A per-start refusal (detail `i`, §4.10) marks row `i`; `COURSE_STARTS_INVALID`'s
  `count`, `order` and `span` read above the rows; `LESSON_CLOSED` `cutoff` marks the first start.

#### 4.13.6 `app/coach-mode-book.tsx` (route `coach-mode-book`)

- Branch (coaching on only), private type (`coach-mode-book.type`), the day strip and lane from
  `coach_slots` (as the guest grid, §4.8.3), student name (`coach-mode-book.name`, required), phone
  (`PhoneField`, `coach-mode-book.phone`, optional), party (`PartyStepper` `coach-mode-book.party`),
  the note "Paid at the desk." (CD-1: a coach's booking is always desk).
- **Hoarding cap** (R56, C-24): "{open} of {cap} upcoming lessons booked for students" /
  «{open} من {cap} حصص قادمة محجوزة للمتدرّبين» from the picked branch's
  `coach_me.branches[].open_private` / `open_private_cap`; at that branch's cap the primary is
  disabled with `addLimitLive`'s line. **Amended 2026-10-02 (MB-01):** the server counts per branch
  (0283), so the top-level `private_open` / `private_cap` (a sum across branches and the lowest
  cap) are display only and never gate a branch; `addLimitLive`'s `{cap}` in coach-mode-book, -new
  and -lesson is the cap of the branch the call named.
- **Primary** `coach-mode-book.book` "Book" / «حجز» → `coach_book_private(type, venue, start, name,
  phone, party, key)`; success → `router.replace('/coach-mode-lesson', {id})`, toast "{name} is booked."
  The same answer whether the phone matched (C-8, C-21). `COACH_ADD_LIMIT` detail `live` or the daily
  cap → their lines (§4.10).

#### 4.13.7 `app/coach-mode-statements.tsx` (route `coach-mode-statements`)

The one coach-mode screen a retired coach opens (C-25, R45).
- **Months** `coach-mode-statements.month`: a horizontal strip of `FilterChip`s
  (`coach-mode-statements.month.<yyyy-mm>`) from `months` (approved and paid only, the last 12; a
  native choice sheet cannot hold twelve on Android). The first read is `my_coach_statements(null)`
  (the summaries); picking a month reads it with `p_month` for the lines.
- **Statements** (C-12, read-only), one `StatementCard` per branch (`coach-mode-statements.statement.<id>`):
  status ("Approved" / "Paid on {date} · ref {reference}"), "{lessons}", "Collected {collected}",
  "Court share {court}" / «أجرة الملعب {court}», "Coach's share ({pct}) {coach}" / «نصيب المدرّب
  ({pct}) {coach}», "Adjustments {adj}" / «التسويات {adj}» when non-zero; then the lines
  (`coach-mode-statements.line.<lessonId>`): date, type, collected, court share, coach's share.
  **Amended 2026-10-02 (MB-02):** `share_bp` may be null (mixed rates in the month, adjustments
  only); the share then reads "Coach's share {coach}" / «نصيب المدرّب {coach}» with no percentage,
  never an assumed one. Each line shows its own `share_bp` as "yours ({pct}) {coach}" / «نصيبك
  ({pct}) {coach}», and none when the line carries no rate (an adjustment).
- **This month so far** (not for a retired coach): one card per `current_month` entry, "This month
  so far · an estimate, not a statement" / «هذا الشهر حتى الآن · تقدير وليس كشف حساب», lessons,
  collected and coach's share.
- **Note:** "Statements are drafted at the start of each month. You see them once the branch manager
  approves them; the money is paid to you outside the app." / «تُعدّ كشوف الحساب في بداية كل شهر،
  وتظهر هنا بعد أن يعتمدها مدير الفرع، ويُسلَّم المبلغ خارج التطبيق.» (CM-12: no drafts.)
- **Empty:** "No statements yet." / «لا كشوف حساب بعد.»

#### 4.13.8 Native feel

- Every coach-mode screen is a root-stack push with the platform back gesture and header; titles come
  from `Stack.Screen` options; no custom nav bar.
- Pickers are the platform's: **`@react-native-community/datetimepicker`** (installed with `npx expo
  install`, the SDK 57 version), wrapped once in `src/components/DateTimeField.tsx` (required `testID`,
  forwarded; iOS `minuteInterval={30}` where a lesson start is chosen; Android's clock snapped with
  `snapToGrid`). It is a native module: a new dev client and store builds, the same build as the
  `/c/` intent filters (§4.12), shipped in the production `eas build` (R19); `pnpm --filter
  @touch/mobile doctor` after adding it. No date-time picker is in the app today
  (`apps/mobile/package.json`); time off, group and course starts and reschedules cannot come from a
  chip strip (`coach_slots` serves private types only).
- Choice sheets are `components/nativeChoice.ts` (at most three buttons on Android); confirms are
  `ConfirmAlert`; share is React Native `Share`; calls are `Linking.openURL('tel:')`.
- `Text` from `src/i18n/text.tsx`; logical style props only; colours from `src/theme/tokens.ts` (no new
  token: the operator's `--tp-lesson` is the operator's).

### 4.14 Web

#### 4.14.1 `src/lib/coaching.ts` and `src/lib/coaching.server.ts`

- **`src/lib/coaching.ts`** (pure, an addition beside `menu.ts`): `parseCoachingPublic(raw) →
  PublicCoaching | null` keeps only the §4.3 fields (the `shapes.ts` list, R41), joins coaches, types
  and sessions, and **drops every price of a branch whose `prices_public` is false** at parse time, so
  no component can print one (C-11). The page lists exactly the coaches the server sends, which are
  only active coaches who accepted the public profile (R61, C-22); paused, retired (R63) and
  not-yet-accepted coaches, and their sessions, never reach it. `coachPhotoUrl(path)` =
  `publicMediaUrl(path)` (`src/lib/media.ts`) for a `coaches/<uuid>/<file>` path only (R43).
- **`src/lib/coaching.server.ts`** (`import 'server-only'`):
  ```ts
  export type CoachingStatus = 'ok' | 'empty' | 'off' | 'error';
  export interface CoachingRead { status: CoachingStatus; coaching: PublicCoaching | null }
  export async function getCachedCoaching(venueId: string | null = null): Promise<CoachingRead>;
  ```
  `createStaticSupabase().schema('app').rpc('coaching_public', {p_venue_id})` inside
  `unstable_cache(…, ['coaching-public'], {tags: ['coaching'], revalidate: 60})`; the cached function
  **throws** on a failed read and the wrapper turns it into `{status: 'error'}` (the multi-venue audit
  lesson, `menu.server.ts:46-51`: a fallback returned inside the cache is kept for the window).
  `off` = `{off: true}`; `empty` = on, no coaches; `ok` = at least one coach. Places left may be up to a
  minute behind: the app re-checks on booking.

#### 4.14.2 `app/[locale]/coaching/page.tsx`

In the site shell (`SiteShell … path="/coaching"`), like `support/page.tsx`.
- **Metadata** (the `support/page.tsx:37-62` pattern): title `coaching.web.metaTitle` "Padel coaching"
  / «تدريب البادل» (absolute: "Padel coaching · Touch Padel"); description `coaching.web.metaDescription`
  "Private lessons, group sessions and courses with Touch Padel's coaches in Karbala. Book in the app."
  / «حصص خاصة وجماعية ودورات مع مدرّبي تتش بادل في كربلاء. الحجز من التطبيق.»; `robots {index: true,
  follow: true}`; canonical `/${locale}/coaching`; languages `en`, `ar`, `x-default` → `/ar/coaching`;
  `openGraph` replaced whole with `siteOgImage(locale)` (`src/lib/site/ogImage.ts:11`, absolute and
  versioned) and `site.seo.ogAlt`; `twitter` likewise.
- **Data:** `getCachedCoaching(null)`, `getCachedVenue()`, the site mode and nonce.
- **Sections** (`ok`):
  1. **Head:** "COACHING / AT TOUCH" (`coaching.web.titleOne`, `titleTwo`, the two-line display of the
     landing), the intro "Private lessons, group sessions and courses with our coaches. Pick a coach
     and a time in the app." / «حصص خاصة وجماعية ودورات مع مدرّبينا. اختيار المدرّب والوقت من التطبيق.».
  2. **Per branch** when more than one open branch has coaching on (a heading with the branch name);
     one block otherwise.
  3. **Coach cards** (`.tp-coach-card`): photo (`next/image`, `sizes` for two columns; a lettered
     placeholder without one), display name, bio (four lines), the lesson types they teach, prices when
     the branch shows them ("From {price}"), and "Book in the app" (`coaching.web.bookInApp`) →
     `/${locale}/c/<coachId>` (claimed by the app where installed, §4.12; the fallback page elsewhere).
  4. **Lesson types** by kind: Private ("{duration} · up to {people}"), Group ("{duration} · {places}
     places"), Courses ("{sessions} · {duration} each"), with the descriptions; prices when shown.
  5. **Upcoming sessions with places** (`.tp-coach-sessions`): "{weekday} {date} · {time} · {type or
     title} · {coach}", `count.placesLeft`, a course's "Starts {date} · {sessions}", price when shown;
     each links to its coach's `/c/` link (the app shows that coach's sessions).
  6. **The app band** link "Get the app" → `/${locale}#app`, and `StoreButtons` (the site sheet is on
     this page).
- **States:** `empty` and `off` render the head and the landing's lessons ask: "We run lessons at
  Touch. Message us on WhatsApp…" with the same `WhatsAppButton` (`site.lessons.cta`), so the footer
  link never leads to a blank page; `error` adds "We couldn't load the coaches. Try again in a moment."
  / «تعذّر تحميل المدرّبين. يُرجى المحاولة بعد قليل.» above the same ask.
- **Styles:** `src/styles/site/coaching.css.ts`, added to `siteCss` (`src/styles/site/index.ts`) and
  registered in `site-css.test.ts`; logical properties, `var(--tp-*)`, a reduced-motion block.

#### 4.14.3 `app/[locale]/c/[id]/page.tsx` (the "Open in the app" fallback)

Built like `app/[locale]/m/[token]/page.tsx`: the lockup bar, a plain language link (no cookie), one
card, the big "Open in the app", "Don't have the app?", no `OpenAppOnLoad` (an unprompted scheme jump
strands Safari when the app is absent).
- `requireLocale()`; dynamic (the layout's nonce); data `getCachedCoaching(null)` (the same cached read
  as `/coaching`), the coach found by id.
- **Metadata:** title "Lessons with {name}" / «حصص مع {name}» when found, else `coaching.web.link.title`
  "Book a lesson" / «حجز حصة»; `robots {index: false, follow: true}` (the indexed page is
  `/coaching`); `openGraph` replaced whole with `siteOgImage(locale)`.
- **Body** when found: photo, display name, bio, the branches, the lesson types they teach (prices
  only when that branch shows them), then `.tp-clink__open` "Open in the app" →
  `appCoachHref(id)` = `touchpadel://c/<id>`, `.tp-clink__get` "Don't have the app?" →
  `/${locale}#app`, and "See all coaches" → `/${locale}/coaching`.
- **Not found** (not a uuid, unknown, paused, retired, not yet public (R61), or coaching off; all
  read the same, so the page never says which): "This coach isn't taking
  bookings online right now." / «الحجز الإلكتروني غير متاح مع هذا المدرّب حاليًا.» and "See all
  coaches"; "Open in the app" goes to the app's home (`APP_HOME_URL`). `error`: "We couldn't load this
  page. Try again in a moment."
- **Helpers** `src/lib/site/coachLink.ts` (pure): `parseCoachId` (`^[0-9a-f-]{36}$`, lower-cased),
  `APP_COACH_URL = 'touchpadel://c'`, `appCoachHref(id)`, `coachLinkPath(locale, id)`.
- **Styles** `src/styles/site/coachLink.css.ts`, inlined with the tokens bridge as the invite page
  does; registered in `site-css.test.ts`.
- A locale-less `/c/<id>` gets the proxy's 307 to `/{locale}/c/<id>` (`proxy.ts:191-196`). Not in
  `sitemap.ts`; not disallowed in `robots.ts` (a crawler must read the `noindex`).

#### 4.14.4 The landing, the footer, and the tests they pin

- **`src/components/landing/Lessons.tsx`** takes `coaching: CoachingRead`. Not `ok` → exactly today's
  section (the WhatsApp ask). `ok` → the body switches to `coaching.web.landing.body` "Private lessons,
  group sessions and courses with our coaches. Book in the Touch Padel app, or ask us on WhatsApp." /
  «حصص خاصة وجماعية ودورات مع مدرّبينا. الحجز من تطبيق تتش بادل، أو السؤال عبر واتساب.»; a **coaches
  strip** (`.tp-lessons__coaches`, up to four faces with names, each → `/${locale}/c/<id>`); and "Meet
  the coaches" (`coaching.web.landing.cta`) → `/${locale}/coaching`, beside the WhatsApp button, which
  stays (so the "Plan your visit" fallback count of `page.test.tsx:157-160` stays 8).
- **`app/[locale]/page.tsx:91`** adds `getCachedCoaching(null)` to its `Promise.all` and passes it
  to `<Lessons>` (`:114`).
- **Footer** (`src/components/site/SiteFooter.tsx:105-111`): "Explore" gains `link('/coaching',
  tr('site.footer.coaching'))` after Lessons: "Coaching" / «التدريب».
- **Header nav** (`SiteHeader.tsx:51-56`) is unchanged: "Lessons" still scrolls to `#lessons`, which
  now leads on to `/coaching`. Changing it would break `site-components.test.tsx:51` and the
  in-page-anchor case of `e2e/tests/site-landing.spec.ts:215-232` (the sheet closes on an anchor),
  for no gain.
- **Pinned tests:** `site-components.test.tsx` gains a footer case (the Explore hrefs in order,
  `/en#lessons`, `/en/coaching`, `/en/menu`, `/en/support`); `page.test.tsx:102` (section order) is
  unchanged; `page.test.tsx` mocks `@/lib/coaching.server` with `{status: 'off'}` by default, so every
  existing case is unchanged, and gains an `ok` case (the strip, its links, "Meet the coaches", no
  price when `prices_public` is false); `e2e/tests/site-landing.spec.ts:99-112` adds `/en/coaching` to
  its `arrayContaining` list.
- **`apps/web/CLAUDE.md`**'s page list gains `/{locale}/coaching` and `/{locale}/c/[id]`, and
  "`RPC_ERROR_KEYS`" becomes `WEB_OVERRIDES` + `rpcErrorKey` (`src/lib/appRpc.ts:53,97`). The site
  contract's "not prices, no coach names" (`docs/design/web-site/contracts-2026-09-23.md:25-27`) is
  amended by C-11; the contract file gets a one-line pointer to it.

#### 4.14.5 SEO, sitemap, images, CSP, JSON-LD

- `app/sitemap.ts` `PAGES` gains `{path: '/coaching', priority: 0.7}`. `/c/` is not listed.
- Images: only from the `menu-media` bucket; coach photos are `menu-media/coaches/<uuid>/<uuid>.<ext>`,
  a fresh random folder that is never a profile or coach id (R43), and a deleted or retired coach's
  folder is removed within a day, well after the 60-second cache has dropped their card.
  `next.config.ts`'s `remotePatterns` (`/storage/v1/object/public/menu-media/**`, `:4`, `:61`) already
  covers the path, and `img-src` already allows the Supabase host. **CSP is unaffected**: no script, no new
  origin. `pnpm security:web` and `e2e/tests/web-security-headers.spec.ts` are run anyway.
- JSON-LD: none in this milestone. Optional later: an `ItemList` of `Person` (`name`, `image`,
  `jobTitle: "Padel coach"`, `worksFor` the landing's club `@id`), from the same read, no prices.
- No new `headers()` or `cookies()` read in a layout (C11 of `apps/web/CLAUDE.md`).

### 4.15 Strings

**Catalogs.**
- New pair `packages/i18n/src/catalogs/coaching.en.ts` / `coaching.ar.ts`, mounted as `coaching:`
  beside `matches:` (`catalogs/en.ts:1022`, `ar.ts`), the Arabic typed `DeepMessages<typeof
  coachingEn>` so a missing key fails `typecheck`; parity by `packages/i18n/src/__tests__/t.test.ts`.
- It spreads four fragment pairs, one per area, so parallel commits never edit one file (the
  `matches.*.ts` pattern):

| Fragment | Namespace | Holds | Leaves (about, per language) |
| --- | --- | --- | --- |
| `coaching.common.{en,ar}.ts` | `coaching.common` | kinds, statuses, the state lines (§4.8.9), `count.*`, `errors.*` (§4.10), shared labels (price, duration, branch, call) | 110 |
| `coaching.guest.{en,ar}.ts` | `coaching.guest` | `entry`, `coaches`, `coach`, `classes`, `class`, `review`, `lesson`, `mine`, `cancel`, `pay`, `welcome` | 120 |
| `coaching.coach.{en,ar}.ts` | `coaching.coach` | `home`, `hours`, `timeOff`, `lesson`, `roster`, `new`, `book`, `statements`, `reasons`, `paused` | 110 |
| `coaching.web.{en,ar}.ts` | `coaching.web` | the `/coaching` page, the `/c/` page, the landing strip | 40 |

  About 420 leaves per language (the link confirm, the accept sheet, the banners and the §4.10 detail
  lines included). `coaching.web` is a fourth sub-namespace under `coaching`, as `matches.web` is under
  `matches`; §1.11 names its file pair.
- **The glossary** (R55, C-30): `packages/i18n/src/catalogs/coaching.glossary.ts` exports
  `COACHING_TERMS = {en: {…}, ar: {…}}`, the one constants block of the terms table below. Both
  `coaching.*.ar.ts` and the operator's `ws/coaching.ar.ts` build their lesson, court-share and
  coach's-share words from it, and a test in `t.test.ts` asserts that no coaching catalog, mobile or
  operator, uses the word «درس» or the phrases «حصة الملعب» and «حصة المدرّب». G3 creates it; the
  operator lane's catalogs import it.
- Existing namespaces gain `profile.myLessons`, `profile.coachMode`, `profile.coachStatements`,
  `staff.shell.coachMode`, `staff.shell.coachStatements`, `site.footer.coaching`; `profile.deleteBody`
  (`en.ts:794`) gains the R50 sentences of §4.16.
- The header comment of each file says the Arabic is **DRAFT-AR** for the client.
- After any catalog edit, `pnpm --filter @touch/db assistant:map` before pushing (CI's db test reads the
  map).

**Counted phrases** (`coaching.common.count.<key>`, six leaves each, through `countPhrase`,
`packages/i18n/src/plural.ts:56`; `{count}` is LTR-isolated Latin digits; AR **DRAFT-AR**):

| Key | EN one / other (zero) | AR zero · one · two · few · many · other |
| --- | --- | --- |
| `placesLeft` | 1 place left / {count} places left (No places left) | لا أماكن متاحة · مكان واحد متاح · مكانان متاحان · {count} أماكن متاحة · {count} مكانًا متاحًا · {count} مكان متاح |
| `places` | 1 place / {count} places | لا أماكن · مكان واحد · مكانان · {count} أماكن · {count} مكانًا · {count} مكان |
| `people` | 1 person / {count} people | لا أحد · شخص واحد · شخصان · {count} أشخاص · {count} شخصًا · {count} شخص |
| `sessions` | 1 session / {count} sessions | لا حصص · حصة واحدة · حصتان · {count} حصص · {count} حصة · {count} حصة |
| `sessionsLeft` | 1 session left / {count} sessions left | لم تبقَ حصص · بقيت حصة واحدة · بقيت حصتان · بقيت {count} حصص · بقيت {count} حصة · بقيت {count} حصة |
| `students` | 1 student / {count} students | لا متدرّبين · متدرّب واحد · متدرّبان · {count} متدرّبين · {count} متدرّبًا · {count} متدرّب |
| `hours` | 1 hour / {count} hours | لا ساعات · ساعة واحدة · ساعتان · {count} ساعات · {count} ساعة · {count} ساعة |
| `lessons` | 1 lesson / {count} lessons | لا حصص · حصة واحدة · حصتان · {count} حصص · {count} حصة · {count} حصة |
| `withPlaces` | 1 with places / {count} with places | — · واحدة فيها أماكن · اثنتان فيهما أماكن · {count} فيها أماكن · {count} فيها أماكن · {count} فيها أماكن |
| `addsLeft` | 1 more today / {count} more today | — · واحد آخر اليوم · اثنان آخران اليوم · {count} آخرين اليوم · {count} آخر اليوم · {count} آخر اليوم |

"—" is never shown (the caller renders nothing at zero); the leaf exists for parity.

**Terms** (**DRAFT-AR**, for the client's review; `COACHING_TERMS`, shared with the operator's
`ws/coaching*`, R55):

| EN | AR | Note |
| --- | --- | --- |
| coach | مدرّب (المدرّب) | the role noun, generic; a woman coach is not named on a lock screen |
| lesson (any kind) | حصة | C-30, every app; **not** «درس» |
| private lesson | حصة خاصة | |
| group session | حصة جماعية | |
| course | دورة | |
| session (of a course) | حصة (الحصة 3 من 8) | |
| place | مكان (أماكن) | |
| student | متدرّب (المتدرّبون) | generic plural |
| coach mode | وضع المدرّب | |
| hours | أوقات التدريب | |
| time off | إجازة | |
| statement | كشف حساب | |
| court share | أجرة الملعب | R55; **not** «حصة الملعب»: حصة already means "lesson" |
| coach's share | نصيب المدرّب | R55; **not** «حصة المدرّب» |
| adjustments | التسويات | |
| cut-off | آخر موعد للتسجيل | |
| attended / no-show | حضور / غياب | verbal nouns, no gender |
| front desk / venue | الاستقبال / النادي | as the rest of the app |

**Bidi:** names through `isolate`; counts, "3/8", phones and "+1" through `isolateLtr`; times through
`formatTime`; money through `formatIQD`. Digits are Latin in both languages.

### 4.16 Legal and store

Commit G7 (R50, C-26). The text ships in `catalogs/legal.{en,ar}.ts` with a terms bump, as open
matches' did (their §4.25): `CURRENT_TERMS_VERSION` (`packages/core/src/legal/terms.ts`) and
`legal.lastUpdated` move to the day it lands, and the Arabic goes to the client's lawyer. **Online
lesson money waits for it** (C-26): once a build carrying that version is on phones, a one-line
migration sets `platform_settings.lesson_terms_version` to it; until then `set_coaching_settings`
refuses an online `lesson_payment_mode` and only desk-paid lessons run; after it, `lesson_guest(true)`
refuses an online booking from older terms (`TERMS_REQUIRED`, §4.9.6).

**Privacy, students:**
- `collect.lessons`: "Lessons: the lessons you book or join, the friends' names you give for a
  private lesson, whether you attended, and your payments for them.";
- `share.coaches`: "Coaches. Your coach sees your name and phone number for their own lessons, until
  7 days after each lesson ends, and your name after that. A coach or the front desk can add a student
  by name and phone number. If that number belongs to an account, the account is asked in the app
  whether the lesson is theirs, and nothing is shown or sent to it until it says yes; the coach is
  never told either way.";
- `share.staff` (`legal.en.ts:121`) gains: "Coaches see the name and phone number of the students in
  their own lessons, as above.";
- `retention.lessons`: "Names and phone numbers typed for students without the app are deleted 365
  days after the lesson. Deleting your account cancels your booked lessons and refunds what you paid
  online for them.".

**Privacy, coaches** (new `collect.coaching`, `share.coachProfile`, `retention.coaching`):
- "If the venue makes you a coach: your coach name, photo and bio, chosen by the venue and shown on
  the app and the website once you accept; the branches and lesson types you teach; your weekly hours
  and time off (the reason you give is seen only by you and the venue's managers); the lessons you
  teach and their rosters; and your monthly statements of what you earned and when it was paid.";
- "Guests see your public profile and your free times. The venue's managers see your hours, lessons
  and statements. Your pay is never shared with any AI model or assistant (C-28).";
- "When you stop coaching or delete your account, your profile leaves the app and the website, your
  photo and bio are deleted, and your upcoming lessons are cancelled and refunded. Your statements
  are kept with your coach name, as the venue's pay records (C-29, R63).".

**Delete account** (all three places, R50, P9):
- in the app, `profile.deleteBody` (`en.ts:794`) gains: "Your booked lessons are cancelled, and anything
  you paid online for them is refunded to your card. If you coach, your coach profile is removed and
  your upcoming lessons are cancelled; your statements are kept with your coach name." / «وتُلغى حصصك
  المحجوزة، ويُعاد ما دُفع إلكترونيًا مقابلها إلى بطاقتك. وإن كان لديك حساب مدرّب، تُزال صفحتك كمدرّب
  وتُلغى حصصك القادمة، وتُحفظ كشوف حسابك باسمك كمدرّب.»;
- on the web deletion page (the Play deletion URL), `deleteAccount.what` gains `lessons` (the first
  sentence above) and `coaching` (the second);
- in the privacy policy, `retention.deleted` gains the same two sentences.

**Terms** `lessons` (new section): booking and paying (desk, or Qi when the branch offers it);
cancelling (free until the branch's window; later, online payment is kept and it counts as a late
cancellation; a no-show is the same); a lesson moved by the coach or the venue may be cancelled free
until it starts (R8); leaving a course (sessions starting outside the window are refunded, the next
one inside it is kept, C-23); cancellations by the coach or the venue (refunded); minimums (a session
that does not fill by its cut-off is cancelled and refunded); joining a course late (paying for the
sessions left); a coach or the desk may book for you, and you confirm it is you (C-21).

Store: the data-safety forms gain "Lessons" under app activity, and the coach's pay under "Financial
info" (R49); a coach seeing a student's name and phone is the venue's own service (no third party).
`docs/store/*` lines are listed in §4.18.

### 4.17 Tests and smoke rows

**`apps/mobile/src/smoke/routes.ts`** gains thirteen rows; its header (`:18-21`) and the testID
paragraph of `apps/mobile/CLAUDE.md` gain three fixed spellings: `coach/[id]` → `coach-detail`,
`class/[id]` → `class-detail`, `lesson/[id]` → `lesson-detail`.
```ts
// ── coaching (docs/design/coaching/guest.md §4.17), cased by coaching.smoke.test.tsx
// (guest) and coachMode.smoke.test.tsx (coach mode), in EN and AR.
{ file: 'coaches.tsx', route: 'coaches', primary: 'coaches.list' },
{ file: 'coach/[id].tsx', route: 'coach-detail', primary: 'coach-detail.offers' },
{ file: 'classes.tsx', route: 'classes', primary: 'classes.list' },
{ file: 'class/[id].tsx', route: 'class-detail', primary: 'class-detail.join' },
{ file: 'lesson-review.tsx', route: 'lesson-review', primary: 'lesson-review.book' },
{ file: 'lesson/[id].tsx', route: 'lesson-detail', primary: 'lesson-detail.cancel' },
{ file: 'my-lessons.tsx', route: 'my-lessons', primary: 'my-lessons.filter.upcoming' },
{ file: 'coach-mode.tsx', route: 'coach-mode', primary: 'coach-mode.schedule' },
{ file: 'coach-mode-hours.tsx', route: 'coach-mode-hours', primary: 'coach-mode-hours.save' },
{ file: 'coach-mode-lesson.tsx', route: 'coach-mode-lesson', primary: 'coach-mode-lesson.roster' },
{ file: 'coach-mode-new.tsx', route: 'coach-mode-new', primary: 'coach-mode-new.create' },
{ file: 'coach-mode-book.tsx', route: 'coach-mode-book', primary: 'coach-mode-book.book' },
{ file: 'coach-mode-statements.tsx', route: 'coach-mode-statements', primary: 'coach-mode-statements.month' },
```
No new `_layout.tsx`; `routes.test.ts`'s navigation-target check covers every literal push above.

**Smoke suites** (`runSmokeCases`, EN and AR). Every case names its label key or its `nearbyKey`
(U5: a list primary carries no text of its own):
- `src/smoke/coaching.smoke.test.tsx`: `coaches` (`coachingPublicFixture`; `nearbyKey`
  `coaching.guest.coaches.title`), `coach-detail` (`coachProfileFixture`, `coachSlotsFixture`;
  `nearbyKey` the offers heading `coaching.guest.coach.offers`), `classes` (`nearbyKey`
  `coaching.guest.classes.filterAll`), `class-detail` (`lessonOfferFixture`, group, desk mode; label
  `coaching.guest.class.join`), `lesson-review` (session `verified`, desk mode; label
  `coaching.guest.review.book`), `lesson-detail` (`myLessonFixture`, booked, free cancel; label
  `coaching.guest.lesson.cancel`), `my-lessons` (label `coaching.guest.mine.upcoming`). Extra cases:
  `lesson-detail` and `my-lessons` with a `confirm_needed` fixture (label
  `coaching.guest.confirm.yes`, C-21); `lesson-detail` with `free_because: 'rescheduled'` (R8) and a
  course `late` leave preview (R62).
- `src/smoke/coachMode.smoke.test.tsx`: every `coach-mode*` route with the new `coach` render option:
  `RenderRouteOptions.coach?: CoachMeFixture` signs the session in, mounts `CoachStatusProvider`, and
  seeds `coachKeys.me(TEST_SESSION.user.id)` (`src/test/smoke.tsx:67-82`, beside `staff`) and the
  branches with `coaching_enabled: true`. Labels or `nearbyKey`s: `coach-mode`
  (`coaching.coach.home.schedule`), `coach-mode-hours` (label `coaching.coach.hours.save`),
  `coach-mode-lesson` (`coaching.coach.roster.title`), `coach-mode-new` (label
  `coaching.coach.new.create`), `coach-mode-book` (label `coaching.coach.book.book`),
  `coach-mode-statements` (`coaching.coach.statements.title`). Extra cases: `coach-mode` with
  `public_accepted: false` (the accept sheet, label `coaching.coach.accept.accept`, R61); paused (the
  banner, no book or new rows); a branch switched off (the R45 banner); `coach-mode-statements` with a
  retired coach, and `coach-mode` with a retired coach redirecting to statements (C-25); `coach` and
  `staff` together, so a staff member who coaches renders coach mode (C-27).
- `deposit.smoke.test.tsx` gains a `pay-status` case for `lessonBooked`.
- Existing suites: `venueSettingsFixture` (`src/test/fixtures.ts`) defaults `coaching_enabled: false`,
  so `book`, `bookings` and `profile` render exactly as today; one new `book` case with it on asserts
  `book.sheet.lessons`; a `profile` case with a coach seed asserts `profile.coach-mode` (with every
  branch's coaching off too, R45); a `staff` case with `staff` and `coach` seeds asserts
  `staff.coach-mode` (C-27).
- **Fixtures** (`src/test/fixtures.ts`): `coachingPublicFixture`, `coachProfileFixture`,
  `coachSlotsFixture`, `lessonOfferFixture`, `courseOfferFixture`, `myLessonsFixture`,
  `myLessonFixture`, `linkConfirmFixture`, `coachMeFixture`, `coachMeRetiredFixture`,
  `coachScheduleFixture`, `coachHoursFixture`, `coachLessonFixture`, `coachStatementsFixture`. Each is
  built from the `shapes.ts` key lists, so a fixture missing a key fails its own test.

**testID lint.** `packages/config/src/eslint.js` `testIdElements` (`:178`) gains `CoachCard`,
`OfferCard`, `ClassRow`, `LessonRow`, `RosterRow`, `HoursDayEditor`, `TimeOffRow`, `StatementCard`,
`PaymentModeChoice`, `PartyStepper`, `LinkConfirmCard`, `DateTimeField`. Each takes a required
`testID` and forwards `${testID}.<child>` explicitly. `LessonPoster` renders no Pressable.

**Mobile, vitest (pure):**
- `features/coaching/__tests__/logic.test.ts`: every parser with unknown enums and missing fields, and
  each parser's keys equal to its `shapes.ts` list (R41); `coachingEnabled`, `anyCoaching`;
  `lessonWindow` is exactly 14 days and stable for a day; `lessonCells` groups a 00:30 start into the
  night before; `paymentChoices` per mode; the intents; `coachPhotoUrl` refuses anything but
  `coaches/<uuid>/<file>`;
- `state.test.ts`: every row of §4.8.9;
- `links.test.ts`: `/c`, `/en/c`, `/ar/c`, the full https URL, the scheme, `…/club` untouched, match
  and auth links untouched, `coachShareUrl`'s host equal to `shareHost()`;
- `pendingLesson.test.ts`; `errors.test.ts` (`lessonErrorText` with each override, every code ·
  detail row of §4.10, and a per-start detail `i`);
- `features/coach/__tests__/status.test.ts` (every transition, the uid rule, error after coach or
  retired keeps it, no staff or switch input), `gate.test.ts` (retired allowed on statements only),
  `logic.test.ts` (`splitAcrossMidnight` across Saturday → Sunday, `windowsOverlap` across branches,
  `toWindowsJson` sends `{weekday, start, end}` with `24:00`, `weeklyStarts` keeping the local time,
  `snapToGrid`, `insideCutoff`, `canMarkNow` at start and at +24 h, `reasonValue`, `scheduleSections`,
  `branchesOff`);
- `deposit/__tests__/logic.test.ts`: the lesson branches of `parseDepositStatus` and `screenFor`;
  `pendingPayment.test.ts`: `purpose: 'lesson'` and `lessonEnrolmentId` round-trip, old pointers parse,
  `/lesson-review` and `/coach-mode*` are not resting paths;
- `matches/__tests__/pushRoutes.test.ts`: routes and kinds equal the JSON; `guestPushHref` for the
  three new routes; `profile/__tests__/pushSync.test.ts`: lesson and coach taps open whatever the
  staff status;
- `booking/__tests__/errors.test.ts`: every `MOBILE_OVERRIDES` entry of §4.10, and no entry for a code
  §4.10 drops (R52);
- `lib/__tests__/queryDefaults.test.ts`: `['coaching']` and `['coach']` never dehydrated; the mutation
  defaults; the `lessonIntentKey` memo and `clearAllLessonIntentKeys`.

**i18n:** `t.test.ts` parity covers the pair, and the glossary case (R55: no «درس», «حصة الملعب» or
«حصة المدرّب» in any coaching catalog); a `plural.test.ts` case per new counted key.

**Core:** `packages/core/src/coaching/shapes.test.ts`: every list is non-empty, has no duplicate, and
has no key naming a profile id or a phone in a public read (R43).

**Web** (`.test.tsx` beside each page, EN and AR as catalog strings, reads mocked at
`@/lib/coaching.server`):
- `app/[locale]/coaching/page.test.tsx`: each status; prices absent when `prices_public` is false even
  when the fixture carries them, present and formatted when true; card links `/{locale}/c/<id>`;
  `count.placesLeft`; no phone, student or profile id anywhere in the HTML (a value scan, R43);
  canonical and hreflang;
- `app/[locale]/c/[id]/page.test.tsx`: found, unknown, malformed, off, error; `touchpadel://c/<id>`;
  no `OpenAppOnLoad`; `noindex`;
- `src/lib/coaching.test.ts` (the parser, its `shapes.ts` keys, the price drop) and
  `src/lib/site/coachLink.test.ts`;
- `src/components/landing/Lessons` cases inside `page.test.tsx` and `site-components.test.tsx`
  (§4.14.4); `site-css.test.ts` registers the two stylesheets; `src/lib/security/proxy.test.ts`: `/c/<id>`
  → 307 `/{locale}/c/<id>`; the applinks case: `/c/*`, `/en/c/*`, `/ar/c/*` present, `/t/*` absent;
- **required** `e2e/tests/site-coaching.spec.ts` (EN and `@ar`; R58, U7): `/coaching` with prices
  hidden and shown, a coach card to its `/c/` fallback page, the footer link.

**DB and edge:** `outbox-kinds.test.ts` (§4.4), `lesson-push.test.ts` (§4.5.5),
`send-push-guest.test.ts` and the `guest-push.test.ts` split (§4.6.5). The privacy review's G2 value
scans (no `profiles.id` and no phone-shaped string in the four public reads and `my_lessons`) and its
cases (the CD-8 marker on the roster, a retired coach's `coach_lesson`, a staff coach's `coach_me`) are
DB's (R58); this lane's parsers read what they pin.

**On a device** (TestFlight and an internal APK): a `/c/` link from WhatsApp opening the coach screen on
iOS and Android, on the bare, `/en` and `/ar` paths; the app killed on Qi's page mid-booking, then
resuming to `lessonBooked`; a reminder arriving 3 hours before; an Arabic lock screen showing no name or
amount; a coach add to a second account's verified phone showing "Is this you?" and no reminder until
"Yes"; coach mode from the staff hub on a staff account; the date-time picker in both directions; the
Book tab with both entry rows and the rally.

### 4.18 Files touched

**DB and edge:** `packages/db/supabase/migrations/2026MMDD000271_outbox_lesson_kinds.sql` (new); the
Guest part of `…000280_lesson_booking.sql` (§4.5); the later one-line migration that sets
`platform_settings.lesson_terms_version` (§4.16); `supabase/functions/_shared/guest-push.json`,
`send-push/guestStrings.ts`, `send-push/index.ts`; `tests/outbox-kinds.test.ts`,
`tests/guest-push.test.ts`, `tests/send-push-guest.test.ts`, `tests/lesson-push.test.ts` (new);
`fixtures/assistant-coverage.json` (the five functions of §4.5.5); `packages/db/CLAUDE.md` (the
push-kind line).

**Core:** `packages/core/src/coaching/shapes.ts` (the Guest reads' key lists, R41) and
`shapes.test.ts`; `packages/core/src/legal/terms.ts` (`CURRENT_TERMS_VERSION`, G7).

**Mobile, new:** `app/coaches.tsx`, `app/coach/[id].tsx`, `app/classes.tsx`, `app/class/[id].tsx`,
`app/lesson-review.tsx`, `app/lesson/[id].tsx`, `app/my-lessons.tsx`, `app/coach-mode.tsx`,
`app/coach-mode-hours.tsx`, `app/coach-mode-lesson.tsx`, `app/coach-mode-new.tsx`,
`app/coach-mode-book.tsx`, `app/coach-mode-statements.tsx`; `src/features/coaching/*`,
`src/features/coach/*`; `src/components/coaching.tsx`, `src/components/DateTimeField.tsx`;
`src/smoke/coaching.smoke.test.tsx`, `src/smoke/coachMode.smoke.test.tsx`.

**Mobile, edited:** `app/_layout.tsx` (Stack.Screens, the push handler, the provider);
`app/(tabs)/bookings.tsx`, `app/(tabs)/profile.tsx`; `app/staff.tsx` (the "Coach mode" row, C-27);
`app/pay/status.tsx`; `app/+native-intent.ts`; `app.config.ts`; `package.json` (the picker);
`CLAUDE.md` (the key families, the three spellings, coach mode from the staff hub, and its stale
references: `MOBILE_OVERRIDES` `booking/errors.ts:25`, `mapErrorToKey` `:121`, `isDegradedRefusal`
`:106`, the catalogue in `packages/i18n/src/errors.ts`, `isTransportError` `lib/network.ts:42`);
`src/components/BookingSheet.tsx`; `src/features/availability/{assemble.ts,branch.ts}`;
`src/features/booking/{errors.ts,pendingIntent.ts,usePostAuthContinue.ts}`;
`src/features/auth/context.tsx`; `src/features/deposit/{api.ts,hooks.ts,logic.ts,pendingPayment.ts}`;
`src/features/matches/pushRoutes.ts`; `src/features/profile/{push.ts,pushSync.ts}`;
`src/lib/idempotency.ts`, `src/lib/queryClient.ts`; `src/smoke/routes.ts`; `src/test/{smoke.tsx,fixtures.ts}`;
`src/smoke/deposit.smoke.test.tsx` and the existing suites' seeds (`profile`, `staff`, `book`).

**i18n and config:** `packages/i18n/src/catalogs/coaching*.{en,ar}.ts` (new, ten files),
`coaching.glossary.ts` (new, R55), `en.ts`, `ar.ts` (`profile.*`, `staff.shell.*`,
`site.footer.coaching`, `profile.deleteBody`), `legal.en.ts`, `legal.ar.ts` (G7: privacy for students
and coaches, the deletion page, the terms' lessons section), `errors.ts`, `__tests__/t.test.ts` (the
glossary case); `packages/config/src/eslint.js`.

**Web:** `app/[locale]/coaching/page.tsx` + `page.test.tsx`, `app/[locale]/c/[id]/page.tsx` +
`page.test.tsx` (new); `src/lib/coaching.ts`, `coaching.server.ts`, `coaching.test.ts`,
`src/lib/site/coachLink.ts`, `coachLink.test.ts` (new); `src/styles/site/coaching.css.ts`,
`coachLink.css.ts` (new), `index.ts`, `site-css.test.ts`; `src/components/landing/Lessons.tsx`;
`app/[locale]/page.tsx`, `page.test.tsx`; `src/components/site/SiteFooter.tsx`,
`site-components.test.tsx`; `app/sitemap.ts`; `src/lib/security/applinks.ts` and its test,
`app/.well-known/apple-app-site-association/route.ts` (comment), `src/lib/security/proxy.test.ts`;
`e2e/tests/site-landing.spec.ts`, `e2e/tests/site-coaching.spec.ts` (new); `CLAUDE.md`. The deletion
page itself is catalog-driven (`legal.*`), so only the catalogs change.

**Docs:** `docs/design/web-site/contracts-2026-09-23.md` (pointer to C-11); `docs/store/app-store-submission.md`,
`docs/store/google-play-data-safety.md` (lessons under app activity, coach pay under financial info,
at the terms bump).

### 4.19 Decisions

| # | Item | Decision |
| --- | --- | --- |
| 1 | ~~`lesson.added_by_coach` needs a linked account; whether a verified-phone match links is DB's call~~ | **Superseded** by R10, R44 and C-21: an exact verified-phone match links unconfirmed; the person confirms "Is this you?" in My lessons; only `lesson.added_by_coach` (due `now() + 5 s`) reaches an unconfirmed link, no reminder until "Yes"; the coach is never told (§4.5.1, §4.8.10). |
| 2 | `lesson_notify(uuid, text, text, jsonb)` has no recipient, actor or schedule argument | Recipient from the route id (with C-21's confirmed rule), actor from `auth.uid()`, schedule from the key (§4.5.1). Kept by R18. |
| 3 | Who keeps reminders in step | Guest triggers on `lessons` and `lesson_enrolments`, the only callers of `lesson_sync_reminders` (§4.5.3; R18). Amended: constraint triggers, deferred to commit, once per lesson per transaction (F21). |
| 4 | ~~Cancel pushes inside DB's two cancel internals~~ | **Superseded** by R40: one AFTER INSERT trigger `lesson_events_notify` maps every event to its keys (§4.5.4); no DB body calls `lesson_notify`, Money only for the two statement keys. |
| 5 | Coach not told about desk reschedules, court moves, desk-created sessions | Three coach keys added (§4.6.1). Folded by R18. |
| 6 | A reminder for the guest's own booking would be skipped as the actor | `lesson.reminder` never skips the actor. |
| 7 | The deep link names no branch | `coach_profile` with `p_venue_id` NULL (R17, X2): the card plus the open branches with coaching on, or `{off: true}`. |
| 8 | Past and cancelled lessons have no home | `app/my-lessons.tsx` (§4.8.8). Folded by R19. |
| 9 | Lessons in the Played and Cancelled chips | No: a section on Upcoming, the rest on My lessons. |
| 10 | The Book-tab row's count | None: no query on the rally's thread. |
| 11 | ~~Which coaches see coach mode: active and paused; retired never~~ | **Superseded** by R16, R45 and C-25: active and paused see coach mode (paused with a banner); retired see their approved and paid statements only; coaching switched off shows a notice, never hides. |
| 12 | Coach mode as a tab or a group | Neither: root-stack pushes from Profile and, for staff who coach, from the staff hub (C-27). |
| 13 | Date and time entry | `@react-native-community/datetimepicker` (R19); private starts come from `coach_slots`; group and course starts, reschedules and time off from the picker, because `coach_slots` serves private types only. |
| 14 | Group and course joins behind the booking gate | Yes: the coach must be able to call (C-16). |
| 15 | The web price switch | Applied in the parser (prices dropped before render). |
| 16 | Header nav entry | Footer link and the landing section's link; the header keeps `#lessons` (§4.14.4). |
| 17 | `/c/[id]` indexed | No (`noindex, follow`); `/coaching` is the indexed page. |
| 18 | Web OG image | `siteOgImage(locale)` until a coaching poster exists. |
| 19 | JSON-LD | None now; the optional shape is noted. |
| 20 | The Arabic money words | «أجرة الملعب» court share, «نصيب المدرّب» coach's share, «حصة» lesson, from one glossary shared with the operator (R55, C-30). |
| 21 | `coachingEnabled` location | `features/coaching/logic.ts`, the shape of `matchesEnabled`. |
| 22 | ~~Coach-mode reasons on Android: three per choice sheet, "Other" takes a note~~ | **Superseded** (U4): an inline card with the reasons and a note field, then the confirm (§4.13.4). |
| 23 | The pro-rata price | Rendered from `lesson_offer`, never computed on the phone. |
| 24 | Whom a guest push reaches | Only a confirmed student; an unconfirmed link gets `lesson.added_by_coach` alone (C-21). |
| 25 | The course-leave and moved-lesson copy | Rendered from `my_lesson.cancel` (`free_because`, `refund_sessions`, `kept_sessions`, `next_start_at`), never computed (R8, R62). |
| 26 | Coach mode before the coach accepts the public profile | Usable, opened on the accept sheet with a "Not public yet" banner, because coach- and desk-booked lessons work before acceptance (R61). |

**Known limits.** A coach's own lock screen says "New booking in your lesson" with no name. Places left
on the web may be a minute old. Android links open the web page until the Play fingerprints are set.
Builds older than the coaching build open nothing for a lesson push. Coach mode has no offline support
(§6.3). A course session's date beyond two weeks is picked with the date picker, and the server is the
first to check it. A matched coach add and an unmatched one differ by one outbox insert in the same
transaction (R44 accepts it). `coach_slots` shows a coach's free times, so the gaps in their hours show
when they teach, though not whom (P12; the privacy text says guests see free times).

### 4.20 Additions to §1

Items 1–8 were folded into §1 by §1.12 ("accepted as written unless a ruling below changes them");
each notes the ruling that changed it. Items 9–12 are this pass's, for the next fold.

1. **Folded (§1.5; amended by R40).** `lesson_notify(p_ref uuid, p_title_key text, p_dedupe text
   default null, p_params jsonb default '{}') returns int` (the types of §1.5; the names, defaults and
   meaning of §4.5.1). `trg_lesson_reminders() returns trigger` with constraint trigger
   `lessons_reminders` (AFTER UPDATE OF start_at, status on `lessons`, deferred);
   `trg_enrolment_reminders() returns trigger` with constraint triggers
   `lesson_enrolments_reminders_ins` and `lesson_enrolments_reminders_upd` (AFTER INSERT / AFTER UPDATE
   OF status, guest_id, link_confirmed_at on `lesson_enrolments`, deferred). These triggers are the only
   callers of `lesson_sync_reminders`. R40 adds `trg_lesson_events_notify() returns trigger` with
   trigger `lesson_events_notify` (AFTER INSERT on `lesson_events`), the only queuer of `lesson.*` and
   `coach.*` but the statement keys.
2. **Folded (§1.9, R18).** Title keys `coach.session_added`, `coach.rescheduled_by_staff`,
   `coach.court_moved` (kind `coach_update`, route `coach_lesson`). The payload is `{route, id,
   title_key, params, dedupe?}` with `id` the route id (§4.5.1 table); `params` closed to `lesson_id`
   (every `lesson.*` key), `places_taken`, `places_total`. `lesson.reminder` is scheduled at the
   session's `start_at − 3 h`; `lesson.added_by_coach` at `now() + 5 s` (R44). Dedupe `l:<ref>:<key>`
   (with `:<places_taken>` for the two count keys). Terminal send-push errors `LESSON_GONE`,
   `STATEMENT_GONE`, `REMINDER_STALE`.
3. **Folded (§1.6; amended by R17, R41).** `coach_profile` accepts `p_venue_id` NULL (R17); the §4.3
   shapes are the X-table picks, with key lists in `shapes.ts` (R41); un-keyed writes answer a repeat
   without a second effect. The course-create "session number as detail" request is replaced by DB's
   per-start codes with detail `i` and `COURSE_STARTS_INVALID` `count|order|span` (X31).
4. **Folded (§1.10; amended by R52).** No new code. The catalogue points `NOT_A_COACH` at
   `coaching.common.errors.notCoach` (`LESSON_NOT_PAYABLE` keeps the operator's line, the desk meets it);
   the phone's `MOBILE_OVERRIDES` maps every code of §4.10's table, and only those; the detail keys of
   §4.10; screen keys `coaching.common.errors.{termsRequired, updateApp, priceChangedTo}`.
5. **Folded (§1.11 mobile, R19).** Route `app/my-lessons.tsx` (route `my-lessons`); fixed spellings
   `coach/[id]` → `coach-detail`, `class/[id]` → `class-detail`, `lesson/[id]` → `lesson-detail`; the
   files of §4.7.1 and §4.7.2; `CoachStatus` (with `retired`), `nextCoachStatus`, `coachGate`,
   `useCoachStatus({read})`; the members of `coachingKeys` / `coachKeys` and `CoachingMutation` /
   `CoachMutation` (§4.7.3); `LessonMutation`, `lessonIdemKey`, `lessonIntentKey(intent, kind)`,
   `clearLessonIntentKey`, `clearAllLessonIntentKeys`, prefix `MOBILE:lesson.<kind>:`;
   `PendingPayment.lessonEnrolmentId`; `PayScreen` `lessonBooked`; `isLessonPayment`;
   `DepositEdgeFunction` + `'lesson-begin'`; `VenueSettingsPublic.{coaching_enabled,
   lesson_payment_mode, lesson_prices_public}`, `Branch.coaching_enabled`, `anyCoaching`;
   `pendingLesson`; `useLessonBooking`, `useStartLessonPayment`, `useLessonEntry`, `lessonErrorText`;
   `normaliseCoachLink`, `coachShareUrl`, `COACH_LINK_PREFIXES` (app.config.ts); push
   `LESSON_PUSH_KINDS`, `isLessonPushKind`, the three new `TapDestination` kinds, `onOpenLesson`,
   `onOpenCoachLesson`, `onOpenCoachStatements`, `onLessonNotice`; components `CoachCard`, `OfferCard`,
   `ClassRow`, `LessonRow`, `LessonPoster`, `RosterRow`, `HoursDayEditor`, `TimeOffRow`,
   `StatementCard`, `PaymentModeChoice`, `PartyStepper`, `LinkConfirmCard` (`src/components/coaching.tsx`)
   and `DateTimeField`; the dependency `@react-native-community/datetimepicker` (production `eas
   build`); `RenderRouteOptions.coach`; the suites `coaching.smoke.test.tsx` and
   `coachMode.smoke.test.tsx`; testIDs `book.sheet.lessons`, `profile.coach-mode`, `profile.my-lessons`,
   `pay-status.view-lesson`.
6. **Folded (§1.11 web).** `src/lib/coaching.ts` (`parseCoachingPublic`, `coachPhotoUrl`);
   `CoachingStatus`, `CoachingRead`, `getCachedCoaching`, cache key `coaching-public`, tag `coaching`;
   `src/lib/site/coachLink.ts` exports (`parseCoachId`, `APP_COACH_URL`, `appCoachHref`,
   `coachLinkPath`); `src/styles/site/coaching.css.ts`, `coachLink.css.ts`; `site.footer.coaching`.
7. **Folded (§1.11 strings).** The fragment pairs `coaching.{common,guest,coach,web}.{en,ar}.ts`;
   `coaching.web` as the fourth sub-namespace; `coaching.common.count.*` (§4.15); `profile.myLessons`,
   `profile.coachMode`.
8. **Folded (edge, Money's as Guest reads it; amended by X14, X33).** `lesson-begin` body
   `{enrolment_id, locale}`, its answer and its full refusal list; `deposit_status`'s `purpose:
   'lesson'` and the union `lesson{}` (§4.3).
9. **New (§1.6, DB 0280; named by R44 and R61).** `lesson_link_confirm(p_enrolment_id uuid, p_yes
   boolean) returns jsonb` (guest, `guarded`) and `coach_accept_public() returns jsonb` (coach,
   `guarded`); `lesson_enrolments.link_confirmed_at` set at insert for a desk-picked customer (§4.3
   "What Guest needs" item 3); `enrolment_cancelled`'s `data.from` (item 2).
10. **New (§1.6 read fields).** `my_lessons.{booked_by, confirm_needed, rescheduled}`;
    `my_lesson.cancel.{free_because, refund_sessions, kept_sessions, next_start_at}`,
    `my_lesson.can.confirm`; `coach_me.coach.{bio_en, bio_ar, public_accepted, private_open,
    private_cap}` and its retired shape; `my_coach_statements.current_month`. Key lists:
    `packages/core/src/coaching/shapes.ts`, one export per read (`COACHING_PUBLIC_KEYS`, …).
11. **New (§1.11 mobile).** Route content `§4.8.10` (no new route); `confirmLessonLink`,
    `useConfirmLessonLink`, `parseLinkConfirm`, `coachAcceptPublic`, `insideCutoff`, `branchesOff`;
    `CoachingMutation` + `'confirm'`, `CoachMutation` + `'accept'`; testIDs `staff.coach-mode`,
    `my-lessons.confirm.<enrolmentId>`, `lesson-detail.confirm` (`.yes`, `.no`), `coach-mode.accept-sheet`,
    `coach-mode.accept`, `coach-mode.accept-later`, `coach-mode.banner.*`, `coach-mode-lesson.reason`
    (`.code`, `.note`), `coach-mode-new.start`.
12. **New (§1.11 strings).** `packages/i18n/src/catalogs/coaching.glossary.ts` (`COACHING_TERMS`, R55,
    imported by the operator's `ws/coaching*`); `coaching.common.count.lessons`;
    `profile.coachStatements`, `staff.shell.coachMode`, `staff.shell.coachStatements`; the legal keys
    of §4.16 (`collect.coaching`, `share.coachProfile`, `retention.coaching`, `deleteAccount.what.lessons`,
    `deleteAccount.what.coaching`, `terms.lessons`).

### 4.21 Defaults this lane takes, and the owner's questions

| # | Default |
| --- | --- |
| GL-1 | The Book tab gets a plain "Lessons with a coach" row; no count, no chips on the court grid. |
| GL-2 | Upcoming lessons sit in their own section on My reservations; past and cancelled ones on My lessons. |
| GL-3 | A paused coach keeps coach mode, with a banner and no new bookings (R16). |
| GL-4 | A coach's share link is the website's `/c/<coachId>` and names the coach, never a price. |
| GL-5 | The website shows accepted coaches' photos, names, bios and sessions with places; prices only behind C-11's switch. |
| GL-6 | A course session the coach creates repeats weekly at the same local time unless changed. |
| GL-7 | Coach mode's schedule opens on "All branches". |
| GL-8 | "Not now" on the accept sheet closes it for the visit; the banner stays until the coach accepts. |

**Owner questions** (still open, player-facing):
1. **Client:** «حصة» is decided for the lesson (C-30); the client still reviews course (دورة), coach
   (مدرّب), court share (أجرة الملعب), coach's share (نصيب المدرّب) and every **DRAFT-AR** line in this
   file; on CONTINUE's client list.

Nothing else in this lane waits on Parsa.
