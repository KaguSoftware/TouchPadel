-- 0205 till_shifts — a till shift below the day: the person at a till (or the
-- court desk) opens their own drawer on a counted float and closes it with a
-- blind count, signed by their own PIN or a manager's, while the business day
-- keeps going; every payment and refund is stamped with the shift open at its
-- station.
--
-- Feature: protocols and the staff phone, wave 5, lane T
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.9, §2.10, §2.12, §7.5;
-- Majed's answer #4, §8 Q26–Q30, with Q28 and Q29 answered 2026-09-25).
-- Depends on: – (committed bodies only: refund 0139:368, close_day 0020:18).
-- Its tests create the two wave-5 roles, so it commits after
-- staff_roles_assistant_waiter (M9).
-- Re-runnable: create table/index if not exists, add column if not exists,
-- guarded constraint adds and validates, drop policy/trigger if exists +
-- create, create or replace, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE MODEL. A shift is one person's drawer at one station inside one open
-- day. Opening counts the float in; if the station's last counted shift of
-- the same day left cash in the drawer, the difference between that count
-- (plus any cash that came in or went out at the station with no shift open,
-- V18) and the new float is the handover difference. "With no shift open" is
-- every cash row at the station stamped null since that shift OPENED, not
-- since it closed: a settle that began before the close and wrote after it
-- is stamped null with a created_at before closed_at (review 2026-09-26), and
-- a null row inside the shift's own window can only be such a straggler, so
-- nothing is counted twice. Closing is a
-- blind count: the figures are summed from the rows that carry the shift's id
-- and stamped once, with the expected cash, the count and the variance tied
-- by CHECKs. Open means closed_at is null; there is no status column. The
-- desk's own cash box is a station like a till's (§2.9.9, Q28). SHIFT is the
-- settle_tab list (0106:410): cashier, court_desk, manager, owner.
--
-- ATTRIBUTION BY STATION, NOT BY PERSON. A trigger stamps payments and
-- refunds with the shift open at their device_id when the row is inserted.
-- Every till money write carries the station (op/lib/mutate.ts passes
-- deviceId() as p_device_id; replay passes the envelope's station), so a
-- queue replayed under a colleague's session still lands in the right drawer.
-- A trigger, not a settle_tab re-issue: settle_tab is untouched and covers the
-- direct, queued and desk paths at once. refund gains only device_id on its
-- insert. The server never refuses, alters or delays money for a missing
-- shift (TI1): no shift means till_shift_id is null, "outside a shift". No
-- backfill, ever: every row before this is outside.
--
-- LOCKS. check-lock-order.mjs ORDER gains till_shifts after payments, before
-- refunds, in the same commit:
--   settle_tab        tabs -> (trigger) till_shifts FOR SHARE
--   refund            day_sessions SHARE -> tabs -> payments -> (trigger) till_shifts SHARE
--   close_day         day_sessions FOR UPDATE -> till_shifts FOR UPDATE
--   close_till_shift* till_shifts FOR UPDATE only
--   open_till_shift   day_sessions SHARE -> (self-heal) till_shifts FOR UPDATE -> insert
-- The script sees FOR UPDATE only, so the trigger's SHARE is documented here
-- and covered by the race test. A close holding the shift FOR UPDATE first
-- makes an in-flight insert wait and then find no open shift (null); an
-- insert holding FOR SHARE first makes the close wait, and its sums see it.
--
-- WHAT DOES NOT CHANGE. close_day's expected, counted and variance math is
-- 0020's byte for byte (TI5): it still counts a refund under its payment's
-- day, while a shift counts it in the drawer it left. The difference is
-- carried explicitly by till_shift_list.cross_day (V10). v_day_close_summary,
-- open_day, record_drawer_open, heartbeat and settle_tab are not re-issued.
--
-- covered by packages/db/tests/till-shifts.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists till_shifts (
  id                      uuid primary key default gen_random_uuid(),
  venue_id                uuid not null references venues(id),
  day_session_id          uuid not null references day_sessions(id),
  station_id              text not null,
  staff_id                uuid not null references staff(id),
  opened_at               timestamptz not null default now(),
  opening_float_iqd       iqd not null,
  open_note               text,
  handover_from_shift_id  uuid references till_shifts(id),
  handover_difference_iqd iqd_signed,
  closed_at               timestamptz,
  closed_by               uuid references staff(id),
  closed_via              text,                           -- 'own_pin' | 'manager_pin' | 'day_close'
  authorized_by           uuid references staff(id),
  cash_payments_iqd       iqd,
  cash_refunds_iqd        iqd,
  cash_expected_iqd       iqd_signed,                     -- signed: a refund of an earlier shift's payment can exceed float + takings
  cash_counted_iqd        iqd,
  cash_variance_iqd       iqd_signed,
  card_payments_iqd       iqd,
  card_refunds_iqd        iqd,
  payment_count           int,
  refund_count            int,
  drawer_open_count       int,
  close_note              text,
  constraint till_shifts_station_venue_fkey foreign key (station_id, venue_id) references stations (id, venue_id),  -- 0132:58 pair key
  constraint till_shifts_closed_chk     check ((closed_at is null) = (closed_via is null) and (closed_at is null) = (closed_by is null)),
  constraint till_shifts_via_chk        check (closed_via is null or closed_via in ('own_pin','manager_pin','day_close')),
  constraint till_shifts_order_chk      check (closed_at is null or closed_at >= opened_at),
  constraint till_shifts_stamped_chk    check (closed_at is null or (cash_expected_iqd is not null and cash_payments_iqd is not null
                                                and cash_refunds_iqd is not null and payment_count is not null)),
  constraint till_shifts_counted_chk    check (closed_via is null or closed_via = 'day_close' or cash_counted_iqd is not null),
  constraint till_shifts_authorizer_chk check (closed_via is distinct from 'manager_pin' or authorized_by is not null),
  constraint till_shifts_expected_chk   check (cash_expected_iqd is null or cash_expected_iqd = opening_float_iqd + cash_payments_iqd - cash_refunds_iqd),
  constraint till_shifts_variance_chk   check ((cash_counted_iqd is null and cash_variance_iqd is null) or cash_variance_iqd = cash_counted_iqd - cash_expected_iqd),
  constraint till_shifts_handover_chk   check ((handover_from_shift_id is null) = (handover_difference_iqd is null)),
  constraint till_shifts_note_len_chk   check (coalesce(length(open_note),0) <= 500 and coalesce(length(close_note),0) <= 500)
);

-- At most one open shift per station and per person (TI8). open_till_shift
-- maps a race on either to its code by the index name.
create unique index if not exists till_shifts_one_open_per_station on till_shifts (station_id) where closed_at is null;
create unique index if not exists till_shifts_one_open_per_staff   on till_shifts (staff_id)   where closed_at is null;
create index if not exists till_shifts_day on till_shifts (day_session_id);

comment on table till_shifts is
  'till_shifts (wave 5 §2.9, Majed #4): one person''s drawer at one station inside one open day. Opened by app.open_till_shift on a counted float (with the handover difference from the station''s last counted shift of the day), closed by app.close_till_shift (own PIN), app.close_till_shift_for (a manager''s PIN grant) or with the day (close_day, and open_till_shift''s self-heal). Payments and refunds are stamped with the shift open at their station (app.stamp_till_shift). Open means closed_at is null. Read by MGMT at the venue; everyone else reads through app.till_shift_status. No client write grant.';
comment on column till_shifts.id is 'Shift id.';
comment on column till_shifts.venue_id is 'The venue: the station''s.';
comment on column till_shifts.day_session_id is 'The business day the shift belongs to (open when the shift opened).';
comment on column till_shifts.station_id is 'The till or desk station whose drawer this is (with venue_id, a stations pair key).';
comment on column till_shifts.staff_id is 'Whose shift it is: the person who opened it.';
comment on column till_shifts.opened_at is 'When the shift opened.';
comment on column till_shifts.opening_float_iqd is 'The cash counted into the drawer at the open, IQD.';
comment on column till_shifts.open_note is 'An optional note typed at the open (at most 500 characters). Never readable by the owner assistant.';
comment on column till_shifts.handover_from_shift_id is 'The station''s last counted shift of the same day, when there was one; null on a day''s first shift at the station.';
comment on column till_shifts.handover_difference_iqd is 'opening_float_iqd minus (that shift''s count plus the cash taken in or paid out at the station with no shift open since, V18), IQD, signed. Null without a handover.';
comment on column till_shifts.closed_at is 'When the shift closed; null while it is open.';
comment on column till_shifts.closed_by is 'Who closed it: the person at the till, or the manager whose close_day or open ended it.';
comment on column till_shifts.closed_via is 'own_pin (the holder''s own PIN), manager_pin (a manager''s PIN grant) or day_close (ended with its day, uncounted).';
comment on column till_shifts.authorized_by is 'Who signed the count: the holder for own_pin, the manager for manager_pin; null for day_close.';
comment on column till_shifts.cash_payments_iqd is 'Stamped at the close: cash payments carrying this shift, IQD.';
comment on column till_shifts.cash_refunds_iqd is 'Stamped at the close: refunds carrying this shift whose payment was cash, IQD.';
comment on column till_shifts.cash_expected_iqd is 'Stamped at the close: opening float + cash payments - cash refunds, IQD, signed.';
comment on column till_shifts.cash_counted_iqd is 'The blind count at the close, IQD; null when the shift ended with its day.';
comment on column till_shifts.cash_variance_iqd is 'cash_counted_iqd - cash_expected_iqd, IQD, signed; null when uncounted.';
comment on column till_shifts.card_payments_iqd is 'Stamped at the close: card payments carrying this shift, IQD.';
comment on column till_shifts.card_refunds_iqd is 'Stamped at the close: refunds carrying this shift whose payment was card, IQD.';
comment on column till_shifts.payment_count is 'Stamped at the close: payments carrying this shift.';
comment on column till_shifts.refund_count is 'Stamped at the close: refunds carrying this shift.';
comment on column till_shifts.drawer_open_count is 'Stamped at the close: drawer.open audit rows from the station inside the shift. Shown only, never in the math.';
comment on column till_shifts.close_note is 'An optional note typed at the close (at most 500 characters). Never readable by the owner assistant.';

alter table till_shifts enable row level security;

drop policy if exists till_shifts_mgmt_read on till_shifts;
create policy till_shifts_mgmt_read on till_shifts
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on till_shifts to authenticated;
grant all on till_shifts to service_role;

-- ---------------------------------------------------------------------------
-- 2. The stamp columns on payments and refunds. Metadata only: no default,
--    so nothing is rewritten, and every existing row stays null ("outside a
--    shift"). refunds gains the device the payments row already had.
-- ---------------------------------------------------------------------------
alter table payments add column if not exists till_shift_id uuid;
alter table refunds  add column if not exists device_id text;
alter table refunds  add column if not exists till_shift_id uuid;

comment on column payments.till_shift_id is
  'The till shift open at device_id when the payment was recorded (app.stamp_till_shift); null outside a shift. Never supplied by a client.';
comment on column refunds.device_id is
  'The station the refund was made at (app.refund''s p_device_id), as payments.device_id.';
comment on column refunds.till_shift_id is
  'The till shift open at device_id, on an open day, when the refund was made (app.stamp_till_shift); null outside a shift. Never supplied by a client.';

do $till_shift_fkeys_0205$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'payments_till_shift_fkey' and conrelid = 'payments'::regclass) then
    alter table payments
      add constraint payments_till_shift_fkey foreign key (till_shift_id) references till_shifts(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'refunds_till_shift_fkey' and conrelid = 'refunds'::regclass) then
    alter table refunds
      add constraint refunds_till_shift_fkey foreign key (till_shift_id) references till_shifts(id) not valid;
  end if;
end $till_shift_fkeys_0205$;

do $till_shift_fkeys_validate_0205$
begin
  if exists (select 1 from pg_constraint
              where conname = 'payments_till_shift_fkey' and conrelid = 'payments'::regclass
                and not convalidated) then
    alter table payments validate constraint payments_till_shift_fkey;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'refunds_till_shift_fkey' and conrelid = 'refunds'::regclass
                and not convalidated) then
    alter table refunds validate constraint refunds_till_shift_fkey;
  end if;
