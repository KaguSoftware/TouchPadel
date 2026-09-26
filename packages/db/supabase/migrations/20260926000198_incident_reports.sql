-- 0198 incident_reports — staff report accidents, fights, injuries and damage
-- at the venue; a manager or the owner reviews each one; the text and photos
-- go after a year.
--
-- Feature: protocols and the staff phone, wave 5, lane P
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.6, §2.0, §2.3,
-- §2.12; Majed's answer #6; §8 Q11-Q13 defaults).
-- Depends on: staff_push_keys_wave5 (P: incident_reported, incident_reviewed),
-- staff_media_incidents (P: the incidents folder). The protocol-action tick
-- phase that removes the photos ships in the same commit (§2.6.2).
-- Re-issues (§2.10): app.protocol_tick_nudge from 0173, verbatim but for its
-- "anything due" test (the incident photos, and the photos nobody claimed).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists; cron.schedule upserts by name.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- WHO. Any role at the venue reports (PROPOSAL, §8 Q11): a kind, when, where
-- (a court of the venue when it was on a court), what happened, optionally
-- who was involved and up to six photos in the incidents folder. MGMT at the
-- venue reviews with a note, never their own report; the owner can redact
-- early. A report is immutable once filed: the reviewer's note carries any
-- correction (§8 Q12). MGMT hear of each report with the reporter's name and
-- the kind only; the reporter hears of the review.
--
-- RETENTION (PROPOSAL, §8 Q12). 365 days after the report,
-- app.incident_purge_due (cron tp_incident_purge) replaces the description
-- with a marker and empties who was involved, the place detail and the review
-- note; the kind, place, court, times and review stamps stay, so counts
-- survive. protocol-action's tick removes the photos
-- (app.incident_photo_purge_due, app.incident_photos_purged). A redaction
-- does the same at once, with its own marker, and brings the photos' turn
-- forward. No reason is stored for a redaction: the reason would name the
-- person. A note written on a report whose text is gone goes at the next
-- purge run.
--
-- PHOTOS NOBODY CLAIMED (review 2026-09-26). A photo is uploaded before its
-- form is sent; one whose report (or content item) was never filed stayed in
-- storage for good, outside the 365 days and readable by MGMT. A day on, an
-- unclaimed slot in incidents or campaigns (content drafts, which managers
-- must not keep seeing, §8 Q14) is held for removal and the same tick removes
-- it: app.staff_media_orphan_purge_due marks the slots used by
-- 'orphan_purge' (so a late claim gets PHOTO_PATH_INVALID, never a report
-- pointing at nothing) and lists them, and app.staff_media_orphans_purged
-- lets the slots go once the objects are gone. Other folders are unchanged.
--
-- NO GUEST LINK, on purpose: no guest, profile, customer, phone or
-- reservation column, so SEC-20's discovery does not see the table and
-- delete_my_account cannot follow it. Erasure is by retention and redaction,
-- declared in stored-fields.test.ts UNLINKED_PERSONAL.
--
-- THE LLM WALL (§2.0). Incident reports may name guests and describe
-- injuries: coverage excluded, no assistant_readable_columns row, no
-- assistant tool, no index trigger, and SEC-29 trips on people_involved. The
-- writer is submit_incident, never report_*, which SEC-29 scans as LLM-bound.
-- Audit rows carry the kind, the place, the court and a photo count, never
-- the text.
--
-- covered by packages/db/tests/incident-reports.test.ts,
-- stored-fields.test.ts (UNLINKED_PERSONAL) and protocol-action.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists incident_reports (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references venues(id),
  kind             text not null,
  occurred_at      timestamptz not null,
  place            text not null,
  court_id         uuid references courts(id),
  place_detail     text,
  description      text not null,
  people_involved  text,
  photos           text[] not null default '{}',
  reported_by      uuid not null references staff(id),
  reported_at      timestamptz not null default now(),
  status           text not null default 'open',
  reviewed_by      uuid references staff(id),
  reviewed_at      timestamptz,
  review_note      text,
  purge_after      timestamptz not null default now() + interval '365 days',
  text_purged_at   timestamptz,
  photos_purged_at timestamptz,
  constraint incident_reports_kind_chk check (kind in ('accident','injury','fight','damage','other')),
  constraint incident_reports_place_chk check (place in ('court','cafe','shop','outside','other')),
  constraint incident_reports_place_detail_chk check (place_detail is null or length(place_detail) <= 120),
  constraint incident_reports_description_chk
    check (coalesce(length(btrim(description)),0) > 0 and length(description) <= 2000),
  constraint incident_reports_people_chk check (people_involved is null or length(people_involved) <= 1000),
  constraint incident_reports_photos_chk check (cardinality(photos) <= 6),
  constraint incident_reports_status_chk check (status in ('open','reviewed')),
  constraint incident_reports_review_note_len_chk check (review_note is null or length(review_note) <= 1000),
  constraint incident_reports_court_chk check ((place = 'court') = (court_id is not null)),
  constraint incident_reports_reviewed_chk check ((status = 'reviewed') = (reviewed_by is not null)),
  constraint incident_reports_reviewed_at_chk check ((reviewed_by is null) = (reviewed_at is null)),
  constraint incident_reports_review_note_chk
    check (status <> 'reviewed' or text_purged_at is not null or coalesce(length(btrim(review_note)),0) > 0),
  constraint incident_reports_reviewer_chk check (reviewed_by is null or reviewed_by <> reported_by)
);

