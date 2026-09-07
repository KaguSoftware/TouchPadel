-- 0073_marketing — campaigns, audiences and what each one actually produced
-- (Management → Observation → Marketing).
--
-- Before this, "marketing" was three unrelated surfaces: a promotions list
-- that priced a discount, a hero editor that changed the guest site, and a
-- Telegram outbox that sent text. Nothing tied a discount to the message that
-- announced it, and nothing could answer "did that do anything". A campaign is
-- the thing that ties them: an audience, a message, a window, and optionally
-- the promotion it hands out.
--
-- Model:
--
--   * A CAMPAIGN is configuration with a lifecycle: draft → scheduled → live →
--     ended, plus 'cancelled' from anywhere before ended. Status is moved only
--     by app.set_campaign_status, which enforces the order — a campaign cannot
--     go back to draft once it has been seen by a guest, because its sends are
--     already out.
--   * An AUDIENCE is a stored RULE, never a stored list of people. A frozen
--     list would go stale the day after it was cut and would quietly keep
--     mailing guests who asked to be forgotten; the rule is re-evaluated on
--     every read, so reach is always a live answer. Rules are deliberately
--     coarse (bookings, recency, language, reachability) — this is a padel
--     venue, not an ad network.
--   * A SEND is an immutable fact: at this moment, this many were targeted,
--     this many were delivered. Recorded by the service role as the sender
--     works, never edited afterwards. Delivery counts that could be revised
--     would make every historical report unreproducible.
--   * ATTRIBUTION is limited on purpose. A campaign that carries a promotion
--     is credited with the redemptions of that promotion inside the campaign's
--     own window, the discount it gave away, and the settled total of the tabs
--     those redemptions sat on. A campaign WITHOUT a promotion gets reach and
--     nothing else, and the screen says so rather than inventing a number:
--     there is no honest way to attribute a walk-in to a hero image, and a
--     fabricated lift figure is worse than an empty one because it gets
--     believed. See marketing_campaign_performance below.
--
-- covered by packages/db/tests/marketing.test.ts

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type marketing_channel as enum ('telegram','guest_site','in_venue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_status as enum ('draft','scheduled','live','ended','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Audiences — a rule, evaluated live
-- ---------------------------------------------------------------------------
create table if not exists marketing_audiences (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null,
  name_ar    text not null,
  -- {minBookings:int, lastSeenDays:int, lang:'en'|'ar', hasPhone:bool, hasPush:bool}
  -- Absent key = no constraint on that dimension.
  rule       jsonb not null default '{}'::jsonb,
  created_by uuid not null references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_audiences_rule_obj_chk check (jsonb_typeof(rule) = 'object')
);

comment on table marketing_audiences is
  '0073: a named RULE for selecting guests, re-evaluated on every read. Never a frozen list.';

-- ---------------------------------------------------------------------------
-- 3. Campaigns
-- ---------------------------------------------------------------------------
create table if not exists marketing_campaigns (
  id           uuid primary key default gen_random_uuid(),
  name_en      text not null,
  name_ar      text not null,
  channel      marketing_channel not null,
  status       campaign_status   not null default 'draft',
  audience_id  uuid references marketing_audiences(id),
  promotion_id uuid references promotions(id),
  starts_at    timestamptz,
  ends_at      timestamptz,
  body_en      text not null default '',
  body_ar      text not null default '',
  created_by   uuid not null references staff(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint marketing_campaigns_window_chk check (
    starts_at is null or ends_at is null or ends_at > starts_at
  ),
  -- Anything past draft has to say when it runs, or "live" means nothing and
  -- attribution has no window to count inside.
  constraint marketing_campaigns_scheduled_chk check (
    status = 'draft' or status = 'cancelled' or starts_at is not null
  ),
  -- A message channel with no message is a campaign that cannot be sent.
  constraint marketing_campaigns_body_chk check (
    status in ('draft','cancelled')
    or channel = 'in_venue'
    or (length(btrim(body_en)) > 0 and length(btrim(body_ar)) > 0)
  )
);

comment on table marketing_campaigns is
  '0073: audience + message + window + optional promotion. Status moves only through '
  'app.set_campaign_status; attribution counts the promotion''s redemptions inside the window.';

create index if not exists marketing_campaigns_status_idx
  on marketing_campaigns (status, starts_at desc);
create index if not exists marketing_campaigns_promotion_idx
  on marketing_campaigns (promotion_id) where promotion_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Sends — immutable delivery facts
-- ---------------------------------------------------------------------------
create table if not exists marketing_sends (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_campaigns(id),
  at          timestamptz not null default now(),
  recipients  int not null default 0 check (recipients >= 0),
  delivered   int not null default 0 check (delivered  >= 0),
  failed      int not null default 0 check (failed     >= 0),
  meta        jsonb not null default '{}'::jsonb
);

create index if not exists marketing_sends_campaign_idx
  on marketing_sends (campaign_id, at desc);

-- ---------------------------------------------------------------------------
-- 5. RLS — management reads, definer functions write
-- ---------------------------------------------------------------------------
alter table marketing_audiences enable row level security;
alter table marketing_campaigns enable row level security;
alter table marketing_sends     enable row level security;

drop policy if exists marketing_audiences_read on marketing_audiences;
create policy marketing_audiences_read on marketing_audiences
  for select to authenticated using (app.is_staff('manager','owner'));

drop policy if exists marketing_campaigns_read on marketing_campaigns;
create policy marketing_campaigns_read on marketing_campaigns
  for select to authenticated using (app.is_staff('manager','owner'));

drop policy if exists marketing_sends_read on marketing_sends;
create policy marketing_sends_read on marketing_sends
  for select to authenticated using (app.is_staff('manager','owner'));

grant select on marketing_audiences, marketing_campaigns, marketing_sends to authenticated;
grant all    on marketing_audiences, marketing_campaigns, marketing_sends to service_role;

-- ---------------------------------------------------------------------------
-- 6. app.marketing_audience_reach — how many guests a rule selects, now
-- ---------------------------------------------------------------------------
create or replace function app.marketing_audience_reach(p_rule jsonb)
returns int
language plpgsql stable security definer set search_path = public as $fn_marketing_reach_0073$
declare
  v_n int;
begin
  -- FIRST statement. This counts PROFILES, and a cafe guest who scanned a
  -- table QR holds `authenticated` exactly as staff do — without this they
  -- could size the venue's customer base and then probe it a rule at a time
  -- ("how many Arabic speakers with 5+ bookings"). It RAISES rather than
  -- returning null, so a refusal is never mistaken for an audience of nobody.
  -- Nested calls from marketing_overview still evaluate the real caller:
  -- SECURITY DEFINER does not change auth.uid().
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select count(*)::int into v_n
    from profiles p
   where (p_rule->>'lang'      is null or p.preferred_lang = p_rule->>'lang')
     and (p_rule->>'hasPhone'  is null or (p_rule->>'hasPhone')::boolean is not true
          or nullif(btrim(coalesce(p.phone, '')), '') is not null)
     and (p_rule->>'hasPush'   is null or (p_rule->>'hasPush')::boolean is not true
          or p.expo_push_token is not null)
     and (p_rule->>'minBookings' is null or (
           select count(*) from reservations r
            where r.guest_id = p.id and r.kind = 'booking'
              and r.status in ('confirmed','arrived','completed')
         ) >= (p_rule->>'minBookings')::int)
     and (p_rule->>'lastSeenDays' is null or exists (
           select 1 from reservations r
            where r.guest_id = p.id and r.kind = 'booking'
              and r.status in ('confirmed','arrived','completed')
              and r.start_at >= now() - make_interval(days => (p_rule->>'lastSeenDays')::int)
         ));

  return v_n;
end $fn_marketing_reach_0073$;

-- ---------------------------------------------------------------------------
-- 7. app.marketing_campaign_performance — what a campaign produced
--
-- Redemptions of the campaign's promotion, bounded by the campaign's own
-- window (falling back to its start when it has no end yet). A campaign with
-- no promotion returns nulls for the money columns, NOT zeros: "we cannot
-- attribute this" and "this earned nothing" are different statements and the
-- panel renders them differently.
-- ---------------------------------------------------------------------------
create or replace function app.marketing_campaign_performance(p_campaign uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_marketing_perf_0073$
declare
  v_c   marketing_campaigns%rowtype;
  v_out jsonb;
begin
  -- FIRST statement: otherwise the NOT_FOUND below is an oracle a guest can
  -- use to enumerate campaign ids, and a hit returns the venue's takings.
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_c from marketing_campaigns where id = p_campaign;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'sends',      coalesce(sum(s.recipients), 0),
           'delivered',  coalesce(sum(s.delivered), 0),
           'failed',     coalesce(sum(s.failed), 0),
           'lastSentAt', max(s.at))
    into v_out
    from marketing_sends s
   where s.campaign_id = p_campaign;

  if v_c.promotion_id is null then
    return v_out || jsonb_build_object(
      'attributable', false,
      'redemptions',  null,
      'discountIqd',  null,
      'revenueIqd',   null);
  end if;

  return v_out || (
    select jsonb_build_object(
             'attributable', true,
             'redemptions',  count(*),
             'discountIqd',  coalesce(sum(pr.amount_iqd), 0),
             -- Settled total of the tabs those redemptions sat on. Credited to
             -- the campaign as the sale it appeared on, not as profit.
             'revenueIqd',   coalesce(sum(t.total_iqd), 0))
      from promotion_redemptions pr
      join tabs t on t.id = pr.tab_id
     where pr.promotion_id = v_c.promotion_id
       and pr.redeemed_at >= coalesce(v_c.starts_at, v_c.created_at)
       and (v_c.ends_at is null or pr.redeemed_at < v_c.ends_at));
end $fn_marketing_perf_0073$;

-- ---------------------------------------------------------------------------
-- 8. app.marketing_overview — the panel: headline + every campaign
-- ---------------------------------------------------------------------------
create or replace function app.marketing_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_marketing_overview_0073$
declare
  v_campaigns jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(row order by row.sort_status, row.starts_at desc nulls last), '[]'::jsonb)
    into v_campaigns
    from (
      select c.id, c.name_en, c.name_ar, c.channel::text as channel, c.status::text as status,
             c.starts_at, c.ends_at, c.promotion_id, c.audience_id,
             a.name_en as audience_en, a.name_ar as audience_ar,
             p.name_en as promotion_en, p.name_ar as promotion_ar,
             case when a.rule is null then null
                  else app.marketing_audience_reach(a.rule) end as reach,
             app.marketing_campaign_performance(c.id) as performance,
             -- Live first, then scheduled, then draft, then finished.
             case c.status when 'live' then 0 when 'scheduled' then 1
                           when 'draft' then 2 when 'ended' then 3 else 4 end as sort_status
        from marketing_campaigns c
        left join marketing_audiences a on a.id = c.audience_id
        left join promotions p          on p.id = c.promotion_id
    ) row;

  return jsonb_build_object(
    'campaigns', v_campaigns,
    'audiences', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'nameEn', a.name_en, 'nameAr', a.name_ar,
               'rule', a.rule, 'reach', app.marketing_audience_reach(a.rule))
             order by a.name_en), '[]'::jsonb)
        from marketing_audiences a),
    'counts', (
      select jsonb_build_object(
               'live',      count(*) filter (where status = 'live'),
               'scheduled', count(*) filter (where status = 'scheduled'),
               'draft',     count(*) filter (where status = 'draft'))
        from marketing_campaigns));
