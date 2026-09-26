-- 0236 receipt_scan_tables — AI receipt scanning into Goods in (Phase 2,
-- Milestone 4b), the tables.
--
-- THE FLOW. A driver or a manager photographs a supplier's receipt (the staff
-- phone, or a file on the operator's Goods in) into the staff-media receipts
-- folder and files it with app.create_receipt. The receipt-scan edge function
-- hands the photo to a model (the one adapter file,
-- supabase/functions/_shared/receipts/connect.ts) and stores what it read as
-- lines; app.match_receipt_lines matches each line to a stock ingredient
-- (learned alias first, then trigram similarity on the normalised names). A
-- manager reviews the lines beside the photo and confirms: app.confirm_receipt
-- books ONE delivery through app.receive_delivery_internal (source receipt)
-- and remembers the wording it confirmed as an alias for next time. Nothing
-- reaches stock without a manager's confirm, and with no model connected a
-- manager types the lines by hand against the photo.
--
-- WHO READS. The three tables are MGMT at the branch in scope; the staff
-- member who uploaded a receipt also reads it and its lines. No client holds
-- an insert, update or delete grant: every write is a definer RPC (0237) or
-- the edge function's service role.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables; the widened
-- deliveries_source_chk is dropped and re-added NOT VALID, then validated.
--
-- covered by packages/db/tests/receipts.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- Trigram similarity for the matcher. Schema extensions, as vector (0110);
-- the matcher's search_path names it.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists supplier_receipts (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references venues(id),
  storage_path       text not null unique check (length(storage_path) <= 200),
  source             text not null check (source in ('phone','operator')),
  uploaded_by        uuid not null references staff(id),
  status             text not null default 'uploaded'
                     check (status in ('uploaded','reading','read','failed','confirmed','rejected')),
  error_code         text check (error_code is null or length(error_code) <= 60),
  reading_started_at timestamptz,
  read_at            timestamptz,
  model              text check (model is null or length(model) <= 100),
  supplier_name_read text check (supplier_name_read is null or length(supplier_name_read) <= 120),
  supplier_id        uuid references suppliers(id),
  receipt_date       date,
  total_iqd_read     iqd,
  delivery_id        uuid references deliveries(id),
  confirmed_by       uuid references staff(id),
  confirmed_at       timestamptz,
  rejected_by        uuid references staff(id),
  rejected_at        timestamptz,
  rejected_reason    text check (rejected_reason is null or length(rejected_reason) <= 200),
  created_at         timestamptz not null default now(),
  constraint supplier_receipts_confirmed_chk
    check ((status = 'confirmed') = (delivery_id is not null and confirmed_at is not null)),
  constraint supplier_receipts_rejected_chk
    check ((status = 'rejected') = (rejected_at is not null))
);

create table if not exists supplier_receipt_lines (
  id                  uuid primary key default gen_random_uuid(),
  receipt_id          uuid not null references supplier_receipts(id) on delete cascade,
  line_no             int not null check (line_no between 1 and 200),
  text_read           text not null check (length(text_read) between 1 and 200),
  qty_read            numeric(12,3) check (qty_read is null or qty_read > 0),
  unit_read           text check (unit_read is null or length(unit_read) <= 20),
  unit_price_iqd_read iqd,
  line_total_iqd_read iqd,
  expiry_read         date,
  flags               text[] not null default '{}',
  ingredient_id       uuid references ingredients(id),
  match_source        text not null default 'none'
                      check (match_source in ('alias','trigram','manual','none')),
  confidence          numeric(4,3) check (confidence is null or confidence between 0 and 1),
  constraint supplier_receipt_lines_no_key unique (receipt_id, line_no),
  constraint supplier_receipt_lines_match_chk
    check ((match_source = 'none') = (ingredient_id is null))
);

