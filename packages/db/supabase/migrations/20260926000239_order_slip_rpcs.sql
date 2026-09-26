-- 0239 order_slip_rpcs — scanned ORDER SLIPS (Phase 2, Milestone 4b), the
-- functions. Tables and the flow: 0238.
--
--   create_order_slip     waiter / cashier / MGMT   file a photographed order slip
--   slip_begin_reading    service_role              take a slip for a reading
--   slip_store_reading    service_role              store the lines read, match them
--   slip_fail_reading     service_role              a reading that produced no lines
--   match_slip_lines      internal                  alias -> trigram -> none, on the menu
--   slips_to_send         cashier / MGMT            the till's "Scanned orders"
--   slip_detail           cashier / MGMT / uploader one slip with its lines
--   send_order_slip       cashier / MGMT            the order, through app.till_add_items
--   reject_order_slip     cashier / MGMT            set a slip aside
--   my_order_slips        any staff                 the phone's own slips today
--   my_receipts           any staff                 the phone's own receipts (0236)
--
-- The model never creates an order: a reading only fills order_slip_lines, and
-- only a cashier's send puts anything on a tab, with the items, quantities and
-- options the cashier saw. The send IS app.till_add_items (0217), called from
-- here in the same transaction, so NO_OPEN_DAY, the tab and branch guards, the
-- price snapshot, the modifier rules, stock and the kitchen ticket are the
-- till's own.
--
-- covered by packages/db/tests/order-slips.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.create_order_slip — the waiter, the cashier and MGMT at the branch.
--    The photo is the caller's own unclaimed upload in the slips folder.
-- ---------------------------------------------------------------------------
create or replace function app.create_order_slip(
  p_venue_id        uuid,
  p_storage_path    text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_order_slip_0239$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_path   text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_id     uuid := gen_random_uuid();
  v_result jsonb;
begin
  if not app.is_staff('waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'create_order_slip');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_path is null then
    raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
  end if;
  perform app.claim_staff_media(array[v_path], v_venue, array['slips'], 'order_slip:' || v_id::text);

  insert into order_slips (id, venue_id, storage_path, uploaded_by)
  values (v_id, v_venue, v_path, auth.uid());

  perform app.write_audit('order_slip.create', 'order_slips', v_id::text, null, '{}'::jsonb);

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $create_order_slip_0239$;

comment on function app.create_order_slip(uuid, text, text) is
  'order_slip_rpcs (0239). The waiter, the cashier and MGMT at the branch: files a photographed order slip (the caller''s own unclaimed staff-media upload in the slips folder, claimed as order_slip:<id>). Returns {id}; status uploaded until receipt-scan reads it; broadcast on the floor topics (rt_order_slip). Idempotent by key. PHOTO_PATH_INVALID; FORBIDDEN for anyone else. Audit order_slip.create.';

revoke all on function app.create_order_slip(uuid, text, text) from public, anon;
grant execute on function app.create_order_slip(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.slip_begin_reading — service_role (receipt-scan). Takes the slip for
--    one reading (a reading older than three minutes may be taken over) and
--    hands the model the branch's menu names.
-- ---------------------------------------------------------------------------
create or replace function app.slip_begin_reading(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $slip_begin_reading_0239$
declare
  v_s     order_slips%rowtype;
  v_names jsonb;
begin
  select * into v_s from order_slips where id = p_id for update;
  if not found then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_s.status in ('sent','rejected') then
    raise exception 'SLIP_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_s.status = 'reading' and v_s.reading_started_at > now() - interval '3 minutes' then
    raise exception 'SLIP_BUSY' using errcode = 'P0001';
  end if;

  update order_slips
     set status = 'reading', reading_started_at = now(), error_code = null
   where id = p_id;

  -- The cafe menu of the branch, "English / Arabic", at most 250 items.
  select coalesce(jsonb_agg(x.label order by x.sort_order, x.label), '[]'::jsonb) into v_names
    from (select mi.name_en || ' / ' || mi.name_ar as label, c.sort_order
            from menu_items mi
            join menu_categories c on c.id = mi.category_id
           where mi.venue_id = v_s.venue_id and mi.is_active
             and c.is_active and c.kind = 'cafe'
           order by c.sort_order, mi.sort_order
           limit 250) x;

  return jsonb_build_object('id', v_s.id, 'venue_id', v_s.venue_id,
                            'storage_path', v_s.storage_path, 'menu_names', v_names);
end $slip_begin_reading_0239$;

comment on function app.slip_begin_reading(uuid) is
  'order_slip_rpcs (0239). Service role (receipt-scan): takes a slip for a reading (status reading) and returns {id, venue_id, storage_path, menu_names} (the branch''s active cafe items, "English / Arabic", at most 250). SLIP_NOT_FOUND, SLIP_ALREADY_DONE (sent or rejected), SLIP_BUSY (another reading started less than three minutes ago).';

revoke all on function app.slip_begin_reading(uuid) from public, anon, authenticated;
grant execute on function app.slip_begin_reading(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.match_slip_lines — internal. For every line not matched by hand: a
--    wording a cashier sent before (confidence 1), else the menu variant whose
--    normalised name is most like it: the item's name (its default variant) or
--    the item and variant together ("كابتشينو كبير" -> Cappuccino, Large),
--    English or Arabic, similarity or 0.9 x word similarity (a waiter writes
--    "كرك" for "شاي كرك"), at least 0.4; else none. Active items in active
--    cafe categories of the branch only.
-- ---------------------------------------------------------------------------
create or replace function app.match_slip_lines(p_id uuid)
returns int
language plpgsql security definer set search_path = public, extensions as $match_slip_lines_0239$
declare
  v_s       order_slips%rowtype;
  v_matched int;
begin
  select * into v_s from order_slips where id = p_id;
  if not found then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;

  update order_slip_lines l
     set variant_id   = m.variant_id,
         match_source = coalesce(m.src, 'none'),
         confidence   = m.conf
    from (select l2.id, best.variant_id, best.src, best.conf
            from order_slip_lines l2
            cross join lateral (select app.search_norm(l2.text_read) as t) n
            left join lateral (
              select x.variant_id, x.src, x.conf
                from (select a.variant_id, 'alias'::text as src, 1.000::numeric as conf, 0 as pri
                        from menu_aliases a
                        join menu_item_variants v on v.id = a.variant_id
                        join menu_items mi on mi.id = v.item_id and mi.is_active
                       where a.venue_id = v_s.venue_id
                         and a.alias_norm = n.t
                      union all
                      select c.variant_id, 'trigram'::text,
                             round(least(1, c.score)::numeric, 3), 1
                        from (select v.id as variant_id,
                                     greatest(
                                       -- the item's own name picks its default variant
                                       case when v.is_default then
                                         greatest(similarity(n.t, app.search_norm(mi.name_en)),
                                                  similarity(n.t, app.search_norm(mi.name_ar)),
                                                  0.9 * word_similarity(n.t, app.search_norm(mi.name_en)),
                                                  0.9 * word_similarity(n.t, app.search_norm(mi.name_ar)))
                                       else 0 end,
                                       -- item and variant together pick that variant
                                       similarity(n.t, app.search_norm(mi.name_en || ' ' || v.name_en)),
                                       similarity(n.t, app.search_norm(mi.name_ar || ' ' || v.name_ar))) as score
                                from menu_items mi
                                join menu_categories cat on cat.id = mi.category_id
                                join menu_item_variants v on v.item_id = mi.id
                               where mi.venue_id = v_s.venue_id
                                 and mi.is_active
                                 and cat.is_active
                                 and cat.kind = 'cafe') c
                       where c.score >= 0.4) x
               order by x.pri, x.conf desc, x.variant_id
               limit 1) best on true
           where l2.slip_id = p_id
             and l2.match_source <> 'manual') m
   where l.id = m.id;

  select count(*) into v_matched
    from order_slip_lines
   where slip_id = p_id and variant_id is not null;
  return v_matched;
end $match_slip_lines_0239$;

comment on function app.match_slip_lines(uuid) is
  'order_slip_rpcs (0239). Internal: matches every line of a slip that was not matched by hand to a menu variant of its branch: a wording a cashier sent before (confidence 1), else by pg_trgm on app.search_norm names (the item name for its default variant, or item + variant name; similarity, or 0.9 x word similarity; at least 0.4), active items in active cafe categories only, else none. Returns how many lines are matched.';

revoke all on function app.match_slip_lines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.slip_store_reading — service_role (receipt-scan). The reading was
--    validated by the edge function (validateSlip); this stores it, finds the
--    table by its number and matches the lines.
-- ---------------------------------------------------------------------------
create or replace function app.slip_store_reading(
  p_id      uuid,
  p_reading jsonb,
  p_model   text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $slip_store_reading_0239$
declare
  v_s       order_slips%rowtype;
  v_line    jsonb;
  v_no      int := 0;
  v_text    text;
  v_qty     numeric;
  v_table   text := left(nullif(btrim(coalesce(p_reading->>'table_number', '')), ''), 20);
  v_tid     uuid;
  v_matched int;
begin
  select * into v_s from order_slips where id = p_id for update;
  if not found then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_s.status <> 'reading' then
    raise exception 'SLIP_NOT_READING' using errcode = 'P0001';
  end if;
  if p_reading is null or jsonb_typeof(p_reading) <> 'object'
     or jsonb_typeof(p_reading->'lines') is distinct from 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'reading';
  end if;

  delete from order_slip_lines where slip_id = p_id;

  for v_line in select e from jsonb_array_elements(p_reading->'lines') e limit 60 loop
    v_text := left(nullif(btrim(coalesce(v_line->>'text', '')), ''), 200);
    continue when v_text is null;
    v_no := v_no + 1;
    v_qty := case when jsonb_typeof(v_line->'qty') = 'number' then (v_line->>'qty')::numeric end;
    insert into order_slip_lines (slip_id, line_no, text_read, qty_read, notes_read, flags)
    values (p_id, v_no, v_text,
            case when v_qty between 1 and 99 and v_qty = trunc(v_qty) then v_qty::int end,
            left(nullif(btrim(coalesce(v_line->>'notes', '')), ''), 200),
            coalesce((select array_agg(f) from jsonb_array_elements_text(
                        case when jsonb_typeof(v_line->'flags') = 'array' then v_line->'flags' else '[]'::jsonb end) f),
                     '{}'));
  end loop;

  -- The table, when its number (digits only, "T5" -> 5) is one of the branch's.
  if v_table is not null then
    select t.id into v_tid
      from cafe_tables t
     where t.venue_id = v_s.venue_id and t.is_active
       and nullif(regexp_replace(t.table_number, '\D', '', 'g'), '')::bigint
           = nullif(regexp_replace(v_table, '\D', '', 'g'), '')::bigint
     order by t.table_number, t.id
     limit 1;
  end if;

  update order_slips
     set status            = 'read',
         read_at           = now(),
         error_code        = null,
         model             = left(nullif(btrim(coalesce(p_model, '')), ''), 100),
         table_number_read = v_table,
         table_id          = coalesce(v_tid, table_id)
   where id = p_id;

  v_matched := app.match_slip_lines(p_id);

  perform set_config('app.venue_id', v_s.venue_id::text, true);
  perform app.write_audit('order_slip.read', 'order_slips', p_id::text, null,
                          jsonb_build_object('lines', v_no, 'matched', v_matched,
                                             'table', v_table,
                                             'model', left(nullif(btrim(coalesce(p_model, '')), ''), 100)));
  return jsonb_build_object('id', p_id, 'lines', v_no, 'matched', v_matched);
end $slip_store_reading_0239$;

comment on function app.slip_store_reading(uuid, jsonb, text) is
  'order_slip_rpcs (0239). Service role (receipt-scan): replaces a reading slip''s lines with {table_number?, lines: [{text, qty?, notes?, flags?}]} (at most 60 lines; empty text skipped; qty a whole 1..99), finds the branch''s active table whose number''s digits are the number read, matches the lines and sets status read. Returns {id, lines, matched}. SLIP_NOT_FOUND, SLIP_NOT_READING, INVALID_ARGUMENT (hint reading). Audit order_slip.read.';

revoke all on function app.slip_store_reading(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.slip_store_reading(uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.slip_fail_reading — service_role (receipt-scan): back to uploaded
--    (nothing was tried) or failed (the model could not read it).
-- ---------------------------------------------------------------------------
create or replace function app.slip_fail_reading(
  p_id     uuid,
  p_code   text,
  p_status text default 'failed'
) returns void
language plpgsql security definer set search_path = public as $slip_fail_reading_0239$
declare
  v_venue uuid;
  v_code  text := left(coalesce(nullif(btrim(p_code), ''), 'UPSTREAM'), 60);
begin
  if p_status not in ('uploaded','failed') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;
  update order_slips
     set status = p_status, error_code = v_code
   where id = p_id and status = 'reading'
  returning venue_id into v_venue;
  if v_venue is not null then
    perform set_config('app.venue_id', v_venue::text, true);
    perform app.write_audit('order_slip.read_failed', 'order_slips', p_id::text, null,
                            jsonb_build_object('code', v_code, 'status', p_status));
  end if;
end $slip_fail_reading_0239$;

comment on function app.slip_fail_reading(uuid, text, text) is
  'order_slip_rpcs (0239). Service role (receipt-scan): ends a reading that stored no lines, with a code: uploaded when nothing was tried (no model, budget spent), failed when the model could not read it. A slip that is no longer reading is left alone. INVALID_ARGUMENT (hint status). Audit order_slip.read_failed.';

revoke all on function app.slip_fail_reading(uuid, text, text) from public, anon, authenticated;
grant execute on function app.slip_fail_reading(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. app.slips_to_send — the cashier and MGMT at the branch: every slip still
--    to send, then the ones sent or set aside in the last 12 hours.
-- ---------------------------------------------------------------------------
create or replace function app.slips_to_send(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $slips_to_send_0239$
declare
  v_venue uuid;
  v_items jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'status',            x.status,
           'error_code',        x.error_code,
           'storage_path',      x.storage_path,
           'uploaded_by_name',  x.uploaded_by_name,
           'created_at',        x.created_at,
           'table_number_read', x.table_number_read,
           'table_id',          x.table_id,
           'table_number',      x.table_number,
           'line_count',        x.line_count,
           'matched_count',     x.matched_count,
           'tab_id',            x.tab_id,
           'order_id',          x.order_id,
           'sent_by_name',      x.sent_by_name,
           'sent_at',           x.sent_at)
         order by x.done, x.created_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select s.id, s.status, s.error_code, s.storage_path, u.display_name as uploaded_by_name,
                 s.created_at, s.table_number_read, s.table_id, t.table_number, s.tab_id, s.order_id,
                 b.display_name as sent_by_name, s.sent_at,
                 s.status in ('sent','rejected') as done,
                 (select count(*) from order_slip_lines l where l.slip_id = s.id) as line_count,
                 (select count(*) from order_slip_lines l where l.slip_id = s.id and l.variant_id is not null) as matched_count
            from order_slips s
            left join staff u on u.id = s.uploaded_by
            left join staff b on b.id = s.sent_by
            left join cafe_tables t on t.id = s.table_id
           where s.venue_id = v_venue
             and (s.status in ('uploaded','reading','read','failed')
                  or coalesce(s.sent_at, s.rejected_at) > now() - interval '12 hours')
           order by s.status in ('sent','rejected'), s.created_at desc, s.id
           limit 100) x;

  return jsonb_build_object('slips', v_items);
end $slips_to_send_0239$;

comment on function app.slips_to_send(uuid) is
  'order_slip_rpcs (0239). The cashier and MGMT at the branch: {slips: [{id, status, error_code, storage_path, uploaded_by_name, created_at, table_number_read, table_id, table_number, line_count, matched_count, tab_id, order_id, sent_by_name, sent_at}]}, every slip still to send (newest first), then those sent or set aside in the last 12 hours; at most 100. FORBIDDEN for anyone else.';

revoke all on function app.slips_to_send(uuid) from public, anon;
grant execute on function app.slips_to_send(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.slip_detail — the cashier and MGMT at the slip's branch, or the
--    staff member who took it: the slip and its lines, each with the matched
--    item and variant.
-- ---------------------------------------------------------------------------
create or replace function app.slip_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $slip_detail_0239$
declare
  v_s     order_slips%rowtype;
  v_lines jsonb;
  v_tnum  text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from order_slips where id = p_id;
  if not found
     or not (v_s.uploaded_by = auth.uid() or app.is_staff_at(v_s.venue_id, 'cashier','manager','owner')) then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              l.id,
           'line_no',         l.line_no,
           'text_read',       l.text_read,
           'qty_read',        l.qty_read,
           'notes_read',      l.notes_read,
           'flags',           to_jsonb(l.flags),
           'variant_id',      l.variant_id,
           'match_source',    l.match_source,
           'confidence',      l.confidence,
           'item_id',         mi.id,
           'item_name_en',    mi.name_en,
           'item_name_ar',    mi.name_ar,
           'variant_name_en', v.name_en,
           'variant_name_ar', v.name_ar)
         order by l.line_no), '[]'::jsonb)
    into v_lines
    from order_slip_lines l
    left join menu_item_variants v on v.id = l.variant_id
    left join menu_items mi on mi.id = v.item_id
   where l.slip_id = p_id;

  select table_number into v_tnum from cafe_tables where id = v_s.table_id;

  return jsonb_build_object(
    'id',                v_s.id,
    'venue_id',          v_s.venue_id,
    'status',            v_s.status,
    'error_code',        v_s.error_code,
    'storage_path',      v_s.storage_path,
    'created_at',        v_s.created_at,
    'read_at',           v_s.read_at,
    'model',             v_s.model,
    'table_number_read', v_s.table_number_read,
    'table_id',          v_s.table_id,
    'table_number',      v_tnum,
    'tab_id',            v_s.tab_id,
    'order_id',          v_s.order_id,
    'sent_at',           v_s.sent_at,
    'rejected_reason',   v_s.rejected_reason,
    'lines',             v_lines);
end $slip_detail_0239$;

comment on function app.slip_detail(uuid) is
  'order_slip_rpcs (0239). The cashier and MGMT at the slip''s branch, or the staff member who took it: {id, venue_id, status, error_code, storage_path, created_at, read_at, model, table_number_read, table_id, table_number, tab_id, order_id, sent_at, rejected_reason, lines: [{id, line_no, text_read, qty_read, notes_read, flags, variant_id, match_source, confidence, item_id, item_name_en, item_name_ar, variant_name_en, variant_name_ar}]}. SLIP_NOT_FOUND for anyone else (and an unknown id); FORBIDDEN for a caller who is not staff.';

revoke all on function app.slip_detail(uuid) from public, anon;
grant execute on function app.slip_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.send_order_slip — the cashier and MGMT at the slip's branch: the
--    order, through the till's own app.till_add_items, onto p_tab_id; or, for
--    p_table_id, onto that table's one open tab, or a new tab opened there with
--    app.open_tab. Then each sent line learns its wording as an alias.
--    p_items: [{line_id?, variant_id, qty, notes?, modifiers?: [{modifier_id, qty}]}]
-- ---------------------------------------------------------------------------
create or replace function app.send_order_slip(
  p_id              uuid,
  p_items           jsonb,
  p_tab_id          uuid default null,
  p_table_id        uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $send_order_slip_0239$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_replay  jsonb;
  v_s       order_slips%rowtype;
  v_el      jsonb;
  v_lid     uuid;
  v_vid     uuid;
  v_seen    uuid[] := '{}';
  v_items   jsonb := '[]'::jsonb;
  v_learn   jsonb := '[]'::jsonb;
  v_line    order_slip_lines%rowtype;
  v_tab     uuid := p_tab_id;
  v_tabs    uuid[];
  v_open    jsonb;
  v_order   jsonb;
  v_alias   text;
  v_result  jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'send_order_slip');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_s from order_slips where id = p_id for update;
  if not found or not (v_s.venue_id = any(app.staff_venue_ids())) then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_s.venue_id, 'cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);

  if v_s.status in ('sent','rejected') then
    raise exception 'SLIP_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_s.status = 'reading' and v_s.reading_started_at > now() - interval '3 minutes' then
    raise exception 'SLIP_BUSY' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el->>'variant_id', '') !~ c_uuid then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_vid := (v_el->>'variant_id')::uuid;
    if v_el ? 'line_id' and v_el->>'line_id' is not null then
      if v_el->>'line_id' !~ c_uuid then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
      end if;
      v_lid := (v_el->>'line_id')::uuid;
      select * into v_line from order_slip_lines where id = v_lid and slip_id = v_s.id;
      if not found or v_lid = any(v_seen) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
      end if;
      v_seen := v_seen || v_lid;
      v_learn := v_learn || jsonb_build_array(jsonb_build_object(
                   'line_id', v_lid, 'variant_id', v_vid,
                   'manual', v_line.variant_id is distinct from v_vid));
    end if;
    -- The till's item shape (add_order_items): no price, ever.
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'variant_id', v_vid,
                 'qty',        coalesce(v_el->'qty', '1'::jsonb),
                 'notes',      nullif(btrim(coalesce(v_el->>'notes', '')), ''),
                 'modifiers',  case when jsonb_typeof(v_el->'modifiers') = 'array'
                                    then v_el->'modifiers' else '[]'::jsonb end)));
  end loop;

  -- The tab: the one named; else the table's only open tab; else a new tab on
  -- the table, opened by the till's own app.open_tab.
  if v_tab is null then
    if p_table_id is null then
      raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001';
    end if;
    select array_agg(t.id order by t.id) into v_tabs
      from tabs t
     where t.table_id = p_table_id and t.venue_id = v_s.venue_id and t.status = 'open';
    if cardinality(v_tabs) = 1 then
      v_tab := v_tabs[1];
    else
      v_open := app.open_tab(p_table_id, null, null,
                             case when p_idempotency_key is not null then p_idempotency_key || ':tab' end,
                             p_device_id);
      v_tab := (v_open->>'tab_id')::uuid;
    end if;
  end if;

  v_order := app.till_add_items(v_tab, v_items,
                                case when p_idempotency_key is not null then p_idempotency_key || ':order' end,
                                p_device_id);

  for v_el in select e from jsonb_array_elements(v_learn) e loop
    v_lid := (v_el->>'line_id')::uuid;
    v_vid := (v_el->>'variant_id')::uuid;
    update order_slip_lines
       set variant_id   = v_vid,
           match_source = case when (v_el->>'manual')::boolean then 'manual' else match_source end,
           confidence   = case when (v_el->>'manual')::boolean then null else confidence end
     where id = v_lid;
    select left(app.search_norm(text_read), 200) into v_alias from order_slip_lines where id = v_lid;
    continue when coalesce(v_alias, '') = '';
    insert into menu_aliases (venue_id, alias_norm, variant_id, created_by)
    values (v_s.venue_id, v_alias, v_vid, auth.uid())
    on conflict (venue_id, alias_norm)
    do update set variant_id   = excluded.variant_id,
                  uses         = menu_aliases.uses + 1,
                  last_used_at = now();
  end loop;

  update order_slips
     set status   = 'sent',
         tab_id   = v_tab,
         order_id = (v_order->>'order_id')::uuid,
         table_id = coalesce((select t.table_id from tabs t where t.id = v_tab), table_id),
         sent_by  = auth.uid(),
         sent_at  = now()
   where id = v_s.id;

  perform app.write_audit('order_slip.send', 'order_slips', v_s.id::text,
                          jsonb_build_object('status', v_s.status),
                          jsonb_build_object('status', 'sent', 'tab_id', v_tab,
                                             'order_id', v_order->>'order_id',
                                             'items', jsonb_array_length(v_items)),
                          null, null, p_device_id);

  v_result := jsonb_build_object('slip_id', v_s.id, 'tab_id', v_tab,
                                 'order_id', v_order->'order_id', 'ticket_id', v_order->'ticket_id',
                                 'total_iqd', v_order->'total_iqd');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $send_order_slip_0239$;

comment on function app.send_order_slip(uuid, jsonb, uuid, uuid, text, text) is
  'order_slip_rpcs (0239). The cashier and MGMT at the slip''s branch: sends the cashier''s items [{line_id?, variant_id, qty, notes?, modifiers?: [{modifier_id, qty}]}] (at most 60) as ONE order through app.till_add_items onto p_tab_id, or onto p_table_id''s only open tab, or a new tab opened there with app.open_tab; records each slip line''s accepted variant (manual when changed) and learns its wording as an alias; sets the slip sent with its tab and order. Returns {slip_id, tab_id, order_id, ticket_id, total_iqd}. Idempotent by key (the tab and the order take <key>:tab and <key>:order). SLIP_NOT_FOUND, SLIP_ALREADY_DONE, SLIP_BUSY, EMPTY_ORDER, INVALID_ARGUMENT (hint items), TAB_ANCHOR_REQUIRED, and everything open_tab and till_add_items raise (NO_OPEN_DAY, TABLE_NOT_FOUND, TAB_NOT_OPEN, VARIANT_NOT_FOUND, ITEM_UNAVAILABLE, MODIFIER_SELECTION, …). Audit order_slip.send.';

revoke all on function app.send_order_slip(uuid, jsonb, uuid, uuid, text, text) from public, anon;
grant execute on function app.send_order_slip(uuid, jsonb, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.reject_order_slip — the cashier and MGMT at the slip's branch.
-- ---------------------------------------------------------------------------
create or replace function app.reject_order_slip(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $reject_order_slip_0239$
declare
  v_s      order_slips%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from order_slips where id = p_id for update;
  if not found or not (v_s.venue_id = any(app.staff_venue_ids())) then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_s.venue_id, 'cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);
  if v_s.status in ('sent','rejected') then
    raise exception 'SLIP_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if length(v_reason) > 200 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;

  update order_slips
     set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), rejected_reason = v_reason
   where id = p_id;

  perform app.write_audit('order_slip.reject', 'order_slips', p_id::text,
                          jsonb_build_object('status', v_s.status),
                          jsonb_build_object('status', 'rejected', 'reason', v_reason));
end $reject_order_slip_0239$;

comment on function app.reject_order_slip(uuid, text) is
  'order_slip_rpcs (0239). The cashier and MGMT at the slip''s branch: sets a slip aside with an optional reason (at most 200; the waiter sees it). Nothing reaches the kitchen. SLIP_NOT_FOUND, SLIP_ALREADY_DONE, TEXT_TOO_LONG (hint reason); FORBIDDEN for anyone else. Audit order_slip.reject.';

revoke all on function app.reject_order_slip(uuid, text) from public, anon;
grant execute on function app.reject_order_slip(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The phone's own logs: app.my_order_slips (the last 24 hours) and
--     app.my_receipts (the last 30 days), the caller's own at the branch.
-- ---------------------------------------------------------------------------
create or replace function app.my_order_slips(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_order_slips_0239$
declare
  v_venue uuid;
  v_items jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'status',            x.status,
           'error_code',        x.error_code,
           'created_at',        x.created_at,
           'table_number_read', x.table_number_read,
           'table_number',      x.table_number,
           'line_count',        x.line_count,
           'sent_at',           x.sent_at,
           'rejected_reason',   x.rejected_reason)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select s.id, s.status, s.error_code, s.created_at, s.table_number_read, t.table_number,
                 (select count(*) from order_slip_lines l where l.slip_id = s.id) as line_count,
                 s.sent_at, s.rejected_reason
            from order_slips s
            left join cafe_tables t on t.id = s.table_id
           where s.venue_id = v_venue
             and s.uploaded_by = auth.uid()
             and s.created_at > now() - interval '24 hours'
           order by s.created_at desc, s.id
           limit 30) x;

  return jsonb_build_object('slips', v_items);
end $my_order_slips_0239$;

comment on function app.my_order_slips(uuid) is
  'order_slip_rpcs (0239). Any active staff member at the branch: {slips: [{id, status, error_code, created_at, table_number_read, table_number, line_count, sent_at, rejected_reason}]}, the caller''s own slips of the last 24 hours, newest first, at most 30. FORBIDDEN for anyone else.';

revoke all on function app.my_order_slips(uuid) from public, anon;
grant execute on function app.my_order_slips(uuid) to authenticated;

create or replace function app.my_receipts(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_receipts_0239$
declare
  v_venue uuid;
  v_items jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                 x.id,
           'status',             x.status,
           'error_code',         x.error_code,
           'created_at',         x.created_at,
           'supplier_name_read', x.supplier_name_read,
           'total_iqd_read',     x.total_iqd_read,
           'confirmed_at',       x.confirmed_at,
           'rejected_reason',    x.rejected_reason)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select r.id, r.status, r.error_code, r.created_at, r.supplier_name_read, r.total_iqd_read,
                 r.confirmed_at, r.rejected_reason
            from supplier_receipts r
           where r.venue_id = v_venue
             and r.uploaded_by = auth.uid()
             and r.created_at > now() - interval '30 days'
           order by r.created_at desc, r.id
           limit 30) x;

  return jsonb_build_object('receipts', v_items);
end $my_receipts_0239$;

comment on function app.my_receipts(uuid) is
  'order_slip_rpcs (0239). Any active staff member at the branch: {receipts: [{id, status, error_code, created_at, supplier_name_read, total_iqd_read, confirmed_at, rejected_reason}]}, the caller''s own supplier receipts (0236) of the last 30 days, newest first, at most 30. FORBIDDEN for anyone else.';

revoke all on function app.my_receipts(uuid) from public, anon;
grant execute on function app.my_receipts(uuid) to authenticated;
