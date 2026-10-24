/**
 * 0369 customer_analytics (docs/design/customers/contracts-2026-10-24.md §2, §3): who our
 * customers are, added up.
 *
 *   * app.analytics_customers — the owner's People read: the crowd counted, how much of it the
 *     club actually knows (coveragePct), one row per gender, age band and level with its share,
 *     the claim against the judgment (agree / higher / lower), the derived interest tags, and
 *     segments where every group of fewer than five guests is folded into one `other` row, so no
 *     row can be narrowed down to a person; the owner alone reads it, and marketing may not;
 *   * app.marketing_insights.people — the same picture in words: an about-N crowd, a coverage
 *     level and percent, shares as whole percents, trends with their size, and the three biggest
 *     segments — with every bucket of fewer than ten guests left out, no money figure, no exact
 *     count and no identity anywhere in the payload.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker it skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, T, X } from './stores-harness';
import { BASE, BK, CG, code, out, OWN_BRANCH } from './customers-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

/**
 * A crowd the shares can be read off: eleven women (25–34, intermediate), five men (35–44,
 * beginner) and three the club knows nothing about, each with two bookings inside the window.
 * Eleven and five are chosen on purpose — a bucket of five is a segment of its own for the owner
 * (five guests or more) but is left out of marketing's shares (ten or more).
 */
const CROWD: string[] = [];
// One court holds one booking an hour, so every booking lands on its own weekday and week:
// the women keep 19:00, the men 20:00 and the unknowns 21:00, which is what the peak slots and
// the day-part words are read off. No booking falls on a Friday or a Saturday (dow 0..4), so the
// weekend word is never earned by accident.
for (let i = 0; i < 11; i += 1) {
  CROWD.push(
    CG(`w${i}`, 'intermediate', '25_34', 'female'),
    BK(`w${i}`, 2 + Math.floor(i / 5), 19, i % 5),
    BK(`w${i}`, 5 + Math.floor(i / 5), 19, i % 5),
  );
}
for (let i = 0; i < 5; i += 1) {
  CROWD.push(
    CG(`m${i}`, 'beginner', '35_44', 'male'),
    BK(`m${i}`, 2, 20, i % 5),
    BK(`m${i}`, 5, 20, i % 5),
  );
}
for (let i = 0; i < 3; i += 1) {
  CROWD.push(CG(`u${i}`, null, null, 'none'), BK(`u${i}`, 2, 21, i % 5), BK(`u${i}`, 5, 21, i % 5));
}

/** The branch of this case's own comes before BASE's court, which plants into it. */
const IN_OWN_BRANCH = [BASE[0]!, BASE[1]!, ...OWN_BRANCH, BASE[2]!];

const OWNER_READ = `app.analytics_customers(current_date - 60, current_date)`;
const MKT = `app.marketing_insights(current_date - 60, current_date, current_date - 121, current_date - 61)`;

interface Bucket {
  bucket: string;
  guests: number;
  share: number | null;
  plays?: number;
  judged?: number;
}
interface Known {
  guests: number;
  withGenders: number;
  withAges: number;
  withLevels: number;
  judgedLevels: number;
  plays: number;
  bookings: number;
  spend_iqd: number;
  coveragePct: number | null;
  newGuests: number;
  returningGuests: number;
}
interface Segment {
  who: string;
  band: string;
  level: string;
  guests: number;
  plays: number;
  spend_iqd: number;
}

/** Every [path, number] in a JSON value (the marketing wall's own measure). */
function numbers(v: unknown, path = ''): [string, number][] {
  if (typeof v === 'number') return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => numbers(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => numbers(x, path ? `${path}.${k}` : k));
  return [];
}

