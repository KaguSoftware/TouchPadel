-- 0116_assistant_groq_for_now — owner call 2026-09-20: run the assistant on the
-- free Groq tier for a short period, with a one-line move back to Claude.
--
-- HOW THE SWITCH WORKS. The vendor follows the model id (functions/_shared/
-- assistant/provider.ts `vendorFor`): `claude-*` is Anthropic, anything else is
-- Groq. The venue default model (0114) is therefore the switch, and the key is
-- the other line:
--
--   to Groq   : ANTHROPIC not needed; GROQ_API_KEY set;   default model openai/gpt-oss-120b   (this migration)
--   to Claude : ANTHROPIC_API_KEY set;                    default model claude-opus-5
--               → select app.assistant_set_default_model('claude-opus-5');   -- as the owner, or the usage page
--
-- PRICES. Groq's list rates for gpt-oss-120b (USD micros per MTok): input 0.15,
-- output 0.60, cached input at half. The FREE tier bills nothing, so the meter
-- shows what the same tokens would cost on the paid plan; a venue that stays
-- free can zero these four numbers if it prefers a meter that reads 0.
--
-- Catalog-only: a jsonb merge and one column update on the singleton row.

set lock_timeout = '3s';
set statement_timeout = '60s';

update venue_settings
   set llm_pricing = llm_pricing
         || jsonb_build_object('openai/gpt-oss-120b',
              jsonb_build_object('input', 150000, 'cache_write', 150000, 'cache_read', 75000, 'output', 600000)),
       llm_default_model = 'openai/gpt-oss-120b'
 where id is not null;

comment on column venue_settings.llm_default_model is
  '0114/0116. The chat model a new assistant conversation uses unless it names one. Must be a key of llm_pricing. The vendor follows the id: claude-* is Anthropic (ANTHROPIC_API_KEY), anything else is Groq (GROQ_API_KEY). Set by app.assistant_set_default_model or the usage page.';
