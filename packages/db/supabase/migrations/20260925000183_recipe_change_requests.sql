-- 0183 recipe_change_requests — the head barista and the head chef ask for a recipe
-- change, and the owner approves or declines it.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.7, §2.21, §2.22, §3; plan #71, #72).
-- Depends on: staff_push_keys (J: recipe_change_submitted, _approved,
-- _declined). The approve calls the public app.set_recipe (0063), which is
-- not re-issued.
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- WHAT A HEAD SENDS. A target (a size of an active cafe item, or an active
-- prepared ingredient's output recipe) and 1 to 30 ops, written without the
-- current quantities, which a head never reads (#72): set a line's quantity,
-- remove a line, or add an active purchased or prepared ingredient of the
-- venue. The server stores the target's lines at the time (before) and the
-- lines an approval writes (after). Add-on recipes are not a target
-- (PROPOSAL).
--
-- WHO DECIDES. The owner, never on their own request (#71). The approve
-- checks that the target is still active and its lines still match before
-- (RECIPE_CHANGED otherwise: a manager edited it in Stock ▸ Recipes, or
-- another request was applied first), then writes after through
-- app.set_recipe as the owner, which passes its MGMT guard: the change goes
-- the recipe path, with set_recipe's own stock.recipe.set audit and its cycle
-- trigger (RECIPE_CYCLE surfaces unchanged). The manager reads every request
-- and keeps editing recipes directly in Stock ▸ Recipes.
--
-- WHO READS. The table is MGMT at the venue. A head reads their own requests
-- through my_recipe_changes, which carries their own numbers only: never
-- before, after or any current quantity.
--
-- covered by packages/db/tests/recipe-change-requests.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists recipe_change_requests (
  id                    uuid primary key default gen_random_uuid(),
  venue_id              uuid not null references venues(id),
  target                text not null check (target in ('variant','output')),
  variant_id            uuid references menu_item_variants(id) on delete cascade,
  output_ingredient_id  uuid references ingredients(id) on delete cascade,
  requested_by          uuid not null references staff(id),
  requested_at          timestamptz not null default now(),
  ops                   jsonb not null,
  before                jsonb not null,
  after                 jsonb not null,
  note                  text check (note is null or length(note) <= 1000),
  status                text not null default 'waiting'
                        check (status in ('waiting','approved','declined','withdrawn')),
  decided_by            uuid references staff(id),
  decided_at            timestamptz,
  decline_reason        text check (decline_reason is null or length(decline_reason) <= 1000),
  constraint recipe_change_requests_target_chk
    check ((target = 'variant') = (variant_id is not null)
           and (target = 'output') = (output_ingredient_id is not null)),
  constraint recipe_change_requests_decided_chk check ((status in ('approved','declined')) = (decided_by is not null)),
  constraint recipe_change_requests_decided_at_chk check ((decided_by is null) = (decided_at is null)),
  constraint recipe_change_requests_not_own_chk check (decided_by is null or decided_by <> requested_by),
  constraint recipe_change_requests_reason_chk
    check (status <> 'declined' or coalesce(length(btrim(decline_reason)),0) > 0)
);

create index if not exists recipe_change_requests_venue_status_idx
  on recipe_change_requests (venue_id, status, requested_at);

comment on table recipe_change_requests is
  'recipe_change_requests (§2.24.7, #71): a head''s asked-for change to a recipe, which the owner approves (written through app.set_recipe) or declines with a reason. Read by MGMT at the venue; a head reads their own through app.my_recipe_changes, without any current quantity.';
comment on column recipe_change_requests.id is 'Request id.';
comment on column recipe_change_requests.venue_id is 'The venue.';
comment on column recipe_change_requests.target is 'variant (a size of a cafe item) or output (a prepared ingredient''s output recipe).';
comment on column recipe_change_requests.variant_id is 'The size whose recipe changes, when target = variant.';
comment on column recipe_change_requests.output_ingredient_id is 'The prepared ingredient whose output recipe changes, when target = output.';
comment on column recipe_change_requests.requested_by is 'The head who asked.';
comment on column recipe_change_requests.requested_at is 'When it was asked.';
comment on column recipe_change_requests.ops is 'The head''s changes, normalised: [{op: set, recipe_line_id, ingredient_id, qty} | {op: remove, recipe_line_id, ingredient_id} | {op: add, ingredient_id, qty}], quantities in the ingredient''s base unit.';
comment on column recipe_change_requests.before is 'The target''s lines when it was asked: [{recipe_line_id, ingredient_id, qty}]. An approve refuses a target that no longer matches.';
comment on column recipe_change_requests.after is 'The lines an approval writes: [{ingredient_id, qty}].';
comment on column recipe_change_requests.note is 'The head''s note, as typed (at most 1000 characters).';
comment on column recipe_change_requests.status is 'waiting, approved or declined (by the owner), or withdrawn (by the head).';
comment on column recipe_change_requests.decided_by is 'The owner who decided; never the requester.';
comment on column recipe_change_requests.decided_at is 'When it was decided.';
comment on column recipe_change_requests.decline_reason is 'Why it was declined, as typed (at most 1000 characters); required on a decline.';

alter table recipe_change_requests enable row level security;

drop policy if exists recipe_change_requests_mgmt_read on recipe_change_requests;
create policy recipe_change_requests_mgmt_read on recipe_change_requests
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on recipe_change_requests to authenticated;
grant all on recipe_change_requests to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.request_recipe_change — the head barista and the head chef at the
--    venue. Tells the owners.
-- ---------------------------------------------------------------------------
create or replace function app.request_recipe_change(
  p_target          text,
  p_target_id       uuid,
  p_ops             jsonb,
  p_note            text default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $request_recipe_change_0183$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_venue   uuid;
  v_replay  jsonb;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_name_en text;
  v_name_ar text;
  v_before  jsonb;
  v_el      jsonb;
  v_n       int := 0;
  v_op      text;
  v_line    uuid;
  v_ing     uuid;
  v_qty     numeric;
  v_ops     jsonb := '[]'::jsonb;
  v_set     jsonb := '{}'::jsonb;     -- recipe_line_id -> new qty
  v_removed uuid[] := '{}';
  v_named   uuid[] := '{}';           -- lines named by an op
  v_added   uuid[] := '{}';
  v_after   jsonb;
  v_id      uuid;
  v_result  jsonb;
begin
  if not app.is_staff('head_barista','head_chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_barista','head_chef')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'request_recipe_change');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_target is null or p_target not in ('variant','output') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'target';
  end if;
  -- A size of an active item in a cafe category, or an active prepared
  -- ingredient, at the venue. Shop products and items in release are neither.
  if p_target = 'variant' then
    select mi.name_en, mi.name_ar into v_name_en, v_name_ar
      from menu_item_variants v
      join menu_items mi on mi.id = v.item_id
      join menu_categories c on c.id = mi.category_id
     where v.id = p_target_id and mi.venue_id = v_venue and mi.is_active and c.kind = 'cafe';
  else
    select i.name_en, i.name_ar into v_name_en, v_name_ar
      from ingredients i
     where i.id = p_target_id and i.venue_id = v_venue and i.is_active and i.kind = 'prepared';
  end if;
  if not found then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'target_id';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  -- The target's lines now, in a stable order: what the approve re-checks.
  select coalesce(jsonb_agg(jsonb_build_object('recipe_line_id', rl.id, 'ingredient_id', rl.ingredient_id,
                                               'qty', rl.qty) order by rl.id), '[]'::jsonb)
    into v_before
    from recipe_lines rl
   where (p_target = 'variant' and rl.variant_id = p_target_id)
      or (p_target = 'output' and rl.output_ingredient_id = p_target_id);

  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) not between 1 and 30 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'ops';
  end if;
  for v_el in select e from jsonb_array_elements(p_ops) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s', v_n);
    end if;
    v_op := v_el->>'op';
    if v_op is null or v_op not in ('set','remove','add') then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.op', v_n);
    end if;

    v_qty := null;
    if v_op in ('set','add') then
      if coalesce(jsonb_typeof(v_el->'qty'), 'null') <> 'number' then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.qty', v_n);
      end if;
      v_qty := round((v_el->>'qty')::numeric, 3);
      if v_qty <= 0 or v_qty >= 1000000000 then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.qty', v_n);
      end if;
    end if;

    if v_op in ('set','remove') then
      -- A current line of this target, named once.
      if coalesce(v_el->>'recipe_line_id', '') !~ c_uuid then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.recipe_line_id', v_n);
      end if;
      v_line := (v_el->>'recipe_line_id')::uuid;
      select (b->>'ingredient_id')::uuid into v_ing
        from jsonb_array_elements(v_before) b
       where (b->>'recipe_line_id')::uuid = v_line;
      if not found or v_line = any(v_named) then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.recipe_line_id', v_n);
      end if;
      v_named := v_named || v_line;
      if v_op = 'set' then
        v_set := v_set || jsonb_build_object(v_line::text, v_qty);
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'set', 'recipe_line_id', v_line,
                                                               'ingredient_id', v_ing, 'qty', v_qty));
      else
        v_removed := v_removed || v_line;
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'remove', 'recipe_line_id', v_line,
                                                               'ingredient_id', v_ing));
      end if;
    else
      if coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.ingredient_id', v_n);
      end if;
      v_ing := (v_el->>'ingredient_id')::uuid;
      -- What staff_ingredient_options lists: an active purchased or prepared
      -- ingredient of the venue.
      if not exists (select 1 from ingredients i
                      where i.id = v_ing and i.venue_id = v_venue and i.is_active
                        and i.kind in ('purchased','prepared')) then
        raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', hint = format('ops.%s.ingredient_id', v_n);
      end if;
      -- Not on the target already (a set changes that line), not twice, and
      -- not the prepared ingredient itself.
      if v_ing = any(v_added)
         or (p_target = 'output' and v_ing = p_target_id)
         or exists (select 1 from jsonb_array_elements(v_before) b where (b->>'ingredient_id')::uuid = v_ing) then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = format('ops.%s.ingredient_id', v_n);
      end if;
      v_added := v_added || v_ing;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'ingredient_id', v_ing, 'qty', v_qty));
    end if;
    v_n := v_n + 1;
  end loop;

  -- What an approval writes: the lines kept (with their new quantity where
  -- set), then the added ones in the order sent.
  select coalesce(jsonb_agg(x.line order by x.ord), '[]'::jsonb)
    into v_after
    from (select b.ord,
                 jsonb_build_object('ingredient_id', b.e->'ingredient_id',
                                    'qty', coalesce(v_set->(b.e->>'recipe_line_id'), b.e->'qty')) as line
            from jsonb_array_elements(v_before) with ordinality as b(e, ord)
           where not ((b.e->>'recipe_line_id')::uuid = any(v_removed))
          union all
          select 100000 + o.ord, jsonb_build_object('ingredient_id', o.e->'ingredient_id', 'qty', o.e->'qty')
            from jsonb_array_elements(v_ops) with ordinality as o(e, ord)
           where o.e->>'op' = 'add') x;
  if jsonb_array_length(v_after) = 0 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'ops';
  end if;

  insert into recipe_change_requests (venue_id, target, variant_id, output_ingredient_id, requested_by,
                                      ops, before, after, note)
  values (v_venue, p_target,
          case when p_target = 'variant' then p_target_id end,
          case when p_target = 'output' then p_target_id end,
          auth.uid(), v_ops, v_before, v_after, v_note)
  returning id into v_id;

  perform app.write_audit('stock.recipe.change_submit', 'recipe_change_request', v_id::text, null,
                          jsonb_build_object('target', p_target, 'target_id', p_target_id,
                                             'ops', jsonb_array_length(v_ops), 'status', 'waiting'));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['owner']::staff_role[]),
    'staff_decide',
    jsonb_build_object(
      'route', 'staff',
      'id', v_id,
      'title_key', 'recipe_change_submitted',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                   'step', jsonb_build_object('en', v_name_en, 'ar', v_name_ar))));

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $request_recipe_change_0183$;

