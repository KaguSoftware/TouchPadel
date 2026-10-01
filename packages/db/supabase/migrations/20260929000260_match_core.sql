set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0260 match_core — open matches, lane DB: the internal functions every match
-- body is built from (docs/design/open-matches/db.md §2, §3, §4.5; build
-- contracts §1.4, §1.5, rulings R4, R12, R13, R15–R19, R21, R22, R37).
--
--   1. Locks        lock_match_venue, lock_match_money, try_lock_match_venue,
--                   match_lock_courts, match_expire_holds, match_lock
--   2. People       match_eligibility, match_guest, match_visibility,
--                   name_initial, match_display_name, match_seat_label
--   3. Courts and   match_shares, match_court_free_firm, match_pick_court,
--      seats        match_carriers, match_marks_open, match_drop_ineligible,
--                   match_try_book
--   4. Tickets      ticket_pick, ticket_lock, ticket_release, ticket_forfeit,
--                   ticket_restore
--   5. Ending and   match_end, match_recompute_organiser, match_event,
--      counts       guest_games_played, guest_match_no_shows
--
-- Every function is security definer with a pinned search_path and revoked
-- from public, anon and authenticated: they are reached only from the guest
-- RPCs (0261), the desk and money RPCs (0262), the reservation trigger and the
-- sweep (0263). Nothing here is granted, so nothing is client-callable yet.
--
-- The lock order (contracts §1.4, db.md §2.1; scripts/check-lock-order.mjs,
-- edited in this commit):
--
--   day_sessions -> match_money_advisory -> tabs -> orders -> order_items
--     -> tickets -> payments -> till_shifts -> refunds -> stock_batches
--     -> court_advisory -> reservations -> match_venue_advisory -> match_tickets
--
-- matches, match_seats and match_requests are never locked FOR UPDATE: the
-- branch mutex (lock_match_venue) serialises every change to them. A reserved,
-- in-use or forfeited ticket is moved only by a body holding the mutex of the
-- branch whose match holds it; available tickets are locked in one id-ordered
-- statement per body (db.md §2.4).
--
-- expire_stale_holds (latest 0252) is not re-issued here. Whoever re-issues it
-- later re-issues its branch-scoped twin match_expire_holds in the same file.

-- ===========================================================================
-- 1. Locks (db.md §2.2)
-- ===========================================================================

-- The branch mutex. Hashed as 0042 hashes the court key.
create or replace function app.lock_match_venue(p_venue uuid) returns void
language plpgsql security definer set search_path = public as $lock_match_venue_0260$
begin
  if p_venue is not null then
    perform pg_advisory_xact_lock(hashtextextended('app.matches:venue:' || p_venue::text, 0));
  end if;
end $lock_match_venue_0260$;

comment on function app.lock_match_venue(uuid) is
  '0260. Internal. The open-match branch mutex: pg_advisory_xact_lock on ''app.matches:venue:''||branch (0042 hashing). Ranked after reservations and before match_tickets (match_venue_advisory in scripts/check-lock-order.mjs). Every change to matches, match_seats and match_requests of the branch happens under it.';

revoke all on function app.lock_match_venue(uuid) from public, anon, authenticated;

-- The match's money lock (R19): every writer that changes what a seat owes.
create or replace function app.lock_match_money(p_match_id uuid) returns void
language plpgsql security definer set search_path = public as $lock_match_money_0260$
begin
  if p_match_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('app.matches:money:' || p_match_id::text, 0));
  end if;
end $lock_match_money_0260$;

comment on function app.lock_match_money(uuid) is
  '0260. Internal (R19). The open match''s money lock: pg_advisory_xact_lock on ''app.matches:money:''||match. Ranked after day_sessions and before tabs (match_money_advisory in scripts/check-lock-order.mjs). Taken first by every writer that changes what a seat owes: Money''s settle, link and write-off (0262), and DB''s marks, call-off, desk add and desk remove.';

revoke all on function app.lock_match_money(uuid) from public, anon, authenticated;

-- Never waits: the bump half of the reservation trigger and the sweep's later
-- branches (db.md §2.3). All or nothing: the attempts run in a subtransaction
-- that a busy key aborts, and the abort releases every key it took, so a
-- false leaves nothing held (a skipped branch is not kept locked while the
-- sweep works elsewhere).
create or replace function app.try_lock_match_venue(p_venue uuid, p_courts boolean default false)
returns boolean
language plpgsql security definer set search_path = public as $try_lock_match_venue_0260$
declare
  v_court record;
begin
  if p_venue is null then
    return false;
  end if;
  begin
    if not pg_try_advisory_xact_lock(hashtextextended('app.matches:venue:' || p_venue::text, 0)) then
      raise exception 'match venue busy' using errcode = '55P03';
    end if;
    if coalesce(p_courts, false) then
      for v_court in
        select c.id from courts c where c.venue_id = p_venue and c.is_active order by c.id
      loop
        if not pg_try_advisory_xact_lock(hashtextextended('app.reservations:court:' || v_court.id::text, 0)) then
          raise exception 'match court busy' using errcode = '55P03';
        end if;
      end loop;
    end if;
  exception when lock_not_available then
    return false;
  end;
  return true;
end $try_lock_match_venue_0260$;

comment on function app.try_lock_match_venue(uuid, boolean) is
  '0260. Internal. Tries the branch mutex without waiting (pg_try_advisory_xact_lock); with p_courts, then every active court key of the branch in id order. All or nothing: the first key already held aborts the attempt''s subtransaction, which releases every key it took, and the call returns false holding nothing new; true keeps every key until commit. The reservation trigger''s bump half and the sweep''s later branches use it, so neither ever waits on the mutex, and a branch the sweep skips stays free for its guests and desk.';

revoke all on function app.try_lock_match_venue(uuid, boolean) from public, anon, authenticated;

-- Every active court of the branch, id order (0042's key through app.lock_court).
create or replace function app.match_lock_courts(p_venue uuid) returns void
language plpgsql security definer set search_path = public as $match_lock_courts_0260$
declare
  v_court record;
begin
  for v_court in
    select c.id from courts c where c.venue_id = p_venue and c.is_active order by c.id
  loop
    perform app.lock_court(v_court.id);
  end loop;
end $match_lock_courts_0260$;

comment on function app.match_lock_courts(uuid) is
  '0260. Internal. app.lock_court on every active court of the branch, in id order: what a match body holds before it can book any of them.';

revoke all on function app.match_lock_courts(uuid) from public, anon, authenticated;

-- The branch-scoped twin of expire_stale_holds (0252:711, the statement of
-- 0242:1495): the same single statement with `and r.venue_id = p_venue`
-- added. The chain-wide form would trip zz_branch_guard (0230) for a staff
-- caller on another branch's holds. Like expire_stale_holds with arguments it
-- settles no hold-ladder strike (0252): a lapse it expires is settled later,
-- dated by the hold, by the guest's next hold_slot or by tp_hold_sweep
-- (tests/matches-hold-ladder.test.ts).
create or replace function app.match_expire_holds(p_venue uuid, p_period tstzrange) returns int
language plpgsql security definer set search_path = public as $match_expire_holds_0260$
declare
  v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or r.guest_id is null)   -- 0071 (SEC-07): orphans too
        and r.venue_id = p_venue
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;
  return v_count;
end $match_expire_holds_0260$;

comment on function app.match_expire_holds(uuid, tstzrange) is
  '0260. Internal. The branch-scoped twin of app.expire_stale_holds (0242, 0252): expires the branch''s stale and orphan holds overlapping p_period in ONE id-ordered statement, skipping a hold whose online payment is still open. Settles no hold-ladder strike: like expire_stale_holds with arguments, it leaves a lapse to the guest''s next hold_slot or to tp_hold_sweep (0252). Whoever re-issues expire_stale_holds re-issues this in the same file (a test pins the two to the same rows).';

revoke all on function app.match_expire_holds(uuid, tstzrange) from public, anon, authenticated;

-- R15: courts -> the match's booking row -> hold expiry -> the mutex. Hold
-- expiry always runs before the mutex, one statement for the branch.
create or replace function app.match_lock(p_match_id uuid) returns matches
language plpgsql security definer set search_path = public as $match_lock_0260$
declare
  v_venue  uuid;
  v_period tstzrange;
  v_res    uuid;
  v_match  matches%rowtype;
begin
  select mt.venue_id, mt.period into v_venue, v_period from matches mt where mt.id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  perform app.match_lock_courts(v_venue);

  -- Stable from here: only a body holding every court of the branch attaches
  -- a booking (match_try_book).
  select mt.reservation_id into v_res from matches mt where mt.id = p_match_id;
  if v_res is not null then
    perform 1 from reservations where id = v_res for update;
  end if;

  perform app.match_expire_holds(v_venue, v_period);
  perform app.lock_match_venue(v_venue);

  select * into v_match from matches where id = p_match_id;
  return v_match;
