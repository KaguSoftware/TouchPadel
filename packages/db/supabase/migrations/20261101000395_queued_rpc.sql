set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0395 queued_rpc — a save made while the station is offline is queued and
-- applied exactly once when the connection is back (Majed, 2026-11-01, the
-- launch findings F-23, F-56, F-57, F-58: "admin saves offline: queued and
-- never lost"; the offline shop sale keeps its member; the kitchen recall and
-- the deposit actions work offline).
--
-- The till's durable queue (apps/operator-shell queue.ts) already carries the
-- money writes through the replay function, each as its own mutation type.
-- The admin saves are dozens of small RPCs whose arguments are the patch the
-- page built; one mutation type per RPC would mean six code copies each. So
-- one type, 'rpc.queued', names the RPC and its arguments, and this function
-- runs it:
--
--   1. app.queueable_rpcs(): the allowlist, the third copy of
--      packages/core QUEUEABLE_RPCS and functions/_shared/mutation-types.json
--      queueableRpcs (packages/db/tests/queued-rpc.test.ts holds the three
--      equal). Never a secret setter, a day / shift / branch boundary, a cash
--      move or a call whose answer the screen needs at once.
--   2. app.queued_rpc_claim / app.queued_rpc_finish: the 0049 claim ledger
--      (app.rpc_replays) for this path. app.claim_replay is definer-only and
--      not granted, and queued_rpc must run as the CALLER (below), so these
--      two thin definer wrappers expose exactly the claim of a key shaped
--      '{station}:rpc.queued:{ulid}' under the name 'queued:<fn>', scoped to
--      auth.uid() like every claim (another principal's key is
--      IDEMPOTENCY_CONFLICT, never its result).
--   3. app.queued_rpc(p_fn, p_args, p_idempotency_key): SECURITY INVOKER on
--      purpose — the one exception to "RPCs are security definer". It must
--      not lend its owner's rights to the RPC it calls: the staff session
--      calls app.<p_fn> with its own EXECUTE grant, so every role guard,
--      venue guard and audit row inside is exactly what the online call
--      would have met. It claims the key, builds a named-argument call from
--      the function's own catalogue entry (each argument cast to its declared
--      type; an unknown argument name is INVALID_ARGUMENT), runs it, records
--      the answer, all in ONE transaction: the claim commits with the write
--      or rolls back with it, so a lost answer and a retry can never apply it
--      twice (the property 0049 gave the money RPCs).
--
-- The replay edge function dispatches 'rpc.queued' here, after proving a
-- manager PIN for a PIN-gated RPC (verify_manager_pin, 0115) as it does for
-- every queued PIN-gated write.

-- ===========================================================================
-- 1. The allowlist
-- ===========================================================================
create or replace function app.queueable_rpcs()
returns text[]
language sql immutable set search_path = public as $queueable_rpcs_0395$
  select array[
    -- Settings
    'set_venue_details', 'set_waiter_call_cooldown', 'set_match_settings',
    'set_coaching_settings', 'set_tournaments_enabled', 'set_opening_hours',
    'set_deposit_settings', 'set_loyalty_settings', 'set_telegram_staff',
    -- Courts, tables, prices
    'upsert_court', 'reorder_courts', 'upsert_court_gender_rule', 'upsert_rate_rule',
    'upsert_cafe_table', 'set_table_bell',
    -- Menu
    'upsert_menu_category', 'upsert_menu_item', 'upsert_variant', 'upsert_modifier',
    'upsert_modifier_group', 'link_item_modifier_group', 'set_modifier_reveals',
    'set_item_sold_out', 'set_item_availability', 'set_item_cost', 'reorder_modifiers',
    'reorder_menu_items', 'reorder_menu_categories', 'set_addon_suggestions',
    -- Promotions and loyalty
    'upsert_promotion', 'set_promotion_enabled', 'upsert_loyalty_reward', 'upsert_loyalty_tier',
    -- Coaching
    'upsert_lesson_type', 'set_coach_lesson_types', 'set_coach_price', 'set_coach_hours',
    'set_coach_branches', 'set_coach_status', 'coach_update', 'add_coach_time_off',
    'cancel_coach_time_off',
    -- Staff (never the PIN)
    'rename_staff', 'set_staff_role', 'set_staff_active', 'set_staff_access',
    'set_staff_venues', 'set_station_staff',
    -- Shop catalogue and stock settings
    'upsert_retail_variant', 'upsert_shop_category', 'upsert_supplier',
    'set_shop_price_watch', 'upsert_ingredient', 'set_recipe',
    -- F-56, F-57, F-58
    'set_tab_customer', 'recall_ticket',
    'deposit_refund_retry', 'deposit_refund_request', 'deposit_refund_manual'
  ]::text[]
$queueable_rpcs_0395$;

revoke all on function app.queueable_rpcs() from public, anon, authenticated;

comment on function app.queueable_rpcs() is
  '0395: the RPCs an rpc.queued envelope may name. Mirrors packages/core QUEUEABLE_RPCS and '
  'functions/_shared/mutation-types.json queueableRpcs; tests/queued-rpc.test.ts holds them equal.';

