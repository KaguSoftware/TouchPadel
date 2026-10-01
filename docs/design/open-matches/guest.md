# Open matches: the guest contract (lane Guest)

Date: 2026-09-28. Status: **final for the build, binding on lane Guest.** Nothing is built yet.

This file is §4 of `build-contracts-2026-09-27.md`, ready to fold in. It merges
`drafts/guest-2026-09-28.md` (superseded by this file) with the two reviews
(`drafts/review-concurrency-money-2026-09-28.md` = `C…`/`D…`, `drafts/review-decisions-rules-2026-09-28.md`
= `G…`/`D…`/§4.x), applies §1.12 R1–R38, and fixes every draft conflict. Where this file and §0, §1
or §1.12 disagree, those win, except for the changes listed in §4.30, which the merge writes into
§1.12. Code facts were checked on 2026-09-28 at `43625f39`. `NNNN:line` is a line of
`packages/db/supabase/migrations/2026…NNNN_*.sql`; other citations are repo paths.

**Before this file is committed:** `packages/db/fixtures/assistant-coverage.json` needs a `docs` entry
for it in the same commit, or `check:assistant-coverage` fails (G8b). Use
`"docs/design/open-matches/guest.md": "excluded: engineering build contract for the open-matches guest lane; not venue knowledge the owner asks about"`.
The two review files need the same kind of entry, and the draft entries (`:1004-1007`) go when the
drafts are deleted.

## 4. Guest app, web, push, links, legal (lane Guest)

### 4.0 What this lane owns, and the rules for all of it

**Owns:**
- migrations **0255** (`outbox_match_kinds`) and **0256** (`profile_names_gender`), and the
  Guest part of **0261** (`match_notify`, `match_sync_reminders`, the two push fan-out triggers);
- `send-push`'s guest family: `_shared/guest-push.json`, `send-push/guestStrings.ts`, the guest
  branch of `send-push/index.ts`, and the copy of the staff key `match_report_new` (R5);
- every guest screen in `apps/mobile`, the web invite page `apps/web/app/[locale]/m/[token]`,
  `LINK_PATHS`, the universal-link config;
- `packages/i18n/src/plural.ts` and the catalog pair `matches.en.ts` / `matches.ar.ts`;
- the legal and store copy.

It reads what DB (§2) and Money (§3) build. §4.3 is the read contract those lanes return: they may add
fields, never rename or drop these.

**Rules for every item below:**
1. Every match write is online-only and fails now (DF-11). Nothing is queued.
2. Nothing under the `['match']` query root is written to disk (§1.11).
3. No name reaches a lock screen (OM-31) or the web (DF-9).
4. The phone never computes a price, a share, a permission or a refusal. It renders what the server
   sends (`share_iqd`, the wallet counts, `me.can`, `me.refusal`) and parses every enum defensively:
   an unknown value falls back and never throws (the `parseDepositStatus` pattern,
   `apps/mobile/src/features/deposit/logic.ts:195`).
5. All Arabic in this file is a draft, marked **DRAFT-AR**, and goes on the client's review list.
   Buttons and text addressed to the reader never use a gendered imperative (§4.24).

### 4.1 Migration ordinals: the milestone moved up by three

§1.1 numbered the milestone 0249–0262 when 0248 was the latest file. On 2026-09-28, `43625f39` added
`20260928000249_staff_page_scopes.sql`, `…0250_batch_yield.sql` and `…0251_floor_orders.sql`. They
touch no function or table this build re-issues. The milestone now runs **0253–0265**: every §1.1
ordinal + 3, and §1.1 is updated the same way. Every ordinal in this file is the new one; the drafts
and the reviews still use the old ones. Check the directory again when the first file is written
(`packages/db/CLAUDE.md`, Migrations) and shift further if more files have landed. Dollar tags use the
file's ordinal (`$set_my_gender_0255$`).

| Old (drafts, reviews) | New | Name | Owner |
| --- | --- | --- | --- |
| 0249 | 0253 | `customer_flags_match_ban` | DB |
| 0250 | 0254 | `booking_payments_ticket_checks` | Money |
| 0251 | **0255** | `outbox_match_kinds` | **Guest** |
| 0253 | **0256** | `profile_names_gender` | **Guest** |
| 0254 | 0257 | `match_settings` | DB |
| 0255 | 0258 | `match_tables` | DB + Money |
| 0256 | 0259 | `ticket_purchase` | Money |
| 0257 | 0260 | `match_core` | DB |
| 0258 | **0261** | `match_guest_rpcs` | DB + **Guest** (§4.6) |
| 0259 | 0262 | `match_desk_money` | DB + Money |
| 0260 | 0263 | `match_reservation_triggers` | DB |
| 0261 | 0264 | `match_account_deletion` | DB |
| 0262 | 0265 | `match_reports` | Money + Ops |

### 4.2 The guest's model

A ticket is not the share. It is the promise to turn up. The guest still pays the full `share_iqd` at
the desk (OM-45), and every screen that mentions money says so.

| Moment | Tickets | Money | The guest reads |
| --- | --- | --- | --- |
| Buy 1–3 (Qi, `ticket-begin`) | + N `available` | N × price, online | "2 tickets ready" |
| Start, or join an instant match | `available → in_use`, one per seat (friends' seats use the holder's) | none | You're in |
| Ask to join (approve mode) | `available → reserved` | none | Request sent |
| Approved | `reserved → in_use`, seated at once | none | You're in |
| Declined, withdrawn, request closed | `reserved → available` | none | Tickets back |
| Leave while filling; removed by the organiser (OM-44) or the venue before booking; cancelled, bumped, expired, no court | `→ available` | none | Tickets back |
| Leave after booking, or removed by the venue after booking (`left_late`) | stays `in_use` | none | Held until someone takes your seat |
| That seat refilled (by a player or a desk walk-in) | `→ available` (or restored, if already forfeited) | none | Ticket back |
| Start comes with no refill | `→ forfeited` | none | Ticket lost |
| Attended | `→ available` | full `share_iqd` at the desk | Played |
| No-show | `→ forfeited` | share written off | Ticket lost |
| The desk corrects a no-show to attended, or the venue cancels the booking after marks | `forfeited → available` | as the new mark says | Ticket back (no push, GD-3) |
| Called off short (OM-47, R12) | attended `→ available`, no-show `→ forfeited` | nobody pays | Called off |
| Manager cash-out of a purchase (OM-48, R13) | that purchase's unused tickets `→ cashed_out`, once none of them is reserved or in use | one Qi refund | Refunded to your card |
| Account deleted (DF-20, R25) | unused tickets refunded, per purchase, as R13 | Qi refund | nothing (the account is gone) |

### 4.3 The read contracts the clients parse (R31 applied)

DB and Money own the bodies and the refusal order. These are the field names the phone and the web
read; the picks of both reviews' disagreement tables are applied (D12–D17, D33–D36).

**`match_slots(p_venue_id, p_from, p_to)`** (anon and authenticated, `publicByDesign`; D13)
```json
[{ "start_at": "…", "end_at": "…", "duration_min": 90, "category": "open|women|men",
   "join_policy": "open|approve", "seats_left": 1, "mine": false }]
```
- Public, listable, non-sandbox matches at an open branch with `matches_enabled`; signed-in callers
  get the DF-10 and block filters and their own sandbox flag. No ids, names or money.
- `mine` is always `false` for anon.
- A window **over 16 days** (`p_to − p_from > 16 days`) is `INVALID_ARGUMENT` (R27). The phone never
  sends more (§4.11).

**`match_invite(p_token)`** (anon and authenticated, `publicByDesign`; D12)
```json
{ "status": "open|full|closed", "start_at": "…", "end_at": "…", "timezone": "Asia/Baghdad",
  "category": "open|women|men", "join_policy": "open|approve", "seats_left": 2,
  "venue": { "name_en": "…", "name_ar": "…" } }
```
- `closed` carries no other field. A NULL, malformed, unknown or sandbox token, or a closed branch,
  answers `{"status":"closed"}` and never raises, so it is no oracle.
- `full` is DB's rule: `awaiting_court`, or booked with no open seat before start.
- `timezone` is `venues.timezone` of the match's branch.

**`open_matches(p_venue_id, p_from, p_to)`** (D14: no names, key `match_id`)
```json
{ "banned": false,
  "matches": [{ "match_id": "…", "start_at": "…", "end_at": "…", "duration_min": 90,
                "category": "…", "join_policy": "…", "status": "filling|booked",
                "seats_taken": 3, "seats_left": 1, "refill": false, "fill_deadline_at": "…",
                "share_iqd": 10000, "mine": "seated|requested|null" }] }
```
- `booked` rows appear only while an open seat exists before `start_at` (`refill: true`).
- A banned caller gets `banned: true` and an empty list. Window cap as `match_slots`.

**`match_detail(p_match_id, p_token)`**, full shape (D15: the union)
```jsonc
{ "id", "venue_id", "status", "ended_reason", "start_at", "end_at", "duration_min",
  "category", "visibility", "join_policy", "price_iqd", "shares_iqd", "fill_deadline_at",
  "seats_taken", "seats_total": 4, "court_id": null /* booked only */,
  "organiser": { "name", "former", "is_me" } | null,
  "seats": [{ "seat_id", "seat_no", "kind", "status", "name", "former", "holder_seat_no",
              "is_me", "is_mine", "share_iqd", "open",
              "can": { "remove", "report", "block" } }],
  "me": { "role": "organiser|player|requester|removed|viewer",
          "seats": [{ "seat_id", "seat_no", "kind", "status", "end_reason", "share_iqd",
                      "request_id", "ticket_status" }],
          "request": { "request_id", "status", "seats_requested" } | null,
          "excluded": false,
          "refusal": null | "<CODE>",
          "tickets_available": 2, "tickets_needed": 0,
          "leave_outcome": "release|locked_until_refill|none",
          "can": { "join", "request", "withdraw", "leave", "cancel", "remove", "decide",
                   "message", "report", "block", "share" } },
  "requests": [{ "request_id", "name", "former", "seats_requested", "friend_genders",
                 "games_played", "no_shows", "created_at" }],        /* organiser; pending only */
  "messages": [{ "code", "seat_no", "name", "former", "is_me", "at" }], /* participants; last 20 */
  "share_token": null | "<22 chars>",                                   /* organiser and seated players */
  "server_now": "…" }
```
- `seats[]` lists the occupying seats and the open `left_late` seats (`open: true`, `name: null`).
  A friend seat carries its **holder's** `name` and `former`, plus `holder_seat_no`. DB's nested
  `holder{}` may also be sent; the phone does not read it. Phones never appear.
