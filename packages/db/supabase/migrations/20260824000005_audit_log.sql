-- 0005_audit_log — append-only audit trail + app.write_audit helper.
-- Two independent append-only layers (design-data.md §3.4):
--   1. privileges — clients never receive UPDATE/DELETE
--   2. trigger    — catches table owners / definer bugs / future grant mistakes

create table audit_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_id      uuid,                          -- staff or guest auth.uid()
  actor_role    text,
  authorizer_id uuid,                          -- who entered the PIN, when escalated
  action        text not null,                 -- 'discount.apply','reservation.move',...
  entity        text not null,
  entity_id     text not null,
  before        jsonb,
  after         jsonb,
  reason_code   text,                          -- required for discounts/voids/overrides (enforced in RPCs)
  device_id     text
);

create index audit_log_entity on audit_log (entity, entity_id);
create index audit_log_at on audit_log (at desc);

-- Layer 2: statement-level guard.
create trigger audit_log_ao
  before update or delete on audit_log
  for each statement execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- app.write_audit — the single insert path, called from other SECURITY DEFINER
-- RPCs (executes as the function owner; clients cannot call it).
-- ---------------------------------------------------------------------------
create or replace function app.write_audit(
  p_action        text,
  p_entity        text,
  p_entity_id     text,
  p_before        jsonb default null,
  p_after         jsonb default null,
  p_reason_code   text default null,
  p_authorizer_id uuid default null,
  p_device_id     text default null
) returns void
language sql security definer set search_path = public as $$
  insert into audit_log
    (actor_id, actor_role, authorizer_id, action, entity, entity_id,
     before, after, reason_code, device_id)
  values
    (auth.uid(),
     coalesce(app.staff_role()::text, case when auth.uid() is not null then 'guest' end),
     p_authorizer_id, p_action, p_entity, p_entity_id,
     p_before, p_after, p_reason_code, p_device_id);
$$;

revoke all on function app.write_audit(text, text, text, jsonb, jsonb, text, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS: manager/owner may read; nobody mutates; inserts happen only
-- inside definer functions.
-- ---------------------------------------------------------------------------
alter table audit_log enable row level security;

grant select on audit_log to authenticated;

create policy audit_log_select_mgmt on audit_log for select to authenticated
  using (app.is_staff('manager','owner'));
