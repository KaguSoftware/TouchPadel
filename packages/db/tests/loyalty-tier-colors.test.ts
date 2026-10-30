/**
 * Loyalty tier colours and gifted points (20261031000375_loyalty_tier_colors.sql):
 *
 *   * a tier carries a colour from the closed list (TIER_COLORS, @touch/core/loyalty), classic
 *     by default; the owner sets it on a create and an edit, an edit without it keeps it, an
 *     unknown one is INVALID_VALUE; loyalty_admin, my_loyalty (tier and next_tier) and
 *     loyalty_customer carry it;
 *   * points given by hand (kind adjust) move the tier again, as earned points do, and a hand
 *     deduction moves it back down.
 *
 * Each case is one rolled-back psql transaction (stores-harness `scenario`). Without docker the
 * suite skips.
 */
import { describe, expect, it } from 'vitest';
import { TIER_COLORS } from '../../core/src/loyalty/tierColors';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, Q, refused, scenario, T, X, type Results } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

function phone(): string {
  return `+96477${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

const PRE = String.raw`
set constraints all immediate;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

create function pg_temp.guest(p_name text, p_phone text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role, phone, phone_confirmed_at)
  values (v, 'tc-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'TC ' || p_name),
          'authenticated', 'authenticated', app.phone_digits(p_phone), now());
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- A ledger row of p_kind for a guest (earn: a made-up tab; adjust: a hand gift).
create function pg_temp.pts(p_guest text, p_delta int, p_kind text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note)
  values (pg_temp.var(p_guest)::uuid, p_delta, p_kind, case when p_kind = 'earn' then 'tab' else 'adjust' end,
          gen_random_uuid(), 'fixture');
end $f$;

update loyalty_settings set enabled = true where id;
`;

const GUEST = (name: string) => `select pg_temp.guest('${name}', '${phone()}');`;
const PTS = (guest: string, delta: number, kind: 'earn' | 'adjust') =>
  X(`select pg_temp.pts('${guest}', ${delta}, '${kind}')`);
const TIER = (label: string, body: string) =>
  T(label, 'owner', `select app.upsert_loyalty_tier('${body}'::jsonb)`);

function run(tag: string, body: string[]): Results {
  return scenario(tag, [PRE, ...body]);
}

describe('the closed colour list', () => {
  it('is the one the migration checks', () => {
    expect([...TIER_COLORS]).toEqual(['classic', 'bronze', 'silver', 'gold', 'platinum', 'black']);
  });
});

describe.skipIf(!docker)('loyalty tier colours (0376)', () => {
  it('sets, keeps and refuses a tier colour, and every tier answer carries it', () => {
    const r = run('tc-color', [
      GUEST('g1'),
      TIER('gold', '{"name_en":"TC Gold","name_ar":"ذهبي","min_points_12m":100,"sort":1,"color":"gold"}'),
      TIER('plain', '{"name_en":"TC Plain","name_ar":"عادي","min_points_12m":900,"sort":2}'),
      TIER('black', '{"name_en":"TC Black","name_ar":"أسود","min_points_12m":500,"sort":3,"color":"black"}'),
      KEEP('gold_id', `select id::text from loyalty_tiers where name_en = 'TC Gold'`),
      // an edit that leaves the colour out keeps it
      T(
        'edit',
        'owner',
        `select app.upsert_loyalty_tier(jsonb_build_object('id', {{gold_id}}, 'min_points_12m', 120))`,
      ),
      T(
        'bad',
        'owner',
        `select app.upsert_loyalty_tier(jsonb_build_object('id', {{gold_id}}, 'color', 'purple'))`,
      ),
      T(
        'mgr',
        'manager',
        `select app.upsert_loyalty_tier(jsonb_build_object('id', {{gold_id}}, 'color', 'silver'))`,
      ),
      T('admin', 'manager', `select app.loyalty_admin()`),
      PTS('g1', 130, 'earn'),
      T('mine', 'g1', `select app.my_loyalty()`),
      T('customer', 'cashier', `select app.loyalty_customer({{g1}})`),
    ]);
    expect(ok(r, 'gold')).toMatchObject({ name_en: 'TC Gold', color: 'gold' });
    expect(ok(r, 'plain')).toMatchObject({ color: 'classic' });
    expect(ok(r, 'black')).toMatchObject({ color: 'black' });
    expect(ok(r, 'edit')).toMatchObject({ min_points_12m: 120, color: 'gold' });
    expect(refused(r, 'bad')).toBe('INVALID_VALUE');
    expect(refused(r, 'mgr')).toBe('FORBIDDEN');

    const admin = ok<{ tiers: Array<{ name_en: string; sort: number; color: string }> }>(r, 'admin');
    expect(admin.tiers.find((t) => t.sort === 0)?.color).toBe('classic');
    expect(
      Object.fromEntries(
        admin.tiers.filter((t) => t.name_en.startsWith('TC ')).map((t) => [t.name_en, t.color]),
      ),
    ).toEqual({ 'TC Gold': 'gold', 'TC Black': 'black', 'TC Plain': 'classic' });

    const mine = ok<{ tier: { name_en: string; color: string }; next_tier: { name_en: string; color: string } }>(
      r,
      'mine',
    );
    expect(mine.tier).toMatchObject({ name_en: 'TC Gold', color: 'gold' });
    expect(mine.next_tier).toMatchObject({ name_en: 'TC Black', color: 'black' });
    expect(ok(r, 'customer')).toMatchObject({ tier: { name_en: 'TC Gold', color: 'gold' } });
  });

  it('moves the tier on points given by hand, up and back down', () => {
    const r = run('tc-gift', [
      GUEST('g1'),
      TIER('gold', '{"name_en":"TC Gold","name_ar":"ذهبي","min_points_12m":100,"sort":1,"color":"gold"}'),
      PTS('g1', 150, 'adjust'),
      Q(
        'up',
        `select jsonb_build_object('points', a.points_12m, 'lifetime', a.lifetime_earned, 'tier', t.name_en)
           from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id where a.profile_id = {{g1}}::uuid`,
      ),
      PTS('g1', -100, 'adjust'),
      Q(
        'down',
        `select jsonb_build_object('points', a.points_12m, 'tier', t.sort)
           from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id where a.profile_id = {{g1}}::uuid`,
      ),
    ]);
    expect(ok(r, 'up')).toEqual({ points: 150, lifetime: 150, tier: 'TC Gold' });
    expect(ok(r, 'down')).toEqual({ points: 50, tier: 0 });
  });
});
