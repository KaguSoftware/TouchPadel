-- 0312_assistant_models_5_5 — owner call 2026-10-07: the assistant answers with
-- Claude Opus 5.5 or Claude Sonnet 5.5 and nothing else.
--
-- WHAT CHANGES.
--   * platform_settings.llm_pricing is REPLACED (not merged) by the two models'
--     rates, so the switch (app.assistant_models) offers exactly these two and
--     app.assistant_model_allowed refuses every other id, Groq's included.
--   * The chain default becomes claude-opus-5-5 (it was claude-opus-5, or
--     openai/gpt-oss-120b on a database that ran 0142 and never moved back).
--   * A chat pinned to claude-sonnet-5 moves to claude-sonnet-5-5; a chat
--     pinned to anything else follows the default again (NULL).
--   * Two CHECKs hold the line for writers that skip the RPCs (migrations, the
--     service role): the default and every chat's model must be one of the two.
--     Adding a model later is a migration that widens both CHECKs and adds its
--     four rates.
--
-- PRICES (USD micros per 1,000,000 tokens; Anthropic list rates, 2026-10):
--   claude-opus-5-5    input 4.00  cache_write 5.00  cache_read 0.20  output 20.00
--   claude-sonnet-5-5  input 2.00  cache_write 2.50  cache_read 0.20  output 10.00
-- cache_write is the 5-minute rate (1.25× input), the convention 0111 seeded;
-- the one-hour write on the system prefix lists at 2× input.
--
-- The edge side matches: _shared/assistant/provider.ts ASSISTANT_MODELS.
--
-- Small: one singleton row, a handful of chat rows, two CHECKs added NOT VALID
-- and validated in a guarded block.

set lock_timeout = '3s';
set statement_timeout = '60s';

update platform_settings
   set llm_pricing = jsonb_build_object(
         'claude-opus-5-5',   jsonb_build_object('input', 4000000, 'cache_write', 5000000, 'cache_read', 200000, 'output', 20000000),
         'claude-sonnet-5-5', jsonb_build_object('input', 2000000, 'cache_write', 2500000, 'cache_read', 200000, 'output', 10000000)),
       llm_default_model = 'claude-opus-5-5',
       updated_at = now()
 where id;

alter table platform_settings alter column llm_default_model set default 'claude-opus-5-5';

update assistant_conversations
   set model = 'claude-sonnet-5-5'
 where model = 'claude-sonnet-5';

update assistant_conversations
   set model = null
 where model is not null
   and model not in ('claude-opus-5-5', 'claude-sonnet-5-5');

do $assistant_models_5_5_0312$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'platform_settings_llm_default_model_chk'
                    and conrelid = 'public.platform_settings'::regclass) then
    alter table platform_settings add constraint platform_settings_llm_default_model_chk
      check (llm_default_model in ('claude-opus-5-5', 'claude-sonnet-5-5')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'assistant_conversations_model_chk'
                    and conrelid = 'public.assistant_conversations'::regclass) then
    alter table assistant_conversations add constraint assistant_conversations_model_chk
      check (model is null or model in ('claude-opus-5-5', 'claude-sonnet-5-5')) not valid;
  end if;
end $assistant_models_5_5_0312$;

do $assistant_models_5_5_validate_0312$
begin
  if exists (select 1 from pg_constraint
              where conname = 'platform_settings_llm_default_model_chk'
                and conrelid = 'public.platform_settings'::regclass
                and not convalidated) then
    alter table platform_settings validate constraint platform_settings_llm_default_model_chk;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'assistant_conversations_model_chk'
                and conrelid = 'public.assistant_conversations'::regclass
                and not convalidated) then
    alter table assistant_conversations validate constraint assistant_conversations_model_chk;
  end if;
end $assistant_models_5_5_validate_0312$;

comment on column platform_settings.llm_pricing is
  '0207 (from venue_settings, 0111), 0312. Model -> four rates in USD micros per 1,000,000 tokens. Since 0312 exactly claude-opus-5-5 and claude-sonnet-5-5.';
comment on column platform_settings.llm_default_model is
  '0207 (from venue_settings, 0140), 0312. The model a new assistant chat uses: claude-opus-5-5 or claude-sonnet-5-5 (CHECK), and a key of llm_pricing.';
comment on column assistant_conversations.model is
  '0140, 0312. This chat''s model (claude-opus-5-5 or claude-sonnet-5-5, CHECK), or NULL to follow platform_settings.llm_default_model. Set by app.assistant_set_model; the edge function resolves the effective model per answer and stamps it on every assistant_calls row.';
