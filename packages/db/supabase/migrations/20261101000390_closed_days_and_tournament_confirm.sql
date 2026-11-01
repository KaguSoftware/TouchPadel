set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0390 closed_days_and_tournament_confirm — two desk rules (Majed, 2026-11-01).
--
--   A. F-51: "Adding a closed day that has bookings: each booking must first be
--      cancelled, marked no-show, or paid; the closed day cannot be saved until
--      all are resolved." set_opening_hours (latest 0208, signature unchanged)
--      refuses a NEWLY added closed date that still has an unresolved booking
--      with CLOSED_DAY_HAS_BOOKINGS (detail the count, hint the first such
--      date). A booking is on a date when its range touches that branch-local
--      calendar day (as assert_bookable, 0210, reads closed dates). Unresolved:
--      kind booking (lessons are the coaching pages', holds expire, maintenance
--      is not a booking), status pending / confirmed / arrived / completed, and
--      not paid: a pending one always counts (it cannot be paid yet), the others
--      while app.court_fee_remaining (0342) is above 0. Cancelled, no-show and
--      expired are resolved; a paid booking is resolved even if it is not played.
--      Dates already closed, and removing a date, are never refused. The new
--      closed_day_bookings(p_dates, p_venue_id) lists those bookings for the
--      editor (manager or owner at the branch, as the save).
--   B. F-40: the desk confirms each participant before the draw (section B).

-- ===========================================================================
-- A. Closed days with bookings
-- ===========================================================================

create or replace function app.closed_day_unresolved(p_venue uuid, p_dates date[])
returns table (reservation_id uuid, day date)
language sql stable security definer set search_path = public as $closed_day_unresolved_0390$
  select r.id, d.day
    from reservations r
    join courts c on c.id = r.court_id
    join venue_settings vs on vs.venue_id = c.venue_id
    cross join lateral (
      select g::date as day
        from generate_series((r.start_at at time zone coalesce(vs.timezone, 'Asia/Baghdad'))::date,
                             ((r.end_at at time zone coalesce(vs.timezone, 'Asia/Baghdad')) - interval '1 microsecond')::date,
                             interval '1 day') g
    ) d
   where c.venue_id = p_venue
     and r.kind = 'booking'
     and r.status in ('pending','confirmed','arrived','completed')
     and d.day = any (coalesce(p_dates, '{}'))
     and (r.status = 'pending' or app.court_fee_remaining(r.id) > 0)
$closed_day_unresolved_0390$;

comment on function app.closed_day_unresolved(uuid, date[]) is
  '0390 (F-51). Internal: the bookings at a branch on any of p_dates (branch-local days the booking touches) that are not yet cancelled, no-show, expired or paid: kind booking, pending, or confirmed / arrived / completed with court fee still owed (app.court_fee_remaining). One row per booking and day.';
revoke all on function app.closed_day_unresolved(uuid, date[]) from public, anon, authenticated;
grant execute on function app.closed_day_unresolved(uuid, date[]) to service_role;

create or replace function app.closed_day_bookings(p_dates date[], p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $closed_day_bookings_0390$
declare
  v_venue uuid := coalesce(p_venue_id, app.current_venue());
  v_out   jsonb;
begin
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_dates is null or cardinality(p_dates) > 366 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'dates';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'day', u.day,
           'court_id', r.court_id,
           'court_name_en', c.name_en,
           'court_name_ar', c.name_ar,
           'start_at', r.start_at,
           'end_at', r.end_at,
           'status', r.status,
           'guest_name', coalesce(nullif(btrim(r.guest_name), ''), p.full_name),
           'price_iqd', r.price_iqd,
           'remaining_iqd', case when r.status = 'pending' then r.price_iqd else app.court_fee_remaining(r.id) end,
           'started', r.start_at <= now()
         ) order by r.start_at, c.name_en), '[]'::jsonb)
    into v_out
    from (select distinct on (x.reservation_id) x.reservation_id, x.day
            from app.closed_day_unresolved(v_venue, p_dates) x
           order by x.reservation_id, x.day) u
    join reservations r on r.id = u.reservation_id
    join courts c on c.id = r.court_id
    left join profiles p on p.id = r.guest_id;
  return jsonb_build_object('bookings', v_out);