end $fn_marketing_overview_0073$;

-- ---------------------------------------------------------------------------
-- 9. Writes — owner only
-- ---------------------------------------------------------------------------
create or replace function app.save_marketing_audience(
  p_id      uuid,
  p_name_en text,
  p_name_ar text,
  p_rule    jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_audience_0073$
declare v_id uuid;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_name_en)), 0) = 0 or coalesce(length(btrim(p_name_ar)), 0) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_rule, '{}'::jsonb)) <> 'object' then
    raise exception 'BAD_RULE' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into marketing_audiences (name_en, name_ar, rule, created_by)
    values (btrim(p_name_en), btrim(p_name_ar), coalesce(p_rule, '{}'::jsonb), auth.uid())
    returning id into v_id;
  else
    update marketing_audiences
       set name_en = btrim(p_name_en), name_ar = btrim(p_name_ar),
           rule = coalesce(p_rule, '{}'::jsonb), updated_at = now()
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'AUDIENCE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  perform app.write_audit('marketing.audience_save', 'marketing_audience', v_id::text,
                          null, jsonb_build_object('nameEn', p_name_en, 'rule', p_rule));
  return v_id;
end $fn_save_audience_0073$;

create or replace function app.save_marketing_campaign(
  p_id           uuid,
  p_name_en      text,
  p_name_ar      text,
  p_channel      text,
  p_audience_id  uuid        default null,
  p_promotion_id uuid        default null,
  p_starts_at    timestamptz default null,
  p_ends_at      timestamptz default null,
  p_body_en      text        default '',
  p_body_ar      text        default ''
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_campaign_0073$
declare
  v_id      uuid;
  v_channel marketing_channel;
  v_status  campaign_status;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_name_en)), 0) = 0 or coalesce(length(btrim(p_name_ar)), 0) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;

  begin
    v_channel := p_channel::marketing_channel;
  exception when invalid_text_representation then
    raise exception 'BAD_CHANNEL' using errcode = 'P0001';
  end;

  if p_id is null then
    insert into marketing_campaigns
      (name_en, name_ar, channel, audience_id, promotion_id, starts_at, ends_at,
       body_en, body_ar, created_by)
    values
      (btrim(p_name_en), btrim(p_name_ar), v_channel, p_audience_id, p_promotion_id,
       p_starts_at, p_ends_at, coalesce(p_body_en, ''), coalesce(p_body_ar, ''), auth.uid())
    returning id into v_id;
  else
    select status into v_status from marketing_campaigns where id = p_id for update;
    if not found then
      raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- A campaign people have already received is a historical record. Editing
    -- its message or window after the fact would silently rewrite what the
    -- attribution below is measuring.
    if v_status not in ('draft','scheduled') then
      raise exception 'CAMPAIGN_LOCKED' using errcode = 'P0001';
    end if;

    update marketing_campaigns
       set name_en = btrim(p_name_en), name_ar = btrim(p_name_ar), channel = v_channel,
           audience_id = p_audience_id, promotion_id = p_promotion_id,
           starts_at = p_starts_at, ends_at = p_ends_at,
           body_en = coalesce(p_body_en, ''), body_ar = coalesce(p_body_ar, ''),
           updated_at = now()
     where id = p_id
     returning id into v_id;
  end if;

  perform app.write_audit('marketing.campaign_save', 'marketing_campaign', v_id::text,
                          null, jsonb_build_object('nameEn', p_name_en, 'channel', p_channel));
  return v_id;
