import { describe, expect, it, vi } from 'vitest';
import { fetchMyLoyalty, fetchMyMemberCard, rotateMemberCard } from '../api';

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
});
