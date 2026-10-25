# Who our customers are: build contracts (2026-10-24)

Majed's brief (2026-10-24), in his words where it binds:

- "The analytics currently shows a lot of numbers. Everything is great, but **there is nothing that
  shows exactly who our customers are**."
- "At sign up, the customer is **asked their gender, their age, their level**."
- "Obviously this level **will not be final, it will be measured**, and a **manager or their
  performance** will judge if that level is actually accurate or not."
- "Also make sure that it maybe gets **insights on what they're interested in. Without asking them**,
  of course, but **by the data that they provide**."
- "Make sure that the **marketing panel also gets this insight**. Because it's very valuable for the
  marketing team, as well as for the owner."

His four build decisions (2026-10-24, in answer to the questions this doc was written from):

1. **Age** is a **required age band**, one tap, not a birth date.
2. The **self-declared level is required**, one tap; "how long have you played" and "what are you
   after" stay skippable.
3. The real level is judged by **"coach or manager or desk staff"** — all three write it — and the
   system suggests one from performance and queues the mismatches for them.
4. Interests are **aggregate for marketing, per person for owner + manager + desk**.

Every UI lane loads `/impeccable` (docs/PRODUCT.md + docs/DESIGN.md, product register; the per-app
rules in `apps/mobile/CLAUDE.md` and `apps/operator/CLAUDE.md` win on conflict). Mobile palette is
closed: `src/theme/tokens.ts` only.

## 0. What already exists (verified 2026-10-24, not re-built)

| fact | where | asked |
|---|---|---|
| `profiles.gender` + `gender_set_at` / `gender_set_by` | 0256, a must since 0353 | sign-up form, complete-profile, survey step |
| `profiles.play_level` (new / beginner / intermediate / advanced) | 0334 | play survey, **skippable today** |
| `profiles.play_years`, `play_wants`, `play_survey_at` | 0334 | play survey, skippable |
| `profiles.birth_date` | 0302 | Edit profile only, optional, **no feature reads it** |
| players' counts, new vs returning, regulars, lapsing, frequency | `marketing_insights.players` (0360/0365) | — |
| the leaderboard's own levels (points bands) | `ranks_levels` (0364) — **a different thing**, not a play level | — |

So gender is done; age is asked nowhere that matters; the level is asked but skippable, never
checked, and never aggregated; interests are asked (`play_wants`) but never derived; and no surface
answers "who are our customers".

## 1. Data model — migration 0368 `customer_facts`

`profiles` gains, all nullable, plain columns with validated CHECKs (no rewrite):

| column | values | writer |
|---|---|---|
| `age_band` | `u18` \| `18_24` \| `25_34` \| `35_44` \| `45_54` \| `55_plus` | `app.set_my_age_band`, `app.set_customer_age_band`, `desk_register_customer` |
| `age_band_set_at` | timestamptz, stamped on every write | same |
| `level_confirmed` | the `play_level` vocabulary | `app.set_customer_level` only |
| `level_confirmed_at` | timestamptz | same |
| `level_confirmed_by` | uuid → `profiles.id` of the staff member or coach | same |
| `level_confirmed_role` | `coach` \| `court_desk` \| `manager` \| `owner` | same |
| `level_note` | text ≤ 120, `app.safe_line` sanitised | same |

- `level_confirmed_stamp` CHECK: the five confirm columns are all set together or all NULL
  (`level_note` may be NULL inside a set), as `profiles_gender_stamp` does for the gender.
- **Effective level** = `coalesce(level_confirmed, play_level)`, through
  `app.effective_play_level(profiles)`. Every read of "their level" uses it; nothing else guesses.
- Read grants: `age_band`, `age_band_set_at`, `level_confirmed`, `level_confirmed_at`,
  `level_confirmed_role`, `level_note` join the own-profile column grants (the 0334 pattern).
  `level_confirmed_by` gets **no** client grant: who judged is staff business, read through
  `customer_record`. The phone shows "Confirmed by the club", never a name.
- Account deletion / merge: the seven columns join `app.trg_profile_media_tombstone` (latest 0334)
  and the field-filling UPDATE of `app.merge_profiles_internal` (latest 0347) — the kept row wins,
  the dropped row's value fills a hole, as `birth_date` does, with the **whole judgment carried as
  one block** so a note never ends up under another judgment. `level_confirmed_by` is a foreign key
  to `profiles(id)`, so it also joins `app.profile_merge_columns` (latest 0364) as a `repoint`: a
  judge whose own account is merged away must not leave a pointer at a tombstone, and
  `account-merge.test.ts`'s FK-coverage guard fails until it is named.
