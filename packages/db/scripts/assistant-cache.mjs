#!/usr/bin/env node
/**
 * The owner assistant's stored-days cache (migration 0330): "cache init" and
 * its companions. The cache ships EMPTY and OFF; nothing here runs by itself
 * except the nightly top-up (cron tp_assistant_cache_fill, a no-op while off).
 *
 * Usage (service role; SUPABASE_URL defaults to the local stack):
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/assistant-cache.mjs <command>
 *
 *   status                      switch, freeze lag, and days stored per scope
 *   init   [--batch=31]         switch the cache ON and fill it, repeating until
 *                               every closed day (up to two years back) is kept
 *   fill   [--batch=31]         one top-up round (what the nightly cron does)
 *   invalidate <from> <to>      drop stored days (YYYY-MM-DD) to be recomputed,
 *                               after a backdated correction; the next fill
 *                               stores them again
 *   clear                       empty the cache and switch it OFF
 *
 * Each call stores at most --batch days per scope-round and the script calls
 * again until the database says done, so no single request runs long.
 */
const BASE = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Long-standing `supabase start` demo key (local only — no secret value).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--'));
const batch = Number(args.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? 31);

async function rpc(name, body = {}) {
  const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'app', 'Accept-Profile': 'app' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function loop(first) {
  let result = await rpc(first, { p_max_days: batch });
  let stored = result.filled;
  console.log(`  stored ${result.filled}, ${result.pending ?? '?'} still to do`);
  while (!result.done && !result.busy && result.filled > 0) {
    result = await rpc('assistant_cache_fill', { p_max_days: batch });
    stored += result.filled;
    console.log(`  stored ${result.filled}, ${result.pending ?? '?'} still to do`);
  }
  if (result.busy) console.log('  another fill is running; try again in a minute');
  console.log(result.done ? `done: ${stored} day(s) stored in this run` : `stopped with work left (${stored} stored); run it again`);
}

switch (command) {
  case 'status':
    console.log(JSON.stringify(await rpc('assistant_cache_status'), null, 2));
    break;
  case 'init':
    console.log('Switching the stored-days cache on and filling it…');
    await loop('assistant_cache_init');
    break;
  case 'fill':
    await loop('assistant_cache_fill');
    break;
  case 'invalidate': {
    const [from, to] = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    if (!from || !to) throw new Error('usage: invalidate <from YYYY-MM-DD> <to YYYY-MM-DD>');
    console.log(`dropped ${await rpc('assistant_cache_invalidate', { p_from: from, p_to: to })} stored day(s)`);
    break;
  }
  case 'clear':
    console.log(`removed ${await rpc('assistant_cache_clear')} stored day(s); the cache is off`);
    break;
  default:
    console.error('usage: node scripts/assistant-cache.mjs status | init | fill | invalidate <from> <to> | clear');
    process.exit(2);
}
