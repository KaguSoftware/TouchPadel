/**
 * The static overload gate's parser (0119) — pure, always runs.
 *
 * The one sequence that matters is the 0049 → 0115 one: a file drops the 7-arg
 * form and creates an 8-arg form; a later file `create or replace`s the 7-arg
 * form again. Postgres ends up with two functions. The replay must say so, and
 * must go back to one when a further file drops the stray.
 */
import { describe, expect, it } from 'vitest';
import { normalizeArgs, replaySignatures, signatureEvents, stripSqlNoise } from '../scripts/lib/fn-signatures.mjs';

describe('normalizeArgs', () => {
  it('drops parameter names, defaults and modes; canonicalises type spellings', () => {
    expect(
      normalizeArgs(
        'p_tab_id uuid, p_kind adjustment_kind, p_value int, p_pin text, p_reason_code text, p_order_item_id uuid default null, p_device_id text default null',
      ),
    ).toBe('uuid, adjustment_kind, integer, text, text, uuid, text');
  });

  it('matches a create list against its drop list (names vs bare types)', () => {
    const created = normalizeArgs('p_order_item_id uuid, p_new_unit_price_iqd bigint, p_pin text, p_reason_code text, p_device_id text default null, p_idempotency_key text default null');
    const dropped = normalizeArgs('uuid, bigint, text, text, text, text');
    expect(created).toBe(dropped);
  });

  it('survives defaults with parentheses and array literals, and counts every parameter', () => {
    // upsert_court (0097) — a naive comma split shreds the array literal.
    const list =
      "p_id uuid default null, p_name text, p_sort int default 0, p_active boolean default true, p_durations int[] default '{60,90,120}', p_created timestamptz default now(), p_note varchar(20) default 'x', p_rate numeric(12,2) default 1.5, p_when timestamp default null, variadic p_roles staff_role[]";
    expect(normalizeArgs(list)).toBe(
      'uuid, text, integer, boolean, integer[], timestamp with time zone, character varying, numeric, timestamp without time zone, staff_role[]',
    );
  });

  it('ignores OUT parameters and schema prefixes', () => {
    expect(normalizeArgs('p_in public.adjustment_kind, out p_result jsonb, inout p_count int8')).toBe('adjustment_kind, bigint');
  });

  it('keeps a zero-argument list empty', () => {
    expect(normalizeArgs('')).toBe('');
    expect(normalizeArgs('   ')).toBe('');
  });
});

describe('stripSqlNoise + signatureEvents', () => {
  it('sees DDL only: comments, string literals and function bodies cannot produce events', () => {
    const sql = `
      -- create function app.ghost(uuid) lives in a comment
      /* drop function app.ghost(uuid); */
      create or replace function app.real(p_id uuid, p_note text default 'create function app.ghost(text)')
      returns void language plpgsql as $real$
      begin
        -- inside the body:
        execute 'create function app.ghost(int)';
      end $real$;
      drop function if exists app.old(uuid, text);
      drop function app.gone;
    `;
    const events = signatureEvents(stripSqlNoise(sql));
    expect(events.map((e) => [e.op, e.name, e.sig])).toEqual([
      ['create', 'real', 'uuid, text'],
      ['drop', 'old', 'uuid, text'],
      ['drop', 'gone', null],
    ]);
  });

  it('handles $$ bodies and nested parentheses in defaults', () => {
    const sql = `create function app.f(p_at timestamptz default date_trunc('day', now())) returns int language sql as $$ select 1 $$;`;
    expect(signatureEvents(stripSqlNoise(sql))).toEqual([{ at: 0, op: 'create', name: 'f', sig: 'timestamp with time zone' }]);
  });
});

describe('replaySignatures', () => {
  const f0037 = { file: '0037', sql: 'create or replace function app.apply_discount(p_tab_id uuid, p_kind adjustment_kind, p_value int, p_pin text, p_reason_code text, p_order_item_id uuid default null, p_device_id text default null) returns jsonb language sql as $$ select null::jsonb $$;' };
  const f0049 = {
    file: '0049',
    sql: 'drop function if exists app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text);\ncreate function app.apply_discount(p_tab_id uuid, p_kind adjustment_kind, p_value int, p_pin text, p_reason_code text, p_order_item_id uuid default null, p_device_id text default null, p_idempotency_key text default null) returns jsonb language sql as $$ select null::jsonb $$;',
  };
  const f0115 = { file: '0115', sql: f0037.sql };
  const f0119 = {
    file: '0119',
    sql: 'drop function if exists app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text);\ncreate or replace function app.apply_discount(p_tab_id uuid, p_kind adjustment_kind, p_value int, p_pin text, p_reason_code text, p_order_item_id uuid default null, p_device_id text default null, p_idempotency_key text default null) returns jsonb language sql as $$ select null::jsonb $$;',
  };

  it('a re-issue at a dropped arity is a SECOND signature, not a replacement (the 0115 defect)', () => {
    const { live } = replaySignatures([f0037, f0049, f0115]);
    const sigs = live.get('apply_discount')!;
    expect([...sigs.keys()].sort()).toEqual([
      'uuid, adjustment_kind, integer, text, text, uuid, text',
      'uuid, adjustment_kind, integer, text, text, uuid, text, text',
    ]);
    expect(sigs.get('uuid, adjustment_kind, integer, text, text, uuid, text')).toBe('0115');
  });

  it('dropping the stray brings the name back to one signature (0119)', () => {
    const { live, misses } = replaySignatures([f0037, f0049, f0115, f0119]);
    expect([...live.get('apply_discount')!.keys()]).toEqual(['uuid, adjustment_kind, integer, text, text, uuid, text, text']);
    expect(misses).toEqual([]);
  });

  it('a create or replace at an EXISTING arity replaces in place', () => {
    const { live } = replaySignatures([f0037, f0049, f0119]);
    expect(live.get('apply_discount')!.size).toBe(1);
  });

  it('reports a drop aimed at an arity that was never created while the name lives on', () => {
    const wrong = { file: 'x', sql: 'drop function if exists app.apply_discount(uuid);' };
    const { live, misses } = replaySignatures([f0037, wrong]);
    expect(live.get('apply_discount')!.size).toBe(1);
    expect(misses).toEqual([{ file: 'x', name: 'apply_discount', sig: 'uuid' }]);
  });

  it('a drop without an argument list removes the one live signature of the name', () => {
    const { live, errors } = replaySignatures([f0037, f0049, { file: 'y', sql: 'drop function app.apply_discount;' }]);
    expect(live.has('apply_discount')).toBe(false);
    expect(errors).toEqual([]);
  });

  it('a drop without an argument list while the name is overloaded is an error, not a mass drop', () => {
    // Postgres: ERROR: function name "app.apply_discount" is not unique. The
    // migration would fail at apply time, so the replay must not pretend it
    // cleaned up — both signatures stay live and the gate names the file.
    const { live, errors } = replaySignatures([f0037, f0049, f0115, { file: 'y', sql: 'drop function app.apply_discount;' }]);
    expect(live.get('apply_discount')!.size).toBe(2);
    expect(errors).toEqual([
      {
        file: 'y',
        name: 'apply_discount',
        sigs: [
          'uuid, adjustment_kind, integer, text, text, uuid, text, text',
          'uuid, adjustment_kind, integer, text, text, uuid, text',
        ],
      },
    ]);
  });
});
