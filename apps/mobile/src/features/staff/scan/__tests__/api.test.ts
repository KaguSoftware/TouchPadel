import { beforeEach, describe, expect, it, vi } from 'vitest';

const callStaffEdge = vi.fn();
vi.mock('../../api', () => ({ callStaffEdge, staffRpc: vi.fn() }));

const { StaffEdgeError } = await import('../../edge');
const { readScanned } = await import('../api');

describe('readScanned', () => {
  beforeEach(() => callStaffEdge.mockReset());

  it('asks once when the server answers, whatever it says (a second reading costs money)', async () => {
    callStaffEdge.mockResolvedValueOnce({ status: 'read' });
    await readScanned({ slip_id: 's1' }, 1);
    callStaffEdge.mockRejectedValueOnce(new StaffEdgeError('RECEIPT_READ_FAILED', 502));
    await readScanned({ slip_id: 's1' }, 1);
    expect(callStaffEdge).toHaveBeenCalledTimes(2);
  });

  it('tries once more when the request never reached the server, then lets it be', async () => {
    callStaffEdge.mockRejectedValueOnce(new TypeError('Network request failed'));
    callStaffEdge.mockResolvedValueOnce({ status: 'read' });
    await readScanned({ receipt_id: 'r1' }, 1);
    expect(callStaffEdge).toHaveBeenCalledTimes(2);
    callStaffEdge.mockReset();
    callStaffEdge.mockRejectedValueOnce(new TypeError('Network request failed'));
    callStaffEdge.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(readScanned({ receipt_id: 'r1' }, 1)).resolves.toBeUndefined();
    expect(callStaffEdge).toHaveBeenCalledTimes(2);
  });
});