end $closed_day_bookings_0390$;

comment on function app.closed_day_bookings(date[], uuid) is
  '0390 (F-51). Manager or owner at the branch (p_venue_id, else the resolved branch): the bookings on p_dates (at most 366) that must be cancelled, marked no-show or paid before those dates can be closed: {bookings: [{id, day, court_id, court_name_en, court_name_ar, start_at, end_at, status, guest_name, price_iqd, remaining_iqd, started}]}, by start. FORBIDDEN, INVALID_ARGUMENT (hint dates).';
revoke all on function app.closed_day_bookings(date[], uuid) from public, anon;
grant execute on function app.closed_day_bookings(date[], uuid) to authenticated;

-- set_opening_hours: re-issued from 20260926000208_venue_settings_per_venue.sql:119.
-- One step added before the update: a newly closed date with an unresolved booking is refused.
create or replace function app.set_opening_hours(
  p_opening_hours jsonb default null,
  p_closed_dates  date[] default null,
  p_venue_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $set_hours_0390$
declare
  v_venue   uuid;
  v_before  jsonb;
  v_after   jsonb;
  v_old     date[];
  v_added   date[];
  v_count   int;
  v_first   date;
begin
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_hours is not null and jsonb_typeof(p_opening_hours) <> 'object' then
    raise exception 'INVALID_HOURS' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates)), closed_dates
    into v_before, v_old from venue_settings where venue_id = v_venue;
  if v_before is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  -- 0390 (F-51): every booking on a newly closed date is resolved first.
  if p_closed_dates is not null then
    select coalesce(array_agg(d), '{}') into v_added
      from unnest(p_closed_dates) d
     where d is not null and not (d = any (coalesce(v_old, '{}')));
    if cardinality(v_added) > 0 then
      select count(distinct u.reservation_id)::int, min(u.day)
        into v_count, v_first
        from app.closed_day_unresolved(v_venue, v_added) u;
      if v_count > 0 then
        raise exception 'CLOSED_DAY_HAS_BOOKINGS' using errcode = 'P0001',
          detail = v_count::text, hint = v_first::text;
      end if;
    end if;
  end if;

  update venue_settings
     set opening_hours = coalesce(p_opening_hours, opening_hours),
         closed_dates  = coalesce(p_closed_dates, closed_dates)
   where venue_id = v_venue;

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_after from venue_settings where venue_id = v_venue;

  perform app.write_audit('settings.opening_hours', 'venue_settings', v_venue::text,
                          v_before, v_after);
end $set_hours_0390$;

comment on function app.set_opening_hours(jsonb, date[], uuid) is
  '0052, 0208, 0390. Manager or owner at the branch: set that branch''s opening hours and/or closed dates (null keeps the current value). p_venue_id defaults to the caller''s resolved venue (VENUE_REQUIRED when ambiguous). A date added to the closed list that still has a booking to cancel, mark no-show or pay (app.closed_day_bookings) is refused: CLOSED_DAY_HAS_BOOKINGS, detail the count, hint the first such date. Audited as settings.opening_hours at the branch.';

revoke all on function app.set_opening_hours(jsonb, date[], uuid) from public, anon;
grant execute on function app.set_opening_hours(jsonb, date[], uuid) to authenticated;