end $match_lock_0260$;

comment on function app.match_lock(uuid) is
  '0260. Internal (R15, level L2). Locks a match for a change that may book or re-seat it: asserts app.venue_id, every active court of its branch (id order), its booking row FOR UPDATE when it has one, the branch''s stale holds over its period expired (match_expire_holds), then the branch mutex. Returns the match read after the mutex. MATCH_NOT_FOUND.';

revoke all on function app.match_lock(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. People: eligibility, visibility, names (db.md §4.5.2)
-- ===========================================================================

-- NULL, or the first code the profile fails. p_act: the call takes a seat,
-- asks to join, starts or approves (a banned player can still leave).
create or replace function app.match_eligibility(p_profile_id uuid, p_act boolean) returns text
language plpgsql stable security definer set search_path = public as $match_eligibility_0260$
declare
  v_p profiles%rowtype;
begin
  if p_profile_id is null then
    return 'ACCOUNT_REQUIRED';
  end if;
  select * into v_p from profiles where id = p_profile_id;
  if not found or v_p.deleted_at is not null then
    return 'ACCOUNT_REQUIRED';
  end if;
  if not coalesce(p_act, false) then
    return null;
  end if;
  if nullif(btrim(v_p.phone), '') is null then
    return 'PHONE_REQUIRED';
  end if;
  if not app.match_terms_ok(v_p.terms_version) then
    return 'TERMS_REQUIRED';
  end if;
  if exists (select 1 from customer_flags f where f.customer_id = v_p.id and f.type = 'match_ban') then
    return 'MATCH_BANNED';
  end if;
  -- OM-28: asked once, at the first match, whatever its category.
  if v_p.gender is null then
    return 'GENDER_REQUIRED';
  end if;
  return null;
end $match_eligibility_0260$;

comment on function app.match_eligibility(uuid, boolean) is
  '0260. Internal. NULL, or the first open-match code the profile fails: ACCOUNT_REQUIRED (none, or deleted); only when p_act (taking a seat, asking, starting, approving): PHONE_REQUIRED, TERMS_REQUIRED (app.match_terms_ok), MATCH_BANNED (a match_ban flag), GENDER_REQUIRED (OM-28). Also the REQUESTER_INELIGIBLE detail of an approval (0261).';

revoke all on function app.match_eligibility(uuid, boolean) from public, anon, authenticated;

-- The first statement of every guest RPC (0261). Staff are not exempt.
create or replace function app.match_guest(p_act boolean) returns profiles
language plpgsql stable security definer set search_path = public as $match_guest_0260$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_p    profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  v_code := app.match_eligibility(v_uid, coalesce(p_act, false));
  -- Each code is its own literal raise, so check-error-codes sees every one.
  if v_code = 'ACCOUNT_REQUIRED' then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  elsif v_code = 'PHONE_REQUIRED' then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
  elsif v_code = 'TERMS_REQUIRED' then
    raise exception 'TERMS_REQUIRED' using errcode = 'P0001';
  elsif v_code = 'MATCH_BANNED' then
    raise exception 'MATCH_BANNED' using errcode = 'P0001';
  elsif v_code = 'GENDER_REQUIRED' then
    raise exception 'GENDER_REQUIRED' using errcode = 'P0001';
  elsif v_code is not null then
    raise exception '%', v_code using errcode = 'P0001';
  end if;
  select * into v_p from profiles where id = v_uid;
  return v_p;
end $match_guest_0260$;

comment on function app.match_guest(boolean) is
  '0260. Internal: the first statement of every open-match guest RPC (0261). AUTH_REQUIRED without a session; then the first code app.match_eligibility(auth.uid(), p_act) returns, in its order (ACCOUNT_REQUIRED, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, GENDER_REQUIRED); returns the caller''s profile. p_act is false for leaving, withdrawing, declining, cancelling, messages, reports, blocks and reads.';

revoke all on function app.match_guest(boolean) from public, anon, authenticated;

-- participant | public | token | restricted | NULL (not visible), db.md
-- §4.5.2 in its seven steps.
create or replace function app.match_visibility(m matches, p_viewer uuid, p_gender text, p_token text)
returns text
language plpgsql stable security definer set search_path = public as $match_visibility_0260$
declare
  v_token   boolean := p_token is not null and p_token = m.share_token;
  v_sandbox boolean := false;
  v_people  uuid[];
  v_hidden  boolean := false;
begin
  if m.id is null then
    return null;
  end if;

  -- 1. The organiser, anyone holding a seat in any status (a removed player
  --    too: they see the match as removed), anyone with a request.
  if p_viewer is not null
     and (m.organiser_id = p_viewer
          or exists (select 1 from match_seats s where s.match_id = m.id and s.guest_id = p_viewer)
          or exists (select 1 from match_requests q where q.match_id = m.id and q.guest_id = p_viewer)) then
    return 'participant';
  end if;

  -- 3. DF-19: a sandbox match only for a sandbox profile, and the reverse.
  if p_viewer is not null then
    select coalesce(p.payment_sandbox, false) into v_sandbox from profiles p where p.id = p_viewer;
    v_sandbox := coalesce(v_sandbox, false);
  end if;
  if m.sandbox is distinct from v_sandbox then
    return null;
  end if;

  -- 4. A link match only through its token.
  if not v_token and m.visibility <> 'public' then
    return null;
  end if;

  -- 5. An open branch; without a token also matches on and listable.
  if not (m.venue_id = any (app.open_venue_ids())) then
    return null;
  end if;
  if not v_token then
    if not coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = m.venue_id), false) then
      return null;
    end if;
    if not ((m.status = 'filling' and now() < m.fill_deadline_at)
            or (m.status = 'booked' and now() < m.start_at
                and exists (select 1 from app.match_carriers(m.id) c
                             where c.seat_id is null or c.status = 'left_late'))) then
      return null;
    end if;
  end if;

  -- 6. With a viewer: a ban either side, DF-10 (an unset gender sees both),
  --    a block either way with the organiser or any carrier's holder.
  if p_viewer is not null then
    select array_agg(distinct x.person) into v_people
      from (select m.organiser_id as person
            union all
            select s.guest_id from app.match_carriers(m.id) c join match_seats s on s.id = c.seat_id) x
     where x.person is not null and x.person <> p_viewer;
    v_hidden :=
         exists (select 1 from customer_flags f where f.customer_id = p_viewer and f.type = 'match_ban')
      or (m.category = 'women' and p_gender = 'male')
      or (m.category = 'men' and p_gender = 'female')
      or exists (select 1 from match_blocks b
                  where (b.blocker_id = p_viewer and b.blocked_id = any (coalesce(v_people, '{}'::uuid[])))
                     or (b.blocked_id = p_viewer and b.blocker_id = any (coalesce(v_people, '{}'::uuid[]))))
      or (m.organiser_id is not null
          and exists (select 1 from customer_flags f where f.customer_id = m.organiser_id and f.type = 'match_ban'));
  end if;
  if v_hidden then
    return case when v_token then 'restricted' end;
  end if;

  -- 7.
  return case when v_token then 'token' else 'public' end;
end $match_visibility_0260$;

comment on function app.match_visibility(matches, uuid, text, text) is
  '0260. Internal (db.md §4.5.2). How p_viewer (NULL for anon; p_gender their declared gender) sees match m: participant (organiser, any seat in any status, any request), else NULL for a sandbox mismatch (DF-19), a link match without its token, a branch not open, or (without a token) matches off or not listable (filling before its deadline, or booked with a number open for a guest before start); then restricted with a token / NULL without for a banned viewer, DF-10 (women vs male, men vs female; an unset gender sees both), a block either way with the organiser or a carrier''s holder, or a banned organiser; else token or public. An exclusion hides nothing here: the excluded player holds a removed seat (participant) and still reads the detail (me.excluded); 0261''s lists (open_matches, match_slots) leave the match out and its join refuses.';

revoke all on function app.match_visibility(matches, uuid, text, text) from public, anon, authenticated;

-- The family-name initial other players see (guest.md §4.5 binds the rule).
-- The letter class is explicit, never [[:alpha:]]: that follows the database
-- ctype, and under a C-like ctype every Arabic initial would come back NULL.
create or replace function app.name_initial(p_family text) returns text
language plpgsql immutable security definer set search_path = public as $name_initial_0260$
declare
  -- Latin A-Z, a-z and U+00C0-U+024F without × (U+00D7) and ÷ (U+00F7);
  -- Arabic U+0621-U+063A, U+0641-U+064A, U+0671-U+06D3 (tatweel U+0640 out).
  c_letter constant text :=
    '[A-Za-zÀ-ÖØ-öø-ɏء-غف-يٱ-ۓ]';
  v_s    text := btrim(coalesce(p_family, ''), E' \t\r\n');
  v_rest text;
