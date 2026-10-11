#!/usr/bin/env node
/**
 * Loads the club's pre-system monthly reports (client-data/padel-monthly-2026/
 * reports.json) into legacy_reports + legacy_report_figures (migration 0331),
 * then reads every row back and compares it field by field with the JSON. Any
 * difference fails the run.
 *
 * Usage (service role; SUPABASE_URL defaults to the local stack):
 *   node scripts/db-legacy-reports.mjs [load|verify|remove] [--venue=<uuid>] [--hosted]
 *
 *   load    (default) upsert every report and figure, drop any figure of these
 *           reports the JSON no longer has, then verify
 *   verify  compare the database with the JSON, write nothing
 *   remove  delete these reports (their figures go with them)
 *
 * A SUPABASE_URL that is not the local stack is refused unless --hosted is
 * given: production is loaded only when Majed says so.
 */
import { allRows, DEFAULT_VENUE_ID } from './lib/legacy-reports.mjs';

const BASE = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Long-standing `supabase start` demo key (local only — no secret value).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) ?? 'load';
const venueId = args.find((a) => a.startsWith('--venue='))?.split('=')[1] ?? DEFAULT_VENUE_ID;
const hosted = args.includes('--hosted');

const host = new URL(BASE).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !hosted) {
  console.error(`[legacy-reports] refusing: ${host} is not the local stack. Pass --hosted to load it there.`);
  process.exit(2);
}

async function rest(method, path, body, prefer) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const { reports, figures } = allRows(venueId);
const ids = reports.map((r) => r.id);
const inIds = `in.(${ids.join(',')})`;

function same(a, b) {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a)) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return false;
}

async function verify() {
  const dbReports = await rest('GET', `legacy_reports?id=${inIds}&select=*`);
  const dbFigures = await rest('GET', `legacy_report_figures?report_id=${inIds}&select=*`);
  const problems = [];
  const fkey = (f) => `${f.report_id}/${f.source}/${f.position}`;
  for (const want of reports) {
    const got = dbReports.find((r) => r.id === want.id);
    if (!got) { problems.push(`report ${want.id} missing`); continue; }
    for (const [k, v] of Object.entries(want)) {
      if (!same(got[k], v)) problems.push(`report ${want.id} ${k}: db ${JSON.stringify(got[k])} != json ${JSON.stringify(v)}`);
    }
  }
  const byKey = new Map(dbFigures.map((f) => [fkey(f), f]));
  for (const want of figures) {
    const got = byKey.get(fkey(want));
    if (!got) { problems.push(`figure ${fkey(want)} missing`); continue; }
    for (const [k, v] of Object.entries(want)) {
      if (!same(got[k], v)) problems.push(`figure ${fkey(want)} ${k}: db ${JSON.stringify(got[k])} != json ${JSON.stringify(v)}`);
    }
  }
  const wanted = new Set(figures.map(fkey));
  for (const f of dbFigures) if (!wanted.has(fkey(f))) problems.push(`figure ${fkey(f)} is in the database but not in the JSON`);
  if (dbReports.length !== reports.length) problems.push(`${dbReports.length} reports in the database, ${reports.length} in the JSON`);
  if (problems.length) {
    console.error(`[legacy-reports] ${problems.length} difference(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[legacy-reports] verified: ${dbReports.length} reports and ${dbFigures.length} figures match the JSON exactly`);
}

switch (command) {
  case 'load': {
    const venue = await rest('GET', `venues?id=eq.${venueId}&select=id,name_en`);
    if (venue.length !== 1) {
      console.error(`[legacy-reports] no branch ${venueId} here`);
      process.exit(1);
    }
    await rest('POST', 'legacy_reports?on_conflict=id', reports, 'resolution=merge-duplicates,return=minimal');
    await rest('POST', 'legacy_report_figures?on_conflict=report_id,source,position', figures, 'resolution=merge-duplicates,return=minimal');
    const dbFigures = await rest('GET', `legacy_report_figures?report_id=${inIds}&select=report_id,source,position`);
    const wanted = new Set(figures.map((f) => `${f.report_id}/${f.source}/${f.position}`));
    for (const f of dbFigures) {
      if (!wanted.has(`${f.report_id}/${f.source}/${f.position}`)) {
        await rest('DELETE', `legacy_report_figures?report_id=eq.${f.report_id}&source=eq.${f.source}&position=eq.${f.position}`);
      }
    }
    console.log(`[legacy-reports] loaded ${reports.length} reports and ${figures.length} figures into ${venue[0].name_en} (${host})`);
    await verify();
    break;
  }
  case 'verify':
    await verify();
    break;
  case 'remove': {
    const gone = await rest('DELETE', `legacy_reports?id=${inIds}`, undefined, 'return=representation');
    console.log(`[legacy-reports] removed ${gone.length} report(s) and their figures (${host})`);
    break;
  }
  default:
    console.error('usage: node scripts/db-legacy-reports.mjs [load|verify|remove] [--venue=<uuid>] [--hosted]');
    process.exit(2);
}
