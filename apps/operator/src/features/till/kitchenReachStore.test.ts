import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F-11 (0399): the flag reads app.kitchen_reach on every station, so the court
 * desk (whom the tickets policy leaves out) sees it too; a server before 0399
 * falls back to the table read.
 */
const appRpc = vi.fn();
vi.mock('../../lib/appRpc', () => ({
  appRpc: (...a: unknown[]) => appRpc(...a),
  isRpcMissing: (e: unknown) => (e as { code?: string })?.code === 'RPC_MISSING',
}));
const tableRows = vi.fn();
vi.mock('../../lib/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'gte', 'order']) q[k] = () => q;
  q.limit = () => Promise.resolve(tableRows());
  return { supabase: { from: () => q } };
});
vi.mock('../../lib/mutate', () => ({ isElectron: () => false }));
vi.mock('../../ipc/bridge', () => ({ touch: {} }));

const { fetchCloudTickets, fromReachRows } = await import('./kitchenReachStore');

beforeEach(() => {
  appRpc.mockReset();
  tableRows.mockReset();
});

const row = {
  id: 't1',
  status: 'queued' as const,
  created_at: '2026-11-01T10:00:00Z',
  kds_seen_at: null,
  tab_id: 'tab-1',
  idempotency_key: 'DESK-01:order.add_items:01J5XABCDEFGHJKMNPQRSTVWXY',
};

describe('kitchen reach read (0399)', () => {
  it('maps the RPC rows to the tickets the flag decides on', () => {
    expect(fromReachRows([row])).toEqual([
      {
        id: 't1',
        status: 'queued',
        createdAtMs: Date.parse('2026-11-01T10:00:00Z'),
        seenAtMs: null,
        tabId: 'tab-1',
        key: row.idempotency_key,
      },
    ]);
  });

  it('reads app.kitchen_reach, which any station may call', async () => {
    appRpc.mockResolvedValue([row]);
    const out = await fetchCloudTickets();
    expect(appRpc).toHaveBeenCalledWith('kitchen_reach', expect.objectContaining({ p_since: expect.any(String) }));
    expect(out[0]?.tabId).toBe('tab-1');
    expect(tableRows).not.toHaveBeenCalled();
  });

  it('falls back to the table read on a server before 0399', async () => {
    appRpc.mockRejectedValue({ code: 'RPC_MISSING' });
    tableRows.mockReturnValue({
      data: [{ ...row, tab_id: undefined, idempotency_key: undefined, order: { tab_id: 'tab-2', idempotency_key: null } }],
      error: null,
    });
    const out = await fetchCloudTickets();
    expect(out[0]?.tabId).toBe('tab-2');
  });

  it('any other failure is thrown (the poller keeps its last answer)', async () => {
    appRpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchCloudTickets()).rejects.toBeInstanceOf(TypeError);
  });
});