begin
  if v_s = '' then
    return null;
  end if;
  v_rest := v_s;
  -- One leading article: آل or ال followed by a space, hyphen or tatweel
  -- (آل ياسين -> ياسين); an attached ال with at least two letters left
  -- (الربيعي -> ربيعي; آلاء stays whole); Latin al-/el-, or al/el and a space.
  if v_s ~ '^(آل|ال)[[:space:]ـ-]' then
    v_rest := regexp_replace(v_s, '^(آل|ال)[[:space:]ـ-]+', '');
  elsif v_s ~ ('^ال' || c_letter || c_letter) then
    v_rest := substr(v_s, 3);
  elsif v_s ~* '^(al|el)(-|[[:space:]])' then
    v_rest := regexp_replace(v_s, '^(al|el)(-|[[:space:]])+', '', 'i');
  end if;
  -- An article with nothing after it is the name itself.
  if substring(v_rest from c_letter) is null then
    v_rest := v_s;
  end if;
  return upper(substring(v_rest from c_letter));
end $name_initial_0260$;

comment on function app.name_initial(text) is
  '0260. Internal. The initial of a family name as other open-match players see it: one leading article dropped (آل or ال with a space, hyphen or tatweel; an attached ال with at least two letters left; Latin al-/el- or al/el and a space, any case), then the first letter of an explicit Latin + Arabic class (never [[:alpha:]], which follows the ctype), upper-cased; NULL when there is none. Known limit: a non-article ال (الياس) loses it.';

revoke all on function app.name_initial(text) from public, anon, authenticated;

