/**
 * 0255 outbox_match_kinds, outbox_lesson_kinds and tournaments_schema_money — notification_outbox.kind
 * is a closed CHECK, and every kind it admits has copy in the deployed send-push
 * (docs/design/open-matches/guest.md §4.4, docs/design/coaching/guest.md §4.4,
 * docs/design/tournaments/build-contracts-2026-10-03.md §1.10: tournament_update).
 *
 * send-push treats a kind it does not know as terminal (index.ts), so a kind
 * the CHECK admits without copy is a push that silently never arrives. Here
 * the CHECK's own list, read from the catalog, must equal the booking kinds
 * (STRINGS in send-push/index.ts) ∪ _shared/staff-push.json `kinds` ∪
 * _shared/guest-push.json `kinds`: a new kind without copy fails CI instead of
 * failing on hosted.
 *
 * Needs the local stack and docker on PATH (psql in the stack's container);
 * every insert is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import staffPush from '../supabase/functions/_shared/staff-push.json';
import guestPush from '../supabase/functions/_shared/guest-push.json';
import { stackAvailable } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(resolve(here, '../supabase/functions/send-push/index.ts'), 'utf8');

/** The booking family (and `test`): copy in send-push/index.ts STRINGS. */
const BOOKING_KINDS = [
  'booking_confirmed',
  'booking_reminder',
  'booking_cancelled',
  'booking_no_show',
  'test',
  'deposit_refunded',
];
const ALL_KINDS = [...BOOKING_KINDS, ...staffPush.kinds, ...guestPush.kinds];

/** The kinds the live CHECK admits, parsed from its definition. */
function checkKinds(): string[] {
  const def = psql(`
    select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'notification_outbox_kind_check'
       and conrelid = 'public.notification_outbox'::regclass;`);
  return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!).sort();
}

/** Try one insert per kind inside a rolled-back transaction: kind → admitted. */
function tryKinds(kinds: string[]): Record<string, boolean> {
  const list = kinds.map((k) => `'${k}'`).join(', ');
  const out = psql(`
    begin;
    create temp table r (kind text, ok boolean) on commit drop;
    do $t$
    declare
      k   text;
      pid uuid := (select id from profiles order by created_at limit 1);
    begin
      if pid is null then raise exception 'no profile to address'; end if;
      foreach k in array array[${list}]::text[] loop
        begin
          insert into notification_outbox (profile_id, kind, payload, scheduled_for)
          values (pid, k, '{}'::jsonb, now() + interval '1 day');
          insert into r values (k, true);
        exception when check_violation then
          insert into r values (k, false);
        end;
      end loop;
    end $t$;
    select coalesce(string_agg(kind || '=' || ok, ',' order by kind), '') from r;
    rollback;`);
  const line = out.split('\n').filter(Boolean).pop() ?? '';
  return Object.fromEntries(
    line.split(',').filter(Boolean).map((pair) => {
      const [k, ok] = pair.split('=');
      return [k!, ok === 'true'];
    }),
  );
}

describe('notification_outbox kinds (0255, outbox_lesson_kinds)', () => {
  it('lists every booking kind in send-push STRINGS, in both languages', () => {
    const strings = INDEX.slice(INDEX.indexOf('const STRINGS'), INDEX.indexOf('function formatWhen'));
    for (const lang of ['en', 'ar']) {
      const block = strings.slice(strings.indexOf(`  ${lang}: {`));
      for (const kind of BOOKING_KINDS) expect(block, `${lang}.${kind}`).toMatch(new RegExp(`^\\s+${kind}: \\{`, 'm'));
    }
  });

  it('keeps the three families disjoint', () => {
    expect(new Set(ALL_KINDS).size).toBe(ALL_KINDS.length);
  });

  it.skipIf(!docker)('admits exactly the kinds send-push has copy for', () => {
    expect(checkKinds()).toEqual([...ALL_KINDS].sort());
    expect(checkKinds()).toHaveLength(17);
  });

  it.skipIf(!docker)('accepts each of the 17 kinds and refuses an unknown one', () => {
    const got = tryKinds([...ALL_KINDS, 'match_bogus']);
    for (const kind of ALL_KINDS) expect(got[kind], kind).toBe(true);
    expect(got.match_bogus).toBe(false);
  });
});