-- ===========================================================================
-- B. F-40: the desk confirms a participant; only then are they in
-- ===========================================================================
-- Majed: "Desk operator tournaments page: Confirm participant (only then is the
-- person in the tournament) and a Pay page; a confirmed participant may be
-- unpaid." A registered entry (a guest's own registration or a desk add) holds
-- its seat but is not in the draw until the court desk, a manager or the owner
-- confirms it (tournament_entries.confirmed_at / confirmed_by). Payment stays
-- independent: tournament_settle (0299) takes money from any registered entry,
-- confirmed or not, and a confirmed entry may owe.
--   * The draw refuses while any registered entry is unconfirmed: a BEFORE
--     INSERT trigger on tournament_rounds raises TOURNAMENT_UNCONFIRMED (detail
--     the count), so tournament_set_rounds (0311) is not re-issued.
--   * Leaving the registered list (waitlisted, withdrawn) clears the
--     confirmation; a no-show keeps it; a substitute seated at the no-show
--     (substitute_for set, 0311) is confirmed by whoever seated them.
--   * Entries of running and finished tournaments are confirmed by this
--     migration, so a tournament under way plays on.
--   * The new tournament_confirm_entry(p_entry_id, p_confirmed default true)
--     (court desk, manager, owner at the branch; open or closed tournament;
--     registered entry; state-idempotent; audited) sets or clears it, and
--     desk_tournament_detail (0359 is no longer the latest) carries
--     entries[].confirmed_at, confirmed_by_name and can.confirm. The guest's
--     public views are unchanged.

alter table tournament_entries add column if not exists confirmed_at timestamptz;
alter table tournament_entries add column if not exists confirmed_by uuid references staff (id) on delete set null;

comment on column tournament_entries.confirmed_at is
  '0390 (F-40): when the desk confirmed this registered entry is in; NULL = not yet. The draw (tournament_rounds insert) refuses while a registered entry has none.';
comment on column tournament_entries.confirmed_by is '0390: the staff member who confirmed the entry.';

update tournament_entries e
   set confirmed_at = coalesce(e.updated_at, now())
  from tournaments t
 where t.id = e.tournament_id
   and t.status in ('running', 'finished')
   and e.status in ('registered', 'no_show')
   and e.confirmed_at is null;

create or replace function app.trg_tournament_entry_confirm()
returns trigger
language plpgsql security definer set search_path = public as $trg_tournament_entry_confirm_0390$
begin
  if new.status in ('waitlisted', 'withdrawn') then
    new.confirmed_at := null;
    new.confirmed_by := null;
  elsif new.status = 'registered' and new.substitute_for is not null
        and old.substitute_for is distinct from new.substitute_for and new.confirmed_at is null then
    new.confirmed_at := now();
    new.confirmed_by := (select s.id from staff s where s.id = auth.uid());
  end if;
  return new;
end $trg_tournament_entry_confirm_0390$;

comment on function app.trg_tournament_entry_confirm() is
  '0390 (F-40). Trigger: an entry that leaves the registered list loses its confirmation; a substitute seated at a no-show is confirmed.';
revoke all on function app.trg_tournament_entry_confirm() from public, anon, authenticated;

drop trigger if exists tournament_entries_confirm on public.tournament_entries;
create trigger tournament_entries_confirm before update of status, substitute_for on public.tournament_entries
  for each row execute function app.trg_tournament_entry_confirm();

create or replace function app.trg_tournament_rounds_confirmed()
returns trigger
language plpgsql security definer set search_path = public as $trg_tournament_rounds_confirmed_0390$
declare
  v_n int;
begin
  select count(*)::int into v_n
    from tournament_entries e
   where e.tournament_id = new.tournament_id and e.status = 'registered' and e.confirmed_at is null;
  if v_n > 0 then
    raise exception 'TOURNAMENT_UNCONFIRMED' using errcode = 'P0001', detail = v_n::text,
      hint = 'confirm every participant before the rounds are drawn';
  end if;
  return new;
end $trg_tournament_rounds_confirmed_0390$;

comment on function app.trg_tournament_rounds_confirmed() is
  '0390 (F-40). Trigger: no round is written while a registered entry of the tournament is unconfirmed (TOURNAMENT_UNCONFIRMED, detail the count).';
revoke all on function app.trg_tournament_rounds_confirmed() from public, anon, authenticated;