end $till_shift_fkeys_validate_0205$;

-- ---------------------------------------------------------------------------
-- 3. app.stamp_till_shift — BEFORE INSERT only (TI4: payments and refunds
--    stay append-only; the stamp is set once, as the row is written).
-- ---------------------------------------------------------------------------
create or replace function app.stamp_till_shift() returns trigger
language plpgsql security definer set search_path = public as $stamp_till_shift_0205$
begin
  new.till_shift_id := null;                       -- never trust a supplied value
  if new.device_id is null then
    return new;
  end if;
  -- One SELECT per table. PL/pgSQL resolves every NEW field a statement names when it
  -- prepares the statement, so a shared SELECT naming new.day_session_id raises
  -- 'record "new" has no field "day_session_id"' on refunds, whatever an OR around it says.
  if tg_table_name = 'payments' then
    select s.id into new.till_shift_id
      from till_shifts s
     where s.station_id     = new.device_id
       and s.venue_id       = new.venue_id          -- the column default is applied before BEFORE triggers
       and s.day_session_id = new.day_session_id
       and s.closed_at is null
     for share;                                    -- vs the close's FOR UPDATE (the 0038:47-52 pattern)
  else                                             -- refunds: no day column (0015:137-144)
    select s.id into new.till_shift_id
      from till_shifts s
      join day_sessions d on d.id = s.day_session_id and d.status = 'open'
     where s.station_id = new.device_id
       and s.venue_id   = new.venue_id
       and s.closed_at is null
     for share of s;                               -- refund already holds the open day FOR SHARE (0139:420)
  end if;
  return new;
end $stamp_till_shift_0205$;

comment on function app.stamp_till_shift() is
  'till_shifts (§2.9.3, V1). BEFORE INSERT on payments and refunds: sets till_shift_id to the shift open at new.device_id at the row''s venue (a payment: in its own day; a refund: in an open day), FOR SHARE against the close''s FOR UPDATE, else null. Overwrites any supplied value. Never raises on a missing shift. Internal: no client role may execute it.';

revoke all on function app.stamp_till_shift() from public, anon, authenticated;

drop trigger if exists payments_till_shift_stamp on payments;
create trigger payments_till_shift_stamp
  before insert on payments
  for each row execute function app.stamp_till_shift();
comment on trigger payments_till_shift_stamp on payments is
  'till_shifts: stamps till_shift_id with the shift open at device_id (app.stamp_till_shift). Insert only.';

drop trigger if exists refunds_till_shift_stamp on refunds;
create trigger refunds_till_shift_stamp
  before insert on refunds
  for each row execute function app.stamp_till_shift();
comment on trigger refunds_till_shift_stamp on refunds is
  'till_shifts: stamps till_shift_id with the shift open at device_id on an open day (app.stamp_till_shift). Insert only.';

