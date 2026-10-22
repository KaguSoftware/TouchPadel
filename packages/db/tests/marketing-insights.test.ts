/**
 * marketing_insights (0360): the marketing role's Insights page.
 *
 *   * marketing and the owner read it; every other role is FORBIDDEN;
 *   * a marketing caller reaches the owner's analytics_* reads only inside it:
 *     called directly they still answer FORBIDDEN, and the transaction-local
 *     app.marketing_read assertion is cleared before it returns;
 *   * the payload carries no money and no exact count: every number in it is
 *     a weekday, an hour, a level (0..4), a share rounded to 5 or 10, an
 *     about-N rounded count, a weekly index (0..100) or the lapse window;
 *   * a backwards range is INVALID_RANGE.
 *
 * HOW. One psql transaction per scenario, rolled back: the seeded cashier is
 * made marketing inside it (the seed has no marketing account) and each call
 * runs as `authenticated` with that person's JWT claims. Without docker on
 * PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
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

const MARKETING = SEED_STAFF_IDS.cashier;

/** Runs `sql` as `who` inside a rolled-back transaction where the seeded cashier is marketing; returns its one text result, or `ERR:<message>`. */
function as(who: string, sql: string): string {
  const out = psql(`
begin;
update staff set role = 'marketing' where id = '${MARKETING}';
create temp table res (v text);
do $t$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '${who}', 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select (${sql})::text into v;
  exception when others then
    v := 'ERR:' || sqlerrm;
  end;
  reset role;
  insert into res values (v);
end $t$;
select v from res;
rollback;`);
  return out.split('\n').filter((l) => l !== '' && l !== 'BEGIN' && l !== 'ROLLBACK').pop() ?? '';
}

const CALL = `app.marketing_insights(current_date - 90, current_date, current_date - 181, current_date - 91)`;

/** Every [path, number] in a JSON value. */
function numbers(v: unknown, path = ''): [string, number][] {
  if (typeof v === 'number') return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => numbers(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => numbers(x, path ? `${path}.${k}` : k));
  return [];
}

describe.skipIf(!docker)('0360 marketing_insights', () => {
  it('marketing and the owner read it; a cashier and the court desk do not', () => {
    expect(as(MARKETING, `${CALL} ? 'demand'`)).toBe('true');
    expect(as(SEED_STAFF_IDS.owner, `${CALL} ? 'demand'`)).toBe('true');
    expect(as(SEED_STAFF_IDS.court_desk, CALL)).toBe('ERR:FORBIDDEN');
    expect(as(SEED_STAFF_IDS.manager, CALL)).toBe('ERR:FORBIDDEN');
  });

  it('marketing still cannot call the owner analytics directly, and the assertion is cleared', () => {
    expect(as(MARKETING, `app.analytics_courts_summary(current_date - 7, current_date, null)`)).toBe('ERR:FORBIDDEN');
    expect(as(MARKETING, `(select coalesce(current_setting('app.marketing_read', true), '') from (select ${CALL}) x)`)).toBe('');
  });

  it('carries no money and no exact count', () => {
    const payload = JSON.parse(as(MARKETING, CALL)) as Record<string, unknown>;
    const allowed = /(\.|^)(dow|hour|level|fillLevel|share|newShare|returningShare|appShare|deskShare|crossoverShare|redeemingShare|courts|cafe|shop|value|newIdx|returningIdx|lapseDays)$/;
    for (const [path, n] of numbers(payload)) {
      expect(path, `${path} = ${n}`).toMatch(allowed);
      if (/Share$|share$|^mix\./.test(path)) expect(n % 5, path).toBe(0);
      if (path.endsWith('.value')) expect(n === 0 || n >= 10, path).toBe(true);
    }
    expect(JSON.stringify(payload)).not.toMatch(/iqd/i);
  });

  it('refuses a backwards range', () => {
    expect(as(MARKETING, `app.marketing_insights(current_date, current_date - 1, current_date - 2, current_date - 1)`)).toBe('ERR:INVALID_RANGE');
  });
});