comment on function app.request_recipe_change(text, uuid, jsonb, text, uuid, text) is
  'recipe_change_requests (§2.24.7). The head barista and the head chef at the venue: asks for a change to a size''s recipe (target variant, an active cafe item) or a prepared ingredient''s output recipe (target output), p_ops 1 to 30 of {op: set, recipe_line_id, qty} | {op: remove, recipe_line_id} | {op: add, ingredient_id, qty} (qty above 0, below 10^9, base unit, 3 places), and tells the owners (staff_decide / recipe_change_submitted). Stores the target''s lines (before) and what an approval writes (after). Returns {id}. Idempotent by key. FORBIDDEN, INVALID_ARGUMENT (hint target), REF_NOT_FOUND (hint target_id), INGREDIENT_NOT_FOUND (an add), RECORD_INVALID (hint ops.<n>.<field> or ops), TEXT_TOO_LONG (hint note). Audit stock.recipe.change_submit.';

revoke all on function app.request_recipe_change(text, uuid, jsonb, text, uuid, text) from public, anon;
grant execute on function app.request_recipe_change(text, uuid, jsonb, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.withdraw_recipe_change — the requester, while it waits.
-- ---------------------------------------------------------------------------
create or replace function app.withdraw_recipe_change(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_recipe_change_0183$
declare
  v_row recipe_change_requests%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from recipe_change_requests where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if v_row.requested_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;

  update recipe_change_requests set status = 'withdrawn' where id = p_id;

  perform app.write_audit('stock.recipe.change_withdraw', 'recipe_change_request', p_id::text,
                          jsonb_build_object('status', 'waiting'),
                          jsonb_build_object('status', 'withdrawn'));
  return jsonb_build_object('status', 'withdrawn');
end $withdraw_recipe_change_0183$;

comment on function app.withdraw_recipe_change(uuid) is
  'recipe_change_requests (§2.24.7). The requester takes back a waiting request. Returns {status}. REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED. Audit stock.recipe.change_withdraw.';

revoke all on function app.withdraw_recipe_change(uuid) from public, anon;
grant execute on function app.withdraw_recipe_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.decide_recipe_change — the owner, never on their own request. An
--    approve re-checks the target and writes it through app.set_recipe.
-- ---------------------------------------------------------------------------
create or replace function app.decide_recipe_change(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_recipe_change_0183$
declare
  v_row     recipe_change_requests%rowtype;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now     jsonb;
  v_active  boolean;
  v_written int := 0;
  v_name_en text;
  v_name_ar text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from recipe_change_requests where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.requested_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'approve';
  end if;

  if v_row.target = 'variant' then
    select mi.name_en, mi.name_ar, (mi.is_active and c.kind = 'cafe')
      into v_name_en, v_name_ar, v_active
      from menu_item_variants v
      join menu_items mi on mi.id = v.item_id
      join menu_categories c on c.id = mi.category_id
     where v.id = v_row.variant_id;
  else
    select i.name_en, i.name_ar, (i.is_active and i.kind = 'prepared')
      into v_name_en, v_name_ar, v_active
      from ingredients i
     where i.id = v_row.output_ingredient_id;
  end if;

  if p_approve then
    -- The target as it stands must be the target the head saw.
    select coalesce(jsonb_agg(jsonb_build_object('recipe_line_id', rl.id, 'ingredient_id', rl.ingredient_id,
                                                 'qty', rl.qty) order by rl.id), '[]'::jsonb)
      into v_now
      from recipe_lines rl
     where (v_row.target = 'variant' and rl.variant_id = v_row.variant_id)
        or (v_row.target = 'output' and rl.output_ingredient_id = v_row.output_ingredient_id);
    if not coalesce(v_active, false) or v_now is distinct from v_row.before then
      raise exception 'RECIPE_CHANGED' using errcode = 'P0001';
    end if;

    -- The recipe path, as the owner: set_recipe's own audit and cycle check.
    v_written := app.set_recipe(v_row.target,
                                coalesce(v_row.variant_id, v_row.output_ingredient_id),
                                v_row.after);

    update recipe_change_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now()
     where id = p_id
     returning * into v_row;
    perform app.write_audit('stock.recipe.change_approve', 'recipe_change_request', p_id::text,
                            jsonb_build_object('status', 'waiting'),
                            jsonb_build_object('status', 'approved', 'lines_written', v_written));
  else
    if v_reason is null then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    if length(v_reason) > 1000 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
    end if;
    update recipe_change_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = v_reason
     where id = p_id
     returning * into v_row;
    perform app.write_audit('stock.recipe.change_decline', 'recipe_change_request', p_id::text,
                            jsonb_build_object('status', 'waiting'),
                            jsonb_build_object('status', 'declined'));
  end if;

  perform app.notify_staff(
    array[v_row.requested_by],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', v_row.id,
      'title_key', case when p_approve then 'recipe_change_approved' else 'recipe_change_declined' end,
      'params', jsonb_build_object('step', jsonb_build_object('en', v_name_en, 'ar', v_name_ar))));

  return jsonb_build_object('status', v_row.status, 'lines_written', v_written);
end $decide_recipe_change_0183$;

comment on function app.decide_recipe_change(uuid, boolean, text) is
  'recipe_change_requests (§2.24.7). The owner, at the request''s venue, never on their own: an approve checks the target is still active and its lines still match the request''s before (else RECIPE_CHANGED), writes after through app.set_recipe (its stock.recipe.set audit and cycle check: RECIPE_CYCLE, INGREDIENT_NOT_FOUND, INVALID_QTY, VARIANT_NOT_FOUND), and tells the head (recipe_change_approved); a decline needs a reason (at most 1000) and tells the head (recipe_change_declined). Returns {status, lines_written}. REF_NOT_FOUND, FORBIDDEN, CANNOT_DECIDE_OWN, SUBMISSION_DECIDED, INVALID_ARGUMENT (hint approve), REASON_REQUIRED, TEXT_TOO_LONG. Audit stock.recipe.change_approve or stock.recipe.change_decline.';

revoke all on function app.decide_recipe_change(uuid, boolean, text) from public, anon;
grant execute on function app.decide_recipe_change(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.recipe_changes_page — MGMT at the venue (the manager reads, the
--    owner decides): waiting, decided or all, with the numbers.
-- ---------------------------------------------------------------------------
create or replace function app.recipe_changes_page(
  p_venue_id uuid default null,
  p_filter   text default 'waiting',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $recipe_changes_page_0183$
declare
  v_venue    uuid;
  v_filter   text := coalesce(p_filter, 'waiting');
  v_statuses text[];
  v_limit    int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   int := greatest(coalesce(p_offset, 0), 0);
  v_rows     jsonb;
  v_total    int;
  v_waiting  int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_statuses := case v_filter
                  when 'waiting' then array['waiting']
                  when 'decided' then array['approved','declined']
                  when 'all'     then array['waiting','approved','declined','withdrawn']
                end;
  if v_statuses is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;

  select count(*) into v_total
    from recipe_change_requests q where q.venue_id = v_venue and q.status = any(v_statuses);
  select count(*) into v_waiting
    from recipe_change_requests q where q.venue_id = v_venue and q.status = 'waiting';

  -- Waiting ones oldest first; the rest newest first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                   x.id,
           'target',               x.target,
           'variant_id',           x.variant_id,
           'output_ingredient_id', x.output_ingredient_id,
           'item_name_en',         coalesce(mi.name_en, oi.name_en),
           'item_name_ar',         coalesce(mi.name_ar, oi.name_ar),
           'size_name_en',         v.name_en,
           'size_name_ar',         v.name_ar,
           'requested_by_name',    rq.display_name,
           'requested_at',         x.requested_at,
           'note',                 x.note,
           'status',               x.status,
           'decided_by_name',      dc.display_name,
           'decided_at',           x.decided_at,
           'decline_reason',       x.decline_reason,
           'stale',                x.status = 'waiting' and now_lines.lines is distinct from x.before,
           'before',               (select coalesce(jsonb_agg(jsonb_build_object(
                                             'recipe_line_id', b.e->'recipe_line_id',
                                             'ingredient_id',  b.e->'ingredient_id',
                                             'name_en',        i.name_en,
                                             'name_ar',        i.name_ar,
                                             'qty',            b.e->'qty',
                                             'unit',           i.unit) order by b.ord), '[]'::jsonb)
                                      from jsonb_array_elements(x.before) with ordinality as b(e, ord)
                                      left join ingredients i on i.id = (b.e->>'ingredient_id')::uuid),
           'after',                (select coalesce(jsonb_agg(jsonb_build_object(
                                             'ingredient_id', a.e->'ingredient_id',
                                             'name_en',       i.name_en,
                                             'name_ar',       i.name_ar,
                                             'qty',           a.e->'qty',
                                             'unit',          i.unit) order by a.ord), '[]'::jsonb)
                                      from jsonb_array_elements(x.after) with ordinality as a(e, ord)
                                      left join ingredients i on i.id = (a.e->>'ingredient_id')::uuid))
         order by x.ord), '[]'::jsonb)
    into v_rows
    from (select q.*,
                 row_number() over (order by
                   case when v_filter = 'waiting' then q.requested_at end asc,
                   case when v_filter <> 'waiting' then q.requested_at end desc,
                   q.id) as ord
            from recipe_change_requests q
           where q.venue_id = v_venue and q.status = any(v_statuses)
           order by ord
           limit v_limit offset v_offset) x
    left join menu_item_variants v on v.id = x.variant_id
    left join menu_items mi on mi.id = v.item_id
    left join ingredients oi on oi.id = x.output_ingredient_id
    left join staff rq on rq.id = x.requested_by
    left join staff dc on dc.id = x.decided_by
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('recipe_line_id', rl.id, 'ingredient_id', rl.ingredient_id,
                                                   'qty', rl.qty) order by rl.id), '[]'::jsonb) as lines
        from recipe_lines rl
       where (x.target = 'variant' and rl.variant_id = x.variant_id)
          or (x.target = 'output' and rl.output_ingredient_id = x.output_ingredient_id)) now_lines;

  return jsonb_build_object('requests', v_rows, 'waiting_count', v_waiting, 'total', v_total);