- `tests/rls-matrix.ts` and `tests/stored-fields.test.ts` (`GUEST_DATA`) carry the new columns;
  SEC-29's forbidden list (`scripts/check-analytics-payload.mjs`) gains `level_confirmed_by` and
  `level_note` so neither can reach an analytics or broadcast payload.

### 1.1 Writers

- `app.set_my_age_band(p_band text)` — the caller's own profile, changeable (people age; a mistake
  is theirs to fix). `AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `INVALID_AGE_BAND`. Audited
  `profile.age_band_set`.
- `app.set_my_play_profile` (0334) is **unchanged**: the level stays its `p_level`. The required-ness
  is a client rule (§4), not a server one — a server that refused a NULL level would break the
  "skipped survey" contract the phone already ships.
- `app.staff_set_customer_age_band(p_profile_id uuid, p_band text)` — court desk, manager, owner
  (0262's `staff_set_customer_gender` pattern, name included). NULL clears the band with its stamp.
  Audited `customer.age_band_set`, without the value.
- `app.staff_set_customer_level(p_profile_id uuid, p_level text, p_note text default null)` — **coach**
  (`app.coach_self(false)` is not null), **court_desk**, **manager**, **owner**. Writes the five
  confirm columns, stamps the caller's role (the coach role wins only when they are not staff),
  audits `customer.level_confirmed` with the before/after. `p_level` NULL clears the confirmation
  back to "self-declared only". `CUSTOMER_NOT_FOUND`, `INVALID_PLAY_PROFILE` (detail `p_level`),
  `FORBIDDEN`.
- `desk_register_customer` (latest 0353) gains `p_age_band` and `p_play_level`, both default NULL,
  so the desk's walk-in registration can ask the same three things the phone does. The
  `desk-customer-create` edge function passes them through.

### 1.2 The suggested level (performance)

`app.level_suggestions(p_profile_ids uuid[])` (internal, service role; `app.level_suggested(uuid)`
is the one-player wrapper) reads **confirmed** `game_results` (0364) the player sat in, last 365
days, chain-wide — a level is a property of the player, not of a branch — and answers
`{level, games, wins, losses, score}` or no row:

- For each result: the opponents' side's known effective levels, averaged
  (`new` 0, `beginner` 1, `intermediate` 2, `advanced` 3). A result with no known opponent is
  skipped — it says nothing about anybody.
- `outcome` = +0.5 won, −0.5 lost, 0 drawn. `score` = avg(opponent average + outcome).
- Fewer than **5** scored results → NULL. Nobody is judged on three games.
- `level` = `round(score)` clamped to 1..3 → beginner / intermediate / advanced. The suggestion never
  says `new`: a player with five results is not new.

`app.customer_level_reviews(p_limit int default 30)` — coach, court_desk, manager, owner (cap 100).
The players whose suggestion disagrees with what the club has on record:
`suggested is not null and (level_confirmed is null or level_confirmed <> suggested)`, biggest
disagreement first, then most games. Each row: `{profile_id, name, claimed (play_level), confirmed,
suggested, games, wins, score, last_played_at}`. Names follow the desk's existing rule
(`customer_record`'s full name for staff). Cap 30.

### 1.3 Interests, derived and never asked

`app.customer_interest_tags(p_profile_ids uuid[], p_from date, p_to date)` (internal, service role)
returns `{profile_id, tags text[]}` over the branch in scope. A tag is a behaviour, never a figure,
and the list is **closed and ordered**:

| tag | earned by (inside the window) |
|---|---|
| `courts` | ≥ 2 kept court bookings they booked |
| `matches` | ≥ 1 open-match seat played or booked |
| `tournaments` | ≥ 1 live tournament entry |
| `lessons` | ≥ 1 lesson or course enrolment |
| `cafe` | ≥ 2 café orders on their own tabs |
| `shop` | ≥ 1 Touch Shop sale to them |
| `regular` | ≥ 4 plays |
| `weekend` | ≥ 60 % of plays start on Friday or Saturday (dow 5, 6) |
| `evenings` | ≥ 60 % of plays start at 18:00 or later |
| `daytime` | ≥ 60 % of plays start before 16:00 |
| `late` | ≥ 40 % of plays start at 22:00 or later |
| `group` | ≥ 2 matches they organised, plus lessons booked for more than one |
| `offers` | ≥ 1 promotion, loyalty reward or customer discount used |
| `ranked` | ≥ 1 result they reported or confirmed |

A **play** is a court booking the guest booked or an open-match seat they sat in: the two things
with a real start time, so they are the only ones the day-part and weekend words are measured on
(lessons, tournaments, café and shop visits are presence tags). A share needs something to be a
share of, so `weekend`, `evenings`, `daytime` and `late` need **3 plays at least** — one evening
visit does not make an evening player. Money never becomes a tag (no "big spender"): the rule of
0360 is that marketing sees no money, and a word that means money is money.

## 2. Analytics — the owner's People tab (migration 0369)

`app.analytics_customers(p_from date, p_to date)` — `app.analytics_guard()` (owner, or
`marketing_insights`' own transaction), the analysed branch, business-day bounds like every
`analytics_*` read. Exact figures, because this is the owner's page:

```
{ period,
  known:    { guests, withGenders, withAges, withLevels, judgedLevels, plays, bookings,
              spend_iqd, coveragePct, newGuests, returningGuests },
  genders:  [{ bucket, guests, plays, bookings, spend_iqd, share }],
  ages:     [{ bucket, guests, plays, bookings, spend_iqd, share }],
  levels:   [{ bucket, guests, judged, plays, share }],
  judged:   { checked, agree, higher, lower, unclaimed },   -- the claim against the judgment
  interests:[{ bucket, guests, share }],
  segments: [{ who, band, level, guests, plays, spend_iqd }],  -- top 12, under-5 folded to `other`
  peak:     [{ key, dow, hour, plays }],                       -- each bucket's two busiest slots
  fresh:    [{ key, newGuests, returningGuests }] }
