-- 0322_shop_price_watch — owner call 2026-10-08: the shop desk PC watches each
-- shop product's supplier page every hour, and a supplier price change reaches
-- the owner and the shop assistants on the phone
-- (docs/design/shop/supplier-price-watch-2026-10-08.md).
--
-- The reading itself is not here: the Electron shell on a station in mode
-- shop fetches the page (touch:fetch-supplier-page) and the operator reads the
-- page's structured price data, then reports what it read through
-- app.record_shop_supplier_price. The server keeps the link, the last price
-- read and the last error, decides whether the price changed, and pushes.
--
-- WHAT CHANGES.
--   * public.shop_price_watches: one row per shop size that has a supplier
--     link (variant_id is the key). The last price read, the one before the
--     latest change, when it changed, the last attempt, the last good read and
--     the last read error (a closed list, shared with the shell and the
--     operator). Read by managers, the owner and the shop assistants of the
--     branch; written only through the two RPCs below. zz_branch_guard with
--     the size as its link (menu_item_variants takes its menu item's branch).
--   * app.set_shop_price_watch(p_variant_id, p_url): manager, owner or shop
--     assistant. Sets the size's supplier link (https only, a public host
--     name: SUPPLIER_URL_INVALID otherwise), or removes it on an empty link.
--     A new link forgets everything read from the old one.
--   * app.record_shop_supplier_price(p_variant_id, p_url, p_price_iqd,
--     p_error): the shop desk's report of one read. stale when the link
--     changed since the page was fetched; otherwise the error, or first, same
--     or changed. A change is audited (shop.price_watch.changed, old and new)
--     and, when the new price is not already the shop's price, queues a
--     shop_price_changed staff push to the owners and the branch's shop
--     assistants, the reporting caller included (notify_staff skips its
--     caller, who here is the person signed in at the shop PC): the
--     product's name only, never a price (the lock-screen rule of
--     notify_staff).
--   * app.notify_staff re-issued from 20261007000313 verbatim, plus
--     shop_price_changed last in c_title_keys (_shared/staff-push.json and
--     send-push/staffStrings.ts carry the key and its copy).
-- Applying the new price is the existing app.upsert_retail_variant from the
-- operator's size form: no new write path to menu_item_variants.price_iqd.
set lock_timeout = '3s'; set statement_timeout = '60s';

-- ===========================================================================
-- 1. The table
-- ===========================================================================

