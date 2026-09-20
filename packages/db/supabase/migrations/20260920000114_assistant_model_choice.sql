-- 0114_assistant_model_choice — the owner chooses the chat model per chat, with
-- a venue-wide default (owner call, 2026-09-20: "let him choose between Opus
-- and Sonnet").
--
-- WHERE THE CHOICE LIVES. Two places, one rule:
--   * venue_settings.llm_default_model — what a new chat uses when it says
--     nothing. Set once on the usage page.
--   * assistant_conversations.model — this chat's override, or NULL to follow
--     the default. Changing it mid-chat is allowed; the next answer uses it and
--     every assistant_calls row already records which model priced it.
-- A model is legal only when venue_settings.llm_pricing carries its four rates,
-- so the spend cap can never bill a model it cannot price. The edge functions
-- read both columns through the service client and never trust a model name
-- from the request without this check (app.assistant_model_allowed).
--
-- Catalog-only changes: two nullable/defaulted columns, no rewrite, no index.

set lock_timeout = '3s';
set statement_timeout = '60s';

alter table venue_settings
  add column if not exists llm_default_model text not null default 'claude-opus-5';

comment on column venue_settings.llm_default_model is
  '0114. The chat model a new assistant conversation uses unless it names one. Must be a key of llm_pricing. Set by app.assistant_set_default_model.';

alter table assistant_conversations
  add column if not exists model text;

comment on column assistant_conversations.model is
  '0114. This chat''s model, or NULL to follow venue_settings.llm_default_model. Must be a key of llm_pricing. Set by app.assistant_set_model; the edge function resolves the effective model per answer and stamps it on every assistant_calls row.';

-- ---------------------------------------------------------------------------
-- The one rule: a model is legal when it is priced.
-- ---------------------------------------------------------------------------
create or replace function app.assistant_model_allowed(p_model text)
returns boolean
language sql stable security definer set search_path = public as $assistant_model_allowed_0114$
  select p_model is not null
     and exists (select 1 from venue_settings vs where vs.llm_pricing ? p_model)
$assistant_model_allowed_0114$;

comment on function app.assistant_model_allowed(text) is
  '0114. True when venue_settings.llm_pricing has rates for the model — the only test the assistant applies to a model name.';

revoke all on function app.assistant_model_allowed(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.assistant_models — what the switch offers: every priced model plus the default.
-- ---------------------------------------------------------------------------
create or replace function app.assistant_models()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_models_0114$
declare
  v_out jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'default_model', vs.llm_default_model,
           'models',        coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(vs.llm_pricing) k), '[]'::jsonb))
    into v_out
    from venue_settings vs
   limit 1;
  return coalesce(v_out, jsonb_build_object('default_model', null, 'models', '[]'::jsonb));
end $assistant_models_0114$;

comment on function app.assistant_models() is
  '0114. Owner-only: the venue default chat model and every model the pricing table can bill — the choices the per-chat switch and the settings control offer.';

revoke all on function app.assistant_models() from public, anon;
grant execute on function app.assistant_models() to authenticated;

-- ---------------------------------------------------------------------------
-- app.assistant_set_model — this chat's override (NULL = follow the default).
-- ---------------------------------------------------------------------------
create or replace function app.assistant_set_model(p_id uuid, p_model text)
returns assistant_conversations
language plpgsql security definer set search_path = public as $assistant_set_model_0114$
declare
  v_row assistant_conversations;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_model is not null and not app.assistant_model_allowed(p_model) then
    raise exception 'ASSISTANT_MODEL_NOT_PRICED' using errcode = 'P0001',
      detail = p_model, hint = 'add the model''s four rates to venue_settings.llm_pricing first';
  end if;
  update assistant_conversations
     set model = p_model, updated_at = now()
   where id = p_id and owner_id = auth.uid() and archived_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'conversation';
  end if;
  return v_row;
end $assistant_set_model_0114$;

comment on function app.assistant_set_model(uuid, text) is
  '0114. Owner-only: set or clear (NULL) the model one of the caller''s chats answers with. Refuses a model llm_pricing cannot bill.';

revoke all on function app.assistant_set_model(uuid, text) from public, anon;
grant execute on function app.assistant_set_model(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.assistant_set_default_model — the venue default.
-- ---------------------------------------------------------------------------
create or replace function app.assistant_set_default_model(p_model text)
returns void
language plpgsql security definer set search_path = public as $assistant_set_default_model_0114$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not app.assistant_model_allowed(p_model) then
    raise exception 'ASSISTANT_MODEL_NOT_PRICED' using errcode = 'P0001',
      detail = p_model, hint = 'add the model''s four rates to venue_settings.llm_pricing first';
  end if;
  update venue_settings set llm_default_model = p_model where id is not null;
end $assistant_set_default_model_0114$;

comment on function app.assistant_set_default_model(text) is
  '0114. Owner-only: the model new chats use. Refuses a model llm_pricing cannot bill. The singleton row is addressed by its non-null id, as 0104 does, so safeupdate is satisfied.';

revoke all on function app.assistant_set_default_model(text) from public, anon;
grant execute on function app.assistant_set_default_model(text) to authenticated;
