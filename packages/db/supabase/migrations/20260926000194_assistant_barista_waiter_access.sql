-- 0194 assistant_barista_waiter_access — the assistant barista and the waiter
-- pass the guards they are meant to pass, and no other.
--
-- Feature: protocols and the staff phone, wave 5, lane R
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.1.2, §2.1.4, §2.1.5,
-- §2.1.8, §2.10; Majed's answers #1 and #3, and §8 Q3 answered 2026-09-25).
-- Depends on: staff_roles_assistant_waiter (R: the two staff_role values).
-- Re-runnable: create or replace, drop policy if exists + create policy, the
-- guarded realtime DO block.
--
-- WHAT EVERY ROLE ALREADY HAS. 0156 made the any-staff guards role-agnostic,
-- so both roles sign in, take breaks, send requests and suggestions, tick
-- their checklists (a photo-required line with a checklists slot), ask
-- marketing and note new items with no re-issue here (§2.1.1).
--
-- THE ASSISTANT BARISTA joins BOARD and the bar team (PROPOSAL, §8 Q1: he
-- makes drinks from the bar's tickets): set_ticket_status,
-- set_order_item_ready, tickets_staff_read, the kds and floor realtime topics
-- and kitchen_board gain him beside the barista; app.staff_team maps him to
-- 'bar', whose head is still head_barista, so a bar teaching's push, its
-- list and its photos (the unchanged 0170:374 read rule) reach him; and
-- recipe_view reads to him, names only (#3: no quantity for anyone). No
-- ideas, no shopping list, no stock, no production, no till (§8 Q1).
--
-- THE WAITER joins no team and no board (PROPOSAL, §8 Q2; §8 Q3 answered):
-- no tickets, no till. He answers guests' "call a waiter" (§2.1.8): the
-- waiter_calls read, ack_waiter_call, resolve_waiter_call and the 'floor'
-- realtime topic (not 'kds') gain him. The two calls now answer a call at
-- another venue as CALL_NOT_FOUND, for every role (the row-addressed rule);
-- the table label he reads through cafe_tables_staff_read, which is any
-- staff at the venue since 0156 and needs nothing. The push that tells him
-- (waiter_call_new) is lane P's. His cleaning photos are the checklists
-- folder and its read rule, unchanged. Move stock is lane S's.
--
-- BOTH are hireable: protocol_engine_roles (an owner-added step's actors,
-- which the checklist and step pickers follow) and the hiring position's role
-- check gain them, in the @touch/core HIREABLE_ROLES order.
--
-- The order-side reads stay explicit lists naming neither (0157, narrowed by
-- 0161), and so does every money read. set_staff_role (0157:66) and
-- save_checklist_template (0184:318) refuse only prep and need nothing.
--
-- Every function is its LATEST body, copied verbatim from the file named
-- beside it (re-checked with the §2.10 command), with the role list and the
-- dollar tag changed and nothing else, but for the venue check the two
-- waiter-call wrappers gain (section 11); the three comments that name a role
-- list say so. Signatures are unchanged, so each keeps its grants; the
-- revoke/grant pair the latest file used is re-issued anyway. Each policy is
-- its latest definition with only the role test changed.
--
-- covered by packages/db/tests/assistant-barista-waiter.test.ts, and the role
-- cases of kitchen-board, teachings, recipe-view and hiring .test.ts; the
-- waiter-call rules re-stated in tests/rls-matrix.ts (lane R block)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.set_ticket_status — 0156:598 verbatim; BOARD + assistant_barista.
-- ---------------------------------------------------------------------------
create or replace function app.set_ticket_status(
  p_ticket_id uuid,
  p_status    ticket_status,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_ticket_status_0194$
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.ticket_transition(p_ticket_id, p_status, p_device_id, null);
end $set_ticket_status_0194$;

revoke all on function app.set_ticket_status(uuid, ticket_status, text) from public, anon;
grant execute on function app.set_ticket_status(uuid, ticket_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.set_order_item_ready — 0156:617 verbatim; BOARD + assistant_barista.
-- ---------------------------------------------------------------------------
create or replace function app.set_order_item_ready(
  p_order_item_id uuid,
  p_ready         boolean,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_order_item_ready_0194$
declare
  v_oi     order_items%rowtype;
  v_ticket tickets%rowtype;
  v_all    boolean;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_oi from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select * into v_ticket from tickets where order_id = v_oi.order_id;
  if found and v_ticket.status in ('completed','voided') then
    raise exception 'TICKET_CLOSED' using errcode = 'P0001',
      hint = 'a finished ticket''s marks are history, not state';
  end if;

  if p_ready then
    -- Idempotent: a double-tap (or a replay) keeps the FIRST timestamp.
    update order_items set ready_at = coalesce(ready_at, now())
     where id = p_order_item_id
     returning * into v_oi;
  else
    update order_items set ready_at = null
     where id = p_order_item_id
     returning * into v_oi;
  end if;

  select bool_and(ready_at is not null) into v_all
    from order_items where order_id = v_oi.order_id and not voided;

  return jsonb_build_object(
    'order_item_id',   v_oi.id,
    'ready_at',        v_oi.ready_at,
    'all_items_ready', coalesce(v_all, false),
    'ticket_id',       v_ticket.id);
end $set_order_item_ready_0194$;

revoke all on function app.set_order_item_ready(uuid, boolean, text) from public, anon;
grant execute on function app.set_order_item_ready(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Kitchen policies — 0156:787-814; the venue conjunct and the realtime
--    guard kept, BOARD + assistant_barista; the waiter on 'floor' only.
-- ---------------------------------------------------------------------------
-- tickets (0156:788)
drop policy if exists tickets_staff_read on tickets;
create policy tickets_staff_read on tickets for select to authenticated
  using (app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef')
         and venue_id = any(app.staff_venue_ids()));

-- realtime.messages kds / floor (0156:806). Guarded exactly as 0022 is: the
-- realtime schema is absent on a bare Postgres, and the policy with it. The
-- waiter takes 'floor' alone (§2.1.8): rt_waiter_call's send (0033) carries
-- the call id, table id, reason, status and time, and nothing else is sent
-- there; 'kds' carries the tickets and stays BOARD's.
do $rt_staff_topics_0194$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_staff_topics on realtime.messages
  $p$;

  execute $p$
    create policy touchpadel_rt_staff_topics on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and ((realtime.topic() in ('kds','floor')
              and app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef'))
             or (realtime.topic() = 'floor' and app.is_staff('waiter')))
      )
  $p$;
end $rt_staff_topics_0194$;

-- ---------------------------------------------------------------------------
-- 4. app.kitchen_board — 0158:42 verbatim; both lists (:50, :57-58) +
--    assistant_barista. The payload is unchanged: no money key at any depth.
-- ---------------------------------------------------------------------------
create or replace function app.kitchen_board(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $kitchen_board_0194$
declare
  v_venues   uuid[];
  v_bookings boolean;
  v_tickets  jsonb;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null then
    -- The old tickets_staff_read venue axis: the owner's active venues, anyone
    -- else's active memberships.
    v_venues := app.staff_venue_ids();
  elsif app.is_staff_at(p_venue_id, 'prep','cashier','manager','owner',
                        'head_barista','barista','assistant_barista','head_chef','chef') then
    v_venues := array[p_venue_id];
  else
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The booking's guest name: only where the caller's own policy reads the
  -- booking (reservations_staff_read, and reservations_cashier_read through
  -- the tab that holds it).
  v_bookings := app.is_staff('cashier','manager','owner');

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',               t.id,
             'status',           t.status,
             'target_seconds',   t.target_seconds,
             'created_at',       t.created_at,
             'completed_at',     t.completed_at,
             'last_actor_label', t.last_actor_label,
             'order', jsonb_build_object(
               'id',     o.id,
               'source', o.source,
               'status', o.status,
               'tab', (select jsonb_build_object(
                                'id',    tb.id,
                                'label', tb.label,
                                'table', (select jsonb_build_object('table_number', ct.table_number)
                                            from cafe_tables ct where ct.id = tb.table_id),
                                'reservation', case when v_bookings then
                                                 (select jsonb_build_object('id', r.id, 'guest_name', r.guest_name)
                                                    from reservations r where r.id = tb.reservation_id)
                                               end)
                         from tabs tb where tb.id = o.tab_id),
               'order_items', coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'id',       oi.id,
                            'qty',      oi.qty,
                            'notes',    oi.notes,
                            'voided',   oi.voided,
                            'ready_at', oi.ready_at,
                            'menu_item', (select jsonb_build_object('name_en', mi.name_en, 'name_ar', mi.name_ar)
                                            from menu_items mi where mi.id = oi.menu_item_id),
                            'variant', (select jsonb_build_object('name_en', v.name_en, 'name_ar', v.name_ar)
                                          from menu_item_variants v where v.id = oi.variant_id),
                            'order_item_modifiers', coalesce((
                              select jsonb_agg(
                                       jsonb_build_object(
                                         'qty', oim.qty,
                                         'modifier', jsonb_build_object('name_en', m.name_en, 'name_ar', m.name_ar))
                                       order by m.sort_order, m.id)
                                from order_item_modifiers oim
                                join modifiers m on m.id = oim.modifier_id
                               where oim.order_item_id = oi.id), '[]'::jsonb))
                          order by oi.line_no)
                   from order_items oi
                  where oi.order_id = o.id), '[]'::jsonb)))
           order by t.created_at), '[]'::jsonb)
    into v_tickets
    from tickets t
    join orders o on o.id = t.order_id
   where t.venue_id = any(v_venues)
     and (t.status in ('queued','preparing','ready')
          or (t.status = 'completed' and t.completed_at >= now() - interval '2 minutes'));

  return jsonb_build_object('tickets', v_tickets);
