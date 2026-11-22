-- ===========================================================================
-- 0451 — the Player card's derived facts load on demand (Majed, 2026-11-22:
-- "lets do 4 but its a button inside that customers account page").
--
-- Opening a customer at the desk waits only on app.customer_record. Since
-- 0368 that one call also derived two player facts the desk rarely needs at a
-- glance: what the games suggest (app.level_suggested -> level_suggestions, a
-- self-join of a year of confirmed game_results) and the interest tags
-- (app.customer_interest_tags: reservations, match seats, lessons, tournament
-- entries, tabs, loyalty, discounts, game results and organised matches over
-- 180 days). On the hosted project's small compute box, every call is a
-- chance to run past the 8 s statement timeout when the box is busy
-- (2026-11-22: two of seven customer_record calls cancelled), and the desk
-- then waits for a retry.
--
-- 1. app.customer_player_insights(p_customer_id) — NEW. The same roles and
--    errors as customer_record (court desk, cashier, manager, owner;
--    FORBIDDEN, CUSTOMER_NOT_FOUND). Returns {suggested, interests}, each
--    exactly as 0368's player block carried it: suggested =
--    app.level_suggested (null until five scored games), interests =
--    app.customer_interest_tags over the last 180 days at the branches in
--    scope (never asked). The operator's Player card asks for it only when
--    the desk presses its button.
-- 2. app.customer_record — re-issued from
--    20261024000368_customer_facts.sql:679 verbatim, without the two keys
--    player.suggested and player.interests. Every other key is unchanged;
--    an operator build before this one reads them as "no suggestion, no
--    tags" (parsePlayerFacts already treats a missing key that way).
--
-- No table, index or grant changes beyond the new function. The assistant's
-- customer_record tool never described these two keys.
--
-- covered by packages/db/tests/customer-facts.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.customer_player_insights — on demand.
-- ---------------------------------------------------------------------------
create or replace function app.customer_player_insights(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_player_insights_0451$
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'suggested', app.level_suggested(p_customer_id),
    'interests', to_jsonb(coalesce(
      (select t.tags
         from app.customer_interest_tags((select app.visible_venue_ids())::uuid[],
                                         array[p_customer_id], now() - interval '180 days', now()) t
        limit 1), '{}'::text[])));
end $customer_player_insights_0451$;

comment on function app.customer_player_insights(uuid) is
  '0451. Court desk, cashier, manager, owner: the two derived player facts 0368 put in customer_record, asked for on demand by the Player card''s button. {suggested: app.level_suggested ({level, games, wins, losses, score}, or null until five scored games), interests: app.customer_interest_tags over the last 180 days at the branches in scope (text[], derived, never asked)}. FORBIDDEN, CUSTOMER_NOT_FOUND.';

