-- 0172 product_release — a new menu item's way onto the menu: the product release
-- hooks, the draft item they build, the owner's launch, the ideas that come
-- before a release, and the guards that keep every other path off the menu.
--
-- Feature: protocols and the staff phone, lane E
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.9, §2.8, §2.18,
-- §2.21, §2.22; plan §5.1, #52, #53, #59, #65).
-- Depends on: protocols_engine_rpcs (0164: the engine that calls the hooks
-- below, app.protocol_engine_text, _decider, _notify), product_test_movement
-- (E: the 'product_test' movement the test step consumes as), J's
-- staff_push_keys (the idea_* push title keys) and staff_media_folders
-- (app.staff_team, app.staff_team_head; the release_idea: read rule and the
-- idea photos' re-claim in app.claim_staff_media and app.staff_media_visible).
-- Re-issues (§2.18), each the latest body verbatim plus what the section
-- says: app.upsert_variant (0013:203) split into upsert_variant_internal and
-- a wrapper; app.upsert_menu_item (0054:48) split into
-- upsert_menu_item_internal and a wrapper; v_variance_report (0019:205);
-- app.report_stock (0068:971).
-- Not re-issued (§2.9): app.protocol_step_defs, app.start_protocol and
-- app.protocol_engine_involved. Ideas are a pre-step, not a step: the head's
-- Start is an ordinary start_protocol whose start hook (below) links the idea.
-- Re-runnable: add column if not exists, guarded constraint work, create …
-- if not exists, create or replace, drop policy if exists, on conflict do
-- nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE RUN. A head (or MGMT) proposes; the manager accepts with a category
-- and the draft item is created, hidden, one size per suggested size at
-- price 0, with the recipe lines whose ingredient exists; the proposer makes
-- test servings (consumed from stock as 'product_test'); the manager prices
-- it and the owner approves the price; marketing prepares; the owner
-- launches it now or on a date. A stopped run deletes its draft.
--
-- NOTHING GOES ON SALE AROUND IT. upsert_menu_item refuses to switch on an
-- item in release or move it into a shop category (ITEM_IN_RELEASE,
-- everyone) and refuses a manager's new cafe item, switch-on of a
-- never-launched cafe item, move of any shop product into a cafe category
-- (ITEM_VIA_RELEASE) and a never-launched shop product saved switched on
-- (LAUNCH_VIA_PROTOCOL). upsert_variant refuses a price change or a new size
-- on an item in release, for everyone (ITEM_IN_RELEASE). A launch now needs
-- the menu photo protocol-action copied. The release's own writes go through
-- the _internal bodies.
--
-- LAUNCHED. menu_items.launched_at is set for every item that exists when
-- this file runs (a fast default, no rewrite), by upsert_menu_item_internal
-- whenever a save leaves an item switched on, and by release_launch_internal.
-- A never-launched item is a draft: launched_at NULL and switched off. An item
-- written around the RPCs switched on with no stamp (a seed, a fixture) is
-- not a draft; it is on sale, so the guards treat it as launched (the size
-- lock of price_promo reads the same test).
--
-- IDEAS (#65). A barista's or chef assistant's idea waits in release_ideas
-- for the head of their team, who starts a product release from it (the
-- start hook takes {idea_id}) or declines it with a reason. The author is not
-- made involved in the run: my_release_ideas shows them its status and step
-- names, never a record.
--
-- covered by packages/db/tests/product-release.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. menu_items: the release that owns a draft, and when an item first went
--    on sale. launched_at is added with now() as its default and the default
--    dropped at once: now() is stable, so Postgres stores it as the column's
--    missing value for every existing row (no rewrite, no UPDATE, no trigger
--    fires), and every item that exists today counts as launched. New rows
--    start NULL.
-- ---------------------------------------------------------------------------
alter table menu_items add column if not exists release_run_id uuid;
alter table menu_items add column if not exists launched_at timestamptz default now();
alter table menu_items alter column launched_at drop default;

do $menu_items_release_fk_0172$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'menu_items_release_run_id_fkey'
                    and conrelid = 'public.menu_items'::regclass) then
    alter table menu_items
      add constraint menu_items_release_run_id_fkey
      foreign key (release_run_id) references protocol_runs(id) on delete set null not valid;
  end if;
end $menu_items_release_fk_0172$;

do $menu_items_release_fk_validate_0172$
begin
  if exists (select 1 from pg_constraint
              where conname = 'menu_items_release_run_id_fkey'
                and conrelid = 'public.menu_items'::regclass and not convalidated) then
    alter table menu_items validate constraint menu_items_release_run_id_fkey;
  end if;
end $menu_items_release_fk_validate_0172$;

comment on column menu_items.release_run_id is
  'product_release (§2.9): the product release run that created this item as a draft. While that run is not live or done the item is "in release": it cannot be switched on and its prices come from the release''s price step only (ITEM_IN_RELEASE). NULL for items created any other way.';
comment on column menu_items.launched_at is
  'product_release (§2.9): when the item first went on sale. Every item that existed when the column was added counts as launched; after that it is stamped by app.upsert_menu_item_internal whenever a save leaves the item switched on, and by app.release_launch_internal. NULL on a never-launched draft, which a manager cannot switch on (ITEM_VIA_RELEASE, LAUNCH_VIA_PROTOCOL).';

-- ---------------------------------------------------------------------------
-- 2. release_ideas — a barista's or chef assistant's idea for a new item,
--    waiting for the head of their team (#65).
-- ---------------------------------------------------------------------------
create table if not exists release_ideas (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  team            text not null check (team in ('bar','kitchen')),
  author_id       uuid not null references staff(id),
  record          jsonb not null,
  photos          text[] not null default '{}' check (cardinality(photos) <= 6),
  status          text not null default 'waiting'
                  check (status in ('waiting','started','declined','withdrawn')),
  submitted_at    timestamptz not null default now(),
  decided_by      uuid references staff(id),
  decided_at      timestamptz,
  decline_reason  text check (decline_reason is null or length(decline_reason) <= 1000),
  run_id          uuid references protocol_runs(id) on delete set null,
  constraint release_ideas_decided_by_chk check ((status in ('waiting','withdrawn')) = (decided_by is null)),
  constraint release_ideas_decided_at_chk check ((decided_by is null) = (decided_at is null)),
  constraint release_ideas_decline_reason_chk
    check (status <> 'declined' or coalesce(length(btrim(decline_reason)),0) > 0),
  constraint release_ideas_run_chk check (status <> 'started' or run_id is not null)
);

create index if not exists release_ideas_waiting_idx
  on release_ideas (venue_id, team) where status = 'waiting';
create index if not exists release_ideas_author_idx
  on release_ideas (author_id, submitted_at);

comment on table release_ideas is
  'product_release (§2.9, #65): a barista''s or chef assistant''s idea for a new item, in the propose shape with no category, waiting for the head of their team (head_barista for bar, head_chef for kitchen), who starts a product release from it or declines it with a reason. Written through app.submit_release_idea, app.withdraw_release_idea, app.decline_release_idea and the product release start hook; read by MGMT at the venue, by the heads through app.release_ideas_to_review and by the author through app.my_release_ideas.';
comment on column release_ideas.id is 'Idea id.';
comment on column release_ideas.venue_id is 'The venue.';
comment on column release_ideas.team is 'bar or kitchen: the author''s team when they sent it (app.staff_team); its head reviews it.';
comment on column release_ideas.author_id is 'The barista or chef assistant who sent it.';
comment on column release_ideas.record is 'The idea, in the product release propose shape (§2.8) without category_id, as app.release_propose_check normalised it.';
comment on column release_ideas.photos is 'Photos: staff-media paths in the proposals folder (at most 6). A release started from the idea may claim them for its proposal.';
comment on column release_ideas.status is 'waiting, started (a release was started from it), declined (with a reason) or withdrawn (by its author).';
comment on column release_ideas.submitted_at is 'When it was sent.';
comment on column release_ideas.decided_by is 'The head, manager or owner who started or declined it; NULL while waiting or withdrawn.';
comment on column release_ideas.decided_at is 'When it was started or declined.';
comment on column release_ideas.decline_reason is 'Why it was declined (required when declined), shown to the author.';
comment on column release_ideas.run_id is 'The product release started from it.';

alter table release_ideas enable row level security;

drop policy if exists release_ideas_mgmt_read on release_ideas;
create policy release_ideas_mgmt_read on release_ideas
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on release_ideas to authenticated;
grant all on release_ideas to service_role;

-- ---------------------------------------------------------------------------
-- 3. Record helpers for the release check hooks. Internal. A field is absent
--    or JSON null when it is not given; the hint is the field the form marks
--    (validate.ts in @touch/core names the same ones).
-- ---------------------------------------------------------------------------

-- A text field: trimmed, NULL when blank; RECORD_INVALID when it is not a
-- string or is required and blank; TEXT_TOO_LONG past the cap.
create or replace function app.release_text(p_value jsonb, p_cap int, p_required boolean, p_hint text)
returns text
language plpgsql immutable set search_path = public as $release_text_0172$
declare
  v text;
begin
  if p_value is not null and p_value <> 'null'::jsonb then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v := app.protocol_engine_text(p_value #>> '{}', p_cap, p_hint);
  end if;
  if v is null and p_required then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end $release_text_0172$;

comment on function app.release_text(jsonb, int, boolean, text) is
  'product_release (§2.8). Internal: a release record''s text field, trimmed and NULL when blank; RECORD_INVALID (hint p_hint) when not a string or required and blank, TEXT_TOO_LONG past p_cap.';

revoke all on function app.release_text(jsonb, int, boolean, text) from public, anon, authenticated;

-- A uuid field, given as a string.
create or replace function app.release_uuid(p_value jsonb, p_required boolean, p_hint text)
returns uuid
language plpgsql immutable set search_path = public as $release_uuid_0172$
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return (p_value #>> '{}')::uuid;
end $release_uuid_0172$;

comment on function app.release_uuid(jsonb, boolean, text) is
  'product_release (§2.8). Internal: a release record''s uuid field, given as a string; RECORD_INVALID (hint p_hint) when malformed, or required and absent.';

revoke all on function app.release_uuid(jsonb, boolean, text) from public, anon, authenticated;

-- A whole number within [p_min, p_max].
create or replace function app.release_int(p_value jsonb, p_min bigint, p_max bigint, p_hint text)
returns bigint
language plpgsql immutable set search_path = public as $release_int_0172$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v::bigint;
end $release_int_0172$;

comment on function app.release_int(jsonb, bigint, bigint, text) is
  'product_release (§2.8). Internal: a release record''s required whole number within [p_min, p_max]; RECORD_INVALID (hint p_hint) otherwise.';

revoke all on function app.release_int(jsonb, bigint, bigint, text) from public, anon, authenticated;

-- RECORD_INVALID naming the first key of p_record (with a value) that the
-- record does not take; the hint is p_hint, or that key.
create or replace function app.release_only_keys(p_record jsonb, p_allowed text[], p_hint text)
returns void
language plpgsql immutable set search_path = public as $release_only_keys_0172$
declare
  v_bad text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = coalesce(p_hint, 'record');
  end if;
  select e.k into v_bad
    from jsonb_each(p_record) as e(k, v)
   where e.v <> 'null'::jsonb and not (e.k = any(p_allowed))
   order by e.k
   limit 1;
  if v_bad is not null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = coalesce(p_hint, v_bad);
  end if;
end $release_only_keys_0172$;

comment on function app.release_only_keys(jsonb, text[], text) is
  'product_release (§2.8). Internal: RECORD_INVALID when p_record is not an object, or carries a key outside p_allowed with a non-null value; the hint is p_hint, or that key when p_hint is NULL.';

revoke all on function app.release_only_keys(jsonb, text[], text) from public, anon, authenticated;

-- An optional {en, ar} line (a marketing hero or ticker): both, each within
-- the cap.
create or replace function app.release_line(p_value jsonb, p_cap int, p_hint text)
returns jsonb
language plpgsql immutable set search_path = public as $release_line_0172$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  perform app.release_only_keys(p_value, array['en', 'ar'], p_hint);
  return jsonb_build_object('en', app.release_text(p_value->'en', p_cap, true, p_hint),
                            'ar', app.release_text(p_value->'ar', p_cap, true, p_hint));
end $release_line_0172$;

comment on function app.release_line(jsonb, int, text) is
  'product_release (§2.8). Internal: an optional {en, ar} line, both required and within p_cap (hint p_hint); NULL when absent.';

revoke all on function app.release_line(jsonb, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.release_propose_check — the §2.8 propose record, shared by the
--    propose check hook and submit_release_idea. p_category:
--      'required'  the submitter decides the step (MGMT), so it passes at
--                  once and the record carries the category;
--      'optional'  a head's proposal (the manager picks it at accept);
--      'refused'   an idea (the head or the manager picks it later).
--    Each line names an active ingredient of the venue in that ingredient's
--    own unit (the qty becomes a recipe line as it is), or a free-text label.
-- ---------------------------------------------------------------------------
create or replace function app.release_propose_check(p_record jsonb, p_venue uuid, p_category text)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_propose_check_0172$
declare
  v_name_en  text;
  v_name_ar  text;
  v_kind     text;
  v_lines    jsonb := '[]'::jsonb;
  v_sizes    jsonb := '[]'::jsonb;
  v_el       jsonb;
  v_ing      uuid;
  v_label    text;
  v_qty      numeric;
  v_unit     text;
  v_ing_unit text;
  v_size_en  text;
  v_size_ar  text;
  v_link     text;
  v_category uuid;
begin
  if p_category is null or p_category not in ('required', 'optional', 'refused') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'category';
  end if;
  perform app.release_only_keys(p_record,
    array['name_en', 'name_ar', 'item_kind', 'lines', 'sizes', 'audience', 'inspiration',
          'link', 'notes', 'category_id'], null);

  v_name_en := app.release_text(p_record->'name_en', 60, false, 'name_en');
  v_name_ar := app.release_text(p_record->'name_ar', 60, false, 'name_ar');
  if v_name_en is null and v_name_ar is null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'name_en';
  end if;

  v_kind := app.release_text(p_record->'item_kind', 20, true, 'item_kind');
  if v_kind not in ('drink', 'dessert', 'food') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'item_kind';
  end if;

  if jsonb_typeof(p_record->'lines') is distinct from 'array'
     or jsonb_array_length(p_record->'lines') not between 1 and 30 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_record->'lines') e loop
    perform app.release_only_keys(v_el, array['ingredient_id', 'label', 'qty', 'unit'], 'lines');
    v_ing   := app.release_uuid(v_el->'ingredient_id', false, 'lines');
    v_label := app.release_text(v_el->'label', 80, false, 'lines');
    if v_ing is null and v_label is null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lines';
    end if;
    if jsonb_typeof(v_el->'qty') is distinct from 'number' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lines';
    end if;
    v_qty := round((v_el->>'qty')::numeric, 3);
    if v_qty <= 0 or v_qty >= 1000000 then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lines';
    end if;
    v_unit := app.release_text(v_el->'unit', 4, true, 'lines');
    if v_unit not in ('g', 'ml', 'pc') then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_ing is not null then
      select i.unit::text into v_ing_unit
        from ingredients i
       where i.id = v_ing and i.venue_id = p_venue and i.is_active;
      if not found or v_ing_unit is distinct from v_unit then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lines';
      end if;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'ingredient_id', v_ing, 'label', v_label, 'qty', v_qty, 'unit', v_unit)));
  end loop;

  if jsonb_typeof(p_record->'sizes') is distinct from 'array'
     or jsonb_array_length(p_record->'sizes') not between 1 and 4 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'sizes';
  end if;
  for v_el in select e from jsonb_array_elements(p_record->'sizes') e loop
    perform app.release_only_keys(v_el, array['name_en', 'name_ar'], 'sizes');
    v_size_en := app.release_text(v_el->'name_en', 80, false, 'sizes');
    v_size_ar := app.release_text(v_el->'name_ar', 80, false, 'sizes');
    if v_size_en is null and v_size_ar is null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'sizes';
    end if;
    v_sizes := v_sizes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'name_en', v_size_en, 'name_ar', v_size_ar)));
  end loop;

  v_link := app.release_text(p_record->'link', 300, false, 'link');
  if v_link is not null and v_link !~* '^https://[^[:space:]]+$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'link';
  end if;

  v_category := app.release_uuid(p_record->'category_id', false, 'category_id');
  if p_category = 'refused' and v_category is not null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'category_id';
  end if;
  if p_category = 'required' and v_category is null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'category_id';
  end if;
  if v_category is not null
     and not exists (select 1 from menu_categories c
                      where c.id = v_category and c.venue_id = p_venue
                        and c.kind = 'cafe' and c.is_active) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'category_id';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'name_en',     v_name_en,
    'name_ar',     v_name_ar,
    'item_kind',   v_kind,
    'lines',       v_lines,
    'sizes',       v_sizes,
    'audience',    app.release_text(p_record->'audience', 2000, false, 'audience'),
    'inspiration', app.release_text(p_record->'inspiration', 2000, false, 'inspiration'),
    'link',        v_link,
    'notes',       app.release_text(p_record->'notes', 2000, false, 'notes'),
    'category_id', v_category));
