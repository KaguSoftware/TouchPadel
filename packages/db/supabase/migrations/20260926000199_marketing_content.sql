-- 0199 marketing_content — marketing sends content (posts) for the owners'
-- approval, one immutable version per round.
--
-- Feature: protocols and the staff phone, wave 5, lane P
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.7, §2.0, §2.3, §2.4;
-- Majed's answer #7; §8 Q14-Q16 defaults).
-- Depends on: staff_push_keys_wave5 (P: content_submitted, content_approved,
-- content_changes, content_declined), staff_media_incidents (P: the
-- marketing_content: read rule in app.staff_media_visible, behind this table's
-- to_regclass).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- WHY NEW TABLES (PROPOSAL). marketing_requests (0187) is staff asking
-- marketing, one answer and no rounds; marketing_campaigns (0073) is a send
-- lifecycle with its own channels. An item may point at a menu item or a
-- campaign instead. The owner approves exactly one version, so each round is
-- an immutable version row (the 0072 reason).
--
-- THE STATE MACHINE. waiting: the current version is undecided. The owner's
-- approve makes it approved, which is final (PROPOSAL, §8 Q16: a change is a
-- new item); changes makes it changes; decline makes it declined, final. In
-- waiting or changes marketing may send a new version: the open one is
-- superseded, current_version goes up by one and the item waits again.
-- Withdrawn (by marketing) is final.
--
-- WHO (PROPOSAL, §8 Q14, V4). Marketing at the venue submits, revises,
-- withdraws and reads the venue's whole queue; the owners decide. Managers
-- have no RPC, no table read (the owner-only policies below, a departure from
-- the contracts' MGMT default) and no image read (the staff_media_incidents
-- rule). Images: up to 10 in the campaigns folder, claimed as
-- marketing_content:<id>, so every version of one item re-uses a path; a
-- video or design file is an https:// link (PROPOSAL, §8 Q15).
--
-- THE LLM WALL (§2.0, §2.7.1). marketing_content (a title, a channel, dates
-- and a status) is table_read, with readable-column rows for its own columns
-- only. marketing_content_versions holds unpublished captions and images that
-- may show guests: coverage excluded, no readable-column row.
--
-- covered by packages/db/tests/marketing-content.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The tables.
-- ---------------------------------------------------------------------------
create table if not exists marketing_content (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  author_id       uuid not null references staff(id),
  title           text not null,
  channel         text not null,
  planned_for     date not null,
  menu_item_id    uuid references menu_items(id) on delete set null,
  campaign_id     uuid references marketing_campaigns(id) on delete set null,
  status          text not null default 'waiting',
  current_version int not null default 1,
  decided_by      uuid references staff(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint marketing_content_title_chk
    check (coalesce(length(btrim(title)),0) > 0 and length(title) <= 120),
  constraint marketing_content_channel_chk
    check (channel in ('instagram','tiktok','facebook','snapchat','whatsapp',
                       'telegram','guest_site','in_venue','print','other')),
  constraint marketing_content_status_chk
    check (status in ('waiting','changes','approved','declined','withdrawn')),
  constraint marketing_content_version_chk check (current_version >= 1),
  constraint marketing_content_decided_chk
    check ((status in ('approved','declined')) = (decided_by is not null)),
  constraint marketing_content_decided_at_chk check ((decided_by is null) = (decided_at is null)),
  constraint marketing_content_decider_chk check (decided_by is null or decided_by <> author_id)
);

create index if not exists marketing_content_venue_status_idx
  on marketing_content (venue_id, status, planned_for);

create table if not exists marketing_content_versions (
  id            uuid primary key default gen_random_uuid(),
  content_id    uuid not null references marketing_content(id) on delete cascade,
  version       int not null,
  body          text not null,
  images        text[] not null default '{}',
  media_link    text,
  note          text,
  submitted_by  uuid not null references staff(id),
  submitted_at  timestamptz not null default now(),
  superseded_at timestamptz,
  decision      text,
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision_note text,
  constraint marketing_content_versions_version_key unique (content_id, version),
  constraint marketing_content_versions_version_chk check (version >= 1),
  constraint marketing_content_versions_body_chk
    check (coalesce(length(btrim(body)),0) > 0 and length(body) <= 4000),
  constraint marketing_content_versions_images_chk check (cardinality(images) <= 10),
  constraint marketing_content_versions_media_link_chk
    check (media_link is null or (length(media_link) <= 500 and media_link ~ '^https://[^[:space:]]+$')),
  constraint marketing_content_versions_note_chk check (note is null or length(note) <= 1000),
  constraint marketing_content_versions_decision_chk check (decision in ('approve','changes','decline')),
  constraint marketing_content_versions_decision_note_len_chk
    check (decision_note is null or length(decision_note) <= 1000),
  constraint marketing_content_versions_decided_chk check ((decision is null) = (decided_by is null)),
  constraint marketing_content_versions_decided_at_chk check ((decided_by is null) = (decided_at is null)),
  constraint marketing_content_versions_reason_chk
    check (decision not in ('changes','decline') or coalesce(length(btrim(decision_note)),0) > 0),
  constraint marketing_content_versions_decider_chk check (decided_by is null or decided_by <> submitted_by),
  constraint marketing_content_versions_superseded_chk check (not (superseded_at is not null and decision is not null))
);

-- One open version per item: the one the owner decides.
create unique index if not exists marketing_content_versions_open_idx
  on marketing_content_versions (content_id) where decision is null and superseded_at is null;

comment on table marketing_content is
  'marketing_content (wave5-addendum §2.7, answer #7): content (a post) marketing sends for the owners'' approval. Its rounds are marketing_content_versions. Read by the owners at the venue (owner-only, §8 Q14); marketing reads through the RPCs. Approved and declined are final.';
comment on column marketing_content.id is 'Content item id.';
comment on column marketing_content.venue_id is 'The venue.';
comment on column marketing_content.author_id is 'The marketing staff member who first sent it.';
comment on column marketing_content.title is 'What it is, as typed (1 to 120 characters).';
comment on column marketing_content.channel is 'Where it goes: instagram, tiktok, facebook, snapchat, whatsapp, telegram, guest_site, in_venue, print or other.';
comment on column marketing_content.planned_for is 'The day it is planned for; not before the venue''s business date when sent.';
comment on column marketing_content.menu_item_id is 'The menu item it is about, if any.';
comment on column marketing_content.campaign_id is 'The campaign it belongs to, if any.';
comment on column marketing_content.status is 'waiting (the current version is undecided), changes (the owner asked for changes), approved or declined (final), or withdrawn (by marketing, final).';
comment on column marketing_content.current_version is 'The latest version''s number.';
comment on column marketing_content.decided_by is 'The owner who approved or declined it: never the author.';
comment on column marketing_content.decided_at is 'When it was approved or declined.';
comment on column marketing_content.created_at is 'When it was first sent.';
comment on column marketing_content.updated_at is 'When it last changed: a new version, a decision or a withdrawal.';

comment on table marketing_content_versions is
  'marketing_content (wave5-addendum §2.7): one immutable row per round of a content item: the caption, images, link and note marketing sent, and the owner''s decision on it. A newer version supersedes an undecided one. Owner-only; never readable by the owner assistant or any LLM (unpublished captions and images may show guests).';
comment on column marketing_content_versions.id is 'Version row id.';
comment on column marketing_content_versions.content_id is 'The content item.';
comment on column marketing_content_versions.version is 'The round: 1, 2, …';
comment on column marketing_content_versions.body is 'The caption or text, as typed (1 to 4000 characters).';
comment on column marketing_content_versions.images is 'Images: staff-media paths in the campaigns folder (at most 10), claimed for the item.';
comment on column marketing_content_versions.media_link is 'An https:// link to a video or a design file (at most 500 characters), shown as text.';
comment on column marketing_content_versions.note is 'Marketing''s note to the owner (at most 1000 characters).';
comment on column marketing_content_versions.submitted_by is 'The marketing staff member who sent this version.';
comment on column marketing_content_versions.submitted_at is 'When this version was sent.';
comment on column marketing_content_versions.superseded_at is 'When a newer version replaced this undecided one.';
comment on column marketing_content_versions.decision is 'The owner''s decision: approve, changes or decline.';
comment on column marketing_content_versions.decided_by is 'The owner who decided: never the submitter.';
comment on column marketing_content_versions.decided_at is 'When it was decided.';
comment on column marketing_content_versions.decision_note is 'The owner''s reason (at most 1000 characters); required for changes and decline.';

alter table marketing_content enable row level security;
alter table marketing_content_versions enable row level security;

-- Owner-only (V4): Q14 keeps managers out, so not the contracts' MGMT default.
drop policy if exists marketing_content_owner_read on marketing_content;
create policy marketing_content_owner_read on marketing_content
  for select to authenticated
  using (app.is_staff('owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists marketing_content_versions_owner_read on marketing_content_versions;
create policy marketing_content_versions_owner_read on marketing_content_versions
  for select to authenticated
  using (app.is_staff('owner')
         and exists (select 1 from marketing_content c
                      where c.id = content_id and c.venue_id = any(app.staff_venue_ids())));

grant select on marketing_content, marketing_content_versions to authenticated;
grant all on marketing_content, marketing_content_versions to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.submit_content — marketing at the venue sends a new item. Tells the
--    owners.
-- ---------------------------------------------------------------------------
create or replace function app.submit_content(
  p_title           text,
  p_channel         text,
  p_planned_for     date,
  p_body            text,
  p_images          text[] default '{}',
  p_media_link      text   default null,
  p_note            text   default null,
  p_menu_item_id    uuid   default null,
  p_campaign_id     uuid   default null,
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_content_0199$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_link   text := nullif(btrim(coalesce(p_media_link, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_images text[];
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

  v_replay := app.claim_replay(p_idempotency_key, 'submit_content');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_title is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'title';
  end if;
  if length(v_title) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'title';
  end if;
  if p_channel is null or p_channel not in ('instagram','tiktok','facebook','snapchat','whatsapp',
                                            'telegram','guest_site','in_venue','print','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'channel';
  end if;
  -- The venue's own day, not the server's.
  if p_planned_for is null or p_planned_for < app.venue_business_date(v_venue) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'planned_for';
  end if;
  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 4000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if v_link is not null and (length(v_link) > 500 or v_link !~ '^https://[^[:space:]]+$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'media_link';
  end if;
  -- In the order given, once each.
  v_images := coalesce(array(select x from unnest(coalesce(p_images, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_images) > 10 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'images';
  end if;
  if p_menu_item_id is not null
     and not exists (select 1 from menu_items m where m.id = p_menu_item_id and m.venue_id = v_venue) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_campaign_id is not null
     and not exists (select 1 from marketing_campaigns c where c.id = p_campaign_id and c.venue_id = v_venue) then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into marketing_content (venue_id, author_id, title, channel, planned_for, menu_item_id, campaign_id)
  values (v_venue, auth.uid(), v_title, p_channel, p_planned_for, p_menu_item_id, p_campaign_id)
  returning id into v_id;
  insert into marketing_content_versions (content_id, version, body, images, media_link, note, submitted_by)
  values (v_id, 1, v_body, v_images, v_link, v_note, auth.uid());

  perform app.claim_staff_media(v_images, v_venue, array['campaigns'], 'marketing_content:' || v_id::text);

  perform app.write_audit('marketing.content.submit', 'marketing_content', v_id::text, null,
                          jsonb_build_object('status', 'waiting', 'version', 1, 'channel', p_channel,
                                             'images', cardinality(v_images)));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['owner']::staff_role[]),
    'staff_decide',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'content_submitted',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                   'title', v_title)),
    'content:' || v_id::text);

  v_result := jsonb_build_object('id', v_id, 'version', 1, 'status', 'waiting');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $submit_content_0199$;

comment on function app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text) is
  'marketing_content (wave5-addendum §2.7.2). Marketing at the venue sends a content item for the owners'' approval: a title (1 to 120), a channel, a planned day not before the venue''s business date, a caption (1 to 4000), up to 10 images in the campaigns folder, an optional https:// link (500) and note (1000), and an optional menu item or campaign of the venue. Tells the owners (staff_decide / content_submitted, the author''s name and the title; dedupe content:<id>). Returns {id, version: 1, status: waiting}. Idempotent by key. FORBIDDEN, TEXT_REQUIRED (hint title or body), TEXT_TOO_LONG (hint title, body or note), INVALID_ARGUMENT (hint channel, planned_for, media_link or images), ITEM_NOT_FOUND, CAMPAIGN_NOT_FOUND, PHOTO_PATH_INVALID. Audit marketing.content.submit {status, version, channel, images: n}.';

revoke all on function app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.revise_content — marketing sends the next version while the item
--    waits or changes were asked. A NULL header field keeps its value.
-- ---------------------------------------------------------------------------
create or replace function app.revise_content(
  p_id              uuid,
  p_body            text,
  p_images          text[] default '{}',
  p_media_link      text   default null,
  p_note            text   default null,
  p_title           text   default null,
  p_channel         text   default null,
  p_planned_for     date   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $revise_content_0199$
declare
  v_row     marketing_content%rowtype;
  v_replay  jsonb;
  v_title   text := nullif(btrim(coalesce(p_title, '')), '');
  v_body    text := nullif(btrim(coalesce(p_body, '')), '');
  v_link    text := nullif(btrim(coalesce(p_media_link, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_images  text[];
  v_version int;
  v_result  jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_content where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'revise_content');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_row.status not in ('waiting','changes') then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if length(v_title) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'title';
  end if;
  if p_channel is not null and p_channel not in ('instagram','tiktok','facebook','snapchat','whatsapp',
                                                 'telegram','guest_site','in_venue','print','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'channel';
  end if;
  if p_planned_for is not null and p_planned_for < app.venue_business_date(v_row.venue_id) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'planned_for';
  end if;
  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 4000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if v_link is not null and (length(v_link) > 500 or v_link !~ '^https://[^[:space:]]+$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'media_link';
  end if;
  v_images := coalesce(array(select x from unnest(coalesce(p_images, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_images) > 10 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'images';
  end if;

  -- The undecided version, if any, is replaced; a decided one stays as the
  -- owner left it.
  update marketing_content_versions
     set superseded_at = now()
   where content_id = p_id and decision is null and superseded_at is null;

  v_version := v_row.current_version + 1;
  insert into marketing_content_versions (content_id, version, body, images, media_link, note, submitted_by)
  values (p_id, v_version, v_body, v_images, v_link, v_note, auth.uid());

  update marketing_content
     set current_version = v_version,
         status          = 'waiting',
         title           = coalesce(v_title, title),
         channel         = coalesce(p_channel, channel),
         planned_for     = coalesce(p_planned_for, planned_for),
         updated_at      = now()
   where id = p_id
   returning * into v_row;

  perform app.claim_staff_media(v_images, v_row.venue_id, array['campaigns'], 'marketing_content:' || p_id::text);

  perform app.write_audit('marketing.content.revise', 'marketing_content', p_id::text, null,
                          jsonb_build_object('version', v_version, 'status', 'waiting'));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_row.venue_id, array['owner']::staff_role[]),
    'staff_decide',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'content_submitted',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                   'title', v_row.title)),
    'content:' || p_id::text);

  v_result := jsonb_build_object('id', p_id, 'version', v_version, 'status', 'waiting');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $revise_content_0199$;

comment on function app.revise_content(uuid, text, text[], text, text, text, text, date, text) is
  'marketing_content (wave5-addendum §2.7.2). Marketing at the item''s venue sends its next version while it waits or changes were asked: the undecided version is superseded, current_version goes up by one and the item waits again; a NULL title, channel or planned day keeps its value. Images of any earlier version of the same item may be sent again. Tells the owners (content_submitted; dedupe content:<id>). Returns {id, version, status: waiting}. Idempotent by key. REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED (approved, declined or withdrawn), and the checks of app.submit_content. Audit marketing.content.revise {version, status}.';

revoke all on function app.revise_content(uuid, text, text[], text, text, text, text, date, text) from public, anon;
grant execute on function app.revise_content(uuid, text, text[], text, text, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.withdraw_content — marketing takes an undecided item back.
-- ---------------------------------------------------------------------------
create or replace function app.withdraw_content(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_content_0199$
declare
  v_row marketing_content%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_content where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status not in ('waiting','changes') then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;

  update marketing_content set status = 'withdrawn', updated_at = now() where id = p_id;

  perform app.write_audit('marketing.content.withdraw', 'marketing_content', p_id::text,
                          jsonb_build_object('status', v_row.status),
                          jsonb_build_object('status', 'withdrawn'));
  return jsonb_build_object('status', 'withdrawn');
end $withdraw_content_0199$;

comment on function app.withdraw_content(uuid) is
  'marketing_content (wave5-addendum §2.7.2). Marketing at the item''s venue withdraws it while it waits or changes were asked; withdrawn is final. No push. Returns {status}. REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED. Audit marketing.content.withdraw {status}.';

revoke all on function app.withdraw_content(uuid) from public, anon;
grant execute on function app.withdraw_content(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.decide_content — the owner decides the current version: approve,
--    changes or decline. Tells its submitter and the author.
-- ---------------------------------------------------------------------------
create or replace function app.decide_content(
  p_id       uuid,
  p_version  int,
  p_decision text,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_content_0199$
declare
  v_row  marketing_content%rowtype;
  v_ver  marketing_content_versions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_content where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if p_decision is null or p_decision not in ('approve','changes','decline') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'decision';
  end if;
  -- Only the version the owner is looking at, and only while it is open.
  select * into v_ver from marketing_content_versions
   where content_id = p_id and version = p_version and decision is null and superseded_at is null
   for update;
  if v_row.status <> 'waiting' or p_version is distinct from v_row.current_version or not found then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if auth.uid() = v_row.author_id or auth.uid() = v_ver.submitted_by then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if p_decision in ('changes','decline') and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  update marketing_content_versions
     set decision = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = v_ver.id
   returning * into v_ver;

  update marketing_content
     set status     = case p_decision when 'approve' then 'approved'
                                      when 'changes' then 'changes'
                                      else 'declined' end,
         decided_by = case when p_decision in ('approve','decline') then auth.uid() end,
         decided_at = case when p_decision in ('approve','decline') then v_ver.decided_at end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('marketing.content.' || p_decision, 'marketing_content', p_id::text,
                          jsonb_build_object('status', 'waiting', 'version', p_version),
                          jsonb_build_object('status', v_row.status, 'version', p_version));

  perform app.notify_staff(
    array[v_ver.submitted_by, v_row.author_id],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', case p_decision when 'approve' then 'content_approved'
                                   when 'changes' then 'content_changes'
                                   else 'content_declined' end,
      'params', jsonb_build_object('title', v_row.title)));

  return jsonb_build_object('status', v_row.status, 'version', p_version, 'decided_at', v_ver.decided_at);
end $decide_content_0199$;

comment on function app.decide_content(uuid, int, text, text) is
  'marketing_content (wave5-addendum §2.7.2). The owner decides the current open version of a waiting item: approve (final), changes or decline (final), each of the last two with a reason (1 to 1000). Tells the version''s submitter and the author (staff_decided / content_approved, content_changes or content_declined, the title only). Returns {status, version, decided_at}. REF_NOT_FOUND, FORBIDDEN, INVALID_ARGUMENT (hint decision), SUBMISSION_DECIDED (not the current open version), CANNOT_DECIDE_OWN, TEXT_TOO_LONG (hint note), REASON_REQUIRED. Audit marketing.content.approve / .changes / .decline {status, version}.';

revoke all on function app.decide_content(uuid, int, text, text) from public, anon;
grant execute on function app.decide_content(uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.content_page — marketing and the owners at the venue: the queue.
-- ---------------------------------------------------------------------------
create or replace function app.content_page(
  p_venue_id uuid default null,
  p_filter   text default 'waiting',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $content_page_0199$
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
  if not app.is_staff('marketing','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_statuses := case v_filter
                  when 'waiting'  then array['waiting']
                  when 'changes'  then array['changes']
                  when 'approved' then array['approved']
                  when 'closed'   then array['declined','withdrawn']
                  when 'all'      then array['waiting','changes','approved','declined','withdrawn']
                end;
  if v_statuses is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;

  select count(*) into v_total
    from marketing_content c where c.venue_id = v_venue and c.status = any(v_statuses);
  select count(*) into v_waiting
    from marketing_content c where c.venue_id = v_venue and c.status = 'waiting';

  -- Waiting ones oldest first (what has waited longest); the rest newest first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               x.id,
           'title',            x.title,
           'channel',          x.channel,
           'planned_for',      x.planned_for,
           'status',           x.status,
           'current_version',  x.current_version,
           'author_name',      a.display_name,
           'submitted_at',     v.submitted_at,
           'cover_image',      v.images[1],
           'menu_item_id',     x.menu_item_id,
           'item_name_en',     m.name_en,
           'item_name_ar',     m.name_ar,
           'campaign_id',      x.campaign_id,
           'campaign_name_en', k.name_en,
           'campaign_name_ar', k.name_ar,
           'decided_by_name',  d.display_name,
           'decided_at',       x.decided_at,
           'updated_at',       x.updated_at)
         order by x.ord), '[]'::jsonb)
    into v_rows
    from (select c.*,
                 row_number() over (order by
                   case when v_filter = 'waiting' then c.updated_at end asc,
                   case when v_filter <> 'waiting' then c.updated_at end desc,
                   c.id) as ord
            from marketing_content c
           where c.venue_id = v_venue and c.status = any(v_statuses)
           order by ord
           limit v_limit offset v_offset) x
    left join marketing_content_versions v on v.content_id = x.id and v.version = x.current_version
    left join staff a on a.id = x.author_id
    left join staff d on d.id = x.decided_by
    left join menu_items m on m.id = x.menu_item_id
    left join marketing_campaigns k on k.id = x.campaign_id;

  return jsonb_build_object('content', v_rows, 'waiting_count', v_waiting, 'total', v_total);
end $content_page_0199$;

comment on function app.content_page(uuid, text, int, int) is
  'marketing_content (wave5-addendum §2.7.2). Marketing and the owners at the venue: {content: [{id, title, channel, planned_for, status, current_version, author_name, submitted_at, cover_image, menu_item_id, item_name_en, item_name_ar, campaign_id, campaign_name_en, campaign_name_ar, decided_by_name, decided_at, updated_at}], waiting_count, total} for p_filter waiting (oldest first), changes, approved, closed (declined or withdrawn) or all (newest first), p_limit 1 to 200. Never a manager (§8 Q14). INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.content_page(uuid, text, int, int) from public, anon;
grant execute on function app.content_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.content_detail — one item with every round, for marketing and the
--    owners at its venue.
-- ---------------------------------------------------------------------------
create or replace function app.content_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $content_detail_0199$
declare
  v_row      marketing_content%rowtype;
  v_owner    boolean;
  v_mkt      boolean;
  v_open_sub uuid;
  v_content  jsonb;
  v_versions jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_content where id = p_id;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  v_owner := app.is_staff('owner');
  v_mkt   := app.is_staff_at(v_row.venue_id, 'marketing');
  if not (v_owner or v_mkt) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select v.submitted_by into v_open_sub
    from marketing_content_versions v
   where v.content_id = p_id and v.decision is null and v.superseded_at is null;

  select jsonb_build_object(
           'id',               v_row.id,
           'title',            v_row.title,
           'channel',          v_row.channel,
           'planned_for',      v_row.planned_for,
           'status',           v_row.status,
           'current_version',  v_row.current_version,
           'author_name',      (select display_name from staff where id = v_row.author_id),
           'menu_item_id',     v_row.menu_item_id,
           'item_name_en',     m.name_en,
           'item_name_ar',     m.name_ar,
           'campaign_id',      v_row.campaign_id,
           'campaign_name_en', k.name_en,
           'campaign_name_ar', k.name_ar,
           'decided_by_name',  (select display_name from staff where id = v_row.decided_by),
           'decided_at',       v_row.decided_at,
           'created_at',       v_row.created_at,
           'updated_at',       v_row.updated_at)
    into v_content
    from (select 1) one
    left join menu_items m on m.id = v_row.menu_item_id
    left join marketing_campaigns k on k.id = v_row.campaign_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'version',           v.version,
           'body',              v.body,
           'images',            to_jsonb(v.images),
           'media_link',        v.media_link,
           'note',              v.note,
           'submitted_by_name', s.display_name,
           'submitted_at',      v.submitted_at,
           'superseded_at',     v.superseded_at,
           'decision',          v.decision,
           'decided_by_name',   d.display_name,
           'decided_at',        v.decided_at,
           'decision_note',     v.decision_note)
         order by v.version desc), '[]'::jsonb)
    into v_versions
    from marketing_content_versions v
    left join staff s on s.id = v.submitted_by
    left join staff d on d.id = v.decided_by
   where v.content_id = p_id;

  return jsonb_build_object(
    'content',      v_content,
    'versions',     v_versions,
    'can_decide',   v_owner and v_row.status = 'waiting' and v_open_sub is not null
                    and auth.uid() is distinct from v_row.author_id
                    and auth.uid() is distinct from v_open_sub,
    'can_revise',   v_mkt and v_row.status in ('waiting','changes'),
    'can_withdraw', v_mkt and v_row.status in ('waiting','changes'));
end $content_detail_0199$;

comment on function app.content_detail(uuid) is
  'marketing_content (wave5-addendum §2.7.2). Marketing and the owners at the item''s venue: {content: {id, title, channel, planned_for, status, current_version, author_name, menu_item_id, item_name_en, item_name_ar, campaign_id, campaign_name_en, campaign_name_ar, decided_by_name, decided_at, created_at, updated_at}, versions: [{version, body, images, media_link, note, submitted_by_name, submitted_at, superseded_at, decision, decided_by_name, decided_at, decision_note}] newest first, can_decide, can_revise, can_withdraw}. Never a manager (§8 Q14). REF_NOT_FOUND, FORBIDDEN.';

revoke all on function app.content_detail(uuid) from public, anon;
grant execute on function app.content_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Owner assistant: marketing_content joins the table_read allowlist (the
--    0144 statement, limited to this migration's table_read table, §1.5).
--    marketing_content_versions does not: it is excluded.
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
   and c.table_name in ('marketing_content')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
