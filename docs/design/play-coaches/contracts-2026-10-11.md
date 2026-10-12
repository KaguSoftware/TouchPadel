# Play tab, Coaches tab, tournament seating, play survey: build contracts (2026-10-11)

Majed's brief (2026-10-11), in his words where it binds:

- Open matches and tournaments leave the Book sheet and become **one page of their own**, mixed
  "in a nice way". The Book page still shows an open match **at its hour** in the court lanes.
- **Coach** becomes a whole page of its own **on the navbar**: a showcase with photos, shown **by
  level**, with **no hierarchy** between coaches ("so no coaches are offended").
- Inside a tournament, **by its format**, a grid on **both sides** where players "pick a chair".
  Nobody really picks a seat: the board just lists the entries into the tournament.
- Both new pages carry the Book page's 3D and motion energy.
- **My reservations** holds open matches, tournaments and coach lessons too.
- **Sign-up** asks an optional couple of questions (level, how much they have played) for better
  matching, without irritating anyone, and the app makes suggestions from the answers.

Every lane loads `/impeccable` (docs/PRODUCT.md + docs/DESIGN.md, product register, mobile rules in
`apps/mobile/CLAUDE.md` win on conflict). Palette is closed: `src/theme/tokens.ts` only.

## 1. Navigation

Five tabs, Book still the initial route and now the exact middle:

| order (LTR) | file | label key | testID (Android) | iOS SF symbol |
|---|---|---|---|---|
| 1 | `(tabs)/bookings.tsx` | `tabs.bookings` | `tabs.bookings` | `calendar` |
| 2 | `(tabs)/play.tsx` **new** | `tabs.play` | `tabs.play` | `sportscourt` |
| 3 | `(tabs)/index.tsx` | `tabs.book` | `tabs.book` | (as today) |
| 4 | `(tabs)/coaches.tsx` **new** | `tabs.coaches` | `tabs.coaches` | `figure.tennis` |
| 5 | `(tabs)/profile.tsx` | `tabs.profile` | `tabs.profile` | (as today) |

- `(tabs)/coaches.tsx` takes over the URL `/coaches`; `app/(coaching)/coaches.tsx` is deleted, so
  every existing `router.push('/coaches')` now lands on the tab. The rest of `(coaching)` stays.
- `(tabs)/play.tsx` replaces `app/matches.tsx` and `app/(tournaments)/tournaments.tsx`, both
  deleted. Every route that pointed at them points at `/play`:
  `{ pathname: '/play', params: { at?: string; date?: string; show?: 'matches' | 'tournaments' } }`.
  `at` / `date` keep their old meaning (scroll to that time / night and outline it).
  `(tournaments)` keeps `tournament/[id]` only.
- Profile's "My tournaments" row goes to `/bookings` (My reservations now lists them).
- Route ids: `play` and `coaches` (testID prefixes `play.` and `coaches.`).

## 2. Book sheet

The three entry cards under the court lanes (lessons, tournaments, open matches) are removed: each
now has a tab. The open-match marker on a lane time (`matchLineFor`) stays exactly as it is.
`useLessonEntry`, `useTournamentEntry` and the sheet's `matchEntry` go if nothing else uses them.

## 3. Motion kit (`apps/mobile/src/components/motion.tsx`) and the 3D court

`Rise` (staggered mount: fade, rise 16 pt, settle from 97 %), `useScrollY` (the page's scroll as
an Animated value) and `TiltPress` (press leans 3° and scales to 97 %; light haptic). Native
driver, ease-out-expo, Reduce Motion holds still. `TiltPress` is registered in `testIdElements`.

**Every court is the Book tab's 3D one** (Majed, 2026-10-11: "why aren't you using the 3D one
like the one in the Book page; fully delete the low-end one"). `src/components/CourtStage.tsx`
mounts `Court3D` fixed behind a scrolling page, **top-down, horizontal, no pitch** (Majed,
2026-10-11): `view="top"` (`packages/court3d/src/camera.ts`, `topCameraPose`) looks straight
down at the court, its length left to right across the phone and the net a vertical line in the
middle, framed to fill the stage's width with a small margin. Never the upright Book court, never
an angled view: no scroll-driven pitch, no lift, `progress` stays 0, the walls' edge-on glass and
mesh are not built, the tier is `lite` (no shadow pass) and the loop draws at 45 fps (paced to average 45 on 60, 90 and 120 Hz displays). Height
shows through the ball's ground disc moving off it and the ball drawn bigger the higher it flies.
The Book tab and the web keep `view="book"` (the default) and are unchanged. The flat
`CourtIllustration` and the fake-3D `PitchStage` are deleted; a phone without GL shows the brand
pattern and no court. Play runs the Book rally (`scene="rally"`, its two pairs either side of the
net). Coaches runs a coaching drill (`scene="drill"`, `packages/court3d/src/drill.ts`): a coach
watching beside a ball machine on the screen's right half, feeding the four rackets on the left
half in turn, right to left across the net, each playing the Book swing at contact. Left and right
are the screen's and do not mirror in Arabic.