-- {name, former}: "Ahmed K." / "Ahmed" / null (rendered "Player"); a deleted
-- account is {name: null, former: true} ("Former player", OM-26).
create or replace function app.match_display_name(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $match_display_name_0260$
declare
  v_p     profiles%rowtype;
  v_first text;
  v_init  text;
begin
  if p_profile_id is null then
    return jsonb_build_object('name', null, 'former', false);
  end if;
  select * into v_p from profiles where id = p_profile_id;
  if not found or v_p.deleted_at is not null then
    return jsonb_build_object('name', null, 'former', true);
  end if;
  v_first := nullif(btrim(v_p.given_name), '');
  if v_first is null then
    v_first := nullif((regexp_split_to_array(btrim(coalesce(v_p.full_name, '')), '\s+'))[1], '');
  end if;
  if v_first is null then
    return jsonb_build_object('name', null, 'former', false);
  end if;
  v_init := app.name_initial(v_p.family_name);
  return jsonb_build_object('name', case when v_init is null then v_first else v_first || ' ' || v_init || '.' end,
                            'former', false);
end $match_display_name_0260$;

comment on function app.match_display_name(uuid) is
  '0260. Internal (OM-26). How other players see a profile: {name: "<first> <initial>." or "<first>", former: false}, the first being given_name else the first word of full_name and the initial app.name_initial(family_name); {name: null, former: true} for a deleted (or vanished) account; {name: null, former: false} when there is no name ("Player"). Never a phone, a full name or an id.';

revoke all on function app.match_display_name(uuid) from public, anon, authenticated;

-- One seat as players see it: no phone, guest_id or full_name ever leaves it.
create or replace function app.match_seat_label(s match_seats) returns jsonb
language plpgsql stable security definer set search_path = public as $match_seat_label_0260$
declare
  v_name   jsonb;
  v_holder smallint;
  v_parts  text[];
  v_init   text;
begin
  if s.id is null then
    return null;
  end if;
  if s.kind in ('account', 'friend') or s.guest_id is not null then
    v_name := app.match_display_name(s.guest_id);
  else
    -- A walk-in the desk typed: the same rule over the typed name.
    v_parts := app.split_person_name(s.guest_name);
    if v_parts[1] is null then
      v_name := jsonb_build_object('name', null, 'former', false);
    else
      v_init := app.name_initial(v_parts[2]);
      v_name := jsonb_build_object('name', case when v_init is null then v_parts[1]
                                               else v_parts[1] || ' ' || v_init || '.' end,
                                   'former', false);
    end if;
  end if;
  if s.kind = 'friend' then
    select c.seat_no into v_holder
      from app.match_carriers(s.match_id) c
      join match_seats h on h.id = c.seat_id
     where h.kind = 'account' and h.guest_id = s.guest_id
     limit 1;
  end if;
  return jsonb_build_object('seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind,
                            'name', v_name->'name', 'former', v_name->'former',
                            'holder_seat_no', v_holder);
end $match_seat_label_0260$;

comment on function app.match_seat_label(match_seats) is
  '0260. Internal. A seat as players see it: {seat_id, seat_no, kind, name, former, holder_seat_no}. account: the player''s display name; friend: the holder''s, plus holder_seat_no (the holder''s carrier account seat); a linked desk seat: the customer''s; a typed desk seat: split_person_name(guest_name) under the same rule. No phone, guest_id or full_name.';

revoke all on function app.match_seat_label(match_seats) from public, anon, authenticated;

-- ===========================================================================
-- 3. Courts, carriers, booking (db.md §4.5.3)
-- ===========================================================================

-- DF-3: the twin of core splitEvenly(price, 4) (packages/core/src/money/split.ts):
-- floor(p/4) each, plus 1 on the first p % 4 seats. A test pins the parity.
create or replace function app.match_shares(p_price bigint) returns bigint[]
language plpgsql immutable security definer set search_path = public as $match_shares_0260$
begin
  if p_price is null then
    return null;
  end if;
  if p_price < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_price';
  end if;
  return array[p_price / 4 + case when p_price % 4 >= 1 then 1 else 0 end,
               p_price / 4 + case when p_price % 4 >= 2 then 1 else 0 end,
               p_price / 4 + case when p_price % 4 >= 3 then 1 else 0 end,
               p_price / 4]::bigint[];
end $match_shares_0260$;

comment on function app.match_shares(bigint) is
  '0260. Internal (DF-3). The four seat shares of a match price: floor(p/4) each, plus 1 on the first p % 4 seats (largest first, sum = p). The twin of core splitEvenly(p, 4); tests/match-core.test.ts pins the parity.';

revoke all on function app.match_shares(bigint) from public, anon, authenticated;

-- At least p_need active courts offering the length with no FIRM row over the
-- period. Firm = a live booking or maintenance; a hold is live but not firm
-- (R22). Callers evaluate it in a statement after taking the mutex.
create or replace function app.match_court_free_firm(p_venue uuid, p_period tstzrange, p_duration_min int,
                                                     p_need int default 1)
returns boolean
language sql stable security definer set search_path = public as $match_court_free_firm_0260$
  select count(*) >= coalesce(p_need, 1)
    from courts c
   where c.venue_id = p_venue
     and c.is_active
     and p_duration_min = any (c.duration_options)
     and not exists (select 1 from reservations r
                      where r.court_id = c.id
                        and r.kind in ('booking', 'maintenance')
                        and r.status in ('pending', 'confirmed', 'arrived')
                        and r.period && p_period)
$match_court_free_firm_0260$;

comment on function app.match_court_free_firm(uuid, tstzrange, int, int) is
  '0260. Internal. True when at least p_need active courts of the branch offer p_duration_min and have no firm row (a live booking or maintenance; a hold is not firm, R22) overlapping p_period. OM-42 (start), the booking decision and the bump test read it.';

revoke all on function app.match_court_free_firm(uuid, tstzrange, int, int) from public, anon, authenticated;

-- The court to book at the fourth seat: no LIVE row (holds included) over the
-- period; the tapped court first, then courts at the stamped price, then by
-- price, sort order and id. The caller holds every court lock and has
-- expired stale holds.
create or replace function app.match_pick_court(m matches) returns uuid
language sql stable security definer set search_path = public as $match_pick_court_0260$
  select c.id
    from courts c
    left join lateral (select ps.price_iqd
                         from app.price_slot(c.id, m.start_at, m.duration_min) ps
                        limit 1) p on true
   where c.venue_id = m.venue_id
     and c.is_active
     and m.duration_min = any (c.duration_options)
     and not exists (select 1 from reservations r
                      where r.court_id = c.id
                        and r.status in ('pending', 'confirmed', 'arrived')
                        and r.period && m.period)
   order by (c.id = m.price_court_id) desc,
            (p.price_iqd = m.price_iqd) desc nulls last,
            p.price_iqd nulls last,
            c.sort_order,
            c.id
   limit 1
$match_pick_court_0260$;

comment on function app.match_pick_court(matches) is
  '0260. Internal. The court a match books at its fourth seat: an active court of the branch offering the length with no live row (holds included) over the period, the tapped court (price_court_id) first, then courts whose price_slot equals the stamped price, then that price ascending (nulls last), sort_order, id. NULL when none.';

revoke all on function app.match_pick_court(matches) from public, anon, authenticated;

-- R4, R21: the one carrier rule, read by DB and by Money (0262). The carrier
-- of a number is its seat in, attended, no_show or left_late that no other
-- such seat replaces; a number with no carrier is vacant (seat_id NULL).
create or replace function app.match_carriers(p_match_id uuid)
returns table (seat_no smallint, seat_id uuid, status text)
language sql stable security definer set search_path = public as $match_carriers_0260$
  select n.num::smallint, c.id, c.status
    from generate_series(1, 4) as n(num)
    left join lateral (
      select s.id, s.status
        from match_seats s
       where s.match_id = p_match_id
         and s.seat_no = n.num
         and s.status in ('in', 'attended', 'no_show', 'left_late')
         and not exists (select 1 from match_seats x
                          where x.replaces_seat_id = s.id
                            and x.status in ('in', 'attended', 'no_show', 'left_late'))
       order by s.joined_at desc, s.id desc
       limit 1) c on true
   order by n.num
$match_carriers_0260$;

comment on function app.match_carriers(uuid) is
  '0260. Internal (R4, R21): the one carrier rule, read by DB and Money. Four rows, one per seat number: the seat in, attended, no_show or left_late that no other such seat replaces (replaces_seat_id), or seat_id NULL when the number is vacant. A replaced no_show carries nothing; a left_late seat carries until refilled.';

revoke all on function app.match_carriers(uuid) from public, anon, authenticated;

-- The attendance marks window, and Money's "a forfeited ticket could still be
-- restored" (R13): one definition.
create or replace function app.match_marks_open(p_match_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $match_marks_open_0260$
declare
  v_match matches%rowtype;
  v_day   date;
begin
  select * into v_match from matches where id = p_match_id;
  if not found or v_match.sandbox or v_match.status not in ('booked', 'played', 'no_show') then
    return false;
  end if;
  v_day := app.venue_business_date(v_match.venue_id, v_match.start_at);
  if exists (select 1 from day_sessions ds
              where ds.venue_id = v_match.venue_id and ds.business_date = v_day
                and ds.status in ('closing', 'closed')) then
    return false;
  end if;
  if v_day < app.venue_business_date(v_match.venue_id, now())
     and not exists (select 1 from day_sessions ds
                      where ds.venue_id = v_match.venue_id and ds.business_date = v_day
                        and ds.status = 'open') then
    return false;
  end if;
  return true;
end $match_marks_open_0260$;

comment on function app.match_marks_open(uuid) is
  '0260. Internal (R13). True while the desk may still mark or correct a match''s seats: the match is booked, played or no_show, not sandbox, and the business day of its start is not closing or closed (and, when that day is past, still has an open session). Also Money''s "a forfeited ticket is still restorable" test (cash-out and DF-20 wait on it) and ticket_restore''s window.';

revoke all on function app.match_marks_open(uuid) from public, anon, authenticated;

-- R18 (C5): the seats and requests of deleted and banned players leave a
-- filling or waiting match. The caller holds the branch mutex.
create or replace function app.match_drop_ineligible(p_match_id uuid) returns int
language plpgsql security definer set search_path = public as $match_drop_ineligible_0260$
declare
  v_match   matches%rowtype;
  v_holder  record;
  v_req     record;
  v_code    text;
  v_seats   uuid[];
  v_tickets uuid[];
  v_paired  uuid[];
  v_n       int := 0;
begin
  select * into v_match from matches where id = p_match_id;
  if not found or v_match.status not in ('filling', 'awaiting_court') then
    return 0;
  end if;
  perform set_config('app.venue_id', v_match.venue_id::text, true);

  for v_holder in
    select s.guest_id, bool_or(p.deleted_at is not null) as deleted
      from match_seats s
      join profiles p on p.id = s.guest_id
     where s.match_id = v_match.id and s.status = 'in'
       and (p.deleted_at is not null
            or exists (select 1 from customer_flags f where f.customer_id = s.guest_id and f.type = 'match_ban'))
     group by s.guest_id
     order by s.guest_id
  loop
    v_code := case when v_holder.deleted then 'account_deleted' else 'banned' end;
    select array_agg(s.id order by (s.kind = 'account') desc, s.seat_no, s.id),
           array_agg(s.ticket_id order by s.seat_no, s.id) filter (where s.ticket_id is not null),
           array_agg(s.id order by s.seat_no, s.id) filter (where s.ticket_id is not null)
      into v_seats, v_tickets, v_paired
      from match_seats s
     where s.match_id = v_match.id and s.status = 'in' and s.guest_id = v_holder.guest_id;
    perform app.ticket_release(v_tickets, v_code, v_paired);
    update match_seats
       set status     = case when v_holder.deleted then 'left' else 'removed' end,
           ended_at   = now(),
           end_reason = v_code
     where id = any (v_seats);
    perform app.match_event(v_match.id, v_match.venue_id,
                            case when v_holder.deleted then 'left' else 'removed' end, 'system',
                            v_seats[1], null, v_code,
                            jsonb_build_object('seats', to_jsonb(v_seats),
                                               'seats_taken', (select count(*) from app.match_carriers(v_match.id) c
                                                                where c.seat_id is not null)));
    v_n := v_n + cardinality(v_seats);
  end loop;

  for v_req in
    select q.id, (p.deleted_at is not null) as deleted
      from match_requests q
      join profiles p on p.id = q.guest_id
     where q.match_id = v_match.id and q.status = 'pending'
       and (p.deleted_at is not null
            or exists (select 1 from customer_flags f where f.customer_id = q.guest_id and f.type = 'match_ban'))
     order by q.id
  loop
    v_code := case when v_req.deleted then 'account_deleted' else 'banned' end;
    select array_agg(k.id order by k.id) into v_tickets
      from match_tickets k where k.request_id = v_req.id and k.status = 'reserved';
    perform app.ticket_release(v_tickets, v_code, null, v_req.id);
    update match_requests
       set status = case when v_req.deleted then 'withdrawn' else 'expired' end,
           decided_at = now()
     where id = v_req.id;
    perform app.match_event(v_match.id, v_match.venue_id,
                            case when v_req.deleted then 'withdrawn' else 'request_expired' end, 'system',
                            null, v_req.id, v_code, '{}'::jsonb);
  end loop;

  if v_n > 0 then
    perform app.match_recompute_organiser(v_match.id);
  end if;
  return v_n;
end $match_drop_ineligible_0260$;

comment on function app.match_drop_ineligible(uuid) is
  '0260. Internal (R18, C5; caller holds the branch mutex; filling or awaiting_court only). Every in seat of a deleted holder -> left (account_deleted), of a banned one -> removed (banned), their tickets released with that code, one left/removed event per holder; their pending requests -> withdrawn (deleted) or expired (banned), tickets released; then match_recompute_organiser. Returns the seats dropped.';

revoke all on function app.match_drop_ineligible(uuid) from public, anon, authenticated;

-- The fourth seat (db.md §4.5.3, steps 1-12). The caller holds L2
-- (match_lock), or is the sweep on a locked branch. Returns the status.
create or replace function app.match_try_book(p_match_id uuid) returns text
language plpgsql security definer set search_path = public as $match_try_book_0260$
declare
  v_match   matches%rowtype;
  v_waiting record;
  v_req     record;
  v_n       int;
  v_court   uuid;
  v_res     uuid;
  v_try     int;
  v_tickets uuid[];
  v_status  text;
begin
  -- 1.
  select * into v_match from matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_match.status not in ('filling', 'awaiting_court') then
    return v_match.status;
  end if;
  perform set_config('app.venue_id', v_match.venue_id::text, true);

  -- 2. R18: deleted and banned holders never count towards four.
  perform app.match_drop_ineligible(v_match.id);
  select * into v_match from matches where id = p_match_id;
  if v_match.status not in ('filling', 'awaiting_court') then
    return v_match.status;
  end if;

  -- 3.
  select count(*) into v_n from app.match_carriers(v_match.id) c where c.seat_id is not null;
  if v_n < 4 then
    if v_match.status = 'awaiting_court' then
      update matches set status = 'filling', updated_at = now() where id = v_match.id;
      return 'filling';
    end if;
    return v_match.status;
  end if;

  -- 4. The sweep ends a waiting match at its start.
  if now() >= v_match.start_at then
    return v_match.status;
  end if;

  if v_match.sandbox then
    -- 5. DF-19: a sandbox match never books a court.
    update matches set status = 'booked', updated_at = now() where id = v_match.id;
    perform app.match_event(v_match.id, v_match.venue_id, 'booked', 'system', null, null, null, '{}'::jsonb);
  else
    -- 6. R22: a waiting match is owed its court before a newer one books.
    if v_match.status = 'filling' then
      for v_waiting in
        select x.id from matches x
         where x.venue_id = v_match.venue_id and x.id <> v_match.id and x.status = 'awaiting_court'
           and not x.sandbox and x.period && v_match.period
         order by x.updated_at, x.id
      loop
        perform app.match_try_book(v_waiting.id);
      end loop;
    end if;

    -- 7. The branch still trades then.
    if not (v_match.venue_id = any (app.open_venue_ids())) then
      perform app.match_end(v_match.id, 'cancelled', 'venue_closed', 'system');
      return 'cancelled';
    end if;
    begin
      perform app.assert_bookable(v_match.price_court_id, v_match.start_at, v_match.end_at);
    exception when sqlstate 'P0001' then
      if sqlerrm in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
        perform app.match_end(v_match.id, 'cancelled', 'venue_closed', 'system');
        return 'cancelled';
      end if;
      raise;
    end;

    -- 8. Book the picked court at the stamped price (DF-3). The GUC keeps the
    --    reservation trigger (0263) from judging this match against its own
    --    row. An exclusion violation can only come from a writer that skips
    --    the court lock (an event block) and has just committed: pick again
    --    once, then SLOT_TAKEN.
    for v_try in 1 .. 2 loop
      v_court := app.match_pick_court(v_match);
      exit when v_court is null;
      begin
        perform set_config('app.match_booking', v_match.id::text, true);
        insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name,
                                  source, rate_rule_id, price_iqd, created_by_staff_id)
        values (v_match.venue_id, v_court, 'booking', 'confirmed', v_match.start_at, v_match.end_at, null,
                'Open match',
                (case when v_match.organised_by = 'desk' then 'desk' else 'mobile' end)::reservation_source,
                v_match.rate_rule_id, v_match.price_iqd, v_match.created_by_staff_id)
        returning id into v_res;
        perform set_config('app.match_booking', '', true);
        exit;
      exception when exclusion_violation then
        perform set_config('app.match_booking', '', true);
        v_res := null;
        if v_try = 2 then
          raise exception 'SLOT_TAKEN' using errcode = 'P0001';
        end if;
      end;
    end loop;

    if v_res is not null then
      update matches set status = 'booked', reservation_id = v_res, updated_at = now() where id = v_match.id;
      perform app.match_event(v_match.id, v_match.venue_id, 'booked', 'system', null, null, null,
                              jsonb_build_object('reservation_id', v_res, 'court_id', v_court));
    elsif app.match_court_free_firm(v_match.venue_id, v_match.period, v_match.duration_min, 1) then
      -- 9. DF-18: only holds stand in the way.
      if v_match.status = 'filling' then
        update matches set status = 'awaiting_court', updated_at = now() where id = v_match.id;
        perform app.match_event(v_match.id, v_match.venue_id, 'awaiting_court', 'system', null, null, null,
                                '{}'::jsonb);
      end if;
    else
      -- 10.
      perform app.match_end(v_match.id, 'bumped', 'bumped', 'system');
      return 'bumped';
    end if;
  end if;

  -- 11. Booked or waiting: nobody else can be approved in.
  for v_req in
    select q.id from match_requests q where q.match_id = v_match.id and q.status = 'pending' order by q.id
  loop
    select array_agg(k.id order by k.id) into v_tickets
      from match_tickets k where k.request_id = v_req.id and k.status = 'reserved';
    perform app.ticket_release(v_tickets, 'match_full', null, v_req.id);
    update match_requests set status = 'expired', decided_at = now() where id = v_req.id;
    perform app.match_event(v_match.id, v_match.venue_id, 'request_expired', 'system', null, v_req.id,
                            'match_full', '{}'::jsonb);
  end loop;

  -- 12.
  select mt.status into v_status from matches mt where mt.id = v_match.id;
  return v_status;
end $match_try_book_0260$;

comment on function app.match_try_book(uuid) is
  '0260. Internal (db.md §4.5.3; caller holds L2 or is the sweep on a locked branch). A filling or waiting match: drops deleted and banned holders (R18); under four carriers a waiting match goes back to filling; at four before the start: sandbox -> booked with no court; else waiting matches of the branch over the same time are served first (R22), a closed branch or date cancels it (venue_closed), then the picked court is booked at the stamped price (''Open match'', guest_id NULL, confirmed) -> booked; only holds in the way -> awaiting_court (DF-18); no firm-free court -> bumped. Booked or waiting: pending requests expire (match_full). Returns the status. SLOT_TAKEN after a second exclusion violation.';

revoke all on function app.match_try_book(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 4. Tickets (db.md §4.5.4). Every helper writes one match_ticket_events row
--    per ticket it moves and asserts, before it moves anything, that the
--    ticket belongs to the seat or request it moves (R17): a mismatch is
--    skipped and not counted.
-- ===========================================================================

-- Pick before the seats are inserted, so match_seats_kind can require
-- ticket_id. One id-ordered locking statement (db.md §2.4).
create or replace function app.ticket_pick(p_guest_id uuid, p_count int, p_sandbox boolean,
                                           p_request_id uuid default null)
returns uuid[]
language plpgsql security definer set search_path = public as $ticket_pick_0260$
declare
  v_ids uuid[];
  v_k   int;
begin
  if p_guest_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_id';
  end if;

  -- An approval: every ticket its own request reserved.
  if p_request_id is not null then
    select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_ids
      from (select k.id from match_tickets k
             where k.request_id = p_request_id and k.status = 'reserved' and k.guest_id = p_guest_id
             order by k.id
             for update) x;
    return v_ids;
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_count';
  end if;
  -- Every available ticket of the guest in this sandbox (DF-19), locked in id
  -- order; the oldest p_count by (created_at, id) are handed back.
  select coalesce(array_agg(x.id order by x.created_at, x.id), '{}'::uuid[]) into v_ids
    from (select k.id, k.created_at from match_tickets k
           where k.guest_id = p_guest_id and k.status = 'available' and k.sandbox = coalesce(p_sandbox, false)
           order by k.id
           for update) x;
  v_k := cardinality(v_ids);
  if v_k < p_count then
    raise exception 'NEED_TICKETS' using errcode = 'P0001',
      detail = format('{"needed":%s,"available":%s,"buy":%s}', p_count, v_k, p_count - v_k);
  end if;
  return v_ids[1:p_count];
end $ticket_pick_0260$;

comment on function app.ticket_pick(uuid, int, boolean, uuid) is
  '0260. Internal. Without a request: locks (one id-ordered statement) the guest''s available tickets of sandbox p_sandbox and returns the p_count oldest; fewer -> NEED_TICKETS, detail {"needed","available","buy"}. With p_request_id: that request''s reserved tickets of the guest (all), locked in id order. Moves nothing: ticket_lock does.';

revoke all on function app.ticket_pick(uuid, int, boolean, uuid) from public, anon, authenticated;

-- With seats (pairwise): available, or reserved for p_request_id only (R17),
-- -> in_use on its seat. With only a request: available -> reserved.
create or replace function app.ticket_lock(p_ticket_ids uuid[], p_seat_ids uuid[] default null,
                                           p_request_id uuid default null)
returns int
language plpgsql security definer set search_path = public as $ticket_lock_0260$
declare
  v_staff     uuid := (select st.id from staff st where st.id = auth.uid());
  v_n         int := 0;
  v_i         int;
  v_t         match_tickets%rowtype;
  v_s_id      uuid;
  v_s_guest   uuid;
  v_s_ticket  uuid;
  v_s_match   uuid;
  v_s_venue   uuid;
  v_s_sandbox boolean;
  v_q_id      uuid;
  v_q_guest   uuid;
  v_q_match   uuid;
  v_q_venue   uuid;
  v_q_sandbox boolean;
  v_q_status  text;
begin
  if coalesce(cardinality(p_ticket_ids), 0) = 0 then
    return 0;
  end if;
  if p_seat_ids is null and p_request_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;
  if p_seat_ids is not null and cardinality(p_seat_ids) <> cardinality(p_ticket_ids) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;

  perform 1 from match_tickets where id = any (p_ticket_ids) order by id for update;

  if p_request_id is not null then
    select q.id, q.guest_id, q.match_id, mt.venue_id, mt.sandbox, q.status
      into v_q_id, v_q_guest, v_q_match, v_q_venue, v_q_sandbox, v_q_status
      from match_requests q join matches mt on mt.id = q.match_id
     where q.id = p_request_id;
  end if;

  for v_i in 1 .. cardinality(p_ticket_ids) loop
    select * into v_t from match_tickets where id = p_ticket_ids[v_i];
    continue when not found;

    if p_seat_ids is not null then
      select s.id, s.guest_id, s.ticket_id, s.match_id, s.venue_id, mt.sandbox
        into v_s_id, v_s_guest, v_s_ticket, v_s_match, v_s_venue, v_s_sandbox
        from match_seats s join matches mt on mt.id = s.match_id
       where s.id = p_seat_ids[v_i];
      -- R17: the seat is the ticket's holder's and names this ticket.
      continue when v_s_id is null
                 or v_s_guest is distinct from v_t.guest_id
                 or v_s_ticket is distinct from v_t.id
                 or v_s_sandbox is distinct from v_t.sandbox;
      if v_t.status = 'in_use' and v_t.seat_id = v_s_id then
        v_n := v_n + 1;                      -- already there
      elsif v_t.status = 'available'
            or (v_t.status = 'reserved' and v_q_id is not null and v_t.request_id = v_q_id) then
        update match_tickets
           set status = 'in_use', seat_id = v_s_id, request_id = null, updated_at = now()
         where id = v_t.id;
        insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, request_id,
                                         actor_staff_id)
        values (v_t.id, v_t.guest_id, 'locked', v_s_venue, v_s_match, v_s_id, v_t.request_id, v_staff);
        v_n := v_n + 1;
      end if;
    else
      continue when v_q_id is null
                 or v_q_status <> 'pending'
                 or v_t.guest_id is distinct from v_q_guest
                 or v_t.sandbox is distinct from v_q_sandbox;
      if v_t.status = 'reserved' and v_t.request_id = v_q_id then
        v_n := v_n + 1;                      -- already there
      elsif v_t.status = 'available' then
        update match_tickets set status = 'reserved', request_id = v_q_id, updated_at = now() where id = v_t.id;
        insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, request_id, actor_staff_id)
        values (v_t.id, v_t.guest_id, 'reserved', v_q_venue, v_q_match, v_q_id, v_staff);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $ticket_lock_0260$;