create index if not exists incident_reports_venue_status_idx
  on incident_reports (venue_id, status, reported_at desc);
create index if not exists incident_reports_purge_idx
  on incident_reports (purge_after) where text_purged_at is null;

comment on table incident_reports is
  'incident_reports (wave5-addendum §2.6, answer #6): accidents, injuries, fights and damage at the venue as staff report them, reviewed by MGMT. Immutable once filed. The text is replaced by a marker and the photos removed 365 days after the report (or at once on the owner''s redaction). No guest link on purpose. Read by MGMT at the venue; the reporter reads their own through app.my_incidents. Never readable by the owner assistant or any LLM.';
comment on column incident_reports.id is 'Report id.';
comment on column incident_reports.venue_id is 'The venue.';
comment on column incident_reports.kind is 'accident, injury, fight, damage or other.';
comment on column incident_reports.occurred_at is 'When it happened: from 7 days before the report to 10 minutes after.';
comment on column incident_reports.place is 'court, cafe, shop, outside or other.';
comment on column incident_reports.court_id is 'The court, when the place is a court (and only then).';
comment on column incident_reports.place_detail is 'Where exactly, as typed (at most 120 characters); emptied by the purge.';
comment on column incident_reports.description is 'What happened, as typed (1 to 2000 characters); replaced by a marker by the purge or a redaction.';
comment on column incident_reports.people_involved is 'Who was involved, as typed (at most 1000 characters); may name guests; emptied by the purge.';
comment on column incident_reports.photos is 'Photos: staff-media paths in the incidents folder (at most 6); emptied once protocol-action removed the objects.';
comment on column incident_reports.reported_by is 'The staff member who reported it.';
comment on column incident_reports.reported_at is 'When it was reported.';
comment on column incident_reports.status is 'open, or reviewed by MGMT.';
comment on column incident_reports.reviewed_by is 'The manager or owner who reviewed it: never the reporter.';
comment on column incident_reports.reviewed_at is 'When it was reviewed.';
comment on column incident_reports.review_note is 'The reviewer''s note (1 to 1000 characters); corrections go here; emptied by the purge.';
comment on column incident_reports.purge_after is 'When the text and photos go: 365 days after the report, or the moment of a redaction.';
comment on column incident_reports.text_purged_at is 'When the text was replaced (the purge or a redaction); NULL while it is kept.';
comment on column incident_reports.photos_purged_at is 'When protocol-action removed the photos from storage.';

alter table incident_reports enable row level security;