-- ---------------------------------------------------------------------------
-- 4. app.till_shift_station — the station a shift RPC acts on. The read form
--    checks the id and the venue; the write form also needs the caller to be
--    the session beating from that station (app.heartbeat stamps staff_id,
--    0156:362), which no phone does, so no phone opens or closes a drawer.
-- ---------------------------------------------------------------------------
create or replace function app.till_shift_station(p_device_id text, p_write boolean)
returns stations
language plpgsql stable security definer set search_path = public as $till_shift_station_0205$
declare
  v_station stations%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001',
      hint = 'capitals, digits and dashes, starting with a letter';
  end if;
  -- Retired, unregistered or at another venue: one answer, no oracle.
  select * into v_station
    from stations s
   where s.id = p_device_id
     and s.retired_at is null
     and s.venue_id = any(app.staff_venue_ids());
  if not found then
    raise exception 'STATION_UNKNOWN' using errcode = 'P0001';
  end if;
  if p_write and not exists (select 1 from device_heartbeats h
                              where h.device_id = p_device_id
                                and h.staff_id = auth.uid()
                                and h.last_seen_at > now() - interval '60 seconds') then
    raise exception 'TILL_SHIFT_WRONG_STATION' using errcode = 'P0001',
      hint = 'start and end a till shift at the till itself, signed in there';
  end if;
  return v_station;
end $till_shift_station_0205$;

comment on function app.till_shift_station(text, boolean) is
  'till_shifts (§2.9.4). Internal: the live station p_device_id at one of the caller''s venues, else INVALID_STATION (the id shape) or STATION_UNKNOWN (retired, unregistered or elsewhere). With p_write, the caller must also be the session that beat from it in the last 60 seconds, else TILL_SHIFT_WRONG_STATION.';

revoke all on function app.till_shift_station(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.till_shift_figures — the one place a shift's money is summed.
-- ---------------------------------------------------------------------------
create or replace function app.till_shift_figures(p_shift_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $till_shift_figures_0205$
declare
  v_shift     till_shifts%rowtype;
  v_cash_in   bigint;
  v_card_in   bigint;
  v_pay_n     int;
  v_cash_out  bigint;
  v_card_out  bigint;
  v_ref_n     int;
  v_drawer    int;
begin
  select * into v_shift from till_shifts where id = p_shift_id;
  if not found then
    return null;
  end if;

  select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0),
         count(*)
    into v_cash_in, v_card_in, v_pay_n
    from payments p
   where p.till_shift_id = p_shift_id;

  -- A refund counts under its payment's method (the 0020:70-77 rule).
  select coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0),
         coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0),
         count(*)
    into v_cash_out, v_card_out, v_ref_n
    from refunds r
    join payments p on p.id = r.payment_id
   where r.till_shift_id = p_shift_id;

  -- Shown only, never in the math: drawer.open rows from the station inside
  -- the shift (record_drawer_open, 0106:787).
  select count(*) into v_drawer
    from audit_log a
   where a.action = 'drawer.open'
     and a.device_id = v_shift.station_id
     and a.at >= v_shift.opened_at
     and a.at <= coalesce(v_shift.closed_at, now());

  return jsonb_build_object(
    'cash_payments_iqd', v_cash_in,
    'cash_refunds_iqd',  v_cash_out,
    'card_payments_iqd', v_card_in,
    'card_refunds_iqd',  v_card_out,
    'payment_count',     v_pay_n,
    'refund_count',      v_ref_n,
    'drawer_open_count', v_drawer,
    'cash_expected_iqd', v_shift.opening_float_iqd + v_cash_in - v_cash_out);
end $till_shift_figures_0205$;

comment on function app.till_shift_figures(uuid) is
  'till_shifts (§2.9.4). Internal: {cash_payments_iqd, cash_refunds_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, cash_expected_iqd} over the payments and refunds carrying the shift (a refund under its payment''s method), expected = float + cash payments - cash refunds; drawer opens counted from audit_log, shown only. Null for an unknown shift.';