comment on function app.ticket_lock(uuid[], uuid[], uuid) is
  '0260. Internal (R17). Locks the tickets in id order. With p_seat_ids (paired by position): a ticket available, or reserved for p_request_id only, moves to in_use on its seat when the seat is its holder''s, names that ticket and has its sandbox (event locked). With only p_request_id: an available ticket of the requester, same sandbox, moves to reserved for that pending request (event reserved). A mismatch is skipped. Returns how many tickets are now in the asked state (moved, or already there); a caller that gets fewer raises. INVALID_ARGUMENT without a pairing or with arrays of different lengths.';

revoke all on function app.ticket_lock(uuid[], uuid[], uuid) from public, anon, authenticated;

-- Back to available: only in_use on its paired seat, or reserved for
-- p_request_id. Anything else is skipped, so it is idempotent.
create or replace function app.ticket_release(p_ticket_ids uuid[], p_code text, p_seat_ids uuid[] default null,
                                              p_request_id uuid default null)
returns int
language plpgsql security definer set search_path = public as $ticket_release_0260$
declare
  v_staff    uuid := (select st.id from staff st where st.id = auth.uid());
  v_n        int := 0;
  v_i        int;
  v_t        match_tickets%rowtype;
  v_s_id     uuid;
  v_s_guest  uuid;
  v_s_match  uuid;
  v_s_venue  uuid;
  v_q_id     uuid;
  v_q_guest  uuid;
  v_q_match  uuid;
  v_q_venue  uuid;
