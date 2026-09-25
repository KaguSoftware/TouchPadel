-- 0168 marketing_staff — the marketing role's own work: campaign drafts it
-- suggests, which the owner completes and makes live, and its own take on
-- items, protocol runs and campaigns.
--
-- Feature: protocols and the staff phone, lane C
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.17; plan #14, §6.4, §7.4).
-- Depends on: protocols_engine_tables (A: protocol_runs, which a draft and a
-- note may name), staff_media_bucket (G: app.claim_staff_media, the draft's
-- images and the note's photos). The phone's staff-marketing (H) and the
-- owner's /marketing "From marketing" (I) read and write through it;
-- release_post_launch (E) reads marketing_notes into the day-30 review.
-- Re-runnable: add column if not exists, guarded constraint work, create …
-- if not exists, create or replace, drop policy if exists, on conflict do
-- nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- DRAFTS, NOT CAMPAIGNS. suggest_campaign writes a marketing_campaigns row in
-- draft with suggested_by set: name (one language is enough, copied into the
-- other column, which 0073 makes NOT NULL), channel, dates, message, images
-- and an optional link to an item or a run. Its suggester may change it while
-- it is still a draft nobody else has saved: updated_at = suggested_at, which
-- the owner's save_marketing_campaign and set_campaign_status both move
-- (0073). After that it is CAMPAIGN_DRAFT_LOCKED ("the owner has picked it
-- up"), not CAMPAIGN_LOCKED ("already gone out"). The owner completes the
-- audience and promotion and makes it live, as today: save_marketing_campaign
-- and set_campaign_status stay owner-only, and marketing_overview is not
-- re-issued (slice 2 owns its venue filter; the owner's panel joins
-- marketing_suggestions by id).
--
-- MY TAKE. marketing_notes is marketing's own view of an item, a run or a
-- campaign, with photos. It is not a customer-feedback log (plan #14): staff
-- notes on new items, which may say what customers said, are E's
-- release_notes.
--
-- WHO READS. marketing_notes is MGMT at the venue; marketing reads its own
-- drafts and notes, and the notes on a subject, through the RPCs below.
-- marketing_campaigns keeps its 0073 policy (no new one). Marketing gets no
-- campaign performance, revenue, tab or order read.
--
-- covered by packages/db/tests/marketing-staff.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. marketing_campaigns gains the suggestion's columns. The three foreign
--    keys are added NOT VALID and validated separately.
-- ---------------------------------------------------------------------------
alter table marketing_campaigns add column if not exists suggested_by    uuid;
alter table marketing_campaigns add column if not exists suggested_at    timestamptz;
alter table marketing_campaigns add column if not exists images          text[] not null default '{}';
alter table marketing_campaigns add column if not exists protocol_run_id uuid;
alter table marketing_campaigns add column if not exists menu_item_id    uuid;
alter table marketing_campaigns add column if not exists suggestion_note text;

do $add_fks_0168$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'marketing_campaigns_suggested_by_fkey'
                    and conrelid = 'public.marketing_campaigns'::regclass) then
    alter table marketing_campaigns
      add constraint marketing_campaigns_suggested_by_fkey
      foreign key (suggested_by) references staff(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'marketing_campaigns_protocol_run_id_fkey'
                    and conrelid = 'public.marketing_campaigns'::regclass) then
    alter table marketing_campaigns
      add constraint marketing_campaigns_protocol_run_id_fkey
      foreign key (protocol_run_id) references protocol_runs(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'marketing_campaigns_menu_item_id_fkey'
                    and conrelid = 'public.marketing_campaigns'::regclass) then
    alter table marketing_campaigns
      add constraint marketing_campaigns_menu_item_id_fkey
      foreign key (menu_item_id) references menu_items(id) on delete set null not valid;
  end if;
end $add_fks_0168$;

do $validate_fks_0168$
begin
  if exists (select 1 from pg_constraint
              where conname = 'marketing_campaigns_suggested_by_fkey'
                and conrelid = 'public.marketing_campaigns'::regclass and not convalidated) then
    alter table marketing_campaigns validate constraint marketing_campaigns_suggested_by_fkey;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'marketing_campaigns_protocol_run_id_fkey'
                and conrelid = 'public.marketing_campaigns'::regclass and not convalidated) then
    alter table marketing_campaigns validate constraint marketing_campaigns_protocol_run_id_fkey;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'marketing_campaigns_menu_item_id_fkey'
                and conrelid = 'public.marketing_campaigns'::regclass and not convalidated) then
    alter table marketing_campaigns validate constraint marketing_campaigns_menu_item_id_fkey;
  end if;
