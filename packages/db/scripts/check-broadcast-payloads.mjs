/**
 * Broadcast payload gate — SEC-28.
 *
 * WHAT THE KDS ACTUALLY IS. `prep` is a staff role with its own login, standing
 * at a screen in the kitchen. It subscribes to the private `kds` topic and the
 * floor view subscribes to `floor`. Both are authorised by RLS on
 * realtime.messages (0022) — so the QUESTION is not "can prep subscribe", it is
 * "what arrives when they do".
 *
 * Prep needs to cook: what, how many, how long it has been waiting. Prep does
 * not need what it sold for, what the tab totals, or who the guest is. A
 * kitchen screen is the least physically secure display in the building — it
 * faces a room that suppliers and cleaners walk through — and it is the one
 * screen nobody logs out of.
 *
 * WHY A GATE RATHER THAN A TEST. Today every payload is already an explicit
 * `jsonb_build_object` with ids and statuses, verified 2026-09-07. Nothing is
 * broken. The risk is entirely in the FUTURE: the natural way to add a field to
 * a broadcast is to widen the object, and the natural way to make one quickly is
 * `to_jsonb(new)`. Either would ship money to the kitchen screen with nothing
 * objecting. This reads the catalog, so it sees a payload the moment it exists,
 * including one added by a migration nobody thought to review for this.
 *
 * Usage:  node scripts/check-broadcast-payloads.mjs
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

/**
 * Topics a STAFF screen subscribes to. `session:*` is the guest's own topic and
 * is judged by a different rule — a guest may of course learn their own order's
 * status. `courts` and `menu` are public-facing catalogue data.
 */
const STAFF_TOPICS = ['kds', 'floor'];

/**
 * Money and identity. Matched against payload KEYS, not values.
 *
 * `name` is deliberately absent: `table`/`key`/`kind` style metadata keys are
 * legitimate and a bare `name` match would fire on them. What must never appear
 * is a key naming a PERSON, so the guest/customer/phone/email forms are listed
 * explicitly instead.
 */
const FORBIDDEN = [
  /price/i, /total/i, /subtotal/i, /amount/i, /_iqd\b/i, /\biqd\b/i,
  /cost/i, /discount/i, /refund/i, /payment/i, /paid/i,
  /guest_name/i, /guest_phone/i, /customer/i, /\bphone\b/i, /email/i,
  /full_name/i, /profile_id/i, /guest_id/i,
];

/** Split on top-level commas, respecting nesting and quotes. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      cur += ch;
      if (ch === "'" && s[i + 1] === "'") { cur += s[++i]; continue; }
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") { quoted = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') { if (depth === 0) break; depth--; }
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const rows = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object('name', p.proname, 'src', p.prosrc)), '[]')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.prosrc like '%realtime.send%';`).trim(),
);

const sends = [];
for (const { name, src } of rows) {
  const re = /realtime\.send\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const args = splitArgs(src.slice(m.index + m[0].length));
    if (args.length < 3) continue;
    sends.push({ fn: name, payload: args[0], event: args[1], topic: args[2] });
  }
}

const findings = [];

for (const s of sends) {
  const flat = s.payload.replace(/\s+/g, ' ');

  // 1. Explicit payloads only. to_jsonb(new) / row_to_json(new) ship whatever
  //    the table happens to hold today AND whatever a later migration adds.
  if (/\b(to_jsonb|row_to_json)\s*\(\s*(new|old)\b/i.test(flat)) {
    findings.push({
      fn: s.fn, topic: s.topic, kind: 'whole-row',
      detail: 'payload is a whole row; a column added later ships automatically',
      snippet: flat.slice(0, 120),
    });
    continue;
  }
  if (!/jsonb_build_object\s*\(/i.test(flat)) {
    findings.push({
      fn: s.fn, topic: s.topic, kind: 'not-explicit',
      detail: 'payload is not a jsonb_build_object literal, so its keys cannot be checked here',
      snippet: flat.slice(0, 120),
    });
    continue;
  }

  // 2. Money and identity, on the staff topics.
  const staffTopic = STAFF_TOPICS.some((t) => new RegExp(`'${t}'`).test(s.topic));
  if (!staffTopic) continue;

  const keys = [...flat.matchAll(/'([a-z0-9_]+)'\s*,/gi)].map((k) => k[1]);
  for (const key of keys) {
    const hit = FORBIDDEN.find((r) => r.test(key));
    if (hit) {
      findings.push({
        fn: s.fn, topic: s.topic, kind: 'forbidden-key',
        detail: `'${key}' on a staff topic — prep does not need it and the kitchen screen is the least secure display in the building`,
        snippet: flat.slice(0, 120),
      });
    }
  }
}

console.log(`Broadcast payload gate — SEC-28`);
console.log(`  realtime.send call sites   ${sends.length}`);
console.log(`  staff topics guarded       ${STAFF_TOPICS.join(', ')}`);
for (const s of sends) {
  const t = s.topic.replace(/\s+/g, ' ').slice(0, 40);
  console.log(`    ${s.fn.padEnd(24)} -> ${t}`);
}

if (sends.length === 0) {
  console.error('\nFAIL  no realtime.send call sites found at all — the parser or the schema moved.');
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\nFAIL  ${findings.length} broadcast payload problem(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.fn}  [${f.kind}]  topic ${f.topic}`);
    console.error(`      ${f.detail}`);
    console.error(`      ${f.snippet}`);
    console.error('');
  }
  console.error('Send an explicit jsonb_build_object naming only what the screen needs.');
  console.error('Prep needs what to cook and how long it has waited — never what it sold for,');
  console.error('what the tab totals, or who the guest is.');
  process.exit(1);
}

console.log('\nPASS  every payload is explicit, and no money or identity reaches a staff topic.');
