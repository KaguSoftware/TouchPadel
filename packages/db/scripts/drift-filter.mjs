/**
 * Filters `supabase db diff --linked` output for db-drift.yml: drops the
 * objects the Supabase PLATFORM creates on the hosted project, which no
 * migration here owns, and prints what is left.
 *
 * Until 2026-10-01 the drift job treated every statement as drift, so a
 * platform function (`public.rls_auto_enable`, the event-trigger helper behind
 * the dashboard's "automatically enable RLS" setting) kept the job red every
 * night next to the two real differences — and a gate that is always red is a
 * gate nobody reads. A new platform object goes on PLATFORM_OWNED with the
 * reason; anything else stays drift.
 *
 * Usage:  node scripts/drift-filter.mjs < drift.sql > drift.filtered.sql
 * Prints the dropped objects on stderr.
 */
import { readFileSync } from 'node:fs';

/** Qualified object names the platform owns, lower-case. */
const PLATFORM_OWNED = new Map([
  ['public.rls_auto_enable', 'Supabase dashboard: "Enable automatic RLS" event-trigger function (platform-created, not in any migration)'],
]);

const sql = readFileSync(0, 'utf8');

/**
 * Split on statement boundaries the way `db diff` prints them: a statement ends
 * at a line that is just `;`, or at a `;` closing a line outside a
 * dollar-quoted body.
 */
function statements(text) {
  const out = [];
  let buf = [];
  let dollar = null;
  for (const line of text.split(/\r?\n/)) {
    buf.push(line);
    const tags = line.match(/\$[A-Za-z0-9_]*\$/g) ?? [];
    for (const tag of tags) {
      if (dollar === null) dollar = tag;
      else if (tag === dollar) dollar = null;
    }
    if (dollar === null && /;\s*$/.test(line)) {
      out.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.join('').trim()) out.push(buf.join('\n'));
  return out;
}

const kept = [];
for (const stmt of statements(sql)) {
  const name = /(?:function|trigger|table|view|event\s+trigger)\s+(?:if\s+(?:not\s+)?exists\s+)?("?[\w]+"?\.)?"?([\w]+)"?/i.exec(stmt);
  const qualified = name ? `${(name[1] ?? 'public.').replace(/"/g, '')}${name[2]}`.toLowerCase() : null;
  if (qualified && PLATFORM_OWNED.has(qualified)) {
    console.error(`drift-filter: ignored ${qualified} — ${PLATFORM_OWNED.get(qualified)}`);
    continue;
  }
  kept.push(stmt);
}
process.stdout.write(kept.join('\n'));