revoke all on function app.till_shift_figures(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.close_till_shift_internal — stamps the figures, the count and the
--    variance once (the WHERE refuses a closed row), and audits the close with
--    the row minus the notes. Its callers hold the shift FOR UPDATE; it takes
--    the lock again first itself, so its sums never miss a payment a caller
--    that did not lock would let in between the sums and the UPDATE.
-- ---------------------------------------------------------------------------
create or replace function app.close_till_shift_internal(
  p_shift     till_shifts,
  p_counted   bigint,
  p_note      text,
  p_via       text,
  p_auth      uuid,
  p_device_id text
) returns jsonb
language plpgsql security definer set search_path = public as $close_till_shift_internal_0205$
declare
  v_fig      jsonb;
  v_expected bigint;
  v_row      till_shifts%rowtype;
begin
  -- In its own statement, so the sums below read after any payment that held
  -- the shift FOR SHARE (the stamp) has committed.
  perform 1 from till_shifts where id = p_shift.id for update;
  v_fig := app.till_shift_figures(p_shift.id);
  v_expected := (v_fig->>'cash_expected_iqd')::bigint;

  update till_shifts
     set closed_at         = now(),
         closed_by         = auth.uid(),
         closed_via        = p_via,
         authorized_by     = case p_via when 'own_pin' then auth.uid()
                                        when 'manager_pin' then p_auth end,
         cash_payments_iqd = (v_fig->>'cash_payments_iqd')::bigint,
         cash_refunds_iqd  = (v_fig->>'cash_refunds_iqd')::bigint,
         cash_expected_iqd = v_expected,
         cash_counted_iqd  = p_counted,
         cash_variance_iqd = p_counted - v_expected,
         card_payments_iqd = (v_fig->>'card_payments_iqd')::bigint,
         card_refunds_iqd  = (v_fig->>'card_refunds_iqd')::bigint,
         payment_count     = (v_fig->>'payment_count')::int,
         refund_count      = (v_fig->>'refund_count')::int,
         drawer_open_count = (v_fig->>'drawer_open_count')::int,
         close_note        = p_note
   where id = p_shift.id
     and closed_at is null
  returning * into v_row;
  if not found then
    raise exception 'TILL_SHIFT_CLOSED' using errcode = 'P0001';
  end if;

  perform app.write_audit(case p_via when 'day_close' then 'drawer.shift_close_by_day'
                                     else 'drawer.shift_close' end,
                          'till_shifts', v_row.id::text, null,
                          to_jsonb(v_row) - 'open_note' - 'close_note',
                          null, p_auth, p_device_id);

  return jsonb_build_object(
    'ok',                 true,
    'till_shift_id',      v_row.id,
    'station_id',         v_row.station_id,
    'staff_id',           v_row.staff_id,
    'staff_name',         (select display_name from staff where id = v_row.staff_id),
    'opened_at',          v_row.opened_at,
    'closed_at',          v_row.closed_at,
    'closed_via',         v_row.closed_via,
    'authorized_by_name', (select display_name from staff where id = v_row.authorized_by),
    'opening_float_iqd',  v_row.opening_float_iqd,
    'cash_payments_iqd',  v_row.cash_payments_iqd,
    'cash_refunds_iqd',   v_row.cash_refunds_iqd,
    'cash_expected_iqd',  v_row.cash_expected_iqd,
    'cash_counted_iqd',   v_row.cash_counted_iqd,
    'cash_variance_iqd',  v_row.cash_variance_iqd,
    'card_payments_iqd',  v_row.card_payments_iqd,
    'card_refunds_iqd',   v_row.card_refunds_iqd,
    'payment_count',      v_row.payment_count,
    'refund_count',       v_row.refund_count,
    'drawer_open_count',  v_row.drawer_open_count,
    -- The drawer passes whole (§8 Q26): what was counted stays for the next.
    'left_in_drawer_iqd', v_row.cash_counted_iqd);
end $close_till_shift_internal_0205$;

comment on function app.close_till_shift_internal(till_shifts, bigint, text, text, uuid, text) is
  'till_shifts (§2.9.4). Internal: closes one open shift, locking it FOR UPDATE itself before it sums (its callers already hold it). Stamps the figures (app.till_shift_figures), the count and the variance (both null for day_close), closed_by = the caller and authorized_by (the caller for own_pin, p_auth for manager_pin), and audits drawer.shift_close or drawer.shift_close_by_day with the row minus the notes. Returns the close result. TILL_SHIFT_CLOSED when the row is no longer open.';

revoke all on function app.close_till_shift_internal(till_shifts, bigint, text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.open_till_shift — SHIFT, at the station it is beating from.
-- ---------------------------------------------------------------------------
create or replace function app.open_till_shift(
  p_opening_float_iqd bigint,
  p_device_id         text,
  p_note              text default null,
  p_idempotency_key   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $open_till_shift_0205$
declare
  v_station  stations%rowtype;
  v_venue    uuid;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_replay   jsonb;
  v_day      day_sessions%rowtype;
  v_stale    till_shifts%rowtype;
  v_mine     till_shifts%rowtype;
  v_prev     till_shifts%rowtype;
  v_outside  bigint;
  v_diff     bigint;
  v_row      till_shifts%rowtype;
  v_con      text;
  v_result   jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_station := app.till_shift_station(p_device_id, true);
  v_venue := v_station.venue_id;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_opening_float_iqd is null or p_opening_float_iqd < 0 then
    raise exception 'INVALID_FLOAT' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'open_till_shift');
  if v_replay is not null then
    return v_replay;
  end if;

  -- The open day, FOR SHARE against close_day's FOR UPDATE (0038).
  select * into v_day
    from day_sessions
   where status = 'open' and venue_id = v_venue
   order by opened_at desc
   limit 1
   for share;
  if not found then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- Self-heal (PROPOSAL): a shift left open on this station, or by this
  -- person, on a day closed outside close_day (V9) ends with its day now.
  for v_stale in
    select s.*
      from till_shifts s
      join day_sessions d on d.id = s.day_session_id and d.status = 'closed'
     where s.closed_at is null
       and (s.station_id = v_station.id or s.staff_id = auth.uid())
     order by s.opened_at
     for update of s
  loop
    perform app.close_till_shift_internal(v_stale, null, null, 'day_close', null, p_device_id);
  end loop;

  -- V13: a sale queued while no shift was open is inserted at replay, and the
  -- stamp would put it in this shift, whose counted float already holds its
  -- cash. Let the queue drain first, as close_day's DAY_UNSYNCED (0020:57-64).
  if exists (select 1 from device_heartbeats h
              where h.device_id = v_station.id
                and h.queue_depth > 0
                and h.last_seen_at >= v_day.opened_at) then
    raise exception 'TILL_SHIFT_UNSYNCED' using errcode = 'P0001',
      hint = 'this till still has queued sales; open the shift once they are sent';
  end if;

  select * into v_mine from till_shifts where staff_id = auth.uid() and closed_at is null;
  if found then
    raise exception 'TILL_SHIFT_ALREADY_OPEN' using errcode = 'P0001', detail = v_mine.station_id;
  end if;
  if exists (select 1 from till_shifts where station_id = v_station.id and closed_at is null) then
    raise exception 'TILL_SHIFT_STATION_BUSY' using errcode = 'P0001';
  end if;

  -- Handover (V18): the station's last counted shift of this day, plus the
  -- cash that came in or went out at the station with no shift open (a
  -- no-shift sale, a manager's cash refund at the till), counted from that
  -- shift's opening so a sale that began before its close and landed after
  -- it is in. A new day never hands over.
  select * into v_prev
    from till_shifts
   where station_id = v_station.id
     and day_session_id = v_day.id
     and closed_at is not null
     and cash_counted_iqd is not null
   order by closed_at desc
   limit 1;
  if found then
    select coalesce(sum(p.amount_iqd), 0)
           - coalesce((select sum(r.amount_iqd)
                         from refunds r
                         join payments rp on rp.id = r.payment_id
                        where r.till_shift_id is null
                          and r.device_id = v_station.id
                          and r.venue_id = v_venue
                          and rp.method = 'cash'
                          and r.created_at > v_prev.opened_at), 0)
      into v_outside
      from payments p
     where p.till_shift_id is null
       and p.device_id = v_station.id
       and p.venue_id = v_venue
       and p.method = 'cash'
       and p.created_at > v_prev.opened_at;
    v_diff := p_opening_float_iqd - (v_prev.cash_counted_iqd + v_outside);
  end if;

  begin
    insert into till_shifts (venue_id, day_session_id, station_id, staff_id, opening_float_iqd,
                             open_note, handover_from_shift_id, handover_difference_iqd)
    values (v_venue, v_day.id, v_station.id, auth.uid(), p_opening_float_iqd,
            v_note, v_prev.id, v_diff)
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent open got there first; the same two answers as above.
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'till_shifts_one_open_per_staff' then
      raise exception 'TILL_SHIFT_ALREADY_OPEN' using errcode = 'P0001',
        detail = coalesce((select station_id from till_shifts
                            where staff_id = auth.uid() and closed_at is null), '');
    elsif v_con = 'till_shifts_one_open_per_station' then
      raise exception 'TILL_SHIFT_STATION_BUSY' using errcode = 'P0001';
    end if;
    raise;
  end;

  perform app.write_audit('drawer.shift_open', 'till_shifts', v_row.id::text, null,
                          to_jsonb(v_row) - 'open_note' - 'close_note',
                          null, null, p_device_id);

  v_result := jsonb_build_object(
    'duplicate', false,
    'till_shift', jsonb_build_object(
      'id',                v_row.id,
      'station_id',        v_row.station_id,
      'staff_id',          v_row.staff_id,
      'staff_name',        (select display_name from staff where id = v_row.staff_id),
      'opened_at',         v_row.opened_at,
      'opening_float_iqd', v_row.opening_float_iqd,
      'handover_from',     case when v_prev.id is null then null else jsonb_build_object(
                             'till_shift_id',          v_prev.id,
                             'staff_name',             (select display_name from staff where id = v_prev.staff_id),
                             'closed_at',              v_prev.closed_at,
                             'left_in_drawer_iqd',     v_prev.cash_counted_iqd,
                             'outside_cash_since_iqd', v_outside) end,
      'handover_difference_iqd', v_row.handover_difference_iqd));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $open_till_shift_0205$;

comment on function app.open_till_shift(bigint, text, text, text) is
  'till_shifts (§2.9.4). Cashier, court desk, manager, owner, beating from the station: opens the caller''s shift there on a counted float, inside the open day, and returns {duplicate, till_shift:{id, station_id, staff_id, staff_name, opened_at, opening_float_iqd, handover_from:{till_shift_id, staff_name, closed_at, left_in_drawer_iqd, outside_cash_since_iqd}|null, handover_difference_iqd}}. First ends any shift left open on the station or by the caller on a closed day (day_close). Idempotent by key. FORBIDDEN, INVALID_STATION, STATION_UNKNOWN, TILL_SHIFT_WRONG_STATION, INVALID_FLOAT, TEXT_TOO_LONG (hint note), IDEMPOTENCY_CONFLICT, NO_OPEN_DAY, TILL_SHIFT_UNSYNCED, TILL_SHIFT_ALREADY_OPEN (detail = its station), TILL_SHIFT_STATION_BUSY. Audit drawer.shift_open. Online-only.';

revoke all on function app.open_till_shift(bigint, text, text, text) from public, anon;
grant execute on function app.open_till_shift(bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.close_till_shift — my own shift, my own PIN, at its station.
-- ---------------------------------------------------------------------------
create or replace function app.close_till_shift(
  p_till_shift_id   uuid,
  p_counted_iqd     bigint,
  p_pin             text,
  p_device_id       text,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_till_shift_0205$
declare
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_replay jsonb;
  v_shift  till_shifts%rowtype;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_counted_iqd is null or p_counted_iqd < 0 or p_counted_iqd > 999999999999 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  -- The PIN before the claim (0011; start_break 0156:95). Raises PIN_LOCKED /
  -- NO_PIN_SET itself; a wrong PIN comes back false and is RETURNED, so the
  -- attempt row it wrote commits.
  if not app.verify_own_pin(p_pin, p_device_id) then
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'close_till_shift');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_shift from till_shifts where id = p_till_shift_id for update;
  if not found or not (v_shift.venue_id = any(app.staff_venue_ids())) then
    raise exception 'TILL_SHIFT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_shift.venue_id::text, true);
  if v_shift.closed_at is not null then
    raise exception 'TILL_SHIFT_CLOSED' using errcode = 'P0001';
  end if;
  if v_shift.staff_id <> auth.uid() then
    raise exception 'TILL_SHIFT_NOT_YOURS' using errcode = 'P0001';
  end if;
  if p_device_id is distinct from v_shift.station_id then
    raise exception 'TILL_SHIFT_WRONG_STATION' using errcode = 'P0001',
      hint = 'start and end a till shift at the till itself, signed in there';
  end if;
  perform app.till_shift_station(v_shift.station_id, true);
  -- The DAY_UNSYNCED mirror (0020:57-64): queued writes reported since the
  -- shift opened would land after the count.
  if exists (select 1 from device_heartbeats h
              where h.device_id = v_shift.station_id
                and h.queue_depth > 0
                and h.last_seen_at >= v_shift.opened_at) then
    raise exception 'TILL_SHIFT_UNSYNCED' using errcode = 'P0001',
      hint = 'this till still has queued sales; count once they are sent';
  end if;

  v_result := app.close_till_shift_internal(v_shift, p_counted_iqd, v_note, 'own_pin', null, p_device_id)
              || jsonb_build_object('duplicate', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $close_till_shift_0205$;

comment on function app.close_till_shift(uuid, bigint, text, text, text, text) is
  'till_shifts (§2.9.4). The shift''s holder, with their own PIN, beating from its station: a blind count closes it. Returns {ok:true, duplicate, till_shift_id, station_id, staff_id, staff_name, opened_at, closed_at, closed_via, authorized_by_name, opening_float_iqd, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, left_in_drawer_iqd}, or {ok:false, code:PIN_INVALID} for a wrong PIN (returned, so the attempt counts). Idempotent by key. FORBIDDEN, INVALID_COUNT, TEXT_TOO_LONG (hint note), NO_PIN_SET, PIN_LOCKED, IDEMPOTENCY_CONFLICT, TILL_SHIFT_NOT_FOUND, TILL_SHIFT_CLOSED, TILL_SHIFT_NOT_YOURS, TILL_SHIFT_WRONG_STATION, STATION_UNKNOWN, TILL_SHIFT_UNSYNCED. Audit drawer.shift_close. Online-only.';

revoke all on function app.close_till_shift(uuid, bigint, text, text, text, text) from public, anon;
grant execute on function app.close_till_shift(uuid, bigint, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.close_till_shift_for — anyone's shift (or my own without a PIN),
--    signed by the manager-PIN grant the screen minted a moment ago through
--    app.verify_manager_pin (the 0115 pattern). No p_pin, so it is not in
--    PIN_GATED_RPCS and the mutation lists do not change.
-- ---------------------------------------------------------------------------
create or replace function app.close_till_shift_for(
  p_till_shift_id   uuid,
  p_counted_iqd     bigint,
  p_device_id       text,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_till_shift_for_0205$
declare
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_replay jsonb;
  v_shift  till_shifts%rowtype;
  v_auth   uuid;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_counted_iqd is null or p_counted_iqd < 0 or p_counted_iqd > 999999999999 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  -- A replay echoes the stored result and spends the grant the screen minted
  -- for this press, best effort (refund, 0139:407-413).
  v_replay := app.claim_replay(p_idempotency_key, 'close_till_shift_for');
  if v_replay is not null then
    begin
      perform app.consume_pin_grant(p_device_id);
    exception when others then
      null;
    end;
    return v_replay;
  end if;

  select * into v_shift from till_shifts where id = p_till_shift_id for update;
  if not found or not (v_shift.venue_id = any(app.staff_venue_ids())) then
    raise exception 'TILL_SHIFT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_shift.venue_id::text, true);
  if v_shift.closed_at is not null then
    raise exception 'TILL_SHIFT_CLOSED' using errcode = 'P0001';
  end if;
  if p_device_id is distinct from v_shift.station_id then
    raise exception 'TILL_SHIFT_WRONG_STATION' using errcode = 'P0001',
      hint = 'start and end a till shift at the till itself, signed in there';
  end if;
  perform app.till_shift_station(v_shift.station_id, true);
  if exists (select 1 from device_heartbeats h
              where h.device_id = v_shift.station_id
                and h.queue_depth > 0
                and h.last_seen_at >= v_shift.opened_at) then
    raise exception 'TILL_SHIFT_UNSYNCED' using errcode = 'P0001',
      hint = 'this till still has queued sales; count once they are sent';
  end if;

  -- PIN_GRANT_REQUIRED rolls the claim back with it, so a retry with the same
  -- key works once the manager has entered the PIN.
  v_auth := app.consume_pin_grant(p_device_id);

  v_result := app.close_till_shift_internal(v_shift, p_counted_iqd, v_note, 'manager_pin', v_auth, p_device_id)
              || jsonb_build_object('duplicate', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $close_till_shift_for_0205$;

comment on function app.close_till_shift_for(uuid, bigint, text, text, text) is
  'till_shifts (§2.9.4). Cashier, court desk, manager, owner, beating from the shift''s station, holding a manager-PIN grant (app.verify_manager_pin first): a blind count closes anyone''s shift, a no-PIN holder''s own included; authorized_by = the manager. Returns what app.close_till_shift returns. Idempotent by key (a replay spends the grant). FORBIDDEN, INVALID_COUNT, TEXT_TOO_LONG (hint note), IDEMPOTENCY_CONFLICT, TILL_SHIFT_NOT_FOUND, TILL_SHIFT_CLOSED, TILL_SHIFT_WRONG_STATION, STATION_UNKNOWN, TILL_SHIFT_UNSYNCED, PIN_GRANT_REQUIRED. Audit drawer.shift_close with the authorizer. Online-only.';

revoke all on function app.close_till_shift_for(uuid, bigint, text, text, text) from public, anon;
grant execute on function app.close_till_shift_for(uuid, bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.till_shift_status — what the station's shift control shows. Blind
--     count (PROPOSAL, §8 Q29): the running expected cash is MGMT's only; for
--     a cashier or the desk the key is absent. A screen rule, not a wall:
--     payments_staff_read stays (§7.6).
-- ---------------------------------------------------------------------------
create or replace function app.till_shift_status(p_device_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $till_shift_status_0205$
declare
  v_station stations%rowtype;
  v_mgmt    boolean := app.is_staff('manager','owner');
  v_day     day_sessions%rowtype;
  v_shift   till_shifts%rowtype;
  v_last    till_shifts%rowtype;
  v_mine    till_shifts%rowtype;
  v_fig     jsonb;
  v_outside bigint;
  v_depth   int;
  v_shift_j jsonb;
  v_last_j  jsonb;
  v_mine_j  jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_station := app.till_shift_station(p_device_id, false);

  select * into v_day
    from day_sessions
   where status = 'open' and venue_id = v_station.venue_id
   order by opened_at desc
   limit 1;

  select * into v_shift from till_shifts where station_id = v_station.id and closed_at is null;
  if found then
    v_fig := app.till_shift_figures(v_shift.id);
    v_shift_j := jsonb_build_object(
      'id',                v_shift.id,
      'staff_id',          v_shift.staff_id,
      'staff_name',        (select display_name from staff where id = v_shift.staff_id),
      'is_mine',           v_shift.staff_id = auth.uid(),
      'opened_at',         v_shift.opened_at,
      'opening_float_iqd', v_shift.opening_float_iqd,
      'payment_count',     v_fig->'payment_count',
      'refund_count',      v_fig->'refund_count',
      'drawer_open_count', v_fig->'drawer_open_count');
    if v_mgmt then
      v_shift_j := v_shift_j || jsonb_build_object('cash_expected_iqd', v_fig->'cash_expected_iqd');
    end if;
  end if;

  -- The start panel prefills left_in_drawer_iqd + outside_cash_since_iqd (V18),
  -- the null-stamped cash since that shift opened, as open_till_shift counts it.
  if v_day.id is not null then
    select * into v_last
      from till_shifts
     where station_id = v_station.id
       and day_session_id = v_day.id
       and closed_at is not null
       and cash_counted_iqd is not null
     order by closed_at desc
     limit 1;
    if found then
      select coalesce(sum(p.amount_iqd), 0)
             - coalesce((select sum(r.amount_iqd)
                           from refunds r
                           join payments rp on rp.id = r.payment_id
                          where r.till_shift_id is null
                            and r.device_id = v_station.id
                            and r.venue_id = v_station.venue_id
                            and rp.method = 'cash'
                            and r.created_at > v_last.opened_at), 0)
        into v_outside
        from payments p
       where p.till_shift_id is null
         and p.device_id = v_station.id
         and p.venue_id = v_station.venue_id
         and p.method = 'cash'
         and p.created_at > v_last.opened_at;
      v_last_j := jsonb_build_object(
        'id',                     v_last.id,
        'staff_name',             (select display_name from staff where id = v_last.staff_id),
        'closed_at',              v_last.closed_at,
        'left_in_drawer_iqd',     v_last.cash_counted_iqd,
        'outside_cash_since_iqd', v_outside);
    end if;
  end if;

  select * into v_mine
    from till_shifts
   where staff_id = auth.uid() and closed_at is null and station_id <> v_station.id;
  if found then
    v_mine_j := jsonb_build_object('id', v_mine.id, 'station_id', v_mine.station_id,
                                   'opened_at', v_mine.opened_at);
  end if;

  select h.queue_depth into v_depth from device_heartbeats h where h.device_id = v_station.id;

  return jsonb_build_object(
    'station_id',     v_station.id,
    'day',            case when v_day.id is null then null else jsonb_build_object(
                        'id', v_day.id, 'business_date', v_day.business_date,
                        'opening_float_iqd', v_day.opening_float_iqd) end,
    'shift',          v_shift_j,
    'last_closed',    v_last_j,
    'mine_elsewhere', v_mine_j,
    'queue_depth',    coalesce(v_depth, 0));
end $till_shift_status_0205$;

comment on function app.till_shift_status(text) is
  'till_shifts (§2.9.4). Cashier, court desk, manager, owner: {station_id, day:{id, business_date, opening_float_iqd}|null, shift:{id, staff_id, staff_name, is_mine, opened_at, opening_float_iqd, payment_count, refund_count, drawer_open_count, cash_expected_iqd (MGMT only; absent otherwise)}|null, last_closed:{id, staff_name, closed_at, left_in_drawer_iqd, outside_cash_since_iqd}|null, mine_elsewhere:{id, station_id, opened_at}|null, queue_depth} for the station. No heartbeat needed. FORBIDDEN, INVALID_STATION, STATION_UNKNOWN.';

revoke all on function app.till_shift_status(text) from public, anon;
grant execute on function app.till_shift_status(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. app.till_shift_list — MGMT: the shifts, the money outside any shift,
--     and the cross-day refund terms (V10) for a range of business days.
--     A payment belongs to its day; a refund belongs to the day it was MADE:
--     its shift's day, or for an outside refund the day whose
--     [opened_at, closed_at) window holds its created_at. close_day and
--     v_day_close_summary count a refund under its PAYMENT's day, so
--     cross_day carries the difference: earlier_days_* are refunds made on
--     the day for earlier days' payments, later_* are refunds of the day's
--     payments made on a later day. For a day D (TI6):
--       Σ shifts + Σ outside payments = the summary's cash and card payments;
--       Σ shifts + Σ outside refunds  = the summary's refunds_iqd
--                                       + earlier_days - later.
--     An open shift shows its running figures.
-- ---------------------------------------------------------------------------
create or replace function app.till_shift_list(
  p_from       date default null,
  p_to         date default null,
  p_station_id text default null,
  p_staff_id   uuid default null,
  p_venue_id   uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $till_shift_list_0205$
declare
  v_venue   uuid;
  v_from    date;
  v_to      date;
  v_shifts  jsonb;
  v_outside jsonb;
  v_cross   jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_from is null and p_to is null then
    -- The open day, else the latest.
    select d.business_date into v_from
      from day_sessions d
     where d.venue_id = v_venue
     order by (d.status = 'open') desc, d.opened_at desc
     limit 1;
    v_to := v_from;
  else
    v_from := coalesce(p_from, p_to);
    v_to := coalesce(p_to, p_from);
    if v_from > v_to or v_to - v_from + 1 > 62 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'range';
    end if;
  end if;

  with days as (
    select d.id, d.business_date, d.opened_at, d.closed_at
      from day_sessions d
     where d.venue_id = v_venue
       and d.business_date between v_from and v_to
  ),
  -- Every refund that can touch these days, with the day it was made on.
  made as (
    select r.id, r.amount_iqd, r.device_id, r.till_shift_id, p.method,
           p.day_session_id as paid_day,
           coalesce(s.day_session_id,
                    (select d2.id
                       from day_sessions d2
                      where d2.venue_id = r.venue_id
                        and d2.opened_at <= r.created_at
                        and (d2.closed_at is null or r.created_at < d2.closed_at)
                      order by d2.opened_at desc
                      limit 1)) as made_day
      from refunds r
      join payments p on p.id = r.payment_id
      left join till_shifts s on s.id = r.till_shift_id
     where r.venue_id = v_venue
       and (p.day_session_id in (select id from days)
            or r.created_at >= (select min(opened_at) from days))
  ),
  shift_rows as (
    select s.*, dd.business_date,
           case when s.closed_at is null then app.till_shift_figures(s.id) end as live
      from till_shifts s
      join days dd on dd.id = s.day_session_id
     where (p_station_id is null or s.station_id = p_station_id)
       and (p_staff_id is null or s.staff_id = p_staff_id)
  ),
  shifts_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',                      s.id,
             'day_session_id',          s.day_session_id,
             'business_date',           s.business_date,
             'station_id',              s.station_id,
             'staff_id',                s.staff_id,
             'staff_name',              st.display_name,
             'opened_at',               s.opened_at,
             'closed_at',               s.closed_at,
             'closed_via',              s.closed_via,
             'closed_by_name',          cb.display_name,
             'authorized_by_name',      au.display_name,
             'opening_float_iqd',       s.opening_float_iqd,
             'handover_difference_iqd', s.handover_difference_iqd,
             'cash_payments_iqd',       coalesce(s.cash_payments_iqd, (s.live->>'cash_payments_iqd')::bigint),
             'cash_refunds_iqd',        coalesce(s.cash_refunds_iqd,  (s.live->>'cash_refunds_iqd')::bigint),
             'cash_expected_iqd',       coalesce(s.cash_expected_iqd, (s.live->>'cash_expected_iqd')::bigint),
             'cash_counted_iqd',        s.cash_counted_iqd,
             'cash_variance_iqd',       s.cash_variance_iqd,
             'card_payments_iqd',       coalesce(s.card_payments_iqd, (s.live->>'card_payments_iqd')::bigint),
             'card_refunds_iqd',        coalesce(s.card_refunds_iqd,  (s.live->>'card_refunds_iqd')::bigint),
             'payment_count',           coalesce(s.payment_count,     (s.live->>'payment_count')::int),
             'refund_count',            coalesce(s.refund_count,      (s.live->>'refund_count')::int),
             'drawer_open_count',       coalesce(s.drawer_open_count, (s.live->>'drawer_open_count')::int),
             'open_note',               s.open_note,
             'close_note',              s.close_note)
             order by s.opened_at, s.id), '[]'::jsonb) as j
      from shift_rows s
      join staff st on st.id = s.staff_id
      left join staff cb on cb.id = s.closed_by
      left join staff au on au.id = s.authorized_by
  ),
  -- Money with no shift, per day and station (a null station is a write
  -- that named no device). Station-filtered, never staff-filtered: nobody's
  -- shift holds it.
  outside_rows as (
    select u.day_id, u.station_id,
           sum(u.cash_in)::bigint  as cash_payments_iqd,
           sum(u.cash_out)::bigint as cash_refunds_iqd,
           sum(u.card_in)::bigint  as card_payments_iqd,
           sum(u.card_out)::bigint as card_refunds_iqd,
           sum(u.pay_n)::int       as payment_count,
           sum(u.ref_n)::int       as refund_count
      from (
        select p.day_session_id as day_id, p.device_id as station_id,
               case when p.method = 'cash' then p.amount_iqd else 0 end as cash_in,
               0::bigint as cash_out,
               case when p.method = 'card' then p.amount_iqd else 0 end as card_in,
               0::bigint as card_out,
               1 as pay_n, 0 as ref_n
          from payments p
         where p.till_shift_id is null
           and p.venue_id = v_venue
           and p.day_session_id in (select id from days)
           and (p_station_id is null or p.device_id = p_station_id)
        union all
        select m.made_day, m.device_id,
               0::bigint,
               case when m.method = 'cash' then m.amount_iqd else 0 end,
               0::bigint,
               case when m.method = 'card' then m.amount_iqd else 0 end,
               0, 1
          from made m
         where m.till_shift_id is null
           and m.made_day in (select id from days)
           and (p_station_id is null or m.device_id = p_station_id)
      ) u
     group by u.day_id, u.station_id
  ),
  outside_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'day_session_id',    o.day_id,
             'business_date',     d.business_date,
             'station_id',        o.station_id,
             'cash_payments_iqd', o.cash_payments_iqd,
             'cash_refunds_iqd',  o.cash_refunds_iqd,
             'card_payments_iqd', o.card_payments_iqd,
             'card_refunds_iqd',  o.card_refunds_iqd,
             'payment_count',     o.payment_count,
             'refund_count',      o.refund_count)
             order by d.business_date, o.station_id nulls first), '[]'::jsonb) as j
      from outside_rows o
      join days d on d.id = o.day_id
  ),
  cross_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'day_session_id',                d.id,
             'business_date',                 d.business_date,
             'earlier_days_cash_refunds_iqd', coalesce((select sum(m.amount_iqd) from made m
                                                         where m.made_day = d.id and m.paid_day <> d.id
                                                           and m.method = 'cash'), 0),
             'earlier_days_card_refunds_iqd', coalesce((select sum(m.amount_iqd) from made m
                                                         where m.made_day = d.id and m.paid_day <> d.id
                                                           and m.method = 'card'), 0),
             'later_cash_refunds_iqd',        coalesce((select sum(m.amount_iqd) from made m
                                                         where m.paid_day = d.id
                                                           and m.made_day is distinct from d.id
                                                           and m.method = 'cash'), 0),
             'later_card_refunds_iqd',        coalesce((select sum(m.amount_iqd) from made m
                                                         where m.paid_day = d.id
                                                           and m.made_day is distinct from d.id
                                                           and m.method = 'card'), 0))
             order by d.business_date), '[]'::jsonb) as j
      from days d
  )
  select shifts_j.j, outside_j.j, cross_j.j
    into v_shifts, v_outside, v_cross
    from shifts_j, outside_j, cross_j;

  return jsonb_build_object('from', v_from, 'to', v_to,
                            'shifts', v_shifts, 'outside', v_outside, 'cross_day', v_cross);