## 4. Data (migration `20261011000334_play_profile_coach_levels.sql`)

### 4.1 Player's play profile (profiles columns, own row)

| column | type | values |
|---|---|---|
| `play_level` | text null | `new`, `beginner`, `intermediate`, `advanced` |
| `play_years` | text null | `never`, `under_one`, `one_to_three`, `three_plus` |
| `play_wants` | text[] null | subset of `matches`, `tournaments`, `lessons` |
| `play_survey_at` | timestamptz null | set when answered or skipped; null = never asked |

- Write: `app.set_my_play_profile(p_level text, p_years text, p_wants text[])` → `jsonb`
  `{play_level, play_years, play_wants, play_survey_at}`. Any argument may be null (a skipped
  question; all three null = "skipped the survey"); always stamps `play_survey_at = now()`. Bad
  value → P0001 `INVALID_PLAY_PROFILE`. Authenticated only, own row via `auth.uid()`.
- Read: the own-profile select (`PROFILE_COLUMNS` in `apps/mobile/src/features/profile/api.ts`)
  gains the four columns if column grants allow; otherwise `app.my_play_profile()` with the same
  jsonb. Account deletion and the user-data wipe clear them.

### 4.2 Coach levels

- `coaches.levels text[] not null default '{}'`, subset of `beginner`, `intermediate`, `advanced`.
  **Empty means "all levels"**: such a coach shows under every level.
- Exposed as `levels` on each coach of `coaching_public` and on `coach_profile`'s coach.
- Set from the operator's coach editor (a three-checkbox field), through the admin coach save RPC.
- A player level `new` reads as `beginner` when matching coaches.

### 4.3 Tournament entries before the draw

- `tournament_public` gains `entries`: `[{ player: PLAYER, mine: boolean }]`, the registered
  entries (status `registered`) in registration order, present before and after the schedule
  exists; `[]` for a missing tournament. PLAYER is the existing public shape (`name` "First I." or
  null, `former`, `no`); never a guest id, phone or full name (T-8 forbidden keys still hold).
  `mine` is false for anon.
- `TOURNAMENT_SHAPES.tournament_public` gains `entries` and nested `'entries[]': ['player','mine']`,
  `'entries[].player': PLAYER`.

## 5. Tournament seating board (tournament detail)

Americano and Mexicano are both 4 players a court, 2 a side. The board draws
`ceil(max_entries / 4)` courts; each court is a top-down padel court with the net across the
middle and **two chairs on each side** ("the grid in both sides"). Chairs fill in entry order:
taken chairs show the player's public name (or "Player N"), the guest's own chair is green and
says "You", open chairs read "Open". Tapping an open chair runs the existing Register action (the
seat assigned is simply the next one); a full board offers the waitlist as today. After the draw
the board shows round 1's real courts from `rounds[0]`. The format changes the board's caption
and legend: Americano "partners rotate every round", Mexicano "pairs re-form by score after each
round". The guest's chair arriving animates (rise + green fill); nothing else loops.

## 6. Coaches tab

A showcase: big photos, name, the kinds they teach, from-price. A level switch (All / Beginner /
Intermediate / Advanced), preselected from the guest's `play_level` when known.

**Amended 2026-10-12 (owner):** the switch is gone, and the tab shows no level at all. It
filters by the level saved in the play survey (§8), which the guest sees and changes in Edit
profile's Personal details ("Your game"). No level saved, or signed out: every coach. An empty
level offers "Show all coaches" until the saved level changes. **No hierarchy**:
every card the same size and weight, no "featured", no ranking; the order within a level is a
stable shuffle seeded by the date (it changes daily, so nobody is always first), not
`sortOrder`. A coach with no levels shows under every level. Group sessions and My lessons stay
reachable from the page.

## 7. Play tab

Open matches and tournaments in one page: the 3D court behind the list (`CourtStage`), a "For you" strip from the survey (§8), then one timeline by
night where open matches and tournaments interleave by start time, with All / Matches /
Tournaments chips and the category chips the matches list had. "Start a match" stays one tap away.
Signed-out guests browse; actions send them to the welcome as today.

## 8. Play survey (`app/play-survey.tsx`, native form sheet)