drop trigger if exists tournament_rounds_confirmed on public.tournament_rounds;
create trigger tournament_rounds_confirmed before insert on public.tournament_rounds
  for each row execute function app.trg_tournament_rounds_confirmed();

create or replace function app.tournament_confirm_entry(p_entry_id uuid, p_confirmed boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_confirm_entry_0390$
declare
  v_e  tournament_entries%rowtype;
  v_t  tournaments%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_e from tournament_entries where id = p_entry_id;
  if not found then
    raise exception 'TOURNAMENT_ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = v_e.tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  -- Lock order: the tournament, then its entry.
  select * into v_t from tournaments where id = v_t.id for share;
  select * into v_e from tournament_entries where id = p_entry_id for update;
  if v_t.status not in ('open', 'closed') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = v_t.status;
  end if;
  if v_e.status <> 'registered' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = v_e.status;
  end if;
  if coalesce(p_confirmed, true) = (v_e.confirmed_at is not null) then
    return jsonb_build_object('entry_id', v_e.id, 'confirmed', v_e.confirmed_at is not null,
                              'confirmed_at', v_e.confirmed_at, 'changed', false);
  end if;
  update tournament_entries
     set confirmed_at = case when coalesce(p_confirmed, true) then now() end,
         confirmed_by = case when coalesce(p_confirmed, true) then auth.uid() end,
         updated_at   = now()
   where id = v_e.id
  returning * into v_e;
  perform app.write_audit(case when v_e.confirmed_at is not null then 'tournament.entry_confirmed'
                               else 'tournament.entry_unconfirmed' end,
                          'tournament_entries', v_e.id::text, null,
                          jsonb_build_object('confirmed', v_e.confirmed_at is not null));
  return jsonb_build_object('entry_id', v_e.id, 'confirmed', v_e.confirmed_at is not null,
                            'confirmed_at', v_e.confirmed_at, 'changed', true);
end $tournament_confirm_entry_0390$;

comment on function app.tournament_confirm_entry(uuid, boolean) is
  '0390 (F-40). The court desk, a manager or the owner at the tournament''s branch confirms (p_confirmed true, the default) or un-confirms a registered entry of an open or closed tournament: only a confirmed entry may be drawn into rounds; payment is independent. State-idempotent: {entry_id, confirmed, confirmed_at, changed}. FORBIDDEN, TOURNAMENT_ENTRY_NOT_FOUND (unknown or outside the visible branches), VENUE_MISMATCH, TOURNAMENT_NOT_OPEN (detail the status), INVALID_TRANSITION (detail the entry status). Audit tournament.entry_confirmed / tournament.entry_unconfirmed.';
revoke all on function app.tournament_confirm_entry(uuid, boolean) from public, anon;
grant execute on function app.tournament_confirm_entry(uuid, boolean) to authenticated;

-- desk_tournament_detail: re-issued from 20261022000359_tournament_classes.sql:883.
-- Added: entries[].confirmed_at, confirmed_by_name and can.confirm.
create or replace function app.desk_tournament_detail(p_tournament_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $desk_tournament_detail_0390$
declare
  v_t         tournaments%rowtype;
  v_tz        text;
  v_entries   jsonb;
  v_courts    jsonb;
  v_rounds    jsonb;
  v_standings jsonb;
  v_desk      boolean;
  v_mgmt      boolean;
  v_till      boolean;
begin
  -- The role first (R57): the entries carry every guest's name and phone.
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select coalesce(vs.timezone, v.timezone) into v_tz
    from venues v left join venue_settings vs on vs.venue_id = v.id
   where v.id = v_t.venue_id;
  v_desk := app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner');
  v_mgmt := app.is_staff_at(v_t.venue_id, 'manager', 'owner');
  v_till := app.is_staff_at(v_t.venue_id, 'cashier', 'court_desk', 'manager', 'owner');

  -- Registered by seed (then entered_at), the waitlist in its order, then the rest.
  select coalesce(jsonb_agg(x.j order by x.k1, x.k2, x.k3, x.id), '[]'::jsonb)
    into v_entries
    from (select e.id,
                 case e.status when 'registered' then 0 when 'waitlisted' then 1 when 'no_show' then 2 else 3 end as k1,
                 coalesce(e.seed_no, 32767) as k2,
                 e.entered_at as k3,
                 jsonb_build_object(
                   'entry_id', e.id,
                   'guest_id', e.guest_id,
                   'full_name', p.full_name,
                   'phone', p.phone,
                   'status', e.status,
                   'seed_no', e.seed_no,
                   'waitlist_position',
                     case when e.status = 'waitlisted' then
                       (select count(*)::int + 1 from tournament_entries w
                         where w.tournament_id = e.tournament_id and w.status = 'waitlisted'
                           and (w.entered_at, w.id) < (e.entered_at, e.id)) end,
                   'added_by_kind', e.added_by_kind,
                   'owed_iqd', (m.money->>'owed_iqd')::bigint,
                   'net_paid_iqd', (m.money->>'net_iqd')::bigint,
                   'refund_due_iqd', (m.money->>'refund_due_iqd')::bigint,
                   'substitute_for', e.substitute_for,
                   -- 0390 (F-40): the desk confirmed this person is in.
                   'confirmed_at', e.confirmed_at,
                   'confirmed_by_name', (select s.display_name from staff s where s.id = e.confirmed_by),
                   -- 0310 (c9): the payments a refund is made against.
                   'payments', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'payment_id',     py.id,
                              'tab_id',         tb.id,
                              'method',         py.method,
                              'amount_iqd',     py.amount_iqd,
                              'refunded_iqd',   coalesce(rf.refunded, 0),
                              'refundable_iqd', py.amount_iqd - coalesce(rf.refunded, 0),
                              'created_at',     py.created_at) order by py.created_at, py.id)
                       from tabs tb
                       join payments py on py.tab_id = tb.id
                       left join lateral (select sum(x.amount_iqd)::bigint as refunded
                                            from refunds x where x.payment_id = py.id) rf on true
                      where tb.tournament_entry_id = e.id and tb.kind = 'tournament'
                        and tb.status = 'settled' and tb.merged_into_tab_id is null), '[]'::jsonb)) as j
            from tournament_entries e
            left join profiles p on p.id = e.guest_id
            cross join lateral (select app.tournament_entry_money(e.id) as money) m
           where e.tournament_id = v_t.id) x;

  -- The courts of the run's live adopted blocks.
  select coalesce(jsonb_agg(jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar,
                                               'sort_order', c.sort_order)
                            order by c.sort_order, c.id), '[]'::jsonb)
    into v_courts
    from courts c
   where c.id in (select r.court_id from reservations r
                   where r.protocol_run_id = v_t.protocol_run_id and r.block_purpose = 'event'
                     and r.status in ('pending', 'confirmed', 'arrived'));

  select coalesce(jsonb_agg(jsonb_build_object(
           'round_no', r.round_no,
           'sit_out', to_jsonb(r.bye_entry_ids),
           'matches', coalesce((select jsonb_agg(jsonb_build_object(
                                         'match_id', m.id,
                                         'court_id', m.court_id,
                                         'a', jsonb_build_array(m.a1, m.a2),
                                         'b', jsonb_build_array(m.b1, m.b2),
                                         'points_a', m.points_a,
                                         'points_b', m.points_b,
                                         'revision', m.revision,
                                         'corrections', greatest((select count(*) from tournament_score_events s
                                                                   where s.match_id = m.id) - 1, 0))
                                         order by c.sort_order, c.id)
                                  from tournament_matches m
                                  join courts c on c.id = m.court_id
                                 where m.round_id = r.id), '[]'::jsonb))
           order by r.round_no), '[]'::jsonb)
    into v_rounds
    from tournament_rounds r
   where r.tournament_id = v_t.id;

  -- In the function's own order: a tie on rank goes by seed, then entry id.
  select coalesce(jsonb_agg(to_jsonb(s) order by s.rank, se.seed_no nulls last, s.entry_id), '[]'::jsonb)
    into v_standings
    from app.tournament_standings(v_t.id) s
    left join tournament_entries se on se.id = s.entry_id;

  return jsonb_build_object(
    'id', v_t.id,
    'venue_id', v_t.venue_id,
    'protocol_run_id', v_t.protocol_run_id,
    'name_en', v_t.name_en,
    'name_ar', v_t.name_ar,
    'format', v_t.format,
    'category', v_t.category,
    'class', v_t.class,
    'classes', to_jsonb(v_t.classes),
    'points_target', v_t.points_target,
    'rounds_planned', v_t.rounds_planned,
    'max_entries', v_t.max_entries,
    'min_entries', v_t.min_entries,
    'waitlist_max', v_t.waitlist_max,
    'entry_fee_iqd', v_t.entry_fee_iqd,
    'prize_en', v_t.prize_en,
    'prize_ar', v_t.prize_ar,
    'starts_at', v_t.starts_at,
    'ends_at', v_t.ends_at,
    'registration_closes_at', v_t.registration_closes_at,
    'status', v_t.status,
    'cancel_reason', v_t.cancel_reason,
    'revision', v_t.revision,
    'closed_at', v_t.closed_at,
    'finished_at', v_t.finished_at,
    'cancelled_at', v_t.cancelled_at,
    'sweep_errors', v_t.sweep_errors,
    'timezone', v_tz,
    'server_now', now(),
    'entries', v_entries,
    'courts', v_courts,
    'rounds', v_rounds,
    'standings', v_standings,
    'can', jsonb_build_object(
      'add', v_desk and v_t.status in ('open', 'closed'),
      'set_rounds', v_desk and v_t.status in ('closed', 'running'),
      -- 0311 (c35): the server's rule. After the finish a score is a
      -- manager's, within 48 hours of finished_at.
      'score', (v_desk and v_t.status = 'running')
               or (v_mgmt and v_t.status = 'finished'
                   and now() <= coalesce(v_t.finished_at, v_t.ends_at) + interval '48 hours'),
      'cancel', v_mgmt and v_t.status in ('open', 'closed', 'running'),
      'close', v_desk and v_t.status = 'open' and (v_mgmt or now() >= v_t.registration_closes_at),
      'finish', v_mgmt and v_t.status = 'running',
      'settle', v_till and v_t.status <> 'cancelled',
      -- 0390 (F-40): confirm a registered entry before the draw.
      'confirm', v_desk and v_t.status in ('open', 'closed')));