describe.skipIf(!docker)('0369 the owner’s People read', () => {
  it('counts the crowd, says how much of it the club knows, and shares it out', () => {
    const r = scenario('ca-owner', [
      ...IN_OWN_BRANCH,
      ...CROWD,
      T('owner', 'owner', `select ${OWNER_READ}`),
      T('manager', 'manager', `select ${OWNER_READ}`),
      T('desk', 'desk', `select ${OWNER_READ}`),
    ]);
    expect(code(r, 'manager')).toBe('FORBIDDEN');
    expect(code(r, 'desk')).toBe('FORBIDDEN');
    const p = out<Record<string, unknown>>(r, 'owner');

    const known = p.known as Known;
    expect(known.guests).toBe(19);
    expect(known.withGenders).toBe(16);
    expect(known.withAges).toBe(16);
    expect(known.withLevels).toBe(16);
    // Every one of the nineteen played twice; a play is a booking here.
    expect(known.plays).toBe(38);
    expect(known.bookings).toBe(38);
    // Sixteen of nineteen have all three facts.
    expect(known.coveragePct).toBe(84);
    expect(known.newGuests + known.returningGuests).toBe(19);

    const genders = p.genders as Bucket[];
    expect(genders.map((b) => [b.bucket, b.guests, b.share])).toEqual([
      ['female', 11, 58],
      ['male', 5, 26],
      ['unknown', 3, 16],
    ]);

    // The age bands keep their own order, youngest first, unknown last.
    const ages = p.ages as Bucket[];
    expect(ages.map((b) => b.bucket)).toEqual(['25_34', '35_44', 'unknown']);
    expect(ages[0]!.guests).toBe(11);

    const levels = p.levels as Bucket[];
    expect(levels.map((b) => b.bucket)).toEqual(['beginner', 'intermediate', 'unknown']);
    expect(levels.find((b) => b.bucket === 'intermediate')!.guests).toBe(11);
    expect(levels.every((b) => b.judged === 0)).toBe(true);

    // Two plays each earns `courts`, and nothing that needs three.
    const interests = p.interests as Bucket[];
    expect(interests.map((b) => [b.bucket, b.guests])).toEqual([['courts', 19]]);
  });

  it('folds a group of fewer than five guests into one other row', () => {
    const r = scenario('ca-fold', [
      ...IN_OWN_BRANCH,
      ...CROWD,
      // Two more, each their own tiny group: both must disappear into `other`.
      CG('solo1', 'advanced', 'u18', 'female'),
      BK('solo1', 2, 18, 0),
      BK('solo1', 5, 18, 0),
      CG('solo2', 'new', '55_plus', 'male'),
      BK('solo2', 2, 18, 1),
      BK('solo2', 5, 18, 1),
      T('owner', 'owner', `select ${OWNER_READ}`),
    ]);
    const segments = out<Record<string, unknown>>(r, 'owner').segments as Segment[];
    const keys = segments.map((s) => `${s.who}/${s.band}/${s.level}`);
    expect(keys).toContain('female/25_34/intermediate');
    expect(keys).toContain('male/35_44/beginner');
    // The two singles and the three unknowns are one `other` row of five guests.
    const other = segments.find((s) => s.who === 'other');
    expect(other, JSON.stringify(segments)).toBeTruthy();
    expect(other).toMatchObject({ who: 'other', band: 'other', level: 'other', guests: 5 });
    expect(keys).not.toContain('female/u18/advanced');
    expect(keys).not.toContain('male/55_plus/new');
    expect(segments.length).toBeLessThanOrEqual(12);
  });

  it('answers the claim against the judgment', () => {
    const r = scenario('ca-judged', [
      ...IN_OWN_BRANCH,
      ...CROWD,
      // One over-claimer, one who agrees, one judged without ever claiming.
      T('down', 'desk', `select app.staff_set_customer_level({{w0}}::uuid, 'beginner')`),
      T('same', 'desk', `select app.staff_set_customer_level({{w1}}::uuid, 'intermediate')`),
      T('up', 'desk', `select app.staff_set_customer_level({{m0}}::uuid, 'advanced')`),
      T('unclaimed', 'desk', `select app.staff_set_customer_level({{u0}}::uuid, 'intermediate')`),
      T('owner', 'owner', `select ${OWNER_READ}`),
    ]);
    const p = out<Record<string, unknown>>(r, 'owner');
    expect(p.judged).toEqual({ checked: 4, agree: 1, higher: 1, lower: 1, unclaimed: 1 });
    expect((p.known as Known).judgedLevels).toBe(4);
    // The judged levels are what the buckets go by: w0 moved to beginner.
    const levels = p.levels as Bucket[];
    expect(levels.find((b) => b.bucket === 'beginner')!.guests).toBe(5);
    expect(levels.find((b) => b.bucket === 'intermediate')!.guests).toBe(11);
  });

  it('names each bucket’s busiest slots and its new against returning guests', () => {
    const r = scenario('ca-peak', [...BASE, ...CROWD, T('owner', 'owner', `select ${OWNER_READ}`)]);
    const p = out<Record<string, unknown>>(r, 'owner');
    const peak = p.peak as { key: string; dow: number; hour: number; plays: number }[];
    // Each bucket gets at most two slots, and the women played at 19:00.
    for (const key of ['female', 'male', '25_34', '35_44']) {
      expect(peak.filter((s) => s.key === key).length, key).toBeLessThanOrEqual(2);
    }
    const female = peak.filter((s) => s.key === 'female');
    expect(female.length).toBe(2);
    expect(female.every((s) => s.hour === 19)).toBe(true);
    const fresh = p.fresh as { key: string; newGuests: number; returningGuests: number }[];
    expect(fresh.find((f) => f.key === 'female')!.newGuests + fresh.find((f) => f.key === 'female')!.returningGuests)
      .toBe(11);
  });
});