end $till_shift_list_0205$;

comment on function app.till_shift_list(date, date, text, uuid, uuid) is
  'till_shifts (§2.9.4, V10). Manager or owner at the venue: {from, to, shifts:[{id, day_session_id, business_date, station_id, staff_id, staff_name, opened_at, closed_at, closed_via, closed_by_name, authorized_by_name, opening_float_iqd, handover_difference_iqd, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, open_note, close_note}], outside:[{day_session_id, business_date, station_id, cash_payments_iqd, cash_refunds_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count}], cross_day:[{day_session_id, business_date, earlier_days_cash_refunds_iqd, earlier_days_card_refunds_iqd, later_cash_refunds_iqd, later_card_refunds_iqd}]} over the business days p_from..p_to (no dates: the open day, else the latest; at most 62 days). A refund belongs to the day it was made. FORBIDDEN, INVALID_ARGUMENT (hint range), VENUE_REQUIRED.';

revoke all on function app.till_shift_list(date, date, text, uuid, uuid) from public, anon;
grant execute on function app.till_shift_list(date, date, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. app.refund — $refund_0139$ (0139:368) VERBATIM; the refunds insert
--     gains device_id = p_device_id, so the stamp trigger can name the drawer
--     the money left, and nothing else. Same signature; the 0139:493-494
--     revoke and grant are re-issued anyway.
-- ---------------------------------------------------------------------------
create or replace function app.refund(
  p_payment_id      uuid,
  p_amount_iqd      bigint,
  p_pin             text,
  p_reason_code     text,
  p_items           jsonb default null,
  p_device_id       text  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0205$
declare
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_tab_id   uuid;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
  v_replay   jsonb;
  v_result   jsonb;
  v_day      uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- 0120: claim after the guards and before any write or lock (0049 pattern).
  -- A replay of the same key by the same caller returns the stored result
  -- here. 0139: it also spends the grant the replay worker minted for this
  -- dispatch, if there is one, so the station is not left holding a live
  -- authorisation for the next two minutes. Best effort — a duplicate must
  -- echo the stored result whatever the grant table says.
  v_replay := app.claim_replay(p_idempotency_key, 'refund');
  if v_replay is not null then
    begin
      perform app.consume_pin_grant(p_device_id);
    exception when others then
      null;
    end;
    return v_replay;
  end if;

  -- 0139: a refund is money leaving the till, so it needs an open day like
  -- settle_zero_tab and cancel_tab (0120) — a refund queued offline and
  -- replayed after close_day would otherwise land on a closed day.
  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to
  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt
  -- persisted either way) and holds a single-use grant; without one this raises
  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.
  v_auth := app.consume_pin_grant(p_device_id);

  -- 0044: the tab comes FIRST. payments.tab_id never changes (payments are
  -- append-only, and merge_tabs refuses a donor that has any), so resolving it
  -- through an unlocked read and then locking is sound. Taking `tabs` here is
  -- what makes app.tab_net_paid() actually stable for settle_tab and for all
  -- three REQUIRES_REFUND guards, every one of which reads it under this lock.
  select tab_id into v_tab_id from payments where id = p_payment_id;
  if v_tab_id is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from tabs where id = v_tab_id for update;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_iqd), 0) into v_refunded
    from refunds where payment_id = p_payment_id;
  if v_refunded + p_amount_iqd > v_payment.amount_iqd then
    raise exception 'REFUND_EXCEEDS_PAYMENT' using errcode = 'P0001',
      detail = format('paid %s, already refunded %s', v_payment.amount_iqd, v_refunded);
  end if;

  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by, device_id)
  values (p_payment_id, p_amount_iqd, p_reason_code, auth.uid(), p_device_id)
  returning * into v_refund;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
      select oi.* into v_oi
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.id = (v_item->>'order_item_id')::uuid
         and o.tab_id = v_payment.tab_id;
      if not found then
        raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001',
          detail = v_item->>'order_item_id';
      end if;
      if v_qty < 1 or v_qty > v_oi.qty then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;
      insert into refund_items (refund_id, order_item_id, qty)
      values (v_refund.id, v_oi.id, v_qty);
    end loop;
  end if;

  -- STOCK HOOK (0018/0043): the refund_items_restock trigger writes the
  -- 'refund_reversal' movements, guarded against void-as-waste double credit.

  perform app.write_audit('payment.refund', 'refunds', v_refund.id::text,
                          null, to_jsonb(v_refund), p_reason_code, v_auth, p_device_id);

  v_result := jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $refund_0205$;