create table if not exists ingredient_aliases (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  supplier_id   uuid references suppliers(id) on delete cascade,
  alias_norm    text not null check (length(alias_norm) between 1 and 200),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  uses          int not null default 1 check (uses > 0),
  created_by    uuid references staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (new, empty tables: the header's waiver). One alias per wording,
--    per supplier or chain-of-suppliers (NULL), per branch; confirm_receipt
--    upserts on exactly this expression.
-- ---------------------------------------------------------------------------
create unique index if not exists ingredient_aliases_key
  on ingredient_aliases (venue_id, (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)), alias_norm);
create index if not exists supplier_receipts_venue_status_idx on supplier_receipts (venue_id, status);

-- ---------------------------------------------------------------------------
-- 3. Comments.
-- ---------------------------------------------------------------------------
comment on table supplier_receipts is
  'receipt_scan (Milestone 4b): one photographed supplier receipt. Filed by app.create_receipt (driver or MGMT), read by the receipt-scan edge function (a model behind _shared/receipts/connect.ts), confirmed into ONE delivery by app.confirm_receipt or rejected. Read by MGMT at the branch and by its uploader.';
comment on column supplier_receipts.id is 'Receipt id.';
comment on column supplier_receipts.venue_id is 'The branch the receipt is for.';
comment on column supplier_receipts.storage_path is 'The photo: a staff-media path in the receipts folder (claimed as receipt:<id>), read by its uploader and management only.';
comment on column supplier_receipts.source is 'Where the photo came from: phone (the staff phone) or operator (a file on Goods in).';
comment on column supplier_receipts.uploaded_by is 'Who filed it.';
comment on column supplier_receipts.status is 'uploaded (waiting for a reading, or no model connected), reading, read (lines waiting for review), failed (the model could not read it; error_code says why), confirmed (booked as delivery_id) or rejected.';
comment on column supplier_receipts.error_code is 'Why the last reading did not produce lines: READER_NOT_CONFIGURED, UNREADABLE, UPSTREAM, TIMEOUT, RATE_LIMITED, LLM_MONTHLY_CAP, LLM_DAILY_QUOTA, INVALID_READING, PHOTO_MISSING.';
comment on column supplier_receipts.reading_started_at is 'When the current or last reading started; a reading older than three minutes may be taken over.';
comment on column supplier_receipts.read_at is 'When the last reading was stored.';
comment on column supplier_receipts.model is 'The model that produced the last reading.';
comment on column supplier_receipts.supplier_name_read is 'The supplier name as the model read it off the receipt.';
comment on column supplier_receipts.supplier_id is 'The supplier: guessed from the name read, then the one the manager confirmed with.';
comment on column supplier_receipts.receipt_date is 'The date printed on the receipt, as read.';
comment on column supplier_receipts.total_iqd_read is 'The receipt total in IQD, as read.';
comment on column supplier_receipts.delivery_id is 'The delivery app.confirm_receipt booked (one receipt, one delivery).';
comment on column supplier_receipts.confirmed_by is 'The manager or owner who confirmed it.';
comment on column supplier_receipts.confirmed_at is 'When it was confirmed.';
comment on column supplier_receipts.rejected_by is 'The manager or owner who rejected it.';
comment on column supplier_receipts.rejected_at is 'When it was rejected.';
comment on column supplier_receipts.rejected_reason is 'Why it was rejected, as typed (at most 200 characters).';
comment on column supplier_receipts.created_at is 'When it was filed.';

comment on table supplier_receipt_lines is
  'receipt_scan (Milestone 4b): one line the model read off a receipt, with the stock ingredient app.match_receipt_lines matched it to. Replaced on every new reading; the manager''s final lines go to the delivery, not here. Read like its receipt.';
comment on column supplier_receipt_lines.id is 'Line id.';
comment on column supplier_receipt_lines.receipt_id is 'The receipt it was read from.';
comment on column supplier_receipt_lines.line_no is 'Its position on the receipt, from 1.';
comment on column supplier_receipt_lines.text_read is 'The item wording as printed (at most 200 characters).';
comment on column supplier_receipt_lines.qty_read is 'The quantity as printed, in the receipt''s own unit.';
comment on column supplier_receipt_lines.unit_read is 'The receipt''s unit as printed (kg, box, pc…), not a stock unit.';
comment on column supplier_receipt_lines.unit_price_iqd_read is 'The unit price as printed, in IQD.';
comment on column supplier_receipt_lines.line_total_iqd_read is 'The line total as printed, in IQD.';
comment on column supplier_receipt_lines.expiry_read is 'An expiry date printed on the line, if any.';
comment on column supplier_receipt_lines.flags is 'Checks the edge function raised on the reading: ARITHMETIC (qty x price is not the total), NO_PRICE, TOTAL_MISMATCH, UNCLEAR (the model was not sure: handwriting).';
comment on column supplier_receipt_lines.ingredient_id is 'The stock ingredient it was matched (or confirmed) to.';
comment on column supplier_receipt_lines.match_source is 'alias (a wording a manager confirmed before), trigram (name similarity), manual (the manager picked it), none.';
comment on column supplier_receipt_lines.confidence is 'How sure the match is, 0 to 1 (1 for an alias).';

comment on table ingredient_aliases is
  'receipt_scan (Milestone 4b): a receipt wording (normalised by app.search_norm) that a manager confirmed means a stock ingredient, per branch and per supplier (NULL: any supplier). Written by app.confirm_receipt; read by app.match_receipt_lines. Read by MGMT at the branch.';
comment on column ingredient_aliases.id is 'Alias id.';
comment on column ingredient_aliases.venue_id is 'The branch.';
comment on column ingredient_aliases.supplier_id is 'The supplier whose receipts use this wording; NULL for any supplier.';
comment on column ingredient_aliases.alias_norm is 'The wording, normalised (lower case, Arabic letters folded, digits folded, spaces collapsed).';
comment on column ingredient_aliases.ingredient_id is 'The stock ingredient it means.';
comment on column ingredient_aliases.uses is 'How many confirms have used it.';
comment on column ingredient_aliases.created_by is 'The manager whose confirm created it.';
comment on column ingredient_aliases.created_at is 'When it was created.';
comment on column ingredient_aliases.last_used_at is 'When a confirm last used it.';

-- ---------------------------------------------------------------------------
-- 4. deliveries.source gains receipt (0200:148).
-- ---------------------------------------------------------------------------
alter table deliveries drop constraint if exists deliveries_source_chk;
alter table deliveries
  add constraint deliveries_source_chk
  check (source in ('goods_in', 'staff_log', 'receipt')) not valid;

do $validate_constraints_0236$
begin
  if exists (select 1 from pg_constraint
              where conname = 'deliveries_source_chk'
                and conrelid = 'public.deliveries'::regclass and not convalidated) then
    alter table deliveries validate constraint deliveries_source_chk;
  end if;
end $validate_constraints_0236$;

-- ---------------------------------------------------------------------------
-- 5. RLS. MGMT at the branch in scope; the uploader reads their own receipt.
-- ---------------------------------------------------------------------------
alter table supplier_receipts      enable row level security;
alter table supplier_receipt_lines enable row level security;
alter table ingredient_aliases     enable row level security;

drop policy if exists supplier_receipts_mgmt_read on supplier_receipts;
create policy supplier_receipts_mgmt_read on supplier_receipts
  for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists supplier_receipts_read_own on supplier_receipts;
create policy supplier_receipts_read_own on supplier_receipts
  for select to authenticated
  using (uploaded_by = (select auth.uid()));

drop policy if exists supplier_receipt_lines_read on supplier_receipt_lines;
create policy supplier_receipt_lines_read on supplier_receipt_lines
  for select to authenticated
  using (exists (select 1 from supplier_receipts r
                  where r.id = supplier_receipt_lines.receipt_id
                    and (r.uploaded_by = (select auth.uid())
                         or ((select app.is_staff('manager','owner'))
                             and r.venue_id = any ((select app.visible_venue_ids())::uuid[])))));

drop policy if exists ingredient_aliases_mgmt_read on ingredient_aliases;
create policy ingredient_aliases_mgmt_read on ingredient_aliases
  for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

grant select on supplier_receipts, supplier_receipt_lines, ingredient_aliases to authenticated;
grant all on supplier_receipts, supplier_receipt_lines, ingredient_aliases to service_role;

-- ---------------------------------------------------------------------------
-- 6. The branch guard (0230): links name rows of the same branch, and staff
--    write only where they work (the RPCs assert app.venue_id first).
-- ---------------------------------------------------------------------------
drop trigger if exists zz_branch_guard on public.supplier_receipts;
create trigger zz_branch_guard before insert or update or delete on public.supplier_receipts
  for each row execute function app.trg_branch_guard('scoped', 'suppliers', 'supplier_id', 'deliveries', 'delivery_id');
drop trigger if exists zz_branch_guard on public.supplier_receipt_lines;
create trigger zz_branch_guard before insert or update or delete on public.supplier_receipt_lines
  for each row execute function app.trg_branch_guard('child', 'supplier_receipts', 'receipt_id', 'ingredients', 'ingredient_id');
drop trigger if exists zz_branch_guard on public.ingredient_aliases;
create trigger zz_branch_guard before insert or update or delete on public.ingredient_aliases
  for each row execute function app.trg_branch_guard('scoped', 'suppliers', 'supplier_id', 'ingredients', 'ingredient_id');