end $release_propose_check_0172$;

comment on function app.release_propose_check(jsonb, uuid, text) is
  'product_release (§2.8, §2.9). Internal: checks and normalises a new-item proposal {name_en?, name_ar? (at least one, <= 60), item_kind drink|dessert|food, lines: [{ingredient_id? (an active ingredient of the venue, in its own unit) | label? (<= 80), qty > 0, unit g|ml|pc}] (1-30), sizes: [{name_en?, name_ar?}] (1-4), audience?, inspiration?, link? (https, <= 300), notes?, category_id?}. p_category: required (the submitter decides the step), optional (a head''s proposal) or refused (an idea); a category is an active cafe category of the venue. RECORD_INVALID and TEXT_TOO_LONG with the field as hint. Shared by the propose check hook and app.submit_release_idea.';

revoke all on function app.release_propose_check(jsonb, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The menu writers, split (§2.9, §2.18). The _internal bodies carry no
--    guard and are what the release (and price_promo, later) writes through;
--    the public RPCs keep their signatures, guards and grants and add the
--    release rules in front.
-- ---------------------------------------------------------------------------

-- app.upsert_variant_internal — the 0013:203 body without its guard.
create or replace function app.upsert_variant_internal(
  p_item_id    uuid,
  p_name_en    text,
  p_name_ar    text,
  p_price_iqd  bigint,
  p_id         uuid default null,
  p_is_default boolean default false,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public as $upsert_variant_internal_0172$
declare
  v_before jsonb;
  v_row    menu_item_variants%rowtype;
begin
  if not exists (select 1 from menu_items where id = p_item_id) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_price_iqd is null or p_price_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  -- Only one default size per item.
  if p_is_default then
    update menu_item_variants set is_default = false
     where item_id = p_item_id and is_default and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
    values (p_item_id, p_name_en, p_name_ar, p_price_iqd, p_is_default, p_sort_order)
    returning * into v_row;
    perform app.write_audit('menu.variant.create', 'menu_item_variants', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_item_variants where id = p_id and item_id = p_item_id for update;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_item_variants
       set name_en = p_name_en, name_ar = p_name_ar, price_iqd = p_price_iqd,
           is_default = p_is_default, sort_order = p_sort_order
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.variant.update', 'menu_item_variants', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $upsert_variant_internal_0172$;

comment on function app.upsert_variant_internal(uuid, text, text, bigint, uuid, boolean, int) is
  'product_release (§2.9). Internal: the 0013 app.upsert_variant body without its guard. Creates or updates one size of an item; audit menu.variant.create or menu.variant.update. Called by the public app.upsert_variant and by the release hooks (the draft''s sizes at price 0, the approved prices); price_promo''s apply writes through it too.';

revoke all on function app.upsert_variant_internal(uuid, text, text, bigint, uuid, boolean, int) from public, anon, authenticated;

-- app.upsert_variant — the same signature, guard and grant, now a wrapper.
-- An item in release takes its prices from the price step only, so nobody,
-- the owner included, changes a stored price or adds a size there (Q12). A
-- name, default or order change is never refused. The manager price lock
-- (PRICE_VIA_PROTOCOL) is price_promo's, not this file's.
create or replace function app.upsert_variant(
  p_item_id    uuid,
  p_name_en    text,
  p_name_ar    text,
  p_price_iqd  bigint,
  p_id         uuid default null,
  p_is_default boolean default false,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public as $upsert_variant_0172$
declare
  v_run_status text;
  v_price      bigint;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select r.status into v_run_status
    from menu_items mi
    join protocol_runs r on r.id = mi.release_run_id
   where mi.id = p_item_id;
  if found and v_run_status not in ('live', 'done') then
    if p_id is null then
      raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
    end if;
    select v.price_iqd into v_price
      from menu_item_variants v
     where v.id = p_id and v.item_id = p_item_id;
    -- A size that is not there falls through to VARIANT_NOT_FOUND.
    if found and p_price_iqd is distinct from v_price then
      raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
    end if;
  end if;

  return app.upsert_variant_internal(p_item_id, p_name_en, p_name_ar, p_price_iqd,
                                     p_id, p_is_default, p_sort_order);
end $upsert_variant_0172$;

comment on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) is
  'Manager or owner: creates or updates one size of a menu item or shop product (0013; a wrapper over app.upsert_variant_internal since product_release). ITEM_IN_RELEASE, for everyone, on a new size or a price change of an item whose product release is not live or done: its prices come from the price step. ITEM_NOT_FOUND, VARIANT_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) to authenticated;

-- app.upsert_menu_item_internal — the 0054:48 body without its guard, plus
-- the launched_at stamp whenever the save leaves the item switched on. An
-- insert takes menu_items.venue_id from the app.current_venue() default,
-- which the calling RPC has set.
create or replace function app.upsert_menu_item_internal(
  p_category_id    uuid,
  p_name_en        text,
  p_name_ar        text,
  p_id             uuid default null,
  p_description_en text default null,
  p_description_ar text default null,
  p_sort_order     int default 0,
  p_is_active      boolean default true,
  p_hook_en        text default '',
  p_hook_ar        text default '',
  p_highlight      text default 'none',
  p_serve_temp     text default null   -- null = leave unchanged (insert: 'none')
) returns uuid
language plpgsql security definer set search_path = public as $upsert_menu_item_internal_0172$
declare
  v_before  jsonb;
  v_row     menu_items%rowtype;
  v_hook_en text := btrim(coalesce(p_hook_en, ''));
  v_hook_ar text := btrim(coalesce(p_hook_ar, ''));
begin
  if not exists (select 1 from menu_categories where id = p_category_id) then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_highlight is null or p_highlight not in ('none','blue','brown') then
    raise exception 'INVALID_HIGHLIGHT' using errcode = 'P0001',
      hint = 'highlight must be one of none, blue, brown';
  end if;
  if p_serve_temp is not null and p_serve_temp not in ('none','hot','cold','both') then
    raise exception 'INVALID_SERVE_TEMP' using errcode = 'P0001',
      hint = 'serve_temp must be one of none, hot, cold, both';
  end if;
  if length(v_hook_en) > 80 or length(v_hook_ar) > 80 then
    raise exception 'HOOK_TOO_LONG' using errcode = 'P0001',
      hint = 'hook_en / hook_ar are limited to 80 characters each';
  end if;
  if (v_hook_en = '') <> (v_hook_ar = '') then
    raise exception 'HOOK_PAIR_MISMATCH' using errcode = 'P0001',
      hint = 'provide the hook in both languages or in neither';
  end if;

  if p_id is null then
    insert into menu_items (category_id, name_en, name_ar, description_en, description_ar,
                            sort_order, is_active, hook_en, hook_ar, highlight, serve_temp,
                            launched_at)
    values (p_category_id, p_name_en, p_name_ar, p_description_en, p_description_ar,
            p_sort_order, p_is_active, v_hook_en, v_hook_ar, p_highlight,
            coalesce(p_serve_temp, 'none'),
            case when p_is_active then now() end)
    returning * into v_row;
    perform app.write_audit('menu.item.create', 'menu_items', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_items where id = p_id for update;
    if not found then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_items
       set category_id = p_category_id, name_en = p_name_en, name_ar = p_name_ar,
           description_en = p_description_en, description_ar = p_description_ar,
           sort_order = p_sort_order, is_active = p_is_active,
           hook_en = v_hook_en, hook_ar = v_hook_ar, highlight = p_highlight,
           serve_temp = coalesce(p_serve_temp, v_row.serve_temp),
           launched_at = case when p_is_active then coalesce(v_row.launched_at, now())
                              else v_row.launched_at end
           -- photo_path / photo_blur / sold_out deliberately NOT here.
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.item.update', 'menu_items', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $upsert_menu_item_internal_0172$;

comment on function app.upsert_menu_item_internal(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) is
  'product_release (§2.9). Internal: the 0054 app.upsert_menu_item body without its guard, plus launched_at = coalesce(launched_at, now()) whenever the save leaves the item switched on. Called by the public app.upsert_menu_item and by the release hooks (the hidden draft and its final names); price_promo''s shop_launch apply switches a product on through it.';

revoke all on function app.upsert_menu_item_internal(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) from public, anon, authenticated;

-- app.upsert_menu_item — the same 12-argument signature, guard and grant,
-- now a wrapper. After the guard, in this order:
--   1. an item in release is not switched on, and not moved into a category
--      that is not a cafe one, by anyone (ITEM_IN_RELEASE): it goes on sale
--      at the owner's Launch, never as a shop product;
--   2. a manager does not put a never-launched item on the menu (#52, #53):
--      a new item in a cafe category, a switch-on of a cafe draft or a move
--      of any item, launched or not, from a shop category into a cafe one is
--      ITEM_VIA_RELEASE (a new menu item starts as "Propose a new item"); a
--      new or never-launched shop product saved switched on is
--      LAUNCH_VIA_PROTOCOL (saved hidden it passes, and a shop_launch change
--      puts it on sale).
-- A launched item a manager switched off is switched back on as before. The
-- owner passes the second rule (#41: the decision names managers). A missing
-- category or item falls through to the internal's own codes.
create or replace function app.upsert_menu_item(
  p_category_id    uuid,
  p_name_en        text,
  p_name_ar        text,
  p_id             uuid default null,
  p_description_en text default null,
  p_description_ar text default null,
  p_sort_order     int default 0,
  p_is_active      boolean default true,
  p_hook_en        text default '',
  p_hook_ar        text default '',
  p_highlight      text default 'none',
  p_serve_temp     text default null   -- null = leave unchanged (insert: 'none')
) returns uuid
language plpgsql security definer set search_path = public as $upsert_menu_item_0172$
declare
  v_item       menu_items%rowtype;
  v_run_status text;
  v_new_kind   text;
  v_old_kind   text;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_id is not null then
    select * into v_item from menu_items where id = p_id;
    if found and v_item.release_run_id is not null then
      select r.status into v_run_status from protocol_runs r where r.id = v_item.release_run_id;
      if v_run_status not in ('live', 'done')
         and (coalesce(p_is_active, false)
              or (p_category_id is distinct from v_item.category_id
                  and exists (select 1 from menu_categories c
                               where c.id = p_category_id and c.kind <> 'cafe'))) then
        raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- A shop product moved into a cafe category is a new menu item there,
  -- whether or not it was launched as a product (#52).
  if app.staff_role() = 'manager' and v_item.id is not null
     and p_category_id is distinct from v_item.category_id
     and exists (select 1 from menu_categories c where c.id = v_item.category_id and c.kind = 'shop')
     and exists (select 1 from menu_categories c where c.id = p_category_id and c.kind = 'cafe') then
    raise exception 'ITEM_VIA_RELEASE' using errcode = 'P0001';
  end if;

  -- A draft: never launched, switched off, not in a release.
  if app.staff_role() = 'manager'
     and (p_id is null
          or (v_item.id is not null and v_item.launched_at is null and not v_item.is_active
              and v_item.release_run_id is null)) then
    select c.kind into v_new_kind from menu_categories c where c.id = p_category_id;
    if v_item.id is not null then
      select c.kind into v_old_kind from menu_categories c where c.id = v_item.category_id;
    end if;
    if v_new_kind = 'cafe'
       and (p_id is null or coalesce(p_is_active, false) or v_old_kind = 'shop') then
      raise exception 'ITEM_VIA_RELEASE' using errcode = 'P0001';
    end if;
    if v_new_kind = 'shop' and coalesce(p_is_active, false) then
      raise exception 'LAUNCH_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
  end if;

  return app.upsert_menu_item_internal(p_category_id, p_name_en, p_name_ar, p_id,
                                       p_description_en, p_description_ar, p_sort_order,
                                       p_is_active, p_hook_en, p_hook_ar, p_highlight,
                                       p_serve_temp);
end $upsert_menu_item_0172$;

comment on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) is
  'Manager or owner: creates or updates a menu item or shop product (0054; a wrapper over app.upsert_menu_item_internal since product_release). ITEM_IN_RELEASE, for everyone, on switching on an item whose product release is not live or done, or moving it into a category that is not a cafe one. For a manager: ITEM_VIA_RELEASE on any item moved from a shop category into a cafe one; and on a new item or a draft (never launched, switched off, not in release), ITEM_VIA_RELEASE for a new cafe item or a cafe draft switched on, LAUNCH_VIA_PROTOCOL for a shop product saved switched on. CATEGORY_NOT_FOUND, ITEM_NOT_FOUND, INVALID_HIGHLIGHT, INVALID_SERVE_TEMP, HOOK_TOO_LONG, HOOK_PAIR_MISMATCH.';

revoke all on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) from public, anon;
grant execute on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Readiness and the launch (§2.9). Internal bodies with no guard: the
--    launch check, the pass hook and the scheduled launch (service role,
--    release_post_launch) call them; the public reads are MGMT wrappers.
-- ---------------------------------------------------------------------------

-- The photos a launch may put on the menu: the run's test and marketing
-- photos, on submissions that still count (not withdrawn, not set aside).
create or replace function app.release_run_photos(p_run_id uuid)
returns text[]
language sql stable security definer set search_path = public as $release_run_photos_0172$
  select coalesce(array_agg(distinct p order by p), '{}'::text[])
    from protocol_submissions x
    join protocol_run_steps s on s.id = x.run_step_id
    cross join lateral unnest(x.photos) as p
   where x.run_id = p_run_id
     and s.step_key in ('test', 'marketing')
     and x.withdrawn_at is null
     and x.superseded_at is null
$release_run_photos_0172$;

comment on function app.release_run_photos(uuid) is
  'product_release (§2.8). Internal: the staff-media paths a launch may choose as the menu photo, the photos of the run''s test and marketing submissions that are not withdrawn or superseded. Service role too: protocol-action checks the chosen photo against it before copying anything into the public menu bucket.';

revoke all on function app.release_run_photos(uuid) from public, anon, authenticated;
grant execute on function app.release_run_photos(uuid) to service_role;

-- The launch step's record on its current round, once it has passed: what
-- the owner chose (when, at, photo_path, menu_photo_path).
create or replace function app.release_launch_record(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $release_launch_record_0172$
  select x.record
    from protocol_submissions x
    join protocol_run_steps s on s.id = x.run_step_id
   where x.run_id = p_run_id
     and s.step_key = 'launch'
     and x.round = s.round
     and x.decision in ('approve', 'auto')
   order by x.decided_at desc, x.id desc
   limit 1
$release_launch_record_0172$;

comment on function app.release_launch_record(uuid) is
  'product_release (§2.8). Internal: the passed launch record of a run''s current round ({when, at?, photo_path, menu_photo_path?}), or NULL.';

revoke all on function app.release_launch_record(uuid) from public, anon, authenticated;

-- The one menu path a launch writes: items/<item>/<run>.<ext of the chosen
-- photo>, so a retry of the copy overwrites the same object.
create or replace function app.release_menu_photo_path(p_run_id uuid, p_photo_path text)
returns text
language sql stable security definer set search_path = public as $release_menu_photo_path_0172$
  select 'items/' || r.menu_item_id::text || '/' || r.id::text || '.'
         || lower(substring(p_photo_path from '\.([A-Za-z0-9]+)$'))
    from protocol_runs r
   where r.id = p_run_id
     and r.menu_item_id is not null
     and p_photo_path ~* '\.(jpg|png|webp)$'
$release_menu_photo_path_0172$;

comment on function app.release_menu_photo_path(uuid, text) is
  'product_release (§2.8, §2.20). Internal: items/<menu_item_id>/<run_id>.<ext of p_photo_path>, the menu-media path protocol-action copies the chosen photo to and the only menu_photo_path a launch-now accepts; NULL when the run has no draft or the photo is not jpg, png or webp.';

revoke all on function app.release_menu_photo_path(uuid, text) from public, anon, authenticated;

-- Readiness (plan §5.1): names in both languages, a price above 0 on every
-- size, a photo to put on the menu, a recipe on every size, an active
-- category. Allergens and serve temperature are warnings, never blockers.
create or replace function app.release_readiness_internal(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_readiness_internal_0172$
declare
  v_run      protocol_runs%rowtype;
  v_item     menu_items%rowtype;
  v_cat      menu_categories%rowtype;
  v_names    boolean := false;
  v_prices   boolean := false;
  v_photo    boolean := false;
  v_recipe   boolean := false;
  v_category boolean := false;
  v_warnings jsonb := '[]'::jsonb;
begin
  select * into v_run from protocol_runs where id = p_run_id;
  if v_run.menu_item_id is not null then
    select * into v_item from menu_items where id = v_run.menu_item_id;
  end if;

  if v_item.id is not null then
    select * into v_cat from menu_categories where id = v_item.category_id;
    v_names := coalesce(length(btrim(v_item.name_en)), 0) > 0
               and coalesce(length(btrim(v_item.name_ar)), 0) > 0;
    v_prices := exists (select 1 from menu_item_variants v where v.item_id = v_item.id)
                and not exists (select 1 from menu_item_variants v
                                 where v.item_id = v_item.id and v.price_iqd <= 0);
    v_photo := v_item.photo_path is not null
               or cardinality(app.release_run_photos(v_run.id)) > 0;
    v_recipe := exists (select 1 from menu_item_variants v where v.item_id = v_item.id)
                and not exists (select 1 from menu_item_variants v
                                 where v.item_id = v_item.id
                                   and not exists (select 1 from recipe_lines rl where rl.variant_id = v.id));
    v_category := coalesce(v_cat.is_active, false);

    if not exists (select 1 from menu_item_allergens a where a.item_id = v_item.id) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('key', 'allergens'));
    end if;
    if v_item.serve_temp = 'none' and coalesce(v_cat.serve_temp, 'none') = 'none' then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('key', 'serve_temp'));
    end if;
  end if;

  return jsonb_build_object(
    'ready',    v_names and v_prices and v_photo and v_recipe and v_category,
    'checks',   jsonb_build_array(
                  jsonb_build_object('key', 'names',    'ok', v_names),
                  jsonb_build_object('key', 'prices',   'ok', v_prices),
                  jsonb_build_object('key', 'photo',    'ok', v_photo),
                  jsonb_build_object('key', 'recipe',   'ok', v_recipe),
                  jsonb_build_object('key', 'category', 'ok', v_category)),
    'warnings', v_warnings);
end $release_readiness_internal_0172$;

comment on function app.release_readiness_internal(uuid) is
  'product_release (§2.9). Internal, no guard (the launch check and the scheduled launch call it; the cron has no staff session): {ready, checks: [{key: names|prices|photo|recipe|category, ok}], warnings: [{key: allergens|serve_temp}]} for a run''s draft item. photo is ok when the item has a menu photo or the run has a test or marketing photo to choose.';

revoke all on function app.release_readiness_internal(uuid) from public, anon, authenticated;

-- The launch itself: the chosen photo (already copied to menu-media) becomes
-- the item's photo (the set_item_photo rule, 0027:228), the item goes on sale
-- and is stamped launched, the run goes live, and its starter is told.
create or replace function app.release_launch_internal(p_run_id uuid, p_menu_photo_path text)
returns void
language plpgsql security definer set search_path = public as $release_launch_internal_0172$
declare
  v_run    protocol_runs%rowtype;
  v_before jsonb;
  v_item   menu_items%rowtype;
begin
  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'product_release' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_run.status <> 'live' and not app.protocol_run_allowed(v_run.status, 'live') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = v_run.status || ' -> live';
  end if;
  if p_menu_photo_path is null
     or not (app.is_media_path(p_menu_photo_path) and p_menu_photo_path like 'items/%') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_photo_path';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  select * into v_item from menu_items where id = v_run.menu_item_id for update;
  if not found then
    raise exception 'RELEASE_NOT_READY' using errcode = 'P0001', hint = 'names,prices,photo,recipe,category';
  end if;
  v_before := to_jsonb(v_item);
  update menu_items
     set photo_path  = p_menu_photo_path,
         photo_blur  = null,
         is_active   = true,
         launched_at = coalesce(launched_at, now())
   where id = v_item.id
   returning * into v_item;
  perform app.write_audit('menu.item.update', 'menu_items', v_item.id::text, v_before, to_jsonb(v_item));

  if v_run.status <> 'live' then
    update protocol_runs set status = 'live', live_at = coalesce(live_at, now()) where id = v_run.id;
  end if;

  perform app.protocol_engine_notify(array[v_run.started_by], 'staff_info', 'run_live', 'staff-run',
                                     v_run.id, v_run.id, null);
  perform app.write_audit('protocol.release.launch', 'protocol_run', v_run.id::text,
    jsonb_build_object('status', v_run.status),
    jsonb_build_object('status', 'live', 'menu_item_id', v_item.id, 'scheduled', v_run.status = 'scheduled'));
end $release_launch_internal_0172$;

comment on function app.release_launch_internal(uuid, text) is
  'product_release (§2.9). Internal: launches a run''s draft: p_menu_photo_path (an items/ path in menu-media, copied there by protocol-action) becomes its photo, is_active true, launched_at stamped; the run goes live; the starter is told (staff_info / run_live). Audit protocol.release.launch (and menu.item.update). Called by the launch pass hook (now) and app.release_launch_scheduled (a date).';

revoke all on function app.release_launch_internal(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The product release hooks (§2.7, §2.8). Internal, called by the engine
--    in the caller's transaction with the caller's auth.uid(); the engine has
--    set app.venue_id to the run's venue.
-- ---------------------------------------------------------------------------

-- The kind is ready. data is {} or, for a start from an idea, {idea_id}: the
-- idea is locked, checked and marked started, its author is told, and
-- {idea_id} becomes the run's data (J's re-claim then lets step 1 carry the
-- idea's photos). A failing step 1 rolls the whole start back, the idea with
-- it.
create or replace function app.protocol_start_product_release(p_run_id uuid, p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $protocol_start_product_release_0172$
declare
  v_run  protocol_runs%rowtype;
  v_idea release_ideas%rowtype;
  v_id   uuid;
begin
  if p_data is null or p_data = '{}'::jsonb then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p_data) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_data) k where k <> 'idea_id') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'data';
  end if;
  v_id := app.release_uuid(p_data->'idea_id', true, 'data');

  select * into v_run from protocol_runs where id = p_run_id;
  select * into v_idea from release_ideas where id = v_id for update;
  if not found or v_idea.venue_id <> v_run.venue_id then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'idea_id';
  end if;
  if v_idea.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if not (app.is_staff_at(v_idea.venue_id, app.staff_team_head(v_idea.team))
          or app.is_staff_at(v_idea.venue_id, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update release_ideas
     set status = 'started', decided_by = auth.uid(), decided_at = now(), run_id = p_run_id
   where id = v_idea.id;

  perform app.write_audit('protocol.release.idea_start', 'release_idea', v_idea.id::text,
    jsonb_build_object('status', 'waiting'),
    jsonb_build_object('status', 'started', 'run_id', p_run_id, 'team', v_idea.team));
  perform app.notify_staff(
    array[v_idea.author_id], 'staff_decided',
    jsonb_build_object('route', 'staff', 'id', v_idea.id, 'title_key', 'idea_started',
                       'params', jsonb_build_object(
                         'title', coalesce(v_idea.record->>'name_en', v_idea.record->>'name_ar'))));

  return jsonb_build_object('idea_id', v_idea.id);
end $protocol_start_product_release_0172$;

comment on function app.protocol_start_product_release(uuid, jsonb) is
  'product_release (§2.7, §2.9). Internal start hook: takes {} or {idea_id} (any other key RECORD_INVALID hint data). With an idea: REF_NOT_FOUND (hint idea_id) when there is none at the run''s venue, SUBMISSION_DECIDED when it is not waiting, FORBIDDEN unless the caller holds its team''s head role or is MGMT at the venue; then the idea is started, its author told (staff_decided / idea_started), audit protocol.release.idea_start, and {idea_id} becomes the run''s data.';

revoke all on function app.protocol_start_product_release(uuid, jsonb) from public, anon, authenticated;

-- propose: the proposal; the category is required when the submitter decides
-- the step (MGMT, whose proposal passes at once).
create or replace function app.protocol_check_product_release_propose(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_product_release_propose_0172$
declare
  v_run  protocol_runs%rowtype;
  v_step protocol_run_steps%rowtype;
begin
  select * into v_step from protocol_run_steps where id = p_run_step_id;
  select * into v_run from protocol_runs where id = v_step.run_id;
  return app.release_propose_check(
    p_record, v_run.venue_id,
    case when app.protocol_engine_decider(v_run.venue_id, v_step.needs_owner_ok, false)
         then 'required' else 'optional' end);
end $protocol_check_product_release_propose_0172$;

comment on function app.protocol_check_product_release_propose(uuid, jsonb, text[]) is
  'product_release (§2.8). Internal check hook: the propose record through app.release_propose_check, with category_id required when the submitter decides the step (a manager or the owner) and optional for a head.';

revoke all on function app.protocol_check_product_release_propose(uuid, jsonb, text[]) from public, anon, authenticated;

-- propose passes: the draft item is built (or, on a later round, rebuilt in
-- place): hidden, in the decider's category, names from the proposal (a
-- missing language copies the other), one size per suggested size at price 0
-- (a kept size keeps its price), and the proposal's stocked lines as the
-- recipe of every size (the manager tunes sizes in Stock ▸ Recipes). The
-- internals, because the public wrapper refuses a manager's new cafe item.
create or replace function app.protocol_pass_product_release_propose(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_product_release_propose_0172$
declare
  v_run      protocol_runs%rowtype;
  v_rec      jsonb;
  v_cat      uuid;
  v_en       text;
  v_ar       text;
  v_old      menu_items%rowtype;
  v_item     uuid;
  v_existing uuid[];
  v_kept     uuid[] := '{}';
  v_size     jsonb;
  v_ord      bigint;
  v_vid      uuid;
  v_price    bigint;
  v_lines    int;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  select x.record into v_rec from protocol_submissions x where x.id = p_submission_id;

  v_cat := app.release_uuid(coalesce(p_decision_data, '{}'::jsonb)->'category_id', true, 'category_id');
  if not exists (select 1 from menu_categories c
                  where c.id = v_cat and c.venue_id = v_run.venue_id
                    and c.kind = 'cafe' and c.is_active) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'category_id';
  end if;
  v_en := coalesce(v_rec->>'name_en', v_rec->>'name_ar');
  v_ar := coalesce(v_rec->>'name_ar', v_rec->>'name_en');
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  if v_run.menu_item_id is not null then
    select * into v_old from menu_items where id = v_run.menu_item_id for update;
  end if;
  if v_old.id is null then
    v_item := app.upsert_menu_item_internal(v_cat, v_en, v_ar, null, null, null, 0, false,
                                            '', '', 'none', null);
  else
    v_item := app.upsert_menu_item_internal(v_cat, v_en, v_ar, v_old.id,
                                            v_old.description_en, v_old.description_ar,
                                            v_old.sort_order, false, v_old.hook_en, v_old.hook_ar,
                                            v_old.highlight, v_old.serve_temp);
  end if;
  update menu_items
     set release_run_id = v_run.id, venue_id = v_run.venue_id
   where id = v_item
     and (release_run_id is distinct from v_run.id or venue_id is distinct from v_run.venue_id);

  v_existing := array(select v.id from menu_item_variants v
                       where v.item_id = v_item order by v.sort_order, v.id);
  for v_size, v_ord in select e, o from jsonb_array_elements(v_rec->'sizes') with ordinality as t(e, o) loop
    v_price := 0;
    if v_ord <= cardinality(v_existing) then
      select v.price_iqd into v_price from menu_item_variants v where v.id = v_existing[v_ord];
    end if;
    v_vid := app.upsert_variant_internal(
               v_item,
               coalesce(v_size->>'name_en', v_size->>'name_ar'),
               coalesce(v_size->>'name_ar', v_size->>'name_en'),
               coalesce(v_price, 0),
               case when v_ord <= cardinality(v_existing) then v_existing[v_ord] end,
               v_ord = 1,
               (v_ord - 1)::int);
    v_kept := v_kept || v_vid;
  end loop;
  -- A size dropped on a later round goes (a draft was never sold).
  delete from menu_item_variants where item_id = v_item and not (id = any(v_kept));

  delete from recipe_lines where variant_id = any(v_kept);
  insert into recipe_lines (variant_id, ingredient_id, qty)
  select k.vid, (l->>'ingredient_id')::uuid, (l->>'qty')::numeric
    from unnest(v_kept) as k(vid)
   cross join jsonb_array_elements(v_rec->'lines') as l
   where l ? 'ingredient_id';
  get diagnostics v_lines = row_count;

  update protocol_runs set menu_item_id = v_item where id = v_run.id and menu_item_id is distinct from v_item;

  perform app.write_audit('protocol.release.accept', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('menu_item_id', v_item, 'category_id', v_cat,
                       'sizes', cardinality(v_kept), 'recipe_lines', v_lines,
                       'rebuilt', v_old.id is not null));
end $protocol_pass_product_release_propose_0172$;

comment on function app.protocol_pass_product_release_propose(uuid, uuid, jsonb) is
  'product_release (§2.9). Internal pass hook: validates the decision data''s category_id (an active cafe category at the run''s venue; RECORD_INVALID hint category_id), then builds the draft through the internals: a hidden item in that category with the proposal''s names, one size per suggested size at price 0, the stocked lines as every size''s recipe; sets its release_run_id and the run''s menu_item_id. A later round rebuilds the same draft in place. Audit protocol.release.accept.';

revoke all on function app.protocol_pass_product_release_propose(uuid, uuid, jsonb) from public, anon, authenticated;

-- test: servings of the draft's sizes, 1 to 50 each.
create or replace function app.protocol_check_product_release_test(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_product_release_test_0172$
declare
  v_item     uuid;
  v_el       jsonb;
  v_vid      uuid;
  v_count    bigint;
  v_seen     uuid[] := '{}';
  v_servings jsonb := '[]'::jsonb;
begin
  select r.menu_item_id into v_item
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  perform app.release_only_keys(p_record, array['servings', 'notes'], null);

  if jsonb_typeof(p_record->'servings') is distinct from 'array'
     or jsonb_array_length(p_record->'servings') = 0 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'servings';
  end if;
  for v_el in select e from jsonb_array_elements(p_record->'servings') e loop
    perform app.release_only_keys(v_el, array['variant_id', 'count'], 'servings');
    v_vid := app.release_uuid(v_el->'variant_id', true, 'servings');
    v_count := app.release_int(v_el->'count', 1, 50, 'servings');
    if v_vid = any(v_seen)
       or not exists (select 1 from menu_item_variants v where v.id = v_vid and v.item_id = v_item) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'servings';
    end if;
    v_seen := v_seen || v_vid;
    v_servings := v_servings || jsonb_build_array(jsonb_build_object('variant_id', v_vid, 'count', v_count));
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'servings', v_servings,
    'notes',    app.release_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_product_release_test_0172$;

comment on function app.protocol_check_product_release_test(uuid, jsonb, text[]) is
  'product_release (§2.8). Internal check hook: test {servings: [{variant_id (a size of the run''s draft, once each), count 1..50}] (at least one), notes?}. RECORD_INVALID with the field as hint.';

revoke all on function app.protocol_check_product_release_test(uuid, jsonb, text[]) from public, anon, authenticated;

-- test is sent: the servings are made, so their ingredients leave stock as a
-- product test (recipe qty / yield × count, FEFO), on every round. A
-- withdrawn or sent-back test keeps its consumption: the stock was used.
create or replace function app.protocol_submit_product_release_test(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_submit_product_release_test_0172$
declare
  v_sub   protocol_submissions%rowtype;
  v_s     record;
  v_l     record;
  v_lines int := 0;
begin
  select * into v_sub from protocol_submissions where id = p_submission_id;
  for v_s in
    select (e->>'variant_id')::uuid as variant_id, (e->>'count')::int as cnt
      from jsonb_array_elements(v_sub.record->'servings') e
  loop
    for v_l in
      select rl.ingredient_id, rl.qty / (i.yield_percent / 100.0) * v_s.cnt as need
        from recipe_lines rl
        join ingredients i on i.id = rl.ingredient_id
       where rl.variant_id = v_s.variant_id
       order by rl.ingredient_id, rl.id
    loop
      perform app.consume_fefo(v_l.ingredient_id, v_l.need, 'product_test', null, null,
                               auth.uid(), null, 'run:' || v_sub.run_id::text);
      v_lines := v_lines + 1;
    end loop;
  end loop;

  perform app.write_audit('stock.product_test', 'protocol_run', v_sub.run_id::text, null,
    jsonb_build_object('submission_id', v_sub.id, 'round', v_sub.round,
                       'servings', jsonb_array_length(v_sub.record->'servings'), 'movements', v_lines));
end $protocol_submit_product_release_test_0172$;

comment on function app.protocol_submit_product_release_test(uuid) is
  'product_release (§2.9). Internal submit hook: consumes each serving''s recipe (qty / yield × count) through app.consume_fefo as product_test, reason run:<run_id>, staff the sender; runs on every round, and a withdrawn or sent-back test keeps its consumption. Audit stock.product_test.';

revoke all on function app.protocol_submit_product_release_test(uuid) from public, anon, authenticated;

-- analysis ("Price"): a price above 0 for every size of the draft, and the
-- final names in both languages.
create or replace function app.protocol_check_product_release_analysis(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_product_release_analysis_0172$
declare
  v_item   uuid;
  v_el     jsonb;
  v_vid    uuid;
  v_price  bigint;
  v_seen   uuid[] := '{}';
  v_prices jsonb := '[]'::jsonb;
begin
  select r.menu_item_id into v_item
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  perform app.release_only_keys(p_record, array['prices', 'name_en', 'name_ar', 'notes'], null);

  if jsonb_typeof(p_record->'prices') is distinct from 'array' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
  end if;
  for v_el in select e from jsonb_array_elements(p_record->'prices') e loop
    perform app.release_only_keys(v_el, array['variant_id', 'price_iqd'], 'prices');
    v_vid := app.release_uuid(v_el->'variant_id', true, 'prices');
    v_price := app.release_int(v_el->'price_iqd', 1, 100000000, 'prices');
    if v_vid = any(v_seen)
       or not exists (select 1 from menu_item_variants v where v.id = v_vid and v.item_id = v_item) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
    end if;
    v_seen := v_seen || v_vid;
    v_prices := v_prices || jsonb_build_array(jsonb_build_object('variant_id', v_vid, 'price_iqd', v_price));
  end loop;
  -- Every size of the draft, each once.
  if cardinality(v_seen) = 0
     or exists (select 1 from menu_item_variants v where v.item_id = v_item and not (v.id = any(v_seen))) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'prices',  v_prices,
    'name_en', app.release_text(p_record->'name_en', 60, true, 'name_en'),
    'name_ar', app.release_text(p_record->'name_ar', 60, true, 'name_ar'),
    'notes',   app.release_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_product_release_analysis_0172$;

comment on function app.protocol_check_product_release_analysis(uuid, jsonb, text[]) is
  'product_release (§2.8). Internal check hook: analysis {prices: [{variant_id, price_iqd 1..100000000}] (every size of the run''s draft, once each), name_en, name_ar (both, <= 60), notes?}. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_product_release_analysis(uuid, jsonb, text[]) from public, anon, authenticated;

-- analysis passes (the owner approved the price, Q12: no override): the
-- prices and final names are written to the draft, which stays hidden.
create or replace function app.protocol_pass_product_release_analysis(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_product_release_analysis_0172$
declare
  v_run  protocol_runs%rowtype;
  v_rec  jsonb;
  v_item menu_items%rowtype;
  v_p    record;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  select x.record into v_rec from protocol_submissions x where x.id = p_submission_id;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  for v_p in
    select v.id, v.name_en, v.name_ar, v.is_default, v.sort_order, (e->>'price_iqd')::bigint as price
      from jsonb_array_elements(v_rec->'prices') e
      join menu_item_variants v on v.id = (e->>'variant_id')::uuid and v.item_id = v_run.menu_item_id
  loop
    perform app.upsert_variant_internal(v_run.menu_item_id, v_p.name_en, v_p.name_ar, v_p.price,
                                        v_p.id, v_p.is_default, v_p.sort_order);
  end loop;

  select * into v_item from menu_items where id = v_run.menu_item_id;
  if found then
    perform app.upsert_menu_item_internal(v_item.category_id, v_rec->>'name_en', v_rec->>'name_ar',
                                          v_item.id, v_item.description_en, v_item.description_ar,
                                          v_item.sort_order, false, v_item.hook_en, v_item.hook_ar,
                                          v_item.highlight, v_item.serve_temp);
  end if;
end $protocol_pass_product_release_analysis_0172$;

comment on function app.protocol_pass_product_release_analysis(uuid, uuid, jsonb) is
  'product_release (§2.9). Internal pass hook: writes the approved prices through app.upsert_variant_internal (the public path refuses an item in release) and the final names through app.upsert_menu_item_internal; the item stays hidden.';

revoke all on function app.protocol_pass_product_release_analysis(uuid, uuid, jsonb) from public, anon, authenticated;

-- marketing: highlights in both languages, an optional hero and ticker line,
-- a campaign of the run's venue.
create or replace function app.protocol_check_product_release_marketing(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_product_release_marketing_0172$
declare
  v_venue    uuid;
  v_campaign uuid;
begin
  select r.venue_id into v_venue
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  perform app.release_only_keys(p_record,
    array['highlights_en', 'highlights_ar', 'hero', 'ticker', 'campaign_id', 'notes'], null);

  v_campaign := app.release_uuid(p_record->'campaign_id', false, 'campaign_id');
  if v_campaign is not null
     and not exists (select 1 from marketing_campaigns c where c.id = v_campaign and c.venue_id = v_venue) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'campaign_id';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'highlights_en', app.release_text(p_record->'highlights_en', 300, true, 'highlights_en'),
    'highlights_ar', app.release_text(p_record->'highlights_ar', 300, true, 'highlights_ar'),
    'hero',          app.release_line(p_record->'hero', 80, 'hero'),
    'ticker',        app.release_line(p_record->'ticker', 120, 'ticker'),
    'campaign_id',   v_campaign,
    'notes',         app.release_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_product_release_marketing_0172$;

comment on function app.protocol_check_product_release_marketing(uuid, jsonb, text[]) is
  'product_release (§2.8). Internal check hook: marketing {highlights_en, highlights_ar (<= 300), hero?: {en, ar} (<= 80), ticker?: {en, ar} (<= 120), campaign_id? (a campaign at the run''s venue), notes?}. Nothing is published. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_product_release_marketing(uuid, jsonb, text[]) from public, anon, authenticated;

-- launch: now or on a date (ahead, within 90 days), the menu photo chosen
-- from the run's test and marketing photos, and a ready draft. A launch now
-- also names the menu-media path protocol-action copied the photo to, the
-- only one accepted, so a direct submit that skipped the copy cannot pass.
create or replace function app.protocol_check_product_release_launch(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_product_release_launch_0172$
declare
  v_run_id  uuid;
  v_when    text;
  v_at      timestamptz;
  v_photo   text;
  v_menu    text;
  v_ready   jsonb;
  v_failing text;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  perform app.release_only_keys(p_record, array['when', 'at', 'photo_path', 'menu_photo_path'], null);

  v_when := app.release_text(p_record->'when', 8, true, 'when');
  if v_when not in ('now', 'date') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'when';
  end if;
  v_photo := app.release_text(p_record->'photo_path', 300, true, 'photo_path');
  if not (v_photo = any(app.release_run_photos(v_run_id))) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'photo_path';
  end if;
  v_menu := app.release_text(p_record->'menu_photo_path', 300, false, 'menu_photo_path');

  if v_when = 'date' then
    begin
      v_at := (app.release_text(p_record->'at', 64, true, 'at'))::timestamptz;
    exception when others then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'at';
    end;
    if v_at <= now() or v_at > now() + interval '90 days' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'at';
    end if;
    if v_menu is not null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_photo_path';
    end if;
  else
    if p_record->'at' is not null and p_record->'at' <> 'null'::jsonb then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'at';
    end if;
    -- The path protocol-action copies to, and the copy itself: a direct
    -- submit_step that names the path without copying cannot pass.
    if v_menu is null or v_menu is distinct from app.release_menu_photo_path(v_run_id, v_photo)
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'menu-media' and o.name = v_menu) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_photo_path';
    end if;
  end if;

  v_ready := app.release_readiness_internal(v_run_id);
  if not (v_ready->>'ready')::boolean then
    select string_agg(c->>'key', ',' order by o) into v_failing
      from jsonb_array_elements(v_ready->'checks') with ordinality as t(c, o)
     where not (c->>'ok')::boolean;
    raise exception 'RELEASE_NOT_READY' using errcode = 'P0001', hint = v_failing;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'when',            v_when,
    'at',              v_at,
    'photo_path',      v_photo,
    'menu_photo_path', v_menu));
end $protocol_check_product_release_launch_0172$;

comment on function app.protocol_check_product_release_launch(uuid, jsonb, text[]) is
  'product_release (§2.8, §2.9). Internal check hook: launch {when now|date, at? (a date: ahead, within 90 days), photo_path (a test or marketing photo of this run), menu_photo_path (now: exactly items/<menu_item_id>/<run_id>.<ext>, the path protocol-action copies to, with the copy in menu-media; a date: absent)}, and the draft must be ready (RELEASE_NOT_READY, hint the failing checks). RECORD_INVALID with the field as hint.';

revoke all on function app.protocol_check_product_release_launch(uuid, jsonb, text[]) from public, anon, authenticated;

-- launch passes (the owner's own step passes at once): now goes live in this
-- transaction; a date schedules the run (the finish hook says scheduled, and
-- release_post_launch's cron launches it when the date comes).
create or replace function app.protocol_pass_product_release_launch(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_product_release_launch_0172$
declare
  v_run_id uuid;
  v_rec    jsonb;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select x.record into v_rec from protocol_submissions x where x.id = p_submission_id;
  if v_rec->>'when' = 'now' then
    perform app.release_launch_internal(v_run_id, v_rec->>'menu_photo_path');
  else
    update protocol_runs set scheduled_for = (v_rec->>'at')::timestamptz where id = v_run_id;
  end if;
end $protocol_pass_product_release_launch_0172$;

comment on function app.protocol_pass_product_release_launch(uuid, uuid, jsonb) is
  'product_release (§2.9). Internal pass hook: when now, app.release_launch_internal with the record''s menu_photo_path; when a date, scheduled_for = at (the finish hook then schedules the run).';

revoke all on function app.protocol_pass_product_release_launch(uuid, uuid, jsonb) from public, anon, authenticated;

-- The terminal step passed: live after a launch now, scheduled for a date.
create or replace function app.protocol_finish_product_release(p_run_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $protocol_finish_product_release_0172$
declare
  v_when text;
begin
  v_when := app.release_launch_record(p_run_id)->>'when';
  return case v_when when 'now' then 'live' when 'date' then 'scheduled' end;
end $protocol_finish_product_release_0172$;

comment on function app.protocol_finish_product_release(uuid) is
  'product_release (§2.9). Internal finish hook: live after a launch now, scheduled for a launch on a date (read from the passed launch record); NULL otherwise, which the engine refuses.';

revoke all on function app.protocol_finish_product_release(uuid) from public, anon, authenticated;

-- A stopped or withdrawn run takes its never-launched draft with it (sizes,
-- recipe and the rest cascade; the run's menu_item_id goes NULL by FK).
create or replace function app.protocol_stop_product_release(p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_stop_product_release_0172$
declare
  v_item uuid;
begin
  select r.menu_item_id into v_item from protocol_runs r where r.id = p_run_id;
  if v_item is not null then
    delete from menu_items mi
     where mi.id = v_item and mi.launched_at is null and mi.release_run_id = p_run_id;
  end if;
end $protocol_stop_product_release_0172$;

comment on function app.protocol_stop_product_release(uuid) is
  'product_release (§2.9). Internal stop hook: deletes the run''s draft item when it was never launched; its children cascade and the run''s menu_item_id goes NULL by FK.';

revoke all on function app.protocol_stop_product_release(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The release reads (§2.9). MGMT for readiness and cost; the test's
--    assignee (the proposer) or MGMT for the test context, which has no cost.
-- ---------------------------------------------------------------------------
create or replace function app.release_readiness(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_readiness_0172$
declare
  v_run protocol_runs%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.kind <> 'product_release'
     or not (v_run.venue_id = any(app.staff_venue_ids()))
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  return app.release_readiness_internal(v_run.id);
end $release_readiness_0172$;

comment on function app.release_readiness(uuid) is
  'product_release (§2.9). MGMT at the run''s venue: the launch readiness of a product release''s draft, {ready, checks: [{key, ok}], warnings: [{key}]} (app.release_readiness_internal). PROTOCOL_NOT_FOUND.';

revoke all on function app.release_readiness(uuid) from public, anon;
grant execute on function app.release_readiness(uuid) to authenticated;

-- Cost to make each size, from the latest batch cost of each ingredient, else
-- its pack cost (v_item_cogs' fallbacks, without the silent 0): a line with
-- neither, a size with no recipe, or a proposal line that is still free text
-- makes the cost unknown rather than cheap.
create or replace function app.release_cost(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_cost_0172$
declare
  v_run     protocol_runs%rowtype;
  v_unknown jsonb;
  v_sizes   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.kind <> 'product_release'
     or not (v_run.venue_id = any(app.staff_venue_ids()))
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The free-text lines of the proposal that counts: the passed one, else the
  -- latest one still standing.
  select coalesce(jsonb_agg(l->'label' order by o), '[]'::jsonb) into v_unknown
    from (select x.record
            from protocol_submissions x
            join protocol_run_steps s on s.id = x.run_step_id
           where x.run_id = v_run.id and s.step_key = 'propose'
             and x.withdrawn_at is null and x.superseded_at is null
           order by (x.decision in ('approve', 'auto')) desc nulls last, x.submitted_at desc
           limit 1) p
   cross join lateral jsonb_array_elements(p.record->'lines') with ordinality as t(l, o)
   where not (l ? 'ingredient_id');

  with lines as (
    select v.id as variant_id, v.sort_order,
           rl.qty / (i.yield_percent / 100.0) as qty_used,
           coalesce((select b.unit_cost_iqd
                       from stock_batches b
                      where b.ingredient_id = i.id
                      order by b.received_at desc, b.id desc
                      limit 1),
                    i.pack_cost_iqd::numeric / nullif(i.pack_size, 0)) as unit_cost
      from menu_item_variants v
      join recipe_lines rl on rl.variant_id = v.id
      join ingredients i on i.id = rl.ingredient_id
     where v.item_id = v_run.menu_item_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id,
           'name_en',    v.name_en,
           'name_ar',    v.name_ar,
           'cost_iqd',   coalesce(round((select sum(l.qty_used * l.unit_cost)
                                           from lines l where l.variant_id = v.id)), 0)::bigint,
           'cost_known', jsonb_array_length(v_unknown) = 0
                         and exists (select 1 from lines l where l.variant_id = v.id)
                         and not exists (select 1 from lines l
                                          where l.variant_id = v.id and l.unit_cost is null))
         order by v.sort_order, v.id), '[]'::jsonb)
    into v_sizes
    from menu_item_variants v
   where v.item_id = v_run.menu_item_id;

  return jsonb_build_object('sizes', v_sizes, 'unknown_lines', v_unknown);
end $release_cost_0172$;

comment on function app.release_cost(uuid) is
  'product_release (§2.9). MGMT at the run''s venue: {sizes: [{variant_id, name_en, name_ar, cost_iqd, cost_known}], unknown_lines: [label]}, the cost to make each size of the draft from its recipe (latest batch cost, else pack cost). cost_known is false when a line has neither, the size has no recipe, or the proposal still has free-text lines (listed in unknown_lines). PROTOCOL_NOT_FOUND.';

revoke all on function app.release_cost(uuid) from public, anon;
grant execute on function app.release_cost(uuid) to authenticated;

create or replace function app.release_test_context(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_test_context_0172$
declare
  v_run  protocol_runs%rowtype;
  v_mgmt boolean;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.kind <> 'product_release'
     or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_mgmt := app.is_staff_at(v_run.venue_id, 'manager', 'owner');
  -- Nobody outside the run learns it exists.
  if not v_mgmt and not app.protocol_engine_involved(v_run.id) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not v_mgmt
     and not exists (select 1 from protocol_run_steps s
                      where s.run_id = v_run.id and s.step_key = 'test' and s.assigned_to = auth.uid()) then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001';
  end if;

  return jsonb_build_object('sizes', coalesce((
    select jsonb_agg(jsonb_build_object(
             'variant_id', v.id,
             'name_en',    v.name_en,
             'name_ar',    v.name_ar,
             'lines',      coalesce((
               select jsonb_agg(jsonb_build_object(
                        'ingredient_id', i.id, 'name_en', i.name_en, 'name_ar', i.name_ar,
                        'qty', rl.qty, 'unit', i.unit)
                      order by i.name_en, rl.id)
                 from recipe_lines rl
                 join ingredients i on i.id = rl.ingredient_id
                where rl.variant_id = v.id), '[]'::jsonb))
           order by v.sort_order, v.id)
      from menu_item_variants v
     where v.item_id = v_run.menu_item_id), '[]'::jsonb));
end $release_test_context_0172$;

comment on function app.release_test_context(uuid) is
  'product_release (§2.7, §2.9). The test step''s assignee (the proposer) or MGMT at the run''s venue: {sizes: [{variant_id, name_en, name_ar, lines: [{ingredient_id, name_en, name_ar, qty, unit}]}]}, the draft''s recipe to make the test servings from; no cost, no price. PROTOCOL_NOT_FOUND for anyone outside the run, NOT_STEP_ACTOR for anyone else in it.';

revoke all on function app.release_test_context(uuid) from public, anon;
grant execute on function app.release_test_context(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Ideas (#65): sent by a barista or chef assistant, reviewed by the head of
--    their team (or MGMT), followed by the author.
-- ---------------------------------------------------------------------------

-- Who is told an idea waits: the team's head at the venue, else its managers.
create or replace function app.release_idea_reviewer_ids(p_venue uuid, p_team text)
returns uuid[]
language sql stable security definer set search_path = public as $release_idea_reviewer_ids_0172$
  select case
    when cardinality(app.staff_ids_with_roles(p_venue, array[app.staff_team_head(p_team)])) > 0
      then app.staff_ids_with_roles(p_venue, array[app.staff_team_head(p_team)])
    else app.staff_ids_with_roles(p_venue, '{manager}')
  end
$release_idea_reviewer_ids_0172$;

comment on function app.release_idea_reviewer_ids(uuid, text) is
  'product_release (§2.9, §2.21). Internal: the recipients of idea_submitted, the active holders of the team''s head role at the venue, or the venue''s managers when there is none.';

revoke all on function app.release_idea_reviewer_ids(uuid, text) from public, anon, authenticated;

create or replace function app.submit_release_idea(
  p_record          jsonb,
  p_photos          text[] default '{}',
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_release_idea_0172$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_record jsonb;
  v_photos text[];
  v_team   text;
  v_id     uuid;
  v_result jsonb;
begin
  if not app.is_staff('barista', 'chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'barista', 'chef')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'submit_release_idea');
  if v_replay is not null then
    return v_replay;
  end if;

  v_record := app.release_propose_check(p_record, v_venue, 'refused');
  if p_photos is not null and array_position(p_photos, null) is not null then
    raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
  end if;
  -- In the order given, once each.
  v_photos := coalesce(array(select u.x
                               from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by u.x
                              order by min(u.o)), '{}'::text[]);
  if cardinality(v_photos) > 6 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'photos';
  end if;
  v_team := app.staff_team(app.staff_role());

  insert into release_ideas (venue_id, team, author_id, record, photos)
  values (v_venue, v_team, auth.uid(), v_record, v_photos)
  returning id into v_id;

  perform app.claim_staff_media(v_photos, v_venue, array['proposals'], 'release_idea:' || v_id::text);

  perform app.write_audit('protocol.release.idea_submit', 'release_idea', v_id::text, null,
    jsonb_build_object('status', 'waiting', 'team', v_team, 'photos', cardinality(v_photos)));

  perform app.notify_staff(
    app.release_idea_reviewer_ids(v_venue, v_team), 'staff_decide',
    jsonb_build_object(
      'route', 'staff', 'id', v_id, 'title_key', 'idea_submitted',
      'params', jsonb_build_object('name', (select s.display_name from staff s where s.id = auth.uid()),
                                   'title', coalesce(v_record->>'name_en', v_record->>'name_ar'))));

  v_result := jsonb_build_object('id', v_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $submit_release_idea_0172$;

comment on function app.submit_release_idea(jsonb, text[], uuid, text) is
  'product_release (§2.9, #65). A barista or chef assistant at the venue sends an idea for a new item: the propose record with no category (app.release_propose_check, refused), up to 6 proposals photos of their own (claimed release_idea:<id>). It waits for the head of their team, who is told (staff_decide / idea_submitted; the venue''s managers when the team has no head). Returns {id}. FORBIDDEN, RECORD_INVALID (hint the field, category_id included), TEXT_TOO_LONG, PHOTO_PATH_INVALID. Idempotent on p_idempotency_key. Audit protocol.release.idea_submit.';

revoke all on function app.submit_release_idea(jsonb, text[], uuid, text) from public, anon;
grant execute on function app.submit_release_idea(jsonb, text[], uuid, text) to authenticated;

create or replace function app.withdraw_release_idea(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_release_idea_0172$
declare
  v_idea release_ideas%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_idea from release_ideas where id = p_id for update;
  if not found or not (v_idea.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if v_idea.author_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_idea.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_idea.venue_id::text, true);

  update release_ideas set status = 'withdrawn' where id = v_idea.id;

  perform app.write_audit('protocol.release.idea_withdraw', 'release_idea', v_idea.id::text,
    jsonb_build_object('status', 'waiting'), jsonb_build_object('status', 'withdrawn'));
  return jsonb_build_object('status', 'withdrawn');
end $withdraw_release_idea_0172$;

comment on function app.withdraw_release_idea(uuid) is
  'product_release (§2.9). The author withdraws a waiting idea. REF_NOT_FOUND (unknown or elsewhere), FORBIDDEN for anyone else, SUBMISSION_DECIDED once started, declined or withdrawn. Returns {status}. Audit protocol.release.idea_withdraw.';

revoke all on function app.withdraw_release_idea(uuid) from public, anon;
grant execute on function app.withdraw_release_idea(uuid) to authenticated;

create or replace function app.decline_release_idea(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $decline_release_idea_0172$
declare
  v_idea   release_ideas%rowtype;
  v_reason text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_idea from release_ideas where id = p_id for update;
  if not found or not (v_idea.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not (app.is_staff_at(v_idea.venue_id, app.staff_team_head(v_idea.team))
          or app.is_staff_at(v_idea.venue_id, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_idea.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;
  perform set_config('app.venue_id', v_idea.venue_id::text, true);

  update release_ideas
     set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = v_reason
   where id = v_idea.id;

  perform app.write_audit('protocol.release.idea_decline', 'release_idea', v_idea.id::text,
    jsonb_build_object('status', 'waiting'), jsonb_build_object('status', 'declined', 'team', v_idea.team));
  perform app.notify_staff(
    array[v_idea.author_id], 'staff_decided',
    jsonb_build_object('route', 'staff', 'id', v_idea.id, 'title_key', 'idea_declined',
                       'params', jsonb_build_object(
                         'title', coalesce(v_idea.record->>'name_en', v_idea.record->>'name_ar'))));
  return jsonb_build_object('status', 'declined');
end $decline_release_idea_0172$;

comment on function app.decline_release_idea(uuid, text) is
  'product_release (§2.9). The head of the idea''s team (head_barista for bar, head_chef for kitchen) or MGMT at its venue declines a waiting idea with a reason (<= 1000), which the author reads; the author is told (staff_decided / idea_declined). REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED, REASON_REQUIRED, TEXT_TOO_LONG. Returns {status}. Audit protocol.release.idea_decline (no text).';

revoke all on function app.decline_release_idea(uuid, text) from public, anon;
grant execute on function app.decline_release_idea(uuid, text) to authenticated;

create or replace function app.release_ideas_to_review(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_ideas_to_review_0172$
declare
  v_venue uuid;
  v_teams text[];
  v_ideas jsonb;
begin
  if not app.is_staff('head_barista', 'head_chef', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista', 'head_chef', 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_teams := case when app.is_staff_at(v_venue, 'manager', 'owner') then array['bar', 'kitchen']
                  else array[app.staff_team(app.staff_role())] end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           i.id,
           'team',         i.team,
           'author_name',  s.display_name,
           'submitted_at', i.submitted_at,
           'record',       i.record,
           'photos',       to_jsonb(i.photos))
         order by i.submitted_at, i.id), '[]'::jsonb)
    into v_ideas
    from release_ideas i
    left join staff s on s.id = i.author_id
   where i.venue_id = v_venue and i.status = 'waiting' and i.team = any(v_teams);

  return jsonb_build_object('ideas', v_ideas, 'count', jsonb_array_length(v_ideas));
end $release_ideas_to_review_0172$;

comment on function app.release_ideas_to_review(uuid) is
  'product_release (§2.9). The head roles and MGMT at the venue: {ideas: [{id, team, author_name, submitted_at, record, photos}], count}, the waiting ideas, oldest first; head_barista the bar''s, head_chef the kitchen''s, MGMT both. FORBIDDEN for anyone else.';

revoke all on function app.release_ideas_to_review(uuid) from public, anon;
grant execute on function app.release_ideas_to_review(uuid) to authenticated;

create or replace function app.my_release_ideas(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_release_ideas_0172$
declare
  v_venue uuid;
begin
  if not app.is_staff('barista', 'chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'barista', 'chef')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The run as its status and step names only: the proposal is the item's
  -- recipe with quantities, which #72 keeps from the author's role.
  return jsonb_build_object('ideas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',              i.id,
             'team',            i.team,
             'record',          i.record,
             'photos',          to_jsonb(i.photos),
             'status',          i.status,
             'submitted_at',    i.submitted_at,
             'decided_by_name', (select s.display_name from staff s where s.id = i.decided_by),
             'decided_at',      i.decided_at,
             'decline_reason',  i.decline_reason,
             'run',             case when r.id is null then null else jsonb_build_object(
                                  'run_id',        r.id,
                                  'status',        r.status,
                                  'title_en',      r.title_en,
                                  'title_ar',      r.title_ar,
                                  'current_steps', coalesce((
                                    select jsonb_agg(jsonb_build_object(
                                             'name_en', st.name_en, 'name_ar', st.name_ar, 'status', st.status)
                                           order by st.position)
                                      from protocol_run_steps st
                                     where st.run_id = r.id and st.status in ('open', 'submitted')), '[]'::jsonb))
                                end)
           order by i.submitted_at desc, i.id)
      from release_ideas i
      left join protocol_runs r on r.id = i.run_id
     where i.author_id = auth.uid()
       and i.venue_id = v_venue
       and i.submitted_at > now() - interval '90 days'), '[]'::jsonb));
end $my_release_ideas_0172$;

comment on function app.my_release_ideas(uuid) is
  'product_release (§2.9). A barista or chef assistant at the venue: {ideas: [{id, team, record, photos, status, submitted_at, decided_by_name, decided_at, decline_reason, run: {run_id, status, title_en, title_ar, current_steps: [{name_en, name_ar, status}]} | null}]}, their own ideas of the last 90 days, newest first. The run carries no record, data or figure. FORBIDDEN for anyone else.';

revoke all on function app.my_release_ideas(uuid) from public, anon;
grant execute on function app.my_release_ideas(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Count differences and the stock report show product tests (§2.9).
--     v_variance_report: 0019:205 verbatim, with product_test_qty appended as
--     the last column (a create or replace may only add at the end).
-- ---------------------------------------------------------------------------
create or replace view v_variance_report with (security_invoker = on) as
with counts as (
  select c.id, c.finalized_at, c.counted_by,
         lag(c.finalized_at) over (order by c.finalized_at) as period_start
    from stock_counts c
   where c.finalized_at is not null
)
select c.id                          as count_id,
       c.period_start,
       c.finalized_at                as period_end,
       l.ingredient_id,
       i.name_en, i.name_ar, i.unit,
       l.theoretical_qty,
       l.counted_qty,
       l.counted_qty - l.theoretical_qty        as variance_qty,
       p.sold_qty,
       round(p.sold_qty * i.waste_allowance_percent / 100.0, 3)
                                     as expected_waste_qty,   -- allowance, separate column
       p.recorded_waste_qty,                                   -- spill + spoilage
       p.void_qty,                                             -- void_after_send
       p.expired_qty,                                          -- expired_writeoff
       p.movement_ids,                                         -- drill-down
       p.product_test_qty                                      -- product_test (a release's test servings)
  from stock_count_lines l
  join counts c on c.id = l.count_id
  join ingredients i on i.id = l.ingredient_id
  left join lateral (
    select coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'sale_consumption'), 0) as sold_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type in ('waste_spill','waste_spoilage')), 0) as recorded_waste_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'void_after_send'), 0) as void_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'expired_writeoff'), 0) as expired_qty,
           array_agg(sm.id order by sm.id) as movement_ids,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'product_test'), 0) as product_test_qty
      from stock_movements sm
     where sm.ingredient_id = l.ingredient_id
       and sm.at <= c.finalized_at
       and (c.period_start is null or sm.at > c.period_start)
  ) p on true;

comment on column v_variance_report.product_test_qty is
  'product_release (§2.9): what left stock in the period as a new item''s test servings (product_test movements), a positive quantity in the ingredient''s unit; one of the explanations of a count difference, never waste.';

-- The owner assistant reads the view's columns from its allowlist; the new
-- column joins it (one row, never the all-table catch-up, §1.5).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'view', true, c.data_type, c.ordinal_position,
       col_description('public.v_variance_report'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'v_variance_report' and c.column_name = 'product_test_qty'
on conflict (table_name, column_name) do nothing;

-- app.report_stock — 0068:971 verbatim, plus productTestQty on each variance
-- row.
create or replace function app.report_stock(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_stock_0172$
declare
  v_b        record;
  v_ing      uuid;
  v_value    bigint;
  v_low      jsonb;
  v_par      jsonb;
  v_soon     jsonb;
  v_expired  jsonb;
  v_cons     jsonb;
  v_var      jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'ingredientId' and jsonb_typeof(p_filters -> 'ingredientId') <> 'null' then
    begin
      v_ing := (p_filters ->> 'ingredientId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'ingredientId';
    end;
  end if;

  select coalesce(round(sum(b.qty_remaining * b.unit_cost_iqd)), 0)::bigint
    into v_value
    from stock_batches b
   where b.qty_remaining > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', v.ingredient_id,
           'nameEn',       v.name_en,
           'nameAr',       v.name_ar,
           'unit',         v.unit,
           'onHand',       v.on_hand,
           'threshold',    v.low_stock_threshold,
           'parLevel',     v.par_level
         ) order by v.name_en), '[]'::jsonb)
    into v_low
    from v_ingredient_on_hand v
   where v.is_active and v.low_stock_threshold is not null and v.on_hand <= v.low_stock_threshold;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', v.ingredient_id,
           'nameEn',       v.name_en,
           'nameAr',       v.name_ar,
           'unit',         v.unit,
           'onHand',       v.on_hand,
           'parLevel',     v.par_level,
           'shortfall',    v.par_level - v.on_hand
         ) order by (v.par_level - v.on_hand) desc, v.name_en), '[]'::jsonb)
    into v_par
    from v_ingredient_on_hand v
   where v.is_active and v.par_level is not null and v.on_hand < v.par_level;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysLeft',     e.days_left,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_soon
    from v_expiring_soon e;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysExpired',  e.days_expired,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_expired
    from v_expired e;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', x.ingredient_id,
           'nameEn',       i.name_en,
           'nameAr',       i.name_ar,
           'unit',         i.unit,
           'consumedQty',  x.qty,
           'costIqd',      x.cost
         ) order by x.cost desc, i.name_en), '[]'::jsonb)
    into v_cons
    from (
      select sm.ingredient_id,
             sum(-sm.qty_delta)                                                       as qty,
             coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost
        from stock_movements sm
       where sm.movement_type in ('sale_consumption','production_consume')
         and sm.qty_delta < 0
         and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
         and (v_ing is null or sm.ingredient_id = v_ing)
       group by sm.ingredient_id) x
    join ingredients i on i.id = x.ingredient_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'countId',          r.count_id,
           'periodStart',      r.period_start,
           'periodEnd',        r.period_end,
           'ingredientId',     r.ingredient_id,
           'nameEn',           r.name_en,
           'nameAr',           r.name_ar,
           'unit',             r.unit,
           'theoreticalQty',   r.theoretical_qty,
           'countedQty',       r.counted_qty,
           'varianceQty',      r.variance_qty,
           'soldQty',          r.sold_qty,
           'expectedWasteQty', r.expected_waste_qty,
           'recordedWasteQty', r.recorded_waste_qty,
           'voidQty',          r.void_qty,
           'expiredQty',       r.expired_qty,
           'productTestQty',   r.product_test_qty
         ) order by r.period_end desc, r.name_en), '[]'::jsonb)
    into v_var
    from v_variance_report r
   where r.period_end >= v_b.ts_from and r.period_end < v_b.ts_to
     and (v_ing is null or r.ingredient_id = v_ing);

  return jsonb_build_object(
    'period',        jsonb_build_object('from', p_from, 'to', p_to),
    'stockValueIqd', v_value,
    'lowStock',      v_low,
    'belowPar',      v_par,
    'expiringSoon',  v_soon,
    'expired',       v_expired,
    'consumption',   v_cons,
    'variance',      v_var,
    'comparison',    null);
end $report_stock_0172$;

comment on function app.report_stock(date, date, jsonb) is
  'Manager or owner (0068; product_release adds productTestQty to each variance row): the stock report for [p_from, p_to] in business days: stock value, low stock, below par, expiring and expired batches, consumption and count differences.';

revoke all on function app.report_stock(date, date, jsonb) from public, anon;
grant execute on function app.report_stock(date, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Owner assistant: release_ideas joins the table_read allowlist (the 0144
--     statement, limited to this migration's table, §1.5; never the
--     all-table catch-up). record is left out: it is the idea's recipe with
--     quantities (jsonb is not a default read anyway).
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
   and c.table_name in ('release_ideas')
   and (c.table_name, c.column_name) not in (('release_ideas', 'record'))
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
