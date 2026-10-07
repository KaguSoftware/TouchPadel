set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0320 frame_grants on account merge.
--
-- 0318 added frame_grants.profile_id -> profiles(id), so the account merge has
-- to say what it does with it (account-merge.test.ts holds every such column
-- to app.profile_merge_columns()). A grant follows the person: the drop's
-- grant moves to keep unless keep already has one, then the drop's row goes.

-- ---------------------------------------------------------------------------
-- 1. app.profile_merge_columns: re-created from
--    20261007000314_usernames_frames.sql:419, verbatim plus frame_grants
--    (0314 itself is 0307 identity_hardening's list plus username_holds).
-- ---------------------------------------------------------------------------
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0320$
  select * from (values
    ( 10, 'public', 'tabs',                  'customer_id',           'repoint'),
    ( 20, 'public', 'reservations',          'guest_id',              'repoint'),
    ( 30, 'public', 'reservation_series',    'guest_id',              'repoint'),
    ( 40, 'public', 'guest_sessions',        'linked_profile_id',     'repoint'),
    ( 50, 'public', 'customer_notes',        'customer_id',           'repoint'),
    ( 60, 'public', 'promotion_redemptions', 'customer_id',           'repoint'),
    ( 70, 'public', 'matches',               'organiser_id',          'repoint'),
    ( 80, 'public', 'match_events',          'actor_guest_id',        'repoint'),
    ( 90, 'public', 'coaches',               'profile_id',            'repoint'),
    (100, 'public', 'courses',               'created_by_profile_id', 'repoint'),
    (110, 'public', 'lessons',               'created_by_profile_id', 'repoint'),
    (130, 'public', 'lesson_attendance',     'marked_by_profile_id',  'repoint'),
    (140, 'public', 'lesson_strikes',        'guest_id',              'repoint'),
    (150, 'public', 'lesson_events',         'actor_profile_id',      'repoint'),
    (160, 'public', 'loyalty_ledger',        'profile_id',            'repoint'),
    (170, 'public', 'match_ticket_events',   'guest_id',              'repoint'),
    (180, 'public', 'match_tickets',         'guest_id',              'repoint'),
    (190, 'public', 'notification_outbox',   'profile_id',            'repoint'),
    (300, 'public', 'customer_flags',        'customer_id',           'rule'),
    (310, 'public', 'booking_payments',      'guest_id',              'rule'),
    (320, 'public', 'hold_standing',         'guest_id',              'rule'),
    (330, 'public', 'match_requests',        'guest_id',              'rule'),
    (340, 'public', 'match_seats',           'guest_id',              'rule'),
    (350, 'public', 'match_exclusions',      'guest_id',              'rule'),
    (360, 'public', 'match_blocks',          'blocker_id',            'rule'),
    (361, 'public', 'match_blocks',          'blocked_id',            'rule'),
    (370, 'public', 'match_reports',         'reporter_id',           'rule'),
    (371, 'public', 'match_reports',         'reported_id',           'rule'),
    (380, 'public', 'lesson_enrolments',     'guest_id',              'rule'),
    (381, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'rule'),
    (390, 'public', 'tournament_entries',    'guest_id',              'rule'),
    (400, 'public', 'loyalty_cards',         'profile_id',            'rule'),
    (410, 'public', 'loyalty_accounts',      'profile_id',            'rule'),
    (420, 'public', 'username_holds',        'profile_id',            'drop_only'),
    (430, 'public', 'frame_grants',          'profile_id',            'rule'),
    (500, 'auth',   'identities',            'user_id',               'auth'),
    (510, 'auth',   'sessions',              'user_id',               'signout'),
    (520, 'auth',   'one_time_tokens',       'user_id',               'signout'),
    (530, 'auth',   'mfa_factors',           'user_id',               'drop_only'),
    (540, 'auth',   'oauth_authorizations',  'user_id',               'drop_only'),
    (550, 'auth',   'oauth_consents',        'user_id',               'drop_only'),
    (560, 'auth',   'webauthn_credentials',  'user_id',               'drop_only'),
    (570, 'auth',   'webauthn_challenges',   'user_id',               'drop_only'),
    (600, 'public', 'staff',                 'id',                    'refuse'),
    (700, 'app',    'profile_merges',        'keep_id',               'record')
  ) as t (ord, sch, tbl, col, how)
  order by 1;
$profile_merge_columns_0320$;


comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314, frame_grants since 0320. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.merge_profiles_internal: re-created from
--    20261006000307_identity_hardening.sql:267, verbatim plus the frame_grants
--    move after loyalty.
-- ---------------------------------------------------------------------------
create or replace function app.merge_profiles_internal(p_keep uuid, p_drop uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $merge_profiles_internal_0320$
declare
  v_keep     profiles%rowtype;
  v_drop     profiles%rowtype;
  v_moved    jsonb := '{}'::jsonb;
  v_n        bigint;
  v_c        record;
  v_actor    uuid := auth.uid();
  v_claims   text := current_setting('request.jwt.claims', true);
  v_sub      text := current_setting('request.jwt.claim.sub', true);
  v_ku       auth.users%rowtype;
  v_du       auth.users%rowtype;
  v_keep_synth boolean;
  v_merge_id uuid;
  v_claim    boolean := p_reason = 'walkin_claim';
  v_proven   boolean;
  v_take_email boolean := false;
  v_take_phone boolean := false;
  v_take_ids boolean := false;
  v_venue    text := current_setting('app.venue_id', true);
  v_te       record;
  v_k        tournament_entries%rowtype;
  v_d        tournament_entries%rowtype;
  v_win      uuid;
  v_lose     tournament_entries%rowtype;
  v_ts       text;
  v_le       record;
begin
  if p_keep is null or p_drop is null then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'missing';
  end if;
  if p_keep = p_drop then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'same';
  end if;

  -- 1. Locks. The tournaments both accounts entered, in id order (every
  -- tournament body takes its tournaments row before its entries), then both
  -- profiles in uuid order FOR NO KEY UPDATE: the merge never changes a key,
  -- so a settle's deferred ledger insert (an FK key share on the profile,
  -- taken while it holds the tab) never waits on it (0307, c20).
  perform 1 from tournaments
   where id in (select tournament_id from tournament_entries where guest_id in (p_keep, p_drop))
   order by id for update;
  perform 1 from profiles where id in (p_keep, p_drop) order by id for no key update;
  select * into v_keep from profiles where id = p_keep;
  select * into v_drop from profiles where id = p_drop;
  if v_keep.id is null or v_drop.id is null
     or v_keep.deleted_at is not null or v_drop.deleted_at is not null then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'missing';
  end if;

  -- Refusals. staff.id is auth.users(id) ON DELETE RESTRICT and every staff
  -- table points at it: a staff account is never the one folded away.
  if exists (select 1 from staff where id = p_drop) then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001',
      detail = case when exists (select 1 from staff where id = p_keep) then 'staff_both' else 'staff_drop' end;
  end if;
  if exists (select 1 from coaches where profile_id = p_keep)
     and exists (select 1 from coaches where profile_id = p_drop) then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'coach_both';
  end if;

  -- 0307 (c0): the auth slots move only between accounts proven to be one
  -- person: a confirmed phone or a verified email the two hold alike. Never
  -- on a walk-in claim (its email, if any, was typed by the desk), and not on
  -- the owner's word alone: the owner's list shows unproven pairs (kind
  -- phone_unproven), among them a guest who only typed someone's number, and
  -- an owner merge of such a pair must not hand one person's login to the
  -- other. It moves the data and leaves every login where it was.
  select * into v_ku from auth.users where id = p_keep;
  select * into v_du from auth.users where id = p_drop;
  v_proven := not v_claim and v_ku.id is not null and v_du.id is not null
              and ((v_ku.phone_confirmed_at is not null and v_du.phone_confirmed_at is not null
                       and coalesce(app.phone_digits(v_ku.phone), '') ~ '^[0-9]{7,15}$'
                       and app.phone_canon(v_ku.phone) = app.phone_canon(v_du.phone))
                   or exists (
                        -- a verified email both hold: the account's confirmed
                        -- email or a Google or Apple identity's (the email
                        -- groups of duplicate_groups_internal)
                        select 1
                          from (select lower(btrim(u.email)) as e from auth.users u
                                 where u.id = p_keep and u.email_confirmed_at is not null
                                union
                                select lower(btrim(i.email)) from auth.identities i
                                 where i.user_id = p_keep and i.provider in ('google', 'apple')) a
                          join (select lower(btrim(u.email)) as e from auth.users u
                                 where u.id = p_drop and u.email_confirmed_at is not null
                                union
                                select lower(btrim(i.email)) from auth.identities i
                                 where i.user_id = p_drop and i.provider in ('google', 'apple')) b
                            on a.e = b.e
                         where nullif(a.e, '') is not null and a.e not like '%@guest.touch.local'));
  if v_proven then
    v_keep_synth := coalesce(v_ku.email ilike '%@guest.touch.local', false);
    v_take_email := (nullif(btrim(coalesce(v_ku.email, '')), '') is null or v_keep_synth)
                    and nullif(btrim(coalesce(v_du.email, '')), '') is not null
                    and v_du.email not ilike '%@guest.touch.local';
    v_take_phone := nullif(btrim(coalesce(v_ku.phone, '')), '') is null
                    and nullif(btrim(coalesce(v_du.phone, '')), '') is not null;
    -- An OAuth login (Google, Apple, ...) keep lacks moves too (section 6),
    -- so it is a login a staff or coach keep would receive as well.
    v_take_ids := exists (
      select 1 from auth.identities d
       where d.user_id = p_drop and d.provider not in ('email', 'phone')
         and not exists (select 1 from auth.identities k
                          where k.user_id = p_keep and k.provider = d.provider));
    if (v_take_email or v_take_phone or v_take_ids)
       and (exists (select 1 from staff where id = p_keep)
            or exists (select 1 from coaches where profile_id = p_keep)) then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'staff_keep_auth';
    end if;
  elsif not v_claim and v_ku.id is not null and v_du.id is not null
        -- An unproven merge moves no login and empties the drop's. When the
        -- drop is the only one of the two anybody can sign in to (a desk
        -- walk-in kept over the person's app account), the person would be
        -- locked out of their own history: the other way round, or not at all.
        and not (   (nullif(btrim(coalesce(v_ku.email, '')), '') is not null
                     and v_ku.email not ilike '%@guest.touch.local')
                 or v_ku.phone_confirmed_at is not null
                 or exists (select 1 from auth.identities i
                             where i.user_id = p_keep and i.provider not in ('email', 'phone')))
        and (   (nullif(btrim(coalesce(v_du.email, '')), '') is not null
                 and v_du.email not ilike '%@guest.touch.local')
             or v_du.phone_confirmed_at is not null
             or exists (select 1 from auth.identities i
                         where i.user_id = p_drop and i.provider not in ('email', 'phone'))) then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'keep_no_login';
  end if;

  -- The writes below are the merge's own, made for whichever caller: the
  -- branch guard's "staff write only where they work" (0230) must not refuse
  -- the owner a row of a closed branch, so the caller's claims are set aside
  -- (as for a cron or service write) and restored before the audit row.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('app.profile_merge', 'on', true);
  perform set_config('app.loyalty_merge', 'on', true);   -- contracts §1.3: the ledger re-point

  -- 1b. 0307 (c11): a tournament both accounts entered. The better entry
  -- wins (registered, waitlisted, no_show, withdrawn; then the net paid;
  -- then keep's); the loser's tournament tabs move to it, so its money counts
  -- there, and the loser is deleted. A loser already in the draw (a match, a
  -- bye, a substitution), or a pair both paid, cannot go: MERGE_REFUSED
  -- detail tournament_entry.
  -- Before the re-point loop: its tabs update is the first tabs write.
  for v_te in
    select k.id as k_id, d.id as d_id
      from tournament_entries d
      join tournament_entries k on k.tournament_id = d.tournament_id and k.guest_id = p_keep
     where d.guest_id = p_drop
     order by d.tournament_id
  loop
    select * into v_k from tournament_entries where id = v_te.k_id;
    select * into v_d from tournament_entries where id = v_te.d_id;
    select x.id into v_win
      from (values (v_k.id, v_k.status, 1), (v_d.id, v_d.status, 2)) as x (id, status, side)
     order by case x.status when 'registered' then 0 when 'waitlisted' then 1 when 'no_show' then 2 else 3 end,
              coalesce((app.tournament_entry_money(x.id)->>'net_iqd')::bigint, 0) desc,
              x.side
     limit 1;
    v_lose := case when v_win = v_k.id then v_d else v_k end;
    -- Both entries paid: folding one into the other would hide the second
    -- fee from every refunds-due figure (refund_due counts a withdrawn or
    -- cancelled entry only). One is refunded first, then the merge runs.
    if coalesce((app.tournament_entry_money(v_k.id)->>'net_iqd')::bigint, 0) > 0
       and coalesce((app.tournament_entry_money(v_d.id)->>'net_iqd')::bigint, 0) > 0 then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'tournament_entry';
    end if;
    if exists (select 1 from tournament_matches m where v_lose.id in (m.a1, m.a2, m.b1, m.b2))
       or exists (select 1 from tournament_entries s where s.substitute_for = v_lose.id)
       or exists (select 1 from tournament_rounds r where v_lose.id = any (r.bye_entry_ids)) then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'tournament_entry';
    end if;
    update tabs set tournament_entry_id = v_win where tournament_entry_id = v_lose.id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object('tabs.tournament_entry_id',
                                               coalesce((v_moved->>'tabs.tournament_entry_id')::bigint, 0) + v_n);
    end if;
    select status::text into v_ts from tournaments where id = v_lose.tournament_id;
    perform set_config('app.venue_id', v_lose.venue_id::text, true);
    delete from tournament_entries where id = v_lose.id;
    perform app.write_audit('tournament.merge_entry', 'tournament_entries', v_lose.id::text,
                            jsonb_build_object('status', v_lose.status, 'tournament_id', v_lose.tournament_id),
                            jsonb_build_object('kept_entry_id', v_win, 'keep_id', p_keep, 'drop_id', p_drop));
    if v_lose.status = 'registered' then
      if v_ts = 'open' then
        perform app.tournament_promote_internal(v_lose.tournament_id);
      elsif v_ts in ('closed', 'running') then
        update tournaments set revision = revision + 1, updated_at = now() where id = v_lose.tournament_id;
      end if;
    end if;
    v_moved := v_moved || jsonb_build_object('tournament_entries.merged',
                                             coalesce((v_moved->>'tournament_entries.merged')::bigint, 0) + 1);
  end loop;
  -- The caller's branch back: the tournament's was asserted for that
  -- entry's rows only, never for the rest of the merge or the caller.
  perform set_config('app.venue_id', coalesce(v_venue, ''), true);

  -- 2. The plain re-points, in lock order (tabs → reservations → … →
  -- match_tickets). A column that does not exist yet is skipped. A walk-in
  -- claim leaves the staff's notes about the walk-in on the tombstone (c21).
  for v_c in
    select m.sch, m.tbl, m.col from app.profile_merge_columns() m
     where m.how = 'repoint' order by m.ord
  loop
    continue when v_claim and v_c.tbl = 'customer_notes';
    continue when not exists (
      select 1 from pg_attribute a
       where a.attrelid = to_regclass(format('%I.%I', v_c.sch, v_c.tbl))
         and a.attname = v_c.col and not a.attisdropped);
    execute format('update %I.%I set %I = $1 where %I = $2', v_c.sch, v_c.tbl, v_c.col, v_c.col)
      using p_keep, p_drop;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(v_c.tbl || '.' || v_c.col, v_n);
    end if;
  end loop;

  -- 3. The rule columns: each move first resolves the unique scope it would
  -- break. A row that only describes a relation (a flag, a block, a report,
  -- an exclusion, a standing) is deleted on the drop when keep already has
  -- it; a row that carries money or a place (a seat, a request, an enrolment,
  -- an entry, a ticket payment in flight) stays on the drop tombstone as
  -- history and is counted under <table>_left.

  -- customer_flags (customer_id, type): keep's flag wins. A walk-in claim
  -- leaves them on the tombstone (c21).
  if not v_claim then
    delete from customer_flags d
     where d.customer_id = p_drop
       and exists (select 1 from customer_flags k where k.customer_id = p_keep and k.type = d.type);
    update customer_flags set customer_id = p_keep where customer_id = p_drop;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object('customer_flags.customer_id', v_n); end if;
  end if;

  -- booking_payments_one_active_ticket: one ticket purchase in flight each.
  update booking_payments d set guest_id = p_keep
   where d.guest_id = p_drop
     and not (d.purpose = 'ticket' and d.status in ('created', 'pending')
              and exists (select 1 from booking_payments k
                           where k.guest_id = p_keep and k.purpose = 'ticket'
                             and k.status in ('created', 'pending')));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('booking_payments.guest_id', v_n); end if;

  -- hold_standing: the account row is keyed u:<id>. Keep inherits the
  -- stricter standing of the two; a phone-keyed row (p:<hash>) just moves.
  if exists (select 1 from hold_standing where key = 'u:' || p_drop) then
    if exists (select 1 from hold_standing where key = 'u:' || p_keep) then
      update hold_standing k
         set strikes        = greatest(k.strikes, d.strikes),
             last_strike_at = greatest(k.last_strike_at, d.last_strike_at),
             blocked_until  = greatest(k.blocked_until, d.blocked_until),
             suspended_at   = coalesce(k.suspended_at, d.suspended_at),
             needs_review   = k.needs_review or d.needs_review,
             review_venue_id = coalesce(k.review_venue_id, d.review_venue_id),
             banned_at      = coalesce(k.banned_at, d.banned_at),
             banned_by      = case when k.banned_at is null then d.banned_by else k.banned_by end,
             updated_at     = now()
        from hold_standing d
       where k.key = 'u:' || p_keep and d.key = 'u:' || p_drop;
      delete from hold_standing where key = 'u:' || p_drop;
    else
      update hold_standing set key = 'u:' || p_keep, guest_id = p_keep, updated_at = now()
       where key = 'u:' || p_drop;
    end if;
    v_moved := v_moved || jsonb_build_object('hold_standing.account', 1);
  end if;
  update hold_standing set guest_id = p_keep where guest_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('hold_standing.guest_id', v_n); end if;

  -- match_requests_one_pending (match_id, guest_id) where pending.
  update match_requests d set guest_id = p_keep
   where d.guest_id = p_drop
     and not (d.status = 'pending'
              and exists (select 1 from match_requests k
                           where k.match_id = d.match_id and k.guest_id = p_keep and k.status = 'pending'));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_requests.guest_id', v_n); end if;

  -- match_seats_occupying_account (match_id, guest_id) where an account seat is in.
  update match_seats d set guest_id = p_keep
   where d.guest_id = p_drop
     and not (d.kind = 'account' and d.status in ('in', 'attended', 'no_show')
              and exists (select 1 from match_seats k
                           where k.match_id = d.match_id and k.guest_id = p_keep and k.kind = 'account'
                             and k.status in ('in', 'attended', 'no_show')));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_seats.guest_id', v_n); end if;

  -- match_exclusions (match_id, guest_id).
  delete from match_exclusions d
   where d.guest_id = p_drop
     and exists (select 1 from match_exclusions k where k.match_id = d.match_id and k.guest_id = p_keep);
  update match_exclusions set guest_id = p_keep where guest_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_exclusions.guest_id', v_n); end if;

  -- match_blocks (blocker_id, blocked_id), never a self-block: the pair
  -- between the two accounts goes, then the duplicates, then the moves.
  delete from match_blocks
   where blocker_id in (p_keep, p_drop) and blocked_id in (p_keep, p_drop);
  delete from match_blocks d
   where d.blocker_id = p_drop
     and exists (select 1 from match_blocks k where k.blocker_id = p_keep and k.blocked_id = d.blocked_id);
  delete from match_blocks d
   where d.blocked_id = p_drop
     and exists (select 1 from match_blocks k where k.blocked_id = p_keep and k.blocker_id = d.blocker_id);
  update match_blocks set blocker_id = p_keep where blocker_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_blocks.blocker_id', v_n); end if;
  update match_blocks set blocked_id = p_keep where blocked_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_blocks.blocked_id', v_n); end if;

  -- match_reports (reporter_id, reported_id, match_id), never a self-report.
  delete from match_reports
   where reporter_id in (p_keep, p_drop) and reported_id in (p_keep, p_drop);
  delete from match_reports d
   where d.reporter_id = p_drop
     and exists (select 1 from match_reports k
                  where k.reporter_id = p_keep and k.reported_id = d.reported_id and k.match_id = d.match_id);
  delete from match_reports d
   where d.reported_id = p_drop
     and exists (select 1 from match_reports k
                  where k.reported_id = p_keep and k.reporter_id = d.reporter_id and k.match_id = d.match_id);
  update match_reports set reporter_id = p_keep where reporter_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_reports.reporter_id', v_n); end if;
  update match_reports set reported_id = p_keep where reported_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_reports.reported_id', v_n); end if;

  -- lesson_enrolments_one_live_lesson / _course: one live place each. 0307
  -- (c11): a booked place on the drop beats a held one on keep that no
  -- payment can still book (a private lesson's held row is never one: it has
  -- one enrolment). Keep's hold ends as expired, then the booked place moves.
  for v_le in
    select k.id as k_id
      from lesson_enrolments d
      join lesson_enrolments k
        on k.guest_id = p_keep and k.status = 'held'
       and ((d.lesson_id is not null and k.lesson_id = d.lesson_id)
            or (d.course_id is not null and k.course_id = d.course_id))
     where d.guest_id = p_drop and d.status = 'booked'
       and not exists (select 1 from lessons l where l.id = k.lesson_id and l.status = 'held')
       and not exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = k.id
                          and bp.status in ('created', 'pending', 'succeeded'))
     order by k.id
  loop
    update lesson_enrolments
       set status = 'expired', cancel_kind = 'expired', cancelled_at = now(),
           hold_expires_at = null, updated_at = now()
     where id = v_le.k_id and status = 'held';
    v_moved := v_moved || jsonb_build_object('lesson_enrolments.held_expired',
                                             coalesce((v_moved->>'lesson_enrolments.held_expired')::bigint, 0) + 1);
  end loop;
  -- A place the guest booked names the guest twice (lesson_enrolments_booked_by:
  -- booked_by_profile_id = guest_id), so both move in one statement; 0303's
  -- generic re-point of booked_by_profile_id first broke the check for every
  -- guest-booked place (0307: the column is a rule now).
  update lesson_enrolments d
     set guest_id = p_keep,
         booked_by_profile_id = case when d.booked_by_profile_id = p_drop then p_keep else d.booked_by_profile_id end,
         updated_at = now()
   where d.guest_id = p_drop
     and not (d.status in ('held', 'booked')
              and exists (select 1 from lesson_enrolments k
                           where k.guest_id = p_keep and k.status in ('held', 'booked')
                             and ((d.lesson_id is not null and k.lesson_id = d.lesson_id)
                                  or (d.course_id is not null and k.course_id = d.course_id))));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('lesson_enrolments.guest_id', v_n); end if;
  -- A place the drop booked for someone else, as a coach.
  update lesson_enrolments set booked_by_profile_id = p_keep, updated_at = now()
   where booked_by_profile_id = p_drop and booked_by_kind <> 'guest';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('lesson_enrolments.booked_by_profile_id', v_n); end if;

  -- tournament_entries_guest_key (tournament_id, guest_id): every collision
  -- was resolved in 1b, so the drop's entries all move.
  update tournament_entries d set guest_id = p_keep, updated_at = now()
   where d.guest_id = p_drop
     and not exists (select 1 from tournament_entries k
                      where k.tournament_id = d.tournament_id and k.guest_id = p_keep);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('tournament_entries.guest_id', v_n); end if;

  -- What stayed on the drop, by table.
  select v_moved || coalesce(jsonb_object_agg(t || '_left', n) filter (where n > 0), '{}'::jsonb)
    into v_moved
    from (values
      ('booking_payments',   (select count(*) from booking_payments   where guest_id = p_drop)),
      ('match_requests',     (select count(*) from match_requests     where guest_id = p_drop)),
      ('match_seats',        (select count(*) from match_seats        where guest_id = p_drop)),
      ('lesson_enrolments',  (select count(*) from lesson_enrolments  where guest_id = p_drop)),
      ('tournament_entries', (select count(*) from tournament_entries where guest_id = p_drop))
    ) as l (t, n);

  -- Loyalty: both cached accounts in uuid order (the last rank), then the
  -- drop's card and account go and keep's is recomputed from the moved ledger.
  perform 1 from loyalty_accounts where profile_id in (p_keep, p_drop) order by profile_id for update;
  delete from loyalty_cards where profile_id = p_drop;
  delete from loyalty_accounts where profile_id = p_drop;
  perform app.loyalty_recompute(p_keep);

  -- Frame grants (0318): one row per profile. The drop's grant moves to keep
  -- when keep has none; otherwise the drop's row goes.
  update frame_grants d set profile_id = p_keep
   where d.profile_id = p_drop
     and not exists (select 1 from frame_grants k where k.profile_id = p_keep);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('frame_grants.profile_id', v_n); end if;
  delete from frame_grants where profile_id = p_drop;

  -- 4. The profile fields keep lacks. Not avatar_path: the path is the drop's
  -- own folder (0302 app.avatar_owner), purged by the tombstone below. Never
  -- the push token (0307, c0: one person's device must not get the other's
  -- pushes), and nothing personal on a walk-in claim (c21: the number may
  -- have been mistyped at the desk).
  if not v_claim then
    update profiles k
       set full_name       = case when nullif(btrim(k.full_name), '') is null then d.full_name   else k.full_name   end,
           given_name      = case when nullif(btrim(k.full_name), '') is null then d.given_name  else k.given_name  end,
           family_name     = case when nullif(btrim(k.full_name), '') is null then d.family_name else k.family_name end,
           gender          = case when k.gender is null then d.gender        else k.gender        end,
           gender_set_at   = case when k.gender is null then d.gender_set_at else k.gender_set_at end,
           gender_set_by   = case when k.gender is null then d.gender_set_by else k.gender_set_by end,
           birth_date      = coalesce(k.birth_date, d.birth_date),
           terms_version   = case when k.terms_version is null then d.terms_version     else k.terms_version     end,
           terms_accepted_at = case when k.terms_version is null then d.terms_accepted_at else k.terms_accepted_at end
      from profiles d
     where k.id = p_keep and d.id = p_drop;
  end if;

  -- 5. The drop, tombstoned as app.delete_my_account does it;
  -- profiles_media_tombstone (0302) empties avatar_path and birth_date and
  -- queues the drop's avatar folder.
  update profiles
     set full_name       = 'Deleted account',
         phone           = null,
         expo_push_token = null,
         given_name      = null,
         family_name     = null,
         gender          = null,
         gender_set_at   = null,
         gender_set_by   = null,
         deleted_at      = now()
   where id = p_drop;

  -- Keep takes the drop's phone when it has none and nobody else holds it
  -- (the key follows app.profile_phone_key: keep's own proof, not the drop's).
  if v_keep.phone is null and v_drop.phone is not null and v_drop.phone_key is not null
     and not exists (select 1 from profiles p
                      where p.phone_key = v_drop.phone_key and p.deleted_at is null and p.id <> p_keep) then
    update profiles set phone = v_drop.phone where id = p_keep;
    v_moved := v_moved || jsonb_build_object('profile.phone', 1);
  end if;

  -- 6. Auth. Only between proven accounts (above): the email or phone slot
  -- keep lacks comes across (cleared on the drop first: both are unique in
  -- GoTrue), with its identity, and any other provider keep lacks moves.
  -- Then whatever is left on the drop's auth row goes (0307, c45): its
  -- metadata, email, phone and identities; it is banned for good and signed
  -- out everywhere.
  if v_ku.id is not null and v_du.id is not null then
    if v_take_email then
      update auth.users set email = null, updated_at = now() where id = p_drop;
      if v_keep_synth then
        -- (provider_id, provider) is unique: keep's synthetic email identity
        -- gives way to the one that moves below.
        delete from auth.identities where user_id = p_keep and provider = 'email';
      end if;
      update auth.users
         set email              = v_du.email,
             email_confirmed_at = v_du.email_confirmed_at,
             encrypted_password = case when v_keep_synth or coalesce(encrypted_password, '') = ''
                                       then v_du.encrypted_password else encrypted_password end,
             updated_at         = now()
       where id = p_keep;
      update auth.identities
         set user_id = p_keep, provider_id = p_keep::text,
             identity_data = identity_data || jsonb_build_object('sub', p_keep::text), updated_at = now()
       where user_id = p_drop and provider = 'email'
         and not exists (select 1 from auth.identities i where i.user_id = p_keep and i.provider = 'email');
      v_moved := v_moved || jsonb_build_object('auth.email', 1);
    end if;
    if v_take_phone then
      update auth.users set phone = null, updated_at = now() where id = p_drop;
      update auth.users
         set phone = v_du.phone, phone_confirmed_at = v_du.phone_confirmed_at, updated_at = now()
       where id = p_keep;
      update auth.identities
         set user_id = p_keep, provider_id = p_keep::text,
             identity_data = identity_data || jsonb_build_object('sub', p_keep::text), updated_at = now()
       where user_id = p_drop and provider = 'phone'
         and not exists (select 1 from auth.identities i where i.user_id = p_keep and i.provider = 'phone');
      v_moved := v_moved || jsonb_build_object('auth.phone', 1);
    end if;
    if v_proven then
      update auth.identities d
         set user_id = p_keep, updated_at = now()
       where d.user_id = p_drop
         and d.provider not in ('email', 'phone')
         and not exists (select 1 from auth.identities k where k.user_id = p_keep and k.provider = d.provider);
      get diagnostics v_n = row_count;
      if v_n > 0 then v_moved := v_moved || jsonb_build_object('auth.identities', v_n); end if;
    end if;

    delete from auth.identities where user_id = p_drop;
    update auth.users
       set raw_user_meta_data = '{}'::jsonb,
           email              = null,
           phone              = null,
           banned_until       = 'infinity',
           updated_at         = now()
     where id = p_drop;
    delete from auth.sessions where user_id = p_drop;          -- refresh tokens cascade
    delete from auth.one_time_tokens where user_id = p_drop;
  end if;

  perform set_config('app.loyalty_merge', '', true);
  perform set_config('app.profile_merge', '', true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  -- Keep's key under its own proof now (a phone that came across, an auth
  -- phone that moved).
  update profiles set phone = phone where id = p_keep;

  -- 7. The record. No before-image of the drop: its name and phone are what
  -- the tombstone erased (the 0077 rule).
  insert into app.profile_merges (keep_id, drop_id, reason, moved, actor_id)
  values (p_keep, p_drop, left(coalesce(nullif(btrim(p_reason), ''), 'merge'), 200), v_moved, v_actor)
  returning id into v_merge_id;

  perform app.write_audit(
    'account.merge', 'profiles', p_keep::text,
    jsonb_build_object('drop_id', p_drop, 'drop_created_at', v_drop.created_at,
                       'drop_had_phone', v_drop.phone is not null),
    jsonb_build_object('merge_id', v_merge_id, 'moved', v_moved),
    left(coalesce(nullif(btrim(p_reason), ''), 'merge'), 200));

  return jsonb_build_object('merge_id', v_merge_id, 'keep_id', p_keep, 'drop_id', p_drop, 'moved', v_moved);
end $merge_profiles_internal_0320$;

comment on function app.merge_profiles_internal(uuid, uuid, text) is
  '0303, 0307, frame_grants since 0320 (loyalty contracts §1.1). Internal, granted to nobody. Folds p_drop into p_keep. Locks the tournaments both entered (id order), then both profiles FOR NO KEY UPDATE (uuid order). A tournament both entered keeps the better entry (registered > waitlisted > no_show > withdrawn, then net paid, then keep''s): the loser''s tournament tabs move to it and the loser is deleted (a registered loser frees its place: promotion when open, a revision otherwise); a loser in the draw, or a pair of entries both paid, is MERGE_REFUSED detail tournament_entry (the tournament''s branch is asserted for those rows, then the caller''s app.venue_id restored). Every column of app.profile_merge_columns() is re-pointed (a flag, block, report, exclusion or standing keep already has is deleted on the drop; a seat, request, enrolment or ticket payment in flight stays on the drop, counted <table>_left; a booked lesson place beats a held one on keep that no payment can still book). Keep takes the names (when its full_name is empty), gender, birth_date and terms it lacks, then the phone it lacks; never the push token. A walk-in claim (reason walkin_claim) moves no name, gender, birth date, terms, customer_notes or customer_flags. The drop is tombstoned as delete_my_account does (0302 purges its avatar). Auth moves only between proven accounts (a confirmed phone or a verified email the two share; the owner''s word is not proof, so an owner merge of an unproven pair moves data only): the email or phone slot keep lacks with its identity (a walk-in''s synthetic address counts as empty), the email with its password when keep has none, other providers keep lacks; a staff or coach keep that would receive an email, a phone or an OAuth identity is MERGE_REFUSED detail staff_keep_auth, and an unproven merge whose drop is the only one of the two anybody can sign in to is MERGE_REFUSED detail keep_no_login. The drop''s auth row is then emptied (metadata, email, phone, identities), banned (infinity) and signed out. Loyalty: both accounts locked in uuid order, the drop''s card and account go, keep''s is recomputed. Frame grants: the drop''s moves to keep when keep has none, else it goes. Writes app.profile_merges and audit_log account.merge. MERGE_REFUSED detail missing | same | staff_drop | staff_both | coach_both | staff_keep_auth | keep_no_login | tournament_entry. Returns {merge_id, keep_id, drop_id, moved}.';

revoke all on function app.merge_profiles_internal(uuid, uuid, text) from public, anon, authenticated;
