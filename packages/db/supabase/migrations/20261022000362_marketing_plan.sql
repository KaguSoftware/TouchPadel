-- 0362 marketing_plan, 2026-10-22 (Majed: "every start of a month they go
-- into a meeting with the marketing team, and the marketing team proposes
-- their calendar, the schedule for the entire month, with explanations and
-- what the idea is. That goes through an approval and then onto the system.
-- Later they send the results of that idea after they have filmed it or made
-- it ... the owner accepts or denies it and the marketing team gets a
-- notification." Campaigns are for events; the regular monthly content
-- "shouldn't need a whole campaign production").
--
-- WHAT IT ADDS
--   marketing_plans        one row per branch and month: the month's plan and
--                          the owner's decision on it.
--   marketing_plan_ideas   the plan's ideas, each on a day: a title, a kind
--                          (post, reel, story, poster, design, offer, event,
--                          other), a channel and the explanation.
--   marketing_content.idea_id
--                          a result sent for an approved idea is an ordinary
--                          content item (0199) pointing at the idea, so the
--                          owner's approve / changes / decline and the push to
--                          marketing are the ones that already exist.
--   the access area 'content' marketing's two operator pages, /plan and
--                          /posts, which the owner can take off a person's
--                          menu (0360's two lists, re-issued in section 11).
--
-- THE STATE MACHINE (one plan per branch and month)
--   draft    marketing is writing: ideas are added, edited and removed.
--   waiting  sent to the owner; marketing cannot edit until it takes the plan
--            back (take_back_marketing_plan) or the owner decides.
--   changes  the owner asked for changes (a note is optional: the owner never
--            needs a reason, 0361); marketing edits and sends again.
--   approved every idea that was proposed is approved or dropped.
--   Adding an idea to an approved plan puts it back to draft with only the new
--   idea proposed; the owner then decides the new ones alone. Removing the
--   last proposed idea of a plan the owner has decided before settles it back
--   to approved.
--
--   Idea: proposed -> approved | dropped (the owner, at the decision);
--   approved -> cancelled (marketing, while no live result is out for it).
--
-- WHO. Marketing at the branch writes; the owner decides and reads. Managers
-- have no read and no RPC, as for content (0199, §8 Q14). Both tables are
-- owner-only under RLS; marketing reads through app.marketing_plan.
--
-- PUSHES. notify_staff gains plan_submitted (to the owners), plan_approved
-- and plan_changes (to the branch's marketing team), route staff.
-- send-push (staffStrings.ts, _shared/staff-push.json) carries the strings
-- and deploys before this migration (deploy.yml's order).
--
-- covered by packages/db/tests/marketing-plan.test.ts
--
-- No new index: a month holds a few dozen ideas and a branch a few hundred
-- posts, so the unique (venue_id, month) key is the only one worth its lock.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The tables.
-- ---------------------------------------------------------------------------
create table if not exists marketing_plans (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  month         date not null,
  status        text not null default 'draft',
  sent_by       uuid references staff(id),
  sent_at       timestamptz,
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint marketing_plans_venue_month_key unique (venue_id, month),
  constraint marketing_plans_month_chk check (extract(day from month) = 1),
  constraint marketing_plans_status_chk check (status in ('draft','waiting','changes','approved')),
  constraint marketing_plans_sent_chk check ((sent_by is null) = (sent_at is null)),
  constraint marketing_plans_waiting_chk check (status <> 'waiting' or sent_by is not null),
  constraint marketing_plans_decided_chk check ((decided_by is null) = (decided_at is null)),
  constraint marketing_plans_note_chk check (decision_note is null or length(decision_note) <= 1000)
);

create table if not exists marketing_plan_ideas (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references marketing_plans(id) on delete cascade,
  venue_id    uuid not null references venues(id),
  day         date not null,
  title       text not null,
  kind        text not null default 'post',
  channel     text not null default 'instagram',
  details     text,
  status      text not null default 'proposed',
  drop_note   text,
  created_by  uuid not null references staff(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint marketing_plan_ideas_title_chk
    check (coalesce(length(btrim(title)),0) > 0 and length(title) <= 120),
  constraint marketing_plan_ideas_kind_chk
    check (kind in ('post','reel','story','poster','design','offer','event','other')),
  constraint marketing_plan_ideas_channel_chk
    check (channel in ('instagram','tiktok','facebook','snapchat','whatsapp',
                       'telegram','guest_site','in_venue','print','other')),
  constraint marketing_plan_ideas_details_chk check (details is null or length(details) <= 2000),
  constraint marketing_plan_ideas_status_chk check (status in ('proposed','approved','dropped','cancelled')),
  constraint marketing_plan_ideas_drop_note_chk check (drop_note is null or length(drop_note) <= 1000),
  constraint marketing_plan_ideas_decided_chk check ((status = 'proposed') = (decided_at is null))
);

alter table marketing_content add column if not exists idea_id uuid references marketing_plan_ideas(id) on delete set null;

-- 0230's guard on marketing_content, plus the idea link: a result names an
-- idea of its own branch.
drop trigger if exists zz_branch_guard on public.marketing_content;
create trigger zz_branch_guard before insert or update or delete on public.marketing_content
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id', 'marketing_campaigns', 'campaign_id', 'marketing_plan_ideas', 'idea_id');

comment on table marketing_plans is
  'marketing_plan (0362): marketing''s content plan for one branch and month, and the owner''s decision on it. draft, waiting (with the owner), changes (the owner asked for changes) or approved. Owner-only under RLS; marketing reads through app.marketing_plan.';
comment on column marketing_plans.id is 'Plan id.';
comment on column marketing_plans.venue_id is 'The branch.';
comment on column marketing_plans.month is 'The first day of the month the plan is for.';
comment on column marketing_plans.status is 'draft (marketing is writing), waiting (sent to the owner), changes (the owner asked for changes) or approved (every proposed idea decided).';
comment on column marketing_plans.sent_by is 'The marketing staff member who last sent it to the owner.';
comment on column marketing_plans.sent_at is 'When it was last sent to the owner.';
comment on column marketing_plans.decided_by is 'The owner who last decided it.';
comment on column marketing_plans.decided_at is 'When it was last decided.';
comment on column marketing_plans.decision_note is 'The owner''s note with the last decision (optional, at most 1000 characters).';
comment on column marketing_plans.created_at is 'When the first idea of the month was added.';
comment on column marketing_plans.updated_at is 'When the plan or one of its ideas last changed.';

comment on table marketing_plan_ideas is
  'marketing_plan (0362): one idea of a month''s content plan, on a day: what it is (title, kind, channel, explanation) and whether the owner approved it. A result for an approved idea is a marketing_content item with idea_id set.';
comment on column marketing_plan_ideas.id is 'Idea id.';
comment on column marketing_plan_ideas.plan_id is 'The month''s plan.';
comment on column marketing_plan_ideas.venue_id is 'The branch (the plan''s).';
comment on column marketing_plan_ideas.day is 'The day it is planned for, inside the plan''s month.';
comment on column marketing_plan_ideas.title is 'What it is, as typed (1 to 120 characters).';
comment on column marketing_plan_ideas.kind is 'post, reel, story, poster, design, offer, event or other.';
comment on column marketing_plan_ideas.channel is 'Where it goes: the content channels of 0199.';
comment on column marketing_plan_ideas.details is 'The explanation: the idea, filming notes, the offer (at most 2000 characters).';
comment on column marketing_plan_ideas.status is 'proposed (not decided yet), approved, dropped (by the owner) or cancelled (by marketing after approval).';
comment on column marketing_plan_ideas.drop_note is 'The owner''s note when dropping it (optional).';
comment on column marketing_plan_ideas.created_by is 'The marketing staff member who added it.';
comment on column marketing_plan_ideas.decided_at is 'When the owner approved or dropped it, or marketing cancelled it.';
comment on column marketing_plan_ideas.created_at is 'When it was added.';
comment on column marketing_plan_ideas.updated_at is 'When it last changed.';
comment on column marketing_content.idea_id is 'The plan idea (marketing_plan_ideas, 0362) this content is the result of, if any.';

alter table marketing_plans enable row level security;
alter table marketing_plan_ideas enable row level security;

-- Owner-only, as marketing_content (0199, §8 Q14).
drop policy if exists marketing_plans_owner_read on marketing_plans;
create policy marketing_plans_owner_read on marketing_plans
  for select to authenticated
  using ((select app.is_staff('owner')) and venue_id = any((select app.visible_venue_ids())::uuid[]));

drop policy if exists marketing_plan_ideas_owner_read on marketing_plan_ideas;
create policy marketing_plan_ideas_owner_read on marketing_plan_ideas
  for select to authenticated
  using ((select app.is_staff('owner')) and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on marketing_plans, marketing_plan_ideas to authenticated;
grant all on marketing_plans, marketing_plan_ideas to service_role;

drop trigger if exists zz_branch_guard on public.marketing_plans;
create trigger zz_branch_guard before insert or update or delete on public.marketing_plans
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.marketing_plan_ideas;
create trigger zz_branch_guard before insert or update or delete on public.marketing_plan_ideas
  for each row execute function app.trg_branch_guard('scoped', 'marketing_plans', 'plan_id');

-- ---------------------------------------------------------------------------
-- 2. Internal helpers.
-- ---------------------------------------------------------------------------

-- The branch a marketing write is for: the caller is marketing there.
create or replace function app.marketing_plan_venue(p_venue_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $marketing_plan_venue_0362$
declare
  v_venue uuid;
begin
  if not app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return v_venue;
end $marketing_plan_venue_0362$;

comment on function app.marketing_plan_venue(uuid) is
  'marketing_plan (0362), internal: the branch a marketing plan write is for (p_venue_id, else app.current_venue()), once the caller is marketing there. FORBIDDEN otherwise.';
revoke all on function app.marketing_plan_venue(uuid) from public, anon, authenticated;

-- Back to approved once nothing is left for the owner to decide, if the owner
-- has decided this plan before; a plan never decided stays a draft.
create or replace function app.marketing_plan_settle(p_plan uuid)
returns void
language plpgsql security definer set search_path = public as $marketing_plan_settle_0362$
begin
  update marketing_plans p
     set status = 'approved', updated_at = now()
   where p.id = p_plan
     and p.status in ('draft','changes')
     and p.decided_at is not null
     and not exists (select 1 from marketing_plan_ideas i where i.plan_id = p.id and i.status = 'proposed');
end $marketing_plan_settle_0362$;

comment on function app.marketing_plan_settle(uuid) is
  'marketing_plan (0362), internal: a draft or changes plan the owner has decided before, with no proposed idea left, is approved again.';
revoke all on function app.marketing_plan_settle(uuid) from public, anon, authenticated;

-- An approved idea has a live result while a content item for it waits, has
-- changes asked or was approved.
create or replace function app.marketing_idea_has_result(p_idea uuid)
returns boolean
language sql stable security definer set search_path = public as $marketing_idea_has_result_0362$
  select exists (select 1 from marketing_content c
                  where c.idea_id = p_idea and c.status in ('waiting','changes','approved'));
$marketing_idea_has_result_0362$;

comment on function app.marketing_idea_has_result(uuid) is
  'marketing_plan (0362), internal: whether a content item for the idea waits, has changes asked or was approved.';
revoke all on function app.marketing_idea_has_result(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.marketing_plan — marketing and the owners at the branch: one month.
-- ---------------------------------------------------------------------------
create or replace function app.marketing_plan(
  p_month    date default null,
  p_venue_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $marketing_plan_0362$
declare
  v_venue  uuid;
  v_owner  boolean;
  v_mkt    boolean;
  v_today  date;
  v_month  date;
  v_plan   marketing_plans%rowtype;
  v_ideas  jsonb;
  v_wait   jsonb;
  v_has    boolean := false;
begin
  if not app.is_staff('marketing','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_owner := app.is_staff_at(v_venue, 'owner');
  v_mkt   := app.is_staff_at(v_venue, 'marketing');
  v_today := app.venue_business_date(v_venue);
  v_month := date_trunc('month', coalesce(p_month, v_today))::date;

  select * into v_plan from marketing_plans where venue_id = v_venue and month = v_month;
  v_has := found;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              i.id,
           'day',             i.day,
           'title',           i.title,
           'kind',            i.kind,
           'channel',         i.channel,
           'details',         i.details,
           'status',          i.status,
           'drop_note',       i.drop_note,
           'created_by_name', s.display_name,
           'decided_at',      i.decided_at,
           'result',          r.result)
         order by i.day, i.created_at, i.id), '[]'::jsonb)
    into v_ideas
    from marketing_plan_ideas i
    left join staff s on s.id = i.created_by
    left join lateral (
      select jsonb_build_object('id', c.id, 'status', c.status, 'version', c.current_version,
                                'updated_at', c.updated_at) as result
        from marketing_content c
       where c.idea_id = i.id
       order by (c.status in ('waiting','changes','approved')) desc, c.created_at desc, c.id
       limit 1) r on true
   where v_has and i.plan_id = v_plan.id;

  select coalesce(jsonb_agg(p.month order by p.month), '[]'::jsonb)
    into v_wait
    from marketing_plans p
   where p.venue_id = v_venue and p.status = 'waiting';

  return jsonb_build_object(
    'month',  v_month,
    'today',  v_today,
    'plan',   case when v_has then jsonb_build_object(
                'id',              v_plan.id,
                'status',          v_plan.status,
                'sent_by_name',    (select display_name from staff where id = v_plan.sent_by),
                'sent_at',         v_plan.sent_at,
                'decided_by_name', (select display_name from staff where id = v_plan.decided_by),
                'decided_at',      v_plan.decided_at,
                'decision_note',   v_plan.decision_note,
                'updated_at',      v_plan.updated_at) end,
    'ideas',  v_ideas,
    'waiting_months', v_wait,
    'can_edit',      v_mkt and (not v_has or v_plan.status <> 'waiting'),
    'can_send',      v_mkt and v_has and v_plan.status in ('draft','changes')
                     and exists (select 1 from marketing_plan_ideas i where i.plan_id = v_plan.id and i.status = 'proposed'),
    'can_take_back', v_mkt and v_has and v_plan.status = 'waiting',
    'can_decide',    v_owner and v_has and v_plan.status = 'waiting'
                     and auth.uid() is distinct from v_plan.sent_by);
end $marketing_plan_0362$;

comment on function app.marketing_plan(date, uuid) is
  'marketing_plan (0362). Marketing and the owners at the branch: one month''s content plan. p_month is any day of the month (default the branch''s business month). {month, today (the branch''s business date), plan: {id, status, sent_by_name, sent_at, decided_by_name, decided_at, decision_note, updated_at} or null, ideas: [{id, day, title, kind, channel, details, status, drop_note, created_by_name, decided_at, result: {id, status, version, updated_at} (its live content item, else the newest) or null}] by day, waiting_months: [months with a plan waiting on the owner], can_edit, can_send, can_take_back, can_decide}. Never a manager (§8 Q14). FORBIDDEN for anyone else.';
revoke all on function app.marketing_plan(date, uuid) from public, anon;
grant execute on function app.marketing_plan(date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.save_plan_idea — marketing adds an idea on one or more days of a
--    month (a weekly idea in one go), or edits a proposed one.
-- ---------------------------------------------------------------------------
create or replace function app.save_plan_idea(
  p_id              uuid,
  p_days            date[],
  p_title           text,
  p_kind            text default 'post',
  p_channel         text default 'instagram',
  p_details         text default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $save_plan_idea_0362$
declare
  v_venue   uuid;
  v_replay  jsonb;
  v_title   text := nullif(btrim(coalesce(p_title, '')), '');
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_days    date[];
  v_month   date;
  v_today   date;
  v_plan    marketing_plans%rowtype;
  v_idea    marketing_plan_ideas%rowtype;
  v_ids     uuid[];
  v_result  jsonb;
begin
  v_venue := app.marketing_plan_venue(p_venue_id);
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'save_plan_idea');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_title is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'title';
  end if;
  if length(v_title) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'title';
  end if;
  if length(v_details) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'details';
  end if;
  if p_kind is null or p_kind not in ('post','reel','story','poster','design','offer','event','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_channel is null or p_channel not in ('instagram','tiktok','facebook','snapchat','whatsapp',
                                            'telegram','guest_site','in_venue','print','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'channel';
  end if;

  -- Once each, in day order; one month; none before the branch's today.
  v_days := coalesce(array(select distinct d from unnest(coalesce(p_days, '{}'::date[])) d
                            where d is not null order by d), '{}'::date[]);
  v_today := app.venue_business_date(v_venue);
  if cardinality(v_days) = 0 or cardinality(v_days) > 31
     or (p_id is not null and cardinality(v_days) <> 1)
     or (select count(distinct date_trunc('month', d)) from unnest(v_days) d) <> 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'days';
  end if;
  if v_days[1] < v_today then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'day_past';
  end if;
  v_month := date_trunc('month', v_days[1])::date;

  if p_id is null then
    insert into marketing_plans (venue_id, month) values (v_venue, v_month)
    on conflict (venue_id, month) do nothing;
  else
    select * into v_idea from marketing_plan_ideas where id = p_id;
    if not found or v_idea.venue_id <> v_venue then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
    end if;
    if date_trunc('month', v_idea.day)::date <> v_month then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'days';
    end if;
  end if;

  select * into v_plan from marketing_plans where venue_id = v_venue and month = v_month for update;
  if v_plan.status = 'waiting' then
    raise exception 'PLAN_WAITING' using errcode = 'P0001';
  end if;

  if p_id is null then
    with ins as (
      insert into marketing_plan_ideas (plan_id, venue_id, day, title, kind, channel, details, created_by)
      select v_plan.id, v_venue, d, v_title, p_kind, p_channel, v_details, auth.uid()
        from unnest(v_days) d
      returning id)
    select array_agg(id) into v_ids from ins;
    -- New ideas on a decided plan wait for their own decision.
    update marketing_plans
       set status = case when status = 'approved' then 'draft' else status end, updated_at = now()
     where id = v_plan.id
     returning * into v_plan;
    perform app.write_audit('marketing.plan.idea_add', 'marketing_plans', v_plan.id::text, null,
                            jsonb_build_object('month', v_month, 'ideas', cardinality(v_ids), 'kind', p_kind));
  else
    select * into v_idea from marketing_plan_ideas where id = p_id for update;
    if v_idea.status <> 'proposed' then
      raise exception 'IDEA_LOCKED' using errcode = 'P0001';
    end if;
    update marketing_plan_ideas
       set day = v_days[1], title = v_title, kind = p_kind, channel = p_channel,
           details = v_details, updated_at = now()
     where id = p_id;
    update marketing_plans set updated_at = now() where id = v_plan.id returning * into v_plan;
    v_ids := array[p_id];
    perform app.write_audit('marketing.plan.idea_edit', 'marketing_plan_ideas', p_id::text,
                            jsonb_build_object('day', v_idea.day), jsonb_build_object('day', v_days[1]));
  end if;

  v_result := jsonb_build_object('ids', to_jsonb(v_ids), 'plan_id', v_plan.id, 'plan_status', v_plan.status);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $save_plan_idea_0362$;

comment on function app.save_plan_idea(uuid, date[], text, text, text, text, uuid, text) is
  'marketing_plan (0362). Marketing at the branch. p_id NULL: adds the idea on every day of p_days (1 to 31 days of one month, none before the branch''s business date), creating the month''s plan if needed; an approved plan goes back to draft so the owner decides the new ones. p_id set: edits that proposed idea (one day, same month). Title 1 to 120, kind post/reel/story/poster/design/offer/event/other, a 0199 channel, details up to 2000. Not while the plan waits on the owner. Returns {ids, plan_id, plan_status}. Idempotent by key. FORBIDDEN, TEXT_REQUIRED (hint title), TEXT_TOO_LONG (hint title or details), INVALID_ARGUMENT (hint kind, channel, days or day_past), REF_NOT_FOUND, PLAN_WAITING, IDEA_LOCKED. Audit marketing.plan.idea_add {month, ideas, kind} / marketing.plan.idea_edit {day}.';
revoke all on function app.save_plan_idea(uuid, date[], text, text, text, text, uuid, text) from public, anon;
grant execute on function app.save_plan_idea(uuid, date[], text, text, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.remove_plan_idea — marketing removes a proposed idea, or cancels an
--    approved one that has no live result.
-- ---------------------------------------------------------------------------
create or replace function app.remove_plan_idea(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $remove_plan_idea_0362$
declare
  v_idea marketing_plan_ideas%rowtype;
  v_plan marketing_plans%rowtype;
  v_out  text;
begin
  if not app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_idea from marketing_plan_ideas where id = p_id;
  if not found or not (v_idea.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_idea.venue_id, 'marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_idea.venue_id::text, true);

  select * into v_plan from marketing_plans where id = v_idea.plan_id for update;
  select * into v_idea from marketing_plan_ideas where id = p_id for update;
  if v_plan.status = 'waiting' then
    raise exception 'PLAN_WAITING' using errcode = 'P0001';
  end if;

  if v_idea.status = 'proposed' then
    delete from marketing_plan_ideas where id = p_id;
    v_out := 'removed';
  elsif v_idea.status = 'approved' and not app.marketing_idea_has_result(p_id) then
    update marketing_plan_ideas set status = 'cancelled', decided_at = now(), updated_at = now() where id = p_id;
    v_out := 'cancelled';
  else
    raise exception 'IDEA_LOCKED' using errcode = 'P0001';
  end if;

  update marketing_plans set updated_at = now() where id = v_plan.id;
  perform app.marketing_plan_settle(v_plan.id);
  perform app.write_audit('marketing.plan.idea_' || v_out, 'marketing_plan_ideas', p_id::text,
                          jsonb_build_object('status', v_idea.status, 'day', v_idea.day), null);

  return jsonb_build_object('status', v_out,
                            'plan_status', (select status from marketing_plans where id = v_plan.id));
end $remove_plan_idea_0362$;

comment on function app.remove_plan_idea(uuid) is
  'marketing_plan (0362). Marketing at the idea''s branch: a proposed idea is deleted; an approved one with no live result (no content item for it waiting, with changes asked or approved) is cancelled. Not while the plan waits on the owner. A plan the owner decided before with no proposed idea left is approved again. Returns {status: removed | cancelled, plan_status}. FORBIDDEN, REF_NOT_FOUND, PLAN_WAITING, IDEA_LOCKED. Audit marketing.plan.idea_removed / idea_cancelled {status, day}.';
revoke all on function app.remove_plan_idea(uuid) from public, anon;
grant execute on function app.remove_plan_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.send_marketing_plan / app.take_back_marketing_plan — marketing sends
--    the month to the owner, or takes it back to edit.
-- ---------------------------------------------------------------------------
create or replace function app.send_marketing_plan(p_month date, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $send_marketing_plan_0362$
declare
  v_venue uuid;
  v_plan  marketing_plans%rowtype;
  v_n     int;
begin
  v_venue := app.marketing_plan_venue(p_venue_id);
  perform set_config('app.venue_id', v_venue::text, true);
  if p_month is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month';
  end if;
  select * into v_plan from marketing_plans
   where venue_id = v_venue and month = date_trunc('month', p_month)::date for update;
  if not found then
    raise exception 'PLAN_EMPTY' using errcode = 'P0001';
  end if;
  if v_plan.status not in ('draft','changes') then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  select count(*) into v_n from marketing_plan_ideas where plan_id = v_plan.id and status = 'proposed';
  if v_n = 0 then
    raise exception 'PLAN_EMPTY' using errcode = 'P0001';
  end if;

  update marketing_plans
     set status = 'waiting', sent_by = auth.uid(), sent_at = now(), updated_at = now()
   where id = v_plan.id
   returning * into v_plan;

  perform app.write_audit('marketing.plan.send', 'marketing_plans', v_plan.id::text, null,
                          jsonb_build_object('status', 'waiting', 'month', v_plan.month, 'ideas', v_n));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['owner'::staff_role]),
    'staff_decide',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'plan_submitted',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                   'title', to_char(v_plan.month, 'MM/YYYY'))),
    'plan:' || v_plan.id::text);

  return jsonb_build_object('status', v_plan.status, 'ideas', v_n);
end $send_marketing_plan_0362$;

comment on function app.send_marketing_plan(date, uuid) is
  'marketing_plan (0362). Marketing at the branch sends the month''s plan (draft or changes, with at least one proposed idea) to the owner: waiting. Tells the owners (staff_decide / plan_submitted, the sender''s name and the month as MM/YYYY; dedupe plan:<id>). Returns {status, ideas: proposed count}. FORBIDDEN, INVALID_ARGUMENT (hint month), PLAN_EMPTY, SUBMISSION_DECIDED (already waiting or approved). Audit marketing.plan.send {status, month, ideas}.';
revoke all on function app.send_marketing_plan(date, uuid) from public, anon;
grant execute on function app.send_marketing_plan(date, uuid) to authenticated;

create or replace function app.take_back_marketing_plan(p_month date, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $take_back_marketing_plan_0362$
declare
  v_venue uuid;
  v_plan  marketing_plans%rowtype;
begin
  v_venue := app.marketing_plan_venue(p_venue_id);
  perform set_config('app.venue_id', v_venue::text, true);
  select * into v_plan from marketing_plans
   where venue_id = v_venue and month = date_trunc('month', coalesce(p_month, '-infinity'::date))::date for update;
  if not found then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'month';
  end if;
  if v_plan.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  update marketing_plans set status = 'draft', updated_at = now() where id = v_plan.id;
  perform app.write_audit('marketing.plan.take_back', 'marketing_plans', v_plan.id::text,
                          jsonb_build_object('status', 'waiting'), jsonb_build_object('status', 'draft'));
  return jsonb_build_object('status', 'draft');
end $take_back_marketing_plan_0362$;

comment on function app.take_back_marketing_plan(date, uuid) is
  'marketing_plan (0362). Marketing at the branch takes a waiting plan back to draft to edit it before the owner decides. No push. Returns {status: draft}. FORBIDDEN, REF_NOT_FOUND (hint month), SUBMISSION_DECIDED (the owner already decided). Audit marketing.plan.take_back.';
revoke all on function app.take_back_marketing_plan(date, uuid) from public, anon;
grant execute on function app.take_back_marketing_plan(date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.decide_marketing_plan — the owner approves the waiting plan (every
--    proposed idea but the ones dropped) or asks for changes. A note is
--    optional either way: the owner never needs a reason (0361).
-- ---------------------------------------------------------------------------
create or replace function app.decide_marketing_plan(
  p_id       uuid,
  p_decision text,
  p_note     text   default null,
  p_drop     uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $decide_marketing_plan_0362$
declare
  v_plan     marketing_plans%rowtype;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_drop     uuid[] := coalesce(p_drop, '{}'::uuid[]);
  v_approved int := 0;
  v_dropped  int := 0;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_plan from marketing_plans where id = p_id for update;
  if not found or not (v_plan.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_plan.venue_id, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_plan.venue_id::text, true);
  if p_decision is null or p_decision not in ('approve','changes') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'decision';
  end if;
  if v_plan.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if auth.uid() = v_plan.sent_by then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if p_decision = 'changes' and cardinality(v_drop) > 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'drop';
  end if;
  if exists (select 1 from unnest(v_drop) d
              where not exists (select 1 from marketing_plan_ideas i
                                 where i.id = d and i.plan_id = p_id and i.status = 'proposed')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'drop';
  end if;

  if p_decision = 'approve' then
    update marketing_plan_ideas
       set status = case when id = any(v_drop) then 'dropped' else 'approved' end,
           drop_note = case when id = any(v_drop) then v_note end,
           decided_at = now(), updated_at = now()
     where plan_id = p_id and status = 'proposed';
    select count(*) filter (where status = 'approved' and decided_at = now()),
           count(*) filter (where status = 'dropped' and decided_at = now())
      into v_approved, v_dropped
      from marketing_plan_ideas where plan_id = p_id;
  end if;

  update marketing_plans
     set status = case p_decision when 'approve' then 'approved' else 'changes' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now()
   where id = p_id
   returning * into v_plan;

  perform app.write_audit('marketing.plan.' || p_decision, 'marketing_plans', p_id::text,
                          jsonb_build_object('status', 'waiting'),
                          jsonb_build_object('status', v_plan.status, 'approved', v_approved, 'dropped', v_dropped));

  perform app.notify_staff(
    array(select distinct x from unnest(
      app.staff_ids_with_roles(v_plan.venue_id, array['marketing'::staff_role])
      || array[v_plan.sent_by]) x where x is not null),
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', case p_decision when 'approve' then 'plan_approved' else 'plan_changes' end,
      'params', jsonb_build_object('title', to_char(v_plan.month, 'MM/YYYY'))));

  return jsonb_build_object('status', v_plan.status, 'approved', v_approved, 'dropped', v_dropped);
end $decide_marketing_plan_0362$;

comment on function app.decide_marketing_plan(uuid, text, text, uuid[]) is
  'marketing_plan (0362). The owner at the plan''s branch decides a waiting plan: approve (every proposed idea approved, the ones in p_drop dropped, which must be proposed ideas of this plan) or changes (no drops). The note (up to 1000) is optional either way and is kept on the plan and on the dropped ideas. Tells the branch''s marketing team and the sender (staff_decided / plan_approved or plan_changes, the month as MM/YYYY). Returns {status, approved, dropped}. FORBIDDEN, REF_NOT_FOUND, INVALID_ARGUMENT (hint decision or drop), SUBMISSION_DECIDED (not waiting), CANNOT_DECIDE_OWN, TEXT_TOO_LONG (hint note). Audit marketing.plan.approve / .changes {status, approved, dropped}.';
revoke all on function app.decide_marketing_plan(uuid, text, text, uuid[]) from public, anon;
grant execute on function app.decide_marketing_plan(uuid, text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.submit_content — 0199's body, plus p_idea_id: the result of an
--    approved plan idea of the same branch that has no live result yet.
-- ---------------------------------------------------------------------------
drop function if exists app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text);

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
  p_idempotency_key text   default null,
  p_idea_id         uuid   default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_content_0362$
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
  if p_idea_id is not null then
    -- The idea row first, so two sends for one idea queue up here.
    perform 1 from marketing_plan_ideas i where i.id = p_idea_id and i.venue_id = v_venue for update;
    if not found then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'idea';
    end if;
    if (select status from marketing_plan_ideas where id = p_idea_id) <> 'approved' then
      raise exception 'IDEA_LOCKED' using errcode = 'P0001';
    end if;
    if app.marketing_idea_has_result(p_idea_id) then
      raise exception 'IDEA_HAS_RESULT' using errcode = 'P0001';
    end if;
  end if;

  insert into marketing_content (venue_id, author_id, title, channel, planned_for, menu_item_id, campaign_id, idea_id)
  values (v_venue, auth.uid(), v_title, p_channel, p_planned_for, p_menu_item_id, p_campaign_id, p_idea_id)
  returning id into v_id;
  insert into marketing_content_versions (content_id, version, body, images, media_link, note, submitted_by)
  values (v_id, 1, v_body, v_images, v_link, v_note, auth.uid());

  perform app.claim_staff_media(v_images, v_venue, array['campaigns'], 'marketing_content:' || v_id::text);

  perform app.write_audit('marketing.content.submit', 'marketing_content', v_id::text, null,
                          jsonb_build_object('status', 'waiting', 'version', 1, 'channel', p_channel,
                                             'images', cardinality(v_images))
                          || case when p_idea_id is null then '{}'::jsonb
                                  else jsonb_build_object('idea', p_idea_id) end);

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['owner'::staff_role]),
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
end $submit_content_0362$;

comment on function app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text, uuid) is
  'marketing_content (wave5-addendum §2.7.2), re-issued by marketing_plan (0362) with p_idea_id. Marketing at the venue sends a content item for the owners'' approval: a title (1 to 120), a channel, a planned day not before the venue''s business date, a caption (1 to 4000), up to 10 images in the campaigns folder, an optional https:// link (500) and note (1000), an optional menu item or campaign of the venue, and optionally the approved plan idea of the venue it is the result of (one live result per idea). Tells the owners (staff_decide / content_submitted, the author''s name and the title; dedupe content:<id>). Returns {id, version: 1, status: waiting}. Idempotent by key. FORBIDDEN, TEXT_REQUIRED (hint title or body), TEXT_TOO_LONG (hint title, body or note), INVALID_ARGUMENT (hint channel, planned_for, media_link or images), ITEM_NOT_FOUND, CAMPAIGN_NOT_FOUND, REF_NOT_FOUND (hint idea), IDEA_LOCKED (the idea is not approved), IDEA_HAS_RESULT, PHOTO_PATH_INVALID. Audit marketing.content.submit {status, version, channel, images: n, idea (the idea id, only when there is one)}.';

revoke all on function app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function app.submit_content(text, text, date, text, text[], text, text, uuid, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.notify_staff — 0333 verbatim, plus plan_submitted, plan_approved and
--    plan_changes after reward_unlocked.
-- ---------------------------------------------------------------------------
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0362$
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
    'loyalty_gift', 'screenshot_taken', 'shop_price_changed', 'checklist_due',
    'checklist_overdue', 'reward_unlocked', 'plan_submitted', 'plan_approved',
    'plan_changes'];
  c_routes     constant text[] := array[
    'staff', 'staff-step', 'staff-run', 'staff-request', 'staff-shopping',
    'staff-checklist', 'staff-notes', 'staff-rewards'];
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
end $notify_staff_0362$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1), staff_push_keys_wave5, match_guest_rpcs (0261, match_report_new), loyalty_earn_redeem (0308, loyalty_gift), staff_screenshot_report (0313, screenshot_taken), shop_price_watch (0322, shop_price_changed), checklist_schedules (0323, checklist_due and checklist_overdue), reward_wages (0333, reward_unlocked and the route staff-rewards) and marketing_plan (0362, plan_submitted, plan_approved and plan_changes). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Owner assistant: marketing_plans and marketing_plan_ideas are a
--     content calendar (titles, kinds, channels, days and statuses), no guest
--     data: table_read, with readable-column rows for their own columns.
--     details stays out of the default set (free text, unpublished).
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur', 'details', 'decision_note',
                              'drop_note')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('marketing_plans', 'marketing_plan_ideas')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;

-- The new marketing_content column joins its table's readable set.
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select 'marketing_content', 'idea_id', 'table', true, 'uuid', c.ordinal_position,
       col_description('public.marketing_content'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'marketing_content' and c.column_name = 'idea_id'
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 11. The access area 'content' (/plan and /posts): 0360's two lists,
--     re-issued with it after 'insights'.
-- ---------------------------------------------------------------------------
-- 0360's CHECK, dropped only while it still lacks 'content', so a re-run is a no-op.
do $staff_blocked_areas_chk_drop_0362$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_blocked_areas_chk'
                and conrelid = 'public.staff'::regclass
                and pg_get_constraintdef(oid) not like '%''content''%') then
    alter table staff drop constraint staff_blocked_areas_chk;
  end if;
end $staff_blocked_areas_chk_drop_0362$;

do $staff_blocked_areas_chk_0362$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'staff_blocked_areas_chk'
                    and conrelid = 'public.staff'::regclass) then
    alter table staff add constraint staff_blocked_areas_chk
      check (blocked_areas <@ array['till', 'desk', 'customers', 'tournaments', 'kds',
                                    'shop', 'tasks', 'insights', 'content', 'incidents', 'ops', 'stock', 'admin',
                                    'reports', 'protocols', 'suggestions', 'deductions',
                                    'attendance']::text[]
             and cardinality(blocked_areas) <= 18) not valid;
  end if;
end $staff_blocked_areas_chk_0362$;

do $staff_blocked_areas_chk_validate_0362$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_blocked_areas_chk'
                and conrelid = 'public.staff'::regclass
                and not convalidated) then
    alter table staff validate constraint staff_blocked_areas_chk;
  end if;
end $staff_blocked_areas_chk_validate_0362$;

create or replace function app.set_staff_access(
  p_staff_id      uuid,
  p_extra_roles   staff_role[],
  p_blocked_areas text[]
) returns jsonb
language plpgsql security definer set search_path = public as $set_staff_access_0362$
declare
  v_before staff%rowtype;
  v_after  staff%rowtype;
  v_extra  staff_role[];
  v_block  text[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must change your own access';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_before.role = 'owner' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      hint = 'an owner opens everything';
  end if;

  -- Sorted and once each, without the main role: the row reads the same
  -- however the boxes were ticked, and an audit diff shows only real changes.
  select coalesce(array_agg(distinct r order by r), '{}'::staff_role[]) into v_extra
    from unnest(coalesce(p_extra_roles, '{}'::staff_role[])) r
   where r is not null and r <> v_before.role;
  select coalesce(array_agg(distinct a order by a), '{}'::text[]) into v_block
    from unnest(coalesce(p_blocked_areas, '{}'::text[])) a
   where a is not null;

  if not (v_extra <@ array['cashier', 'waiter', 'court_desk', 'shop_staff',
                           'barista', 'chef', 'driver', 'marketing']::staff_role[]) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'extra_roles';
  end if;
  if not (v_block <@ array['till', 'desk', 'customers', 'tournaments', 'kds',
                           'shop', 'tasks', 'insights', 'content', 'incidents', 'ops', 'stock', 'admin',
                           'reports', 'protocols', 'suggestions', 'deductions',
                           'attendance']::text[]) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocked_areas';
  end if;

  update staff
     set extra_roles   = v_extra,
         blocked_areas = v_block
   where id = p_staff_id
   returning * into v_after;

  perform app.write_audit('staff.access_set', 'staff', p_staff_id::text,
                          jsonb_build_object('extra_roles', v_before.extra_roles,
                                             'blocked_areas', v_before.blocked_areas),
                          jsonb_build_object('extra_roles', v_after.extra_roles,
                                             'blocked_areas', v_after.blocked_areas),
                          null);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'extra_roles', v_after.extra_roles,
                            'blocked_areas', v_after.blocked_areas);
end $set_staff_access_0362$;
