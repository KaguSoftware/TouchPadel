-- 0028_modifier_reveals — conditional modifier groups (UpperDeck parity), ONE
-- level deep.
--
-- A "reveal" says: when the guest picks modifier M (e.g. "Make it a meal"),
-- modifier group G (e.g. "Pick a drink") becomes active for that line — it is
-- shown, its min/max applies, and its modifiers become orderable. G itself
-- need not be linked to the item through menu_item_modifier_groups; it is a
-- pure reveal target. A group whose revealing option is NOT chosen is simply
-- inactive for that line.
--
-- Depth is strictly ONE level (db-slice.md "Reveals depth"):
--   * a modifier may reveal groups, and
--   * a group that is a reveal target may not contain modifiers that reveal
--     anything themselves,
--   * a modifier whose own group is a reveal target may not reveal anything.
-- Both directions are refused at write time (REVEAL_DEPTH) by
-- app.set_modifier_reveals, which is the ONLY writer (no client grants on the
-- table), so depth <= 1 is a global invariant. The order validator (0030) and
-- the guest UI can therefore both be one-level: "active groups" for a line =
-- linked groups UNION groups revealed by a chosen modifier from a linked group
-- — exposed here as app.item_active_groups() for both to reuse.
--
-- Belt trigger app.trg_modifier_reveals_guard refuses a modifier revealing
-- its own group (REVEAL_SELF) even if a future writer bypasses the RPC.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table modifier_reveals (
  modifier_id uuid not null references modifiers(id) on delete cascade,
  group_id    uuid not null references modifier_groups(id) on delete cascade,
  sort_order  int  not null default 0,          -- position in the revealing modifier's list
  primary key (modifier_id, group_id)
);

create index modifier_reveals_group on modifier_reveals (group_id);

comment on table modifier_reveals is
  'Conditional modifier groups: choosing modifier_id activates group_id for that order line. Depth is one level (enforced by app.set_modifier_reveals). RPC-only writes.';

-- ---------------------------------------------------------------------------
-- Belt trigger — a modifier may never reveal the group it belongs to.
-- ---------------------------------------------------------------------------
create or replace function app.trg_modifier_reveals_guard() returns trigger
language plpgsql security definer set search_path = public as $guard$
begin
  if new.group_id = (select group_id from modifiers where id = new.modifier_id) then
    raise exception 'REVEAL_SELF' using errcode = 'P0001';
  end if;
  return new;
end $guard$;

create trigger modifier_reveals_guard
  before insert or update on modifier_reveals
  for each row execute function app.trg_modifier_reveals_guard();