create table if not exists shop_price_watches (
  variant_id         uuid primary key references menu_item_variants(id) on delete cascade,
  venue_id           uuid not null default app.current_venue() references venues(id),
  url                text not null,
  supplier_price_iqd iqd,
  previous_price_iqd iqd,
  price_changed_at   timestamptz,
  checked_at         timestamptz,
  read_ok_at         timestamptz,
  last_error         text,
  created_by         uuid references staff(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint shop_price_watches_url_chk
    check (url ~* '^https://' and length(url) between 12 and 2000),
  constraint shop_price_watches_error_chk
    check (last_error is null
           or last_error in ('no_price', 'ambiguous', 'not_iqd', 'blocked_url', 'http_error',
                             'timeout', 'too_large', 'not_html', 'fetch_failed'))
);

comment on table shop_price_watches is
  'shop_price_watches (0322): a shop size''s supplier product page, read every hour by the shop desk PC (the operator shell on a station in mode shop), and what was read from it. One row per size with a link. Read by managers, the owner and the shop assistants of the branch; written only through app.set_shop_price_watch and app.record_shop_supplier_price. The supplier price is shown beside the shop price; applying it is app.upsert_retail_variant (supplier price = shop price, no calculation).';
comment on column shop_price_watches.variant_id is 'The shop size (menu_item_variants) the link belongs to.';
comment on column shop_price_watches.venue_id is 'The branch: the size''s menu item''s.';
comment on column shop_price_watches.url is 'The supplier''s product page, https only, 12 to 2000 characters, a public host name (checked by app.set_shop_price_watch).';
comment on column shop_price_watches.supplier_price_iqd is 'The latest price read from the page, IQD; null until the first good read.';
comment on column shop_price_watches.previous_price_iqd is 'The supplier price before the latest change; null until it changes once.';
comment on column shop_price_watches.price_changed_at is 'When the supplier price last changed (not set by the first read).';
comment on column shop_price_watches.checked_at is 'The last read, good or not.';
comment on column shop_price_watches.read_ok_at is 'The last good read.';
comment on column shop_price_watches.last_error is 'Why the last read failed, or null: no_price, ambiguous, not_iqd, blocked_url, http_error, timeout, too_large, not_html, fetch_failed.';
comment on column shop_price_watches.created_by is 'The staff member who first set a link for the size.';
comment on column shop_price_watches.created_at is 'When the first link was set.';
comment on column shop_price_watches.updated_at is 'The last write: a link set or a read reported.';

alter table shop_price_watches enable row level security;
revoke all on shop_price_watches from anon, authenticated;

drop policy if exists shop_price_watches_shop_read on shop_price_watches;
create policy shop_price_watches_shop_read on shop_price_watches
  for select to authenticated
  using ((select app.is_staff('manager', 'owner', 'shop_staff'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on shop_price_watches to authenticated;
grant all on shop_price_watches to service_role;

drop trigger if exists zz_branch_guard on public.shop_price_watches;
create trigger zz_branch_guard before insert or update or delete on public.shop_price_watches
  for each row execute function app.trg_branch_guard('scoped', 'menu_item_variants', 'variant_id');

-- ===========================================================================
-- 2. notify_staff: re-issued from 20261007000313_staff_screenshot_report.sql:20
--    verbatim, plus shop_price_changed last in c_title_keys.
-- ===========================================================================
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0322$
declare
  c_kinds      constant text[] := array['staff_task', 'staff_decide', 'staff_decided', 'staff_info'];
  c_title_keys constant text[] := array[
    'step_open', 'step_submitted', 'step_approved', 'step_sent_back', 'step_stopped',
    'run_stopped', 'run_live', 'launch_not_ready', 'apply_not_ready', 'review_ready',
    'request_submitted', 'request_approved', 'request_rejected', 'shopping_new',
    'purchase_to_receive', 'idea_submitted', 'idea_started', 'idea_declined',
    'teaching_new', 'recipe_change_submitted', 'recipe_change_approved',
    'recipe_change_declined', 'shopping_to_approve', 'shopping_declined',
    'marketing_request_new', 'marketing_request_answered', 'deduction_proposed',
    'deduction_approved', 'deduction_declined', 'deduction_recorded',
    'incident_reported', 'incident_reviewed', 'content_submitted', 'content_approved',
    'content_changes', 'content_declined', 'waiter_call_new', 'match_report_new',
    'loyalty_gift', 'screenshot_taken', 'shop_price_changed'];
  c_routes     constant text[] := array[
    'staff', 'staff-step', 'staff-run', 'staff-request', 'staff-shopping',
    'staff-checklist', 'staff-notes'];
  v_payload jsonb;
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_count   int;
begin
  if p_kind is null or not (p_kind = any(c_kinds)) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if not coalesce(p_payload->>'title_key' = any(c_title_keys), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if not coalesce(p_payload->>'route' = any(c_routes), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'route';
  end if;
  -- The shape is closed, so no caller can put money, a phone number or a
  -- candidate name on a lock screen by adding a key.
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('route', 'id', 'title_key', 'params', 'dedupe')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if p_payload ? 'params' and p_payload->'params' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'params') <> 'object'
       or exists (select 1 from jsonb_object_keys(p_payload->'params') k
                   where k not in ('step', 'title', 'name')) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
    end if;
  end if;

  v_payload := (p_payload - 'dedupe')
            || case when v_dedupe is null then '{}'::jsonb
                    else jsonb_build_object('dedupe', v_dedupe) end;

  insert into notification_outbox (profile_id, kind, payload)
  select s.id, p_kind, v_payload
    from staff s
    join profiles p on p.id = s.id
   where s.id = any(coalesce(p_staff_ids, '{}'::uuid[]))
     and s.is_active
     and s.id is distinct from auth.uid()
     and (v_dedupe is null
          or not exists (select 1 from notification_outbox o
                          where o.profile_id = s.id
                            and o.payload->>'dedupe' = v_dedupe
                            and o.created_at > now() - interval '15 minutes'));
  get diagnostics v_count = row_count;

  perform app.push_nudge();
  return v_count;
end $notify_staff_0322$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1), staff_push_keys_wave5, match_guest_rpcs (0261, match_report_new), loyalty_earn_redeem (0308, loyalty_gift), staff_screenshot_report (0313, screenshot_taken) and shop_price_watch (0322, shop_price_changed). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- 3. app.set_shop_price_watch — a shop size's supplier link
-- ===========================================================================
create or replace function app.set_shop_price_watch(p_variant_id uuid, p_url text)
returns jsonb
language plpgsql security definer set search_path = public as $set_shop_price_watch_0322$
declare
  v_url   text := nullif(btrim(coalesce(p_url, '')), '');
  v_auth  text;
  v_host  text;
  v_venue uuid;
  v_kind  text;
  v_old   shop_price_watches%rowtype;
begin
  if not app.is_staff('manager', 'owner', 'shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The link: https, a host name the public internet answers for. The shell
  -- checks the same before every fetch (and again after a redirect); this is
  -- the copy that keeps a bad link out of the table.
  if v_url is not null then
    v_auth := (regexp_match(v_url, '^https://([^/?#]*)', 'i'))[1];
    v_host := lower(regexp_replace(coalesce(v_auth, ''), ':[0-9]*$', ''));
    v_host := rtrim(v_host, '.');
    if v_auth is null
       or length(v_url) < 12 or length(v_url) > 2000
       or v_url ~ '[[:space:][:cntrl:]]'
       or position('@' in v_auth) > 0
       -- A browser reads "\" as "/" and decodes "%xx" in a host, so either can
       -- hide an address behind a name that passes the checks below.
       or v_auth ~ '[\\%]'
       or v_host = '' or v_host ~ '[\[\]:]'
       or v_host ~ '^((0x[0-9a-f]*|[0-9]+)\.)*(0x[0-9a-f]*|[0-9]+)$'
       or v_host = 'localhost'
       or v_host ~ '\.(local|localhost|internal|lan|home\.arpa)$'
       or position('.' in v_host) = 0 then
      raise exception 'SUPPLIER_URL_INVALID' using errcode = 'P0001';
    end if;
  end if;

  select mi.venue_id, c.kind into v_venue, v_kind
    from menu_item_variants v
    join menu_items mi on mi.id = v.item_id
    left join menu_categories c on c.id = mi.category_id
   where v.id = p_variant_id;
  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_kind is distinct from 'shop' then
    raise exception 'NOT_SHOP_CATEGORY' using errcode = 'P0001',
      hint = 'only a shop size has a supplier page';
  end if;
  -- The 0217 pattern: the size's branch, or VENUE_MISMATCH; asserted, so the
  -- row and the audit line land there.
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'manager', 'owner', 'shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select * into v_old from shop_price_watches where variant_id = p_variant_id for update;

  if v_url is null then
    if found then
      delete from shop_price_watches where variant_id = p_variant_id;
      perform app.write_audit('shop.price_watch.set', 'shop_price_watches', p_variant_id::text,
                              jsonb_build_object('url', v_old.url), jsonb_build_object('url', null));
    end if;
    return jsonb_build_object('variant_id', p_variant_id, 'url', null);
  end if;

  if not found then
    insert into shop_price_watches (variant_id, venue_id, url, created_by)
    values (p_variant_id, coalesce(v_venue, app.current_venue()), v_url, auth.uid());
    perform app.write_audit('shop.price_watch.set', 'shop_price_watches', p_variant_id::text,
                            null, jsonb_build_object('url', v_url));
  elsif v_old.url is distinct from v_url then
    -- A new page: nothing read from the old one carries over.
    update shop_price_watches
       set url = v_url,
           supplier_price_iqd = null, previous_price_iqd = null, price_changed_at = null,
           checked_at = null, read_ok_at = null, last_error = null,
           updated_at = now()
     where variant_id = p_variant_id;
    perform app.write_audit('shop.price_watch.set', 'shop_price_watches', p_variant_id::text,
                            jsonb_build_object('url', v_old.url), jsonb_build_object('url', v_url));
  end if;

  return jsonb_build_object('variant_id', p_variant_id, 'url', v_url);
end $set_shop_price_watch_0322$;

comment on function app.set_shop_price_watch(uuid, text) is
  'Supplier price watch (0322). Manager, owner or shop assistant (FORBIDDEN otherwise): sets a shop size''s supplier product page, or removes it when p_url is empty. SUPPLIER_URL_INVALID unless the link is https, 12 to 2000 characters, without spaces or control characters, without a user name, without a backslash or percent sign before the path, and its host is a public name with a dot (not an IP address, localhost or a .local, .localhost, .internal, .lan or .home.arpa name). VARIANT_NOT_FOUND, NOT_SHOP_CATEGORY for a café size, VENUE_MISMATCH for another branch''s size. A changed link clears everything read from the old one. Audited as shop.price_watch.set (before and after url). Returns {variant_id, url}.';

revoke all on function app.set_shop_price_watch(uuid, text) from public, anon;
grant execute on function app.set_shop_price_watch(uuid, text) to authenticated;

-- ===========================================================================
-- 4. app.record_shop_supplier_price — the shop desk's report of one read
-- ===========================================================================
create or replace function app.record_shop_supplier_price(
  p_variant_id uuid,
  p_url        text,
  p_price_iqd  bigint default null,
  p_error      text default null
) returns jsonb
language plpgsql security definer set search_path = public as $record_shop_supplier_price_0322$
declare
  c_errors constant text[] := array['no_price', 'ambiguous', 'not_iqd', 'blocked_url', 'http_error',
                                    'timeout', 'too_large', 'not_html', 'fetch_failed'];
  v_w      shop_price_watches%rowtype;
  v_shop   bigint;
  v_size_en text;
  v_size_ar text;
  v_item_en text;
  v_item_ar text;
  v_sizes  int;
  v_status text;
  v_to     uuid[];
  v_push   jsonb;
  v_dedupe text;
begin
  if not app.is_staff('manager', 'owner', 'shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_error is not null then
    if not (p_error = any(c_errors)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_error';
    end if;
  elsif p_price_iqd is null or p_price_iqd <= 0 or p_price_iqd > 1000000000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_price_iqd';
  end if;

  select * into v_w from shop_price_watches where variant_id = p_variant_id for update;
  -- The link was removed or changed while the page was being read: the read
  -- belongs to no current link. Not an error; the next round reads the new one.
  if not found or v_w.url is distinct from p_url then
    return jsonb_build_object('status', 'stale');
  end if;
  if not app.is_staff_at(v_w.venue_id, 'manager', 'owner', 'shop_staff') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_w.venue_id::text, true);

  select v.price_iqd, v.name_en, v.name_ar, mi.name_en, mi.name_ar,
         (select count(*) from menu_item_variants x where x.item_id = v.item_id)
    into v_shop, v_size_en, v_size_ar, v_item_en, v_item_ar, v_sizes
    from menu_item_variants v
    join menu_items mi on mi.id = v.item_id
   where v.id = p_variant_id;

  if p_error is not null then
    update shop_price_watches
       set checked_at = now(), last_error = p_error, updated_at = now()
     where variant_id = p_variant_id;
    return jsonb_build_object('status', 'error',
                              'supplier_price_iqd', v_w.supplier_price_iqd,
                              'shop_price_iqd', v_shop);
  end if;

  if v_w.supplier_price_iqd is null then
    v_status := 'first';
    update shop_price_watches
       set supplier_price_iqd = p_price_iqd,
           checked_at = now(), read_ok_at = now(), last_error = null, updated_at = now()
     where variant_id = p_variant_id;
  elsif v_w.supplier_price_iqd = p_price_iqd then
    v_status := 'same';
    update shop_price_watches
       set checked_at = now(), read_ok_at = now(), last_error = null, updated_at = now()
     where variant_id = p_variant_id;
  else
    v_status := 'changed';
    update shop_price_watches
       set previous_price_iqd = v_w.supplier_price_iqd,
           supplier_price_iqd = p_price_iqd,
           price_changed_at = now(),
           checked_at = now(), read_ok_at = now(), last_error = null, updated_at = now()
     where variant_id = p_variant_id;
    perform app.write_audit('shop.price_watch.changed', 'shop_price_watches', p_variant_id::text,
                            jsonb_build_object('supplier_price_iqd', v_w.supplier_price_iqd),
                            jsonb_build_object('supplier_price_iqd', p_price_iqd));
    -- Nothing to do when the shop already sells at the new price. The push
    -- names the product (and the size, when it has more than one); the prices
    -- stay in the operator. Deduped per SIZE, not per price: a caller stepping
    -- the price on every call would otherwise push the owner without limit,
    -- and honest hourly reads are 60 minutes apart, past notify_staff's 15.
    if p_price_iqd is distinct from v_shop then
      v_to := app.staff_ids_with_roles(v_w.venue_id, array['owner', 'shop_staff']::staff_role[]);
      v_dedupe := 'shop-price:' || p_variant_id::text;
      v_push := jsonb_build_object(
        'route', 'staff',
        'id', null,
        'title_key', 'shop_price_changed',
        'params', jsonb_build_object('step', jsonb_build_object(
          'en', v_item_en || case when v_sizes > 1 then ' (' || v_size_en || ')' else '' end,
          'ar', v_item_ar || case when v_sizes > 1 then ' (' || v_size_ar || ')' else '' end)));
      perform app.notify_staff(v_to, 'staff_info', v_push, v_dedupe);
      -- notify_staff skips the caller, and here the caller is the person
      -- signed in at the shop desk PC: usually the shop assistant on shift,
      -- whom the owner asked to be told. Queue theirs too, in the shape and
      -- under the dedupe notify_staff just used (it validated the payload).
      insert into notification_outbox (profile_id, kind, payload)
      select s.id, 'staff_info', v_push || jsonb_build_object('dedupe', v_dedupe)
        from staff s
        join profiles p on p.id = s.id
       where s.id = auth.uid()
         and s.id = any(coalesce(v_to, '{}'::uuid[]))
         and s.is_active
         and not exists (select 1 from notification_outbox o
                          where o.profile_id = s.id
                            and o.payload->>'dedupe' = v_dedupe
                            and o.created_at > now() - interval '15 minutes');
      if found then
        perform app.push_nudge();
      end if;
    end if;
  end if;

  return jsonb_build_object('status', v_status,
                            'supplier_price_iqd', p_price_iqd,
                            'shop_price_iqd', v_shop);
end $record_shop_supplier_price_0322$;

comment on function app.record_shop_supplier_price(uuid, text, bigint, text) is
  'Supplier price watch (0322): the shop desk PC''s report of one read of a size''s supplier page. Manager, owner or shop assistant (FORBIDDEN otherwise). INVALID_ARGUMENT for p_error outside {no_price, ambiguous, not_iqd, blocked_url, http_error, timeout, too_large, not_html, fetch_failed}, or, with no error, a price that is not 1 to 1,000,000,000,000 IQD. {status: stale} when the size has no link or a different one than p_url (the link changed while the page was read). VENUE_MISMATCH for another branch''s link. An error stamps checked_at and last_error (status error); a price stamps checked_at and read_ok_at and clears last_error: status first (stored, no push), same, or changed (previous price kept, price_changed_at stamped, audited as shop.price_watch.changed with the old and new price, and, when the new price differs from the size''s shop price, a shop_price_changed staff push to the owners and the branch''s shop assistants, the caller included when they are one, naming the product only, one per size per 15 minutes whatever the price). Returns {status, supplier_price_iqd, shop_price_iqd}.';

revoke all on function app.record_shop_supplier_price(uuid, text, bigint, text) from public, anon;
grant execute on function app.record_shop_supplier_price(uuid, text, bigint, text) to authenticated;