end $recipe_changes_page_0183$;

comment on function app.recipe_changes_page(uuid, text, int, int) is
  'recipe_change_requests (§2.24.7). MGMT at the venue: {requests: [{id, target, variant_id, output_ingredient_id, item_name_en, item_name_ar, size_name_en, size_name_ar, requested_by_name, requested_at, note, status, decided_by_name, decided_at, decline_reason, stale, before: [{recipe_line_id, ingredient_id, name_en, name_ar, qty, unit}], after: [{ingredient_id, name_en, name_ar, qty, unit}]}], waiting_count, total} for p_filter waiting (oldest first), decided or all (newest first), p_limit 1 to 200. stale: a waiting request whose target no longer matches its before. INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.recipe_changes_page(uuid, text, int, int) from public, anon;
grant execute on function app.recipe_changes_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.my_recipe_changes — a head's own requests: their own numbers only,
--    never before, after or any current quantity (#72).
-- ---------------------------------------------------------------------------
create or replace function app.my_recipe_changes(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_recipe_changes_0183$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if not app.is_staff('head_barista','head_chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_barista','head_chef')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              x.id,
           'target',          x.target,
           'item_name_en',    coalesce(mi.name_en, oi.name_en),
           'item_name_ar',    coalesce(mi.name_ar, oi.name_ar),
           'size_name_en',    v.name_en,
           'size_name_ar',    v.name_ar,
           'ops',             (select coalesce(jsonb_agg(jsonb_build_object(
                                        'op',            o.e->'op',
                                        'ingredient_id', o.e->'ingredient_id',
                                        'name_en',       i.name_en,
                                        'name_ar',       i.name_ar,
                                        -- The head's own number on a set or an add; none on a remove.
                                        'qty',           case when o.e->>'op' in ('set','add') then o.e->'qty' end,
                                        'unit',          i.unit) order by o.ord), '[]'::jsonb)
                                 from jsonb_array_elements(x.ops) with ordinality as o(e, ord)
                                 left join ingredients i on i.id = (o.e->>'ingredient_id')::uuid),
           'note',            x.note,
           'status',          x.status,
           'requested_at',    x.requested_at,
           'decided_by_name', dc.display_name,
           'decided_at',      x.decided_at,
           'decline_reason',  x.decline_reason)
         order by x.requested_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from recipe_change_requests q
           where q.venue_id = v_venue and q.requested_by = auth.uid()
           order by q.requested_at desc, q.id
           limit v_limit) x
    left join menu_item_variants v on v.id = x.variant_id
    left join menu_items mi on mi.id = v.item_id
    left join ingredients oi on oi.id = x.output_ingredient_id
    left join staff dc on dc.id = x.decided_by;

  return jsonb_build_object('requests', v_rows);
end $my_recipe_changes_0183$;

comment on function app.my_recipe_changes(uuid, int) is
  'recipe_change_requests (§2.24.7). The head barista and the head chef at the venue: {requests: [{id, target, item_name_en, item_name_ar, size_name_en, size_name_ar, ops: [{op, ingredient_id, name_en, name_ar, qty, unit}], note, status, requested_at, decided_by_name, decided_at, decline_reason}]}, their own, newest first, p_limit 1 to 100. qty only on their own set and add ops; before, after and every current quantity are never returned (#72). FORBIDDEN for anyone else.';

revoke all on function app.my_recipe_changes(uuid, int) from public, anon;
grant execute on function app.my_recipe_changes(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Owner assistant: recipe_change_requests joins the table_read allowlist
--    (the 0144 statement, limited to this migration's table, §1.5); its
--    jsonb columns are not default reads.
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
   and c.table_name in ('recipe_change_requests')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
