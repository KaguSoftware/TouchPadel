/**
 * staff_screenshot_report (0313) — the phone app tells the owner when a staff
 * member takes a screenshot.
 *
 *   * a cashier's report writes one audit row (staff.screenshot / screen / the
 *     page, actor = the cashier) and one screenshot_taken staff push to the
 *     owner, carrying the cashier's name and no page;
 *   * the same person and page again inside 15 minutes is audited again and
 *     pushes once;
 *   * a guest session is refused, another branch is VENUE_MISMATCH, an empty
 *     page or one with odd characters is INVALID_ARGUMENT;
 *   * the owner reads the row through audit_log_page (the phone's list).
 *
 * Audit rows are append-only, so a run leaves its rows behind under a unique
 * page name; the outbox rows it caused are deleted in afterAll.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const NOWHERE = '00000000-0000-4000-8000-00000000fade';
const PAGE = `/staff-test-${Date.now().toString(36)}`;

describe.skipIf(!up)('staff screenshot report (0313)', () => {
  const svc = serviceClient();

  afterAll(async () => {
    await svc
      .from('notification_outbox')
      .delete()
      .eq('profile_id', SEED_STAFF_IDS.owner)
      .eq('payload->>title_key', 'screenshot_taken');
  });

  it('a cashier’s report is audited and tells the owner once', async () => {
    const cashier = await signedInClient(SEED_STAFF.cashier);
    const first = outcome(await appRpc(cashier, 'log_staff_screenshot', { p_venue_id: VENUE_A_ID, p_route: PAGE }));
    expect(first.errorMessage).toBeUndefined();
    const again = outcome(await appRpc(cashier, 'log_staff_screenshot', { p_venue_id: VENUE_A_ID, p_route: PAGE }));
    expect(again.ok).toBe(true);

    const audit = await svc.from('audit_log').select('actor_id, actor_role, entity, entity_id, after').eq('action', 'staff.screenshot').eq('entity_id', PAGE);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(2);
    expect(audit.data![0]).toMatchObject({ actor_id: SEED_STAFF_IDS.cashier, actor_role: 'cashier', entity: 'screen', after: { route: PAGE } });

    const pushes = await svc
      .from('notification_outbox')
      .select('kind, payload')
      .eq('profile_id', SEED_STAFF_IDS.owner)
      .eq('payload->>title_key', 'screenshot_taken')
      .like('payload->>dedupe', `%${PAGE}`);
    expect(pushes.error).toBeNull();
    expect(pushes.data).toHaveLength(1);
    expect(pushes.data![0]!.kind).toBe('staff_info');
    // What a lock screen can show is the person only; the page lives in the dedupe key and the audit row.
    expect((pushes.data![0]!.payload as { params: Record<string, string> }).params).toEqual({ name: 'Dev Cashier' });
  });

  it('the owner reads it through the audit log', async () => {
    const owner = await signedInClient(SEED_STAFF.owner);
    const res = await appRpc(owner, 'audit_log_page', {
      p_from: new Date(Date.now() - 3600_000).toISOString(),
      p_to: new Date(Date.now() + 3600_000).toISOString(),
      p_action_prefix: 'staff.screenshot',
      p_limit: 50,
      p_offset: 0,
    });
    expect(res.error).toBeNull();
    const rows = (res.data as { rows?: { entityId: string; actorName: string | null }[] }).rows ?? [];
    expect(rows.some((r) => r.entityId === PAGE)).toBe(true);
  });

  it('refuses a guest, another branch and a bad page', async () => {
    const guest = await anonymousSessionClient();
    const g = outcome(await appRpc(guest, 'log_staff_screenshot', { p_venue_id: VENUE_A_ID, p_route: PAGE }));
    expect(g.ok).toBe(false);

    const cashier = await signedInClient(SEED_STAFF.cashier);
    const other = outcome(await appRpc(cashier, 'log_staff_screenshot', { p_venue_id: NOWHERE, p_route: PAGE }));
    expect(other.errorMessage).toContain('VENUE_MISMATCH');
    const empty = outcome(await appRpc(cashier, 'log_staff_screenshot', { p_venue_id: VENUE_A_ID, p_route: '  ' }));
    expect(empty.errorMessage).toContain('INVALID_ARGUMENT');
    const odd = outcome(await appRpc(cashier, 'log_staff_screenshot', { p_venue_id: VENUE_A_ID, p_route: '/a b;drop' }));
    expect(odd.errorMessage).toContain('INVALID_ARGUMENT');
  });
});