begin
  if coalesce(cardinality(p_ticket_ids), 0) = 0 then
    return 0;
  end if;
  if p_seat_ids is null and p_request_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;
  if p_seat_ids is not null and cardinality(p_seat_ids) <> cardinality(p_ticket_ids) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;

  perform 1 from match_tickets where id = any (p_ticket_ids) order by id for update;

  if p_request_id is not null then
    select q.id, q.guest_id, q.match_id, mt.venue_id
      into v_q_id, v_q_guest, v_q_match, v_q_venue
      from match_requests q join matches mt on mt.id = q.match_id
     where q.id = p_request_id;
  end if;

  for v_i in 1 .. cardinality(p_ticket_ids) loop
    select * into v_t from match_tickets where id = p_ticket_ids[v_i];
    continue when not found;

    v_s_id := null;
    if p_seat_ids is not null and v_t.status = 'in_use' and v_t.seat_id = p_seat_ids[v_i] then
      select s.id, s.guest_id, s.match_id, s.venue_id into v_s_id, v_s_guest, v_s_match, v_s_venue
        from match_seats s where s.id = p_seat_ids[v_i];
    end if;

    if v_s_id is not null and v_s_guest = v_t.guest_id then
      update match_tickets set status = 'available', seat_id = null, updated_at = now() where id = v_t.id;
      insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, actor_staff_id, code)
      values (v_t.id, v_t.guest_id, 'released', v_s_venue, v_s_match, v_s_id, v_staff, p_code);
      v_n := v_n + 1;
    elsif v_q_id is not null and v_t.status = 'reserved' and v_t.request_id = v_q_id
          and v_t.guest_id = v_q_guest then
      update match_tickets set status = 'available', request_id = null, updated_at = now() where id = v_t.id;
      insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, request_id, actor_staff_id,
                                       code)
      values (v_t.id, v_t.guest_id, 'released', v_q_venue, v_q_match, v_q_id, v_staff, p_code);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $ticket_release_0260$;

comment on function app.ticket_release(uuid[], text, uuid[], uuid) is
  '0260. Internal (R17; was (uuid[], text) in the first contract). Moves to available only a ticket in_use on its paired seat (p_seat_ids by position, the seat its holder''s) or reserved for p_request_id (the requester''s); clears seat_id/request_id; event released with p_code (why). Anything else is skipped, so it is idempotent. One of the pairings is required (INVALID_ARGUMENT). Returns how many moved.';

revoke all on function app.ticket_release(uuid[], text, uuid[], uuid) from public, anon, authenticated;

-- A no-show, or an unrefilled late leave at the start. R18: a deleted owner's
-- ticket is released instead and never forfeited.
create or replace function app.ticket_forfeit(p_ticket_id uuid, p_seat_id uuid) returns boolean
language plpgsql security definer set search_path = public as $ticket_forfeit_0260$
declare
  v_staff    uuid := (select st.id from staff st where st.id = auth.uid());
  v_t        match_tickets%rowtype;
  v_s_id     uuid;
  v_s_guest  uuid;
  v_s_ticket uuid;
  v_s_match  uuid;
  v_s_venue  uuid;
  v_s_status text;
  v_deleted  boolean;
begin
  select * into v_t from match_tickets where id = p_ticket_id for update;
  if not found then
    return false;
  end if;
  select s.id, s.guest_id, s.ticket_id, s.match_id, s.venue_id, s.status
    into v_s_id, v_s_guest, v_s_ticket, v_s_match, v_s_venue, v_s_status
    from match_seats s where s.id = p_seat_id;
  -- R17: the seat is the ticket's holder's and names this ticket.
  if v_s_id is null or v_s_ticket is distinct from v_t.id or v_s_guest is distinct from v_t.guest_id then
    return false;
  end if;
  if v_t.status = 'forfeited' then
    return v_t.forfeited_seat_id = p_seat_id;
  end if;

  select p.deleted_at is not null into v_deleted from profiles p where p.id = v_t.guest_id;
  if coalesce(v_deleted, true) then
    perform app.ticket_release(array[v_t.id], 'account_deleted', array[p_seat_id]);
    return false;
  end if;

  -- In use on this seat, or (the attended -> no_show correction) this seat's
  -- own ticket back in the wallet.
  if (v_t.status = 'in_use' and v_t.seat_id = p_seat_id) or v_t.status = 'available' then
    update match_tickets
       set status             = 'forfeited',
           seat_id            = null,
           forfeited_at       = now(),
           forfeited_venue_id = v_s_venue,
           forfeited_seat_id  = p_seat_id,
           updated_at         = now()
     where id = v_t.id;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, actor_staff_id, code)
    values (v_t.id, v_t.guest_id, 'forfeited', v_s_venue, v_s_match, p_seat_id, v_staff,
            case when v_s_status = 'left_late' then 'late_leave' else 'no_show' end);
    return true;
  end if;
  return false;
end $ticket_forfeit_0260$;

comment on function app.ticket_forfeit(uuid, uuid) is
  '0260. Internal (R17, R18). Forfeits the ticket of seat p_seat_id: in_use on that seat, or available when it is that seat''s ticket (the attended -> no_show correction); stamps forfeited_at, forfeited_venue_id (the seat''s branch, the revenue''s) and forfeited_seat_id; event forfeited (code no_show, or late_leave for a left_late seat). True when forfeited by that seat (already, or now). A deleted owner''s ticket is released instead (code account_deleted) and false returned; reserved, in use elsewhere, cashed out or a seat that does not name the ticket -> false.';

revoke all on function app.ticket_forfeit(uuid, uuid) from public, anon, authenticated;

-- Undo a forfeit, only while the seat's match marks are open (R13, C4).
create or replace function app.ticket_restore(p_ticket_id uuid, p_seat_id uuid, p_relock boolean default false)
returns boolean
language plpgsql security definer set search_path = public as $ticket_restore_0260$
declare
  v_staff    uuid := (select st.id from staff st where st.id = auth.uid());
  v_relock   boolean := coalesce(p_relock, false);
  v_t        match_tickets%rowtype;
  v_s_id     uuid;
  v_s_guest  uuid;
  v_s_ticket uuid;
  v_s_match  uuid;
  v_s_venue  uuid;