end $kitchen_board_0194$;

comment on function app.kitchen_board(uuid) is
  'kitchen_board_read (build-contracts §2.23, plan #60): the kitchen board''s tickets at the venue '
  'named, or with none at every venue the caller works at (app.staff_venue_ids(), the old '
  'tickets_staff_read axis), in the shape the board renders: live tickets and those '
  'completed in the last two minutes, a window fixed here; order, tab tag, lines, add-ons, notes '
  'and ready marks; no price, total or cost. The booking is filled for cashier, manager and owner '
  'only. Kitchen list of set_ticket_status at the venue; FORBIDDEN otherwise.';

revoke all on function app.kitchen_board(uuid) from public, anon;
grant execute on function app.kitchen_board(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.staff_team — 0170:176 verbatim; the assistant barista is 'bar'.
--    Keeps its SET clause: a revoked language sql helper without one could be
--    inlined past the EXECUTE check (0189).
-- ---------------------------------------------------------------------------
create or replace function app.staff_team(p_role staff_role) returns text
language sql immutable parallel safe set search_path = public as $staff_team_0194$
  select case
    when p_role in ('head_barista', 'barista', 'assistant_barista') then 'bar'
    when p_role in ('head_chef', 'chef')                            then 'kitchen'
  end
$staff_team_0194$;

comment on function app.staff_team(staff_role) is
  'staff_media_folders (§2.1, §2.24.2), re-issued by assistant_barista_waiter_access (wave 5 §2.1.4). Internal: the team a role belongs to, bar (head_barista, barista, assistant_barista) or kitchen (head_chef, chef); NULL for every other role. The twin of @touch/core teamOf.';

revoke all on function app.staff_team(staff_role) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.save_teaching — 0179:80 verbatim; a bar teaching's push reaches the
--    assistant barista (the bar array at :197).
-- ---------------------------------------------------------------------------
create or replace function app.save_teaching(
  p_title           text,
  p_body            text,
  p_team            text   default null,
  p_photos          text[] default '{}',
  p_id              uuid   default null,
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $save_teaching_0194$
declare
  v_venue  uuid;
  v_row    teachings%rowtype;
  v_mgmt   boolean;
  v_team   text;
  v_replay jsonb;
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_photos text[];
  v_id     uuid;
  v_result jsonb;
begin
  if p_id is null then
    if not app.is_staff('head_barista','head_chef','manager','owner') then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    v_venue := coalesce(p_venue_id, app.current_venue());
    if not (v_venue = any(app.staff_venue_ids())
            and app.is_staff_at(v_venue, 'head_barista','head_chef','manager','owner')) then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  else
    -- Row-addressed: a teaching elsewhere, or archived, answers as missing.
    if app.staff_role() is null then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    select * into v_row from teachings where id = p_id for update;
    if not found or not (v_row.venue_id = any(app.staff_venue_ids())) or v_row.archived_at is not null then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
    end if;
    if not (v_row.author_id = auth.uid() or app.is_staff_at(v_row.venue_id, 'manager','owner')) then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    v_venue := v_row.venue_id;
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_mgmt := app.is_staff_at(v_venue, 'manager','owner');

  if p_team is not null and p_team not in ('bar','kitchen') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
  end if;
  if p_id is null then
    if v_mgmt then
      if p_team is null then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
      end if;
      v_team := p_team;
    else
      v_team := app.staff_team(app.staff_role());
      if p_team is not null and p_team is distinct from v_team then
        raise exception 'FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
    v_replay := app.claim_replay(p_idempotency_key, 'save_teaching');
    if v_replay is not null then
      return v_replay;
    end if;
  else
    if p_team is not null and p_team <> v_row.team then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
    end if;
    v_team := v_row.team;
  end if;

  if v_title is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'title';
  end if;
  if length(v_title) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'title';
  end if;
  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 4000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  -- In the order given, once each.
  v_photos := coalesce(array(select x from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_photos) > 6 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'photos';
  end if;

  if p_id is null then
    insert into teachings (venue_id, team, author_id, title, body, photos)
    values (v_venue, v_team, auth.uid(), v_title, v_body, v_photos)
    returning id into v_id;
  else
    update teachings
       set title = v_title, body = v_body, photos = v_photos, updated_at = now()
     where id = p_id
     returning id into v_id;
  end if;

  perform app.claim_staff_media(v_photos, v_venue, array['teachings'], 'teaching:' || v_id::text);

  perform app.write_audit('teaching.save', 'teaching', v_id::text,
                          case when p_id is null then null
                               else jsonb_build_object('photos', cardinality(v_row.photos)) end,
                          jsonb_build_object('team', v_team, 'photos', cardinality(v_photos),
                                             'edit', p_id is not null));

  -- A new teaching tells its team; notify_staff skips the author, and a
  -- head writing several in a row buzzes each reader once in 15 minutes.
  if p_id is null then
    perform app.notify_staff(
      app.staff_ids_with_roles(v_venue, case v_team
                                          when 'bar' then array['head_barista','barista','assistant_barista']::staff_role[]
                                          else array['head_chef','chef']::staff_role[] end),
      'staff_info',
      jsonb_build_object(
        'route', 'staff',
        'id', v_id,
        'title_key', 'teaching_new',
        'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                     'title', v_title)),
      'teaching:' || auth.uid()::text);
  end if;

  v_result := jsonb_build_object('id', v_id);
  if p_id is null and p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $save_teaching_0194$;

comment on function app.save_teaching(text, text, text, text[], uuid, uuid, text) is
  'teachings (§2.24.3). A new teaching (p_id NULL; idempotent by key): the head barista or head chef for their own team (p_team defaults to it, another team is FORBIDDEN), or MGMT for either (p_team required); tells the team (staff_info / teaching_new). An edit: its author, or MGMT at its venue; the team never changes. Title 1 to 120, body 1 to 4000, photos teachings slots of the caller (at most 6). Returns {id}. FORBIDDEN, INVALID_ARGUMENT (hint team or photos), REF_NOT_FOUND (unknown, archived or elsewhere), TEXT_REQUIRED, TEXT_TOO_LONG, PHOTO_PATH_INVALID. Audit teaching.save.';

revoke all on function app.save_teaching(text, text, text, text[], uuid, uuid, text) from public, anon;
grant execute on function app.save_teaching(text, text, text, text[], uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.teachings_for_me — 0179:260 verbatim; both guards (:276, :281).
-- ---------------------------------------------------------------------------
create or replace function app.teachings_for_me(
  p_venue_id uuid default null,
  p_team     text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $teachings_for_me_0194$
declare
  v_venue  uuid;
  v_mgmt   boolean;
  v_teams  text[];
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  int;
begin
  if not app.is_staff('head_barista','barista','assistant_barista','head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','assistant_barista','head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_team is not null and p_team not in ('bar','kitchen') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager','owner');
  if v_mgmt then
    v_teams := case when p_team is null then array['bar','kitchen'] else array[p_team] end;
  else
    v_teams := array[app.staff_team(app.staff_role())];
    if p_team is not null and p_team <> v_teams[1] then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_total
    from teachings t
   where t.venue_id = v_venue and t.team = any(v_teams) and t.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          x.id,
           'team',        x.team,
           'title',       x.title,
           'body',        x.body,
           'photos',      to_jsonb(x.photos),
           'author_name', s.display_name,
           'created_at',  x.created_at,
           'updated_at',  x.updated_at,
           'mine',        x.author_id = auth.uid(),
           'editable',    x.author_id = auth.uid() or v_mgmt)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from teachings t
           where t.venue_id = v_venue and t.team = any(v_teams) and t.archived_at is null
           order by t.created_at desc, t.id
           limit v_limit offset v_offset) x
    left join staff s on s.id = x.author_id;

  return jsonb_build_object('teachings', v_rows, 'total', v_total);
end $teachings_for_me_0194$;

comment on function app.teachings_for_me(uuid, text, int, int) is
  'teachings (§2.24.3), re-issued by assistant_barista_waiter_access (wave 5 §2.1.4). The bar team (head_barista, barista, assistant_barista) and the kitchen team (head_chef, chef) read their own team''s current teachings, MGMT both or the one p_team names: {teachings: [{id, team, title, body, photos, author_name, created_at, updated_at, mine, editable}], total}, newest first, p_limit 1 to 100. FORBIDDEN for anyone else and for another team; INVALID_ARGUMENT (hint team).';

revoke all on function app.teachings_for_me(uuid, text, int, int) from public, anon;
grant execute on function app.teachings_for_me(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.recipe_view — 0182:33 verbatim; both guards (:43, :63). Names only.
-- ---------------------------------------------------------------------------
create or replace function app.recipe_view(
  p_venue_id     uuid default null,
  p_menu_item_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $recipe_view_0194$
declare
  v_venue    uuid;
  v_items    jsonb;
  v_prepared jsonb;
begin
  if not app.is_staff('head_barista','barista','assistant_barista','head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_menu_item_id is not null then
    -- One item: an active cafe item at one of the caller's venues, whose venue
    -- it reads. Anything else answers as missing.
    select mi.venue_id into v_venue
      from menu_items mi
      join menu_categories c on c.id = mi.category_id
     where mi.id = p_menu_item_id
       and mi.is_active
       and c.kind = 'cafe'
       and mi.venue_id = any(app.staff_venue_ids());
    if not found or (p_venue_id is not null and v_venue <> p_venue_id) then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'menu_item_id';
    end if;
  else
    v_venue := coalesce(p_venue_id, app.current_venue());
  end if;
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','assistant_barista','head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'menu_item_id',     mi.id,
           'name_en',          mi.name_en,
           'name_ar',          mi.name_ar,
           'category_name_en', c.name_en,
           'category_name_ar', c.name_ar,
           'sizes',            (select coalesce(jsonb_agg(jsonb_build_object(
                                         'variant_id', v.id,
                                         'name_en',    v.name_en,
                                         'name_ar',    v.name_ar,
                                         'lines',      (select coalesce(jsonb_agg(jsonb_build_object(
                                                                 'recipe_line_id', rl.id,
                                                                 'ingredient_id',  i.id,
                                                                 'name_en',        i.name_en,
                                                                 'name_ar',        i.name_ar)
                                                               order by lower(i.name_en), rl.id), '[]'::jsonb)
                                                          from recipe_lines rl
                                                          join ingredients i on i.id = rl.ingredient_id
                                                         where rl.variant_id = v.id))
                                       order by v.sort_order, v.id), '[]'::jsonb)
                                  from menu_item_variants v
                                 where v.item_id = mi.id))
         order by c.sort_order, lower(c.name_en), mi.sort_order, lower(mi.name_en), mi.id), '[]'::jsonb)
    into v_items
    from menu_items mi
    join menu_categories c on c.id = mi.category_id
   where mi.venue_id = v_venue
     and mi.is_active
     and c.kind = 'cafe'
     and (p_menu_item_id is null or mi.id = p_menu_item_id);

  if p_menu_item_id is not null then
    v_prepared := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'ingredient_id', p.id,
             'name_en',       p.name_en,
             'name_ar',       p.name_ar,
             'lines',         (select coalesce(jsonb_agg(jsonb_build_object(
                                        'recipe_line_id', rl.id,
                                        'ingredient_id',  i.id,
                                        'name_en',        i.name_en,
                                        'name_ar',        i.name_ar)
                                      order by lower(i.name_en), rl.id), '[]'::jsonb)
                                 from recipe_lines rl
                                 join ingredients i on i.id = rl.ingredient_id
                                where rl.output_ingredient_id = p.id))
           order by lower(p.name_en), p.id), '[]'::jsonb)
      into v_prepared
      from ingredients p
     where p.venue_id = v_venue
       and p.is_active
       and p.kind = 'prepared'
       and exists (select 1 from recipe_lines rl where rl.output_ingredient_id = p.id);
  end if;

  return jsonb_build_object('items', v_items, 'prepared', v_prepared);
end $recipe_view_0194$;

comment on function app.recipe_view(uuid, uuid) is
  'recipe_view (§2.24.6, #72). The bar and kitchen family and MGMT at the venue: {items: [{menu_item_id, name_en, name_ar, category_name_en, category_name_ar, sizes: [{variant_id, name_en, name_ar, lines: [{recipe_line_id, ingredient_id, name_en, name_ar}]}]}], prepared: [{ingredient_id, name_en, name_ar, lines: [...]}]}: the active cafe items and the active prepared ingredients with an output recipe, as ingredient names. No quantity, unit, cost or price for anyone (#72, §0 P3). With p_menu_item_id, that item only (REF_NOT_FOUND unless it is an active cafe item at one of the caller''s venues) and prepared is empty. FORBIDDEN for anyone else.';

revoke all on function app.recipe_view(uuid, uuid) from public, anon;
grant execute on function app.recipe_view(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.protocol_engine_roles — 0164:114 verbatim; c_hireable gains both
--    roles (eleven).
-- ---------------------------------------------------------------------------
-- A role list the owner picked for their own step: a non-empty array of
-- distinct hireable roles (never the owner, never the retired prep).
create or replace function app.protocol_engine_roles(p_roles jsonb)
returns staff_role[]
language plpgsql stable set search_path = public as $protocol_engine_roles_0194$
declare
  c_hireable constant text[] := array['cashier','waiter','court_desk','manager','head_barista','barista',
                                      'assistant_barista','head_chef','chef','driver','marketing'];
  v_roles text[];
begin
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) = 0
     or exists (select 1 from jsonb_array_elements(p_roles) e where jsonb_typeof(e) <> 'string') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'actor_roles';
  end if;
  v_roles := array(select jsonb_array_elements_text(p_roles));
  if exists (select 1 from unnest(v_roles) r where not (r = any(c_hireable)))
     or cardinality(v_roles) <> (select count(distinct r) from unnest(v_roles) r) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'actor_roles';
  end if;
  return v_roles::staff_role[];
end $protocol_engine_roles_0194$;

comment on function app.protocol_engine_roles(jsonb) is
  'protocols_engine_rpcs (§2.7). Internal: parses an owner-added step''s actor_roles; INVALID_ROLE unless a non-empty array of distinct hireable roles (cashier, waiter, court_desk, manager, head_barista, barista, assistant_barista, head_chef, chef, driver, marketing), re-issued by assistant_barista_waiter_access (wave 5 §2.1.4).';

revoke all on function app.protocol_engine_roles(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.protocol_check_hiring_open_position — 0176:200 verbatim; the role
--     list at :213-215 gains both.
-- ---------------------------------------------------------------------------
-- The position: a hireable role (never the retired prep), why, the hours, a
-- start date, and an optional pay range.
create or replace function app.protocol_check_hiring_open_position(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_hiring_open_position_0194$
declare
  v_start date;
  v_min   bigint;
  v_max   bigint;
begin
  perform app.hiring_only_keys(p_record, array['role', 'why', 'hours', 'start_date', 'pay_min_iqd', 'pay_max_iqd']);

  if p_record->>'role' = 'prep' then
    raise exception 'ROLE_RETIRED' using errcode = 'P0001', hint = 'role';
  end if;
  if jsonb_typeof(p_record->'role') is distinct from 'string'
     or p_record->>'role' not in ('cashier', 'waiter', 'court_desk', 'manager', 'head_barista', 'barista',
                                  'assistant_barista', 'head_chef', 'chef', 'driver', 'marketing') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'role';
  end if;

  if jsonb_typeof(p_record->'start_date') is distinct from 'string'
     or p_record->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'start_date';
  end if;
  begin
    v_start := (p_record->>'start_date')::date;
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'start_date';
  end;

  v_min := app.hiring_iqd(p_record->'pay_min_iqd', 'pay_min_iqd');
  v_max := app.hiring_iqd(p_record->'pay_max_iqd', 'pay_max_iqd');
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'pay_max_iqd';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'role',        p_record->>'role',
    'why',         app.hiring_text(p_record->'why', 2000, true, 'why'),
    'hours',       app.hiring_text(p_record->'hours', 300, true, 'hours'),
    'start_date',  v_start,
    'pay_min_iqd', v_min,
    'pay_max_iqd', v_max));
end $protocol_check_hiring_open_position_0194$;

comment on function app.protocol_check_hiring_open_position(uuid, jsonb, text[]) is
  'hiring (§2.8). Internal check hook: open_position {role (hireable; ROLE_RETIRED for prep), why, hours (<= 300), start_date (YYYY-MM-DD), pay_min_iqd?, pay_max_iqd? (min <= max)}. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_hiring_open_position(uuid, jsonb, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Waiter calls (§2.1.8, §8 Q3 answered): the waiter answers a guest's
--     call beside the cashier and MGMT. No tab, order or payment read comes
--     with it: 0161's order-side policies stay closed to him.
-- ---------------------------------------------------------------------------
-- waiter_calls (0136:125); the venue conjunct kept.
drop policy if exists waiter_calls_staff_read on waiter_calls;
create policy waiter_calls_staff_read on waiter_calls for select to authenticated
  using (app.is_staff('cashier','manager','owner','waiter')
         and venue_id = any(app.staff_venue_ids()));

-- app.ack_waiter_call — 0032:691 verbatim, + waiter, plus the venue check
-- 0032 never had: past the role guard, a call at a venue outside the
-- caller's answers CALL_NOT_FOUND, as a missing one does (no cross-venue
-- oracle). The call's venue never changes, so waiter_call_transition's own
-- row lock is enough. The grant pair is 0016's, as 0032:1141-1145 restates it.
create or replace function app.ack_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $ack_waiter_call_0194$
declare
  v_venue uuid;
begin
  if not app.is_staff('cashier','manager','owner','waiter') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select venue_id into v_venue from waiter_calls where id = p_call_id;
  if v_venue is null or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'CALL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  return app.waiter_call_transition(p_call_id, 'acknowledged', auth.uid(), null);
end $ack_waiter_call_0194$;

revoke all on function app.ack_waiter_call(uuid) from public, anon;
grant execute on function app.ack_waiter_call(uuid) to authenticated;

-- app.resolve_waiter_call — 0032:702 verbatim, + waiter, and the same venue
-- check.
create or replace function app.resolve_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $resolve_waiter_call_0194$
declare
  v_venue uuid;
begin
  if not app.is_staff('cashier','manager','owner','waiter') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select venue_id into v_venue from waiter_calls where id = p_call_id;
  if v_venue is null or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'CALL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  return app.waiter_call_transition(p_call_id, 'resolved', auth.uid(), null);
end $resolve_waiter_call_0194$;

revoke all on function app.resolve_waiter_call(uuid) from public, anon;
grant execute on function app.resolve_waiter_call(uuid) to authenticated;