comment on function app.refund(uuid, bigint, text, text, jsonb, text, text) is
  'till_shifts (0139, 0120, 0044, 0115). Refunds part or all of one payment (manager, owner) behind a manager-PIN grant, inside an open day (NO_OPEN_DAY otherwise); naming order lines restocks them. The refunds row records p_device_id, and app.stamp_till_shift gives it the shift open at that station. p_idempotency_key: a replay of the same key by the same caller echoes the first result with duplicate:true (app.claim_replay). REFUND_EXCEEDS_PAYMENT (detail = paid/refunded), PAYMENT_NOT_FOUND, ITEM_NOT_ON_TAB, INVALID_QTY, INVALID_AMOUNT.';

revoke all on function app.refund(uuid, bigint, text, text, jsonb, text, text) from public, anon;
grant execute on function app.refund(uuid, bigint, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. app.close_day — 0020:18 VERBATIM (its only body), plus: after the two
--     guards and before the math, every shift still open on the day is locked
--     FOR UPDATE (after the day: day_sessions -> till_shifts) and ends with
--     it, uncounted ('day_close', TI9); the return gains
--     shifts_closed_with_day. The expected, counted and variance math is
--     unchanged (TI5). The 0020:179-180 revoke and grant are re-issued.
-- ---------------------------------------------------------------------------
create or replace function app.close_day(
  p_cash_counted_iqd bigint,
  p_card_batch_iqd   bigint default null,
  p_notes            text default null,
  p_device_id        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_day_0205$
declare
  v_day           day_sessions%rowtype;
  v_before        jsonb;
  v_cash_in       bigint;
  v_cash_refunds  bigint;
  v_card_in       bigint;
  v_card_refunds  bigint;
  v_cash_expected bigint;
  v_card_expected bigint;
  v_shift         till_shifts%rowtype;
  v_shifts_closed int := 0;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cash_counted_iqd is null or p_cash_counted_iqd < 0 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;

  select * into v_day from day_sessions
   where status in ('open','closing')
   order by opened_at desc limit 1
   for update;
  if not found then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- Guard 1: every tab settled or voided before the day closes.
  if exists (select 1 from tabs
              where day_session_id = v_day.id and status in ('open','awaiting_payment')) then
    raise exception 'DAY_OPEN_TABS' using errcode = 'P0001',
      hint = 'settle or void every open tab before closing the day';
  end if;

  -- Guard 2: no till may still hold queued (unreplayed) writes. Queue depth is
  -- reported by app.heartbeat (0021); a device silent since before the day
  -- opened does not block.
  if exists (select 1 from device_heartbeats
              where queue_depth > 0 and last_seen_at >= v_day.opened_at) then
    raise exception 'DAY_UNSYNCED' using errcode = 'P0001',
      hint = 'a till still has queued offline writes; let it finish replaying';
  end if;

  -- till_shifts: no shift outlives its day. Each one still open ends here,
  -- in this transaction, with its figures stamped and no count.
  perform 1 from till_shifts where day_session_id = v_day.id and closed_at is null for update;
  for v_shift in
    select * from till_shifts
     where day_session_id = v_day.id and closed_at is null
     order by opened_at
  loop
    perform app.close_till_shift_internal(v_shift, null, null, 'day_close', null, p_device_id);
    v_shifts_closed := v_shifts_closed + 1;
  end loop;

  v_before := to_jsonb(v_day);

  select coalesce(sum(p.amount_iqd), 0) into v_cash_in
    from payments p where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(r.amount_iqd), 0) into v_cash_refunds
    from refunds r join payments p on p.id = r.payment_id
   where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(p.amount_iqd), 0) into v_card_in
    from payments p where p.day_session_id = v_day.id and p.method = 'card';
  select coalesce(sum(r.amount_iqd), 0) into v_card_refunds
    from refunds r join payments p on p.id = r.payment_id
   where p.day_session_id = v_day.id and p.method = 'card';

  v_cash_expected := v_day.opening_float_iqd + v_cash_in - v_cash_refunds;
  v_card_expected := v_card_in - v_card_refunds;

  update day_sessions
     set status                  = 'closed',
         closed_at               = now(),
         closed_by               = auth.uid(),
         cash_expected_iqd       = v_cash_expected,
         cash_counted_iqd        = p_cash_counted_iqd,
         cash_variance_iqd       = p_cash_counted_iqd - v_cash_expected,
         card_expected_iqd       = v_card_expected,
         card_terminal_batch_iqd = p_card_batch_iqd,
         notes                   = coalesce(p_notes, notes)
   where id = v_day.id
   returning * into v_day;

  perform app.write_audit('day.close', 'day_sessions', v_day.id::text,
                          v_before, to_jsonb(v_day), null, null, p_device_id);

  return jsonb_build_object(
    'day_session_id',    v_day.id,
    'business_date',     v_day.business_date,
    'cash_expected_iqd', v_day.cash_expected_iqd,
    'cash_counted_iqd',  v_day.cash_counted_iqd,
    'cash_variance_iqd', v_day.cash_variance_iqd,
    'card_expected_iqd', v_day.card_expected_iqd,
    'card_terminal_batch_iqd', v_day.card_terminal_batch_iqd,
    'shifts_closed_with_day', v_shifts_closed);
end $close_day_0205$;

comment on function app.close_day(bigint, bigint, text, text) is
  'till_shifts (0020). Manager or owner: closes the open day once every tab is settled or void (DAY_OPEN_TABS) and no till reports queued writes since it opened (DAY_UNSYNCED). Every till shift still open on the day ends with it, uncounted (drawer.shift_close_by_day). Stamps expected cash = opening float + cash payments - cash refunds of the day''s payments, the count and the variance; returns {day_session_id, business_date, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_expected_iqd, card_terminal_batch_iqd, shifts_closed_with_day}. INVALID_COUNT, NO_OPEN_DAY. Audit day.close. Online-only.';

revoke all on function app.close_day(bigint, bigint, text, text) from public, anon;
grant execute on function app.close_day(bigint, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Owner assistant: till_shifts joins the table_read allowlist, and the
--     three stamp columns join payments' and refunds' (the 0144 statement,
--     limited to these tables; ON CONFLICT DO NOTHING adds only the new
--     columns). The staff notes never reach the LLM.
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('till_shifts', 'payments', 'refunds')
   and c.column_name not in ('open_note', 'close_note')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
