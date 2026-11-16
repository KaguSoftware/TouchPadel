# Staff clock-in: contracts (2026-11-15)

Binding contract for the three lanes of the staff clock-in build: the database (0442, done),
the staff phone (apps/mobile) and the operator (apps/operator). Majed's calls are in the header
of `packages/db/supabase/migrations/20261115000442_staff_clock.sql`; this file is how the
clients use it.

## 1. What it does

- Every staff member (never the owner) logs **arriving** and **leaving** from the staff app.
  It is impossible from home: the phone must be inside the club's radius **and** scan the QR on
  a desk station, whose 6-digit code changes every 30 seconds.
- **One QR, both ways.** The phone knows whether the person is in or out and offers "Start work"
  or "Finish work"; both scan the same QR.
- The QR is the **first thing on the operator**, on the sign-in screen before anyone signs in,
  and again from a **Staff QR** button once someone is signed in (for a colleague who arrives
  later).
- **Set hours** per person and weekday: any number of shifts a day, each optionally naming one
  of the person's jobs. Touching shifts are one block (a waiter-then-cashier day: one scan in,
  one scan out, no scan at the switch). A gap between shifts is time off and never counts
  against anyone.
- **Lateness records itself**: late = first scan after the matched shift's start; early =
  last scan before the end of the matched block. The day's minutes go into the existing
  `staff_attendance` row (source `clock`), which wages already read. A manager's own record of
  a day (source `manual`) always wins.

## 2. How the code works (no server call on the station)

`@touch/core/staff/clock`:

- `clockCode(secretHex, Date.now())` → `{ code, qr, secondsLeft }`. `qr` is `TPCLOCK:<code>`.
  Synchronous, offline, no account. RFC 6238, HMAC-SHA1, 30 s; the SQL twin is `app.clock_code`.
- `parseClockCode(raw)` → the six digits from a scanned `TPCLOCK:…` or typed digits, else null.
- `CLOCK_REFUSALS`, `ClockPunchResult`, `MyClock`, `ClockShift`, `WeekShift`.
- `weekProblem(week)` → the first bad shift and why (`empty`, `too_long`, `overlap`), the
  server's own rules, so the form can say what is wrong before saving. `shiftMinutes(s)`.

The station gets its secret **once** from `issue_station_clock_key(p_station_id)` (owner or
manager, signed in at that station) and keeps it on the machine. From then on it draws the code
itself, signed in or not, online or not. Issuing again replaces the secret: the old QR stops
working at once (the setup list shows when and by whom each key was issued).

## 3. RPCs (schema `app`, all through `appRpc`)

### Phone (any staff member of the branch but the owner)

`my_clock(p_venue_id)` →
```
{ now, today, ready, state: 'in'|'out', since, device_bound,
  shifts: [{starts, ends, role, block_starts, block_ends}],   // today's
  current: {starts, ends, role} | null,                        // running now
  next:    {starts, ends, role} | null,                        // within a week
  recent:  [{kind, status, refusal, at, late_minutes, early_minutes}] }   // last 6
```
`ready` false = the club's place is not set or no live desk station has a key: say so and
send them to a manager; do not offer the scan.

`clock_punch(p_venue_id, p_kind 'in'|'out', p_code, p_lat, p_lng, p_accuracy_m, p_fix_at,
p_mocked, p_device_id, p_platform 'ios'|'android')` → `ClockPunchResult`. Refusals are **data**
(`{status:'refused', reason, …}`), never errors; raised errors are only FORBIDDEN and
INVALID_ARGUMENT (bad shapes). Checks in order:

| reason | extra fields | what the person sees (meaning) |
|---|---|---|
| TOO_MANY_TRIES | | 8 refused tries in the last hour. Wait, or ask a manager. |
| NO_PLACE / NO_STATION | | Logging in is not set up at this branch yet. Ask a manager. |
| WRONG_DEVICE | | This is not the phone you log in with. A manager can reset it. |
| LOCATION_STALE | | The location was out of date. Try again. |
| MOCK_LOCATION | | A fake-location app is on. Turn it off. |
| LOCATION_ROUGH | accuracy_m, max_accuracy_m | Location not precise enough (± N m). Move near a window or outside, wait, retry. |
| NOT_HERE | distance_m, radius_m | You are not at the club (about N away). |
| CODE_WRONG | | The code changed or is not this club's desk. Scan again. |
| ALREADY_IN / NOT_IN | | Already started / not started yet (refresh state). |