begin
  select * into v_t from match_tickets where id = p_ticket_id for update;
  if not found or v_t.status <> 'forfeited' or v_t.forfeited_seat_id is distinct from p_seat_id then
    return false;
  end if;
  select s.id, s.guest_id, s.ticket_id, s.match_id, s.venue_id
    into v_s_id, v_s_guest, v_s_ticket, v_s_match, v_s_venue
    from match_seats s where s.id = p_seat_id;
  if v_s_id is null or v_s_ticket is distinct from v_t.id or v_s_guest is distinct from v_t.guest_id then
    return false;
  end if;
  if not app.match_marks_open(v_s_match) then
    return false;
  end if;
  update match_tickets
     set status             = case when v_relock then 'in_use' else 'available' end,
         seat_id            = case when v_relock then p_seat_id end,
         forfeited_at       = null,
         forfeited_venue_id = null,
         forfeited_seat_id  = null,
         updated_at         = now()
   where id = v_t.id;
  insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, actor_staff_id, code)
  values (v_t.id, v_t.guest_id, 'restored', v_s_venue, v_s_match, p_seat_id, v_staff,
          case when v_relock then 'relocked' end);
  return true;
end $ticket_restore_0260$;

comment on function app.ticket_restore(uuid, uuid, boolean) is
  '0260. Internal (R13, R17). Gives back a ticket forfeited by seat p_seat_id (the seat names it and is its holder''s), only while app.match_marks_open of that seat''s match: to in_use on that seat with p_relock (the undo of a no-show), else available; clears the three forfeit columns; event restored. Else false and the ticket stays forfeited.';

revoke all on function app.ticket_restore(uuid, uuid, boolean) from public, anon, authenticated;

-- ===========================================================================
-- 5. Ending, organiser, events, counts (db.md §4.5.5)
-- ===========================================================================

-- One match_events row. 'staff' without a staff caller, or 'guest' without a
-- profile caller, degrades to 'system' (a service path must not trip
-- match_events_actor).
create or replace function app.match_event(p_match_id uuid, p_venue_id uuid, p_type text, p_actor text,
                                           p_seat_id uuid default null, p_request_id uuid default null,
                                           p_code text default null, p_data jsonb default '{}')
returns bigint
language plpgsql security definer set search_path = public as $match_event_0260$
declare
  v_uid   uuid := auth.uid();
  v_actor text := p_actor;
  v_guest uuid;
  v_staff uuid;
  v_venue uuid := p_venue_id;
  v_id    bigint;