Three questions, one per step, big single-tap tiles, "Skip" always visible, progress dots:
1. Your level (`play_level`), 2. How long you have played (`play_years`), 3. What you are after,
multi-select (`play_wants`). Shown once, right after a new account finishes sign-up and lands on
the tabs, and **never** while a booking / match / lesson intent is pending (it waits for the next
calm landing). Skipping stamps `play_survey_at` so it never asks again. Profile carries a "Your
game" row to change the answers.

**Amended 2026-10-12 (owner):** the survey is the ONE place the app asks about the player. A
fourth step, gender (Woman / Man / Prefer not to say), follows the three while the profile has
none. It stays set-once (`set_my_gender`, OM-28; the desk corrects it), so a tap only chooses and
Done writes it; Skip, a swipe and "Prefer not to say" write no gender. The match start, match
join and tournament register screens no longer ask inline: on GENDER_REQUIRED `GenderAsk` says why
and opens `/play-survey?step=gender` (that question alone, Cancel, Save), and the screen re-reads
the profile when it saves. Edit profile's Gender row is unchanged (set once).

Suggestions are pure (`src/features/playProfile/suggest.ts`, vitest): from the answers they rank
what the Play tab's "For you" strip and the Coaches tab offer first, e.g. `new` / `beginner` or
`never` → coaches for beginners and group sessions first; `intermediate` → open matches and
Americano tournaments; `advanced` / `three_plus` → Mexicano tournaments and open matches; `play_wants`
reorders within that. Never a filter that hides anything: only an order and a short "why".

**Amended 2026-10-12 (owner):** what is SHOWN keeps to the wants. Once "What are you after?" has
an answer, the strip and the survey's last page leave out tournaments (Americano, Mexicano)
unless Tournaments was picked, and coaches unless Lessons was; group sessions and open matches
need no want. `suggest()` still ranks every kind; `topSuggestions` applies `fitsWants`. With a level
or years but no want, the strip offers group sessions alone and a line, "Want more suggestions?
Tell us what you're after.", that opens the survey's edit at that question (`step=wants`). Also:
"Not yet" (`play_years = never`) only fits the level "Just starting" (`yearsFitLevel`); the
survey dims it after any other level and drops it when the level changes.

## 9. File ownership (parallel lanes; touch nothing outside your list without asking)

- **DB lane**: `packages/db/supabase/migrations/20261011000334_*.sql`, `packages/db/tests/**` for
  it, `packages/db/src/types.gen.ts`, `packages/core/src/coaching/**` shapes, operator coach
  editor (`apps/operator/src/features/admin/coaches/**`) and its catalog keys, account-deletion /
  wipe scripts.
- **Play lane**: `src/navigation/TabsLayout.*`, `app/(tabs)/_layout.tsx`, `app/(tabs)/play.tsx`,
  tab icons in `src/components/icons.tsx` (add only), `src/components/BookingSheet.tsx`, deletes of
  `app/matches.tsx` + `app/(tournaments)/tournaments.tsx`, every route repoint in
  `src/features/{matches,tournaments,availability,coaching}/**` (pushRoutes, pendingJoin,
  continuation, hooks), `src/components/play.tsx` (new), `catalogs/play.*`, smoke + routes table
  for tabs / play / book.
- **Tournament lane**: `app/(tournaments)/tournament/[id].tsx`, `src/components/tournament.tsx`,
  `src/features/tournaments/logic.ts` (`entries` parser) + fixtures + tests,
  `packages/core/src/tournaments/shapes.ts`, `app/(tabs)/bookings.tsx` (tournament rows),
  `app/(tabs)/profile.tsx` (My tournaments row → /bookings), `catalogs/seating.*`,
  `catalogs/tournaments.guest.*` if needed, their smoke cases.
- **Coaches lane**: `app/(tabs)/coaches.tsx`, delete `app/(coaching)/coaches.tsx`,
  `src/components/coaching.tsx` (add only), `src/components/coachShowcase.tsx` (new),
  `src/features/coaching/logic.ts` (`levels` parser) + fixtures + tests, `catalogs/showcase.*`,
  coaching smoke cases.
- **Survey lane**: `app/play-survey.tsx`, `app/_layout.tsx` (register the sheet),
  `src/features/playProfile/**` (new), `src/features/profile/api.ts` (`PROFILE_COLUMNS`),
  `app/sign-up.tsx` / auth continuations only where the trigger needs it, `app/profile-edit.tsx`
  ("Your game" row), `src/components/forYou.tsx` (the strip the Play tab mounts),
  `catalogs/playProfile.*`, their smoke cases.
- Shared and already done: `src/components/motion.tsx`, `tabs.play` / `tabs.coaches` keys, the
  four empty catalog fragments wired into `en.ts` / `ar.ts`, `TiltPress` in `testIdElements`.
- `src/smoke/routes.ts` is shared: each lane edits only its own rows.
