/**
 * Function-signature replay over the migrations — the static half of the
 * overload gate (0119).
 *
 * WHY THIS EXISTS. Postgres overloads by argument types: `create or replace
 * function app.f(a uuid)` REPLACES `app.f(uuid)` but CREATES a second function
 * beside `app.f(uuid, text)`. 0115 re-issued `apply_discount` and
 * `override_price` at arities 0049 had dropped, so two live overloads of each
 * name shipped in `1daa960`: keyed callers ran the old body, keyless callers got
 * PostgREST PGRST203, and neither the grant-driven registry gate nor the authz
 * sweep could see it, because the strays carried no grant (0003 default
 * privileges). This module lets `check-rpc-registry.mjs` replay every
 * `create [or replace] function app.X(...)` and `drop function app.X(...)` in
 * file order, so a name that ends with more than one signature fails the build
 * before any database exists.
 *
 * Pure: no I/O, no process state. Imported by the gate and by
 * tests/fn-signatures.test.ts.
 */

/**
 * Remove `--` comments, block comments, and dollar-quoted bodies (replaced by
 * ` $body$ `), and neutralise single-quoted strings to `''`. Everything that
 * remains is DDL text, so a `create function` in a comment or inside a body
 * (a DO block, a plpgsql string) cannot produce an event. Same scan as
 * check-migrations.mjs statements(), minus the line bookkeeping.
 */
export function stripSqlNoise(sql) {
  let out = '';
  let i = 0;
  let dollarTag = null;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        out += ' $body$ ';
      } else {
        i += 1;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += " '' ";
      continue;
    }
    const dq = ch === '$' ? sql.slice(i, i + 80).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/) : null;
    if (dq) {
      dollarTag = dq[0];
      i += dq[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Index of the `)` that closes the list starting just after an `(`, or -1. */
function closingParen(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split an argument list at depth-0 commas outside single-quoted strings.
 * signatureEvents() feeds stripped text (strings already `''`), but
 * normalizeArgs() is also called on raw lists, where `default '{60,90,120}'`
 * must stay one parameter.
 */
function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let buf = '';
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (quoted) {
      buf += ch;
      if (ch === "'") {
        if (list[i + 1] === "'") {
          buf += "'";
          i += 1;
        } else {
          quoted = false;
        }
      }
      continue;
    }
    if (ch === "'") quoted = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

/** Cut a parameter at its default (`default x` or `= x`). */
function stripDefault(seg) {
  const m = seg.match(/\s+default\s+|\s*=\s*/i);
  return m ? seg.slice(0, m.index) : seg;
}

/**
 * Words that START a multi-word type name. A first token outside this set,
 * followed by more tokens, is a parameter name (this repo names every
 * parameter `p_*`; `drop function` lists usually carry types only).
 */
const TYPE_LEADERS = new Set(['timestamp', 'double', 'character', 'time', 'bit', 'interval', 'numeric', 'decimal', 'varchar']);

/** Postgres canonical spellings, as pg_get_function_identity_arguments prints them. */
const TYPE_ALIASES = {
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  char: 'character',
  varchar: 'character varying',
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  time: 'time without time zone',
  timetz: 'time with time zone',
  float: 'double precision',
  float8: 'double precision',
  float4: 'real',
  decimal: 'numeric',
};

/**
 * `p_tab_id uuid, p_kind adjustment_kind, p_value int default 5, variadic roles staff_role[]`
 *   -> `uuid, adjustment_kind, integer, staff_role[]`
 * Names, defaults and modes are not part of a function's identity; OUT
 * parameters are dropped (Postgres ignores them for overload resolution).
 */
export function normalizeArgs(list) {
  const out = [];
  for (const raw of splitTopLevel(list)) {
    let seg = raw.replace(/\s+/g, ' ').trim();
    if (!seg) continue;
    seg = stripDefault(seg).trim();
    let toks = seg.toLowerCase().split(' ');
    const mode = toks[0];
    if (mode === 'out') continue;
    if (mode === 'in' || mode === 'inout' || mode === 'variadic') toks = toks.slice(1);
    if (toks.length >= 2 && !TYPE_LEADERS.has(toks[0])) toks = toks.slice(1);
    let type = toks.join(' ').replace(/\b(?:public|app|pg_catalog)\./g, '');
    type = type.replace(/\s*\[\s*\]/g, '[]');
    let arr = '';
    const am = type.match(/((?:\[\])+)$/);
    if (am) {
      arr = am[1];
      type = type.slice(0, -arr.length);
    }
    type = type.replace(/\(\s*\d+(?:\s*,\s*\d+)?\s*\)/g, '').replace(/\s+/g, ' ').trim();
    if (TYPE_ALIASES[type]) type = TYPE_ALIASES[type];
    out.push(type + arr);
  }
  return out.join(', ');
}

const FN_STATEMENT = /\b(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+app\.([a-z0-9_]+)\s*(\()?/gi;

/**
 * Every `create [or replace] function app.X(...)` and `drop function [if exists]
 * app.X(...)` in ALREADY-STRIPPED sql, in text order:
 *   { at, op: 'create' | 'drop', name, sig }
 * `sig` is the normalised type list; `null` on a `drop function app.X;` with no
 * list, which Postgres accepts only when the name is not overloaded and which
 * the replay treats as "drop every signature of that name".
 */
export function signatureEvents(clean) {
  const events = [];
  for (const m of clean.matchAll(FN_STATEMENT)) {
    const op = /^create/i.test(m[1]) ? 'create' : 'drop';
    const name = m[2].toLowerCase();
    if (!m[3]) {
      if (op === 'drop') events.push({ at: m.index, op, name, sig: null });
      continue;
    }
    const start = m.index + m[0].length;
    const end = closingParen(clean, start);
    if (end < 0) continue;
    events.push({ at: m.index, op, name, sig: normalizeArgs(clean.slice(start, end)) });
  }
  return events;
}

/**
 * Replay events from files given in order. Returns
 *   live:   Map<name, Map<sig, file>>   — the signatures that exist at the end
 *   misses: [{ file, name, sig }]        — drops that matched nothing while the
 *            name had OTHER live signatures (the 0115 mistake in reverse: a drop
 *            aimed at an arity that was never created)
 *   errors: [{ file, name, sigs }]       — a bare `drop function app.X;` (no
 *            argument list) issued while X had MORE THAN ONE live signature.
 *            Postgres refuses that statement ("function name is not unique"),
 *            so the migration would fail at apply time; the replay records it
 *            and leaves every signature in place. With exactly one live
 *            signature the bare drop removes it, as Postgres would.
 */
export function replaySignatures(files) {
  const live = new Map();
  const misses = [];
  const errors = [];
  for (const { file, sql } of files) {
    for (const e of signatureEvents(stripSqlNoise(sql))) {
      if (e.op === 'create') {
        if (!live.has(e.name)) live.set(e.name, new Map());
        live.get(e.name).set(e.sig, file);
        continue;
      }
      const sigs = live.get(e.name);
      if (!sigs) continue;
      if (e.sig === null) {
        if (sigs.size > 1) {
          errors.push({ file, name: e.name, sigs: [...sigs.keys()] });
          continue;
        }
        live.delete(e.name);
        continue;
      }
      if (sigs.has(e.sig)) {
        sigs.delete(e.sig);
        if (sigs.size === 0) live.delete(e.name);
      } else if (sigs.size > 0) {
        misses.push({ file, name: e.name, sig: e.sig });
      }
    }
  }
  return { live, misses, errors };
}
