import { describe, expect, it, vi } from 'vitest';
import { fetchMyDeals, fetchMyLoyalty, fetchMyMemberCard, pickDeal, rotateMemberCard } from '../api';
import { NO_DEALS } from '../deals';

/**
 * The loyalty call shapes (build contracts §1.3) on a stub client: the app schema, no arguments,
 * the answers parsed, a refusal thrown as it came.
 */
function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(function (this: unknown) {
    // PostgREST's rpc reads its own `this`: it must not be detached.
    expect(this).toBe(client.app);
    return Promise.resolve(result);
  });
  const app = { rpc };
  const client = { schema: vi.fn(() => app), app };
  return client;
}

const CARD = { member_code: '8F3K2QXM', secret_b32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', step: 30 };

describe('loyalty calls', () => {
  it('my_loyalty takes no argument and parses the answer', async () => {
    const client = rpcClient({ data: { enabled: true, balance: 7 }, error: null });
    const l = await fetchMyLoyalty(client as never);
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(client.app.rpc).toHaveBeenCalledWith('my_loyalty');
    expect(l).toMatchObject({ enabled: true, balance: 7, history: [] });
  });

  it('my_member_card and rotate_member_card answer a card', async () => {
    const client = rpcClient({ data: CARD, error: null });
    expect(await fetchMyMemberCard(client as never)).toEqual(CARD);
    expect(client.app.rpc).toHaveBeenCalledWith('my_member_card');
    expect(await rotateMemberCard(client as never)).toEqual(CARD);
    expect(client.app.rpc).toHaveBeenCalledWith('rotate_member_card');
  });

  it('a card answer that does not parse is an error, not "no card"', async () => {
    const client = rpcClient({ data: { member_code: 'x' }, error: null });
    await expect(fetchMyMemberCard(client as never)).rejects.toThrow('MEMBER_CARD_MALFORMED');
  });

  it('throws a refusal as it came', async () => {
    const refusal = { message: 'FORBIDDEN', code: 'P0001' };
    const client = rpcClient({ data: null, error: refusal });
    await expect(fetchMyLoyalty(client as never)).rejects.toBe(refusal);
  });

  // ── deals (0410) ────────────────────────────────────────────────────────────

  const DEAL = {
    id: 'd-1',
    name_en: 'Happy hour',
    name_ar: 'ساعة السعادة',
    type: 'percent',
    value: 20,
    state: 'open',
  };

  it('my_deals takes no argument and parses the answer', async () => {
    const client = rpcClient({ data: { picked_id: 'd-1', deals: [DEAL] }, error: null });
    const d = await fetchMyDeals(client as never);
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(client.app.rpc).toHaveBeenCalledWith('my_deals');
    expect(d.picked_id).toBe('d-1');
    expect(d.deals).toHaveLength(1);
    expect(d.deals[0]).toMatchObject({ id: 'd-1', picked: true, live_now: true });
  });

  it('a server without my_deals (PGRST202) reads as no deals, silently', async () => {
    const client = rpcClient({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function app.my_deals in the schema cache' },
    });
    await expect(fetchMyDeals(client as never)).resolves.toEqual(NO_DEALS);
  });

  it('any other my_deals failure is thrown as it came', async () => {
    const refusal = { message: 'ACCOUNT_REQUIRED', code: 'P0001' };
    const client = rpcClient({ data: null, error: refusal });
    await expect(fetchMyDeals(client as never)).rejects.toBe(refusal);
  });

  it('pick_deal sends the promotion id, and null to clear the pick', async () => {
    const client = rpcClient({ data: { picked_id: 'd-1', deals: [DEAL] }, error: null });
    const picked = await pickDeal(client as never, 'd-1');
    expect(client.app.rpc).toHaveBeenLastCalledWith('pick_deal', { p_promotion_id: 'd-1' });
    expect(picked.picked_id).toBe('d-1');

    const cleared = rpcClient({ data: { picked_id: null, deals: [DEAL] }, error: null });
    const after = await pickDeal(cleared as never, null);
    // The argument is sent even when null (PostgREST matches a function by its argument names).
    expect(cleared.app.rpc).toHaveBeenLastCalledWith('pick_deal', { p_promotion_id: null });
    expect(after.picked_id).toBeNull();
    expect(after.deals[0]?.picked).toBe(false);
  });

  it('pick_deal throws its refusals as they came, a missing function included', async () => {
    for (const refusal of [
      { message: 'DEAL_USED', code: 'P0001' },
      { message: 'DEAL_LOCKED', code: 'P0001' },
      { message: 'DEAL_UNAVAILABLE', code: 'P0001' },
      { message: 'Could not find the function', code: 'PGRST202' },
    ]) {
      const client = rpcClient({ data: null, error: refusal });
      await expect(pickDeal(client as never, 'd-1')).rejects.toBe(refusal);
    }
  });
});