describe.skipIf(!docker)('0369 the marketing people section', () => {
  it('is words and shares only, and leaves out a bucket under ten guests', () => {
    const r = scenario('ca-mkt', [
      ...IN_OWN_BRANCH,
      ...CROWD,
      // The seed has no marketing account; the cashier of this run becomes one.
      // The seed has no marketing account; the cashier of this run becomes one,
      // and is filed at THIS case's branch so marketing_insights analyses it
      // (app.analysis_venue reads the caller's own branches first).
      `update staff set role = 'marketing' where id = (select val::uuid from pg_temp.vars where name = 'cashier');`,
      X(`delete from staff_venues where staff_id = {{cashier}}::uuid`),
      X(`insert into staff_venues (staff_id, venue_id, role) values ({{cashier}}::uuid, {{venue}}::uuid, 'marketing')`),
      T('marketing', 'cashier', `select ${MKT}`),
      T('direct', 'cashier', `select ${OWNER_READ}`),
      T('cleared', 'cashier',
        `select to_jsonb(coalesce(current_setting('app.marketing_read', true), '')) from (select ${MKT}) x`),
    ]);
    // Marketing reaches the crowd only through its own read.
    expect(code(r, 'direct')).toBe('FORBIDDEN');
    expect(out<string>(r, 'cleared')).toBe('');

    const people = (out<Record<string, unknown>>(r, 'marketing').people ?? {}) as Record<string, unknown>;
    expect(people.known).toEqual({ kind: 'about', value: 20 });
    expect(people.coveragePct).toBe(84);
    expect(people.coverage).toBe(4);

    // Eleven women are a share; five men are nobody's business.
    expect(people.genders).toEqual([{ bucket: 'female', share: 58 }]);
    expect(people.ages).toEqual([{ bucket: '25_34', share: 58 }]);
    expect(people.levels).toEqual([{ bucket: 'intermediate', share: 58 }]);
    expect(people.interests).toEqual([{ bucket: 'courts', share: 100 }]);

    const top = people.top as { who: string; band: string; level: string; share: number }[];
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top[0]).toEqual({ who: 'female', band: '25_34', level: 'intermediate', share: 58 });
    expect(top.some((s) => s.who === 'other')).toBe(false);

    // Every figure is a share, a percent, a level or a trend's size — never a count or money.
    const allowed = /(\.|^)(share|coverage|coveragePct|judgedShare|overClaimedShare|value|\w*[tT]rendPct|\w*[tT]rendPts)$/;
    for (const [path, n] of numbers(people)) {
      expect(path, `${path} = ${n}`).toMatch(allowed);
      expect(Number.isInteger(n), path).toBe(true);
    }
    const json = JSON.stringify(people);
    expect(json).not.toMatch(/iqd/i);
    // No id of any kind: a uuid in a marketing payload would be a person.
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('says which buckets are growing, against the comparison window', () => {
    const r = scenario('ca-mkt-growing', [
      ...IN_OWN_BRANCH,
      ...CROWD,
      // The seed has no marketing account; the cashier of this run becomes one,
      // and is filed at THIS case's branch so marketing_insights analyses it
      // (app.analysis_venue reads the caller's own branches first).
      `update staff set role = 'marketing' where id = (select val::uuid from pg_temp.vars where name = 'cashier');`,
      X(`delete from staff_venues where staff_id = {{cashier}}::uuid`),
      X(`insert into staff_venues (staff_id, venue_id, role) values ({{cashier}}::uuid, {{venue}}::uuid, 'marketing')`),
      T('marketing', 'cashier', `select ${MKT}`),
    ]);
    const people = (out<Record<string, unknown>>(r, 'marketing').people ?? {}) as Record<string, unknown>;
    const growing = people.growing as { bucket: string; trend: string; trendPct: number | null }[];
    // Nobody played in the comparison window, so every bucket of ten or more is up from nothing,
    // and a percent change off a zero baseline is not a number anyone should print.
    expect(growing.map((g) => g.bucket).sort()).toEqual(['courts', 'female', '25_34', 'intermediate'].sort());
    for (const g of growing) {
      expect(g.trend).toBe('up');
      expect(g.trendPct).toBeNull();
    }
  });
});