drop policy if exists incident_reports_mgmt_read on incident_reports;
create policy incident_reports_mgmt_read on incident_reports
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on incident_reports to authenticated;
grant all on incident_reports to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.incident_kind_label — the kind's {en, ar} name for a push, the words
--    of work.incident.kind.* (incident-reports.test.ts pins the pair).
--    Internal. Not inlinable: it carries a SET clause (0189).
-- ---------------------------------------------------------------------------
create or replace function app.incident_kind_label(p_kind text)
returns jsonb
language sql immutable set search_path = public as $incident_kind_label_0198$
  select case p_kind
    when 'accident' then '{"en": "Accident", "ar": "حادث"}'::jsonb
    when 'injury'   then '{"en": "Injury", "ar": "إصابة"}'::jsonb
    when 'fight'    then '{"en": "Fight", "ar": "شجار"}'::jsonb
    when 'damage'   then '{"en": "Damage", "ar": "ضرر"}'::jsonb
    when 'other'    then '{"en": "Other", "ar": "أخرى"}'::jsonb
  end
$incident_kind_label_0198$;

comment on function app.incident_kind_label(text) is
  'incident_reports (wave5-addendum §2.3, §4.2). Internal: an incident kind''s {en, ar} name, the push step of incident_reported and incident_reviewed; the same words as work.incident.kind.*. NULL for anything else.';

revoke all on function app.incident_kind_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.submit_incident — any role at the venue files a report. Tells MGMT
--    at the venue, with the reporter's name and the kind only.
-- ---------------------------------------------------------------------------
create or replace function app.submit_incident(
  p_kind            text,
  p_occurred_at     timestamptz,
  p_place           text,
  p_description     text,
  p_court_id        uuid   default null,
  p_place_detail    text   default null,
  p_people_involved text   default null,
  p_photos          text[] default '{}',
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_incident_0198$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_desc   text := nullif(btrim(coalesce(p_description, '')), '');
  v_people text := nullif(btrim(coalesce(p_people_involved, '')), '');
  v_detail text := nullif(btrim(coalesce(p_place_detail, '')), '');
  v_photos text[];
  v_id     uuid;
  v_result jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'submit_incident');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_kind is null or p_kind not in ('accident','injury','fight','damage','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_place is null or p_place not in ('court','cafe','shop','outside','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'place';
  end if;
  if p_occurred_at is null
     or p_occurred_at < now() - interval '7 days'
     or p_occurred_at > now() + interval '10 minutes' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'occurred_at';
  end if;
  -- A court place names its court, and only a court place names one.
  if (p_place = 'court') <> (p_court_id is not null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'court_id';
  end if;
  if p_court_id is not null
     and not exists (select 1 from courts c where c.id = p_court_id and c.venue_id = v_venue) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'court_id';
  end if;
  if v_desc is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'description';
  end if;
  if length(v_desc) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'description';
  end if;
  if length(v_people) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'people_involved';
  end if;
  if length(v_detail) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'place_detail';
  end if;
  -- In the order given, once each.
  v_photos := coalesce(array(select x from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_photos) > 6 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'photos';
  end if;

  insert into incident_reports (venue_id, kind, occurred_at, place, court_id, place_detail, description,
                                people_involved, photos, reported_by)
  values (v_venue, p_kind, p_occurred_at, p_place, p_court_id, v_detail, v_desc,
          v_people, v_photos, auth.uid())
  returning id into v_id;

  perform app.claim_staff_media(v_photos, v_venue, array['incidents'], 'incident:' || v_id::text);

  perform app.write_audit('incident.report', 'incident_report', v_id::text, null,
                          jsonb_build_object('kind', p_kind, 'place', p_place, 'court_id', p_court_id,
                                             'photos', cardinality(v_photos)));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['manager','owner']::staff_role[]),
    'staff_task',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'incident_reported',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                   'step', app.incident_kind_label(p_kind))));

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $submit_incident_0198$;