- `seats[].can` is the server's answer for the viewer: `remove` (organiser, filling or awaiting a court, another holder's
  account or friend seat), `report` and `block` (the seat has an account behind it and it is not the
  viewer's). A typed desk seat is `false` on all three.
- `me.seats[]` includes a `desk` seat linked to the viewer (R32); its `ticket_status` is `null`.
- `me.refusal` is the code a join or request would raise now from the unlocked checks. It **never**
  carries `NEED_TICKETS` (D13): tickets travel through `me.tickets_available` and `me.tickets_needed`
  (tickets the viewer lacks for one seat). `GENDER_REQUIRED` drives the inline ask.
- `me.excluded` is true when a `match_exclusions` row exists for the viewer (OM-44).

**`match_detail`, restricted shape** (a token viewer who is banned, of the other gender, or blocked
either way; `match_visibility` = `restricted`)
```json
{ "restricted": true, "status": "…", "start_at": "…", "end_at": "…", "category": "…",
  "join_policy": "…", "seats_left": 2,
  "me": { "refusal": "MATCH_BANNED|MATCH_GENDER_MISMATCH|MATCH_UNAVAILABLE" }, "server_now": "…" }
```
No ids, no names, no seats. `restricted: true` is the marker the phone branches on (§4.18, R32).

**`my_matches(p_scope)`** (`upcoming` = not ended, plus anything ended in the last 24 h; `past` = the
rest; limit 100)
```json
[{ "match_id", "venue_id", "status", "ended_reason", "start_at", "end_at", "duration_min",
   "category", "join_policy", "visibility", "seats_taken", "court_id", "fill_deadline_at",
   "my_role": "organiser|player|requester|removed",
   "my_seats": [{ "seat_id", "seat_no", "kind", "status", "end_reason", "share_iqd", "request_id",
                  "ticket_status" }],
   "request": { "request_id", "status", "seats_requested", "decided_at" } | null,
   "my_tickets": { "locked": 1, "released": 0, "forfeited": 0 } }]
```
- Decided here (no review picked it): DB's `my_role` and `my_tickets` stay; Guest's `request{}`
  object replaces DB's `my_request_status`; each seat carries `end_reason`, `share_iqd`, `request_id`
  and `ticket_status`, which the state table (§4.15) needs. Linked desk seats are included.

**`my_tickets()`** (Money, 0259; D16: Money's shape plus Guest's three fields, marked `+`; the
phone reads the keys below and ignores Money's others, such as `purchases[].payment_id`)
```json
{ "price_iqd": 10000, "max_available": 9, "available": 2, "reserved": 0, "in_use": 1, "sandbox": false,
  "tickets": [{ "id", "status", "price_iqd", "sandbox", "bought_at", "purchase_payment_id",
                "match": null | { "match_id", "start_at", "venue_id", "status" },
                "forfeited_at", "cashed_out_at" }],
  "purchases": [{ "request_id", "status", "ticket_count", "unit_price_iqd", "amount_iqd",
                  "bought_at", "refund_reason", "refund_amount_iqd", "refunded_at" }],
  "pending": null | { "request_id", "status", "ticket_count", "amount_iqd", "form_url",
                      "deadline_at" },
  "server_now": "…" }
```
`+` fields: top-level `sandbox` (the profile's `payment_sandbox`), per-ticket `purchase_payment_id`,
`match.status`. `price_iqd` is today's ticket price; `max_available` is Money's wallet cap (MD-6),
which clamps the buy stepper (§4.10.1). Live tickets first, then the last 50 ended ones.

**`my_match_blocks()`**: `[{ "block_id", "name", "former", "created_at" }]`.

**`match_quote(p_venue_id, p_court_id, p_start_at, p_duration_min)`** (DB's shape, D17)
```json
{ "enabled": true, "price_iqd": 40000, "shares_iqd": [10000,10000,10000,10000],
  "duration_min": 90, "fill_deadline_at": "…", "earliest_start_at": "…",
  "categories": ["open","women"], "my_gender": "female", "tickets_available": 1,
  "ticket_price_iqd": 10000, "seats_max": 3, "filling_at_time": 1, "courts_free": 2,
  "refusal": null }
```
`refusal` follows the D13 rule too: never `NEED_TICKETS`; the phone compares `tickets_available`.

**Write results the phone reads.** `match_start` → `match_id`, `duplicate`; `match_join` →
`match_id`, `match_status`; `match_request` → `request_id`. After every write the phone refetches
`match_detail`, `my_matches` and `my_tickets`; the other return shapes are free for §2.

**`ticket-begin`** (Money, edge, `verify_jwt = true`): `POST {count, locale}` → 200
`{request_id, form_url, amount_iqd, ticket_count, unit_price_iqd, deadline_at, status:'pending', reused}`.
Refusals are `{ "error": "CODE", "detail"?: "…" }` with the HTTP codes of `money.md` §5.3 (`detail`
when the SQL refusal has one).

**`deposit_status` for a ticket** (Money, 0259): Money's JSON with `purpose: 'ticket'`,
`ticket_count`, `unit_price_iqd`, `tickets{from_this_purchase, available, reserved, in_use}`,
`reservation: null`, `hold_live: false`, `deposit_mode: null` (D33; the parser's `modeOf` already
turns it into `off`).

**Error details.** Several refusals carry a `detail` the phone reads (`NEED_TICKETS`
`{"needed","available","buy"}` as text, `MATCH_TOO_LATE` minutes, `TICKET_COUNT_INVALID`
`wallet_limit`, `REQUESTER_INELIGIBLE` the failing code). DB took C15 as its own code,
`MATCH_TIME_CLASH` (no detail; `db.md` §4.6, D-7, R41), not as a `MATCH_ALREADY_IN` detail.
PostgREST returns it as `error.details`. The phone has no reader today; §4.22 adds one.

**What Guest needs from DB, beyond the shapes** (the merge copies these into §2):
1. The `match_events` rows of §4.6.3, with `actor_guest_id` set for a guest actor, `seat_id` or
   `request_id` set where the table says, and `data.to_guest_id` on `organiser_changed`.
2. Request-expiry codes on the `request_expired` event: `match_full` (`match_try_book`),
   `organiser_gone` (`match_recompute_organiser`), `closed` (the sweep: past its cutoff while the match
   lives), `banned` (the sweep), and the match's `ended_reason` when `match_end` expires it.
3. `match_end` writes the seat and request changes before the match status and its event (as
   `db.md` §4.5.5 already says), and stamps `decided_at = now()` on the requests it expires.
4. The guest read windows are capped at 16 days (R27); DB's 8-day constant goes.

### 4.4 0255 `outbox_match_kinds`

CHECK widening only, alone in its file, landing after `send-push` carries the guest family (push A,
§4.8). The ten existing kinds are 0241:204-211 verbatim.

```sql
set lock_timeout = '3s';
set statement_timeout = '60s';

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info',
                  'deposit_refunded',
                  'match_update', 'match_reminder', 'match_message'))
  not valid;

do $validate_kind_check_0254$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0254$;
```

**Travels with it (R28):**
- `packages/db/src/types.gen.ts` regenerated in the commit (a CHECK is not typed, so no diff is
  expected; `pnpm db:types` must still show none).
- New `packages/db/tests/outbox-kinds.test.ts` (stack): the CHECK accepts each of the 13 kinds and
  refuses `match_bogus`; the kinds parsed from `pg_get_constraintdef` equal the booking kinds listed in
  the test ∪ `_shared/staff-push.json` `kinds` ∪ `_shared/guest-push.json` `kinds`. A kind without
  send-push copy then fails CI instead of failing terminally on hosted.
- `packages/db/CLAUDE.md`, "New push kind": the guest kinds take their copy from
  `send-push/guestStrings.ts`, not `STRINGS`.
- No RPC, matrix row, coverage key, SEC-20 declaration, error code or catalog key.
- `check-migrations` run locally before the push (R34).

### 4.5 0256 `profile_names_gender`

Guest writes the file; the rules are DB's (rules review D1; `db.md` §4.2). Guest's own gender-stamp
trigger rule is dropped: only the two definer RPCs write `gender`, and they stamp all three columns.

**Order inside the file:** columns → `split_person_name` → `trg_sanitise_profile` →
`trg_profile_names` and its trigger → `handle_new_user` → backfill → constraints (NOT VALID, then
guarded VALIDATE) → grants → `set_my_gender` → comments.

**Columns** (`add column if not exists`, nullable, no default, so no rewrite): `given_name text`,
`family_name text`, `gender text`, `gender_set_at timestamptz`, `gender_set_by text`.

**Constraints** (named, NOT VALID, VALIDATE inside a guard on `conname` and
`conrelid = 'public.profiles'::regclass`):

| Name | Rule |
| --- | --- |
| `profiles_given_name_len` | `given_name is null or char_length(given_name) between 1 and 39` |
| `profiles_family_name_len` | `family_name is null or char_length(family_name) between 1 and 39` |
| `profiles_name_parts` | `given_name is not null or family_name is null` |
| `profiles_gender_values` | `gender is null or gender in ('female','male')` |
| `profiles_gender_stamp` | `(gender is null) = (gender_set_at is null) and (gender is null) = (gender_set_by is null) and (gender_set_by is null or gender_set_by in ('guest','staff'))` |

`concat_ws(' ', given, family)` is at most 79 characters, so `profiles_full_name_len` (0116:98-116,
≤ 80) always holds.

**`app.split_person_name(p text) returns text[]`** (immutable; returns `{given, family}`; revoked from
public, anon, authenticated):
1. Tokens = `regexp_split_to_array(btrim(p), '\s+')`. NULL or empty input gives `{NULL,NULL}`.
2. `n = 1`. If token 1, lower-cased with `أ/إ/آ → ا`, is in `{عبد, ابو, abd, abdul, abdel, abdal, abu,
   abou}` and a second token exists, `n = 2`. If token 2 is then `al`, `el` or `ال` and a third token
   exists, `n = 3` ("Abd al Rahman").
3. `given = nullif(rtrim(left(tokens[1..n] joined by ' ', 39)), '')`;
   `family = nullif(rtrim(left(tokens[n+1..] joined by ' ', 39)), '')`. The clamp means an
   80-character legacy name never breaks the CHECKs.

**`app.name_initial(p_family text) returns text`** is DB's, in 0260 (`db.md` §4.5.2), beside
`match_display_name`, its only caller. The rule is this lane's and binds that body:
1. `s = btrim(p_family)`.
2. Drop one leading article: `آل` or `ال` followed by a space, hyphen or tatweel (`آل ياسين` → `ياسين`);
   an attached `ال` when at least two letters remain (`الربيعي` → `ربيعي`); Latin `al-`, `el-`, `al `,
   `el ` in any case (`Al-Rubaie` → `Rubaie`). `آلاء` stays whole (no separator after `آل`).
3. Return the first letter, `upper()`-ed; NULL when there is none. "Letter" is an explicit class:
   Latin A–Z, a–z and U+00C0–U+024F (without × and ÷), Arabic U+0621–U+063A, U+0641–U+064A and
   U+0671–U+06D3 (tatweel U+0640 excluded). Not `[[:alpha:]]`: its meaning follows the database's
   ctype, and under a C-like ctype Postgres classes only ASCII letters as alphabetic, so every Arabic
   initial would come back NULL. (`db.md` §4.5.2 carries this class.)
4. Known limit: a family name that starts with a non-article `ال` (`الياس`) loses it (`ي`). On the
   client review list.

**`app.trg_sanitise_profile`** re-issued from 0080:130, adding
`new.given_name := app.safe_line(new.given_name)` and the same for `family_name`. The trigger
`profiles_sanitise` is dropped and re-created `before insert or update of full_name, phone,
given_name, family_name`.

**`app.trg_profile_names()`** (security definer, revoked from clients), trigger
`profiles_sync_names` `before insert or update of full_name, given_name, family_name, deleted_at`.
It sorts after `profiles_sanitise`, so it sees clean text. First matching rule wins:

| # | Situation | Result |
| --- | --- | --- |
| 1 | `new.deleted_at is not null` | `given_name`, `family_name`, `gender`, `gender_set_at`, `gender_set_by` := NULL. This is the 0077 tombstone UPDATE (0077:187-192), so the erasure proof holds from this file on, before 0264 re-issues the deletion. |
| 2 | `current_setting('app.skip_name_sync', true) = 'on'` | nothing (the backfill only) |
| 3 | always, before 4–6 | an empty part becomes NULL |
| 4 | INSERT with `given_name` NULL | parts := `split_person_name(full_name)` |
| 5 | INSERT with `given_name` set, or UPDATE where `given_name` or `family_name` is distinct from OLD | `full_name := concat_ws(' ', given_name, family_name)` (the parts win, also when `full_name` changed in the same UPDATE) |
| 6 | UPDATE where only `full_name` is distinct from OLD (older builds, desk-created customers, staff edits) | parts := `split_person_name(full_name)` |

An UPDATE that lists a column without changing it matches no rule and changes nothing.

**`app.handle_new_user`** re-issued from 0069:204 verbatim, `$$` becoming `$handle_new_user_0255$`.
The insert gains `given_name` and `family_name`, taken from the metadata **only when they rebuild the
resolved name exactly**: with `g = nullif(rtrim(left(btrim(meta->>'given_name'), 39)), '')` and `f`
likewise, both are written when `concat_ws(' ', g, f) = v_name`; otherwise both stay NULL and rule 4
splits `v_name`. This keeps a metadata `given_name` without a surname from cutting `full_name` short.
The phone's sign-up sends all three keys (`apps/mobile/src/features/auth/api.ts:51-58`), so it always
takes the first path. Anonymous café sessions still return early.

**Backfill.** `perform set_config('app.skip_name_sync', 'on', true)`, then one WHERE-guarded UPDATE of
`profiles` where `deleted_at is null and given_name is null and full_name <> ''`: the clamped metadata
parts from `auth.users.raw_user_meta_data` when they rebuild `full_name` exactly, else
`split_person_name(full_name)`. Then `set_config('app.skip_name_sync', '', true)`. The flag keeps
`full_name` byte-identical: a family part clamped to 39 characters must not shorten a stored name.
Profiles are a few thousand rows, well inside the 60 s timeout.

**Grants.** `grant select (given_name, family_name, gender, gender_set_at, gender_set_by) on profiles
to authenticated` (row access stays `profiles_select`: own row, or court_desk, manager, owner);
`grant update (given_name, family_name) on profiles to authenticated`. `gender` has no update grant.

**`app.set_my_gender(p_gender text) returns jsonb`** (D36: DB's order, Guest's result field).
Security definer, `$set_my_gender_0255$`, `revoke … from public, anon`, `grant execute … to
authenticated`. In order:
1. `AUTH_REQUIRED` when `auth.uid()` is NULL.
2. `ACCOUNT_REQUIRED` when there is no profile or `deleted_at` is set (an anonymous café session stops
   here, which is what `check-rpc-authz` needs).
3. `INVALID_ARGUMENT` (hint `p_gender`) unless the value is `female` or `male`.
4. The same value already stored → `{gender, gender_set_at, duplicate: true}`.
5. A different value already stored → `GENDER_ALREADY_SET`.
6. Write `gender`, `gender_set_at = now()`, `gender_set_by = 'guest'`; audit `profile.gender_set`
   (`app.write_audit`); return `{gender, gender_set_at, duplicate: false}`.

**How a player is named to other players.** The body is DB's `match_display_name` (0260); the rule is
this lane's (OM-26):
- a deleted account gives `{name: null, former: true}`, printed "Former player";
- first = `given_name`, else the first word of `full_name`; initial = `name_initial(family_name)`;
  `name` = `"<first> <initial>."`, or first alone without a family name ("Ahmed K.", "أحمد ح.");
- a typed desk seat's `guest_name` goes through `split_person_name`, then the same rule;
- `name: null` without `former` is printed "Player".

**Travels with it (R28), all in the 0256 commit:**
- `packages/db/src/types.gen.ts` regenerated (five columns, `set_my_gender`).
- `tests/rls-matrix.ts`: one row in a new drop appended after the last (never restructure the file):
  `{ kind: 'rpc', schema: 'app', name: 'set_my_gender', args: { p_gender: 'x' }, expect:
  ex<RpcExpectation>('execute', { anon: 'denied', guest_anon_session: 'guarded' }) }` (the args of
  `db.md` §4.2). `'x'` is `INVALID_ARGUMENT`, so no principal writes anything.
- `fixtures/rpc-allowlist.json`: `set_my_gender` under `guarded`; `check-rpc-registry --update-floor`.
- `fixtures/assistant-coverage.json` `functions`: `set_my_gender` → `map:action`;
  `split_person_name`, `trg_profile_names` → `excluded: service_role only — profile name upkeep
  (0256)` (R30). `handle_new_user` and `trg_sanitise_profile` keep their entries.
- `tests/stored-fields.test.ts` (SEC-20, R29 Guest parts):
  - `Category` gains `'Other personal info'`, once (G5f); DB's later edits reuse it;
  - `profiles` gains `given_name` {Name, "shown to the guest and the desk; other open-match players
    see it", scrub}, `family_name` {Name, "other open-match players see only its first letter",
    scrub}, `gender` {Other personal info, "offering women-only and men-only open matches", scrub},
    `gender_set_at: n`, `gender_set_by: n`; `full_name`'s `why` becomes "shown to the guest and the
    desk; other players see only the first name and an initial";
  - the deletion proof sets all five columns (through the service role, all three gender columns
    together) before `delete_my_account` and asserts them NULL after. Seats, requests, blocks and
    `friend_genders` are DB's (0258, 0264).
- `scripts/check-broadcast-payloads.mjs:52` and `scripts/check-analytics-payload.mjs:41`: DB's nine
  patterns in one edit (D31), landing here because this file adds the first of those columns:
  `/given_name/i`, `/family_name/i`, `/\bgender\b/i`, `/share_token/i`, `/organiser_id/i`,
  `/reporter_id/i`, `/reported_id/i`, `/blocker_id/i`, `/blocked_id/i`. DB's 0258 adds none.
- Error codes (R11): `GENDER_ALREADY_SET` → `matches.errors.genderAlreadySet` in the mobile
  `CODE_TO_KEY`. This commit therefore creates and mounts the `matches` catalog pair (§4.24) with that
  key; later commits add theirs. R6 lands here too: `REQUEST_NOT_FOUND` re-pointed to
  `errors.requestGone`, `RATE_LIMITED` → `errors.tooManyRequests`, then
  `node scripts/check-error-codes.mjs --update` to take `RATE_LIMITED` off
  `fixtures/error-codes-unmapped.json:64` (G7a).
- No `assistant_readable_columns` row (R14 allows one; whether the assistant's lookup tools read these
  columns is Ops' call, and the privacy text of §4.25 covers it either way).
- `check:safeupdate` (the backfill has its WHERE).
- Tests: new `packages/db/tests/profile-names.test.ts`:
  - the split cases: `عبد الله …`, `أبو …`, `Abd al Rahman …`, one word, an 80-character name, `''`
    (the initial cases, `آل ياسين`, `الربيعي`, `آلاء`, `Al-Rubaie`, `Émile`, are DB's 0260 test);
  - each row of the trigger table, and an UPDATE that lists `full_name` unchanged;
  - `handle_new_user` with full metadata, with `given_name` only, with none (phone OTP), and anonymous;
  - the backfill leaves `full_name` byte-identical;
  - the grants: a guest updates the parts but not `gender`, and reads its own five columns;
  - `set_my_gender`: each refusal in order, the same answer twice, `GENDER_ALREADY_SET`;
  - deletion nulls the five columns.
  `oauth-profiles.test.ts` and `profiles-checks.test.ts` pass unmodified.

The phone's use of the new columns ships in a later commit, after this file is on hosted (§4.8, §4.9).

### 4.6 The Guest part of 0261

Guest writes these at the top of the 0261 file, before DB's guest RPCs. All four functions are
`security definer set search_path = public` and `revoke all … from public, anon, authenticated`.

**Callers and binding.** The fan-out triggers are the **only** caller of `match_sync_reminders`
(R26: its callers are named here). DB's bodies do not call it, so 0260 does not depend on 0261.
Money's re-issued `deposit_refund_apply` (0259) calls `match_notify` for `tickets_refunded` (D26);
PL/pgSQL binds late, so 0259 and 0261 land in the same push (push D) and are never split.

#### 4.6.1 `app.match_notify(p_match_id uuid, p_recipients uuid[], p_title_key text, p_params jsonb default '{}', p_actor uuid default null, p_scheduled_for timestamptz default null, p_dedupe text default null) returns int`

1. Validation, **outside** the exception block so tests see a bad call. `INVALID_ARGUMENT` when:
   - `p_title_key` is not a key of `c_keys` (hint `title_key`). `c_keys` is a `constant jsonb` copy of
     `guest-push.json` `title_keys` (key → kind); a test compares the two;
   - `p_params` is not an object, has a key outside `seats_taken`, `seats_total`, `minutes`, or a
     value that is not an integer (hint `params`);
   - `p_match_id` is NULL for any key but `tickets_refunded` (hint `p_match_id`).
2. The kind is `c_keys->>p_title_key`, so kind and key can never disagree (R3). The payload is
   `{route, id, title_key, params}` plus `dedupe` when given: route `tickets` and `id` null for
   `tickets_refunded`, route `match` and `id = p_match_id` for every other key.
3. Inside `begin … exception when others then raise warning 'match_notify: %', sqlerrm; return 0;
   end`: insert one `notification_outbox (profile_id, kind, payload, scheduled_for)` row per distinct
   recipient whose profile exists, has `deleted_at is null` and `expo_push_token is not null` (the
   guest-booking rule, 0090:159-163), is not `p_actor`, and, when `p_dedupe` is set, has no row with
   that `dedupe` in the last 15 minutes (the 0193 predicate). `scheduled_for` is
   `coalesce(p_scheduled_for, now())`.
4. When `p_scheduled_for` is NULL and a row was inserted, `perform app.push_nudge()`.
5. Return the number of rows inserted.

#### 4.6.2 `app.match_sync_reminders(p_match_id uuid) returns void`

Inside its own exception block (warning, never raise):
1. `delete from notification_outbox where kind = 'match_reminder' and sent_at is null and
   scheduled_for > now() and payload->>'id' = p_match_id::text`. The `scheduled_for > now()` and
   `sent_at is null` terms let the existing partial index `notification_outbox_due` serve it, so no
   new index is needed on a table with rows.
2. When the match is `booked` and `start_at − 3 h > now()`: `match_notify(p_match_id, <holders H>,
   'reminder_3h', '{}', null, start_at − 3 h, null)`.

A match booked inside its last 3 hours gets no reminder; `match_booked` has just arrived. The booking
family's upkeep (0090:176-205) is the precedent.

#### 4.6.3 The fan-out: which event sends what to whom

**Triggers.**
- `match_events_push`: `after insert on match_events for each row when (new.type in ('requested',
  'approved', 'declined', 'request_expired', 'joined', 'left', 'left_late', 'refilled', 'removed',
  'organiser_changed', 'awaiting_court', 'booked', 'moved', 'deadline_warning', 'message',
  'cancelled', 'bumped', 'expired', 'played', 'no_show', 'called_off_short'))` → `app.trg_match_event_push()`.
- `match_ticket_events_push`: `after insert on match_ticket_events for each row when (new.type =
  'forfeited')` → `app.trg_match_ticket_event_push()`.

Both bodies run inside `begin … exception when others then raise warning …; end` and return NULL, so a
push can never fail or roll back a match or ticket write. An AFTER ROW trigger sees the state the
writer left at that point of its transaction; §4.3 item 3 makes the terminal sets below exact.

**Recipient sets** (always minus the actor `new.actor_guest_id`, deleted profiles and profiles without
a push token, which `match_notify` drops):
- **H**, holders: distinct non-null `guest_id` of the match's `in` seats (account seats, friend
  seats' holders, linked desk seats);
- **L**: distinct `guest_id` of `left_late` seats;
- **E**, ended now: distinct `guest_id` of `cancelled` seats (on a match that has just ended, every
  such seat was ended by `match_end`);
- **R**, requests closed now: `guest_id` of requests with `status = 'expired'` and `decided_at = now()`;
- **O**: `matches.organiser_id`.

| `match_events.type` | Condition | Title key | To | `params` | Reminders |
| --- | --- | --- | --- | --- | --- |
| `requested` | — | `request_new` | O | — | — |
| `approved` | — | `request_approved` | the request's guest | — | — |
| `declined` | — | `request_declined` | the request's guest | — | — |
| `request_expired` | code `match_full`, `organiser_gone` or `closed` | `request_expired` | the request's guest | — | — |
| `request_expired` | any other code (`banned`, an end reason) | none: the match push covers it | — | — | — |
| `joined` | not a filling or awaiting match now at 4 occupying seats (its booked, waiting or bump push follows in the same transaction) | `player_joined` | O | seats | resync |
| `left`, `left_late` | — | `player_left` | O | seats | resync |
| `removed` | actor staff, or system (code `banned`, from `match_drop_ineligible`) | `player_left` to O (skipped when O is the removed holder), and `seat_removed` to the seat's holder | O; holder | seats (O only) | resync |
| `removed` | actor guest (the organiser, OM-44) | `seat_removed` | the seat's holder | — | resync |
| `refilled` | — | `seat_refilled` | the replaced seat's holder | — | resync |
| `organiser_changed` | `data.to_guest_id` not null | `organiser_handover` | `data.to_guest_id` | — | — |
| `awaiting_court` | — | `match_waiting_court` | H | — | — |
| `booked` | — | `match_booked` | H | — | resync |
| `moved` | — | `match_moved` | H ∪ L | — | resync |
| `deadline_warning` | — | `deadline_warning` | H | seats, minutes | — |
| `message` | code is one of the four | `msg_<code>` | H ∪ O | — | — |
| `cancelled` | code `organiser_cancelled`, `staff_cancelled`, `reservation_cancelled` or `venue_closed` | `match_cancelled` | E ∪ R | — | resync |
| `cancelled` | code `empty` | none | — | — | resync |
| `called_off_short` | — (DB writes the call-off as its own event type, not `cancelled`, `db.md` §4.5.5) | none | — | — | resync |
| `bumped` | code `bumped` | `match_bumped` | E ∪ R | — | resync |
| `bumped` | code `no_court` | `match_cancelled` | E ∪ R | — | resync |
| `expired` | code `deadline` | `match_expired` | E ∪ R | — | resync |
| `expired` | code `no_court` | `match_cancelled` | E ∪ R | — | resync |
| `played`, `no_show` | — | none | — | — | resync |

| `match_ticket_events.type` | Title key | To | Dedupe |
| --- | --- | --- | --- |
| `forfeited` (a no-show mark, or an unrefilled late leave at start) | `ticket_forfeited` | the ticket's `guest_id`, with `id = new.match_id` | `m:<match>:ticket_forfeited` (a holder whose friend also missed gets one push) |

`tickets_refunded` is queued by Money's `deposit_refund_apply` on a succeeded ticket refund, for a
non-sandbox row: `match_notify(null, array[bp.guest_id], 'tickets_refunded', '{}', null, null,
'tickets_refunded:'||bp.request_id)`, exception-guarded (D26; `money.md`). No other code queues a guest kind.

- "resync" = `perform app.match_sync_reminders(new.match_id)` after the push.
- `seats` = `{seats_taken: <occupying seats now>, seats_total: 4}`; `minutes` =
  `greatest(1, ceil(extract(epoch from fill_deadline_at − now()) / 60))`.
- **Not pushed, on purpose:** `started`, `withdrawn` (the guest did it), `seat_attended`,
  `seat_no_show`, `seat_unmarked`, `played`, `called_off_short` (the players are at the desk; the
  no-show hears through `ticket_forfeited`), a `restored` ticket (GD-3). The WHEN clause keeps the
  seat marks out of the trigger altogether.
- A `no_court` ending uses `match_cancelled`: "a group booked the last court" would be false (R32).

**Dedupe keys** (15 minutes per recipient): `player_joined`, `player_left`, `deadline_warning` →
`m:<id>:<key>:<seats_taken>`; `msg_*` → `m:<id>:msg:<actor>:<code>`; everything else →
`m:<id>:<key>`. `reminder_3h` has none (the resync deletes before it queues).

#### 4.6.4 What travels with the Guest part of 0261 (R28)

- `fixtures/assistant-coverage.json` `functions`: `match_notify`, `match_sync_reminders`,
  `trg_match_event_push`, `trg_match_ticket_event_push` → `excluded: service_role only — open-match
  push fan-out (0261)` (R30).
- No `rls-matrix.ts` row and no allowlist entry: nothing here is granted.
- `check:locks`: the walker expands both triggers under every writer of `match_events` and
  `match_ticket_events`. Their bodies lock nothing ranked (`notification_outbox` and `profiles` are
  not in `ORDER`), so no sequence changes. Run it after 0261 anyway.
- `types.gen.ts` rides with DB's 0261 commit.
- The staff key `match_report_new` (§4.7.5).
- New `packages/db/tests/guest-push.test.ts` (stack):
  - `match_notify`: the closed shape; each `INVALID_ARGUMENT` case; actor, deleted and tokenless
    recipients skipped; dedupe inside and outside 15 minutes; the kind taken from the key; a failing
    insert returns 0 and the caller's write commits; the nudge only for unscheduled rows;
  - `c_keys` parsed from `pg_get_functiondef` equals `guest-push.json` `title_keys` (the
    `staff-push.test.ts:178-190` pattern);
  - each row of both fan-out tables queues exactly its key to exactly its recipients, and the silent
    events queue nothing; a join to 4/4 queues `match_booked` and no `player_joined`; a bump queues
    `match_bumped` to seat holders and pending requesters once each;
  - reminders: `booked` queues `reminder_3h` at `start_at − 3 h` for `in` holders only; a move
    reschedules it; a late leave drops that holder; an end clears it; a match booked inside 3 hours
    gets none.

### 4.7 `send-push`: the guest family and the staff key

#### 4.7.1 `packages/db/supabase/functions/_shared/guest-push.json` (new)

One list for three copies (as `staff-push.json`): `send-push`, `app.match_notify`'s `c_keys`, and the
phone's `features/matches/pushRoutes.ts`. Tests hold each copy to it.

```json
{ "_readme": "The guest push catalogue for open matches (build contracts §1.9, R3; guest.md §4.7). ONE list for three copies: send-push (guestStrings.ts reads copy by title_key), app.match_notify (c_keys; packages/db/tests/guest-push.test.ts compares), and apps/mobile/src/features/matches/pushRoutes.ts (routes). Add a key here, in guestStrings.ts (EN and AR) and in app.match_notify in the same change, and deploy send-push before a migration can queue it.",
  "kinds": ["match_update", "match_reminder", "match_message"],
  "title_keys": {
    "request_new": "match_update", "request_expired": "match_update",
    "player_joined": "match_update", "player_left": "match_update",
    "request_approved": "match_update", "request_declined": "match_update",
    "match_booked": "match_update", "match_waiting_court": "match_update",
    "deadline_warning": "match_update", "match_cancelled": "match_update",
    "match_bumped": "match_update", "match_expired": "match_update", "match_moved": "match_update",
    "reminder_3h": "match_reminder", "organiser_handover": "match_update",
    "seat_removed": "match_update", "seat_refilled": "match_update",
    "ticket_forfeited": "match_update", "tickets_refunded": "match_update",
    "msg_on_my_way": "match_message", "msg_running_late": "match_message",
    "msg_cant_make_it": "match_message", "msg_bring_balls": "match_message" },
  "routes": ["match", "tickets"],
  "params": ["seats_taken", "seats_total", "minutes"] }
```

#### 4.7.2 `send-push/guestStrings.ts` (new)

Pure, no imports, no `Deno.*`, no fetch; arranged like `staffStrings.ts` so vitest runs it.
- `GUEST_STRINGS[lang][title_key] = { title: 'match' | 'reminder' | 'tickets', form: 'none' |
  'category' | 'reader', body: (v: GuestVars) => string, bodyF?: (v: GuestVars) => string }`.
  `GuestVars` = `{taken, total, minutes, when, time, branch}`, each already a string, isolated, '' when
  absent.
- `form: 'category'` picks `bodyF` in a `women` match (a third person: "a player", "the organiser");
  `form: 'reader'` picks `bodyF` when the recipient's `profiles.gender` is `female`, NULL counting as
  masculine (`organiser_handover`).
- Titles: `match` → "Open match · {when}" / «مباراة مفتوحة · {when}», adding " · {branch}" when more
  than one venue is active; `reminder` → "Your match is in 3 hours" / «مباراتك بعد 3 ساعات»;
  `tickets` → "Ticket refund sent" / «استرداد ثمن التذاكر».
- `guestMessage(lang, kind, payload, ctx, routes)` → `{ok: true, title, body, data}` or
  `{ok: false, error}` with `UNKNOWN_TITLE_KEY:<k>`, `KIND_MISMATCH:<kind>/<k>` (the row's kind is not
  the key's kind), `BAD_ROUTE`. `data` = `{kind, route, title_key}` plus `id` when it is a string;
  never a name or an amount.
- Its own `pluralForm` copy (Deno cannot import `@touch/i18n`); a test proves it answers as
  `packages/i18n/src/plural.ts` for 0..300 in both languages. `{minutes}` is a counted phrase
  (§4.24); `{taken}/{total}` is LTR-isolated; every other value is FSI-isolated.

#### 4.7.3 `send-push/index.ts`

- Import `guest-push.json` and `guestMessage`; `GUEST_KINDS` and `GUEST_ROUTES` beside `STAFF_KINDS`
  (`index.ts:55-56`). Update the header comment: three families.
- `OutboxRow.kind` gains the three kinds (`:136-146`); the payload type already has `route`, `id`,
  `title_key`, `params`.
- The profiles read (`:189`) also selects `gender`.
- One more batch read per claim, only when guest rows are present:
  `matches (id, start_at, venue_id, category)` for the payload ids, and
  `venues (id, name_en, name_ar, timezone, is_active)`. `{branch}` is shown when more than one venue
  is active.
- A guest branch before the booking `STRINGS` lookup (`:234`), shaped like the staff branch
  (`:211-233`). Terminal errors (`attempts: RETRY_CAP`, as `:236-242`): `MATCH_GONE` (a `match` route
  whose id names no match), and the three `guestMessage` errors.
- Guest rows format times in the match's branch timezone with Latin digits:
  `Intl.DateTimeFormat(lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB', {timeZone, weekday: 'short',
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})` for `{when}`, hour and minute
  only for `{time}`. The app pins Latin digits the same way (`packages/i18n/src/formatting.ts:20`).
  The booking kinds keep `formatWhen` as it is.
- `priority: 'high'` and `channelId: ANDROID_CHANNEL_ID`, as every kind.

#### 4.7.4 The copy (EN, then AR **DRAFT-AR**; m / f where the form differs)

| Title key | EN body | AR body |
| --- | --- | --- |
| `request_new` | A player asked to join your match. | طلب لاعب الانضمام إلى مباراتك. / طلبت لاعبة الانضمام إلى مباراتك. |
| `request_expired` | Your request to join closed. Your tickets are back in your wallet. | أُغلق طلب انضمامك، وعادت تذاكرك إلى محفظتك. |
| `player_joined` | A player joined · {taken}/{total} | انضم لاعب · {taken}/{total} / انضمت لاعبة · {taken}/{total} |
| `player_left` | A player left · {taken}/{total} | غادر لاعب · {taken}/{total} / غادرت لاعبة · {taken}/{total} |
| `request_approved` | You're in. The organiser approved your request. | وافق المنظّم على طلبك، ولك مقعد في المباراة. / وافقت المنظّمة على طلبك، ولك مقعد في المباراة. |
| `request_declined` | Your request wasn't accepted. Your tickets are back in your wallet. | لم يُقبل طلبك، وعادت تذاكرك إلى محفظتك. |
| `match_booked` | Four players are in and the court is booked. See you there! | اكتمل العدد وحُجز الملعب. نراك هناك! |
| `match_waiting_court` | Four players are in. We'll book the court as soon as one is free. | اكتمل العدد، وسنحجز الملعب فور توفّره. |
| `deadline_warning` | {minutes} left to fill · {taken}/{total} | بقيت {minutes} لاكتمال العدد · {taken}/{total} |
| `match_cancelled` | The match was cancelled. Your tickets are back in your wallet. | أُلغيت المباراة، وعادت تذاكرك إلى محفظتك. |
| `match_bumped` | A group booked the last free court, so the match was cancelled. Your tickets are back in your wallet. | حجزت مجموعة آخر ملعب متاح، فأُلغيت المباراة وعادت تذاكرك إلى محفظتك. |
| `match_expired` | The match didn't fill in time and was cancelled. Your tickets are back in your wallet. | لم يكتمل العدد في الوقت المحدد، فأُلغيت المباراة وعادت تذاكرك إلى محفظتك. |
| `match_moved` | The venue moved your match to {when}. | نقل النادي مباراتك إلى {when}. |
| `reminder_3h` | {time}{ · branch} | {time}{ · branch} |
| `organiser_handover` | You're now the organiser of this match. | أصبحت منظّم هذه المباراة. / أصبحت منظّمة هذه المباراة. (reader form) |
| `seat_removed` | You're no longer in this match. Open the app for details. | لم يعد لك مقعد في هذه المباراة، والتفاصيل في التطبيق. |
| `seat_refilled` | Another player took your seat. Your ticket is back in your wallet. | أخذ لاعب آخر مقعدك، وعادت تذكرتك إلى محفظتك. / أخذت لاعبة أخرى مقعدك، وعادت تذكرتك إلى محفظتك. |
| `ticket_forfeited` | Your ticket for this match is lost because you didn't play in it. | فُقدت تذكرة هذه المباراة لعدم اللعب فيها. |
| `tickets_refunded` | Your ticket refund was sent to your card. When it shows depends on your bank. | أُرسل المبلغ المستردّ إلى بطاقتك، ويعتمد موعد ظهوره على مصرفك. |
| `msg_on_my_way` | A player is on the way. | لاعب في الطريق. / لاعبة في الطريق. |
| `msg_running_late` | A player is running late. | لاعب سيتأخر قليلًا. / لاعبة ستتأخر قليلًا. |
| `msg_cant_make_it` | A player can't make it. | لاعب لن يتمكن من الحضور. / لاعبة لن تتمكن من الحضور. |
| `msg_bring_balls` | A player asks: who's bringing balls? | لاعب يسأل: من سيحضر الكرات؟ / لاعبة تسأل: من ستحضر الكرات؟ |

- `form: 'category'` for `request_new`, `player_joined`, `player_left`, `request_approved`,
  `seat_refilled` and the four `msg_*`; `'reader'` for `organiser_handover`; `'none'` for the rest.
- Every body names nobody and carries no money (OM-31, §1.9).
- The review's point about "used up" is taken (§4.1 item 6 of the rules review): `ticket_forfeited`
  says the ticket is lost and why, with no name; the verbal noun keeps the Arabic neutral.

#### 4.7.5 The staff key `match_report_new` (R5)

- `_shared/staff-push.json` `title_keys` gains `match_report_new`, appended **last** (38 keys; the
  order is compared with `notify_staff`'s `c_title_keys`, `tests/staff-push.test.ts:178-190`).
- `send-push/staffStrings.ts`: EN `{title: 'Player report', body: () => 'A report about a player is
  waiting for review.'}`; AR `{title: 'بلاغ عن لاعب', body: () => 'بلاغ عن لاعب بانتظار المراجعة.'}`
  **DRAFT-AR**. No params, so nothing personal reaches a lock screen.
- `tests/send-push-staff.test.ts`: the key count becomes 38 (`:81`) and a `MATCH_KEYS =
  ['match_report_new']` slice from 37 joins the `ROLE_SPEC_KEYS` / `WAVE5_KEYS` checks.
- DB's `match_report` calls `notify_staff(<manager and owner ids at the branch, app.staff_ids_with_roles
  (0160:63)>, 'staff_info', {route: 'staff', id: <report id>, title_key: 'match_report_new', params: {}},
  'match_report:'||<report id>)`. The staff phone opens its home for route `staff`.

**When it ships: with DB's 0261 commit (push D), not in push A. This amends R5 (§4.30).** The stack
test above compares the JSON with the body of `notify_staff`, which only DB's 0261 re-issue changes; a
push A carrying the key would turn CI red until push D. Shipping the JSON, `staffStrings.ts`, the pure
test and the re-issue in one commit keeps every commit green. It is still safe on hosted: in push D
both workflows start at once, but no report can be filed before a match exists, and no match can exist
while `matches_enabled` is false everywhere (starts and joins refuse `MATCHES_OFF`, R10). The flag is
switched on only after push D's `functions-deploy` run is green.

#### 4.7.6 Tests

- New `packages/db/tests/send-push-guest.test.ts` (pure, vitest): `GUEST_STRINGS` keys equal the
  JSON's in both languages; every title and body non-empty, AR different from EN; the m/f choice by
  category and by reader; plurals of `{minutes}` for 1, 2, 3, 11, 30, 100; isolation marks around every
  value; `KIND_MISMATCH`, `UNKNOWN_TITLE_KEY`, `BAD_ROUTE`; `data` never carries a name or amount; the
  `pluralForm` copy equals `@touch/i18n`'s for 0..300.
- `tests/send-push-staff.test.ts` as §4.7.5.

### 4.8 Landing order for the whole lane

Root `CLAUDE.md` applies to every push: the gates first, then every run watched to green, never an AI
co-author, pushes batched. Parsa pushes; the harness never deploys to hosted.

| Push | Contents | Condition before it | Check after it |
| --- | --- | --- | --- |
| **A**: functions only | `guest-push.json`, `guestStrings.ts`, the `send-push/index.ts` guest branch, `send-push-guest.test.ts`. Money's `_shared/deposits.ts` type change may ride. No staff key, no `ticket-begin`, no `config.toml`. | — | `functions-deploy.yml` green |
| **B** | 0253, 0254, 0255 (three CHECK-only files) and `outbox-kinds.test.ts` | A's deploy green (an unknown kind is terminal in a stale `send-push`, `index.ts:234-242`) | `db-migrate.yml` green; `migration list --linked` shows 0 pending |
| **C** | 0256 with its gates (§4.5), the `matches` catalog pair, R6 | B hosted | as B |
| **C2** | the phone's names plumbing (§4.9): two-name fields, the new profile selects, GenderAsk's read of `gender` | C hosted. A build that selects `given_name` before 0256 is on hosted gets 42703 and every profile read fails. JS only: OTA on the current runtime (`app.config.ts:227`), or with the next build | smoke EN + AR |
| **D** | 0257–0265, each commit with its gates (R28); the 0261 commit carries the staff key (§4.7.5); `matches_enabled` false everywhere | C hosted | both workflows green; `cron.job` has `tp_match_sweep` |
| **E**: functions | `ticket-begin`, `config.toml` `[functions.ticket-begin] verify_jwt = true` (Money) | 0259 hosted | `functions-deploy.yml` green |
| **F**: web and docs | `/[locale]/m/[token]`, `LINK_PATHS`, the store docs. **Not** the legal catalogs (they go with the 1.0 terms bump, row 1.0 below). Vercel `APPLE_TEAM_ID=BR42V976FS` set first: both `.well-known` routes are `force-static` | `match_invite` hosted (D) | the Vercel build green; `/.well-known/apple-app-site-association` lists `/m/*`, `/en/m/*` and `/ar/m/*` |
| **G**: the native build | every screen, `intentFilters`, `EXPO_PUBLIC_LINK_DOMAIN` ×3, `+native-intent.ts`. A new dev client, then TestFlight and an internal APK. Parsa runs the production `eas build` (`apps/mobile/CLAUDE.md`) | D, E and F live | the device checks of §4.27 |
| trial | `matches_enabled` on at one branch; sandbox review profiles (§4.26) | G on TestFlight | — |
| **1.0** | one commit: the legal catalogs (§4.25), the web terms page's new section, `CURRENT_TERMS_VERSION` (`packages/core/src/legal/terms.ts:13`) moved to the publication date; then the store build; then, by migration, `platform_settings.match_terms_version` = that date, only after the build is on phones (otherwise every match action loops on `TERMS_REQUIRED`); then the store answers (§4.26), the store URLs on Vercel, and `ANDROID_SHA256_FINGERPRINTS` once the Play listing exists, followed by a redeploy | — | — |

### 4.9 Names and gender on the phone (push C2)

**`app/profile-edit.tsx`**
- The single `profile-edit.name` field (`:162`) becomes `profile-edit.first-name` and
  `profile-edit.last-name`, labelled `auth.firstNameLabel` and `auth.lastNameLabel`
  (`packages/i18n/src/catalogs/en.ts:65-66`), each `maxLength={39}`.
- The first name is required (`auth.firstNameRequired`); the surname is optional here, because
  single-name guests exist (sign-up still requires it).
- Both saves (`:109` and `:131`) send `{given_name, family_name}` (plus `phone` where they do today);
  the server rebuilds `full_name` (§4.5, rule 5).
- Under the surname, `profile.nameShownHint`: "Other players in an open match see your first name and
  the first letter of your surname." / «يرى اللاعبون الآخرون في المباراة المفتوحة اسمك الأول والحرف
  الأول من اسم عائلتك.» **DRAFT-AR**
- When `gender` is set, a read-only line: `profile.genderFemale` "Women-only and men-only matches:
  you're listed as a woman. The front desk can change this." / «مباريات النساء ومباريات الرجال: أنتِ
  مسجّلة امرأة، ويمكن لموظفي الاستقبال تعديل ذلك.», and `profile.genderMale` likewise («أنتَ مسجّل
  رجلًا»). **DRAFT-AR.** The reader's own gender picks the form, so the Arabic may be gendered here.

**`app/complete-profile.tsx`**: `complete-profile.name` (`:193`) becomes `complete-profile.first-name`
and `complete-profile.last-name` with the same hint; the prefill (`:85`) runs `prefillDisplayName`
(`features/auth/social.ts:261-273`) over `given_name`, falling back to `full_name`; the save (`:158`)
sends `{given_name, family_name, phone}`. The primary `complete-profile.submit` is unchanged.

**`app/sign-up.tsx`**: `sign-up.first-name` (`:224`) and `sign-up.last-name` (`:235`) gain
`maxLength={39}`, so the server never has to clamp a part.

**Plumbing**
- `features/profile/api.ts`: `ProfileRow` (`:14-19`) gains `given_name`, `family_name` (string or
  null) and `gender` (`'female' | 'male' | null`); `fetchOwnProfile` (`:27`) selects them;
  `updateOwnProfile` (`:75-80`) accepts `given_name` and `family_name`.
- `app/verify-result.tsx:35` greets with `given_name`, falling back to the first word of `full_name`.
- The Apple name patch (`features/auth/useSocialSignIn.ts:146-155`) keeps writing `full_name`; the
  trigger splits it. `needsProfileCompletion` (`social.ts:161-168`) is unchanged, so no existing guest
  is trapped.
- `useSetMyGender()` in `features/matches/hooks.ts` (mutation key `matchKeys.mutation('gender')`)
  calls `set_my_gender` and, on success, invalidates `profileKeys` and `matchKeys.all`.

**`GenderAsk`** (in `src/components/match.tsx`): an inline card, not a modal. Required `testID`,
forwarding `${testID}.female` and `${testID}.male`.
- Shown on `match-new` and on the detail's action card whenever the own profile's `gender` is NULL
  (OM-28: asked once, at the first match; DF-10: an unset gender sees both categories and is asked
  here).
- Copy: "Before your first open match: are you a woman or a man? We ask once, so that women-only and
  men-only matches reach the right players. The front desk can correct it." / «قبل أول مباراة مفتوحة:
  هل أنت امرأة أم رجل؟ نسأل مرة واحدة فقط لتصل مباريات النساء ومباريات الرجال إلى اللاعبين
  المناسبين، ويمكن لموظفي الاستقبال تصحيح ذلك.» **DRAFT-AR**. Buttons "Woman" / «امرأة», "Man" /
  «رجل».
- `GENDER_ALREADY_SET` (another device answered first): toast `matches.errors.genderAlreadySet`, then
  the profile refetch shows the stored value.

**How the phone prints a player** (pure `displaySeat(seat, category, t)` in
`features/matches/logic.ts`):
- `former` → `matches.common.formerPlayer` "Former player" / «لاعب سابق» (`formerPlayerF` «لاعبة
  سابقة» in a `women` match);
- `name` NULL → `matches.common.player` "Player" / «لاعب» (`playerF` «لاعبة»);
- a friend seat → `{name} +{k}`, with `isolate(name)` and `isolateLtr('+' + k)` (§4.24), where `k`
  numbers that holder's friend seats in `seat_no` order ("Ahmed K. +1", "Ahmed K. +2");
- otherwise `isolate(name)`.

### 4.10 Tickets on the phone

#### 4.10.1 `app/tickets.tsx` (route `tickets`, `RequireSession`)

- **Params:** `buy?` (1–3) preselects the count; `for?` (`join` | `request` | `start`) only picks the
  context line.
- **Data:** `useMyTickets()` (`matchKeys.tickets`), and `useVenueSettings()` for the branch phone.
- **Layout, top to bottom:**
  1. **Wallet card** (not pressable): `matches.count.ticketsReady` in `display900` ("2 tickets
     ready"), then a line per non-zero count: `matches.count.ticketsHeld` ("1 held for a request"),
     `matches.count.ticketsInMatch` ("1 in a match"). A sandbox wallet shows the "Test tickets" pill,
     like `deposit.sandbox`.
  2. **Purchase in progress** (`tickets.pending`, when `pending` is set; rules review §4.1 item 9):
     "Payment in progress · Continue" → `/pay/status?ref=<pending.request_id>`.
  3. **Need line** when `buy` is set: "To join this match you need {tickets} more." (`needJoin`;
     `needStart`, `needRequest` per `for`).
  4. **Buy card:** a `SegmentedControl` 1 | 2 | 3 (`tickets.count`), offering only counts up to
     `max_available − available` (none left: `matches.errors.walletLimit` in place of the card); the line "{count} × {price} =
     {total}" from `price_iqd`; the primary `tickets.buy`, label `matches.tickets.buy` "Pay with Qi
     Card" (a static key, G10); the note `matches.tickets.buyNote` "Paid online by Qi Card. A ticket
     is not your share of the court: you still pay your share at the desk."
  5. **How tickets work** (`tickets.rules`, expandable), the seven rules below.
  6. **Ticket rows** (`tickets.row.<id>`): a `reserved` or `in_use` ticket reads "Held for a request ·
     {weekday} {time}" or "In a match · {weekday} {time}" and opens `/match/[id]` (`match.match_id`);
     history rows read "Lost · {date}" or "Refunded to your card · {date}". `available` tickets are
     the count, not rows.
  7. **Cash-out note** (OM-48, R13): "Money back for tickets you haven't used: ask at the front desk.
     A manager refunds a purchase's unused tickets to the card you paid with, once none of that
     purchase's tickets is in a match." / «لاسترداد ثمن التذاكر غير المستخدمة: يمكن مراجعة الاستقبال.
     يردّ المدير ثمن التذاكر غير المستخدمة من عملية شراء واحدة إلى البطاقة التي دُفع بها، بعد أن تخرج
     كل تذاكر تلك العملية من المباريات.» **DRAFT-AR**
- **States:** `SkeletonList` while loading; `ErrorState` (`tickets.error`) with retry.
- **Buy refusals** (from `ticket-begin`, §4.22): `PHONE_REQUIRED` → `/complete-profile?returnTo=back`;
  `TERMS_REQUIRED` → `/accept-terms`, or `matches.errors.updateApp` on an old build;
  `TICKET_COUNT_INVALID` with detail `wallet_limit` → `matches.errors.walletLimit`;
  `TOO_MANY_ATTEMPTS` → `matches.tickets.tooManyAttempts`; everything else inline through
  `mapErrorToKey`. A `reused: true` answer opens that attempt's status screen with its own count.

"How tickets work" (EN, then AR **DRAFT-AR**):
1. One ticket per seat. Seats you take for friends use your tickets. / تذكرة واحدة لكل مقعد، ومقاعد
   أصدقائك تُحسب من تذاكرك.
2. Joining puts a ticket in use. It comes back to your wallet after you play. / الانضمام يضع التذكرة
   قيد الاستخدام، وتعود إلى محفظتك بعد اللعب.
3. Asking to join holds a ticket until the organiser answers. / طلب الانضمام يحجز التذكرة إلى أن يردّ
   المنظّم.
4. If a match is cancelled or doesn't fill, your tickets come back. / إذا أُلغيت المباراة أو لم يكتمل
   عددها، تعود تذاكرك.
5. Leave before the court is booked and the ticket comes back. Leave after, and it stays held until
   another player takes your seat; if nobody does before the start, it's lost. / المغادرة قبل حجز الملعب
   تعيد التذكرة. أما بعد الحجز فتبقى التذكرة محجوزة إلى أن يأخذ لاعب آخر مقعدك، وإن لم يأخذه أحد قبل
   البدء فُقدت.
6. Don't show up and the ticket is lost. Tickets never expire. / الغياب يُفقدك التذكرة. والتذاكر لا تنتهي
   صلاحيتها.
7. You still pay your share of the court at the desk. / تبقى حصتك من سعر الملعب مستحقة عند الاستقبال.

#### 4.10.2 Buying: `ticket-begin` → the pointer → `pay/status`

- **Edge client.** `features/deposit/api.ts:33`: `DepositEdgeFunction` gains `'ticket-begin'`; a new
  `ticketBegin(client, {count, locale})` goes through `invokeDepositEdge` (`:44-66`), so a refusal is a
  `DepositEdgeError` whose message is the code. `DepositEdgeError` gains `detail`, read from the body's
  `detail`; Money's edge sends `{error, detail}` when the SQL refusal has a detail (§4.30).
- **Hook.** `useStartTicketPurchase()` in `features/matches/tickets.ts`, a copy of `useStartPayment`
  (`deposit/hooks.ts:125-158`): `ticket-begin` → `savePendingPayment({ref, reservationId: '',
  deadlineAt, purpose: 'ticket', after})` → `claimResume(ref)` → `router.replace('/pay/status', {ref})`
  → `openPaymentPage(form_url)`. Mutation key `matchKeys.mutation('buy')`.
- **The pointer** (`features/deposit/pendingPayment.ts`): `PendingPayment` gains
  `purpose?: 'deposit' | 'ticket'` and `after?: TicketContinuation`; `serializePendingPayment` (`:47`)
  writes them; `parsePendingPayment` (`:52`) keeps accepting old pointers (no purpose means
  `deposit`; an empty `reservationId` is already valid) and drops a malformed `after` instead of the
  pointer. The key `tp.pendingPayment.<uid>` and its SEC-16 purge (`features/profile/purgeKeys.ts:64`)
  are unchanged; the purge list's comment gains one sentence.
- **Resume paths.** `NOT_RESTING` (`:121-136`) gains `/tickets`, `/match-new` and `/match-report`, and
  `isResumeSafePath` (`:138`) returns false for `pathname.startsWith('/m/')`: a resume never jumps
  over a screen mid-flow.

#### 4.10.3 `NEED_TICKETS` → buy → continue the same action

**Pre-check.** On `match-new` and the detail's action card, once the wallet has loaded, `available <
seats wanted` swaps the primary for "Buy {tickets} and join" (`buyAndJoin`; `buyAndAsk`,
`buyAndStart`). A tap goes straight to the purchase. The server stays authoritative: a `NEED_TICKETS`
refusal from `match_start`, `match_join` or `match_request` takes the same path, with the missing count
from the detail's `buy` (or `seats − available` after a wallet refetch when the detail is absent).

**Continuation** (`features/matches/continuation.ts`, pure, plus a thin hook):
```ts
type FriendSeat = { gender: 'female' | 'male' | null };   // one p_friends element; 0..2 of them
type TicketContinuation = { savedAt: string } & (
  | { kind: 'join';    matchId: string; token: string | null; friends: FriendSeat[] }
  | { kind: 'request'; matchId: string; token: string | null; friends: FriendSeat[] }
  | { kind: 'start';   venueId: string; courtId: string; startAt: string; durationMin: number;
                       category: 'open' | 'women' | 'men'; visibility: 'public' | 'link';
                       joinPolicy: 'open' | 'approve'; friends: FriendSeat[];
                       quotedPriceIqd: number; idempotencyKey: string });
```
1. The screen that met the shortage calls `setTicketContinuation(c)` (memory) and pushes
   `/tickets?buy=<missing>&for=<kind>`, `missing` clamped to 1..3. Backing out of `tickets` clears it.
2. `useStartTicketPurchase` writes it into the pointer as `after`, so it survives the app being killed
   on Qi's page.
3. `pay/status` reads the pointer **at mount**, before its terminal effect forgets it (`status.tsx:136-140`
   must wait until the pointer has been read), and prefers the in-memory continuation for the same ref.
4. On `ticketsBought`, when `after` is present, `claimContinuation(ref)` returns true (once per ref per
   app life) and `now − savedAt ≤ 30 min`, it runs the same RPC with the same arguments, also after a
   cold start. For `start` that includes the same `p_idempotency_key`: a refused `match_start` created
   no match with that key, so the key is unspent (D34).
5. **Success:** join → `router.replace('/match/[id]')` and toast "You're in"; request → the match and
   toast "Request sent"; start → the new match and toast "Your match is open. Share the link to fill
   it."
6. **Refusal:** toast `mapErrorToKey(err)` plus "Your tickets are in your wallet.", then the match (for
   `start`, `match-new` with the same params, which re-quotes). Nothing is retried by itself.
7. **Stale** (over 30 minutes, or already claimed): no automatic call. `pay/status` shows "Back to the
   match" (`pay-status.back-to-match`) or "Start the match" (`pay-status.continue`); a tap runs the same
   continuation.

#### 4.10.4 `pay/status` for purpose `ticket`

`parseDepositStatus` (`logic.ts:195`) reads `purpose` (`deposit` when absent), `ticket_count` and
`unit_price_iqd`. `screenFor` (`:350`) branches on purpose **before** its switch, because a ticket has
no reservation and would otherwise read `stillChecking` for ever (`:364-374`).

| Server status (ticket) | Screen (`pay-status.state.<kind>`) | Actions |
| --- | --- | --- |
| `created`, `pending` | `checking` / `stillChecking`, unchanged | open again, leave |
| `succeeded` | new **`ticketsBought`**: "Tickets added" / "{tickets} added to your wallet."; with a continuation running, "Joining the match…", "Sending your request…" or "Starting your match…" | `pay-status.view-tickets`, plus §4.10.3 step 7 |
| `failed` | `failed` with `holdLive: false`, `canRetry: attemptsLeft > 0`, `canPayAtDesk: false`, `outOfAttempts: attemptsLeft <= 0` | `pay-status.try-again` (a new `ticket-begin`, same count, same `after`), `pay-status.back` |
| `expired` | `expired`: "Payment window ended. No money was taken." | try again, back |
| `refund_pending` | `refundPending` with `matches.pay.ticketRefundPending` "The payment didn't go through as expected, so it's on its way back to your card. No tickets were added." **Never `slotLost`**: `SLOT_LOST_REASONS` (`:39`) holds `amount_mismatch`, which is the only refund a fresh ticket purchase can show | bookings |
| `refunded`, `refund_failed` | the existing screens | bookings |

- The summary card (`status.tsx`, around `:290`) shows "Open-match tickets × {count}" and "Paying now
  {amount}" in place of court, date and time.
- The `confirmed → /success` effect (`:143-167`), `payAtDesk` (`:209`) and `chooseAnotherTime`
  (`:253`) run only for `deposit`.
- `useRefreshAfterPayment` (`deposit/hooks.ts:165-173`) also invalidates `matchKeys.all`.
- `PayScreen` gains `{ kind: 'ticketsBought'; count: number }`; `isTerminalScreen` treats it as
  terminal; the exhaustive switch keeps compiling.

### 4.11 The Book tab

**Performance rules.** The Book tab shares its JS thread with the 3D rally
(`features/availability/hooks.ts:271`, `:373`).
1. **Switch off means no work.** When the branch's `venue_settings_public.matches_enabled` is false,
   the match query is disabled and there are no chips, no entry row and no choice sheet: a tap holds
   exactly as today. The phone reads the view with `select('*')`, so the new column arrives with no
   client change.
2. **Match data never enters the grid.** It is not an input of `buildDayGrid` or the assembled-night
   cache, so a seat change never rebuilds a night.
3. **One light query, capped at 16 days (R27).** `useMatchSlots(venueId, {enabled: flag && isOpen})`
   calls `match_slots` signed in or out with `p_from` = the start of today, venue-local, and `p_to` =
   `p_from + 16 days`. That covers the whole strip (`listBookableDates`, today + 14,
   `features/availability/assemble.ts:110`), today+14's trading night included, and keeps the query key
   stable for a day. `staleTime` 15 s, `refetchInterval` 60 s, enabled only while `BookingSheet` is open
   (`isOpen`, `components/BookingSheet.tsx:107,123`). Its `select` builds a
   `Map<epochMs of start_at, SlotMatch[]>` once per data reference.
4. **Primitive props only.** `SlotCell` (`components/booking.tsx:1278`, memoised) gains
   `matchLine?: string`, rendered in the third-line slot lane cells leave empty (`capacityLine=""`,
   `:1653`), coloured from `theme/tokens.ts` and appended to the accessibility label. `CourtLaneRow`
   (`:1488`) gains `matchLineFor?: (cell) => string`, a `useCallback` keyed on the Map's identity; only
   cells whose string changed re-render.
5. **One chip per time** (decided; draft open question 10): the chip sits on the first free lane cell
   at that minute only (pure `chipCellKeys(lanes, map)`), so two courts never read as two matches.
   Copy: "{seats} · Join" (`count.seatsLeft`), "Women · {seats}", "Your match · {taken}/4",
   "{matches}" (`count.openMatches`).
6. **Stable tap handler.** `useAvailabilityBooking` takes `matchesRef` (a ref to the Map) and reads it
   inside `onTapCell` (`useAvailabilityBooking.ts:303`); the Map is never a dependency of that
   `useCallback`, so a poll does not re-render all ~34 cells.
7. **No new view on the stage.** The choice sheet is native: `components/nativeChoice.ts`, generalised
   from `PhotoButton`'s `chooseSource` (`components/PhotoButton.tsx:79`): ActionSheetIOS on iOS,
   `Alert.alert` with at most three buttons on Android. The entry row reuses
   `rows[SPEC.grid.sharedFromRow]` (`BookingSheet.tsx:201`, `:327`), so it adds no interpolation.
8. **No new realtime topic.** `useCourtsBroadcast`'s invalidate (`hooks.ts:500-504`) adds
   `['match']`. A bump or a 4th-seat booking is a reservation write, so `slot_changed` drops a stale
   chip within a second for signed-in guests; seat joins ride the 60 s poll. SEC-28 is untouched.
9. **On a device:** the rally with the sheet open and chips present, against the 2026-09-08 hitch
   report.

**The choice sheet.** Pure `slotActions({slotMatches, canStart, freeCourts})` returns an ordered list:
`view-mine` when a match at that minute is mine, else `join` when one has seats; then `book`; then
`start` when `canStart` and `slotMatches.length < freeCourts` (an OM-42 hint; the server's
`MATCH_SLOT_FULL` decides). `canStart` = `matches_enabled` and `startAt − now ≥
match_fill_deadline_minutes + 60 min` (OM-43). `freeCourts` counts the free lane cells at that minute.
When the list is `['book']`, the sheet is skipped and today's path runs.

| Button | EN | AR **DRAFT-AR** | Goes to |
| --- | --- | --- | --- |
| title | "{time} · {day}" | same | — |
| message | "Book the whole court, or start an open match: it waits for four players and books the court once it's full." | «احجز الملعب كاملًا، أو ابدأ مباراة مفتوحة تنتظر اكتمال أربعة لاعبين ثم تحجز الملعب.» | — |
| join | "Join the open match · {seats}" | «الانضمام إلى المباراة المفتوحة · {seats}» | one match: `/match/[id]`; several: `/matches?at=<iso>`. `match_slots` has no ids, so a signed-in tap first reads `open_matches` for that minute (`p_to = p_from + 1 min`) |
| view-mine | "Your open match" | «مباراتك المفتوحة» | `/match/[id]` (id from the same `open_matches` read) |
| book | "Book the court" | «حجز الملعب» | today's hold → Review |
| start | "Start an open match" | «بدء مباراة مفتوحة» | `/match-new?venueId&courtId&startAt&durationMin&priceIqd`, with no hold (OM-13) |

The message line is addressed to nobody in particular, so its imperative stays; the buttons use verbal
nouns, never an imperative, so they read right for a woman or a man (§4.24).

- **Signed out:** `book` keeps the `pendingSlot` path. `join` sets `pendingJoin {kind: 'slot',
  venueId, startAt}`; `start` sets `pendingJoin {kind: 'start', venueId, courtId, startAt, durationMin,
  priceIqd}`. Both go to `/welcome`.
- **No phone** (`profileGate === 'incomplete'`, `useAvailabilityBooking.ts:326`): the same
  `pendingJoin`, then `/complete-profile?returnTo=continue`.

**Entry row.** `MatchEntryRow` (`book.sheet.open-matches`), the last child of the lanes' ScrollView
(`BookingSheet.tsx:315-352`): "{matches} · Join" (`count.openMatchesSoon`: "3 open matches coming up") or "Open
matches" → `/matches?date=<selected date>`. Signed out: "Open matches · Sign in", setting
`pendingJoin {kind: 'list', venueId, date}` before `/welcome`. Hidden when the flag is off.

### 4.12 `app/matches.tsx` (route `matches`, `RequireSession`)

- **Params:** `date?` (scroll to that trading night), `at?` (an ISO instant: scroll to that time and
  highlight its rows).
- **Branch:** `useGuestVenue()` (DF-1); `BranchPicker` only when `showPicker`.
- **Data:** `open_matches(venueId, p_from, p_to)` with the Book tab's window (start of today,
  venue-local, + 16 days). Sections by trading night ("Tonight", "Tomorrow", "Thu 3 Oct") from a pure
  `tradingNightOf(startAt, settings)`, so a 00:30 match belongs to the night before.
- **Row** (`MatchRow`, `matches.row.<matchId>`): time and day; the category pill; four seat dots;
  `count.seatsLeft`; "{share} per player at the desk"; the approve glyph (accessibility label "The
  organiser approves each player") when `join_policy = 'approve'`; "Court booked · a seat opened" when
  `refill`; a "Your match" or "Asked" tag from `mine`. No names. A tap opens `/match/[id]`.
- **Footer**, the primary: `matches.start-one`, "Start a match from any free time", which calls
  `requestBookingSheet()` then `router.navigate('/(tabs)')` (the pattern at
  `app/(tabs)/bookings.tsx:159`).
- **States:** skeleton; empty "No open matches yet. Start one from any free time."; `banned: true` →
  the notice `matches.errors.banned`, no rows and no footer; the branch's flag off →
  `matches.errors.off` and no footer; `ErrorState` (`matches.error`).

### 4.13 `app/match-new.tsx` (route `match-new`, `RequireSession`)

- **Params:** `venueId`, `courtId`, `startAt`, `durationMin`, `priceIqd` (a hint only; the quote
  decides, DF-3).
- **Data:** `useMatchQuote` (`match_quote`), `useMyTickets`, `useOwnProfile` (gender),
  `useVenueSettings(venueId)` for the timezone and phone.
- **Form** (`FormScreen`, native controls), top to bottom:
  1. **Header card:** day, time, duration, the branch when more than one is open, and "Fills by
     {deadline} or it's called off".
  2. **Refusal banner** (`match-new.refusal`) when `quote.refusal` is set and is not
     `GENDER_REQUIRED`: that code's copy (§4.22); the start button is hidden.
  3. `GenderAsk` (`match-new.gender`) while the gender is unset; the controls below stay disabled
     until it is answered.
  4. **Who can play** (`match-new.category`, `SegmentedControl`), the options of `quote.categories`:
     Open / Women / Men (DF-10: a declared man never sees Women, and the reverse).
  5. **Who can see it** (`match-new.visibility`): "Public: listed in the app at this branch" / "Link
     only: only people you send the link to".
  6. **Joining** (`match-new.policy`): "Anyone can join" / "I approve each player".
  7. **Seats for you** (`match-new.seats`): Me / Me + 1 / Me + 2, with the note "for friends without
     the app; your tickets cover their seats" (OM-20). In a Women or Men match with friends, the
     `Switch` `match-new.friends-gender` ("My friends are women" / "…men") must be on before Start
     (OM-39); `p_friends` then carries the category's gender. An Open match sends `gender: null`.
  8. **Money card:** "Court {price} · {share} per player, paid at the desk" and "{tickets} from your
     wallet · {ready}" (`count.ticketsUse`, `count.ticketsReady`).
  9. `MatchRulesCard` (`match-new.rules`).
  10. **Primary** `match-new.start`, static label "Start the match"; "Buy {tickets} and start" when
      the wallet is short (§4.10.3).
- **Call:** `match_start(p_venue_id, p_court_id, p_start_at, p_duration_min, p_category,
  p_visibility, p_join_policy, p_friends, p_quoted_price_iqd => quote.price_iqd, p_idempotency_key =>
  matchIntentKey('start:<venueId>|<courtId>|<startAt>|<durationMin>'))`.
- **Success** (also `duplicate: true`, R24): `router.replace('/match/[id]', {id: match_id})`, toast
  "Your match is open. Share the link to fill it.", intent key cleared.
- **Refusals:**

| Code | Behaviour | Key |
| --- | --- | --- |
| `NEED_TICKETS` | §4.10.3, `kind: 'start'` | kept |
| `GENDER_REQUIRED` | `GenderAsk` | kept |
| `PHONE_REQUIRED` | `/complete-profile?returnTo=back` | kept |
| `TERMS_REQUIRED` | `/accept-terms` when `needsTermsAcceptance` (`packages/core/src/legal/terms.ts:24`), else `matches.errors.updateApp` | kept |
| `PRICE_CHANGED` | refetch the quote; inline "The price is now {price}. Check it and start again." | kept |
| `MATCH_TOO_LATE` | toast with the earliest start from the detail (§4.22), `requestBookingSheet()`, back | cleared |
| `SLOT_TAKEN`, `MATCH_SLOT_FULL`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `SLOT_IN_PAST`, `BEYOND_HORIZON`, `NO_RATE`, `INVALID_DURATION` | toast, `requestBookingSheet()`, back | cleared |
| `DEGRADED_LOCKOUT` | `degraded.bookingRefused` with the branch phone | cleared |
| anything else (`MATCHES_OFF`, `MATCH_BANNED`, `MATCH_LIMIT_REACHED`, `MATCH_TIME_CLASH`, `MATCH_ALREADY_IN` …) | inline, `mapErrorToKey` with the detail-aware keys of §4.22 | cleared |

### 4.14 `app/match/[id].tsx` (route `match-detail`, `RequireSession`)

- **Params:** `id`, `t?` (the token, when opened from a link).
- **Reads:** `useMatch(id, t)` (`refetchInterval` 20 s while `filling` or `awaiting_court`);
  `useCourtsBroadcast(match.venue_id)`; `useVenueSettings(match.venue_id)` for the timezone and phone,
  never writing the stored branch (DF-1); `useMyTickets`; `useOwnProfile`. Countdowns use
  `server_now` (`serverNowMs`, `deposit/logic.ts:484`). A `restricted: true` answer renders
  `MatchRestrictedCard` (§4.18) in place.
- **Order:**
  1. **`MatchPoster`** (not pressable): the two-weight "OPEN / MATCH" headline
     (`docs/brand/customer-brand-report-2026-09-23.md:426-428`); the time in `display900`; "Tonight ·
     {branch}"; the category pill; chips for visibility and join policy; `SeatGrid`
     (`match-detail.seats`, 2×2 on a court-line drawing; seat `n` is `match-detail.seats.<n>` with a
     menu at `.<n>.menu`) printing each seat by `displaySeat`, "Open seat", or "Open seat · taking a
     player" for an `open` late-leave seat; "{taken}/4" (LTR-isolated) and `count.seatsLeft`; "Fills by
     {time} or it's called off" with a countdown, amber under 30 minutes. A booked match shows its
     court's name from `court_id`; an ended one shows its §4.15 line.
  2. **Action card** (`match-detail.action`), gated by `me.can` and `me.refusal`:

| Viewer | Card | Primary id |
| --- | --- | --- |
| viewer, `me.can.join` | seat stepper 1..min(3, `seats_left`), the friends-gender switch in a gendered match, "Join" (static), caption `count.ticketsUse` | `match-detail.join` |
| viewer, `me.can.request` | "Ask to join", caption "Holds {tickets} until the organiser answers" | `match-detail.ask` |
| viewer, `can.join` or `can.request`, too few tickets | "You have {ready}." (an empty wallet: `detail.youHaveNone` "You have no tickets yet." «ليست لديك تذاكر بعد.» **DRAFT-AR**) and "Buy {tickets} and join" (or "…and ask") | `match-detail.buy` |
| viewer, `me.refusal = GENDER_REQUIRED` | `GenderAsk` | `match-detail.gender.*` |
| viewer, any other `me.refusal` | that code's copy (§4.22), no button; `MATCH_BANNED` adds "Call {branch}" | — |
| `me.excluded` | "The organiser removed you from this match. You can't rejoin it." | — |
| requested | "Request sent · {tickets} held until the organiser answers" | `match-detail.withdraw` |
| in, approvedIn (filling) | "You're in · waiting for {players}" (`count.playersNeeded`, `…F` in a women's match) | `match-detail.leave` |
| awaitingCourt | "Four players are in. We'll book the court as soon as one is free." | `match-detail.leave` |
| booked, before start | "Booked · {court} · pay {share} at the desk" | `match-detail.leave` |
| any other state | its §4.15 line | — |

  3. **Money card** (members): "Your share at the desk: {share}", "Tickets in this match: {n}", "A
     ticket is not your share. It comes back after you play; if you don't come, it's lost." A linked
     desk seat shows the share line only.
  4. **Organiser card** (`me.role = 'organiser'`):
     - `RequestRow` (`match-detail.request.<id>`, with `.approve`, `.decline` and `.menu`) calling
       `match_decide`: "{name} · {games} at Touch · {noShows} · {seats}" (OM-41; `count.games`,
       `count.noShows`, `count.seats`). A `REQUESTER_INELIGIBLE` answer keeps the row, shows
       `matches.errors.requesterIneligible` on it and leaves Decline enabled (rules review §4.1 item 7).
     - Share (`match-detail.share`).
     - Cancel (`match-detail.cancel`, while `me.can.cancel`): a native choice of reason
       (`not_enough_players`, `plans_changed`, `other`), then `ConfirmAlert` "Cancel this match?
       Everyone's tickets go back to their wallets." → `match_cancel`.
  5. **`QuickMessageBar`** and the last 20 messages (§4.17).
  6. **`MatchRulesCard`** (`match-detail.rules`): the seven rules of §4.10.1 plus "The court isn't
     held until four players are in. A group booking the last free court cancels the match, and
     everyone's tickets come back."
  7. **Footer:** "Questions? Call {branch}" (`match-detail.call-venue`).
- **Seat menu** (`nativeChoice`), built from `seats[].can`: Remove, Report, Block. The viewer's own
  friend seat offers "Give up this seat" → `match_leave(p_seat_ids => [seat_id])`. A request row's
  menu offers Report and Block.
- **Confirms** (`ConfirmAlert`, `components/overlays.tsx:182`):
  - Remove: "Remove {name}? Their tickets go back to their wallet and they can't rejoin this match."
  - Block: "Block {name}? You won't see each other's open matches. They aren't told."
  - Leave, `leave_outcome = 'release'`: "Leave this match? Your ticket goes back to your wallet.", plus
    "Your friends' seats go too." when the viewer holds friend seats.
  - Leave, `leave_outcome = 'locked_until_refill'`: "The court is booked. If you leave now, your
    ticket stays held until another player takes your seat. If nobody does before {start}, it's
    lost."
  - The organiser leaving, one more line: "Another player becomes the organiser; if nobody is left,
    the match closes." (OM-34)
- **Header:** title "Open match"; a share icon in `headerRight` when `share_token` is present.
- **States:** a loading skeleton; `ErrorState` (`match-detail.error`); `MATCH_NOT_FOUND` → "This match
  isn't available" and Back (`match-detail.not-found`).
- **Share** uses React Native's `Share` (no new native module): the URL is `${siteUrl()}/m/<token>`,
  where `siteUrl()` is the `SITE_URL` of `src/lib/legal.ts:13` (`https://www.touch-padel.com`,
  overridable per build), exported for this. The operator's invite link has the same shape. EN message:
  "Join our padel match at Touch Padel{ · branch}, {when}. {seats}: {url}"; AR «مباراة بادل في تتش
  بادل{ · branch}، {when}. {seats}. للانضمام: {url}» **DRAFT-AR** (the house spelling تتش, as `appName`;
  the client's change order writes تاتش, on the review list). It names nobody.

### 4.15 Every guest state, and the dead ends closed (R32)

`guestStateOf(row)` in `features/matches/state.ts` is pure and shared by the lists and the detail. Its
inputs:
- the guest's **own seat**: the latest (`joined_at`, then `seat_no`) of their `account` seats and of
  `desk` seats linked to them (R32);
- that seat's `ticket_status` (NULL for a desk seat, which drops every ticket phrase below);
- `request`, `my_role`, `status`, `ended_reason`.

The first matching row wins. Ticket phrases are separate counted keys (`count.ticketsBack`,
`count.ticketsLost`, n = the guest's seats in the match), so one ticket reads "ticket back" and two
"tickets back". Where the AR shows a women's form, it is the `women`-category key.

| # | Condition | State | Where | EN | AR **DRAFT-AR** |
| --- | --- | --- | --- | --- | --- |
| 1 | no seat; request `pending` | requested | Open matches | Request sent · waiting for the organiser | أُرسل الطلب · بانتظار ردّ المنظّم (المنظّمة) |
| 2 | no seat; request `declined` | declined | History | Request not accepted · tickets back in your wallet | لم يُقبل الطلب · عادت تذاكرك إلى محفظتك |
| 3 | no seat; request `withdrawn` | withdrawn | History | Request withdrawn · tickets back | سُحب الطلب · عادت تذاكرك |
| 4 | no seat; request `expired` | requestExpired | History | Request closed · tickets back | أُغلق الطلب · عادت تذاكرك |
| 5 | seat `in`, `filling`, `request_id` set | approvedIn | Open matches | Approved · you're in · {taken}/4 | قُبل طلبك · لك مقعد · {taken}/4 |
| 6 | seat `in`, `filling` | in | Open matches | You're in · waiting for {players} · fills by {time} | لك مقعد · بانتظار {players} · يكتمل العدد قبل {time} |
| 7 | seat `in`, `awaiting_court` | awaitingCourt | Open matches | Four players · waiting for a court | اكتمل العدد · بانتظار ملعب متاح |
| 8 | seat `in`, `booked` | booked | Upcoming (badge "Open match") | Booked · {share} at the desk | محجوزة · {share} عند الاستقبال |
| 9 | seat `attended`, `booked` | checkedIn | Upcoming | Checked in · ticket back · {share} at the desk | سُجّل حضورك · عادت تذكرتك · {share} عند الاستقبال |
| 10 | seat `left_late`, end `left`, ticket `in_use` | leftLate | Open matches until start | You left · your ticket is held until someone takes your seat | غادرت · تذكرتك محجوزة إلى أن يأخذ أحد مقعدك |
| 11 | seat `left_late`, end `removed_by_staff`, ticket `in_use` | removedLate | Open matches until start | The venue removed you · your ticket is held until someone takes your seat | أزالك النادي من المباراة · تذكرتك محجوزة إلى أن يأخذ أحد مقعدك |
| 12 | seat `left_late`, ticket `forfeited` | leftLateLost | History | You left and nobody took your seat · ticket lost (end `removed_by_staff`: The venue removed you and nobody took your seat · ticket lost) | غادرت ولم يأخذ أحد مقعدك · فُقدت التذكرة (أزالك النادي ولم يأخذ أحد مقعدك · فُقدت التذكرة) |
| 13 | seat `left_late`, desk seat | leftDesk | History | You left this match | غادرت هذه المباراة |
| 14 | seat `refilled` | refilled | History | Someone took your seat · ticket back | أخذ لاعب آخر مقعدك · عادت تذكرتك (أخذت لاعبة أخرى مقعدك) |
| 15 | seat `attended`, match `cancelled`/`called_off_short` | calledOff | Cancelled | Called off at the desk · ticket back · nothing to pay | أُلغيت عند الاستقبال · عادت تذكرتك · لا شيء للدفع |
| 16 | seat `attended` | played | Played | Played · ticket back in your wallet | لُعبت · عادت تذكرتك إلى محفظتك |
| 17 | seat `no_show` | noShow | History | Marked as not attended · ticket lost | سُجّل غيابك · فُقدت التذكرة |
| 18 | seat `left` | left | History | You left · ticket back | غادرت · عادت تذكرتك |
| 19 | seat `removed`, end `removed_by_organiser` | removed | History | Removed by the organiser · tickets back · you can't rejoin this match | أزالك المنظّم · عادت تذاكرك · لا يمكن الانضمام إليها مجددًا (أزالتك المنظّمة) |
| 20 | seat `removed`, end `removed_by_staff` | removedByVenue | History | Removed by the venue · tickets back | أزالك النادي من المباراة · عادت تذاكرك |
| 21 | seat `removed`, end `banned` | banned | History | Removed · open matches aren't available on your account | أُلغي مقعدك · المباريات المفتوحة غير متاحة لحسابك |
| 22 | seat `cancelled`, `bumped` | bumped | Cancelled | Cancelled · a group booked the last court · tickets back | أُلغيت · حجزت مجموعة آخر ملعب · عادت تذاكرك |
| 23 | seat `cancelled`, `deadline` | expired | Cancelled | Cancelled · didn't fill by {time} · tickets back | أُلغيت · لم يكتمل العدد قبل {time} · عادت تذاكرك |
| 24 | seat `cancelled`, `no_court` | noCourt | Cancelled | Cancelled · no court came free · tickets back | أُلغيت · لم يتوفّر ملعب · عادت تذاكرك |
| 25 | seat `cancelled`, `organiser_cancelled` | cancelledByOrganiser | Cancelled | Cancelled by the organiser · tickets back (the organiser: You cancelled this match · tickets back) | ألغاها المنظّم · عادت تذاكرك (ألغتها المنظّمة; the organiser: ألغيت هذه المباراة · عادت تذاكرك) |
| 26 | seat `cancelled`, `staff_cancelled`, `reservation_cancelled` or `venue_closed` | cancelledByVenue | Cancelled | Cancelled by the venue · tickets back | ألغاها النادي · عادت تذاكرك |
| 27 | seat `cancelled`, `empty` | closedEmpty | History | Closed · everyone left | أُغلقت · غادر الجميع |
| 28 | anything else | unknown | History | Open match | مباراة مفتوحة |

- The Arabic uses unvocalised past tense (غادرت، سحبت), possessive suffixes and passives, which read
  the same for a woman or a man (§4.24).
- A deleted account appears in other players' seats, requests and feeds as "Former player".

**States with no row** (the list hides the match; the detail shows the refusal): blocked
(`MATCH_UNAVAILABLE`), the other gender (`MATCH_GENDER_MISMATCH`), the branch switched off
(`MATCHES_OFF`), banned (`MATCH_BANNED`, plus the list notice), excluded (`me.excluded`).

**The four dead ends of R32, closed:**
1. A restricted link viewer gets `MatchRestrictedCard` in `m/[token]` (§4.18).
2. A linked desk seat has states (rows 5–9, 13 and the rest, without ticket phrases).
3. A desk removal reads "Removed by the venue" (rows 11, 12, 20), never "You left".
4. `no_court` has its own line (row 24) and push (`match_cancelled`, §4.6.3).

### 4.16 My Reservations and Profile

**Data.**
- `app/(tabs)/bookings.tsx` adds `useMyMatches('upcoming')` beside `useMyBookings` (`:130`);
  `app/booking-history.tsx` adds `useMyMatches('past')`.
- A match booking has `guest_id` NULL, so it never comes back from `my_reservations`
  (0242:1733-1734) and needs no dedupe; no `booking_*` push fires for it (0090:143-145).

**Layout.**
- **OPEN MATCHES section:** a `ListHeading` with its count, right after HELD. Rows are `MatchRow`
  (`bookings.match.<matchId>`) for states requested, approvedIn, in, awaitingCourt, leftLate and
  removedLate. Under the heading, the wallet line "Tickets · {ready}" (`bookings.tickets`) opens
  `/tickets`.
- **Upcoming:** booked and checkedIn rows merge by `start_at`; `NextUpCard` (`:462`) may be a match
  ("Next up · Open match", opening `/match/[id]`).
- **Played / Cancelled chips:** played; calledOff, bumped, expired, noCourt, cancelledByOrganiser,
  cancelledByVenue, under the rules of `playedGames` and `cancelledBookings`
  (`features/booking/logic.ts`): a no-show is never a game and never a cancellation.
- **History:** `booking-history.tsx` lists every past match row, merged into its past list;
  `visiblePast` / `clearedAt` applies to match rows too.
- The pure merge is `mergeReservationLists(bookings, matches, now, clearedAt)` in
  `features/matches/logic.ts`.

**Profile** (`app/(tabs)/profile.tsx`): two `MenuRow`s after `profile.settings` (`:308`):
`profile.tickets` ("Open-match tickets", `/tickets`) and `profile.blocked-players` ("Blocked players",
`/blocked-players`), both shown to signed-in guests only.

### 4.17 Quick messages, report, block

**`QuickMessageBar`** (members; match `filling`, `awaiting_court` or `booked`; `now < end_at`;
`me.can.message`): four chips `match-detail.message.<code>`, each calling
`match_post_message(p_match_id, p_code)`.

| Code | EN | AR **DRAFT-AR** |
| --- | --- | --- |
| `on_my_way` | On my way | في الطريق |
| `running_late` | Running late | سأتأخر قليلًا |
| `cant_make_it` | Can't make it | لن أتمكن من الحضور |
| `bring_balls` | Who's bringing balls? | من سيحضر الكرات؟ |

- The chips are first person, so the Arabic is the same for women and men. Toast "Sent to the
  players". A chip is disabled for 2 minutes after a success (a local courtesy; the server's
  `duplicate` and `RATE_LIMITED` decide). No free text (OM-17).
- The feed shows the last 20: "{name} · {label} · {time}", the viewer's own as "You".

**`app/match-report.tsx`** (route `match-report`, `presentation: 'modal'`, the `accept-terms`
precedent; decided):
- **Params:** `matchId`, `seatId` or `requestId`, and `name` (display only). Title "Report {name}" /
  «الإبلاغ عن {name}».
- One radio row per reason (`match-report.reason.<code>`), in the §1.3 order:

| Code | EN | AR **DRAFT-AR** |
| --- | --- | --- |
| `offensive_name` | Offensive name | اسم مسيء |
| `abusive_behaviour` | Abusive behaviour | سلوك مسيء |
| `harassment` | Harassment | تحرّش أو مضايقة |
| `unsafe_play` | Unsafe play | لعب غير آمن |
| `no_show` | Didn't show up | لم يحضر (a women's match: لم تحضر) |
| `other` | Something else | سبب آخر |

- `Switch` `match-report.block`: "Also block this player".
- Submit `match-report.submit` ("Send report") → `match_report(p_match_id, p_reason, p_seat_id,
  p_request_id, p_block)`. Note: "Reports go to the venue's managers. The player isn't told who
  reported them." Success toast "Thanks. The venue's managers will look at it." (also on
  `duplicate`). `REPORT_TARGET_INVALID` → toast and close. `RATE_LIMITED` → `errors.tooManyRequests`.

**`app/blocked-players.tsx`** (route `blocked-players`, `RequireSession`, from Profile):
- The `FlatList` is `blocked-players.list`; rows `blocked-players.row.<blockId>` read "{name} · blocked
  {date}" with Unblock (`.unblock`) behind a `ConfirmAlert`, calling `match_unblock`.
- Empty: "You haven't blocked anyone. When you block a player, you won't see each other's open
  matches."
- Block and unblock are state-idempotent and take no key.

### 4.18 Links in: `+native-intent`, `m/[token]`, and continuing after sign-in

**`app/+native-intent.ts`** exports `redirectSystemPath({path})`, returning
`normaliseIncomingPath(path)` inside a try/catch that falls back to `path`. The pure function lives in
`features/matches/links.ts`:
- `(https://<host>)?(/(en|ar))?/m/<anything>` and `touchpadel://m/<anything>` → `/m/<anything>`, so a
  locale prefix never reaches an unmatched route; `m/[token]` validates the token itself;
- everything else passes through unchanged: `touchpadel://pay/return?ref=…`, the auth code links
  (`features/auth/deepLink.ts`), `/auth/*`.
- It accepts the full https URL and the bare path alike, because whether expo-router 57 hands over one
  or the other for a universal link is unverified (a device check in §4.27).

A `.ts` file stays outside the smoke walk, which lists `.tsx` only
(`src/navigation/__tests__/smokeCoverage.test.ts:33-40`).

**`app/m/[token].tsx`** (route `match-link`): no `RequireSession`; its `Stack.Screen` uses
`headerShown: false, animation: 'none'`, as `pay/return` (`app/_layout.tsx:279`). It never writes the
stored branch (DF-1).
- **A token that fails `^[A-Za-z0-9_-]{22}$`:** the closed layout.
- **Signed in:** `match_detail(p_token => token)` behind the spinner `match-link.waiting`:
  - the full shape → `router.replace('/match/[id]', {id, t: token})`;
  - `restricted: true` → **`MatchRestrictedCard`** in place (R32, rules review §4.1 item 1): the day,
    time, branch and category from `match_invite(token)` (no names), the refusal's copy
    (`MATCH_BANNED`, `MATCH_GENDER_MISMATCH` or `MATCH_UNAVAILABLE`, §4.22), and "Find another match"
    (`match-link.find`);
  - `MATCH_NOT_FOUND` → the closed layout; any other failure → `ErrorState` (`match-link.error`) with
    retry.
- **Signed out:** `match_invite(token)`:
  - `open` or `full`: the DF-9 card (day and time in `timezone`, branch, category, `count.seatsLeft`,
    "The organiser approves each player" when `approve`; "This match is full" for `full`), the primary
    "Sign in to join" (`match-link.sign-in`) and "Create an account" (`match-link.sign-up`). Both set
    `pendingJoin {kind: 'link', token}`.
  - `closed`: "This match is no longer open" and "Find a match" (`match-link.find`), which calls
    `requestBookingSheet()` and goes to the tabs.

**`pendingJoin`** (`features/matches/pendingJoin.ts`) is a copy of the `pendingSlot` store
(`features/booking/pendingSlot.ts`): in memory, subscribable, never persisted.
```ts
type PendingJoin =
  | { kind: 'link';  token: string }
  | { kind: 'slot';  venueId: string; startAt: string }
  | { kind: 'start'; venueId: string; courtId: string; startAt: string; durationMin: number;
      priceIqd: number | null }
  | { kind: 'list';  venueId: string; date: string };
```
- `features/booking/pendingIntent.ts` (new) exports `hasPendingIntent()`, `usePendingIntent()` and
  `clearPendingIntents()`. Every "is there an intent" check switches to them:
  `features/auth/RequireNoSession.tsx:37,45`, `app/sign-in.tsx:154,157`,
  `features/auth/useSocialSignIn.ts:167`, `app/verify-result.tsx:33`, `app/welcome.tsx:33,142` (with a
  `pendingJoin`, its banner reads "Sign in to join the open match"); `app/complete-profile.tsx:115`
  clears both.
- **`continueAfterAuth`** (`features/booking/usePostAuthContinue.ts:76-92`) runs in this order: a
  payment in flight (unchanged); `pendingSlot` (unchanged); `pendingJoin` (`link` → `/m/<token>`,
  `slot` → `/matches?at=<startAt>`, `start` → `/match-new?…`, `list` → `/matches?date=`); the tabs.
- Signing in never joins by itself (GD-2): the guest sees the match, with its gender ask, tickets and
  refusals, and taps once. Only a ticket purchase continues by itself (§4.10.3).

### 4.19 Universal links: the configuration (OM-32)

- `apps/web/src/lib/security/applinks.ts:48`: `LINK_PATHS = ['/auth/*', '/en/auth/*', '/ar/auth/*',
  '/m/*', '/en/m/*', '/ar/m/*']`. `/t/*` stays out. The comment at `:10-17` ("no Apple Developer team
  yet") is rewritten: the team is `BR42V976FS` (`apps/mobile/eas.json:44`); the comment in
  `app/.well-known/apple-app-site-association/route.ts` ("Only the auth paths") too.
- Vercel env `APPLE_TEAM_ID=BR42V976FS`, set before push F: both `.well-known` routes are
  `force-static`, so the value is read at build.
- `ANDROID_SHA256_FINGERPRINTS` (`applinks.ts:34-37`) gets the Play App Signing key and the upload
  key, comma-separated, only once the Play listing exists, followed by a redeploy. Until then Android
  verification fails closed and a link opens the web page, whose "Open in the app" still works. Nobody
  sets a guessed fingerprint.
- `apps/mobile/eas.json`: `"EXPO_PUBLIC_LINK_DOMAIN": "www.touch-padel.com"` in the `env` block of
  `development` (`:10`), `staging` (`:21`) and `production` (`:32`), as `apps/mobile/CLAUDE.md` requires
  for a new variable. `associatedDomains` (`app.config.ts:257`) then stops pointing at
  `touchpadel.invalid` (`:36`), and the comment at `:25-35` is updated (the domain is live). A staging
  build claims production links too; such a link answers `MATCH_NOT_FOUND` on the staging project and
  shows the closed layout (accepted: staging builds are internal).
- `apps/mobile/app.config.ts` `android` (`:305`) gains, only when `LINK_DOMAIN !==
  'touchpadel.invalid'`: `intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE',
  'DEFAULT'], data: ['/m/', '/en/m/', '/ar/m/'].map(p => ({ scheme: 'https', host: LINK_DOMAIN,
  pathPrefix: p })) }]`. A native change: a new dev client, TestFlight and an internal APK (push G).
- `links.test.ts` asserts that `siteUrl()`'s host equals `www.touch-padel.com`, the value every
  profile's `EXPO_PUBLIC_LINK_DOMAIN` carries, so the shared URL is always one the app claims.

### 4.20 The web invite page `apps/web/app/[locale]/m/[token]/page.tsx`

It follows `app/[locale]/pay/return/page.tsx`:
- `requireLocale()`; `export const dynamic = 'force-dynamic'`; no `headers()` or `cookies()` read beyond
  `getSiteMode()` and `getRequestNonce()`.
- **`generateMetadata`:** title `matches.web.metaTitle` "Open match invite" (the layout template adds
  "· Touch Padel"); description "Join a padel match at Touch Padel."; `robots {index: false, follow:
  false}`; `referrer: 'no-referrer'`; `openGraph` and `twitter` replaced whole with a static
  per-locale image, `/brand/site/og-match-{en,ar}.png` once the brand poster is delivered, and until
  then `/brand/site/og-touch-padel-{locale}.png` (`app/[locale]/layout.tsx:73`). Static because WhatsApp
  caches previews: a live seat count would go stale.
- **Data:** `src/lib/site/matchInvite.server.ts`, `readMatchInvite(token)`:
  `createStaticSupabase()` (`src/lib/supabase/static.ts:11`) → `.schema('app').rpc('match_invite',
  {p_token})` → the union `'open' | 'full' | 'closed' | 'error'` with the card (`apps/web/CLAUDE.md`,
  "a server read returns an explicit status union").
- **Pure helpers** in `src/lib/site/matchInvite.ts`: `parseMatchToken` (`^[A-Za-z0-9_-]{22}$`; a token
  has no `.`, so the proxy matcher never skips it); `appMatchHref(token)` → `touchpadel://m/<token>`;
  `matchInvitePath(locale, token)`; `inviteWhen(startAt, timezone, locale)`.
- **Body** (DF-9 and GD-4: no names, no price, no ids): the lockup bar and a plain language link (no
  cookie), as `pay/return`;
  - `open`: "OPEN MATCH", the day and time in the invite's `timezone`, the branch
    (`venue.name_<locale>`), the category ("Open to all", "Women only", "Men only"), the seats-left
    phrase through the web's plural helper (`src/lib/site/plural.ts`) and `matches.count.seatsLeft`,
    and "The organiser approves each player" when `approve`;
  - `full`: "This match is full"; `closed`: "This match is no longer open"; `error`: "We couldn't load
    this match. Try again in a moment.";
  - every state: the big "Open in the app" (`appMatchHref`; useful on Android until the fingerprints
    exist) and "Don't have the app?" → `/{locale}#app`, the home page's app band with the store badges,
    as `pay/return` does. Not `StoreButtons` (it needs the site sheet). No `OpenAppOnLoad`: the visitor
    may not have the app, and an unprompted scheme jump strands Safari on an error.
- **Styles:** `src/styles/site/matchInvite.css.ts`, logical properties, `var(--tp-*)`, a reduced-motion
  block, inlined with the tokens bridge as `pay/return` does; registered in `site-css.test.ts`.
- **Strings:** `matches.web.*` (§4.24).
- A locale-less `/m/<token>` gets the proxy's 307 to `/{locale}/m/<token>` (`proxy.ts:195-196`). Not in
  `sitemap.ts`, not disallowed in `robots.ts` (a crawler must fetch the page to read its `noindex`).
- `apps/web/CLAUDE.md`'s page list gains `/{locale}/m/[token]`.

### 4.21 Push on the phone: taps and the foreground

- **`features/matches/pushRoutes.ts`:** `GUEST_PUSH_ROUTES = ['match', 'tickets']`, held to the JSON
  by `__tests__/pushRoutes.test.ts`; `isGuestPushRoute`; `guestPushHref(route, id)`: `/match/[id]` for
  `match` with an id (the tabs without one), `/tickets` for `tickets`.
- **`features/profile/pushSync.ts`:** `TapDestination` (`:105-108`) gains `{kind: 'match', id}` and
  `{kind: 'tickets'}`; new `isGuestTap(data)`; `isStaffTap` (`:111-113`) becomes "a route is present
  **and** it is not a guest route" (without this a guest push waits on the staff status and opens
  nothing); `tapDestination(data, status)` (`:129-146`) answers guest taps first, whatever the staff
  status. The one-argument overload is unchanged.
- **`features/profile/push.ts`:** `installNotificationHandler` (`:300`) gains `onOpenMatch(id)`,
  `onOpenTickets()` and `onMatchNotice()`; `open` checks `isGuestTap` before `isStaffTap` (`:338`); a
  new `Notifications.addNotificationReceivedListener` calls `onMatchNotice` for data whose `kind` is a
  guest kind, and is removed in the cleanup. Foreground display stays as set (`:322-329`).
- **`app/_layout.tsx:363-367`** passes `onOpenMatch: id => router.push({pathname: '/match/[id]',
  params: {id}})`, `onOpenTickets: () => router.push('/tickets')`, and `onMatchNotice: () =>
  queryClient.invalidateQueries({queryKey: matchKeys.all})`, which refreshes an open detail or list the
  moment a push lands.
- **Old builds:** a `route: 'match'` push reads as a staff tap, the staff check fails, and nothing
  opens. Harmless.

### 4.22 Error codes (mobile `CODE_TO_KEY`, literal entries)

Each entry goes into the literal block of `apps/mobile/src/features/booking/errors.ts:12-172`, the only
place `scripts/check-error-codes.mjs` reads. Keys are `matches.errors.<name>`, EN in `matches.en.ts`,
AR in `matches.ar.ts`. The commit whose SQL raises a code adds its entry and keys, copying the text
below (R11); 0256 creates the catalog pair. `rpcErrorCode` matches exact codes first, then the longest
(`:186-194`), so `MATCH_FULL` never shadows `MATCH_SLOT_FULL`.

| Code | Key | EN | AR **DRAFT-AR** |
| --- | --- | --- | --- |
| `MATCHES_OFF` | off | Open matches aren't available at this branch right now. | المباريات المفتوحة غير متاحة في هذا الفرع حاليًا. |
| `MATCH_NOT_FOUND` | notFound | This match isn't available. | هذه المباراة غير متاحة. |
| `MATCH_CLOSED` | closed | This match isn't taking players any more. | لم تعد هذه المباراة تستقبل لاعبين. |
| `MATCH_FULL` | full | This match is full. | اكتمل العدد في هذه المباراة. |
| `MATCH_SLOT_FULL` | slotFull | There are already as many open matches at this time as free courts. Join one of them instead. | في هذا الوقت مباريات مفتوحة بعدد الملاعب المتاحة، ويمكن الانضمام إلى إحداها. |
| `MATCH_TOO_LATE` | tooLate | It's too late to start an open match for this time. Pick a later time. | فات وقت بدء مباراة مفتوحة في هذا الموعد. يُرجى اختيار وقت لاحق. |
| `MATCH_LIMIT_REACHED` | limitReached | You already have as many open matches filling as you're allowed. | لديك الحد الأقصى من المباريات المفتوحة التي لم يكتمل عددها بعد. |
| `MATCH_SEAT_LIMIT` | seatLimit | You can take up to 3 seats. The last seat is always for another player. | يمكن أخذ 3 مقاعد كحد أقصى، والمقعد الأخير دائمًا للاعب آخر. |
| `MATCH_APPROVAL_REQUIRED` | approvalRequired | The organiser approves each player in this match. Ask to join instead. | المنظّم يوافق على كل لاعب في هذه المباراة، لذا يلزم إرسال طلب انضمام. |
| `MATCH_NOT_APPROVAL` | notApproval | Anyone can join this match. Join it directly. | يمكن الانضمام إلى هذه المباراة مباشرة دون طلب. |
| `MATCH_ALREADY_IN` | alreadyIn | You already have a seat in this match. | لديك مقعد في هذه المباراة بالفعل. |
| `MATCH_GENDER_MISMATCH` | genderMismatch | This match is for a different group of players. | هذه المباراة مخصّصة لفئة أخرى من اللاعبين. |
| `MATCH_UNAVAILABLE` | unavailable | You can't join this match. | لا يمكن الانضمام إلى هذه المباراة. |
| `MATCH_TIME_CLASH` | timeClash | You're already in another open match at this time. | لديك مقعد في مباراة مفتوحة أخرى في هذا الوقت. |
| `MATCH_BANNED` | banned | Open matches aren't available on your account. Please contact the venue. | المباريات المفتوحة غير متاحة لحسابك. يُرجى التواصل مع النادي. |
| `MATCH_BOOKED` | booked | The court is booked now, so the match can't be cancelled here. You can leave it, or call the venue. | حُجز الملعب لهذه المباراة، فلا يمكن إلغاؤها من هنا. يمكنك مغادرتها أو الاتصال بالنادي. |
| `NOT_ORGANISER` | notOrganiser | Only the organiser can do that. | هذا الإجراء للمنظّم فقط. |
| `NEED_TICKETS` | needTickets | You don't have enough tickets for this. Buy tickets to continue. | ليست لديك تذاكر كافية لذلك، ويلزم شراء تذاكر للمتابعة. |
| `GENDER_REQUIRED` | genderRequired | To play open matches, tell us once whether you're a woman or a man. | للمشاركة في المباريات المفتوحة نحتاج إلى معرفة ذلك مرة واحدة: امرأة أم رجل؟ |
| `GENDER_ALREADY_SET` | genderAlreadySet | That's already set. The front desk can change it. | هذه المعلومة محدَّدة مسبقًا، ويمكن لموظفي الاستقبال تعديلها. |
| `TERMS_REQUIRED` | termsRequired | Accept the updated terms to use open matches. | يلزم قبول الشروط المحدَّثة لاستخدام المباريات المفتوحة. |
| `REQUEST_NOT_FOUND` | `errors.requestGone` (R6) | That request no longer exists. Please refresh. | لم يعد هذا الطلب موجودًا. يُرجى التحديث. |
| `REQUEST_CLOSED` | requestClosed | This request was already answered or withdrawn. | أُجيب عن هذا الطلب أو سُحب مسبقًا. |
| `REQUESTER_INELIGIBLE` | requesterIneligible | This request can't be approved right now. You can decline it. | لا يمكن قبول هذا الطلب حاليًا، ويمكن رفضه. |
| `REQUEST_LIMIT` | requestLimit | You have too many requests waiting. Withdraw one or wait for an answer. | لديك طلبات كثيرة بانتظار الرد. يمكنك سحب أحدها أو انتظار الرد. |
| `SEAT_NOT_FOUND` | seatNotFound | That seat isn't in this match any more. | لم يعد هذا المقعد ضمن المباراة. |
| `SEAT_HOLDER_REQUIRED` | seatHolderRequired | Your friends' seats can't stay without yours. Leave all your seats instead. | لا يمكن أن تبقى مقاعد أصدقائك من دون مقعدك، ويمكنك مغادرة جميع مقاعدك. |
| `SEAT_STARTED` | seatStarted | The match has started. Please speak to the front desk. | بدأت المباراة. يُرجى مراجعة الاستقبال. |
| `REPORT_TARGET_INVALID` | reportTargetInvalid | You can't report that player from this match. | لا يمكن الإبلاغ عن هذا اللاعب من هذه المباراة. |
| `BLOCK_TARGET_INVALID` | blockTargetInvalid | You can't block that player from here. | لا يمكن حظر هذا اللاعب من هنا. |
| `TICKET_COUNT_INVALID` | ticketCountInvalid | You can buy 1 to 3 tickets at a time. | يمكن شراء تذكرة واحدة إلى 3 تذاكر في كل مرة. |

**Reused codes** keep their entries: `ACCOUNT_REQUIRED` (`:29`), `PHONE_REQUIRED` (`:41`),
`AUTH_REQUIRED` (`:47`), `COURT_NOT_FOUND` (`:32`), `SLOT_TAKEN`, `PRICE_CHANGED`, `DEGRADED_LOCKOUT`,
`SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `BEYOND_HORIZON`, `NO_RATE`, `INVALID_DURATION`,
`IDEMPOTENCY_CONFLICT`, `TOO_MANY_ATTEMPTS`, `PAYMENT_NOT_FOUND`, `PROVIDER_UNAVAILABLE`,
`INVALID_ARGUMENT`. New to the block (R6): `RATE_LIMITED` → `errors.tooManyRequests`
(`en.ts:1012`; `settings.tsx` keeps its own handling) and `RETRY_LATER` (edge only) →
`deposit.errors.providerUnavailable`. `BAD_REQUEST` falls to `errors.generic`.

**Details.** A pure `rpcErrorDetail(err)` beside `rpcErrorCode` returns PostgREST's `details` string,
or a `DepositEdgeError`'s `detail`. `matchErrorText(err, t)` in `features/matches/errors.ts` applies
these before falling back to `mapErrorToKey`:

| Code + detail | Key | EN | AR **DRAFT-AR** |
| --- | --- | --- | --- |
| `MATCH_TOO_LATE` + minutes | tooLateAt | Open matches need more notice. The earliest start now is {time}. | تحتاج المباريات المفتوحة إلى وقت أطول قبل البدء. أقرب موعد متاح الآن: {time}. |
| `TICKET_COUNT_INVALID` + `wallet_limit` | walletLimit | You already hold as many unused tickets as you can. Use them in a match first. | لديك الحد الأقصى من التذاكر غير المستخدمة، ويمكن استخدامها في مباراة أولًا. |
| `NEED_TICKETS` + `{needed, available, buy}` | needTicketsCount | You need {tickets} more for this. | ينقصك {tickets} لذلك. |

`{time}` for `tooLateAt` is `now + minutes`, rounded up to the next 30 minutes, in the branch timezone.
`{tickets}` in `needTicketsCount` is `count.tickets` (`buy`), the nominative subject: no verb addressed to
the reader and no adjective after the count (§4.24 rule 2).

**Screen overrides** (the house pattern, as `isDegradedRefusal`): on the ticket screens
`TOO_MANY_ATTEMPTS` reads `matches.tickets.tooManyAttempts` "Too many payment attempts today. Try again
later." (`deposit.errors.tooManyAttempts` speaks of "this time"); `TERMS_REQUIRED` from a build whose
`CURRENT_TERMS_VERSION` is already accepted reads `matches.errors.updateApp` "Update the app to use open
matches."; `DEGRADED_LOCKOUT` uses the match branch's phone.

### 4.23 Query keys, idempotency, persistence, purge

`features/matches/keys.ts`, split out like `deposit/keys.ts` because `lib/queryClient.ts` reads it, and
re-exported by `features/matches/hooks.ts`:
```ts
export const matchKeys = {
  all: ['match'] as const,
  slots: (venueId: string, from: string, to: string) => ['match', 'slots', venueId, from, to] as const,
  open: (venueId: string, from: string, to: string) => ['match', 'open', venueId, from, to] as const,
  one: (id: string, token = '') => ['match', 'one', id, token] as const,
  byToken: (token: string) => ['match', 'token', token] as const,
  invite: (token: string) => ['match', 'invite', token] as const,
  mine: (scope: 'upcoming' | 'past') => ['match', 'mine', scope] as const,
  quote: (venueId: string, courtId: string, startAt: string, min: number) =>
    ['match', 'quote', venueId, courtId, startAt, min] as const,
  tickets: ['match', 'tickets'] as const,
  blocks: ['match', 'blocks'] as const,
  mutation: (name: 'start' | 'join' | 'request' | 'withdraw' | 'decide' | 'leave' | 'remove'
    | 'cancel' | 'message' | 'report' | 'block' | 'unblock' | 'gender' | 'buy') =>
    ['match', 'mutation', name] as const,
};
```
`apps/mobile/CLAUDE.md` (Queries) gains `matchKeys` in its list of families.

**`lib/queryClient.ts`:**
- `shouldDehydrateQuery` (`:188-193`) adds `query.queryKey[0] !== 'match'`: match reads carry other
  players' names, and a wallet read back from disk would be shown before it is re-checked.
- `setMutationDefaults(['match', 'mutation'], …)` with the `['deposit', 'mutation']` values
  (`:156-159`): `networkMode: 'always'`, one retry of transport and server faults. Run now or fail now
  (DF-11). One retry is safe because every match write is keyed (`match_start`) or state-idempotent
  (the others answer `duplicate`), and `ticket-begin` answers a live attempt with the same ref.
- `setQueryDefaults(['match', 'slots'], …)` with the `['deposit', 'quote']` values (`:160-162`): the
  Book sheet fails fast on a server without the RPC.
- `clearAllCaches` already wipes everything on sign-out, `['match']` included.

**Idempotency** (`lib/idempotency.ts`):
- `matchIdemKey()` returns `MOBILE:match.start:<ulid>`; `matchIntentKey(intent)` and
  `clearMatchIntentKey(intent)` follow the memo of `idemKeyFor` / `clearIdemKey`. The only intent is
  `start:<venueId>|<courtId>|<startAt>|<durationMin>`, because `match_start` is the only guest match RPC
  with `p_idempotency_key` (§1.6).
- The key survives the refusals the guest fixes and retries (`NEED_TICKETS`, `GENDER_REQUIRED`,
  `PHONE_REQUIRED`, `TERMS_REQUIRED`, `PRICE_CHANGED`) and the ticket continuation; it is cleared on
  success and on any other refusal.
- Every other write is state-idempotent on the server (the unique occupying seat, the unique pending
  request, the unique block pair, the unique report, the 10-minute message dedupe) and takes no key.

**Persistence and purge.** No new AsyncStorage key: the ticket continuation rides in
`tp.pendingPayment.<uid>`, already on the SEC-16 purge list. `pendingJoin` and the in-memory
continuation are never persisted.

### 4.24 i18n: catalogs, plurals, grammatical gender, bidi, digits

**Catalogs.**
- New pair `packages/i18n/src/catalogs/matches.en.ts` and `matches.ar.ts`; the Arabic typed
  `DeepMessages<typeof matchesEn>` like `branches.ar.ts` (G9c), so a missing key fails `typecheck`.
  Mounted as `matches:` beside `branches:` (`en.ts:996`, `ar.ts:908`); parity by
  `packages/i18n/src/__tests__/t.test.ts:35`. Sub-namespaces: `common`, `book`, `list`, `create`,
  `detail`, `link`, `states`, `tickets`, `pay`, `report`, `blocks`, `messages`, `gender`, `errors`,
  `count`, `web`. Created in the 0256 commit (with `errors.genderAlreadySet`), filled by the later
  commits.
- Existing namespaces gain `profile.nameShownHint`, `profile.genderFemale`, `profile.genderMale`,
  `profile.tickets`, `profile.blockedPlayers` and `errors.requestGone`. `profile.deleteBody`
  (`en.ts:781`) gains DF-20's line: "You also leave your open matches, and your unused tickets are
  refunded to the card you paid with."

**Plurals.** `t()` has none (`packages/i18n/src/t.ts:36-48`).
- New `packages/i18n/src/plural.ts` exports `pluralForm(n, locale)`, hand-coded to CLDR: en `one` when
  n = 1, else `other`; ar `zero` 0, `one` 1, `two` 2, `few` when n % 100 is 3..10, `many` when 11..99,
  else `other`. Not `Intl.PluralRules`: Hermes' Intl is a partial shim (`formatting.ts` already guards a
  missing `formatToParts`). It also exports `countPhrase(key, n, locale)`, which picks the form and
  passes `{count: isolateLtr(String(n))}` (the web's `hoursPhrase` pattern,
  `apps/web/src/lib/site/plural.ts:22`). Both exported from `index.ts`. A test compares `pluralForm`
  with Node's `Intl.PluralRules` for 0..300.
- The operator uses the same helper for its counted phrases (rules review G9b).
- Keys follow the house pattern (`site.hoursCount.{zero,one,two,few,many,other}`,
  `site.ar.ts:52`). The counted phrases live under `matches.count.<key>`. AR **DRAFT-AR**; `{count}` is
  LTR-isolated Latin digits:

| Key | EN one / other | AR zero · one · two · few · many · other |
| --- | --- | --- |
| `seatsLeft` | 1 seat left / {count} seats left (zero: No seats left) | لا مقاعد متاحة · مقعد واحد متاح · مقعدان متاحان · {count} مقاعد متاحة · {count} مقعدًا متاحًا · {count} مقعد متاح |
| `seats` | 1 seat / {count} seats | لا مقاعد · مقعد واحد · مقعدان · {count} مقاعد · {count} مقعدًا · {count} مقعد |
| `tickets` (subject) | 1 ticket / {count} tickets | لا تذاكر · تذكرة واحدة · تذكرتان · {count} تذاكر · {count} تذكرة · {count} تذكرة |
| `ticketsGen` (after a verbal noun or a preposition) | as `tickets` | as `tickets`, but two: تذكرتين |
| `ticketsReady` | 1 ticket ready / {count} tickets ready (zero: No tickets yet) | لا تذاكر بعد · تذكرة واحدة جاهزة · تذكرتان جاهزتان · {count} تذاكر جاهزة · {count} تذكرة جاهزة · {count} تذكرة جاهزة |
| `ticketsHeld` | 1 held for a request / {count} held for requests | — · تذكرة واحدة محجوزة لطلب انضمام · تذكرتان محجوزتان لطلبات انضمام · {count} تذاكر محجوزة لطلبات انضمام · {count} تذكرة محجوزة لطلبات انضمام · (as many) |
| `ticketsInMatch` | 1 in a match / {count} in matches | — · تذكرة واحدة في مباراة · تذكرتان في مباريات · {count} تذاكر في مباريات · {count} تذكرة في مباريات · (as many) |
| `ticketsUse` | Uses 1 ticket / Uses {count} tickets | — · تُستخدم تذكرة واحدة · تُستخدم تذكرتان · تُستخدم {count} تذاكر · تُستخدم {count} تذكرة · (as many) |
| `ticketsBack` | ticket back / tickets back | — · عادت تذكرتك · عادت تذكرتاك · عادت تذاكرك · عادت تذاكرك · عادت تذاكرك |
| `ticketsLost` | ticket lost / tickets lost | — · فُقدت التذكرة · فُقدت التذكرتان · فُقدت التذاكر · فُقدت التذاكر · فُقدت التذاكر |
| `playersNeeded` (after "waiting for") | 1 more player / {count} more players | — · لاعب واحد · لاعبَين · {count} لاعبين · {count} لاعبًا · (as many) |
| `playersNeededF` | as above | — · لاعبة واحدة · لاعبتين · {count} لاعبات · {count} لاعبة · (as many) |
| `games` | 1 game / {count} games (zero: no games yet) | لا مباريات بعد · مباراة واحدة · مباراتان · {count} مباريات · {count} مباراة · {count} مباراة |
| `noShows` | 1 no-show / {count} no-shows (zero: no no-shows) | بلا غياب · غياب واحد · غيابان · {count} مرات غياب · {count} مرة غياب · {count} مرة غياب |
| `openMatches` | 1 open match / {count} open matches | — · مباراة مفتوحة واحدة · مباراتان مفتوحتان · {count} مباريات مفتوحة · {count} مباراة مفتوحة · {count} مباراة مفتوحة |
| `openMatchesSoon` | 1 open match coming up / {count} open matches coming up | — · مباراة مفتوحة قادمة · مباراتان مفتوحتان قادمتان · {count} مباريات مفتوحة قادمة · {count} مباراة مفتوحة قادمة · (as many) |
| `minutes` (also in `guestStrings.ts`) | 1 minute / {count} minutes | — · دقيقة واحدة · دقيقتان · {count} دقائق · {count} دقيقة · {count} دقيقة |

"—" means the form is never shown (the caller renders nothing at zero); the key still exists for parity.

**Grammatical gender (AR).**
1. A third person ("a player", "the organiser", "former player") takes the feminine form in a `women`
   match and the masculine in `open` and `men`. Such keys come in pairs `x` / `xF`, EN repeating the
   same text so parity holds; a pure `byCategory(category, key)` picks one.
2. Text addressed to the reader avoids gendered verbs and adjectives: verbal nouns (حجز، بدء،
   الانضمام), passives (أُرسل، أُلغيت), "يمكن / يلزم / يُرجى + noun", unvocalised past tense (غادرت،
   سحبت) and possessive suffixes, which read the same for both.
3. Where a form cannot be avoided (the `organiser_handover` push, the profile's gender line), it
   follows the reader's own `profiles.gender`: `send-push` reads it, and the app has it from
   `useOwnProfile`. NULL counts as masculine.

**Bidi** (`packages/i18n/src/bidi.ts`): names through `isolate`; counts, `{taken}/4` and a friend
seat's "+1" through `isolateLtr`, so "+1" never flips to "1+"; times through `formatTime`; money
through `formatIQD`.

**Digits:** Latin in both languages (`formatting.ts:18-21` pins `ar-IQ-u-nu-latn`; `t()` stringifies
as-is). No string carries a hard-coded Arabic-Indic digit.

**Terms** (**DRAFT-AR**, for the client's review; the operator's `ws.matches` uses the same words):

| EN | AR |
| --- | --- |
| open match | مباراة مفتوحة |
| ticket | تذكرة (تذاكر) |
| wallet | محفظة (محفظتك) |
| organiser | المنظّم / المنظّمة |
| seat | مقعد |
| share (of the court) | حصة (حصتك) |
| request to join | طلب انضمام |
| front desk | الاستقبال |
| venue | النادي (as `booking.cancellationWindow`) |
| report / block | الإبلاغ / الحظر |

### 4.25 Legal: privacy, terms, account deletion

In `packages/i18n/src/catalogs/legal.en.ts` and `legal.ar.ts`, in one commit at 1.0 (§4.8), the Arabic
written in the same commit and marked for the client's lawyer (the Arabic version governs,
`terms.law.language`). The web pages that render these catalogs (`apps/web/app/[locale]/privacy`,
`terms`, `delete-account`) render the new keys. The consumer-law check (penalty-shaped forfeits,
refunds only on request at the desk) happens before this text freezes (CONTINUE, client steps).

**Privacy.**

| Key | Change |
| --- | --- |
| new `collect.matchesLead` / `collect.matches` | "Open matches." / "The matches you start, join or ask to join; your seats and whether you came; the open-match tickets you buy, use, lose or get refunded; the preset messages you send; the reports you make and the players you block; and, once, whether you are a woman or a man, which decides whether women-only or men-only matches are offered to you. The front desk can correct it." |
| `collect.push` (`:71`) | add "open-match updates and reminders, and other players' preset messages" |
| `collect.notCollected` (`:83-85`) | "There is no online payment, so we never collect card details." becomes "Online payments (court deposits and open-match tickets) are made on Qi Card's own payment page; we never see or store your card details." |
| new `use.matches` | "running open matches: showing a match to the players who can join it, seating players, holding and returning tickets, and telling players about their match — to perform our agreement with you;" |
| `use.rules` (`:97`) | add "handling reports and blocks between players, and limiting access to open matches" |
| new `share.players` | "Other players. When you are in an open match or ask to join one, the players who can see that match see your first name, the first letter of your surname and your preset messages. When you ask to join, the organiser also sees how many games you have played at Touch and how many you missed. Players never see your phone number, email address or full surname. A public match's time, branch, category and free seats are shown to other guests; a match link shows the same, with no names, to anyone who has it." |
| new `share.qi` (processor list) | "Qi Card — taking online payments and refunds for court deposits and open-match tickets;" |
| `share.ai` (`:117`), R14 | append: "When the owner asks about open matches, players' names and the gender a player gave can be included." |
| `retention.deleted` (`:133-134`) | add "your first name, surname and gender, and the list of players you blocked" to what is removed at once |
| new `retention.matches` | "Open matches you took part in stay in the venue's records without your name, as bookings do. Tickets, their purchases and refunds stay in the venue's accounts without your name; tickets you had not used are refunded to the card you paid with. Reports between players are kept for 12 months and then deleted (R36)." |

**Terms.**

| Key | Change |
| --- | --- |
| `metaDescription`, `intro` | name open matches beside bookings |
| `accounts.accurate` (`:189`) | add "In open matches, other players see your first name and the first letter of your surname." |
| `bookings.price` (`:198-199`) | "you pay at the venue — there is no online payment" becomes "you pay at the venue. Some bookings ask for a deposit paid online by Qi Card, and open-match tickets are bought online by Qi Card." |
| `app.use` (`:230`) | add the conduct clause: "Be respectful to other players. Don't use a name that is offensive or pretends to be someone else, and don't misuse reports. We may remove you from a match, or stop your account from using open matches, for this." |
| `messages.body` (`:237`) | add "updates about your open matches and other players' preset messages" |
| new section `openMatches` | title "Open matches"; items: **start and join** (a match is started on a free time and books the court when four players are in; until then no court is held, and a group booking the last free court cancels it); **tickets** (bought online by Qi Card, one per seat, seats taken for friends use your tickets, reusable, never expire, held while you are in a match or waiting for an organiser, back after you play or when a match is cancelled, lost if you don't come or if you leave a booked match and nobody takes your seat before it starts); **money back** (only for unused tickets, on request at the front desk, by a manager, to the card you paid with; one refund per purchase, once none of its tickets is in a match); **your share** (every player who comes pays their share of the court at the desk; a ticket is not a share); **the venue** (may cancel or move a match; tickets come back when it cancels); **women-only and men-only matches** (tell us honestly whether you are a woman or a man, and declare your friends honestly; the desk may check); **conduct** (the organiser may remove a player before the court is booked; the venue may remove a player or stop an account from using open matches; if the venue removes you from a match after the court is booked, for example for conduct or because you asked, your ticket is lost unless another player takes your seat before it starts, and a removal made by mistake gives it back, as `desk_remove_seat` does, `db.md` §4.7.6); **deleting your account** (you leave your matches and unused tickets are refunded) |
| `ending.body` (`:249`) | "suspend or close an account" becomes "suspend or close an account, or stop it from using open matches," |

**Account deletion.**
- Web `deleteAccount.what.deleted` (`:326-327`): add "your first name, surname and gender, and the
  players you blocked".
- `deleteAccount.what.kept` (`:328`): add "open matches you played in, and reports between players
  (for 12 months)", without your name.
- New `deleteAccount.what.tickets`: "Open-match tickets you have not used are refunded to the card you
  paid with." (rules review §4.5 item 4).
- In the app: `profile.deleteBody` (§4.24).

**Terms version.** `CURRENT_TERMS_VERSION` moves to the 1.0 publication date in the same commit, so the
0153 consent gate asks everyone again (DF-17). `platform_settings.match_terms_version` is set to the same
value by a later migration, only once that build is on phones. One bump covers the deposit wording and
open matches.

### 4.26 Store

| File | Change |
| --- | --- |
| `docs/store/app-store-submission.md:45` (In-App Purchases) | "**None.** Online payments are court deposits and open-match tickets, both paid by Qi Card for a service used in person at the venue (Guideline 3.1.3(e)). A ticket is redeemable only for a seat in a match at the venue, is refundable at the front desk, and is never spent on digital content." (rules review §4.5 item 5; how a reviewer reads reusable tickets is UNVERIFIED) |
| same, `:80` (Other Data Types) | "bookings and open matches (court, date, time), and the gender a player gives for women-only and men-only matches" |
| same, data table and `:87-89` | a Purchases → **Purchase History** row: court deposits and open-match tickets paid by Qi Card, no card data; `Purchases` leaves the "Not collected" line |
| same, `:126` (User-generated content) | **Yes** (DF-17): "Players in open matches see each other's first name and surname initial, and fixed preset status messages. There is no free text. Report, block and a venue ban are built in (Guideline 1.2)." |
| same, `:127` (Messaging or chat) | **No**: "fixed preset statuses only; no direct messages" |
| same, §3 age rating (`:117`, `:131`) | "expect 4+" becomes "record the rating Apple computes": UGC Yes can change it |
| same, review notes (`:179`) | open matches: where they are (Book → a free time → Start an open match; Book → Open matches); the review account is a sandbox profile whose tickets are Qi sandbox tickets that only work in sandbox matches, which never book a real court (DF-19); how to buy them (Qi's sandbox card); the partner match to join; where report and block are (a player's seat → menu) |
| `docs/client/app-store-connect-chrome-prompt.md:115-116` | the same UGC and messaging answers; "must be 4+" becomes "record the rating Apple computes" |
| `docs/store/google-play-data-safety.md:35` | "Nothing is shared" stays; add that names shown to other players are shown at the user's own action (joining a match), which Play treats as a user-initiated transfer, not sharing. UNVERIFIED against Play's current wording |
| same, data table | Personal info → **Other info**: gender, Optional, App functionality; Financial info → Purchase history (`:46`): add deposits and open-match tickets paid by Qi Card; App activity → **Other actions**: open matches, requests, preset messages, reports, blocks |
| same, `:60` | "The guest side of the app has no free-text field that reaches the server" gains "other players see only a first name and surname initial, and preset messages that are not free text" |
| `docs/store/app-store-listing.md:218-226` | "no leagues, no ranking, no **level-based** matchmaking" (OM-16); the "The app takes no money" rule becomes "online payment is Qi Card, for court deposits and open-match tickets, for a service used at the venue; never 'in-app purchase', 'top-up' or 'credit'". Open matches appear only in the listing of a binary that has them. Listing line: "Open matches: start a game at any free time, or join one. Four players book the court together, and each pays their share at the desk." / «المباريات المفتوحة: ابدأ مباراة في أي وقت متاح أو انضم إلى واحدة. يحجز أربعة لاعبين الملعب معًا، ويدفع كلٌّ حصته عند الاستقبال.» **DRAFT-AR** (store marketing copy: the imperative is the listing's register) |
| `docs/design/mobile-ui/touch-padel-mobile-ui-spec.md:507` | the do-not-build line's "open matches, seat claiming, cost splitting" is marked superseded by this milestone |

**The App Review account (DF-19; decided, it had no owner).** No new SQL:
1. `scripts/create-review-account.mjs` gains `--sandbox`, which sets `profiles.payment_sandbox = true`
   on the account it creates (today set by hand). The owner runs it twice: the reviewer and a partner.
2. Before submission the owner signs in as the partner, buys two sandbox tickets with Qi's sandbox
   card, and starts a public, open-join, open-category sandbox match for "Me + 1" at the review
   branch, at least a week out (2/4).
3. The review notes tell the reviewer to buy sandbox tickets, join the partner's match (3/4, so it never
   needs a court), send a preset message, report and block the partner from the seat menu, open the
   wallet, and leave (the ticket comes back). Sandbox matches never book a real court and only sandbox
   profiles see them. If the match expires before review, the owner starts another.

### 4.27 Tests, smoke rows, testIDs, fixtures, device checks

**`apps/mobile/src/smoke/routes.ts`** gains seven rows. Its header (`:18-21`) and the testID paragraph
of `apps/mobile/CLAUDE.md` gain the two fixed spellings `match/[id]` → `match-detail` and `m/[token]` →
`match-link`:
```ts
{ file: 'matches.tsx', route: 'matches', primary: 'matches.start-one' },
{ file: 'match/[id].tsx', route: 'match-detail', primary: 'match-detail.join' },
{ file: 'match-new.tsx', route: 'match-new', primary: 'match-new.start' },
{ file: 'm/[token].tsx', route: 'match-link', primary: 'match-link.sign-in' },
{ file: 'match-report.tsx', route: 'match-report', primary: 'match-report.submit' },
{ file: 'blocked-players.tsx', route: 'blocked-players', primary: 'blocked-players.list' },
{ file: 'tickets.tsx', route: 'tickets', primary: 'tickets.buy' },
```
No new `_layout.tsx` (routes.test.ts allows exactly two). `+native-intent.ts` is not a route.

**`src/smoke/matches.smoke.test.tsx`** (new) renders each route in EN and AR. Every primary has a
static label (G10): `matches.list.startOne`, `matches.detail.join`, `matches.create.start`,
`matches.link.signIn`, `matches.report.submit`, `matches.tickets.buy`; `blocked-players` uses
`nearbyKey: 'matches.blocks.empty'`. `match-detail` renders `matchDetailFixture` (a viewer, an instant
match at 3/4, two tickets); `match-link` renders signed out with `matchInviteFixture` (`open`).
`deposit.smoke.test.tsx` gains a `pay-status` case for `ticketsBought`.

**Fixtures** (`src/test/fixtures.ts`): `matchDetailFixture`, `matchRestrictedFixture`,
`openMatchesFixture`, `matchSlotsFixture`, `matchQuoteFixture`, `matchInviteFixture`,
`myTicketsFixture`, `myBlocksFixture`, `myMatchesFixture`. Existing suites seed `matchKeys.mine(…)` →
`[]` and `matchKeys.tickets` → an empty wallet, so `bookings` and `profile` still render;
`venueSettingsFixture` (`:77`) defaults `matches_enabled: false`, so `book` is unchanged.

**testID lint.** `packages/config/src/eslint.js` `testIdElements` (`:178`) gains `SeatGrid`,
`RequestRow`, `QuickMessageBar`, `GenderAsk`, `MatchRow`, `MatchEntryRow`, `MatchRulesCard` and
`MatchRestrictedCard`. Each takes a required `testID` and forwards `${testID}.<child>` explicitly.
`MatchPoster` and the money card render no Pressable; `nativeChoice.ts` renders nothing.

**Mobile, vitest (pure):**
- `features/matches/__tests__/state.test.ts`: every row of §4.15, the desk-seat variants, the m/f
  choice;
- `logic.test.ts`: `slotActions` (OM-42/OM-43 hints, the Android cap of three, `['book']` skipping the
  sheet); `chipCellKeys`; `tradingNightOf` at 00:30; `mergeReservationLists`; `displaySeat` (former,
  "Player", friend "+1" and "+2" isolation);
- `links.test.ts`: `/m`, `/en/m`, `/ar/m`, the full https URL, the custom scheme, auth and pay-return
  untouched, bad tokens; `siteUrl()`'s host;
- `pendingJoin.test.ts`, `continuation.test.ts` (one run per ref, 30-minute staleness, the key reused,
  a cold start), `pushRoutes.test.ts` (parity with the JSON), `errors.test.ts` (`matchErrorText` with
  each detail);
- `deposit/__tests__/logic.test.ts`: the ticket branches of `parseDepositStatus` and `screenFor`, and
  `amount_mismatch` never `slotLost` for a ticket;
- `deposit/__tests__/pendingPayment.test.ts`: old pointers parse; `purpose` and `after` round-trip; a
  malformed `after` is dropped; `/m/…` is not a resting path;
- `profile/__tests__/pushSync.test.ts`: a guest route opens whatever the staff status; staff routes
  unchanged;
- `booking/__tests__/errors.test.ts`: every new code, `RATE_LIMITED`, `REQUEST_NOT_FOUND` →
  `errors.requestGone`, `rpcErrorDetail`;
- `lib/__tests__/queryDefaults.test.ts`: `['match']` is never dehydrated; the mutation defaults;
- the `matchIntentKey` memo.

**i18n:** `packages/i18n/src/__tests__/plural.test.ts` (`pluralForm` against Node's `Intl.PluralRules`
for 0..300; `countPhrase`); `t.test.ts` parity covers the new pair.

**Web:**
- `app/[locale]/m/[token]/page.test.tsx`: each state in EN and AR as catalog strings; no name, phone,
  price or id rendered even when the fixture carries them; `noindex` and `no-referrer`; no
  `OpenAppOnLoad`; the reads mocked at `@/lib/site/matchInvite.server`.
- `src/lib/site/matchInvite.test.ts`: tokens of 21, 22 and 23 characters, a dot, a slash.
- `src/lib/security/proxy.test.ts`: `/m/<t>` → 307 `/{locale}/m/<t>`.
- The applinks case: `/m/*`, `/en/m/*`, `/ar/m/*` present, `/t/*` absent.
- `site-css.test.ts` registers `matchInvite.css.ts`; `pnpm security:web`.
- Optional: `e2e/tests/match-invite.spec.ts`, EN and AR.

**DB and edge:** `outbox-kinds.test.ts` (§4.4), `profile-names.test.ts` and the SEC-20 extension
(§4.5), `guest-push.test.ts` (§4.6), `send-push-guest.test.ts` and `send-push-staff.test.ts` (§4.7).

**On a device** (TestFlight and an internal APK):
- a WhatsApp link opening the app on iOS and Android, on the bare, `/en` and `/ar` paths; what
  `+native-intent` receives (full URL or path);
- the app killed on Qi's page mid-purchase, then resuming and continuing the join by itself;
- a Qi decline, then a retry;
- a bump arriving while the detail is open (the foreground push refreshes it);
- an Arabic lock screen showing no name;
- the rally with the sheet and chips open.

### 4.28 Files touched

**DB and edge:**
- `packages/db/supabase/migrations/2026MMDD000254_outbox_match_kinds.sql` (new)
- `packages/db/supabase/migrations/2026MMDD000255_profile_names_gender.sql` (new)
- the Guest part of `2026MMDD000260_match_guest_rpcs.sql` (§4.6)
- `packages/db/supabase/functions/_shared/guest-push.json` (new), `_shared/staff-push.json`
- `packages/db/supabase/functions/send-push/index.ts`, `guestStrings.ts` (new), `staffStrings.ts`
- `packages/db/tests/outbox-kinds.test.ts`, `profile-names.test.ts`, `guest-push.test.ts`,
  `send-push-guest.test.ts` (new); `send-push-staff.test.ts`, `stored-fields.test.ts`, `rls-matrix.ts`
- `packages/db/scripts/check-broadcast-payloads.mjs`, `check-analytics-payload.mjs`
- `packages/db/fixtures/assistant-coverage.json`, `rpc-allowlist.json`, `rpc-coverage-floor.json`,
  `error-codes-unmapped.json`
- `packages/db/src/types.gen.ts`; `packages/db/CLAUDE.md` (the push-kind line)
- `scripts/create-review-account.mjs` (`--sandbox`)

**Mobile, new:** `app/matches.tsx`, `app/match/[id].tsx`, `app/match-new.tsx`, `app/m/[token].tsx`,
`app/match-report.tsx`, `app/blocked-players.tsx`, `app/tickets.tsx`, `app/+native-intent.ts`;
`src/features/matches/` (`keys.ts`, `api.ts`, `hooks.ts`, `logic.ts`, `state.ts`, `links.ts`,
`pendingJoin.ts`, `continuation.ts`, `tickets.ts`, `pushRoutes.ts`, `errors.ts`, `__tests__/*`);
`src/features/booking/pendingIntent.ts`; `src/components/match.tsx`; `src/components/nativeChoice.ts`;
`src/smoke/matches.smoke.test.tsx`.

**Mobile, edited:** `app/_layout.tsx` (the `Stack.Screen` entries at `:247-287`, the handler at
`:363-367`); `app/(tabs)/bookings.tsx`; `app/(tabs)/profile.tsx`; `app/booking-history.tsx`;
`app/pay/status.tsx`; `app/profile-edit.tsx`; `app/complete-profile.tsx`; `app/sign-up.tsx`;
`app/sign-in.tsx`; `app/verify-result.tsx`; `app/welcome.tsx`; `app.config.ts`; `eas.json`;
`CLAUDE.md`; `src/components/BookingSheet.tsx`; `src/components/booking.tsx`;
`src/features/availability/useAvailabilityBooking.ts`; `src/features/availability/hooks.ts`;
`src/features/booking/usePostAuthContinue.ts`; `src/features/booking/errors.ts`;
`src/features/auth/RequireNoSession.tsx`; `src/features/auth/useSocialSignIn.ts`;
`src/features/deposit/api.ts`, `hooks.ts`, `logic.ts`, `pendingPayment.ts`;
`src/features/profile/api.ts`, `push.ts`, `pushSync.ts`, `purgeKeys.ts` (comment);
`src/lib/idempotency.ts`; `src/lib/legal.ts` (`siteUrl()` exported); `src/lib/queryClient.ts`;
`src/smoke/routes.ts`; `src/smoke/deposit.smoke.test.tsx` and the existing suites' seeds;
`src/test/fixtures.ts`.

**Config, i18n, core:** `packages/config/src/eslint.js`; `packages/i18n/src/plural.ts` (new),
`index.ts`, `__tests__/plural.test.ts` (new), `catalogs/matches.en.ts` and `matches.ar.ts` (new),
`catalogs/en.ts`, `catalogs/ar.ts`, `catalogs/legal.en.ts`, `catalogs/legal.ar.ts`;
`packages/core/src/legal/terms.ts` and its test.

**Web:** `app/[locale]/m/[token]/page.tsx` and `page.test.tsx` (new); `src/lib/site/matchInvite.ts`,
`matchInvite.server.ts`, `matchInvite.test.ts` (new); `src/styles/site/matchInvite.css.ts` (new);
`src/styles/site/site-css.test.ts`; `src/lib/security/applinks.ts` and its test;
`app/.well-known/apple-app-site-association/route.ts` (comment); `src/lib/security/proxy.test.ts`;
`app/[locale]/privacy`, `terms`, `delete-account` pages (new keys); `public/brand/site/og-match-en.png`
and `og-match-ar.png` (when delivered); `CLAUDE.md` (page list). Vercel env: `APPLE_TEAM_ID`, later
`ANDROID_SHA256_FINGERPRINTS` and the store URLs.

**Docs:** `docs/store/app-store-submission.md`, `docs/store/google-play-data-safety.md`,
`docs/store/app-store-listing.md`, `docs/client/app-store-connect-chrome-prompt.md`,
`docs/design/mobile-ui/touch-padel-mobile-ui-spec.md:507`; `HANDOFF.md`'s one open-matches scope-ledger
row gains the guest RPCs (D25).

### 4.29 Decisions (draft conflicts, review items, open technical questions)

Each was decided here; none changes what a player experiences beyond §0, except the defaults of §4.31.

| # | Item | Source | Decision |
| --- | --- | --- | --- |
| 1 | Ordinals 0249–0251 taken | `43625f39` | +3, §4.1 |
| 2 | 0256 split, initial, trigger, GUC, CHECKs | rules D1 | DB's rules, Guest writes the file; no gender rule in the trigger |
| 3 | `set_my_gender` | rules D36 | DB's order; returns `gender_set_at` and `duplicate` |
| 4 | Partial sign-up metadata could shorten `full_name` | found here | parts used only when they rebuild the name exactly |
| 5 | `[[:alpha:]]` depends on the database ctype | found here | explicit letter ranges, binding DB's `name_initial` (0260) |
| 6 | Who fans events out to pushes | R26, rules D27 | Guest, 0261, two triggers; the triggers are the only callers of `match_sync_reminders` |
| 7 | `tickets_refunded` | rules D26 | through `match_notify` |
| 8 | Queue for a profile with no token? | draft vs 0090 | no (0090's guest rule) |
| 9 | A request expired by a match's end got two pushes | found here | `request_expired` only for `match_full`, `organiser_gone`, `closed` |
| 10 | Staff key in push A turns CI red | `staff-push.test.ts:178-190` | ships with 0261 (R5 amended) |
| 11 | 0255 after `send-push` "but how" | draft conflict 5 | push A, then push B |
| 12 | `REQUEST_NOT_FOUND`, `RATE_LIMITED` | R6, G7a | as R6, in the 0256 commit, with `--update` |
| 13 | Where catalogs and code maps land | R11, R28 | the pair in the 0256 commit; each SQL commit maps its codes |
| 14 | FORBIDDEN lists, `Category` | rules D31, G5f, G6b | DB's nine patterns and `'Other personal info'`, once, in the 0256 commit |
| 15 | Read contracts | R31, rules D11–D17, D33 | §4.3; `my_matches` decided here |
| 16 | Guest window | rules D11, R27 | ≤ 16 days; the phone sends start of today + 16 days |
| 17 | The key-reuse sentence | rules D34 | corrected (§4.10.3) |
| 18 | R32's four dead ends | R32, rules §4.1 items 1–4 | §4.15 |
| 19 | Wallet limit, forfeit push, ineligible requester, too-late minutes, purchase in progress, cash-out note | rules §4.1 items 5–10 | §4.22, §4.7.4, §4.14, §4.10.1 |
| 20 | Web delete-account copy; assistant processing; retention | G11, R14, R36 | §4.25 |
| 21 | 3.1.3(e) wording for reusable tickets | rules §4.5 item 5 | §4.26 |
| 22 | DF-19 review seeding had no owner | rules DF-19 | Guest: `--sandbox` plus an owner runbook, no SQL (§4.26) |
| 23 | `amount_mismatch` would read "slot lost" for a ticket | found here | never for tickets (§4.10.4) |
| 24 | `pay/status` forgets the pointer before the continuation is read | found here | read at mount, forget after (§4.10.3) |
| 25 | Profile selects before 0256 is hosted fail every profile read | found here | push C2 after C (§4.8) |
| 26 | Edge refusals lose their detail | found here | `ticket-begin` sends `{error, detail}`; `DepositEdgeError.detail` |
| 27 | Reminder clean-up would scan the outbox | found here | a predicate the `notification_outbox_due` index serves |
| 28 | Push times | found here | branch timezone, Latin digits |
| 29 | Legal text before the feature is public | found here | with the 1.0 terms bump |
| 30 | C15 (overlapping seats) | concurrency C15 | DB decided: its own code `MATCH_TIME_CLASH` (db D-7, R41); the phone maps it to `matches.errors.timeClash` (§4.22) |
| 31 | `+native-intent` gets a URL or a path? | draft OQ1 | both accepted; device check |
| 32 | Hermes `Intl.PluralRules` | draft OQ2 | hand-coded `pluralForm` |
| 33 | Play "sharing"; Apple's rating | draft OQ3 | not shared (UNVERIFIED); record Apple's rating |
| 34 | Continuation window, cold start | draft OQ5 | 30 minutes, cold start included |
| 35 | `match-report` presentation | draft OQ6 | `modal` |
| 36 | Prefix list; report retention | draft OQ7 | DB's list; R36 |
| 37 | OG poster | draft OQ8 | the site image until delivered |
| 38 | Staging builds claim production links | draft OQ9 | accepted |
| 39 | Chips per lane | draft OQ10 | first free lane only |
| 40 | Terms bump timing | draft OQ11 | one bump at 1.0 for deposits and matches |
| 41 | Store badges on the invite page | found here | the `#app` band, as `pay/return` |
| 42 | Share URL source | found here | `src/lib/legal.ts` `SITE_URL` |

**Known limits.** A family name starting with a non-article `ال` loses it in the initial (`الياس` →
`ي`). The invite preview is a static image. Android links open the web page until the Play
fingerprints are set. A staging build answers `MATCH_NOT_FOUND` to a production link. Seat joins reach
the Book chips on the 60 s poll. Builds older than push G open nothing for a match push. The web page
cannot tell a gone match from one that never existed (no oracle, by design).

### 4.30 Changes to §1 (for §1.12)

1. **§1.1.** Every ordinal + 3 (0249–0262 → 0253–0265; §1.1 is being updated). 0255 lands in its own
   push after push A. 0261's owner is "DB + Guest"; 0260 is "DB" (Money's internals went to 0262).
   Guest's `match_notify` and `match_sync_reminders` are defined in 0261, next to the triggers that
   call them, not in 0260 as rules D28 had it. DB never calls either, so nothing in 0260 depends on
   the move; the merge took 0261 (`db.md` §4.5.6, §5.2) and the R30 coverage entries moved with it.
2. **§1.5, new internal functions.**
   - 0256 (Guest): `split_person_name(text) returns text[]`, `trg_profile_names() returns trigger` with
     trigger `profiles_sync_names`; GUC `app.skip_name_sync`. `name_initial(text) returns text` is DB's
     (0260), with the explicit letter class of §4.5.
   - 0261 (Guest): `match_notify(p_match_id uuid, p_recipients uuid[], p_title_key text, p_params jsonb
     default '{}', p_actor uuid default null, p_scheduled_for timestamptz default null, p_dedupe text
     default null) returns int`; `match_sync_reminders(p_match_id uuid) returns void`;
     `trg_match_event_push() returns trigger` with trigger `match_events_push` (AFTER INSERT on
     `match_events`); `trg_match_ticket_event_push() returns trigger` with trigger
     `match_ticket_events_push` (AFTER INSERT on `match_ticket_events` WHEN `type = 'forfeited'`).
   - The two triggers are the only callers of `match_sync_reminders` (R26 detail); DB's bodies do not
     call it.
3. **§1.6.** `set_my_gender(p_gender text)` returns `{gender, gender_set_at, duplicate}`; refusals in
   order `AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `INVALID_ARGUMENT`, `GENDER_ALREADY_SET`.
4. **§1.3.** Codes on the `request_expired` event: `match_full`, `organiser_gone`, `closed`, `banned`,
   or the match's `ended_reason`. `match_end` stamps `decided_at = now()` on the requests it expires.
5. **§1.9.** The payload is `{route, id, title_key, params, dedupe?}`. No title key is added beyond R3.
   A `no_court` ending pushes `match_cancelled`; `request_expired` is pushed only for `match_full`,
   `organiser_gone` and `closed`.
6. **R5 amended.** The staff key's `staff-push.json` entry, `staffStrings.ts` copy and pure-test update
   ship in the same commit as DB's `notify_staff` re-issue (0261, push D), not in push A.
7. **R31, read contracts** (§4.3): `match_detail`'s restricted shape carries `restricted: true`;
   `seats[]` gain `open` and `can{remove, report, block}`; `me` carries `excluded`, `tickets_available`,
   `tickets_needed`, `leave_outcome` and `request.request_id`; `my_matches` has the §4.3 row (`request{}`
   replaces `my_request_status`; seats carry `end_reason`, `share_iqd`, `request_id`, `ticket_status`;
   linked desk seats included); `match_quote.refusal` never carries `NEED_TICKETS`; a guest window
   "over 16 days" is `INVALID_ARGUMENT`.
8. **Money's edge.** `ticket-begin` refusals are `{error, detail}` when the SQL refusal has a detail.
9. **§1.10, mobile keys.** `matches.errors.{tooLateAt, walletLimit, timeClash, needTicketsCount,
   updateApp}` (`timeClash` for DB's new `MATCH_TIME_CLASH`), `matches.tickets.tooManyAttempts`,
   `errors.requestGone`; `RATE_LIMITED` and `RETRY_LATER` entries (R6).
10. **§1.11, client names.** `apps/mobile/src/features/matches/`; `matchKeys` (§4.23) with its
    mutation names; the idempotency prefix `MOBILE:match.start:`; `packages/i18n/src/plural.ts`
    (`pluralForm`, `countPhrase`); `pendingJoin`, `pendingIntent`, the ticket continuation;
    `PendingPayment.purpose` and `.after`; `DepositEdgeError.detail`; `rpcErrorDetail`; the components
    `SeatGrid`, `RequestRow`, `QuickMessageBar`, `GenderAsk`, `MatchRow`, `MatchEntryRow`,
    `MatchRulesCard`, `MatchRestrictedCard`, `MatchPoster`, `nativeChoice`; `siteUrl()`; the web's
    `matches.web.*`, `src/lib/site/matchInvite{,.server}.ts`; `_shared/guest-push.json`,
    `send-push/guestStrings.ts`; `scripts/create-review-account.mjs --sandbox`.

### 4.31 Defaults this lane takes, and the owner's questions

**Defaults** (player-facing; Parsa may reverse any):

| # | Default |
| --- | --- |
| GD-1 | After a purchase begun from a join, a request or a start, the app completes that action by itself, once, within 30 minutes; later, one tap. |
| GD-2 | Signing in from a link, a slot or the list never joins by itself: the guest sees the match and taps. |
| GD-3 | No push for a restored ticket, attendance marks, a call-off, a withdrawal or a played match. |
| GD-4 | The web invite page shows no price (and no names, DF-9). |
| GD-5 | The Book chips and the Open matches list show no names; names appear on the match screen to those allowed to see it. |
| GD-6 | One chip per time on the grid, on the first free court. |
| GD-7 | A quick-message chip rests for 2 minutes after a send. |
| GD-8 | A booked match's reminder 3 hours before (as bookings); the fill-deadline warning 30 minutes before the deadline (DB's sweep). |
| GD-9 | A friend seat reads "Ahmed K. +1". |
| GD-10 | The organiser's leave confirmation says "Another player becomes the organiser; if nobody is left, the match closes." |

**Owner questions** (still open, player-facing):
1. **Client:** the Arabic word for "ticket" (تذكرة here) and the review of every **DRAFT-AR** string in
   this file, including the legal Arabic, which governs. Already on CONTINUE's client list; nothing in
   the build waits for it except the 1.0 legal commit.

Nothing else in this lane waits on Parsa.
