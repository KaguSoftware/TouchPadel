-- 0083_table_token_prev_secret — SEC-26 (a hard gate). Let the table-token
-- secret be rotated without killing every printed QR card in the building.
--
-- THE PROBLEM. Every table card carries an HMAC over the table id and the
-- table's `token_version`, signed with ONE secret (`app.table_token_secret`).
-- Rotating that secret invalidates every card simultaneously — the cards are
-- laminated and glued to tables, so the venue stops being able to take café
-- orders until somebody physically replaces all of them.
--
-- That collides head-on with Phase 9's "rotate every key at handover"
-- (SEC-42). Faced with "rotate the key" or "keep the café trading", anybody
-- would choose trading — so the key never gets rotated, and the handover box
-- gets ticked without the rotation ever happening. A control nobody can afford
-- to exercise is not a control.
--
-- THE SHAPE. A SECOND secret, `table_token_secret_prev`. Verification accepts a
-- signature valid under EITHER; minting only ever uses the current one. So the
-- rotation is:
--
--   1. copy the current secret to `table_token_secret_prev`
--   2. set a fresh `table_token_secret`
--   3. reprint cards at whatever pace the venue can manage — each new card is
--      signed with the new secret, and old cards keep working
--   4. clear `table_token_secret_prev`; the old cards die on YOUR schedule
--
-- Step 4 is the one that matters and it is the one that gets forgotten, so
-- every acceptance under the previous secret writes an audit row. The venue can
-- ask the database "is anybody still scanning an old card?" and get a real
-- answer instead of a guess.
--
-- NOT A WEAKENING. Two live keys is twice the surface only if the second one
-- lives forever. It is a bounded overlap, it is visible in the audit trail while
-- it lasts, and the alternative in practice is one key that is never rotated at
-- all.
--
-- covered by packages/db/tests/table-token-rotation.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.table_token_secret_prev — NULL when no rotation is in flight.
-- ---------------------------------------------------------------------------
-- Deliberately does NOT bootstrap. Unlike the current secret, absence is the
-- normal state: a missing previous key means "no rotation in progress", and
-- inventing one would create a second live key nobody asked for.
create or replace function app.table_token_secret_prev()
returns text
language plpgsql stable security definer set search_path = public as $table_token_secret_prev_0083$
declare
  v text;
begin
  begin
    select decrypted_secret into v
      from vault.decrypted_secrets
     where name = 'table_token_secret_prev'
     limit 1;
  exception when others then
    v := null;                                 -- vault schema/view missing or unreadable
  end;
  if v is not null and btrim(v) <> '' then
    return v;
  end if;

  select value into v from app.secrets where name = 'table_token_secret_prev';
  if v is not null and btrim(v) = '' then
    return null;                               -- cleared, not unset
  end if;
  return v;
end $table_token_secret_prev_0083$;

comment on function app.table_token_secret_prev() is
  '0083/SEC-26. The PREVIOUS table-token HMAC key while a rotation is in flight, or NULL. Never bootstraps: absence is the normal state and inventing one would create a second live key nobody asked for.';

