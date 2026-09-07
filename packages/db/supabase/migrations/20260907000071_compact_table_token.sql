-- 0071_compact_table_token — make the printed table QR simpler to print and scan.
--
-- THE COMPLAINT. The cards come off the printer as a dense grey mesh and
-- phones hunt for them. That is arithmetic, not styling: the token 0014
-- defined is
--
--   base64url( "<uuid as 36 TEXT chars>.<version>.<sha256 hmac as 64 HEX chars>" )
--
-- which is 103 characters of ASCII base64url-encoded up to 138. Against the
-- configured origin the QR payload is 164-178 characters, which forces QR
-- version 9 — a 53x53 grid. On the card's 56 mm QR box that is 1.06 mm per
-- module, printed as ~1500 separate black squares. A 203 dpi thermal head
-- lays a module down in four dots, ink spreads between them, and the
-- scanner is reading a smudge.
--
-- Every one of those 103 characters is a text ENCODING of bytes we already
-- had. Encoding the bytes themselves:
--
--   token = base64url( uuid_bytes(16) || left(hmac_sha256(uuid_bytes || version, secret), 10) )
--
-- = 26 bytes = 35 characters. Payload drops to 61-75 characters, QR version 4
-- (33x33) on the production origin: 573 dark modules instead of 1488, each
-- 1.70 mm instead of 1.06 mm. Nothing about the card's size or layout changes;
-- there is simply 2.6x less ink in the same box.
--
-- WHAT IS NOT WEAKENED. The tag is 80 bits of HMAC-SHA256 under the same
-- app.table_token_secret(). Forging one needs 2^80 work against a rate-limited
-- RPC while already knowing a table's UUID, and the only prize is opening a
-- guest session on a table you are standing next to. The version is no longer
-- carried in the token at all — it is mixed into the HMAC message instead, so
-- verify recomputes the tag against the table's CURRENT token_version and a
-- rotated card fails exactly as before. That is what removes 3 characters and
-- the ambiguity of parsing an int out of the payload.
--
-- OLD CARDS KEEP WORKING. This is the part that must not go wrong: there are
-- printed cards on tables in the room, and rotation — not a migration — is the
-- only thing allowed to kill one. app.verify_table_token therefore accepts
-- BOTH shapes, chosen by decoded length (26 bytes = compact, anything else =
-- try the 0014 text form). Only app.generate_table_token changes, so cards
-- printed from today are small and cards printed last month still scan.
-- Reprinting is a convenience, not a migration step.
--
-- covered by packages/db/tests/table-token.test.ts

-- ---------------------------------------------------------------------------
-- 1. generate_table_token — compact form. Same tier check, same secret, same
--    audit posture (none: reads are audited by table_qr_tokens, one row per
--    call, not per token).
-- ---------------------------------------------------------------------------
create or replace function app.generate_table_token(p_table_id uuid) returns text
language plpgsql security definer set search_path = public as $generate_table_token_0071$
declare
  v_table cafe_tables%rowtype;
  v_id    bytea;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_table from cafe_tables where id = p_table_id;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- uuid -> its 16 raw bytes. decode(hex) is the portable route; uuid_send()
  -- lives in a schema this function's search_path does not name.
  v_id := decode(replace(v_table.id::text, '-', ''), 'hex');

  return app.b64url_encode(
           v_id || substring(
             extensions.hmac(v_id || convert_to(v_table.token_version::text, 'utf8'),
                             convert_to(app.table_token_secret(), 'utf8'),
                             'sha256')
             from 1 for 10));
end $generate_table_token_0071$;

-- ---------------------------------------------------------------------------
-- 2. verify_table_token — compact first, 0014 text form as the fallback.
--
-- Unchanged contract: returns the table_id, or NULL on ANY failure (malformed,
-- bad signature, stale version, inactive table). Never raises on invalid
-- input, never leaks which check failed — same posture as PIN verify.
-- (volatile, not stable: table_token_secret() may write on its bootstrap path)
-- ---------------------------------------------------------------------------
create or replace function app.verify_table_token(p_token text) returns uuid
language plpgsql security definer set search_path = public as $verify_table_token_0071$
declare
  v_raw     bytea;
  v_decoded text;
  v_table   cafe_tables%rowtype;
  v_id      uuid;
  v_version int;
  v_sig     text;
  v_expect  text;
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
      return null;
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
    return null;
  end if;

  select * into v_table from cafe_tables where id = v_id;
  if not found or not v_table.is_active or v_table.token_version <> v_version then
    return null;                               -- rotated or retired QR
  end if;

  return v_table.id;
end $verify_table_token_0071$;

comment on function app.generate_table_token(uuid) is
  '0071: base64url(uuid_bytes || left(hmac_sha256(uuid_bytes || token_version, secret), 10)) = 35 chars. Replaces 0014''s 138-char text form; the QR drops from 53x53 to 33x33 modules.';
comment on function app.verify_table_token(text) is
  '0071: accepts the compact 26-byte token AND 0014''s text form, so cards already printed and hanging on tables keep scanning. NULL on any failure.';

-- Grants are unchanged from 0014; restated because CREATE OR REPLACE keeps
-- them but a fresh stack replaying only this file should not depend on that.
revoke all on function app.generate_table_token(uuid) from public, anon;
grant execute on function app.generate_table_token(uuid) to authenticated;
revoke all on function app.verify_table_token(text) from public, anon;
grant execute on function app.verify_table_token(text) to authenticated;