```

**No key is named `gender`.** SEC-29 (`scripts/check-analytics-payload.mjs`) forbids a guest
identifier in a client-callable analytics payload, and it is right to: a per-person gender has no
business in a payload a model may read. These are counts of people, never a person, so the bucket
arrives as `who` / `bucket` and the gender is its VALUE. `level_confirmed_by` and `level_note` were
added to that gate's forbidden list in the same change.

A segment with fewer than **5** guests is folded into one `other` row, never printed as a
near-identifiable one. Spend is what settled on their own tabs and on the tabs of their bookings;
no court revenue is split by guesswork, and `marketing_insights` carries no money at all (§3).

Operator: a **third Analytics tab, People** (`/analytics/people`), beside Courts and Café
(`features/analytics/people/`), with five zones — Who they are (the crowd, the coverage meter, and
gender / age / level bars), What they're into (interest bars), Biggest groups (a table), When each
group plays (each bucket's two slots), and Are the levels right (the claim against the judgment,
beside new and returning). Every card is an existing one from `features/analytics/cards` and
`charts`; no new chart primitive and no new colour token (the Player card borrows the overview's
violet, which already has a blue-mode value).

## 3. Marketing — the People section of /insights (migration 0369)

`app.marketing_insights` (latest 0365) is re-issued with one more section, built from
`analytics_customers` through the same `app.marketing_read` assertion, and run through the 0360/0365
wording helpers so **no exact count, no money figure and no identity leaves it**:

```
people: { known (about-N), knownTrend(+Pct),
          coverage (level 0..4), coveragePct, coverageTrend(+Pts),
          genders: [{ bucket, share }],  ages: [...],  levels: [...],  interests: [...],
          judgedShare, overClaimedShare,
          growing: [{ bucket, trend, trendPct }],
          top:     [{ who, band, level, share }] }   -- at most 3 segments, shares only