revoke all on function app.table_token_secret_prev() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- verify_table_token — accept either secret, and SAY SO when it is the old one.
-- ---------------------------------------------------------------------------
-- Re-issued from the 0071 body (0076's lesson: `create or replace` replaces the
-- whole body, so this is a merge onto the current definition). Both token forms
-- — the 26-byte compact form and the 0014 text form still printed on cards that
-- are on tables right now — are carried over unchanged except for the second
-- key check.
create or replace function app.verify_table_token(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $verify_table_token_0083$
declare
  v_raw     bytea;
  v_decoded text;
  v_table   cafe_tables%rowtype;
  v_id      uuid;
  v_version int;
  v_sig     text;
  v_expect  text;
  v_prev    text := app.table_token_secret_prev();
  v_by_prev boolean := false;
begin
  if p_token is null or length(p_token) > 512 then
    return null;
  end if;

  begin
    v_raw := app.b64url_decode(p_token);
  exception when others then
    return null;                               -- not base64url at all
  end;

  if octet_length(v_raw) = 26 then
    -- Compact (0071). The version is not in the token: the tag is recomputed
    -- against whatever token_version the table carries NOW, so a rotation
    -- invalidates every card signed under the old one without the card having
    -- to say which one it was signed under.
    begin
      v_id := encode(substring(v_raw from 1 for 16), 'hex')::uuid;
    exception when others then
      return null;
    end;

    select * into v_table from cafe_tables where id = v_id;
    if not found or not v_table.is_active then
      return null;
    end if;

    if substring(v_raw from 17 for 10) is distinct from
       substring(extensions.hmac(substring(v_raw from 1 for 16)
                                 || convert_to(v_table.token_version::text, 'utf8'),
                                 convert_to(app.table_token_secret(), 'utf8'),
                                 'sha256')
                 from 1 for 10) then
      -- 0083: not the current key. Try the previous one, if a rotation is in
      -- flight. Both comparisons are `is distinct from` on the full tag, so
      -- neither short-circuits on a partial match.
      if v_prev is null
         or substring(v_raw from 17 for 10) is distinct from
            substring(extensions.hmac(substring(v_raw from 1 for 16)
                                      || convert_to(v_table.token_version::text, 'utf8'),
                                      convert_to(v_prev, 'utf8'),
                                      'sha256')
                      from 1 for 10) then
        return null;
      end if;
      v_by_prev := true;
    end if;

    if v_by_prev then
      perform app.write_audit('table_token.accepted_prev_secret', 'cafe_tables',
                              v_table.id::text, null,
                              jsonb_build_object('token_version', v_table.token_version,
                                                 'form', 'compact'),
                              'rotation_overlap');
    end if;
    return v_table.id;
  end if;

  -- 0014 text form: "<uuid>.<version>.<hex hmac>". Still live because it is
  -- printed on cards that are on tables right now.
  begin
    v_decoded := convert_from(v_raw, 'utf8');
    v_id      := split_part(v_decoded, '.', 1)::uuid;
    v_version := split_part(v_decoded, '.', 2)::int;
    v_sig     := split_part(v_decoded, '.', 3);
  exception when others then
    return null;                               -- malformed token
  end;

  v_expect := encode(extensions.hmac(
                split_part(v_decoded, '.', 1) || '.' || split_part(v_decoded, '.', 2),
                app.table_token_secret(), 'sha256'), 'hex');
  if v_sig is distinct from v_expect then
    if v_prev is null then
      return null;
    end if;
    v_expect := encode(extensions.hmac(
                  split_part(v_decoded, '.', 1) || '.' || split_part(v_decoded, '.', 2),
                  v_prev, 'sha256'), 'hex');
    if v_sig is distinct from v_expect then
      return null;
    end if;
    v_by_prev := true;
  end if;

  select * into v_table from cafe_tables where id = v_id;
  if not found or not v_table.is_active or v_table.token_version <> v_version then
    return null;                               -- rotated or retired QR
  end if;

  if v_by_prev then
    perform app.write_audit('table_token.accepted_prev_secret', 'cafe_tables',
                            v_table.id::text, null,
                            jsonb_build_object('token_version', v_table.token_version,
                                               'form', 'text'),
                            'rotation_overlap');
  end if;

  return v_table.id;
end $verify_table_token_0083$;

comment on function app.verify_table_token(text) is
  '0083 = 0071 + SEC-26. Accepts a signature valid under app.table_token_secret() OR app.table_token_secret_prev() while a rotation is in flight, mints only under the current one, and writes a table_token.accepted_prev_secret audit row every time the old key is used — so "is anybody still scanning an old card?" has an answer before the previous key is cleared.';

-- Grants carried over from 0014/0071 EXACTLY: anon is revoked. A guest scans a
-- card and gets an anonymous SESSION first (open_table_session), so the verify
-- is always called as `authenticated`. Re-issuing a function is the easiest
-- place in this codebase to widen a grant by accident — this line is the one
-- that stops it, and the rls-matrix rule for this RPC caught exactly that
-- mistake in the first draft of this migration.
revoke all on function app.verify_table_token(text) from public, anon;
grant execute on function app.verify_table_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The rotation itself, as an operation rather than a runbook step.
-- ---------------------------------------------------------------------------
--
-- Writing this exposed a gap in the box: it describes a four-step rotation and
-- there was no supported way to PERFORM any of it. The secret lives in Vault
-- (with app.secrets as the fallback), so "copy the current secret to prev and
-- mint a new one" meant hand-editing Vault on the live project — which is
-- precisely the kind of manual step that gets done wrong at 2am, or not at all.
--
-- Service-role only: this is an operator action run from a runbook, not
-- something any signed-in principal may trigger.

create or replace function app.set_secret_value(p_name text, p_value text)
returns void
language plpgsql security definer set search_path = public as $set_secret_value_0083$
declare
  v_id uuid;
begin
  -- Vault first, mirroring how the values are READ. update_secret when it
  -- exists, create_secret when it does not.
  begin
    select id into v_id from vault.secrets where name = p_name limit 1;
    if v_id is not null then
      perform vault.update_secret(v_id, p_value, p_name, null);
    else
      perform vault.create_secret(p_value, p_name, 'cafe table QR HMAC key');
    end if;
    return;
  exception when others then
    null;                                      -- vault unavailable: fall through
  end;

  insert into app.secrets (name, value) values (p_name, p_value)
  on conflict (name) do update set value = excluded.value;
end $set_secret_value_0083$;

revoke all on function app.set_secret_value(text, text) from public, anon, authenticated;

create or replace function app.rotate_table_token_secret()
returns jsonb
language plpgsql security definer set search_path = public as $rotate_table_token_secret_0083$
declare
  v_current text := app.table_token_secret();   -- bootstraps if this is the first run
  v_new     text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  -- Steps 1 and 2 together: the old key becomes `prev` and a fresh one becomes
  -- current, in one statement. Doing them separately leaves a window in which
  -- every printed card is dead.
  perform app.set_secret_value('table_token_secret_prev', v_current);
  perform app.set_secret_value('table_token_secret', v_new);

  perform app.write_audit('table_token.secret_rotated', 'app.secrets',
                          'table_token_secret', null,
                          jsonb_build_object('prev_set', true), 'key_rotation');

  return jsonb_build_object(
    'rotated', true,
    'prev_active', true,
    'next_step', 'reprint the cards, then call app.clear_table_token_secret_prev()');
end $rotate_table_token_secret_0083$;

comment on function app.rotate_table_token_secret() is
  '0083/SEC-26. Steps 1+2 of the table-token rotation, atomically: the current key becomes the previous one and a fresh key becomes current. Old cards keep working until app.clear_table_token_secret_prev() is called. Service role only.';

revoke all on function app.rotate_table_token_secret() from public, anon, authenticated;
grant execute on function app.rotate_table_token_secret() to service_role;

create or replace function app.clear_table_token_secret_prev()
returns jsonb
language plpgsql security definer set search_path = public as $clear_table_token_secret_prev_0083$
declare
  v_recent int;
begin
  -- The number that makes this decision instead of a guess: how many scans have
  -- come in on the OLD key recently. Clearing while that is non-zero is a choice
  -- to break cards that are demonstrably still in use.
  select count(*) into v_recent
    from audit_log
   where action = 'table_token.accepted_prev_secret'
     and at > now() - interval '7 days';

  perform app.set_secret_value('table_token_secret_prev', '');

  perform app.write_audit('table_token.prev_secret_cleared', 'app.secrets',
                          'table_token_secret_prev', null,
                          jsonb_build_object('accepted_on_prev_last_7d', v_recent),
                          'key_rotation');

  return jsonb_build_object('cleared', true, 'accepted_on_prev_last_7d', v_recent);
end $clear_table_token_secret_prev_0083$;

comment on function app.clear_table_token_secret_prev() is
  '0083/SEC-26. Step 4: retires the previous key. Returns how many scans arrived on it in the last 7 days, so the decision to break the remaining old cards is made against a number rather than a hope. Service role only.';

revoke all on function app.clear_table_token_secret_prev() from public, anon, authenticated;
grant execute on function app.clear_table_token_secret_prev() to service_role;