revoke all on function app.trg_modifier_reveals_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.set_modifier_reveals — replace a modifier's reveal list wholesale
-- (array order = sort_order, 0-based; duplicates in the array are ignored,
-- first occurrence wins). manager|owner, audited 'menu.modifier.reveals'.
--
-- Errors (all pre-checked, never surfaced as FK/PK failures):
--   FORBIDDEN            caller is not manager|owner
--   MODIFIER_NOT_FOUND   p_modifier_id unknown
--   GROUP_NOT_FOUND      any id in p_group_ids unknown (or null)
--   REVEAL_SELF          a target group is the modifier's own group
--   REVEAL_DEPTH         (a) a target group contains a modifier that itself
--                            has reveals, or
--                        (b) the revealing modifier's own group is a reveal
--                            target anywhere
-- Depth checks only apply when the new list is non-empty: clearing a
-- modifier's reveals must always be possible (it only reduces depth).
-- ---------------------------------------------------------------------------
create or replace function app.set_modifier_reveals(
  p_modifier_id uuid,
  p_group_ids   uuid[]
) returns void
language plpgsql security definer set search_path = public as $reveals$
declare
  v_own_group uuid;
  v_ids       uuid[];
  v_before    uuid[];
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Serialise reveal writers: the depth invariant is checked against OTHER
  -- modifiers' rows, so two concurrent edits must not both pass their
  -- pre-checks. Readers are never blocked; writes are rare admin edits.
  lock table modifier_reveals in share row exclusive mode;

  select group_id into v_own_group from modifiers where id = p_modifier_id for update;
  if not found then
    raise exception 'MODIFIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Dedupe, keeping the first position of each id (that position = sort_order).
  select coalesce(array_agg(d.id order by d.ord), '{}')
    into v_ids
    from (
      select distinct on (s.id) s.id, s.ord
        from unnest(coalesce(p_group_ids, '{}')) with ordinality as s(id, ord)
       order by s.id, s.ord
    ) d;

  if exists (
       select 1 from unnest(v_ids) as g(id)
        where g.id is null
           or not exists (select 1 from modifier_groups mg where mg.id = g.id)
     ) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_own_group = any (v_ids) then
    raise exception 'REVEAL_SELF' using errcode = 'P0001';
  end if;

  if cardinality(v_ids) > 0 then
    -- (a) a target group already contains a revealing modifier -> would be depth 2.
    if exists (
         select 1
           from modifier_reveals r
           join modifiers m on m.id = r.modifier_id
          where m.group_id = any (v_ids)
       ) then
      raise exception 'REVEAL_DEPTH' using errcode = 'P0001',
        detail = 'a target group contains a modifier that has reveals of its own';
    end if;
    -- (b) this modifier's own group is itself revealed somewhere -> would be depth 2.
    if exists (select 1 from modifier_reveals where group_id = v_own_group) then
      raise exception 'REVEAL_DEPTH' using errcode = 'P0001',
        detail = 'the revealing modifier belongs to a group that is itself a reveal target';
    end if;
  end if;

  select coalesce(array_agg(group_id order by sort_order, group_id), '{}')
    into v_before
    from modifier_reveals where modifier_id = p_modifier_id;

  delete from modifier_reveals where modifier_id = p_modifier_id;

  insert into modifier_reveals (modifier_id, group_id, sort_order)
  select p_modifier_id, s.id, s.ord - 1
    from unnest(v_ids) with ordinality as s(id, ord);

  perform app.write_audit('menu.modifier.reveals', 'modifier_reveals', p_modifier_id::text,
                          jsonb_build_object('modifier_id', p_modifier_id,
                                             'group_id', v_own_group,
                                             'reveals', to_jsonb(v_before)),
                          jsonb_build_object('modifier_id', p_modifier_id,
                                             'group_id', v_own_group,
                                             'reveals', to_jsonb(v_ids)));
end $reveals$;

revoke all on function app.set_modifier_reveals(uuid, uuid[]) from public, anon;
grant execute on function app.set_modifier_reveals(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- app.item_active_groups — the set of modifier groups that are ACTIVE for one
-- order line of item p_item_id given the modifiers chosen on that line:
--
--   linked groups (menu_item_modifier_groups for the item)
--   UNION
--   groups revealed by any chosen modifier whose OWN group is linked to the item
--
-- One level by construction (a revealed group's modifiers never reveal — see
-- the header). Chosen ids that are unknown, inactive, or from an unlinked group
-- reveal nothing; whether such a choice is itself valid is the caller's rule
-- (0030: a chosen modifier must be active and belong to an active group).
-- Intended callers: app.add_order_items (0030) for MODIFIER_INVALID /
-- MODIFIER_SELECTION, and clients that want the server's view of which groups
-- to render / enforce min-max on. Read-only helper: ids only, nothing
-- sensitive, so authenticated (incl. anonymous-auth guests) may execute it.
-- ---------------------------------------------------------------------------
create or replace function app.item_active_groups(
  p_item_id             uuid,
  p_chosen_modifier_ids uuid[]
) returns setof uuid
language sql stable security definer set search_path = public as $active$
  select l.group_id
    from menu_item_modifier_groups l
   where l.item_id = p_item_id
  union
  select r.group_id
    from modifier_reveals r
    join modifiers m on m.id = r.modifier_id
    join menu_item_modifier_groups l on l.item_id = p_item_id and l.group_id = m.group_id
   where r.modifier_id = any (coalesce(p_chosen_modifier_ids, '{}'))
$active$;

revoke all on function app.item_active_groups(uuid, uuid[]) from public, anon;
grant execute on function app.item_active_groups(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS: public-readable link table (names + ids only, nothing
-- sensitive — same posture as menu_item_modifier_groups); writes RPC-only.
-- ---------------------------------------------------------------------------
alter table modifier_reveals enable row level security;

grant select on modifier_reveals to anon, authenticated;

create policy modifier_reveals_read on modifier_reveals
  for select to anon, authenticated using (true);