end $desk_tournament_detail_0390$;

comment on function app.desk_tournament_detail(uuid) is
  'Tournaments (M7, §1.8; 0310; 0311 c35; 0359 classes, every class it is for; 0390 entries[].confirmed_at, confirmed_by_name and can.confirm). The cashier, the court desk, managers and the owner (the entries carry names and phones): FORBIDDEN; TOURNAMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH (not one of those roles at its branch). The tournament''s fields and revision, sweep_errors (0310: failed sweep cancels), timezone, server_now; entries [{entry_id, guest_id, full_name, phone, status, seed_no, waitlist_position, added_by_kind, owed_iqd, net_paid_iqd, refund_due_iqd, substitute_for, payments [{payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at}] (0310)}] (registered by seed, the waitlist in order, then the rest); courts [{court_id, name_en, name_ar, sort_order}] of the live adopted blocks; rounds [{round_no, sit_out [entry], matches [{match_id, court_id, a [entry, entry], b [entry, entry], points_a, points_b, revision, corrections}]}]; standings (app.tournament_standings); can {add (open or closed; 0310: not running), set_rounds, score (0311: the court desk while running; a manager on a finished tournament within 48 hours of finished_at), cancel, close (0310: open, past the cut-off or a manager), finish (0310: a manager, running), settle} for the caller''s role and the status.';

revoke all on function app.desk_tournament_detail(uuid) from public, anon;
grant execute on function app.desk_tournament_detail(uuid) to authenticated;