begin
  if v_venue is null then
    select mt.venue_id into v_venue from matches mt where mt.id = p_match_id;
  end if;
  if v_actor = 'staff' then
    if v_uid is not null and exists (select 1 from staff st where st.id = v_uid) then
      v_staff := v_uid;
    else
      v_actor := 'system';
    end if;
  elsif v_actor = 'guest' then
    if v_uid is not null and exists (select 1 from profiles p where p.id = v_uid) then
      v_guest := v_uid;
    else
      v_actor := 'system';
    end if;
  elsif v_actor is distinct from 'system' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_actor';
  end if;
  if v_venue is not null then
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  insert into match_events (venue_id, match_id, type, actor, actor_guest_id, actor_staff_id, seat_id, request_id,
                            code, data)
  values (v_venue, p_match_id, p_type, v_actor, v_guest, v_staff, p_seat_id, p_request_id, p_code,
          coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $match_event_0260$;

comment on function app.match_event(uuid, uuid, text, text, uuid, uuid, text, jsonb) is
  '0260. Internal. Writes one match_events row (Guest''s push fan-out, 0261, reads them): actor guest/staff/system with its id from auth.uid(); staff without a staff caller or guest without a profile caller becomes system. p_venue_id NULL takes the match''s branch. data carries ids and counts only. Returns the event id.';

revoke all on function app.match_event(uuid, uuid, text, text, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- The one place that finishes seats, tickets and requests for a terminal
-- status (db.md §4.5.5, D-4). The caller holds the branch mutex.
create or replace function app.match_end(p_match_id uuid, p_status text, p_reason text, p_actor text)
returns boolean
language plpgsql security definer set search_path = public as $match_end_0260$
declare
  v_match   matches%rowtype;
  v_seat    record;
  v_req     record;
  v_seats   uuid[] := '{}'::uuid[];
  v_tickets uuid[];
  v_paired  uuid[];
  v_code    text := coalesce(p_reason, 'match_ended');
  v_staff   uuid := (select st.id from staff st where st.id = auth.uid());
begin
  select * into v_match from matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_match.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired') then
    return false;
  end if;
  if p_actor is null or p_actor not in ('guest', 'staff', 'system') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_actor';
  end if;
  if not ((v_match.status in ('filling', 'awaiting_court')
           and ((p_status = 'cancelled' and p_reason in ('organiser_cancelled', 'staff_cancelled', 'empty',
                                                         'venue_closed'))
                or (p_status = 'bumped' and p_reason in ('bumped', 'no_court'))
                or (p_status = 'expired' and p_reason in ('deadline', 'no_court'))))
       or (v_match.status = 'booked'
           and ((p_status = 'cancelled' and p_reason in ('reservation_cancelled', 'called_off_short'))
                or (p_status = 'played' and p_reason is null)
                or (p_status = 'no_show' and p_reason = 'all_no_show')))) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s (%s)', v_match.status, p_status, coalesce(p_reason, '-'));
  end if;
  perform set_config('app.venue_id', v_match.venue_id::text, true);

  -- Every ticket this call can move, in one id-ordered statement (db.md §2.4).
  perform 1 from match_tickets k
   where k.id in (select s.ticket_id from match_seats s
                   where s.match_id = v_match.id and s.status in ('in', 'no_show', 'left_late')
                     and s.ticket_id is not null
                  union all
                  select k2.id from match_tickets k2 join match_requests q on q.id = k2.request_id
                   where q.match_id = v_match.id and q.status = 'pending' and k2.status = 'reserved')
   order by k.id
   for update;

  if v_match.status in ('filling', 'awaiting_court') then
    -- Unplayed: every seat still in is cancelled, its ticket back (code = reason).
    select coalesce(array_agg(s.id order by s.seat_no, s.id), '{}'::uuid[]),
           array_agg(s.ticket_id order by s.seat_no, s.id) filter (where s.ticket_id is not null),
           array_agg(s.id order by s.seat_no, s.id) filter (where s.ticket_id is not null)
      into v_seats, v_tickets, v_paired
      from match_seats s where s.match_id = v_match.id and s.status = 'in';
    perform app.ticket_release(v_tickets, p_reason, v_paired);
    update match_seats set status = 'cancelled', ended_at = now(), end_reason = 'match_ended'
     where id = any (v_seats);

  elsif p_reason = 'reservation_cancelled' then
    -- The venue cancelled: nobody loses a ticket inside the marks window.
    for v_seat in
      select s.id, s.status, s.ticket_id from match_seats s
       where s.match_id = v_match.id and s.status in ('in', 'attended', 'no_show', 'left_late')
       order by s.seat_no, s.joined_at, s.id
    loop
      if v_seat.ticket_id is not null then
        if v_seat.status in ('in', 'left_late') then
          perform app.ticket_release(array[v_seat.ticket_id], p_reason, array[v_seat.id]);
        end if;
        if v_seat.status in ('no_show', 'left_late') then
          perform app.ticket_restore(v_seat.ticket_id, v_seat.id, false);
        end if;
      end if;
      v_seats := v_seats || v_seat.id;
    end loop;
    update match_seats set status = 'cancelled', ended_at = now(), end_reason = 'match_ended'
     where id = any (v_seats);

  else
    if p_status = 'played' then
      -- R37: every carrier still in is attended (auto).
      for v_seat in
        select s.id, s.ticket_id from match_seats s
         where s.match_id = v_match.id and s.status = 'in'
         order by s.seat_no, s.id
      loop
        if v_seat.ticket_id is not null then
          perform app.ticket_release(array[v_seat.ticket_id], 'auto', array[v_seat.id]);
        end if;
        update match_seats
           set status = 'attended', marked_at = now(), marked_by_staff_id = v_staff
         where id = v_seat.id;
        perform app.match_event(v_match.id, v_match.venue_id, 'seat_attended', p_actor, v_seat.id, null, 'auto',
                                '{}'::jsonb);
        v_seats := v_seats || v_seat.id;
      end loop;
    else
      -- called_off_short, all_no_show: no carrier is still in (R12). A seat
      -- that is must not leave its ticket in use on an ended match (R16).
      select array_agg(s.id order by s.seat_no, s.id),
             array_agg(s.ticket_id order by s.seat_no, s.id) filter (where s.ticket_id is not null),
             array_agg(s.id order by s.seat_no, s.id) filter (where s.ticket_id is not null)
        into v_seats, v_tickets, v_paired
        from match_seats s where s.match_id = v_match.id and s.status = 'in';
      perform app.ticket_release(v_tickets, p_reason, v_paired);
      update match_seats set status = 'cancelled', ended_at = now(), end_reason = 'match_ended'
       where id = any (v_seats);
      v_seats := coalesce(v_seats, '{}'::uuid[]);
    end if;

    -- An unrefilled late leave loses its ticket (a deleted holder's is
    -- released, R18).
    for v_seat in
      select s.id, s.ticket_id from match_seats s
        join match_tickets k on k.id = s.ticket_id
       where s.match_id = v_match.id and s.status = 'left_late'
         and k.status = 'in_use' and k.seat_id = s.id
       order by s.seat_no, s.joined_at, s.id
    loop
      perform app.ticket_forfeit(v_seat.ticket_id, v_seat.id);
      v_seats := v_seats || v_seat.id;
    end loop;
  end if;

  -- Pending requests close with the match.
  for v_req in
    select q.id from match_requests q where q.match_id = v_match.id and q.status = 'pending' order by q.id
  loop
    select array_agg(k.id order by k.id) into v_tickets
      from match_tickets k where k.request_id = v_req.id and k.status = 'reserved';
    perform app.ticket_release(v_tickets, v_code, null, v_req.id);
    update match_requests set status = 'expired', decided_at = now() where id = v_req.id;
    perform app.match_event(v_match.id, v_match.venue_id, 'request_expired', 'system', null, v_req.id, v_code,
                            '{}'::jsonb);
  end loop;

  update matches
     set status       = p_status,
         ended_at     = now(),
         ended_reason = p_reason,
         updated_at   = now()
   where id = v_match.id;
  perform app.match_event(v_match.id, v_match.venue_id,
                          case when p_reason = 'called_off_short' then 'called_off_short' else p_status end,
                          p_actor, null, null, p_reason, jsonb_build_object('seats', to_jsonb(v_seats)));
  return true;
end $match_end_0260$;

comment on function app.match_end(uuid, text, text, text) is
  '0260. Internal (D-4; caller holds the branch mutex). Ends a match: filling/awaiting -> cancelled (organiser_cancelled, staff_cancelled, empty, venue_closed) / bumped (bumped, no_court) / expired (deadline, no_court): in seats cancelled, tickets released. booked -> cancelled (reservation_cancelled): in/attended/no_show/left_late seats cancelled, in tickets released, forfeits restored while the marks are open; -> cancelled (called_off_short) or no_show (all_no_show): unrefilled late leavers'' tickets forfeited; -> played (reason NULL): in carriers auto-attended (R37), tickets released, late leavers'' forfeited. Pending requests expire (code = reason, or match_ended). Then the status and one event (type = status, or called_off_short). False and no change on a terminal match; INVALID_TRANSITION on any other pairing.';

revoke all on function app.match_end(uuid, text, text, text) from public, anon, authenticated;

-- OM-34: the organiser leaves -> the longest-standing account holder takes
-- over; only walk-ins left -> no organiser, open policy; nobody left -> empty.
create or replace function app.match_recompute_organiser(p_match_id uuid) returns boolean
language plpgsql security definer set search_path = public as $match_recompute_organiser_0260$
declare
  v_match   matches%rowtype;
  v_new     uuid;
  v_seat    uuid;
  v_req     record;
  v_tickets uuid[];
begin
  select * into v_match from matches where id = p_match_id;
  if not found or v_match.status not in ('filling', 'awaiting_court', 'booked') then
    return false;
  end if;
  -- 1. A desk match with no account organiser stays the desk's.
  if v_match.organised_by = 'desk' and v_match.organiser_id is null then
    return false;
  end if;
  -- 2. The organiser still carries a seat (their account seat, or a desk seat
  --    linked to them).
  if v_match.organiser_id is not null
     and exists (select 1 from app.match_carriers(v_match.id) c
                   join match_seats s on s.id = c.seat_id
                  where s.guest_id = v_match.organiser_id and s.kind in ('account', 'desk')) then
    return false;
  end if;
  perform set_config('app.venue_id', v_match.venue_id::text, true);

  -- 3. The earliest account carrier still playing, whose account can organise.
  select s.guest_id, s.id into v_new, v_seat
    from app.match_carriers(v_match.id) c
    join match_seats s on s.id = c.seat_id
    join profiles p on p.id = s.guest_id
   where s.kind = 'account' and s.status in ('in', 'attended')
     and p.deleted_at is null
     and not exists (select 1 from customer_flags f where f.customer_id = s.guest_id and f.type = 'match_ban')
   order by s.joined_at, s.id
   limit 1;
  if v_new is not null then
    update matches set organiser_id = v_new, updated_at = now() where id = v_match.id;
    perform app.match_event(v_match.id, v_match.venue_id, 'organiser_changed', 'system', v_seat, null, null,
                            jsonb_build_object('from_guest_id', v_match.organiser_id, 'to_guest_id', v_new));
    return true;
  end if;

  if exists (select 1 from app.match_carriers(v_match.id) c where c.seat_id is not null) then
    -- 4. Only walk-ins (or nobody who can organise): no organiser, open policy.
    if v_match.organiser_id is null and v_match.join_policy = 'open' then
      return false;
    end if;
    update matches set organiser_id = null, join_policy = 'open', updated_at = now() where id = v_match.id;
    for v_req in
      select q.id from match_requests q where q.match_id = v_match.id and q.status = 'pending' order by q.id
    loop
      select array_agg(k.id order by k.id) into v_tickets
        from match_tickets k where k.request_id = v_req.id and k.status = 'reserved';
      perform app.ticket_release(v_tickets, 'organiser_gone', null, v_req.id);
      update match_requests set status = 'expired', decided_at = now() where id = v_req.id;
      perform app.match_event(v_match.id, v_match.venue_id, 'request_expired', 'system', null, v_req.id,
                              'organiser_gone', '{}'::jsonb);
    end loop;
    perform app.match_event(v_match.id, v_match.venue_id, 'organiser_changed', 'system', null, null, null,
                            jsonb_build_object('from_guest_id', v_match.organiser_id, 'to_guest_id', null));
    return true;
  end if;

  -- 5. Nobody left: a filling or waiting match ends; a booked one stays for
  --    the desk.
  if v_match.status in ('filling', 'awaiting_court') then
    return app.match_end(v_match.id, 'cancelled', 'empty', 'system');
  end if;
  return false;
end $match_recompute_organiser_0260$;

comment on function app.match_recompute_organiser(uuid) is
  '0260. Internal (OM-34; caller holds the branch mutex). When the organiser no longer carries a seat: the earliest-joined account carrier still in or attended (not deleted, not banned) becomes organiser (event organiser_changed); only walk-ins (or nobody who can organise) left -> organiser NULL, join policy open, pending requests expire (organiser_gone); nobody left -> a filling or waiting match ends cancelled (empty), a booked one stays for the desk. A desk match with no account organiser is left alone. True when something changed.';

revoke all on function app.match_recompute_organiser(uuid) from public, anon, authenticated;

-- OM-41: what an organiser sees about a requester.
create or replace function app.guest_games_played(p_guest_id uuid) returns int
language sql stable security definer set search_path = public as $guest_games_played_0260$
  select (select count(*)
            from match_seats s join matches mt on mt.id = s.match_id
           where s.guest_id = p_guest_id and s.kind in ('account', 'desk') and s.status = 'attended'
             and not mt.sandbox and mt.status <> 'cancelled')::int
       + (select count(*)
            from reservations r
           where r.guest_id = p_guest_id and r.kind = 'booking' and r.status in ('arrived', 'completed'))::int
$guest_games_played_0260$;

comment on function app.guest_games_played(uuid) is
  '0260. Internal (OM-41). Games the guest played at Touch: attended account or linked desk seats in non-sandbox open matches not cancelled, plus their bookings that arrived or completed.';

revoke all on function app.guest_games_played(uuid) from public, anon, authenticated;

create or replace function app.guest_match_no_shows(p_guest_id uuid) returns int
language sql stable security definer set search_path = public as $guest_match_no_shows_0260$
  select (select count(*)
            from match_seats s join matches mt on mt.id = s.match_id
           where s.guest_id = p_guest_id and s.status = 'no_show' and not mt.sandbox)::int
       + (select count(*)
            from reservations r
           where r.guest_id = p_guest_id and r.kind = 'booking' and r.status = 'no_show')::int
$guest_match_no_shows_0260$;

comment on function app.guest_match_no_shows(uuid) is
  '0260. Internal (OM-41, DF-12, DF-15). The guest''s no-shows: no_show seats in non-sandbox open matches (a friend seat counts on its holder, a linked desk seat on the customer) plus their bookings marked no_show. The number customer_counts.noShows shows from 0262.';

revoke all on function app.guest_match_no_shows(uuid) from public, anon, authenticated;