end $validate_fks_0168$;

comment on column marketing_campaigns.suggested_by is
  'marketing_staff (§2.17): the marketing staff member who suggested this draft (app.suggest_campaign); NULL for a campaign the owner started.';
comment on column marketing_campaigns.suggested_at is
  'When the suggester last saved it. While updated_at still equals it, the suggester may change the draft; the owner''s save moves updated_at and locks it.';
comment on column marketing_campaigns.images is
  'Images the suggester attached: staff-media paths in the campaigns folder (at most 6).';
comment on column marketing_campaigns.protocol_run_id is
  'The protocol run the suggestion is for (a launch, a tournament, a price change), if any.';
comment on column marketing_campaigns.menu_item_id is
  'The menu item the suggestion is about, if any.';
comment on column marketing_campaigns.suggestion_note is
  'The suggester''s note to the owner (at most 2000 characters).';

-- ---------------------------------------------------------------------------
-- 2. marketing_notes — marketing's own take.
-- ---------------------------------------------------------------------------
create table if not exists marketing_notes (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  subject_kind  text not null check (subject_kind in ('item','run','campaign')),
  subject_id    uuid not null,
  author_id     uuid not null references staff(id),
  body          text not null check (coalesce(length(btrim(body)),0) > 0 and length(body) <= 2000),
  photos        text[] not null default '{}' check (cardinality(photos) <= 6),
  created_at    timestamptz not null default now()
);

create index if not exists marketing_notes_subject_idx
  on marketing_notes (venue_id, subject_kind, subject_id);

comment on table marketing_notes is
  'marketing_staff (§2.17): the marketing role''s own take on a menu item, a protocol run or a campaign, with photos. Written only by marketing (app.add_marketing_note); read by MGMT at the venue, and by marketing through app.marketing_notes_for and app.my_marketing_notes. Not a customer-feedback log.';
comment on column marketing_notes.id is 'Note id.';
comment on column marketing_notes.venue_id is 'The venue of the subject.';
comment on column marketing_notes.subject_kind is 'item (menu_items), run (protocol_runs) or campaign (marketing_campaigns).';
comment on column marketing_notes.subject_id is 'The item, run or campaign the note is about.';
comment on column marketing_notes.author_id is 'The marketing staff member who wrote it.';
comment on column marketing_notes.body is 'The note, in the writer''s language (1 to 2000 characters).';
comment on column marketing_notes.photos is 'Photos attached: staff-media paths in the marketing folder (at most 6).';
comment on column marketing_notes.created_at is 'When it was written. Notes are never edited.';

alter table marketing_notes enable row level security;

