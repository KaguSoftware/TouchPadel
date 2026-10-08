-- ===========================================================================
-- 0325 — owner assistant: recall of the full-text half of app.assistant_search,
--        and the frozen first-turn context column the chat lane needs.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.4 (hybrid
-- search), 0110 (the table, the search, RRF k = 60).
-- covered by packages/db/tests/assistant-retrieval.test.ts (recall@5 of the
-- eval set's "where" cases, full text only) and tests/assistant-search.test.ts.
--
-- THE DEFECTS (review 2026-10-08).
--   1. 0110 parsed the question with websearch_to_tsquery('simple', …), which
--      ANDs every word and drops no stopword: "where do I close the trading
--      day" needs where & do & i & close & the & trading & day in one chunk,
--      so a natural question matched nothing. An Arabic question has ONLY this
--      half: the embedder the stack ships (gte-small) is English-only.
--      Measured on the local stack with the system map planted and
--      p_embedding NULL: recall@5 EN 1/5, AR 0/5.
--   2. ts_rank with no weights, and `simple` does no Arabic normalisation:
--      الحجز never matched حجز, أضيف never matched اضيف, عدّ never matched عد.
--   3. The semantic CTE asks the HNSW index for 50 rows, but pgvector's
--      default hnsw.ef_search is 40 and the p_kinds filter runs after the index
--      scan, so fewer than 50 (sometimes a handful) came back.
--   4. Every hit was cut to 300 characters, so the model never read more of a
--      customer note, a staff request or a stored finding than that.
--
-- WHAT CHANGES.
--   * app.search_fold(text): one folding for both sides of the match. Lower
--     case; Arabic-Indic and Extended Arabic-Indic digits to Latin; tanween
--     alef (اً) dropped; tashkeel, the superscript alef and tatweel stripped;
--     أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, Persian ی → ي and ک → ك; and per
--     word a leading article or particle+article (وال, بال, كال, فال, لل, ال)
--     dropped when at least two letters remain. IMMUTABLE: it runs inside the
--     generated column, so it is granted to anon, authenticated AND
--     service_role (packages/db/CLAUDE.md "A function named in a CHECK
--     constraint, a generated column…", the 0116 → 0121 lesson). Changing its
--     body later is a `create or replace` plus a rebuild of assistant_chunks.tsv
--     (drop and re-add the column), or stored rows keep the old folding.
--     Not app.search_norm (0189, the customer-search ILIKE key): that one keeps
--     ة/ؤ/ئ and the article, collapses spaces, and is matched by substring.
--   * app.assistant_tsquery(text): the question folded, tokenised by the
--     `simple` parser, a short EN + AR stopword list dropped (question words,
--     pronouns, auxiliaries, prepositions; content words stay), a light
--     English suffix trim (-ing, -ies, -ed, plural -s) for words long enough,
--     then every remaining lexeme ORed as a prefix match. Each lexeme is
--     quoted (quote doubled, backslash escaped) before the cast, so user text
--     never reaches tsquery syntax. NULL when nothing remains.
--     The stopword list holds no word that is also a name or a month: على
--     folds to علي, the name Ali, and `may` is the month, so neither is in it
--     (an extra preposition costs an OR term; a lost name costs the query).
--     لل is ambiguous in writing: لل + حجز (للحجز, "for the booking") and
--     ل + لاعبين (للاعبين, "for the players", the article's alef and lam
--     absorbed) look alike, and so do للاسم (لل + اسم) and للاعب (ل + لاعب).
--     search_fold strips both letters on both sides, so للاعبين indexes as
--     اعبين while اللاعبين and لاعبين index as لاعبين. The query covers both
--     readings: an Arabic lexeme of three or more letters that does not start
--     with ل also tries ل + it, and one of four or more that starts with ل also
--     tries it without the ل. Folding لل → ل before ا instead would break the
--     commoner لل + ا-word (للاشتراك, للادارة, للاسبوع).
--   * assistant_chunks.tsv: rebuilt over the folded text with the title at
--     weight A and the body at weight B. Dropping the generated column drops
--     its GIN index; 0326 re-creates it (an index needs its own migration file).
--   * app.assistant_search, from its 0110 body, same signature (the 0110
--     grants stand): lexical list by ts_rank_cd over the weights (normalised
--     by 1 + log(length), so a long label chunk does not win on bulk alone);
--     semantic list with hnsw.ef_search raised to 200 by
--     set_config('hnsw.ef_search', '200', true) in the body, only when an
--     embedding is given. NOT a function SET clause: `postgres` is not a
--     superuser (locally or hosted), and CREATE FUNCTION … SET on a
--     placeholder GUC (pgvector's library not yet loaded in the migrating
--     session) fails with "permission denied to set parameter". It loaded
--     here only by accident (section 3's rewrite rebuilds the HNSW index), so
--     any later re-issue of this function would have failed on deploy. A
--     runtime set_config of a placeholder is allowed and pgvector takes the
--     value over when it loads. The value is transaction-local: it lasts to
--     the end of the caller's transaction, which under PostgREST is the one
--     request; a raised ef_search only widens the candidate list of any later
--     HNSW scan in it. Snippet 1,200 characters
--     for the live free-text kinds (note, request, alert, finding, rejection,
--     menu_item, promotion), 300 for map kinds. Owner guard first, top-50
--     lists, RRF k = 60 and the output shape are unchanged.
--     Measured after this file (same planted map, same cases): recall@5
--     EN 5/5, AR 2/5. The three Arabic misses have no Arabic map chunk that
--     names their words (/stock/waste and /assistant/usage carry English
--     chunks only; /reports/revenue's Arabic chunks say التقارير and
--     المكتسب, not تقرير الإيرادات): the map's Arabic coverage, not the search.
--   * assistant_conversations.context jsonb, nullable: the chat's frozen
--     first-turn context. NOT added to app.assistant_readable_columns, so
--     table_read never returns it.
--
-- Catalog work plus one rewrite of assistant_chunks (a few thousand rows of
-- map text) under ACCESS EXCLUSIVE; only the assistant reads that table.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.search_fold — the one folding, index side and query side
-- ---------------------------------------------------------------------------
-- Letters are matched by explicit code-point ranges (ء..ي and ٮ..ۓ), never by
-- [[:alpha:]], whose answer for non-ASCII depends on the database locale.
create or replace function app.search_fold(p_text text)
returns text
language sql immutable parallel safe strict
set search_path = pg_catalog
as $search_fold_0325$
  select regexp_replace(
           translate(
             regexp_replace(
               -- tanween alef at a word's end: عرضاً → عرض
               regexp_replace(lower(p_text), '(اً|ًا)(?![ء-يٮ-ۓ])', '', 'g'),
               -- tashkeel, Quranic marks, superscript alef, tatweel
               '[ؐ-ًؚ-ٰٟۖ-ۭـ]', '', 'g'),
             'أإآٱىةؤئیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
             'اااايهوييك01234567890123456789'),
           -- the article, alone or after و ب ك ف, and لل; two letters must remain
           '(^|[^ء-يٮ-ۓ])(وال|بال|كال|فال|لل|ال)(?=[ء-يٮ-ۓ]{2})', '\1', 'g')
$search_fold_0325$;

comment on function app.search_fold(text) is
  '0325. Pure text folding for search, both the index (assistant_chunks.tsv) and the query (app.assistant_tsquery): lower case, Arabic-Indic digits to Latin, tanween alef, tashkeel and tatweel stripped, alef forms to ا, ى→ي, ة→ه, ؤ→و, ئ→ي, and a leading ال / وال / بال / كال / فال / لل dropped per word when two letters remain. Reads no data. Granted to anon, authenticated and service_role because the generated column evaluates it as the writing role.';

revoke all on function app.search_fold(text) from public;
grant execute on function app.search_fold(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_tsquery — a natural question as an OR of prefix lexemes
-- ---------------------------------------------------------------------------
create or replace function app.assistant_tsquery(p_query text)
returns tsquery
language sql immutable parallel safe strict
set search_path = pg_catalog
as $assistant_tsquery_0325$
  with w as (
    select distinct t.lexeme as w
      from unnest(to_tsvector('simple', app.search_fold(left(p_query, 2000)))) t
  ), s as (
    select distinct case
             when w ~ '^[a-z]+$' and length(w) >= 7 and w ~ '(ing|ies)$' then left(w, -3)
             when w ~ '^[a-z]+$' and length(w) >= 6 and w ~ 'ed$'        then left(w, -2)
             when w ~ '^[a-z]+$' and length(w) >= 4 and w ~ '[^s]s$'     then left(w, -1)
             else w
           end as w
      from w
     where length(w) >= 2
       and w <> all (array[
             -- English: question words, pronouns, auxiliaries, articles, prepositions
             'a','an','the','and','or','of','to','in','on','at','for','from','by','with','as','into','about',
             'i','me','my','we','our','you','your','it','its','he','she','they','them','their',
             'is','are','was','were','be','been','am','do','does','did','done','can','could','should',
             'would','will','shall','might','must','have','has','had',
             'what','which','who','whom','whose','when','where','why','how',
             'this','that','these','those','there','here','then','than','so','if','not','no',
             'any','some','all','much','many','more','most','please','want','need','get','find','see',
             'show','look','go','page','screen','app','thing','things',
             -- Arabic, standard and Iraqi, written FOLDED (as search_fold leaves
             -- them: الى → الي, صفحة → صفحه, التي → تي; على is NOT here, it
             -- folds to علي, the name Ali)
             'وين','شلون','كيف','اين','ما','ماذا','ليش','لماذا','متي','شنو','شو','اكو','ماكو','هل',
             'من','في','الي','عن','مع','او','ثم','كم','لو','اذا','ان','انه','ام','قد','لا','لم','لن',
             'هذا','هذه','ذلك','تلك','هناك','هنا','ذي','تي','ذين',
             'انا','اني','احنا','نحن','انت','هو','هي','هم','لي','لنا','بي','به','بها','فيه','فيها',
             'كل','بعض','شي','شيء','يمكن','ممكن','اريد','ابي','ابغي','اجد','اشوف','اري','صفحه','شاشه'
           ])
  ), x as (
    -- the two readings of a written لل (header): ل + the word, and the word less its ل
    select w from s
    union
    select 'ل' || w from s where w ~ '^[ء-كم-يٮ-ۓ][ء-يٮ-ۓ]{2}'
    union
    select substr(w, 2) from s where w ~ '^ل[ء-يٮ-ۓ]{3}'
  )
  select case when count(*) = 0 then null
              else string_agg('''' || replace(replace(w, '\', '\\'), '''', '''''') || ''':*', ' | ' order by w)::tsquery
         end
    from x
$assistant_tsquery_0325$;

comment on function app.assistant_tsquery(text) is
  '0325. The full-text half of app.assistant_search: p_query folded by app.search_fold, tokenised by the simple parser, EN and AR stopwords dropped, a light English suffix trim, both readings of a written لل (an Arabic lexeme also tried with a leading ل added, or removed when it has one), and every remaining lexeme ORed as a quoted prefix match. NULL when nothing is left. Reads no data; called by app.assistant_search only.';

revoke all on function app.assistant_tsquery(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. assistant_chunks.tsv — folded, title at weight A, body at weight B
-- ---------------------------------------------------------------------------
-- One statement, one table rewrite. Dropping the column drops
-- assistant_chunks_tsv_idx with it; 0326 re-creates the index.
alter table assistant_chunks
  drop column if exists tsv,
  add column tsv tsvector generated always as (
    setweight(to_tsvector('simple', app.search_fold(coalesce(title, ''))), 'A')
    || setweight(to_tsvector('simple', app.search_fold(body)), 'B')
  ) stored;

comment on column assistant_chunks.tsv is
  'Generated (0325): simple-config tsvector over app.search_fold(title) at weight A and app.search_fold(body) at weight B. Matched by app.assistant_tsquery(p_query).';

-- The 0110 allowlist row survives the drop (it is keyed by name); keep its
-- ordinal and note true to the new column. Still not a default column.
update app.assistant_readable_columns r
   set ordinal = c.ordinal_position,
       note    = col_description('public.assistant_chunks'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'assistant_chunks' and c.column_name = 'tsv'
   and r.table_name = 'assistant_chunks' and r.column_name = 'tsv';

-- ---------------------------------------------------------------------------
-- 4. app.assistant_search — 0110's body with the four fixes above
-- ---------------------------------------------------------------------------
create or replace function app.assistant_search(
  p_query     text,
  p_embedding extensions.vector(1024) default null,
  p_kinds     text[] default null,
  p_limit     int default 12
) returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $assistant_search_0325$
declare
  v_q     tsquery;
  v_limit int := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_out   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_query), '') is not null then
    v_q := app.assistant_tsquery(p_query);
  end if;
  if v_q is null and p_embedding is null then
    return '[]'::jsonb;
  end if;
  -- Not a SET clause (header): `postgres` may not store one for pgvector's
  -- placeholder GUC. Transaction-local, set only when the HNSW scan will run.
  if p_embedding is not null then
    perform set_config('hnsw.ef_search', '200', true);
  end if;

  with sem as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as rnk
      from assistant_chunks c
     where p_embedding is not null and c.embedding is not null
       and (p_kinds is null or c.kind = any (p_kinds))
     order by c.embedding <=> p_embedding
     limit 50
  ), lex as (
    select c.id, row_number() over (order by ts_rank_cd(c.tsv, v_q, 1) desc, c.id) as rnk
      from assistant_chunks c
     where v_q is not null and c.tsv @@ v_q
       and (p_kinds is null or c.kind = any (p_kinds))
     order by ts_rank_cd(c.tsv, v_q, 1) desc, c.id
     limit 50
  ), fused as (
    select id, sum(1.0 / (60 + rnk)) as score
      from (select id, rnk from sem union all select id, rnk from lex) u
     group by id
     order by score desc, id
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                c.id,
           'kind',              c.kind,
           'ref',               c.ref,
           'lang',              c.lang,
           'title',             c.title,
           'snippet',           case when c.kind in ('note', 'request', 'alert', 'finding', 'rejection', 'menu_item', 'promotion')
                                     then left(c.body, 1200)
                                     else left(c.body, 300) end,
           'route',             c.route,
           'score',             round(f.score::numeric, 6),
           'source_updated_at', c.source_updated_at
         ) order by f.score desc, c.id), '[]'::jsonb)
    into v_out
    from fused f
    join assistant_chunks c on c.id = f.id;

  return v_out;
end $assistant_search_0325$;

comment on function app.assistant_search(text, extensions.vector, text[], int) is
  '0110/0325. Owner-only, read-only. Hybrid search over assistant_chunks: top-50 by cosine on p_embedding (skipped when null; hnsw.ef_search set to 200 for the rest of the transaction, so a p_kinds filter still leaves rows) and top-50 by ts_rank_cd over the weighted, folded tsvector for app.assistant_tsquery(p_query) (an OR of prefix lexemes, stopwords dropped), fused by reciprocal rank (k = 60), filtered to p_kinds when given. Returns [{id, kind, ref, lang, title, snippet, route, score, source_updated_at}]; snippet is 1,200 characters for live free-text kinds, 300 for map kinds.';

-- Same signature as 0110: its revoke/grant stand. Re-stated so the registry
-- replay sees them next to the body.
revoke all on function app.assistant_search(text, extensions.vector, text[], int) from public, anon;
grant execute on function app.assistant_search(text, extensions.vector, text[], int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. assistant_conversations.context — the chat's frozen first-turn context
-- ---------------------------------------------------------------------------
alter table assistant_conversations
  add column if not exists context jsonb;

comment on column assistant_conversations.context is
  '0325. The frozen first-turn context of this chat, built once and replayed on every later turn so the prompt prefix stays cacheable: {v: 1, text, numbers, scopes, range, today, tz, built_at}. Written by the assistant-chat edge function under the service role and read only by it (the apps name their columns and never select it); NULL until the first answer. No client role may insert or update it, and it is not in app.assistant_readable_columns, so table_read never returns it.';

-- 0108 granted INSERT on the whole table to authenticated, which would let a
-- session plant its own "frozen context" for the model to trust. Narrow it to
-- the columns that existed before this file; UPDATE was already by column
-- (0108: title, scopes, range, handles, tokens, updated_at) and stays so.
revoke insert on assistant_conversations from authenticated;
grant insert (id, owner_id, title, scopes, range, handles, tokens, created_at, updated_at, archived_at, model)
  on assistant_conversations to authenticated;
