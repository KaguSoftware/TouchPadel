-- 0237 receipt_scan_rpcs — AI receipt scanning into Goods in (Phase 2,
-- Milestone 4b), the functions. Tables and the flow: 0236.
--
--   create_receipt          driver / MGMT   file a photographed receipt
--   receipt_begin_reading   service_role    take a receipt for a reading
--   receipt_store_reading   service_role    store the lines the model read, match them
--   receipt_fail_reading    service_role    a reading that produced no lines
--   match_receipt_lines     internal        alias -> trigram -> none
--   receipts_to_review      MGMT            Goods in's "Scanned receipts"
--   receipt_detail          MGMT / uploader one receipt with its lines
--   confirm_receipt         MGMT            book ONE delivery, learn the aliases
--   reject_receipt          MGMT            set a receipt aside
--
-- The model never writes stock: a reading only fills supplier_receipt_lines,
-- and only a manager's confirm books a delivery, with the quantities and
-- costs the manager saw and accepted.
--
-- covered by packages/db/tests/receipts.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.create_receipt — the driver and MGMT at the branch. The photo is a
--    staff-media slot in the receipts folder the caller uploaded and nobody
--    has claimed yet.
-- ---------------------------------------------------------------------------
create or replace function app.create_receipt(
  p_venue_id        uuid,
  p_storage_path    text,
  p_source          text default 'phone',
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_receipt_0237$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_source text := lower(btrim(coalesce(p_source, 'phone')));
  v_path   text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_id     uuid := gen_random_uuid();
  v_result jsonb;
begin
  if not app.is_staff('driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'create_receipt');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_source not in ('phone','operator') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'source';
  end if;
  if v_path is null then
    raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
  end if;
  -- The caller's own unclaimed upload in this branch's receipts folder
  -- (PHOTO_PATH_INVALID otherwise).
  perform app.claim_staff_media(array[v_path], v_venue, array['receipts'], 'receipt:' || v_id::text);

  insert into supplier_receipts (id, venue_id, storage_path, source, uploaded_by)
  values (v_id, v_venue, v_path, v_source, auth.uid());

  perform app.write_audit('receipt.create', 'supplier_receipts', v_id::text, null,
                          jsonb_build_object('source', v_source));

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $create_receipt_0237$;

comment on function app.create_receipt(uuid, text, text, text) is
  'receipt_scan (0237). The driver and MGMT at the branch: files a photographed supplier receipt (the caller''s own unclaimed staff-media upload in the receipts folder, claimed as receipt:<id>); source phone or operator. Returns {id}; status uploaded until receipt-scan reads it. Idempotent by key. PHOTO_PATH_INVALID, INVALID_ARGUMENT (hint source); FORBIDDEN for anyone else. Audit receipt.create.';

revoke all on function app.create_receipt(uuid, text, text, text) from public, anon;
grant execute on function app.create_receipt(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.receipt_begin_reading — service_role (receipt-scan). Takes the
--    receipt for one reading; a reading older than three minutes is treated
--    as abandoned and may be taken over.
-- ---------------------------------------------------------------------------
create or replace function app.receipt_begin_reading(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $receipt_begin_reading_0237$
declare
  v_r     supplier_receipts%rowtype;
  v_names jsonb;
begin
  select * into v_r from supplier_receipts where id = p_id for update;
  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status in ('confirmed','rejected') then
    raise exception 'RECEIPT_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_r.status = 'reading' and v_r.reading_started_at > now() - interval '3 minutes' then
    raise exception 'RECEIPT_BUSY' using errcode = 'P0001';
  end if;

  update supplier_receipts
     set status = 'reading', reading_started_at = now(), error_code = null
   where id = p_id;

  -- The branch's supplier names help the model spell the header; at most 100.
  select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) into v_names
    from (select name from suppliers
           where venue_id = v_r.venue_id and is_active
           order by name limit 100) s;

  return jsonb_build_object('id', v_r.id, 'venue_id', v_r.venue_id,
                            'storage_path', v_r.storage_path, 'supplier_names', v_names);
end $receipt_begin_reading_0237$;

comment on function app.receipt_begin_reading(uuid) is
  'receipt_scan (0237). Service role (receipt-scan): takes a receipt for a reading (status reading) and returns {id, venue_id, storage_path, supplier_names}. RECEIPT_NOT_FOUND, RECEIPT_ALREADY_DONE (confirmed or rejected), RECEIPT_BUSY (another reading started less than three minutes ago).';

revoke all on function app.receipt_begin_reading(uuid) from public, anon, authenticated;
grant execute on function app.receipt_begin_reading(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.match_receipt_lines — internal. For every line of a receipt that a
--    manager has not matched by hand: a confirmed alias (this supplier's
--    first, then any supplier's), else the active purchased or retail
--    ingredient of the branch whose normalised name is most similar
--    (trigram, at least 0.45), else none.
-- ---------------------------------------------------------------------------
create or replace function app.match_receipt_lines(p_id uuid)
returns int
language plpgsql security definer set search_path = public, extensions as $match_receipt_lines_0237$
declare
  v_r       supplier_receipts%rowtype;
  v_matched int;
begin
  select * into v_r from supplier_receipts where id = p_id;
  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;

  update supplier_receipt_lines l
     set ingredient_id = m.ingredient_id,
         match_source  = coalesce(m.src, 'none'),
         confidence    = m.conf
    from (select l2.id, best.ingredient_id, best.src, best.conf
            from supplier_receipt_lines l2
            left join lateral (
              select x.ingredient_id, x.src, x.conf
                from (select a.ingredient_id, 'alias'::text as src, 1.000::numeric as conf,
                             case when a.supplier_id is not null then 0 else 1 end as pri
                        from ingredient_aliases a
                        join ingredients i on i.id = a.ingredient_id and i.is_active
                       where a.venue_id = v_r.venue_id
                         and a.alias_norm = app.search_norm(l2.text_read)
                         and (a.supplier_id is null or a.supplier_id = v_r.supplier_id)
                      union all
                      select i.id, 'trigram'::text,
                             round(greatest(similarity(app.search_norm(l2.text_read), app.search_norm(i.name_en)),
                                            similarity(app.search_norm(l2.text_read), app.search_norm(i.name_ar)))::numeric, 3),
                             2
                        from ingredients i
                       where i.venue_id = v_r.venue_id
                         and i.is_active
                         and i.kind in ('purchased','retail')
                         and greatest(similarity(app.search_norm(l2.text_read), app.search_norm(i.name_en)),
                                      similarity(app.search_norm(l2.text_read), app.search_norm(i.name_ar))) >= 0.45) x
               order by x.pri, x.conf desc, x.ingredient_id
               limit 1) best on true
           where l2.receipt_id = p_id
             and l2.match_source <> 'manual') m
   where l.id = m.id;

  select count(*) into v_matched
    from supplier_receipt_lines
   where receipt_id = p_id and ingredient_id is not null;
  return v_matched;
end $match_receipt_lines_0237$;

comment on function app.match_receipt_lines(uuid) is
  'receipt_scan (0237). Internal: matches every line of a receipt that was not matched by hand to a stock ingredient of its branch: a confirmed alias (the receipt''s supplier first, then any supplier; confidence 1), else the active purchased or retail ingredient whose normalised name is most similar (pg_trgm, at least 0.45), else none. Returns how many lines are matched.';

revoke all on function app.match_receipt_lines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.receipt_store_reading — service_role (receipt-scan). The reading was
--    validated by the edge function (_shared/receipts/validate.ts); this
--    stores it, guesses the supplier and matches the lines.
-- ---------------------------------------------------------------------------
create or replace function app.receipt_store_reading(
  p_id      uuid,
  p_reading jsonb,
  p_model   text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $receipt_store_reading_0237$
declare
  v_r        supplier_receipts%rowtype;
  v_line     jsonb;
  v_no       int := 0;
  v_text     text;
  v_sname    text := left(nullif(btrim(coalesce(p_reading->>'supplier_name', '')), ''), 120);
  v_supplier uuid;
  v_matched  int;
begin
  select * into v_r from supplier_receipts where id = p_id for update;
  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status <> 'reading' then
    raise exception 'RECEIPT_NOT_READING' using errcode = 'P0001';
  end if;
  if p_reading is null or jsonb_typeof(p_reading) <> 'object'
     or jsonb_typeof(p_reading->'lines') is distinct from 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'reading';
  end if;

  delete from supplier_receipt_lines where receipt_id = p_id;

  for v_line in select e from jsonb_array_elements(p_reading->'lines') e limit 200 loop
    v_text := left(nullif(btrim(coalesce(v_line->>'text', '')), ''), 200);
    continue when v_text is null;
    v_no := v_no + 1;
    insert into supplier_receipt_lines (receipt_id, line_no, text_read, qty_read, unit_read,
                                        unit_price_iqd_read, line_total_iqd_read, expiry_read, flags)
    values (p_id, v_no, v_text,
            case when (v_line->>'qty')::numeric > 0 and (v_line->>'qty')::numeric < 1000000000
                 then round((v_line->>'qty')::numeric, 3) end,
            left(nullif(btrim(coalesce(v_line->>'unit', '')), ''), 20),
            case when (v_line->>'unit_price_iqd')::numeric >= 0 then round((v_line->>'unit_price_iqd')::numeric)::bigint end,
            case when (v_line->>'line_total_iqd')::numeric >= 0 then round((v_line->>'line_total_iqd')::numeric)::bigint end,
            (v_line->>'expiry_date')::date,
            coalesce((select array_agg(f) from jsonb_array_elements_text(
                        case when jsonb_typeof(v_line->'flags') = 'array' then v_line->'flags' else '[]'::jsonb end) f),
                     '{}'));
  end loop;

  -- The supplier, when the name read is close to one of the branch's.
  if v_sname is not null then
    select s.id into v_supplier
      from suppliers s
     where s.venue_id = v_r.venue_id and s.is_active
       and similarity(app.search_norm(s.name), app.search_norm(v_sname)) >= 0.5
     order by similarity(app.search_norm(s.name), app.search_norm(v_sname)) desc, s.id
     limit 1;
  end if;

  update supplier_receipts
     set status             = 'read',
         read_at            = now(),
         error_code         = null,
         model              = left(nullif(btrim(coalesce(p_model, '')), ''), 100),
         supplier_name_read = v_sname,
         supplier_id        = coalesce(v_supplier, supplier_id),
         receipt_date       = (p_reading->>'receipt_date')::date,
         total_iqd_read     = case when (p_reading->>'total_iqd')::numeric >= 0
                                   then round((p_reading->>'total_iqd')::numeric)::bigint end
   where id = p_id;

  v_matched := app.match_receipt_lines(p_id);

  -- Logged at the receipt's branch (the service role has no station).
  perform set_config('app.venue_id', v_r.venue_id::text, true);
  perform app.write_audit('receipt.read', 'supplier_receipts', p_id::text, null,
                          jsonb_build_object('lines', v_no, 'matched', v_matched,
                                             'model', left(nullif(btrim(coalesce(p_model, '')), ''), 100)));
  return jsonb_build_object('id', p_id, 'lines', v_no, 'matched', v_matched);
end $receipt_store_reading_0237$;

comment on function app.receipt_store_reading(uuid, jsonb, text) is
  'receipt_scan (0237). Service role (receipt-scan): replaces a reading receipt''s lines with {supplier_name?, receipt_date?, total_iqd?, lines: [{text, qty?, unit?, unit_price_iqd?, line_total_iqd?, expiry_date?, flags?}]} (at most 200 lines; empty text skipped), guesses the supplier from the name (similarity at least 0.5), matches the lines and sets status read. Returns {id, lines, matched}. RECEIPT_NOT_FOUND, RECEIPT_NOT_READING, INVALID_ARGUMENT (hint reading).';

revoke all on function app.receipt_store_reading(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.receipt_store_reading(uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.receipt_fail_reading — service_role (receipt-scan). A reading that
--    produced no lines: back to uploaded (no model connected, the budget is
--    spent: nothing was tried) or failed (the model was asked and could not).
-- ---------------------------------------------------------------------------
create or replace function app.receipt_fail_reading(
  p_id     uuid,
  p_code   text,
  p_status text default 'failed'
) returns void
language plpgsql security definer set search_path = public as $receipt_fail_reading_0237$
declare
  v_venue uuid;
  v_code  text := left(coalesce(nullif(btrim(p_code), ''), 'UPSTREAM'), 60);
begin
  if p_status not in ('uploaded','failed') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;
  update supplier_receipts
     set status = p_status,
         error_code = v_code
   where id = p_id and status = 'reading'
  returning venue_id into v_venue;
  if v_venue is not null then
    perform set_config('app.venue_id', v_venue::text, true);
    perform app.write_audit('receipt.read_failed', 'supplier_receipts', p_id::text, null,
                            jsonb_build_object('code', v_code, 'status', p_status));
  end if;
end $receipt_fail_reading_0237$;

comment on function app.receipt_fail_reading(uuid, text, text) is
  'receipt_scan (0237). Service role (receipt-scan): ends a reading that stored no lines, with a code (see supplier_receipts.error_code): status uploaded when nothing was tried (no model, budget spent), failed when the model could not read it. A receipt that is no longer reading is left alone. INVALID_ARGUMENT (hint status).';

revoke all on function app.receipt_fail_reading(uuid, text, text) from public, anon, authenticated;
grant execute on function app.receipt_fail_reading(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. app.receipts_to_review — MGMT at the branch: every receipt not yet
--    confirmed or rejected, newest first (at most 100).
-- ---------------------------------------------------------------------------
create or replace function app.receipts_to_review(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $receipts_to_review_0237$
declare
  v_venue uuid;
  v_items jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                 x.id,
           'status',             x.status,
           'error_code',         x.error_code,
           'source',             x.source,
           'storage_path',       x.storage_path,
           'uploaded_by_name',   x.uploaded_by_name,
           'created_at',         x.created_at,
           'supplier_name_read', x.supplier_name_read,
           'total_iqd_read',     x.total_iqd_read,
           'line_count',         x.line_count,
           'matched_count',      x.matched_count)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select r.id, r.status, r.error_code, r.source, r.storage_path, s.display_name as uploaded_by_name,
                 r.created_at, r.supplier_name_read, r.total_iqd_read,
                 (select count(*) from supplier_receipt_lines l where l.receipt_id = r.id) as line_count,
                 (select count(*) from supplier_receipt_lines l
                   where l.receipt_id = r.id and l.ingredient_id is not null) as matched_count
            from supplier_receipts r
            left join staff s on s.id = r.uploaded_by
           where r.venue_id = v_venue
             and r.status in ('uploaded','reading','read','failed')
           order by r.created_at desc, r.id
           limit 100) x;

  return jsonb_build_object('receipts', v_items);
end $receipts_to_review_0237$;

comment on function app.receipts_to_review(uuid) is
  'receipt_scan (0237). MGMT at the branch: {receipts: [{id, status, error_code, source, storage_path, uploaded_by_name, created_at, supplier_name_read, total_iqd_read, line_count, matched_count}]}, every receipt not yet confirmed or rejected, newest first, at most 100. FORBIDDEN for anyone else.';

revoke all on function app.receipts_to_review(uuid) from public, anon;
grant execute on function app.receipts_to_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.receipt_detail — MGMT at the receipt's branch, or its uploader: the
--    receipt and its lines, each with the matched ingredient.
-- ---------------------------------------------------------------------------
create or replace function app.receipt_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $receipt_detail_0237$
declare
  v_r     supplier_receipts%rowtype;
  v_lines jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_r from supplier_receipts where id = p_id;
  if not found
     or not (v_r.uploaded_by = auth.uid() or app.is_staff_at(v_r.venue_id, 'manager','owner')) then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  l.id,
           'line_no',             l.line_no,
           'text_read',           l.text_read,
           'qty_read',            l.qty_read,
           'unit_read',           l.unit_read,
           'unit_price_iqd_read', l.unit_price_iqd_read,
           'line_total_iqd_read', l.line_total_iqd_read,
           'expiry_read',         l.expiry_read,
           'flags',               to_jsonb(l.flags),
           'ingredient_id',       l.ingredient_id,
           'match_source',        l.match_source,
           'confidence',          l.confidence,
           'name_en',             i.name_en,
           'name_ar',             i.name_ar,
           'unit',                i.unit,
           'pack_size',           i.pack_size,
           'kind',                i.kind)
         order by l.line_no), '[]'::jsonb)
    into v_lines
    from supplier_receipt_lines l
    left join ingredients i on i.id = l.ingredient_id
   where l.receipt_id = p_id;

  return jsonb_build_object(
    'id',                 v_r.id,
    'venue_id',           v_r.venue_id,
    'status',             v_r.status,
    'error_code',         v_r.error_code,
    'source',             v_r.source,
    'storage_path',       v_r.storage_path,
    'created_at',         v_r.created_at,
    'read_at',            v_r.read_at,
    'model',              v_r.model,
    'supplier_name_read', v_r.supplier_name_read,
    'supplier_id',        v_r.supplier_id,
    'receipt_date',       v_r.receipt_date,
    'total_iqd_read',     v_r.total_iqd_read,
    'delivery_id',        v_r.delivery_id,
    'lines',              v_lines);
end $receipt_detail_0237$;

comment on function app.receipt_detail(uuid) is
  'receipt_scan (0237). MGMT at the receipt''s branch, or the staff member who filed it: {id, venue_id, status, error_code, source, storage_path, created_at, read_at, model, supplier_name_read, supplier_id, receipt_date, total_iqd_read, delivery_id, lines: [{id, line_no, text_read, qty_read, unit_read, unit_price_iqd_read, line_total_iqd_read, expiry_read, flags, ingredient_id, match_source, confidence, name_en, name_ar, unit, pack_size, kind}]}. RECEIPT_NOT_FOUND for anyone else (and for an unknown id); FORBIDDEN for a caller who is not staff.';

revoke all on function app.receipt_detail(uuid) from public, anon;
grant execute on function app.receipt_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.confirm_receipt — MGMT at the receipt's branch. The manager's lines
--    (read, corrected or added) become ONE delivery through
--    receive_delivery_internal (source receipt); each confirmed line that came
--    from the receipt teaches its wording as an alias.
--    p_lines: [{line_id?, ingredient_id, qty_received, unit_cost_iqd,
--               expiry_date?}] — quantity in the ingredient's base unit and
--    cost per base unit, as receive_delivery.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_receipt(
  p_id              uuid,
  p_lines           jsonb,
  p_supplier_id     uuid default null,
  p_supplier_name   text default null,
  p_location        text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_receipt_0237$
declare
  c_uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_replay   jsonb;
  v_r        supplier_receipts%rowtype;
  v_loc      stock_location;
  v_sname    text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_el       jsonb;
  v_lid      uuid;
  v_ing      uuid;
  v_line     supplier_receipt_lines%rowtype;
  v_seen     uuid[] := '{}';
  v_payload  jsonb := '[]'::jsonb;
  v_learn    jsonb := '[]'::jsonb;
  v_delivery jsonb;
  v_result   jsonb;
  v_alias    text;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_loc := app.parse_stock_location(p_location, 'cafe');

  -- Claimed before the receipt's state is read (receive_purchase, 0200): a
  -- retry under the same key returns the first delivery; a new key finds the
  -- receipt confirmed.
  v_replay := app.claim_replay(p_idempotency_key, 'confirm_receipt');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_r from supplier_receipts where id = p_id for update;
  if not found or not (v_r.venue_id = any(app.staff_venue_ids())) then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_r.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- receive_delivery_internal's inserts and the branch guard read it.
  perform set_config('app.venue_id', v_r.venue_id::text, true);

  if v_r.status in ('confirmed','rejected') then
    raise exception 'RECEIPT_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_r.status = 'reading' and v_r.reading_started_at > now() - interval '3 minutes' then
    raise exception 'RECEIPT_BUSY' using errcode = 'P0001';
  end if;
  if length(v_sname) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'supplier_name';
  end if;
  if p_supplier_id is not null then
    select coalesce(v_sname, s.name) into v_sname
      from suppliers s where s.id = p_supplier_id and s.venue_id = v_r.venue_id;
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    v_ing := (v_el->>'ingredient_id')::uuid;
    if v_el ? 'line_id' and v_el->>'line_id' is not null then
      if v_el->>'line_id' !~ c_uuid then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
      end if;
      v_lid := (v_el->>'line_id')::uuid;
      select * into v_line from supplier_receipt_lines where id = v_lid and receipt_id = v_r.id;
      if not found or v_lid = any(v_seen) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
      end if;
      v_seen := v_seen || v_lid;
      v_learn := v_learn || jsonb_build_array(jsonb_build_object(
                   'line_id', v_lid, 'ingredient_id', v_ing,
                   'manual', v_line.ingredient_id is distinct from v_ing));
    end if;
    v_payload := v_payload || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                   'ingredient_id', v_ing,
                   'qty_received',  v_el->'qty_received',
                   'unit_cost_iqd', v_el->'unit_cost_iqd',
                   'expiry_date',   v_el->'expiry_date',
                   'cost_source',   'entered')));
  end loop;

  v_delivery := app.receive_delivery_internal(v_r.venue_id, v_loc, v_payload, v_sname,
                                              'receipt ' || v_r.id::text, null, p_supplier_id, 'receipt');

  -- What the manager accepted becomes the line's match, and its wording an
  -- alias of that ingredient (this supplier's when one was chosen).
  for v_el in select e from jsonb_array_elements(v_learn) e loop
    v_lid := (v_el->>'line_id')::uuid;
    v_ing := (v_el->>'ingredient_id')::uuid;
    update supplier_receipt_lines
       set ingredient_id = v_ing,
           match_source  = case when (v_el->>'manual')::boolean then 'manual' else match_source end,
           confidence    = case when (v_el->>'manual')::boolean then null else confidence end
     where id = v_lid;
    select left(app.search_norm(text_read), 200) into v_alias
      from supplier_receipt_lines where id = v_lid;
    continue when coalesce(v_alias, '') = '';
    insert into ingredient_aliases (venue_id, supplier_id, alias_norm, ingredient_id, created_by)
    values (v_r.venue_id, p_supplier_id, v_alias, v_ing, auth.uid())
    on conflict (venue_id, (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)), alias_norm)
    do update set ingredient_id = excluded.ingredient_id,
                  uses          = ingredient_aliases.uses + 1,
                  last_used_at  = now();
  end loop;

  update supplier_receipts
     set status       = 'confirmed',
         delivery_id  = (v_delivery->>'delivery_id')::uuid,
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         supplier_id  = coalesce(p_supplier_id, supplier_id)
   where id = v_r.id;

  perform app.write_audit('receipt.confirm', 'supplier_receipts', v_r.id::text,
                          jsonb_build_object('status', v_r.status),
                          jsonb_build_object('status', 'confirmed',
                                             'delivery_id', v_delivery->>'delivery_id',
                                             'lines', jsonb_array_length(v_payload),
                                             'supplier_id', p_supplier_id,
                                             'location', v_loc));

  v_result := jsonb_build_object('receipt_id', v_r.id,
                                 'delivery_id', v_delivery->'delivery_id',
                                 'batch_ids', v_delivery->'batch_ids');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $confirm_receipt_0237$;

comment on function app.confirm_receipt(uuid, jsonb, uuid, text, text, text) is
  'receipt_scan (0237). MGMT at the receipt''s branch: books the manager''s lines [{line_id?, ingredient_id, qty_received (base unit), unit_cost_iqd (per base unit), expiry_date?}] as ONE delivery (source receipt, into p_location, default cafe) through receive_delivery_internal, records each receipt line''s accepted ingredient (manual when the manager changed it) and learns its normalised wording as an alias (per supplier when one is given). Returns {receipt_id, delivery_id, batch_ids}. Idempotent by key. RECEIPT_NOT_FOUND, RECEIPT_ALREADY_DONE, RECEIPT_BUSY, SUPPLIER_NOT_FOUND, TEXT_TOO_LONG (hint supplier_name), EMPTY_DELIVERY, INVALID_ARGUMENT (hint lines), and receive_delivery_internal''s STORE_BEING_COUNTED, INGREDIENT_NOT_FOUND, INVALID_LINE. Audit receipt.confirm.';

revoke all on function app.confirm_receipt(uuid, jsonb, uuid, text, text, text) from public, anon;
grant execute on function app.confirm_receipt(uuid, jsonb, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.reject_receipt — MGMT at the receipt's branch: sets a receipt aside
--    (not a supplier receipt, a duplicate, unreadable). No stock moves.
-- ---------------------------------------------------------------------------
create or replace function app.reject_receipt(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $reject_receipt_0237$
declare
  v_r      supplier_receipts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_r from supplier_receipts where id = p_id for update;
  if not found or not (v_r.venue_id = any(app.staff_venue_ids())) then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_r.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_r.venue_id::text, true);
  if v_r.status in ('confirmed','rejected') then
    raise exception 'RECEIPT_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if length(v_reason) > 200 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;

  update supplier_receipts
     set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), rejected_reason = v_reason
   where id = p_id;

  perform app.write_audit('receipt.reject', 'supplier_receipts', p_id::text,
                          jsonb_build_object('status', v_r.status),
                          jsonb_build_object('status', 'rejected', 'reason', v_reason));
end $reject_receipt_0237$;

comment on function app.reject_receipt(uuid, text) is
  'receipt_scan (0237). MGMT at the receipt''s branch: sets a receipt aside with an optional reason (at most 200). No stock moves. RECEIPT_NOT_FOUND, RECEIPT_ALREADY_DONE, TEXT_TOO_LONG (hint reason); FORBIDDEN for anyone else. Audit receipt.reject.';

revoke all on function app.reject_receipt(uuid, text) from public, anon;
grant execute on function app.reject_receipt(uuid, text) to authenticated;