end $fn_save_campaign_0073$;

-- Status moves forward only: draft → scheduled → live → ended, with cancelled
-- reachable from anything not already finished.
create or replace function app.set_campaign_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $fn_set_campaign_status_0073$
declare
  v_row  marketing_campaigns%rowtype;
  v_next campaign_status;
  v_ok   boolean;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  begin
    v_next := p_status::campaign_status;
  exception when invalid_text_representation then
    raise exception 'BAD_STATUS' using errcode = 'P0001';
  end;

  select * into v_row from marketing_campaigns where id = p_id for update;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_ok := case
    when v_next = 'cancelled' then v_row.status in ('draft','scheduled','live')
    when v_row.status = 'draft'     then v_next = 'scheduled'
    when v_row.status = 'scheduled' then v_next in ('live','draft')
    when v_row.status = 'live'      then v_next = 'ended'
    else false
  end;
  if not v_ok then
    raise exception 'BAD_TRANSITION' using errcode = 'P0001';
  end if;

  -- The same rule marketing_campaigns_body_chk enforces, stated BEFORE the
  -- update so it arrives as a code the operator can read. Without this, moving
  -- an empty Telegram campaign out of draft failed as a raw check-constraint
  -- violation, which PostgREST surfaces with no P0001 code — so the panel
  -- could only say "something went wrong" about a campaign whose actual
  -- problem is that nobody has written the message yet.
  if v_next not in ('draft','cancelled')
     and v_row.channel <> 'in_venue'
     and (length(btrim(v_row.body_en)) = 0 or length(btrim(v_row.body_ar)) = 0) then
    raise exception 'BODY_REQUIRED' using errcode = 'P0001';
  end if;

  -- A campaign that is going out needs a window to be measured inside.
  if v_next not in ('draft','cancelled') and v_row.starts_at is null then
    raise exception 'START_REQUIRED' using errcode = 'P0001';
  end if;

  update marketing_campaigns set status = v_next, updated_at = now()
   where id = p_id returning * into v_row;

  perform app.write_audit('marketing.campaign_status', 'marketing_campaign', p_id::text,
                          null, jsonb_build_object('status', p_status));
  return to_jsonb(v_row);
end $fn_set_campaign_status_0073$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
revoke all on function app.marketing_audience_reach(jsonb) from public, anon;
grant execute on function app.marketing_audience_reach(jsonb) to authenticated;

revoke all on function app.marketing_campaign_performance(uuid) from public, anon;
grant execute on function app.marketing_campaign_performance(uuid) to authenticated;

revoke all on function app.marketing_overview() from public, anon;
grant execute on function app.marketing_overview() to authenticated;

revoke all on function app.save_marketing_audience(uuid, text, text, jsonb) from public, anon;
grant execute on function app.save_marketing_audience(uuid, text, text, jsonb) to authenticated;

revoke all on function app.save_marketing_campaign(uuid, text, text, text, uuid, uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function app.save_marketing_campaign(uuid, text, text, text, uuid, uuid, timestamptz, timestamptz, text, text) to authenticated;

revoke all on function app.set_campaign_status(uuid, text) from public, anon;
grant execute on function app.set_campaign_status(uuid, text) to authenticated;
