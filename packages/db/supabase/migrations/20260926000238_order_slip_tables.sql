-- 0238 order_slip_tables — scanned ORDER SLIPS (Phase 2, Milestone 4b, the
-- second kind of scanned paper; the first is 0236's supplier receipts).
--
-- THE FLOW. A waiter (or the cashier, a manager or the owner) photographs a
-- handwritten order slip on the staff phone into the new staff-media folder
-- `slips` and files it with app.create_order_slip (0239). The receipt-scan
-- edge function reads it with the one connected model (the order-slip prompt,
-- _shared/receipts/prompt.ts) and app.match_slip_lines matches each line to a
-- MENU variant of the branch (a learned alias first, then trigram similarity on
-- the normalised item and variant names). The slip appears live on the till
-- (rt_order_slip, below, on the floor topics the till already listens to); the
-- cashier checks it beside the photo, picks the table or tab and sends it:
-- app.send_order_slip calls app.till_add_items, so the order, its prices, its
-- modifiers' rules and its kitchen ticket are exactly the till's. Nothing
-- reaches the kitchen without a cashier's send; with no model connected the
-- cashier types the lines from the photo.
--
-- WHO READS. order_slips and their lines: the cashier, managers and the owner
-- at the branch in scope, and the staff member who took the photo (their own).
-- menu_aliases: MGMT. No client holds a write grant: every write is a definer
-- RPC or receipt-scan's service role.
--
-- PHOTOS. staff_media_uploads' two CHECKs, app.is_staff_media_path,
-- app.staff_media_slot and app.staff_media_visible are re-issued from 0196
-- verbatim, with the eleventh folder `slips` and one rule: a photo claimed by
-- an order slip is readable by the cashier at its branch (the till shows it).
-- The client twins (@touch/core PHOTO_FOLDERS, the phone's PhotoFolder,
-- protocol-action's STAFF_MEDIA_PATH_RE) name the same eleven folders.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables; the two
-- staff_media_uploads CHECKs are dropped and re-added NOT VALID, then validated.
--
-- covered by packages/db/tests/order-slips.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists order_slips (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references venues(id),
  storage_path       text not null unique check (length(storage_path) <= 200),
  uploaded_by        uuid not null references staff(id),
  status             text not null default 'uploaded'
                     check (status in ('uploaded','reading','read','failed','sent','rejected')),
  error_code         text check (error_code is null or length(error_code) <= 60),
  reading_started_at timestamptz,
  read_at            timestamptz,
  model              text check (model is null or length(model) <= 100),
  table_number_read  text check (table_number_read is null or length(table_number_read) <= 20),
  table_id           uuid references cafe_tables(id),
  tab_id             uuid references tabs(id),
  order_id           uuid references orders(id),
  sent_by            uuid references staff(id),
  sent_at            timestamptz,
  rejected_by        uuid references staff(id),
  rejected_at        timestamptz,
  rejected_reason    text check (rejected_reason is null or length(rejected_reason) <= 200),
  created_at         timestamptz not null default now(),
  constraint order_slips_sent_chk
    check ((status = 'sent') = (order_id is not null and sent_at is not null)),
  constraint order_slips_rejected_chk
    check ((status = 'rejected') = (rejected_at is not null))
);

create table if not exists order_slip_lines (
  id           uuid primary key default gen_random_uuid(),
  slip_id      uuid not null references order_slips(id) on delete cascade,
  line_no      int not null check (line_no between 1 and 60),
  text_read    text not null check (length(text_read) between 1 and 200),
  qty_read     int check (qty_read is null or qty_read between 1 and 99),
  notes_read   text check (notes_read is null or length(notes_read) <= 200),
  flags        text[] not null default '{}',
  variant_id   uuid references menu_item_variants(id),
  match_source text not null default 'none'
               check (match_source in ('alias','trigram','manual','none')),
  confidence   numeric(4,3) check (confidence is null or confidence between 0 and 1),
  constraint order_slip_lines_no_key unique (slip_id, line_no),
  constraint order_slip_lines_match_chk
    check ((match_source = 'none') = (variant_id is null))
);

create table if not exists menu_aliases (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id),
  alias_norm   text not null check (length(alias_norm) between 1 and 200),
  variant_id   uuid not null references menu_item_variants(id) on delete cascade,
  uses         int not null default 1 check (uses > 0),
  created_by   uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (new, empty tables: the header's waiver).
-- ---------------------------------------------------------------------------
create unique index if not exists menu_aliases_key on menu_aliases (venue_id, alias_norm);
create index if not exists order_slips_venue_status_idx on order_slips (venue_id, status, created_at);
create index if not exists order_slips_uploader_idx on order_slips (uploaded_by, created_at);

-- ---------------------------------------------------------------------------
-- 3. Comments.
-- ---------------------------------------------------------------------------
comment on table order_slips is
  'order_slip (Milestone 4b): one photographed handwritten order slip. Filed by app.create_order_slip (the waiter, the cashier or MGMT), read by the receipt-scan edge function, sent to the kitchen by app.send_order_slip (which goes through app.till_add_items) or rejected. Read by the cashier and MGMT at the branch and by its uploader.';
comment on column order_slips.id is 'Slip id.';
comment on column order_slips.venue_id is 'The branch.';
comment on column order_slips.storage_path is 'The photo: a staff-media path in the slips folder (claimed as order_slip:<id>), read by its uploader, the cashier and management.';
comment on column order_slips.uploaded_by is 'Who took the photo.';
comment on column order_slips.status is 'uploaded (waiting for a reading, or no model connected), reading, read (lines waiting for the cashier), failed (error_code says why), sent (on the tab as order_id) or rejected.';
comment on column order_slips.error_code is 'Why the last reading did not produce lines: the codes of supplier_receipts.error_code.';
comment on column order_slips.reading_started_at is 'When the current or last reading started; one older than three minutes may be taken over.';
comment on column order_slips.read_at is 'When the last reading was stored.';
comment on column order_slips.model is 'The model that produced the last reading.';
comment on column order_slips.table_number_read is 'The table number as read off the slip, digits folded.';
comment on column order_slips.table_id is 'The table: guessed from the number read, then the one the order went to.';
comment on column order_slips.tab_id is 'The tab the order was sent to.';
comment on column order_slips.order_id is 'The order app.send_order_slip created (one slip, one order).';
comment on column order_slips.sent_by is 'The cashier, manager or owner who sent it.';
comment on column order_slips.sent_at is 'When it was sent to the kitchen.';
comment on column order_slips.rejected_by is 'Who set it aside.';
comment on column order_slips.rejected_at is 'When it was set aside.';
comment on column order_slips.rejected_reason is 'Why, as typed (at most 200 characters).';
comment on column order_slips.created_at is 'When it was filed.';

comment on table order_slip_lines is
  'order_slip (Milestone 4b): one line read off an order slip, with the menu variant app.match_slip_lines matched it to. Replaced on every new reading; what was sent is the order''s own lines. Read like its slip.';
comment on column order_slip_lines.id is 'Line id.';
comment on column order_slip_lines.slip_id is 'The slip.';
comment on column order_slip_lines.line_no is 'Its position on the slip, from 1.';
comment on column order_slip_lines.text_read is 'The item as written.';
comment on column order_slip_lines.qty_read is 'How many, as written (1 to 99); NULL when no number was written.';
comment on column order_slip_lines.notes_read is 'What was written about the item for the kitchen or bar.';
comment on column order_slip_lines.flags is 'Checks raised on the reading: UNCLEAR (the model was not sure), NO_QTY.';
comment on column order_slip_lines.variant_id is 'The menu variant it was matched (or sent) as.';
comment on column order_slip_lines.match_source is 'alias (a wording a cashier sent before), trigram (name similarity), manual (picked by hand), none.';
comment on column order_slip_lines.confidence is 'How sure the match is, 0 to 1 (1 for an alias).';

comment on table menu_aliases is
  'order_slip (Milestone 4b): a slip wording (normalised by app.search_norm) that a cashier sent as a menu variant, per branch. Written by app.send_order_slip; read by app.match_slip_lines. Read by MGMT at the branch.';
comment on column menu_aliases.id is 'Alias id.';
comment on column menu_aliases.venue_id is 'The branch.';
comment on column menu_aliases.alias_norm is 'The wording, normalised.';
comment on column menu_aliases.variant_id is 'The menu variant it means.';
comment on column menu_aliases.uses is 'How many sends have used it.';
comment on column menu_aliases.created_by is 'The staff member whose send created it.';
comment on column menu_aliases.created_at is 'When it was created.';
comment on column menu_aliases.last_used_at is 'When a send last used it.';

-- ---------------------------------------------------------------------------
-- 4. The slips photo folder: the two staff_media_uploads CHECKs (0196), then
--    the three functions re-issued verbatim from 0196 with `slips`.
-- ---------------------------------------------------------------------------
alter table staff_media_uploads drop constraint if exists staff_media_uploads_folder_check;
alter table staff_media_uploads
  add constraint staff_media_uploads_folder_check
  check (folder in ('proposals','tests','steps','marketing','campaigns','receipts',
                    'checklists','teachings','requests','incidents','slips'))
  not valid;

alter table staff_media_uploads drop constraint if exists staff_media_uploads_path_chk;
alter table staff_media_uploads
  add constraint staff_media_uploads_path_chk
  check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests|incidents|slips)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
         and split_part(path, '/', 1) = venue_id::text
         and split_part(path, '/', 2) = folder)
  not valid;

do $validate_folder_checks_0238$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_media_uploads_folder_check'
                and conrelid = 'public.staff_media_uploads'::regclass
                and not convalidated) then
    alter table staff_media_uploads validate constraint staff_media_uploads_folder_check;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'staff_media_uploads_path_chk'
                and conrelid = 'public.staff_media_uploads'::regclass
                and not convalidated) then
    alter table staff_media_uploads validate constraint staff_media_uploads_path_chk;
  end if;