```

- Shares are whole percents of the known crowd, computed server side; **a bucket under 10 guests is
  left out of the list entirely** (`app.mkt_buckets`), so marketing can never narrow a share down to
  a person. The shares of what is left therefore need not sum to 100.
- `coverage` is how much of the crowd the club actually knows (how many have gender + age + level),
  as a level word and a percent: marketing's own lever on "ask them at sign up".
- Trends ride the existing `Trend` shape (`dir` + `size` + `unit`), so `insightsLogic.ts` parses them
  with the parser it already has.

## 4. Mobile — asking the three things

1. **Sign-up form** (`app/sign-up.tsx`): an **age band row**, required, under the gender row — one
   tap of six. It rides in the sign-up metadata (`age_band`) exactly as the gender does, and is
   recorded once a session lands, by the gate below.
2. **`src/features/auth/ageBand.ts` + `useAgeBandRecord`** (mounted in `app/_layout.tsx` beside
   `useGenderGate`): the metadata's band is written through `set_my_age_band` on the first session,
   once per launch. It **only ever writes** — no gate, no wall. Unlike the gender, nothing in the
   club turns on an age band (no court hour depends on it), so a missing one costs the next calm
   ask, never a refusal.
3. **Complete profile** (`app/complete-profile.tsx`): the age band joins the screen, so a social
   sign-in that skipped the form still answers it.
4. **Play survey** (`app/play-survey.tsx`): the **level step loses its Skip** (`stepIsRequired`).
   One tap, then Next; the corner is empty on that step. A run that ends without a level —  swiped
   away, or dismissed — records **nothing at all**, so `play_survey_at` stays NULL, the next launch
   asks again and the Play tab's "Tell us your level" card stays: required without ever trapping
   anyone. An `age` step comes right after the level for an account whose row **has** the column and
   no answer in it; a server or a cached row without `age_band` is "not known", and then the step is
   not asked (the save would have nowhere to land).
5. **Edit profile**: an Age row (a wheel sheet of the six, changeable, no confirmation — a band is
   outgrown) under the gender, and, when the club has judged one, a read-only **Your level** row
   that explains "Confirmed by the club" when tapped. A confirmed level is shown, never hidden: it
   is the level the club will match them at. No judge's name reaches the phone (`level_confirmed_by`
   has no client grant).
6. `PROFILE_COLUMNS` (`src/features/profile/api.ts`) gains the granted columns.

## 5. Operator — the level, the queue, the tags

- **Customer record** (`features/desk/customers/CustomerRecord.tsx`): a **Player card** carrying the
  age band, the claimed level, the confirmed level with who confirmed it and when, the suggestion
  with its basis ("8 games, beats intermediate players"), and **Confirm level** — open to coach,
  court_desk, manager and owner, a short note optional. Below it the interest tags as chips (owner,
  manager and desk; §Decision 4).
- **Levels to check**: the `customer_level_reviews` queue is a **third view of the player ranks
  page** (`/admin/ranks`, beside Board and results and Rules and levels), where levels already live.
  Each row offers "Confirm <suggested>" or "Keep <claimed>"; either writes a judgment, so the row
  leaves the queue. Manager and owner judge from there; the court desk judges on the record,
  mid-conversation, which is where the desk actually is.
- **Customer create** (`CustomerCreate.tsx`) asks the age band and the level beside the gender, both
  optional at the desk — a queue of people waiting is no place for a refusal — through
  `desk-customer-create`'s new `ageBand` / `playLevel` fields. A band or level given at the desk
  only ever fills a hole: `desk_register_customer` never writes over what the guest answered
  themselves.

### 5.1 What is NOT built: the coach's own screen

The server lets a **coach** confirm a level (`app.staff_set_customer_level`, Majed's call), and the
operator surfaces are built for the desk, the manager and the owner. The coach-facing control is
deliberately **held**, because coach mode cannot show it without crossing a boundary the coaching
design set on purpose: "every staff and coach surface shows those [the typed name and phone], never
the profile's" (`docs/design/coaching/db.md` §4.3.9, R10/R44/C-21), and `coach_saved_students`
(0335) promises "never a phone, a profile id or whether a phone matched an account". A level is a
profile fact, so putting it on a coach's roster would tell the coach that a typed phone matched an
account — the one thing C-21 keeps from them until the guest answers "Is this you?".

Giving a coach the control needs one decision from Majed: may a coach see and set the level of a
student whose account they have confirmed the link to (`link_confirmed_at`), on that student only?
With a yes, it is a small migration (a level on the coach's read of a linked student) plus a sheet
in coach mode; nothing in 0368 has to change, because the write already allows a coach.

## 6. Gates (this build is not reported done before these pass)

- Root `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm security`.
- `pnpm --filter @touch/mobile test:smoke`.
- With Docker: `pnpm --filter @touch/db db:reset`, the stack suite, `check:locks`, `check:authz`,
  `check:analytics`, `check:broadcast`, `check:invariants`, and `pnpm db:types` with **no diff**.
- New test files: `packages/db/tests/customer-facts.test.ts` (11 cases: columns and their stamps,
  both writers and their guards, the merge, the tombstone, the suggestion arithmetic, the interest
  thresholds), `packages/db/tests/customer-analytics.test.ts` (6 cases: the shares, the 5-guest
  fold, the claim against the judgment, the peaks, and the marketing wall — no money key, no exact
  count, no uuid anywhere in `people`), plus the shared fixture `packages/db/tests/customers-plant.ts`.
  Clients: `apps/operator/src/features/players/playerLogic.test.ts`,
  `apps/operator/src/features/analytics/people/peopleLogic.test.ts`,
  `apps/mobile/src/features/auth/__tests__/ageBand.test.ts`, extensions to the play-profile logic
  test, the insights parser test, the analytics-tabs test, the auth capability matrix, and two new
  play-survey smoke cases (the age step, and a band the profile already has).
- `packages/i18n` EN + AR for every new string and error code; `fixtures/assistant-coverage.json`
  for every new RPC; `fixtures/rpc-allowlist.json` / the coverage floor as the registry gate asks.