comment on function app.submit_incident(text, timestamptz, text, text, uuid, text, text, text[], uuid, text) is
  'incident_reports (wave5-addendum §2.6.2). Any active staff member at the venue files a report: a kind (accident, injury, fight, damage, other), when (7 days back to 10 minutes ahead), a place (court with a court of the venue, cafe, shop, outside, other), a description (1 to 2000), optionally a place detail (120), who was involved (1000) and up to 6 photos in the incidents folder. Tells MGMT at the venue (staff_task / incident_reported, the reporter''s name and the kind only). Returns {id}. Idempotent by key. FORBIDDEN, INVALID_ARGUMENT (hint kind, place, occurred_at, court_id or photos), REF_NOT_FOUND (hint court_id), TEXT_REQUIRED, TEXT_TOO_LONG (hint description, people_involved or place_detail), PHOTO_PATH_INVALID. Audit incident.report {kind, place, court_id, photos: n}.';

revoke all on function app.submit_incident(text, timestamptz, text, text, uuid, text, text, text[], uuid, text) from public, anon;
grant execute on function app.submit_incident(text, timestamptz, text, text, uuid, text, text, text[], uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.review_incident — MGMT at the report's venue, never on their own
--    report, with a note. Tells the reporter.
-- ---------------------------------------------------------------------------
create or replace function app.review_incident(p_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $review_incident_0198$
declare
  v_row  incident_reports%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from incident_reports where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status <> 'open' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if v_row.reported_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if v_note is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'note';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  update incident_reports
     set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
   where id = p_id
   returning * into v_row;

  perform app.write_audit('incident.review', 'incident_report', p_id::text,
                          jsonb_build_object('status', 'open'),
                          jsonb_build_object('status', 'reviewed'));

  perform app.notify_staff(
    array[v_row.reported_by],
    'staff_info',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'incident_reviewed',
      'params', jsonb_build_object('step', app.incident_kind_label(v_row.kind))));

  return jsonb_build_object('status', v_row.status, 'reviewed_at', v_row.reviewed_at);
end $review_incident_0198$;

comment on function app.review_incident(uuid, text) is
  'incident_reports (wave5-addendum §2.6.2). MGMT at the report''s venue reviews an open report, never their own, with a note (1 to 1000), and tells the reporter (staff_info / incident_reviewed, the kind only). Returns {status: reviewed, reviewed_at}. REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED (already reviewed), CANNOT_DECIDE_OWN, TEXT_REQUIRED, TEXT_TOO_LONG (hint note). Audit incident.review {status}.';

revoke all on function app.review_incident(uuid, text) from public, anon;
grant execute on function app.review_incident(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.redact_incident — the owner removes a report's text at once; its
--    photos go at the next tick. State-idempotent.
-- ---------------------------------------------------------------------------
create or replace function app.redact_incident(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $redact_incident_0198$
declare
  c_marker constant text := '[deleted by the owner]';
  v_row    incident_reports%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from incident_reports where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.text_purged_at is not null then
    return jsonb_build_object('text_purged_at', v_row.text_purged_at);
  end if;

  update incident_reports
     set description     = c_marker,
         people_involved = null,
         place_detail    = null,
         review_note     = null,
         text_purged_at  = now(),
         purge_after     = least(purge_after, now())
   where id = p_id
   returning * into v_row;

  perform app.write_audit('incident.redact', 'incident_report', p_id::text,
                          '{}'::jsonb, jsonb_build_object('redacted', true));
  return jsonb_build_object('text_purged_at', v_row.text_purged_at);
end $redact_incident_0198$;

comment on function app.redact_incident(uuid) is
  'incident_reports (wave5-addendum §2.6.2). The owner replaces a report''s description with a marker and empties who was involved, the place detail and the review note, now; purge_after becomes now, so protocol-action removes the photos at its next tick. No reason is stored. State-idempotent: a redacted report returns its stamp again. Returns {text_purged_at}. REF_NOT_FOUND, FORBIDDEN. Audit incident.redact {} -> {redacted: true}.';

revoke all on function app.redact_incident(uuid) from public, anon;
grant execute on function app.redact_incident(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.my_incidents — the reporter's own reports, with the review.
-- ---------------------------------------------------------------------------
create or replace function app.my_incidents(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_incidents_0198$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               x.id,
           'kind',             x.kind,
           'occurred_at',      x.occurred_at,
           'place',            x.place,
           'court_id',         x.court_id,
           'court_name_en',    c.name_en,
           'court_name_ar',    c.name_ar,
           'place_detail',     x.place_detail,
           'description',      x.description,
           'people_involved',  x.people_involved,
           'photos',           to_jsonb(x.photos),
           'status',           x.status,
           'reviewed_by_name', s.display_name,
           'reviewed_at',      x.reviewed_at,
           'review_note',      x.review_note,
           'redacted',         x.text_purged_at is not null)
         order by x.reported_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from incident_reports i
           where i.venue_id = v_venue and i.reported_by = auth.uid()
           order by i.reported_at desc, i.id
           limit v_limit) x
    left join courts c on c.id = x.court_id
    left join staff s on s.id = x.reviewed_by;

  return jsonb_build_object('incidents', v_rows);
end $my_incidents_0198$;

comment on function app.my_incidents(uuid, int) is
  'incident_reports (wave5-addendum §2.6.2). Any active staff member at the venue: {incidents: [{id, kind, occurred_at, place, court_id, court_name_en, court_name_ar, place_detail, description, people_involved, photos, status, reviewed_by_name, reviewed_at, review_note, redacted}]}, their own reports newest first, with the review note, p_limit 1 to 100 (default 30). FORBIDDEN for anyone else.';

revoke all on function app.my_incidents(uuid, int) from public, anon;
grant execute on function app.my_incidents(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.incidents_page — MGMT at the venue: open, reviewed or all.
-- ---------------------------------------------------------------------------
create or replace function app.incidents_page(
  p_venue_id uuid default null,
  p_filter   text default 'open',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $incidents_page_0198$
declare
  v_venue    uuid;
  v_filter   text := coalesce(p_filter, 'open');
  v_statuses text[];
  v_limit    int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   int := greatest(coalesce(p_offset, 0), 0);
  v_owner    boolean := app.is_staff('owner');
  v_rows     jsonb;
  v_total    int;
  v_open     int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_statuses := case v_filter
                  when 'open'     then array['open']
                  when 'reviewed' then array['reviewed']
                  when 'all'      then array['open','reviewed']
                end;
  if v_statuses is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;

  select count(*) into v_total
    from incident_reports i where i.venue_id = v_venue and i.status = any(v_statuses);
  select count(*) into v_open
    from incident_reports i where i.venue_id = v_venue and i.status = 'open';

  -- Open ones oldest first (what has waited longest); the rest newest first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'kind',              x.kind,
           'occurred_at',       x.occurred_at,
           'place',             x.place,
           'court_id',          x.court_id,
           'court_name_en',     c.name_en,
           'court_name_ar',     c.name_ar,
           'place_detail',      x.place_detail,
           'description',       x.description,
           'people_involved',   x.people_involved,
           'photos',            to_jsonb(x.photos),
           'status',            x.status,
           'reviewed_by_name',  v.display_name,
           'reviewed_at',       x.reviewed_at,
           'review_note',       x.review_note,
           'redacted',          x.text_purged_at is not null,
           'reported_by_name',  r.display_name,
           'reported_by_role',  r.role,
           'reported_at',       x.reported_at,
           'can_review',        x.status = 'open' and x.reported_by is distinct from auth.uid(),
           'can_redact',        v_owner and x.text_purged_at is null)
         order by x.ord), '[]'::jsonb)
    into v_rows
    from (select i.*,
                 row_number() over (order by
                   case when v_filter = 'open' then i.reported_at end asc,
                   case when v_filter <> 'open' then i.reported_at end desc,
                   i.id) as ord
            from incident_reports i
           where i.venue_id = v_venue and i.status = any(v_statuses)
           order by ord
           limit v_limit offset v_offset) x
    left join courts c on c.id = x.court_id
    left join staff v on v.id = x.reviewed_by
    left join staff r on r.id = x.reported_by;

  return jsonb_build_object('incidents', v_rows, 'open_count', v_open, 'total', v_total);
end $incidents_page_0198$;

comment on function app.incidents_page(uuid, text, int, int) is
  'incident_reports (wave5-addendum §2.6.2). MGMT at the venue: {incidents: [<my_incidents row> + {reported_by_name, reported_by_role, reported_at, can_review, can_redact}], open_count, total} for p_filter open (oldest first), reviewed or all (newest first), p_limit 1 to 200. INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.incidents_page(uuid, text, int, int) from public, anon;
grant execute on function app.incidents_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The purge: the daily text purge (cron, as the database owner; the audit
--    shows System), and the photo pair protocol-action's tick calls with the
--    service role.
-- ---------------------------------------------------------------------------
create or replace function app.incident_purge_due()
returns jsonb
language plpgsql security definer set search_path = public as $incident_purge_due_0198$
declare
  c_marker constant text := '[deleted after 365 days]';
  v        record;
  v_total  int := 0;
begin
  -- A note written after a redaction is still text to remove.
  for v in
    select i.venue_id, count(*)::int as n
      from incident_reports i
     where i.purge_after <= now()
       and (i.text_purged_at is null or i.review_note is not null)
     group by i.venue_id
     order by i.venue_id
  loop
    update incident_reports
       set description     = case when text_purged_at is null then c_marker else description end,
           people_involved = null,
           place_detail    = null,
           review_note     = null,
           text_purged_at  = coalesce(text_purged_at, now())
     where venue_id = v.venue_id
       and purge_after <= now()
       and (text_purged_at is null or review_note is not null);

    perform app.write_audit('incident.purge', 'venue', v.venue_id::text, null,
                            jsonb_build_object('incidents', v.n));
    v_total := v_total + v.n;
  end loop;

  return jsonb_build_object('incidents', v_total);
end $incident_purge_due_0198$;

comment on function app.incident_purge_due() is
  'incident_reports (wave5-addendum §2.6.2). Internal, cron tp_incident_purge: on every report past purge_after that still holds text, replaces the description with ''[deleted after 365 days]'' (a redacted one keeps its own marker) and empties people_involved, place_detail and review_note; the kind, place, court, times and review stamps stay. Audit incident.purge per venue (counts only). Returns {incidents}.';

revoke all on function app.incident_purge_due() from public, anon, authenticated;

create or replace function app.incident_photo_purge_due(p_limit int default 20)
returns jsonb
language sql stable security definer set search_path = public as $incident_photo_purge_due_0198$
  select coalesce(jsonb_agg(jsonb_build_object('incident_id', d.id, 'paths', to_jsonb(d.photos))
                            order by d.purge_after, d.id), '[]'::jsonb)
    from (select i.id, i.photos, i.purge_after
            from incident_reports i
           where i.purge_after <= now()
             and i.photos_purged_at is null
             and cardinality(i.photos) > 0
           order by i.purge_after, i.id
           limit greatest(coalesce(p_limit, 20), 1)) d
$incident_photo_purge_due_0198$;

comment on function app.incident_photo_purge_due(int) is
  'incident_reports (wave5-addendum §2.6.2). Service role: [{incident_id, paths}], the reports past purge_after whose photos are still in storage; protocol-action removes the objects and calls app.incident_photos_purged.';

revoke all on function app.incident_photo_purge_due(int) from public, anon, authenticated;
grant execute on function app.incident_photo_purge_due(int) to service_role;

create or replace function app.incident_photos_purged(p_id uuid)
returns void
language sql security definer set search_path = public as $incident_photos_purged_0198$
  update incident_reports set photos_purged_at = now(), photos = '{}'
   where id = p_id and photos_purged_at is null
$incident_photos_purged_0198$;

comment on function app.incident_photos_purged(uuid) is
  'incident_reports (wave5-addendum §2.6.2). Service role: marks a report''s photos removed from storage and empties its photos.';

revoke all on function app.incident_photos_purged(uuid) from public, anon, authenticated;
grant execute on function app.incident_photos_purged(uuid) to service_role;

-- The photos nobody claimed: listed and held for the tick, then let go.
create or replace function app.staff_media_orphan_purge_due(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $staff_media_orphan_purge_due_0198$
declare
  v_paths jsonb;
begin
  -- SKIP LOCKED: a slot a recording RPC is claiming right now is its.
  with due as (
    select u.path
      from staff_media_uploads u
     where (u.used_by is null
            and u.folder in ('incidents', 'campaigns')
            and u.created_at < now() - interval '1 day')
        or u.used_by = 'orphan_purge'
     order by u.created_at, u.path
     limit greatest(coalesce(p_limit, 50), 1)
       for update skip locked
  ), held as (
    update staff_media_uploads u
       set used_at = coalesce(u.used_at, now()),
           used_by = 'orphan_purge'
      from due
     where u.path = due.path
    returning u.path, u.created_at
  )
  select coalesce(jsonb_agg(h.path order by h.created_at, h.path), '[]'::jsonb) into v_paths
    from held h;
  return v_paths;
end $staff_media_orphan_purge_due_0198$;

comment on function app.staff_media_orphan_purge_due(int) is
  'incident_reports (review 2026-09-26). Service role: ["<path>", …], at most p_limit (default 50), oldest first: the incidents and campaigns upload slots no record claimed within a day, and those held earlier whose objects are not gone yet. Each is marked used by ''orphan_purge'', so a late claim is PHOTO_PATH_INVALID. protocol-action removes the objects, then calls app.staff_media_orphans_purged.';

revoke all on function app.staff_media_orphan_purge_due(int) from public, anon, authenticated;
grant execute on function app.staff_media_orphan_purge_due(int) to service_role;

create or replace function app.staff_media_orphans_purged(p_paths text[])
returns int
language plpgsql security definer set search_path = public as $staff_media_orphans_purged_0198$
declare
  v_n int;
begin
  delete from staff_media_uploads
   where path = any(coalesce(p_paths, '{}'::text[]))
     and used_by = 'orphan_purge';
  get diagnostics v_n = row_count;
  return v_n;
end $staff_media_orphans_purged_0198$;

comment on function app.staff_media_orphans_purged(text[]) is
  'incident_reports (review 2026-09-26). Service role: deletes the held slots (used by ''orphan_purge'') among p_paths once protocol-action has removed their objects; any other path is left alone. Returns how many went.';

revoke all on function app.staff_media_orphans_purged(text[]) from public, anon, authenticated;
grant execute on function app.staff_media_orphans_purged(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 9. app.protocol_tick_nudge — 0173 verbatim, and incident photos due and
--    photos nobody claimed count as something to do.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $protocol_tick_nudge_0198$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from protocol_runs r
                    where r.kind = 'product_release' and r.status = 'scheduled'
                      and r.scheduled_for <= now())
       and not exists (select 1 from protocol_runs r
                        where r.status in ('stopped', 'withdrawn')
                          and r.finished_at + interval '90 days' <= now()
                          and r.photos_purged_at is null)
       and not exists (select 1 from incident_reports i
                        where i.purge_after <= now()
                          and i.photos_purged_at is null
                          and cardinality(i.photos) > 0)
       and not exists (select 1 from staff_media_uploads u
                        where (u.used_by is null
                               and u.folder in ('incidents', 'campaigns')
                               and u.created_at < now() - interval '1 day')
                           or u.used_by = 'orphan_purge') then
      return;                                  -- nothing due: no HTTP
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/protocol-action',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'protocol_tick_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $protocol_tick_nudge_0198$;

comment on function app.protocol_tick_nudge() is
  'release_post_launch (§2.19), re-issued by incident_reports (wave5-addendum §2.6.2). Every 5 minutes (tp_protocol_tick): asks protocol-action to launch the scheduled releases whose date has come, to remove the photos of runs stopped or withdrawn 90 days ago, to remove the photos of incident reports past purge_after, and to remove the incidents and campaigns photos nobody claimed within a day. Posts nothing when nothing is due; silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.protocol_tick_nudge() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. The daily text purge, in its own guarded block (0021 shape;
--     cron.schedule upserts by name).
-- ---------------------------------------------------------------------------
do $incident_cron_0198$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - incident purge skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_incident_purge not scheduled';
    return;
  end if;

  -- Daily at 03:50 (UTC on the database clock), after tp_hiring_purge.
  perform cron.schedule('tp_incident_purge', '50 3 * * *', 'select app.incident_purge_due();');
end $incident_cron_0198$;