drop policy if exists marketing_notes_mgmt_read on marketing_notes;
create policy marketing_notes_mgmt_read on marketing_notes
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on marketing_notes to authenticated;
grant all on marketing_notes to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.suggest_campaign — marketing at the venue: a new draft (p_id NULL)
--    or a change to its own draft that nobody else has saved.
-- ---------------------------------------------------------------------------
create or replace function app.suggest_campaign(
  p_id              uuid        default null,
  p_venue_id        uuid        default null,
  p_name_en         text        default null,
  p_name_ar         text        default null,
  p_channel         text        default null,
  p_starts_at       timestamptz default null,
  p_ends_at         timestamptz default null,
  p_body_en         text        default '',
  p_body_ar         text        default '',
  p_images          text[]      default '{}',
  p_run_id          uuid        default null,
  p_menu_item_id    uuid        default null,
  p_note            text        default null,
  p_idempotency_key text        default null
) returns jsonb
language plpgsql security definer set search_path = public as $suggest_campaign_0168$
declare
  v_venue   uuid;
  v_row     marketing_campaigns%rowtype;
  v_replay  jsonb;
  v_en      text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_ar      text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_body_en text := btrim(coalesce(p_body_en, ''));
  v_body_ar text := btrim(coalesce(p_body_ar, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_channel marketing_channel;
  v_images  text[];
  v_id      uuid;
  v_now     timestamptz := now();
  v_result  jsonb;
begin
  if not app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_id is not null then
    -- A change: the draft's own venue, and only the suggester's own draft
    -- (anything else answers as missing, so no id is confirmed).
    select * into v_row from marketing_campaigns where id = p_id for update;
    if not found or v_row.suggested_by is distinct from auth.uid()
       or not (v_row.venue_id = any(app.staff_venue_ids())) then
      raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_venue := v_row.venue_id;
  else
    v_venue := coalesce(p_venue_id, app.current_venue());
  end if;
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_id is null then
    v_replay := app.claim_replay(p_idempotency_key, 'suggest_campaign');
    if v_replay is not null then
      return v_replay;
    end if;
  elsif v_row.status <> 'draft' or v_row.updated_at is distinct from v_row.suggested_at then
    raise exception 'CAMPAIGN_DRAFT_LOCKED' using errcode = 'P0001';
  end if;

  -- 0073 makes both names and the channel NOT NULL with no blank check: one
  -- typed name fills both columns, and a missing or unknown channel is
  -- refused here, so no draft fails at the table with a raw 23502 or 22P02.
  if v_en is null and v_ar is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  v_en := coalesce(v_en, v_ar);
  v_ar := coalesce(v_ar, v_en);
  if length(v_en) > 120 or length(v_ar) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'name';
  end if;
  if p_channel is null
     or not (p_channel = any(enum_range(null::marketing_channel)::text[])) then
    raise exception 'BAD_CHANNEL' using errcode = 'P0001';
  end if;
  v_channel := p_channel::marketing_channel;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  if length(v_body_en) > 2000 or length(v_body_ar) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_note) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  -- In the order given, once each.
  v_images := coalesce(array(select x from unnest(coalesce(p_images, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_images) > 6 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'images';
  end if;
  if p_run_id is not null
     and not exists (select 1 from protocol_runs r where r.id = p_run_id and r.venue_id = v_venue) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'run_id';
  end if;
  if p_menu_item_id is not null
     and not exists (select 1 from menu_items m where m.id = p_menu_item_id and m.venue_id = v_venue) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'menu_item_id';
  end if;

  if p_id is null then
    insert into marketing_campaigns
      (venue_id, name_en, name_ar, channel, status, starts_at, ends_at, body_en, body_ar,
       created_by, created_at, updated_at, suggested_by, suggested_at, images,
       protocol_run_id, menu_item_id, suggestion_note)
    values
      (v_venue, v_en, v_ar, v_channel, 'draft', p_starts_at, p_ends_at, v_body_en, v_body_ar,
       auth.uid(), v_now, v_now, auth.uid(), v_now, v_images,
       p_run_id, p_menu_item_id, v_note)
    returning id into v_id;
  else
    -- updated_at moves with suggested_at, so the draft stays the suggester's.
    update marketing_campaigns
       set name_en = v_en, name_ar = v_ar, channel = v_channel,
           starts_at = p_starts_at, ends_at = p_ends_at,
           body_en = v_body_en, body_ar = v_body_ar,
           images = v_images, protocol_run_id = p_run_id, menu_item_id = p_menu_item_id,
           suggestion_note = v_note,
           suggested_at = v_now, updated_at = v_now
     where id = p_id
     returning id into v_id;
  end if;

  perform app.claim_staff_media(v_images, v_venue, array['campaigns'], 'marketing_campaign:' || v_id::text);

  perform app.write_audit('marketing.campaign.suggest', 'marketing_campaigns', v_id::text, null,
                          jsonb_build_object('status', 'draft', 'channel', p_channel,
                                             'images', cardinality(v_images), 'edit', p_id is not null));

  v_result := jsonb_build_object('id', v_id);
  if p_id is null and p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $suggest_campaign_0168$;

comment on function app.suggest_campaign(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text[], uuid, uuid, text, text) is
  'marketing_staff (§2.17). Marketing at the venue: a new campaign draft (p_id NULL; idempotent by key) or a change to the caller''s own draft while nobody else has saved it. One name is enough (copied into the other language), the channel is required, images are campaigns slots of the caller (at most 6), p_run_id and p_menu_item_id must be of the venue. The owner completes and makes it live. Returns {id}. TEXT_REQUIRED (hint name), BAD_CHANNEL, INVALID_RANGE, CAMPAIGN_DRAFT_LOCKED, CAMPAIGN_NOT_FOUND, PHOTO_PATH_INVALID, REF_NOT_FOUND, TEXT_TOO_LONG, INVALID_ARGUMENT (hint images). Audit marketing.campaign.suggest.';

revoke all on function app.suggest_campaign(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text[], uuid, uuid, text, text) from public, anon;
grant execute on function app.suggest_campaign(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text[], uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.my_campaign_drafts — marketing: the drafts it suggested at the
--    venue, whatever became of them, newest first. The message and note come
--    back so the suggester can change an editable draft. No audience, no
--    promotion, no performance.
-- ---------------------------------------------------------------------------
create or replace function app.my_campaign_drafts(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_campaign_drafts_0168$
declare
  v_venue uuid;
  v_rows  jsonb;
begin
  if not app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           c.id,
           'name_en',      c.name_en,
           'name_ar',      c.name_ar,
           'channel',      c.channel,
           'status',       c.status,
           'starts_at',    c.starts_at,
           'ends_at',      c.ends_at,
           'body_en',      c.body_en,
           'body_ar',      c.body_ar,
           'note',         c.suggestion_note,
           'images',       to_jsonb(c.images),
           'run_id',       c.protocol_run_id,
           'menu_item_id', c.menu_item_id,
           'suggested_at', c.suggested_at,
           'editable',     c.status = 'draft' and c.updated_at is not distinct from c.suggested_at)
         order by c.suggested_at desc, c.id), '[]'::jsonb)
    into v_rows
    from (select * from marketing_campaigns
           where venue_id = v_venue and suggested_by = auth.uid()
           order by suggested_at desc, id
           limit 100) c;

  return jsonb_build_object('drafts', v_rows);
end $my_campaign_drafts_0168$;

comment on function app.my_campaign_drafts(uuid) is
  'marketing_staff (§2.17). Marketing at the venue: {drafts: [{id, name_en, name_ar, channel, status, starts_at, ends_at, body_en, body_ar, note, images, run_id, menu_item_id, suggested_at, editable}]}, the caller''s own suggestions, newest first (at most 100). editable = still a draft nobody else has saved. No audience, promotion or performance. FORBIDDEN for anyone else.';

revoke all on function app.my_campaign_drafts(uuid) from public, anon;
grant execute on function app.my_campaign_drafts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.marketing_suggestions — the owner: which campaigns came from
--    marketing (the panel's "From marketing" filter and badge, joined by id).
-- ---------------------------------------------------------------------------
create or replace function app.marketing_suggestions(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $marketing_suggestions_0168$
declare
  v_venue uuid;
  v_rows  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id',       c.id,
           'suggested_by',      c.suggested_by,
           'suggested_by_name', s.display_name,
           'suggested_at',      c.suggested_at,
           'images',            to_jsonb(c.images),
           'run_id',            c.protocol_run_id,
           'menu_item_id',      c.menu_item_id,
           'suggestion_note',   c.suggestion_note)
         order by c.suggested_at desc, c.id), '[]'::jsonb)
    into v_rows
    from marketing_campaigns c
    left join staff s on s.id = c.suggested_by
   where c.venue_id = v_venue
     and c.suggested_by is not null;

  return jsonb_build_object('drafts', v_rows);
end $marketing_suggestions_0168$;

comment on function app.marketing_suggestions(uuid) is
  'marketing_staff (§2.17). Owner only: {drafts: [{campaign_id, suggested_by, suggested_by_name, suggested_at, images, run_id, menu_item_id, suggestion_note}]}, every campaign at the venue that marketing suggested, newest first. The owner''s panel joins it to marketing_overview by id. FORBIDDEN for anyone else.';

revoke all on function app.marketing_suggestions(uuid) from public, anon;
grant execute on function app.marketing_suggestions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.add_marketing_note — marketing at the venue: its take on an item, a
--    run or a campaign of that venue. Never edited.
-- ---------------------------------------------------------------------------
create or replace function app.add_marketing_note(
  p_venue_id        uuid,
  p_subject_kind    text,
  p_subject_id      uuid,
  p_body            text,
  p_photos          text[] default '{}',
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $add_marketing_note_0168$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_found  boolean;
  v_photos text[];
  v_id     uuid;
  v_result jsonb;
begin
  if not app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'add_marketing_note');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_subject_kind is null or p_subject_kind not in ('item','run','campaign') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'subject_kind';
  end if;
  v_found := case p_subject_kind
               when 'item' then exists (select 1 from menu_items m where m.id = p_subject_id and m.venue_id = v_venue)
               when 'run'  then exists (select 1 from protocol_runs r where r.id = p_subject_id and r.venue_id = v_venue)
               else             exists (select 1 from marketing_campaigns c where c.id = p_subject_id and c.venue_id = v_venue)
             end;
  if not v_found then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'subject_id';
  end if;
  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  v_photos := coalesce(array(select x from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_photos) > 6 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'photos';
  end if;

  insert into marketing_notes (venue_id, subject_kind, subject_id, author_id, body, photos)
  values (v_venue, p_subject_kind, p_subject_id, auth.uid(), v_body, v_photos)
  returning id into v_id;

  perform app.claim_staff_media(v_photos, v_venue, array['marketing'], 'marketing_note:' || v_id::text);

  perform app.write_audit('marketing.note.add', 'marketing_note', v_id::text, null,
                          jsonb_build_object('subject_kind', p_subject_kind, 'subject_id', p_subject_id,
                                             'photos', cardinality(v_photos)));

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $add_marketing_note_0168$;

comment on function app.add_marketing_note(uuid, text, uuid, text, text[], text) is
  'marketing_staff (§2.17). Marketing at the venue: its own take (1 to 2000 characters, photos: marketing slots of the caller, at most 6) on a menu item, a protocol run or a campaign of that venue. Returns {id}. Idempotent by key. INVALID_ARGUMENT (hint subject_kind or photos), REF_NOT_FOUND, TEXT_REQUIRED, TEXT_TOO_LONG, PHOTO_PATH_INVALID. Audit marketing.note.add.';

revoke all on function app.add_marketing_note(uuid, text, uuid, text, text[], text) from public, anon;
grant execute on function app.add_marketing_note(uuid, text, uuid, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.marketing_notes_for — MGMT and marketing at the subject's venue:
--    every marketing note on one item, run or campaign, newest first.
-- ---------------------------------------------------------------------------
create or replace function app.marketing_notes_for(p_subject_kind text, p_subject_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $marketing_notes_for_0168$
declare
  v_venue uuid;
  v_rows  jsonb;
begin
  if not app.is_staff('marketing','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_subject_kind is null or p_subject_kind not in ('item','run','campaign') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'subject_kind';
  end if;

  v_venue := case p_subject_kind
               when 'item' then (select m.venue_id from menu_items m where m.id = p_subject_id)
               when 'run'  then (select r.venue_id from protocol_runs r where r.id = p_subject_id)
               else             (select c.venue_id from marketing_campaigns c where c.id = p_subject_id)
             end;
  if v_venue is null or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'subject_id';
  end if;
  if not app.is_staff_at(v_venue, 'marketing', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          n.id,
           'author_name', s.display_name,
           'body',        n.body,
           'photos',      to_jsonb(n.photos),
           'created_at',  n.created_at)
         order by n.created_at desc, n.id), '[]'::jsonb)
    into v_rows
    from marketing_notes n
    left join staff s on s.id = n.author_id
   where n.venue_id = v_venue
     and n.subject_kind = p_subject_kind
     and n.subject_id = p_subject_id;

  return jsonb_build_object('notes', v_rows);
end $marketing_notes_for_0168$;

comment on function app.marketing_notes_for(text, uuid) is
  'marketing_staff (§2.17). MGMT and marketing at the subject''s venue: {notes: [{id, author_name, body, photos, created_at}]}, the marketing notes on one item, run or campaign, newest first. INVALID_ARGUMENT (hint subject_kind); REF_NOT_FOUND for a subject at a venue the caller does not work at; FORBIDDEN for anyone else.';

revoke all on function app.marketing_notes_for(text, uuid) from public, anon;
grant execute on function app.marketing_notes_for(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.my_marketing_notes — marketing: its own notes at the venue, newest
--    first, each with its subject's name.
-- ---------------------------------------------------------------------------
create or replace function app.my_marketing_notes(
  p_venue_id uuid default null,
  p_limit    int  default 50
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_marketing_notes_0168$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows  jsonb;
begin
  if not app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              n.id,
           'subject_kind',    n.subject_kind,
           'subject_id',      n.subject_id,
           'subject_name_en', case n.subject_kind
                                when 'item' then (select m.name_en from menu_items m where m.id = n.subject_id)
                                when 'run'  then (select coalesce(nullif(btrim(r.title_en), ''), r.title_ar)
                                                    from protocol_runs r where r.id = n.subject_id)
                                else             (select c.name_en from marketing_campaigns c where c.id = n.subject_id)
                              end,
           'subject_name_ar', case n.subject_kind
                                when 'item' then (select m.name_ar from menu_items m where m.id = n.subject_id)
                                when 'run'  then (select coalesce(nullif(btrim(r.title_ar), ''), r.title_en)
                                                    from protocol_runs r where r.id = n.subject_id)
                                else             (select c.name_ar from marketing_campaigns c where c.id = n.subject_id)
                              end,
           'body',            n.body,
           'photos',          to_jsonb(n.photos),
           'created_at',      n.created_at)
         order by n.created_at desc, n.id), '[]'::jsonb)
    into v_rows
    from (select * from marketing_notes
           where venue_id = v_venue and author_id = auth.uid()
           order by created_at desc, id
           limit v_limit) n;

  return jsonb_build_object('notes', v_rows);
end $my_marketing_notes_0168$;

comment on function app.my_marketing_notes(uuid, int) is
  'marketing_staff (§2.17). Marketing at the venue: {notes: [{id, subject_kind, subject_id, subject_name_en, subject_name_ar, body, photos, created_at}]}, the caller''s own notes, newest first, p_limit 1 to 200 (default 50). A run''s name is its title in either language. FORBIDDEN for anyone else.';

revoke all on function app.my_marketing_notes(uuid, int) from public, anon;
grant execute on function app.my_marketing_notes(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Owner assistant: marketing_notes joins the table_read allowlist, and so
--    do marketing_campaigns' new columns (its existing rows stay as they are).
--    The 0144 statement, limited to this migration's tables (§1.5); never the
--    all-table catch-up.
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
   and c.table_name in ('marketing_notes', 'marketing_campaigns')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
