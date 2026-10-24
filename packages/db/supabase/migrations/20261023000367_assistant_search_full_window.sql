-- ===========================================================================
-- 0367 — owner assistant: a search hit shows its whole window.
--
-- The system map is now cut into overlapping windows of at most 800 characters
-- (scripts/build-assistant-map.mjs, WINDOW_MAX), each opening with the entry's
-- first line and repeating the last 200 characters of the window before it.
-- 0325 still cut a map hit to 300 characters, so the model read a third of a
-- window and lost exactly the context the overlap exists to keep. The snippet
-- is now the first 1,200 characters of the chunk for every kind. Same
-- signature, same body otherwise (0325 section 4); the grants stand.
--
-- covered by packages/db/tests/assistant-retrieval.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.assistant_search(
  p_query     text,
  p_embedding extensions.vector(1024) default null,
  p_kinds     text[] default null,
  p_limit     int default 12
) returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $assistant_search_0367$
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
           'snippet',           left(c.body, 1200),
           'route',             c.route,
           'score',             round(f.score::numeric, 6),
           'source_updated_at', c.source_updated_at
         ) order by f.score desc, c.id), '[]'::jsonb)
    into v_out
    from fused f
    join assistant_chunks c on c.id = f.id;

  return v_out;
end $assistant_search_0367$;

comment on function app.assistant_search(text, extensions.vector, text[], int) is
  '0110/0325/0367. Owner-only, read-only. Hybrid search over assistant_chunks: top-50 by cosine on p_embedding (skipped when null; hnsw.ef_search set to 200 for the rest of the transaction, so a p_kinds filter still leaves rows) and top-50 by ts_rank_cd over the weighted, folded tsvector for app.assistant_tsquery(p_query) (an OR of prefix lexemes, stopwords dropped), fused by reciprocal rank (k = 60), filtered to p_kinds when given. Returns [{id, kind, ref, lang, title, snippet, route, score, source_updated_at}]; snippet is the first 1,200 characters of the chunk, for every kind (0367).';

-- Same signature as 0110: its revoke/grant stand. Re-stated so the registry
-- replay sees them next to the body.
revoke all on function app.assistant_search(text, extensions.vector, text[], int) from public, anon;
grant execute on function app.assistant_search(text, extensions.vector, text[], int) to authenticated;