-- ===========================================================================
-- 2. The claim, for this path only
-- ===========================================================================
create or replace function app.queued_rpc_claim(p_key text, p_fn text)
returns jsonb
language plpgsql security definer set search_path = public as $queued_rpc_claim_0395$
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_fn is null or not (p_fn = any (app.queueable_rpcs())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'not a queueable RPC';
  end if;
  if p_key is null or p_key !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*:rpc\.queued:[0-9A-HJKMNP-TV-Z]{26}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  return app.claim_replay(p_key, 'queued:' || p_fn);
end $queued_rpc_claim_0395$;

revoke all on function app.queued_rpc_claim(text, text) from public, anon;
grant execute on function app.queued_rpc_claim(text, text) to authenticated;

create or replace function app.queued_rpc_finish(p_key text, p_result jsonb)
returns void
language plpgsql security definer set search_path = public as $queued_rpc_finish_0395$
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Only the caller's own claim on this path, and only while it has no answer
  -- yet: a finished claim is history.
  update app.rpc_replays
     set result = coalesce(p_result, '{}'::jsonb)
   where idempotency_key = p_key
     and caller = auth.uid()
     and fn like 'queued:%'
     and result is null;
end $queued_rpc_finish_0395$;

revoke all on function app.queued_rpc_finish(text, jsonb) from public, anon;
grant execute on function app.queued_rpc_finish(text, jsonb) to authenticated;

-- ===========================================================================
-- 3. The dispatcher
-- ===========================================================================
create or replace function app.queued_rpc(
  p_fn              text,
  p_args            jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql security invoker set search_path = public as $queued_rpc_0395$
declare
  v_replay   jsonb;
  v_count    int;
  v_oid      oid;
  v_rettype  oid;
  v_retset   boolean;
  v_names    text[];
  v_types    oid[];
  v_modes    text[];
  v_key      text;
  v_idx      int;
  v_type     oid;
  v_elem     oid;
  v_cat      char;
  v_tname    text;
  v_parts    text[] := '{}';
  v_call     text;
  v_result   jsonb;
begin
  -- The guard and the claim first, in this transaction: queued_rpc_claim (a
  -- definer) refuses a caller who is not active staff and a name off the
  -- allowlist (this invoker body cannot read app.queueable_rpcs itself), and a
  -- replay of a committed call answers what it answered then.
  v_replay := app.queued_rpc_claim(p_idempotency_key, p_fn);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_args';
  end if;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = p_fn;
  if v_count <> 1 then
    -- Not deployed yet (a till ahead of its migration), or an overload this
    -- path cannot choose between: either way not judged here.
    raise exception 'RPC_NOT_QUEUEABLE' using errcode = 'P0001', detail = p_fn;
  end if;

  select p.oid, p.prorettype, p.proretset,
         coalesce(p.proargnames, '{}'),
         -- proargtypes is an oidvector, zero-based; rebased to 1 like proargnames.
         coalesce(p.proallargtypes, array(select unnest(p.proargtypes::oid[]))),
         p.proargmodes::text[]
    into v_oid, v_rettype, v_retset, v_names, v_types, v_modes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = p_fn;

  for v_key in select jsonb_object_keys(p_args) loop
    if v_key !~ '^p_[a-z0-9_]+$' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
    v_idx := array_position(v_names, v_key);
    if v_idx is null or (v_modes is not null and v_modes[v_idx] not in ('i', 'b')) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
    v_type := v_types[v_idx];
    v_tname := format_type(v_type, null);
    select t.typcategory, t.typelem into v_cat, v_elem from pg_type t where t.oid = v_type;

    if jsonb_typeof(p_args -> v_key) = 'null' then
      v_parts := v_parts || format('%I => null::%s', v_key, v_tname);
    elsif v_type = 'jsonb'::regtype then
      v_parts := v_parts || format('%I => ($1 -> %L)', v_key, v_key);
    elsif v_type = 'json'::regtype then
      v_parts := v_parts || format('%I => ($1 -> %L)::json', v_key, v_key);
    elsif v_cat = 'A' then
      if jsonb_typeof(p_args -> v_key) <> 'array' then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
      end if;
      if v_elem = 'jsonb'::regtype then
        v_parts := v_parts || format(
          '%I => array(select e.v from jsonb_array_elements($1 -> %L) with ordinality e(v, i) order by e.i)',
          v_key, v_key);
      else
        v_parts := v_parts || format(
          '%I => array(select e.v::%s from jsonb_array_elements_text($1 -> %L) with ordinality e(v, i) order by e.i)::%s',
          v_key, format_type(v_elem, null), v_key, v_tname);
      end if;
    elsif v_cat = 'C' then
      v_parts := v_parts || format('%I => jsonb_populate_record(null::%s, $1 -> %L)', v_key, v_tname, v_key);
    else
      v_parts := v_parts || format('%I => ($1 ->> %L)::%s', v_key, v_key, v_tname);
    end if;
  end loop;

  v_call := format('app.%I(%s)', p_fn, array_to_string(v_parts, ', '));

  if v_retset then
    execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from %s r', v_call)
      using p_args into v_result;
  elsif v_rettype = 'void'::regtype then
    execute format('select %s', v_call) using p_args;
    v_result := null;
  elsif v_rettype = 'record'::regtype
     or exists (select 1 from pg_type t where t.oid = v_rettype and t.typtype = 'c') then
    execute format('select to_jsonb(r) from %s r', v_call) using p_args into v_result;
  else
    execute format('select to_jsonb(%s)', v_call) using p_args into v_result;
  end if;

  perform app.queued_rpc_finish(p_idempotency_key, v_result);
  return v_result;
end $queued_rpc_0395$;

revoke all on function app.queued_rpc(text, jsonb, text) from public, anon;
grant execute on function app.queued_rpc(text, jsonb, text) to authenticated;

comment on function app.queued_rpc(text, jsonb, text) is
  '0395: runs one allowlisted RPC queued offline (rpc.queued) exactly once: claim, call as the '
  'caller (security invoker), record, one transaction. Called by functions/replay.';