end $validate_folder_checks_0238$;

comment on column staff_media_uploads.folder is
  'What the photo is for: proposals, tests, steps, marketing, campaigns, receipts, checklists, teachings, requests, incidents or slips (receipts and incidents are read by their uploader and management only; slips also by the cashier).';

create or replace function app.is_staff_media_path(p_name text) returns boolean
language sql immutable as $is_staff_media_path_0238$
  select coalesce(
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests|incidents|slips)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',
    false)
$is_staff_media_path_0238$;

comment on function app.is_staff_media_path(text) is
  'staff_media_bucket (§2.3), re-issued by staff_media_folders (§2.24.2), staff_media_incidents (wave5-addendum §2.4) and order_slip_tables (0238). True when a storage object name is a staff-media path, <venue_id>/<folder>/<uuid>.<jpg|png|webp> with one of the eleven folders; false for anything else, NULL included. Pure text, never raises. Granted to anon, authenticated and service_role because the staff-media storage policies evaluate it as the reading role.';

revoke all on function app.is_staff_media_path(text) from public;
grant execute on function app.is_staff_media_path(text) to anon, authenticated, service_role;

create or replace function app.staff_media_slot(
  p_venue_id uuid,
  p_folder   text,
  p_ext      text
) returns jsonb
language plpgsql security definer set search_path = public as $staff_media_slot_0238$
declare
  v_venue  uuid;
  v_folder text := lower(btrim(coalesce(p_folder, '')));
  v_ext    text := lower(btrim(coalesce(p_ext, '')));
  v_path   text;
  v_row    staff_media_uploads%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if v_folder not in ('proposals','tests','steps','marketing','campaigns','receipts',
                      'checklists','teachings','requests','incidents','slips') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'folder';
  end if;
  if v_ext = 'jpeg' then
    v_ext := 'jpg';
  end if;
  if v_ext not in ('jpg','png','webp') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'ext';
  end if;

  -- A phone that mints slots and never uploads (a loop, a stuck retry) is
  -- stopped here rather than filling the table.
  if (select count(*) from staff_media_uploads
       where uploader = auth.uid() and used_at is null
         and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'UPLOAD_LIMIT' using errcode = 'P0001';
  end if;

  v_path := v_venue::text || '/' || v_folder || '/' || gen_random_uuid()::text || '.' || v_ext;
  insert into staff_media_uploads (path, venue_id, folder, uploader)
  values (v_path, v_venue, v_folder, auth.uid())
  returning * into v_row;

  return jsonb_build_object('path', v_row.path,
                            'bucket', 'staff-media',
                            'expires_at', v_row.created_at + interval '1 hour');
end $staff_media_slot_0238$;

comment on function app.staff_media_slot(uuid, text, text) is
  'staff_media_bucket (§2.3), re-issued by staff_media_folders, staff_media_incidents and order_slip_tables (0238). Any active staff member at the venue: mints one upload path <venue_id>/<folder>/<uuid>.<jpg|png|webp> in one of the eleven folders (slips: an order slip), valid for an hour, 30 unused per hour at most. Returns {path, bucket, expires_at}. INVALID_ARGUMENT (hint folder or ext), UPLOAD_LIMIT; FORBIDDEN for anyone else.';

revoke all on function app.staff_media_slot(uuid, text, text) from public, anon;
grant execute on function app.staff_media_slot(uuid, text, text) to authenticated;

create or replace function app.staff_media_visible(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $staff_media_visible_0238$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_ref  constant text := '^(release_idea|checklist_item|teaching|marketing_request):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_content constant text := '^marketing_content:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_up   staff_media_uploads%rowtype;
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
  v_kind text;
  v_ref  uuid;
begin
  if not app.is_staff_media_path(p_name) or app.staff_role() is null then
    return false;
  end if;
  select * into v_up from staff_media_uploads where path = p_name;
  if not found or not (v_up.venue_id = any(app.staff_venue_ids())) then
    return false;
  end if;

  -- staff_media_incidents (§2.4, V4): a content item's images are the
  -- uploader's, marketing's and the owners' at its venue, and not a
  -- manager's, so this answers before the MGMT rule below. Nested behind its
  -- table, which a later migration creates.
  if v_up.used_by ~ c_content then
    if v_up.uploader = auth.uid() then
      return true;
    end if;
    if to_regclass('public.marketing_content') is null then
      return false;
    end if;
    return exists (select 1 from marketing_content c
                    where c.id = split_part(v_up.used_by, ':', 2)::uuid
                      and c.venue_id = v_up.venue_id)
       and app.is_staff_at(v_up.venue_id, 'marketing', 'owner');
  end if;

  if v_up.uploader = auth.uid() or app.is_staff_at(v_up.venue_id, 'manager', 'owner') then
    return true;
  end if;

  -- order_slip_tables (0238): a waiter's order slip is read at the till.
  if v_up.used_by ~ '^order_slip:' then
    return app.is_staff_at(v_up.venue_id, 'cashier');
  end if;

  if v_up.used_by ~ c_sub then
    select s.* into v_step
      from protocol_submissions x
      join protocol_run_steps s on s.id = x.run_step_id
     where x.id = split_part(v_up.used_by, ':', 2)::uuid;
    if not found then
      return false;
    end if;
    select * into v_run from protocol_runs where id = v_step.run_id;
    return exists (select 1 from protocol_submissions x
                    where x.run_step_id = v_step.id
                      and x.submitted_by = auth.uid()
                      and p_name = any(x.photos))
        or (coalesce(app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key)->>'record_visibility',
                     'run') = 'run'
            and app.protocol_engine_involved(v_run.id));
  end if;

  if v_up.used_by ~ '^marketing_note:' then
    return app.is_staff_at(v_up.venue_id, 'marketing');
  end if;

  -- staff_media_folders (§2.24.2): the role spec's records. Each read is
  -- nested behind its table, which a later migration may create.
  if v_up.used_by !~ c_ref then
    return false;
  end if;
  v_kind := split_part(v_up.used_by, ':', 1);
  v_ref  := split_part(v_up.used_by, ':', 2)::uuid;

  if v_kind = 'release_idea' then
    if to_regclass('public.release_ideas') is null then
      return false;
    end if;
    return exists (select 1 from release_ideas i
                    where i.id = v_ref
                      and i.venue_id = v_up.venue_id
                      and app.is_staff_at(i.venue_id, app.staff_team_head(i.team)));
  elsif v_kind = 'checklist_item' then
    return exists (select 1
                     from checklist_run_items ci
                     join checklist_runs r on r.id = ci.run_id
                    where ci.id = v_ref
                      and r.venue_id = v_up.venue_id
                      and app.is_staff_at(r.venue_id, r.role));
  elsif v_kind = 'teaching' then
    if to_regclass('public.teachings') is null then
      return false;
    end if;
    return exists (select 1 from teachings t
                    where t.id = v_ref
                      and t.venue_id = v_up.venue_id
                      and t.archived_at is null
                      and t.team = app.staff_team(app.staff_role())
                      and app.is_staff_at(t.venue_id, app.staff_role()));
  elsif v_kind = 'marketing_request' then
    if to_regclass('public.marketing_requests') is null then
      return false;
    end if;
    return exists (select 1 from marketing_requests m
                    where m.id = v_ref
                      and m.venue_id = v_up.venue_id)
       and app.is_staff_at(v_up.venue_id, 'marketing');
  end if;
  return false;
end $staff_media_visible_0238$;

comment on function app.staff_media_visible(text) is
  'protocols_engine_rpcs (§2.3, §2.7 "Visibility"), re-issued by staff_media_folders (§2.24.2), staff_media_incidents (wave5-addendum §2.4) and order_slip_tables (0238). True when the caller may read a staff-media photo: a marketing content item''s image only its uploader, and marketing and the owners at its venue (never a manager); any other photo its uploader and MGMT at its venue always; an order slip''s photo also the cashier at its venue; a protocol submission''s photo also its step''s sender and, on a step whose record is run-visible, anyone involved in the run; a marketing note''s photo also marketing at the venue; an idea''s photo also the holders of the idea''s team head role at its venue; a checklist tick''s photo also the holders of the list''s role at its venue; a teaching''s photo also its team at its venue while it is not archived; a request to marketing''s photo also marketing at its venue; an incident''s photo and anything else nobody else. False for a guest, another venue and any name that is not a staff-media path; never raises. The staff_media_read storage policy evaluates it as the reading role, hence the authenticated grant.';

revoke all on function app.staff_media_visible(text) from public, anon;
grant execute on function app.staff_media_visible(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS. The cashier set at the branch in scope; the uploader their own.
-- ---------------------------------------------------------------------------
alter table order_slips      enable row level security;
alter table order_slip_lines enable row level security;
alter table menu_aliases     enable row level security;

drop policy if exists order_slips_till_read on order_slips;
create policy order_slips_till_read on order_slips
  for select to authenticated
  using ((select app.is_staff('cashier','manager','owner'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists order_slips_read_own on order_slips;
create policy order_slips_read_own on order_slips
  for select to authenticated
  using (uploaded_by = (select auth.uid()));

drop policy if exists order_slip_lines_read on order_slip_lines;
create policy order_slip_lines_read on order_slip_lines
  for select to authenticated
  using (exists (select 1 from order_slips s
                  where s.id = order_slip_lines.slip_id
                    and (s.uploaded_by = (select auth.uid())
                         or ((select app.is_staff('cashier','manager','owner'))
                             and s.venue_id = any ((select app.visible_venue_ids())::uuid[])))));

drop policy if exists menu_aliases_mgmt_read on menu_aliases;
create policy menu_aliases_mgmt_read on menu_aliases
  for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

grant select on order_slips, order_slip_lines, menu_aliases to authenticated;
grant all on order_slips, order_slip_lines, menu_aliases to service_role;

-- ---------------------------------------------------------------------------
-- 6. The branch guard (0230).
-- ---------------------------------------------------------------------------
drop trigger if exists zz_branch_guard on public.order_slips;
create trigger zz_branch_guard before insert or update or delete on public.order_slips
  for each row execute function app.trg_branch_guard('scoped', 'cafe_tables', 'table_id', 'tabs', 'tab_id', 'orders', 'order_id');
drop trigger if exists zz_branch_guard on public.order_slip_lines;
create trigger zz_branch_guard before insert or update or delete on public.order_slip_lines
  for each row execute function app.trg_branch_guard('child', 'order_slips', 'slip_id', 'menu_item_variants', 'variant_id');
drop trigger if exists zz_branch_guard on public.menu_aliases;
create trigger zz_branch_guard before insert or update or delete on public.menu_aliases
  for each row execute function app.trg_branch_guard('scoped', 'menu_item_variants', 'variant_id');

-- ---------------------------------------------------------------------------
-- 7. Live on the till: a slip filed, read, sent or set aside is broadcast on
--    the floor topics the till already listens to (TillScreen, useBroadcast
--    'floor'), in the shape of app.rt_waiter_call (0224): the legacy topic and
--    the branch's own. The payload names the slip and its state only; the
--    till reads the rest through app.slips_to_send (SEC-28).
-- ---------------------------------------------------------------------------
create or replace function app.rt_order_slip() returns trigger
language plpgsql security definer set search_path = public as $rt_order_slip_0238$
begin
  begin
    perform realtime.send(
      jsonb_build_object('slip_id', new.id, 'status', new.status),
      'order_slip',
      'floor',
      true);
  exception when others then null;
  end;
  begin
    perform realtime.send(
      jsonb_build_object('slip_id', new.id, 'status', new.status),
      'order_slip',
      'floor:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_order_slip_0238$;

comment on function app.rt_order_slip() is
  'order_slip_tables (0238). AFTER INSERT / UPDATE OF status on order_slips: broadcasts order_slip {slip_id, status} on floor and floor:<venue> (private topics the cashier set and the waiter may join, 0224). Never raises: a broadcast that fails is dropped, the till polls as well.';

revoke all on function app.rt_order_slip() from public, anon, authenticated;

drop trigger if exists rt_order_slip on public.order_slips;
create trigger rt_order_slip after insert or update of status on public.order_slips
  for each row execute function app.rt_order_slip();