Accepted: `{status:'accepted', kind, at, work_date, late_minutes, early_minutes}`.

- `p_fix_at` is the fix's own timestamp; the server refuses one older than 2 minutes, so take
  the fix right after the scan (or reuse a watched fix under ~30 s old).
- `p_mocked` is `location.mocked` from expo-location (Android mock provider, iOS
  `isSimulatedBySoftware`). Send it as given.
- `p_device_id`: iOS `Application.getIosIdForVendorAsync()`, Android `Application.getAndroidId()`.
  The server stores only its sha256. The first accepted scan binds the phone.

### Operator: setup (owner and managers at the branch)

- `clock_setup(p_venue_id)` → `{ place: {lat, lng, radius_m, max_accuracy_m, updated_at,
  updated_by_name} | null, stations: [{station_id, is_till, has_key, issued_at,
  issued_by_name}], can_edit_place }`. Never a secret.
- `set_clock_place(p_venue_id, p_lat, p_lng, p_radius_m = 120, p_max_accuracy_m = 60)`:
  **owner only**. Radius 20–2000 m, accuracy 10–500 m. INVALID_ARGUMENT hints `location`,
  `radius_m`, `max_accuracy_m`.
- `issue_station_clock_key(p_station_id)` → `{station_id, secret (40 hex), step_seconds: 30,
  digits: 6, replaced}`. REF_NOT_FOUND hint `station_id` (unknown or retired).

### Operator: set hours and the day board (owner and managers at the branch)

- `staff_shifts_get(p_venue_id, p_staff_id)` → `{staff_id, roles (main job first, then second
  jobs), can_edit, shifts: WeekShift[]}`.
- `set_staff_shifts(p_venue_id, p_staff_id, p_shifts WeekShift[])` replaces the whole week
  (`[]` clears it). At most 42, each ≤ 16 h, no overlap (touching is fine). A manager never
  sets their own (FORBIDDEN hint staff_id); the owner has no hours. INVALID_ARGUMENT hints
  `shifts`, `shift_length`, `role`, `overlap`.
- `clock_day(p_venue_id, p_date = today)` (up to 60 days back) → `{date, today, now, people:
  [{staff_id, display_name, role, shifts, events: [{id, kind, status, refusal, at,
  late_minutes, early_minutes, distance_m, accuracy_m, mocked, station_id}], in_since,
  attendance: {id, late_minutes, early_leave_minutes, penalty_iqd, source} | null,
  device_bound}]}`. Everyone with hours, an attempt or an open log-in that day; never the
  caller.
- `clock_reset_device(p_venue_id, p_staff_id)` → `{status: 'reset', had_device}`. Never their own.
- `attendance_month` days gain `source` (`manual` | `clock`); `recorded_by_name` is null for a
  clock day. `record_attendance` on a clock day turns it manual.

Blockable pages (0384): `clock_day`, `clock_reset_device`, `staff_shifts_get`,
`set_staff_shifts` are on Attendance and admin; `clock_setup`, `set_clock_place`,
`issue_station_clock_key` on admin. The phone's two RPCs are never blocked.

## 4. Status words for the day board (derived on the client)

From `shifts`, `events` (accepted) and `now`, per person:

- **Off today**: no shifts, no accepted events.
- **Not in yet**: a shift has not started, no accepted in.
- **Late, not in**: a shift started and no accepted in since it started.
- **At work** (since T, in role R from the running shift): `in_since` set.
- **Late N min** / **Left early N min**: from the accepted events' minutes.
- **Missed**: a block ended with no accepted in that matched it.
- **No log-out**: an accepted in older than its block's end + 4 h with no out (`in_since` goes
  null after 20 h).
- **Tried from far away / fake location / wrong phone**: refused events, shown with the
  distance or reason, so a manager sees an attempt from home.

## 5. Privacy

- The phone asks for location **only** on the staff clock screen, and only "while using".
  No background location, no geofence, no customer prompt (the nearby-offer idea is a separate,
  later piece and needs its own store review).
- A location fix is read once per scan and stored on that attempt only. Nothing tracks staff
  between scans.
