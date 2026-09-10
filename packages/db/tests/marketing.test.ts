/**
 * 0073 — campaigns, audiences and attribution.
 *
 * The claim under test is the honesty rule: a campaign that hands out a
 * promotion is measurable, one that does not is reported as reach only, and
 * the two are never collapsed into the same zero.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  SEED_STAFF,
  anonymousSessionClient,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0073 marketing', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  const madeCampaigns: string[] = [];
  const madeAudiences: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
  });

  afterAll(async () => {
    if (madeCampaigns.length) await svc.from('marketing_sends').delete().in('campaign_id', madeCampaigns);
    if (madeCampaigns.length) await svc.from('marketing_campaigns').delete().in('id', madeCampaigns);
    if (madeAudiences.length) await svc.from('marketing_audiences').delete().in('id', madeAudiences);
  });

  async function newCampaign(args: Record<string, unknown> = {}) {
    const res = outcome(
      await appRpc(owner, 'save_marketing_campaign', {
        p_id: null,
        p_name_en: 'Test campaign',
        p_name_ar: 'حملة اختبار',
        p_channel: 'telegram',
        p_starts_at: new Date().toISOString(),
        p_body_en: 'hello',
        p_body_ar: 'مرحبا',
        ...args,
      }),
    );
    if (res.ok) madeCampaigns.push(res.data as unknown as string);
    return res;
  }

  it('resolves an audience as a live rule, not a stored list', async () => {
    const res = outcome(
      await appRpc(owner, 'save_marketing_audience', {
        p_id: null,
        p_name_en: 'Arabic speakers',
        p_name_ar: 'الناطقون بالعربية',
        p_rule: { lang: 'ar' },
      }),
    );
    expect(res.ok, res.errorMessage).toBe(true);
    madeAudiences.push(res.data as unknown as string);

    const all = outcome(await appRpc(owner, 'marketing_audience_reach', { p_rule: {} }));
    const arabic = outcome(await appRpc(owner, 'marketing_audience_reach', { p_rule: { lang: 'ar' } }));
    expect(all.ok, all.errorMessage).toBe(true);
    // An empty rule constrains nothing, so it can only be a superset.
    expect(Number(all.data)).toBeGreaterThanOrEqual(Number(arabic.data));
  });

  it('keeps writes to the owner', async () => {
    const res = outcome(
      await appRpc(manager, 'save_marketing_campaign', {
        p_id: null,
        p_name_en: 'x',
        p_name_ar: 'س',
        p_channel: 'telegram',
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('FORBIDDEN');

    const read = outcome(await appRpc(manager, 'marketing_overview', {}));
    expect(read.ok).toBe(false);
  });

  it('refuses a cafe guest, who holds `authenticated` exactly as staff do', async () => {
    // Regression guard for the hole check:authz caught: audience reach counts
    // PROFILES, so an unguarded version let anyone who scanned a table QR size
    // the customer base and probe it a rule at a time.
    const guest = await anonymousSessionClient();
    const reach = outcome(await appRpc(guest, 'marketing_audience_reach', { p_rule: {} }));
    expect(reach.ok).toBe(false);
    expect(reach.errorMessage).toContain('FORBIDDEN');

    // ...and performance refuses BEFORE its NOT_FOUND lookup, so it cannot be
    // used as an oracle to enumerate campaign ids.
    const perf = outcome(
      await appRpc(guest, 'marketing_campaign_performance', { p_campaign: madeCampaigns[0] ?? crypto.randomUUID() }),
    );
    expect(perf.ok).toBe(false);
    expect(perf.errorMessage).toContain('FORBIDDEN');
  });

  it('rejects a channel that is not one', async () => {
    const res = await newCampaign({ p_channel: 'carrier_pigeon' });
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('BAD_CHANNEL');
  });

  it('reports a campaign with no promotion as NOT measurable, with nulls rather than zeros', async () => {
    const made = await newCampaign();
    expect(made.ok, made.errorMessage).toBe(true);
    const id = made.data as unknown as string;

    const perf = outcome(await appRpc(owner, 'marketing_campaign_performance', { p_campaign: id }));
    expect(perf.ok, perf.errorMessage).toBe(true);
    const p = perf.data as {
      attributable: boolean;
      redemptions: number | null;
      revenueIqd: number | null;
      sends: number;
    };
    expect(p.attributable).toBe(false);
    // The distinction the whole screen rests on.
    expect(p.redemptions).toBeNull();
    expect(p.revenueIqd).toBeNull();
    expect(p.sends).toBe(0);
  });

  it('counts sends as they are recorded', async () => {
    const id = madeCampaigns[madeCampaigns.length - 1]!;
    await svc.from('marketing_sends').insert([
      { campaign_id: id, recipients: 40, delivered: 38, failed: 2 },
      { campaign_id: id, recipients: 10, delivered: 10, failed: 0 },
    ]);
    const perf = outcome(await appRpc(owner, 'marketing_campaign_performance', { p_campaign: id }));
    expect(perf.data).toMatchObject({ sends: 50, delivered: 48, failed: 2 });
  });

  it('refuses to send a campaign whose message is not written, with a code the panel can read', async () => {
    // Regression: this used to fail as a raw check-constraint violation, which
    // carries no P0001 code, so the operator was told "something went wrong"
    // about a campaign whose real problem is an empty message.
    const made = await newCampaign({ p_name_en: 'Empty', p_name_ar: 'فارغة', p_body_en: '', p_body_ar: '' });
    expect(made.ok, made.errorMessage).toBe(true);
    const res = outcome(
      await appRpc(owner, 'set_campaign_status', { p_id: made.data as unknown as string, p_status: 'scheduled' }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('BODY_REQUIRED');
  });

  it('refuses to send a campaign with no start date', async () => {
    const made = await newCampaign({ p_name_en: 'Undated', p_name_ar: 'بلا تاريخ', p_starts_at: null });
    const res = outcome(
      await appRpc(owner, 'set_campaign_status', { p_id: made.data as unknown as string, p_status: 'scheduled' }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('START_REQUIRED');
  });

  it('moves status only along the lifecycle', async () => {
    const made = await newCampaign({ p_name_en: 'Lifecycle', p_name_ar: 'دورة' });
    const id = made.data as unknown as string;

    // draft cannot jump straight to live.
    const jump = outcome(await appRpc(owner, 'set_campaign_status', { p_id: id, p_status: 'live' }));
    expect(jump.ok).toBe(false);
    expect(jump.errorMessage).toContain('BAD_TRANSITION');

    for (const step of ['scheduled', 'live', 'ended']) {
      const res = outcome(await appRpc(owner, 'set_campaign_status', { p_id: id, p_status: step }));
      expect(res.ok, `${step}: ${res.errorMessage}`).toBe(true);
    }
    // Ended is terminal.
    const revive = outcome(await appRpc(owner, 'set_campaign_status', { p_id: id, p_status: 'live' }));
    expect(revive.ok).toBe(false);
  });

  it('locks a campaign once it has gone out', async () => {
    const made = await newCampaign({ p_name_en: 'Locked', p_name_ar: 'مقفلة' });
    const id = made.data as unknown as string;
    await appRpc(owner, 'set_campaign_status', { p_id: id, p_status: 'scheduled' });
    await appRpc(owner, 'set_campaign_status', { p_id: id, p_status: 'live' });

    const edit = outcome(
      await appRpc(owner, 'save_marketing_campaign', {
        p_id: id,
        p_name_en: 'Rewritten',
        p_name_ar: 'معاد',
        p_channel: 'telegram',
        p_starts_at: new Date().toISOString(),
        p_body_en: 'different',
        p_body_ar: 'مختلف',
      }),
    );
    expect(edit.ok).toBe(false);
    expect(edit.errorMessage).toContain('CAMPAIGN_LOCKED');
  });

  it('gives the owner an overview that ranks live work first', async () => {
    const res = outcome(await appRpc(owner, 'marketing_overview', {}));
    expect(res.ok, res.errorMessage).toBe(true);
    const data = res.data as {
      campaigns: { status: string }[];
      audiences: { reach: number }[];
      counts: { live: number; scheduled: number; draft: number };
    };
    const rank = (s: string) => ['live', 'scheduled', 'draft', 'ended'].indexOf(s);
    const ranks = data.campaigns.map((c) => rank(c.status)).filter((r) => r !== -1);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(typeof data.counts.live).toBe('number');
    // Audience reach is computed, so it is present on every row.
    expect(data.audiences.every((a) => typeof a.reach === 'number')).toBe(true);
  });

  it('names what was not found, instead of falling back to a generic error', async () => {
    // Codes not in MAPPED_CODES render as "Something went wrong", which tells
    // an owner nothing. Every existing migration uses an entity-specific code
    // (TAB_NOT_FOUND, COUNT_NOT_FOUND, ...); these follow that.
    const missing = crypto.randomUUID();
    const campaign = outcome(await appRpc(owner, 'set_campaign_status', { p_id: missing, p_status: 'scheduled' }));
    expect(campaign.errorMessage).toContain('CAMPAIGN_NOT_FOUND');

    const audience = outcome(
      await appRpc(owner, 'save_marketing_audience', {
        p_id: missing, p_name_en: 'x', p_name_ar: 'س', p_rule: {},
      }),
    );
    expect(audience.errorMessage).toContain('AUDIENCE_NOT_FOUND');
  });

  it('refuses a direct client write', async () => {
    const res = await owner.from('marketing_campaigns').insert({
      name_en: 'direct', name_ar: 'مباشر', channel: 'telegram', created_by: null,
    });
    expect(res.error).not.toBeNull();
  });
});