revoke all on function app.customer_player_insights(uuid) from public, anon;
grant execute on function app.customer_player_insights(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.customer_record: re-issued from
--    20261024000368_customer_facts.sql:679 verbatim, without player.suggested
--    and player.interests.
-- ---------------------------------------------------------------------------
create or replace function app.customer_record(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_record_0451$
declare
  v_customer jsonb;
  v_player   jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'id',             p.id,
           'full_name',      p.full_name,
           'phone',          p.phone,
           'email',          u.email,
           'preferred_lang', p.preferred_lang,
           'created_at',     p.created_at,
           'gender',         p.gender,
           'gender_set_by',  p.gender_set_by)
    into v_customer
    from profiles p
    left join auth.users u on u.id = p.id
   where p.id = p_customer_id;
  if v_customer is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 0368: who this player is. 0451: what the games suggest and the interest
  -- tags are no longer here; app.customer_player_insights answers them when
  -- the desk asks (the Player card's button).
  select jsonb_build_object(
           'age_band',               p.age_band,
           'claimed_level',          p.play_level,
           'play_years',             p.play_years,
           'play_wants',             to_jsonb(coalesce(p.play_wants, '{}'::text[])),
           'level_confirmed',        p.level_confirmed,
           'level_confirmed_at',     p.level_confirmed_at,
           'level_confirmed_role',   p.level_confirmed_role,
           'level_confirmed_by_name', coalesce(
             (select s.display_name from staff s where s.id = p.level_confirmed_by),
             (select pr.full_name   from profiles pr where pr.id = p.level_confirmed_by)),
           'level_note',             p.level_note,
           'effective_level',        app.effective_play_level(p.level_confirmed, p.play_level))
    into v_player
    from profiles p
   where p.id = p_customer_id;

  return jsonb_build_object(
    'customer', v_customer,
    'player',   v_player,
    'flags',    app.customer_flags_json(p_customer_id),
    'counts',   app.customer_counts(p_customer_id),
    'upcoming', coalesce(
      (select jsonb_agg(app.customer_reservation_json(r, c) order by r.start_at)
         from reservations r
         join courts c on c.id = r.court_id
        where r.guest_id = p_customer_id
          and r.start_at >= now()
          and r.status in ('pending','confirmed','arrived')),
      '[]'::jsonb),
    'history', coalesce(
      (select jsonb_agg(h.payload order by h.start_at desc)
         from (select app.customer_reservation_json(r, c) as payload, r.start_at
                 from reservations r
                 join courts c on c.id = r.court_id
                where r.guest_id = p_customer_id
                  and r.kind <> 'hold'
                  and not (r.start_at >= now() and r.status in ('pending','confirmed','arrived'))
                order by r.start_at desc
                limit 50) h),
      '[]'::jsonb),
    -- 0262: open matches (one row per match: the customer's own seat, account
    -- or linked desk, before a friend seat they hold), newest first.
    'matches', coalesce(
      (select jsonb_agg(x.j order by x.start_at desc, x.id)
         from (select m.id, m.start_at,
                      jsonb_build_object('match_id', m.id, 'reservation_id', m.reservation_id,
                                         'venue_id', m.venue_id, 'status', m.status,
                                         'start_at', m.start_at, 'end_at', m.end_at, 'category', m.category,
                                         'seat_status', s.status, 'kind', s.kind) as j
                 from matches m
                 join lateral (select ms.status, ms.kind
                                 from match_seats ms
                                where ms.match_id = m.id and ms.guest_id = p_customer_id
                                order by (ms.kind <> 'friend') desc, ms.joined_at desc, ms.id desc
                                limit 1) s on true
                where not m.sandbox
                order by m.start_at desc, m.id
                limit 20) x),
      '[]'::jsonb),
    'cafeOrders', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             t.id,
                          'opened_at',      t.opened_at,
                          'total_iqd',      t.total_iqd,
                          'status',         t.status,
                          'reservation_id', t.reservation_id)
                        order by t.opened_at desc)
         from tabs t
        where t.reservation_id in (select r.id from reservations r where r.guest_id = p_customer_id)),
      '[]'::jsonb),
    'notes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             n.id,
                          'body',           n.body,
                          'author_id',      n.author_id,
                          'author_name',    a.display_name,
                          'created_at',     n.created_at,
                          'edited_at',      n.edited_at,
                          'edited_by',      n.edited_by,
                          'edited_by_name', e.display_name)
                        order by n.created_at desc)
         from customer_notes n
         join staff a on a.id = n.author_id
         left join staff e on e.id = n.edited_by
        where n.customer_id = p_customer_id),
      '[]'::jsonb),
    -- 0066 (series lane) fills this; the key exists now so the screen can bind to it.
    'series', '[]'::jsonb);
end $customer_record_0451$;

comment on function app.customer_record(uuid) is
  '0451 = the 0368 record without player.suggested and player.interests: those two are derived (a self-join of a year of game_results, and every branch activity table for 180 days), so app.customer_player_insights answers them on demand. 0368 = the 0262 record plus player: {age_band, claimed_level, play_years, play_wants, level_confirmed, level_confirmed_at, level_confirmed_role, level_confirmed_by_name, level_note, effective_level, suggested (app.level_suggested: {level, games, wins, losses, score} or null), interests (app.customer_interest_tags over the last 180 days at the branches in scope, derived, never asked)}. 0262 = the 0065 record plus customer.gender and customer.gender_set_by (OM-28) and matches[]; counts gain matchesPlayed, matchNoShows, lateLeaves (customer_counts). Court desk, cashier, manager, owner. CUSTOMER_NOT_FOUND.';

revoke all on function app.customer_record(uuid) from public, anon;
grant execute on function app.customer_record(uuid) to authenticated;
